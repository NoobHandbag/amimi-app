-- 0010: ordini fornitore (`supplier_orders`) + vista arrivi.
--
-- RECUPERATA il 2026-08-01 dal DB di produzione (`supabase_migrations.schema_migrations.statements`).
-- Il file mancava dal repo ed era il piu' grave dei quattro buchi: senza questa tabella la 0013
-- fallisce ("relation supplier_orders does not exist") e il rebuild da zero si ferma li'.
-- Contenuto identico a quello applicato in produzione il 2026-06-25.

create table supplier_orders (
  id uuid primary key default gen_random_uuid(),
  codice text, item text, variant text, fornitore text,
  qty_ordered numeric, qty_arrived numeric not null default 0,
  data_ordine date, data_ultimo_arrivo date,
  note text, source text default 'app', chi text,
  created_at timestamptz not null default now()
);
revoke insert, update, delete on supplier_orders from anon, authenticated;

create or replace view v_ordini_arrivo as
select id, codice, item, variant, fornitore, qty_ordered, qty_arrived,
  (coalesce(qty_ordered,0) - coalesce(qty_arrived,0)) as mancano,
  (coalesce(qty_arrived,0) >= coalesce(qty_ordered,0)) as completo,
  data_ordine, data_ultimo_arrivo
from supplier_orders;
