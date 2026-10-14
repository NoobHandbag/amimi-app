// Client supabase finto per tests/lead_letture_errore.mjs, al posto di workers/lead/lib.mjs (via lead_finto_hook.mjs).
// Config in LEAD_FINTO (JSON): { tabelle: { <tabella>: [righe] }, guasti: [<tabella>], out: <file> }.
// Una select su una tabella in `guasti` torna { data: null, error } come PostgREST in 504. Insert e update non vanno da
// nessuna parte: si registrano in `out` all'uscita del processo e il test controlla cosa lo script avrebbe scritto.
import { writeFileSync } from 'node:fs';

const cfg = JSON.parse(process.env.LEAD_FINTO || '{}');
const scritture = [];
process.on('exit', () => { if (cfg.out) writeFileSync(cfg.out, JSON.stringify(scritture)); });

export const BUCKET = 'lead-assets';

function esegui(tabella, st) {
  if (st.op !== 'select') {
    scritture.push({ tabella, op: st.op, riga: st.riga, eq: st.eq });
    return { data: st.op === 'insert' && tabella === 'lead_runs' ? { id: 'run-finto' } : null, error: null };
  }
  if ((cfg.guasti ?? []).includes(tabella)) return { data: null, error: { message: '504 Gateway Timeout (finto)' } };
  const righe = (cfg.tabelle?.[tabella] ?? []).filter((x) => st.filtri.every((f) => f(x)));
  if (!st.single) return { data: righe, error: null };
  return righe.length === 1 ? { data: righe[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
}

function client() {
  return {
    from(tabella) {
      const st = { op: 'select', riga: null, filtri: [], eq: {}, single: false };
      const b = {
        select: () => b,
        insert: (riga) => { st.op = 'insert'; st.riga = riga; return b; },
        update: (riga) => { st.op = 'update'; st.riga = riga; return b; },
        eq: (c, v) => { st.eq[c] = v; st.filtri.push((x) => x[c] === v); return b; },
        in: (c, v) => { st.filtri.push((x) => v.includes(x[c])); return b; },
        contains: () => b, order: () => b, limit: () => b,
        single: () => { st.single = true; return b; },
        then: (res, rej) => Promise.resolve(esegui(tabella, st)).then(res, rej),
      };
      return b;
    },
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: 'storage finto' } }) }) },
  };
}

export async function supa() { return client(); }

// stesse firme e stessa semantica di workers/lead/lib.mjs
export async function startRun(sb, fase, n_input, note) {
  const { data, error } = await sb.from('lead_runs').insert({ fase, n_input, note }).select('id').single();
  if (error) throw error;
  return data.id;
}
export async function endRun(sb, id, { n_ok, n_err, log }) {
  await sb.from('lead_runs').update({ ended_at: new Date().toISOString(), n_ok, n_err, log }).eq('id', id);
}
