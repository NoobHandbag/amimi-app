-- 0095 — due difetti di DATI che oggi fanno arrivare messaggi sbagliati alle clienti.
-- Origine: brief cs_assist_migliorie (benchmark bozze del 2026-08-01), punti 1 e 2.
--
-- PARTE 1 — `shopify_orders.order_number` NULL su 433 righe (#1001-#1433, dal 16-02 al 30-06).
-- `cs-assist.lookupOrder` filtra SOLO su `order_number`, quindi per ogni ordine anteriore al 01-07
-- il tool risponde "nessun ordine trovato" anche quando l'ordine c'e' (sta sotto `order_id`), e con
-- lui saltano tracking, stato spedizione e verdetto sulla finestra del reso. Caso reale dal
-- benchmark: alla cliente e' stato scritto che l'ordine #1424 "non risulta nei nostri dati" mentre
-- il pacco era in spedizione. Le righe dal 01-07 in poi arrivano da `shopify-sync`, che la colonna
-- la popola: il buco e' tutto nel seed legacy.
-- Verificato in sola lettura PRIMA di scrivere: 0 collisioni interne al backfill, 0 collisioni con
-- le righe gia' popolate, 0 `order_id` fuori dal formato #numero, e sulle 177 righe gia' popolate
-- `order_number` coincide sempre con `order_id` senza cancelletto. Il backfill e' idempotente.

update public.shopify_orders
   set order_number = replace(order_id, '#', '')
 where order_number is null
   and order_id ~ '^#[0-9]+$';

-- PARTE 2 — `shipping_status.delivered_at` non e' la data di consegna, e finiva nelle bozze.
-- La colonna registra QUANDO IL SYNC HA VISTO lo stato CONSEGNATA, non quando il corriere ha
-- consegnato: il getList di TWS espone la data di SPEDIZIONE (`data_spedizione` -> `shipped_date`)
-- e nessuna data di consegna. Al caricamento iniziale del 01-08 tutte le 198 spedizioni gia'
-- consegnate hanno quindi preso la data di oggi: un solo valore distinto su 198 righe, 101 delle
-- quali spedite da piu' di 20 giorni. La v16 di cs-assist stampava quel valore nel BLOCCO DATI e la
-- bozza lo riportava alla cliente ("consegnata in data 2026-08-01" per un pacco consegnato il
-- 10/07). Il linter anti-invenzione non poteva accorgersene: il numero non e' inventato, e'
-- sbagliato alla fonte, quindi passa ogni controllo.
--
-- Il nome diventa quello che il dato e' davvero. `seen_delivered_at` = quando NOI abbiamo visto la
-- consegna. Con il sync orario, per le consegne future, e' la data giusta a meno del caso limite
-- della consegna dopo mezzanotte; per una riga gia' consegnata alla prima osservazione la data non
-- si sa, e da qui in avanti resta NULL (fix alla fonte in `shipping-status-sync`, che la valorizza
-- solo quando osserva davvero la transizione).

alter table public.shipping_status rename column delivered_at to seen_delivered_at;

comment on column public.shipping_status.seen_delivered_at is
  'Data (Europe/Rome) in cui il sync ha OSSERVATO il passaggio a CONSEGNATA. NON e'' la data di consegna del corriere: TWS non la espone. NULL quando la riga era gia'' consegnata alla prima osservazione.';

-- Bonifica delle righe stampigliate dal caricamento iniziale. La condizione e' volutamente stretta
-- (data del caricamento + finestra oraria del caricamento) cosi' una eventuale osservazione VERA
-- avvenuta nel frattempo non viene toccata, e la migrazione resta ripetibile senza danni.
update public.shipping_status
   set seen_delivered_at = null
 where seen_delivered_at = date '2026-08-01'
   and updated_at < timestamptz '2026-08-01 12:00:00+00';
