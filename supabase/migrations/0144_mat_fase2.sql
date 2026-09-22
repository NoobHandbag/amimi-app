-- 0144: materie prime Fase 2 (scritture dall'app via edge mat-api + strato AI "Compila" via edge ai-compila).
-- Brief: Cowork12/docs/Codice_e_Automazione/BRIEF_materie_prime_fase2_ai_compila_2026-09-23.md (D5-D8 accettate dall'owner 23-09).
-- Numero 0144 perche' in produzione ci sono gia' 0140 (mat) e 0141-0143 (Premia): letto da schema_migrations prima di scrivere.
--
-- Modulo ADDITIVO (Regola Ferrea 19): solo tabelle/flag con prefisso proprio, core mai toccato, write-api mai toccata.
-- Le scritture dei dati mat_* restano SOLO alla edge mat-api (service_role dopo JWT @amimi.it): nessun grant di
-- INSERT/UPDATE/DELETE ai ruoli applicativi. L'unica scrittura concessa al client loggato e' l'UPLOAD nel bucket
-- privato mat-assets, e solo sotto `inbox/`: il file caricato NON e' un dato finche' mat-api non lo registra in mat_assets.
-- Rollback = flag: mat_write_enabled OFF (sezione in sola lettura come oggi), ai_compila_enabled OFF (sparisce "Compila").

-- ---------------------------------------------------------------------------
-- Log dello strato AI: ogni chiamata a Gemini, con la proposta e l'esito umano (Regola 1: l'AI propone, l'umano conferma)
-- ---------------------------------------------------------------------------
create table if not exists ai_compila_log (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  chi          text not null,
  email        text,                                       -- utente loggato che ha chiesto la compilazione
  target       text not null check (target in ('materiale','fornitore','ordine_prodotti')),
  n_immagini   int not null default 0,
  input_hash   text,                                       -- sha256 di immagini + testo: stessa richiesta = stesso hash
  testo        text,                                       -- la nota dettata
  output       jsonb,                                      -- la proposta cosi' com'e' tornata (validata)
  modello      text,
  ms           int,
  esito        text not null default 'proposta' check (esito in ('proposta','confermato','modificato','scartato','errore')),
  ref_tabella  text,                                       -- dove e' finita la conferma (mat_items, mat_suppliers, supplier_orders)
  ref_id       uuid,
  errore       text,
  esito_at     timestamptz
);
create index if not exists ai_compila_log_at_idx on ai_compila_log (at desc);
alter table ai_compila_log enable row level security;
revoke all on ai_compila_log from anon, authenticated;      -- lo legge e lo scrive solo il service_role (le edge)

-- ---------------------------------------------------------------------------
-- updated_at che si aggiorna davvero (in Fase 1 la colonna c'era ma restava ferma)
-- ---------------------------------------------------------------------------
create or replace function mat_touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists mat_suppliers_touch on mat_suppliers;
create trigger mat_suppliers_touch before update on mat_suppliers for each row execute function mat_touch_updated_at();
drop trigger if exists mat_items_touch on mat_items;
create trigger mat_items_touch before update on mat_items for each row execute function mat_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Storage: l'utente loggato @amimi.it puo' CARICARE (mai leggere fuori dal SELECT gia' esistente, mai cancellare)
-- solo sotto inbox/ del bucket privato mat-assets. I file del seed restano scrivibili solo dal service_role.
-- ---------------------------------------------------------------------------
-- tetti del bucket (valgono per gli upload nuovi): 10 MB per file e solo i tipi che il modulo sa trattare
update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf','application/vnd.oasis.opendocument.text','application/octet-stream']
where id = 'mat-assets';
drop policy if exists mat_assets_ins on storage.objects;
create policy mat_assets_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'mat-assets' and (auth.jwt() ->> 'email') ilike '%@amimi.it' and name like 'inbox/%');

-- ---------------------------------------------------------------------------
-- Flag del modulo (default OFF, Regola 19) e vista impostazioni per la UI (solo chiavi non sensibili)
-- ---------------------------------------------------------------------------
insert into app_flags (key, value) values
  ('mat_write_enabled', 'false'),
  ('ai_compila_enabled', 'false'),
  ('ai_compila_model', 'gemini-flash-lite-latest')
on conflict (key) do nothing;

create or replace view v_mat_settings as
select key, value from app_flags where key in ('mat_enabled', 'mat_write_enabled', 'ai_compila_enabled');
revoke all on v_mat_settings from public;
grant select on v_mat_settings to anon, authenticated;
