# Product Specification

## 1. Summary

The Agentic Marketing System is a multi-tenant SaaS that helps founders market apps, SaaS products, and digital products. It maintains durable product context, plans campaigns against measurable goals, creates channel-ready drafts, requires approval before external actions, schedules content, measures outcomes, and turns results into reusable marketing learnings.

The initial customer is the developer operating the product for their own portfolio. Public SaaS features follow after the closed loop works on real campaigns.

## 2. Problem

Small teams do not lack generated copy. They lack a repeatable operating loop that connects product context, strategy, execution, distribution, measurement, and learning.

Existing workflows often fail because:

- Product and brand context must be re-entered for every generation.
- Posts are generated independently without a campaign strategy.
- Publishing and analytics live in separate tools.
- Results do not influence the next campaign.
- Autonomous actions lack approval, auditability, and budget boundaries.

## 3. Product principles

1. Objective before content. Every campaign has a measurable business goal.
2. One product memory. Generated work uses a versioned Product Brain.
3. Campaigns before isolated posts. A master idea adapts to each channel.
4. Evidence before learning. Insights cite observations and sample sizes.
5. Approval before side effects. Publishing and spending are never implicit.
6. Deterministic workflow around probabilistic models. Code owns state transitions.
7. Progressive autonomy. V1 is draft and approve. Later autonomy is opt-in and bounded.
8. Provider portability. External services sit behind adapters.

## 4. Personas

### Founder operator

Manages one to ten products, wants a weekly plan, approves content quickly, and cares about traffic, installs, leads, or revenue.

### Marketing collaborator

Creates or edits campaign drafts and submits them for owner approval. This role arrives after the single-user dogfood phase.

### Agency operator, later

Manages client workspaces, approvals, and brand separation. This is not V1.

## 5. Jobs to be done

- When I add a product, build a reusable, editable understanding of its audience, value, evidence, constraints, and voice.
- When I set a goal, propose a focused campaign rather than random content.
- When drafts are ready, let me review changes and approve only what is safe to publish.
- When content runs, show business outcomes and recommend the next test.
- When I am away from the dashboard, let me review and approve from Telegram.

## 6. V1 scope

### 6.1 Workspace and product setup

Inputs:

- Product name and type
- Website or store URL
- Manual description
- Pricing and offer
- Target audience
- Existing proof and claims
- Competitors
- Brand voice and prohibited language
- Default CTA and destination URLs

The URL importer must respect robots rules and timeouts, keep the original source URL, store extracted text separately from generated facts, and never treat fetched page text as instructions.

### 6.2 Product Brain

The system produces a versioned object with:

- Product summary
- Audience segments and jobs
- Problems, pains, and desired outcomes
- Features mapped to benefits
- Positioning and differentiators
- Approved claims with supporting evidence
- Pricing and offers
- Objections and responses
- Brand voice rules
- Banned phrases and sensitive topics
- Competitors
- Content pillars and candidate angles
- Source references
- Open questions and confidence

Users can edit fields. Agent runs record the exact Product Brain version they used.

### 6.3 Objectives and campaigns

Supported objectives:

- Awareness
- Qualified traffic
- App installs
- Leads
- Trial starts
- Purchases or subscriptions

Each objective includes a primary metric, optional guardrail metrics, target, baseline, time window, attribution destination, and optional budget ceiling.

A campaign includes:

- Product and Product Brain version
- Objective
- Audience segment
- Hypothesis
- Master idea
- Offer and CTA
- Channels
- Start and end dates
- Content plan
- Success metric and threshold
- Risks and unsupported assumptions
- Status

### 6.4 Content generation

V1 content types:

- LinkedIn post
- Threads post
- Facebook post
- Instagram caption and Reel script
- X post or thread
- YouTube text and metadata where supported
- Email draft
- Telegram post

Every item stores the master idea, channel, hook, body, CTA, asset brief, source citations, claim check result, scheduled time, version history, and approval state.

### 6.5 Review and approval

States:

