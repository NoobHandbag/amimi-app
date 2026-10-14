// Client supabase finto per tests/lead_letture_errore.mjs, al posto di workers/lead/lib.mjs (via lead_finto_hook.mjs).
// Tutto il resto (startRun, endRun, evidence, upload, costanti) e' la lib VERA: il test prova il suo codice, non una copia.
// Config in LEAD_FINTO (JSON): { tabelle: { <tabella>: [righe] }, guasti: [<tabella>], errori: { '<tabella>:<op>': error },
// out: <file> }. Una select su una tabella in `guasti` torna { data: null, error } come PostgREST in 504; una scrittura
// con la sua chiave in `errori` torna quell'error (es. { code: '23505' }). Insert e update non vanno da nessuna parte:
// si registrano in `out` all'uscita del processo (fallita: true se respinte) e il test controlla cosa lo script ha scritto.
import { writeFileSync } from 'node:fs';

export * from '../workers/lead/lib.mjs';

const cfg = JSON.parse(process.env.LEAD_FINTO || '{}');
const scritture = [];
process.on('exit', () => { if (cfg.out) writeFileSync(cfg.out, JSON.stringify(scritture)); });

function esegui(tabella, st) {
  if (st.op !== 'select') {
    const error = cfg.errori?.[`${tabella}:${st.op}`] ?? null;
    scritture.push({ tabella, op: st.op, riga: st.riga, eq: st.eq, ...(error ? { fallita: true } : {}) });
    if (error) return { data: null, error };
    return { data: st.op === 'insert' && tabella === 'lead_runs' ? { id: 'run-finto' } : null, error: null };
  }
  if ((cfg.guasti ?? []).includes(tabella)) return { data: null, error: { message: '504 Gateway Timeout (finto)' } };
  const righe = (cfg.tabelle?.[tabella] ?? []).filter((x) => st.filtri.every((f) => f(x)));
  if (st.ordine) righe.sort((x, y) => String(x[st.ordine.c] ?? '').localeCompare(String(y[st.ordine.c] ?? '')) * (st.ordine.desc ? -1 : 1));
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
        // contains() non e' simulato: un test che ne dipende deve fallire qui, non passare con un filtro ignorato
        contains: () => { throw new Error('contains() non simulato in tests/lead_finto_lib.mjs'); },
        order: (c, o = {}) => { st.ordine = { c, desc: o.ascending === false }; return b; },
        limit: () => b,
        single: () => { st.single = true; return b; },
        then: (res, rej) => Promise.resolve(esegui(tabella, st)).then(res, rej),
      };
      return b;
    },
    storage: { from: () => ({
      download: async () => ({ data: null, error: { message: 'storage finto' } }),
      upload: async (path) => { scritture.push({ tabella: 'storage', op: 'upload', riga: { path } }); return { data: { path }, error: null }; },
    }) },
  };
}

export async function supa() { return client(); }
