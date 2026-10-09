from functools import lru_cache

from app.agents.gateway import AgentGateway, OpenAIAgentGateway
from app.config import get_settings


@lru_cache
def get_agent_gateway() -> AgentGateway:
    settings = get_settings()
    if settings.openai_api_key is None:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    return OpenAIAgentGateway(
        api_key=settings.openai_api_key.get_secret_value(),
        model=settings.openai_model,
    )
