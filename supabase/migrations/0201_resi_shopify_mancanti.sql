-- 0201_resi_shopify_mancanti.sql (2026-11-20, CASI_APERTI 63 b, OK di Dan in chat: "yes we need that", "Flag them all",
-- soglia sui rimborsi parziali)
--
-- Un rimborso Shopify entra nel CE da solo (shopify_orders.refund_amount, v_ce_amimi e v_ce_totale), ma la giacenza no:
-- v_inventory scala ogni riga d'ordine come venduta e fa rientrare un pezzo solo con una riga in `returns`. Il #1571
-- (rimborsato il 26-08) e' rimasto senza reso per quasi tre mesi; al 20-11 erano 19 ordini, e `returns` aveva una riga
-- sola, la sua. Questa vista elenca gli ordini rimborsati che aspettano un reso; ce-guard la legge (WARN).
--
-- Quali ordini: refund_amount almeno meta' del prezzo della riga prodotto piu' economica dell'ordine. Fuori i rimborsi
-- della sola spedizione (#1002: 6,90 su una borsa da 150) e gli sconti di cortesia piccoli; dentro i parziali che
-- rimborsano un pezzo di un ordine con piu' righe (#1598). Righe non prodotto (non_product_codici: GIFT_CARD,
-- ORDINE_TEST) e righe senza codice escluse. Dentro anche gli ordini annullati prima della spedizione: le righe scalano
-- lo stock lo stesso.
--
-- Quando e' coperto (nessun legame col numero d'ordine: il form Reso dell'app non lo salva). I resi non Qromo di un
-- codice, in ordine di data, vanno prima ai rimborsi INTEGRALI dello stesso codice: l'i-esima riga rimborsata
-- integralmente si abbina all'i-esimo reso. Un integrale e' coperto quando lo sono tutte le sue righe. Un PARZIALE non
-- dice quale riga e' stata resa, quindi non prende posti: e' coperto se almeno uno dei suoi codici ha piu' resi di
-- quanti ne servono agli integrali di quel codice. La soglia si applica PRIMA della numerazione (Gate 2 del 20-11,
-- B1: un ordine scartato, come il #1002, non deve tenersi il posto del reso del #1499).
-- Limiti accettati: una riga vale un pezzo e un reso vale un pezzo anche con quantita' > 1 (al 20-11 tutte le righe
-- rimborsate hanno quantita' 1); due parziali sullo stesso codice possono essere coperti da un solo reso in piu'.
-- Si chiude registrando il reso (write-api `return`): `rientra_stock` si' se la borsa e' tornata vendibile, no se e'
-- un rimborso senza merce. Il reso di un canale non Qromo non muove il CE (le viste leggono `returns` solo per qromo).

create or replace view public.v_resi_shopify_mancanti as
with prodotti as (
  select o.order_id, o.created_at_shop, o.financial_status, o.refund_amount, li.id as line_id, li.codice_norm, li.price
  from shopify_orders o
  join shopify_line_items li on li.order_id = o.order_id
  where o.refund_amount > 0
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

comment on view public.v_resi_shopify_mancanti is
  'Ordini Shopify rimborsati senza reso in returns (la giacenza li conta ancora come venduti). Su un parziale codici_senza_reso elenca i codici fra cui sta il pezzo reso. Letta da ce-guard, check WARN ce_resi_shopify_mancanti. Migr 0201.';
