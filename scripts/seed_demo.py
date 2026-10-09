"""Seed the judge demo campaign. Pass --reset to clear demo campaigns and orders first."""

import argparse
import asyncio
import json

import asyncpg
from app.config import get_settings

CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111"
# The first post keeps the content ID used by earlier PayPal sandbox orders.
FIRST_POST_ID = "22222222-2222-4222-8222-222222222222"

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

# (channel, theme, content, call to action, status, review note)
POSTS = [
    (
        "LinkedIn",
        "A clearer way to write at work",
        (
            "Clear writing is a professional advantage.\n\nScribe helps you rewrite messages "
            "without leaving the app you are using. Turn a rough thought into a clear update "
            "in seconds.\n\n#Productivity #BetterCommunication"
        ),
        "Write with confidence. Anywhere you work.",
        "needs_review",
        None,
    ),
    (
        "LinkedIn",
        "Turn ideas into clear messages",
        (
            "Good ideas deserve clear words.\n\nScribe helps you turn thoughts into polished, "
            "professional messages faster and with less friction. Whether it is a quick reply "
            "or a complex update, you can sound like you, only clearer."
        ),
        "Write with confidence. Anywhere you work.",
        "changes_requested",
        "Make the opening more specific to the moment of interruption. Keep the final sentence.",
    ),
    (
        "X",
        "Write with confidence, anywhere",
        (
            "Your next work message can be clearer before you press send. Scribe rewrites it "
            "where you already type."
        ),
        "Try Scribe free.",
        "approved",
        None,
    ),
    (
        "LinkedIn",
        "Real time, real impact",
        (
            "Clear writing matters most when the message matters. Scribe works inside your "
            "keyboard, so clarity is always one tap away."
        ),
        "Install Scribe today.",
        "needs_review",
        None,
    ),
    (
        "Instagram",
        "From messy to meaningful",
        (
            "Messy first draft? Keep it. Scribe can help you turn it into a message you are "
            "ready to send."
        ),
        "Link in bio.",
        "needs_review",
        None,
    ),
    (
        "X",
        "Your thoughts, better wording",
        (
            "Keep your meaning. Improve the wording. Scribe helps your messages sound clear "
            "without losing your voice."
        ),
        "Try Scribe free.",
        "needs_review",
        None,
    ),
    (
        "LinkedIn",
        "Small changes, bigger progress",
        (
            "One clearer message will not change your career. A habit of clear communication "
            "might. Start with the next thing you send."
        ),
        "Start with Scribe.",
        "needs_review",
        None,
    ),
]


async def seed(reset: bool) -> None:
    settings = get_settings()
    if settings.app_env == "production":
        raise SystemExit("Refusing to seed demo data in production")
    workspace_id = settings.demo_workspace_id
    database_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    connection = await asyncpg.connect(database_url)
    try:
        async with connection.transaction():
            if reset:
                await connection.execute(
                    "delete from public.payment_orders where workspace_id = $1", workspace_id
                )
                await connection.execute(
                    "delete from public.campaigns where workspace_id = $1", workspace_id
                )
            await connection.execute(
                """
                insert into public.workspaces (id, name) values ($1, 'GrowthReceipt Demo')
                on conflict (id) do nothing
                """,
                workspace_id,
            )
            created = await connection.fetchval(
                """
                insert into public.campaigns (
                  id, workspace_id, name, positioning, product_name, product_description,
                  audience, objective, channels, brand_voice, product_icon_url
                ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                on conflict (id) do nothing
                returning id
                """,
                CAMPAIGN_ID,
                workspace_id,
                *CAMPAIGN.values(),
            )
            if created is None:
                print("Demo campaign already exists. Use --reset to recreate it.")
                return
            for day, (channel, theme, content, cta, status, note) in enumerate(POSTS, start=1):
                await connection.execute(
                    """
                    insert into public.campaign_posts (
                      id, campaign_id, day, channel, theme, content, call_to_action,
                      status, review_note
                    ) values (
                      coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7,
                      $8::public.campaign_post_status, $9
                    )
                    """,
                    FIRST_POST_ID if day == 1 else None,
                    CAMPAIGN_ID,
                    day,
                    channel,
                    theme,
                    content,
                    cta,
                    status,
                    note,
                )
            await connection.execute(
                """
                insert into public.campaign_events (campaign_id, actor, action, detail)
                values ($1, 'system', 'campaign_seeded', $2::jsonb)
                """,
                CAMPAIGN_ID,
                json.dumps({"post_count": len(POSTS)}),
            )
        print(f"Seeded demo campaign {CAMPAIGN_ID} with {len(POSTS)} posts.")
    finally:
        await connection.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="Delete demo campaigns and orders")
    asyncio.run(seed(parser.parse_args().reset))
