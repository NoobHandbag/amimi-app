-- 0169_beh_schema.sql (2026-10-25): modulo beh_* (comportamento utenti, Regola Ferrea 19), passo 1 della Fase 3.
-- Disegno: gestionale-ami Cowork12/projects/Analisi_Comportamento_Utenti_2026-10/04_DESIGN_ECOSISTEMA.md (sez. 4.1,
-- 4.2, 4.9, 6), approvato da Dan il 25-10 con D3-D8 e la "sicurezza proporzionata ai dati".
--
-- Modulo ADDITIVO: prefisso proprio, nessuna colonna sulle tabelle core. Del core si legge solo app_flags (e,
-- nella salute, meta_ads_creative_daily quando il passo meta e' acceso). Scrive health_log solo su chiavi beh_*.
-- Rollback = beh_enabled a 'false': il cron non chiama piu' la edge (cancello nel comando), la edge risponde
-- skipped a un run a mano e beh_health_check() tace.
--
-- Postura = push_* (migr 0163): RLS accesa, nessuna policy, REVOKE a public/anon/authenticated, grant esplicito al
-- service_role. Idempotenza a DB (Regola 20): PK naturale sull'id Shopify dell'ordine, la edge fa upsert.
begin;

-- 0) cosa nasce in questa migrazione (per change_log e per le prove finali)
do $$ begin
  perform set_config('amimi.beh_cron_ordini_nato_qui', (not exists (select 1 from cron.job where jobname = 'beh-sync-ordini'))::text, true);
  perform set_config('amimi.beh_cron_health_nato_qui', (not exists (select 1 from cron.job where jobname = 'beh-health'))::text, true);
end $$;

-- 1) interruttori e soglie. beh_enabled nasce SPENTO; on conflict do nothing: un valore cambiato a mano non viene
--    sovrascritto da un re-run. beh_steps = passi accesi separati da virgole (oggi il solo 'ordini').
--    Soglie di partenza (D8, da tarare dopo 4 settimane di dati): quota tracciata < 60% su 28 giorni con almeno 80
--    ordini online = warn; 0 tracciati su almeno 5 ordini online in 48 ore = error; un passo giornaliero senza giro
--    riuscito da 48 ore = error.
do $$ begin
  insert into app_flags (key, value) values ('beh_enabled', 'false') on conflict (key) do nothing;
  perform set_config('amimi.beh_flag_nato_qui', found::text, true);
end $$;
insert into app_flags (key, value) values
  ('beh_steps', ''),
  ('beh_tracciata_min_pct', '60'),
  ('beh_tracciata_min_ordini', '80'),
  ('beh_guasto_min_ordini', '5'),
  ('beh_fresh_ore', '48')
on conflict (key) do nothing;

-- 2) telemetria dei giri (stampo lead_runs, 0111): una riga per giro di un passo, scritta dalla edge.
create table if not exists beh_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  step          text not null,
  action        text not null,
  source        text not null default 'manuale',
  run_day       date not null,                    -- giorno di Roma del giro
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  status        text not null default 'running',
  window_from   date,
  window_to     date,
  rows_read     int,
  rows_written  int,
  error         text,
  meta          jsonb not null default '{}'::jsonb,
  constraint beh_sync_runs_step_ck check (step in ('ordini', 'meta', 'sessioni', 'klaviyo', 'ga4', 'crux', 'psi')),
  constraint beh_sync_runs_action_ck check (action in ('run', 'backfill')),
  constraint beh_sync_runs_status_ck check (status in ('running', 'ok', 'warn', 'error', 'skipped'))
);
create index if not exists beh_sync_runs_step_started_ix on beh_sync_runs (step, started_at desc);

