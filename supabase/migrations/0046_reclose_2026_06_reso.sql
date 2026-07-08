-- 0046: re-close 2026-06 (amimi + totale) ai valori LIVE.
-- Un reso parziale da 45 EUR lordi (ordine Shopify 2026-06-24, refund_amount 45, partially_refunded)
-- e' entrato nei resi di giugno DOPO lo snapshot audit-reclose-2026-07-06. Cambia SOLO `resi`
-- (e i derivati mc1/mc2, -36,89 = 45/1,22); il netto (omni_netto) e' invariato.
-- Owner OK: Ale (sessione Cowork 2026-07-08). Applicata via Supabase MCP il 2026-07-08 (v 20260708130026).
--
-- GUARDIA STRUTTURALE: aggiorna una riga SOLO se il netto live e' ancora uguale al netto dello
-- snapshot (delta_netto = 0). Se il netto si fosse mosso (piu' del solo reso) la riga NON viene
-- ri-congelata (0 righe toccate, il drift resta acceso) -> coerente col guardrail del brief e
-- sicura a un eventuale replay (nessuna sovrascrittura cieca).

-- 1) audit: registra before/after in change_log PRIMA della sovrascrittura
insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'ce_snapshots', s.ce || '-2026-6', 'reclose', s.snapshot, to_jsonb(v),
       'reclose-reso-2026-07-08', 'claude-code-migration'
from ce_snapshots s
join v_ce_amimi_summary v on v.year = 2026 and v.month = 6
where s.ce = 'amimi' and s.year = 2026 and s.month = 6
  and round(v.omni_netto::numeric, 2) = round((s.snapshot->>'omni_netto')::numeric, 2);

insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'ce_snapshots', s.ce || '-2026-6', 'reclose', s.snapshot, to_jsonb(v),
       'reclose-reso-2026-07-08', 'claude-code-migration'
from ce_snapshots s
join v_ce_totale v on v.year = 2026 and v.month = 6
where s.ce = 'totale' and s.year = 2026 and s.month = 6
  and round(v.omni_netto::numeric, 2) = round((s.snapshot->>'omni_netto')::numeric, 2);

-- 2) re-close: sovrascrivi lo snapshot 2026-06 coi valori live (solo se netto invariato)
update ce_snapshots s
set snapshot = to_jsonb(v), closed_at = now(), closed_by = 'reclose-reso-2026-07-08'
from v_ce_amimi_summary v
where s.ce = 'amimi' and s.year = 2026 and s.month = 6 and v.year = 2026 and v.month = 6
  and round(v.omni_netto::numeric, 2) = round((s.snapshot->>'omni_netto')::numeric, 2);

update ce_snapshots s
set snapshot = to_jsonb(v), closed_at = now(), closed_by = 'reclose-reso-2026-07-08'
from v_ce_totale v
where s.ce = 'totale' and s.year = 2026 and s.month = 6 and v.year = 2026 and v.month = 6
  and round(v.omni_netto::numeric, 2) = round((s.snapshot->>'omni_netto')::numeric, 2);
