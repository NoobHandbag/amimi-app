// tests/mat_ai_golden.mjs: golden set dello strato AI "Compila" (edge ai-compila) sui DOCUMENTI REALI dei fornitori.
//   node tests/mat_ai_golden.mjs [--modello gemini-flash-lite-latest] [--inbox <cartella con mat_assets/>]
// Lanciabile a MANO (non in CI): usa la chiave Gemini letta da app_flags con la service_role (Management API,
// SUPABASE_ACCESS_TOKEN), chiama Gemini con LO STESSO prompt della edge (import da prompt.ts) e confronta la proposta
// con i numeri verificati il 22-09 (PDF riletti). Criterio del brief: numeri giusti e ZERO numeri inventati: un prezzo
// proposto dove il documento non lo ha = rosso. Nessuna scrittura da nessuna parte.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrompt, validaOutput, normalizzaOutput, responseSchema, MODELLO_DEFAULT, MAX_OUTPUT_TOKENS } from '../supabase/functions/ai-compila/prompt.ts';

const args = process.argv.slice(2);
const MODELLO = args.includes('--modello') ? args[args.indexOf('--modello') + 1] : MODELLO_DEFAULT;
const INBOX = args.includes('--inbox') ? args[args.indexOf('--inbox') + 1] : 'C:/Users/super/dev/gestionale-ami/Cowork12/_CLAUDE_CODE_INBOX';
const PROJECT_REF = 'imszbjeyplaiovylhkgl';
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

async function geminiKey() {
  const tok = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (!tok) throw new Error('STOP: manca SUPABASE_ACCESS_TOKEN');
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`Management API ${r.status}`);
  const svc = (await r.json()).find((x) => x.name === 'service_role')?.api_key;
  const f = await fetch(`https://${PROJECT_REF}.supabase.co/rest/v1/app_flags?key=eq.gemini_api_key&select=value`, { headers: { apikey: svc, authorization: `Bearer ${svc}` } });
  const rows = await f.json();
  const key = rows?.[0]?.value;
  if (!key) throw new Error('gemini_api_key assente in app_flags');
  return key;
}
async function compila(key, target, files, testo, ctx) {
  const parts = [{ text: buildPrompt(target, testo, ctx) }];
  for (const f of files) parts.push({ inline_data: { mime_type: MIME[f.split('.').pop().toLowerCase()] ?? 'application/octet-stream', data: readFileSync(join(INBOX, 'mat_assets', f)).toString('base64') } });
  // stessa chiamata della edge: structured output (responseSchema) + un ritentativo se il JSON non si legge
  const chiama = async () => {
    const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELLO}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: 'application/json', responseSchema: responseSchema(target) } }),
    });
    const gj = await g.json();
    if (!g.ok) throw new Error('Gemini ' + g.status + ': ' + JSON.stringify(gj).slice(0, 300));
    const cand = gj?.candidates?.[0];
    if (cand?.finishReason && cand.finishReason !== 'STOP') throw new Error('Gemini finishReason ' + cand.finishReason);
    return (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim().replace(/^```(json)?/i, '').replace(/```$/, '');
  };
  let p;
  try { p = JSON.parse(await chiama()); } catch { p = JSON.parse(await chiama()); }
  p = normalizzaOutput(target, p);
  const problema = validaOutput(target, p);
  if (problema) throw new Error('output non valido: ' + problema);
  return p;
}

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 220) : '')); } };
const near = (a, b, tol = 0.011) => a != null && Math.abs(Number(a) - Number(b)) <= tol;
const has = (s, needle) => String(s ?? '').toLowerCase().includes(needle.toLowerCase());
const CTX = { fornitori: ['Fada Tessuti', 'MLM Mazzola', 'Vicenza Pelli', 'Albert Guegain', 'Angelo Valera', 'Alpaca', 'Damapel', 'Ego', 'Zabri'], materiali: ['Cocco stampato lucido tipo fotografie', 'Vernice', 'Vernice stock', 'Mucca Zigrinata (Horsy 9017 White)', 'Cerbiatto (Horsy 9017 White)'] };

const key = await geminiKey();
console.log(`\n== golden set ai-compila, modello ${MODELLO} ==`);

