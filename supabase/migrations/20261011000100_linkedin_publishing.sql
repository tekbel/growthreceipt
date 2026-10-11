-- One LinkedIn member per workspace. The access token is encrypted by the API before storage.
create table growthreceipt.linkedin_connections (
  workspace_id uuid primary key references growthreceipt.workspaces (id) on delete cascade,
  member_urn text not null,
  member_name text not null,
  access_token_encrypted text not null,
  expires_at timestamptz not null,
  auto_publish boolean not null default false,
  -- Scheduled publishing never reaches back before the day it was turned on.
  auto_publish_since date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only the API reads or writes connections. Clients get no access.
alter table growthreceipt.linkedin_connections enable row level security;

alter table growthreceipt.campaign_posts
  add column published_at timestamptz,
  add column published_url text,
  -- Set while a publish is in flight, so two workers cannot post the same item twice.
  add column publish_claimed_at timestamptz;
