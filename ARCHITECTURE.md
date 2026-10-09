# Architecture

## 1. Recommended shape

Use a modular monolith with a separate web application, API process, and worker. Keep one database and one domain model. Avoid independently deployed agent services until load or team boundaries justify them.

```text
Web app and Telegram Mini App
            |
            v
       FastAPI API
            |
   +--------+---------+
   |        |         |
   v        v         v
Postgres  Agent     Job queue
and RLS   runtime       |
   |        |           v
   |        |      Worker processes
   |        |           |
   +--------+-----------+
            |
    Provider adapters
            |
  +---------+----------+---------+
  |         |          |         |
Buffer   PostHog    Telegram   Stripe
```

## 2. Repository layout

```text
agentic-marketing-system/
├── apps/
│   ├── web/                    # Next.js web and Telegram Mini App UI
│   └── api/                    # FastAPI HTTP API
├── packages/
│   ├── contracts/              # OpenAPI-generated TS client and shared schemas
│   └── ui/                     # Shared UI components
├── services/
│   └── worker/                 # Background jobs and scheduled work
├── supabase/
│   ├── migrations/
│   ├── seed.sql
│   └── tests/                  # RLS and database tests
├── docs/
│   ├── decisions/
│   ├── runbooks/
│   └── integrations/
├── docker-compose.yml
├── Makefile
└── README.md
```

Python domain and adapter packages can initially live under `apps/api/app/`. Extract them only when the worker needs a shared installable package.

## 3. Bounded modules

### Identity and tenancy

Owns workspaces, memberships, roles, invitations, and authorization. The API derives workspace context from the authenticated user. It never accepts a workspace identifier as proof of access.

### Product intelligence

Owns products, source ingestion, Product Brain schemas, versioning, and citation tracking.

### Campaigns

Owns objectives, campaign plans, content items, content versions, and workflow transitions.

### Approvals

Owns approval policy, immutable decisions, audit events, and invalidation when content changes.

### Distribution

Owns provider connections, channels, capability checks, scheduling, status synchronization, and normalized provider errors.

### Measurement

Owns attribution links, observations, reporting windows, normalized metrics, and learnings.

### Entitlements

Owns plans, usage limits, feature access, and billing-provider synchronization.

## 4. Agent workflow

Application code is the orchestrator. Agents propose typed artifacts. They do not own permissions or side effects.

```text
User request
    |
    v
Authorize and create agent_run
    |
    v
Load exact Product Brain version and constraints
    |
    v
Manager calls bounded specialist tools
    |
    v
Validate structured output with Pydantic
    |
    +---- invalid ---> repair once ---> fail visibly
    |
    v
Run deterministic claim and policy checks
    |
    v
Persist a new version and audit event
    |
    v
Return artifact for human review
```

Recommended OpenAI Agents API pattern:

- OpenAI-hosted sessions for durable agent work
- Start with one campaign strategist before introducing specialist subagents
- Pydantic output types for all persisted agent artifacts
- Function tools with the smallest possible capabilities
- Input, output, and tool guardrails
- Per-run tracing with sensitive data disabled or redacted
- Explicit approval on tools that cause side effects
- Session memory only for interaction continuity, never as the source of record

## 5. Trust boundaries

Treat these inputs as untrusted:

- Imported websites and documents
- User-provided competitor copy
- Model outputs
- Webhook bodies before signature verification
- Telegram `initDataUnsafe`
- Provider error strings

Only application code may:

- Decide authorization
- Transition workflow status
- Resolve tenant scope
- Decrypt credentials
- Approve a content version
- Schedule or cancel a post
- Change billing entitlements
- Delete data

Prompt injection defense starts with architecture. Delimit external text, label it as data, do not expose powerful tools to ingestion agents, and validate every proposed action in code.

## 6. Publishing transaction

Scheduling is a two-stage process because the remote provider is outside the database transaction.

1. API verifies membership, approver role, current approved version, channel capability, and time.
2. API creates a `publications` row in `pending` state with a unique idempotency key.
3. Worker locks the row and calls the provider adapter.
4. Adapter sends the idempotency key where supported and stores the provider request and post identifiers.
5. Worker marks the record `scheduled` or `failed` and writes an audit event.
6. Reconciliation jobs query provider state and repair missed webhook transitions.

Database uniqueness on `(provider, idempotency_key)` prevents duplicate local attempts. The adapter must also query by stored provider ID before retrying an ambiguous timeout.

## 6.1 PayPal revenue attribution

PayPal is the commercial truth source for the hackathon build. The browser sends an offer identifier, never an authoritative amount. The API resolves price and currency from its own catalog, creates an Orders v2 order with an idempotency key, and attaches application-owned campaign attribution.

After buyer approval, the API captures the order server-side and records both order and capture identifiers. Webhook events are verified before processing and stored idempotently by PayPal event ID. The revenue-learning agent receives normalized payment evidence, not raw provider payloads.

Missing credentials disable the PayPal routes with an explicit unavailable response. Fake adapters are restricted to tests.

## 7. Provider interfaces

```python
class PublishingProvider(Protocol):
    async def list_channels(self, connection_id: UUID) -> list[Channel]: ...
    async def validate(self, draft: PublishDraft) -> ValidationResult: ...
    async def schedule(self, draft: PublishDraft, idempotency_key: str) -> PublishResult: ...
    async def cancel(self, provider_post_id: str) -> CancelResult: ...
    async def get_status(self, provider_post_id: str) -> PublicationStatus: ...
    async def get_metrics(self, provider_post_id: str) -> list[MetricObservation]: ...
```

