-- 0123_ce_totale_spedizioni.sql (2026-09-14, audit gate B48; OK owner: correggi e ri-chiudi mar+mag)
--
-- v_ce_totale prendeva `logistica_var` (spese di spedizione) SOLO dal blocco manuale ce_totale_manual, che ha
-- righe solo per gennaio e febbraio. Le spese LOGISTICA con sottocategoria 'Spedizioni' da marzo in poi non
-- finivano in nessuna riga del Totale (logistica_mag le esclude apposta con `!~~* 'sped%'`): MC1/MC2 del Totale
-- sovrastimati. Mancavano: mar -425,07, apr -20,00, mag -1015,42, lug -915,77, ago -1060,91. (v_ce_amimi le aveva
-- gia' correttamente: il buco era solo nel Totale.)
--
-- Fix: nel CTE `ex` un bucket nativo `logistica_var` = somma LOGISTICA con sottocategoria 'sped%', e nel SELECT
-- finale `logistica_var = COALESCE(m.logistica_var, ex.logistica_var, 0)`: il blocco manuale ha PRECEDENZA su
-- gen/feb (che restano identici, -1172 e -207, e non si toccano perche' chiusi), il nativo copre mar in poi.
-- Non doppia nulla (per gen/feb il nativo e' ignorato dal COALESCE).
--
-- Reclose: mar e apr (solo il CE `totale`; l'`amimi` non cambia) tornano a drift 0 assorbendo la spedizione.
-- MAGGIO NON viene ri-chiuso qui: ha gia' +118,60 di drift dalla ricodifica OPEX->COGS non decisa (caso aperto
-- n.16) su entrambi i CE, e ri-chiuderlo ora congelerebbe quella modifica insieme alla spedizione. Va deciso il
-- caso 16 prima (accettare o rimettere a OPEX), poi si ri-chiude maggio in un colpo solo.

create or replace view public.v_ce_totale as
 SELECT year, month, online_lordo, online_netto, online_pezzi, offline_lordo, offline_netto, offline_pezzi,
    b2b_lordo, b2b_netto, b2b_pezzi, omni_netto, cogs, packaging, commissioni, logistica_var, resi,
    salari, tasse, logistica_mag, opex, eventi, marketing,
    omni_netto + cogs + packaging + commissioni + logistica_var + resi AS mc1,
    omni_netto + cogs + packaging + commissioni + logistica_var + resi + salari + tasse + logistica_mag + opex + eventi + marketing AS mc2
   FROM ( WITH periods AS (
                 SELECT DISTINCT u.year, u.month
                   FROM ( SELECT shopify_orders.year, shopify_orders.month FROM shopify_orders WHERE shopify_orders.year IS NOT NULL
                        UNION ALL SELECT qromo_sales.year, qromo_sales.month FROM qromo_sales WHERE qromo_sales.year IS NOT NULL
                        UNION ALL SELECT gifts_offline.year, gifts_offline.month FROM gifts_offline WHERE gifts_offline.year IS NOT NULL
                        UNION ALL SELECT b2b_movements.year, b2b_movements.month FROM b2b_movements WHERE b2b_movements.year IS NOT NULL
                        UNION ALL SELECT expenses.year, expenses.month FROM expenses WHERE expenses.year IS NOT NULL
                        UNION ALL SELECT ce_totale_manual.year, ce_totale_manual.month FROM ce_totale_manual WHERE ce_totale_manual.year IS NOT NULL) u
                  WHERE u.month >= 1 AND u.month <= 12
                ), so AS (
                 SELECT shopify_orders.year, shopify_orders.month, count(*) AS ordini,
                    COALESCE(sum(shopify_orders.discount_total), 0::numeric) AS disc,
                    COALESCE(sum(shopify_orders.free_shipping_amt), 0::numeric) AS freeship,
                    COALESCE(sum(shopify_orders.shipping_total), 0::numeric) AS sped,
                    COALESCE(sum(shopify_orders.payment_fees), 0::numeric) AS commissioni,
                    COALESCE(sum(shopify_orders.refund_amount), 0::numeric) AS refund
                   FROM shopify_orders GROUP BY shopify_orders.year, shopify_orders.month
                ), sl AS (
                 SELECT shopify_line_items.year, shopify_line_items.month,
                    COALESCE(sum(shopify_line_items.quantita), 0::numeric) AS pezzi,
                    COALESCE(sum(shopify_line_items.price * shopify_line_items.quantita), 0::numeric) AS vendite,
                    COALESCE(sum(shopify_line_items.cogs_snapshot * shopify_line_items.quantita), 0::numeric) AS cogs
                   FROM shopify_line_items GROUP BY shopify_line_items.year, shopify_line_items.month
                ), qr AS (
                 SELECT qromo_sales.year, qromo_sales.month,
                    COALESCE(sum(qromo_sales.quantita), 0::numeric) AS pezzi,
                    COALESCE(sum(qromo_sales.prezzo), 0::numeric) AS lordo,
                    COALESCE(sum(qromo_sales.cogs * qromo_sales.quantita), 0::numeric) AS cogs
                   FROM qromo_sales GROUP BY qromo_sales.year, qromo_sales.month
                ), gf AS (
                 SELECT gifts_offline.year, gifts_offline.month,
                    COALESCE(sum(gifts_offline.quantita), 0::numeric) AS pezzi,
                    COALESCE(sum(gifts_offline.prezzo), 0::numeric) AS lordo,
                    COALESCE(sum(gifts_offline.cogs), 0::numeric) AS cogs
                   FROM gifts_offline GROUP BY gifts_offline.year, gifts_offline.month
                ), b2 AS (
                 SELECT b2b_movements.year, b2b_movements.month,
                    COALESCE(sum(b2b_movements.quantita) FILTER (WHERE b2b_movements.tipo_movimento = 'venduto'::text AND (b2b_movements.stato IS NULL OR b2b_movements.stato <> 'annullato'::text)), 0::numeric) AS pezzi,
                    COALESCE(sum(b2b_movements.incasso_amimi) FILTER (WHERE b2b_movements.tipo_movimento = 'venduto'::text AND (b2b_movements.stato IS NULL OR b2b_movements.stato <> 'annullato'::text)), 0::numeric) AS lordo,
                    COALESCE(sum(b2b_movements.cogs) FILTER (WHERE b2b_movements.tipo_movimento = 'venduto'::text AND (b2b_movements.stato IS NULL OR b2b_movements.stato <> 'annullato'::text)), 0::numeric) AS cogs
                   FROM b2b_movements GROUP BY b2b_movements.year, b2b_movements.month
                ), ex AS (
                 SELECT expenses.year, expenses.month,
                    COALESCE(sum(expenses.costo) FILTER (WHERE expenses.categoria = 'SALARI'::text), 0::numeric) AS salari,
                    COALESCE(sum(expenses.costo) FILTER (WHERE expenses.categoria = 'TASSE'::text), 0::numeric) AS tasse,
                    COALESCE(sum(expenses.costo) FILTER (WHERE expenses.categoria = 'OPEX'::text), 0::numeric) AS opex,
                    COALESCE(sum(expenses.costo) FILTER (WHERE expenses.categoria = 'EVENTI'::text), 0::numeric) AS eventi,
                    COALESCE(sum(expenses.costo) FILTER (WHERE expenses.categoria = 'MARKETING'::text), 0::numeric) AS marketing,
                    COALESCE(sum(expenses.costo) FILTER (WHERE expenses.categoria = 'LOGISTICA'::text AND (expenses.sottocategoria IS NULL OR expenses.sottocategoria !~~* 'sped%'::text)), 0::numeric) AS logistica_mag,
                    COALESCE(sum(expenses.costo) FILTER (WHERE expenses.categoria = 'LOGISTICA'::text AND expenses.sottocategoria ~~* 'sped%'::text), 0::numeric) AS logistica_var
                   FROM expenses WHERE expenses.status = 'approved'::text GROUP BY expenses.year, expenses.month
                )
         SELECT p.year, p.month,
            COALESCE(sl.vendite, 0::numeric) - COALESCE(so.disc, 0::numeric) + COALESCE(so.freeship, 0::numeric) + COALESCE(so.sped, 0::numeric) AS online_lordo,
            (COALESCE(sl.vendite, 0::numeric) - COALESCE(so.disc, 0::numeric) + COALESCE(so.freeship, 0::numeric) + COALESCE(so.sped, 0::numeric)) / 1.22 + COALESCE(m.online_netto, 0::numeric) AS online_netto,
            COALESCE(sl.pezzi, 0::numeric) AS online_pezzi,
            COALESCE(qr.lordo, 0::numeric) + COALESCE(gf.lordo, 0::numeric) AS offline_lordo,
            (COALESCE(qr.lordo, 0::numeric) + COALESCE(gf.lordo, 0::numeric)) / 1.22 + COALESCE(m.offline_netto, 0::numeric) AS offline_netto,
            COALESCE(qr.pezzi, 0::numeric) + COALESCE(gf.pezzi, 0::numeric) AS offline_pezzi,
            COALESCE(b2.lordo, 0::numeric) AS b2b_lordo,
            COALESCE(b2.lordo, 0::numeric) / 1.22 + COALESCE(m.b2b_netto, 0::numeric) AS b2b_netto,
            COALESCE(b2.pezzi, 0::numeric) AS b2b_pezzi,
            (COALESCE(sl.vendite, 0::numeric) - COALESCE(so.disc, 0::numeric) + COALESCE(so.freeship, 0::numeric) + COALESCE(so.sped, 0::numeric)) / 1.22 + (COALESCE(qr.lordo, 0::numeric) + COALESCE(gf.lordo, 0::numeric)) / 1.22 + COALESCE(b2.lordo, 0::numeric) / 1.22 + COALESCE(m.online_netto, 0::numeric) + COALESCE(m.offline_netto, 0::numeric) + COALESCE(m.b2b_netto, 0::numeric) AS omni_netto,
            (- (COALESCE(sl.cogs, 0::numeric) + COALESCE(qr.cogs, 0::numeric) + COALESCE(gf.cogs, 0::numeric) + COALESCE(b2.cogs, 0::numeric))) + COALESCE(m.cogs, 0::numeric) AS cogs,
            (- (3.71 * (COALESCE(sl.pezzi, 0::numeric) + COALESCE(qr.pezzi, 0::numeric) + COALESCE(gf.pezzi, 0::numeric)) + COALESCE(so.ordini, 0::bigint)::numeric)) + COALESCE(m.packaging, 0::numeric) AS packaging,
            COALESCE(so.commissioni, 0::numeric) + COALESCE(m.commissioni, 0::numeric) AS commissioni,
            COALESCE(m.logistica_var, ex.logistica_var, 0::numeric) AS logistica_var,
            (- COALESCE(so.refund, 0::numeric)) / 1.22 + COALESCE(m.resi, 0::numeric) AS resi,
            COALESCE(ex.salari, 0::numeric) + COALESCE(m.salari, 0::numeric) AS salari,
            COALESCE(ex.tasse, 0::numeric) + COALESCE(m.tasse, 0::numeric) AS tasse,
            COALESCE(ex.logistica_mag, 0::numeric) + COALESCE(m.logistica_mag, 0::numeric) AS logistica_mag,
            COALESCE(ex.opex, 0::numeric) + COALESCE(m.opex, 0::numeric) AS opex,
            COALESCE(ex.eventi, 0::numeric) + COALESCE(m.eventi, 0::numeric) AS eventi,
            COALESCE(ex.marketing, 0::numeric) + COALESCE(m.marketing, 0::numeric) AS marketing
           FROM periods p
             LEFT JOIN so ON so.year = p.year AND so.month = p.month
             LEFT JOIN sl ON sl.year = p.year AND sl.month = p.month
             LEFT JOIN qr ON qr.year = p.year AND qr.month = p.month
             LEFT JOIN gf ON gf.year = p.year AND gf.month = p.month
             LEFT JOIN b2 ON b2.year = p.year AND b2.month = p.month
             LEFT JOIN ex ON ex.year = p.year AND ex.month = p.month
             LEFT JOIN ce_totale_manual m ON m.year = p.year AND m.month = p.month) f;

-- Reclose SOLO totale, SOLO mar (3) e apr (4): il netto non cambia (la spedizione e' un costo), cambia solo mc2.
-- Guardia: si applica solo se per quei mesi il netto e' identico (no revenue drift) e mc2 scende esattamente
-- della spedizione attesa (mar -425.07, apr -20.00).
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from v_ce_drift d
  where d.ce = 'totale' and d.year = 2026 and d.month in (3,4)
    and (abs(d.delta_netto) > 0.01
         or (d.month = 3 and abs(d.delta_mc2 - (-425.07)) > 0.01)
         or (d.month = 4 and abs(d.delta_mc2 - (-20.00)) > 0.01));
  if v_bad <> 0 then
    raise exception 'reclose annullato: mar/apr totale non mostrano il solo scostamento di spedizione atteso (netto invariato, mc2 -425.07/-20.00): % righe fuori', v_bad;
  end if;
end $$;

update ce_snapshots s
set snapshot = to_jsonb(t) - 'ce', closed_at = now(), closed_by = 'claude-code (audit gate B48: spedizioni nel Totale)'
from v_ce_totale t
where s.ce = 'totale' and s.year = t.year and s.month = t.month
  and s.year = 2026 and s.month in (3,4);

do $$
declare v_bad int;
begin
  select count(*) into v_bad from v_ce_drift where ce='totale' and year=2026 and month in (3,4) and abs(delta_mc2) > 0.01;
  if v_bad <> 0 then raise exception 'reclose fallito: mar/apr totale ancora in drift dopo il reclose (% righe)', v_bad; end if;
end $$;
