-- 0002 — transactional tables (faithful load; year/month loaded as-is to match the CE SUMIFS)
--
-- Same philosophy as 0001: load history faithfully, flag don't reject. UNIQUE constraints
-- that would reject known-duplicate history (e.g. Qromo re-sync dups) are intentionally
-- OMITTED here and enforced on the write path instead; duplicates are flagged by health views.

-- ===== purchases (ACQUISTI) — inventory source of truth =====
create table purchases (
  id              uuid primary key default gen_random_uuid(),
  id_acquisto     text,
  codice          text,
  codice_norm     text generated always as (upper(regexp_replace(coalesce(codice,''), '\s+', '_', 'g'))) stored,
  data            date,
  tipologia       text,            -- 'Prodotto Finito' seeds inventory
  categoria       text,
  item            text,
  variant         text,
  quantita        numeric,
  unita_misura    text,
  costo_unitario  numeric(12,2),
  costo_totale    numeric(14,2) generated always as (round(coalesce(quantita,0) * coalesce(costo_unitario,0), 2)) stored,
  fornitore       text,
  online          int,
  source          text default 'etl',
  chi             text,
  created_at      timestamptz not null default now()
);
create index purchases_codice_idx on purchases (codice_norm);
create index purchases_data_idx   on purchases (data);

-- ===== shopify orders / line items (from DB Shopify, 79 cols normalized) =====
create table shopify_orders (
  id               uuid primary key default gen_random_uuid(),
  order_id         text,
  order_number     text,
  created_at_shop  timestamptz,
  customer_name    text,
  email            text,
  financial_status text,
  fulfillment_status text,
  gross_total      numeric(12,2),
  net_total        numeric(12,2),
  discount_total   numeric(12,2),
  shipping_total   numeric(12,2),
  payment_fees     numeric(12,2),
  refund_amount    numeric(12,2),
  free_shipping    boolean,
  currency         text,
  year             int,
  month            int,
  raw              jsonb,
  synced_at        timestamptz not null default now()
);
create index shopify_orders_orderid_idx on shopify_orders (order_id);
create index shopify_orders_ym_idx      on shopify_orders (year, month);

create table shopify_line_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       text,
  lineitem_name  text,
  codice         text,
  codice_norm    text generated always as (upper(regexp_replace(coalesce(codice,''), '\s+', '_', 'g'))) stored,
  resolved       boolean,
  quantita       numeric,
  price          numeric(12,2),
  cogs_snapshot  numeric(12,2),
  year           int,
  month          int,
  created_at     timestamptz not null default now()
);
create index shopify_li_orderid_idx on shopify_line_items (order_id);
create index shopify_li_codice_idx  on shopify_line_items (codice_norm);
create index shopify_li_ym_idx      on shopify_line_items (year, month);

-- ===== qromo_sales (DB_QROMO) — paid amount, resolver-enriched =====
create table qromo_sales (
  id              uuid primary key default gen_random_uuid(),
  order_id        text,
  sale_id         text,
  data            date,
  year            int,
  month           int,
  nome            text,
  cognome         text,
  codice          text,
  codice_norm     text generated always as (upper(regexp_replace(coalesce(codice,''), '\s+', '_', 'g'))) stored,
  item            text,
  variant         text,
  quantita        numeric,
  payment_method  text,
  prezzo          numeric(12,2),   -- PAID amount (total_value/qty), not catalog
  cogs            numeric(12,2),
  resolver_status text,            -- resolved / cogs_missing / unresolved / skip
  note            text,
  source          text default 'etl',
  created_at      timestamptz not null default now()
);
create index qromo_codice_idx on qromo_sales (codice_norm);
create index qromo_ym_idx      on qromo_sales (year, month);
create index qromo_dedup_idx   on qromo_sales (order_id, codice_norm);

