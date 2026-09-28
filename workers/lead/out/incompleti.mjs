// Account giudicati con ultimo score A/B ma dati incompleti (3+ criteri null), ordinati per totale: candidati al recupero IG.
import { supa } from '../lib.mjs';
const sb = await supa();
let rows = [];
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from('lead_scores').select('account_id,totale,tier_proposto,dati_incompleti,created_at').order('created_at', { ascending: false }).range(from, from + 999);
  rows = rows.concat(data);
  if (data.length < 1000) break;
}
const last = new Map();
for (const r of rows) if (!last.has(r.account_id)) last.set(r.account_id, r);
const ids = [...last.values()].filter((r) => r.dati_incompleti && ['A', 'B'].includes(r.tier_proposto)).map((r) => r.account_id);
let acc = [];
for (let i = 0; i < ids.length; i += 80) {
  const { data, error } = await sb.from('lead_accounts').select('id,nome,citta,ig_handle,stato_ricerca').in('id', ids.slice(i, i + 80));
  if (error) console.error(error.message); acc = acc.concat(data ?? []);
}
const out = acc.filter((a) => a.stato_ricerca === 'scored').map((a) => ({ ...a, totale: last.get(a.id).totale })).sort((x, y) => y.totale - x.totale);
console.log(out.length);
for (const a of out.slice(0, Number(process.argv[2] || 60))) console.log(`${a.totale}\t${a.id}\t${a.nome} [${a.citta}] ig=${a.ig_handle ?? '-'}`);
