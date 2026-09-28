// Shortlist dello sweep per quartieri e medie citta' del 27-09 (seed_maps_italia2_norm.json): stessi filtri per nome
// delle altre shortlist, solo seed ancora in stato 'seed', ordinati per recensioni. Stampa compatta per citta'.
import { readFileSync, writeFileSync } from 'node:fs';
import { supa } from '../lib.mjs';
import { parseMapsNote } from '../priority.mjs';
const places = [...new Set(JSON.parse(readFileSync('out/seed_maps_italia4.json', 'utf8')).map((r) => r.google_place_id).filter(Boolean))];
const src = readFileSync('out/shortlist_milano.mjs', 'utf8');
const NOME_NO = eval(src.match(/const NOME_NO = (\/.*\/i);/)[1]);
const NOME_NO2 = /gioiell|bijou|bigiott|argent|orolog|ottica|profum|erboristeria|arredo|casa\b|home|design store|regali|bomboniere|cartoleria|giocattol|lingerie|intimo|calzature|scarpe|sport|curvy|ingrosso|stock|outlet|pelle|leather|cuoio|souvenir|luxury|uomo|jeans|max&co|vestopazzo|libero milano|camomilla|motivi|oltre\b|carpisa|yamamay|nuna lie|charget|maliparmi|pennyblack|elena mir|marella|sandro|maje|desigual|kiko|tezenis|diffusione tessile/i;
const sb = await supa();
let all = [];
for (let i = 0; i < places.length; i += 200) {
  const { data } = await sb.from('lead_accounts').select('id,nome,citta,fonte_seed,owner_note,stato_ricerca').in('google_place_id', places.slice(i, i + 200));
  all = all.concat(data);
}
const rows = all
  .filter((a) => a.stato_ricerca === 'seed' && !NOME_NO.test(a.nome) && !NOME_NO2.test(a.nome))
  .map((a) => { const m = parseMapsNote(a.owner_note); return { id: a.id, nome: a.nome, citta: a.citta, q: (a.owner_note.match(/"([^"]+)"/) || [])[1] || '', rating: m.rating, rec: m.rec }; })
  .filter((a) => (a.rating ?? 0) >= 4.3 && (a.rec ?? 0) >= 5);
rows.sort((x, y) => (y.rec ?? 0) - (x.rec ?? 0));
writeFileSync('out/shortlist_italia4.json', JSON.stringify(rows, null, 1));
const by = {}; rows.forEach((a, i) => (by[a.citta] ??= []).push(`${i}:${a.nome.slice(0, 30)}(${a.rec})`));
console.log(`seed ${all.length}, shortlist ${rows.length}`);
for (const c in by) console.log(c + ': ' + by[c].slice(0, 30).join(' | '));
