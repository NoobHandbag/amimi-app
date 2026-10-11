-- tests/loyalty_checkin_idempotenza.sql: prova VIVA e SENZA RESIDUI delle funzioni della migr 0150 (Premia: presenze agli
-- eventi dal QR, codici riscattati, mazzo del memory) sull'account di test 10147859530055.
--   Si lancia con il connettore Supabase (execute_sql) o con psql: e' un unico blocco DO che scrive, verifica e alla
--   fine ALZA SEMPRE un'eccezione, cosi' ogni scrittura viene annullata (rollback) e il DB resta com'era.
--   Esito atteso: ERROR "TEST_OK: ... (rollback voluto)". Qualsiasi altro messaggio = un'asserzione fallita.
--   Cosa prova:
--     F  flag spento o cliente fuori lista -> 'off', nessuna scrittura
--     E  esiti senza scrittura: codice sconosciuto, formato sbagliato, evento spento, non iniziato, finito
--     P  presenza: +N una volta sola (seconda chiamata = already, stesso saldo), codice in minuscolo e con spazi
--     T  tetto di presenze: il cliente oltre il tetto resta fuori e non nasce nessun saldo
--     U  il vincolo UNIQUE su loyalty_events regge anche fuori dalla funzione
--     A  gia' registrata resta 'already' anche a evento finito
--     R  loyalty_redemptions_for: solo i riscatti del cliente chiesto, con tipo, valore e giorno di Roma
--     D  loyalty_memory_deck: da 2 a 8 foto dal CDN Shopify, tutte diverse
--     L  ledger: v_loyalty_ledger_drift senza scarti alla fine
do $$
declare
  c  constant text := '10147859530055';
  c2 constant text := 'TEST_0150_B';
  p0 int; n int; r jsonb;
