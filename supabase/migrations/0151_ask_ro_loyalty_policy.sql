-- 0151: ask_ro legge davvero le 12 tabelle loyalty_* (CASI_APERTI 32, aperto l'11-10, OK di Dan il 12-10 su perimetro,
-- shopify_customer_id leggibile e colonne come sono).
--
-- Causa: ask_ro ha rolbypassrls = false e queste tabelle hanno la RLS accesa senza nessuna policy, quindi i GRANT
-- SELECT delle migr 0121-0147 davano zero righe senza errore (es. loyalty_ui_events: 0 contro 42 vere). Anche le viste
-- v_loyalty_* (security_invoker) leggevano zero. La 0150 aveva gia' corretto le sue due tabelle.
--
-- Fix: una policy `for select to ask_ro using (true)` per tabella. NON cambia nessun grant: i limiti a colonne gia'
-- decisi restano (loyalty_profiles senza birth_day/birth_month, loyalty_redemptions senza discount_code/meta,
-- loyalty_reward_codes senza code, loyalty_birthday_awards senza birthday). La policy apre le righe, il grant decide
-- le colonne. Nessuna scrittura, nessun dato toccato, nessun'altra tabella (cs_* e lead_* restano revocate per scelta
-- della 0121: danno errore esplicito, non zero silenzioso).
-- Idempotente (drop policy if exists), una transazione.

do $$
declare
  t text;
  tabelle text[] := array[
    'loyalty_points', 'loyalty_events', 'loyalty_order_credits', 'loyalty_order_reversals',
    'loyalty_rewards', 'loyalty_redemptions', 'loyalty_reward_codes', 'loyalty_visits',
    'loyalty_profiles', 'loyalty_birthday_awards', 'loyalty_bonus_second', 'loyalty_ui_events'
  ];
begin
  foreach t in array tabelle loop
    execute format('drop policy if exists %I on public.%I', t || '_ask_ro', t);
    execute format('create policy %I on public.%I for select to ask_ro using (true)', t || '_ask_ro', t);
  end loop;

  -- controllo: ogni tabella ha esattamente una policy per ask_ro, di sola lettura
  foreach t in array tabelle loop
    if (select count(*) from pg_policy p
         where p.polrelid = ('public.' || t)::regclass
           and 'ask_ro'::regrole = any (p.polroles)
           and p.polcmd = 'r') <> 1 then
      raise exception '0151: policy ask_ro mancante o doppia su %', t;
    end if;
  end loop;
end $$;
