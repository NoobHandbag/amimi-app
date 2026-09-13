-- 0117: bonifica dei doppioni in shopify_orders / shopify_line_items + vincoli anti-doppione + vista per ce-guard.
--
-- INCIDENTE (12-09 02:07, 12-09 14:07, 13-09 02:07 UTC): la edge shopify-sync ha ricevuto un 504 da PostgREST sulla
-- select "tutti gli order_id esistenti" (nei minuti intorno PostgREST uccideva thread per timeout), NON ha controllato
-- l'errore e ha trattato i 250 ordini letti da Shopify come tutti nuovi. Dal 12-09 14:07 la tabella superava le 1.000
-- righe e la stessa select, senza range, tornava troncata al cap PostgREST: #1752 reinserito 7 volte (16:07 -> 23:07).
-- Nessun vincolo UNIQUE fermava gli insert.
--
-- FASE 1 (sola lettura, 13-09 15:00-15:20 UTC, Claude Code): 1.509 righe / 753 ordini distinti, 257 con copie, tutti in
-- mesi APERTI (ultimo chiuso 2026-06); line_items 1.713 righe di cui 884 copie; ZERO gruppi ripetuti fuori dagli ordini
-- con copie; nessuna FK verso le due tabelle; nessuna scrittura (sale_correct, returns, loyalty) sulle copie dal 11-09.
-- Fra le copie di uno stesso ordine differisce SOLO fulfilled_at (229 ordini: NULL all'ingest originale perche' non
-- ancora evaso, valorizzato nelle copie) e, per il solo #1728, gross_total/payment_fees: ordine MODIFICATO su Shopify
-- dopo l'ingest del 08-09 (1 riga, 120 EUR); oggi l'Admin API dice 2 righe e 240,00 EUR (verificato via MCP Shopify).
--
-- REGOLA: per ogni ordine resta la riga piu' vecchia (synced_at minimo), che riceve fulfilled_at e stato dalle copie;
-- per le righe resta il CLUSTER (minuto di created_at: ogni ingest scrive tutte le righe dell'ordine nello stesso
-- minuto) piu' vecchio, tranne #1728 che tiene il piu' recente (2 righe, come Shopify). #1734 NON e' un'eccezione: il
-- suo ingest del 09-09 non aveva scritto righe (insert fallito e ignorato dal codice), il cluster piu' vecchio e' quello
-- del 12-09 02:07 e resta quello.
--
-- TUTTO in una transazione con conteggi ATTESI: se un numero non torna, RAISE e nessuna scrittura. Se il runner non
-- avvolgesse il file in una transazione, le due _bak sotto resterebbero create dopo un RAISE: prima di rilanciare,
-- verificarle (sono copie delle tabelle intatte) e droppare a mano; nessun `drop if exists` qui, per non cancellare
-- un backup vero a una ri-esecuzione accidentale.
-- Backup integrale in _bak_shopify_orders_2026_09_13 / _bak_shopify_line_items_2026_09_13 (chiuse ad anon/authenticated:
-- contengono email clienti). ROLLBACK: `supabase/snippets/0117_rollback_shopify_dedup.sql` (a mano, solo su decisione
-- owner, con cron in pausa e v6 ri-deployata): un "insert select * from _bak" NON funziona, perche' il vincolo UNIQUE
-- respinge i doppioni e la tabella righe ha una colonna in piu'.

create table _bak_shopify_orders_2026_09_13 as select * from shopify_orders;
create table _bak_shopify_line_items_2026_09_13 as select * from shopify_line_items;
revoke all on _bak_shopify_orders_2026_09_13, _bak_shopify_line_items_2026_09_13 from anon, authenticated;

do $$
declare
  v_righe int; v_distinti int; v_li int; v_chiusi int; v_dup int; v_cluster_mismatch int; v_orfani_pre int;
  v_ful int; v_1728 int; v_del_o int; v_del_li int; v_gruppi int; v_senza_righe int; v_orfani int;
