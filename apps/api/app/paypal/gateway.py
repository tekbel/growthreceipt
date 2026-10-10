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
    def __init__(self, *, webhook_valid: bool = True) -> None:
        self.webhook_valid = webhook_valid
        self.created_orders: list[tuple[Offer, str, str]] = []

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
        del request_id
        return PayPalCapture(
            order_id=order_id,
            capture_id="TEST-CAPTURE-001",
            status="COMPLETED",
            amount="9.00",
            currency="USD",
        )

    async def verify_webhook(
        self,
        *,
        headers: Mapping[str, str],
        event: dict[str, Any],
    ) -> bool:
        del headers, event
        return self.webhook_valid
