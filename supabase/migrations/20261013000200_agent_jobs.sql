-- One row per agent run the web app may need to follow after a reload. The API writes progress
-- and a heartbeat while the run works. agent_runs stays the quota counter.
create table growthreceipt.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references growthreceipt.workspaces (id) on delete cascade,
  kind text not null check (kind in ('campaign_draft', 'next_action')),
  campaign_id uuid references growthreceipt.campaigns (id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'interrupted')),
  progress jsonb not null default '[]'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_jobs_workspace_created_idx
  on growthreceipt.agent_jobs (workspace_id, created_at desc);

-- Only the API writes here. Clients get no access.
alter table growthreceipt.agent_jobs enable row level security;
