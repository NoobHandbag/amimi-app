-- FEATURE: Amimì Ads reporting a livello creativita' (Fase 1).
-- Additivo e isolato: NON tocca meta_ads_daily (livello campagna, storica) ne' v_ads_mensile.
-- Le tabelle base sono service_role only + RLS on; le letture del frontend passeranno
-- dalle viste (migrazione successiva), come v_ads_mensile. Non si concede anon sulle basi.
-- Sorgente dati: edge di ingest dedicata (ads-sync), non la write-api. Account act_686034712784477.

-- 0) Token Meta in app_config (come shopify_token): colonna additiva, valore messo dall'owner.
--    Se resta null, l'edge ads-sync non pulla e lo dichiara in health_log (nessun errore).
alter table app_config add column if not exists meta_token text;

-- 1) Metriche giornaliere per AD/creativita' (level=ad su Meta insights).
create table if not exists meta_ads_creative_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  account_id text,
  campaign_id text,
  campaign_name text,
  campaign_objective text,
  adset_id text,
  adset_name text,
  ad_id text not null,
  ad_name text,
  ad_status text,                 -- effective_status al momento del pull
  creative_id text,
  spend numeric(12,2),
  impressions bigint,
  reach bigint,
  frequency numeric(10,4),
  clicks bigint,
  link_clicks bigint,             -- inline_link_clicks
  ctr numeric(10,4),
  cpc numeric(10,4),
  cpm numeric(10,4),
  landing_page_views bigint,
  view_content bigint,
  add_to_cart bigint,
  initiate_checkout bigint,
  add_payment_info bigint,
  purchases bigint,
  purchase_value numeric(12,2),
  cpa numeric(12,4),
  roas numeric(12,4),
  pulled_at timestamptz,
  source text default 'ads-sync',
  created_at timestamptz default now() not null,
  -- idempotenza a DB (Regola Ferrea 20): un solo record per ad per giorno, upsert su re-pull
  constraint meta_ads_creative_daily_uk unique (date, ad_id)
);
create index if not exists meta_ads_creative_daily_date_idx on meta_ads_creative_daily using btree (date, ad_id);
create index if not exists meta_ads_creative_daily_campaign_idx on meta_ads_creative_daily using btree (campaign_id, date);

-- 2) Anagrafica creativa: una riga per ad, upsertata a ogni giro.
--    Qui vive l'aggancio al catalogo (product_set_id) e la destinazione.
create table if not exists meta_ad_creative (
  ad_id text primary key,
  creative_id text,
  ad_name text,
  adset_id text,
  campaign_id text,
  object_type text,               -- SHARE, VIDEO, ...
  title text,
  thumbnail_url text,
  link text,                      -- destinazione (spesso fb.com/canvas_doc/... per i catalog)
  url_tags text,                  -- utm_* usati per riconciliare Meta vs Shopify
  product_set_id text,            -- aggancio catalogo Meta (mapping primario)
  catalog_id text,
  effective_status text,
  first_seen timestamptz default now() not null,
  last_seen timestamptz,
  updated_at timestamptz default now() not null
);
create index if not exists meta_ad_creative_product_set_idx on meta_ad_creative using btree (product_set_id);

-- 3) Mappa product_set -> prodotto catalogo -> codice_norm dell'app.
--    Popolata dal catalogo Meta (retailer_id = id/SKU Shopify) e risolta su codice_norm.
create table if not exists meta_product_set_map (
  id uuid primary key default gen_random_uuid(),
  product_set_id text not null,
  catalog_id text,
  retailer_id text not null,      -- id/SKU lato Shopify come sta nel catalogo Meta
  codice_norm text,               -- risolto sul catalogo app; null finche' non mappa
  product_name text,
  availability text,              -- disponibilita' dichiarata dal catalogo Meta (se presente)
  last_seen timestamptz,
  created_at timestamptz default now() not null,
  constraint meta_product_set_map_uk unique (product_set_id, retailer_id)
);
create index if not exists meta_product_set_map_set_idx on meta_product_set_map using btree (product_set_id);
create index if not exists meta_product_set_map_codice_idx on meta_product_set_map using btree (codice_norm);

-- RLS: attiva su tutte e tre. Nessuna policy + nessun grant anon => leggibili solo da
-- service_role (che bypassa RLS). Il frontend leggera' dalle viste, non da queste tabelle.
alter table meta_ads_creative_daily enable row level security;
alter table meta_ad_creative        enable row level security;
alter table meta_product_set_map    enable row level security;

grant select, insert, update, delete on meta_ads_creative_daily to service_role;
grant select, insert, update, delete on meta_ad_creative        to service_role;
grant select, insert, update, delete on meta_product_set_map    to service_role;

-- C2 (audit gate 2026-09-18): `create table if not exists` salta in silenzio i vincoli se la tabella esiste gia'
-- senza; l'edge fa upsert proprio su questi vincoli (onConflict) e senza di essi fallirebbe a runtime (42P10).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'meta_ads_creative_daily_uk') then raise exception 'vincolo mancante: meta_ads_creative_daily_uk'; end if;
  if not exists (select 1 from pg_constraint where conname = 'meta_product_set_map_uk') then raise exception 'vincolo mancante: meta_product_set_map_uk'; end if;
  if not exists (select 1 from pg_constraint where conname = 'meta_ad_creative_pkey') then raise exception 'vincolo mancante: meta_ad_creative_pkey'; end if;
end $$;

comment on table meta_ads_creative_daily is 'Amimì Ads: metriche giornaliere per ad/creativita'' (level=ad). Scritta da edge ads-sync. ad_status/creative_id riservati (null in v1: insights level=ad non li espone).';
comment on table meta_ad_creative is 'Amimì Ads: anagrafica per ad, con aggancio catalogo (product_set_id) e destinazione.';
comment on table meta_product_set_map is 'Amimì Ads: mappa product_set Meta -> retailer_id -> codice_norm app.';
