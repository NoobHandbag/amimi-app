// tests/cs_stallo.mjs — la cintura anti-stallo di cs-sync, ritagliata DAL SORGENTE che va in
// produzione (blocco PURE:cs-stallo): se il codice cambia, il test rompe. Nessuna rete, nessun DB.
//   node tests/cs_stallo.mjs
//
// Perche' esiste. Dal 01-09 sera al 13-09 il cursore Gmail e' rimasto fermo a 818185: un `catch`
// che ritornava sempre 'transient' ha trasformato un errore RIPETIBILE su UN messaggio in uno stallo
// di 12 giorni, e la posta di tutti gli altri clienti non e' entrata nel tool. La regola qui sotto
// e' quella che decide QUANDO un fallimento smette di essere "transitorio" e viene scavalcato con
// placeholder, e quando la health passa da warn a error. Meta' del file e' la guardia opposta: un
// hiccup vero (id diverso ogni volta, o un giro passato in mezzo) NON deve mai far scavalcare nulla.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BEGIN = '// ==== PURE:cs-stallo BEGIN ====';
const END = '// ==== PURE:cs-stallo END ====';
const s = readFileSync(`${ROOT}supabase/functions/cs-sync/index.ts`, 'utf8').replace(/\r\n/g, '\n');
const a = s.indexOf(BEGIN), b = s.indexOf(END);
if (a < 0 || b < 0) { console.error('marcatori PURE:cs-stallo non trovati in cs-sync'); process.exit(1); }
const TMP = `${ROOT}tests/_stallo.tmp.ts`;
writeFileSync(TMP, `${s.slice(a + BEGIN.length, b).trim()}\nexport { STALL_SKIP_AFTER, STALL_ERROR_AFTER_MS, contaStallo, stalloDaScavalcare, stalloSeverity, leggiStallo };\n`, 'utf8');
let STALL_SKIP_AFTER, STALL_ERROR_AFTER_MS, contaStallo, stalloDaScavalcare, stalloSeverity, leggiStallo;
try { ({ STALL_SKIP_AFTER, STALL_ERROR_AFTER_MS, contaStallo, stalloDaScavalcare, stalloSeverity, leggiStallo } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra) : '')); } };

const T0 = '2026-09-13T15:00:00.000Z';
const dopo = (min) => new Date(Date.parse(T0) + min * 60 * 1000).toISOString();
const msg = (id, err = 'gmail_get 400: {}') => ({ id, thread: 'th_' + id, dir: 'in', err });

console.log('== le costanti sono quelle dichiarate nel brief ==');
t('1  soglia = 5 giri (cron */2 = ~10 minuti)', STALL_SKIP_AFTER === 5, STALL_SKIP_AFTER);
t('2  error dopo 1 ora di stallo', STALL_ERROR_AFTER_MS === 60 * 60 * 1000, STALL_ERROR_AFTER_MS);

console.log('\n== il contatore: sale SOLO sullo stesso messaggio ==');
const s1 = contaStallo(null, msg('A'), T0);
t('3  primo fallimento: n=1, first_at = adesso', s1.n === 1 && s1.first_at === T0 && s1.id === 'A', s1);
const s2 = contaStallo(s1, msg('A'), dopo(2));
t('4  stesso id al giro dopo: n=2, first_at NON si muove', s2.n === 2 && s2.first_at === T0, s2);
const s3 = contaStallo(s2, msg('B'), dopo(4));
t('5  id DIVERSO: riparte da 1 con first_at nuovo (un hiccup che cambia messaggio non e\' uno stallo)', s3.n === 1 && s3.first_at === dopo(4) && s3.id === 'B', s3);
t('6  la direzione e il thread seguono il messaggio corrente', s3.thread === 'th_B' && s3.dir === 'in');
const lungo = contaStallo(null, msg('C', 'x'.repeat(1000)), T0);
t('7  l\'errore si tronca a 300 caratteri (label health e dettaglio evento restano leggibili)', lungo.err.length === 300);
const senzaErr = contaStallo(null, { id: 'D', thread: 't', dir: 'out', err: undefined }, T0);
t('8  errore assente -> stringa vuota, mai "undefined"', senzaErr.err === '' && senzaErr.dir === 'out');

console.log('\n== quando si scavalca ==');
let acc = null;
for (let i = 1; i <= STALL_SKIP_AFTER - 1; i++) acc = contaStallo(acc, msg('A'), dopo(2 * i));
t('9  a soglia-1 NON si scavalca ancora', !stalloDaScavalcare(acc), acc.n);
acc = contaStallo(acc, msg('A'), dopo(2 * STALL_SKIP_AFTER));
t('10 al 5o giro consecutivo sullo stesso id SI scavalca', stalloDaScavalcare(acc), acc.n);
t('11 e oltre la soglia resta scavalcabile (idempotente se il placeholder fallisce e si riprova)', stalloDaScavalcare(contaStallo(acc, msg('A'), dopo(20))));
let alt = null;
for (let i = 1; i <= 20; i++) alt = contaStallo(alt, msg(i % 2 ? 'A' : 'B'), dopo(2 * i));
t('12 venti fallimenti ALTERNATI su due id non scavalcano mai nessuno dei due', !stalloDaScavalcare(alt) && alt.n === 1);

console.log('\n== severity: warn finche\' e\' fresco, error oltre un\'ora ==');
const fresco = contaStallo(null, msg('A'), T0);
t('13 appena iniziato -> warn', stalloSeverity(fresco, Date.parse(T0) + 5 * 60 * 1000) === 'warn');
t('14 a 59 minuti -> ancora warn', stalloSeverity(fresco, Date.parse(T0) + 59 * 60 * 1000) === 'warn');
t('15 a 60 minuti esatti -> error', stalloSeverity(fresco, Date.parse(T0) + 60 * 60 * 1000) === 'error');
t('16 a 12 giorni -> error (il caso reale: 11 giorni di warn non hanno svegliato nessuno)', stalloSeverity(fresco, Date.parse(T0) + 12 * 24 * 3600 * 1000) === 'error');
t('17 first_at illeggibile -> warn (mai un error per un dato rotto)', stalloSeverity({ ...fresco, first_at: 'boh' }, Date.parse(T0) + 3 * 3600 * 1000) === 'warn');

console.log('\n== lettura dello stato da app_flags: tollerante, mai un throw ==');
t('18 flag assente -> null', leggiStallo(undefined) === null && leggiStallo('') === null);
t('19 JSON rotto -> null', leggiStallo('{not json') === null);
t('20 JSON senza id -> null', leggiStallo('{"n":3}') === null);
const letto = leggiStallo(JSON.stringify(s2));
t('21 andata e ritorno: cio\' che si scrive si rilegge uguale', letto && letto.id === 'A' && letto.n === 2 && letto.first_at === T0 && letto.dir === 'in', letto);
const strano = leggiStallo('{"id":"Z","n":"abc","dir":"boh"}');
t('22 n non numerico -> 1, direzione ignota -> in', strano.n === 1 && strano.dir === 'in', strano);
t('23 ripartire dal flag riletto conta come continuare lo stesso stallo', contaStallo(letto, msg('A'), dopo(4)).n === 3);

console.log(`\n${ok}/${ok + ko} verdi`);
if (ko) process.exit(1);
