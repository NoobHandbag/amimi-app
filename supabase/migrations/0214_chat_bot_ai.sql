-- 0214_chat_bot_ai.sql (2026-11-25): chat del sito, Fase 2 ridotta (il chatbot vero chiesto da Dan il 25-11, dopo la
-- bocciatura della Fase 1). Brief nel repo hub: Cowork12/_CLAUDE_CODE_INBOX/BRIEF_chat_sito_fase2_ridotta_2026-11-25.md.
-- Proposta: docs/PROPOSTA_chat_sito.md sez. 9 (ridotta), 11.3, 13.4 Fase 2.
--
-- Modulo chat_* (Regola Ferrea 19): solo tabelle chat_*, funzioni chat_* e chiavi chat_* di app_flags; nessuna tabella core.
-- Tutto nasce SPENTO: chat_bot_ai_enabled = 'false' (spento, chat-api api-6 si comporta come la Fase 1 ma senza modulo
-- d'apertura: il testo libero passa al team chiedendo l'email). Rollback = il flag spento.
--   1) chat_sessioni.customer_email diventa facoltativa: la chat si apre sul saluto del bot, senza modulo, e l'email si
--      chiede solo al passaggio a una persona. Vincolo nuovo: senza email nessun passaggio (passaggi = 0) e mai `aperta`,
--      quindi push, solleciti, card e chat-send (che lavorano solo su chat passate al team) trovano sempre un'email.
--      Colonna nuova email_chiesta_at: il bot (o la cliente col pulsante) ha chiesto una persona e manca l'email; il
--      widget mostra il campo email. Nessun grant nuovo al team: la colonna non esce (grant per colonna della 0186).
--   2) chat_ai_log: una riga per turno del bot (9.14 ridotta): modello, parametri, impronta del prompt statico,
--      strumenti chiamati con le fonti, testo grezzo e testo mostrato, esito, lint, token e costo in USD, errore. Solo
--      service_role; si cancella con la chat (FK in cascata, quindi anche chat_cancella_sessione e la conservazione).
--      Niente email ne' nome della cliente: non entrano nel prompt.
--   3) chat_ai_spesa_oggi(): somma del costo del giorno UTC, per il tetto di spesa di chat-api (PostgREST non somma).
--   4) chat_proietta e chat_proietta_arretrate ricreate dalla 0193 con UNA differenza: la card in Assistenza nasce al
--      primo passaggio (passaggi > 0), non piu' al primo messaggio della cliente. Una chat del solo bot puo' non avere
--      email e non ha niente da fare per il team. Scostamento da D-11 (chat del bot fra le Concluse), dichiarato nel
--      brief e da confermare con Dan. Con il passaggio la card porta tutta la conversazione col bot (mittente "Assistente
--      AI", gia' nella 0193).
--   5) flag nuovi: interruttore, modello (elenco chiuso nel codice), tetti di D-17 (1 USD e 300 chiamate al giorno,
--      10 risposte AI per chat), testi fissi del bot. on conflict do nothing: un valore cambiato dopo non si tocca.
-- Sicurezza (5.9): RLS accesa e revoke a public, anon e authenticated su chat_ai_log, sulla sua sequenza e sulla
-- funzione nuova; scrive e legge solo il service_role. Funzioni security invoker con search_path fissato.
-- Nessuna scrittura in change_log. Variabili v_* (plpgsql.variable_conflict = error in produzione).
begin;

-- 1) email facoltativa fino al passaggio
alter table chat_sessioni alter column customer_email drop not null;
alter table chat_sessioni add column if not exists email_chiesta_at timestamptz;
alter table chat_sessioni drop constraint if exists chat_sessioni_email_passaggio_ck;
alter table chat_sessioni add constraint chat_sessioni_email_passaggio_ck
  check (customer_email is not null or (passaggi = 0 and stato in ('bot', 'chiusa')));

