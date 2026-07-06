-- 0036_qromo_saleid_unique — Step 3 remediation audit 2026-07-06 (B14/A6).
-- Il dedup del webhook Qromo era SELECT-then-INSERT non atomico senza vincolo DB: una re-delivery
-- concorrente poteva doppio-inserire la stessa vendita. Aggiunge un UNIQUE che rende il conteggio
-- singolo garantito dal DB per le vie LIVE (webhook diretto + forwarder).
-- PARZIALE di proposito: le 19 righe con sale_id duplicato sono tutte source='etl' (import storico
-- dove piu' righe di un ordine multi-item condividono il sale_id numerico dell'ordine) e NON vanno
-- toccate. Il vincolo copre solo i sale_id delle vie live, dove ogni riga ha un sale_id per-item unico.
create unique index if not exists qromo_sales_live_saleid_uq
  on qromo_sales (sale_id)
  where source in ('qromo-direct', 'qromo-forward') and sale_id is not null;
