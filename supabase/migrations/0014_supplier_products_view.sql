-- FLOW 1: which bags a supplier has made before (smart filter), with last cost + image.
create or replace view v_fornitore_prodotti as
 select pu.fornitore, pu.codice,
   max(coalesce(p.item, pu.item))      as item,
   max(coalesce(p.variant, pu.variant)) as variant,
   (array_agg(pu.costo_unitario order by pu.data desc nulls last) filter (where pu.costo_unitario is not null))[1] as ultimo_costo,
   max(pu.data) as ultima_data,
   max(p.image_url) as image_url,
   count(*) as n_ordini
 from purchases pu
 left join products p on p.codice = pu.codice
 where coalesce(trim(pu.fornitore),'') <> ''
 group by pu.fornitore, pu.codice;

grant select on v_fornitore_prodotti to anon, authenticated;
