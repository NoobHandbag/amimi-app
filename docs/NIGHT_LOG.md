# NIGHT LOG — overnight build of amimi-app

> **LOG STORICO DI SESSIONE, NON documentazione corrente** (banner 2026-07-06). Chi cerca lo stato del sistema va su `ARCHITECTURE.md` (as-built), `TRIGGER_MIGRAZIONE.md` (post-cutover), `OPERATIONS.md` (runbook), `EDGE_FUNCTIONS.md` e `SCHEMA.md`. Qui sotto: la storia per sessione delle build notturne, utile solo come archeologia.

Running log so the morning report writes itself. Newest entries at the bottom.
Times are approximate (no wall clock in the build sandbox); ordering is what matters.

## 2026-06-24 — overnight session 1

- **Phase 0 start.** Toolchain verified: Node v24.14.0, npm 11.9.0, git 2.53, gh authed,
  Deno MISSING (Edge Functions will deploy via Supabase MCP; deno optional locally),
  Supabase CLI MISSING (using MCP). Parent git root = `GESTIONALE AMI CLAUDE`.
- Created `amimi-app/` (git init) as a sibling repo. Added `.gitignore` (blocks `.env`,
  real `fixtures/*.xlsx`) and `.env.example` BEFORE any commit, so no secret/data leak.
- Kicked off Vite React-TS scaffold + `npm install` (background).
- Loading Supabase provisioning tools (list_organizations / get_cost / confirm_cost /
  create_project / apply_migration / execute_sql).
- Supabase org = **Caprotti** (`mzgsovphckqlniubcqmd`); existing unrelated paused project
  ("Caprotti food") left untouched. New project cost = **$0/month** (free tier).
- Seed = `Amimi_Master_2026_V2_2026-06-24_0906_postfix.xlsx` (1.27 MB) -> `fixtures/seed.xlsx`.
- Vite React-TS scaffold OK in `web/` (npm install clean, 0 vulnerabilities).
- Authored `supabase/migrations/0001_core_anagrafica.sql` (suppliers, negozi, products,
  product_aliases, non_product_codici, change_log, app_config). Philosophy: load faithfully,
  flag don't reject; strict integrity on the write path.
- Next: create project `amimi-app`, apply migrations, add transactions + views, then ETL.

### Open questions logged
- _(none yet)_

### Blocked
- _(nothing blocked the overnight run)_

---

## MORNING REPORT — 2026-06-25 (overnight session 1)

