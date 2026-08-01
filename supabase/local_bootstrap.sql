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
