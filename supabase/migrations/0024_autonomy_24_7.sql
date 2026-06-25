-- 0024_autonomy_24_7 — more 24/7 cloud autonomy (pg_cron, no PC needed).
-- 1) shopify-stock READ sync hourly: keeps shopify_stock (qty + images + on_shopify source) fresh.
--    READ-ONLY. The WRITE realign (push gestionale stock to Shopify) stays GATED behind
--    app_flags.shopify_write_enabled — never auto-enabled (esp. with negative-stock data issues).
-- 2) daily health snapshot into health_log: an autonomous data-quality watch (trend/record).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- hourly Shopify inventory + image read-sync (offset :17 from the :7 order sync)
select cron.schedule('shopify-stock-hourly', '17 * * * *',
  $$ select net.http_post(
       url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/shopify-stock',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"action":"sync","pin":"x"}'::jsonb
     ) $$);

-- daily data-quality snapshot
create table if not exists health_log (
  id bigserial primary key,
  day date not null default current_date,
  k text not null,
  label text,
  n integer,
  severity text,
  created_at timestamptz default now()
);
create unique index if not exists health_log_day_k on health_log (day, k);

create or replace function refresh_health_log() returns void language plpgsql as $$
begin
  delete from health_log where day = current_date;
  insert into health_log (day, k, label, n, severity)
    select current_date, k, label, n, severity from v_health;
end; $$;

select cron.schedule('health-daily', '0 6 * * *', $$ select refresh_health_log() $$);
select refresh_health_log();
