# Amimì App - OPERATIONS (runbook giornaliero)

> Per operatori e AI che devono FAR FUNZIONARE l'app giorno per giorno. Creato 2026-07-06.
> Stato as-built: `ARCHITECTURE.md`. Dettaglio functions: `EDGE_FUNCTIONS.md`. Schema dati: `SCHEMA.md`.
> Regole vincolanti prima di ogni scrittura: `Cowork12/docs/00_REGOLE/REGOLE_FERREE.md` (era app, 2026-07-06).
> Principio: la write-api e' l'UNICA via di scrittura dati (Regola Ferrea 13); il Foglio Master e' LEGACY sola lettura (Regola 12).

## 1. Flusso dati per canale

- **Qromo (vendite negozio):** console Qromo -> webhook "Amimi App Supabase" -> edge `qromo-webhook` -> `qromo_sales` (source `qromo-direct`, idempotente su `sale_id`) -> `v_inventory` / `v_ce_*`. Se il nome prodotto non risolve (ne' `products.codice_norm` ne' `product_aliases`): la vendita NON si perde, entra con `resolver_status='unresolved'` e la segnalano ce-guard e `v_health`. Il COGS viene snapshottato da `products` al momento della vendita.
- **Shopify (ordini online):** cron :07 -> edge `shopify-sync` -> `shopify_orders` + `shopify_line_items`. Idempotente su order_id; re-sync di rimborsi/stato sugli ordini degli ultimi 45 giorni; resolver con fallback nome -> alias -> CODICE -> suffisso " - Senza/Con Catena" -> SKU.
- **Shopify (giacenze):** cron :17 pull (`shopify_stock`) + cron :27 push (`realign_all`). Policy SPECCHIO DEL REALE: target = disponibili da vendere, buffer 0, rialzi e ribassi liberi. Gate: `shopify_autopush_enabled`; hold opzionale "non alzare senza conta fresca <=30gg" via `shopify_hold_raises` (default off). SKU non mappati non vengono MAI toccati.
- **Spese:** app (Registra > Spesa) o Cowork via write-api: `expense_manual` (gia' approvata) / `expense_propose` (in coda) -> `v_expenses_review` -> `expense_approve`. COSTO negativo, categorie valide: COGS, LOGISTICA, MARKETING, OPEX, PACKAGING, SALARI, TASSE, EVENTI.
- **Tutte le altre scritture** (acquisti, conte, regali, B2B, ordini fornitore, arrivi, resi, correzioni vendita): azioni della write-api con `chi` valorizzato; ogni operazione finisce in `change_log`.

## 2. Inventario dei CRON

| Job | Orario | Cosa fa | Spia se fallisce |
|---|---|---|---|
| `shopify-sync-hourly` | :07 ogni ora | ordini Shopify nuovi + rimborsi/stato | `ce_shopify_reconcile`, `ce_sync_freshness` |
| `shopify-stock-hourly` | :17 ogni ora | pull giacenze -> `shopify_stock` | `ce_sync_freshness` (warn se synced_at > 120 min) |
| `shopify-autopush-hourly` | :27 ogni ora | push stock a Shopify (`realign_all`) | chiave `stock_autopush` in `health_log` (error se push falliti) |
| `health-daily` | 06:00 | `refresh_health_log()` dai 14 detector di `v_health` | righe assenti in `health_log` per oggi |
| `ce-guard-daily` | 06:30 | edge `ce-guard` action `run` (10 check `ce_*`) | righe `ce_*` assenti in `health_log` per oggi |
| `cs-sync-poll` | `*/2` | ingest posta cliente -> `cs_*` (tool assistenza, Fase 1) | `cs_sync` in `health_log`; NO-OP se `cs_enabled!='true'` |
| `cs-classify` | `*/5` | classificatore CS (categoria+urgenza, Fase 2) `cs-classify` | NO-OP se `cs_enabled!='true'`; decoupled dall'ingest |

Fuori pg_cron: **backup** GitHub Actions `db-backup.yml` daily 03:17 UTC (artifact JSON 90gg, exit non-zero se parziale) + **snapshot Drive** "Amimi App Snapshots" 05-06 Roma (mail a info@amimi.it su errore).

## 3. Diagnostica guidata (quando qualcosa non torna)

Punto di partenza: **`health_log` di oggi** (il banner rosso in Home compare se c'e' almeno un error/warn):
`select * from health_log where day = current_date order by severity, k;`

| Spia | Dove guardare | Causa tipica e fix |
|---|---|---|
| `ce_drift_mesi_chiusi` | `v_ce_drift` (delta netto E mc2 per mese/CE) | scrittura retroattiva in mese chiuso. Dal 06-07 write-api la blocca (409 `closed_month`); se il drift esiste gia': correggere e RI-CHIUDERE il mese (decisione owner) |
| `ce_qromo_unresolved` | `qromo_sales` con `resolver_status='unresolved'` | prodotto non a catalogo o nome Qromo non allineato: creare il prodotto o l'alias, poi `sale_correct` |
| `ce_cogs_mancanti` | vendite risolte senza COGS | prodotto senza `cogs` in anagrafica: `product_verify` con cogs |
| `ce_giacenze_negative` | `v_inventory` con giacenza < 0 | acquisto mai registrato o vendita mis-attribuita |
| `stock_autopush` (error) | `health_log` + `change_log` (failedCodici) | push Shopify fallito: la riga resta STALE su Shopify e vende fantasmi, indagare subito |
| `ce_shopify_token` / `ce_shopify_reconcile` | token in `app_config`, conteggio ordini API vs DB | token scaduto o pipeline morta silenziosa |
| `ce_expenses_da_verificare` | `v_expenses_review` | spese in coda di approvazione |
| `shopify_orphan` / `qromo_orphan` / `dup_codice` / `period_mismatch` | `v_health` (detector migr 0035) | righe vendita non agganciate a un prodotto, duplicati di casing, date fuori bucket |

**Webhook Qromo che non consegna** (caso aperto al 06-07: 0 righe `source='qromo-direct'`, baseline 150 righe seed): guardare il bottone Log del webhook in console Qromo e confrontare con `select count(*) from qromo_sales where source='qromo-direct';`. Errore vero su un item -> la edge risponde non-200 e Qromo ritenta (idempotente).

## 4. Operazioni manuali note

- **Chiusura mese:** edge `ce-guard` action `close_month` (year, month, chi) -> congela il CE in `ce_snapshots` (mai sovrascrive). Correzioni retroattive: `force` + motivo sulla write-api, poi ri-chiusura. Decisione contabile = owner.
- **Realign stock manuale:** edge `shopify-stock` action `realign` (codici, chi), gated `shopify_write_enabled`.
- **Deploy edge/migrazioni** (solo Claude Code, Regola 16): edge via Supabase MCP `deploy_edge_function`; migrazioni in `supabase/migrations/` via `apply_migration`. Frontend: `cd web && npm run build && npx gh-pages -d dist` (hard refresh della PWA dopo).
- **Restore:** artifact JSON del backup GitHub Actions (90gg) per il ripristino; lo snapshot Drive e' la copia leggibile a occhio.

## 5. Chi fa cosa (confini)

- **Cowork:** legge via REST anon, scrive SOLO via write-api (`integrations/cowork_amimi.py`). Non tocca migrazioni, edge, `app_flags`/`app_config`: propone via brief in `_CLAUDE_CODE_INBOX/`.
- **Claude Code:** migrazioni, edge functions, repo, deploy; documenta in `amimi-app/docs/` + `Cowork12/docs/_CHANGELOG_CODE.md`.
- **Owner:** decisioni contabili (chiusure, restatement), rotazione segreti, flag di gate.
