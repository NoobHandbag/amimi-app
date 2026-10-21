-- 0168_push_attivita.sql (2026-10-21): evento attivita_team del modulo push_* (Regola Ferrea 19), OK di Dan in chat del
-- 21-10: "vorrei anche esser notificato quando le ragazze fanno operazioni tipo registra ordine, pezzi arrivati, e conta
-- fisica". La edge push-eventi v3 legge change_log (order_multi, arrival_set, count_apply di Benny e Ginni, core in sola
-- lettura) e manda UNA push per persona e tipo di operazione a ogni giro, sul tema nuovo `attivita`.
--
-- Nasce SPENTO: l'evento ha attivo = false e lo accende Claude Code dopo il deploy della edge e la sua anteprima.
-- Rollback = attivo a false (o push_eventi_enabled a 'false' per tutto il modulo), senza deploy. Nessun flag cambia:
-- push_enabled e push_eventi_enabled restano come sono (la prova finale lo controlla).
--
-- Solo tabelle push_* (tema, evento, temi dei telefoni) e, del core, una riga di change_log per ogni telefono a cui si
-- aggiunge il tema, come la 0166 al passo 8. Nessuna tabella nuova: RLS, privilegi e registro sono quelli della 0166.
-- Rieseguibile: tema ed evento nascono con on conflict do nothing, il tema si aggiunge ai telefoni solo se e' nato in
-- questa esecuzione (un re-run non rimette un tema tolto dal telefono nel frattempo) e la prova pretende i valori di
-- nascita solo da quello che e' nato qui.
-- Nessun `return` nei blocchi DO (MIG-C2 della 0166): nella prova annullata prima dell'apply ogni DO diventa un blocco
-- annidato, e un return salterebbe il resto e l'eccezione finale.
begin;

-- 0) cio' che la migrazione NON deve cambiare, letto prima di tutto
do $$ begin
  perform set_config('amimi.push_attivita_push_enabled_prima', coalesce((select value from app_flags where key = 'push_enabled'), '<assente>'), true);
  perform set_config('amimi.push_attivita_eventi_enabled_prima', coalesce((select value from app_flags where key = 'push_eventi_enabled'), '<assente>'), true);
end $$;

-- 1) tema nuovo: parte spuntato per la sola Ale alla prima iscrizione di un telefono (scheda Notifiche, predefinito_per
--    della 0166). ordine 80, dopo il riepilogo (70), a passi di 10 come la 0163.
do $$ begin
  insert into push_temi (key, etichetta, descrizione, ordine, predefinito_per) values
    ('attivita', 'Attività del team', 'Quando Benny o Ginni registrano ordini, arrivi o conte', 80, array['Ale'])
  on conflict (key) do nothing;
  perform set_config('amimi.push_attivita_tema_nato_qui', found::text, true);
end $$;

-- 2) l'evento, spento
do $$ begin
  insert into push_eventi (evento, tema, attivo, descrizione) values
    ('attivita_team', 'attivita', false, 'Benny o Ginni registrano un ordine fornitore, un arrivo o una conta (change_log order_multi, arrival_set, count_apply): una push per persona e tipo di operazione a ogni giro')
  on conflict (evento) do nothing;
  perform set_config('amimi.push_attivita_evento_nato_qui', found::text, true);
end $$;

-- 3) i telefoni gia' iscritti del profilo a cui il tema spetta (oggi il solo Android di Ale) lo ricevono, come se si
--    iscrivessero oggi: si aggiunge in fondo e basta, le scelte gia' fatte restano. Solo se il tema e' nato qui.
--    change_log tiene il prima e il dopo (solo i temi), una riga per telefono.
--    Gate 2 del 21-10 (R2): nella stessa istruzione si contano, ognuno per conto suo, i telefoni del profilo senza il tema
--    (con un filtro scritto in un altro modo, @> invece di any), quelli aggiornati e le righe di change_log scritte: la
--    prova finale pretende che i tre numeri coincidano. Prima il conteggio veniva dall'insert stesso e il controllo non
--    poteva mai fallire. Stessa istruzione = stessa fotografia dei dati, quindi un telefono iscritto nel frattempo non
--    fa fallire la migrazione per niente.
do $$
declare
  v_attesi int := 0;
  v_aggiornati int := 0;
  v_log int := 0;
begin
  if current_setting('amimi.push_attivita_tema_nato_qui', true) = 'true' then
    with prima as (
      select s.id, s.temi from push_subscriptions s
       where exists (select 1 from push_temi t where t.key = 'attivita' and s.chi = any(t.predefinito_per))
         and not ('attivita' = any(s.temi))
       for update),
    agg as (
      update push_subscriptions s
         set temi = s.temi || array['attivita'],
             updated_at = now()
        from prima p
       where s.id = p.id
      returning s.id, p.temi as temi_prima, s.temi as temi_dopo),
    ins as (
      insert into change_log (tbl, row_id, op, before, after, chi, source)
      select 'push_subscriptions', id::text, 'temi_aggiunti', jsonb_build_object('temi', temi_prima),
             jsonb_build_object('temi', temi_dopo, 'migr', '0168_push_attivita'), 'claude-code', 'push-eventi'
        from agg
      returning 1)
    select (select count(*) from push_subscriptions s
             where exists (select 1 from push_temi t where t.key = 'attivita' and t.predefinito_per @> array[s.chi])
               and not (s.temi @> array['attivita'])),
           (select count(*) from agg), (select count(*) from ins)
      into v_attesi, v_aggiornati, v_log;
  end if;
  perform set_config('amimi.push_attivita_telefoni_attesi', v_attesi::text, true);
  perform set_config('amimi.push_attivita_telefoni_aggiornati', v_aggiornati::text, true);
  perform set_config('amimi.push_attivita_righe_log', v_log::text, true);
