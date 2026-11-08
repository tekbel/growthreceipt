"""Proxy for the AG Studio dashboard assistant.

Studio runs the agent loop in the browser and asks for one model turn at a time. Each turn comes
here, so the OpenAI key stays on the server and the API decides the model, the output cap and how
many turns a workspace gets per day.
"""

import json
import time
from collections.abc import AsyncIterator
from typing import Annotated, Any, Literal, Protocol

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config import get_settings
from app.quota import ClientAddress, Quota, claim_run
from app.workspaces import WorkspaceId

router = APIRouter(prefix="/v1/studio", tags=["studio"])

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
# Seconds a single turn may stream before the API closes it.
TURN_DEADLINE = 120.0


class StudioModelError(Exception):
    pass


class StudioModel(Protocol):
    def stream(self, body: dict[str, Any]) -> AsyncIterator[bytes]:
        """Yield the provider's SSE bytes. Raise StudioModelError before the first chunk."""
        ...


class OpenAIStudioModel:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def stream(self, body: dict[str, Any]) -> AsyncIterator[bytes]:
        timeout = httpx.Timeout(60.0, connect=10.0)
        headers = {"Authorization": f"Bearer {self._api_key}"}
        async with (
            httpx.AsyncClient(timeout=timeout) as client,
            client.stream("POST", OPENAI_RESPONSES_URL, json=body, headers=headers) as response,
        ):
            if response.status_code != 200:
                await response.aread()
                raise StudioModelError(f"OpenAI returned {response.status_code}")
            async for chunk in response.aiter_bytes():
                yield chunk


def get_studio_model() -> StudioModel | None:
    key = get_settings().openai_api_key
    return OpenAIStudioModel(key.get_secret_value()) if key else None


Model = Annotated[StudioModel | None, Depends(get_studio_model)]


class StudioTurn(BaseModel):
    """The OpenAI Responses fields Studio's adapter sends. Anything else is dropped."""

    model_config = ConfigDict(extra="ignore")

    input: list[dict[str, Any]] = Field(max_length=400)
    instructions: str | None = Field(default=None, max_length=60_000)
    tools: list[dict[str, Any]] = Field(default_factory=list, max_length=64)
    tool_choice: str | dict[str, Any] | None = None
    text: dict[str, Any] | None = None
    effort: Literal["low", "medium"] = "low"

    @field_validator("tools")
    @classmethod
    def function_tools_only(cls, tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        # Studio only sends function tools. Hosted tools (web search, code interpreter, image
        # generation, remote MCP) would bill extra and could reach any server, so they are refused.
        if any(tool.get("type") != "function" for tool in tools):
            raise ValueError("Only function tools are allowed")
        return tools

    @field_validator("tool_choice")
    @classmethod
    def function_choice_only(
        cls, choice: str | dict[str, Any] | None
    ) -> str | dict[str, Any] | None:
        if isinstance(choice, str) and choice not in {"auto", "none", "required"}:
            raise ValueError("Unknown tool choice")
        if isinstance(choice, dict) and choice.get("type") != "function":
            raise ValueError("Only a function tool can be chosen")
        return choice

    @model_validator(mode="after")
    def bounded_size(self) -> "StudioTurn":
        # Each turn is billed by its input, so one turn may not send more than the cap.
        sent = (self.input, self.tools, self.instructions or "")
        size = sum(len(json.dumps(part)) for part in sent)
        if size > get_settings().studio_ai_max_input_chars:
            raise ValueError("This conversation is too long. Start a new one.")
        return self


def provider_body(turn: StudioTurn) -> dict[str, Any]:
    settings = get_settings()
    body: dict[str, Any] = {
        "model": settings.studio_ai_model or settings.openai_model,
        "input": turn.input,
        "tools": turn.tools,
        "reasoning": {"effort": turn.effort, "summary": "auto"},
        "parallel_tool_calls": True,
        "max_output_tokens": settings.studio_ai_max_output_tokens,
        "stream": True,
        "store": False,
    }
    if turn.instructions:
        body["instructions"] = turn.instructions
    if turn.tool_choice is not None:
        body["tool_choice"] = turn.tool_choice
    if turn.text is not None:
        body["text"] = turn.text
    return body


async def _until_deadline(first: bytes, rest: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
    started = time.monotonic()
    yield first
    async for chunk in rest:
        if time.monotonic() - started > TURN_DEADLINE:
            # Studio reports a turn that ends without a final response as failed.
            break
        yield chunk


@router.post("/ai/responses")
async def studio_turn(
    turn: StudioTurn, workspace_id: WorkspaceId, quota: Quota, client: ClientAddress, model: Model
) -> StreamingResponse:
    if model is None:
        raise HTTPException(status_code=503, detail="The dashboard assistant is not set up.")
    await claim_run(quota, workspace_id, "studio_turn", client)
    chunks = model.stream(provider_body(turn))
    try:
        first = await anext(chunks)
    except (StudioModelError, httpx.HTTPError, StopAsyncIteration) as error:
        raise HTTPException(
            status_code=502, detail="The assistant could not reach the model. Try again."
        ) from error
    return StreamingResponse(
        _until_deadline(first, chunks),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
