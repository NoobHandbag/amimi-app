// Seed di account in lead_accounts da un file JSON. Idempotente e con dedup multi-chiave.
// Dedup (piano 3.2): google_place_id | dominio del sito | ig_handle | nome normalizzato + citta.
// Un negozio trovato da piu' fonti resta UNO: sull'incontro NON si duplica, si aggiunge una
// evidenza `fonte` con la fonte in piu' (cosi' lo stockist_match / multi-fonte pesa in giudizio).
// Uso: node seed.mjs <file.json>
import { readFileSync } from 'node:fs';
import { supa, startRun, endRun, normName } from './lib.mjs';

const file = process.argv[2];
if (!file) { console.error('uso: node seed.mjs <file.json>'); process.exit(1); }
const rows = JSON.parse(readFileSync(file, 'utf8'));
const sb = await supa();

const domainOf = (u) => { if (!u) return null; try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
const handleOf = (h) => (h ? String(h).replace(/^@/, '').replace(/\/$/, '').toLowerCase().trim() : null);
const nameKey = (r) => `${normName(r.nome)}|${normName(r.citta)}`;

// indice degli account esistenti (una lettura sola)
const { data: existing, error: exErr } = await sb.from('lead_accounts').select('id,nome,citta,website,ig_handle,google_place_id');
if (exErr) throw exErr;
const byPlace = new Map(), byDomain = new Map(), byHandle = new Map(), byName = new Map();
const indexAcc = (a) => {
  if (a.google_place_id) byPlace.set(a.google_place_id, a.id);
  const d = domainOf(a.website); if (d) byDomain.set(d, a.id);
  const h = handleOf(a.ig_handle); if (h) byHandle.set(h, a.id);
  byName.set(`${normName(a.nome)}|${normName(a.citta)}`, a.id);
};
for (const a of existing) indexAcc(a);

const matchId = (r) => {
  if (r.google_place_id && byPlace.has(r.google_place_id)) return byPlace.get(r.google_place_id);
  const d = domainOf(r.website); if (d && byDomain.has(d)) return byDomain.get(d);
  const h = handleOf(r.ig_handle); if (h && byHandle.has(h)) return byHandle.get(h);
  const nk = nameKey(r); if (byName.has(nk)) return byName.get(nk);
  return null;
};

const runId = await startRun(sb, 'import', rows.length, `seed da ${file}`);
let inserted = 0, dup = 0, err = 0; const log = [];
for (const r of rows) {
  try {
    const hit = matchId(r);
    if (hit) {
      dup++;
      // registra la fonte in piu' solo se e' una fonte diversa (evita rumore sui re-run identici)
      if (r.fonte_seed) {
        const { data: ev } = await sb.from('lead_evidence').select('id').eq('account_id', hit).eq('tipo', 'fonte').contains('payload', { fonte_seed: r.fonte_seed }).limit(1);
        if (!ev?.length) await sb.from('lead_evidence').insert({ account_id: hit, run_id: runId, tipo: 'fonte', payload: { fonte_seed: r.fonte_seed, nome_visto: r.nome, nota: r.owner_note ?? null }, raccolto_da: 'script' });
      }
      log.push({ nome: r.nome, esito: 'dup', id: hit, fonte: r.fonte_seed });
      continue;
    }
    const { data, error } = await sb.from('lead_accounts').insert(r).select('id,nome,citta,website,ig_handle,google_place_id').single();
    if (error) { err++; log.push({ nome: r.nome, esito: 'err', msg: error.message }); console.log('ERR', r.nome, error.message); continue; }
    inserted++; indexAcc(data); // così i duplicati dentro lo stesso file si agganciano
    log.push({ nome: r.nome, esito: 'inserito', id: data.id });
  } catch (e) { err++; log.push({ nome: r.nome, esito: 'err', msg: e.message }); console.log('ERR', r.nome, e.message); }
}
await endRun(sb, runId, { n_ok: inserted, n_err: err, log });
console.log(`seed ${file}: inseriti ${inserted}, duplicati ${dup}, err ${err} (su ${rows.length})`);
