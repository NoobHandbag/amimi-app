-- 0146 (Premia, 2026-09-27): dashboard di monitoraggio nell'app (Fase 1) + tracciamento dell'Area Membri (Fase 2).
-- ADDITIVA (Regola Ferrea 19): una tabella nuova loyalty_ui_events, funzioni e viste nuove col prefisso loyalty_*,
-- core solo in LETTURA (shopify_orders per gli AMICA12 usati al checkout e per gli ordini dopo una visita), nessuna
-- colonna su tabelle core, nessuna azione write-api. Un flag nuovo default OFF: loyalty_track_enabled (a valore come
-- quelli della migr 0141: 'true' | 'false' | lista di shopify_customer_id). Rollback = flag OFF; la dashboard e' sola
-- lettura e non ha flag.
--
-- Fase 1: loyalty_dashboard(p_days) restituisce SOLO aggregati (conteggi, somme, stati dei flag): nessun codice sconto,
-- nessun id cliente, nessun dato personale. SECURITY DEFINER perche' le tabelle loyalty_* sono chiuse ad anon e
-- authenticated; il cancello e' dentro la funzione: JWT con email @amimi.it (stesso criterio delle viste mat_*/lead_*),
-- altrimenti 42501. Execute solo ad authenticated.
-- Fase 2: loyalty_track(p_customer, p_events) scrive eventi di interfaccia (apertura, card vista, tap) chiamata SOLO da
-- loyalty-proxy col service_role. Dati minimi: cliente, giorno, evento, elemento, ora. Liste chiuse di eventi ed
-- elementi (il resto si scarta), tetto 20 eventi per chiamata e 300 per cliente al giorno (Regola 20c), il flag e'
-- ricontrollato qui dentro (difesa in profondita': anche un edge sbagliato non scrive a flag spento).
-- Telemetria: non e' mai un accredito, nessun effetto su punti, CE, stock. Conservazione 180 giorni (purge su pg_cron).

-- 0. Flag (default OFF)
insert into app_flags (key, value) values ('loyalty_track_enabled', 'false')
on conflict (key) do nothing;

-- 1. Tabella eventi di interfaccia
create table if not exists loyalty_ui_events (
  id                  bigint generated always as identity primary key,
  shopify_customer_id text        not null,
  day                 date        not null,
  event               text        not null check (event in ('page_open', 'view', 'tap')),
  element             text        check (element is null or element ~ '^[a-z0-9_]{1,32}$'),
  at                  timestamptz not null default now()
);
create index if not exists loyalty_ui_events_day_idx  on loyalty_ui_events (day);
create index if not exists loyalty_ui_events_cust_idx on loyalty_ui_events (shopify_customer_id, day);
alter table loyalty_ui_events enable row level security;
revoke all on loyalty_ui_events from anon, authenticated;
grant select on loyalty_ui_events to ask_ro;

-- 2. Scrittura (solo service_role, da loyalty-proxy azione `track`)
create or replace function public.loyalty_track(p_customer text, p_events jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  c_views    constant text[] := array['redeem_ready', 'redeem_locked', 'redeem_pending', 'profilo', 'mimi', 'guardaroba', 'bonus2', 'bday'];
  c_taps     constant text[] := array['redeem', 'copy_code', 'coccola', 'gioco', 'nanna', 'wear', 'profile_save'];
  c_max_call constant int := 20;
  c_max_day  constant int := 300;
  v_day  date := (now() at time zone 'Europe/Rome')::date;
  v_have int;
  v_room int;
  v_ins  int;
begin
  if coalesce(trim(p_customer), '') = '' then return jsonb_build_object('ok', false, 'reason', 'no_customer'); end if;
  if not loyalty_flag_on('loyalty_track_enabled', p_customer) then return jsonb_build_object('ok', false, 'reason', 'off'); end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'bad_payload'); end if;
  -- due invii concorrenti dello stesso cliente non sforano il tetto giornaliero
  perform pg_advisory_xact_lock(hashtext('loyalty_track:' || p_customer));
  select count(*) into v_have from loyalty_ui_events where shopify_customer_id = p_customer and day = v_day;
  v_room := greatest(0, c_max_day - v_have);
  insert into loyalty_ui_events (shopify_customer_id, day, event, element)
  select p_customer, v_day, s.event, s.element
  from (
    select e.value ->> 'e' as event, nullif(e.value ->> 'el', '') as element, e.ord
    from jsonb_array_elements(p_events) with ordinality as e(value, ord)
    where e.ord <= c_max_call and jsonb_typeof(e.value) = 'object'
  ) s
  where (s.event = 'page_open' and s.element is null)
     or (s.event = 'view' and s.element = any(c_views))
     or (s.event = 'tap'  and s.element = any(c_taps))
  order by s.ord
  limit v_room;
  get diagnostics v_ins = row_count;
  return jsonb_build_object('ok', true, 'inserted', v_ins, 'capped', v_room < least(jsonb_array_length(p_events), c_max_call));
end $$;
revoke all on function public.loyalty_track(text, jsonb) from anon, authenticated, public;
grant execute on function public.loyalty_track(text, jsonb) to service_role;

-- 3. Conservazione: 180 giorni, al massimo 5000 righe per giro (Regola 20c)
create or replace function public.loyalty_ui_events_purge() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  delete from loyalty_ui_events where id in (
    select id from loyalty_ui_events where day < (now() at time zone 'Europe/Rome')::date - 180 order by id limit 5000);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.loyalty_ui_events_purge() from anon, authenticated, public;
select cron.unschedule('loyalty-ui-events-purge') where exists (select 1 from cron.job where jobname = 'loyalty-ui-events-purge');
select cron.schedule('loyalty-ui-events-purge', '35 6 * * *', 'select public.loyalty_ui_events_purge()');

-- 4. Funnel giornaliero (ultimi 90 giorni, Europe/Rome) per Cowork e ask_ro. Clienti distinti per giorno.
--    aperture = pagina servita (loyalty_visits, lato server, c'e' anche a tracciamento spento);
--    le colonne da loyalty_ui_events restano a 0 finche' loyalty_track_enabled e' spento.
create or replace view v_loyalty_funnel_daily as
with d as (
  select generate_series((now() at time zone 'Europe/Rome')::date - 89, (now() at time zone 'Europe/Rome')::date, '1 day')::date as day
)
select d.day,
  (select count(*) from loyalty_visits v where v.day = d.day)                                                          as aperture,
  (select count(*) from loyalty_ui_events u where u.day = d.day and u.event = 'page_open')                              as sessioni,
  (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day = d.day and u.event = 'view' and u.element like 'redeem\_%') as visto_premio,
  (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day = d.day and u.event = 'view' and u.element = 'redeem_ready') as premio_pronto,
  (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day = d.day and u.event = 'tap' and u.element = 'redeem')        as tap_riscatta,
  (select count(distinct r.shopify_customer_id) from loyalty_redemptions r
     where r.status = 'fulfilled' and (r.created_at at time zone 'Europe/Rome')::date = d.day)                          as riscatti,
  (select count(*) from shopify_orders o
     where o.discount_codes ilike '%AMICA12-%' and (o.created_at_shop at time zone 'Europe/Rome')::date = d.day)        as ordini_amica12
from d
order by d.day;
revoke all on v_loyalty_funnel_daily from anon, authenticated;
grant select on v_loyalty_funnel_daily to ask_ro;

-- 5. Dashboard (Fase 1): un solo giro, solo aggregati
create or replace function public.loyalty_dashboard(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_days  int  := least(greatest(coalesce(p_days, 30), 1), 365);
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_from  date;
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_out   jsonb;
begin
  if v_email not ilike '%@amimi.it' then
    raise exception 'loyalty_dashboard: riservato agli account @amimi.it' using errcode = '42501';
  end if;
  v_from := v_today - (v_days - 1);

  select jsonb_build_object(
    'generated_at', now(),
    'days', v_days,
    'from', v_from,
    'to', v_today,

    -- semaforo: ultima riga per chiave loyalty_* degli ultimi 7 giorni (una chiave ferma resta visibile con la sua data)
    'health', (select coalesce(jsonb_agg(jsonb_build_object('k', h.k, 'label', h.label, 'n', h.n, 'severity', h.severity, 'day', h.day) order by h.k), '[]'::jsonb)
               from (select distinct on (k) k, label, n, severity, day from health_log
                     where k like 'loyalty\_%' and day >= v_today - 7 order by k, day desc) h),

    -- flag: solo lo stato (on/off/test), mai la lista degli id di prova
    'flags', (select coalesce(jsonb_object_agg(f.key, case when lower(trim(f.value)) = 'true' then 'on'
                                                          when lower(trim(f.value)) in ('', 'false') then 'off'
                                                          else 'test' end), '{}'::jsonb)
              from app_flags f
              where f.key in ('loyalty_redeem_enabled', 'loyalty_purchase_enabled', 'loyalty_profile_enabled', 'loyalty_tier_lifetime_enabled',
                              'loyalty_bonus_second_enabled', 'loyalty_track_enabled', 'loyalty_click_enabled')),
    'orders_last_run', (select value from app_flags where key = 'loyalty_orders_last_run'),

    'kpi_daily', (select coalesce(jsonb_agg(to_jsonb(k) order by k.day), '[]'::jsonb) from v_loyalty_kpi_daily k where k.day >= v_from),

    'pool', (select coalesce(jsonb_agg(jsonb_build_object(
                'reward', p.reward, 'label', p.label, 'cost_points', p.cost_points, 'active', p.active,
                'liberi', p.codici_liberi, 'usati', p.codici_usati, 'pending', p.riscatti_pending,
                'riscatti_14gg', (select count(*) from loyalty_redemptions r
                                  where r.reward_key = p.reward and r.status = 'fulfilled' and r.created_at >= now() - interval '14 days'))
              order by p.active desc, p.reward), '[]'::jsonb)
             from v_loyalty_pool p where p.active),

    'members', (select jsonb_build_object(
                  'totale',      count(*),
                  'lt50',        count(*) filter (where m.saldo < 50),
                  'b50_99',      count(*) filter (where m.saldo between 50 and 99),
                  'ge100',       count(*) filter (where m.saldo >= 100),
                  -- niente "attivi 30gg" su ultimo_evento: il retroattivo del 21-09 ha dato un evento recente a tutti i membri
                  'tier_saldo',     (select coalesce(jsonb_object_agg(t.tier, t.n), '{}'::jsonb) from (select coalesce(tier_saldo, 'n/d') as tier, count(*) n from v_loyalty_members group by 1) t),
                  'tier_cumulato',  (select coalesce(jsonb_object_agg(t.tier, t.n), '{}'::jsonb) from (select coalesce(tier_cumulato, 'n/d') as tier, count(*) n from v_loyalty_members group by 1) t))
                from v_loyalty_members m),

    'visitatori', jsonb_build_object(
      'periodo', (select count(distinct v.shopify_customer_id) from loyalty_visits v where v.day >= v_from),
      'totale',  (select count(distinct v.shopify_customer_id) from loyalty_visits v),
      'dal',     (select min(v.day) from loyalty_visits v)),

    'second', (select jsonb_build_object(
                 'finestre_aperte', count(*) filter (where s.n_ordini = 1 and s.deadline >= v_today),
                 'in_scadenza_14gg', count(*) filter (where s.n_ordini = 1 and s.deadline between v_today and v_today + 14),
                 'bonus_dati',      count(*) filter (where coalesce(s.bonus_points, 0) > 0 and coalesce(s.bonus_reversed, 0) = 0))
               from v_loyalty_second_order s),

    'redeem_rate', (select to_jsonb(x) from v_loyalty_redeem_rate x),

    'amica12', jsonb_build_object(
      'riscattati_totale',  (select count(*) from loyalty_redemptions r where r.reward_key = 'amica12' and r.status = 'fulfilled'),
      'riscattati_periodo', (select count(*) from loyalty_redemptions r where r.reward_key = 'amica12' and r.status = 'fulfilled'
                               and (r.created_at at time zone 'Europe/Rome')::date >= v_from),
      'ordini_totale',      (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%'),
      'ordini_periodo',     (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%'
                               and (o.created_at_shop at time zone 'Europe/Rome')::date >= v_from),
      'lordo_totale',       (select coalesce(sum(o.gross_total), 0) from shopify_orders o where o.discount_codes ilike '%AMICA12-%'),
      'sconto_totale',      (select coalesce(sum(o.discount_total), 0) from shopify_orders o where o.discount_codes ilike '%AMICA12-%'),
      'con_reso',           (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and coalesce(o.refund_amount, 0) > 0)),

    -- effetto vendite: ordini del periodo di clienti che avevano aperto l'Area Membri nei 30 giorni prima dell'ordine
    'vendite', (select jsonb_build_object(
                  'ordini_periodo',       count(*),
                  'lordo_periodo',        coalesce(sum(o.gross_total), 0),
                  'ordini_dopo_visita',   count(*) filter (where x.visto),
                  'lordo_dopo_visita',    coalesce(sum(o.gross_total) filter (where x.visto), 0))
                from shopify_orders o
                cross join lateral (
                  select exists (
                    select 1 from loyalty_order_credits c join loyalty_visits v on v.shopify_customer_id = c.shopify_customer_id
                    where c.order_name = o.order_id
                      and v.day between (o.created_at_shop at time zone 'Europe/Rome')::date - 30 and (o.created_at_shop at time zone 'Europe/Rome')::date
                  ) as visto) x
                where (o.created_at_shop at time zone 'Europe/Rome')::date >= v_from),
    'uplift', (select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) from v_loyalty_uplift u),

    -- Fase 2: funnel del periodo (clienti distinti) + elementi piu' toccati
    'funnel', jsonb_build_object(
      'aperture',       (select count(distinct v.shopify_customer_id) from loyalty_visits v where v.day >= v_from),
      'sessioni',       (select count(*) from loyalty_ui_events u where u.day >= v_from and u.event = 'page_open'),
      'visto_premio',   (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day >= v_from and u.event = 'view' and u.element like 'redeem\_%'),
      'premio_pronto',  (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day >= v_from and u.event = 'view' and u.element = 'redeem_ready'),
      'tap_riscatta',   (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day >= v_from and u.event = 'tap' and u.element = 'redeem'),
      'riscatti',       (select count(distinct r.shopify_customer_id) from loyalty_redemptions r where r.status = 'fulfilled' and (r.created_at at time zone 'Europe/Rome')::date >= v_from),
      'ordini_amica12', (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and (o.created_at_shop at time zone 'Europe/Rome')::date >= v_from),
      'eventi',         (select count(*) from loyalty_ui_events u where u.day >= v_from),
      'dal',            (select min(u.day) from loyalty_ui_events u)),
    'elementi', (select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'element', e.element, 'n', e.n, 'clienti', e.clienti) order by e.n desc), '[]'::jsonb)
                 from (select u.event, u.element, count(*) n, count(distinct u.shopify_customer_id) clienti
                       from loyalty_ui_events u where u.day >= v_from and u.event <> 'page_open'
                       group by 1, 2 order by 3 desc limit 30) e)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.loyalty_dashboard(integer) from anon, public;
grant execute on function public.loyalty_dashboard(integer) to authenticated;
