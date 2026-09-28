// Lista per il triage dei seed delle grandi citta' (fase 200): stesse esclusioni per nome della shortlist di Milano,
// solo query concept store / boutique, esclusi i seed gia' saltati al triage del loop 100. Ordina per segnale Maps.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { supa } from '../lib.mjs';
import { parseMapsNote } from '../priority.mjs';
const CITTA = ['Firenze', 'Bologna', 'Torino', 'Roma', 'Venezia', 'Verona', 'Genova', 'Modena', 'Bergamo', 'Brescia', 'Como', 'Monza', 'Varese', 'Pavia'];
const skip = new Set(existsSync('out/triage_skip.json') ? JSON.parse(readFileSync('out/triage_skip.json', 'utf8')) : []);
const src = readFileSync('out/shortlist_milano.mjs', 'utf8');
const NOME_NO = eval(src.match(/const NOME_NO = (\/.*\/i);/)[1]);
const NOME_NO2 = /gioiell|bijou|bigiott|argent|orolog|ottica|profum|erboristeria|arredo|casa\b|home|design store|regali|bomboniere|cartoleria|giocattol|lingerie|intimo|calzature|scarpe/i;
const sb = await supa();
let all = [], from = 0;
for (;;) {
  const { data } = await sb.from('lead_accounts').select('id,nome,citta,fonte_seed,owner_note').eq('stato_ricerca', 'seed').in('citta', CITTA).range(from, from + 999);
  all = all.concat(data); if (data.length < 1000) break; from += 1000;
}
const rows = all
  .filter((a) => !skip.has(a.id) && /concept store|boutique/.test(a.fonte_seed ?? '') && !NOME_NO.test(a.nome) && !NOME_NO2.test(a.nome))
  .map((a) => { const m = parseMapsNote(a.owner_note); return { id: a.id, nome: a.nome, citta: a.citta, q: (a.fonte_seed ?? '').replace('maps:', ''), rating: m.rating, rec: m.rec }; })
  .filter((a) => (a.rating ?? 0) >= 4.3);
rows.sort((x, y) => (y.rec ?? 0) - (x.rec ?? 0));
writeFileSync('out/shortlist_citta.json', JSON.stringify(rows, null, 1));
const perCitta = {}; for (const r of rows) perCitta[r.citta] = (perCitta[r.citta] || 0) + 1;
console.log(`seed citta ${all.length}, in shortlist ${rows.length}`, perCitta);
console.log(rows.map((a, i) => `${i}:${a.nome} [${a.citta}|${a.q}] ${a.rating}/${a.rec}`).join(' | '));
