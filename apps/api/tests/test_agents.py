from collections.abc import Generator
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.agents.dependencies import get_agent_gateway
from app.agents.gateway import FakeAgentGateway
from app.campaigns.models import CampaignDraft, CampaignPost
from app.campaigns.store import FakeCampaignStore
from app.main import app
from app.paypal.store import FakePaymentStore
from app.paypal.store_dependencies import get_payment_store
from app.routes.agents import NextAction


@pytest.fixture
def transport() -> ASGITransport:
    draft = CampaignDraft(
        campaign_name="Clear communication week",
        positioning="Write clearly wherever work happens.",
        posts=[
            CampaignPost(
                day=1,
                channel="LinkedIn",
                theme="A clearer workday",
                content="Turn rough thoughts into polished messages.",
                call_to_action="Try Scribe today.",
            )
        ],
    )
    next_action = NextAction(
        headline="Collect the first verified purchase",
        evidence_summary="No completed PayPal orders are attributed to this campaign yet.",
        recommendation="Run one sandbox checkout from the approved LinkedIn post.",
        rationale="A captured order is required before messaging can be evaluated against revenue.",
        expected_signal="One attributed PayPal sandbox capture.",
        confidence="low",
        needs_more_data=True,
        human_approval_required=True,
    )
    app.dependency_overrides[get_agent_gateway] = lambda: FakeAgentGateway(
        {"campaign-draft": draft, "revenue-next-action": next_action}
    )
    app.dependency_overrides[get_payment_store] = lambda: FakePaymentStore()
    return ASGITransport(app=app)


@pytest.fixture(autouse=True)
def clear_overrides() -> Generator[None, None, None]:
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_campaign_draft_returns_structured_agent_result(
    transport: ASGITransport,
) -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/agents/campaign-draft",
            json={
                "product_name": "Scribe AI Keyboard",
                "product_description": "An AI keyboard that rewrites messages inside any app.",
                "audience": "Knowledge workers",
                "objective": "Increase qualified app installs",
                "channels": ["LinkedIn"],
                "days": 1,
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["session_id"] == "fake-session"
    assert body["campaign"]["posts"][0]["channel"] == "LinkedIn"


@pytest.mark.asyncio
async def test_campaign_draft_rejects_unsupported_channel(transport: ASGITransport) -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/agents/campaign-draft",
            json={
                "product_name": "Scribe AI Keyboard",
                "product_description": "An AI keyboard that rewrites messages inside any app.",
                "audience": "Knowledge workers",
                "objective": "Increase qualified app installs",
                "channels": ["TikTok"],
                "days": 1,
            },
        )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_next_action_returns_verified_evidence_and_approval_boundary(
    transport: ASGITransport,
    campaign_store: FakeCampaignStore,
) -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/agents/next-action",
            json={"campaign_id": "11111111-1111-4111-8111-111111111111"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["evidence"]["gross_revenue"] == "0.00"
    assert body["next_action"]["confidence"] == "low"
    assert body["next_action"]["human_approval_required"] is True
    events = await campaign_store.events(
        workspace_id=uuid4(), campaign_id=UUID("11111111-1111-4111-8111-111111111111")
    )
    assert events[0].action == "next_action_recommended"
    assert events[0].actor == "agent"


@pytest.mark.asyncio
async def test_next_action_rejects_unknown_campaign(transport: ASGITransport) -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/agents/next-action",
            json={"campaign_id": "99999999-9999-4999-8999-999999999999"},
        )

    assert response.status_code == 404


async def recommend(client: AsyncClient) -> None:
    response = await client.post("/v1/agents/next-action", json={"campaign_id": CAMPAIGN})
    assert response.status_code == 200
    assert response.json()["model"]


CAMPAIGN = "11111111-1111-4111-8111-111111111111"


@pytest.mark.asyncio
async def test_founder_approves_an_edited_next_move(
    transport: ASGITransport, campaign_store: FakeCampaignStore
) -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await recommend(client)
        response = await client.post(
            "/v1/agents/next-action/decision",
            json={"campaign_id": CAMPAIGN, "decision": "approved", "recommendation": "My plan."},
        )
        repeated = await client.post(
            "/v1/agents/next-action/decision",
            json={"campaign_id": CAMPAIGN, "decision": "rejected"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["decision"] == "approved"
    assert body["recommendation"] == "My plan."
    assert body["edited"] is True
    assert repeated.status_code == 409
    events = await campaign_store.events(workspace_id=uuid4(), campaign_id=UUID(CAMPAIGN))
    assert events[0].action == "next_action_approved"
    assert events[0].actor == "human"
    assert events[0].detail["proposed_recommendation"] != "My plan."


@pytest.mark.asyncio
async def test_rejecting_keeps_the_proposed_plan_on_record(transport: ASGITransport) -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await recommend(client)
        response = await client.post(
            "/v1/agents/next-action/decision",
            json={"campaign_id": CAMPAIGN, "decision": "rejected", "recommendation": "ignored"},
        )

    assert response.status_code == 200
    assert response.json()["decision"] == "rejected"
    assert response.json()["edited"] is False


@pytest.mark.asyncio
async def test_decision_needs_a_recommendation(transport: ASGITransport) -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/agents/next-action/decision",
            json={"campaign_id": CAMPAIGN, "decision": "approved"},
        )

    assert response.status_code == 409
