-- Prova della migr 0151 (CASI_APERTI 32): ask_ro conta le stesse righe che conta il proprietario, tabella per tabella, e
-- le colonne vietate restano vietate. Gira in produzione senza lasciare tracce: il blocco finisce SEMPRE con
-- raise 'TEST_OK ...' (o con l'errore del controllo fallito). Lanciare con execute_sql o psql; atteso: ERROR "TEST_OK loyalty 0151".
-- Il confronto e' tabella per tabella: una tabella vuota passa (0 = 0), quindi il blocco inserisce prima una riga di prova
-- dove serve per non dare un falso verde.
do $$
declare
  t text;
  vero bigint;
  letto bigint;
  tabelle text[] := array[
    'loyalty_points', 'loyalty_events', 'loyalty_order_credits', 'loyalty_order_reversals',
    'loyalty_rewards', 'loyalty_redemptions', 'loyalty_reward_codes', 'loyalty_visits',
    'loyalty_profiles', 'loyalty_birthday_awards', 'loyalty_bonus_second', 'loyalty_ui_events'
  ];
  c text := 'TEST_ASKRO_0151';
begin
  -- righe di prova nelle tabelle semplici (tutto torna indietro col raise finale)
  insert into loyalty_points (shopify_customer_id, points) values (c, 1);
  insert into loyalty_visits (shopify_customer_id, day) values (c, current_date);
  insert into loyalty_ui_events (shopify_customer_id, day, event) values (c, current_date, 'page_open');

  foreach t in array tabelle loop
    -- conteggio vero (owner)
    execute format('select count(*) from public.%I', t) into vero;
    -- conteggio di ask_ro: SELECT sulla colonna garantita a tutte (tramite una colonna a grant, mai *)
    set local role ask_ro;
    begin
      execute format('select count(*) from public.%I', t) into letto;
    exception when insufficient_privilege then
      -- tabelle col solo grant a colonne: count(*) non e' ammesso, si legge una colonna garantita
      execute format('select count(%s) from public.%I', case t
        when 'loyalty_profiles' then 'shopify_customer_id'
        when 'loyalty_redemptions' then 'id'
        when 'loyalty_reward_codes' then 'reward_key'
        when 'loyalty_birthday_awards' then 'shopify_customer_id'
        else '1' end, t) into letto;
    end;
    reset role;
    if vero <> letto then raise exception '0151: % ask_ro legge % righe contro % vere', t, letto, vero; end if;
  end loop;

  -- almeno le righe di prova devono essere visibili (niente verde da tabelle tutte vuote)
  set local role ask_ro;
  if (select count(*) from loyalty_visits where shopify_customer_id = c) <> 1 then raise exception '0151: visita di prova non letta'; end if;
  if (select count(*) from loyalty_ui_events where shopify_customer_id = c) <> 1 then raise exception '0151: evento di prova non letto'; end if;
  reset role;

  -- le colonne vietate restano vietate (errore esplicito, mai un valore)
  set local role ask_ro;
  begin perform birth_day from loyalty_profiles limit 1; raise exception '0151: birth_day leggibile da ask_ro';
  exception when insufficient_privilege then null; end;
  begin perform birth_month from loyalty_profiles limit 1; raise exception '0151: birth_month leggibile da ask_ro';
  exception when insufficient_privilege then null; end;
  begin perform discount_code from loyalty_redemptions limit 1; raise exception '0151: discount_code leggibile da ask_ro';
  exception when insufficient_privilege then null; end;
  begin perform code from loyalty_reward_codes limit 1; raise exception '0151: code leggibile da ask_ro';
  exception when insufficient_privilege then null; end;
  reset role;

  -- sola lettura: nessuna scrittura per ask_ro
  set local role ask_ro;
  begin delete from loyalty_visits where shopify_customer_id = c; raise exception '0151: ask_ro ha cancellato';
  exception when insufficient_privilege then null; end;
  reset role;

  raise exception 'TEST_OK loyalty 0151';
end $$;