-- 3) origine degli ordini: una riga per ordine, senza dati del cliente (D2 decisa il 25-10). Fonte: Admin GraphQL
--    Order.app + customerJourneySummary (scope read_orders). Le sorgenti sono classi, i landing sono path senza query
--    string (checkout e pagine d'ordine = 'checkout', contengono un token).
create table if not exists beh_order_origin (
  order_gid_num       bigint primary key,           -- id numerico Shopify dell'ordine (gid://shopify/Order/<n>)
  order_name          text not null,                -- '#1949', per unire a shopify_orders.order_id
  created_at_shop     timestamptz not null,
  day                 date not null,                -- giorno di Roma di createdAt
  canale              text not null,                -- online_store, bozza, facebook_instagram, shop, app:<id>, sconosciuto
  app_id              text not null default '',
  is_test             boolean not null,
  is_cancelled        boolean not null,
  ready               boolean not null,             -- false = Shopify sta ancora attribuendo: si rilegge
  moments             int,                          -- visite registrate; null finche' l'attribuzione e' in corso
  first_src           text not null default '',
  last_src            text not null default '',
  first_ref_host      text not null default '',
  last_ref_host       text not null default '',
  first_utm_source    text not null default '',
  first_utm_medium    text not null default '',
  first_utm_campaign  text not null default '',
  last_utm_source     text not null default '',
  last_utm_medium     text not null default '',
  last_utm_campaign   text not null default '',
  first_landing       text not null default '',
  last_landing        text not null default '',
  first_visit_at      timestamptz,
  days_to_conv        int,                          -- ricalcolato da firstVisit.occurredAt (quello di Shopify non regge)
  synced_at           timestamptz not null default now(),
  constraint beh_order_origin_canale_ck check (canale ~ '^[a-z_]+(:[0-9]+)?$'),
  constraint beh_order_origin_first_src_ck check (first_src in ('', 'none', 'direct', 'search', 'social', 'email', 'paid_social', 'paid_search', 'referral', 'unknown')),
  constraint beh_order_origin_last_src_ck check (last_src in ('', 'none', 'direct', 'search', 'social', 'email', 'paid_social', 'paid_search', 'referral', 'unknown'))
);
create index if not exists beh_order_origin_day_ix on beh_order_origin (day);

comment on table beh_sync_runs is 'Modulo beh_*: un giro di un passo di beh-sync (esito, finestra, righe, costo). Solo service_role.';
comment on table beh_order_origin is 'Modulo beh_*: origine di ogni ordine Shopify (canale, prima e ultima visita, UTM, tracciato). Solo service_role.';

-- 4) sicurezza: RLS senza policy + REVOKE (Regola 19), grant esplicito al service_role come 0128/0163.
alter table beh_sync_runs enable row level security;
alter table beh_order_origin enable row level security;
revoke all on beh_sync_runs, beh_order_origin from public, anon, authenticated;
grant select, insert, update, delete on beh_sync_runs, beh_order_origin to service_role;

-- 5) flag leggibile dai client, SOLO questa chiave (stampo v_push_settings, 0163): la tab Comportamento si nasconde a
--    flag spento. security_barrier e revoke anche ad anon/authenticated: la vista e' aggiornabile e scriverebbe in
--    app_flags coi diritti del proprietario.
create or replace view v_beh_settings with (security_barrier = true) as
select key, value from app_flags where key in ('beh_enabled');
revoke all on v_beh_settings from public, anon, authenticated;
grant select on v_beh_settings to anon, authenticated;

-- 6) salute del modulo (stampo push_eventi_salute 0166 e loyalty_health_check 0137): una edge ferma non scrive niente,
--    quindi la freschezza la guarda il DB. Scrive solo chiavi beh_* (upsert sul giorno UTC, come refresh_health_log).
--    A modulo spento non scrive niente. Soglie da app_flags lette con un controllo di formato: un valore scritto
--    male non blocca la funzione, va sul default e accende beh_fresh in error col nome della soglia.
create or replace function public.beh_flag_num(p_key text, p_default numeric, inout p_bad text, out p_val numeric)
language plpgsql stable set search_path to 'public' as $fn$
declare v_raw text;
begin
  select value into v_raw from app_flags where key = p_key;
  -- al massimo 4 cifre intere: un valore enorme farebbe fallire il cast o make_interval e fermerebbe la funzione
  if v_raw is not null and btrim(v_raw, E' \t\r\n') ~ '^[0-9]{1,4}(\.[0-9]+)?$' then
    p_val := btrim(v_raw, E' \t\r\n')::numeric;
  else
    p_val := p_default;
    p_bad := concat_ws(', ', nullif(p_bad, ''), p_key);
  end if;
end $fn$;
revoke all on function public.beh_flag_num(text, numeric, text) from public, anon, authenticated;
grant execute on function public.beh_flag_num(text, numeric, text) to service_role;

create or replace function public.beh_health_check() returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_steps text[];
  v_bad text := '';
  v_fresh_ore numeric;
  v_min_pct numeric;
  v_min_ord numeric;
  v_guasto_min numeric;
  v_s text;
  v_last timestamptz;
  v_stale text;
  v_n int;
  v_trk int;
  v_oggi date := (now() at time zone 'Europe/Rome')::date;
  v_meta_max date;
