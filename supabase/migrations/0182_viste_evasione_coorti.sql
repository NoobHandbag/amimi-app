-- 0182: due viste di lettura che dicevano un numero sbagliato (31-10, trovate preparando un export). Nessun dato toccato.
-- v_evasione_mensile: shipping_status ha una riga per lettera di vettura (541 righe su 525 ordini al 31-10), quindi la
-- join moltiplicava gli ordini spediti con piu' LDV: 990 ordini contro 974 veri, e lo stesso eccesso su spediti e oltre_3gg.
-- Ora l'ordine resta una riga sola e la data di spedizione e' la prima LDV. Ordine e spedizione sono giorni di Roma:
-- shipped_date e' una data italiana e ::date da solo e' UTC, quindi gli ordini della notte risultavano un giorno piu' lenti.
-- v_clienti_coorti.netto_medio_cliente, "Netto medio" nella tabella coorti di Clienti, era il totale pagato con l'IVA.
-- Ora e' / 1,22, come online_netto nel CE. Spedizione dentro e rimborsi parziali dentro, come v_clienti_rfm.monetary.
create or replace view public.v_evasione_mensile as
with sped as (
  select regexp_replace(coalesce(order_name, ''), '^#', '') as ordine, min(shipped_date) as shipped_date
    from shipping_status
   group by 1
), o as (
  select o.year, o.month,
         (o.created_at_shop at time zone 'Europe/Rome')::date as d0,
         coalesce(s.shipped_date, (o.fulfilled_at at time zone 'Europe/Rome')::date) as d1
    from shopify_orders o
    left join sped s on regexp_replace(coalesce(o.order_number, o.order_id), '^#', '') = s.ordine
   where o.created_at_shop is not null
)
select year, month,
       count(*)                                                        as ordini,
       count(d1)                                                       as spediti,
       round(avg(d1 - d0)::numeric, 1)                                 as giorni_medi,
       round((percentile_cont(0.5) within group (order by (d1 - d0)))::numeric, 1) as giorni_mediani,
       count(*) filter (where d1 is not null and d1 - d0 > 3)          as oltre_3gg
  from o
 group by year, month;

create or replace view public.v_clienti_coorti as
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
  round((avg(m.spesa) / 1.22)::numeric, 2) as netto_medio_cliente
from riacquisti r join mon m on m.email = r.email
group by r.coorte order by r.coorte;
