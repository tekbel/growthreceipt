-- One row per PayPal refund of a captured order, keyed by PayPal's refund id. A refund made in
-- GrowthReceipt and the verified PAYMENT.CAPTURE.REFUNDED webhook about it land on the same row.
-- Only COMPLETED refunds are taken off revenue.
create table growthreceipt.payment_refunds (
  id text primary key,
  payment_order_id uuid not null references growthreceipt.payment_orders (id) on delete cascade,
  status text not null,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payment_refunds_order_idx on growthreceipt.payment_refunds (payment_order_id);

-- Only the API writes here. Clients get no access.
alter table growthreceipt.payment_refunds enable row level security;

-- A hash of the PayPal payer id, salted with the workspace id, so unique and repeat customers can
-- be counted without storing who the buyer is.
alter table growthreceipt.payment_orders add column payer_hash text;
