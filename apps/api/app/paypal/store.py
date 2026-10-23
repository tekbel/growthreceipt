from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Protocol, cast
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.offers import DEFAULT_OFFER_ID
from app.paypal.gateway import Offer, PayPalCapture, PayPalRefund


def payer_hash(workspace_id: UUID, payer_id: str) -> str:
    """Counts a buyer without storing who they are. Salted per workspace, so the same buyer cannot
    be linked across workspaces. Postgres computes the same value in record_capture."""
    return hashlib.sha256(f"{workspace_id}:{payer_id}".encode()).hexdigest()


@dataclass(frozen=True)
class RevenueSummary:
    # Orders and revenue that still count, after completed refunds.
    completed_orders: int
    started_orders: int
    gross_revenue: Decimal
    currency: str
    latest_capture_id: str | None
    refunded_orders: int = 0
    refunded_revenue: Decimal = Decimal("0")
    # Distinct buyers behind the counted orders, and how many of them bought more than once.
    # Orders captured before payer hashes were stored are not counted here.
    unique_customers: int = 0
    repeat_customers: int = 0


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
    # Completed refunds of this capture. A fully refunded receipt is no longer revenue.
    refunded_amount: Decimal = Decimal("0")
    payer_hash: str | None = None

    @property
    def net_amount(self) -> Decimal:
        return self.amount - self.refunded_amount

    @property
    def counts(self) -> bool:
        return self.net_amount > 0


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
    refunded_amount: Decimal = Decimal("0")


