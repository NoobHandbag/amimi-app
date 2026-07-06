# Amimì App - SCHEMA (tabelle, viste, colonne generate)

> Stato cumulativo dello schema dopo le migrazioni `0001`-`0038` (generato 2026-07-06 leggendo `supabase/migrations/`). Per rigenerarlo: rileggere le migrazioni o `list_tables` via Supabase MCP.
> Filosofia (migr 0001): la storia si carica FEDELE e permissiva (niente FK strette), i problemi EMERGONO dalle viste di salute; l'integrita' stretta sta sul write path (write-api). Niente RLS: anon e' sola lettura via REVOKE, le scritture passano dal service-role delle edge.

## 1. Colonne GENERATED (MAI scrivibili: si corregge sempre l'input)

| Tabella | Colonna | Formula |
|---|---|---|
| products | `codice_norm` | upper + spazi collassati a `_` |
| products | `is_finalized` | codice non vuoto e non termina in `_` |
| product_aliases | `shopify_name_norm` | come codice_norm |
| purchases | `codice_norm`, `costo_totale` | norm; round(quantita * costo_unitario, 2) |
| shopify_line_items | `codice_norm` | norm |
| qromo_sales | `codice_norm` | norm |
| b2b_movements | `codice_norm`, `retail_tot`, `quota_negozio`, `incasso_amimi` | norm; prezzo*qta; *perc_negozio; *(1-perc_negozio) |
| gifts_offline | `codice_norm` | norm |
| returns | `codice_norm` | norm |
| stock_adjustments | `codice_norm` | norm |
| expenses | `amimi` | lower(trim(amimi_raw)) = 'si' |
| expenses | `categoria_valid` | categoria in (COGS, LOGISTICA, MARKETING, OPEX, PACKAGING, SALARI, TASSE, EVENTI) |