-- ===== b2b_movements (DB_B2B) — only 'venduto' hits the CE; revenue = incasso_amimi =====
create table b2b_movements (
  id              uuid primary key default gen_random_uuid(),
  mov_id          text,
  data            date,
  year            int,
  month           int,
  codice          text,
  codice_norm     text generated always as (upper(regexp_replace(coalesce(codice,''), '\s+', '_', 'g'))) stored,
  quantita        numeric,
  modello         text,            -- conto_vendita / wholesale
  tipo_movimento  text,            -- invio / reso / venduto
  negozio         text,
  prezzo_retail   numeric(12,2),
  perc_negozio    numeric(6,4),
  retail_tot      numeric(14,2) generated always as (round(coalesce(prezzo_retail,0) * coalesce(quantita,0), 2)) stored,
  quota_negozio   numeric(14,2) generated always as (round(coalesce(prezzo_retail,0) * coalesce(quantita,0) * coalesce(perc_negozio,0), 2)) stored,
  incasso_amimi   numeric(14,2) generated always as (round(coalesce(prezzo_retail,0) * coalesce(quantita,0) * (1 - coalesce(perc_negozio,0)), 2)) stored,
  cogs            numeric(12,2),
  stato           text,
  note            text,
  source          text default 'etl',
  created_at      timestamptz not null default now()
);
create index b2b_codice_idx on b2b_movements (codice_norm);
create index b2b_ym_idx      on b2b_movements (year, month);

-- ===== gifts_offline (GIFT_OFFLINE) — prezzo is a ROW TOTAL (quirk); cogs is per-unit =====
create table gifts_offline (
  id              uuid primary key default gen_random_uuid(),
  gift_id         text,
  year            int,
  month           int,
  data            date,
  nome            text,
  cognome         text,
  codice          text,
  codice_norm     text generated always as (upper(regexp_replace(coalesce(codice,''), '\s+', '_', 'g'))) stored,
  quantita        numeric,
  payment_method  text,
  prezzo          numeric(12,2),   -- ROW TOTAL (CE_TOTALE sums this directly, NOT x qty)
  cogs            numeric(12,2),   -- per-UNIT (the documented quirk -> corrected overlay)
  nota            text,
  item            text,
  variant         text,
  kind            text,            -- gift / conta_rettifica
  source          text default 'etl',
  created_at      timestamptz not null default now()
);
create index gifts_codice_idx on gifts_offline (codice_norm);
create index gifts_ym_idx      on gifts_offline (year, month);

-- ===== expenses (EXPENSES MASTER) — COSTO is NEGATIVE; amimi filter = lowercase 'si' =====
create table expenses (
  id              uuid primary key default gen_random_uuid(),
  year            int,
  month           int,
  date_reported   date,
  date_paid       date,
  operazione      text,
  costo           numeric(12,2),   -- NEGATIVE for costs
  categoria       text,
  categoria_valid boolean generated always as (
                    categoria = any (array['COGS','LOGISTICA','MARKETING','OPEX','PACKAGING','SALARI','TASSE'])
                  ) stored,
  sottocategoria  text,
  amimi_raw       text,
  amimi           boolean generated always as (amimi_raw = 'si') stored,   -- exact lowercase
  note            text,
  source          text default 'etl',
  created_at      timestamptz not null default now()
);
create index expenses_ym_idx  on expenses (year, month);
create index expenses_cat_idx on expenses (categoria);

-- ===== counts (CONTA_INBOX staging) =====
create table counts (
  id           uuid primary key default gen_random_uuid(),
  ts           timestamptz not null default now(),
  data_conta   date,
  codice       text,
  modello      text,
  variante     text,
  contati      numeric,
  giac_snapshot numeric,
  delta        numeric,
  chi          text,
  nota         text,
  stato        text,
  source       text default 'app',
  created_at   timestamptz not null default now()
);
create index counts_codice_idx on counts (codice);

-- ===== meta_ads_daily (META_ADS_DAILY, 24 cols A-X) =====
create table meta_ads_daily (
  id                uuid primary key default gen_random_uuid(),
  date              date,
  campaign_id       text,
  campaign_name     text,
  campaign_status   text,
  campaign_objective text,
  spend             numeric(12,2),
  impressions       bigint,
  reach             bigint,
  frequency         numeric(10,4),
  clicks            bigint,
  link_clicks       bigint,
  ctr               numeric(10,4),
  cpc               numeric(10,4),
  cpm               numeric(10,4),
  landing_page_views bigint,
  view_content      bigint,
  add_to_cart       bigint,
  initiate_checkout bigint,
  add_payment_info  bigint,
  purchases         bigint,
  purchase_value    numeric(12,2),
  cpa               numeric(12,4),
  roas              numeric(12,4),
  pulled_at         timestamptz,
  source            text default 'etl',
  created_at        timestamptz not null default now()
);
create index meta_ads_date_idx on meta_ads_daily (date, campaign_id);
