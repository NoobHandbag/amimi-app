# GO-LIVE WORKPLAN — il "mega prompt" operativo (2026-07-03)

> Approvato dall'owner ("hai mia approvazione per fare tutto"), con obbligo di TEST per ogni pezzo
> (frontend incluso dove serve). Ordine voluto: pulizia B2B/test → note → safety 1+2 → tool spese →
> Shopify stock automatico + monitoraggio → Qromo. Ogni stage ha CRITERI DI TEST espliciti.
> Stato: [ ] da fare, [~] in corso, [x] fatto+testato.
> ESEGUITO 2026-07-03: stage 0-4 COMPLETATI E TESTATI; stage 5 validato (switch console = ultimo bottone, insieme all'owner).

## STAGE 0 — Pulizia dati di test (B2B + sweep)

- [x] **B2B: eliminare TUTTI i 17 movimenti** — confermato test dai dati: negozi `ZZ_*`, `TEST_NEGOZIO_QA`,
  Levanto/Como con nota "TEST B2B (alta giacenza, no rischio)", "matrix", "tz fix", "backdate".
  8 annullati (già fuori CE) + 9 attivi che oggi mettono ~220€ netto b2b nel CE di giugno.
  Azione: DELETE con audit in `change_log` (op `test_cleanup`). Eliminare anche il negozio registry
  `Test_Scheda_QA` e ogni `ZZ_*`. CONSEGUENZA VOLUTA: CE app diverge dal Master congelato
  (che i test li tiene) — documentare in TRIGGER_MIGRAZIONE §2b.
- [x] **Sweep altri dati sporchi:** (esito: PULITO, zero residui test fuori dal B2B) cercare in TUTTE le tabelle note/valori con pattern
  `TEST|test|prova|QA|ZZ_|fittizio|backdate` — presentare la lista, eliminare solo ciò che è
  inequivocabilmente test (gli adjustment `pulizia-pre-cutover` e `conta` NON si toccano: sono reali).
- TEST: v_ce_totale/v_ce_amimi giugno senza b2b; v_inventory senza in_conto_vendita fantasma;
  conteggi post-delete; change_log ha l'audit.

## STAGE 1 — Note: portare dentro la memoria storica

- [x] `purchases.note` (migr 0031, 39 note backfillate) → migration `0031` (+ `riferimento_documento`?) e backfill dal
  Master ACQUISTI per id_acquisto (39 righe con note: "1 ha difetto", ricodifiche, ecc.).
  Anche la write-api azione `purchase`/`arrival` deve accettare `note`.
- [x] `qromo_sales.note`: 3 note storiche backfillate; verificare se l'ETL ha importato la col Note di DB_QROMO; se no backfill per sale_id.
- [x] `expenses.note` importate (144 con nota, inclusi i DA VERIFICARE). `gifts.nota`, `products.notes`,
  `supplier_orders.note`, `counts.nota`, `returns.note` esistono. DB Shopify Notes = 0 usate (nulla da fare).
- TEST: conteggio note non-null = conteggio nel Master; spot-check 3 righe.

## STAGE 2 — Safety livello 1+2 (la serenità dei numeri)

- [x] **`ce_snapshots`** (migr 0032; gen-giu chiusi, 12 snapshot): a chiusura mese si congela il CE del mese (entrambi i CE, tutte le voci,
  jsonb + hash). Azione `close_month` (write-api o ce-guard). Vista `v_ce_drift`: mesi chiusi il cui CE
  live diverge dallo snapshot → drift!
- [x] **`ce-guard`** (deployata, cron 06:30; test drift sintetico +100 BECCATO; trovati e fixati: 1 giacenza negativa reale, 5 COGS luglio, stub Annie_Bag_Tiffany): invarianti contabili
  (netto=lordo/1.22 per canale; mc1 = omni_netto − Σ|variabili|; mc2 = mc1 − Σ|fissi|;
  0 vendite `unresolved`; 0 righe vendita senza COGS; giacenze ≥ 0; expenses con categoria valida;
  **drift dei mesi chiusi** = confronto vs ce_snapshots) + **riconciliazione esterna Shopify**
  (count+gross ordini del mese via Admin API vs shopify_orders). Esito → `health_log`
  (level ok/warn/error) + visibile in app.
- TEST: run manuale della guard → tutte verdi; iniettare un'anomalia sintetica (es. snapshot alterato
  in dry-run) → la guard la vede; chiudere giugno → snapshot scritto; vista drift = 0.

## STAGE 3 — Tool conferma spese (maschera per Ale/Benedetta)

Flusso reale: il task Cowork carica l'estratto conto in EXPENSES MASTER (da luglio: in APP via
`expense_propose`) con righe a nota `DA VERIFICARE (probabile X)` e categoria suggerita.
Ale/Benedetta leggono le info e confermano o ricodificano. LE NOTE NON SI PERDONO MAI.

