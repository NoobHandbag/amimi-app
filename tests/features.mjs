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

console.log('\n===== CONSERVAZIONE spese e ricavi (audit gate 14-09, guardiano anti-logistica) =====');
{
  // ogni euro di spesa approvata di un mese nativo e' in una riga del CE o in un'esclusione dichiarata (COGS/PACKAGING):
  // spese_scoperte deve essere ~0 su OGNI mese. Se un domani una categoria/sottocategoria non ha bucket (come fu la
  // logistica), qui diventa != 0 e il test e' rosso PRIMA che il P&L sbagli in silenzio.
  const comp = await get('/v_ce_completezza?select=year,month,spese_scoperte');
  const scoperti = comp.filter((r) => Math.abs(Number(r.spese_scoperte)) > 0.01);
  ok(scoperti.length === 0, `spese: ogni euro contato o escluso su tutti i ${comp.length} mesi nativi (${scoperti.length} scoperti: ${scoperti.map((r) => `${r.year}-${r.month}:${r.spese_scoperte}`).join(', ')})`);
  // nessuna riga di vendita con periodo NULL/invalido (sarebbe invisibile al CE, ricavo sparito)
  const orf = (await get('/v_vendite_orfane?select=totale'))[0];
  ok(Number(orf?.totale) === 0, `ricavi: nessuna vendita con periodo mancante (totale orfane = ${orf?.totale})`);
}

console.log('\n===== COMPENSO SOCI nel CE (migr 0154) =====');
{
  // la riga e' calcolata: compenso = -aliquota x base, mai positiva, dentro MC1 (e quindi MC2), in entrambi i CE.
  // Se qualcuno toglie il compenso da una delle due summary, mc1 non torna piu' con la somma delle righe.
  const arr = (x) => (Array.isArray(x) ? x : []);   // una vista/colonna assente risponde con un oggetto errore, non con []
  const acc = arr(await get('/ce_compensi_soci?select=aliquota,dal,al'));
  const aliq = (y, m) => acc.filter((a) => `${y}-${String(m).padStart(2, '0')}-01` >= a.dal && (!a.al || `${y}-${String(m).padStart(2, '0')}-01` <= a.al))
    .reduce((s, a) => s + Number(a.aliquota), 0);
  ok(acc.length >= 1, `ce_compensi_soci leggibile con la chiave pubblica (${acc.length} accordi)`);
  for (const view of ['v_ce_amimi_summary', 'v_ce_totale', 'v_ce_totale_summary']) {
    const rows = arr(await get(`/${view}?year=eq.2026&select=month,omni_netto,cogs,packaging,commissioni,logistica_var,resi,compenso_soci,base_compenso_soci,mc1,mc2,salari,tasse,logistica_mag,opex,eventi,marketing`));
    const N = (x) => Number(x) || 0;
    const badMc1 = rows.filter((r) => !near(N(r.omni_netto) + N(r.cogs) + N(r.packaging) + N(r.commissioni) + N(r.logistica_var) + N(r.resi) + N(r.compenso_soci), N(r.mc1)));
    const badMc2 = rows.filter((r) => !near(N(r.mc1) + N(r.salari) + N(r.tasse) + N(r.logistica_mag) + N(r.opex) + N(r.eventi) + N(r.marketing), N(r.mc2)));
    const badComp = rows.filter((r) => N(r.compenso_soci) > 0 || !near(N(r.compenso_soci), -aliq(2026, r.month) * N(r.base_compenso_soci), 0.01));
    ok(rows.length > 0 && badMc1.length === 0 && badMc2.length === 0,
      `${view}: MC1 = netto + variabili + compenso soci, MC2 = MC1 + fissi, su ${rows.length} mesi (KO mc1 ${badMc1.map((r) => r.month)}, mc2 ${badMc2.map((r) => r.month)})`);
    ok(rows.length > 0 && badComp.length === 0, `${view}: compenso_soci = -aliquota x base e mai positivo (KO mesi ${badComp.map((r) => r.month)})`);
  }
  const drift = arr(await get('/v_ce_drift?select=ce,year,month,delta_netto,delta_mc2'));
  const moved = drift.filter((d) => Math.abs(Number(d.delta_netto)) > 0.01 || Math.abs(Number(d.delta_mc2)) > 0.01);
  ok(drift.length > 0 && moved.length === 0, `mesi chiusi: nessun drift fra snapshot e viste live (${moved.map((d) => `${d.ce}-${d.month}`).join(', ')})`);
  // v_ce_drift guarda solo netto e mc2: uno spostamento fra righe che lascia mc2 uguale (es. OPEX -> SALARI in un mese
  // chiuso, Gate 2 B1 del 13-10) non lo vede nessuno. Qui si confronta OGNI riga dello snapshot col live.
  const snaps = arr(await get('/ce_snapshots?select=ce,year,month,snapshot'));
  const liveA = arr(await get('/v_ce_amimi_summary?select=*'));
  const liveT = arr(await get('/v_ce_totale?select=*'));
  const righe = [];
  for (const s of snaps) {
    const l = (s.ce === 'amimi' ? liveA : liveT).find((r) => r.year === s.year && r.month === s.month);
    if (!l) { righe.push(`${s.ce}-${s.month}: senza live`); continue; }
    for (const [k, v] of Object.entries(s.snapshot || {})) {
      if (k === 'year' || k === 'month') continue;
      if (!near(Number(v), Number(l[k]), 0.01)) righe.push(`${s.ce}-${s.month} ${k} ${Number(v).toFixed(2)}->${Number(l[k]).toFixed(2)}`);
    }
  }
  ok(snaps.length > 0 && righe.length === 0, `mesi chiusi: ogni riga dello snapshot uguale al live (${righe.join('; ')})`);
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
if (fail) { console.log('FAILURES:\n- ' + fails.join('\n- ')); process.exit(1); }
