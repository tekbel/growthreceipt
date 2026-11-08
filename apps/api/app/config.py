from functools import lru_cache
from typing import Literal
from uuid import UUID

from pydantic import HttpUrl, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["local", "test", "staging", "production"] = "local"
    app_name: str = "GrowthReceipt API"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    web_origin: HttpUrl = HttpUrl("http://localhost:3000")
    database_url: str = "postgresql+asyncpg://northstar:northstar_local@localhost:54329/northstar"
    openai_api_key: SecretStr | None = None
    openai_model: str = "gpt-6-luna"
    paypal_environment: Literal["sandbox", "live"] = "sandbox"
    paypal_client_id: SecretStr | None = None
    paypal_client_secret: SecretStr | None = None
    paypal_webhook_id: SecretStr | None = None
    # Sandbox test buyer shown on the checkout so judges can pay. Sandbox only.
    paypal_sandbox_buyer_email: str | None = None
    paypal_sandbox_buyer_password: str | None = None
    auth_required: bool = False
    supabase_url: str | None = None
    supabase_publishable_key: SecretStr | None = None
    agent_runs_per_workspace_day: int = 20
    agent_runs_per_day: int = 150
    # The dashboard assistant takes several model turns per question, so it has its own limits.
    studio_ai_model: str | None = None
    studio_ai_max_output_tokens: int = 6_000
    studio_turns_per_workspace_day: int = 60
    studio_turns_per_day: int = 300
    demo_workspace_id: UUID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    linkedin_client_id: str | None = None
    linkedin_client_secret: SecretStr | None = None
    # A Fernet key. It encrypts stored LinkedIn tokens and signs the OAuth state.
    linkedin_token_key: SecretStr | None = None
    linkedin_publish_interval_seconds: int = 300

    @property
    def linkedin_configured(self) -> bool:
        return bool(
            self.linkedin_client_id and self.linkedin_client_secret and self.linkedin_token_key
        )

    @property
    def linkedin_redirect_uri(self) -> str:
        return f"{str(self.web_origin).rstrip('/')}/integrations/linkedin/callback"


@lru_cache
def get_settings() -> Settings:
    return Settings()
