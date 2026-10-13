from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.campaigns.store import CampaignStore, PostgresCampaignStore
from app.database import get_engine, get_session

CampaignStoreScope = Callable[[], AbstractAsyncContextManager[CampaignStore]]


def get_campaign_store(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CampaignStore:
    return PostgresCampaignStore(session)


def get_campaign_store_scope() -> CampaignStoreScope:
    """A store with its own session, for work that outlives the request that started it."""

    @asynccontextmanager
    async def scope() -> AsyncIterator[CampaignStore]:
        async with async_sessionmaker(get_engine(), expire_on_commit=False)() as session:
            yield PostgresCampaignStore(session)

    return scope
