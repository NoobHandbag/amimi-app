-- 0132: redesign della sezione Ads (richiesta owner 2026-09-19). Additiva.
--  - punto 6: frequency VERA a 7 giorni (reach deduplicata) in una tabella per ad, scritta dall'edge ads-sync.
--  - asset visibili: colonna image_url (immagine grande) accanto a thumbnail_url in meta_ad_creative.
--  - "categoria/modello che pubblicizza vs borse live": viste per MODELLO (item), sul set e sul catalogo.
--  - adset_name nelle finestre, per mostrare l'architettura campagna -> adset -> ad.
-- La rewrite di v_ads_creative_status (con freq reale, immagine, object_type, adset e soglie tarate) e' nella 0133,
-- dopo aver misurato la frequency vera sui dati.

-- 1) frequency 7g reale per ad (stato corrente, sovrascritta a ogni giro). RLS on, solo service_role.
create table if not exists meta_ad_freq7 (
  ad_id text primary key,
  day date,
  freq_7d numeric(10,4),
  reach_7d bigint,
  impressions_7d bigint,
  updated_at timestamptz default now() not null
);
alter table meta_ad_freq7 enable row level security;
grant select, insert, update, delete on meta_ad_freq7 to service_role;
comment on table meta_ad_freq7 is 'Amimì Ads: frequency VERA a 7 giorni per ad (una chiamata insights sul 7d, reach deduplicata). Punto 6.';

-- 2) immagine grande dell'asset (thumbnail_url resta il fallback, spesso 64px; per i video e' un fotogramma).
alter table meta_ad_creative add column if not exists image_url text;

-- 3) modelli nel product_set di un ad, con quante borse sono LIVE (su Shopify e a stock). Espone la mappa
--    (service_role) ad anon in forma aggregata, come le altre viste ads.
create or replace view v_ads_set_modelli as
 select m.product_set_id,
   coalesce(i.categoria, 'ALTRO') as categoria,
   coalesce(i.item, '(non risolto)') as modello,
   count(*) as prodotti,
   count(*) filter (where i.on_shopify and coalesce(i.disponibili_da_vendere,0) > 0) as live
 from meta_product_set_map m
 left join v_inventory i on i.codice_norm = m.codice_norm
 group by 1, 2, 3;
grant select on v_ads_set_modelli to anon, authenticated;

-- 4) catalogo per modello: quante borse totali / su Shopify / LIVE per ogni modello. Serve a rispondere
--    "questo ad pubblicizza il modello X: quante borse X sono comprabili adesso?".
create or replace view v_ads_catalogo_modelli as
 select coalesce(categoria, 'ALTRO') as categoria,
   coalesce(item, '(senza modello)') as modello,
   count(*) as prodotti,
   count(*) filter (where on_shopify) as su_shopify,
   count(*) filter (where on_shopify and coalesce(disponibili_da_vendere,0) > 0) as live
 from v_inventory
 group by 1, 2;
grant select on v_ads_catalogo_modelli to anon, authenticated;

-- 5) finestre per ad: aggiungo adset_name (per l'architettura campagna -> adset -> ad). Resto invariato dalla 0129.
create or replace view v_ads_creative_windows as
 with ref as (select max(date) as d from meta_ads_creative_daily)
 select d.ad_id,
   r.d as as_of,
   max(d.ad_name) as ad_name,
   max(d.campaign_name) as campaign_name,
   max(d.adset_name) as adset_name,
   sum(d.spend)          filter (where d.date >  r.d - 7)                        as spend_7,
   sum(d.impressions)    filter (where d.date >  r.d - 7)                        as impr_7,
   sum(d.clicks)         filter (where d.date >  r.d - 7)                        as clicks_7,
   sum(d.link_clicks)    filter (where d.date >  r.d - 7)                        as link_clicks_7,
   sum(d.purchases)      filter (where d.date >  r.d - 7)                        as purchases_7,
   sum(d.purchase_value) filter (where d.date >  r.d - 7)                        as value_7,
   avg(d.frequency)      filter (where d.date >  r.d - 7 and d.spend > 0)        as freq_media_giornaliera_7,
   sum(d.spend)          filter (where d.date >  r.d - 14 and d.date <= r.d - 7) as spend_prev7,
   sum(d.impressions)    filter (where d.date >  r.d - 14 and d.date <= r.d - 7) as impr_prev7,
   sum(d.clicks)         filter (where d.date >  r.d - 14 and d.date <= r.d - 7) as clicks_prev7,
   sum(d.purchases)      filter (where d.date >  r.d - 14 and d.date <= r.d - 7) as purchases_prev7,
   sum(d.purchase_value) filter (where d.date >  r.d - 14 and d.date <= r.d - 7) as value_prev7,
   sum(d.spend)          filter (where d.date >  r.d - 90)                       as spend_90,
   sum(d.impressions)    filter (where d.date >  r.d - 90)                       as impr_90,
   sum(d.clicks)         filter (where d.date >  r.d - 90)                       as clicks_90,
   sum(d.purchases)      filter (where d.date >  r.d - 90)                       as purchases_90,
   sum(d.purchase_value) filter (where d.date >  r.d - 90)                       as value_90,
   count(distinct d.date) filter (where d.date > r.d - 90 and d.spend > 0)       as giorni_attivi_90
 from meta_ads_creative_daily d cross join ref r
 group by d.ad_id, r.d;
grant select on v_ads_creative_windows to anon, authenticated;