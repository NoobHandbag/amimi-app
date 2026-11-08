-- 0187_chat_invio.sql (2026-11-08): chat del sito, Fase 1 pezzo 3 (chat-staff e chat-send). Proposta:
-- docs/PROPOSTA_chat_sito.md 6.5, 7.3, 7.9 e 11.5, con D-8 (ogni risposta dello staff parte subito per email). Brief nel
-- repo hub: Cowork12/_CLAUDE_CODE_INBOX/BRIEF_chat_sito_fase1_2026-11-08.md.
--
-- Due cose, nessuna tabella nuova:
--   1) chat_conservazione(): la pulizia giornaliera di 11.5. Cancella le chat ferme da piu' di `chat_conservazione_mesi`
--      mesi (app_flags, 12 alla nascita; D-25 aperta: il valore si cambia dalla scheda Chat senza migrazione; un valore
--      illeggibile o fuori da 1-120 vale 12), con la loro proiezione in cs_ (chiave chat:<id>, 7.4) e i contatori della
--      sessione e gli eventi con la chiave della sessione; poi i contatori fermi da oltre 7 giorni (5.6) e i token scaduti da oltre un giorno (solo hash). Al
--      massimo 500 chat per giro (7.3 c). Registra solo conteggi in chat_eventi. Gira anche a chat spenta, scostamento
--      dichiarato dalla Regola 19 (cron NO-OP a flag spento): la durata dichiarata ai sensi del GDPR (art. 5(1)(e)) vale
--      per i dati gia' raccolti, accesa o spenta che sia la chat. La card email della risposta della cliente (thread di
--      chat-send) e' posta normale di Assistenza e resta fuori, come le altre email.
--   2) i cron: `chat-send` ogni 5 minuti (rete di sicurezza: l'email parte subito da chat-staff; il giro manda quelle
--      rimaste indietro da oltre 2 minuti, chiude come esito ignoto le prenotazioni ferme da 15, scrive health_log
--      `chat_send`; gira anche a chat spenta, perche' finisce solo consegne avviate da una persona) col PIN neutro di tutti i cron, e `chat-conservazione` ogni giorno alle 03:47 UTC.
--      Minuti 3, 8, 13...: fuori da push-eventi (1, 6, 11...), da cs-classify (multipli di 5) e dai giri orari; cs-sync
--      ogni 2 minuti non si puo' evitare. timeout 60 s: un giro manda fino a 20 email una dopo l'altra.
-- Fermo d'emergenza: select cron.alter_job((select jobid from cron.job where jobname = 'chat-send'), active := false);
-- l'email immediata di chat-staff si ferma solo togliendo chat-send. Rollback della pulizia: alter_job su
-- 'chat-conservazione' (la funzione da sola non gira).
-- Sicurezza (5.9): funzione security invoker con search_path fissato, EXECUTE revocato a public, anon e authenticated
-- (la chiama solo pg_cron, come postgres). Nessuna scrittura in change_log (5.1).
begin;

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

  if v_sess + v_cs + v_cont + v_tok > 0 then
    insert into chat_eventi (tipo, chi, esito, dettaglio)
    values ('conservazione', 'cron', 'fatto',
            jsonb_build_object('mesi', v_mesi, 'sessioni', v_sess, 'proiezioni', v_cs, 'contatori', v_cont, 'token', v_tok));
  end if;
  return jsonb_build_object('mesi', v_mesi, 'sessioni', v_sess, 'proiezioni', v_cs, 'contatori', v_cont, 'token', v_tok);
end $fn$;

revoke all on function public.chat_conservazione() from public, anon, authenticated;

comment on function public.chat_conservazione() is 'Chat del sito: pulizia giornaliera (11.5), solo conteggi in chat_eventi. La chiama il cron chat-conservazione.';

select cron.schedule('chat-send', '3,8,13,18,23,28,33,38,43,48,53,58 * * * *',
  $cmd$ select net.http_post(
       url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/chat-send',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"action":"giro","pin":"x"}'::jsonb,
       timeout_milliseconds := 60000
     ) $cmd$);

select cron.schedule('chat-conservazione', '47 3 * * *', $cmd$ select public.chat_conservazione() $cmd$);

-- prova dentro la stessa transazione
do $$
begin
  if to_regprocedure('public.chat_conservazione()') is null then
    raise exception '0187: manca chat_conservazione()';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.chat_conservazione()'::regprocedure)
     or not exists (select 1 from pg_proc p where p.oid = 'public.chat_conservazione()'::regprocedure and p.proconfig @> array['search_path=public']) then
    raise exception '0187: chat_conservazione deve essere security invoker con search_path=public';
  end if;
  if has_function_privilege('anon', 'public.chat_conservazione()', 'execute')
     or has_function_privilege('authenticated', 'public.chat_conservazione()', 'execute') then
    raise exception '0187: anon o authenticated possono eseguire chat_conservazione';
  end if;
  if (select count(*) from cron.job where jobname = 'chat-send' and schedule = '3,8,13,18,23,28,33,38,43,48,53,58 * * * *'
        and command like '%/functions/v1/chat-send%' and command like '%"action":"giro"%' and active) <> 1 then
    raise exception '0187: cron chat-send assente o diverso';
  end if;
  if (select count(*) from cron.job where jobname = 'chat-conservazione' and schedule = '47 3 * * *'
        and command like '%public.chat_conservazione()%' and active) <> 1 then
    raise exception '0187: cron chat-conservazione assente o diverso';
  end if;
  if exists (select 1 from change_log where tbl like 'chat\_%' and ts > now() - interval '1 minute') then
    raise exception '0187: righe della chat in change_log';
  end if;
end $$;

commit;
