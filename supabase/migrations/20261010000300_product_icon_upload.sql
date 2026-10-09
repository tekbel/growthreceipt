alter table growthreceipt.campaigns drop constraint campaigns_product_icon_url_check;
alter table growthreceipt.campaigns
  add constraint campaigns_product_icon_url_check
  check (
    product_icon_url is null
    or (char_length(product_icon_url) <= 500
      and (product_icon_url like 'https://%' or product_icon_url ~ '^/[^/]'))
    or (char_length(product_icon_url) <= 200000
      and product_icon_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$')
  );
