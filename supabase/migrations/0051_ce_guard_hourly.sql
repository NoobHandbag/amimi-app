-- 0051 (2026-07-09): ce-guard da giornaliera (06:30) a ORARIA (:30). Cosi' gli allarmi ntfy
-- (aggiunti alla ce-guard v3) arrivano entro un'ora dal problema, non entro 24h. La ce-guard
-- notifica SOLO al cambio dell'insieme dei problemi error -> niente spam orario. I check sono
-- leggeri (count + 2 chiamate count a Shopify). Il nome del job resta 'ce-guard-daily' (pg_cron
-- non rinomina via alter_job); conta la schedule.
do $$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'ce-guard-daily';
  if jid is not null then
    perform cron.alter_job(job_id := jid, schedule := '30 * * * *');
  end if;
end $$;
