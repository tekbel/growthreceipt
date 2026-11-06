# LinkedIn integration

## Status

Shipped on October 11, 2026 in commit `62c11fe`. A founder connects their own LinkedIn profile under Integrations, and GrowthReceipt posts approved LinkedIn posts with their buy link, either on a confirmed **Post it** click or automatically on the scheduled day.

The feature stays inactive until the three `LINKEDIN_*` variables are set on the Railway api service. Without them the Integrations page keeps the share link behaviour.

Checked against the Microsoft Learn LinkedIn docs on October 11, 2026. Recheck them before changing scopes or endpoints, because LinkedIn changes products and versions often.

## Setup runbook

### 1. LinkedIn account and Page

Use your real LinkedIn account. LinkedIn's User Agreement allows one account per real person, and fake accounts get restricted, which breaks the connection. Test posts go to your real profile, so delete them afterwards if needed.

The developer app must be linked to a LinkedIn Company Page that you administer. A personal profile is not accepted.

Use the URL of a Company Page you administer, such as `https://www.linkedin.com/company/<id>/`. From the admin view, drop the `/admin/dashboard/` part of the URL.

### 2. Create the app

Go to https://www.linkedin.com/developers/apps and choose **Create app**.

| Field | Value |
|---|---|
| App name | `GrowthReceipt` |
| LinkedIn Page | `https://www.linkedin.com/company/<id>/`. This cannot be changed after saving. |
| Privacy policy URL | `https://growthreceipt.addisstack.com/privacy` |
| App logo | A 512 px PNG of `apps/web/src/app/icon.svg` |
| Legal agreement | Tick the box |

To render the logo again, screenshot `icon.svg` at 512 by 512 with the corner radius set to 0. LinkedIn wants a square image of at least 100 px.

If the **Settings** tab asks for verification, choose **Verify** and open the generated link as the Page admin.

### 3. Products

On the **Products** tab, request access to exactly these two. Both are self serve and approve within a minute or two.

| Product | Why |
|---|---|
| **Share on LinkedIn** | Grants `w_member_social`, which lets GrowthReceipt post as the member |
| **Sign In with LinkedIn using OpenID Connect** | Grants `openid profile`, which tells us who connected and which person URN to post as |

Do not request the others. Advertising, Lead Sync, Matched Audiences, Live Events, Events Management, Conversions, Ad Library and the Data Portability APIs are unused. **Community Management API** is the one for posting as a Company Page. It needs a business review and is a future phase, see below.

### 4. Auth tab

1. Under **Authorized redirect URLs**, add both:
   `https://growthreceipt.addisstack.com/integrations/linkedin/callback`
   `http://localhost:3001/integrations/linkedin/callback`
2. Confirm the OAuth scopes list shows `openid`, `profile` and `w_member_social`.
3. Copy the **Client ID** and the **Primary Client Secret**.

The redirect URL is built from `WEB_ORIGIN` on the API, so it must match one of these exactly.

### 5. Railway variables

On the Railway **api** service, under Variables, set:

| Variable | Value |
|---|---|
| `LINKEDIN_CLIENT_ID` | Client ID from the Auth tab |
| `LINKEDIN_CLIENT_SECRET` | Primary Client Secret |
| `LINKEDIN_TOKEN_KEY` | A Fernet key, generated below |

```bash
.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

The key encrypts stored access tokens. Changing it makes every saved connection unreadable, so each workspace has to reconnect. Keep all three values out of chat, git and any `NEXT_PUBLIC_` variable. Railway redeploys on save.

Run the database migration `supabase/migrations/20261011000100_linkedin_publishing.sql` on your Supabase project.

### 6. Test

1. Sign in to GrowthReceipt with a permanent account and open **Integrations**.
2. Choose **Connect LinkedIn** and approve on LinkedIn. The row shows your name.
3. Approve a LinkedIn post in **Content**, then choose **Post to LinkedIn now** and confirm with **Post it**.
4. Open **View the post** and check that the text and buy link are right.
5. Delete the test post on LinkedIn if you do not want to keep it.

### 7. Token expiry

Access tokens last 60 days and self serve apps get no refresh token. When Integrations says the connection expired, choose **Reconnect**. If your LinkedIn grant is still valid, LinkedIn skips the consent screen, so it is one click.

## How it works

1. **Connect.** The API signs a state value bound to the workspace (HMAC, 10 minute expiry) and returns the LinkedIn authorize URL. LinkedIn redirects to the web page `/integrations/linkedin/callback`, which hands the code to the signed in workspace. The workspace sends code and state to `POST /v1/integrations/linkedin/connect`, so a forged callback cannot attach a profile to another workspace.
2. **Store.** The API exchanges the code, reads the member from `/v2/userinfo`, and stores the name, `urn:li:person:{sub}`, the expiry and the Fernet encrypted token in `growthreceipt.linkedin_connections`.
3. **Post.** `POST https://api.linkedin.com/v2/ugcPosts` with `X-Restli-Protocol-Version: 2.0.0`, an `ARTICLE` share whose `originalUrl` is the post's buy link, visibility `PUBLIC`. The post ID comes from the `x-restli-id` header.
4. **Claim.** An atomic update claims the post first, so two API replicas or a double click cannot post twice. A failed post is released and logged as `publish_failed`, and can be retried.
5. **Lock.** A published post cannot be edited or sent back for changes.
6. **Schedule.** With automatic publishing on, the API checks every five minutes and posts approved posts whose day has arrived, from 9:00 in the workspace time zone. It only covers posts dated on or after the day automatic publishing was turned on.
7. **Judge demo.** A judge demo is a temporary guest workspace, one per visitor. It cannot connect, change automatic posting or post. The API returns 403, and Integrations explains that a personal sign in is needed.
8. **Disconnect.** `DELETE` revokes the token with LinkedIn (best effort) and deletes the row.

Code: `apps/api/app/linkedin/` (client, crypto, store, publisher), `apps/api/app/routes/linkedin.py`, `apps/web/src/lib/linkedin.ts`, and the Integrations and Content pages in `campaign-workspace.tsx`. Tests: `apps/api/tests/test_linkedin.py`.

## Limits worth knowing

1. Posts are capped at 3000 characters. LinkedIn rejects longer ones and the UI shows a failed publish.
2. Share on LinkedIn allows 150 requests per member per day.
3. `ugcPosts` is still the documented endpoint for self serve personal posting. The newer `/rest/posts` API belongs to the Marketing platform and needs Community Management access.

## Open gaps

1. **Company Page posting.** Needs the Community Management API Development Tier, organization scopes, a Page picker, and LinkedIn's Standard Tier review before unrestricted use. LinkedIn requires a registered legal organization, verified business email, website, privacy policy and a verified Page.
2. **Images and video.** Posts are text plus a link card. Media needs the assets upload flow first.

## Official references

1. [Share on LinkedIn](https://learn.microsoft.com/linkedin/consumer/integrations/self-serve/share-on-linkedin)
2. [Sign In with LinkedIn using OpenID Connect](https://learn.microsoft.com/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)
3. [Authorization code flow](https://learn.microsoft.com/linkedin/shared/authentication/authorization-code-flow)
4. [UGC Post API](https://learn.microsoft.com/linkedin/compliance/integrations/shares/ugc-post-api)
5. [Posts API](https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api)
6. [Community Management app review](https://learn.microsoft.com/linkedin/marketing/community-management-app-review)
