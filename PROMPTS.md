# Sequential Implementation Prompts

These prompts are designed for a coding agent working in the project repository. Run them in order. Start each prompt in a clean task with the prior code available. Review and commit manually after each accepted phase.

Shared instruction for every prompt:

> Read `README.md`, `SPEC.md`, `ARCHITECTURE.md`, existing code, and repository instructions before editing. Preserve unrelated changes. Make the smallest coherent implementation that satisfies the acceptance criteria. Do not deploy, publish, connect production accounts, spend money, or commit. Use fake providers in automated tests. Update documentation when behavior or setup changes. Run focused tests, then the relevant full checks. Report changed files, checks, assumptions, and remaining limitations.

## Prompt 00: Validate architecture and scaffold the monorepo

```text
Create the initial monorepo for the Agentic Marketing System.

Use:
- apps/web: Next.js with TypeScript, App Router, Tailwind, and shadcn/ui
- apps/api: FastAPI with Python, Pydantic, SQLAlchemy or SQLModel, Alembic, pytest, Ruff, and mypy
- services/worker: Python worker sharing domain code through a clear package boundary
- packages/contracts: generated TypeScript client or types from the OpenAPI schema
- Supabase local configuration and migrations

Before generating files, verify current stable setup commands from official documentation. Pin versions using the ecosystem lockfiles. Add one root command for setup and one each for lint, type-check, test, and local development. Add `.env.example` files with names only and no secrets.

Create a health endpoint, a basic web shell, a database connection check, and a fake job dispatcher. Add CI that runs formatting, linting, types, unit tests, and migration validation.

Do not add Buffer, Stripe, Telegram, PostHog, or live model calls yet.

Acceptance criteria:
- A new developer can follow the README and start web, API, database, and worker locally.
- `/health/live` does not require dependencies and `/health/ready` checks required dependencies.
- Web can call the API through a typed client.
- Test and lint commands pass from the repository root.
- Secrets are ignored and no sample value resembles a real credential.
- Architecture deviations are captured in an ADR.
```

## Prompt 01: Implement authentication, workspaces, roles, and RLS

```text
Implement Supabase authentication and multi-tenant workspace authorization.

Create migrations for workspaces, workspace_members, audit_events, and the minimum user profile data. Add owner, approver, editor, and viewer roles. Create API dependencies that derive the authenticated user and verify workspace membership. Do not trust a client-provided workspace ID without checking membership.

Enable Row Level Security for every tenant table. Add explicit read and write policies matching SPEC.md. Add database tests using two users in two workspaces. Include negative tests for cross-tenant reads, writes, updates, and deletes. Create workspace setup UI and a workspace switcher, while keeping server authorization authoritative.

Acceptance criteria:
- Authenticated user can create a workspace and becomes its owner.
- A user cannot read or mutate another workspace through direct database or API access.
- Role restrictions match the permissions table in SPEC.md.
- Every mutation creates an audit event with actor, action, target, and timestamp.
- RLS tests fail if policies are disabled.
- All checks pass.
```

## Prompt 02: Build products, source import, and Product Brain versions

```text
Implement product onboarding and versioned Product Brain generation.

Create product, product_source, product_brain_version, agent_run, and usage_ledger models and migrations. Build forms for manual product data and an optional website URL. Implement a safe source importer with URL validation, private-network blocking, content-type and size limits, redirects capped, timeouts, robots handling, and HTML-to-text extraction. Store source text as untrusted data with content hash and provenance.

Define strict Pydantic schemas for ProductBrain, SourceReference, Claim, AudienceSegment, FeatureBenefit, BrandRules, and OpenQuestion. Build an agent gateway interface and a fake deterministic implementation. Add the OpenAI Agents SDK implementation behind configuration, but automated tests must use the fake. Delimit imported text and instruct the model that it is evidence, not instructions.

Persist a new immutable Product Brain version after schema validation. Build a UI that shows sources, confidence, open questions, and editable structured sections. Manual edits create a new version.

Acceptance criteria:
- A manual product can be created without a URL.
- A permitted public URL can be imported and retains provenance.
- Localhost, private IP, oversized, and non-HTML requests are rejected safely.
- Product Brain output validates against the schema and cites source IDs for claims.
- A campaign can later reference an immutable version ID.
- Cross-tenant and prompt-injection fixtures pass.
- Token and estimated cost usage are recorded without storing secrets.
```

## Prompt 03: Add objectives and campaign strategy generation

