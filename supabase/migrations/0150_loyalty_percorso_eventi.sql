-- 0150 (Premia, 2026-10-11, call del 09-10): pagina a soli punti con percorso, QR agli eventi (+20), elenco dei codici
-- riscattati con lo stato "usato", memory con le foto vere delle borse.
-- ADDITIVA (Regola Ferrea 19): due tabelle nuove col prefisso loyalty_*, quattro funzioni nuove, una funzione del modulo
-- ridefinita (loyalty_track: solo le due liste chiuse si allungano), due flag default OFF. Core solo in LETTURA
-- (shopify_orders.discount_codes per sapere se un codice e' stato usato, shopify_stock per le foto). Nessuna colonna su
-- tabelle core, nessuna azione write-api, nessun dato riscritto. Rollback = flag OFF (loyalty_checkin_enabled,
-- loyalty_page_v2); le funzioni di sola lettura non hanno effetti.
-- Idempotenza a DB (Regola 20): la presenza a un evento ha PK (evento, cliente) e un indice UNIQUE parziale su
-- loyalty_events; il gate e' l'insert stesso. Punti e ledger restano in quadra (loyalty_points + loyalty_events nella
-- stessa transazione), come loyalty_award_daily (0136).
-- I livelli (Amica / Amica Speciale / Amica del Cuore) escono dalla PAGINA: colonne, viste e RPC della 0141 restano
-- dormienti, il flag loyalty_tier_lifetime_enabled resta spento. Niente drop.

-- 0. Pre-check: la source nuova non deve esistere ancora (l'indice UNIQUE parziale sotto lo presume)
do $$
begin
  if exists (select 1 from loyalty_events where source = 'event_checkin') then
    raise exception 'pre-check: esistono gia'' eventi con source event_checkin';
  end if;
end $$;

-- 1. Flag (default OFF). loyalty_checkin_enabled e' a valore come i flag della 0141 ('true' | 'false' | lista di id);
--    loyalty_page_v2 e' letto dalla rotta /club di loyalty-proxy: 'true' = pagina nuova per tutti.
insert into app_flags (key, value) values
  ('loyalty_checkin_enabled', 'false'),
  ('loyalty_page_v2',         'false')
on conflict (key) do nothing;

-- 2. Eventi con QR (pop-up, serate). Il codice sta nel QR: amimi.it/apps/premia/club?evento=<CODICE>.
--    Un evento vale solo dentro la sua finestra oraria e ha un tetto di presenze: un QR fotografato e girato in rete
--    non regala punti fuori orario ne' oltre il tetto.
create table if not exists loyalty_checkin_events (
  code         text primary key,
  label        text not null,
  points       int  not null default 20,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  max_checkins int  not null default 300,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint loyalty_checkin_events_code_chk   check (code ~ '^[A-Z0-9_-]{4,40}$'),
  constraint loyalty_checkin_events_label_chk  check (length(trim(label)) between 1 and 80),
  constraint loyalty_checkin_events_points_chk check (points between 1 and 100),
  constraint loyalty_checkin_events_max_chk    check (max_checkins between 1 and 5000),
  constraint loyalty_checkin_events_window_chk check (ends_at > starts_at and ends_at <= starts_at + interval '14 days')
);
alter table loyalty_checkin_events enable row level security;
revoke all on loyalty_checkin_events from anon, authenticated;
grant select on loyalty_checkin_events to ask_ro;

create table if not exists loyalty_checkins (
  event_code          text not null references loyalty_checkin_events (code),
  shopify_customer_id text not null,
  points              int  not null,
  created_at          timestamptz not null default now(),
  primary key (event_code, shopify_customer_id)
);
create index if not exists loyalty_checkins_cust_idx on loyalty_checkins (shopify_customer_id);
alter table loyalty_checkins enable row level security;
revoke all on loyalty_checkins from anon, authenticated;
grant select on loyalty_checkins to ask_ro;

create unique index if not exists loyalty_events_event_checkin_uq
  on loyalty_events (shopify_customer_id, (meta->>'event')) where source = 'event_checkin';

-- 3. Presenza a un evento: una per cliente per evento, dentro la finestra, sotto il tetto. Atomica.
--    Il lucchetto per evento serializza le presenze dello stesso evento: il tetto non si sfora con richieste concorrenti.
create or replace function public.loyalty_checkin(p_customer text, p_code text) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
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
end; $function$;
revoke all on function public.loyalty_checkin(text, text) from anon, authenticated, public;
grant execute on function public.loyalty_checkin(text, text) to service_role;

-- 4. Tutti i codici riscattati di un cliente, con il valore del premio di allora e la data in cui il codice compare
--    in un ordine (usato). Un codice del pool e' monouso: se e' in un ordine non e' piu' spendibile, qualunque sia lo
--    stato dell'ordine. Sola lettura; il confronto e' per posizione (nessun carattere jolly dal dato).
create or replace function public.loyalty_redemptions_for(p_customer text) returns jsonb
language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'reward_key', r.reward_key, 'cost_points', r.cost_points, 'status', r.status,
           'discount_code', r.discount_code, 'created_at', r.created_at,
           'kind', w.kind, 'value', w.value, 'used_at', u.used_at)
         order by r.created_at desc), '[]'::jsonb)
  from (select reward_key, cost_points, status, discount_code, created_at
        from loyalty_redemptions where shopify_customer_id = p_customer
        order by created_at desc limit 60) r
  left join loyalty_rewards w on w.key = r.reward_key
  left join lateral (
    select min(o.created_at_shop) as used_at
    from shopify_orders o
    where r.discount_code is not null and length(r.discount_code) >= 6
      and position(upper(r.discount_code) in upper(coalesce(o.discount_codes, ''))) > 0
  ) u on true
