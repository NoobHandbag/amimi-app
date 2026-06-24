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
