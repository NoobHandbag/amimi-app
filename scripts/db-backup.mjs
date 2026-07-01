// Daily LOGICAL backup of the amimi-app Supabase DB.
// Reads every business table via the PUBLIC publishable key (read-only — no secret) and writes
// one JSON file per table. The SCHEMA (tables/views/functions) is versioned in supabase/migrations/.
// RESTORE: recreate the schema from migrations, then re-insert each JSON via the service role
// (same pattern as supabase/functions/etl-load). app_flags/app_config are intentionally NOT backed
// up here (locked to service-role; they hold config/secrets, not business data).
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = process.env.SUPABASE_URL || 'https://imszbjeyplaiovylhkgl.supabase.co';
const KEY = process.env.SUPABASE_KEY || 'sb_publishable_DP66FFObEGagJknhGOz8xw_8KO8WIgD';

const TABLES = [
  'products', 'product_aliases', 'suppliers', 'negozi', 'purchases', 'qromo_sales',
  'shopify_orders', 'shopify_line_items', 'gifts_offline', 'b2b_movements', 'expenses',
  'meta_ads_daily', 'counts', 'returns', 'stock_adjustments', 'supplier_orders',
  'shopify_stock', 'change_log', 'ce_totale_monthly', 'ce_totale_manual', 'health_log',
];
const PAGE = 1000;

mkdirSync('db-backup', { recursive: true });
const manifest = { generated_at: new Date().toISOString(), source: URL, tables: {} };

for (const t of TABLES) {
  try {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const r = await fetch(`${URL}/rest/v1/${t}?select=*`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${from}-${from + PAGE - 1}` },
      });
      if (!r.ok) { if (from === 0) manifest.tables[t] = { skipped: r.status }; break; }
      const batch = await r.json();
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    if (manifest.tables[t]?.skipped) { console.log(`${t}: skip (${manifest.tables[t].skipped})`); continue; }
    writeFileSync(`db-backup/${t}.json`, JSON.stringify(rows));
    manifest.tables[t] = { rows: rows.length };
    console.log(`${t}: ${rows.length} rows`);
  } catch (e) {
    manifest.tables[t] = { error: String(e) };
    console.log(`${t}: ERROR ${e}`);
  }
}
writeFileSync('db-backup/_manifest.json', JSON.stringify(manifest, null, 2));
console.log('backup complete:', Object.keys(manifest.tables).length, 'tables');
