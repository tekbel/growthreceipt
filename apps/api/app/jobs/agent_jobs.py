"""Agent runs the web app can follow, also after the page reloads.

Each run keeps a row with every progress step it reached, then its result or error. While the run
works it beats a heartbeat. A running row with no update for a while reads as interrupted, so a
redeploy or a crash shows an honest failure instead of a run that never ends.
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Coroutine
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

logger = logging.getLogger(__name__)

JobKind = Literal[
    "campaign_draft", "next_action", "follow_up_post", "revise_post", "brief_from_url"
]
JobStatus = Literal["running", "succeeded", "failed", "interrupted"]

HEARTBEAT_SECONDS = 15.0
STALE_AFTER = timedelta(seconds=90)
INTERRUPTED = "The agent stopped before it finished. Please try again."


class AgentJob(BaseModel):
    id: UUID
    kind: JobKind
    campaign_id: UUID | None
    status: JobStatus
    progress: list[dict[str, Any]]
    result: dict[str, Any] | None
    error: str | None
    created_at: datetime
    updated_at: datetime


def visible(job: AgentJob) -> AgentJob:
    """A running job whose heartbeat stopped is reported as interrupted."""
    if job.status == "running" and job.updated_at < datetime.now(UTC) - STALE_AFTER:
        return job.model_copy(update={"status": "interrupted", "error": INTERRUPTED})
    return job


class AgentJobStore(Protocol):
    async def start(
        self, *, workspace_id: UUID, kind: JobKind, campaign_id: UUID | None = None
    ) -> UUID: ...

    async def add_progress(self, job_id: UUID, event: dict[str, Any]) -> None: ...

    async def touch(self, job_id: UUID) -> None: ...

    async def finish(self, job_id: UUID, result: dict[str, Any]) -> None: ...

    async def fail(self, job_id: UUID, error: str, *, status: JobStatus = "failed") -> None: ...

    async def get(self, *, workspace_id: UUID, job_id: UUID) -> AgentJob | None: ...

    async def active(self, *, workspace_id: UUID) -> list[AgentJob]: ...


_COLUMNS = "id, kind, campaign_id, status, progress, result, error, created_at, updated_at"


class PostgresAgentJobStore:
    """Opens a short session per call, so a run can keep writing after its request has ended."""

    def __init__(self, factory: async_sessionmaker[Any]) -> None:
        self._factory = factory

    async def _write(self, sql: str, params: dict[str, Any]) -> Any:
        async with self._factory() as session, session.begin():
            return await session.execute(text(sql), params)

    async def start(
        self, *, workspace_id: UUID, kind: JobKind, campaign_id: UUID | None = None
    ) -> UUID:
        result = await self._write(
            "insert into growthreceipt.agent_jobs (workspace_id, kind, campaign_id) "
            "values (:workspace_id, :kind, :campaign_id) returning id",
            {"workspace_id": workspace_id, "kind": kind, "campaign_id": campaign_id},
        )
        job_id: UUID = result.scalar_one()
        return job_id

    async def add_progress(self, job_id: UUID, event: dict[str, Any]) -> None:
        await self._write(
            "update growthreceipt.agent_jobs "
            "set progress = progress || jsonb_build_array(cast(:event as jsonb)), "
            "updated_at = now() where id = :id and status = 'running'",
            {"id": job_id, "event": json.dumps(event)},
        )

    async def touch(self, job_id: UUID) -> None:
        await self._write(
            "update growthreceipt.agent_jobs set updated_at = now() "
            "where id = :id and status = 'running'",
            {"id": job_id},
        )

    async def finish(self, job_id: UUID, result: dict[str, Any]) -> None:
        await self._write(
            "update growthreceipt.agent_jobs set status = 'succeeded', "
            "result = cast(:result as jsonb), updated_at = now() "
            "where id = :id and status = 'running'",
            {"id": job_id, "result": json.dumps(result)},
        )

    async def fail(self, job_id: UUID, error: str, *, status: JobStatus = "failed") -> None:
        await self._write(
            "update growthreceipt.agent_jobs set status = :status, error = :error, "
            "updated_at = now() where id = :id and status = 'running'",
            {"id": job_id, "status": status, "error": error},
        )

    async def get(self, *, workspace_id: UUID, job_id: UUID) -> AgentJob | None:
        async with self._factory() as session:
            row = (
                await session.execute(
                    text(
                        f"select {_COLUMNS} from growthreceipt.agent_jobs "
                        "where id = :id and workspace_id = :workspace_id"
                    ),
                    {"id": job_id, "workspace_id": workspace_id},
                )
            ).first()
        return visible(AgentJob(**row._mapping)) if row else None

    async def active(self, *, workspace_id: UUID) -> list[AgentJob]:
        async with self._factory() as session:
            rows = (
                await session.execute(
                    text(
                        f"select {_COLUMNS} from growthreceipt.agent_jobs "
                        "where workspace_id = :workspace_id and status = 'running' "
                        "order by created_at desc limit 10"
                    ),
                    {"workspace_id": workspace_id},
                )
            ).all()
        jobs = [visible(AgentJob(**row._mapping)) for row in rows]
        return [job for job in jobs if job.status == "running"]


class FakeAgentJobStore:
    def __init__(self) -> None:
        self.jobs: dict[UUID, tuple[UUID, AgentJob]] = {}

    def _update(self, job_id: UUID, **changes: Any) -> None:
        workspace_id, job = self.jobs[job_id]
        if job.status == "running":
            changes["updated_at"] = datetime.now(UTC)
            self.jobs[job_id] = (workspace_id, job.model_copy(update=changes))

    async def start(
        self, *, workspace_id: UUID, kind: JobKind, campaign_id: UUID | None = None
    ) -> UUID:
        now = datetime.now(UTC)
        job = AgentJob(
            id=uuid4(),
            kind=kind,
            campaign_id=campaign_id,
            status="running",
            progress=[],
            result=None,
            error=None,
            created_at=now,
            updated_at=now,
        )
        self.jobs[job.id] = (workspace_id, job)
        return job.id

    async def add_progress(self, job_id: UUID, event: dict[str, Any]) -> None:
        self._update(job_id, progress=[*self.jobs[job_id][1].progress, event])

    async def touch(self, job_id: UUID) -> None:
        self._update(job_id)

    async def finish(self, job_id: UUID, result: dict[str, Any]) -> None:
        self._update(job_id, status="succeeded", result=result)

    async def fail(self, job_id: UUID, error: str, *, status: JobStatus = "failed") -> None:
        self._update(job_id, status=status, error=error)

    async def get(self, *, workspace_id: UUID, job_id: UUID) -> AgentJob | None:
        owner, job = self.jobs.get(job_id, (None, None))
        return visible(job) if job and owner == workspace_id else None

    async def active(self, *, workspace_id: UUID) -> list[AgentJob]:
        jobs = [visible(job) for owner, job in self.jobs.values() if owner == workspace_id]
        return sorted(
            (job for job in jobs if job.status == "running"),
            key=lambda job: job.created_at,
            reverse=True,
        )


@asynccontextmanager
async def heartbeat(jobs: AgentJobStore, job_id: UUID) -> AsyncIterator[None]:
    """Keeps a running job fresh while the block runs."""

    async def beat() -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            try:
                await jobs.touch(job_id)
            except Exception:
                logger.warning("Agent job heartbeat failed", exc_info=True)

    task = asyncio.create_task(beat())
    try:
        yield
    finally:
        task.cancel()


class TrackedJob:
    """Set result before the block ends. It becomes the job's result."""

    def __init__(self, job_id: UUID) -> None:
        self.id = job_id
        self.result: BaseModel | None = None


