-- 0125_reclose_maggio_caso16.sql (2026-09-14, caso aperto n.16; OK owner esplicito: la spesa e' davvero COGS)
-- Maggio aveva +118,60 di drift su entrambi i CE dalla ricodifica OPEX->COGS del 18-08 (spesa Gifa 3af0b024,
-- addebito PayPal 19-05). L'owner conferma che e' davvero COGS: si accetta il nuovo valore e si ri-chiude maggio.
-- L'unico scostamento e' opex (+118,60, la spesa non e' piu' in OPEX) e mc2 (+118,60). Si aggiornano le due
-- snapshot del solo delta (dal drift, non hardcoded) e si verifica sia il drift a 0 sia che l'opex della snapshot
-- combaci con quello vivo (se fosse cambiato altro, la seconda guardia lo becca).
update ce_snapshots s
set snapshot = s.snapshot || jsonb_build_object(
      'opex', (s.snapshot ->> 'opex')::numeric + d.delta_mc2,
      'mc2', (s.snapshot ->> 'mc2')::numeric + d.delta_mc2),
    closed_at = now(),
    closed_by = 'claude-code (caso 16: ricodifica OPEX->COGS accettata, OK owner 14-09)'
from v_ce_drift d
where d.ce = s.ce and d.year = s.year and d.month = s.month and s.year = 2026 and s.month = 5;

do $$
declare v_bad int;
begin
  select count(*) into v_bad from v_ce_drift where year = 2026 and month = 5 and (abs(delta_netto) > 0.01 or abs(delta_mc2) > 0.01);
  if v_bad <> 0 then raise exception 'reclose maggio: drift non azzerato (% righe)', v_bad; end if;
  select count(*) into v_bad from ce_snapshots s
   where s.year = 2026 and s.month = 5
     and ((s.ce = 'amimi'  and abs((s.snapshot ->> 'opex')::numeric - (select opex from v_ce_amimi  where year = 2026 and month = 5)) > 0.01)
       or (s.ce = 'totale' and abs((s.snapshot ->> 'opex')::numeric - (select opex from v_ce_totale where year = 2026 and month = 5)) > 0.01));
  if v_bad <> 0 then raise exception 'reclose maggio: opex snapshot != opex live (% righe): era cambiato altro oltre la ricodifica', v_bad; end if;
end $$;
