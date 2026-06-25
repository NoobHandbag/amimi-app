-- ============ FLOW foundations ============

-- FLOW 1: multi-bag supplier orders.
alter table supplier_orders add column if not exists gruppo uuid not null default gen_random_uuid();
alter table supplier_orders add column if not exists nuovo_riordino text;
alter table supplier_orders add column if not exists costo_unitario numeric;
alter table supplier_orders add column if not exists data_consegna date;

drop view if exists v_ordini_arrivo;
create view v_ordini_arrivo as
 select o.id, o.gruppo, o.codice, o.item, o.variant, o.fornitore,
   o.qty_ordered, o.qty_arrived,
   coalesce(o.qty_ordered,0) - coalesce(o.qty_arrived,0) as mancano,
   coalesce(o.qty_arrived,0) >= coalesce(o.qty_ordered,0) as completo,
   o.nuovo_riordino, o.costo_unitario, o.data_consegna,
   o.data_ordine, o.data_ultimo_arrivo, o.note, p.image_url
 from supplier_orders o
 left join products p on p.codice_norm = upper(regexp_replace(coalesce(o.codice,''), '\s+', '_', 'g'));

-- FLOW 2: product-detail verification (Benedetta).
alter table products add column if not exists verificato boolean not null default true;
update products set verificato = false
 where coalesce(trim(item),'') = '' or coalesce(trim(variant),'') = '';

create or replace view v_products_todo as
 select p.codice, p.item, p.variant, p.model, p.categoria, p.image_url,
   p.retail_price, p.cogs, p.description, p.seo_title, p.is_finalized, p.verificato, p.notes,
   (case when coalesce(trim(p.item),'')   = '' then 1 else 0 end
    + case when coalesce(trim(p.variant),'')= '' then 1 else 0 end
    + case when coalesce(trim(p.image_url),'')='' then 1 else 0 end
    + case when p.retail_price is null or p.retail_price = 0 then 1 else 0 end
    + case when coalesce(trim(p.description),'')='' then 1 else 0 end) as missing_count,
   coalesce(i.giacenza_attuale,0) as giacenza,
   coalesce(i.shopify_sold,0)+coalesce(i.qromo_sold,0)+coalesce(i.b2b_venduto,0) as venduto,
   coalesce(i.on_shopify,false) as on_shopify
 from products p
 left join v_inventory i on i.codice = p.codice
 where p.verificato = false
    or coalesce(trim(p.item),'') = ''
    or coalesce(trim(p.variant),'') = '';

-- FLOW 4: expense approval.
alter table expenses add column if not exists status text not null default 'approved';
alter table expenses add column if not exists proposed_by text;
alter table expenses add column if not exists approved_by text;
alter table expenses add column if not exists chi text;

create or replace view v_expenses_pending as
 select id, date_reported, date_paid, operazione, costo, categoria, sottocategoria,
   amimi, note, proposed_by, status, created_at
 from expenses where status = 'pending' order by created_at desc;

-- Feature flags & server-only secrets (NO anon grant)
create table if not exists app_flags (key text primary key, value text);
insert into app_flags(key,value) values
 ('shopify_write_enabled','false'), ('gemini_api_key','')
 on conflict (key) do nothing;

grant select on v_products_todo, v_expenses_pending to anon, authenticated;
