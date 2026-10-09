from dataclasses import dataclass
from typing import Protocol, TypeVar

from openai import AsyncOpenAI
from pydantic import BaseModel

OutputT = TypeVar("OutputT", bound=BaseModel)


@dataclass(frozen=True)
class AgentRun[ResultT: BaseModel]:
    output: ResultT
    session_id: str | None = None
    turn_id: str | None = None


class AgentGateway(Protocol):
    async def run_structured(
        self,
        *,
        workflow: str,
        instructions: str,
        input_text: str,
        output_type: type[OutputT],
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
    ) -> AgentRun[OutputT]:
        del instructions, input_text
        fixture = self._fixtures.get(workflow)
        if fixture is None:
            raise LookupError(f"No fake agent fixture for workflow: {workflow}")
        return AgentRun(
            output=output_type.model_validate(fixture.model_dump()),
            session_id="fake-session",
            turn_id="fake-turn",
        )
