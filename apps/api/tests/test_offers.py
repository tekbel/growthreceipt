from collections.abc import AsyncIterator
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.agents.dependencies import get_agent_gateway
from app.agents.gateway import FakeAgentGateway
from app.campaigns.store import FakeCampaignStore
from app.main import app
from app.offers import DEFAULT_OFFER_ID, OFFERS
from app.paypal.dependencies import get_paypal_gateway
from app.paypal.gateway import FakePayPalGateway, PayPalCapture
from app.paypal.store import FakePaymentStore, Receipt
from app.paypal.store_dependencies import get_payment_store
from app.routes.agents import NextAction, OfferChange, checked_offer_change, revenue_by_offer

CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111"
CONTENT_ID = "22222222-2222-4222-8222-222222222222"
LARGE_PACK = "launchcheck-scan-pack-30"


def suggestion(offer_id: str) -> NextAction:
    return NextAction(
        headline="Offer the 30 scan pack",
        evidence_summary="One buyer bought the 10 scan pack from the day 1 post.",
        recommendation="Switch the buy links to the 30 scan pack for one week.",
        rationale="Agencies scan many client pages before a launch.",
        expected_signal="A purchase of the 30 scan pack.",
        confidence="low",
        needs_more_data=True,
        human_approval_required=True,
        offer_change=OfferChange(offer_id=offer_id, reason="Buyers scan many pages."),
    )


@pytest.fixture(autouse=True)
def approved_first_post(campaign_store: FakeCampaignStore) -> None:
    campaign = campaign_store.campaigns[UUID(CAMPAIGN_ID)]
    posts = [
        post.model_copy(update={"status": "approved"}) if str(post.id) == CONTENT_ID else post
        for post in campaign.posts
    ]
    campaign_store.campaigns[campaign.id] = campaign.model_copy(update={"posts": posts})


@pytest.fixture
def payments() -> FakePaymentStore:
    return FakePaymentStore()


async def buy(payments: FakePaymentStore) -> None:
    await payments.record_order(
        workspace_id=uuid4(),
        offer=OFFERS[DEFAULT_OFFER_ID],
        campaign_id=UUID(CAMPAIGN_ID),
        content_id=UUID(CONTENT_ID),
        paypal_order_id="ORDER-1",
        idempotency_key=uuid4(),
    )
    await payments.record_capture(
        PayPalCapture(
            order_id="ORDER-1",
            capture_id="CAPTURE-1",
            status="COMPLETED",
            amount="9.00",
            currency="USD",
        )
    )


