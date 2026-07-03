# Trigger Migrazione — runbook di go-live (app = fonte di verità al posto del Foglio)

> Scopo: la sequenza ESATTA, ordinata, per spegnere il Google Sheet Master (+ Apps Script, dashboard, task Cowork, webhook) e far diventare **amimi-app** (React PWA + Supabase, project `imszbjeyplaiovylhkgl`) l'unico sistema di record.
> Aggiornato: 2026-07-01. Fonti: gap-analysis multi-agente + sessioni SESSION 18–24 (`NIGHT_LOG.md`).
> Regola d'oro: **niente è irreversibile finché non switchi il webhook Qromo e congeli il Foglio.** Fino a lì si gira in parallelo.

---

## 0. Cosa è GIÀ pronto (non rifare)

- **CE Amimì** ricalcolato nativo, riconciliato al Foglio (feb/mar al centesimo, apr/mag ~1% per scelta).
- **CE Totale** ora **nativo** (`v_ce_totale`, non più la copia stale): calcolo live Amimì + gifts + spese complete, con il blocco non-Amimì di gen/feb come input congelato.
- **Inventario** nativo (`v_inventory` = acquisti − vendite + resi + rettifiche-conta).
- **Conta = rettifica** della giacenza (adjustment ledger), **resi** (con Qromo nel CE), **B2B annullato** — tutti i write-path principali live via `write-api` (service-role + `change_log`).
- **Sicurezza**: lockdown anon (migr 0026) — anon non scrive e non legge i segreti.
- **Feed ordini Shopify** (`shopify-sync`): diretto da Shopify, idempotente, autorevole → **blocker chiuso**.
- **Scrittura stock Shopify** (`shopify-stock realign`): validata live, **doppia variante SC/CC** gestita (spinge su tutti gli inventory-item del codice). Manuale, gated da `shopify_write_enabled`.

---

## 1. Blocker al cutover (stato)

| # | Blocker | Stato |
|---|---|---|
| 1 | **Webhook Qromo** punta ancora all'Apps Script (Foglio), non alla edge `qromo-webhook` | 🟢 **SWITCHATO 03-07** (vedi §4b) — smoke test alla prima vendita reale |
| 2 | Feed ordini Shopify autorevole senza Apps Script | ✅ fatto |
| 3 | Scrittura Shopify (stock realign) | ✅ fatto (single + SC/CC). Resta: trigger automatico (vedi §2 fase 3) |
| 4 | Flag `single_source_of_truth` (interruttore di coordinamento) | 🔴 da creare |
| 5 | **Ruotare i segreti**: 3 Supabase (`gemini_api_key`, `mcp_token`, `qromo_webhook_secret`) + **token Shopify** (esposto in chat 01-07) | 🟠 da fare con owner |
| 6 | Pulizia giacenze negative + codici-ordine orfani | 🟢 **fatto**: negative = 0 (35 rettifiche) + 13 codici orfani sistemati (4 ripuntati ai canonici Agata, 9 stub `verificato=false` per Benedetta) |
| 7 | Backup/DR runbook (backup schedulato + restore testato) | 🟠 backup logico giornaliero **live** (GH Action `db-backup`, artifact 90gg, run verificata 14s); resta il restore-test |
| 8 | Runbook di cutover scritto (questo doc) | 🟢 in corso |
| 9 | Dashboard/consumatori che leggono il Master vanno ripuntati | 🟢 **Operations pronta** (switch `DATA_SOURCE`, vedi §2 Fase 3.1); Finance = no-op (non legge il Foglio); inventario-web + gestione.html = porting al cutover (vedi Fase 3.1b) |

---

## 2. Sequenza go-live (fasi)

### Fase 1 — Pulizia & presa in carico (app non ancora autorevole)
1. **Giacenze negative** → riconciliate a 0 (vedi §3). ✅/in corso.
2. **Codici-ordine orfani → ✅ fatto (01-07)**: 13 codici in `supplier_orders` senza prodotto (0 impatto su stock/CE, vivevano solo negli ordini). 4 doppio-prefisso Agata ripuntati ai canonici esistenti; 9 stub `verificato=false, source='app-ordine'` creati (5 Porta carte + Agata ORGANZA_LILLA/ROSE_BUTTER_LILLA + Annie SETA_VERDE + Lea x Rita) → ora in cima alla coda "Nuovi da arricchire" di Benedetta. Orfani residui = 0.
3. Verificare che PRODUCT_MAP/COGS non abbiano buchi (nessuna vendita irrisolta, nessun COGS mancante).
4. Backfill delle ~38 immagini prodotto mancanti (UX, non bloccante).

