from datetime import date, datetime
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, computed_field, model_validator

Channel = Literal["LinkedIn", "X", "Instagram"]
PostStatus = Literal["needs_review", "changes_requested", "approved"]
CampaignStatus = Literal["in_review", "changes_requested", "approved"]
EventActor = Literal["agent", "human", "system"]


class CampaignBrief(BaseModel):
    product_name: str = Field(min_length=2, max_length=120)
    product_description: str = Field(min_length=10, max_length=2_000)
    audience: str = Field(min_length=3, max_length=500)
    objective: str = Field(min_length=3, max_length=240)
    channels: list[Channel] = Field(min_length=1)
    days: int = Field(default=7, ge=1, le=14)
    brand_voice: str = Field(default="Clear, confident, useful", max_length=500)


class CampaignPost(BaseModel):
    day: int
    channel: Channel
    theme: str
    content: str
    call_to_action: str


class CampaignDraft(BaseModel):
    campaign_name: str
    positioning: str
    posts: list[CampaignPost]


class Post(CampaignPost):
    id: UUID
    status: PostStatus
    review_note: str | None


class Campaign(BaseModel):
    id: UUID
    name: str
    positioning: str
    product_name: str
    product_description: str
    audience: str
    objective: str
    channels: list[Channel]
    brand_voice: str
    starts_on: date
    created_at: datetime
    posts: list[Post]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def status(self) -> CampaignStatus:
        if any(post.status == "changes_requested" for post in self.posts):
            return "changes_requested"
        if self.posts and all(post.status == "approved" for post in self.posts):
            return "approved"
        return "in_review"


class CampaignEvent(BaseModel):
    id: int
    post_id: UUID | None
    actor: EventActor
    action: str
    detail: dict[str, Any]
    created_at: datetime


class PostUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=3_000)
    status: Literal["approved", "changes_requested"] | None = None
    review_note: str | None = Field(default=None, max_length=1_000)

    @model_validator(mode="after")
    def check_change(self) -> Self:
        if self.content is None and self.status is None:
            raise ValueError("Provide new content, a review decision, or both")
        if self.status == "changes_requested" and not (self.review_note or "").strip():
            raise ValueError("Requesting changes needs a review note")
        return self


def review_transition(post: Post, update: PostUpdate) -> tuple[Post, str, dict[str, Any]]:
    """Apply a human review decision. Edited text always needs a fresh approval."""
    content = post.content if update.content is None else update.content
    edited = content != post.content
    detail: dict[str, Any] = {}
    if edited:
        detail = {"before": post.content, "after": content}

    if update.status == "approved":
        status: PostStatus = "approved"
        note = None
        action = "post_approved"
    elif update.status == "changes_requested":
        status = "changes_requested"
        note = (update.review_note or "").strip()
        detail["review_note"] = note
        action = "changes_requested"
    else:
        status = "needs_review" if edited else post.status
        note = post.review_note
        action = "post_edited"

    updated = post.model_copy(update={"content": content, "status": status, "review_note": note})
    return updated, action, detail