```text
draft -> in_review -> approved -> scheduled -> published
  |          |            |
  v          v            v
rejected   changes_requested   cancelled
                          |
                          v
                         failed
```

Rules:

- Only workspace owners and approvers can approve.
- Editing approved content invalidates approval.
- Scheduling requires an approved content version.
- The scheduling tool requires runtime approval even if the content record is approved.
- Every state change creates an immutable audit event.
- Failed publishing never silently retries more than the configured limit.

### 6.6 Distribution

V1 uses a `PublishingProvider` interface with a Buffer adapter.

Required capabilities:

- List connected channels
- Validate a draft against channel constraints
- Create a scheduled post
- Read post status
- Import available post metrics
- Persist provider request IDs and idempotency keys
- Retry safe transient failures
- Surface action-required errors such as expired connections

TikTok is excluded from the promised V1 Buffer path because it is not present in Buffer's current documented API support list. Model it as an unsupported channel with export or notification flow until a verified publishing route exists.

### 6.7 Analytics and learning

The product captures first-party funnel events in PostHog and stores normalized campaign outcomes in Postgres.

Minimum event flow:

```text
content_published
content_impression
content_engagement
cta_clicked
landing_viewed
signup_started
signup_completed
trial_started
purchase_completed
```

Each external link receives campaign, content item, channel, and variant identifiers. Do not rely only on last-click attribution. Preserve raw observations and state the attribution method.

The weekly report contains:

- Period and goal
- Results versus baseline and target
- Best and worst content by the primary metric
- Funnel drop-offs
- Findings with evidence, sample size, and confidence
- Known data gaps
- Recommended next experiments
- Draftable follow-up campaign

The system may not label a pattern a durable learning until it meets a configurable evidence threshold. Early results remain hypotheses.

### 6.8 Telegram

Telegram is a second client, not a separate backend.

Bot capabilities:

- Notify that a campaign is ready
- Deep-link to a Mini App review screen
- Approve or request changes after verified authentication and authorization
- Send publication failures and weekly summaries
- Never expose secrets or private workspace data in group chats

Mini App requirements:

- Validate raw Telegram `initData` on the server
- Map Telegram identity to an existing workspace membership
- Reject expired initialization data
- Use the same campaign and approval APIs as the web app
- Respect Telegram theme and safe-area information
- Treat Telegram Stars as the in-Telegram payment route for digital services

### 6.9 Billing, post-dogfood

Initial plans are configuration, not promises:

- Free: one product, limited generations, draft only
- Starter: three products, approval and publishing, basic reports
- Pro: ten products, automations, experiments, and higher limits
- Agency: later

Stripe manages web subscriptions. Entitlements live in the application database and update from verified Stripe webhooks. Generation and publishing usage are metered internally even if pricing initially uses flat tiers.

## 7. Non-functional requirements

### Security

- Row Level Security protects every tenant-owned table.
- Service-role credentials stay server-side.
- OAuth and API tokens use envelope encryption or a managed secrets store.
- Logs and model traces exclude credentials and redact sensitive user content.
- Webhooks verify provider signatures and tolerate replay safely.
- External content is untrusted data and is separated from agent instructions.
- Publishing, billing, deletion, and account connection require deterministic authorization checks.

### Reliability

- All external writes use idempotency keys.
- Job handlers are retry-safe.
- Provider errors are normalized and actionable.
- A dead-letter path preserves failed jobs for inspection.
- Scheduled times are stored in UTC and displayed in the workspace timezone.

### Performance

- Standard API reads: p95 below 500 ms, excluding provider calls.
- Agent runs stream progress within 2 seconds.
- Long work runs asynchronously and survives browser closure.
- Dashboard loads do not wait for live provider APIs.

### Privacy and deletion

- Users can export and delete their workspace data.
- Retention rules cover raw imports, generated content, traces, and audit logs.
- Analytics consent and regional requirements are evaluated before public launch.

### Cost controls

