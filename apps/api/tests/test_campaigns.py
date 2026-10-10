import base64
import json
from collections.abc import AsyncIterator, Generator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.agents.dependencies import get_agent_gateway
from app.agents.gateway import FakeAgentGateway
from app.campaigns.models import CampaignDraft, CampaignPost
from app.campaigns.store import FakeCampaignStore
from app.main import app
from app.quota import FakeAgentQuota

CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111"
CONTENT_ID = "22222222-2222-4222-8222-222222222222"
BRIEF = {
    "product_name": "Ledgerly",
    "product_description": "A bookkeeping app for freelance designers who hate spreadsheets.",
    "audience": "Freelance designers",
    "objective": "Sell the first 20 annual plans",
    "channels": ["LinkedIn", "X"],
    "days": 2,
}


def draft(*posts: CampaignPost) -> CampaignDraft:
    return CampaignDraft(
        campaign_name="Books without spreadsheets",
        positioning="Bookkeeping that fits a design workflow.",
        posts=list(posts),
    )


def post(day: int, channel: str = "LinkedIn") -> CampaignPost:
    return CampaignPost.model_validate(
        {
            "day": day,
            "channel": channel,
            "theme": f"Theme {day}",
            "content": f"Post body {day}",
            "call_to_action": "Start a free trial.",
        }
    )