begin
  if not exists (select 1 from app_flags where key = 'beh_enabled' and lower(btrim(value, E' \t\r\n')) = 'true') then
    return;
  end if;
  -- stesso parsing della edge (trim + minuscole): la stessa riga deve accendere gli stessi passi da SQL e da TypeScript
  select coalesce(array_agg(lower(btrim(x, E' \t\r\n'))) filter (where btrim(x, E' \t\r\n') <> ''), '{}') into v_steps
    from regexp_split_to_table(coalesce((select value from app_flags where key = 'beh_steps'), ''), ',') as x;

  select p_bad, p_val into v_bad, v_fresh_ore from public.beh_flag_num('beh_fresh_ore', 48, v_bad);
  select p_bad, p_val into v_bad, v_min_pct from public.beh_flag_num('beh_tracciata_min_pct', 60, v_bad);
  select p_bad, p_val into v_bad, v_min_ord from public.beh_flag_num('beh_tracciata_min_ordini', 80, v_bad);
  select p_bad, p_val into v_bad, v_guasto_min from public.beh_flag_num('beh_guasto_min_ordini', 5, v_bad);

  -- beh_fresh: ogni passo acceso deve avere un giro riuscito (ok o warn) del cron entro la sua soglia; un backfill
  -- a mano non conta, altrimenti coprirebbe per 48 ore un cron che non arriva alla edge
  foreach v_s in array v_steps loop
    select max(r.ended_at) into v_last from beh_sync_runs r where r.step = v_s and r.action = 'run' and r.status in ('ok', 'warn');
    if v_last is null or v_last < now() - make_interval(hours => (case when v_s in ('crux', 'psi') then 8 * 24 else v_fresh_ore end)::int) then
      v_stale := concat_ws(', ', v_stale, v_s || coalesce(' (ultimo ' || to_char(v_last at time zone 'Europe/Rome', 'DD-MM HH24:MI') || ')', ' (mai)'));
    end if;
  end loop;
  if 'meta' = any(v_steps) then
    select max(date) into v_meta_max from meta_ads_creative_daily;
    if v_meta_max is null or v_meta_max < v_oggi - 1 then
      v_stale := concat_ws(', ', v_stale, 'meta_ads_creative_daily ferma al ' || coalesce(to_char(v_meta_max, 'DD-MM'), 'mai'));
    end if;
  end if;
  insert into health_log (day, k, label, n, severity, created_at)
  values (current_date, 'beh_fresh',
          case when v_stale is not null then 'fermi: ' || v_stale
               when cardinality(v_steps) = 0 then 'nessun passo acceso'
               else 'passi accesi: ' || array_to_string(v_steps, ', ') || ', giri recenti' end
            || case when v_bad <> '' then '; soglie non valide (uso il default): ' || v_bad else '' end,
          (case when v_stale is not null then 1 else 0 end),
          case when v_stale is not null or v_bad <> '' then 'error' else 'ok' end,
          now())
  on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = excluded.created_at;

  if 'ordini' = any(v_steps) then
    -- guasto: nessun ordine online tracciato nelle ultime 48 ore su almeno beh_guasto_min_ordini ordini
    select count(*), count(*) filter (where o.moments > 0) into v_n, v_trk
      from beh_order_origin o
     where o.canale = 'online_store' and not o.is_test and not o.is_cancelled and o.ready
       and o.created_at_shop >= now() - interval '48 hours';
    insert into health_log (day, k, label, n, severity, created_at)
    values (current_date, 'beh_tracciamento_guasto',
            'ultime 48 ore: ' || v_n || ' ordini online, ' || v_trk || ' con visite registrate'
              || case when v_n >= greatest(v_guasto_min, 1) and v_trk = 0 then ' (tag o banner da controllare)' else '' end,
            v_n - v_trk,
            case when v_n >= greatest(v_guasto_min, 1) and v_trk = 0 then 'error' else 'ok' end,
            now())
    on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = excluded.created_at;

    -- deriva: quota tracciata degli ultimi 28 giorni interi di Roma, solo con abbastanza ordini (rumore binomiale)
    select count(*), count(*) filter (where o.moments > 0) into v_n, v_trk
      from beh_order_origin o
     where o.canale = 'online_store' and not o.is_test and not o.is_cancelled and o.ready
       and o.day >= v_oggi - 28 and o.day < v_oggi;
    insert into health_log (day, k, label, n, severity, created_at)
    values (current_date, 'beh_quota_tracciata',
            case when v_n < v_min_ord then 'quota tracciata 28 giorni: pochi ordini (' || v_n || ', servono ' || v_min_ord || ')'
                 else 'quota tracciata 28 giorni: ' || coalesce(replace(to_char(round(100.0 * v_trk / nullif(v_n, 0), 1), 'FM990.0'), '.', ','), '-') || '% ('
                      || v_trk || ' su ' || v_n || ' ordini online), soglia ' || v_min_pct || '%' end,
            v_n,
            case when v_n > 0 and v_n >= v_min_ord and 100.0 * v_trk / nullif(v_n, 0) < v_min_pct then 'warn' else 'ok' end,
            now())
    on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = excluded.created_at;
  end if;

  delete from beh_sync_runs where started_at < now() - interval '180 days';
