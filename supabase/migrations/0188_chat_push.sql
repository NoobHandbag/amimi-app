-- 0188_chat_push.sql (2026-11-08): chat del sito, Fase 1 pezzo 4 (eventi push). Proposta: docs/PROPOSTA_chat_sito.md
-- 8.3-8.6 e 8.10, con le decisioni di Dan D-1 (secondo sollecito ad Ale su un tema di scala separato), D-8 (24 e 48 ore
-- contate nei giorni lavorativi di chat_orari), D-9 (nome o email nel testo) e D-12 (soglia di 5.000 richieste al
-- giorno). Brief nel repo hub: Cowork12/_CLAUDE_CODE_INBOX/BRIEF_chat_sito_fase1_2026-11-08.md.
--
-- Modulo push_* (Regola Ferrea 19), nessuna tabella nuova; la chat (chat_*) qui non si tocca:
--  1) tema nuovo assistenza_scala ("Assistenza, chat senza risposta"), spuntato per la sola Ale alla prima iscrizione
--     (predefinito_per), ordine 45 (dopo assistenza);
--  2) tre eventi SPENTI per la edge push-eventi v7: chat_sollecito (tema assistenza, passo 1 e nuovo tentativo della push
--     di passaggio), chat_sollecito_scala (tema assistenza_scala, passo 2), chat_salute (tema sistema, guasti della chat).
--     Li accende Claude Code dopo il deploy della edge e la sua anteprima, PRIMA di chat_sito_enabled (8.3);
--  3) i telefoni gia' iscritti del profilo a cui il tema spetta (Ale) lo ricevono in fondo, solo se il tema e' nato qui,
--     con una riga di change_log per telefono (come la 0168 e la 0183): D-1 vuole il secondo sollecito ad Ale da subito.
--     La riga di change_log e' del telefono, non della chat: per questo la pulizia della chat (che tocca chat_*, dove
--     change_log e' vietato, R7 di tests/chat_guardie.mjs) sta nella 0189.
-- Rollback: attivo a false sui tre eventi (senza deploy). Il tema puo' restare: senza eventi accesi non manda.
-- Nessun flag, nessun cron cambiano. Rieseguibile: tema ed eventi con on conflict do nothing, il tema si aggiunge ai
-- telefoni solo se e' nato in questa esecuzione e la prova pretende i valori di nascita solo da cio' che e' nato qui.
-- Nessun `return` nei blocchi DO (MIG-C2 della 0166); variabili v_* (in produzione plpgsql.variable_conflict = error).
begin;

-- 0) cio' che la migrazione NON deve cambiare, letto prima di tutto
do $$ begin
  perform set_config('amimi.chat_push_push_enabled_prima', coalesce((select value from app_flags where key = 'push_enabled'), '<assente>'), true);
  perform set_config('amimi.chat_push_eventi_enabled_prima', coalesce((select value from app_flags where key = 'push_eventi_enabled'), '<assente>'), true);
  perform set_config('amimi.chat_push_chat_enabled_prima', coalesce((select value from app_flags where key = 'chat_sito_enabled'), '<assente>'), true);
  perform set_config('amimi.chat_push_cron_prima', coalesce((select string_agg(jobname || ' ' || schedule || ' ' || active::text, '; ' order by jobname)
    from cron.job where jobname in ('push-eventi', 'push-eventi-salute', 'chat-send', 'chat-conservazione')), '<assente>'), true);
end $$;

-- 1) tema di scala: per la sola Ale alla prima iscrizione di un telefono
do $$ begin
  insert into push_temi (key, etichetta, descrizione, ordine, predefinito_per) values
    ('assistenza_scala', 'Assistenza, chat senza risposta', 'Quando una chat del sito resta senza risposta del team anche dopo il primo promemoria', 45, array['Ale'])
  on conflict (key) do nothing;
  perform set_config('amimi.chat_push_tema_nato_qui', found::text, true);
end $$;