@asynccontextmanager
async def track(
    jobs: AgentJobStore,
    *,
    workspace_id: UUID,
    kind: JobKind,
    campaign_id: UUID | None = None,
    failure: str,
) -> AsyncIterator[TrackedJob]:
    """Records a plain request as a job. The request still answers as usual, and a page that
    reloaded meanwhile finds the result through the job."""
    job = TrackedJob(
        await jobs.start(workspace_id=workspace_id, kind=kind, campaign_id=campaign_id)
    )
    try:
        async with heartbeat(jobs, job.id):
            yield job
    except HTTPException as error:
        await jobs.fail(job.id, str(error.detail))
        raise
    except asyncio.CancelledError:
        await jobs.fail(job.id, INTERRUPTED, status="interrupted")
        raise
    except BaseException:
        await jobs.fail(job.id, failure)
        raise
    await jobs.finish(job.id, job.result.model_dump(mode="json") if job.result else {})


# Runs detached from their request. Holding the tasks here keeps them from being collected.
_running: dict[UUID, asyncio.Task[None]] = {}


def spawn(jobs: AgentJobStore, job_id: UUID, work: Coroutine[Any, Any, object]) -> None:
    """Runs work after its request ends. The work records its own result or error."""

    async def run() -> None:
        try:
            async with heartbeat(jobs, job_id):
                await work
        except asyncio.CancelledError:
            await jobs.fail(job_id, INTERRUPTED, status="interrupted")
            raise
        finally:
            _running.pop(job_id, None)

    _running[job_id] = asyncio.create_task(run())


async def stop_running() -> None:
    """On shutdown, stops detached runs and marks them interrupted."""
    tasks = list(_running.values())
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


POLL_SECONDS = 0.5


async def follow(
    jobs: AgentJobStore, *, workspace_id: UUID, job_id: UUID
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Yields every progress step the job reached, then its result or error."""
    sent = 0
    while True:
        job = await jobs.get(workspace_id=workspace_id, job_id=job_id)
        if job is None:
            yield "error", {"detail": "This agent run was not found."}
            return
        for event in job.progress[sent:]:
            yield "progress", event
        sent = len(job.progress)
        if job.status == "succeeded":
            yield "result", job.result or {}
            return
        if job.status != "running":
            yield "error", {"detail": job.error or INTERRUPTED}
            return
        await asyncio.sleep(POLL_SECONDS)
