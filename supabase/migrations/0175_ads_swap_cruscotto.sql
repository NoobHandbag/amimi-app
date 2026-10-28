-- 0175: Cruscotto Ads, quando cambiare una creativita' (decisione owner 28-10-2026). Additiva, modulo Ads (0128-0134).
-- Metriche decise per campagna, adset e creativita': ROAS, frequency, click, CTR link (link click / impression, NON tutti
-- i click), CPA contro il pareggio di 76,70 EUR (obiettivo 45), CPM, funnel dopo il click (LPV per link click, carrelli
-- per LPV), hook rate dei video (visualizzazioni da 3 secondi / impression, solo video).
--  (a) meta_ads_creative_daily: video_3s_views e thruplays, scritte da ads-sync v1.4 (null = riga letta prima).
--  (b) meta_ads_window_reach: reach DEDUPLICATA delle due finestre di 14 giorni per account, campagna, adset e ad. La
--      reach non si somma fra giorni: la frequency di 14 giorni esiste solo da una chiamata insights sulla finestra.
--      La scrive ads-sync v1.4 (upsert sulla PK); RLS on senza policy, come le altre meta_ad*.
--  (c) v_ads_periodo_14g: ultimi 14 giorni contro i 14 prima, per account, campagna, adset e ad.
--  (d) v_ads_swap: una riga per ad attivo o con spesa negli ultimi 14 giorni, con la regola di cambio creativita'.
--  (e) v_fonti_freschezza: una colonna IN CODA, meta_ads_creative_ultimo_giorno (Gate 2 X1).
-- Finestre ancorate ad as_of = max(date) di meta_ads_creative_daily (ieri, Roma, se il cron gira): cur14 = as_of-13..as_of,
-- prev14 = as_of-27..as_of-14, _7 = date > as_of-7, _14 = date > as_of-14.
-- Nessun'altra tabella o vista esistente cambia definizione (v_ads_creative_status resta per la tab Ads). Le due viste
-- nuove sono di postgres come le altre v_ads_*: leggono le basi chiuse e danno ad anon solo righe aggregate per oggetto.
-- Rollback: drop view v_ads_swap, v_ads_periodo_14g; drop table meta_ads_window_reach. Le due colonne video e la colonna
-- in coda a v_fonti_freschezza possono restare (create or replace non toglie colonne: per toglierla drop e create del
-- corpo della 0109, poi grant select ad anon, authenticated e ask_ro).
begin;

-- (a) video: null = riga letta prima di ads-sync v1.4 (le viste contano solo i giorni misurati)
alter table meta_ads_creative_daily add column if not exists video_3s_views numeric;
alter table meta_ads_creative_daily add column if not exists thruplays numeric;
comment on column meta_ads_creative_daily.video_3s_views is 'Visualizzazioni da 3 secondi (actions video_view). Null = riga letta prima di ads-sync v1.4.';
comment on column meta_ads_creative_daily.thruplays is 'ThruPlay (video_thruplay_watched_actions video_view). Null = riga letta prima di ads-sync v1.4.';

-- (b) reach deduplicata per finestra. object_id = act_686034712784477 per l'account, altrimenti id di campagna/adset/ad.
create table if not exists meta_ads_window_reach (
  level text not null check (level in ('account', 'campaign', 'adset', 'ad')),
  object_id text not null,
  window_key text not null check (window_key in ('cur14', 'prev14')),
  since date not null,
  until date not null,
  reach numeric,
  impressions numeric,
  frequency numeric,
  spend numeric,
  updated_at timestamptz default now() not null,
  primary key (level, object_id, window_key)
);
alter table meta_ads_window_reach enable row level security;
grant select, insert, update, delete on meta_ads_window_reach to service_role;
comment on table meta_ads_window_reach is 'Amimì Ads: reach deduplicata delle finestre cur14/prev14 per account, campagna, adset e ad (una chiamata insights per finestra). Scritta da ads-sync v1.4; le viste la usano solo se since/until coincidono con la finestra.';

