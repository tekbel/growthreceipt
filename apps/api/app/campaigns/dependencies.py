from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.campaigns.store import CampaignStore, PostgresCampaignStore
from app.database import get_session


def get_campaign_store(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CampaignStore:
    return PostgresCampaignStore(session)
