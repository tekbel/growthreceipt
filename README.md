# Agentic Marketing System

An approval-first marketing operating system for apps, SaaS products, and digital products.

The product turns a product brief into a campaign, creates platform-specific content, routes it through human approval, schedules approved posts, measures results, and records evidence-backed lessons for the next campaign.

## Product promise

> Give the system a product and a measurable objective. It proposes the next best campaign, prepares the assets, waits for approval, publishes, measures the outcome, and recommends the next action.

The repository contains the first application foundation: a responsive campaign-review workspace, a FastAPI service with liveness and readiness probes, a live hosted OpenAI agent adapter, a worker shell, shared contracts, and the first Supabase migration.

The active competition build is **GrowthReceipt: marketing backed by payments**. It is being prepared for the 2026 PayPal AI Hackathon. See [the hackathon strategy](./docs/hackathon/paypal-ai-2026.md).

![GrowthReceipt architecture](./docs/architecture/overview.png)

The loop and who pays whom are explained in [docs/hackathon/architecture.md](./docs/hackathon/architecture.md).

## Current implementation

```text
apps/web              Next.js campaign review workspace
apps/api              FastAPI and agent/job interfaces
services/worker       Background worker process shell
packages/contracts    Shared TypeScript API contract
supabase              Local configuration and migrations
docs/design           Accepted visual concept
```

### Local setup

```bash
cp .env.example .env
make setup
make db-up
make demo-seed
make dev-api
make dev-web
```

`make demo-seed` applies migrations and loads the judge demo campaign. `make demo-reset` deletes the demo workspace campaigns and PayPal orders, then reseeds. Both refuse to run when `APP_ENV=production`.

Use separate terminals for the API and web commands. The API runs on port 8000 and the web app on port 3000 by default.

For local PayPal webhooks, start the restricted relay and fixed ngrok endpoint in two more terminals:

```bash
make dev-paypal-relay
make dev-paypal-tunnel
```

The tunnel always uses `https://justify-usual-twirl.ngrok-free.dev/v1/paypal/webhooks`, so the PayPal sandbox webhook configuration does not need to change after restarts. Only the webhook route is exposed by the relay. Other paths return `404`.

### Implemented API slices

- `POST /v1/campaigns` turns a product brief into a typed campaign through an OpenAI-hosted agent session and persists it for review.
- `POST /v1/campaigns/stream` does the same and reports each step the agent reaches as server-sent events (`progress`, then `campaign` or `error`). The web app uses this route.
- `GET /v1/campaigns/latest` and `GET /v1/campaigns/{campaign_id}` load a campaign with its posts.
- `PATCH /v1/campaigns/{campaign_id}/posts/{post_id}` edits a post, approves it, or requests changes with a note. Edited text always needs a fresh approval.
- `POST /v1/campaigns/{campaign_id}/approve` approves every post in the campaign.
- `GET /v1/campaigns/{campaign_id}/events` returns the audit history of agent outputs and human decisions.
- `POST /v1/agents/campaign-draft` returns a typed campaign draft without saving it.
- `POST /v1/paypal/orders` creates an attributed PayPal order from a server-owned offer. The campaign and post must exist.
- `POST /v1/paypal/orders/{order_id}/capture` captures an approved order and normalizes its result.
- `POST /v1/paypal/webhooks` verifies the PayPal signature before accepting an event.
- `GET /v1/paypal/config` exposes only the browser-safe sandbox client configuration.
- `GET /v1/paypal/revenue/{campaign_id}` returns persisted, attributed revenue evidence.
- `POST /v1/agents/follow-up-post` drafts the one post an approved next move asks for, built on the post that earned the revenue. It waits in review.
- `POST /v1/agents/next-action/decision` records the founder approving, editing or rejecting the latest next move. Nothing runs without it.
- `GET /v1/paypal/receipts/{campaign_id}` returns each completed purchase with its post, order and capture IDs, and the signature verified PayPal webhooks that match it.
- `POST /v1/agents/next-action` loads the stored campaign, turns normalized PayPal revenue into one approval-gated experiment, and records it in the campaign history.
- `GET /v1/workspace/settings` and `PATCH /v1/workspace/settings` read and save the workspace name and time zone. The time zone must be a known IANA zone, and null follows each viewer's browser.

Until PayPal sandbox credentials are configured, PayPal routes return `503`. Tests use an explicit fake adapter. The application never treats placeholder credentials or fake responses as payments.

### PayPal sandbox checkout

Approved posts also get **Publish on LinkedIn** or **Publish on X**. It opens that channel's official share composer with the post and its buy link filled in, and the founder presses Post. GrowthReceipt never posts on its own. Facebook's sharer takes only the link, so the text is copied for pasting, and Instagram gets a copy button because it has no web composer.

Approve a post, then select **Make a test purchase** or open **Customer checkout**. Each approved post has a public buy page at `/buy/{post id}` that needs no sign in. It loads PayPal Web SDK v6, checks PayPal eligibility, creates the order through the public API (`/v1/public/...`), captures it after approval, and shows the receipt. The server resolves the campaign from the post and refuses posts that are not approved. Use a Personal account from PayPal's Sandbox Accounts page. Set `PAYPAL_SANDBOX_BUYER_EMAIL` and `PAYPAL_SANDBOX_BUYER_PASSWORD` to show that login on the buy page, which is how judges pay on the hosted demo. The API only shares them in sandbox mode. No real money moves in sandbox mode.

### LinkedIn publishing

