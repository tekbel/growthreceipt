from functools import lru_cache

from fastapi import HTTPException

from app.config import get_settings
from app.paypal.gateway import HttpPayPalGateway, PayPalGateway


@lru_cache
def get_paypal_gateway() -> PayPalGateway:
    settings = get_settings()
    if (
        settings.paypal_client_id is None
        or settings.paypal_client_secret is None
        or settings.paypal_webhook_id is None
    ):
        raise HTTPException(status_code=503, detail="PayPal sandbox is not configured")
    return HttpPayPalGateway(
        client_id=settings.paypal_client_id.get_secret_value(),
        client_secret=settings.paypal_client_secret.get_secret_value(),
        webhook_id=settings.paypal_webhook_id.get_secret_value(),
        environment=settings.paypal_environment,
    )


def get_optional_paypal_gateway() -> PayPalGateway | None:
    """The PayPal gateway when it is configured, so a feature can run without PayPal checks."""
    try:
        return get_paypal_gateway()
    except HTTPException:
        return None
