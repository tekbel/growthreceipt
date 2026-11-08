import pytest
from fastapi import HTTPException, Request

from app import rate_limit
from app.rate_limit import RateLimit, client_address


def request(forwarded: str | None = None) -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded is not None else []
    return Request({"type": "http", "headers": headers, "client": ("192.0.2.1", 1234)})


def test_the_client_is_the_hop_railway_added() -> None:
    assert client_address(request("10.0.0.1, 203.0.113.7")) == "203.0.113.7"
    assert client_address(request("203.0.113.7")) == "203.0.113.7"


def test_without_a_proxy_the_peer_is_the_client() -> None:
    assert client_address(request()) == "192.0.2.1"
    assert client_address(request("")) == "192.0.2.1"


def test_tracked_clients_stay_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rate_limit, "MAX_TRACKED", 3)
    limit = RateLimit(5, window_seconds=60, detail="Slow down")
    for n in range(10):
        limit.hit(f"198.51.100.{n}")

    assert len(limit.hits) <= 3
    assert "198.51.100.9" in limit.hits


def test_limit_refuses_past_the_cap() -> None:
    limit = RateLimit(1, window_seconds=60, detail="Slow down")
    limit.hit("203.0.113.7")

    with pytest.raises(HTTPException) as refused:
        limit.hit("203.0.113.7")
    assert refused.value.status_code == 429
