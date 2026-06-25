-- FEATURE: reorder board ("Cosa Riprodurre") — velocity 60d + stock + incoming.
create or replace view v_reorder as
 with sold60 as (
   select codice_norm, sum(q) q from (
     select codice_norm, quantita q from qromo_sales where data >= current_date - 60
     union all select li.codice_norm, li.quantita from shopify_line_items li join shopify_orders o on o.order_id=li.order_id where o.created_at_shop >= current_date - 60
     union all select codice_norm, quantita from b2b_movements where tipo_movimento='venduto' and data >= current_date - 60
   ) s group by codice_norm
 ),
 arrivo as (
   select upper(regexp_replace(coalesce(codice,''),'\s+','_','g')) codice_norm,
     sum(greatest(coalesce(qty_ordered,0)-coalesce(qty_arrived,0),0)) q
   from supplier_orders group by 1
 )
 select i.codice, i.item, i.variant, i.image_url,
   i.giacenza_attuale as giacenza, i.disponibili_da_vendere as disponibili, i.on_shopify,
   coalesce(s.q,0) as venduto_60d, coalesce(a.q,0) as in_arrivo,
   case when coalesce(s.q,0) > 0 then round(i.giacenza_attuale / (s.q/60.0), 0) else null end as giorni_stock
 from v_inventory i
 left join sold60 s on s.codice_norm = i.codice_norm
 left join arrivo a on a.codice_norm = i.codice_norm
 where coalesce(s.q,0) > 0 or i.giacenza_attuale > 0;
grant select on v_reorder to anon, authenticated;

-- FEATURE: SKU-availability monitor — what's purchasable now + the two loss types.
create or replace view v_sku_availability as
 select i.codice, i.item, i.variant, i.image_url,
   i.giacenza_attuale as giacenza, i.disponibili_da_vendere as disponibili, i.on_shopify,
   case when i.on_shopify and i.disponibili_da_vendere > 0 then 'acquistabile'
        when i.giacenza_attuale > 0 and not i.on_shopify then 'in_stock_non_pubblicato'
        when i.on_shopify and i.disponibili_da_vendere <= 0 then 'pubblicato_esaurito'
        else 'altro' end as stato
 from v_inventory i
 where coalesce(trim(i.item),'') <> '';
grant select on v_sku_availability to anon, authenticated;
