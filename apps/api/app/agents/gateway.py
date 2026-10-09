import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol, TypeVar

from openai import AsyncOpenAI
from pydantic import BaseModel

OutputT = TypeVar("OutputT", bound=BaseModel)


@dataclass(frozen=True)
class AgentRun[ResultT: BaseModel]:
    output: ResultT
    session_id: str | None = None
    turn_id: str | None = None


@dataclass(frozen=True)
class AgentProgress:
    """A step the agent actually reached, reported while the run streams."""

    stage: Literal["session_started", "thinking", "writing", "checking"]
    detail: str | None = None
    items: int = 0


ProgressCallback = Callable[[AgentProgress], Awaitable[None]]

# Each structured item the agent writes opens with a "day" key, so counting keys in the
# streamed JSON tells how many items have started. Escaped quotes inside strings never match.
_ITEM_KEY = re.compile(r'(?<!\\)"day"\s*:')
_TURN_ENDED = {
    "agent.session.turn.completed",
    "agent.session.turn.failed",
    "agent.session.turn.cancelled",
    "agent.session.failed",
    "error",
}


class _ProgressTracker:
    def __init__(self, report: ProgressCallback) -> None:
        self._report = report
        self._text = ""
        self._items = 0

    async def accept(self, event: Any) -> None:
        if event.type == "agent.session.created":
            await self._report(AgentProgress("session_started"))
        elif event.type == "agent.session.turn.in_progress":
            await self._report(AgentProgress("thinking"))
        elif event.type == "agent.session.turn.reasoning_summary_text.done":
            await self._report(AgentProgress("thinking", detail=event.text))
        elif event.type == "agent.session.turn.output_text.delta":
            self._text += event.delta
            items = len(_ITEM_KEY.findall(self._text))
            if items > self._items:
                self._items = items
                await self._report(AgentProgress("writing", items=items))


class AgentGateway(Protocol):
    async def run_structured(
        self,
        *,
        workflow: str,
        instructions: str,
        input_text: str,
        output_type: type[OutputT],
        on_progress: ProgressCallback | None = None,
    ) -> AgentRun[OutputT]: ...


class OpenAIAgentGateway:
    """OpenAI-hosted agent adapter with schema-validated output."""

    def __init__(self, *, api_key: str, model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def run_structured(
        self,
        *,
        workflow: str,
        instructions: str,
        input_text: str,
        output_type: type[OutputT],
        on_progress: ProgressCallback | None = None,
    ) -> AgentRun[OutputT]:
        stream = await self._client.beta.agents.sessions.create(
            agent={
                "model": self._model,
                "instructions": instructions,
                "reasoning": {"effort": "low"},
                "text": {"verbosity": "low"},
            },
            environment={"type": "openai_hosted"},
            input=input_text,
            metadata={"workflow": workflow},
            output_type=output_type,
            stream=True,
        )
        if on_progress is not None:
            tracker = _ProgressTracker(on_progress)
            async for event in stream.with_result_collection():
                await tracker.accept(event)
                if event.type in _TURN_ENDED:
                    break
        result = await stream.get_final_result()
        if result.output_parsed is None:
            raise RuntimeError("Agent completed without structured output")
        return AgentRun(
            output=result.output_parsed,
            session_id=result.session_id,
            turn_id=result.turn_id,
        )


class FakeAgentGateway:
    """Deterministic test adapter. Fixtures must be explicit at construction."""

    def __init__(self, fixtures: dict[str, BaseModel]) -> None:
        self._fixtures = fixtures

    async def run_structured(
        self,
        *,
        workflow: str,
        instructions: str,
        input_text: str,
        output_type: type[OutputT],
        on_progress: ProgressCallback | None = None,
    ) -> AgentRun[OutputT]:
        del instructions, input_text
        fixture = self._fixtures.get(workflow)
        if fixture is None:
            raise LookupError(f"No fake agent fixture for workflow: {workflow}")
        if on_progress is not None:
            await on_progress(AgentProgress("session_started"))
            await on_progress(AgentProgress("thinking", detail="Planning the fixture run."))
            for items in range(1, len(getattr(fixture, "posts", [])) + 1):
                await on_progress(AgentProgress("writing", items=items))
        return AgentRun(
            output=output_type.model_validate(fixture.model_dump()),
            session_id="fake-session",
            turn_id="fake-turn",
        )
