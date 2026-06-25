# Cowork ↔ App — mappa dei task schedulati (2026-06-25)

Per ognuno dei 27 task Cowork (registro `Cowork12/projects/Control_Center/sched_tasks.json`), dove va
rispetto all'Amimì App. Si appoggia al piano di Cowork `Piano_Condensazione_Task_Schedulati_2026-06-25.md`
(quello riguarda la riduzione del numero; questo riguarda app vs Foglio).

**Principio:** Cowork può leggere/scrivere l'app via HTTP (`integrations/cowork_amimi.py`, nessuna auth
Google). Molti task esistono SOLO per reggere la fragilità del Foglio: muoiono al cutover dell'app.

## A) Muoiono col cutover dell'app (esistono solo per il Foglio)
| Task | Perché muore | Fino ad allora |
|---|---|---|
| `amimi-master-health-check` | l'app ha vincoli/tipi DB: niente #REF!/arrayformula da controllare | resta su Cowork |
| `aggiorna-snapshot-shopify` | l'app ha già il sync Shopify orario | resta (alimenta il cruscotto Foglio) |
| `aggiorna-snapshot-gestionale` | l'app È la sorgente, niente snapshot del Master | resta |
| `aggiorna-snapshot-tutto` | idem (cruscotto = app) | resta |
| `aggiorna-miniature-cruscotto` | le foto vivono nell'app | resta |
| `amimi-report-settimanale` | il Cruscotto dell'app è il report | può restare come export PDF |

## B) Già coperti dai flussi dell'app (ridondanti a regime)
| Task | Coperto da |
|---|---|
| `registra-acquisti` | Inserisci ▸ Acquisto / In arrivo (arrivi) |
| `registra-conta` | Inserisci ▸ Conta fisica |
| `verifica-chiusura-prodotti` | Verifica ▸ Prodotti (v_products_todo) |
| `agente-upload-prodotti` | Verifica ▸ Pubblica (GATED finché `shopify_write_enabled` off) |
| `riallinea-stock` | Inventario ▸ Shopify (realign, GATED) |
| `qromo-product-sync` | il resolver `SyncImportToDBQromo` + ponte Qromo→app risolvono i nomi; resta solo per casi non risolti |

## C) Restano su Cowork (Google/Notion/Chrome/email) — possono scrivere nell'app via helper
| Task | Perché resta | Aggancio all'app |
|---|---|---|
| `corrispettivi-iva-mensile` | legge Gmail/PayPal/Shopify (auth Google) | può scrivere le spese/IVA nell'app via `write-api` |
| `expenses-master-upload-mensile` | legge estratti banca (file/Drive) | → `expense_manual` nell'app per riversare le spese |
| `month-end-close` | checklist di chiusura | diventa "verifica i numeri dell'app" invece che del Foglio |
| `amimi-site-audit` | automazione Chrome su amimi.it | nessuno (resta Chrome-bound) |
| `ledger-notion-rollup` | scrive il riepilogo su Notion | nessuno (solo Notion) |
| `weekly-doc-sync` | igiene doc locali | nessuno (filesystem) |
| `lessons-mining` | meta (mining chat) | nessuno |
| `aggiorna-control-center` | meta Cowork (la sua sidebar) | nessuno |
| `indaga-decisioni` / `esegui-decisione` | motore decisioni di Cowork | nessuno |

## D) Orchestratori prodotto (si assottigliano)
| Task | Nota |
|---|---|
| `pipeline-prodotti` | giro completo: chiama health-check/upload/registra-acquisti/qromo-sync/verifica. Man mano che i sub-step passano all'app, resta un guscio sottile |
| `fix-and-verifica` | giro veloce, stessi sub-agenti. Cowork propone di fonderli (Livello 3 del suo piano) |

## E) Cancellabili (già spenti — Livello 1 del piano Cowork)
`cc-refresh-veloce`, `aggiorna-mappa-chat`, `month-end-close-b2b-verifica-giugno`.

## Sintesi
- **App-native subito o a breve (pg_cron + edge fn):** già fatto Shopify (orario) e Qromo (orario via hook).
  Candidabili: health-check sostituito dagli advisor/constraint del DB; report dall'app.
- **Restano a Cowork per natura (8):** tutto ciò che tocca Gmail/Drive/Notion/Chrome/meta — categoria C.
- **Già nell'app (6):** ingestione prodotti/conte/acquisti/verifica/realign/qromo — categoria B.
- **Muoiono al cutover (6) + cancellabili (3).**

Il grande taglio arriva col **cutover** (l'app sostituisce il Foglio): allora A+B (≈12 task) spariscono.
Fino ad allora: parallel-run, e Cowork riversa nell'app ciò che produce (categoria C) col helper.
