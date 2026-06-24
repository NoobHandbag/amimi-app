-- 0001 — core anagrafica + audit + config
--
-- PHILOSOPHY (binding, per DECISIONS D14/D15): base tables load the Google Sheet
-- FAITHFULLY. We do NOT reject messy historical rows with strict types/FKs — that would
-- break "match the Sheet 1:1". Instead we load leniently, add generated *_norm / *_valid
-- helper columns, and SURFACE problems via health views + the corrected overlay. Strict
-- integrity (enums, required fields, referential checks) is enforced on the WRITE path
-- (Edge Functions) for NEW entries, not on the historical ETL.

create extension if not exists pgcrypto;

-- normalization helper: UPPER + collapse whitespace to "_" (mirrors resolveCodice_ norm)
create or replace function norm_codice(t text) returns text
  language sql immutable as $$ select upper(regexp_replace(coalesce(t,''), '\s+', '_', 'g')) $$;

-- ===== suppliers (Fornitori — small set, card pickers) =====
create table suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text,                 -- pelle / tessuto / accessori / ...
  notes       text,
  created_at  timestamptz not null default now()
);

-- ===== negozi (B2B / conto-vendita shops) =====
create table negozi (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  perc_default  numeric(6,4),
  notes         text,
  created_at    timestamptz not null default now()
);

-- ===== products (one row per CODICE_AMIIMI; sourced from PRODUCT_COGS&PRICE) =====
create table products (
  id            uuid primary key default gen_random_uuid(),
  codice        text not null,
  codice_norm   text generated always as (upper(regexp_replace(coalesce(codice,''), '\s+', '_', 'g'))) stored,
  -- a CODICE ending in "_" is an unfinalized variant (REGOLE_FERREE §6)
  is_finalized  boolean generated always as (coalesce(codice,'') <> '' and right(coalesce(codice,''),1) <> '_') stored,
  model         text,
  variant       text,
  item          text,
  categoria     text,
  shopify_name  text,
  shopify_sku   text,
  retail_price  numeric(12,2),   -- VAT-inclusive (PCP col D)
  cogs          numeric(12,2),   -- ex-VAT / net (PCP col E)
  description   text,
  seo_title     text,
  image_url     text,
  status        text,
  notes         text,
  source        text default 'etl',
  chi           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint products_codice_unique unique (codice)
);
create index products_codice_norm_idx on products (codice_norm);

-- ===== product_aliases (PRODUCT_MAP: Shopify site name -> CODICE) =====
-- NOT unique on shopify_name: one name -> two different codici is a real bug we FLAG, not block.
-- NOT FK on codice: PRODUCT_MAP legitimately holds codes not yet in PCP (~94) — load + flag.
create table product_aliases (
  id                 uuid primary key default gen_random_uuid(),
  shopify_name       text not null,
  shopify_name_norm  text generated always as (upper(regexp_replace(coalesce(shopify_name,''), '\s+', '_', 'g'))) stored,
  codice             text not null,
  source             text default 'etl',
  created_at         timestamptz not null default now()
);
create index product_aliases_name_idx   on product_aliases (shopify_name_norm);
create index product_aliases_codice_idx on product_aliases (codice);

-- non-product POS codes (Gift Card, etc.) — resolver skips these
create table non_product_codici (
  codice text primary key
);
insert into non_product_codici (codice) values ('GIFT_CARD') on conflict do nothing;

-- ===== change_log (full audit trail; every write lands here) =====
create table change_log (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  tbl     text not null,
  row_id  text,
  op      text not null,            -- insert / update / delete
  before  jsonb,
  after   jsonb,
  chi     text,                     -- Ale / Benedetta (non-login picklist, DECISIONS D10)
  source  text                      -- form name / etl / sync job
);
create index change_log_tbl_idx on change_log (tbl, ts);

-- ===== app_config (singleton settings row) =====
create table app_config (
  id                    int primary key default 1,
  pin_hash              text,
  ai_enabled            boolean not null default false,   -- AI brain out of v1 (DECISIONS D11)
  live_sync_enabled     boolean not null default false,   -- external syncs off until cutover
  corrections_adopted   text[] not null default '{}',     -- which corrected-overlay fixes are live
  iva_rate              numeric(6,4) not null default 0.22,
  parity_tolerance_cents int not null default 1,
  updated_at            timestamptz not null default now(),
  constraint app_config_singleton check (id = 1)
);
insert into app_config (id) values (1) on conflict do nothing;
