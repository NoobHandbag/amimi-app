-- 0131: cron giornaliero per ads-sync (pull di IERI a livello ad/creativita', feature Amimì Ads, caso #12).
-- Orario 06:07 UTC (08:07 in ora legale, 07:07 in ora solare): DOPO refresh_health_log() delle 06:00 UTC, che cancella
-- le righe del giorno con chiave non ce_*/sales_*/shipping_status (la riga ads_sync scritta prima sparirebbe, come
-- gia' accade a shopify_sync fra un giro e l'altro), e fuori dai secondi :00-:03 in cui PostgREST risponde 504
-- (caso aperto #19). Stesso pattern degli altri cron (0024/0032/0054): net.http_post con il PIN neutro.
-- Il backfill NON parte mai dal cron: action='backfill' solo a mano (tetto 30 giorni per chiamata).
select cron.schedule('ads-sync-daily', '7 6 * * *',
  $$ select net.http_post(
       url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/ads-sync',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"pin":"x","source":"cron"}'::jsonb
     ) $$);

insert into change_log (tbl, row_id, op, after, chi, source) values (
  'cron.job', 'ads-sync-daily', 'cron_create',
  jsonb_build_object('schedule', '7 6 * * *', 'edge', 'ads-sync', 'motivo', 'ingest Meta Ads giornaliero a livello creativita'' (caso #12)'),
  'claude-code', 'migration_0131'
);
