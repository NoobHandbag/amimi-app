-- 0088 (brief clienti_rfm, A8): liste per cliente RFM + coorti. SOLO VISTE, zero tabelle/edge.
-- DUE LIMITI STRUTTURALI da tenere davanti agli occhi (criterio 5, ripetuti in SCHEMA.md):
--   1) E' SOLO ONLINE: le 172 vendite Qromo hanno nome e cognome VUOTI (172/172, misurato 31-07),
--      identita' cross-canale inesistente e non costruibile a viste.
--   2) STORICO DAL 16-02-2026 (5 mesi e mezzo): recency e frequency sono strutturalmente
--      SOTTOSTIMATE per un prodotto a ciclo di riacquisto lungo. Per questo NON esiste il
--      segmento "perso" (indistinguibile da "deve ancora ricomprare"): si costruisce ADESSO
--      perche' accumuli, non perche' sia gia' leggibile.
-- Resi (criterio 3, scelta dichiarata): frequency conta TUTTI gli ordini con email (cosi'
-- sum(frequency) = ordini con email, criterio 1); monetary ESCLUDE gli ordini interamente
-- rimborsati (financial_status='refunded'); i partially_refunded restano a gross_total pieno
-- (l'importo del rimborso parziale non e' in shopify_orders: approssimazione dichiarata).
-- Segmenti TARATI sui dati reali (580 email, ~12 ripetuti: i quintili da manuale darebbero
-- classi vuote): top = monetary >= p90; ripetuto = 2+ ordini; nuovo = 1 ordine, <= 60gg;
-- dormiente = 1 ordine, > 120gg; una_tantum = 1 ordine, 61-120gg (residuo, dichiarato).

create or replace view v_clienti_rfm as
with ord as (
  select lower(email) as email, order_number, created_at_shop, gross_total, financial_status
  from shopify_orders
  where email is not null and email <> ''
),
cli as (
  select email,
    min(created_at_shop)::date as primo_ordine,
    max(created_at_shop)::date as ultimo_ordine,
    (current_date - max(created_at_shop)::date) as recency_giorni,
    count(*) as frequency,
    round(sum(gross_total) filter (where financial_status <> 'refunded')::numeric, 2) as monetary,
    count(*) filter (where financial_status <> 'refunded') as ordini_validi
  from ord group by email
),
p as (select percentile_cont(0.9) within group (order by monetary) as p90 from cli)
select c.email, c.primo_ordine, c.ultimo_ordine, c.recency_giorni, c.frequency,
  coalesce(c.monetary, 0) as monetary,
  case when c.ordini_validi > 0 then round(c.monetary / c.ordini_validi, 2) end as aov,
  case
    when coalesce(c.monetary, 0) >= p.p90 and p.p90 > 0 then 'top'
    when c.frequency >= 2 then 'ripetuto'
    when c.recency_giorni <= 60 then 'nuovo'
    when c.recency_giorni > 120 then 'dormiente'
    else 'una_tantum'
  end as segmento
from cli c, p;
grant select on v_clienti_rfm to anon, authenticated;

create or replace view v_clienti_coorti as
with ord as (
  select lower(email) as email, created_at_shop, gross_total, financial_status
  from shopify_orders where email is not null and email <> ''
),
primo as (select email, min(created_at_shop) as primo from ord group by email),
riacquisti as (
  select p.email, date_trunc('month', p.primo)::date as coorte,
    min(o.created_at_shop) filter (where o.created_at_shop > p.primo) as secondo
  from primo p join ord o on o.email = p.email
  group by p.email, p.primo
),
mon as (
  select p.email, date_trunc('month', p.primo)::date as coorte,
    sum(o.gross_total) filter (where o.financial_status <> 'refunded') as spesa
  from primo p join ord o on o.email = p.email group by 1, 2
)
select r.coorte,
  (current_date - r.coorte) as maturita_giorni,   -- giorni dal 1o giorno del mese di ingresso: le coorti giovani sembrano sempre "peggiori" solo perche' non hanno avuto tempo
  count(*) as clienti,
  count(*) filter (where r.secondo is not null and r.secondo <= (select min(o2.created_at_shop) from ord o2 where o2.email = r.email) + interval '30 days') as ricomprato_30gg,
  count(*) filter (where r.secondo is not null and r.secondo <= (select min(o2.created_at_shop) from ord o2 where o2.email = r.email) + interval '60 days') as ricomprato_60gg,
  count(*) filter (where r.secondo is not null and r.secondo <= (select min(o2.created_at_shop) from ord o2 where o2.email = r.email) + interval '90 days') as ricomprato_90gg,
  round(avg(m.spesa)::numeric, 2) as netto_medio_cliente
from riacquisti r join mon m on m.email = r.email
group by r.coorte order by r.coorte;
grant select on v_clienti_coorti to anon, authenticated;
