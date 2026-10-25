-- tests/beh_rls.sql: prova VIVA delle migr 0169, 0170 e 0171 (modulo beh_*, comportamento utenti), da lanciare DOPO l'apply.
-- Test negativo obbligatorio della Regola Ferrea 19. Si incolla in UNA chiamata execute_sql (o psql): e' un unico blocco DO
-- che alla fine alza SEMPRE un'eccezione, quindi le righe di prova e i cambi di ruolo tornano indietro.
--   esito buono: ERROR P0001 'TEST_OK: ... (rollback voluto)'; qualunque altro errore = KO, col motivo.
-- In produzione plpgsql.variable_conflict vale 'error': nessuna variabile puo' chiamarsi come una colonna delle tabelle
-- lette qui (health_log ha k, n, day, label, severity), altrimenti il blocco cade con 42702 (Gate 2 del 25-10).
-- Cosa prova:
--   V  vincoli, da proprietario: PK dell'ordine (upsert idempotente), classi delle sorgenti, canale, stato del giro
--   H  beh_health_check: a flag spento non scrive le sue chiavi (una riga beh_ordini della edge non disturba) e il cron
--      ha il cancello sul flag; soglia scritta male o enorme = default e beh_fresh in error; passi con maiuscole e a capo
--      letti come la edge; un backfill non conta come giro del cron; guasto e quota con le loro soglie e i loro filtri
--   D  viste della 0171 solo per ask_ro; beh_dashboard: 'off' a flag spento, al team gli stessi ordini della tabella,
--      42501 a un account fuori dal team e ad anon
--   S  il service_role (la edge beh-sync) legge e scrive le tabelle
--   U  authenticated con un JWT del team: select, insert, update, delete sulle tabelle = 42501, niente EXECUTE sulle
--      funzioni del modulo, v_beh_settings da' la sola riga beh_enabled e non si scrive
--   N  anon: come U
do $t$
declare
  r name;
  q text;
  st text;
  cn text;
  v_n int;
  v_chiave text;
  v_val text;
  v_sev text;
  v_dash jsonb;
  v_oggi date := (now() at time zone 'Europe/Rome')::date;
  vietate constant text[] := array[
    'select count(*) from public.beh_order_origin',
    'insert into public.beh_order_origin (order_gid_num, order_name, created_at_shop, day, canale, is_test, is_cancelled, ready) values (1, ''#x'', now(), current_date, ''online_store'', false, false, true)',
    'update public.beh_order_origin set moments = 0',
    'delete from public.beh_order_origin',
    'select count(*) from public.beh_sync_runs',
    'insert into public.beh_sync_runs (step, action, run_day) values (''ordini'', ''run'', current_date)',
    'update public.beh_sync_runs set status = ''ok''',
    'delete from public.beh_sync_runs',
    'select count(*) from public.beh_meta_outbound_daily',
    'insert into public.beh_meta_outbound_daily (date, ad_id) values (current_date, ''prova_0170'')',
    'update public.beh_meta_outbound_daily set link_clicks = 0',
    'delete from public.beh_meta_outbound_daily',
    'select public.beh_health_check()',
    'select * from public.beh_flag_num(''beh_fresh_ore'', 48, '''')',
    'insert into public.v_beh_settings (key, value) values (''prova_0169'', ''x'')',
    'update public.v_beh_settings set value = ''true''',
    'delete from public.v_beh_settings'
  ];
