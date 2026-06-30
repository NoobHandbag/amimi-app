-- 0027 — Counts become real stock rectifications (Approccio 1: adjustment ledger).
-- A physical count, when applied, writes a row here so the derived giacenza moves by
-- exactly (contati - giacenza_attuale). v_inventory gains a "+ aggiustamenti" term, so
-- after a count giacenza == contati. The counts table stays the audit log (who/when/delta);
-- each applied count links to its adjustment via count_id.
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codice      text NOT NULL,
  codice_norm text GENERATED ALWAYS AS (upper(regexp_replace(COALESCE(codice, ''::text), '\s+'::text, '_'::text, 'g'::text))) STORED,
  qty_delta   numeric NOT NULL,
  motivo      text DEFAULT 'conta',
  count_id    uuid,
  data        date DEFAULT (now() AT TIME ZONE 'Europe/Rome')::date,
  chi         text,
  source      text DEFAULT 'app',
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_codice_norm ON stock_adjustments (codice_norm);

CREATE OR REPLACE VIEW v_inventory AS
 WITH pur AS (
     SELECT codice_norm, sum(quantita) AS q FROM purchases GROUP BY codice_norm
   ), sho AS (
     SELECT codice_norm, sum(quantita) AS q FROM shopify_line_items GROUP BY codice_norm
   ), qro AS (
     SELECT codice_norm, sum(quantita) AS q FROM qromo_sales GROUP BY codice_norm
   ), gif AS (
     SELECT codice_norm, sum(quantita) AS q FROM gifts_offline GROUP BY codice_norm
   ), ret AS (
     SELECT codice_norm, sum(quantita) AS q FROM returns WHERE rientra_stock = true GROUP BY codice_norm
   ), adj AS (
     SELECT codice_norm, sum(qty_delta) AS q FROM stock_adjustments GROUP BY codice_norm
   ), b2v AS (
     SELECT codice_norm, sum(quantita) AS q FROM b2b_movements WHERE tipo_movimento = 'venduto'::text GROUP BY codice_norm
   ), b2cv AS (
     SELECT codice_norm, sum(
         CASE
             WHEN tipo_movimento = 'invio'::text THEN quantita
             WHEN tipo_movimento = ANY (ARRAY['reso'::text, 'venduto'::text]) THEN - quantita
             ELSE 0::numeric
         END) AS q
       FROM b2b_movements WHERE modello = 'conto_vendita'::text GROUP BY codice_norm
   ), last_sale AS (
     SELECT s.codice_norm, max(s.d) AS d
       FROM ( SELECT codice_norm, data::timestamptz AS d FROM qromo_sales WHERE data IS NOT NULL
            UNION ALL
              SELECT codice_norm, data::timestamptz FROM b2b_movements WHERE tipo_movimento = 'venduto'::text AND data IS NOT NULL
            UNION ALL
              SELECT li.codice_norm, o.created_at_shop FROM shopify_line_items li JOIN shopify_orders o ON o.order_id = li.order_id WHERE o.created_at_shop IS NOT NULL) s
      GROUP BY s.codice_norm
   ), shop AS (
     SELECT upper(regexp_replace(COALESCE(codice, ''::text), '\s+'::text, '_'::text, 'g'::text)) AS codice_norm, max(image_url) AS image_url
       FROM shopify_stock WHERE codice IS NOT NULL AND codice <> ''::text
      GROUP BY (upper(regexp_replace(COALESCE(codice, ''::text), '\s+'::text, '_'::text, 'g'::text)))
   )
 SELECT p.codice, p.codice_norm, p.item, p.variant, p.categoria, p.retail_price, p.cogs,
    COALESCE(p.image_url, shop.image_url) AS image_url, p.status,
    COALESCE(pur.q, 0::numeric) AS qty_purchased,
    COALESCE(sho.q, 0::numeric) AS shopify_sold,
    COALESCE(qro.q, 0::numeric) AS qromo_sold,
    COALESCE(gif.q, 0::numeric) AS gift_sold,
    COALESCE(b2v.q, 0::numeric) AS b2b_venduto,
    COALESCE(b2cv.q, 0::numeric) AS in_conto_vendita,
    COALESCE(pur.q, 0::numeric) - COALESCE(sho.q, 0::numeric) - COALESCE(qro.q, 0::numeric) - COALESCE(gif.q, 0::numeric) + COALESCE(ret.q, 0::numeric) + COALESCE(adj.q, 0::numeric) AS giacenza_attuale,
    COALESCE(pur.q, 0::numeric) - COALESCE(sho.q, 0::numeric) - COALESCE(qro.q, 0::numeric) - COALESCE(gif.q, 0::numeric) + COALESCE(ret.q, 0::numeric) + COALESCE(adj.q, 0::numeric) - COALESCE(b2v.q, 0::numeric) AS giacenza_totale_conb2b,
    COALESCE(pur.q, 0::numeric) - COALESCE(sho.q, 0::numeric) - COALESCE(qro.q, 0::numeric) - COALESCE(gif.q, 0::numeric) + COALESCE(ret.q, 0::numeric) + COALESCE(adj.q, 0::numeric) - COALESCE(b2v.q, 0::numeric) - COALESCE(b2cv.q, 0::numeric) AS disponibili_da_vendere,
    round((COALESCE(pur.q, 0::numeric) - COALESCE(sho.q, 0::numeric) - COALESCE(qro.q, 0::numeric) - COALESCE(gif.q, 0::numeric) + COALESCE(ret.q, 0::numeric) + COALESCE(adj.q, 0::numeric)) * COALESCE(p.retail_price, 0::numeric), 2) AS valore,
    ls.d AS last_sale,
    shop.codice_norm IS NOT NULL AS on_shopify,
    COALESCE(ret.q, 0::numeric) AS resi_rientrati,
    COALESCE(adj.q, 0::numeric) AS aggiustamenti
   FROM products p
     LEFT JOIN pur ON pur.codice_norm = p.codice_norm
     LEFT JOIN sho ON sho.codice_norm = p.codice_norm
     LEFT JOIN qro ON qro.codice_norm = p.codice_norm
     LEFT JOIN gif ON gif.codice_norm = p.codice_norm
     LEFT JOIN ret ON ret.codice_norm = p.codice_norm
     LEFT JOIN adj ON adj.codice_norm = p.codice_norm
     LEFT JOIN b2v ON b2v.codice_norm = p.codice_norm
     LEFT JOIN b2cv ON b2cv.codice_norm = p.codice_norm
     LEFT JOIN last_sale ls ON ls.codice_norm = p.codice_norm
     LEFT JOIN shop ON shop.codice_norm = p.codice_norm;