-- 2) registro delle risposte AI
create table if not exists chat_ai_log (
  id               bigint generated always as identity (sequence name chat_ai_log_id_sq) primary key,
  sessione_id      uuid not null,
  messaggio_id     uuid,
  turno            int not null,
  creato_at        timestamptz not null default now(),
  modello          text not null,
  parametri        jsonb not null default '{}',
  versione_prompt  text,
  strumenti        jsonb not null default '[]',
  fonti            jsonb not null default '[]',
  testo_modello    text,
  testo_mostrato   text,
  esito            text not null,
  lint             jsonb not null default '[]',
  usage            jsonb not null default '{}',
  costo_usd        numeric(12, 6) not null default 0,
  errore           text,
  durata_ms        int,
  prova            boolean not null default false,
  constraint chat_ai_log_sessione_fk foreign key (sessione_id) references chat_sessioni (id) on delete cascade,
  constraint chat_ai_log_messaggio_fk foreign key (messaggio_id) references chat_messaggi (id) on delete set null,
  constraint chat_ai_log_turno_ck check (turno >= 1),
  constraint chat_ai_log_modello_ck check (modello ~ '^[a-z0-9.-]{1,60}$'),
  constraint chat_ai_log_esito_ck check (esito in ('inviata', 'rigenerata', 'passata', 'bloccata_lint', 'errore', 'tetto')),
  constraint chat_ai_log_costo_ck check (costo_usd >= 0),
  constraint chat_ai_log_testi_ck check ((testo_modello is null or char_length(testo_modello) <= 8000)
    and (testo_mostrato is null or char_length(testo_mostrato) <= 4000)),
  constraint chat_ai_log_errore_ck check (errore is null or char_length(errore) between 1 and 300),
  constraint chat_ai_log_json_ck check (jsonb_typeof(strumenti) = 'array' and jsonb_typeof(fonti) = 'array'
    and jsonb_typeof(lint) = 'array' and jsonb_typeof(usage) = 'object' and jsonb_typeof(parametri) = 'object'
    and octet_length(strumenti::text) <= 60000)
);
create index if not exists chat_ai_log_sessione_ix on chat_ai_log (sessione_id);
create index if not exists chat_ai_log_creato_ix on chat_ai_log (creato_at);
comment on table chat_ai_log is 'Chat del sito: una riga per turno del bot AI (Fase 2 ridotta), con fonti, lint e costo. Solo service_role; si cancella con la chat.';
alter table chat_ai_log enable row level security;
revoke all on chat_ai_log from public, anon, authenticated;
grant select, insert, update, delete on chat_ai_log to service_role;
revoke all on sequence chat_ai_log_id_sq from public, anon, authenticated;
grant usage, select on sequence chat_ai_log_id_sq to service_role;

-- 3) spesa AI del giorno UTC (tetto di chat-api)
create or replace function public.chat_ai_spesa_oggi() returns numeric
language sql
stable
set search_path to 'public'
as $fn$
  select coalesce(sum(costo_usd), 0)::numeric from chat_ai_log
   where creato_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
$fn$;
revoke all on function public.chat_ai_spesa_oggi() from public, anon, authenticated;
grant execute on function public.chat_ai_spesa_oggi() to service_role;

-- 4) proiezione solo al passaggio (testo della 0193, due condizioni cambiate)
create or replace function public.chat_proietta(p_sessione uuid) returns jsonb
language plpgsql
set search_path to 'public'
as $fn$
declare
  v_s chat_sessioni%rowtype;
  v_cliente boolean;
  v_stato text;
  v_stato_by text;
  v_urgente boolean;
  v_flags jsonb;
  v_last_at timestamptz;
  v_last_dir text;
  v_snip text;
  v_cs uuid;
  v_nata boolean := false;
  v_max bigint;
  v_n int := 0;
  v_primo bigint;
