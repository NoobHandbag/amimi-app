// tests/lead_seed_indice.mjs — indice anti-doppioni di workers/lead/seed.mjs e letture paginate del modulo lead_*
//   node tests/lead_seed_indice.mjs
//
// 14-10 (Regola Ferrea 20 b): l'indice di seed.mjs era `select(...)` di tutta lead_accounts senza range e PostgREST
// ne restituiva 1.000 su 6.957 senza errore (cap max-rows): Glitter Ceva, riga 6.504, sarebbe rientrato come nuovo.
// Parte 1, offline: indice.mjs contro un PostgREST finto con lo stesso cap (filtri in/or/ilike/is, count, range).
// Parte 2, sul sorgente come letture_controllate_guardie.mjs: ogni select su una tabella lead_* in workers/lead/ deve
// essere paginata (tutte()) o limitata (range, limit, single, in/eq su una chiave); se torna una select nuda, il test lo dice.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tutte, caricaIndice, creaIndice, filtriCandidati, pattCitta, PAGINA, COLS_INDICE } from '../workers/lead/indice.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 160) : '')); } };
const lancia = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

// ---- PostgREST finto: max-rows tronca SENZA errore, come in produzione ----
const like2re = (p) => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'is');
function parseOr(expr) {
  const parti = []; let cur = '', q = false;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '\\' && q) { cur += expr[++i]; continue; }
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { parti.push(cur); cur = ''; continue; }
    cur += c;
  }
  parti.push(cur);
  return parti.map((p) => {
    const [col, op] = p.split('.', 2), val = p.slice(col.length + op.length + 2);
    if (op === 'ilike') { const re = like2re(val); return (r) => r[col] != null && re.test(r[col]); }
    if (op === 'is' && val === 'null') return (r) => r[col] == null;
    if (op === 'eq') return (r) => r[col] === val;
    throw new Error('filtro non simulato: ' + p);
  });
}
function finto(tabella, { maxRows = 1000, errore = null, senzaCount = false } = {}) {
  const query = [];
  const sb = {
    from: () => {
      const st = { f: [], range: null, count: false, order: null };
      query.push(st);
      const b = {
        select: (_c, o = {}) => { st.count = o.count === 'exact'; return b; },
        in: (col, v) => { st.f.push((r) => v.includes(r[col])); return b; },
        or: (e) => { const fs = parseOr(e); st.f.push((r) => fs.some((f) => f(r))); return b; },
        order: (c) => { st.order = c; return b; },
        range: (a, z) => { st.range = [a, z]; return b; },
        then: (res) => {
          if (errore) return res({ data: null, error: { message: errore }, count: null });
          let rows = tabella.filter((r) => st.f.every((f) => f(r)));
          if (st.order) rows = [...rows].sort((x, y) => String(x[st.order]).localeCompare(String(y[st.order])));
          const n = rows.length;
          rows = st.range ? rows.slice(st.range[0], st.range[1] + 1) : rows;
          return res({ data: rows.slice(0, maxRows), error: null, count: st.count && !senzaCount ? n : null });
        },
      };
      return b;
    },
  };
  return { sb, query };
}

