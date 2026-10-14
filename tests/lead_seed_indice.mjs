// tests/lead_seed_indice.mjs — indice anti-doppioni di workers/lead/seed.mjs e letture paginate del modulo lead_*
//   node tests/lead_seed_indice.mjs
//
// 14-10 (Regola Ferrea 20 b): l'indice di seed.mjs era `select(...)` di tutta lead_accounts senza range e PostgREST
// ne restituiva 1.000 su 6.957 senza errore (cap max-rows): Glitter Ceva, riga 6.504, sarebbe rientrato come nuovo.
// Parte 1, offline: indice.mjs contro un PostgREST finto con lo stesso cap (filtri in/or/ilike/is, count, range).
// Parte 2, sul sorgente come letture_controllate_guardie.mjs: ogni select su una tabella lead_* in workers/lead/ deve
// essere paginata (tutte()) o limitata (range, limit, single, in/eq su una chiave); se torna una select nuda, il test lo dice.
// 14-10 sera, omonimi Maps: una riga agganciata solo per nome+citta che e' un'altra scheda Maps lascia `omonimo_maps`
// (mai `fonte`); seed.mjs e judge_digest.mjs girano davvero contro il client finto di lead_letture_errore.mjs.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tutte, caricaIndice, creaIndice, filtriCandidati, pattCitta, PAGINA, COLS_INDICE, serveFonte, votoMaps, omonimoMaps, evidenzaDoppione, servonoSchede, schedeAccount } from '../workers/lead/indice.mjs';

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

console.log('\n== serveFonte(): evidenza fonte solo per una fonte diversa da quella dell\'account (gate 14-10, B2) ==');
{
  const idx = creaIndice(); idx.add({ id: 'X1', nome: 'Glitter', citta: 'Ceva', fonte_seed: 'maps:concept store' });
  const r = { nome: 'Glitter', citta: 'Ceva' }, h = idx.match(r);
  t('match riporta la fonte con cui l\'account e\' nato', h?.id === 'X1' && h.fonte_seed === 'maps:concept store', JSON.stringify(h));
  t('stessa fonte (rilancio del file, secondo sweep con la stessa query): niente evidenza', serveFonte(h, { ...r, fonte_seed: 'maps:concept store' }) === false);
  t('fonte diversa: evidenza', serveFonte(h, { ...r, fonte_seed: 'stockist:momoni' }) === true);
  t('riga senza fonte: niente evidenza', serveFonte(h, r) === false);
  const f = creaIndice(); f.add({ id: 'nuovo#1', nome: 'Uno', citta: 'Roma', fonte_seed: 'maps:boutique donna' });
  t('doppione dentro lo stesso file con la stessa fonte: niente evidenza', serveFonte(f.match({ nome: 'Uno', citta: 'Roma' }), { nome: 'Uno', citta: 'Roma', fonte_seed: 'maps:boutique donna' }) === false);
  t('COLS_INDICE legge anche fonte_seed (serve a serveFonte)', COLS_INDICE.split(',').includes('fonte_seed'), COLS_INDICE);
}

