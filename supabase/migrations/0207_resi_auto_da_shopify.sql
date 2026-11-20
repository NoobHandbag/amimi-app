-- 0207_resi_auto_da_shopify.sql (2026-11-20, CASI_APERTI 63, OK di Dan in chat: "yes to both")
--
-- Da oggi un rimborso Shopify registra il reso da solo (shopify-sync v11): per ogni riga rimborsata una riga in
-- `returns`, con `rientra_stock` = la spunta "Restock items" del rimborso su Shopify (restock_type diverso da
-- no_restock). Solo i rimborsi creati dalla fine della conta fisica del 20-11 (12:03 UTC), che Dan dice giusta: i 19
-- ordini storici della 0201 restano come sono.
--
-- 1) returns.shopify_refund_line_id: id della riga di rimborso Shopify, UNIQUE (le NULL non collidono: i resi a mano
--    restano liberi). E' la chiave dell'upsert ignoreDuplicates del sync: lo stesso rimborso non entra due volte.
-- 2) shopify_orders.rimborsato_il: data del PRIMO rimborso dell'ordine, scritta dal sync (ingest e resync dei 45
--    giorni). NULL sugli ordini vecchi fuori finestra: la vista li ignora. Il primo, cosi' un rimborso nuovo su un ordine
--    gia' rimborsato prima della conta non lo riporta nel WARN.
-- 3) v_resi_shopify_mancanti (0201) guarda solo i rimborsi e i resi dalla fine della conta: il WARN di ce-guard
--    `ce_resi_shopify_mancanti` resta vuoto finche' il sync registra tutto, e si accende se un rimborso nuovo resta
--    senza reso (riga senza codice, sync fallito). Il resto della regola e' quello della 0201.

alter table public.returns add column if not exists shopify_refund_line_id text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'returns_shopify_refund_line_id_key') then
    alter table public.returns add constraint returns_shopify_refund_line_id_key unique (shopify_refund_line_id);
  end if;
end $$;
comment on column public.returns.shopify_refund_line_id is
  'Id della riga di rimborso Shopify (refund_line_items.id). Scritto da shopify-sync v11 (migr 0207); NULL sui resi registrati a mano.';

alter table public.shopify_orders add column if not exists rimborsato_il timestamptz;
comment on column public.shopify_orders.rimborsato_il is
  'Data del primo rimborso Shopify dell''ordine (shopify-sync v11, migr 0207). NULL = nessun rimborso o ordine fuori dalla finestra del resync.';

create or replace view public.v_resi_shopify_mancanti as
with prodotti as (
  select o.order_id, o.created_at_shop, o.financial_status, o.refund_amount, li.id as line_id, li.codice_norm, li.price
  from shopify_orders o
  join shopify_line_items li on li.order_id = o.order_id
  where o.refund_amount > 0
    and o.rimborsato_il >= timestamptz '2026-11-20 12:03:00+00'
    and li.codice_norm <> ''
    and not exists (select 1 from non_product_codici np where upper(regexp_replace(np.codice, '\s+', '_', 'g')) = li.codice_norm)
), ordini as (
  select order_id, created_at_shop, financial_status, refund_amount
  from prodotti
  group by order_id, created_at_shop, financial_status, refund_amount
  having refund_amount >= 0.5 * min(price)
), righe_integrali as (
  select p.line_id, p.codice_norm,
         row_number() over (partition by p.codice_norm order by p.created_at_shop, p.order_id, p.line_id) as n
  from prodotti p
  join ordini o on o.order_id = p.order_id
  where o.financial_status = 'refunded'
), resi as (
  select codice_norm, row_number() over (partition by codice_norm order by data, created_at) as n
  from returns
  where lower(coalesce(canale, '')) <> 'qromo'
    and created_at >= timestamptz '2026-11-20 12:03:00+00'
), integrali_per_codice as (
  select codice_norm, count(*) as n from righe_integrali group by codice_norm
), resi_per_codice as (
  select codice_norm, count(*) as n from resi group by codice_norm
), stato as (
  select o.order_id, p.codice_norm,
         case when o.financial_status = 'refunded'
              then exists (select 1 from righe_integrali ri join resi re on re.codice_norm = ri.codice_norm and re.n = ri.n
                           where ri.line_id = p.line_id)
              else coalesce((select n from resi_per_codice r where r.codice_norm = p.codice_norm), 0)
                   > coalesce((select n from integrali_per_codice i where i.codice_norm = p.codice_norm), 0)
         end as coperta
  from ordini o
  join prodotti p on p.order_id = o.order_id
)
select o.order_id,
       o.created_at_shop::date as data_ordine,
       o.financial_status,
       o.refund_amount,
       string_agg(s.codice_norm, ', ' order by s.codice_norm) filter (where not s.coperta) as codici_senza_reso
from ordini o
join stato s on s.order_id = o.order_id
group by o.order_id, o.created_at_shop, o.financial_status, o.refund_amount
having case when o.financial_status = 'refunded' then bool_or(not s.coperta) else not bool_or(s.coperta) end;

revoke all on public.v_resi_shopify_mancanti from anon;