begin
  select points into p0 from loyalty_points where shopify_customer_id = c;
  if p0 is null then raise exception 'account di test % non e'' membro', c; end if;
  if exists (select 1 from loyalty_checkin_events where code like 'TEST0150-%') then raise exception 'eventi di prova gia'' presenti: pulire prima'; end if;

  insert into loyalty_checkin_events (code, label, points, starts_at, ends_at, max_checkins) values
    ('TEST0150-ORA',    'evento di prova in corso', 20, now() - interval '1 hour', now() + interval '1 hour', 1),
    ('TEST0150-DOPO',   'evento di prova futuro',   20, now() + interval '1 day',  now() + interval '2 days', 10),
    ('TEST0150-PRIMA',  'evento di prova finito',   20, now() - interval '2 days', now() - interval '1 day',  10),
    ('TEST0150-SPENTO', 'evento di prova spento',   20, now() - interval '1 hour', now() + interval '1 hour', 10);
  update loyalty_checkin_events set active = false where code = 'TEST0150-SPENTO';

  -- F: flag spento = 'off' e nessuna scrittura; poi acceso SOLO per il cliente di test (valore = lista di id)
  update app_flags set value = 'false' where key = 'loyalty_checkin_enabled';
  r := loyalty_checkin(c, 'TEST0150-ORA');
  if (r->>'ok')::bool or r->>'reason' <> 'off' then raise exception 'F flag spento: %', r; end if;
  update app_flags set value = c where key = 'loyalty_checkin_enabled';
  r := loyalty_checkin(c2, 'TEST0150-ORA');
  if (r->>'ok')::bool or r->>'reason' <> 'off' then raise exception 'F cliente fuori lista: %', r; end if;
  if exists (select 1 from loyalty_checkins where event_code like 'TEST0150-%') then raise exception 'F ha scritto una presenza a flag spento'; end if;

  -- E: esiti senza scrittura
  r := loyalty_checkin(c, 'NONESISTE99');
  if (r->>'ok')::bool or r->>'reason' <> 'unknown_event' then raise exception 'E codice sconosciuto: %', r; end if;
  r := loyalty_checkin(c, 'x');
  if (r->>'ok')::bool or r->>'reason' <> 'unknown_event' then raise exception 'E formato sbagliato: %', r; end if;
  r := loyalty_checkin(c, null);
  if (r->>'ok')::bool or r->>'reason' <> 'unknown_event' then raise exception 'E codice nullo: %', r; end if;
  r := loyalty_checkin(c, 'TEST0150-SPENTO');
  if (r->>'ok')::bool or r->>'reason' <> 'unknown_event' then raise exception 'E evento spento: %', r; end if;
  r := loyalty_checkin(c, 'TEST0150-DOPO');
  if (r->>'ok')::bool or r->>'reason' <> 'not_started' then raise exception 'E non iniziato: %', r; end if;
  r := loyalty_checkin(c, 'TEST0150-PRIMA');
  if (r->>'ok')::bool or r->>'reason' <> 'ended' then raise exception 'E finito: %', r; end if;
  r := loyalty_checkin('', 'TEST0150-ORA');
  if (r->>'ok')::bool or r->>'reason' <> 'no_customer' then raise exception 'E cliente vuoto: %', r; end if;
  if exists (select 1 from loyalty_checkins where event_code like 'TEST0150-%') then raise exception 'E ha scritto una presenza'; end if;
  if (select points from loyalty_points where shopify_customer_id = c) <> p0 then raise exception 'E saldo cambiato'; end if;

  -- P: presenza, una sola volta (codice in minuscolo e con spazi: la funzione lo normalizza)
  r := loyalty_checkin(c, '  test0150-ora ');
  if not (r->>'ok')::bool or (r->>'already')::bool or (r->>'added')::int <> 20 or (r->>'points')::int <> p0 + 20 or r->>'label' <> 'evento di prova in corso' then raise exception 'P prima presenza: %', r; end if;
  r := loyalty_checkin(c, 'TEST0150-ORA');
  if not (r->>'ok')::bool or not (r->>'already')::bool or (r->>'added')::int <> 0 or (r->>'points')::int <> p0 + 20 then raise exception 'P seconda presenza doveva essere already: %', r; end if;
  select count(*) into n from loyalty_events where shopify_customer_id = c and source = 'event_checkin' and meta->>'event' = 'TEST0150-ORA';
  if n <> 1 then raise exception 'P eventi a ledger: % (atteso 1)', n; end if;
  if (select points from loyalty_points where shopify_customer_id = c) <> p0 + 20 then raise exception 'P saldo dopo due chiamate'; end if;
  if (select count(*) from loyalty_checkins where event_code = 'TEST0150-ORA') <> 1 then raise exception 'P righe presenza'; end if;

  -- T: tetto (max_checkins = 1): un secondo cliente resta fuori e non nasce nessun saldo
  update app_flags set value = 'true' where key = 'loyalty_checkin_enabled';
  r := loyalty_checkin(c2, 'TEST0150-ORA');
  if (r->>'ok')::bool or r->>'reason' <> 'full' then raise exception 'T tetto: %', r; end if;
  if exists (select 1 from loyalty_points where shopify_customer_id = c2) then raise exception 'T ha creato un saldo oltre il tetto'; end if;

  -- U: il vincolo UNIQUE su loyalty_events regge anche fuori dalla funzione
  begin
    insert into loyalty_events (shopify_customer_id, delta, source, meta) values (c, 20, 'event_checkin', jsonb_build_object('event', 'TEST0150-ORA'));
    raise exception 'U un secondo evento event_checkin per lo stesso cliente ed evento e'' stato accettato';
  exception when unique_violation then null;
  end;

  -- A: gia' registrata resta already anche a evento finito
  update loyalty_checkin_events set starts_at = now() - interval '3 hours', ends_at = now() - interval '2 hours' where code = 'TEST0150-ORA';
  r := loyalty_checkin(c, 'TEST0150-ORA');
  if not (r->>'ok')::bool or not (r->>'already')::bool then raise exception 'A already a evento finito: %', r; end if;

  -- R: riscatti del solo cliente chiesto, con tipo, valore e giorno di Roma
  r := loyalty_redemptions_for(c);
  if jsonb_typeof(r) <> 'array' or jsonb_array_length(r) <> (select count(*) from loyalty_redemptions where shopify_customer_id = c and status in ('pending', 'fulfilled')) then raise exception 'R numero di riscatti: %', r; end if;
  if jsonb_array_length(r) > 0 and not (r->0 ? 'created_day' and r->0 ? 'used_at' and r->0 ? 'kind' and r->0 ? 'value') then raise exception 'R campi mancanti: %', r->0; end if;
  if loyalty_redemptions_for('NESSUN_CLIENTE_0150') <> '[]'::jsonb then raise exception 'R un cliente senza riscatti deve dare lista vuota'; end if;

  -- D: mazzo del memory
  r := loyalty_memory_deck(6);
  n := jsonb_array_length(r);
  if n < 2 or n > 8 then raise exception 'D numero di carte: %', n; end if;
  if exists (select 1 from jsonb_array_elements(r) e where e->>'img' not like 'https://cdn.shopify.com/%') then raise exception 'D foto fuori dal CDN Shopify'; end if;
  if (select count(distinct e->>'img') from jsonb_array_elements(r) e) <> n then raise exception 'D foto doppie nel mazzo'; end if;

  -- L: ledger in quadra
  if exists (select 1 from v_loyalty_ledger_drift where diff <> 0) then raise exception 'L ledger fuori quadra'; end if;

  raise exception 'TEST_OK: presenze (flag, esiti, una sola volta, tetto, UNIQUE, already), riscatti, mazzo, ledger in quadra (rollback voluto)';
end $$;
