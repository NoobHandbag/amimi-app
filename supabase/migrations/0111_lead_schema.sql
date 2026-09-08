-- 0111: modulo lead_* (ricerca negozi e gruppi multimarca B2B + outreach). Piano e rubrica:
-- Cowork12/projects/B2B_Prospecting_2026-09/PIANO_Ricerca_e_Outreach_B2B.md (v1, approvata owner 08-09).
--
-- Modulo ADDITIVO (Regola Ferrea 19): prefisso proprio, core solo in lettura (negozi via FK, mai scritto),
-- flag app_flags.lead_enabled default OFF (per ora non gata nulla: nessun cron in questa migrazione).
-- Postura di sicurezza = quella delle cs_* (0053/0055): dati personali di terzi (titolari, buyer)
--   - SELECT solo authenticated con email @amimi.it (RLS), anon = niente (REVOKE + nessuna policy).
--   - Scritture: SOLO il collector (workers/lead, service_role) e la sessione Claude Code.
--     Unica eccezione: lead_reviews e' scrivibile (INSERT) dall'utente loggato @amimi.it, perche'
--     e' la decisione umana della revisione; un trigger security definer riporta la decisione
--     sull'account (tier / rejected / ricontrolla). Nessun UPDATE/DELETE per i ruoli applicativi.
-- Bucket Storage `lead-assets` PRIVATO (screenshot): lettura solo authenticated @amimi.it via URL firmati.

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------
create table if not exists lead_accounts (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null,
  tipo               text not null default 'boutique'
                     check (tipo in ('boutique','concept_store','hotel_shop','gruppo_multimarca','corner_department','negozio_regalo','online_multibrand')),
  gruppo_id          uuid references lead_accounts(id),
  indirizzo          text,
  citta              text,
  provincia          text,
  regione            text,
  paese              text not null default 'IT',
  lat                double precision,
  lng                double precision,
  website            text,
  ig_handle          text,
  google_place_id    text,
  google_maps_url    text,
  telefono           text,
  email_generica     text,
  piva               text,
  fonte_seed         text not null,                       -- manuale:benny | manuale:claude_contrasto | stockist:<brand> | maps:<query> | ig:<hashtag> | editoriale:<url> | cs_inbound
  priorita_tipologia smallint,                            -- 1|2|3 (cap. 3.1 del piano)
  stato_ricerca      text not null default 'seed'
                     check (stato_ricerca in ('seed','enriched','scored','reviewed','rejected')),
  rejected_motivo    text,
  lead_stage         text not null default 'da_contattare'
                     check (lead_stage in ('da_contattare','contattato','risposto','interessato','materiale_inviato','appuntamento','primo_ordine','attivo','chiuso_no','opt_out')),
  tier               text check (tier in ('A','B','C')),  -- decisione UMANA (lead_reviews); il proposto sta in lead_scores
  gancio             text,
  gancio_evidence_id uuid,
  owner_note         text,
  contattato_prima   boolean not null default false,      -- gia' contattato in passato (lista Benny "Contattato?")
  chi                text,
  negozio_id         uuid references negozi(id),          -- valorizzato SOLO al primo ordine (core in lettura)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists lead_accounts_ig_uq on lead_accounts (lower(ig_handle)) where ig_handle is not null;
create unique index if not exists lead_accounts_place_uq on lead_accounts (google_place_id) where google_place_id is not null;
create unique index if not exists lead_accounts_nome_citta_uq on lead_accounts (lower(nome), lower(coalesce(citta,'')));
create index if not exists lead_accounts_stato_idx on lead_accounts (stato_ricerca);

create table if not exists lead_contacts (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references lead_accounts(id) on delete cascade,
  nome         text,
  ruolo        text,                                      -- titolare|buyer|store_manager|altro
  email        text,
  telefono     text,
  linkedin_url text,
  fonte        text,
  opt_out      boolean not null default false,
  opt_out_at   timestamptz,
  note         text,
  chi          text,
  created_at   timestamptz not null default now()
);
create index if not exists lead_contacts_account_idx on lead_contacts (account_id);

create table if not exists lead_runs (
  id          uuid primary key default gen_random_uuid(),
  fase        text not null,                              -- collect|judge|contacts|import
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  n_input     int not null default 0,
  n_ok        int not null default 0,
  n_err       int not null default 0,
  note        text,
  log         jsonb
);

create table if not exists lead_evidence (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references lead_accounts(id) on delete cascade,
  run_id      uuid references lead_runs(id),
  tipo        text not null,                              -- screenshot_home|screenshot_home_mobile|screenshot_ig|screenshot_maps|screenshot_storefront|site_meta|ig_metrics|maps|brands_carried|price_band|about_text|contatti_trovati|stampa|stockist_match|fonte|nota_ai|errore
  payload     jsonb,
  asset_path  text,                                       -- path nel bucket lead-assets (screenshot)
  raccolto_da text not null default 'script',             -- script|claude|umano
  note        text,
  captured_at timestamptz not null default now()
);
create index if not exists lead_evidence_account_idx on lead_evidence (account_id, tipo, captured_at desc);

create table if not exists lead_scores (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references lead_accounts(id) on delete cascade,
  run_id           uuid references lead_runs(id),
  rubrica_version  text not null default 'v1',
  criteri          jsonb not null,                        -- {brand:{punti,peso,prova,evidence_id}, stile:{...}, posto, vitalita, raggiungibilita, digitale}
  bonus            jsonb,                                 -- {gruppo:5, stockist:5, aggancio:5} (tetto 10)
  esclusione       text,                                  -- monomarca|chiuso|russia|null
  totale           numeric(5,1),
  tier_proposto    text check (tier_proposto in ('A','B','C')),
  dati_incompleti  boolean not null default false,
  motivazione      text,
  perche_no        text,
  modello          text,
  created_at       timestamptz not null default now()
);
create index if not exists lead_scores_account_idx on lead_scores (account_id, created_at desc);

create table if not exists lead_reviews (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references lead_accounts(id) on delete cascade,
  chi         text not null,
  azione      text not null check (azione in ('tier','scarta','ricontrolla','nota')),
  tier        text check (tier in ('A','B','C')),
  motivo      text,
  nota        text,
  created_at  timestamptz not null default now()
);
create index if not exists lead_reviews_account_idx on lead_reviews (account_id, created_at desc);

-- Fase 2 (outreach): create ora, vuote, per non frammentare le migrazioni (stesso criterio di 0053).
create table if not exists lead_touches (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references lead_accounts(id) on delete cascade,
  contact_id       uuid references lead_contacts(id),
  canale           text not null check (canale in ('email','telefono','instagram_dm','visita','altro')),
  direzione        text not null check (direzione in ('in','out')),
  gmail_message_id text unique,
  gmail_thread_id  text,
  subject          text,
  body_clean       text,
  stage_prima      text,
  stage_dopo       text,
  chi              text,
  at               timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists lead_touches_account_idx on lead_touches (account_id, at desc);

create table if not exists lead_drafts (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references lead_accounts(id) on delete cascade,
  touch_in_id  uuid references lead_touches(id),
  lingua       text,
  testo        text not null,
  fatti_usati  jsonb,
  stato        text not null default 'proposta' check (stato in ('proposta','approvata','inviata','scartata')),
  chi          text,
  created_at   timestamptz not null default now()
);

create table if not exists lead_knowledge (
  id         serial primary key,
  categoria  text,
  titolo     text not null,
  contenuto  text not null,
  attiva     boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Trigger: la decisione umana (lead_reviews) si riflette sull'account.
-- security definer perche' l'utente loggato NON ha UPDATE su lead_accounts.
-- ---------------------------------------------------------------------------
create or replace function lead_reviews_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.azione = 'tier' then
    update lead_accounts set tier = new.tier, stato_ricerca = 'reviewed', rejected_motivo = null,
      owner_note = coalesce(new.nota, owner_note), updated_at = now() where id = new.account_id;
  elsif new.azione = 'scarta' then
    update lead_accounts set stato_ricerca = 'rejected', rejected_motivo = coalesce(new.motivo, 'scartato in revisione'),
      tier = null, owner_note = coalesce(new.nota, owner_note), updated_at = now() where id = new.account_id;
  elsif new.azione = 'ricontrolla' then
    update lead_accounts set stato_ricerca = 'seed', rejected_motivo = null, owner_note = coalesce(new.nota, owner_note),
      updated_at = now() where id = new.account_id;
  elsif new.azione = 'nota' then
    update lead_accounts set owner_note = new.nota, updated_at = now() where id = new.account_id;
  end if;
  return new;
end $$;
drop trigger if exists lead_reviews_apply_trg on lead_reviews;
create trigger lead_reviews_apply_trg after insert on lead_reviews for each row execute function lead_reviews_apply();

-- ---------------------------------------------------------------------------
-- Viste (security_invoker: la RLS dell'utente vale anche attraverso la vista)
-- ---------------------------------------------------------------------------
create or replace view v_lead_dossier with (security_invoker = on) as
select a.*,
  s.id as score_id, s.totale, s.tier_proposto, s.criteri, s.bonus, s.esclusione, s.dati_incompleti,
  s.motivazione, s.perche_no, s.rubrica_version, s.created_at as scored_at,
  r.azione as ultima_review_azione, r.chi as ultima_review_chi, r.created_at as ultima_review_at,
  (select asset_path from lead_evidence e where e.account_id = a.id and e.tipo = 'screenshot_home' order by captured_at desc limit 1) as shot_home,
  (select asset_path from lead_evidence e where e.account_id = a.id and e.tipo = 'screenshot_home_mobile' order by captured_at desc limit 1) as shot_home_mobile,
  (select asset_path from lead_evidence e where e.account_id = a.id and e.tipo = 'screenshot_ig' order by captured_at desc limit 1) as shot_ig,
  (select asset_path from lead_evidence e where e.account_id = a.id and e.tipo = 'screenshot_maps' order by captured_at desc limit 1) as shot_maps,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'ig_metrics' order by captured_at desc limit 1) as ig_metrics,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'maps' order by captured_at desc limit 1) as maps,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'brands_carried' order by captured_at desc limit 1) as brands_carried,
  (select payload from lead_evidence e where e.account_id = a.id and e.tipo = 'price_band' order by captured_at desc limit 1) as price_band,
  (select count(*) from lead_evidence e where e.account_id = a.id) as n_evidenze,
  (select count(*) from lead_contacts c where c.account_id = a.id) as n_contatti,
  g.nome as gruppo_nome
from lead_accounts a
left join lateral (select * from lead_scores x where x.account_id = a.id order by created_at desc limit 1) s on true
left join lateral (select * from lead_reviews y where y.account_id = a.id order by created_at desc limit 1) r on true
left join lead_accounts g on g.id = a.gruppo_id;

create or replace view v_lead_pipeline with (security_invoker = on) as
select stato_ricerca, tier, lead_stage, paese, count(*) as n
from lead_accounts group by 1,2,3,4;

-- ---------------------------------------------------------------------------
-- Sicurezza: RLS + grant (postura cs_*)
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['lead_accounts','lead_contacts','lead_runs','lead_evidence','lead_scores','lead_reviews','lead_touches','lead_drafts','lead_knowledge'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
    execute format('drop policy if exists %I on %I', t || '_sel', t);
    execute format('create policy %I on %I for select to authenticated using ((auth.jwt() ->> ''email'') ilike ''%%@amimi.it'')', t || '_sel', t);
  end loop;
end $$;
grant insert on lead_reviews to authenticated;
drop policy if exists lead_reviews_ins on lead_reviews;
create policy lead_reviews_ins on lead_reviews for insert to authenticated
  with check ((auth.jwt() ->> 'email') ilike '%@amimi.it');
grant usage on sequence lead_knowledge_id_seq to authenticated;
revoke all on v_lead_dossier, v_lead_pipeline from anon;
grant select on v_lead_dossier, v_lead_pipeline to authenticated;

-- Storage: bucket privato per gli screenshot
insert into storage.buckets (id, name, public) values ('lead-assets', 'lead-assets', false) on conflict (id) do nothing;
drop policy if exists lead_assets_sel on storage.objects;
create policy lead_assets_sel on storage.objects for select to authenticated
  using (bucket_id = 'lead-assets' and (auth.jwt() ->> 'email') ilike '%@amimi.it');

-- Flag del modulo (default OFF; oggi non gata cron, e' il rollback dichiarato della Regola 19)
insert into app_flags (key, value) values ('lead_enabled', 'false') on conflict (key) do nothing;