console.log('\n== omonimi Maps: un\'altra scheda con lo stesso nome nella stessa citta\' lascia omonimo_maps, mai fonte ==');
// Figus Designer, Milano (file del 10-09): due schede nello stesso giro, place_id e numeri diversi
const NOTA = (q, v) => `Maps "${q}" Milano${v ? ' · ' + v : ''}`;
const FIG_A = { nome: 'Figus Designer', citta: 'Milano', google_place_id: 'P-FIG-1', fonte_seed: 'maps:negozio borse artigianali', owner_note: NOTA('negozio borse artigianali', '4,8 (50)'), google_maps_url: 'https://maps/fig1' };
const FIG_B = { ...FIG_A, google_place_id: 'P-FIG-2', owner_note: NOTA('negozio borse artigianali', '4,9 (60)'), google_maps_url: 'https://maps/fig2' };
{
  t('votoMaps: voto e recensioni in coda alla nota', votoMaps('Maps "boutique donna" Napoli · Boutique · 4,8 (1.049)') === '4.8|1049' && votoMaps(NOTA('x', '4,5')) === '4.5|', votoMaps('Maps "boutique donna" Napoli · Boutique · 4,8 (1.049)'));
  t('votoMaps: nota Maps senza voto = "-", nota scritta a mano = null', votoMaps(NOTA('x')) === '-' && votoMaps('Benny: rivende Lisa Corti · 4,5 (3)') === null && votoMaps(null) === null);
  const giro = creaIndice(); giro.add({ ...FIG_A, id: 'N1' }, true);
  const h = giro.match(FIG_B);
  t('match riporta place_id, nota e "stesso giro" dell\'account', h?.chiave === 'nome+citta' && h.google_place_id === 'P-FIG-1' && h.owner_note === FIG_A.owner_note && h.stesso_giro === true, JSON.stringify(h));
  const ev = evidenzaDoppione(h, FIG_B);
  t('seconda scheda nello stesso giro, stessa fonte: omonimo_maps per place_id (prima: niente, e prima ancora `fonte`)', ev?.tipo === 'omonimo_maps' && ev.payload.motivo === 'place_id' && serveFonte(h, FIG_B) === false, JSON.stringify(ev));
  t('payload: place_id, nome visto, nota, fonte, link della scheda, motivo', JSON.stringify(ev?.payload) === JSON.stringify({ google_place_id: 'P-FIG-2', google_maps_url: 'https://maps/fig2', nome_visto: 'Figus Designer', nota: FIG_B.owner_note, fonte_seed: FIG_B.fonte_seed, motivo: 'place_id' }), JSON.stringify(ev?.payload));
  t('gia\' presente se c\'e\' un omonimo_maps con lo stesso place_id', JSON.stringify(ev?.cerca) === JSON.stringify({ google_place_id: 'P-FIG-2' }));
  // Tessabit Como: tre schede da tre query; la seconda e la terza erano `fonte` e il negozio sembrava trovato da piu' fonti
  const C = { ...FIG_B, google_place_id: 'P-FIG-3', fonte_seed: 'maps:concept store' };
  t('altra scheda da una fonte diversa: omonimo_maps, non fonte', evidenzaDoppione(giro.match(C), C)?.tipo === 'omonimo_maps');
  const vecchio = creaIndice(); vecchio.add({ ...FIG_A, id: 'V1' });
  t('account di un giro di prima, place_id diverso: omonimo_maps', evidenzaDoppione(vecchio.match(FIG_B), FIG_B)?.payload.motivo === 'place_id' && vecchio.match(FIG_B).stesso_giro === false);
  t('stessa scheda ritrovata (match per place_id) con la stessa fonte: niente (serveFonte)', vecchio.match(FIG_A)?.chiave === 'place_id' && evidenzaDoppione(vecchio.match(FIG_A), FIG_A) === null);
  const altraQuery = { ...FIG_A, fonte_seed: 'maps:concept store', owner_note: NOTA('concept store', '4,8 (52)') };
  t('stessa scheda ritrovata da un\'altra query: fonte, non omonimo', evidenzaDoppione(vecchio.match(altraQuery), altraQuery)?.tipo === 'fonte');
  // sito o handle uguali dicono stesso negozio anche se la scheda e' un'altra (sede diversa dello stesso negozio)
  const sito = creaIndice(); sito.add({ ...FIG_A, id: 'S1', website: 'https://figus.it' });
  const rSito = { ...FIG_B, website: 'figus.it/shop' };
  t('agganciato per dominio (non per nome+citta): mai omonimo', sito.match(rSito)?.chiave === 'dominio' && omonimoMaps(sito.match(rSito), rSito) === null);
  // account nato da una lista (Benny, stockist): niente place_id, nota a mano. Maps che lo ritrova = fonte in piu' vera
  const lista = creaIndice(); lista.add({ id: 'L1', nome: 'Wait and See', citta: 'Milano', fonte_seed: 'manuale', owner_note: 'Scelto da Claude come atteso SI\'' });
  const rLista = { nome: 'Wait and See', citta: 'Milano', google_place_id: 'P-WAIT', fonte_seed: 'maps:concept store', owner_note: NOTA('concept store', '4,3 (149)') };
  t('account senza place_id ne\' nota Maps, ritrovato da Maps: fonte (multi-fonte vera)', evidenzaDoppione(lista.match(rLista), rLista)?.tipo === 'fonte' && omonimoMaps(lista.match(rLista), rLista) === null);
  // gate 14-10 sera, B1: lo stesso account senza place_id da DUE schede Maps (Antonia Milano, due `fonte`): la prima
  // registrata e' la sua scheda, un'altra e' un omonimo
  const hL = lista.match(rLista);
  t('servonoSchede: solo account senza place_id, agganciato per nome+citta da una riga con place_id', servonoSchede(hL, rLista) && !servonoSchede(vecchio.match(FIG_B), FIG_B) && !servonoSchede(hL, { ...rLista, google_place_id: null }));
  const fL = evidenzaDoppione(hL, rLista, schedeAccount([], null));
  t('fonte porta la scheda (place_id e link): per i giri dopo e\' la scheda dell\'account', fL?.tipo === 'fonte' && fL.payload.google_place_id === 'P-WAIT' && 'google_maps_url' in fL.payload, JSON.stringify(fL));
  const sc = schedeAccount([{ tipo: 'fonte', payload: { google_place_id: 'P-WAIT' } }, { tipo: 'fonte', payload: { fonte_seed: 'vecchia' } }, { tipo: 'omonimo_maps', payload: { google_place_id: 'P-ALTRA' } }], { carta: new Set(), omonimi: new Set(['P-GIRO']) });
  t('schedeAccount: place_id delle fonte (la scheda) e degli omonimo_maps, piu\' quelli del giro; le fonte vecchie senza place_id non contano', [...sc.carta].join() === 'P-WAIT' && [...sc.omonimi].sort().join() === 'P-ALTRA,P-GIRO', JSON.stringify([[...sc.carta], [...sc.omonimi]]));
  const r2L = { ...rLista, google_place_id: 'P-WAIT-2', fonte_seed: 'maps:boutique donna' };
  t('seconda scheda per un account senza place_id: omonimo_maps, non una seconda fonte', evidenzaDoppione(hL, r2L, sc)?.tipo === 'omonimo_maps' && evidenzaDoppione(hL, r2L, schedeAccount([], null))?.tipo === 'fonte');
  t('la sua scheda ritrovata da un\'altra query: fonte', evidenzaDoppione(hL, { ...rLista, fonte_seed: 'maps:boutique donna' }, sc)?.tipo === 'fonte');
  t('un omonimo gia\' registrato resta omonimo, non diventa fonte', evidenzaDoppione(hL, { ...rLista, google_place_id: 'P-ALTRA' }, sc)?.tipo === 'omonimo_maps');
  // riga senza place_id: decidono voto e recensioni, solo nello stesso giro
  const senza = (v, f = FIG_A.fonte_seed) => ({ nome: 'Figus Designer', citta: 'Milano', google_place_id: null, fonte_seed: f, owner_note: NOTA('negozio borse artigianali', v) });
  const ev2 = evidenzaDoppione(giro.match(senza('4,9 (60)')), senza('4,9 (60)'));
  t('senza place_id, stesso giro, numeri diversi: omonimo_maps per voto, gia\' presente cercato per nota', ev2?.tipo === 'omonimo_maps' && ev2.payload.motivo === 'voto' && ev2.payload.google_place_id === null && JSON.stringify(ev2.cerca) === JSON.stringify({ nota: senza('4,9 (60)').owner_note }), JSON.stringify(ev2));
  t('senza place_id, stesso giro, nota Maps senza voto contro una con voto: omonimo_maps', evidenzaDoppione(giro.match(senza(null)), senza(null))?.payload.motivo === 'voto');
  t('senza place_id, stesso giro, stessi numeri: stessa scheda, niente', evidenzaDoppione(giro.match(senza('4,8 (50)')), senza('4,8 (50)')) === null);
  t('senza place_id, giro di prima, numeri diversi: incerto (la stessa scheda cambia numeri), niente', omonimoMaps(vecchio.match(senza('4,9 (60)')), senza('4,9 (60)')) === 'incerto' && evidenzaDoppione(vecchio.match(senza('4,9 (60)', 'maps:concept store')), senza('4,9 (60)', 'maps:concept store')) === null);
  t('senza place_id, giro di prima, stessi numeri e fonte diversa: fonte', evidenzaDoppione(vecchio.match(senza('4,8 (50)', 'maps:concept store')), senza('4,8 (50)', 'maps:concept store'))?.tipo === 'fonte');
  t('COLS_INDICE legge anche owner_note (voto e recensioni)', COLS_INDICE.split(',').includes('owner_note'), COLS_INDICE);
  const { idx } = await caricaIndice(finto(DB).sb, [FILE[1]]);
  t('gli account letti dal DB non sono "stesso giro"', idx.match(FILE[1])?.stesso_giro === false, JSON.stringify(idx.match(FILE[1])));
}

