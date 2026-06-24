alter table shopify_orders add column if not exists vendor text;
alter table shopify_orders add column if not exists free_shipping_amt numeric(12,2);