// 2.500 account; i doppioni da riconoscere stanno oltre la riga 1.000
const CITTA = ['Milano', 'Roma', 'Torino', 'Ceva', 'Massa-Carrara', 'Forlì', null];
const DB = Array.from({ length: 2500 }, (_, i) => ({
  id: 'a' + String(i).padStart(5, '0'), nome: `Negozio ${i}`, citta: i % 3 === 0 ? 'Milano' : CITTA[i % CITTA.length],
  website: i % 5 === 0 ? `https://www.negozio${i}.it/` : null, ig_handle: i % 7 === 0 ? `@Negozio_${i}` : null, google_place_id: i % 2 ? `P-${i}` : null,
}));
const metti = (i, r) => { DB[i] = { id: DB[i].id, nome: null, citta: null, website: null, ig_handle: null, google_place_id: null, ...r }; };
metti(2000, { nome: 'Glitter', citta: 'Ceva', ig_handle: 'glitter_ceva' });
metti(1800, { nome: 'MIXMI', citta: 'Milano', website: 'https://www.mixmi.it', ig_handle: '@mixmimilano' });
metti(1900, { nome: 'Indelicatissimo', citta: 'Ferrara', ig_handle: 'Indelicatissimo' });
metti(1700, { nome: 'Mag Boutique', citta: 'Siena', google_place_id: 'P-MAG' });
metti(2100, { nome: 'Eva MASSA', citta: 'Massa-Carrara' });
metti(2200, { nome: 'Bottega Ì', citta: 'Forlì' });
metti(2300, { nome: 'Chapters', citta: null, website: 'https://www.chapterstore.it' });
metti(2400, { nome: 'Rossi, Bianchi & C.', citta: 'Roma', ig_handle: 'a"b%c_d\\e' });
const FILE = [
  { nome: 'Glitter', citta: 'Ceva', ig_handle: 'glitter_ceva', atteso: 'a02000', chiave: 'ig_handle' },
  { nome: 'GLITTER', citta: 'ceva', atteso: 'a02000', chiave: 'nome+citta' },
  { nome: 'Glitter Boutique', citta: 'Torino', ig_handle: '@Glitter_Ceva/', atteso: 'a02000', chiave: 'ig_handle' },
  { nome: 'Mix Mi Store', citta: 'Monza', website: 'www.mixmi.it/shop', atteso: 'a01800', chiave: 'dominio' },
  { nome: 'Indelicatissimo Boutique', citta: 'Bologna', ig_handle: '@indelicatissimo', atteso: 'a01900', chiave: 'ig_handle' },
  { nome: 'Mag Siena', citta: 'Firenze', google_place_id: 'P-MAG', atteso: 'a01700', chiave: 'place_id' },
  { nome: 'Eva Massa', citta: 'Massa Carrara', atteso: 'a02100', chiave: 'nome+citta' },
  { nome: 'Bottega I', citta: 'Forli', atteso: 'a02200', chiave: 'nome+citta' },
  { nome: 'Chapters', citta: '', atteso: 'a02300', chiave: 'nome+citta' },
  { nome: 'Rossi Bianchi C', citta: 'ROMA', atteso: 'a02400', chiave: 'nome+citta' },
  { nome: 'Altro', citta: 'Napoli', ig_handle: 'A"B%C_D\\E', atteso: 'a02400', chiave: 'ig_handle' },
  { nome: 'Negozio Nuovo Inesistente', citta: 'Milano', atteso: null },
];

console.log('\n== il PostgREST finto tronca come quello vero ==');
{
  const { sb } = finto(DB);
  const { data, error } = await sb.from('lead_accounts').select(COLS_INDICE);
  t('select senza range: 1.000 righe su 2.500 e nessun errore (il bug del 14-10)', data.length === 1000 && !error, data.length);
  const vecchio = creaIndice(); for (const a of data) vecchio.add(a);
  const persi = FILE.filter((r) => r.atteso && !vecchio.match(r)).length;
  t('con l\'indice vecchio i doppioni oltre la riga 1.000 passano come nuovi', persi === FILE.filter((r) => r.atteso).length, persi);
}

