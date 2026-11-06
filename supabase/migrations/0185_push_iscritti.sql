-- 0185_push_iscritti.sql (2026-11-06): P0 della chat del sito (docs/PROPOSTA_chat_sito.md 8.1, decisione D-1 di Dan del
-- 06-11), modulo push_* (Regola Ferrea 19). Una push poteva non arrivare a nessuno senza che nessuno lo vedesse: il 06-11
-- cs_urgente aveva 13 righe `nessun_iscritto` e nessuna consegnata, perche' nessun telefono era iscritto al tema assistenza.
--  1) evento nuovo sistema_senza_iscritti sul tema sistema, SPENTO: la edge push-eventi v6 manda una push al giorno per ogni
--     tema di un evento acceso che non arriva a nessun telefono (nessun telefono lo ha, o e' spento in push_temi). Lo accende
--     Claude Code dopo il deploy della edge e la sua anteprima (o il giro vero del cron).
--  2) push_eventi_salute() (0166) scrive, oltre a push_eventi_fresh (parte identica, riga per riga), la riga health_log
--     k = 'push_iscritti': error se il tema di un evento acceso non ha telefoni o e' spento in push_temi, oppure se nelle
--     ultime 24 ore c'e' una push `nessun_iscritto` (anche quella per una sola persona, il riepilogo); ok altrimenti.
--     n = temi con push che non arrivano (l'unione dei due casi). Nella label solo chiavi di temi (push_temi_key_ck), nomi di
--     eventi (push_eventi_evento_ck) e numeri: health_log si legge da anon. Si vede nella pagina Salute, non nel banner rosso
--     della Home (legge solo ce_*). Stessi flag, stesso cron (:03 e :33), stesso NO-OP a modulo spento, stesso upsert.
-- Rollback: attivo a false su sistema_senza_iscritti (senza deploy); push_eventi_salute() alla definizione viva di prima,
-- salvata in supabase/snippets/0185_rollback_push_eventi_salute.sql (la riga push_iscritti e' solo telemetria: la toglie
-- refresh_health_log il mattino dopo). Nessun flag, nessuna tabella, nessun cron cambiano.
-- Rieseguibile: l'evento nasce con on conflict do nothing e la prova pretende i valori di nascita solo se e' nato qui; la
-- funzione e' un create or replace. Nessun `return` nei blocchi DO (MIG-C2 della 0166); variabili v_* (in produzione
-- plpgsql.variable_conflict = error: una variabile col nome di una colonna fa cadere tutto con 42702, CONOSCENZA 25-10).
begin;

-- 0) cio' che la migrazione NON deve cambiare, letto prima di tutto
do $$ begin
  perform set_config('amimi.push_iscritti_push_enabled_prima', coalesce((select value from app_flags where key = 'push_enabled'), '<assente>'), true);
  perform set_config('amimi.push_iscritti_eventi_enabled_prima', coalesce((select value from app_flags where key = 'push_eventi_enabled'), '<assente>'), true);
  perform set_config('amimi.push_iscritti_cron_prima', coalesce((select schedule || ' ' || command from cron.job where jobname = 'push-eventi-salute'), '<assente>'), true);
end $$;

-- 1) l'evento, spento
do $$
declare
  v_n int;
begin
  insert into push_eventi (evento, tema, attivo, descrizione) values
    ('sistema_senza_iscritti', 'sistema', false, 'Un tema di un evento acceso non arriva a nessun telefono (nessun telefono iscritto o tema spento): una push al giorno per tema')
  on conflict (evento) do nothing;
  get diagnostics v_n = row_count;
  perform set_config('amimi.push_iscritti_evento_nato_qui', v_n::text, true);
end $$;

-- 2) la salute del modulo: push_eventi_fresh come nella 0166, piu' push_iscritti
create or replace function public.push_eventi_salute() returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_attivi int;
  v_n int;
  v_fermi text;
  v_mai text;
  v_senza text;
  v_perse int;
  v_perse_ev text;
  v_temi_ko int;
