-- 0023_v_health — proactive data-quality checks surfaced in the app's Diagnostica panel.
-- Each row is a named check with a count and a severity. Requested after the (undetected) image bug.
CREATE OR REPLACE VIEW v_health AS
WITH checks AS (
  SELECT 'img_missing' AS k, 'Prodotti online senza immagine' AS label,
         (SELECT count(*) FROM v_inventory WHERE on_shopify AND image_url IS NULL) AS n
  UNION ALL SELECT 'stock_neg', 'Prodotti con giacenza negativa',
         (SELECT count(*) FROM v_inventory WHERE giacenza_attuale < 0)
  UNION ALL SELECT 'cogs_missing', 'Prodotti venduti senza COGS',
         (SELECT count(*) FROM v_inventory WHERE (COALESCE(shopify_sold,0) + COALESCE(qromo_sold,0) + COALESCE(b2b_venduto,0)) > 0 AND COALESCE(cogs,0) = 0)
  UNION ALL SELECT 'price_missing', 'Prodotti su Shopify senza prezzo',
         (SELECT count(*) FROM v_inventory WHERE on_shopify AND COALESCE(retail_price,0) = 0)
  UNION ALL SELECT 'orders_orphan', 'Righe ordine con codice non in anagrafica',
         (SELECT count(*) FROM supplier_orders so WHERE COALESCE(so.codice,'') <> ''
            AND NOT EXISTS (SELECT 1 FROM products p WHERE p.codice_norm = upper(regexp_replace(so.codice, '\s+', '_', 'g'))))
  UNION ALL SELECT 'todo_products', 'Prodotti da completare',
         (SELECT count(*) FROM v_products_todo)
  UNION ALL SELECT 'lost_sales', 'SKU pubblicati ma esauriti',
         (SELECT count(*) FROM v_sku_availability WHERE stato = 'pubblicato_esaurito')
)
SELECT k, label, n,
  CASE WHEN n = 0 THEN 'ok'
       WHEN k IN ('stock_neg', 'cogs_missing', 'price_missing', 'orders_orphan') THEN 'bad'
       ELSE 'warn' END AS severity
FROM checks;
