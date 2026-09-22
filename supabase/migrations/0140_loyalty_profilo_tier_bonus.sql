-- 0140 (Premia, brief M4b del 2026-09-22): A profilo + compleanno, B tier sui punti cumulati, C bonus seconda borsa.
-- ADDITIVA (Regola Ferrea 19): tabelle nuove col prefisso loyalty_*, core solo in LETTURA (shopify_orders.created_at_shop
-- per la data del 2° ordine), nessuna colonna su tabelle core, nessuna azione write-api, tre flag default OFF
-- (rollback = flag OFF). Idempotenza a DB (Regola 20): ogni accredito nuovo ha un vincolo UNIQUE (tabella di stato con
-- PK + indice UNIQUE parziale su loyalty_events per source), il gate e' l'insert stesso, mai "controllo e poi inserisco".
-- I giri (compleanno, bonus) sono funzioni SQL su pg_cron come loyalty_health_check (migr 0137): niente Shopify, tutto
-- e' gia' nel DB; un giro = una transazione con tetto di righe (p_max, Regola 20c); una lettura fallita alza e finisce
-- in health_log come 'error' (Regola 20a), mai un default vuoto. Orari DOPO le 06:12 UTC perche' refresh_health_log
-- (06:00) cancella le chiavi non ce_*/sales_* del giorno.
-- Flag a valore: 'true' = tutti, 'false' o vuoto = nessuno, altrimenti lista di shopify_customer_id separati da
-- virgola = acceso SOLO per quei clienti (prova end-to-end sull'account di test senza accendere per il pubblico).
-- Punti cumulati = somma di tutti gli eventi TRANNE i riscatti (redeem): scendono per resi e correzioni, mai per un
-- riscatto. Privacy by design: del compleanno si tengono SOLO giorno e mese, mai l'anno.

-- 0. Pre-check: le source nuove non devono esistere ancora (gli indici UNIQUE parziali sotto lo presumono)
do $$
begin
  if exists (select 1 from loyalty_events where source in ('profile_complete', 'birthday', 'bonus_second', 'bonus_second_reversal')) then
    raise exception 'pre-check: esistono gia'' eventi con le source nuove (profile_complete/birthday/bonus_second*)';
  end if;
end $$;

-- 1. Flag (default OFF) e cursore del bonus (vuoto: lo riempie il primo giro a flag acceso)
insert into app_flags (key, value) values
  ('loyalty_profile_enabled',       'false'),
  ('loyalty_tier_lifetime_enabled', 'false'),
  ('loyalty_bonus_second_enabled',  'false'),
  ('loyalty_bonus_second_since',    '')
on conflict (key) do nothing;

-- Flag acceso per un cliente ('true' | 'false'/'' | lista di id)
create or replace function public.loyalty_flag_on(p_key text, p_customer text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select case when lower(trim(value)) = 'true' then true
                when lower(trim(value)) in ('', 'false') then false
                else p_customer is not null and p_customer = any(string_to_array(replace(value, ' ', ''), ','))
           end
    from app_flags where key = p_key), false);
$$;
revoke all on function public.loyalty_flag_on(text, text) from anon, authenticated, public;
grant execute on function public.loyalty_flag_on(text, text) to service_role;

