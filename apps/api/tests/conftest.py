from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from uuid import UUID

import pytest

from app.campaigns.dependencies import get_campaign_store, get_campaign_store_scope
from app.campaigns.models import Campaign, Post
from app.campaigns.store import FakeCampaignStore
from app.jobs.agent_jobs import FakeAgentJobStore
from app.jobs.dependencies import get_agent_job_store
from app.main import app
from app.paypal.dependencies import get_optional_paypal_gateway
from app.quota import FakeAgentQuota, client_run_limit, client_studio_limit, get_agent_quota
from app.routes.agents import page_read_limit
from app.routes.paypal import webhook_rate_limit


@pytest.fixture(autouse=True)
def fresh_client_limits() -> None:
    # The per address limits live in the process, so each test starts with none used.
    client_run_limit.hits.clear()
    client_studio_limit.hits.clear()
    page_read_limit.hits.clear()
    webhook_rate_limit.hits.clear()


CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111"
CONTENT_ID = "22222222-2222-4222-8222-222222222222"
SECOND_CONTENT_ID = "33333333-3333-4333-8333-333333333333"


def demo_campaign() -> Campaign:
    return Campaign(
        id=UUID(CAMPAIGN_ID),
        name="Professional communication week",
        positioning="Write clearly wherever work happens.",
        product_name="Scribe AI Keyboard",
        product_description="An AI keyboard that rewrites messages inside any app.",
        audience="Knowledge workers aged 25 to 40",
        objective="Increase qualified app installs",
        channels=["LinkedIn", "X"],
        brand_voice="Clear, confident, useful",
        starts_on=date(2026, 10, 12),
        created_at=datetime(2026, 10, 9, tzinfo=UTC),
        posts=[
            Post(
                id=UUID(CONTENT_ID),
                day=1,
                channel="LinkedIn",
                theme="A clearer workday",
                content="Turn rough thoughts into polished messages.",
                call_to_action="Try Scribe today.",
                status="needs_review",
                review_note=None,
            ),
            Post(
                id=UUID(SECOND_CONTENT_ID),
                day=2,
                channel="X",
                theme="Better wording",
                content="Keep your meaning. Improve the wording.",
                call_to_action="Download Scribe.",
                status="needs_review",
                review_note=None,
            ),
        ],
    )


@pytest.fixture(autouse=True)
def campaign_store() -> FakeCampaignStore:
    store = FakeCampaignStore([demo_campaign()])
    app.dependency_overrides[get_campaign_store] = lambda: store

    @asynccontextmanager
    async def scope() -> AsyncIterator[FakeCampaignStore]:
        yield store

    app.dependency_overrides[get_campaign_store_scope] = lambda: scope
    return store


@pytest.fixture(autouse=True)
def agent_jobs() -> FakeAgentJobStore:
    jobs = FakeAgentJobStore()
    app.dependency_overrides[get_agent_job_store] = lambda: jobs
    return jobs


@pytest.fixture(autouse=True)
def agent_quota() -> FakeAgentQuota:
    quota = FakeAgentQuota()
    app.dependency_overrides[get_agent_quota] = lambda: quota
    return quota


@pytest.fixture(autouse=True)
def no_paypal_checks() -> None:
    # Tests never reach the real PayPal sandbox. A test that needs lookups overrides this.
    app.dependency_overrides[get_optional_paypal_gateway] = lambda: None
