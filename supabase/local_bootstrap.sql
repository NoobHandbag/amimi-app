-- Ponte per lo stack LOCALE (brief flows_test_non_tocchi_produzione). NON tocca la produzione.
--
-- Perche' esiste: qui le migrazioni sono spente (vedi config.toml), quindi la CLI non crea il
-- registro `supabase_migrations.schema_migrations`. Ma la vista `v_digest_versioni` dentro
-- schema.sql lo legge, e senza il registro il caricamento dello schema si ferma alla prima riga.
-- Questo file ricrea il registro con la stessa forma che gli da' la CLI, e lo lascia VUOTO:
-- in locale non c'e' nessuna migrazione applicata, e la vista deve dirlo (0 migrazioni), non
-- mentire copiando i numeri della produzione.
--
-- Va applicato PRIMA di schema.sql: l'ordine e' fissato in config.toml, sezione [db.seed].

create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);

-- Il ruolo ask_ro (lettura di ask_data, migr 0121): in produzione lo crea la 0121, qui le migrazioni sono spente e
-- schema.sql gli da' policy, grant e la proprieta' di ask_select. Senza, il caricamento dello schema si ferma su
-- "role ask_ro does not exist" (misurato il 2026-11-06, schema.sql del 01-11). Stessa forma della 0121: nologin, membro di postgres, timeout di 5 s.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ask_ro') then create role ask_ro nologin; end if;
end $$;
-- postgres deve poter fare SET ROLE ask_ro (schema.sql gli passa la proprieta' di ask_select), come nella 0121
grant ask_ro to postgres;
alter role ask_ro set statement_timeout = '5000';
-- ALTER FUNCTION ... OWNER TO ask_ro vuole CREATE sullo schema per il nuovo proprietario quando chi lo esegue non e'
-- superuser (qui postgres; in produzione la 0121 e' girata da superuser): CREATE solo per caricare schema.sql, lo
-- toglie seed.sql in testa.
grant create on schema public to ask_ro;
