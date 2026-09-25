-- 0142 (Premia, 22-09 sera): chiusura dei finding di Gate 2 sulla 0141 + Parte D del brief M4b (premio unico 100 pt = 12%).
-- Additiva come la 0141 (Regola 19), stessi flag, nessuna scrittura su tabelle core.
--
-- Gate 2 (revisore indipendente sul diff, 22-09):
--   A1  loyalty_events.meta e' leggibile da ask_ro (grant di 0121): l'evento 'birthday' non deve portare la data intera,
--       solo l'anno (che serve all'indice UNIQUE). La 0141 ci metteva anche 'birthday' = giorno e mese: tolto.
--   B1  lo storno del bonus era agganciato al "secondo ordine" ricalcolato dalla vista (rn = 2), che puo' cambiare se
--       arriva una riga in shopify_orders con data diversa: ora guarda l'ordine SALVATO in loyalty_bonus_second.second_order_id.
--   B2  il cursore loyalty_bonus_second_since veniva scritto dentro il blocco con exception: un errore lo annullava e il
--       giro dopo lo rifissava piu' avanti, saltando ordini. Ora si scrive PRIMA del blocco, una volta sola.
--   B3  la pagina promette "entro il <data>" ma la finestra confrontava timestamp: ora entro_90gg e deadline sono date
--       Europe/Rome (un ordine il giorno della scadenza vale, a qualunque ora); la RPC di stato restituisce anche days_left.
--   C1  second_fully_refunded era NULL con order_total NULL (accrediti legacy a 4 argomenti): ora e' sempre booleano.
--   C2  in errore health_log.n riportava accrediti poi annullati: ora 0.
--
-- Parte D (owner 22-09 sera): premio unico 100 punti = codice 12% al posto di 200 = 20%. Riga NUOVA 'tessera12' con
--   active = false; l'accensione e' un solo UPDATE dell'owner (tessera12 attiva, tessera spenta: un solo premio attivo),
--   il rollback e' l'inverso. Nessuna riga cancellata. loyalty_redeem/loyalty_claim_code leggono costo e valore dalla
--   riga ATTIVA (verificato: nessun 200 fisso nel codice). La pagina deriva i timbri dal costo del premio attivo
--   (10 timbri = cost_points). Pool di codici 12% e disattivazione dei 61 codici 20%: SOLO dall'owner (scritture Shopify).

-- 1. A1 + C2: giro compleanni
create or replace function public.loyalty_birthday_run(p_today date default null, p_max int default 200) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Europe/Rome')::date);
  v_flag text; v_err text; v_cand int := 0; v_done int := 0; v_pts int := 0; v_skip int := 0; v_resto int := 0;
  r record; v_label text; v_sev text;
  v_bonus constant int := 20; v_lead constant int := 30; v_grace constant int := 3;
begin
  select value into v_flag from app_flags where key = 'loyalty_profile_enabled';
  if coalesce(lower(trim(v_flag)), '') in ('', 'false') then
    insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_birthday', 'compleanni OFF (loyalty_profile_enabled): nessun giro', 0, 'ok')
      on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = now();
    return jsonb_build_object('state', 'off');
  end if;
  begin
    for r in
      select p.shopify_customer_id, y.year, loyalty_birthday_in_year(p.birth_month, p.birth_day, y.year) as bday
      from loyalty_profiles p
      cross join lateral (values (extract(year from v_today)::int - 1), (extract(year from v_today)::int)) as y(year)
      where p.consenso_compleanno and p.birth_set_at is not null
        and loyalty_birthday_in_year(p.birth_month, p.birth_day, y.year) between v_today - v_grace and v_today
        and (p.birth_set_at at time zone 'Europe/Rome')::date <= loyalty_birthday_in_year(p.birth_month, p.birth_day, y.year) - v_lead
        and loyalty_flag_on('loyalty_profile_enabled', p.shopify_customer_id)
        and not exists (select 1 from loyalty_birthday_awards a where a.shopify_customer_id = p.shopify_customer_id and a.year = y.year)
      order by p.shopify_customer_id, y.year
      limit p_max + 1
    loop
      v_cand := v_cand + 1;
      if v_cand > p_max then v_resto := 1; exit; end if;
      insert into loyalty_birthday_awards (shopify_customer_id, year, points, birthday) values (r.shopify_customer_id, r.year, v_bonus, r.bday)
        on conflict (shopify_customer_id, year) do nothing;
      if not found then v_skip := v_skip + 1; continue; end if;
      -- A1: nel meta SOLO l'anno (loyalty_events.meta e' leggibile da ask_ro); la data sta in loyalty_birthday_awards, a colonne
      insert into loyalty_events (shopify_customer_id, delta, source, meta)
        values (r.shopify_customer_id, v_bonus, 'birthday', jsonb_build_object('year', r.year, 'fisso', true));
      insert into loyalty_points (shopify_customer_id, points, updated_at) values (r.shopify_customer_id, v_bonus, now())
        on conflict (shopify_customer_id) do update set points = loyalty_points.points + excluded.points, updated_at = now();
      v_done := v_done + 1; v_pts := v_pts + v_bonus;
    end loop;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is not null then
    v_label := 'compleanni ' || v_today || ' FERMATO (nessun punto mosso): ' || left(v_err, 300); v_sev := 'error'; v_done := 0; v_pts := 0;
  else
    v_label := 'compleanni ' || v_today || ': ' || v_done || ' accreditati (+' || v_pts || ' pt), gia''/skip ' || v_skip
      || case when v_resto > 0 then ', RESTO oltre il tetto ' || p_max else '' end;
    v_sev := case when v_resto > 0 then 'warn' else 'ok' end;
  end if;
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_birthday', v_label, v_done, v_sev)
    on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = now();
  return jsonb_build_object('ok', v_err is null, 'today', v_today, 'credited', v_done, 'points', v_pts, 'skipped', v_skip, 'resto', v_resto, 'error', v_err);
