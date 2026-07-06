-- 0038_resi_iva_netto — audit C23 (scelta owner: applica /1.22).
-- I resi riducevano il CE per il rimborso LORDO mentre i ricavi sono a NETTO (/1.22): ~157 EUR di
-- sovra-riduzione su feb/mag/giu. Qui si divide la sola gamba dei rimborsi live per 1.22, cosi'
-- combacia con la base netta della vista. Unico cambiamento vs le viste attuali: "/ 1.22" sui resi.
-- (m.resi in v_ce_totale = seed manuale storico, lasciato com'e'.)

create or replace view v_ce_amimi as
 with periods as (
         select distinct u.year, u.month
           from ( select shopify_orders.year, shopify_orders.month from shopify_orders where shopify_orders.year is not null
                union all select qromo_sales.year, qromo_sales.month from qromo_sales where qromo_sales.year is not null
                union all select b2b_movements.year, b2b_movements.month from b2b_movements where b2b_movements.year is not null
                union all select expenses.year, expenses.month from expenses where expenses.year is not null
                union all select returns.year, returns.month from returns where returns.year is not null) u
          where u.month >= 1 and u.month <= 12
        ), so as (
         select shopify_orders.year, shopify_orders.month, count(*) as ordini,
            coalesce(sum(shopify_orders.discount_total), 0::numeric) as disc,
            coalesce(sum(shopify_orders.free_shipping_amt), 0::numeric) as freeship,
            coalesce(sum(shopify_orders.shipping_total), 0::numeric) as sped,
            coalesce(sum(shopify_orders.payment_fees), 0::numeric) as commissioni,
            coalesce(sum(shopify_orders.refund_amount), 0::numeric) as refund
           from shopify_orders group by shopify_orders.year, shopify_orders.month
        ), sl as (
         select shopify_line_items.year, shopify_line_items.month,
            coalesce(sum(shopify_line_items.quantita), 0::numeric) as pezzi,
            coalesce(sum(shopify_line_items.price * shopify_line_items.quantita), 0::numeric) as vendite,
            coalesce(sum(shopify_line_items.cogs_snapshot), 0::numeric) as cogs
           from shopify_line_items group by shopify_line_items.year, shopify_line_items.month
        ), qr as (
         select qromo_sales.year, qromo_sales.month,
            coalesce(sum(qromo_sales.quantita), 0::numeric) as pezzi,
            coalesce(sum(qromo_sales.prezzo), 0::numeric) as lordo,
            coalesce(sum(qromo_sales.cogs), 0::numeric) as cogs
           from qromo_sales group by qromo_sales.year, qromo_sales.month
        ), b2 as (
         select b2b_movements.year, b2b_movements.month,
            coalesce(sum(b2b_movements.quantita) filter (where b2b_movements.tipo_movimento = 'venduto'::text and (b2b_movements.stato is null or b2b_movements.stato <> 'annullato'::text)), 0::numeric) as pezzi,
            coalesce(sum(b2b_movements.incasso_amimi) filter (where b2b_movements.tipo_movimento = 'venduto'::text and (b2b_movements.stato is null or b2b_movements.stato <> 'annullato'::text)), 0::numeric) as lordo,
            coalesce(sum(b2b_movements.cogs) filter (where b2b_movements.tipo_movimento = 'venduto'::text and (b2b_movements.stato is null or b2b_movements.stato <> 'annullato'::text)), 0::numeric) as cogs
           from b2b_movements group by b2b_movements.year, b2b_movements.month
        ), ex as (
         select expenses.year, expenses.month,
            coalesce(sum(expenses.costo) filter (where expenses.categoria = 'SALARI'::text), 0::numeric) as salari,
            coalesce(sum(expenses.costo) filter (where expenses.categoria = 'TASSE'::text), 0::numeric) as tasse,
            coalesce(sum(expenses.costo) filter (where expenses.categoria = 'OPEX'::text), 0::numeric) as opex,
            coalesce(sum(expenses.costo) filter (where expenses.categoria = 'EVENTI'::text), 0::numeric) as eventi,
            coalesce(sum(expenses.costo) filter (where expenses.categoria = 'MARKETING'::text), 0::numeric) as marketing,
            coalesce(sum(expenses.costo) filter (where expenses.categoria = 'LOGISTICA'::text and expenses.sottocategoria ~~* 'sped%'::text), 0::numeric) as logistica_var,
            coalesce(sum(expenses.costo) filter (where expenses.categoria = 'LOGISTICA'::text and (expenses.sottocategoria is null or expenses.sottocategoria !~~* 'sped%'::text)), 0::numeric) as logistica_mag
           from expenses where expenses.amimi group by expenses.year, expenses.month
        ), qret as (
         select returns.year, returns.month,
            coalesce(sum(returns.importo_rimborsato), 0::numeric) as imp
           from returns where returns.canale = 'qromo'::text group by returns.year, returns.month
        )
 select p.year, p.month,
    coalesce(sl.vendite, 0::numeric) - coalesce(so.disc, 0::numeric) + coalesce(so.freeship, 0::numeric) + coalesce(so.sped, 0::numeric) as online_lordo,
    (coalesce(sl.vendite, 0::numeric) - coalesce(so.disc, 0::numeric) + coalesce(so.freeship, 0::numeric) + coalesce(so.sped, 0::numeric)) / 1.22 as online_netto,
    coalesce(sl.pezzi, 0::numeric) as online_pezzi,
    coalesce(qr.lordo, 0::numeric) as offline_lordo,
    coalesce(qr.lordo, 0::numeric) / 1.22 as offline_netto,
    coalesce(qr.pezzi, 0::numeric) as offline_pezzi,
    coalesce(b2.lordo, 0::numeric) as b2b_lordo,
    coalesce(b2.lordo, 0::numeric) / 1.22 as b2b_netto,
    coalesce(b2.pezzi, 0::numeric) as b2b_pezzi,
    (coalesce(sl.vendite, 0::numeric) - coalesce(so.disc, 0::numeric) + coalesce(so.freeship, 0::numeric) + coalesce(so.sped, 0::numeric)) / 1.22 + coalesce(qr.lordo, 0::numeric) / 1.22 + coalesce(b2.lordo, 0::numeric) / 1.22 as omni_netto,
    - (coalesce(sl.cogs, 0::numeric) + coalesce(qr.cogs, 0::numeric) + coalesce(b2.cogs, 0::numeric)) as cogs,
    - (3.71 * (coalesce(sl.pezzi, 0::numeric) + coalesce(qr.pezzi, 0::numeric)) + coalesce(so.ordini, 0::bigint)::numeric) as packaging,
    coalesce(so.commissioni, 0::numeric) as commissioni,
    coalesce(ex.logistica_var, 0::numeric) as logistica_var,
    - (coalesce(so.refund, 0::numeric) + coalesce(qret.imp, 0::numeric)) / 1.22 as resi,
    coalesce(ex.salari, 0::numeric) as salari,
    coalesce(ex.tasse, 0::numeric) as tasse,
    coalesce(ex.logistica_mag, 0::numeric) as logistica_mag,
    coalesce(ex.opex, 0::numeric) as opex,
    coalesce(ex.eventi, 0::numeric) as eventi,
    coalesce(ex.marketing, 0::numeric) as marketing
   from periods p
     left join so on so.year = p.year and so.month = p.month
     left join sl on sl.year = p.year and sl.month = p.month
     left join qr on qr.year = p.year and qr.month = p.month
     left join b2 on b2.year = p.year and b2.month = p.month
     left join ex on ex.year = p.year and ex.month = p.month
     left join qret on qret.year = p.year and qret.month = p.month;

