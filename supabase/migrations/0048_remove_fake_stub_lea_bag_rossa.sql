-- 0048: rimozione stub finto LEA_BAG_ROSSA (conferma owner: "PRODOTTO FINTO - RIMUOVI").
-- stub app-ordine mai verificato, ordine gia' cancellato (orfano dal bug order_delete asimmetrico,
-- risolto nella write-api v17 con il reap dello stub), zero movimenti.
-- Delete AUTO-GUARDATO: se avesse un qualsiasi riferimento, tocca 0 righe.
with d as (
  delete from products p
  where p.codice = 'LEA_BAG_ROSSA'
    and p.verificato = false and p.source = 'app-ordine'
    and not exists (select 1 from supplier_orders s where s.codice = p.codice)
    and not exists (select 1 from purchases s where s.codice = p.codice)
    and not exists (select 1 from qromo_sales s where s.codice = p.codice or s.codice_norm = p.codice)
    and not exists (select 1 from shopify_line_items s where s.codice = p.codice)
    and not exists (select 1 from gifts_offline s where s.codice = p.codice)
    and not exists (select 1 from b2b_movements s where s.codice = p.codice)
    and not exists (select 1 from counts s where s.codice = p.codice)
    and not exists (select 1 from stock_adjustments s where s.codice = p.codice)
    and not exists (select 1 from returns s where s.codice = p.codice)
  returning id, codice, item, variant, source
)
insert into change_log (tbl, row_id, op, before, chi, source)
select 'products', id::text, 'product_delete',
       jsonb_build_object('codice', codice, 'item', item, 'variant', variant, 'source', source,
         'motivo', 'prodotto finto (conferma owner); stub orfano dal bug order_delete asimmetrico'),
       'Claude Code', 'migration-0048'
from d;
