from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.campaigns.models import (
    Campaign,
    CampaignBrief,
    CampaignDraft,
    CampaignEvent,
    EventActor,
    Post,
    PostUpdate,
    review_transition,
)


class CampaignStore(Protocol):
    async def create(
        self,
        *,
        workspace_id: UUID,
        brief: CampaignBrief,
        draft: CampaignDraft,
        session_id: str,
        turn_id: str,
    ) -> Campaign: ...

    async def get(self, *, workspace_id: UUID, campaign_id: UUID) -> Campaign | None: ...

    async def latest(self, *, workspace_id: UUID) -> Campaign | None: ...

    async def update_post(
        self,
        *,
        workspace_id: UUID,
        campaign_id: UUID,
        post_id: UUID,
        update: PostUpdate,
    ) -> Campaign | None: ...

    async def approve(self, *, workspace_id: UUID, campaign_id: UUID) -> Campaign | None: ...

    async def events(self, *, workspace_id: UUID, campaign_id: UUID) -> list[CampaignEvent]: ...

    async def record_event(
        self,
        *,
        campaign_id: UUID,
        actor: EventActor,
        action: str,
        detail: dict[str, Any],
    ) -> None: ...


CAMPAIGN_COLUMNS = """
    id, name, positioning, product_name, product_icon_url, product_description, audience,
    objective, channels, brand_voice, starts_on, created_at
"""


