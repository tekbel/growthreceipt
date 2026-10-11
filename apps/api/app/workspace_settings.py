import json
from typing import Annotated, Protocol
from uuid import UUID

from fastapi import Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session


class WorkspaceSettings(BaseModel):
    name: str
    # None means the workspace follows each viewer's browser time zone.
    timezone: str | None


class WorkspaceSettingsStore(Protocol):
    async def get(self, workspace_id: UUID) -> WorkspaceSettings | None: ...

    async def update(
        self, workspace_id: UUID, *, name: str, timezone: str | None
    ) -> WorkspaceSettings | None: ...


class PostgresWorkspaceSettingsStore:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, workspace_id: UUID) -> WorkspaceSettings | None:
        async with self._session.begin():
            row = (
                await self._session.execute(
                    text(
                        "select name, settings->>'timezone' as timezone "
                        "from growthreceipt.workspaces where id = :id"
                    ),
                    {"id": workspace_id},
                )
            ).one_or_none()
        return None if row is None else WorkspaceSettings(name=row.name, timezone=row.timezone)

    async def update(
        self, workspace_id: UUID, *, name: str, timezone: str | None
    ) -> WorkspaceSettings | None:
        async with self._session.begin():
            # Merge into settings so keys such as kind stay untouched.
            row = (
                await self._session.execute(
                    text(
                        """
                        update growthreceipt.workspaces
                        set name = :name,
                            settings = coalesce(settings, '{}'::jsonb)
                                       || cast(:patch as jsonb)
                        where id = :id
                        returning name, settings->>'timezone' as timezone
                        """
                    ),
                    {"id": workspace_id, "name": name, "patch": json.dumps({"timezone": timezone})},
                )
            ).one_or_none()
        return None if row is None else WorkspaceSettings(name=row.name, timezone=row.timezone)


class FakeWorkspaceSettingsStore:
    def __init__(self) -> None:
        self.settings: dict[UUID, WorkspaceSettings] = {}

    async def get(self, workspace_id: UUID) -> WorkspaceSettings | None:
        default = WorkspaceSettings(name="My workspace", timezone=None)
        return self.settings.get(workspace_id, default)

    async def update(
        self, workspace_id: UUID, *, name: str, timezone: str | None
    ) -> WorkspaceSettings | None:
        self.settings[workspace_id] = WorkspaceSettings(name=name, timezone=timezone)
        return self.settings[workspace_id]


def get_workspace_settings_store(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WorkspaceSettingsStore:
    return PostgresWorkspaceSettingsStore(session)
