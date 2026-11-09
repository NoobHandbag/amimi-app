-- 0190 (2026-11-09, chiesta da Dan in chat): allarme sui pezzi a magazzino che non sono in vendita sul sito.
-- Il 09-11 (verifica di un commento di Grok) c'erano 77 pezzi arrivati e mai messi in vendita, e nessun controllo lo diceva:
-- 30 Maxi Cocco Burgundy dal 16-10 e 10 Zebra Pony dal 03-11 su un codice doppio senza pagina Shopify (la pagina viva sta
-- su un altro codice), 27 Maxi Suede Black Charm senza scheda, 10 Suede Burgundy in bozza; in piu' 20 Annie Maxi Nappa
-- arrivate il 06-11 senza scheda, che nessuno aveva visto. La coda v_products_to_publish era cieca (chiede
-- products.image_url, vuota su tutti i 230 prodotti) e il controllo dup_codice confronta solo codici identici.
--  (a) v_stock_fermo: un codice per riga con pezzi disponibili da vendere (v_inventory.disponibili_da_vendere > 0, quindi
--      conto vendita escluso) e NESSUNA riga Shopify attiva fra quelle viste dall'ultimo giro di sync (finestra di 2 ore
--      sul max synced_at, come la 0074: il mirror non pota le righe di un prodotto tolto da Shopify, e v_inventory.on_shopify
--      le conta ancora), fermo da almeno 3 giorni. fermo_dal = la data d'arrivo del pezzo PIU' VECCHIO ancora a magazzino
--      (FIFO: gli arrivi con quantita > 0, dal piu' recente indietro, finche' la loro somma copre i pezzi; se non la copre,
--      il primo arrivo; senza arrivi conta come fermo). Non l'ultimo arrivo: un riordino arrivato ieri non deve nascondere
--      per altri 3 giorni i pezzi fermi da settimane (Gate 2 del 09-11). Giorni contati sul calendario di Roma, come le date
--      degli arrivi, non su current_date del server (UTC). Fuori i codici di non_product_codici (GIFT_CARD e simili).
--      stato_shopify = 'assente' se il codice non ha righe fresche, altrimenti gli stati visti (draft, archived).
--      Colonne: codice, item, variant, pezzi, fermo_dal, giorni, stato_shopify, valore (pezzi per prezzo).
--      Limite noto (Gate 2, rinuncia consapevole): un codice tenuto fuori dal sito apposta (pezzi su misura da sposa, per
--      esempio) resta nell'elenco finche' ha pezzi; un'esclusione voluta richiede un'azione write-api nuova, CASI_APERTI.
--  (b) v_health: riga nuova stock_fermo in coda (n = righe di v_stock_fermo), gravita' 'bad': entra nel giro delle 06:00
--      (refresh_health_log copia v_health in health_log, pagina Salute) e nel banner della Home di Ale. Le 14 righe di
--      prima sono identiche alla 0181 (pin in tests/stock_fermo_guardie.mjs), stesse colonne e tipi.
-- Nessun dato scritto, nessun cron, nessuna edge, nessun innesto in refresh_health_log (la copia la fa gia' da sola).
-- La scheda per tutto il team (anche Benny e Ginni, che il banner non vedono) la legge il frontend da v_stock_fermo.
-- Prova dentro la migrazione (blocco DO in fondo). Numero 0190: in origin/main e in produzione l'ultima e' la 0189.
-- Rollback: v_health col corpo della 0181, poi drop view public.v_stock_fermo.

-- (a) i codici fermi
create or replace view public.v_stock_fermo as
with shop as (
  select upper(regexp_replace(coalesce(s.codice, ''::text), '\s+'::text, '_'::text, 'g'::text)) as codice_norm,
         bool_or(coalesce(s.shopify_status, 'active'::text) = 'active'::text) as attivo,
         string_agg(distinct coalesce(s.shopify_status, 'active'::text), ','::text) as stati
    from shopify_stock s
   where coalesce(s.codice, ''::text) <> ''::text
     and s.synced_at >= (select coalesce(max(s1.synced_at), now()) from shopify_stock s1) - interval '2 hours'
   group by 1
), arr as (
  select p.codice_norm, p.data,
         sum(p.quantita) over (partition by p.codice_norm order by p.data desc, p.id rows unbounded preceding) as cum
    from purchases p
   where p.quantita > 0::numeric and p.data is not null
), fermi as (
  select i.*,
         coalesce((select max(a.data) from arr a where a.codice_norm = i.codice_norm and a.cum >= i.disponibili_da_vendere),
                  (select min(a.data) from arr a where a.codice_norm = i.codice_norm)) as fermo_dal,
         (now() at time zone 'Europe/Rome')::date as oggi
    from v_inventory i
   where i.disponibili_da_vendere > 0::numeric
)
select f.codice,
       f.item,
       f.variant,
       f.disponibili_da_vendere as pezzi,
       f.fermo_dal,
       f.oggi - f.fermo_dal as giorni,
       case when sh.codice_norm is null then 'assente'::text else sh.stati end as stato_shopify,
       round(f.disponibili_da_vendere * coalesce(f.retail_price, 0::numeric), 2) as valore
  from fermi f
  left join shop sh on sh.codice_norm = f.codice_norm
 where not coalesce(sh.attivo, false)
   and not exists (select 1 from non_product_codici n where upper(regexp_replace(n.codice, '\s+'::text, '_'::text, 'g'::text)) = f.codice_norm)
   and (f.fermo_dal is null or f.fermo_dal <= f.oggi - 3);

-- come le altre viste dopo la bonifica dei privilegi: sola lettura per i ruoli dell'app (i default di Supabase darebbero tutto)
revoke all on public.v_stock_fermo from public, anon, authenticated, ask_ro;
grant select on public.v_stock_fermo to anon, authenticated, ask_ro;

-- (b) v_health con stock_fermo
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
  -- === 0190: pezzi a magazzino non in vendita sul sito ===
  union all
  select 'stock_fermo', 'Prodotti con pezzi a magazzino non in vendita sul sito da almeno 3 giorni',
    (select count(*) from v_stock_fermo)
)
select k, label, n,
  case
    when k = 'storage_mb'::text then case when n >= 700 then 'warn'::text else 'ok'::text end
    when k = 'db_mb'::text then case when n >= 400 then 'warn'::text else 'ok'::text end
    when n = 0 then 'ok'::text
    when k = any (array['stock_neg'::text,'cogs_missing'::text,'price_missing'::text,'orders_orphan'::text,'shopify_orphan'::text,'qromo_orphan'::text,'dup_codice'::text,'period_mismatch'::text,'ce_drift_live'::text,'stock_fermo'::text]) then 'bad'::text
    else 'warn'::text
  end as severity
