import os
from typing import Literal

from fastapi import APIRouter, Response, status
from pydantic import BaseModel

from app.database import database_is_ready

router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok", "not_ready"]
    database: Literal["ok", "unavailable"] | None = None


@router.get("/live", response_model=HealthResponse)
async def live() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/ready", response_model=HealthResponse)
async def ready(response: Response) -> HealthResponse:
    if not await database_is_ready():
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthResponse(status="not_ready", database="unavailable")
    return HealthResponse(status="ok", database="ok")


class VersionResponse(BaseModel):
    commit: str | None


@router.get("/version", response_model=VersionResponse)
async def version() -> VersionResponse:
    # Railway sets this on every deploy from GitHub. CI compares it with the pushed commit.
    return VersionResponse(commit=os.environ.get("RAILWAY_GIT_COMMIT_SHA"))
