from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal, Protocol
from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.workspaces import WorkspaceId

RunKind = Literal["campaign_draft", "next_action", "studio_turn"]
WINDOW = timedelta(days=1)


class AgentQuota(Protocol):
    async def claim(self, *, workspace_id: UUID, kind: RunKind) -> bool: ...


class PostgresAgentQuota:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def claim(self, *, workspace_id: UUID, kind: RunKind) -> bool:
        settings = get_settings()
        studio = kind == "studio_turn"
        workspace_limit, total_limit = (
            (settings.studio_turns_per_workspace_day, settings.studio_turns_per_day)
            if studio
            else (settings.agent_runs_per_workspace_day, settings.agent_runs_per_day)
        )
        since = datetime.now(UTC) - WINDOW
        async with self._session.begin():
            # Serialize claims so two parallel requests cannot both take the last run.
            await self._session.execute(
                text("select pg_advisory_xact_lock(hashtext('agent_runs'))")
            )
            row = (
                await self._session.execute(
                    text(
                        """
                        select count(*) filter (where workspace_id = :workspace_id) as workspace,
                               count(*) as total
                        from growthreceipt.agent_runs
                        where created_at > :since and (kind = 'studio_turn') = :studio
                        """
                    ),
                    {"workspace_id": workspace_id, "since": since, "studio": studio},
                )
            ).one()
            if row.workspace >= workspace_limit or row.total >= total_limit:
                return False
            await self._session.execute(
                text(
                    "insert into growthreceipt.agent_runs (workspace_id, kind) "
                    "values (:workspace_id, :kind)"
                ),
                {"workspace_id": workspace_id, "kind": kind},
            )
        return True


class FakeAgentQuota:
    def __init__(self, limit: int = 1_000) -> None:
        self.limit = limit
        self.claims: list[tuple[UUID, RunKind]] = []

    async def claim(self, *, workspace_id: UUID, kind: RunKind) -> bool:
        if len(self.claims) >= self.limit:
            return False
        self.claims.append((workspace_id, kind))
        return True


def get_agent_quota(session: Annotated[AsyncSession, Depends(get_session)]) -> AgentQuota:
    return PostgresAgentQuota(session)


Quota = Annotated[AgentQuota, Depends(get_agent_quota)]


async def claim_run(quota: AgentQuota, workspace_id: UUID, kind: RunKind) -> None:
    if not await quota.claim(workspace_id=workspace_id, kind=kind):
        raise HTTPException(
            status_code=429,
            detail="The agent has reached today's limit. Please try again tomorrow.",
        )


def _claim(kind: RunKind) -> Callable[[Quota, WorkspaceId], Awaitable[None]]:
    async def claim(quota: Quota, workspace_id: WorkspaceId) -> None:
        await claim_run(quota, workspace_id, kind)

    return claim


CampaignDraftRun = Annotated[None, Depends(_claim("campaign_draft"))]
NextActionRun = Annotated[None, Depends(_claim("next_action"))]
