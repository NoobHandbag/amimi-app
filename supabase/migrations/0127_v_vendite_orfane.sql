-- 0127_v_vendite_orfane.sql (2026-09-14, audit gate: conservazione dei RICAVI)
-- Il CE raggruppa le vendite per (year, month): una riga di vendita con year/month NULL o fuori range e' invisibile
-- al CE (sparisce dal fatturato, come le spese senza bucket sparivano dal costo). Questa vista le conta per sorgente:
-- ce-guard (ce_completezza_ricavi) va rosso se ce n'e' anche una. b2b: solo le vendite non annullate.
create or replace view public.v_vendite_orfane as
select
  (select count(*) from shopify_line_items where year is null or month is null or month < 1 or month > 12) as shopify,
  (select count(*) from qromo_sales where year is null or month is null or month < 1 or month > 12) as qromo,
  (select count(*) from gifts_offline where year is null or month is null or month < 1 or month > 12) as gift,
  (select count(*) from b2b_movements where tipo_movimento = 'venduto' and (stato is null or stato <> 'annullato') and (year is null or month is null or month < 1 or month > 12)) as b2b,
  (
    (select count(*) from shopify_line_items where year is null or month is null or month < 1 or month > 12) +
    (select count(*) from qromo_sales where year is null or month is null or month < 1 or month > 12) +
    (select count(*) from gifts_offline where year is null or month is null or month < 1 or month > 12) +
    (select count(*) from b2b_movements where tipo_movimento = 'venduto' and (stato is null or stato <> 'annullato') and (year is null or month is null or month < 1 or month > 12))
  ) as totale;
