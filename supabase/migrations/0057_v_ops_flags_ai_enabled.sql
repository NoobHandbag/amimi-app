-- 0057 — expose ai_enabled through the anon-safe v_ops_flags view.
-- The Assistente AI panel (FLOW 6 v2) must know whether to show itself. ai_enabled lives in app_config,
-- which anon cannot read directly (REVOKE, migr 0026/0037). v_ops_flags is the SECURITY DEFINER safe-subset
-- view already used by the app for gated flags (Salute); we add ai_enabled to it (a non-secret boolean).
-- No secrets exposed: only the boolean feature flag, same pattern as the 4 shopify_* flags.
create or replace view public.v_ops_flags as
select
  (select value from app_flags where key = 'shopify_write_enabled')    as shopify_write_enabled,
  (select value from app_flags where key = 'shopify_autopush_enabled') as shopify_autopush_enabled,
  (select value from app_flags where key = 'shopify_hold_raises')      as shopify_hold_raises,
  (select value from app_flags where key = 'shopify_expose_buffer')    as shopify_expose_buffer,
  (select ai_enabled from app_config where id = 1)                     as ai_enabled;

grant select on public.v_ops_flags to anon, authenticated;
