from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import BaseModel

from app.campaigns.dependencies import get_campaign_store
from app.campaigns.store import CampaignStore
from app.config import get_settings
from app.paypal.dependencies import get_paypal_gateway
from app.paypal.gateway import Offer, PayPalAPIError, PayPalGateway
from app.paypal.store import PaymentStore
from app.paypal.store_dependencies import get_payment_store
from app.workspaces import WorkspaceId

router = APIRouter(prefix="/v1/paypal", tags=["paypal"])

OFFERS = {
    "scribe-pro": Offer(
        id="scribe-pro",
        name="Scribe Pro",
        description="Scribe Monthly Pro with 200 writing actions per day",
        amount=Decimal("12.00"),
        currency="USD",
    )
}


class CreateOrderRequest(BaseModel):
    offer_id: str
    campaign_id: UUID
    content_id: UUID


class OrderResponse(BaseModel):
    order_id: str
    status: str


class CaptureResponse(BaseModel):
    order_id: str
    capture_id: str
    status: str
    amount: str
    currency: str


class WebhookResponse(BaseModel):
    accepted: bool
    event_id: str
    event_type: str


class PayPalConfigResponse(BaseModel):
    client_id: str
    environment: str
    currency: str


class RevenueSummaryResponse(BaseModel):
    campaign_id: UUID
    completed_orders: int
    gross_revenue: str
    currency: str
    latest_capture_id: str | None


@router.get("/config", response_model=PayPalConfigResponse)
async def get_paypal_config(_workspace_id: WorkspaceId) -> PayPalConfigResponse:
    settings = get_settings()
    if settings.paypal_client_id is None:
        raise HTTPException(status_code=503, detail="PayPal is not configured")
    return PayPalConfigResponse(
        client_id=settings.paypal_client_id.get_secret_value(),
        environment=settings.paypal_environment,
        currency="USD",
    )


@router.post("/orders", response_model=OrderResponse)
async def create_order(
    request: CreateOrderRequest,
    gateway: Annotated[PayPalGateway, Depends(get_paypal_gateway)],
    store: Annotated[PaymentStore, Depends(get_payment_store)],
    campaigns: Annotated[CampaignStore, Depends(get_campaign_store)],
    workspace_id: WorkspaceId,
) -> OrderResponse:
    offer = OFFERS.get(request.offer_id)
    if offer is None:
        raise HTTPException(status_code=404, detail="Offer not found")
    campaign = await campaigns.get(workspace_id=workspace_id, campaign_id=request.campaign_id)
    if campaign is None or all(post.id != request.content_id for post in campaign.posts):
        raise HTTPException(status_code=404, detail="Campaign content not found")
    attribution_id = f"{request.campaign_id}:{request.content_id}"
    request_id = uuid4()
    try:
        order = await gateway.create_order(
            offer=offer,
            attribution_id=attribution_id,
            request_id=str(request_id),
        )
    except PayPalAPIError as error:
        raise HTTPException(status_code=502, detail="PayPal could not create the order") from error
    await store.record_order(
        workspace_id=workspace_id,
        offer=offer,
        campaign_id=request.campaign_id,
        content_id=request.content_id,
        paypal_order_id=order.id,
        idempotency_key=request_id,
    )
    return OrderResponse(order_id=order.id, status=order.status)


@router.post("/orders/{order_id}/capture", response_model=CaptureResponse)
async def capture_order(
    gateway: Annotated[PayPalGateway, Depends(get_paypal_gateway)],
    store: Annotated[PaymentStore, Depends(get_payment_store)],
    workspace_id: WorkspaceId,
    order_id: Annotated[str, Path(pattern=r"^[A-Z0-9-]{6,64}$")],
) -> CaptureResponse:
    if not await store.owns_order(workspace_id=workspace_id, paypal_order_id=order_id):
        raise HTTPException(status_code=404, detail="PayPal order not found")
    try:
        capture = await gateway.capture_order(order_id=order_id, request_id=str(uuid4()))
    except PayPalAPIError as error:
        raise HTTPException(status_code=502, detail="PayPal could not capture the order") from error
    try:
        await store.record_capture(capture)
    except LookupError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return CaptureResponse(
        order_id=capture.order_id,
        capture_id=capture.capture_id,
        status=capture.status,
        amount=capture.amount,
        currency=capture.currency,
    )


@router.post("/webhooks", response_model=WebhookResponse)
async def receive_webhook(
    request: Request,
    gateway: Annotated[PayPalGateway, Depends(get_paypal_gateway)],
    store: Annotated[PaymentStore, Depends(get_payment_store)],
) -> WebhookResponse:
    event: dict[str, Any] = await request.json()
    try:
        valid = await gateway.verify_webhook(headers=request.headers, event=event)
    except PayPalAPIError as error:
        raise HTTPException(
            status_code=502,
            detail="PayPal could not verify the webhook",
        ) from error
    if not valid:
        raise HTTPException(status_code=400, detail="Invalid PayPal webhook signature")
    event_id = event.get("id")
    event_type = event.get("event_type")
    if not isinstance(event_id, str) or not isinstance(event_type, str):
        raise HTTPException(status_code=422, detail="Invalid PayPal webhook event")
    resource = event.get("resource", {})
    if not isinstance(resource, dict):
        raise HTTPException(status_code=422, detail="Invalid PayPal webhook resource")
    await store.record_webhook(
        event_id=event_id,
        event_type=event_type,
        resource=resource,
    )
    return WebhookResponse(accepted=True, event_id=event_id, event_type=event_type)


@router.get("/revenue/{campaign_id}", response_model=RevenueSummaryResponse)
async def get_revenue_summary(
    campaign_id: UUID,
    store: Annotated[PaymentStore, Depends(get_payment_store)],
    campaigns: Annotated[CampaignStore, Depends(get_campaign_store)],
    workspace_id: WorkspaceId,
) -> RevenueSummaryResponse:
    if await campaigns.get(workspace_id=workspace_id, campaign_id=campaign_id) is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    summary = await store.revenue_summary(campaign_id=campaign_id)
    return RevenueSummaryResponse(
        campaign_id=campaign_id,
        completed_orders=summary.completed_orders,
        gross_revenue=f"{summary.gross_revenue:.2f}",
        currency=summary.currency,
        latest_capture_id=summary.latest_capture_id,
    )