end; $$;

-- 2. B3 + C1: vista con date Europe/Rome e booleano sempre valorizzato (deadline cambia tipo: drop + create)
drop view if exists v_loyalty_second_order;
create view v_loyalty_second_order with (security_invoker = true) as
with c as (
  select c.shopify_customer_id, c.shopify_order_id, c.order_name, c.points,
         coalesce(o.created_at_shop, c.created_at) as order_at,
         (coalesce(o.created_at_shop, c.created_at) at time zone 'Europe/Rome')::date as order_day,
         coalesce(r.points_reversed, 0) as points_reversed,
         coalesce(r.refunded_amount, 0) as refunded_amount, c.order_total,
         row_number() over (partition by c.shopify_customer_id order by coalesce(o.created_at_shop, c.created_at), c.shopify_order_id) as rn,
         count(*) over (partition by c.shopify_customer_id) as n_ordini
  from loyalty_order_credits c
  left join shopify_orders o on o.order_id = c.order_name
  left join loyalty_order_reversals r on r.shopify_order_id = c.shopify_order_id
)
select f.shopify_customer_id, f.n_ordini,
  f.shopify_order_id as first_order_id, f.order_name as first_order_name, f.order_at as first_order_at,
  (f.order_day + 90) as deadline,
  s.shopify_order_id as second_order_id, s.order_name as second_order_name, s.order_at as second_order_at,
  s.points as second_points, s.points_reversed as second_points_reversed,
  (s.shopify_order_id is not null and coalesce(s.points_reversed >= s.points or (s.order_total > 0 and s.refunded_amount >= s.order_total), false)) as second_fully_refunded,
  (s.shopify_order_id is not null and s.order_day <= f.order_day + 90) as entro_90gg,
  b.points as bonus_points, b.points_reversed as bonus_reversed, b.created_at as bonus_at
from c f
left join c s on s.shopify_customer_id = f.shopify_customer_id and s.rn = 2
left join loyalty_bonus_second b on b.shopify_customer_id = f.shopify_customer_id
where f.rn = 1;
grant select on v_loyalty_second_order to ask_ro;

