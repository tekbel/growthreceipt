from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.agents.dependencies import get_agent_gateway
from app.agents.gateway import FakeAgentGateway
from app.campaigns.dependencies import get_campaign_store
from app.campaigns.models import CampaignDraft, CampaignPost
from app.campaigns.store import FakeCampaignStore
from app.main import app
from app.paypal.dependencies import get_optional_paypal_gateway, get_paypal_gateway
from app.paypal.gateway import FakePayPalGateway, PayPalOrderDetails
from app.paypal.store import FakePaymentStore, Receipt
from app.paypal.store_dependencies import get_payment_store
from app.routes.agents import NextAction, PayPalCheck, paypal_order_tool


@pytest.mark.asyncio
async def test_campaign_to_verified_revenue_to_next_action_loop() -> None:
    campaign_store = FakeCampaignStore()
    payment_store = FakePaymentStore()
    campaign_draft = CampaignDraft(
        campaign_name="Launch week",
        positioning="Clear writing without leaving the app where work happens.",
        posts=[
            CampaignPost(
                day=1,
                channel="LinkedIn",
                theme="Keep the thought",
                content="Write clearly without breaking your flow.",
                call_to_action="Try LaunchCheck scan pack.",
            )
        ],
    )
    next_action = NextAction(
        headline="Test a sharper opening line",
        evidence_summary="One PayPal order produced 9.00 USD in verified revenue.",
        recommendation="Test the approved message with a more specific professional audience.",
        rationale=(
            "The first verified purchase supports a narrow follow-up test, not a broad claim."
        ),
        expected_signal="A second attributed PayPal capture from the revised audience.",
        confidence="low",
        needs_more_data=True,
        human_approval_required=True,
    )
    app.dependency_overrides[get_campaign_store] = lambda: campaign_store
    app.dependency_overrides[get_payment_store] = lambda: payment_store
    app.dependency_overrides[get_paypal_gateway] = lambda: FakePayPalGateway()
    app.dependency_overrides[get_agent_gateway] = lambda: FakeAgentGateway(
        {
            "campaign-draft": campaign_draft,
            "revenue-next-action": next_action,
        }
    )

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            created = await client.post(
                "/v1/campaigns",
                json={
                    "product_name": "Scribe",
                    "product_description": "A writing keyboard for clear professional messages.",
                    "audience": "Busy professionals",
                    "objective": "Sell LaunchCheck scan pack subscriptions",
                    "channels": ["LinkedIn"],
                    "days": 1,
                    "brand_voice": "Clear, specific, calm",
                },
            )
            assert created.status_code == 201
            campaign = created.json()
            campaign_id = campaign["id"]
            content_id = campaign["posts"][0]["id"]

            approved = await client.post(f"/v1/campaigns/{campaign_id}/approve")
            assert approved.status_code == 200
            assert approved.json()["status"] == "approved"

            order = await client.post(
                "/v1/paypal/orders",
                json={
                    "offer_id": "launchcheck-scan-pack",
                    "campaign_id": campaign_id,
                    "content_id": content_id,
                },
            )
            assert order.status_code == 200

            captured = await client.post(f"/v1/paypal/orders/{order.json()['order_id']}/capture")
            assert captured.status_code == 200
            assert captured.json()["capture_id"] == "TEST-CAPTURE-001"

            revenue = await client.get(f"/v1/paypal/revenue/{campaign_id}")
            assert revenue.json() == {
                "campaign_id": campaign_id,
                "completed_orders": 1,
                "started_orders": 1,
                "gross_revenue": "9.00",
                "currency": "USD",
                "latest_capture_id": "TEST-CAPTURE-001",
            }

            recommendation = await client.post(
                "/v1/agents/next-action", json={"campaign_id": campaign_id}
            )
            assert recommendation.status_code == 200
            result = recommendation.json()
            assert result["evidence"].pop("evidence_through") is not None
            assert result["evidence"] == {
                "completed_orders": 1,
                "gross_revenue": "9.00",
                "currency": "USD",
                "latest_capture_id": "TEST-CAPTURE-001",
                "paid_posts": [
                    {
                        "content_id": content_id,
                        "day": 1,
                        "channel": campaign["posts"][0]["channel"],
                        "theme": campaign["posts"][0]["theme"],
                        "content": campaign["posts"][0]["content"],
                        "completed_orders": 1,
                        "revenue": "9.00",
                    }
                ],
                "signal": "early",
                "current_offer_id": "launchcheck-scan-pack",
                "by_offer": [
                    {
                        "offer_id": "launchcheck-scan-pack",
                        "name": "LaunchCheck 10 scan pack",
                        "completed_orders": 1,
                        "revenue": "9.00",
                    }
                ],
            }
            assert result["next_action"]["human_approval_required"] is True

        events = await campaign_store.events(workspace_id=uuid4(), campaign_id=UUID(campaign_id))
        assert [event.action for event in events] == [
            "next_action_recommended",
            "campaign_approved",
            "campaign_generated",
        ]
        assert events[0].detail["evidence"]["gross_revenue"] == "9.00"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_next_action_agent_checks_cited_orders_with_paypal() -> None:
    campaign_store = FakeCampaignStore()
    paypal = FakePayPalGateway()
    paypal.orders["TEST-ORDER-001"] = PayPalOrderDetails(
        order_id="TEST-ORDER-001",
        status="COMPLETED",
        amount="9.00",
        currency="USD",
        capture_id="TEST-CAPTURE-001",
        capture_status="COMPLETED",
    )
    draft = CampaignDraft(
        campaign_name="Launch week",
        positioning="Clear writing.",
        posts=[
            CampaignPost(
                day=1,
                channel="LinkedIn",
                theme="Keep the thought",
                content="Write clearly.",
                call_to_action="Try it.",
            )
        ],
    )
    next_action = NextAction(
        headline="Repeat the Day 1 angle",
        evidence_summary="PayPal confirmed the one checked order.",
        recommendation="Write one follow up post.",
        rationale="One confirmed purchase is an early signal.",
        expected_signal="A second confirmed purchase.",
        confidence="low",
        needs_more_data=True,
        human_approval_required=True,
    )
    app.dependency_overrides[get_campaign_store] = lambda: campaign_store
    payment_store = FakePaymentStore()
    app.dependency_overrides[get_payment_store] = lambda: payment_store
    app.dependency_overrides[get_paypal_gateway] = lambda: paypal
    app.dependency_overrides[get_optional_paypal_gateway] = lambda: paypal
    app.dependency_overrides[get_agent_gateway] = lambda: FakeAgentGateway(
        {"campaign-draft": draft, "revenue-next-action": next_action},
        tool_calls={
            "revenue-next-action": [
                ("get_paypal_order", {"order_id": "TEST-ORDER-001"}),
                # Another merchant order is refused before PayPal is called.
                ("get_paypal_order", {"order_id": "SOMEONE-ELSES-ORDER"}),
            ]
        },
    )
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            campaign = (
                await client.post(
                    "/v1/campaigns",
                    json={
                        "product_name": "Scribe",
                        "product_description": "A writing keyboard for clear messages.",
                        "audience": "Busy professionals",
                        "objective": "Sell scan packs",
                        "channels": ["LinkedIn"],
                        "days": 1,
                        "brand_voice": "Clear",
                    },
                )
            ).json()
            await client.post(f"/v1/campaigns/{campaign['id']}/approve")
            order = await client.post(
                "/v1/paypal/orders",
                json={
                    "offer_id": "launchcheck-scan-pack",
                    "campaign_id": campaign["id"],
                    "content_id": campaign["posts"][0]["id"],
                },
            )
            await client.post(f"/v1/paypal/orders/{order.json()['order_id']}/capture")

            result = (
                await client.post("/v1/agents/next-action", json={"campaign_id": campaign["id"]})
            ).json()

        assert paypal.order_lookups == ["TEST-ORDER-001"]
        assert result["paypal_checks"] == [
            {
                "order_id": "TEST-ORDER-001",
                "outcome": "confirmed",
                "status": "COMPLETED",
                "capture_status": "COMPLETED",
                "amount": "9.00",
                "currency": "USD",
            }
        ]
        events = await campaign_store.events(workspace_id=uuid4(), campaign_id=UUID(campaign["id"]))
        assert events[0].detail["paypal_checks"] == result["paypal_checks"]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_paypal_order_tool_reports_mismatch_and_missing_orders() -> None:
    paypal = FakePayPalGateway()
    paypal.orders["PAID-1"] = PayPalOrderDetails(
        order_id="PAID-1",
        status="COMPLETED",
        amount="4.00",
        currency="USD",
        capture_id="CAP-1",
        capture_status="COMPLETED",
    )
    receipts = [
        Receipt(
            paypal_order_id=order_id,
            paypal_capture_id="CAP-1",
            content_id=uuid4(),
            amount=Decimal("9.00"),
            currency="USD",
            ordered_at=datetime(2026, 10, 13, tzinfo=UTC),
            captured_at=datetime(2026, 10, 13, tzinfo=UTC),
        )
        for order_id in ("PAID-1", "GONE-1")
    ]
    checks: list[PayPalCheck] = []
    tool = paypal_order_tool(paypal, receipts, checks)

    await tool({"order_id": "PAID-1"})
    await tool({"order_id": "GONE-1"})

    assert [(check.order_id, check.outcome) for check in checks] == [
        ("PAID-1", "mismatch"),
        ("GONE-1", "not_found"),
    ]
