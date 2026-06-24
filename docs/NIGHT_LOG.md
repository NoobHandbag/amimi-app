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
- _(none yet)_
