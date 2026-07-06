-- 0039 — cleanup dati post-call cofounder 2026-07-06 (conferma esplicita owner in sessione).
-- (a) record di TEST creati in call alle 13:30 (ordini + arrivi + stub prodotto orfani)
-- (b) porta carte: arrivi fantasma azzerati ("non ne e' arrivato nessuno") + acquisto test
-- (c) merge Annie Bag Paillettes TURCHESE -> LIGHT_BLUE (stesso prodotto fisico, light blue e' il nome giusto)
-- (d) regalo Sveva reinserito con prezzo 70 (era stato salvato senza prezzo per errore)
-- Nota mesi chiusi: gli update (c) su qromo_sales toccano righe di marzo/maggio ma NON cambiano
-- prezzo/cogs/quantita: il CE resta identico al centesimo (ce-guard drift atteso = 0). OK owner.

-- ---------- (a) ordini di test 13:30 del 2026-07-06 ----------
with del_o as (
  delete from supplier_orders
  where id in ('f710ec98-1f62-4a0f-b13c-c0fa81e55cf6',  -- Lea_Bag_Maxi_COCCO_BLACK 5 @22 (doppio submit 1/2)
               '44240c94-dea1-48d0-8751-cb7d0e474afd',  -- Lea_Bag_Maxi_COCCO_BLACK 5 @20 (doppio submit 2/2)
               '663219fd-57cd-442b-98b3-b0d7fa9c7d33',  -- Lea_Bag_maxi_ROSSA 20 @22 ("messo a caso")
               '8d48fc72-f67e-494d-9899-940df35a8a4c')  -- Lea_bag_ROSSA 5 @15
  returning id, codice, qty_ordered, qty_arrived, fornitore
)
insert into change_log (tbl, row_id, op, after, chi, source)
select 'supplier_orders', id::text, 'test_cleanup_delete', to_jsonb(del_o), 'Claude-Code', 'migration-0039' from del_o;

with del_p as (
  delete from purchases
  where id in ('5699370a-6827-43eb-bc56-64fc58bc905c',  -- Lea_bag_ROSSA +2 (arrivo test)
               '31f47d50-8cdd-4ad0-859e-0838249e6df2',  -- Lea_bag_ROSSA +3 (arrivo test)
               '9ed5c392-98ef-4a65-af56-ca69a5dd1e58')  -- Lea_Bag_maxi_ROSSA +2 (arrivo test)
  returning id, codice, quantita, fornitore
)
insert into change_log (tbl, row_id, op, after, chi, source)
select 'purchases', id::text, 'test_cleanup_delete', to_jsonb(del_p), 'Claude-Code', 'migration-0039' from del_p;

-- stub prodotto orfani creati dagli ordini test (nessun altro riferimento dopo i delete sopra)
with del_s as (
  delete from products
  where codice in ('Lea_Bag_maxi_ROSSA', 'Lea_bag_ROSSA')
    and status = 'bozza' and source = 'app-ordine'
  returning id, codice
)
insert into change_log (tbl, row_id, op, after, chi, source)
select 'products', id::text, 'test_cleanup_delete', to_jsonb(del_s), 'Claude-Code', 'migration-0039' from del_s;

-- ---------- (b) porta carte: nessuno e' mai arrivato ----------
with upd_pc as (
  update supplier_orders
  set qty_arrived = 0
  where id in ('eb1f906b-61e1-4226-9fe1-21f09cebdffa',  -- Porta_carte_COCCO_PURPLE era 6/10
               '1d88f704-dd90-4bf9-a7b6-bdd900e290ae')  -- Porta_carte_COCCO_ORANGE era 10/10
  returning id, codice, qty_ordered
)
insert into change_log (tbl, row_id, op, after, chi, source)
select 'supplier_orders', id::text, 'portacarte_azzera_arrivi', to_jsonb(upd_pc), 'Claude-Code', 'migration-0039' from upd_pc;

with del_pc as (
  delete from purchases
  where id = 'c7f472d3-c311-4fd8-9e67-74e2391d2cbd'  -- Porta_carte_COCCO_ORANGE +3 (test di oggi)
  returning id, codice, quantita
)
insert into change_log (tbl, row_id, op, after, chi, source)
select 'purchases', id::text, 'portacarte_test_delete', to_jsonb(del_pc), 'Claude-Code', 'migration-0039' from del_pc;

-- ---------- (c) merge Annie TURCHESE -> LIGHT_BLUE ----------
-- 5 vendite Qromo ripuntate (prezzo/cogs invariati -> CE identico)
with upd_q as (
  update qromo_sales
  set codice = 'Annie_Bag_PAILLETTES_LIGHT_BLUE',
      item = 'Annie Bag', variant = 'PAILLETTES LIGHT BLUE'
  where codice_norm = 'ANNIE_BAG_PAILLETTES_TURQUOISE'
  returning id, data, quantita, prezzo
)
insert into change_log (tbl, row_id, op, after, chi, source)
select 'qromo_sales', id::text, 'merge_turchese_lightblue', to_jsonb(upd_q), 'Claude-Code', 'migration-0039' from upd_q;

-- la rettifica +5 della pulizia pre-cutover segue le vendite (saldo giacenza invariato)
with upd_a as (
  update stock_adjustments
  set codice = 'Annie_Bag_PAILLETTES_LIGHT_BLUE'
  where codice_norm = 'ANNIE_BAG_PAILLETTES_TURQUOISE'
  returning id, qty_delta, motivo
)
insert into change_log (tbl, row_id, op, after, chi, source)
select 'stock_adjustments', id::text, 'merge_turchese_lightblue', to_jsonb(upd_a), 'Claude-Code', 'migration-0039' from upd_a;

-- gli alias del nome turchese risolvono d'ora in poi al codice giusto
update product_aliases
set codice = 'Annie_Bag_PAILLETTES_LIGHT_BLUE'
where codice = 'Annie_Bag_Paillettes_Turquoise';

-- righe stock Shopify stale dei codici turchese (il prodotto TURCHESE viene archiviato sul sito)
delete from shopify_stock where upper(codice) in ('ANNIE_BAG_PAILLETTES_TURQUOISE', 'ANNIE_BAG_TURQUOISE');

with del_t as (
  delete from products where codice = 'Annie_Bag_Paillettes_Turquoise'
  returning id, codice
)
insert into change_log (tbl, row_id, op, after, chi, source)
select 'products', id::text, 'merge_turchese_lightblue_delete', to_jsonb(del_t), 'Claude-Code', 'migration-0039' from del_t;

-- ---------- (d) regalo Sveva: reinserito con prezzo 70 (venduta in black, decisione call) ----------
insert into gifts_offline (data, year, month, codice, item, variant, quantita, prezzo, payment_method, kind, nome, cognome, nota, cogs, source, chi)
select data, year, month, codice, item, variant, quantita, 70, payment_method, kind, nome, cognome,
       coalesce(nota || ' · ', '') || 'reinserito con prezzo 70 (era salvato senza prezzo, call 06-07)', cogs, source, chi
from gifts_offline where id = '2e312050-adb4-4b89-bba0-c7da009c5958';

with del_g as (
  delete from gifts_offline where id = '2e312050-adb4-4b89-bba0-c7da009c5958'
  returning id, codice, nome
)
insert into change_log (tbl, row_id, op, after, chi, source)
select 'gifts_offline', id::text, 'gift_reinserito_con_prezzo', to_jsonb(del_g), 'Claude-Code', 'migration-0039' from del_g;