-- C2 (come 0128): `create table if not exists` salta in silenzio la PK se la tabella esiste gia' senza; l'upsert
-- dell'edge (onConflict level,object_id,window_key) fallirebbe a runtime (42P10).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'meta_ads_window_reach_pkey') then raise exception 'vincolo mancante: meta_ads_window_reach_pkey'; end if;
end $$;

-- (c) periodo 14g contro 14g: una riga per (level, window_key, object_id), entrambe le finestre presenti (zeri se vuota)
--     per ogni oggetto con impression in almeno una delle due.
create or replace view v_ads_periodo_14g as
 with ref as (select max(date) as d from meta_ads_creative_daily),
 fin as (
   select 'cur14'::text as window_key, r.d - 13 as since, r.d as until, r.d as as_of from ref r
   union all
   select 'prev14'::text, r.d - 27, r.d - 14, r.d from ref r
 ),
 righe as (
   -- ogni riga ad-giorno conta per i quattro livelli
   select f.window_key, l.level, l.object_id, l.campaign_id, l.adset_id,
     d.date, d.spend, d.impressions, d.clicks, d.link_clicks, d.landing_page_views, d.add_to_cart,
     d.initiate_checkout, d.purchases, d.purchase_value, d.video_3s_views, d.thruplays
   from meta_ads_creative_daily d
   join fin f on d.date between f.since and f.until
   cross join lateral (values
     ('account'::text, d.account_id, null::text, null::text),
     ('campaign', d.campaign_id, d.campaign_id, null),
     ('adset', d.adset_id, d.campaign_id, d.adset_id),
     ('ad', d.ad_id, d.campaign_id, d.adset_id)
   ) as l(level, object_id, campaign_id, adset_id)
   where l.object_id is not null
 ),
 agg as (
   select window_key, level, object_id,
     sum(spend) as spend, sum(impressions) as impressions, sum(clicks) as clicks, sum(link_clicks) as link_clicks,
     sum(landing_page_views) as landing_page_views, sum(add_to_cart) as add_to_cart,
     sum(initiate_checkout) as initiate_checkout, sum(purchases) as purchases, sum(purchase_value) as purchase_value,
     sum(video_3s_views) as video_3s_views,
     sum(thruplays) as thruplays,
     -- hook e hold solo sui giorni misurati (le righe di prima della v1.4 hanno null)
     sum(impressions) filter (where video_3s_views is not null) as impr_video,
     sum(video_3s_views) filter (where thruplays is not null) as v3s_hold,
     sum(thruplays) filter (where video_3s_views is not null) as thru_hold,
     count(distinct date) filter (where spend > 0) as days_with_spend
   from righe
   group by window_key, level, object_id
 ),
 oggetti as (
   select level, object_id, max(campaign_id) as campaign_id, max(adset_id) as adset_id
   from righe
   group by level, object_id
   having sum(impressions) > 0
 ),
 -- nomi piu' recenti (una campagna rinominata prende il nome dell'ultimo giorno)
 nomi_camp as (
   select distinct on (campaign_id) campaign_id, campaign_name from meta_ads_creative_daily
   where campaign_id is not null order by campaign_id, date desc
 ),
 nomi_adset as (
   select distinct on (adset_id) adset_id, adset_name from meta_ads_creative_daily
   where adset_id is not null order by adset_id, date desc
 ),
 nomi_ad as (
   select distinct on (ad_id) ad_id, ad_name from meta_ads_creative_daily order by ad_id, date desc
 ),
 x as (
   select o.level, f.window_key, f.since, f.until, f.as_of, o.object_id,
     case o.level when 'account' then 'Totale account' when 'campaign' then nc.campaign_name
                  when 'adset' then ns.adset_name else coalesce(c.ad_name, na.ad_name) end as object_name,
     o.campaign_id, nc.campaign_name, o.adset_id, ns.adset_name,
     case when o.level = 'ad' then c.object_type end as object_type,
     case when o.level = 'ad' then c.effective_status end as effective_status,
     coalesce(a.spend, 0) as spend, coalesce(a.impressions, 0) as impressions,
     wr.reach, round(wr.frequency, 2) as frequency,
     coalesce(a.clicks, 0) as clicks, coalesce(a.link_clicks, 0) as link_clicks,
     coalesce(a.landing_page_views, 0) as landing_page_views, coalesce(a.add_to_cart, 0) as add_to_cart,
     coalesce(a.initiate_checkout, 0) as initiate_checkout, coalesce(a.purchases, 0) as purchases,
     coalesce(a.purchase_value, 0) as purchase_value,
     a.video_3s_views, a.thruplays, a.impr_video, a.v3s_hold, a.thru_hold,
     coalesce(a.days_with_spend, 0) as days_with_spend
   from oggetti o
   cross join fin f
   left join agg a on a.level = o.level and a.object_id = o.object_id and a.window_key = f.window_key
   left join nomi_camp nc on nc.campaign_id = o.campaign_id
   left join nomi_adset ns on ns.adset_id = o.adset_id
   left join nomi_ad na on o.level = 'ad' and na.ad_id = o.object_id
   left join meta_ad_creative c on o.level = 'ad' and c.ad_id = o.object_id
   -- la reach vale solo se e' stata letta proprio su questa finestra (cron fermo = finestre diverse = null)
   left join meta_ads_window_reach wr on wr.level = o.level and wr.object_id = o.object_id and wr.window_key = f.window_key
     and wr.since = f.since and wr.until = f.until
 )
 select level, window_key, since, until, as_of, object_id, object_name, campaign_id, campaign_name, adset_id, adset_name,
   object_type, effective_status, spend, impressions, reach, frequency, clicks, link_clicks,
   round(100.0 * link_clicks / nullif(impressions, 0), 2) as link_ctr,
   round(spend / nullif(link_clicks, 0), 2) as cpc_link,
   round(1000.0 * spend / nullif(impressions, 0), 2) as cpm,
   landing_page_views,
   round(100.0 * landing_page_views / nullif(link_clicks, 0), 1) as lpv_rate,
   add_to_cart,
   round(100.0 * add_to_cart / nullif(landing_page_views, 0), 1) as atc_rate,
   initiate_checkout, purchases, purchase_value,
   round(purchase_value / nullif(spend, 0), 2) as roas,
   round(spend / nullif(purchases, 0), 2) as cpa,
   video_3s_views,
   case when level = 'ad' and object_type = 'VIDEO' and impr_video >= 500
        then round(100.0 * video_3s_views / impr_video, 1) end as hook_rate,
   thruplays,
   round(100.0 * thru_hold / nullif(v3s_hold, 0), 1) as hold_rate,
   days_with_spend
 from x;
