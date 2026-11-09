-- 0191_push_stock_fermo.sql (2026-11-09): notifica dei pezzi fermi non in vendita, chiesta da Dan in chat ("Si', la push")
-- dopo l'allarme in Home della 0190. Evento stock_fermo della edge push-eventi v8 sul tema nuovo `magazzino`, di Benny e
-- Ginni (chi mette in vendita): una push per giro coi prodotti appena entrati in v_stock_fermo, dalle 9 di Roma. La edge
-- legge v_stock_fermo in sola lettura.
--
-- L'evento nasce SPENTO: lo accende Claude Code dopo il deploy della edge e la sua anteprima (come la 0183). Rollback =
-- attivo a false (o push_eventi_enabled a 'false' per tutto il modulo), senza deploy. Nessun flag cambia.
--
-- Solo tabelle push_* (tema, evento, temi dei telefoni) e, del core, una riga di change_log per ogni telefono a cui si
-- aggiunge il tema, come la 0168 e la 0183. Nessuna tabella nuova: RLS, privilegi e registro sono quelli della 0166.
-- Rieseguibile: tema ed evento nascono con on conflict do nothing, il tema si aggiunge ai telefoni solo se e' nato in
-- questa esecuzione e la prova pretende i valori di nascita solo da quello che e' nato qui. Al 09-11 Benny e Ginni hanno
-- un telefono iscritto a testa: il passo 3 ne aggiorna 2. Ale non lo riceve di default (ha la scheda in Home); lo aggiunge
-- dalla scheda Notifiche se vuole. Nessun `return` nei blocchi DO (MIG-C2 della 0166).
begin;

-- 0) cio' che la migrazione NON deve cambiare, letto prima di tutto
do $$ begin
  perform set_config('amimi.push_fermo_push_enabled_prima', coalesce((select value from app_flags where key = 'push_enabled'), '<assente>'), true);
  perform set_config('amimi.push_fermo_eventi_enabled_prima', coalesce((select value from app_flags where key = 'push_eventi_enabled'), '<assente>'), true);
end $$;

-- 1) tema nuovo: spuntato per Benny e Ginni alla prima iscrizione di un telefono. ordine 55, fra spedizioni (50) e sistema (60).
do $$ begin
  insert into push_temi (key, etichetta, descrizione, ordine, predefinito_per) values
    ('magazzino', 'Pezzi fermi non in vendita', 'Prodotti con pezzi a magazzino da almeno 3 giorni e nessuna pagina attiva sul sito', 55, array['Bene', 'Ginevra'])
  on conflict (key) do nothing;
  perform set_config('amimi.push_fermo_tema_nato_qui', found::text, true);
end $$;

-- 2) l'evento, spento
do $$
declare
  v_n int;
begin
  insert into push_eventi (evento, tema, attivo, descrizione) values
    ('stock_fermo', 'magazzino', false, 'Un prodotto entra fra i pezzi a magazzino non in vendita sul sito (v_stock_fermo): una push per giro coi prodotti nuovi, dalle 9 di Roma')
  on conflict (evento) do nothing;
  get diagnostics v_n = row_count;
  perform set_config('amimi.push_fermo_eventi_nati_qui', v_n::text, true);
end $$;

-- 3) i telefoni gia' iscritti dei profili a cui il tema spetta lo ricevono in fondo, solo se il tema e' nato qui; una
--    riga di change_log per telefono. Attesi, aggiornati e righe di change_log contati nella stessa istruzione (0168, R2).
do $$
declare
  v_attesi int := 0;
  v_aggiornati int := 0;
  v_log int := 0;
begin
  if current_setting('amimi.push_fermo_tema_nato_qui', true) = 'true' then
    with prima as (
      select s.id, s.temi from push_subscriptions s
       where exists (select 1 from push_temi t where t.key = 'magazzino' and s.chi = any(t.predefinito_per))
         and not ('magazzino' = any(s.temi))
       for update),
    agg as (
      update push_subscriptions s
         set temi = s.temi || array['magazzino'],
             updated_at = now()
        from prima p
       where s.id = p.id
      returning s.id, p.temi as temi_prima, s.temi as temi_dopo),
    ins as (
      insert into change_log (tbl, row_id, op, before, after, chi, source)
      select 'push_subscriptions', id::text, 'temi_aggiunti', jsonb_build_object('temi', temi_prima),
             jsonb_build_object('temi', temi_dopo, 'migr', '0191_push_stock_fermo'), 'claude-code', 'push-eventi'
        from agg
      returning 1)
    select (select count(*) from push_subscriptions s
             where exists (select 1 from push_temi t where t.key = 'magazzino' and t.predefinito_per @> array[s.chi])
               and not (s.temi @> array['magazzino'])),
           (select count(*) from agg), (select count(*) from ins)
      into v_attesi, v_aggiornati, v_log;
  end if;
  perform set_config('amimi.push_fermo_telefoni_attesi', v_attesi::text, true);
  perform set_config('amimi.push_fermo_telefoni_aggiornati', v_aggiornati::text, true);
  perform set_config('amimi.push_fermo_righe_log', v_log::text, true);
