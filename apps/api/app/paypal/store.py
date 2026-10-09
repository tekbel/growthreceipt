from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Protocol, cast
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.paypal.gateway import Offer, PayPalCapture


@dataclass(frozen=True)
class RevenueSummary:
    completed_orders: int
    gross_revenue: Decimal
    currency: str
    latest_capture_id: str | None


class PaymentStore(Protocol):
    async def record_order(
        self,
        *,
        workspace_id: UUID,
        offer: Offer,
        campaign_id: UUID,
        content_id: UUID,
        paypal_order_id: str,
        idempotency_key: UUID,
    ) -> None: ...

    async def record_capture(self, capture: PayPalCapture) -> None: ...

    async def owns_order(self, *, workspace_id: UUID, paypal_order_id: str) -> bool: ...

    async def record_webhook(
        self,
        *,
        event_id: str,
        event_type: str,
        resource: dict[str, Any],
    ) -> bool: ...

    async def revenue_summary(self, *, campaign_id: UUID) -> RevenueSummary: ...


class PostgresPaymentStore:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def record_order(
        self,
        *,
        workspace_id: UUID,
        offer: Offer,
        campaign_id: UUID,
        content_id: UUID,
        paypal_order_id: str,
        idempotency_key: UUID,
    ) -> None:
        async with self._session.begin():
            await self._session.execute(
                text(
                    """
                    insert into public.workspaces (id, name)
                    values (:workspace_id, 'GrowthReceipt Demo')
                    on conflict (id) do nothing
                    """
                ),
                {"workspace_id": workspace_id},
            )
            offer_id = await self._session.scalar(
                text(
                    """
                    insert into public.offers (
                      workspace_id, slug, name, description, amount, currency
                    ) values (
                      :workspace_id, :slug, :name, :description, :amount, :currency
                    )
                    on conflict (workspace_id, slug) do update set
                      name = excluded.name,
                      description = excluded.description,
                      amount = excluded.amount,
                      currency = excluded.currency,
                      updated_at = now()
                    returning id
                    """
                ),
                {
                    "workspace_id": workspace_id,
                    "slug": offer.id,
                    "name": offer.name,
                    "description": offer.description,
                    "amount": offer.amount,
                    "currency": offer.currency,
                },
            )
            await self._session.execute(
                text(
                    """
                    insert into public.payment_orders (
                      workspace_id, offer_id, campaign_id, content_id,
                      paypal_order_id, idempotency_key, status, amount, currency
                    ) values (
                      :workspace_id, :offer_id, :campaign_id, :content_id,
                      :paypal_order_id, :idempotency_key, 'created', :amount, :currency
                    )
                    on conflict (paypal_order_id) do nothing
                    """
                ),
                {
                    "workspace_id": workspace_id,
                    "offer_id": offer_id,
                    "campaign_id": campaign_id,
                    "content_id": content_id,
                    "paypal_order_id": paypal_order_id,
                    "idempotency_key": idempotency_key,
                    "amount": offer.amount,
                    "currency": offer.currency,
                },
            )

    async def record_capture(self, capture: PayPalCapture) -> None:
        async with self._session.begin():
            result = cast(
                CursorResult[Any],
                await self._session.execute(
                    text(
                        """
                        update public.payment_orders
                        set paypal_capture_id = :capture_id,
                            status = 'completed',
                            amount = :amount,
                            currency = :currency,
                            captured_at = now(),
                            updated_at = now()
                        where paypal_order_id = :order_id
                        """
                    ),
                    {
                        "capture_id": capture.capture_id,
                        "amount": Decimal(capture.amount),
                        "currency": capture.currency,
                        "order_id": capture.order_id,
                    },
                ),
            )
            if result.rowcount != 1:
                raise LookupError("PayPal order attribution was not found")

    async def owns_order(self, *, workspace_id: UUID, paypal_order_id: str) -> bool:
        async with self._session.begin():
            found = await self._session.scalar(
                text(
                    """
                    select exists (
                      select 1 from public.payment_orders
                      where workspace_id = :workspace_id
                        and paypal_order_id = :paypal_order_id
                    )
                    """
                ),
                {"workspace_id": workspace_id, "paypal_order_id": paypal_order_id},
            )
        return bool(found)

    async def record_webhook(
        self,
        *,
        event_id: str,
        event_type: str,
        resource: dict[str, Any],
    ) -> bool:
        async with self._session.begin():
            result = cast(
                CursorResult[Any],
                await self._session.execute(
                    text(
                        """
                        insert into public.paypal_webhook_events (
                          id, event_type, resource, processed_at
                        )
                        values (:event_id, :event_type, cast(:resource as jsonb), now())
                        on conflict (id) do nothing
                        """
                    ),
                    {
                        "event_id": event_id,
                        "event_type": event_type,
                        "resource": json.dumps(resource),
                    },
                ),
            )
        return result.rowcount == 1

    async def revenue_summary(self, *, campaign_id: UUID) -> RevenueSummary:
        async with self._session.begin():
            result = await self._session.execute(
                text(
                    """
                    select count(*)::int as completed_orders,
                           coalesce(sum(amount), 0) as gross_revenue,
                           coalesce(max(currency), 'USD') as currency,
                           (array_agg(paypal_capture_id order by captured_at desc))[1]
                             as latest_capture_id
                    from public.payment_orders
                    where campaign_id = :campaign_id and status = 'completed'
                    """
                ),
                {"campaign_id": campaign_id},
            )
            row = result.one()
        return RevenueSummary(
            completed_orders=row.completed_orders,
            gross_revenue=Decimal(row.gross_revenue),
            currency=row.currency,
            latest_capture_id=row.latest_capture_id,
        )


class FakePaymentStore:
    def __init__(self) -> None:
        self.orders: dict[str, tuple[UUID, UUID, UUID]] = {}
        self.captures: dict[str, PayPalCapture] = {}
        self.webhook_ids: set[str] = set()

    async def record_order(
        self,
        *,
        workspace_id: UUID,
        offer: Offer,
        campaign_id: UUID,
        content_id: UUID,
        paypal_order_id: str,
        idempotency_key: UUID,
    ) -> None:
        del offer, idempotency_key
        self.orders[paypal_order_id] = (workspace_id, campaign_id, content_id)

    async def owns_order(self, *, workspace_id: UUID, paypal_order_id: str) -> bool:
        order = self.orders.get(paypal_order_id)
        return order is not None and order[0] == workspace_id

    async def record_capture(self, capture: PayPalCapture) -> None:
        if capture.order_id not in self.orders:
            raise LookupError("PayPal order attribution was not found")
        self.captures[capture.order_id] = capture

    async def record_webhook(
        self,
        *,
        event_id: str,
        event_type: str,
        resource: dict[str, Any],
    ) -> bool:
        del event_type, resource
        is_new = event_id not in self.webhook_ids
        self.webhook_ids.add(event_id)
        return is_new

    async def revenue_summary(self, *, campaign_id: UUID) -> RevenueSummary:
        captures = [
            capture
            for order_id, capture in self.captures.items()
            if self.orders[order_id][1] == campaign_id
        ]
        gross = sum((Decimal(capture.amount) for capture in captures), Decimal("0"))
        return RevenueSummary(
            completed_orders=len(captures),
            gross_revenue=gross,
            currency=captures[-1].currency if captures else "USD",
            latest_capture_id=captures[-1].capture_id if captures else None,
        )
