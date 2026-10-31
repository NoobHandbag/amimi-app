-- tests/watchdog_rls.sql: prova VIVA della migr 0181 (watchdog esterno e spazio in v_health), da lanciare DOPO l'apply.
-- Test negativo della Regola Ferrea 19 sul modello di tests/push_eventi_rls.sql. Si incolla in UNA chiamata execute_sql
-- (o psql): e' un unico blocco DO che alla fine alza SEMPRE un'eccezione, quindi l'hash di prova scritto in app_config e i
-- cambi di ruolo tornano indietro (come begin ... rollback). Non legge ne' stampa l'hash vero.
--   esito buono: ERROR P0001 'TEST_OK: ... (rollback voluto)'; qualunque altro errore = KO, col motivo.
-- Cosa prova:
--   C  catalogo: colonna watchdog_pin_hash text; watchdog_status security definer con search_path fisso; execute solo ad
--      anon (e al proprietario), nessun grant a PUBLIC, authenticated, service_role, ask_ro
--   P  da proprietario, con un hash di prova: hash vuoto = {ok:false, motivo:non_configurato} e basta; PIN sbagliato,
--      nullo, vuoto o con uno spazio in piu' = esattamente {ok:false}; PIN giusto = ok true, now vicino a now(), i sei giri
--      con log/cron/on e nient'altro, contatori di pg_net interi >= 0, Storage e database uguali a quelli di v_health
--      (arrotondati), nessun testo libero (niente label, niente content)
--   A  da anon (il ruolo della chiave pubblica): la RPC risponde come al proprietario (security definer), ma app_config
--      resta chiusa (42501) e la sua colonna nuova pure; v_health si legge e ha le due righe nuove
--   U  da authenticated: execute = 42501 (non serve all'app), v_health si legge
--   V  v_health: 14 righe, le 12 di prima ci sono ancora, storage_mb e db_mb con gravita' coerente con le soglie 700 e 400
do $t$
declare
  r name;
  st text;
  v_res jsonb;
  v_pin constant text := 'prova-watchdog-0181-' || md5(clock_timestamp()::text);
  v_giro text;
  v_keys text[];
  v_n bigint;
  v_storage bigint;
  v_db bigint;
  v_sev text;
begin
  -- C
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.app_config'::regclass and a.attname = 'watchdog_pin_hash'
                   and not a.attisdropped and a.atttypid = 'text'::regtype) then
    raise exception 'KO C: migr 0181 non applicata (manca app_config.watchdog_pin_hash)';
  end if;
  if to_regprocedure('public.watchdog_status(text)') is null then raise exception 'KO C: watchdog_status mancante'; end if;
  if not (select p.prosecdef and 'search_path=public' = any (p.proconfig) from pg_proc p where p.oid = 'public.watchdog_status(text)'::regprocedure) then
    raise exception 'KO C: watchdog_status non e'' security definer con search_path=public';
  end if;
  if not has_function_privilege('anon', 'public.watchdog_status(text)', 'execute') then raise exception 'KO C: anon non esegue la RPC'; end if;
  foreach r in array array['authenticated', 'service_role', 'ask_ro'] loop
    if has_function_privilege(r, 'public.watchdog_status(text)', 'execute') then raise exception 'KO C: % esegue la RPC', r; end if;
  end loop;
  if exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
              where p.oid = 'public.watchdog_status(text)'::regprocedure and a.grantee = 0) then
    raise exception 'KO C: execute a PUBLIC';
  end if;

  -- V
  select count(*) into v_n from v_health;
  if v_n <> 14 then raise exception 'KO V: v_health ha % righe', v_n; end if;
  if (select count(*) from v_health where k in ('img_missing', 'stock_neg', 'cogs_missing', 'price_missing', 'orders_orphan', 'todo_products',
        'lost_sales', 'shopify_orphan', 'qromo_orphan', 'dup_codice', 'period_mismatch', 'ce_drift_live')) <> 12 then
    raise exception 'KO V: una delle 12 righe di prima manca';
  end if;
  select n, severity into v_storage, v_sev from v_health where k = 'storage_mb';
  if v_storage is null or v_storage <= 0 or v_sev is distinct from (case when v_storage >= 700 then 'warn' else 'ok' end) then
    raise exception 'KO V: storage_mb = % %', v_storage, v_sev;
  end if;
  select n, severity into v_db, v_sev from v_health where k = 'db_mb';
  if v_db is null or v_db <= 0 or v_sev is distinct from (case when v_db >= 400 then 'warn' else 'ok' end) then
    raise exception 'KO V: db_mb = % %', v_db, v_sev;
  end if;

  -- P
  update public.app_config set watchdog_pin_hash = null where id = 1;
  v_res := public.watchdog_status(v_pin);
  if v_res is distinct from '{"ok": false, "motivo": "non_configurato"}'::jsonb then raise exception 'KO P: hash vuoto = %', v_res; end if;
  update public.app_config set watchdog_pin_hash = '   ' where id = 1;
  v_res := public.watchdog_status(v_pin);
  if v_res is distinct from '{"ok": false, "motivo": "non_configurato"}'::jsonb then raise exception 'KO P: hash di spazi = %', v_res; end if;

  update public.app_config set watchdog_pin_hash = upper(encode(sha256(convert_to(v_pin, 'UTF8')), 'hex')) where id = 1;
  foreach st in array array['sbagliato', '', ' ' || v_pin, v_pin || ' ', upper(v_pin)] loop
    v_res := public.watchdog_status(st);
    if v_res is distinct from '{"ok": false}'::jsonb then raise exception 'KO P: PIN "%" = %', st, v_res; end if;
  end loop;
  v_res := public.watchdog_status(null);
  if v_res is distinct from '{"ok": false}'::jsonb then raise exception 'KO P: PIN nullo = %', v_res; end if;

  v_res := public.watchdog_status(v_pin);
  if v_res ->> 'ok' is distinct from 'true' then raise exception 'KO P: PIN giusto (hash maiuscolo) = %', v_res; end if;
  select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_res) k;
  if v_keys is distinct from array['db_mb', 'giri', 'net_402_30m', 'net_5xx_30m', 'now', 'ok', 'storage_mb'] then
    raise exception 'KO P: chiavi della risposta %', v_keys;
  end if;
  if abs(extract(epoch from ((v_res ->> 'now')::timestamptz - now()))) > 5 then raise exception 'KO P: now = %', v_res ->> 'now'; end if;
  select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_res -> 'giri') k;
  if v_keys is distinct from array['ads_sync', 'ce_guard_letture', 'cs_sync', 'loyalty_orders', 'shopify_sync', 'stock_autopush'] then
    raise exception 'KO P: giri %', v_keys;
  end if;
  foreach v_giro in array v_keys loop
    select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_res -> 'giri' -> v_giro) k;
    if v_keys is distinct from array['cron', 'log', 'on'] or jsonb_typeof(v_res -> 'giri' -> v_giro -> 'on') <> 'boolean' then
      raise exception 'KO P: giro % = %', v_giro, v_res -> 'giri' -> v_giro;
    end if;
    if jsonb_typeof(v_res -> 'giri' -> v_giro -> 'cron') = 'string' then
      perform (v_res -> 'giri' -> v_giro ->> 'cron')::timestamptz;
    end if;
    if jsonb_typeof(v_res -> 'giri' -> v_giro -> 'log') = 'string' then
      perform (v_res -> 'giri' -> v_giro ->> 'log')::timestamptz;
    end if;
  end loop;
  -- i giri che girano ogni ora o piu' spesso hanno un avvio del cron nelle ultime due ore (prova che la lettura vede i job)
  if (v_res -> 'giri' -> 'cs_sync' ->> 'cron') is null or (v_res -> 'giri' -> 'cs_sync' ->> 'cron')::timestamptz < now() - interval '2 hours' then
    raise exception 'KO P: cron di cs-sync-poll non visto: %', v_res -> 'giri' -> 'cs_sync';
  end if;
  if jsonb_typeof(v_res -> 'net_402_30m') <> 'number' or (v_res ->> 'net_402_30m')::numeric < 0 or (v_res ->> 'net_402_30m')::numeric <> trunc((v_res ->> 'net_402_30m')::numeric)
     or jsonb_typeof(v_res -> 'net_5xx_30m') <> 'number' or (v_res ->> 'net_5xx_30m')::numeric < 0 then
    raise exception 'KO P: contatori pg_net %, %', v_res -> 'net_402_30m', v_res -> 'net_5xx_30m';
  end if;
  if round((v_res ->> 'storage_mb')::numeric) <> v_storage or round((v_res ->> 'db_mb')::numeric) <> v_db then
    raise exception 'KO P: Storage % / database % diversi da v_health % / %', v_res ->> 'storage_mb', v_res ->> 'db_mb', v_storage, v_db;
  end if;
  if position('label' in v_res::text) > 0 or position('content' in v_res::text) > 0 then
    raise exception 'KO P: testo libero nella risposta';
  end if;

  -- A e U
  foreach r in array array['anon', 'authenticated'] loop
    perform set_config('role', r, true);
    perform set_config('request.jwt.claims', case when r = 'anon' then json_build_object('role', 'anon')
                                                  else json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0181@amimi.it') end::text, true);
    if r = 'anon' then
      v_res := public.watchdog_status(v_pin);
      if v_res ->> 'ok' is distinct from 'true' or round((v_res ->> 'storage_mb')::numeric) <> v_storage then
        raise exception 'KO A: anon col PIN giusto = %', v_res;
      end if;
      v_res := public.watchdog_status('sbagliato');
      if v_res is distinct from '{"ok": false}'::jsonb then raise exception 'KO A: anon col PIN sbagliato = %', v_res; end if;
    else
      st := 'ok';
      begin perform public.watchdog_status(v_pin); exception when others then st := sqlstate; end;
      if st <> '42501' then raise exception 'KO U: authenticated esegue la RPC (%)', st; end if;
    end if;
    foreach st in array array['select watchdog_pin_hash from public.app_config', 'select count(*) from public.app_config'] loop
      v_giro := 'ok';
      begin execute st; exception when others then v_giro := sqlstate; end;
      if v_giro <> '42501' then raise exception 'KO %: "%" = % (atteso 42501)', r, st, v_giro; end if;
    end loop;
    select count(*) into v_n from public.v_health where k in ('storage_mb', 'db_mb') and n = case k when 'storage_mb' then v_storage else v_db end;
    if v_n <> 2 then raise exception 'KO %: v_health non da'' Storage e database come al proprietario', r; end if;
  end loop;

  raise exception 'TEST_OK: C V P A U verdi; Storage % MB, database % MB (rollback voluto)', v_storage, v_db;
end $t$;