end $$;

-- 4) prova dentro la stessa transazione
do $$
declare
  v_tema_nato boolean := current_setting('amimi.push_fermo_tema_nato_qui', true) = 'true';
  v_eventi_nati int := coalesce(nullif(current_setting('amimi.push_fermo_eventi_nati_qui', true), '')::int, -1);
  v_attesi int := coalesce(nullif(current_setting('amimi.push_fermo_telefoni_attesi', true), '')::int, -1);
  v_aggiornati int := coalesce(nullif(current_setting('amimi.push_fermo_telefoni_aggiornati', true), '')::int, -1);
  v_log int := coalesce(nullif(current_setting('amimi.push_fermo_righe_log', true), '')::int, -1);
begin
  if current_setting('amimi.push_fermo_tema_nato_qui', true) is null or v_eventi_nati < 0
     or current_setting('amimi.push_fermo_push_enabled_prima', true) is null or current_setting('amimi.push_fermo_eventi_enabled_prima', true) is null
     or v_attesi < 0 or v_aggiornati < 0 or v_log < 0 then
    raise exception '0191: manca una lettura iniziale (cosa e'' nato in questa migrazione)';
  end if;

  if not exists (select 1 from push_temi where key = 'magazzino') then
    raise exception '0191: manca il tema magazzino';
  end if;
  if v_tema_nato and not exists (select 1 from push_temi where key = 'magazzino' and attivo and predefinito_per = array['Bene', 'Ginevra']
                                   and etichetta = 'Pezzi fermi non in vendita'
                                   and descrizione = 'Prodotti con pezzi a magazzino da almeno 3 giorni e nessuna pagina attiva sul sito' and ordine = 55) then
    raise exception '0191: il tema magazzino nato qui non e'' attivo, non e'' di Benny e Ginni o ha testi diversi dal contratto';
  end if;

  if not exists (select 1 from push_eventi where evento = 'stock_fermo' and tema = 'magazzino') then
    raise exception '0191: manca stock_fermo sul tema magazzino';
  end if;
  if v_eventi_nati = 1 and exists (select 1 from push_eventi where evento = 'stock_fermo'
                                     and (attivo or soglie <> '{}'::jsonb or baseline_at is not null or ultimo_giro_at is not null)) then
    raise exception '0191: l''evento nato qui non e'' spento, ha soglie o un giro';
  end if;

  if v_tema_nato and exists (select 1 from push_subscriptions s join push_temi t on t.key = 'magazzino' and s.chi = any(t.predefinito_per)
                              where not ('magazzino' = any(s.temi))) then
    raise exception '0191: un telefono dei profili non ha ricevuto il tema magazzino';
  end if;
  if v_tema_nato and exists (select 1 from push_subscriptions s where 'magazzino' = any(s.temi)
                              and not exists (select 1 from push_temi t where t.key = 'magazzino' and s.chi = any(t.predefinito_per))) then
    raise exception '0191: un telefono fuori dai profili ha il tema magazzino';
  end if;
  if v_tema_nato and (v_aggiornati <> v_attesi or v_log <> v_aggiornati) then
    raise exception '0191: % telefoni dei profili senza il tema, % aggiornati, % righe di change_log', v_attesi, v_aggiornati, v_log;
  end if;
  if exists (select 1 from push_subscriptions s where cardinality(s.temi) <> (select count(distinct x) from unnest(s.temi) x)) then
    raise exception '0191: un telefono iscritto ha un tema doppio';
  end if;

  -- la edge legge v_stock_fermo con la chiave di servizio
  if to_regclass('public.v_stock_fermo') is null or not has_table_privilege('service_role', 'public.v_stock_fermo', 'select') then
    raise exception '0191: v_stock_fermo (migr 0190) manca o service_role non la legge';
  end if;

  if coalesce((select value from app_flags where key = 'push_enabled'), '<assente>') is distinct from current_setting('amimi.push_fermo_push_enabled_prima', true)
     or coalesce((select value from app_flags where key = 'push_eventi_enabled'), '<assente>') is distinct from current_setting('amimi.push_fermo_eventi_enabled_prima', true) then
    raise exception '0191: push_enabled o push_eventi_enabled cambiati dalla migrazione';
  end if;
end $$;

commit;
