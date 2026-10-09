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
    auth_required: bool = False
    supabase_url: str | None = None
    supabase_publishable_key: SecretStr | None = None
    demo_workspace_id: UUID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")


@lru_cache
def get_settings() -> Settings:
    return Settings()
