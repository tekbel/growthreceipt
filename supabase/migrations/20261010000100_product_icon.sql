alter table growthreceipt.campaigns
  add column product_icon_url text
  check (
    product_icon_url is null
    or (
      char_length(product_icon_url) <= 500
      and (product_icon_url like 'https://%' or product_icon_url ~ '^/[^/]')
    )
  );
