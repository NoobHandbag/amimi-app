-- 0189_chat_conservazione_push.sql (2026-11-08): chat del sito, Fase 1 pezzo 4 (eventi push), parte della chat. Proposta:
-- docs/PROPOSTA_chat_sito.md 11.5 e 11.6 punto 4 ("il registro delle push tiene chiavi ed esiti senza testi; le righe con
-- la chiave della sessione si cancellano comunque"). Brief nel repo hub: Cowork12/_CLAUDE_CODE_INBOX/BRIEF_chat_sito_fase1_2026-11-08.md.
--
-- chat_conservazione() (0187) toglie anche le righe del registro push_eventi_inviati dei tre eventi della chat della 0188
-- (chat_sollecito, chat_sollecito_scala, chat_salute) con la chiave della sessione (`<sessione>:...`): la stessa funzione
-- della 0187 con un delete e un conteggio `push` in piu' (tests/chat_staff_send.mjs G19 la confronta con la 0187).
-- cancella_dati di chat-staff (staff-2) fa lo stesso. Va applicata DOPO la 0188 (gli eventi). Nessuna tabella, flag o
-- cron; nessuna scrittura in change_log (5.1).
-- Rollback: la funzione della 0187, rimessa con la sua definizione (il delete in piu' tocca solo righe di sessioni gia'
-- cancellate). Rieseguibile: create or replace.
begin;

-- 1) la pulizia giornaliera (0187) toglie anche il registro delle push della chat con la chiave della sessione
create or replace function public.chat_conservazione() returns jsonb
language plpgsql
set search_path to 'public'
as $fn$
declare
  v_raw text;
  v_mesi int := 12;
  v_ids uuid[];
  v_sess int := 0;
  v_cs int := 0;
  v_cont int := 0;
  v_n int := 0;
  v_tok int := 0;
  v_push int := 0;
begin
  select value into v_raw from app_flags where key = 'chat_conservazione_mesi';
  if v_raw ~ '^\s*[0-9]{1,3}\s*$' and trim(v_raw)::int between 1 and 120 then
    v_mesi := trim(v_raw)::int;
  end if;

  select coalesce(array_agg(x.id), '{}') into v_ids
    from (select id from chat_sessioni
           where ultima_attivita_at < now() - make_interval(months => v_mesi)
           order by ultima_attivita_at
           limit 500) x;
  if cardinality(v_ids) > 0 then
    delete from cs_conversations c
     using chat_sessioni s
     where s.id = any(v_ids)
       and (c.id = s.cs_conversation_id or c.gmail_thread_id = 'chat:' || s.id::text);
    get diagnostics v_cs = row_count;
    delete from chat_contatori k
     using unnest(v_ids) u(id)
     where k.chiave like 'sess:' || u.id::text || ':%';
    get diagnostics v_cont = row_count;
    -- le chiavi `<sessione>:...` (prenotazioni di push e del thread Gmail, tetti) se ne vanno con la sessione (11.6)
    delete from chat_eventi e
     using unnest(v_ids) u(id)
     where e.chiave like u.id::text || ':%';
    -- 0189: anche il registro delle push della chat (solleciti, nuovi tentativi, guasti di una chat), 11.6 punto 4
    delete from push_eventi_inviati p
     using unnest(v_ids) u(id)
     where p.evento in ('chat_sollecito', 'chat_sollecito_scala', 'chat_salute')
       and p.chiave like u.id::text || ':%';
    get diagnostics v_push = row_count;
    delete from chat_sessioni where id = any(v_ids);
    get diagnostics v_sess = row_count;
  end if;

  delete from chat_contatori
   where (chiave, finestra) in (select chiave, finestra from chat_contatori
                                 where aggiornato_at < now() - interval '7 days' limit 5000);
  get diagnostics v_n = row_count;
  v_cont := v_cont + v_n;
  delete from chat_token
   where id in (select id from chat_token where scade_at < now() - interval '1 day' limit 5000);
  get diagnostics v_tok = row_count;

  if v_sess + v_cs + v_cont + v_tok + v_push > 0 then
    insert into chat_eventi (tipo, chi, esito, dettaglio)
    values ('conservazione', 'cron', 'fatto',
            jsonb_build_object('mesi', v_mesi, 'sessioni', v_sess, 'proiezioni', v_cs, 'contatori', v_cont, 'token', v_tok, 'push', v_push));
  end if;
  return jsonb_build_object('mesi', v_mesi, 'sessioni', v_sess, 'proiezioni', v_cs, 'contatori', v_cont, 'token', v_tok, 'push', v_push);
end $fn$;

revoke all on function public.chat_conservazione() from public, anon, authenticated;

comment on function public.chat_conservazione() is 'Chat del sito: pulizia giornaliera (11.5), solo conteggi in chat_eventi; dalla 0189 anche il registro delle push della chat. La chiama il cron chat-conservazione.';

-- 2) prova dentro la stessa transazione
do $$
declare
  v_def text := pg_get_functiondef('public.chat_conservazione()'::regprocedure);
begin
  if (select p.prosecdef from pg_proc p where p.oid = 'public.chat_conservazione()'::regprocedure)
     or not exists (select 1 from pg_proc p where p.oid = 'public.chat_conservazione()'::regprocedure and p.proconfig @> array['search_path=public'])
     or has_function_privilege('anon', 'public.chat_conservazione()', 'execute')
     or has_function_privilege('authenticated', 'public.chat_conservazione()', 'execute') then
    raise exception '0189: chat_conservazione deve restare invoker, con search_path=public, non eseguibile da anon e authenticated';
  end if;
  if position('delete from push_eventi_inviati p' in v_def) = 0 or position('''push'', v_push' in v_def) = 0
     or position('delete from chat_eventi e' in v_def) = 0 or position('limit 500' in v_def) = 0 then
    raise exception '0189: chat_conservazione senza la pulizia del registro delle push o senza le parti della 0187';
  end if;
  if (select count(*) from push_eventi where evento in ('chat_sollecito', 'chat_sollecito_scala', 'chat_salute')) <> 3 then
    raise exception '0189: mancano gli eventi della chat della 0188 (applicare prima la 0188)';
  end if;
  if (select count(*) from cron.job where jobname = 'chat-conservazione' and schedule = '47 3 * * *'
        and command like '%public.chat_conservazione()%' and active) <> 1 then
    raise exception '0189: cron chat-conservazione assente o diverso';
  end if;
  if exists (select 1 from change_log where tbl like 'chat\_%' and ts > now() - interval '1 minute') then
    raise exception '0189: righe della chat in change_log';
  end if;
end $$;

commit;
