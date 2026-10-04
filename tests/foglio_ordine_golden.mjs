// tests/foglio_ordine_golden.mjs: golden set del target "foglio_ordine" di ai-compila sui FOGLI VERI scritti a mano
// da Ginevra col fornitore (tre fogli del 04-10: Lea Bag Maxi, Lea Bag, Lea Bag "1 a colore"; 20 righe).
//   node tests/foglio_ordine_golden.mjs [--modello gemini-flash-lite-latest] [--fogli <cartella>] [--out <file.json>]
// Lanciabile a MANO (non in CI): chiave Gemini da app_flags con la service_role (Management API, SUPABASE_ACCESS_TOKEN),
// STESSO prompt della edge (import da prompt.ts), catalogo letto dal vivo da products. Nessuna scrittura.
// Verita' di confronto: la lettura dei fogli fatta in sessione il 04-10 (quantita', TUTTA, stima, interno, asole).
// La VARIANTE giusta di ogni campione non e' nota qui (la sa Ginevra): i candidati si stampano, non si giudicano.
// Le foto non stanno in git (come mat_assets): vivono nel checkout principale, Cowork12/_CLAUDE_CODE_INBOX/fogli_ordine/.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrompt, validaOutput, normalizzaOutput, responseSchema, MODELLO_DEFAULT, MAX_OUTPUT_TOKENS } from '../supabase/functions/ai-compila/prompt.ts';

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const MODELLO = arg('--modello', MODELLO_DEFAULT);
const FOGLI = arg('--fogli', 'C:/Users/super/dev/gestionale-ami/Cowork12/_CLAUDE_CODE_INBOX/fogli_ordine');
const OUT = arg('--out', '');
const PROJECT_REF = 'imszbjeyplaiovylhkgl';
const FILES = ['2026-10-04_lea_maxi.jpg', '2026-10-04_lea.jpg', '2026-10-04_lea_1_a_colore.jpg'];

const T = (q, interno, extra = {}) => ({ q, tutta: false, stima: null, interno, asole: false, ...extra });
const TUTTA = (interno, stima = null) => ({ q: null, tutta: true, stima, interno, asole: false });
const ATTESO = [
  { modello: 'LEA BAG MAXI', righe: [T(5, '88'), TUTTA('MARRONE'), T(1, 'MARRONE'), TUTTA('91'), T(13, 'MARRONE', { asole: true }), TUTTA('91'), T(1, 'FUCSIA', { asole: true })] },
  { modello: 'LEA BAG', righe: [TUTTA('91', 40), T(20, '88'), TUTTA('MARRONE'), TUTTA('NERO'), TUTTA('NERO'), T(10, 'VERDE'), T(20, 'MARRONE'), T(10, '91')] },
  { modello: 'LEA BAG', righe: [TUTTA('NERO', 10), TUTTA('123', 10), TUTTA('91', 10), TUTTA('MARRONE', 20), TUTTA('NERA')] },
];

async function chiavi() {
  const tok = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (!tok) throw new Error('STOP: manca SUPABASE_ACCESS_TOKEN');
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`Management API ${r.status}`);
  const svc = (await r.json()).find((x) => x.name === 'service_role')?.api_key;
  const rest = (q) => fetch(`https://${PROJECT_REF}.supabase.co/rest/v1/${q}`, { headers: { apikey: svc, authorization: `Bearer ${svc}` } });
  const f = await rest('app_flags?key=eq.gemini_api_key&select=value');
  if (!f.ok) throw new Error(`app_flags ${f.status}`);
  const key = (await f.json())?.[0]?.value;
  if (!key) throw new Error('gemini_api_key assente in app_flags');
  const p = await rest('products?select=item,variant&order=item');
  if (!p.ok) throw new Error(`products ${p.status}`);
  const prods = await p.json();
  const catalogo = [...new Set(prods.filter((x) => x.item && x.variant).map((x) => `${String(x.item).toUpperCase()} | ${x.variant}`))];
  return { key, catalogo };
}

const { key, catalogo } = await chiavi();
const ctx = { catalogo, fornitori: ['Francesco (pelle)', 'Vincenzo (pelle)', 'Fiorella (tessuto)', 'Sarte Milano (tessuto)'] };
// --singoli: una chiamata per foglio, in parallelo (come fa la PWA), righe ricomposte con il numero del foglio
const SINGOLI = args.includes('--singoli');
const img = (f) => ({ inline_data: { mime_type: 'image/jpeg', data: readFileSync(join(FOGLI, f)).toString('base64') } });
async function chiama(imgs) {
  const t0 = Date.now();
  const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELLO}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: buildPrompt('foglio_ordine', '', ctx) }, ...imgs] }], generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: 'application/json', responseSchema: responseSchema('foglio_ordine') } }),
  });
  const gj = await g.json();
  if (!g.ok) throw new Error('Gemini ' + g.status + ': ' + JSON.stringify(gj).slice(0, 400).split(key).join('***'));
  const cand = gj?.candidates?.[0];
  console.log(`tempo ${Date.now() - t0} ms, finishReason ${cand?.finishReason}, token out ${gj?.usageMetadata?.candidatesTokenCount} + pensiero ${gj?.usageMetadata?.thoughtsTokenCount ?? 0}`);
  if (cand?.finishReason && cand.finishReason !== 'STOP') throw new Error('finishReason ' + cand.finishReason);
  return normalizzaOutput('foglio_ordine', JSON.parse((cand?.content?.parts ?? []).map((p) => p.text ?? '').join('')), ctx);
}

