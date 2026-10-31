-- 0181 (2026-10-31, CASI_APERTI n.53 (a) e (b), decisioni dell'owner del 31-10): allarme di fermo che non dipende dal
-- gateway di Supabase e avviso di spazio prima del ritorno al piano Free (ciclo del 07-11: Storage 1 GB, database 500 MB).
-- Dal 30-10 22:49 al 31-10 12:58 UTC ogni API dell'org ha risposto 402 per 14 ore e nessun allarme e' partito: ce-guard,
-- sales-guard, push-eventi e push-api stanno dietro lo stesso gateway, pg_cron segna `succeeded` anche sui 402.
--  (a) app_config.watchdog_pin_hash: colonna NUOVA, vuota. La riempie l'orchestratore/owner con lo sha256 esadecimale di un
--      PIN lungo e casuale (mai il PIN delle edge, mai nel repo): update app_config set watchdog_pin_hash = '<hex>' where
--      id = 1. Il PIN in chiaro sta solo nella Script Property WATCHDOG_PIN dell'Apps Script app-watchdog (hub,
--      amimi-finance-system/other-scripts/app-watchdog), che chiama la RPC ogni 10 minuti con la chiave pubblica e manda
--      la mail a info@ da Google, fuori da Supabase. Una risposta 402 alla RPC E' l'allarme del blocco.
--  (b) v_health: due righe in coda, storage_mb e db_mb (n = MB interi). warn da 700 MB di Storage e da 400 MB di database,
--      ok sotto; mai bad, quindi non accendono il banner rosso della Home (che legge solo bad): si vedono nella pagina
--      Salute dal giro delle 06:00 (refresh_health_log le copia in health_log come gli altri detector) e nella mail del
--      watchdog, che ha le stesse soglie. Le 12 righe di prima restano identiche (corpo della vista viva al 31-10, uguale
--      alla 0035); stesse colonne e tipi (n bigint). La dimensione dello Storage e' la somma di metadata.size di
--      storage.objects (la vista e' di postgres, BYPASSRLS: legge tutti i bucket); un size non numerico conta 0 invece di
--      rompere la vista. pg_database_size gira coi diritti di chi legge: CONNECT ce l'hanno anon, authenticated,
--      service_role e ask_ro (controllato qui sotto).
--  (c) watchdog_status(p_pin): SECURITY DEFINER, search_path public, execute SOLO ad anon (PostgREST con la chiave
--      pubblica). Hash assente = {ok:false, motivo:'non_configurato'}; PIN sbagliato o nullo = {ok:false} e nient'altro.
--      PIN giusto = soli aggregati, nessun testo libero (niente label di health_log, niente corpi di net._http_response):
--      ora del server; per sei giri la data dell'ultima riga health_log ('log'), dell'ultimo avvio riuscito del suo cron
--      ('cron', da cron.job_run_details) e se il giro e' acceso ('on', dal suo flag); risposte 402 e 5xx di pg_net negli
--      ultimi 30 minuti; Storage e database in MB con un decimale.
--      Perche' due date per giro (misurato il 31-10): ce-guard (k ce_*) e l'autopush di shopify-stock (k stock_autopush)
--      fanno l'upsert di health_log SENZA created_at, quindi created_at resta quello della prima riga del giorno UTC
--      (alle 14:45 ce_guard_letture diceva 13:30 con il cron passato alle 14:30, stock_autopush 13:27 con il cron alle
--      14:27). Per quei due il watchdog guarda 'cron'; per gli altri quattro, che scrivono created_at a ogni giro, 'log'.
--      refresh_health_log delle 06:00 UTC cancella le righe di oggi delle chiavi non ce_*: fino al giro dopo (06:02 cs-sync,
--      06:07 shopify-sync, 06:10 loyalty-orders) 'log' torna alla riga di ieri; il watchdog chiede tre giri di fila prima
--      di dire FERMO. Niente innesti in refresh_health_log ne' nelle edge (Regola 19): la funzione legge soltanto.
--      cron.job_run_details ha solo la chiave primaria su runid: si leggono gli ultimi 5.000 avvii (circa 70 ore ai ritmi
--      del 31-10, piu' delle 26 ore della soglia di ads-sync), non la tabella intera.
-- Nessun dato scritto, nessun cron, nessuna edge. Prova viva dopo l'apply: tests/watchdog_rls.sql. Prima dell'apply lo
-- stesso corpo gira in un blocco DO annullato (CONOSCENZA, 17-10): TEST_OK il 31-10 alle 15:03 UTC, nulla rimasto.
-- Numero 0181: la 0180 e' cs_denylist_chiusure_chat_ripristinate (altra sessione, in produzione dal 31-10 14:53 UTC).
-- Rollback: drop function public.watchdog_status(text); v_health col corpo della 0035; alter table app_config drop column
-- watchdog_pin_hash. L'Apps Script senza la funzione riceve 404 e manda una mail di configurazione.

-- (a) hash del PIN del watchdog: solo la colonna, nessun valore
alter table public.app_config add column if not exists watchdog_pin_hash text;

-- (b) v_health con Storage e database
create or replace view v_health as
with checks as (
  select 'img_missing'::text as k, 'Prodotti online senza immagine'::text as label,
    (select count(*) from v_inventory where on_shopify and image_url is null) as n
  union all
  select 'stock_neg', 'Prodotti con giacenza negativa',
    (select count(*) from v_inventory where giacenza_attuale < 0::numeric)
  union all
  select 'cogs_missing', 'Prodotti venduti senza COGS',
    (select count(*) from v_inventory where (coalesce(shopify_sold,0::numeric)+coalesce(qromo_sold,0::numeric)+coalesce(b2b_venduto,0::numeric)) > 0::numeric and coalesce(cogs,0::numeric) = 0::numeric)
  union all
  select 'price_missing', 'Prodotti su Shopify senza prezzo',
    (select count(*) from v_inventory where on_shopify and coalesce(retail_price,0::numeric) = 0::numeric)
  union all
  select 'orders_orphan', 'Righe ordine con codice non in anagrafica',
    (select count(*) from supplier_orders so where coalesce(so.codice,''::text) <> ''::text and not exists (select 1 from products p where p.codice_norm = upper(regexp_replace(so.codice,'\s+'::text,'_'::text,'g'::text))))
  union all
  select 'todo_products', 'Prodotti da completare',
    (select count(*) from v_products_todo)
  union all
  select 'lost_sales', 'SKU pubblicati ma esauriti',
    (select count(*) from v_sku_availability where stato = 'pubblicato_esaurito'::text)
  union all
  select 'shopify_orphan', 'Vendite Shopify non agganciate a un prodotto (ricavo con COGS 0, stock non scalato)',
    (select count(*) from shopify_line_items where coalesce(lineitem_name,''::text) <> ''::text and codice is null)
  union all
  select 'qromo_orphan', 'Vendite Qromo con codice non in anagrafica (ricavo sì, stock no)',
    (select count(*) from qromo_sales q where coalesce(q.codice,''::text) <> ''::text
        and not exists (select 1 from products p where p.codice_norm = q.codice_norm)
        and not exists (select 1 from non_product_codici n where upper(regexp_replace(n.codice,'\s+'::text,'_'::text,'g'::text)) = q.codice_norm))
  union all
  select 'dup_codice', 'CODICE duplicati in anagrafica (raddoppiano giacenza/valore)',
    (select count(*) from (select codice_norm from products group by codice_norm having count(*) > 1) d)
  union all
  select 'period_mismatch', 'Righe col mese/anno diverso dalla data (finiscono nel CE del mese sbagliato)',
    (
      (select count(*) from qromo_sales   where data is not null      and (year is distinct from extract(year from data)::int      or month is distinct from extract(month from data)::int))
    + (select count(*) from expenses      where date_paid is not null and (year is distinct from extract(year from date_paid)::int or month is distinct from extract(month from date_paid)::int))
    + (select count(*) from returns       where data is not null      and (year is distinct from extract(year from data)::int      or month is distinct from extract(month from data)::int))
    + (select count(*) from gifts_offline where data is not null      and (year is distinct from extract(year from data)::int      or month is distinct from extract(month from data)::int))
    + (select count(*) from b2b_movements where data is not null      and (year is distinct from extract(year from data)::int      or month is distinct from extract(month from data)::int))
    )
  union all
  select 'ce_drift_live', 'Mesi CHIUSI i cui numeri sono cambiati (netto o utile mc2)',
    (select count(*) from v_ce_drift where abs(coalesce(delta_netto,0::numeric)) > 0.01 or abs(coalesce(delta_mc2,0::numeric)) > 0.01)
  -- === 0181: spazio prima del piano Free (CASI_APERTI n.53 b) ===
  union all
  select 'storage_mb', 'Storage usato, MB (avviso da 700: il piano Free ne ha 1 GB)',
    (select round(coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::numeric else 0::numeric end), 0::numeric) / 1048576)::bigint
       from storage.objects o)
  union all
  select 'db_mb', 'Database usato, MB (avviso da 400: il piano Free ne ha 500)',
    round(pg_database_size(current_database())::numeric / 1048576)::bigint
)
select k, label, n,
  case
    when k = 'storage_mb'::text then case when n >= 700 then 'warn'::text else 'ok'::text end
    when k = 'db_mb'::text then case when n >= 400 then 'warn'::text else 'ok'::text end
    when n = 0 then 'ok'::text
    when k = any (array['stock_neg'::text,'cogs_missing'::text,'price_missing'::text,'orders_orphan'::text,'shopify_orphan'::text,'qromo_orphan'::text,'dup_codice'::text,'period_mismatch'::text,'ce_drift_live'::text]) then 'bad'::text
    else 'warn'::text
  end as severity
