create extension if not exists pgcrypto;

-- Own schema so the app can share a Supabase project without name clashes.
create schema if not exists growthreceipt;

create table growthreceipt.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  timezone text not null default 'UTC',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type growthreceipt.workspace_role as enum ('owner', 'approver', 'editor', 'viewer');

create table growthreceipt.workspace_members (
  workspace_id uuid not null references growthreceipt.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role growthreceipt.workspace_role not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table growthreceipt.workspaces enable row level security;
alter table growthreceipt.workspace_members enable row level security;

create or replace function growthreceipt.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from growthreceipt.workspace_members membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
  );
$$;

revoke all on function growthreceipt.is_workspace_member(uuid) from public;
grant usage on schema growthreceipt to authenticated;
grant execute on function growthreceipt.is_workspace_member(uuid) to authenticated;

create policy "members can read workspaces"
on growthreceipt.workspaces for select
using (
  growthreceipt.is_workspace_member(id)
);

create policy "members can read memberships"
on growthreceipt.workspace_members for select
using (
  growthreceipt.is_workspace_member(workspace_id)
);
