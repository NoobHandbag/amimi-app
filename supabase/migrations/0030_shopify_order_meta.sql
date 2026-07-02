-- 0030: order-level metadata for the Operations dashboard (fulfillment times + discount codes).
-- Populated by shopify-sync for new orders; historical rows backfilled one-off (action backfill_meta).
alter table shopify_orders add column if not exists fulfilled_at timestamptz;
alter table shopify_orders add column if not exists discount_codes text;
