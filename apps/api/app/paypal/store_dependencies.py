from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.paypal.store import PaymentStore, PostgresPaymentStore


def get_payment_store(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PaymentStore:
    return PostgresPaymentStore(session)
