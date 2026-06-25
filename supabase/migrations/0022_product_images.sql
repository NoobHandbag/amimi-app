-- 0022_product_images
-- #1 fix: product images were NULL everywhere (no source). Capture Shopify product images
-- into shopify_stock.image_url (populated by the shopify-stock sync), and surface them in
-- v_inventory via COALESCE(products.image_url, shopify image). Also keeps the 0021 on_shopify
-- = live shopify_stock fix. Output columns/types/order unchanged (dependent views safe).
ALTER TABLE shopify_stock ADD COLUMN IF NOT EXISTS image_url text;

CREATE OR REPLACE VIEW v_inventory AS
 WITH pur AS (
         SELECT purchases.codice_norm, sum(purchases.quantita) AS q
           FROM purchases GROUP BY purchases.codice_norm
        ), sho AS (
         SELECT shopify_line_items.codice_norm, sum(shopify_line_items.quantita) AS q
           FROM shopify_line_items GROUP BY shopify_line_items.codice_norm
        ), qro AS (
         SELECT qromo_sales.codice_norm, sum(qromo_sales.quantita) AS q
           FROM qromo_sales GROUP BY qromo_sales.codice_norm
        ), gif AS (
         SELECT gifts_offline.codice_norm, sum(gifts_offline.quantita) AS q
           FROM gifts_offline GROUP BY gifts_offline.codice_norm
        ), ret AS (
         SELECT returns.codice_norm, sum(returns.quantita) AS q
           FROM returns WHERE (returns.rientra_stock = true) GROUP BY returns.codice_norm
        ), b2v AS (
         SELECT b2b_movements.codice_norm, sum(b2b_movements.quantita) AS q
           FROM b2b_movements WHERE (b2b_movements.tipo_movimento = 'venduto'::text) GROUP BY b2b_movements.codice_norm
        ), b2cv AS (
         SELECT b2b_movements.codice_norm,
            sum(CASE
                WHEN (b2b_movements.tipo_movimento = 'invio'::text) THEN b2b_movements.quantita
                WHEN (b2b_movements.tipo_movimento = ANY (ARRAY['reso'::text, 'venduto'::text])) THEN (- b2b_movements.quantita)
                ELSE (0)::numeric END) AS q
           FROM b2b_movements WHERE (b2b_movements.modello = 'conto_vendita'::text) GROUP BY b2b_movements.codice_norm
        ), last_sale AS (
         SELECT s.codice_norm, max(s.d) AS d
           FROM ( SELECT qromo_sales.codice_norm, (qromo_sales.data)::timestamp with time zone AS d
                   FROM qromo_sales WHERE (qromo_sales.data IS NOT NULL)
                UNION ALL
                 SELECT b2b_movements.codice_norm, (b2b_movements.data)::timestamp with time zone AS data
                   FROM b2b_movements WHERE ((b2b_movements.tipo_movimento = 'venduto'::text) AND (b2b_movements.data IS NOT NULL))
                UNION ALL
                 SELECT li.codice_norm, o.created_at_shop
                   FROM (shopify_line_items li JOIN shopify_orders o ON ((o.order_id = li.order_id)))
                  WHERE (o.created_at_shop IS NOT NULL)) s
          GROUP BY s.codice_norm
        ), shop AS (
         SELECT upper(regexp_replace(COALESCE(shopify_stock.codice, ''::text), '\s+'::text, '_'::text, 'g'::text)) AS codice_norm,
                max(shopify_stock.image_url) AS image_url
           FROM shopify_stock
          WHERE (shopify_stock.codice IS NOT NULL AND shopify_stock.codice <> ''::text)
          GROUP BY 1
        )
 SELECT p.codice, p.codice_norm, p.item, p.variant, p.categoria, p.retail_price, p.cogs,
    COALESCE(p.image_url, shop.image_url) AS image_url, p.status,
    COALESCE(pur.q, (0)::numeric) AS qty_purchased,
    COALESCE(sho.q, (0)::numeric) AS shopify_sold,
    COALESCE(qro.q, (0)::numeric) AS qromo_sold,
    COALESCE(gif.q, (0)::numeric) AS gift_sold,
    COALESCE(b2v.q, (0)::numeric) AS b2b_venduto,
    COALESCE(b2cv.q, (0)::numeric) AS in_conto_vendita,
    ((((COALESCE(pur.q, (0)::numeric) - COALESCE(sho.q, (0)::numeric)) - COALESCE(qro.q, (0)::numeric)) - COALESCE(gif.q, (0)::numeric)) + COALESCE(ret.q, (0)::numeric)) AS giacenza_attuale,
    (((((COALESCE(pur.q, (0)::numeric) - COALESCE(sho.q, (0)::numeric)) - COALESCE(qro.q, (0)::numeric)) - COALESCE(gif.q, (0)::numeric)) + COALESCE(ret.q, (0)::numeric)) - COALESCE(b2v.q, (0)::numeric)) AS giacenza_totale_conb2b,
    ((((((COALESCE(pur.q, (0)::numeric) - COALESCE(sho.q, (0)::numeric)) - COALESCE(qro.q, (0)::numeric)) - COALESCE(gif.q, (0)::numeric)) + COALESCE(ret.q, (0)::numeric)) - COALESCE(b2v.q, (0)::numeric)) - COALESCE(b2cv.q, (0)::numeric)) AS disponibili_da_vendere,
    round((((((COALESCE(pur.q, (0)::numeric) - COALESCE(sho.q, (0)::numeric)) - COALESCE(qro.q, (0)::numeric)) - COALESCE(gif.q, (0)::numeric)) + COALESCE(ret.q, (0)::numeric)) * COALESCE(p.retail_price, (0)::numeric)), 2) AS valore,
    ls.d AS last_sale,
    (shop.codice_norm IS NOT NULL) AS on_shopify,
    COALESCE(ret.q, (0)::numeric) AS resi_rientrati
   FROM products p
     LEFT JOIN pur ON ((pur.codice_norm = p.codice_norm))
     LEFT JOIN sho ON ((sho.codice_norm = p.codice_norm))
     LEFT JOIN qro ON ((qro.codice_norm = p.codice_norm))
     LEFT JOIN gif ON ((gif.codice_norm = p.codice_norm))
     LEFT JOIN ret ON ((ret.codice_norm = p.codice_norm))
     LEFT JOIN b2v ON ((b2v.codice_norm = p.codice_norm))
     LEFT JOIN b2cv ON ((b2cv.codice_norm = p.codice_norm))
     LEFT JOIN last_sale ls ON ((ls.codice_norm = p.codice_norm))
     LEFT JOIN shop ON ((shop.codice_norm = p.codice_norm));
