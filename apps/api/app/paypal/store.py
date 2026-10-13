from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Protocol, cast
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.offers import DEFAULT_OFFER_ID
from app.paypal.gateway import Offer, PayPalCapture


@dataclass(frozen=True)
class RevenueSummary:
    completed_orders: int
    started_orders: int
    gross_revenue: Decimal
    currency: str
    latest_capture_id: str | None


@dataclass(frozen=True)
class WebhookProof:
    event_id: str
    event_type: str
    received_at: datetime


@dataclass(frozen=True)
class Receipt:
    """A completed order with the post it came from and the verified PayPal events about it."""

    paypal_order_id: str
    paypal_capture_id: str
    content_id: UUID
    amount: Decimal
    currency: str
    ordered_at: datetime
    captured_at: datetime
    webhooks: list[WebhookProof] = field(default_factory=list)
    # The catalog slug of what the customer bought.
    offer_id: str = DEFAULT_OFFER_ID


@dataclass(frozen=True)
class Checkout:
    """A PayPal order a buyer started from a post, paid or not."""

    paypal_order_id: str
    content_id: UUID
    offer_id: str
    amount: Decimal
    currency: str
    completed: bool
    ordered_at: datetime
    captured_at: datetime | None


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

    async def order_workspace(self, *, paypal_order_id: str) -> UUID | None: ...

    async def record_webhook(
        self,
        *,
        event_id: str,
        event_type: str,
        resource: dict[str, Any],
    ) -> bool: ...

    async def revenue_summary(self, *, campaign_id: UUID) -> RevenueSummary: ...

    async def receipts(self, *, campaign_id: UUID) -> list[Receipt]: ...

    async def checkouts(self, *, campaign_id: UUID) -> list[Checkout]: ...


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
                    insert into growthreceipt.workspaces (id, name)
                    values (:workspace_id, 'GrowthReceipt Demo')
                    on conflict (id) do nothing
                    """
                ),
                {"workspace_id": workspace_id},
            )
            offer_id = await self._session.scalar(
                text(
                    """
                    insert into growthreceipt.offers (
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
                    insert into growthreceipt.payment_orders (
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
                        update growthreceipt.payment_orders
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
                      select 1 from growthreceipt.payment_orders
                      where workspace_id = :workspace_id
                        and paypal_order_id = :paypal_order_id
                    )
                    """
                ),
                {"workspace_id": workspace_id, "paypal_order_id": paypal_order_id},
            )
        return bool(found)

    async def order_workspace(self, *, paypal_order_id: str) -> UUID | None:
        async with self._session.begin():
            workspace_id: UUID | None = await self._session.scalar(
                text(
                    """
                    select workspace_id from growthreceipt.payment_orders
                    where paypal_order_id = :paypal_order_id
                    """
                ),
                {"paypal_order_id": paypal_order_id},
            )
        return workspace_id

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
                        insert into growthreceipt.paypal_webhook_events (
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
                    select count(*) filter (where status = 'completed')::int
                             as completed_orders,
                           count(*)::int as started_orders,
                           coalesce(sum(amount) filter (where status = 'completed'), 0)
                             as gross_revenue,
                           coalesce(max(currency) filter (where status = 'completed'), 'USD')
                             as currency,
                           (array_agg(paypal_capture_id order by captured_at desc)
                             filter (where status = 'completed'))[1] as latest_capture_id
                    from growthreceipt.payment_orders
                    where campaign_id = :campaign_id
                    """
                ),
                {"campaign_id": campaign_id},
            )
            row = result.one()
        return RevenueSummary(
            completed_orders=row.completed_orders,
            started_orders=row.started_orders,
            gross_revenue=Decimal(row.gross_revenue),
            currency=row.currency,
            latest_capture_id=row.latest_capture_id,
        )

    async def receipts(self, *, campaign_id: UUID) -> list[Receipt]:
        # Only verified events are stored, so a match here is a signature checked delivery.
        # Order events carry the order id, capture events the capture id and the order id.
        async with self._session.begin():
            result = await self._session.execute(
                text(
                    """
                    select o.paypal_order_id, o.paypal_capture_id, o.content_id,
                           o.amount, o.currency, o.created_at, o.captured_at,
                           f.slug as offer_slug,
                           coalesce((
                             select json_agg(json_build_object(
                                      'event_id', e.id,
                                      'event_type', e.event_type,
                                      'received_at', e.received_at
                                    ) order by e.received_at)
                             from growthreceipt.paypal_webhook_events e
                             where e.resource->>'id' in (o.paypal_order_id, o.paypal_capture_id)
                                or e.resource #>> '{supplementary_data,related_ids,order_id}'
                                   = o.paypal_order_id
                           ), '[]'::json) as webhooks
                    from growthreceipt.payment_orders o
                    join growthreceipt.offers f on f.id = o.offer_id
                    where o.campaign_id = :campaign_id and o.status = 'completed'
                    order by o.captured_at desc
                    limit 50
                    """
                ),
                {"campaign_id": campaign_id},
            )
            rows = result.all()
        return [
            Receipt(
                paypal_order_id=row.paypal_order_id,
                paypal_capture_id=row.paypal_capture_id,
                content_id=row.content_id,
                amount=Decimal(row.amount),
                currency=row.currency,
                ordered_at=row.created_at,
                captured_at=row.captured_at,
                offer_id=row.offer_slug,
                webhooks=[
                    WebhookProof(
                        event_id=event["event_id"],
                        event_type=event["event_type"],
                        received_at=datetime.fromisoformat(event["received_at"]),
                    )
                    for event in _json_list(row.webhooks)
                ],
            )
            for row in rows
        ]

    async def checkouts(self, *, campaign_id: UUID) -> list[Checkout]:
        async with self._session.begin():
            result = await self._session.execute(
                text(
                    """
                    select o.paypal_order_id, o.content_id, f.slug as offer_slug,
                           o.amount, o.currency, o.status, o.created_at, o.captured_at
                    from growthreceipt.payment_orders o
                    join growthreceipt.offers f on f.id = o.offer_id
                    where o.campaign_id = :campaign_id
                    order by o.created_at
                    limit 2000
                    """
                ),
                {"campaign_id": campaign_id},
            )
            rows = result.all()
        return [
            Checkout(
                paypal_order_id=row.paypal_order_id,
                content_id=row.content_id,
                offer_id=row.offer_slug,
                amount=Decimal(row.amount),
                currency=row.currency,
                completed=row.status == "completed",
                ordered_at=row.created_at,
                captured_at=row.captured_at,
            )
            for row in rows
        ]


