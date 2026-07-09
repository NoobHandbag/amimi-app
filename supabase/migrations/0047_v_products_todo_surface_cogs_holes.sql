-- 0047: la lista "da verificare" (v_products_todo) ora fa riemergere i prodotti
-- VERIFICATI con un buco su prezzo/COGS (bucket costo_ricavo, prima strutturalmente morto:
-- la WHERE ammetteva solo verificato=false OR item/variant vuoti, quindi un prodotto
-- verificato con COGS mancante spariva del tutto e bloccava il margine in silenzio).
-- + backfill COGS dei 3 COCCO dal costo unitario reale d'ordine (=20)
-- + rimozione dello stub di test LEA_BAG_TEST_BOTFIX (conferma owner, zero riferimenti).

-- (1) backfill COGS = costo unitario dell'ordine fornitore (20) per i 3 COCCO verificati
with u as (
  update products set cogs = 20, updated_at = now()
  where codice in ('LEA_BAG_COCCO_BLUE','LEA_BAG_COCCO_RED','LEA_BAG_COCCO_SAND_CORAL')
    and (cogs is null or cogs = 0)
  returning id, codice, cogs
)
insert into change_log (tbl, row_id, op, after, chi, source)
select 'products', id::text, 'product_cogs_backfill',
       jsonb_build_object('codice', codice, 'cogs', cogs, 'fonte', 'costo unitario ordine fornitore = 20'),
       'Claude Code', 'migration-0047'
from u;

-- (2) elimina lo stub di test (ordine di test spiegato a Ginevra, poi cancellato; orfano rimasto)
with d as (
  delete from products where codice = 'LEA_BAG_TEST_BOTFIX'
  returning id, codice, item, variant, source
)
insert into change_log (tbl, row_id, op, before, chi, source)
select 'products', id::text, 'product_delete',
       jsonb_build_object('codice', codice, 'item', item, 'variant', variant, 'source', source,
         'motivo', 'ordine di test per Ginevra poi cancellato; stub orfano rimosso su conferma owner'),
       'Claude Code', 'migration-0047'
from d;

-- (3) ridefinizione vista: aggiunta al WHERE dei buchi prezzo/COGS, cosi' un prodotto
-- gia' verificato ma senza prezzo o COGS ricompare (bucket costo_ricavo).
create or replace view public.v_products_todo as
 with self as (
   select p.id, p.codice, p.codice_norm, p.is_finalized, p.model, p.variant, p.item, p.categoria,
          p.shopify_name, p.shopify_sku, p.retail_price, p.cogs, p.description, p.seo_title, p.image_url,
          p.status, p.notes, p.source, p.chi, p.created_at, p.updated_at, p.verificato,
          upper(regexp_replace(coalesce(p.model, p.item, ''::text), '\s+'::text, '_'::text, 'g'::text)) as model_key
     from products p
 )
 select s.codice, s.item, s.variant, s.model, s.categoria, s.image_url, s.retail_price, s.cogs,
        s.description, s.seo_title, s.is_finalized, s.verificato, s.notes,
        case when coalesce(trim(both from s.item), ''::text) = ''::text then 1 else 0 end
        + case when coalesce(trim(both from s.variant), ''::text) = ''::text then 1 else 0 end
        + case when coalesce(trim(both from s.image_url), ''::text) = ''::text then 1 else 0 end
        + case when s.retail_price is null or s.retail_price = 0::numeric then 1 else 0 end
        + case when coalesce(trim(both from s.description), ''::text) = ''::text then 1 else 0 end as missing_count,
        coalesce(i.giacenza_attuale, 0::numeric) as giacenza,
        coalesce(i.shopify_sold, 0::numeric) + coalesce(i.qromo_sold, 0::numeric) + coalesce(i.b2b_venduto, 0::numeric) as venduto,
        coalesce(i.on_shopify, false) as on_shopify,
        s.source,
        case when s.model_key = ''::text then true
             else not (exists ( select 1 from products o
                 where o.codice <> s.codice and o.verificato = true
                   and upper(regexp_replace(coalesce(o.model, o.item, ''::text), '\s+'::text, '_'::text, 'g'::text)) = s.model_key))
        end as is_new_model,
        case when s.source = 'app-ordine'::text and s.verificato = false then 'nuovo'::text
             when s.retail_price is null or s.retail_price = 0::numeric or s.cogs is null or s.cogs = 0::numeric then 'costo_ricavo'::text
             else 'pulizia'::text
        end as bucket,
        case when s.source = 'app-ordine'::text and s.verificato = false then 0
             when s.retail_price is null or s.retail_price = 0::numeric or s.cogs is null or s.cogs = 0::numeric then 1
             else 2
        end as bucket_rank
   from self s
     left join v_inventory i on i.codice = s.codice
  where s.verificato = false
     or coalesce(trim(both from s.item), ''::text) = ''::text
     or coalesce(trim(both from s.variant), ''::text) = ''::text
     or s.retail_price is null or s.retail_price = 0::numeric
     or s.cogs is null or s.cogs = 0::numeric;
