-- RECUPERATA il 2026-08-01 dal DB di produzione (`supabase_migrations.schema_migrations.statements`).
-- Il file mancava dal repo. Contenuto identico a quello applicato in produzione il 2026-07-19.

-- 0052: rimozione doppione LEA_BAG_DARK_ZEBRA (owner OK brief 2026-07-14).
-- Equivale a product_delete{add_to_non_product:true}: il codice ha movimenti storici (qromo 11-04
-- aprile CHIUSO + stock_adjustment +1 01-07), quindi entra in non_product_codici cosi' i detector
-- (qromo_orphan) non si accendono e la vendita di aprile tiene il suo COGS snapshot (CE aprile invariato).
-- Il canonico LEA_BAG_ZEBRA_DARK NON viene toccato. Delete AUTO-GUARDATO: giacenza/conto 0, nessun
-- ordine fornitore aperto, nessuna riga shopify_stock -> se una guardia salta, tocca 0 righe.
-- Eseguito via migrazione (non via write-api product_delete) perche' write-api e' in iterazione
-- concorrente da un'altra sessione: l'azione product_delete e' committata (cfe93ce) e andra' live col
-- prossimo deploy di quella sessione; qui l'effetto e' identico e guardato.
with guard as (
  select p.id, p.codice, p.item, p.variant, p.categoria, p.cogs, p.source, p.verificato
  from products p
  where p.codice = 'LEA_BAG_DARK_ZEBRA'
    and coalesce((select giacenza_attuale from v_inventory v where v.codice = p.codice), 0) = 0
    and coalesce((select in_conto_vendita from v_inventory v where v.codice = p.codice), 0) = 0
    and not exists (select 1 from supplier_orders s where s.codice = p.codice)
    and not exists (select 1 from shopify_stock s where s.codice = p.codice)
),
del as (
  delete from products p using guard g where p.id = g.id
  returning p.id, p.codice, p.item, p.variant, p.categoria, p.cogs, p.source
),
np as (
  insert into non_product_codici (codice)
  select codice from del
  on conflict (codice) do nothing
  returning codice
)
insert into change_log (tbl, row_id, op, before, chi, source)
select 'products', id::text, 'product_delete',
  jsonb_build_object(
    'codice', codice, 'item', item, 'variant', variant, 'categoria', categoria, 'cogs', cogs, 'source', source,
    'non_product_added', true,
    'movimenti', jsonb_build_object(
      'qromo_sales', (select count(*) from qromo_sales where codice = del.codice),
      'stock_adjustments', (select count(*) from stock_adjustments where codice = del.codice)),
    'motivo', 'doppione seed ETL 01-07 (owner OK brief 14-07); canonico LEA_BAG_ZEBRA_DARK invariato; via migrazione (write-api in iterazione concorrente)'),
  'Claude Code', 'migration-0052'
from del;
