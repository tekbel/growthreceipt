from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentActor
from app.config import get_settings
from app.database import get_session


@dataclass(frozen=True)
class WorkspaceContext:
    id: UUID
    mode: str


async def get_workspace_context(
    actor: CurrentActor,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WorkspaceContext:
    if actor.user_id is None:
        return WorkspaceContext(id=get_settings().demo_workspace_id, mode="local")
    row = (
        await session.execute(
            text(
                """
                select workspace.id,
                       coalesce(workspace.settings->>'kind', 'user') as mode
                from growthreceipt.workspace_members membership
                join growthreceipt.workspaces workspace on workspace.id = membership.workspace_id
                where membership.user_id = :user_id
                order by membership.created_at
                limit 1
                """
            ),
            {"user_id": actor.user_id},
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=403, detail="Finish workspace setup to continue")
    return WorkspaceContext(id=row.id, mode=row.mode)


Workspace = Annotated[WorkspaceContext, Depends(get_workspace_context)]


def workspace_id(workspace: Workspace) -> UUID:
    return workspace.id


WorkspaceId = Annotated[UUID, Depends(workspace_id)]
