-- tests/chat_proiezione.sql: prova viva della proiezione delle chat del sito in Assistenza (migr 0193, chat_proietta e
-- chat_proietta_arretrate; docs/PROPOSTA_chat_sito.md 7.4 e 7.5). Un solo blocco DO che finisce SEMPRE in eccezione:
-- 'TEST_OK' se tutto torna, 'KO <n>: ...' al primo controllo che fallisce. L'eccezione annulla tutto, quindi in
-- produzione non resta nulla (sessioni di prova con email @example.com, flag `prova`).
--   npx -y supabase@2.122.1 db query --linked --project-ref imszbjeyplaiovylhkgl -f tests/chat_proiezione.sql
-- Prima dell'apply si lancia col corpo della migrazione davanti (senza begin/commit), dopo l'apply da solo.
-- Variabili v_* (plpgsql.variable_conflict = error in produzione). Una chiamata volatile per istruzione (Gotcha_Tecnici
-- sez. 4: dentro un IF con OR l'ordine non e' garantito).
do $t$
declare
  v_s uuid;
  v_s2 uuid;
  v_s3 uuid;
  v_cs uuid;
  v_r jsonb;
  v_n int;
  v_c cs_conversations%rowtype;
  v_seq bigint;
  v_p timestamptz := clock_timestamp();
  v_s4 uuid;
  v_card uuid;
  v_altra uuid;
