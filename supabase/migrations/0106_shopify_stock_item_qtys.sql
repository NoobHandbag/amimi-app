-- 0106 — shopify_stock: la quantita' di OGNI inventory item, non solo della variante rappresentante
-- (2026-08-05, brief 2026-08-04_CLAUDE_CODE_BRIEF_shopify_stock_divergenza_varianti)
--
-- IL DIFETTO CHE QUESTA COLONNA CHIUDE. `shopify_stock` tiene UNA quantita' per codice
-- (`shopify_qty`), ma un codice puo' avere piu' inventory item: 48 codici e 109 item al 04-08,
-- perche' le borse doppie SC/CC condividono un codice via l'alias sul titolo, e perche' un
-- doppione in bozza puo' mappare sullo stesso codice della scheda attiva. In `doSync` la
-- quantita' veniva presa dalla variante col punteggio migliore e quelle delle sorelle venivano
-- BUTTATE: `items` accumulava tutti gli id, `qty` no.
--
-- Il danno non era nel mirror ma nella DECISIONE che ci si appoggiava sopra. `doRealignAll`
-- decideva se scrivere con `if (target === current) { okCount++; continue; }`, dove `current` e'
-- quel numero collassato: se la rappresentante coincideva con l'app, il codice era contato `ok` e
-- non si scriveva su NESSUN item, sorelle alla deriva comprese. Lo stato non si riparava mai da
-- solo, perche' l'unica cosa che l'avrebbe sistemato (una push) veniva saltata proprio dal fatto
-- che la rappresentante era allineata.
--
-- Guasto silenzioso di classe B19: il 02, 03 e 04-08 `health_log` ha scritto
-- "autopush: 0 push, 0 hold, 136 ok" con severity `ok` mentre una cliente poteva comprare
-- AGATA BAG FLORAL BORDEAUX EMBROIDERY con giacenza reale 0. Il caso e' stato tamponato a mano
-- alle 16:52 del 04-08 con un `shopify_realign`, che pero' non salva before-image.
--
-- NON e' una regressione della v15: la v15 e' solo il contatore di deploy alzato l'01-08 da
-- `shopify_catalog` (01d9a4d), che non tocca lo stock. Il collasso della quantita' nasce in
-- 57b20e3 (06-07) e la scorciatoia in 69ffa6e (03-07). Difetto latente dal 06-07.
--
-- FORMA DEL DATO: mappa jsonb `{"<inventory_item_id>": <qty>}`, non un array parallelo a
-- `inventory_item_ids`. Un array posizionale si disallineerebbe in silenzio il giorno in cui
-- l'ordine dei due campi divergesse; la mappa e' esplicita e sopravvive al riordino.
--
-- ADDITIVA E RETROCOMPATIBILE (Regola Ferrea 19): colonna nuova su una tabella MIRROR, nessuna
-- colonna core toccata, nessuna vista riscritta, niente CE ne' giacenze di mezzo. Le righe
-- esistenti restano NULL fino al primo `sync`, e il codice tratta NULL come "dato per-item non
-- disponibile" ricadendo sul vecchio confronto: nella finestra fra migrazione e primo sync il
-- comportamento e' identico a oggi, mai peggiore.

alter table shopify_stock add column if not exists item_qtys jsonb;

comment on column shopify_stock.item_qtys is
  'Quantita'' Shopify per singolo inventory item: {"<inventory_item_id>": <qty>}. La scrive shopify-stock a ogni sync. Serve a realign_all per decidere la push guardando OGNI variante invece del solo shopify_qty collassato (migr 0106, brief varianti divergenti 04-08). NULL = riga mai ri-sincronizzata dopo la 0106: il codice ricade sul confronto vecchio.';

-- Guardia: la colonna deve esistere ed essere jsonb e NULLABLE. Se qualcuno la promuovesse a NOT
-- NULL senza default, ogni upsert del sync su una riga vecchia fallirebbe.
do $$
declare
  t text;
  n text;
begin
  select data_type, is_nullable into t, n
    from information_schema.columns
   where table_name = 'shopify_stock' and column_name = 'item_qtys';
  if t is null then
    raise exception 'item_qtys non e'' stata creata';
  end if;
  if t <> 'jsonb' then
    raise exception 'item_qtys deve essere jsonb, trovato %', t;
  end if;
  if n <> 'YES' then
    raise exception 'item_qtys deve restare NULLABLE (le righe pre-0106 sono NULL fino al primo sync)';
  end if;
end $$;
