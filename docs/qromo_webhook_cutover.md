# Qromo — webhook diretto → Supabase (pronto, non ancora in cutover)

> AGGIORNAMENTO 2026-07-04: **CUTOVER ESEGUITO il 2026-07-03**, edge v3 LIVE (in console Qromo il webhook e' "Amimi App Supabase"), path Apps Script = rollback a secco, vedi TRIGGER_MIGRAZIONE.md §4b; smoke test con la prima vendita reale ancora pendente. Le parti sotto su stato IDLE e sequenza di cutover valgono come storico/rollback.

> Stato: **costruito, deployato, testato (5 casi) il 2026-06-29. IDLE** finché non si fa il cutover. (SUPERATO il 2026-07-03: cutover eseguito, LIVE.)
> Sostituisce la catena attuale `Qromo → Apps Script doPost → Import → SyncImportToDBQromo → DB_QROMO → QromoForwardToApp → write-api`. È il pezzo che rende l'app **indipendente dal Foglio** per le vendite Qromo.

## Cos'è
Edge function `qromo-webhook` (Supabase, `verify_jwt=false`). In un punto solo fa tutto ciò che oggi fa la catena Apps Script:
- **Auth:** Qromo manda un campo `auth` nel body; deve combaciare con `app_flags.qromo_webhook_secret` (ruotabile con una UPDATE su quella riga). (AGGIORNAMENTO v3, 2026-07-03: tripla credenziale, ne basta una: (a) `?key=` nell'URL = stesso secret, quello configurato in console; (b) `body.auth` = secret; (c) `body.auth` = token generato da Qromo, salvato in `app_flags.qromo_webhook_token`.)
- **Logica "pagato":** come il `doPost` — non perde mai una vendita pagata (distingue pagato / non-pagato / campo `paid` assente, che flagga senza importare alla cieca).
- **Risoluzione nome → CODICE canonico:** `products` (= PRODUCT_COGS&PRICE) prima, poi `product_aliases` (= PRODUCT_MAP / nome del sito Shopify). Un nome non risolto viene **comunque inserito** con `resolver_status='unresolved'` + il nome grezzo (flaggato, mai perso). COGS preso da `products` quando risolto.
- **Prezzo pagato:** `total_value_in_order/qty` (ripiego su `price`), come il webhook live.
- **Idempotenza:** `sale_id = order_id + indice item` → un re-invio dello stesso ordine non duplica.
- **Scrive solo** `qromo_sales`, `source='qromo-direct'` (la stessa tabella del ponte).

- **URL:** `https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/qromo-webhook`
- **Secret:** in `app_flags.qromo_webhook_secret` (server-only, NON nel repo). Il valore è stato comunicato in chat; ruotalo se serve.

## Test passati (2026-06-29)
auth sbagliata → 401 · prodotto risolto → `inserted:1` (codice + COGS) · stesso ordine due volte → `skipped` (idempotente) · nome inventato → `inserted` con `unresolved` + nome grezzo · `paid:false` → `not_paid`. Righe di test (`order_id` `TEST_QWH_*`) cancellate.

## CUTOVER (quando l'app diventa fonte di verità)
1. Nella console Qromo, **SOSTITUISCI** l'URL del webhook con quello sopra e imposta il campo `auth` = il secret.
2. **NON** aggiungerlo come *secondo* webhook lasciando attivo quello dell'Apps Script: i due percorsi usano schemi `sale_id` diversi → la stessa vendita verrebbe contata **due volte**. Va **sostituito**, non affiancato.
3. Sostituendolo, il percorso Apps Script va **dormiente** da solo (Qromo non posta più al `doPost` → l'Import/DB_QROMO non ricevono più nuove righe → il forwarder non inoltra nulla).

**Conseguenza:** dopo il repoint, il **Foglio smette di ricevere le nuove vendite Qromo** (l'Apps Script non le vede più). Farlo **solo** quando l'app è la fonte di verità (o accettando che il Qromo del Foglio resti indietro). Per questo oggi è IDLE: durante il parallel-run Qromo continua a postare all'Apps Script che alimenta il Foglio. (SUPERATO il 2026-07-03: il cutover e' stato eseguito, la edge non e' piu' IDLE e il Foglio non riceve piu' le vendite Qromo.)

**Rollback:** ri-punta il webhook Qromo all'URL `/exec` dell'Apps Script (lo stato precedente).
