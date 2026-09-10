// Seed builder: Google Maps per citta' x query (piano 3.1 fonte 2). Scorre la LISTA dei risultati
// (non apre le schede) ed estrae nome, indirizzo, categoria, rating, place_id, coord di ogni negozio.
// Scarta le catene note (lib.CHAIN_DENYLIST) e le categorie non-moda (ristoranti, bar, hotel...).
// Emette un JSON nel formato di seed_pilota.json in out/, che poi si carica con: node seed.mjs <out>.
// ZERO scritture a DB: la discovery e' separata dal seed vero (dedup in seed.mjs).
//
// Uso: node seed_maps.mjs [--cities milano,roma] [--queries "concept store,boutique donna"] [--max 30] [--out out/seed_maps.json]
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { UA, isChain, normName, TYPE_BY_QUERY } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));

// citta' del cerchio 1 (Milano + hinterland + top citta' Shopify) con provincia e priorita'
const CITY_PROV = { 'Milano': ['MI', 1], 'Monza': ['MB', 1], 'Como': ['CO', 1], 'Bergamo': ['BG', 1], 'Brescia': ['BS', 1], 'Pavia': ['PV', 1], 'Varese': ['VA', 1], 'Roma': ['RM', 1], 'Torino': ['TO', 1], 'Bologna': ['BO', 1], 'Genova': ['GE', 1], 'Firenze': ['FI', 1], 'Venezia': ['VE', 1], 'Modena': ['MO', 1], 'Verona': ['VR', 1] };
const CITIES = args.cities ? String(args.cities).split(',').map((s) => s.trim()) : Object.keys(CITY_PROV);
const QUERIES = args.queries ? String(args.queries).split(',').map((s) => s.trim()) : ['concept store', 'boutique donna', 'boutique accessori', 'negozio borse artigianali', 'bijoux e accessori', 'negozio regali design'];
const MAX = Number(args.max || 30);
const OUT = args.out || `out/seed_maps_${new Date().toISOString().slice(0, 10)}.json`;

// categorie Maps chiaramente fuori target (non si vendono borse/accessori moda multimarca)
const CAT_DENY = /ristorant|pizzer|trattor|osteria|\bbar\b|caffè|caffe|gelater|pasticc|panific|forno|albergo|hotel|\bb&b\b|ostello|parrucch|barbier|estetic|centro estetico|spa\b|farmac|parafarmac|ottic|supermerc|aliment|macell|pescher|ferrament|banca\b|assicuraz|palestr|fitness|museo|teatro|cinema|agenzia (immobiliar|viaggi)|immobiliar|autofficina|autosalone|concessionar|tabacch|edicola|libreria|cartoler|fioraio|fiorista|enotec|vineria|birrer|dentist|studio medico|veterinar|animal|toeletta/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ locale: 'it-IT', userAgent: UA, viewport: { width: 1280, height: 1200 } });
const seen = new Map(); // dedup nel run: place_id o normName|citta
const out = [];
let nSearch = 0;

for (const city of CITIES) {
  const [prov, prio] = CITY_PROV[city] || [null, 2];
  for (const query of QUERIES) {
    nSearch++;
    const q = `${query} ${city}`;
    const page = await ctx.newPage();
    let got = 0;
    try {
      await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(q)}?hl=it`, { waitUntil: 'domcontentloaded', timeout: 40000 });
      await page.waitForTimeout(2500);
      for (const l of ['Rifiuta tutto', 'Reject all', 'Accetta tutto']) { const b = page.getByRole('button', { name: l }).first(); if (await b.count()) { await b.click({ timeout: 2000 }).catch(() => {}); break; } }
      await page.waitForTimeout(2500);
      const feed = page.locator('div[role="feed"]').first();
      if (!(await feed.count())) { // singola scheda (una sola corrispondenza): la saltiamo, seed_maps cerca liste
        console.log(`  ${q}: nessuna lista (scheda singola o zero risultati)`);
        await page.close(); await sleep(1500); continue;
      }
      // scroll per caricare piu' risultati
      let prevH = 0;
      for (let i = 0; i < 10; i++) {
        await feed.evaluate((el) => el.scrollBy(0, el.scrollHeight)).catch(() => {});
        await page.waitForTimeout(1400);
        const h = await feed.evaluate((el) => el.scrollHeight).catch(() => 0);
        const n = await page.locator('div[role="feed"] a[href*="/maps/place/"]').count();
        if (n >= MAX || h === prevH) break; prevH = h;
      }
      const items = await page.locator('div[role="feed"] a[href*="/maps/place/"]').evaluateAll((els) => els.map((a) => {
        const card = a.closest('div[jsaction], div');
        return { name: (a.getAttribute('aria-label') || '').trim(), href: a.href || '', text: (card?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 260) };
      }));
      for (const it of items) {
        if (!it.name || !it.href) continue;
        const placeId = (it.href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) || [])[1] || null;
        const coords = it.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || it.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        const rating = (it.text.match(/(\d[.,]\d)\s*\(/) || [])[1] || null;
        const reviews = (it.text.match(/\((\d[\d.]*)\)/) || [])[1] || null;
        // categoria: token dopo "rating (reviews)" oppure prima parola-frase con ·
        const cat = (it.text.match(/\)\s*(?:€+\s*)?·?\s*([A-Za-zÀ-ÿ' ]{3,40})/) || [])[1]?.trim() || (it.text.match(/^[^\d·]{3,40}·\s*([A-Za-zÀ-ÿ' ]{3,40})/) || [])[1]?.trim() || null;
        if (isChain(it.name)) continue;
        if (cat && CAT_DENY.test(cat)) continue;
        if (CAT_DENY.test(it.text)) continue;
        const key = placeId || `${normName(it.name)}|${normName(city)}`;
        if (seen.has(key)) continue; seen.set(key, true);
        out.push({
          nome: it.name, tipo: TYPE_BY_QUERY[query] || 'boutique', citta: city, provincia: prov, paese: 'IT',
          google_place_id: placeId, google_maps_url: it.href.slice(0, 500),
          lat: coords ? parseFloat(coords[1]) : null, lng: coords ? parseFloat(coords[2]) : null,
          fonte_seed: `maps:${query}`, priorita_tipologia: prio,
          owner_note: `Maps "${query}" ${city}${cat ? ' · ' + cat : ''}${rating ? ' · ' + rating + (reviews ? ' (' + reviews + ')' : '') : ''}`,
        });
        got++;
      }
      console.log(`  ${q}: ${got} tenuti (su ${items.length} risultati)`);
    } catch (e) {
      console.log(`  ${q}: ERR ${e.message.slice(0, 120)}`);
    }
    await page.close();
    await sleep(1800 + Math.random() * 1500);
  }
}
await browser.close();
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`\n[seed_maps] ${nSearch} ricerche, ${out.length} negozi unici -> ${OUT}`);
