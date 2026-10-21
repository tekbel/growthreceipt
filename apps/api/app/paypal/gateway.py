from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal
from time import monotonic
from typing import Any, Protocol

import httpx


@dataclass(frozen=True)
class Offer:
    id: str
    name: str
    description: str
    amount: Decimal
    currency: str
    credits: int = 0


@dataclass(frozen=True)
class PayPalOrder:
    id: str
    status: str


@dataclass(frozen=True)
class PayPalCapture:
    order_id: str
    capture_id: str
    status: str
    amount: str
    currency: str
    # PayPal's id for the buyer's account. Stored only as a hash.
    payer_id: str | None = None


@dataclass(frozen=True)
class PayPalRefund:
    refund_id: str
    capture_id: str
    status: str
    amount: str
    currency: str


def refund_capture_id(refund: Mapping[str, Any]) -> str | None:
    """The capture a refund belongs to. PayPal links it as the refund's "up" link."""
    for link in refund.get("links") or []:
        if isinstance(link, dict) and link.get("rel") == "up":
            href = str(link.get("href", ""))
            if "/captures/" in href:
                return href.rstrip("/").rsplit("/", 1)[-1]
    return None


@dataclass(frozen=True)
class PayPalOrderDetails:
    """What PayPal itself reports for an order, read with the Orders API."""

    order_id: str
    status: str
    amount: str | None = None
    currency: str | None = None
    capture_id: str | None = None
    capture_status: str | None = None


class PayPalAPIError(RuntimeError):
    def __init__(self, status_code: int, operation: str) -> None:
        super().__init__(f"PayPal {operation} failed with status {status_code}")
        self.status_code = status_code
        self.operation = operation


class PayPalGateway(Protocol):
    async def create_order(
        self,
        *,
        offer: Offer,
        attribution_id: str,
        request_id: str,
    ) -> PayPalOrder: ...

    async def capture_order(self, *, order_id: str, request_id: str) -> PayPalCapture: ...

    async def get_order(self, *, order_id: str) -> PayPalOrderDetails: ...

    async def refund_capture(self, *, capture_id: str, request_id: str) -> PayPalRefund: ...

    async def verify_webhook(
        self,
        *,
        headers: Mapping[str, str],
        event: dict[str, Any],
    ) -> bool: ...


