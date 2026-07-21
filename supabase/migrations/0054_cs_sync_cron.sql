-- 0054: cron di polling del tool assistenza (Fase 1). Gira ogni 2 minuti e invoca cs-sync azione poll
-- con source='cron'. La edge, con source='cron' + cs_enabled!='true', fa skip immediato (nessuna lettura
-- Gmail, nessuna scrittura): cs_enabled e' l'INTERRUTTORE di go-live, deciso dall'owner. Finche' e' false
-- questo job e' un no-op. Stesso pattern net.http_post degli altri cron (shopify-sync :07, ce-guard :30).
-- Nessun segreto: URL pubblico + pin 'x' (gia' pubblici, come le altre edge PIN-gated).
select cron.schedule(
  'cs-sync-poll',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/cs-sync',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"pin":"x","action":"poll","source":"cron"}'::jsonb
  );
  $$
);
