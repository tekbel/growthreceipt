-- One row per model call, so the API can cap how often each workspace runs the agent.
create table growthreceipt.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references growthreceipt.workspaces (id) on delete cascade,
  kind text not null check (kind in ('campaign_draft', 'next_action')),
  created_at timestamptz not null default now()
);

create index agent_runs_workspace_created_idx
  on growthreceipt.agent_runs (workspace_id, created_at desc);
create index agent_runs_created_idx on growthreceipt.agent_runs (created_at desc);

-- Only the API writes here. Clients get no access.
alter table growthreceipt.agent_runs enable row level security;
