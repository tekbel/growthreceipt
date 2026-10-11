import json
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal, Protocol
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.campaigns.store import FakeCampaignStore
from app.database import get_session

# Scheduled posts go out from this hour of the workspace's day.
PUBLISH_HOUR = 9
Trigger = Literal["manual", "scheduled"]


@dataclass(frozen=True)
class LinkedInConnection:
    workspace_id: UUID
    member_urn: str
    member_name: str
    access_token_encrypted: str
    expires_at: datetime
    auto_publish: bool = False
    auto_publish_since: date | None = None


@dataclass(frozen=True)
class ClaimedPost:
    workspace_id: UUID
    campaign_id: UUID
    post_id: UUID
    content: str
    call_to_action: str
    product_name: str


class LinkedInStore(Protocol):
    async def get(self, workspace_id: UUID) -> LinkedInConnection | None: ...

    async def save(self, connection: LinkedInConnection) -> None: ...

    async def delete(self, workspace_id: UUID) -> None: ...

    async def set_auto_publish(self, workspace_id: UUID, *, enabled: bool, since: date) -> None: ...

    async def claim(self, *, workspace_id: UUID, post_id: UUID) -> ClaimedPost | None:
        """Reserve an approved, unpublished LinkedIn post so only one worker posts it."""
        ...

    async def mark_published(
        self, post: ClaimedPost, *, url: str, urn: str, trigger: Trigger
    ) -> None: ...

    async def release(self, post: ClaimedPost, *, error: str, trigger: Trigger) -> None: ...

    async def due(self, now: datetime) -> list[tuple[UUID, UUID]]:
        """(workspace, post) pairs whose scheduled day has come, for auto publishing."""
        ...


