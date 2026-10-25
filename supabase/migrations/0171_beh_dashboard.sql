-- 0171_beh_dashboard.sql (2026-10-25): modulo beh_*, passo 3 della Fase 3: viste aggregate e RPC della tab
-- "Comportamento". Disegno: 04_DESIGN_ECOSISTEMA.md sez. 3 (definizioni), 7 (viste e RPC) e 8 (card).
--
-- Viste normali (coi diritti del proprietario, senza security_invoker): leggono anche meta_ads_creative_daily, che ha
-- RLS senza policy e darebbe 0 righe in silenzio a una vista security_invoker letta da altri. Revocate ad anon e
-- authenticated, concesse in lettura ad ask_ro (Cowork e "Chiedi ad Amimi'", decisione D7 del 25-10): solo aggregati.
-- La tab legge tutto dalla RPC beh_dashboard (security definer, cancello email_del_team, stampo loyalty_dashboard 0161).
-- Rollback: beh_enabled a 'false' (la RPC risponde {state:'off'} e la tab si nasconde).
begin;

-- ordini per giorno di Roma e canale: tutti, pronti (attribuzione finita), tracciati (con visite), in attribuzione, lordo
create or replace view v_beh_ordini_daily as
select o.day, o.canale,
       count(*)                                         as ordini,
       count(*) filter (where o.ready)                  as pronti,
       count(*) filter (where o.ready and o.moments > 0) as tracciati,
       count(*) filter (where not o.ready)              as in_attribuzione,
       round(coalesce(sum(s.gross_total), 0), 2)        as lordo
  from beh_order_origin o
  left join shopify_orders s on s.order_id = o.order_name
 where not o.is_test and not o.is_cancelled
 group by o.day, o.canale;

-- ordini online per mese e classe dell'ultima e della prima visita (solo ordini con attribuzione finita)
create or replace view v_beh_attribuzione_mensile as
select date_trunc('month', o.day)::date as mese, o.last_src, o.first_src,
       count(*) as ordini,
       round(coalesce(sum(s.gross_total), 0), 2) as lordo
  from beh_order_origin o
  left join shopify_orders s on s.order_id = o.order_name
 where o.canale = 'online_store' and not o.is_test and not o.is_cancelled and o.ready
 group by 1, 2, 3;

-- funnel delle ads per giorno: link, outbound e LPV dalla stessa lettura (beh_meta_outbound_daily), spesa dal modulo ads
create or replace view v_beh_ads_funnel_daily as
select coalesce(b.date, m.date) as date,
       b.link_clicks, b.outbound_clicks, b.landing_page_views,
       m.spend
  from (select date, sum(link_clicks) as link_clicks, sum(outbound_clicks) as outbound_clicks, sum(landing_page_views) as landing_page_views
          from beh_meta_outbound_daily group by date) b
  full join (select date, round(sum(spend), 2) as spend from meta_ads_creative_daily group by date) m on m.date = b.date;

revoke all on v_beh_ordini_daily, v_beh_attribuzione_mensile, v_beh_ads_funnel_daily from public, anon, authenticated;
grant select on v_beh_ordini_daily, v_beh_attribuzione_mensile, v_beh_ads_funnel_daily to ask_ro;

