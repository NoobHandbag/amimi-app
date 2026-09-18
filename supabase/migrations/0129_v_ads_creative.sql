-- FEATURE: viste per la reportistica Amimì Ads a livello creativita' (Fase 1).
-- Additive, leggono le tabelle della migr 0128 + le viste inventario esistenti (v_inventory).
-- Le viste sono owned da postgres: espongono aggregati ad anon senza dare accesso alle tabelle base
-- (stesso schema di v_ads_mensile). Nessuna scrittura, nessuna modifica a viste/tabelle esistenti.
-- Audit gate 2026-09-18 (Gate 2): B1 la media della frequency giornaliera ha il suo nome e soglie raggiungibili;
-- B2 "set scoperto" solo con copertura sufficiente; C7 as_of esposto; C8 nome ad piu' recente dall'anagrafica.

-- 1) Inventario per product_set: quanti prodotti del set sono risolti su codice, OOS, non su Shopify.
create or replace view v_ads_set_inventory as
 select m.product_set_id,
   count(*) as prodotti_nel_set,
   count(*) filter (where i.codice_norm is not null) as prodotti_risolti,
   count(*) filter (where i.codice_norm is not null and coalesce(i.disponibili_da_vendere,0) <= 0) as prodotti_oos,
   count(*) filter (where i.codice_norm is not null and coalesce(i.disponibili_da_vendere,0) between 1 and 2) as prodotti_low_stock,
   count(*) filter (where i.codice_norm is not null and coalesce(i.on_shopify,false) = false) as prodotti_non_su_shopify,
   round(100.0 * count(*) filter (where i.codice_norm is not null and coalesce(i.disponibili_da_vendere,0) <= 0)
     / nullif(count(*) filter (where i.codice_norm is not null),0), 1) as pct_oos
 from meta_product_set_map m
 left join v_inventory i on i.codice_norm = m.codice_norm
 group by m.product_set_id;
grant select on v_ads_set_inventory to anon, authenticated;

-- 2) Finestre temporali per ad: ultimi 7g, 7g precedenti (8-14), ultimi 90g. Ancorate all'ultima data presente
--    (as_of, C7: se il cron si ferma la UI puo' dire "dati al ...").
create or replace view v_ads_creative_windows as
 with ref as (select max(date) as d from meta_ads_creative_daily)
 select d.ad_id,
   r.d as as_of,
   max(d.ad_name) as ad_name,
   max(d.campaign_name) as campaign_name,
   sum(d.spend)          filter (where d.date >  r.d - 7)                        as spend_7,
   sum(d.impressions)    filter (where d.date >  r.d - 7)                        as impr_7,
   sum(d.clicks)         filter (where d.date >  r.d - 7)                        as clicks_7,
   sum(d.link_clicks)    filter (where d.date >  r.d - 7)                        as link_clicks_7,
   sum(d.purchases)      filter (where d.date >  r.d - 7)                        as purchases_7,
   sum(d.purchase_value) filter (where d.date >  r.d - 7)                        as value_7,
   -- B1: e' la MEDIA della frequency GIORNALIERA (ogni riga e' un giorno: impressions/reach di quel giorno, ~1-2),
   -- NON la frequency a 7 giorni. La frequency vera a 7 giorni richiede una chiamata insights con time_range di
   -- 7 giorni (reach deduplicata): follow-up. Il nome dice cosa misura.
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