begin
  select * into v_s from chat_sessioni where id = p_sessione for update;
  if not found then
    return jsonb_build_object('esito', 'assente');
  end if;
  select exists (select 1 from chat_messaggi m where m.sessione_id = p_sessione and m.autore = 'cliente') into v_cliente;
  -- 0214: la card nasce solo col primo passaggio a una persona (prima la chat e' del solo bot e puo' non avere email)
  if v_s.passaggi = 0 and v_s.cs_conversation_id is null then
    return jsonb_build_object('esito', 'vuota');
  end if;

  -- 7.5: decide solo chat_sessioni. Urgente = la chat aspetta il team dopo l'ultimo passaggio (stessa regola dei
  -- solleciti di push-eventi: nessuna risposta dello staff dopo passaggio_at).
  v_stato := case v_s.stato when 'attesa_persona' then 'da_fare' when 'aperta' then 'in_corso' else 'fatto' end;
  v_stato_by := case v_s.stato when 'bot' then 'bot' when 'attesa_persona' then null else coalesce(v_s.preso_da, 'Team') end;
  v_urgente := v_s.stato in ('attesa_persona', 'aperta') and v_s.passaggio_at is not null
    and (v_s.ultima_risposta_staff_at is null or v_s.ultima_risposta_staff_at < v_s.passaggio_at);
  v_flags := (case when v_s.passaggi >= 1 then '["passaggio_agente"]'::jsonb else '[]'::jsonb end)
    || (case when v_s.prova then '["prova"]'::jsonb else '[]'::jsonb end);

  select m.created_at, case when m.autore = 'cliente' then 'in' else 'out' end into v_last_at, v_last_dir
    from chat_messaggi m where m.sessione_id = p_sessione and m.autore <> 'sistema' order by m.seq desc limit 1;
  if v_last_at is null then
    v_last_at := coalesce(v_s.passaggio_at, v_s.created_at);
    v_last_dir := 'in';
  end if;
  if v_s.stato = 'attesa_persona' then
    v_last_dir := 'in';
    v_last_at := greatest(v_last_at, v_s.passaggio_at);
  end if;
  select left(btrim(regexp_replace(m.testo, '\s+', ' ', 'g')), 200) into v_snip
    from chat_messaggi m where m.sessione_id = p_sessione and m.autore = 'cliente' order by m.seq desc limit 1;

  insert into cs_conversations as c (gmail_thread_id, canale, customer_email, customer_name, subject, snippet, stato, stato_by,
      stato_at, urgente, urgenza_motivo, flags, last_msg_at, last_direction, lingua, created_at)
    values ('chat:' || p_sessione::text, 'chat_sito', v_s.customer_email, v_s.customer_name, 'Chat del sito', v_snip, v_stato,
      v_stato_by, now(), v_urgente, case when v_urgente then 'chat: serve una persona' end, v_flags, v_last_at, v_last_dir,
      v_s.lingua, v_s.created_at)
  on conflict (gmail_thread_id) do update set
    customer_email = excluded.customer_email,
    customer_name = excluded.customer_name,
    snippet = coalesce(excluded.snippet, c.snippet),
    stato = excluded.stato,
    stato_by = excluded.stato_by,
    stato_at = case when c.stato is distinct from excluded.stato or c.stato_by is distinct from excluded.stato_by then now() else c.stato_at end,
    urgente = excluded.urgente,
    urgenza_motivo = excluded.urgenza_motivo,
    flags = excluded.flags,
    last_msg_at = excluded.last_msg_at,
    last_direction = excluded.last_direction
  returning c.id, (c.xmax = 0) into v_cs, v_nata;

  -- sent_at = created_at piu' tanti microsecondi quanti seq dal primo della chat: bottone e risposta fissa (stesso
  -- insert, stesso istante) restano nell'ordine dei seq anche fra chiamate diverse (Gate 2, C3)
  select min(m.seq) into v_primo from chat_messaggi m where m.sessione_id = p_sessione;
  with nuovi as (
    select m.id, m.seq, m.autore, m.staff_nome, m.testo, m.created_at
      from chat_messaggi m where m.sessione_id = p_sessione and m.seq > v_s.proiettato_seq order by m.seq limit 500
  ), ins as (
    insert into cs_messages (gmail_message_id, conversation_id, direction, sent_by, from_email, to_email, sent_at, body_text,
        body_clean, is_via_tool)
      select 'chat:' || n.id::text, v_cs, case when n.autore = 'cliente' then 'in' else 'out' end,
        case n.autore when 'cliente' then null when 'automatica' then 'Risposta automatica' when 'ai' then 'Assistente AI' else n.staff_nome end,
        null, null, n.created_at + (n.seq - v_primo) * interval '1 microsecond', n.testo, n.testo, n.autore = 'staff'
      from nuovi n where n.autore <> 'sistema'
    on conflict (gmail_message_id) do nothing
    returning 1
  )
  select (select max(n.seq) from nuovi n), (select count(*) from ins) into v_max, v_n;

  update chat_sessioni set proiettato_seq = greatest(proiettato_seq, coalesce(v_max, 0)), cs_conversation_id = v_cs
    where id = p_sessione and (proiettato_seq < coalesce(v_max, 0) or cs_conversation_id is distinct from v_cs);

  if v_nata then
    insert into cs_events (conversation_id, azione, chi, dettaglio)
      values (v_cs, 'ingest', 'chat', jsonb_build_object('canale', 'chat_sito'));
  end if;
  return jsonb_build_object('esito', 'fatto', 'nata', v_nata, 'messaggi', v_n, 'fino_a', greatest(v_s.proiettato_seq, coalesce(v_max, 0)));