$function$;
revoke all on function public.loyalty_redemptions_for(text) from anon, authenticated, public;
grant execute on function public.loyalty_redemptions_for(text) to service_role;

-- 5. Mazzo del memory: foto vere di borse a catalogo, una a caso per MODELLO (LEA, NINA, ANNIE, ...), cosi' le carte
--    si distinguono bene fra loro. Solo schede attive con foto sul CDN Shopify. Sola lettura di shopify_stock.
create or replace function public.loyalty_memory_deck(p_n int default 3) returns jsonb
language sql volatile security definer set search_path to 'public' as $function$
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
$function$;
revoke all on function public.loyalty_memory_deck(int) from anon, authenticated, public;
grant execute on function public.loyalty_memory_deck(int) to service_role;

-- 6. Tracciamento: le due liste chiuse si allungano con gli elementi della pagina nuova. Corpo identico alla 0147.
create or replace function public.loyalty_track(p_customer text, p_events jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  c_views    constant text[] := array['redeem_ready', 'redeem_locked', 'redeem_pending', 'profilo', 'mimi', 'guardaroba', 'bonus2', 'bday',
                                      'percorso', 'codici', 'regole', 'evento'];
  c_taps     constant text[] := array['redeem', 'copy_code', 'coccola', 'gioco', 'nanna', 'wear', 'profile_save',
                                      'regole', 'codici_tutti', 'shop'];
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
revoke all on function public.loyalty_track(text, jsonb) from anon, authenticated, public;
grant execute on function public.loyalty_track(text, jsonb) to service_role;

-- 7. Traccia della migrazione
insert into change_log (tbl, row_id, op, after, chi, source) values
  ('loyalty_points', 'migr_0150', 'schema',
   '{"migr":"0150_loyalty_percorso_eventi","nuovo":["loyalty_checkin_events","loyalty_checkins","loyalty_checkin()","loyalty_redemptions_for()","loyalty_memory_deck()"],"ridefinito":["loyalty_track (liste)"],"flag":["loyalty_checkin_enabled=false","loyalty_page_v2=false"]}'::jsonb,
   'claude-code', 'migration_0150');
