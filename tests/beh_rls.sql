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
  v_reale jsonb;
  v_giorno date;
  v_num numeric;
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
    'select public.beh_giorno_letto(''meta'', current_date)',
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
  insert into beh_sync_runs (step, action, source, run_day, status, ended_at) values ('ordini', 'run', 'cron', current_date, 'ok', now());
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

  -- H4 un backfill riuscito o un run lanciato a mano non sono giri del cron: da soli lasciano beh_fresh in error
  delete from beh_sync_runs where step = 'ordini';
  insert into beh_sync_runs (step, action, run_day, status, ended_at) values ('ordini', 'backfill', current_date, 'ok', now());
  insert into beh_sync_runs (step, action, source, run_day, status, ended_at) values ('ordini', 'run', 'manuale', current_date, 'ok', now());
  perform public.beh_health_check();
  if not exists (select 1 from health_log where day = current_date and k = 'beh_fresh' and severity = 'error' and label like '%ordini (mai)%') then
    raise exception 'KO H4: col solo backfill e un run a mano beh_fresh non va in error con ''ordini (mai)''';
  end if;
  insert into beh_sync_runs (step, action, source, run_day, status, ended_at) values ('ordini', 'run', 'cron', current_date, 'ok', now());

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

  -- H7 (migr 0171) copertura a 35 giorni e Meta ferma. Ogni caso in un sottoblocco che torna indietro da solo, cosi' D
  -- ritrova i dati sintetici di H6. Ordini: beh_order_origin ricostruita dagli ordini veri di shopify_orders = ok, poi un
  -- giorno mai riletto e tolto = warn con quel giorno, lo stesso giorno gia' letto da un giro = ok (ordini cancellati).
  -- Meta: un giorno tolto da spesa E click = warn e, nella RPC, spesa null; click tolti su un giorno mai letto = warn.
  -- Spesa ferma = beh_fresh error. I giri finti sono del cron (source 'cron').
  update app_flags set value = 'ordini,meta' where key = 'beh_steps';
  insert into beh_sync_runs (step, action, source, run_day, status, ended_at) values ('meta', 'run', 'cron', current_date, 'ok', now());
  begin
    delete from beh_order_origin;
    insert into beh_order_origin (order_gid_num, order_name, created_at_shop, day, canale, is_test, is_cancelled, ready, moments)
    select -170000 - row_number() over (order by o.created_at_shop), o.order_id, o.created_at_shop, (o.created_at_shop at time zone 'Europe/Rome')::date,
           'online_store', false, false, true, 1
      from shopify_orders o where o.created_at_shop >= ((v_oggi - 40)::timestamp at time zone 'Europe/Rome');
    perform public.beh_health_check();
    select severity, label into v_sev, v_val from health_log where day = current_date and k = 'beh_copertura';
    if v_sev is distinct from 'ok' then raise exception 'KO H7: copertura con gli ordini veri = % (%), attesa ok', v_sev, v_val; end if;
    -- un giorno che il cron non rileggera' piu' (prima di oggi - 7) e che nessun giro ha letto: buco
    select max(b.day) into v_giorno from beh_order_origin b where b.day < v_oggi - 7;
    delete from beh_order_origin where day = v_giorno;
    perform public.beh_health_check();
    if not exists (select 1 from health_log where day = current_date and k = 'beh_copertura' and severity = 'warn'
                    and label like '%ordini mancanti il ' || to_char(v_giorno, 'DD-MM') || ' (0 su %') then
      raise exception 'KO H7: tolto il % da beh_order_origin, beh_copertura non lo dice', v_giorno;
    end if;
    -- un giro 'warn' che non ha letto niente non conta come lettura (terzo giro del 26-10)
    insert into beh_sync_runs (step, action, source, run_day, status, ended_at, window_from, window_to, rows_read)
      values ('ordini', 'run', 'cron', v_giorno + 1, 'warn', ((v_giorno + 1) + time '07:20') at time zone 'Europe/Rome', v_giorno - 6, v_giorno + 2, 0);
    perform public.beh_health_check();
    if not exists (select 1 from health_log where day = current_date and k = 'beh_copertura' and severity = 'warn'
                    and label like '%ordini mancanti il ' || to_char(v_giorno, 'DD-MM') || ' (0 su %') then
      raise exception 'KO H7: un giro warn senza letture ha coperto il % in beh_copertura', v_giorno;
    end if;
    -- lo stesso giorno letto da un giro riuscito dopo la sua chiusura: gli ordini mancanti sono cancellati in Shopify, non un buco
    insert into beh_sync_runs (step, action, source, run_day, status, ended_at, window_from, window_to)
      values ('ordini', 'backfill', 'manuale', v_giorno + 1, 'ok', ((v_giorno + 1) + time '08:00') at time zone 'Europe/Rome', v_giorno, v_giorno + 1);
    perform public.beh_health_check();
    select severity, label into v_sev, v_val from health_log where day = current_date and k = 'beh_copertura';
    if v_sev is distinct from 'ok' then raise exception 'KO H7: giorno % gia'' letto da un giro ma copertura = % (%)', v_giorno, v_sev, v_val; end if;
    raise exception 'H7_ORDINI_OK';
  exception when others then
    if sqlerrm <> 'H7_ORDINI_OK' then raise; end if;
  end;
  begin
    -- fermo del token Meta (nessun giro Meta riuscito): il giorno sparisce da spesa E click. Il testimone e' il calendario,
    -- quindi il giorno va segnalato e nella RPC la spesa del periodo e' null (secondo giro del 26-10)
    delete from beh_sync_runs where step = 'meta';
    select max(b.date) into v_giorno from beh_meta_outbound_daily b
     where b.date < v_oggi - 2 and exists (select 1 from meta_ads_creative_daily m where m.date = b.date);
    if v_giorno is not null then
      delete from meta_ads_creative_daily where date = v_giorno;
      delete from beh_meta_outbound_daily where date = v_giorno;
      perform public.beh_health_check();
      if not exists (select 1 from health_log where day = current_date and k = 'beh_copertura' and severity = 'warn'
                      and label like '%spesa Meta mancante (ads-sync) il ' || to_char(v_giorno, 'DD-MM') || '%') then
        raise exception 'KO H7: tolta la spesa e i click del %, beh_copertura non lo dice', v_giorno;
      end if;
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0171@telaioconsulting.com')::text, true);
      v_dash := public.beh_dashboard(30);
      reset role;
      if v_giorno between (v_dash -> 'fonti' ->> 'spesa_dal')::date and (v_dash -> 'fonti' ->> 'spesa_dal')::date + (v_dash -> 'fonti' ->> 'giorni_spesa')::int - 1
         and (jsonb_typeof(v_dash -> 'fonti' -> 'spesa_meta') is distinct from 'null' or (v_dash -> 'fonti' ->> 'giorni_spesa_mancanti')::int < 1
              or (v_dash -> 'fonti' ->> 'ultimo_giorno_spesa_mancante')::date is distinct from v_giorno) then
        raise exception 'KO H7: spesa del % mancante ma la RPC da'' spesa_meta = %, giorni_spesa_mancanti = %, ultimo %', v_giorno,
          v_dash -> 'fonti' -> 'spesa_meta', v_dash -> 'fonti' -> 'giorni_spesa_mancanti', v_dash -> 'fonti' -> 'ultimo_giorno_spesa_mancante';
      end if;
      -- lo stesso giorno letto da un giro Meta riuscito dopo la chiusura, senza click: ads ferme, spesa 0, nessun buco (terzo giro)
      insert into beh_sync_runs (step, action, source, run_day, status, ended_at, window_from, window_to)
        values ('meta', 'run', 'cron', v_giorno + 1, 'ok', ((v_giorno + 1) + time '07:13') at time zone 'Europe/Rome', v_giorno - 6, v_giorno + 1);
      perform public.beh_health_check();
      if exists (select 1 from health_log where day = current_date and k = 'beh_copertura'
                  and label like '%spesa Meta mancante (ads-sync) il ' || to_char(v_giorno, 'DD-MM') || '%') then
        raise exception 'KO H7: % letto da un giro Meta riuscito senza click (ads ferme) ma beh_copertura lo da'' mancante', v_giorno;
      end if;
      perform set_config('role', 'authenticated', true);
      v_dash := public.beh_dashboard(30);
      reset role;
      if jsonb_typeof(v_dash -> 'fonti' -> 'spesa_meta') = 'null' or (v_dash -> 'fonti' ->> 'giorni_spesa_mancanti')::int <> 0 then
        raise exception 'KO H7: giorno senza consegna (%) ma la RPC da'' spesa_meta = % e giorni_spesa_mancanti = %', v_giorno,
          v_dash -> 'fonti' -> 'spesa_meta', v_dash -> 'fonti' -> 'giorni_spesa_mancanti';
      end if;
    end if;
    raise exception 'H7_META_OK';
  exception when others then
    if sqlerrm <> 'H7_META_OK' then raise; end if;
  end;
  begin
    -- click mancanti su un giorno che il cron non rileggera' piu' e che nessun giro Meta riuscito ha letto: warn, e la RPC li conta
    delete from beh_sync_runs where step = 'meta';
    select max(m.date) into v_giorno from meta_ads_creative_daily m where m.date < v_oggi - 7 and m.spend > 0;
    if v_giorno is not null then
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0171@telaioconsulting.com')::text, true);
      v_n := coalesce((public.beh_dashboard(30) -> 'fonti' ->> 'giorni_click_mancanti')::int, 0);
      reset role;
      delete from beh_meta_outbound_daily where date = v_giorno;
      perform public.beh_health_check();
      if not exists (select 1 from health_log where day = current_date and k = 'beh_copertura' and severity = 'warn'
                      and label like '%click Meta mancanti il ' || to_char(v_giorno, 'DD-MM') || '%') then
        raise exception 'KO H7: tolti i click del %, beh_copertura non lo dice', v_giorno;
      end if;
      -- ogni sottoblocco annullato porta via anche i set_config: l'email del team va rimessa qui
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0171@telaioconsulting.com')::text, true);
      v_dash := public.beh_dashboard(30);
      reset role;
      if coalesce((v_dash -> 'fonti' ->> 'giorni_click_mancanti')::int, 0) < 1 then
        raise exception 'KO H7: click del % mancanti ma la RPC da'' giorni_click_mancanti = %', v_giorno, v_dash -> 'fonti' -> 'giorni_click_mancanti';
      end if;
      if (v_dash -> 'fonti' ->> 'giorni_click_mancanti')::int <> v_n + 1 then
        raise exception 'KO H7: i click tolti del % dovevano alzare giorni_click_mancanti da % a %, e'' %', v_giorno, v_n, v_n + 1, v_dash -> 'fonti' -> 'giorni_click_mancanti';
      end if;
    end if;
    raise exception 'H7_CLICK_OK';
  exception when others then
    if sqlerrm <> 'H7_CLICK_OK' then raise; end if;
  end;
  begin
    -- pausa delle ads negli ultimi due giorni (quarto giro del 26-10): nessuna riga di spesa ne' di click, ma un giro Meta
    -- riuscito li ha letti. Niente "spesa ferma" in beh_fresh, e la finestra della spesa della RPC non si accorcia
    delete from meta_ads_creative_daily where date >= v_oggi - 2;
    delete from beh_meta_outbound_daily where date >= v_oggi - 2;
    insert into beh_sync_runs (step, action, source, run_day, status, ended_at, window_from, window_to)
      values ('meta', 'run', 'cron', v_oggi, 'ok', (v_oggi + time '07:13') at time zone 'Europe/Rome', v_oggi - 7, v_oggi);
    perform public.beh_health_check();
    if exists (select 1 from health_log where day = current_date and k = 'beh_fresh' and label like '%meta_ads_creative_daily ferma%') then
      raise exception 'KO H7: pausa delle ads letta da un giro Meta riuscito ma beh_fresh dice spesa ferma';
    end if;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0171@telaioconsulting.com')::text, true);
    v_dash := public.beh_dashboard(30);
    reset role;
    if (v_dash -> 'fonti' ->> 'giorni_spesa')::int <> (v_dash ->> 'to')::date - (v_dash -> 'fonti' ->> 'spesa_dal')::date + 1
       or jsonb_typeof(v_dash -> 'fonti' -> 'spesa_meta') = 'null' then
      raise exception 'KO H7: pausa delle ads: giorni_spesa % su % .. %, spesa_meta % (la finestra non deve accorciarsi)',
        v_dash -> 'fonti' -> 'giorni_spesa', v_dash -> 'fonti' -> 'spesa_dal', v_dash -> 'to', v_dash -> 'fonti' -> 'spesa_meta';
    end if;
    raise exception 'H7_PAUSA_OK';
  exception when others then
    if sqlerrm <> 'H7_PAUSA_OK' then raise; end if;
  end;
  begin
    -- quinto giro del 26-10: spesa e click tolti dopo l'ultimo giorno di spesa fino a 11 giorni fa (A), giorni fino ad A letti
    -- da un backfill, un solo giro Meta riuscito sugli ultimi 7. Il periodo di 7 giorni e' tutto letto senza consegna (spesa
    -- 0): i giorni non letti prima del periodo non lo azzerano. Quello di 30 si ferma ad A, il giorno prima del primo non letto.
    -- Ogni confronto e' "is distinct from": una chiave che manca nella RPC e' un KO, non un NULL che passa (sesto giro)
    select max(m.date) into v_giorno from meta_ads_creative_daily m where m.date <= v_oggi - 11;
    if v_giorno is null or v_giorno < v_oggi - 25 then raise exception 'KO H7: prova della finestra non costruibile, ultima spesa fino a 11 giorni fa: %', v_giorno; end if;
    delete from meta_ads_creative_daily where date > v_giorno;
    delete from beh_meta_outbound_daily where date > v_giorno;
    delete from beh_sync_runs where step = 'meta';
    insert into beh_sync_runs (step, action, source, run_day, status, ended_at, window_from, window_to) values
      ('meta', 'backfill', 'manuale', v_oggi, 'ok', now(), date '2026-01-01', v_giorno + 1),
      ('meta', 'run', 'cron', v_oggi, 'ok', now(), v_oggi - 7, v_oggi),
      ('ordini', 'run', 'cron', v_oggi, 'ok', now(), v_oggi - 7, v_oggi + 1);
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0171@telaioconsulting.com')::text, true);
    v_dash := public.beh_dashboard(7);
    v_reale := public.beh_dashboard(30);
    reset role;
    if (v_dash ->> 'to')::date is distinct from v_oggi - 1 or (v_dash -> 'fonti' ->> 'giorni_spesa')::int is distinct from 7 or (v_dash -> 'fonti' ->> 'spesa_meta')::numeric is distinct from 0
       or (v_dash -> 'fonti' ->> 'spesa_al')::date is distinct from v_oggi - 1 or (v_dash -> 'fonti' ->> 'giorni_click_mancanti')::int is distinct from 0 or (v_dash -> 'fonti' ->> 'giorni_spesa_mancanti')::int is distinct from 0 then
      raise exception 'KO H7: finestra della spesa a 7 giorni (giorni non letti prima del periodo): to %, giorni_spesa %, spesa_meta %, spesa_al %, click mancanti %, spesa mancante % (attesi %, 7, 0, %, 0, 0)',
        v_dash -> 'to', v_dash -> 'fonti' -> 'giorni_spesa', v_dash -> 'fonti' -> 'spesa_meta', v_dash -> 'fonti' -> 'spesa_al', v_dash -> 'fonti' -> 'giorni_click_mancanti',
        v_dash -> 'fonti' -> 'giorni_spesa_mancanti', v_oggi - 1, v_oggi - 1;
    end if;
    v_n := (v_oggi - 8) - greatest(v_giorno + 1, v_oggi - 30) + 1;
    if (v_reale -> 'fonti' ->> 'spesa_al')::date is distinct from v_giorno
       or (v_reale -> 'fonti' ->> 'giorni_spesa')::int is distinct from v_giorno - (v_reale -> 'fonti' ->> 'spesa_dal')::date + 1
       or (v_reale -> 'fonti' ->> 'giorni_click_mancanti')::int is distinct from v_n or (v_reale -> 'fonti' ->> 'click_mancanti_salute')::int is distinct from v_n
       or (v_reale -> 'fonti' ->> 'click_mancanti_recenti')::int is distinct from 0 or (v_reale -> 'fonti' ->> 'click_mancanti_vecchi')::int is distinct from 0 then
      raise exception 'KO H7: finestra della spesa a 30 giorni: spesa_al % (atteso %), giorni_spesa % dal %, click mancanti % (Salute %, recenti %, vecchi %; attesi % tutti in Salute)',
        v_reale -> 'fonti' -> 'spesa_al', v_giorno, v_reale -> 'fonti' -> 'giorni_spesa', v_reale -> 'fonti' -> 'spesa_dal', v_reale -> 'fonti' -> 'giorni_click_mancanti',
        v_reale -> 'fonti' -> 'click_mancanti_salute', v_reale -> 'fonti' -> 'click_mancanti_recenti', v_reale -> 'fonti' -> 'click_mancanti_vecchi', v_n;
    end if;
    -- sesto giro: il giro di oggi e' fallito e una rilettura a mano copre solo gli ultimi 6 giorni, quindi il primo giorno
    -- del periodo di 7, dopo l'ultima riga di spesa, non e' coperto: finestra vuota e quel giorno contato mancante, come lo
    -- elenca beh_copertura; per i click e' fuori dalla finestra del cron (il giro di oggi e' gia' passato)
    delete from beh_sync_runs where step = 'meta' and source = 'cron';
    insert into beh_sync_runs (step, action, source, run_day, status, ended_at, window_from, window_to) values
      ('meta', 'run', 'cron', v_oggi, 'error', now(), v_oggi - 7, v_oggi),
      ('meta', 'backfill', 'manuale', v_oggi, 'ok', now(), v_oggi - 6, v_oggi);
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0171@telaioconsulting.com')::text, true);
    v_dash := public.beh_dashboard(7);
    reset role;
    if (v_dash -> 'fonti' ->> 'giorni_spesa')::int is distinct from 0 or jsonb_typeof(v_dash -> 'fonti' -> 'spesa_meta') is distinct from 'null'
       or (v_dash -> 'fonti' ->> 'giorni_spesa_mancanti')::int is distinct from 1 or (v_dash -> 'fonti' ->> 'ultimo_giorno_spesa_mancante')::date is distinct from v_oggi - 7
       or (v_dash -> 'fonti' ->> 'giorni_spesa_mancanti_salute')::int is distinct from 1 or (v_dash -> 'fonti' ->> 'giorni_click_mancanti')::int is distinct from 1
       or (v_dash -> 'fonti' ->> 'click_mancanti_salute')::int is distinct from 1 or (v_dash -> 'fonti' ->> 'click_mancanti_recenti')::int is distinct from 0 then
      raise exception 'KO H7: finestra vuota per il primo giorno del periodo non coperto: giorni_spesa %, spesa_meta %, mancanti % (ultimo %, Salute %), click % (Salute %, recenti %); attesi 0, null, 1 (%, 1), 1 (1, 0)',
        v_dash -> 'fonti' -> 'giorni_spesa', v_dash -> 'fonti' -> 'spesa_meta', v_dash -> 'fonti' -> 'giorni_spesa_mancanti', v_dash -> 'fonti' -> 'ultimo_giorno_spesa_mancante',
        v_dash -> 'fonti' -> 'giorni_spesa_mancanti_salute', v_dash -> 'fonti' -> 'giorni_click_mancanti', v_dash -> 'fonti' -> 'click_mancanti_salute',
        v_dash -> 'fonti' -> 'click_mancanti_recenti', v_oggi - 7;
    end if;
    -- settimo giro: senza la rilettura a mano nessun giorno del periodo e' coperto, e sono mancanti tutti e 7 (non il solo
    -- primo), come li elenca beh_copertura: 6 in Salute (fino all'altro ieri); click: 6 li rilegge il cron, 1 no
    delete from beh_sync_runs where step = 'meta' and window_from = v_oggi - 6;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0171@telaioconsulting.com')::text, true);
    v_dash := public.beh_dashboard(7);
    reset role;
    if (v_dash -> 'fonti' ->> 'giorni_spesa')::int is distinct from 0 or (v_dash -> 'fonti' ->> 'giorni_spesa_mancanti')::int is distinct from 7 or (v_dash -> 'fonti' ->> 'ultimo_giorno_spesa_mancante')::date is distinct from v_oggi - 1
       or (v_dash -> 'fonti' ->> 'giorni_spesa_mancanti_salute')::int is distinct from 6 or (v_dash -> 'fonti' ->> 'giorni_click_mancanti')::int is distinct from 7 or (v_dash -> 'fonti' ->> 'click_mancanti_recenti')::int is distinct from 6
       or (v_dash -> 'fonti' ->> 'click_mancanti_salute')::int is distinct from 1 then
      raise exception 'KO H7: finestra vuota con tutto il periodo scoperto: giorni_spesa %, mancanti % (ultimo %, Salute %), click % (recenti %, Salute %); attesi 0, 7 (%, 6), 7 (6, 1)',
        v_dash -> 'fonti' -> 'giorni_spesa', v_dash -> 'fonti' -> 'giorni_spesa_mancanti', v_dash -> 'fonti' -> 'ultimo_giorno_spesa_mancante',
        v_dash -> 'fonti' -> 'giorni_spesa_mancanti_salute', v_dash -> 'fonti' -> 'giorni_click_mancanti', v_dash -> 'fonti' -> 'click_mancanti_recenti',
        v_dash -> 'fonti' -> 'click_mancanti_salute', v_oggi - 1;
    end if;
    raise exception 'H7_INIZIO_OK';
  exception when others then
    if sqlerrm <> 'H7_INIZIO_OK' then raise; end if;
  end;
  begin
    -- fasce dei giorni mancanti (quinto e sesto giro): spesa e click tolti a 36, 35, 8 e 7 giorni fa, giorni che nessun
    -- giro Meta riuscito ha letto (il giro del cron di oggi, sulla finestra vera [oggi-7, oggi), e' fallito; una rilettura a
    -- mano copre gli ultimi 6), tutti gli altri letti. beh_copertura elenca spesa e click a 35, 8 e 7 giorni; la RPC conta
    -- le stesse date in Salute, 36 fra i vecchi e nessuno fra quelli che il cron rilegge. Prima del giro di oggi il giorno
    -- di 7 giorni fa lo rilegge ancora il cron
    delete from meta_ads_creative_daily where date in (v_oggi - 36, v_oggi - 35, v_oggi - 8, v_oggi - 7);
    delete from beh_meta_outbound_daily where date in (v_oggi - 36, v_oggi - 35, v_oggi - 8, v_oggi - 7);
    delete from beh_sync_runs where step = 'meta';
    insert into beh_sync_runs (step, action, source, run_day, status, ended_at, window_from, window_to) values
      ('meta', 'backfill', 'manuale', v_oggi, 'ok', now(), date '2026-01-01', v_oggi - 36),
      ('meta', 'backfill', 'manuale', v_oggi, 'ok', now(), v_oggi - 34, v_oggi - 8),
      ('meta', 'backfill', 'manuale', v_oggi, 'ok', now(), v_oggi - 6, v_oggi),
      ('meta', 'run', 'cron', v_oggi, 'error', now(), v_oggi - 7, v_oggi),
      ('ordini', 'run', 'cron', v_oggi, 'ok', now(), v_oggi - 7, v_oggi + 1);
    perform public.beh_health_check();
    if not exists (select 1 from health_log where day = current_date and k = 'beh_copertura' and severity = 'warn'
                    and label like '%spesa Meta mancante (ads-sync) il ' || to_char(v_oggi - 35, 'DD-MM') || ', ' || to_char(v_oggi - 8, 'DD-MM') || ', '
                                   || to_char(v_oggi - 7, 'DD-MM') || '; click Meta mancanti il ' || to_char(v_oggi - 35, 'DD-MM') || ', ' || to_char(v_oggi - 8, 'DD-MM') || ', '
                                   || to_char(v_oggi - 7, 'DD-MM') || ': %') then
      raise exception 'KO H7: fasce: beh_copertura doveva elencare spesa e click il % % %, dice %', v_oggi - 35, v_oggi - 8, v_oggi - 7,
        (select label from health_log where day = current_date and k = 'beh_copertura' order by created_at desc limit 1);
    end if;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0171@telaioconsulting.com')::text, true);
    v_dash := public.beh_dashboard(90);
    reset role;
    if (v_dash -> 'fonti' ->> 'giorni_click_mancanti')::int is distinct from 4 or (v_dash -> 'fonti' ->> 'click_mancanti_recenti')::int is distinct from 0
       or (v_dash -> 'fonti' ->> 'click_mancanti_salute')::int is distinct from 3 or (v_dash -> 'fonti' ->> 'click_mancanti_vecchi')::int is distinct from 1
       or (v_dash -> 'fonti' ->> 'ultimo_giorno_click_mancante')::date is distinct from v_oggi - 7
       or (v_dash -> 'fonti' ->> 'giorni_spesa_mancanti')::int is distinct from 4 or (v_dash -> 'fonti' ->> 'giorni_spesa_mancanti_salute')::int is distinct from 3
       or jsonb_typeof(v_dash -> 'fonti' -> 'spesa_meta') is distinct from 'null' then
      raise exception 'KO H7: fasce: click % (recenti %, Salute %, vecchi %, ultimo %), spesa mancante % (in Salute %), spesa_meta %; attesi 4 (0, 3, 1, %), 4 (3), null',
        v_dash -> 'fonti' -> 'giorni_click_mancanti', v_dash -> 'fonti' -> 'click_mancanti_recenti', v_dash -> 'fonti' -> 'click_mancanti_salute',
        v_dash -> 'fonti' -> 'click_mancanti_vecchi', v_dash -> 'fonti' -> 'ultimo_giorno_click_mancante', v_dash -> 'fonti' -> 'giorni_spesa_mancanti',
        v_dash -> 'fonti' -> 'giorni_spesa_mancanti_salute', v_dash -> 'fonti' -> 'spesa_meta', v_oggi - 7;
    end if;
    delete from beh_sync_runs where step = 'meta' and source = 'cron';
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0171@telaioconsulting.com')::text, true);
    v_dash := public.beh_dashboard(90);
    reset role;
    -- senza la riga del giro di oggi: prima delle 06:13 UTC il giorno di 7 giorni fa lo rilegge ancora il giro di oggi, dopo
    -- no, anche se il giro non ha scritto la sua riga (edge mai partita, settimo giro)
    v_n := case when now() < ((v_oggi + time '06:13') at time zone 'UTC') then 1 else 0 end;
    if (v_dash -> 'fonti' ->> 'click_mancanti_recenti')::int is distinct from v_n or (v_dash -> 'fonti' ->> 'click_mancanti_salute')::int is distinct from 3 - v_n
       or (v_dash -> 'fonti' ->> 'click_mancanti_vecchi')::int is distinct from 1 then
      raise exception 'KO H7: fasce senza la riga del giro di oggi: recenti %, Salute %, vecchi % (attesi %, %, 1)',
        v_dash -> 'fonti' -> 'click_mancanti_recenti', v_dash -> 'fonti' -> 'click_mancanti_salute', v_dash -> 'fonti' -> 'click_mancanti_vecchi', v_n, 3 - v_n;
    end if;
    raise exception 'H7_FASCE_OK';
  exception when others then
    if sqlerrm <> 'H7_FASCE_OK' then raise; end if;
  end;
  begin
    delete from meta_ads_creative_daily where date >= v_oggi - 2;
    perform public.beh_health_check();
    if not exists (select 1 from health_log where day = current_date and k = 'beh_fresh' and severity = 'error' and label like '%meta_ads_creative_daily ferma al%') then
      raise exception 'KO H7: spesa Meta ferma da piu'' di un giorno ma beh_fresh non va in error';
    end if;
    raise exception 'H7_FERMA_OK';
  exception when others then
    if sqlerrm <> 'H7_FERMA_OK' then raise; end if;
  end;

  -- D (migr 0171): viste solo per ask_ro (che legge davvero la spesa attraverso la vista); la RPC beh_dashboard risponde
  -- al team, rifiuta gli altri (42501), a flag spento dice 'off'. Sui dati sintetici di H6 piu' quattro ordini che
  -- distinguono i filtri (bozza, prova, cancellato, in attribuzione) ogni numero della card ordini e il CPA tornano coi
  -- conteggi fatti qui; il periodo dura quanto chiesto, finisce all'ultimo giorno completo e segue l'ultimo giro ordini
  -- riuscito; un confronto su un periodo che comincia prima dei dati e' null.
  if to_regprocedure('public.beh_dashboard(integer)') is null then raise exception 'KO: migr 0171 non applicata'; end if;
  foreach v_val in array array['v_beh_ordini_daily', 'v_beh_attribuzione_mensile', 'v_beh_ads_funnel_daily'] loop
    if has_table_privilege('anon', 'public.' || v_val, 'select') or has_table_privilege('authenticated', 'public.' || v_val, 'select') then
      raise exception 'KO D: % leggibile da anon o authenticated', v_val;
    end if;
    if not has_table_privilege('ask_ro', 'public.' || v_val, 'select') then raise exception 'KO D: ask_ro non legge %', v_val; end if;
  end loop;
  if has_function_privilege('anon', 'public.beh_dashboard(integer)', 'execute') then raise exception 'KO D: anon esegue beh_dashboard'; end if;
  select max(date) into v_giorno from meta_ads_creative_daily where spend > 0;
  if v_giorno is not null then
    perform set_config('role', 'ask_ro', true);
    select spend into v_num from v_beh_ads_funnel_daily where date = v_giorno;
    reset role;
    if coalesce(v_num, 0) <= 0 then raise exception 'KO D: ask_ro legge spesa % il % da v_beh_ads_funnel_daily (attesa > 0: RLS di meta_ads_creative_daily?)', v_num, v_giorno; end if;
  end if;
  update app_flags set value = 'false' where key = 'beh_enabled';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0171@telaioconsulting.com')::text, true);
  v_dash := public.beh_dashboard(30);
  if v_dash ->> 'state' is distinct from 'off' then raise exception 'KO D: a flag spento la RPC risponde %', v_dash ->> 'state'; end if;
  reset role;
  update app_flags set value = 'true' where key = 'beh_enabled';

  -- periodo: segue l'ultimo giro ordini riuscito del giorno prima (to = oggi - 2), un giro fallito di oggi non lo sposta
  delete from beh_sync_runs where step = 'ordini';
  insert into beh_sync_runs (step, action, source, run_day, status, ended_at, window_from, window_to)
    values ('ordini', 'run', 'cron', v_oggi - 1, 'ok', ((v_oggi - 1) + time '07:20') at time zone 'Europe/Rome', v_oggi - 8, v_oggi);
  insert into beh_sync_runs (step, action, source, run_day, status, ended_at, window_from, window_to)
    values ('ordini', 'run', 'cron', v_oggi, 'error', now(), v_oggi - 7, v_oggi + 1);
  foreach v_n in array array[7, 30, 90] loop
    perform set_config('role', 'authenticated', true);
    v_dash := public.beh_dashboard(v_n);
    reset role;
    if (v_dash ->> 'to')::date <> v_oggi - 2 or (v_dash ->> 'to')::date - (v_dash ->> 'from')::date + 1 <> v_n
       or (v_dash ->> 'prev_to')::date <> (v_dash ->> 'from')::date - 1 or (v_dash ->> 'prev_to')::date - (v_dash ->> 'prev_from')::date + 1 <> v_n then
      raise exception 'KO D: periodo di % giorni = % .. % (prima % .. %), atteso fino a % e la stessa durata', v_n,
        v_dash ->> 'from', v_dash ->> 'to', v_dash ->> 'prev_from', v_dash ->> 'prev_to', v_oggi - 2;
    end if;
  end loop;

  -- ordini che distinguono i filtri, dentro il periodo
  insert into beh_order_origin (order_gid_num, order_name, created_at_shop, day, canale, is_test, is_cancelled, ready, moments)
  values (-169301, '#d1', ((v_oggi - 4) + time '12:00') at time zone 'Europe/Rome', v_oggi - 4, 'bozza', false, false, true, 0),
         (-169302, '#d2', ((v_oggi - 4) + time '12:00') at time zone 'Europe/Rome', v_oggi - 4, 'online_store', true, false, true, 1),
         (-169303, '#d3', ((v_oggi - 4) + time '12:00') at time zone 'Europe/Rome', v_oggi - 4, 'online_store', false, true, true, 1),
         (-169304, '#d4', ((v_oggi - 4) + time '12:00') at time zone 'Europe/Rome', v_oggi - 4, 'online_store', false, false, false, null);
  perform set_config('role', 'authenticated', true);
  v_dash := public.beh_dashboard(30);
  reset role;
  if v_dash ->> 'state' is distinct from 'on' or not (v_dash ? 'fonti' and v_dash ? 'clienti' and v_dash ? 'premia' and v_dash ? 'salute') then
    raise exception 'KO D: RPC a flag acceso: stato %', v_dash ->> 'state';
  end if;
  if (v_dash ->> 'to')::date >= v_oggi then raise exception 'KO D: il periodo arriva a % (oggi %): oggi non e'' mai completo', v_dash ->> 'to', v_oggi; end if;
  select jsonb_build_object(
           'online',           count(*) filter (where o.canale = 'online_store'),
           'online_pronti',    count(*) filter (where o.canale = 'online_store' and o.ready),
           'online_tracciati', count(*) filter (where o.canale = 'online_store' and o.ready and o.moments > 0),
           'in_attribuzione',  count(*) filter (where o.canale = 'online_store' and not o.ready),
           'tutti',            count(*))
    into v_reale
    from beh_order_origin o
   where not o.is_test and not o.is_cancelled and o.day between (v_dash ->> 'from')::date and (v_dash ->> 'to')::date;
  foreach v_val in array array['online', 'online_pronti', 'online_tracciati', 'in_attribuzione', 'tutti'] loop
    if (v_dash -> 'ordini' ->> v_val)::int is distinct from (v_reale ->> v_val)::int then
      raise exception 'KO D: ordini.% = % contro % contati qui', v_val, v_dash -> 'ordini' ->> v_val, v_reale ->> v_val;
    end if;
  end loop;
  if (v_reale ->> 'online')::int = 0 or (v_reale ->> 'in_attribuzione')::int = 0 then raise exception 'KO D: dati sintetici fuori dal periodo'; end if;
  if (v_dash -> 'fonti' ->> 'giorni_spesa')::int > 0 then
    select count(*) into v_n from beh_order_origin o
     where not o.is_test and not o.is_cancelled
       and o.day between (v_dash -> 'fonti' ->> 'spesa_dal')::date and (v_dash -> 'fonti' ->> 'spesa_dal')::date + (v_dash -> 'fonti' ->> 'giorni_spesa')::int - 1;
    if (v_dash -> 'fonti' ->> 'ordini_cpa')::int is distinct from v_n then
      raise exception 'KO D: ordini_cpa = % contro % ordini nei giorni coperti dalla spesa', v_dash -> 'fonti' ->> 'ordini_cpa', v_n;
    end if;
  end if;
  if (v_dash -> 'clienti' -> 'riacquisto_90' ->> 'clienti')::int is distinct from (select coalesce(sum(clienti), 0)::int from v_clienti_coorti where maturita_giorni >= 90)
     or (v_dash -> 'clienti' -> 'riacquisto_90' ->> 'ricomprato')::int is distinct from (select coalesce(sum(ricomprato_90gg), 0)::int from v_clienti_coorti where maturita_giorni >= 90) then
    raise exception 'KO D: riacquisto_90 = % contro le coorti mature di v_clienti_coorti', v_dash -> 'clienti' -> 'riacquisto_90';
  end if;

  perform set_config('role', 'authenticated', true);
  v_dash := public.beh_dashboard(90);
  reset role;
  if (v_dash -> 'fonti' ->> 'giorni_spesa')::int > 0
     and ((v_dash -> 'fonti' ->> 'spesa_dal')::date - (v_dash -> 'fonti' ->> 'giorni_spesa')::int) < (select min(date) from meta_ads_creative_daily)
     and jsonb_typeof(v_dash -> 'fonti' -> 'prev_spesa_meta') is distinct from 'null' then
    raise exception 'KO D: 90 giorni, periodo prima della spesa dal % ma prev_spesa_meta = %',
      (v_dash -> 'fonti' ->> 'spesa_dal')::date - (v_dash -> 'fonti' ->> 'giorni_spesa')::int, v_dash -> 'fonti' -> 'prev_spesa_meta';
  end if;
  if (v_dash ->> 'prev_from')::date < (select min(day) from loyalty_visits) and jsonb_typeof(v_dash -> 'premia' -> 'prev_aperture') is distinct from 'null' then
    raise exception 'KO D: 90 giorni, aperture contate dal % ma prev_aperture = %', (select min(day) from loyalty_visits), v_dash -> 'premia' -> 'prev_aperture';
  end if;
  perform set_config('role', 'authenticated', true);
  v_dash := public.beh_dashboard(365);
  reset role;
  if (v_dash -> 'fonti' ->> 'giorni_spesa')::int > (v_dash ->> 'to')::date - (select min(date) from meta_ads_creative_daily) + 1 then
    raise exception 'KO D: 365 giorni, giorni_spesa % oltre i giorni della spesa per annuncio', v_dash -> 'fonti' ->> 'giorni_spesa';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'estraneo@gmail.com')::text, true);
  st := 'ok';
  begin perform public.beh_dashboard(30); exception when others then st := sqlstate; end;
  if st <> '42501' then raise exception 'KO D: un account fuori dal team ha letto beh_dashboard (%)', st; end if;
  reset role;

  -- S (dal catalogo: il ruolo della edge non si assume da qui)
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
