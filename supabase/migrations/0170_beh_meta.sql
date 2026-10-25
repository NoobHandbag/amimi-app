-- 0170_beh_meta.sql (2026-10-25): modulo beh_*, passo 2 della Fase 3: outbound dei click Meta (decisione D3 del 25-10:
-- tabella propria del modulo, la sync delle ads non si tocca). Disegno: 04_DESIGN_ECOSISTEMA.md sez. 3.7 e 4.3.
--
-- Perche': con le Collection il primo tocco apre l'Instant Experience e solo un secondo tocco porta al sito; i link click
-- di Meta contano entrambi. outbound_clicks separa la perdita dentro Meta da quella dopo l'uscita (Fase 1, sez. 7.4).
-- Link click, outbound e LPV si salvano dalla STESSA lettura, cosi' i rapporti si fanno sulla stessa fotografia
-- (meta_ads_creative_daily la scrive ads-sync una volta sola, a D+1). La spesa resta in meta_ads_creative_daily.
-- Idempotenza (Regola 20): PK (date, ad_id) e upsert della edge su una finestra mobile di 7 giorni. Le righe di Meta
-- per annuncio e giorno non spariscono (al massimo cambiano valore), quindi qui l'upsert basta.
-- Rollback: togliere 'meta' da app_flags.beh_steps (il passo risponde skipped) o beh_enabled a 'false' (il cron non
-- chiama piu' la edge).
begin;

do $$ begin
  perform set_config('amimi.beh_cron_meta_nato_qui', (not exists (select 1 from cron.job where jobname = 'beh-sync-meta'))::text, true);
end $$;

create table if not exists beh_meta_outbound_daily (
  date                date not null,                -- giorno dell'account Meta (Europe/Rome)
  ad_id               text not null,
  campaign_id         text not null default '',
  link_clicks         bigint not null default 0,    -- inline_link_clicks
  outbound_clicks     bigint not null default 0,    -- outbound_clicks[action_type=outbound_click]; assente = 0 nel giorno letto
  landing_page_views  bigint not null default 0,    -- actions landing_page_view / omni_landing_page_view (il massimo)
  synced_at           timestamptz not null default now(),
  constraint beh_meta_outbound_daily_pk primary key (date, ad_id)
);
comment on table beh_meta_outbound_daily is 'Modulo beh_*: link click, outbound click e LPV per annuncio e giorno, dalla stessa lettura Meta. Solo service_role.';

alter table beh_meta_outbound_daily enable row level security;
revoke all on beh_meta_outbound_daily from public, anon, authenticated;
grant select, insert, update, delete on beh_meta_outbound_daily to service_role;

-- cron alle 06:13 UTC: dopo ads-sync (06:07, finisce verso le 06:07:20), minuto libero il 25-10. Stesso cancello sul
-- flag della 0169: a modulo spento il cron non chiama la edge.
select cron.schedule('beh-sync-meta', '13 6 * * *',
  $cmd$ select net.http_post(
       url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/beh-sync',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"action":"run","step":"meta","pin":"x","source":"cron"}'::jsonb,
       timeout_milliseconds := 60000
     ) where exists (select 1 from public.app_flags where key = 'beh_enabled' and lower(btrim(value, E' \t\r\n')) = 'true') $cmd$);
insert into change_log (tbl, row_id, op, after, chi, source)
select 'cron.job', 'beh-sync-meta', 'cron_create',
       '{"schedule":"13 6 * * *","edge":"beh-sync","action":"run","step":"meta","migr":"0170_beh_meta","gate":"app_flags.beh_enabled + beh_steps"}'::jsonb,
       'claude-code', 'beh'
 where current_setting('amimi.beh_cron_meta_nato_qui', true) = 'true';

do $$
declare
  r name;
  v_grant text;
begin
  if not (select cl.relrowsecurity from pg_class cl where cl.oid = 'public.beh_meta_outbound_daily'::regclass) then
    raise exception '0170: RLS spenta su beh_meta_outbound_daily';
  end if;
  if exists (select 1 from pg_policy p where p.polrelid = 'public.beh_meta_outbound_daily'::regclass) then
    raise exception '0170: beh_meta_outbound_daily ha una policy, deve restare senza';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.beh_meta_outbound_daily', 'select, insert, update, delete, truncate, references, trigger')
       or has_any_column_privilege(r, 'public.beh_meta_outbound_daily', 'select, insert, update, references') then
      raise exception '0170: % ha privilegi su beh_meta_outbound_daily', r;
    end if;
  end loop;
  select string_agg(format('%s a %s', a.privilege_type, coalesce(g.rolname, 'PUBLIC')), ', ') into v_grant
    from pg_class cl cross join lateral aclexplode(cl.relacl) a left join pg_roles g on g.oid = a.grantee
   where cl.oid = 'public.beh_meta_outbound_daily'::regclass and (a.grantee = 0 or g.rolname in ('anon', 'authenticated'));
  if v_grant is not null then raise exception '0170: privilegi di troppo: %', v_grant; end if;
  if not (has_table_privilege('service_role', 'public.beh_meta_outbound_daily', 'select') and has_table_privilege('service_role', 'public.beh_meta_outbound_daily', 'insert')
          and has_table_privilege('service_role', 'public.beh_meta_outbound_daily', 'update')) then
    raise exception '0170: service_role non scrive beh_meta_outbound_daily';
  end if;
  if not exists (select 1 from pg_constraint k where k.conname = 'beh_meta_outbound_daily_pk' and k.connamespace = 'public'::regnamespace) then
    raise exception '0170: PK (date, ad_id) mancante';
  end if;
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = 'public.beh_meta_outbound_daily'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'date,ad_id,campaign_id,link_clicks,outbound_clicks,landing_page_views,synced_at' then
    raise exception '0170: colonne di beh_meta_outbound_daily diverse dal contratto';
  end if;
  if not exists (select 1 from cron.job where jobname = 'beh-sync-meta' and active and command like '%where exists%beh_enabled%') then
    raise exception '0170: cron beh-sync-meta mancante, spento o senza il cancello sul flag';
  end if;
end $$;

commit;
