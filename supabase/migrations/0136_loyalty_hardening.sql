-- 0136 (Premia / Area Membri, quest audit Fase 6, bundle A HARDENING). Additiva (Regola 19), idempotenza a DB (Regola 20).
-- Chiude: T16 cinture di schema; L4 claim idempotente (mai un secondo codice, mai sovrascrivere il codice del cliente);
-- L6 il ramo 'already' del riscatto risponde solo al proprietario dell'idemp; L3 accredito giochi ATOMICO (cancello
-- "1 al giorno" e incremento nella stessa transazione); L5/G2 storno resi proporzionale e idempotente (stato per
-- ordine); ponte order_name (colonna della 0137) nell'accredito acquisti; cursore dell'ultimo giro (L8).
-- Numerata 0136 perche' progettata prima della 0137 gia' applicata: ordine di applicazione 0137 -> 0136, e la 0136
-- USA order_name della 0137 (nessuna dipendenza inversa). Il blocco DO in testa verifica che i dati ATTUALI rispettino
-- gia' ogni cintura: se no la migrazione si ferma intera, senza toccare nulla.

do $$
begin
  if exists (select 1 from loyalty_points where points < 0) then raise exception 'pre-check: loyalty_points.points < 0'; end if;
  if exists (select 1 from loyalty_redemptions where status not in ('pending','fulfilled','failed')) then raise exception 'pre-check: loyalty_redemptions.status fuori enum'; end if;
  if exists (select 1 from loyalty_redemptions r left join loyalty_rewards w on w.key = r.reward_key where w.key is null) then raise exception 'pre-check: loyalty_redemptions.reward_key orfano'; end if;
  if exists (select 1 from loyalty_reward_codes c left join loyalty_redemptions r on r.id = c.redemption_id where c.redemption_id is not null and r.id is null) then raise exception 'pre-check: loyalty_reward_codes.redemption_id orfano'; end if;
  if exists (select 1 from loyalty_reward_codes where redemption_id is not null group by redemption_id having count(*) > 1) then raise exception 'pre-check: piu'' codici per la stessa redemption'; end if;
  if exists (select 1 from loyalty_order_credits where points <= 0) then raise exception 'pre-check: loyalty_order_credits.points <= 0'; end if;
  if exists (select 1 from loyalty_rewards where kind not in ('percentage','amount','shipping','manual')) then raise exception 'pre-check: loyalty_rewards.kind fuori enum'; end if;
end $$;

-- 1. Cinture di schema (T16)
alter table loyalty_points add constraint loyalty_points_points_nonneg check (points >= 0);
alter table loyalty_redemptions add constraint loyalty_redemptions_status_chk check (status in ('pending','fulfilled','failed'));
alter table loyalty_redemptions add constraint loyalty_redemptions_reward_fk foreign key (reward_key) references loyalty_rewards(key);
alter table loyalty_reward_codes add constraint loyalty_reward_codes_redemption_fk foreign key (redemption_id) references loyalty_redemptions(id);
create unique index loyalty_reward_codes_redemption_uq on loyalty_reward_codes (redemption_id) where redemption_id is not null;
alter table loyalty_order_credits add constraint loyalty_order_credits_points_pos check (points > 0);
alter table loyalty_rewards add constraint loyalty_rewards_kind_chk check (kind in ('percentage','amount','shipping','manual'));

-- 2. L4: claim IDEMPOTENTE. La redemption deve esistere, essere del cliente e del premio chiesto (altrimenti null,
--    nessuna informazione); gia' evasa -> lo STESSO codice senza toccare il pool; failed -> null; pending -> pesca un
--    codice libero (FOR UPDATE SKIP LOCKED) e la evade. La riga della redemption e' il lucchetto (FOR UPDATE).
create or replace function public.loyalty_claim_code(p_reward_key text, p_customer text, p_redemption_id bigint) returns text
language plpgsql security definer set search_path to 'public' as $function$
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
end; $function$;

-- 3. L6: il conflitto su idemp risponde SOLO al cliente proprietario (altrimenti bad_request, nessuna informazione)
create or replace function public.loyalty_redeem(p_customer text, p_reward_key text, p_idemp text) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
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
end; $function$;

-- 4. L3: accredito giornaliero ATOMICO (coccola +5, memory +5). La riga mimi_state e' il lucchetto: l'UPDATE con
--    guardia "data < oggi" e l'incremento dei punti stanno nella stessa transazione. Due richieste concorrenti:
--    la seconda rivaluta la guardia dopo il commit della prima (row_count 0) e risponde done_today senza scrivere.
create or replace function public.loyalty_award_daily(p_customer text, p_kind text, p_delta int, p_day date) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
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
end; $function$;
revoke all on function public.loyalty_award_daily(text, text, int, date) from anon, authenticated, public;
grant execute on function public.loyalty_award_daily(text, text, int, date) to service_role;

