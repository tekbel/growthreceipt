import json
from collections.abc import AsyncIterator, Generator
from decimal import Decimal

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.paypal.dependencies import get_paypal_gateway
from app.paypal.gateway import FakePayPalGateway, HttpPayPalGateway, Offer
from app.paypal.store import FakePaymentStore
from app.paypal.store_dependencies import get_payment_store

CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111"
CONTENT_ID = "22222222-2222-4222-8222-222222222222"


@pytest.fixture(autouse=True)
def clear_overrides() -> Generator[None, None, None]:
    yield
    app.dependency_overrides.clear()


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    store = FakePaymentStore()
    app.dependency_overrides[get_paypal_gateway] = lambda: FakePayPalGateway()
    app.dependency_overrides[get_payment_store] = lambda: store
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as value:
        yield value


@pytest.mark.asyncio
async def test_create_order_uses_server_owned_offer(client: AsyncClient) -> None:
    response = await client.post(
        "/v1/paypal/orders",
        json={
            "offer_id": "scribe-pro",
            "campaign_id": CAMPAIGN_ID,
            "content_id": CONTENT_ID,
            "amount": "0.01",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"order_id": "TEST-ORDER-001", "status": "CREATED"}


@pytest.mark.asyncio
async def test_config_exposes_only_browser_safe_paypal_values(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import get_settings

    monkeypatch.setenv("PAYPAL_CLIENT_ID", "sandbox-client-id")
    get_settings.cache_clear()
    response = await client.get("/v1/paypal/config")
    get_settings.cache_clear()

    assert response.status_code == 200
    assert response.json() == {
        "client_id": "sandbox-client-id",
        "environment": "sandbox",
        "currency": "USD",
    }
    assert "secret" not in response.text.lower()


@pytest.mark.asyncio
async def test_create_order_rejects_unknown_campaign_content(client: AsyncClient) -> None:
    response = await client.post(
        "/v1/paypal/orders",
        json={
            "offer_id": "scribe-pro",
            "campaign_id": CAMPAIGN_ID,
            "content_id": "99999999-9999-4999-8999-999999999999",
        },
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_capture_order_returns_normalized_capture(client: AsyncClient) -> None:
    await client.post(
        "/v1/paypal/orders",
        json={
            "offer_id": "scribe-pro",
            "campaign_id": CAMPAIGN_ID,
            "content_id": CONTENT_ID,
        },
    )
    response = await client.post("/v1/paypal/orders/TEST-ORDER-001/capture")

    assert response.status_code == 200
    assert response.json()["capture_id"] == "TEST-CAPTURE-001"
    assert response.json()["amount"] == "12.00"


@pytest.mark.asyncio
async def test_webhook_rejects_invalid_signature() -> None:
    app.dependency_overrides[get_paypal_gateway] = lambda: FakePayPalGateway(webhook_valid=False)
    app.dependency_overrides[get_payment_store] = lambda: FakePaymentStore()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/v1/paypal/webhooks",
            json={"id": "WH-001", "event_type": "PAYMENT.CAPTURE.COMPLETED"},
        )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_capture_is_attributed_to_campaign() -> None:
    store = FakePaymentStore()
    app.dependency_overrides[get_paypal_gateway] = lambda: FakePayPalGateway()
    app.dependency_overrides[get_payment_store] = lambda: store
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        create_response = await client.post(
            "/v1/paypal/orders",
            json={
                "offer_id": "scribe-pro",
                "campaign_id": CAMPAIGN_ID,
                "content_id": CONTENT_ID,
            },
        )
        order_id = create_response.json()["order_id"]
        capture_response = await client.post(f"/v1/paypal/orders/{order_id}/capture")
        summary_response = await client.get(f"/v1/paypal/revenue/{CAMPAIGN_ID}")

    assert capture_response.status_code == 200
    assert summary_response.json() == {
        "campaign_id": CAMPAIGN_ID,
        "completed_orders": 1,
        "gross_revenue": "12.00",
        "currency": "USD",
        "latest_capture_id": "TEST-CAPTURE-001",
    }


@pytest.mark.asyncio
async def test_http_gateway_sends_catalog_price_and_idempotency_key() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
        return httpx.Response(201, json={"id": "ORDER-123", "status": "CREATED"})

    client = httpx.AsyncClient(
        base_url="https://api-m.sandbox.paypal.com",
        transport=httpx.MockTransport(handler),
    )
    gateway = HttpPayPalGateway(
        client_id="client-id",
        client_secret="client-secret",
        webhook_id="webhook-id",
        environment="sandbox",
        client=client,
    )
    offer = Offer(
        id="scribe-pro",
        name="Scribe Pro",
        description="Scribe subscription",
        amount=Decimal("12.00"),
        currency="USD",
    )

    order = await gateway.create_order(
        offer=offer,
        attribution_id=f"{CAMPAIGN_ID}:{CONTENT_ID}",
        request_id="request-123",
    )
    await client.aclose()

    body = json.loads(requests[1].content)
    assert order.id == "ORDER-123"
    assert requests[1].headers["PayPal-Request-Id"] == "request-123"
    assert body["purchase_units"][0]["amount"]["value"] == "12.00"
