-- 0040 — nomi prodotto TUTTI MAIUSCOLI (item e variant), decisione call cofounder 2026-07-06
-- ("obbliga il file di pulizia dati ad essere maiuscolo... tutti i nomi in maiuscolo ovunque").
-- Conferma esplicita owner in sessione (opzione "Tutto maiuscolo, item e variant" + storico).
-- I join NON dipendono dal casing (codice_norm generata upper): update solo estetico/di coerenza.
-- In piu': i 3 codici stub sporchi creati oggi (lea_bag_*) allineati alla convenzione famiglia Lea_Bag_*.

-- storico: change_log riassuntivo per tabella (non per riga: sono centinaia di righe estetiche)
insert into change_log (tbl, row_id, op, after, chi, source)
select t.tbl, 'bulk', 'uppercase_item_variant', jsonb_build_object('righe_modificate', t.n), 'Claude-Code', 'migration-0040'
from (
  select 'products' as tbl, count(*) as n from products where item <> upper(item) or variant <> upper(variant) or model <> upper(model)
  union all select 'supplier_orders', count(*) from supplier_orders where item <> upper(item) or variant <> upper(variant)
  union all select 'purchases', count(*) from purchases where item <> upper(item) or variant <> upper(variant)
  union all select 'qromo_sales', count(*) from qromo_sales where item <> upper(item) or variant <> upper(variant)
  union all select 'gifts_offline', count(*) from gifts_offline where item <> upper(item) or variant <> upper(variant)
  union all select 'returns', count(*) from returns where item <> upper(item) or variant <> upper(variant)
  union all select 'counts', count(*) from counts where modello <> upper(modello) or variante <> upper(variante)
) t where t.n > 0;

update products set item = upper(item) where item is not null and item <> upper(item);
update products set variant = upper(variant) where variant is not null and variant <> upper(variant);
update products set model = upper(model) where model is not null and model <> upper(model);

update supplier_orders set item = upper(item) where item is not null and item <> upper(item);
update supplier_orders set variant = upper(variant) where variant is not null and variant <> upper(variant);

update purchases set item = upper(item) where item is not null and item <> upper(item);
update purchases set variant = upper(variant) where variant is not null and variant <> upper(variant);

update qromo_sales set item = upper(item) where item is not null and item <> upper(item);
update qromo_sales set variant = upper(variant) where variant is not null and variant <> upper(variant);

update gifts_offline set item = upper(item) where item is not null and item <> upper(item);
update gifts_offline set variant = upper(variant) where variant is not null and variant <> upper(variant);

update returns set item = upper(item) where item is not null and item <> upper(item);
update returns set variant = upper(variant) where variant is not null and variant <> upper(variant);

update counts set modello = upper(modello) where modello is not null and modello <> upper(modello);
update counts set variante = upper(variante) where variante is not null and variante <> upper(variante);

-- codici stub sporchi di oggi -> convenzione famiglia (codice_norm invariata, join sicuri)
update products set codice = 'Lea_Bag_COCCO_BLU' where codice = 'lea_bag_COCCO_BLU';
update products set codice = 'Lea_Bag_COCCO_PANNA_VENATURE_ROSSE' where codice = 'lea_bag_COCCO_PANNA_VENATURE_ROSSE';
update products set codice = 'Lea_Bag_COCCO_ROSSO_CHIARO' where codice = 'lea_bag_COCCO_ROSSO_CHIARO';
update supplier_orders set codice = 'Lea_Bag_COCCO_BLU' where codice = 'lea_bag_COCCO_BLU';
update supplier_orders set codice = 'Lea_Bag_COCCO_PANNA_VENATURE_ROSSE' where codice = 'lea_bag_COCCO_PANNA_VENATURE_ROSSE';
update supplier_orders set codice = 'Lea_Bag_COCCO_ROSSO_CHIARO' where codice = 'lea_bag_COCCO_ROSSO_CHIARO';