create or replace view v_ce_totale as
 select year, month, online_lordo, online_netto, online_pezzi, offline_lordo, offline_netto, offline_pezzi,
    b2b_lordo, b2b_netto, b2b_pezzi, omni_netto, cogs, packaging, commissioni, logistica_var, resi,
    salari, tasse, logistica_mag, opex, eventi, marketing,
    omni_netto + cogs + packaging + commissioni + logistica_var + resi as mc1,
    omni_netto + cogs + packaging + commissioni + logistica_var + resi + salari + tasse + logistica_mag + opex + eventi + marketing as mc2
   from ( with periods as (
                 select distinct u.year, u.month
                   from ( select shopify_orders.year, shopify_orders.month from shopify_orders where shopify_orders.year is not null
                        union all select qromo_sales.year, qromo_sales.month from qromo_sales where qromo_sales.year is not null
                        union all select gifts_offline.year, gifts_offline.month from gifts_offline where gifts_offline.year is not null
                        union all select b2b_movements.year, b2b_movements.month from b2b_movements where b2b_movements.year is not null
                        union all select expenses.year, expenses.month from expenses where expenses.year is not null
                        union all select ce_totale_manual.year, ce_totale_manual.month from ce_totale_manual where ce_totale_manual.year is not null) u
                  where u.month >= 1 and u.month <= 12
                ), so as (
                 select shopify_orders.year, shopify_orders.month, count(*) as ordini,
                    coalesce(sum(shopify_orders.discount_total), 0::numeric) as disc,
                    coalesce(sum(shopify_orders.free_shipping_amt), 0::numeric) as freeship,
                    coalesce(sum(shopify_orders.shipping_total), 0::numeric) as sped,
                    coalesce(sum(shopify_orders.payment_fees), 0::numeric) as commissioni,
                    coalesce(sum(shopify_orders.refund_amount), 0::numeric) as refund
                   from shopify_orders group by shopify_orders.year, shopify_orders.month
                ), sl as (
                 select shopify_line_items.year, shopify_line_items.month,
                    coalesce(sum(shopify_line_items.quantita), 0::numeric) as pezzi,
                    coalesce(sum(shopify_line_items.price * shopify_line_items.quantita), 0::numeric) as vendite,
                    coalesce(sum(shopify_line_items.cogs_snapshot), 0::numeric) as cogs
                   from shopify_line_items group by shopify_line_items.year, shopify_line_items.month
                ), qr as (
                 select qromo_sales.year, qromo_sales.month,
                    coalesce(sum(qromo_sales.quantita), 0::numeric) as pezzi,
                    coalesce(sum(qromo_sales.prezzo), 0::numeric) as lordo,
                    coalesce(sum(qromo_sales.cogs), 0::numeric) as cogs
                   from qromo_sales group by qromo_sales.year, qromo_sales.month
                ), gf as (
                 select gifts_offline.year, gifts_offline.month,
                    coalesce(sum(gifts_offline.quantita), 0::numeric) as pezzi,
                    coalesce(sum(gifts_offline.prezzo), 0::numeric) as lordo,
                    coalesce(sum(gifts_offline.cogs), 0::numeric) as cogs
                   from gifts_offline group by gifts_offline.year, gifts_offline.month
                ), b2 as (
                 select b2b_movements.year, b2b_movements.month,
                    coalesce(sum(b2b_movements.quantita) filter (where b2b_movements.tipo_movimento = 'venduto'::text and (b2b_movements.stato is null or b2b_movements.stato <> 'annullato'::text)), 0::numeric) as pezzi,
                    coalesce(sum(b2b_movements.incasso_amimi) filter (where b2b_movements.tipo_movimento = 'venduto'::text and (b2b_movements.stato is null or b2b_movements.stato <> 'annullato'::text)), 0::numeric) as lordo,
                    coalesce(sum(b2b_movements.cogs) filter (where b2b_movements.tipo_movimento = 'venduto'::text and (b2b_movements.stato is null or b2b_movements.stato <> 'annullato'::text)), 0::numeric) as cogs
                   from b2b_movements group by b2b_movements.year, b2b_movements.month
                ), ex as (
                 select expenses.year, expenses.month,
                    coalesce(sum(expenses.costo) filter (where expenses.categoria = 'SALARI'::text), 0::numeric) as salari,
                    coalesce(sum(expenses.costo) filter (where expenses.categoria = 'TASSE'::text), 0::numeric) as tasse,
                    coalesce(sum(expenses.costo) filter (where expenses.categoria = 'OPEX'::text), 0::numeric) as opex,
                    coalesce(sum(expenses.costo) filter (where expenses.categoria = 'EVENTI'::text), 0::numeric) as eventi,
                    coalesce(sum(expenses.costo) filter (where expenses.categoria = 'MARKETING'::text), 0::numeric) as marketing,
                    coalesce(sum(expenses.costo) filter (where expenses.categoria = 'LOGISTICA'::text and (expenses.sottocategoria is null or expenses.sottocategoria !~~* 'sped%'::text)), 0::numeric) as logistica_mag
                   from expenses group by expenses.year, expenses.month
                )
         select p.year, p.month,
            coalesce(sl.vendite, 0::numeric) - coalesce(so.disc, 0::numeric) + coalesce(so.freeship, 0::numeric) + coalesce(so.sped, 0::numeric) as online_lordo,
            (coalesce(sl.vendite, 0::numeric) - coalesce(so.disc, 0::numeric) + coalesce(so.freeship, 0::numeric) + coalesce(so.sped, 0::numeric)) / 1.22 + coalesce(m.online_netto, 0::numeric) as online_netto,
            coalesce(sl.pezzi, 0::numeric) as online_pezzi,
            coalesce(qr.lordo, 0::numeric) + coalesce(gf.lordo, 0::numeric) as offline_lordo,
            (coalesce(qr.lordo, 0::numeric) + coalesce(gf.lordo, 0::numeric)) / 1.22 + coalesce(m.offline_netto, 0::numeric) as offline_netto,
            coalesce(qr.pezzi, 0::numeric) + coalesce(gf.pezzi, 0::numeric) as offline_pezzi,
            coalesce(b2.lordo, 0::numeric) as b2b_lordo,
            coalesce(b2.lordo, 0::numeric) / 1.22 + coalesce(m.b2b_netto, 0::numeric) as b2b_netto,
            coalesce(b2.pezzi, 0::numeric) as b2b_pezzi,
            (coalesce(sl.vendite, 0::numeric) - coalesce(so.disc, 0::numeric) + coalesce(so.freeship, 0::numeric) + coalesce(so.sped, 0::numeric)) / 1.22 + (coalesce(qr.lordo, 0::numeric) + coalesce(gf.lordo, 0::numeric)) / 1.22 + coalesce(b2.lordo, 0::numeric) / 1.22 + coalesce(m.online_netto, 0::numeric) + coalesce(m.offline_netto, 0::numeric) + coalesce(m.b2b_netto, 0::numeric) as omni_netto,
            (- (coalesce(sl.cogs, 0::numeric) + coalesce(qr.cogs, 0::numeric) + coalesce(gf.cogs, 0::numeric) + coalesce(b2.cogs, 0::numeric))) + coalesce(m.cogs, 0::numeric) as cogs,
            (- (3.71 * (coalesce(sl.pezzi, 0::numeric) + coalesce(qr.pezzi, 0::numeric) + coalesce(gf.pezzi, 0::numeric)) + coalesce(so.ordini, 0::bigint)::numeric)) + coalesce(m.packaging, 0::numeric) as packaging,
            coalesce(so.commissioni, 0::numeric) + coalesce(m.commissioni, 0::numeric) as commissioni,
            coalesce(m.logistica_var, 0::numeric) as logistica_var,
            (- coalesce(so.refund, 0::numeric)) / 1.22 + coalesce(m.resi, 0::numeric) as resi,
            coalesce(ex.salari, 0::numeric) + coalesce(m.salari, 0::numeric) as salari,
            coalesce(ex.tasse, 0::numeric) + coalesce(m.tasse, 0::numeric) as tasse,
            coalesce(ex.logistica_mag, 0::numeric) + coalesce(m.logistica_mag, 0::numeric) as logistica_mag,
            coalesce(ex.opex, 0::numeric) + coalesce(m.opex, 0::numeric) as opex,
            coalesce(ex.eventi, 0::numeric) + coalesce(m.eventi, 0::numeric) as eventi,
            coalesce(ex.marketing, 0::numeric) + coalesce(m.marketing, 0::numeric) as marketing
           from periods p
             left join so on so.year = p.year and so.month = p.month
             left join sl on sl.year = p.year and sl.month = p.month
             left join qr on qr.year = p.year and qr.month = p.month
             left join gf on gf.year = p.year and gf.month = p.month
             left join b2 on b2.year = p.year and b2.month = p.month
             left join ex on ex.year = p.year and ex.month = p.month
             left join ce_totale_manual m on m.year = p.year and m.month = p.month) f;
