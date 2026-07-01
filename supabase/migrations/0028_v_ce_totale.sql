-- 0028 — Native CE Totale (computed, not the stale copy) + B2B "annullato" fix.
-- CE_AMIMI: exclude cancelled ('annullato') B2B movements, matching the Master (June B2B 492->220).
-- CE_TOTALE (v_ce_totale): computed live = online (Shopify) + offline (Qromo + GIFTS) + b2b (non-annullato)
--   + ALL expenses (unfiltered, not just amimi='si'), PLUS ce_totale_manual = the irreducibly-manual
--   non-Amimi block (all of January pre-Amimi + February's manual online adjustment; those are hand-typed
--   in the Master too, no transactions behind them). Everything else recomputes from app data.
-- NOTE (Master quirk faithfully reproduced): the Master's CE_TOTALE variable-logistica formula filters
--   sottocategoria by a numeric cell (A40=-207) instead of "Spedizioni", so its SUMIFS is a no-op and the
--   Totale variable-logistica is effectively 0 (Jan/Feb from the manual block). We match that: logistica_var
--   here is manual-only. (The Amimi CE keeps its own, correct, amimi-filtered logistica.)
-- Reconciliation vs the 2026-07-01 Master: Jan/Feb/Mar exact to the cent; Apr/May within ~1% (online
--   Shopify edge-cases, accepted); current month is live.

-- ---- 1) v_ce_amimi: B2B annullato fix (only the b2 CTE changes vs 0026) ----
CREATE OR REPLACE VIEW v_ce_amimi AS
WITH periods AS (
  SELECT DISTINCT u.year, u.month FROM (
    SELECT year, month FROM shopify_orders WHERE year IS NOT NULL
    UNION ALL SELECT year, month FROM qromo_sales   WHERE year IS NOT NULL
    UNION ALL SELECT year, month FROM b2b_movements WHERE year IS NOT NULL
    UNION ALL SELECT year, month FROM expenses      WHERE year IS NOT NULL
    UNION ALL SELECT year, month FROM returns       WHERE year IS NOT NULL
  ) u WHERE u.month >= 1 AND u.month <= 12
),
so AS (SELECT year, month, count(*) AS ordini, COALESCE(sum(discount_total),0) AS disc, COALESCE(sum(free_shipping_amt),0) AS freeship, COALESCE(sum(shipping_total),0) AS sped, COALESCE(sum(payment_fees),0) AS commissioni, COALESCE(sum(refund_amount),0) AS refund FROM shopify_orders GROUP BY year, month),
sl AS (SELECT year, month, COALESCE(sum(quantita),0) AS pezzi, COALESCE(sum(price*quantita),0) AS vendite, COALESCE(sum(cogs_snapshot),0) AS cogs FROM shopify_line_items GROUP BY year, month),
qr AS (SELECT year, month, COALESCE(sum(quantita),0) AS pezzi, COALESCE(sum(prezzo),0) AS lordo, COALESCE(sum(cogs),0) AS cogs FROM qromo_sales GROUP BY year, month),
b2 AS (SELECT year, month,
  COALESCE(sum(quantita)      FILTER (WHERE tipo_movimento='venduto' AND (stato IS NULL OR stato<>'annullato')),0) AS pezzi,
  COALESCE(sum(incasso_amimi) FILTER (WHERE tipo_movimento='venduto' AND (stato IS NULL OR stato<>'annullato')),0) AS lordo,
  COALESCE(sum(cogs)          FILTER (WHERE tipo_movimento='venduto' AND (stato IS NULL OR stato<>'annullato')),0) AS cogs
  FROM b2b_movements GROUP BY year, month),
