alter table growthreceipt.campaign_posts drop constraint campaign_posts_channel_check;
alter table growthreceipt.campaign_posts
  add constraint campaign_posts_channel_check
  check (channel in ('LinkedIn', 'Facebook', 'X', 'Instagram'));
