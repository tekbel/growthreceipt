import json
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Generator
from decimal import Decimal
from uuid import UUID

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.campaigns.models import PostStatus
from app.campaigns.store import FakeCampaignStore
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


@pytest.fixture(autouse=True)
def approved_first_post(campaign_store: FakeCampaignStore) -> None:
    set_post_status(campaign_store, CONTENT_ID, "approved")


def set_post_status(store: FakeCampaignStore, content_id: str, status: PostStatus) -> None:
    campaign = store.campaigns[UUID(CAMPAIGN_ID)]
    posts = [
        post.model_copy(update={"status": status}) if str(post.id) == content_id else post
        for post in campaign.posts
    ]
    store.campaigns[campaign.id] = campaign.model_copy(update={"posts": posts})


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
            "offer_id": "launchcheck-scan-pack",
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
        "sandbox_buyer_email": None,
        "sandbox_buyer_password": None,
    }
    assert "secret" not in response.text.lower()


@pytest.mark.asyncio
@pytest.mark.parametrize("environment", ["sandbox", "live"])
async def test_config_shares_the_test_buyer_only_in_sandbox(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    from app.config import get_settings

    monkeypatch.setenv("PAYPAL_CLIENT_ID", "client-id")
    monkeypatch.setenv("PAYPAL_ENVIRONMENT", environment)
    monkeypatch.setenv("PAYPAL_SANDBOX_BUYER_EMAIL", "judge-buyer@personal.example.com")
    monkeypatch.setenv("PAYPAL_SANDBOX_BUYER_PASSWORD", "buyer-password")
    get_settings.cache_clear()
    response = await client.get("/v1/paypal/config")
    get_settings.cache_clear()

    body = response.json()
    if environment == "sandbox":
        assert body["sandbox_buyer_email"] == "judge-buyer@personal.example.com"
        assert body["sandbox_buyer_password"] == "buyer-password"
    else:
        assert body["sandbox_buyer_email"] is None
        assert body["sandbox_buyer_password"] is None


@pytest.mark.asyncio
async def test_create_order_rejects_unknown_campaign_content(client: AsyncClient) -> None:
    response = await client.post(
        "/v1/paypal/orders",
        json={
            "offer_id": "launchcheck-scan-pack",
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
            "offer_id": "launchcheck-scan-pack",
            "campaign_id": CAMPAIGN_ID,
            "content_id": CONTENT_ID,
        },
    )
    response = await client.post("/v1/paypal/orders/TEST-ORDER-001/capture")

    assert response.status_code == 200
    assert response.json()["capture_id"] == "TEST-CAPTURE-001"
    assert response.json()["amount"] == "9.00"


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
                "offer_id": "launchcheck-scan-pack",
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
        "started_orders": 1,
        "gross_revenue": "9.00",
        "currency": "USD",
        "latest_capture_id": "TEST-CAPTURE-001",
    }


@pytest.mark.asyncio
async def test_an_abandoned_checkout_counts_as_started_but_not_completed() -> None:
    store = FakePaymentStore()
    app.dependency_overrides[get_paypal_gateway] = lambda: FakePayPalGateway()
    app.dependency_overrides[get_payment_store] = lambda: store
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post(
            "/v1/paypal/orders",
            json={
                "offer_id": "launchcheck-scan-pack",
                "campaign_id": CAMPAIGN_ID,
                "content_id": CONTENT_ID,
            },
        )
        summary = (await client.get(f"/v1/paypal/revenue/{CAMPAIGN_ID}")).json()

    assert summary["started_orders"] == 1
    assert summary["completed_orders"] == 0
    assert summary["gross_revenue"] == "0.00"


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
        id="launchcheck-scan-pack",
        name="LaunchCheck scan pack",
        description="Scribe subscription",
        amount=Decimal("9.00"),
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
    assert body["purchase_units"][0]["amount"]["value"] == "9.00"


