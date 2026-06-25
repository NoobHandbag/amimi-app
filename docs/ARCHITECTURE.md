# Amimì App — Architettura (as-built, 2026-06-25)

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
- **Scheduling:** `pg_cron` (oggi 1 job: shopify-sync orario).
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
(feature flag + gemini_api_key — service-role), `change_log` (audit di ogni scrittura).
Colonne **generate, mai scrivere**: `codice_norm` (ovunque), `products.is_finalized`,
`expenses.amimi`/`categoria_valid`, `purchases.costo_totale`, `b2b_movements.incasso_amimi`/
`quota_negozio`/`retail_tot`.

## 4. Dati — viste (logica derivata)
- `v_inventory` — giacenza = acquisti − shopify − qromo − regali + resi_rientrati; +B2B, disponibili,
  valore, last_sale, on_shopify.
- `v_ce_amimi` / `v_ce_amimi_summary` — P&L brand (parità col foglio Feb/Mar al centesimo, Apr/Mag ~1%).
- `ce_totale_monthly` — P&L intera attività (vista Totale del Cruscotto), include gennaio ereditato.
- `v_conto_vendita_negozio`, `v_ordini_arrivo`, `v_fornitore_prodotti` (borse per fornitore),
  `v_products_todo` (da verificare), `v_expenses_pending` (spese da approvare),
  `v_shopify_align` (disallineamenti app↔Shopify), `v_reorder` (riordino, velocità 60g),
  `v_sku_availability` (acquistabili / non-pubblicati / esauriti), `v_ads_mensile`, `v_resi_mensile`.

## 5. Edge functions (4)
- **`write-api`** (v7, verify_jwt off) — UNICO path di scrittura. PIN-gated (sha256(pin)==app_config.pin_hash;
  pin neutralizzato a `x`). Azioni: purchase, count, gift, b2b, product, order, arrival, order_multi,
  product_verify, expense_manual/propose/approve, sale_correct, return. Ogni scrittura → change_log.
- **`shopify-sync`** (v1) — pull SOLA LETTURA dei nuovi ordini Shopify (solo > snapshot, idempotente).
- **`shopify-stock`** (v1) — pull giacenze Shopify → `shopify_stock`; azione `realign` (scrive su Shopify)
  **GATED** da `app_flags.shopify_write_enabled` (oggi off).
- **`ask-data`** (v3) — NL→SQL: Gemini (`gemini-flash-lite-latest`) genera l'SQL, eseguito da
  `ask_select` (SECURITY DEFINER, solo SELECT, una query, max 200 righe). Key in app_flags.

## 6. Scheduling (pg_cron)
- `shopify-sync-hourly` — `7 * * * *`, POST a shopify-sync. **È l'unico cron.** Tutto il resto
  dell'automazione, per ora, è on-demand dall'app o assente (vedi §9).

## 7. Frontend (5 sezioni)
- **Cruscotto** (`Report.tsx`) — P&L Amimì/Totale con filtro mesi, trend per canale, "Chiedi ai dati"
  (FLOW 6), card Meta Ads, calcolatore offerte B2B.
- **Inserisci** (`Ingest.tsx`) — conta, acquisto, reso/cambio, regalo, B2B, nuovo prodotto, spesa.
- **In arrivo** (`Arrivi.tsx`) — ordini fornitore multi-borsa, arrivi parziali/totali.
- **Verifica** (`Verifica.tsx`) — dettagli prodotto, approvazione spese, correzione vendita, pubblica (gated).
- **Inventario** (`Inventory.tsx`) — Magazzino, Riordino, Disponibilità, Nei negozi, Shopify, Valore.

## 8. Sicurezza (posture rilassata, per scelta)
anon = sola lettura (grant revocati in scrittura). Scritture solo via `write-api` (PIN, service-role).
Segreti **mai nel bundle**: shopify_token in `app_config`, gemini_api_key in `app_flags` (entrambi
solo service-role). PIN neutralizzato a `x` di proposito. Scrittura su Shopify dietro interruttore off.

## 9. Integrazioni — stato reale
| Sistema | Stato nell'app |
|---|---|
| **Shopify** ordini | **LIVE** (shopify-sync, ogni ora, sola lettura) |
| **Shopify** giacenze | on-demand (shopify-stock); realign **gated** |
| **Qromo** vendite | **NON live** — solo seed. Il webhook Qromo punta ancora all'Apps Script/Foglio. Vedi §10 |
| **Meta Ads** | da seed (`meta_ads_daily`); nessun pull live |
| **Gemini** | live (ask-data) |
| **Google Sheet** | nessun sync automatico app↔foglio (app seedata una volta dal foglio) |

## 10. App vs Foglio — i due mondi e i ponti
App e Foglio sono oggi **paralleli**. L'app è stata seedata dal foglio una volta; Shopify entra
nell'app in autonomia. Tutto il resto (Qromo, spese, regali, acquisti) nell'app è **fermo allo
snapshot**. Ponti previsti:
- **Qromo→app:** forwarder in `SyncImportToDBQromo` (Apps Script) che POSTa le righe risolte di
  DB_QROMO a `write-api` (azione `qromo_sale`). Tiene vivi sia foglio che app. *(in costruzione)*
- **Cowork→app:** Cowork esegue Python/Node, quindi può leggere (REST anon) e scrivere (`write-api`,
  pin `x`) l'app via HTTP — niente auth Google. Helper: `integrations/cowork_amimi.py`.
- **Refresh dal foglio:** ricarica periodica di Qromo/spese/regali/acquisti da un export `(NN)` del
  Master (oggi manuale, vedi NIGHT_LOG).

## 11. Cosa manca / gated / da decidere
- Qromo live (ponte §10) — **da costruire/deployare**.
- Realign Shopify e pubblica-prodotto: **gated** finché non si abilita `shopify_write_enabled`.
- Feature progettate non costruite (dipendono da feed esterni): triage servizio clienti, analytics
  ritiri in negozio. Vedi `FEATURE_BACKLOG.md`.
- Decisione strategica: l'app sostituisce il Foglio? In tal caso migrare i task Cowold sheet-bound a
  pg_cron + edge functions (vedi NIGHT_LOG / questa §).

## 12. Deploy & test
- Frontend: `npm run build` in `web/` → `npx gh-pages -d dist`.
- Edge functions: via Supabase MCP `deploy_edge_function` (no CLI link). Migrazioni in `supabase/migrations/`.
- Test: `node tests/flows.mjs` (34 API checks), `node tests/features.mjs` (15 logica+viste),
  `npx playwright test` in `web/` (9 E2E). 58 check totali, tutti verdi al 2026-06-25.