class PostgresLinkedInStore:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, workspace_id: UUID) -> LinkedInConnection | None:
        async with self._session.begin():
            row = (
                await self._session.execute(
                    text(
                        """
                        select workspace_id, member_urn, member_name, access_token_encrypted,
                               expires_at, auto_publish, auto_publish_since
                        from growthreceipt.linkedin_connections
                        where workspace_id = :workspace_id
                        """
                    ),
                    {"workspace_id": workspace_id},
                )
            ).one_or_none()
        return None if row is None else LinkedInConnection(**row._mapping)

    async def save(self, connection: LinkedInConnection) -> None:
        async with self._session.begin():
            # Reconnecting refreshes the member and token but keeps the auto publish choice.
            await self._session.execute(
                text(
                    """
                    insert into growthreceipt.linkedin_connections
                        (workspace_id, member_urn, member_name, access_token_encrypted, expires_at)
                    values (:workspace_id, :member_urn, :member_name, :token, :expires_at)
                    on conflict (workspace_id) do update
                    set member_urn = excluded.member_urn,
                        member_name = excluded.member_name,
                        access_token_encrypted = excluded.access_token_encrypted,
                        expires_at = excluded.expires_at,
                        updated_at = now()
                    """
                ),
                {
                    "workspace_id": connection.workspace_id,
                    "member_urn": connection.member_urn,
                    "member_name": connection.member_name,
                    "token": connection.access_token_encrypted,
                    "expires_at": connection.expires_at,
                },
            )

    async def delete(self, workspace_id: UUID) -> None:
        async with self._session.begin():
            await self._session.execute(
                text(
                    "delete from growthreceipt.linkedin_connections "
                    "where workspace_id = :workspace_id"
                ),
                {"workspace_id": workspace_id},
            )

    async def set_auto_publish(self, workspace_id: UUID, *, enabled: bool, since: date) -> None:
        async with self._session.begin():
            await self._session.execute(
                text(
                    """
                    update growthreceipt.linkedin_connections
                    set auto_publish = :enabled,
                        auto_publish_since = case when :enabled then cast(:since as date) end,
                        updated_at = now()
                    where workspace_id = :workspace_id
                    """
                ),
                {"workspace_id": workspace_id, "enabled": enabled, "since": since},
            )

    async def claim(self, *, workspace_id: UUID, post_id: UUID) -> ClaimedPost | None:
        async with self._session.begin():
            row = (
                await self._session.execute(
                    text(
                        """
                        update growthreceipt.campaign_posts post
                        set publish_claimed_at = now()
                        from growthreceipt.campaigns campaign
                        where post.id = :post_id
                          and campaign.id = post.campaign_id
                          and campaign.workspace_id = :workspace_id
                          and post.channel = 'LinkedIn'
                          and post.status = 'approved'
                          and post.published_at is null
                          and (post.publish_claimed_at is null
                               or post.publish_claimed_at < now() - interval '5 minutes')
                        returning campaign.workspace_id, post.campaign_id, post.id as post_id,
                                  post.content, post.call_to_action, campaign.product_name
                        """
                    ),
                    {"post_id": post_id, "workspace_id": workspace_id},
                )
            ).one_or_none()
        return None if row is None else ClaimedPost(**row._mapping)

    async def mark_published(
        self, post: ClaimedPost, *, url: str, urn: str, trigger: Trigger
    ) -> None:
        async with self._session.begin():
            await self._session.execute(
                text(
                    """
                    update growthreceipt.campaign_posts
                    set published_at = now(), published_url = :url, publish_claimed_at = null
                    where id = :post_id
                    """
                ),
                {"post_id": post.post_id, "url": url},
            )
            await self._event(
                post,
                actor="human" if trigger == "manual" else "system",
                action="post_published",
                detail={"channel": "LinkedIn", "url": url, "urn": urn, "trigger": trigger},
            )

    async def release(self, post: ClaimedPost, *, error: str, trigger: Trigger) -> None:
        async with self._session.begin():
            await self._session.execute(
                text(
                    "update growthreceipt.campaign_posts set publish_claimed_at = null "
                    "where id = :post_id"
                ),
                {"post_id": post.post_id},
            )
            await self._event(
                post,
                actor="system",
                action="publish_failed",
                detail={"channel": "LinkedIn", "error": error, "trigger": trigger},
            )

    async def due(self, now: datetime) -> list[tuple[UUID, UUID]]:
        async with self._session.begin():
            rows = await self._session.execute(
                text(
                    """
                    select connection.workspace_id, post.id as post_id
                    from growthreceipt.linkedin_connections connection
                    join growthreceipt.workspaces workspace
                      on workspace.id = connection.workspace_id
                    join growthreceipt.campaigns campaign
                      on campaign.workspace_id = connection.workspace_id
                    join growthreceipt.campaign_posts post on post.campaign_id = campaign.id
                    cross join lateral (
                        select cast(:now as timestamptz)
                               at time zone coalesce(workspace.settings->>'timezone', 'UTC')
                               as local_now
                    ) clock
                    cross join lateral (
                        select campaign.starts_on + (post.day - 1) as scheduled_on
                    ) schedule
                    where connection.auto_publish
                      and connection.expires_at > :now
                      and post.channel = 'LinkedIn'
                      and post.status = 'approved'
                      and post.published_at is null
                      and schedule.scheduled_on >= connection.auto_publish_since
                      and (schedule.scheduled_on < cast(clock.local_now as date)
                           or (schedule.scheduled_on = cast(clock.local_now as date)
                               and extract(hour from clock.local_now) >= cast(:hour as int)))
                    order by schedule.scheduled_on
                    limit 20
                    """
                ),
                {"now": now, "hour": PUBLISH_HOUR},
            )
            return [(row.workspace_id, row.post_id) for row in rows]

    async def _event(
        self, post: ClaimedPost, *, actor: str, action: str, detail: dict[str, str]
    ) -> None:
        await self._session.execute(
            text(
                """
                insert into growthreceipt.campaign_events
                    (campaign_id, post_id, actor, action, detail)
                values (:campaign_id, :post_id, :actor, :action, cast(:detail as jsonb))
                """
            ),
            {
                "campaign_id": post.campaign_id,
                "post_id": post.post_id,
                "actor": actor,
                "action": action,
                "detail": json.dumps(detail),
            },
        )


