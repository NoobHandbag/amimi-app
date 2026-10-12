-- 0153 (Premia, 2026-10-12, decisione owner): recensioni e foto delle borse in cambio di punti Mimi'.
-- Recensione (stelle + testo, solo per una borsa comprata online dalla cliente) = +20; foto del look (anche per chi ha
-- comprato in boutique o ai pop-up) = +30; una per tipo per borsa. I punti arrivano SOLO quando una persona del team
-- approva dall'app gestionale (tab Premia, login @amimi.it). Stelline sulle schede prodotto e pubblicazione: fase 2.
-- ADDITIVA (Regola Ferrea 19): tabelle nuove loyalty_ugc e loyalty_ugc_slots, bucket privato loyalty-ugc, funzioni
-- nuove, flag loyalty_ugc_enabled default OFF; loyalty_track ridefinita solo per allungare le due liste chiuse.
-- Core solo in LETTURA (loyalty_order_credits + shopify_line_items per la borsa comprata, shopify_stock per il titolo).
-- Rollback = flag OFF (la pagina nasconde la sezione, invio e caricamento rispondono off). Le approvazioni del team
-- restano possibili anche a flag spento: sono una scelta di una persona, non un'azione della cliente.
-- Idempotenza a DB (Regola 20): invio = UNIQUE (cliente, idemp); una per tipo per borsa = UNIQUE parziale sugli invii
-- non rifiutati; punti = UNIQUE parziale su loyalty_events (meta->>'ugc') per source 'ugc' e il gate e' l'update
-- condizionato della riga ('in_revisione' -> 'approvata'). Punti e ledger nella stessa transazione, come la 0150.

