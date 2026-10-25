import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import BaseModel

from app.jobs.agent_jobs import (
    INTERRUPTED,
    FakeAgentJobStore,
    detached,
    follow,
    spawn,
    stop_running,
)


@pytest.mark.asyncio
async def test_a_spawned_run_finishes_with_nobody_watching() -> None:
    jobs = FakeAgentJobStore()
    workspace = uuid4()
    job_id = await jobs.start(workspace_id=workspace, kind="campaign_draft")

    async def work() -> None:
        await jobs.add_progress(job_id, {"stage": "writing"})
        await asyncio.sleep(0)
        await jobs.finish(job_id, {"id": "saved"})

    spawn(jobs, job_id, work())
    events = [event async for event in follow(jobs, workspace_id=workspace, job_id=job_id)]

    assert events == [("progress", {"stage": "writing"}), ("result", {"id": "saved"})]
    assert await jobs.get(workspace_id=uuid4(), job_id=job_id) is None


@pytest.mark.asyncio
async def test_a_run_without_a_heartbeat_reads_as_interrupted() -> None:
    jobs = FakeAgentJobStore()
    workspace = uuid4()
    job_id = await jobs.start(workspace_id=workspace, kind="next_action")
    owner, job = jobs.jobs[job_id]
    jobs.jobs[job_id] = (
        owner,
        job.model_copy(update={"updated_at": datetime.now(UTC) - timedelta(minutes=5)}),
    )

    seen = await jobs.get(workspace_id=workspace, job_id=job_id)
    events = [event async for event in follow(jobs, workspace_id=workspace, job_id=job_id)]

    assert seen is not None and seen.status == "interrupted"
    assert await jobs.active(workspace_id=workspace) == []
    assert events == [("error", {"detail": INTERRUPTED})]


@pytest.mark.asyncio
async def test_shutdown_marks_running_work_interrupted() -> None:
    jobs = FakeAgentJobStore()
    workspace = uuid4()
    job_id = await jobs.start(workspace_id=workspace, kind="campaign_draft")
    spawn(jobs, job_id, asyncio.Event().wait())
    await asyncio.sleep(0)

    await stop_running()

    job = await jobs.get(workspace_id=workspace, job_id=job_id)
    assert job is not None and job.status == "interrupted" and job.error == INTERRUPTED


class Saved(BaseModel):
    id: str


@pytest.mark.asyncio
async def test_a_detached_run_outlives_its_cancelled_request() -> None:
    jobs = FakeAgentJobStore()
    workspace = uuid4()
    release = asyncio.Event()

    async def work() -> Saved:
        await release.wait()
        return Saved(id="saved")

    request = asyncio.create_task(
        detached(jobs, work(), workspace_id=workspace, kind="next_action", failure="Failed.")
    )
    await asyncio.sleep(0)
    # A host that cancels on disconnect cancels the request, not the run.
    request.cancel()
    with pytest.raises(asyncio.CancelledError):
        await request
    release.set()

    [(_, job)] = jobs.jobs.values()
    events = [event async for event in follow(jobs, workspace_id=workspace, job_id=job.id)]
    assert events == [("result", {"id": "saved"})]


@pytest.mark.asyncio
async def test_a_detached_run_records_why_it_failed() -> None:
    jobs = FakeAgentJobStore()
    workspace = uuid4()

    async def refused() -> Saved:
        raise HTTPException(status_code=502, detail="The agent is unavailable.")

    async def broken() -> Saved:
        raise RuntimeError("boom")

    with pytest.raises(HTTPException):
        await detached(jobs, refused(), workspace_id=workspace, kind="revise_post", failure="x")
    with pytest.raises(RuntimeError):
        await detached(
            jobs, broken(), workspace_id=workspace, kind="revise_post", failure="Not revised."
        )

    assert [(job.status, job.error) for _, job in jobs.jobs.values()] == [
        ("failed", "The agent is unavailable."),
        ("failed", "Not revised."),
    ]