@pytest.mark.asyncio
async def test_create_order_rejects_a_post_that_is_not_approved(
    client: AsyncClient, campaign_store: FakeCampaignStore
) -> None:
    set_post_status(campaign_store, CONTENT_ID, "needs_review")
    response = await client.post(
        "/v1/paypal/orders",
        json={
            "offer_id": "launchcheck-scan-pack",
            "campaign_id": CAMPAIGN_ID,
            "content_id": CONTENT_ID,
        },
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_public_offer_shows_an_approved_post_without_sign_in(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import get_settings

    monkeypatch.setenv("PAYPAL_CLIENT_ID", "sandbox-client-id")
    get_settings.cache_clear()
    response = await client.get(f"/v1/public/offers/{CONTENT_ID}")
    get_settings.cache_clear()

    assert response.status_code == 200
    body = response.json()
    assert body["amount"] == "9.00"
    assert body["currency"] == "USD"
    assert body["client_id"] == "sandbox-client-id"
    assert "secret" not in response.text.lower()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content_id", ["33333333-3333-4333-8333-333333333333", "99999999-9999-4999-8999-999999999999"]
)
async def test_public_offer_hides_unapproved_and_unknown_posts(
    client: AsyncClient, content_id: str
) -> None:
    offer = await client.get(f"/v1/public/offers/{content_id}")
    order = await client.post("/v1/public/orders", json={"content_id": content_id})

    assert offer.status_code == 404
    assert order.status_code == 404


@pytest.mark.asyncio
async def test_public_purchase_is_attributed_to_the_post() -> None:
    store = FakePaymentStore()
    app.dependency_overrides[get_paypal_gateway] = lambda: FakePayPalGateway()
    app.dependency_overrides[get_payment_store] = lambda: store
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        order = await client.post("/v1/public/orders", json={"content_id": CONTENT_ID})
        order_id = order.json()["order_id"]
        capture = await client.post(f"/v1/public/orders/{order_id}/capture")

    assert capture.status_code == 200
    assert capture.json()["amount"] == "9.00"
    workspace_id, campaign_id, content_id = store.orders[order_id]
    assert (str(campaign_id), str(content_id)) == (CAMPAIGN_ID, CONTENT_ID)
    assert workspace_id is not None


@pytest.mark.asyncio
async def test_public_capture_refuses_orders_this_server_did_not_open(
    client: AsyncClient,
) -> None:
    response = await client.post("/v1/public/orders/UNKNOWN-ORDER-1/capture")

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_public_orders_are_rate_limited(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.routes import public

    monkeypatch.setattr(public.order_rate_limit, "limit", 1)
    monkeypatch.setattr(public.order_rate_limit, "hits", defaultdict(deque))
    first = await client.post("/v1/public/orders", json={"content_id": CONTENT_ID})
    second = await client.post("/v1/public/orders", json={"content_id": CONTENT_ID})

    assert first.status_code == 200
    assert second.status_code == 429


@pytest.mark.asyncio
async def test_receipt_links_post_capture_and_verified_webhooks(client: AsyncClient) -> None:
    order = await client.post("/v1/public/orders", json={"content_id": CONTENT_ID})
    order_id = order.json()["order_id"]
    await client.post(f"/v1/public/orders/{order_id}/capture")
    # PayPal sends the capture event with the capture id and the order it belongs to.
    await client.post(
        "/v1/paypal/webhooks",
        json={
            "id": "WH-CAPTURE",
            "event_type": "PAYMENT.CAPTURE.COMPLETED",
            "resource": {
                "id": "TEST-CAPTURE-001",
                "supplementary_data": {"related_ids": {"order_id": order_id}},
            },
        },
    )
    await client.post(
        "/v1/paypal/webhooks",
        json={"id": "WH-OTHER", "event_type": "PAYMENT.CAPTURE.COMPLETED", "resource": {"id": "X"}},
    )

    response = await client.get(f"/v1/paypal/receipts/{CAMPAIGN_ID}")

    assert response.status_code == 200
    [receipt] = response.json()["receipts"]
    assert receipt["order_id"] == order_id
    assert receipt["capture_id"] == "TEST-CAPTURE-001"
    assert receipt["content_id"] == CONTENT_ID
    assert receipt["amount"] == "9.00"
    assert [event["event_id"] for event in receipt["webhooks"]] == ["WH-CAPTURE"]
    assert receipt["ordered_at"] <= receipt["captured_at"]


@pytest.mark.asyncio
async def test_receipts_hide_unknown_campaigns(client: AsyncClient) -> None:
    response = await client.get("/v1/paypal/receipts/99999999-9999-4999-8999-999999999999")

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_checkouts_include_started_and_paid_orders(client: AsyncClient) -> None:
    order = await client.post("/v1/public/orders", json={"content_id": CONTENT_ID})
    order_id = order.json()["order_id"]

    started = await client.get(f"/v1/paypal/checkouts/{CAMPAIGN_ID}")
    await client.post(f"/v1/public/orders/{order_id}/capture")
    paid = await client.get(f"/v1/paypal/checkouts/{CAMPAIGN_ID}")

    assert started.status_code == 200
    [checkout] = started.json()["checkouts"]
    assert checkout["order_id"] == order_id
    assert checkout["content_id"] == CONTENT_ID
    assert checkout["amount"] == "9.00"
    assert checkout["completed"] is False
    assert checkout["captured_at"] is None
    [checkout] = paid.json()["checkouts"]
    assert checkout["completed"] is True
    assert checkout["captured_at"] is not None


@pytest.mark.asyncio
async def test_checkouts_hide_unknown_campaigns(client: AsyncClient) -> None:
    response = await client.get("/v1/paypal/checkouts/99999999-9999-4999-8999-999999999999")

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_a_capture_that_is_not_completed_is_not_revenue() -> None:
    store = FakePaymentStore()
    gateway = FakePayPalGateway(capture_status="PENDING")
    app.dependency_overrides[get_paypal_gateway] = lambda: gateway
    app.dependency_overrides[get_payment_store] = lambda: store
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        order = await client.post("/v1/public/orders", json={"content_id": CONTENT_ID})
        capture = await client.post(f"/v1/public/orders/{order.json()['order_id']}/capture")

    assert capture.status_code == 409
    assert store.captures == {}


@pytest.mark.asyncio
async def test_a_repeated_capture_reuses_the_paypal_request_id() -> None:
    gateway = FakePayPalGateway()
    store = FakePaymentStore()
    app.dependency_overrides[get_paypal_gateway] = lambda: gateway
    app.dependency_overrides[get_payment_store] = lambda: store
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        order = await client.post("/v1/public/orders", json={"content_id": CONTENT_ID})
        order_id = order.json()["order_id"]
        await client.post(f"/v1/public/orders/{order_id}/capture")
        await client.post(f"/v1/public/orders/{order_id}/capture")

    assert gateway.capture_request_ids == [f"capture-{order_id}"] * 2


@pytest.mark.asyncio
async def test_public_order_refuses_an_offer_the_founder_switched(client: AsyncClient) -> None:
    stale = await client.post(
        "/v1/public/orders",
        json={"content_id": CONTENT_ID, "offer_id": "launchcheck-scan-pack-30"},
    )
    current = await client.post(
        "/v1/public/orders",
        json={"content_id": CONTENT_ID, "offer_id": "launchcheck-scan-pack"},
    )

    assert stale.status_code == 409
    assert current.status_code == 200


@pytest.mark.asyncio
async def test_webhook_with_a_body_that_is_not_json_is_refused(client: AsyncClient) -> None:
    response = await client.post(
        "/v1/paypal/webhooks",
        content=b"not json",
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 400
