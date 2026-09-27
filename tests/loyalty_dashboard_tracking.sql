-- Test della migr 0146 (dashboard Premia + tracciamento Area Membri). Gira in produzione senza lasciare tracce:
-- il blocco finisce SEMPRE con raise 'TEST_OK ...' (o con l'errore del controllo fallito), quindi tutto torna indietro,
-- flag compreso. Lanciare con execute_sql o psql; atteso: ERROR "TEST_OK loyalty 0146".
do $$
declare
  c text := 'TEST_TRACK_0146';
  r jsonb;
  n int;
  big jsonb;
begin
  -- A. flag spento: nessuna scrittura
  update app_flags set value = 'false' where key = 'loyalty_track_enabled';
  r := loyalty_track(c, '[{"e":"page_open"}]'::jsonb);
  if r ->> 'reason' is distinct from 'off' then raise exception 'A: flag spento ma track non risponde off: %', r; end if;
  if exists (select 1 from loyalty_ui_events where shopify_customer_id = c) then raise exception 'A: scritto a flag spento'; end if;

  -- B. flag acceso solo per il cliente di prova (lista di id): un altro cliente resta fuori
  update app_flags set value = c where key = 'loyalty_track_enabled';
  r := loyalty_track('ALTRO_CLIENTE', '[{"e":"page_open"}]'::jsonb);
  if r ->> 'reason' is distinct from 'off' then raise exception 'B: flag a lista ma un altro cliente scrive: %', r; end if;

  -- C. liste chiuse: passano solo le coppie ammesse
  r := loyalty_track(c, '[{"e":"page_open"},{"e":"view","el":"redeem_ready"},{"e":"tap","el":"redeem"},
                          {"e":"view","el":"email_cliente"},{"e":"hack","el":"x"},{"e":"page_open","el":"club"},"stringa",42,
                          {"e":"tap","el":"REDEEM"},{"e":"view","el":"redeem_ready; drop table x;--"}]'::jsonb);
  if (r ->> 'inserted')::int <> 3 then raise exception 'C: attesi 3 eventi validi, inseriti %', r; end if;

  -- D. payload non array
  r := loyalty_track(c, '{"e":"page_open"}'::jsonb);
  if r ->> 'reason' is distinct from 'bad_payload' then raise exception 'D: payload oggetto accettato: %', r; end if;

  -- E. tetto per chiamata: 25 eventi validi -> 20
  select jsonb_agg(jsonb_build_object('e', 'tap', 'el', 'coccola')) into big from generate_series(1, 25);
  r := loyalty_track(c, big);
  if (r ->> 'inserted')::int <> 20 then raise exception 'E: tetto per chiamata non rispettato: %', r; end if;

  -- F. tetto giornaliero 300: oggi ne ha 23, ne aggiungo 270 a mano -> restano 7 posti
  insert into loyalty_ui_events (shopify_customer_id, day, event, element)
  select c, (now() at time zone 'Europe/Rome')::date, 'tap', 'gioco' from generate_series(1, 270);
  r := loyalty_track(c, big);
  if (r ->> 'inserted')::int <> 7 or (r ->> 'capped')::boolean is not true then raise exception 'F: tetto giornaliero: %', r; end if;
  r := loyalty_track(c, big);
  if (r ->> 'inserted')::int <> 0 then raise exception 'F: oltre il tetto giornaliero: %', r; end if;

  -- G. dashboard: senza JWT @amimi.it rifiuta (42501)
  perform set_config('request.jwt.claims', '{"email":"qualcuno@gmail.com","role":"authenticated"}', true);
  begin
    r := loyalty_dashboard(30);
    raise exception 'G: dashboard aperta a un account non @amimi.it';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '', true);
  begin
    r := loyalty_dashboard(30);
    raise exception 'G: dashboard aperta senza JWT';
  exception when insufficient_privilege then null;
  end;

  -- H. dashboard con @amimi.it: tutte le sezioni, niente id clienti ne' codici nel risultato
  perform set_config('request.jwt.claims', '{"email":"info@amimi.it","role":"authenticated"}', true);
  r := loyalty_dashboard(30);
  if not (r ?& array['health', 'flags', 'kpi_daily', 'pool', 'members', 'visitatori', 'second', 'redeem_rate', 'amica12', 'vendite', 'uplift', 'funnel', 'elementi'])
    then raise exception 'H: sezioni mancanti: %', (select array_agg(k) from jsonb_object_keys(r) k); end if;
  if r::text like '%' || c || '%' then raise exception 'H: id cliente nel risultato della dashboard'; end if;
  if r::text ~ 'AMICA12-[A-Z0-9]{4,}' then raise exception 'H: codice sconto nel risultato della dashboard'; end if;
  if r -> 'flags' ->> 'loyalty_track_enabled' is distinct from 'test' then raise exception 'H: flag a lista non mostrato come test: %', r -> 'flags'; end if;
  if (r -> 'funnel' ->> 'tap_riscatta')::int < 1 then raise exception 'H: il funnel non vede il tap di prova'; end if;
  -- p_days fuori scala viene riportato in 1..365
  if (loyalty_dashboard(9999) ->> 'days')::int <> 365 or (loyalty_dashboard(-3) ->> 'days')::int <> 1 then raise exception 'H: p_days non limitato'; end if;

  -- I. permessi: anon non esegue la dashboard, authenticated non esegue track
  if has_function_privilege('anon', 'public.loyalty_dashboard(integer)', 'execute') then raise exception 'I: anon esegue loyalty_dashboard'; end if;
  if has_function_privilege('authenticated', 'public.loyalty_track(text, jsonb)', 'execute') then raise exception 'I: authenticated esegue loyalty_track'; end if;
  if has_function_privilege('anon', 'public.loyalty_track(text, jsonb)', 'execute') then raise exception 'I: anon esegue loyalty_track'; end if;
  if has_table_privilege('anon', 'public.loyalty_ui_events', 'select') or has_table_privilege('authenticated', 'public.loyalty_ui_events', 'select')
    then raise exception 'I: loyalty_ui_events leggibile da anon/authenticated'; end if;
  if has_table_privilege('anon', 'public.v_loyalty_funnel_daily', 'select') then raise exception 'I: v_loyalty_funnel_daily leggibile da anon'; end if;

  -- J. purge: righe oltre 180 giorni vanno via, le recenti restano
  insert into loyalty_ui_events (shopify_customer_id, day, event, element) values (c, (now() at time zone 'Europe/Rome')::date - 200, 'page_open', null);
  n := loyalty_ui_events_purge();
  if n < 1 or exists (select 1 from loyalty_ui_events where shopify_customer_id = c and day < (now() at time zone 'Europe/Rome')::date - 180)
    then raise exception 'J: purge non ha tolto le righe vecchie'; end if;
  if not exists (select 1 from loyalty_ui_events where shopify_customer_id = c) then raise exception 'J: purge ha tolto righe recenti'; end if;

  raise exception 'TEST_OK loyalty 0146';
end $$;