Un INSERT/UPDATE che include una colonna generata FALLISCE (gia' successo: orphan_cleanup 01-07).

## 2. Tabelle anagrafica

- **`products`**: 1 riga = 1 CODICE_AMIIMI. `codice` UNIQUE + **UNIQUE su `codice_norm`** (migr 0037, anti-duplicati di casing). Campi: model, variant, item, categoria, shopify_name, shopify_sku, `retail_price` (IVA inclusa), `cogs`, description, seo_title, image_url, `verificato`.
- **`product_aliases`**: nome sito Shopify -> CODICE (`shopify_name_norm` generato). NON unique sul nome: un nome con 2 codici e' un bug segnalato, non bloccato.
- **`non_product_codici`**: codici da ignorare come prodotto (Gift Card, Vendita_Generica...). Il resolver li salta.
- **`suppliers`**, **`negozi`** (con `perc_default` per il conto-vendita).

## 3. Tabelle transazionali (fonti dell'inventario e del CE)

- **`purchases`** (ACQUISTI, verita' del carico): data, codice, quantita, costo_unitario, `costo_totale` generato, fornitore, note.
- **`shopify_orders`** + **`shopify_line_items`**: ordini (gross/net/discount/shipping/fees/refund, financial/fulfillment status, `fulfilled_at`, `discount_codes`) e righe (codice risolto, `cogs_snapshot`). Idempotenti su order_id.
- **`qromo_sales`** (vendite negozio): `prezzo` = PAGATO per unita' (sconti inclusi), `cogs` snapshot, `resolver_status` (resolved/unresolved), `sale_id` con **UNIQUE parziale** `qromo_sales_live_saleid_uq` per source in (`qromo-direct`, `qromo-forward`) (migr 0036); i duplicati storici da ETL sono tollerati.
- **`b2b_movements`**: conto_vendita/wholesale, tipo invio/reso/venduto, stato (le righe `annullato` sono ESCLUSE dal CE, migr 0028), incassi generati.
- **`gifts_offline`**: regali/vendite offline; QUIRK: `prezzo` e' il TOTALE riga (non si moltiplica per qta), `cogs` e' per unita'.
- **`returns`** (migr 0018): resi/cambi su 3 canali; `rientra_stock` bool, `sostituito_con` per i cambi merce. Nel CE la riga resi e' nettata /1.22 dal 06-07 (migr 0038).
- **`expenses`** (EXPENSES MASTER): `costo` NEGATIVO; `status` approved/pending/rejected con proposed_by/approved_by; `amimi` e `categoria_valid` generate.
- **`counts`** (staging conte) + **`stock_adjustments`** (migr 0027): la conta scrive in counts e produce una rettifica firmata in stock_adjustments (delta calcolato lato server); `v_inventory` somma le rettifiche.
- **`supplier_orders`**: ordini fornitore multi-borsa (`gruppo` uuid, qty_ordered/qty_arrived, costo_unitario, data_consegna; `wip` boolean da migr 0041: quantita'/costo ignoti, si risolve all'arrivo via arrival_set).
- **`meta_ads_daily`**: metriche Meta per campagna/giorno (da seed).

## 4. Tabelle di servizio

- **`change_log`**: audit di OGNI scrittura (tbl, op, before/after jsonb, `chi`, source).
- **`health_log`**: esiti giornalieri dei guardiani, UNIQUE (day, k); chiavi `ce_*` scritte da ce-guard, il resto da `refresh_health_log()`, `stock_autopush` da shopify-stock.
- **`ce_snapshots`** (migr 0032): mesi chiusi congelati, UNIQUE (ce, year, month), ce in ('amimi','totale'); base del blocco scritture di write-api e di `v_ce_drift`.
- **`ce_totale_monthly`**: copia storica del CE_TOTALE dal Foglio. NON e' piu' la fonte del Cruscotto (vedi `v_ce_totale`).
- **`ce_totale_manual`** (migr 0028): blocco manuale del Totale (gennaio 2026 pre-Amimi + rettifiche feb) che si SOMMA al calcolo live in `v_ce_totale`.
- **`app_config`** (singleton: pin_hash, shopify_token, iva_rate 0.22) e **`app_flags`** (key/value: gate Shopify, secret Qromo, key Gemini, token MCP): entrambe SERVICE-ROLE ONLY (lockdown migr 0026).
- **`shopify_stock`**: specchio giacenze/immagini Shopify (variant_id, `inventory_item_ids[]` per i dual SC/CC, synced_at; `shopify_status` active/draft/archived da migr 0041 + sync v10).

## 5. Viste (logica derivata)

- **`v_inventory`**: giacenza = acquisti - shopify - qromo - regali - b2b_venduto + resi_rientrati + aggiustamenti; espone anche in_conto_vendita, disponibili_da_vendere, valore, last_sale, on_shopify (da `shopify_stock` LIVE, migr 0021; dal 0041 SOLO status active: le bozze non contano come pubblicate), image_url con fallback Shopify.
- **`v_ce_amimi`** / **`v_ce_amimi_summary`**: P&L brand per mese (online/offline/b2b netti /1.22, cogs, packaging, commissioni, logistica, resi /1.22 da migr 0038; MC1, MC2).
- **`v_ce_totale`** / **`v_ce_totale_summary`** (migr 0028, DI RECORD per il Totale): calcolo live + blocco `ce_totale_manual`.
- **`v_ce_drift`** (migr 0032): mesi in `ce_snapshots` con delta netto/mc2 tra congelato e live.
- **`v_health`** (migr 0023 + 0035): 14 detector: img_missing, stock_neg, cogs_missing, price_missing, orders_orphan, todo_products, lost_sales + shopify_orphan, qromo_orphan, dup_codice, period_mismatch, ce_drift_live e affini.
- **`v_expenses_review`** (migr 0032): coda spese pending o "da verificare" (sostituisce v_expenses_pending).
- **`v_products_todo`**: anagrafiche incomplete con bucket di priorita'.
- **`v_ordini_arrivo`**, **`v_fornitore_prodotti`**: monitor ordini fornitore e storico costi per fornitore.
- **`v_shopify_align`**, **`v_stock_drift`** (migr 0034): disallineamenti app<->Shopify e azione di policy per l'autopush (ok / da_abbassare / da_alzare / hold_serve_conta).
- **`v_reorder`**, **`v_sku_availability`**: velocita' 60gg + giorni di stock; stato SKU (acquistabile / in_stock_non_pubblicato / pubblicato_esaurito). Dal 0041 v_reorder espone `riordino_archiviato` (flag su `products`, archivio riordino ripristinabile) e v_ordini_arrivo/v_fornitore_prodotti hanno il fallback immagini da shopify_stock + flag `wip`. Dal 0043 il CODICE e' TUTTO MAIUSCOLO in 12 tabelle (decisione owner 06-07; SKU Shopify legacy invariati, join case-insensitive); 0042 (solo server, dati non nel repo per privacy) ha backfillato i customer_name degli ordini #1001-#1179 dal Foglio Master.
- **`v_resi_mensile`**, **`v_ads_mensile`**, **`v_last_sale`**, **`v_conto_vendita_negozio`**.

## 6. Funzioni DB

- **`ask_select(q text)`**: SECURITY DEFINER; SELECT-only, singolo statement, keyword DML/DDL vietate, cap 200 righe, timeout 5s. EXECUTE solo service_role (migr 0016). APERTO audit A1: manca l'allowlist di viste.
- **`refresh_health_log()`**: rigenera le righe di oggi in `health_log` dai detector di `v_health` (NON tocca le chiavi `ce_*`, migr 0035). Chiamata dal cron health-daily.
- **`norm_codice(t)`**: helper immutabile, stessa normalizzazione delle colonne generate.

## 7. Sicurezza (stato finale)

- anon / authenticated: SELECT su tabelle operative e viste; INSERT/UPDATE/DELETE REVOCATI ovunque (migr 0026); TRUNCATE REVOCATO + default privileges future (migr 0037); ZERO accesso a `app_config`/`app_flags`; `ask_select` non eseguibile.
- service_role: tutto (usato solo dalle edge functions).
- Niente RLS: il modello e' read-only pubblico by-design (frontend no-login) + write path unico.

## 8. Cron (pg_cron)

5 job attivi: vedi `OPERATIONS.md` §2 (shopify-sync :07, stock sync :17, autopush :27, health 06:00, ce-guard 06:30). Definiti nelle migrazioni 0011/0024/0032/0034.