end;
$fn$;

create or replace function public.chat_proietta_arretrate() returns jsonb
language plpgsql
set search_path to 'public'
as $fn$
declare
  v_id uuid;
  v_fatte int := 0;
  v_errori int := 0;
begin
  for v_id in
    select s.id from chat_sessioni s
      left join cs_conversations c on c.id = s.cs_conversation_id
     where (s.cs_conversation_id is null and s.passaggi > 0)
        or ((s.passaggi > 0 or s.cs_conversation_id is not null)
            and exists (select 1 from chat_messaggi m where m.sessione_id = s.id and m.seq > s.proiettato_seq and m.autore <> 'sistema'))
        or (c.id is not null and (c.stato is distinct from
              (case s.stato when 'attesa_persona' then 'da_fare' when 'aperta' then 'in_corso' else 'fatto' end)
            or c.stato_by is distinct from
              (case s.stato when 'bot' then 'bot' when 'attesa_persona' then null else coalesce(s.preso_da, 'Team') end)
            or c.urgente is distinct from (s.stato in ('attesa_persona', 'aperta') and s.passaggio_at is not null
              and (s.ultima_risposta_staff_at is null or s.ultima_risposta_staff_at < s.passaggio_at))))
     order by s.ultima_attivita_at desc
     limit 50
  loop
    begin
      perform chat_proietta(v_id);
      v_fatte := v_fatte + 1;
    exception when others then
      v_errori := v_errori + 1;
      perform chat_contatore_incrementa('glob:proiezione_ko', 86400, 1000000);
    end;
  end loop;
  -- una sessione che fallisce sempre ritorna a ogni giro: l'evento d'errore e' uno all'ora (chiave UNIQUE), non uno ogni 2'
  if v_errori > 0 then
    insert into chat_eventi (sessione_id, tipo, chiave, chi, esito, dettaglio)
      values (null, 'proiezione', 'proiezione_errori:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD-HH24'), 'cron', 'errori',
        jsonb_build_object('fatte', v_fatte, 'errori', v_errori))
    on conflict (chiave) do nothing;
  elsif v_fatte > 0 then
    insert into chat_eventi (sessione_id, tipo, chiave, chi, esito, dettaglio)
      values (null, 'proiezione', null, 'cron', 'fatto', jsonb_build_object('fatte', v_fatte, 'errori', 0));
  end if;
  return jsonb_build_object('fatte', v_fatte, 'errori', v_errori);
end;
$fn$;

