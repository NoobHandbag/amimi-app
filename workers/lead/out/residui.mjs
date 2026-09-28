// Candidati residui delle shortlist (ancora in stato seed), con filtro nome extra, per citta'.
import { readFileSync } from 'node:fs';
import { supa } from '../lib.mjs';
const NO = /sport|curvy|sposa|cerimonia|uomo|men\b|kids|bimb|bambin|vintage|usato|second|outlet|stock|ingrosso|pelle|leather|cuoio|gioiell|bijou|argent|orolog|ottica|profum|erbor|arred|casa|home|design|regal|souvenir|intimo|lingerie|calzat|scarpe|shoes|sneak|tattoo|dischi|record|libr|caff|bar\b|ristor|pizz|gelat|luxury|lusso|firme|max&co|pinko|liu jo|twinset|guess|elisabetta franchi|motivi|oltre|camomilla|vestopazzo|yamamay|carpisa|piazza italia|kiko|desigual|marella|pennyblack|nara|kasanova|tezenis|calzedonia|intimissimi|benetton|sisley|zara|h&m|mango|ovs|coin|stefanel|nuna lie|charget|amelie|kali\b|atelier em|diffusion|custom|personalizz|gadget|stampa|t-shirt/i;
const files = ['shortlist_italia2.json', 'shortlist_italia.json', 'shortlist_citta.json'];
const L = files.flatMap((f) => JSON.parse(readFileSync('out/' + f, 'utf8')));
const uniq = [...new Map(L.map((a) => [a.id, a])).values()].filter((a) => !NO.test(a.nome) && (a.rec ?? 0) >= 10);
const sb = await supa();
const seed = new Set();
for (let i = 0; i < uniq.length; i += 200) { const { data } = await sb.from('lead_accounts').select('id,stato_ricerca').in('id', uniq.slice(i, i + 200).map((a) => a.id)); data.filter((a) => a.stato_ricerca === 'seed').forEach((a) => seed.add(a.id)); }
const R = uniq.filter((a) => seed.has(a.id));
const by = {}; for (const a of R) (by[a.citta] ??= []).push(a);
console.log('residui', R.length);
const W = process.argv[2] ? process.argv[2].split(',') : Object.keys(by);
for (const c of W) if (by[c]) console.log(c + ': ' + by[c].slice(0, 25).map((a) => `${a.id.slice(0, 8)}:${a.nome.slice(0, 26)}(${a.rec})`).join(' | '));
