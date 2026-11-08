from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import app
from app.quota import FakeAgentQuota, client_studio_limit
from app.routes.studio import StudioModelError, get_studio_model

SSE = [
    b'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"Hi"}\n\n',
    b'data: {"type":"response.completed","response":{"id":"resp_1","output":[]}}\n\n',
]
TURN = {
    "input": [
        {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "?"}]}
    ],
    "instructions": "You build dashboards.",
    "tools": [{"type": "function", "name": "view_schema", "parameters": {}}],
    "tool_choice": "auto",
    "text": {"format": {"type": "text"}},
    "model": "gpt-expensive",
    "max_output_tokens": 999_999,
    "reasoning": {"effort": "high"},
}


class FakeStudioModel:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.bodies: list[dict[str, Any]] = []

    async def stream(self, body: dict[str, Any]) -> AsyncIterator[bytes]:
        self.bodies.append(body)
        if self.fail:
            raise StudioModelError("OpenAI returned 500")
        for chunk in SSE:
            yield chunk


@pytest.fixture
def model() -> Iterator[FakeStudioModel]:
    fake = FakeStudioModel()
    app.dependency_overrides[get_studio_model] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_studio_model, None)


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def test_turn_streams_the_model_and_keeps_server_limits(
    client: AsyncClient, model: FakeStudioModel, agent_quota: FakeAgentQuota
) -> None:
    response = await client.post("/v1/studio/ai/responses", json=TURN)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.content == b"".join(SSE)
    body = model.bodies[0]
    settings = get_settings()
    assert body["model"] == (settings.studio_ai_model or settings.openai_model)
    assert body["max_output_tokens"] == settings.studio_ai_max_output_tokens
    assert body["reasoning"]["effort"] == "low"
    assert body["stream"] is True and body["store"] is False
    assert body["instructions"] == "You build dashboards."
    assert body["tools"] == TURN["tools"]
    assert [kind for _, kind in agent_quota.claims] == ["studio_turn"]


async def test_turn_stops_at_the_daily_limit(
    client: AsyncClient, model: FakeStudioModel, agent_quota: FakeAgentQuota
) -> None:
    agent_quota.limit = 0

    response = await client.post("/v1/studio/ai/responses", json=TURN)

    assert response.status_code == 429
    assert model.bodies == []


async def test_turn_reports_a_model_failure(client: AsyncClient, model: FakeStudioModel) -> None:
    model.fail = True

    response = await client.post("/v1/studio/ai/responses", json=TURN)

    assert response.status_code == 502


async def test_turn_needs_a_configured_model(client: AsyncClient) -> None:
    app.dependency_overrides[get_studio_model] = lambda: None
    try:
        response = await client.post("/v1/studio/ai/responses", json=TURN)
    finally:
        app.dependency_overrides.pop(get_studio_model, None)

    assert response.status_code == 503


async def test_turn_rejects_an_unknown_effort(client: AsyncClient, model: FakeStudioModel) -> None:
    response = await client.post("/v1/studio/ai/responses", json={**TURN, "effort": "high"})

    assert response.status_code == 422
    assert model.bodies == []


@pytest.mark.parametrize(
    "change",
    [
        {"tools": [{"type": "web_search"}]},
        {"tools": [{"type": "mcp", "server_url": "https://example.com/mcp"}]},
        {"tool_choice": {"type": "code_interpreter"}},
        {"tool_choice": "web_search"},
    ],
)
async def test_hosted_tools_are_refused(
    client: AsyncClient,
    model: FakeStudioModel,
    agent_quota: FakeAgentQuota,
    change: dict[str, Any],
) -> None:
    response = await client.post("/v1/studio/ai/responses", json={**TURN, **change})

    assert response.status_code == 422
    assert model.bodies == []
    assert agent_quota.claims == []


async def test_an_oversized_turn_is_refused(
    client: AsyncClient,
    model: FakeStudioModel,
    agent_quota: FakeAgentQuota,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "studio_ai_max_input_chars", 1_000)
    big = {
        "type": "message",
        "role": "user",
        "content": [{"type": "input_text", "text": "x" * 2_000}],
    }

    response = await client.post("/v1/studio/ai/responses", json={**TURN, "input": [big]})

    assert response.status_code == 422
    assert model.bodies == []


async def test_one_address_cannot_spend_the_shared_budget_from_many_workspaces(
    client: AsyncClient,
    model: FakeStudioModel,
    agent_quota: FakeAgentQuota,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(client_studio_limit, "limit", 1)

    async def turn(address: str) -> int:
        headers = {"X-Forwarded-For": address}
        return (
            await client.post("/v1/studio/ai/responses", json=TURN, headers=headers)
        ).status_code

    assert [await turn("203.0.113.7"), await turn("203.0.113.7"), await turn("198.51.100.4")] == [
        200,
        429,
        200,
    ]
    # The refused address never took a turn from the shared daily budget.
    assert len(agent_quota.claims) == 2