{ // 1. proforma Vicenza Pelli FP 496: 4 righe animalier, 66 €/mq, imponibile 815,10
  const p = await compila(key, 'materiale', ['VicenzaPelli_proforma_FP496_2026-07-09.pdf'], 'proforma Vicenza Pelli, prendi la mucca zigrinata', CTX);
  t('1a Vicenza: fornitore riconosciuto', has(p.fornitore?.match_esistente ?? p.fornitore?.valore, 'vicenza'), JSON.stringify(p.fornitore));
  t('1b Vicenza: tipo acquistato', p.tipo?.valore === 'acquistato', JSON.stringify(p.tipo));
  t('1c Vicenza: prezzo 66 numerico, unita mq', near(p.prezzo?.valore, 66) && p.unita?.valore === 'mq', JSON.stringify([p.prezzo, p.unita]));
  t('1d Vicenza: quantita 5,10 (mucca zigrinata)', near(p.quantita?.valore, 5.1), JSON.stringify(p.quantita));
  // 336,60 e' l'importo della riga chiesta (mucca zigrinata): e' nel documento, quindi ammesso. Tutto il resto e' inventato.
  t('1e Vicenza: importo 815,10 / 994,42 / 336,60 (nel documento), mai un numero diverso', [815.10, 994.42, 336.60].some((x) => near(p.importo_totale?.valore, x)) || p.importo_totale?.valore == null, JSON.stringify(p.importo_totale));
  t('1f Vicenza: categoria Animalier', p.categoria?.valore === 'Animalier', JSON.stringify(p.categoria));
}
{ // 2. proforma Angelo Valera 197: nastro 0,656 €/mt, 440 mt, sconto 3%, imponibile 279,98
  const p = await compila(key, 'materiale', ['AngeloValera_proforma_197_2026-09-10.pdf'], '', CTX);
  t('2a Valera: prezzo 0,656 numerico', near(p.prezzo?.valore, 0.656, 0.0005), JSON.stringify(p.prezzo));
  t('2b Valera: quantita 440', near(p.quantita?.valore, 440), JSON.stringify(p.quantita));
  t('2c Valera: importo 279,98 o 341,58 (mai inventato)', near(p.importo_totale?.valore, 279.98) || near(p.importo_totale?.valore, 341.58) || p.importo_totale?.valore == null, JSON.stringify(p.importo_totale));
  t('2d Valera: categoria Nastri, unita mt', p.categoria?.valore === 'Nastri' && ['mt', 'ml'].includes(p.unita?.valore), JSON.stringify([p.categoria, p.unita]));
}
{ // 3. proforma MLM PF 150: bottone 0,06 x 1000 pz = 60,00
  const p = await compila(key, 'materiale', ['MLMMazzola_proforma_PF150_2026-09-11.pdf'], '', CTX);
  t('3a MLM: prezzo 0,06 numerico', near(p.prezzo?.valore, 0.06, 0.0005), JSON.stringify(p.prezzo));
  t('3b MLM: quantita 1000 pz', near(p.quantita?.valore, 1000) && p.unita?.valore === 'pz', JSON.stringify([p.quantita, p.unita]));
  t('3c MLM: categoria Accessori metallici', p.categoria?.valore === 'Accessori metallici', JSON.stringify(p.categoria));
}
{ // 4. proforma Guegain 16-07: velluti in ML, 48,44 e 46,00; con nota "olive"
  const p = await compila(key, 'materiale', ['AlbertGuegain_proforma_2026-07-16.pdf'], 'velluto olive', CTX);
  t('4a Guegain: prezzo 48,44 (olive) numerico', near(p.prezzo?.valore, 48.44), JSON.stringify(p.prezzo));
  t('4b Guegain: unita ml e quantita 15', p.unita?.valore === 'ml' && near(p.quantita?.valore, 15), JSON.stringify([p.unita, p.quantita]));
  t('4c Guegain: categoria Tessuto velluto', p.categoria?.valore === 'Tessuto velluto', JSON.stringify(p.categoria));
}
{ // 5. scheda tecnica Ego Vernice (scaglioni nel corpo email, NON nel PDF): il PDF da solo non ha un prezzo -> null
  const p = await compila(key, 'materiale', ['Ego_Vernice_scheda_tecnica.pdf'], '', CTX);
  t('5a Ego scheda: prezzo NON inventato (null)', p.prezzo?.valore == null, JSON.stringify(p.prezzo));
  t('5b Ego scheda: categoria Vernice, tipo offerta', p.categoria?.valore === 'Vernice' && p.tipo?.valore === 'offerta', JSON.stringify([p.categoria, p.tipo]));
  // gli scaglioni stavano nel corpo dell'email, non nel PDF: dettati come nota devono finire in prezzo_text, mai in un numero singolo
  const q = await compila(key, 'materiale', ['Ego_Vernice_scheda_tecnica.pdf'], 'Ego vernice: 49,16 al mq sotto le 6 pelli per colore, 46,66 da 6 pelli a 30 mq, 44,16 oltre i 30 mq', CTX);
  t('5c Ego scheda + nota a scaglioni: valore null, scaglioni nel testo', q.prezzo?.valore == null && has(q.prezzo?.testo, '49,16') && has(q.prezzo?.testo, '44,16'), JSON.stringify(q.prezzo));
}
{ // 6. foto del cocco Damapel + nota con scaglioni: prezzo in testo, mai un numero singolo
  const p = await compila(key, 'materiale', ['Damapel_Cocco_stampato_nero_foto.jpeg'], 'Damapel cocco nero, 45 al mq per piccole quantita e 40 se prendo tutto lo stock', CTX);
  t('6a Damapel cocco: categoria Cocco', p.categoria?.valore === 'Cocco', JSON.stringify(p.categoria));
  t('6b Damapel cocco: prezzo a scaglioni -> testo, valore null', p.prezzo?.valore == null && has(p.prezzo?.testo, '40'), JSON.stringify(p.prezzo));
  t('6c Damapel cocco: colore Nero', (p.colori ?? []).some((c) => has(c.valore, 'nero')), JSON.stringify(p.colori));
}
{ // 7. ordine prodotti da nota dettata: righe risolte sulle liste, nessun numero inventato
  const p = await compila(key, 'ordine_prodotti', [], 'a Francesco dieci Lea leopardo savana e cinque Agata nera', { fornitori: ['Francesco (pelle)', 'Sarte Milano (tessuto)'], modelli: ['LEA', 'AGATA', 'ANNIE'], varianti: ['LEOPARDO SAVANA', 'NERA', 'ROSSA'] });
  t('7a ordine: fornitore Francesco (pelle)', has(p.fornitore?.match_esistente ?? p.fornitore?.valore, 'francesco'), JSON.stringify(p.fornitore));
  t('7b ordine: 2 righe, 10 e 5 pezzi', (p.righe ?? []).length === 2 && near(p.righe[0]?.quantita?.valore, 10) && near(p.righe[1]?.quantita?.valore, 5), JSON.stringify(p.righe));
  t('7c ordine: costo NON inventato (null)', (p.righe ?? []).every((r) => r.costo_unitario?.valore == null), JSON.stringify(p.righe?.map((r) => r.costo_unitario)));
}
console.log(`\nmat_ai_golden (${MODELLO}): ${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
