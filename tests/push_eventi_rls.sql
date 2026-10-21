-- tests/push_eventi_rls.sql: prova VIVA della migr 0166 (eventi per profilo, modulo push_*), da lanciare DOPO l'apply.
-- Test negativo obbligatorio della Regola Ferrea 19, sul modello di tests/push_rls.sql. Si incolla in UNA chiamata
-- execute_sql (o psql): e' un unico blocco DO che alla fine alza SEMPRE un'eccezione, quindi le righe di prova e i cambi
-- di ruolo tornano indietro (come begin ... rollback).
--   esito buono: ERROR P0001 'TEST_OK: ... (rollback voluto)'; qualunque altro errore = KO, col motivo.
-- Cosa prova:
--   V  vincoli, da proprietario: evento nuovo spento con soglie {}; i cinque stati ammessi e uno fuori elenco no;
--      UNIQUE (evento, chiave) con 23505 e la prenotazione della edge (on conflict do nothing = zero righe, chi non
--      prenota salta); stessa chiave su un altro evento ammessa; evento e tema inesistenti = 23503; chiave vuota,
--      tentativi negativi, soglie non oggetto, nome evento maiuscolo, predefinito_per con un nome mostrato ('Benny') =
--      23514; predefinito_per null = 23502; un tema usato da un evento e un evento con invii non si cancellano
--   D  i sette eventi del contratto con push-eventi esistono, ognuno sul suo tema (il settimo, attivita_team sul tema
--      attivita, nasce nella migr 0168 del 21-10: da lanciare dopo l'apply anche di quella)
--   S  il service_role (la edge push-eventi) legge e scrive le due tabelle e usa la sequenza dell'id
--   U  authenticated con un JWT del team: select, insert, update e delete su push_eventi e push_eventi_inviati,
--      nextval della sequenza, lettura e scrittura di predefinito_per = 42501 (nessuna policy: neanche il team accende
--      un evento o legge il registro); v_push_settings da' ancora la sola riga push_enabled (push_eventi_enabled non esce)
--   N  anon: come U
--   F  (Gate 3 del 18-10, MIG-B1) push_eventi_salute(), da proprietario: a modulo spento non scrive health_log; acceso,
--      un evento acceso fermo da 31 minuti = error col suo nome, uno mai girato = almeno warn col suo nome. anon e
--      authenticated non la eseguono (sta in U e N), il service_role si' (sta in S)
--   P  (solo informazione, non fa fallire: MIG-C1) quanti telefoni iscritti DOPO l'apply hanno un tema fuori dal
--      predefinito_per del loro profilo. Puo' essere una scelta voluta, ma anche una scheda Notifiche ancora del bundle
--      vecchio che spuntava tutto: da guardare con la persona prima di accendere gli eventi
do $t$
declare
  r name;
  q text;
  st text;
  cn text;
  n int;
  k text;
  v_seq text := pg_get_serial_sequence('public.push_eventi_inviati', 'id');
  vietate text[];
  v_fresh_n int;
  v_fresh_prima timestamptz;
  v_lab text;
  v_fuori int;
begin
  if to_regclass('public.push_eventi') is null or to_regclass('public.push_eventi_inviati') is null or v_seq is null
     or not exists (select 1 from pg_attribute a where a.attrelid = 'public.push_temi'::regclass and a.attname = 'predefinito_per' and not a.attisdropped) then
    raise exception 'KO: migr 0166 non applicata';
  end if;
  vietate := array[
    'select count(*) from public.push_eventi',
    'insert into public.push_eventi (evento, tema) values (''prova_test_rls_n'', ''conti'')',
    'update public.push_eventi set attivo = true',
    'delete from public.push_eventi',
    'select count(*) from public.push_eventi_inviati',
    'insert into public.push_eventi_inviati (evento, chiave, stato) values (''cs_urgente'', ''prova-0166-n'', ''prenotato'')',
    'update public.push_eventi_inviati set stato = ''inviato''',
    'delete from public.push_eventi_inviati',
    format('select nextval(%L)', v_seq),
    'select predefinito_per from public.push_temi',
    'update public.push_temi set predefinito_per = ''{Ale}''',
    'select public.push_eventi_salute()'
  ];

  -- V
  insert into push_temi (key, etichetta, predefinito_per) values ('prova_test_rls', 'Prova 0166', array['Ale']);
  insert into push_temi (key, etichetta) values ('prova_test_rls_b', 'Prova 0166 b');
  select count(*) into n from push_temi where key = 'prova_test_rls_b' and predefinito_per = '{}';
  if n <> 1 then raise exception 'KO V: un tema senza predefinito_per non nasce con {}'; end if;

  insert into push_eventi (evento, tema) values ('prova_test_rls', 'prova_test_rls');
  select count(*) into n from push_eventi where evento = 'prova_test_rls' and attivo = false and soglie = '{}'::jsonb and baseline_at is null;
  if n <> 1 then raise exception 'KO V: un evento nuovo non nasce spento con soglie {}'; end if;

  foreach k in array array['prenotato', 'inviato', 'fallito', 'saltato', 'nessun_iscritto'] loop
    insert into push_eventi_inviati (evento, chiave, stato) values ('prova_test_rls', 'stato:' || k, k);
  end loop;
  select count(*) into n from push_eventi_inviati where evento = 'prova_test_rls' and tentativi = 0 and esito is null and id is not null;
  if n <> 5 then raise exception 'KO V: i cinque stati non entrano tutti (% righe)', n; end if;

  st := 'ok'; cn := null;
  begin
    insert into push_eventi_inviati (evento, chiave, stato) values ('prova_test_rls', 'stato:prenotato', 'prenotato');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23505' or cn is distinct from 'push_eventi_inviati_uk' then raise exception 'KO V: (evento, chiave) doppia = % %', st, cn; end if;

  insert into push_eventi_inviati (evento, chiave, stato) values ('prova_test_rls', 'stato:prenotato', 'prenotato')
    on conflict (evento, chiave) do nothing;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'KO V: la seconda prenotazione della stessa chiave e'' passata (% righe)', n; end if;

  insert into push_eventi (evento, tema) values ('prova_test_rls_b', 'prova_test_rls');
  insert into push_eventi_inviati (evento, chiave, stato) values ('prova_test_rls_b', 'stato:prenotato', 'prenotato');

  st := 'ok'; cn := null;
  begin
    insert into push_eventi_inviati (evento, chiave, stato) values ('prova_test_rls', 'x1', 'inviata');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23514' or cn is distinct from 'push_eventi_inviati_stato_ck' then raise exception 'KO V: stato ''inviata'' = % %', st, cn; end if;

  st := 'ok'; cn := null;
  begin
    insert into push_eventi_inviati (evento, chiave, stato) values ('prova_inesistente', 'x2', 'prenotato');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23503' or cn is distinct from 'push_eventi_inviati_evento_fk' then raise exception 'KO V: evento inesistente = % %', st, cn; end if;

  st := 'ok'; cn := null;
  begin
    insert into push_eventi_inviati (evento, chiave, stato) values ('prova_test_rls', '', 'prenotato');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23514' or cn is distinct from 'push_eventi_inviati_chiave_ck' then raise exception 'KO V: chiave vuota = % %', st, cn; end if;

  st := 'ok'; cn := null;
  begin
    insert into push_eventi_inviati (evento, chiave, stato, tentativi) values ('prova_test_rls', 'x3', 'fallito', -1);
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23514' or cn is distinct from 'push_eventi_inviati_tentativi_ck' then raise exception 'KO V: tentativi -1 = % %', st, cn; end if;

  st := 'ok'; cn := null;
  begin
    insert into push_eventi (evento, tema) values ('prova_test_rls_c', 'tema_inesistente');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23503' or cn is distinct from 'push_eventi_tema_fk' then raise exception 'KO V: tema inesistente = % %', st, cn; end if;

  st := 'ok'; cn := null;
  begin
    insert into push_eventi (evento, tema, soglie) values ('prova_test_rls_c', 'prova_test_rls', '[]');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23514' or cn is distinct from 'push_eventi_soglie_ck' then raise exception 'KO V: soglie [] = % %', st, cn; end if;

  st := 'ok'; cn := null;
  begin
    insert into push_eventi (evento, tema) values ('Prova_test_rls', 'prova_test_rls');
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23514' or cn is distinct from 'push_eventi_evento_ck' then raise exception 'KO V: evento ''Prova_test_rls'' = % %', st, cn; end if;

  st := 'ok'; cn := null;
  begin
    insert into push_temi (key, etichetta, predefinito_per) values ('prova_test_rls_c', 'x', array['Ale', 'Benny']);
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23514' or cn is distinct from 'push_temi_predefinito_per_ck' then raise exception 'KO V: predefinito_per {Ale,Benny} = % %', st, cn; end if;

  st := 'ok';
  begin
    insert into push_temi (key, etichetta, predefinito_per) values ('prova_test_rls_c', 'x', null);
  exception when others then st := sqlstate;
  end;
  if st <> '23502' then raise exception 'KO V: predefinito_per null = % (atteso 23502)', st; end if;

  st := 'ok'; cn := null;
  begin
    delete from push_temi where key = 'prova_test_rls';
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23503' or cn is distinct from 'push_eventi_tema_fk' then raise exception 'KO V: tema usato da un evento cancellato = % %', st, cn; end if;

  st := 'ok'; cn := null;
  begin
    delete from push_eventi where evento = 'prova_test_rls';
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23503' or cn is distinct from 'push_eventi_inviati_evento_fk' then raise exception 'KO V: evento con invii cancellato = % %', st, cn; end if;

  -- D (dal 21-10 anche attivita_team della migr 0168: va lanciata dopo l'apply di tutte e due)
  select count(*) into n from push_eventi e
    join (values ('b2b_risposta_negozio', 'negozi'), ('cs_urgente', 'assistenza'), ('cs_cliente_ha_riscritto', 'assistenza'),
                 ('spedizione_eccezione', 'spedizioni'), ('sistema_cs_sync_fermo', 'sistema'), ('riepilogo', 'riepilogo'), ('attivita_team', 'attivita')) x(ev, tema)
      on x.ev = e.evento and x.tema = e.tema;
  if n <> 7 then raise exception 'KO D: dei sette eventi del contratto (0166 e 0168) ne tornano % sul tema giusto', n; end if;

  -- S (dal catalogo: il ruolo della edge non si assume da qui)
  if not (has_table_privilege('service_role', 'public.push_eventi', 'select') and has_table_privilege('service_role', 'public.push_eventi', 'update')
          and has_table_privilege('service_role', 'public.push_eventi_inviati', 'select') and has_table_privilege('service_role', 'public.push_eventi_inviati', 'insert')
          and has_table_privilege('service_role', 'public.push_eventi_inviati', 'update') and has_table_privilege('service_role', 'public.push_eventi_inviati', 'delete')
          and has_sequence_privilege('service_role', v_seq, 'usage') and has_table_privilege('service_role', 'public.push_temi', 'select')
          and has_function_privilege('service_role', 'public.push_eventi_salute()', 'execute')) then
    raise exception 'KO S: il service_role non legge o non scrive le tabelle di push-eventi';
  end if;

  -- F (prima di U e N: qui si e' ancora proprietari; flag ed evento di prova tornano indietro con l'eccezione finale)
  select count(*), max(h.created_at) into v_fresh_n, v_fresh_prima from health_log h where h.day = current_date and h.k = 'push_eventi_fresh';
  insert into app_flags (key, value) values ('push_eventi_enabled', 'false') on conflict (key) do update set value = 'false';
  perform public.push_eventi_salute();
  if (select count(*) from health_log h where h.day = current_date and h.k = 'push_eventi_fresh') <> v_fresh_n
     or (select max(h.created_at) from health_log h where h.day = current_date and h.k = 'push_eventi_fresh') is distinct from v_fresh_prima then
    raise exception 'KO F: a modulo spento push_eventi_salute() ha scritto health_log';
  end if;
  insert into app_flags (key, value) values ('push_eventi_enabled', 'true') on conflict (key) do update set value = 'true';
  insert into app_flags (key, value) values ('push_enabled', 'true') on conflict (key) do update set value = 'true';
  update push_eventi set attivo = true, ultimo_giro_at = now() - interval '31 minutes' where evento = 'prova_test_rls';
  perform public.push_eventi_salute();
  select h.severity, h.label into st, v_lab from health_log h where h.day = current_date and h.k = 'push_eventi_fresh';
  if st is distinct from 'error' or position('prova_test_rls' in coalesce(v_lab, '')) = 0 then
    raise exception 'KO F: evento fermo da 31 minuti = % (%)', st, v_lab;
  end if;
  update push_eventi set ultimo_giro_at = null where evento = 'prova_test_rls';
  perform public.push_eventi_salute();
  select h.severity, h.label into st, v_lab from health_log h where h.day = current_date and h.k = 'push_eventi_fresh';
  if st not in ('warn', 'error') or position('mai girati: ' in coalesce(v_lab, '')) = 0 or position('prova_test_rls' in v_lab) = 0 then
    raise exception 'KO F: evento acceso e mai girato = % (%)', st, v_lab;
  end if;
  update push_eventi set attivo = false where evento = 'prova_test_rls';

  -- P (informazione)
  select count(distinct s.id) into v_fuori
    from push_subscriptions s join push_temi pt on pt.key = any(s.temi)
   where not (s.chi = any(pt.predefinito_per))
     and s.created_at > coalesce((select min(c.ts) from change_log c where c.tbl = 'cron.job' and c.row_id = 'push-eventi' and c.op = 'cron_create'), 'infinity'::timestamptz);

  -- U e N
  foreach r in array array['authenticated', 'anon'] loop
    perform set_config('role', r, true);
    perform set_config('request.jwt.claims', case when r = 'anon' then json_build_object('role', 'anon')
                                                  else json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0166@amimi.it') end::text, true);
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

  raise exception 'TEST_OK: V D S F U N verdi, % comandi vietati provati per ruolo; P: % telefoni iscritti dopo l''apply con temi fuori dal loro profilo (rollback voluto)', array_length(vietate, 1), v_fuori;
end $t$;
