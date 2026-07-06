-- 0041 — schema per il feedback cofounder 2026-07-06:
-- (item 15) shopify_stock.shopify_status: lo stato del prodotto Shopify (active/draft/archived),
--   scritto dalla edge shopify-stock v10; on_shopify in v_inventory conta SOLO gli active
--   (le bozze del vecchio sito gonfiavano "attivi ma esauriti": 58 invece dei reali).
-- (item 18) supplier_orders.wip: riga ordine "work in progress" (quantita/costo ignoti, es.
--   affinamento pelle); si risolve alla registrazione dell'arrivo.
-- (item 20) products.riordino_archiviato: archivio riordino ripristinabile (design Ginni).
-- (item 19) v_fornitore_prodotti e v_ordini_arrivo: fallback immagine da shopify_stock
--   (stessa tecnica di v_inventory), cosi' le foto compaiono in nuovo ordine e arrivi.

alter table shopify_stock add column if not exists shopify_status text;
alter table supplier_orders add column if not exists wip boolean not null default false;
alter table products add column if not exists riordino_archiviato boolean not null default false;

-- v_inventory: on_shopify = presente su Shopify con status ACTIVE (null = active finche' il
-- sync non popola la colonna). L'immagine resta il fallback da QUALSIASI riga shopify_stock.
create or replace view v_inventory as
with pur as (select codice_norm, sum(quantita) as q from purchases group by codice_norm),
sho as (select codice_norm, sum(quantita) as q from shopify_line_items group by codice_norm),
qro as (select codice_norm, sum(quantita) as q from qromo_sales group by codice_norm),
gif as (select codice_norm, sum(quantita) as q from gifts_offline group by codice_norm),
ret as (select codice_norm, sum(quantita) as q from returns where rientra_stock = true group by codice_norm),
adj as (select codice_norm, sum(qty_delta) as q from stock_adjustments group by codice_norm),
b2v as (select codice_norm, sum(quantita) as q from b2b_movements where tipo_movimento = 'venduto' group by codice_norm),
b2cv as (
  select codice_norm, sum(case when tipo_movimento = 'invio' then quantita
                               when tipo_movimento in ('reso','venduto') then -quantita
                               else 0 end) as q
  from b2b_movements where modello = 'conto_vendita' group by codice_norm
),
last_sale as (
  select s.codice_norm, max(s.d) as d
  from (
    select codice_norm, data::timestamptz as d from qromo_sales where data is not null
    union all
    select codice_norm, data::timestamptz from b2b_movements where tipo_movimento = 'venduto' and data is not null
    union all
    select li.codice_norm, o.created_at_shop from shopify_line_items li
      join shopify_orders o on o.order_id = li.order_id where o.created_at_shop is not null
  ) s group by s.codice_norm
),
shop as (
  select upper(regexp_replace(coalesce(codice,''), '\s+', '_', 'g')) as codice_norm,
         max(image_url) as image_url,
         bool_or(coalesce(shopify_status, 'active') = 'active') as is_active
  from shopify_stock
  where codice is not null and codice <> ''
  group by upper(regexp_replace(coalesce(codice,''), '\s+', '_', 'g'))
)
select p.codice, p.codice_norm, p.item, p.variant, p.categoria, p.retail_price, p.cogs,
  coalesce(p.image_url, shop.image_url) as image_url,
  p.status,
  coalesce(pur.q, 0) as qty_purchased,
  coalesce(sho.q, 0) as shopify_sold,
  coalesce(qro.q, 0) as qromo_sold,
  coalesce(gif.q, 0) as gift_sold,
  coalesce(b2v.q, 0) as b2b_venduto,
  coalesce(b2cv.q, 0) as in_conto_vendita,
  coalesce(pur.q,0) - coalesce(sho.q,0) - coalesce(qro.q,0) - coalesce(gif.q,0) + coalesce(ret.q,0) + coalesce(adj.q,0) as giacenza_attuale,
  coalesce(pur.q,0) - coalesce(sho.q,0) - coalesce(qro.q,0) - coalesce(gif.q,0) + coalesce(ret.q,0) + coalesce(adj.q,0) - coalesce(b2v.q,0) as giacenza_totale_conb2b,
  coalesce(pur.q,0) - coalesce(sho.q,0) - coalesce(qro.q,0) - coalesce(gif.q,0) + coalesce(ret.q,0) + coalesce(adj.q,0) - coalesce(b2v.q,0) - coalesce(b2cv.q,0) as disponibili_da_vendere,
  round((coalesce(pur.q,0) - coalesce(sho.q,0) - coalesce(qro.q,0) - coalesce(gif.q,0) + coalesce(ret.q,0) + coalesce(adj.q,0)) * coalesce(p.retail_price, 0), 2) as valore,
  ls.d as last_sale,
  (shop.codice_norm is not null and shop.is_active) as on_shopify,
  coalesce(ret.q, 0) as resi_rientrati,
  coalesce(adj.q, 0) as aggiustamenti
