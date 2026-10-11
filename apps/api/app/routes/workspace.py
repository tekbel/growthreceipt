from functools import cache
from typing import Annotated
from zoneinfo import available_timezones

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.workspace_settings import (
    WorkspaceSettings,
    WorkspaceSettingsStore,
    get_workspace_settings_store,
)
from app.workspaces import WorkspaceId

router = APIRouter(prefix="/v1/workspace", tags=["workspace"])

Store = Annotated[WorkspaceSettingsStore, Depends(get_workspace_settings_store)]


@cache
def _zones() -> frozenset[str]:
    return frozenset(available_timezones())


class WorkspaceSettingsUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    timezone: str | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter a workspace name")
        return value

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value: str | None) -> str | None:
        if value is not None and value not in _zones():
            raise ValueError("Choose a time zone from the list")
        return value


@router.get("/settings", response_model=WorkspaceSettings)
async def read_settings(workspace_id: WorkspaceId, store: Store) -> WorkspaceSettings:
    settings = await store.get(workspace_id)
    if settings is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return settings


@router.patch("/settings", response_model=WorkspaceSettings)
async def update_settings(
    update: WorkspaceSettingsUpdate, workspace_id: WorkspaceId, store: Store
) -> WorkspaceSettings:
    settings = await store.update(workspace_id, name=update.name, timezone=update.timezone)
    if settings is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return settings
