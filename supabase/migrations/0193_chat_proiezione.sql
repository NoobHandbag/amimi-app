-- 0193_chat_proiezione.sql (2026-11-13): chat del sito, Fase 1 pezzo 6 (le chat dentro Assistenza). Proposta:
-- docs/PROPOSTA_chat_sito.md 7.4, 7.5 e 7.6 (opzione A di D-A: stessa lista delle email), con D-8 e D-11. Brief nel repo
-- hub: Cowork12/_CLAUDE_CODE_INBOX/BRIEF_chat_sito_fase1_2026-11-08.md.
--
-- Nessuna tabella nuova. Due funzioni e un cron:
--   1) chat_proietta(sessione): scrive una chat in cs_conversations e cs_messages, la "proiezione" di 7.4. La chiamano
--      chat-api (messaggi della cliente, passaggio) e chat-staff (risposta, prendo_io, chiudi) subito dopo le loro
--      scritture, con la chiave di servizio. Una sola funzione per tutte e due, cosi' la mappa di 7.5 vive in un posto:
--        cs_conversations: gmail_thread_id = 'chat:<sessione>', canale 'chat_sito' (solo alla nascita: una chat messa nel
--        rumore resta nel rumore, e remove_noise la riporta in chat_sito dall'evento ingest), subject fisso, snippet
--        dall'ultimo messaggio della cliente, stato/stato_by/urgente/flags dalla mappa di 7.5 riscritti ogni volta
--        (decide solo chat_sessioni), last_msg_at/last_direction dall'ultimo messaggio (in attesa_persona sempre 'in').
--        La categoria non si tocca mai (la mette lo staff).
--        cs_messages: un messaggio per chat_messaggi con seq > proiettato_seq, tranne gli avvisi `sistema`;
--        gmail_message_id = 'chat:<messaggio>', from_email null, staff con is_via_tool e sent_by = nome.
--      La card nasce al primo messaggio della cliente (testo o bottone) o al primo passaggio (una cliente puo' chiedere
--      una persona senza aver scritto): niente card vuote. Lock della sessione (FOR UPDATE) prima di leggere: il trigger
--      chat_messaggi_ordina prende lo stesso lock prima di dare il seq, quindi chi proietta vede i messaggi nell'ordine dei
--      commit e non ne salta uno. Idempotente (UNIQUE gmail_thread_id e gmail_message_id, on conflict); al massimo 500
--      messaggi per chiamata (Regola 20 c), il resto alla chiamata dopo. Evento cs_events `ingest` con
--      dettaglio.canale = 'chat_sito' alla nascita (lo leggono remove_noise e il ritorno dal B2B di cs-api).
--   2) chat_proietta_arretrate(): la rete di sicurezza di 7.4 ("la richiesta dopo, o un'azione manuale, riproietta"). Se
--      la proiezione dentro una richiesta fallisce, chat_ resta giusta e la chat apparirebbe in Assistenza solo alla
--      richiesta dopo, che puo' non arrivare mai. Ogni 2 minuti riproietta le sessioni indietro (card mancante, messaggi
--      oltre proiettato_seq, stato di cs_ diverso dalla mappa), al massimo 50 per giro; un errore su una sessione non
--      ferma le altre. Scrive un evento chat_eventi `proiezione` solo se ha fatto qualcosa o ha trovato errori.
--      Gira anche a chat spenta: scostamento dichiarato dalla Regola 19 come il giro di chat-send, perche' tiene allineate
--      solo le chat gia' nate (7.4: "quelle gia' in cs_ restano allineate finche' si chiudono"); senza sessioni non fa nulla.
--   3) il cron `chat-proiezione` (minuti pari, una query sola se non c'e' niente da fare).
-- Fermo d'emergenza: select cron.alter_job((select jobid from cron.job where jobname = 'chat-proiezione'), active := false);
-- la proiezione dentro le richieste si ferma solo col flag chat_sito_enabled (niente chat nuove) o togliendo l'RPC.
-- Sicurezza (5.9): funzioni security invoker con search_path fissato, EXECUTE revocato a public, anon e authenticated;
-- chat_proietta eseguibile dal solo service_role (le edge), chat_proietta_arretrate da nessuno (la chiama pg_cron come
-- postgres). Nessuna scrittura in change_log (5.1). Variabili v_* (plpgsql.variable_conflict = error in produzione).
begin;

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
begin
  select * into v_s from chat_sessioni where id = p_sessione for update;
  if not found then
    return jsonb_build_object('esito', 'assente');
  end if;
  select exists (select 1 from chat_messaggi m where m.sessione_id = p_sessione and m.autore = 'cliente') into v_cliente;
  if not v_cliente and v_s.passaggi = 0 and v_s.cs_conversation_id is null then
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

  with nuovi as (
    select m.id, m.seq, m.autore, m.staff_nome, m.testo, m.created_at
      from chat_messaggi m where m.sessione_id = p_sessione and m.seq > v_s.proiettato_seq order by m.seq limit 500
  ), ins as (
    insert into cs_messages (gmail_message_id, conversation_id, direction, sent_by, from_email, to_email, sent_at, body_text,
        body_clean, is_via_tool)
      select 'chat:' || n.id::text, v_cs, case when n.autore = 'cliente' then 'in' else 'out' end,
        case n.autore when 'cliente' then null when 'automatica' then 'Risposta automatica' when 'ai' then 'Assistente AI' else n.staff_nome end,
        null, null, n.created_at, n.testo, n.testo, n.autore = 'staff'
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
     where (s.cs_conversation_id is null
            and (s.passaggi > 0 or exists (select 1 from chat_messaggi m where m.sessione_id = s.id and m.autore = 'cliente')))
        or exists (select 1 from chat_messaggi m where m.sessione_id = s.id and m.seq > s.proiettato_seq and m.autore <> 'sistema')
        or (c.id is not null and c.stato is distinct from
              (case s.stato when 'attesa_persona' then 'da_fare' when 'aperta' then 'in_corso' else 'fatto' end))
     order by s.ultima_attivita_at
     limit 50
  loop
    begin
      perform chat_proietta(v_id);
      v_fatte := v_fatte + 1;
    exception when others then
      v_errori := v_errori + 1;
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

revoke all on function public.chat_proietta(uuid) from public, anon, authenticated;
revoke all on function public.chat_proietta_arretrate() from public, anon, authenticated;
revoke all on function public.chat_proietta_arretrate() from service_role;
grant execute on function public.chat_proietta(uuid) to service_role;

comment on function public.chat_proietta(uuid) is 'Chat del sito: proiezione di una sessione in cs_conversations e cs_messages (PROPOSTA_chat_sito 7.4, 7.5). La chiamano chat-api e chat-staff con la chiave di servizio.';
comment on function public.chat_proietta_arretrate() is 'Chat del sito: riproietta le sessioni rimaste indietro (al massimo 50 per giro). La chiama il cron chat-proiezione.';

select cron.schedule('chat-proiezione', '*/2 * * * *', $cmd$ select public.chat_proietta_arretrate() $cmd$);

-- controllo finale: funzioni, privilegi e cron come dichiarato
do $chk$
declare
  v_f text;
begin
  foreach v_f in array array['public.chat_proietta(uuid)', 'public.chat_proietta_arretrate()'] loop
    if exists (select 1 from pg_proc p where p.oid = v_f::regprocedure and p.prosecdef)
       or not exists (select 1 from pg_proc p where p.oid = v_f::regprocedure and p.proconfig @> array['search_path=public']) then
      raise exception '0193: % deve essere security invoker con search_path=public', v_f;
    end if;
    if has_function_privilege('anon', v_f, 'execute') or has_function_privilege('authenticated', v_f, 'execute') then
      raise exception '0193: % eseguibile da anon o authenticated', v_f;
    end if;
  end loop;
  if has_function_privilege('service_role', 'public.chat_proietta_arretrate()', 'execute') then
    raise exception '0193: chat_proietta_arretrate eseguibile dal service_role';
  end if;
  if not has_function_privilege('service_role', 'public.chat_proietta(uuid)', 'execute') then
    raise exception '0193: chat_proietta non eseguibile dal service_role';
  end if;
  if (select count(*) from cron.job where jobname = 'chat-proiezione' and schedule = '*/2 * * * *'
        and command like '%chat_proietta_arretrate()%' and active) <> 1 then
    raise exception '0193: cron chat-proiezione assente o diverso';
  end if;
end;
$chk$;

commit;
