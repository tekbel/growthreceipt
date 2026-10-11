from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import pytest
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient

from app.campaigns.store import FakeCampaignStore
from app.config import get_settings
from app.linkedin.client import FakeLinkedInClient
from app.linkedin.crypto import STATE_TTL_SECONDS, TokenCipher
from app.linkedin.publisher import get_linkedin_client, get_token_cipher, publish_due_posts
from app.linkedin.store import FakeLinkedInStore, get_linkedin_store
from app.main import app
from app.workspace_settings import FakeWorkspaceSettingsStore, get_workspace_settings_store
from app.workspaces import WorkspaceContext, get_workspace_context

CAMPAIGN_ID = UUID("11111111-1111-4111-8111-111111111111")
LINKEDIN_POST = UUID("22222222-2222-4222-8222-222222222222")
X_POST = UUID("33333333-3333-4333-8333-333333333333")
WORKSPACE = get_settings().demo_workspace_id


@pytest.fixture
def cipher() -> TokenCipher:
    return TokenCipher(Fernet.generate_key().decode())


@pytest.fixture
def linkedin() -> FakeLinkedInClient:
    return FakeLinkedInClient()


@pytest.fixture
def store(campaign_store: FakeCampaignStore) -> FakeLinkedInStore:
    return FakeLinkedInStore(campaign_store)


@pytest.fixture
async def client(
    store: FakeLinkedInStore, linkedin: FakeLinkedInClient, cipher: TokenCipher
) -> AsyncIterator[AsyncClient]:
    settings = FakeWorkspaceSettingsStore()
    app.dependency_overrides[get_linkedin_store] = lambda: store
    app.dependency_overrides[get_linkedin_client] = lambda: linkedin
    app.dependency_overrides[get_token_cipher] = lambda: cipher
    app.dependency_overrides[get_workspace_settings_store] = lambda: settings
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        yield http
    for dependency in (
        get_linkedin_store,
        get_linkedin_client,
        get_token_cipher,
        get_workspace_settings_store,
    ):
        app.dependency_overrides.pop(dependency, None)


def approve(campaigns: FakeCampaignStore, post_id: UUID = LINKEDIN_POST) -> None:
    campaign = campaigns.campaigns[CAMPAIGN_ID]
    posts = [
        post.model_copy(update={"status": "approved"}) if post.id == post_id else post
        for post in campaign.posts
    ]
    campaigns.campaigns[CAMPAIGN_ID] = campaign.model_copy(update={"posts": posts})


async def connect(client: AsyncClient) -> dict[str, object]:
    authorize = await client.post("/v1/integrations/linkedin/authorize")
    state = parse_qs(urlparse(authorize.json()["url"]).query)["state"][0]
    response = await client.post(
        "/v1/integrations/linkedin/connect", json={"code": "abc", "state": state}
    )
    assert response.status_code == 200
    return response.json()


async def test_connect_stores_an_encrypted_token(
    client: AsyncClient, store: FakeLinkedInStore, cipher: TokenCipher
) -> None:
    status = await connect(client)

    assert status["connected"] is True
    assert status["member_name"] == "Ada Founder"
    assert status["auto_publish"] is False
    saved = store.connections[WORKSPACE]
    assert saved.access_token_encrypted != "token-abc"
    assert cipher.decrypt(saved.access_token_encrypted) == "token-abc"


async def test_connect_refuses_a_state_from_another_workspace(
    client: AsyncClient, cipher: TokenCipher, store: FakeLinkedInStore
) -> None:
    forged = cipher.sign_state(uuid4())

    response = await client.post(
        "/v1/integrations/linkedin/connect", json={"code": "abc", "state": forged}
    )

    assert response.status_code == 400
    assert store.connections == {}


def test_state_expires_and_rejects_tampering(cipher: TokenCipher) -> None:
    state = cipher.sign_state(WORKSPACE, now=1_000)

    assert cipher.state_matches(state, WORKSPACE, now=1_001)
    assert not cipher.state_matches(state, WORKSPACE, now=1_000 + STATE_TTL_SECONDS + 1)
    assert not cipher.state_matches(state + "x", WORKSPACE, now=1_001)


async def test_publish_posts_the_approved_post_with_its_buy_link(
    client: AsyncClient, campaign_store: FakeCampaignStore, linkedin: FakeLinkedInClient
) -> None:
    await connect(client)
    approve(campaign_store)

    response = await client.post(f"/v1/integrations/linkedin/posts/{LINKEDIN_POST}/publish")

    assert response.status_code == 200
    assert response.json()["url"] == "https://www.linkedin.com/feed/update/urn:li:share:1/"
    sent = linkedin.published[0]
    assert sent["author"] == "urn:li:person:abc123"
    assert sent["access_token"] == "token-abc"
    assert sent["text"].endswith(f"Try Scribe today. {sent['link']}")
    assert sent["link"].endswith(f"/buy/{LINKEDIN_POST}")
    post = campaign_store.campaigns[CAMPAIGN_ID].posts[0]
    assert post.published_url == response.json()["url"]
    _, event = campaign_store.event_log[-1]
    assert (event.actor, event.action) == ("human", "post_published")

    again = await client.post(f"/v1/integrations/linkedin/posts/{LINKEDIN_POST}/publish")
    assert again.status_code == 409
    edit = await client.patch(
        f"/v1/campaigns/{CAMPAIGN_ID}/posts/{LINKEDIN_POST}", json={"content": "Changed"}
    )
    assert edit.status_code == 409


