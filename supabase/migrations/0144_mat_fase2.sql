-- 0144: materie prime Fase 2: scritture dall'app (edge mat-api) + strato AI "Compila" (edge ai-compila).
-- Brief: Cowork12/docs/Codice_e_Automazione/BRIEF_materie_prime_fase2_ai_compila_2026-09-23.md
-- Numero 0144: in prod al 23-09 mattina c'erano gia' 0141/0142/0143 (Premia, altra sessione).
--
-- Additiva (Regola 19): nessuna colonna su tabelle core, nessun innesto in write-api. Due flag nuovi, default OFF:
--   mat_write_enabled   -> mat-api accetta scritture (a OFF risponde {state:'off'}, la UI resta in sola lettura)
--   ai_compila_enabled  -> ai-compila risponde (a OFF {state:'off'}, il bottone "Compila" non compare)
-- Rollback = flag OFF. Le tabelle restano.

-- Log dello strato AI: ogni chiamata a Gemini, con l'esito umano (confermato / modificato / scartato) scritto poi da
-- mat-api o dalla UI. Serve a misurare se l'AI aiuta davvero. Solo service_role: nessun privilegio ai ruoli applicativi.
create table if not exists ai_compila_log (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  chi          text not null,
  email        text,
  target       text not null check (target in ('materiale','fornitore','ordine_prodotti')),
  n_immagini   integer not null default 0,
  input_hash   text,
  testo        text,
  modello      text,
  ms           integer,
  output       jsonb,
  errore       text,
  esito        text check (esito in ('proposto','confermato','modificato','scartato','errore')),
  ref_tabella  text,
  ref_id       text,
  esito_at     timestamptz
);
create index if not exists ai_compila_log_at_idx on ai_compila_log (at desc);
alter table ai_compila_log enable row level security;
revoke all on ai_compila_log from anon, authenticated;

-- updated_at che si aggiorna davvero (in 0140 la colonna c'era ma restava ferma)
create or replace function mat_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists mat_suppliers_touch on mat_suppliers;
create trigger mat_suppliers_touch before update on mat_suppliers for each row execute function mat_touch_updated_at();
drop trigger if exists mat_items_touch on mat_items;
create trigger mat_items_touch before update on mat_items for each row execute function mat_touch_updated_at();

-- Storage: l'utente loggato @amimi.it carica foto e documenti SOLO sotto inbox/ (i file del seed restano del service_role)
drop policy if exists mat_assets_ins on storage.objects;
create policy mat_assets_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'mat-assets' and (auth.jwt() ->> 'email') ilike '%@amimi.it' and name like 'inbox/%');

-- La vista dei settings espone i tre flag del modulo (solo questi): la UI gating dei bottoni li legge da qui
create or replace view v_mat_settings as
select key, value from app_flags where key in ('mat_enabled', 'mat_write_enabled', 'ai_compila_enabled');
revoke all on v_mat_settings from public;
grant select on v_mat_settings to anon, authenticated;

insert into app_flags (key, value) values ('mat_write_enabled', 'false') on conflict (key) do nothing;
insert into app_flags (key, value) values ('ai_compila_enabled', 'false') on conflict (key) do nothing;
