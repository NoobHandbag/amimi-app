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
  // 28-10 (migr 0176): giugno mescola la serie vecchia (01-19) e ads-sync (20-30), che anon non legge. I mesi senza
  // giorni ads-sync (aprile, maggio) restano la somma di meta_ads_daily, prima e dopo la 0176.
  for (const m of [4, 5]) {
    const mraw = raw.filter((r) => new Date(r.date).getUTCMonth() + 1 === m).reduce((s, r) => s + Number(r.spend || 0), 0);
    const mview = Number(view.find((v) => v.month === m)?.spend || 0);
    ok(mraw > 0 && near(mraw, mview, 0.5), `ads month ${m} spend: raw ${mraw.toFixed(2)} ≈ view ${mview}`);
  }
  const anyRoas = view.find((v) => Number(v.spend) > 0);
  ok(anyRoas && near(Number(anyRoas.roas), Number(anyRoas.purchase_value) / Number(anyRoas.spend), 0.02), 'ROAS = purchase_value / spend');
}

console.log('\n===== v_ads_mensile sulla serie viva (migr 0176) =====');
{
  // Il confronto mese per mese con meta_ads_creative_daily non si fa da anon (base chiusa, RLS senza policy): lo fa
  // tests/ads_mensile_viste.sql. Dalle viste pubbliche: la fonte di ogni mese (regola per giorno: aprile e maggio 2026
  // la serie vecchia, giugno misto, da luglio ads-sync) e l'ultimo mese che arriva al giorno di
  // v_fonti_freschezza.meta_ads_creative_ultimo_giorno (= max(date) della base per ad; una riga sempre, letta da anon).
  const arr = (x) => (Array.isArray(x) ? x : []);
  const r0 = await get('/v_ads_mensile?select=year,month,fonte,ultimo_giorno&order=year,month');
  if (!Array.isArray(r0)) console.log(`  (v_ads_mensile non risponde: ${r0?.message ?? JSON.stringify(r0)})`);
  const mesi = arr(r0);
  const fonteDi = (y, m) => mesi.find((r) => r.year === y && r.month === m)?.fonte;
  ok(fonteDi(2026, 4) === 'meta_ads_daily' && fonteDi(2026, 5) === 'meta_ads_daily',
    `v_ads_mensile: aprile e maggio 2026 dalla serie vecchia (fonte ${fonteDi(2026, 4)}, ${fonteDi(2026, 5)})`);
  ok(fonteDi(2026, 6) === 'misto', `v_ads_mensile: giugno 2026 misto, 01-19 serie vecchia e 20-30 ads-sync (fonte ${fonteDi(2026, 6)})`);
  const vivi = mesi.filter((r) => r.year * 100 + r.month >= 202607);
  const fuori = vivi.filter((r) => r.fonte !== 'ads-sync');
  ok(vivi.length >= 4 && fuori.length === 0,
    `v_ads_mensile: ogni mese da 2026-07 viene da ads-sync (${vivi.length} mesi, KO ${fuori.map((r) => `${r.year}-${r.month}:${r.fonte}`).join(', ')})`);
  const fresc = arr(await get('/v_fonti_freschezza?select=meta_ads_creative_ultimo_giorno'));
  const ug = fresc[0]?.meta_ads_creative_ultimo_giorno;
  const ultimo = mesi[mesi.length - 1]?.ultimo_giorno;
  ok(fresc.length === 1 && !!ug && ultimo === ug,
    `v_ads_mensile: l'ultimo mese arriva a v_fonti_freschezza.meta_ads_creative_ultimo_giorno (${ultimo} contro ${ug})`);
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

console.log('\n===== GIFTS_OFFLINE pulita (migr 0156) =====');
{
  // kind obbligatorio con quattro valori, un omaggio non ha prezzo, una riga a quantita' 0 non ha costo.
  // Il database lo impone gia' per i primi due (vincoli della 0156): qui si vede se qualcuno li toglie.
  const arr = (x) => (Array.isArray(x) ? x : []);
  const g = arr(await get('/gifts_offline?select=id,kind,prezzo,quantita,cogs'));
  const KIND = ['gift', 'vendita_manuale', 'vendita_fuori_fatturato', 'rettifica'];
  const badKind = g.filter((r) => !KIND.includes(r.kind));
  const giftPrezzo = g.filter((r) => r.kind === 'gift' && Number(r.prezzo || 0) !== 0);
  const zeroCogs = g.filter((r) => Number(r.quantita) === 0 && Number(r.cogs || 0) > 0);
  ok(g.length > 0 && badKind.length === 0, `gifts_offline: ogni riga ha uno dei quattro kind (${g.length} righe, KO ${badKind.length})`);
  ok(g.length > 0 && giftPrezzo.length === 0, `gifts_offline: nessun omaggio con un prezzo (KO ${giftPrezzo.length})`);
  ok(g.length > 0 && zeroCogs.length === 0, `gifts_offline: nessuna riga a quantita 0 con un costo (KO ${zeroCogs.length})`);
  // vendita_fuori_fatturato esce dalla base del compenso: e' solo storico (61 righe gen-set), nessuno ne scrive di nuove
  const fuori = arr(await get('/gifts_offline?kind=eq.vendita_fuori_fatturato&created_at=gte.2026-10-14&select=id'));
  ok(Array.isArray(await get('/gifts_offline?select=id&limit=1')) && fuori.length === 0, `gifts_offline: nessuna vendita_fuori_fatturato nuova dopo la 0156 (KO ${fuori.length})`);
}

console.log('\n===== v_evasione_mensile e v_clienti_coorti (migr 0182) =====');
{
  // shipping_status ha una riga per lettera di vettura: un ordine con due LDV non deve contare due volte.
  // Solo i mesi passati: in quello corrente un ordine nuovo puo' cadere fra le due letture.
  const arr = (x) => (Array.isArray(x) ? x : []);
  const conta = async (q) => {
    const r = await fetch(REST + q, { method: 'HEAD', headers: { ...H, Prefer: 'count=exact' } });
    return Number((r.headers.get('content-range') || '').split('/')[1]);
  };
  const adesso = new Date();
  const passati = arr(await get('/v_evasione_mensile?select=year,month,ordini'))
    .filter((r) => r.year < adesso.getUTCFullYear() || r.month < adesso.getUTCMonth() + 1);
  const diversi = [];
  for (const r of passati) {
    const n = await conta(`/shopify_orders?year=eq.${r.year}&month=eq.${r.month}&created_at_shop=not.is.null&select=order_id`);
    if (n !== Number(r.ordini)) diversi.push(`${r.year}-${r.month}: ${r.ordini} contro ${n}`);
  }
  ok(passati.length > 0 && diversi.length === 0, `v_evasione_mensile: ogni ordine conta una volta (${passati.length} mesi, KO: ${diversi.join('; ')})`);

  // netto_medio_cliente = spesa media dei clienti della coorte senza IVA. aov vuoto = solo ordini rimborsati, fuori anche dalla vista.
  const clienti = [];
  for (let da = 0; ; da += 1000) {
    const pagina = arr(await get(`/v_clienti_rfm?aov=not.is.null&select=primo_ordine,monetary&order=email&limit=1000&offset=${da}`));
    clienti.push(...pagina);
    if (pagina.length < 1000) break;
  }
  const spese = new Map();
  for (const c of clienti) {
    const mese = c.primo_ordine.slice(0, 7);
    spese.set(mese, [...(spese.get(mese) ?? []), Number(c.monetary)]);
  }
  const coorti = arr(await get('/v_clienti_coorti?select=coorte,netto_medio_cliente'));
  const storte = coorti.filter((c) => {
    const s = spese.get(c.coorte.slice(0, 7)) ?? [];
    return !s.length || !near(s.reduce((a, b) => a + b, 0) / s.length / 1.22, Number(c.netto_medio_cliente));
  });
  ok(coorti.length > 0 && storte.length === 0, `v_clienti_coorti: netto_medio_cliente senza IVA (${coorti.length} coorti, KO ${storte.length})`);
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
if (fail) { console.log('FAILURES:\n- ' + fails.join('\n- ')); process.exit(1); }