### Fase 2 — Ingest cutover (l'app diventa l'inlet, in parallelo)
1. **Switch webhook Qromo** nella console Qromo → `…/functions/v1/qromo-webhook` (auth = `app_flags.qromo_webhook_secret`). **SOSTITUIRE** il vecchio, non affiancare (schemi `sale_id` diversi → vendita doppia). Da quel momento il Foglio non riceve più Qromo. Rollback: ri-puntare a `/exec`.
2. Confermare `shopify-sync` come unico feed ordini: girare in parallelo un ciclo e confrontare i conteggi, poi disattivare la fetch 6h dell'Apps Script.
3. Portare i task Cowork che scrivono (corrispettivi-iva, expenses-master-upload, month-end-close) a scrivere in app via `write-api` / `cowork_amimi.py` invece che su EXPENSES MASTER.
4. **Ruotare i segreti** (blocker 5) e aggiornare il secret del webhook Qromo in `app_flags`.

### Fase 3 — Consumatori & feature
1. **Dashboard — stato per consumer (mappa multi-agente + implementazione 02-07):**
   - **Operations (noobhandbag.github.io/amimi-dashboard) → PRONTA.** Il feed `ops-feed-8f21.json` è prodotto da `scripts/build-feed.mjs` (repo amimi-dashboard) con doppia sorgente: oggi `sheet` (passthrough dashdata, identico a prima), al cutover si setta la **repo variable `DATA_SOURCE=supabase`** (`gh variable set DATA_SOURCE --body supabase --repo NoobHandbag/amimi-dashboard`, account NoobHandbag) e lo stesso shape esce dalle viste Supabase. Frontend intatto. Riconciliato vs feed live: CE Amimì gen–mar esatto, spese identiche, apr ~1% (parity nota), mag/giu Supabase più fresco del Foglio. La modalità supabase **corregge il bug `Math.abs` su margine2** (feb Totale è −267.33, il feed sheet mostrava +267.33) e i giftPezzi di gen/feb del blocco non-Amimì restano solo come netto aggregato. Ads: META/GOOGLE/GA4 passthrough da dashdata finché vive, fallback `meta_ads_daily`. Aggiunte le colonne `fulfilled_at`+`discount_codes` a `shopify_orders` (migr 0030, shopify-sync v3 + backfill 267 ordini, finestra API 60gg) per le tab Salute/Marketing.
   - **Finance (React/Recharts su Apps Script) → NO-OP.** Non legge NESSUN tab del Foglio a runtime: è un simulatore Q2 2026 con costanti hardcoded (inventario marzo 2026), già scaduto il 30-06. La migrazione non lo rompe. Decisione owner separata: ritirarlo o rifarlo per Q3 con seed da `v_inventory`+`v_ce_amimi_summary` (~30 righe di fetch client-side).
   - **1b. Inventario pubblico (/exec) + gestione.html → porting al cutover, NON mezzo-ripoint ora.** Motivo: fino allo switch Qromo il Foglio è più fresco di Supabase, e gestione.html SCRIVE sul Foglio (ripuntare solo le letture creerebbe incoerenza scrivi-e-non-vedi). Al cutover: (a) l'Inventario pubblico è coperto dalla pagina Inventario di amimi-app — ritirare il /exec (attenzione: lo stesso deployment serve anche `?conta_shop=1` e `?app=gestione`); (b) gestione.html va portata su Supabase per le letture E su write-api per le scritture B2B/gift (oggi passa da fix-anagrafica→Foglio) — è un **workstream nuovo**, con gap dati da colmare: `sku_history` (tab Disponibilità, oggi solo nel Foglio), stato ACTIVE/DRAFT Shopify per codice (manca in `shopify_stock`), anagrafica negozi completa (tabella `negozi` ha solo 4 campi vs B2B_NEGOZI), checkbox tracker ordini (gest/shop/pronto mancano in `supplier_orders`), telemetria variant-sync (muore col Foglio, ok).