grant select on v_ads_periodo_14g to anon, authenticated;
comment on view v_ads_periodo_14g is 'Amimì Ads: ultimi 14 giorni (cur14) contro i 14 prima (prev14) per account, campagna, adset e ad. frequency/reach solo da meta_ads_window_reach sulla stessa finestra. Migr 0175.';

-- (d) quando cambiare una creativita'. Regola (owner 28-10-2026):
--   pubblico = retargeting se campagna o adset ~* '(super hot|\mhot\M|warm|rtg|retarget|remarketing|re-?eng)',
--   altrimenti cold (C3: anche hot come parola intera, warm e remarketing; i nomi vivi del 28-10 restano classificati
--   come prima); soglia frequency 4,0 retargeting e 2,5 cold. segnale_freq = freq_7g (vera, meta_ad_freq7 del giorno
--   as_of) >= soglia.
--   freq_mancante (B1): ad ACTIVE con almeno 300 impression in 7g senza frequency letta per as_of (freq7 fallita o in
--   ritardo, join stretto su day = as_of): il segnale non e' valutato e il motivo lo dice, mai "sotto soglia".
--   freq_al = ultimo giorno letto in meta_ad_freq7, uguale su ogni riga.
--   base = giorni dell'ad in [first_day, first_day + 13] e <= as_of - 7 (first_day = primo giorno con spesa NEI DATI,
--   lo storico parte dal 20-06-2026). segnale_ctr = impression 7g >= 1.000, impression base >= 1.000, CTR link base > 0
--   (B2: una base senza click non si confronta) e CTR link 7g <= 0,75 x CTR link base. segnale_spesa = spesa 14g >=
--   76,70 (pareggio) senza acquisti in 14g.
--   stato: non ACTIVE = in_pausa; spesa, oppure frequency E CTR = cambia; frequency O CTR = osserva; < 300 impression
--   in 7g = senza_consegna; base < 1.000 impression in un ad con meno di 21 giorni (la base non e' ancora completa
--   fuori dagli ultimi 7) = nuova; altrimenti ok.
-- "nuova" vuole anche l'ad giovane: Raccolta 1 e 2 (dal 20-22/06, retargeting) hanno solo 915 e 896 impression nei
-- primi 14 giorni ma 4 mesi di storia; sono ok, col CTR dichiarato non confrontabile nel motivo (prova del 28-10).
-- I segnali si calcolano sui valori arrotondati che la card mostra (frequency e CTR a 2 decimali).
create or replace view v_ads_swap as
 with ref as (select max(date) as d from meta_ads_creative_daily),
 k as (
   select 4.0 as freq_rtg, 2.5 as freq_cold, 76.70 as pareggio, 0.75 as ctr_calo,
     1000 as impr_min, 300 as impr_consegna, 500 as impr_hook, 10 as quota_min, 21 as giorni_base
 ),
 freq_ult as (select max(day) as d from meta_ad_freq7),
 elenco as (
   select ad_id from meta_ad_creative where effective_status = 'ACTIVE'
   union
   select d.ad_id from meta_ads_creative_daily d cross join ref r where d.date > r.d - 14 and d.spend > 0
 ),
 primo as (
   select ad_id, min(date) filter (where spend > 0) as first_day from meta_ads_creative_daily group by ad_id
 ),
 nomi_ad as (
   select distinct on (ad_id) ad_id, ad_name, campaign_id, adset_id from meta_ads_creative_daily order by ad_id, date desc
 ),
 nomi_camp as (
   select distinct on (campaign_id) campaign_id, campaign_name from meta_ads_creative_daily
   where campaign_id is not null order by campaign_id, date desc
 ),
 nomi_adset as (
   select distinct on (adset_id) adset_id, adset_name from meta_ads_creative_daily
   where adset_id is not null order by adset_id, date desc
 ),
 adset_7 as (
   select d.adset_id, sum(d.spend) as spend_7 from meta_ads_creative_daily d cross join ref r
   where d.date > r.d - 7 group by d.adset_id
 ),
 m as (
   select e.ad_id,
     sum(d.spend)          filter (where d.date > r.d - 7)  as spend_7,
     sum(d.impressions)    filter (where d.date > r.d - 7)  as impressions_7,
     sum(d.link_clicks)    filter (where d.date > r.d - 7)  as link_clicks_7,
     sum(d.video_3s_views) filter (where d.date > r.d - 7)  as v3s_7,
     sum(d.impressions)    filter (where d.date > r.d - 7 and d.video_3s_views is not null) as impr_video_7,
     sum(d.spend)          filter (where d.date > r.d - 14) as spend_14,
     sum(d.purchases)      filter (where d.date > r.d - 14) as purchases_14,
     sum(d.purchase_value) filter (where d.date > r.d - 14) as value_14,
     sum(d.spend)          filter (where d.date between p.first_day and p.first_day + 13 and d.date <= r.d - 7) as spend_base,
     sum(d.impressions)    filter (where d.date between p.first_day and p.first_day + 13 and d.date <= r.d - 7) as impressions_base,
     sum(d.link_clicks)    filter (where d.date between p.first_day and p.first_day + 13 and d.date <= r.d - 7) as link_clicks_base,
     sum(d.video_3s_views) filter (where d.date between p.first_day and p.first_day + 13 and d.date <= r.d - 7) as v3s_base,
     sum(d.impressions)    filter (where d.date between p.first_day and p.first_day + 13 and d.date <= r.d - 7
                                     and d.video_3s_views is not null) as impr_video_base
   from elenco e
   cross join ref r
   left join primo p on p.ad_id = e.ad_id
   left join meta_ads_creative_daily d on d.ad_id = e.ad_id
   group by e.ad_id
 ),
 x as (
   select r.d as as_of, e.ad_id,
     coalesce(c.ad_name, na.ad_name) as ad_name,
     coalesce(c.campaign_id, na.campaign_id) as campaign_id, nc.campaign_name,
     coalesce(c.adset_id, na.adset_id) as adset_id, ns.adset_name,
     c.effective_status, c.object_type, c.frame_url, c.image_url, c.thumbnail_url,
     p.first_day, r.d - p.first_day + 1 as giorni_live,
     coalesce(m.spend_7, 0) as spend_7, coalesce(m.impressions_7, 0) as impressions_7,
     round(100.0 * m.link_clicks_7 / nullif(m.impressions_7, 0), 2) as link_ctr_7,
     round(100.0 * m.link_clicks_base / nullif(m.impressions_base, 0), 2) as link_ctr_base,
     coalesce(m.impressions_base, 0) as impressions_base,
     round(1000.0 * m.spend_7 / nullif(m.impressions_7, 0), 2) as cpm_7,
     round(1000.0 * m.spend_base / nullif(m.impressions_base, 0), 2) as cpm_base,
     round(fq.freq_7d, 2) as freq_7g,
     (coalesce(c.effective_status, '') = 'ACTIVE' and coalesce(m.impressions_7, 0) >= k.impr_consegna
      and fq.freq_7d is null) as freq_mancante,
     fu.d as freq_al,
     coalesce(m.spend_14, 0) as spend_14, coalesce(m.purchases_14, 0) as purchases_14, coalesce(m.value_14, 0) as value_14,
     round(m.spend_14 / nullif(m.purchases_14, 0), 2) as cpa_14,
     round(m.value_14 / nullif(m.spend_14, 0), 2) as roas_14,
     case when c.object_type = 'VIDEO' and m.impr_video_7 >= k.impr_hook then round(100.0 * m.v3s_7 / m.impr_video_7, 1) end as hook_7,
     case when c.object_type = 'VIDEO' and m.impr_video_base >= k.impr_hook then round(100.0 * m.v3s_base / m.impr_video_base, 1) end as hook_base,
     round(100.0 * coalesce(m.spend_7, 0) / nullif(a7.spend_7, 0), 1) as quota_adset_7,
     s.pct_oos,
     case when coalesce(nc.campaign_name, '') ~* '(super hot|\mhot\M|warm|rtg|retarget|remarketing|re-?eng)'
            or coalesce(ns.adset_name, '') ~* '(super hot|\mhot\M|warm|rtg|retarget|remarketing|re-?eng)'
          then 'retargeting' else 'cold' end as pubblico
   from elenco e
   cross join ref r
   cross join k
   cross join freq_ult fu
   join m on m.ad_id = e.ad_id
   left join primo p on p.ad_id = e.ad_id
   left join meta_ad_creative c on c.ad_id = e.ad_id
   left join nomi_ad na on na.ad_id = e.ad_id
   left join nomi_camp nc on nc.campaign_id = coalesce(c.campaign_id, na.campaign_id)
   left join nomi_adset ns on ns.adset_id = coalesce(c.adset_id, na.adset_id)
   left join adset_7 a7 on a7.adset_id = coalesce(c.adset_id, na.adset_id)
   -- frequency vera solo se letta per il giorno as_of (un ad fermo tiene la riga vecchia)
   left join meta_ad_freq7 fq on fq.ad_id = e.ad_id and fq.day = r.d
   left join v_ads_set_inventory s on s.product_set_id = c.product_set_id
 ),
 y as (
   select x.*,
     case when x.pubblico = 'retargeting' then k.freq_rtg else k.freq_cold end as freq_soglia,
     round(100.0 * (x.link_ctr_7 / nullif(x.link_ctr_base, 0) - 1)) as ctr_var_pct,
     round(100.0 * (x.cpm_7 / nullif(x.cpm_base, 0) - 1)) as cpm_var_pct
   from x cross join k
 ),
 z as (
   select y.*,
     coalesce(y.freq_7g >= y.freq_soglia, false) as segnale_freq,
     coalesce(y.impressions_7 >= k.impr_min and y.impressions_base >= k.impr_min and y.link_ctr_base > 0
              and y.link_ctr_7 <= k.ctr_calo * y.link_ctr_base, false) as segnale_ctr,
     (y.spend_14 >= k.pareggio and y.purchases_14 = 0) as segnale_spesa
   from y cross join k
 ),
 w as (
   select z.*,
     case
       when coalesce(z.effective_status, '') <> 'ACTIVE' then 'in_pausa'
       when z.segnale_spesa or (z.segnale_freq and z.segnale_ctr) then 'cambia'
       when z.segnale_freq or z.segnale_ctr then 'osserva'
       when z.impressions_7 < k.impr_consegna then 'senza_consegna'
       when z.impressions_base < k.impr_min and coalesce(z.giorni_live, 0) < k.giorni_base then 'nuova'
       else 'ok'
     end as stato
   from z cross join k
 )
 select w.as_of, w.ad_id, w.ad_name, w.campaign_id, w.campaign_name, w.adset_id, w.adset_name, w.effective_status,
   w.object_type, w.frame_url, w.image_url, w.thumbnail_url, w.pubblico, w.first_day, w.giorni_live,
   w.spend_7, w.impressions_7, w.link_ctr_7, w.link_ctr_base, w.impressions_base, w.ctr_var_pct,
   w.cpm_7, w.cpm_base, w.cpm_var_pct, w.freq_7g, w.freq_soglia,
   w.spend_14, w.purchases_14, w.value_14, w.cpa_14, w.roas_14, w.hook_7, w.hook_base, w.quota_adset_7, w.pct_oos,
   w.segnale_freq, w.segnale_ctr, w.segnale_spesa, w.stato,
   case w.stato
     when 'in_pausa' then 'non attiva su Meta (' || coalesce(w.effective_status, 'stato sconosciuto') || ')'
     when 'senza_consegna' then 'Meta non la consegna (' || w.impressions_7 || ' impression in 7 giorni)'
     -- C1: "nuova" e' la base incompleta (Raccolta 1 e 2 hanno mesi di storia e sono ok)
     when 'nuova' then 'base di confronto non ancora completa (' || w.impressions_base || ' impression nei primi 14 giorni, live da '
                       || coalesce(w.giorni_live, 0) || ' giorni)'
     when 'ok' then case when w.freq_mancante then 'nessun segnale di fatica misurato' else 'nessun segnale di fatica' end
       || case when w.impressions_7 < k.impr_min or w.impressions_base < k.impr_min or coalesce(w.link_ctr_base, 0) = 0
               then '; CTR non confrontabile (' || concat_ws(', ',
                      case when w.impressions_7 < k.impr_min then w.impressions_7 || ' impression in 7 giorni' end,
                      case when w.impressions_base < k.impr_min then w.impressions_base || ' impression nei primi 14 giorni' end,
                      case when w.impressions_base >= k.impr_min and coalesce(w.link_ctr_base, 0) = 0
                           then 'nessun click sul link nei primi 14 giorni' end) || ')'
               else '' end
     else concat_ws('; ',
       case when w.segnale_spesa then 'speso ' || round(w.spend_14) || ' EUR in 14 giorni senza acquisti' end,
       case when w.segnale_freq then 'frequency 7g ' || replace(trim_scale(w.freq_7g)::text, '.', ',')
                                      || ' sopra ' || replace(trim_scale(w.freq_soglia)::text, '.', ',') end,
       case when w.segnale_ctr then 'CTR link ' || w.ctr_var_pct || '% rispetto ai primi 14 giorni' end)
   end
   || case when w.quota_adset_7 < k.quota_min and w.stato in ('nuova', 'ok', 'osserva')
           then '; riceve il ' || replace(trim_scale(w.quota_adset_7)::text, '.', ',') || '% della spesa del suo adset'
           else '' end
   || case when w.freq_mancante then '; frequency 7g non letta per il ' || to_char(w.as_of, 'DD-MM') || ': segnale non valutato'
           else '' end as motivo,
   case w.stato when 'cambia' then 1 when 'osserva' then 2 when 'nuova' then 3 when 'ok' then 4
                when 'senza_consegna' then 5 else 6 end as ordine,
   w.freq_mancante, w.freq_al
 from w cross join k;
