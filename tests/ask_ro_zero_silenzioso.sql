-- Prova della migr 0152 e guardia di classe (CASI_APERTI 32 e 33): nessuna tabella di `public` puo' avere la RLS accesa,
-- il SELECT dato ad ask_ro e nessuna policy di lettura che lo riguardi. In quello stato ask_ro (Cowork, "Chiedi ad
-- Amimi") legge zero righe senza errore. SOLA LETTURA: nessuna riga di prova, il blocco finisce SEMPRE con
-- raise 'TEST_OK ...' (o con l'errore del controllo fallito). Lanciare con execute_sql o psql; atteso:
-- ERROR "TEST_OK ask_ro zero silenzioso". Le loyalty_* hanno anche la loro prova a colonne (loyalty_ask_ro_policy.sql).
do $$
declare
  t text;
  rotte text;
  vero bigint;
  letto bigint;
begin
  -- classe: RLS accesa + SELECT (di tabella o di colonna) ad ask_ro + nessuna policy di lettura per ask_ro o PUBLIC
  select string_agg(c.relname, ', ' order by c.relname) into rotte
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
     and (has_table_privilege('ask_ro', c.oid, 'select') or has_any_column_privilege('ask_ro', c.oid, 'select'))
     and not exists (select 1 from pg_policy p
                      where p.polrelid = c.oid and p.polcmd in ('r', '*')
                        and ('ask_ro'::regrole = any (p.polroles) or 0 = any (p.polroles)));
  if rotte is not null then raise exception 'ask_ro legge zero senza errore su: %', rotte; end if;

  -- le tre della 0152: conteggio di ask_ro uguale a quello vero, e nessuna scrittura
  foreach t in array array['mimi_state', 'app_guides', 'shipping_status'] loop
    execute format('select count(*) from public.%I', t) into vero;
    set local role ask_ro;
    execute format('select count(*) from public.%I', t) into letto;
    reset role;
    if vero <> letto then raise exception '0152: % ask_ro legge % righe contro % vere', t, letto, vero; end if;
    if has_table_privilege('ask_ro', 'public.' || t, 'insert, update, delete, truncate') then
      raise exception '0152: ask_ro puo'' scrivere su %', t;
    end if;
  end loop;
  -- non e' un verde da tabelle vuote: shipping_status e app_guides hanno righe
  set local role ask_ro;
  if (select count(*) from shipping_status) = 0 or (select count(*) from app_guides) = 0 then
    raise exception '0152: ask_ro legge ancora zero su shipping_status o app_guides';
  end if;
  reset role;

  raise exception 'TEST_OK ask_ro zero silenzioso';
end $$;
