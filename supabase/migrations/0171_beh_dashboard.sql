-- 0171_beh_dashboard.sql (2026-10-25): modulo beh_*, passo 3 della Fase 3: viste aggregate e RPC della tab
-- "Comportamento". Disegno: 04_DESIGN_ECOSISTEMA.md sez. 3 (definizioni), 7 (viste e RPC) e 8 (card).
--
-- Viste normali (coi diritti del proprietario, senza security_invoker): leggono anche meta_ads_creative_daily, che ha
-- RLS senza policy e darebbe 0 righe in silenzio a una vista security_invoker letta da altri. Revocate ad anon e
-- authenticated, concesse in lettura ad ask_ro (Cowork e "Chiedi ad Amimi'", decisione D7 del 25-10): solo aggregati.
-- La tab legge tutto dalla RPC beh_dashboard (security definer, cancello email_del_team, stampo loyalty_dashboard 0161).
-- Ridefinisce anche beh_health_check (stessa firma e stessi diritti della 0169): giri del solo cron e copertura a 35 giorni.
-- Rollback: beh_enabled a 'false' (la RPC risponde {state:'off'}, la tab si nasconde, beh_health_check tace).
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

-- Un giorno e' "letto" da un passo se un giro RIUSCITO (status ok) del passo lo aveva nella finestra e si e' chiuso dopo la
-- fine del giorno a Roma. Solo allora "nessuna riga" vuol dire davvero zero (nessun ordine, nessuna consegna Meta); un giro
-- 'warn' (per esempio 0 righe su piu' giorni) non conta, perche' e' la edge che dice di non fidarsi (terzo giro del 26-10).
create or replace function public.beh_giorno_letto(p_step text, p_day date) returns boolean
language sql stable set search_path to 'public' as $fn$
  select exists (select 1 from beh_sync_runs r
                  where r.step = p_step and r.status = 'ok'
                    and r.window_from <= p_day and r.window_to > p_day
                    and r.ended_at >= ((p_day + 1)::timestamp at time zone 'Europe/Rome'))
$fn$;
revoke all on function public.beh_giorno_letto(text, date) from public, anon, authenticated;
grant execute on function public.beh_giorno_letto(text, date) to service_role;

-- RPC della tab. Definizioni della sez. 3 del disegno:
--   quota tracciata = ordini online pronti con visite / ordini online pronti (gli ordini in attribuzione a parte)
--   CPA blended = spesa Meta / tutti gli ordini non di prova e non cancellati, sugli stessi giorni coperti dalla spesa
--   riacquisto 90gg = somma ricomprato_90gg / somma clienti delle coorti con maturita_giorni >= 90
-- Periodi (Gate 2 del passo 3, 25-10): le fonti arrivano a lotti giornalieri, quindi il periodo finisce all'ultimo giorno
-- CHIUSO e coperto dal giro ordini (mai oggi, e ieri solo dopo il giro del mattino); il periodo precedente ha la stessa
-- durata. La spesa Meta si confronta sui soli giorni coperti (fino a meta_ads_creative_daily), con un periodo precedente
-- della stessa lunghezza. Un periodo precedente che comincia prima del primo giorno di una fonte da' null, non un numero
-- parziale (Area Membri dal 21-09, spesa per annuncio dal 20-06, ordini dal backfill).
-- Verifica del 25-10: la spesa conta dal primo giorno della tabella (spesa_dal), e un giorno con click Meta ma senza
-- righe di spesa (ads-sync legge solo ieri e non recupera) rende la spesa del periodo null invece di contarlo 0 euro.
create or replace function public.beh_dashboard(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_days     int  := least(greatest(coalesce(p_days, 30), 1), 365);
  v_today    date := (now() at time zone 'Europe/Rome')::date;
  v_run_day  date;
  v_end      date;
  v_from     date;
  v_pfrom    date;
  v_pto      date;
  v_email    text := coalesce(auth.jwt() ->> 'email', '');
  v_meta_min date;
  v_meta_max date;
  v_mfrom    date;
  v_mend     date;
  v_mlen     int;
  v_buchi    int;
  v_buco_ultimo date;
  v_cbuchi   int;
  v_cbuco_ultimo date;
  v_beh_min  date;
  v_meta_on  boolean;
  v_pbuchi   int;
  v_fresh_ore numeric;
  v_ord_min  date;
  v_vis_min  date;
  v_out      jsonb;
begin
  if not public.email_del_team(v_email) then
    raise exception 'beh_dashboard: riservato agli account del team' using errcode = '42501';
  end if;
  if not exists (select 1 from app_flags where key = 'beh_enabled' and lower(btrim(value, E' \t\r\n')) = 'true') then
    return jsonb_build_object('state', 'off');
  end if;
  -- ultimo giorno completo: il giorno prima dell'ultimo giro ordini riuscito che ha letto il giorno prima e il suo stesso giorno
  select max((r.ended_at at time zone 'Europe/Rome')::date) into v_run_day
    from beh_sync_runs r
   where r.step = 'ordini' and r.status in ('ok', 'warn') and r.ended_at is not null
     and r.window_to > (r.ended_at at time zone 'Europe/Rome')::date
     and r.window_from <= (r.ended_at at time zone 'Europe/Rome')::date - 1;
  v_end   := least(v_today - 1, coalesce(v_run_day, v_today) - 1);
  v_from  := v_end - (v_days - 1);
  v_pto   := v_from - 1;
  v_pfrom := v_pto - (v_days - 1);
  -- spesa: dal primo giorno della tabella all'ultimo, dentro il periodo; tabella vuota = nessun giorno coperto
  select min(date), max(date) into v_meta_min, v_meta_max from meta_ads_creative_daily;
  v_mfrom := greatest(v_from, v_meta_min);
  -- oltre l'ultimo giorno con righe di spesa, i giorni senza consegna letti da un giro Meta riuscito (nessun click) contano
  -- come spesa 0 fino al primo giorno davvero mancante: una pausa delle ads non accorcia la finestra (quarto giro del 26-10)
  select coalesce(min(g.d::date) - 1, v_end) into v_mend
    from generate_series(v_meta_max + 1, v_end, interval '1 day') g(d)
   where exists (select 1 from beh_meta_outbound_daily b where b.date = g.d::date) or not public.beh_giorno_letto('meta', g.d::date);
  v_mend  := case when v_meta_max is null then null else least(v_end, greatest(v_meta_max, v_mend)) end;
  v_mlen  := case when v_mfrom is null or v_mend is null then 0 else greatest(v_mend - v_mfrom + 1, 0) end;
  -- giorni di calendario senza nessuna riga di spesa: la spesa di quei giorni non e' 0, e' mancante. Il testimone e' il
  -- calendario e non i click di beh, che mancano insieme alla spesa quando il token Meta si ferma (secondo giro del 26-10).
  -- Eccezione (terzo giro): se un giro Meta riuscito ha letto il giorno dopo la chiusura e non ha trovato click, le ads non
  -- hanno consegnato e la spesa e' davvero 0. Col passo meta spento quell'eccezione non si vede: n.d., il lato prudente.
  select count(*), max(g.d::date) into v_buchi, v_buco_ultimo
    from generate_series(v_mfrom, v_mend, interval '1 day') g(d)
   where v_mlen > 0 and not exists (select 1 from meta_ads_creative_daily m where m.date = g.d::date)
     and (exists (select 1 from beh_meta_outbound_daily b where b.date = g.d::date) or not public.beh_giorno_letto('meta', g.d::date));
  select count(*) into v_pbuchi
    from generate_series(v_mfrom - v_mlen, v_mfrom - 1, interval '1 day') g(d)
   where v_mlen > 0 and g.d::date >= v_meta_min and not exists (select 1 from meta_ads_creative_daily m where m.date = g.d::date)
     and (exists (select 1 from beh_meta_outbound_daily b where b.date = g.d::date) or not public.beh_giorno_letto('meta', g.d::date));
  -- click Meta mancanti nel periodo (passo meta acceso): giorni senza righe in beh_meta_outbound_daily che nessun giro Meta
  -- riuscito ha letto dopo la chiusura; il funnel delle ads su quei giorni e' parziale
  v_meta_on := exists (select 1 from regexp_split_to_table(coalesce((select value from app_flags where key = 'beh_steps'), ''), ',') as x
                        where lower(btrim(x, E' \t\r\n')) = 'meta');
  select min(date) into v_beh_min from beh_meta_outbound_daily;
  select count(*), max(g.d::date) into v_cbuchi, v_cbuco_ultimo
    from generate_series(greatest(v_from, v_beh_min), v_end, interval '1 day') g(d)
   where v_meta_on and v_beh_min is not null and not exists (select 1 from beh_meta_outbound_daily b where b.date = g.d::date)
     and not public.beh_giorno_letto('meta', g.d::date);
  select p_val into v_fresh_ore from public.beh_flag_num('beh_fresh_ore', 48, '');
  select min(day) into v_ord_min from beh_order_origin;
  select min(day) into v_vis_min from loyalty_visits;

  select jsonb_build_object(
    'state', 'on',
    'generated_at', now(),
    'days', v_days, 'from', v_from, 'to', v_end, 'oggi', v_today, 'prev_from', v_pfrom, 'prev_to', v_pto,
    'steps', (select coalesce(to_jsonb(array_agg(lower(btrim(x, E' \t\r\n'))) filter (where btrim(x, E' \t\r\n') <> '')), '[]'::jsonb)
                from regexp_split_to_table(coalesce((select value from app_flags where key = 'beh_steps'), ''), ',') as x),

    -- card 0: ordini online e quota tracciata, periodo e periodo precedente (null se comincia prima dei dati), serie
    'ordini', (select jsonb_build_object(
        'fonte', 'Shopify, origine degli ordini (beh_order_origin)',
        'dati_al', (select max(synced_at) from beh_order_origin),
        'online',            coalesce(sum(d.ordini) filter (where d.day between v_from and v_end and d.canale = 'online_store'), 0),
        'online_pronti',     coalesce(sum(d.pronti) filter (where d.day between v_from and v_end and d.canale = 'online_store'), 0),
        'online_tracciati',  coalesce(sum(d.tracciati) filter (where d.day between v_from and v_end and d.canale = 'online_store'), 0),
        'in_attribuzione',   coalesce(sum(d.in_attribuzione) filter (where d.day between v_from and v_end and d.canale = 'online_store'), 0),
        'prev_online_pronti',    case when v_ord_min is null or v_pfrom < v_ord_min then null
                                      else coalesce(sum(d.pronti) filter (where d.day between v_pfrom and v_pto and d.canale = 'online_store'), 0) end,
        'prev_online_tracciati', case when v_ord_min is null or v_pfrom < v_ord_min then null
                                      else coalesce(sum(d.tracciati) filter (where d.day between v_pfrom and v_pto and d.canale = 'online_store'), 0) end,
        'tutti',       coalesce(sum(d.ordini) filter (where d.day between v_from and v_end), 0),
        'prev_tutti',  case when v_ord_min is null or v_pfrom < v_ord_min then null
                            else coalesce(sum(d.ordini) filter (where d.day between v_pfrom and v_pto), 0) end,
        'lordo',       coalesce(sum(d.lordo) filter (where d.day between v_from and v_end), 0),
        'per_canale', (select coalesce(jsonb_object_agg(c.canale, c.n), '{}'::jsonb)
                         from (select canale, sum(ordini) as n from v_beh_ordini_daily where day between v_from and v_end group by canale) c),
        'giorni', (select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'online', g.online, 'tracciati', g.tracciati) order by g.day), '[]'::jsonb)
                     from (select gs::date as day,
                                  coalesce((select sum(pronti) from v_beh_ordini_daily x where x.day = gs::date and x.canale = 'online_store'), 0) as online,
                                  coalesce((select sum(tracciati) from v_beh_ordini_daily x where x.day = gs::date and x.canale = 'online_store'), 0) as tracciati
                             from generate_series(v_from, v_end, interval '1 day') gs) g))
      from (select day, canale, ordini, pronti, tracciati, in_attribuzione, lordo from v_beh_ordini_daily
             where day between v_pfrom and v_end) d),

    -- card 3: da dove arrivano gli ordini (prima e ultima visita), spesa Meta e CPA sui giorni coperti, funnel delle ads
    'fonti', jsonb_build_object(
        'fonte', 'Shopify (prima e ultima visita degli ordini online), Meta (spesa da meta_ads_creative_daily, click da beh_meta_outbound_daily)',
        'ultima_visita', (select coalesce(jsonb_object_agg(s.last_src, s.n), '{}'::jsonb)
                            from (select o.last_src, count(*) as n from beh_order_origin o
                                   where o.canale = 'online_store' and not o.is_test and not o.is_cancelled and o.ready and o.day between v_from and v_end
                                   group by o.last_src) s),
        'prima_visita', (select coalesce(jsonb_object_agg(s.first_src, s.n), '{}'::jsonb)
                           from (select o.first_src, count(*) as n from beh_order_origin o
                                  where o.canale = 'online_store' and not o.is_test and not o.is_cancelled and o.ready and o.day between v_from and v_end
                                  group by o.first_src) s),
        'meta_dati_al', v_meta_max,
        'spesa_dal', case when v_mlen > 0 then v_mfrom end,
        'giorni_spesa', v_mlen,
        'giorni_spesa_mancanti', v_buchi,
        'ultimo_giorno_spesa_mancante', v_buco_ultimo,
        'giorni_spesa_mancanti_prima', v_pbuchi,
        'spesa_meta', case when v_mlen = 0 or v_buchi > 0 then null
                           else (select coalesce(round(sum(spend), 2), 0) from meta_ads_creative_daily where date between v_mfrom and v_mend) end,
        'ordini_cpa', case when v_mlen = 0 then 0
                           else (select count(*) from beh_order_origin o where not o.is_test and not o.is_cancelled and o.day between v_mfrom and v_mend) end,
        'prev_spesa_meta', case when v_mlen = 0 or v_mfrom - v_mlen < v_meta_min or v_pbuchi > 0 then null
                                else (select coalesce(round(sum(spend), 2), 0) from meta_ads_creative_daily where date between v_mfrom - v_mlen and v_mfrom - 1) end,
        'prev_ordini_cpa', case when v_mlen = 0 or v_mfrom - v_mlen < v_meta_min or v_pbuchi > 0 or v_ord_min is null or v_mfrom - v_mlen < v_ord_min then null
                                else (select count(*) from beh_order_origin o where not o.is_test and not o.is_cancelled
                                        and o.day between v_mfrom - v_mlen and v_mfrom - 1) end,
        'giorni_click_mancanti', v_cbuchi,
        'ultimo_giorno_click_mancante', v_cbuco_ultimo,
        'ads', (select jsonb_build_object('link_clicks', coalesce(sum(link_clicks), 0), 'outbound_clicks', coalesce(sum(outbound_clicks), 0),
                                          'landing_page_views', coalesce(sum(landing_page_views), 0), 'dati_al', max(date))
                  from beh_meta_outbound_daily where date between v_from and v_end)),

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
        'aperture',      (select count(distinct v.shopify_customer_id) from loyalty_visits v where v.day between v_from and v_end),
        'premio_pronto', (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day between v_from and v_end and u.event = 'view' and u.element = 'redeem_ready'),
        'tap_riscatta',  (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day between v_from and v_end and u.event = 'tap' and u.element = 'redeem'),
        'riscatti',      (select count(distinct r.shopify_customer_id) from loyalty_redemptions r where r.status = 'fulfilled'
                            and (r.created_at at time zone 'Europe/Rome')::date between v_from and v_end),
        'ordini_amica12', (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%'
                             and o.financial_status in ('paid', 'partially_refunded', 'refunded')
                             and (o.created_at_shop at time zone 'Europe/Rome')::date between v_from and v_end),
        'prev_aperture', case when v_vis_min is null or v_pfrom < v_vis_min then null
                              else (select count(distinct v.shopify_customer_id) from loyalty_visits v where v.day between v_pfrom and v_pto) end,
        -- i passaggi "premio pronto" e "tap su Riscatta" vengono dal tracciamento dei tap: primo giorno con dati (la pulizia a
        -- 180 giorni lo sposta in avanti, quindi la pagina dice "dati dal", non "attivo dal")
        'tap_dal', (select min(u.day) from loyalty_ui_events u)),

    -- card 8: salute delle fonti (ultimo giro del CRON per passo: un backfill o un run a mano non dicono se il cron gira)
    'salute', jsonb_build_object(
        -- soglia_ore = la stessa di beh_fresh in beh_health_check (settimanali 8 giorni, gli altri beh_fresh_ore)
        'giri', (select coalesce(jsonb_agg(jsonb_build_object('step', r.step, 'status', r.status, 'ended_at', r.ended_at, 'rows_written', r.rows_written,
                                                              'window_to', r.window_to,
                                                              'soglia_ore', case when r.step in ('crux', 'psi') then 8 * 24 else v_fresh_ore end) order by r.step), '[]'::jsonb)
                   from (select distinct on (step) step, status, ended_at, rows_written, window_to from beh_sync_runs
                          where status <> 'running' and action = 'run' and source = 'cron' order by step, started_at desc) r),
        'health', (select coalesce(jsonb_agg(jsonb_build_object('k', h.k, 'label', h.label, 'severity', h.severity, 'day', h.day) order by h.k), '[]'::jsonb)
                     from (select distinct on (k) k, label, severity, day from health_log
                            where k like 'beh\_%' and day >= v_today - 7 order by k, day desc) h))
  ) into v_out;
  return v_out;