grant select on v_ads_swap to anon, authenticated;
comment on view v_ads_swap is 'Amimì Ads: una riga per ad ACTIVE o con spesa negli ultimi 14 giorni, con i segnali di fatica (frequency 7g, CTR link contro i primi 14 giorni, spesa senza acquisti) e lo stato cambia/osserva/nuova/ok/senza_consegna/in_pausa. freq_mancante = frequency 7g non letta per as_of (segnale non valutato), freq_al = ultimo giorno letto. Regola dell''owner del 28-10-2026, migr 0175.';

-- (e) X1 (Gate 2): la card "Freschezza delle fonti" legge v_fonti_freschezza, dove meta_ads_ultimo_giorno viene da
--     meta_ads_daily (ferma al 01-07). Colonna IN CODA meta_ads_creative_ultimo_giorno = max(date) del daily per ad.
--     Corpo = pg_get_viewdef vivo del 28-10 (definito dalla 0109) piu' la colonna: create or replace tiene owner e grant
--     (anon, authenticated, ask_ro) e fallisce se nome, tipo od ordine di una colonna esistente cambiasse. Nessuna vista
--     o funzione dipende da lei (pg_depend e prosrc, 28-10).
create or replace view v_fonti_freschezza as
 SELECT ( SELECT max(shopify_orders.created_at_shop) AS max
           FROM shopify_orders) AS ultimo_ordine_shopify,
    ( SELECT max(shopify_orders.synced_at) AS max
           FROM shopify_orders) AS ultimo_sync_ordini,
    ( SELECT max(qromo_sales.data) AS max
           FROM qromo_sales) AS ultima_vendita_qromo,
    ( SELECT max(meta_ads_daily.date) AS max
           FROM meta_ads_daily) AS meta_ads_ultimo_giorno,
    ( SELECT max(meta_ads_daily.pulled_at) AS max
           FROM meta_ads_daily) AS meta_ads_ultimo_pull,
    ( SELECT max(shipping_status.updated_at) AS max
           FROM shipping_status) AS ultimo_batch_spedizioni,
    ( SELECT max(shopify_stock.synced_at) AS max
           FROM shopify_stock) AS ultimo_sync_stock,
    ( SELECT max(health_log.day) AS max
           FROM health_log) AS ultimo_health,
    ( SELECT max(expenses.date_paid) AS max
           FROM expenses
          WHERE expenses.status = 'approved'::text) AS ultima_spesa_pagata,
    ( SELECT max(purchases.data) AS max
           FROM purchases) AS ultimo_arrivo,
    ( SELECT max(meta_ads_creative_daily.date) AS max
           FROM meta_ads_creative_daily) AS meta_ads_creative_ultimo_giorno;

commit;
