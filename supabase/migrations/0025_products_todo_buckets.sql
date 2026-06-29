-- 0025: classify the "Da completare" queue into action buckets.
-- The product person should see, in order:
--   1) 'nuovo'       — products just created from a supplier order (source='app-ordine'),
--                      not yet verified → enrich variant/price/image (+ description if new model).
--   2) 'costo_ricavo'— anything still missing retail_price OR cogs → blocks margin/P&L.
--   3) 'pulizia'     — only cosmetic gaps left (image/description/model-variant parse) while
--                      price+cogs are present → optional, parked at the bottom of the queue.
-- Same row set as before (WHERE unchanged), so v_health's count is untouched.
-- New columns are APPENDED at the end (create-or-replace can't reorder existing columns).

create or replace view v_products_todo as
with self as (
  select p.*,
    upper(regexp_replace(coalesce(p.model, p.item, ''), '\s+', '_', 'g')) as model_key
  from products p
)
select s.codice, s.item, s.variant, s.model, s.categoria, s.image_url,
  s.retail_price, s.cogs, s.description, s.seo_title, s.is_finalized, s.verificato, s.notes,
  (case when coalesce(trim(s.item),'')   = '' then 1 else 0 end
   + case when coalesce(trim(s.variant),'')= '' then 1 else 0 end
   + case when coalesce(trim(s.image_url),'')='' then 1 else 0 end
   + case when s.retail_price is null or s.retail_price = 0 then 1 else 0 end
   + case when coalesce(trim(s.description),'')='' then 1 else 0 end) as missing_count,
  coalesce(i.giacenza_attuale,0) as giacenza,
  coalesce(i.shopify_sold,0)+coalesce(i.qromo_sold,0)+coalesce(i.b2b_venduto,0) as venduto,
  coalesce(i.on_shopify,false) as on_shopify,
  -- appended columns:
  s.source,
  -- new model = no OTHER already-verified product shares this model → description is required
  (case when s.model_key = '' then true
        else not exists (
          select 1 from products o
          where o.codice <> s.codice and o.verificato = true
            and upper(regexp_replace(coalesce(o.model, o.item, ''), '\s+', '_', 'g')) = s.model_key
        ) end) as is_new_model,
  -- action bucket (priority order)
  (case
     when s.source = 'app-ordine' and s.verificato = false then 'nuovo'
     when (s.retail_price is null or s.retail_price = 0)
       or (s.cogs is null or s.cogs = 0) then 'costo_ricavo'
     else 'pulizia'
   end) as bucket,
  (case
     when s.source = 'app-ordine' and s.verificato = false then 0
     when (s.retail_price is null or s.retail_price = 0)
       or (s.cogs is null or s.cogs = 0) then 1
     else 2
   end) as bucket_rank
from self s
left join v_inventory i on i.codice = s.codice
where s.verificato = false
   or coalesce(trim(s.item),'') = ''
   or coalesce(trim(s.variant),'') = '';

grant select on v_products_todo to anon, authenticated;
