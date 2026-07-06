-- 0035_observability_detectors — Step 2 della remediation audit 2026-07-06.
-- Estende v_health con i detector strutturali che l'audit ha trovato MANCANTI (la classe
-- "fallimento silenzioso" ricresciuta): vendite orfane Shopify/Qromo, CODICE duplicati,
-- righe con mese sbagliato, drift dei mesi chiusi (live). I 7 check originali restano identici.
-- Inoltre: refresh_health_log non cancella piu' le chiavi ce_* di ce-guard (bug B22).
-- Additivo, nessuna colonna cambia (k,label,n,severity), nessun consumer rotto.

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
  -- === NUOVI detector (audit 2026-07-06) ===
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
)
select k, label, n,
  case
    when n = 0 then 'ok'::text
    when k = any (array['stock_neg'::text,'cogs_missing'::text,'price_missing'::text,'orders_orphan'::text,'shopify_orphan'::text,'qromo_orphan'::text,'dup_codice'::text,'period_mismatch'::text,'ce_drift_live'::text]) then 'bad'::text
    else 'warn'::text
  end as severity
from checks;

-- refresh_health_log: gestisce SOLO le proprie chiavi (v_health), mai le ce_* di ce-guard.
-- Prima cancellava tutta la giornata: se ce-guard (06:30) girava prima, health-daily (06:00 o on-demand)
-- ne cancellava i risultati -> un ce-guard morto restava invisibile a un check di freschezza (B22).
create or replace function refresh_health_log() returns void
  language plpgsql
  set search_path to 'public'
as $function$
begin
  delete from health_log where day = current_date and k not like 'ce\_%';
  insert into health_log (day, k, label, n, severity)
    select current_date, k, label, n, severity from v_health;
end; $function$;
