-- 0124_ce_totale_maggio_spedizioni_parziale.sql (2026-09-14, audit gate B48; OK owner ri-chiudi mag)
--
-- Maggio e' intrecciato col caso aperto n.16: ha gia' +118,60 di drift su ENTRAMBI i CE (amimi e totale) dalla
-- ricodifica di spesa OPEX->COGS del 18-08, decisione di merito ancora aperta. La May AMIMI snapshot ha gia' le
-- spedizioni congelate (il suo drift e' solo il +118,60 del caso 16); la May TOTALE snapshot no (era 0), quindi
-- dopo la 0123 mostrava -896,82 (spedizioni -1015,42 al netto del +118,60). Per coerenza fra i due CE si allinea
-- SOLO la parte spedizioni della May totale snapshot (logistica_var + mc1/mc2), lasciando intatto il resto: cosi'
-- il caso 16 resta l'UNICO drift residuo di maggio, identico sui due CE (+118,60), isolato e leggibile. Un reclose
-- pieno di maggio (che assorbirebbe anche il caso 16) si fa quando l'owner decide il caso 16.
update ce_snapshots s
set snapshot = s.snapshot || jsonb_build_object(
      'logistica_var', t.logistica_var,
      'mc1', (s.snapshot ->> 'mc1')::numeric + (t.logistica_var - (s.snapshot ->> 'logistica_var')::numeric),
      'mc2', (s.snapshot ->> 'mc2')::numeric + (t.logistica_var - (s.snapshot ->> 'logistica_var')::numeric)),
    closed_at = now(),
    closed_by = 'claude-code (audit gate B48: solo spedizioni; caso 16 lasciato aperto)'
from v_ce_totale t
where s.ce = 'totale' and s.year = t.year and s.month = t.month and s.year = 2026 and s.month = 5;

-- guardia: ora il drift di maggio deve essere lo STESSO sui due CE (il solo caso 16, ~+118,60), non piu' -896,82
do $$
declare d_tot numeric; d_ami numeric;
begin
  select delta_mc2 into d_tot from v_ce_drift where ce = 'totale' and year = 2026 and month = 5;
  select delta_mc2 into d_ami from v_ce_drift where ce = 'amimi' and year = 2026 and month = 5;
  if abs(d_tot - d_ami) > 0.01 then
    raise exception 'atteso drift totale = drift amimi (solo caso 16), ma totale=% amimi=%', d_tot, d_ami;
  end if;
end $$;
