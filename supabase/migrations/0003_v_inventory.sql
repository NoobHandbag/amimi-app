create or replace view v_inventory as
with pur as (select codice_norm, sum(quantita) q from purchases group by 1),
 sho as (select codice_norm, sum(quantita) q from shopify_line_items group by 1),
 qro as (select codice_norm, sum(quantita) q from qromo_sales group by 1),
 gif as (select codice_norm, sum(quantita) q from gifts_offline group by 1),
 b2v as (select codice_norm, sum(quantita) q from b2b_movements where tipo_movimento='venduto' group by 1),
 b2cv as (select codice_norm,
            sum(case when tipo_movimento='invio' then quantita
                     when tipo_movimento in ('reso','venduto') then -quantita else 0 end) q
          from b2b_movements where modello='conto_vendita' group by 1)
select p.codice, p.codice_norm, p.item, p.variant, p.categoria, p.retail_price, p.cogs, p.image_url, p.status,
  coalesce(pur.q,0) as qty_purchased, coalesce(sho.q,0) as shopify_sold, coalesce(qro.q,0) as qromo_sold,
  coalesce(gif.q,0) as gift_sold, coalesce(b2v.q,0) as b2b_venduto, coalesce(b2cv.q,0) as in_conto_vendita,
  coalesce(pur.q,0)-coalesce(sho.q,0)-coalesce(qro.q,0)-coalesce(gif.q,0) as giacenza_attuale,
  coalesce(pur.q,0)-coalesce(sho.q,0)-coalesce(qro.q,0)-coalesce(gif.q,0)-coalesce(b2v.q,0) as giacenza_totale_conb2b,
  coalesce(pur.q,0)-coalesce(sho.q,0)-coalesce(qro.q,0)-coalesce(gif.q,0)-coalesce(b2v.q,0)-coalesce(b2cv.q,0) as disponibili_da_vendere,
  round((coalesce(pur.q,0)-coalesce(sho.q,0)-coalesce(qro.q,0)-coalesce(gif.q,0)) * coalesce(p.retail_price,0),2) as valore
from products p
left join pur on pur.codice_norm=p.codice_norm left join sho on sho.codice_norm=p.codice_norm
left join qro on qro.codice_norm=p.codice_norm left join gif on gif.codice_norm=p.codice_norm
left join b2v on b2v.codice_norm=p.codice_norm left join b2cv on b2cv.codice_norm=p.codice_norm;
