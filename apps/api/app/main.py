from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routes.agents import router as agents_router
from app.routes.campaigns import router as campaigns_router
from app.routes.health import router as health_router
from app.routes.paypal import router as paypal_router

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0")
allowed_origins = {str(settings.web_origin).rstrip("/")}
if settings.app_env == "local":
    allowed_origins.update({"http://localhost:3000", "http://127.0.0.1:3000"})
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(allowed_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(agents_router)
app.include_router(campaigns_router)
app.include_router(paypal_router)


@app.get("/v1")
async def api_root() -> dict[str, str]:
    return {"name": settings.app_name, "version": app.version}
