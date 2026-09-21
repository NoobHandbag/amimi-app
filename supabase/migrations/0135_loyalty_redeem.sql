-- 0135 (Premia / Area Membri, Fase 3 RISCATTO): punti -> premio. Modulo ISOLATO (Regola 19):
-- tabelle proprie loyalty_rewards / loyalty_redemptions / loyalty_reward_codes, flag
-- loyalty_redeem_enabled default OFF, azione 'redeem' su loyalty-proxy. NON tocca CE / stock / checkout / tema.
-- Consegna premio SCOPE-FREE: la redemption "pesca" un codice sconto pre-generato dall'owner in Shopify
-- (out-of-the-box, nessuno scope write a runtime). Pool vuoto -> redemption 'pending' (l'owner la evade).
-- Idempotenza a DB (Regola 20): la redemption ha un idemp token univoco (insert-gate) e la detrazione
-- punti e' un UPDATE atomico con guardia points >= cost. Il claim del codice usa FOR UPDATE SKIP LOCKED.

-- Catalogo premi. L'owner definisce/tara valori e soglie (niente numeri "verita'": qui placeholder).
create table if not exists loyalty_rewards (
  key         text primary key,          -- es. 'tessera'
  label       text not null,             -- testo mostrato nel profilo
  cost_points int  not null check (cost_points > 0),
  kind        text not null,             -- 'percentage' | 'amount' | 'shipping' | 'manual'
  value       numeric,                   -- 10 (=10% o 10 EUR); null per shipping/manual
  active      boolean not null default true,
  sort        int not null default 100,
  created_at  timestamptz not null default now()
);
alter table loyalty_rewards enable row level security;
revoke all on loyalty_rewards from anon, authenticated;

-- Registro riscatti (uno per idemp token).
create table if not exists loyalty_redemptions (
  id            bigint generated always as identity primary key,
  idemp         text unique not null,               -- token client univoco: insert-gate anti doppio-click
  shopify_customer_id text not null,
  reward_key    text not null,
  cost_points   int  not null,
  status        text not null default 'pending',    -- 'pending' | 'fulfilled' | 'failed'
  discount_code text,
  created_at    timestamptz not null default now(),
  fulfilled_at  timestamptz,
  meta          jsonb
);
create index if not exists loyalty_redemptions_cust_idx on loyalty_redemptions (shopify_customer_id);
alter table loyalty_redemptions enable row level security;
revoke all on loyalty_redemptions from anon, authenticated;

-- Pool di codici sconto pre-generati dall'owner in Shopify (bulk, out-of-the-box). Nessuno scope write a runtime.
create table if not exists loyalty_reward_codes (
  code          text primary key,
  reward_key    text not null references loyalty_rewards(key),
  claimed_by    text,                                -- shopify_customer_id (null = libero)
  redemption_id bigint,
  claimed_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists loyalty_reward_codes_free_idx on loyalty_reward_codes (reward_key) where claimed_by is null;
alter table loyalty_reward_codes enable row level security;
revoke all on loyalty_reward_codes from anon, authenticated;

-- Detrazione ATOMICA e idempotente. Gate = insert redemption con idemp univoco (ON CONFLICT DO NOTHING).
-- Gia' presente -> 'already' (ritorna lo stato esistente). Poi UPDATE punti con guardia points>=cost:
-- se non trova, saldo insufficiente -> redemption 'failed' e 'insufficient'. Evento delta negativo 'redeem'.
create or replace function public.loyalty_redeem(
  p_customer text, p_reward_key text, p_idemp text
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_reward loyalty_rewards%rowtype;
  v_new int;
  v_id  bigint;
  v_ex  loyalty_redemptions%rowtype;
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
end;
$function$;
revoke all on function public.loyalty_redeem(text,text,text) from anon, authenticated, public;
grant execute on function public.loyalty_redeem(text,text,text) to service_role;

-- Claim ATOMICO di un codice libero dal pool (FOR UPDATE SKIP LOCKED). Segna la redemption 'fulfilled'.
-- Ritorna il codice o null (pool vuoto -> la redemption resta 'pending').
create or replace function public.loyalty_claim_code(
  p_reward_key text, p_customer text, p_redemption_id bigint
) returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare v_code text;
begin
  update loyalty_reward_codes
    set claimed_by = p_customer, redemption_id = p_redemption_id, claimed_at = now()
    where code = (
      select code from loyalty_reward_codes
      where reward_key = p_reward_key and claimed_by is null
      order by created_at limit 1 for update skip locked
    )
    returning code into v_code;
  if v_code is not null then
    update loyalty_redemptions set status = 'fulfilled', discount_code = v_code, fulfilled_at = now()
      where id = p_redemption_id;
  end if;
  return v_code;
end;
$function$;
revoke all on function public.loyalty_claim_code(text,text,bigint) from anon, authenticated, public;
grant execute on function public.loyalty_claim_code(text,text,bigint) to service_role;

-- Flag di riscatto: default OFF (Regola 19, rollback = flag).
insert into app_flags (key, value) values ('loyalty_redeem_enabled', 'false') on conflict (key) do nothing;

-- Catalogo iniziale: PLACEHOLDER (valore e soglia DA CONFERMARE dall'owner, Regola 1).
-- cost 200 = tessera piena (10 timbri x 20 pt, dal CONFIG live). value 10 = placeholder.
insert into loyalty_rewards (key, label, cost_points, kind, value, sort) values
  ('tessera', 'Tessera piena: il tuo sconto personale', 200, 'percentage', 10, 10)
on conflict (key) do nothing;
