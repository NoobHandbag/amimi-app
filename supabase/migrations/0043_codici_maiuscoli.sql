-- 0043 — CODICE AMIMI tutto MAIUSCOLO (decisione owner 2026-07-06, sessione feedback):
-- (a) i 3 prodotti da ordine-app rinominati da Benny in call prendono il codice DEFINITIVO
--     derivato dai suoi Modello+Variante (il codice di Ginni era provvisorio), con cascata
--     sulle righe ordine; (b) uppercase del codice in TUTTE le tabelle insieme (i join per
--     codice_norm sono case-insensitive, ma le viste con match esatto restano coerenti solo
--     se si aggiorna tutto in blocco). Gli SKU su Shopify restano invariati: il resolver
--     normalizza il case, nessun impatto funzionale.
-- Verifiche pre-migrazione: zero collisioni case-only in products e shopify_stock;
-- zero collisioni sui 3 codici derivati.

-- (a) codice definitivo di Benny per i 3 stub del 06-07 (rename PRIMA dell'uppercase)
-- NB: supplier_orders NON ha codice_norm generata (la norma la calcola v_ordini_arrivo): match esatto
update products set codice = 'LEA_BAG_COCCO_BLUE' where codice = 'Lea_Bag_COCCO_BLU';
update supplier_orders set codice = 'LEA_BAG_COCCO_BLUE' where codice = 'Lea_Bag_COCCO_BLU';
update products set codice = 'LEA_BAG_COCCO_SAND_CORAL' where codice = 'Lea_Bag_COCCO_PANNA_VENATURE_ROSSE';
update supplier_orders set codice = 'LEA_BAG_COCCO_SAND_CORAL' where codice = 'Lea_Bag_COCCO_PANNA_VENATURE_ROSSE';
update products set codice = 'LEA_BAG_COCCO_RED' where codice = 'Lea_Bag_COCCO_ROSSO_CHIARO';
update supplier_orders set codice = 'LEA_BAG_COCCO_RED' where codice = 'Lea_Bag_COCCO_ROSSO_CHIARO';

insert into change_log (tbl, row_id, op, after, chi, source)
values ('products', 'bulk', 'codice_finalize',
        '{"renames": {"Lea_Bag_COCCO_BLU": "LEA_BAG_COCCO_BLUE", "Lea_Bag_COCCO_PANNA_VENATURE_ROSSE": "LEA_BAG_COCCO_SAND_CORAL", "Lea_Bag_COCCO_ROSSO_CHIARO": "LEA_BAG_COCCO_RED"}, "motivo": "codice definitivo = quello di Benny (call 06-07)"}'::jsonb,
        'Claude-Code', 'migration-0043');

-- (b) uppercase in blocco: tutte le tabelle con colonna codice
update products set codice = upper(codice) where codice <> upper(codice);
update purchases set codice = upper(codice) where codice <> upper(codice);
update supplier_orders set codice = upper(codice) where codice <> upper(codice);
update qromo_sales set codice = upper(codice) where codice <> upper(codice);
update shopify_line_items set codice = upper(codice) where codice is not null and codice <> upper(codice);
update gifts_offline set codice = upper(codice) where codice <> upper(codice);
update returns set codice = upper(codice) where codice <> upper(codice);
update counts set codice = upper(codice) where codice <> upper(codice);
update stock_adjustments set codice = upper(codice) where codice <> upper(codice);
update b2b_movements set codice = upper(codice) where codice <> upper(codice);
update product_aliases set codice = upper(codice) where codice <> upper(codice);
update shopify_stock set codice = upper(codice) where codice <> upper(codice);

insert into change_log (tbl, row_id, op, after, chi, source)
values ('schema', '0043', 'codici_maiuscoli',
        '{"nota": "codice = upper(codice) su 12 tabelle; SKU Shopify invariati (resolver case-insensitive); Regola Ferrea 4 aggiornata"}'::jsonb,
        'Claude-Code', 'migration-0043');
