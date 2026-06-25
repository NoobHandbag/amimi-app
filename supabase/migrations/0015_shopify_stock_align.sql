-- THIRD FLOW: Shopify inventory alignment. shopify-stock fn populates this (read-only Shopify pull).
create table if not exists shopify_stock (
  codice text primary key,
  shopify_qty numeric,
  shopify_title text,
  variant_id text,
  inventory_item_id text,
  synced_at timestamptz default now()
);
grant select on shopify_stock to anon, authenticated;

create or replace view v_shopify_align as
 select i.codice, i.item, i.variant, i.image_url,
   i.giacenza_attuale as giacenza, i.disponibili_da_vendere as disponibili,
   s.shopify_qty, s.synced_at,
   (coalesce(s.shopify_qty,0) - coalesce(i.disponibili_da_vendere,0)) as diff,
   i.on_shopify
 from v_inventory i
 left join shopify_stock s on s.codice = i.codice
 where i.on_shopify = true or s.codice is not null;
grant select on v_shopify_align to anon, authenticated;