-- 5) flag nuovi (nascono spenti o ai valori di D-17)
insert into app_flags (key, value) values
  ('chat_bot_ai_enabled', 'false'),
  ('chat_ai_modello', 'claude-haiku-5-5'),
  ('chat_ai_tetto_usd_giorno', '1'),
  ('chat_ai_chiamate_giorno', '300'),
  ('chat_ai_risposte_chat', '10'),
  ('chat_testo_saluto_bot', jsonb_build_object(
    'it', $t$Ciao, sono l'assistente automatico di Amimì: come posso aiutarti?$t$,
    'en', $t$Hi, I'm Amimì's automated assistant: how can I help you?$t$)::text),
  ('chat_testo_etichetta_ai', jsonb_build_object(
    'it', $t$Stai scrivendo a un assistente AI: può sbagliare, controlla prezzo e condizioni sulla scheda del prodotto.$t$,
    'en', $t$You are writing to an AI assistant: it can make mistakes, so check price and terms on the product page.$t$)::text),
  ('chat_testo_chiedi_email', jsonb_build_object(
    'it', $t$Passo la tua domanda al team Amimì, che ti risponde via email, di solito entro 2 giorni lavorativi. Scrivimi la tua email (e il tuo nome, se vuoi).$t$,
    'en', $t$I'll pass your question to the Amimì team, who will reply by email, usually within 2 working days. Please write your email address (and your name, if you like).$t$)::text),
  ('chat_testo_informativa_ai', jsonb_build_object(
    'it', $t$In questa chat ti risponde un assistente AI (Claude, di Anthropic) che usa solo le informazioni di Amimì: i tuoi messaggi passano ad Anthropic per generare le risposte. Se chiedi una persona del team, usiamo la tua email, e il nome se lo scrivi, per risponderti via email. Conserviamo la chat per 24 mesi dall'ultimo messaggio. Non scrivere dati di pagamento o di salute. La chat non è pensata per i minori. Dettagli e diritti nell'informativa sulla privacy.$t$,
    'en', $t$In this chat you are answered by an AI assistant (Claude, by Anthropic) that only uses Amimì's information: your messages are sent to Anthropic to generate the answers. If you ask for a person from our team, we use your email, and your name if you write it, to reply to you by email. We keep the chat for 24 months after the last message. Do not write payment or health details. The chat is not intended for minors. Details and your rights are in the privacy notice.$t$)::text)
on conflict (key) do nothing;

-- prova del contratto: fallisce l'intera migrazione se qualcosa non e' come detto sopra
do $$
declare
  v_n int;
begin
  if (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'chat_sessioni'
       and column_name = 'customer_email') <> 'YES' then
    raise exception '0214: customer_email ancora obbligatoria';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chat_sessioni_email_passaggio_ck') then
    raise exception '0214: manca il vincolo email al passaggio';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.chat_ai_log'::regclass) then
    raise exception '0214: RLS spenta su chat_ai_log';
  end if;
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'chat_ai_log' and grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_n > 0 then raise exception '0214: chat_ai_log ha privilegi per anon o authenticated'; end if;
  if has_function_privilege('anon', 'public.chat_ai_spesa_oggi()', 'execute')
     or has_function_privilege('authenticated', 'public.chat_ai_spesa_oggi()', 'execute')
     or has_function_privilege('anon', 'public.chat_proietta(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.chat_proietta(uuid)', 'execute') then
    raise exception '0214: una funzione della chat e'' eseguibile dal sito';
  end if;
  if exists (select 1 from pg_proc where proname in ('chat_ai_spesa_oggi', 'chat_proietta', 'chat_proietta_arretrate')
              and pronamespace = 'public'::regnamespace and (prosecdef or not proconfig @> array['search_path=public'])) then
    raise exception '0214: funzione security definer o senza search_path';
  end if;
  if has_column_privilege('authenticated', 'public.chat_sessioni', 'email_chiesta_at', 'select') then
    raise exception '0214: email_chiesta_at leggibile dal team (non serve)';
  end if;
  select count(*) into v_n from app_flags where key in ('chat_bot_ai_enabled', 'chat_ai_modello', 'chat_ai_tetto_usd_giorno',
    'chat_ai_chiamate_giorno', 'chat_ai_risposte_chat', 'chat_testo_saluto_bot', 'chat_testo_etichetta_ai',
    'chat_testo_chiedi_email', 'chat_testo_informativa_ai');
  if v_n <> 9 then raise exception '0214: flag mancanti (%)', v_n; end if;
end $$;

commit;
