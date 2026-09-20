-- 0128 (Premia / Area Membri, Fase 2 purchase->points): accredito punti sugli ACQUISTI.
-- Modulo ISOLATO (Regola Ferrea 19): tabella propria loyalty_order_credits, flag proprio
-- loyalty_purchase_enabled default OFF, edge nuova loyalty-orders. NON tocca CE / stock / Qromo.
-- Idempotenza a DB (Regola Ferrea 20): PK su shopify_order_id + funzione atomica che accredita
-- UNA sola volta per ordine (insert-gate ON CONFLICT DO NOTHING nella stessa transazione).
-- Fonte importi: la edge legge gli ordini PAGATI dall'Admin API (come shopify-sync, stesso token
-- read_orders); il client non decide MAI i punti. Punti = floor(base_spesa * loyalty_euro_per_point).
-- Giro normale: accredita solo ordini creati DOPO loyalty_orders_since (niente retroattivo automatico).
-- Retroattivo storico: action 'backfill' a mano, con tetto.

create table if not exists loyalty_order_credits (
  shopify_order_id    text primary key,            -- id NUMERICO dell'ordine Shopify (stabile, univoco)
  shopify_customer_id text not null,
  points              int  not null,
  order_total         numeric,
  created_at          timestamptz not null default now()
);
create index if not exists loyalty_order_credits_cust_idx on loyalty_order_credits (shopify_customer_id);

-- RLS ON senza policy + REVOKE: come loyalty_points / loyalty_events, nessun accesso diretto
-- (ne' anon ne' authenticated). Solo il service_role (edge) e la funzione security definer operano.
alter table loyalty_order_credits enable row level security;
revoke all on loyalty_order_credits from anon, authenticated;

-- Config del modulo (app_flags). Default sicuri.
insert into app_flags (key, value) values
  ('loyalty_purchase_enabled', 'false'),                                                    -- Regola 19: cron NO-OP finche' l'owner non accende
  ('loyalty_euro_per_point',   '1'),                                                         -- 1 EUR di spesa = 1 punto (tarabile)
  ('loyalty_orders_since',     to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))  -- watermark di lancio: niente accredito sugli ordini precedenti
on conflict (key) do nothing;

-- Accredito ATOMICO e IDEMPOTENTE di un ordine. Ritorna jsonb {credited, points|reason}.
-- L'insert nel ledger e' il CANCELLO: se l'ordine e' gia' accreditato ON CONFLICT non inserisce
-- nulla, la funzione esce e non tocca i punti. Insert-gate + accredito + evento nella STESSA
-- transazione: o tutto o niente, mai punti senza traccia ne' traccia senza punti (Regola 20).
create or replace function public.loyalty_credit_order(
  p_order_id text, p_customer_id text, p_points int, p_total numeric
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new int;
begin
  if p_points is null or p_points <= 0 then
    return jsonb_build_object('credited', false, 'reason', 'zero_points');
  end if;

  insert into loyalty_order_credits (shopify_order_id, shopify_customer_id, points, order_total)
  values (p_order_id, p_customer_id, p_points, p_total)
  on conflict (shopify_order_id) do nothing;

  if not found then
    return jsonb_build_object('credited', false, 'reason', 'already');
  end if;

  insert into loyalty_points (shopify_customer_id, points, updated_at)
  values (p_customer_id, p_points, now())
  on conflict (shopify_customer_id)
    do update set points = loyalty_points.points + excluded.points, updated_at = now()
  returning points into v_new;

  insert into loyalty_events (shopify_customer_id, delta, source, meta)
  values (p_customer_id, p_points, 'purchase',
          jsonb_build_object('order_id', p_order_id, 'total', p_total));

  return jsonb_build_object('credited', true, 'points', v_new);
end;
$function$;

revoke all on function public.loyalty_credit_order(text, text, int, numeric) from anon, authenticated, public;
grant execute on function public.loyalty_credit_order(text, text, int, numeric) to service_role;
