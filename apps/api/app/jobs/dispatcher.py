from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID, uuid4


@dataclass(frozen=True)
class JobReceipt:
    id: UUID
    kind: str


class JobDispatcher(Protocol):
    async def dispatch(self, kind: str, payload: dict[str, Any]) -> JobReceipt: ...


class FakeJobDispatcher:
    def __init__(self) -> None:
        self.jobs: list[tuple[JobReceipt, dict[str, Any]]] = []

    async def dispatch(self, kind: str, payload: dict[str, Any]) -> JobReceipt:
        receipt = JobReceipt(id=uuid4(), kind=kind)
        self.jobs.append((receipt, payload.copy()))
        return receipt
