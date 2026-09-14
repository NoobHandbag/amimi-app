// tests/cs_closure.mjs — il rilevatore di CHIUSURA di cs-sync (blocco PURE:cs-closure), ritagliato
// DAL SORGENTE che va in produzione: se il codice cambia, il test rompe. Nessuna rete, nessun DB.
//   node tests/cs_closure.mjs
//
// Perche' esiste (CASI_APERTI n.22, fix 2): un nostro messaggio + il "grazie" di chiusura della
// cliente RIAPRIVA la conversazione (auto-fatto poi last_direction='in'), il falso positivo n.1 sui
// clienti veri. `isClosure` decide se l'ultimo inbound e' una pura chiusura, e allora cs-sync NON
// riapre. La meta' che conta e' la guardia opposta: una domanda vera NON deve mai passare per chiusura.
// Casi presi dal triage reale del 14-09 (0 falsi positivi misurati sul backlog aperto).
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BEGIN = '// ==== PURE:cs-closure BEGIN ====';
const END = '// ==== PURE:cs-closure END ====';
const s = readFileSync(`${ROOT}supabase/functions/cs-sync/index.ts`, 'utf8').replace(/\r\n/g, '\n');
const a = s.indexOf(BEGIN), b = s.indexOf(END);
if (a < 0 || b < 0) { console.error('marcatori PURE:cs-closure non trovati in cs-sync'); process.exit(1); }
const TMP = `${ROOT}tests/_closure.tmp.ts`;
writeFileSync(TMP, `${s.slice(a + BEGIN.length, b).trim()}\nexport { isClosure };\n`, 'utf8');
let isClosure;
try { ({ isClosure } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra) : '')); } };

console.log('== CHIUSURE vere (ultimo inbound = ringraziamento/conferma) -> true ==');
for (const [txt, nome] of [
  ['Grazie mille! Buon inizio settimana e buon lavoro! A domani, Camilla', 'musto #1680'],
  ['Grazie mille rimborso arrivato. Alla prossima. Grazie, Alessia', 'galluzzo reso'],
  ['Ok perfetto, passero\' per le 17 allora, grazie!', 'giulia wood'],
  ['Grazie per la risposta!', 'appartamento (chat)'],
  ['Perfetto grazie mille!', 'ack breve'],
  ['va bene grazie a presto', 'ack'],
]) t(`chiusura: "${txt.slice(0, 32)}..."  [${nome}]`, isClosure(txt) === true, txt);

console.log('\n== NON chiusure (domanda / problema / richiesta) -> false ==');
for (const [txt, nome] of [
  ['Quali sono gli orari? Sono interessata ad Annie Paillettes Nude.', 'musto Annie (backlog)'],
  ['quando verra\' consegnato l\'ordine? Grazie, Flavia', 'flavia #1406 (backlog)'],
  ['Grazie, ma la borsa e\' arrivata rovinata durante il trasporto', 'reclamo con grazie'],
  ['ok e per il reso come faccio?', 'reso + come'],
  ['Grazie, quando posso passare a ritirare?', 'grazie + domanda'],
  ['Volevo avvisarvi: avevo capito che l\'interno fosse di seta ma mi sembra sintetico', 'susanna dubbio'],
]) t(`non-chiusura: "${txt.slice(0, 32)}..."  [${nome}]`, isClosure(txt) === false, txt);

console.log('\n== casi limite ==');
t('vuoto -> false', isClosure('') === false);
t('null/undefined -> false', isClosure(null) === false && isClosure(undefined) === false);
t('grazie ma lungo (>160) -> false (non e\' una chiusura secca)', isClosure('Grazie mille per tutto ' + 'davvero '.repeat(25)) === false);
t('solo "grazie" -> true', isClosure('grazie') === true);

console.log(`\n== ${ok} ok, ${ko} ko ==`);
process.exit(ko ? 1 : 0);
