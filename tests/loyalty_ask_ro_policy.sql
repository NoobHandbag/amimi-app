-- Prova della migr 0151 (CASI_APERTI 32): ask_ro conta le stesse righe che conta il proprietario, tabella per tabella, e
-- le colonne vietate restano vietate. Gira in produzione senza lasciare righe: il blocco finisce SEMPRE con
-- raise 'TEST_OK ...' (o con l'errore del controllo fallito), quindi le righe di prova tornano indietro (resta solo
-- l'avanzamento della sequenza di loyalty_ui_events.id). Lanciare con execute_sql o psql; atteso: ERROR "TEST_OK loyalty 0151".
--
-- Tre livelli, perche' il solo confronto dei conteggi e' verde anche su una tabella vuota (0 = 0), e in produzione
-- loyalty_profiles, loyalty_birthday_awards e loyalty_bonus_second sono vuote (Gate 2 del 12-10, rilievi 2 e 3):
--   1. catalogo: ogni tabella ha esattamente una policy di sola lettura per ask_ro (vale anche a tabella vuota);
--   2. colonne: l'insieme delle colonne leggibili da ask_ro e' ESATTAMENTE quello deciso (una colonna nuova o un
--      grant allargato fanno fallire la prova), e ogni colonna vietata da' errore anche a una SELECT vera;
--   3. righe: conteggio di ask_ro uguale a quello vero, con righe di prova inserite dove non costano vincoli.
do $$
declare
  t text;
  col text;
  attese text;
  lette text;
  vero bigint;
  letto bigint;
  c text := 'TEST_ASKRO_0151';
  -- tabella -> colonne che ask_ro DEVE poter leggere (tutte e sole), in ordine alfabetico
  leggibili jsonb := '{
    "loyalty_points":          "points,shopify_customer_id,updated_at",
    "loyalty_events":          "created_at,delta,id,meta,shopify_customer_id,source",
    "loyalty_order_credits":   "created_at,order_name,order_total,points,shopify_customer_id,shopify_order_id",
    "loyalty_order_reversals": "points_reversed,refunded_amount,shopify_order_id,updated_at",
    "loyalty_rewards":         "active,cost_points,created_at,key,kind,label,sort,value",
    "loyalty_redemptions":     "cost_points,created_at,fulfilled_at,id,reward_key,shopify_customer_id,status",
    "loyalty_reward_codes":    "claimed_at,claimed_by,created_at,redemption_id,reward_key",
    "loyalty_visits":          "day,first_at,hits,last_at,shopify_customer_id",
    "loyalty_profiles":        "completed_at,consenso_compleanno,created_at,materiale_preferito,shopify_customer_id,updated_at",
    "loyalty_birthday_awards": "created_at,points,shopify_customer_id,year",
    "loyalty_bonus_second":    "created_at,first_order_at,first_order_id,points,points_reversed,reversed_at,second_order_at,second_order_id,shopify_customer_id",
    "loyalty_ui_events":       "at,day,element,event,id,shopify_customer_id"
  }'::jsonb;
  -- colonne che ask_ro NON deve leggere mai
  vietate text[][] := array[
    ['loyalty_profiles', 'birth_day'], ['loyalty_profiles', 'birth_month'], ['loyalty_profiles', 'birth_set_at'],
    ['loyalty_profiles', 'consenso_at'], ['loyalty_redemptions', 'discount_code'], ['loyalty_redemptions', 'meta'],
    ['loyalty_redemptions', 'idemp'], ['loyalty_reward_codes', 'code'], ['loyalty_birthday_awards', 'birthday']
  ];
  i int;