// ---- seed.mjs e judge_digest.mjs veri, contro il client finto (tests/lead_finto_hook.mjs) ----
const TMP = mkdtempSync(join(tmpdir(), 'lead-seed-'));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));
let nTmp = 0;
function gira(script, args, tabelle, errori = null, guasti = []) {
  const k = ++nTmp, out = join(TMP, `out${k}.json`), cwd = join(TMP, `cwd${k}`);
  mkdirSync(cwd);
  const env = { ...process.env, SUPABASE_ACCESS_TOKEN: '', LEAD_FINTO: JSON.stringify({ tabelle, out, errori, guasti }) };
  const p = spawnSync(process.execPath, ['--import', new URL('./lead_finto_hook.mjs', import.meta.url).href, join(ROOT, 'workers/lead', script), ...args], { cwd, env, encoding: 'utf8', timeout: 60000 });
  return { code: p.status, testo: `${p.stdout ?? ''}${p.stderr ?? ''}`, scritture: existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : [] };
}
const fileJson = (rows) => { const f = join(TMP, `seed${++nTmp}.json`); writeFileSync(f, JSON.stringify(rows)); return f; };
const insert = (r, tabella) => r.scritture.filter((w) => w.tabella === tabella && w.op === 'insert' && !w.fallita).map((w) => w.riga);

