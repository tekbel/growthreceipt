create type growthreceipt.campaign_post_status as enum (
  'needs_review',
  'changes_requested',
  'approved'
);

create table growthreceipt.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references growthreceipt.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  positioning text not null,
  product_name text not null check (char_length(product_name) between 2 and 120),
  product_description text not null,
  audience text not null,
  objective text not null,
  channels text[] not null,
  brand_voice text not null,
  starts_on date not null default (current_date + 1),
  agent_session_id text,
  agent_turn_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table growthreceipt.campaign_posts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references growthreceipt.campaigns(id) on delete cascade,
  day int not null check (day between 1 and 14),
  channel text not null check (channel in ('LinkedIn', 'X', 'Instagram')),
  theme text not null,
  content text not null,
  call_to_action text not null,
  status growthreceipt.campaign_post_status not null default 'needs_review',
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only record of every agent output and human decision on a campaign.
create table growthreceipt.campaign_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references growthreceipt.campaigns(id) on delete cascade,
  post_id uuid references growthreceipt.campaign_posts(id) on delete cascade,
  actor text not null check (actor in ('agent', 'human', 'system')),
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index campaigns_workspace_created_idx
on growthreceipt.campaigns (workspace_id, created_at desc);

create index campaign_posts_campaign_day_idx
on growthreceipt.campaign_posts (campaign_id, day);

create index campaign_events_campaign_created_idx
on growthreceipt.campaign_events (campaign_id, created_at desc);

-- Orders recorded before campaigns were persisted are not checked.
alter table growthreceipt.payment_orders
  add constraint payment_orders_campaign_fk
  foreign key (campaign_id) references growthreceipt.campaigns(id) on delete cascade not valid;

alter table growthreceipt.payment_orders
  add constraint payment_orders_content_fk
  foreign key (content_id) references growthreceipt.campaign_posts(id) on delete cascade not valid;

alter table growthreceipt.campaigns enable row level security;
alter table growthreceipt.campaign_posts enable row level security;
alter table growthreceipt.campaign_events enable row level security;

create policy "members can read campaigns"
on growthreceipt.campaigns for select
using (growthreceipt.is_workspace_member(workspace_id));

create policy "members can read campaign posts"
on growthreceipt.campaign_posts for select
using (
  exists (
    select 1 from growthreceipt.campaigns campaign
    where campaign.id = campaign_id
      and growthreceipt.is_workspace_member(campaign.workspace_id)
  )
);

create policy "members can read campaign events"
on growthreceipt.campaign_events for select
using (
  exists (
    select 1 from growthreceipt.campaigns campaign
    where campaign.id = campaign_id
      and growthreceipt.is_workspace_member(campaign.workspace_id)
  )
);
