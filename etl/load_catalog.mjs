import xlsx from 'xlsx'; import { fileURLToPath } from 'node:url';
const wb = xlsx.readFile(fileURLToPath(new URL('../fixtures/seed.xlsx', import.meta.url)), { cellDates: true });
const rows = (n) => wb.Sheets[n] ? xlsx.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false, defval: null }) : [];
const S = (v) => v == null ? '' : String(v).trim().replace(/'/g, "''");
const set = new Map();
for (const r of rows('CATALOG_SYNC_V2').slice(1)) { const c = S(r[5]); if (c) set.set(c, S(r[7])); }
for (const r of rows('VARIANT_SYNC_V2').slice(1)) { const c = S(r[7]); if (c && !set.has(c)) set.set(c, S(r[9])); }
const vals = [...set.entries()].map(([c, h]) => `('${c}','${h}')`).join(',');
console.log(`COUNT=${set.size}`);
console.log(`insert into shopify_catalog (codice, handle) values ${vals} on conflict (codice) do nothing;`);