-- 3. B3: stato del profilo con deadline (date) e days_left
create or replace function public.loyalty_profile_state(p_customer text, p_today date default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Europe/Rome')::date);
  v_p loyalty_profiles%rowtype;
  v_bday date; v_cum int; v_awarded boolean := false; v_profile jsonb := null;
  v_n int; v_deadline date; v_bonus_pts int; v_bonus_rev int;
begin
  select * into v_p from loyalty_profiles where shopify_customer_id = p_customer;
  if found then
    v_bday := loyalty_birthday_in_year(v_p.birth_month, v_p.birth_day, extract(year from v_today)::int);
    v_awarded := exists (select 1 from loyalty_birthday_awards a where a.shopify_customer_id = p_customer and a.year = extract(year from v_today)::int);
    v_profile := jsonb_build_object(
      'birth_day', v_p.birth_day, 'birth_month', v_p.birth_month, 'birth_locked', v_p.birth_set_at is not null,
      'materiale_preferito', v_p.materiale_preferito, 'consenso_compleanno', v_p.consenso_compleanno,
      'completed_at', v_p.completed_at, 'complete', v_p.completed_at is not null);
  end if;
  v_cum := loyalty_points_cumulati(p_customer);
  select n_ordini, deadline, bonus_points, bonus_reversed into v_n, v_deadline, v_bonus_pts, v_bonus_rev
    from v_loyalty_second_order where shopify_customer_id = p_customer;
  return jsonb_build_object(
    'profile', v_profile,
    'birthday_today', v_bday is not null and v_bday = v_today,
    'birthday_awarded', v_awarded,
    'punti_cumulati', v_cum,
    'tier_cumulato', loyalty_tier_of(v_cum),
    'bonus_second', jsonb_build_object(
      'ordini', coalesce(v_n, 0),
      'deadline', case when v_n = 1 and v_deadline >= v_today then v_deadline else null end,
      'days_left', case when v_n = 1 and v_deadline >= v_today then v_deadline - v_today else null end,
      'awarded', v_bonus_pts is not null and coalesce(v_bonus_rev, 0) < v_bonus_pts));
end; $$;

-- 4. B1 + B2: giro bonus seconda borsa
create or replace function public.loyalty_bonus_second_run(p_max int default 200) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_flag text; v_since_txt text; v_since timestamptz; v_err text;
  v_cand int := 0; v_done int := 0; v_skip int := 0; v_resto int := 0; v_rev int := 0; v_rev_pts int := 0; v_rev_wait int := 0;
  v_balance int; v_delta int; r record; v_label text; v_sev text;
  v_bonus constant int := 50;
begin
  select value into v_flag from app_flags where key = 'loyalty_bonus_second_enabled';
  if coalesce(lower(trim(v_flag)), '') in ('', 'false') then
    insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_bonus_second', 'bonus seconda borsa OFF (loyalty_bonus_second_enabled): nessun giro', 0, 'ok')
      on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = now();
    return jsonb_build_object('state', 'off');
  end if;
  -- B2: il cursore si fissa UNA volta, fuori dal blocco con exception (un errore del giro non lo sposta piu')
  select value into v_since_txt from app_flags where key = 'loyalty_bonus_second_since';
  if coalesce(trim(v_since_txt), '') = '' then
    v_since := now();
    insert into app_flags (key, value) values ('loyalty_bonus_second_since', to_char(v_since at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      on conflict (key) do update set value = excluded.value where coalesce(trim(app_flags.value), '') = '';
  else
    v_since := v_since_txt::timestamptz;
  end if;
  begin
    for r in
      select s.shopify_customer_id, s.first_order_id, s.second_order_id, s.first_order_at, s.second_order_at, s.second_order_name
      from v_loyalty_second_order s
      where s.second_order_id is not null and s.entro_90gg
        and s.second_order_at >= v_since
        and not s.second_fully_refunded
        and s.bonus_points is null
        and loyalty_flag_on('loyalty_bonus_second_enabled', s.shopify_customer_id)
      order by s.second_order_at, s.shopify_customer_id
      limit p_max + 1
    loop
      v_cand := v_cand + 1;
      if v_cand > p_max then v_resto := 1; exit; end if;
      insert into loyalty_bonus_second (shopify_customer_id, first_order_id, second_order_id, first_order_at, second_order_at, points)
        values (r.shopify_customer_id, r.first_order_id, r.second_order_id, r.first_order_at, r.second_order_at, v_bonus)
        on conflict (shopify_customer_id) do nothing;
      if not found then v_skip := v_skip + 1; continue; end if;
      insert into loyalty_events (shopify_customer_id, delta, source, meta)
        values (r.shopify_customer_id, v_bonus, 'bonus_second', jsonb_build_object('first_order', r.first_order_id, 'second_order', r.second_order_id, 'order_name', r.second_order_name, 'fisso', true));
      insert into loyalty_points (shopify_customer_id, points, updated_at) values (r.shopify_customer_id, v_bonus, now())
        on conflict (shopify_customer_id) do update set points = loyalty_points.points + excluded.points, updated_at = now();
      v_done := v_done + 1;
    end loop;

    -- B1: lo storno guarda l'ordine SALVATO nel bonus, non il "secondo" ricalcolato dalla vista
    for r in
      select b.shopify_customer_id, b.points, b.points_reversed, b.second_order_id
      from loyalty_bonus_second b
      join loyalty_order_credits c on c.shopify_order_id = b.second_order_id
      left join loyalty_order_reversals rv on rv.shopify_order_id = b.second_order_id
      where b.points_reversed < b.points
        and (coalesce(rv.points_reversed, 0) >= c.points or (c.order_total > 0 and coalesce(rv.refunded_amount, 0) >= c.order_total))
      order by b.shopify_customer_id
      limit p_max
    loop
      if not loyalty_flag_on('loyalty_bonus_second_enabled', r.shopify_customer_id) then continue; end if;
      select points into v_balance from loyalty_points where shopify_customer_id = r.shopify_customer_id for update;
      v_delta := least(r.points - r.points_reversed, coalesce(v_balance, 0));
      if v_delta <= 0 then v_rev_wait := v_rev_wait + 1; continue; end if;
      update loyalty_points set points = points - v_delta, updated_at = now() where shopify_customer_id = r.shopify_customer_id;
      update loyalty_bonus_second set points_reversed = points_reversed + v_delta, reversed_at = now() where shopify_customer_id = r.shopify_customer_id;
      insert into loyalty_events (shopify_customer_id, delta, source, meta)
        values (r.shopify_customer_id, -v_delta, 'bonus_second_reversal', jsonb_build_object('second_order', r.second_order_id, 'fisso', true));
      v_rev := v_rev + 1; v_rev_pts := v_rev_pts + v_delta;
    end loop;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is not null then
    v_label := 'bonus seconda borsa FERMATO (nessun punto mosso): ' || left(v_err, 300); v_sev := 'error'; v_done := 0;
  else
    v_label := 'bonus seconda borsa (dal ' || to_char(v_since at time zone 'utc', 'YYYY-MM-DD') || '): ' || v_done || ' accreditati (+' || (v_done * v_bonus) || ' pt), gia''/skip ' || v_skip
      || ', stornati ' || v_rev || ' (-' || v_rev_pts || ' pt), in attesa di saldo ' || v_rev_wait
      || case when v_resto > 0 then ', RESTO oltre il tetto ' || p_max else '' end;
    v_sev := case when v_resto > 0 then 'warn' else 'ok' end;
  end if;
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_bonus_second', v_label, v_done, v_sev)
    on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = now();
  return jsonb_build_object('ok', v_err is null, 'since', v_since, 'credited', v_done, 'points', v_done * v_bonus, 'skipped', v_skip, 'resto', v_resto,
    'reversed', v_rev, 'reversed_points', v_rev_pts, 'reversal_waiting_balance', v_rev_wait, 'error', v_err);
end; $$;

-- 5. Parte D: premio unico 100 punti = 12%, riga NUOVA e SPENTA. Accensione (owner, un solo premio attivo):
--    update loyalty_rewards set active = (key = 'tessera12') where key in ('tessera', 'tessera12');
--    Rollback: update loyalty_rewards set active = (key = 'tessera') where key in ('tessera', 'tessera12');
insert into loyalty_rewards (key, label, cost_points, kind, value, active, sort) values
  ('tessera12', 'Tessera piena: 12% sul tuo prossimo ordine (non cumulabile con altri codici)', 100, 'percentage', 12, false, 5)
on conflict (key) do nothing;

-- KPI: "tessera piena" segue il costo del premio ATTIVO (era 200 fisso)
create or replace view v_loyalty_redeem_rate with (security_invoker = true) as
select
  coalesce(sum(case when e.delta > 0 then e.delta end),0) as punti_guadagnati_totali,
  coalesce(-sum(case when e.delta < 0 then e.delta end),0) as punti_riscattati_totali,
  case when coalesce(sum(case when e.delta > 0 then e.delta end),0) > 0
       then round(100.0 * coalesce(-sum(case when e.delta < 0 then e.delta end),0) / sum(case when e.delta > 0 then e.delta end), 1) else 0 end as pct_riscattato,
  (select count(r.id) from loyalty_redemptions r where r.status = 'fulfilled') as riscatti_evasi,
  (select count(r.id) from loyalty_redemptions r where r.status = 'pending') as riscatti_pending,
  (select count(p.shopify_customer_id) from loyalty_points p) as membri,
  (select count(p.shopify_customer_id) from loyalty_points p where p.points >= coalesce((select min(w.cost_points) from loyalty_rewards w where w.active), 200)) as membri_con_tessera_piena
from loyalty_events e;

insert into change_log (tbl, row_id, op, after, chi, source) values
  ('loyalty_rewards', 'tessera12', 'insert',
   '{"migr":"0142_loyalty_gate2_premio12","cost_points":100,"kind":"percentage","value":12,"active":false,"motivo":"Parte D brief M4b 22-09: premio unico 100 pt = 12%, acceso solo dall owner (tessera12 on, tessera off)"}'::jsonb,
   'claude-code', 'migration_0142'),
  ('loyalty_points', 'migr_0142', 'schema',
   '{"migr":"0142_loyalty_gate2_premio12","fix":["A1 meta birthday senza data","B1 storno bonus su second_order_id salvato","B2 since fuori dal blocco exception","B3 finestra 90 giorni su date Europe/Rome + days_left","C1 second_fully_refunded mai null","C2 n=0 in errore"],"kpi":"v_loyalty_redeem_rate.membri_con_tessera_piena sul premio attivo"}'::jsonb,
   'claude-code', 'migration_0142');
