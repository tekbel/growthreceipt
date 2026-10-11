import json
import time
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from openai import APIError
from pydantic import BaseModel, Field

from app.agents.dependencies import get_agent_gateway
from app.agents.gateway import AgentGateway
from app.campaigns.dependencies import get_campaign_store
from app.campaigns.generation import draft_campaign
from app.campaigns.models import Campaign, CampaignBrief, CampaignDraft, CampaignPost
from app.campaigns.store import CampaignStore
from app.config import get_settings
from app.paypal.store import PaymentStore
from app.paypal.store_dependencies import get_payment_store
from app.quota import CampaignDraftRun, NextActionRun
from app.workspaces import WorkspaceId

router = APIRouter(prefix="/v1/agents", tags=["agents"])


class CampaignDraftResponse(BaseModel):
    session_id: str
    turn_id: str
    campaign: CampaignDraft


class NextActionRequest(BaseModel):
    campaign_id: UUID


class NextAction(BaseModel):
    headline: str = Field(description="The experiment in at most 10 plain words.")
    evidence_summary: str
    recommendation: str
    rationale: str
    expected_signal: str
    confidence: Literal["low", "medium", "high"]
    needs_more_data: bool
    human_approval_required: bool


class PaidPostEvidence(BaseModel):
    content_id: UUID
    day: int
    channel: str
    theme: str
    content: str
    completed_orders: int
    revenue: str


class RevenueEvidence(BaseModel):
    completed_orders: int
    gross_revenue: str
    currency: str
    latest_capture_id: str | None
    paid_posts: list[PaidPostEvidence] = []


class NextActionResponse(BaseModel):
    session_id: str
    turn_id: str
    model: str
    duration_ms: int
    evidence: RevenueEvidence
    next_action: NextAction


class NextActionDecisionRequest(BaseModel):
    campaign_id: UUID
    decision: Literal["approved", "rejected"]
    # The founder's edited plan. Only used when approving.
    recommendation: str | None = Field(default=None, min_length=1, max_length=1200)


class NextActionDecision(BaseModel):
    decision: Literal["approved", "rejected"]
    headline: str
    recommendation: str
    edited: bool
    decided_at: datetime


DECISION_ACTIONS = {"next_action_approved", "next_action_rejected"}


REVENUE_LEARNING_INSTRUCTIONS = """You are GrowthReceipt's revenue learning agent.
Use only the normalized campaign and PayPal revenue evidence supplied by the application.
Do not invent conversion rates, traffic, customer attributes, causality, or statistical confidence.
State the small sample size plainly. Recommend exactly one bounded marketing experiment.
The recommendation may change messaging, audience, channel, creative, or measurement.
It must not initiate a payment, change a price, publish content, or spend money.
Set human_approval_required to true.
Write for a busy founder in plain, everyday English.
headline names the experiment in at most 10 words.
recommendation says what to do in at most 3 short sentences.
evidence_summary, rationale and expected_signal are one or two short sentences each.
Never use semicolons, dashes or jargon such as bounded, causality or attributed.
Use low confidence when there are fewer than 10 completed orders.
If there are no completed orders, recommend the smallest action needed to collect useful evidence.
paid_posts lists the posts whose buy link took the payments. When it is not empty,
name the post that earned the most by its day and channel, and build the experiment on it.
"""


@router.post("/campaign-draft", response_model=CampaignDraftResponse)
async def create_campaign_draft(
    request: CampaignBrief,
    gateway: Annotated[AgentGateway, Depends(get_agent_gateway)],
    _workspace_id: WorkspaceId,
    _run: CampaignDraftRun,
) -> CampaignDraftResponse:
    run = await draft_campaign(gateway, request)
    assert run.session_id is not None and run.turn_id is not None
    return CampaignDraftResponse(
        session_id=run.session_id,
        turn_id=run.turn_id,
        campaign=run.output,
    )


