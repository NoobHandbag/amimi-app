-- 0097 — `shopify_catalog` smette di essere un seed morto e diventa un mirror, con una data sopra.
--
-- Perche': la tabella e' stata seminata UNA volta (94 righe, migr 0008 del 24-06-2026) e non l'ha
-- mai piu' aggiornata nessuno. La migr 0021 l'aveva gia' dichiarata stale a giugno e aveva spostato
-- `v_inventory.on_shopify` sul mirror vivo `shopify_stock`, ma la tabella e' rimasta li'. Dal 24-07
-- `cs-assist` la usa per costruire il link alla scheda prodotto nelle risposte alle clienti, quindi
-- una tabella ferma e' diventata un problema visibile: 67 handle su 99 prodotti a catalogo, e la
-- copertura poteva solo peggiorare a ogni prodotto nuovo. Diagnosi del 01-08, brief
-- cs_assist_migliorie punto 5.
--
-- Da qui in avanti la riempie `shopify-stock` (doSync, cron orario :17) dallo stesso pull di
-- products.json che gia' fa: un campo in piu' nella stessa fetch, nessuno scope Shopify nuovo,
-- nessuna chiamata in piu'. Il mirror si comporta come `shopify_stock`: upsert di cio' che si vede
-- e prune di cio' che non c'e' piu'.
--
-- Nessuna vista legge `shopify_catalog` (verificato su information_schema.views prima di toccarla):
-- l'unico lettore e' `cs-assist`, che gia' fa il join case-insensitive su `upper(codice)` e filtra
-- su `on_shopify`. Quindi il CE, l'inventario e le viste protette dalla Regola 19 non sono in gioco.

alter table public.shopify_catalog add column if not exists synced_at timestamptz;

comment on column public.shopify_catalog.synced_at is
  'Ultimo giro di sync che ha visto questa riga (shopify-stock doSync, orario). Serve a rendere VISIBILE una tabella ferma: e'' rimasta indietro cinque settimane senza che nessuno se ne accorgesse.';

comment on table public.shopify_catalog is
  'Mirror del catalogo Shopify per codice: handle della scheda (per i link nelle risposte al cliente) e on_shopify = la scheda e'' active. Scritta SOLO da shopify-stock doSync. NON e'' la fonte dello stock: quella e'' shopify_stock.';

-- `on_shopify` finora era true su tutte e 94 le righe perche' nessuno l'ha mai ricalcolata. Da ora
-- e' vera solo per le schede `active`: una scheda in bozza non va linkata a una cliente, la pagina
-- non esiste per lei. Il primo giro del sync sistema i valori; qui non si indovina niente.