-- 2. Tabelle del modulo (RLS ON senza policy + REVOKE: come il resto di loyalty_*)
create table if not exists loyalty_profiles (
  shopify_customer_id  text primary key,
  birth_day            smallint,                     -- 1-31
  birth_month          smallint,                     -- 1-12. NESSUN anno di nascita, per scelta.
  birth_set_at         timestamptz,                  -- quando la data e' stata salvata: da qui non si cambia dalla pagina
  materiale_preferito  text,
  consenso_compleanno  boolean not null default false,
  consenso_at          timestamptz,
  completed_at         timestamptz,                  -- primo salvataggio completo (gate del +10)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint loyalty_profiles_birth_chk check (
    (birth_day is null and birth_month is null and birth_set_at is null)
    or (birth_day is not null and birth_month is not null and birth_set_at is not null
        and birth_month between 1 and 12
        and birth_day between 1 and (case birth_month when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end))
  ),
  constraint loyalty_profiles_materiale_chk check (
    materiale_preferito is null
    or materiale_preferito in ('cavallino', 'cocco', 'vernice', 'pelle liscia', 'cotone', 'nessuna preferenza')
  )
);
alter table loyalty_profiles enable row level security;
revoke all on loyalty_profiles from anon, authenticated;
-- lettura interna a colonne: MAI giorno e mese di nascita
grant select (shopify_customer_id, materiale_preferito, consenso_compleanno, completed_at, created_at, updated_at) on loyalty_profiles to ask_ro;

create table if not exists loyalty_birthday_awards (
  shopify_customer_id text not null references loyalty_profiles(shopify_customer_id),
  year                int  not null,
  points              int  not null check (points > 0),
  birthday            date not null,
  created_at          timestamptz not null default now(),
  primary key (shopify_customer_id, year)
);
alter table loyalty_birthday_awards enable row level security;
revoke all on loyalty_birthday_awards from anon, authenticated;
grant select (shopify_customer_id, year, points, created_at) on loyalty_birthday_awards to ask_ro;

create table if not exists loyalty_bonus_second (
  shopify_customer_id text primary key,
  first_order_id      text not null references loyalty_order_credits(shopify_order_id),
  second_order_id     text not null references loyalty_order_credits(shopify_order_id),
  first_order_at      timestamptz not null,
  second_order_at     timestamptz not null,
  points              int  not null check (points > 0),
  points_reversed     int  not null default 0 check (points_reversed >= 0 and points_reversed <= points),
  created_at          timestamptz not null default now(),
  reversed_at         timestamptz
);
alter table loyalty_bonus_second enable row level security;
revoke all on loyalty_bonus_second from anon, authenticated;
grant select on loyalty_bonus_second to ask_ro;

-- 3. UNIQUE a DB sugli accrediti nuovi (Regola 20): una sola volta per cliente (profilo, bonus) o per cliente e anno (compleanno)
create unique index if not exists loyalty_events_profile_complete_uq on loyalty_events (shopify_customer_id) where source = 'profile_complete';
create unique index if not exists loyalty_events_bonus_second_uq     on loyalty_events (shopify_customer_id) where source = 'bonus_second';
create unique index if not exists loyalty_events_birthday_uq         on loyalty_events (shopify_customer_id, (meta->>'year')) where source = 'birthday';

-- 4. Funzioni pure
create or replace function public.loyalty_tier_of(p_points int) returns text
language sql immutable as $$
  select case when p_points >= 400 then 'Amica del Cuore' when p_points >= 150 then 'Amica Speciale' else 'Amica' end;
$$;

-- compleanno nell'anno dato; 29/02 negli anni non bisestili = 28/02
create or replace function public.loyalty_birthday_in_year(p_month int, p_day int, p_year int) returns date
language sql immutable as $$
  select case when p_month is null or p_day is null or p_year is null then null
              when p_month = 2 and p_day = 29 and not (p_year % 4 = 0 and (p_year % 100 <> 0 or p_year % 400 = 0)) then make_date(p_year, 2, 28)
              else make_date(p_year, p_month, p_day) end;
$$;

create or replace function public.loyalty_points_cumulati(p_customer text) returns int
language sql stable security definer set search_path to 'public' as $$
  select coalesce(sum(delta), 0)::int from loyalty_events where shopify_customer_id = p_customer and source <> 'redeem';
$$;
revoke all on function public.loyalty_points_cumulati(text) from anon, authenticated, public;
grant execute on function public.loyalty_points_cumulati(text) to service_role;

