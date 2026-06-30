-- 0026 — CE "Resi" line now also reflects Qromo returns registered in the app.
-- Before: resi = -(shopify_orders.refund_amount) only → a Qromo return (returns table)
-- moved stock but was invisible to the P&L. Shopify online refunds are already captured
-- via shopify_orders.refund_amount, so we add ONLY canale='qromo' returns here to avoid
-- double-counting the online ones.
-- NOTE (IVA): importo_rimborsato is gross (the cash refunded), matching how the existing
-- shopify refund_amount is treated. If the accountant wants resi net of IVA, both legs
-- should be divided by 1.22 in a follow-up.
CREATE OR REPLACE VIEW v_ce_amimi AS
WITH periods AS (
  SELECT DISTINCT u.year, u.month
  FROM (
    SELECT year, month FROM shopify_orders WHERE year IS NOT NULL
    UNION ALL SELECT year, month FROM qromo_sales   WHERE year IS NOT NULL
    UNION ALL SELECT year, month FROM b2b_movements WHERE year IS NOT NULL
    UNION ALL SELECT year, month FROM expenses      WHERE year IS NOT NULL
    UNION ALL SELECT year, month FROM returns       WHERE year IS NOT NULL
  ) u
  WHERE u.month >= 1 AND u.month <= 12
),
so AS (
  SELECT year, month, count(*) AS ordini,
    COALESCE(sum(discount_total), 0) AS disc,
    COALESCE(sum(free_shipping_amt), 0) AS freeship,
    COALESCE(sum(shipping_total), 0) AS sped,
    COALESCE(sum(payment_fees), 0) AS commissioni,
    COALESCE(sum(refund_amount), 0) AS refund
  FROM shopify_orders GROUP BY year, month
),
sl AS (
  SELECT year, month,
    COALESCE(sum(quantita), 0) AS pezzi,
    COALESCE(sum(price * quantita), 0) AS vendite,
    COALESCE(sum(cogs_snapshot), 0) AS cogs
  FROM shopify_line_items GROUP BY year, month
),
qr AS (
  SELECT year, month,
    COALESCE(sum(quantita), 0) AS pezzi,
    COALESCE(sum(prezzo), 0) AS lordo,
    COALESCE(sum(cogs), 0) AS cogs
  FROM qromo_sales GROUP BY year, month
),
b2 AS (
  SELECT year, month,
    COALESCE(sum(quantita)      FILTER (WHERE tipo_movimento = 'venduto'), 0) AS pezzi,
    COALESCE(sum(incasso_amimi) FILTER (WHERE tipo_movimento = 'venduto'), 0) AS lordo,
    COALESCE(sum(cogs)          FILTER (WHERE tipo_movimento = 'venduto'), 0) AS cogs
  FROM b2b_movements GROUP BY year, month
),
ex AS (
  SELECT year, month,
    COALESCE(sum(costo) FILTER (WHERE categoria = 'SALARI'), 0) AS salari,
    COALESCE(sum(costo) FILTER (WHERE categoria = 'TASSE'), 0) AS tasse,
    COALESCE(sum(costo) FILTER (WHERE categoria = 'OPEX'), 0) AS opex,
    COALESCE(sum(costo) FILTER (WHERE categoria = 'EVENTI'), 0) AS eventi,
    COALESCE(sum(costo) FILTER (WHERE categoria = 'MARKETING'), 0) AS marketing,
    COALESCE(sum(costo) FILTER (WHERE categoria = 'LOGISTICA' AND sottocategoria ILIKE 'sped%'), 0) AS logistica_var,
    COALESCE(sum(costo) FILTER (WHERE categoria = 'LOGISTICA' AND (sottocategoria IS NULL OR sottocategoria NOT ILIKE 'sped%')), 0) AS logistica_mag
  FROM expenses WHERE amimi GROUP BY year, month
),
qret AS (  -- NEW: Qromo returns registered in the app (POS refunds, not in shopify_orders)
  SELECT year, month, COALESCE(sum(importo_rimborsato), 0) AS imp
  FROM returns WHERE canale = 'qromo' GROUP BY year, month
)
SELECT p.year, p.month,
  COALESCE(sl.vendite, 0) - COALESCE(so.disc, 0) + COALESCE(so.freeship, 0) + COALESCE(so.sped, 0) AS online_lordo,
  (COALESCE(sl.vendite, 0) - COALESCE(so.disc, 0) + COALESCE(so.freeship, 0) + COALESCE(so.sped, 0)) / 1.22 AS online_netto,
  COALESCE(sl.pezzi, 0) AS online_pezzi,
  COALESCE(qr.lordo, 0) AS offline_lordo,
  COALESCE(qr.lordo, 0) / 1.22 AS offline_netto,
  COALESCE(qr.pezzi, 0) AS offline_pezzi,
  COALESCE(b2.lordo, 0) AS b2b_lordo,
  COALESCE(b2.lordo, 0) / 1.22 AS b2b_netto,
  COALESCE(b2.pezzi, 0) AS b2b_pezzi,
  (COALESCE(sl.vendite, 0) - COALESCE(so.disc, 0) + COALESCE(so.freeship, 0) + COALESCE(so.sped, 0)) / 1.22
    + COALESCE(qr.lordo, 0) / 1.22 + COALESCE(b2.lordo, 0) / 1.22 AS omni_netto,
  - (COALESCE(sl.cogs, 0) + COALESCE(qr.cogs, 0) + COALESCE(b2.cogs, 0)) AS cogs,
  - (3.71 * (COALESCE(sl.pezzi, 0) + COALESCE(qr.pezzi, 0)) + COALESCE(so.ordini, 0)::numeric) AS packaging,
  COALESCE(so.commissioni, 0) AS commissioni,
  COALESCE(ex.logistica_var, 0) AS logistica_var,
  - (COALESCE(so.refund, 0) + COALESCE(qret.imp, 0)) AS resi,   -- CHANGED: + Qromo app-returns
  COALESCE(ex.salari, 0) AS salari,
  COALESCE(ex.tasse, 0) AS tasse,
  COALESCE(ex.logistica_mag, 0) AS logistica_mag,
  COALESCE(ex.opex, 0) AS opex,
  COALESCE(ex.eventi, 0) AS eventi,
  COALESCE(ex.marketing, 0) AS marketing
FROM periods p
  LEFT JOIN so   ON so.year = p.year   AND so.month = p.month
  LEFT JOIN sl   ON sl.year = p.year   AND sl.month = p.month
  LEFT JOIN qr   ON qr.year = p.year   AND qr.month = p.month
  LEFT JOIN b2   ON b2.year = p.year   AND b2.month = p.month
  LEFT JOIN ex   ON ex.year = p.year   AND ex.month = p.month
  LEFT JOIN qret ON qret.year = p.year AND qret.month = p.month;
