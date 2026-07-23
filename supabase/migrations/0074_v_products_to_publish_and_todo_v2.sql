-- 0074: (1) v_products_to_publish, l'UNICO segnale per il task upload-prodotto (brief D.1):
-- anagrafica completa + foto + NESSUNA riga shopify_stock FRESCA per quel codice (qualsiasi
-- status: le bozze contano, on_shopify=false NON basta). Il mirror e' upsert-only senza prune
-- (23/245 righe stale al 23-07), quindi si considerano solo le righe viste dall'ultimo giro di
-- sync (finestra 2h sul max synced_at): una riga stale di un prodotto rimosso da Shopify non
-- blocca per sempre la ri-pubblicazione, e se il sync e' fermo TUTTO resta bloccato (conservativo,
-- mai doppioni). Il gate stock NON filtra (decisione owner 23-07: bozza anche prima dell'arrivo):
-- pronto_stock e' solo informativo.
-- (2) v_products_todo v2 (brief D.2): bucket 'nuovo' solo per stub con attivita' collegata
-- (QUALSIASI riga ordine, anche WIP/qty NULL, o QUALSIASI componente di magazzino != 0);
-- uno stub senza nulla scivola in 'pulizia' con flag stub_orfano. WHERE estesa alla foto
-- mancante per i prodotti app-born (prima un completo-senza-foto era invisibile a ogni coda).

-- ---------- (2) v_products_todo v2 (stesse colonne 0047 + stub_orfano in coda) ----------
create or replace view public.v_products_todo as
 with self as (
   select p.id, p.codice, p.codice_norm, p.is_finalized, p.model, p.variant, p.item, p.categoria,
          p.shopify_name, p.shopify_sku, p.retail_price, p.cogs, p.description, p.seo_title, p.image_url,
          p.status, p.notes, p.source, p.chi, p.created_at, p.updated_at, p.verificato,
          upper(regexp_replace(coalesce(p.model, p.item, ''::text), '\s+'::text, '_'::text, 'g'::text)) as model_key
     from products p
 ), base as (
   select s.*,
          i.giacenza_attuale, i.shopify_sold, i.qromo_sold, i.b2b_venduto, i.on_shopify as inv_on_shopify,
          ( exists ( select 1 from supplier_orders so
                      where upper(regexp_replace(so.codice, '\s+'::text, '_'::text, 'g'::text)) = s.codice_norm )
            or coalesce(i.qty_purchased, 0::numeric) <> 0::numeric
            or coalesce(i.shopify_sold, 0::numeric) <> 0::numeric
            or coalesce(i.qromo_sold, 0::numeric) <> 0::numeric
            or coalesce(i.gift_sold, 0::numeric) <> 0::numeric
            or coalesce(i.b2b_venduto, 0::numeric) <> 0::numeric
            or coalesce(i.resi_rientrati, 0::numeric) <> 0::numeric
            or coalesce(i.aggiustamenti, 0::numeric) <> 0::numeric ) as attivita
     from self s
     left join v_inventory i on i.codice = s.codice
 )
 select s.codice, s.item, s.variant, s.model, s.categoria, s.image_url, s.retail_price, s.cogs,
        s.description, s.seo_title, s.is_finalized, s.verificato, s.notes,
        case when coalesce(trim(both from s.item), ''::text) = ''::text then 1 else 0 end
        + case when coalesce(trim(both from s.variant), ''::text) = ''::text then 1 else 0 end
        + case when coalesce(trim(both from s.image_url), ''::text) = ''::text then 1 else 0 end
        + case when s.retail_price is null or s.retail_price = 0::numeric then 1 else 0 end
        + case when coalesce(trim(both from s.description), ''::text) = ''::text then 1 else 0 end as missing_count,
        coalesce(s.giacenza_attuale, 0::numeric) as giacenza,
        coalesce(s.shopify_sold, 0::numeric) + coalesce(s.qromo_sold, 0::numeric) + coalesce(s.b2b_venduto, 0::numeric) as venduto,
        coalesce(s.inv_on_shopify, false) as on_shopify,
        s.source,
        case when s.model_key = ''::text then true
             else not (exists ( select 1 from products o
                 where o.codice <> s.codice and o.verificato = true
                   and upper(regexp_replace(coalesce(o.model, o.item, ''::text), '\s+'::text, '_'::text, 'g'::text)) = s.model_key))
        end as is_new_model,
        case when s.source = 'app-ordine'::text and s.verificato = false and s.attivita then 'nuovo'::text
             when s.source = 'app-ordine'::text and s.verificato = false and not s.attivita then 'pulizia'::text
             when s.retail_price is null or s.retail_price = 0::numeric or s.cogs is null or s.cogs = 0::numeric then 'costo_ricavo'::text
             else 'pulizia'::text
        end as bucket,
        case when s.source = 'app-ordine'::text and s.verificato = false and s.attivita then 0
             when s.source = 'app-ordine'::text and s.verificato = false and not s.attivita then 2
             when s.retail_price is null or s.retail_price = 0::numeric or s.cogs is null or s.cogs = 0::numeric then 1
             else 2
        end as bucket_rank,
        (s.source = 'app-ordine'::text and s.verificato = false and not s.attivita) as stub_orfano
   from base s
  where s.verificato = false
     or coalesce(trim(both from s.item), ''::text) = ''::text
     or coalesce(trim(both from s.variant), ''::text) = ''::text
     or s.retail_price is null or s.retail_price = 0::numeric
     or s.cogs is null or s.cogs = 0::numeric
     or (s.source = 'app-ordine'::text and coalesce(trim(both from s.image_url), ''::text) = ''::text);

-- ---------- (1) v_products_to_publish ----------
create view public.v_products_to_publish as
 with shop as (
   select upper(regexp_replace(codice, '\s+'::text, '_'::text, 'g'::text)) as codice_norm
     from shopify_stock
    where synced_at >= (select coalesce(max(synced_at), now()) from shopify_stock) - interval '2 hours'
 ), self as (
   select p.*,
          upper(regexp_replace(coalesce(p.model, p.item, ''::text), '\s+'::text, '_'::text, 'g'::text)) as model_key
     from products p
 ), nm as (
   select s.*,
          case when s.model_key = ''::text then true
               else not (exists ( select 1 from products o
                   where o.codice <> s.codice and o.verificato = true
                     and upper(regexp_replace(coalesce(o.model, o.item, ''::text), '\s+'::text, '_'::text, 'g'::text)) = s.model_key))
          end as is_new_model
     from self s
 )
 select n.codice, n.item, n.variant, n.model,
        (m.model is not null) as modello_censito,
        m.categoria, m.product_type, m.template_suffix, m.collections,
        n.retail_price, n.cogs, n.image_url, n.description, n.seo_title,
        n.is_new_model,
        coalesce(i.disponibili_da_vendere, 0::numeric) as disponibili_da_vendere,
        coalesce(i.disponibili_da_vendere, 0::numeric) > 0::numeric as pronto_stock
   from nm n
   left join v_inventory i on i.codice = n.codice
   left join models m on m.model_norm = n.model_key
  where n.source = 'app-ordine'::text
    and coalesce(trim(both from n.item), ''::text) <> ''::text
    and coalesce(trim(both from n.variant), ''::text) <> ''::text
    and coalesce(n.retail_price, 0::numeric) > 0::numeric
    and coalesce(n.cogs, 0::numeric) > 0::numeric
    and coalesce(trim(both from n.image_url), ''::text) <> ''::text
    and (not n.is_new_model or coalesce(trim(both from n.description), ''::text) <> ''::text)
    and n.codice !~ '_$'::text
    and not exists ( select 1 from shop sh where sh.codice_norm = n.codice_norm );

grant select on public.v_products_to_publish to anon, authenticated;