@router.post("/next-action", response_model=NextActionResponse)
async def create_next_action(
    request: NextActionRequest,
    gateway: Annotated[AgentGateway, Depends(get_agent_gateway)],
    store: Annotated[PaymentStore, Depends(get_payment_store)],
    campaigns: Annotated[CampaignStore, Depends(get_campaign_store)],
    workspace_id: WorkspaceId,
    _run: NextActionRun,
) -> NextActionResponse:
    campaign = await campaigns.get(
        workspace_id=workspace_id,
        campaign_id=request.campaign_id,
    )
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    summary = await store.revenue_summary(campaign_id=campaign.id)
    receipts = await store.receipts(campaign_id=campaign.id)
    paid_posts = []
    for post in campaign.posts:
        paid = [receipt for receipt in receipts if receipt.content_id == post.id]
        if paid:
            paid_posts.append(
                PaidPostEvidence(
                    content_id=post.id,
                    day=post.day,
                    channel=post.channel,
                    theme=post.theme,
                    content=post.content,
                    completed_orders=len(paid),
                    revenue=f"{sum((receipt.amount for receipt in paid), Decimal('0')):.2f}",
                )
            )
    paid_posts.sort(key=lambda paid: Decimal(paid.revenue), reverse=True)
    evidence = RevenueEvidence(
        completed_orders=summary.completed_orders,
        gross_revenue=f"{summary.gross_revenue:.2f}",
        currency=summary.currency,
        latest_capture_id=summary.latest_capture_id,
        paid_posts=paid_posts,
    )
    prompt = json.dumps(
        {
            "campaign": {
                "id": str(campaign.id),
                "product_name": campaign.product_name,
                "campaign_name": campaign.name,
                "positioning": campaign.positioning,
                "objective": campaign.objective,
                "audience": campaign.audience,
                "channels": campaign.channels,
                "approved_posts": sum(post.status == "approved" for post in campaign.posts),
                "total_posts": len(campaign.posts),
            },
            "verified_revenue_evidence": evidence.model_dump(mode="json"),
        },
        indent=2,
    )
    started = time.perf_counter()
    try:
        run = await gateway.run_structured(
            workflow="revenue-next-action",
            instructions=REVENUE_LEARNING_INSTRUCTIONS,
            input_text=prompt,
            output_type=NextAction,
        )
    except (APIError, RuntimeError) as error:
        raise HTTPException(
            status_code=502,
            detail="Revenue learning agent is temporarily unavailable",
        ) from error

    duration_ms = round((time.perf_counter() - started) * 1000)
    if run.session_id is None or run.turn_id is None:
        raise HTTPException(
            status_code=502,
            detail="Revenue learning agent did not return run identifiers",
        )
    if not run.output.human_approval_required:
        raise HTTPException(
            status_code=502,
            detail="Revenue learning agent crossed a safety boundary",
        )
    await campaigns.record_event(
        campaign_id=campaign.id,
        actor="agent",
        action="next_action_recommended",
        detail={
            "session_id": run.session_id,
            "turn_id": run.turn_id,
            "model": get_settings().openai_model,
            "duration_ms": duration_ms,
            "evidence": evidence.model_dump(mode="json"),
            "next_action": run.output.model_dump(),
        },
    )
    return NextActionResponse(
        session_id=run.session_id,
        turn_id=run.turn_id,
        model=get_settings().openai_model,
        duration_ms=duration_ms,
        evidence=evidence,
        next_action=run.output,
    )


