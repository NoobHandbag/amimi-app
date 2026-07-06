# Amimì App — Stato e ripresa (self-contained)

> Doc di ripresa per Alessandro: leggi QUESTO per ricominciare a lavorare a migliorie da una chat nuova, senza contesto.
> Aggiornato: 2026-07-06 (sezioni §3 edge/cron e §5 allineate allo stato corrente; corpo UX fermo al round-4 del 2026-06-29). Fonti agganciate: `docs/ARCHITECTURE.md` (as-built), `docs/OPERATIONS.md` (runbook), `docs/EDGE_FUNCTIONS.md`, `docs/SCHEMA.md`, `docs/NIGHT_LOG.md` (storia per sessione), `docs/FEATURE_BACKLOG.md`, `docs/qromo_webhook_cutover.md`, `docs/DOSSIER_pulizia_dati_pre_cutover.md`, `docs/REPORT_verifica_stasera_2026-06-29.md`.
> Non duplica quei doc: li riassume e dice cosa è aperto.

> AGGIORNAMENTO 2026-07-04 (post-cutover). Dal 2026-07-03 il sistema di record per vendite, stock, inventario e CE e' amimi-app (https://noobhandbag.github.io/amimi-app + Supabase imszbjeyplaiovylhkgl); il webhook Qromo punta alla edge function qromo-webhook e il Foglio Master non riceve piu' le vendite Qromo (resta semi-attivo fino al congelamento). Le parti di questo documento su parallel-run app/Foglio, qromo-webhook IDLE, gate `shopify_write_enabled` e `ce_totale_monthly` copiato dal Foglio valgono come storico/rollback. Stato corrente: amimi-app/docs/TRIGGER_MIGRAZIONE.md.

---

## 1. Cos'è amimi-app e stato attuale

Replica DB-backed del gestionale Amimì (oggi su Google Sheet + Apps Script), usabile da telefono. Tesi: spostare la logica derivata (inventario, P&L) da formule fragili del foglio a **viste SQL**, eliminando la classe di bug "fallimento silenzioso" (arrayformula che collassano, CE letto per indice riga, casing dei CODICE).

