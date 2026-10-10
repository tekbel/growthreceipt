"""Seed the judge demo campaign. Pass --reset to clear demo campaigns and orders first."""

import argparse
import asyncio
import json

import asyncpg
from app.config import get_settings
from app.demo import CAMPAIGN as DEMO_CAMPAIGN
from app.demo import POSTS as DEMO_POSTS

CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111"
# The first post keeps the content ID used by earlier PayPal sandbox orders.
FIRST_POST_ID = "22222222-2222-4222-8222-222222222222"

# Same campaign and posts as the hosted judge workspace.
CAMPAIGN = DEMO_CAMPAIGN
POSTS = DEMO_POSTS


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
                    "delete from growthreceipt.payment_orders where workspace_id = $1", workspace_id
                )
                await connection.execute(
                    "delete from growthreceipt.campaigns where workspace_id = $1", workspace_id
                )
            await connection.execute(
                """
                insert into growthreceipt.workspaces (id, name) values ($1, 'GrowthReceipt Demo')
                on conflict (id) do nothing
                """,
                workspace_id,
            )
            created = await connection.fetchval(
                """
                insert into growthreceipt.campaigns (
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
                    insert into growthreceipt.campaign_posts (
                      id, campaign_id, day, channel, theme, content, call_to_action,
                      status, review_note
                    ) values (
                      coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7,
                      $8::growthreceipt.campaign_post_status, $9
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
                insert into growthreceipt.campaign_events (campaign_id, actor, action, detail)
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
