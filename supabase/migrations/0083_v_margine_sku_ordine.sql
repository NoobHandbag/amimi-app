-- 0083: Contribution margin per SKU e profitto per ordine (brief A4, ricerca software PMI 2026-08).
--
-- SOLO VISTE NUOVE. Nessuna vista esistente viene toccata: v_ce_amimi, v_ce_amimi_summary,
-- v_ce_totale e v_inventory restano byte per byte come sono (Regola Ferrea 19, punto 2).
-- Rollback = drop view v_margine_ordine; drop view v_margine_sku;
--
-- CONVENZIONE DI SEGNO (diversa dal CE, per leggibilita'): qui i costi sono POSITIVI
-- (cogs, commissioni, packaging, rimborso) e il margine li SOTTRAE. Nel CE gli stessi
-- costi sono negativi e vengono sommati. I due risultati coincidono.
--
-- CHIAVE DI ALLOCAZIONE UNICA: i costi che vivono sull'ORDINE (sconto, commissioni di
-- incasso, quota fissa di packaging) sono allocati alla riga pro-quota sul valore riga,
-- cioe' quota = (price*quantita) / valore_ordine. Se il valore ordine e' 0 la quota e' 0:
-- la riga resta (pezzi e cogs non si perdono) ma non riceve allocazioni. Al 2026-07-31
-- nessun ordine e' in questo caso.
--
-- PACKAGING: NON e' una categoria di spesa, e' una formula del CE
-- (v_ce_amimi: -(3.71 * pezzi_online_e_offline + numero_ordini_shopify)).
-- Qui vengono usate le STESSE due costanti, 3,71 per pezzo piu' 1,00 per ordine online,
-- cosi' la voce riconcilia col CE al centesimo. Se un domani il CE cambia quelle costanti,
-- vanno cambiate anche qui.
--
-- SPEDIZIONE FUORI DAL MARGINE: shipping_total e free_shipping_amt sono quello INCASSATO
-- dal cliente; il costo vero del corriere sta in expenses categoria LOGISTICA e non e'
-- attribuibile al singolo ordine. Mescolarli darebbe un margine falso. In v_margine_ordine
-- la spedizione incassata e' esposta come colonna informativa, fuori dal margine.
--
-- QUANTITA': queste viste moltiplicano SEMPRE per la quantita' (cogs_snapshot, qromo prezzo
-- e qromo cogs sono valori UNITARI). Il CE invece somma quelle tre colonne senza moltiplicarle:
-- e' una differenza reale e nota, spiegata voce per voce in SCHEMA.md, NON un errore di queste
-- viste. Il CE non viene corretto qui (mesi chiusi, Regola Ferrea 11).
--
-- RESI: la tabella returns e' vuota e i rimborsi Shopify esistono solo a livello di ORDINE.
-- Percio' v_margine_ordine sottrae il rimborso dal ricavo netto (mai dal cogs: non sappiamo
-- se la merce e' rientrata), mentre v_margine_sku NON alloca nessun rimborso alla riga e si
-- limita a contare i pezzi finiti in ordini rimborsati (colonna pezzi_in_ordini_rimborsati).
--
-- FUORI: b2b_movements e gifts_offline (rispettivamente 0 righe e quirk noto sui campi).