def _json_list(value: Any) -> list[dict[str, Any]]:
    # The asyncpg dialect decodes json, but a plain driver hands back text.
    return cast(list[dict[str, Any]], json.loads(value) if isinstance(value, str) else value)


class FakePaymentStore:
    def __init__(self) -> None:
        self.orders: dict[str, tuple[UUID, UUID, UUID]] = {}
        self.captures: dict[str, PayPalCapture] = {}
        self.webhook_ids: set[str] = set()
        self.webhooks: list[tuple[WebhookProof, dict[str, Any]]] = []
        self.ordered_at: dict[str, datetime] = {}
        self.captured_at: dict[str, datetime] = {}
        self.offer_ids: dict[str, str] = {}
        self.offer_prices: dict[str, tuple[Decimal, str]] = {}

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
        del idempotency_key
        self.orders[paypal_order_id] = (workspace_id, campaign_id, content_id)
        self.offer_ids[paypal_order_id] = offer.id
        self.offer_prices[paypal_order_id] = (Decimal(offer.amount), offer.currency)
        self.ordered_at[paypal_order_id] = datetime.now(UTC)

    async def owns_order(self, *, workspace_id: UUID, paypal_order_id: str) -> bool:
        order = self.orders.get(paypal_order_id)
        return order is not None and order[0] == workspace_id

    async def order_workspace(self, *, paypal_order_id: str) -> UUID | None:
        order = self.orders.get(paypal_order_id)
        return order[0] if order else None

    async def record_capture(self, capture: PayPalCapture) -> None:
        if capture.order_id not in self.orders:
            raise LookupError("PayPal order attribution was not found")
        self.captures[capture.order_id] = capture
        self.captured_at[capture.order_id] = datetime.now(UTC)

    async def record_webhook(
        self,
        *,
        event_id: str,
        event_type: str,
        resource: dict[str, Any],
    ) -> bool:
        is_new = event_id not in self.webhook_ids
        if is_new:
            proof = WebhookProof(
                event_id=event_id, event_type=event_type, received_at=datetime.now(UTC)
            )
            self.webhooks.append((proof, resource))
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
            started_orders=sum(1 for order in self.orders.values() if order[1] == campaign_id),
            gross_revenue=gross,
            currency=captures[-1].currency if captures else "USD",
            latest_capture_id=captures[-1].capture_id if captures else None,
        )

    async def receipts(self, *, campaign_id: UUID) -> list[Receipt]:
        receipts = []
        for order_id, capture in self.captures.items():
            _workspace_id, order_campaign_id, content_id = self.orders[order_id]
            if order_campaign_id != campaign_id:
                continue
            related = {order_id, capture.capture_id}
            webhooks = [
                proof
                for proof, resource in self.webhooks
                if resource.get("id") in related
                or resource.get("supplementary_data", {}).get("related_ids", {}).get("order_id")
                == order_id
            ]
            receipts.append(
                Receipt(
                    paypal_order_id=order_id,
                    paypal_capture_id=capture.capture_id,
                    content_id=content_id,
                    amount=Decimal(capture.amount),
                    currency=capture.currency,
                    ordered_at=self.ordered_at[order_id],
                    captured_at=self.captured_at[order_id],
                    webhooks=webhooks,
                    offer_id=self.offer_ids[order_id],
                )
            )
        return sorted(receipts, key=lambda receipt: receipt.captured_at, reverse=True)

    async def checkouts(self, *, campaign_id: UUID) -> list[Checkout]:
        checkouts = []
        for order_id, (_workspace_id, order_campaign_id, content_id) in self.orders.items():
            if order_campaign_id != campaign_id:
                continue
            capture = self.captures.get(order_id)
            amount, currency = self.offer_prices[order_id]
            checkouts.append(
                Checkout(
                    paypal_order_id=order_id,
                    content_id=content_id,
                    offer_id=self.offer_ids[order_id],
                    amount=Decimal(capture.amount) if capture else amount,
                    currency=capture.currency if capture else currency,
                    completed=capture is not None,
                    ordered_at=self.ordered_at[order_id],
                    captured_at=self.captured_at.get(order_id),
                )
            )
        return checkouts
