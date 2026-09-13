-- ROLLBACK della migr 0117 (bonifica doppioni shopify_orders / shopify_line_items del 2026-09-13).
-- NON e' una migrazione e NON si applica da sola: SOLO su decisione dell'owner, a mano, e in quest'ordine:
--   1. cron :07 e :27 in pausa (come migr 0116: cron.alter_job active := false);
--   2. ri-deploy di shopify-sync v6 e ce-guard v4 dal commit precedente alla bonifica
--      (`git show 57b20e3:supabase/functions/shopify-sync/index.ts`, ce-guard dal commit prima di quello del 13-09),
--      perche' la v7 si appoggia al vincolo UNIQUE (upsert onConflict) e la v5 alla vista v_shopify_doppioni;
--   3. questo script, in una transazione.
-- Riporta le DUE tabelle esattamente allo stato delle 15:20 UTC del 13-09 (1.509 righe ordine / 1.713 righe,
-- DOPPIONI COMPRESI) per i soli ordini presenti nel backup; gli ordini entrati dopo la bonifica restano.
-- Perche' non basta "insert ... select * from _bak": il vincolo UNIQUE respinge i doppioni del backup e
-- shopify_line_items ha una colonna in piu' (shopify_line_id) rispetto al backup; codice_norm e' GENERATED e non si
-- scrive. Trovato dalla review avversariale del 13-09 (il commento originale diceva solo "ricaricare da quelle tabelle").
begin;

drop view if exists v_shopify_doppioni;
alter table shopify_orders drop constraint if exists shopify_orders_order_id_key;
drop index if exists shopify_line_items_shopify_line_id_uq;
alter table shopify_line_items drop column if exists shopify_line_id;

delete from shopify_line_items where order_id in (select order_id from _bak_shopify_orders_2026_09_13);
delete from shopify_orders where order_id in (select order_id from _bak_shopify_orders_2026_09_13);

insert into shopify_orders (id, order_id, order_number, created_at_shop, customer_name, email, financial_status, fulfillment_status,
  gross_total, net_total, discount_total, shipping_total, payment_fees, refund_amount, free_shipping, currency, year, month, raw,
  synced_at, vendor, free_shipping_amt, fulfilled_at, discount_codes)
select id, order_id, order_number, created_at_shop, customer_name, email, financial_status, fulfillment_status,
  gross_total, net_total, discount_total, shipping_total, payment_fees, refund_amount, free_shipping, currency, year, month, raw,
  synced_at, vendor, free_shipping_amt, fulfilled_at, discount_codes
from _bak_shopify_orders_2026_09_13;

insert into shopify_line_items (id, order_id, lineitem_name, codice, resolved, quantita, price, cogs_snapshot, year, month, created_at)
select id, order_id, lineitem_name, codice, resolved, quantita, price, cogs_snapshot, year, month, created_at
from _bak_shopify_line_items_2026_09_13;

create index if not exists shopify_orders_orderid_idx on shopify_orders (order_id);

insert into change_log (tbl, row_id, op, after, chi, source) values (
  'shopify_orders', 'dedup_2026_09_13', 'dedup_rollback',
  jsonb_build_object('ordini_righe', (select count(*) from shopify_orders), 'line_items', (select count(*) from shopify_line_items)),
  'owner', 'snippet_0117_rollback');

-- attesi, se nessun ordine nuovo e' entrato dopo la bonifica: 1509 / 1713
select (select count(*) from shopify_orders) as ordini_righe, (select count(*) from shopify_line_items) as line_items;

commit;
