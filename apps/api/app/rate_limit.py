import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

# Above this many tracked clients, idle ones are dropped so forged or rotating
# addresses cannot grow memory without bound.
MAX_TRACKED = 10_000


def client_address(request: Request) -> str:
    """The address that connected to Railway's edge.

    Railway's proxy puts the peer it saw last in X-Forwarded-For. Anything before it was sent by
    the client and can be forged, so only the last entry counts. Uvicorn's own proxy handling
    trusts the first entry, so request.client is not used when the header is present.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    last = forwarded.rsplit(",", 1)[-1].strip()
    if last:
        return last
    return request.client.host if request.client else "unknown"


class RateLimit:
    """Caps calls per client address, or across all clients. One process, so memory is enough."""

    def __init__(
        self, limit: int, *, window_seconds: float, detail: str, per_client: bool = True
    ) -> None:
        self.limit = limit
        self.window = window_seconds
        self.detail = detail
        self.per_client = per_client
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def __call__(self, request: Request) -> None:
        self.hit(client_address(request) if self.per_client else "all")

    def hit(self, key: str) -> None:
        now = time.monotonic()
        if key not in self.hits and len(self.hits) >= MAX_TRACKED:
            self._drop_idle(now)
        hits = self.hits[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            raise HTTPException(status_code=429, detail=self.detail)
        hits.append(now)

    def _drop_idle(self, now: float) -> None:
        idle = [key for key, hits in self.hits.items() if not hits or now - hits[-1] > self.window]
        for key in idle:
            del self.hits[key]
        # Still full of active clients: forget the oldest, so memory stays bounded.
        while len(self.hits) >= MAX_TRACKED:
            del self.hits[next(iter(self.hits))]
