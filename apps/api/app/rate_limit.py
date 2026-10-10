import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


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
        key = "all"
        if self.per_client:
            key = request.client.host if request.client else "unknown"
        now = time.monotonic()
        hits = self.hits[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            raise HTTPException(status_code=429, detail=self.detail)
        hits.append(now)
