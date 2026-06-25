// Feature regression — pure-logic helpers + view correctness against ground truth.
// Run: node tests/features.mjs   (Node 24 strips TS types on import)
import { suggestPrice, marginOf, genSeoTitle } from '../web/src/lib/helpers.ts';

const REST = 'https://imszbjeyplaiovylhkgl.supabase.co/rest/v1';
const KEY = 'sb_publishable_DP66FFObEGagJknhGOz8xw_8KO8WIgD';
const H = { apikey: KEY, authorization: 'Bearer ' + KEY };
const get = async (q) => (await fetch(REST + q, { headers: H })).json();
let pass = 0, fail = 0; const fails = [];
const ok = (c, m) => { c ? pass++ : (fail++, fails.push(m)); console.log((c ? 'PASS ' : 'FAIL ') + m); };
const near = (a, b, t = 0.02) => Math.abs(a - b) <= t;

console.log('\n===== Pricing helper (pure logic) =====');
for (const [cogs, margin] of [[20, 0.62], [40, 0.62], [15, 0.7], [50, 0.55]]) {
  const price = suggestPrice(cogs, margin);
  const eff = marginOf(price, cogs);
  ok(price > cogs && near(eff, margin, 0.03), `suggestPrice(${cogs}, ${margin}) = €${price} -> margine effettivo ${(eff * 100).toFixed(1)}% (~${margin * 100}%)`);
}
ok(suggestPrice(0) === 0, 'suggestPrice(0) = 0 (no COGS)');
ok(String(suggestPrice(40)).endsWith('.9'), 'suggested price has clean .90 ending');

console.log('\n===== SEO generator (brand formula) =====');
const leSeo = genSeoTitle('Lea Bag', 'VERNICE ROSSA');
ok(/AMIMI/.test(leSeo) && /Made in Italy/.test(leSeo) && /vera pelle/.test(leSeo) && /Lea/.test(leSeo), `leather: "${leSeo}"`);
const niSeo = genSeoTitle('Nina Bag', 'STRIPES JUNGLE GREEN');
ok(/AMIMI/.test(niSeo) && !/Made in Italy/.test(niSeo) && /cotone/.test(niSeo), `Nina excludes Made in Italy: "${niSeo}"`);
ok(genSeoTitle('Valentina Bag', 'LEOPARDO').includes('Valentina'), 'model name preserved');

console.log('\n===== v_ads_mensile correctness =====');
{
  const view = await get('/v_ads_mensile?year=eq.2026&select=month,spend,purchase_value,roas');
  const raw = await get('/meta_ads_daily?select=date,spend,purchase_value');
  // sum raw spend for month 6 vs view
  const m6raw = raw.filter((r) => new Date(r.date).getUTCMonth() + 1 === 6).reduce((s, r) => s + Number(r.spend || 0), 0);
  const m6view = Number(view.find((v) => v.month === 6)?.spend || 0);
  ok(near(m6raw, m6view, 0.5), `ads june spend: raw ${m6raw.toFixed(2)} ≈ view ${m6view}`);
  const anyRoas = view.find((v) => Number(v.spend) > 0);
  ok(anyRoas && near(Number(anyRoas.roas), Number(anyRoas.purchase_value) / Number(anyRoas.spend), 0.02), 'ROAS = purchase_value / spend');
}

console.log('\n===== v_reorder correctness (velocity 60d) =====');
{
  const top = await get('/v_reorder?venduto_60d=gt.0&select=codice,venduto_60d,in_arrivo,giacenza&order=venduto_60d.desc&limit=1');
  const c = top[0];
  if (c) {
    const norm = c.codice.replace(/\s+/g, '_').toUpperCase();
    const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const q = await get(`/qromo_sales?codice_norm=eq.${norm}&data=gte.${since}&select=quantita`);
    const qsum = q.reduce((s, r) => s + Number(r.quantita), 0);
    // qromo is a subset of venduto_60d (which also includes shopify+b2b); assert view >= qromo subset and > 0
    ok(Number(c.venduto_60d) >= qsum && Number(c.venduto_60d) > 0, `reorder ${c.codice}: venduto_60d ${c.venduto_60d} >= qromo60 ${qsum}`);
    ok(Number(c.in_arrivo) >= 0, 'in_arrivo non-negative');
  } else ok(false, 'no reorder rows with sales');
}

console.log('\n===== v_sku_availability correctness (stato logic) =====');
{
  const rows = await get('/v_sku_availability?select=codice,giacenza,disponibili,on_shopify,stato&limit=200');
  const bad = rows.filter((r) => {
    const exp = r.on_shopify && r.disponibili > 0 ? 'acquistabile'
      : r.giacenza > 0 && !r.on_shopify ? 'in_stock_non_pubblicato'
      : r.on_shopify && r.disponibili <= 0 ? 'pubblicato_esaurito' : 'altro';
    return exp !== r.stato;
  });
  ok(bad.length === 0, `stato matches giacenza/on_shopify logic for all ${rows.length} rows (${bad.length} mismatches)`);
  ok(rows.some((r) => r.stato === 'in_stock_non_pubblicato'), 'detects in-stock-not-published losses');
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
if (fail) { console.log('FAILURES:\n- ' + fails.join('\n- ')); process.exit(1); }
