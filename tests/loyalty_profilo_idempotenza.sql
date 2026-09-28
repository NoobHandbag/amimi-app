-- tests/loyalty_profilo_idempotenza.sql — prova VIVA e SENZA RESIDUI delle RPC della migr 0141 (Premia: profilo,
-- compleanno, bonus seconda borsa) sull'account di test 10147859530055.
--   Si lancia con il connettore Supabase (execute_sql) o con psql: e' un unico blocco DO che scrive, verifica e alla
--   fine ALZA SEMPRE un'eccezione, cosi' ogni scrittura viene annullata (rollback) e il DB resta com'era.
--   Esito atteso: ERROR "TEST_OK: ... (rollback voluto)". Qualsiasi altro messaggio = un'asserzione fallita.
--   Cosa prova (criterio 2 del brief: la stessa azione ripetuta 2 volte = 1 evento):
--     A1 profilo: due salvataggi completi identici -> 1 evento profile_complete, +10 una volta, data bloccata al 2° giro
--     A2 compleanno: due giri sullo stesso giorno -> 1 evento birthday, +20 una volta; 29/02 -> 28/02; 30 giorni di anticipo
--     A3 flag a lista: il giro accredita SOLO il cliente in lista (gli altri no)
--     C1 bonus: due giri -> 1 evento bonus_second, +50 una volta; 2° ordine fuori dai 90 giorni -> nulla
--     C2 storno: 2° ordine rimborsato per intero -> bonus stornato una volta sola, mai sotto zero
--     L  ledger: v_loyalty_ledger_drift vuota alla fine di ogni passo
do $$
declare
  c constant text := '10147859530055';
  p0 int; p1 int; n int; r jsonb; d date; y int;
