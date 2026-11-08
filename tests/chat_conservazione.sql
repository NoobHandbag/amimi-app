-- tests/chat_conservazione.sql: prova viva della pulizia della chat (migr 0187, chat_conservazione(), 11.5), da lanciare
-- DOPO l'apply. Un blocco DO che finisce SEMPRE in eccezione: TEST_OK (rollback voluto) se tutto torna, altrimenti
-- il motivo. Niente resta scritto. Righe di prova con `prova = true` e indirizzi del team, mai di clienti.
-- Prova: una chat ferma da 13 mesi (con messaggi, token, contatori, eventi con la sua chiave e una proiezione in cs_)
-- viene cancellata; una chat ferma da 11 mesi e le chat vere restano; contatori fermi da 8 giorni e token scaduti da 2
-- giorni se ne vanno; il valore dei mesi viene da app_flags (con un valore illeggibile vale 12); un evento di conteggi
-- senza email; nessuna riga in change_log. Dalla 0189 (pezzo 4): le righe del registro push_eventi_inviati dei tre eventi
-- della chat (0188) con la chiave della chat vecchia se ne vanno, quelle della chat recente, per giorno o di altri eventi restano.
do $$
declare
  v_vecchia uuid;
  v_recente uuid;
  v_cs uuid;
  v_r jsonb;
  v_altre int;
  v_mesi text;