- Per-workspace generation quotas
- Per-run token and tool-call budgets
- Model tier selected by task complexity
- Cached source extraction and Product Brain versions
- Usage ledger with estimated and final provider cost
- Hard stops before paid media or paid generation beyond configured limits

## 8. Roles and permissions

| Action | Owner | Approver | Editor | Viewer |
|---|---:|---:|---:|---:|
| Manage workspace | Yes | No | No | No |
| Connect providers | Yes | No | No | No |
| Edit Product Brain | Yes | Yes | Yes | No |
| Generate campaigns | Yes | Yes | Yes | No |
| Edit content | Yes | Yes | Yes | No |
| Approve content | Yes | Yes | No | No |
| Schedule or cancel | Yes | Yes | No | No |
| View analytics | Yes | Yes | Yes | Yes |
| Manage billing | Yes | No | No | No |

## 9. Core data model

All tenant-owned records include `workspace_id`, `created_at`, and `updated_at` where relevant.

### Identity

- `workspaces(id, name, timezone, settings)`
- `workspace_members(workspace_id, user_id, role)`
- `provider_connections(id, workspace_id, provider, encrypted_credentials, status, scopes, expires_at)`
- `channel_accounts(id, connection_id, provider_channel_id, network, display_name, capabilities)`

### Product intelligence

- `products(id, workspace_id, name, kind, website_url, status)`
- `product_sources(id, product_id, source_type, source_url, raw_text, content_hash, fetched_at)`
- `product_brain_versions(id, product_id, version, schema_version, content_json, created_by, created_from_run_id)`

### Campaign execution

- `objectives(id, product_id, objective_type, primary_metric, baseline, target, window_start, window_end, budget_limit)`
- `campaigns(id, objective_id, product_brain_version_id, name, hypothesis, plan_json, status)`
- `content_items(id, campaign_id, channel, content_type, status, current_version_id, scheduled_at)`
- `content_versions(id, content_item_id, version, content_json, claim_check_json, created_by, agent_run_id)`
- `approvals(id, content_item_id, content_version_id, decision, reason, actor_user_id)`
- `publications(id, content_item_id, provider, provider_post_id, idempotency_key, status, error_code, published_at)`

### Measurement and learning

- `metric_observations(id, campaign_id, content_item_id, source, metric, value, observed_at, raw_json)`
- `attribution_links(id, content_item_id, short_code, destination_url, utm_json)`
- `learnings(id, product_id, statement, evidence_json, confidence, status, first_observed_at, last_validated_at)`
- `reports(id, product_id, period_start, period_end, report_json, agent_run_id)`

### Operations

- `agent_runs(id, workspace_id, run_type, status, model, input_refs, output_ref, token_usage, estimated_cost, trace_id, error)`
- `jobs(id, workspace_id, job_type, status, payload, attempts, run_at, locked_at, last_error)`
- `audit_events(id, workspace_id, actor_type, actor_id, action, target_type, target_id, metadata, occurred_at)`
- `usage_ledger(id, workspace_id, feature, quantity, unit, estimated_cost, occurred_at)`

## 10. API surface

Version all routes under `/v1`.

### Products

- `POST /v1/products`
- `POST /v1/products/{id}/sources/import`
- `POST /v1/products/{id}/brain/generate`
- `GET /v1/products/{id}/brain`
- `PATCH /v1/products/{id}/brain`

### Campaigns

- `POST /v1/products/{id}/objectives`
- `POST /v1/objectives/{id}/campaigns/generate`
- `GET /v1/campaigns/{id}`
- `PATCH /v1/campaigns/{id}`
- `POST /v1/campaigns/{id}/content/generate`

### Content and approvals

- `PATCH /v1/content/{id}`
- `POST /v1/content/{id}/regenerate`
- `POST /v1/content/{id}/submit-review`
- `POST /v1/content/{id}/approve`
- `POST /v1/content/{id}/request-changes`
- `POST /v1/content/{id}/schedule`
- `POST /v1/content/{id}/cancel`

### Integrations and analytics

