-- tests/push_rls.sql: prova VIVA della migr 0163 (modulo push_*, notifiche native), da lanciare DOPO l'apply.
-- Test negativo obbligatorio della Regola Ferrea 19. Si incolla in UNA chiamata execute_sql (o psql): e' un unico blocco DO
-- che alla fine alza SEMPRE un'eccezione, quindi la riga di prova e i cambi di ruolo tornano indietro (come begin ... rollback).
--   esito buono: ERROR P0001 'TEST_OK: ... (rollback voluto)'; qualunque altro errore = KO, col motivo.
-- Cosa prova:
--   V  vincoli, da proprietario: endpoint e device_id unici, chi solo fra le chiavi di PEOPLE ('Benny' e' il nome mostrato,
--      la chiave e' 'Bene'), chiave del tema minuscola, temi trovati con @> (la query di `invia`)
--   S  il service_role (la edge push-api) legge e scrive le due tabelle
--   U  authenticated con un JWT del team: select, insert, update e delete sulle due tabelle = 42501 (nessuna policy:
--      neanche il team legge le iscrizioni), v_push_settings da' la sola riga push_enabled e non si scrive
--   N  anon: come U
do $t$
declare
  r name;
  q text;
  st text;
  cn text;
  n int;
  k text;
  d1 uuid := gen_random_uuid();
  e1 constant text := 'https://fcm.googleapis.com/fcm/send/prova-0163-a';
  vietate constant text[] := array[
    'select count(*) from public.push_subscriptions',
    'insert into public.push_subscriptions (endpoint, p256dh, auth, device_id, chi, user_email) values (''https://fcm.googleapis.com/fcm/send/prova-0163-n'', ''x'', ''x'', gen_random_uuid(), ''Ale'', ''prova.0163@amimi.it'')',
    'update public.push_subscriptions set fail_count = fail_count + 1',
    'delete from public.push_subscriptions',
    'select count(*) from public.push_temi',
    'insert into public.push_temi (key, etichetta) values (''prova_0163'', ''Prova'')',
    'update public.push_temi set attivo = false',
    'delete from public.push_temi',
    'insert into public.v_push_settings (key, value) values (''prova_0163'', ''x'')',
    'update public.v_push_settings set value = ''true''',
    'delete from public.v_push_settings'
  ];
begin
  if to_regclass('public.push_subscriptions') is null or to_regclass('public.push_temi') is null or to_regclass('public.v_push_settings') is null then
    raise exception 'KO: migr 0163 non applicata';
  end if;

  -- V
  insert into push_subscriptions (endpoint, p256dh, auth, device_id, chi, temi, user_email)
    values (e1, 'p256dh-prova', 'auth-prova', d1, 'Ale', array['conti'], 'prova.0163@amimi.it');
  select count(*) into n from push_subscriptions where temi @> array['conti'] and device_id = d1 and fail_count = 0;
  if n <> 1 then raise exception 'KO V: la riga di prova non si trova con temi @> {conti}'; end if;

  st := 'ok'; cn := null;
  begin
    insert into push_subscriptions (endpoint, p256dh, auth, device_id, chi, user_email)
      values (e1, 'x', 'x', gen_random_uuid(), 'Bene', 'prova.0163@amimi.it');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23505' or cn is distinct from 'push_subscriptions_endpoint_uk' then raise exception 'KO V: endpoint doppio = % %', st, cn; end if;

  st := 'ok'; cn := null;
  begin
    insert into push_subscriptions (endpoint, p256dh, auth, device_id, chi, user_email)
      values (e1 || '-b', 'x', 'x', d1, 'Bene', 'prova.0163@amimi.it');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23505' or cn is distinct from 'push_subscriptions_device_uk' then raise exception 'KO V: device_id doppio = % %', st, cn; end if;

  st := 'ok'; cn := null;
  begin
    insert into push_subscriptions (endpoint, p256dh, auth, device_id, chi, user_email)
      values (e1 || '-c', 'x', 'x', gen_random_uuid(), 'Benny', 'prova.0163@amimi.it');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23514' or cn is distinct from 'push_subscriptions_chi_ck' then raise exception 'KO V: chi ''Benny'' = % %', st, cn; end if;

  st := 'ok'; cn := null;
  begin
    insert into push_temi (key, etichetta) values ('Conti', 'x');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23514' or cn is distinct from 'push_temi_key_ck' then raise exception 'KO V: tema ''Conti'' = % %', st, cn; end if;

  -- S (dal catalogo: il ruolo della edge non si assume da qui)
  if not (has_table_privilege('service_role', 'public.push_subscriptions', 'select') and has_table_privilege('service_role', 'public.push_subscriptions', 'insert')
          and has_table_privilege('service_role', 'public.push_subscriptions', 'update') and has_table_privilege('service_role', 'public.push_subscriptions', 'delete')
          and has_table_privilege('service_role', 'public.push_temi', 'select')) then
    raise exception 'KO S: il service_role non legge o non scrive le tabelle push_*';
  end if;

  -- U e N
  foreach r in array array['authenticated', 'anon'] loop
    perform set_config('role', r, true);
    perform set_config('request.jwt.claims', case when r = 'anon' then json_build_object('role', 'anon')
                                                  else json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0163@amimi.it') end::text, true);
    foreach q in array vietate loop
      st := 'ok';
      begin execute q; exception when others then st := sqlstate; end;
      if st <> '42501' then raise exception 'KO %: "%" = % (atteso 42501)', r, q, st; end if;
    end loop;
    select count(*), min(key) into n, k from public.v_push_settings;
    if n <> 1 or k is distinct from 'push_enabled' then
      raise exception 'KO %: v_push_settings da'' % righe (prima chiave %), attesa la sola push_enabled', r, n, k;
    end if;
  end loop;

  raise exception 'TEST_OK: V S U N verdi, % comandi vietati provati per ruolo (rollback voluto)', array_length(vietate, 1);
end $t$;
