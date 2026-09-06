-- 0109: viste read-only nate dall'audit dashboard del 2026-09-06
-- (Cowork12/projects/Dashboard_Audit_2026-09/AUDIT_DASHBOARD_2026-09.md). Additive, nessuna scrittura.
--   v_fonti_freschezza     una riga: l'ultimo timestamp di ogni fonte (per la card "Freschezza delle fonti")
--   v_sconti_codici        ordini/netto/sconto/margine per codice sconto e mese (Cruscotto)
--   v_spedizioni_eccezioni tracking TWS classificato: consegnata / in_corso / eccezione (Salute, Ginevra)
--   v_evasione_mensile     ore da ordine a spedizione per mese (Salute, Ginevra)
-- shipping_status ha RLS e nessun grant anon: la vista e' di postgres e la espone in sola lettura,
-- come gia' avviene per shopify_orders (che contiene piu' dati personali di questa).

create or replace view public.v_fonti_freschezza as
select
  (select max(created_at_shop) from shopify_orders)                 as ultimo_ordine_shopify,
  (select max(synced_at)       from shopify_orders)                 as ultimo_sync_ordini,
  (select max(data)            from qromo_sales)                    as ultima_vendita_qromo,
  (select max(date)            from meta_ads_daily)                 as meta_ads_ultimo_giorno,
  (select max(pulled_at)       from meta_ads_daily)                 as meta_ads_ultimo_pull,
  (select max(updated_at)      from shipping_status)                as ultimo_batch_spedizioni,
  (select max(synced_at)       from shopify_stock)                  as ultimo_sync_stock,
  (select max(day)             from health_log)                     as ultimo_health,
  (select max(date_paid)       from expenses where status='approved') as ultima_spesa_pagata,
  (select max(data)            from purchases)                      as ultimo_arrivo;

create or replace view public.v_sconti_codici as
select o.year, o.month, upper(trim(o.discount_codes)) as codice,
       count(*)                                        as ordini,
       round(sum(m.ricavo_netto)::numeric, 2)          as netto,
       round(sum(m.sconto)::numeric, 2)                as sconto,
       round(sum(m.margine_contribuzione)::numeric, 2) as margine,
       round(avg(m.margine_pct)::numeric, 1)           as margine_pct_medio
  from shopify_orders o
  join v_margine_ordine m on m.order_id = o.order_id
 where o.discount_codes is not null and trim(o.discount_codes) not in ('', '[]')
 group by 1, 2, 3;

create or replace view public.v_spedizioni_eccezioni as
select s.ldv, s.order_name, s.stato_tws, s.stato_raw, s.shipped_date, s.seen_delivered_at, s.updated_at,
       o.customer_name, o.created_at_shop::date as data_ordine,
       case
         when s.stato_tws ilike '%CONSEGNATA%' then 'consegnata'
         when s.stato_tws in ('IN TRANSITO','PARTITA','IN PARTENZA TWS','NUOVA','NUOVA REGISTRAZIONE','IN ATTESA DI AFFIDO','FERIE') then 'in_corso'
         else 'eccezione'
       end as classe
  from shipping_status s
  left join shopify_orders o
    on regexp_replace(coalesce(o.order_number, o.order_id), '^#', '') = regexp_replace(coalesce(s.order_name, ''), '^#', '');

create or replace view public.v_evasione_mensile as
select year, month,
       count(*)                                                                            as ordini,
       count(fulfilled_at)                                                                 as evasi,
       round((avg(extract(epoch from (fulfilled_at - created_at_shop)) / 3600))::numeric, 1) as ore_medie,
       round((percentile_cont(0.5) within group (order by extract(epoch from (fulfilled_at - created_at_shop)) / 3600))::numeric, 1) as ore_mediane,
       count(*) filter (where fulfilled_at is not null and fulfilled_at - created_at_shop > interval '72 hours') as oltre_72h
  from shopify_orders
 where created_at_shop is not null
 group by year, month;

grant select on public.v_fonti_freschezza, public.v_sconti_codici, public.v_spedizioni_eccezioni, public.v_evasione_mensile to anon, authenticated;
