// Scrive cio' che la SESSIONE Claude ha raccolto a mano per il protocollo del pilota (stadi C2 fallback, C4, F):
// evidenze con raccolto_da='sessione' e persone in lead_contacts. Append-only; un contatto con la stessa email
// (o lo stesso nome se senza email) sullo stesso account non si duplica: lo controlla la lettura qui sotto e, dalla
// migr 0157, lo garantiscono gli indici unici a DB (Regola Ferrea 20), il cui 23505 vale "gia presente".
// Formato: { "evidence": [{ account_id, tipo, payload, note }], "contacts": [{ account_id, nome, ruolo, email, telefono, linkedin_url, fonte, note }] }
// Regole: email solo se pubblicata dal negozio/persona; un'email dedotta va in `note` con [DA VERIFICARE], mai in `email`.
// Uso: node session_write.mjs out/sessione_<ts>.json
// Righe in errore (gate 14-10, B3): finiscono in <file>.errori.json accanto all'input e lo script esce con 1. Le altre
// sono gia' in DB: si rilancia SOLO il file errori, perche' lead_evidence non ha una chiave e un rilancio del file intero
// duplicherebbe le evidenze gia' scritte.
import { readFileSync, writeFileSync } from 'node:fs';
import { supa, startRun, endRun } from './lib.mjs';

const file = process.argv[2]; if (!file) { console.error('uso: node session_write.mjs <file.json>'); process.exit(1); }
const { evidence = [], contacts = [] } = JSON.parse(readFileSync(file, 'utf8'));
const sb = await supa();
const runId = await startRun(sb, 'sessione', evidence.length + contacts.length, `stadi C2/C4/F da ${file}`);
let ok = 0, err = 0; const log = [];
const evKo = [], contattiKo = [];
for (const e of evidence) {
  const { error } = await sb.from('lead_evidence').insert({ account_id: e.account_id, run_id: runId, tipo: e.tipo, payload: e.payload ?? null, raccolto_da: 'sessione', note: e.note ?? null });
  if (error) { err++; evKo.push(e); log.push({ ev: e.tipo, account_id: e.account_id, err: error.message }); console.log('ERR ev', e.tipo, error.message); } else ok++;
}
for (const c of contacts) {
  const { data: cur, error: curErr } = await sb.from('lead_contacts').select('id,nome,email').eq('account_id', c.account_id);
  if (curErr) { err++; contattiKo.push(c); log.push({ contatto: c.nome ?? c.email, err: `contatti esistenti non leggibili (${curErr.message}): contatto non scritto` }); console.log('ERR contatto', c.nome ?? c.email, curErr.message); continue; }
  // email senza spazi ai bordi e '' = nessuna email: la stessa chiave per il confronto qui sotto e per l'indice a DB
  // (un '' scritto com'era finiva nell'indice email e due persone senza email collidevano fra loro)
  const email = c.email?.trim() || null;
  const same = cur.find((x) => (email && x.email?.toLowerCase() === email.toLowerCase()) || (!email && c.nome && x.nome?.toLowerCase() === c.nome.toLowerCase()));
  if (same) { log.push({ contatto: c.nome ?? email, esito: 'gia presente' }); continue; }
  const { error } = await sb.from('lead_contacts').insert({ account_id: c.account_id, nome: c.nome ?? null, ruolo: c.ruolo ?? null, email, telefono: c.telefono ?? null, linkedin_url: c.linkedin_url ?? null, fonte: c.fonte ?? null, note: c.note ?? null, chi: 'claude-code' });
  // 23505: l'indice unico ha visto lo stesso contatto, scritto da un'altra sessione fra la lettura e l'insert
  if (error?.code === '23505') { log.push({ contatto: c.nome ?? email, esito: 'gia presente', da: `indice unico (${error.message})` }); continue; }
  if (error) { err++; contattiKo.push(c); log.push({ contatto: c.nome ?? c.email, err: error.message }); console.log('ERR contatto', error.message); } else ok++;
}
if (err) {
  const fileKo = file.replace(/(\.json)?$/i, '.errori.json');
  writeFileSync(fileKo, JSON.stringify({ evidence: evKo, contacts: contattiKo }, null, 2));
  console.log(`righe in errore: ${evKo.length} evidenze, ${contattiKo.length} contatti in ${fileKo}. Le altre sono gia' in DB: rilancia solo quel file.`);
}
await endRun(sb, runId, { n_ok: ok, n_err: err, log });
console.log(`sessione: ok ${ok}, err ${err}`);
if (err) process.exitCode = 1;
