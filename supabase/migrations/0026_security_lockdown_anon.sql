-- 0026: security lockdown of the public roles (anon / authenticated).
-- Closes the open hole where the anon key could READ secrets (app_flags) and WRITE/DELETE several tables
-- (app_flags, ce_totale_monthly, returns, shopify_catalog, shopify_stock, stock_adjustments, health_log).
--
-- SAFE BY DESIGN:
--  - The app is no-login on purpose: it READS business data via anon. SELECT is therefore preserved on the
--    business tables, including change_log (used by the recent-activity feed in api.ts).
--  - EVERY write goes through edge functions (write-api, shopify-sync, shopify-stock, qromo-webhook, ask-data,
--    mcp) that instantiate Supabase with SUPABASE_SERVICE_ROLE_KEY. service_role bypasses these grants, so
--    no server-side write is affected.
--  - Verified (grep) that the frontend never writes via anon and never reads app_flags/app_config.

-- 1) Secrets tables: no access at all for public roles.
revoke all on table app_flags  from anon, authenticated;
revoke all on table app_config from anon, authenticated;

-- 2) Remove write/delete from public roles on every existing table (SELECT is left untouched).
revoke insert, update, delete on all tables in schema public from anon, authenticated;

-- 3) Future tables: never writable by public roles by default.
alter default privileges in schema public revoke insert, update, delete on tables from anon, authenticated;
