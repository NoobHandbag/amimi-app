// Seed da store locator Momoni (stores.momoni.it/it/negozi, pagina salvata in out/momoni.html): solo rivenditori
// 'Multibrand' in Italia. Un rivenditore Momoni e' per costruzione multimarca, fascia media, abbigliamento donna.
// Output nel formato di seed.mjs: node out/stockist_momoni.cjs && node seed.mjs out/seed_stockist_momoni.json
const fs = require('fs');
const s = fs.readFileSync('out/momoni.html', 'utf8');
const items = s.split("<li class='rt-store'").slice(1);
const txt = (re, x) => { const m = x.match(re); return m ? m[1].replace(/\s+/g, ' ').trim() : null; };
const CAP = /(\d{5}),\s*([^,<]+)$/;
const out = [];
for (const it of items) {
  const tipo = txt(/rt-store__type'>([^<]+)</, it);
  const nome = txt(/rt-store__name'>([^<]+)</, it);
  const ind = txt(/rt-store__address'>([^<]+)</, it);
  const tel = txt(/href= 'tel:([^']+)'/, it);
  if (!tipo || !/multibrand/i.test(tipo) || !ind) continue;
  const m = ind.match(CAP); if (!m) continue; // solo indirizzi italiani con CAP
  const citta = m[2].trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
  let n = nome.replace(new RegExp(`\\s+${citta}$`, 'i'), '').trim();
  out.push({ nome: n, tipo: 'boutique', citta, paese: 'IT', telefono: tel, fonte_seed: 'stockist:momoni', priorita_tipologia: 1,
    owner_note: `Rivenditore multibrand Momoni (store locator) · ${ind}` });
}
fs.writeFileSync('out/seed_stockist_momoni.json', JSON.stringify(out, null, 1));
const c = {}; for (const r of out) c[r.citta] = (c[r.citta] || 0) + 1;
console.log(out.length, 'rivenditori multibrand in Italia; top citta\':', Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k} ${v}`).join(', '));
