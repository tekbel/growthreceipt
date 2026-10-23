import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
def transport() -> ASGITransport:
    return ASGITransport(app=app)


@pytest.mark.asyncio
async def test_liveness_has_no_dependency_check(transport: ASGITransport) -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": None}


@pytest.mark.asyncio
async def test_api_root(transport: ASGITransport) -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/v1")
    assert response.status_code == 200
    assert response.json()["version"] == "0.1.0"


@pytest.mark.asyncio
async def test_version_reports_the_deployed_commit(
    transport: ASGITransport, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "abc123")
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health/version")
    assert response.json() == {"commit": "abc123"}