```text
Implement measurable objectives and structured campaign planning.

Create objective and campaign models from SPEC.md. Build UI to choose objective type, primary metric, baseline, target, window, attribution destination, channels, and optional budget ceiling. Validate units and dates.

Define a CampaignPlan schema with audience, hypothesis, master idea, offer, CTA, channels, schedule, primary metric, guardrails, risks, assumptions, and source references. Implement a strategist agent that receives one exact Product Brain version plus approved learnings. The agent must flag missing evidence and unsupported assumptions. Application code creates and transitions campaign state.

Create campaign detail and editable review views. Regeneration must create a new plan version or preserve an audit history. Do not generate channel content yet.

Acceptance criteria:
- An objective cannot be saved without a measurable primary metric and window.
- Campaign output is valid structured data, not parsed Markdown.
- Campaign stores the exact Product Brain version used.
- Unsupported claims and missing data are visible to the user.
- Regeneration preserves history and auditability.
- Unit, authorization, schema, and UI tests pass.
```

## Prompt 04: Generate content and enforce claim review

```text
Implement content generation from an approved campaign plan.

Create content_item and content_version models. Define channel capability and constraint configuration in code. Build ContentDraft, AssetBrief, ClaimCheck, and ReviewIssue schemas. Generate one master concept and adapt it to selected channels rather than generating unrelated posts.

Add a compliance reviewer that checks each draft against Product Brain claims, citations, banned phrases, voice rules, CTA destination, and configured channel constraints. Keep this reviewer read-only. Persist the exact inputs, schema version, model metadata, and review result for each agent run while redacting sensitive data.

Build campaign calendar and content editor views. Editing creates a new content version. Regeneration can target a single item and must not overwrite manual edits without confirmation.

Acceptance criteria:
- Every content item points to an immutable current version.
- Claims have source references or are marked unsupported.
- Channel constraints produce actionable validation errors.
- Manual edits and regeneration create version history.
- Golden tests cover at least two products, three voices, and unsupported-claim attempts.
- No content can be marked approved or scheduled in this phase.
```

## Prompt 05: Implement approval workflow and audit invariants

```text
Implement content review, approval, rejection, changes requested, cancellation, and approval invalidation.

Use a domain state machine. Reject illegal transitions in the API regardless of UI state. Store approval decisions against an exact content_version_id. Any content edit after approval returns the item to draft or in-review according to the documented policy and makes the old approval unusable.

Add owner and approver actions in the web UI with accessible confirmation dialogs and clear diffs. Add an immutable audit event for every transition and attempted forbidden action. Prepare a `schedule` application service interface, but use a fake provider and do not call external services.

Acceptance criteria:
- Editors can edit and submit but cannot approve or schedule.
- Approvers approve a specific version, not a mutable item.
- Editing approved content invalidates approval.
- Unapproved and stale approved versions cannot reach the schedule service.
- Concurrent approval and edit requests resolve safely.
- State-machine, role, audit, and concurrency tests pass.
```

## Prompt 06: Integrate Buffer behind a publishing adapter

```text
Implement the PublishingProvider interface and a Buffer adapter using current official Buffer API documentation.

Before coding, verify authentication, GraphQL schema, supported channels, media rules, rate limits, scheduling modes, metrics access restrictions, and webhook or polling options. Record verified details and date in `docs/integrations/buffer.md`. Do not claim TikTok support unless the official API docs list it at implementation time.

Create provider_connections, channel_accounts, publications, and job records. Encrypt credentials using the chosen secrets design. Implement channel discovery, draft validation, custom scheduling, status reconciliation, normalized errors, idempotency, and a fake adapter for tests. Keep provider calls in worker jobs.

Require both the approved content version and runtime authorization before enqueueing. An ambiguous timeout must not create a second post until reconciliation determines the first outcome.

Acceptance criteria:
- Supported channels are discovered from the connected account, not hard-coded in UI claims.
- An approved item can be scheduled once and only once for a given idempotency key.
- Stale or unapproved versions are blocked before provider access.
- Transient, permanent, auth-expired, rate-limit, and ambiguous-timeout cases are tested.
- Provider post ID and status are visible in the UI.
- Live credential tests are opt-in and excluded from CI.
```

## Prompt 07: Add attribution, PostHog, metrics, and weekly learning

```text
Implement first-party campaign attribution and evidence-backed weekly reporting.

Create attribution_link, metric_observation, learning, and report models. Add a short-link redirect endpoint with an allowlisted destination, opaque token, no open redirects, and asynchronous click capture. Generate consistent UTM parameters for every publishable link.

Instrument the application events listed in SPEC.md using PostHog. Do not send generated content, credentials, or unnecessary personal data. Add a metrics adapter that normalizes available Buffer metrics without pretending cross-network definitions are equivalent.

Implement the Growth Analyst schema and weekly report job. Each finding must include metric observations, sample size, date range, attribution method, confidence, and data gaps. Keep proposed learnings separate from validated learnings. Add configurable thresholds and contradiction handling.

Acceptance criteria:
- Links cannot redirect to unapproved hosts or schemes.
- A campaign click and downstream first-party events retain campaign and content identifiers.
- Weekly reports are reproducible from stored observations.
- Sparse data produces a low-confidence hypothesis, not a definitive learning.
- Provider metric names and raw context remain inspectable.
- Analytics payload and report golden tests pass.
```