-- 5. B: v_loyalty_members + punti_cumulati e tier_cumulato IN CODA (le colonne esistenti restano identiche, tier_saldo compreso)
create or replace view v_loyalty_members with (security_invoker = true) as
select p.shopify_customer_id, p.points as saldo,
  coalesce(sum(case when e.delta > 0 then e.delta end),0) as guadagnati,
  coalesce(-sum(case when e.delta < 0 then e.delta end),0) as riscattati,
  min(e.created_at) as primo_evento, max(e.created_at) as ultimo_evento,
  case when p.points >= 400 then 'Amica del Cuore' when p.points >= 150 then 'Amica Speciale' else 'Amica' end as tier_saldo,
  (select count(c.shopify_order_id) from loyalty_order_credits c where c.shopify_customer_id = p.shopify_customer_id) as ordini_accreditati,
  (select coalesce(sum(c.order_total),0) from loyalty_order_credits c where c.shopify_customer_id = p.shopify_customer_id) as spesa_accreditata,
  (select count(r.id) from loyalty_redemptions r where r.shopify_customer_id = p.shopify_customer_id and r.status = 'fulfilled') as riscatti_evasi,
  coalesce(sum(case when e.source <> 'redeem' then e.delta end),0) as punti_cumulati,
  loyalty_tier_of(coalesce(sum(case when e.source <> 'redeem' then e.delta end),0)::int) as tier_cumulato
from loyalty_points p
left join loyalty_events e on e.shopify_customer_id = p.shopify_customer_id
group by p.shopify_customer_id, p.points;

