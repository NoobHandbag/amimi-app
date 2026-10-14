// Client supabase finto per tests/lead_letture_errore.mjs, al posto di workers/lead/lib.mjs (via lead_finto_hook.mjs).
// Tutto il resto (startRun, endRun, evidence, upload, costanti) e' la lib VERA: il test prova il suo codice, non una copia.
// Config in LEAD_FINTO (JSON): { tabelle: { <tabella>: [righe] }, guasti: [<tabella>], errori: { '<tabella>:<op>': error },
// out: <file> }. Una select su una tabella in `guasti` torna { data: null, error } come PostgREST in 504; una scrittura
// con la sua chiave in `errori` torna quell'error (es. { code: '23505' }). Insert e update non vanno da nessuna parte:
// si registrano in `out` all'uscita del processo (fallita: true se respinte) e il test controlla cosa lo script ha scritto.
// Filtri simulati (dal 14-10 anche quelli dell'indice di seed.mjs): eq, in, or (ilike, is.null, eq), contains (jsonb a
// un livello, valori scalari), order, range, limit, count exact. select(colonne) restituisce SOLO quelle colonne, anche
// dopo un insert: insert().select(cols).single() torna la riga con un id finto ridotta a cols, un insert senza select
// torna data null come supabase-js. Un metodo o un filtro che il finto non conosce rompe lo script: niente ignorato.
import { writeFileSync } from 'node:fs';

export * from '../workers/lead/lib.mjs';
// le pause fra un profilo e l'altro (15-25 s dopo lo stadio IG di collect.mjs) non servono offline
export const sleep = async () => {};

const cfg = JSON.parse(process.env.LEAD_FINTO || '{}');
const scritture = [];
process.on('exit', () => { if (cfg.out) writeFileSync(cfg.out, JSON.stringify(scritture)); });

// .or('col.ilike."patt",col.is.null,col.eq.""') come lo scrive indice.mjs (filtriCandidati)
const like = (p) => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'is');
function filtroOr(expr) {
  const parti = []; let cur = '', q = false;
  for (const c of expr) { if (c === '"') { q = !q; continue; } if (c === ',' && !q) { parti.push(cur); cur = ''; continue; } cur += c; }
  parti.push(cur);
  const fs = parti.map((p) => {
    const [col, op] = p.split('.', 2), val = p.slice(col.length + op.length + 2);
    if (op === 'ilike') { const re = like(val); return (x) => x[col] != null && re.test(x[col]); }
    if (op === 'is' && val === 'null') return (x) => x[col] == null;
    if (op === 'eq') return (x) => String(x[col] ?? '') === val && x[col] != null;
    throw new Error(`filtro or() non simulato in tests/lead_finto_lib.mjs: ${p}`);
  });
  return (x) => fs.some((f) => f(x));
}
// payload @> valore, a un livello: un valore annidato (oggetto o array) non e' simulato e rompe lo script
function filtroContains(c, sotto) {
  for (const [k, w] of Object.entries(sotto)) if (w !== null && typeof w === 'object') throw new Error(`contains() con valore annidato (${k}) non simulato in tests/lead_finto_lib.mjs`);
  return (x) => x[c] != null && typeof x[c] === 'object' && Object.entries(sotto).every(([k, w]) => x[c][k] === w);
}
// select('a,b') -> solo a e b (null se la riga non le ha); '*' o niente -> tutta la riga
const proietta = (x, cols) => (cols == null || cols.trim() === '*' ? x : Object.fromEntries(cols.split(',').map((k) => k.trim()).map((k) => [k, x[k] ?? null])));

let nIns = 0;
function esegui(tabella, st) {
  if (st.op !== 'select') {
    const error = cfg.errori?.[`${tabella}:${st.op}`] ?? null;
    scritture.push({ tabella, op: st.op, riga: st.riga, eq: st.eq, ...(error ? { fallita: true } : {}) });
    if (error) return { data: null, error };
    if (st.op !== 'insert' || st.ritorna === undefined) return { data: null, error: null };
    const riga = proietta(tabella === 'lead_runs' ? { id: 'run-finto', ...st.riga } : { id: `${tabella}-finto-${++nIns}`, ...st.riga }, st.ritorna);
    return { data: st.single ? riga : [riga], error: null };
  }
  if ((cfg.guasti ?? []).includes(tabella)) return { data: null, error: { message: '504 Gateway Timeout (finto)' } };
  let righe = (cfg.tabelle?.[tabella] ?? []).filter((x) => st.filtri.every((f) => f(x)));
  if (st.ordine) righe.sort((x, y) => String(x[st.ordine.c] ?? '').localeCompare(String(y[st.ordine.c] ?? '')) * (st.ordine.desc ? -1 : 1));
  const count = st.count ? righe.length : null;
  if (st.range) righe = righe.slice(st.range[0], st.range[1] + 1);
  if (st.limit != null) righe = righe.slice(0, st.limit);
  righe = righe.map((x) => proietta(x, st.cols));
  if (!st.single) return { data: righe, error: null, count };
  return righe.length === 1 ? { data: righe[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
}

function client() {
  return {
    from(tabella) {
      const st = { op: 'select', riga: null, filtri: [], eq: {}, single: false };
      const b = {
        select: (c, o = {}) => {
          if (o.head) throw new Error('select(..., { head: true }) non simulato in tests/lead_finto_lib.mjs');
          if (st.op === 'insert') st.ritorna = c ?? '*'; else st.cols = c;
          st.count = o.count === 'exact'; return b;
        },
        insert: (riga) => { st.op = 'insert'; st.riga = riga; return b; },
        update: (riga) => { st.op = 'update'; st.riga = riga; return b; },
        eq: (c, v) => { st.eq[c] = v; st.filtri.push((x) => x[c] === v); return b; },
        in: (c, v) => { st.filtri.push((x) => v.includes(x[c])); return b; },
        or: (e) => { st.filtri.push(filtroOr(e)); return b; },
        contains: (c, v) => { st.filtri.push(filtroContains(c, v)); return b; },
        order: (c, o = {}) => { st.ordine = { c, desc: o.ascending === false }; return b; },
        range: (da, a) => { st.range = [da, a]; return b; },
        limit: (n) => { st.limit = n; return b; },
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
