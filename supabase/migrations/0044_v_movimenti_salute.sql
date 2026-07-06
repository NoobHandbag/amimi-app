-- 0044: read-only views feeding the in-app "Salute & Movimenti" page (brief 2026-07-06).
-- Centralises the exact window logic already validated in the Cowork task `digest-salute-movimenti`
-- so the app and the digest read the SAME numbers instead of duplicating the SQL.
--
-- SAFE BY DESIGN:
--  - v_movimenti_14gg is AGGREGATE-ONLY (counts + sums). No customer PII, no secrets. Reads business
--    tables that anon can already SELECT (post-0026). Plain view (invoker not forced): anon reads the view.
--  - v_ops_flags is a SECURITY-DEFINER view (runs as owner) that reads the locked app_flags table but
--    exposes ONLY the 4 non-secret operational flags, hard-coded as scalar subqueries. It never touches
--    gemini_api_key / mcp_token / qromo_webhook_secret / qromo_webhook_token. This is the intended way to
--    surface a safe subset of a table that 0026 locked away from anon.
--  - Both views are read-only; every write still goes through the service-role edge functions.

-- ---------------------------------------------------------------------------
-- Sales pulse (online Shopify + offline Qromo) + operational movements + catalog,
-- window = last 14 days vs the 14 days before. Mirrors digest Q1 + Q2 exactly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_movimenti_14gg AS
WITH off AS (
  SELECT
    COALESCE(sum(quantita) FILTER (WHERE data BETWEEN current_date-13 AND current_date),0)               AS u14,
    COALESCE(sum(prezzo*quantita) FILTER (WHERE data BETWEEN current_date-13 AND current_date),0)         AS g14,
    COALESCE(sum(quantita) FILTER (WHERE data BETWEEN current_date-27 AND current_date-14),0)             AS u28,
    COALESCE(sum(prezzo*quantita) FILTER (WHERE data BETWEEN current_date-27 AND current_date-14),0)      AS g28
  FROM qromo_sales
),
onl AS (
  SELECT
    COALESCE(sum(li.quantita) FILTER (WHERE o.created_at_shop::date BETWEEN current_date-13 AND current_date),0)            AS u14,
    COALESCE(sum(li.price*li.quantita) FILTER (WHERE o.created_at_shop::date BETWEEN current_date-13 AND current_date),0)   AS g14,
    COALESCE(sum(li.quantita) FILTER (WHERE o.created_at_shop::date BETWEEN current_date-27 AND current_date-14),0)         AS u28,
    COALESCE(sum(li.price*li.quantita) FILTER (WHERE o.created_at_shop::date BETWEEN current_date-27 AND current_date-14),0) AS g28
  FROM shopify_line_items li JOIN shopify_orders o USING (order_id)
),
ordc AS (
  SELECT
    count(*) FILTER (WHERE created_at_shop::date BETWEEN current_date-13 AND current_date)     AS o14,
    count(*) FILTER (WHERE created_at_shop::date BETWEEN current_date-27 AND current_date-14)  AS o28
  FROM shopify_orders
),
mov AS (
  SELECT
    (SELECT count(*) FILTER (WHERE COALESCE(data_ordine,created_at::date) BETWEEN current_date-13 AND current_date) FROM supplier_orders) AS sup_new14,
    (SELECT count(*) FILTER (WHERE data_ultimo_arrivo BETWEEN current_date-13 AND current_date) FROM supplier_orders)                     AS sup_arr14,
    (SELECT count(*) FILTER (WHERE COALESCE(qty_arrived,0) < COALESCE(qty_ordered,0)) FROM supplier_orders)                               AS sup_open,
    (SELECT count(*) FILTER (WHERE data BETWEEN current_date-13 AND current_date) FROM returns)                                           AS ret14,
    (SELECT count(*) FILTER (WHERE data BETWEEN current_date-27 AND current_date-14) FROM returns)                                        AS ret28
),
cat AS (
  SELECT
    (SELECT count(DISTINCT codice) FROM shopify_stock WHERE shopify_status='active')                                       AS live,
    (SELECT count(DISTINCT codice) FROM shopify_stock WHERE shopify_status='draft')                                        AS draft,
    (SELECT count(DISTINCT codice) FROM shopify_stock WHERE shopify_status='active' AND COALESCE(shopify_qty,0)=0)         AS soldout
)
SELECT
  -- split online/offline (raw), so the app can draw the channel breakdown
  off.u14 AS off_pezzi14, off.g14 AS off_lordo14, off.u28 AS off_pezzi28, off.g28 AS off_lordo28,
  onl.u14 AS on_pezzi14,  onl.g14 AS on_lordo14,  onl.u28 AS on_pezzi28,  onl.g28 AS on_lordo28,
  -- combined totals + net (IVA 22%), precomputed so both app and digest agree to the cent
  (off.u14 + onl.u14)                       AS pezzi14,
  (off.u28 + onl.u28)                       AS pezzi28,
  (off.g14 + onl.g14)                       AS lordo14,
  (off.g28 + onl.g28)                       AS lordo28,
  round((off.g14 + onl.g14) / 1.22, 2)      AS netto14,
  round((off.g28 + onl.g28) / 1.22, 2)      AS netto28,
  ordc.o14 AS ordini14, ordc.o28 AS ordini28,
  CASE WHEN ordc.o14 > 0 THEN round((off.g14 + onl.g14) / ordc.o14, 2) END AS aov_lordo14,
  mov.sup_new14, mov.sup_arr14, mov.sup_open, mov.ret14, mov.ret28,
  cat.live, cat.draft, cat.soldout
FROM off, onl, ordc, mov, cat;

-- ---------------------------------------------------------------------------
-- Non-secret operational flags only. SECURITY DEFINER so it can read the locked
-- app_flags table, but every column is a hard-coded non-secret key.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ops_flags
WITH (security_invoker = false) AS
SELECT
  (SELECT value FROM app_flags WHERE key='shopify_write_enabled')    AS shopify_write_enabled,
  (SELECT value FROM app_flags WHERE key='shopify_autopush_enabled') AS shopify_autopush_enabled,
  (SELECT value FROM app_flags WHERE key='shopify_hold_raises')      AS shopify_hold_raises,
  (SELECT value FROM app_flags WHERE key='shopify_expose_buffer')    AS shopify_expose_buffer;

-- The app is no-login and reads via anon; grant SELECT explicitly (0026 leaves SELECT default in place,
-- but being explicit is safer than relying on default privileges for new objects).
GRANT SELECT ON v_movimenti_14gg TO anon, authenticated;
GRANT SELECT ON v_ops_flags       TO anon, authenticated;
