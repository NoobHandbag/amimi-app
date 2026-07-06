# Amimì App — Architettura (as-built, 2026-06-25; aggiornata 2026-07-06)

> AGGIORNAMENTO 2026-07-04 (post-cutover). Dal 2026-07-03 il sistema di record per vendite, stock, inventario e CE e' amimi-app (https://noobhandbag.github.io/amimi-app + Supabase imszbjeyplaiovylhkgl); il webhook Qromo punta alla edge function qromo-webhook e il Foglio Master non riceve piu' le vendite Qromo (resta semi-attivo fino al congelamento). Stato corrente: amimi-app/docs/TRIGGER_MIGRAZIONE.md.

> AGGIORNAMENTO 2026-07-06 (consolidamento doc + remediation audit di sistema, commit a758756/0b0385d/a3b0306). Le sezioni §5/§6/§9 sono state RISCRITTE allo stato corrente (versioni edge verificate live il 06-07). Novita' strutturali dalla remediation: write-api blocca le scritture nei mesi chiusi (`ce_snapshots`) senza force+motivo; UNIQUE parziale su `qromo_sales(sale_id)` (migr 0036); detector estesi in `v_health` + banner rosso in Home (migr 0035); merge duplicati `codice_norm` + UNIQUE e REVOKE TRUNCATE (migr 0037). Doc operativi nuovi: `OPERATIONS.md` (runbook), `EDGE_FUNCTIONS.md`, `SCHEMA.md`. Dettaglio remediation: `audits/AUDIT_SYSTEM_2026-07-06.md`.

Stato reale del sistema costruito, non il piano. Il piano iniziale vive in
`Cowork12/projects/Amimi_App_Rebuild/ARCHITECTURE.md`; questo file fotografa **ciò che è
deployato e live**. Aggiornare qui a ogni cambio strutturale.

## 1. Cos'è
Replica DB-backed del gestionale Amimì (oggi su Google Sheet + Apps Script), usabile da telefono.
Tesi: spostare la logica derivata (inventario, P&L) da formule fragili del foglio a **viste SQL**,
eliminando la classe di bug "fallimento silenzioso" (arrayformula che collassano, CE letto per
indice riga, casing dei CODICE).

## 2. Stack
- **DB:** Supabase Postgres — project `imszbjeyplaiovylhkgl` (org Caprotti, eu-central-1).
  URL `https://imszbjeyplaiovylhkgl.supabase.co`. anon/publishable key pubblica (sola lettura).
- **Logica derivata:** viste SQL + 1 funzione (`ask_select`).
- **Write path:** edge function `write-api` (Deno/TS), PIN-gated, scrive con service-role, logga su `change_log`.
- **Scheduling:** `pg_cron` (5 job attivi, vedi §6).
- **Sync esterni:** edge functions in sola lettura (Shopify live; Qromo/Meta da seed).
- **Frontend:** React 19 + Vite 8 + TS, PWA, mobile-first. Deploy su GitHub Pages
  (`NoobHandbag/amimi-app`, base `/amimi-app/`), live https://noobhandbag.github.io/amimi-app/.

## 3. Dati — tabelle (sorgenti)
`products` (anagrafica, +`verificato`/`is_finalized`), `purchases` (ACQUISTI), `counts` (conte),
`gifts_offline` (regali), `b2b_movements` (conto-vendita/wholesale), `returns` (resi & cambi),
`supplier_orders` (ordini fornitore multi-borsa, +`gruppo`), `qromo_sales` (vendite negozio),
`shopify_orders` + `shopify_line_items` (vendite online), `shopify_catalog` (cosa è su Shopify),
`shopify_stock` (giacenze Shopify, popolata da shopify-stock), `expenses` (EXPENSES MASTER,
+`status` per approvazione), `meta_ads_daily` (ads), `ce_totale_monthly` (CE_TOTALE da foglio,
include gennaio), `suppliers`, `negozi`, `product_aliases` (nome Shopify→CODICE),
`non_product_codici`, `app_config` (pin_hash, shopify_token — service-role), `app_flags`
(feature flag + gemini_api_key — service-role), `change_log` (audit di ogni scrittura),
`stock_adjustments` (rettifiche da conta fisica, migr 0027), `ce_totale_manual` (blocco manuale
storico del Totale, migr 0028), `ce_snapshots` (mesi chiusi congelati, migr 0032),
`health_log` (esiti dei guardiani: v_health + ce-guard + stock autopush, migr 0024).
Colonne **generate, mai scrivere**: `codice_norm` (ovunque), `products.is_finalized`,
`expenses.amimi`/`categoria_valid`, `purchases.costo_totale`, `b2b_movements.incasso_amimi`/
`quota_negozio`/`retail_tot`.

