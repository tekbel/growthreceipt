from dataclasses import dataclass
from typing import Annotated, Protocol
from uuid import UUID

import httpx
from fastapi import Depends, Header, HTTPException

from app.config import Settings, get_settings


@dataclass(frozen=True)
class AuthActor:
    user_id: UUID | None
    email: str | None
    is_anonymous: bool


class AuthGateway(Protocol):
    async def authenticate(self, access_token: str) -> AuthActor: ...


class SupabaseAuthGateway:
    def __init__(self, *, url: str, publishable_key: str) -> None:
        self._url = url.rstrip("/")
        self._publishable_key = publishable_key

    async def authenticate(self, access_token: str) -> AuthActor:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get(
                    f"{self._url}/auth/v1/user",
                    headers={
                        "apikey": self._publishable_key,
                        "Authorization": f"Bearer {access_token}",
                    },
                )
        except httpx.HTTPError as error:
            raise HTTPException(status_code=503, detail="Authentication is unavailable") from error
        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Your session is no longer valid")
        payload = response.json()
        try:
            user_id = UUID(str(payload["id"]))
        except (KeyError, TypeError, ValueError) as error:
            raise HTTPException(
                status_code=401, detail="Your session is no longer valid"
            ) from error
        email = payload.get("email")
        return AuthActor(
            user_id=user_id,
            email=email if isinstance(email, str) else None,
            is_anonymous=bool(payload.get("is_anonymous", False)),
        )


def get_auth_gateway(settings: Annotated[Settings, Depends(get_settings)]) -> AuthGateway | None:
    key = settings.supabase_publishable_key
    if not settings.supabase_url or key is None or not key.get_secret_value():
        return None
    return SupabaseAuthGateway(
        url=settings.supabase_url,
        publishable_key=key.get_secret_value(),
    )


async def get_current_actor(
    settings: Annotated[Settings, Depends(get_settings)],
    gateway: Annotated[AuthGateway | None, Depends(get_auth_gateway)],
    authorization: Annotated[str | None, Header()] = None,
) -> AuthActor:
    if gateway is None:
        if settings.auth_required:
            raise HTTPException(status_code=503, detail="Authentication is not configured")
        return AuthActor(user_id=None, email=None, is_anonymous=True)
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in to continue")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to continue")
    return await gateway.authenticate(token)


CurrentActor = Annotated[AuthActor, Depends(get_current_actor)]
