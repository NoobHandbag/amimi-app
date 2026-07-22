-- Unione fornitore Francesco: 3 etichette testo-libero -> 'Francesco (pelle)'. OK owner 22-07.
-- Footprint verificato live 22-07: purchases 'Francesco VERPELL'=43 + 'VERPELL'=11 = 54 da rinominare;
-- supplier_orders gia' pulito (0 da cambiare, incluso per difesa). Nessun FK verso suppliers (verificato).
-- Non tocca stock/CE (fornitore NON e' chiave di giacenza/COGS/CE) -> mesi chiusi non alterati.
-- Colonne generate (costo_totale, codice_norm) non toccate: si ricalcolano da sole.

-- Guard: rifiuta se il footprint non e' quello atteso (evita rinomine cieche su un dataset cambiato).
do $$
declare np int; delp int;
begin
  select count(*) into np from purchases where fornitore in ('Francesco VERPELL','VERPELL');
  if np <> 54 then raise exception 'guard: attese 54 purchases da rinominare, trovate %', np; end if;
  select count(*) into delp from suppliers where name in ('Francesco VERPELL','VERPELL');
  if delp <> 2 then raise exception 'guard: attese 2 righe suppliers da rimuovere, trovate %', delp; end if;
end $$;

-- 1) audit before/after per ogni purchases che cambia etichetta
insert into change_log(tbl, row_id, op, before, after, chi, source)
select 'purchases', p.id::text, 'supplier_merge',
       jsonb_build_object('fornitore', p.fornitore),
       jsonb_build_object('fornitore', 'Francesco (pelle)'),
       'Claude Code', 'migration:0061_unione_fornitore_francesco (OK owner 22-07)'
from purchases p
where p.fornitore in ('Francesco VERPELL','VERPELL');

-- 2) rename purchases (atteso 54)
update purchases set fornitore = 'Francesco (pelle)'
where fornitore in ('Francesco VERPELL','VERPELL');

-- 3) difensivo su supplier_orders (atteso 0 oggi)
insert into change_log(tbl, row_id, op, before, after, chi, source)
select 'supplier_orders', o.id::text, 'supplier_merge',
       jsonb_build_object('fornitore', o.fornitore),
       jsonb_build_object('fornitore', 'Francesco (pelle)'),
       'Claude Code', 'migration:0061_unione_fornitore_francesco (OK owner 22-07)'
from supplier_orders o
where o.fornitore in ('Francesco VERPELL','VERPELL');

update supplier_orders set fornitore = 'Francesco (pelle)'
where fornitore in ('Francesco VERPELL','VERPELL');

-- 4) dedup anagrafica suppliers: audit before-image poi delete per NOME (nessun FK, nessun ID hardcoded)
insert into change_log(tbl, row_id, op, before, after, chi, source)
select 'suppliers', s.id::text, 'supplier_dedup', to_jsonb(s.*), null,
       'Claude Code', 'migration:0061_unione_fornitore_francesco (OK owner 22-07)'
from suppliers s
where s.name in ('Francesco VERPELL','VERPELL');

delete from suppliers where name in ('Francesco VERPELL','VERPELL');
