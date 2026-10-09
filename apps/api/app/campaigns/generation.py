from fastapi import HTTPException
from openai import APIError

from app.agents.gateway import AgentGateway, AgentRun
from app.campaigns.models import CampaignBrief, CampaignDraft

CAMPAIGN_INSTRUCTIONS = """You are Northstar's campaign strategist.
Create a cohesive campaign that is specific to the product and audience.
Use plain language, preserve the requested brand voice, and avoid invented facts or metrics.
Return exactly the requested number of posts. Distribute them across only the requested channels.
Number the posts by day, starting at day 1, with one post per day.
Each post must be ready for human review and must include one clear call to action.
"""


async def draft_campaign(gateway: AgentGateway, brief: CampaignBrief) -> AgentRun[CampaignDraft]:
    prompt = (
        f"Product: {brief.product_name}\n"
        f"Description: {brief.product_description}\n"
        f"Audience: {brief.audience}\n"
        f"Objective: {brief.objective}\n"
        f"Channels: {', '.join(brief.channels)}\n"
        f"Number of posts: {brief.days}\n"
        f"Brand voice: {brief.brand_voice}"
    )
    try:
        run = await gateway.run_structured(
            workflow="campaign-draft",
            instructions=CAMPAIGN_INSTRUCTIONS,
            input_text=prompt,
            output_type=CampaignDraft,
        )
    except (APIError, RuntimeError) as error:
        raise HTTPException(
            status_code=502,
            detail="Campaign agent is temporarily unavailable",
        ) from error

    if run.session_id is None or run.turn_id is None:
        raise HTTPException(status_code=502, detail="Campaign agent did not return run identifiers")
    posts = run.output.posts
    if len(posts) != brief.days:
        raise HTTPException(status_code=502, detail="Campaign agent returned an incomplete draft")
    if any(post.channel not in brief.channels for post in posts):
        raise HTTPException(status_code=502, detail="Campaign agent used an unrequested channel")
    if any(not 1 <= post.day <= brief.days for post in posts):
        raise HTTPException(status_code=502, detail="Campaign agent scheduled a post out of range")
    return run
