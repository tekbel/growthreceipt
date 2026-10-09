import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentActor
from app.config import get_settings
from app.database import get_session
from app.demo import seed_judge_workspace
from app.workspaces import Workspace

router = APIRouter(prefix="/v1/auth", tags=["auth"])


class WorkspaceSession(BaseModel):
    workspace_id: UUID
    mode: Literal["local", "judge", "user"]
    display_name: str
    is_anonymous: bool


@router.post("/bootstrap", response_model=WorkspaceSession)
async def bootstrap_workspace(
    actor: CurrentActor,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WorkspaceSession:
    if actor.user_id is None:
        return WorkspaceSession(
            workspace_id=get_settings().demo_workspace_id,
            mode="local",
            display_name="Workspace owner",
            is_anonymous=True,
        )
    async with session.begin():
        row = (
            await session.execute(
                text(
                    """
                    select id, name, coalesce(settings->>'kind', 'user') as mode
                    from public.workspaces
                    where created_by_user_id = :user_id
                    """
                ),
                {"user_id": actor.user_id},
            )
        ).one_or_none()
        if row is None:
            mode = "judge" if actor.is_anonymous else "user"
            name = "Judge demo" if actor.is_anonymous else "My workspace"
            workspace_id = await session.scalar(
                text(
                    """
                    insert into public.workspaces (name, settings, created_by_user_id)
                    values (:name, cast(:settings as jsonb), :user_id)
                    returning id
                    """
                ),
                {
                    "name": name,
                    "settings": json.dumps({"kind": mode}),
                    "user_id": actor.user_id,
                },
            )
            assert workspace_id is not None
            await session.execute(
                text(
                    """
                    insert into public.workspace_members (workspace_id, user_id, role)
                    values (:workspace_id, :user_id, 'owner')
                    """
                ),
                {"workspace_id": workspace_id, "user_id": actor.user_id},
            )
            if actor.is_anonymous:
                await seed_judge_workspace(session, workspace_id=workspace_id)
        else:
            workspace_id = row.id
            name = row.name
            mode = row.mode
    return WorkspaceSession(
        workspace_id=workspace_id,
        mode=mode,
        display_name=name,
        is_anonymous=actor.is_anonymous,
    )


@router.post("/demo/reset", response_model=WorkspaceSession)
async def reset_judge_demo(
    actor: CurrentActor,
    workspace: Workspace,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WorkspaceSession:
    if actor.user_id is None or not actor.is_anonymous or workspace.mode != "judge":
        raise HTTPException(status_code=403, detail="Only judge demos can be reset")
    async with session.begin():
        await seed_judge_workspace(session, workspace_id=workspace.id, reset=True)
    return WorkspaceSession(
        workspace_id=workspace.id,
        mode="judge",
        display_name="Judge demo",
        is_anonymous=True,
    )
