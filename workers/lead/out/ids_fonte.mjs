// Id degli account in stato seed per una fonte_seed (es. stockist:momoni), divisi in file giroN_ids.txt da n.
// Esclude gli esteri finiti con una provincia sbagliata (indirizzo senza CAP italiano coerente).
import { writeFileSync } from 'node:fs';
import { supa } from '../lib.mjs';
const [fonte, n, ...giri] = process.argv.slice(2);
const sb = await supa();
const { data } = await sb.from('lead_accounts').select('id,nome,citta,owner_note').eq('fonte_seed', fonte).eq('stato_ricerca', 'seed').order('citta');
const ESTERO = /LLORET|GIRONA|NOGENT|OLONNE|PARIS|FRANCE|ESPA|\bES\b/i;
const ok = data.filter((a) => !ESTERO.test(`${a.nome} ${a.citta} ${a.owner_note}`) && a.citta !== 'Frosinone' && a.citta !== 'ES');
console.log(data.length, '->', ok.length, ok.map((a) => `${a.nome} [${a.citta}]`).join(' | '));
const k = Number(n);
giri.forEach((g, i) => writeFileSync(`out/giro${g}_ids.txt`, ok.slice(i * k, (i + 1) * k).map((a) => a.id).join(',')));