-- RPC della tab. Periodo = ultimi p_days giorni di Roma, oggi compreso (come loyalty_dashboard); periodo precedente
-- della stessa durata per le frecce. Definizioni della sez. 3 del disegno:
--   quota tracciata = ordini online pronti con visite / ordini online pronti (gli ordini in attribuzione a parte)
--   CPA blended = spesa Meta / tutti gli ordini non di prova e non cancellati, sugli stessi giorni coperti dalla spesa
--   riacquisto 90gg = somma ricomprato_90gg / somma clienti delle coorti con maturita_giorni >= 90
create or replace function public.beh_dashboard(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_days   int  := least(greatest(coalesce(p_days, 30), 1), 365);
  v_today  date := (now() at time zone 'Europe/Rome')::date;
  v_from   date;
  v_pfrom  date;
  v_pto    date;
  v_email  text := coalesce(auth.jwt() ->> 'email', '');
  v_meta_max date;
  v_out    jsonb;
begin
  if not public.email_del_team(v_email) then
    raise exception 'beh_dashboard: riservato agli account del team' using errcode = '42501';
  end if;
  if not exists (select 1 from app_flags where key = 'beh_enabled' and lower(btrim(value, E' \t\r\n')) = 'true') then
    return jsonb_build_object('state', 'off');
  end if;
  v_from  := v_today - (v_days - 1);
  v_pto   := v_from - 1;
  v_pfrom := v_pto - (v_days - 1);
  select max(date) into v_meta_max from meta_ads_creative_daily;

  select jsonb_build_object(
    'state', 'on',
    'generated_at', now(),
    'days', v_days, 'from', v_from, 'to', v_today, 'prev_from', v_pfrom, 'prev_to', v_pto,
    'steps', (select coalesce(to_jsonb(array_agg(lower(btrim(x, E' \t\r\n'))) filter (where btrim(x, E' \t\r\n') <> '')), '[]'::jsonb)
                from regexp_split_to_table(coalesce((select value from app_flags where key = 'beh_steps'), ''), ',') as x),

    -- card 0: ordini online e quota tracciata, periodo e periodo precedente, piu' la serie giornaliera
    'ordini', (select jsonb_build_object(
        'fonte', 'Shopify, origine degli ordini (beh_order_origin)',
        'dati_al', (select max(synced_at) from beh_order_origin),
        'online',            coalesce(sum(d.ordini) filter (where d.day >= v_from and d.canale = 'online_store'), 0),
        'online_pronti',     coalesce(sum(d.pronti) filter (where d.day >= v_from and d.canale = 'online_store'), 0),
        'online_tracciati',  coalesce(sum(d.tracciati) filter (where d.day >= v_from and d.canale = 'online_store'), 0),
        'in_attribuzione',   coalesce(sum(d.in_attribuzione) filter (where d.day >= v_from and d.canale = 'online_store'), 0),
        'prev_online_pronti',    coalesce(sum(d.pronti) filter (where d.day between v_pfrom and v_pto and d.canale = 'online_store'), 0),
        'prev_online_tracciati', coalesce(sum(d.tracciati) filter (where d.day between v_pfrom and v_pto and d.canale = 'online_store'), 0),
        'tutti',       coalesce(sum(d.ordini) filter (where d.day >= v_from), 0),
        'prev_tutti',  coalesce(sum(d.ordini) filter (where d.day between v_pfrom and v_pto), 0),
        'lordo',       coalesce(sum(d.lordo) filter (where d.day >= v_from), 0),
        'per_canale', (select coalesce(jsonb_object_agg(c.canale, c.n), '{}'::jsonb)
                         from (select canale, sum(ordini) as n from v_beh_ordini_daily where day >= v_from group by canale) c),
        'giorni', (select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'online', g.online, 'tracciati', g.tracciati) order by g.day), '[]'::jsonb)
                     from (select gs::date as day,
                                  coalesce((select sum(pronti) from v_beh_ordini_daily x where x.day = gs::date and x.canale = 'online_store'), 0) as online,
                                  coalesce((select sum(tracciati) from v_beh_ordini_daily x where x.day = gs::date and x.canale = 'online_store'), 0) as tracciati
                             from generate_series(v_from, v_today, interval '1 day') gs) g))
      from (select day, canale, ordini, pronti, tracciati, in_attribuzione, lordo from v_beh_ordini_daily
             where day >= v_pfrom) d),

    -- card 3: da dove arrivano gli ordini (ultima visita), spesa Meta, CPA blended, funnel delle ads
    'fonti', jsonb_build_object(
        'fonte', 'Shopify (ultima visita degli ordini online), Meta (spesa da meta_ads_creative_daily, click da beh_meta_outbound_daily)',
        'ultima_visita', (select coalesce(jsonb_object_agg(s.last_src, s.n), '{}'::jsonb)
                            from (select o.last_src, count(*) as n from beh_order_origin o
                                   where o.canale = 'online_store' and not o.is_test and not o.is_cancelled and o.ready and o.day >= v_from
                                   group by o.last_src) s),
        'prima_visita', (select coalesce(jsonb_object_agg(s.first_src, s.n), '{}'::jsonb)
                           from (select o.first_src, count(*) as n from beh_order_origin o
                                  where o.canale = 'online_store' and not o.is_test and not o.is_cancelled and o.ready and o.day >= v_from
                                  group by o.first_src) s),
        'meta_dati_al', v_meta_max,
        'spesa_meta', (select coalesce(round(sum(spend), 2), 0) from meta_ads_creative_daily where date between v_from and least(v_today, coalesce(v_meta_max, v_from - 1))),
        'ordini_cpa', (select count(*) from beh_order_origin o where not o.is_test and not o.is_cancelled
                         and o.day between v_from and least(v_today, coalesce(v_meta_max, v_from - 1))),
        'prev_spesa_meta', (select coalesce(round(sum(spend), 2), 0) from meta_ads_creative_daily where date between v_pfrom and v_pto),
        'prev_ordini_cpa', (select count(*) from beh_order_origin o where not o.is_test and not o.is_cancelled and o.day between v_pfrom and v_pto),
        'ads', (select jsonb_build_object('link_clicks', coalesce(sum(link_clicks), 0), 'outbound_clicks', coalesce(sum(outbound_clicks), 0),
                                          'landing_page_views', coalesce(sum(landing_page_views), 0), 'dati_al', max(date))
                  from beh_meta_outbound_daily where date >= v_from)),

    -- card 5: clienti (tutta la storia, non segue il periodo)
    'clienti', jsonb_build_object(
        'fonte', 'Supabase, v_clienti_rfm e v_clienti_coorti',
        'clienti',      (select count(*) from v_clienti_rfm),
        'con_2_ordini', (select count(*) from v_clienti_rfm where frequency >= 2),
        'riacquisto_90', (select jsonb_build_object('ricomprato', coalesce(sum(ricomprato_90gg), 0), 'clienti', coalesce(sum(clienti), 0))
                            from v_clienti_coorti where maturita_giorni >= 90),
        'coorti', (select coalesce(jsonb_agg(jsonb_build_object('coorte', c.coorte, 'maturita_giorni', c.maturita_giorni, 'clienti', c.clienti,
                                                                'ricomprato_90gg', c.ricomprato_90gg) order by c.coorte), '[]'::jsonb)
                     from v_clienti_coorti c)),

    -- card 6: Area Membri, stesse definizioni del funnel di loyalty_dashboard (clienti distinti nel periodo)
    'premia', jsonb_build_object(
        'fonte', 'Area Membri (loyalty_visits, loyalty_ui_events, loyalty_redemptions), come la tab Premia',
        'aperture',      (select count(distinct v.shopify_customer_id) from loyalty_visits v where v.day >= v_from),
        'premio_pronto', (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day >= v_from and u.event = 'view' and u.element = 'redeem_ready'),
        'tap_riscatta',  (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day >= v_from and u.event = 'tap' and u.element = 'redeem'),
        'riscatti',      (select count(distinct r.shopify_customer_id) from loyalty_redemptions r where r.status = 'fulfilled' and (r.created_at at time zone 'Europe/Rome')::date >= v_from),
        'ordini_amica12', (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%'
                             and o.financial_status in ('paid', 'partially_refunded', 'refunded')
                             and (o.created_at_shop at time zone 'Europe/Rome')::date >= v_from),
        'prev_aperture', (select count(distinct v.shopify_customer_id) from loyalty_visits v where v.day between v_pfrom and v_pto)),

    -- card 8: salute delle fonti
    'salute', jsonb_build_object(
        'giri', (select coalesce(jsonb_agg(jsonb_build_object('step', r.step, 'status', r.status, 'ended_at', r.ended_at, 'rows_written', r.rows_written,
                                                              'window_to', r.window_to) order by r.step), '[]'::jsonb)
                   from (select distinct on (step) step, status, ended_at, rows_written, window_to from beh_sync_runs
                          where status <> 'running' order by step, started_at desc) r),
        'health', (select coalesce(jsonb_agg(jsonb_build_object('k', h.k, 'label', h.label, 'severity', h.severity, 'day', h.day) order by h.k), '[]'::jsonb)
                     from (select distinct on (k) k, label, severity, day from health_log
                            where k like 'beh\_%' and day >= v_today - 7 order by k, day desc) h))
  ) into v_out;
  return v_out;
end $fn$;

revoke all on function public.beh_dashboard(integer) from public, anon;
grant execute on function public.beh_dashboard(integer) to authenticated;

do $$
declare
  r name;
  v text;
begin
  foreach v in array array['v_beh_ordini_daily', 'v_beh_attribuzione_mensile', 'v_beh_ads_funnel_daily'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_table_privilege(r, 'public.' || v, 'select, insert, update, delete') then
        raise exception '0171: % legge o scrive %', r, v;
      end if;
    end loop;
    if not has_table_privilege('ask_ro', 'public.' || v, 'select') then
      raise exception '0171: ask_ro non legge %', v;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.beh_dashboard(integer)', 'execute') then
    raise exception '0171: anon puo'' eseguire beh_dashboard';
  end if;
  if not has_function_privilege('authenticated', 'public.beh_dashboard(integer)', 'execute') then
    raise exception '0171: authenticated non puo'' eseguire beh_dashboard (la tab non funzionerebbe)';
  end if;
end $$;

commit;
