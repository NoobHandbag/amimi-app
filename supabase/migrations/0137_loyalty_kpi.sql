-- 0137 (Premia / Area Membri, Fase 4 MISURABILITA' della quest audit): KPI, telemetria e allarmi del modulo.
-- ADDITIVO (Regola Ferrea 19): tabella propria loyalty_visits, colonna order_name su loyalty_order_credits
-- (ponte verso shopify_orders/shopify_line_items, chiave = NOME ordine), viste v_loyalty_* con
-- security_invoker (niente SECURITY DEFINER: l'advisor le segna ERROR), RPC loyalty_visit idempotente per
-- cliente/giorno, funzione loyalty_health_check() che scrive in health_log DOPO refresh_health_log() delle
-- 06:00 UTC (cron 06:12: il refresh cancella le chiavi non ce_*/sales_* del giorno). Grant di SOLA lettura al
-- ruolo interno ask_ro, a colonne: mai i codici sconto ne' gli idemp. NON tocca CE / stock / viste core.

-- 1. Visite: una riga per cliente e giorno (Europe/Rome). La incrementa loyalty-proxy `state` (v11) via RPC.
create table if not exists loyalty_visits (
  shopify_customer_id text not null,
  day date not null,
  hits int not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (shopify_customer_id, day)
);
create index if not exists loyalty_visits_day_idx on loyalty_visits (day);
alter table loyalty_visits enable row level security;
revoke all on loyalty_visits from anon, authenticated;

create or replace function public.loyalty_visit(p_customer text, p_day date) returns void
language sql security definer set search_path to 'public' as $$
  insert into loyalty_visits (shopify_customer_id, day) values (p_customer, p_day)
  on conflict (shopify_customer_id, day) do update set hits = loyalty_visits.hits + 1, last_at = now();
$$;
revoke all on function public.loyalty_visit(text, date) from anon, authenticated, public;
grant execute on function public.loyalty_visit(text, date) to service_role;

-- 2. Nome ordine sugli accrediti (es. '#1582'): lo scrive loyalty-orders v3 e il backfill lo popola per lo storico.
alter table loyalty_order_credits add column if not exists order_name text;
create index if not exists loyalty_order_credits_name_idx on loyalty_order_credits (order_name);

-- 3. Soglia pool codici liberi sotto la quale si alza warn (owner-tunable)
insert into app_flags (key, value) values ('loyalty_pool_min', '20') on conflict (key) do nothing;

-- 4. Viste KPI
create or replace view v_loyalty_ledger_drift with (security_invoker = true) as
select p.shopify_customer_id, p.points,
       coalesce(sum(e.delta),0) as sum_events,
       p.points - coalesce(sum(e.delta),0) as diff
from loyalty_points p
left join loyalty_events e on e.shopify_customer_id = p.shopify_customer_id
group by p.shopify_customer_id, p.points;

create or replace view v_loyalty_members with (security_invoker = true) as
select p.shopify_customer_id, p.points as saldo,
  coalesce(sum(case when e.delta > 0 then e.delta end),0) as guadagnati,
  coalesce(-sum(case when e.delta < 0 then e.delta end),0) as riscattati,
  min(e.created_at) as primo_evento, max(e.created_at) as ultimo_evento,
  case when p.points >= 400 then 'Amica del Cuore' when p.points >= 150 then 'Amica Speciale' else 'Amica' end as tier_saldo,
  (select count(c.shopify_order_id) from loyalty_order_credits c where c.shopify_customer_id = p.shopify_customer_id) as ordini_accreditati,
  (select coalesce(sum(c.order_total),0) from loyalty_order_credits c where c.shopify_customer_id = p.shopify_customer_id) as spesa_accreditata,
  (select count(r.id) from loyalty_redemptions r where r.shopify_customer_id = p.shopify_customer_id and r.status = 'fulfilled') as riscatti_evasi
from loyalty_points p
left join loyalty_events e on e.shopify_customer_id = p.shopify_customer_id
group by p.shopify_customer_id, p.points;

create or replace view v_loyalty_kpi_daily with (security_invoker = true) as
with d as (
  select generate_series(coalesce((select min(created_at)::date from loyalty_events), current_date), current_date, interval '1 day')::date as day
)
select d.day,
  (select count(v.shopify_customer_id) from loyalty_visits v where v.day = d.day) as visite_clienti,
  (select coalesce(sum(v.hits),0) from loyalty_visits v where v.day = d.day) as visite_hits,
  (select count(distinct e.shopify_customer_id) from loyalty_events e where (e.created_at at time zone 'Europe/Rome')::date = d.day) as clienti_attivi,
  (select count(e.id) from loyalty_events e where (e.created_at at time zone 'Europe/Rome')::date = d.day and e.source = 'mimi_coccola') as coccole,
  (select count(e.id) from loyalty_events e where (e.created_at at time zone 'Europe/Rome')::date = d.day and e.source = 'game_memory') as memory,
  (select count(e.id) from loyalty_events e where (e.created_at at time zone 'Europe/Rome')::date = d.day and e.source = 'purchase') as accrediti_acquisto,
  (select coalesce(sum(e.delta),0) from loyalty_events e where (e.created_at at time zone 'Europe/Rome')::date = d.day and e.delta > 0) as punti_guadagnati,
  (select coalesce(-sum(e.delta),0) from loyalty_events e where (e.created_at at time zone 'Europe/Rome')::date = d.day and e.delta < 0) as punti_riscattati,
  (select count(r.id) from loyalty_redemptions r where (r.created_at at time zone 'Europe/Rome')::date = d.day) as riscatti,
  (select count(r.id) from loyalty_redemptions r where (r.created_at at time zone 'Europe/Rome')::date = d.day and r.status = 'failed') as riscatti_falliti
from d
order by d.day;

create or replace view v_loyalty_pool with (security_invoker = true) as
select r.key as reward, r.label, r.cost_points, r.active,
  (select count(c.reward_key) from loyalty_reward_codes c where c.reward_key = r.key and c.claimed_by is null) as codici_liberi,
  (select count(c.reward_key) from loyalty_reward_codes c where c.reward_key = r.key and c.claimed_by is not null) as codici_usati,
  (select count(x.id) from loyalty_redemptions x where x.reward_key = r.key and x.status = 'pending') as riscatti_pending,
  (select min(x.created_at) from loyalty_redemptions x where x.reward_key = r.key and x.status = 'pending') as pending_piu_vecchio
from loyalty_rewards r;

create or replace view v_loyalty_redeem_rate with (security_invoker = true) as
select
  coalesce(sum(case when e.delta > 0 then e.delta end),0) as punti_guadagnati_totali,
  coalesce(-sum(case when e.delta < 0 then e.delta end),0) as punti_riscattati_totali,
  case when coalesce(sum(case when e.delta > 0 then e.delta end),0) > 0
       then round(100.0 * coalesce(-sum(case when e.delta < 0 then e.delta end),0) / sum(case when e.delta > 0 then e.delta end), 1) else 0 end as pct_riscattato,
  (select count(r.id) from loyalty_redemptions r where r.status = 'fulfilled') as riscatti_evasi,
  (select count(r.id) from loyalty_redemptions r where r.status = 'pending') as riscatti_pending,
  (select count(p.shopify_customer_id) from loyalty_points p) as membri,
  (select count(p.shopify_customer_id) from loyalty_points p where p.points >= 200) as membri_con_tessera_piena
from loyalty_events e;

-- membro = ordine accreditato (dopo il backfill: tutti gli ordini con account); il resto = ospiti o non accreditati
create or replace view v_loyalty_uplift with (security_invoker = true) as
select
  case when c.shopify_order_id is not null then 'membro' else 'ospite_o_non_accreditato' end as segmento,
  count(o.id) as ordini,
  round(avg(o.gross_total),2) as scontrino_medio_lordo,
  round(sum(o.gross_total),2) as lordo_totale,
  count(o.id) filter (where coalesce(o.refund_amount,0) > 0) as ordini_con_reso,
  count(distinct o.email) as clienti_distinti_per_email
from shopify_orders o
left join loyalty_order_credits c on c.order_name = o.order_id
where o.financial_status in ('paid','partially_refunded','refunded')
group by 1;

create or replace view v_loyalty_streaks with (security_invoker = true) as
with v as (
  select shopify_customer_id, day,
         day - (row_number() over (partition by shopify_customer_id order by day))::int as grp
  from loyalty_visits
), runs as (
  select shopify_customer_id, grp, count(day) as len, max(day) as fine
  from v group by shopify_customer_id, grp
)
select shopify_customer_id,
  max(len) as streak_massimo,
  coalesce(max(len) filter (where fine >= current_date - 1), 0) as streak_corrente
from runs group by shopify_customer_id;

-- 5. Controllo di salute giornaliero -> health_log (delete+insert per (day,k): idempotente nel giorno)
create or replace function public.loyalty_health_check() returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_drift int; v_drift_ids text; v_free int; v_min int; v_redeem_on bool; v_pending int;
  v_purchase_on bool; v_orders_row int; v_visits int; v_actions int; v_membri int;
begin
  -- ledger: points == somma eventi per ogni membro
  select count(*), coalesce(left(string_agg(shopify_customer_id, ','), 120), '')
    into v_drift, v_drift_ids from v_loyalty_ledger_drift where diff <> 0;
  delete from health_log where day = current_date and k = 'loyalty_ledger';
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_ledger',
    case when v_drift = 0 then 'ledger punti quadrato (points = somma eventi per ogni membro)'
         else 'LEDGER FUORI QUADRA per '||v_drift||' membri: '||v_drift_ids end,
    v_drift, case when v_drift = 0 then 'ok' else 'error' end);

  -- pool codici
  v_min := coalesce((select value::int from app_flags where key = 'loyalty_pool_min'), 20);
  v_redeem_on := coalesce((select value = 'true' from app_flags where key = 'loyalty_redeem_enabled'), false);
  select coalesce(min(codici_liberi), 0) into v_free from v_loyalty_pool where active;
  delete from health_log where day = current_date and k = 'loyalty_pool';
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_pool',
    'codici liberi (minimo fra i premi attivi): '||v_free||', soglia '||v_min||case when v_redeem_on then ', riscatto ON' else ', riscatto OFF' end,
    v_free, case when v_redeem_on and v_free = 0 then 'error' when v_free < v_min then 'warn' else 'ok' end);

  -- riscatti pending da oltre 1 ora
  select count(*) into v_pending from loyalty_redemptions where status = 'pending' and created_at < now() - interval '1 hour';
  delete from health_log where day = current_date and k = 'loyalty_pending';
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_pending',
    'riscatti in attesa di codice da oltre 1 ora: '||v_pending, v_pending, case when v_pending > 0 then 'warn' else 'ok' end);

  -- freschezza del giro acquisti (se acceso, deve aver scritto almeno ieri o oggi)
  v_purchase_on := coalesce((select value = 'true' from app_flags where key = 'loyalty_purchase_enabled'), false);
  select count(*) into v_orders_row from health_log where k = 'loyalty_orders' and day >= current_date - 1;
  delete from health_log where day = current_date and k = 'loyalty_orders_fresh';
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_orders_fresh',
    case when not v_purchase_on then 'accredito acquisti OFF: nessun giro atteso'
         when v_orders_row > 0 then 'giro loyalty-orders visto nelle ultime 48h'
         else 'NESSUN giro loyalty-orders nelle ultime 48h con accredito ON' end,
    v_orders_row, case when v_purchase_on and v_orders_row = 0 then 'error' else 'ok' end);

  -- attivita' di ieri (informativa)
  select count(*) into v_visits from loyalty_visits where day = current_date - 1;
  select count(*) into v_actions from loyalty_events where (created_at at time zone 'Europe/Rome')::date = current_date - 1;
  select count(*) into v_membri from loyalty_points;
  delete from health_log where day = current_date and k = 'loyalty_activity';
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_activity',
    'ieri: '||v_visits||' clienti in pagina, '||v_actions||' azioni a punti; membri totali '||v_membri, v_actions, 'ok');
