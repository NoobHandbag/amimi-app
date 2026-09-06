-- 0110: v_evasione_mensile ricostruita sulla data di spedizione TWS (audit dashboard 06-09, correzione
-- alla 0109 di poche ore prima). Verifica live 06-09: `shopify_orders.fulfilled_at` e' popolato quasi
-- solo per gli ordini pre-cutover (giu 159/172) e quasi mai dopo (lug 3/175, ago 1/91): il sync vivo
-- non lo scrive. `shipping_status.shipped_date` (tracking TWS, tipo DATE) copre invece i mesi recenti
-- (giu 76/173, lug 161/180, ago 80/95). Precisione a giorni interi, perche' la fonte e' una DATA.
drop view if exists public.v_evasione_mensile;
create view public.v_evasione_mensile as
with o as (
  select o.year, o.month,
         o.created_at_shop::date as d0,
         coalesce(s.shipped_date, o.fulfilled_at::date) as d1
    from shopify_orders o
    left join shipping_status s
      on regexp_replace(coalesce(o.order_number, o.order_id), '^#', '') = regexp_replace(coalesce(s.order_name, ''), '^#', '')
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
grant select on public.v_evasione_mensile to anon, authenticated;
