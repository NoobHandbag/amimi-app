-- Phase 6: hourly read-only Shopify order sync.
-- The shopify-sync Edge Function (supabase/functions/shopify-sync) pulls NEW orders, resolves
-- CODICE via product_aliases, and inserts ONLY orders newer than the seed (historical stays
-- cent-exact). The Shopify token lives in app_config.shopify_token (service-role only; NOT in git).
-- The cron body's URL (project ref) and PIN are redacted here; applied via MCP with real values.
create extension if not exists pg_cron;
create extension if not exists pg_net;
-- select cron.schedule('shopify-sync-hourly', '7 * * * *',
--   $$ select net.http_post(
--        url := 'https://<PROJECT_REF>.supabase.co/functions/v1/shopify-sync',
--        headers := '{"Content-Type":"application/json"}'::jsonb,
--        body := '{"pin":"<APP_PIN>"}'::jsonb
--      ) $$);
