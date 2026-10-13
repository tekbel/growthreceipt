-- Follow up posts, revisions and briefs from a product page also run as jobs, so a page that
-- reloads while the agent works can find the result.
alter table growthreceipt.agent_jobs drop constraint agent_jobs_kind_check;

alter table growthreceipt.agent_jobs add constraint agent_jobs_kind_check
  check (kind in ('campaign_draft', 'next_action', 'follow_up_post', 'revise_post', 'brief_from_url'));
