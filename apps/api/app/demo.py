import json
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CAMPAIGN = {
    "name": "Launch week",
    "positioning": "Find what breaks a launch before your visitors do.",
    "product_name": "LaunchCheck",
    "product_description": (
        "Scans a launch page for speed, SEO and structure issues, "
        "then explains practical fixes in plain English."
    ),
    "audience": "Indie builders and small teams getting ready to launch.",
    "objective": "Encourage builders to purchase the 10 scan pack before launch.",
    "channels": ["LinkedIn", "X", "Instagram"],
    "brand_voice": "Direct, practical, encouraging",
    "product_icon_url": "/products/launchcheck.svg",
}

# (channel, theme, content, call to action, status, review note)
POSTS = [
    (
        "LinkedIn",
        "Launch day is the worst time to find a slow page",
        "You spent months on the product. Visitors decide in seconds.\n\nLaunchCheck scans "
        "your public page and shows what slows it down, what search engines miss, and what "
        "to fix first.\n\n#IndieHackers #Launch",
        "Check your page before you ship.",
        "needs_review",
        None,
    ),
    (
        "LinkedIn",
        "Three things we see on almost every launch page",
        "Missing page titles. Huge images. No clear call to action.\n\nLaunchCheck finds "
        "all three in one scan and explains each fix in plain words.",
        "Run a scan on your launch page.",
        "changes_requested",
        "Open with one real example from a scan instead of a list.",
    ),
    (
        "X",
        "Ship with fewer surprises",
        "Before you post your launch link, paste it into LaunchCheck. Speed, SEO and "
        "structure checked in one go.",
        "Scan your page.",
        "approved",
        None,
    ),
    (
        "X",
        "A launch checklist that checks itself",
        "Checklists tell you what to look for. LaunchCheck looks for you and shows the "
        "fixes that matter most.",
        "Get the 10 scan pack.",
        "needs_review",
        None,
    ),
    (
        "Instagram",
        "Before and after one scan",
        "Same page, three fixes, a faster first impression. LaunchCheck shows you where "
        "to start.",
        "Link in bio.",
        "needs_review",
        None,
    ),
    (
        "LinkedIn",
        "Every relaunch deserves a check",
        "New pricing page? New landing page? Scan it again. Ten scans cover a whole "
        "launch week.",
        "Get 10 scans for 9 USD.",
        "needs_review",
        None,
    ),
    (
        "Instagram",
        "Your page, reviewed in a minute",
        "Paste a link, get a clear list of fixes. Built for builders who would rather "
        "ship than guess.",
        "Try LaunchCheck.",
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
        # A reset demo starts with its original name and the viewer's own time zone.
        await session.execute(
            text(
                "update growthreceipt.workspaces "
                "set name = 'Judge demo', settings = settings - 'timezone' "
                "where id = :workspace_id"
            ),
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