Adapters normalize provider-specific data but preserve the raw response in restricted storage for debugging. Tests use a fake adapter, never a live provider.

## 8. Jobs

Required jobs:

- Import product source
- Generate or refresh Product Brain
- Generate campaign plan
- Generate and review content
- Schedule publication
- Reconcile publication status
- Import post metrics
- Generate weekly report
- Send Telegram notification
- Apply billing webhook update
- Delete expired data

Every job has a stable type, schema-versioned payload, maximum attempts, backoff policy, and terminal failure state. Do not put secrets in job payloads. Store identifiers and resolve secrets at execution time.

Use a small `JobDispatcher` interface so Trigger.dev can be replaced. For early dogfooding, a Postgres queue is acceptable if locking and retries are tested.

## 9. Data isolation

Every workspace-owned table includes `workspace_id`, even when it could be inferred through joins. This makes RLS rules simpler to inspect and reduces accidental cross-tenant joins.

Policy pattern:

```sql
using (
  exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = target.workspace_id
      and wm.user_id = auth.uid()
  )
)
```

Writes also enforce role-specific `with check` policies. Service-role access is restricted to API and worker processes. Automated tests create two workspaces and prove isolation for every tenant table.

## 10. Product Brain versioning and retrieval

The Product Brain is a structured snapshot, not a mutable JSON blob. Each save creates a new version. Campaigns reference one exact version.

Use ordinary relational filters plus JSONB in V1. Add embeddings only after a retrieval evaluation proves they improve recall. A small product record does not need vector search.

When marketing history grows:

- Store raw observations separately from learnings.
- Retrieve learnings by product, channel, objective, audience, recency, and confidence.
- Apply time decay and invalidate contradicted learnings.
- Keep evidence identifiers so a user can inspect the basis.

## 11. Metrics and attribution

Use PostHog for product behavior and funnels. Use application tables for campaign truth and normalized external metrics.

Each outbound URL includes:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- an opaque first-party short code

The redirect endpoint records a click, then redirects to an allowlisted destination. It must prevent open redirects. Mobile attribution and store installs require a later dedicated provider or first-party app event bridge.

Do not compare raw views across networks as if definitions are identical. Store metric source, provider name, observation time, and raw definition metadata.

## 12. Telegram authentication

1. The Mini App sends raw `initData` over TLS.
2. The API validates the signature using Telegram's documented algorithm.
3. The API rejects stale `auth_date` values.
4. The API maps Telegram user ID to a verified application user and membership.
5. Approval endpoints still perform ordinary role checks.
6. Group-chat updates never include private campaign content.

Bot callback data uses opaque, short-lived tokens rather than raw record identifiers or authorization claims.

## 13. Billing and entitlements

Stripe is the source for web payment status. The application is the source for feature entitlement decisions.

Webhook flow:

1. Verify signature against the raw request body.
2. Deduplicate on Stripe event ID.
3. Store a restricted event record.
4. Update subscription and entitlement projection transactionally.
5. Return quickly and process slow follow-up work asynchronously.

Telegram Stars should map to the same internal entitlement model, using a distinct billing provider. Do not attempt to reuse a Stripe checkout inside Telegram for digital service access.

## 14. Observability

Capture:

- Correlation ID across API, job, agent run, and provider call
- Agent trace ID with sensitive fields excluded
- Structured logs with workspace and resource identifiers
- Provider latency and normalized error code
- Job queue depth, retry count, and dead letters
- Token usage and estimated cost per artifact
- Publish success rate and approval bypass attempts

Alerts:

- Any authorization or RLS regression
- Duplicate provider publication
- Webhook verification failures above baseline
- Sustained publication failures
- Weekly report jobs missing their window
- Cost anomaly by workspace

## 15. Environments and delivery

- Local: Supabase local stack, fake publishing adapter, Stripe CLI fixtures, Telegram disabled or test bot
- Staging: isolated Supabase project, provider test connections, non-production bot, synthetic products
- Production: separate secrets, domains, provider apps, database, and PostHog project

CI gates:

- Formatting, linting, type checks, unit tests
- Database migration validation
- RLS isolation tests
- API contract diff
- Agent schema and golden-set evaluations
- End-to-end test with fake providers
- Dependency and secret scans

## 16. Architecture decisions

### ADR-001: Modular monolith first

Chosen because the domain is still changing and strong transactions matter more than independent scaling.

### ADR-002: Deterministic orchestration

Chosen because agent autonomy must not control permissions, workflow transitions, or external writes.

### ADR-003: Human approval is a domain invariant

Chosen because a UI-only approval check can be bypassed. The API, database state, and provider adapter all enforce the approved version.

### ADR-004: Buffer behind an adapter

Chosen for delivery speed while preserving a route to direct integrations. TikTok is not promised until a supported path is verified.

### ADR-005: Telegram is a client

Chosen to prevent duplicated business logic and inconsistent permissions.

### ADR-006: n8n is optional edge automation

Use it for prototypes and low-risk notifications. Core campaign state, approval, and publishing truth stay in application code and Postgres.

## 17. Official references verified 2026-10-07

- OpenAI Agents SDK: https://openai.github.io/openai-agents-python/
- Buffer posts and scheduling: https://developers.buffer.com/guides/posts-and-scheduling.html
- Telegram Mini Apps: https://core.telegram.org/bots/webapps
- Telegram Stars payments: https://core.telegram.org/bots/payments-stars
- PostHog product analytics: https://posthog.com/docs/product-analytics
- PostHog feature flags: https://posthog.com/docs/feature-flags
- Stripe recurring pricing models: https://docs.stripe.com/billing/subscriptions/metered-billing/thresholds
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
