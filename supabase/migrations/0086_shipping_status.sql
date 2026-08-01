-- 0086 (brief stato_tws_in_app): stato corrente TWS per LDV, scritto dal sync spedizioni
-- (Apps Script SyncShopify.gs -> edge shipping-status-sync), letto da cs-assist per il BLOCCO
-- DATI e il caso indirizzo. Modulo additivo (Regola Ferrea 19): prefisso proprio, core in sola
-- lettura, nessuna storicizzazione (solo lo stato corrente, fuori scope del brief).
-- RLS come le cs_*: SELECT solo authenticated, anon ZERO; scritture solo service-role (edge).
create table if not exists shipping_status (
  ldv text primary key,
  order_name text not null,
  stato_tws text not null,
  stato_raw text,
  shipped_date date,
  delivered_at date,
  updated_at timestamptz not null default now()
);
create index if not exists shipping_status_order_idx on shipping_status (order_name);
alter table shipping_status enable row level security;
revoke all on shipping_status from anon;
grant select on shipping_status to authenticated;
create policy shipping_status_read_authenticated on shipping_status for select to authenticated using (true);
