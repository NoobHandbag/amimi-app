// ETL — parse the Master xlsx export and load the Supabase replica FAITHFULLY.
// Run: node --env-file=.env load.mjs   (truncate the base tables first, see runbook)
//
// Column positions are verified against fixtures/seed.xlsx (2026-06-24 export) via inspect*.mjs.
import xlsx from 'xlsx';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { persistSession: false },
});

const wb = xlsx.readFile(fileURLToPath(new URL('../fixtures/seed.xlsx', import.meta.url)), { cellDates: true });
const rows = (n) => (wb.Sheets[n] ? xlsx.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false, defval: null }) : []);

// ---------- coercion helpers ----------
const str = (v) => (v == null || v === '' ? null : String(v).trim());
function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace('%', '').replace(',', '.').replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}
const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s); return Number.isNaN(+d) ? null : d.toISOString().slice(0, 10);
}

async function insertAll(table, records) {
  if (!records.length) { console.log(`${table}: 0 records`); return; }
  let ok = 0;
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const { error } = await sb.from(table).insert(chunk);
    if (error) console.log(`  ERR ${table} @${i}: ${error.message}`);
    else ok += chunk.length;
  }
  console.log(`${table}: inserted ${ok}/${records.length}`);
}

// ---------- products (PCP price/cogs + INVENTARIO enrichment + PRODUCT_MAP name) ----------
const pcp = rows('PRODUCT_COGS&PRICE').slice(1);
const inv = rows('INVENTARIO_PRODOTTI').slice(1).filter((r) => str(r[0]));
const pmap = rows('PRODUCT_MAP').slice(1).filter((r) => str(r[0]) || str(r[1]));

const prod = new Map();
for (const r of pcp) { const c = str(r[0]); if (!c) continue; prod.set(c, { codice: c, retail_price: num(r[3]), cogs: num(r[4]) }); }
for (const r of inv) {
  const c = str(r[0]); if (!c) continue;
  const p = prod.get(c) || { codice: c };
  p.shopify_name = p.shopify_name || str(r[1]);
  p.shopify_sku = p.shopify_sku || str(r[2]);
  p.categoria = p.categoria || str(r[3]);
  p.item = p.item || str(r[4]);
  p.variant = p.variant || str(r[5]);
  p.model = p.model || str(r[4]);
  if (p.retail_price == null) p.retail_price = num(r[6]);
  if (p.cogs == null) p.cogs = num(r[7]);
  p.image_url = p.image_url || str(r[16]);
  prod.set(c, p);
}
const nameByCodice = new Map();
const itemByCodice = new Map();
const variantByCodice = new Map();
for (const r of pmap) {
  const c = str(r[1]); if (!c) continue;
  if (!nameByCodice.has(c)) nameByCodice.set(c, str(r[0]));
  if (!itemByCodice.has(c)) itemByCodice.set(c, str(r[2]));
  if (!variantByCodice.has(c)) variantByCodice.set(c, str(r[4]));
}
const products = [...prod.values()].map((p) => ({
  codice: p.codice,
  model: p.model || itemByCodice.get(p.codice) || null,
  item: p.item || itemByCodice.get(p.codice) || null,
  variant: p.variant || variantByCodice.get(p.codice) || null,
  categoria: p.categoria || null,
  shopify_name: p.shopify_name || nameByCodice.get(p.codice) || null,
  shopify_sku: p.shopify_sku || null,
  retail_price: p.retail_price, cogs: p.cogs,
  image_url: p.image_url || null, source: 'etl',
}));

// ---------- aliases (PRODUCT_MAP) ----------
const aliases = pmap.filter((r) => str(r[0]) && str(r[1])).map((r) => ({ shopify_name: str(r[0]), codice: str(r[1]), source: 'etl' }));

// ---------- suppliers (distinct ACQUISTI fornitori) + negozi (B2B_NEGOZI) ----------
const acq = rows('ACQUISTI').slice(1).filter((r) => str(r[1]) || str(r[0]));
const supSet = new Map();
for (const r of acq) { const f = str(r[11]); if (f && !supSet.has(f)) supSet.set(f, { name: f }); }
const suppliers = [...supSet.values()];
const negozi = rows('B2B_NEGOZI').slice(1).filter((r) => str(r[0])).map((r) => ({ name: str(r[0]), perc_default: num(r[4]), notes: str(r[10]) }));

// ---------- purchases (ACQUISTI) ----------
const purchases = acq.map((r) => ({
  id_acquisto: str(r[0]), codice: str(r[1]), data: parseDate(r[2]), tipologia: str(r[3]),
  categoria: str(r[4]), item: str(r[5]), variant: str(r[6]), quantita: num(r[7]),
  unita_misura: str(r[8]), costo_unitario: num(r[9]), fornitore: str(r[11]), online: int(r[14]), source: 'etl',
}));

// ---------- qromo_sales (DB_QROMO) ----------
const qromo = rows('DB_QROMO').slice(1).filter((r) => str(r[5]) || str(r[13])).map((r) => ({
  sale_id: str(r[13]), data: parseDate(r[2]), year: int(r[0]), month: int(r[1]),
  nome: str(r[3]), cognome: str(r[4]), codice: str(r[5]), item: str(r[6]), variant: str(r[7]),
  quantita: num(r[8]), payment_method: str(r[9]), prezzo: num(r[10]), cogs: num(r[11]), note: str(r[12]), source: 'etl',
}));