-- 0. Pre-check: la source nuova non deve esistere ancora (l'indice UNIQUE parziale sotto lo presume)
do $$
begin
  if exists (select 1 from loyalty_events where source = 'ugc') then
    raise exception 'pre-check: esistono gia'' eventi con source ugc';
  end if;
end $$;

-- 1. Flag (default OFF), a valore come loyalty_checkin_enabled: 'true' | 'false' | lista di shopify_customer_id
insert into app_flags (key, value) values ('loyalty_ugc_enabled', 'false') on conflict (key) do nothing;

-- 2. Punti per tipo e testo del consenso: UNA fonte, letta dalle funzioni sotto e (via loyalty-proxy) dalla pagina.
--    Cambiare i punti o il testo = una migrazione nuova; ogni invio salva il testo che la cliente ha accettato.
create or replace function public.loyalty_ugc_points(p_kind text) returns int
language sql immutable set search_path to 'public' as $function$
  select case p_kind when 'recensione' then 20 when 'look' then 30 else 0 end
$function$;
revoke all on function public.loyalty_ugc_points(text) from anon, authenticated, public;
grant execute on function public.loyalty_ugc_points(text) to service_role;

create or replace function public.loyalty_ugc_consenso() returns text
language sql immutable set search_path to 'public' as $function$
  select 'Acconsento che Amimì pubblichi le foto e il testo che invio, con la firma che scelgo, sul sito amimi.it, '
      || 'sui social e nelle comunicazioni di Amimì. Le foto sono mie e chi compare ha dato il suo permesso. '
      || 'Posso chiederne la rimozione in ogni momento scrivendo ad Amimì.'
$function$;
revoke all on function public.loyalty_ugc_consenso() from anon, authenticated, public;
grant execute on function public.loyalty_ugc_consenso() to service_role;

-- 3. Gli invii
create table if not exists loyalty_ugc (
  id                  bigint generated always as identity primary key,
  shopify_customer_id text not null,
  kind                text not null,
  codice              text not null,
  titolo              text,
  rating              smallint,
  testo               text,
  firma               text,
  foto                text[] not null default '{}',
  verificata          boolean not null default false,
  consenso_testo      text not null,
  consenso_at         timestamptz not null default now(),
  status              text not null default 'in_revisione',
  motivo              text,
  punti               int,
  deciso_at           timestamptz,
  deciso_da           text,
  idemp               text not null,
  created_at          timestamptz not null default now(),
  constraint loyalty_ugc_kind_chk   check (kind in ('recensione', 'look')),
  constraint loyalty_ugc_codice_chk check (codice ~ '^[A-Z0-9_]{3,80}$'),
  constraint loyalty_ugc_rating_chk check ((kind = 'recensione' and rating between 1 and 5) or (kind = 'look' and rating is null)),
  constraint loyalty_ugc_testo_chk  check (testo is null or char_length(testo) <= 600),
  constraint loyalty_ugc_firma_chk  check (firma is null or char_length(firma) <= 40),
  constraint loyalty_ugc_foto_chk   check (cardinality(foto) <= 3 and (kind = 'recensione' or cardinality(foto) >= 1)),
  constraint loyalty_ugc_status_chk check (status in ('in_revisione', 'approvata', 'rifiutata')),
  constraint loyalty_ugc_deciso_chk check ((status = 'in_revisione') = (deciso_at is null)),
  constraint loyalty_ugc_motivo_chk check (status <> 'rifiutata' or char_length(coalesce(motivo, '')) between 3 and 200),
  constraint loyalty_ugc_idemp_chk  check (char_length(idemp) between 8 and 80)
);
create unique index if not exists loyalty_ugc_idemp_uq on loyalty_ugc (shopify_customer_id, idemp);
create unique index if not exists loyalty_ugc_borsa_uq on loyalty_ugc (shopify_customer_id, kind, codice) where status <> 'rifiutata';
create index if not exists loyalty_ugc_status_idx on loyalty_ugc (status, created_at);
alter table loyalty_ugc enable row level security;
revoke all on loyalty_ugc from anon, authenticated;
grant select on loyalty_ugc to ask_ro;
create policy loyalty_ugc_ask_ro on loyalty_ugc for select to ask_ro using (true);

create unique index if not exists loyalty_events_ugc_uq on loyalty_events ((meta->>'ugc')) where source = 'ugc';

-- 4. Tetto ai caricamenti: al massimo 12 foto al giorno per cliente (i link firmati per caricare li chiede loyalty-proxy)
create table if not exists loyalty_ugc_slots (
  shopify_customer_id text not null,
  day                 date not null,
  n                   int  not null default 0,
  primary key (shopify_customer_id, day),
  constraint loyalty_ugc_slots_n_chk check (n between 0 and 12)
);
alter table loyalty_ugc_slots enable row level security;
revoke all on loyalty_ugc_slots from anon, authenticated;
grant select on loyalty_ugc_slots to ask_ro;
create policy loyalty_ugc_slots_ask_ro on loyalty_ugc_slots for select to ask_ro using (true);

-- 5. Le foto: bucket PRIVATO. Scrive solo loyalty-proxy (service_role, link firmati per un percorso deciso da lei);
--    legge solo il team con login @amimi.it (link firmati dall'app). Nessuna policy di scrittura per nessuno.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('loyalty-ugc', 'loyalty-ugc', false, 4194304, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists loyalty_ugc_sel on storage.objects;
create policy loyalty_ugc_sel on storage.objects for select to authenticated
  using (bucket_id = 'loyalty-ugc' and (auth.jwt() ->> 'email') ilike '%@amimi.it');

-- 6. Posti per caricare n foto oggi (giorno di Roma). Atomico: l'update condizionato non sfora il tetto.
create or replace function public.loyalty_ugc_slot(p_customer text, p_n int) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
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
end; $function$;
revoke all on function public.loyalty_ugc_slot(text, int) from anon, authenticated, public;
grant execute on function public.loyalty_ugc_slot(text, int) to service_role;

-- 7. Invio di una recensione o di un look. Controlla tutto a DB: tipo, borsa, stelle, testo, foto (nella cartella della
--    cliente, caricate davvero, mai gia' usate), borsa comprata online (obbligatoria per la recensione), tetto di 5 invii
--    in 24 ore. Ripetere lo stesso invio (stesso idemp) da' la stessa risposta. Nessun punto qui.
create or replace function public.loyalty_ugc_submit(p_customer text, p_kind text, p_codice text, p_rating int, p_testo text,
                                                     p_firma text, p_foto text[], p_consenso boolean, p_idemp text) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_codice text   := upper(trim(coalesce(p_codice, '')));
  v_testo  text   := nullif(trim(coalesce(p_testo, '')), '');
  v_firma  text   := nullif(trim(coalesce(p_firma, '')), '');
  v_foto   text[] := coalesce(p_foto, '{}'::text[]);
  v_idemp  text   := trim(coalesce(p_idemp, ''));
  v_row    loyalty_ugc%rowtype;
  v_ver    boolean;
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

  -- la borsa: comprata online da LEI (cio' che rende la recensione verificata), titolo dal catalogo
  v_ver := exists (select 1 from loyalty_order_credits c join shopify_line_items li on li.order_id = c.order_name
                   where c.shopify_customer_id = p_customer and coalesce(nullif(li.codice_norm, ''), li.codice) = v_codice);
  select shopify_title into v_tit from shopify_stock where codice = v_codice and shopify_title is not null order by shopify_status = 'active' desc limit 1;
  if p_kind = 'recensione' and not v_ver then return jsonb_build_object('ok', false, 'reason', 'not_bought'); end if;
  if v_tit is null and not v_ver then return jsonb_build_object('ok', false, 'reason', 'unknown_bag'); end if;

  select count(*) into v_n from loyalty_ugc where shopify_customer_id = p_customer and created_at > now() - interval '24 hours';
  if v_n >= 5 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;

  insert into loyalty_ugc (shopify_customer_id, kind, codice, titolo, rating, testo, firma, foto, verificata, consenso_testo, idemp)
    values (p_customer, p_kind, v_codice, v_tit, case when p_kind = 'recensione' then p_rating end, v_testo, v_firma, v_foto, v_ver,
            loyalty_ugc_consenso(), v_idemp)
    on conflict do nothing
    returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'already_sent'); end if;   -- stessa borsa e tipo gia' inviati
  return jsonb_build_object('ok', true, 'already', false, 'id', v_id, 'status', 'in_revisione', 'punti', loyalty_ugc_points(p_kind), 'verificata', v_ver);
end; $function$;
revoke all on function public.loyalty_ugc_submit(text, text, text, int, text, text, text[], boolean, text) from anon, authenticated, public;
grant execute on function public.loyalty_ugc_submit(text, text, text, int, text, text, text[], boolean, text) to service_role;

-- 8. Cosa vede la cliente: i suoi invii (ultimi 30, mai le foto), i punti per tipo, il testo del consenso e le borse a
--    catalogo per il look (una riga per codice, solo schede attive). Sola lettura.
create or replace function public.loyalty_ugc_info(p_customer text) returns jsonb
language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'punti', jsonb_build_object('recensione', loyalty_ugc_points('recensione'), 'look', loyalty_ugc_points('look')),
    'consenso', loyalty_ugc_consenso(),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object(
               'id', u.id, 'kind', u.kind, 'codice', u.codice, 'titolo', u.titolo, 'rating', u.rating, 'foto', cardinality(u.foto),
               'status', u.status, 'motivo', u.motivo, 'punti', coalesce(u.punti, loyalty_ugc_points(u.kind)),
               'created_day', (u.created_at at time zone 'Europe/Rome')::date) order by u.created_at desc), '[]'::jsonb)
             from (select * from loyalty_ugc where shopify_customer_id = p_customer order by created_at desc limit 30) u),
    'catalogo', (select coalesce(jsonb_agg(jsonb_build_object('codice', b.codice, 'titolo', b.titolo) order by b.titolo), '[]'::jsonb)
                 from (select distinct on (codice) codice, shopify_title as titolo from shopify_stock
                       where shopify_status = 'active' and codice ilike '%\_BAG\_%' and shopify_title is not null
                       order by codice) b))
