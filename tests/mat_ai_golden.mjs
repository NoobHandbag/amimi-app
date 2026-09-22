// tests/mat_ai_golden.mjs: test di ACCETTAZIONE dello strato AI "Compila" (edge ai-compila) sul golden set reale.
// Si lancia A MANO, non in CI: chiama Gemini con i documenti veri dei fornitori e confronta i numeri con quelli
// verificati il 22-09 (seed della migr 0140). Prompt e normalizzazione sono ritagliati DAL SORGENTE della edge
// (blocco PURE:ai-compila): quello che passa qui e' quello che gira in produzione.
//   node tests/mat_ai_golden.mjs                 (modello: AI_MODEL, default gemini-flash-lite-latest)
//   AI_MODEL=gemini-flash-latest node tests/mat_ai_golden.mjs
// Chiave: GEMINI_API_KEY nell'ambiente, oppure letta a runtime da app_flags via Management API con SUPABASE_ACCESS_TOKEN
// (come etl/seed_mat.mjs): mai su disco, mai stampata. Documenti: MAT_ASSETS_DIR (default: la cartella inbox di Cowork12).
// Regola 1: un numero proposto dove il documento non lo ha = test ROSSO.
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIR = (process.env.MAT_ASSETS_DIR || 'C:/Users/super/dev/gestionale-ami/Cowork12/_CLAUDE_CODE_INBOX/mat_assets').replace(/\/?$/, '/');
const MODEL = (process.env.AI_MODEL || 'gemini-flash-lite-latest').replace(/[^a-z0-9.\-]/gi, '');
const PROJECT_REF = 'imszbjeyplaiovylhkgl';

const src = readFileSync(`${ROOT}supabase/functions/ai-compila/index.ts`, 'utf8').replace(/\r\n/g, '\n');
const a = src.indexOf('// ==== PURE:ai-compila BEGIN ===='), b = src.indexOf('// ==== PURE:ai-compila END ====');
if (a < 0 || b < 0) { console.error('marcatori PURE:ai-compila non trovati'); process.exit(1); }
const TMP = `${ROOT}tests/_golden.tmp.ts`;
writeFileSync(TMP, `${src.slice(a, b).split('\n').slice(1).join('\n')}\nexport { buildPrompt, normalizza };\n`, 'utf8');
let buildPrompt, normalizza;
try { ({ buildPrompt, normalizza } = await import(pathToFileURL(TMP).href)); } finally { try { unlinkSync(TMP); } catch { /* niente */ } }