end $fn$;

revoke all on function public.beh_dashboard(integer) from public, anon;
grant execute on function public.beh_dashboard(integer) to authenticated;

-- Salute del modulo, versione della 0171 (verifica avversariale del 25-10). Uguale alla 0169 piu' due cose:
--   (1) beh_fresh conta i soli giri del cron (source 'cron'): un run lanciato a mano non dice se il cron gira;
--   (2) beh_copertura (warn): un giro rilegge solo 7 giorni, quindi un buco piu' lungo (edge ferma, flag spento e poi
--       riacceso) resterebbe per sempre senza allarme. Sugli ultimi 35 giorni chiusi di Roma: ordini di shopify_orders
--       (aggiornata ogni ora da shopify-sync) contro beh_order_origin e giorni con spesa senza click, sui soli giorni mai
--       riletti da un giro riuscito; giorni di calendario senza righe di spesa (ads-sync legge solo ieri e non recupera).
--       Il rimedio e' un backfill dei giorni detti: di beh-sync per ordini e click, di ads-sync per la spesa.
create or replace function public.beh_health_check() returns void
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_steps text[];
  v_bad text := '';
  v_fresh_ore numeric;
  v_min_pct numeric;
  v_min_ord numeric;
  v_guasto_min numeric;
  v_s text;
  v_last timestamptz;
  v_stale text;
  v_n int;
  v_trk int;
  v_oggi date := (now() at time zone 'Europe/Rome')::date;
  v_meta_max date;
  v_meta_min date;
  v_beh_min date;
  v_buchi text;
  v_txt text;
  v_k int;
