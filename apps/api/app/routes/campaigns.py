from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.agents.dependencies import get_agent_gateway
from app.agents.gateway import AgentGateway
from app.campaigns.dependencies import get_campaign_store
from app.campaigns.generation import draft_campaign
from app.campaigns.models import Campaign, CampaignBrief, CampaignEvent, PostUpdate
from app.campaigns.store import CampaignStore
from app.config import get_settings

router = APIRouter(prefix="/v1/campaigns", tags=["campaigns"])

Store = Annotated[CampaignStore, Depends(get_campaign_store)]


def _found(campaign: Campaign | None) -> Campaign:
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


@router.post("", response_model=Campaign, status_code=201)
async def create_campaign(
    brief: CampaignBrief,
    gateway: Annotated[AgentGateway, Depends(get_agent_gateway)],
    store: Store,
) -> Campaign:
    run = await draft_campaign(gateway, brief)
    assert run.session_id is not None and run.turn_id is not None
    return await store.create(
        workspace_id=get_settings().demo_workspace_id,
        brief=brief,
        draft=run.output,
        session_id=run.session_id,
        turn_id=run.turn_id,
    )


@router.get("/latest", response_model=Campaign)
async def get_latest_campaign(store: Store) -> Campaign:
    return _found(await store.latest(workspace_id=get_settings().demo_workspace_id))


@router.get("/{campaign_id}", response_model=Campaign)
async def get_campaign(campaign_id: UUID, store: Store) -> Campaign:
    return _found(
        await store.get(workspace_id=get_settings().demo_workspace_id, campaign_id=campaign_id)
    )


@router.patch("/{campaign_id}/posts/{post_id}", response_model=Campaign)
async def update_post(
    campaign_id: UUID,
    post_id: UUID,
    update: PostUpdate,
    store: Store,
) -> Campaign:
    return _found(
        await store.update_post(
            workspace_id=get_settings().demo_workspace_id,
            campaign_id=campaign_id,
            post_id=post_id,
            update=update,
        )
    )


@router.post("/{campaign_id}/approve", response_model=Campaign)
async def approve_campaign(campaign_id: UUID, store: Store) -> Campaign:
    return _found(
        await store.approve(workspace_id=get_settings().demo_workspace_id, campaign_id=campaign_id)
    )


@router.get("/{campaign_id}/events", response_model=list[CampaignEvent])
async def list_campaign_events(campaign_id: UUID, store: Store) -> list[CampaignEvent]:
    workspace_id = get_settings().demo_workspace_id
    _found(await store.get(workspace_id=workspace_id, campaign_id=campaign_id))
    return await store.events(workspace_id=workspace_id, campaign_id=campaign_id)
