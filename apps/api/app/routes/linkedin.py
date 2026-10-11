from contextlib import suppress
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.config import get_settings
from app.linkedin.client import LinkedInError
from app.linkedin.publisher import Cipher, Client, NotPublishable, publish_post
from app.linkedin.store import LinkedInConnection, LinkedInStore, get_linkedin_store
from app.workspace_settings import WorkspaceSettingsStore, get_workspace_settings_store
from app.workspaces import WorkspaceId

router = APIRouter(prefix="/v1/integrations/linkedin", tags=["linkedin"])

Store = Annotated[LinkedInStore, Depends(get_linkedin_store)]
SettingsStore = Annotated[WorkspaceSettingsStore, Depends(get_workspace_settings_store)]


class LinkedInStatus(BaseModel):
    configured: bool
    connected: bool
    member_name: str | None = None
    expires_at: datetime | None = None
    expired: bool = False
    auto_publish: bool = False


class AuthorizeResponse(BaseModel):
    url: str


class ConnectRequest(BaseModel):
    code: str = Field(min_length=1, max_length=2_000)
    state: str = Field(min_length=1, max_length=1_000)


class AutoPublishRequest(BaseModel):
    auto_publish: bool


class PublishResponse(BaseModel):
    url: str


def _status(connection: LinkedInConnection | None) -> LinkedInStatus:
    configured = get_settings().linkedin_configured
    if connection is None:
        return LinkedInStatus(configured=configured, connected=False)
    return LinkedInStatus(
        configured=configured,
        connected=True,
        member_name=connection.member_name,
        expires_at=connection.expires_at,
        expired=connection.expires_at <= datetime.now(UTC),
        auto_publish=connection.auto_publish,
    )


@router.get("", response_model=LinkedInStatus)
async def linkedin_status(workspace_id: WorkspaceId, store: Store) -> LinkedInStatus:
    return _status(await store.get(workspace_id))


@router.post("/authorize", response_model=AuthorizeResponse)
async def authorize(workspace_id: WorkspaceId, client: Client, cipher: Cipher) -> AuthorizeResponse:
    state = cipher.sign_state(workspace_id)
    url = client.authorize_url(state=state, redirect_uri=get_settings().linkedin_redirect_uri)
    return AuthorizeResponse(url=url)


@router.post("/connect", response_model=LinkedInStatus)
async def connect(
    request: ConnectRequest,
    workspace_id: WorkspaceId,
    store: Store,
    client: Client,
    cipher: Cipher,
) -> LinkedInStatus:
    # The code comes back through the signed-in browser, and the state must name this
    # same workspace, so a forged callback cannot attach someone else's LinkedIn.
    if not cipher.state_matches(request.state, workspace_id):
        raise HTTPException(status_code=400, detail="This LinkedIn sign in expired. Connect again.")
    try:
        token = await client.exchange_code(
            code=request.code, redirect_uri=get_settings().linkedin_redirect_uri
        )
        member = await client.member(access_token=token.access_token)
    except LinkedInError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    await store.save(
        LinkedInConnection(
            workspace_id=workspace_id,
            member_urn=member.urn,
            member_name=member.name,
            access_token_encrypted=cipher.encrypt(token.access_token),
            expires_at=datetime.now(UTC) + timedelta(seconds=token.expires_in),
        )
    )
    return _status(await store.get(workspace_id))


@router.patch("", response_model=LinkedInStatus)
async def set_auto_publish(
    request: AutoPublishRequest,
    workspace_id: WorkspaceId,
    store: Store,
    settings_store: SettingsStore,
) -> LinkedInStatus:
    if await store.get(workspace_id) is None:
        raise HTTPException(status_code=404, detail="Connect LinkedIn first")
    # Turning it on never sends posts from earlier days, only from today in the workspace zone.
    workspace = await settings_store.get(workspace_id)
    zone = ZoneInfo(workspace.timezone if workspace and workspace.timezone else "UTC")
    await store.set_auto_publish(
        workspace_id, enabled=request.auto_publish, since=datetime.now(zone).date()
    )
    return _status(await store.get(workspace_id))


@router.delete("", response_model=LinkedInStatus)
async def disconnect(
    workspace_id: WorkspaceId, store: Store, client: Client, cipher: Cipher
) -> LinkedInStatus:
    connection = await store.get(workspace_id)
    if connection is not None:
        token = cipher.decrypt(connection.access_token_encrypted)
        if token:
            # Revoking is best effort. The stored token is deleted either way.
            with suppress(Exception):
                await client.revoke(access_token=token)
        await store.delete(workspace_id)
    return _status(None)


@router.post("/posts/{post_id}/publish", response_model=PublishResponse)
async def publish_now(
    post_id: UUID, workspace_id: WorkspaceId, store: Store, client: Client, cipher: Cipher
) -> PublishResponse:
    try:
        url = await publish_post(
            store=store,
            client=client,
            cipher=cipher,
            workspace_id=workspace_id,
            post_id=post_id,
            trigger="manual",
        )
    except NotPublishable as error:
        raise HTTPException(
            status_code=409,
            detail="Only approved LinkedIn posts that are not yet published can be posted.",
        ) from error
    except LinkedInError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return PublishResponse(url=url)