begin
  if not exists (select 1 from app_flags where key = 'beh_enabled' and lower(btrim(value, E' \t\r\n')) = 'true') then
    return;
  end if;
  select coalesce(array_agg(lower(btrim(x, E' \t\r\n'))) filter (where btrim(x, E' \t\r\n') <> ''), '{}') into v_steps
    from regexp_split_to_table(coalesce((select value from app_flags where key = 'beh_steps'), ''), ',') as x;

  select p_bad, p_val into v_bad, v_fresh_ore from public.beh_flag_num('beh_fresh_ore', 48, v_bad);
  select p_bad, p_val into v_bad, v_min_pct from public.beh_flag_num('beh_tracciata_min_pct', 60, v_bad);
  select p_bad, p_val into v_bad, v_min_ord from public.beh_flag_num('beh_tracciata_min_ordini', 80, v_bad);
  select p_bad, p_val into v_bad, v_guasto_min from public.beh_flag_num('beh_guasto_min_ordini', 5, v_bad);

  -- beh_fresh: ogni passo acceso deve avere un giro del CRON riuscito (ok o warn) entro la sua soglia
  foreach v_s in array v_steps loop
    select max(r.ended_at) into v_last from beh_sync_runs r
     where r.step = v_s and r.action = 'run' and r.source = 'cron' and r.status in ('ok', 'warn');
    if v_last is null or v_last < now() - make_interval(hours => (case when v_s in ('crux', 'psi') then 8 * 24 else v_fresh_ore end)::int) then
      v_stale := concat_ws(', ', v_stale, v_s || coalesce(' (ultimo ' || to_char(v_last at time zone 'Europe/Rome', 'DD-MM HH24:MI') || ')', ' (mai)'));
    end if;
  end loop;
  -- spesa ferma: dopo l'ultimo giorno con righe resta un giorno (fino a ieri) che non e' "nessuna consegna" letta da un giro
  -- Meta riuscito. Con le ads in pausa i giorni senza righe ma letti senza click non sono un fermo (quarto giro del 26-10)
  if 'meta' = any(v_steps) then
    select max(date) into v_meta_max from meta_ads_creative_daily;
    if v_meta_max is null or exists (select 1 from generate_series(v_meta_max + 1, v_oggi - 1, interval '1 day') g(d)
                                      where exists (select 1 from beh_meta_outbound_daily b where b.date = g.d::date)
                                         or not public.beh_giorno_letto('meta', g.d::date)) then
      v_stale := concat_ws(', ', v_stale, 'meta_ads_creative_daily ferma al ' || coalesce(to_char(v_meta_max, 'DD-MM'), 'mai'));
    end if;
  end if;
  insert into health_log (day, k, label, n, severity, created_at)
  values (current_date, 'beh_fresh',
          case when v_stale is not null then 'fermi: ' || v_stale
               when cardinality(v_steps) = 0 then 'nessun passo acceso'
               else 'passi accesi: ' || array_to_string(v_steps, ', ') || ', giri recenti' end
            || case when v_bad <> '' then '; soglie non valide (uso il default): ' || v_bad else '' end,
          (case when v_stale is not null then 1 else 0 end),
          case when v_stale is not null or v_bad <> '' then 'error' else 'ok' end,
          now())
  on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = excluded.created_at;

  if 'ordini' = any(v_steps) then
    -- guasto: nessun ordine online tracciato nelle ultime 48 ore su almeno beh_guasto_min_ordini ordini
    select count(*), count(*) filter (where o.moments > 0) into v_n, v_trk
      from beh_order_origin o
     where o.canale = 'online_store' and not o.is_test and not o.is_cancelled and o.ready
       and o.created_at_shop >= now() - interval '48 hours';
    insert into health_log (day, k, label, n, severity, created_at)
    values (current_date, 'beh_tracciamento_guasto',
            'ultime 48 ore: ' || v_n || ' ordini online, ' || v_trk || ' con visite registrate'
              || case when v_n >= greatest(v_guasto_min, 1) and v_trk = 0 then ' (tag o banner da controllare)' else '' end,
            v_n - v_trk,
            case when v_n >= greatest(v_guasto_min, 1) and v_trk = 0 then 'error' else 'ok' end,
            now())
    on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = excluded.created_at;

    -- deriva: quota tracciata degli ultimi 28 giorni interi di Roma, solo con abbastanza ordini (rumore binomiale)
    select count(*), count(*) filter (where o.moments > 0) into v_n, v_trk
      from beh_order_origin o
     where o.canale = 'online_store' and not o.is_test and not o.is_cancelled and o.ready
       and o.day >= v_oggi - 28 and o.day < v_oggi;
    insert into health_log (day, k, label, n, severity, created_at)
    values (current_date, 'beh_quota_tracciata',
            case when v_n < v_min_ord then 'quota tracciata 28 giorni: pochi ordini (' || v_n || ', servono ' || v_min_ord || ')'
                 else 'quota tracciata 28 giorni: ' || coalesce(replace(to_char(round(100.0 * v_trk / nullif(v_n, 0), 1), 'FM990.0'), '.', ','), '-') || '% ('
                      || v_trk || ' su ' || v_n || ' ordini online), soglia ' || v_min_pct || '%' end,
            v_n,
            case when v_n > 0 and v_n >= v_min_ord and 100.0 * v_trk / nullif(v_n, 0) < v_min_pct then 'warn' else 'ok' end,
            now())
    on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = excluded.created_at;
  end if;

  -- copertura degli ultimi 35 giorni chiusi (vedi l'intestazione)
  -- ogni sezione elenca al massimo i 6 giorni piu' recenti piu' "e altri N": con un'etichetta tagliata, tanti giorni di
  -- ordini mancanti nasconderebbero la spesa mancante (prova del 26-10)
  -- Lato beh (ordini e click) solo i giorni che il cron non rileggera' piu' ([oggi-35, oggi-7)) e che nessun giro riuscito
  -- ha letto dopo la loro chiusura (beh_giorno_letto): un ordine cancellato in Shopify dopo la lettura non e' un buco e
  -- nessun backfill lo riporterebbe. Lato spesa (ads-sync, che non rilegge mai i giorni passati) ogni giorno di calendario
  -- chiuso senza righe, salvo i giorni che un giro Meta riuscito ha letto senza trovare click (ads ferme, spesa 0).
  if 'ordini' = any(v_steps) or 'meta' = any(v_steps) then
    if 'ordini' = any(v_steps) then
      select count(*), string_agg(z.t, ', ' order by z.d) filter (where z.rn <= 6) into v_k, v_txt
        from (select g.d, to_char(g.d, 'DD-MM') || ' (' || g.beh || ' su ' || g.so || ')' as t, row_number() over (order by g.d desc) as rn
                from (select s.d, s.n as so, coalesce(b.n, 0) as beh
                        from (select (o.created_at_shop at time zone 'Europe/Rome')::date as d, count(*) as n from shopify_orders o
                               where o.created_at_shop >= ((v_oggi - 35)::timestamp at time zone 'Europe/Rome')
                                 and o.created_at_shop < ((v_oggi - 7)::timestamp at time zone 'Europe/Rome')
                               group by 1) s
                        left join (select b2.day as d, count(*) as n from beh_order_origin b2 where b2.day >= v_oggi - 35 and b2.day < v_oggi - 7 group by 1) b on b.d = s.d
                       where coalesce(b.n, 0) < s.n and not public.beh_giorno_letto('ordini', s.d)) g) z;
      if v_k > 0 then v_buchi := concat_ws('; ', v_buchi, 'ordini mancanti il ' || v_txt || case when v_k > 6 then ' e altri ' || (v_k - 6) || ' giorni' else '' end); end if;
    end if;
    select min(date) into v_meta_min from meta_ads_creative_daily;
    select count(*), string_agg(to_char(z.d, 'DD-MM'), ', ' order by z.d) filter (where z.rn <= 6) into v_k, v_txt
      from (select g.d::date as d, row_number() over (order by g.d desc) as rn
              -- fino all'altro ieri: ieri lo legge ads-sync alle 06:07 UTC, e se manca lo dice gia' beh_fresh col passo meta
              from generate_series(greatest(v_oggi - 35, v_meta_min), v_oggi - 2, interval '1 day') g(d)
             where v_meta_min is not null and not exists (select 1 from meta_ads_creative_daily m where m.date = g.d::date)
               and (exists (select 1 from beh_meta_outbound_daily b where b.date = g.d::date) or not public.beh_giorno_letto('meta', g.d::date))) z;
    if v_k > 0 then v_buchi := concat_ws('; ', v_buchi, 'spesa Meta mancante (ads-sync) il ' || v_txt || case when v_k > 6 then ' e altri ' || (v_k - 6) || ' giorni' else '' end); end if;
    if 'meta' = any(v_steps) then
      -- testimone il calendario anche per i click: un fermo del token toglie spesa e click insieme
      select min(date) into v_beh_min from beh_meta_outbound_daily;
      select count(*), string_agg(to_char(z.d, 'DD-MM'), ', ' order by z.d) filter (where z.rn <= 6) into v_k, v_txt
        from (select g.d::date as d, row_number() over (order by g.d desc) as rn
                from generate_series(greatest(v_oggi - 35, v_beh_min), v_oggi - 8, interval '1 day') g(d)
               where v_beh_min is not null and not exists (select 1 from beh_meta_outbound_daily b where b.date = g.d::date)
                 and not public.beh_giorno_letto('meta', g.d::date)) z;
      if v_k > 0 then v_buchi := concat_ws('; ', v_buchi, 'click Meta mancanti il ' || v_txt || case when v_k > 6 then ' e altri ' || (v_k - 6) || ' giorni' else '' end); end if;
    end if;
    insert into health_log (day, k, label, n, severity, created_at)
    values (current_date, 'beh_copertura',
            coalesce(left(v_buchi, 460) || ': lanciare un backfill di quei giorni', 'ultimi 35 giorni chiusi: nessun giorno mancante'),
            (case when v_buchi is null then 0 else 1 end),
            case when v_buchi is null then 'ok' else 'warn' end,
            now())
    on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = excluded.created_at;
  end if;

  -- 400 giorni e non 180 come nella 0169: beh_giorno_letto usa i giri come prova di lettura e il periodo della tab arriva
  -- a 365 giorni (pochi righe al giorno, nessun dato del cliente)
  delete from beh_sync_runs where started_at < now() - interval '400 days';
end $fn$;
revoke all on function public.beh_health_check() from public, anon, authenticated;
grant execute on function public.beh_health_check() to service_role;

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
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, 'public.beh_health_check()', 'execute') or has_function_privilege(r, 'public.beh_giorno_letto(text, date)', 'execute') then
      raise exception '0171: % puo'' eseguire beh_health_check o beh_giorno_letto', r;
    end if;
  end loop;
end $$;

commit;
