-- 0203 (2026-11-20, chiesta da Dan in chat): la scheda "pezzi a magazzino non in vendita sul sito" deve esistere solo
-- quando c'e' un problema vero. Il 19-11 elencava 30 pezzi su 9 codici e nessuno era un problema di quel tipo: 20 Annie
-- Maxi arrivate il 06-11 e ancora in preparazione (senza prezzo, non verificate), 4 pezzi da sposa che sul sito non vanno,
-- 1 Lea Cavallino tenuta fuori dal sito per scelta (giugno), 2 Lea Toasted Green e 1 Sophie Verde che erano errori di
-- giacenza (corretti il 20-11 con due conte, write-api `count`). Con la soglia a 3 giorni ogni prodotto nuovo entrava
-- nell'elenco prima ancora di avere foto e prezzo, e l'elenco non si svuotava mai.
--  (a) stock_fermo_esclusi: i codici che sul sito non devono andare (decisione dell'owner), un codice per riga col motivo.
--      v_stock_fermo li salta: e' l'esclusione voluta che la 0190 dava come limite noto. Tabella di configurazione come
--      non_product_codici, ma chiusa: RLS attiva senza policy e nessun privilegio ad anon, authenticated, ask_ro (la vista
--      e' del proprietario e la legge lo stesso). Semina: i 2 codici da sposa e la Lea Cavallino Chocolate (Dan, 20-11).
--      Un codice nuovo da escludere si aggiunge con una migrazione finche' non esiste un'azione write-api (CASI_APERTI).
--  (b) v_stock_fermo: stesso corpo della 0190 con due differenze: fuori i codici di stock_fermo_esclusi, e fermo da almeno
--      30 giorni invece di 3. Un prodotto appena arrivato ha un mese per avere foto, prezzo e pagina; dopo, e' fermo
--      davvero. Colonne, FIFO di fermo_dal, finestra di 2 ore sulle righe Shopify e calendario di Roma identici.
--      Effetto sulla notifica stock_fermo (migr 0192, push-eventi): legge questa vista, quindi avvisa a 30 giorni e non
--      per i codici esclusi, senza toccare la edge.
--  (c) v_health: identica alla 0190 (15 righe, stesse gravita'), cambia solo il testo della riga stock_fermo (30 giorni).
--  (d) notifiche (modulo push_*, migr 0192; Gate 2 del 20-11): il testo del tema `magazzino` nella scheda Notifiche passa
--      da 3 a 30 giorni, e dal registro push_eventi_inviati escono le righe stock_fermo dei codici che con la soglia nuova
--      non sono piu' nella vista. La chiave e' fermo:<codice>:<fermo_dal> e una riga inviata la blocca per sempre: senza
--      questo, un lotto gia' avvisato a 3 giorni (le Annie Maxi del 06-11) rientrerebbe a 30 giorni senza notifica.
--      Restano le righe dei codici ancora in elenco (niente doppia notifica oggi).
--  Rinuncia consapevole (Gate 2): un codice con pezzi ma senza nessun arrivo registrato (fermo_dal nullo) entra subito,
--  come nella 0190: e' un'anomalia di anagrafica che conviene vedere, non un prodotto in preparazione.
-- Prova dentro la migrazione (blocco DO in fondo). Numero 0203: in produzione l'ultima e' la 0202 (branch
-- claude/stock-drift-non-prodotti, non ancora in main al 20-11: ridefinisce solo v_stock_drift).
-- Rollback: v_stock_fermo e v_health col corpo della 0190, poi drop table public.stock_fermo_esclusi; il testo del tema
-- si rimette a mano, le righe tolte dal registro non servono (al piu' una notifica ripetuta).

-- (a) i codici tenuti fuori dal sito apposta
create table if not exists public.stock_fermo_esclusi (
  codice     text primary key,
  motivo     text not null check (btrim(motivo) <> ''),
  chi        text,
  created_at timestamptz not null default now()
);
alter table public.stock_fermo_esclusi enable row level security;
revoke all on public.stock_fermo_esclusi from public, anon, authenticated, ask_ro;

insert into public.stock_fermo_esclusi (codice, motivo, chi) values
  ('AGATA_BAG_PALLIETTES_ADOC_ARGENTO_PER_SPOSA', 'Pezzo da sposa su misura: non va sul sito (Dan, 20-11-2026)', 'Claude Code'),
  ('AGATA_BAG_PERSONALIZZAZIONE_SPOSA', 'Pezzo da sposa su misura: non va sul sito (Dan, 20-11-2026)', 'Claude Code'),
  ('LEA_BAG_CAVALLINO_CHOCOLATE', 'Fuori dal catalogo del sito per scelta (Ale, giugno 2026, confermato da Dan il 20-11-2026)', 'Claude Code')
on conflict (codice) do nothing;

-- (b) i codici fermi: fuori gli esclusi, soglia a 30 giorni
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
   and not exists (select 1 from stock_fermo_esclusi e where upper(regexp_replace(e.codice, '\s+'::text, '_'::text, 'g'::text)) = f.codice_norm)
   and (f.fermo_dal is null or f.fermo_dal <= f.oggi - 30);

-- create or replace tiene i privilegi della 0190; si ripetono per chiarezza (stesso stato)
revoke all on public.v_stock_fermo from public, anon, authenticated, ask_ro;
grant select on public.v_stock_fermo to anon, authenticated, ask_ro;

-- (c) v_health: solo il testo della riga stock_fermo
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
  -- === 0190, soglia e testo della 0203: pezzi a magazzino non in vendita sul sito ===
  union all
  select 'stock_fermo', 'Prodotti con pezzi a magazzino non in vendita sul sito da almeno 30 giorni',
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

-- (d) notifiche: testo del tema e registro
update public.push_temi
   set descrizione = 'Prodotti con pezzi a magazzino da almeno 30 giorni e nessuna pagina attiva sul sito'
 where key = 'magazzino'
   and descrizione = 'Prodotti con pezzi a magazzino da almeno 3 giorni e nessuna pagina attiva sul sito';

delete from public.push_eventi_inviati r
 where r.evento = 'stock_fermo'
   and r.chiave like 'fermo:%'
   and not exists (select 1 from v_stock_fermo f where upper(f.codice) = upper(split_part(r.chiave, ':', 2)));

-- (e) prova dentro la stessa transazione: se qualcosa non torna la migrazione non passa
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
    raise exception '0203: colonne di v_stock_fermo inattese: %', v_cols;
  end if;

  select count(*) into v_n from v_health;
  if v_n <> 15 then raise exception '0203: v_health ha % righe invece di 15', v_n; end if;
  select count(*) into v_fermi from v_stock_fermo;
  if (select count(*) from v_health where k = 'stock_fermo' and n = v_fermi
        and label = 'Prodotti con pezzi a magazzino non in vendita sul sito da almeno 30 giorni'
        and severity = case when v_fermi = 0 then 'ok' else 'bad' end) <> 1 then
    raise exception '0203: stock_fermo in v_health non corrisponde a v_stock_fermo (% righe)', v_fermi;
  end if;

  -- niente codici con pezzi non positivi, arrivati da meno di 30 giorni, attivi su Shopify o esclusi apposta
  if exists (select 1 from v_stock_fermo where pezzi <= 0 or giorni < 30) then
    raise exception '0203: v_stock_fermo contiene righe fuori criterio';
  end if;
  if exists (select 1 from v_stock_fermo f where f.stato_shopify ~ '(^|,)active(,|$)') then
    raise exception '0203: v_stock_fermo contiene un codice attivo su Shopify';
  end if;
  if exists (select 1 from v_stock_fermo f join stock_fermo_esclusi e
               on upper(regexp_replace(e.codice, '\s+', '_', 'g')) = upper(regexp_replace(f.codice, '\s+', '_', 'g'))) then
    raise exception '0203: v_stock_fermo contiene un codice escluso';
  end if;

  -- la semina: i tre codici, ognuno in anagrafica (un refuso escluderebbe niente, in silenzio)
  if (select count(*) from stock_fermo_esclusi) < 3 then raise exception '0203: semina di stock_fermo_esclusi incompleta'; end if;
  if exists (select 1 from stock_fermo_esclusi e where not exists (select 1 from products p where p.codice_norm = upper(regexp_replace(e.codice, '\s+', '_', 'g')))) then
    raise exception '0203: un codice escluso non esiste in anagrafica';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.stock_fermo_esclusi'::regclass) then
    raise exception '0203: RLS spenta su stock_fermo_esclusi';
  end if;
  foreach r in array array['anon', 'authenticated', 'ask_ro'] loop
    if not has_table_privilege(r, 'public.v_stock_fermo', 'select') then
      raise exception '0203: % non legge v_stock_fermo (la scheda della Home sarebbe vuota)', r;
    end if;
    if not has_table_privilege(r, 'public.v_health', 'select') then
      raise exception '0203: % non legge piu'' v_health', r;
    end if;
    if has_table_privilege(r, 'public.v_stock_fermo', 'insert') or has_table_privilege(r, 'public.v_stock_fermo', 'update')
       or has_table_privilege(r, 'public.v_stock_fermo', 'delete') or has_table_privilege(r, 'public.v_stock_fermo', 'truncate') then
      raise exception '0203: % puo'' scrivere su v_stock_fermo', r;
    end if;
    if has_table_privilege(r, 'public.stock_fermo_esclusi', 'select') or has_table_privilege(r, 'public.stock_fermo_esclusi', 'insert')
       or has_table_privilege(r, 'public.stock_fermo_esclusi', 'update') or has_table_privilege(r, 'public.stock_fermo_esclusi', 'delete')
       or has_table_privilege(r, 'public.stock_fermo_esclusi', 'truncate') then
      raise exception '0203: % ha privilegi su stock_fermo_esclusi', r;
    end if;
  end loop;
  -- notifiche: nessun testo a 3 giorni, e nel registro restano solo righe di codici in elenco
  if exists (select 1 from push_temi where key = 'magazzino' and descrizione like '%almeno 3 giorni%') then
    raise exception '0203: il tema magazzino dice ancora 3 giorni';
  end if;
  if exists (select 1 from push_eventi_inviati r where r.evento = 'stock_fermo' and r.chiave like 'fermo:%'
               and not exists (select 1 from v_stock_fermo f where upper(f.codice) = upper(split_part(r.chiave, ':', 2)))) then
    raise exception '0203: nel registro restano righe stock_fermo di codici fuori elenco';
  end if;
  -- service_role legge la vista (push-eventi, migr 0192)
  if not has_table_privilege('service_role', 'public.v_stock_fermo', 'select') then
    raise exception '0203: service_role non legge v_stock_fermo (la notifica stock_fermo si fermerebbe)';
  end if;
end $$;
