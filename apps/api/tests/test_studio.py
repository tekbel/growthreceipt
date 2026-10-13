from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import app
from app.quota import FakeAgentQuota
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
