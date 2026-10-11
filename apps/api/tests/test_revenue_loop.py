from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.agents.dependencies import get_agent_gateway
from app.agents.gateway import FakeAgentGateway
from app.campaigns.dependencies import get_campaign_store
from app.campaigns.models import CampaignDraft, CampaignPost
from app.campaigns.store import FakeCampaignStore
from app.main import app
from app.paypal.dependencies import get_paypal_gateway
from app.paypal.gateway import FakePayPalGateway
from app.paypal.store import FakePaymentStore
from app.paypal.store_dependencies import get_payment_store
from app.routes.agents import NextAction


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