ex AS (SELECT year, month,
  COALESCE(sum(costo) FILTER (WHERE categoria='SALARI'),0) AS salari,
  COALESCE(sum(costo) FILTER (WHERE categoria='TASSE'),0) AS tasse,
  COALESCE(sum(costo) FILTER (WHERE categoria='OPEX'),0) AS opex,
  COALESCE(sum(costo) FILTER (WHERE categoria='EVENTI'),0) AS eventi,
  COALESCE(sum(costo) FILTER (WHERE categoria='MARKETING'),0) AS marketing,
  COALESCE(sum(costo) FILTER (WHERE categoria='LOGISTICA' AND sottocategoria ILIKE 'sped%'),0) AS logistica_var,
  COALESCE(sum(costo) FILTER (WHERE categoria='LOGISTICA' AND (sottocategoria IS NULL OR sottocategoria NOT ILIKE 'sped%')),0) AS logistica_mag
  FROM expenses WHERE amimi GROUP BY year, month),
qret AS (SELECT year, month, COALESCE(sum(importo_rimborsato),0) AS imp FROM returns WHERE canale='qromo' GROUP BY year, month)
SELECT p.year, p.month,
  COALESCE(sl.vendite,0)-COALESCE(so.disc,0)+COALESCE(so.freeship,0)+COALESCE(so.sped,0) AS online_lordo,
  (COALESCE(sl.vendite,0)-COALESCE(so.disc,0)+COALESCE(so.freeship,0)+COALESCE(so.sped,0))/1.22 AS online_netto,
  COALESCE(sl.pezzi,0) AS online_pezzi,
  COALESCE(qr.lordo,0) AS offline_lordo, COALESCE(qr.lordo,0)/1.22 AS offline_netto, COALESCE(qr.pezzi,0) AS offline_pezzi,
  COALESCE(b2.lordo,0) AS b2b_lordo, COALESCE(b2.lordo,0)/1.22 AS b2b_netto, COALESCE(b2.pezzi,0) AS b2b_pezzi,
  (COALESCE(sl.vendite,0)-COALESCE(so.disc,0)+COALESCE(so.freeship,0)+COALESCE(so.sped,0))/1.22 + COALESCE(qr.lordo,0)/1.22 + COALESCE(b2.lordo,0)/1.22 AS omni_netto,
  -(COALESCE(sl.cogs,0)+COALESCE(qr.cogs,0)+COALESCE(b2.cogs,0)) AS cogs,
  -(3.71*(COALESCE(sl.pezzi,0)+COALESCE(qr.pezzi,0))+COALESCE(so.ordini,0)::numeric) AS packaging,
  COALESCE(so.commissioni,0) AS commissioni, COALESCE(ex.logistica_var,0) AS logistica_var,
  -(COALESCE(so.refund,0)+COALESCE(qret.imp,0)) AS resi,
  COALESCE(ex.salari,0) AS salari, COALESCE(ex.tasse,0) AS tasse, COALESCE(ex.logistica_mag,0) AS logistica_mag,
  COALESCE(ex.opex,0) AS opex, COALESCE(ex.eventi,0) AS eventi, COALESCE(ex.marketing,0) AS marketing
FROM periods p
  LEFT JOIN so ON so.year=p.year AND so.month=p.month
  LEFT JOIN sl ON sl.year=p.year AND sl.month=p.month
  LEFT JOIN qr ON qr.year=p.year AND qr.month=p.month
  LEFT JOIN b2 ON b2.year=p.year AND b2.month=p.month
  LEFT JOIN ex ON ex.year=p.year AND ex.month=p.month
  LEFT JOIN qret ON qret.year=p.year AND qret.month=p.month;

-- ---- 2) manual non-Amimi block (Jan pre-Amimi + Feb col-A), loaded empirically (Master - computed) ----
CREATE TABLE IF NOT EXISTS ce_totale_manual (
  year int NOT NULL, month int NOT NULL,
  online_netto numeric DEFAULT 0, offline_netto numeric DEFAULT 0, b2b_netto numeric DEFAULT 0,
  cogs numeric DEFAULT 0, packaging numeric DEFAULT 0, commissioni numeric DEFAULT 0, logistica_var numeric DEFAULT 0, resi numeric DEFAULT 0,
  salari numeric DEFAULT 0, tasse numeric DEFAULT 0, logistica_mag numeric DEFAULT 0, opex numeric DEFAULT 0, eventi numeric DEFAULT 0, marketing numeric DEFAULT 0,
  note text, PRIMARY KEY (year, month)
);
INSERT INTO ce_totale_manual (year,month,online_netto,offline_netto,cogs,packaging,commissioni,logistica_var,resi,note) VALUES
(2026,1, 4018.00, 0.49, -1600.00, -228.34, -212.00, -1172.00, -209.00, 'gennaio pre-Amimi (hardcoded nel Master), non calcolabile'),
(2026,2, 1205.74, 0,    -611.00,  -153.37, -70.99,  -207.00,  -220.00, 'febbraio: blocco non-Amimi (colonna A del Master)')
ON CONFLICT (year,month) DO UPDATE SET
  online_netto=EXCLUDED.online_netto, offline_netto=EXCLUDED.offline_netto, cogs=EXCLUDED.cogs, packaging=EXCLUDED.packaging,
  commissioni=EXCLUDED.commissioni, logistica_var=EXCLUDED.logistica_var, resi=EXCLUDED.resi, note=EXCLUDED.note;

