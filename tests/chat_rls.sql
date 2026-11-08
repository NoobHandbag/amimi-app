-- tests/chat_rls.sql: prova VIVA della migr 0186 (chat del sito, modulo chat_*), da lanciare DOPO l'apply, prima nello
-- stack locale e poi in produzione (test 17 di PROPOSTA_chat_sito.md 13.4; 5.9 punto 7). Test negativo obbligatorio della
-- Regola Ferrea 19, sul modello di tests/push_eventi_rls.sql. Si incolla in UNA chiamata execute_sql (o psql): e' un
-- unico blocco DO che alla fine alza SEMPRE un'eccezione, quindi le righe di prova e i cambi di ruolo tornano indietro.
--   esito buono: ERROR P0001 'TEST_OK: ... (rollback voluto)'; qualunque altro errore = KO, col motivo.
-- Cosa prova:
--   V  vincoli, da proprietario: stati, preso_da, email (a capo con Bcc, due indirizzi, senza dominio), nome lungo o con
--      caratteri di controllo, lingua, id Shopify; messaggi (autore, staff_nome, client_msg_id e send_key obbligatori e
--      UNIQUE con 23505 e on conflict = zero righe, testo vuoto o oltre 4.000, stati email e loro campi, prenotazione
--      condizionata che passa una volta sola); token (hash, tipo, doppione, scadenza); eventi (chiave UNIQUE e
--      prenotazione, dettaglio non oggetto, tipo maiuscolo); cascata: cancellare una sessione toglie messaggi e token,
--      lascia gli eventi con sessione nulla; la riga cs_ collegata cancellata lascia la sessione con cs_conversation_id nullo
--   C  chat_contatore_incrementa, da proprietario: 1, 2, poi null al tetto 2 (e n resta 2); chiave diversa indipendente;
--      finestra di un giorno allineata al giorno UTC; input fuori dai limiti = 22023
--   F  le 11 chiavi chat_* di app_flags ci sono; quelle JSON si leggono
--   K  catalogo: RLS accesa sulle cinque tabelle, RPC invoker e non eseguibile da anon e authenticated
--   K2 catalogo sulla chiusura delle dipendenze di cs_ e chat_: nessuna vista leggibile da anon, quelle del team solo con
--      security_invoker, nessuna vista materializzata al team, nessuna funzione security definer eseguibile dal sito che legga
--      queste tabelle (Gate 2 dell'8-11, B1)
--   S  il service_role (le edge della chat) legge e scrive le cinque tabelle, usa le sequenze, esegue la RPC
--   T  authenticated del team: legge le righe di chat_sessioni e chat_messaggi; insert, update e delete su tutte e cinque,
--      select su chat_token, chat_eventi e chat_contatori, nextval delle sequenze e la RPC = 42501
--   U  authenticated fuori dal team: 0 righe da chat_sessioni e chat_messaggi; il resto come T
--   N  anon: tutto 42501, anche la lettura di chat_sessioni e chat_messaggi
--   P  proiezione (5.9 punto 7): con una riga chat_sito di prova in cs_conversations e cs_messages, anon e authenticated
--      fuori dal team vedono le stesse righe di prima (o lo stesso errore) da cs_conversations, cs_messages e da ogni vista
--      che ne dipende, con l'elenco preso da pg_depend adesso; il team vede la riga di prova cercandola per id
do $t$
declare
  v_owner name := current_user;
  r text;
  q text;
  st text;
  cn text;
  n int;
  n2 int;
  v_s1 uuid;
  v_s2 uuid;
  v_cs uuid;
  v_m uuid;
  v_ev bigint;
  v_rel text;
  v_rels text[];
  v_prima jsonb := '{}'::jsonb;
  v_dopo jsonb := '{}'::jsonb;
  v_val text;
  v_seq_m text := case when to_regclass('public.chat_messaggi_seq_sq') is not null then 'public.chat_messaggi_seq_sq' end;
  v_seq_e text := pg_get_serial_sequence('public.chat_eventi', 'id');
  vietate_tutti text[];
  vietate_lette text[];
  c_ruoli constant text[] := array['anon', 'esterno', 'team'];
begin
  if to_regclass('public.chat_sessioni') is null or to_regclass('public.chat_messaggi') is null or to_regclass('public.chat_token') is null
     or to_regclass('public.chat_eventi') is null or to_regclass('public.chat_contatori') is null or v_seq_m is null or v_seq_e is null
     or to_regprocedure('public.chat_contatore_incrementa(text, integer, integer)') is null then
    raise exception 'KO: migr 0186 non applicata';
  end if;

  -- comandi vietati a tutti i ruoli del sito (anon, team, fuori dal team): mai scrivere, mai leggere i tre registri interni
  vietate_tutti := array[
    'insert into public.chat_sessioni (customer_email, informativa_versione) values (''x@prova.invalid'', ''v'')',
    'update public.chat_sessioni set stato = ''chiusa''',
    'delete from public.chat_sessioni',
    'insert into public.chat_messaggi (sessione_id, autore, testo, client_msg_id) values (gen_random_uuid(), ''cliente'', ''x'', gen_random_uuid())',
    'update public.chat_messaggi set testo = ''x''',
    'delete from public.chat_messaggi',
    'select count(*) from public.chat_token',
    'insert into public.chat_token (sessione_id, tipo, hash, scade_at) values (gen_random_uuid(), ''chat'', repeat(''a'', 64), now() + interval ''1 hour'')',
    'update public.chat_token set revocato_at = now()',
    'delete from public.chat_token',
    'select count(*) from public.chat_eventi',
    'insert into public.chat_eventi (tipo) values (''prova'')',
    'update public.chat_eventi set esito = ''x''',
    'delete from public.chat_eventi',
    'select count(*) from public.chat_contatori',
    'insert into public.chat_contatori (chiave, finestra) values (''prova'', now())',
    'update public.chat_contatori set n = 0',
    'delete from public.chat_contatori',
    format('select nextval(%L)', v_seq_m),
    format('select nextval(%L)', v_seq_e),
    'select public.chat_contatore_incrementa(''prova:rls'', 0, 5)'
  ];
  -- in piu', ad anon: neanche la lettura delle due tabelle del team
  vietate_lette := array['select count(*) from public.chat_sessioni', 'select count(*) from public.chat_messaggi'];

  -- V: sessioni
  insert into chat_sessioni (customer_email, customer_name, informativa_versione, prova)
    values ('prova.0186@example.com', 'Prova RLS', 'v-prova', true) returning id into v_s1;
  select count(*) into n from chat_sessioni where id = v_s1 and stato = 'bot' and lingua = 'it' and passaggi = 0 and proiettato_seq = 0
    and ultima_attivita_at is not null and informativa_at is not null and chiusa_at is null;
  if n <> 1 then raise exception 'KO V: una sessione nuova non nasce bot, it, a zero e aperta'; end if;

  for q, cn in
    select * from (values
      ('insert into chat_sessioni (customer_email, informativa_versione, stato) values (''a@b.it'', ''v'', ''nuova'')', 'chat_sessioni_stato_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione, preso_da) values (''a@b.it'', ''v'', ''Benny'')', 'chat_sessioni_preso_da_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione, stato) values (''a@b.it'', ''v'', ''aperta'')', 'chat_sessioni_aperta_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione, stato) values (''a@b.it'', ''v'', ''attesa_persona'')', 'chat_sessioni_passaggio_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione, stato, passaggi) values (''a@b.it'', ''v'', ''attesa_persona'', 1)', 'chat_sessioni_passaggio_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione, stato) values (''a@b.it'', ''v'', ''chiusa'')', 'chat_sessioni_chiusa_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione, chiusa_at) values (''a@b.it'', ''v'', now())', 'chat_sessioni_chiusa_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione) values (E''a@b.it\nBcc: c@d.it'', ''v'')', 'chat_sessioni_email_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione) values (''a@b.it,c@d.it'', ''v'')', 'chat_sessioni_email_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione) values (''a@b'', ''v'')', 'chat_sessioni_email_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione) values (''<a@b.it>'', ''v'')', 'chat_sessioni_email_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione) values (''a b@c.it'', ''v'')', 'chat_sessioni_email_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione) values (repeat(''a'', 250) || ''@b.it'', ''v'')', 'chat_sessioni_email_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione, customer_name) values (''a@b.it'', ''v'', repeat(''n'', 81))', 'chat_sessioni_nome_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione, customer_name) values (''a@b.it'', ''v'', E''Ada\rBcc'')', 'chat_sessioni_nome_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione, customer_name) values (''a@b.it'', ''v'', '''')', 'chat_sessioni_nome_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione, lingua) values (''a@b.it'', ''v'', ''fr'')', 'chat_sessioni_lingua_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione, shopify_customer_id) values (''a@b.it'', ''v'', ''12a'')', 'chat_sessioni_shopify_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione) values (''a@b.it'', '''')', 'chat_sessioni_informativa_ck'),
      ('insert into chat_sessioni (customer_email, informativa_versione, passaggi) values (''a@b.it'', ''v'', -1)', 'chat_sessioni_passaggi_ck')
    ) x(a, b)
  loop
    st := 'ok'; v_val := null;
    begin execute q; exception when others then get stacked diagnostics st = returned_sqlstate, v_val = constraint_name; end;
    if st <> '23514' or v_val is distinct from cn then raise exception 'KO V: "%" = % % (atteso 23514 %)', q, st, v_val, cn; end if;
  end loop;
  st := 'ok';
  begin insert into chat_sessioni (informativa_versione) values ('v'); exception when others then st := sqlstate; end;
  if st <> '23502' then raise exception 'KO V: sessione senza email = % (atteso 23502)', st; end if;

  -- V: messaggi
  v_m := gen_random_uuid();
  insert into chat_messaggi (sessione_id, autore, testo, client_msg_id) values (v_s1, 'cliente', 'prova', v_m);
  st := 'ok'; cn := null;
  begin
    insert into chat_messaggi (sessione_id, autore, testo, client_msg_id) values (v_s1, 'cliente', 'prova di nuovo', v_m);
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23505' or cn is distinct from 'chat_messaggi_client_uk' then raise exception 'KO V: client_msg_id doppio = % %', st, cn; end if;
  insert into chat_messaggi (sessione_id, autore, testo, client_msg_id) values (v_s1, 'cliente', 'prova di nuovo', v_m)
    on conflict (sessione_id, client_msg_id) do nothing;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'KO V: il POST ripetuto con lo stesso client_msg_id e'' entrato (% righe)', n; end if;
  -- B3 (Gate 2 dell'8-11): il numero lo assegna il trigger dopo il lock della sessione, anche se il chiamante ne passa uno
  insert into chat_messaggi (sessione_id, autore, testo, seq) values (v_s1, 'automatica', 'risposta fissa', -5);
  if exists (select 1 from chat_messaggi where sessione_id = v_s1 and seq <= 0) then
    raise exception 'KO V: il seq passato dal chiamante non e'' stato sovrascritto dal trigger';
  end if;
  insert into chat_messaggi (sessione_id, autore, staff_nome, testo, send_key) values (v_s1, 'staff', 'Ginevra', 'risposta del team', v_m)
    returning id into v_m;
  select count(*), count(distinct seq), max(seq) - min(seq) into n, n2, v_ev from chat_messaggi where sessione_id = v_s1;
  if n <> 3 or n2 <> 3 or v_ev < 2 then raise exception 'KO V: seq non cresce coi messaggi (% righe, % seq distinti)', n, n2; end if;

  for q, cn, st in
    select * from (values
      ('insert into chat_messaggi (sessione_id, autore, testo) values (%L, ''bot'', ''x'')', 'chat_messaggi_autore_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, testo, send_key) values (%L, ''staff'', ''x'', gen_random_uuid())', 'chat_messaggi_staff_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, staff_nome, testo, client_msg_id) values (%L, ''cliente'', ''Ale'', ''x'', gen_random_uuid())', 'chat_messaggi_staff_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, staff_nome, testo, send_key) values (%L, ''staff'', ''Benny'', ''x'', gen_random_uuid())', 'chat_messaggi_staff_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, staff_nome, testo) values (%L, ''staff'', ''Ale'', ''x'')', 'chat_messaggi_send_key_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, testo) values (%L, ''cliente'', ''x'')', 'chat_messaggi_client_msg_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, testo) values (%L, ''automatica'', '''')', 'chat_messaggi_testo_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, testo) values (%L, ''automatica'', repeat(''x'', 4001))', 'chat_messaggi_testo_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, testo, fonte) values (%L, ''automatica'', ''x'', '''')', 'chat_messaggi_fonte_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, testo, client_msg_id, email_stato, email_at) values (%L, ''cliente'', ''x'', gen_random_uuid(), ''prenotata'', now())', 'chat_messaggi_email_stato_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, staff_nome, testo, send_key, email_stato) values (%L, ''staff'', ''Ale'', ''x'', gen_random_uuid(), ''prenotata'')', 'chat_messaggi_email_stato_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, staff_nome, testo, send_key, email_stato, email_at) values (%L, ''staff'', ''Ale'', ''x'', gen_random_uuid(), ''spedita'', now())', 'chat_messaggi_email_stato_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, staff_nome, testo, send_key, email_stato, email_at) values (%L, ''staff'', ''Ale'', ''x'', gen_random_uuid(), ''inviata'', now())', 'chat_messaggi_email_inviata_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, staff_nome, testo, send_key, email_stato, email_at) values (%L, ''staff'', ''Ale'', ''x'', gen_random_uuid(), ''errore'', now())', 'chat_messaggi_email_errore_ck', '23514'),
      ('insert into chat_messaggi (sessione_id, autore, testo) values (gen_random_uuid(), ''automatica'', ''x'')', 'chat_messaggi_sessione_fk', '23503')
    ) x(a, b, c)
  loop
    q := format(q, v_s1);
    r := 'ok'; v_val := null;
    begin execute q; exception when others then get stacked diagnostics r = returned_sqlstate, v_val = constraint_name; end;
    if r <> st or v_val is distinct from cn then raise exception 'KO V: "%" = % % (atteso % %)', q, r, v_val, st, cn; end if;
  end loop;
  st := 'ok'; cn := null;
  begin
    insert into chat_messaggi (sessione_id, autore, staff_nome, testo, send_key)
      select v_s1, 'staff', 'Ale', 'doppio', m.send_key from chat_messaggi m where m.id = v_m;
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23505' or cn is distinct from 'chat_messaggi_send_key_uk' then raise exception 'KO V: send_key doppio = % %', st, cn; end if;

  -- la prenotazione dell'email (7.9): un solo update condizionato passa, il secondo trova zero righe
  update chat_messaggi set email_stato = 'prenotata', email_at = now() where id = v_m and email_stato is null;
  get diagnostics n = row_count;
  update chat_messaggi set email_stato = 'prenotata', email_at = now() where id = v_m and email_stato is null;
  get diagnostics n2 = row_count;
  if n <> 1 or n2 <> 0 then raise exception 'KO V: prenotazione dell''email = % poi % (attese 1 e 0)', n, n2; end if;
  update chat_messaggi set email_stato = 'inviata', email_at = now(), email_gmail_id = '18c0prova' where id = v_m and email_stato = 'prenotata';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'KO V: prenotata -> inviata non passa'; end if;

  -- V: token
  insert into chat_token (sessione_id, tipo, hash, scade_at) values (v_s1, 'chat', repeat('a', 64), now() + interval '4 hours');
  insert into chat_token (sessione_id, tipo, hash, scade_at) values (v_s1, 'ripresa', repeat('b', 64), now() + interval '30 days');
  for q, cn, st in
    select * from (values
      ('insert into chat_token (sessione_id, tipo, hash, scade_at) values (%L, ''chat'', repeat(''a'', 64), now() + interval ''1 hour'')', 'chat_token_hash_uk', '23505'),
      ('insert into chat_token (sessione_id, tipo, hash, scade_at) values (%L, ''chat'', repeat(''A'', 64), now() + interval ''1 hour'')', 'chat_token_hash_ck', '23514'),
      ('insert into chat_token (sessione_id, tipo, hash, scade_at) values (%L, ''chat'', repeat(''c'', 63), now() + interval ''1 hour'')', 'chat_token_hash_ck', '23514'),
      ('insert into chat_token (sessione_id, tipo, hash, scade_at) values (%L, ''email'', repeat(''c'', 64), now() + interval ''1 hour'')', 'chat_token_tipo_ck', '23514'),
      ('insert into chat_token (sessione_id, tipo, hash, scade_at) values (%L, ''chat'', repeat(''c'', 64), now())', 'chat_token_scadenza_ck', '23514')
    ) x(a, b, c)
  loop
    q := format(q, v_s1);
    r := 'ok'; v_val := null;
    begin execute q; exception when others then get stacked diagnostics r = returned_sqlstate, v_val = constraint_name; end;
    if r <> st or v_val is distinct from cn then raise exception 'KO V: "%" = % % (atteso % %)', q, r, v_val, st, cn; end if;
  end loop;

  -- V: eventi e prenotazione della push di passaggio (8.4)
  insert into chat_eventi (sessione_id, tipo, chiave, chi, esito) values (v_s1, 'passaggio', v_s1 || ':passaggio:1', 'chat-api', 'prenotato')
    returning id into v_ev;
  insert into chat_eventi (sessione_id, tipo, chiave) values (v_s1, 'passaggio', v_s1 || ':passaggio:1') on conflict (chiave) do nothing;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'KO V: la seconda prenotazione della stessa chiave e'' passata'; end if;
  insert into chat_eventi (sessione_id, tipo) values (v_s1, 'stato');
  insert into chat_eventi (sessione_id, tipo) values (v_s1, 'stato');
  for q, cn, st in
    select * from (values
      ('insert into chat_eventi (tipo, chiave) values (''passaggio'', %L)', 'chat_eventi_chiave_uk', '23505'),
      ('insert into chat_eventi (tipo) values (''Passaggio'')', 'chat_eventi_tipo_ck', '23514'),
      ('insert into chat_eventi (tipo, dettaglio) values (''prova'', ''[]'')', 'chat_eventi_dettaglio_ck', '23514'),
      ('insert into chat_eventi (tipo, dettaglio) values (''prova'', jsonb_build_object(''x'', repeat(''y'', 4001)))', 'chat_eventi_dettaglio_ck', '23514'),
      ('insert into chat_eventi (tipo, chiave) values (''prova'', '''')', 'chat_eventi_chiave_ck', '23514'),
      ('insert into chat_eventi (tipo, chiave) values (''prova'', ''x@y.it:passaggio:1'')', 'chat_eventi_chiave_ck', '23514'),
      ('insert into chat_eventi (tipo, chiave) values (''prova'', ''Passaggio:1'')', 'chat_eventi_chiave_ck', '23514'),
      ('insert into chat_eventi (tipo, chi) values (''prova'', ''x@y.it'')', 'chat_eventi_chi_ck', '23514'),
      ('insert into chat_eventi (tipo, esito) values (''prova'', ''errore x@y.it'')', 'chat_eventi_esito_ck', '23514'),
      ('insert into chat_eventi (tipo, dettaglio) values (''prova'', jsonb_build_object(''a'', ''x@y.it''))', 'chat_eventi_dettaglio_ck', '23514')
    ) x(a, b, c)
  loop
    q := format(q, v_s1 || ':passaggio:1');
    r := 'ok'; v_val := null;
    begin execute q; exception when others then get stacked diagnostics r = returned_sqlstate, v_val = constraint_name; end;
    if r <> st or v_val is distinct from cn then raise exception 'KO V: "%" = % % (atteso % %)', q, r, v_val, st, cn; end if;
  end loop;

  -- V: chiusura coerente e cascata (11.6)
  update chat_sessioni set stato = 'aperta', preso_da = 'Ginevra' where id = v_s1;
  update chat_sessioni set stato = 'chiusa', chiusa_at = now() where id = v_s1;
  delete from chat_sessioni where id = v_s1;
  if exists (select 1 from chat_messaggi where sessione_id = v_s1) or exists (select 1 from chat_token where sessione_id = v_s1) then
    raise exception 'KO V: cancellata la sessione restano messaggi o token';
  end if;
  select count(*) into n from chat_eventi where id >= v_ev and sessione_id is null and chiave = v_s1 || ':passaggio:1';
  if n <> 1 or exists (select 1 from chat_eventi where sessione_id = v_s1) then
    raise exception 'KO V: gli eventi della sessione cancellata non restano con sessione nulla';
  end if;

  insert into cs_conversations (gmail_thread_id, canale, customer_email, stato, flags)
    values ('chat:' || gen_random_uuid(), 'chat_sito', 'prova.0186@example.com', 'fatto', '["prova"]') returning id into v_cs;
  insert into chat_sessioni (customer_email, informativa_versione, prova, cs_conversation_id)
    values ('prova.0186@example.com', 'v-prova', true, v_cs) returning id into v_s2;
  st := 'ok'; cn := null;
  begin
    insert into chat_sessioni (customer_email, informativa_versione, prova, cs_conversation_id) values ('prova.0186@example.com', 'v', true, v_cs);
  exception when others then get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
  end;
  if st <> '23505' or cn is distinct from 'chat_sessioni_cs_uk' then raise exception 'KO V: due sessioni sulla stessa riga cs_ = % %', st, cn; end if;
  delete from cs_conversations where id = v_cs;
  if (select cs_conversation_id from chat_sessioni where id = v_s2) is not null then
    raise exception 'KO V: cancellata la riga cs_, la sessione la punta ancora';
  end if;
  insert into chat_messaggi (sessione_id, autore, testo, client_msg_id) values (v_s2, 'cliente', 'prova', gen_random_uuid());

  -- C: contatori. Una chiamata per istruzione: in un'espressione con OR Postgres non garantisce l'ordine di valutazione
  --    (la prima stesura metteva tre chiamate e un exists nello stesso IF, e l'exists girava prima delle chiamate).
  n := public.chat_contatore_incrementa('prova:rls:a', 0, 2);
  n2 := public.chat_contatore_incrementa('prova:rls:a', 0, 2);
  v_val := public.chat_contatore_incrementa('prova:rls:a', 0, 2)::text;
  if n is distinct from 1 or n2 is distinct from 2 or v_val is not null then
    raise exception 'KO C: tetto 2 senza finestra da'' %, %, % invece di 1, 2, null', n, n2, v_val;
  end if;
  -- C6 (Gate 2 dell'8-11): al tetto la riga resta a tetto + 1 e si aggiorna lo stesso, cosi' la pulizia dei 7 giorni non
  -- azzera una chiave ancora usata; altre chiamate al tetto non la fanno crescere oltre
  update chat_contatori set aggiornato_at = now() - interval '8 days' where chiave = 'prova:rls:a' and finestra = 'epoch'::timestamptz;
  v_val := public.chat_contatore_incrementa('prova:rls:a', 0, 2)::text;
  if v_val is not null or (select k.n from chat_contatori k where k.chiave = 'prova:rls:a' and k.finestra = 'epoch'::timestamptz) is distinct from 3
     or (select k.aggiornato_at from chat_contatori k where k.chiave = 'prova:rls:a' and k.finestra = 'epoch'::timestamptz) < now() - interval '1 minute' then
    raise exception 'KO C: al tetto il contatore non resta a tetto + 1 o non si aggiorna (%)', v_val;
  end if;
  -- un tetto abbassato dopo: rifiuta subito
  if public.chat_contatore_incrementa('prova:rls:a', 0, 1) is not null then
    raise exception 'KO C: un tetto abbassato sotto il conteggio lascia passare';
  end if;
  if public.chat_contatore_incrementa('prova:rls:b', 0, 2) is distinct from 1 then
    raise exception 'KO C: una chiave diversa non parte da 1';
  end if;
  n := public.chat_contatore_incrementa('prova:rls:c', 86400, 1);
  n2 := public.chat_contatore_incrementa('prova:rls:c', 86400, 1);
  if n is distinct from 1 or n2 is not null
     or not exists (select 1 from chat_contatori k where k.chiave = 'prova:rls:c' and k.finestra = date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') then
    raise exception 'KO C: la finestra di un giorno da'' % poi % o non e'' il giorno UTC', n, n2;
  end if;
  foreach q in array array['select public.chat_contatore_incrementa(''Prova'', 0, 5)', 'select public.chat_contatore_incrementa(''1x'', 0, 5)',
                           'select public.chat_contatore_incrementa(null, 0, 5)', 'select public.chat_contatore_incrementa(''prova'', 0, 0)',
                           'select public.chat_contatore_incrementa(''prova'', -1, 5)', 'select public.chat_contatore_incrementa(''prova'', 604801, 5)',
                           'select public.chat_contatore_incrementa(''prova'', null, 5)', 'select public.chat_contatore_incrementa(''prova'', 0, 1000001)'] loop
    st := 'ok';
    begin execute q; exception when others then st := sqlstate; end;
    if st <> '22023' then raise exception 'KO C: "%" = % (atteso 22023)', q, st; end if;
  end loop;

  -- F: flag
  foreach v_val in array array['chat_sito_enabled', 'chat_sollecito_ore', 'chat_limite_chat_giorno', 'chat_conservazione_mesi', 'chat_orari',
                               'chat_testo_saluto', 'chat_testo_orari', 'chat_testo_attesa', 'chat_testo_fuori_orario',
                               'chat_testo_informativa', 'chat_bottoni'] loop
    if not exists (select 1 from app_flags where key = v_val) then raise exception 'KO F: manca app_flags.%', v_val; end if;
  end loop;
  foreach v_val in array array['chat_orari', 'chat_testo_saluto', 'chat_testo_orari', 'chat_testo_attesa', 'chat_testo_fuori_orario',
                               'chat_testo_informativa', 'chat_bottoni'] loop
    st := 'ok';
    begin perform (select value::jsonb from app_flags where key = v_val); exception when others then st := sqlstate; end;
    if st <> 'ok' then raise exception 'KO F: app_flags.% non e'' un JSON leggibile (%)', v_val, st; end if;
  end loop;

  -- K (catalogo): RLS accesa sulle cinque tabelle e RPC non eseguibile da anon e authenticated. Senza questo blocco
  --   due derive passavano verdi (provato in locale l'8-11): RLS spenta su chat_token e EXECUTE della RPC ad
  --   authenticated, che oggi non aprono niente solo perche' mancano i grant di tabella e la RPC e' invoker.
  if exists (select 1 from pg_class cl where cl.oid in ('public.chat_sessioni'::regclass, 'public.chat_messaggi'::regclass, 'public.chat_token'::regclass,
                                                       'public.chat_eventi'::regclass, 'public.chat_contatori'::regclass) and not cl.relrowsecurity) then
    raise exception 'KO K: RLS spenta su una tabella chat_';
  end if;
  if has_function_privilege('anon', 'public.chat_contatore_incrementa(text, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.chat_contatore_incrementa(text, integer, integer)', 'execute')
     or (select p.prosecdef from pg_proc p where p.oid = 'public.chat_contatore_incrementa(text, integer, integer)'::regprocedure) then
    raise exception 'KO K: chat_contatore_incrementa eseguibile da anon o authenticated, o diventata security definer';
  end if;
  if has_sequence_privilege('anon', v_seq_m, 'usage, select, update') or has_sequence_privilege('authenticated', v_seq_m, 'usage, select, update')
     or has_sequence_privilege('anon', v_seq_e, 'usage, select, update') or has_sequence_privilege('authenticated', v_seq_e, 'usage, select, update')
     or not exists (select 1 from pg_trigger tg where tg.tgrelid = 'public.chat_messaggi'::regclass and tg.tgname = 'chat_messaggi_ordina' and tg.tgenabled = 'O') then
    raise exception 'KO K: una sequenza della chat e'' leggibile dal sito, o manca il trigger chat_messaggi_ordina';
  end if;
  -- K2 (Gate 2 dell'8-11, B1): il conteggio prima/dopo di P vede solo le viste che selezionano la riga di prova. Qui il
  --   catalogo, su tutta la chiusura delle dipendenze di cs_conversations, cs_messages e delle cinque tabelle chat_: nessuna
  --   vista o vista materializzata leggibile da anon; una vista leggibile da authenticated solo con security_invoker (i
  --   permessi e la RLS di chi legge); nessuna vista materializzata leggibile da authenticated (non ha RLS); nessuna
  --   funzione security definer eseguibile da anon o authenticated che nomini queste tabelle (pg_depend non le vede).
  with recursive dip(oid) as (
    select v.oid from pg_depend d join pg_rewrite rw on rw.oid = d.objid join pg_class v on v.oid = rw.ev_class
     where d.classid = 'pg_rewrite'::regclass and v.oid <> d.refobjid
       and d.refobjid in ('public.cs_conversations'::regclass, 'public.cs_messages'::regclass, 'public.chat_sessioni'::regclass,
                          'public.chat_messaggi'::regclass, 'public.chat_token'::regclass, 'public.chat_eventi'::regclass, 'public.chat_contatori'::regclass)
    union
    select v.oid from dip join pg_depend d on d.refobjid = dip.oid join pg_rewrite rw on rw.oid = d.objid join pg_class v on v.oid = rw.ev_class
     where d.classid = 'pg_rewrite'::regclass and v.oid <> dip.oid)
  select string_agg(format('%s (%s)', c.oid::regclass, case
           when has_table_privilege('anon', c.oid, 'select') then 'anon legge'
           when c.relkind = 'm' then 'vista materializzata leggibile dal team'
           else 'vista leggibile dal team senza security_invoker' end), ', ')
    into v_val
    from dip join pg_class c on c.oid = dip.oid
   where has_table_privilege('anon', c.oid, 'select')
      or (has_table_privilege('authenticated', c.oid, 'select')
          and (c.relkind = 'm' or not coalesce((select lower(o.option_value) in ('on', 'true', '1', 'yes')
                                                  from pg_options_to_table(c.reloptions) o where o.option_name = 'security_invoker'), false)));
  if v_val is not null then raise exception 'KO K2: viste che espongono la chat: %', v_val; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_val
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef and p.prosrc ~ '\m(cs_conversations|cs_messages|chat_sessioni|chat_messaggi|chat_token|chat_eventi|chat_contatori)\M'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_val is not null then raise exception 'KO K2: funzioni security definer eseguibili dal sito che leggono la chat: %', v_val; end if;

  -- S
  if not (has_table_privilege('service_role', 'public.chat_sessioni', 'select, insert, update, delete')
          and has_table_privilege('service_role', 'public.chat_messaggi', 'select, insert, update, delete')
          and has_table_privilege('service_role', 'public.chat_token', 'select, insert, update, delete')
          and has_table_privilege('service_role', 'public.chat_eventi', 'select, insert, update, delete')
          and has_table_privilege('service_role', 'public.chat_contatori', 'select, insert, update, delete')
          and has_sequence_privilege('service_role', v_seq_m, 'usage') and has_sequence_privilege('service_role', v_seq_e, 'usage')
          and has_function_privilege('service_role', 'public.chat_contatore_incrementa(text, integer, integer)', 'execute')
          and has_table_privilege('service_role', 'public.app_flags', 'select')) then
    raise exception 'KO S: il service_role non legge o non scrive le tabelle della chat';
  end if;

  -- P (prima parte): una riga chat_sito di prova in cs_, e le viste che dipendono da cs_ lette adesso da pg_depend
  with recursive dip(oid) as (
    select v.oid from pg_depend d join pg_rewrite rw on rw.oid = d.objid join pg_class v on v.oid = rw.ev_class
     where d.classid = 'pg_rewrite'::regclass and d.refobjid in ('public.cs_conversations'::regclass, 'public.cs_messages'::regclass)
       and v.oid <> d.refobjid
    union
    select v.oid from dip join pg_depend d on d.refobjid = dip.oid join pg_rewrite rw on rw.oid = d.objid join pg_class v on v.oid = rw.ev_class
     where d.classid = 'pg_rewrite'::regclass and v.oid <> dip.oid)
  select array['public.cs_conversations', 'public.cs_messages'] || coalesce(array_agg(dip.oid::regclass::text order by dip.oid::regclass::text), '{}')
    into v_rels from dip;

  foreach r in array c_ruoli loop
    perform set_config('role', case when r = 'anon' then 'anon' else 'authenticated' end, true);
    perform set_config('request.jwt.claims', case r when 'anon' then json_build_object('role', 'anon')
      when 'esterno' then json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0186@gmail.com')
      else json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0186@amimi.it') end::text, true);
    foreach v_rel in array v_rels loop
      begin execute format('select count(*) from %s', v_rel) into n; v_val := n::text;
      exception when others then v_val := 'err:' || sqlstate; end;
      v_prima := v_prima || jsonb_build_object(r || '|' || v_rel, v_val);
    end loop;
  end loop;
  perform set_config('role', v_owner, true);
  perform set_config('request.jwt.claims', '', true);

  insert into cs_conversations (gmail_thread_id, canale, customer_email, customer_name, stato, flags, last_msg_at, last_direction)
    values ('chat:' || gen_random_uuid(), 'chat_sito', 'prova.0186@example.com', 'Prova RLS', 'da_fare', '["passaggio_agente"]', now(), 'in')
    returning id into v_cs;
  insert into cs_messages (gmail_message_id, conversation_id, direction, body_text, body_clean, sent_at)
    values ('chat:' || gen_random_uuid(), v_cs, 'in', 'prova', 'prova', now());
  update chat_sessioni set cs_conversation_id = v_cs where id = v_s2;

  foreach r in array c_ruoli loop
    perform set_config('role', case when r = 'anon' then 'anon' else 'authenticated' end, true);
    perform set_config('request.jwt.claims', case r when 'anon' then json_build_object('role', 'anon')
      when 'esterno' then json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0186@gmail.com')
      else json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'prova.0186@amimi.it') end::text, true);
    foreach v_rel in array v_rels loop
      begin execute format('select count(*) from %s', v_rel) into n; v_val := n::text;
      exception when others then v_val := 'err:' || sqlstate; end;
      v_dopo := v_dopo || jsonb_build_object(r || '|' || v_rel, v_val);
    end loop;
    -- la riga di prova cercata per id (Gate 2 dell'8-11, C2: i totali del team cambiano se cs-sync scrive nel frattempo)
    begin
      select count(*) into n from public.cs_conversations where id = v_cs;
      select count(*) into n2 from public.cs_messages where conversation_id = v_cs;
      v_val := n || '/' || n2;
    exception when others then v_val := 'err:' || sqlstate;
    end;
    if (r = 'team' and v_val is distinct from '1/1') or (r <> 'team' and v_val not in ('0/0', 'err:42501')) then
      raise exception 'KO P: % sulla riga chat_sito di prova in cs_conversations/cs_messages = % (atteso %)', r, v_val,
        case when r = 'team' then '1/1' else '0/0 o 42501' end;
    end if;

    -- T, U, N sulle tabelle chat_ (stesso ruolo e stesso JWT)
    foreach q in array vietate_tutti || case when r = 'anon' then vietate_lette else '{}'::text[] end loop
      st := 'ok';
      begin execute q; exception when others then st := sqlstate; end;
      if st <> '42501' then raise exception 'KO %: "%" = % (atteso 42501)', r, q, st; end if;
    end loop;
    if r <> 'anon' then
      select count(*) into n from public.chat_sessioni where id = v_s2;
      select count(*) into n2 from public.chat_messaggi where sessione_id = v_s2;
      if r = 'team' and (n <> 1 or n2 <> 1) then raise exception 'KO T: il team non legge la sessione o il messaggio di prova (% %)', n, n2; end if;
      if r = 'esterno' then
        select count(*) into n from public.chat_sessioni;
        select count(*) into n2 from public.chat_messaggi;
        if n <> 0 or n2 <> 0 then raise exception 'KO U: fuori dal team legge % sessioni e % messaggi', n, n2; end if;
      end if;
      if r = 'team' then
        select count(*) into n from public.chat_sessioni s where s.id = v_s2 and s.customer_email is not null and s.prova;
        if n <> 1 then raise exception 'KO T: il team non legge le colonne di chat_sessioni'; end if;
      end if;
    end if;
  end loop;
  perform set_config('role', v_owner, true);
  perform set_config('request.jwt.claims', '', true);

  -- P (seconda parte): anon ed esterno vedono le stesse righe (o lo stesso errore) di prima da ogni relazione (per loro
  -- la RLS da' 0 o 42501, quindi una scrittura di cs-sync nel frattempo non cambia il conteggio); il team la riga di prova
  -- l'ha gia' vista per id nel giro sopra
  foreach r in array array['anon', 'esterno'] loop
    foreach v_rel in array v_rels loop
      if (v_prima ->> (r || '|' || v_rel)) is distinct from (v_dopo ->> (r || '|' || v_rel)) then
        raise exception 'KO P: % vede la riga chat_sito di prova da % (prima %, dopo %)', r, v_rel, v_prima ->> (r || '|' || v_rel), v_dopo ->> (r || '|' || v_rel);
      end if;
    end loop;
  end loop;
  if (v_dopo ->> 'team|public.cs_conversations') !~ '^[0-9]+$' or (v_dopo ->> 'team|public.cs_messages') !~ '^[0-9]+$' then
    raise exception 'KO P: il team non legge cs_conversations o cs_messages (% %)',
      v_dopo ->> 'team|public.cs_conversations', v_dopo ->> 'team|public.cs_messages';
  end if;

  raise exception 'TEST_OK: V C F K K2 S T U N P verdi, % comandi vietati per ruolo (piu'' 2 letture ad anon), % relazioni cs_ provate (%) (rollback voluto)',
    array_length(vietate_tutti, 1), array_length(v_rels, 1), array_to_string(v_rels, ', ');
end $t$;
