-- 0032: safety finanziaria — chiusura mese con snapshot + drift detection + coda revisione spese.
-- 1) ce_snapshots: a chiusura mese si congela la riga CE (entrambi i CE) come jsonb.
--    Un mese chiuso i cui numeri live CAMBIANO dopo = drift -> allarme (v_ce_drift + ce-guard).
create table if not exists ce_snapshots (
  id bigserial primary key,
  ce text not null check (ce in ('amimi','totale')),
  year int not null,
  month int not null,
  snapshot jsonb not null,
  closed_at timestamptz not null default now(),
  closed_by text,
  unique (ce, year, month)
);

-- 2) drift: confronto snapshot congelato vs vista live, per i mesi chiusi
create or replace view v_ce_drift as
with live as (
  select 'amimi'::text as ce, year, month, omni_netto, mc1, mc2 from v_ce_amimi_summary
  union all
  select 'totale', year, month, omni_netto, mc1, mc2 from v_ce_totale
)
select s.ce, s.year, s.month, s.closed_at, s.closed_by,
       round((s.snapshot->>'omni_netto')::numeric, 2) as netto_chiuso,
       round(l.omni_netto::numeric, 2)                as netto_live,
       round((l.omni_netto - (s.snapshot->>'omni_netto')::numeric)::numeric, 2) as delta_netto,
       round((s.snapshot->>'mc2')::numeric, 2) as mc2_chiuso,
       round(l.mc2::numeric, 2)                as mc2_live,
       round((l.mc2 - (s.snapshot->>'mc2')::numeric)::numeric, 2) as delta_mc2
from ce_snapshots s
join live l on l.ce = s.ce and l.year = s.year and l.month = s.month;

-- 3) coda revisione spese per la maschera (Ale/Benedetta):
--    proposte pending + storiche marcate "DA VERIFICARE" nella nota (la nota NON si perde mai:
--    alla conferma diventa "VERIFICATO (...)" e la riga esce dalla coda).
create or replace view v_expenses_review as
select id, year, month, date_reported, date_paid, operazione, costo, categoria,
       sottocategoria, amimi, amimi_raw, note, status, proposed_by, created_at
from expenses
where status = 'pending'
   or (status <> 'rejected' and note ~* 'da verificare')
order by year desc, month desc, created_at desc;

grant select on ce_snapshots, v_ce_drift, v_expenses_review to anon, authenticated;

-- 4) guardia contabile giornaliera (dopo l'health delle 06:00)
select cron.schedule('ce-guard-daily', '30 6 * * *',
  $$ select net.http_post(
       url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/ce-guard',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"action":"run","pin":"x"}'::jsonb
     ) $$);