- **LIVE:** https://noobhandbag.github.io/amimi-app/ (aprila dal telefono, è una PWA).
- **Backend:** Supabase Postgres — project `amimi-app` / `imszbjeyplaiovylhkgl` (org Caprotti, eu-central-1, free tier $0/mo). URL `https://imszbjeyplaiovylhkgl.supabase.co`.
- **Auth/posture (scelta del proprietario, rilassata):** **lettura senza PIN** (la anon key pubblica nel bundle ha solo SELECT sulle viste report). **Scrittura solo via edge function `write-api`**, che è PIN-gated ma con **PIN neutralizzato a `x`** di proposito (i ruoli sono design, non sicurezza). Segreti mai nel bundle (token Shopify in `app_config`, chiavi Gemini/MCP/Qromo in `app_flags`, solo service-role).
- **Repo:** `github.com/NoobHandbag/amimi-app` (pubblico). Locale: `GESTIONALE AMI CLAUDE/amimi-app/`.
- **App ≠ Foglio:** sono oggi **paralleli**. L'app è stata seedata UNA volta dal Foglio; Shopify ordini entra in autonomia (sync orario). Qromo/spese/regali/acquisti nell'app sono fermi allo snapshot tranne i ponti sotto. (SUPERATO il 2026-07-03: l'app e' il sistema di record; Qromo entra diretto via edge `qromo-webhook` e il Foglio non riceve piu' le vendite Qromo.)

---

## 2. Stack + build/deploy + gotcha

**Stack frontend:** React 19 + Vite 8 + TypeScript, PWA, mobile-first. `@supabase/supabase-js`. Test E2E con Playwright. Lint `oxlint`. (Vedi `web/package.json`, `web/vite.config.ts`.)

**Build & deploy (dalla cartella `amimi-app/web/`):**
```bash
cd web
npm run build           # tsc -b && vite build
git add -A && git commit -m "..."   # (commit/push solo quando serve versionare il sorgente)
git push
npx gh-pages -d dist    # pubblica dist/ sul branch gh-pages → sito live
```
C'è anche lo script `npm run deploy` (= `gh-pages -d dist`).

**Gotcha noti (fanno perdere tempo se ignorati):**
- **Account gh sbagliato → push 403.** Il `gh` CLI deve essere loggato come **NoobHandbag**, non DanGEEIQ. Fix: `gh auth switch --user NoobHandbag` (NON il Credential Manager di Windows). Vedi memoria `git_push_account_gh_switch`.
- **Service worker PWA serve codice stale.** Dopo un deploy, sul telefono/desktop può restare la vecchia build cachata: serve un **hard refresh** (o chiudere/riaprire la PWA) per vedere le modifiche.
- **Base path `/amimi-app/`** è hardcoded in `vite.config.ts`. Se cambia il nome repo/Pages, va aggiornato o l'app carica bianca (asset 404).
- **Edge functions NON via CLI:** si deployano via Supabase MCP `deploy_edge_function` (no `supabase link` locale). Migrazioni SQL in `supabase/migrations/`.

---

## 3. Mappa file (dove vive cosa)

### Frontend — `amimi-app/web/src/`
- `App.tsx` + `main.tsx` + `App.css` / `index.css` — shell, nav, stili.
- **Pagine** (`pages/`): `Home.tsx` (home per persona), `Report.tsx` (Cruscotto P&L + Meta + Chiedi ai dati + calcolatore B2B), `Ingest.tsx` (Registra: conta/reso/regalo-vendita/B2B/nuovo prodotto/spesa + **Pulizia dati** e **Pubblica su Shopify**), `Ordini.tsx` (ordini fornitore + arrivi), `Inventory.tsx` (Magazzino: **Disponibilita**/Magazzino/Riordino/Negozi/Shopify/Valore).
  > **Nav 4 voci (dal 2026-06-30, SESSION 15):** Home, Registra, Ordini, Magazzino. Il tab "Prodotti" e' stato dissolto: `Prodotti.tsx` non e' piu' una pagina, e' un modulo che **esporta `ProdVerify` (Pulizia dati) e `Publish` (Pubblica su Shopify)**, renderizzati come azioni dentro `Ingest`. **Correggi vendita e Diagnostica sono stati rimossi dall'UI** (codice ancora in git, riattivabile). `ARCHITECTURE.md` §7 e' ancora pre-redesign.
- **Form** (`components/`): `CountForm`, `PurchaseForm` (orfano dal round-4: l'arrivo si fa da Ordini/ArrivoRow), `ReturnForm`, `GiftForm`, `B2BForm`, `NewProductForm`, `ExpenseForm`, `OrderForm`, `SupplierOrderForm`, `ProductPicker`, `SupplierPicker`, `NegozioPicker`, `SpeseManage`, `RecentFeed`.
- **Componenti riusabili UX:** `NumberStepper.tsx` (stepper -/+ mobile su ogni campo qta/prezzo), `ExportBtn.tsx` (export CSV per pagina).
- **Lib** (`lib/`): `api.ts` (tutte le chiamate read REST + write verso write-api), `supabase.ts` (client anon), `toast.ts` (toast eleganti, sostituiscono i box msg inline), `helpers.ts` (`suggestPrice`, `genSeoTitle`), `csv.ts` (export), `people.tsx` (picklist persone), `sortable.tsx` (tabelle ordinabili).

### Backend — `amimi-app/supabase/`
- **Edge functions** (`functions/`, versioni verificate live al 2026-07-06; dettaglio in `EDGE_FUNCTIONS.md`): `write-api` v14 (UNICO path di scrittura; azioni: purchase, count, gift, b2b, product, order, order_multi, arrival, arrival_set, product_verify, expense_manual/propose/approve, sale_correct, return, **qromo_sale**; ogni scrittura → `change_log`; dal 06-07 BLOCCA le scritture nei mesi chiusi in `ce_snapshots` senza force+motivo), `shopify-sync` v4 (pull ordini Shopify sola lettura, cron :07; fallback resolver + re-sync rimborsi dal 06-07), `shopify-stock` v9 (giacenze + push stock: autopush **LIVE** cron :17 sync e :27 realign_all, policy specchio del reale buffer 0), `qromo-webhook` v4 (**LIVE** dal cutover 03-07; smoke test prima vendita reale ancora aperto al 06-07), `ce-guard` v2 (guardiano contabile daily 06:30 → `health_log`; azione close_month), `ask-data` v4 (NL→SQL via Gemini, legge `v_ce_totale`), `mcp` v4 (server MCP per pilotare l'app da Claude), `etl-load` v4 (RITIRATA, stub 410).
- **Viste SQL** (`v_*`, logica derivata): `v_inventory` (giacenza = acquisti − shopify − qromo − regali + resi_rientrati), `v_ce_amimi` / `v_ce_amimi_summary` (P&L brand, parità col Foglio Feb/Mar al centesimo, Apr/Mag ~1%), `ce_totale_monthly` (P&L Totale, verbatim dal Foglio, include gennaio ereditato) (SUPERATO il 2026-07-03: ora `v_ce_totale` nativa, migr 0028), `v_conto_vendita_negozio`, `v_ordini_arrivo`, `v_fornitore_prodotti`, `v_products_todo`, `v_expenses_pending`, `v_shopify_align`, `v_reorder`, `v_sku_availability`, `v_last_sale`, `v_ads_mensile`, `v_resi_mensile`. Colonne **generate, mai scrivere**: `codice_norm`, `products.is_finalized`, `expenses.amimi`/`categoria_valid`, `purchases.costo_totale`, `b2b_movements.incasso_amimi`/`quota_negozio`/`retail_tot`.
- **Integrazioni** (`integrations/`): `cowork_amimi.py` (helper Python zero-dipendenze: Cowork legge via REST anon e scrive via write-api pin `x`, niente auth Google), `qromo_forwarder.gs` (Apps Script che inoltra DB_QROMO→write-api; è il ponte attuale, vedi §5).

### Cron (pg_cron) — 5 job attivi (verificati live 2026-07-06)
- `shopify-sync-hourly` (`7 * * * *`), `shopify-stock-hourly` (`17 * * * *`, sync), `shopify-autopush-hourly` (`27 * * * *`, realign_all), `health-daily` (`0 6 * * *`, `refresh_health_log()`), `ce-guard-daily` (`30 6 * * *`). Fuori pg_cron: backup GitHub Actions 03:17 UTC + snapshot Drive 05-06 Roma. Dettagli e diagnostica: `OPERATIONS.md`.

---

## 4. Cosa è stato fatto (round-4 stasera + giri precedenti)

**Round-4 / SESSION 10 (stasera, commit `7ad16af`, gh-pages live) — 5 raffinamenti UX da feedback con screenshot:**
1. **Personalizzazione solo nella Home** — `PersonaPicker` tolto dagli altri tab; le azioni "Registra" non sono più filtrate per persona.
2. **Tile "Arrivo/Acquisto" tolto da Registra** — quel flusso vive in Ordini (ArrivoRow/`arrival_set`).
3. **Reso sale-anchored con foto + cliente** — `fetchSalesByCodice` risolve `shopify_orders.customer_name`, il reso mostra foto prodotto e nome cliente.
4. **`NumberStepper` -/+** visibile su mobile su ogni campo qta/prezzo (Reso, Regalo/Vendita, B2B, Conta, Nuovo prodotto, Spesa, Ordine, Arrivo).
5. **Toast eleganti** (`lib/toast.ts`) al posto dei box msg inline nei form di scrittura.

> Verifica di stasera (vedi `REPORT_verifica_stasera_2026-06-29.md`): tutte e 5 verificate al codice E dal vivo. #1/#2/#3 complete. #4/#5 "parziali" su una meta' implicita: #4 manca il CSS che nasconde gli spinner nativi (su desktop appaiono accanto ai bottoni); #5 due form (ArrivoRow, ProdEdit) non ancora migrati al toast. Migliorie e priorita' dettagliate nel report.

**Giri precedenti (sintesi dal NIGHT_LOG, dal più vecchio):**
- **S1–2:** schema Supabase + ETL dal Foglio (168 prodotti), viste inventario + CE (Feb/Mar al centesimo), dashboard read-only live, poi le form di Inserisci + Inventario, write-api PIN-gated.
- **S3–4:** sync Shopify live orario; gennaio chiarito (CE_AMIMI gennaio = €0 reale, i ~4k sono CE_TOTALE ereditato → `ce_totale_monthly`); Cruscotto ridisegnato (4 KPI, filtro mesi, toggle Amimì/Totale, trend per canale); PIN rimosso (neutralizzato a `x`).
- **S5:** i workflow owner DB-native (ordini fornitore multi-borsa, verifica prodotto, correzione vendita, approvazione spese, pubblica-gated).
- **S6–7c:** Resi/Cambi (la #1 gap, prima invisibile nel CE); poi il backlog costruibile (Riordino, Disponibilità SKU, Valutazione magazzino, Pricing helper, SEO generator, Meta Ads card, calcolatore B2B); check automatici verdi; "Chiedi ai dati" acceso con Gemini.
- **S8–9c:** ARCHITECTURE as-built; ponte Cowork→app (`cowork_amimi.py`); **ponte Qromo→app deployato e automatico** (hook in fondo a `syncImportToDBQromo` → `forwardQromoSalesToApp` ogni ora → write-api `qromo_sale`); form vendita manuale (Regalo/Vendita con prezzo+pagamento); server **MCP** (claude.ai web connesso, 6 tool read; write dietro bearer token).
- **Giri UI di stasera pre-round-4 (verificati present):** export = icona download (`ExportBtn`); immagini ovunque (backfill, box quadrato — nota: object-fit `contain` per scelta, non `cover`); Magazzino tabella di sintesi + drawer 3 giacenze; treemap Shopify (nota stock = magazzino−2); ITEM+VARIANTE su una riga; prodotti >90gg nascosti (ProductPicker attivi/vecchi); "Nei negozi" lista per ultima vendita (`v_last_sale`); Ordini a card per fornitore + arrivo editabile (`arrival_set`); fix bug silenzioso shopify-sync (+€3.862 recuperati).

---

## 5. Decisioni aperte / prossimi improvement

1. **Semantica del tap "conto-vendita" (B2B) — RISOLTO (2026-06-30).** L'utente ha confermato: il tap su un negozio in "Nei negozi" deve registrare una **vendita B2B**. È già il comportamento attuale: `Inventory.tsx` view `neg` fa `go('registra','b2b:<negozio>')` → `Ingest` apre `B2BForm` con `initialNegozio` e tipo default **"Venduto"** (vendita, muove il CE via `b2b_movements`). Nessuna modifica necessaria. Per memoria: un movimento B2B può comunque essere Invio / Venduto / Reso; il `reso` B2B re-pool-a lo stock e **non** è un rimborso di cassa.
2. **Cutover Qromo webhook** (`docs/qromo_webhook_cutover.md`). (SUPERATO il 2026-07-03: switch eseguito in console Qromo, edge v3 LIVE, smoke test prima vendita reale pendente al 04-07; vedi TRIGGER_MIGRAZIONE.md §4b.) La edge function `qromo-webhook` è costruita/deployata/testata (5 casi) ma **IDLE**. Al cutover: nella console Qromo **SOSTITUIRE** l'URL del webhook con `…/functions/v1/qromo-webhook` (campo `auth` = `app_flags.qromo_webhook_secret`). **NON affiancarlo** al webhook/forwarder Apps Script: schemi `sale_id` diversi → vendita contata due volte. Conseguenza: il **Foglio smette di ricevere le nuove vendite Qromo**. Farlo solo quando l'app è fonte di verità. Rollback: ri-puntare a `/exec`.
3. **Pulizia dati pre-cutover** (`docs/DOSSIER_pulizia_dati_pre_cutover.md`). 34 giacenze negative (Cat. A re-map vendite fantasma ~14 = neutro sul CE, si fa subito; Cat. B/C acquisti mancanti = serve Master fresco + conferma pezzi/data) + 14 codici-ordine orfani (cosmetici, non toccano lo stock). Metodo: preview→dry-run→real, verifica conteggi dopo ogni lotto.
4. **CE_TOTALE — input mensile.** Oggi `ce_totale_monthly` è copiato verbatim dal Foglio (gennaio ereditato). Decisione per il cutover: **Opzione 1 (consigliata)** input mensile manuale; Opzione 2 ricalcolo nativo (richiede portare tutta l'attività non-Amimì + gennaio in app, molto più lavoro). (SUPERATO il 2026-07-03: `v_ce_totale` e' nativa da migr 0028, calcolata non copiata; mesi chiusi gen-giu congelati in `ce_snapshots` e sorvegliati da `ce-guard` daily 06:30.)
5. **Copertura immagini ~130/168** prodotti. Mancano ~38 `products.image_url`; backfill da Shopify/manuale per completare le gallery nei picker e in Inventario.
6. **Migliorie UX dal report di stasera** (`REPORT_verifica_stasera_2026-06-29.md`). **FATTE (SESSION 12, 2026-06-30, non ancora deployate):** (a) spinner nativi nascosti in `.stepper .num`; (b) overflow `.subtabs` contenuto (overflow-x:auto, page-overflow 0 a 360px); (c) ArrivoRow/ProdEdit migrati al toast; (d) `aria-live`/`role` sul toast; (f) pulizia residui orfani (`PurchaseForm.tsx` eliminato, `'purchase'` tolto da people.tsx, prop `setChi` rimossa, commento corretto). **APERTA:** (e) stepper nel carrello SupplierOrderForm + editor arrivi — rimandata (serve variante compatta dello stepper in righe flex strette, rischio layout mobile).
7. **Gate ancora chiusi:** `shopify_write_enabled` off (realign Shopify + pubblica-prodotto restano in sola lettura finché non lo abiliti). (SUPERATO il 2026-07-03: autopush stock LIVE, shopify-stock v7 con cron :17 e :27, policy specchio del reale buffer 0, hold opt-in via `shopify_hold_raises`; vedi GO_LIVE_WORKPLAN.md stage 4.)
8. **Non costruite (servono feed esterni):** triage servizio clienti (feed DM/email), analytics ritiri-in-negozio/popup (tag ordine Shopify non nel pull). Vedi `FEATURE_BACKLOG.md`.
9. **Aperti post-remediation audit 2026-07-06** (lo stato VIVO e' nella testata di `audits/AUDIT_SYSTEM_2026-07-06.md` e nelle voci del 06-07 di `_CHANGELOG_CODE.md`): rotazione segreti + chiusura esfiltrazione ask_select (A1/A2, URGENTE, saltata per scelta owner: esposizione ancora live); smoke test webhook Qromo (0 righe `source='qromo-direct'` al 06-07, baseline 150); restatement/ri-chiusura dei mesi chiusi dove `v_ce_drift` lo mostra (decisione owner); attivazione uptime monitor esterno (`.github/workflows/uptime.yml` creato ma il push richiede lo scope `workflow`: azione owner); diferiti B13 (idempotency-token) e B16 (atomicita' arrival).

---

## 6. Come riprendere da un'altra chat

**Doc da leggere (in `amimi-app/docs/`), in quest'ordine:**
0. **`TRIGGER_MIGRAZIONE.md`** e **`GO_LIVE_WORKPLAN.md`**: stato post-cutover (dal 2026-07-03 l'app e' il sistema di record), leggili per primi. Per OPERARE: **`OPERATIONS.md`** (runbook: flussi, cron, diagnostica), **`EDGE_FUNCTIONS.md`**, **`SCHEMA.md`** (creati 2026-07-06).
1. **QUESTO file** — stato e indice.
2. **`REPORT_verifica_stasera_2026-06-29.md`** — cosa è stato verificato di stasera e le migliorie proposte con priorità (ottimo punto di partenza per il prossimo giro di lavoro).
3. **`ARCHITECTURE.md`** — verità as-built (stack, tabelle, viste, edge functions, cron, sezioni frontend, integrazioni, cosa manca/gated).
4. **`NIGHT_LOG.md`** — storia per sessione (la coda è lo stato più recente; SESSION 10 = round-4).
5. **`FEATURE_BACKLOG.md`** — cosa è BUILT vs DESIGNED, edge case noti (casing CODICE, MAXI distinti, stock negativo).
6. **`qromo_webhook_cutover.md`** / **`DOSSIER_pulizia_dati_pre_cutover.md`** — solo se lavori al cutover Qromo o alla pulizia dati.

**Memorie utili (MEMORY.md del progetto):** `amimi_app_rebuild_plan`, `git_push_account_gh_switch`, `data_use_latest_export`, `qromo_canonical_join_fix`.

**Per agire sull'app:** read via REST anon (chiave pubblica nel bundle / `lib/supabase.ts`); write SOLO via `write-api` con `pin:'x'`; da Python/Cowork usa `integrations/cowork_amimi.py`. Dopo ogni modifica al frontend: `cd web; npm run build; git push; npx gh-pages -d dist` + hard refresh. Dopo ogni edge function/migrazione: Supabase MCP `deploy_edge_function` / migrazioni in `supabase/migrations/`.
