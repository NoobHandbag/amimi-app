-- 0045: per-person digest views feeding the "Salute & Movimenti" page (brief 2026-07-08).
-- Splits the last-14-days movements by the person responsible:
--   Ginevra  = orders (added / fulfilled / open / AOV)
--   Benedetta= catalog & ops (name cleanups / returns / confirmed expenses / products to complete)
--   Dan (=Ale)= system (change_log volume / released versions / health / CE reconciliations)
--
-- READ-ONLY + ADDITIVE. Same window convention as 0044 / the Cowork digest:
--   ultimi 14gg = current_date-13 .. current_date ; precedenti = current_date-27 .. current_date-14.
--
-- SAFE BY DESIGN:
--  - Every view reads only tables the app already exposes to anon (shopify_orders, shopify_line_items,
--    change_log, returns, expenses, v_products_todo, health_log). No app_flags / app_config, no secrets.
--  - The change_log drill views select ONLY the display columns (data, op, chi, tbl, row_id / joined
--    expense operazione+costo). They never expose the raw before/after JSON payloads.
--  - v_digest_versioni is the one SECURITY DEFINER view: it reads the reserved supabase_migrations
--    schema but exposes ONLY a count + the latest migration name (safe subset, same pattern as v_ops_flags).

-- ---------------------------------------------------------------------------
-- Single-row aggregate: every KPI headline number, one SELECT (pattern like v_movimenti_14gg).
-- gin_aov14 is the ONLINE average order value (online lordo / online orders): the existing
-- v_movimenti_14gg.aov_lordo14 divides TOTAL lordo (incl. offline) by online order count, which
-- overstates it — this column is the correct online-only figure.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_digest_persone AS
WITH ord AS (
  SELECT
    count(*) FILTER (WHERE created_at_shop::date BETWEEN current_date-13 AND current_date)    AS add14,
    count(*) FILTER (WHERE created_at_shop::date BETWEEN current_date-27 AND current_date-14) AS add28,
    count(*) FILTER (WHERE fulfilled_at::date   BETWEEN current_date-13 AND current_date)     AS ful14,
    count(*) FILTER (WHERE fulfilled_at::date   BETWEEN current_date-27 AND current_date-14)  AS ful28
  FROM shopify_orders
),
onl AS (
  SELECT COALESCE(sum(li.price*li.quantita) FILTER (WHERE o.created_at_shop::date BETWEEN current_date-13 AND current_date),0) AS on_lordo14
  FROM shopify_line_items li JOIN shopify_orders o USING (order_id)
),
cl AS (
  SELECT
    count(*) FILTER (WHERE ts::date BETWEEN current_date-13 AND current_date
                     AND op ~* '(uppercase|merge|maiuscol|finalize|clean|rename|norm)')         AS puliti14,
    count(*) FILTER (WHERE ts::date BETWEEN current_date-13 AND current_date
                     AND op IN ('expense_approve','expense_manual'))                            AS spese14,
    count(*)          FILTER (WHERE ts::date BETWEEN current_date-13 AND current_date)          AS log14,
    count(DISTINCT chi) FILTER (WHERE ts::date BETWEEN current_date-13 AND current_date)        AS attori14
  FROM change_log
),
ret AS (
  SELECT count(*) FILTER (WHERE data BETWEEN current_date-13 AND current_date) AS resi14 FROM returns
),
todo AS ( SELECT count(*)::int AS n FROM v_products_todo ),
hl AS (
  SELECT
    count(*) FILTER (WHERE severity='ok')                                                       AS ok,
    count(*) FILTER (WHERE severity='warn')                                                     AS warn,
    count(*) FILTER (WHERE severity IN ('bad','error'))                                         AS bad,
    count(*) FILTER (WHERE severity IN ('bad','error') AND (k ~ '^ce_' OR k='period_mismatch')) AS ce_bad
  FROM health_log WHERE day=(SELECT max(day) FROM health_log)
)
SELECT
  ord.add14 AS gin_ordini14, ord.add28 AS gin_ordini28,
  ord.ful14 AS gin_evasi14,  ord.ful28 AS gin_evasi28,
  round(onl.on_lordo14 / NULLIF(ord.add14,0), 2) AS gin_aov14,
  cl.puliti14 AS ben_puliti14, ret.resi14 AS ben_resi14, cl.spese14 AS ben_spese14, todo.n AS ben_todo,
  cl.log14 AS dan_log14, cl.attori14 AS dan_attori14,
  hl.ok AS dan_health_ok, hl.warn AS dan_health_warn, hl.bad AS dan_health_bad, hl.ce_bad AS dan_ce_bad
FROM ord, onl, cl, ret, todo, hl;

-- ---------------------------------------------------------------------------
-- Drill-downs (lists). Small, bounded to the 14-day window.
-- ---------------------------------------------------------------------------

-- Ginevra: orders added in the last 14 days (evaso = has a fulfilled_at timestamp).
CREATE OR REPLACE VIEW v_digest_ordini_14gg AS
SELECT
  o.order_number,
  o.customer_name,
  o.created_at_shop::date       AS data,
  (o.fulfilled_at IS NOT NULL)  AS evaso,
  o.gross_total
FROM shopify_orders o
WHERE o.created_at_shop::date BETWEEN current_date-13 AND current_date
ORDER BY o.created_at_shop DESC;

-- Benedetta: catalog-name cleanup operations (display columns only, no before/after payload).
CREATE OR REPLACE VIEW v_digest_pulizia_14gg AS
SELECT cl.ts::date AS data, cl.op, COALESCE(cl.chi,'—') AS chi, cl.tbl, cl.row_id
FROM change_log cl
WHERE cl.ts::date BETWEEN current_date-13 AND current_date
  AND cl.op ~* '(uppercase|merge|maiuscol|finalize|clean|rename|norm)'
ORDER BY cl.ts DESC;

-- Benedetta: confirmed expenses (human actions), enriched with the expense description + amount.
-- LEFT JOIN so an action whose row_id no longer resolves still shows (operazione/costo null).
CREATE OR REPLACE VIEW v_digest_spese_14gg AS
SELECT cl.ts::date AS data, cl.op, COALESCE(cl.chi,'—') AS chi, e.operazione, e.costo
FROM change_log cl
LEFT JOIN expenses e ON e.id::text = cl.row_id
WHERE cl.ts::date BETWEEN current_date-13 AND current_date
  AND cl.op IN ('expense_approve','expense_manual')
ORDER BY cl.ts DESC;

-- Dan: change_log volume per actor (last 14 days).
CREATE OR REPLACE VIEW v_digest_log_attori_14gg AS
SELECT COALESCE(chi,'—') AS chi, count(*)::int AS n
FROM change_log
WHERE ts::date BETWEEN current_date-13 AND current_date
GROUP BY 1
ORDER BY 2 DESC;

-- Dan: released DB versions — live migration count + latest name from the reserved schema.
-- SECURITY DEFINER (runs as owner) so anon can read this safe subset only. Same pattern as v_ops_flags.
CREATE OR REPLACE VIEW v_digest_versioni
WITH (security_invoker = false) AS
SELECT
  (SELECT count(*)     FROM supabase_migrations.schema_migrations) AS migr_n,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS migr_last;

-- The app is no-login and reads via anon; grant SELECT explicitly (being explicit is safer than
-- relying on default privileges for new objects).
GRANT SELECT ON
  v_digest_persone,
  v_digest_ordini_14gg,
  v_digest_pulizia_14gg,
  v_digest_spese_14gg,
  v_digest_log_attori_14gg,
  v_digest_versioni
TO anon, authenticated;