begin
  if exists (select 1 from app_flags where key = 'push_eventi_enabled' and lower(btrim(value, E' \t\r\n')) = 'true')
     and exists (select 1 from app_flags where key = 'push_enabled' and lower(btrim(value, E' \t\r\n')) = 'true') then
    select count(*) filter (where e.attivo),
           count(*) filter (where e.attivo and (e.ultimo_giro_at is null or e.ultimo_giro_at < now() - interval '30 minutes')),
           string_agg(e.evento, ', ' order by e.evento) filter (where e.attivo and e.ultimo_giro_at < now() - interval '30 minutes'),
           string_agg(e.evento, ', ' order by e.evento) filter (where e.attivo and e.ultimo_giro_at is null)
      into v_attivi, v_n, v_fermi, v_mai
      from push_eventi e;
    insert into health_log (day, k, label, n, severity, created_at)
    values (current_date, 'push_eventi_fresh',
            case when v_fermi is not null then 'giro fermo da oltre 30 minuti: ' || v_fermi || coalesce('; accesi e mai girati: ' || v_mai, '')
                 when v_mai is not null then 'accesi e mai girati: ' || v_mai
                 else 'eventi accesi: ' || v_attivi || ', giro visto negli ultimi 30 minuti' end,
            v_n,
            case when v_fermi is not null then 'error' when v_mai is not null then 'warn' else 'ok' end,
            now())
    on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = excluded.created_at;

    -- 0185: temi degli eventi accesi senza un telefono che li riceva (come push-api: tema attivo in push_temi e almeno un
    -- telefono con quel tema), e push `nessun_iscritto` delle ultime 24 ore per evento
    with senza as (
      select x.tema from (select distinct e.tema from push_eventi e where e.attivo) x
       where not exists (select 1 from push_temi t where t.key = x.tema and t.attivo)
          or not exists (select 1 from push_subscriptions s where x.tema = any(s.temi))),
    perse as (
      select i.evento, e.tema, count(*)::int as quante
        from push_eventi_inviati i join push_eventi e on e.evento = i.evento
       where i.stato = 'nessun_iscritto' and i.updated_at >= now() - interval '24 hours'
       group by i.evento, e.tema)
    select (select string_agg(s.tema, ', ' order by s.tema) from senza s),
           (select coalesce(sum(p.quante), 0)::int from perse p),
           (select string_agg(p.evento || ' ' || p.quante, ', ' order by p.evento) from perse p),
           (select count(*)::int from (select s.tema from senza s union select p.tema from perse p) z)
      into v_senza, v_perse, v_perse_ev, v_temi_ko;
    insert into health_log (day, k, label, n, severity, created_at)
    values (current_date, 'push_iscritti',
            left(case when v_temi_ko = 0 then 'ogni tema degli eventi accesi arriva a un telefono; nessuna push senza destinatari nelle ultime 24 ore'
                      else concat_ws('; ',
                             case when v_senza is not null then 'temi senza telefoni: ' || v_senza end,
                             case when v_perse > 0 then 'push senza destinatari nelle ultime 24 ore: ' || v_perse || ' (' || v_perse_ev || ')' end) end, 500),
            v_temi_ko,
            case when v_temi_ko > 0 then 'error' else 'ok' end,
            now())
    on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = excluded.created_at;
  end if;
end $fn$;
revoke all on function public.push_eventi_salute() from public, anon, authenticated;
grant execute on function public.push_eventi_salute() to service_role;

-- 3) prova dentro la stessa transazione
do $$
declare
  v_nato int := coalesce(nullif(current_setting('amimi.push_iscritti_evento_nato_qui', true), '')::int, -1);
  v_def text := pg_get_functiondef('public.push_eventi_salute()'::regprocedure);
begin
  if v_nato < 0 or current_setting('amimi.push_iscritti_push_enabled_prima', true) is null
     or current_setting('amimi.push_iscritti_eventi_enabled_prima', true) is null or current_setting('amimi.push_iscritti_cron_prima', true) is null then
    raise exception '0185: manca una lettura iniziale';
  end if;
  if not exists (select 1 from push_eventi where evento = 'sistema_senza_iscritti' and tema = 'sistema') then
    raise exception '0185: manca sistema_senza_iscritti sul tema sistema';
  end if;
  if v_nato = 1 and exists (select 1 from push_eventi where evento = 'sistema_senza_iscritti'
                              and (attivo or soglie <> '{}'::jsonb or baseline_at is not null or ultimo_giro_at is not null)) then
    raise exception '0185: sistema_senza_iscritti nato qui non e'' spento, ha soglie o un giro';
  end if;
  if position('''push_eventi_fresh''' in v_def) = 0 or position('''push_iscritti''' in v_def) = 0 then
    raise exception '0185: push_eventi_salute() non scrive le due righe push_eventi_fresh e push_iscritti';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.push_eventi_salute()'::regprocedure and prosecdef)
     or not has_function_privilege('service_role', 'public.push_eventi_salute()', 'execute')
     or has_function_privilege('anon', 'public.push_eventi_salute()', 'execute')
     or has_function_privilege('authenticated', 'public.push_eventi_salute()', 'execute') then
    raise exception '0185: push_eventi_salute() non e'' security definer o la eseguono ruoli diversi dal solo service_role';
  end if;
  if coalesce((select value from app_flags where key = 'push_enabled'), '<assente>') is distinct from current_setting('amimi.push_iscritti_push_enabled_prima', true)
     or coalesce((select value from app_flags where key = 'push_eventi_enabled'), '<assente>') is distinct from current_setting('amimi.push_iscritti_eventi_enabled_prima', true)
     or coalesce((select schedule || ' ' || command from cron.job where jobname = 'push-eventi-salute'), '<assente>') is distinct from current_setting('amimi.push_iscritti_cron_prima', true) then
    raise exception '0185: un flag del modulo o il cron push-eventi-salute cambiati dalla migrazione';
  end if;
end $$;

commit;
