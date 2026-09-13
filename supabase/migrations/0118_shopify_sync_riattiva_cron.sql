-- 0118: RIATTIVA i cron `shopify-sync-hourly` (:07) e `shopify-autopush-hourly` (:27) messi in pausa dalla 0116,
-- a bonifica fatta (0117) e con shopify-sync v7 / ce-guard v5 deployate. Stessa via della 0116: `cron.alter_job`,
-- perche' `update cron.job` e' vietato al ruolo delle migrazioni.
select cron.alter_job(job_id := jobid, active := true) from cron.job where jobname in ('shopify-sync-hourly', 'shopify-autopush-hourly');

insert into change_log (tbl, row_id, op, after, chi, source) values (
  'cron.job', 'shopify-sync-hourly,shopify-autopush-hourly', 'cron_resume',
  jsonb_build_object('motivo', 'bonifica doppioni completata (migr 0117) e shopify-sync v7 live', 'pausa', 'migr 0116'),
  'claude-code', 'migration_0118'
);
