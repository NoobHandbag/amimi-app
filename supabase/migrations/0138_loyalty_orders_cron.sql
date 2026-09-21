-- 0138: cron ogni 15 minuti per loyalty-orders (Premia: accredito acquisti + storno resi). Stesso pattern degli altri
-- cron (0024/0032/0054/0131): net.http_post col PIN neutro. Minuti 10,25,40,55: lontani da shopify-sync (:07),
-- shopify-stock (:17), autopush (:27) e ce-guard (:30), che condividono il bucket REST; la edge v3 usa GraphQL
-- (bucket separato) e il giro resta leggero: 1 query + al massimo 100 RPC. Il backfill NON parte mai dal cron.
-- Fermo d'emergenza: update app_flags set value='false' where key='loyalty_purchase_enabled' (il giro diventa NO-OP)
-- oppure select cron.alter_job((select jobid from cron.job where jobname='loyalty-orders-poll'), active := false).
select cron.schedule('loyalty-orders-poll', '10,25,40,55 * * * *',
  $$ select net.http_post(
       url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/loyalty-orders',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"action":"run","pin":"x","source":"cron"}'::jsonb
     ) $$);

insert into change_log (tbl, row_id, op, after, chi, source) values
  ('cron.job', 'loyalty-orders-poll', 'cron_create',
   '{"schedule":"10,25,40,55 * * * *","edge":"loyalty-orders","action":"run","migr":"0138_loyalty_orders_cron"}'::jsonb,
   'claude-code', 'quest-audit-fase6');
