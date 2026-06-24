// Dump the seed workbook's structure so the ETL can map columns exactly.
// Usage: node inspect.mjs
import xlsx from 'xlsx';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../fixtures/seed.xlsx', import.meta.url));
const wb = xlsx.readFile(FILE, { cellDates: true });

console.log('WORKBOOK tabs:', wb.SheetNames.length);
console.log('NAMES:', JSON.stringify(wb.SheetNames));
console.log('');

const FOCUS = [
  'PRODUCT_COGS&PRICE', 'PRODUCT_MAP', 'INVENTARIO_PRODOTTI', 'ACQUISTI',
  'DB_QROMO', 'DB Shopify', 'DB_B2B', 'GIFT_OFFLINE', 'EXPENSES MASTER',
  'CE_AMIMI', 'CE_TOTALE'
];

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws['!ref'] || '(empty)';
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
  const focus = FOCUS.includes(name);
  console.log(`=== ${name} === ref=${ref} rows=${rows.length}${focus ? '   <<< FOCUS' : ''}`);
  const show = focus ? Math.min(4, rows.length) : Math.min(2, rows.length);
  for (let i = 0; i < show; i++) {
    const r = (rows[i] || []).slice(0, 32).map(v => (v instanceof Date ? v.toISOString().slice(0, 10) : v));
    console.log(`  [${i}] ${JSON.stringify(r)}`);
  }
  console.log('');
}