Founders can connect their own LinkedIn profile under Integrations. GrowthReceipt then posts approved LinkedIn posts, with their attributed buy link, either on a confirmed **Post to LinkedIn now** click or automatically on the post's scheduled day from 9:00 in the workspace time zone. Automatic posting only covers approved posts dated on or after the day it was turned on. Nothing in review is ever posted.

It uses LinkedIn's self serve products, Sign In with LinkedIn using OpenID Connect and Share on LinkedIn (`openid profile w_member_social`), and posts through `POST https://api.linkedin.com/v2/ugcPosts`.

- `GET /v1/integrations/linkedin` returns whether LinkedIn is configured and connected, the member name, token expiry and the auto publish choice.
- `POST /v1/integrations/linkedin/authorize` returns the LinkedIn sign in URL with a signed state for this workspace.
- `POST /v1/integrations/linkedin/connect` finishes the sign in. LinkedIn redirects to the web app at `/integrations/linkedin/callback`, and the signed in web app sends the code here, so a forged callback cannot attach a LinkedIn profile to another workspace.
- `PATCH /v1/integrations/linkedin` turns automatic posting on or off. `DELETE /v1/integrations/linkedin` revokes the token and forgets it.
- `POST /v1/integrations/linkedin/posts/{post_id}/publish` posts one approved, unpublished LinkedIn post. A published post can no longer be edited.

Setup:

1. Create an app at https://www.linkedin.com/developers/apps (it must be linked to a LinkedIn Page), then add the **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn** products.
2. Under Auth, add the redirect URLs `https://growthreceipt.addisstack.com/integrations/linkedin/callback` and `http://localhost:3001/integrations/linkedin/callback`.
3. Run `supabase/migrations/20261011000100_linkedin_publishing.sql`.
4. Set `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` and `LINKEDIN_TOKEN_KEY` on the API. Generate the key with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. It encrypts stored tokens, so changing it means every workspace reconnects. `WEB_ORIGIN` must be the web app's address, because the redirect URL is built from it.

Without these variables the Integrations page keeps the share link behaviour. LinkedIn access tokens last 60 days and self serve apps get no refresh token, so the founder reconnects when the Integrations page says the connection expired. The API checks for due posts every five minutes, and a claim column stops two replicas from posting the same item.

## Documents

- [SPEC.md](./SPEC.md) defines the product, V1 scope, user stories, data model, API surface, agent contracts, security, analytics, and acceptance criteria.
- [ARCHITECTURE.md](./ARCHITECTURE.md) defines the recommended technical design and key decisions.
- [PROMPTS.md](./PROMPTS.md) contains sequential implementation prompts for a coding agent. Run them in order.
- [docs/hackathon/paypal-ai-2026.md](./docs/hackathon/paypal-ai-2026.md) maps official requirements and judging criteria to the competition build.
- [docs/hackathon/judge-runbook.md](./docs/hackathon/judge-runbook.md) defines the canonical judge path, expected evidence, and final rehearsal.
- [docs/hackathon/architecture.md](./docs/hackathon/architecture.md) shows the architecture diagram, the eight step loop, and the payment model.
- [docs/integrations/linkedin.md](./docs/integrations/linkedin.md) records the deferred LinkedIn OAuth, publishing, security, and review plan.

## Recommended build order

1. Foundation, authentication, tenancy, and local development
2. Product Brain onboarding
3. Campaign strategy generation
4. Content generation and review
5. Approval workflow and audit log
6. Buffer scheduling
7. Metrics ingestion and weekly learning report
8. Telegram bot and Mini App shell
9. Billing and public SaaS controls
10. Production hardening

## V1 completion test

A user can:

1. Create a workspace and product.
2. Generate a structured Product Brain from a URL and manual inputs.
3. Set a measurable marketing objective.
4. Generate a seven-day campaign and channel-specific drafts.
5. Edit, approve, reject, and regenerate individual drafts.
6. Schedule approved supported-channel posts through Buffer.
7. See publication status and imported post metrics.
8. Receive a weekly report containing evidence, confidence, and recommended next actions.
9. Review and approve the same campaign from Telegram.

No agent may publish, spend money, change billing, or connect an external account without an explicit user action.

## Opinionated V1 stack

- Web: Next.js, TypeScript, Tailwind CSS, shadcn/ui
- API: FastAPI, Python, Pydantic
- Agent runtime: OpenAI Agents API with hosted execution and structured Pydantic outputs
- Data, auth, storage: Supabase Postgres, Auth, Storage, Row Level Security
- Jobs: Trigger.dev or a Postgres-backed worker behind a small interface
- Social publishing: Buffer API for currently supported channels
- Product analytics: PostHog
- Billing: Stripe on the web
- Telegram: Bot API plus a Mini App using the shared web frontend and backend
- Hosting: Vercel for web, Railway or Fly.io for API and worker

## Explicit non-goals for V1

- Fully autonomous publishing
- Autonomous ad spend
- A custom social scheduling engine
- Direct integrations with every social network
- Competitor scraping at scale
- Video or image generation pipelines
- Multi-agent swarms
- White-label agency features
- Marketing attribution beyond first-party events and imported post metrics

## External assumptions to verify before implementation

Provider APIs, pricing, scopes, rate limits, and platform policies can change. Recheck official documentation when implementing each integration. As verified on 2026-10-07:

- Buffer exposes GraphQL post creation and scheduling. Its documented API channel list does not include TikTok.
- Telegram Mini Apps require server-side validation of `initData`. Digital goods and services sold inside Telegram must use Telegram Stars.
- The OpenAI Agents SDK supports structured outputs, tools, guardrails, human approval, sessions, MCP, and tracing.

## First command for a coding agent

Open `PROMPTS.md` and execute Prompt 00. Do not run all prompts in one unreviewed pass.
