// tests/cs_noncliente.mjs — quando un "non cliente" esce dalla coda (cs-classify v11), ritagliato DAL
// SORGENTE che va in produzione (blocco PURE:cs-noncliente): se il codice cambia, il test rompe.
//   node tests/cs_noncliente.mjs
//
// Perche' esiste. Gemini dice "non cliente" con una confidenza; la conversazione esce dalla coda solo
// se TUTTE le guardie lo permettono: email diretta, confidenza >= 0.85, mittente che non ha mai
// ordinato (lettura riuscita), nessun numero d'ordine. Ogni guardia ha qui il suo caso che la tiene in
// coda: il rischio da evitare e' una cliente che chiede prima di comprare finita nel rumore.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BEGIN = '// ==== PURE:cs-noncliente BEGIN ====';
const END = '// ==== PURE:cs-noncliente END ====';
const s = readFileSync(`${ROOT}supabase/functions/cs-classify/index.ts`, 'utf8').replace(/\r\n/g, '\n');
const a = s.indexOf(BEGIN), b = s.indexOf(END);
if (a < 0 || b < 0) { console.error('marcatori PURE:cs-noncliente non trovati in cs-classify'); process.exit(1); }
const TMP = `${ROOT}tests/_noncliente.tmp.ts`;
writeFileSync(TMP, `${s.slice(a + BEGIN.length, b).trim()}\nexport { NON_CLIENTE_SOGLIA, nonClienteVaNelRumore, testoConMittente };\n`, 'utf8');
let NON_CLIENTE_SOGLIA, nonClienteVaNelRumore, testoConMittente;
try { ({ NON_CLIENTE_SOGLIA, nonClienteVaNelRumore, testoConMittente } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra) : '')); } };
const base = { nonCliente: true, confidenza: 0.95, canale: 'email_diretta', haOrdinato: false, orderNumber: null, nostreRisposte: 0, riportataAMano: false };
const va = (over = {}) => nonClienteVaNelRumore({ ...base, ...over });

console.log('== esce dalla coda ==');
t('1  fornitore sicuro, mai ordinato, nessun ordine citato', va());
t('2  esattamente sulla soglia', va({ confidenza: NON_CLIENTE_SOGLIA }));
t('3  order_number stringa vuota conta come assente', va({ orderNumber: '  ' }));

console.log('\n== resta in coda (una guardia per caso) ==');
t('4  Gemini dice cliente', !va({ nonCliente: false }));
t('5  nonCliente non booleano ("true" stringa)', !va({ nonCliente: 'true' }));
t('6  confidenza sotto soglia', !va({ confidenza: 0.84 }));
t('7  confidenza non numerica', !va({ confidenza: 'alta' }));
t('8  modulo del sito', !va({ canale: 'form_contatto' }));
t('9  modulo evento', !va({ canale: 'form_evento' }));
t('10 chat Inbox', !va({ canale: 'chat_notifica' }));
t('11 chat del sito', !va({ canale: 'chat_sito' }));
t('12 il mittente ha gia\' ordinato', !va({ haOrdinato: true }));
t('13 lettura ordini fallita (null) = trattala da cliente', !va({ haOrdinato: null }));
t('14 numero d\'ordine nella mail', !va({ orderNumber: '2012' }));
t('14b Gate 2 A1: riportata in coda a mano', !va({ riportataAMano: true }));
t('14c Gate 2 A1: lettura degli eventi fallita (null)', !va({ riportataAMano: null }));
t('14d Gate 2 C3: abbiamo gia\' risposto', !va({ nostreRisposte: 1 }));
t('14e nostreRisposte non numerico', !va({ nostreRisposte: undefined }));

console.log('\n== il testo che vede Gemini ==');
t('15 soglia = 0.85', NON_CLIENTE_SOGLIA === 0.85, NON_CLIENTE_SOGLIA);
t('16 mittente con nome in testa', testoConMittente({ nome: 'Forme Idee', email: 'commerciale@formeidee.it' }, 'Oggetto\nTesto') === 'Mittente: Forme Idee <commerciale@formeidee.it>\nOggetto\nTesto');
t('17 senza nome', testoConMittente({ email: 'x@y.it' }, 'T') === 'Mittente: <x@y.it>\nT');
t('18 senza email: nessuna riga mittente (chat senza email)', testoConMittente({ nome: 'Shop visitor', email: null }, 'T') === 'T');

console.log(`\n${ok}/${ok + ko} verdi`);
if (ko) process.exit(1);