## 4. Dati — viste (logica derivata)
- `v_inventory` — giacenza = acquisti − shopify − qromo − regali + resi_rientrati; +B2B, disponibili,
  valore, last_sale, on_shopify.
- `v_ce_amimi` / `v_ce_amimi_summary` — P&L brand (parità col foglio Feb/Mar al centesimo, Apr/Mag ~1%;
  dal 06-07 la riga resi e' nettata /1.22, migr 0038).
- `v_ce_totale` / `v_ce_totale_summary` — **P&L intera attivita', DI RECORD per il Totale** (nativa da
  migr 0028): calcolata dai dati vivi + blocco manuale `ce_totale_manual` (seed storico non-Amimi:
  gennaio 2026 pre-Amimi, rettifiche feb). La tabella `ce_totale_monthly` (copia dal Foglio) resta solo
  come riferimento storico e NON alimenta piu' il Cruscotto.
- `v_ce_drift` (drift mesi chiusi vs `ce_snapshots`), `v_health` (14 detector qualita' dati, migr 0035),
  `v_stock_drift` (policy autopush Shopify), `v_expenses_review` (coda approvazione spese).
- `v_conto_vendita_negozio`, `v_ordini_arrivo`, `v_fornitore_prodotti` (borse per fornitore),
  `v_products_todo` (da verificare), `v_expenses_pending` (spese da approvare),
  `v_shopify_align` (disallineamenti app↔Shopify), `v_reorder` (riordino, velocità 60g),
  `v_sku_availability` (acquistabili / non-pubblicati / esauriti), `v_ads_mensile`, `v_resi_mensile`.

## 5. Edge functions (8 al 2026-07-06; versioni verificate live, dettaglio per function in `EDGE_FUNCTIONS.md`)
- **`write-api`** (v14, verify_jwt off) — UNICO path di scrittura. PIN-gated (sha256(pin)==app_config.pin_hash;
  pin neutralizzato a `x`). Azioni: purchase, count, gift, b2b, product, order, order_multi, arrival,
  arrival_set, product_verify, expense_manual/propose/approve, sale_correct, return, qromo_sale.
  Ogni scrittura → change_log. Dal 06-07 BLOCCA le scritture nei mesi presenti in `ce_snapshots`
  senza `force`+motivo (risposta 409). Il COGS e' editabile via product_verify (Registra > Prodotti & prezzi).
- **`shopify-sync`** (v4) — pull SOLA LETTURA dei nuovi ordini Shopify (idempotente su order_id);
  dal 06-07 fallback resolver nome/CODICE/suffisso/SKU e re-sync rimborsi/stato (finestra 45gg).
- **`shopify-stock`** (v9) — sync giacenze Shopify → `shopify_stock` + push stock: `realign` manuale
  (gated `shopify_write_enabled`) e `realign_all` autopush (cron :27, gated `shopify_autopush_enabled`).
  Policy "specchio del reale": target = disponibili da vendere, buffer 0, rialzi e ribassi liberi;
  hold "non alzare senza conta" opt-in via `shopify_hold_raises` (default off). SKU non mappati mai
  toccati; push falliti contati in health_log con severity.
- **`qromo-webhook`** (v4) — ricevitore diretto Qromo→Supabase, LIVE dal cutover 2026-07-03 (in console
  Qromo il webhook e' "Amimi App Supabase"). Auth tripla: `?key=` nell'URL, oppure `body.auth` = secret,
  oppure token Qromo in `app_flags.qromo_webhook_token`. Idempotente (UNIQUE parziale su sale_id,
  23505 = skip benigno); errore vero su un item → risposta non-200 cosi' Qromo ritenta.
  Vedi `qromo_webhook_cutover.md` e TRIGGER_MIGRAZIONE.md §4b.
- **`ce-guard`** (v2) — guardiano contabile daily 06:30: drift mesi chiusi (vs `ce_snapshots`, etichetta
  con netto E mc2), vendite unresolved, COGS mancanti, giacenze negative, categorie spese, spese da
  verificare, riconciliazione ordini vs Shopify, token Shopify e freschezza sync. Esito in `health_log`
  (banner rosso in Home se error/warn). Azione `close_month` congela un mese in `ce_snapshots`.
- **`ask-data`** (v4) — NL→SQL: Gemini (`gemini-flash-lite-latest`) genera l'SQL, eseguito da
  `ask_select` (SECURITY DEFINER, solo SELECT, una query, max 200 righe). Key in app_flags.
  Dal 06-07 legge `v_ce_totale` live.
- **`mcp`** (v4) — server MCP JSON-RPC per Claude: tool read aperti (inventario, riordino, disponibilita',
  P&L, ads, ask_data) + 2 write (propose_expense, register_count) dietro Bearer `app_flags.mcp_token`,
  delegati a write-api.
- **`etl-load`** (v4) — RITIRATA: stub che risponde 410, era il loader one-off del re-seed 2026-07-01.

## 6. Scheduling (pg_cron) — 5 job attivi (verificati live 2026-07-06)
- `shopify-sync-hourly` — `7 * * * *` → shopify-sync (ordini).
- `shopify-stock-hourly` — `17 * * * *` → shopify-stock action `sync` (pull giacenze).
- `shopify-autopush-hourly` — `27 * * * *` → shopify-stock action `realign_all` (push stock).
- `health-daily` — `0 6 * * *` → funzione DB `refresh_health_log()`.
- `ce-guard-daily` — `30 6 * * *` → ce-guard action `run`.

Fuori pg_cron: backup GitHub Actions daily 03:17 UTC e snapshot Drive 05-06 Roma (vedi §13).

## 7. Frontend (6 sezioni)
- **Cruscotto** (`Report.tsx`) — P&L Amimì/Totale con filtro mesi, trend per canale, "Chiedi ai dati"
  (FLOW 6), card Meta Ads, calcolatore offerte B2B.
- **Salute & Movimenti** (`Salute.tsx`, tab `salute`, dal 06-07) — sola lettura: polso vendite online+offline
  14gg vs 14 precedenti, movimenti fornitori/resi, catalogo Shopify + flag operativi, semaforo salute da
  `health_log`. Numeri da `v_movimenti_14gg` (stessa finestra del digest Cowork); flag da `v_ops_flags`.
  Raggiungibile dalla Home (tile per Ale/Bene + "Tutte le azioni").
- **Inserisci** (`Ingest.tsx`) — conta, acquisto, reso/cambio, regalo, B2B, nuovo prodotto, spesa.
- **In arrivo** (`Arrivi.tsx`) — ordini fornitore multi-borsa, arrivi parziali/totali.
- **Verifica** (`Verifica.tsx`) — dettagli prodotto, approvazione spese, correzione vendita, pubblica (gated).
- **Inventario** (`Inventory.tsx`) — Magazzino, Riordino, Disponibilità, Nei negozi, Shopify, Valore.

## 8. Sicurezza (posture rilassata, per scelta)
anon = sola lettura (grant revocati in scrittura; TRUNCATE revocato dal 06-07, migr 0037). Scritture
solo via `write-api` (PIN, service-role), che dal 06-07 blocca anche i mesi chiusi (`ce_snapshots`).
Segreti **mai nel bundle**: shopify_token in `app_config`, gemini_api_key in `app_flags` (entrambi
solo service-role). PIN neutralizzato a `x` di proposito. Scritture su Shopify dietro i flag
`shopify_write_enabled` / `shopify_autopush_enabled` (autopush ON dal 03-07). APERTO (owner):
rotazione segreti + chiusura esfiltrazione ask_select (audit A1/A2, vedi `audits/AUDIT_SYSTEM_2026-07-06.md`).

## 9. Integrazioni — stato reale
| Sistema | Stato nell'app |
|---|---|
| **Shopify** ordini | **LIVE** (shopify-sync, ogni ora, sola lettura) |
| **Shopify** giacenze | **LIVE automatico** (shopify-stock v9: cron :17 sync + :27 realign_all autopush; era on-demand/gated fino al 03-07) |
| **Qromo** vendite | **LIVE** via edge `qromo-webhook` v4 dal cutover 03-07 (il path Apps Script/Foglio e' rollback a secco; smoke test prima vendita reale ancora aperto al 06-07). Vedi §10 e TRIGGER_MIGRAZIONE.md §4b |
| **Meta Ads** | da seed (`meta_ads_daily`); nessun pull live |
| **Gemini** | live (ask-data) |
| **Google Sheet** | nessun sync automatico app↔foglio (app seedata una volta dal foglio) |

## 10. App vs Foglio — i due mondi e i ponti
> SUPERATO il 2026-07-03: l'app e' il sistema di record per vendite, stock, inventario e CE; il Foglio
> resta semi-attivo (Shopify DB Fetch, GA4) fino al congelamento e NON riceve piu' le vendite Qromo.
> Il resto della sezione vale come storico.

App e Foglio sono oggi **paralleli**. L'app è stata seedata dal foglio una volta; Shopify entra
nell'app in autonomia. Tutto il resto (Qromo, spese, regali, acquisti) nell'app è **fermo allo
snapshot**. Ponti previsti:
- **Qromo→app:** forwarder in `SyncImportToDBQromo` (Apps Script) che POSTa le righe risolte di
  DB_QROMO a `write-api` (azione `qromo_sale`). Tiene vivi sia foglio che app. *(in costruzione)*
  (SUPERATO il 2026-07-03: costruito e andato live, poi pensionato dal cutover; resta installato
  a secco come rollback.)
- **Cowork→app:** Cowork esegue Python/Node, quindi può leggere (REST anon) e scrivere (`write-api`,
  pin `x`) l'app via HTTP — niente auth Google. Helper: `integrations/cowork_amimi.py`.
- **Refresh dal foglio:** ricarica periodica di Qromo/spese/regali/acquisti da un export `(NN)` del
  Master (oggi manuale, vedi NIGHT_LOG).

## 11. Cosa manca / gated / da decidere
- Qromo live (ponte §10) — **da costruire/deployare**. (SUPERATO il 2026-07-03: Qromo e' live via
  edge `qromo-webhook`, non via ponte.)
- Realign Shopify e pubblica-prodotto: **gated** finché non si abilita `shopify_write_enabled`.
  (SUPERATO il 2026-07-03: realign automatico live via cron, policy specchio del reale.)
- Feature progettate non costruite (dipendono da feed esterni): triage servizio clienti, analytics
  ritiri in negozio. Vedi `FEATURE_BACKLOG.md`.
- Decisione strategica: l'app sostituisce il Foglio? In tal caso migrare i task Cowold sheet-bound a
  pg_cron + edge functions (vedi NIGHT_LOG / questa §).

## 12. Deploy & test
- Frontend: `npm run build` in `web/` → `npx gh-pages -d dist`.
- Edge functions: via Supabase MCP `deploy_edge_function` (no CLI link). Migrazioni in `supabase/migrations/`.
- Test: `node tests/flows.mjs` (34 API checks), `node tests/features.mjs` (15 logica+viste),
  `npx playwright test` in `web/` (9 E2E). 58 check totali, tutti verdi al 2026-06-25.

## 13. Backup (aggiunto 2026-07-04)
- **GitHub Actions `db-backup.yml`**: daily 03:17 UTC, dump JSON del DB come artifact (retention 90gg),
  pensato per il restore.
- **Apps Script "Amimi App Snapshot Drive"** (dal 2026-07-04): daily 05-06 Roma, scrive un Google Sheet
  datato nella cartella Drive "Amimi App Snapshots" (24 fonti + tab RIEPILOGO), retention 30gg,
  mail a info@amimi.it su errore, trigger self-healing, rilancio manuale via `/exec?k=`.
  Sorgente: `amimi-app/scripts/appsscript-snapshot/`.
