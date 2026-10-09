# Agentic Marketing System

An approval-first marketing operating system for apps, SaaS products, and digital products.

The product turns a product brief into a campaign, creates platform-specific content, routes it through human approval, schedules approved posts, measures results, and records evidence-backed lessons for the next campaign.

## Product promise

> Give the system a product and a measurable objective. It proposes the next best campaign, prepares the assets, waits for approval, publishes, measures the outcome, and recommends the next action.

The repository contains the first application foundation: a responsive campaign-review workspace, a FastAPI service with liveness and readiness probes, a live hosted OpenAI agent adapter, a worker shell, shared contracts, and the first Supabase migration.

The active competition build is **Northstar: the agentic revenue loop for indie software sellers**. It is being prepared for the 2026 PayPal AI Hackathon. See [the hackathon strategy](./docs/hackathon/paypal-ai-2026.md).

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
- `POST /v1/agents/next-action` loads the stored campaign, turns normalized PayPal revenue into one approval-gated experiment, and records it in the campaign history.

Until PayPal sandbox credentials are configured, PayPal routes return `503`. Tests use an explicit fake adapter. The application never treats placeholder credentials or fake responses as payments.

### PayPal sandbox checkout

Open the campaign workspace and select **Preview checkout**. The buyer-facing modal loads PayPal's official JavaScript SDK, creates the order through the API, captures it after approval, and displays the capture receipt. Use a Personal account from PayPal's Sandbox Accounts page. No real money moves in sandbox mode.

## Documents

- [SPEC.md](./SPEC.md) defines the product, V1 scope, user stories, data model, API surface, agent contracts, security, analytics, and acceptance criteria.
- [ARCHITECTURE.md](./ARCHITECTURE.md) defines the recommended technical design and key decisions.
- [PROMPTS.md](./PROMPTS.md) contains sequential implementation prompts for a coding agent. Run them in order.
- [docs/hackathon/paypal-ai-2026.md](./docs/hackathon/paypal-ai-2026.md) maps official requirements and judging criteria to the competition build.

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
