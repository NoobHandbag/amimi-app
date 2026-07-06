# Amimì App - EDGE FUNCTIONS (riferimento)

> Una scheda per ogni edge function Supabase (project `imszbjeyplaiovylhkgl`). Creato 2026-07-06 dal codice in `supabase/functions/` + verifica live (`list_edge_functions`).
> Le VERSIONI cambiano a ogni deploy: quelle qui sotto sono lo stato al 2026-07-06 ~14:00; per la verita' live usare Supabase MCP `list_edge_functions`. Tutte le functions hanno `verify_jwt=false`.
> Deploy: SOLO via Supabase MCP `deploy_edge_function` (niente CLI link); e' territorio Claude Code (Regola Ferrea 16). I valori dei segreti NON vanno mai riportati nei doc (repo pubblico).

Pattern comuni: auth "PIN" = `body.pin` -> sha256 -> confronto con `app_config.pin_hash` (PIN neutralizzato a `x` per scelta owner: e' design, non sicurezza). Scritture con service-role key da env. Audit su `change_log`, telemetria su `health_log`.

## write-api (v14) - UNICO path di scrittura dati

- **Scopo:** ogni scrittura dati dell'ecosistema (app, Cowork, MCP) passa da qui.
- **Auth:** PIN.
- **Azioni:** `purchase`, `gift`, `b2b`, `product`, `order` (insert generici con validazione), `order_multi` (ordine fornitore multi-riga, un `gruppo`), `arrival` (arrivo su ordine: aggiorna `qty_arrived` + inserisce in `purchases`), `arrival_set` (correzione qty_arrived con delta), `count` (conta fisica: delta calcolato LATO SERVER da `v_inventory`, scrive `counts` + `stock_adjustments`), `product_verify` (completa anagrafica, accetta anche `cogs`), `expense_manual` / `expense_propose` / `expense_approve` (spese: dirette, in coda, approvazione con eventuale ricategorizzazione), `sale_correct` (riassegna una vendita Shopify/Qromo a un CODICE corretto, ri-snapshotta il COGS), `return` (reso/cambio; `sostituito_con` scala anche il sostituto), `qromo_sale` (forward idempotente, fallback COGS da `products`).
- **Protezioni:** blocco MESI CHIUSI (anno/mese presente in `ce_snapshots` -> 409 `closed_month`, si supera solo con `force` + motivo); validazioni input (CODICE senza spazi, quantita' > 0); idempotenza `qromo_sale` su `sale_id`; ogni op scrive `change_log` con `chi` e source.
- **Tocca:** legge `app_config`, `v_inventory`, `products`, `supplier_orders`, `expenses`; scrive `purchases`, `counts`, `stock_adjustments`, `products`, `expenses`, `returns`, `qromo_sales`, `shopify_line_items` (solo sale_correct), `gifts_offline`, `b2b_movements`, `supplier_orders`, `change_log`.

## shopify-sync (v4) - pull ordini Shopify

- **Scopo:** ingest SOLA LETTURA degli ordini Shopify nuovi + aggiornamento rimborsi/stato.
- **Auth:** PIN. Token Shopify da `app_config.shopify_token` (Admin API 2024-01).
- **Azioni:** default = pull ordini nuovi (idempotente su order_id) + re-sync `refund_amount`/`financial_status`/`fulfillment_status` degli ordini aggiornati negli ultimi 45gg (mai gli importi/righe); `backfill_meta` = aggiorna solo `fulfilled_at` + `discount_codes` su righe esistenti; `dryRun` = preview senza insert.
- **Resolver (dal 06-07):** alias esatto -> `codice_norm` -> nome base senza suffisso " - Senza/Con Catena" -> SKU; una riga che non risolve entra con codice NULL e la intercetta il detector `shopify_orphan`.
- **Note:** payment fees ~2.2% + 0,25 EUR stimate sugli ordini live (i mesi storici da seed sono al centesimo); errori per-item raccolti e ritornati (max 5), mai silenzio.

## shopify-stock (v9) - giacenze e push stock

- **Scopo:** specchio giacenze Shopify (`shopify_stock`) + push dello stock reale verso Shopify.
- **Auth:** PIN. Token Shopify da `app_config`.
- **Azioni:** `sync` (default, pull di tutti i prodotti/varianti: SKU -> codice via alias + codice_norm + fallback SKU; gestisce i dual-variant SC/CC = un codice, piu' `inventory_item_ids`); `realign_all` (autopush cron :27, gated `app_flags.shopify_autopush_enabled`; target = disponibili da vendere - buffer, oggi buffer 0; hold rialzi senza conta fresca <=30gg se `shopify_hold_raises='true'`; `dryRun` disponibile); `realign` (push manuale per codici scelti, gated `app_flags.shopify_write_enabled`, logga `chi`).
- **Protezioni:** SKU non mappati MAI toccati (azzerarli nasconderebbe un prodotto live); push falliti NON mascherati (ritornati come failedCodici + `health_log` chiave `stock_autopush` con severity error); location da `app_flags.shopify_location_id`.

## qromo-webhook (v4) - ricevitore vendite POS

- **Scopo:** riceve la vendita dalla console Qromo (webhook "Amimi App Supabase") e la scrive in `qromo_sales` (source `qromo-direct`). LIVE dal cutover 2026-07-03.
- **Auth (tripla, senza PIN):** `?key=` nell'URL, oppure `body.auth` = secret, oppure token Qromo in `app_flags.qromo_webhook_token`. Valori in `app_flags`, mai nei doc.
- **Comportamento:** POST only (GET risponde `online`); estrae l'ordine da body.order/data.order/payload.order; un record per item con paid=true; `sale_id` = order_id + indice item (stabile); prezzo = PAGATO per unita'; COGS snapshot da `products` se risolto, altrimenti `resolver_status='unresolved'` con nome raw in nota (mai perso).
- **Protezioni:** idempotenza via UNIQUE parziale `qromo_sales_live_saleid_uq` (23505 = re-delivery benigna, skip); errore vero su un item -> risposta non-200 cosi' Qromo RITENTA; item senza flag paid = skip segnalato.

## ce-guard (v2) - guardiano contabile

- **Scopo:** sorveglianza quotidiana del CE e della qualita' dati; esiti in `health_log` (chiavi `ce_*`), letti dal banner rosso in Home.
- **Auth:** PIN. Cron daily 06:30.
- **Azioni:** `run` (default) = 10 check: invarianti MC1/MC2 (tolleranza 0,02 EUR), `ce_qromo_unresolved`, `ce_cogs_mancanti` (warn), `ce_giacenze_negative`, `ce_expenses_categoria`, `ce_expenses_da_verificare` (warn), `ce_drift_mesi_chiusi` (da `v_ce_drift`, etichetta con netto E mc2), `ce_shopify_reconcile` (conteggio ordini API vs DB, mese corrente + precedente), `ce_shopify_token`, `ce_sync_freshness` (warn se `shopify_stock.synced_at` > 120 min). `close_month` (year, month, chi) = congela il CE del mese in `ce_snapshots` (UNIQUE, mai sovrascrive) + `change_log`. `status` = health_log `ce_*` di oggi.
- **Nota:** cancella e riscrive SOLO le chiavi `ce_*` di oggi (le altre sono di `refresh_health_log()`).

## ask-data (v4) - NL -> SQL

- **Scopo:** "Chiedi ai dati" del Cruscotto: Gemini (`gemini-flash-lite-latest`, temperature 0) genera una SELECT sullo schema esposto, eseguita da `ask_select` (SECURITY DEFINER: solo SELECT, singolo statement, max 200 righe, timeout 5s).
- **Auth:** PIN. Key Gemini in `app_flags.gemini_api_key` (se assente risponde `needs_key`).
- **Dal 06-07:** interroga `v_ce_totale` live (non piu' la copia storica).
- **APERTO (audit A1):** `ask_select` non ha allowlist di viste e ask-data e' pubblica: via di esfiltrazione segreti finche' l'owner non ruota i segreti e si chiude la falla.

## mcp (v4) - server MCP per Claude

- **Scopo:** pilotare l'app da Claude (JSON-RPC 2.0, supporto SSE).
- **Auth:** tool read APERTI (`list_inventory`, `what_to_reorder`, `sku_availability`, `pnl_summary`, `ads_summary`, `ask_data`); tool write (`propose_expense`, `register_count`) dietro `Authorization: Bearer` = `app_flags.mcp_token`, delegati alla write-api con `chi='Claude-MCP'`.

## etl-load (v4) - RITIRATA

- Stub che risponde 410 Gone: era il loader one-off del re-seed 2026-07-01. Nessuna azione. Candidata alla cancellazione.

## Flag e config di riferimento

- `app_config`: `pin_hash`, `shopify_token`, `iva_rate` (0.22), `parity_tolerance_cents`.
- `app_flags`: `shopify_write_enabled`, `shopify_autopush_enabled`, `shopify_expose_buffer` (oggi 0), `shopify_hold_raises`, `shopify_location_id`, `qromo_webhook_secret`, `qromo_webhook_token`, `gemini_api_key`, `mcp_token`. Entrambe le tabelle sono service-role only (lockdown migr 0026); i flag si cambiano SOLO con decisione owner (Regola 15/16).
