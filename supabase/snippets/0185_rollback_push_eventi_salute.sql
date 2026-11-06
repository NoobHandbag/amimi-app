-- Rollback della parte SQL della 0185_push_iscritti: push_eventi_salute() torna alla definizione viva PRIMA dell'apply,
-- letta con pg_get_functiondef il 2026-11-06 alle 17:45 UTC (md5 29ebdcd5773b718c4ac69a69d8d9f8ab, uguale al corpo della
-- 0166). Scrive di nuovo la sola riga push_eventi_fresh; la riga push_iscritti di oggi la toglie refresh_health_log alle
-- 06:00 UTC del giorno dopo. L'evento sistema_senza_iscritti si spegne a parte, senza deploy:
--   update push_eventi set attivo = false where evento = 'sistema_senza_iscritti';
-- Da lanciare con apply_migration (nome: rollback_0185_push_eventi_salute) solo su decisione esplicita.
begin;

create or replace function public.push_eventi_salute() returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_attivi int;
  v_n int;
  v_fermi text;
  v_mai text;
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
  end if;
end $fn$;
revoke all on function public.push_eventi_salute() from public, anon, authenticated;
grant execute on function public.push_eventi_salute() to service_role;

commit;
