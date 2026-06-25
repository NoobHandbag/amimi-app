-- FEATURE: Meta Ads monthly card.
create or replace view v_ads_mensile as
 select extract(year from date)::int as year, extract(month from date)::int as month,
   round(sum(coalesce(spend,0))::numeric, 2) as spend,
   sum(coalesce(impressions,0)) as impressions,
   sum(coalesce(clicks,0)) as clicks,
   sum(coalesce(purchases,0)) as purchases,
   round(sum(coalesce(purchase_value,0))::numeric, 2) as purchase_value,
   case when sum(coalesce(spend,0)) > 0 then round(sum(coalesce(purchase_value,0))::numeric / sum(coalesce(spend,0))::numeric, 2) else 0 end as roas
 from meta_ads_daily group by 1, 2 order by 1, 2;
grant select on v_ads_mensile to anon, authenticated;
