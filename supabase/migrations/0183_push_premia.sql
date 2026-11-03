-- 0183_push_premia.sql (2026-11-03): notifiche dell'Area Membri (Premia) del modulo push_* (Regola Ferrea 19), decisione
-- di Dan del 03-11 (CONOSCENZA sez. 1, "Notifiche dell'Area Membri"): ogni look o recensione da approvare e' una push a
-- Ginni, che modera; gli errori del modulo (loyalty_orders in errore, riscatto pending oltre 15 minuti, pool sotto
-- soglia) vanno sul tema sistema; le nuove iscritte solo nel riepilogo serale. La edge push-eventi v5 legge loyalty_ugc,
-- loyalty_redemptions, loyalty_visits, v_loyalty_pool e la riga loyalty_orders di health_log, in sola lettura.
--
-- Nascono SPENTI: i due eventi hanno attivo = false e li accende Claude Code dopo il deploy della edge e la sua anteprima.
-- Rollback = attivo a false (o push_eventi_enabled a 'false' per tutto il modulo), senza deploy. Nessun flag cambia.
--
-- Solo tabelle push_* (tema, eventi, temi dei telefoni) e, del core, una riga di change_log per ogni telefono a cui si
-- aggiunge il tema, come la 0168. Nessuna tabella nuova: RLS, privilegi e registro sono quelli della 0166.
-- Rieseguibile: tema ed eventi nascono con on conflict do nothing, il tema si aggiunge ai telefoni solo se e' nato in
-- questa esecuzione e la prova pretende i valori di nascita solo da quello che e' nato qui. Al 03-11 Ginni non ha un
-- telefono iscritto: il passo 3 non aggiorna niente, e il tema le parte spuntato quando iscrive il suo (predefinito_per).
-- Nessun `return` nei blocchi DO (MIG-C2 della 0166).
begin;

-- 0) cio' che la migrazione NON deve cambiare, letto prima di tutto
do $$ begin
  perform set_config('amimi.push_premia_push_enabled_prima', coalesce((select value from app_flags where key = 'push_enabled'), '<assente>'), true);
  perform set_config('amimi.push_premia_eventi_enabled_prima', coalesce((select value from app_flags where key = 'push_eventi_enabled'), '<assente>'), true);
end $$;

-- 1) tema nuovo: spuntato per la sola Ginni alla prima iscrizione di un telefono. ordine 90, dopo attivita (80).
do $$ begin
  insert into push_temi (key, etichetta, descrizione, ordine, predefinito_per) values
    ('premia', 'Area Membri da approvare', 'Ogni look o recensione nuova da approvare nell''Area Membri', 90, array['Ginevra'])
  on conflict (key) do nothing;
  perform set_config('amimi.push_premia_tema_nato_qui', found::text, true);
end $$;

-- 2) i due eventi, spenti
do $$
declare
  v_n int;
begin
  insert into push_eventi (evento, tema, attivo, descrizione) values
    ('premia_da_approvare', 'premia', false, 'Un look o una recensione entra in moderazione (loyalty_ugc in_revisione): una push per contenuto'),
    ('premia_salute', 'sistema', false, 'Premia guasto: loyalty_orders in errore, riscatto pending oltre 15 minuti, pool di codici sotto loyalty_pool_min')
  on conflict (evento) do nothing;
  get diagnostics v_n = row_count;
  perform set_config('amimi.push_premia_eventi_nati_qui', v_n::text, true);
end $$;

-- 3) i telefoni gia' iscritti del profilo a cui il tema spetta lo ricevono in fondo, solo se il tema e' nato qui; una
--    riga di change_log per telefono. Attesi, aggiornati e righe di change_log contati nella stessa istruzione (0168, R2).
do $$
declare
  v_attesi int := 0;
  v_aggiornati int := 0;
  v_log int := 0;
begin
  if current_setting('amimi.push_premia_tema_nato_qui', true) = 'true' then
    with prima as (
      select s.id, s.temi from push_subscriptions s
       where exists (select 1 from push_temi t where t.key = 'premia' and s.chi = any(t.predefinito_per))
         and not ('premia' = any(s.temi))
       for update),
    agg as (
      update push_subscriptions s
         set temi = s.temi || array['premia'],
             updated_at = now()
        from prima p
       where s.id = p.id
      returning s.id, p.temi as temi_prima, s.temi as temi_dopo),
    ins as (
      insert into change_log (tbl, row_id, op, before, after, chi, source)
      select 'push_subscriptions', id::text, 'temi_aggiunti', jsonb_build_object('temi', temi_prima),
             jsonb_build_object('temi', temi_dopo, 'migr', '0183_push_premia'), 'claude-code', 'push-eventi'
        from agg
      returning 1)
    select (select count(*) from push_subscriptions s
             where exists (select 1 from push_temi t where t.key = 'premia' and t.predefinito_per @> array[s.chi])
               and not (s.temi @> array['premia'])),
           (select count(*) from agg), (select count(*) from ins)
      into v_attesi, v_aggiornati, v_log;
  end if;
  perform set_config('amimi.push_premia_telefoni_attesi', v_attesi::text, true);
  perform set_config('amimi.push_premia_telefoni_aggiornati', v_aggiornati::text, true);
  perform set_config('amimi.push_premia_righe_log', v_log::text, true);
