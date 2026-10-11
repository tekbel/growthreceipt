from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlencode

import httpx

AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
REVOKE_URL = "https://www.linkedin.com/oauth/v2/revoke"
USERINFO_URL = "https://api.linkedin.com/v2/userinfo"
UGC_POSTS_URL = "https://api.linkedin.com/v2/ugcPosts"
# Sign In with LinkedIn (openid, profile) names the member. Share on LinkedIn adds posting.
SCOPES = "openid profile w_member_social"


class LinkedInError(Exception):
    """LinkedIn refused or failed a request. The message is safe to show the founder."""


@dataclass(frozen=True)
class LinkedInToken:
    access_token: str
    expires_in: int


@dataclass(frozen=True)
class LinkedInMember:
    urn: str
    name: str


class LinkedInClient(Protocol):
    def authorize_url(self, *, state: str, redirect_uri: str) -> str: ...

    async def exchange_code(self, *, code: str, redirect_uri: str) -> LinkedInToken: ...

    async def member(self, *, access_token: str) -> LinkedInMember: ...

    async def publish(
        self, *, access_token: str, author: str, text: str, link: str, title: str
    ) -> str: ...

    async def revoke(self, *, access_token: str) -> None: ...


def post_url(urn: str) -> str:
    return f"https://www.linkedin.com/feed/update/{urn}/"


class HttpLinkedInClient:
    def __init__(self, *, client_id: str, client_secret: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret

    def authorize_url(self, *, state: str, redirect_uri: str) -> str:
        query = urlencode(
            {
                "response_type": "code",
                "client_id": self._client_id,
                "redirect_uri": redirect_uri,
                "state": state,
                "scope": SCOPES,
            }
        )
        return f"{AUTHORIZE_URL}?{query}"

    async def exchange_code(self, *, code: str, redirect_uri: str) -> LinkedInToken:
        async with httpx.AsyncClient(timeout=15) as http:
            response = await http.post(
                TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                },
            )
        if response.status_code != 200:
            raise LinkedInError("LinkedIn did not accept the sign in. Please connect again.")
        body = response.json()
        return LinkedInToken(access_token=body["access_token"], expires_in=int(body["expires_in"]))

    async def member(self, *, access_token: str) -> LinkedInMember:
        async with httpx.AsyncClient(timeout=15) as http:
            response = await http.get(
                USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
            )
        if response.status_code != 200:
            raise LinkedInError("LinkedIn did not share the member profile.")
        body = response.json()
        return LinkedInMember(urn=f"urn:li:person:{body['sub']}", name=body.get("name") or "")

    async def publish(
        self, *, access_token: str, author: str, text: str, link: str, title: str
    ) -> str:
        payload = {
            "author": author,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": text},
                    "shareMediaCategory": "ARTICLE",
                    "media": [{"status": "READY", "originalUrl": link, "title": {"text": title}}],
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        }
        async with httpx.AsyncClient(timeout=20) as http:
            response = await http.post(
                UGC_POSTS_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "X-Restli-Protocol-Version": "2.0.0",
                },
            )
        if response.status_code == 401:
            raise LinkedInError("The LinkedIn connection expired. Reconnect LinkedIn to post.")
        if response.status_code == 429:
            raise LinkedInError("LinkedIn's daily posting limit was reached. Try again tomorrow.")
        if response.status_code != 201:
            raise LinkedInError(f"LinkedIn refused the post (HTTP {response.status_code}).")
        urn = response.headers.get("x-restli-id")
        if not urn:
            raise LinkedInError("LinkedIn accepted the post but returned no post ID.")
        return urn

    async def revoke(self, *, access_token: str) -> None:
        async with httpx.AsyncClient(timeout=10) as http:
            await http.post(
                REVOKE_URL,
                data={
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "token": access_token,
                },
            )


class FakeLinkedInClient:
    def __init__(self) -> None:
        self.published: list[dict[str, str]] = []
        self.revoked: list[str] = []
        self.fail_with: str | None = None

    def authorize_url(self, *, state: str, redirect_uri: str) -> str:
        return f"{AUTHORIZE_URL}?{urlencode({'state': state, 'redirect_uri': redirect_uri})}"

    async def exchange_code(self, *, code: str, redirect_uri: str) -> LinkedInToken:
        if code == "bad":
            raise LinkedInError("LinkedIn did not accept the sign in. Please connect again.")
        return LinkedInToken(access_token=f"token-{code}", expires_in=60 * 24 * 3600)

    async def member(self, *, access_token: str) -> LinkedInMember:
        return LinkedInMember(urn="urn:li:person:abc123", name="Ada Founder")

    async def publish(
        self, *, access_token: str, author: str, text: str, link: str, title: str
    ) -> str:
        if self.fail_with:
            raise LinkedInError(self.fail_with)
        self.published.append(
            {"access_token": access_token, "author": author, "text": text, "link": link}
        )
        return f"urn:li:share:{len(self.published)}"

    async def revoke(self, *, access_token: str) -> None:
        self.revoked.append(access_token)
