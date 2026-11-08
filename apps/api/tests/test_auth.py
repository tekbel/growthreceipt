from typing import Literal

import pytest
from fastapi import HTTPException

from app.auth import get_current_actor
from app.config import Settings


@pytest.mark.parametrize("app_env", ["staging", "production"])
async def test_hosted_api_without_supabase_refuses_every_request(
    app_env: Literal["staging", "production"],
) -> None:
    settings = Settings(app_env=app_env, auth_required=False)

    with pytest.raises(HTTPException) as refused:
        await get_current_actor(settings=settings, gateway=None, authorization=None)

    assert refused.value.status_code == 503


async def test_local_api_without_supabase_uses_the_demo_workspace() -> None:
    actor = await get_current_actor(
        settings=Settings(app_env="local"), gateway=None, authorization=None
    )

    assert actor.user_id is None and actor.is_anonymous