-- 6. C: primo e secondo ordine accreditato per cliente (data ordine = shopify_orders.created_at_shop via order_name,
--    ripiego created_at dell'accredito), finestra di 90 giorni, stato del bonus. Serve al giro, alla pagina e ai KPI.
create or replace view v_loyalty_second_order with (security_invoker = true) as
with c as (
  select c.shopify_customer_id, c.shopify_order_id, c.order_name, c.points,
         coalesce(o.created_at_shop, c.created_at) as order_at,
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
  f.order_at + interval '90 days' as deadline,
  s.shopify_order_id as second_order_id, s.order_name as second_order_name, s.order_at as second_order_at,
  s.points as second_points, s.points_reversed as second_points_reversed,
  (s.points_reversed >= s.points or (s.order_total > 0 and s.refunded_amount >= s.order_total)) as second_fully_refunded,
  (s.order_at is not null and s.order_at <= f.order_at + interval '90 days') as entro_90gg,
  b.points as bonus_points, b.points_reversed as bonus_reversed, b.created_at as bonus_at
from c f
left join c s on s.shopify_customer_id = f.shopify_customer_id and s.rn = 2
left join loyalty_bonus_second b on b.shopify_customer_id = f.shopify_customer_id
where f.rn = 1;
grant select on v_loyalty_second_order to ask_ro;

-- 7. A: stato del profilo per la pagina (una RPC, un giro): profilo, compleanno oggi, cumulato e tier, finestra bonus
create or replace function public.loyalty_profile_state(p_customer text, p_today date default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Europe/Rome')::date);
  v_p loyalty_profiles%rowtype;
  v_bday date; v_cum int; v_awarded boolean := false; v_profile jsonb := null;
  v_n int; v_deadline timestamptz; v_bonus_pts int; v_bonus_rev int;
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
      'deadline', case when v_n = 1 and v_deadline >= now() then (v_deadline at time zone 'Europe/Rome')::date else null end,
      'awarded', v_bonus_pts is not null and coalesce(v_bonus_rev, 0) < v_bonus_pts));
end; $$;
revoke all on function public.loyalty_profile_state(text, date) from anon, authenticated, public;
grant execute on function public.loyalty_profile_state(text, date) to service_role;

-- 8. A: salvataggio del profilo. La data di nascita si scrive UNA volta (poi birthday_locked, anti-abuso: correzioni solo
--    dall'assistenza); materiale e consenso si aggiornano; al PRIMO salvataggio completo (data + materiale + consenso)
--    +10 una sola volta: gate = UPDATE di completed_at sotto lock di riga + UNIQUE parziale su loyalty_events.
create or replace function public.loyalty_profile_save(p_customer text, p_day int, p_month int, p_materiale text, p_consenso boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_p loyalty_profiles%rowtype; v_locked boolean := false; v_gate int := 0; v_new int; v_points int;
  v_mat text := nullif(trim(p_materiale), '');
begin
  if p_customer is null or p_customer = '' or p_consenso is null then return jsonb_build_object('ok', false, 'reason', 'bad_request'); end if;
  if v_mat is not null and v_mat not in ('cavallino', 'cocco', 'vernice', 'pelle liscia', 'cotone', 'nessuna preferenza') then
    return jsonb_build_object('ok', false, 'reason', 'bad_materiale');
  end if;

  -- la data, se arriva, deve esistere (31/02 rifiutato) PRIMA di toccare qualunque riga
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
revoke all on function public.loyalty_profile_save(text, int, int, text, boolean) from anon, authenticated, public;
grant execute on function public.loyalty_profile_save(text, int, int, text, boolean) to service_role;

-- 9. A: giro compleanni. +20 una volta per cliente e anno (PK di loyalty_birthday_awards + UNIQUE su loyalty_events),
--    solo con consenso e profilo salvato almeno 30 giorni prima del compleanno; finestra di recupero di 3 giorni se il
--    cron salta un giorno (anche a cavallo d'anno). NO-OP a flag spento. Tutto o niente: un errore annulla il giro intero
--    e finisce in health_log 'loyalty_birthday' come error.
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
      insert into loyalty_events (shopify_customer_id, delta, source, meta)
        values (r.shopify_customer_id, v_bonus, 'birthday', jsonb_build_object('year', r.year, 'birthday', r.bday, 'fisso', true));
      insert into loyalty_points (shopify_customer_id, points, updated_at) values (r.shopify_customer_id, v_bonus, now())
        on conflict (shopify_customer_id) do update set points = loyalty_points.points + excluded.points, updated_at = now();
      v_done := v_done + 1; v_pts := v_pts + v_bonus;
    end loop;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is not null then
    v_label := 'compleanni ' || v_today || ' FERMATO: ' || left(v_err, 300); v_sev := 'error';
  else
    v_label := 'compleanni ' || v_today || ': ' || v_done || ' accreditati (+' || v_pts || ' pt), gia''/skip ' || v_skip
      || case when v_resto > 0 then ', RESTO oltre il tetto ' || p_max else '' end;
    v_sev := case when v_resto > 0 then 'warn' else 'ok' end;
  end if;
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_birthday', v_label, v_done, v_sev)
    on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = now();
  return jsonb_build_object('ok', v_err is null, 'today', v_today, 'credited', v_done, 'points', v_pts, 'skipped', v_skip, 'resto', v_resto, 'error', v_err);
end; $$;
revoke all on function public.loyalty_birthday_run(date, int) from anon, authenticated, public;
grant execute on function public.loyalty_birthday_run(date, int) to service_role;

-- 10. C: giro bonus seconda borsa. +50 una volta per cliente (PK di loyalty_bonus_second + UNIQUE su loyalty_events) se il
--     2° ordine accreditato e' entro 90 giorni dal 1° ed e' stato creato dopo loyalty_bonus_second_since (vuoto = il
--     primo giro a flag acceso lo fissa a "adesso": non retroattivo). Storno del bonus se il 2° ordine viene rimborsato
--     per intero (mai sotto zero: si limita al saldo e riprova al giro dopo, come loyalty_reverse_order). Legge
--     loyalty_order_credits, non tocca la logica di accredito di loyalty-orders.
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
  begin
    select value into v_since_txt from app_flags where key = 'loyalty_bonus_second_since';
    if coalesce(trim(v_since_txt), '') = '' then
      v_since := now();
      insert into app_flags (key, value) values ('loyalty_bonus_second_since', to_char(v_since at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        on conflict (key) do update set value = excluded.value;
    else
      v_since := v_since_txt::timestamptz;
    end if;

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
      join v_loyalty_second_order s on s.shopify_customer_id = b.shopify_customer_id
      where b.points_reversed < b.points and s.second_fully_refunded
        and loyalty_flag_on('loyalty_bonus_second_enabled', b.shopify_customer_id)
      order by b.shopify_customer_id
      limit p_max
    loop
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
    v_label := 'bonus seconda borsa FERMATO: ' || left(v_err, 300); v_sev := 'error';
  else
    v_label := 'bonus seconda borsa (dal ' || coalesce(to_char(v_since at time zone 'utc', 'YYYY-MM-DD'), '?') || '): ' || v_done || ' accreditati (+' || (v_done * v_bonus) || ' pt), gia''/skip ' || v_skip
      || ', stornati ' || v_rev || ' (-' || v_rev_pts || ' pt), in attesa di saldo ' || v_rev_wait
      || case when v_resto > 0 then ', RESTO oltre il tetto ' || p_max else '' end;
    v_sev := case when v_resto > 0 then 'warn' else 'ok' end;
  end if;
  insert into health_log (day, k, label, n, severity) values (current_date, 'loyalty_bonus_second', v_label, v_done, v_sev)
    on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = now();
  return jsonb_build_object('ok', v_err is null, 'since', v_since, 'credited', v_done, 'points', v_done * v_bonus, 'skipped', v_skip, 'resto', v_resto,
    'reversed', v_rev, 'reversed_points', v_rev_pts, 'reversal_waiting_balance', v_rev_wait, 'error', v_err);
end; $$;
revoke all on function public.loyalty_bonus_second_run(int) from anon, authenticated, public;
grant execute on function public.loyalty_bonus_second_run(int) to service_role;

-- 11. Cron: dopo refresh_health_log (06:00 UTC) e loyalty_health_check (06:12). NO-OP a flag spento.
select cron.schedule('loyalty-birthday-daily', '20 6 * * *', $$ select public.loyalty_birthday_run() $$);
select cron.schedule('loyalty-bonus-second-daily', '25 6 * * *', $$ select public.loyalty_bonus_second_run() $$);

insert into change_log (tbl, row_id, op, after, chi, source) values
  ('cron.job', 'loyalty-birthday-daily', 'cron_create',
   jsonb_build_object('schedule', '20 6 * * *', 'fn', 'loyalty_birthday_run', 'motivo', 'Premia: +20 al compleanno (brief M4b 22-09), NO-OP a loyalty_profile_enabled=false'),
   'claude-code', 'migration_0140'),
  ('cron.job', 'loyalty-bonus-second-daily', 'cron_create',
   jsonb_build_object('schedule', '25 6 * * *', 'fn', 'loyalty_bonus_second_run', 'motivo', 'Premia: +50 seconda borsa entro 90 gg (brief M4b 22-09), NO-OP a loyalty_bonus_second_enabled=false'),
   'claude-code', 'migration_0140'),
  ('loyalty_points', 'migr_0140', 'schema',
   '{"migr":"0140_loyalty_profilo_tier_bonus","parti":["A loyalty_profiles + loyalty_birthday_awards + loyalty_profile_state/save + loyalty_birthday_run","B v_loyalty_members.punti_cumulati/tier_cumulato","C loyalty_bonus_second + v_loyalty_second_order + loyalty_bonus_second_run"],"flag":["loyalty_profile_enabled","loyalty_tier_lifetime_enabled","loyalty_bonus_second_enabled"],"default":"false"}'::jsonb,
   'claude-code', 'migration_0140');
