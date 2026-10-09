import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from openai import APIError
from pydantic import BaseModel, Field

from app.agents.dependencies import get_agent_gateway
from app.agents.gateway import AgentGateway
from app.paypal.store import PaymentStore
from app.paypal.store_dependencies import get_payment_store

router = APIRouter(prefix="/v1/agents", tags=["agents"])


class CampaignDraftRequest(BaseModel):
    product_name: str = Field(min_length=2, max_length=120)
    product_description: str = Field(min_length=10, max_length=2_000)
    audience: str = Field(min_length=3, max_length=500)
    objective: str = Field(min_length=3, max_length=240)
    channels: list[Literal["LinkedIn", "X", "Instagram"]] = Field(min_length=1)
    days: int = Field(default=7, ge=1, le=14)
    brand_voice: str = Field(default="Clear, confident, useful", max_length=500)


class CampaignPost(BaseModel):
    day: int
    channel: Literal["LinkedIn", "X", "Instagram"]
    theme: str
    content: str
    call_to_action: str


class CampaignDraft(BaseModel):
    campaign_name: str
    positioning: str
    posts: list[CampaignPost]


class CampaignDraftResponse(BaseModel):
    session_id: str
    turn_id: str
    campaign: CampaignDraft


class NextActionRequest(BaseModel):
    campaign_id: UUID
    product_name: str = Field(min_length=2, max_length=120)
    campaign_name: str = Field(min_length=2, max_length=160)
    objective: str = Field(min_length=3, max_length=240)
    audience: str = Field(min_length=3, max_length=500)


class NextAction(BaseModel):
    evidence_summary: str
    recommendation: str
    rationale: str
    expected_signal: str
    confidence: Literal["low", "medium", "high"]
    needs_more_data: bool
    human_approval_required: bool


class RevenueEvidence(BaseModel):
    completed_orders: int
    gross_revenue: str
    currency: str
    latest_capture_id: str | None


class NextActionResponse(BaseModel):
    session_id: str
    turn_id: str
    evidence: RevenueEvidence
    next_action: NextAction


CAMPAIGN_INSTRUCTIONS = """You are Northstar's campaign strategist.
Create a cohesive campaign that is specific to the product and audience.
Use plain language, preserve the requested brand voice, and avoid invented facts or metrics.
Return exactly the requested number of posts. Distribute them across only the requested channels.
Each post must be ready for human review and must include one clear call to action.
"""

REVENUE_LEARNING_INSTRUCTIONS = """You are Northstar's revenue learning agent.
Use only the normalized campaign and PayPal revenue evidence supplied by the application.
Do not invent conversion rates, traffic, customer attributes, causality, or statistical confidence.
State the small sample size plainly. Recommend exactly one bounded marketing experiment.
The recommendation may change messaging, audience, channel, creative, or measurement.
It must not initiate a payment, change a price, publish content, or spend money.
Set human_approval_required to true.
Use low confidence when there are fewer than 10 completed orders.
If there are no completed orders, recommend the smallest action needed to collect useful evidence.
"""


@router.post("/campaign-draft", response_model=CampaignDraftResponse)
async def create_campaign_draft(
    request: CampaignDraftRequest,
    gateway: Annotated[AgentGateway, Depends(get_agent_gateway)],
) -> CampaignDraftResponse:
    prompt = (
        f"Product: {request.product_name}\n"
        f"Description: {request.product_description}\n"
        f"Audience: {request.audience}\n"
        f"Objective: {request.objective}\n"
        f"Channels: {', '.join(request.channels)}\n"
        f"Number of posts: {request.days}\n"
        f"Brand voice: {request.brand_voice}"
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
    if len(run.output.posts) != request.days:
        raise HTTPException(status_code=502, detail="Campaign agent returned an incomplete draft")
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
) -> NextActionResponse:
    summary = await store.revenue_summary(campaign_id=request.campaign_id)
    evidence = RevenueEvidence(
        completed_orders=summary.completed_orders,
        gross_revenue=f"{summary.gross_revenue:.2f}",
        currency=summary.currency,
        latest_capture_id=summary.latest_capture_id,
    )
    prompt = json.dumps(
        {
            "campaign": {
                "id": str(request.campaign_id),
                "product_name": request.product_name,
                "campaign_name": request.campaign_name,
                "objective": request.objective,
                "audience": request.audience,
            },
            "verified_revenue_evidence": evidence.model_dump(),
        },
        indent=2,
    )
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
    return NextActionResponse(
        session_id=run.session_id,
        turn_id=run.turn_id,
        evidence=evidence,
        next_action=run.output,
    )