begin
  -- guardie di stato: la bonifica vale per lo stato misurato nella Fase 1, non per uno stato qualsiasi
  select count(*), count(distinct order_id) into v_righe, v_distinti from shopify_orders;
  select count(*) into v_li from shopify_line_items;
  select count(*) into v_dup from (select order_id from shopify_orders group by order_id having count(*) > 1) d;
  if v_righe <> 1509 or v_distinti <> 753 or v_dup <> 257 or v_li <> 1713 then
    raise exception 'stato inatteso: % righe / % distinti / % con copie / % line_items (attesi 1509 / 753 / 257 / 1713): rifare la Fase 1', v_righe, v_distinti, v_dup, v_li;
  end if;
  select count(*) into v_chiusi from shopify_orders o
   where o.order_id in (select order_id from shopify_orders group by order_id having count(*) > 1)
     and exists (select 1 from ce_snapshots s where s.year = o.year and s.month = o.month);
  if v_chiusi > 0 then raise exception 'copie in mesi CHIUSI: % righe, fermarsi (Regola Ferrea 11)', v_chiusi; end if;
  select count(*) into v_orfani_pre from shopify_line_items l where not exists (select 1 from shopify_orders o where o.order_id = l.order_id);
  if v_orfani_pre <> 0 then raise exception '% righe senza ordine gia'' prima della bonifica: fermarsi', v_orfani_pre; end if;

  create temp table dup_orders on commit drop as
    select order_id, count(*) as copie from shopify_orders group by order_id having count(*) > 1;
  create temp table keep_orders on commit drop as
    select distinct on (order_id) id, order_id from shopify_orders order by order_id, synced_at asc, id;
  create temp table latest_copy on commit drop as
    select distinct on (order_id) id, order_id, refund_amount, financial_status, fulfillment_status
      from shopify_orders where order_id in (select order_id from dup_orders) order by order_id, synced_at desc, id desc;
  create temp table ful_max on commit drop as
    select order_id, max(fulfilled_at) as fulfilled_at from shopify_orders where order_id in (select order_id from dup_orders) group by order_id;

  -- ogni ordine con copie deve avere UN cluster di righe per copia (tranne #1734: 3 cluster su 4 copie, vedi sopra)
  select count(*) into v_cluster_mismatch from dup_orders d
    join (select order_id, count(distinct date_trunc('minute', created_at)) as cl from shopify_line_items group by order_id) c using (order_id)
   where d.copie <> c.cl and not (d.order_id = '#1734' and c.cl = d.copie - 1);
  if v_cluster_mismatch > 0 then raise exception 'cluster righe non allineati alle copie su % ordini: fermarsi', v_cluster_mismatch; end if;

  -- 1. sulla riga che resta: fulfilled_at piu' fresco (229 attesi) e stato/rimborso dalla copia piu' recente (oggi identici)
  update shopify_orders k
     set fulfilled_at = coalesce(k.fulfilled_at, f.fulfilled_at),
         refund_amount = l.refund_amount, financial_status = l.financial_status, fulfillment_status = l.fulfillment_status
    from keep_orders ko
    join latest_copy l on l.order_id = ko.order_id
    join ful_max f on f.order_id = ko.order_id
   where k.id = ko.id
     and (k.fulfilled_at is distinct from coalesce(k.fulfilled_at, f.fulfilled_at)
          or k.refund_amount is distinct from l.refund_amount
          or k.financial_status is distinct from l.financial_status
          or k.fulfillment_status is distinct from l.fulfillment_status);
  get diagnostics v_ful = row_count;
  if v_ful <> 229 then raise exception 'righe aggiornate con i valori freschi: % (attese 229)', v_ful; end if;

  -- 2. #1728: l'unico ordine con importi diversi fra le copie. Importi come su Shopify oggi (Admin API, 13-09).
  update shopify_orders k set gross_total = 240.00, payment_fees = -5.53
    from keep_orders ko where k.id = ko.id and ko.order_id = '#1728' and k.gross_total = 120.00;
  get diagnostics v_1728 = row_count;
  if v_1728 <> 1 then raise exception '#1728: attesa 1 riga da correggere, trovate %', v_1728; end if;

  -- 3. copie ordine
  delete from shopify_orders o where not exists (select 1 from keep_orders k where k.id = o.id);
  get diagnostics v_del_o = row_count;
  if v_del_o <> 756 then raise exception 'copie ordine cancellate: % (attese 756)', v_del_o; end if;

  -- 4. copie righe: resta un cluster per ordine
  create temp table keep_cluster on commit drop as
    select order_id, case when order_id = '#1728' then max(cl) else min(cl) end as cl
      from (select order_id, date_trunc('minute', created_at) as cl from shopify_line_items
             where order_id in (select order_id from dup_orders) group by 1, 2) x
     group by order_id;
  delete from shopify_line_items l using keep_cluster k
   where l.order_id = k.order_id and date_trunc('minute', l.created_at) <> k.cl;
  get diagnostics v_del_li = row_count;
  if v_del_li <> 884 then raise exception 'copie righe cancellate: % (attese 884)', v_del_li; end if;

  -- 5. verifiche finali: niente righe oltre i distinti, niente gruppi ripetuti, ogni ordine dal 01-07 con righe,
  --    nessuna riga senza ordine, totali attesi
  select count(*) - count(distinct order_id) into v_righe from shopify_orders;
  if v_righe <> 0 then raise exception 'restano % righe ordine oltre i distinti', v_righe; end if;
  select count(*) into v_gruppi from (select order_id, lineitem_name, price, quantita from shopify_line_items group by 1, 2, 3, 4 having count(*) > 1) g;
  if v_gruppi <> 0 then raise exception 'restano % gruppi di righe ripetute', v_gruppi; end if;
  select count(*) into v_senza_righe from shopify_orders o
   where o.created_at_shop >= '2026-07-01' and not exists (select 1 from shopify_line_items l where l.order_id = o.order_id);
  if v_senza_righe <> 0 then raise exception '% ordini dal 01-07 senza righe', v_senza_righe; end if;
  select count(*) into v_orfani from shopify_line_items l where not exists (select 1 from shopify_orders o where o.order_id = l.order_id);
  if v_orfani <> 0 then raise exception '% righe senza ordine', v_orfani; end if;
  select count(*) into v_righe from shopify_orders;
  select count(*) into v_li from shopify_line_items;
  if v_righe <> 753 or v_li <> 829 then raise exception 'totali finali: % ordini / % righe (attesi 753 / 829)', v_righe, v_li; end if;

  insert into change_log (tbl, row_id, op, before, after, chi, source) values (
    'shopify_orders', 'dedup_2026_09_13', 'dedup',
    jsonb_build_object('ordini_righe', 1509, 'ordini_distinti', 753, 'ordini_con_copie', 257, 'line_items', 1713),
    jsonb_build_object('ordini_righe', v_righe, 'line_items', v_li, 'righe_ordine_cancellate', v_del_o, 'righe_li_cancellate', v_del_li,
      'fulfilled_at_riportati', v_ful,
      'eccezioni', '#1728: cluster recente (2 righe) + gross 240.00 / fees -5.53 come Admin API; #1734: ingest originale senza righe, resta il cluster del 12-09 02:07',
      'backup', '_bak_shopify_orders_2026_09_13, _bak_shopify_line_items_2026_09_13'),
    'claude-code', 'migration_0117');
end $$;

-- 6. VINCOLI: da qui un secondo insert dello stesso ordine FALLISCE (23505) invece di entrare. La edge v7 ci si
--    appoggia con upsert ignoreDuplicates. Per le righe: id della riga Shopify (line_item.id), unico dove presente;
--    riempito all'ingest dalla v7 e per lo storico dall'azione backfill_line_ids (dry_run di default).
alter table shopify_orders add constraint shopify_orders_order_id_key unique (order_id);
drop index if exists shopify_orders_orderid_idx;
alter table shopify_line_items add column shopify_line_id bigint;
comment on column shopify_line_items.shopify_line_id is 'id della riga d''ordine su Shopify (line_item.id). Scritto da shopify-sync v7 all''ingest e da backfill_line_ids per lo storico; NULL = riga pre-v7 non ancora abbinata.';
create unique index shopify_line_items_shopify_line_id_uq on shopify_line_items (shopify_line_id) where shopify_line_id is not null;

-- 7. Vista per il check ce_shopify_doppioni di ce-guard (v5): una riga, tutto a zero quando e' sano.
--    gruppi_righe_ripetute: stesse (ordine, nome, prezzo, quantita') NON distinte da shopify_line_id diversi.
create or replace view v_shopify_doppioni as
select
  (select count(*) - count(distinct order_id) from shopify_orders)::int as ordini_righe_extra,
  (select count(*) from (
      select order_id, lineitem_name, price, quantita from shopify_line_items
       group by 1, 2, 3, 4
      having count(*) > 1 and count(distinct shopify_line_id) < count(*)) g)::int as gruppi_righe_ripetute,
  (select count(*) from shopify_orders o
    where o.created_at_shop >= '2026-07-01'
      and not exists (select 1 from shopify_line_items l where l.order_id = o.order_id))::int as ordini_senza_righe;
grant select on v_shopify_doppioni to anon, authenticated;