- [x] Backend: già esisteva (`expense_propose` → status pending, `expense_approve`,
  `v_expenses_pending`). Estendere: azione `expense_review` = set categoria/sottocategoria/amimi_raw
  + status approved + approved_by + nota trasformata `DA VERIFICARE (X)` → `VERIFICATO (X)`
  (mantiene la parte informativa, appende la decisione se ricodificata).
- [x] Coda di revisione (v_expenses_review) = status='pending' **OR nota ~ 'DA VERIFICARE'** (i 5 storici attuali:
  2×Shopify SDD feb, Arcobaleno mag, PayPal Gifa mag, ENI mag).
- [x] Frontend: Registra ▸ Spese (maschera con dropdown 8 categorie, testata live: ricodifica OPEX→EVENTI + conferma ENI, coda 24→22): card per riga con TUTTE le info (operazione completa,
  data, importo, nota), dropdown categoria (7 valide) precompilato col suggerimento, campo
  sottocategoria, toggle Amimì sì/no, bottoni Conferma / Salva ricodifica. Badge col conteggio.
- TEST FRONTEND (browser): aprire l'app live, confermare 1 riga vera (ENI carburante) e ricodificarne
  1, verificare: DB aggiornato, nota preservata, CE invariato/coerente, la coda scende.

## STAGE 4 — Shopify stock automatico + monitoraggio

Policy variant-sync V2 da REPLICARE (mai copiare alla cieca il numero):
~~default esporre `disponibili − 2`; mai rialzi senza conta fresca~~ → **CAMBIATA 03-07 (feedback Benedetta): SPECCHIO DEL REALE, buffer 0, si alza e si abbassa.** La vecchia policy nascondeva 16 prodotti vendibili + 75 sotto-esposti. Ora `shopify_expose_buffer=0`, `shopify_hold_raises=false`. Caveat SC/CC (dual-variant over-espone) da rifinire — vedi NIGHT_LOG SESSION 31.
- [x] `shopify-stock` azione `realign_all` (v6; skip SKU unmapped ~90, mai azzerarli): calcola target per ogni codice on_shopify, applica la policy,
  scrive SOLO i driftati; gated da `app_flags.shopify_autopush_enabled`; ogni run scrive un riepilogo in
  `health_log` (pushed/held/skipped) + `change_log`.
- [x] pg_cron :27 + v_stock_drift (monitor) (dopo lo stock sync :17) + vista `v_stock_drift` (gestionale vs Shopify vs policy)
  come monitor "sta funzionando?" consultabile dall'app/Tables.
- [x] **Ritiro variant-sync**: trigger `reconcileApply` ELIMINATO via browser (restano report 07:00 e buildMap, non scrivono su Shopify). Primo push live: 20 push, 2 hold, verificato con ri-pull (Nina 24, Maria 0) (mai due writer): via browser sul progetto
  Apps Script "Amimi Variant Sync (SC-CC)" → disattivare il trigger orario (reversibile).
- TEST: run manuale realign_all in dry-run → lista sensata; live su 2-3 codici driftati → Shopify
  combacia; verifica health_log; con flag OFF il cron non scrive.

## STAGE 5 — Qromo diretto (prepararlo; LO switch resta l'ultimo bottone)

- [x] Test end-to-end della edge `qromo-webhook` (6/6: auth, not-paid, paid-missing, vendita risolta con COGS 14.58, dedup, unresolved flaggato; righe test rimosse con audit) con payload sintetico (auth giusta/sbagliata,
  paid true/false/missing, item non risolvibile) → righe attese in qromo_sales con source='qromo-direct',
  poi PULIRE le righe di test (sale_id sintetici, delete + change_log).
- [~] SWITCH SEQUENCE atomica documentata; lo switch console si fa INSIEME (punto di non ritorno): (1) spegnere il forwarder lato Apps Script
  (QromoForwardToApp / trigger SyncImportToDBQromo), (2) puntare il webhook Qromo alla edge
  (console Qromo), (3) smoke test con vendita reale, (4) rollback = ripuntare a /exec + riattivare forwarder.
  ⚠️ MAI entrambi attivi (sale_id diversi → vendite doppie).
- Lo switch effettivo (punto di non ritorno) si fa INSIEME all'owner a fine periodo ponte.

## Vincoli trasversali

- Ogni delete/update di massa: prima SELECT di conferma, poi audit in change_log, poi verifica.
- Ogni deploy web: `cd web && npm run build && npx gh-pages -d dist` + hard-refresh (PWA cache).
- Push git: account `NoobHandbag` (gh auth switch), mai branch, doc nella stessa run (NIGHT_LOG + qui).
- I 3 segreti in app_flags + token Shopify restano DA RUOTARE prima del congelamento del Foglio.
