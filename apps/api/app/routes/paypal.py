from datetime import datetime
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import BaseModel

from app.campaigns.dependencies import get_campaign_store
from app.campaigns.models import Campaign
from app.campaigns.store import CampaignStore
from app.config import get_settings
from app.offers import OFFERS
from app.paypal.dependencies import get_paypal_gateway
from app.paypal.gateway import Offer, PayPalAPIError, PayPalGateway
from app.paypal.store import PaymentStore, Receipt
from app.paypal.store_dependencies import get_payment_store
from app.workspaces import WorkspaceId

router = APIRouter(prefix="/v1/paypal", tags=["paypal"])


class CreateOrderRequest(BaseModel):
    # The campaign decides the offer. A stale id from an old page is refused.
    offer_id: str | None = None
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
    sandbox_buyer_email: str | None = None
    sandbox_buyer_password: str | None = None


class RevenueSummaryResponse(BaseModel):
    campaign_id: UUID
    completed_orders: int
    started_orders: int
    gross_revenue: str
    currency: str
    latest_capture_id: str | None


class WebhookProofResponse(BaseModel):
    event_id: str
    event_type: str
    received_at: datetime


class ReceiptResponse(BaseModel):
    order_id: str
    capture_id: str
    content_id: UUID
    offer_id: str
    amount: str
    currency: str
    ordered_at: datetime
    captured_at: datetime
    webhooks: list[WebhookProofResponse]

    @classmethod
    def of(cls, receipt: Receipt) -> "ReceiptResponse":
        return cls(
            order_id=receipt.paypal_order_id,
            capture_id=receipt.paypal_capture_id,
            content_id=receipt.content_id,
            offer_id=receipt.offer_id,
            amount=f"{receipt.amount:.2f}",
            currency=receipt.currency,
            ordered_at=receipt.ordered_at,
            captured_at=receipt.captured_at,
            webhooks=[
                WebhookProofResponse(
                    event_id=proof.event_id,
                    event_type=proof.event_type,
                    received_at=proof.received_at,
                )
                for proof in receipt.webhooks
            ],
        )


class OfferResponse(BaseModel):
    id: str
    name: str
    description: str
    amount: str
    currency: str
    credits: int


class ReceiptsResponse(BaseModel):
    campaign_id: UUID
    receipts: list[ReceiptResponse]


@router.get("/config", response_model=PayPalConfigResponse)
async def get_paypal_config(_workspace_id: WorkspaceId) -> PayPalConfigResponse:
    settings = get_settings()
    if settings.paypal_client_id is None:
        raise HTTPException(status_code=503, detail="PayPal is not configured")
    sandbox = settings.paypal_environment == "sandbox"
    return PayPalConfigResponse(
        client_id=settings.paypal_client_id.get_secret_value(),
        environment=settings.paypal_environment,
        currency="USD",
        sandbox_buyer_email=settings.paypal_sandbox_buyer_email if sandbox else None,
        sandbox_buyer_password=settings.paypal_sandbox_buyer_password if sandbox else None,
    )


@router.get("/offers", response_model=list[OfferResponse])
async def list_offers(_workspace_id: WorkspaceId) -> list[OfferResponse]:
    """The catalog a campaign can sell. The agent can only suggest offers from it."""
    return [
        OfferResponse(
            id=offer.id,
            name=offer.name,
            description=offer.description,
            amount=f"{offer.amount:.2f}",
            currency=offer.currency,
            credits=offer.credits,
        )
        for offer in OFFERS.values()
    ]


class OfferChoice(BaseModel):
    offer_id: str


@router.post("/campaigns/{campaign_id}/offer", response_model=Campaign)
async def choose_offer(
    campaign_id: UUID,
    choice: OfferChoice,
    campaigns: Annotated[CampaignStore, Depends(get_campaign_store)],
    workspace_id: WorkspaceId,
) -> Campaign:
    """The founder picks what every buy link sells. Same event as an approved agent switch."""
    if choice.offer_id not in OFFERS:
        raise HTTPException(status_code=404, detail="Offer not found")
    campaign = await campaigns.get(workspace_id=workspace_id, campaign_id=campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if choice.offer_id == campaign.offer_id:
        return campaign
    await campaigns.record_event(
        campaign_id=campaign.id,
        actor="human",
        action="offer_changed",
        detail={"offer_id": choice.offer_id, "previous_offer_id": campaign.offer_id},
    )
    updated = await campaigns.get(workspace_id=workspace_id, campaign_id=campaign_id)
    assert updated is not None
    return updated


@router.post("/orders", response_model=OrderResponse)
async def create_order(
    request: CreateOrderRequest,
    gateway: Annotated[PayPalGateway, Depends(get_paypal_gateway)],
    store: Annotated[PaymentStore, Depends(get_payment_store)],
    campaigns: Annotated[CampaignStore, Depends(get_campaign_store)],
    workspace_id: WorkspaceId,
) -> OrderResponse:
    if request.offer_id is not None and request.offer_id not in OFFERS:
        raise HTTPException(status_code=404, detail="Offer not found")
    campaign = await campaigns.get(workspace_id=workspace_id, campaign_id=request.campaign_id)
    posts = campaign.posts if campaign else []
    post = next((post for post in posts if post.id == request.content_id), None)
    # Customers only ever arrive from approved posts, so only those can take a payment.
    if campaign is None or post is None or post.status != "approved":
        raise HTTPException(status_code=404, detail="Campaign content not found")
    if request.offer_id is not None and request.offer_id != campaign.offer_id:
        raise HTTPException(status_code=409, detail="This campaign now sells a different offer")
    return await open_order(
        gateway=gateway,
        store=store,
        workspace_id=workspace_id,
        offer=campaign.offer,
        campaign_id=request.campaign_id,
        content_id=request.content_id,
    )


async def open_order(
    *,
    gateway: PayPalGateway,
    store: PaymentStore,
    workspace_id: UUID,
    offer: Offer,
    campaign_id: UUID,
    content_id: UUID,
) -> OrderResponse:
    request_id = uuid4()
    try:
        order = await gateway.create_order(
            offer=offer,
            attribution_id=f"{campaign_id}:{content_id}",
            request_id=str(request_id),
        )
    except PayPalAPIError as error:
        raise HTTPException(status_code=502, detail="PayPal could not create the order") from error
    await store.record_order(
        workspace_id=workspace_id,
        offer=offer,
        campaign_id=campaign_id,
        content_id=content_id,
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
    return await settle_order(gateway=gateway, store=store, order_id=order_id)


async def settle_order(
    *, gateway: PayPalGateway, store: PaymentStore, order_id: str
) -> CaptureResponse:
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
        started_orders=summary.started_orders,
        gross_revenue=f"{summary.gross_revenue:.2f}",
        currency=summary.currency,
        latest_capture_id=summary.latest_capture_id,
    )


@router.get("/receipts/{campaign_id}", response_model=ReceiptsResponse)
async def get_receipts(
    campaign_id: UUID,
    store: Annotated[PaymentStore, Depends(get_payment_store)],
    campaigns: Annotated[CampaignStore, Depends(get_campaign_store)],
    workspace_id: WorkspaceId,
) -> ReceiptsResponse:
    """Each completed purchase with its post and the verified PayPal events, newest first."""
    if await campaigns.get(workspace_id=workspace_id, campaign_id=campaign_id) is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    receipts = await store.receipts(campaign_id=campaign_id)
    return ReceiptsResponse(
        campaign_id=campaign_id,
        receipts=[ReceiptResponse.of(receipt) for receipt in receipts],
    )