-- 5. L5/G2: STORNO resi. Stato per ordine (quanto stornato finora): ogni chiamata porta lo stornato al target
--    proporzionale floor(points * min(refunded/total, 1)), mai oltre i punti accreditati; con total sconosciuto lo
--    storno e' pieno (conservativo). Non scende mai sotto zero di saldo (D-L7: si limita al saldo e riprova al giro
--    dopo, quando il saldo torna). Idempotente per costruzione: rilanciare non storna due volte.
create table if not exists loyalty_order_reversals (
  shopify_order_id text primary key references loyalty_order_credits(shopify_order_id),
  points_reversed int not null default 0 check (points_reversed >= 0),
  refunded_amount numeric,
  updated_at timestamptz not null default now()
);
alter table loyalty_order_reversals enable row level security;
revoke all on loyalty_order_reversals from anon, authenticated;
grant select on loyalty_order_reversals to ask_ro;

create or replace function public.loyalty_reverse_order(p_order_id text, p_refunded numeric) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
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
end; $function$;
revoke all on function public.loyalty_reverse_order(text, numeric) from anon, authenticated, public;
grant execute on function public.loyalty_reverse_order(text, numeric) to service_role;

-- Coda di storno DB-driven (S7): accrediti il cui ordine ha un rimborso in shopify_orders (refund_amount = somma delle
-- transazioni di rimborso, aggiornato ogni ora da shopify-sync per gli ordini toccati negli ultimi 45 giorni) non
-- ancora stornati al target. La edge loyalty-orders v3 la legge a fine giro e con l'action 'refunds'; si legge anche a mano.
create or replace view v_loyalty_refunds_due with (security_invoker = true) as
select c.shopify_order_id, c.order_name, c.shopify_customer_id, c.points, c.order_total,
       o.refund_amount, o.financial_status,
       coalesce(r.points_reversed, 0) as points_reversed,
       case when coalesce(c.order_total, 0) <= 0 then c.points
            else least(c.points, floor(c.points * least(o.refund_amount / c.order_total, 1)))::int end as target
from loyalty_order_credits c
join shopify_orders o on o.order_id = c.order_name
left join loyalty_order_reversals r on r.shopify_order_id = c.shopify_order_id
where coalesce(o.refund_amount, 0) > 0
  and (case when coalesce(c.order_total, 0) <= 0 then c.points
            else least(c.points, floor(c.points * least(o.refund_amount / c.order_total, 1)))::int end) > coalesce(r.points_reversed, 0);
grant select on v_loyalty_refunds_due to ask_ro;

-- 6. Ponte order_name nell'accredito: overload a 5 argomenti (la edge v3 lo usa; il vecchio a 4 resta per compatibilita').
--    Sul ramo 'already' completa order_name degli accrediti vecchi che non lo hanno: idempotente.
create or replace function public.loyalty_credit_order(p_order_id text, p_customer_id text, p_points int, p_total numeric, p_order_name text) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
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
end; $function$;
revoke all on function public.loyalty_credit_order(text, text, int, numeric, text) from anon, authenticated, public;
grant execute on function public.loyalty_credit_order(text, text, int, numeric, text) to service_role;

-- 7. Dato di test: l'unico accredito esistente (#1781, ordine di test poi annullato e rimborsato per intero) prende il
--    suo order_name, cosi' la coda di storno lo vede e il primo giro 'refunds' lo storna (prova viva di G2).
update loyalty_order_credits set order_name = '#1781' where shopify_order_id = '8173406093639' and order_name is null;

-- 8. Cursore dell'ultimo giro riuscito (L8): la edge v3 allarga la finestra updated_at fino all'ultimo giro se il cron
--    e' rimasto fermo piu' di 3 giorni. Vuoto = nessun giro ancora.
insert into app_flags (key, value) values ('loyalty_orders_last_run', '') on conflict (key) do nothing;

insert into change_log (tbl, row_id, op, after, chi, source) values
  ('loyalty_points', 'migr_0136', 'schema',
   '{"migr":"0136_loyalty_hardening","fix":["T16 cinture","L4 claim idempotente","L6 idemp del proprietario","L3 loyalty_award_daily","L5/G2 loyalty_reverse_order + v_loyalty_refunds_due","order_name in loyalty_credit_order","loyalty_orders_last_run"]}'::jsonb,
   'claude-code', 'quest-audit-fase6');
