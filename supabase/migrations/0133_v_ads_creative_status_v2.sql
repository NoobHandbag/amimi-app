-- 0133: v_ads_creative_status v2 per il redesign della sezione Ads (owner 2026-09-19).
-- Aggiunge adset_name, object_type, image_url, thumbnail_url e la frequency VERA a 7 giorni (meta_ad_freq7, punto 6);
-- la fatica ora si basa sulla frequency reale quando c'e' (soglie TARATE sui dati veri: 9 ad attivi il 18-09,
-- freq 7g reale min 1,07 media 1,60 max 2,79 su Lea Color), con fallback sulla media giornaliera (0130) per gli ad
-- senza delivery nel 7d. DROP + CREATE perche' cambia l'ordine delle colonne (create or replace e' append-only) e
-- la vista non ha dipendenti a DB (la legge solo la PWA via anon).
drop view if exists v_ads_creative_status;
create view v_ads_creative_status as
 with x as (
   select w.ad_id, w.as_of,
     coalesce(c.ad_name, w.ad_name) as ad_name,
     w.campaign_name, w.adset_name,
     c.campaign_id, c.adset_id, c.effective_status, c.product_set_id,
     c.object_type, c.thumbnail_url, c.image_url, c.link,
     w.spend_7, w.purchases_7, w.value_7,
     case when w.impr_7 > 0    then round(100.0 * w.clicks_7    / w.impr_7, 2)    end as ctr_7,
     case when w.impr_prev7 > 0 then round(100.0 * w.clicks_prev7 / w.impr_prev7, 2) end as ctr_prev7,
     case when w.impr_90 > 0   then round(100.0 * w.clicks_90   / w.impr_90, 2)   end as ctr_90,
     case when w.impr_7 > 0    then round(1000.0 * w.spend_7    / w.impr_7, 2)    end as cpm_7,
     round(w.freq_media_giornaliera_7, 2) as freq_media_giornaliera_7,
     fq.freq_7d as freq_7g,   -- frequency VERA a 7 giorni (reach deduplicata); null se l'ad non ha delivery nel 7d
     case when w.purchases_7 > 0 then round(w.spend_7 / w.purchases_7, 2) end as cpa_7,
     case when w.spend_7 > 0     then round(w.value_7 / w.spend_7, 2)     end as roas_7,
     s.prodotti_nel_set, s.prodotti_risolti, s.prodotti_oos, s.prodotti_non_su_shopify, s.pct_oos
   from v_ads_creative_windows w
   left join meta_ad_creative c on c.ad_id = w.ad_id
   left join v_ads_set_inventory s on s.product_set_id = c.product_set_id
   left join meta_ad_freq7 fq on fq.ad_id = w.ad_id
 )
 select x.*,
   -- fatica: frequency VERA a 7g quando c'e' (soglie tarate: alta >= 2,5, media >= 1,8; max reale 2,79) con CTR in
   -- calo; fallback sulla media giornaliera (0130: 1,7 / 1,4) per gli ad senza delivery nel 7d.
   case
     when freq_7g is not null and freq_7g >= 2.5 and ctr_7 is not null and ctr_90    is not null and ctr_7 < ctr_90    then 'alta'
     when freq_7g is not null and freq_7g >= 1.8 and ctr_7 is not null and ctr_prev7 is not null and ctr_7 < ctr_prev7 then 'media'
     when freq_7g is null and coalesce(freq_media_giornaliera_7,0) >= 1.7 and ctr_7 is not null and ctr_90    is not null and ctr_7 < ctr_90    then 'alta'
     when freq_7g is null and coalesce(freq_media_giornaliera_7,0) >= 1.4 and ctr_7 is not null and ctr_prev7 is not null and ctr_7 < ctr_prev7 then 'media'
     else 'ok'
   end as stato_fatica,
   case
     when coalesce(effective_status,'') = 'ACTIVE'
      and coalesce(prodotti_risolti,0) >= 3
      and coalesce(prodotti_risolti,0)::numeric >= 0.5 * nullif(prodotti_nel_set,0)
      and coalesce(pct_oos,0) >= 30
       then 'set scoperto (' || coalesce(pct_oos,0) || '% OOS su ' || prodotti_risolti || '/' || prodotti_nel_set || ' risolti): escludi gli OOS o rinfresca il set'
     when coalesce(effective_status,'') = 'ACTIVE' and freq_7g is not null and freq_7g >= 2.5 and ctr_7 is not null and ctr_90 is not null and ctr_7 < ctr_90
       then 'rinfresca la creativita'' (fatica: frequency 7g ' || round(freq_7g,1) || ', CTR sotto la media 90g)'
     else null
   end as azione_suggerita
 from x;
grant select on v_ads_creative_status to anon, authenticated;