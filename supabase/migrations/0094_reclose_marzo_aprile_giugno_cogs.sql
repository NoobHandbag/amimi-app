-- 0094: ri-chiusura di marzo, aprile e giugno 2026 dopo la correzione del COGS (migr 0093).
--
-- La 0093 ha corretto il COGS del CE (ora moltiplicato per la quantita'). I tre mesi toccati sono
-- CHIUSI in `ce_snapshots`, quindi lo snapshot congelato e' rimasto indietro e `v_ce_drift` segnala
-- la differenza su `delta_mc2`. Vanno ri-chiusi: 3 mesi x 2 CE ('amimi' e 'totale') = 6 righe.
--
-- Canale: UPDATE di `ce_snapshots` via migrazione, che e' la ricetta gia' collaudata e documentata
-- per ri-chiudere un mese (close_month non sovrascrive per via dell'UNIQUE). Regola Ferrea 16:
-- le migrazioni sono territorio di Claude Code.
--
-- GUARDIA: il ricavo netto (`omni_netto`) NON deve muoversi di un centesimo, perche' la correzione
-- tocca SOLO il COGS. Se si muove, la migrazione solleva eccezione e non scrive niente: vorrebbe
-- dire che la 0093 ha toccato piu' del previsto. Seconda guardia: devono essere esattamente 6 righe.
--
-- Variazione attesa su mc2: marzo -28,66 / aprile +20,00 / giugno -4,00, identica sui due CE.

do $$
declare
  r     record;
  nuovo jsonb;
  n     int := 0;
begin
  for r in
    select id, ce, year, month, snapshot
      from public.ce_snapshots
     where (year, month) in ((2026, 3), (2026, 4), (2026, 6))
     order by ce, year, month
  loop
    if r.ce = 'amimi' then
      select to_jsonb(t) into nuovo
        from public.v_ce_amimi_summary t
       where t.year = r.year and t.month = r.month;
    elsif r.ce = 'totale' then
      select to_jsonb(t) into nuovo
        from public.v_ce_totale t
       where t.year = r.year and t.month = r.month;
    else
      raise exception 'ce inatteso: %', r.ce;
    end if;

    if nuovo is null then
      raise exception 'riga live mancante per % %/%', r.ce, r.month, r.year;
    end if;

    if round((nuovo->>'omni_netto')::numeric, 2)
       is distinct from round((r.snapshot->>'omni_netto')::numeric, 2) then
      raise exception 'INVARIANTE VIOLATA su % %/%: netto chiuso % -> live %. Nessuna scrittura.',
        r.ce, r.month, r.year, (r.snapshot->>'omni_netto'), (nuovo->>'omni_netto');
    end if;

    update public.ce_snapshots
       set snapshot  = nuovo,
           closed_at = now(),
           closed_by = 'reclose-cogs-quantita-2026-08-01'
     where id = r.id;

    n := n + 1;
  end loop;

  if n <> 6 then
    raise exception 'attese 6 righe ri-chiuse (3 mesi x 2 CE), aggiornate %', n;
  end if;
end $$;