end; $$;
revoke all on function public.loyalty_health_check() from anon, authenticated, public;
grant execute on function public.loyalty_health_check() to service_role;

-- 6. Cron: 06:12 UTC, dopo refresh_health_log() delle 06:00 (che cancellerebbe le chiavi loyalty_* del giorno)
select cron.schedule('loyalty-health-daily', '12 6 * * *', $$ select public.loyalty_health_check() $$);
insert into change_log (tbl, row_id, op, after, chi, source) values (
  'cron.job', 'loyalty-health-daily', 'cron_create',
  jsonb_build_object('schedule', '12 6 * * *', 'fn', 'loyalty_health_check', 'motivo', 'KPI e allarmi Premia (Fase 4 quest audit)'),
  'claude-code', 'migration_0137'
);

-- 7. Lettura interna (ask_ro): tabelle a colonne, MAI discount_code / code / idemp / meta
grant select on loyalty_order_credits, loyalty_rewards, loyalty_visits to ask_ro;
grant select (id, shopify_customer_id, reward_key, cost_points, status, created_at, fulfilled_at) on loyalty_redemptions to ask_ro;
grant select (reward_key, claimed_by, redemption_id, claimed_at, created_at) on loyalty_reward_codes to ask_ro;
grant select on v_loyalty_ledger_drift, v_loyalty_members, v_loyalty_kpi_daily, v_loyalty_pool, v_loyalty_redeem_rate, v_loyalty_uplift, v_loyalty_streaks to ask_ro;
