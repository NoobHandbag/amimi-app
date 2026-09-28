// A/B completi senza email commerciale: elenco per cercarne l'email a mano (Facebook, sito). Solo letture.
import { supa } from '../lib.mjs';
import { leggiStato } from '../stato100.mjs';
const sb = await supa();
const { accounts, pronto, buono, ultimo } = await leggiStato(sb);
const L = accounts.filter((a) => buono(a) && !pronto(a)).map((a) => ({ id: a.id, nome: a.nome, citta: a.citta, t: ultimo.get(a.id)?.totale })).sort((x, y) => y.t - x.t);
for (const a of L) console.log(`${a.t}\t${a.id}\t${a.nome} [${a.citta}]`);