@router.post("/next-action/decision", response_model=NextActionDecision)
async def decide_next_action(
    request: NextActionDecisionRequest,
    campaigns: Annotated[CampaignStore, Depends(get_campaign_store)],
    workspace_id: WorkspaceId,
) -> NextActionDecision:
    """Records the founder's call on the latest next move. The agent never acts on its own."""
    campaign = await campaigns.get(workspace_id=workspace_id, campaign_id=request.campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    events = await campaigns.events(workspace_id=workspace_id, campaign_id=campaign.id)
    latest = next(
        (
            event
            for event in events
            if event.action in {"next_action_recommended", *DECISION_ACTIONS}
        ),
        None,
    )
    if latest is None:
        raise HTTPException(status_code=409, detail="There is no next move to decide on")
    if latest.action in DECISION_ACTIONS:
        raise HTTPException(status_code=409, detail="This next move was already decided")
    proposed = NextAction.model_validate(latest.detail["next_action"])
    final = (request.recommendation or "").strip() if request.decision == "approved" else ""
    edited = bool(final) and final != proposed.recommendation
    decision = NextActionDecision(
        decision=request.decision,
        headline=proposed.headline,
        recommendation=final or proposed.recommendation,
        edited=edited,
        decided_at=datetime.now(UTC),
    )
    detail = decision.model_dump(mode="json")
    if edited:
        detail["proposed_recommendation"] = proposed.recommendation
    await campaigns.record_event(
        campaign_id=campaign.id,
        actor="human",
        action=f"next_action_{request.decision}",
        detail=detail,
    )
    return decision


FOLLOW_UP_INSTRUCTIONS = """You are GrowthReceipt's campaign writer.
Write exactly one new post that carries out the approved plan.
Build on the source post, which earned real PayPal revenue. Keep what made it work.
Keep the product, the offer and the price the same. Never invent metrics, customers or quotes.
Use the source post's channel unless the plan names another channel from the campaign channels.
Preserve the brand voice. Include one clear call to action.
Never use semicolons or dashes.
"""

MAX_POSTS = 14
MOVE_ACTIONS = {"next_action_recommended", *DECISION_ACTIONS, "follow_up_drafted"}


class FollowUpRequest(BaseModel):
    campaign_id: UUID


class FollowUpResponse(BaseModel):
    post_id: UUID
    source_post_id: UUID | None
    campaign: Campaign


@router.post("/follow-up-post", response_model=FollowUpResponse)
async def draft_follow_up_post(
    request: FollowUpRequest,
    gateway: Annotated[AgentGateway, Depends(get_agent_gateway)],
    campaigns: Annotated[CampaignStore, Depends(get_campaign_store)],
    workspace_id: WorkspaceId,
    _run: CampaignDraftRun,
) -> FollowUpResponse:
    """Drafts the post an approved next move asks for. It waits in review like any other post."""
    campaign = await campaigns.get(workspace_id=workspace_id, campaign_id=request.campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    events = await campaigns.events(workspace_id=workspace_id, campaign_id=campaign.id)
    moves = [event for event in events if event.action in MOVE_ACTIONS]
    if not moves or moves[0].action != "next_action_approved":
        detail = (
            "A post was already drafted for this move"
            if moves and moves[0].action == "follow_up_drafted"
            else "Approve a next move first"
        )
        raise HTTPException(status_code=409, detail=detail)
    approved = moves[0].detail
    recommended = next(
        (event for event in moves if event.action == "next_action_recommended"), None
    )
    paid_posts = (recommended.detail.get("evidence", {}) if recommended else {}).get(
        "paid_posts", []
    )
    paid_ids = [str(paid["content_id"]) for paid in paid_posts]
    source = next(
        (post for paid_id in paid_ids for post in campaign.posts if str(post.id) == paid_id),
        None,
    )
    day = max((post.day for post in campaign.posts), default=0) + 1
    if day > MAX_POSTS:
        raise HTTPException(status_code=409, detail="This campaign already has 14 posts")
    prompt = json.dumps(
        {
            "product_name": campaign.product_name,
            "product_description": campaign.product_description,
            "audience": campaign.audience,
            "brand_voice": campaign.brand_voice,
            "campaign_channels": campaign.channels,
            "approved_plan": approved.get("recommendation"),
            "source_post": source.model_dump(
                mode="json", include={"day", "channel", "theme", "content", "call_to_action"}
            )
            if source
            else None,
            "source_post_revenue": paid_posts[0]["revenue"] if source and paid_posts else None,
            "day": day,
        },
        indent=2,
    )
    try:
        run = await gateway.run_structured(
            workflow="follow-up-post",
            instructions=FOLLOW_UP_INSTRUCTIONS,
            input_text=prompt,
            output_type=CampaignPost,
        )
    except (APIError, RuntimeError) as error:
        raise HTTPException(
            status_code=502, detail="The post could not be drafted right now"
        ) from error
    post = run.output.model_copy(update={"day": day})
    if post.channel not in campaign.channels:
        post = post.model_copy(
            update={"channel": source.channel if source else campaign.channels[0]}
        )
    updated = await campaigns.add_post(
        workspace_id=workspace_id,
        campaign_id=campaign.id,
        post=post,
        detail={
            "session_id": run.session_id,
            "turn_id": run.turn_id,
            "source_post_id": str(source.id) if source else None,
            "source_day": source.day if source else None,
            "headline": approved.get("headline"),
            "approved_plan": approved.get("recommendation"),
        },
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    added = next(item for item in reversed(updated.posts) if item.day == day)
    return FollowUpResponse(
        post_id=added.id,
        source_post_id=source.id if source else None,
        campaign=updated,
    )


REVISION_INSTRUCTIONS = """You are GrowthReceipt's campaign writer.
Revise exactly one post so it does what the founder's review note asks.
Change only what the note asks for and keep everything else that works.
Keep the channel, the product, the offer and the price. Never invent metrics, customers or quotes.
Preserve the brand voice. Include one clear call to action.
Never use semicolons or dashes.
"""


class RevisionRequest(BaseModel):
    campaign_id: UUID
    post_id: UUID


class RevisionResponse(BaseModel):
    post_id: UUID
    campaign: Campaign


@router.post("/revise-post", response_model=RevisionResponse)
async def revise_post(
    request: RevisionRequest,
    gateway: Annotated[AgentGateway, Depends(get_agent_gateway)],
    campaigns: Annotated[CampaignStore, Depends(get_campaign_store)],
    workspace_id: WorkspaceId,
    _run: CampaignDraftRun,
) -> RevisionResponse:
    """Applies the founder's change request to one post. The result goes back to review."""
    campaign = await campaigns.get(workspace_id=workspace_id, campaign_id=request.campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    post = next((item for item in campaign.posts if item.id == request.post_id), None)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    note = (post.review_note or "").strip()
    if post.status != "changes_requested" or not note:
        raise HTTPException(status_code=409, detail="Request changes with a note first")
    prompt = json.dumps(
        {
            "product_name": campaign.product_name,
            "audience": campaign.audience,
            "brand_voice": campaign.brand_voice,
            "review_note": note,
            "post": post.model_dump(
                mode="json", include={"day", "channel", "theme", "content", "call_to_action"}
            ),
        },
        indent=2,
    )
    try:
        run = await gateway.run_structured(
            workflow="revise-post",
            instructions=REVISION_INSTRUCTIONS,
            input_text=prompt,
            output_type=CampaignPost,
        )
    except (APIError, RuntimeError) as error:
        raise HTTPException(
            status_code=502, detail="The post could not be revised right now"
        ) from error
    revised = run.output.model_copy(update={"day": post.day, "channel": post.channel})
    updated = await campaigns.revise_post(
        workspace_id=workspace_id,
        campaign_id=campaign.id,
        post_id=post.id,
        revised=revised,
        detail={
            "session_id": run.session_id,
            "turn_id": run.turn_id,
            "model": get_settings().openai_model,
            "review_note": note,
            "before": post.content,
            "after": revised.content,
        },
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return RevisionResponse(post_id=post.id, campaign=updated)
