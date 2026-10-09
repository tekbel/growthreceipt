alter table public.campaign_posts drop constraint campaign_posts_channel_check;
alter table public.campaign_posts
  add constraint campaign_posts_channel_check
  check (channel in ('LinkedIn', 'Facebook', 'X', 'Instagram'));
