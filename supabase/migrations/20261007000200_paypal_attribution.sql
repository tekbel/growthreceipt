create type growthreceipt.payment_order_status as enum (
  'created',
  'approved',
  'completed',
  'voided',
  'failed'
);

create table growthreceipt.offers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references growthreceipt.workspaces(id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table growthreceipt.payment_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references growthreceipt.workspaces(id) on delete cascade,
  offer_id uuid not null references growthreceipt.offers(id) on delete restrict,
  campaign_id uuid not null,
  content_id uuid not null,
  paypal_order_id text not null unique,
  paypal_capture_id text unique,
  idempotency_key uuid not null unique,
  status growthreceipt.payment_order_status not null default 'created',
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table growthreceipt.paypal_webhook_events (
  id text primary key,
  event_type text not null,
  resource jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create index payment_orders_workspace_campaign_idx
on growthreceipt.payment_orders (workspace_id, campaign_id, created_at desc);

alter table growthreceipt.offers enable row level security;
alter table growthreceipt.payment_orders enable row level security;
alter table growthreceipt.paypal_webhook_events enable row level security;

create policy "members can read offers"
on growthreceipt.offers for select
using (growthreceipt.is_workspace_member(workspace_id));

create policy "members can read payment orders"
on growthreceipt.payment_orders for select
using (growthreceipt.is_workspace_member(workspace_id));

-- Webhook events contain provider payloads and remain service-role only.
