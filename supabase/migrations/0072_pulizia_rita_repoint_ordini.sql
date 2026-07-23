-- 0072: pulizia one-off Rita (brief campi_necessari_prodotto E.2, decisione owner 23-07 sera).
-- Le 2 righe ordine 6+6 del 19-05 (gruppo 0e229d2e, import-ordini-fresh) vivono ancora sotto il
-- codice PROVVISORIO LEA_BAG_X_RITA_VERNICE_NERA_PIERCING_A: si ri-puntano alle borse vere
-- (bianca -> LEA_BAG_WHITE_PIERCING, nera -> LEA_BAG_BLACK_PIERCING) via SQL e NON via API:
-- order_delete risponderebbe 409 (qty_arrived=6) e arrival_set 0 scriverebbe purchases negativi
-- fantasma su un codice senza purchases positivi (review Code 23-07, punto B6).
-- Non tocca purchases (le righe non ne hanno: era pre-app, seed), quindi stock e CE invariati.
-- La riga APERTA da 10pz (E.1) e' stata cancellata via write-api order_delete subito dopo questa
-- migrazione: il reap ha eliminato da solo lo stub LEA_BAG_X_RITA_VERNICE_NERA_PIERCING_A (E.3).

with w as (
  update supplier_orders so
     set codice = p.codice, item = p.item, variant = p.variant
    from products p
   where p.codice = 'LEA_BAG_WHITE_PIERCING'
     and so.id = '6d5ad024-42db-4021-9a4a-e8d5e02e201e'
     and so.codice = 'LEA_BAG_X_RITA_VERNICE_NERA_PIERCING_A'
  returning so.id, so.codice, so.variant
)
insert into change_log (tbl, row_id, op, after, chi, source)
select 'supplier_orders', id::text, 'order_repoint',
       jsonb_build_object('da', 'LEA_BAG_X_RITA_VERNICE_NERA_PIERCING_A', 'a', codice,
         'variant', variant, 'motivo', 'riga bianca 6pz sotto codice provvisorio Rita (brief E.2, owner 23-07)'),
       'Claude Code', 'migration-0072'
  from w;

with b as (
  update supplier_orders so
     set codice = p.codice, item = p.item, variant = p.variant
    from products p
   where p.codice = 'LEA_BAG_BLACK_PIERCING'
     and so.id = 'f4ed62d7-7fb3-4c0a-abc9-6b8b0f76d6f3'
     and so.codice = 'LEA_BAG_X_RITA_VERNICE_NERA_PIERCING_A'
  returning so.id, so.codice, so.variant
)
insert into change_log (tbl, row_id, op, after, chi, source)
select 'supplier_orders', id::text, 'order_repoint',
       jsonb_build_object('da', 'LEA_BAG_X_RITA_VERNICE_NERA_PIERCING_A', 'a', codice,
         'variant', variant, 'motivo', 'riga nera 6pz sotto codice provvisorio Rita (brief E.2, owner 23-07)'),
       'Claude Code', 'migration-0072'
  from b;