end $fn$;
revoke all on function public.beh_health_check() from public, anon, authenticated;
grant execute on function public.beh_health_check() to service_role;

-- 7) cron (stampo 0138/0166): net.http_post col PIN neutro, timeout 60 s (col default di 5 s pg_net registra
--    "timeout" un giro solo lento). Minuti liberi verificati il 25-10 su cron.job: 06:19 e 06:47 UTC, dopo
--    refresh_health_log delle 06:00 e lontani da loyalty-orders-poll (:10, :25) sul bucket GraphQL di Shopify.
--    cron.schedule sullo stesso nome aggiorna il job invece di crearne un secondo.
--    Il cancello sul flag sta nel comando: a modulo spento il cron non chiama nemmeno la edge (zero letture, zero
--    righe di salute); backfill e diag restano a mano.
-- Fermo d'emergenza: update app_flags set value = 'false' where key = 'beh_enabled' (giro NO-OP) oppure
-- select cron.alter_job((select jobid from cron.job where jobname = 'beh-sync-ordini'), active := false).
select cron.schedule('beh-sync-ordini', '19 6 * * *',
  $cmd$ select net.http_post(
       url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/beh-sync',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"action":"run","step":"ordini","pin":"x","source":"cron"}'::jsonb,
       timeout_milliseconds := 60000
     ) where exists (select 1 from public.app_flags where key = 'beh_enabled' and lower(btrim(value, E' \t\r\n')) = 'true') $cmd$);
select cron.schedule('beh-health', '47 6 * * *', $cmd$ select public.beh_health_check() $cmd$);

insert into change_log (tbl, row_id, op, after, chi, source)
select 'cron.job', 'beh-sync-ordini', 'cron_create',
       '{"schedule":"19 6 * * *","edge":"beh-sync","action":"run","step":"ordini","migr":"0169_beh_schema","gate":"app_flags.beh_enabled + beh_steps"}'::jsonb,
       'claude-code', 'beh'
 where current_setting('amimi.beh_cron_ordini_nato_qui', true) = 'true';
insert into change_log (tbl, row_id, op, after, chi, source)
select 'cron.job', 'beh-health', 'cron_create',
       '{"schedule":"47 6 * * *","fn":"beh_health_check","migr":"0169_beh_schema","gate":"app_flags.beh_enabled"}'::jsonb,
       'claude-code', 'beh'
 where current_setting('amimi.beh_cron_health_nato_qui', true) = 'true';

-- 8) prova dentro la stessa transazione: se qualcosa non torna la migrazione non passa.
do $$
declare
  t text;
  r name;
  v_vincolo text;
  v_grant text;
  v_flag text;
  v_nato text := current_setting('amimi.beh_flag_nato_qui', true);
  f text;