class HttpPayPalGateway:
    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        webhook_id: str,
        environment: str,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        base_url = (
            "https://api-m.sandbox.paypal.com"
            if environment == "sandbox"
            else "https://api-m.paypal.com"
        )
        self._client_id = client_id
        self._client_secret = client_secret
        self._webhook_id = webhook_id
        self._client = client or httpx.AsyncClient(base_url=base_url, timeout=20.0)
        self._access_token: str | None = None
        self._token_expires_at = 0.0

    async def _token(self) -> str:
        if self._access_token is not None and monotonic() < self._token_expires_at:
            return self._access_token
        response = await self._client.post(
            "/v1/oauth2/token",
            auth=(self._client_id, self._client_secret),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json"},
        )
        if response.status_code != 200:
            raise PayPalAPIError(response.status_code, "authentication")
        payload = response.json()
        self._access_token = str(payload["access_token"])
        expires_in = int(payload.get("expires_in", 300))
        self._token_expires_at = monotonic() + max(30, expires_in - 60)
        return self._access_token

    async def _post(
        self,
        path: str,
        *,
        operation: str,
        body: dict[str, Any],
        request_id: str | None = None,
    ) -> dict[str, Any]:
        token = await self._token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        if request_id is not None:
            headers["PayPal-Request-Id"] = request_id
        response = await self._client.post(path, json=body, headers=headers)
        if response.status_code < 200 or response.status_code >= 300:
            raise PayPalAPIError(response.status_code, operation)
        return dict(response.json())

    async def create_order(
        self,
        *,
        offer: Offer,
        attribution_id: str,
        request_id: str,
    ) -> PayPalOrder:
        value = f"{offer.amount:.2f}"
        payload = await self._post(
            "/v2/checkout/orders",
            operation="create order",
            request_id=request_id,
            body={
                "intent": "CAPTURE",
                "purchase_units": [
                    {
                        "reference_id": offer.id,
                        "custom_id": attribution_id,
                        "description": offer.description,
                        "amount": {
                            "currency_code": offer.currency,
                            "value": value,
                            "breakdown": {
                                "item_total": {
                                    "currency_code": offer.currency,
                                    "value": value,
                                }
                            },
                        },
                        "items": [
                            {
                                "name": offer.name,
                                "quantity": "1",
                                "unit_amount": {
                                    "currency_code": offer.currency,
                                    "value": value,
                                },
                            }
                        ],
                    }
                ],
            },
        )
        return PayPalOrder(id=str(payload["id"]), status=str(payload["status"]))

    async def capture_order(self, *, order_id: str, request_id: str) -> PayPalCapture:
        payload = await self._post(
            f"/v2/checkout/orders/{order_id}/capture",
            operation="capture order",
            request_id=request_id,
            body={},
        )
        purchase_units = payload.get("purchase_units", [])
        captures = purchase_units[0].get("payments", {}).get("captures", [])
        if not captures:
            raise PayPalAPIError(502, "parse capture")
        capture = captures[0]
        amount = capture.get("amount", {})
        return PayPalCapture(
            order_id=str(payload["id"]),
            capture_id=str(capture["id"]),
            status=str(capture["status"]),
            amount=str(amount["value"]),
            currency=str(amount["currency_code"]),
            payer_id=(payload.get("payer") or {}).get("payer_id"),
        )

    async def refund_capture(self, *, capture_id: str, request_id: str) -> PayPalRefund:
        # An empty body refunds the full captured amount.
        payload = await self._post(
            f"/v2/payments/captures/{capture_id}/refund",
            operation="refund capture",
            request_id=request_id,
            body={},
        )
        amount = payload.get("amount", {})
        return PayPalRefund(
            refund_id=str(payload["id"]),
            capture_id=refund_capture_id(payload) or capture_id,
            status=str(payload["status"]),
            amount=str(amount["value"]),
            currency=str(amount["currency_code"]),
        )

    async def get_order(self, *, order_id: str) -> PayPalOrderDetails:
        token = await self._token()
        response = await self._client.get(
            f"/v2/checkout/orders/{order_id}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        if response.status_code != 200:
            raise PayPalAPIError(response.status_code, "get order")
        payload = dict(response.json())
        unit = (payload.get("purchase_units") or [{}])[0]
        amount = unit.get("amount", {})
        captures = unit.get("payments", {}).get("captures", [])
        capture = captures[0] if captures else {}
        return PayPalOrderDetails(
            order_id=str(payload["id"]),
            status=str(payload["status"]),
            amount=amount.get("value"),
            currency=amount.get("currency_code"),
            capture_id=capture.get("id"),
            capture_status=capture.get("status"),
        )

    async def verify_webhook(
        self,
        *,
        headers: Mapping[str, str],
        event: dict[str, Any],
    ) -> bool:
        required = {
            "transmission_id": headers.get("paypal-transmission-id"),
            "transmission_time": headers.get("paypal-transmission-time"),
            "cert_url": headers.get("paypal-cert-url"),
            "auth_algo": headers.get("paypal-auth-algo"),
            "transmission_sig": headers.get("paypal-transmission-sig"),
        }
        if any(value is None for value in required.values()):
            return False
        payload = await self._post(
            "/v1/notifications/verify-webhook-signature",
            operation="verify webhook",
            body={**required, "webhook_id": self._webhook_id, "webhook_event": event},
        )
        return payload.get("verification_status") == "SUCCESS"


class FakePayPalGateway:
    def __init__(self, *, webhook_valid: bool = True, capture_status: str = "COMPLETED") -> None:
        self.webhook_valid = webhook_valid
        self.capture_status = capture_status
        self.created_orders: list[tuple[Offer, str, str]] = []
        self.capture_request_ids: list[str] = []
        # Orders PayPal knows about, by id. Anything else is a 404, as on PayPal.
        self.orders: dict[str, PayPalOrderDetails] = {}
        self.order_lookups: list[str] = []
        self.refund_request_ids: list[str] = []
        self.refund_status = "COMPLETED"
        self.payer_id: str | None = "TESTPAYER001"

    async def create_order(
        self,
        *,
        offer: Offer,
        attribution_id: str,
        request_id: str,
    ) -> PayPalOrder:
        self.created_orders.append((offer, attribution_id, request_id))
        return PayPalOrder(id="TEST-ORDER-001", status="CREATED")

    async def capture_order(self, *, order_id: str, request_id: str) -> PayPalCapture:
        self.capture_request_ids.append(request_id)
        return PayPalCapture(
            order_id=order_id,
            capture_id="TEST-CAPTURE-001",
            status=self.capture_status,
            amount="9.00",
            currency="USD",
            payer_id=self.payer_id,
        )

    async def refund_capture(self, *, capture_id: str, request_id: str) -> PayPalRefund:
        self.refund_request_ids.append(request_id)
        return PayPalRefund(
            refund_id=f"TEST-REFUND-{len(self.refund_request_ids):03d}",
            capture_id=capture_id,
            status=self.refund_status,
            amount="9.00",
            currency="USD",
        )

    async def get_order(self, *, order_id: str) -> PayPalOrderDetails:
        self.order_lookups.append(order_id)
        if order_id not in self.orders:
            raise PayPalAPIError(404, "get order")
        return self.orders[order_id]

    async def verify_webhook(
        self,
        *,
        headers: Mapping[str, str],
        event: dict[str, Any],
    ) -> bool:
        del headers, event
        return self.webhook_valid
