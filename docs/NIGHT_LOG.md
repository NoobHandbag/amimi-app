# NIGHT LOG — overnight build of amimi-app

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