-- 2) i tre eventi, spenti
do $$
declare
  v_n int;
begin
  insert into push_eventi (evento, tema, attivo, descrizione) values
    ('chat_sollecito', 'assistenza', false, 'Chat del sito senza risposta del team dopo il primo passo di chat_sollecito_ore (ore nei giorni lavorativi), e nuovo tentativo della push di passaggio fallita'),
    ('chat_sollecito_scala', 'assistenza_scala', false, 'Chat del sito ancora senza risposta al secondo passo di chat_sollecito_ore: il promemoria ad Ale'),
    ('chat_salute', 'sistema', false, 'Guasti della chat del sito: push di passaggio a nessuno, email di risposta non partite o in coda, chat-api in errore, tetti e soglie')
  on conflict (evento) do nothing;
  get diagnostics v_n = row_count;
  perform set_config('amimi.chat_push_eventi_nati_qui', v_n::text, true);
end $$;

-- 3) i telefoni gia' iscritti del profilo a cui il tema spetta lo ricevono in fondo, solo se il tema e' nato qui; una
--    riga di change_log per telefono. Attesi, aggiornati e righe di change_log contati nella stessa istruzione (0168, R2).
do $$
declare
  v_attesi int := 0;
  v_aggiornati int := 0;
  v_log int := 0;
begin
  if current_setting('amimi.chat_push_tema_nato_qui', true) = 'true' then
    with prima as (
      select s.id, s.temi from push_subscriptions s
       where exists (select 1 from push_temi t where t.key = 'assistenza_scala' and s.chi = any(t.predefinito_per))
         and not ('assistenza_scala' = any(s.temi))
       for update),
    agg as (
      update push_subscriptions s
         set temi = s.temi || array['assistenza_scala'],
             updated_at = now()
        from prima p
       where s.id = p.id
      returning s.id, p.temi as temi_prima, s.temi as temi_dopo),
    ins as (
      insert into change_log (tbl, row_id, op, before, after, chi, source)
      select 'push_subscriptions', id::text, 'temi_aggiunti', jsonb_build_object('temi', temi_prima),
             jsonb_build_object('temi', temi_dopo, 'migr', '0188_chat_push'), 'claude-code', 'push-eventi'
        from agg
      returning 1)
    select (select count(*) from push_subscriptions s
             where exists (select 1 from push_temi t where t.key = 'assistenza_scala' and t.predefinito_per @> array[s.chi])
               and not (s.temi @> array['assistenza_scala'])),
           (select count(*) from agg), (select count(*) from ins)
      into v_attesi, v_aggiornati, v_log;
  end if;
  perform set_config('amimi.chat_push_telefoni_attesi', v_attesi::text, true);
  perform set_config('amimi.chat_push_telefoni_aggiornati', v_aggiornati::text, true);
  perform set_config('amimi.chat_push_righe_log', v_log::text, true);
end $$;

-- 4) prova dentro la stessa transazione
do $$
declare
  v_tema_nato boolean := current_setting('amimi.chat_push_tema_nato_qui', true) = 'true';
  v_eventi_nati int := coalesce(nullif(current_setting('amimi.chat_push_eventi_nati_qui', true), '')::int, -1);
  v_attesi int := coalesce(nullif(current_setting('amimi.chat_push_telefoni_attesi', true), '')::int, -1);
  v_aggiornati int := coalesce(nullif(current_setting('amimi.chat_push_telefoni_aggiornati', true), '')::int, -1);
  v_log int := coalesce(nullif(current_setting('amimi.chat_push_righe_log', true), '')::int, -1);