2. **Trigger automatico stock Shopify**: abilitabile SOLO dopo la pulizia negative (§3) e il ritiro del variant-sync (altrimenti due writer in conflitto). Poi: azione `realign_all` gated da `shopify_autopush_enabled` + cron orario. Estendere per SC/CC (già fatto lato realign) e ritirare il variant-sync.
3. Esporre `health_log`/`v_health` come cruscotto ops con alert.
4. (Opzionale) ruoli/gate sulle azioni distruttive; Obiettivi Tracker nativo.

### Fase 4 — L'interruttore (all-or-nothing)
1. Creare `single_source_of_truth` in `app_flags`; i consumatori leggono app-first.
2. Dry-run del runbook: congelare le scritture sul Foglio, disattivare i trigger Apps Script (fetch 6h, sync Qromo orario), collassare i ~12 task Cowork A+B.
3. **Backup/DR**: pg_dump schedulato + restore testato PRIMA di dismettere il Foglio.
4. Archiviare un export finale del Master come audit congelato; alzare `single_source_of_truth = 'app'`.
5. Guida minima in-app per i cofondatori.

---

## 2b. Parity CE finale (audit 03-07) — PASSATA, con il Master in torto sui delta

- **Riferimento congelato:** `audit/Amimi_Master_2026_V2_REFERENCE_PRE-CUTOVER_2026-07-03.xlsx` (in git, PER SEMPRE). Script di verifica: `scripts/ce_parity.py` (Master export vs viste live, tutte le voci, mesi 1–7).
- **Riallineamento pre-check:** expenses 237→278 (replace), gifts 126→130, meta 128→130, purchases +2 (append `ARR_*_20260708`), via `etl-load` temporanea (ridispiegata e SUBITO ritirata a stub 410). Qromo e B2B già pari (il forwarder orario tiene Qromo corrente).
- **Esito:** fissi (salari/tasse/logistica/opex/eventi) ESATTI gen–giu su entrambi i CE; offline (Qromo) ESATTO; COGS/commissioni/logistica var/resi esatti o ±0,07.
- **Delta residui — TUTTI spiegati, e quasi tutti errori del MASTER:**
  1. **Il CE del Master non vede le righe recenti dei suoi stessi tab** (classe "fallimento silenzioso", audit 09-06): marketing mar (−32,99: le 3 righe expenses aggiunte il 02-07) e apr (−17,23); ordini giu (CE=168 ma DB Shopify del Master ne ha 172, identici all'app); gift giu (CE=82 pezzi ma GIFT_OFFLINE ne ha 87 → +COGS 135). L'app conta tutto correttamente.
  2. **Apr/mag ±1%** su online lordo/netto: residui refund-timing, scelta documentata in `docs/CE_PARITY.md`.
  3. **Gen/feb Totale, split di canale:** il blocco non-Amimì manuale vive nella replica solo come netto aggregato (`ce_totale_manual`) → le righe Online pezzi/lordo di gen/feb differiscono ma **l'Omni netto e MC1/MC2 tornano** (gen ±0,40 di rounding del seed).
  4. Il segno di MC2 del Totale (gen–apr negativi) combacia col Master; era la VECCHIA dashboard a mostrarlo positivo (bug `Math.abs`).

## 3. Pulizia giacenze negative (stato reale 01-07)

- **35 codici negativi.** Incrociati col Master: **solo 2** hanno l'acquisto nel Foglio (`Lea_Bag_ZEBRA` acq 10, `Annie_Bag_PAILLETTES_PINK` acq 12 — già in app, sono i sovra-venduti Cat C). Gli **altri 33** sono **buchi veri o mis-coding**: venduti/regalati ma mai acquistati nemmeno nel Foglio.
- **Conseguenza:** non c'è nulla da "risincronizzare" dagli acquisti del Master. Il fix corretto è **riconciliare a 0** (una giacenza non può essere negativa: al minimo hai fatto ciò che hai venduto).
- **Metodo:** `stock_adjustments` di `+ammanco` con `motivo='pulizia-pre-cutover'` → giacenza a 0. **CE-neutro** (il COGS nel CE è snapshottato per vendita, gli adjustment non lo toccano) e **reversibile** (basta cancellare le righe).
- **Cat C risolti (01-07):** `Lea_Bag_ZEBRA` e `Annie_Bag_PAILLETTES_PINK` → conta fisica **0** confermata dall'owner → rettifica a 0 (source `conta`). **Negative totali ora = 0.**
- **Follow-up cosmetico (non bloccante):** i **ghost** (item nullo/variante=modello) andrebbero **ri-mappati** (`sale_correct`) al prodotto vero per l'attribuzione corretta del venduto (non cambia lo stock, migliora il reporting per-SKU).

---

## 4. Decisioni aperte (owner)

1. **Chiusura/IVA/corrispettivi**: nativi in app o generati da Cowork/Notion leggendo Supabase?
2. **Publish Shopify**: manuale nell'admin al cutover, o path nativo (serve `write_products` sul token)?
3. **Stile cutover**: switch secco a una data, o a fasi col flag `single_source_of_truth`?
4. **Controllo accessi**: PIN condiviso o ruoli per-utente (es. Benedetta approva Ale)?
5. **Backup**: chi lancia il pg_dump, dove, ogni quanto.

---

## 4b. SWITCH QROMO — ✅ ESEGUITO il 2026-07-03 (~12:30 CET), smoke test in attesa

**Lo switch è FATTO.** In console Qromo (Settings ▸ General ▸ Webhooks) esiste UN solo webhook:
**"Amimi App Supabase"** → `https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/qromo-webhook?key=qromo-…`
(tipi New orders + Update orders). Il vecchio "Import GsheetsQromo" (Apps Script `AKfycbwAAL4Ni…/exec`)
è stato **cancellato** — la subscription Qromo ammette 1 solo webhook, quindi l'ordine obbligato è stato
Delete → Add (finestra senza webhook: pochi secondi). Da ora il Foglio NON riceve più le vendite Qromo.

- **Auth (edge v3, difesa in profondità):** la edge accetta TRE credenziali equivalenti:
  (a) `?key=` nell'URL = `app_flags.qromo_webhook_secret` (è nel URL configurato in console);
  (b) `body.auth` = stesso secret; (c) `body.auth` = token generato da Qromo per il nuovo webhook,
  salvato in `app_flags.qromo_webhook_token` — così l'auth regge anche se Qromo strippasse la query string.
  Testata live su v3: auth errata → 401; token Qromo → ok; `?key=` → ok (payload senza ordine, zero scritture).
- **Smoke test (in attesa della prima vendita reale):** baseline al momento dello switch = 150 righe in
  `qromo_sales`, ultima 02-07 17:25, 0 righe `source='qromo-direct'`. La prossima vendita in negozio deve
  produrre 1 riga `qromo-direct` e nessun doppione (il forwarder non riceve più nulla, `sale_id` diversi).
  Check: `select * from qromo_sales where source='qromo-direct' order by created_at desc;` + bottone **Log**
  del webhook in console Qromo (mostra le consegne).
- **Forwarder Apps Script:** resta installato ma a secco (il Foglio non riceve più righe nuove in Import).
  Lasciato attivo apposta come pezzo del rollback.
- **Rollback:** in console Qromo, Delete "Amimi App Supabase" → New webhook verso `AKfycbwAAL4Ni…/exec`
  (tipi New+Update). Il Foglio ricomincia a ricevere e il forwarder riprende da solo.

## 5. Punto di non ritorno & rollback

- **Il punto di non ritorno è lo switch del webhook Qromo (Fase 2.1).** Dopo, il Foglio non ha più le vendite Qromo nuove.
- **Rollback rapido:** ri-puntare il webhook Qromo a `/exec` (Apps Script) → il Foglio ricomincia a ricevere. L'app tiene comunque i suoi dati.
- Tutto il resto (sync Shopify, dashboard) è ripristinabile riattivando i trigger Apps Script finché non li cancelli.

---

## 6. Sicurezza — segreti da ruotare (prima o durante il cutover)

- Supabase: `gemini_api_key`, `mcp_token`, `qromo_webhook_secret` (erano leggibili da anon fino al 30-06).
- Shopify: il token write (`ADMIN_TOKEN`) è transitato in chat il 01-07 → rigenerarlo su Shopify e rimetterlo in `app_config.shopify_token` (e nel variant-sync finché è vivo).

---

## 7. Checklist minima "siamo pronti?"

- [ ] Negative a 0, orfani sistemati, nessun COGS mancante.
- [ ] `shopify-sync` confermato unico feed ordini (1 ciclo di parità).
- [ ] Trigger stock automatico attivo e variant-sync ritirato.
- [ ] Dashboard ripuntate su Supabase.
- [ ] Segreti ruotati.
- [ ] Backup pg_dump schedulato + restore testato.
- [ ] `single_source_of_truth = 'app'`.
- [ ] Export finale del Master archiviato.
