-- 0009: v_inventory con ultima vendita e flag on_shopify.
--
-- RECUPERATA il 2026-08-01 dal DB di produzione (`supabase_migrations.schema_migrations.statements`).
-- Il file mancava dal repo: la storia delle migrazioni era incompleta e un rebuild da zero si
-- fermava alla 0013. Contenuto identico a quello applicato in produzione il 2026-06-24.
-- NB: questa e' la versione del 24-06; la v_inventory ATTUALE e' il risultato delle migrazioni
-- successive che l'hanno ridefinita (resi_rientrati, aggiustamenti, ecc.).

create or replace view v_inventory as
with pur as (select codice_norm, sum(quantita) q from purchases group by 1),
 sho as (select codice_norm, sum(quantita) q from shopify_line_items group by 1),
 qro as (select codice_norm, sum(quantita) q from qromo_sales group by 1),
 gif as (select codice_norm, sum(quantita) q from gifts_offline group by 1),
 b2v as (select codice_norm, sum(quantita) q from b2b_movements where tipo_movimento='venduto' group by 1),
 b2cv as (select codice_norm,
            sum(case when tipo_movimento='invio' then quantita when tipo_movimento in ('reso','venduto') then -quantita else 0 end) q
          from b2b_movements where modello='conto_vendita' group by 1),
 last_sale as (
   select codice_norm, max(d) d from (
     select codice_norm, data::timestamptz d from qromo_sales where data is not null
     union all select codice_norm, data::timestamptz from b2b_movements where tipo_movimento='venduto' and data is not null
     union all select li.codice_norm, o.created_at_shop from shopify_line_items li join shopify_orders o on o.order_id=li.order_id where o.created_at_shop is not null
   ) s group by codice_norm
 )
select p.codice, p.codice_norm, p.item, p.variant, p.categoria, p.retail_price, p.cogs, p.image_url, p.status,
  coalesce(pur.q,0) as qty_purchased, coalesce(sho.q,0) as shopify_sold, coalesce(qro.q,0) as qromo_sold,
  coalesce(gif.q,0) as gift_sold, coalesce(b2v.q,0) as b2b_venduto, coalesce(b2cv.q,0) as in_conto_vendita,
  coalesce(pur.q,0)-coalesce(sho.q,0)-coalesce(qro.q,0)-coalesce(gif.q,0) as giacenza_attuale,
  coalesce(pur.q,0)-coalesce(sho.q,0)-coalesce(qro.q,0)-coalesce(gif.q,0)-coalesce(b2v.q,0) as giacenza_totale_conb2b,
  coalesce(pur.q,0)-coalesce(sho.q,0)-coalesce(qro.q,0)-coalesce(gif.q,0)-coalesce(b2v.q,0)-coalesce(b2cv.q,0) as disponibili_da_vendere,
  round((coalesce(pur.q,0)-coalesce(sho.q,0)-coalesce(qro.q,0)-coalesce(gif.q,0)) * coalesce(p.retail_price,0),2) as valore,
  ls.d as last_sale,
  (sc.codice is not null) as on_shopify
from products p
left join pur on pur.codice_norm=p.codice_norm left join sho on sho.codice_norm=p.codice_norm
left join qro on qro.codice_norm=p.codice_norm left join gif on gif.codice_norm=p.codice_norm
left join b2v on b2v.codice_norm=p.codice_norm left join b2cv on b2cv.codice_norm=p.codice_norm
left join last_sale ls on ls.codice_norm=p.codice_norm
left join shopify_catalog sc on sc.codice=p.codice;
