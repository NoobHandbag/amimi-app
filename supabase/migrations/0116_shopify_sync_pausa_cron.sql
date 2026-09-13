-- 0116: PAUSA dei cron `shopify-sync-hourly` (:07) e `shopify-autopush-hourly` (:27) per la bonifica
-- dei doppioni di shopify_orders / shopify_line_items (brief Cowork 2026-09-13, incidente del 12-09).
-- Ogni giro di shopify-sync poteva aggiungere altre 250 righe doppie (select PostgREST in 504 non
-- controllata, poi cap 1.000 righe) e l'autopush spingeva su Shopify quantita' calcolate su vendite
-- contate 2-4 volte. Il pull stock `shopify-stock-hourly` (:17) resta attivo: legge soltanto.
-- Riattivazione: migr 0118, a bonifica (0117) e deploy della edge corretta avvenuti.
-- Nota: `update cron.job set active=false` (forma del brief) e' vietato al ruolo delle migrazioni
-- ("permission denied for table job"); si passa dalla funzione `cron.alter_job`, che invece e' ammessa.
-- Applicata il 2026-09-13 15:14 UTC, prima del push delle 15:27.
select cron.alter_job(job_id := jobid, active := false) from cron.job where jobname in ('shopify-sync-hourly', 'shopify-autopush-hourly');

insert into change_log (tbl, row_id, op, after, chi, source) values (
  'cron.job', 'shopify-sync-hourly,shopify-autopush-hourly', 'cron_pause',
  jsonb_build_object('motivo', 'bonifica doppioni shopify_orders 2026-09-13 (brief Cowork)', 'riattivazione', 'migr 0118'),
  'claude-code', 'migration_0116'
);