begin
  if (select count(*) from jsonb_object_keys(leggibili)) <> 12 then raise exception '0151: attese 12 tabelle nella prova'; end if;

  -- 1 + 2a. catalogo: una policy di sola lettura per ask_ro, colonne leggibili = quelle decise
  for t, attese in select key, value from jsonb_each_text(leggibili) loop
    if (select count(*) from pg_policy p
         where p.polrelid = ('public.' || t)::regclass and p.polcmd = 'r'
           and p.polroles = array['ask_ro'::regrole::oid] and pg_get_expr(p.polqual, p.polrelid) = 'true') <> 1 then
      raise exception '0151: % senza la sua policy di sola lettura per ask_ro', t;
    end if;
    if exists (select 1 from pg_policy p where p.polrelid = ('public.' || t)::regclass and p.polcmd <> 'r') then
      raise exception '0151: % ha una policy che non e'' di sola lettura', t;
    end if;
    select string_agg(a.attname, ',' order by a.attname) into lette
      from pg_attribute a
     where a.attrelid = ('public.' || t)::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('ask_ro', a.attrelid, a.attnum, 'select');
    if lette is distinct from attese then raise exception '0151: % colonne leggibili da ask_ro = [%], attese [%]', t, lette, attese; end if;
    if has_table_privilege('ask_ro', 'public.' || t, 'insert, update, delete, truncate') then
      raise exception '0151: ask_ro puo'' scrivere su %', t;
    end if;
  end loop;

  -- righe di prova dove non servono vincoli (tornano indietro col raise finale)
  insert into loyalty_points (shopify_customer_id, points) values (c, 1);
  insert into loyalty_visits (shopify_customer_id, day) values (c, current_date);
  insert into loyalty_ui_events (shopify_customer_id, day, event) values (c, current_date, 'page_open');
  insert into loyalty_profiles (shopify_customer_id) values (c);
  insert into loyalty_birthday_awards (shopify_customer_id, year, points, birthday) values (c, 1900, 1, date '1900-01-01');

  -- 3. righe: ask_ro conta quanto il proprietario
  for t in select jsonb_object_keys(leggibili) loop
    execute format('select count(*) from public.%I', t) into vero;
    set local role ask_ro;
    execute format('select count(*) from public.%I', t) into letto;
    reset role;
    if vero <> letto then raise exception '0151: % ask_ro legge % righe contro % vere', t, letto, vero; end if;
  end loop;

  -- le righe di prova si vedono davvero (niente verde da tabelle vuote)
  set local role ask_ro;
  if (select count(*) from loyalty_points where shopify_customer_id = c) <> 1 then raise exception '0151: saldo di prova non letto'; end if;
  if (select count(*) from loyalty_visits where shopify_customer_id = c) <> 1 then raise exception '0151: visita di prova non letta'; end if;
  if (select count(*) from loyalty_ui_events where shopify_customer_id = c) <> 1 then raise exception '0151: evento di prova non letto'; end if;
  if (select count(*) from loyalty_profiles where shopify_customer_id = c) <> 1 then raise exception '0151: profilo di prova non letto'; end if;
  if (select count(*) from loyalty_birthday_awards where shopify_customer_id = c) <> 1 then raise exception '0151: compleanno di prova non letto'; end if;
  reset role;

  -- 2b. colonne vietate: errore esplicito anche a una SELECT vera, mai un valore
  for i in 1 .. array_length(vietate, 1) loop
    t := vietate[i][1]; col := vietate[i][2];
    if not exists (select 1 from pg_attribute a where a.attrelid = ('public.' || t)::regclass and a.attname = col and not a.attisdropped) then
      raise exception '0151: la colonna vietata %.% non esiste piu'' (aggiornare la prova)', t, col;
    end if;
    set local role ask_ro;
    begin
      execute format('select %I from public.%I limit 1', col, t);
      raise exception '0151: %.% leggibile da ask_ro', t, col;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;

  -- sola lettura anche alla prova: nessuna scrittura per ask_ro
  set local role ask_ro;
  begin delete from loyalty_visits where shopify_customer_id = c; raise exception '0151: ask_ro ha cancellato';
  exception when insufficient_privilege then null; end;
  reset role;

  raise exception 'TEST_OK loyalty 0151';
end $$;