from checks;

-- (c) stato per il watchdog esterno: soli aggregati, dietro un PIN dedicato
create or replace function public.watchdog_status(p_pin text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_hash text;
  v_runid bigint;
begin
  select btrim(c.watchdog_pin_hash) into v_hash from public.app_config c where c.id = 1;
  if coalesce(v_hash, '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'non_configurato');
  end if;
  if p_pin is null or encode(sha256(convert_to(p_pin, 'UTF8')), 'hex') <> lower(v_hash) then
    return jsonb_build_object('ok', false);
  end if;

  select coalesce(max(d.runid), 0) - 5000 into v_runid from cron.job_run_details d;

  return jsonb_build_object(
    'ok', true,
    'now', now(),
    'giri', (
      select jsonb_object_agg(g.k, jsonb_build_object(
               'log', (select max(h.created_at) from public.health_log h where h.k = g.k and h.day >= current_date - 3),
               'cron', (select max(d.start_time) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                         where j.jobname = g.job and d.status = 'succeeded' and d.runid > v_runid),
               'on', case when g.flag is null then true
                          else exists (select 1 from public.app_flags f where f.key = g.flag and lower(btrim(f.value, E' \t\r\n')) = 'true') end))
        from (values
          ('shopify_sync',     'shopify-sync-hourly',     null::text),
          ('stock_autopush',   'shopify-autopush-hourly', 'shopify_autopush_enabled'),
          ('cs_sync',          'cs-sync-poll',            'cs_enabled'),
          ('loyalty_orders',   'loyalty-orders-poll',     'loyalty_purchase_enabled'),
          ('ce_guard_letture', 'ce-guard-daily',          null::text),
          ('ads_sync',         'ads-sync-daily',          null::text)
        ) as g(k, job, flag)
    ),
    'net_402_30m', (select count(*) from net._http_response r where r.status_code = 402 and r.created > now() - interval '30 minutes'),
    'net_5xx_30m', (select count(*) from net._http_response r where r.status_code between 500 and 599 and r.created > now() - interval '30 minutes'),
    'storage_mb', (select round(coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::numeric else 0::numeric end), 0::numeric) / 1048576, 1)
                     from storage.objects o),
    'db_mb', round(pg_database_size(current_database())::numeric / 1048576, 1)
  );
