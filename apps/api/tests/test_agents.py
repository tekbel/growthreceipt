from collections.abc import Generator
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.agents.dependencies import get_agent_gateway
from app.agents.gateway import FakeAgentGateway
from app.campaigns.models import CampaignDraft, CampaignPost
from app.campaigns.store import FakeCampaignStore
from app.jobs.agent_jobs import FakeAgentJobStore
from app.main import app
from app.offers import OFFERS
from app.paypal.gateway import PayPalCapture, PayPalRefund
from app.paypal.store import FakePaymentStore
from app.paypal.store_dependencies import get_payment_store
from app.routes.agents import NextAction, PaidPostEvidence, classify_evidence, rank_paid_posts


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
        {
            "campaign-draft": draft,
            "revenue-next-action": next_action,
            "revise-post": CampaignPost(
                day=99,
                channel="X",
                theme="Revised theme",
                content="Revised text. #IndieHackers #Launch #SaaS",
                call_to_action="Scan your page.",
            ),
            "follow-up-post": CampaignPost(
                day=99,
                channel="LinkedIn",
                theme="Catch it before launch",
                content="Find what breaks a launch before your visitors do.",
                call_to_action="Get the 10 scan pack.",
            ),
        }
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
    assert body["evidence"]["signal"] == "none"
    assert body["evidence"]["evidence_through"] is None
    assert body["next_action"]["confidence"] == "low"
    assert body["next_action"]["human_approval_required"] is True
    events = await campaign_store.events(
        workspace_id=uuid4(), campaign_id=UUID("11111111-1111-4111-8111-111111111111")
    )
    assert events[0].action == "next_action_recommended"
    assert events[0].actor == "agent"
    # Token counts are kept with the run so its cost can be worked out later.
    assert events[0].detail["input_tokens"] == 1200
    assert events[0].detail["output_tokens"] == 300


@pytest.mark.asyncio
async def test_next_action_rejects_unknown_campaign(transport: ASGITransport) -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/agents/next-action",
            json={"campaign_id": "99999999-9999-4999-8999-999999999999"},
        )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_next_action_records_a_job_a_reloaded_page_can_read(
    transport: ASGITransport, agent_jobs: FakeAgentJobStore
) -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/v1/agents/next-action", json={"campaign_id": CAMPAIGN})
        [(_, job)] = agent_jobs.jobs.values()
        saved = await client.get(f"/v1/agent-jobs/{job.id}")

    assert job.kind == "next_action" and str(job.campaign_id) == CAMPAIGN
    assert saved.json()["status"] == "succeeded"
    assert saved.json()["result"] == response.json()


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


@pytest.mark.asyncio
async def test_approved_move_drafts_one_post_for_review(
    transport: ASGITransport, campaign_store: FakeCampaignStore
) -> None:
    last_day = max(post.day for post in campaign_store.campaigns[UUID(CAMPAIGN)].posts)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await recommend(client)
        await client.post(
            "/v1/agents/next-action/decision",
            json={"campaign_id": CAMPAIGN, "decision": "approved"},
        )
        response = await client.post("/v1/agents/follow-up-post", json={"campaign_id": CAMPAIGN})
        repeated = await client.post("/v1/agents/follow-up-post", json={"campaign_id": CAMPAIGN})

    assert response.status_code == 200
    body = response.json()
    [added] = [post for post in body["campaign"]["posts"] if post["id"] == body["post_id"]]
    assert added["status"] == "needs_review"
    assert added["day"] == last_day + 1
    assert added["theme"] == "Catch it before launch"
    # Asking again, as a page that reloaded mid draft does, returns the same post.
    assert repeated.status_code == 200
    assert repeated.json()["post_id"] == body["post_id"]
    assert not body["already_drafted"] and repeated.json()["already_drafted"]
    assert len(repeated.json()["campaign"]["posts"]) == len(body["campaign"]["posts"])
    events = await campaign_store.events(workspace_id=uuid4(), campaign_id=UUID(CAMPAIGN))
    assert [event.action for event in events].count("follow_up_drafted") == 1
    assert events[0].action == "follow_up_drafted"
    assert events[0].post_id == UUID(body["post_id"])


@pytest.mark.asyncio
async def test_follow_up_needs_an_approved_move(
    transport: ASGITransport, agent_jobs: FakeAgentJobStore
) -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await recommend(client)
        await client.post(
            "/v1/agents/next-action/decision",
            json={"campaign_id": CAMPAIGN, "decision": "rejected"},
        )
        response = await client.post("/v1/agents/follow-up-post", json={"campaign_id": CAMPAIGN})

    assert response.status_code == 409
    assert response.json()["detail"] == "Approve a next move first"
    # A request turned away before the agent runs leaves no job behind.
    assert not [job for _, job in agent_jobs.jobs.values() if job.kind == "follow_up_post"]