@dataclass(frozen=True)
class RefundTarget:
    """A captured order that can still be refunded."""

    paypal_capture_id: str
    amount: Decimal
    refunded_amount: Decimal


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

    async def record_refund(self, refund: PayPalRefund) -> bool: ...

    async def refund_target(
        self, *, workspace_id: UUID, paypal_order_id: str
    ) -> RefundTarget | None: ...

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
                            payer_hash = case when cast(:payer_id as text) is null then null
                              else encode(sha256(convert_to(
                                workspace_id::text || ':' || cast(:payer_id as text), 'UTF8'
                              )), 'hex')
                            end,
                            captured_at = now(),
                            updated_at = now()
                        where paypal_order_id = :order_id
                        """
                    ),
                    {
                        "capture_id": capture.capture_id,
                        "amount": Decimal(capture.amount),
                        "currency": capture.currency,
                        "payer_id": capture.payer_id,
                        "order_id": capture.order_id,
                    },
                ),
            )
            if result.rowcount != 1:
                raise LookupError("PayPal order attribution was not found")

    async def record_refund(self, refund: PayPalRefund) -> bool:
        """Stores or updates a refund. False when the capture is not one of ours."""
        async with self._session.begin():
            result = cast(
                CursorResult[Any],
                await self._session.execute(
                    text(
                        """
                        insert into growthreceipt.payment_refunds (
                          id, payment_order_id, status, amount, currency
                        )
                        select :refund_id, o.id, :status, :amount, :currency
                        from growthreceipt.payment_orders o
                        where o.paypal_capture_id = :capture_id
                        on conflict (id) do update set
                          status = excluded.status,
                          updated_at = now()
                        """
                    ),
                    {
                        "refund_id": refund.refund_id,
                        "status": refund.status,
                        "amount": Decimal(refund.amount),
                        "currency": refund.currency,
                        "capture_id": refund.capture_id,
                    },
                ),
            )
        return result.rowcount == 1

    async def refund_target(
        self, *, workspace_id: UUID, paypal_order_id: str
    ) -> RefundTarget | None:
        async with self._session.begin():
            result = await self._session.execute(
                text(
                    """
                    select o.paypal_capture_id, o.amount,
                           coalesce((
                             select sum(r.amount) from growthreceipt.payment_refunds r
                             where r.payment_order_id = o.id and r.status = 'COMPLETED'
                           ), 0) as refunded_amount
                    from growthreceipt.payment_orders o
                    where o.workspace_id = :workspace_id
                      and o.paypal_order_id = :paypal_order_id
                      and o.status = 'completed'
                    """
                ),
                {"workspace_id": workspace_id, "paypal_order_id": paypal_order_id},
            )
            row = result.one_or_none()
        if row is None:
            return None
        return RefundTarget(
            paypal_capture_id=row.paypal_capture_id,
            amount=Decimal(row.amount),
            refunded_amount=Decimal(row.refunded_amount),
        )

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
                    with o as (
                      select o.*, coalesce((
                               select sum(r.amount) from growthreceipt.payment_refunds r
                               where r.payment_order_id = o.id and r.status = 'COMPLETED'
                             ), 0) as refunded
                      from growthreceipt.payment_orders o
                      where o.campaign_id = :campaign_id
                    )
                    select count(*) filter (where status = 'completed' and amount > refunded)::int
                             as completed_orders,
                           count(*)::int as started_orders,
                           coalesce(sum(amount - refunded) filter (where status = 'completed'), 0)
                             as gross_revenue,
                           coalesce(max(currency) filter (where status = 'completed'), 'USD')
                             as currency,
                           (array_agg(paypal_capture_id order by captured_at desc)
                             filter (where status = 'completed' and amount > refunded))[1]
                             as latest_capture_id,
                           count(*) filter (where status = 'completed' and refunded > 0)::int
                             as refunded_orders,
                           coalesce(sum(refunded) filter (where status = 'completed'), 0)
                             as refunded_revenue,
                           count(distinct payer_hash)
                             filter (where status = 'completed' and amount > refunded)::int
                             as unique_customers,
                           (select count(*) from (
                              select payer_hash from o
                              where status = 'completed' and amount > refunded
                                and payer_hash is not null
                              group by payer_hash having count(*) > 1
                            ) repeat)::int as repeat_customers
                    from o
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
            refunded_orders=row.refunded_orders,
            refunded_revenue=Decimal(row.refunded_revenue),
            unique_customers=row.unique_customers,
            repeat_customers=row.repeat_customers,
        )

    async def receipts(self, *, campaign_id: UUID) -> list[Receipt]:
        # Only verified events are stored, so a match here is a signature checked delivery.
        # Order events carry the order id, capture events the capture id and the order id,
        # refund events the refund id.
        async with self._session.begin():
            result = await self._session.execute(
                text(
                    """
                    select o.paypal_order_id, o.paypal_capture_id, o.content_id,
                           o.amount, o.currency, o.created_at, o.captured_at, o.payer_hash,
                           f.slug as offer_slug,
                           coalesce((
                             select sum(r.amount) from growthreceipt.payment_refunds r
                             where r.payment_order_id = o.id and r.status = 'COMPLETED'
                           ), 0) as refunded_amount,
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
                                or e.resource->>'id' in (
                                   select r.id from growthreceipt.payment_refunds r
                                   where r.payment_order_id = o.id
                                )
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
                refunded_amount=Decimal(row.refunded_amount),
                payer_hash=row.payer_hash,
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
                           o.amount, o.currency, o.status, o.created_at, o.captured_at,
                           coalesce((
                             select sum(r.amount) from growthreceipt.payment_refunds r
                             where r.payment_order_id = o.id and r.status = 'COMPLETED'
                           ), 0) as refunded_amount
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
                refunded_amount=Decimal(row.refunded_amount),
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
        self.refunds: dict[str, PayPalRefund] = {}

    def _refunded(self, order_id: str) -> Decimal:
        capture = self.captures.get(order_id)
        if capture is None:
            return Decimal("0")
        return sum(
            (
                Decimal(refund.amount)
                for refund in self.refunds.values()
                if refund.capture_id == capture.capture_id and refund.status == "COMPLETED"
            ),
            Decimal("0"),
        )

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

    async def record_refund(self, refund: PayPalRefund) -> bool:
        if not any(capture.capture_id == refund.capture_id for capture in self.captures.values()):
            return False
        self.refunds[refund.refund_id] = refund
        return True

    async def refund_target(
        self, *, workspace_id: UUID, paypal_order_id: str
    ) -> RefundTarget | None:
        order = self.orders.get(paypal_order_id)
        capture = self.captures.get(paypal_order_id)
        if order is None or order[0] != workspace_id or capture is None:
            return None
        return RefundTarget(
            paypal_capture_id=capture.capture_id,
            amount=Decimal(capture.amount),
            refunded_amount=self._refunded(paypal_order_id),
        )

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
            (capture, self._refunded(order_id))
            for order_id, capture in self.captures.items()
            if self.orders[order_id][1] == campaign_id
        ]
        counted = [capture for capture, refunded in captures if Decimal(capture.amount) > refunded]
        buyers = Counter(capture.payer_id for capture in counted if capture.payer_id)
        refunded_total = sum((refunded for _capture, refunded in captures), Decimal("0"))
        gross = sum((Decimal(capture.amount) for capture, _ in captures), Decimal("0"))
        return RevenueSummary(
            completed_orders=len(counted),
            started_orders=sum(1 for order in self.orders.values() if order[1] == campaign_id),
            gross_revenue=gross - refunded_total,
            currency=captures[-1][0].currency if captures else "USD",
            latest_capture_id=counted[-1].capture_id if counted else None,
            refunded_orders=sum(1 for _capture, refunded in captures if refunded > 0),
            refunded_revenue=refunded_total,
            unique_customers=len(buyers),
            repeat_customers=sum(1 for count in buyers.values() if count > 1),
        )

    async def receipts(self, *, campaign_id: UUID) -> list[Receipt]:
        receipts = []
        for order_id, capture in self.captures.items():
            _workspace_id, order_campaign_id, content_id = self.orders[order_id]
            if order_campaign_id != campaign_id:
                continue
            related = {order_id, capture.capture_id} | {
                refund.refund_id
                for refund in self.refunds.values()
                if refund.capture_id == capture.capture_id
            }
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
                    refunded_amount=self._refunded(order_id),
                    payer_hash=payer_hash(_workspace_id, capture.payer_id)
                    if capture.payer_id
                    else None,
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
                    refunded_amount=self._refunded(order_id),
                )
            )
        return checkouts
