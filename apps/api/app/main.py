from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routes.agents import router as agents_router
from app.routes.auth import router as auth_router
from app.routes.campaigns import router as campaigns_router
from app.routes.health import router as health_router
from app.routes.paypal import router as paypal_router
from app.routes.public import router as public_router

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0")
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
app.include_router(campaigns_router)
app.include_router(paypal_router)
app.include_router(public_router)


@app.get("/v1")
async def api_root() -> dict[str, str]:
    return {"name": settings.app_name, "version": app.version}
