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
| 1 | **Webhook Qromo** punta ancora all'Apps Script (Foglio), non alla edge `qromo-webhook` | 🔴 aperto — è LO switch |
| 2 | Feed ordini Shopify autorevole senza Apps Script | ✅ fatto |
| 3 | Scrittura Shopify (stock realign) | ✅ fatto (single + SC/CC). Resta: trigger automatico (vedi §2 fase 3) |
| 4 | Flag `single_source_of_truth` (interruttore di coordinamento) | 🔴 da creare |
| 5 | **Ruotare i segreti**: 3 Supabase (`gemini_api_key`, `mcp_token`, `qromo_webhook_secret`) + **token Shopify** (esposto in chat 01-07) | 🟠 da fare con owner |
| 6 | Pulizia giacenze negative + codici-ordine orfani | 🟢 **fatto**: negative = 0 (35 rettifiche) + 13 codici orfani sistemati (4 ripuntati ai canonici Agata, 9 stub `verificato=false` per Benedetta) |
| 7 | Backup/DR runbook (backup schedulato + restore testato) | 🟠 backup logico giornaliero **live** (GH Action `db-backup`, artifact 90gg, run verificata 14s); resta il restore-test |
| 8 | Runbook di cutover scritto (questo doc) | 🟢 in corso |
| 9 | Dashboard/consumatori che leggono il Master vanno ripuntati | 🔴 aperto |

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
1. Ripuntare **dashboard** (Operations, Finance, inventario pubblico, `gestione.html`) sulle viste Supabase (`v_ce_amimi_summary`, `v_ce_totale`, `v_inventory`) invece del Foglio.
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
