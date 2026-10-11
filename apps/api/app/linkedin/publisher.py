import asyncio
import logging
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import get_settings
from app.linkedin.client import HttpLinkedInClient, LinkedInClient, LinkedInError, post_url
from app.linkedin.crypto import TokenCipher
from app.linkedin.store import LinkedInStore, PostgresLinkedInStore, Trigger

logger = logging.getLogger(__name__)


class NotPublishable(Exception):
    """The post is not an approved, unpublished LinkedIn post in this workspace."""


def get_linkedin_client() -> LinkedInClient:
    settings = get_settings()
    if not settings.linkedin_configured:
        raise HTTPException(status_code=503, detail="LinkedIn publishing is not configured")
    assert settings.linkedin_client_id and settings.linkedin_client_secret
    return HttpLinkedInClient(
        client_id=settings.linkedin_client_id,
        client_secret=settings.linkedin_client_secret.get_secret_value(),
    )


def get_token_cipher() -> TokenCipher:
    key = get_settings().linkedin_token_key
    if key is None:
        raise HTTPException(status_code=503, detail="LinkedIn publishing is not configured")
    return TokenCipher(key.get_secret_value())


Client = Annotated[LinkedInClient, Depends(get_linkedin_client)]
Cipher = Annotated[TokenCipher, Depends(get_token_cipher)]


def buy_link(post_id: UUID) -> str:
    return f"{str(get_settings().web_origin).rstrip('/')}/buy/{post_id}"


async def publish_post(
    *,
    store: LinkedInStore,
    client: LinkedInClient,
    cipher: TokenCipher,
    workspace_id: UUID,
    post_id: UUID,
    trigger: Trigger,
) -> str:
    """Posts one approved LinkedIn post with its attributed buy link and returns its URL."""
    connection = await store.get(workspace_id)
    if connection is None:
        raise LinkedInError("Connect LinkedIn in Integrations first.")
    if connection.expires_at <= datetime.now(UTC):
        raise LinkedInError("The LinkedIn connection expired. Reconnect LinkedIn to post.")
    access_token = cipher.decrypt(connection.access_token_encrypted)
    if access_token is None:
        raise LinkedInError("The LinkedIn connection can no longer be read. Reconnect LinkedIn.")
    claimed = await store.claim(workspace_id=workspace_id, post_id=post_id)
    if claimed is None:
        raise NotPublishable
    link = buy_link(post_id)
    try:
        urn = await client.publish(
            access_token=access_token,
            author=connection.member_urn,
            text=f"{claimed.content}\n\n{claimed.call_to_action} {link}",
            link=link,
            title=claimed.product_name,
        )
    except Exception as error:
        message = (
            str(error) if isinstance(error, LinkedInError) else "LinkedIn could not be reached."
        )
        await store.release(claimed, error=message, trigger=trigger)
        raise LinkedInError(message) from error
    url = post_url(urn)
    await store.mark_published(claimed, url=url, urn=urn, trigger=trigger)
    return url


async def publish_due_posts(
    store: LinkedInStore, client: LinkedInClient, cipher: TokenCipher, now: datetime
) -> int:
    """Publishes every scheduled post whose day has come. Failures are recorded as events."""
    published = 0
    for workspace_id, post_id in await store.due(now):
        try:
            await publish_post(
                store=store,
                client=client,
                cipher=cipher,
                workspace_id=workspace_id,
                post_id=post_id,
                trigger="scheduled",
            )
            published += 1
        except (LinkedInError, NotPublishable):
            continue
    return published


async def run_scheduled_publishing(factory: async_sessionmaker, interval: int) -> None:
    """Runs in the API process. The claim column keeps a second replica from double posting."""
    while True:
        try:
            async with factory() as session:
                count = await publish_due_posts(
                    PostgresLinkedInStore(session),
                    get_linkedin_client(),
                    get_token_cipher(),
                    datetime.now(UTC),
                )
            if count:
                logger.info("Published %s scheduled LinkedIn posts", count)
        except Exception:
            logger.exception("Scheduled LinkedIn publishing failed")
        await asyncio.sleep(interval)
