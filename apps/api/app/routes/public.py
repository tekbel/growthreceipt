"""Routes a customer reaches from a campaign post. They need no sign in.

The post id in the buy link decides the campaign, the workspace and the
offer on the server. Only approved posts can take a payment.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel

from app.campaigns.dependencies import get_campaign_store
from app.campaigns.store import CampaignStore, PostLocation
from app.config import get_settings
from app.paypal.dependencies import get_paypal_gateway
from app.paypal.gateway import PayPalGateway
from app.paypal.store import PaymentStore
from app.paypal.store_dependencies import get_payment_store
from app.rate_limit import RateLimit
from app.routes.paypal import OFFERS, CaptureResponse, OrderResponse, open_order, settle_order

router = APIRouter(prefix="/v1/public", tags=["public"])

OFFER = OFFERS["launchcheck-scan-pack"]
ORDERS_PER_HOUR = 20


class PublicOfferResponse(BaseModel):
    content_id: UUID
    product_name: str
    product_icon_url: str | None
    offer_name: str
    offer_description: str
    amount: str
    currency: str
    client_id: str
    environment: str
    sandbox_buyer_email: str | None = None
    sandbox_buyer_password: str | None = None


class PublicOrderRequest(BaseModel):
    content_id: UUID


order_rate_limit = RateLimit(
    ORDERS_PER_HOUR,
    window_seconds=3600,
    detail="Too many checkout attempts. Please try again later.",
)


async def approved_post(content_id: UUID, campaigns: CampaignStore) -> PostLocation:
    location = await campaigns.find_post(content_id=content_id)
    if location is None or location.post.status != "approved":
        raise HTTPException(status_code=404, detail="This offer is not available")
    return location


@router.get("/offers/{content_id}", response_model=PublicOfferResponse)
async def get_offer(
    content_id: UUID,
    campaigns: Annotated[CampaignStore, Depends(get_campaign_store)],
) -> PublicOfferResponse:
    location = await approved_post(content_id, campaigns)
    settings = get_settings()
    if settings.paypal_client_id is None:
        raise HTTPException(status_code=503, detail="PayPal is not configured")
    sandbox = settings.paypal_environment == "sandbox"
    return PublicOfferResponse(
        content_id=content_id,
        product_name=location.campaign.product_name,
        product_icon_url=location.campaign.product_icon_url,
        offer_name=OFFER.name,
        offer_description=OFFER.description,
        amount=str(OFFER.amount),
        currency=OFFER.currency,
        client_id=settings.paypal_client_id.get_secret_value(),
        environment=settings.paypal_environment,
        sandbox_buyer_email=settings.paypal_sandbox_buyer_email if sandbox else None,
        sandbox_buyer_password=settings.paypal_sandbox_buyer_password if sandbox else None,
    )


@router.post(
    "/orders",
    response_model=OrderResponse,
    dependencies=[Depends(order_rate_limit)],
)
async def create_order(
    request: PublicOrderRequest,
    gateway: Annotated[PayPalGateway, Depends(get_paypal_gateway)],
    store: Annotated[PaymentStore, Depends(get_payment_store)],
    campaigns: Annotated[CampaignStore, Depends(get_campaign_store)],
) -> OrderResponse:
    location = await approved_post(request.content_id, campaigns)
    return await open_order(
        gateway=gateway,
        store=store,
        workspace_id=location.workspace_id,
        offer=OFFER,
        campaign_id=location.campaign.id,
        content_id=request.content_id,
    )


@router.post("/orders/{order_id}/capture", response_model=CaptureResponse)
async def capture_order(
    gateway: Annotated[PayPalGateway, Depends(get_paypal_gateway)],
    store: Annotated[PaymentStore, Depends(get_payment_store)],
    order_id: Annotated[str, Path(pattern=r"^[A-Z0-9-]{6,64}$")],
) -> CaptureResponse:
    # Only orders this server opened can be captured. PayPal itself refuses a
    # capture until the buyer approved the payment.
    if await store.order_workspace(paypal_order_id=order_id) is None:
        raise HTTPException(status_code=404, detail="PayPal order not found")
    return await settle_order(gateway=gateway, store=store, order_id=order_id)