-- ---- 3) v_ce_totale = computed (all channels + gifts + all expenses) + manual block ----
CREATE OR REPLACE VIEW v_ce_totale AS
SELECT f.*,
  f.omni_netto + f.cogs + f.packaging + f.commissioni + f.logistica_var + f.resi AS mc1,
  f.omni_netto + f.cogs + f.packaging + f.commissioni + f.logistica_var + f.resi
    + f.salari + f.tasse + f.logistica_mag + f.opex + f.eventi + f.marketing AS mc2
FROM (
  WITH periods AS (
    SELECT DISTINCT u.year, u.month FROM (
      SELECT year, month FROM shopify_orders WHERE year IS NOT NULL
      UNION ALL SELECT year, month FROM qromo_sales   WHERE year IS NOT NULL
      UNION ALL SELECT year, month FROM gifts_offline WHERE year IS NOT NULL
      UNION ALL SELECT year, month FROM b2b_movements WHERE year IS NOT NULL
      UNION ALL SELECT year, month FROM expenses      WHERE year IS NOT NULL
      UNION ALL SELECT year, month FROM ce_totale_manual WHERE year IS NOT NULL
    ) u WHERE u.month >= 1 AND u.month <= 12
  ),
  so AS (SELECT year, month, count(*) AS ordini, COALESCE(sum(discount_total),0) AS disc, COALESCE(sum(free_shipping_amt),0) AS freeship, COALESCE(sum(shipping_total),0) AS sped, COALESCE(sum(payment_fees),0) AS commissioni, COALESCE(sum(refund_amount),0) AS refund FROM shopify_orders GROUP BY year, month),
  sl AS (SELECT year, month, COALESCE(sum(quantita),0) AS pezzi, COALESCE(sum(price*quantita),0) AS vendite, COALESCE(sum(cogs_snapshot),0) AS cogs FROM shopify_line_items GROUP BY year, month),
  qr AS (SELECT year, month, COALESCE(sum(quantita),0) AS pezzi, COALESCE(sum(prezzo),0) AS lordo, COALESCE(sum(cogs),0) AS cogs FROM qromo_sales GROUP BY year, month),
  gf AS (SELECT year, month, COALESCE(sum(quantita),0) AS pezzi, COALESCE(sum(prezzo),0) AS lordo, COALESCE(sum(cogs),0) AS cogs FROM gifts_offline GROUP BY year, month),
  b2 AS (SELECT year, month,
    COALESCE(sum(quantita)      FILTER (WHERE tipo_movimento='venduto' AND (stato IS NULL OR stato<>'annullato')),0) AS pezzi,
    COALESCE(sum(incasso_amimi) FILTER (WHERE tipo_movimento='venduto' AND (stato IS NULL OR stato<>'annullato')),0) AS lordo,
    COALESCE(sum(cogs)          FILTER (WHERE tipo_movimento='venduto' AND (stato IS NULL OR stato<>'annullato')),0) AS cogs
    FROM b2b_movements GROUP BY year, month),
  ex AS (SELECT year, month,
    COALESCE(sum(costo) FILTER (WHERE categoria='SALARI'),0) AS salari,
    COALESCE(sum(costo) FILTER (WHERE categoria='TASSE'),0) AS tasse,
    COALESCE(sum(costo) FILTER (WHERE categoria='OPEX'),0) AS opex,
    COALESCE(sum(costo) FILTER (WHERE categoria='EVENTI'),0) AS eventi,
    COALESCE(sum(costo) FILTER (WHERE categoria='MARKETING'),0) AS marketing,
    COALESCE(sum(costo) FILTER (WHERE categoria='LOGISTICA' AND (sottocategoria IS NULL OR sottocategoria NOT ILIKE 'sped%')),0) AS logistica_mag
    FROM expenses GROUP BY year, month)
  SELECT p.year, p.month,
    COALESCE(sl.vendite,0)-COALESCE(so.disc,0)+COALESCE(so.freeship,0)+COALESCE(so.sped,0) AS online_lordo,
    (COALESCE(sl.vendite,0)-COALESCE(so.disc,0)+COALESCE(so.freeship,0)+COALESCE(so.sped,0))/1.22 + COALESCE(m.online_netto,0) AS online_netto,
    COALESCE(sl.pezzi,0) AS online_pezzi,
    COALESCE(qr.lordo,0)+COALESCE(gf.lordo,0) AS offline_lordo,
    (COALESCE(qr.lordo,0)+COALESCE(gf.lordo,0))/1.22 + COALESCE(m.offline_netto,0) AS offline_netto,
    COALESCE(qr.pezzi,0)+COALESCE(gf.pezzi,0) AS offline_pezzi,
    COALESCE(b2.lordo,0) AS b2b_lordo, COALESCE(b2.lordo,0)/1.22 + COALESCE(m.b2b_netto,0) AS b2b_netto, COALESCE(b2.pezzi,0) AS b2b_pezzi,
    (COALESCE(sl.vendite,0)-COALESCE(so.disc,0)+COALESCE(so.freeship,0)+COALESCE(so.sped,0))/1.22
      + (COALESCE(qr.lordo,0)+COALESCE(gf.lordo,0))/1.22 + COALESCE(b2.lordo,0)/1.22
      + COALESCE(m.online_netto,0)+COALESCE(m.offline_netto,0)+COALESCE(m.b2b_netto,0) AS omni_netto,
    -(COALESCE(sl.cogs,0)+COALESCE(qr.cogs,0)+COALESCE(gf.cogs,0)+COALESCE(b2.cogs,0)) + COALESCE(m.cogs,0) AS cogs,
    -(3.71*(COALESCE(sl.pezzi,0)+COALESCE(qr.pezzi,0)+COALESCE(gf.pezzi,0))+COALESCE(so.ordini,0)::numeric) + COALESCE(m.packaging,0) AS packaging,
    COALESCE(so.commissioni,0) + COALESCE(m.commissioni,0) AS commissioni,
    COALESCE(m.logistica_var,0) AS logistica_var,  -- manual-only (Master's SUMIFS is a no-op)
    -(COALESCE(so.refund,0)) + COALESCE(m.resi,0) AS resi,
    COALESCE(ex.salari,0)+COALESCE(m.salari,0) AS salari, COALESCE(ex.tasse,0)+COALESCE(m.tasse,0) AS tasse,
    COALESCE(ex.logistica_mag,0)+COALESCE(m.logistica_mag,0) AS logistica_mag, COALESCE(ex.opex,0)+COALESCE(m.opex,0) AS opex,
    COALESCE(ex.eventi,0)+COALESCE(m.eventi,0) AS eventi, COALESCE(ex.marketing,0)+COALESCE(m.marketing,0) AS marketing
  FROM periods p
    LEFT JOIN so ON so.year=p.year AND so.month=p.month
    LEFT JOIN sl ON sl.year=p.year AND sl.month=p.month
    LEFT JOIN qr ON qr.year=p.year AND qr.month=p.month
    LEFT JOIN gf ON gf.year=p.year AND gf.month=p.month
    LEFT JOIN b2 ON b2.year=p.year AND b2.month=p.month
    LEFT JOIN ex ON ex.year=p.year AND ex.month=p.month
    LEFT JOIN ce_totale_manual m ON m.year=p.year AND m.month=p.month
) f;
