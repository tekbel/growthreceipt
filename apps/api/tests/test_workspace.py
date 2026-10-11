from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.workspace_settings import FakeWorkspaceSettingsStore, get_workspace_settings_store


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    store = FakeWorkspaceSettingsStore()
    app.dependency_overrides[get_workspace_settings_store] = lambda: store
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.pop(get_workspace_settings_store, None)


async def test_settings_default_to_the_browser_time_zone(client: AsyncClient) -> None:
    response = await client.get("/v1/workspace/settings")

    assert response.status_code == 200
    assert response.json() == {"name": "My workspace", "timezone": None}


async def test_settings_save_name_and_time_zone(client: AsyncClient) -> None:
    response = await client.patch(
        "/v1/workspace/settings", json={"name": "  Launch team  ", "timezone": "Africa/Addis_Ababa"}
    )

    assert response.status_code == 200
    assert response.json() == {"name": "Launch team", "timezone": "Africa/Addis_Ababa"}
    saved = await client.get("/v1/workspace/settings")
    assert saved.json()["timezone"] == "Africa/Addis_Ababa"


@pytest.mark.parametrize(
    "body",
    [
        {"name": "   ", "timezone": None},
        {"name": "x" * 61, "timezone": None},
        {"name": "Team", "timezone": "Mars/Olympus"},
    ],
)
async def test_settings_reject_invalid_values(client: AsyncClient, body: dict[str, object]) -> None:
    response = await client.patch("/v1/workspace/settings", json=body)

    assert response.status_code == 422
