-- tests/dominio_team_rls.sql: prova VIVA della migr 0161 (domini del team), da lanciare in produzione DOPO l'apply.
-- Finisce SEMPRE in eccezione, quindi in rollback: l'utente Telaio finto e i cambi di ruolo non restano.
--   esito buono: ERROR P0001 'TEST_OK: ... (rollback voluto)'; qualunque altro errore = KO, col motivo.
-- Cosa prova, da ruolo authenticated con un JWT costruito a mano (come PostgREST):
--   T  utente @telaioconsulting.com con account confermato: vede cs_*, lead_*, mat_* e i file dei bucket come il totale,
--      Premia lo riconosce (loyalty_staff_email) e la dashboard risponde
--   G  JWT gmail: zero righe ovunque, dashboard 42501
--   S  JWT @telaioconsulting.com SENZA account: Premia non lo riconosce (Gate 2 del 12-10: conta auth.users, non il token)
--   A  account @amimi.it reale: come prima della 0161
--   N  anon: niente cs_faq, niente email_del_team
do $t$
declare
  amimi_id uuid; amimi_mail text; fake uuid := gen_random_uuid();
  tot int[]; got int[]; n int; st text;
  conta constant text := 'select array[(select count(*) from public.cs_faq), (select count(*) from public.cs_messages), (select count(*) from public.lead_accounts), (select count(*) from public.mat_suppliers), (select count(*) from storage.objects where bucket_id = ''mat-assets''), (select count(*) from storage.objects where bucket_id = ''loyalty-ugc'')]::int[]';
begin
  select id, email into amimi_id, amimi_mail from auth.users where email ilike '%@amimi.it' and email_confirmed_at is not null order by created_at limit 1;
  if amimi_id is null then raise exception 'KO: nessun account @amimi.it confermato, la prova A non si puo'' fare'; end if;
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
    values (fake, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prova.0161@telaioconsulting.com', now(), now(), now());
  execute conta into tot;
  if tot[1] = 0 or tot[2] = 0 or tot[4] = 0 then raise exception 'KO: tabelle vuote, la prova non distingue niente (%)', tot; end if;

  perform set_config('role', 'authenticated', true);

  -- T
  perform set_config('request.jwt.claims', json_build_object('sub', fake, 'role', 'authenticated', 'email', 'prova.0161@telaioconsulting.com')::text, true);
  execute conta into got;
  if got <> tot then raise exception 'KO T: Telaio vede % invece di %', got, tot; end if;
  if public.loyalty_staff_email() is null then raise exception 'KO T: Premia non riconosce l''account Telaio'; end if;
  begin perform public.loyalty_dashboard(7); exception when others then raise exception 'KO T: dashboard rifiutata (%)', sqlstate; end;

  -- G
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'x@gmail.com')::text, true);
  execute conta into got;
  if got <> array[0, 0, 0, 0, 0, 0] then raise exception 'KO G: gmail vede %', got; end if;
  if public.loyalty_staff_email() is not null then raise exception 'KO G: Premia riconosce un gmail'; end if;
  st := 'ok';
  begin perform public.loyalty_dashboard(7); exception when others then st := sqlstate; end;
  if st <> '42501' then raise exception 'KO G: dashboard a un gmail = %', st; end if;

  -- S
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'finto@telaioconsulting.com')::text, true);
  if public.loyalty_staff_email() is not null then raise exception 'KO S: Premia riconosce un''email Telaio solo dichiarata nel token'; end if;

  -- A
  perform set_config('request.jwt.claims', json_build_object('sub', amimi_id, 'role', 'authenticated', 'email', amimi_mail)::text, true);
  execute conta into got;
  if got <> tot then raise exception 'KO A: @amimi.it vede % invece di %', got, tot; end if;
  if public.loyalty_staff_email() is null then raise exception 'KO A: Premia non riconosce piu'' @amimi.it'; end if;

  -- N
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  st := 'ok';
  begin select count(*) into n from public.cs_faq; exception when others then st := sqlstate; end;
  if st = 'ok' and n > 0 then raise exception 'KO N: anon legge % righe di cs_faq', n; end if;
  st := 'ok';
  begin perform public.email_del_team('x@amimi.it'); exception when others then st := sqlstate; end;
  if st <> '42501' then raise exception 'KO N: anon esegue email_del_team (%)', st; end if;

  raise exception 'TEST_OK: T G S A N verdi, totali % (rollback voluto)', tot;
end $t$;
