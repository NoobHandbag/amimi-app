


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."ask_select"("q" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r jsonb;
begin
  if q !~* '^\s*select' then raise exception 'solo query SELECT sono consentite'; end if;
  if q ~* ';\s*\S' then raise exception 'una sola query alla volta'; end if;
  if q like '%--%' or q like '%/*%' then raise exception 'commenti non consentiti nella query'; end if;
  if q ~* '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|copy|vacuum|merge|call|do)\M'
    then raise exception 'query non consentita'; end if;
  if q ~* '\m(net|cron|vault|dblink|lo_import|lo_export|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_sleep|pg_settings|current_setting|set_config|http_get|http_post|pg_stat_file|pg_authid|pg_shadow)\M'
    then raise exception 'riferimento non consentito'; end if;
  perform set_config('statement_timeout', '5000', true);
  execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (' || q || ') sub limit 200) t' into r;
  return r;
end $$;


ALTER FUNCTION "public"."ask_select"("q" "text") OWNER TO "ask_ro";


CREATE OR REPLACE FUNCTION "public"."ce_aliquota_compensi"("p_year" integer, "p_month" integer) RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(sum(c.aliquota), 0)
  from public.ce_compensi_soci c
  where make_date(p_year, p_month, 1) >= c.dal
    and (c.al is null or make_date(p_year, p_month, 1) <= c.al)
$$;


ALTER FUNCTION "public"."ce_aliquota_compensi"("p_year" integer, "p_month" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lead_reviews_apply"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.azione = 'tier' then
    update lead_accounts set tier = new.tier, stato_ricerca = 'reviewed', rejected_motivo = null,
      owner_note = coalesce(new.nota, owner_note), updated_at = now() where id = new.account_id;
  elsif new.azione = 'scarta' then
    update lead_accounts set stato_ricerca = 'rejected', rejected_motivo = coalesce(new.motivo, 'scartato in revisione'),
      tier = null, owner_note = coalesce(new.nota, owner_note), updated_at = now() where id = new.account_id;
  elsif new.azione = 'ricontrolla' then
    update lead_accounts set stato_ricerca = 'seed', rejected_motivo = null, owner_note = coalesce(new.nota, owner_note),
      updated_at = now() where id = new.account_id;
  elsif new.azione = 'nota' then
    update lead_accounts set owner_note = new.nota, updated_at = now() where id = new.account_id;
  elsif new.azione = 'verdetto' then
    update lead_accounts set verdetto = new.verdetto, verdetto_motivo = new.motivo, verdetto_chi = new.chi, verdetto_at = now(),
      stato_ricerca = case when new.verdetto = 'no' then 'rejected' else 'reviewed' end,
      rejected_motivo = case when new.verdetto = 'no' then coalesce(new.motivo, 'no (verdetto)') else null end,
      lead_stage = case when new.verdetto = 'da_contattare' then 'da_contattare' else lead_stage end,
      updated_at = now() where id = new.account_id;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."lead_reviews_apply"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lead_touches_apply"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare cur_stage text;
begin
  select lead_stage into cur_stage from lead_accounts where id = new.account_id;
  update lead_accounts set
    lead_stage = coalesce(new.stage_dopo, case when new.direzione = 'in' and cur_stage in ('da_contattare','contattato') then 'risposto' when new.direzione = 'out' and cur_stage = 'da_contattare' then 'contattato' else cur_stage end),
    prossima_azione = case when new.prossima_azione is not null or new.prossima_azione_at is not null then new.prossima_azione else prossima_azione end,
    prossima_azione_at = case when new.prossima_azione is not null or new.prossima_azione_at is not null then new.prossima_azione_at else prossima_azione_at end,
    owner_outreach = coalesce(owner_outreach, new.chi),
    updated_at = now()
  where id = new.account_id;
  if new.esito = 'opt_out' then
    update lead_accounts set lead_stage = 'opt_out', updated_at = now() where id = new.account_id;
    update lead_contacts set opt_out = true, opt_out_at = now() where account_id = new.account_id and (new.contact_id is null or id = new.contact_id);
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."lead_touches_apply"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_award_daily"("p_customer" "text", "p_kind" "text", "p_delta" integer, "p_day" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_gate int; v_new int; v_source text; v_points int;
begin
  if p_customer is null or p_day is null or p_delta is null or p_delta <= 0 or p_delta > 100 then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  if p_kind = 'coccola' then v_source := 'mimi_coccola';
  elsif p_kind = 'memory' then v_source := 'game_memory';
  else return jsonb_build_object('ok', false, 'reason', 'bad_kind'); end if;

  insert into mimi_state (shopify_customer_id) values (p_customer) on conflict (shopify_customer_id) do nothing;
  if p_kind = 'coccola' then
    update mimi_state set last_coccola = p_day, updated_at = now()
      where shopify_customer_id = p_customer and (last_coccola is null or last_coccola < p_day);
  else
    update mimi_state set last_memory = p_day, updated_at = now()
      where shopify_customer_id = p_customer and (last_memory is null or last_memory < p_day);
  end if;
  get diagnostics v_gate = row_count;
  if v_gate = 0 then
    select points into v_points from loyalty_points where shopify_customer_id = p_customer;
    return jsonb_build_object('ok', true, 'done_today', true, 'points', coalesce(v_points, 0));
  end if;

  insert into loyalty_points (shopify_customer_id, points, updated_at) values (p_customer, p_delta, now())
    on conflict (shopify_customer_id) do update set points = loyalty_points.points + excluded.points, updated_at = now()
    returning points into v_new;
  insert into loyalty_events (shopify_customer_id, delta, source, meta)
    values (p_customer, p_delta, v_source, jsonb_build_object('fisso', true, 'day', p_day));
  return jsonb_build_object('ok', true, 'done_today', false, 'points', v_new, 'added', p_delta);
end; $$;


ALTER FUNCTION "public"."loyalty_award_daily"("p_customer" "text", "p_kind" "text", "p_delta" integer, "p_day" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_birthday_in_year"("p_month" integer, "p_day" integer, "p_year" integer) RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case when p_month is null or p_day is null or p_year is null then null
              when p_month = 2 and p_day = 29 and not (p_year % 4 = 0 and (p_year % 100 <> 0 or p_year % 400 = 0)) then make_date(p_year, 2, 28)
              else make_date(p_year, p_month, p_day) end;
$$;


ALTER FUNCTION "public"."loyalty_birthday_in_year"("p_month" integer, "p_day" integer, "p_year" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_birthday_run"("p_today" "date" DEFAULT NULL::"date", "p_max" integer DEFAULT 200) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."loyalty_birthday_run"("p_today" "date", "p_max" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_bonus_second_run"("p_max" integer DEFAULT 200) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."loyalty_bonus_second_run"("p_max" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_checkin"("p_customer" "text", "p_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_code   text := upper(trim(coalesce(p_code, '')));
  v_ev     loyalty_checkin_events%rowtype;
  v_n      int;
  v_gate   int;
  v_new    int;
  v_points int;
begin
  if coalesce(trim(p_customer), '') = '' then return jsonb_build_object('ok', false, 'reason', 'no_customer'); end if;
  if not loyalty_flag_on('loyalty_checkin_enabled', p_customer) then return jsonb_build_object('ok', false, 'reason', 'off'); end if;
  if v_code !~ '^[A-Z0-9_-]{4,40}$' then return jsonb_build_object('ok', false, 'reason', 'unknown_event'); end if;

  perform pg_advisory_xact_lock(hashtext('loyalty_checkin:' || v_code));
  select * into v_ev from loyalty_checkin_events where code = v_code;
  if not found or not v_ev.active then return jsonb_build_object('ok', false, 'reason', 'unknown_event'); end if;

  -- gia' registrata: stessa risposta a ogni richiamata, anche a evento finito
  if exists (select 1 from loyalty_checkins where event_code = v_code and shopify_customer_id = p_customer) then
    select points into v_points from loyalty_points where shopify_customer_id = p_customer;
    return jsonb_build_object('ok', true, 'already', true, 'added', 0, 'points', coalesce(v_points, 0), 'label', v_ev.label);
  end if;

  if now() < v_ev.starts_at then return jsonb_build_object('ok', false, 'reason', 'not_started', 'label', v_ev.label); end if;
  if now() > v_ev.ends_at   then return jsonb_build_object('ok', false, 'reason', 'ended', 'label', v_ev.label); end if;
  select count(*) into v_n from loyalty_checkins where event_code = v_code;
  if v_n >= v_ev.max_checkins then return jsonb_build_object('ok', false, 'reason', 'full', 'label', v_ev.label); end if;

  insert into loyalty_checkins (event_code, shopify_customer_id, points) values (v_code, p_customer, v_ev.points)
    on conflict (event_code, shopify_customer_id) do nothing;
  get diagnostics v_gate = row_count;
  if v_gate = 0 then
    select points into v_points from loyalty_points where shopify_customer_id = p_customer;
    return jsonb_build_object('ok', true, 'already', true, 'added', 0, 'points', coalesce(v_points, 0), 'label', v_ev.label);
  end if;

  insert into loyalty_points (shopify_customer_id, points, updated_at) values (p_customer, v_ev.points, now())
    on conflict (shopify_customer_id) do update set points = loyalty_points.points + excluded.points, updated_at = now()
    returning points into v_new;
  insert into loyalty_events (shopify_customer_id, delta, source, meta)
    values (p_customer, v_ev.points, 'event_checkin', jsonb_build_object('event', v_code, 'label', v_ev.label));
  return jsonb_build_object('ok', true, 'already', false, 'added', v_ev.points, 'points', v_new, 'label', v_ev.label);
end; $_$;


ALTER FUNCTION "public"."loyalty_checkin"("p_customer" "text", "p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_claim_code"("p_reward_key" "text", "p_customer" "text", "p_redemption_id" bigint) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_code text; v_status text; v_existing text;
begin
  select status, discount_code into v_status, v_existing
    from loyalty_redemptions
    where id = p_redemption_id and shopify_customer_id = p_customer and reward_key = p_reward_key
    for update;
  if not found then return null; end if;
  if v_existing is not null then return v_existing; end if;
  if v_status <> 'pending' then return null; end if;
  update loyalty_reward_codes set claimed_by = p_customer, redemption_id = p_redemption_id, claimed_at = now()
    where code = (select code from loyalty_reward_codes where reward_key = p_reward_key and claimed_by is null
                  order by created_at limit 1 for update skip locked)
    returning code into v_code;
  if v_code is not null then
    update loyalty_redemptions set status = 'fulfilled', discount_code = v_code, fulfilled_at = now()
      where id = p_redemption_id and status = 'pending';
  end if;
  return v_code;
end; $$;


ALTER FUNCTION "public"."loyalty_claim_code"("p_reward_key" "text", "p_customer" "text", "p_redemption_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_credit_order"("p_order_id" "text", "p_customer_id" "text", "p_points" integer, "p_total" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."loyalty_credit_order"("p_order_id" "text", "p_customer_id" "text", "p_points" integer, "p_total" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_credit_order"("p_order_id" "text", "p_customer_id" "text", "p_points" integer, "p_total" numeric, "p_order_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_new int;
begin
  if p_points is null or p_points <= 0 then return jsonb_build_object('credited', false, 'reason', 'zero_points'); end if;
  insert into loyalty_order_credits (shopify_order_id, shopify_customer_id, points, order_total, order_name)
  values (p_order_id, p_customer_id, p_points, p_total, p_order_name)
  on conflict (shopify_order_id) do nothing;
  if not found then
    update loyalty_order_credits set order_name = p_order_name where shopify_order_id = p_order_id and order_name is null and p_order_name is not null;
    return jsonb_build_object('credited', false, 'reason', 'already');
  end if;
  insert into loyalty_points (shopify_customer_id, points, updated_at) values (p_customer_id, p_points, now())
  on conflict (shopify_customer_id) do update set points = loyalty_points.points + excluded.points, updated_at = now()
  returning points into v_new;
  insert into loyalty_events (shopify_customer_id, delta, source, meta)
  values (p_customer_id, p_points, 'purchase', jsonb_build_object('order_id', p_order_id, 'total', p_total, 'order_name', p_order_name));
  return jsonb_build_object('credited', true, 'points', v_new);
end; $$;


ALTER FUNCTION "public"."loyalty_credit_order"("p_order_id" "text", "p_customer_id" "text", "p_points" integer, "p_total" numeric, "p_order_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_dashboard"("p_days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_days  int  := least(greatest(coalesce(p_days, 30), 1), 365);
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_from  date;
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_paid  constant text[] := array['paid', 'partially_refunded', 'refunded'];   -- stesso filtro di v_loyalty_uplift
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

    -- semaforo: ultima riga per chiave loyalty_* degli ultimi 7 giorni; le label possono contenere id cliente o testo
    -- d'errore (0137 elenca i membri fuori quadra): ogni sequenza di 5+ cifre viene oscurata
    'health', (select coalesce(jsonb_agg(jsonb_build_object('k', h.k, 'label', regexp_replace(coalesce(h.label, ''), '[0-9]{5,}', '…', 'g'),
                                                            'n', h.n, 'severity', h.severity, 'day', h.day) order by h.k), '[]'::jsonb)
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

    -- ritmo del pool: riscatti degli ultimi 14 giorni e giorni EFFETTIVI della finestra (dal primo riscatto del premio
    -- se e' piu' recente di 14 giorni: un premio attivo da 4 giorni non si divide per 14)
    'pool', (select coalesce(jsonb_agg(jsonb_build_object(
                'reward', p.reward, 'label', p.label, 'cost_points', p.cost_points, 'active', p.active,
                'liberi', p.codici_liberi, 'usati', p.codici_usati, 'pending', p.riscatti_pending,
                'riscatti_14gg', (select count(*) from loyalty_redemptions r
                                  where r.reward_key = p.reward and r.status = 'fulfilled' and r.created_at >= now() - interval '14 days'),
                'giorni_ritmo',  (select least(14, greatest(1, v_today - min((r.created_at at time zone 'Europe/Rome')::date) + 1))
                                  from loyalty_redemptions r where r.reward_key = p.reward and r.status = 'fulfilled'))
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
      'ordini_totale',      (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and o.financial_status = any(v_paid)),
      'ordini_periodo',     (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and o.financial_status = any(v_paid)
                               and (o.created_at_shop at time zone 'Europe/Rome')::date >= v_from),
      'lordo_totale',       (select coalesce(sum(o.gross_total), 0) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and o.financial_status = any(v_paid)),
      'sconto_totale',      (select coalesce(sum(o.discount_total), 0) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and o.financial_status = any(v_paid)),
      'con_reso',           (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and o.financial_status = any(v_paid)
                               and coalesce(o.refund_amount, 0) > 0)),

    -- effetto vendite: ordini del periodo di clienti che avevano aperto l'Area Membri PRIMA dell'ordine (nei 30 giorni
    -- precedenti; la visita dello stesso giorno conta solo se e' iniziata prima dell'ordine)
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
                      and v.day >= (o.created_at_shop at time zone 'Europe/Rome')::date - 30
                      and v.first_at < o.created_at_shop
                  ) as visto) x
                where o.financial_status = any(v_paid) and (o.created_at_shop at time zone 'Europe/Rome')::date >= v_from),
    'uplift', (select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) from v_loyalty_uplift u),

    -- funnel del periodo: clienti distinti, tranne l'ultimo passaggio (ordini)
    'funnel', jsonb_build_object(
      'aperture',       (select count(distinct v.shopify_customer_id) from loyalty_visits v where v.day >= v_from),
      'sessioni',       (select count(*) from loyalty_ui_events u where u.day >= v_from and u.event = 'page_open'),
      'visto_premio',   (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day >= v_from and u.event = 'view' and u.element like 'redeem\_%'),
      'premio_pronto',  (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day >= v_from and u.event = 'view' and u.element = 'redeem_ready'),
      'tap_riscatta',   (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day >= v_from and u.event = 'tap' and u.element = 'redeem'),
      'riscatti',       (select count(distinct r.shopify_customer_id) from loyalty_redemptions r where r.status = 'fulfilled' and (r.created_at at time zone 'Europe/Rome')::date >= v_from),
      'ordini_amica12', (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and o.financial_status = any(v_paid)
                           and (o.created_at_shop at time zone 'Europe/Rome')::date >= v_from),
      'eventi',         (select count(*) from loyalty_ui_events u where u.day >= v_from),
      'dal',            (select min(u.day) from loyalty_ui_events u)),
    'elementi', (select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'element', e.element, 'n', e.n, 'clienti', e.clienti) order by e.n desc), '[]'::jsonb)
                 from (select u.event, u.element, count(*) n, count(distinct u.shopify_customer_id) clienti
                       from loyalty_ui_events u where u.day >= v_from and u.event <> 'page_open'
                       group by 1, 2 order by 3 desc limit 30) e)
  ) into v_out;
  return v_out;
end $$;


ALTER FUNCTION "public"."loyalty_dashboard"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_flag_on"("p_key" "text", "p_customer" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((
    select case when lower(trim(value)) = 'true' then true
                when lower(trim(value)) in ('', 'false') then false
                else p_customer is not null and p_customer = any(string_to_array(replace(value, ' ', ''), ','))
           end
    from app_flags where key = p_key), false);
$$;


ALTER FUNCTION "public"."loyalty_flag_on"("p_key" "text", "p_customer" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_health_check"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_drift int; v_drift_ids text; v_free int; v_min int; v_redeem_on bool; v_pending int;
  v_purchase_on bool; v_orders_row int; v_visits int; v_actions int; v_membri int;
begin
  select count(*), coalesce(left(string_agg(shopify_customer_id, ','), 120), '')
    into v_drift, v_drift_ids from v_loyalty_ledger_drift where diff <> 0;
  delete from health_log where day = current_date and k = 'loyalty_ledger';
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_ledger',
    case when v_drift = 0 then 'ledger punti quadrato (points = somma eventi per ogni membro)'
         else 'LEDGER FUORI QUADRA per '||v_drift||' membri: '||v_drift_ids end,
    v_drift, case when v_drift = 0 then 'ok' else 'error' end);

  v_min := coalesce((select value::int from app_flags where key = 'loyalty_pool_min'), 20);
  v_redeem_on := coalesce((select value = 'true' from app_flags where key = 'loyalty_redeem_enabled'), false);
  select coalesce(min(codici_liberi), 0) into v_free from v_loyalty_pool where active;
  delete from health_log where day = current_date and k = 'loyalty_pool';
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_pool',
    'codici liberi (minimo fra i premi attivi): '||v_free||', soglia '||v_min||case when v_redeem_on then ', riscatto ON' else ', riscatto OFF' end,
    v_free, case when v_redeem_on and v_free = 0 then 'error' when v_free < v_min then 'warn' else 'ok' end);

  select count(*) into v_pending from loyalty_redemptions where status = 'pending' and created_at < now() - interval '1 hour';
  delete from health_log where day = current_date and k = 'loyalty_pending';
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_pending',
    'riscatti in attesa di codice da oltre 1 ora: '||v_pending, v_pending, case when v_pending > 0 then 'warn' else 'ok' end);

  v_purchase_on := coalesce((select value = 'true' from app_flags where key = 'loyalty_purchase_enabled'), false);
  select count(*) into v_orders_row from health_log where k = 'loyalty_orders' and day >= current_date - 1;
  delete from health_log where day = current_date and k = 'loyalty_orders_fresh';
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_orders_fresh',
    case when not v_purchase_on then 'accredito acquisti OFF: nessun giro atteso'
         when v_orders_row > 0 then 'giro loyalty-orders visto nelle ultime 48h'
         else 'NESSUN giro loyalty-orders nelle ultime 48h con accredito ON' end,
    v_orders_row, case when v_purchase_on and v_orders_row = 0 then 'error' else 'ok' end);

  select count(*) into v_visits from loyalty_visits where day = current_date - 1;
  select count(*) into v_actions from loyalty_events where (created_at at time zone 'Europe/Rome')::date = current_date - 1;
  select count(*) into v_membri from loyalty_points;
  delete from health_log where day = current_date and k = 'loyalty_activity';
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_activity',
    'ieri: '||v_visits||' clienti in pagina, '||v_actions||' azioni a punti; membri totali '||v_membri, v_actions, 'ok');
end; $$;


ALTER FUNCTION "public"."loyalty_health_check"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_memory_deck"("p_n" integer DEFAULT 3) RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with borse as (
    select distinct on (split_part(codice, '_', 1))
           split_part(codice, '_', 1) as modello, image_url, shopify_title
    from shopify_stock
    where shopify_status = 'active'
      and coalesce(image_url, '') like 'https://cdn.shopify.com/%'
      and codice ilike '%\_BAG\_%'
    order by split_part(codice, '_', 1), random()
  )
  select coalesce(jsonb_agg(jsonb_build_object('img', b.image_url, 'titolo', b.shopify_title)), '[]'::jsonb)
  from (select image_url, shopify_title from borse order by random() limit least(greatest(coalesce(p_n, 3), 2), 8)) b
$$;


ALTER FUNCTION "public"."loyalty_memory_deck"("p_n" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_points_cumulati"("p_customer" "text") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(sum(delta), 0)::int from loyalty_events where shopify_customer_id = p_customer and source <> 'redeem';
$$;


ALTER FUNCTION "public"."loyalty_points_cumulati"("p_customer" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_profile_save"("p_customer" "text", "p_day" integer, "p_month" integer, "p_materiale" "text", "p_consenso" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_p loyalty_profiles%rowtype; v_locked boolean := false; v_gate int := 0; v_new int; v_points int;
  v_mat text := nullif(trim(p_materiale), '');
begin
  if p_customer is null or p_customer = '' or p_consenso is null then return jsonb_build_object('ok', false, 'reason', 'bad_request'); end if;
  if v_mat is not null and v_mat not in ('cavallino', 'cocco', 'vernice', 'pelle liscia', 'cotone', 'nessuna preferenza') then
    return jsonb_build_object('ok', false, 'reason', 'bad_materiale');
  end if;

  if (p_day is not null or p_month is not null)
     and (p_day is null or p_month is null or p_month not between 1 and 12
          or p_day not between 1 and (case p_month when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end)) then
    return jsonb_build_object('ok', false, 'reason', 'bad_date');
  end if;

  insert into loyalty_profiles (shopify_customer_id) values (p_customer) on conflict (shopify_customer_id) do nothing;
  select * into v_p from loyalty_profiles where shopify_customer_id = p_customer for update;

  if v_p.birth_set_at is null then
    if p_day is not null then
      update loyalty_profiles set birth_day = p_day, birth_month = p_month, birth_set_at = now() where shopify_customer_id = p_customer;
    end if;
  elsif p_day is not null and p_month is not null and (p_day <> v_p.birth_day or p_month <> v_p.birth_month) then
    v_locked := true;
  end if;

  update loyalty_profiles set
    materiale_preferito = coalesce(v_mat, materiale_preferito),
    consenso_compleanno = p_consenso,
    consenso_at = case when p_consenso and not consenso_compleanno then now() when not p_consenso then null else consenso_at end,
    updated_at = now()
  where shopify_customer_id = p_customer;

  update loyalty_profiles set completed_at = now()
    where shopify_customer_id = p_customer and completed_at is null
      and birth_set_at is not null and materiale_preferito is not null and consenso_compleanno;
  get diagnostics v_gate = row_count;
  if v_gate = 1 then
    insert into loyalty_events (shopify_customer_id, delta, source, meta)
      values (p_customer, 10, 'profile_complete', jsonb_build_object('fisso', true))
      on conflict (shopify_customer_id) where source = 'profile_complete' do nothing;
    if found then
      insert into loyalty_points (shopify_customer_id, points, updated_at) values (p_customer, 10, now())
        on conflict (shopify_customer_id) do update set points = loyalty_points.points + excluded.points, updated_at = now()
        returning points into v_new;
    end if;
  end if;

  select points into v_points from loyalty_points where shopify_customer_id = p_customer;
  return jsonb_build_object('ok', true, 'awarded', v_new is not null, 'added', case when v_new is not null then 10 else 0 end,
    'points', coalesce(v_points, 0), 'birthday_locked', v_locked);
end; $$;


ALTER FUNCTION "public"."loyalty_profile_save"("p_customer" "text", "p_day" integer, "p_month" integer, "p_materiale" "text", "p_consenso" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_profile_state"("p_customer" "text", "p_today" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."loyalty_profile_state"("p_customer" "text", "p_today" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_redeem"("p_customer" "text", "p_reward_key" "text", "p_idemp" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_reward loyalty_rewards%rowtype; v_new int; v_id bigint; v_ex loyalty_redemptions%rowtype;
begin
  if p_customer is null or p_idemp is null or length(p_idemp) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  select * into v_reward from loyalty_rewards where key = p_reward_key and active;
  if not found then return jsonb_build_object('ok', false, 'reason', 'reward_unknown'); end if;

  insert into loyalty_redemptions (idemp, shopify_customer_id, reward_key, cost_points, status)
  values (p_idemp, p_customer, p_reward_key, v_reward.cost_points, 'pending')
  on conflict (idemp) do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_ex from loyalty_redemptions where idemp = p_idemp;
    if v_ex.shopify_customer_id is distinct from p_customer then
      return jsonb_build_object('ok', false, 'reason', 'bad_request');
    end if;
    return jsonb_build_object('ok', v_ex.status <> 'failed', 'reason', 'already',
      'status', v_ex.status, 'code', v_ex.discount_code, 'redemption_id', v_ex.id);
  end if;

  update loyalty_points set points = points - v_reward.cost_points, updated_at = now()
    where shopify_customer_id = p_customer and points >= v_reward.cost_points
    returning points into v_new;
  if not found then
    update loyalty_redemptions set status = 'failed', meta = jsonb_build_object('reason','insufficient') where id = v_id;
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'redemption_id', v_id);
  end if;

  insert into loyalty_events (shopify_customer_id, delta, source, meta)
  values (p_customer, -v_reward.cost_points, 'redeem', jsonb_build_object('reward', p_reward_key, 'redemption_id', v_id));

  return jsonb_build_object('ok', true, 'reason', 'deducted', 'new_balance', v_new,
    'redemption_id', v_id, 'cost', v_reward.cost_points, 'kind', v_reward.kind, 'value', v_reward.value);
end; $$;


ALTER FUNCTION "public"."loyalty_redeem"("p_customer" "text", "p_reward_key" "text", "p_idemp" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_redemptions_for"("p_customer" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'reward_key', r.reward_key, 'cost_points', r.cost_points, 'status', r.status,
           'discount_code', r.discount_code, 'created_at', r.created_at,
           'created_day', (r.created_at at time zone 'Europe/Rome')::date,
           'kind', w.kind, 'value', w.value,
           'used_at', u.used_at, 'used_day', (u.used_at at time zone 'Europe/Rome')::date)
         order by r.created_at desc), '[]'::jsonb)
  from (select reward_key, cost_points, status, discount_code, created_at
        from loyalty_redemptions
        where shopify_customer_id = p_customer and status in ('pending', 'fulfilled')
        order by created_at desc limit 60) r
  left join loyalty_rewards w on w.key = r.reward_key
  left join lateral (
    select min(o.created_at_shop) as used_at
    from shopify_orders o
    where r.discount_code is not null and length(r.discount_code) >= 6
      and upper(r.discount_code) = any(regexp_split_to_array(upper(coalesce(o.discount_codes, '')), '[^A-Z0-9_-]+'))
  ) u on true
$$;


ALTER FUNCTION "public"."loyalty_redemptions_for"("p_customer" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_reverse_order"("p_order_id" "text", "p_refunded" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_cust text; v_pts int; v_total numeric; v_target int; v_done int; v_delta int; v_balance int; v_new int;
begin
  select shopify_customer_id, points, order_total into v_cust, v_pts, v_total from loyalty_order_credits where shopify_order_id = p_order_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_credited'); end if;
  if p_refunded is null or p_refunded <= 0 then return jsonb_build_object('ok', true, 'reversed', 0, 'reason', 'nothing'); end if;
  if v_total is null or v_total <= 0 then v_target := v_pts;
  else v_target := least(v_pts, floor(v_pts * least(p_refunded / v_total, 1))::int); end if;
  insert into loyalty_order_reversals (shopify_order_id, points_reversed, refunded_amount) values (p_order_id, 0, p_refunded)
    on conflict (shopify_order_id) do update set refunded_amount = excluded.refunded_amount, updated_at = now();
  select points_reversed into v_done from loyalty_order_reversals where shopify_order_id = p_order_id for update;
  v_delta := v_target - v_done;
  if v_delta <= 0 then return jsonb_build_object('ok', true, 'reversed', 0, 'reason', 'already', 'target', v_target); end if;
  select points into v_balance from loyalty_points where shopify_customer_id = v_cust for update;
  if v_balance is null then return jsonb_build_object('ok', false, 'reason', 'no_member'); end if;
  v_delta := least(v_delta, v_balance);
  if v_delta <= 0 then return jsonb_build_object('ok', true, 'reversed', 0, 'reason', 'balance_zero', 'target', v_target); end if;
  update loyalty_points set points = points - v_delta, updated_at = now() where shopify_customer_id = v_cust returning points into v_new;
  update loyalty_order_reversals set points_reversed = points_reversed + v_delta, updated_at = now() where shopify_order_id = p_order_id;
  insert into loyalty_events (shopify_customer_id, delta, source, meta)
    values (v_cust, -v_delta, 'refund_reversal', jsonb_build_object('order_id', p_order_id, 'refunded', p_refunded, 'target', v_target));
  return jsonb_build_object('ok', true, 'reversed', v_delta, 'new_balance', v_new, 'target', v_target);
end; $$;


ALTER FUNCTION "public"."loyalty_reverse_order"("p_order_id" "text", "p_refunded" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_staff_email"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select u.email::text from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null and u.email ilike '%@amimi.it'
$$;


ALTER FUNCTION "public"."loyalty_staff_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_tier_of"("p_points" integer) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case when p_points >= 400 then 'Amica del Cuore' when p_points >= 150 then 'Amica Speciale' else 'Amica' end;
$$;


ALTER FUNCTION "public"."loyalty_tier_of"("p_points" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_track"("p_customer" "text", "p_events" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  c_views    constant text[] := array['redeem_ready', 'redeem_locked', 'redeem_pending', 'profilo', 'mimi', 'guardaroba', 'bonus2', 'bday',
                                      'codici', 'regole', 'evento', 'ugc'];
  c_taps     constant text[] := array['redeem', 'copy_code', 'coccola', 'gioco', 'nanna', 'wear', 'profile_save',
                                      'codici_tutti', 'shop', 'mimi', 'ugc_open', 'ugc_send'];
  c_max_call constant int := 20;
  c_max_day  constant int := 300;
  v_day   date := (now() at time zone 'Europe/Rome')::date;
  v_have  int;
  v_room  int;
  v_valid int;
  v_ins   int;
begin
  if coalesce(trim(p_customer), '') = '' then return jsonb_build_object('ok', false, 'reason', 'no_customer'); end if;
  if not loyalty_flag_on('loyalty_track_enabled', p_customer) then return jsonb_build_object('ok', false, 'reason', 'off'); end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'bad_payload'); end if;
  -- due invii concorrenti dello stesso cliente non sforano il tetto giornaliero
  perform pg_advisory_xact_lock(hashtext('loyalty_track:' || p_customer));
  select count(*) into v_have from loyalty_ui_events where shopify_customer_id = p_customer and day = v_day;
  v_room := greatest(0, c_max_day - v_have);
  select count(*) into v_valid
  from jsonb_array_elements(p_events) with ordinality as e(value, ord)
  where e.ord <= c_max_call and jsonb_typeof(e.value) = 'object'
    and ((e.value ->> 'e' = 'page_open' and nullif(e.value ->> 'el', '') is null)
      or (e.value ->> 'e' = 'view' and e.value ->> 'el' = any(c_views))
      or (e.value ->> 'e' = 'tap'  and e.value ->> 'el' = any(c_taps)));
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
  return jsonb_build_object('ok', true, 'inserted', v_ins, 'capped', v_valid > v_room);
end $$;


ALTER FUNCTION "public"."loyalty_track"("p_customer" "text", "p_events" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_ugc_consenso"() RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select 'Acconsento che Amimì pubblichi le foto e il testo che invio, con la firma che scelgo, sul sito amimi.it, '
      || 'sui social e nelle comunicazioni di Amimì. Le foto sono mie e chi compare ha dato il suo permesso. '
      || 'Posso chiederne la rimozione in ogni momento scrivendo all''assistenza clienti di Amimì.'
$$;


ALTER FUNCTION "public"."loyalty_ugc_consenso"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_ugc_decide"("p_id" bigint, "p_decisione" "text", "p_motivo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_email  text := loyalty_staff_email();
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_row    loyalty_ugc%rowtype;
  v_pts    int;
  v_new    int;
  v_gate   int;
begin
  if v_email is null then
    raise exception 'loyalty_ugc_decide: riservato agli account @amimi.it' using errcode = '42501';
  end if;
  -- un valore nullo non e' 'approva': senza questo controllo il confronto darebbe NULL e si scivolerebbe nel ramo dei punti
  if p_decisione is null or p_decisione not in ('approva', 'rifiuta') then return jsonb_build_object('ok', false, 'reason', 'bad_request'); end if;
  if p_decisione = 'rifiuta' and char_length(coalesce(v_motivo, '')) not between 3 and 200 then
    return jsonb_build_object('ok', false, 'reason', 'motivo');
  end if;
  select * into v_row from loyalty_ugc where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_row.status <> 'in_revisione' then
    return jsonb_build_object('ok', true, 'already', true, 'status', v_row.status, 'deciso_da', v_row.deciso_da);
  end if;

  if p_decisione = 'rifiuta' then
    update loyalty_ugc set status = 'rifiutata', motivo = v_motivo, deciso_at = now(), deciso_da = v_email
      where id = p_id and status = 'in_revisione';
    insert into change_log (tbl, row_id, op, after, chi, source)
      values ('loyalty_ugc', p_id::text, 'ugc_rifiuta', jsonb_build_object('kind', v_row.kind, 'codice', v_row.codice, 'motivo', v_motivo), v_email, 'premia-app');
    return jsonb_build_object('ok', true, 'already', false, 'status', 'rifiutata');
  end if;

  v_pts := loyalty_ugc_points(v_row.kind);
  update loyalty_ugc set status = 'approvata', punti = v_pts, deciso_at = now(), deciso_da = v_email
    where id = p_id and status = 'in_revisione';
  get diagnostics v_gate = row_count;
  if v_gate = 0 then return jsonb_build_object('ok', true, 'already', true, 'status', 'approvata'); end if;
  insert into loyalty_points (shopify_customer_id, points, updated_at) values (v_row.shopify_customer_id, v_pts, now())
    on conflict (shopify_customer_id) do update set points = loyalty_points.points + excluded.points, updated_at = now()
    returning points into v_new;
  insert into loyalty_events (shopify_customer_id, delta, source, meta)
    values (v_row.shopify_customer_id, v_pts, 'ugc', jsonb_build_object('ugc', v_row.id::text, 'kind', v_row.kind, 'codice', v_row.codice, 'da', v_email));
  insert into change_log (tbl, row_id, op, after, chi, source)
    values ('loyalty_ugc', p_id::text, 'ugc_approva', jsonb_build_object('kind', v_row.kind, 'codice', v_row.codice, 'punti', v_pts), v_email, 'premia-app');
  return jsonb_build_object('ok', true, 'already', false, 'status', 'approvata', 'punti', v_pts, 'saldo', v_new);
end; $$;


ALTER FUNCTION "public"."loyalty_ugc_decide"("p_id" bigint, "p_decisione" "text", "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_ugc_info"("p_customer" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
  select jsonb_build_object(
    'punti', jsonb_build_object('recensione', loyalty_ugc_points('recensione'), 'look', loyalty_ugc_points('look')),
    'consenso', loyalty_ugc_consenso(),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object(
               'id', u.id, 'kind', u.kind, 'codice', u.codice, 'titolo', u.titolo, 'rating', u.rating, 'foto', cardinality(u.foto),
               'status', u.status, 'motivo', u.motivo,
               'punti', case when u.status = 'rifiutata' then null else coalesce(u.punti, loyalty_ugc_points(u.kind)) end,
               'created_day', (u.created_at at time zone 'Europe/Rome')::date) order by u.created_at desc), '[]'::jsonb)
             from (select * from loyalty_ugc where shopify_customer_id = p_customer order by created_at desc limit 30) u),
    'recensibili', (select coalesce(jsonb_agg(jsonb_build_object('codice', b.codice, 'titolo', coalesce(t.titolo, b.nome, b.codice)) order by b.codice), '[]'::jsonb)
                    from (select coalesce(nullif(li.codice_norm, ''), li.codice) as codice, max(li.lineitem_name) as nome
                          from loyalty_order_credits c join shopify_line_items li on li.order_id = c.order_name
                          where c.shopify_customer_id = p_customer and coalesce(nullif(li.codice_norm, ''), li.codice) ~ '^[A-Z0-9_]{3,80}$'
                          group by 1) b
                    left join lateral (select s.shopify_title as titolo from shopify_stock s where s.codice = b.codice and s.shopify_title is not null
                                       order by (s.shopify_status = 'active') desc nulls last limit 1) t on true),
    'catalogo', (select coalesce(jsonb_agg(jsonb_build_object('codice', b.codice, 'titolo', b.titolo) order by b.titolo), '[]'::jsonb)
                 from (select distinct on (codice) codice, shopify_title as titolo from shopify_stock
                       where shopify_status = 'active' and codice ilike '%\_BAG\_%' and shopify_title is not null
                       order by codice) b))
$_$;


ALTER FUNCTION "public"."loyalty_ugc_info"("p_customer" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_ugc_points"("p_kind" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select case p_kind when 'recensione' then 20 when 'look' then 30 else 0 end
$$;


ALTER FUNCTION "public"."loyalty_ugc_points"("p_kind" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_ugc_queue"("p_status" "text" DEFAULT 'in_revisione'::"text", "p_limit" integer DEFAULT 60) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_email text := loyalty_staff_email();
begin
  if v_email is null then
    raise exception 'loyalty_ugc_queue: riservato agli account @amimi.it' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('in_revisione', 'approvata', 'rifiutata') then raise exception 'stato non valido' using errcode = '22023'; end if;
  return jsonb_build_object(
    'conteggi', (select jsonb_build_object(
                   'in_revisione', count(*) filter (where status = 'in_revisione'),
                   'approvata',    count(*) filter (where status = 'approvata'),
                   'rifiutata',    count(*) filter (where status = 'rifiutata')) from loyalty_ugc),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', u.id, 'kind', u.kind, 'codice', u.codice, 'titolo', u.titolo, 'rating', u.rating, 'testo', u.testo,
                'firma', u.firma, 'foto', to_jsonb(u.foto), 'verificata', u.verificata, 'cliente', u.shopify_customer_id,
                'status', u.status, 'motivo', u.motivo, 'punti', coalesce(u.punti, loyalty_ugc_points(u.kind)),
                'created_at', u.created_at, 'deciso_at', u.deciso_at, 'deciso_da', u.deciso_da)
                order by case when u.status = 'in_revisione' then u.created_at end asc, u.deciso_at desc), '[]'::jsonb)
              from (select * from loyalty_ugc where status = p_status
                    order by case when status = 'in_revisione' then created_at end asc, deciso_at desc
                    limit least(greatest(coalesce(p_limit, 60), 1), 200)) u));
end; $$;


ALTER FUNCTION "public"."loyalty_ugc_queue"("p_status" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_ugc_slot"("p_customer" "text", "p_n" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_day date := (now() at time zone 'Europe/Rome')::date;
  v_n   int;
begin
  if coalesce(trim(p_customer), '') = '' then return jsonb_build_object('ok', false, 'reason', 'no_customer'); end if;
  if not loyalty_flag_on('loyalty_ugc_enabled', p_customer) then return jsonb_build_object('ok', false, 'reason', 'off'); end if;
  if p_n is null or p_n < 1 or p_n > 3 then return jsonb_build_object('ok', false, 'reason', 'bad_request'); end if;
  insert into loyalty_ugc_slots as s (shopify_customer_id, day, n) values (p_customer, v_day, p_n)
    on conflict (shopify_customer_id, day) do update set n = s.n + excluded.n where s.n + excluded.n <= 12
    returning n into v_n;
  if v_n is null then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  return jsonb_build_object('ok', true, 'used', v_n);
end; $$;


ALTER FUNCTION "public"."loyalty_ugc_slot"("p_customer" "text", "p_n" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_ugc_submit"("p_customer" "text", "p_kind" "text", "p_codice" "text", "p_rating" integer, "p_testo" "text", "p_firma" "text", "p_foto" "text"[], "p_consenso" boolean, "p_idemp" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_codice text   := upper(trim(coalesce(p_codice, '')));
  v_testo  text   := nullif(trim(coalesce(p_testo, '')), '');
  v_firma  text   := nullif(trim(coalesce(p_firma, '')), '');
  v_foto   text[] := coalesce(p_foto, '{}'::text[]);
  v_idemp  text   := trim(coalesce(p_idemp, ''));
  v_row    loyalty_ugc%rowtype;
  v_ver    boolean;
  v_cat    boolean;
  v_tit    text;
  v_n      int;
  v_id     bigint;
begin
  if coalesce(trim(p_customer), '') = '' then return jsonb_build_object('ok', false, 'reason', 'no_customer'); end if;
  if not loyalty_flag_on('loyalty_ugc_enabled', p_customer) then return jsonb_build_object('ok', false, 'reason', 'off'); end if;
  if char_length(v_idemp) not between 8 and 80 or p_kind is null or p_kind not in ('recensione', 'look') then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtext('loyalty_ugc:' || p_customer));

  -- lo stesso invio arrivato due volte (rete persa, "Riprova"): stessa risposta, nessuna riga nuova
  select * into v_row from loyalty_ugc where shopify_customer_id = p_customer and idemp = v_idemp;
  if found then
    return jsonb_build_object('ok', true, 'already', true, 'id', v_row.id, 'status', v_row.status, 'punti', loyalty_ugc_points(v_row.kind));
  end if;

  if p_consenso is not true then return jsonb_build_object('ok', false, 'reason', 'no_consent'); end if;
  if v_codice !~ '^[A-Z0-9_]{3,80}$' then return jsonb_build_object('ok', false, 'reason', 'unknown_bag'); end if;
  if p_kind = 'recensione' and (p_rating is null or p_rating not between 1 and 5) then return jsonb_build_object('ok', false, 'reason', 'bad_rating'); end if;
  if p_kind = 'recensione' and char_length(coalesce(v_testo, '')) < 15 then return jsonb_build_object('ok', false, 'reason', 'short_text'); end if;
  if char_length(coalesce(v_testo, '')) > 600 or char_length(coalesce(v_firma, '')) > 40 then return jsonb_build_object('ok', false, 'reason', 'too_long'); end if;
  if cardinality(v_foto) > 3 then return jsonb_build_object('ok', false, 'reason', 'too_many_photos'); end if;
  if p_kind = 'look' and cardinality(v_foto) = 0 then return jsonb_build_object('ok', false, 'reason', 'no_photo'); end if;
  -- foto: solo percorsi della SUA cartella col nome che dà loyalty-proxy, niente doppioni, tutte caricate, mai già usate
  if exists (select 1 from unnest(v_foto) f where f is null or f !~ ('^' || p_customer || '/[0-9]{8}-[0-9a-f-]{36}\.(jpg|webp)$'))
     or (select count(distinct f) from unnest(v_foto) f) <> cardinality(v_foto) then
    return jsonb_build_object('ok', false, 'reason', 'bad_photo');
  end if;
  if (select count(*) from storage.objects o where o.bucket_id = 'loyalty-ugc' and o.name = any(v_foto)) <> cardinality(v_foto) then
    return jsonb_build_object('ok', false, 'reason', 'photo_missing');
  end if;
  if cardinality(v_foto) > 0 and exists (select 1 from loyalty_ugc u where u.foto && v_foto) then
    return jsonb_build_object('ok', false, 'reason', 'bad_photo');
  end if;

  -- la borsa: comprata online da LEI (cio' che rende la recensione verificata) oppure, per il look, una borsa ATTIVA
  -- del catalogo (le stesse che loyalty_ugc_info propone). Il titolo e' quello della scheda, attiva se c'e'.
  v_ver := exists (select 1 from loyalty_order_credits c join shopify_line_items li on li.order_id = c.order_name
                   where c.shopify_customer_id = p_customer and coalesce(nullif(li.codice_norm, ''), li.codice) = v_codice);
  v_cat := exists (select 1 from shopify_stock where codice = v_codice and shopify_status = 'active' and codice ilike '%\_BAG\_%');
  select shopify_title into v_tit from shopify_stock where codice = v_codice and shopify_title is not null
    order by (shopify_status = 'active') desc nulls last limit 1;
  if p_kind = 'recensione' and not v_ver then return jsonb_build_object('ok', false, 'reason', 'not_bought'); end if;
  if not v_ver and not v_cat then return jsonb_build_object('ok', false, 'reason', 'unknown_bag'); end if;

  select count(*) into v_n from loyalty_ugc where shopify_customer_id = p_customer and created_at > now() - interval '24 hours';
  if v_n >= 5 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;

  insert into loyalty_ugc (shopify_customer_id, kind, codice, titolo, rating, testo, firma, foto, verificata, consenso_testo, idemp)
    values (p_customer, p_kind, v_codice, v_tit, case when p_kind = 'recensione' then p_rating end, v_testo, v_firma, v_foto, v_ver,
            loyalty_ugc_consenso(), v_idemp)
    on conflict do nothing
    returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'already_sent'); end if;   -- stessa borsa e tipo gia' inviati
  return jsonb_build_object('ok', true, 'already', false, 'id', v_id, 'status', 'in_revisione', 'punti', loyalty_ugc_points(p_kind), 'verificata', v_ver);
end; $_$;


ALTER FUNCTION "public"."loyalty_ugc_submit"("p_customer" "text", "p_kind" "text", "p_codice" "text", "p_rating" integer, "p_testo" "text", "p_firma" "text", "p_foto" "text"[], "p_consenso" boolean, "p_idemp" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_ui_events_purge"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_n int;
begin
  delete from loyalty_ui_events where id in (
    select id from loyalty_ui_events where day < (now() at time zone 'Europe/Rome')::date - 180 order by id limit 5000);
  get diagnostics v_n = row_count;
  return v_n;
end $$;


ALTER FUNCTION "public"."loyalty_ui_events_purge"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loyalty_visit"("p_customer" "text", "p_day" "date") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into loyalty_visits (shopify_customer_id, day) values (p_customer, p_day)
  on conflict (shopify_customer_id, day) do update set hits = loyalty_visits.hits + 1, last_at = now();
$$;


ALTER FUNCTION "public"."loyalty_visit"("p_customer" "text", "p_day" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mat_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end $$;


ALTER FUNCTION "public"."mat_touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."norm_codice"("t" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$ select upper(regexp_replace(coalesce(t,''), '\s+', '_', 'g')) $$;


ALTER FUNCTION "public"."norm_codice"("t" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_health_log"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  delete from health_log where day = current_date and k not like 'ce\_%' and k not like 'sales\_%' and k <> 'shipping_status';
  insert into health_log (day, k, label, n, severity)
    select current_date, k, label, n, severity from v_health;
end; $$;


ALTER FUNCTION "public"."refresh_health_log"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."_bak_shopify_line_items_2026_09_13" (
    "id" "uuid",
    "order_id" "text",
    "lineitem_name" "text",
    "codice" "text",
    "codice_norm" "text",
    "resolved" boolean,
    "quantita" numeric,
    "price" numeric(12,2),
    "cogs_snapshot" numeric(12,2),
    "year" integer,
    "month" integer,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_bak_shopify_line_items_2026_09_13" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_bak_shopify_orders_2026_09_13" (
    "id" "uuid",
    "order_id" "text",
    "order_number" "text",
    "created_at_shop" timestamp with time zone,
    "customer_name" "text",
    "email" "text",
    "financial_status" "text",
    "fulfillment_status" "text",
    "gross_total" numeric(12,2),
    "net_total" numeric(12,2),
    "discount_total" numeric(12,2),
    "shipping_total" numeric(12,2),
    "payment_fees" numeric(12,2),
    "refund_amount" numeric(12,2),
    "free_shipping" boolean,
    "currency" "text",
    "year" integer,
    "month" integer,
    "raw" "jsonb",
    "synced_at" timestamp with time zone,
    "vendor" "text",
    "free_shipping_amt" numeric(12,2),
    "fulfilled_at" timestamp with time zone,
    "discount_codes" "text"
);


ALTER TABLE "public"."_bak_shopify_orders_2026_09_13" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_compila_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "chi" "text" NOT NULL,
    "email" "text",
    "target" "text" NOT NULL,
    "n_immagini" integer DEFAULT 0 NOT NULL,
    "input_hash" "text",
    "testo" "text",
    "modello" "text",
    "ms" integer,
    "output" "jsonb",
    "errore" "text",
    "esito" "text",
    "ref_tabella" "text",
    "ref_id" "text",
    "esito_at" timestamp with time zone,
    CONSTRAINT "ai_compila_log_esito_check" CHECK (("esito" = ANY (ARRAY['proposto'::"text", 'confermato'::"text", 'modificato'::"text", 'scartato'::"text", 'errore'::"text"]))),
    CONSTRAINT "ai_compila_log_target_check" CHECK (("target" = ANY (ARRAY['materiale'::"text", 'fornitore'::"text", 'ordine_prodotti'::"text"])))
);


ALTER TABLE "public"."ai_compila_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alert_rules" (
    "metrica" "text" NOT NULL,
    "soglia" numeric NOT NULL,
    "finestra_giorni" integer NOT NULL,
    "severity" "text" NOT NULL,
    "attivo" boolean DEFAULT true NOT NULL,
    "note" "text",
    CONSTRAINT "alert_rules_severity_check" CHECK (("severity" = ANY (ARRAY['error'::"text", 'warn'::"text", 'info'::"text"])))
);


ALTER TABLE "public"."alert_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_config" (
    "id" integer DEFAULT 1 NOT NULL,
    "pin_hash" "text",
    "ai_enabled" boolean DEFAULT false NOT NULL,
    "live_sync_enabled" boolean DEFAULT false NOT NULL,
    "corrections_adopted" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "iva_rate" numeric(6,4) DEFAULT 0.22 NOT NULL,
    "parity_tolerance_cents" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "shopify_token" "text",
    "ai_actions_enabled" boolean DEFAULT false NOT NULL,
    "meta_token" "text",
    CONSTRAINT "app_config_singleton" CHECK (("id" = 1))
);


ALTER TABLE "public"."app_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_flags" (
    "key" "text" NOT NULL,
    "value" "text"
);


ALTER TABLE "public"."app_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_guides" (
    "id" integer DEFAULT 1 NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_guides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."b2b_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mov_id" "text",
    "data" "date",
    "year" integer,
    "month" integer,
    "codice" "text",
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "quantita" numeric,
    "modello" "text",
    "tipo_movimento" "text",
    "negozio" "text",
    "prezzo_retail" numeric(12,2),
    "perc_negozio" numeric(6,4),
    "retail_tot" numeric(14,2) GENERATED ALWAYS AS ("round"((COALESCE("prezzo_retail", (0)::numeric) * COALESCE("quantita", (0)::numeric)), 2)) STORED,
    "quota_negozio" numeric(14,2) GENERATED ALWAYS AS ("round"(((COALESCE("prezzo_retail", (0)::numeric) * COALESCE("quantita", (0)::numeric)) * COALESCE("perc_negozio", (0)::numeric)), 2)) STORED,
    "incasso_amimi" numeric(14,2) GENERATED ALWAYS AS ("round"(((COALESCE("prezzo_retail", (0)::numeric) * COALESCE("quantita", (0)::numeric)) * ((1)::numeric - COALESCE("perc_negozio", (0)::numeric))), 2)) STORED,
    "cogs" numeric(12,2),
    "stato" "text",
    "note" "text",
    "source" "text" DEFAULT 'etl'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "chi" "text"
);


ALTER TABLE "public"."b2b_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ce_compensi_soci" (
    "id" bigint NOT NULL,
    "socio" "text" NOT NULL,
    "aliquota" numeric(7,5) NOT NULL,
    "dal" "date" NOT NULL,
    "al" "date",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ce_compensi_soci_aliquota_check" CHECK ((("aliquota" > (0)::numeric) AND ("aliquota" < 0.5))),
    CONSTRAINT "ce_compensi_soci_check" CHECK ((("al" IS NULL) OR ("al" >= "dal"))),
    CONSTRAINT "ce_compensi_soci_dal_check" CHECK ((EXTRACT(day FROM "dal") = (1)::numeric))
);


ALTER TABLE "public"."ce_compensi_soci" OWNER TO "postgres";


COMMENT ON TABLE "public"."ce_compensi_soci" IS 'Accordi di compenso dei soci in % delle vendite nette (riga compenso_soci del CE, migr 0154). Scrittura solo via migrazione.';



CREATE SEQUENCE IF NOT EXISTS "public"."ce_compensi_soci_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ce_compensi_soci_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ce_compensi_soci_id_seq" OWNED BY "public"."ce_compensi_soci"."id";



CREATE TABLE IF NOT EXISTS "public"."ce_snapshots" (
    "id" bigint NOT NULL,
    "ce" "text" NOT NULL,
    "year" integer NOT NULL,
    "month" integer NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "closed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_by" "text",
    CONSTRAINT "ce_snapshots_ce_check" CHECK (("ce" = ANY (ARRAY['amimi'::"text", 'totale'::"text"])))
);


ALTER TABLE "public"."ce_snapshots" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ce_snapshots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ce_snapshots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ce_snapshots_id_seq" OWNED BY "public"."ce_snapshots"."id";



CREATE TABLE IF NOT EXISTS "public"."ce_totale_manual" (
    "year" integer NOT NULL,
    "month" integer NOT NULL,
    "online_netto" numeric DEFAULT 0,
    "offline_netto" numeric DEFAULT 0,
    "b2b_netto" numeric DEFAULT 0,
    "cogs" numeric DEFAULT 0,
    "packaging" numeric DEFAULT 0,
    "commissioni" numeric DEFAULT 0,
    "logistica_var" numeric DEFAULT 0,
    "resi" numeric DEFAULT 0,
    "salari" numeric DEFAULT 0,
    "tasse" numeric DEFAULT 0,
    "logistica_mag" numeric DEFAULT 0,
    "opex" numeric DEFAULT 0,
    "eventi" numeric DEFAULT 0,
    "marketing" numeric DEFAULT 0,
    "note" "text"
);


ALTER TABLE "public"."ce_totale_manual" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ce_totale_monthly" (
    "year" integer DEFAULT 2026 NOT NULL,
    "month" integer NOT NULL,
    "online_netto" numeric DEFAULT 0 NOT NULL,
    "offline_netto" numeric DEFAULT 0 NOT NULL,
    "lordo" numeric DEFAULT 0 NOT NULL,
    "netto" numeric DEFAULT 0 NOT NULL,
    "mc1" numeric DEFAULT 0 NOT NULL,
    "mc2" numeric DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."ce_totale_monthly" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."change_log" (
    "id" bigint NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tbl" "text" NOT NULL,
    "row_id" "text",
    "op" "text" NOT NULL,
    "before" "jsonb",
    "after" "jsonb",
    "chi" "text",
    "source" "text"
);


ALTER TABLE "public"."change_log" OWNER TO "postgres";


ALTER TABLE "public"."change_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."change_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."counts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "data_conta" "date",
    "codice" "text",
    "modello" "text",
    "variante" "text",
    "contati" numeric,
    "giac_snapshot" numeric,
    "delta" numeric,
    "chi" "text",
    "nota" "text",
    "stato" "text",
    "source" "text" DEFAULT 'app'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cs_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gmail_thread_id" "text" NOT NULL,
    "canale" "text" NOT NULL,
    "customer_email" "text",
    "customer_name" "text",
    "stato" "text" DEFAULT 'da_fare'::"text" NOT NULL,
    "stato_by" "text",
    "stato_at" timestamp with time zone,
    "last_msg_at" timestamp with time zone,
    "last_direction" "text",
    "subject" "text",
    "snippet" "text",
    "order_number" integer,
    "lingua" "text",
    "categoria" "text",
    "categoria_source" "text",
    "categoria_confidence" numeric,
    "urgente" boolean,
    "urgenza_motivo" "text",
    "summary" "text",
    "summary_at" timestamp with time zone,
    "parse_failed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "flags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL
);


ALTER TABLE "public"."cs_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cs_drafts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "testo" "text",
    "dati_usati" "jsonb",
    "model" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "used" boolean DEFAULT false NOT NULL,
    "edited" boolean DEFAULT false NOT NULL,
    "source" "text" DEFAULT 'app'::"text" NOT NULL,
    "rami" "jsonb",
    "ramo_scelto" "text"
);


ALTER TABLE "public"."cs_drafts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cs_drafts"."source" IS 'app = bozza chiesta da operatrice; eval = generata dall''harness di valutazione (scripts/cs-eval.mjs, brief 29-07)';



COMMENT ON COLUMN "public"."cs_drafts"."rami" IS 'Titoli dei rami generati per questa bozza, nell''ordine proposto (jsonb array di stringhe). NULL quando la generazione e'' avvenuta col vecchio schema a toni o con il ripiego a bozza singola.';



COMMENT ON COLUMN "public"."cs_drafts"."ramo_scelto" IS 'Titolo del ramo che l''operatrice ha effettivamente usato, scritto al momento dell''invio (o della copia in Inbox per il canale chat), non alla generazione: e'' la scelta impegnativa, non un click di anteprima. Nel tempo e'' il dataset dei casi predefiniti reali (richiesta owner 01-08).';



CREATE TABLE IF NOT EXISTS "public"."cs_events" (
    "id" bigint NOT NULL,
    "conversation_id" "uuid",
    "azione" "text" NOT NULL,
    "chi" "text",
    "dettaglio" "jsonb",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cs_events" OWNER TO "postgres";


ALTER TABLE "public"."cs_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."cs_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cs_faq" (
    "id" bigint NOT NULL,
    "tipo" "text" NOT NULL,
    "titolo" "text",
    "testo_it" "text",
    "testo_en" "text",
    "categoria" "text",
    "attiva" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."cs_faq" OWNER TO "postgres";


ALTER TABLE "public"."cs_faq" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."cs_faq_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cs_knowledge" (
    "id" integer NOT NULL,
    "categoria" "text",
    "titolo" "text" NOT NULL,
    "contenuto" "text" NOT NULL,
    "attiva" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cs_knowledge" OWNER TO "postgres";


COMMENT ON TABLE "public"."cs_knowledge" IS 'Conoscenza di casa iniettata nel prompt delle bozze CS (cs-assist v14). categoria NULL = sempre; altrimenti solo sulla categoria (nomi ESATTI del classificatore). Si aggiorna qui, mai hardcoded nel prompt.';



CREATE SEQUENCE IF NOT EXISTS "public"."cs_knowledge_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cs_knowledge_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cs_knowledge_id_seq" OWNED BY "public"."cs_knowledge"."id";



CREATE TABLE IF NOT EXISTS "public"."cs_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gmail_message_id" "text" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "direction" "text" NOT NULL,
    "sent_by" "text",
    "from_email" "text",
    "to_email" "text",
    "sent_at" timestamp with time zone,
    "body_text" "text",
    "is_via_tool" boolean DEFAULT false NOT NULL,
    "form_fields" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "body_clean" "text",
    "reply_to" "text"
);


ALTER TABLE "public"."cs_messages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cs_messages"."body_clean" IS 'Corpo pulito deterministico (cs-sync stripQuoted): solo le parole del mittente, senza citazioni/firma/boilerplate. NULL = fallback su body_text.';



COMMENT ON COLUMN "public"."cs_messages"."reply_to" IS 'Header Reply-To del messaggio Gmail, minuscolo, come arrivato (NULL se assente). Fonte dell''email cliente indipendente dal corpo: sul canale modulo Shopify lo valorizza con l''indirizzo di chi ha compilato, qualunque sia la lingua del template. Usato come ULTIMA risorsa da emailCliente() in cs-send e cs-assist, dopo form_fields.email e from_email, cosi'' non puo'' cambiare un esito gia'' corretto. Popolata all''ingest da cs-sync dal 2026-08-01; lo storico si riempie con l''azione backfill_replyto.';



CREATE TABLE IF NOT EXISTS "public"."cs_sends" (
    "send_key" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "chi" "text",
    "to_email" "text",
    "testo_sha" "text",
    "status" "text" DEFAULT 'sending'::"text" NOT NULL,
    "gmail_message_id" "text",
    "gmail_thread_id" "text",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cs_sends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "year" integer,
    "month" integer,
    "date_reported" "date",
    "date_paid" "date",
    "operazione" "text",
    "costo" numeric(12,2),
    "categoria" "text",
    "sottocategoria" "text",
    "amimi_raw" "text",
    "note" "text",
    "source" "text" DEFAULT 'etl'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "amimi" boolean GENERATED ALWAYS AS (("lower"(TRIM(BOTH FROM COALESCE("amimi_raw", ''::"text"))) = 'si'::"text")) STORED,
    "status" "text" DEFAULT 'approved'::"text" NOT NULL,
    "proposed_by" "text",
    "approved_by" "text",
    "chi" "text",
    "categoria_valid" boolean GENERATED ALWAYS AS (("categoria" = ANY (ARRAY['COGS'::"text", 'LOGISTICA'::"text", 'MARKETING'::"text", 'OPEX'::"text", 'PACKAGING'::"text", 'SALARI'::"text", 'TASSE'::"text", 'EVENTI'::"text"]))) STORED
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gifts_offline" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gift_id" "text",
    "year" integer,
    "month" integer,
    "data" "date",
    "nome" "text",
    "cognome" "text",
    "codice" "text",
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "quantita" numeric,
    "payment_method" "text",
    "prezzo" numeric(12,2),
    "cogs" numeric(12,2),
    "nota" "text",
    "item" "text",
    "variant" "text",
    "kind" "text" DEFAULT 'gift'::"text" NOT NULL,
    "source" "text" DEFAULT 'etl'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "chi" "text",
    CONSTRAINT "gifts_offline_gift_senza_prezzo" CHECK ((("kind" <> 'gift'::"text") OR (COALESCE("prezzo", (0)::numeric) = (0)::numeric))),
    CONSTRAINT "gifts_offline_kind_check" CHECK (("kind" = ANY (ARRAY['gift'::"text", 'vendita_manuale'::"text", 'vendita_fuori_fatturato'::"text", 'rettifica'::"text"])))
);


ALTER TABLE "public"."gifts_offline" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."health_log" (
    "id" bigint NOT NULL,
    "day" "date" DEFAULT CURRENT_DATE NOT NULL,
    "k" "text" NOT NULL,
    "label" "text",
    "n" integer,
    "severity" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."health_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."health_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."health_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."health_log_id_seq" OWNED BY "public"."health_log"."id";



CREATE TABLE IF NOT EXISTS "public"."lead_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "tipo" "text" DEFAULT 'boutique'::"text" NOT NULL,
    "gruppo_id" "uuid",
    "indirizzo" "text",
    "citta" "text",
    "provincia" "text",
    "regione" "text",
    "paese" "text" DEFAULT 'IT'::"text" NOT NULL,
    "lat" double precision,
    "lng" double precision,
    "website" "text",
    "ig_handle" "text",
    "google_place_id" "text",
    "google_maps_url" "text",
    "telefono" "text",
    "email_generica" "text",
    "piva" "text",
    "fonte_seed" "text" NOT NULL,
    "priorita_tipologia" smallint,
    "stato_ricerca" "text" DEFAULT 'seed'::"text" NOT NULL,
    "rejected_motivo" "text",
    "lead_stage" "text" DEFAULT 'da_contattare'::"text" NOT NULL,
    "tier" "text",
    "gancio" "text",
    "gancio_evidence_id" "uuid",
    "owner_note" "text",
    "contattato_prima" boolean DEFAULT false NOT NULL,
    "chi" "text",
    "negozio_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "verdetto" "text",
    "verdetto_motivo" "text",
    "verdetto_chi" "text",
    "verdetto_at" timestamp with time zone,
    "prossima_azione" "text",
    "prossima_azione_at" "date",
    "owner_outreach" "text",
    CONSTRAINT "lead_accounts_lead_stage_check" CHECK (("lead_stage" = ANY (ARRAY['da_contattare'::"text", 'contattato'::"text", 'risposto'::"text", 'interessato'::"text", 'materiale_inviato'::"text", 'appuntamento'::"text", 'primo_ordine'::"text", 'attivo'::"text", 'chiuso_no'::"text", 'opt_out'::"text"]))),
    CONSTRAINT "lead_accounts_stato_ricerca_check" CHECK (("stato_ricerca" = ANY (ARRAY['seed'::"text", 'enriched'::"text", 'scored'::"text", 'reviewed'::"text", 'rejected'::"text"]))),
    CONSTRAINT "lead_accounts_tier_check" CHECK (("tier" = ANY (ARRAY['A'::"text", 'B'::"text", 'C'::"text"]))),
    CONSTRAINT "lead_accounts_tipo_check" CHECK (("tipo" = ANY (ARRAY['boutique'::"text", 'concept_store'::"text", 'hotel_shop'::"text", 'gruppo_multimarca'::"text", 'corner_department'::"text", 'negozio_regalo'::"text", 'online_multibrand'::"text"]))),
    CONSTRAINT "lead_accounts_verdetto_check" CHECK (("verdetto" = ANY (ARRAY['da_contattare'::"text", 'forse'::"text", 'no'::"text"])))
);


ALTER TABLE "public"."lead_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "nome" "text",
    "ruolo" "text",
    "email" "text",
    "telefono" "text",
    "linkedin_url" "text",
    "fonte" "text",
    "opt_out" boolean DEFAULT false NOT NULL,
    "opt_out_at" timestamp with time zone,
    "note" "text",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_drafts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "touch_in_id" "uuid",
    "lingua" "text",
    "testo" "text" NOT NULL,
    "fatti_usati" "jsonb",
    "stato" "text" DEFAULT 'proposta'::"text" NOT NULL,
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "oggetto" "text",
    "to_email" "text",
    "sequenza_tocco" integer,
    "model" "text",
    "send_key" "uuid",
    "sent_at" timestamp with time zone,
    "sent_by" "text",
    "gmail_message_id" "text",
    "gmail_thread_id" "text",
    "errore" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "origine" "text" DEFAULT 'manuale'::"text" NOT NULL,
    CONSTRAINT "lead_drafts_origine_check" CHECK (("origine" = ANY (ARRAY['manuale'::"text", 'auto'::"text"]))),
    CONSTRAINT "lead_drafts_stato_check" CHECK (("stato" = ANY (ARRAY['proposta'::"text", 'approvata'::"text", 'in_invio'::"text", 'inviata'::"text", 'errore'::"text", 'scartata'::"text"])))
);


ALTER TABLE "public"."lead_drafts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_evidence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "run_id" "uuid",
    "tipo" "text" NOT NULL,
    "payload" "jsonb",
    "asset_path" "text",
    "raccolto_da" "text" DEFAULT 'script'::"text" NOT NULL,
    "note" "text",
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_knowledge" (
    "id" integer NOT NULL,
    "categoria" "text",
    "titolo" "text" NOT NULL,
    "contenuto" "text" NOT NULL,
    "attiva" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_knowledge" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."lead_knowledge_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."lead_knowledge_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."lead_knowledge_id_seq" OWNED BY "public"."lead_knowledge"."id";



CREATE TABLE IF NOT EXISTS "public"."lead_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "chi" "text" NOT NULL,
    "azione" "text" NOT NULL,
    "tier" "text",
    "motivo" "text",
    "nota" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "verdetto" "text",
    CONSTRAINT "lead_reviews_azione_check" CHECK (("azione" = ANY (ARRAY['tier'::"text", 'scarta'::"text", 'ricontrolla'::"text", 'nota'::"text", 'verdetto'::"text"]))),
    CONSTRAINT "lead_reviews_tier_check" CHECK (("tier" = ANY (ARRAY['A'::"text", 'B'::"text", 'C'::"text"]))),
    CONSTRAINT "lead_reviews_verdetto_check" CHECK (("verdetto" = ANY (ARRAY['da_contattare'::"text", 'forse'::"text", 'no'::"text"])))
);


ALTER TABLE "public"."lead_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fase" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "n_input" integer DEFAULT 0 NOT NULL,
    "n_ok" integer DEFAULT 0 NOT NULL,
    "n_err" integer DEFAULT 0 NOT NULL,
    "note" "text",
    "log" "jsonb"
);


ALTER TABLE "public"."lead_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "run_id" "uuid",
    "rubrica_version" "text" DEFAULT 'v1'::"text" NOT NULL,
    "criteri" "jsonb" NOT NULL,
    "bonus" "jsonb",
    "esclusione" "text",
    "totale" numeric(5,1),
    "tier_proposto" "text",
    "dati_incompleti" boolean DEFAULT false NOT NULL,
    "motivazione" "text",
    "perche_no" "text",
    "modello" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lead_scores_tier_proposto_check" CHECK (("tier_proposto" = ANY (ARRAY['A'::"text", 'B'::"text", 'C'::"text"])))
);


ALTER TABLE "public"."lead_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_sequences" (
    "id" integer NOT NULL,
    "codice" "text" NOT NULL,
    "tocco" integer NOT NULL,
    "giorni_attesa" integer DEFAULT 0 NOT NULL,
    "canale" "text" DEFAULT 'email'::"text" NOT NULL,
    "lingua" "text" DEFAULT 'it'::"text" NOT NULL,
    "oggetto" "text",
    "corpo" "text" NOT NULL,
    "chi_default" "text",
    "attiva" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_sequences" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."lead_sequences_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."lead_sequences_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."lead_sequences_id_seq" OWNED BY "public"."lead_sequences"."id";



CREATE TABLE IF NOT EXISTS "public"."lead_touches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "contact_id" "uuid",
    "canale" "text" NOT NULL,
    "direzione" "text" NOT NULL,
    "gmail_message_id" "text",
    "gmail_thread_id" "text",
    "subject" "text",
    "body_clean" "text",
    "stage_prima" "text",
    "stage_dopo" "text",
    "chi" "text",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "esito" "text",
    "prossima_azione" "text",
    "prossima_azione_at" "date",
    "sequenza_tocco" integer,
    CONSTRAINT "lead_touches_canale_check" CHECK (("canale" = ANY (ARRAY['email'::"text", 'telefono'::"text", 'instagram_dm'::"text", 'visita'::"text", 'altro'::"text"]))),
    CONSTRAINT "lead_touches_direzione_check" CHECK (("direzione" = ANY (ARRAY['in'::"text", 'out'::"text"])))
);


ALTER TABLE "public"."lead_touches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_birthday_awards" (
    "shopify_customer_id" "text" NOT NULL,
    "year" integer NOT NULL,
    "points" integer NOT NULL,
    "birthday" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loyalty_birthday_awards_points_check" CHECK (("points" > 0))
);


ALTER TABLE "public"."loyalty_birthday_awards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_bonus_second" (
    "shopify_customer_id" "text" NOT NULL,
    "first_order_id" "text" NOT NULL,
    "second_order_id" "text" NOT NULL,
    "first_order_at" timestamp with time zone NOT NULL,
    "second_order_at" timestamp with time zone NOT NULL,
    "points" integer NOT NULL,
    "points_reversed" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reversed_at" timestamp with time zone,
    CONSTRAINT "loyalty_bonus_second_check" CHECK ((("points_reversed" >= 0) AND ("points_reversed" <= "points"))),
    CONSTRAINT "loyalty_bonus_second_points_check" CHECK (("points" > 0))
);


ALTER TABLE "public"."loyalty_bonus_second" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_checkin_events" (
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "points" integer DEFAULT 20 NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "max_checkins" integer DEFAULT 300 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loyalty_checkin_events_code_chk" CHECK (("code" ~ '^[A-Z0-9_-]{4,40}$'::"text")),
    CONSTRAINT "loyalty_checkin_events_label_chk" CHECK ((("length"(TRIM(BOTH FROM "label")) >= 1) AND ("length"(TRIM(BOTH FROM "label")) <= 80))),
    CONSTRAINT "loyalty_checkin_events_max_chk" CHECK ((("max_checkins" >= 1) AND ("max_checkins" <= 5000))),
    CONSTRAINT "loyalty_checkin_events_points_chk" CHECK ((("points" >= 1) AND ("points" <= 100))),
    CONSTRAINT "loyalty_checkin_events_window_chk" CHECK ((("ends_at" > "starts_at") AND ("ends_at" <= ("starts_at" + '14 days'::interval))))
);


ALTER TABLE "public"."loyalty_checkin_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_checkins" (
    "event_code" "text" NOT NULL,
    "shopify_customer_id" "text" NOT NULL,
    "points" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."loyalty_checkins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shopify_customer_id" "text" NOT NULL,
    "delta" integer NOT NULL,
    "source" "text" NOT NULL,
    "meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."loyalty_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_order_credits" (
    "shopify_order_id" "text" NOT NULL,
    "shopify_customer_id" "text" NOT NULL,
    "points" integer NOT NULL,
    "order_total" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "order_name" "text",
    CONSTRAINT "loyalty_order_credits_points_pos" CHECK (("points" > 0))
);


ALTER TABLE "public"."loyalty_order_credits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_order_reversals" (
    "shopify_order_id" "text" NOT NULL,
    "points_reversed" integer DEFAULT 0 NOT NULL,
    "refunded_amount" numeric,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loyalty_order_reversals_points_reversed_check" CHECK (("points_reversed" >= 0))
);


ALTER TABLE "public"."loyalty_order_reversals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_points" (
    "shopify_customer_id" "text" NOT NULL,
    "points" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loyalty_points_points_nonneg" CHECK (("points" >= 0))
);


ALTER TABLE "public"."loyalty_points" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_profiles" (
    "shopify_customer_id" "text" NOT NULL,
    "birth_day" smallint,
    "birth_month" smallint,
    "birth_set_at" timestamp with time zone,
    "materiale_preferito" "text",
    "consenso_compleanno" boolean DEFAULT false NOT NULL,
    "consenso_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loyalty_profiles_birth_chk" CHECK (((("birth_day" IS NULL) AND ("birth_month" IS NULL) AND ("birth_set_at" IS NULL)) OR (("birth_day" IS NOT NULL) AND ("birth_month" IS NOT NULL) AND ("birth_set_at" IS NOT NULL) AND (("birth_month" >= 1) AND ("birth_month" <= 12)) AND (("birth_day" >= 1) AND ("birth_day" <=
CASE "birth_month"
    WHEN 2 THEN 29
    WHEN 4 THEN 30
    WHEN 6 THEN 30
    WHEN 9 THEN 30
    WHEN 11 THEN 30
    ELSE 31
END))))),
    CONSTRAINT "loyalty_profiles_materiale_chk" CHECK ((("materiale_preferito" IS NULL) OR ("materiale_preferito" = ANY (ARRAY['cavallino'::"text", 'cocco'::"text", 'vernice'::"text", 'pelle liscia'::"text", 'cotone'::"text", 'nessuna preferenza'::"text"]))))
);


ALTER TABLE "public"."loyalty_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_redemptions" (
    "id" bigint NOT NULL,
    "idemp" "text" NOT NULL,
    "shopify_customer_id" "text" NOT NULL,
    "reward_key" "text" NOT NULL,
    "cost_points" integer NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "discount_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fulfilled_at" timestamp with time zone,
    "meta" "jsonb",
    CONSTRAINT "loyalty_redemptions_status_chk" CHECK (("status" = ANY (ARRAY['pending'::"text", 'fulfilled'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."loyalty_redemptions" OWNER TO "postgres";


ALTER TABLE "public"."loyalty_redemptions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."loyalty_redemptions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."loyalty_reward_codes" (
    "code" "text" NOT NULL,
    "reward_key" "text" NOT NULL,
    "claimed_by" "text",
    "redemption_id" bigint,
    "claimed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."loyalty_reward_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_rewards" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "cost_points" integer NOT NULL,
    "kind" "text" NOT NULL,
    "value" numeric,
    "active" boolean DEFAULT true NOT NULL,
    "sort" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loyalty_rewards_cost_points_check" CHECK (("cost_points" > 0)),
    CONSTRAINT "loyalty_rewards_kind_chk" CHECK (("kind" = ANY (ARRAY['percentage'::"text", 'amount'::"text", 'shipping'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."loyalty_rewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_ugc" (
    "id" bigint NOT NULL,
    "shopify_customer_id" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "codice" "text" NOT NULL,
    "titolo" "text",
    "rating" smallint,
    "testo" "text",
    "firma" "text",
    "foto" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "verificata" boolean DEFAULT false NOT NULL,
    "consenso_testo" "text" NOT NULL,
    "consenso_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'in_revisione'::"text" NOT NULL,
    "motivo" "text",
    "punti" integer,
    "deciso_at" timestamp with time zone,
    "deciso_da" "text",
    "idemp" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loyalty_ugc_codice_chk" CHECK (("codice" ~ '^[A-Z0-9_]{3,80}$'::"text")),
    CONSTRAINT "loyalty_ugc_deciso_chk" CHECK ((("status" = 'in_revisione'::"text") = ("deciso_at" IS NULL))),
    CONSTRAINT "loyalty_ugc_firma_chk" CHECK ((("firma" IS NULL) OR ("char_length"("firma") <= 40))),
    CONSTRAINT "loyalty_ugc_foto_chk" CHECK ((("cardinality"("foto") <= 3) AND (("kind" = 'recensione'::"text") OR ("cardinality"("foto") >= 1)))),
    CONSTRAINT "loyalty_ugc_idemp_chk" CHECK ((("char_length"("idemp") >= 8) AND ("char_length"("idemp") <= 80))),
    CONSTRAINT "loyalty_ugc_kind_chk" CHECK (("kind" = ANY (ARRAY['recensione'::"text", 'look'::"text"]))),
    CONSTRAINT "loyalty_ugc_motivo_chk" CHECK ((("status" <> 'rifiutata'::"text") OR (("char_length"(COALESCE("motivo", ''::"text")) >= 3) AND ("char_length"(COALESCE("motivo", ''::"text")) <= 200)))),
    CONSTRAINT "loyalty_ugc_rating_chk" CHECK (((("kind" = 'recensione'::"text") AND ("rating" IS NOT NULL) AND (("rating" >= 1) AND ("rating" <= 5))) OR (("kind" = 'look'::"text") AND ("rating" IS NULL)))),
    CONSTRAINT "loyalty_ugc_status_chk" CHECK (("status" = ANY (ARRAY['in_revisione'::"text", 'approvata'::"text", 'rifiutata'::"text"]))),
    CONSTRAINT "loyalty_ugc_testo_chk" CHECK ((("testo" IS NULL) OR ("char_length"("testo") <= 600)))
);


ALTER TABLE "public"."loyalty_ugc" OWNER TO "postgres";


ALTER TABLE "public"."loyalty_ugc" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."loyalty_ugc_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."loyalty_ugc_slots" (
    "shopify_customer_id" "text" NOT NULL,
    "day" "date" NOT NULL,
    "n" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "loyalty_ugc_slots_n_chk" CHECK ((("n" >= 0) AND ("n" <= 12)))
);


ALTER TABLE "public"."loyalty_ugc_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_ui_events" (
    "id" bigint NOT NULL,
    "shopify_customer_id" "text" NOT NULL,
    "day" "date" NOT NULL,
    "event" "text" NOT NULL,
    "element" "text",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loyalty_ui_events_element_check" CHECK ((("element" IS NULL) OR ("element" ~ '^[a-z0-9_]{1,32}$'::"text"))),
    CONSTRAINT "loyalty_ui_events_event_check" CHECK (("event" = ANY (ARRAY['page_open'::"text", 'view'::"text", 'tap'::"text"])))
);


ALTER TABLE "public"."loyalty_ui_events" OWNER TO "postgres";


ALTER TABLE "public"."loyalty_ui_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."loyalty_ui_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."loyalty_visits" (
    "shopify_customer_id" "text" NOT NULL,
    "day" "date" NOT NULL,
    "hits" integer DEFAULT 1 NOT NULL,
    "first_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."loyalty_visits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mat_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "item_id" "uuid",
    "materiale" "text",
    "order_id" "uuid",
    "path" "text" NOT NULL,
    "tipo" "text" NOT NULL,
    "titolo" "text",
    "mime" "text",
    "bytes" integer,
    "fonte" "text",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mat_assets_tipo_check" CHECK (("tipo" = ANY (ARRAY['foto'::"text", 'scheda_tecnica'::"text", 'proforma'::"text", 'documento'::"text", 'campione'::"text"])))
);


ALTER TABLE "public"."mat_assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mat_events" (
    "id" bigint NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "chi" "text" NOT NULL,
    "azione" "text" NOT NULL,
    "tabella" "text",
    "riga_id" "uuid",
    "before" "jsonb",
    "after" "jsonb",
    "note" "text"
);


ALTER TABLE "public"."mat_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."mat_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."mat_events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."mat_events_id_seq" OWNED BY "public"."mat_events"."id";



CREATE TABLE IF NOT EXISTS "public"."mat_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "categoria" "text" NOT NULL,
    "materiale" "text" NOT NULL,
    "articolo_fornitore" "text",
    "colore" "text",
    "unita" "text",
    "attivo" boolean DEFAULT true NOT NULL,
    "note" "text",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mat_items_categoria_check" CHECK (("categoria" = ANY (ARRAY['Tessuto'::"text", 'Tessuto velluto'::"text", 'Animalier'::"text", 'Cocco'::"text", 'Vitello stampato'::"text", 'Pelle vitello'::"text", 'Vernice'::"text", 'Crosta/Velour'::"text", 'Nappa'::"text", 'Nastri'::"text", 'Accessori metallici'::"text"]))),
    CONSTRAINT "mat_items_unita_check" CHECK (("unita" = ANY (ARRAY['mq'::"text", 'ml'::"text", 'mt'::"text", 'pz'::"text"])))
);


ALTER TABLE "public"."mat_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mat_offers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "item_id" "uuid" NOT NULL,
    "tipo" "text" DEFAULT 'offerta'::"text" NOT NULL,
    "prezzo" numeric(12,4),
    "prezzo_text" "text",
    "valuta" "text" DEFAULT 'EUR'::"text" NOT NULL,
    "unita" "text",
    "disponibilita" "text",
    "min_ordine" "text",
    "lead_time" "text",
    "data" "date",
    "documento_fonte" "text",
    "note" "text",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mat_offers_tipo_check" CHECK (("tipo" = ANY (ARRAY['offerta'::"text", 'listino'::"text"]))),
    CONSTRAINT "mat_offers_unita_check" CHECK (("unita" = ANY (ARRAY['mq'::"text", 'ml'::"text", 'mt'::"text", 'pz'::"text"])))
);


ALTER TABLE "public"."mat_offers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mat_order_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "quantita" numeric(12,3),
    "unita" "text",
    "prezzo_unitario" numeric(12,4),
    "sconto_text" "text",
    "importo" numeric(12,2),
    "iva_percent" numeric(5,2),
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mat_order_lines_unita_check" CHECK (("unita" = ANY (ARRAY['mq'::"text", 'ml'::"text", 'mt'::"text", 'pz'::"text"])))
);


ALTER TABLE "public"."mat_order_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mat_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "tipo_documento" "text",
    "numero_documento" "text" NOT NULL,
    "data_documento" "date",
    "valuta" "text" DEFAULT 'EUR'::"text" NOT NULL,
    "totale_imponibile" numeric(12,2),
    "totale_iva" numeric(12,2),
    "totale_documento" numeric(12,2),
    "condizioni_pagamento" "text",
    "deposito_luogo" "text",
    "stato" "text" DEFAULT 'ordinato'::"text" NOT NULL,
    "note" "text",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mat_orders_stato_check" CHECK (("stato" = ANY (ARRAY['ordinato'::"text", 'pagato'::"text", 'ricevuto'::"text", 'annullato'::"text"]))),
    CONSTRAINT "mat_orders_tipo_documento_check" CHECK (("tipo_documento" = ANY (ARRAY['fattura'::"text", 'fattura_proforma'::"text", 'altro'::"text"])))
);


ALTER TABLE "public"."mat_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mat_suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "ragione_sociale" "text",
    "categoria_principale" "text",
    "email" "text",
    "telefono" "text",
    "referente" "text",
    "indirizzo" "text",
    "piva_vat" "text",
    "deposito_luogo" "text",
    "condizioni_pagamento" "text",
    "note" "text",
    "attivo" boolean DEFAULT true NOT NULL,
    "core_supplier_id" "uuid",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mat_suppliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meta_ad_creative" (
    "ad_id" "text" NOT NULL,
    "creative_id" "text",
    "ad_name" "text",
    "adset_id" "text",
    "campaign_id" "text",
    "object_type" "text",
    "title" "text",
    "thumbnail_url" "text",
    "link" "text",
    "url_tags" "text",
    "product_set_id" "text",
    "catalog_id" "text",
    "effective_status" "text",
    "first_seen" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "image_url" "text",
    "frame_url" "text"
);


ALTER TABLE "public"."meta_ad_creative" OWNER TO "postgres";


COMMENT ON TABLE "public"."meta_ad_creative" IS 'Amimì Ads: anagrafica per ad, con aggancio catalogo (product_set_id) e destinazione.';



CREATE TABLE IF NOT EXISTS "public"."meta_ad_freq7" (
    "ad_id" "text" NOT NULL,
    "day" "date",
    "freq_7d" numeric(10,4),
    "reach_7d" bigint,
    "impressions_7d" bigint,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."meta_ad_freq7" OWNER TO "postgres";


COMMENT ON TABLE "public"."meta_ad_freq7" IS 'Amimì Ads: frequency VERA a 7 giorni per ad (una chiamata insights sul 7d, reach deduplicata). Punto 6.';



CREATE TABLE IF NOT EXISTS "public"."meta_ads_creative_daily" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "account_id" "text",
    "campaign_id" "text",
    "campaign_name" "text",
    "campaign_objective" "text",
    "adset_id" "text",
    "adset_name" "text",
    "ad_id" "text" NOT NULL,
    "ad_name" "text",
    "ad_status" "text",
    "creative_id" "text",
    "spend" numeric(12,2),
    "impressions" bigint,
    "reach" bigint,
    "frequency" numeric(10,4),
    "clicks" bigint,
    "link_clicks" bigint,
    "ctr" numeric(10,4),
    "cpc" numeric(10,4),
    "cpm" numeric(10,4),
    "landing_page_views" bigint,
    "view_content" bigint,
    "add_to_cart" bigint,
    "initiate_checkout" bigint,
    "add_payment_info" bigint,
    "purchases" bigint,
    "purchase_value" numeric(12,2),
    "cpa" numeric(12,4),
    "roas" numeric(12,4),
    "pulled_at" timestamp with time zone,
    "source" "text" DEFAULT 'ads-sync'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "video_3s_views" numeric,
    "thruplays" numeric
);


ALTER TABLE "public"."meta_ads_creative_daily" OWNER TO "postgres";


COMMENT ON TABLE "public"."meta_ads_creative_daily" IS 'Amimì Ads: metriche giornaliere per ad/creativita'' (level=ad). Scritta da edge ads-sync. ad_status/creative_id riservati (null in v1: insights level=ad non li espone).';



COMMENT ON COLUMN "public"."meta_ads_creative_daily"."video_3s_views" IS 'Visualizzazioni da 3 secondi (actions video_view). Null = riga letta prima di ads-sync v1.4.';



COMMENT ON COLUMN "public"."meta_ads_creative_daily"."thruplays" IS 'ThruPlay (video_thruplay_watched_actions video_view). Null = riga letta prima di ads-sync v1.4.';



CREATE TABLE IF NOT EXISTS "public"."meta_ads_daily" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date",
    "campaign_id" "text",
    "campaign_name" "text",
    "campaign_status" "text",
    "campaign_objective" "text",
    "spend" numeric(12,2),
    "impressions" bigint,
    "reach" bigint,
    "frequency" numeric(10,4),
    "clicks" bigint,
    "link_clicks" bigint,
    "ctr" numeric(10,4),
    "cpc" numeric(10,4),
    "cpm" numeric(10,4),
    "landing_page_views" bigint,
    "view_content" bigint,
    "add_to_cart" bigint,
    "initiate_checkout" bigint,
    "add_payment_info" bigint,
    "purchases" bigint,
    "purchase_value" numeric(12,2),
    "cpa" numeric(12,4),
    "roas" numeric(12,4),
    "pulled_at" timestamp with time zone,
    "source" "text" DEFAULT 'etl'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."meta_ads_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meta_ads_window_reach" (
    "level" "text" NOT NULL,
    "object_id" "text" NOT NULL,
    "window_key" "text" NOT NULL,
    "since" "date" NOT NULL,
    "until" "date" NOT NULL,
    "reach" numeric,
    "impressions" numeric,
    "frequency" numeric,
    "spend" numeric,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "meta_ads_window_reach_level_check" CHECK (("level" = ANY (ARRAY['account'::"text", 'campaign'::"text", 'adset'::"text", 'ad'::"text"]))),
    CONSTRAINT "meta_ads_window_reach_window_key_check" CHECK (("window_key" = ANY (ARRAY['cur14'::"text", 'prev14'::"text"])))
);


ALTER TABLE "public"."meta_ads_window_reach" OWNER TO "postgres";


COMMENT ON TABLE "public"."meta_ads_window_reach" IS 'Amimì Ads: reach deduplicata delle finestre cur14/prev14 per account, campagna, adset e ad (una chiamata insights per finestra). Scritta da ads-sync v1.4; le viste la usano solo se since/until coincidono con la finestra.';



CREATE TABLE IF NOT EXISTS "public"."meta_product_set_map" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_set_id" "text" NOT NULL,
    "catalog_id" "text",
    "retailer_id" "text" NOT NULL,
    "codice_norm" "text",
    "product_name" "text",
    "availability" "text",
    "last_seen" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."meta_product_set_map" OWNER TO "postgres";


COMMENT ON TABLE "public"."meta_product_set_map" IS 'Amimì Ads: mappa product_set Meta -> retailer_id -> codice_norm app.';



CREATE TABLE IF NOT EXISTS "public"."mimi_state" (
    "shopify_customer_id" "text" NOT NULL,
    "nanna" boolean DEFAULT false NOT NULL,
    "last_coccola" "date",
    "last_memory" "date",
    "worn" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mimi_state" OWNER TO "postgres";


COMMENT ON TABLE "public"."mimi_state" IS 'Stato Mimi per cliente Shopify (nanna, coccole/memory del giorno, capo indossato). Scritta SOLO dalla edge loyalty-proxy col service_role. Le date last_* sono giorni Europe/Rome, non UTC.';



CREATE TABLE IF NOT EXISTS "public"."models" (
    "model" "text" NOT NULL,
    "model_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"("model", '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "categoria" "text" NOT NULL,
    "product_type" "text",
    "template_suffix" "text",
    "collections" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "models_categoria_check" CHECK (("categoria" = ANY (ARRAY['PELLE'::"text", 'TESSUTO'::"text", 'ACCESSORI'::"text"])))
);


ALTER TABLE "public"."models" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."negozi" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "perc_default" numeric(6,4),
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."negozi" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."non_product_codici" (
    "codice" "text" NOT NULL
);


ALTER TABLE "public"."non_product_codici" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_aliases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shopify_name" "text" NOT NULL,
    "shopify_name_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("shopify_name", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "codice" "text" NOT NULL,
    "source" "text" DEFAULT 'etl'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_aliases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codice" "text" NOT NULL,
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "is_finalized" boolean GENERATED ALWAYS AS (((COALESCE("codice", ''::"text") <> ''::"text") AND ("right"(COALESCE("codice", ''::"text"), 1) <> '_'::"text"))) STORED,
    "model" "text",
    "variant" "text",
    "item" "text",
    "categoria" "text",
    "shopify_name" "text",
    "shopify_sku" "text",
    "retail_price" numeric(12,2),
    "cogs" numeric(12,2),
    "description" "text",
    "seo_title" "text",
    "image_url" "text",
    "status" "text",
    "notes" "text",
    "source" "text" DEFAULT 'etl'::"text",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "verificato" boolean DEFAULT true NOT NULL,
    "riordino_archiviato" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id_acquisto" "text",
    "codice" "text",
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "data" "date",
    "tipologia" "text",
    "categoria" "text",
    "item" "text",
    "variant" "text",
    "quantita" numeric,
    "unita_misura" "text",
    "costo_unitario" numeric(12,2),
    "costo_totale" numeric(14,2) GENERATED ALWAYS AS ("round"((COALESCE("quantita", (0)::numeric) * COALESCE("costo_unitario", (0)::numeric)), 2)) STORED,
    "fornitore" "text",
    "online" integer,
    "source" "text" DEFAULT 'etl'::"text",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "note" "text"
);


ALTER TABLE "public"."purchases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."qromo_sales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "text",
    "sale_id" "text",
    "data" "date",
    "year" integer,
    "month" integer,
    "nome" "text",
    "cognome" "text",
    "codice" "text",
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "item" "text",
    "variant" "text",
    "quantita" numeric,
    "payment_method" "text",
    "prezzo" numeric(12,2),
    "cogs" numeric(12,2),
    "resolver_status" "text",
    "note" "text",
    "source" "text" DEFAULT 'etl'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."qromo_sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."returns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "data" "date" DEFAULT CURRENT_DATE NOT NULL,
    "year" integer,
    "month" integer,
    "codice" "text" NOT NULL,
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "item" "text",
    "variant" "text",
    "quantita" numeric DEFAULT 1 NOT NULL,
    "canale" "text",
    "importo_rimborsato" numeric DEFAULT 0,
    "rientra_stock" boolean DEFAULT true NOT NULL,
    "motivo" "text",
    "sostituito_con" "text",
    "note" "text",
    "source" "text",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."returns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shipping_status" (
    "ldv" "text" NOT NULL,
    "order_name" "text" NOT NULL,
    "stato_tws" "text" NOT NULL,
    "stato_raw" "text",
    "shipped_date" "date",
    "seen_delivered_at" "date",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shipping_status" OWNER TO "postgres";


COMMENT ON COLUMN "public"."shipping_status"."seen_delivered_at" IS 'Data (Europe/Rome) in cui il sync ha OSSERVATO il passaggio a CONSEGNATA. NON e'' la data di consegna del corriere: TWS non la espone. NULL quando la riga era gia'' consegnata alla prima osservazione.';



CREATE TABLE IF NOT EXISTS "public"."shopify_catalog" (
    "codice" "text" NOT NULL,
    "handle" "text",
    "on_shopify" boolean DEFAULT true NOT NULL,
    "synced_at" timestamp with time zone
);


ALTER TABLE "public"."shopify_catalog" OWNER TO "postgres";


COMMENT ON TABLE "public"."shopify_catalog" IS 'Mirror del catalogo Shopify per codice: handle della scheda (per i link nelle risposte al cliente) e on_shopify = la scheda e'' active. Scritta SOLO da shopify-stock doSync. NON e'' la fonte dello stock: quella e'' shopify_stock.';



COMMENT ON COLUMN "public"."shopify_catalog"."synced_at" IS 'Ultimo giro di sync che ha visto questa riga (shopify-stock doSync, orario). Serve a rendere VISIBILE una tabella ferma: e'' rimasta indietro cinque settimane senza che nessuno se ne accorgesse.';



CREATE TABLE IF NOT EXISTS "public"."shopify_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "text",
    "lineitem_name" "text",
    "codice" "text",
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "resolved" boolean,
    "quantita" numeric,
    "price" numeric(12,2),
    "cogs_snapshot" numeric(12,2),
    "year" integer,
    "month" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "shopify_line_id" bigint
);


ALTER TABLE "public"."shopify_line_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."shopify_line_items"."shopify_line_id" IS 'id della riga d''ordine su Shopify (line_item.id). Scritto da shopify-sync v7 all''ingest e da backfill_line_ids per lo storico; NULL = riga pre-v7 non ancora abbinata.';



CREATE TABLE IF NOT EXISTS "public"."shopify_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "text",
    "order_number" "text",
    "created_at_shop" timestamp with time zone,
    "customer_name" "text",
    "email" "text",
    "financial_status" "text",
    "fulfillment_status" "text",
    "gross_total" numeric(12,2),
    "net_total" numeric(12,2),
    "discount_total" numeric(12,2),
    "shipping_total" numeric(12,2),
    "payment_fees" numeric(12,2),
    "refund_amount" numeric(12,2),
    "free_shipping" boolean,
    "currency" "text",
    "year" integer,
    "month" integer,
    "raw" "jsonb",
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vendor" "text",
    "free_shipping_amt" numeric(12,2),
    "fulfilled_at" timestamp with time zone,
    "discount_codes" "text"
);


ALTER TABLE "public"."shopify_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shopify_stock" (
    "codice" "text" NOT NULL,
    "shopify_qty" numeric,
    "shopify_title" "text",
    "variant_id" "text",
    "inventory_item_id" "text",
    "synced_at" timestamp with time zone DEFAULT "now"(),
    "image_url" "text",
    "inventory_item_ids" "text"[],
    "shopify_status" "text",
    "item_qtys" "jsonb"
);


ALTER TABLE "public"."shopify_stock" OWNER TO "postgres";


COMMENT ON COLUMN "public"."shopify_stock"."item_qtys" IS 'Quantita'' Shopify per singolo inventory item: {"<inventory_item_id>": <qty>}. La scrive shopify-stock a ogni sync. Serve a realign_all per decidere la push guardando OGNI variante invece del solo shopify_qty collassato (migr 0106, brief varianti divergenti 04-08). NULL = riga mai ri-sincronizzata dopo la 0106: il codice ricade sul confronto vecchio.';



CREATE TABLE IF NOT EXISTS "public"."stock_adjustments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codice" "text" NOT NULL,
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "qty_delta" numeric NOT NULL,
    "motivo" "text" DEFAULT 'conta'::"text",
    "count_id" "uuid",
    "data" "date" DEFAULT (("now"() AT TIME ZONE 'Europe/Rome'::"text"))::"date",
    "chi" "text",
    "source" "text" DEFAULT 'app'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "return_id" "uuid"
);


ALTER TABLE "public"."stock_adjustments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."stock_adjustments"."return_id" IS 'FK logica a returns.id: aggiustamento generato da un cambio-merce (sostituto uscito); reso reversibile via write-api return_delete';



CREATE TABLE IF NOT EXISTS "public"."supplier_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codice" "text",
    "item" "text",
    "variant" "text",
    "fornitore" "text",
    "qty_ordered" numeric,
    "qty_arrived" numeric DEFAULT 0 NOT NULL,
    "data_ordine" "date",
    "data_ultimo_arrivo" "date",
    "note" "text",
    "source" "text" DEFAULT 'app'::"text",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gruppo" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nuovo_riordino" "text",
    "costo_unitario" numeric,
    "data_consegna" "date",
    "wip" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."supplier_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "kind" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_inventory" AS
 WITH "pur" AS (
         SELECT "purchases"."codice_norm",
            "sum"("purchases"."quantita") AS "q"
           FROM "public"."purchases"
          GROUP BY "purchases"."codice_norm"
        ), "sho" AS (
         SELECT "shopify_line_items"."codice_norm",
            "sum"("shopify_line_items"."quantita") AS "q"
           FROM "public"."shopify_line_items"
          GROUP BY "shopify_line_items"."codice_norm"
        ), "qro" AS (
         SELECT "qromo_sales"."codice_norm",
            "sum"("qromo_sales"."quantita") AS "q"
           FROM "public"."qromo_sales"
          GROUP BY "qromo_sales"."codice_norm"
        ), "gif" AS (
         SELECT "gifts_offline"."codice_norm",
            "sum"("gifts_offline"."quantita") AS "q"
           FROM "public"."gifts_offline"
          GROUP BY "gifts_offline"."codice_norm"
        ), "ret" AS (
         SELECT "returns"."codice_norm",
            "sum"("returns"."quantita") AS "q"
           FROM "public"."returns"
          WHERE ("returns"."rientra_stock" = true)
          GROUP BY "returns"."codice_norm"
        ), "adj" AS (
         SELECT "stock_adjustments"."codice_norm",
            "sum"("stock_adjustments"."qty_delta") AS "q"
           FROM "public"."stock_adjustments"
          GROUP BY "stock_adjustments"."codice_norm"
        ), "b2v" AS (
         SELECT "b2b_movements"."codice_norm",
            "sum"("b2b_movements"."quantita") AS "q"
           FROM "public"."b2b_movements"
          WHERE ("b2b_movements"."tipo_movimento" = 'venduto'::"text")
          GROUP BY "b2b_movements"."codice_norm"
        ), "b2cv" AS (
         SELECT "b2b_movements"."codice_norm",
            "sum"(
                CASE
                    WHEN ("b2b_movements"."tipo_movimento" = 'invio'::"text") THEN "b2b_movements"."quantita"
                    WHEN ("b2b_movements"."tipo_movimento" = ANY (ARRAY['reso'::"text", 'venduto'::"text"])) THEN (- "b2b_movements"."quantita")
                    ELSE (0)::numeric
                END) AS "q"
           FROM "public"."b2b_movements"
          WHERE ("b2b_movements"."modello" = 'conto_vendita'::"text")
          GROUP BY "b2b_movements"."codice_norm"
        ), "last_sale" AS (
         SELECT "s"."codice_norm",
            "max"("s"."d") AS "d"
           FROM ( SELECT "qromo_sales"."codice_norm",
                    ("qromo_sales"."data")::timestamp with time zone AS "d"
                   FROM "public"."qromo_sales"
                  WHERE ("qromo_sales"."data" IS NOT NULL)
                UNION ALL
                 SELECT "b2b_movements"."codice_norm",
                    ("b2b_movements"."data")::timestamp with time zone AS "data"
                   FROM "public"."b2b_movements"
                  WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND ("b2b_movements"."data" IS NOT NULL))
                UNION ALL
                 SELECT "li"."codice_norm",
                    "o"."created_at_shop"
                   FROM ("public"."shopify_line_items" "li"
                     JOIN "public"."shopify_orders" "o" ON (("o"."order_id" = "li"."order_id")))
                  WHERE ("o"."created_at_shop" IS NOT NULL)) "s"
          GROUP BY "s"."codice_norm"
        ), "shop" AS (
         SELECT "upper"("regexp_replace"(COALESCE("shopify_stock"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) AS "codice_norm",
            "max"("shopify_stock"."image_url") AS "image_url",
            "bool_or"((COALESCE("shopify_stock"."shopify_status", 'active'::"text") = 'active'::"text")) AS "is_active"
           FROM "public"."shopify_stock"
          WHERE (("shopify_stock"."codice" IS NOT NULL) AND ("shopify_stock"."codice" <> ''::"text"))
          GROUP BY ("upper"("regexp_replace"(COALESCE("shopify_stock"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")))
        )
 SELECT "p"."codice",
    "p"."codice_norm",
    "p"."item",
    "p"."variant",
    "p"."categoria",
    "p"."retail_price",
    "p"."cogs",
    COALESCE("p"."image_url", "shop"."image_url") AS "image_url",
    "p"."status",
    COALESCE("pur"."q", (0)::numeric) AS "qty_purchased",
    COALESCE("sho"."q", (0)::numeric) AS "shopify_sold",
    COALESCE("qro"."q", (0)::numeric) AS "qromo_sold",
    COALESCE("gif"."q", (0)::numeric) AS "gift_sold",
    COALESCE("b2v"."q", (0)::numeric) AS "b2b_venduto",
    COALESCE("b2cv"."q", (0)::numeric) AS "in_conto_vendita",
    (((((COALESCE("pur"."q", (0)::numeric) - COALESCE("sho"."q", (0)::numeric)) - COALESCE("qro"."q", (0)::numeric)) - COALESCE("gif"."q", (0)::numeric)) + COALESCE("ret"."q", (0)::numeric)) + COALESCE("adj"."q", (0)::numeric)) AS "giacenza_attuale",
    ((((((COALESCE("pur"."q", (0)::numeric) - COALESCE("sho"."q", (0)::numeric)) - COALESCE("qro"."q", (0)::numeric)) - COALESCE("gif"."q", (0)::numeric)) + COALESCE("ret"."q", (0)::numeric)) + COALESCE("adj"."q", (0)::numeric)) - COALESCE("b2v"."q", (0)::numeric)) AS "giacenza_totale_conb2b",
    (((((((COALESCE("pur"."q", (0)::numeric) - COALESCE("sho"."q", (0)::numeric)) - COALESCE("qro"."q", (0)::numeric)) - COALESCE("gif"."q", (0)::numeric)) + COALESCE("ret"."q", (0)::numeric)) + COALESCE("adj"."q", (0)::numeric)) - COALESCE("b2v"."q", (0)::numeric)) - COALESCE("b2cv"."q", (0)::numeric)) AS "disponibili_da_vendere",
    "round"(((((((COALESCE("pur"."q", (0)::numeric) - COALESCE("sho"."q", (0)::numeric)) - COALESCE("qro"."q", (0)::numeric)) - COALESCE("gif"."q", (0)::numeric)) + COALESCE("ret"."q", (0)::numeric)) + COALESCE("adj"."q", (0)::numeric)) * COALESCE("p"."retail_price", (0)::numeric)), 2) AS "valore",
    "ls"."d" AS "last_sale",
    (("shop"."codice_norm" IS NOT NULL) AND "shop"."is_active") AS "on_shopify",
    COALESCE("ret"."q", (0)::numeric) AS "resi_rientrati",
    COALESCE("adj"."q", (0)::numeric) AS "aggiustamenti"
   FROM (((((((((("public"."products" "p"
     LEFT JOIN "pur" ON (("pur"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "sho" ON (("sho"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "qro" ON (("qro"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "gif" ON (("gif"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "ret" ON (("ret"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "adj" ON (("adj"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "b2v" ON (("b2v"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "b2cv" ON (("b2cv"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "last_sale" "ls" ON (("ls"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "shop" ON (("shop"."codice_norm" = "p"."codice_norm")));


ALTER VIEW "public"."v_inventory" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ads_catalogo_modelli" AS
 SELECT COALESCE("categoria", 'ALTRO'::"text") AS "categoria",
    COALESCE("item", '(senza modello)'::"text") AS "modello",
    "count"(*) AS "prodotti",
    "count"(*) FILTER (WHERE "on_shopify") AS "su_shopify",
    "count"(*) FILTER (WHERE ("on_shopify" AND (COALESCE("disponibili_da_vendere", (0)::numeric) > (0)::numeric))) AS "live"
   FROM "public"."v_inventory"
  GROUP BY COALESCE("categoria", 'ALTRO'::"text"), COALESCE("item", '(senza modello)'::"text");


ALTER VIEW "public"."v_ads_catalogo_modelli" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ads_creative_windows" AS
 WITH "ref" AS (
         SELECT "max"("meta_ads_creative_daily"."date") AS "d"
           FROM "public"."meta_ads_creative_daily"
        )
 SELECT "d"."ad_id",
    "r"."d" AS "as_of",
    "max"("d"."ad_name") AS "ad_name",
    "max"("d"."campaign_name") AS "campaign_name",
    "sum"("d"."spend") FILTER (WHERE ("d"."date" > ("r"."d" - 7))) AS "spend_7",
    "sum"("d"."impressions") FILTER (WHERE ("d"."date" > ("r"."d" - 7))) AS "impr_7",
    "sum"("d"."clicks") FILTER (WHERE ("d"."date" > ("r"."d" - 7))) AS "clicks_7",
    "sum"("d"."link_clicks") FILTER (WHERE ("d"."date" > ("r"."d" - 7))) AS "link_clicks_7",
    "sum"("d"."purchases") FILTER (WHERE ("d"."date" > ("r"."d" - 7))) AS "purchases_7",
    "sum"("d"."purchase_value") FILTER (WHERE ("d"."date" > ("r"."d" - 7))) AS "value_7",
    "avg"("d"."frequency") FILTER (WHERE (("d"."date" > ("r"."d" - 7)) AND ("d"."spend" > (0)::numeric))) AS "freq_media_giornaliera_7",
    "sum"("d"."spend") FILTER (WHERE (("d"."date" > ("r"."d" - 14)) AND ("d"."date" <= ("r"."d" - 7)))) AS "spend_prev7",
    "sum"("d"."impressions") FILTER (WHERE (("d"."date" > ("r"."d" - 14)) AND ("d"."date" <= ("r"."d" - 7)))) AS "impr_prev7",
    "sum"("d"."clicks") FILTER (WHERE (("d"."date" > ("r"."d" - 14)) AND ("d"."date" <= ("r"."d" - 7)))) AS "clicks_prev7",
    "sum"("d"."purchases") FILTER (WHERE (("d"."date" > ("r"."d" - 14)) AND ("d"."date" <= ("r"."d" - 7)))) AS "purchases_prev7",
    "sum"("d"."purchase_value") FILTER (WHERE (("d"."date" > ("r"."d" - 14)) AND ("d"."date" <= ("r"."d" - 7)))) AS "value_prev7",
    "sum"("d"."spend") FILTER (WHERE ("d"."date" > ("r"."d" - 90))) AS "spend_90",
    "sum"("d"."impressions") FILTER (WHERE ("d"."date" > ("r"."d" - 90))) AS "impr_90",
    "sum"("d"."clicks") FILTER (WHERE ("d"."date" > ("r"."d" - 90))) AS "clicks_90",
    "sum"("d"."purchases") FILTER (WHERE ("d"."date" > ("r"."d" - 90))) AS "purchases_90",
    "sum"("d"."purchase_value") FILTER (WHERE ("d"."date" > ("r"."d" - 90))) AS "value_90",
    "count"(DISTINCT "d"."date") FILTER (WHERE (("d"."date" > ("r"."d" - 90)) AND ("d"."spend" > (0)::numeric))) AS "giorni_attivi_90",
    "max"("d"."adset_name") AS "adset_name"
   FROM ("public"."meta_ads_creative_daily" "d"
     CROSS JOIN "ref" "r")
  GROUP BY "d"."ad_id", "r"."d";


ALTER VIEW "public"."v_ads_creative_windows" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ads_set_inventory" AS
 SELECT "m"."product_set_id",
    "count"(*) AS "prodotti_nel_set",
    "count"(*) FILTER (WHERE ("i"."codice_norm" IS NOT NULL)) AS "prodotti_risolti",
    "count"(*) FILTER (WHERE (("i"."codice_norm" IS NOT NULL) AND (COALESCE("i"."disponibili_da_vendere", (0)::numeric) <= (0)::numeric))) AS "prodotti_oos",
    "count"(*) FILTER (WHERE (("i"."codice_norm" IS NOT NULL) AND ((COALESCE("i"."disponibili_da_vendere", (0)::numeric) >= (1)::numeric) AND (COALESCE("i"."disponibili_da_vendere", (0)::numeric) <= (2)::numeric)))) AS "prodotti_low_stock",
    "count"(*) FILTER (WHERE (("i"."codice_norm" IS NOT NULL) AND (COALESCE("i"."on_shopify", false) = false))) AS "prodotti_non_su_shopify",
    "round"(((100.0 * ("count"(*) FILTER (WHERE (("i"."codice_norm" IS NOT NULL) AND (COALESCE("i"."disponibili_da_vendere", (0)::numeric) <= (0)::numeric))))::numeric) / (NULLIF("count"(*) FILTER (WHERE ("i"."codice_norm" IS NOT NULL)), 0))::numeric), 1) AS "pct_oos"
   FROM ("public"."meta_product_set_map" "m"
     LEFT JOIN "public"."v_inventory" "i" ON (("i"."codice_norm" = "m"."codice_norm")))
  GROUP BY "m"."product_set_id";


ALTER VIEW "public"."v_ads_set_inventory" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ads_creative_status" AS
 WITH "x" AS (
         SELECT "w"."ad_id",
            "w"."as_of",
            COALESCE("c"."ad_name", "w"."ad_name") AS "ad_name",
            "w"."campaign_name",
            "w"."adset_name",
            "c"."campaign_id",
            "c"."adset_id",
            "c"."effective_status",
            "c"."product_set_id",
            "c"."object_type",
            "c"."thumbnail_url",
            "c"."image_url",
            "c"."frame_url",
            "c"."link",
            "w"."spend_7",
            "w"."purchases_7",
            "w"."value_7",
                CASE
                    WHEN ("w"."impr_7" > (0)::numeric) THEN "round"(((100.0 * "w"."clicks_7") / "w"."impr_7"), 2)
                    ELSE NULL::numeric
                END AS "ctr_7",
                CASE
                    WHEN ("w"."impr_prev7" > (0)::numeric) THEN "round"(((100.0 * "w"."clicks_prev7") / "w"."impr_prev7"), 2)
                    ELSE NULL::numeric
                END AS "ctr_prev7",
                CASE
                    WHEN ("w"."impr_90" > (0)::numeric) THEN "round"(((100.0 * "w"."clicks_90") / "w"."impr_90"), 2)
                    ELSE NULL::numeric
                END AS "ctr_90",
                CASE
                    WHEN ("w"."impr_7" > (0)::numeric) THEN "round"(((1000.0 * "w"."spend_7") / "w"."impr_7"), 2)
                    ELSE NULL::numeric
                END AS "cpm_7",
            "round"("w"."freq_media_giornaliera_7", 2) AS "freq_media_giornaliera_7",
            "fq"."freq_7d" AS "freq_7g",
                CASE
                    WHEN ("w"."purchases_7" > (0)::numeric) THEN "round"(("w"."spend_7" / "w"."purchases_7"), 2)
                    ELSE NULL::numeric
                END AS "cpa_7",
                CASE
                    WHEN ("w"."spend_7" > (0)::numeric) THEN "round"(("w"."value_7" / "w"."spend_7"), 2)
                    ELSE NULL::numeric
                END AS "roas_7",
            "s"."prodotti_nel_set",
            "s"."prodotti_risolti",
            "s"."prodotti_oos",
            "s"."prodotti_non_su_shopify",
            "s"."pct_oos"
           FROM ((("public"."v_ads_creative_windows" "w"
             LEFT JOIN "public"."meta_ad_creative" "c" ON (("c"."ad_id" = "w"."ad_id")))
             LEFT JOIN "public"."v_ads_set_inventory" "s" ON (("s"."product_set_id" = "c"."product_set_id")))
             LEFT JOIN "public"."meta_ad_freq7" "fq" ON (("fq"."ad_id" = "w"."ad_id")))
        )
 SELECT "ad_id",
    "as_of",
    "ad_name",
    "campaign_name",
    "adset_name",
    "campaign_id",
    "adset_id",
    "effective_status",
    "product_set_id",
    "object_type",
    "thumbnail_url",
    "image_url",
    "frame_url",
    "link",
    "spend_7",
    "purchases_7",
    "value_7",
    "ctr_7",
    "ctr_prev7",
    "ctr_90",
    "cpm_7",
    "freq_media_giornaliera_7",
    "freq_7g",
    "cpa_7",
    "roas_7",
    "prodotti_nel_set",
    "prodotti_risolti",
    "prodotti_oos",
    "prodotti_non_su_shopify",
    "pct_oos",
        CASE
            WHEN (("freq_7g" IS NOT NULL) AND ("freq_7g" >= 2.5) AND ("ctr_7" IS NOT NULL) AND ("ctr_90" IS NOT NULL) AND ("ctr_7" < "ctr_90")) THEN 'alta'::"text"
            WHEN (("freq_7g" IS NOT NULL) AND ("freq_7g" >= 1.8) AND ("ctr_7" IS NOT NULL) AND ("ctr_prev7" IS NOT NULL) AND ("ctr_7" < "ctr_prev7")) THEN 'media'::"text"
            WHEN (("freq_7g" IS NULL) AND (COALESCE("freq_media_giornaliera_7", (0)::numeric) >= 1.7) AND ("ctr_7" IS NOT NULL) AND ("ctr_90" IS NOT NULL) AND ("ctr_7" < "ctr_90")) THEN 'alta'::"text"
            WHEN (("freq_7g" IS NULL) AND (COALESCE("freq_media_giornaliera_7", (0)::numeric) >= 1.4) AND ("ctr_7" IS NOT NULL) AND ("ctr_prev7" IS NOT NULL) AND ("ctr_7" < "ctr_prev7")) THEN 'media'::"text"
            ELSE 'ok'::"text"
        END AS "stato_fatica",
        CASE
            WHEN ((COALESCE("effective_status", ''::"text") = 'ACTIVE'::"text") AND (COALESCE("prodotti_risolti", (0)::bigint) >= 3) AND ((COALESCE("prodotti_risolti", (0)::bigint))::numeric >= (0.5 * (NULLIF("prodotti_nel_set", 0))::numeric)) AND (COALESCE("pct_oos", (0)::numeric) >= (30)::numeric)) THEN (((((('set scoperto ('::"text" || COALESCE("pct_oos", (0)::numeric)) || '% OOS su '::"text") || "prodotti_risolti") || '/'::"text") || "prodotti_nel_set") || ' risolti): escludi gli OOS o rinfresca il set'::"text")
            WHEN ((COALESCE("effective_status", ''::"text") = 'ACTIVE'::"text") AND ("freq_7g" IS NOT NULL) AND ("freq_7g" >= 2.5) AND ("ctr_7" IS NOT NULL) AND ("ctr_90" IS NOT NULL) AND ("ctr_7" < "ctr_90")) THEN (('rinfresca la creativita'' (fatica: frequency 7g '::"text" || "round"("freq_7g", 1)) || ', CTR sotto la media 90g)'::"text")
            ELSE NULL::"text"
        END AS "azione_suggerita"
   FROM "x";


ALTER VIEW "public"."v_ads_creative_status" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ads_mensile" AS
 SELECT (EXTRACT(year FROM "date"))::integer AS "year",
    (EXTRACT(month FROM "date"))::integer AS "month",
    "round"("sum"(COALESCE("spend", (0)::numeric)), 2) AS "spend",
    "sum"(COALESCE("impressions", (0)::bigint)) AS "impressions",
    "sum"(COALESCE("clicks", (0)::bigint)) AS "clicks",
    "sum"(COALESCE("purchases", (0)::bigint)) AS "purchases",
    "round"("sum"(COALESCE("purchase_value", (0)::numeric)), 2) AS "purchase_value",
        CASE
            WHEN ("sum"(COALESCE("spend", (0)::numeric)) > (0)::numeric) THEN "round"(("sum"(COALESCE("purchase_value", (0)::numeric)) / "sum"(COALESCE("spend", (0)::numeric))), 2)
            ELSE (0)::numeric
        END AS "roas"
   FROM "public"."meta_ads_daily"
  GROUP BY ((EXTRACT(year FROM "date"))::integer), ((EXTRACT(month FROM "date"))::integer)
  ORDER BY ((EXTRACT(year FROM "date"))::integer), ((EXTRACT(month FROM "date"))::integer);


ALTER VIEW "public"."v_ads_mensile" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ads_periodo_14g" AS
 WITH "ref" AS (
         SELECT "max"("meta_ads_creative_daily"."date") AS "d"
           FROM "public"."meta_ads_creative_daily"
        ), "fin" AS (
         SELECT 'cur14'::"text" AS "window_key",
            ("r"."d" - 13) AS "since",
            "r"."d" AS "until",
            "r"."d" AS "as_of"
           FROM "ref" "r"
        UNION ALL
         SELECT 'prev14'::"text" AS "text",
            ("r"."d" - 27),
            ("r"."d" - 14),
            "r"."d"
           FROM "ref" "r"
        ), "righe" AS (
         SELECT "f"."window_key",
            "l"."level",
            "l"."object_id",
            "l"."campaign_id",
            "l"."adset_id",
            "d"."date",
            "d"."spend",
            "d"."impressions",
            "d"."clicks",
            "d"."link_clicks",
            "d"."landing_page_views",
            "d"."add_to_cart",
            "d"."initiate_checkout",
            "d"."purchases",
            "d"."purchase_value",
            "d"."video_3s_views",
            "d"."thruplays"
           FROM (("public"."meta_ads_creative_daily" "d"
             JOIN "fin" "f" ON ((("d"."date" >= "f"."since") AND ("d"."date" <= "f"."until"))))
             CROSS JOIN LATERAL ( VALUES ('account'::"text","d"."account_id",NULL::"text",NULL::"text"), ('campaign'::"text","d"."campaign_id","d"."campaign_id",NULL::"text"), ('adset'::"text","d"."adset_id","d"."campaign_id","d"."adset_id"), ('ad'::"text","d"."ad_id","d"."campaign_id","d"."adset_id")) "l"("level", "object_id", "campaign_id", "adset_id"))
          WHERE ("l"."object_id" IS NOT NULL)
        ), "agg" AS (
         SELECT "righe"."window_key",
            "righe"."level",
            "righe"."object_id",
            "sum"("righe"."spend") AS "spend",
            "sum"("righe"."impressions") AS "impressions",
            "sum"("righe"."clicks") AS "clicks",
            "sum"("righe"."link_clicks") AS "link_clicks",
            "sum"("righe"."landing_page_views") AS "landing_page_views",
            "sum"("righe"."add_to_cart") AS "add_to_cart",
            "sum"("righe"."initiate_checkout") AS "initiate_checkout",
            "sum"("righe"."purchases") AS "purchases",
            "sum"("righe"."purchase_value") AS "purchase_value",
            "sum"("righe"."video_3s_views") AS "video_3s_views",
            "sum"("righe"."thruplays") AS "thruplays",
            "sum"("righe"."impressions") FILTER (WHERE ("righe"."video_3s_views" IS NOT NULL)) AS "impr_video",
            "sum"("righe"."video_3s_views") FILTER (WHERE ("righe"."thruplays" IS NOT NULL)) AS "v3s_hold",
            "sum"("righe"."thruplays") FILTER (WHERE ("righe"."video_3s_views" IS NOT NULL)) AS "thru_hold",
            "count"(DISTINCT "righe"."date") FILTER (WHERE ("righe"."spend" > (0)::numeric)) AS "days_with_spend"
           FROM "righe"
          GROUP BY "righe"."window_key", "righe"."level", "righe"."object_id"
        ), "oggetti" AS (
         SELECT "righe"."level",
            "righe"."object_id",
            "max"("righe"."campaign_id") AS "campaign_id",
            "max"("righe"."adset_id") AS "adset_id"
           FROM "righe"
          GROUP BY "righe"."level", "righe"."object_id"
         HAVING ("sum"("righe"."impressions") > (0)::numeric)
        ), "nomi_camp" AS (
         SELECT DISTINCT ON ("meta_ads_creative_daily"."campaign_id") "meta_ads_creative_daily"."campaign_id",
            "meta_ads_creative_daily"."campaign_name"
           FROM "public"."meta_ads_creative_daily"
          WHERE ("meta_ads_creative_daily"."campaign_id" IS NOT NULL)
          ORDER BY "meta_ads_creative_daily"."campaign_id", "meta_ads_creative_daily"."date" DESC
        ), "nomi_adset" AS (
         SELECT DISTINCT ON ("meta_ads_creative_daily"."adset_id") "meta_ads_creative_daily"."adset_id",
            "meta_ads_creative_daily"."adset_name"
           FROM "public"."meta_ads_creative_daily"
          WHERE ("meta_ads_creative_daily"."adset_id" IS NOT NULL)
          ORDER BY "meta_ads_creative_daily"."adset_id", "meta_ads_creative_daily"."date" DESC
        ), "nomi_ad" AS (
         SELECT DISTINCT ON ("meta_ads_creative_daily"."ad_id") "meta_ads_creative_daily"."ad_id",
            "meta_ads_creative_daily"."ad_name"
           FROM "public"."meta_ads_creative_daily"
          ORDER BY "meta_ads_creative_daily"."ad_id", "meta_ads_creative_daily"."date" DESC
        ), "x" AS (
         SELECT "o"."level",
            "f"."window_key",
            "f"."since",
            "f"."until",
            "f"."as_of",
            "o"."object_id",
                CASE "o"."level"
                    WHEN 'account'::"text" THEN 'Totale account'::"text"
                    WHEN 'campaign'::"text" THEN "nc"."campaign_name"
                    WHEN 'adset'::"text" THEN "ns"."adset_name"
                    ELSE COALESCE("c"."ad_name", "na"."ad_name")
                END AS "object_name",
            "o"."campaign_id",
            "nc"."campaign_name",
            "o"."adset_id",
            "ns"."adset_name",
                CASE
                    WHEN ("o"."level" = 'ad'::"text") THEN "c"."object_type"
                    ELSE NULL::"text"
                END AS "object_type",
                CASE
                    WHEN ("o"."level" = 'ad'::"text") THEN "c"."effective_status"
                    ELSE NULL::"text"
                END AS "effective_status",
            COALESCE("a"."spend", (0)::numeric) AS "spend",
            COALESCE("a"."impressions", (0)::numeric) AS "impressions",
            "wr"."reach",
            "round"("wr"."frequency", 2) AS "frequency",
            COALESCE("a"."clicks", (0)::numeric) AS "clicks",
            COALESCE("a"."link_clicks", (0)::numeric) AS "link_clicks",
            COALESCE("a"."landing_page_views", (0)::numeric) AS "landing_page_views",
            COALESCE("a"."add_to_cart", (0)::numeric) AS "add_to_cart",
            COALESCE("a"."initiate_checkout", (0)::numeric) AS "initiate_checkout",
            COALESCE("a"."purchases", (0)::numeric) AS "purchases",
            COALESCE("a"."purchase_value", (0)::numeric) AS "purchase_value",
            "a"."video_3s_views",
            "a"."thruplays",
            "a"."impr_video",
            "a"."v3s_hold",
            "a"."thru_hold",
            COALESCE("a"."days_with_spend", (0)::bigint) AS "days_with_spend"
           FROM ((((((("oggetti" "o"
             CROSS JOIN "fin" "f")
             LEFT JOIN "agg" "a" ON ((("a"."level" = "o"."level") AND ("a"."object_id" = "o"."object_id") AND ("a"."window_key" = "f"."window_key"))))
             LEFT JOIN "nomi_camp" "nc" ON (("nc"."campaign_id" = "o"."campaign_id")))
             LEFT JOIN "nomi_adset" "ns" ON (("ns"."adset_id" = "o"."adset_id")))
             LEFT JOIN "nomi_ad" "na" ON ((("o"."level" = 'ad'::"text") AND ("na"."ad_id" = "o"."object_id"))))
             LEFT JOIN "public"."meta_ad_creative" "c" ON ((("o"."level" = 'ad'::"text") AND ("c"."ad_id" = "o"."object_id"))))
             LEFT JOIN "public"."meta_ads_window_reach" "wr" ON ((("wr"."level" = "o"."level") AND ("wr"."object_id" = "o"."object_id") AND ("wr"."window_key" = "f"."window_key") AND ("wr"."since" = "f"."since") AND ("wr"."until" = "f"."until"))))
        )
 SELECT "level",
    "window_key",
    "since",
    "until",
    "as_of",
    "object_id",
    "object_name",
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "object_type",
    "effective_status",
    "spend",
    "impressions",
    "reach",
    "frequency",
    "clicks",
    "link_clicks",
    "round"(((100.0 * "link_clicks") / NULLIF("impressions", (0)::numeric)), 2) AS "link_ctr",
    "round"(("spend" / NULLIF("link_clicks", (0)::numeric)), 2) AS "cpc_link",
    "round"(((1000.0 * "spend") / NULLIF("impressions", (0)::numeric)), 2) AS "cpm",
    "landing_page_views",
    "round"(((100.0 * "landing_page_views") / NULLIF("link_clicks", (0)::numeric)), 1) AS "lpv_rate",
    "add_to_cart",
    "round"(((100.0 * "add_to_cart") / NULLIF("landing_page_views", (0)::numeric)), 1) AS "atc_rate",
    "initiate_checkout",
    "purchases",
    "purchase_value",
    "round"(("purchase_value" / NULLIF("spend", (0)::numeric)), 2) AS "roas",
    "round"(("spend" / NULLIF("purchases", (0)::numeric)), 2) AS "cpa",
    "video_3s_views",
        CASE
            WHEN (("level" = 'ad'::"text") AND ("object_type" = 'VIDEO'::"text") AND ("impr_video" >= (500)::numeric)) THEN "round"(((100.0 * "video_3s_views") / "impr_video"), 1)
            ELSE NULL::numeric
        END AS "hook_rate",
    "thruplays",
    "round"(((100.0 * "thru_hold") / NULLIF("v3s_hold", (0)::numeric)), 1) AS "hold_rate",
    "days_with_spend"
   FROM "x";


ALTER VIEW "public"."v_ads_periodo_14g" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_ads_periodo_14g" IS 'Amimì Ads: ultimi 14 giorni (cur14) contro i 14 prima (prev14) per account, campagna, adset e ad. frequency/reach solo da meta_ads_window_reach sulla stessa finestra. Migr 0175.';



CREATE OR REPLACE VIEW "public"."v_ads_set_modelli" AS
 SELECT "m"."product_set_id",
    COALESCE("i"."categoria", 'ALTRO'::"text") AS "categoria",
    COALESCE("i"."item", '(non risolto)'::"text") AS "modello",
    "count"(*) AS "prodotti",
    "count"(*) FILTER (WHERE ("i"."on_shopify" AND (COALESCE("i"."disponibili_da_vendere", (0)::numeric) > (0)::numeric))) AS "live"
   FROM ("public"."meta_product_set_map" "m"
     LEFT JOIN "public"."v_inventory" "i" ON (("i"."codice_norm" = "m"."codice_norm")))
  GROUP BY "m"."product_set_id", COALESCE("i"."categoria", 'ALTRO'::"text"), COALESCE("i"."item", '(non risolto)'::"text");


ALTER VIEW "public"."v_ads_set_modelli" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ads_swap" AS
 WITH "ref" AS (
         SELECT "max"("meta_ads_creative_daily"."date") AS "d"
           FROM "public"."meta_ads_creative_daily"
        ), "k" AS (
         SELECT 4.0 AS "freq_rtg",
            2.5 AS "freq_cold",
            76.70 AS "pareggio",
            0.75 AS "ctr_calo",
            1000 AS "impr_min",
            300 AS "impr_consegna",
            500 AS "impr_hook",
            10 AS "quota_min",
            21 AS "giorni_base"
        ), "freq_ult" AS (
         SELECT "max"("meta_ad_freq7"."day") AS "d"
           FROM "public"."meta_ad_freq7"
        ), "elenco" AS (
         SELECT "meta_ad_creative"."ad_id"
           FROM "public"."meta_ad_creative"
          WHERE ("meta_ad_creative"."effective_status" = 'ACTIVE'::"text")
        UNION
         SELECT "d"."ad_id"
           FROM ("public"."meta_ads_creative_daily" "d"
             CROSS JOIN "ref" "r")
          WHERE (("d"."date" > ("r"."d" - 14)) AND ("d"."spend" > (0)::numeric))
        ), "primo" AS (
         SELECT "meta_ads_creative_daily"."ad_id",
            "min"("meta_ads_creative_daily"."date") FILTER (WHERE ("meta_ads_creative_daily"."spend" > (0)::numeric)) AS "first_day"
           FROM "public"."meta_ads_creative_daily"
          GROUP BY "meta_ads_creative_daily"."ad_id"
        ), "nomi_ad" AS (
         SELECT DISTINCT ON ("meta_ads_creative_daily"."ad_id") "meta_ads_creative_daily"."ad_id",
            "meta_ads_creative_daily"."ad_name",
            "meta_ads_creative_daily"."campaign_id",
            "meta_ads_creative_daily"."adset_id"
           FROM "public"."meta_ads_creative_daily"
          ORDER BY "meta_ads_creative_daily"."ad_id", "meta_ads_creative_daily"."date" DESC
        ), "nomi_camp" AS (
         SELECT DISTINCT ON ("meta_ads_creative_daily"."campaign_id") "meta_ads_creative_daily"."campaign_id",
            "meta_ads_creative_daily"."campaign_name"
           FROM "public"."meta_ads_creative_daily"
          WHERE ("meta_ads_creative_daily"."campaign_id" IS NOT NULL)
          ORDER BY "meta_ads_creative_daily"."campaign_id", "meta_ads_creative_daily"."date" DESC
        ), "nomi_adset" AS (
         SELECT DISTINCT ON ("meta_ads_creative_daily"."adset_id") "meta_ads_creative_daily"."adset_id",
            "meta_ads_creative_daily"."adset_name"
           FROM "public"."meta_ads_creative_daily"
          WHERE ("meta_ads_creative_daily"."adset_id" IS NOT NULL)
          ORDER BY "meta_ads_creative_daily"."adset_id", "meta_ads_creative_daily"."date" DESC
        ), "adset_7" AS (
         SELECT "d"."adset_id",
            "sum"("d"."spend") AS "spend_7"
           FROM ("public"."meta_ads_creative_daily" "d"
             CROSS JOIN "ref" "r")
          WHERE ("d"."date" > ("r"."d" - 7))
          GROUP BY "d"."adset_id"
        ), "m" AS (
         SELECT "e"."ad_id",
            "sum"("d"."spend") FILTER (WHERE ("d"."date" > ("r"."d" - 7))) AS "spend_7",
            "sum"("d"."impressions") FILTER (WHERE ("d"."date" > ("r"."d" - 7))) AS "impressions_7",
            "sum"("d"."link_clicks") FILTER (WHERE ("d"."date" > ("r"."d" - 7))) AS "link_clicks_7",
            "sum"("d"."video_3s_views") FILTER (WHERE ("d"."date" > ("r"."d" - 7))) AS "v3s_7",
            "sum"("d"."impressions") FILTER (WHERE (("d"."date" > ("r"."d" - 7)) AND ("d"."video_3s_views" IS NOT NULL))) AS "impr_video_7",
            "sum"("d"."spend") FILTER (WHERE ("d"."date" > ("r"."d" - 14))) AS "spend_14",
            "sum"("d"."purchases") FILTER (WHERE ("d"."date" > ("r"."d" - 14))) AS "purchases_14",
            "sum"("d"."purchase_value") FILTER (WHERE ("d"."date" > ("r"."d" - 14))) AS "value_14",
            "sum"("d"."spend") FILTER (WHERE ((("d"."date" >= "p"."first_day") AND ("d"."date" <= ("p"."first_day" + 13))) AND ("d"."date" <= ("r"."d" - 7)))) AS "spend_base",
            "sum"("d"."impressions") FILTER (WHERE ((("d"."date" >= "p"."first_day") AND ("d"."date" <= ("p"."first_day" + 13))) AND ("d"."date" <= ("r"."d" - 7)))) AS "impressions_base",
            "sum"("d"."link_clicks") FILTER (WHERE ((("d"."date" >= "p"."first_day") AND ("d"."date" <= ("p"."first_day" + 13))) AND ("d"."date" <= ("r"."d" - 7)))) AS "link_clicks_base",
            "sum"("d"."video_3s_views") FILTER (WHERE ((("d"."date" >= "p"."first_day") AND ("d"."date" <= ("p"."first_day" + 13))) AND ("d"."date" <= ("r"."d" - 7)))) AS "v3s_base",
            "sum"("d"."impressions") FILTER (WHERE ((("d"."date" >= "p"."first_day") AND ("d"."date" <= ("p"."first_day" + 13))) AND ("d"."date" <= ("r"."d" - 7)) AND ("d"."video_3s_views" IS NOT NULL))) AS "impr_video_base"
           FROM ((("elenco" "e"
             CROSS JOIN "ref" "r")
             LEFT JOIN "primo" "p" ON (("p"."ad_id" = "e"."ad_id")))
             LEFT JOIN "public"."meta_ads_creative_daily" "d" ON (("d"."ad_id" = "e"."ad_id")))
          GROUP BY "e"."ad_id"
        ), "x" AS (
         SELECT "r"."d" AS "as_of",
            "e"."ad_id",
            COALESCE("c"."ad_name", "na"."ad_name") AS "ad_name",
            COALESCE("c"."campaign_id", "na"."campaign_id") AS "campaign_id",
            "nc"."campaign_name",
            COALESCE("c"."adset_id", "na"."adset_id") AS "adset_id",
            "ns"."adset_name",
            "c"."effective_status",
            "c"."object_type",
            "c"."frame_url",
            "c"."image_url",
            "c"."thumbnail_url",
            "p"."first_day",
            (("r"."d" - "p"."first_day") + 1) AS "giorni_live",
            COALESCE("m"."spend_7", (0)::numeric) AS "spend_7",
            COALESCE("m"."impressions_7", (0)::numeric) AS "impressions_7",
            "round"(((100.0 * "m"."link_clicks_7") / NULLIF("m"."impressions_7", (0)::numeric)), 2) AS "link_ctr_7",
            "round"(((100.0 * "m"."link_clicks_base") / NULLIF("m"."impressions_base", (0)::numeric)), 2) AS "link_ctr_base",
            COALESCE("m"."impressions_base", (0)::numeric) AS "impressions_base",
            "round"(((1000.0 * "m"."spend_7") / NULLIF("m"."impressions_7", (0)::numeric)), 2) AS "cpm_7",
            "round"(((1000.0 * "m"."spend_base") / NULLIF("m"."impressions_base", (0)::numeric)), 2) AS "cpm_base",
            "round"("fq"."freq_7d", 2) AS "freq_7g",
            ((COALESCE("c"."effective_status", ''::"text") = 'ACTIVE'::"text") AND (COALESCE("m"."impressions_7", (0)::numeric) >= ("k_1"."impr_consegna")::numeric) AND ("fq"."freq_7d" IS NULL)) AS "freq_mancante",
            "fu"."d" AS "freq_al",
            COALESCE("m"."spend_14", (0)::numeric) AS "spend_14",
            COALESCE("m"."purchases_14", (0)::numeric) AS "purchases_14",
            COALESCE("m"."value_14", (0)::numeric) AS "value_14",
            "round"(("m"."spend_14" / NULLIF("m"."purchases_14", (0)::numeric)), 2) AS "cpa_14",
            "round"(("m"."value_14" / NULLIF("m"."spend_14", (0)::numeric)), 2) AS "roas_14",
                CASE
                    WHEN (("c"."object_type" = 'VIDEO'::"text") AND ("m"."impr_video_7" >= ("k_1"."impr_hook")::numeric)) THEN "round"(((100.0 * "m"."v3s_7") / "m"."impr_video_7"), 1)
                    ELSE NULL::numeric
                END AS "hook_7",
                CASE
                    WHEN (("c"."object_type" = 'VIDEO'::"text") AND ("m"."impr_video_base" >= ("k_1"."impr_hook")::numeric)) THEN "round"(((100.0 * "m"."v3s_base") / "m"."impr_video_base"), 1)
                    ELSE NULL::numeric
                END AS "hook_base",
            "round"(((100.0 * COALESCE("m"."spend_7", (0)::numeric)) / NULLIF("a7"."spend_7", (0)::numeric)), 1) AS "quota_adset_7",
            "s"."pct_oos",
                CASE
                    WHEN ((COALESCE("nc"."campaign_name", ''::"text") ~* '(super hot|\mhot\M|warm|rtg|retarget|remarketing|re-?eng)'::"text") OR (COALESCE("ns"."adset_name", ''::"text") ~* '(super hot|\mhot\M|warm|rtg|retarget|remarketing|re-?eng)'::"text")) THEN 'retargeting'::"text"
                    ELSE 'cold'::"text"
                END AS "pubblico"
           FROM (((((((((((("elenco" "e"
             CROSS JOIN "ref" "r")
             CROSS JOIN "k" "k_1")
             CROSS JOIN "freq_ult" "fu")
             JOIN "m" ON (("m"."ad_id" = "e"."ad_id")))
             LEFT JOIN "primo" "p" ON (("p"."ad_id" = "e"."ad_id")))
             LEFT JOIN "public"."meta_ad_creative" "c" ON (("c"."ad_id" = "e"."ad_id")))
             LEFT JOIN "nomi_ad" "na" ON (("na"."ad_id" = "e"."ad_id")))
             LEFT JOIN "nomi_camp" "nc" ON (("nc"."campaign_id" = COALESCE("c"."campaign_id", "na"."campaign_id"))))
             LEFT JOIN "nomi_adset" "ns" ON (("ns"."adset_id" = COALESCE("c"."adset_id", "na"."adset_id"))))
             LEFT JOIN "adset_7" "a7" ON (("a7"."adset_id" = COALESCE("c"."adset_id", "na"."adset_id"))))
             LEFT JOIN "public"."meta_ad_freq7" "fq" ON ((("fq"."ad_id" = "e"."ad_id") AND ("fq"."day" = "r"."d"))))
             LEFT JOIN "public"."v_ads_set_inventory" "s" ON (("s"."product_set_id" = "c"."product_set_id")))
        ), "y" AS (
         SELECT "x"."as_of",
            "x"."ad_id",
            "x"."ad_name",
            "x"."campaign_id",
            "x"."campaign_name",
            "x"."adset_id",
            "x"."adset_name",
            "x"."effective_status",
            "x"."object_type",
            "x"."frame_url",
            "x"."image_url",
            "x"."thumbnail_url",
            "x"."first_day",
            "x"."giorni_live",
            "x"."spend_7",
            "x"."impressions_7",
            "x"."link_ctr_7",
            "x"."link_ctr_base",
            "x"."impressions_base",
            "x"."cpm_7",
            "x"."cpm_base",
            "x"."freq_7g",
            "x"."freq_mancante",
            "x"."freq_al",
            "x"."spend_14",
            "x"."purchases_14",
            "x"."value_14",
            "x"."cpa_14",
            "x"."roas_14",
            "x"."hook_7",
            "x"."hook_base",
            "x"."quota_adset_7",
            "x"."pct_oos",
            "x"."pubblico",
                CASE
                    WHEN ("x"."pubblico" = 'retargeting'::"text") THEN "k_1"."freq_rtg"
                    ELSE "k_1"."freq_cold"
                END AS "freq_soglia",
            "round"((100.0 * (("x"."link_ctr_7" / NULLIF("x"."link_ctr_base", (0)::numeric)) - (1)::numeric))) AS "ctr_var_pct",
            "round"((100.0 * (("x"."cpm_7" / NULLIF("x"."cpm_base", (0)::numeric)) - (1)::numeric))) AS "cpm_var_pct"
           FROM ("x"
             CROSS JOIN "k" "k_1")
        ), "z" AS (
         SELECT "y"."as_of",
            "y"."ad_id",
            "y"."ad_name",
            "y"."campaign_id",
            "y"."campaign_name",
            "y"."adset_id",
            "y"."adset_name",
            "y"."effective_status",
            "y"."object_type",
            "y"."frame_url",
            "y"."image_url",
            "y"."thumbnail_url",
            "y"."first_day",
            "y"."giorni_live",
            "y"."spend_7",
            "y"."impressions_7",
            "y"."link_ctr_7",
            "y"."link_ctr_base",
            "y"."impressions_base",
            "y"."cpm_7",
            "y"."cpm_base",
            "y"."freq_7g",
            "y"."freq_mancante",
            "y"."freq_al",
            "y"."spend_14",
            "y"."purchases_14",
            "y"."value_14",
            "y"."cpa_14",
            "y"."roas_14",
            "y"."hook_7",
            "y"."hook_base",
            "y"."quota_adset_7",
            "y"."pct_oos",
            "y"."pubblico",
            "y"."freq_soglia",
            "y"."ctr_var_pct",
            "y"."cpm_var_pct",
            COALESCE(("y"."freq_7g" >= "y"."freq_soglia"), false) AS "segnale_freq",
            COALESCE((("y"."impressions_7" >= ("k_1"."impr_min")::numeric) AND ("y"."impressions_base" >= ("k_1"."impr_min")::numeric) AND ("y"."link_ctr_base" > (0)::numeric) AND ("y"."link_ctr_7" <= ("k_1"."ctr_calo" * "y"."link_ctr_base"))), false) AS "segnale_ctr",
            (("y"."spend_14" >= "k_1"."pareggio") AND ("y"."purchases_14" = (0)::numeric)) AS "segnale_spesa"
           FROM ("y"
             CROSS JOIN "k" "k_1")
        ), "w" AS (
         SELECT "z"."as_of",
            "z"."ad_id",
            "z"."ad_name",
            "z"."campaign_id",
            "z"."campaign_name",
            "z"."adset_id",
            "z"."adset_name",
            "z"."effective_status",
            "z"."object_type",
            "z"."frame_url",
            "z"."image_url",
            "z"."thumbnail_url",
            "z"."first_day",
            "z"."giorni_live",
            "z"."spend_7",
            "z"."impressions_7",
            "z"."link_ctr_7",
            "z"."link_ctr_base",
            "z"."impressions_base",
            "z"."cpm_7",
            "z"."cpm_base",
            "z"."freq_7g",
            "z"."freq_mancante",
            "z"."freq_al",
            "z"."spend_14",
            "z"."purchases_14",
            "z"."value_14",
            "z"."cpa_14",
            "z"."roas_14",
            "z"."hook_7",
            "z"."hook_base",
            "z"."quota_adset_7",
            "z"."pct_oos",
            "z"."pubblico",
            "z"."freq_soglia",
            "z"."ctr_var_pct",
            "z"."cpm_var_pct",
            "z"."segnale_freq",
            "z"."segnale_ctr",
            "z"."segnale_spesa",
                CASE
                    WHEN (COALESCE("z"."effective_status", ''::"text") <> 'ACTIVE'::"text") THEN 'in_pausa'::"text"
                    WHEN ("z"."segnale_spesa" OR ("z"."segnale_freq" AND "z"."segnale_ctr")) THEN 'cambia'::"text"
                    WHEN ("z"."segnale_freq" OR "z"."segnale_ctr") THEN 'osserva'::"text"
                    WHEN ("z"."impressions_7" < ("k_1"."impr_consegna")::numeric) THEN 'senza_consegna'::"text"
                    WHEN (("z"."impressions_base" < ("k_1"."impr_min")::numeric) AND (COALESCE("z"."giorni_live", 0) < "k_1"."giorni_base")) THEN 'nuova'::"text"
                    ELSE 'ok'::"text"
                END AS "stato"
           FROM ("z"
             CROSS JOIN "k" "k_1")
        )
 SELECT "w"."as_of",
    "w"."ad_id",
    "w"."ad_name",
    "w"."campaign_id",
    "w"."campaign_name",
    "w"."adset_id",
    "w"."adset_name",
    "w"."effective_status",
    "w"."object_type",
    "w"."frame_url",
    "w"."image_url",
    "w"."thumbnail_url",
    "w"."pubblico",
    "w"."first_day",
    "w"."giorni_live",
    "w"."spend_7",
    "w"."impressions_7",
    "w"."link_ctr_7",
    "w"."link_ctr_base",
    "w"."impressions_base",
    "w"."ctr_var_pct",
    "w"."cpm_7",
    "w"."cpm_base",
    "w"."cpm_var_pct",
    "w"."freq_7g",
    "w"."freq_soglia",
    "w"."spend_14",
    "w"."purchases_14",
    "w"."value_14",
    "w"."cpa_14",
    "w"."roas_14",
    "w"."hook_7",
    "w"."hook_base",
    "w"."quota_adset_7",
    "w"."pct_oos",
    "w"."segnale_freq",
    "w"."segnale_ctr",
    "w"."segnale_spesa",
    "w"."stato",
    ((
        CASE "w"."stato"
            WHEN 'in_pausa'::"text" THEN (('non attiva su Meta ('::"text" || COALESCE("w"."effective_status", 'stato sconosciuto'::"text")) || ')'::"text")
            WHEN 'senza_consegna'::"text" THEN (('Meta non la consegna ('::"text" || "w"."impressions_7") || ' impression in 7 giorni)'::"text")
            WHEN 'nuova'::"text" THEN (((('base di confronto non ancora completa ('::"text" || "w"."impressions_base") || ' impression nei primi 14 giorni, live da '::"text") || COALESCE("w"."giorni_live", 0)) || ' giorni)'::"text")
            WHEN 'ok'::"text" THEN (
            CASE
                WHEN "w"."freq_mancante" THEN 'nessun segnale di fatica misurato'::"text"
                ELSE 'nessun segnale di fatica'::"text"
            END ||
            CASE
                WHEN (("w"."impressions_7" < ("k"."impr_min")::numeric) OR ("w"."impressions_base" < ("k"."impr_min")::numeric) OR (COALESCE("w"."link_ctr_base", (0)::numeric) = (0)::numeric)) THEN (('; CTR non confrontabile ('::"text" || "concat_ws"(', '::"text",
                CASE
                    WHEN ("w"."impressions_7" < ("k"."impr_min")::numeric) THEN ("w"."impressions_7" || ' impression in 7 giorni'::"text")
                    ELSE NULL::"text"
                END,
                CASE
                    WHEN ("w"."impressions_base" < ("k"."impr_min")::numeric) THEN ("w"."impressions_base" || ' impression nei primi 14 giorni'::"text")
                    ELSE NULL::"text"
                END,
                CASE
                    WHEN (("w"."impressions_base" >= ("k"."impr_min")::numeric) AND (COALESCE("w"."link_ctr_base", (0)::numeric) = (0)::numeric)) THEN 'nessun click sul link nei primi 14 giorni'::"text"
                    ELSE NULL::"text"
                END)) || ')'::"text")
                ELSE ''::"text"
            END)
            ELSE "concat_ws"('; '::"text",
            CASE
                WHEN "w"."segnale_spesa" THEN (('speso '::"text" || "round"("w"."spend_14")) || ' EUR in 14 giorni senza acquisti'::"text")
                ELSE NULL::"text"
            END,
            CASE
                WHEN "w"."segnale_freq" THEN ((('frequency 7g '::"text" || "replace"(("trim_scale"("w"."freq_7g"))::"text", '.'::"text", ','::"text")) || ' sopra '::"text") || "replace"(("trim_scale"("w"."freq_soglia"))::"text", '.'::"text", ','::"text"))
                ELSE NULL::"text"
            END,
            CASE
                WHEN "w"."segnale_ctr" THEN (('CTR link '::"text" || "w"."ctr_var_pct") || '% rispetto ai primi 14 giorni'::"text")
                ELSE NULL::"text"
            END)
        END ||
        CASE
            WHEN (("w"."quota_adset_7" < ("k"."quota_min")::numeric) AND ("w"."stato" = ANY (ARRAY['nuova'::"text", 'ok'::"text", 'osserva'::"text"]))) THEN (('; riceve il '::"text" || "replace"(("trim_scale"("w"."quota_adset_7"))::"text", '.'::"text", ','::"text")) || '% della spesa del suo adset'::"text")
            ELSE ''::"text"
        END) ||
        CASE
            WHEN "w"."freq_mancante" THEN (('; frequency 7g non letta per il '::"text" || "to_char"(("w"."as_of")::timestamp with time zone, 'DD-MM'::"text")) || ': segnale non valutato'::"text")
            ELSE ''::"text"
        END) AS "motivo",
        CASE "w"."stato"
            WHEN 'cambia'::"text" THEN 1
            WHEN 'osserva'::"text" THEN 2
            WHEN 'nuova'::"text" THEN 3
            WHEN 'ok'::"text" THEN 4
            WHEN 'senza_consegna'::"text" THEN 5
            ELSE 6
        END AS "ordine",
    "w"."freq_mancante",
    "w"."freq_al"
   FROM ("w"
     CROSS JOIN "k");


ALTER VIEW "public"."v_ads_swap" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_ads_swap" IS 'Amimì Ads: una riga per ad ACTIVE o con spesa negli ultimi 14 giorni, con i segnali di fatica (frequency 7g, CTR link contro i primi 14 giorni, spesa senza acquisti) e lo stato cambia/osserva/nuova/ok/senza_consegna/in_pausa. freq_mancante = frequency 7g non letta per as_of (segnale non valutato), freq_al = ultimo giorno letto. Regola dell''owner del 28-10-2026, migr 0175.';



CREATE OR REPLACE VIEW "public"."v_ads_weekly_account" AS
 WITH "wk" AS (
         SELECT ("date_trunc"('week'::"text", ("meta_ads_creative_daily"."date")::timestamp with time zone))::"date" AS "settimana",
            "sum"("meta_ads_creative_daily"."spend") AS "spend",
            "sum"("meta_ads_creative_daily"."purchases") AS "purchases",
            "sum"("meta_ads_creative_daily"."purchase_value") AS "value",
            "sum"("meta_ads_creative_daily"."impressions") AS "impr",
            "sum"("meta_ads_creative_daily"."clicks") AS "clicks"
           FROM "public"."meta_ads_creative_daily"
          GROUP BY (("date_trunc"('week'::"text", ("meta_ads_creative_daily"."date")::timestamp with time zone))::"date")
        )
 SELECT "settimana",
    "spend",
    "purchases",
    "value",
        CASE
            WHEN ("purchases" > (0)::numeric) THEN "round"(("spend" / "purchases"), 2)
            ELSE NULL::numeric
        END AS "cpa",
        CASE
            WHEN ("spend" > (0)::numeric) THEN "round"(("value" / "spend"), 2)
            ELSE NULL::numeric
        END AS "roas",
    "round"(("spend" - "lag"("spend") OVER (ORDER BY "settimana")), 2) AS "spend_wow",
    ("purchases" - "lag"("purchases") OVER (ORDER BY "settimana")) AS "purchases_wow"
   FROM "wk"
  ORDER BY "settimana" DESC;


ALTER VIEW "public"."v_ads_weekly_account" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_amimi" AS
 SELECT "year",
    "month",
    "online_lordo",
    "online_netto",
    "online_pezzi",
    "offline_lordo",
    "offline_netto",
    "offline_pezzi",
    "b2b_lordo",
    "b2b_netto",
    "b2b_pezzi",
    "omni_netto",
    "cogs",
    "packaging",
    "commissioni",
    "logistica_var",
    "resi",
    "salari",
    "tasse",
    "logistica_mag",
    "opex",
    "eventi",
    "marketing",
    GREATEST(("omni_netto" + "resi"), (0)::numeric) AS "base_compenso_soci",
    ((- "public"."ce_aliquota_compensi"("year", "month")) * GREATEST(("omni_netto" + "resi"), (0)::numeric)) AS "compenso_soci"
   FROM ( WITH "periods" AS (
                 SELECT DISTINCT "u"."year",
                    "u"."month"
                   FROM ( SELECT "shopify_orders"."year",
                            "shopify_orders"."month"
                           FROM "public"."shopify_orders"
                          WHERE ("shopify_orders"."year" IS NOT NULL)
                        UNION ALL
                         SELECT "qromo_sales"."year",
                            "qromo_sales"."month"
                           FROM "public"."qromo_sales"
                          WHERE ("qromo_sales"."year" IS NOT NULL)
                        UNION ALL
                         SELECT "b2b_movements"."year",
                            "b2b_movements"."month"
                           FROM "public"."b2b_movements"
                          WHERE ("b2b_movements"."year" IS NOT NULL)
                        UNION ALL
                         SELECT "expenses"."year",
                            "expenses"."month"
                           FROM "public"."expenses"
                          WHERE ("expenses"."year" IS NOT NULL)
                        UNION ALL
                         SELECT "returns"."year",
                            "returns"."month"
                           FROM "public"."returns"
                          WHERE ("returns"."year" IS NOT NULL)) "u"
                  WHERE (("u"."month" >= 1) AND ("u"."month" <= 12))
                ), "so" AS (
                 SELECT "shopify_orders"."year",
                    "shopify_orders"."month",
                    "count"(*) AS "ordini",
                    COALESCE("sum"("shopify_orders"."discount_total"), (0)::numeric) AS "disc",
                    COALESCE("sum"("shopify_orders"."free_shipping_amt"), (0)::numeric) AS "freeship",
                    COALESCE("sum"("shopify_orders"."shipping_total"), (0)::numeric) AS "sped",
                    COALESCE("sum"("shopify_orders"."payment_fees"), (0)::numeric) AS "commissioni",
                    COALESCE("sum"("shopify_orders"."refund_amount"), (0)::numeric) AS "refund"
                   FROM "public"."shopify_orders"
                  GROUP BY "shopify_orders"."year", "shopify_orders"."month"
                ), "sl" AS (
                 SELECT "shopify_line_items"."year",
                    "shopify_line_items"."month",
                    COALESCE("sum"("shopify_line_items"."quantita"), (0)::numeric) AS "pezzi",
                    COALESCE("sum"(("shopify_line_items"."price" * "shopify_line_items"."quantita")), (0)::numeric) AS "vendite",
                    COALESCE("sum"(("shopify_line_items"."cogs_snapshot" * "shopify_line_items"."quantita")), (0)::numeric) AS "cogs"
                   FROM "public"."shopify_line_items" WHERE ("shopify_line_items"."codice_norm" IS DISTINCT FROM 'GIFT_CARD'::"text")
                  GROUP BY "shopify_line_items"."year", "shopify_line_items"."month"
                ), "qr" AS (
                 SELECT "qromo_sales"."year",
                    "qromo_sales"."month",
                    COALESCE("sum"("qromo_sales"."quantita"), (0)::numeric) AS "pezzi",
                    COALESCE("sum"("qromo_sales"."prezzo"), (0)::numeric) AS "lordo",
                    COALESCE("sum"(("qromo_sales"."cogs" * "qromo_sales"."quantita")), (0)::numeric) AS "cogs"
                   FROM "public"."qromo_sales"
                  GROUP BY "qromo_sales"."year", "qromo_sales"."month"
                ), "b2" AS (
                 SELECT "b2b_movements"."year",
                    "b2b_movements"."month",
                    COALESCE("sum"("b2b_movements"."quantita") FILTER (WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")))), (0)::numeric) AS "pezzi",
                    COALESCE("sum"("b2b_movements"."incasso_amimi") FILTER (WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")))), (0)::numeric) AS "lordo",
                    COALESCE("sum"("b2b_movements"."cogs") FILTER (WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")))), (0)::numeric) AS "cogs"
                   FROM "public"."b2b_movements"
                  GROUP BY "b2b_movements"."year", "b2b_movements"."month"
                ), "ex" AS (
                 SELECT "expenses"."year",
                    "expenses"."month",
                    COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'SALARI'::"text")), (0)::numeric) AS "salari",
                    COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'TASSE'::"text")), (0)::numeric) AS "tasse",
                    COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'OPEX'::"text")), (0)::numeric) AS "opex",
                    COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'EVENTI'::"text")), (0)::numeric) AS "eventi",
                    COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'MARKETING'::"text")), (0)::numeric) AS "marketing",
                    COALESCE("sum"("expenses"."costo") FILTER (WHERE (("expenses"."categoria" = 'LOGISTICA'::"text") AND ("expenses"."sottocategoria" ~~* 'sped%'::"text"))), (0)::numeric) AS "logistica_var",
                    COALESCE("sum"("expenses"."costo") FILTER (WHERE (("expenses"."categoria" = 'LOGISTICA'::"text") AND (("expenses"."sottocategoria" IS NULL) OR ("expenses"."sottocategoria" !~~* 'sped%'::"text")))), (0)::numeric) AS "logistica_mag"
                   FROM "public"."expenses"
                  WHERE ("expenses"."amimi" AND ("expenses"."status" = 'approved'::"text"))
                  GROUP BY "expenses"."year", "expenses"."month"
                ), "qret" AS (
                 SELECT "returns"."year",
                    "returns"."month",
                    COALESCE("sum"("returns"."importo_rimborsato"), (0)::numeric) AS "imp"
                   FROM "public"."returns"
                  WHERE ("returns"."canale" = 'qromo'::"text")
                  GROUP BY "returns"."year", "returns"."month"
                )
         SELECT "p"."year",
            "p"."month",
            (((COALESCE("sl"."vendite", (0)::numeric) - COALESCE("so"."disc", (0)::numeric)) + COALESCE("so"."freeship", (0)::numeric)) + COALESCE("so"."sped", (0)::numeric)) AS "online_lordo",
            ((((COALESCE("sl"."vendite", (0)::numeric) - COALESCE("so"."disc", (0)::numeric)) + COALESCE("so"."freeship", (0)::numeric)) + COALESCE("so"."sped", (0)::numeric)) / 1.22) AS "online_netto",
            COALESCE("sl"."pezzi", (0)::numeric) AS "online_pezzi",
            COALESCE("qr"."lordo", (0)::numeric) AS "offline_lordo",
            (COALESCE("qr"."lordo", (0)::numeric) / 1.22) AS "offline_netto",
            COALESCE("qr"."pezzi", (0)::numeric) AS "offline_pezzi",
            COALESCE("b2"."lordo", (0)::numeric) AS "b2b_lordo",
            (COALESCE("b2"."lordo", (0)::numeric) / 1.22) AS "b2b_netto",
            COALESCE("b2"."pezzi", (0)::numeric) AS "b2b_pezzi",
            ((((((COALESCE("sl"."vendite", (0)::numeric) - COALESCE("so"."disc", (0)::numeric)) + COALESCE("so"."freeship", (0)::numeric)) + COALESCE("so"."sped", (0)::numeric)) / 1.22) + (COALESCE("qr"."lordo", (0)::numeric) / 1.22)) + (COALESCE("b2"."lordo", (0)::numeric) / 1.22)) AS "omni_netto",
            (- ((COALESCE("sl"."cogs", (0)::numeric) + COALESCE("qr"."cogs", (0)::numeric)) + COALESCE("b2"."cogs", (0)::numeric))) AS "cogs",
            (- ((3.71 * (COALESCE("sl"."pezzi", (0)::numeric) + COALESCE("qr"."pezzi", (0)::numeric))) + (COALESCE("so"."ordini", (0)::bigint))::numeric)) AS "packaging",
            COALESCE("so"."commissioni", (0)::numeric) AS "commissioni",
            COALESCE("ex"."logistica_var", (0)::numeric) AS "logistica_var",
            ((- (COALESCE("so"."refund", (0)::numeric) + COALESCE("qret"."imp", (0)::numeric))) / 1.22) AS "resi",
            COALESCE("ex"."salari", (0)::numeric) AS "salari",
            COALESCE("ex"."tasse", (0)::numeric) AS "tasse",
            COALESCE("ex"."logistica_mag", (0)::numeric) AS "logistica_mag",
            COALESCE("ex"."opex", (0)::numeric) AS "opex",
            COALESCE("ex"."eventi", (0)::numeric) AS "eventi",
            COALESCE("ex"."marketing", (0)::numeric) AS "marketing"
           FROM (((((("periods" "p"
             LEFT JOIN "so" ON ((("so"."year" = "p"."year") AND ("so"."month" = "p"."month"))))
             LEFT JOIN "sl" ON ((("sl"."year" = "p"."year") AND ("sl"."month" = "p"."month"))))
             LEFT JOIN "qr" ON ((("qr"."year" = "p"."year") AND ("qr"."month" = "p"."month"))))
             LEFT JOIN "b2" ON ((("b2"."year" = "p"."year") AND ("b2"."month" = "p"."month"))))
             LEFT JOIN "ex" ON ((("ex"."year" = "p"."year") AND ("ex"."month" = "p"."month"))))
             LEFT JOIN "qret" ON ((("qret"."year" = "p"."year") AND ("qret"."month" = "p"."month"))))) "x";


ALTER VIEW "public"."v_ce_amimi" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_amimi_summary" AS
 SELECT "year",
    "month",
    "online_lordo",
    "online_netto",
    "online_pezzi",
    "offline_lordo",
    "offline_netto",
    "offline_pezzi",
    "b2b_lordo",
    "b2b_netto",
    "b2b_pezzi",
    "omni_netto",
    "cogs",
    "packaging",
    "commissioni",
    "logistica_var",
    "resi",
    "salari",
    "tasse",
    "logistica_mag",
    "opex",
    "eventi",
    "marketing",
    (((((("omni_netto" + "cogs") + "packaging") + "commissioni") + "logistica_var") + "resi") + "compenso_soci") AS "mc1",
    (((((((((((("omni_netto" + "cogs") + "packaging") + "commissioni") + "logistica_var") + "resi") + "compenso_soci") + "salari") + "tasse") + "logistica_mag") + "opex") + "eventi") + "marketing") AS "mc2",
    "base_compenso_soci",
    "compenso_soci"
   FROM "public"."v_ce_amimi";


ALTER VIEW "public"."v_ce_amimi_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_totale" AS
 SELECT "t"."year",
    "t"."month",
    "t"."online_lordo",
    "t"."online_netto",
    "t"."online_pezzi",
    "t"."offline_lordo",
    "t"."offline_netto",
    "t"."offline_pezzi",
    "t"."b2b_lordo",
    "t"."b2b_netto",
    "t"."b2b_pezzi",
    "t"."omni_netto",
    "t"."cogs",
    "t"."packaging",
    "t"."commissioni",
    "t"."logistica_var",
    "t"."resi",
    "t"."salari",
    "t"."tasse",
    "t"."logistica_mag",
    "t"."opex",
    "t"."eventi",
    "t"."marketing",
    ("t"."mc1" + "c"."compenso_soci") AS "mc1",
    ("t"."mc2" + "c"."compenso_soci") AS "mc2",
    "c"."base_compenso_soci",
    "c"."compenso_soci"
   FROM (( SELECT "f"."year",
            "f"."month",
            "f"."online_lordo",
            "f"."online_netto",
            "f"."online_pezzi",
            "f"."offline_lordo",
            "f"."offline_netto",
            "f"."offline_pezzi",
            "f"."b2b_lordo",
            "f"."b2b_netto",
            "f"."b2b_pezzi",
            "f"."omni_netto",
            "f"."cogs",
            "f"."packaging",
            "f"."commissioni",
            "f"."logistica_var",
            "f"."resi",
            "f"."salari",
            "f"."tasse",
            "f"."logistica_mag",
            "f"."opex",
            "f"."eventi",
            "f"."marketing",
            ((((("f"."omni_netto" + "f"."cogs") + "f"."packaging") + "f"."commissioni") + "f"."logistica_var") + "f"."resi") AS "mc1",
            ((((((((((("f"."omni_netto" + "f"."cogs") + "f"."packaging") + "f"."commissioni") + "f"."logistica_var") + "f"."resi") + "f"."salari") + "f"."tasse") + "f"."logistica_mag") + "f"."opex") + "f"."eventi") + "f"."marketing") AS "mc2"
           FROM ( WITH "periods" AS (
                         SELECT DISTINCT "u"."year",
                            "u"."month"
                           FROM ( SELECT "shopify_orders"."year",
                                    "shopify_orders"."month"
                                   FROM "public"."shopify_orders"
                                  WHERE ("shopify_orders"."year" IS NOT NULL)
                                UNION ALL
                                 SELECT "qromo_sales"."year",
                                    "qromo_sales"."month"
                                   FROM "public"."qromo_sales"
                                  WHERE ("qromo_sales"."year" IS NOT NULL)
                                UNION ALL
                                 SELECT "gifts_offline"."year",
                                    "gifts_offline"."month"
                                   FROM "public"."gifts_offline"
                                  WHERE ("gifts_offline"."year" IS NOT NULL)
                                UNION ALL
                                 SELECT "b2b_movements"."year",
                                    "b2b_movements"."month"
                                   FROM "public"."b2b_movements"
                                  WHERE ("b2b_movements"."year" IS NOT NULL)
                                UNION ALL
                                 SELECT "expenses"."year",
                                    "expenses"."month"
                                   FROM "public"."expenses"
                                  WHERE ("expenses"."year" IS NOT NULL)
                                UNION ALL
                                 SELECT "ce_totale_manual"."year",
                                    "ce_totale_manual"."month"
                                   FROM "public"."ce_totale_manual"
                                  WHERE ("ce_totale_manual"."year" IS NOT NULL)) "u"
                          WHERE (("u"."month" >= 1) AND ("u"."month" <= 12))
                        ), "so" AS (
                         SELECT "shopify_orders"."year",
                            "shopify_orders"."month",
                            "count"(*) AS "ordini",
                            COALESCE("sum"("shopify_orders"."discount_total"), (0)::numeric) AS "disc",
                            COALESCE("sum"("shopify_orders"."free_shipping_amt"), (0)::numeric) AS "freeship",
                            COALESCE("sum"("shopify_orders"."shipping_total"), (0)::numeric) AS "sped",
                            COALESCE("sum"("shopify_orders"."payment_fees"), (0)::numeric) AS "commissioni",
                            COALESCE("sum"("shopify_orders"."refund_amount"), (0)::numeric) AS "refund"
                           FROM "public"."shopify_orders"
                          GROUP BY "shopify_orders"."year", "shopify_orders"."month"
                        ), "sl" AS (
                         SELECT "shopify_line_items"."year",
                            "shopify_line_items"."month",
                            COALESCE("sum"("shopify_line_items"."quantita"), (0)::numeric) AS "pezzi",
                            COALESCE("sum"(("shopify_line_items"."price" * "shopify_line_items"."quantita")), (0)::numeric) AS "vendite",
                            COALESCE("sum"(("shopify_line_items"."cogs_snapshot" * "shopify_line_items"."quantita")), (0)::numeric) AS "cogs"
                           FROM "public"."shopify_line_items" WHERE ("shopify_line_items"."codice_norm" IS DISTINCT FROM 'GIFT_CARD'::"text")
                          GROUP BY "shopify_line_items"."year", "shopify_line_items"."month"
                        ), "qr" AS (
                         SELECT "qromo_sales"."year",
                            "qromo_sales"."month",
                            COALESCE("sum"("qromo_sales"."quantita"), (0)::numeric) AS "pezzi",
                            COALESCE("sum"("qromo_sales"."prezzo"), (0)::numeric) AS "lordo",
                            COALESCE("sum"(("qromo_sales"."cogs" * "qromo_sales"."quantita")), (0)::numeric) AS "cogs"
                           FROM "public"."qromo_sales"
                          GROUP BY "qromo_sales"."year", "qromo_sales"."month"
                        ), "gf" AS (
                         SELECT "gifts_offline"."year",
                            "gifts_offline"."month",
                            COALESCE("sum"("gifts_offline"."quantita"), (0)::numeric) AS "pezzi",
                            COALESCE("sum"("gifts_offline"."prezzo"), (0)::numeric) AS "lordo",
                            COALESCE("sum"("gifts_offline"."cogs"), (0)::numeric) AS "cogs"
                           FROM "public"."gifts_offline"
                          GROUP BY "gifts_offline"."year", "gifts_offline"."month"
                        ), "b2" AS (
                         SELECT "b2b_movements"."year",
                            "b2b_movements"."month",
                            COALESCE("sum"("b2b_movements"."quantita") FILTER (WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")))), (0)::numeric) AS "pezzi",
                            COALESCE("sum"("b2b_movements"."incasso_amimi") FILTER (WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")))), (0)::numeric) AS "lordo",
                            COALESCE("sum"("b2b_movements"."cogs") FILTER (WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")))), (0)::numeric) AS "cogs"
                           FROM "public"."b2b_movements"
                          GROUP BY "b2b_movements"."year", "b2b_movements"."month"
                        ), "ex" AS (
                         SELECT "expenses"."year",
                            "expenses"."month",
                            COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'SALARI'::"text")), (0)::numeric) AS "salari",
                            COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'TASSE'::"text")), (0)::numeric) AS "tasse",
                            COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'OPEX'::"text")), (0)::numeric) AS "opex",
                            COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'EVENTI'::"text")), (0)::numeric) AS "eventi",
                            COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'MARKETING'::"text")), (0)::numeric) AS "marketing",
                            COALESCE("sum"("expenses"."costo") FILTER (WHERE (("expenses"."categoria" = 'LOGISTICA'::"text") AND (("expenses"."sottocategoria" IS NULL) OR ("expenses"."sottocategoria" !~~* 'sped%'::"text")))), (0)::numeric) AS "logistica_mag",
                            COALESCE("sum"("expenses"."costo") FILTER (WHERE (("expenses"."categoria" = 'LOGISTICA'::"text") AND ("expenses"."sottocategoria" ~~* 'sped%'::"text"))), (0)::numeric) AS "logistica_var"
                           FROM "public"."expenses"
                          WHERE ("expenses"."status" = 'approved'::"text")
                          GROUP BY "expenses"."year", "expenses"."month"
                        )
                 SELECT "p"."year",
                    "p"."month",
                    (((COALESCE("sl"."vendite", (0)::numeric) - COALESCE("so"."disc", (0)::numeric)) + COALESCE("so"."freeship", (0)::numeric)) + COALESCE("so"."sped", (0)::numeric)) AS "online_lordo",
                    (((((COALESCE("sl"."vendite", (0)::numeric) - COALESCE("so"."disc", (0)::numeric)) + COALESCE("so"."freeship", (0)::numeric)) + COALESCE("so"."sped", (0)::numeric)) / 1.22) + COALESCE("m"."online_netto", (0)::numeric)) AS "online_netto",
                    COALESCE("sl"."pezzi", (0)::numeric) AS "online_pezzi",
                    (COALESCE("qr"."lordo", (0)::numeric) + COALESCE("gf"."lordo", (0)::numeric)) AS "offline_lordo",
                    (((COALESCE("qr"."lordo", (0)::numeric) + COALESCE("gf"."lordo", (0)::numeric)) / 1.22) + COALESCE("m"."offline_netto", (0)::numeric)) AS "offline_netto",
                    (COALESCE("qr"."pezzi", (0)::numeric) + COALESCE("gf"."pezzi", (0)::numeric)) AS "offline_pezzi",
                    COALESCE("b2"."lordo", (0)::numeric) AS "b2b_lordo",
                    ((COALESCE("b2"."lordo", (0)::numeric) / 1.22) + COALESCE("m"."b2b_netto", (0)::numeric)) AS "b2b_netto",
                    COALESCE("b2"."pezzi", (0)::numeric) AS "b2b_pezzi",
                    (((((((((COALESCE("sl"."vendite", (0)::numeric) - COALESCE("so"."disc", (0)::numeric)) + COALESCE("so"."freeship", (0)::numeric)) + COALESCE("so"."sped", (0)::numeric)) / 1.22) + ((COALESCE("qr"."lordo", (0)::numeric) + COALESCE("gf"."lordo", (0)::numeric)) / 1.22)) + (COALESCE("b2"."lordo", (0)::numeric) / 1.22)) + COALESCE("m"."online_netto", (0)::numeric)) + COALESCE("m"."offline_netto", (0)::numeric)) + COALESCE("m"."b2b_netto", (0)::numeric)) AS "omni_netto",
                    ((- (((COALESCE("sl"."cogs", (0)::numeric) + COALESCE("qr"."cogs", (0)::numeric)) + COALESCE("gf"."cogs", (0)::numeric)) + COALESCE("b2"."cogs", (0)::numeric))) + COALESCE("m"."cogs", (0)::numeric)) AS "cogs",
                    ((- ((3.71 * ((COALESCE("sl"."pezzi", (0)::numeric) + COALESCE("qr"."pezzi", (0)::numeric)) + COALESCE("gf"."pezzi", (0)::numeric))) + (COALESCE("so"."ordini", (0)::bigint))::numeric)) + COALESCE("m"."packaging", (0)::numeric)) AS "packaging",
                    (COALESCE("so"."commissioni", (0)::numeric) + COALESCE("m"."commissioni", (0)::numeric)) AS "commissioni",
                    COALESCE("m"."logistica_var", "ex"."logistica_var", (0)::numeric) AS "logistica_var",
                    (((- COALESCE("so"."refund", (0)::numeric)) / 1.22) + COALESCE("m"."resi", (0)::numeric)) AS "resi",
                    (COALESCE("ex"."salari", (0)::numeric) + COALESCE("m"."salari", (0)::numeric)) AS "salari",
                    (COALESCE("ex"."tasse", (0)::numeric) + COALESCE("m"."tasse", (0)::numeric)) AS "tasse",
                    (COALESCE("ex"."logistica_mag", (0)::numeric) + COALESCE("m"."logistica_mag", (0)::numeric)) AS "logistica_mag",
                    (COALESCE("ex"."opex", (0)::numeric) + COALESCE("m"."opex", (0)::numeric)) AS "opex",
                    (COALESCE("ex"."eventi", (0)::numeric) + COALESCE("m"."eventi", (0)::numeric)) AS "eventi",
                    (COALESCE("ex"."marketing", (0)::numeric) + COALESCE("m"."marketing", (0)::numeric)) AS "marketing"
                   FROM ((((((("periods" "p"
                     LEFT JOIN "so" ON ((("so"."year" = "p"."year") AND ("so"."month" = "p"."month"))))
                     LEFT JOIN "sl" ON ((("sl"."year" = "p"."year") AND ("sl"."month" = "p"."month"))))
                     LEFT JOIN "qr" ON ((("qr"."year" = "p"."year") AND ("qr"."month" = "p"."month"))))
                     LEFT JOIN "gf" ON ((("gf"."year" = "p"."year") AND ("gf"."month" = "p"."month"))))
                     LEFT JOIN "b2" ON ((("b2"."year" = "p"."year") AND ("b2"."month" = "p"."month"))))
                     LEFT JOIN "ex" ON ((("ex"."year" = "p"."year") AND ("ex"."month" = "p"."month"))))
                     LEFT JOIN "public"."ce_totale_manual" "m" ON ((("m"."year" = "p"."year") AND ("m"."month" = "p"."month"))))) "f") "t"
     CROSS JOIN LATERAL ( SELECT "b"."base" AS "base_compenso_soci",
            ((- "public"."ce_aliquota_compensi"("t"."year", "t"."month")) * "b"."base") AS "compenso_soci"
           FROM ( SELECT GREATEST((("t"."omni_netto" + "t"."resi") - (COALESCE(( SELECT "sum"("g"."prezzo") AS "sum"
                           FROM "public"."gifts_offline" "g"
                          WHERE (("g"."year" = "t"."year") AND ("g"."month" = "t"."month") AND ("g"."kind" = 'vendita_fuori_fatturato'::"text"))), (0)::numeric) / 1.22)), (0)::numeric) AS "base") "b") "c");


ALTER VIEW "public"."v_ce_totale" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_completezza" AS
 WITH "mesi_nativi" AS (
         SELECT DISTINCT "v_ce_totale"."year",
            "v_ce_totale"."month"
           FROM "public"."v_ce_totale"
          WHERE (NOT (("v_ce_totale"."year", "v_ce_totale"."month") IN ( SELECT "ce_totale_manual"."year",
                    "ce_totale_manual"."month"
                   FROM "public"."ce_totale_manual"
                  WHERE ("ce_totale_manual"."year" IS NOT NULL))))
        ), "sp" AS (
         SELECT "expenses"."year",
            "expenses"."month",
            COALESCE("sum"("expenses"."costo"), (0)::numeric) AS "approvate",
            COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'COGS'::"text")), (0)::numeric) AS "cat_cogs",
            COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'PACKAGING'::"text")), (0)::numeric) AS "cat_packaging"
           FROM "public"."expenses"
          WHERE ("expenses"."status" = 'approved'::"text")
          GROUP BY "expenses"."year", "expenses"."month"
        ), "ce" AS (
         SELECT "v_ce_totale"."year",
            "v_ce_totale"."month",
            ((((((COALESCE("v_ce_totale"."salari", (0)::numeric) + COALESCE("v_ce_totale"."tasse", (0)::numeric)) + COALESCE("v_ce_totale"."opex", (0)::numeric)) + COALESCE("v_ce_totale"."eventi", (0)::numeric)) + COALESCE("v_ce_totale"."marketing", (0)::numeric)) + COALESCE("v_ce_totale"."logistica_mag", (0)::numeric)) + COALESCE("v_ce_totale"."logistica_var", (0)::numeric)) AS "righe_spesa"
           FROM "public"."v_ce_totale"
        )
 SELECT "n"."year",
    "n"."month",
    "round"(COALESCE("sp"."approvate", (0)::numeric), 2) AS "spese_approvate",
    "round"(COALESCE("ce"."righe_spesa", (0)::numeric), 2) AS "spese_nel_ce",
    "round"(COALESCE("sp"."cat_cogs", (0)::numeric), 2) AS "spese_cogs_escluse",
    "round"(COALESCE("sp"."cat_packaging", (0)::numeric), 2) AS "spese_packaging_escluse",
    "round"((COALESCE("sp"."approvate", (0)::numeric) - ((COALESCE("ce"."righe_spesa", (0)::numeric) + COALESCE("sp"."cat_cogs", (0)::numeric)) + COALESCE("sp"."cat_packaging", (0)::numeric))), 2) AS "spese_scoperte"
   FROM (("mesi_nativi" "n"
     LEFT JOIN "sp" ON ((("sp"."year" = "n"."year") AND ("sp"."month" = "n"."month"))))
     LEFT JOIN "ce" ON ((("ce"."year" = "n"."year") AND ("ce"."month" = "n"."month"))));


ALTER VIEW "public"."v_ce_completezza" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_drift" AS
 WITH "live" AS (
         SELECT 'amimi'::"text" AS "ce",
            "v_ce_amimi_summary"."year",
            "v_ce_amimi_summary"."month",
            "v_ce_amimi_summary"."omni_netto",
            "v_ce_amimi_summary"."mc1",
            "v_ce_amimi_summary"."mc2"
           FROM "public"."v_ce_amimi_summary"
        UNION ALL
         SELECT 'totale'::"text",
            "v_ce_totale"."year",
            "v_ce_totale"."month",
            "v_ce_totale"."omni_netto",
            "v_ce_totale"."mc1",
            "v_ce_totale"."mc2"
           FROM "public"."v_ce_totale"
        )
 SELECT "s"."ce",
    "s"."year",
    "s"."month",
    "s"."closed_at",
    "s"."closed_by",
    "round"((("s"."snapshot" ->> 'omni_netto'::"text"))::numeric, 2) AS "netto_chiuso",
    "round"("l"."omni_netto", 2) AS "netto_live",
    "round"(("l"."omni_netto" - (("s"."snapshot" ->> 'omni_netto'::"text"))::numeric), 2) AS "delta_netto",
    "round"((("s"."snapshot" ->> 'mc2'::"text"))::numeric, 2) AS "mc2_chiuso",
    "round"("l"."mc2", 2) AS "mc2_live",
    "round"(("l"."mc2" - (("s"."snapshot" ->> 'mc2'::"text"))::numeric), 2) AS "delta_mc2"
   FROM ("public"."ce_snapshots" "s"
     JOIN "live" "l" ON ((("l"."ce" = "s"."ce") AND ("l"."year" = "s"."year") AND ("l"."month" = "s"."month"))));


ALTER VIEW "public"."v_ce_drift" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_drill_cogs" AS
 SELECT "li"."year",
    "li"."month",
    'online'::"text" AS "canale",
    "li"."codice",
    "p"."item",
    "p"."variant",
    "li"."quantita" AS "qty",
    (- ("li"."cogs_snapshot" * "li"."quantita")) AS "costo",
    false AS "is_gift"
   FROM ("public"."shopify_line_items" "li"
     LEFT JOIN "public"."products" "p" ON (("p"."codice" = "li"."codice")))
  WHERE ("li"."codice_norm" IS DISTINCT FROM 'GIFT_CARD'::"text")
UNION ALL
 SELECT "q"."year",
    "q"."month",
    'offline'::"text" AS "canale",
    "q"."codice",
    "q"."item",
    "q"."variant",
    "q"."quantita" AS "qty",
    (- ("q"."cogs" * "q"."quantita")) AS "costo",
    false AS "is_gift"
   FROM "public"."qromo_sales" "q"
UNION ALL
 SELECT "b"."year",
    "b"."month",
    'b2b'::"text" AS "canale",
    "b"."codice",
    NULL::"text" AS "item",
    NULL::"text" AS "variant",
    "b"."quantita" AS "qty",
    (- "b"."cogs") AS "costo",
    false AS "is_gift"
   FROM "public"."b2b_movements" "b"
  WHERE (("b"."tipo_movimento" = 'venduto'::"text") AND (("b"."stato" IS NULL) OR ("b"."stato" <> 'annullato'::"text")))
UNION ALL
 SELECT "g"."year",
    "g"."month",
    'gift'::"text" AS "canale",
    "g"."codice",
    "g"."item",
    "g"."variant",
    "g"."quantita" AS "qty",
    (- "g"."cogs") AS "costo",
    true AS "is_gift"
   FROM "public"."gifts_offline" "g";


ALTER VIEW "public"."v_ce_drill_cogs" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_drill_expense" AS
 SELECT "year",
    "month",
    "date_paid",
    "operazione",
    "categoria",
    "sottocategoria",
    "costo",
    "amimi",
        CASE
            WHEN ("categoria" = 'SALARI'::"text") THEN 'sal'::"text"
            WHEN ("categoria" = 'TASSE'::"text") THEN 'tasse'::"text"
            WHEN ("categoria" = 'OPEX'::"text") THEN 'opex'::"text"
            WHEN ("categoria" = 'EVENTI'::"text") THEN 'ev'::"text"
            WHEN ("categoria" = 'MARKETING'::"text") THEN 'mkt'::"text"
            WHEN (("categoria" = 'LOGISTICA'::"text") AND ("sottocategoria" ~~* 'sped%'::"text")) THEN 'lvar'::"text"
            WHEN ("categoria" = 'LOGISTICA'::"text") THEN 'lmag'::"text"
            ELSE NULL::"text"
        END AS "ce_line"
   FROM "public"."expenses" "e"
  WHERE ("status" = 'approved'::"text");


ALTER VIEW "public"."v_ce_drill_expense" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_drill_sales" AS
 SELECT "o"."year",
    "o"."month",
    'online'::"text" AS "canale",
    "o"."order_number" AS "ref",
    "o"."customer_name" AS "descr",
    ("o"."created_at_shop")::"date" AS "data",
    NULL::numeric AS "qty",
    (((COALESCE("liv"."vendite", (0)::numeric) - COALESCE("o"."discount_total", (0)::numeric)) + COALESCE("o"."free_shipping_amt", (0)::numeric)) + COALESCE("o"."shipping_total", (0)::numeric)) AS "lordo",
    COALESCE("o"."payment_fees", (0)::numeric) AS "commissioni",
    COALESCE("o"."refund_amount", (0)::numeric) AS "refund",
    false AS "is_gift"
   FROM ("public"."shopify_orders" "o"
     LEFT JOIN ( SELECT "shopify_line_items"."order_id",
            "sum"(("shopify_line_items"."price" * "shopify_line_items"."quantita")) AS "vendite"
           FROM "public"."shopify_line_items" WHERE ("shopify_line_items"."codice_norm" IS DISTINCT FROM 'GIFT_CARD'::"text")
          GROUP BY "shopify_line_items"."order_id") "liv" ON (("liv"."order_id" = "o"."order_id")))
UNION ALL
 SELECT "q"."year",
    "q"."month",
    'offline'::"text" AS "canale",
    "q"."sale_id" AS "ref",
    NULLIF(TRIM(BOTH FROM ((COALESCE("q"."nome", ''::"text") || ' '::"text") || COALESCE("q"."cognome", ''::"text"))), ''::"text") AS "descr",
    "q"."data",
    "q"."quantita" AS "qty",
    "q"."prezzo" AS "lordo",
    (0)::numeric AS "commissioni",
    (0)::numeric AS "refund",
    false AS "is_gift"
   FROM "public"."qromo_sales" "q"
UNION ALL
 SELECT "g"."year",
    "g"."month",
    'gift'::"text" AS "canale",
    "g"."gift_id" AS "ref",
    NULLIF(TRIM(BOTH FROM ((COALESCE("g"."nome", ''::"text") || ' '::"text") || COALESCE("g"."cognome", ''::"text"))), ''::"text") AS "descr",
    "g"."data",
    "g"."quantita" AS "qty",
    "g"."prezzo" AS "lordo",
    (0)::numeric AS "commissioni",
    (0)::numeric AS "refund",
    ("g"."kind" = 'gift'::"text") AS "is_gift"
   FROM "public"."gifts_offline" "g"
UNION ALL
 SELECT "b"."year",
    "b"."month",
    'b2b'::"text" AS "canale",
    "b"."mov_id" AS "ref",
    "b"."negozio" AS "descr",
    "b"."data",
    "b"."quantita" AS "qty",
    "b"."incasso_amimi" AS "lordo",
    (0)::numeric AS "commissioni",
    (0)::numeric AS "refund",
    false AS "is_gift"
   FROM "public"."b2b_movements" "b"
  WHERE (("b"."tipo_movimento" = 'venduto'::"text") AND (("b"."stato" IS NULL) OR ("b"."stato" <> 'annullato'::"text")));


ALTER VIEW "public"."v_ce_drill_sales" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_totale_summary" AS
 SELECT "year",
    "month",
    "online_lordo",
    "online_netto",
    "online_pezzi",
    "offline_lordo",
    "offline_netto",
    "offline_pezzi",
    "b2b_lordo",
    "b2b_netto",
    "b2b_pezzi",
    "omni_netto",
    "cogs",
    "packaging",
    "commissioni",
    "logistica_var",
    "resi",
    "salari",
    "tasse",
    "logistica_mag",
    "opex",
    "eventi",
    "marketing",
    (((((("omni_netto" + "cogs") + "packaging") + "commissioni") + "logistica_var") + "resi") + "compenso_soci") AS "mc1",
    (((((((((((("omni_netto" + "cogs") + "packaging") + "commissioni") + "logistica_var") + "resi") + "compenso_soci") + "salari") + "tasse") + "logistica_mag") + "opex") + "eventi") + "marketing") AS "mc2",
    "base_compenso_soci",
    "compenso_soci"
   FROM "public"."v_ce_totale";


ALTER VIEW "public"."v_ce_totale_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_clienti_coorti" AS
 WITH "ord" AS (
         SELECT "lower"("shopify_orders"."email") AS "email",
            "shopify_orders"."created_at_shop",
            "shopify_orders"."gross_total",
            "shopify_orders"."financial_status"
           FROM "public"."shopify_orders"
          WHERE (("shopify_orders"."email" IS NOT NULL) AND ("shopify_orders"."email" <> ''::"text"))
        ), "primo" AS (
         SELECT "ord"."email",
            "min"("ord"."created_at_shop") AS "primo"
           FROM "ord"
          GROUP BY "ord"."email"
        ), "riacquisti" AS (
         SELECT "p"."email",
            ("date_trunc"('month'::"text", "p"."primo"))::"date" AS "coorte",
            "min"("o"."created_at_shop") FILTER (WHERE ("o"."created_at_shop" > "p"."primo")) AS "secondo"
           FROM ("primo" "p"
             JOIN "ord" "o" ON (("o"."email" = "p"."email")))
          GROUP BY "p"."email", "p"."primo"
        ), "mon" AS (
         SELECT "p"."email",
            ("date_trunc"('month'::"text", "p"."primo"))::"date" AS "coorte",
            "sum"("o"."gross_total") FILTER (WHERE ("o"."financial_status" <> 'refunded'::"text")) AS "spesa"
           FROM ("primo" "p"
             JOIN "ord" "o" ON (("o"."email" = "p"."email")))
          GROUP BY "p"."email", (("date_trunc"('month'::"text", "p"."primo"))::"date")
        )
 SELECT "r"."coorte",
    (CURRENT_DATE - "r"."coorte") AS "maturita_giorni",
    "count"(*) AS "clienti",
    "count"(*) FILTER (WHERE (("r"."secondo" IS NOT NULL) AND ("r"."secondo" <= (( SELECT "min"("o2"."created_at_shop") AS "min"
           FROM "ord" "o2"
          WHERE ("o2"."email" = "r"."email")) + '30 days'::interval)))) AS "ricomprato_30gg",
    "count"(*) FILTER (WHERE (("r"."secondo" IS NOT NULL) AND ("r"."secondo" <= (( SELECT "min"("o2"."created_at_shop") AS "min"
           FROM "ord" "o2"
          WHERE ("o2"."email" = "r"."email")) + '60 days'::interval)))) AS "ricomprato_60gg",
    "count"(*) FILTER (WHERE (("r"."secondo" IS NOT NULL) AND ("r"."secondo" <= (( SELECT "min"("o2"."created_at_shop") AS "min"
           FROM "ord" "o2"
          WHERE ("o2"."email" = "r"."email")) + '90 days'::interval)))) AS "ricomprato_90gg",
    "round"("avg"("m"."spesa"), 2) AS "netto_medio_cliente"
   FROM ("riacquisti" "r"
     JOIN "mon" "m" ON (("m"."email" = "r"."email")))
  GROUP BY "r"."coorte"
  ORDER BY "r"."coorte";


ALTER VIEW "public"."v_clienti_coorti" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_clienti_rfm" AS
 WITH "ord" AS (
         SELECT "lower"("shopify_orders"."email") AS "email",
            "shopify_orders"."order_number",
            "shopify_orders"."created_at_shop",
            "shopify_orders"."gross_total",
            "shopify_orders"."financial_status"
           FROM "public"."shopify_orders"
          WHERE (("shopify_orders"."email" IS NOT NULL) AND ("shopify_orders"."email" <> ''::"text"))
        ), "cli" AS (
         SELECT "ord"."email",
            ("min"("ord"."created_at_shop"))::"date" AS "primo_ordine",
            ("max"("ord"."created_at_shop"))::"date" AS "ultimo_ordine",
            (CURRENT_DATE - ("max"("ord"."created_at_shop"))::"date") AS "recency_giorni",
            "count"(*) AS "frequency",
            "round"("sum"("ord"."gross_total") FILTER (WHERE ("ord"."financial_status" <> 'refunded'::"text")), 2) AS "monetary",
            "count"(*) FILTER (WHERE ("ord"."financial_status" <> 'refunded'::"text")) AS "ordini_validi"
           FROM "ord"
          GROUP BY "ord"."email"
        ), "p" AS (
         SELECT "percentile_cont"((0.9)::double precision) WITHIN GROUP (ORDER BY (("cli"."monetary")::double precision)) AS "p90"
           FROM "cli"
        )
 SELECT "c"."email",
    "c"."primo_ordine",
    "c"."ultimo_ordine",
    "c"."recency_giorni",
    "c"."frequency",
    COALESCE("c"."monetary", (0)::numeric) AS "monetary",
        CASE
            WHEN ("c"."ordini_validi" > 0) THEN "round"(("c"."monetary" / ("c"."ordini_validi")::numeric), 2)
            ELSE NULL::numeric
        END AS "aov",
        CASE
            WHEN (((COALESCE("c"."monetary", (0)::numeric))::double precision >= "p"."p90") AND ("p"."p90" > (0)::double precision)) THEN 'top'::"text"
            WHEN ("c"."frequency" >= 2) THEN 'ripetuto'::"text"
            WHEN ("c"."recency_giorni" <= 60) THEN 'nuovo'::"text"
            WHEN ("c"."recency_giorni" > 120) THEN 'dormiente'::"text"
            ELSE 'una_tantum'::"text"
        END AS "segmento"
   FROM "cli" "c",
    "p";


ALTER VIEW "public"."v_clienti_rfm" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_conto_vendita_negozio" AS
 WITH "cv" AS (
         SELECT "b2b_movements"."negozio",
            "b2b_movements"."codice_norm",
            "sum"(
                CASE
                    WHEN ("b2b_movements"."tipo_movimento" = 'invio'::"text") THEN "b2b_movements"."quantita"
                    WHEN ("b2b_movements"."tipo_movimento" = ANY (ARRAY['reso'::"text", 'venduto'::"text"])) THEN (- "b2b_movements"."quantita")
                    ELSE (0)::numeric
                END) AS "pezzi"
           FROM "public"."b2b_movements"
          WHERE (("b2b_movements"."modello" = 'conto_vendita'::"text") AND ("b2b_movements"."negozio" IS NOT NULL))
          GROUP BY "b2b_movements"."negozio", "b2b_movements"."codice_norm"
        )
 SELECT "cv"."negozio",
    "p"."codice",
    "p"."item",
    "p"."variant",
    "p"."image_url",
    "cv"."pezzi"
   FROM ("cv"
     JOIN "public"."products" "p" ON (("p"."codice_norm" = "cv"."codice_norm")))
  WHERE ("cv"."pezzi" > (0)::numeric);


ALTER VIEW "public"."v_conto_vendita_negozio" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_digest_log_attori_14gg" AS
 SELECT COALESCE("chi", '—'::"text") AS "chi",
    ("count"(*))::integer AS "n"
   FROM "public"."change_log"
  WHERE ((("ts")::"date" >= (CURRENT_DATE - 13)) AND (("ts")::"date" <= CURRENT_DATE))
  GROUP BY COALESCE("chi", '—'::"text")
  ORDER BY (("count"(*))::integer) DESC;


ALTER VIEW "public"."v_digest_log_attori_14gg" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_digest_ordini_14gg" AS
 SELECT "order_number",
    "customer_name",
    ("created_at_shop")::"date" AS "data",
    ("fulfilled_at" IS NOT NULL) AS "evaso",
    "gross_total"
   FROM "public"."shopify_orders" "o"
  WHERE ((("created_at_shop")::"date" >= (CURRENT_DATE - 13)) AND (("created_at_shop")::"date" <= CURRENT_DATE))
  ORDER BY "created_at_shop" DESC;


ALTER VIEW "public"."v_digest_ordini_14gg" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_products_todo" AS
 WITH "self" AS (
         SELECT "p"."id",
            "p"."codice",
            "p"."codice_norm",
            "p"."is_finalized",
            "p"."model",
            "p"."variant",
            "p"."item",
            "p"."categoria",
            "p"."shopify_name",
            "p"."shopify_sku",
            "p"."retail_price",
            "p"."cogs",
            "p"."description",
            "p"."seo_title",
            "p"."image_url",
            "p"."status",
            "p"."notes",
            "p"."source",
            "p"."chi",
            "p"."created_at",
            "p"."updated_at",
            "p"."verificato",
            "upper"("regexp_replace"(COALESCE("p"."model", "p"."item", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) AS "model_key"
           FROM "public"."products" "p"
        ), "base" AS (
         SELECT "s_1"."id",
            "s_1"."codice",
            "s_1"."codice_norm",
            "s_1"."is_finalized",
            "s_1"."model",
            "s_1"."variant",
            "s_1"."item",
            "s_1"."categoria",
            "s_1"."shopify_name",
            "s_1"."shopify_sku",
            "s_1"."retail_price",
            "s_1"."cogs",
            "s_1"."description",
            "s_1"."seo_title",
            "s_1"."image_url",
            "s_1"."status",
            "s_1"."notes",
            "s_1"."source",
            "s_1"."chi",
            "s_1"."created_at",
            "s_1"."updated_at",
            "s_1"."verificato",
            "s_1"."model_key",
            "i"."giacenza_attuale",
            "i"."shopify_sold",
            "i"."qromo_sold",
            "i"."b2b_venduto",
            "i"."on_shopify" AS "inv_on_shopify",
            ((EXISTS ( SELECT 1
                   FROM "public"."supplier_orders" "so"
                  WHERE ("upper"("regexp_replace"("so"."codice", '\s+'::"text", '_'::"text", 'g'::"text")) = "s_1"."codice_norm"))) OR (COALESCE("i"."qty_purchased", (0)::numeric) <> (0)::numeric) OR (COALESCE("i"."shopify_sold", (0)::numeric) <> (0)::numeric) OR (COALESCE("i"."qromo_sold", (0)::numeric) <> (0)::numeric) OR (COALESCE("i"."gift_sold", (0)::numeric) <> (0)::numeric) OR (COALESCE("i"."b2b_venduto", (0)::numeric) <> (0)::numeric) OR (COALESCE("i"."resi_rientrati", (0)::numeric) <> (0)::numeric) OR (COALESCE("i"."aggiustamenti", (0)::numeric) <> (0)::numeric)) AS "attivita"
           FROM ("self" "s_1"
             LEFT JOIN "public"."v_inventory" "i" ON (("i"."codice" = "s_1"."codice")))
        )
 SELECT "codice",
    "item",
    "variant",
    "model",
    "categoria",
    "image_url",
    "retail_price",
    "cogs",
    "description",
    "seo_title",
    "is_finalized",
    "verificato",
    "notes",
    ((((
        CASE
            WHEN (COALESCE(TRIM(BOTH FROM "item"), ''::"text") = ''::"text") THEN 1
            ELSE 0
        END +
        CASE
            WHEN (COALESCE(TRIM(BOTH FROM "variant"), ''::"text") = ''::"text") THEN 1
            ELSE 0
        END) +
        CASE
            WHEN (COALESCE(TRIM(BOTH FROM "image_url"), ''::"text") = ''::"text") THEN 1
            ELSE 0
        END) +
        CASE
            WHEN (("retail_price" IS NULL) OR ("retail_price" = (0)::numeric)) THEN 1
            ELSE 0
        END) +
        CASE
            WHEN (COALESCE(TRIM(BOTH FROM "description"), ''::"text") = ''::"text") THEN 1
            ELSE 0
        END) AS "missing_count",
    COALESCE("giacenza_attuale", (0)::numeric) AS "giacenza",
    ((COALESCE("shopify_sold", (0)::numeric) + COALESCE("qromo_sold", (0)::numeric)) + COALESCE("b2b_venduto", (0)::numeric)) AS "venduto",
    COALESCE("inv_on_shopify", false) AS "on_shopify",
    "source",
        CASE
            WHEN ("model_key" = ''::"text") THEN true
            ELSE (NOT (EXISTS ( SELECT 1
               FROM "public"."products" "o"
              WHERE (("o"."codice" <> "s"."codice") AND ("o"."verificato" = true) AND ("upper"("regexp_replace"(COALESCE("o"."model", "o"."item", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) = "s"."model_key")))))
        END AS "is_new_model",
        CASE
            WHEN (("source" = 'app-ordine'::"text") AND ("verificato" = false) AND "attivita") THEN 'nuovo'::"text"
            WHEN (("source" = 'app-ordine'::"text") AND ("verificato" = false) AND (NOT "attivita")) THEN 'pulizia'::"text"
            WHEN (("retail_price" IS NULL) OR ("retail_price" = (0)::numeric) OR ("cogs" IS NULL) OR ("cogs" = (0)::numeric)) THEN 'costo_ricavo'::"text"
            ELSE 'pulizia'::"text"
        END AS "bucket",
        CASE
            WHEN (("source" = 'app-ordine'::"text") AND ("verificato" = false) AND "attivita") THEN 0
            WHEN (("source" = 'app-ordine'::"text") AND ("verificato" = false) AND (NOT "attivita")) THEN 2
            WHEN (("retail_price" IS NULL) OR ("retail_price" = (0)::numeric) OR ("cogs" IS NULL) OR ("cogs" = (0)::numeric)) THEN 1
            ELSE 2
        END AS "bucket_rank",
    (("source" = 'app-ordine'::"text") AND ("verificato" = false) AND (NOT "attivita")) AS "stub_orfano"
   FROM "base" "s"
  WHERE (("verificato" = false) OR (COALESCE(TRIM(BOTH FROM "item"), ''::"text") = ''::"text") OR (COALESCE(TRIM(BOTH FROM "variant"), ''::"text") = ''::"text") OR ("retail_price" IS NULL) OR ("retail_price" = (0)::numeric) OR ("cogs" IS NULL) OR ("cogs" = (0)::numeric) OR (("source" = 'app-ordine'::"text") AND (COALESCE(TRIM(BOTH FROM "image_url"), ''::"text") = ''::"text")));


ALTER VIEW "public"."v_products_todo" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_digest_persone" AS
 WITH "ord" AS (
         SELECT "count"(*) FILTER (WHERE ((("shopify_orders"."created_at_shop")::"date" >= (CURRENT_DATE - 13)) AND (("shopify_orders"."created_at_shop")::"date" <= CURRENT_DATE))) AS "add14",
            "count"(*) FILTER (WHERE ((("shopify_orders"."created_at_shop")::"date" >= (CURRENT_DATE - 27)) AND (("shopify_orders"."created_at_shop")::"date" <= (CURRENT_DATE - 14)))) AS "add28",
            "count"(*) FILTER (WHERE ((("shopify_orders"."fulfilled_at")::"date" >= (CURRENT_DATE - 13)) AND (("shopify_orders"."fulfilled_at")::"date" <= CURRENT_DATE))) AS "ful14",
            "count"(*) FILTER (WHERE ((("shopify_orders"."fulfilled_at")::"date" >= (CURRENT_DATE - 27)) AND (("shopify_orders"."fulfilled_at")::"date" <= (CURRENT_DATE - 14)))) AS "ful28"
           FROM "public"."shopify_orders"
        ), "onl" AS (
         SELECT COALESCE("sum"(("li"."price" * "li"."quantita")) FILTER (WHERE ((("o"."created_at_shop")::"date" >= (CURRENT_DATE - 13)) AND (("o"."created_at_shop")::"date" <= CURRENT_DATE))), (0)::numeric) AS "on_lordo14"
           FROM ("public"."shopify_line_items" "li"
             JOIN "public"."shopify_orders" "o" USING ("order_id"))
        ), "cl" AS (
         SELECT "count"(*) FILTER (WHERE (((("change_log"."ts")::"date" >= (CURRENT_DATE - 13)) AND (("change_log"."ts")::"date" <= CURRENT_DATE)) AND ("change_log"."op" ~* '(uppercase|merge|maiuscol|finalize|clean|rename|norm)'::"text"))) AS "puliti14",
            "count"(*) FILTER (WHERE (((("change_log"."ts")::"date" >= (CURRENT_DATE - 13)) AND (("change_log"."ts")::"date" <= CURRENT_DATE)) AND ("change_log"."op" = ANY (ARRAY['expense_approve'::"text", 'expense_manual'::"text"])))) AS "spese14",
            "count"(*) FILTER (WHERE ((("change_log"."ts")::"date" >= (CURRENT_DATE - 13)) AND (("change_log"."ts")::"date" <= CURRENT_DATE))) AS "log14",
            "count"(DISTINCT "change_log"."chi") FILTER (WHERE ((("change_log"."ts")::"date" >= (CURRENT_DATE - 13)) AND (("change_log"."ts")::"date" <= CURRENT_DATE))) AS "attori14"
           FROM "public"."change_log"
        ), "ret" AS (
         SELECT "count"(*) FILTER (WHERE (("returns"."data" >= (CURRENT_DATE - 13)) AND ("returns"."data" <= CURRENT_DATE))) AS "resi14"
           FROM "public"."returns"
        ), "todo" AS (
         SELECT ("count"(*))::integer AS "n"
           FROM "public"."v_products_todo"
        ), "hl" AS (
         SELECT "count"(*) FILTER (WHERE ("health_log"."severity" = 'ok'::"text")) AS "ok",
            "count"(*) FILTER (WHERE ("health_log"."severity" = 'warn'::"text")) AS "warn",
            "count"(*) FILTER (WHERE ("health_log"."severity" = ANY (ARRAY['bad'::"text", 'error'::"text"]))) AS "bad",
            "count"(*) FILTER (WHERE (("health_log"."severity" = ANY (ARRAY['bad'::"text", 'error'::"text"])) AND (("health_log"."k" ~ '^ce_'::"text") OR ("health_log"."k" = 'period_mismatch'::"text")))) AS "ce_bad"
           FROM "public"."health_log"
          WHERE ("health_log"."day" = ( SELECT "max"("health_log_1"."day") AS "max"
                   FROM "public"."health_log" "health_log_1"))
        )
 SELECT "ord"."add14" AS "gin_ordini14",
    "ord"."add28" AS "gin_ordini28",
    "ord"."ful14" AS "gin_evasi14",
    "ord"."ful28" AS "gin_evasi28",
    "round"(("onl"."on_lordo14" / (NULLIF("ord"."add14", 0))::numeric), 2) AS "gin_aov14",
    "cl"."puliti14" AS "ben_puliti14",
    "ret"."resi14" AS "ben_resi14",
    "cl"."spese14" AS "ben_spese14",
    "todo"."n" AS "ben_todo",
    "cl"."log14" AS "dan_log14",
    "cl"."attori14" AS "dan_attori14",
    "hl"."ok" AS "dan_health_ok",
    "hl"."warn" AS "dan_health_warn",
    "hl"."bad" AS "dan_health_bad",
    "hl"."ce_bad" AS "dan_ce_bad"
   FROM "ord",
    "onl",
    "cl",
    "ret",
    "todo",
    "hl";


ALTER VIEW "public"."v_digest_persone" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_digest_pulizia_14gg" AS
 SELECT ("ts")::"date" AS "data",
    "op",
    COALESCE("chi", '—'::"text") AS "chi",
    "tbl",
    "row_id"
   FROM "public"."change_log" "cl"
  WHERE (((("ts")::"date" >= (CURRENT_DATE - 13)) AND (("ts")::"date" <= CURRENT_DATE)) AND ("op" ~* '(uppercase|merge|maiuscol|finalize|clean|rename|norm)'::"text"))
  ORDER BY "ts" DESC;


ALTER VIEW "public"."v_digest_pulizia_14gg" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_digest_spese_14gg" AS
 SELECT ("cl"."ts")::"date" AS "data",
    "cl"."op",
    COALESCE("cl"."chi", '—'::"text") AS "chi",
    "e"."operazione",
    "e"."costo"
   FROM ("public"."change_log" "cl"
     LEFT JOIN "public"."expenses" "e" ON ((("e"."id")::"text" = "cl"."row_id")))
  WHERE (((("cl"."ts")::"date" >= (CURRENT_DATE - 13)) AND (("cl"."ts")::"date" <= CURRENT_DATE)) AND ("cl"."op" = ANY (ARRAY['expense_approve'::"text", 'expense_manual'::"text"])))
  ORDER BY "cl"."ts" DESC;


ALTER VIEW "public"."v_digest_spese_14gg" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_digest_versioni" WITH ("security_invoker"='false') AS
 SELECT ( SELECT "count"(*) AS "count"
           FROM "supabase_migrations"."schema_migrations") AS "migr_n",
    ( SELECT "max"("schema_migrations"."version") AS "max"
           FROM "supabase_migrations"."schema_migrations") AS "migr_last";


ALTER VIEW "public"."v_digest_versioni" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_evasione_mensile" AS
 WITH "o" AS (
         SELECT "o_1"."year",
            "o_1"."month",
            ("o_1"."created_at_shop")::"date" AS "d0",
            COALESCE("s"."shipped_date", ("o_1"."fulfilled_at")::"date") AS "d1"
           FROM ("public"."shopify_orders" "o_1"
             LEFT JOIN "public"."shipping_status" "s" ON (("regexp_replace"(COALESCE("o_1"."order_number", "o_1"."order_id"), '^#'::"text", ''::"text") = "regexp_replace"(COALESCE("s"."order_name", ''::"text"), '^#'::"text", ''::"text"))))
          WHERE ("o_1"."created_at_shop" IS NOT NULL)
        )
 SELECT "year",
    "month",
    "count"(*) AS "ordini",
    "count"("d1") AS "spediti",
    "round"("avg"(("d1" - "d0")), 1) AS "giorni_medi",
    "round"(("percentile_cont"((0.5)::double precision) WITHIN GROUP (ORDER BY ((("d1" - "d0"))::double precision)))::numeric, 1) AS "giorni_mediani",
    "count"(*) FILTER (WHERE (("d1" IS NOT NULL) AND (("d1" - "d0") > 3))) AS "oltre_3gg"
   FROM "o"
  GROUP BY "year", "month";


ALTER VIEW "public"."v_evasione_mensile" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_expenses_pending" AS
 SELECT "id",
    "date_reported",
    "date_paid",
    "operazione",
    "costo",
    "categoria",
    "sottocategoria",
    "amimi",
    "note",
    "proposed_by",
    "status",
    "created_at"
   FROM "public"."expenses"
  WHERE ("status" = 'pending'::"text")
  ORDER BY "created_at" DESC;


ALTER VIEW "public"."v_expenses_pending" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_expenses_review" AS
 SELECT "id",
    "year",
    "month",
    "date_reported",
    "date_paid",
    "operazione",
    "costo",
    "categoria",
    "sottocategoria",
    "amimi",
    "amimi_raw",
    "note",
    "status",
    "proposed_by",
    "created_at"
   FROM "public"."expenses"
  WHERE (("status" = 'pending'::"text") OR (("status" <> 'rejected'::"text") AND ("note" ~* 'da verificare'::"text")))
  ORDER BY "year" DESC, "month" DESC, "created_at" DESC;


ALTER VIEW "public"."v_expenses_review" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_fonti_freschezza" AS
 SELECT ( SELECT "max"("shopify_orders"."created_at_shop") AS "max"
           FROM "public"."shopify_orders") AS "ultimo_ordine_shopify",
    ( SELECT "max"("shopify_orders"."synced_at") AS "max"
           FROM "public"."shopify_orders") AS "ultimo_sync_ordini",
    ( SELECT "max"("qromo_sales"."data") AS "max"
           FROM "public"."qromo_sales") AS "ultima_vendita_qromo",
    ( SELECT "max"("meta_ads_daily"."date") AS "max"
           FROM "public"."meta_ads_daily") AS "meta_ads_ultimo_giorno",
    ( SELECT "max"("meta_ads_daily"."pulled_at") AS "max"
           FROM "public"."meta_ads_daily") AS "meta_ads_ultimo_pull",
    ( SELECT "max"("shipping_status"."updated_at") AS "max"
           FROM "public"."shipping_status") AS "ultimo_batch_spedizioni",
    ( SELECT "max"("shopify_stock"."synced_at") AS "max"
           FROM "public"."shopify_stock") AS "ultimo_sync_stock",
    ( SELECT "max"("health_log"."day") AS "max"
           FROM "public"."health_log") AS "ultimo_health",
    ( SELECT "max"("expenses"."date_paid") AS "max"
           FROM "public"."expenses"
          WHERE ("expenses"."status" = 'approved'::"text")) AS "ultima_spesa_pagata",
    ( SELECT "max"("purchases"."data") AS "max"
           FROM "public"."purchases") AS "ultimo_arrivo",
    ( SELECT "max"("meta_ads_creative_daily"."date") AS "max"
           FROM "public"."meta_ads_creative_daily") AS "meta_ads_creative_ultimo_giorno";


ALTER VIEW "public"."v_fonti_freschezza" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_fornitore_prodotti" AS
 SELECT "pu"."fornitore",
    "pu"."codice",
    "max"(COALESCE("p"."item", "pu"."item")) AS "item",
    "max"(COALESCE("p"."variant", "pu"."variant")) AS "variant",
    ("array_agg"("pu"."costo_unitario" ORDER BY "pu"."data" DESC NULLS LAST) FILTER (WHERE ("pu"."costo_unitario" IS NOT NULL)))[1] AS "ultimo_costo",
    "max"("pu"."data") AS "ultima_data",
    COALESCE("max"("p"."image_url"), "max"("ss"."image_url")) AS "image_url",
    "count"(*) AS "n_ordini"
   FROM (("public"."purchases" "pu"
     LEFT JOIN "public"."products" "p" ON (("p"."codice" = "pu"."codice")))
     LEFT JOIN ( SELECT "upper"("regexp_replace"(COALESCE("shopify_stock"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) AS "codice_norm",
            "max"("shopify_stock"."image_url") AS "image_url"
           FROM "public"."shopify_stock"
          GROUP BY ("upper"("regexp_replace"(COALESCE("shopify_stock"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")))) "ss" ON (("ss"."codice_norm" = "pu"."codice_norm")))
  WHERE (COALESCE(TRIM(BOTH FROM "pu"."fornitore"), ''::"text") <> ''::"text")
  GROUP BY "pu"."fornitore", "pu"."codice";


ALTER VIEW "public"."v_fornitore_prodotti" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_sku_availability" AS
 SELECT "codice",
    "item",
    "variant",
    "image_url",
    "giacenza_attuale" AS "giacenza",
    "disponibili_da_vendere" AS "disponibili",
    "on_shopify",
        CASE
            WHEN ("on_shopify" AND ("disponibili_da_vendere" > (0)::numeric)) THEN 'acquistabile'::"text"
            WHEN (("giacenza_attuale" > (0)::numeric) AND (NOT "on_shopify")) THEN 'in_stock_non_pubblicato'::"text"
            WHEN ("on_shopify" AND ("disponibili_da_vendere" <= (0)::numeric)) THEN 'pubblicato_esaurito'::"text"
            ELSE 'altro'::"text"
        END AS "stato"
   FROM "public"."v_inventory" "i"
  WHERE (COALESCE(TRIM(BOTH FROM "item"), ''::"text") <> ''::"text");


ALTER VIEW "public"."v_sku_availability" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_health" AS
 WITH "checks" AS (
         SELECT 'img_missing'::"text" AS "k",
            'Prodotti online senza immagine'::"text" AS "label",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_inventory"
                  WHERE ("v_inventory"."on_shopify" AND ("v_inventory"."image_url" IS NULL))) AS "n"
        UNION ALL
         SELECT 'stock_neg'::"text",
            'Prodotti con giacenza negativa'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_inventory"
                  WHERE ("v_inventory"."giacenza_attuale" < (0)::numeric)) AS "count"
        UNION ALL
         SELECT 'cogs_missing'::"text",
            'Prodotti venduti senza COGS'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_inventory"
                  WHERE ((((COALESCE("v_inventory"."shopify_sold", (0)::numeric) + COALESCE("v_inventory"."qromo_sold", (0)::numeric)) + COALESCE("v_inventory"."b2b_venduto", (0)::numeric)) > (0)::numeric) AND (COALESCE("v_inventory"."cogs", (0)::numeric) = (0)::numeric))) AS "count"
        UNION ALL
         SELECT 'price_missing'::"text",
            'Prodotti su Shopify senza prezzo'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_inventory"
                  WHERE ("v_inventory"."on_shopify" AND (COALESCE("v_inventory"."retail_price", (0)::numeric) = (0)::numeric))) AS "count"
        UNION ALL
         SELECT 'orders_orphan'::"text",
            'Righe ordine con codice non in anagrafica'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."supplier_orders" "so"
                  WHERE ((COALESCE("so"."codice", ''::"text") <> ''::"text") AND (NOT (EXISTS ( SELECT 1
                           FROM "public"."products" "p"
                          WHERE ("p"."codice_norm" = "upper"("regexp_replace"("so"."codice", '\s+'::"text", '_'::"text", 'g'::"text")))))))) AS "count"
        UNION ALL
         SELECT 'todo_products'::"text",
            'Prodotti da completare'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_products_todo") AS "count"
        UNION ALL
         SELECT 'lost_sales'::"text",
            'SKU pubblicati ma esauriti'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_sku_availability"
                  WHERE ("v_sku_availability"."stato" = 'pubblicato_esaurito'::"text")) AS "count"
        UNION ALL
         SELECT 'shopify_orphan'::"text",
            'Vendite Shopify non agganciate a un prodotto (ricavo con COGS 0, stock non scalato)'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."shopify_line_items"
                  WHERE ((COALESCE("shopify_line_items"."lineitem_name", ''::"text") <> ''::"text") AND ("shopify_line_items"."codice" IS NULL))) AS "count"
        UNION ALL
         SELECT 'qromo_orphan'::"text",
            'Vendite Qromo con codice non in anagrafica (ricavo sì, stock no)'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."qromo_sales" "q"
                  WHERE ((COALESCE("q"."codice", ''::"text") <> ''::"text") AND (NOT (EXISTS ( SELECT 1
                           FROM "public"."products" "p"
                          WHERE ("p"."codice_norm" = "q"."codice_norm")))) AND (NOT (EXISTS ( SELECT 1
                           FROM "public"."non_product_codici" "n"
                          WHERE ("upper"("regexp_replace"("n"."codice", '\s+'::"text", '_'::"text", 'g'::"text")) = "q"."codice_norm")))))) AS "count"
        UNION ALL
         SELECT 'dup_codice'::"text",
            'CODICE duplicati in anagrafica (raddoppiano giacenza/valore)'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM ( SELECT "products"."codice_norm"
                           FROM "public"."products"
                          GROUP BY "products"."codice_norm"
                         HAVING ("count"(*) > 1)) "d") AS "count"
        UNION ALL
         SELECT 'period_mismatch'::"text",
            'Righe col mese/anno diverso dalla data (finiscono nel CE del mese sbagliato)'::"text",
            ((((( SELECT "count"(*) AS "count"
                   FROM "public"."qromo_sales"
                  WHERE (("qromo_sales"."data" IS NOT NULL) AND (("qromo_sales"."year" IS DISTINCT FROM (EXTRACT(year FROM "qromo_sales"."data"))::integer) OR ("qromo_sales"."month" IS DISTINCT FROM (EXTRACT(month FROM "qromo_sales"."data"))::integer)))) + ( SELECT "count"(*) AS "count"
                   FROM "public"."expenses"
                  WHERE (("expenses"."date_paid" IS NOT NULL) AND (("expenses"."year" IS DISTINCT FROM (EXTRACT(year FROM "expenses"."date_paid"))::integer) OR ("expenses"."month" IS DISTINCT FROM (EXTRACT(month FROM "expenses"."date_paid"))::integer))))) + ( SELECT "count"(*) AS "count"
                   FROM "public"."returns"
                  WHERE (("returns"."data" IS NOT NULL) AND (("returns"."year" IS DISTINCT FROM (EXTRACT(year FROM "returns"."data"))::integer) OR ("returns"."month" IS DISTINCT FROM (EXTRACT(month FROM "returns"."data"))::integer))))) + ( SELECT "count"(*) AS "count"
                   FROM "public"."gifts_offline"
                  WHERE (("gifts_offline"."data" IS NOT NULL) AND (("gifts_offline"."year" IS DISTINCT FROM (EXTRACT(year FROM "gifts_offline"."data"))::integer) OR ("gifts_offline"."month" IS DISTINCT FROM (EXTRACT(month FROM "gifts_offline"."data"))::integer))))) + ( SELECT "count"(*) AS "count"
                   FROM "public"."b2b_movements"
                  WHERE (("b2b_movements"."data" IS NOT NULL) AND (("b2b_movements"."year" IS DISTINCT FROM (EXTRACT(year FROM "b2b_movements"."data"))::integer) OR ("b2b_movements"."month" IS DISTINCT FROM (EXTRACT(month FROM "b2b_movements"."data"))::integer)))))
        UNION ALL
         SELECT 'ce_drift_live'::"text",
            'Mesi CHIUSI i cui numeri sono cambiati (netto o utile mc2)'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_ce_drift"
                  WHERE (("abs"(COALESCE("v_ce_drift"."delta_netto", (0)::numeric)) > 0.01) OR ("abs"(COALESCE("v_ce_drift"."delta_mc2", (0)::numeric)) > 0.01))) AS "count"
        )
 SELECT "k",
    "label",
    "n",
        CASE
            WHEN ("n" = 0) THEN 'ok'::"text"
            WHEN ("k" = ANY (ARRAY['stock_neg'::"text", 'cogs_missing'::"text", 'price_missing'::"text", 'orders_orphan'::"text", 'shopify_orphan'::"text", 'qromo_orphan'::"text", 'dup_codice'::"text", 'period_mismatch'::"text", 'ce_drift_live'::"text"])) THEN 'bad'::"text"
            ELSE 'warn'::"text"
        END AS "severity"
   FROM "checks";


ALTER VIEW "public"."v_health" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_last_sale" AS
 WITH "s" AS (
         SELECT "qromo_sales"."codice_norm",
            ("qromo_sales"."data")::timestamp with time zone AS "d",
            ("qromo_sales"."prezzo")::numeric AS "price"
           FROM "public"."qromo_sales"
          WHERE ("qromo_sales"."data" IS NOT NULL)
        UNION ALL
         SELECT "li"."codice_norm",
            "o"."created_at_shop" AS "d",
            ("li"."price")::numeric AS "price"
           FROM ("public"."shopify_line_items" "li"
             JOIN "public"."shopify_orders" "o" ON (("o"."order_id" = "li"."order_id")))
          WHERE ("o"."created_at_shop" IS NOT NULL)
        UNION ALL
         SELECT "b2b_movements"."codice_norm",
            ("b2b_movements"."data")::timestamp with time zone AS "d",
            ("b2b_movements"."prezzo_retail")::numeric AS "prezzo_retail"
           FROM "public"."b2b_movements"
          WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND ("b2b_movements"."data" IS NOT NULL))
        )
 SELECT DISTINCT ON ("codice_norm") "codice_norm",
    ("d")::"date" AS "last_date",
    "price" AS "last_price"
   FROM "s"
  ORDER BY "codice_norm", "d" DESC NULLS LAST;


ALTER VIEW "public"."v_last_sale" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_lead_dossier" WITH ("security_invoker"='on') AS
 SELECT "a"."id",
    "a"."nome",
    "a"."tipo",
    "a"."gruppo_id",
    "a"."indirizzo",
    "a"."citta",
    "a"."provincia",
    "a"."regione",
    "a"."paese",
    "a"."lat",
    "a"."lng",
    "a"."website",
    "a"."ig_handle",
    "a"."google_place_id",
    "a"."google_maps_url",
    "a"."telefono",
    "a"."email_generica",
    "a"."piva",
    "a"."fonte_seed",
    "a"."priorita_tipologia",
    "a"."stato_ricerca",
    "a"."rejected_motivo",
    "a"."lead_stage",
    "a"."tier",
    "a"."gancio",
    "a"."gancio_evidence_id",
    "a"."owner_note",
    "a"."contattato_prima",
    "a"."chi",
    "a"."negozio_id",
    "a"."created_at",
    "a"."updated_at",
    "a"."verdetto",
    "a"."verdetto_motivo",
    "a"."verdetto_chi",
    "a"."verdetto_at",
    "s"."id" AS "score_id",
    "s"."totale",
    "s"."tier_proposto",
    "s"."criteri",
    "s"."bonus",
    "s"."esclusione",
    "s"."dati_incompleti",
    "s"."motivazione",
    "s"."perche_no",
    "s"."rubrica_version",
    "s"."created_at" AS "scored_at",
    "r"."azione" AS "ultima_review_azione",
    "r"."chi" AS "ultima_review_chi",
    "r"."created_at" AS "ultima_review_at",
    ( SELECT "e"."asset_path"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'screenshot_home'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "shot_home",
    ( SELECT "e"."asset_path"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'screenshot_home_mobile'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "shot_home_mobile",
    ( SELECT "e"."asset_path"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'screenshot_ig'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "shot_ig",
    ( SELECT "e"."asset_path"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'screenshot_maps'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "shot_maps",
    ( SELECT "e"."asset_path"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'screenshot_maps_photos'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "shot_maps_photos",
    ( SELECT "e"."payload"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'ig_metrics'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "ig_metrics",
    ( SELECT "e"."payload"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'ig_posts'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "ig_posts",
    ( SELECT "e"."payload"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'maps'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "maps",
    ( SELECT "e"."payload"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'maps_reviews'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "maps_reviews",
    ( SELECT "e"."payload"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'brands_carried'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "brands_carried",
    ( SELECT "e"."payload"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'price_band'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "price_band",
    ( SELECT "e"."payload"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'site_products'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "site_products",
    ( SELECT "e"."payload"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'stampa'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "stampa",
    ( SELECT "e"."payload"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'site_meta'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "site_meta",
    ( SELECT "e"."payload"
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'about_text'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "about_text",
    ( SELECT ((("e"."payload" -> 'post'::"text") -> 0) ->> 'asset_path'::"text")
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'ig_posts'::"text") AND (((("e"."payload" -> 'post'::"text") -> 0) ->> 'asset_path'::"text") IS NOT NULL))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "thumb",
    ( SELECT "count"(*) AS "count"
           FROM "public"."lead_evidence" "e"
          WHERE ("e"."account_id" = "a"."id")) AS "n_evidenze",
    ( SELECT "count"(*) AS "count"
           FROM "public"."lead_contacts" "c"
          WHERE ("c"."account_id" = "a"."id")) AS "n_contatti",
    "g"."nome" AS "gruppo_nome"
   FROM ((("public"."lead_accounts" "a"
     LEFT JOIN LATERAL ( SELECT "x"."id",
            "x"."account_id",
            "x"."run_id",
            "x"."rubrica_version",
            "x"."criteri",
            "x"."bonus",
            "x"."esclusione",
            "x"."totale",
            "x"."tier_proposto",
            "x"."dati_incompleti",
            "x"."motivazione",
            "x"."perche_no",
            "x"."modello",
            "x"."created_at"
           FROM "public"."lead_scores" "x"
          WHERE ("x"."account_id" = "a"."id")
          ORDER BY "x"."created_at" DESC
         LIMIT 1) "s" ON (true))
     LEFT JOIN LATERAL ( SELECT "y"."id",
            "y"."account_id",
            "y"."chi",
            "y"."azione",
            "y"."tier",
            "y"."motivo",
            "y"."nota",
            "y"."created_at",
            "y"."verdetto"
           FROM "public"."lead_reviews" "y"
          WHERE ("y"."account_id" = "a"."id")
          ORDER BY "y"."created_at" DESC
         LIMIT 1) "r" ON (true))
     LEFT JOIN "public"."lead_accounts" "g" ON (("g"."id" = "a"."gruppo_id")));


ALTER VIEW "public"."v_lead_dossier" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_lead_followup_due" WITH ("security_invoker"='on') AS
 SELECT "a"."id",
    "a"."paese",
    "a"."prossima_azione_at",
    "lo"."sequenza_tocco" AS "ultimo_tocco",
    "lo"."gmail_thread_id"
   FROM ("public"."lead_accounts" "a"
     JOIN LATERAL ( SELECT "t"."sequenza_tocco",
            "t"."gmail_thread_id",
            "t"."at"
           FROM "public"."lead_touches" "t"
          WHERE (("t"."account_id" = "a"."id") AND ("t"."direzione" = 'out'::"text") AND ("t"."canale" = 'email'::"text") AND ("t"."sequenza_tocco" IS NOT NULL))
          ORDER BY "t"."sequenza_tocco" DESC
         LIMIT 1) "lo" ON (true))
  WHERE (("a"."lead_stage" = 'contattato'::"text") AND ("a"."verdetto" = 'da_contattare'::"text") AND ("a"."stato_ricerca" <> 'rejected'::"text") AND ("a"."prossima_azione_at" <= (("now"() AT TIME ZONE 'Europe/Rome'::"text"))::"date") AND ("lo"."sequenza_tocco" < 4) AND ("lo"."gmail_thread_id" IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM "public"."lead_contacts" "c"
          WHERE (("c"."account_id" = "a"."id") AND "c"."opt_out")))) AND (NOT (EXISTS ( SELECT 1
           FROM "public"."lead_touches" "i"
          WHERE (("i"."account_id" = "a"."id") AND ("i"."direzione" = 'in'::"text") AND ("i"."esito" IS DISTINCT FROM 'risposta_automatica'::"text") AND ("i"."at" > ("lo"."at" -
                CASE
                    WHEN ("i"."esito" = 'bounce'::"text") THEN '00:10:00'::interval
                    ELSE '00:00:00'::interval
                END)))))) AND (NOT (EXISTS ( SELECT 1
           FROM "public"."lead_drafts" "d"
          WHERE (("d"."account_id" = "a"."id") AND ("d"."sequenza_tocco" = ("lo"."sequenza_tocco" + 1)) AND (("d"."origine" = 'auto'::"text") OR ("d"."stato" = ANY (ARRAY['proposta'::"text", 'approvata'::"text", 'in_invio'::"text", 'inviata'::"text"]))))))));


ALTER VIEW "public"."v_lead_followup_due" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_lead_outreach" WITH ("security_invoker"='on') AS
 SELECT "a"."id",
    "a"."nome",
    "a"."tipo",
    "a"."citta",
    "a"."provincia",
    "a"."paese",
    "a"."website",
    "a"."ig_handle",
    "a"."email_generica",
    "a"."telefono",
    "a"."lead_stage",
    "a"."verdetto",
    "a"."verdetto_motivo",
    "a"."tier",
    "a"."gancio",
    "a"."prossima_azione",
    "a"."prossima_azione_at",
    "a"."owner_outreach",
    "a"."owner_note",
    "s"."totale",
    "s"."tier_proposto",
    "t"."at" AS "ultimo_tocco_at",
    "t"."canale" AS "ultimo_canale",
    "t"."direzione" AS "ultima_direzione",
    "t"."esito" AS "ultimo_esito",
    "t"."chi" AS "ultimo_chi",
    ( SELECT "count"(*) AS "count"
           FROM "public"."lead_touches" "x"
          WHERE ("x"."account_id" = "a"."id")) AS "n_tocchi",
    ( SELECT "count"(*) AS "count"
           FROM "public"."lead_touches" "x"
          WHERE (("x"."account_id" = "a"."id") AND ("x"."direzione" = 'out'::"text") AND ("x"."canale" = 'email'::"text"))) AS "n_email_out",
        CASE
            WHEN ("t"."at" IS NULL) THEN NULL::integer
            ELSE (EXTRACT(day FROM ("now"() - "t"."at")))::integer
        END AS "giorni_da_ultimo",
    (("a"."prossima_azione_at" IS NOT NULL) AND ("a"."prossima_azione_at" < CURRENT_DATE)) AS "scaduta",
    (("t"."direzione" = 'in'::"text") AND ("a"."lead_stage" = 'risposto'::"text")) AS "da_gestire",
    ( SELECT ((("e"."payload" -> 'post'::"text") -> 0) ->> 'asset_path'::"text")
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'ig_posts'::"text") AND (((("e"."payload" -> 'post'::"text") -> 0) ->> 'asset_path'::"text") IS NOT NULL))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "thumb",
    (( SELECT ("e"."payload" ->> 'follower'::"text")
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'ig_metrics'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1))::integer AS "follower",
    ( SELECT ("e"."payload" ->> 'telefono'::"text")
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'maps'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "telefono_maps",
    ( SELECT (("e"."payload" -> 'emails'::"text") ->> 0)
           FROM "public"."lead_evidence" "e"
          WHERE (("e"."account_id" = "a"."id") AND ("e"."tipo" = 'site_meta'::"text"))
          ORDER BY "e"."captured_at" DESC
         LIMIT 1) AS "email_sito",
    ( SELECT "count"(*) AS "count"
           FROM "public"."lead_contacts" "c"
          WHERE (("c"."account_id" = "a"."id") AND "c"."opt_out")) AS "n_opt_out",
    ( SELECT "d"."sequenza_tocco"
           FROM "public"."lead_drafts" "d"
          WHERE (("d"."account_id" = "a"."id") AND ("d"."origine" = 'auto'::"text") AND ("d"."stato" = 'proposta'::"text") AND ("a"."lead_stage" = 'contattato'::"text") AND (NOT (EXISTS ( SELECT 1
                   FROM "public"."lead_touches" "x"
                  WHERE (("x"."account_id" = "a"."id") AND ("x"."direzione" = 'out'::"text") AND ("x"."canale" = 'email'::"text") AND ("x"."sequenza_tocco" = "d"."sequenza_tocco"))))))
          ORDER BY "d"."created_at" DESC
         LIMIT 1) AS "bozza_auto_tocco"
   FROM (("public"."lead_accounts" "a"
     LEFT JOIN LATERAL ( SELECT "x"."id",
            "x"."account_id",
            "x"."run_id",
            "x"."rubrica_version",
            "x"."criteri",
            "x"."bonus",
            "x"."esclusione",
            "x"."totale",
            "x"."tier_proposto",
            "x"."dati_incompleti",
            "x"."motivazione",
            "x"."perche_no",
            "x"."modello",
            "x"."created_at"
           FROM "public"."lead_scores" "x"
          WHERE ("x"."account_id" = "a"."id")
          ORDER BY "x"."created_at" DESC
         LIMIT 1) "s" ON (true))
     LEFT JOIN LATERAL ( SELECT "y"."id",
            "y"."account_id",
            "y"."contact_id",
            "y"."canale",
            "y"."direzione",
            "y"."gmail_message_id",
            "y"."gmail_thread_id",
            "y"."subject",
            "y"."body_clean",
            "y"."stage_prima",
            "y"."stage_dopo",
            "y"."chi",
            "y"."at",
            "y"."created_at",
            "y"."esito",
            "y"."prossima_azione",
            "y"."prossima_azione_at",
            "y"."sequenza_tocco"
           FROM "public"."lead_touches" "y"
          WHERE ("y"."account_id" = "a"."id")
          ORDER BY "y"."at" DESC
         LIMIT 1) "t" ON (true))
  WHERE (("a"."verdetto" = 'da_contattare'::"text") OR ("a"."lead_stage" <> 'da_contattare'::"text") OR ("a"."owner_outreach" IS NOT NULL));


ALTER VIEW "public"."v_lead_outreach" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_lead_pipeline" WITH ("security_invoker"='on') AS
 SELECT "stato_ricerca",
    "tier",
    "lead_stage",
    "paese",
    "count"(*) AS "n"
   FROM "public"."lead_accounts"
  GROUP BY "stato_ricerca", "tier", "lead_stage", "paese";


ALTER VIEW "public"."v_lead_pipeline" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_lead_settings" AS
 SELECT "key",
    "value"
   FROM "public"."app_flags"
  WHERE ("key" = ANY (ARRAY['lead_enabled'::"text", 'lead_firma'::"text", 'lead_tetto_giornaliero'::"text", 'lead_outreach_ai_enabled'::"text", 'lead_linesheet_url'::"text"]));


ALTER VIEW "public"."v_lead_settings" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_loyalty_funnel_daily" WITH ("security_invoker"='on') AS
 WITH "d" AS (
         SELECT ("generate_series"((((("now"() AT TIME ZONE 'Europe/Rome'::"text"))::"date" - 89))::timestamp with time zone, ((("now"() AT TIME ZONE 'Europe/Rome'::"text"))::"date")::timestamp with time zone, '1 day'::interval))::"date" AS "day"
        )
 SELECT "day",
    ( SELECT "count"(*) AS "count"
           FROM "public"."loyalty_visits" "v"
          WHERE ("v"."day" = "d"."day")) AS "aperture",
    ( SELECT "count"(*) AS "count"
           FROM "public"."loyalty_ui_events" "u"
          WHERE (("u"."day" = "d"."day") AND ("u"."event" = 'page_open'::"text"))) AS "sessioni",
    ( SELECT "count"(DISTINCT "u"."shopify_customer_id") AS "count"
           FROM "public"."loyalty_ui_events" "u"
          WHERE (("u"."day" = "d"."day") AND ("u"."event" = 'view'::"text") AND ("u"."element" ~~ 'redeem\_%'::"text"))) AS "visto_premio",
    ( SELECT "count"(DISTINCT "u"."shopify_customer_id") AS "count"
           FROM "public"."loyalty_ui_events" "u"
          WHERE (("u"."day" = "d"."day") AND ("u"."event" = 'view'::"text") AND ("u"."element" = 'redeem_ready'::"text"))) AS "premio_pronto",
    ( SELECT "count"(DISTINCT "u"."shopify_customer_id") AS "count"
           FROM "public"."loyalty_ui_events" "u"
          WHERE (("u"."day" = "d"."day") AND ("u"."event" = 'tap'::"text") AND ("u"."element" = 'redeem'::"text"))) AS "tap_riscatta",
    ( SELECT "count"(DISTINCT "r"."shopify_customer_id") AS "count"
           FROM "public"."loyalty_redemptions" "r"
          WHERE (("r"."status" = 'fulfilled'::"text") AND ((("r"."created_at" AT TIME ZONE 'Europe/Rome'::"text"))::"date" = "d"."day"))) AS "riscatti",
    ( SELECT "count"(*) AS "count"
           FROM "public"."shopify_orders" "o"
          WHERE (("o"."discount_codes" ~~* '%AMICA12-%'::"text") AND ("o"."financial_status" = ANY (ARRAY['paid'::"text", 'partially_refunded'::"text", 'refunded'::"text"])) AND ((("o"."created_at_shop" AT TIME ZONE 'Europe/Rome'::"text"))::"date" = "d"."day"))) AS "ordini_amica12"
   FROM "d"
  ORDER BY "day";


ALTER VIEW "public"."v_loyalty_funnel_daily" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_loyalty_kpi_daily" WITH ("security_invoker"='true') AS
 WITH "d" AS (
         SELECT ("generate_series"((COALESCE(( SELECT ("min"("loyalty_events"."created_at"))::"date" AS "min"
                   FROM "public"."loyalty_events"), CURRENT_DATE))::timestamp with time zone, (CURRENT_DATE)::timestamp with time zone, '1 day'::interval))::"date" AS "day"
        )
 SELECT "day",
    ( SELECT "count"("v"."shopify_customer_id") AS "count"
           FROM "public"."loyalty_visits" "v"
          WHERE ("v"."day" = "d"."day")) AS "visite_clienti",
    ( SELECT COALESCE("sum"("v"."hits"), (0)::bigint) AS "coalesce"
           FROM "public"."loyalty_visits" "v"
          WHERE ("v"."day" = "d"."day")) AS "visite_hits",
    ( SELECT "count"(DISTINCT "e"."shopify_customer_id") AS "count"
           FROM "public"."loyalty_events" "e"
          WHERE ((("e"."created_at" AT TIME ZONE 'Europe/Rome'::"text"))::"date" = "d"."day")) AS "clienti_attivi",
    ( SELECT "count"("e"."id") AS "count"
           FROM "public"."loyalty_events" "e"
          WHERE (((("e"."created_at" AT TIME ZONE 'Europe/Rome'::"text"))::"date" = "d"."day") AND ("e"."source" = 'mimi_coccola'::"text"))) AS "coccole",
    ( SELECT "count"("e"."id") AS "count"
           FROM "public"."loyalty_events" "e"
          WHERE (((("e"."created_at" AT TIME ZONE 'Europe/Rome'::"text"))::"date" = "d"."day") AND ("e"."source" = 'game_memory'::"text"))) AS "memory",
    ( SELECT "count"("e"."id") AS "count"
           FROM "public"."loyalty_events" "e"
          WHERE (((("e"."created_at" AT TIME ZONE 'Europe/Rome'::"text"))::"date" = "d"."day") AND ("e"."source" = 'purchase'::"text"))) AS "accrediti_acquisto",
    ( SELECT COALESCE("sum"("e"."delta"), (0)::bigint) AS "coalesce"
           FROM "public"."loyalty_events" "e"
          WHERE (((("e"."created_at" AT TIME ZONE 'Europe/Rome'::"text"))::"date" = "d"."day") AND ("e"."delta" > 0))) AS "punti_guadagnati",
    ( SELECT COALESCE((- "sum"("e"."delta")), (0)::bigint) AS "coalesce"
           FROM "public"."loyalty_events" "e"
          WHERE (((("e"."created_at" AT TIME ZONE 'Europe/Rome'::"text"))::"date" = "d"."day") AND ("e"."delta" < 0))) AS "punti_riscattati",
    ( SELECT "count"("r"."id") AS "count"
           FROM "public"."loyalty_redemptions" "r"
          WHERE ((("r"."created_at" AT TIME ZONE 'Europe/Rome'::"text"))::"date" = "d"."day")) AS "riscatti",
    ( SELECT "count"("r"."id") AS "count"
           FROM "public"."loyalty_redemptions" "r"
          WHERE (((("r"."created_at" AT TIME ZONE 'Europe/Rome'::"text"))::"date" = "d"."day") AND ("r"."status" = 'failed'::"text"))) AS "riscatti_falliti"
   FROM "d"
  ORDER BY "day";


ALTER VIEW "public"."v_loyalty_kpi_daily" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_loyalty_ledger_drift" WITH ("security_invoker"='true') AS
 SELECT "p"."shopify_customer_id",
    "p"."points",
    COALESCE("sum"("e"."delta"), (0)::bigint) AS "sum_events",
    ("p"."points" - COALESCE("sum"("e"."delta"), (0)::bigint)) AS "diff"
   FROM ("public"."loyalty_points" "p"
     LEFT JOIN "public"."loyalty_events" "e" ON (("e"."shopify_customer_id" = "p"."shopify_customer_id")))
  GROUP BY "p"."shopify_customer_id", "p"."points";


ALTER VIEW "public"."v_loyalty_ledger_drift" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_loyalty_members" WITH ("security_invoker"='true') AS
 SELECT "p"."shopify_customer_id",
    "p"."points" AS "saldo",
    COALESCE("sum"(
        CASE
            WHEN ("e"."delta" > 0) THEN "e"."delta"
            ELSE NULL::integer
        END), (0)::bigint) AS "guadagnati",
    COALESCE((- "sum"(
        CASE
            WHEN ("e"."delta" < 0) THEN "e"."delta"
            ELSE NULL::integer
        END)), (0)::bigint) AS "riscattati",
    "min"("e"."created_at") AS "primo_evento",
    "max"("e"."created_at") AS "ultimo_evento",
        CASE
            WHEN ("p"."points" >= 400) THEN 'Amica del Cuore'::"text"
            WHEN ("p"."points" >= 150) THEN 'Amica Speciale'::"text"
            ELSE 'Amica'::"text"
        END AS "tier_saldo",
    ( SELECT "count"("c"."shopify_order_id") AS "count"
           FROM "public"."loyalty_order_credits" "c"
          WHERE ("c"."shopify_customer_id" = "p"."shopify_customer_id")) AS "ordini_accreditati",
    ( SELECT COALESCE("sum"("c"."order_total"), (0)::numeric) AS "coalesce"
           FROM "public"."loyalty_order_credits" "c"
          WHERE ("c"."shopify_customer_id" = "p"."shopify_customer_id")) AS "spesa_accreditata",
    ( SELECT "count"("r"."id") AS "count"
           FROM "public"."loyalty_redemptions" "r"
          WHERE (("r"."shopify_customer_id" = "p"."shopify_customer_id") AND ("r"."status" = 'fulfilled'::"text"))) AS "riscatti_evasi",
    COALESCE("sum"(
        CASE
            WHEN ("e"."source" <> 'redeem'::"text") THEN "e"."delta"
            ELSE NULL::integer
        END), (0)::bigint) AS "punti_cumulati",
    "public"."loyalty_tier_of"((COALESCE("sum"(
        CASE
            WHEN ("e"."source" <> 'redeem'::"text") THEN "e"."delta"
            ELSE NULL::integer
        END), (0)::bigint))::integer) AS "tier_cumulato"
   FROM ("public"."loyalty_points" "p"
     LEFT JOIN "public"."loyalty_events" "e" ON (("e"."shopify_customer_id" = "p"."shopify_customer_id")))
  GROUP BY "p"."shopify_customer_id", "p"."points";


ALTER VIEW "public"."v_loyalty_members" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_loyalty_pool" WITH ("security_invoker"='true') AS
 SELECT "key" AS "reward",
    "label",
    "cost_points",
    "active",
    ( SELECT "count"("c"."reward_key") AS "count"
           FROM "public"."loyalty_reward_codes" "c"
          WHERE (("c"."reward_key" = "r"."key") AND ("c"."claimed_by" IS NULL))) AS "codici_liberi",
    ( SELECT "count"("c"."reward_key") AS "count"
           FROM "public"."loyalty_reward_codes" "c"
          WHERE (("c"."reward_key" = "r"."key") AND ("c"."claimed_by" IS NOT NULL))) AS "codici_usati",
    ( SELECT "count"("x"."id") AS "count"
           FROM "public"."loyalty_redemptions" "x"
          WHERE (("x"."reward_key" = "r"."key") AND ("x"."status" = 'pending'::"text"))) AS "riscatti_pending",
    ( SELECT "min"("x"."created_at") AS "min"
           FROM "public"."loyalty_redemptions" "x"
          WHERE (("x"."reward_key" = "r"."key") AND ("x"."status" = 'pending'::"text"))) AS "pending_piu_vecchio"
   FROM "public"."loyalty_rewards" "r";


ALTER VIEW "public"."v_loyalty_pool" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_loyalty_redeem_rate" WITH ("security_invoker"='true') AS
 SELECT COALESCE("sum"(
        CASE
            WHEN ("delta" > 0) THEN "delta"
            ELSE NULL::integer
        END), (0)::bigint) AS "punti_guadagnati_totali",
    COALESCE((- "sum"(
        CASE
            WHEN ("delta" < 0) THEN "delta"
            ELSE NULL::integer
        END)), (0)::bigint) AS "punti_riscattati_totali",
        CASE
            WHEN (COALESCE("sum"(
            CASE
                WHEN ("delta" > 0) THEN "delta"
                ELSE NULL::integer
            END), (0)::bigint) > 0) THEN "round"(((100.0 * (COALESCE((- "sum"(
            CASE
                WHEN ("delta" < 0) THEN "delta"
                ELSE NULL::integer
            END)), (0)::bigint))::numeric) / ("sum"(
            CASE
                WHEN ("delta" > 0) THEN "delta"
                ELSE NULL::integer
            END))::numeric), 1)
            ELSE (0)::numeric
        END AS "pct_riscattato",
    ( SELECT "count"("r"."id") AS "count"
           FROM "public"."loyalty_redemptions" "r"
          WHERE ("r"."status" = 'fulfilled'::"text")) AS "riscatti_evasi",
    ( SELECT "count"("r"."id") AS "count"
           FROM "public"."loyalty_redemptions" "r"
          WHERE ("r"."status" = 'pending'::"text")) AS "riscatti_pending",
    ( SELECT "count"("p"."shopify_customer_id") AS "count"
           FROM "public"."loyalty_points" "p") AS "membri",
    ( SELECT "count"("p"."shopify_customer_id") AS "count"
           FROM "public"."loyalty_points" "p"
          WHERE ("p"."points" >= COALESCE(( SELECT "min"("w"."cost_points") AS "min"
                   FROM "public"."loyalty_rewards" "w"
                  WHERE "w"."active"), 200))) AS "membri_con_tessera_piena"
   FROM "public"."loyalty_events" "e";


ALTER VIEW "public"."v_loyalty_redeem_rate" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_loyalty_refunds_due" WITH ("security_invoker"='true') AS
 SELECT "c"."shopify_order_id",
    "c"."order_name",
    "c"."shopify_customer_id",
    "c"."points",
    "c"."order_total",
    "o"."refund_amount",
    "o"."financial_status",
    COALESCE("r"."points_reversed", 0) AS "points_reversed",
        CASE
            WHEN (COALESCE("c"."order_total", (0)::numeric) <= (0)::numeric) THEN "c"."points"
            ELSE (LEAST(("c"."points")::numeric, "floor"((("c"."points")::numeric * LEAST(("o"."refund_amount" / "c"."order_total"), (1)::numeric)))))::integer
        END AS "target"
   FROM (("public"."loyalty_order_credits" "c"
     JOIN "public"."shopify_orders" "o" ON (("o"."order_id" = "c"."order_name")))
     LEFT JOIN "public"."loyalty_order_reversals" "r" ON (("r"."shopify_order_id" = "c"."shopify_order_id")))
  WHERE ((COALESCE("o"."refund_amount", (0)::numeric) > (0)::numeric) AND (
        CASE
            WHEN (COALESCE("c"."order_total", (0)::numeric) <= (0)::numeric) THEN "c"."points"
            ELSE (LEAST(("c"."points")::numeric, "floor"((("c"."points")::numeric * LEAST(("o"."refund_amount" / "c"."order_total"), (1)::numeric)))))::integer
        END > COALESCE("r"."points_reversed", 0)));


ALTER VIEW "public"."v_loyalty_refunds_due" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_loyalty_second_order" WITH ("security_invoker"='true') AS
 WITH "c" AS (
         SELECT "c"."shopify_customer_id",
            "c"."shopify_order_id",
            "c"."order_name",
            "c"."points",
            COALESCE("o"."created_at_shop", "c"."created_at") AS "order_at",
            ((COALESCE("o"."created_at_shop", "c"."created_at") AT TIME ZONE 'Europe/Rome'::"text"))::"date" AS "order_day",
            COALESCE("r"."points_reversed", 0) AS "points_reversed",
            COALESCE("r"."refunded_amount", (0)::numeric) AS "refunded_amount",
            "c"."order_total",
            "row_number"() OVER (PARTITION BY "c"."shopify_customer_id" ORDER BY COALESCE("o"."created_at_shop", "c"."created_at"), "c"."shopify_order_id") AS "rn",
            "count"(*) OVER (PARTITION BY "c"."shopify_customer_id") AS "n_ordini"
           FROM (("public"."loyalty_order_credits" "c"
             LEFT JOIN "public"."shopify_orders" "o" ON (("o"."order_id" = "c"."order_name")))
             LEFT JOIN "public"."loyalty_order_reversals" "r" ON (("r"."shopify_order_id" = "c"."shopify_order_id")))
        )
 SELECT "f"."shopify_customer_id",
    "f"."n_ordini",
    "f"."shopify_order_id" AS "first_order_id",
    "f"."order_name" AS "first_order_name",
    "f"."order_at" AS "first_order_at",
    ("f"."order_day" + 90) AS "deadline",
    "s"."shopify_order_id" AS "second_order_id",
    "s"."order_name" AS "second_order_name",
    "s"."order_at" AS "second_order_at",
    "s"."points" AS "second_points",
    "s"."points_reversed" AS "second_points_reversed",
    (("s"."shopify_order_id" IS NOT NULL) AND COALESCE((("s"."points_reversed" >= "s"."points") OR (("s"."order_total" > (0)::numeric) AND ("s"."refunded_amount" >= "s"."order_total"))), false)) AS "second_fully_refunded",
    (("s"."shopify_order_id" IS NOT NULL) AND ("s"."order_day" <= ("f"."order_day" + 90))) AS "entro_90gg",
    "b"."points" AS "bonus_points",
    "b"."points_reversed" AS "bonus_reversed",
    "b"."created_at" AS "bonus_at"
   FROM (("c" "f"
     LEFT JOIN "c" "s" ON ((("s"."shopify_customer_id" = "f"."shopify_customer_id") AND ("s"."rn" = 2))))
     LEFT JOIN "public"."loyalty_bonus_second" "b" ON (("b"."shopify_customer_id" = "f"."shopify_customer_id")))
  WHERE ("f"."rn" = 1);


ALTER VIEW "public"."v_loyalty_second_order" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_loyalty_streaks" WITH ("security_invoker"='true') AS
 WITH "v" AS (
         SELECT "loyalty_visits"."shopify_customer_id",
            "loyalty_visits"."day",
            ("loyalty_visits"."day" - ("row_number"() OVER (PARTITION BY "loyalty_visits"."shopify_customer_id" ORDER BY "loyalty_visits"."day"))::integer) AS "grp"
           FROM "public"."loyalty_visits"
        ), "runs" AS (
         SELECT "v"."shopify_customer_id",
            "v"."grp",
            "count"("v"."day") AS "len",
            "max"("v"."day") AS "fine"
           FROM "v"
          GROUP BY "v"."shopify_customer_id", "v"."grp"
        )
 SELECT "shopify_customer_id",
    "max"("len") AS "streak_massimo",
    COALESCE("max"("len") FILTER (WHERE ("fine" >= (CURRENT_DATE - 1))), (0)::bigint) AS "streak_corrente"
   FROM "runs"
  GROUP BY "shopify_customer_id";


ALTER VIEW "public"."v_loyalty_streaks" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_loyalty_uplift" WITH ("security_invoker"='true') AS
 SELECT
        CASE
            WHEN ("c"."shopify_order_id" IS NOT NULL) THEN 'membro'::"text"
            ELSE 'ospite_o_non_accreditato'::"text"
        END AS "segmento",
    "count"("o"."id") AS "ordini",
    "round"("avg"("o"."gross_total"), 2) AS "scontrino_medio_lordo",
    "round"("sum"("o"."gross_total"), 2) AS "lordo_totale",
    "count"("o"."id") FILTER (WHERE (COALESCE("o"."refund_amount", (0)::numeric) > (0)::numeric)) AS "ordini_con_reso",
    "count"(DISTINCT "o"."email") AS "clienti_distinti_per_email"
   FROM ("public"."shopify_orders" "o"
     LEFT JOIN "public"."loyalty_order_credits" "c" ON (("c"."order_name" = "o"."order_id")))
  WHERE ("o"."financial_status" = ANY (ARRAY['paid'::"text", 'partially_refunded'::"text", 'refunded'::"text"]))
  GROUP BY
        CASE
            WHEN ("c"."shopify_order_id" IS NOT NULL) THEN 'membro'::"text"
            ELSE 'ospite_o_non_accreditato'::"text"
        END;


ALTER VIEW "public"."v_loyalty_uplift" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_margine_ordine" AS
 WITH "li" AS (
         SELECT "shopify_line_items"."order_id",
            "sum"("shopify_line_items"."quantita") AS "pezzi",
            "sum"(("shopify_line_items"."price" * "shopify_line_items"."quantita")) AS "ricavo_lordo",
            "sum"(("shopify_line_items"."cogs_snapshot" * "shopify_line_items"."quantita")) AS "cogs"
           FROM "public"."shopify_line_items"
          GROUP BY "shopify_line_items"."order_id"
        )
 SELECT "o"."order_id",
    "o"."order_number",
    "o"."created_at_shop",
    "o"."year",
    "o"."month",
    "li"."pezzi",
    "round"("li"."ricavo_lordo", 2) AS "ricavo_lordo",
    "round"("o"."discount_total", 2) AS "sconto",
    "round"((("li"."ricavo_lordo" - "o"."discount_total") / 1.22), 2) AS "ricavo_netto",
    "round"("li"."cogs", 2) AS "cogs",
    "round"((- "o"."payment_fees"), 2) AS "commissioni",
    "round"(((3.71 * "li"."pezzi") + 1.00), 2) AS "packaging",
    "round"((COALESCE("o"."shipping_total", (0)::numeric) + COALESCE("o"."free_shipping_amt", (0)::numeric)), 2) AS "spedizione_incassata",
    "round"(COALESCE("o"."refund_amount", (0)::numeric), 2) AS "rimborso",
    "round"((((((("li"."ricavo_lordo" - "o"."discount_total") / 1.22) - "li"."cogs") - (- "o"."payment_fees")) - ((3.71 * "li"."pezzi") + 1.00)) - (COALESCE("o"."refund_amount", (0)::numeric) / 1.22)), 2) AS "margine_contribuzione",
    "round"(
        CASE
            WHEN (("li"."ricavo_lordo" - "o"."discount_total") <> (0)::numeric) THEN (((((((("li"."ricavo_lordo" - "o"."discount_total") / 1.22) - "li"."cogs") - (- "o"."payment_fees")) - ((3.71 * "li"."pezzi") + 1.00)) - (COALESCE("o"."refund_amount", (0)::numeric) / 1.22)) / (("li"."ricavo_lordo" - "o"."discount_total") / 1.22)) * (100)::numeric)
            ELSE NULL::numeric
        END, 2) AS "margine_pct",
    (COALESCE("o"."refund_amount", (0)::numeric) > (0)::numeric) AS "refunded",
    "o"."financial_status"
   FROM ("public"."shopify_orders" "o"
     JOIN "li" ON (("li"."order_id" = "o"."order_id")));


ALTER VIEW "public"."v_margine_ordine" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_margine_ordine" IS 'Profitto per ordine online (brief A4). Il rimborso e IVA-inclusivo e viene sottratto dal ricavo netto, MAI dal cogs (returns e vuota: non sappiamo se la merce e rientrata). Spedizione incassata esposta ma fuori dal margine. Nessun dato personale del cliente per scelta (l app principale legge in anon).';



CREATE OR REPLACE VIEW "public"."v_margine_sku" AS
 WITH "ord_val" AS (
         SELECT "shopify_line_items"."order_id",
            "sum"(("shopify_line_items"."price" * "shopify_line_items"."quantita")) AS "valore_ordine"
           FROM "public"."shopify_line_items"
          GROUP BY "shopify_line_items"."order_id"
        ), "riga" AS (
         SELECT "l"."codice_norm",
            "l"."year",
            "l"."month",
            'online'::"text" AS "canale",
            "l"."quantita" AS "pezzi",
            ("l"."price" * "l"."quantita") AS "ricavo_lordo",
            ("o"."discount_total" * "q"."quota") AS "sconto",
            ((- "o"."payment_fees") * "q"."quota") AS "commissioni",
            ((3.71 * "l"."quantita") + (1.00 * "q"."quota")) AS "packaging",
            ("l"."cogs_snapshot" * "l"."quantita") AS "cogs",
                CASE
                    WHEN ("o"."refund_amount" > (0)::numeric) THEN "l"."quantita"
                    ELSE (0)::numeric
                END AS "pezzi_rimborsati"
           FROM ((("public"."shopify_line_items" "l"
             JOIN "public"."shopify_orders" "o" ON (("o"."order_id" = "l"."order_id")))
             JOIN "ord_val" "ov" ON (("ov"."order_id" = "l"."order_id")))
             CROSS JOIN LATERAL ( SELECT
                        CASE
                            WHEN ("ov"."valore_ordine" > (0)::numeric) THEN (("l"."price" * "l"."quantita") / "ov"."valore_ordine")
                            ELSE (0)::numeric
                        END AS "quota") "q")
          WHERE ("l"."year" IS NOT NULL)
        UNION ALL
         SELECT "s"."codice_norm",
            "s"."year",
            "s"."month",
            'offline'::"text" AS "text",
            "s"."quantita",
            "s"."prezzo",
            (0)::numeric AS "numeric",
            (0)::numeric AS "numeric",
            (3.71 * "s"."quantita"),
            ("s"."cogs" * "s"."quantita"),
            (0)::numeric AS "numeric"
           FROM "public"."qromo_sales" "s"
          WHERE ("s"."year" IS NOT NULL)
        ), "agg" AS (
         SELECT "riga"."codice_norm",
            "riga"."year",
            "riga"."month",
            "riga"."canale",
            "sum"("riga"."pezzi") AS "pezzi",
            "sum"("riga"."ricavo_lordo") AS "ricavo_lordo",
            "sum"("riga"."sconto") AS "sconto",
            "sum"("riga"."commissioni") AS "commissioni",
            "sum"("riga"."packaging") AS "packaging",
            "sum"("riga"."cogs") AS "cogs",
            "sum"("riga"."pezzi_rimborsati") AS "pezzi_in_ordini_rimborsati"
           FROM "riga"
          GROUP BY "riga"."codice_norm", "riga"."year", "riga"."month", "riga"."canale"
        )
 SELECT COALESCE("p"."codice", "a"."codice_norm") AS "codice",
    "a"."codice_norm",
    "p"."item",
    "p"."variant",
    "a"."year",
    "a"."month",
    "a"."canale",
    "a"."pezzi",
    "round"("a"."ricavo_lordo", 2) AS "ricavo_lordo",
    "round"("a"."sconto", 2) AS "sconto",
    "round"((("a"."ricavo_lordo" - "a"."sconto") / 1.22), 2) AS "ricavo_netto",
    "round"("a"."cogs", 2) AS "cogs",
    "round"("a"."commissioni", 2) AS "commissioni",
    "round"("a"."packaging", 2) AS "packaging",
    "round"(((((("a"."ricavo_lordo" - "a"."sconto") / 1.22) - "a"."cogs") - "a"."commissioni") - "a"."packaging"), 2) AS "margine_contribuzione",
    "round"(
        CASE
            WHEN (("a"."ricavo_lordo" - "a"."sconto") <> (0)::numeric) THEN ((((((("a"."ricavo_lordo" - "a"."sconto") / 1.22) - "a"."cogs") - "a"."commissioni") - "a"."packaging") / (("a"."ricavo_lordo" - "a"."sconto") / 1.22)) * (100)::numeric)
            ELSE NULL::numeric
        END, 2) AS "margine_pct",
    "a"."pezzi_in_ordini_rimborsati"
   FROM ("agg" "a"
     LEFT JOIN "public"."products" "p" ON (("p"."codice_norm" = "a"."codice_norm")));


ALTER VIEW "public"."v_margine_sku" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_margine_sku" IS 'Contribution margin per codice x anno x mese x canale (brief A4). Costi POSITIVI, margine = ricavo_netto - cogs - commissioni - packaging. Offline: prezzo e il TOTALE riga, cogs e per unita (stesso quirk di gifts_offline). Spedizione esclusa; rimborsi NON allocati alla riga. Riconciliazione col CE in amimi-app/docs/SCHEMA.md.';



CREATE OR REPLACE VIEW "public"."v_mat_acquisti" WITH ("security_invoker"='on') AS
 SELECT "l"."id" AS "line_id",
    "r"."id" AS "order_id",
    "r"."supplier_id",
    "s"."nome" AS "fornitore",
    "r"."tipo_documento",
    "r"."numero_documento",
    "r"."data_documento",
    "r"."valuta",
    "r"."stato",
    "r"."totale_imponibile",
    "r"."totale_iva",
    "r"."totale_documento",
    "r"."condizioni_pagamento",
    "i"."id" AS "item_id",
    "i"."categoria",
    "i"."materiale",
    "i"."colore",
    "l"."quantita",
    "l"."unita",
    "l"."prezzo_unitario",
    "l"."sconto_text",
    "l"."importo",
    "l"."iva_percent",
    "l"."note"
   FROM ((("public"."mat_order_lines" "l"
     JOIN "public"."mat_orders" "r" ON (("r"."id" = "l"."order_id")))
     JOIN "public"."mat_suppliers" "s" ON (("s"."id" = "r"."supplier_id")))
     JOIN "public"."mat_items" "i" ON (("i"."id" = "l"."item_id")));


ALTER VIEW "public"."v_mat_acquisti" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_mat_assets" WITH ("security_invoker"='on') AS
 SELECT "x"."id",
    "x"."supplier_id",
    "x"."item_id",
    "x"."materiale",
    "x"."order_id",
    "x"."path",
    "x"."tipo",
    "x"."titolo",
    "x"."mime",
    "x"."bytes",
    "x"."fonte",
    "x"."chi",
    "x"."created_at",
    "s"."nome" AS "fornitore",
    "i"."materiale" AS "item_materiale",
    "i"."colore" AS "item_colore",
    "r"."numero_documento" AS "ordine_documento"
   FROM ((("public"."mat_assets" "x"
     JOIN "public"."mat_suppliers" "s" ON (("s"."id" = "x"."supplier_id")))
     LEFT JOIN "public"."mat_items" "i" ON (("i"."id" = "x"."item_id")))
     LEFT JOIN "public"."mat_orders" "r" ON (("r"."id" = "x"."order_id")));


ALTER VIEW "public"."v_mat_assets" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_mat_catalogo" WITH ("security_invoker"='on') AS
 SELECT "i"."id" AS "item_id",
    "i"."supplier_id",
    "s"."nome" AS "fornitore",
    "i"."categoria",
    "i"."materiale",
    "i"."articolo_fornitore",
    "i"."colore",
    "i"."unita",
    "i"."attivo",
    "i"."note",
    "o"."id" AS "offerta_id",
    "o"."tipo" AS "offerta_tipo",
    "o"."prezzo" AS "offerta_prezzo",
    "o"."prezzo_text" AS "offerta_prezzo_text",
    "o"."unita" AS "offerta_unita",
    "o"."disponibilita",
    "o"."min_ordine",
    "o"."lead_time",
    "o"."data" AS "offerta_data",
    "o"."documento_fonte" AS "offerta_fonte",
    "a"."numero_documento" AS "acquisto_documento",
    "a"."data_documento" AS "acquisto_data",
    "a"."quantita" AS "acquisto_quantita",
    "a"."unita" AS "acquisto_unita",
    "a"."prezzo_unitario" AS "acquisto_prezzo",
    "a"."importo" AS "acquisto_importo",
    ("a"."line_id" IS NOT NULL) AS "acquistato",
    COALESCE("a"."prezzo_unitario", "o"."prezzo") AS "prezzo_rif",
        CASE
            WHEN ("a"."prezzo_unitario" IS NOT NULL) THEN NULL::"text"
            ELSE "o"."prezzo_text"
        END AS "prezzo_rif_text",
    COALESCE("a"."unita", "o"."unita", "i"."unita") AS "unita_rif",
    "f"."foto_path",
    "f"."n_foto",
    "f"."n_schede",
    "s"."condizioni_pagamento",
    "s"."deposito_luogo",
    "s"."email" AS "fornitore_email",
    "s"."telefono" AS "fornitore_telefono",
    "s"."referente" AS "fornitore_referente"
   FROM (((("public"."mat_items" "i"
     JOIN "public"."mat_suppliers" "s" ON (("s"."id" = "i"."supplier_id")))
     LEFT JOIN LATERAL ( SELECT "x"."id",
            "x"."item_id",
            "x"."tipo",
            "x"."prezzo",
            "x"."prezzo_text",
            "x"."valuta",
            "x"."unita",
            "x"."disponibilita",
            "x"."min_ordine",
            "x"."lead_time",
            "x"."data",
            "x"."documento_fonte",
            "x"."note",
            "x"."chi",
            "x"."created_at"
           FROM "public"."mat_offers" "x"
          WHERE ("x"."item_id" = "i"."id")
          ORDER BY "x"."data" DESC NULLS LAST, "x"."created_at" DESC
         LIMIT 1) "o" ON (true))
     LEFT JOIN LATERAL ( SELECT "l"."id" AS "line_id",
            "l"."quantita",
            "l"."unita",
            "l"."prezzo_unitario",
            "l"."importo",
            "r"."numero_documento",
            "r"."data_documento"
           FROM ("public"."mat_order_lines" "l"
             JOIN "public"."mat_orders" "r" ON (("r"."id" = "l"."order_id")))
          WHERE (("l"."item_id" = "i"."id") AND ("r"."stato" <> 'annullato'::"text"))
          ORDER BY "r"."data_documento" DESC NULLS LAST, "l"."created_at" DESC
         LIMIT 1) "a" ON (true))
     LEFT JOIN LATERAL ( SELECT "count"(*) FILTER (WHERE ("x"."tipo" = 'foto'::"text")) AS "n_foto",
            "count"(*) FILTER (WHERE ("x"."tipo" = ANY (ARRAY['scheda_tecnica'::"text", 'documento'::"text"]))) AS "n_schede",
            ("array_agg"("x"."path" ORDER BY COALESCE(("x"."item_id" = "i"."id"), false) DESC, "x"."created_at") FILTER (WHERE ("x"."tipo" = 'foto'::"text")))[1] AS "foto_path"
           FROM "public"."mat_assets" "x"
          WHERE (("x"."item_id" = "i"."id") OR (("x"."item_id" IS NULL) AND ("x"."order_id" IS NULL) AND ("x"."supplier_id" = "i"."supplier_id") AND ("lower"(COALESCE("x"."materiale", ''::"text")) = "lower"("i"."materiale"))))) "f" ON (true));


ALTER VIEW "public"."v_mat_catalogo" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_mat_fornitori" WITH ("security_invoker"='on') AS
 SELECT "id",
    "nome",
    "ragione_sociale",
    "categoria_principale",
    "email",
    "telefono",
    "referente",
    "indirizzo",
    "piva_vat",
    "deposito_luogo",
    "condizioni_pagamento",
    "note",
    "attivo",
    "core_supplier_id",
    "chi",
    "created_at",
    "updated_at",
    ( SELECT "count"(*) AS "count"
           FROM "public"."mat_items" "i"
          WHERE (("i"."supplier_id" = "s"."id") AND "i"."attivo")) AS "n_materiali",
    ( SELECT "string_agg"(DISTINCT "i"."categoria", ', '::"text" ORDER BY "i"."categoria") AS "string_agg"
           FROM "public"."mat_items" "i"
          WHERE (("i"."supplier_id" = "s"."id") AND "i"."attivo")) AS "categorie",
    ( SELECT "count"(*) AS "count"
           FROM ("public"."mat_offers" "o"
             JOIN "public"."mat_items" "i" ON (("i"."id" = "o"."item_id")))
          WHERE ("i"."supplier_id" = "s"."id")) AS "n_offerte",
    ( SELECT "count"(*) AS "count"
           FROM "public"."mat_orders" "r"
          WHERE (("r"."supplier_id" = "s"."id") AND ("r"."stato" <> 'annullato'::"text"))) AS "n_ordini",
    ( SELECT "round"("sum"("r"."totale_imponibile"), 2) AS "round"
           FROM "public"."mat_orders" "r"
          WHERE (("r"."supplier_id" = "s"."id") AND ("r"."stato" <> 'annullato'::"text"))) AS "tot_imponibile",
    ( SELECT "max"("r"."data_documento") AS "max"
           FROM "public"."mat_orders" "r"
          WHERE (("r"."supplier_id" = "s"."id") AND ("r"."stato" <> 'annullato'::"text"))) AS "ultimo_acquisto",
    ( SELECT "count"(*) AS "count"
           FROM "public"."mat_assets" "x"
          WHERE ("x"."supplier_id" = "s"."id")) AS "n_asset"
   FROM "public"."mat_suppliers" "s";


ALTER VIEW "public"."v_mat_fornitori" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_mat_settings" AS
 SELECT "key",
    "value"
   FROM "public"."app_flags"
  WHERE ("key" = ANY (ARRAY['mat_enabled'::"text", 'mat_write_enabled'::"text", 'ai_compila_enabled'::"text"]));


ALTER VIEW "public"."v_mat_settings" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_movimenti_14gg" AS
 WITH "off" AS (
         SELECT COALESCE("sum"("qromo_sales"."quantita") FILTER (WHERE (("qromo_sales"."data" >= (CURRENT_DATE - 13)) AND ("qromo_sales"."data" <= CURRENT_DATE))), (0)::numeric) AS "u14",
            COALESCE("sum"(("qromo_sales"."prezzo" * "qromo_sales"."quantita")) FILTER (WHERE (("qromo_sales"."data" >= (CURRENT_DATE - 13)) AND ("qromo_sales"."data" <= CURRENT_DATE))), (0)::numeric) AS "g14",
            COALESCE("sum"("qromo_sales"."quantita") FILTER (WHERE (("qromo_sales"."data" >= (CURRENT_DATE - 27)) AND ("qromo_sales"."data" <= (CURRENT_DATE - 14)))), (0)::numeric) AS "u28",
            COALESCE("sum"(("qromo_sales"."prezzo" * "qromo_sales"."quantita")) FILTER (WHERE (("qromo_sales"."data" >= (CURRENT_DATE - 27)) AND ("qromo_sales"."data" <= (CURRENT_DATE - 14)))), (0)::numeric) AS "g28"
           FROM "public"."qromo_sales"
        ), "onl" AS (
         SELECT COALESCE("sum"("li"."quantita") FILTER (WHERE ((("o"."created_at_shop")::"date" >= (CURRENT_DATE - 13)) AND (("o"."created_at_shop")::"date" <= CURRENT_DATE))), (0)::numeric) AS "u14",
            COALESCE("sum"(("li"."price" * "li"."quantita")) FILTER (WHERE ((("o"."created_at_shop")::"date" >= (CURRENT_DATE - 13)) AND (("o"."created_at_shop")::"date" <= CURRENT_DATE))), (0)::numeric) AS "g14",
            COALESCE("sum"("li"."quantita") FILTER (WHERE ((("o"."created_at_shop")::"date" >= (CURRENT_DATE - 27)) AND (("o"."created_at_shop")::"date" <= (CURRENT_DATE - 14)))), (0)::numeric) AS "u28",
            COALESCE("sum"(("li"."price" * "li"."quantita")) FILTER (WHERE ((("o"."created_at_shop")::"date" >= (CURRENT_DATE - 27)) AND (("o"."created_at_shop")::"date" <= (CURRENT_DATE - 14)))), (0)::numeric) AS "g28"
           FROM ("public"."shopify_line_items" "li"
             JOIN "public"."shopify_orders" "o" USING ("order_id"))
        ), "ordc" AS (
         SELECT "count"(*) FILTER (WHERE ((("shopify_orders"."created_at_shop")::"date" >= (CURRENT_DATE - 13)) AND (("shopify_orders"."created_at_shop")::"date" <= CURRENT_DATE))) AS "o14",
            "count"(*) FILTER (WHERE ((("shopify_orders"."created_at_shop")::"date" >= (CURRENT_DATE - 27)) AND (("shopify_orders"."created_at_shop")::"date" <= (CURRENT_DATE - 14)))) AS "o28"
           FROM "public"."shopify_orders"
        ), "mov" AS (
         SELECT ( SELECT "count"(*) FILTER (WHERE ((COALESCE("supplier_orders"."data_ordine", ("supplier_orders"."created_at")::"date") >= (CURRENT_DATE - 13)) AND (COALESCE("supplier_orders"."data_ordine", ("supplier_orders"."created_at")::"date") <= CURRENT_DATE))) AS "count"
                   FROM "public"."supplier_orders") AS "sup_new14",
            ( SELECT "count"(*) FILTER (WHERE (("supplier_orders"."data_ultimo_arrivo" >= (CURRENT_DATE - 13)) AND ("supplier_orders"."data_ultimo_arrivo" <= CURRENT_DATE))) AS "count"
                   FROM "public"."supplier_orders") AS "sup_arr14",
            ( SELECT "count"(*) FILTER (WHERE (COALESCE("supplier_orders"."qty_arrived", (0)::numeric) < COALESCE("supplier_orders"."qty_ordered", (0)::numeric))) AS "count"
                   FROM "public"."supplier_orders") AS "sup_open",
            ( SELECT "count"(*) FILTER (WHERE (("returns"."data" >= (CURRENT_DATE - 13)) AND ("returns"."data" <= CURRENT_DATE))) AS "count"
                   FROM "public"."returns") AS "ret14",
            ( SELECT "count"(*) FILTER (WHERE (("returns"."data" >= (CURRENT_DATE - 27)) AND ("returns"."data" <= (CURRENT_DATE - 14)))) AS "count"
                   FROM "public"."returns") AS "ret28"
        ), "cat" AS (
         SELECT ( SELECT "count"(DISTINCT "shopify_stock"."codice") AS "count"
                   FROM "public"."shopify_stock"
                  WHERE ("shopify_stock"."shopify_status" = 'active'::"text")) AS "live",
            ( SELECT "count"(DISTINCT "shopify_stock"."codice") AS "count"
                   FROM "public"."shopify_stock"
                  WHERE ("shopify_stock"."shopify_status" = 'draft'::"text")) AS "draft",
            ( SELECT "count"(DISTINCT "shopify_stock"."codice") AS "count"
                   FROM "public"."shopify_stock"
                  WHERE (("shopify_stock"."shopify_status" = 'active'::"text") AND (COALESCE("shopify_stock"."shopify_qty", (0)::numeric) = (0)::numeric))) AS "soldout"
        )
 SELECT "off"."u14" AS "off_pezzi14",
    "off"."g14" AS "off_lordo14",
    "off"."u28" AS "off_pezzi28",
    "off"."g28" AS "off_lordo28",
    "onl"."u14" AS "on_pezzi14",
    "onl"."g14" AS "on_lordo14",
    "onl"."u28" AS "on_pezzi28",
    "onl"."g28" AS "on_lordo28",
    ("off"."u14" + "onl"."u14") AS "pezzi14",
    ("off"."u28" + "onl"."u28") AS "pezzi28",
    ("off"."g14" + "onl"."g14") AS "lordo14",
    ("off"."g28" + "onl"."g28") AS "lordo28",
    "round"((("off"."g14" + "onl"."g14") / 1.22), 2) AS "netto14",
    "round"((("off"."g28" + "onl"."g28") / 1.22), 2) AS "netto28",
    "ordc"."o14" AS "ordini14",
    "ordc"."o28" AS "ordini28",
        CASE
            WHEN ("ordc"."o14" > 0) THEN "round"((("off"."g14" + "onl"."g14") / ("ordc"."o14")::numeric), 2)
            ELSE NULL::numeric
        END AS "aov_lordo14",
    "mov"."sup_new14",
    "mov"."sup_arr14",
    "mov"."sup_open",
    "mov"."ret14",
    "mov"."ret28",
    "cat"."live",
    "cat"."draft",
    "cat"."soldout"
   FROM "off",
    "onl",
    "ordc",
    "mov",
    "cat";


ALTER VIEW "public"."v_movimenti_14gg" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ops_flags" AS
 SELECT ( SELECT "app_flags"."value"
           FROM "public"."app_flags"
          WHERE ("app_flags"."key" = 'shopify_write_enabled'::"text")) AS "shopify_write_enabled",
    ( SELECT "app_flags"."value"
           FROM "public"."app_flags"
          WHERE ("app_flags"."key" = 'shopify_autopush_enabled'::"text")) AS "shopify_autopush_enabled",
    ( SELECT "app_flags"."value"
           FROM "public"."app_flags"
          WHERE ("app_flags"."key" = 'shopify_hold_raises'::"text")) AS "shopify_hold_raises",
    ( SELECT "app_flags"."value"
           FROM "public"."app_flags"
          WHERE ("app_flags"."key" = 'shopify_expose_buffer'::"text")) AS "shopify_expose_buffer",
    ( SELECT "app_config"."ai_enabled"
           FROM "public"."app_config"
          WHERE ("app_config"."id" = 1)) AS "ai_enabled";


ALTER VIEW "public"."v_ops_flags" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ordini_arrivo" AS
 SELECT "o"."id",
    "o"."gruppo",
    "o"."codice",
    "o"."item",
    "o"."variant",
    "o"."fornitore",
    "o"."qty_ordered",
    "o"."qty_arrived",
    (COALESCE("o"."qty_ordered", (0)::numeric) - COALESCE("o"."qty_arrived", (0)::numeric)) AS "mancano",
        CASE
            WHEN "o"."wip" THEN (COALESCE("o"."qty_arrived", (0)::numeric) > (0)::numeric)
            ELSE (COALESCE("o"."qty_arrived", (0)::numeric) >= COALESCE("o"."qty_ordered", (0)::numeric))
        END AS "completo",
    "o"."nuovo_riordino",
    "o"."costo_unitario",
    "o"."data_consegna",
    "o"."data_ordine",
    "o"."data_ultimo_arrivo",
    "o"."note",
    COALESCE("p"."image_url", "ss"."image_url") AS "image_url",
    "o"."wip",
    COALESCE("o"."data_consegna", "o"."data_ultimo_arrivo") AS "data_consegna_display"
   FROM (("public"."supplier_orders" "o"
     LEFT JOIN "public"."products" "p" ON (("p"."codice_norm" = "upper"("regexp_replace"(COALESCE("o"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")))))
     LEFT JOIN ( SELECT "upper"("regexp_replace"(COALESCE("shopify_stock"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) AS "codice_norm",
            "max"("shopify_stock"."image_url") AS "image_url"
           FROM "public"."shopify_stock"
          GROUP BY ("upper"("regexp_replace"(COALESCE("shopify_stock"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")))) "ss" ON (("ss"."codice_norm" = "upper"("regexp_replace"(COALESCE("o"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")))));


ALTER VIEW "public"."v_ordini_arrivo" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_products_to_publish" AS
 WITH "shop" AS (
         SELECT "upper"("regexp_replace"("shopify_stock"."codice", '\s+'::"text", '_'::"text", 'g'::"text")) AS "codice_norm"
           FROM "public"."shopify_stock"
          WHERE ("shopify_stock"."synced_at" >= (( SELECT COALESCE("max"("shopify_stock_1"."synced_at"), "now"()) AS "coalesce"
                   FROM "public"."shopify_stock" "shopify_stock_1") - '02:00:00'::interval))
        ), "self" AS (
         SELECT "p"."id",
            "p"."codice",
            "p"."codice_norm",
            "p"."is_finalized",
            "p"."model",
            "p"."variant",
            "p"."item",
            "p"."categoria",
            "p"."shopify_name",
            "p"."shopify_sku",
            "p"."retail_price",
            "p"."cogs",
            "p"."description",
            "p"."seo_title",
            "p"."image_url",
            "p"."status",
            "p"."notes",
            "p"."source",
            "p"."chi",
            "p"."created_at",
            "p"."updated_at",
            "p"."verificato",
            "p"."riordino_archiviato",
            "upper"("regexp_replace"(COALESCE("p"."model", "p"."item", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) AS "model_key"
           FROM "public"."products" "p"
        ), "nm" AS (
         SELECT "s"."id",
            "s"."codice",
            "s"."codice_norm",
            "s"."is_finalized",
            "s"."model",
            "s"."variant",
            "s"."item",
            "s"."categoria",
            "s"."shopify_name",
            "s"."shopify_sku",
            "s"."retail_price",
            "s"."cogs",
            "s"."description",
            "s"."seo_title",
            "s"."image_url",
            "s"."status",
            "s"."notes",
            "s"."source",
            "s"."chi",
            "s"."created_at",
            "s"."updated_at",
            "s"."verificato",
            "s"."riordino_archiviato",
            "s"."model_key",
                CASE
                    WHEN ("s"."model_key" = ''::"text") THEN true
                    ELSE (NOT (EXISTS ( SELECT 1
                       FROM "public"."products" "o"
                      WHERE (("o"."codice" <> "s"."codice") AND ("o"."verificato" = true) AND ("upper"("regexp_replace"(COALESCE("o"."model", "o"."item", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) = "s"."model_key")))))
                END AS "is_new_model"
           FROM "self" "s"
        )
 SELECT "n"."codice",
    "n"."item",
    "n"."variant",
    "n"."model",
    ("m"."model" IS NOT NULL) AS "modello_censito",
    "m"."categoria",
    "m"."product_type",
    "m"."template_suffix",
    "m"."collections",
    "n"."retail_price",
    "n"."cogs",
    "n"."image_url",
    "n"."description",
    "n"."seo_title",
    "n"."is_new_model",
    COALESCE("i"."disponibili_da_vendere", (0)::numeric) AS "disponibili_da_vendere",
    (COALESCE("i"."disponibili_da_vendere", (0)::numeric) > (0)::numeric) AS "pronto_stock"
   FROM (("nm" "n"
     LEFT JOIN "public"."v_inventory" "i" ON (("i"."codice" = "n"."codice")))
     LEFT JOIN "public"."models" "m" ON (("m"."model_norm" = "n"."model_key")))
  WHERE (("n"."source" = 'app-ordine'::"text") AND (COALESCE(TRIM(BOTH FROM "n"."item"), ''::"text") <> ''::"text") AND (COALESCE(TRIM(BOTH FROM "n"."variant"), ''::"text") <> ''::"text") AND (COALESCE("n"."retail_price", (0)::numeric) > (0)::numeric) AND (COALESCE("n"."cogs", (0)::numeric) > (0)::numeric) AND (COALESCE(TRIM(BOTH FROM "n"."image_url"), ''::"text") <> ''::"text") AND ((NOT "n"."is_new_model") OR (COALESCE(TRIM(BOTH FROM "n"."description"), ''::"text") <> ''::"text")) AND ("n"."codice" !~ '_$'::"text") AND (NOT (EXISTS ( SELECT 1
           FROM "shop" "sh"
          WHERE ("sh"."codice_norm" = "n"."codice_norm")))));


ALTER VIEW "public"."v_products_to_publish" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_reorder" AS
 WITH "sold60" AS (
         SELECT "s_1"."codice_norm",
            "sum"("s_1"."q") AS "q"
           FROM ( SELECT "qromo_sales"."codice_norm",
                    "qromo_sales"."quantita" AS "q"
                   FROM "public"."qromo_sales"
                  WHERE ("qromo_sales"."data" >= (CURRENT_DATE - 60))
                UNION ALL
                 SELECT "li"."codice_norm",
                    "li"."quantita"
                   FROM ("public"."shopify_line_items" "li"
                     JOIN "public"."shopify_orders" "o" ON (("o"."order_id" = "li"."order_id")))
                  WHERE ("o"."created_at_shop" >= (CURRENT_DATE - 60))
                UNION ALL
                 SELECT "b2b_movements"."codice_norm",
                    "b2b_movements"."quantita"
                   FROM "public"."b2b_movements"
                  WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND ("b2b_movements"."data" >= (CURRENT_DATE - 60)))) "s_1"
          GROUP BY "s_1"."codice_norm"
        ), "arrivo" AS (
         SELECT "upper"("regexp_replace"(COALESCE("supplier_orders"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) AS "codice_norm",
            "sum"(GREATEST((COALESCE("supplier_orders"."qty_ordered", (0)::numeric) - COALESCE("supplier_orders"."qty_arrived", (0)::numeric)), (0)::numeric)) AS "q"
           FROM "public"."supplier_orders"
          GROUP BY ("upper"("regexp_replace"(COALESCE("supplier_orders"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")))
        )
 SELECT "i"."codice",
    "i"."item",
    "i"."variant",
    "i"."image_url",
    "i"."giacenza_attuale" AS "giacenza",
    "i"."disponibili_da_vendere" AS "disponibili",
    "i"."on_shopify",
    COALESCE("s"."q", (0)::numeric) AS "venduto_60d",
    COALESCE("a"."q", (0)::numeric) AS "in_arrivo",
        CASE
            WHEN (COALESCE("s"."q", (0)::numeric) > (0)::numeric) THEN "round"(("i"."giacenza_attuale" / ("s"."q" / 60.0)), 0)
            ELSE NULL::numeric
        END AS "giorni_stock",
    COALESCE("p"."riordino_archiviato", false) AS "riordino_archiviato"
   FROM ((("public"."v_inventory" "i"
     LEFT JOIN "public"."products" "p" ON (("p"."codice_norm" = "i"."codice_norm")))
     LEFT JOIN "sold60" "s" ON (("s"."codice_norm" = "i"."codice_norm")))
     LEFT JOIN "arrivo" "a" ON (("a"."codice_norm" = "i"."codice_norm")))
  WHERE ((COALESCE("s"."q", (0)::numeric) > (0)::numeric) OR ("i"."giacenza_attuale" > (0)::numeric));


ALTER VIEW "public"."v_reorder" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_resi_mensile" AS
 SELECT "year",
    "month",
    "canale",
    "count"(*) AS "n",
    "sum"("quantita") AS "pezzi",
    "sum"(COALESCE("importo_rimborsato", (0)::numeric)) AS "importo"
   FROM "public"."returns"
  GROUP BY "year", "month", "canale";


ALTER VIEW "public"."v_resi_mensile" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_sales_anomalie" AS
 WITH "vend" AS (
         SELECT "upper"("li"."codice") AS "codice",
            "sum"("li"."quantita") FILTER (WHERE (("o"."created_at_shop" >= ("now"() - '44 days'::interval)) AND ("o"."created_at_shop" < ("now"() - '14 days'::interval)))) AS "prima_30gg",
            "sum"("li"."quantita") FILTER (WHERE ("o"."created_at_shop" >= ("now"() - '14 days'::interval))) AS "ultimi_14gg"
           FROM ("public"."shopify_line_items" "li"
             JOIN "public"."shopify_orders" "o" ON (("o"."order_id" = "li"."order_id")))
          WHERE (("o"."created_at_shop" >= ("now"() - '44 days'::interval)) AND ("li"."codice" IS NOT NULL))
          GROUP BY ("upper"("li"."codice"))
        ), "med" AS (
         SELECT "percentile_cont"((0.5)::double precision) WITHIN GROUP (ORDER BY (("v_reorder"."venduto_60d")::double precision)) AS "m"
           FROM "public"."v_reorder"
          WHERE ("v_reorder"."venduto_60d" > (0)::numeric)
        )
 SELECT 'best_seller_fermo'::"text" AS "tipo",
    "v"."codice",
    "format"('%s pezzi nei 30gg precedenti, 0 negli ultimi 14, disponibili %s'::"text", "v"."prima_30gg", "i"."disponibili_da_vendere") AS "dettaglio",
    "v"."prima_30gg" AS "valore"
   FROM (("vend" "v"
     JOIN "public"."v_inventory" "i" ON (("upper"("i"."codice") = "v"."codice")))
     CROSS JOIN ( SELECT "alert_rules"."soglia"
           FROM "public"."alert_rules"
          WHERE ("alert_rules"."metrica" = 'sales_best_seller_fermo'::"text")) "r")
  WHERE ((COALESCE("v"."prima_30gg", (0)::numeric) >= "r"."soglia") AND (COALESCE("v"."ultimi_14gg", (0)::numeric) = (0)::numeric) AND ("i"."disponibili_da_vendere" > (0)::numeric))
UNION ALL
 SELECT 'low_stock'::"text" AS "tipo",
    "r2"."codice",
    "format"('%s giorni di stock, venduto_60d %s (mediana %s)'::"text", "r2"."giorni_stock", "r2"."venduto_60d", "round"(("med"."m")::numeric, 1)) AS "dettaglio",
    "r2"."giorni_stock" AS "valore"
   FROM "public"."v_reorder" "r2",
    ("med"
     CROSS JOIN ( SELECT "alert_rules"."soglia"
           FROM "public"."alert_rules"
          WHERE ("alert_rules"."metrica" = 'sales_low_stock'::"text")) "rr")
  WHERE (("r2"."giorni_stock" IS NOT NULL) AND ("r2"."giorni_stock" <= "rr"."soglia") AND (("r2"."venduto_60d")::double precision > "med"."m"))
UNION ALL
 SELECT 'esaurito_pubblicato'::"text" AS "tipo",
    "v_sku_availability"."codice",
    'pubblicato su Shopify ma esaurito'::"text" AS "dettaglio",
    0 AS "valore"
   FROM "public"."v_sku_availability"
  WHERE ("v_sku_availability"."stato" = 'pubblicato_esaurito'::"text")
UNION ALL
 SELECT 'sconto_anomalo'::"text" AS "tipo",
    "s"."cod" AS "codice",
    "format"('%s usi negli ultimi %s giorni (soglia %s)'::"text", "s"."usi", "rs"."finestra_giorni", "rs"."soglia") AS "dettaglio",
    ("s"."usi")::numeric AS "valore"
   FROM (( SELECT "upper"(TRIM(BOTH FROM "o"."discount_codes")) AS "cod",
            "count"(*) AS "usi"
           FROM ("public"."shopify_orders" "o"
             CROSS JOIN ( SELECT "alert_rules"."finestra_giorni"
                   FROM "public"."alert_rules"
                  WHERE ("alert_rules"."metrica" = 'sales_sconto_anomalo'::"text")) "f")
          WHERE (("o"."created_at_shop" >= ("now"() - (("f"."finestra_giorni" || ' days'::"text"))::interval)) AND ("o"."discount_codes" IS NOT NULL) AND (TRIM(BOTH FROM "o"."discount_codes") <> ''::"text"))
          GROUP BY ("upper"(TRIM(BOTH FROM "o"."discount_codes"))), "f"."finestra_giorni") "s"
     CROSS JOIN ( SELECT "alert_rules"."soglia",
            "alert_rules"."finestra_giorni"
           FROM "public"."alert_rules"
          WHERE ("alert_rules"."metrica" = 'sales_sconto_anomalo'::"text")) "rs")
  WHERE (("s"."usi")::numeric > "rs"."soglia");


ALTER VIEW "public"."v_sales_anomalie" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_sconti_codici" AS
 SELECT "o"."year",
    "o"."month",
    "upper"(TRIM(BOTH FROM "o"."discount_codes")) AS "codice",
    "count"(*) AS "ordini",
    "round"("sum"("m"."ricavo_netto"), 2) AS "netto",
    "round"("sum"("m"."sconto"), 2) AS "sconto",
    "round"("sum"("m"."margine_contribuzione"), 2) AS "margine",
    "round"("avg"("m"."margine_pct"), 1) AS "margine_pct_medio"
   FROM ("public"."shopify_orders" "o"
     JOIN "public"."v_margine_ordine" "m" ON (("m"."order_id" = "o"."order_id")))
  WHERE (("o"."discount_codes" IS NOT NULL) AND (TRIM(BOTH FROM "o"."discount_codes") <> ALL (ARRAY[''::"text", '[]'::"text"])))
  GROUP BY "o"."year", "o"."month", ("upper"(TRIM(BOTH FROM "o"."discount_codes")));


ALTER VIEW "public"."v_sconti_codici" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_shopify_align" AS
 SELECT "i"."codice",
    "i"."item",
    "i"."variant",
    "i"."image_url",
    "i"."giacenza_attuale" AS "giacenza",
    "i"."disponibili_da_vendere" AS "disponibili",
    "s"."shopify_qty",
    "s"."synced_at",
    (COALESCE("s"."shopify_qty", (0)::numeric) - COALESCE("i"."disponibili_da_vendere", (0)::numeric)) AS "diff",
    "i"."on_shopify"
   FROM ("public"."v_inventory" "i"
     LEFT JOIN "public"."shopify_stock" "s" ON (("s"."codice" = "i"."codice")))
  WHERE (("i"."on_shopify" = true) OR ("s"."codice" IS NOT NULL));


ALTER VIEW "public"."v_shopify_align" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_shopify_doppioni" AS
 SELECT (( SELECT ("count"(*) - "count"(DISTINCT "shopify_orders"."order_id"))
           FROM "public"."shopify_orders"))::integer AS "ordini_righe_extra",
    (( SELECT "count"(*) AS "count"
           FROM ( SELECT "shopify_line_items"."order_id",
                    "shopify_line_items"."lineitem_name",
                    "shopify_line_items"."price",
                    "shopify_line_items"."quantita"
                   FROM "public"."shopify_line_items"
                  GROUP BY "shopify_line_items"."order_id", "shopify_line_items"."lineitem_name", "shopify_line_items"."price", "shopify_line_items"."quantita"
                 HAVING (("count"(*) > 1) AND ("count"(DISTINCT "shopify_line_items"."shopify_line_id") < "count"(*)))) "g"))::integer AS "gruppi_righe_ripetute",
    (( SELECT "count"(*) AS "count"
           FROM "public"."shopify_orders" "o"
          WHERE (("o"."created_at_shop" >= '2026-07-01 00:00:00+00'::timestamp with time zone) AND (NOT (EXISTS ( SELECT 1
                   FROM "public"."shopify_line_items" "l"
                  WHERE ("l"."order_id" = "o"."order_id")))))))::integer AS "ordini_senza_righe";


ALTER VIEW "public"."v_shopify_doppioni" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_spedizioni_eccezioni" AS
 SELECT "s"."ldv",
    "s"."order_name",
    "s"."stato_tws",
    "s"."stato_raw",
    "s"."shipped_date",
    "s"."seen_delivered_at",
    "s"."updated_at",
    "o"."customer_name",
    ("o"."created_at_shop")::"date" AS "data_ordine",
        CASE
            WHEN ("s"."stato_tws" ~~* '%CONSEGNATA%'::"text") THEN 'consegnata'::"text"
            WHEN ("s"."stato_tws" = ANY (ARRAY['IN TRANSITO'::"text", 'PARTITA'::"text", 'IN PARTENZA TWS'::"text", 'NUOVA'::"text", 'NUOVA REGISTRAZIONE'::"text", 'IN ATTESA DI AFFIDO'::"text", 'FERIE'::"text"])) THEN 'in_corso'::"text"
            ELSE 'eccezione'::"text"
        END AS "classe"
   FROM ("public"."shipping_status" "s"
     LEFT JOIN "public"."shopify_orders" "o" ON (("regexp_replace"(COALESCE("o"."order_number", "o"."order_id"), '^#'::"text", ''::"text") = "regexp_replace"(COALESCE("s"."order_name", ''::"text"), '^#'::"text", ''::"text"))));


ALTER VIEW "public"."v_spedizioni_eccezioni" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_stock_drift" AS
 WITH "buf" AS (
         SELECT COALESCE(( SELECT ("app_flags"."value")::integer AS "value"
                   FROM "public"."app_flags"
                  WHERE ("app_flags"."key" = 'shopify_expose_buffer'::"text")), 2) AS "b"
        ), "fresh" AS (
         SELECT DISTINCT "counts"."codice"
           FROM "public"."counts"
          WHERE ("counts"."data_conta" >= (CURRENT_DATE - 30))
        )
 SELECT "ss"."codice",
    "ss"."shopify_title",
    "ss"."shopify_qty",
    (GREATEST((0)::numeric, COALESCE("vi"."disponibili_da_vendere", (0)::numeric)))::integer AS "disponibili",
    ("f"."codice" IS NOT NULL) AS "conta_fresca",
    (
        CASE
            WHEN ("f"."codice" IS NOT NULL) THEN GREATEST((0)::numeric, COALESCE("vi"."disponibili_da_vendere", (0)::numeric))
            ELSE GREATEST((0)::numeric, (COALESCE("vi"."disponibili_da_vendere", (0)::numeric) - (( SELECT "buf"."b"
               FROM "buf"))::numeric))
        END)::integer AS "target_policy",
    ((
        CASE
            WHEN ("f"."codice" IS NOT NULL) THEN GREATEST((0)::numeric, COALESCE("vi"."disponibili_da_vendere", (0)::numeric))
            ELSE GREATEST((0)::numeric, (COALESCE("vi"."disponibili_da_vendere", (0)::numeric) - (( SELECT "buf"."b"
               FROM "buf"))::numeric))
        END - COALESCE("ss"."shopify_qty", (0)::numeric)))::integer AS "delta",
        CASE
            WHEN (
            CASE
                WHEN ("f"."codice" IS NOT NULL) THEN GREATEST((0)::numeric, COALESCE("vi"."disponibili_da_vendere", (0)::numeric))
                ELSE GREATEST((0)::numeric, (COALESCE("vi"."disponibili_da_vendere", (0)::numeric) - (( SELECT "buf"."b"
                   FROM "buf"))::numeric))
            END = COALESCE("ss"."shopify_qty", (0)::numeric)) THEN 'ok'::"text"
            WHEN (
            CASE
                WHEN ("f"."codice" IS NOT NULL) THEN GREATEST((0)::numeric, COALESCE("vi"."disponibili_da_vendere", (0)::numeric))
                ELSE GREATEST((0)::numeric, (COALESCE("vi"."disponibili_da_vendere", (0)::numeric) - (( SELECT "buf"."b"
                   FROM "buf"))::numeric))
            END < COALESCE("ss"."shopify_qty", (0)::numeric)) THEN 'da_abbassare'::"text"
            WHEN ("f"."codice" IS NOT NULL) THEN 'da_alzare'::"text"
            ELSE 'hold_serve_conta'::"text"
        END AS "azione",
    "ss"."synced_at"
   FROM (("public"."shopify_stock" "ss"
     LEFT JOIN "public"."v_inventory" "vi" ON (("vi"."codice" = "ss"."codice")))
     LEFT JOIN "fresh" "f" ON (("f"."codice" = "ss"."codice")));


ALTER VIEW "public"."v_stock_drift" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_vendite_orfane" AS
 SELECT ( SELECT "count"(*) AS "count"
           FROM "public"."shopify_line_items"
          WHERE (("shopify_line_items"."year" IS NULL) OR ("shopify_line_items"."month" IS NULL) OR ("shopify_line_items"."month" < 1) OR ("shopify_line_items"."month" > 12))) AS "shopify",
    ( SELECT "count"(*) AS "count"
           FROM "public"."qromo_sales"
          WHERE (("qromo_sales"."year" IS NULL) OR ("qromo_sales"."month" IS NULL) OR ("qromo_sales"."month" < 1) OR ("qromo_sales"."month" > 12))) AS "qromo",
    ( SELECT "count"(*) AS "count"
           FROM "public"."gifts_offline"
          WHERE (("gifts_offline"."year" IS NULL) OR ("gifts_offline"."month" IS NULL) OR ("gifts_offline"."month" < 1) OR ("gifts_offline"."month" > 12))) AS "gift",
    ( SELECT "count"(*) AS "count"
           FROM "public"."b2b_movements"
          WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")) AND (("b2b_movements"."year" IS NULL) OR ("b2b_movements"."month" IS NULL) OR ("b2b_movements"."month" < 1) OR ("b2b_movements"."month" > 12)))) AS "b2b",
    (((( SELECT "count"(*) AS "count"
           FROM "public"."shopify_line_items"
          WHERE (("shopify_line_items"."year" IS NULL) OR ("shopify_line_items"."month" IS NULL) OR ("shopify_line_items"."month" < 1) OR ("shopify_line_items"."month" > 12))) + ( SELECT "count"(*) AS "count"
           FROM "public"."qromo_sales"
          WHERE (("qromo_sales"."year" IS NULL) OR ("qromo_sales"."month" IS NULL) OR ("qromo_sales"."month" < 1) OR ("qromo_sales"."month" > 12)))) + ( SELECT "count"(*) AS "count"
           FROM "public"."gifts_offline"
          WHERE (("gifts_offline"."year" IS NULL) OR ("gifts_offline"."month" IS NULL) OR ("gifts_offline"."month" < 1) OR ("gifts_offline"."month" > 12)))) + ( SELECT "count"(*) AS "count"
           FROM "public"."b2b_movements"
          WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")) AND (("b2b_movements"."year" IS NULL) OR ("b2b_movements"."month" IS NULL) OR ("b2b_movements"."month" < 1) OR ("b2b_movements"."month" > 12))))) AS "totale";


ALTER VIEW "public"."v_vendite_orfane" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ce_compensi_soci" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ce_compensi_soci_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ce_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ce_snapshots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cs_knowledge" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cs_knowledge_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."health_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."health_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."lead_knowledge" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."lead_knowledge_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."lead_sequences" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."lead_sequences_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."mat_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."mat_events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ai_compila_log"
    ADD CONSTRAINT "ai_compila_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alert_rules"
    ADD CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("metrica");



ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_flags"
    ADD CONSTRAINT "app_flags_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."app_guides"
    ADD CONSTRAINT "app_guides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."b2b_movements"
    ADD CONSTRAINT "b2b_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ce_compensi_soci"
    ADD CONSTRAINT "ce_compensi_soci_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ce_compensi_soci"
    ADD CONSTRAINT "ce_compensi_soci_socio_dal_key" UNIQUE ("socio", "dal");



ALTER TABLE ONLY "public"."ce_snapshots"
    ADD CONSTRAINT "ce_snapshots_ce_year_month_key" UNIQUE ("ce", "year", "month");



ALTER TABLE ONLY "public"."ce_snapshots"
    ADD CONSTRAINT "ce_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ce_totale_manual"
    ADD CONSTRAINT "ce_totale_manual_pkey" PRIMARY KEY ("year", "month");



ALTER TABLE ONLY "public"."ce_totale_monthly"
    ADD CONSTRAINT "ce_totale_monthly_pkey" PRIMARY KEY ("year", "month");



ALTER TABLE ONLY "public"."change_log"
    ADD CONSTRAINT "change_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."counts"
    ADD CONSTRAINT "counts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_conversations"
    ADD CONSTRAINT "cs_conversations_gmail_thread_id_key" UNIQUE ("gmail_thread_id");



ALTER TABLE ONLY "public"."cs_conversations"
    ADD CONSTRAINT "cs_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_drafts"
    ADD CONSTRAINT "cs_drafts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_events"
    ADD CONSTRAINT "cs_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_faq"
    ADD CONSTRAINT "cs_faq_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_knowledge"
    ADD CONSTRAINT "cs_knowledge_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_messages"
    ADD CONSTRAINT "cs_messages_gmail_message_id_key" UNIQUE ("gmail_message_id");



ALTER TABLE ONLY "public"."cs_messages"
    ADD CONSTRAINT "cs_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_sends"
    ADD CONSTRAINT "cs_sends_pkey" PRIMARY KEY ("send_key");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gifts_offline"
    ADD CONSTRAINT "gifts_offline_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."health_log"
    ADD CONSTRAINT "health_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_accounts"
    ADD CONSTRAINT "lead_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_contacts"
    ADD CONSTRAINT "lead_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_drafts"
    ADD CONSTRAINT "lead_drafts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_evidence"
    ADD CONSTRAINT "lead_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_knowledge"
    ADD CONSTRAINT "lead_knowledge_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_reviews"
    ADD CONSTRAINT "lead_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_runs"
    ADD CONSTRAINT "lead_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_scores"
    ADD CONSTRAINT "lead_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_sequences"
    ADD CONSTRAINT "lead_sequences_codice_tocco_key" UNIQUE ("codice", "tocco");



ALTER TABLE ONLY "public"."lead_sequences"
    ADD CONSTRAINT "lead_sequences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_touches"
    ADD CONSTRAINT "lead_touches_gmail_message_id_key" UNIQUE ("gmail_message_id");



ALTER TABLE ONLY "public"."lead_touches"
    ADD CONSTRAINT "lead_touches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_birthday_awards"
    ADD CONSTRAINT "loyalty_birthday_awards_pkey" PRIMARY KEY ("shopify_customer_id", "year");



ALTER TABLE ONLY "public"."loyalty_bonus_second"
    ADD CONSTRAINT "loyalty_bonus_second_pkey" PRIMARY KEY ("shopify_customer_id");



ALTER TABLE ONLY "public"."loyalty_checkin_events"
    ADD CONSTRAINT "loyalty_checkin_events_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."loyalty_checkins"
    ADD CONSTRAINT "loyalty_checkins_pkey" PRIMARY KEY ("event_code", "shopify_customer_id");



ALTER TABLE ONLY "public"."loyalty_events"
    ADD CONSTRAINT "loyalty_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_order_credits"
    ADD CONSTRAINT "loyalty_order_credits_pkey" PRIMARY KEY ("shopify_order_id");



ALTER TABLE ONLY "public"."loyalty_order_reversals"
    ADD CONSTRAINT "loyalty_order_reversals_pkey" PRIMARY KEY ("shopify_order_id");



ALTER TABLE ONLY "public"."loyalty_points"
    ADD CONSTRAINT "loyalty_points_pkey" PRIMARY KEY ("shopify_customer_id");



ALTER TABLE ONLY "public"."loyalty_profiles"
    ADD CONSTRAINT "loyalty_profiles_pkey" PRIMARY KEY ("shopify_customer_id");



ALTER TABLE ONLY "public"."loyalty_redemptions"
    ADD CONSTRAINT "loyalty_redemptions_idemp_key" UNIQUE ("idemp");



ALTER TABLE ONLY "public"."loyalty_redemptions"
    ADD CONSTRAINT "loyalty_redemptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_reward_codes"
    ADD CONSTRAINT "loyalty_reward_codes_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."loyalty_rewards"
    ADD CONSTRAINT "loyalty_rewards_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."loyalty_ugc"
    ADD CONSTRAINT "loyalty_ugc_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_ugc_slots"
    ADD CONSTRAINT "loyalty_ugc_slots_pkey" PRIMARY KEY ("shopify_customer_id", "day");



ALTER TABLE ONLY "public"."loyalty_ui_events"
    ADD CONSTRAINT "loyalty_ui_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_visits"
    ADD CONSTRAINT "loyalty_visits_pkey" PRIMARY KEY ("shopify_customer_id", "day");



ALTER TABLE ONLY "public"."mat_assets"
    ADD CONSTRAINT "mat_assets_path_key" UNIQUE ("path");



ALTER TABLE ONLY "public"."mat_assets"
    ADD CONSTRAINT "mat_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mat_events"
    ADD CONSTRAINT "mat_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mat_items"
    ADD CONSTRAINT "mat_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mat_offers"
    ADD CONSTRAINT "mat_offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mat_order_lines"
    ADD CONSTRAINT "mat_order_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mat_orders"
    ADD CONSTRAINT "mat_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mat_suppliers"
    ADD CONSTRAINT "mat_suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meta_ad_creative"
    ADD CONSTRAINT "meta_ad_creative_pkey" PRIMARY KEY ("ad_id");



ALTER TABLE ONLY "public"."meta_ad_freq7"
    ADD CONSTRAINT "meta_ad_freq7_pkey" PRIMARY KEY ("ad_id");



ALTER TABLE ONLY "public"."meta_ads_creative_daily"
    ADD CONSTRAINT "meta_ads_creative_daily_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meta_ads_creative_daily"
    ADD CONSTRAINT "meta_ads_creative_daily_uk" UNIQUE ("date", "ad_id");



ALTER TABLE ONLY "public"."meta_ads_daily"
    ADD CONSTRAINT "meta_ads_daily_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meta_ads_window_reach"
    ADD CONSTRAINT "meta_ads_window_reach_pkey" PRIMARY KEY ("level", "object_id", "window_key");



ALTER TABLE ONLY "public"."meta_product_set_map"
    ADD CONSTRAINT "meta_product_set_map_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meta_product_set_map"
    ADD CONSTRAINT "meta_product_set_map_uk" UNIQUE ("product_set_id", "retailer_id");



ALTER TABLE ONLY "public"."mimi_state"
    ADD CONSTRAINT "mimi_state_pkey" PRIMARY KEY ("shopify_customer_id");



ALTER TABLE ONLY "public"."models"
    ADD CONSTRAINT "models_pkey" PRIMARY KEY ("model");



ALTER TABLE ONLY "public"."negozi"
    ADD CONSTRAINT "negozi_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."non_product_codici"
    ADD CONSTRAINT "non_product_codici_pkey" PRIMARY KEY ("codice");



ALTER TABLE ONLY "public"."product_aliases"
    ADD CONSTRAINT "product_aliases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_codice_unique" UNIQUE ("codice");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."qromo_sales"
    ADD CONSTRAINT "qromo_sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."returns"
    ADD CONSTRAINT "returns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shipping_status"
    ADD CONSTRAINT "shipping_status_pkey" PRIMARY KEY ("ldv");



ALTER TABLE ONLY "public"."shopify_catalog"
    ADD CONSTRAINT "shopify_catalog_pkey" PRIMARY KEY ("codice");



ALTER TABLE ONLY "public"."shopify_line_items"
    ADD CONSTRAINT "shopify_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shopify_orders"
    ADD CONSTRAINT "shopify_orders_order_id_key" UNIQUE ("order_id");



ALTER TABLE ONLY "public"."shopify_orders"
    ADD CONSTRAINT "shopify_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shopify_stock"
    ADD CONSTRAINT "shopify_stock_pkey" PRIMARY KEY ("codice");



ALTER TABLE ONLY "public"."stock_adjustments"
    ADD CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_orders"
    ADD CONSTRAINT "supplier_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



CREATE INDEX "ai_compila_log_at_idx" ON "public"."ai_compila_log" USING "btree" ("at" DESC);



CREATE INDEX "b2b_codice_idx" ON "public"."b2b_movements" USING "btree" ("codice_norm");



CREATE INDEX "b2b_ym_idx" ON "public"."b2b_movements" USING "btree" ("year", "month");



CREATE INDEX "change_log_tbl_idx" ON "public"."change_log" USING "btree" ("tbl", "ts");



CREATE INDEX "counts_codice_idx" ON "public"."counts" USING "btree" ("codice");



CREATE INDEX "cs_conv_canale_idx" ON "public"."cs_conversations" USING "btree" ("canale");



CREATE INDEX "cs_conv_lastmsg_idx" ON "public"."cs_conversations" USING "btree" ("last_msg_at" DESC);



CREATE INDEX "cs_conv_stato_idx" ON "public"."cs_conversations" USING "btree" ("stato");



CREATE INDEX "cs_msg_conv_idx" ON "public"."cs_messages" USING "btree" ("conversation_id", "sent_at");



CREATE INDEX "cs_sends_conv_idx" ON "public"."cs_sends" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "expenses_cat_idx" ON "public"."expenses" USING "btree" ("categoria");



CREATE INDEX "expenses_ym_idx" ON "public"."expenses" USING "btree" ("year", "month");



CREATE INDEX "gifts_codice_idx" ON "public"."gifts_offline" USING "btree" ("codice_norm");



CREATE INDEX "gifts_ym_idx" ON "public"."gifts_offline" USING "btree" ("year", "month");



CREATE UNIQUE INDEX "health_log_day_k" ON "public"."health_log" USING "btree" ("day", "k");



CREATE INDEX "idx_stock_adjustments_codice_norm" ON "public"."stock_adjustments" USING "btree" ("codice_norm");



CREATE UNIQUE INDEX "lead_accounts_ig_uq" ON "public"."lead_accounts" USING "btree" ("lower"("ig_handle")) WHERE ("ig_handle" IS NOT NULL);



CREATE UNIQUE INDEX "lead_accounts_nome_citta_uq" ON "public"."lead_accounts" USING "btree" ("lower"("nome"), "lower"(COALESCE("citta", ''::"text")));



CREATE UNIQUE INDEX "lead_accounts_place_uq" ON "public"."lead_accounts" USING "btree" ("google_place_id") WHERE ("google_place_id" IS NOT NULL);



CREATE INDEX "lead_accounts_stato_idx" ON "public"."lead_accounts" USING "btree" ("stato_ricerca");



CREATE INDEX "lead_contacts_account_idx" ON "public"."lead_contacts" USING "btree" ("account_id");



CREATE UNIQUE INDEX "lead_contacts_account_email_uq" ON "public"."lead_contacts" USING "btree" ("account_id", "lower"("email")) WHERE ("email" IS NOT NULL);



CREATE UNIQUE INDEX "lead_contacts_account_nome_uq" ON "public"."lead_contacts" USING "btree" ("account_id", "lower"("nome")) WHERE (("email" IS NULL) AND ("nome" IS NOT NULL));



CREATE INDEX "lead_drafts_account_idx" ON "public"."lead_drafts" USING "btree" ("account_id", "created_at" DESC);



CREATE UNIQUE INDEX "lead_drafts_auto_uq" ON "public"."lead_drafts" USING "btree" ("account_id", "sequenza_tocco") WHERE (("origine" = 'auto'::"text") AND ("sequenza_tocco" IS NOT NULL));



CREATE UNIQUE INDEX "lead_drafts_send_key_uq" ON "public"."lead_drafts" USING "btree" ("send_key") WHERE ("send_key" IS NOT NULL);



CREATE UNIQUE INDEX "lead_drafts_tocco_uq" ON "public"."lead_drafts" USING "btree" ("account_id", "sequenza_tocco") WHERE (("stato" = ANY (ARRAY['in_invio'::"text", 'inviata'::"text"])) AND ("sequenza_tocco" IS NOT NULL));



CREATE INDEX "lead_evidence_account_idx" ON "public"."lead_evidence" USING "btree" ("account_id", "tipo", "captured_at" DESC);



CREATE INDEX "lead_reviews_account_idx" ON "public"."lead_reviews" USING "btree" ("account_id", "created_at" DESC);



CREATE INDEX "lead_scores_account_idx" ON "public"."lead_scores" USING "btree" ("account_id", "created_at" DESC);



CREATE INDEX "lead_touches_account_idx" ON "public"."lead_touches" USING "btree" ("account_id", "at" DESC);



CREATE UNIQUE INDEX "lead_touches_tocco_out_uq" ON "public"."lead_touches" USING "btree" ("account_id", "sequenza_tocco") WHERE (("direzione" = 'out'::"text") AND ("canale" = 'email'::"text") AND ("sequenza_tocco" IS NOT NULL));



CREATE INDEX "loyalty_checkins_cust_idx" ON "public"."loyalty_checkins" USING "btree" ("shopify_customer_id");



CREATE UNIQUE INDEX "loyalty_events_birthday_uq" ON "public"."loyalty_events" USING "btree" ("shopify_customer_id", (("meta" ->> 'year'::"text"))) WHERE ("source" = 'birthday'::"text");



CREATE UNIQUE INDEX "loyalty_events_bonus_second_uq" ON "public"."loyalty_events" USING "btree" ("shopify_customer_id") WHERE ("source" = 'bonus_second'::"text");



CREATE INDEX "loyalty_events_cust_created_idx" ON "public"."loyalty_events" USING "btree" ("shopify_customer_id", "created_at" DESC);



CREATE UNIQUE INDEX "loyalty_events_event_checkin_uq" ON "public"."loyalty_events" USING "btree" ("shopify_customer_id", (("meta" ->> 'event'::"text"))) WHERE ("source" = 'event_checkin'::"text");



CREATE UNIQUE INDEX "loyalty_events_profile_complete_uq" ON "public"."loyalty_events" USING "btree" ("shopify_customer_id") WHERE ("source" = 'profile_complete'::"text");



CREATE UNIQUE INDEX "loyalty_events_ugc_uq" ON "public"."loyalty_events" USING "btree" ((("meta" ->> 'ugc'::"text"))) WHERE ("source" = 'ugc'::"text");



CREATE INDEX "loyalty_order_credits_cust_idx" ON "public"."loyalty_order_credits" USING "btree" ("shopify_customer_id");



CREATE INDEX "loyalty_order_credits_name_idx" ON "public"."loyalty_order_credits" USING "btree" ("order_name");



CREATE INDEX "loyalty_redemptions_cust_idx" ON "public"."loyalty_redemptions" USING "btree" ("shopify_customer_id");



CREATE INDEX "loyalty_reward_codes_free_idx" ON "public"."loyalty_reward_codes" USING "btree" ("reward_key") WHERE ("claimed_by" IS NULL);



CREATE UNIQUE INDEX "loyalty_reward_codes_redemption_uq" ON "public"."loyalty_reward_codes" USING "btree" ("redemption_id") WHERE ("redemption_id" IS NOT NULL);



CREATE UNIQUE INDEX "loyalty_ugc_borsa_uq" ON "public"."loyalty_ugc" USING "btree" ("shopify_customer_id", "kind", "codice") WHERE ("status" <> 'rifiutata'::"text");



CREATE UNIQUE INDEX "loyalty_ugc_idemp_uq" ON "public"."loyalty_ugc" USING "btree" ("shopify_customer_id", "idemp");



CREATE INDEX "loyalty_ugc_status_idx" ON "public"."loyalty_ugc" USING "btree" ("status", "created_at");



CREATE INDEX "loyalty_ui_events_cust_idx" ON "public"."loyalty_ui_events" USING "btree" ("shopify_customer_id", "day");



CREATE INDEX "loyalty_ui_events_day_idx" ON "public"."loyalty_ui_events" USING "btree" ("day");



CREATE INDEX "loyalty_visits_day_idx" ON "public"."loyalty_visits" USING "btree" ("day");



CREATE INDEX "mat_assets_item_idx" ON "public"."mat_assets" USING "btree" ("item_id");



CREATE INDEX "mat_assets_mat_idx" ON "public"."mat_assets" USING "btree" ("supplier_id", "lower"(COALESCE("materiale", ''::"text")));



CREATE INDEX "mat_items_cat_idx" ON "public"."mat_items" USING "btree" ("categoria");



CREATE UNIQUE INDEX "mat_items_uq" ON "public"."mat_items" USING "btree" ("supplier_id", "lower"("materiale"), "lower"(COALESCE("colore", ''::"text")));



CREATE UNIQUE INDEX "mat_offers_uq" ON "public"."mat_offers" USING "btree" ("item_id", COALESCE("data", '1900-01-01'::"date"), "lower"(COALESCE("documento_fonte", ''::"text")));



CREATE UNIQUE INDEX "mat_order_lines_uq" ON "public"."mat_order_lines" USING "btree" ("order_id", "item_id");



CREATE UNIQUE INDEX "mat_orders_uq" ON "public"."mat_orders" USING "btree" ("supplier_id", "lower"("numero_documento"));



CREATE UNIQUE INDEX "mat_suppliers_nome_uq" ON "public"."mat_suppliers" USING "btree" ("lower"("nome"));



CREATE INDEX "meta_ad_creative_product_set_idx" ON "public"."meta_ad_creative" USING "btree" ("product_set_id");



CREATE INDEX "meta_ads_creative_daily_campaign_idx" ON "public"."meta_ads_creative_daily" USING "btree" ("campaign_id", "date");



CREATE INDEX "meta_ads_creative_daily_date_idx" ON "public"."meta_ads_creative_daily" USING "btree" ("date", "ad_id");



CREATE INDEX "meta_ads_date_idx" ON "public"."meta_ads_daily" USING "btree" ("date", "campaign_id");



CREATE INDEX "meta_product_set_map_codice_idx" ON "public"."meta_product_set_map" USING "btree" ("codice_norm");



CREATE INDEX "meta_product_set_map_set_idx" ON "public"."meta_product_set_map" USING "btree" ("product_set_id");



CREATE UNIQUE INDEX "models_model_norm_uq" ON "public"."models" USING "btree" ("model_norm");



CREATE INDEX "product_aliases_codice_idx" ON "public"."product_aliases" USING "btree" ("codice");



CREATE INDEX "product_aliases_name_idx" ON "public"."product_aliases" USING "btree" ("shopify_name_norm");



CREATE INDEX "products_codice_norm_idx" ON "public"."products" USING "btree" ("codice_norm");



CREATE UNIQUE INDEX "products_codice_norm_uq" ON "public"."products" USING "btree" ("codice_norm");



CREATE INDEX "purchases_codice_idx" ON "public"."purchases" USING "btree" ("codice_norm");



CREATE INDEX "purchases_data_idx" ON "public"."purchases" USING "btree" ("data");



CREATE INDEX "qromo_codice_idx" ON "public"."qromo_sales" USING "btree" ("codice_norm");



CREATE INDEX "qromo_dedup_idx" ON "public"."qromo_sales" USING "btree" ("order_id", "codice_norm");



CREATE UNIQUE INDEX "qromo_sales_live_saleid_uq" ON "public"."qromo_sales" USING "btree" ("sale_id") WHERE (("source" = ANY (ARRAY['qromo-direct'::"text", 'qromo-forward'::"text"])) AND ("sale_id" IS NOT NULL));



CREATE INDEX "qromo_ym_idx" ON "public"."qromo_sales" USING "btree" ("year", "month");



CREATE INDEX "shipping_status_order_idx" ON "public"."shipping_status" USING "btree" ("order_name");



CREATE INDEX "shopify_li_codice_idx" ON "public"."shopify_line_items" USING "btree" ("codice_norm");



CREATE INDEX "shopify_li_orderid_idx" ON "public"."shopify_line_items" USING "btree" ("order_id");



CREATE INDEX "shopify_li_ym_idx" ON "public"."shopify_line_items" USING "btree" ("year", "month");



CREATE UNIQUE INDEX "shopify_line_items_shopify_line_id_uq" ON "public"."shopify_line_items" USING "btree" ("shopify_line_id") WHERE ("shopify_line_id" IS NOT NULL);



CREATE INDEX "shopify_orders_ym_idx" ON "public"."shopify_orders" USING "btree" ("year", "month");



CREATE OR REPLACE TRIGGER "lead_reviews_apply_trg" AFTER INSERT ON "public"."lead_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."lead_reviews_apply"();



CREATE OR REPLACE TRIGGER "lead_touches_apply_trg" AFTER INSERT ON "public"."lead_touches" FOR EACH ROW EXECUTE FUNCTION "public"."lead_touches_apply"();



CREATE OR REPLACE TRIGGER "mat_items_touch" BEFORE UPDATE ON "public"."mat_items" FOR EACH ROW EXECUTE FUNCTION "public"."mat_touch_updated_at"();



CREATE OR REPLACE TRIGGER "mat_suppliers_touch" BEFORE UPDATE ON "public"."mat_suppliers" FOR EACH ROW EXECUTE FUNCTION "public"."mat_touch_updated_at"();



ALTER TABLE ONLY "public"."cs_drafts"
    ADD CONSTRAINT "cs_drafts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."cs_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cs_events"
    ADD CONSTRAINT "cs_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."cs_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cs_messages"
    ADD CONSTRAINT "cs_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."cs_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cs_sends"
    ADD CONSTRAINT "cs_sends_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."cs_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_accounts"
    ADD CONSTRAINT "lead_accounts_gruppo_id_fkey" FOREIGN KEY ("gruppo_id") REFERENCES "public"."lead_accounts"("id");



ALTER TABLE ONLY "public"."lead_accounts"
    ADD CONSTRAINT "lead_accounts_negozio_id_fkey" FOREIGN KEY ("negozio_id") REFERENCES "public"."negozi"("id");



ALTER TABLE ONLY "public"."lead_contacts"
    ADD CONSTRAINT "lead_contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."lead_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_drafts"
    ADD CONSTRAINT "lead_drafts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."lead_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_drafts"
    ADD CONSTRAINT "lead_drafts_touch_in_id_fkey" FOREIGN KEY ("touch_in_id") REFERENCES "public"."lead_touches"("id");



ALTER TABLE ONLY "public"."lead_evidence"
    ADD CONSTRAINT "lead_evidence_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."lead_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_evidence"
    ADD CONSTRAINT "lead_evidence_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."lead_runs"("id");



ALTER TABLE ONLY "public"."lead_reviews"
    ADD CONSTRAINT "lead_reviews_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."lead_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_scores"
    ADD CONSTRAINT "lead_scores_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."lead_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_scores"
    ADD CONSTRAINT "lead_scores_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."lead_runs"("id");



ALTER TABLE ONLY "public"."lead_touches"
    ADD CONSTRAINT "lead_touches_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."lead_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_touches"
    ADD CONSTRAINT "lead_touches_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."lead_contacts"("id");



ALTER TABLE ONLY "public"."loyalty_birthday_awards"
    ADD CONSTRAINT "loyalty_birthday_awards_shopify_customer_id_fkey" FOREIGN KEY ("shopify_customer_id") REFERENCES "public"."loyalty_profiles"("shopify_customer_id");



ALTER TABLE ONLY "public"."loyalty_bonus_second"
    ADD CONSTRAINT "loyalty_bonus_second_first_order_id_fkey" FOREIGN KEY ("first_order_id") REFERENCES "public"."loyalty_order_credits"("shopify_order_id");



ALTER TABLE ONLY "public"."loyalty_bonus_second"
    ADD CONSTRAINT "loyalty_bonus_second_second_order_id_fkey" FOREIGN KEY ("second_order_id") REFERENCES "public"."loyalty_order_credits"("shopify_order_id");



ALTER TABLE ONLY "public"."loyalty_checkins"
    ADD CONSTRAINT "loyalty_checkins_event_code_fkey" FOREIGN KEY ("event_code") REFERENCES "public"."loyalty_checkin_events"("code");



ALTER TABLE ONLY "public"."loyalty_order_reversals"
    ADD CONSTRAINT "loyalty_order_reversals_shopify_order_id_fkey" FOREIGN KEY ("shopify_order_id") REFERENCES "public"."loyalty_order_credits"("shopify_order_id");



ALTER TABLE ONLY "public"."loyalty_redemptions"
    ADD CONSTRAINT "loyalty_redemptions_reward_fk" FOREIGN KEY ("reward_key") REFERENCES "public"."loyalty_rewards"("key");



ALTER TABLE ONLY "public"."loyalty_reward_codes"
    ADD CONSTRAINT "loyalty_reward_codes_redemption_fk" FOREIGN KEY ("redemption_id") REFERENCES "public"."loyalty_redemptions"("id");



ALTER TABLE ONLY "public"."loyalty_reward_codes"
    ADD CONSTRAINT "loyalty_reward_codes_reward_key_fkey" FOREIGN KEY ("reward_key") REFERENCES "public"."loyalty_rewards"("key");



ALTER TABLE ONLY "public"."mat_assets"
    ADD CONSTRAINT "mat_assets_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."mat_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mat_assets"
    ADD CONSTRAINT "mat_assets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."mat_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mat_assets"
    ADD CONSTRAINT "mat_assets_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."mat_suppliers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mat_items"
    ADD CONSTRAINT "mat_items_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."mat_suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."mat_offers"
    ADD CONSTRAINT "mat_offers_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."mat_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mat_order_lines"
    ADD CONSTRAINT "mat_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."mat_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."mat_order_lines"
    ADD CONSTRAINT "mat_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."mat_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mat_orders"
    ADD CONSTRAINT "mat_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."mat_suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."mat_suppliers"
    ADD CONSTRAINT "mat_suppliers_core_supplier_id_fkey" FOREIGN KEY ("core_supplier_id") REFERENCES "public"."suppliers"("id");



ALTER TABLE "public"."ai_compila_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_guides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_guides_ask_ro" ON "public"."app_guides" FOR SELECT TO "ask_ro" USING (true);



CREATE POLICY "cs_conv_sel" ON "public"."cs_conversations" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."cs_conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cs_drafts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cs_drf_sel" ON "public"."cs_drafts" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."cs_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cs_evt_sel" ON "public"."cs_events" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."cs_faq" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cs_faq_sel" ON "public"."cs_faq" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."cs_knowledge" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cs_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cs_msg_sel" ON "public"."cs_messages" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."cs_sends" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cs_sends_sel" ON "public"."cs_sends" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."lead_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_accounts_sel" ON "public"."lead_accounts" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."lead_contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_contacts_sel" ON "public"."lead_contacts" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."lead_drafts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_drafts_sel" ON "public"."lead_drafts" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."lead_evidence" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_evidence_sel" ON "public"."lead_evidence" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."lead_knowledge" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_knowledge_sel" ON "public"."lead_knowledge" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."lead_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_reviews_ins" ON "public"."lead_reviews" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



CREATE POLICY "lead_reviews_sel" ON "public"."lead_reviews" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."lead_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_runs_sel" ON "public"."lead_runs" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."lead_scores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_scores_sel" ON "public"."lead_scores" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."lead_sequences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_sequences_sel" ON "public"."lead_sequences" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."lead_touches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_touches_ins" ON "public"."lead_touches" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



CREATE POLICY "lead_touches_sel" ON "public"."lead_touches" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."loyalty_birthday_awards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_birthday_awards_ask_ro" ON "public"."loyalty_birthday_awards" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_bonus_second" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_bonus_second_ask_ro" ON "public"."loyalty_bonus_second" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_checkin_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_checkin_events_ask_ro" ON "public"."loyalty_checkin_events" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_checkins" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_checkins_ask_ro" ON "public"."loyalty_checkins" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_events_ask_ro" ON "public"."loyalty_events" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_order_credits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_order_credits_ask_ro" ON "public"."loyalty_order_credits" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_order_reversals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_order_reversals_ask_ro" ON "public"."loyalty_order_reversals" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_points" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_points_ask_ro" ON "public"."loyalty_points" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_profiles_ask_ro" ON "public"."loyalty_profiles" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_redemptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_redemptions_ask_ro" ON "public"."loyalty_redemptions" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_reward_codes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_reward_codes_ask_ro" ON "public"."loyalty_reward_codes" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_rewards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_rewards_ask_ro" ON "public"."loyalty_rewards" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_ugc" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_ugc_ask_ro" ON "public"."loyalty_ugc" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_ugc_slots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_ugc_slots_ask_ro" ON "public"."loyalty_ugc_slots" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_ui_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_ui_events_ask_ro" ON "public"."loyalty_ui_events" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."loyalty_visits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_visits_ask_ro" ON "public"."loyalty_visits" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."mat_assets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mat_assets_sel" ON "public"."mat_assets" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."mat_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mat_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mat_items_sel" ON "public"."mat_items" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."mat_offers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mat_offers_sel" ON "public"."mat_offers" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."mat_order_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mat_order_lines_sel" ON "public"."mat_order_lines" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."mat_orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mat_orders_sel" ON "public"."mat_orders" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."mat_suppliers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mat_suppliers_sel" ON "public"."mat_suppliers" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."meta_ad_creative" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meta_ad_freq7" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meta_ads_creative_daily" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meta_ads_window_reach" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meta_product_set_map" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mimi_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mimi_state_ask_ro" ON "public"."mimi_state" FOR SELECT TO "ask_ro" USING (true);



ALTER TABLE "public"."models" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "models_read_all" ON "public"."models" FOR SELECT USING (true);



ALTER TABLE "public"."shipping_status" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shipping_status_ask_ro" ON "public"."shipping_status" FOR SELECT TO "ask_ro" USING (true);



CREATE POLICY "shipping_status_read_authenticated" ON "public"."shipping_status" FOR SELECT TO "authenticated" USING (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "ask_ro";














































































































































































REVOKE ALL ON FUNCTION "public"."ask_select"("q" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ask_select"("q" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ce_aliquota_compensi"("p_year" integer, "p_month" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."ce_aliquota_compensi"("p_year" integer, "p_month" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ce_aliquota_compensi"("p_year" integer, "p_month" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."ce_aliquota_compensi"("p_year" integer, "p_month" integer) TO "ask_ro";



GRANT ALL ON FUNCTION "public"."lead_reviews_apply"() TO "anon";
GRANT ALL ON FUNCTION "public"."lead_reviews_apply"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."lead_reviews_apply"() TO "service_role";



GRANT ALL ON FUNCTION "public"."lead_touches_apply"() TO "anon";
GRANT ALL ON FUNCTION "public"."lead_touches_apply"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."lead_touches_apply"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_award_daily"("p_customer" "text", "p_kind" "text", "p_delta" integer, "p_day" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_award_daily"("p_customer" "text", "p_kind" "text", "p_delta" integer, "p_day" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."loyalty_birthday_in_year"("p_month" integer, "p_day" integer, "p_year" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."loyalty_birthday_in_year"("p_month" integer, "p_day" integer, "p_year" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."loyalty_birthday_in_year"("p_month" integer, "p_day" integer, "p_year" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_birthday_run"("p_today" "date", "p_max" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_birthday_run"("p_today" "date", "p_max" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_bonus_second_run"("p_max" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_bonus_second_run"("p_max" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_checkin"("p_customer" "text", "p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_checkin"("p_customer" "text", "p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_claim_code"("p_reward_key" "text", "p_customer" "text", "p_redemption_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_claim_code"("p_reward_key" "text", "p_customer" "text", "p_redemption_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_credit_order"("p_order_id" "text", "p_customer_id" "text", "p_points" integer, "p_total" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_credit_order"("p_order_id" "text", "p_customer_id" "text", "p_points" integer, "p_total" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_credit_order"("p_order_id" "text", "p_customer_id" "text", "p_points" integer, "p_total" numeric, "p_order_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_credit_order"("p_order_id" "text", "p_customer_id" "text", "p_points" integer, "p_total" numeric, "p_order_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_dashboard"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_dashboard"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."loyalty_dashboard"("p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_flag_on"("p_key" "text", "p_customer" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_flag_on"("p_key" "text", "p_customer" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_health_check"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_health_check"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_memory_deck"("p_n" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_memory_deck"("p_n" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_points_cumulati"("p_customer" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_points_cumulati"("p_customer" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_profile_save"("p_customer" "text", "p_day" integer, "p_month" integer, "p_materiale" "text", "p_consenso" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_profile_save"("p_customer" "text", "p_day" integer, "p_month" integer, "p_materiale" "text", "p_consenso" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_profile_state"("p_customer" "text", "p_today" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_profile_state"("p_customer" "text", "p_today" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_redeem"("p_customer" "text", "p_reward_key" "text", "p_idemp" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_redeem"("p_customer" "text", "p_reward_key" "text", "p_idemp" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_redemptions_for"("p_customer" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_redemptions_for"("p_customer" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_reverse_order"("p_order_id" "text", "p_refunded" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_reverse_order"("p_order_id" "text", "p_refunded" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_staff_email"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_staff_email"() TO "service_role";
GRANT ALL ON FUNCTION "public"."loyalty_staff_email"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."loyalty_tier_of"("p_points" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."loyalty_tier_of"("p_points" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."loyalty_tier_of"("p_points" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_track"("p_customer" "text", "p_events" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_track"("p_customer" "text", "p_events" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_ugc_consenso"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_ugc_consenso"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_ugc_decide"("p_id" bigint, "p_decisione" "text", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_ugc_decide"("p_id" bigint, "p_decisione" "text", "p_motivo" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."loyalty_ugc_decide"("p_id" bigint, "p_decisione" "text", "p_motivo" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."loyalty_ugc_info"("p_customer" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_ugc_info"("p_customer" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_ugc_points"("p_kind" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_ugc_points"("p_kind" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_ugc_queue"("p_status" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_ugc_queue"("p_status" "text", "p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."loyalty_ugc_queue"("p_status" "text", "p_limit" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."loyalty_ugc_slot"("p_customer" "text", "p_n" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_ugc_slot"("p_customer" "text", "p_n" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_ugc_submit"("p_customer" "text", "p_kind" "text", "p_codice" "text", "p_rating" integer, "p_testo" "text", "p_firma" "text", "p_foto" "text"[], "p_consenso" boolean, "p_idemp" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_ugc_submit"("p_customer" "text", "p_kind" "text", "p_codice" "text", "p_rating" integer, "p_testo" "text", "p_firma" "text", "p_foto" "text"[], "p_consenso" boolean, "p_idemp" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_ui_events_purge"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_ui_events_purge"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."loyalty_visit"("p_customer" "text", "p_day" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loyalty_visit"("p_customer" "text", "p_day" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."mat_touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."mat_touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mat_touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."norm_codice"("t" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."norm_codice"("t" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."norm_codice"("t" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_health_log"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_health_log"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_health_log"() TO "service_role";
























GRANT ALL ON TABLE "public"."_bak_shopify_line_items_2026_09_13" TO "service_role";



GRANT ALL ON TABLE "public"."_bak_shopify_orders_2026_09_13" TO "service_role";



GRANT ALL ON TABLE "public"."ai_compila_log" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."alert_rules" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."alert_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."alert_rules" TO "service_role";
GRANT SELECT ON TABLE "public"."alert_rules" TO "ask_ro";



GRANT ALL ON TABLE "public"."app_config" TO "service_role";



GRANT ALL ON TABLE "public"."app_flags" TO "service_role";



GRANT ALL ON TABLE "public"."app_guides" TO "service_role";
GRANT SELECT ON TABLE "public"."app_guides" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."b2b_movements" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."b2b_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."b2b_movements" TO "service_role";
GRANT SELECT ON TABLE "public"."b2b_movements" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_compensi_soci" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_compensi_soci" TO "authenticated";
GRANT ALL ON TABLE "public"."ce_compensi_soci" TO "service_role";
GRANT SELECT ON TABLE "public"."ce_compensi_soci" TO "ask_ro";



GRANT ALL ON SEQUENCE "public"."ce_compensi_soci_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ce_compensi_soci_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ce_compensi_soci_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_snapshots" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."ce_snapshots" TO "service_role";
GRANT SELECT ON TABLE "public"."ce_snapshots" TO "ask_ro";



GRANT ALL ON SEQUENCE "public"."ce_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ce_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ce_snapshots_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_totale_manual" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_totale_manual" TO "authenticated";
GRANT ALL ON TABLE "public"."ce_totale_manual" TO "service_role";
GRANT SELECT ON TABLE "public"."ce_totale_manual" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_totale_monthly" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_totale_monthly" TO "authenticated";
GRANT ALL ON TABLE "public"."ce_totale_monthly" TO "service_role";
GRANT SELECT ON TABLE "public"."ce_totale_monthly" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."change_log" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."change_log" TO "authenticated";
GRANT ALL ON TABLE "public"."change_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."change_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."change_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."change_log_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."counts" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."counts" TO "authenticated";
GRANT ALL ON TABLE "public"."counts" TO "service_role";
GRANT SELECT ON TABLE "public"."counts" TO "ask_ro";



GRANT ALL ON TABLE "public"."cs_conversations" TO "service_role";
GRANT SELECT ON TABLE "public"."cs_conversations" TO "authenticated";



GRANT ALL ON TABLE "public"."cs_drafts" TO "service_role";
GRANT SELECT ON TABLE "public"."cs_drafts" TO "authenticated";



GRANT ALL ON TABLE "public"."cs_events" TO "service_role";
GRANT SELECT ON TABLE "public"."cs_events" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."cs_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cs_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cs_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cs_faq" TO "service_role";
GRANT SELECT ON TABLE "public"."cs_faq" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."cs_faq_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cs_faq_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cs_faq_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."cs_knowledge" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."cs_knowledge" TO "authenticated";
GRANT ALL ON TABLE "public"."cs_knowledge" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cs_knowledge_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cs_knowledge_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cs_knowledge_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cs_messages" TO "service_role";
GRANT SELECT ON TABLE "public"."cs_messages" TO "authenticated";



GRANT ALL ON TABLE "public"."cs_sends" TO "service_role";
GRANT SELECT ON TABLE "public"."cs_sends" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."expenses" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";
GRANT SELECT ON TABLE "public"."expenses" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."gifts_offline" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."gifts_offline" TO "authenticated";
GRANT ALL ON TABLE "public"."gifts_offline" TO "service_role";
GRANT SELECT ON TABLE "public"."gifts_offline" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."health_log" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."health_log" TO "authenticated";
GRANT ALL ON TABLE "public"."health_log" TO "service_role";
GRANT SELECT ON TABLE "public"."health_log" TO "ask_ro";



GRANT ALL ON SEQUENCE "public"."health_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."health_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."health_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lead_accounts" TO "service_role";
GRANT SELECT ON TABLE "public"."lead_accounts" TO "authenticated";



GRANT ALL ON TABLE "public"."lead_contacts" TO "service_role";
GRANT SELECT ON TABLE "public"."lead_contacts" TO "authenticated";



GRANT ALL ON TABLE "public"."lead_drafts" TO "service_role";
GRANT SELECT ON TABLE "public"."lead_drafts" TO "authenticated";



GRANT ALL ON TABLE "public"."lead_evidence" TO "service_role";
GRANT SELECT ON TABLE "public"."lead_evidence" TO "authenticated";



GRANT ALL ON TABLE "public"."lead_knowledge" TO "service_role";
GRANT SELECT ON TABLE "public"."lead_knowledge" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."lead_knowledge_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lead_knowledge_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lead_knowledge_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lead_reviews" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."lead_reviews" TO "authenticated";



GRANT ALL ON TABLE "public"."lead_runs" TO "service_role";
GRANT SELECT ON TABLE "public"."lead_runs" TO "authenticated";



GRANT ALL ON TABLE "public"."lead_scores" TO "service_role";
GRANT SELECT ON TABLE "public"."lead_scores" TO "authenticated";



GRANT ALL ON TABLE "public"."lead_sequences" TO "service_role";
GRANT SELECT ON TABLE "public"."lead_sequences" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."lead_sequences_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lead_sequences_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lead_sequences_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lead_touches" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."lead_touches" TO "authenticated";



GRANT ALL ON TABLE "public"."loyalty_birthday_awards" TO "service_role";



GRANT SELECT("shopify_customer_id") ON TABLE "public"."loyalty_birthday_awards" TO "ask_ro";



GRANT SELECT("year") ON TABLE "public"."loyalty_birthday_awards" TO "ask_ro";



GRANT SELECT("points") ON TABLE "public"."loyalty_birthday_awards" TO "ask_ro";



GRANT SELECT("created_at") ON TABLE "public"."loyalty_birthday_awards" TO "ask_ro";



GRANT ALL ON TABLE "public"."loyalty_bonus_second" TO "service_role";
GRANT SELECT ON TABLE "public"."loyalty_bonus_second" TO "ask_ro";



GRANT ALL ON TABLE "public"."loyalty_checkin_events" TO "service_role";
GRANT SELECT ON TABLE "public"."loyalty_checkin_events" TO "ask_ro";



GRANT ALL ON TABLE "public"."loyalty_checkins" TO "service_role";
GRANT SELECT ON TABLE "public"."loyalty_checkins" TO "ask_ro";



GRANT ALL ON TABLE "public"."loyalty_events" TO "service_role";
GRANT SELECT ON TABLE "public"."loyalty_events" TO "ask_ro";



GRANT ALL ON TABLE "public"."loyalty_order_credits" TO "service_role";
GRANT SELECT ON TABLE "public"."loyalty_order_credits" TO "ask_ro";



GRANT ALL ON TABLE "public"."loyalty_order_reversals" TO "service_role";
GRANT SELECT ON TABLE "public"."loyalty_order_reversals" TO "ask_ro";



GRANT ALL ON TABLE "public"."loyalty_points" TO "service_role";
GRANT SELECT ON TABLE "public"."loyalty_points" TO "ask_ro";



GRANT ALL ON TABLE "public"."loyalty_profiles" TO "service_role";



GRANT SELECT("shopify_customer_id") ON TABLE "public"."loyalty_profiles" TO "ask_ro";



GRANT SELECT("materiale_preferito") ON TABLE "public"."loyalty_profiles" TO "ask_ro";



GRANT SELECT("consenso_compleanno") ON TABLE "public"."loyalty_profiles" TO "ask_ro";



GRANT SELECT("completed_at") ON TABLE "public"."loyalty_profiles" TO "ask_ro";



GRANT SELECT("created_at") ON TABLE "public"."loyalty_profiles" TO "ask_ro";



GRANT SELECT("updated_at") ON TABLE "public"."loyalty_profiles" TO "ask_ro";



GRANT ALL ON TABLE "public"."loyalty_redemptions" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."loyalty_redemptions" TO "ask_ro";



GRANT SELECT("shopify_customer_id") ON TABLE "public"."loyalty_redemptions" TO "ask_ro";



GRANT SELECT("reward_key") ON TABLE "public"."loyalty_redemptions" TO "ask_ro";



GRANT SELECT("cost_points") ON TABLE "public"."loyalty_redemptions" TO "ask_ro";



GRANT SELECT("status") ON TABLE "public"."loyalty_redemptions" TO "ask_ro";



GRANT SELECT("created_at") ON TABLE "public"."loyalty_redemptions" TO "ask_ro";



GRANT SELECT("fulfilled_at") ON TABLE "public"."loyalty_redemptions" TO "ask_ro";



GRANT ALL ON SEQUENCE "public"."loyalty_redemptions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."loyalty_redemptions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."loyalty_redemptions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_reward_codes" TO "service_role";



GRANT SELECT("reward_key") ON TABLE "public"."loyalty_reward_codes" TO "ask_ro";



GRANT SELECT("claimed_by") ON TABLE "public"."loyalty_reward_codes" TO "ask_ro";



GRANT SELECT("redemption_id") ON TABLE "public"."loyalty_reward_codes" TO "ask_ro";



GRANT SELECT("claimed_at") ON TABLE "public"."loyalty_reward_codes" TO "ask_ro";



GRANT SELECT("created_at") ON TABLE "public"."loyalty_reward_codes" TO "ask_ro";



GRANT ALL ON TABLE "public"."loyalty_rewards" TO "service_role";
GRANT SELECT ON TABLE "public"."loyalty_rewards" TO "ask_ro";



GRANT ALL ON TABLE "public"."loyalty_ugc" TO "service_role";
GRANT SELECT ON TABLE "public"."loyalty_ugc" TO "ask_ro";



GRANT ALL ON SEQUENCE "public"."loyalty_ugc_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."loyalty_ugc_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."loyalty_ugc_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_ugc_slots" TO "service_role";
GRANT SELECT ON TABLE "public"."loyalty_ugc_slots" TO "ask_ro";



GRANT ALL ON TABLE "public"."loyalty_ui_events" TO "service_role";
GRANT SELECT ON TABLE "public"."loyalty_ui_events" TO "ask_ro";



GRANT ALL ON SEQUENCE "public"."loyalty_ui_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."loyalty_ui_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."loyalty_ui_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_visits" TO "service_role";
GRANT SELECT ON TABLE "public"."loyalty_visits" TO "ask_ro";



GRANT ALL ON TABLE "public"."mat_assets" TO "service_role";
GRANT SELECT ON TABLE "public"."mat_assets" TO "authenticated";



GRANT ALL ON TABLE "public"."mat_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."mat_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."mat_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."mat_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."mat_items" TO "service_role";
GRANT SELECT ON TABLE "public"."mat_items" TO "authenticated";



GRANT ALL ON TABLE "public"."mat_offers" TO "service_role";
GRANT SELECT ON TABLE "public"."mat_offers" TO "authenticated";



GRANT ALL ON TABLE "public"."mat_order_lines" TO "service_role";
GRANT SELECT ON TABLE "public"."mat_order_lines" TO "authenticated";



GRANT ALL ON TABLE "public"."mat_orders" TO "service_role";
GRANT SELECT ON TABLE "public"."mat_orders" TO "authenticated";



GRANT ALL ON TABLE "public"."mat_suppliers" TO "service_role";
GRANT SELECT ON TABLE "public"."mat_suppliers" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_ad_creative" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_ad_creative" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_ad_creative" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_ad_freq7" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_ad_freq7" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_ad_freq7" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_ads_creative_daily" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_ads_creative_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_ads_creative_daily" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_ads_daily" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_ads_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_ads_daily" TO "service_role";
GRANT SELECT ON TABLE "public"."meta_ads_daily" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_ads_window_reach" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_ads_window_reach" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_ads_window_reach" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_product_set_map" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_product_set_map" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_product_set_map" TO "service_role";



GRANT ALL ON TABLE "public"."mimi_state" TO "service_role";
GRANT SELECT ON TABLE "public"."mimi_state" TO "ask_ro";



GRANT ALL ON TABLE "public"."models" TO "service_role";
GRANT SELECT ON TABLE "public"."models" TO "anon";
GRANT SELECT ON TABLE "public"."models" TO "authenticated";
GRANT SELECT ON TABLE "public"."models" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."negozi" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."negozi" TO "authenticated";
GRANT ALL ON TABLE "public"."negozi" TO "service_role";
GRANT SELECT ON TABLE "public"."negozi" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."non_product_codici" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."non_product_codici" TO "authenticated";
GRANT ALL ON TABLE "public"."non_product_codici" TO "service_role";
GRANT SELECT ON TABLE "public"."non_product_codici" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."product_aliases" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."product_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."product_aliases" TO "service_role";
GRANT SELECT ON TABLE "public"."product_aliases" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."products" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";
GRANT SELECT ON TABLE "public"."products" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."purchases" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."purchases" TO "service_role";
GRANT SELECT ON TABLE "public"."purchases" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."qromo_sales" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."qromo_sales" TO "authenticated";
GRANT ALL ON TABLE "public"."qromo_sales" TO "service_role";
GRANT SELECT ON TABLE "public"."qromo_sales" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."returns" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."returns" TO "authenticated";
GRANT ALL ON TABLE "public"."returns" TO "service_role";
GRANT SELECT ON TABLE "public"."returns" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shipping_status" TO "authenticated";
GRANT ALL ON TABLE "public"."shipping_status" TO "service_role";
GRANT SELECT ON TABLE "public"."shipping_status" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_catalog" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."shopify_catalog" TO "service_role";
GRANT SELECT ON TABLE "public"."shopify_catalog" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_line_items" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."shopify_line_items" TO "service_role";
GRANT SELECT ON TABLE "public"."shopify_line_items" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_orders" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."shopify_orders" TO "service_role";
GRANT SELECT ON TABLE "public"."shopify_orders" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_stock" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_stock" TO "authenticated";
GRANT ALL ON TABLE "public"."shopify_stock" TO "service_role";
GRANT SELECT ON TABLE "public"."shopify_stock" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."stock_adjustments" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."stock_adjustments" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_adjustments" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_adjustments" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."supplier_orders" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."supplier_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_orders" TO "service_role";
GRANT SELECT ON TABLE "public"."supplier_orders" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."suppliers" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";
GRANT SELECT ON TABLE "public"."suppliers" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_inventory" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."v_inventory" TO "service_role";
GRANT SELECT ON TABLE "public"."v_inventory" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_catalogo_modelli" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_catalogo_modelli" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ads_catalogo_modelli" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_creative_windows" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_creative_windows" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ads_creative_windows" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_set_inventory" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_set_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ads_set_inventory" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_creative_status" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_creative_status" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ads_creative_status" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_mensile" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_mensile" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ads_mensile" TO "service_role";
GRANT SELECT ON TABLE "public"."v_ads_mensile" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_periodo_14g" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_periodo_14g" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ads_periodo_14g" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_set_modelli" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_set_modelli" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ads_set_modelli" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_swap" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_swap" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ads_swap" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_weekly_account" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_weekly_account" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ads_weekly_account" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_amimi" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_amimi" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_amimi" TO "service_role";
GRANT SELECT ON TABLE "public"."v_ce_amimi" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_amimi_summary" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_amimi_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_amimi_summary" TO "service_role";
GRANT SELECT ON TABLE "public"."v_ce_amimi_summary" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_totale" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_totale" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_totale" TO "service_role";
GRANT SELECT ON TABLE "public"."v_ce_totale" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_completezza" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_completezza" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_completezza" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_drift" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_drift" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_drift" TO "service_role";
GRANT SELECT ON TABLE "public"."v_ce_drift" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_drill_cogs" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_drill_cogs" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_drill_cogs" TO "service_role";
GRANT SELECT ON TABLE "public"."v_ce_drill_cogs" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_drill_expense" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_drill_expense" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_drill_expense" TO "service_role";
GRANT SELECT ON TABLE "public"."v_ce_drill_expense" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_drill_sales" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_drill_sales" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_drill_sales" TO "service_role";
GRANT SELECT ON TABLE "public"."v_ce_drill_sales" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_totale_summary" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_totale_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_totale_summary" TO "service_role";
GRANT SELECT ON TABLE "public"."v_ce_totale_summary" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_clienti_coorti" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_clienti_coorti" TO "authenticated";
GRANT ALL ON TABLE "public"."v_clienti_coorti" TO "service_role";
GRANT SELECT ON TABLE "public"."v_clienti_coorti" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_clienti_rfm" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_clienti_rfm" TO "authenticated";
GRANT ALL ON TABLE "public"."v_clienti_rfm" TO "service_role";
GRANT SELECT ON TABLE "public"."v_clienti_rfm" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_conto_vendita_negozio" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_conto_vendita_negozio" TO "authenticated";
GRANT ALL ON TABLE "public"."v_conto_vendita_negozio" TO "service_role";
GRANT SELECT ON TABLE "public"."v_conto_vendita_negozio" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_log_attori_14gg" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_log_attori_14gg" TO "authenticated";
GRANT ALL ON TABLE "public"."v_digest_log_attori_14gg" TO "service_role";
GRANT SELECT ON TABLE "public"."v_digest_log_attori_14gg" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_ordini_14gg" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_ordini_14gg" TO "authenticated";
GRANT ALL ON TABLE "public"."v_digest_ordini_14gg" TO "service_role";
GRANT SELECT ON TABLE "public"."v_digest_ordini_14gg" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_products_todo" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_products_todo" TO "authenticated";
GRANT ALL ON TABLE "public"."v_products_todo" TO "service_role";
GRANT SELECT ON TABLE "public"."v_products_todo" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_persone" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_persone" TO "authenticated";
GRANT ALL ON TABLE "public"."v_digest_persone" TO "service_role";
GRANT SELECT ON TABLE "public"."v_digest_persone" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_pulizia_14gg" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_pulizia_14gg" TO "authenticated";
GRANT ALL ON TABLE "public"."v_digest_pulizia_14gg" TO "service_role";
GRANT SELECT ON TABLE "public"."v_digest_pulizia_14gg" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_spese_14gg" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_spese_14gg" TO "authenticated";
GRANT ALL ON TABLE "public"."v_digest_spese_14gg" TO "service_role";
GRANT SELECT ON TABLE "public"."v_digest_spese_14gg" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_versioni" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_versioni" TO "authenticated";
GRANT ALL ON TABLE "public"."v_digest_versioni" TO "service_role";
GRANT SELECT ON TABLE "public"."v_digest_versioni" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_evasione_mensile" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_evasione_mensile" TO "authenticated";
GRANT ALL ON TABLE "public"."v_evasione_mensile" TO "service_role";
GRANT SELECT ON TABLE "public"."v_evasione_mensile" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_expenses_pending" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_expenses_pending" TO "authenticated";
GRANT ALL ON TABLE "public"."v_expenses_pending" TO "service_role";
GRANT SELECT ON TABLE "public"."v_expenses_pending" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_expenses_review" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_expenses_review" TO "authenticated";
GRANT ALL ON TABLE "public"."v_expenses_review" TO "service_role";
GRANT SELECT ON TABLE "public"."v_expenses_review" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_fonti_freschezza" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_fonti_freschezza" TO "authenticated";
GRANT ALL ON TABLE "public"."v_fonti_freschezza" TO "service_role";
GRANT SELECT ON TABLE "public"."v_fonti_freschezza" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_fornitore_prodotti" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_fornitore_prodotti" TO "authenticated";
GRANT ALL ON TABLE "public"."v_fornitore_prodotti" TO "service_role";
GRANT SELECT ON TABLE "public"."v_fornitore_prodotti" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_sku_availability" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_sku_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."v_sku_availability" TO "service_role";
GRANT SELECT ON TABLE "public"."v_sku_availability" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_health" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_health" TO "authenticated";
GRANT ALL ON TABLE "public"."v_health" TO "service_role";
GRANT SELECT ON TABLE "public"."v_health" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_last_sale" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_last_sale" TO "authenticated";
GRANT ALL ON TABLE "public"."v_last_sale" TO "service_role";
GRANT SELECT ON TABLE "public"."v_last_sale" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_lead_dossier" TO "authenticated";
GRANT ALL ON TABLE "public"."v_lead_dossier" TO "service_role";



GRANT ALL ON TABLE "public"."v_lead_followup_due" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_lead_outreach" TO "authenticated";
GRANT ALL ON TABLE "public"."v_lead_outreach" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_lead_pipeline" TO "authenticated";
GRANT ALL ON TABLE "public"."v_lead_pipeline" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_lead_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."v_lead_settings" TO "service_role";



GRANT ALL ON TABLE "public"."v_loyalty_funnel_daily" TO "service_role";
GRANT SELECT ON TABLE "public"."v_loyalty_funnel_daily" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_kpi_daily" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_kpi_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."v_loyalty_kpi_daily" TO "service_role";
GRANT SELECT ON TABLE "public"."v_loyalty_kpi_daily" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_ledger_drift" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_ledger_drift" TO "authenticated";
GRANT ALL ON TABLE "public"."v_loyalty_ledger_drift" TO "service_role";
GRANT SELECT ON TABLE "public"."v_loyalty_ledger_drift" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_members" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_members" TO "authenticated";
GRANT ALL ON TABLE "public"."v_loyalty_members" TO "service_role";
GRANT SELECT ON TABLE "public"."v_loyalty_members" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_pool" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_pool" TO "authenticated";
GRANT ALL ON TABLE "public"."v_loyalty_pool" TO "service_role";
GRANT SELECT ON TABLE "public"."v_loyalty_pool" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_redeem_rate" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_redeem_rate" TO "authenticated";
GRANT ALL ON TABLE "public"."v_loyalty_redeem_rate" TO "service_role";
GRANT SELECT ON TABLE "public"."v_loyalty_redeem_rate" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_refunds_due" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_refunds_due" TO "authenticated";
GRANT ALL ON TABLE "public"."v_loyalty_refunds_due" TO "service_role";
GRANT SELECT ON TABLE "public"."v_loyalty_refunds_due" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_second_order" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_second_order" TO "authenticated";
GRANT ALL ON TABLE "public"."v_loyalty_second_order" TO "service_role";
GRANT SELECT ON TABLE "public"."v_loyalty_second_order" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_streaks" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_streaks" TO "authenticated";
GRANT ALL ON TABLE "public"."v_loyalty_streaks" TO "service_role";
GRANT SELECT ON TABLE "public"."v_loyalty_streaks" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_uplift" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_loyalty_uplift" TO "authenticated";
GRANT ALL ON TABLE "public"."v_loyalty_uplift" TO "service_role";
GRANT SELECT ON TABLE "public"."v_loyalty_uplift" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_margine_ordine" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_margine_ordine" TO "authenticated";
GRANT ALL ON TABLE "public"."v_margine_ordine" TO "service_role";
GRANT SELECT ON TABLE "public"."v_margine_ordine" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_margine_sku" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_margine_sku" TO "authenticated";
GRANT ALL ON TABLE "public"."v_margine_sku" TO "service_role";
GRANT SELECT ON TABLE "public"."v_margine_sku" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_mat_acquisti" TO "authenticated";
GRANT ALL ON TABLE "public"."v_mat_acquisti" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_mat_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."v_mat_assets" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_mat_catalogo" TO "authenticated";
GRANT ALL ON TABLE "public"."v_mat_catalogo" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_mat_fornitori" TO "authenticated";
GRANT ALL ON TABLE "public"."v_mat_fornitori" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_mat_settings" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_mat_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."v_mat_settings" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_movimenti_14gg" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_movimenti_14gg" TO "authenticated";
GRANT ALL ON TABLE "public"."v_movimenti_14gg" TO "service_role";
GRANT SELECT ON TABLE "public"."v_movimenti_14gg" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ops_flags" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ops_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ops_flags" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ordini_arrivo" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ordini_arrivo" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ordini_arrivo" TO "service_role";
GRANT SELECT ON TABLE "public"."v_ordini_arrivo" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_products_to_publish" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_products_to_publish" TO "authenticated";
GRANT ALL ON TABLE "public"."v_products_to_publish" TO "service_role";
GRANT SELECT ON TABLE "public"."v_products_to_publish" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_reorder" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_reorder" TO "authenticated";
GRANT ALL ON TABLE "public"."v_reorder" TO "service_role";
GRANT SELECT ON TABLE "public"."v_reorder" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_resi_mensile" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_resi_mensile" TO "authenticated";
GRANT ALL ON TABLE "public"."v_resi_mensile" TO "service_role";
GRANT SELECT ON TABLE "public"."v_resi_mensile" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_sales_anomalie" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_sales_anomalie" TO "authenticated";
GRANT ALL ON TABLE "public"."v_sales_anomalie" TO "service_role";
GRANT SELECT ON TABLE "public"."v_sales_anomalie" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_sconti_codici" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_sconti_codici" TO "authenticated";
GRANT ALL ON TABLE "public"."v_sconti_codici" TO "service_role";
GRANT SELECT ON TABLE "public"."v_sconti_codici" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_shopify_align" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_shopify_align" TO "authenticated";
GRANT ALL ON TABLE "public"."v_shopify_align" TO "service_role";
GRANT SELECT ON TABLE "public"."v_shopify_align" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_shopify_doppioni" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_shopify_doppioni" TO "authenticated";
GRANT ALL ON TABLE "public"."v_shopify_doppioni" TO "service_role";
GRANT SELECT ON TABLE "public"."v_shopify_doppioni" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_spedizioni_eccezioni" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_spedizioni_eccezioni" TO "authenticated";
GRANT ALL ON TABLE "public"."v_spedizioni_eccezioni" TO "service_role";
GRANT SELECT ON TABLE "public"."v_spedizioni_eccezioni" TO "ask_ro";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_stock_drift" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_stock_drift" TO "authenticated";
GRANT ALL ON TABLE "public"."v_stock_drift" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_vendite_orfane" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_vendite_orfane" TO "authenticated";
GRANT ALL ON TABLE "public"."v_vendite_orfane" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