// ---------- gifts_offline (GIFT_OFFLINE) ----------
const gifts = rows('GIFT_OFFLINE').slice(1).filter((r) => str(r[5]) || str(r[13])).map((r) => ({
  gift_id: str(r[13]), year: int(r[0]), month: int(r[1]), data: parseDate(r[2]),
  nome: str(r[3]), cognome: str(r[4]), codice: str(r[5]), quantita: num(r[6]), payment_method: str(r[7]),
  prezzo: num(r[8]), cogs: num(r[9]), nota: str(r[10]), item: str(r[11]), variant: str(r[12]), kind: 'gift', source: 'etl',
}));

// ---------- b2b_movements (DB_B2B) ----------
const b2b = rows('DB_B2B').slice(1).filter((r) => str(r[0]) || str(r[3])).map((r) => ({
  data: parseDate(r[0]), year: int(r[1]), month: int(r[2]), codice: str(r[3]), quantita: num(r[4]),
  modello: str(r[5]), tipo_movimento: str(r[6]), negozio: str(r[7]), prezzo_retail: num(r[8]),
  perc_negozio: num(r[9]), cogs: num(r[13]), note: str(r[14]), mov_id: str(r[15]), stato: str(r[16]), source: 'etl',
}));

// ---------- expenses (EXPENSES MASTER) ----------
const expenses = rows('EXPENSES MASTER').slice(1).filter((r) => str(r[4]) || num(r[5]) != null).map((r) => ({
  year: int(r[0]), month: int(r[1]), date_reported: parseDate(r[2]), date_paid: parseDate(r[3]),
  operazione: str(r[4]), costo: num(r[5]), categoria: str(r[6]), sottocategoria: str(r[7]),
  amimi_raw: str(r[8]), note: str(r[9]), source: 'etl',
}));

// ---------- meta_ads_daily ----------
const meta = rows('META_ADS_DAILY').slice(1).filter((r) => str(r[0]) && str(r[1])).map((r) => ({
  date: parseDate(r[0]), campaign_id: str(r[1]), campaign_name: str(r[2]), campaign_status: str(r[3]),
  campaign_objective: str(r[4]), spend: num(r[5]), impressions: int(r[6]), reach: int(r[7]), frequency: num(r[8]),
  clicks: int(r[9]), link_clicks: int(r[10]), ctr: num(r[11]), cpc: num(r[12]), cpm: num(r[13]),
  landing_page_views: int(r[14]), view_content: int(r[15]), add_to_cart: int(r[16]), initiate_checkout: int(r[17]),
  add_payment_info: int(r[18]), purchases: int(r[19]), purchase_value: num(r[20]), cpa: num(r[21]), roas: num(r[22]),
  pulled_at: r[23] instanceof Date ? r[23].toISOString() : str(r[23]), source: 'etl',
}));

// ---------- shopify orders + line items (DB Shopify; order fields only on first row of each order) ----------
const shRows = rows('DB Shopify').slice(1);
const orders = []; const lines = []; const seen = new Set();
let curOid = null, curYear = null, curMonth = null;
for (const r of shRows) {
  const nm = str(r[0]);
  if (nm) { curOid = nm; if (int(r[80]) != null) curYear = int(r[80]); if (int(r[81]) != null) curMonth = int(r[81]); }
  if (nm && !seen.has(nm)) {
    seen.add(nm);
    orders.push({
      order_id: nm, email: str(r[1]), financial_status: str(r[2]), fulfillment_status: str(r[4]),
      created_at_shop: str(r[15]) || null, gross_total: num(r[11]), discount_total: num(r[13]),
      shipping_total: num(r[9]), payment_fees: num(r[86]),
      free_shipping: num(r[84]) > 0, free_shipping_amt: num(r[84]), refund_amount: num(r[49]), vendor: str(r[50]),
      currency: str(r[7]), year: curYear, month: curMonth,
    });
  }
  if (str(r[17])) {
    lines.push({
      order_id: curOid, lineitem_name: str(r[17]), codice: str(r[89]), resolved: !!str(r[89]),
      quantita: num(r[16]), price: num(r[18]), cogs_snapshot: num(r[85]),
      year: int(r[80]) ?? curYear, month: int(r[81]) ?? curMonth,
    });
  }
}

// ---------- run ----------
console.log('Loading replica from seed.xlsx ...');
// idempotent reset (no FKs between base tables by design, so order is free)
const RESET = ['shopify_line_items', 'shopify_orders', 'purchases', 'qromo_sales', 'gifts_offline', 'b2b_movements', 'expenses', 'meta_ads_daily', 'product_aliases', 'products', 'suppliers', 'negozi', 'counts'];
for (const t of RESET) { const { error } = await sb.from(t).delete().not('id', 'is', null); if (error) console.log('reset ' + t + ' err: ' + error.message); }
console.log('tables reset.');
await insertAll('products', products);
await insertAll('product_aliases', aliases);
await insertAll('suppliers', suppliers);
await insertAll('negozi', negozi);
await insertAll('purchases', purchases);
await insertAll('qromo_sales', qromo);
await insertAll('gifts_offline', gifts);
await insertAll('b2b_movements', b2b);
await insertAll('expenses', expenses);
await insertAll('meta_ads_daily', meta);
await insertAll('shopify_orders', orders);
await insertAll('shopify_line_items', lines);
console.log('ETL done.');