from products p
left join pur on pur.codice_norm = p.codice_norm
left join sho on sho.codice_norm = p.codice_norm
left join qro on qro.codice_norm = p.codice_norm
left join gif on gif.codice_norm = p.codice_norm
left join ret on ret.codice_norm = p.codice_norm
left join adj on adj.codice_norm = p.codice_norm
left join b2v on b2v.codice_norm = p.codice_norm
left join b2cv on b2cv.codice_norm = p.codice_norm
left join last_sale ls on ls.codice_norm = p.codice_norm
left join shop on shop.codice_norm = p.codice_norm;

-- v_ordini_arrivo: fallback immagine Shopify + flag wip (colonna appesa in coda)
create or replace view v_ordini_arrivo as
select o.id, o.gruppo, o.codice, o.item, o.variant, o.fornitore,
  o.qty_ordered, o.qty_arrived,
  coalesce(o.qty_ordered, 0) - coalesce(o.qty_arrived, 0) as mancano,
  case when o.wip then coalesce(o.qty_arrived, 0) > 0
       else coalesce(o.qty_arrived, 0) >= coalesce(o.qty_ordered, 0) end as completo,
  o.nuovo_riordino, o.costo_unitario, o.data_consegna, o.data_ordine, o.data_ultimo_arrivo, o.note,
  coalesce(p.image_url, ss.image_url) as image_url,
  o.wip
from supplier_orders o
left join products p on p.codice_norm = upper(regexp_replace(coalesce(o.codice,''), '\s+', '_', 'g'))
left join (
  select upper(regexp_replace(coalesce(codice,''), '\s+', '_', 'g')) as codice_norm, max(image_url) as image_url
  from shopify_stock group by 1
) ss on ss.codice_norm = upper(regexp_replace(coalesce(o.codice,''), '\s+', '_', 'g'));

-- v_fornitore_prodotti: fallback immagine Shopify (le foto nel form nuovo ordine)
create or replace view v_fornitore_prodotti as
select pu.fornitore, pu.codice,
  max(coalesce(p.item, pu.item)) as item,
  max(coalesce(p.variant, pu.variant)) as variant,
  (array_agg(pu.costo_unitario order by pu.data desc nulls last) filter (where pu.costo_unitario is not null))[1] as ultimo_costo,
  max(pu.data) as ultima_data,
  coalesce(max(p.image_url), max(ss.image_url)) as image_url,
  count(*) as n_ordini
from purchases pu
left join products p on p.codice = pu.codice
left join (
  select upper(regexp_replace(coalesce(codice,''), '\s+', '_', 'g')) as codice_norm, max(image_url) as image_url
  from shopify_stock group by 1
) ss on ss.codice_norm = pu.codice_norm
where coalesce(trim(pu.fornitore), '') <> ''
group by pu.fornitore, pu.codice;

-- v_reorder: espone il flag archivio (filtro lato app, l'archivio resta consultabile)
create or replace view v_reorder as
with sold60 as (
  select s.codice_norm, sum(s.q) as q
  from (
    select codice_norm, quantita as q from qromo_sales where data >= current_date - 60
    union all
    select li.codice_norm, li.quantita from shopify_line_items li
      join shopify_orders o on o.order_id = li.order_id
      where o.created_at_shop >= current_date - 60
    union all
    select codice_norm, quantita from b2b_movements
      where tipo_movimento = 'venduto' and data >= current_date - 60
  ) s group by s.codice_norm
),
arrivo as (
  select upper(regexp_replace(coalesce(codice,''), '\s+', '_', 'g')) as codice_norm,
         sum(greatest(coalesce(qty_ordered,0) - coalesce(qty_arrived,0), 0)) as q
  from supplier_orders group by 1
)
select i.codice, i.item, i.variant, i.image_url,
  i.giacenza_attuale as giacenza,
  i.disponibili_da_vendere as disponibili,
  i.on_shopify,
  coalesce(s.q, 0) as venduto_60d,
  coalesce(a.q, 0) as in_arrivo,
  case when coalesce(s.q,0) > 0 then round(i.giacenza_attuale / (s.q / 60.0), 0) else null end as giorni_stock,
  coalesce(p.riordino_archiviato, false) as riordino_archiviato
from v_inventory i
left join products p on p.codice_norm = i.codice_norm
left join sold60 s on s.codice_norm = i.codice_norm
left join arrivo a on a.codice_norm = i.codice_norm
where coalesce(s.q, 0) > 0 or i.giacenza_attuale > 0;

insert into change_log (tbl, row_id, op, after, chi, source)
values ('schema', '0041', 'feedback_schema',
        '{"cols": ["shopify_stock.shopify_status", "supplier_orders.wip", "products.riordino_archiviato"], "views": ["v_inventory", "v_ordini_arrivo", "v_fornitore_prodotti", "v_reorder"]}'::jsonb,
        'Claude-Code', 'migration-0041');
