// Seed di account in lead_accounts da un file JSON. Idempotente e con dedup multi-chiave.
// Dedup (piano 3.2): google_place_id | dominio del sito | ig_handle | nome normalizzato + citta (indice.mjs).
// Un negozio trovato da piu' fonti resta UNO: sull'incontro NON si duplica, si aggiunge una
// evidenza `fonte` con la fonte in piu' (cosi' lo stockist_match / multi-fonte pesa in giudizio).
// Una riga agganciata solo per nome+citta che e' un'altra scheda Maps (omonimo, seconda sede o catena) lascia invece
// un'evidenza `omonimo_maps` (evidenzaDoppione in indice.mjs).
// Uso: node seed.mjs <file.json> [--dry]
//   --dry: costruisce l'indice e stampa riga per riga duplicato (su quale account e chiave, con l'evidenza che
//   scriverebbe) o nuovo. Zero scritture.
import { readFileSync } from 'node:fs';
import { supa, startRun, endRun } from './lib.mjs';
import { caricaIndice, COLS_INDICE, evidenzaDoppione, servonoSchede, schedeAccount } from './indice.mjs';

const file = process.argv[2];
const DRY = process.argv.includes('--dry');
if (!file || file.startsWith('--')) { console.error('uso: node seed.mjs <file.json> [--dry]'); process.exit(1); }
const rows = JSON.parse(readFileSync(file, 'utf8'));
const sb = await supa();

// Indice degli account esistenti (Regola Ferrea 20 b, 14-10): solo i candidati per i valori del file, a blocchi
// paginati fino al conteggio esatto (caricaIndice in indice.mjs). Prima era una select di tutta lead_accounts senza
// range: tornavano 1.000 righe su 6.957 senza errore e un negozio gia' presente rientrava come nuovo.
const { idx, candidati } = await caricaIndice(sb, rows);
console.log(`indice: ${candidati} account candidati letti per ${rows.length} righe del file`);

const runId = DRY ? null : await startRun(sb, 'import', rows.length, `seed da ${file}`);
let inserted = 0, dup = 0, omonimi = 0, err = 0; const log = [], nuove = { omonimo_maps: 0, fonte: 0 };
// decisioni di questo giro: --dry non scrive, e una riga dopo deve vedere quelle di prima come gia' presenti
const decise = new Set(), schedeGiro = new Map();
for (const [i, r] of rows.entries()) {
  try {
    const hit = idx.match(r);
    if (hit) {
      // account senza place_id agganciato da una scheda Maps: la sua scheda e' quella delle sue evidenze (gate, B1)
      let schede = null;
      if (servonoSchede(hit, r)) {
        const { data: viste, error: vsErr } = await sb.from('lead_evidence').select('tipo,payload').eq('account_id', hit.id).in('tipo', ['fonte', 'omonimo_maps']);
        if (vsErr) throw new Error(`schede Maps gia' viste non leggibili (${vsErr.message}): evidenza non scritta`);
        schede = schedeAccount(viste, schedeGiro.get(hit.id));
      }
      // fonte in piu' (solo se diversa da quella dell'account) o omonimo Maps, scritta solo se non c'e' gia'
      // (la lettura gira anche con --dry, cosi' la prova dice cosa scriverebbe davvero: gate, C2)
      const ev = evidenzaDoppione(hit, r, schede);
      let scritta = false;
      if (ev) {
        const k = `${hit.id}|${ev.tipo}|${JSON.stringify(ev.cerca)}`;
        let presente = decise.has(k);
        if (!presente) {
          const { data: gia, error: evErr } = await sb.from('lead_evidence').select('id').eq('account_id', hit.id).eq('tipo', ev.tipo).contains('payload', ev.cerca).limit(1);
          if (evErr) throw new Error(`evidenze ${ev.tipo} non leggibili (${evErr.message}): evidenza non scritta`);
          presente = gia.length > 0;
        }
        // la decisione vale per le righe dopo anche se l'insert fallisce (una riga in errore non cambia le altre)
        decise.add(k);
        if (r.google_place_id) {
          const s = schedeGiro.get(hit.id) ?? { carta: new Set(), omonimi: new Set() };
          (ev.tipo === 'fonte' ? s.carta : s.omonimi).add(r.google_place_id); schedeGiro.set(hit.id, s);
        }
        if (!presente && !DRY) {
          const { error: insErr } = await sb.from('lead_evidence').insert({ account_id: hit.id, run_id: runId, tipo: ev.tipo, payload: ev.payload, raccolto_da: 'script' });
          if (insErr) throw new Error(`evidenza ${ev.tipo} non scritta: ${insErr.message}`);
        }
        scritta = !presente; if (scritta) nuove[ev.tipo]++;
      }
      dup++; if (ev?.tipo === 'omonimo_maps') omonimi++;
      log.push({ nome: r.nome, esito: 'dup', id: hit.id, chiave: hit.chiave, fonte: r.fonte_seed, evidenza: ev?.tipo ?? null, ...(ev?.payload.motivo ? { motivo: ev.payload.motivo } : {}), ...(ev ? { scritta } : {}) });
      if (DRY) console.log(`DUP    ${r.nome} [${r.citta ?? '-'}] -> ${hit.id} (${hit.chiave})${ev ? ` ${scritta ? '+' : '='} ${ev.tipo}${ev.payload.motivo ? ` (${ev.payload.motivo})` : ''}${scritta ? '' : ' gia\' presente'}` : ''}`);
      continue;
    }
    if (DRY) {
      inserted++; idx.add({ ...r, id: `nuovo#${i + 1}` }, true);
      log.push({ nome: r.nome, esito: 'nuovo' });
      console.log(`NUOVO  ${r.nome} [${r.citta ?? '-'}]`);
      continue;
    }
    const { data, error } = await sb.from('lead_accounts').insert(r).select(COLS_INDICE).single();
    if (error) { err++; log.push({ nome: r.nome, esito: 'err', msg: error.message }); console.log('ERR', r.nome, error.message); continue; }
    inserted++; idx.add(data, true); // così i duplicati dentro lo stesso file si agganciano
    log.push({ nome: r.nome, esito: 'inserito', id: data.id });
  } catch (e) { err++; log.push({ nome: r.nome, esito: 'err', msg: e.message }); console.log('ERR', r.nome, e.message); }
}
if (!DRY) await endRun(sb, runId, { n_ok: inserted, n_err: err, log });
console.log(`seed ${file}${DRY ? ' (DRY, nessuna scrittura)' : ''}: ${DRY ? 'da inserire' : 'inseriti'} ${inserted}, duplicati ${dup} (di cui omonimi Maps ${omonimi}), evidenze ${DRY ? 'da scrivere' : 'nuove'}: omonimo_maps ${nuove.omonimo_maps}, fonte ${nuove.fonte}; err ${err} (su ${rows.length})`);
if (err) process.exitCode = 1; // come session_write e judge_write (gate 14-10, C1)
