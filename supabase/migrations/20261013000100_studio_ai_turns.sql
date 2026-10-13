-- The dashboard assistant records one row per model turn, under its own daily limit.
alter table growthreceipt.agent_runs drop constraint agent_runs_kind_check;
alter table growthreceipt.agent_runs
  add constraint agent_runs_kind_check
  check (kind in ('campaign_draft', 'next_action', 'studio_turn'));