@pytest.mark.asyncio
async def test_agent_revises_a_post_from_the_review_note(
    transport: ASGITransport, campaign_store: FakeCampaignStore, agent_jobs: FakeAgentJobStore
) -> None:
    post = campaign_store.campaigns[UUID(CAMPAIGN)].posts[0]
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        early = await client.post(
            "/v1/agents/revise-post", json={"campaign_id": CAMPAIGN, "post_id": str(post.id)}
        )
        await client.patch(
            f"/v1/campaigns/{CAMPAIGN}/posts/{post.id}",
            json={"status": "changes_requested", "review_note": "Add one more hashtag."},
        )
        response = await client.post(
            "/v1/agents/revise-post", json={"campaign_id": CAMPAIGN, "post_id": str(post.id)}
        )

    assert early.status_code == 409
    assert response.status_code == 200
    # A page that reloaded while the agent revised finds the answer through the job.
    revisions = [job for _, job in agent_jobs.jobs.values() if job.kind == "revise_post"]
    assert [job.status for job in revisions] == ["succeeded"]
    assert revisions[0].result == response.json()
    [revised] = [
        item for item in response.json()["campaign"]["posts"] if item["id"] == str(post.id)
    ]
    assert revised["status"] == "needs_review"
    assert revised["review_note"] is None
    assert revised["content"].endswith("#SaaS")
    assert revised["day"] == post.day
    assert revised["channel"] == post.channel
    events = await campaign_store.events(workspace_id=uuid4(), campaign_id=UUID(CAMPAIGN))
    assert events[0].action == "post_revised"
    assert events[0].actor == "agent"
    assert events[0].detail["review_note"] == "Add one more hashtag."
    assert events[0].detail["before"] == post.content


def paid(day: int, orders: int, revenue: str) -> PaidPostEvidence:
    return PaidPostEvidence(
        content_id=uuid4(),
        day=day,
        channel="X",
        theme="Theme",
        content="Post",
        completed_orders=orders,
        revenue=revenue,
    )


def test_one_purchase_is_only_an_early_signal() -> None:
    assert classify_evidence(rank_paid_posts([paid(3, 1, "9.00")])) == "early"


def test_a_post_with_three_purchases_and_the_most_revenue_leads() -> None:
    ranked = rank_paid_posts([paid(1, 1, "9.00"), paid(5, 3, "27.00")])
    assert ranked[0].day == 5
    assert classify_evidence(ranked) == "leader"


def test_equal_revenue_is_a_tie_in_a_stable_order() -> None:
    ranked = rank_paid_posts([paid(6, 2, "18.00"), paid(2, 2, "18.00")])
    assert [post.day for post in ranked] == [2, 6]
    assert classify_evidence(ranked) == "tie"


def test_more_revenue_from_fewer_purchases_is_mixed() -> None:
    # One $19 pack against two $9 packs. The bigger sale must not be called the winner.
    ranked = rank_paid_posts([paid(5, 2, "18.00"), paid(3, 1, "19.00")])
    assert ranked[0].day == 3
    assert classify_evidence(ranked) == "mixed"


def test_a_leader_with_the_most_purchases_is_not_mixed() -> None:
    ranked = rank_paid_posts([paid(5, 3, "27.00"), paid(3, 3, "12.00"), paid(1, 1, "19.00")])
    assert classify_evidence(ranked) == "leader"


@pytest.mark.asyncio
async def test_a_refunded_purchase_is_not_next_move_evidence(transport: ASGITransport) -> None:
    store = FakePaymentStore()
    offer = next(iter(OFFERS.values()))
    for order_id, content_id in (
        ("KEPT", "22222222-2222-4222-8222-222222222222"),
        ("REFUNDED", "33333333-3333-4333-8333-333333333333"),
    ):
        await store.record_order(
            workspace_id=uuid4(),
            offer=offer,
            campaign_id=UUID(CAMPAIGN),
            content_id=UUID(content_id),
            paypal_order_id=order_id,
            idempotency_key=uuid4(),
        )
        await store.record_capture(
            PayPalCapture(order_id, f"CAP-{order_id}", "COMPLETED", "9.00", "USD")
        )
    await store.record_refund(PayPalRefund("REF-1", "CAP-REFUNDED", "COMPLETED", "9.00", "USD"))
    app.dependency_overrides[get_payment_store] = lambda: store

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/v1/agents/next-action", json={"campaign_id": CAMPAIGN})

    evidence = response.json()["evidence"]
    assert evidence["completed_orders"] == 1
    assert evidence["gross_revenue"] == "9.00"
    assert [post["content_id"] for post in evidence["paid_posts"]] == [
        "22222222-2222-4222-8222-222222222222"
    ]
