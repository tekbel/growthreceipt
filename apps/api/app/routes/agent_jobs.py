import json
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.jobs.agent_jobs import AgentJob, AgentJobStore, follow
from app.jobs.dependencies import AgentJobs
from app.workspaces import WorkspaceId

router = APIRouter(prefix="/v1/agent-jobs", tags=["agent jobs"])

# The saved result keeps the event name the campaign draft stream has always used.
RESULT_EVENTS = {"campaign_draft": "campaign"}


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def job_stream(
    jobs: AgentJobStore, *, workspace_id: UUID, job_id: UUID, kind: str
) -> StreamingResponse:
    """Streams a job as server-sent events. A disconnect stops only this stream, not the job."""

    async def events() -> AsyncIterator[str]:
        yield sse("job", {"id": str(job_id), "kind": kind})
        async for name, data in follow(jobs, workspace_id=workspace_id, job_id=job_id):
            yield sse(RESULT_EVENTS.get(kind, name) if name == "result" else name, data)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("", response_model=list[AgentJob])
async def list_active_jobs(jobs: AgentJobs, workspace_id: WorkspaceId) -> list[AgentJob]:
    """The runs still working, so a reloaded page can show them and follow them."""
    return await jobs.active(workspace_id=workspace_id)


async def _job(jobs: AgentJobStore, workspace_id: UUID, job_id: UUID) -> AgentJob:
    job = await jobs.get(workspace_id=workspace_id, job_id=job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return job


@router.get("/{job_id}", response_model=AgentJob)
async def get_job(job_id: UUID, jobs: AgentJobs, workspace_id: WorkspaceId) -> AgentJob:
    return await _job(jobs, workspace_id, job_id)


@router.get("/{job_id}/stream")
async def stream_job(job_id: UUID, jobs: AgentJobs, workspace_id: WorkspaceId) -> StreamingResponse:
    job = await _job(jobs, workspace_id, job_id)
    return job_stream(jobs, workspace_id=workspace_id, job_id=job_id, kind=job.kind)
