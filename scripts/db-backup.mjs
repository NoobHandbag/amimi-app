// Daily LOGICAL backup of the amimi-app Supabase DB.
// Reads every business table via the PUBLIC publishable key (read-only — no secret) and writes
// one JSON file per table. The SCHEMA (tables/views/functions) is versioned in supabase/migrations/.
// RESTORE: apply supabase/schema.sql (the STRUCTURE), then re-insert each JSON via the service role
// NB (01-08): la struttura NON si ricrea piu' dalle migrazioni. Provato: 4 file mancavano, 2 avevano
// lo stesso numero, 9 sono segnaposto, e la 0050 fa ROLLBACK su un DB vuoto (guardia sul CE, corretta).
// La fonte della struttura e' `supabase/schema.sql`, aggiornato da `scripts/schema-dump.mjs`.
// Il piano Supabase e' FREE: la piattaforma NON fa backup. Questa e' l'unica rete di sicurezza.
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
  // Aggiunte audit 2026-07-06 (A11): ce_snapshots e' la BASELINE del drift dei mesi chiusi —
  // senza, un restore silenzia per sempre ce-guard. Le altre due sono config anon-readable.
  'ce_snapshots', 'shopify_catalog', 'non_product_codici',
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

// Guardia di completezza (C34): un backup parziale (key ruotata, tabella rinominata) NON deve
// passare come verde. Se una tabella e' stata saltata/errata, esci non-zero cosi' l'Action mostra rosso.
const broken = TABLES.filter((t) => manifest.tables[t]?.skipped != null || manifest.tables[t]?.error != null);
if (broken.length) {
  console.error('BACKUP INCOMPLETO — tabelle non salvate:', broken.join(', '));
  process.exit(1);
}
