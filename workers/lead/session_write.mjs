// Scrive cio' che la SESSIONE Claude ha raccolto a mano per il protocollo del pilota (stadi C2 fallback, C4, F):
// evidenze con raccolto_da='sessione' e persone in lead_contacts. Append-only; un contatto con la stessa email
// (o lo stesso nome se senza email) sullo stesso account non si duplica.
// Formato: { "evidence": [{ account_id, tipo, payload, note }], "contacts": [{ account_id, nome, ruolo, email, telefono, linkedin_url, fonte, note }] }
// Regole: email solo se pubblicata dal negozio/persona; un'email dedotta va in `note` con [DA VERIFICARE], mai in `email`.
// Uso: node session_write.mjs out/sessione_<ts>.json
import { readFileSync } from 'node:fs';
import { supa, startRun, endRun } from './lib.mjs';

const file = process.argv[2]; if (!file) { console.error('uso: node session_write.mjs <file.json>'); process.exit(1); }
const { evidence = [], contacts = [] } = JSON.parse(readFileSync(file, 'utf8'));
const sb = await supa();
const runId = await startRun(sb, 'sessione', evidence.length + contacts.length, `stadi C2/C4/F da ${file}`);
let ok = 0, err = 0; const log = [];
for (const e of evidence) {
  const { error } = await sb.from('lead_evidence').insert({ account_id: e.account_id, run_id: runId, tipo: e.tipo, payload: e.payload ?? null, raccolto_da: 'sessione', note: e.note ?? null });
  if (error) { err++; log.push({ ev: e.tipo, account_id: e.account_id, err: error.message }); console.log('ERR ev', e.tipo, error.message); } else ok++;
}
for (const c of contacts) {
  const { data: cur } = await sb.from('lead_contacts').select('id,nome,email').eq('account_id', c.account_id);
  const same = (cur ?? []).find((x) => (c.email && x.email?.toLowerCase() === c.email.toLowerCase()) || (!c.email && c.nome && x.nome?.toLowerCase() === c.nome.toLowerCase()));
  if (same) { log.push({ contatto: c.nome ?? c.email, esito: 'gia presente' }); continue; }
  const { error } = await sb.from('lead_contacts').insert({ account_id: c.account_id, nome: c.nome ?? null, ruolo: c.ruolo ?? null, email: c.email ?? null, telefono: c.telefono ?? null, linkedin_url: c.linkedin_url ?? null, fonte: c.fonte ?? null, note: c.note ?? null, chi: 'claude-code' });
  if (error) { err++; log.push({ contatto: c.nome ?? c.email, err: error.message }); console.log('ERR contatto', error.message); } else ok++;
}
await endRun(sb, runId, { n_ok: ok, n_err: err, log });
console.log(`sessione: ok ${ok}, err ${err}`);
