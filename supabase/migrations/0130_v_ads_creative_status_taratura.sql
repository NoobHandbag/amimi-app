-- 0130: taratura della regola "fatica" di v_ads_creative_status sui dati REALI a livello ad (finding B1 del gate
-- 2026-09-18: la 0129 aveva soglie provvisorie). Primo backfill di 14 giorni (04-17/09/2026, 9 ad, 79 righe con spesa):
-- frequency giornaliera media 1,38, p90 1,92, max 2,10; media a 7 giorni per ad MAX 1,74. La soglia "alta" a 1,8 era
-- ancora irraggiungibile (nessun ad la tocca): scende a 1,7. "media" resta 1,4 (scatta su 3 ad su 9). Stessa
-- definizione della 0129 per tutto il resto (B2 gate di copertura, C7 as_of, C8 nome recente). La frequency vera a
-- 7 giorni (reach deduplicata, chiamata insights con time_range di 7g) resta il follow-up dichiarato.
create or replace view v_ads_creative_status as
 with x as (
   select w.ad_id, w.as_of,
     coalesce(c.ad_name, w.ad_name) as ad_name,
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
   -- B1 tarata sui dati reali (vedi testa del file): 'alta' >= 1,7 e CTR sotto la media 90g; 'media' >= 1,4 e CTR
   -- sotto la settimana precedente.
   case
     when coalesce(freq_media_giornaliera_7,0) >= 1.7 and ctr_7 is not null and ctr_90    is not null and ctr_7 < ctr_90    then 'alta'
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
     when coalesce(effective_status,'') = 'ACTIVE' and coalesce(freq_media_giornaliera_7,0) >= 1.7 and ctr_7 is not null and ctr_90 is not null and ctr_7 < ctr_90
       then 'rinfresca la creativita'' (fatica: frequency in salita, CTR sotto la media 90g)'
     else null
   end as azione_suggerita
 from x;
grant select on v_ads_creative_status to anon, authenticated;