console.log(`\n== golden foglio_ordine, modello ${MODELLO}, ${FILES.length} fogli${SINGOLI ? ' uno per chiamata' : ''}, catalogo ${catalogo.length} varianti ==`);
const t0 = Date.now();
let p;
if (SINGOLI) {
  const res = await Promise.all(FILES.map((f) => chiama([img(f)])));
  for (const [i, r] of res.entries()) for (const x of r.righe ?? []) x.foglio = i + 1;
  p = { ...res[0], righe: res.flatMap((r) => r.righe ?? []), note: { valore: res.map((r) => r.note?.valore).filter(Boolean).join(' | ') || null } };
} else p = await chiama(FILES.map(img));
console.log(`tempo totale ${Date.now() - t0} ms`);
const problema = validaOutput('foglio_ordine', p);
if (OUT) writeFileSync(OUT, JSON.stringify(p, null, 2));
if (problema) { console.log('output non valido: ' + problema); process.exit(1); }

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) ok++; else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 200) : '')); } };
const up = (s) => String(s ?? '').toUpperCase().trim();
if (p.avviso) console.log('avviso: ' + p.avviso);
console.log('fornitore: ' + JSON.stringify(p.fornitore?.valore) + ', data: ' + JSON.stringify(p.data_ordine?.valore) + ', note: ' + JSON.stringify(p.note?.valore));
ATTESO.forEach((att, fi) => {
  const righe = (p.righe ?? []).filter((r) => r.foglio === fi + 1).sort((a, b) => a.posizione - b.posizione);
  console.log(`\nfoglio ${fi + 1} (${FILES[fi]}): ${righe.length} righe lette, ${att.righe.length} attese`);
  t(`f${fi + 1} numero di righe`, righe.length === att.righe.length, `${righe.length} invece di ${att.righe.length}`);
  att.righe.forEach((a, ri) => {
    const r = righe[ri]; const id = `f${fi + 1}r${ri + 1}`;
    if (!r) { ko += 5; console.log(`  KO  ${id} riga mancante`); return; }
    console.log(`  ${id} "${r.campione?.descrizione}"${r.campione?.scritto ? ` scritto ${JSON.stringify(r.campione.scritto)}` : ''} | ${JSON.stringify(r.quantita_scritta)} -> q=${r.quantita?.valore} tutta=${r.tutta} stima=${r.stima_pezzi} | interno ${JSON.stringify(r.interno?.valore)} | note ${JSON.stringify(r.note)} | candidati ${JSON.stringify(r.candidati)} | box ${JSON.stringify(r.box)}`);
    t(`${id} modello ${att.modello}`, up(r.modello?.match_esistente ?? r.modello?.valore) === att.modello, JSON.stringify(r.modello));
    t(`${id} quantita ${a.q}`, (r.quantita?.valore ?? null) === a.q, r.quantita?.valore);
    t(`${id} tutta ${a.tutta}`, r.tutta === a.tutta, r.tutta);
    // la stima finisce solo nella nota della riga (la quantita' di una riga TUTTA si sa all'arrivo): avviso, non KO.
    // Misura del 04-10: il flash legge "(40 pezzi)" come 10 in tutti i giri, il lite lo legge giusto.
    if ((r.stima_pezzi ?? null) !== a.stima) console.log(`  avviso ${id} stima ${r.stima_pezzi} invece di ${a.stima}`);
    t(`${id} interno ${a.interno}`, up(r.interno?.valore) === a.interno, r.interno?.valore);
    t(`${id} asole ${a.asole}`, /asol/i.test(String(r.note ?? '')) === a.asole, r.note);
  });
});
const extra = (p.righe ?? []).filter((r) => !(r.foglio >= 1 && r.foglio <= ATTESO.length));
if (extra.length) { ko += extra.length; console.log(`KO  ${extra.length} righe con foglio fuori intervallo`); }
console.log(`\n== ${MODELLO}: ${ok} ok, ${ko} KO su ${ok + ko} controlli ==`);
process.exit(ko ? 1 : 0);