class PostgresCampaignStore:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        *,
        workspace_id: UUID,
        brief: CampaignBrief,
        draft: CampaignDraft,
        session_id: str,
        turn_id: str,
    ) -> Campaign:
        async with self._session.begin():
            await self._session.execute(
                text(
                    """
                    insert into public.workspaces (id, name)
                    values (:workspace_id, 'GrowthReceipt Demo')
                    on conflict (id) do nothing
                    """
                ),
                {"workspace_id": workspace_id},
            )
            campaign_id = await self._session.scalar(
                text(
                    """
                    insert into public.campaigns (
                      workspace_id, name, positioning, product_name, product_icon_url,
                      product_description, audience, objective, channels, brand_voice,
                      agent_session_id, agent_turn_id
                    ) values (
                      :workspace_id, :name, :positioning, :product_name, :product_icon_url,
                      :product_description,
                      :audience, :objective, :channels, :brand_voice,
                      :session_id, :turn_id
                    )
                    returning id
                    """
                ),
                {
                    "workspace_id": workspace_id,
                    "name": draft.campaign_name,
                    "positioning": draft.positioning,
                    "product_name": brief.product_name,
                    "product_icon_url": brief.product_icon_url,
                    "product_description": brief.product_description,
                    "audience": brief.audience,
                    "objective": brief.objective,
                    "channels": list(brief.channels),
                    "brand_voice": brief.brand_voice,
                    "session_id": session_id,
                    "turn_id": turn_id,
                },
            )
            await self._session.execute(
                text(
                    """
                    insert into public.campaign_posts (
                      campaign_id, day, channel, theme, content, call_to_action
                    ) values (
                      :campaign_id, :day, :channel, :theme, :content, :call_to_action
                    )
                    """
                ),
                [{"campaign_id": campaign_id, **post.model_dump()} for post in draft.posts],
            )
            await self._insert_event(
                campaign_id=campaign_id,
                post_id=None,
                actor="agent",
                action="campaign_generated",
                detail={
                    "session_id": session_id,
                    "turn_id": turn_id,
                    "post_count": len(draft.posts),
                },
            )
            campaign = await self._load(workspace_id=workspace_id, campaign_id=campaign_id)
        assert campaign is not None
        return campaign

    async def get(self, *, workspace_id: UUID, campaign_id: UUID) -> Campaign | None:
        async with self._session.begin():
            return await self._load(workspace_id=workspace_id, campaign_id=campaign_id)

    async def latest(self, *, workspace_id: UUID) -> Campaign | None:
        async with self._session.begin():
            campaign_id = await self._session.scalar(
                text(
                    """
                    select id from public.campaigns
                    where workspace_id = :workspace_id
                    order by created_at desc
                    limit 1
                    """
                ),
                {"workspace_id": workspace_id},
            )
            if campaign_id is None:
                return None
            return await self._load(workspace_id=workspace_id, campaign_id=campaign_id)

    async def update_post(
        self,
        *,
        workspace_id: UUID,
        campaign_id: UUID,
        post_id: UUID,
        update: PostUpdate,
    ) -> Campaign | None:
        async with self._session.begin():
            row = (
                await self._session.execute(
                    text(
                        """
                        select post.id, post.day, post.channel, post.theme, post.content,
                               post.call_to_action, post.status::text as status,
                               post.review_note
                        from public.campaign_posts post
                        join public.campaigns campaign on campaign.id = post.campaign_id
                        where post.id = :post_id
                          and post.campaign_id = :campaign_id
                          and campaign.workspace_id = :workspace_id
                        for update of post
                        """
                    ),
                    {
                        "post_id": post_id,
                        "campaign_id": campaign_id,
                        "workspace_id": workspace_id,
                    },
                )
            ).one_or_none()
            if row is None:
                return None
            updated, action, detail = review_transition(Post(**row._mapping), update)
            await self._session.execute(
                text(
                    """
                    update public.campaign_posts
                    set content = :content,
                        status = cast(:status as public.campaign_post_status),
                        review_note = :review_note,
                        updated_at = now()
                    where id = :post_id
                    """
                ),
                {
                    "content": updated.content,
                    "status": updated.status,
                    "review_note": updated.review_note,
                    "post_id": post_id,
                },
            )
            await self._insert_event(
                campaign_id=campaign_id,
                post_id=post_id,
                actor="human",
                action=action,
                detail=detail,
            )
            return await self._load(workspace_id=workspace_id, campaign_id=campaign_id)

    async def approve(self, *, workspace_id: UUID, campaign_id: UUID) -> Campaign | None:
        async with self._session.begin():
            approved = (
                await self._session.execute(
                    text(
                        """
                        update public.campaign_posts post
                        set status = 'approved', review_note = null, updated_at = now()
                        from public.campaigns campaign
                        where campaign.id = post.campaign_id
                          and campaign.id = :campaign_id
                          and campaign.workspace_id = :workspace_id
                        returning post.id
                        """
                    ),
                    {"campaign_id": campaign_id, "workspace_id": workspace_id},
                )
            ).all()
            if not approved:
                return None
            await self._insert_event(
                campaign_id=campaign_id,
                post_id=None,
                actor="human",
                action="campaign_approved",
                detail={"post_count": len(approved)},
            )
            return await self._load(workspace_id=workspace_id, campaign_id=campaign_id)

    async def events(self, *, workspace_id: UUID, campaign_id: UUID) -> list[CampaignEvent]:
        async with self._session.begin():
            rows = await self._session.execute(
                text(
                    """
                    select event.id, event.post_id, event.actor, event.action,
                           event.detail, event.created_at
                    from public.campaign_events event
                    join public.campaigns campaign on campaign.id = event.campaign_id
                    where campaign.id = :campaign_id and campaign.workspace_id = :workspace_id
                    order by event.created_at desc, event.id desc
                    """
                ),
                {"campaign_id": campaign_id, "workspace_id": workspace_id},
            )
            return [CampaignEvent(**row._mapping) for row in rows]

    async def record_event(
        self,
        *,
        campaign_id: UUID,
        actor: EventActor,
        action: str,
        detail: dict[str, Any],
    ) -> None:
        async with self._session.begin():
            await self._insert_event(
                campaign_id=campaign_id,
                post_id=None,
                actor=actor,
                action=action,
                detail=detail,
            )

    async def _insert_event(
        self,
        *,
        campaign_id: UUID,
        post_id: UUID | None,
        actor: EventActor,
        action: str,
        detail: dict[str, Any],
    ) -> None:
        await self._session.execute(
            text(
                """
                insert into public.campaign_events (campaign_id, post_id, actor, action, detail)
                values (:campaign_id, :post_id, :actor, :action, cast(:detail as jsonb))
                """
            ),
            {
                "campaign_id": campaign_id,
                "post_id": post_id,
                "actor": actor,
                "action": action,
                "detail": json.dumps(detail),
            },
        )

    async def _load(self, *, workspace_id: UUID, campaign_id: UUID) -> Campaign | None:
        campaign = (
            await self._session.execute(
                text(
                    f"""
                    select {CAMPAIGN_COLUMNS}
                    from public.campaigns
                    where id = :campaign_id and workspace_id = :workspace_id
                    """
                ),
                {"campaign_id": campaign_id, "workspace_id": workspace_id},
            )
        ).one_or_none()
        if campaign is None:
            return None
        posts = await self._session.execute(
            text(
                """
                select id, day, channel, theme, content, call_to_action,
                       status::text as status, review_note
                from public.campaign_posts
                where campaign_id = :campaign_id
                order by day, created_at
                """
            ),
            {"campaign_id": campaign_id},
        )
        return Campaign(
            **campaign._mapping,
            posts=[Post(**row._mapping) for row in posts],
        )