begin
  insert into chat_sessioni (stato, customer_email, customer_name, lingua, informativa_versione, prova)
    values ('bot', 'prova.0193@example.com', 'PROVA 0193', 'it', 'i-test', true) returning id into v_s;

  -- 1. nessun messaggio della cliente e nessun passaggio: niente card
  v_r := chat_proietta(v_s);
  if v_r ->> 'esito' <> 'vuota' then raise exception 'KO 1: atteso vuota, %', v_r; end if;
  if exists (select 1 from cs_conversations where gmail_thread_id = 'chat:' || v_s) then raise exception 'KO 1: card vuota creata'; end if;

  -- 2. un bottone: messaggio della cliente e risposta fissa, la chat resta del bot (Concluse, "Gestita dal bot", D-11)
  insert into chat_messaggi (sessione_id, autore, testo, client_msg_id, fonte)
    values (v_s, 'cliente', 'Spedizioni', gen_random_uuid(), 'bottone:spedizioni');
  insert into chat_messaggi (sessione_id, autore, testo, client_msg_id, fonte)
    values (v_s, 'automatica', 'Risposta fissa di prova', gen_random_uuid(), 'faq:1');
  v_r := chat_proietta(v_s);
  if (v_r ->> 'nata')::boolean is not true or (v_r ->> 'messaggi')::int <> 2 then raise exception 'KO 2: %', v_r; end if;
  select * into v_c from cs_conversations where gmail_thread_id = 'chat:' || v_s;
  if v_c.canale <> 'chat_sito' or v_c.stato <> 'fatto' or v_c.stato_by <> 'bot' or v_c.urgente is not false or v_c.flags <> '["prova"]'::jsonb
     or v_c.last_direction <> 'out' or v_c.snippet <> 'Spedizioni' or v_c.subject <> 'Chat del sito' or v_c.customer_email <> 'prova.0193@example.com'
     or v_c.categoria is not null then
    raise exception 'KO 2: card %', row_to_json(v_c);
  end if;
  v_cs := v_c.id;
  select count(*) into v_n from cs_messages where conversation_id = v_cs and gmail_message_id like 'chat:%' and from_email is null
    and ((direction = 'in' and sent_by is null and body_text = 'Spedizioni' and body_clean = 'Spedizioni' and not is_via_tool)
      or (direction = 'out' and sent_by = 'Risposta automatica' and not is_via_tool));
  if v_n <> 2 then raise exception 'KO 2: messaggi proiettati %', v_n; end if;
  select count(*) into v_n from cs_events where conversation_id = v_cs and azione = 'ingest' and dettaglio ->> 'canale' = 'chat_sito';
  if v_n <> 1 then raise exception 'KO 2: eventi ingest %', v_n; end if;
  select max(seq) into v_seq from chat_messaggi where sessione_id = v_s;
  if not exists (select 1 from chat_sessioni where id = v_s and proiettato_seq = v_seq and cs_conversation_id = v_cs) then
    raise exception 'KO 2: proiettato_seq o cs_conversation_id non scritti';
  end if;

  -- 3. idempotente: una seconda chiamata non duplica niente
  v_r := chat_proietta(v_s);
  if (v_r ->> 'nata')::boolean or (v_r ->> 'messaggi')::int <> 0 then raise exception 'KO 3: %', v_r; end if;
  select count(*) into v_n from cs_messages where conversation_id = v_cs;
  if v_n <> 2 then raise exception 'KO 3: messaggi %', v_n; end if;
  select count(*) into v_n from cs_events where conversation_id = v_cs and azione = 'ingest';
  if v_n <> 1 then raise exception 'KO 3: ingest %', v_n; end if;

  -- 4. testo libero e passaggio: avviso di sistema NON proiettato, ma il cursore lo supera
  insert into chat_messaggi (sessione_id, autore, testo, client_msg_id)
    values (v_s, 'cliente', E'Vorrei   parlare\ncon qualcuno', gen_random_uuid());
  update chat_sessioni set stato = 'attesa_persona', passaggi = 1, passaggio_at = v_p, ultimo_cliente_at = v_p where id = v_s;
  insert into chat_messaggi (sessione_id, autore, testo, client_msg_id, fonte)
    values (v_s, 'sistema', 'Abbiamo ricevuto la tua richiesta', gen_random_uuid(), 'attesa');
  v_r := chat_proietta(v_s);
  if (v_r ->> 'messaggi')::int <> 1 then raise exception 'KO 4: %', v_r; end if;
  select * into v_c from cs_conversations where id = v_cs;
  if v_c.stato <> 'da_fare' or v_c.stato_by is not null or v_c.urgente is not true or v_c.urgenza_motivo <> 'chat: serve una persona'
     or v_c.flags <> '["passaggio_agente", "prova"]'::jsonb or v_c.last_direction <> 'in' or v_c.snippet <> 'Vorrei parlare con qualcuno' then
    raise exception 'KO 4: card %', row_to_json(v_c);
  end if;
  if exists (select 1 from cs_messages where conversation_id = v_cs and body_text like 'Abbiamo ricevuto%') then raise exception 'KO 4: avviso proiettato'; end if;
  select max(seq) into v_seq from chat_messaggi where sessione_id = v_s;
  if not exists (select 1 from chat_sessioni where id = v_s and proiettato_seq = v_seq) then raise exception 'KO 4: cursore fermo prima dell''avviso'; end if;

  -- 5. risposta dello staff: in corso, non piu' urgente, out con is_via_tool e il nome
  insert into chat_messaggi (sessione_id, autore, staff_nome, testo, send_key) values (v_s, 'staff', 'Ginevra', 'Risposta del team', gen_random_uuid());
  update chat_sessioni set stato = 'aperta', preso_da = 'Ginevra', ultima_risposta_staff_at = v_p + interval '1 minute' where id = v_s;
  v_r := chat_proietta(v_s);
  select * into v_c from cs_conversations where id = v_cs;
  if v_c.stato <> 'in_corso' or v_c.stato_by <> 'Ginevra' or v_c.urgente is not false or v_c.urgenza_motivo is not null or v_c.last_direction <> 'out' then
    raise exception 'KO 5: card %', row_to_json(v_c);
  end if;
  if not exists (select 1 from cs_messages where conversation_id = v_cs and direction = 'out' and sent_by = 'Ginevra' and is_via_tool and body_text = 'Risposta del team') then
    raise exception 'KO 5: risposta dello staff non proiettata';
  end if;

  -- 6. aperta ma senza risposta dopo il passaggio: urgente (stessa regola dei solleciti)
  update chat_sessioni set passaggi = 2, passaggio_at = v_p + interval '2 minutes' where id = v_s;
  v_r := chat_proietta(v_s);
  select * into v_c from cs_conversations where id = v_cs;
  if v_c.stato <> 'in_corso' or v_c.urgente is not true then raise exception 'KO 6: card %', row_to_json(v_c); end if;

  -- 7. categoria e canale li decidono lo staff e il rumore: la proiezione non li tocca
  update cs_conversations set categoria = 'Info prodotto', canale = 'rumore' where id = v_cs;
  insert into chat_messaggi (sessione_id, autore, testo, client_msg_id) values (v_s, 'cliente', 'Ancora io', gen_random_uuid());
  v_r := chat_proietta(v_s);
  select * into v_c from cs_conversations where id = v_cs;
  if v_c.canale <> 'rumore' or v_c.categoria <> 'Info prodotto' or v_c.snippet <> 'Ancora io' then raise exception 'KO 7: card %', row_to_json(v_c); end if;
  update cs_conversations set canale = 'chat_sito' where id = v_cs;

  -- 8. chiusa: Concluse con chi l'ha presa
  update chat_sessioni set stato = 'chiusa', chiusa_at = clock_timestamp() where id = v_s;
  v_r := chat_proietta(v_s);
  select * into v_c from cs_conversations where id = v_cs;
  if v_c.stato <> 'fatto' or v_c.stato_by <> 'Ginevra' or v_c.urgente is not false then raise exception 'KO 8: card %', row_to_json(v_c); end if;

  -- 9. passaggio senza nessun messaggio della cliente: la card nasce lo stesso, in attesa
  insert into chat_sessioni (stato, customer_email, lingua, informativa_versione, prova, passaggi, passaggio_at)
    values ('attesa_persona', 'prova.0193b@example.com', 'en', 'i-test', true, 1, v_p) returning id into v_s2;
  v_r := chat_proietta(v_s2);
  select * into v_c from cs_conversations where gmail_thread_id = 'chat:' || v_s2;
  if v_c.id is null or v_c.stato <> 'da_fare' or v_c.urgente is not true or v_c.last_direction <> 'in' or v_c.snippet is not null or v_c.lingua <> 'en' then
    raise exception 'KO 9: card %', row_to_json(v_c);
  end if;

  -- 10. rete di sicurezza: una sessione con un messaggio mai proiettato e una card con lo stato sbagliato
  insert into chat_sessioni (stato, customer_email, lingua, informativa_versione, prova)
    values ('bot', 'prova.0193c@example.com', 'it', 'i-test', true) returning id into v_s3;
  insert into chat_messaggi (sessione_id, autore, testo, client_msg_id) values (v_s3, 'cliente', 'Mai proiettata', gen_random_uuid());
  update cs_conversations set stato = 'da_fare' where gmail_thread_id = 'chat:' || v_s2;
  update chat_sessioni set stato = 'aperta', preso_da = 'Ale' where id = v_s2;
  v_r := chat_proietta_arretrate();
  if (v_r ->> 'fatte')::int < 2 or (v_r ->> 'errori')::int <> 0 then raise exception 'KO 10: %', v_r; end if;
  if not exists (select 1 from cs_conversations where gmail_thread_id = 'chat:' || v_s3 and snippet = 'Mai proiettata') then raise exception 'KO 10: card non recuperata'; end if;
  if not exists (select 1 from cs_conversations where gmail_thread_id = 'chat:' || v_s2 and stato = 'in_corso' and stato_by = 'Ale') then raise exception 'KO 10: stato non riallineato'; end if;
  select count(*) into v_n from chat_eventi where tipo = 'proiezione' and esito = 'fatto' and sessione_id is null and at = now();
  if v_n < 1 then raise exception 'KO 10: evento proiezione assente'; end if;
  v_r := chat_proietta_arretrate();
  if exists (select 1 from chat_sessioni where id in (v_s, v_s2, v_s3) and cs_conversation_id is null) then raise exception 'KO 10: sessione senza card'; end if;

  -- 11. una sessione cancellata: la proiezione dice assente
  v_r := chat_proietta(gen_random_uuid());
  if v_r ->> 'esito' <> 'assente' then raise exception 'KO 11: %', v_r; end if;

  -- 12. privilegi: solo il service_role esegue chat_proietta, nessuno da fuori la arretrate
  if has_function_privilege('anon', 'public.chat_proietta(uuid)', 'execute') or has_function_privilege('authenticated', 'public.chat_proietta(uuid)', 'execute')
     or has_function_privilege('anon', 'public.chat_proietta_arretrate()', 'execute') or has_function_privilege('authenticated', 'public.chat_proietta_arretrate()', 'execute')
     or has_function_privilege('service_role', 'public.chat_proietta_arretrate()', 'execute') then
    raise exception 'KO 12: privilegi delle funzioni';
  end if;
  if not has_function_privilege('service_role', 'public.chat_proietta(uuid)', 'execute') then raise exception 'KO 12: service_role senza execute'; end if;

  -- 13. v_lead_inbound (migr 0194) non vede le chiavi della chat
  if exists (select 1 from v_lead_inbound where gmail_thread_id like 'chat:%') then raise exception 'KO 13: chat in v_lead_inbound'; end if;

  -- 14. sent_at strettamente crescente coi seq: bottone e risposta fissa nello stesso insert (stesso created_at, Gate 2 C3)
  if (select count(distinct sent_at) from cs_messages where conversation_id = v_cs) <> (select count(*) from cs_messages where conversation_id = v_cs) then
    raise exception 'KO 14: sent_at uguali nella stessa chat';
  end if;
  if exists (select 1 from cs_messages a join cs_messages b on b.conversation_id = a.conversation_id
              join chat_messaggi ma on 'chat:' || ma.id = a.gmail_message_id join chat_messaggi mb on 'chat:' || mb.id = b.gmail_message_id
             where a.conversation_id = v_cs and ma.seq < mb.seq and a.sent_at >= b.sent_at) then
    raise exception 'KO 14: ordine dei sent_at diverso da quello dei seq';
  end if;

  -- 15. il cron ripara anche stato_by (Gate 2 C1): stessa chiusa, nome sbagliato in cs_
  update cs_conversations set stato_by = 'Benedetta' where id = v_cs;
  v_r := chat_proietta_arretrate();
  if not exists (select 1 from cs_conversations where id = v_cs and stato_by = 'Ginevra') then raise exception 'KO 15: stato_by non riallineato'; end if;

  -- 16. cancellazione in una transazione (Gate 2 B1): proiezione, card email solo se del thread, contatori, eventi, push, sessione
  insert into chat_sessioni (stato, customer_email, lingua, informativa_versione, prova, gmail_thread_id)
    values ('bot', 'prova.0193d@example.com', 'it', 'i-test', true, 'thread-prova-0193') returning id into v_s4;
  insert into chat_messaggi (sessione_id, autore, testo, client_msg_id) values (v_s4, 'cliente', 'Da cancellare', gen_random_uuid());
  v_r := chat_proietta(v_s4);
  insert into cs_conversations (gmail_thread_id, canale, customer_email) values ('thread-prova-0193', 'email_diretta', 'prova.0193d@example.com') returning id into v_card;
  insert into cs_conversations (gmail_thread_id, canale, customer_email) values ('thread-altro-0193', 'email_diretta', 'prova.0193d@example.com') returning id into v_altra;
  perform chat_contatore_incrementa('sess:' || v_s4::text || ':msg', 0, 100);
  insert into chat_eventi (sessione_id, tipo, chiave, chi, esito, dettaglio) values (v_s4, 'push_passaggio', v_s4::text || ':passaggio:1', null, 'prenotato', '{}');
  v_r := chat_cancella_sessione(v_s4, v_altra);
  if v_r ->> 'esito' <> 'cancellata' or (v_r ->> 'proiezioni')::int <> 1 or (v_r ->> 'card_email')::int <> 0 or (v_r ->> 'contatori')::int <> 1
     or (v_r ->> 'eventi')::int <> 1 or (v_r ->> 'messaggi')::int <> 1 then
    raise exception 'KO 16: %', v_r;
  end if;
  if not exists (select 1 from cs_conversations where id = v_altra) or not exists (select 1 from cs_conversations where id = v_card) then
    raise exception 'KO 16: cancellata una card che non era quella del thread della sessione';
  end if;
  if exists (select 1 from chat_sessioni where id = v_s4) or exists (select 1 from cs_conversations where gmail_thread_id = 'chat:' || v_s4)
     or exists (select 1 from chat_contatori where chiave like 'sess:' || v_s4::text || ':%') or exists (select 1 from chat_eventi where chiave like v_s4::text || ':%') then
    raise exception 'KO 16: resti della chat cancellata';
  end if;
  v_r := chat_proietta(v_s4);
  if v_r ->> 'esito' <> 'assente' then raise exception 'KO 16: la proiezione fa rinascere la chat cancellata: %', v_r; end if;
  v_r := chat_cancella_sessione(v_s4, null);
  if v_r ->> 'esito' <> 'assente' then raise exception 'KO 16: seconda cancellazione %', v_r; end if;
  -- la card del thread si cancella solo se chiesta e se e' davvero quella della sessione
  insert into chat_sessioni (stato, customer_email, lingua, informativa_versione, prova, gmail_thread_id)
    values ('bot', 'prova.0193e@example.com', 'it', 'i-test', true, 'thread-prova-0193') returning id into v_s4;
  v_r := chat_cancella_sessione(v_s4, v_card);
  if (v_r ->> 'card_email')::int <> 1 or exists (select 1 from cs_conversations where id = v_card) then raise exception 'KO 16: card del thread non cancellata %', v_r; end if;
  if has_function_privilege('anon', 'public.chat_cancella_sessione(uuid, uuid)', 'execute') or has_function_privilege('authenticated', 'public.chat_cancella_sessione(uuid, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.chat_cancella_sessione(uuid, uuid)', 'execute') then
    raise exception 'KO 16: privilegi di chat_cancella_sessione';
  end if;

  raise exception 'TEST_OK';
end
$t$;