@pytest.fixture(autouse=True)
def clear_overrides() -> Generator[None, None, None]:
    yield
    app.dependency_overrides.clear()


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_agent_gateway] = lambda: FakeAgentGateway(
        {"campaign-draft": draft(post(2, "X"), post(1))}
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as value:
        yield value


@pytest.mark.asyncio
async def test_create_campaign_persists_generated_posts_for_review(
    client: AsyncClient, campaign_store: FakeCampaignStore
) -> None:
    response = await client.post("/v1/campaigns", json=BRIEF)

    assert response.status_code == 201
    body = response.json()
    assert body["product_name"] == "Ledgerly"
    assert body["product_icon_url"] is None
    assert body["status"] == "in_review"
    assert [item["day"] for item in body["posts"]] == [1, 2]
    assert {item["status"] for item in body["posts"]} == {"needs_review"}

    latest = await client.get("/v1/campaigns/latest")
    assert latest.json()["id"] == body["id"]
    events = (await client.get(f"/v1/campaigns/{body['id']}/events")).json()
    assert events[0]["action"] == "campaign_generated"
    assert events[0]["detail"]["session_id"] == "fake-session"


@pytest.mark.asyncio
async def test_create_campaign_supports_facebook_channel() -> None:
    app.dependency_overrides[get_agent_gateway] = lambda: FakeAgentGateway(
        {"campaign-draft": draft(post(1, "Facebook"), post(2, "LinkedIn"))}
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/v1/campaigns", json={**BRIEF, "channels": ["LinkedIn", "Facebook"]}
        )

    assert response.status_code == 201
    assert [item["channel"] for item in response.json()["posts"]] == ["Facebook", "LinkedIn"]


@pytest.mark.asyncio
async def test_create_campaign_keeps_optional_product_icon(client: AsyncClient) -> None:
    icon = "https://example.com/icon.png"
    response = await client.post("/v1/campaigns", json={**BRIEF, "product_icon_url": icon})
    assert response.status_code == 201
    assert response.json()["product_icon_url"] == icon

    blank = await client.post("/v1/campaigns", json={**BRIEF, "product_icon_url": "  "})
    assert blank.json()["product_icon_url"] is None


@pytest.mark.asyncio
async def test_create_campaign_keeps_uploaded_product_icon(client: AsyncClient) -> None:
    icon = "data:image/png;base64," + base64.b64encode(b"png bytes").decode()
    response = await client.post("/v1/campaigns", json={**BRIEF, "product_icon_url": icon})
    assert response.status_code == 201
    assert response.json()["product_icon_url"] == icon


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "icon",
    [
        "http://example.com/icon.png",
        "javascript:alert(1)",
        "//evil.example/icon.png",
        "data:image/svg+xml;base64,PHN2Zz4=",
        "data:image/png;base64,not base64!",
        "data:image/png;base64," + base64.b64encode(bytes(150_001)).decode(),
    ],
)
async def test_create_campaign_rejects_unsafe_product_icon(client: AsyncClient, icon: str) -> None:
    response = await client.post("/v1/campaigns", json={**BRIEF, "product_icon_url": icon})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_campaign_rejects_unrequested_channel() -> None:
    app.dependency_overrides[get_agent_gateway] = lambda: FakeAgentGateway(
        {"campaign-draft": draft(post(1), post(2, "Instagram"))}
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/v1/campaigns", json=BRIEF)

    assert response.status_code == 502


def sse_events(body: str) -> list[tuple[str, dict[str, Any]]]:
    events = []
    for block in body.strip().split("\n\n"):
        name, data = block.split("\n")
        events.append((name.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return events


@pytest.mark.asyncio
async def test_stream_campaign_reports_agent_steps_then_saves(client: AsyncClient) -> None:
    response = await client.post("/v1/campaigns/stream", json=BRIEF)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = sse_events(response.text)
    stages = [data["stage"] for name, data in events if name == "progress"]
    assert stages == [
        "brief_received",
        "session_started",
        "thinking",
        "writing",
        "writing",
        "checking",
        "saving",
    ]
    assert [data["items"] for name, data in events if data.get("stage") == "writing"] == [1, 2]
    name, campaign = events[-1]
    assert name == "campaign"
    assert campaign["product_name"] == "Ledgerly"
    latest = await client.get("/v1/campaigns/latest")
    assert latest.json()["id"] == campaign["id"]


@pytest.mark.asyncio
async def test_stream_campaign_reports_rejected_draft_as_error_event() -> None:
    app.dependency_overrides[get_agent_gateway] = lambda: FakeAgentGateway(
        {"campaign-draft": draft(post(1), post(2, "Instagram"))}
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/v1/campaigns/stream", json=BRIEF)

    name, data = sse_events(response.text)[-1]
    assert name == "error"
    assert data == {"detail": "Campaign agent used an unrequested channel"}


@pytest.mark.asyncio
async def test_request_changes_requires_note_and_is_audited(client: AsyncClient) -> None:
    path = f"/v1/campaigns/{CAMPAIGN_ID}/posts/{CONTENT_ID}"
    missing_note = await client.patch(path, json={"status": "changes_requested"})
    response = await client.patch(
        path, json={"status": "changes_requested", "review_note": "Name the moment of use."}
    )

    assert missing_note.status_code == 422
    assert response.status_code == 200
    assert response.json()["status"] == "changes_requested"
    assert response.json()["posts"][0]["review_note"] == "Name the moment of use."
    events = (await client.get(f"/v1/campaigns/{CAMPAIGN_ID}/events")).json()
    assert events[0]["action"] == "changes_requested"
    assert events[0]["post_id"] == CONTENT_ID


@pytest.mark.asyncio
async def test_editing_an_approved_post_requires_fresh_approval(client: AsyncClient) -> None:
    path = f"/v1/campaigns/{CAMPAIGN_ID}/posts/{CONTENT_ID}"
    await client.patch(path, json={"status": "approved"})
    response = await client.patch(path, json={"content": "A sharper opening line."})

    edited = response.json()["posts"][0]
    assert edited["content"] == "A sharper opening line."
    assert edited["status"] == "needs_review"
    events = (await client.get(f"/v1/campaigns/{CAMPAIGN_ID}/events")).json()
    assert events[0]["detail"]["before"] == "Turn rough thoughts into polished messages."


@pytest.mark.asyncio
async def test_approve_campaign_approves_every_post(client: AsyncClient) -> None:
    await client.patch(
        f"/v1/campaigns/{CAMPAIGN_ID}/posts/{CONTENT_ID}",
        json={"status": "changes_requested", "review_note": "Shorter."},
    )
    response = await client.post(f"/v1/campaigns/{CAMPAIGN_ID}/approve")

    body = response.json()
    assert body["status"] == "approved"
    assert all(item["review_note"] is None for item in body["posts"])


@pytest.mark.asyncio
async def test_unknown_campaign_and_post_return_not_found(client: AsyncClient) -> None:
    unknown = "99999999-9999-4999-8999-999999999999"
    assert (await client.get(f"/v1/campaigns/{unknown}")).status_code == 404
    assert (await client.post(f"/v1/campaigns/{unknown}/approve")).status_code == 404
    response = await client.patch(
        f"/v1/campaigns/{CAMPAIGN_ID}/posts/{unknown}", json={"status": "approved"}
    )
    assert response.status_code == 404


async def test_agent_runs_stop_at_the_daily_limit(
    client: AsyncClient, campaign_store: FakeCampaignStore, agent_quota: FakeAgentQuota
) -> None:
    agent_quota.limit = 1
    assert (await client.post("/v1/campaigns", json=BRIEF)).status_code == 201

    response = await client.post("/v1/campaigns/stream", json=BRIEF)

    assert response.status_code == 429
    assert response.json()["detail"].startswith("The agent has reached today's limit.")
    assert [kind for _, kind in agent_quota.claims] == ["campaign_draft"]
