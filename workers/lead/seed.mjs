// Seed di account in lead_accounts da un file JSON. Idempotente: upsert su (lower(nome), lower(citta)).
// Uso: node seed.mjs seed_pilota.json
import { readFileSync } from 'node:fs';
import { supa, startRun, endRun } from './lib.mjs';

const file = process.argv[2];
if (!file) { console.error('uso: node seed.mjs <file.json>'); process.exit(1); }
const rows = JSON.parse(readFileSync(file, 'utf8'));
const sb = await supa();
const runId = await startRun(sb, 'import', rows.length, `seed da ${file}`);
let ok = 0, err = 0; const log = [];
for (const r of rows) {
  const { data: ex } = await sb.from('lead_accounts').select('id').ilike('nome', r.nome).ilike('citta', r.citta ?? '').maybeSingle();
  if (ex) { log.push({ nome: r.nome, esito: 'gia_presente', id: ex.id }); ok++; continue; }
  const { data, error } = await sb.from('lead_accounts').insert(r).select('id').single();
  if (error) { err++; log.push({ nome: r.nome, esito: 'err', msg: error.message }); console.log('ERR', r.nome, error.message); }
  else { ok++; log.push({ nome: r.nome, esito: 'inserito', id: data.id }); console.log('ok', r.nome, data.id); }
}
await endRun(sb, runId, { n_ok: ok, n_err: err, log });
console.log(`seed: ok ${ok}, err ${err}`);
