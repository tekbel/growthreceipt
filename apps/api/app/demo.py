import json
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CAMPAIGN = {
    "name": "Launch week",
    "positioning": "Clear writing without another place to work.",
    "product_name": "Scribe",
    "product_description": (
        "A writing keyboard that helps professionals turn rough thoughts into clear "
        "messages wherever they type."
    ),
    "audience": "Knowledge workers aged 25 to 40 who value speed, clarity, and a natural voice.",
    "objective": "Increase qualified app installs",
    "channels": ["LinkedIn", "X", "Instagram"],
    "brand_voice": "Clear, confident, useful",
    "product_icon_url": "/products/scribe.png",
}

POSTS = [
    (
        "LinkedIn",
        "A clearer way to write at work",
        "Clear writing is a professional advantage.\n\nScribe helps you rewrite messages "
        "without leaving the app you are using. Turn a rough thought into a clear update "
        "in seconds.\n\n#Productivity #BetterCommunication",
        "Write with confidence. Anywhere you work.",
        "needs_review",
        None,
    ),
    (
        "LinkedIn",
        "Turn ideas into clear messages",
        "Good ideas deserve clear words.\n\nScribe helps you turn thoughts into polished, "
        "professional messages faster and with less friction.",
        "Write with confidence. Anywhere you work.",
        "changes_requested",
        "Make the opening more specific to the moment of interruption.",
    ),
    (
        "X",
        "Write with confidence, anywhere",
        "Your next work message can be clearer before you press send. Scribe rewrites it "
        "where you already type.",
        "Try Scribe free.",
        "approved",
        None,
    ),
    (
        "Instagram",
        "From messy to meaningful",
        "Messy first draft? Keep it. Scribe can help you turn it into a message "
        "you are ready to send.",
        "Link in bio.",
        "needs_review",
        None,
    ),
]


async def seed_judge_workspace(
    session: AsyncSession,
    *,
    workspace_id: UUID,
    reset: bool = False,
) -> UUID:
    if reset:
        await session.execute(
            text("delete from growthreceipt.payment_orders where workspace_id = :workspace_id"),
            {"workspace_id": workspace_id},
        )
        await session.execute(
            text("delete from growthreceipt.campaigns where workspace_id = :workspace_id"),
            {"workspace_id": workspace_id},
        )
    existing = await session.scalar(
        text(
            """
            select id from growthreceipt.campaigns
            where workspace_id = :workspace_id
            order by created_at
            limit 1
            """
        ),
        {"workspace_id": workspace_id},
    )
    if existing is not None:
        return existing
    campaign_id = uuid4()
    await session.execute(
        text(
            """
            insert into growthreceipt.campaigns (
              id, workspace_id, name, positioning, product_name, product_description,
              audience, objective, channels, brand_voice, product_icon_url
            ) values (
              :id, :workspace_id, :name, :positioning, :product_name, :product_description,
              :audience, :objective, :channels, :brand_voice, :product_icon_url
            )
            """
        ),
        {"id": campaign_id, "workspace_id": workspace_id, **CAMPAIGN},
    )
    for day, (channel, theme, content, cta, status, note) in enumerate(POSTS, start=1):
        await session.execute(
            text(
                """
                insert into growthreceipt.campaign_posts (
                  campaign_id, day, channel, theme, content, call_to_action, status, review_note
                ) values (
                  :campaign_id, :day, :channel, :theme, :content, :call_to_action,
                  cast(:status as growthreceipt.campaign_post_status), :review_note
                )
                """
            ),
            {
                "campaign_id": campaign_id,
                "day": day,
                "channel": channel,
                "theme": theme,
                "content": content,
                "call_to_action": cta,
                "status": status,
                "review_note": note,
            },
        )
    await session.execute(
        text(
            """
            insert into growthreceipt.campaign_events (campaign_id, actor, action, detail)
            values (:campaign_id, 'system', 'campaign_seeded', cast(:detail as jsonb))
            """
        ),
        {"campaign_id": campaign_id, "detail": json.dumps({"post_count": len(POSTS)})},
    )
    return campaign_id
