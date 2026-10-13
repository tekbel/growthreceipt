import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import get_settings
from app.database import get_engine
from app.jobs.agent_jobs import stop_running
from app.linkedin.publisher import run_scheduled_publishing
from app.routes.agent_jobs import router as agent_jobs_router
from app.routes.agents import router as agents_router
from app.routes.auth import router as auth_router
from app.routes.campaigns import router as campaigns_router
from app.routes.health import router as health_router
from app.routes.linkedin import router as linkedin_router
from app.routes.paypal import router as paypal_router
from app.routes.public import router as public_router
from app.routes.studio import router as studio_router
from app.routes.workspace import router as workspace_router

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    task = None
    if settings.linkedin_configured and settings.app_env != "test":
        factory = async_sessionmaker(get_engine(), expire_on_commit=False)
        task = asyncio.create_task(
            run_scheduled_publishing(factory, settings.linkedin_publish_interval_seconds)
        )
    yield
    if task:
        task.cancel()
    await stop_running()


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
allowed_origins = [str(settings.web_origin).rstrip("/")]
# Locally the web app may run on any port and on either loopback host name.
local_origins = r"http://(localhost|127\.0\.0\.1)(:\d+)?" if settings.app_env == "local" else None
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=local_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(agents_router)
app.include_router(agent_jobs_router)
app.include_router(campaigns_router)
app.include_router(paypal_router)
app.include_router(public_router)
app.include_router(linkedin_router)
app.include_router(workspace_router)
app.include_router(studio_router)


@app.get("/v1")
async def api_root() -> dict[str, str]:
    return {"name": settings.app_name, "version": app.version}