begin
  select count(*) into v_altre from chat_sessioni;
  select value into v_mesi from app_flags where key = 'chat_conservazione_mesi';

  insert into chat_sessioni (stato, customer_email, informativa_versione, prova, ultima_attivita_at, created_at)
  values ('bot', 'info@amimi.it', 'test', true, now() - interval '13 months', now() - interval '13 months') returning id into v_vecchia;
  insert into chat_sessioni (stato, customer_email, informativa_versione, prova, ultima_attivita_at, created_at)
  values ('bot', 'info@amimi.it', 'test', true, now() - interval '11 months', now() - interval '11 months') returning id into v_recente;
  insert into chat_messaggi (sessione_id, autore, testo, client_msg_id) values (v_vecchia, 'cliente', 'prova', gen_random_uuid()), (v_recente, 'cliente', 'prova', gen_random_uuid());
  insert into chat_token (sessione_id, tipo, hash, scade_at) values (v_vecchia, 'ripresa', repeat('a', 64), now() + interval '1 day');
  insert into chat_token (sessione_id, tipo, hash, scade_at, created_at) values (v_recente, 'chat', repeat('b', 64), now() - interval '2 days', now() - interval '40 days');
  insert into chat_contatori (chiave, finestra, n, aggiornato_at) values ('sess:' || v_vecchia || ':msg', 'epoch', 1, now()),
    ('glob:prova_conservazione', 'epoch', 1, now() - interval '8 days'), ('glob:prova_fresca', 'epoch', 1, now());
  insert into chat_eventi (sessione_id, tipo, chiave, esito) values (v_vecchia, 'thread_email', v_vecchia || ':thread:primo', 'prenotato'),
    (v_vecchia, 'avvia', null, null);
  insert into cs_conversations (gmail_thread_id, canale) values ('chat:' || v_vecchia, 'chat_sito') returning id into v_cs;
  insert into push_eventi_inviati (evento, chiave, stato, tentativi) values
    ('chat_sollecito', v_vecchia || ':1:sollecito:1', 'saltato', 0), ('chat_sollecito_scala', v_vecchia || ':1:sollecito:2', 'saltato', 0),
    ('chat_salute', v_vecchia || ':1:passaggio', 'saltato', 0), ('chat_sollecito', v_recente || ':1:sollecito:1', 'saltato', 0),
    ('chat_salute', 'api:prova-conservazione', 'saltato', 0), ('cs_urgente', v_vecchia || ':urgente', 'saltato', 0);
  -- Gate 2, C1: righe orfane (chiave di una sessione che non esiste): quella ferma da 2 ore va via, quella fresca resta
  insert into push_eventi_inviati (evento, chiave, stato, tentativi, updated_at) values
    ('chat_sollecito', '00000000-0000-4000-8000-0000000000ff:1:sollecito:1', 'saltato', 0, now() - interval '2 hours'),
    ('chat_salute', '00000000-0000-4000-8000-0000000000fe:1:passaggio', 'prenotato', 1, now());

  v_r := public.chat_conservazione();

  if exists (select 1 from chat_sessioni where id = v_vecchia) then raise exception 'KO: la chat di 13 mesi non e'' stata cancellata (%)', v_r; end if;
  if exists (select 1 from chat_messaggi where sessione_id = v_vecchia) or exists (select 1 from chat_token where sessione_id = v_vecchia) then
    raise exception 'KO: messaggi o token della chat cancellata rimasti';
  end if;
  if exists (select 1 from cs_conversations where id = v_cs) then raise exception 'KO: proiezione in cs_ rimasta'; end if;
  if exists (select 1 from chat_contatori where chiave = 'sess:' || v_vecchia || ':msg') then raise exception 'KO: contatore della sessione rimasto'; end if;
  if exists (select 1 from chat_eventi where chiave = v_vecchia || ':thread:primo') then raise exception 'KO: evento con la chiave della sessione rimasto'; end if;
  if not exists (select 1 from chat_eventi where tipo = 'avvia' and sessione_id is null and at > now() - interval '1 minute') then
    raise exception 'KO: l''evento senza chiave doveva restare senza sessione';
  end if;
  if not exists (select 1 from chat_sessioni where id = v_recente) then raise exception 'KO: la chat di 11 mesi e'' stata cancellata'; end if;
  if exists (select 1 from push_eventi_inviati where chiave like v_vecchia || ':%' and evento like 'chat\_%') then raise exception 'KO: registro delle push della chat cancellata rimasto'; end if;
  if (select count(*) from push_eventi_inviati where chiave in (v_recente || ':1:sollecito:1', 'api:prova-conservazione', v_vecchia || ':urgente')) <> 3 then
    raise exception 'KO: cancellate righe del registro di un''altra chat, per giorno o di un altro evento';
  end if;
  if exists (select 1 from push_eventi_inviati where chiave = '00000000-0000-4000-8000-0000000000ff:1:sollecito:1') then raise exception 'KO: riga orfana ferma da 2 ore rimasta'; end if;
  if not exists (select 1 from push_eventi_inviati where chiave = '00000000-0000-4000-8000-0000000000fe:1:passaggio') then raise exception 'KO: riga orfana fresca (invio forse in corso) cancellata'; end if;
  if (select count(*) from chat_sessioni) <> v_altre + 1 then raise exception 'KO: toccate altre chat'; end if;
  if exists (select 1 from chat_contatori where chiave = 'glob:prova_conservazione') then raise exception 'KO: contatore fermo da 8 giorni rimasto'; end if;
  if not exists (select 1 from chat_contatori where chiave = 'glob:prova_fresca') then raise exception 'KO: contatore fresco cancellato'; end if;
  if exists (select 1 from chat_token where hash = repeat('b', 64)) then raise exception 'KO: token scaduto da 2 giorni rimasto'; end if;
  if (v_r ->> 'sessioni')::int <> 1 or (v_r ->> 'proiezioni')::int <> 1 or (v_r ->> 'push')::int < 4 or (v_r ->> 'mesi')::int <> coalesce(nullif(trim(v_mesi), '')::int, 12) then
    raise exception 'KO: conteggi % (mesi del flag %)', v_r, v_mesi;
  end if;
  if not exists (select 1 from chat_eventi where tipo = 'conservazione' and chi = 'cron' and (dettaglio ->> 'sessioni')::int = 1 and position('@' in dettaglio::text) = 0) then
    raise exception 'KO: evento di conservazione mancante';
  end if;

  -- valore illeggibile = 12
  update app_flags set value = 'dodici' where key = 'chat_conservazione_mesi';
  v_r := public.chat_conservazione();
  if (v_r ->> 'mesi')::int <> 12 then raise exception 'KO: flag illeggibile non vale 12 (%)', v_r; end if;

  if exists (select 1 from change_log where tbl like 'chat\_%' and ts > now() - interval '1 minute') then raise exception 'KO: righe della chat in change_log'; end if;
  if has_function_privilege('anon', 'public.chat_conservazione()', 'execute') or has_function_privilege('authenticated', 'public.chat_conservazione()', 'execute') then
    raise exception 'KO: chat_conservazione eseguibile da anon o authenticated';
  end if;
  raise exception 'TEST_OK: chat_conservazione (% ) (rollback voluto)', v_r;
end $$;