### What's working (live in the replica)
- **Supabase project `amimi-app`** (eu-central-1, $0/mo). GitHub: `NoobHandbag/amimi-app` (private).
- **Schema**: 6 migrations — base tables (faithful, generated columns kill the #REF! class),
  `v_inventory`, `v_ce_amimi` + `v_ce_amimi_summary`.
- **ETL** (`etl/load.mjs`, idempotent): loads the 2026-06-24 export — every table reconciles
  to source row counts (168 products, 227 purchases, 411 shopify lines, 116 qromo, 124 gifts,
  237 expenses, 114 meta).
- **Inventory** (`v_inventory`): 111/115 giacenze match the Sheet exactly. 4 off by −2 are
  flagged as corrected-overlay candidates (replica likely MORE correct — see CE_PARITY.md).
- **P&L** (`v_ce_amimi_summary`): **Feb & Mar match the Sheet to the cent** (MC1/MC2);
  Apr/May within ~1%. The entire CE_AMIMI formula set is reverse-engineered and documented
  in `docs/CE_PARITY.md`. Parity harness: `etl/parity.mjs`.

### Key discoveries (saved to CE_PARITY.md)
- Online Lordo = Vendite(Σ line price×qty) − discount + freeship + shipping; Netto = /1.22.
- Offline Lordo = Σ qromo.prezzo (flat — prezzo is the row total).
- Packaging = −(3.71×pieces + 1×online_orders) — E-Comm box per order, rest per piece.
- `amimi` filter is **case-insensitive** ('Si' matches) — resolves the old "si vs Si" doc conflict.

### Open (for next sessions, in priority order)
1. Close Apr/May CE residual (~1%): order-level refund-timing reconciliation.
2. Build `v_ce_totale` (= CE_AMIMI + gifts + all expenses) and validate.
3. Add an automated parity test (vitest) asserting Feb/Mar exact — testing mandate.
4. Phase 3: ingestion forms (the cofounder data-entry app) — the stated #1 goal.
5. Review the 4 inventory −2 flags + the CE_TOTALE Feb-online 2× quirk with the owner.

### How to look at it
- DB: Supabase dashboard → project `amimi-app` → SQL editor → `select * from v_ce_amimi_summary;`
- Code: `github.com/NoobHandbag/amimi-app` or local `amimi-app/`.
- Parity re-run: `cd amimi-app/etl && node --env-file=.env parity.mjs`.

### Notes
- Nothing was written to any live system (Sheet/Shopify/Qromo) — fully isolated, reads only.
- AI brain intentionally absent (no API key, DECISIONS D11). All logic above is rule-based/SQL.

---

## SESSION 1 COMPLETE — live deliverable

**Live mobile dashboard → https://noobhandbag.github.io/amimi-app/** (open it on your phone).
Read-only, validated data: the P&L (Feb/Mar exact vs your Sheet) + the inventory reorder list.

**Security posture (this replica):** the public bundle carries the Supabase anon key, so I
**revoked anon INSERT/UPDATE/DELETE**. The public can READ the two report views, not write.
- Consequence: **re-running the ETL now requires re-granting writes first.** Before
  `node --env-file=.env load.mjs`, run (MCP/SQL): `grant insert, delete on all tables in schema public to anon;`
  then optionally revoke again. Phase 8 replaces this with a dedicated ETL Postgres role.
  [SUPERATO in SESSION 23: re-seed via edge etl-load PIN-gated; NON riaprire MAI le write anon]

**Delivered tonight:** Phases 0–2 + a live dashboard. All pushed to
`github.com/NoobHandbag/amimi-app` (public). Nothing touched any live system (reads only).

**Next (Phase 3 — ingestion):** the cofounder data-entry app. First decide the write-path —
anon is read-only by design, so writes go through a PIN-checked Edge Function (or privileged
role). That's task 1 of Phase 3.

---

## SESSION 2 — Phase 3 + 4 shipped (ingestion + inventory)

All **three sections** live at https://noobhandbag.github.io/amimi-app/ :
- **Cruscotto** — validated P&L + reorder list.
- **Inserisci** — 5 smart forms (Conta fisica, Arrivo/Acquisto, Nuovo prodotto, Regalo, B2B):
  product image-picker + search, supplier/negozio cards, live CODICE generation, dates pre-filled,
  Arrivi auto-fills cost+supplier from the last purchase. Operatore Ale/Bene + PIN.
- **Inventario** — search + filters (da riordinare / esauriti / in negozio), value & stock.

Write path: PIN-gated `write-api` Edge Function (server validation + change_log audit); anon stays
read-only. **PIN `amimi2026`** (SHA-256 in app_config; change with
`update app_config set pin_hash=encode(digest('NEWPIN','sha256'),'hex')`). 5 Playwright E2E passing.

Next: CE_TOTALE view, close Apr/May CE residual, richer reporting, live read-only sync jobs (Phase 6).

---

## SESSION 3 — feedback round + Phase 6 (live Shopify sync)

Owner feedback handled: January excluded (inherited P&L); "In arrivo" supplier-orders tab (order +
mark-arrival → auto-updates stock); Inventario rebuilt (dead stock hidden, product images,
on-Shopify + available pieces, per-store "Nei negozi" view).

**Phase 6 live sync:** `shopify-sync` Edge Function (PIN-gated, read-only) pulls new Shopify orders,
resolves CODICE via product_aliases, inserts ONLY orders newer than the seed (historical stays
cent-exact), idempotent. Scheduled **hourly via pg_cron** (jobname shopify-sync-hourly). Token in
`app_config.shopify_token` (service-role only; anon SELECT on app_config revoked). Caveat: live
orders use an ESTIMATED payment fee (~2.2%+€0.25) + free_shipping=0 — exact only for seeded history.
Next: same for Qromo (webhook) + Meta; reconcile live payment fees.

## SESSION 4 — owner feedback round 2 (Cruscotto redesign + PIN removal)

Handled the explicit asks from the 6-flows message:
- **PIN removed** — writes go through write-api with a neutralized constant (`pin='x'`,
  `app_config.pin_hash=sha256('x')`); cron rescheduled with `{"pin":"x"}`. Relaxed posture per owner
  (roles are design-only, not safety). Operators expanded to Ale / Bene / Ginevra / Dan.
- **Cruscotto inventory card removed** from the headline (lives in Inventario).
- **Cruscotto redesigned to mirror the live finance dashboard (PDF export):**
  4 KPIs (Fatturato Lordo / Netto / MC1 / MC2), a **period filter** (month chips Gen–Giu + "Tutti")
  that recomputes the stats, a **scope toggle Amimì vs Totale**, and a monthly channel-stacked trend.
- **January added.** Root cause clarified: CE_AMIMI (brand) January is genuinely €0 — Amimì sales
  start in Feb (DB_QROMO/DB Shopify have zero Jan-2026 rows; only 34 expense + 6 gift rows exist).
  The ~4k January in the owner's dashboard is the **CE_TOTALE** (whole-business) inherited figure.
  Added `ce_totale_monthly` (migration 0012) seeded VERBATIM from the Master CE_TOTALE tab (Jan–Jun);
  the Totale toggle shows January faithfully without recomputation (replica only holds Amimì txns).
  Per CRITICAL RULE #1 no values were invented — all read from `fixtures/seed.xlsx`.
- MC KPIs sum only closed months (giugno in corso has no fixed costs yet).

Verified: build clean, dashboard E2E green (asserts filter + scope + January-via-Totale), mobile
screenshots captured for both scopes. Live: https://noobhandbag.github.io/amimi-app/
Next: the 6 owner workflows (multi-bag supplier orders, product-detail verification, sale→product
correction, Shopify inventory mgmt, expense approval, NL→SQL via Gemini).

## SESSION 5 — owner workflows (DB-native flows live)

Built the data-native owner workflows on a hardened write path. **write-api v6** now handles:
order_multi, product_verify, expense_manual/propose/approve, sale_correct — alongside the
existing insert/arrival actions. Key lesson: the DB has many **generated columns** that must NOT
be written (codice_norm, products.is_finalized, expenses.amimi + categoria_valid,
purchases.costo_totale, b2b_movements.incasso_amimi/quota_negozio/retail_tot) — hit three of them
in testing, fixed, redeployed. All 9 flow E2E checks green.

Live flows:
- **FLOW 1 — supplier orders (Ginevra):** "In arrivo" rebuilt. Supplier-first; bag picker filtered
  to that supplier via `v_fornitore_prodotti` (derived from purchase history, with last cost +
  image); add new bags on the fly (provisional codice, auto-creates a `verificato=false` product
  stub so it lands in FLOW 2); multi-line cart; order date editable; per-line arrivals with editable
  date. Orders grouped by supplier (`gruppo` uuid, `v_ordini_arrivo` rebuilt).
- **FLOW 2 — product verification (Benedetta):** `v_products_todo` surfaces the ~16 genuinely
  incomplete products (missing item/variant — image/desc/seo are empty for ALL seed rows so not a
  signal), sellers first. Edit form completes + flips `verificato`.
- **FLOW 4/5 — expenses:** propose (Inserisci ▸ Spesa = pending) → approve/reject or add direct
  (Verifica ▸ Spese). `amimi` computed from `amimi_raw`, costo negative, category validated.
- **SECOND — sale→product correction (Verifica ▸ Vendite):** pick original product → pick the sale
  (Qromo or Shopify) → reassign to the real product; inventory follows. Returns `shopify_stock_pending`.
- **FLOW 3 — publish hub (Verifica ▸ Pubblica):** lists verified-not-on-Shopify products; **gated**
  behind `app_flags.shopify_write_enabled` (off). NOTE: the Shopify-inventory update must move out
  of product creation.

Nav → 5 tabs (+ Verifica). Migrations 0012/0013/0014 persisted to repo; supabase/migrations now
matches live. Verified via mobile screenshots (no console errors).

**Still to build (external deps):** THIRD flow (Shopify inventory misalignment view + manual realign
— needs a live Shopify-stock read function) and FLOW 6 (NL→SQL via Gemini — needs a Google AI Studio
key in `app_flags.gemini_api_key`). The live Shopify-write half of FLOW 3 + the Shopify-stock step of
SECOND are gated until enablement.

## SESSION 6 — plan finalized, exhaustive testing, first new feature (Returns)

**Plan finalized:** THIRD (Shopify alignment) + FLOW 6 (NL→SQL) shipped earlier this session.

**Exhaustive testing** — `tests/flows.mjs`, 34 checks across every flow + variant, run live. It caught
**two real bugs**, both fixed: gifts_offline & b2b_movements lacked a `chi` column so the generic
insert (which always adds chi) failed → gift + B2B ingestion were silently broken (migration 0017
adds the column). Documented the sale_correct item/variant `?? before` fallback (can't null a field;
the UI always passes the target product's values, so correct in production).

**Old-chats mining** (subagent over `Catalogo_Chat_Amimi.xlsx`, 363 chats) → `docs/FEATURE_BACKLOG.md`:
10 designed features + known edge cases. Top gaps: returns/exchanges, reorder board, SKU-availability.

**NEW FEATURE — Returns & Exchanges** (the #1 gap; offline returns were invisible in the CE):
- `returns` table + write-api `return` action (canale, importo_rimborsato, rientra_stock, motivo,
  sostituito_con). Migration 0018.
- Stock wired into v_inventory: a return with rientra_stock=true adds back to giacenza (resi_rientrati
  column appended; discarded/damaged returns don't re-enter). CE parity untouched (it's sales-based).
- Money visible via `v_resi_mensile` (kept out of the parity-validated CE on purpose).
- UI: Inserisci ▸ "Reso / Cambio" — product, qty, canale, motivo, refund, rientra toggle, exchange
  picks a replacement product. 5 return checks green (stock +1 on re-entry, unchanged when discarded).

write-api now at v7. Live. Still designed-not-built: reorder board, SKU-availability monitor, deal
calculator, pricing/SEO helpers, CS triage, ads card, valuation (see FEATURE_BACKLOG.md).

## SESSION 7 — built the backlog (waves 1–3)

Six more features from FEATURE_BACKLOG.md, all live (suite still 34/34):
- **Riordino board** (Inventario▸Riordino) — v_reorder: velocity 60d + stock + in-arrivo, sorted by
  urgency, "da riprodurre" badge for best-sellers running out with nothing incoming.
- **Disponibilità SKU** (Inventario▸Disponibilità) — v_sku_availability: purchasable-now count + the
  two loss types. Live: 52 acquistabili, 29 in-stock-non-pubblicati, 18 pubblicati-esauriti.
- **Valutazione magazzino** (Inventario▸Valore) — stock at COGS and at retail, by line.
- **Pricing helper** — suggestPrice(cogs, margin) VAT-inclusive, surfaced in NewProduct + verify forms.
- **SEO generator** — genSeoTitle to the brand formula (leather vs Nina), with 60–70 char counter.
- **Meta Ads card** (Cruscotto) — v_ads_mensile from meta_ads_daily (spend, ROAS, per-month).
- **B2B deal calculator** (Cruscotto, collapsible) — pick products + qty + sell-in €/pz → wholesale
  margin/profit vs conto-vendita (retail net IVA − store%).

Migrations 0019 (reorder+availability), 0020 (ads). web/src/lib/helpers.ts (pricing+SEO). Product
fetch + InvFull now carry cogs.

STILL NOT BUILT (need external data feeds, noted for the user): in-store/popup pickup analytics
(needs order tags not in our Shopify pull), customer-service triage (needs DM/email feed). Everything
else from the backlog is shipped.

## SESSION 7b — feature testing (and 2 more bugs caught & fixed)

Three test layers, 58 automated checks total, all green:
- tests/flows.mjs — 34 API/integration checks (every flow + variant).
- tests/features.mjs — 15 checks: pricing margins land on target, SEO formula (leather has "Made in
  Italy", Nina doesn't), v_ads_mensile sums match raw to the cent, v_reorder velocity, all 156
  v_sku_availability states verified against the giacenza/Shopify logic.
- web/e2e/ingest.spec.ts — 9 Playwright UI tests (new subtabs, pricing chip, ads card, deal calc, SEO
  generator, supplier-first order form).

Two REAL bugs the UI tests caught and fixed:
- SupplierOrderForm: typing a NEW supplier jumped to step 2 after one character (input wrote straight
  to `forn`). Fixed with a `typed` draft + explicit "Avanti" button.
- Arrivi: the mount fetch resolving called setAdding(false), so opening the order form before orders
  finished loading SNAPPED IT SHUT. Fixed by removing setAdding from load(); onDone closes the form.

## SESSION 7c — "Chiedi ai dati" acceso (Gemini key)

Gemini key configured in app_flags.gemini_api_key (server-only, NOT in repo). gemini-2.0-flash hit the
project's free-tier quota (429) and 1.5-flash is gone, so ask-data now uses **gemini-flash-lite-latest**
(non-thinking, returns SQL directly, has free quota). Added schema hints (categoria enum BAG/PELLE/…,
use v_inventory.*_sold for best-sellers, SUM(giacenza_attuale) for stock totals). All 4 in-app example
chips verified live: "505 borse in magazzino", top sellers, sold-out-but-recently-sold (29), online
revenue per month. ask-data at v3.

## SESSION 8 — architettura as-built, ponte Cowork→app, ricevitore Qromo

- **docs/ARCHITECTURE.md** — doc as-built canonico (stack, tabelle+viste, 4 edge functions, cron,
  5 sezioni frontend, sicurezza, integrazioni con stato reale, app↔foglio e i ponti, cosa manca).
- **integrations/cowork_amimi.py** — helper Python zero-dipendenze: Cowork (o qualunque Python/Node)
  legge l'app via REST (anon) e scrive via write-api (pin x). Testato: legge 168 prodotti. Niente
  auth Google. Conferma: Cowork può parlare con l'app come Code, è solo HTTP.
- **Qromo→app:** write-api v8 con azione `qromo_sale` (idempotente su sale_id) — LIVE e testata.
  **integrations/qromo_forwarder.gs** — funzione Apps Script indipendente (NON tocca SyncImportToDBQromo)
  che legge DB_QROMO per header e inoltra le righe nuove; watermark su Script Properties, app dedup-a.
  PRONTA ma NON deployata: serve clasp push nel progetto Operations + trigger orario (OK di Ale).

## SESSION 8b — Qromo bridge DEPLOYED (clasp)

clasp pull (local==live, no drift) -> added apps-script/QromoForwardToApp.js -> clasp push --force
(21 files, OK). Ran forwardQromoSalesToApp once from the editor: forwarded 9 gap Qromo sales
(24-25 Jun) into the app, 116 skipped (already in seed), 0 errors; verified 9 rows source=
'qromo-forward' in qromo_sales. Bridge PROVEN end-to-end (Apps Script -> write-api qromo_sale -> DB).
Watermark set to 130.

REMAINING (1 manual step): the hourly TRIGGER isn't created yet. clasp run can't (project not API-
executable) and clasp hit invalid_rapt (re-auth) mid-session, and the editor run-dropdown / trigger
dialog (iframe) resisted automation. To finish: in the Apps Script editor, select function
`createQromoForwardTrigger` and Run once (creates the hourly trigger + re-sets the watermark). Until
then the forwarder only runs when invoked manually.

## SESSION 8c — Qromo bridge fully automatic (clasp re-auth + hook)

clasp re-authed (clasp login, invalid_rapt fixed; logged in as info@amimi.it via the connected
Chrome). Instead of a separate trigger (which had a bootstrap chicken-and-egg: the trigger is needed
to run the function that creates the trigger), hooked a guarded forwardQromoSalesToApp() call at the
END of syncImportToDBQromo (which already runs hourly via its own trigger). Pushed live ("Script is
already up to date" on re-push = confirmed). Now every hour: Qromo webhook -> Import -> DB_QROMO
(resolve) -> forwardQromoSalesToApp -> write-api qromo_sale -> app. No new trigger, no manual step.
9 gap sales already backfilled + verified. createQromoForwardTrigger kept for manual/standalone use.

## SESSION 9 — manual-sale form (emulate AppSheet gift) + Cowork task map

- GIFT_OFFLINE is the manual-offline-transaction log, not just free gifts: 63/124 rows have a price +
  real payment methods (CASH/PAYPAL/BONIFICO/REVOLUT). The "Regalo" form only captured the gift
  (inventory) — missing prezzo + payment_method. Fixed: Inserisci ▸ "Regalo / Vendita manuale" with a
  Regalo|Vendita toggle, prezzo + payment method (Contanti/PayPal/Bonifico/Revolut/Altro), kind
  'vendita_manuale'. Tested: price+payment persist. NOTE: v_ce_amimi counts revenue from Shopify+Qromo
  +B2B only, NOT gifts_offline — so manual sales hit inventory but not the P&L (matches the Master's
  CE_AMIMI; including them is a separate decision flagged to the owner).
- docs/COWORK_TASK_MAP.md: all 27 Cowork tasks mapped to app-native / already-in-app / stays-on-Cowork
  (Gmail/Notion/Chrome) / dies-with-cutover / deletable, building on Cowork's own condensation plan.

## SESSION 9b — MCP server (your Claude operates the app)

New edge function `mcp` (supabase/functions/mcp): Model Context Protocol over JSON-RPC/HTTP, so a
Claude can read the business and act. Tools: list_inventory, what_to_reorder, sku_availability,
pnl_summary, ads_summary, ask_data (NL->SQL), propose_expense, register_count. Reads via service-role;
writes delegate to write-api (validation + change_log reused). Bearer-token gated (app_flags.mcp_token,
server-only — NOT in repo). Tested: auth, initialize, tools/list, what_to_reorder/sku_availability/
ask_data all return real data. Connect from Claude Code/Desktop with the token NOW; claude.ai web needs
an OAuth wrapper (TODO). mcp/README.md has the connection steps. 5th edge function; additive, nothing
else touched. Clarified: 24/7 autonomy = Supabase pg_cron (no PC); MCP = interactive control (cloud).

## SESSION 9c — MCP connected to claude.ai web (live)

Made reads open (data already public via anon; writes still token-gated) and added Streamable-HTTP
**SSE** responses (text/event-stream) + GET handler — claude.ai's connector wants SSE, plain JSON gave
"no tools". Added the connector in claude.ai (Personalizza → Connettori → + → custom, URL, no OAuth):
now shows the 6 read tools (list_inventory, what_to_reorder, sku_availability, pnl_summary, ads_summary,
ask_data). Owner's web Claude can now query the business. Writes (propose_expense, register_count) stay
behind the bearer token → only via Code/Desktop, not the web connector. mcp v3.

## SESSION 10 — UX raffinamenti (persona, steppers, toast, reso con foto)

Da feedback utente con screenshot, 5 raffinamenti (commit 7ad16af, gh-pages live): (1) personalizzazione
solo nella Home — PersonaPicker tolto dagli altri tab, azioni Registra non piu filtrate per persona.
(2) tile Arrivo/Acquisto tolto da Registra (vive in Ordini). (3) reso sale-anchored mostra foto prodotto
+ nome cliente (fetchSalesByCodice risolve shopify_orders.customer_name). (4) NumberStepper -/+ visibile su
mobile su ogni campo quantita/prezzo (Reso, Regalo/Vendita, B2B, Conta, Nuovo prodotto, Spesa, Ordine,
Arrivo). (5) toast eleganti (lib/toast.ts) al posto dei box msg inline in tutti i form di scrittura.
npm run build verde (84 moduli).

## SESSION 11 — Coda Prodotti a gruppi (nuovi-da-ordine / impatto ricavi-costi / pulizia)

Da feedback utente: la coda "Da completare" mostrava in cima vecchi prodotti gia venduti, mescolando
lavoro vero e pulizia anagrafica. Verificato sui dati live: i 16 in coda erano TUTTI residui import
etl del 24-06, gia con prezzo+COGS, zero nati da ordini, zero buchi su ricavi/costi -> tutta pulizia.

Ridisegnata la coda in 3 gruppi (migrazione 0025 + Prodotti.tsx): (1) **Nuovi da arricchire** =
prodotti nati da un ordine (source=app-ordine, non verificato) -> in cima; tag "nuovo modello" quando
nessun altro prodotto verificato condivide il modello, e in quel caso la **descrizione diventa
obbligatoria** nell editor. (2) **Impatto su ricavi e costi** = manca retail_price O cogs. (3) **Pulizia
anagrafica (facoltativa)** = solo immagine/descrizione/modello-variante mancanti con prezzo+COGS presenti
-> in fondo, collassata e depotenziata (opacity .62). v_products_todo: stesse righe (WHERE invariato, v_health
intatto), aggiunge in coda source/is_new_model/bucket/bucket_rank; sort client = bucket_rank, poi venduto, poi missing.

Migrazione applicata al DB live (create-or-replace, retro-compatibile: il front-end deployato fa select(*)
e ignora le colonne nuove -> nessun impatto finche non si rideploya). tsc -b + vite build verdi (84 moduli),
render verificato in locale (coda vuota + gruppo pulizia 16 card dim). Front-end NON ancora deployato su
gh-pages: in attesa ok utente.

## SESSION 12 — Micro-fix UX dal report di verifica (29-06): spinner, subtabs, toast, a11y, cleanup

Applicate 5 delle 6 migliorie prioritizzate in REPORT_verifica_stasera_2026-06-29.md (saltata la #5 stepper
nel carrello/editor arrivi: serve una variante compatta dello stepper in righe flex strette, rischio layout
mobile -> rimandata a giro dedicato).

(1) **Spinner nativi nascosti** solo dentro .stepper .num (-moz-appearance:textfield + ::-webkit-*-spin-button
none): elimina i controlli duplicati su desktop senza toccare gli input single-control fuori stepper.
(2) **Overflow .subtabs**: aggiunto overflow-x:auto + scrollbar nascosta + white-space:nowrap sui bottoni;
verificato a 360px overflow di pagina = 0 (lo scroll resta dentro la barra). (3) **Toast su ArrivoRow
(Ordini) e ProdEdit (Prodotti)**: tolti i box .msg.err inline, ora errori+successo via toast (verificato il
toast errore "Modello e variante obbligatori" role=alert). La validazione "descrizione obbligatoria per
modello nuovo" di SESSION 11 e stata preservata e portata anch essa a toast. (4) **a11y toast**: host
aria-live=polite, ogni toast role=alert (err) / status (ok). (6) **Pulizia residui orfani**: rimosso
PurchaseForm.tsx (orfano), tolto purchase dalle liste registra in people.tsx (rischio latente schermata
vuota), rimossa la prop inutilizzata setChi da Ingest/Ordini/Prodotti + chiamate App.tsx, corretto il
commento obsoleto people.tsx:2.

tsc -b + vite build verdi (84 moduli), nessun nuovo warning oxlint. Verifica via dev server locale: toast +
overflow ok. NON deployato su gh-pages: in attesa ok utente (stesso batch del redesign bucket di SESSION 11).

## SESSION 13 — Fix arrivo bloccato + Correggi vendita per-prodotto/per-vendita

Da feedback utente (4 punti). FATTI 2: (#4) il tasto salva dell arrivo (ArrivoRow, Ordini) restava bloccato
sui "3 pallini" sugli arrivi PARZIALI (riga non si smonta, busy mai rimesso a false: bug pre-esistente
ereditato nella migrazione toast SESSION 12). Fix: a salvataggio ok chiudo la riga (setOpen false) e sblocco
busy in finally. (#2) **Correggi vendita** ora ha due ingressi (toggle .seg.wrap "Per prodotto" / "Per
vendita"): per-prodotto = flusso storico (prodotto -> sue vendite -> riassegna); per-vendita = nuova
fetchRecentSales (qromo+shopify, 60+60, con cliente risolto e prodotto attuale), lista cercabile per
cliente/prodotto/#ordine -> scegli la vendita -> riassegna al prodotto giusto. Verificato dal vivo: toggle,
50 vendite, ricerca "elisa" -> 1, click -> step picker "Era Annie Bag". tsc+build verdi.

IN SOSPESO (in attesa decisione utente): (#1) tab Pubblica - il filtro letterale "solo prodotti su ordine
fornitore" oggi SVUOTA la tab (i 25 pronti non sono mai stati ordinati nell app; i veri ordinati sono gia su
Shopify o sono i 14 orfani). Proposta alternativa: nascondere i codici-spazzatura (variante = nome modello,
Difetto/Charm/Personalizzazione) + KPI cliccabili come filtro. (#3) export PDF dell intera piattaforma:
da decidere scope (per-pagina vs unico) e metodo (print-to-PDF browser, zero dipendenze).

## SESSION 14 — Pubblica filtrata a ordini fornitore + KPI filtro + export PDF per pagina

Chiusi gli ultimi 2 dei 4 punti del feedback. (#1) Tab **Pubblica** ora mostra SOLO prodotti verificati,
non su Shopify, **che hanno un ordine fornitore** (gli altri sono seed vecchi/fantasma). Scelta utente:
filtro letterale + empty-state esplicito ("Niente da pubblicare. Tutti i prodotti ordinati sono gia online")
— oggi la tab e vuota by design (i 25 pronti non sono mai stati ordinati nell app), si popolera coi nuovi
ordini. Aggiunti **KPI cliccabili per modello** (.kpichip) che filtrano la lista. (#3) **Export PDF per
pagina**: nuovo componente PrintBtn (window.print, zero dipendenze) accanto all export CSV su Inventario,
Ordini, Prodotti, Cruscotto; stylesheet @media print che nasconde nav/subtabs/seg/bottoni e tiene i dati.
Home/Registra esclusi (form d azione, niente da stampare).

Verificato dal vivo: header con Scarica PDF+Esporta CSV su tutte e 4 le pagine; Pubblica mostra l empty-state.
tsc+build verdi. Con SESSION 11-13 forma un unico batch NON ancora deployato su gh-pages (in attesa ok utente).

## SESSION 15 — Nav a 4 voci (Prodotti dissolto) + vista Disponibilita stile artifact

Ristrutturazione IA su richiesta utente. (#2) Tolto il tab **Prodotti** dalla bottom-nav: ora 4 voci
(Home, Registra, Ordini, Magazzino). I suoi strumenti: "Da completare" -> tile **Pulizia dati** in Registra,
"Pubblica" -> tile **Pubblica su Shopify** in Registra. **Correggi vendita e Diagnostica RIMOSSI dall UI**
(scelta utente "solo i 2, gli altri rimuovili") — il codice resta in git, riattivabili. Prodotti.tsx ora e un
modulo che esporta ProdVerify+Publish (niente piu pagina/subtabs); Ingest li renderizza come azioni; tile
persona in people.tsx ripuntate a registra/pulizia|pubblica, tolta la tile Diagnostica.

(#1) Nuova vista **Disponibilita** (default del tab Magazzino), stile artifact Cowork: 5 KPI (SKU acquistabili,
Varianti acquistabili, Attivi ma esauriti, In stock non pubblicati, Pubblicati ACTIVE), Linee critiche
(esauriti + copertura
## SESSION 15 — Nav a 4 voci (Prodotti dissolto) + vista Disponibilita stile artifact

Ristrutturazione IA su richiesta utente. (#2) Tolto il tab Prodotti dalla bottom-nav: ora 4 voci
(Home, Registra, Ordini, Magazzino). I suoi strumenti: "Da completare" -> tile Pulizia dati in Registra,
"Pubblica" -> tile Pubblica su Shopify in Registra. Correggi vendita e Diagnostica RIMOSSI dall'UI
(scelta utente "solo i 2, gli altri rimuovili") — il codice resta in git, riattivabili. Prodotti.tsx ora e
un modulo che esporta ProdVerify+Publish (niente piu pagina/subtabs); Ingest li renderizza come azioni;
tile persona in people.tsx ripuntate a registra/pulizia|pubblica, tolta la tile Diagnostica.

(#1) Nuova vista Disponibilita (default del tab Magazzino), stile artifact Cowork: 5 KPI (SKU acquistabili,
Varianti acquistabili, Attivi ma esauriti, In stock non pubblicati, Pubblicati ACTIVE), Linee critiche
(esauriti + copertura), tabella Da riordinare adesso (Prodotto, Venduti 60g, Persi/sett = run-rate
settimanale per prezzo sui pubblicati a stock 0). I numeri sono i dati PROPRI dell'app (v_inventory/
v_reorder), diversi dallo snapshot Shopify dell'artifact. "Giorni vuoto" NON incluso: richiede campionamento
storico dello stock che l'app non ha (scelta utente: senza). Verificato dal vivo: nav 4 voci, 2 tile nuove
aprono i componenti giusti, KPI/linee/tabella popolati, zero errori console. tsc+build verdi.

## SESSION 16 — Fix da audit UI/UX (overflow picker, mese dinamico, copy, a11y)

Audit UI/UX completo (report in `audits/AUDIT_UIUX_2026-06-30.md`). Implementati i fix non-di-sicurezza ad alto valore; build + verifica dal vivo su preview locale (zero errori console, innerWidth/overflow misurati).

- **MOBILE (era Bloccante):** ProductPicker `.pgrid` andava in overflow (514px) e faceva zoomare l'intera pagina sui 4 form Conta/Reso/Vendita/B2B (innerWidth 390 -> 528). Fix in `index.css`: `.pgrid` repeat(3, minmax(0,1fr)), `.pcard min-width:0`, `.pname overflow-wrap:anywhere; word-break:break-word`. Verificato: innerWidth torna 390 e pgridOverflow 0 su tutti e 4.
- **DATI (era Alta):** mese/anno hardcoded (`CURRENT_MONTH=6`, `2026`) sostituiti con `nowMonth()`/`nowYear()` in `lib/helpers`; usati in Report.tsx, Home.tsx (label "Netto <mese>"), api.ts (fetchCeTotale/fetchAdsMensile). Non marcisce piu a cambio mese/anno.
- **DATI:** aggiunta colonna MC1% nella tabella CE (prima c'era solo MC2%); gennaio nascosto da grafico/tabella/chip nello scope Amimi (resta nel Totale).
- **COPY:** nomi prodotto puliti via `prettyName()` (underscore->spazio, dedup prefisso modello) in ProductPicker e Inventario (nome); "Vecchi prodotti" -> "Non visti da oltre 90 giorni"; RecentFeed mappa supplier_orders/expenses/returns/qromo_sales/shopify_orders e "qromo-forward"->"Qromo (auto)"; nota Pubblica senza nome variabile `shopify_write_enabled`.
- **IA:** Cruscotto evidenzia "Home" come attiva nella bottom nav quando aperto (non piu stato senza voce attiva); ArrivoRow apre di default la prima riga in arrivo nel dettaglio fornitore (affordance arrivo).
- **A11y/mobile:** touch target alzati (.seg/.chip/.scopetoggle/.subtabs ~40px, .exp 36->40, .drawerx 32->40); testo <11px portato a 11px (.tval/.tmix/.ksub/.tag).
- **CODICE:** cancellato `src/App.css` (scaffold Vite orfano, mai importato), rimossi duplicati CSS (object-fit cover morto prima di contain, .supcard.alt accent duplicato della regola rose).

NON toccata la sicurezza (RLS/segreti/grant anon: vedi report sez. 2; scelta utente "ignoriamo per ora"). Le evidenze e il report in `audits/` NON sono committati (contengono numeri P&L e dati clienti). tsc + vite build verdi.

## SESSION 17 — Design pass da audit (palette AA, icon set, desktop, copy/IA)

Secondo giro dell'audit UI/UX: fix "di design" + rifiniture (mano libera su palette/guideline, scelta utente "usa una palette migliore"). Build + verifica dal vivo su preview.

- **PALETTE (contrasti WCAG AA):** `--accent` camel #C4956A -> cognac **#9C5F33** (era 2.67:1 = FAIL, ora 5.12), `--green` #3E9E5B -> **#2E8049** (4.88), `--red` #c0533b -> **#b8472f** (5.28), `--muted` -> **#6e625f**, nuovo `--rose-deep #6E3F4D`; treemap CATCOL scuriti (PELLE/TESSUTO/ACCESSORI/ALTRO) per label bianche AA; rgba tint aggiornati al nuovo accent/green/red.
- **ICON SET:** nuovo `components/Icon.tsx` (14 glifi line, single-path, currentColor) al posto delle emoji incoerenti in bottom nav, tile Home (rose) e hub Registra (accent). Niente piu blu fuori palette.
- **DESKTOP:** aggiunto `@media (min-width:1024px)` (l'app non aveva breakpoint): #root/bottomnav 920px, hometiles 3 col, kpis 4 col -> meno bianco vuoto, KPI su una riga, niente tile orfana.
- **TABELLE:** `.invtable` thead sticky durante lo scroll + `tabular-nums` sulle colonne numeriche.
- **CRUSCOTTO:** barre trend piu alte (150->172px), tolta la doppia % sotto ogni barra (ridondante con legenda/segmenti); legenda "MC1 = margine dopo i costi variabili · MC2 = utile dopo i costi fissi" sotto i KPI; nota mese resa dinamica ("mese in corso").
- **COPY/IA:** KPI Disponibilita in italiano (ACTIVE -> "pubblicati su Shopify"), header riordino chiari ("Venduti (60gg)", "€ persi/sett."), nota giacenze negative in Magazzino, chip persona attiva nell'header Registra, descrizioni tile Registra piu chiare; rimosso il campo dead-code `registra` da people.tsx (F3).

Verificato: 4 picker innerWidth 390/overflow 0, MC1% presente, Gen nascosto in Amimi, nomi senza underscore, zero errori console. tsc + vite build verdi. NON toccata la sicurezza (scelta utente).

## SESSION 16 — Browser dati grezzi (tabelle) + deep-link "Vedi tutti" dai flussi

Su richiesta utente (riferimento: come le tabelle di AppSheet). Nuova pagina Tables.tsx (config-driven,
sola lettura): 10 tabelle business (Ordini fornitore, Arrivi/Acquisti, Prodotti, Vendite negozio,
Vendite online, Conto vendita B2B, Resi, Regali, Spese, Conte) — mai app_flags/app_config (segreti) ne
change_log/health_log. Ogni tabella: ricerca testuale, paginazione (+100), scroll orizzontale, export CSV.
Raggiunta da due punti: tile "Tabelle" in Registra, e un bottone "Vedi tutti i … →" a fine di ogni flusso
(regalo->regali, reso->resi, b2b, conta->conte, nuovo prodotto->prodotti, spesa->spese) che apre dritto
quella tabella. Aggiunta icona "table" a Icon.tsx. Verificato dal vivo: tutte 10 le tabelle leggono via
anon (44/100/100/100/100/17/2/100/100/2 righe), zero errori, deep-link dal flusso regalo ok. tsc+build verdi.
Nota: la lista mostra i nomi cliente (default "mostra"); mascherabili su richiesta. Si appoggia all'accesso
anon gia ampio (vedi nota sicurezza anon key, non aggiunge esposizione ma la rende piu visibile).

## SESSION 18 — CE legge i resi Qromo + test reso/conta dal vivo

Test end-to-end dal browser (conta rialzo/ribasso, reso qromo, reso shopify) su Nina_Bag_STRIPES_PETROL_BLUE, verificato in DB.

- **Scoperte:** (1) le **conte NON cambiano la giacenza** — `v_inventory` non referenzia la tabella `counts` e non c'e' nessun trigger: una conta scrive solo una riga "da verificare". (2) I **resi dell'app NON toccavano il CE**: `v_ce_amimi.resi = -shopify_orders.refund_amount`; la tabella `returns` alimentava solo lo stock (`v_inventory`) e `v_resi_mensile`.
- **FIX (migration 0026_ce_resi_qromo):** `v_ce_amimi.resi = -(shopify refund + returns canale='qromo')`. Esclusi i resi `canale='online'` per non duplicare i refund Shopify gia' nel CE. Verificato: giugno resi -220 -> **-265** (220 shopify + 45 qromo di test), MC1/MC2 -45. **Nota IVA:** importo gross come il refund Shopify (eventuale /1.22 in follow-up). **Nota COGS:** il reso non ri-aggiunge il COGS (coerente col leg Shopify esistente).
- **Aperto:** la conta-come-rettifica della giacenza (richiesta "gravissima"): inviate 2 proposte, non ancora implementata.
- **Dati di test lasciati nel DB (da riallineare dal Master):** Nina_Bag_STRIPES_PETROL_BLUE giac 24->26, 2 righe `counts` (inerti), 2 righe `returns` (qromo 45 + online 50).

## SESSION 17 — Sicurezza: chiusura falla anon (write/segreti)

Prerequisito per qualsiasi scrittura dal browser pubblico. Audit live: RLS off ovunque, anon poteva LEGGERE
i segreti (app_flags: gemini key, webhook secret, mcp token, shopify_write_enabled) e SCRIVERE/CANCELLARE su
app_flags, ce_totale_monthly, returns, shopify_catalog, shopify_stock, stock_adjustments, health_log.
Migrazione 0026: revoke ALL su app_flags/app_config da anon+authenticated; revoke INSERT/UPDATE/DELETE su
tutte le tabelle public da anon+authenticated; default privileges per le tabelle future. SELECT preservato
(app no-login legge i dati, incl. change_log per il feed). Verificato che (a) il frontend non scrive mai via
anon e non legge i segreti, (b) tutte e 6 le edge function usano SERVICE_ROLE_KEY (bypassa i grant, scritture
intatte). Esito verificato: tables_anon_can_write=0, anon_read_secrets=false, letture business true,
service_role scrive ancora. Smoke test live: Disponibilita, RecentFeed (change_log) e browser tabelle
leggono regolarmente. Resta per scelta la lettura ampia dei dati business via anon (app senza login).
Il browser tabelle resta SOLA LETTURA; l'edit selettivo (via write-api+change_log) e un possibile passo dopo.

## SESSION 19 — Conta = rettifica della giacenza (Approccio 1, adjustment ledger)

Problema emerso in sess.18: le conte non cambiavano lo stock. Risolto con un registro di rettifiche.

- **Migration 0027_stock_adjustments:** tabella `stock_adjustments` (codice, codice_norm gen, qty_delta, motivo, count_id, data Europe/Rome, chi); `v_inventory` ora somma `+ COALESCE(adj.q,0)` in giacenza_attuale / giacenza_totale_conb2b / disponibili_da_vendere / valore, + nuova colonna `aggiustamenti`.
- **write-api azione `count` dedicata** (tolta dal generic insert): ricalcola il delta SERVER-SIDE contro la giacenza viva (che include le rettifiche precedenti), scrive `counts` (stato applicata/combacia) + `stock_adjustments`(delta); le riconte convergono (non accumulano); abort su errore di lettura giacenza (fix dalla review). Deploy edge fn **v10** (verify_jwt off, custom PIN).
- **CountForm:** guard `window.confirm` su |delta|>=5, nota "La giacenza verrà corretta da X a Y", toast aggiornato, refresh giacenze dopo il salvataggio, payload non manda più giac_snapshot/delta/stato (il server li ricalcola). Label "Applica conta".
- **Review adversariale (workflow 3 lenti + verify):** 2 finding confermati — medium (errore di lettura droppato → FIXATO prima del deploy), low (race concorrenza stessa SKU → documentata, self-healing alla riconta).
- **TEST DAL VIVO** (Nina_Bag_STRIPES_PETROL_BLUE): conta 24 su 26 -> giac **24** (adj -2, conta applicata); ri-conta 25 -> giac **25** (adj +1, NON 26 -> niente stacking, converge). Verificato in DB.
- **Aperto / non fatto:** backfill conte storiche (opzionale, non richiesto); Approccio 2 verified-anchor (evoluzione); realign Shopify su apply (gated `shopify_write_enabled` off). Dati di test nel DB da riallineare dal Master: Nina giac 25.

## SESSION 18 — Clarity-first: ritorno alle emoji + pass di chiarezza

Su richiesta utente (cambio di rotta: chiarezza > estetica; preferiva le emoji di prima). Separati i due
assi del design pass: le ICONE (emoji->line) erano coerenza estetica (audit "Bassa") -> riviste; la PALETTE
scurita era contrasto AA (chiarezza) -> TENUTA invariata. (A) Icon.tsx ora mappa nome->emoji (full-color,
riconoscibili); i call-site restano invariati. Doppioni risolti con glifi distinti: Ordini 📦 vs Arrivi 📥,
Vendite negozio 🏬 vs Vendite online 🌐, B2B 🤝 (era 'store'). (C) PrintBtn/ExportBtn ora hanno label
visibile (PDF/CSV), non piu solo-icona. (E) testo minuscolo alzato (misschip 9.5->11, newtag 9->10, caption
KPI 11->12 scurita) e valore-trend da muted->dark. (D) opacita di stato sopra soglia leggibile (trend off
.3->.55, righe dim .42->.6, arrivi done .5->.62). Le emoji rimaste in Inventory/Report (🏬/🌐/🔄/🧮/💬/🛒)
erano gia sensate -> coerenti col nuovo linguaggio, lasciate. tsc+build verdi; verifica a 360px: emoji
ovunque, doppioni risolti, PDF/CSV presenti, overflow 0, zero errori console. NOTA: deploy gh-pages NON fatto
in questa run perche il working tree condiviso aveva lavoro non committato dell'altra chat (CountForm/api/
Inventory); il deploy va fatto quando quella sessione ha committato, per non pubblicarne il lavoro a meta.

## SESSION 20 — Test frontend conta + fix display giacenza viva + fix sub-tab Magazzino

Test frontend (Playwright, viewport mobile) della conta-rettifica + verifica generale "al meglio".

- **Verificato dal vivo:** form conta pulito (nome prodotto leggibile, "Il sistema dice X pz", stepper senza spinner nativi, badge Delta, nota "verrà corretta da X a Y"); toast "✓ Giacenza corretta · … ora = X (-1)"; **dialog di conferma** su |delta|>=5 ("Stai per correggere … da X a Y … Confermi?") con dismiss=nessuna modifica / accept=applica; conta negativa **rifiutata** dal server ("pezzi contati non validi"); **0 errori console**.
- **FIX display (CountForm):** ora legge la giacenza VIVA del prodotto selezionato (`fetchGiacenzaOne`) invece della mappa caricata al mount, così una riconta immediata mostra il valore aggiornato (prima mostrava lo stale: il server calcolava giusto, ma il numero a schermo era vecchio). Stato "…" mentre carica + bottone disabilitato finché non è pronto. Verificato: dopo conta 32→31, la riconta legge 31 (non 32).
- **FIX layout (trovato nel test):** nell'header Inventario i 6 sub-tab (`.seg.wrap`) si impilavano in verticale sovrapponendosi al titolo e ai bottoni su mobile (header alto 240px). Aggiunta classe `.invhead`: titolo + PDF/CSV su riga 1, sub-tab full-width che scorrono in orizzontale su riga 2 (header 87px). Verificato.
- **NON toccato (scelta utente):** icone nav/tile tornate a emoji = decisione intenzionale dell'utente (commit `64d1c94`, "clarity over coherence"); sicurezza chiusa dall'utente (commit `08347bf`, revoca write/secret anon).
- **Dati di test nel DB:** Nina_Bag_STRIPES_PETROL_BLUE giac 39 (13 di aggiustamenti-conta accumulati nei test), da riallineare dal Master.

## SESSION 21 — Test frontend di TUTTI i flussi + fix riga arrivo

Giro completo end-to-end (Playwright, viewport mobile) di ogni user flow, ognuno verificato sul DB. Prodotto di test principale: Lea_Bag_COCCO_PURPLE.

- **Scritture verificate (form → submit → effetto DB):** Regalo (gifts_offline, −1 giac); Vendita manuale (gift kind vendita_manuale, −1 giac, **fuori dal CE per scelta**); Movimento B2B venduto (b2b_movements, incasso_amimi 60 = retail×(1−%), CE b2b +49.18); Arrivo fornitore (purchases +5, order arrived, giac +5); Nuovo ordine fornitore (supplier_orders); Spesa manuale (expenses approved, costo negativo); Approva spesa (pending→approved via ✓); Nuovo prodotto (products); Verifica prodotto (product_verify). Tutti OK, **0 errori console**.
- **Gated:** Pubblica su Shopify mostra il warning "Pubblicazione live disattivata", nessun path di scrittura. OK.
- **Viste di lettura (render + 0 errori):** Home, Cruscotto (KPI/trend/Chiedi ai dati/Calcolatore), Inventario (Disponibilità/Magazzino/Riordino/Nei negozi/Shopify/Valore + drawer prodotto con storico acquisti/vendite), Tabelle. Tutte OK.
- **FIX (trovato nel test):** riga arrivo (`ArrivoRow`) — `.linerow` era `display:flex` in riga, così l'editor inline (qta + data + **salva**) finiva **fuori dallo schermo a destra** su mobile (salva quasi intoccabile). Fix: `.linerow` a `flex-direction:column`, `.arrinline` a `display:block` (era duplicato flex vs block). Ora l'editor sta su una riga sotto e ci sta tutto. Deployato + verificato.
- **Findings (non bug, da sapere):** (1) **"Correggi vendita" (`sale_correct`) e `OrderForm.tsx` sono codice morto** — le funzioni API esistono ma NESSUNA UI le usa, quindi non raggiungibili dal frontend. (2) La vendita manuale (gift) scala lo stock ma non entra nel P&L (scelta documentata nel form).
- **Dati di test lasciati (Master realign):** Lea_Bag_COCCO_PURPLE giac 7; Annie_Bag_PAILLETTES_NUDE +5; righe gift/b2b/spese/conte/return dei test. **Puliti io:** prodotto Lea_Bag_QATESTZZZ e ordine di test rimossi; nome di Lea_Bag_VERNICE_VIOLA ripristinato (il verifica-test l'aveva rinominato "QA Model/QA VAR").

## SESSION 22 — Badge Benedetta = solo lavoro reale

Il badge "todo" sulla tile Pulizia dati (Home) contava TUTTE le righe di `v_products_todo`, incluse le 15 del bucket `pulizia` (facoltativo). Fix: conta solo i bucket azionabili (`nuovo` + `costo_ricavo`), esclude `pulizia`. Al momento tutte e 15 sono `pulizia` → badge = 0 (nascosto), corretto. Home.tsx: select codice,bucket + filter bucket!='pulizia'.

## SESSION 23 — Re-seed dal Master + CE Totale nativo (v_ce_totale) + fix B2B annullato

- **RE-SEED** dall'export Master 2026-07-01: ricaricate tutte le tabelle transazionali via edge function temporanea `etl-load` (service role, **anon MAI riaperto**; poi disabilitata a stub 410). Puliti i dati di test (returns, stock_adjustments). Conteggi: products 170, shopify 433 ord/461 righe, qromo 145, gifts 126, b2b 17, expenses 237, purchases 231, meta 128.
- **v_ce_amimi — FIX B2B (migration 0028):** esclusi i movimenti `venduto` con `stato=annullato` (giu 492 -> **220** = Master). Feb/Mar esatti al centesimo; apr/mag entro **~1%** (edge case online Shopify: sconti/free-shipping/refund ri-derivati vs colonne pre-calcolate del Master — scelta utente: calcolo indipendente); giu live.
- **v_ce_totale NATIVO** (non più la copia statica `ce_totale_monthly`): online (Shopify) + offline (Qromo + GIFT_OFFLINE) + b2b (non-annullato) + **tutte** le spese (non filtrate amimi) + `ce_totale_manual` (blocco non-Amimì gen/feb, hardcoded anche nel Master, non calcolabile). Reso: **gen/feb/mar esatti**, apr/mag ~1%, giu live.
- **Master quirk riprodotto:** la logistica variabile del CE_TOTALE nel Master ha una SUMIFS col filtro sottocategoria = una cella numerica (A40=-207) → no-op → 0. `v_ce_totale` la tratta manual-only. (L'Amimì mantiene la sua logistica, corretta.)
- **FRONTEND:** `fetchCeTotale` legge ora `v_ce_totale` (toggle Totale del Cruscotto), incluso `b2b_netto`.

## SESSION 23 — Blocker #2 & #3: feed ordini + scrittura Shopify validati

- **#2 (feed ordini):** `shopify-sync` tira gli ordini DIRETTAMENTE da Shopify Admin API, idempotente (rilancio: 0 inseriti), current. Autorevole e indipendente dall'Apps Script → ritirarlo è una decisione di cutover, non una capacità mancante.
- **#3 (scrittura stock):** il token in `app_config` era read-only → il realign moriva su `locations.json` (manca `read_locations`). Fix in 3 passi: (a) l'owner ha messo in `app_config.shopify_token` l'`ADMIN_TOKEN` write del variant-sync (via SQL); (b) `shopify-stock` **non legge piu' le location** — usa `app_flags.shopify_location_id` con default `107986518343` ("Punto di ritiro"), come fa il variant-sync; (c) `shopify_write_enabled=true`. **Validato dal vivo:** realign `Nina_Bag_Maxi_STRIPES_REED` -> Shopify available 27->26 confermato via Shopify API.
- **Aperto per rimpiazzare DEL TUTTO il variant-sync:** (a) doppia variante SC/CC (l'app setta 1 inventory_item per codice; i bag con "Senza Catena"/"Con Catena" ne hanno 2); (b) trigger automatico (oggi il realign e' manuale). Finche' non estesi: NON far girare app + variant-sync sugli stessi bag.
- **SICUREZZA:** l'`ADMIN_TOKEN` Shopify e' transitato in chat il 2026-07-01 -> va RUOTATO (ed e' condiviso app + variant-sync).

## SESSION 24 — Realign Shopify: doppia variante SC/CC

- **Migration 0029:** `shopify_stock.inventory_item_ids text[]`.
- **sync:** ora raggruppa TUTTI gli inventory-item per codice (i bag SC/CC "Senza/Con Catena" condividono un codice via alias del titolo) → **50 codici dual-variant** tracciati.
- **realign:** spinge il target su OGNI inventory-item del codice, non piu' solo il primo.
- **Validato live:** Agata Floral Dusty → entrambe le varianti (SC + CC) da 1 a 2 su Shopify. `shopify-stock` v4.
- **Trigger automatico — NON ancora fatto (prerequisiti):** l'auto-push va acceso solo DOPO (1) la pulizia delle 34 giacenze negative (altrimenti le azzera su Shopify nascondendo prodotti vendibili) e (2) il ritiro del variant-sync (altrimenti due sistemi scrivono lo stesso stock in conflitto). Design pronto: azione `realign_all` (solo i codici driftati) gated da un nuovo flag `shopify_autopush_enabled` + cron orario.

## SESSION 25 — Pulizia giacenze negative + doc Trigger Migrazione

- **Doc `TRIGGER_MIGRAZIONE.md`** creato: runbook go-live (0 gia' pronto, blocker con stato, 4 fasi ordinate, pulizia, decisioni, punto di non ritorno + rollback, segreti da ruotare, checklist).
- **Pulizia negative:** 35 codici negativi. Incrocio col Master ACQUISTI: **solo 2** hanno l'acquisto nel Foglio (`Lea_Bag_ZEBRA` 10, `Annie_Bag_PAILLETTES_PINK` 12 = i Cat C sovra-venduti). Gli altri **33 sono buchi veri/mis-coding** (venduti/regalati ma mai acquistati nemmeno nel Foglio) → riconciliati a **0** con `stock_adjustments` `motivo='pulizia-pre-cutover'`. **CE-neutro** (il COGS del CE e' snapshottato per vendita, non deriva da `purchases`) e **reversibile** (cancella le 33 righe). Restano **2 Cat C** da rivedere con owner (riordino non registrato o vendita mal-attribuita — es. ZEBRA = gotcha `Maria_Bag_Red`). Ghost (item nullo/variante=modello) idealmente da ri-mappare con `sale_correct` per l'attribuzione (cosmetico per lo stock).

## SESSION 25b — Giacenze negative = 0

I 2 Cat C rimasti risolti: `Lea_Bag_ZEBRA` (-7) e `Annie_Bag_PAILLETTES_PINK` (-1) → conta fisica **0** confermata dall'owner → rettifica a 0 (`stock_adjustments`, source `conta`). **Negative totali ora 0** (35 rettifiche-pulizia in tutto). Blocker #6 (negative) chiuso; restano i 14 codici-ordine orfani (cosmetici).

## SESSION 26 — Orfani ordini → coda Benedetta + backup DB schedulato

- **Codici-ordine orfani (blocker #6, chiuso):** 13 codici in `supplier_orders` senza prodotto corrispondente. Verificato che vivevano **solo negli ordini** (0 righe in purchases/qromo/shopify/gifts) → **0 impatto su stock/CE**, pura completezza catalogo. Fix in una transazione:
  - **4 doppio-prefisso Agata** (`Agata_Bag_AGATA_BAG_EMBROIDERY_WHITE`, `…_FLORAL_BORDEAUX_EMBROIDERY`, `…_ROSE_BUTTER`, `…_ROSE_PINK`) → ordine **ripuntato al prodotto canonico esistente** (niente doppione).
  - **9 stub `verificato=false, source='app-ordine'`** creati (5 Porta carte COCCO_*, `Agata_Bag_ORGANZA_LILLA`, `Agata_Bag_ROSE_BUTTER_LILLA`, `Annie_Bag_SETA_VERDE`, `Lea_Bag_x_Rita_VERNICE_NERA_PIERCING_A`), con i 4 codici malformati ripuntati ai codici puliti → compaiono in cima a "Nuovi da arricchire" di Benedetta (bucket `nuovo`, 3 campi mancanti: img/prezzo/descrizione). **Orfani residui = 0.** Audit in `change_log` (op `orphan_cleanup`). Nota: colonne generate `codice_norm`/`is_finalized` NON scrivibili nell'insert.
  - **Dinamica confermata:** il flusso ordine→verifica esiste già (Ginevra `order_multi` auto-crea lo stub → Benedetta lo blessa in Verifica). Gli orfani erano righe importate dall'ETL del Foglio Ordini **senza** stub; ora sanate.
- **Backup DB giornaliero (blocker #7, parziale):** `scripts/db-backup.mjs` (chiave pubblica read-only, 21 tabelle → JSON) committato via `gh` (`19733d0`). Il workflow `.github/workflows/db-backup.yml` **non era pushabile** da CLI (OAuth senza scope `workflow`) → creato **via UI GitHub dal browser** (commit `5b35b75`; primo tentativo bloccato da "You can't perform that action at this time", andato al retry). Registrato in Actions come `db-backup` [active], cron `17 3 * * *` + `workflow_dispatch`. **Run manuale verificata: 14s, artifact `amimi-db-backup-*` 150KB compressi, retention 90gg.** Resta il restore-test (+ pg_dump se serve lo schema).

## SESSION 27 — Blocker #9: dashboard ripuntate (Operations con switch, mappa completa)

- **Mappa multi-agente dei 4 consumer** (5 reader paralleli su repo/clasp/gestione/viste): esiti chiave — Finance NON legge il Foglio (simulatore Q2 hardcoded, scaduto 30-06 → no-op di migrazione); Operations legge un solo snapshot JSON prodotto da una GH Action 2x/h via dashdata; GA4/GoogleAds risultano 0 righe/inutilizzati nel feed live (il "blocker analytics" non blocca).
- **Operations Dashboard → doppia sorgente con interruttore.** Nuovo `scripts/build-feed.mjs` nel repo `amimi-dashboard` (commit `ae1a477`): `DATA_SOURCE=sheet` (default) = passthrough dashdata identico a prima; `DATA_SOURCE=supabase` = stesso shape dalle viste (`v_ce_amimi_summary`, `v_ce_totale`, `v_inventory` con venduto=shopify+qromo+gift calibrato sui campioni, `shopify_orders/line_items`, `purchases`, `expenses`, `gifts_offline`; ads passthrough da dashdata con fallback `meta_ads_daily`). Workflow YAML aggiornato **via UI GitHub** (scope workflow, commit `7fbb60e6`), run dispatch verificata verde in 42s (sheet mode). **Flip al cutover** = repo var `DATA_SOURCE=supabase`.
- **Riconciliazione numerica** supabase-mode vs feed live: CE Amimì gen–mar ESATTO, expensesByCategory identiche al centesimo, discountUsage identico (240/198), apr ~1% (parity accettata), mag/giu = Supabase piu' FRESCO del Foglio (172 vs 168 ordini giu). Fix durante il lavoro: `fatturatoLordo = omni_netto*1.22` (identita' IVA, regge i mesi manual-only del Totale), `shopifyVendite` = Σ prezzo×qta da line_items, gift = CE-diff (lordo/netto) + pezzi reali da gifts_offline.
- **BUG STORICO TROVATO nel feed sheet:** `extractCEData_` (DashboardBackend.js:392) fa `Math.abs()` anche su margine2 → il CE_TOTALE di feb (mese in perdita, mc2 = −267.33, verificato nella vista riconciliata al Master) appariva come +267.33. La modalita' supabase mostra il segno vero.
- **Migr 0030 + shopify-sync v3:** colonne `fulfilled_at` + `discount_codes` su `shopify_orders`, popolate per i nuovi ordini + backfill one-off (`action=backfill_meta`, 267/273 aggiornati — l'API senza `read_all_orders` vede solo ~60gg; lo storico resta dal seed ETL). Alimentano FULFILL (tempi evasione, ora 255 ordini misurati vs 38 del Foglio) e DISC_CODES.
- **Decisione inventario-web + gestione.html: porting al cutover, NON mezzo-repoint ora** (pre-cutover il Foglio e' piu' fresco; gestione SCRIVE sul Foglio → ripuntare solo le letture = incoerenza scrivi-e-non-vedi). Gap censiti nel runbook §Fase 3.1b: sku_history, shop_status per codice, anagrafica negozi, checkbox tracker, port scritture B2B su write-api.
- Gotcha ripetuto: push su `amimi-dashboard` rifiutato con account gh attivo DanGEEIQ → `gh auth switch --user NoobHandbag`, push, switch back.

## SESSION 28 — Riferimento congelato + riallineamento + parity CE finale (pre-migrazione)

- **Riferimento eterno:** export fresco del Master scaricato dal Chrome dell'owner → `audit/Amimi_Master_2026_V2_REFERENCE_PRE-CUTOVER_2026-07-03.xlsx` (40 tab, 1.36MB, in git).
- **Riallineamento:** expenses 237→278 (l'owner aveva aggiornato le spese), gifts 126→130, meta_ads 128→130, purchases +2 (`ARR_*_20260708`, riordino Lea COCCO). Veicolo: `etl-load` ridispiegata come loader PIN-gated (replace per `source='etl'` → preserva le righe app-native) e SUBITO ritirata a stub 410. Gotcha: `purchases.online` è INTEGER, non boolean. Qromo già pari via forwarder orario (150=150), B2B pari.
- **Parity CE (script `scripts/ce_parity.py`):** fissi ESATTI, offline ESATTO, COGS/variabili esatti, MC al centesimo su gen-mar Amimì. **Scoperta chiave: i delta residui sono errori del MASTER, non dell'app** — il CE del Foglio non vede le righe recenti dei suoi stessi tab (SUMIFS/range): -32,99 marketing mar (le 3 righe expenses aggiunte il 02-07), -17,23 apr, 4 ordini giu (DB Shopify del Foglio ne ha 172 = app, il CE ne conta 168), 5 pezzi gift giu (+COGS 135). Confermato anche che il segno MC2 Totale (negativo gen-apr) combacia app↔Master: era la vecchia dashboard a positivizzarlo (abs).
- Restano come "diversi per scelta documentata": apr/mag ±1% online (refund timing, CE_PARITY.md) e lo split di canale gen/feb del Totale (blocco manuale = solo netto aggregato; bottom line esatta, gen ±0,40 rounding seed).

## SESSION 29 — GO_LIVE_WORKPLAN eseguito: pulizia test, note, safety, tool spese, stock autopush, qromo validato

Il "mega prompt" approvato dall'owner e' `docs/GO_LIVE_WORKPLAN.md` (stati aggiornati li'). Sintesi:
- **STAGE 0:** 17 movimenti B2B + negozio QA = TUTTI test (ZZ_*, TEST_NEGOZIO_QA, note "TEST B2B"/"matrix") → eliminati con audit 18 righe in change_log; CE giugno ripulito (~-180 netto). Sweep pattern test su TUTTE le altre tabelle: pulito. Divergenza voluta dal Master congelato (che i test li tiene).
- **STAGE 1 (note):** migr 0031 `purchases.note` + backfill 39 note dal Master ACQUISTI ("1 ha difetto", rettifiche, ricodifiche); 3 note DB_QROMO backfillate. expenses/gifts gia' complete; DB Shopify Notes = 0 usate.
- **STAGE 2 (safety 1+2):** migr 0032 `ce_snapshots` + `v_ce_drift` + `v_expenses_review` + edge `ce-guard` (cron 06:30): invarianti MC, vendite unresolved, COGS mancanti, giacenze negative, categorie invalide, drift mesi chiusi, **riconciliazione esterna Shopify API** (count ordini: gia' verde su 2 mesi). Gen–giu CHIUSI (12 snapshot). TESTATA: drift sintetico +100 su marzo → BECCATO → ripristinato. La guardia ha trovato subito roba VERA: giacenza negativa nuova (gift 30-06 su `Lea_Bag_Green` senza carico → rettifica), 5 vendite Qromo luglio senza COGS (forwarder non lo manda → fallback snapshot in write-api v11 + backfill), `Annie_Bag_Tiffany` venduta ma assente da products (stub creato → coda Benedetta, rettifica +1).
- **STAGE 3 (tool spese):** migr 0033 (EVENTI categoria valida — il CE la somma gia'). `v_expenses_review` = pending + note ~* 'da verificare' (24 righe reali: 19 di giugno dal run Cowork di ieri + 5 storiche). `SpeseManage` riscritta: card con tutte le info, dropdown 8 categorie, sottocategoria, toggle Amimi', nota trasformata DA VERIFICARE→VERIFICATO **senza perdere lo storico**, `· ricodificata X→Y da <chi>` in append. Deploy gh-pages. **TEST FRONTEND live via Chrome**: ricodifica 21,31€ OPEX→EVENTI (nota preservata) + conferma ENI; coda 24→22; CE giugno EVENTI=21,31 live.
- **STAGE 4 (stock autopush):** migr 0034 (`shopify_autopush_enabled`, `shopify_expose_buffer=2`, `v_stock_drift`, cron :27) + `shopify-stock` v6 `realign_all` con policy V2 replicata (buffer −2; rialzo SOLO con conta fresca ≤30gg; ribassi sempre; **SKU non mappati MAI toccati** — il dry-run ha beccato il bug `?? 0` che li avrebbe azzerati, ~90 skippati e listati). Pulite 2 righe stale AGATA-SC/CC pre-fix. **Trigger `reconcileApply` del variant-sync ELIMINATO via browser** (restano dailyAnomalyReportV2 e buildMapV2, non scrivono su Shopify). Primo run live: 20 push, 2 hold; verificato con ri-pull da Shopify (Nina PETROL_BLUE 19→24 con conta fresca, Maria RED_PIERCING 4→0). Monitor: `v_stock_drift` (217 ok) + health_log `stock_autopush` + change_log per run.
- **STAGE 5 (qromo):** `qromo-webhook` validata end-to-end 6/6 (auth errata 401, not_paid, paid_missing, vendita risolta con COGS snapshot 14.58, dedup su sale_id, prodotto ignoto → unresolved flaggato). Righe test rimosse con audit. **Lo switch console Qromo resta il punto di non ritorno, da fare insieme** (sequenza atomica nel workplan: forwarder OFF → webhook → smoke → rollback plan).
- Residui aperti: 2 warn della guardia by-design (COGS Tiffany finche' Benedetta non compila; 22 spese in coda), ~90 SKU Shopify non mappati (accessori/linee nuove: da censire a catalogo col tempo), rotazione segreti, ingest Meta/spese mensili, port gestione.html.

## SESSION 30 — 7 miglioramenti UX su richiesta owner (tutti testati con Playwright mobile)

1. **Disponibilita': KPI cliccabili** — i 5 KPI ora filtrano: tocchi "SKU acquistabili" e vedi la lista esatta. Sottotitoli chiariti (SKU = su Shopify E in stock, comprabili online ora; Varianti in stock = tutte, anche non pubblicate).
2. **Magazzino mobile ROTTO -> fixato**: la tabella a 5 colonne collassava (solo PRODOTTO visibile, numeri fluttuanti). Ora lista a card + chip di ordinamento. Secondo bug trovato dal probe: `.tdimg img` senza vincoli fuori tabella -> immagini Shopify a 4000px = overflow orizzontale; risolto usando Tile. Verifica: bodyScroll 390=viewport.
3. **Swipe-back Android**: nuovo `lib/backnav.ts` (History API: pushBack/popBack + popstate). Cablato su: cambio tab (App.go), Registra->sezione, editor Pulizia dati, drawer prodotto Inventario. Lo swipe dal bordo ora naviga INDIETRO nell'app invece di uscire al telefono. Testato: history cresce al cambio tab, back torna alla vista precedente.
4. **Ordini**: "📦 ➕ Nuovo ordine fornitore" (era un anonimo "+ Nuovo ordine...").
5. **Ultimi inserimenti ricchi + click-through**: fetchRecent ora porta op/row_id/after; sintesi per-tipo (conta: "contati X era Y", chiusura mese, stock autopush "N push, M hold", spese con importo+categoria, pulizia test...) e riga espandibile con dettaglio completo (quando/chi/cosa + campi del payload). 25 righe.
6. **Pulizia dati: chip DESCR solo per modelli NUOVI** (la descrizione vive a livello di modello; sulle varianti di item esistenti era rumore). Verificato: Agata ROSE BUTTER LILLA senza DESCR, Porta carte con DESCR.
7. **ROAS a 0 -> fixato**: il realign del 03-07 mappava `purchase_value`/`cpa` ma l'export usa `purchase_value_eur`/`cpa_eur` -> 130 righe a NULL. Update mirato per (date,campaign_id): ora apr 12.45x, mag 4.67x, giu 7.36x. GOTCHA per i prossimi seed: META_ADS_DAILY usa suffisso `_eur` su spend/purchase_value/cpa.
- Test: Playwright iPhone 13 su build locale (stessa build deployata): backnav ✓, feed detail ✓ (visibile anche il run autopush 00:27: 128 ok/2 hold — cron vivo), chip DESCR ✓/✗ corretti, KPI filter ✓, bottone ordini ✓, overflow 390=390 ✓. Deploy gh-pages pubblicato (CDN Pages in coda al momento del test: hard-refresh dopo qualche minuto).

## SESSION 31 — INCIDENTE stock Shopify: la policy autopush nascondeva stock vendibile (feedback Benedetta, risolto)

- **Segnalazione (Benedetta, 03-07):** prodotti esauriti online pur avendo stock — Annie Stripes Pink (gest 2, online 0; "ieri era online, nessuno l'ha comprato"), Lea Cocco Black (gest 20, online 0).
- **Causa:** l'autopush STAGE 4 (v6) replicava la policy conservativa del variant-sync: espone `disponibili − 2` (buffer) e **non alza mai** senza conta fresca. Con i dati ORA puliti quelle regole NASCONDEVANO vendibile: ogni prodotto con 1-2 pz → 0 online; ogni rifornito senza conta → resta 0. **Portata: 16 esauriti-online-con-stock + 75 sotto-esposti.** Il buffer/no-raise aveva senso col vecchio magazzino inaffidabile, non ora.
- **Azione:** (1) autopush messo in PAUSA subito (stop emorragia, audit change_log). (2) `shopify-stock` v7: policy "SPECCHIO DEL REALE" — `target = disponibili − buffer` (buffer ora **0**) in su e in giù; il hold "non alzare senza conta" è ora OPT-IN via `app_flags.shopify_hold_raises` (default **false**). Flag: `shopify_expose_buffer=0`, `shopify_hold_raises=false`. Scelta owner: "se ce l'ho, si vende". (3) realign_all live (4 passate per il rate-limit Shopify a batch, idempotente) → convergiuto **ok=130, 0 push, 0 hold**. Autopush riabilitato (buffer 0) come policy corrente.
- **Verifica:** Annie Stripes Pink 0→2, Lea Cocco Black 0→**20**; esauriti-con-stock **16→0**, sotto-esposti **75→0**.
- **CAVEAT SC/CC da rifinire:** ~50 codici hanno 2 inventory_item (bag SC/CC "Senza/Con Catena", stock fisico condiviso). Con buffer 0 l'autopush setta `disp` su ENTRAMBE le varianti → Shopify espone `2×disp` per quei bag (rischio oversell di piccola entità: richiede l'acquisto separato della versione SC e CC dello stesso bag a basso stock prima del rifornimento). Il vecchio variant-sync lo mascherava col buffer. Da rifinire: buffer dedicato ai soli codici dual, o inventory-sharing Shopify. Per ora accettato (negozio a basso volume, meglio esporre che nascondere — scelta owner).
- **Domanda Benedetta sulla conta:** "Applica conta" (Registra ▸ Conta fisica) rettifica la giacenza gestionale al numero contato (stock_adjustment); poi l'autopush orario lo rispecchia su Shopify. NON serve contare tutto (il fix buffer-0 ha gia' ripristinato); la conta serve solo quando il conteggio fisico differisce dal sistema. "Tabelle" = sola lettura dei dati grezzi (come fogli Excel), corretto.

## SESSION 32 — 2026-07-03 (pomeriggio) — SWITCH QROMO ESEGUITO ✅ (punto di non ritorno)

- **Webhook Qromo switchato in console** (Chrome, sessione Benedetta): cancellato "Import GsheetsQromo"
  (Apps Script `/exec`) e creato **"Amimi App Supabase"** → edge `qromo-webhook` con `?key=` nell'URL,
  tipi New orders + Update orders. Ordine obbligato Delete→Add per il limite 1-webhook della subscription
  (l'Add con 2 webhook veniva rifiutato: "only 1 webhook per account" — conferma owner). Finestra senza
  webhook: pochi secondi.
- **Automazione console:** i real-click (computer) funzionano su matita/Delete/conferma/Add; falliva solo
  l'Add PRIMA del delete (limite piano, non bug UI). `form_input` ok sui campi testo; toggle tipi via
  click reale sulla ✓.
- **Edge v3 (difesa in profondità):** Qromo ha generato un proprio token per il nuovo webhook →
  salvato in `app_flags.qromo_webhook_token` e accettato come `body.auth` alternativo (oltre a
  secret via `?key=`/`body.auth`). Test live: auth errata 401, token Qromo ok, `?key=` ok (payload
  no_order, zero scritture).
- **Baseline smoke test:** 150 righe `qromo_sales`, ultima 02-07 17:25, 0 `qromo-direct`, 5 `qromo-forward`.
  Prossima vendita reale → 1 riga `source='qromo-direct'`, zero doppioni. Forwarder Apps Script lasciato
  attivo a secco (pezzo del rollback).
- **Docs:** TRIGGER_MIGRAZIONE §4b riscritto (eseguito + rollback), blocker 1 → 🟢.
- **Cocco Green/Black/Annie verificati anche dal sito cliente** (storefront): comprabili, "Low stock"
  su Cocco Green = corretto (9 pz). SC/CC 2×disp = decisione owner ACCETTATA (registrata in memoria,
  non è un bug).

## SESSION 33 — 2026-07-03 (sera) — Doppio conteggio Cocco Black (+10) trovato e corretto

- **Segnalazione owner:** Shopify mostrava ~20 Lea Cocco Black alle 14:00 ma le fisiche erano ~10.
- **Causa: errore MIO del 02-07 sera.** Il realign `chi='realign-2026-07-03'` (22:21) ha inserito in
  `purchases` il riordino WhatsApp 01/07 come consegnato (+10 Black, +10 Green, data 08-07), ma per
  il BLACK l'arrivo era GIA' stato registrato da Ginevra la mattina stessa alle 08:58 via app
  (`source='app-arrivo-edit'`) → +10 doppio → giacenza 18 invece di 8, esposta online (policy
  specchio-reale ha amplificato l'errore del dato).
- **Fix Black:** cancellata la riga duplicata `ARR_Lea_Bag_COCCO_BLACK_20260708` (id `12a0253f…`,
  10pz, €200) con snapshot completo in `change_log` (`op='delete_duplicate_arrival'`). Giacenza
  49−41=**8**, Shopify riallineato subito a 8 (era 18).
- **Green: NON doppione** (nessuna registrazione app), ma segnata consegnata con data 08-07.
  Owner conferma: arrivate in anticipo → corretta solo la data (08/07→02/07) su purchases +
  supplier_orders. Giacenza 8, Shopify riallineato a 8.
- **Vendite di oggi (post fix esposizione):** 2 Black (#1440, #1445) + 2 Green (#1439, #1441) online —
  la nuova policy sta convertendo.
- **Delta residuo ±1:** Benedetta contava ~10 Black alle 14; app dice 9 a quell'ora (8 + la vendita
  delle 12:11 gia' scalata). Possibile causa: il difetto del lotto Feb ("1 ha difetto" mai scaricato)
  o conteggio approssimativo. Se serve precisione: **Registra ▸ Conta fisica** su Cocco Black.
- **LEZIONE (per i prossimi realign manuali):** prima di inserire arrivi da fogli ordini, controllare
  in `purchases` le righe recenti dello stesso codice con QUALSIASI source (soprattutto
  `app-arrivo-edit`): la dedup su `id_acquisto` non basta, l'app genera id diversi.

## SESSION 34 — 2026-07-04 — Home "Tutte le azioni" + editor Catalogo con COGS

- **Home:** sotto i bottoni personali di ogni persona ora c'è la sezione **"Tutte le azioni"** (union
  di tutte le azioni dell'app, dedup con i personali; Cruscotto solo per persona finance). Collassabile,
  stato ricordato per dispositivo (`localStorage amimi_allact`). `ALL_ACTIONS` in `lib/people.tsx`.
- **Prodotti & prezzi (nuovo, in Registra):** ricerca su TUTTO il catalogo (nome/variante/CODICE) →
  tocca → stesso form della Pulizia dati, ora con **campo COGS** (prima il COGS non era editabile da
  nessuna parte). Il suggerimento prezzo ora segue il COGS digitato. `Catalog` in `pages/Prodotti.tsx`.
- **write-api v12:** `product_verify` accetta `cogs` (Number, opzionale). Le vendite passate NON
  vengono ricalcolate (tengono lo snapshot cogs); il nuovo COGS vale per margini futuri. Testato
  no-op live su Lea_Bag_COCCO_BLACK (20→20, change_log ok).
- **Test Playwright (iPhone 13, vite preview): 17/17 PASS** — sezione presente, dedup, toggle
  persistente, Bene senza Cruscotto, catalogo cerca "cocco black" (4 risultati), form con COGS=20 /
  Prezzo=120, hint margine, zero errori JS. Script: `web/scripts/test-home-catalog.mjs`.
- **Gotcha Git Bash:** `--base /amimi-app/` viene manglato da MSYS in `/Program Files/Git/amimi-app/`
  → mai passare path-like args a vite via Git Bash, il base sta già in vite.config.ts.
- Deploy: gh-pages Published. PWA: serve hard-refresh (o riapri l'app) per il nuovo bundle.

## SESSION 35 - 2026-07-04 - Snapshot giornaliero su Google Drive (Apps Script)

- **Nuovo:** "Amimi App Snapshot Drive" (Apps Script standalone su info@amimi.it, scriptId
  1uIZfErcMUn2V-YcVx9hsEQ-Oi8HVxk5ANZ6rO_RLK23VkxpbT_mir0HL, sorgente in Cowork12/clasp/app-snapshot-drive/
  + copia versionata in amimi-app/scripts/appsscript-snapshot/). Ogni giorno alle 05-06 Roma crea un
  Google Sheet "Amimi_App_Snapshot_YYYY-MM-DD" nella cartella Drive "Amimi App Snapshots": 24 fonti
  (20 tabelle + 4 viste, colonna raw esclusa) + tab RIEPILOGO con conteggi. Chiave PUBBLICA read-only,
  retention 30gg (cestino), MAIL a info@amimi.it se fallisce o parziale. Complementare al backup JSON
  GitHub (db-backup.yml, per il restore): questo e' lo snapshot sfogliabile su Drive.
- **Trigger auto-installante:** snapshotDaily() chiama ensureTrigger_() a ogni run (self-healing).
  Rilancio manuale senza editor: web app /exec?k=RUN_TOKEN (token nel sorgente, deployment @1
  AKfycbwCCsezNkLf...), risponde {ok,triggers}. Primo run verificato: 24/24 tabelle, file su Drive.
- **Gotcha editor Apps Script via Chrome MCP (oggi):** dropdown funzioni e dialog "Aggiungi attivatore"
  NON si aprono (ne' ref ne' coordinate; renderer freeze sugli screenshot) - il click su Esegui esegue
  la funzione DEFAULT. Soluzione: funzioni auto-installanti + web app /exec, mai affidarsi alla
  selezione funzione da automazione.
- **clasp ri-autenticato come info@amimi.it** (era dan@geeiq.com, account sbagliato). Fix ORDER
  paginazione: change_log usa ts, shopify_stock usa codice, ce_totale_* usano year,month.
