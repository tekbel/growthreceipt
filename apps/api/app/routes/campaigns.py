import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.agents.dependencies import get_agent_gateway
from app.agents.gateway import AgentGateway, AgentProgress, AgentRun
from app.campaigns.dependencies import get_campaign_store
from app.campaigns.generation import draft_campaign
from app.campaigns.models import (
    Campaign,
    CampaignBrief,
    CampaignDraft,
    CampaignEvent,
    PostUpdate,
)
from app.campaigns.store import CampaignStore
from app.quota import CampaignDraftRun
from app.workspaces import WorkspaceId

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/campaigns", tags=["campaigns"])

Store = Annotated[CampaignStore, Depends(get_campaign_store)]
Gateway = Annotated[AgentGateway, Depends(get_agent_gateway)]


def _found(campaign: Campaign | None) -> Campaign:
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


async def _save(
    store: CampaignStore,
    brief: CampaignBrief,
    run: AgentRun[CampaignDraft],
    workspace_id: UUID,
) -> Campaign:
    assert run.session_id is not None and run.turn_id is not None
    return await store.create(
        workspace_id=workspace_id,
        brief=brief,
        draft=run.output,
        session_id=run.session_id,
        turn_id=run.turn_id,
    )


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("", response_model=Campaign, status_code=201)
async def create_campaign(
    brief: CampaignBrief,
    gateway: Gateway,
    store: Store,
    workspace_id: WorkspaceId,
    _run: CampaignDraftRun,
) -> Campaign:
    return await _save(store, brief, await draft_campaign(gateway, brief), workspace_id)


@router.post("/stream")
async def stream_campaign(
    brief: CampaignBrief,
    gateway: Gateway,
    store: Store,
    workspace_id: WorkspaceId,
    _run: CampaignDraftRun,
) -> StreamingResponse:
    """Draft a campaign and report each step the agent reaches as server-sent events."""

    async def events() -> AsyncIterator[str]:
        queue: asyncio.Queue[AgentProgress | None] = asyncio.Queue()
        task = asyncio.create_task(draft_campaign(gateway, brief, on_progress=queue.put))
        task.add_done_callback(lambda _: queue.put_nowait(None))
        try:
            yield _sse("progress", {"stage": "brief_received", "items": 0, "total": brief.days})
            while (progress := await queue.get()) is not None:
                yield _sse(
                    "progress",
                    {
                        "stage": progress.stage,
                        "detail": progress.detail,
                        "items": min(progress.items, brief.days),
                        "total": brief.days,
                    },
                )
            run = task.result()
            yield _sse("progress", {"stage": "saving", "items": brief.days, "total": brief.days})
            campaign = await _save(store, brief, run, workspace_id)
            yield _sse("campaign", campaign.model_dump(mode="json"))
        except HTTPException as error:
            yield _sse("error", {"detail": error.detail})
        except Exception:
            logger.exception("Streaming campaign draft failed")
            yield _sse("error", {"detail": "The campaign could not be drafted right now."})
        finally:
            task.cancel()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/latest", response_model=Campaign)
async def get_latest_campaign(store: Store, workspace_id: WorkspaceId) -> Campaign:
    return _found(await store.latest(workspace_id=workspace_id))


@router.get("/{campaign_id}", response_model=Campaign)
async def get_campaign(campaign_id: UUID, store: Store, workspace_id: WorkspaceId) -> Campaign:
    return _found(await store.get(workspace_id=workspace_id, campaign_id=campaign_id))


@router.patch("/{campaign_id}/posts/{post_id}", response_model=Campaign)
async def update_post(
    campaign_id: UUID,
    post_id: UUID,
    update: PostUpdate,
    store: Store,
    workspace_id: WorkspaceId,
) -> Campaign:
    campaign = _found(await store.get(workspace_id=workspace_id, campaign_id=campaign_id))
    post = next((item for item in campaign.posts if item.id == post_id), None)
    if post is not None and post.published_at is not None:
        # The live post would no longer match the record of what went out.
        raise HTTPException(status_code=409, detail="This post is already published on LinkedIn")
    return _found(
        await store.update_post(
            workspace_id=workspace_id,
            campaign_id=campaign_id,
            post_id=post_id,
            update=update,
        )
    )


@router.post("/{campaign_id}/approve", response_model=Campaign)
async def approve_campaign(
    campaign_id: UUID,
    store: Store,
    workspace_id: WorkspaceId,
) -> Campaign:
    return _found(
        await store.approve(workspace_id=workspace_id, campaign_id=campaign_id)
    )


@router.get("/{campaign_id}/events", response_model=list[CampaignEvent])
async def list_campaign_events(
    campaign_id: UUID,
    store: Store,
    workspace_id: WorkspaceId,
) -> list[CampaignEvent]:
    _found(await store.get(workspace_id=workspace_id, campaign_id=campaign_id))
    return await store.events(workspace_id=workspace_id, campaign_id=campaign_id)