begin
  select points into p0 from loyalty_points where shopify_customer_id = c;
  if p0 is null then raise exception 'account di test % non e'' membro', c; end if;
  if exists (select 1 from loyalty_profiles where shopify_customer_id = c) then raise exception 'profilo di test gia'' presente: pulire prima'; end if;

  -- flag accesi SOLO per il cliente di test (valore = lista di id), dentro la transazione che verra'' annullata
  update app_flags set value = c where key in ('loyalty_profile_enabled', 'loyalty_bonus_second_enabled');
  update app_flags set value = '2026-09-01T00:00:00Z' where key = 'loyalty_bonus_second_since';

  -- A1: salvataggio completo due volte
  r := loyalty_profile_save(c, 29, 2, 'cavallino', true);
  if not (r->>'ok')::bool or not (r->>'awarded')::bool then raise exception 'A1 primo salvataggio: %', r; end if;
  r := loyalty_profile_save(c, 29, 2, 'cavallino', true);
  if not (r->>'ok')::bool or (r->>'awarded')::bool then raise exception 'A1 secondo salvataggio deve essere awarded=false: %', r; end if;
  select count(*) into n from loyalty_events where shopify_customer_id = c and source = 'profile_complete';
  if n <> 1 then raise exception 'A1 eventi profile_complete = % (atteso 1)', n; end if;
  select points into p1 from loyalty_points where shopify_customer_id = c;
  if p1 <> p0 + 10 then raise exception 'A1 punti % (atteso %)', p1, p0 + 10; end if;
  r := loyalty_profile_save(c, 5, 5, null, true);
  if not (r->>'birthday_locked')::bool then raise exception 'A1 la data doveva risultare bloccata: %', r; end if;
  if (select birth_day from loyalty_profiles where shopify_customer_id = c) <> 29 then raise exception 'A1 la data e'' cambiata'; end if;
  r := loyalty_profile_save('TEST_0141_X', 31, 2, 'cocco', true);   -- 31/02 non esiste
  if (r->>'ok')::bool or r->>'reason' <> 'bad_date' then raise exception 'A1 31/02 doveva essere bad_date: %', r; end if;
  if exists (select 1 from loyalty_profiles where shopify_customer_id = 'TEST_0141_X') then raise exception 'A1 una data rifiutata non deve creare la riga'; end if;
  r := loyalty_profile_save('TEST_0141_X', 1, 1, 'seta', true);
  if (r->>'ok')::bool or r->>'reason' <> 'bad_materiale' then raise exception 'A1 materiale fuori lista doveva essere bad_materiale: %', r; end if;
  if exists (select 1 from v_loyalty_ledger_drift where diff <> 0) then raise exception 'L drift dopo A1'; end if;

  -- A2: compleanno 29/02 salvato oggi; l''anno bisestile 2028 -> 29/02/2028; 2027 non bisestile -> 28/02/2027.
  --     Il profilo e'' stato salvato ora, quindi 2027 e'' ben oltre i 30 giorni di anticipo.
  r := loyalty_birthday_run('2027-02-28'::date);
  if not (r->>'ok')::bool or (r->>'credited')::int <> 1 then raise exception 'A2 primo giro: %', r; end if;
  r := loyalty_birthday_run('2027-02-28'::date);
  if not (r->>'ok')::bool or (r->>'credited')::int <> 0 then raise exception 'A2 secondo giro doveva accreditare 0: %', r; end if;
  r := loyalty_birthday_run('2027-03-02'::date);   -- finestra di recupero di 3 giorni: gia'' fatto, 0
  if (r->>'credited')::int <> 0 then raise exception 'A2 recupero doveva accreditare 0: %', r; end if;
  select count(*) into n from loyalty_events where shopify_customer_id = c and source = 'birthday';
  if n <> 1 then raise exception 'A2 eventi birthday = % (atteso 1)', n; end if;
  select points into p1 from loyalty_points where shopify_customer_id = c;
  if p1 <> p0 + 30 then raise exception 'A2 punti % (atteso %)', p1, p0 + 30; end if;
  select birthday into d from loyalty_birthday_awards where shopify_customer_id = c and year = 2027;
  if d <> '2027-02-28' then raise exception 'A2 29/02 in anno non bisestile doveva dare 28/02, ho %', d; end if;
  r := loyalty_birthday_run('2028-02-29'::date);
  if (r->>'credited')::int <> 1 then raise exception 'A2 2028 bisestile doveva accreditare 1: %', r; end if;
  -- anticipo di 30 giorni: un profilo salvato "oggi" con compleanno fra 10 giorni non incassa quest''anno
  d := (now() at time zone 'Europe/Rome')::date + 10; y := extract(year from d)::int;
  r := loyalty_profile_save('TEST_0141_Y', extract(day from d)::int, extract(month from d)::int, 'cotone', true);
  update app_flags set value = c || ',TEST_0141_Y' where key = 'loyalty_profile_enabled';
  r := loyalty_birthday_run(d);
  if (r->>'credited')::int <> 0 then raise exception 'A2 anticipo < 30 giorni doveva accreditare 0: %', r; end if;
  if (select loyalty_birthday_in_year(2, 29, 2027)) <> '2027-02-28' or (select loyalty_birthday_in_year(2, 29, 2028)) <> '2028-02-29' then raise exception 'A2 loyalty_birthday_in_year'; end if;
  if exists (select 1 from v_loyalty_ledger_drift where diff <> 0) then raise exception 'L drift dopo A2'; end if;

  -- A3: flag a lista: il cliente TEST_0141_Z ha compleanno oggi ma non e'' in lista -> niente
  r := loyalty_profile_save('TEST_0141_Z', extract(day from current_date)::int, extract(month from current_date)::int, 'cocco', true);
  update loyalty_profiles set birth_set_at = now() - interval '60 days' where shopify_customer_id = 'TEST_0141_Z';
  r := loyalty_birthday_run();
  if (r->>'credited')::int <> 0 then raise exception 'A3 cliente fuori lista accreditato: %', r; end if;
  update app_flags set value = 'true' where key = 'loyalty_profile_enabled';
  r := loyalty_birthday_run();
  if (r->>'credited')::int < 1 then raise exception 'A3 con flag true doveva accreditare almeno 1: %', r; end if;   -- >= 1: se un giorno esistono profili veri con compleanno oggi, contano anche loro (tutto viene annullato)
  update app_flags set value = c where key = 'loyalty_profile_enabled';

  -- C1: due accrediti finti per il cliente di test (ordini inesistenti in shopify_orders: la vista ripiega su created_at).
  --     Il cliente ha gia'' #1781 del 20-09-2026 (accreditato e stornato per intero): con O1 a -200 giorni e O2 a -100
  --     giorni l''ordine per data e'' O1, O2, #1781: primo = O1, secondo = O2, ma 100 giorni > 90 -> nessun bonus.
  select points into p0 from loyalty_points where shopify_customer_id = c;
  insert into loyalty_order_credits (shopify_order_id, shopify_customer_id, points, order_total, order_name, created_at)
    values ('TEST_0141_O1', c, 100, 100, '#TEST_0141_1', now() - interval '200 days'),
           ('TEST_0141_O2', c, 80, 80, '#TEST_0141_2', now() - interval '100 days');
  select n_ordini into n from v_loyalty_second_order where shopify_customer_id = c;
  if n <> 3 then raise exception 'C1 n_ordini = % (atteso 3: 2 finti + #1781)', n; end if;
  r := loyalty_bonus_second_run();
  if not (r->>'ok')::bool or (r->>'credited')::int <> 0 then raise exception 'C1 fuori dai 90 giorni doveva dare 0: %', r; end if;
  -- O1 a -40 e O2 a -5 giorni: 35 giorni, entro la finestra; ma con since nel futuro non e'' retroattivo -> 0
  update loyalty_order_credits set created_at = now() - interval '40 days' where shopify_order_id = 'TEST_0141_O1';
  update loyalty_order_credits set created_at = now() - interval '5 days' where shopify_order_id = 'TEST_0141_O2';
  update app_flags set value = '2099-01-01T00:00:00Z' where key = 'loyalty_bonus_second_since';
  r := loyalty_bonus_second_run();
  if (r->>'credited')::int <> 0 then raise exception 'C1 con since nel futuro doveva dare 0: %', r; end if;
  update app_flags set value = '2026-09-01T00:00:00Z' where key = 'loyalty_bonus_second_since';
  r := loyalty_bonus_second_run();
  if not (r->>'ok')::bool or (r->>'credited')::int <> 1 then raise exception 'C1 primo giro doveva accreditare 1: %', r; end if;
  r := loyalty_bonus_second_run();
  if (r->>'credited')::int <> 0 or (r->>'reversed')::int <> 0 then raise exception 'C1 secondo giro doveva fare 0: %', r; end if;
  select count(*) into n from loyalty_events where shopify_customer_id = c and source = 'bonus_second';
  if n <> 1 then raise exception 'C1 eventi bonus_second = % (atteso 1)', n; end if;
  select points into p1 from loyalty_points where shopify_customer_id = c;
  if p1 <> p0 + 50 then raise exception 'C1 punti % (atteso %)', p1, p0 + 50; end if;
  if exists (select 1 from v_loyalty_ledger_drift where diff <> 0) then raise exception 'L drift dopo C1'; end if;

  -- C2: il 2° ordine viene rimborsato per intero -> storno del bonus, una volta sola
  insert into loyalty_order_reversals (shopify_order_id, points_reversed, refunded_amount)
    select second_order_id, second_points, 80 from v_loyalty_second_order where shopify_customer_id = c;
  r := loyalty_bonus_second_run();
  if (r->>'reversed')::int <> 1 or (r->>'reversed_points')::int <> 50 then raise exception 'C2 storno: %', r; end if;
  r := loyalty_bonus_second_run();
  if (r->>'reversed')::int <> 0 or (r->>'credited')::int <> 0 then raise exception 'C2 secondo giro doveva fare 0: %', r; end if;
  select points into p1 from loyalty_points where shopify_customer_id = c;
  if p1 <> p0 then raise exception 'C2 punti % (atteso %)', p1, p0; end if;
  if (select points_reversed from loyalty_bonus_second where shopify_customer_id = c) <> 50 then raise exception 'C2 points_reversed'; end if;
  if exists (select 1 from v_loyalty_ledger_drift where diff <> 0) then raise exception 'L drift dopo C2'; end if;

  -- B: cumulato = tutto tranne i riscatti
  if (select punti_cumulati from v_loyalty_members where shopify_customer_id = c)
     <> (select coalesce(sum(delta),0) from loyalty_events where shopify_customer_id = c and source <> 'redeem') then raise exception 'B punti_cumulati'; end if;
  if (select tier_cumulato from v_loyalty_members where shopify_customer_id = c) <> loyalty_tier_of(loyalty_points_cumulati(c)) then raise exception 'B tier_cumulato'; end if;

  -- flag OFF = NO-OP con health_log ok
  update app_flags set value = 'false' where key in ('loyalty_profile_enabled', 'loyalty_bonus_second_enabled');
  r := loyalty_birthday_run(); if r->>'state' <> 'off' then raise exception 'flag OFF compleanni: %', r; end if;
  r := loyalty_bonus_second_run(); if r->>'state' <> 'off' then raise exception 'flag OFF bonus: %', r; end if;
  if (select severity from health_log where day = current_date and k = 'loyalty_birthday') <> 'ok' then raise exception 'health_log loyalty_birthday'; end if;

  -- A1 (Gate 2, migr 0142): l''evento birthday non porta la data, solo l''anno
  if exists (select 1 from loyalty_events where source = 'birthday' and meta ? 'birthday') then raise exception 'A1 meta birthday contiene la data'; end if;

  -- D (migr 0142): premio unico 100 punti = 12%. Attivo SOLO dentro questa transazione (poi tutto si annulla).
  --   Criterio del brief: membro con 108 punti riscatta, riceve un codice 12% e resta con 8; stessa chiamata = stesso codice; 99 punti = rifiuto.
  update loyalty_rewards set active = (key = 'amica12') where key in ('tessera', 'amica12');
  if (select count(*) from loyalty_rewards where active) <> 1 then raise exception 'D un solo premio attivo atteso'; end if;
  insert into loyalty_reward_codes (code, reward_key) values ('AMICA12-TEST01', 'amica12');
  insert into loyalty_points (shopify_customer_id, points) values ('TEST_0141_D108', 108), ('TEST_0141_D99', 99);
  insert into loyalty_events (shopify_customer_id, delta, source, meta) values ('TEST_0141_D108', 108, 'manual_adjust', '{"test":true}'), ('TEST_0141_D99', 99, 'manual_adjust', '{"test":true}');
  r := loyalty_redeem('TEST_0141_D108', 'amica12', 'idemp-test-0142-108');
  if not (r->>'ok')::bool or (r->>'new_balance')::int <> 8 or (r->>'cost')::int <> 100 or (r->>'value')::numeric <> 12 then raise exception 'D riscatto 108: %', r; end if;
  if loyalty_claim_code('amica12', 'TEST_0141_D108', (r->>'redemption_id')::bigint) <> 'AMICA12-TEST01' then raise exception 'D codice non consegnato'; end if;
  if loyalty_claim_code('amica12', 'TEST_0141_D108', (r->>'redemption_id')::bigint) <> 'AMICA12-TEST01' then raise exception 'D seconda claim deve dare lo stesso codice'; end if;
  r := loyalty_redeem('TEST_0141_D108', 'amica12', 'idemp-test-0142-108');
  if r->>'reason' <> 'already' or r->>'code' <> 'AMICA12-TEST01' then raise exception 'D stesso idemp doveva dare already con lo stesso codice: %', r; end if;
  if (select points from loyalty_points where shopify_customer_id = 'TEST_0141_D108') <> 8 then raise exception 'D saldo dopo il doppio invio'; end if;
  r := loyalty_redeem('TEST_0141_D99', 'amica12', 'idemp-test-0142-099');
  if (r->>'ok')::bool or r->>'reason' <> 'insufficient' then raise exception 'D 99 punti doveva essere insufficient: %', r; end if;
  r := loyalty_redeem('TEST_0141_D99', 'tessera', 'idemp-test-0142-old');
  if (r->>'ok')::bool or r->>'reason' <> 'reward_unknown' then raise exception 'D il vecchio premio spento non deve essere riscattabile: %', r; end if;
  if (select membri_con_tessera_piena from v_loyalty_redeem_rate) <> (select count(*) from loyalty_points where points >= 100) then raise exception 'D KPI tessera piena sul premio attivo'; end if;
  if exists (select 1 from v_loyalty_ledger_drift where diff <> 0) then raise exception 'L drift dopo D'; end if;

  raise exception 'TEST_OK: profilo, compleanno, bonus seconda borsa, premio 12%%, ledger in quadra (rollback voluto)';
end $$;
