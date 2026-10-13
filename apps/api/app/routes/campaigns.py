import logging
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.agents.dependencies import get_agent_gateway
from app.agents.gateway import AgentGateway, AgentProgress, AgentRun
from app.campaigns.dependencies import (
    CampaignStoreScope,
    get_campaign_store,
    get_campaign_store_scope,
)
from app.campaigns.generation import draft_campaign
from app.campaigns.models import (
    Campaign,
    CampaignBrief,
    CampaignDraft,
    CampaignEvent,
    PostUpdate,
)
from app.campaigns.store import CampaignStore
from app.jobs.agent_jobs import AgentJobStore, spawn
from app.jobs.dependencies import AgentJobs
from app.quota import CampaignDraftRun
from app.routes.agent_jobs import job_stream
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
    jobs: AgentJobs,
    stores: Annotated[CampaignStoreScope, Depends(get_campaign_store_scope)],
    workspace_id: WorkspaceId,
    _run: CampaignDraftRun,
) -> StreamingResponse:
    """Draft a campaign and report each step the agent reaches as server-sent events.

    The draft runs on the server, so a reload or a closed tab does not stop it. The page can follow
    it again from /v1/agent-jobs.
    """
    job_id = await jobs.start(workspace_id=workspace_id, kind="campaign_draft")
    spawn(jobs, job_id, _draft_job(gateway, brief, jobs, job_id, stores, workspace_id))
    return job_stream(jobs, workspace_id=workspace_id, job_id=job_id, kind="campaign_draft")


async def _draft_job(
    gateway: AgentGateway,
    brief: CampaignBrief,
    jobs: AgentJobStore,
    job_id: UUID,
    stores: CampaignStoreScope,
    workspace_id: UUID,
) -> None:
    def step(stage: str, items: int, detail: str | None = None) -> dict[str, Any]:
        return {
            "stage": stage,
            "detail": detail,
            "items": min(items, brief.days),
            "total": brief.days,
        }

    async def report(progress: AgentProgress) -> None:
        await jobs.add_progress(job_id, step(progress.stage, progress.items, progress.detail))

    try:
        # The product name lets a reloaded page title the run it follows.
        await jobs.add_progress(
            job_id, {**step("brief_received", 0), "product_name": brief.product_name}
        )
        run = await draft_campaign(gateway, brief, on_progress=report)
        await jobs.add_progress(job_id, step("saving", brief.days))
        async with stores() as store:
            campaign = await _save(store, brief, run, workspace_id)
        await jobs.finish(job_id, campaign.model_dump(mode="json"))
    except HTTPException as error:
        await jobs.fail(job_id, str(error.detail))
    except Exception:
        logger.exception("Campaign draft job failed")
        await jobs.fail(job_id, "The campaign could not be drafted right now.")


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
    return _found(await store.approve(workspace_id=workspace_id, campaign_id=campaign_id))


@router.get("/{campaign_id}/events", response_model=list[CampaignEvent])
async def list_campaign_events(
    campaign_id: UUID,
    store: Store,
    workspace_id: WorkspaceId,
) -> list[CampaignEvent]:
    _found(await store.get(workspace_id=workspace_id, campaign_id=campaign_id))
    return await store.events(workspace_id=workspace_id, campaign_id=campaign_id)
