-- 0089: correzione di v_margine_sku (numerata 0086 in origine, rinumerata per collisione con
--       0086_shipping_status di una sessione parallela; a DB e' gia' applicata col suo timestamp). Il ricavo offline NON si moltiplica per la quantita'.
--
-- La 0083 calcolava il lordo Qromo come `prezzo * quantita`, seguendo la nota di CONOSCENZA che
-- dava `qromo_sales.prezzo` per UNITARIO. L'owner ha verificato il caso reale (28-03-2026, 3x
-- CHAIN_TIGER, prezzo registrato 50,00, listino 70,00): l'incasso e' stato **50,00 in tutto**,
-- quindi `prezzo` e' il TOTALE DELLA RIGA.
--
-- Qromo ha percio' esattamente lo stesso quirk gia' documentato per `gifts_offline`:
--   prezzo = totale riga, cogs = per unita'.
-- La nota di CONOSCENZA e' stata corretta nella stessa sessione.
--
-- Conseguenze:
--  - il lordo offline torna `sum(prezzo)`, come fa gia' il CE: su quel ricavo il CE era GIUSTO e
--    la vista sbagliata (gonfiava il margine di CHAIN_TIGER di 100,00 lordi in marzo);
--  - il COGS resta `cogs * quantita`, perche' `cogs` E' unitario: sulla riga da 3 pezzi vale 14,33,
--    cioe' esattamente il costo di anagrafica, non 42,99. Su quello il CE resta in errore (vedi
--    SCHEMA.md §9), e la correzione del CE e' un lavoro a parte, autorizzato dall'owner.
--
-- Nessuna vista del CE viene toccata. Rollback = riapplicare la 0083.

create or replace view public.v_margine_sku as
with ord_val as (
  select order_id, sum(price * quantita) as valore_ordine
  from public.shopify_line_items
  group by order_id
),
riga as (
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
  -- offline Qromo: `prezzo` e' il TOTALE della riga (verificato dall'owner, vedi testata),
  -- `cogs` invece e' per UNITA' e va moltiplicato. Nessuna commissione di incasso.
  select
    s.codice_norm,
    s.year, s.month,
    'offline'::text,
    s.quantita,
    s.prezzo,
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
  'Contribution margin per codice x anno x mese x canale (brief A4). Costi POSITIVI, margine = ricavo_netto - cogs - commissioni - packaging. Offline: prezzo e il TOTALE riga, cogs e per unita (stesso quirk di gifts_offline). Spedizione esclusa; rimborsi NON allocati alla riga. Riconciliazione col CE in amimi-app/docs/SCHEMA.md.';