class FakeLinkedInStore:
    """Works on a FakeCampaignStore, so tests see posts change after publishing."""

    def __init__(self, campaigns: FakeCampaignStore, *, timezone: str = "UTC") -> None:
        self.campaigns = campaigns
        self.timezone = timezone
        self.connections: dict[UUID, LinkedInConnection] = {}
        self.claimed: set[UUID] = set()

    async def get(self, workspace_id: UUID) -> LinkedInConnection | None:
        return self.connections.get(workspace_id)

    async def save(self, connection: LinkedInConnection) -> None:
        existing = self.connections.get(connection.workspace_id)
        if existing:
            connection = replace(
                connection,
                auto_publish=existing.auto_publish,
                auto_publish_since=existing.auto_publish_since,
            )
        self.connections[connection.workspace_id] = connection

    async def delete(self, workspace_id: UUID) -> None:
        self.connections.pop(workspace_id, None)

    async def set_auto_publish(self, workspace_id: UUID, *, enabled: bool, since: date) -> None:
        connection = self.connections[workspace_id]
        self.connections[workspace_id] = replace(
            connection, auto_publish=enabled, auto_publish_since=since if enabled else None
        )

    async def claim(self, *, workspace_id: UUID, post_id: UUID) -> ClaimedPost | None:
        for campaign_id, campaign in self.campaigns.campaigns.items():
            if self.campaigns.workspaces.get(campaign_id) != workspace_id:
                continue
            for post in campaign.posts:
                if (
                    post.id == post_id
                    and post.channel == "LinkedIn"
                    and post.status == "approved"
                    and post.published_at is None
                    and post_id not in self.claimed
                ):
                    self.claimed.add(post_id)
                    return ClaimedPost(
                        workspace_id=workspace_id,
                        campaign_id=campaign_id,
                        post_id=post_id,
                        content=post.content,
                        call_to_action=post.call_to_action,
                        product_name=campaign.product_name,
                    )
        return None

    async def mark_published(
        self, post: ClaimedPost, *, url: str, urn: str, trigger: Trigger
    ) -> None:
        campaign = self.campaigns.campaigns[post.campaign_id]
        posts = [
            item.model_copy(update={"published_at": datetime.now(UTC), "published_url": url})
            if item.id == post.post_id
            else item
            for item in campaign.posts
        ]
        self.campaigns.campaigns[post.campaign_id] = campaign.model_copy(update={"posts": posts})
        self.claimed.discard(post.post_id)
        self.campaigns._log(
            post.campaign_id,
            post.post_id,
            "human" if trigger == "manual" else "system",
            "post_published",
            {"channel": "LinkedIn", "url": url, "urn": urn, "trigger": trigger},
        )

    async def release(self, post: ClaimedPost, *, error: str, trigger: Trigger) -> None:
        self.claimed.discard(post.post_id)
        self.campaigns._log(
            post.campaign_id,
            post.post_id,
            "system",
            "publish_failed",
            {"channel": "LinkedIn", "error": error, "trigger": trigger},
        )

    async def due(self, now: datetime) -> list[tuple[UUID, UUID]]:
        local = now.astimezone(ZoneInfo(self.timezone))
        due: list[tuple[UUID, UUID]] = []
        for workspace_id, connection in self.connections.items():
            if not connection.auto_publish or connection.expires_at <= now:
                continue
            assert connection.auto_publish_since is not None
            for campaign_id, campaign in self.campaigns.campaigns.items():
                if self.campaigns.workspaces.get(campaign_id) != workspace_id:
                    continue
                for post in campaign.posts:
                    scheduled = campaign.starts_on + timedelta(days=post.day - 1)
                    ready = scheduled < local.date() or (
                        scheduled == local.date() and local.hour >= PUBLISH_HOUR
                    )
                    if (
                        post.channel == "LinkedIn"
                        and post.status == "approved"
                        and post.published_at is None
                        and scheduled >= connection.auto_publish_since
                        and ready
                    ):
                        due.append((workspace_id, post.id))
        return due


def get_linkedin_store(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> LinkedInStore:
    return PostgresLinkedInStore(session)