begin
  if to_regclass('public.beh_order_origin') is null or to_regclass('public.beh_sync_runs') is null or to_regclass('public.v_beh_settings') is null then
    raise exception 'KO: migr 0169 non applicata';
  end if;
  if to_regclass('public.beh_meta_outbound_daily') is null then raise exception 'KO: migr 0170 non applicata'; end if;

  -- V
  insert into beh_order_origin (order_gid_num, order_name, created_at_shop, day, canale, is_test, is_cancelled, ready, moments, first_src, last_src)
    values (-169001, '#prova0169', now() - interval '1 hour', v_oggi, 'online_store', false, false, true, 0, 'none', 'none');
  insert into beh_order_origin (order_gid_num, order_name, created_at_shop, day, canale, is_test, is_cancelled, ready, moments, first_src, last_src)
    values (-169001, '#prova0169', now() - interval '1 hour', v_oggi, 'online_store', false, false, true, 2, 'search', 'direct')
    on conflict (order_gid_num) do update set moments = excluded.moments, first_src = excluded.first_src, last_src = excluded.last_src;
  select count(*) into v_n from beh_order_origin where order_gid_num = -169001 and moments = 2 and first_src = 'search';
  if v_n <> 1 then raise exception 'KO V: l''upsert sulla PK non ha aggiornato la riga'; end if;

  st := 'ok'; cn := null;
  begin
    insert into beh_order_origin (order_gid_num, order_name, created_at_shop, day, canale, is_test, is_cancelled, ready, first_src)
      values (-169002, '#x', now(), current_date, 'online_store', false, false, true, 'facebook');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23514' or cn is distinct from 'beh_order_origin_first_src_ck' then raise exception 'KO V: classe ''facebook'' = % %', st, cn; end if;

  st := 'ok'; cn := null;
  begin
    insert into beh_order_origin (order_gid_num, order_name, created_at_shop, day, canale, is_test, is_cancelled, ready)
      values (-169003, '#x', now(), current_date, 'Online Store', false, false, true);
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23514' or cn is distinct from 'beh_order_origin_canale_ck' then raise exception 'KO V: canale ''Online Store'' = % %', st, cn; end if;

  st := 'ok'; cn := null;
  begin
    insert into beh_sync_runs (step, action, run_day, status) values ('ordini', 'run', current_date, 'fatto');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23514' or cn is distinct from 'beh_sync_runs_status_ck' then raise exception 'KO V: stato ''fatto'' = % %', st, cn; end if;

  -- H (flag, soglie, giri e ordini si cambiano dentro la transazione, che torna indietro)
  -- H1 a flag spento beh_health_check non scrive le sue chiavi; la riga beh_ordini di un backfill di oggi resta e non conta
  update app_flags set value = 'false' where key = 'beh_enabled';
  delete from health_log where day = current_date and k like 'beh\_%';
  insert into health_log (day, k, label, n, severity, created_at) values (current_date, 'beh_ordini', 'riga della edge (prova 0169)', 0, 'ok', now());
  perform public.beh_health_check();
  if exists (select 1 from health_log where day = current_date and k in ('beh_fresh', 'beh_tracciamento_guasto', 'beh_quota_tracciata')) then
    raise exception 'KO H1: a flag spento beh_health_check ha scritto in health_log';
  end if;
  if not exists (select 1 from cron.job where jobname = 'beh-sync-ordini' and command like '%where exists%beh_enabled%') then
    raise exception 'KO H1: il comando del cron beh-sync-ordini non ha il cancello su beh_enabled';
  end if;

  -- H2 soglia scritta male o enorme: la funzione resta in piedi, usa il default e mette beh_fresh in error col nome
  update app_flags set value = 'true' where key = 'beh_enabled';
  update app_flags set value = 'ordini' where key = 'beh_steps';
  delete from beh_sync_runs where step = 'ordini';
  insert into beh_sync_runs (step, action, run_day, status, ended_at) values ('ordini', 'run', current_date, 'ok', now());
  foreach v_val in array array['dieci', '99999999999'] loop
    update app_flags set value = v_val where key = 'beh_fresh_ore';
    perform public.beh_health_check();
    select severity into v_sev from health_log where day = current_date and k = 'beh_fresh';
    if v_sev is distinct from 'error' or not exists (select 1 from health_log where day = current_date and k = 'beh_fresh' and label like '%soglie non valide%beh_fresh_ore%') then
      raise exception 'KO H2: beh_fresh_ore = % non segnalata in beh_fresh (severity %)', v_val, v_sev;
    end if;
  end loop;
  update app_flags set value = '48' where key = 'beh_fresh_ore';

  -- H3 passi con maiuscole e a capo (la edge fa trim + minuscole) e un giro del cron appena riuscito: beh_fresh ok
  update app_flags set value = ' Ordini' || chr(10) where key = 'beh_steps';
  perform public.beh_health_check();
  select severity into v_sev from health_log where day = current_date and k = 'beh_fresh';
  if v_sev is distinct from 'ok' then raise exception 'KO H3: beh_fresh con giro appena riuscito e passi '' Ordini'' = % (atteso ok)', v_sev; end if;
  if (select count(*) from health_log where day = current_date and k in ('beh_tracciamento_guasto', 'beh_quota_tracciata')) <> 2 then
    raise exception 'KO H3: mancano beh_tracciamento_guasto o beh_quota_tracciata col passo ordini acceso';
  end if;

  -- H4 un backfill riuscito non e' un giro del cron: da solo lascia beh_fresh in error
  delete from beh_sync_runs where step = 'ordini';
  insert into beh_sync_runs (step, action, run_day, status, ended_at) values ('ordini', 'backfill', current_date, 'ok', now());
  perform public.beh_health_check();
  if not exists (select 1 from health_log where day = current_date and k = 'beh_fresh' and severity = 'error' and label like '%ordini (mai)%') then
    raise exception 'KO H4: col solo backfill beh_fresh non va in error con ''ordini (mai)''';
  end if;
  insert into beh_sync_runs (step, action, run_day, status, ended_at) values ('ordini', 'run', current_date, 'ok', now());

  -- H5 guasto del tracciamento (48 ore, soglia 5 ordini): bozza, test, cancellato e non pronto non contano
  delete from beh_order_origin;
  insert into beh_order_origin (order_gid_num, order_name, created_at_shop, day, canale, is_test, is_cancelled, ready, moments)
  select -169100 - g, '#g' || g, now() - interval '1 hour', v_oggi,
         case when g = 5 then 'bozza' else 'online_store' end, g = 6, g = 7, g <> 8, case when g = 8 then null else 0 end
    from generate_series(1, 8) g;
  perform public.beh_health_check();
  select severity into v_sev from health_log where day = current_date and k = 'beh_tracciamento_guasto';
  if v_sev is distinct from 'ok' then raise exception 'KO H5: 4 ordini validi senza visite piu'' 4 da scartare = % (atteso ok, il rumore conta)', v_sev; end if;
  insert into beh_order_origin (order_gid_num, order_name, created_at_shop, day, canale, is_test, is_cancelled, ready, moments)
    values (-169109, '#g9', now() - interval '2 hours', v_oggi, 'online_store', false, false, true, 0);
  perform public.beh_health_check();
  select severity into v_sev from health_log where day = current_date and k = 'beh_tracciamento_guasto';
  if v_sev is distinct from 'error' then raise exception 'KO H5: 5 ordini online senza visite in 48 ore = % (atteso error)', v_sev; end if;
  update beh_order_origin set moments = 1 where order_gid_num = -169101;
  perform public.beh_health_check();
  select severity into v_sev from health_log where day = current_date and k = 'beh_tracciamento_guasto';
  if v_sev is distinct from 'ok' then raise exception 'KO H5: 5 ordini online con 1 tracciato = % (atteso ok)', v_sev; end if;

  -- H6 quota tracciata sui 28 giorni interi di Roma (soglia 60 su 100, almeno 80 ordini)
  delete from beh_order_origin;
  insert into beh_order_origin (order_gid_num, order_name, created_at_shop, day, canale, is_test, is_cancelled, ready, moments)
  select -169200 - g, '#q' || g, ((v_oggi - 3 - (g % 25)) + time '12:00') at time zone 'Europe/Rome', v_oggi - 3 - (g % 25),
         'online_store', false, false, true, case when g <= 47 then 1 else 0 end
    from generate_series(1, 80) g;
  perform public.beh_health_check();
  select severity into v_sev from health_log where day = current_date and k = 'beh_quota_tracciata';
  if v_sev is distinct from 'warn' then raise exception 'KO H6: 47 tracciati su 80 = % (atteso warn, sotto soglia)', v_sev; end if;
  update beh_order_origin set moments = 1 where order_gid_num = -169248;
  perform public.beh_health_check();
  select severity into v_sev from health_log where day = current_date and k = 'beh_quota_tracciata';
  if v_sev is distinct from 'ok' then raise exception 'KO H6: 48 tracciati su 80 = % (atteso ok, sulla soglia)', v_sev; end if;
  update beh_order_origin set moments = 0 where order_gid_num = -169248;
  delete from beh_order_origin where order_gid_num = -169280;
  perform public.beh_health_check();
  if not exists (select 1 from health_log where day = current_date and k = 'beh_quota_tracciata' and severity = 'ok' and label like '%pochi ordini%') then
    raise exception 'KO H6: 47 tracciati su 79 ordini non da'' ok con ''pochi ordini''';
  end if;

  -- S (dal catalogo: il ruolo della edge non si assume da qui)
  -- D (migr 0171): viste solo per ask_ro; la RPC beh_dashboard risponde al team, rifiuta gli altri (42501), a flag spento
  -- dice 'off' e coi dati sintetici di H6 conta gli stessi ordini della tabella
  if to_regprocedure('public.beh_dashboard(integer)') is null then raise exception 'KO: migr 0171 non applicata'; end if;
  foreach v_val in array array['v_beh_ordini_daily', 'v_beh_attribuzione_mensile', 'v_beh_ads_funnel_daily'] loop
    if has_table_privilege('anon', 'public.' || v_val, 'select') or has_table_privilege('authenticated', 'public.' || v_val, 'select') then
      raise exception 'KO D: % leggibile da anon o authenticated', v_val;
    end if;
    if not has_table_privilege('ask_ro', 'public.' || v_val, 'select') then raise exception 'KO D: ask_ro non legge %', v_val; end if;
  end loop;
  if has_function_privilege('anon', 'public.beh_dashboard(integer)', 'execute') then raise exception 'KO D: anon esegue beh_dashboard'; end if;
  select count(*) into v_n from beh_order_origin o
   where o.canale = 'online_store' and not o.is_test and not o.is_cancelled and o.day >= v_oggi - 29;
  update app_flags set value = 'false' where key = 'beh_enabled';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0171@telaioconsulting.com')::text, true);
  v_dash := public.beh_dashboard(30);
  if v_dash ->> 'state' is distinct from 'off' then raise exception 'KO D: a flag spento la RPC risponde %', v_dash ->> 'state'; end if;
  reset role;
  update app_flags set value = 'true' where key = 'beh_enabled';
  perform set_config('role', 'authenticated', true);
  v_dash := public.beh_dashboard(30);
  if v_dash ->> 'state' is distinct from 'on' or (v_dash -> 'ordini' ->> 'online')::int is distinct from v_n
     or not (v_dash ? 'fonti' and v_dash ? 'clienti' and v_dash ? 'premia' and v_dash ? 'salute') then
    raise exception 'KO D: RPC a flag acceso: stato %, ordini online % contro % in tabella', v_dash ->> 'state', v_dash -> 'ordini' ->> 'online', v_n;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'estraneo@gmail.com')::text, true);
  st := 'ok';
  begin perform public.beh_dashboard(30); exception when others then st := sqlstate; end;
  if st <> '42501' then raise exception 'KO D: un account fuori dal team ha letto beh_dashboard (%)', st; end if;
  reset role;

  if not (has_table_privilege('service_role', 'public.beh_order_origin', 'select') and has_table_privilege('service_role', 'public.beh_order_origin', 'insert')
          and has_table_privilege('service_role', 'public.beh_order_origin', 'update') and has_table_privilege('service_role', 'public.beh_sync_runs', 'insert')
          and has_table_privilege('service_role', 'public.beh_sync_runs', 'update')
          and has_table_privilege('service_role', 'public.beh_meta_outbound_daily', 'insert') and has_table_privilege('service_role', 'public.beh_meta_outbound_daily', 'update')) then
    raise exception 'KO S: il service_role non legge o non scrive le tabelle beh_*';
  end if;

  -- U e N
  foreach r in array array['authenticated', 'anon'] loop
    perform set_config('role', r, true);
    perform set_config('request.jwt.claims', case when r = 'anon' then json_build_object('role', 'anon')
                                                  else json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0169@amimi.it') end::text, true);
    foreach q in array vietate loop
      st := 'ok';
      begin execute q; exception when others then st := sqlstate; end;
      if st <> '42501' then raise exception 'KO %: "%" = % (atteso 42501)', r, q, st; end if;
    end loop;
    select count(*), min(key) into v_n, v_chiave from public.v_beh_settings;
    if v_n <> 1 or v_chiave is distinct from 'beh_enabled' then
      raise exception 'KO %: v_beh_settings da'' % righe (prima chiave %), attesa la sola beh_enabled', r, v_n, v_chiave;
    end if;
  end loop;

  raise exception 'TEST_OK: V H D S U N verdi, % comandi vietati provati per ruolo (rollback voluto)', array_length(vietate, 1);
end $t$;
