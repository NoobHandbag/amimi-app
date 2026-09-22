-- 0139: outreach B2B, bozze AI e invio dall'app (missione M2, call Dan + Benny 22-09).
-- Modulo lead_* (Regola Ferrea 19): tocca SOLO tabelle lead_* e aggiunge flag lead_*, core in sola lettura.
-- Chi scrive: la nuova edge `lead-outreach` (service_role) dopo aver verificato il JWT @amimi.it.
-- La UI resta in sola LETTURA su lead_drafts (policy SELECT gia' esistente dalla 0111).
-- Rollback: `lead_outreach_ai_enabled` = false (la edge risponde 403 a bozza e invio).
--
-- Idempotenza a DB (Regola Ferrea 20), tre livelli:
--   1) `send_key` UNIQUE: doppio click o retry di rete con la stessa chiave = una sola email.
--   2) indice unico parziale (account, tocco) sulle bozze in invio o inviate: lo STESSO tocco della
--      sequenza non puo' partire due volte verso lo stesso negozio, nemmeno da due bozze diverse.
--   In piu' `lead_touches.gmail_message_id` e' gia' UNIQUE (0111): il tocco si registra una volta sola.

alter table lead_drafts add column if not exists oggetto         text;
alter table lead_drafts add column if not exists to_email        text;
alter table lead_drafts add column if not exists sequenza_tocco  int;
alter table lead_drafts add column if not exists model           text;
alter table lead_drafts add column if not exists send_key        uuid;
alter table lead_drafts add column if not exists sent_at         timestamptz;
alter table lead_drafts add column if not exists sent_by         text;
alter table lead_drafts add column if not exists gmail_message_id text;
alter table lead_drafts add column if not exists gmail_thread_id  text;
alter table lead_drafts add column if not exists errore          text;
alter table lead_drafts add column if not exists updated_at      timestamptz not null default now();

alter table lead_drafts drop constraint if exists lead_drafts_stato_check;
alter table lead_drafts add constraint lead_drafts_stato_check
  check (stato in ('proposta', 'approvata', 'in_invio', 'inviata', 'errore', 'scartata'));

create unique index if not exists lead_drafts_send_key_uq on lead_drafts (send_key) where send_key is not null;
create unique index if not exists lead_drafts_tocco_uq on lead_drafts (account_id, sequenza_tocco)
  where stato in ('in_invio', 'inviata') and sequenza_tocco is not null;
create index if not exists lead_drafts_account_idx on lead_drafts (account_id, created_at desc);

-- 3) anche i tocchi registrati A MANO ("Segna come inviata" dopo un invio da Gmail) contano: un tocco email
--    in uscita per (negozio, numero di tocco), qualunque sia il canale di invio. Tabella vuota al 22-09.
create unique index if not exists lead_touches_tocco_out_uq on lead_touches (account_id, sequenza_tocco)
  where direzione = 'out' and canale = 'email' and sequenza_tocco is not null;

-- flag del modulo: default OFF (Regola 19). Il link della line sheet resta vuoto finche' non esiste
-- la pagina B2B (M3): la bozza mette un segnaposto [DA VERIFICARE] e l'invio lo blocca.
insert into app_flags (key, value) values
  ('lead_outreach_ai_enabled', 'false'),
  ('lead_linesheet_url', '')
on conflict (key) do nothing;

-- la UI deve sapere se i bottoni sono attivi e qual e' il link: stesse regole della 0115
-- (vista di proprieta' postgres, solo chiavi lead_* non sensibili, solo authenticated).
create or replace view v_lead_settings as
select key, value from app_flags
where key in ('lead_enabled', 'lead_firma', 'lead_tetto_giornaliero', 'lead_outreach_ai_enabled', 'lead_linesheet_url');
revoke all on v_lead_settings from anon, public;
grant select on v_lead_settings to authenticated;
