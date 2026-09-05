-- CE drilldown: viste read-only che restituiscono le RIGHE dietro ogni cella del CE.
-- Rispecchiano ESATTAMENTE i filtri di v_ce_amimi / v_ce_totale cosi' la somma delle righe
-- torna alla cella (verificato: diff 0,00 su mkt/opex/cogs/online_lordo/offline_lordo/commissioni,
-- Amimi e Totale). Additive, nessuna scrittura, nessuna nuova classe di dato esposta
-- (operazione spese e nomi cliente sono gia' letti in anon by-design, no-login).

-- 1) Spese -> voci di costo (sal, tasse, opex, ev, mkt, lvar[solo Amimi], lmag).
--    Il CE somma solo status='approved'; l'Amimi filtra anche amimi=true (lato client).
--    COGS e PACKAGING come CATEGORIA di spesa NON alimentano le omonime righe di CE
--    (COGS = venduto x costo; Packaging = formula), quindi qui ce_line resta null.
--    Nota: nel Totale la logistica_var arriva dal blocco manuale ce_totale_manual, non da
--    queste spese; lato client il drill 'lvar' e' abilitato solo per lo scope Amimi.
create or replace view public.v_ce_drill_expense as
select
  e.year, e.month, e.date_paid, e.operazione, e.categoria, e.sottocategoria,
  e.costo, e.amimi,
  case
    when e.categoria = 'SALARI'    then 'sal'
    when e.categoria = 'TASSE'     then 'tasse'
    when e.categoria = 'OPEX'      then 'opex'
    when e.categoria = 'EVENTI'    then 'ev'
    when e.categoria = 'MARKETING' then 'mkt'
    when e.categoria = 'LOGISTICA' and e.sottocategoria ilike 'sped%' then 'lvar'
    when e.categoria = 'LOGISTICA' then 'lmag'
    else null
  end as ce_line
from expenses e
where e.status = 'approved';

-- 2) COGS -> righe di venduto x costo, per canale. Amimi = online+offline+b2b; Totale aggiunge gift.
--    online: cogs_snapshot x qty (come sl.cogs). offline: qromo.cogs x qty. b2b/gift: cogs gia' totale riga.
create or replace view public.v_ce_drill_cogs as
select li.year, li.month, 'online'::text as canale, li.codice, p.item, p.variant,
       li.quantita::numeric as qty, -(li.cogs_snapshot * li.quantita) as costo, false as is_gift
  from shopify_line_items li
  left join products p on p.codice = li.codice
union all
select q.year, q.month, 'offline', q.codice, q.item, q.variant,
       q.quantita::numeric, -(q.cogs * q.quantita), false
  from qromo_sales q
union all
select b.year, b.month, 'b2b', b.codice, null, null,
       b.quantita::numeric, -(b.cogs), false
  from b2b_movements b
 where b.tipo_movimento = 'venduto' and (b.stato is null or b.stato <> 'annullato')
union all
select g.year, g.month, 'gift', g.codice, g.item, g.variant,
       g.quantita::numeric, -(g.cogs), true
  from gifts_offline g;

-- 3) Ricavi / commissioni / resi -> righe a livello ordine (online), scontrino (offline), gift, b2b.
--    online lordo per ordine = vendite riga - sconti + free shipping + spedizione (come il CE aggregato).
create or replace view public.v_ce_drill_sales as
select o.year, o.month, 'online'::text as canale,
       o.order_number as ref, o.customer_name as descr, o.created_at_shop::date as data,
       null::numeric as qty,
       (coalesce(liv.vendite,0) - coalesce(o.discount_total,0) + coalesce(o.free_shipping_amt,0) + coalesce(o.shipping_total,0)) as lordo,
       coalesce(o.payment_fees,0) as commissioni,
       coalesce(o.refund_amount,0) as refund,
       false as is_gift
  from shopify_orders o
  left join (select order_id, sum(price * quantita) as vendite from shopify_line_items group by order_id) liv
    on liv.order_id = o.order_id
union all
select q.year, q.month, 'offline', q.sale_id::text,
       nullif(trim(coalesce(q.nome,'') || ' ' || coalesce(q.cognome,'')), ''), q.data::date,
       q.quantita::numeric, q.prezzo, 0::numeric, 0::numeric, false
  from qromo_sales q
union all
select g.year, g.month, 'gift', g.gift_id::text,
       nullif(trim(coalesce(g.nome,'') || ' ' || coalesce(g.cognome,'')), ''), g.data::date,
       g.quantita::numeric, g.prezzo, 0::numeric, 0::numeric, true
  from gifts_offline g
union all
select b.year, b.month, 'b2b', b.mov_id::text, b.negozio, b.data::date,
       b.quantita::numeric, b.incasso_amimi, 0::numeric, 0::numeric, false
  from b2b_movements b
 where b.tipo_movimento = 'venduto' and (b.stato is null or b.stato <> 'annullato');

grant select on public.v_ce_drill_expense, public.v_ce_drill_cogs, public.v_ce_drill_sales to anon, authenticated;