begin
  foreach t in array array['beh_sync_runs', 'beh_order_origin'] loop
    if not (select cl.relrowsecurity from pg_class cl where cl.oid = ('public.' || t)::regclass) then
      raise exception '0169: RLS spenta su %', t;
    end if;
    if exists (select 1 from pg_policy p where p.polrelid = ('public.' || t)::regclass) then
      raise exception '0169: % ha una policy, deve restare senza (solo service_role)', t;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      if has_table_privilege(r, 'public.' || t, 'select, insert, update, delete, truncate, references, trigger')
         or has_any_column_privilege(r, 'public.' || t, 'select, insert, update, references') then
        raise exception '0169: % ha ancora privilegi su %', r, t;
      end if;
    end loop;
    if not (has_table_privilege('service_role', 'public.' || t, 'select') and has_table_privilege('service_role', 'public.' || t, 'insert')
            and has_table_privilege('service_role', 'public.' || t, 'update') and has_table_privilege('service_role', 'public.' || t, 'delete')) then
      raise exception '0169: service_role non legge e scrive % (beh-sync non funzionerebbe)', t;
    end if;
  end loop;

  foreach r in array array['anon', 'authenticated'] loop
    if not has_table_privilege(r, 'public.v_beh_settings', 'select') then
      raise exception '0169: % non legge v_beh_settings', r;
    end if;
    if has_table_privilege(r, 'public.v_beh_settings', 'insert, update, delete, truncate, references, trigger') then
      raise exception '0169: % puo'' scrivere attraverso v_beh_settings', r;
    end if;
  end loop;

  select string_agg(format('%s a %s su %s', a.privilege_type, coalesce(g.rolname, 'PUBLIC'), cl.relname), ', ' order by cl.relname)
    into v_grant
    from pg_class cl
    cross join lateral aclexplode(cl.relacl) a
    left join pg_roles g on g.oid = a.grantee
   where cl.oid in ('public.beh_sync_runs'::regclass, 'public.beh_order_origin'::regclass, 'public.v_beh_settings'::regclass)
     and (a.grantee = 0 or g.rolname in ('anon', 'authenticated'))
     and not (cl.relname = 'v_beh_settings' and a.grantee <> 0 and a.privilege_type = 'SELECT');
  if v_grant is not null then raise exception '0169: privilegi di troppo: %', v_grant; end if;

  foreach f in array array['public.beh_health_check()', 'public.beh_flag_num(text, numeric, text)'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'execute') then raise exception '0169: % puo'' eseguire %', r, f; end if;
    end loop;
  end loop;

  foreach v_vincolo in array array['beh_sync_runs_step_ck', 'beh_sync_runs_action_ck', 'beh_sync_runs_status_ck',
                                   'beh_order_origin_canale_ck', 'beh_order_origin_first_src_ck', 'beh_order_origin_last_src_ck'] loop
    if not exists (select 1 from pg_constraint k where k.conname = v_vincolo and k.connamespace = 'public'::regnamespace) then
      raise exception '0169: vincolo mancante %', v_vincolo;
    end if;
  end loop;
  -- colonne = contratto con beh-sync: una tabella preesistente diversa non deve passare
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = 'public.beh_order_origin'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'order_gid_num,order_name,created_at_shop,day,canale,app_id,is_test,is_cancelled,ready,moments,first_src,last_src,first_ref_host,last_ref_host,first_utm_source,first_utm_medium,first_utm_campaign,last_utm_source,last_utm_medium,last_utm_campaign,first_landing,last_landing,first_visit_at,days_to_conv,synced_at' then
    raise exception '0169: colonne di beh_order_origin diverse dal contratto';
  end if;
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = 'public.beh_sync_runs'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'id,step,action,source,run_day,started_at,ended_at,status,window_from,window_to,rows_read,rows_written,error,meta' then
    raise exception '0169: colonne di beh_sync_runs diverse dal contratto';
  end if;

  if (select count(*) from v_beh_settings) <> 1 or exists (select 1 from v_beh_settings where key <> 'beh_enabled') then
    raise exception '0169: v_beh_settings deve esporre la sola chiave beh_enabled';
  end if;
  select value into v_flag from app_flags where key = 'beh_enabled';
  if not found then raise exception '0169: manca app_flags.beh_enabled'; end if;
  if v_nato is null then raise exception '0169: non so se beh_enabled e'' nato in questa migrazione'; end if;
  if v_nato = 'true' and v_flag is distinct from 'false' then
    raise exception '0169: beh_enabled nato qui vale % invece di false', v_flag;
  end if;
  if (select count(*) from app_flags where key in ('beh_steps', 'beh_tracciata_min_pct', 'beh_tracciata_min_ordini', 'beh_guasto_min_ordini', 'beh_fresh_ore')) <> 5 then
    raise exception '0169: mancano flag o soglie del modulo';
  end if;

  if (select count(*) from cron.job where jobname in ('beh-sync-ordini', 'beh-health') and active) <> 2 then
    raise exception '0169: cron beh-sync-ordini o beh-health mancanti o spenti';
  end if;
end $$;

commit;
