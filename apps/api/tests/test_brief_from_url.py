import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.agents.dependencies import get_agent_gateway
from app.agents.gateway import FakeAgentGateway
from app.campaigns.page_reader import (
    PageReadError,
    ProductPage,
    check_url,
    read_product_page,
)
from app.jobs.agent_jobs import FakeAgentJobStore
from app.main import app
from app.quota import FakeAgentQuota, get_agent_quota
from app.routes.agents import BriefSuggestion, get_page_reader

PAGE = b"""<html><head><title>LaunchCheck | Scan</title>
<meta name="description" content="Find launch issues on any public page.">
<meta property="og:image" content="/og.png">
<link rel="icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
<link rel="apple-touch-icon" href="/apple-icon.png">
<script>alert("ignore me")</script></head>
<body><h1>LaunchCheck</h1><p>Scan your page before launch.</p></body></html>"""


def resolver(table: dict[str, list[str]]):
    async def resolve(host: str) -> list[str]:
        return table[host]

    return resolve


PUBLIC = resolver({"example.com": ["93.184.215.14"], "evil.example": ["10.0.0.5"]})


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "http://example.com",
        "file:///etc/passwd",
        "https://example.com:8443/",
        "https://user:pass@example.com/",
        "https://evil.example/",
    ],
)
async def test_check_url_rejects_unsafe_links(url: str) -> None:
    with pytest.raises(PageReadError):
        await check_url(url, PUBLIC)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "address", ["127.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fe80::1%lo0"]
)
async def test_check_url_rejects_private_addresses(address: str) -> None:
    with pytest.raises(PageReadError):
        await check_url("https://example.com/", resolver({"example.com": [address]}))


@pytest.mark.asyncio
async def test_read_product_page_extracts_title_description_and_text() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=PAGE, headers={"content-type": "text/html"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        page = await read_product_page("https://example.com/", client=client, resolve=PUBLIC)

    assert page.title == "LaunchCheck | Scan"
    assert page.description == "Find launch issues on any public page."
    assert page.image_url == "https://example.com/apple-icon.png"
    assert page.text == "LaunchCheck Scan your page before launch."


@pytest.mark.asyncio
async def test_read_product_page_uses_an_svg_icon_when_it_is_the_only_one() -> None:
    page_html = b"""<html><head><title>LaunchCheck</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"></head><body>Scan</body></html>"""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=page_html, headers={"content-type": "text/html"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        page = await read_product_page("https://example.com/", client=client, resolve=PUBLIC)

    assert page.image_url == "https://example.com/favicon.svg"


@pytest.mark.asyncio
async def test_read_product_page_checks_every_redirect() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://evil.example/admin"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(PageReadError, match="public site"):
            await read_product_page("https://example.com/", client=client, resolve=PUBLIC)


@pytest.mark.asyncio
async def test_read_product_page_rejects_non_html() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"%PDF", headers={"content-type": "application/pdf"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(PageReadError, match="not a web page"):
            await read_product_page("https://example.com/", client=client, resolve=PUBLIC)


@pytest.mark.asyncio
async def test_brief_from_url_returns_suggestion_and_icon(agent_jobs: FakeAgentJobStore) -> None:
    suggestion = BriefSuggestion(
        product_name="LaunchCheck",
        product_description="Scans a public page for launch issues.",
        audience="Indie makers about to launch",
        objective="Get first paying customers for the scan pack",
        brand_voice="Clear, practical, calm",
    )

    async def read_page(url: str) -> ProductPage:
        return ProductPage(
            url=url,
            title="LaunchCheck",
            description="Find launch issues on any public page.",
            image_url="https://example.com/og.png",
            text="Scan your page before launch.",
        )

    async def refuse(url: str) -> ProductPage:
        raise PageReadError("That link does not point to a public site.")

    app.dependency_overrides[get_agent_gateway] = lambda: FakeAgentGateway(
        {"brief-from-url": suggestion}
    )
    app.dependency_overrides[get_page_reader] = lambda: read_page
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/v1/agents/brief-from-url", json={"url": "https://example.com/"}
            )
            assert response.status_code == 200
            assert response.json() == {
                **suggestion.model_dump(),
                "product_icon_url": "https://example.com/og.png",
                "source_url": "https://example.com/",
            }
            [(_, job)] = agent_jobs.jobs.values()
            assert job.kind == "brief_from_url" and job.result == response.json()

            # A link that cannot be read does not use up a run, even with none left.
            app.dependency_overrides[get_agent_quota] = lambda: FakeAgentQuota(limit=0)
            app.dependency_overrides[get_page_reader] = lambda: refuse
            refused = await client.post(
                "/v1/agents/brief-from-url", json={"url": "https://10.0.0.5/"}
            )
            assert refused.status_code == 422
            assert refused.json()["detail"] == "That link does not point to a public site."
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_page_reads_are_rate_limited_before_any_fetch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.routes import agents

    monkeypatch.setattr(agents.page_read_limit, "limit", 1)
    reads: list[str] = []

    async def refuse(url: str) -> ProductPage:
        reads.append(url)
        raise PageReadError("That link does not point to a public site.")

    app.dependency_overrides[get_page_reader] = lambda: refuse
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            body = {"url": "https://example.com/"}
            first = await client.post("/v1/agents/brief-from-url", json=body)
            second = await client.post("/v1/agents/brief-from-url", json=body)
    finally:
        app.dependency_overrides.pop(get_page_reader, None)

    assert (first.status_code, second.status_code) == (422, 429)
    assert reads == ["https://example.com/"]
