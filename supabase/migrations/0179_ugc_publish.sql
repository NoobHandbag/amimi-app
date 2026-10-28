-- 0179 (2026-10-28, richiesta di Benedetta): recensioni dell'area membri pubblicate da sole sul sito. Brief
-- Cowork12/_CLAUDE_CODE_INBOX/2026-10-28_CLAUDE_CODE_BRIEF_recensioni_sito.md (hub).
-- ADDITIVA (Regola Ferrea 19): flag nuovo ugc_publish_enabled default OFF e cron nuovo della edge ugc-publish. Nessuna
-- tabella o funzione toccata: la edge legge loyalty_ugc, shopify_catalog e products e scrive solo su Shopify (metaobject
-- recensione_cliente, metafield custom.modello), change_log e health_log.
-- Rollback = flag OFF (il giro risponde {state:'off'} senza scritture). Le voci gia' sul sito restano: a flag spento si
-- tolgono dall'admin Shopify (Contenuti > Metaobject > Recensione cliente). A flag ACCESO la riconciliazione e' completa:
-- per togliere una recensione dal sito si rifiuta nell'app; per nasconderla senza rifiutarla la si mette in Bozza in
-- admin (il giro non la ripubblica). Una voce CANCELLATA in admin a flag acceso torna al giro dopo, se e' ancora approvata.

-- 1. Flag (default OFF)
insert into app_flags (key, value) values ('ugc_publish_enabled', 'false') on conflict (key) do nothing;

-- 2. Cron ogni 10 minuti, stesso schema degli altri (0138, 0166): net.http_post col PIN neutro. Minuti 9, 19, ..., 59:
--    dispari (fuori da cs-sync ogni 2 minuti), fuori dai multipli di 5 (cs-classify) e dai giri :01-:56 di push-eventi,
--    :03/:33, :07, :10/:25/:40/:55, :17, :20/:50, :27, :30. Si sovrappone solo a cs-assist-summary al :49 (ogni 7 minuti).
--    Il giro e' leggero: 4 letture GraphQL e le scritture che cambiano. timeout 60 s come push-eventi.
--    cron.schedule sullo stesso nome aggiorna il job invece di crearne un secondo.
-- Fermo d'emergenza: update app_flags set value = 'false' where key = 'ugc_publish_enabled'
-- oppure select cron.alter_job((select jobid from cron.job where jobname = 'ugc-publish'), active := false).
select cron.schedule('ugc-publish', '9,19,29,39,49,59 * * * *',
  $cmd$ select net.http_post(
       url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/ugc-publish',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"action":"run","pin":"x","source":"cron"}'::jsonb,
       timeout_milliseconds := 60000
     ) $cmd$);

-- 3. Traccia
insert into change_log (tbl, row_id, op, after, chi, source) values
  ('cron.job', 'ugc-publish', 'cron_create',
   '{"schedule":"9,19,29,39,49,59 * * * *","edge":"ugc-publish","action":"run","migr":"0179_ugc_publish","gate":"app_flags.ugc_publish_enabled","flag":"ugc_publish_enabled=false"}'::jsonb,
   'claude-code', 'migration_0179');