end $$;

-- 4) prova dentro la stessa transazione
do $$
declare
  v_tema_nato boolean := current_setting('amimi.push_premia_tema_nato_qui', true) = 'true';
  v_eventi_nati int := coalesce(nullif(current_setting('amimi.push_premia_eventi_nati_qui', true), '')::int, -1);
  v_attesi int := coalesce(nullif(current_setting('amimi.push_premia_telefoni_attesi', true), '')::int, -1);
  v_aggiornati int := coalesce(nullif(current_setting('amimi.push_premia_telefoni_aggiornati', true), '')::int, -1);
  v_log int := coalesce(nullif(current_setting('amimi.push_premia_righe_log', true), '')::int, -1);
begin
  if current_setting('amimi.push_premia_tema_nato_qui', true) is null or v_eventi_nati < 0
     or current_setting('amimi.push_premia_push_enabled_prima', true) is null or current_setting('amimi.push_premia_eventi_enabled_prima', true) is null
     or v_attesi < 0 or v_aggiornati < 0 or v_log < 0 then
    raise exception '0183: manca una lettura iniziale (cosa e'' nato in questa migrazione)';
  end if;

  if not exists (select 1 from push_temi where key = 'premia') then
    raise exception '0183: manca il tema premia';
  end if;
  if v_tema_nato and not exists (select 1 from push_temi where key = 'premia' and attivo and predefinito_per = array['Ginevra']
                                   and etichetta = 'Area Membri da approvare' and descrizione = 'Ogni look o recensione nuova da approvare nell''Area Membri' and ordine = 90) then
    raise exception '0183: il tema premia nato qui non e'' attivo, non e'' della sola Ginni o ha testi diversi dal contratto';
  end if;

  if not exists (select 1 from push_eventi where evento = 'premia_da_approvare' and tema = 'premia')
     or not exists (select 1 from push_eventi where evento = 'premia_salute' and tema = 'sistema') then
    raise exception '0183: manca premia_da_approvare sul tema premia o premia_salute sul tema sistema';
  end if;
  if v_eventi_nati = 2 and exists (select 1 from push_eventi where evento in ('premia_da_approvare', 'premia_salute')
                                     and (attivo or soglie <> '{}'::jsonb or baseline_at is not null or ultimo_giro_at is not null)) then
    raise exception '0183: un evento nato qui non e'' spento, ha soglie o un giro';
  end if;

  if v_tema_nato and exists (select 1 from push_subscriptions s join push_temi t on t.key = 'premia' and s.chi = any(t.predefinito_per)
                              where not ('premia' = any(s.temi))) then
    raise exception '0183: un telefono del profilo non ha ricevuto il tema premia';
  end if;
  if v_tema_nato and exists (select 1 from push_subscriptions s where 'premia' = any(s.temi)
                              and not exists (select 1 from push_temi t where t.key = 'premia' and s.chi = any(t.predefinito_per))) then
    raise exception '0183: un telefono fuori dal profilo ha il tema premia';
  end if;
  if v_tema_nato and (v_aggiornati <> v_attesi or v_log <> v_aggiornati) then
    raise exception '0183: % telefoni del profilo senza il tema, % aggiornati, % righe di change_log', v_attesi, v_aggiornati, v_log;
  end if;
  if exists (select 1 from push_subscriptions s where cardinality(s.temi) <> (select count(distinct x) from unnest(s.temi) x)) then
    raise exception '0183: un telefono iscritto ha un tema doppio';
  end if;

  if coalesce((select value from app_flags where key = 'push_enabled'), '<assente>') is distinct from current_setting('amimi.push_premia_push_enabled_prima', true)
     or coalesce((select value from app_flags where key = 'push_eventi_enabled'), '<assente>') is distinct from current_setting('amimi.push_premia_eventi_enabled_prima', true) then
    raise exception '0183: push_enabled o push_eventi_enabled cambiati dalla migrazione';
  end if;
end $$;

commit;