$function$;
revoke all on function public.loyalty_ugc_info(text) from anon, authenticated, public;
grant execute on function public.loyalty_ugc_info(text) to service_role;

-- 9. Il team (login @amimi.it, dall'app): la coda e la decisione. Stessa guardia della dashboard (0147).
create or replace function public.loyalty_ugc_queue(p_status text default 'in_revisione', p_limit int default 60) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
begin
  if v_email not ilike '%@amimi.it' then
    raise exception 'loyalty_ugc_queue: riservato agli account @amimi.it' using errcode = '42501';
  end if;
  if p_status not in ('in_revisione', 'approvata', 'rifiutata') then raise exception 'stato non valido' using errcode = '22023'; end if;
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
end; $function$;
revoke all on function public.loyalty_ugc_queue(text, int) from anon, authenticated, public;
grant execute on function public.loyalty_ugc_queue(text, int) to authenticated;

-- Approva = punti (per tipo, dalla funzione sopra, mai dal client) e riga nel ledger nella stessa transazione; rifiuta =
-- motivo obbligatorio, nessun punto. Decidere una riga gia' decisa risponde already (doppio tap, due persone insieme).
create or replace function public.loyalty_ugc_decide(p_id bigint, p_decisione text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_email  text := coalesce(auth.jwt() ->> 'email', '');
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_row    loyalty_ugc%rowtype;
  v_pts    int;
  v_new    int;
  v_gate   int;
begin
  if v_email not ilike '%@amimi.it' then
    raise exception 'loyalty_ugc_decide: riservato agli account @amimi.it' using errcode = '42501';
  end if;
  if p_decisione not in ('approva', 'rifiuta') then return jsonb_build_object('ok', false, 'reason', 'bad_request'); end if;
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
end; $function$;
revoke all on function public.loyalty_ugc_decide(bigint, text, text) from anon, authenticated, public;
grant execute on function public.loyalty_ugc_decide(bigint, text, text) to authenticated;

-- 10. Tracciamento: le due liste chiuse si allungano (sezione e tap della pagina; 'mimi' = tocco su Mimi' che cambia
--     solo frase, rinuncia del Gate 2 del 12-10 chiusa qui). Corpo identico alla 0150.
create or replace function public.loyalty_track(p_customer text, p_events jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
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
revoke all on function public.loyalty_track(text, jsonb) from anon, authenticated, public;
grant execute on function public.loyalty_track(text, jsonb) to service_role;

-- 11. Traccia della migrazione
insert into change_log (tbl, row_id, op, after, chi, source) values
  ('loyalty_points', 'migr_0153', 'schema',
   '{"migr":"0153_loyalty_ugc","nuovo":["loyalty_ugc","loyalty_ugc_slots","bucket loyalty-ugc","loyalty_ugc_points()","loyalty_ugc_consenso()","loyalty_ugc_slot()","loyalty_ugc_submit()","loyalty_ugc_info()","loyalty_ugc_queue()","loyalty_ugc_decide()"],"ridefinito":["loyalty_track (liste)"],"flag":["loyalty_ugc_enabled=false"],"punti":{"recensione":20,"look":30}}'::jsonb,
   'claude-code', 'migration_0153');
