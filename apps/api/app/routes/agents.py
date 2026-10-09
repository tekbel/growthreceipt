import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from openai import APIError
from pydantic import BaseModel

from app.agents.dependencies import get_agent_gateway
from app.agents.gateway import AgentGateway
from app.campaigns.dependencies import get_campaign_store
from app.campaigns.generation import draft_campaign
from app.campaigns.models import CampaignBrief, CampaignDraft
from app.campaigns.store import CampaignStore
from app.config import get_settings
from app.paypal.store import PaymentStore
from app.paypal.store_dependencies import get_payment_store

router = APIRouter(prefix="/v1/agents", tags=["agents"])


class CampaignDraftResponse(BaseModel):
    session_id: str
    turn_id: str
    campaign: CampaignDraft


class NextActionRequest(BaseModel):
    campaign_id: UUID


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
    request: CampaignBrief,
    gateway: Annotated[AgentGateway, Depends(get_agent_gateway)],
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
) -> NextActionResponse:
    campaign = await campaigns.get(
        workspace_id=get_settings().demo_workspace_id,
        campaign_id=request.campaign_id,
    )
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    summary = await store.revenue_summary(campaign_id=campaign.id)
    evidence = RevenueEvidence(
        completed_orders=summary.completed_orders,
        gross_revenue=f"{summary.gross_revenue:.2f}",
        currency=summary.currency,
        latest_capture_id=summary.latest_capture_id,
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
    await campaigns.record_event(
        campaign_id=campaign.id,
        actor="agent",
        action="next_action_recommended",
        detail={
            "session_id": run.session_id,
            "turn_id": run.turn_id,
            "evidence": evidence.model_dump(),
            "next_action": run.output.model_dump(),
        },
    )
    return NextActionResponse(
        session_id=run.session_id,
        turn_id=run.turn_id,
        evidence=evidence,
        next_action=run.output,
    )