end $$;

-- 4) prova dentro la stessa transazione: se qualcosa non torna la migrazione non passa
do $$
declare
  v_tema_nato boolean := current_setting('amimi.push_attivita_tema_nato_qui', true) = 'true';
  v_evento_nato boolean := current_setting('amimi.push_attivita_evento_nato_qui', true) = 'true';
  v_attesi int := coalesce(nullif(current_setting('amimi.push_attivita_telefoni_attesi', true), '')::int, -1);
  v_aggiornati int := coalesce(nullif(current_setting('amimi.push_attivita_telefoni_aggiornati', true), '')::int, -1);
  v_log int := coalesce(nullif(current_setting('amimi.push_attivita_righe_log', true), '')::int, -1);
begin
  if current_setting('amimi.push_attivita_tema_nato_qui', true) is null or current_setting('amimi.push_attivita_evento_nato_qui', true) is null
     or current_setting('amimi.push_attivita_push_enabled_prima', true) is null or current_setting('amimi.push_attivita_eventi_enabled_prima', true) is null
     or v_attesi < 0 or v_aggiornati < 0 or v_log < 0 then
    raise exception '0168: manca una lettura iniziale (cosa e'' nato in questa migrazione)';
  end if;

  -- tema: c'e'; nato qui = attivo, per la sola Ale, con etichetta e descrizione del contratto
  if not exists (select 1 from push_temi where key = 'attivita') then
    raise exception '0168: manca il tema attivita';
  end if;
  if v_tema_nato and not exists (select 1 from push_temi where key = 'attivita' and attivo and predefinito_per = array['Ale']
                                   and etichetta = 'Attività del team' and descrizione = 'Quando Benny o Ginni registrano ordini, arrivi o conte' and ordine = 80) then
    raise exception '0168: il tema attivita nato qui non e'' attivo, non e'' della sola Ale o ha testi diversi dal contratto';
  end if;

  -- evento: c'e', sul tema attivita; nato qui = spento, senza soglie, mai girato
  if not exists (select 1 from push_eventi where evento = 'attivita_team' and tema = 'attivita') then
    raise exception '0168: manca l''evento attivita_team sul tema attivita';
  end if;
  if v_evento_nato and not exists (select 1 from push_eventi where evento = 'attivita_team' and attivo = false and soglie = '{}'::jsonb
                                     and baseline_at is null and ultimo_giro_at is null) then
    raise exception '0168: l''evento attivita_team nato qui non e'' spento, ha soglie o un giro';
  end if;

  -- telefoni: col tema nato qui ogni telefono del profilo lo ha, nessuno fuori dal profilo lo ha, aggiornati = attesi =
  -- righe di change_log (contati nella stessa istruzione del passo 3), ogni riga di change_log dice dopo = prima + attivita,
  -- nessun tema doppio
  if v_tema_nato and exists (select 1 from push_subscriptions s join push_temi t on t.key = 'attivita' and s.chi = any(t.predefinito_per)
                              where not ('attivita' = any(s.temi))) then
    raise exception '0168: un telefono del profilo non ha ricevuto il tema attivita';
  end if;
  if v_tema_nato and exists (select 1 from push_subscriptions s where 'attivita' = any(s.temi)
                              and not exists (select 1 from push_temi t where t.key = 'attivita' and s.chi = any(t.predefinito_per))) then
    raise exception '0168: un telefono fuori dal profilo ha il tema attivita';
  end if;
  if v_tema_nato and (v_aggiornati <> v_attesi or v_log <> v_aggiornati) then
    raise exception '0168: % telefoni del profilo senza il tema, % aggiornati, % righe di change_log', v_attesi, v_aggiornati, v_log;
  end if;
  if exists (select 1 from change_log where tbl = 'push_subscriptions' and op = 'temi_aggiunti' and after->>'migr' = '0168_push_attivita'
              and (after->'temi') is distinct from ((before->'temi') || '["attivita"]'::jsonb)) then
    raise exception '0168: una riga di change_log non ha dopo = prima + attivita';
  end if;
  if exists (select 1 from push_subscriptions s where cardinality(s.temi) <> (select count(distinct x) from unnest(s.temi) x)) then
    raise exception '0168: un telefono iscritto ha un tema doppio';
  end if;

  -- interruttori: nessuno cambia
  if coalesce((select value from app_flags where key = 'push_enabled'), '<assente>') is distinct from current_setting('amimi.push_attivita_push_enabled_prima', true)
     or coalesce((select value from app_flags where key = 'push_eventi_enabled'), '<assente>') is distinct from current_setting('amimi.push_attivita_eventi_enabled_prima', true) then
    raise exception '0168: push_enabled o push_eventi_enabled cambiati dalla migrazione';
  end if;
end $$;

commit;