console.log('\n== tutte(): pagina fino al conteggio esatto ==');
{
  const q = (o) => { const { sb } = finto(DB, o); return () => sb.from('x').select('id', { count: 'exact' }).order('id'); };
  t('cap 1.000: legge 2.500 righe', (await tutte(q())).length === 2500);
  const r300 = await tutte(q({ maxRows: 300 }));
  t('cap 300 (sotto PAGINA): legge comunque 2.500 righe, la pagina corta non e\' la fine', r300.length === 2500 && new Set(r300.map((r) => r.id)).size === 2500, r300.length);
  t('lettura in errore: STOP, nessun default vuoto', /^STOP: .*fallita \(504/.test(await lancia(() => tutte(q({ errore: '504 Gateway Timeout' }))) ?? ''));
  t('select senza count: STOP', /senza conteggio/.test(await lancia(() => tutte(q({ senzaCount: true }))) ?? ''));
  let n = 0; const vuota = () => ({ range: () => Promise.resolve(n++ ? { data: [], error: null, count: 50 } : { data: [{ id: 1 }], error: null, count: 50 }) });
  t('pagina vuota prima del conteggio: STOP "incompleta"', /incompleta \(1 righe su 50\)/.test(await lancia(() => tutte(vuota)) ?? ''));
  t('PAGINA = 1000 (il max-rows di PostgREST)', PAGINA === 1000);
}

console.log('\n== caricaIndice(): solo candidati, ogni lettura paginata ==');
for (const maxRows of [1000, 300]) {
  const { sb, query } = finto(DB, { maxRows });
  const { idx } = await caricaIndice(sb, FILE);
  for (const r of FILE) {
    const h = idx.match(r);
    t(`cap ${maxRows}: ${r.nome} [${r.citta}] -> ${r.atteso ? r.atteso + ' (' + r.chiave + ')' : 'nuovo'}`, r.atteso ? h?.id === r.atteso && h.chiave === r.chiave : h === null, JSON.stringify(h));
  }
  t(`cap ${maxRows}: ogni query ha range, count exact e order`, query.every((s) => s.range && s.count && s.order === 'id'), JSON.stringify(query.find((s) => !(s.range && s.count && s.order))));
  t(`cap ${maxRows}: nessuna query senza filtro`, query.every((s) => s.f.length > 0));
}
{
  const intero = creaIndice(); for (const a of DB) intero.add(a);
  const { sb } = finto(DB);
  const { idx } = await caricaIndice(sb, DB);
  const diversi = DB.filter((a) => idx.match(a)?.chiave !== intero.match(a)?.chiave);
  t('ogni account del DB usato come riga del file trova la stessa chiave dell\'indice completo', diversi.length === 0, JSON.stringify(diversi[0]));
}
{
  const { candidati } = await caricaIndice(finto(DB).sb, [FILE[0]]);
  t(`file di una riga (Glitter, Ceva): legge solo i candidati, ${candidati} su ${DB.length}`, candidati > 0 && candidati < DB.length / 5, candidati);
  const { sb } = finto(DB, { errore: 'JWT expired' });
  t('caricaIndice con lettura fallita: STOP prima di qualunque scrittura', /^STOP: indice lead_accounts/.test(await lancia(() => caricaIndice(sb, FILE)) ?? ''));
  const f = filtriCandidati(Array.from({ length: 95 }, (_, i) => ({ nome: 'x', citta: 'Roma', google_place_id: 'P' + i })));
  t('place_id a blocchi di 40 (URL corte): 95 valori = 3 blocchi', f.place.length === 3 && f.place[2].length === 15, f.place.map((b) => b.length));
  t('citta\' accentata e con trattino: Forli trova Forlì, Massa Carrara trova Massa-Carrara',
    like2re(pattCitta('Forli')).test('Forlì') && like2re(pattCitta('Massa Carrara')).test('Massa-Carrara') && like2re(pattCitta('Forlì')).test('Forli'));
}

// ---- Parte 2: sul sorgente ----
console.log('\n== seed.mjs, indice.mjs, stato100.mjs: frammenti dei fix ==');
const MARKERS = {
  'workers/lead/seed.mjs': [
    "import { caricaIndice, COLS_INDICE } from './indice.mjs';",
    'const { idx, candidati } = await caricaIndice(sb, rows);',
    "const { data: ev, error: evErr } = await sb.from('lead_evidence')",
    'if (evErr) throw new Error(',
    'if (insErr) throw new Error(',
    'const runId = DRY ? null : await startRun(',
  ],
  'workers/lead/indice.mjs': [
    "if (typeof count !== 'number') throw new Error(",
    'if (!data.length) throw new Error(`STOP: ${cosa} incompleta',
    "for (const a of await tutte(() => sb.from('lead_accounts').select(COLS_INDICE, { count: 'exact' }).in('google_place_id', blocco).order('id')",
    "for (const a of await tutte(() => sb.from('lead_accounts').select(COLS_INDICE, { count: 'exact' }).or(blocco.join(',')).order('id')",
  ],
  'workers/lead/stato100.mjs': ["import { tutte } from './indice.mjs';"],
};
for (const [f, snippets] of Object.entries(MARKERS)) {
  const SRC = read(f);
  for (const s of snippets) t(`${f.split('/').pop()}: ${s.slice(0, 100)}`, SRC.includes(s), 'frammento assente');
}
t('stato100.mjs: niente piu\' all() con stop sulla pagina corta', !/async function all\(/.test(read('workers/lead/stato100.mjs')));

// Rilevatore. Una select su lead_* e' accettata se e' dentro tutte() (allora con count exact e order) oppure limitata:
// range, limit, single, maybeSingle, head:true, eq/in su una chiave (id, account_id, google_place_id). Un .in() su
// una colonna di categoria (tipo, stato) NON limita: .in('tipo', [...]) torna migliaia di righe.
const flat = (src) => src.replace(/\)\s*\n\s*\./g, ').');
const LIMITATA = /\.range\(|\.limit\(|\.single\(|\.maybeSingle\(|head: true|\.(eq|in)\('(id|account_id|google_place_id)'/;
function nonLimitate(src) {
  const out = [];
  for (const st of flat(src).split(';')) {
    const pezzi = st.split(/(?=\bsb\.from\(['"]lead_)/);
    for (let i = 1; i < pezzi.length; i++) {
      const q = pezzi[i];
      if (!/\.select\(/.test(q)) continue;
      if (/\btutte\(\s*\(\)\s*=>\s*$/.test(pezzi[i - 1])) {
        if (!/\{ count: 'exact' \}/.test(q) || !/\.order\(/.test(q)) out.push('tutte() senza count exact o order: ' + q.trim());
        continue;
      }
      if (!LIMITATA.test(q)) out.push(q.trim());
    }
  }
  return out;
}
// Costruttori di query che si restringono nelle righe dopo (eq id / in ids / stato + limit): ammessi con motivo.
const AMMESSE = {
  "collect.mjs|sb.from('lead_accounts').select('*').order('created_at')": 'si restringe subito: eq id, in ids, o stato + limit(LIMIT)',
  "judge_digest.mjs|sb.from('lead_accounts').select('*').order('citta').order('created_at')": 'sola lettura per il giudizio: se gli enriched superassero 1.000 il resto resta enriched e next_batch si ferma',
  "judge_dump.mjs|sb.from('lead_accounts').select('*').order('created_at')": 'sola lettura, stesso caso di judge_digest',
};
console.log('\n== workers/lead/*.mjs: nessuna select su lead_* senza range, tutte() o filtro su chiave ==');
const usate = new Set();
for (const f of readdirSync(ROOT + 'workers/lead').filter((x) => x.endsWith('.mjs')).sort()) {
  const trovate = nonLimitate(read('workers/lead/' + f)).filter((q) => { const k = `${f}|${q}`; if (AMMESSE[k]) { usate.add(k); return false; } return true; });
  t(`${f}: select su lead_* tutte limitate o paginate`, trovate.length === 0, trovate[0]);
}
for (const k of Object.keys(AMMESSE)) t(`eccezione ancora necessaria: ${k.split('|')[0]}`, usate.has(k), 'voce superflua in AMMESSE: toglierla');
t('nessun file torna all\'indice vecchio di seed.mjs', !readdirSync(ROOT + 'workers/lead').filter((x) => x.endsWith('.mjs')).some((f) => read('workers/lead/' + f).includes(".from('lead_accounts').select('id,nome,citta,website,ig_handle,google_place_id');")));

console.log('\n== autocontrollo del rilevatore ==');
{
  t('rilevatore: la select vecchia di seed.mjs e\' segnalata', nonLimitate("const { data: existing, error: exErr } = await sb.from('lead_accounts').select('id,nome,citta,website,ig_handle,google_place_id');").length === 1);
  t('rilevatore: .in() su una colonna di categoria e\' segnalato', nonLimitate("const { data } = await sb.from('lead_evidence').select('account_id').in('tipo', ['a', 'b']);").length === 1);
  t('rilevatore: tutte() senza count exact e\' segnalato', nonLimitate("const x = await tutte(() => sb.from('lead_scores').select('id').order('id'), 'x');").length === 1);
  t('rilevatore: tutte() con count exact e order non segnalato', nonLimitate("const x = await tutte(() => sb.from('lead_scores').select('id', { count: 'exact' }).order('id'), 'x');").length === 0);
  t('rilevatore: range su una catena a capo non segnalato', nonLimitate("const { data } = await sb.from('lead_accounts')\n    .select('id')\n    .range(0, 99);").length === 0);
  t('rilevatore: .in() su google_place_id non segnalato', nonLimitate("const { data } = await sb.from('lead_accounts').select('id').in('google_place_id', ids);").length === 0);
  t('rilevatore: insert().select().single() non segnalato', nonLimitate("const { data } = await sb.from('lead_runs').insert({ a: 1 }).select('id').single();").length === 0);
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
