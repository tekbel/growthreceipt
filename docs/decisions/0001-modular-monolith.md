# ADR 0001: Modular monolith with deterministic orchestration

Status: accepted

## Decision

Use a Next.js client, FastAPI API, Python worker, and one Postgres database. Application code owns authorization, state transitions, approval, and provider side effects. Agents return typed proposals through a gateway and cannot mutate workflow state directly.

## Why

The domain is still changing. Strong transaction boundaries, inspectable approval rules, and fast iteration matter more than independent service scaling. The agent gateway and provider adapters preserve future replacement paths without distributing the system prematurely.

## Consequences

- Deployable processes share one domain and database.
- Tests can replace agents, jobs, and providers with deterministic fakes.
- A later service extraction requires evidence from load or ownership boundaries.