begin
  if current_setting('amimi.chat_push_tema_nato_qui', true) is null or v_eventi_nati < 0
     or current_setting('amimi.chat_push_push_enabled_prima', true) is null or current_setting('amimi.chat_push_eventi_enabled_prima', true) is null
     or current_setting('amimi.chat_push_chat_enabled_prima', true) is null or current_setting('amimi.chat_push_cron_prima', true) is null
     or v_attesi < 0 or v_aggiornati < 0 or v_log < 0 then
    raise exception '0188: manca una lettura iniziale (cosa e'' nato in questa migrazione)';
  end if;

  if not exists (select 1 from push_temi where key = 'assistenza_scala') then
    raise exception '0188: manca il tema assistenza_scala';
  end if;
  if v_tema_nato and not exists (select 1 from push_temi where key = 'assistenza_scala' and attivo and predefinito_per = array['Ale']
                                   and etichetta = 'Assistenza, chat senza risposta' and ordine = 45) then
    raise exception '0188: il tema assistenza_scala nato qui non e'' attivo, non e'' della sola Ale o ha testi diversi dal contratto';
  end if;

  if not exists (select 1 from push_eventi where evento = 'chat_sollecito' and tema = 'assistenza')
     or not exists (select 1 from push_eventi where evento = 'chat_sollecito_scala' and tema = 'assistenza_scala')
     or not exists (select 1 from push_eventi where evento = 'chat_salute' and tema = 'sistema') then
    raise exception '0188: manca un evento della chat sul suo tema';
  end if;
  if v_eventi_nati = 3 and exists (select 1 from push_eventi where evento in ('chat_sollecito', 'chat_sollecito_scala', 'chat_salute')
                                     and (attivo or soglie <> '{}'::jsonb or baseline_at is not null or ultimo_giro_at is not null)) then
    raise exception '0188: un evento nato qui non e'' spento, ha soglie o un giro';
  end if;

  if v_tema_nato and exists (select 1 from push_subscriptions s join push_temi t on t.key = 'assistenza_scala' and s.chi = any(t.predefinito_per)
                              where not ('assistenza_scala' = any(s.temi))) then
    raise exception '0188: un telefono del profilo non ha ricevuto il tema assistenza_scala';
  end if;
  if v_tema_nato and exists (select 1 from push_subscriptions s where 'assistenza_scala' = any(s.temi)
                              and not exists (select 1 from push_temi t where t.key = 'assistenza_scala' and s.chi = any(t.predefinito_per))) then
    raise exception '0188: un telefono fuori dal profilo ha il tema assistenza_scala';
  end if;
  if v_tema_nato and (v_aggiornati <> v_attesi or v_log <> v_aggiornati) then
    raise exception '0188: % telefoni del profilo senza il tema, % aggiornati, % righe di change_log', v_attesi, v_aggiornati, v_log;
  end if;
  if exists (select 1 from push_subscriptions s where cardinality(s.temi) <> (select count(distinct x) from unnest(s.temi) x)) then
    raise exception '0188: un telefono iscritto ha un tema doppio';
  end if;

  if coalesce((select value from app_flags where key = 'push_enabled'), '<assente>') is distinct from current_setting('amimi.chat_push_push_enabled_prima', true)
     or coalesce((select value from app_flags where key = 'push_eventi_enabled'), '<assente>') is distinct from current_setting('amimi.chat_push_eventi_enabled_prima', true)
     or coalesce((select value from app_flags where key = 'chat_sito_enabled'), '<assente>') is distinct from current_setting('amimi.chat_push_chat_enabled_prima', true)
     or coalesce((select string_agg(jobname || ' ' || schedule || ' ' || active::text, '; ' order by jobname)
                    from cron.job where jobname in ('push-eventi', 'push-eventi-salute', 'chat-send', 'chat-conservazione')), '<assente>')
        is distinct from current_setting('amimi.chat_push_cron_prima', true) then
    raise exception '0188: un flag (push_enabled, push_eventi_enabled, chat_sito_enabled) o un cron cambiati dalla migrazione';
  end if;
  if exists (select 1 from change_log where ts > now() - interval '1 minute' and source = 'push-eventi' and tbl <> 'push_subscriptions') then
    raise exception '0188: righe di change_log fuori dai telefoni';
  end if;
end $$;

commit;