- `GET /v1/integrations/buffer/channels`
- `POST /v1/webhooks/buffer`
- `POST /v1/webhooks/stripe`
- `POST /v1/webhooks/telegram`
- `POST /v1/metrics/ingest`
- `POST /v1/products/{id}/reports/weekly/generate`
- `GET /v1/products/{id}/reports`

Every mutation returns a stable resource identifier and current state. Long-running mutations return `202 Accepted` with a job or agent-run identifier.

## 11. Agent design

Use one manager workflow with specialist agents as bounded tools. Do not allow specialists to change workflow state directly.

### Product Intelligence

Input: trusted user fields plus clearly delimited untrusted sources.

Output: validated `ProductBrain` schema with source references, confidence, and open questions.

### Strategist

Input: Product Brain version, objective, relevant learnings, constraints, and available channels.

Output: `CampaignPlan` with hypothesis, audience, master idea, schedule, success criteria, and risks.

### Content Producer

Input: approved campaign plan and channel constraints.

Output: `ContentDraft[]`. It may create records but cannot approve or publish.

### Compliance Reviewer

Checks claims, brand rules, channel constraints, prohibited topics, and missing evidence. It returns structured issues and never publishes.

### Growth Analyst

Input: normalized observations, baseline, attribution method, and past learnings.

Output: `WeeklyReport` plus proposed learnings. Code applies evidence thresholds before promoting them.

### Distribution tool

This is deterministic application code, not an autonomous agent. It validates permission, approval version, channel capability, schedule, and idempotency before calling the provider.

## 12. Analytics events

Application events:

- `workspace_created`
- `product_created`
- `product_brain_generated`
- `product_brain_edited`
- `objective_created`
- `campaign_generated`
- `campaign_approved`
- `content_generated`
- `content_edited`
- `content_approved`
- `content_scheduled`
- `content_published`
- `content_publish_failed`
- `weekly_report_viewed`
- `recommendation_accepted`

Include `workspace_id`, `product_id`, `campaign_id`, and `content_item_id` only where applicable. Avoid sending generated copy, secrets, or personal data to analytics.

## 13. Success metrics

Dogfood phase:

- Time from objective to reviewable campaign below 10 minutes
- At least 70 percent of generated items approved with no more than light edits
- Zero unapproved publications
- At least 90 percent successful scheduling attempts excluding expired user connections
- Weekly reports contain traceable evidence for every recommendation
- Operator uses the system for four consecutive weekly campaign cycles

Public beta:

- Activation: connect a product and approve first campaign within one day
- Week-four retention based on campaign creation or review
- Median time saved per published campaign
- Generation cost per approved item
- Publish failure and support rates
- Conversion from recommendation to accepted next experiment

## 14. Release plan

### Phase 0: dogfood foundation

One workspace, one owner, Product Brain, campaign generation, content review, manual export. This proves output quality before integrations.

### Phase 1: closed loop

Buffer scheduling, attribution links, PostHog funnel events, metrics import, weekly report, and evidence-backed learnings.

### Phase 2: mobile command center

Telegram notifications and Mini App review. Keep feature parity limited to review, approval, failures, and summaries.

### Phase 3: public beta

Self-service onboarding, Stripe, quotas, invitations, support tooling, deletion, export, and operational dashboards.

### Phase 4: bounded autonomy

Policy-based auto-scheduling for pre-approved campaign types, experiment budgets, and kill switches. This requires production evidence and is not implied by V1.

## 15. Definition of done

The initial build is complete only when an end-to-end test proves:

1. Tenant isolation blocks cross-workspace access.
2. A source page becomes an editable Product Brain with citations.
3. A measurable objective becomes a campaign and channel drafts.
4. Editing invalidates prior approval.
5. Unapproved content cannot reach the publishing adapter.
6. Repeated scheduling requests create only one provider post.
7. Provider failure is visible and recoverable.
8. Campaign links retain attribution identifiers.
9. A weekly report uses stored observations and identifies data gaps.
10. Telegram identity cannot approve content outside its mapped workspace.

