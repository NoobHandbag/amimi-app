-- 0176: v_ads_mensile sulla serie viva (richiesta owner 28-10-2026). Dal 18-09 l'ingest Meta e' ads-sync ->
-- meta_ads_creative_daily (livello ad, dal 2026-06-20, ogni giorno); meta_ads_daily (livello campagna, seed ETL
-- 2026-04-23..2026-07-01) e' ferma. v_ads_mensile leggeva solo meta_ads_daily: il tool MCP ads_summary (e ask_data)
-- rispondeva aprile-luglio come se fosse l'oggi.
--  (a) v_ads_mensile: regola PER GIORNO. Un giorno con almeno una riga in meta_ads_creative_daily si legge da ads-sync,
--      un giorno senza righe per ad si legge da meta_ads_daily (Gate 2, M176-1: un taglio unico su min(date) avrebbe
--      tolto da entrambe le serie i giorni vecchi dopo un backfill non contiguo prima del 20-06). Nessun giorno contato
--      due volte: oggi giugno 2026 = 01-19 dalla serie vecchia + 20-30 da ads-sync. Le 8 colonne di prima con stessi
--      nomi, ordine e tipi, stessa regola del roas (0 a spesa 0), stesso order by; due colonne IN CODA: fonte
--      ('ads-sync', 'meta_ads_daily', 'misto' se il mese le mescola) e ultimo_giorno (ultimo giorno con dati nel mese).
--      clicks = tutti i click in entrambe le serie (sui 12 giorni in comune, 20-06..01-07, scarto massimo 1 click e 3
--      centesimi di spesa al giorno, acquisti uguali). purchases = acquisti attribuiti da Meta, non ordini Shopify.
--      not exists sull'indice unico (date, ad_id). create or replace tiene owner (postgres: vista coi diritti del
--      proprietario, legge la base con RLS senza policy) e grant (anon, authenticated, ask_ro). Nessuna vista o
--      funzione dipende da lei (pg_depend e prosrc, 28-10).
--  (b) ask_ro (ask_select: ask_data, "Chiedi ad Amimi'", tool MCP ask_data) legge le quattro viste Ads vive. Sono di
--      postgres come v_ads_mensile e anon le legge gia': ask_ro non vede nulla che la chiave pubblica non veda. Nessun
--      grant sulle basi meta_* (meta_ads_creative_daily resta chiusa: RLS senza policy).
-- Prova viva: tests/ads_mensile_viste.sql. Rollback: create or replace non toglie colonne. Per tornare alla 0020: drop
-- view v_ads_mensile, corpo della 0020, grant select ad anon, authenticated e ask_ro; revoke select sulle quattro viste
-- da ask_ro.
begin;

-- (a) serie mensile: per ogni giorno ads-sync se c'e', altrimenti la serie vecchia
create or replace view v_ads_mensile as
 with giorni as (
   select l.date, l.spend, l.impressions, l.clicks, l.purchases, l.purchase_value, 'meta_ads_daily'::text as fonte
     from meta_ads_daily l
    where not exists (select 1 from meta_ads_creative_daily c where c.date = l.date)
   union all
   select c.date, c.spend, c.impressions, c.clicks, c.purchases, c.purchase_value, 'ads-sync'::text
     from meta_ads_creative_daily c
 )
 select extract(year from date)::integer as year,
        extract(month from date)::integer as month,
        round(sum(coalesce(spend, 0::numeric)), 2) as spend,
        sum(coalesce(impressions, 0::bigint)) as impressions,
        sum(coalesce(clicks, 0::bigint)) as clicks,
        sum(coalesce(purchases, 0::bigint)) as purchases,
        round(sum(coalesce(purchase_value, 0::numeric)), 2) as purchase_value,
        case when sum(coalesce(spend, 0::numeric)) > 0::numeric
             then round(sum(coalesce(purchase_value, 0::numeric)) / sum(coalesce(spend, 0::numeric)), 2)
             else 0::numeric end as roas,
        case when min(fonte) = max(fonte) then min(fonte) else 'misto'::text end as fonte,
        max(date) as ultimo_giorno
   from giorni
  group by (extract(year from date)::integer), (extract(month from date)::integer)
  order by (extract(year from date)::integer), (extract(month from date)::integer);
comment on view v_ads_mensile is 'Amimì Ads per mese (spesa, impression, click, acquisti e valore attribuiti da Meta, ROAS). Per ogni giorno legge ads-sync (meta_ads_creative_daily, livello ad, aggiornata ogni giorno, dal 2026-06-20) se ha righe, altrimenti meta_ads_daily (seed ETL a livello campagna, ferma al 01-07). Nessun giorno contato due volte. fonte = ads-sync, meta_ads_daily o misto (mese con giorni delle due serie); ultimo_giorno = ultimo giorno con dati nel mese. Migr 0176.';

-- (b) ask_ro legge le viste Ads vive (aggregati per oggetto, gia' leggibili da anon); mai le basi meta_*
grant select on v_ads_periodo_14g, v_ads_swap, v_ads_weekly_account, v_ads_creative_status to ask_ro;

commit;