-- ---------- riga di vendita normalizzata (online Shopify + offline Qromo) ----------
create or replace view public.v_margine_sku as
with ord_val as (
  select order_id, sum(price * quantita) as valore_ordine
  from public.shopify_line_items
  group by order_id
),
riga as (
  -- online: Shopify
  select
    l.codice_norm,
    l.year, l.month,
    'online'::text as canale,
    l.quantita                                          as pezzi,
    (l.price * l.quantita)                              as ricavo_lordo,
    (o.discount_total * q.quota)                        as sconto,
    ((-o.payment_fees) * q.quota)                       as commissioni,
    (3.71 * l.quantita + 1.00 * q.quota)                as packaging,
    (l.cogs_snapshot * l.quantita)                      as cogs,
    (case when o.refund_amount > 0 then l.quantita else 0 end) as pezzi_rimborsati
  from public.shopify_line_items l
  join public.shopify_orders o on o.order_id = l.order_id
  join ord_val ov               on ov.order_id = l.order_id
  cross join lateral (
    select case when ov.valore_ordine > 0
                then (l.price * l.quantita) / ov.valore_ordine
                else 0 end as quota
  ) q
  where l.year is not null
  union all
  -- offline: Qromo (prezzo e cogs sono UNITARI; nessuna commissione di incasso)
  select
    s.codice_norm,
    s.year, s.month,
    'offline'::text,
    s.quantita,
    (s.prezzo * s.quantita),
    0::numeric,
    0::numeric,
    (3.71 * s.quantita),
    (s.cogs * s.quantita),
    0::numeric
  from public.qromo_sales s
  where s.year is not null
),
agg as (
  select
    codice_norm, year, month, canale,
    sum(pezzi)            as pezzi,
    sum(ricavo_lordo)     as ricavo_lordo,
    sum(sconto)           as sconto,
    sum(commissioni)      as commissioni,
    sum(packaging)        as packaging,
    sum(cogs)             as cogs,
    sum(pezzi_rimborsati) as pezzi_in_ordini_rimborsati
  from riga
  group by codice_norm, year, month, canale
)
select
  coalesce(p.codice, a.codice_norm)                     as codice,
  a.codice_norm,
  p.item,
  p.variant,
  a.year,
  a.month,
  a.canale,
  a.pezzi,
  round(a.ricavo_lordo, 2)                              as ricavo_lordo,
  round(a.sconto, 2)                                    as sconto,
  round((a.ricavo_lordo - a.sconto) / 1.22, 2)          as ricavo_netto,
  round(a.cogs, 2)                                      as cogs,
  round(a.commissioni, 2)                               as commissioni,
  round(a.packaging, 2)                                 as packaging,
  round((a.ricavo_lordo - a.sconto) / 1.22
        - a.cogs - a.commissioni - a.packaging, 2)      as margine_contribuzione,
  round(
    case when (a.ricavo_lordo - a.sconto) <> 0
         then ((a.ricavo_lordo - a.sconto) / 1.22 - a.cogs - a.commissioni - a.packaging)
              / ((a.ricavo_lordo - a.sconto) / 1.22) * 100
    end, 2)                                             as margine_pct,
  a.pezzi_in_ordini_rimborsati
from agg a
left join public.products p on p.codice_norm = a.codice_norm;

comment on view public.v_margine_sku is
  'Contribution margin per codice x anno x mese x canale (brief A4). Costi POSITIVI, margine = ricavo_netto - cogs - commissioni - packaging. Spedizione esclusa per scelta; rimborsi NON allocati alla riga (solo pezzi_in_ordini_rimborsati). Riconciliazione col CE spiegata in amimi-app/docs/SCHEMA.md.';

-- ---------- profitto per ordine online ----------
create or replace view public.v_margine_ordine as
with li as (
  select
    order_id,
    sum(quantita)                    as pezzi,
    sum(price * quantita)            as ricavo_lordo,
    sum(cogs_snapshot * quantita)    as cogs
  from public.shopify_line_items
  group by order_id
)
select
  o.order_id,
  o.order_number,
  o.created_at_shop,
  o.year,
  o.month,
  li.pezzi,
  round(li.ricavo_lordo, 2)                                     as ricavo_lordo,
  round(o.discount_total, 2)                                    as sconto,
  round((li.ricavo_lordo - o.discount_total) / 1.22, 2)         as ricavo_netto,
  round(li.cogs, 2)                                             as cogs,
  round(-o.payment_fees, 2)                                     as commissioni,
  round(3.71 * li.pezzi + 1.00, 2)                              as packaging,
  round(coalesce(o.shipping_total, 0)
        + coalesce(o.free_shipping_amt, 0), 2)                  as spedizione_incassata,
  round(coalesce(o.refund_amount, 0), 2)                        as rimborso,
  round((li.ricavo_lordo - o.discount_total) / 1.22
        - li.cogs - (-o.payment_fees) - (3.71 * li.pezzi + 1.00)
        - coalesce(o.refund_amount, 0) / 1.22, 2)               as margine_contribuzione,
  round(
    case when (li.ricavo_lordo - o.discount_total) <> 0
         then ((li.ricavo_lordo - o.discount_total) / 1.22
               - li.cogs - (-o.payment_fees) - (3.71 * li.pezzi + 1.00)
               - coalesce(o.refund_amount, 0) / 1.22)
              / ((li.ricavo_lordo - o.discount_total) / 1.22) * 100
    end, 2)                                                     as margine_pct,
  (coalesce(o.refund_amount, 0) > 0)                            as refunded,
  o.financial_status
from public.shopify_orders o
join li on li.order_id = o.order_id;

comment on view public.v_margine_ordine is
  'Profitto per ordine online (brief A4). Il rimborso e IVA-inclusivo e viene sottratto dal ricavo netto, MAI dal cogs (returns e vuota: non sappiamo se la merce e rientrata). Spedizione incassata esposta ma fuori dal margine. Nessun dato personale del cliente per scelta (l app principale legge in anon).';

grant select on public.v_margine_sku    to anon, authenticated;
grant select on public.v_margine_ordine to anon, authenticated;