-- 3) Stato per ad: metriche 7g, confronti settimana/90g, inventario del set, fatica e azione suggerita.
create or replace view v_ads_creative_status as
 with x as (
   select w.ad_id, w.as_of,
     coalesce(c.ad_name, w.ad_name) as ad_name,   -- C8: nome piu' recente dall'anagrafica, non il max lessicografico
     w.campaign_name,
     c.campaign_id, c.adset_id, c.effective_status, c.product_set_id, c.thumbnail_url, c.link,
     w.spend_7, w.purchases_7, w.value_7,
     case when w.impr_7 > 0    then round(100.0 * w.clicks_7    / w.impr_7, 2)    end as ctr_7,
     case when w.impr_prev7 > 0 then round(100.0 * w.clicks_prev7 / w.impr_prev7, 2) end as ctr_prev7,
     case when w.impr_90 > 0   then round(100.0 * w.clicks_90   / w.impr_90, 2)   end as ctr_90,
     case when w.impr_7 > 0    then round(1000.0 * w.spend_7    / w.impr_7, 2)    end as cpm_7,
     round(w.freq_media_giornaliera_7, 2) as freq_media_giornaliera_7,
     case when w.purchases_7 > 0 then round(w.spend_7 / w.purchases_7, 2) end as cpa_7,
     case when w.spend_7 > 0     then round(w.value_7 / w.spend_7, 2)     end as roas_7,
     s.prodotti_nel_set, s.prodotti_risolti, s.prodotti_oos, s.prodotti_non_su_shopify, s.pct_oos
   from v_ads_creative_windows w
   left join meta_ad_creative c on c.ad_id = w.ad_id
   left join v_ads_set_inventory s on s.product_set_id = c.product_set_id
 )
 select x.*,
   -- B1: soglie PROVVISORIE sulla media giornaliera (dati reali di campagna in meta_ads_daily: media 1,57, max 2,0):
   -- da tarare sul primo backfill a livello ad. La regola deve poter scattare, non essere irraggiungibile.
   case
     when coalesce(freq_media_giornaliera_7,0) >= 1.8 and ctr_7 is not null and ctr_90    is not null and ctr_7 < ctr_90    then 'alta'
     when coalesce(freq_media_giornaliera_7,0) >= 1.4 and ctr_7 is not null and ctr_prev7 is not null and ctr_7 < ctr_prev7 then 'media'
     else 'ok'
   end as stato_fatica,
   -- B2: "set scoperto" solo con copertura sufficiente: almeno 3 prodotti risolti E almeno meta' del set,
   -- e il messaggio dice su quanti prodotti si basa (risolti/nel_set).
   case
     when coalesce(effective_status,'') = 'ACTIVE'
      and coalesce(prodotti_risolti,0) >= 3
      and coalesce(prodotti_risolti,0)::numeric >= 0.5 * nullif(prodotti_nel_set,0)
      and coalesce(pct_oos,0) >= 30
       then 'set scoperto (' || coalesce(pct_oos,0) || '% OOS su ' || prodotti_risolti || '/' || prodotti_nel_set || ' risolti): escludi gli OOS o rinfresca il set'
     when coalesce(effective_status,'') = 'ACTIVE' and coalesce(freq_media_giornaliera_7,0) >= 1.8 and ctr_7 is not null and ctr_90 is not null and ctr_7 < ctr_90
       then 'rinfresca la creativita'' (fatica: frequency in salita, CTR sotto la media 90g)'
     else null
   end as azione_suggerita
 from x;
grant select on v_ads_creative_status to anon, authenticated;

-- 4) Totali account per settimana, con delta settimana su settimana (per l'header del report).
create or replace view v_ads_weekly_account as
 with wk as (
   select date_trunc('week', date)::date as settimana,
     sum(spend) as spend, sum(purchases) as purchases, sum(purchase_value) as value,
     sum(impressions) as impr, sum(clicks) as clicks
   from meta_ads_creative_daily group by 1
 )
 select settimana, spend, purchases, value,
   case when purchases > 0 then round(spend / purchases, 2) end as cpa,
   case when spend > 0 then round(value / spend, 2) end as roas,
   round((spend - lag(spend) over (order by settimana))::numeric, 2) as spend_wow,
   (purchases - lag(purchases) over (order by settimana)) as purchases_wow
 from wk
 order by settimana desc;
grant select on v_ads_weekly_account to anon, authenticated;
