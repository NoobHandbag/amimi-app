-- CS Fase 2: colonna `flags` (fuori-tassonomia) su cs_conversations.
-- Le altre colonne AI (categoria, categoria_source, categoria_confidence, urgente, urgenza_motivo,
-- lingua) esistono gia' dalla 0053 (create nullable). Qui manca solo `flags`.
-- flags = array di etichette fuori dalle 13 categorie (design 6.2): 'sollecito', 'reclamo_assistenza',
-- 'chiusura'. NON contiene 'urgente' (quella e' la colonna booleana `urgente` + `urgenza_motivo`).
-- RLS invariata: SELECT authenticated, scritture solo service_role (nessuna colonna generata).
alter table cs_conversations
  add column if not exists flags jsonb not null default '[]'::jsonb;