end $fn$;
revoke all on function public.watchdog_status(text) from public, anon, authenticated, service_role;
grant execute on function public.watchdog_status(text) to anon;

-- (d) prova dentro la stessa transazione: se qualcosa non torna la migrazione non passa
do $$
declare
  r name;
  v_grant text;
  v_res jsonb;
  v_n int;
begin
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.app_config'::regclass and a.attname = 'watchdog_pin_hash'
                   and not a.attisdropped and a.atttypid = 'text'::regtype) then
    raise exception '0181: app_config.watchdog_pin_hash mancante o non text';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.app_config', 'select') or has_column_privilege(r, 'public.app_config', 'watchdog_pin_hash', 'select') then
      raise exception '0181: % legge app_config', r;
    end if;
  end loop;

  if not (select p.prosecdef from pg_proc p where p.oid = 'public.watchdog_status(text)'::regprocedure) then
    raise exception '0181: watchdog_status deve essere security definer';
  end if;
  if not coalesce((select 'search_path=public' = any (p.proconfig) from pg_proc p where p.oid = 'public.watchdog_status(text)'::regprocedure), false) then
    raise exception '0181: watchdog_status senza search_path fisso';
  end if;
  if not has_function_privilege('anon', 'public.watchdog_status(text)', 'execute') then
    raise exception '0181: anon non esegue watchdog_status (il watchdog sarebbe cieco)';
  end if;
  foreach r in array array['authenticated', 'service_role', 'ask_ro'] loop
    if has_function_privilege(r, 'public.watchdog_status(text)', 'execute') then
      raise exception '0181: % esegue watchdog_status', r;
    end if;
  end loop;
  select string_agg(format('%s a %s', a.privilege_type, coalesce(g.rolname, 'PUBLIC')), ', ')
    into v_grant
    from pg_proc p
    cross join lateral aclexplode(p.proacl) a
    left join pg_roles g on g.oid = a.grantee
   where p.oid = 'public.watchdog_status(text)'::regprocedure
     and (a.grantee = 0 or g.rolname not in ('anon', 'postgres'));
  if v_grant is not null then raise exception '0181: privilegi di troppo su watchdog_status: %', v_grant; end if;

  -- un PIN a caso non apre niente, configurata o no
  v_res := public.watchdog_status(gen_random_uuid()::text);
  if v_res ->> 'ok' is distinct from 'false' or v_res ? 'giri' or v_res ? 'now' then
    raise exception '0181: watchdog_status con un PIN a caso risponde %', v_res;
  end if;

  -- v_health: 14 righe, le due nuove con un n e una gravita' ammessa, leggibile dai ruoli che la leggevano
  select count(*) into v_n from v_health;
  if v_n <> 14 then raise exception '0181: v_health ha % righe invece di 14', v_n; end if;
  if (select count(*) from v_health where k in ('storage_mb', 'db_mb') and n > 0 and severity in ('ok', 'warn')) <> 2 then
    raise exception '0181: storage_mb o db_mb mancanti, a zero o con gravita'' fuori da ok/warn';
  end if;
  foreach r in array array['anon', 'authenticated', 'ask_ro'] loop
    if not has_database_privilege(r, current_database(), 'connect') then
      raise exception '0181: % senza CONNECT, pg_database_size in v_health gli darebbe errore', r;
    end if;
  end loop;
end $$;
