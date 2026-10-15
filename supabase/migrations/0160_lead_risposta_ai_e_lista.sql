-- 0160_lead_risposta_ai_e_lista (2026-10-15): Negozi B2B "come Assistenza" e veloce. Modulo lead_*, additivo (Regola 19):
-- nessuna tabella core toccata, nessun dato scritto fuori da app_flags.
-- (1) Flag lead_risposta_ai_enabled per le azioni proponi_risposta e rifinisci di lead-outreach v15 (la proposta di
--     risposta dalla conversazione col negozio). Nel codice il default e' spento; qui nasce 'true' perche' l'owner l'ha
--     chiesto in chat il 15-10 ("fallo molto piu' simile ad assistenza"). Rollback = 'false': gli invii restano accesi.
-- (2) v_lead_settings (lista chiusa di chiavi, migr 0139) espone anche quel flag, cosi' la scheda sa se mostrare la proposta.
-- (3) v_lead_lista: la lista di Negozi legge solo le colonne che usa (schede, tabella, ricerca, export, KPI), e dei payload
--     solo le chiavi che mostra. Misura del 15-10: v_lead_dossier intera pesa 23,5 MB in 8 pagine lette in serie (circa
--     12 secondi a ogni ingresso nella sezione e dopo ogni scrittura); la lista snella sta sotto i 3 MB. Stesse regole di
--     v_lead_dossier (ultima evidenza per tipo, ultimo score), che resta com'e' per la scheda del negozio e per la edge.
--     `img` e' UNA immagine per negozio, nello stesso ordine di prima (miniatura del feed, poi Instagram, sito mobile,
--     sito desktop): coalesce valuta le sottoquery da sinistra e si ferma alla prima non nulla.
insert into app_flags (key, value) values ('lead_risposta_ai_enabled', 'true') on conflict (key) do nothing;

create or replace view v_lead_settings as
select key, value from app_flags
where key in ('lead_enabled', 'lead_firma', 'lead_tetto_giornaliero', 'lead_outreach_ai_enabled', 'lead_linesheet_url', 'lead_risposta_ai_enabled');
revoke all on v_lead_settings from anon, public;
grant select on v_lead_settings to authenticated;

create or replace view v_lead_lista with (security_invoker = on) as
select a.id, a.nome, a.tipo, a.citta, a.paese, a.website, a.ig_handle, a.telefono, a.email_generica,
  a.stato_ricerca, a.lead_stage, a.tier, a.gancio, a.owner_note, a.verdetto, a.verdetto_motivo,
  s.totale, s.tier_proposto, s.esclusione, left(s.motivazione, 200) as motivazione,
  (select jsonb_build_object('follower', e.payload -> 'follower') from lead_evidence e
    where e.account_id = a.id and e.tipo = 'ig_metrics' order by e.captured_at desc limit 1) as ig_metrics,
  (select jsonb_build_object('rating', e.payload -> 'rating', 'recensioni', e.payload -> 'recensioni', 'telefono', e.payload -> 'telefono') from lead_evidence e
    where e.account_id = a.id and e.tipo = 'maps' order by e.captured_at desc limit 1) as maps,
  (select jsonb_build_object('peer_match', e.payload -> 'peer_match', 'vendors', e.payload -> 'vendors') from lead_evidence e
    where e.account_id = a.id and e.tipo = 'brands_carried' order by e.captured_at desc limit 1) as brands_carried,
  (select jsonb_build_object('borse', e.payload -> 'borse') from lead_evidence e
    where e.account_id = a.id and e.tipo = 'price_band' order by e.captured_at desc limit 1) as price_band,
  coalesce(
    (select e.payload -> 'post' -> 0 ->> 'asset_path' from lead_evidence e
      where e.account_id = a.id and e.tipo = 'ig_posts' and (e.payload -> 'post' -> 0 ->> 'asset_path') is not null order by e.captured_at desc limit 1),
    (select e.asset_path from lead_evidence e where e.account_id = a.id and e.tipo = 'screenshot_ig' order by e.captured_at desc limit 1),
    (select e.asset_path from lead_evidence e where e.account_id = a.id and e.tipo = 'screenshot_home_mobile' order by e.captured_at desc limit 1),
    (select e.asset_path from lead_evidence e where e.account_id = a.id and e.tipo = 'screenshot_home' order by e.captured_at desc limit 1)
  ) as img,
  (select count(*) from lead_evidence e where e.account_id = a.id) as n_evidenze
from lead_accounts a
left join lateral (
  select x.totale, x.tier_proposto, x.esclusione, x.motivazione from lead_scores x
  where x.account_id = a.id order by x.created_at desc limit 1
) s on true;

revoke all on v_lead_lista from anon, public;
grant select on v_lead_lista to authenticated;

-- controlli finali: il flag c'e', la vista si interroga e ha una riga per negozio
do $$
declare n_acc bigint; n_lista bigint;
begin
  if not exists (select 1 from app_flags where key = 'lead_risposta_ai_enabled') then raise exception 'flag lead_risposta_ai_enabled assente'; end if;
  select count(*) into n_acc from lead_accounts;
  select count(*) into n_lista from v_lead_lista;
  if n_acc <> n_lista then raise exception 'v_lead_lista: % righe contro % negozi', n_lista, n_acc; end if;
end $$;