class FakeCampaignStore:
    def __init__(self, campaigns: list[Campaign] | None = None) -> None:
        self.campaigns: dict[UUID, Campaign] = {
            campaign.id: campaign for campaign in campaigns or []
        }
        self.event_log: list[tuple[UUID, CampaignEvent]] = []

    async def create(
        self,
        *,
        workspace_id: UUID,
        brief: CampaignBrief,
        draft: CampaignDraft,
        session_id: str,
        turn_id: str,
    ) -> Campaign:
        del workspace_id
        campaign = Campaign(
            id=uuid4(),
            name=draft.campaign_name,
            positioning=draft.positioning,
            product_name=brief.product_name,
            product_icon_url=brief.product_icon_url,
            product_description=brief.product_description,
            audience=brief.audience,
            objective=brief.objective,
            channels=brief.channels,
            brand_voice=brief.brand_voice,
            starts_on=date.today() + timedelta(days=1),
            created_at=datetime.now(UTC),
            posts=[
                Post(id=uuid4(), status="needs_review", review_note=None, **post.model_dump())
                for post in sorted(draft.posts, key=lambda post: post.day)
            ],
        )
        self.campaigns[campaign.id] = campaign
        self._log(
            campaign.id,
            None,
            "agent",
            "campaign_generated",
            {"session_id": session_id, "turn_id": turn_id, "post_count": len(draft.posts)},
        )
        return campaign

    async def get(self, *, workspace_id: UUID, campaign_id: UUID) -> Campaign | None:
        del workspace_id
        return self.campaigns.get(campaign_id)

    async def latest(self, *, workspace_id: UUID) -> Campaign | None:
        del workspace_id
        return max(self.campaigns.values(), key=lambda item: item.created_at, default=None)

    async def update_post(
        self,
        *,
        workspace_id: UUID,
        campaign_id: UUID,
        post_id: UUID,
        update: PostUpdate,
    ) -> Campaign | None:
        del workspace_id
        campaign = self.campaigns.get(campaign_id)
        if campaign is None:
            return None
        post = next((item for item in campaign.posts if item.id == post_id), None)
        if post is None:
            return None
        updated, action, detail = review_transition(post, update)
        posts = [updated if item.id == post_id else item for item in campaign.posts]
        self.campaigns[campaign_id] = campaign.model_copy(update={"posts": posts})
        self._log(campaign_id, post_id, "human", action, detail)
        return self.campaigns[campaign_id]

    async def approve(self, *, workspace_id: UUID, campaign_id: UUID) -> Campaign | None:
        del workspace_id
        campaign = self.campaigns.get(campaign_id)
        if campaign is None or not campaign.posts:
            return None
        posts = [
            post.model_copy(update={"status": "approved", "review_note": None})
            for post in campaign.posts
        ]
        self.campaigns[campaign_id] = campaign.model_copy(update={"posts": posts})
        self._log(campaign_id, None, "human", "campaign_approved", {"post_count": len(posts)})
        return self.campaigns[campaign_id]

    async def events(self, *, workspace_id: UUID, campaign_id: UUID) -> list[CampaignEvent]:
        del workspace_id
        return [event for owner, event in reversed(self.event_log) if owner == campaign_id]

    async def record_event(
        self,
        *,
        campaign_id: UUID,
        actor: EventActor,
        action: str,
        detail: dict[str, Any],
    ) -> None:
        self._log(campaign_id, None, actor, action, detail)

    def _log(
        self,
        campaign_id: UUID,
        post_id: UUID | None,
        actor: EventActor,
        action: str,
        detail: dict[str, Any],
    ) -> None:
        event = CampaignEvent(
            id=len(self.event_log) + 1,
            post_id=post_id,
            actor=actor,
            action=action,
            detail=detail,
            created_at=datetime.now(UTC),
        )
        self.event_log.append((campaign_id, event))
