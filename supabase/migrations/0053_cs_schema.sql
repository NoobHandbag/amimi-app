-- 0053: schema del tool assistenza clienti (Fase 1). Tabelle cs_*.
-- Design: Cowork12/projects/Servizio_Clienti_2026-06/DESIGN_Tool_Assistenza_Amimi_V1_2026-07-20.md (sez. 4).
--
-- SICUREZZA (diversa dal resto dell'app, per scelta di design owner sez. 3.4):
--   Il resto dell'app e' leggibile con la anon key (no-login). Le cs_* NO: contengono il testo
--   dei thread cliente, quindi vanno dietro login. Posture RLS invece che grant-based:
--     - SELECT solo per il ruolo `authenticated` (utenti @amimi.it loggati via Supabase Auth).
--     - anon = niente (nessuna policy anon + REVOKE esplicita = doppio blocco).
--     - INSERT/UPDATE/DELETE per NESSUN ruolo applicativo: le scritture passano SOLO dalla edge
--       cs-sync col service_role (rolbypassrls=true, verificato: bypassa la RLS e mantiene i grant).
--   Test negativo obbligatorio (criterio Fase 1): una SELECT con anon key su cs_* DEVE fallire.
--
-- In Fase 1 si popolano solo cs_conversations + cs_messages + cs_events (ingest reale via cron).
-- cs_drafts / cs_faq si creano ma restano VUOTE (seed e uso in Fase 2-3) per non frammentare le migrazioni.
-- Colonne AI (categoria*, urgente, urgenza_motivo, summary*) create NULLABLE: si riempiono in Fase 2/3.

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------
create table if not exists cs_conversations (
  id                   uuid primary key default gen_random_uuid(),
  gmail_thread_id      text unique not null,                 -- chiave di idempotenza (un thread = una riga)
  canale               text not null,                        -- email_diretta|form_contatto|form_evento|chat_notifica|rumore
  customer_email       text,
  customer_name        text,
  stato                text not null default 'da_fare',      -- da_fare|fatto (le scritture di stato = Fase 4)
  stato_by             text,
  stato_at             timestamptz,
  last_msg_at          timestamptz,
  last_direction       text,                                 -- in|out
  subject              text,
  snippet              text,
  order_number         int,                                  -- riconosciuto nel testo (es. 1457), se presente
  lingua               text,                                 -- it|en
  categoria            text,                                 -- Fase 2: una delle 13 (NULL ora)
  categoria_source     text,                                 -- ai|manuale|regola
  categoria_confidence numeric,
  urgente              boolean,                              -- Fase 2 (NULL ora)
  urgenza_motivo       text,
  summary              text,                                 -- Fase 3 (NULL ora)
  summary_at           timestamptz,
  parse_failed         boolean not null default false,       -- regola anti-perdita: mail non interpretata ma MAI persa
  created_at           timestamptz not null default now()
);

create table if not exists cs_messages (
  id                uuid primary key default gen_random_uuid(),
  gmail_message_id  text unique not null,                    -- chiave di idempotenza per-messaggio
  conversation_id   uuid not null references cs_conversations(id) on delete cascade,
  direction         text not null,                           -- in|out
  sent_by           text,                                    -- benny|ginevra|ale (solo out dal tool, Fase 4)
  from_email        text,
  to_email          text,
  sent_at           timestamptz,
  body_text         text,                                    -- bonificato, troncato ~20KB (allegati restano in Gmail)
  is_via_tool       boolean not null default false,
  form_fields       jsonb,                                   -- campi estratti dai form Shopify
  created_at        timestamptz not null default now()
);

create table if not exists cs_events (
  id               bigint generated always as identity primary key,
  conversation_id  uuid references cs_conversations(id) on delete cascade,
  azione           text not null,                            -- ingest|parse_failed|classify|draft|send|stato|...
  chi              text,
  dettaglio        jsonb,
  at               timestamptz not null default now()
);

create table if not exists cs_drafts (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references cs_conversations(id) on delete cascade,
  testo            text,
  dati_usati       jsonb,
  model            text,
  created_at       timestamptz not null default now(),
  used             boolean not null default false,
  edited           boolean not null default false
);

create table if not exists cs_faq (
  id        bigint generated always as identity primary key,
  tipo      text not null,                                   -- faq|risposta_standard|esempio_tono
  titolo    text,
  testo_it  text,
  testo_en  text,
  categoria text,
  attiva    boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Indici per la coda
-- ---------------------------------------------------------------------------
create index if not exists cs_conv_canale_idx  on cs_conversations (canale);
create index if not exists cs_conv_stato_idx   on cs_conversations (stato);
create index if not exists cs_conv_lastmsg_idx on cs_conversations (last_msg_at desc);
create index if not exists cs_msg_conv_idx      on cs_messages (conversation_id, sent_at);

-- ---------------------------------------------------------------------------
-- RLS: SELECT solo authenticated, scritture per nessuno (service_role bypassa)
-- ---------------------------------------------------------------------------
alter table cs_conversations enable row level security;
alter table cs_messages      enable row level security;
alter table cs_events        enable row level security;
alter table cs_drafts        enable row level security;
alter table cs_faq           enable row level security;

drop policy if exists cs_conv_sel on cs_conversations;
drop policy if exists cs_msg_sel  on cs_messages;
drop policy if exists cs_evt_sel  on cs_events;
drop policy if exists cs_drf_sel  on cs_drafts;
drop policy if exists cs_faq_sel  on cs_faq;

create policy cs_conv_sel on cs_conversations for select to authenticated using (true);
create policy cs_msg_sel  on cs_messages      for select to authenticated using (true);
create policy cs_evt_sel  on cs_events        for select to authenticated using (true);
create policy cs_drf_sel  on cs_drafts        for select to authenticated using (true);
create policy cs_faq_sel  on cs_faq           for select to authenticated using (true);
-- Nessuna policy INSERT/UPDATE/DELETE => scritture bloccate per anon E authenticated.

-- Cintura e bretelle: azzera i privilegi di tabella per anon/authenticated (cosi' un errore di policy
-- non puo' mai esporre scritture), poi concedi il solo SELECT ad authenticated. service_role non e'
-- toccato e mantiene i propri grant (oltre a bypassare la RLS).
revoke all on cs_conversations, cs_messages, cs_events, cs_drafts, cs_faq from anon, authenticated;
grant select on cs_conversations, cs_messages, cs_events, cs_drafts, cs_faq to authenticated;