console.log('\n== seed.mjs vero contro il client finto: omonimi, fonti e rilancio ==');
const COMO = (v) => `Maps "${v[0]}" Como · ${v[1]}`;
const DB_SEED = {
  lead_accounts: [
    { id: 'FIG', ...FIG_A, website: null, ig_handle: null },
    { id: 'WAIT', nome: 'Wait and See', citta: 'Milano', website: null, ig_handle: null, google_place_id: null, fonte_seed: 'manuale', owner_note: 'Scelto da Claude come atteso SI\'' },
    { id: 'SIG', nome: 'Signum', citta: 'Firenze', website: null, ig_handle: null, google_place_id: 'P-SIG-1', fonte_seed: 'maps:negozio regali design', owner_note: 'Maps "negozio regali design" Firenze · 4,5 (526)' },
  ],
  lead_evidence: [{ id: 'E1', account_id: 'SIG', tipo: 'omonimo_maps', payload: { google_place_id: 'P-SIG-2', motivo: 'place_id' } }],
};
const SIG = (p, v) => ({ nome: 'Signum', citta: 'Firenze', google_place_id: p, fonte_seed: 'maps:negozio regali design', owner_note: `Maps "negozio regali design" Firenze · ${v}` });
const TES = (p, q, v) => ({ nome: 'Tessabit', citta: 'Como', google_place_id: p, fonte_seed: `maps:${q}`, owner_note: COMO([q, v]), tipo: 'boutique' });
const WAIT_MAPS = { nome: 'Wait and See', citta: 'Milano', google_place_id: 'P-WAIT', fonte_seed: 'maps:concept store', owner_note: NOTA('concept store', '4,3 (149)') };
const RIGHE_SEED = [
  FIG_B, // altra scheda di un account di un giro di prima -> omonimo_maps
  { ...FIG_A, owner_note: NOTA('negozio borse artigianali', '4,8 (51)') }, // stessa scheda, stessa fonte -> niente
  { ...FIG_A, fonte_seed: 'maps:concept store' }, // stessa scheda, altra query -> fonte
  WAIT_MAPS, // account da una lista, ritrovato da Maps -> fonte (col place_id della scheda)
  { ...WAIT_MAPS, google_place_id: 'P-WAIT-2', fonte_seed: 'maps:boutique donna', owner_note: NOTA('boutique donna', '4,5 (64)') }, // seconda scheda dello stesso account -> omonimo_maps (gate, B1)
  SIG('P-SIG-2', '4,5 (296)'), // omonimo gia' registrato -> niente
  SIG('P-SIG-3', '4,7 (53)'), // terza scheda -> omonimo_maps
  TES('P-TES-1', 'concept store', '4,1 (139)'), // nuovo
  TES('P-TES-2', 'boutique donna', '3,8 (10)'), // altra scheda nello stesso giro -> omonimo_maps (place_id)
  TES(null, 'boutique accessori', '3,7 (31)'), // senza place_id, stesso giro, numeri diversi -> omonimo_maps (voto)
];
const f1 = fileJson(RIGHE_SEED);
const r1 = gira('seed.mjs', [f1], DB_SEED);
const ev1 = insert(r1, 'lead_evidence'), acc1 = insert(r1, 'lead_accounts');
const sintesi = (e) => `${e.account_id}:${e.tipo}:${e.payload.google_place_id ?? '-'}:${e.payload.fonte_seed}${e.payload.motivo ? ':' + e.payload.motivo : ''}`;
const TES_ID = 'lead_accounts-finto-1';
{
  t('seed: exit 0, un solo account nuovo (Tessabit)', r1.code === 0 && acc1.length === 1 && acc1[0].nome === 'Tessabit', `exit ${r1.code} ` + r1.testo);
  const attese = ['FIG:omonimo_maps:P-FIG-2:maps:negozio borse artigianali:place_id', 'FIG:fonte:P-FIG-1:maps:concept store', 'WAIT:fonte:P-WAIT:maps:concept store', 'WAIT:omonimo_maps:P-WAIT-2:maps:boutique donna:place_id',
    'SIG:omonimo_maps:P-SIG-3:maps:negozio regali design:place_id', `${TES_ID}:omonimo_maps:P-TES-2:maps:boutique donna:place_id`, `${TES_ID}:omonimo_maps:-:maps:boutique accessori:voto`].join(' | ');
  const viste = ev1.map(sintesi).join(' | ');
  t('seed: 5 omonimo_maps e 2 fonte; nessuna fonte per un\'altra scheda, niente per la stessa scheda o un omonimo gia\' registrato', viste === attese, viste);
  const voto = ev1.find((e) => e.payload.motivo === 'voto');
  t('seed: l\'omonimo senza place_id e\' per voto, con la nota', voto?.payload.google_place_id === null && voto.payload.nota === COMO(['boutique accessori', '3,7 (31)']), JSON.stringify(voto));
  t('seed: ogni evidenza col run del giro e raccolta da script', ev1.every((e) => e.run_id === 'run-finto' && e.raccolto_da === 'script'), JSON.stringify(ev1[0]));
  const fine = r1.scritture.find((w) => w.tabella === 'lead_runs' && w.op === 'update')?.riga;
  // 6 righe riconosciute come omonimi (Signum P-SIG-2 compreso), 5 evidenze scritte (quella di P-SIG-2 c'era gia')
  const omo = fine?.log?.filter((l) => l.evidenza === 'omonimo_maps') ?? [];
  t('seed: il log del giro dice quale evidenza, perche\' e se e\' stata scritta (gate, C2)', omo.length === 6 && omo.filter((l) => l.scritta).length === 5 && omo.find((l) => !l.scritta)?.nome === 'Signum' && fine.log.find((l) => l.motivo === 'voto')?.nome === 'Tessabit', JSON.stringify(fine?.log));
  t('seed: riepilogo con omonimi ed evidenze nuove', /duplicati 9 \(di cui omonimi Maps 6\), evidenze nuove: omonimo_maps 5, fonte 2; err 0 \(su 10\)/.test(r1.testo), r1.testo);
}
{
  // rilancio dello stesso file sul DB dopo il primo giro: nessuna scrittura
  const dopo = {
    lead_accounts: [...DB_SEED.lead_accounts, { id: TES_ID, ...acc1[0], website: null, ig_handle: null }],
    lead_evidence: [...DB_SEED.lead_evidence, ...ev1.map((e, i) => ({ id: `R${i}`, ...e }))],
  };
  const r2 = gira('seed.mjs', [f1], dopo);
  t('rilancio dello stesso file: nessun account e nessuna evidenza nuova', r2.code === 0 && insert(r2, 'lead_accounts').length === 0 && insert(r2, 'lead_evidence').length === 0, JSON.stringify(insert(r2, 'lead_evidence').map(sintesi)) + r2.testo);
  // CASI_APERTI 36 (b): il conteggio degli errori del giro vero
  const k = gira('seed.mjs', [f1], DB_SEED, { 'lead_evidence:insert': { message: '504 Gateway Timeout (finto)' } });
  const fk = k.scritture.find((w) => w.tabella === 'lead_runs' && w.op === 'update')?.riga;
  t('evidenze respinte: 7 righe in errore nel giro (n_err) col motivo, l\'account nuovo inserito (n_ok 1), exit 1', k.code === 1 && fk?.n_err === 7 && fk.n_ok === 1 && fk.log.filter((l) => l.esito === 'err' && /evidenza (omonimo_maps|fonte) non scritta: 504/.test(l.msg)).length === 7 && /err 7 \(su 10\)/.test(k.testo), `exit ${k.code} ` + JSON.stringify(fk) + k.testo);
  const g = gira('seed.mjs', [f1], DB_SEED, null, ['lead_evidence']);
  t('lettura "c\'e\' gia\'?" in errore: la riga va in errore e niente evidenza alla cieca', g.code === 1 && insert(g, 'lead_evidence').length === 0 && /ERR Figus Designer evidenze omonimo_maps non leggibili \(504/.test(g.testo), `exit ${g.code} ` + g.testo);
  const d = gira('seed.mjs', [f1, '--dry'], DB_SEED);
  t('--dry: dice quale evidenza scriverebbe e non scrive niente', d.code === 0 && d.scritture.length === 0 && /DUP {4}Figus Designer \[Milano\] -> FIG \(nome\+citta\) \+ omonimo_maps \(place_id\)/.test(d.testo) && /DUP {4}Tessabit \[Como\] -> nuovo#8 \(nome\+citta\) \+ omonimo_maps \(voto\)/.test(d.testo), d.testo);
  // gate 14-10 sera, C2: la prova legge se l'evidenza c'e' gia' e conta le stesse del giro vero
  t('--dry: un omonimo gia\' registrato e\' "gia\' presente", non "da scrivere"', /DUP {4}Signum \[Firenze\] -> SIG \(nome\+citta\) = omonimo_maps \(place_id\) gia' presente/.test(d.testo) && (d.testo.match(/ \+ (omonimo_maps|fonte)/g) ?? []).length === 7 && /evidenze da scrivere: omonimo_maps 5, fonte 2; err 0/.test(d.testo), d.testo);
}

console.log('\n== judge_digest.mjs: gli omonimi davanti al giudizio ==');
{
  const tabelle = { lead_accounts: [{ ...DB_SEED.lead_accounts[2], stato_ricerca: 'enriched', tipo: 'boutique' }], lead_evidence: [{ id: 'aaaaaaaa-1', account_id: 'SIG', tipo: 'omonimo_maps', payload: { google_place_id: 'P-SIG-2', motivo: 'place_id', nota: 'Maps "negozio regali design" Firenze · 4,5 (296)' }, captured_at: '2026-10-01' }, { id: 'bbbbbbbb-2', account_id: 'SIG', tipo: 'omonimo_maps', payload: { nota: 'Maps "negozio regali design" Firenze · 4,7 (53)' }, captured_at: '2026-10-02' }] };
  const r = gira('judge_digest.mjs', ['--id', 'SIG'], tabelle);
  t('digest: tutti gli omonimi (non solo l\'ultimo), con id evidenza e cosa vuol dire', r.code === 0 && /\[omonimi_maps 2\] aaaaaaaa place_id place=P-SIG-2 .*4,5 \(296\) ; bbbbbbbb - place=- .*4,7 \(53\) -> altra scheda Maps con lo stesso nome: seconda sede \(bonus gruppo\), catena o monomarca \(esclusione\), scheda doppia allo stesso indirizzo/.test(r.testo), r.testo);
  const s = gira('judge_digest.mjs', ['--id', 'SIG'], { ...tabelle, lead_evidence: [] });
  t('digest: senza omonimi nessuna riga', s.code === 0 && !/omonimi_maps/.test(s.testo), s.testo);
}

// ---- Parte 2: sul sorgente ----
console.log('\n== seed.mjs, indice.mjs, stato100.mjs: frammenti dei fix ==');
const MARKERS = {
  'workers/lead/seed.mjs': [
    "import { caricaIndice, COLS_INDICE, evidenzaDoppione, servonoSchede, schedeAccount } from './indice.mjs';",
    'const { idx, candidati } = await caricaIndice(sb, rows);',
    'const ev = evidenzaDoppione(hit, r, schede);',
    'if (servonoSchede(hit, r)) {',
    "const { data: viste, error: vsErr } = await sb.from('lead_evidence').select('tipo,payload').eq('account_id', hit.id).in('tipo', ['fonte', 'omonimo_maps']);",
    'if (vsErr) throw new Error(',
    'if (!presente && !DRY) {',
    "const { data: gia, error: evErr } = await sb.from('lead_evidence').select('id').eq('account_id', hit.id).eq('tipo', ev.tipo).contains('payload', ev.cerca).limit(1);",
    "insert({ account_id: hit.id, run_id: runId, tipo: ev.tipo, payload: ev.payload, raccolto_da: 'script' })",
    'inserted++; idx.add(data, true);',
    "inserted++; idx.add({ ...r, id: `nuovo#${i + 1}` }, true);",
    'if (err) process.exitCode = 1;',
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
