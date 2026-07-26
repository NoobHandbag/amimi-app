-- 0078 — Mimi/Profilo Premia Fase 1+2 (brief 2026-07-24).
-- Stato del personaggio Mimi per cliente Shopify. Sottosistema loyalty: NON-core, additivo.
-- Non tocca gestionale / CE / stock / Qromo / cs_*. Audit dei PUNTI resta su loyalty_events.
create table if not exists public.mimi_state (
  shopify_customer_id text primary key,
  nanna boolean not null default false,
  last_coccola date,
  last_memory date,
  worn text,
  updated_at timestamptz not null default now()
);

comment on table public.mimi_state is
  'Stato Mimi per cliente Shopify (nanna, coccole/memory del giorno, capo indossato). Scritta SOLO dalla edge loyalty-proxy col service_role. Le date last_* sono giorni Europe/Rome, non UTC.';

-- Stessa postura di loyalty_points/loyalty_events (migr 0068): RLS ON SENZA policy + REVOKE.
-- Nessun client (anon o authenticated) puo' leggere/scrivere: il canale e' solo la edge firmata.
alter table public.mimi_state enable row level security;
revoke all on public.mimi_state from anon, authenticated;

-- Flag di riserva del clicker "Amimi Click": spento per il pubblico, riattivabile dall'owner.
-- Decisione owner 24-07 punto 4: il clicker NON si ritira, resta in edge ma gated.
insert into public.app_flags (key, value)
values ('loyalty_click_enabled', 'false')
on conflict (key) do nothing;