## Prompt 08: Add Telegram bot and Mini App review

```text
Implement Telegram as a second authenticated client over the existing API.

Before coding, verify current official Mini App initialization, signature validation, Bot API webhook, callback, deep-link, and Telegram Stars requirements. Document the verified behavior and date.

Add a Telegram identity link flow that starts from an authenticated web account and uses a short-lived, single-use token. Validate raw Mini App initData server-side, reject stale data, and map the Telegram user to ordinary workspace membership. Never trust initDataUnsafe.

Implement bot notifications for campaign ready, publish failure, and weekly report. Add a Mini App route for campaign review, content preview, approval, and changes requested. Reuse the existing APIs and state machine. Callback data must be opaque and short lived. Avoid private campaign details in group chats.

Acceptance criteria:
- Invalid, tampered, stale, and replayed Telegram authentication is rejected.
- Telegram users cannot access or approve outside linked memberships.
- Approval records show the underlying application user and Telegram context.
- Deep links open the correct review view without embedding authorization in the URL.
- Telegram is feature-flagged and can be disabled safely.
- Tests use signed fixtures and a fake Bot API.
```

## Prompt 09: Add Stripe billing, plans, quotas, and entitlement checks

```text
Implement web billing and application entitlements after verifying current official Stripe Billing documentation.

Create plan, subscription, entitlement, and usage projection models. Start with flat tiers and internal usage metering. Implement Stripe Checkout and customer portal for web users. Verify webhook signatures using the raw request body, deduplicate events, and update local subscription projections transactionally.

Enforce quotas server-side for products, agent runs, publishing, and scheduled automation. Return clear upgrade errors without losing user drafts. Keep billing provider logic behind an adapter so Telegram Stars can map to the same entitlements later. Do not place Stripe checkout inside the Telegram Mini App for digital service access.

Acceptance criteria:
- Feature access is decided by local entitlements synchronized from verified events.
- Duplicate and out-of-order webhooks are safe.
- Failed payment, cancellation, trial end, upgrade, and downgrade cases are covered.
- Quota checks are atomic under concurrent requests.
- Billing state never grants cross-workspace access.
- Tests use Stripe fixtures or mocks and no live charges.
```

## Prompt 10: Production hardening and beta readiness

```text
Perform a focused production-readiness pass against SPEC.md and ARCHITECTURE.md.

Add or verify rate limits, request size limits, CSRF protections where relevant, secure headers, CORS, SSRF defenses, secret redaction, encryption key rotation plan, database backups, retention and deletion jobs, export flow, webhook replay defenses, job dead letters, reconciliation, alerting, and incident runbooks.

Create an end-to-end test using fake providers that proves the ten Definition of Done cases in SPEC.md. Add agent evaluation fixtures for citation accuracy, unsupported claims, prompt injection, brand rules, and low-evidence reporting. Measure latency and generation cost on the fixture set.

Produce `docs/beta-readiness.md` with evidence for each requirement, known risks, manual verification steps, rollback plans, and items intentionally deferred. Do not deploy.

Acceptance criteria:
- All Definition of Done scenarios have automated or documented manual evidence.
- No critical or high-severity security findings remain open.
- Restore, provider outage, and credential-expiry runbooks exist.
- Logs and traces contain no test secrets or generated sensitive content.
- CI passes from a clean checkout.
- The report clearly states what is not production ready.
```

## Prompt 11: Dogfood one real product without publishing

```text
Prepare a controlled dogfood run for one real product. Do not publish or spend money.

Use the product's real public source material and owner-provided facts to create a Product Brain, measurable objective, seven-day campaign, and channel drafts. Record unclear claims as questions. Evaluate every draft for accuracy, voice, channel fit, CTA, and usefulness. Estimate model cost and operator review time.

Create a dogfood report containing:
- Product Brain corrections
- Campaign and content approval rate
- Edits required by category
- Unsupported claims caught
- Generation latency and cost
- Workflow friction
- Recommendation on whether Buffer connection is justified next

Acceptance criteria:
- Nothing is published or scheduled.
- Every factual claim is supported or flagged.
- The owner can review all artifacts in the web UI.
- Findings create concrete backlog items ranked by impact and effort.
```

## Optional later prompts

Only start these after four successful weekly dogfood cycles:

- Direct TikTok or notification-based posting after official capability verification
- Media generation with explicit per-run cost approval
- Email provider integration
- Competitor and trend research with source freshness rules
- Experiment manager with bounded budget and kill switches
- Agency workspaces, client approval, and white-labeling
- Policy-based auto-scheduling for proven campaign templates