async function chiave() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const tok = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (!tok) throw new Error('STOP: serve GEMINI_API_KEY oppure SUPABASE_ACCESS_TOKEN');
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`Management API ${r.status}`);
  const svc = (await r.json()).find((x) => x.name === 'service_role')?.api_key;
  if (!svc) throw new Error('service_role non trovata');
  const q = await fetch(`https://${PROJECT_REF}.supabase.co/rest/v1/app_flags?key=eq.gemini_api_key&select=value`, { headers: { apikey: svc, Authorization: `Bearer ${svc}` } });
  const rows = await q.json();
  const v = rows?.[0]?.value;
  if (!v) throw new Error('gemini_api_key assente in app_flags');
  return v;
}
const mimeDaNome = (n) => /\.pdf$/i.test(n) ? 'application/pdf' : /\.png$/i.test(n) ? 'image/png' : 'image/jpeg';
async function compila(key, target, files, testo, contesto) {
  const parts = [{ text: buildPrompt(target, testo, contesto) }];
  for (const f of files) parts.push({ inlineData: { mimeType: mimeDaNome(f), data: readFileSync(DIR + f).toString('base64') } });
  const t0 = Date.now();
  const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, maxOutputTokens: 8000, responseMimeType: 'application/json' } }),
  });
  const gj = await g.json();
  if (!g.ok) throw new Error(`Gemini ${g.status}: ${JSON.stringify(gj).slice(0, 200)}`);
  const raw = String(gj?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
  return { p: normalizza(target, JSON.parse(raw), contesto), ms: Date.now() - t0, finish: gj?.candidates?.[0]?.finishReason };
}
const near = (x, y, tol = 0.011) => x != null && y != null && Math.abs(Number(x) - Number(y)) <= tol;
const multiset = (xs, ys, tol) => xs.length === ys.length && [...xs].sort((p, q) => p - q).every((v, i) => near(v, [...ys].sort((p, q) => p - q)[i], tol));
const prezzi = (p) => p.righe.map((r) => r.prezzo.v);
const numeriInventati = (p) => p.righe.filter((r) => r.prezzo.v != null || r.importo.v != null || r.quantita.v != null).length + (p.totale_imponibile.v != null ? 1 : 0) + (p.totale_documento.v != null ? 1 : 0);

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 400) : '')); } };
// stesso contesto che manda la PWA: nome corto + ragione sociale (le proforma portano la conceria, non il marchio)
const CTX = { fornitori: [
  { id: 'f-vp', nome: 'Vicenza Pelli', ragione_sociale: 'Conceria San Biagio srl' }, { id: 'f-av', nome: 'Angelo Valera', ragione_sociale: 'Nastrificio Angelo Valera s.r.l.' },
  { id: 'f-mlm', nome: 'MLM Mazzola', ragione_sociale: 'MLM Mazzola s.r.l.' }, { id: 'f-ag', nome: 'Albert Guegain', ragione_sociale: 'Albert Guegain & Fils S.A.' },
  { id: 'f-ego', nome: 'Ego', ragione_sociale: 'EGO srl' }, { id: 'f-dam', nome: 'Damapel', ragione_sociale: 'Damapel s.a.s. di Daniele Kauffmann e C.' },
] };
const casi = [
  { nome: 'FP 496 Vicenza Pelli (4 righe a 66, imponibile 815,10)', files: ['VicenzaPelli_proforma_FP496_2026-07-09.pdf'], testo: '', check: (p) => {
    t('  fornitore = Vicenza Pelli (match)', p.match_fornitore_id === 'f-vp' || /vicenza/i.test(p.fornitore.v ?? ''), p.fornitore.v);
    t('  4 righe', p.righe.length === 4, p.righe.length);
    t('  prezzo 66 su ogni riga', p.righe.every((r) => near(r.prezzo.v, 66)), prezzi(p).join(','));
    t('  quantita 2.44, 5.10, 2.24, 2.57 mq', multiset(p.righe.map((r) => r.quantita.v), [2.44, 5.1, 2.24, 2.57]), p.righe.map((r) => r.quantita.v).join(','));
    t('  importi 161.04, 336.60, 147.84, 169.62', multiset(p.righe.map((r) => r.importo.v), [161.04, 336.6, 147.84, 169.62]), p.righe.map((r) => r.importo.v).join(','));
    t('  totale imponibile 815.10', near(p.totale_imponibile.v, 815.1), p.totale_imponibile.v);
    t('  colori fedeli (Castagno, T.Moro, Black)', p.righe.some((r) => /castagno/i.test(r.colore.v ?? '')) && p.righe.some((r) => /moro/i.test(r.colore.v ?? '')), p.righe.map((r) => r.colore.v).join(','));
  } },
  { nome: 'Proforma 197 Angelo Valera (440 mt a 0,656, sconto 3%, 279,98)', files: ['AngeloValera_proforma_197_2026-09-10.pdf'], testo: '', check: (p) => {
    t('  fornitore Angelo Valera', p.match_fornitore_id === 'f-av' || /valera/i.test(p.fornitore.v ?? ''), p.fornitore.v);
    t('  una riga da 440 (mt) a 0.656', p.righe.length >= 1 && p.righe.some((r) => near(r.quantita.v, 440) && near(r.prezzo.v, 0.656, 0.0011)), JSON.stringify(p.righe.map((r) => [r.quantita.v, r.prezzo.v])));
    t('  sconto 3% nel testo, non nel prezzo', p.righe.some((r) => /3\s?%/.test(r.sconto_text.v ?? '') || /3\s?%/.test(r.prezzo_text.v ?? '')) || /3\s?%/.test(p.note.v ?? ''), JSON.stringify(p.righe.map((r) => r.sconto_text.v)));
    t('  imponibile 279.98 e totale documento 341.58', near(p.totale_imponibile.v, 279.98) && near(p.totale_documento.v, 341.58), `${p.totale_imponibile.v} / ${p.totale_documento.v}`);
  } },
  { nome: 'PF 150 MLM Mazzola (1.000 bottoni a 0,06 = 60,00; doc 73,20)', files: ['MLMMazzola_proforma_PF150_2026-09-11.pdf'], testo: '', check: (p) => {
    t('  fornitore MLM', p.match_fornitore_id === 'f-mlm' || /mlm/i.test(p.fornitore.v ?? ''), p.fornitore.v);
    t('  1000 pz a 0.06, importo 60', p.righe.some((r) => near(r.quantita.v, 1000) && near(r.prezzo.v, 0.06, 0.0011) && near(r.importo.v, 60)), JSON.stringify(p.righe.map((r) => [r.quantita.v, r.prezzo.v, r.importo.v])));
    t('  categoria Accessori metallici', p.righe.some((r) => r.categoria.v === 'Accessori metallici'), p.righe.map((r) => r.categoria.v).join(','));
    t('  totale documento 73.20', near(p.totale_documento.v, 73.2), p.totale_documento.v);
  } },
  { nome: 'Proforma Albert Guegain 16-07 (4 velluti, 15 ml, 48,44 e 46,00; 2.833,20)', files: ['AlbertGuegain_proforma_2026-07-16.pdf'], testo: '', check: (p) => {
    t('  fornitore Albert Guegain', p.match_fornitore_id === 'f-ag' || /guegain/i.test(p.fornitore.v ?? ''), p.fornitore.v);
    t('  4 righe', p.righe.length === 4, p.righe.length);
    t('  prezzi 48.44 x2 e 46 x2', multiset(prezzi(p), [48.44, 48.44, 46, 46]), prezzi(p).join(','));
    t('  15 ml per riga', p.righe.every((r) => near(r.quantita.v, 15)), p.righe.map((r) => r.quantita.v).join(','));
    t('  totale imponibile 2833.20', near(p.totale_imponibile.v, 2833.2), p.totale_imponibile.v);
    t('  categoria Tessuto velluto', p.righe.some((r) => r.categoria.v === 'Tessuto velluto'), p.righe.map((r) => r.categoria.v).join(','));
  } },
  // la scheda tecnica Ego NON contiene prezzi (verificato col testo del PDF il 23-09: gli scaglioni del seed venivano
  // dal corpo dell'email): da sola deve dare prezzo E prezzo_text vuoti; con la nota dettata gli scaglioni vanno nel testo
  { nome: 'Scheda tecnica Ego Vernice da sola (nessun prezzo nel documento: niente inventato)', files: ['Ego_Vernice_scheda_tecnica.pdf'], testo: '', check: (p) => {
    t('  fornitore Ego', p.match_fornitore_id === 'f-ego' || /ego/i.test(p.fornitore.v ?? ''), p.fornitore.v);
    t('  nessun prezzo numerico e nessun prezzo_text', p.righe.length >= 1 && p.righe.every((r) => r.prezzo.v === null && !r.prezzo_text.v), JSON.stringify(p.righe.map((r) => [r.prezzo.v, r.prezzo_text.v])));
    t('  categoria Vernice', p.righe.some((r) => r.categoria.v === 'Vernice'), p.righe.map((r) => r.categoria.v).join(','));
    t('  nessun numero inventato', numeriInventati(p) === 0, JSON.stringify(p.righe.map((r) => [r.prezzo.v, r.quantita.v, r.importo.v])));
  } },
  { nome: 'Scheda Ego + nota con gli scaglioni (prezzo NULL, scaglioni in prezzo_text)', files: ['Ego_Vernice_scheda_tecnica.pdf'], testo: 'Vernice di Ego: 49,16 al metro quadro sotto le 6 pelli, 46,66 da 6 a 30 metri quadri, 44,16 oltre i 30', check: (p) => {
    t('  prezzo numerico NULL (sono scaglioni, non un valore unico)', p.righe.length >= 1 && p.righe.every((r) => r.prezzo.v === null), prezzi(p).join(','));
    t('  scaglioni nel testo (49,16 e 44,16)', p.righe.some((r) => /49[.,]16/.test(r.prezzo_text.v ?? '') && /44[.,]16/.test(r.prezzo_text.v ?? '')), p.righe.map((r) => r.prezzo_text.v).join(' | '));
    t('  unita mq', p.righe.some((r) => r.unita.v === 'mq'), p.righe.map((r) => r.unita.v).join(','));
  } },
  { nome: 'Foto cocco Damapel (categoria Cocco, ZERO numeri)', files: ['Damapel_Cocco_stampato_nero_foto.jpeg'], testo: 'campione di Damapel', check: (p) => {
    t('  fornitore Damapel dalla nota', p.match_fornitore_id === 'f-dam' || /damapel/i.test(p.fornitore.v ?? ''), p.fornitore.v);
    t('  categoria Cocco', p.righe.some((r) => r.categoria.v === 'Cocco'), p.righe.map((r) => r.categoria.v).join(','));
    t('  nessun numero inventato (prezzo, quantita, importo, totali tutti null)', numeriInventati(p) === 0, JSON.stringify(p.righe.map((r) => [r.prezzo.v, r.quantita.v, r.importo.v])) + ` tot ${p.totale_imponibile.v}/${p.totale_documento.v}`);
  } },
];

const key = await chiave();
console.log(`Golden set materie prime, modello ${MODEL}, cartella ${DIR}`);
for (const c of casi) {
  if (!c.files.every((f) => existsSync(DIR + f))) { console.log(`\n== ${c.nome} ==\n  KO  file mancante: ${c.files.join(', ')}`); ko++; continue; }
  console.log(`\n== ${c.nome} ==`);
  try { const { p, ms, finish } = await compila(key, 'materiale', c.files, c.testo, CTX); console.log(`  (${(ms / 1000).toFixed(1)} s, ${finish}, ${p.righe.length} righe)`); c.check(p); }
  catch (e) { ko++; console.log('  KO  ' + e.message.slice(0, 300)); }
}
console.log(`\n${ok} ok, ${ko} KO  (modello ${MODEL})`);
process.exit(ko ? 1 : 0);