def client_for(payments: FakePaymentStore, next_action: NextAction) -> AsyncClient:
    app.dependency_overrides[get_agent_gateway] = lambda: FakeAgentGateway(
        {"revenue-next-action": next_action}
    )
    app.dependency_overrides[get_payment_store] = lambda: payments
    app.dependency_overrides[get_paypal_gateway] = lambda: FakePayPalGateway()
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def paypal_client_id(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[None]:
    from app.config import get_settings

    monkeypatch.setenv("PAYPAL_CLIENT_ID", "sandbox-client-id")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
    app.dependency_overrides.clear()


async def recommend_and_approve(client: AsyncClient, **decision: object) -> dict[str, Any]:
    recommended = await client.post("/v1/agents/next-action", json={"campaign_id": CAMPAIGN_ID})
    assert recommended.status_code == 200
    response = await client.post(
        "/v1/agents/next-action/decision",
        json={"campaign_id": CAMPAIGN_ID, "decision": "approved", **decision},
    )
    assert response.status_code == 200
    return {"recommended": recommended.json(), "decision": response.json()}


@pytest.mark.asyncio
@pytest.mark.usefixtures("paypal_client_id")
async def test_approving_a_switch_changes_what_the_buy_link_sells(
    payments: FakePaymentStore, campaign_store: FakeCampaignStore
) -> None:
    await buy(payments)
    async with client_for(payments, suggestion(LARGE_PACK)) as client:
        result = await recommend_and_approve(client)
        offer = await client.get(f"/v1/public/offers/{CONTENT_ID}")
        order = await client.post("/v1/public/orders", json={"content_id": CONTENT_ID})

    assert result["recommended"]["next_action"]["offer_change"]["offer_id"] == LARGE_PACK
    assert result["decision"]["offer_change"]["offer_id"] == LARGE_PACK
    assert campaign_store.campaigns[UUID(CAMPAIGN_ID)].offer.amount == Decimal("19.00")
    assert offer.json()["offer_id"] == LARGE_PACK
    assert offer.json()["amount"] == "19.00"
    assert offer.json()["credits"] == 30
    assert payments.offer_ids[order.json()["order_id"]] == LARGE_PACK
    events = await campaign_store.events(workspace_id=uuid4(), campaign_id=UUID(CAMPAIGN_ID))
    assert events[0].action == "offer_changed"
    assert events[0].actor == "human"
    assert events[0].detail["previous_offer_id"] == DEFAULT_OFFER_ID


@pytest.mark.asyncio
async def test_founder_can_approve_the_plan_and_keep_the_offer(
    payments: FakePaymentStore, campaign_store: FakeCampaignStore
) -> None:
    await buy(payments)
    async with client_for(payments, suggestion(LARGE_PACK)) as client:
        result = await recommend_and_approve(client, apply_offer_change=False)

    assert result["decision"]["offer_change"] is None
    assert campaign_store.campaigns[UUID(CAMPAIGN_ID)].offer_id == DEFAULT_OFFER_ID


@pytest.mark.asyncio
@pytest.mark.parametrize("offer_id", ["launchcheck-scan-pack-1000", DEFAULT_OFFER_ID])
async def test_switches_outside_the_catalog_or_to_the_same_offer_are_dropped(
    payments: FakePaymentStore, campaign_store: FakeCampaignStore, offer_id: str
) -> None:
    await buy(payments)
    async with client_for(payments, suggestion(offer_id)) as client:
        result = await recommend_and_approve(client)

    assert result["recommended"]["next_action"]["offer_change"] is None
    assert campaign_store.campaigns[UUID(CAMPAIGN_ID)].offer_id == DEFAULT_OFFER_ID


@pytest.mark.asyncio
async def test_no_switch_without_a_purchase(
    payments: FakePaymentStore, campaign_store: FakeCampaignStore
) -> None:
    async with client_for(payments, suggestion(LARGE_PACK)) as client:
        result = await recommend_and_approve(client)

    assert result["recommended"]["next_action"]["offer_change"] is None
    assert campaign_store.campaigns[UUID(CAMPAIGN_ID)].offer_id == DEFAULT_OFFER_ID


@pytest.mark.asyncio
async def test_a_stale_offer_id_cannot_open_an_order(
    payments: FakePaymentStore, campaign_store: FakeCampaignStore
) -> None:
    await campaign_store.record_event(
        campaign_id=UUID(CAMPAIGN_ID),
        actor="human",
        action="offer_changed",
        detail={"offer_id": LARGE_PACK},
    )
    async with client_for(payments, suggestion(LARGE_PACK)) as client:
        response = await client.post(
            "/v1/paypal/orders",
            json={
                "offer_id": DEFAULT_OFFER_ID,
                "campaign_id": CAMPAIGN_ID,
                "content_id": CONTENT_ID,
            },
        )

    assert response.status_code == 409


def receipt(offer_id: str, amount: str) -> Receipt:
    now = datetime.now(UTC)
    return Receipt(
        paypal_order_id=str(uuid4()),
        paypal_capture_id=str(uuid4()),
        content_id=uuid4(),
        amount=Decimal(amount),
        currency="USD",
        ordered_at=now,
        captured_at=now,
        offer_id=offer_id,
    )


def test_revenue_is_split_by_offer_with_the_most_revenue_first() -> None:
    split = revenue_by_offer(
        [
            receipt(DEFAULT_OFFER_ID, "9.00"),
            receipt(LARGE_PACK, "19.00"),
            receipt(DEFAULT_OFFER_ID, "9.00"),
        ]
    )
    assert [(item.offer_id, item.completed_orders, item.revenue) for item in split] == [
        (LARGE_PACK, 1, "19.00"),
        (DEFAULT_OFFER_ID, 2, "18.00"),
    ]


def test_a_checked_switch_needs_a_purchase_and_a_different_catalog_offer() -> None:
    change = OfferChange(offer_id=LARGE_PACK, reason="Bigger pack.")
    assert checked_offer_change(change, current_offer_id=DEFAULT_OFFER_ID, completed_orders=1)
    assert not checked_offer_change(change, current_offer_id=LARGE_PACK, completed_orders=1)
    assert not checked_offer_change(change, current_offer_id=DEFAULT_OFFER_ID, completed_orders=0)


@pytest.mark.asyncio
async def test_catalog_lists_the_three_launchcheck_packs(payments: FakePaymentStore) -> None:
    async with client_for(payments, suggestion(LARGE_PACK)) as client:
        response = await client.get("/v1/paypal/offers")

    assert [(offer["credits"], offer["amount"]) for offer in response.json()] == [
        (3, "4.00"),
        (10, "9.00"),
        (30, "19.00"),
    ]


@pytest.mark.asyncio
async def test_founder_picks_the_offer_by_hand(
    payments: FakePaymentStore, campaign_store: FakeCampaignStore
) -> None:
    async with client_for(payments, suggestion(LARGE_PACK)) as client:
        picked = await client.post(
            f"/v1/paypal/campaigns/{CAMPAIGN_ID}/offer", json={"offer_id": LARGE_PACK}
        )
        unknown = await client.post(
            f"/v1/paypal/campaigns/{CAMPAIGN_ID}/offer", json={"offer_id": "free-pack"}
        )

    assert picked.json()["offer"]["credits"] == 30
    assert unknown.status_code == 404
    events = await campaign_store.events(workspace_id=uuid4(), campaign_id=UUID(CAMPAIGN_ID))
    assert events[0].action == "offer_changed"
