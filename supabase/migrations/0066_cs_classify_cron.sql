-- CS Fase 2: cron del classificatore. Gira ogni 5 minuti e invoca cs-classify azione classify con
-- source='cron'. La edge, con source='cron' + cs_enabled!='true', fa skip immediato (nessuna spesa Gemini).
-- Decoupled dall'ingest (cs-sync */2): se Gemini e' giu' l'ingest continua, la classificazione riparte
-- da sola al giro dopo. Cap MAX_PER_RUN nella edge (sotto la quota free 15 RPM); il backlog si drena in
-- pochi giri. Stesso pattern net.http_post/pin 'x' degli altri cron (nessun segreto).
select cron.schedule(
  'cs-classify',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/cs-classify',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"pin":"x","action":"classify","source":"cron"}'::jsonb
  );
  $$
);