@pytest.mark.parametrize("post_id", [LINKEDIN_POST, X_POST])
async def test_publish_refuses_unapproved_or_other_channel_posts(
    client: AsyncClient, campaign_store: FakeCampaignStore, post_id: UUID
) -> None:
    await connect(client)
    approve(campaign_store, X_POST)

    response = await client.post(f"/v1/integrations/linkedin/posts/{post_id}/publish")

    assert response.status_code == 409


async def test_publish_needs_a_connection(
    client: AsyncClient, campaign_store: FakeCampaignStore
) -> None:
    approve(campaign_store)

    response = await client.post(f"/v1/integrations/linkedin/posts/{LINKEDIN_POST}/publish")

    assert response.status_code == 502
    assert "Connect LinkedIn" in response.json()["detail"]


async def test_a_failed_publish_is_recorded_and_can_be_retried(
    client: AsyncClient, campaign_store: FakeCampaignStore, linkedin: FakeLinkedInClient
) -> None:
    await connect(client)
    approve(campaign_store)
    linkedin.fail_with = "LinkedIn refused the post (HTTP 422)."

    failed = await client.post(f"/v1/integrations/linkedin/posts/{LINKEDIN_POST}/publish")

    assert failed.status_code == 502
    _, event = campaign_store.event_log[-1]
    assert event.action == "publish_failed"
    assert campaign_store.campaigns[CAMPAIGN_ID].posts[0].published_at is None

    linkedin.fail_with = None
    retried = await client.post(f"/v1/integrations/linkedin/posts/{LINKEDIN_POST}/publish")
    assert retried.status_code == 200


async def test_disconnect_revokes_and_forgets_the_token(
    client: AsyncClient, store: FakeLinkedInStore, linkedin: FakeLinkedInClient
) -> None:
    await connect(client)

    response = await client.delete("/v1/integrations/linkedin")

    assert response.json()["connected"] is False
    assert linkedin.revoked == ["token-abc"]
    assert store.connections == {}


async def test_auto_publish_sends_only_due_posts_from_its_start_day(
    client: AsyncClient,
    store: FakeLinkedInStore,
    campaign_store: FakeCampaignStore,
    linkedin: FakeLinkedInClient,
    cipher: TokenCipher,
) -> None:
    await connect(client)
    approve(campaign_store)
    enabled = await client.patch("/v1/integrations/linkedin", json={"auto_publish": True})
    assert enabled.json()["auto_publish"] is True
    # The demo LinkedIn post is day 1 of a campaign starting 12 October 2026.
    connection = store.connections[WORKSPACE]
    store.connections[WORKSPACE] = replace(
        connection,
        auto_publish_since=date(2026, 10, 12),
        expires_at=datetime(2026, 12, 1, tzinfo=UTC),
    )

    before_nine = datetime(2026, 10, 12, 8, 30, tzinfo=UTC)
    assert await publish_due_posts(store, linkedin, cipher, before_nine) == 0

    store.connections[WORKSPACE] = replace(
        store.connections[WORKSPACE], auto_publish_since=date(2026, 10, 13)
    )
    after_nine = datetime(2026, 10, 12, 9, 30, tzinfo=UTC) + timedelta(days=1)
    assert await publish_due_posts(store, linkedin, cipher, after_nine) == 0

    store.connections[WORKSPACE] = replace(
        store.connections[WORKSPACE], auto_publish_since=date(2026, 10, 12)
    )
    assert await publish_due_posts(store, linkedin, cipher, after_nine) == 1
    _, event = campaign_store.event_log[-1]
    assert (event.actor, event.detail["trigger"]) == ("system", "scheduled")
    assert await publish_due_posts(store, linkedin, cipher, after_nine) == 0


async def test_the_shared_judge_demo_cannot_connect_or_post(
    client: AsyncClient, campaign_store: FakeCampaignStore, linkedin: FakeLinkedInClient
) -> None:
    approve(campaign_store)
    judge = WorkspaceContext(id=WORKSPACE, mode="judge")
    app.dependency_overrides[get_workspace_context] = lambda: judge
    try:
        status = await client.get("/v1/integrations/linkedin")
        authorize = await client.post("/v1/integrations/linkedin/authorize")
        publish = await client.post(f"/v1/integrations/linkedin/posts/{LINKEDIN_POST}/publish")
    finally:
        app.dependency_overrides.pop(get_workspace_context)

    assert status.json()["can_connect"] is False
    assert authorize.status_code == 403
    assert publish.status_code == 403
    assert linkedin.published == []