from checks;

-- (c) prova dentro la stessa transazione: se qualcosa non torna la migrazione non passa
do $$
declare
  r name;
  v_n int;
  v_fermi int;
  v_cols text;
begin
  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) into v_cols
    from pg_attribute a where a.attrelid = 'public.v_stock_fermo'::regclass and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from 'codice:text,item:text,variant:text,pezzi:numeric,fermo_dal:date,giorni:integer,stato_shopify:text,valore:numeric' then
    raise exception '0190: colonne di v_stock_fermo inattese: %', v_cols;
  end if;

  select count(*) into v_n from v_health;
  if v_n <> 15 then raise exception '0190: v_health ha % righe invece di 15', v_n; end if;
  if (select count(*) from v_health where k in ('img_missing', 'stock_neg', 'cogs_missing', 'price_missing', 'orders_orphan',
        'todo_products', 'lost_sales', 'shopify_orphan', 'qromo_orphan', 'dup_codice', 'period_mismatch', 'ce_drift_live',
        'storage_mb', 'db_mb')) <> 14 then
    raise exception '0190: le 14 righe di prima non ci sono tutte';
  end if;
  select count(*) into v_fermi from v_stock_fermo;
  if (select count(*) from v_health where k = 'stock_fermo' and n = v_fermi
        and severity = case when v_fermi = 0 then 'ok' else 'bad' end) <> 1 then
    raise exception '0190: stock_fermo in v_health non corrisponde a v_stock_fermo (% righe)', v_fermi;
  end if;

  -- niente codici con pezzi non positivi, attivi su Shopify fra le righe fresche o arrivati da meno di 3 giorni
  if exists (select 1 from v_stock_fermo where pezzi <= 0 or giorni < 3) then
    raise exception '0190: v_stock_fermo contiene righe fuori criterio';
  end if;
  if exists (select 1 from v_stock_fermo f where f.stato_shopify ~ '(^|,)active(,|$)') then
    raise exception '0190: v_stock_fermo contiene un codice attivo su Shopify';
  end if;

  foreach r in array array['anon', 'authenticated', 'ask_ro'] loop
    if not has_table_privilege(r, 'public.v_stock_fermo', 'select') then
      raise exception '0190: % non legge v_stock_fermo (la scheda della Home sarebbe vuota)', r;
    end if;
    if not has_table_privilege(r, 'public.v_health', 'select') then
      raise exception '0190: % non legge piu'' v_health', r;
    end if;
    if has_table_privilege(r, 'public.v_stock_fermo', 'insert') or has_table_privilege(r, 'public.v_stock_fermo', 'update')
       or has_table_privilege(r, 'public.v_stock_fermo', 'delete') or has_table_privilege(r, 'public.v_stock_fermo', 'truncate') then
      raise exception '0190: % puo'' scrivere su v_stock_fermo', r;
    end if;
  end loop;
end $$;
