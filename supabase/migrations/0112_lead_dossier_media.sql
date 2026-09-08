-- 0112: v_lead_dossier espone anche feed Instagram, foto prodotto, recensioni Google, stampa e la
-- miniatura di lista (primo post IG scaricato). Richiesta owner 08-09 sera: "iniettare il feed
-- Instagram, molte piu' immagini". Solo vista: nessuna tabella nuova, nessun dato core.
-- le colonne cambiano posizione: CREATE OR REPLACE non lo permette, si ricrea
drop view if exists v_lead_dossier;
create view v_lead_dossier with (security_invoker = on) as
select a.*,
  s.id as score_id, s.totale, s.tier_proposto, s.criteri, s.bonus, s.esclusione, s.dati_incompleti,
  s.motivazione, s.perche_no, s.rubrica_version, s.created_at as scored_at,
  r.azione as ultima_review_azione, r.chi as ultima_review_chi, r.created_at as ultima_review_at,
  (select asset_path from lead_evidence e where e.account_id = a.id and e.tipo = 'screenshot_home' order by captured_at desc limit 1) as shot_home,
  (select asset_path from lead_evidence e where e.account_id = a.id and e.tipo = 'screenshot_home_mobile' order by captured_at desc limit 1) as shot_home_mobile,
  (select asset_path from lead_evidence e where e.account_id = a.id and e.tipo = 'screenshot_ig' order by captured_at desc limit 1) as shot_ig,
  (select asset_path from lead_evidence e where e.account_id = a.id and e.tipo = 'screenshot_maps' order by captured_at desc limit 1) as shot_maps,
  (select asset_path from lead_evidence e where e.account_id = a.id and e.tipo = 'screenshot_maps_photos' order by captured_at desc limit 1) as shot_maps_photos,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'ig_metrics' order by captured_at desc limit 1) as ig_metrics,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'ig_posts' order by captured_at desc limit 1) as ig_posts,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'maps' order by captured_at desc limit 1) as maps,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'maps_reviews' order by captured_at desc limit 1) as maps_reviews,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'brands_carried' order by captured_at desc limit 1) as brands_carried,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'price_band' order by captured_at desc limit 1) as price_band,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'site_products' order by captured_at desc limit 1) as site_products,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'stampa' order by captured_at desc limit 1) as stampa,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'site_meta' order by captured_at desc limit 1) as site_meta,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'about_text' order by captured_at desc limit 1) as about_text,
  (select payload->'post'->0->>'asset_path' from lead_evidence e where e.account_id = a.id and e.tipo = 'ig_posts' and payload->'post'->0->>'asset_path' is not null order by captured_at desc limit 1) as thumb,
  (select count(*) from lead_evidence e where e.account_id = a.id) as n_evidenze,
  (select count(*) from lead_contacts c where c.account_id = a.id) as n_contatti,
  g.nome as gruppo_nome
from lead_accounts a
left join lateral (select * from lead_scores x where x.account_id = a.id order by created_at desc limit 1) s on true
left join lateral (select * from lead_reviews y where y.account_id = a.id order by created_at desc limit 1) r on true
left join lead_accounts g on g.id = a.gruppo_id;
revoke all on v_lead_dossier from anon;
grant select on v_lead_dossier to authenticated;
