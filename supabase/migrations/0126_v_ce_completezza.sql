-- 0126_v_ce_completezza.sql (2026-09-14, audit gate: guardiano di conservazione delle spese)
-- Nato dall'incidente logistica (B48): un'intera categoria x sottocategoria di spesa (LOGISTICA/Spedizioni) non
-- aveva NESSUN bucket nel CE Totale e spariva in silenzio da marzo, per mesi. Questo controllo rende impossibile
-- che si ripeta senza accorgersene: per ogni mese NATIVO (calcolato dalle sorgenti, non dal blocco manuale gen/feb),
-- OGNI euro di spesa approvata deve essere o in una riga-spesa del CE, o in una delle esclusioni DICHIARATE
-- (COGS = entra come costo unitario alla vendita, non come costo di periodo; PACKAGING = oggi modellato a 3,71/pezzo,
-- non dalle spese: DA VERIFICARE con l'owner se e' giusto o e' un altro buco come la logistica). `spese_scoperte`
-- diverso da 0 = un euro che non e' ne' nel CE ne' in un'esclusione nota: un nuovo buco. Le due esclusioni restano
-- come colonne VISIBILI, mai nascoste.
create or replace view public.v_ce_completezza as
with mesi_nativi as (
  select distinct year, month from v_ce_totale
  where (year, month) not in (select year, month from ce_totale_manual where year is not null)
),
sp as (
  select year, month,
    coalesce(sum(costo), 0) as approvate,
    coalesce(sum(costo) filter (where categoria = 'COGS'), 0) as cat_cogs,
    coalesce(sum(costo) filter (where categoria = 'PACKAGING'), 0) as cat_packaging
  from expenses where status = 'approved' group by year, month
),
ce as (
  select year, month,
    coalesce(salari,0)+coalesce(tasse,0)+coalesce(opex,0)+coalesce(eventi,0)+coalesce(marketing,0)+coalesce(logistica_mag,0)+coalesce(logistica_var,0) as righe_spesa
  from v_ce_totale
)
select n.year, n.month,
  round(coalesce(sp.approvate, 0), 2) as spese_approvate,
  round(coalesce(ce.righe_spesa, 0), 2) as spese_nel_ce,
  round(coalesce(sp.cat_cogs, 0), 2) as spese_cogs_escluse,
  round(coalesce(sp.cat_packaging, 0), 2) as spese_packaging_escluse,
  round(coalesce(sp.approvate, 0) - (coalesce(ce.righe_spesa, 0) + coalesce(sp.cat_cogs, 0) + coalesce(sp.cat_packaging, 0)), 2) as spese_scoperte
from mesi_nativi n
left join sp on sp.year = n.year and sp.month = n.month
left join ce on ce.year = n.year and ce.month = n.month;
