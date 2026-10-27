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
writeFileSync(TMP, `${s.slice(a + BEGIN.length, b).trim()}\nexport { STALL_SKIP_AFTER, STALL_ERROR_AFTER_MS, contaStallo, stalloDaScavalcare, stalloSeverity, leggiStallo, CORRENTE_MORTO_DOPO_MS, ERR_INTERROTTO, leggiCorrente, giroInterrotto, severitaInterruzione, daScavalcarePrimaDiProvare };\n`, 'utf8');
let STALL_SKIP_AFTER, STALL_ERROR_AFTER_MS, contaStallo, stalloDaScavalcare, stalloSeverity, leggiStallo;
let CORRENTE_MORTO_DOPO_MS, ERR_INTERROTTO, leggiCorrente, giroInterrotto, severitaInterruzione, daScavalcarePrimaDiProvare;
try { ({ STALL_SKIP_AFTER, STALL_ERROR_AFTER_MS, contaStallo, stalloDaScavalcare, stalloSeverity, leggiStallo, CORRENTE_MORTO_DOPO_MS, ERR_INTERROTTO, leggiCorrente, giroInterrotto, severitaInterruzione, daScavalcarePrimaDiProvare } = await import(pathToFileURL(TMP).href)); }
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

// v35 (incidente del 26-10): il worker ucciso dal limite di CPU non arrivava mai a cinturaStallo. ~250 giri morti
// sullo stesso messaggio, contatore fermo a n=1, salute ferma all'ultimo warn. Qui la parte pura del rimedio.
console.log('\n== il giro morto (v35): segnaposto del messaggio in lavorazione ==');
const T0ms = Date.parse(T0);
const corr = (at) => ({ id: 'X', thread: 'X', dir: 'in', at });
t('24 nessun segnaposto -> nessun giro morto', giroInterrotto(null, T0ms) === false);
t('25 segnaposto fresco (30 s) = giro ancora vivo e sovrapposto: non si conta', giroInterrotto(corr(new Date(T0ms - 30000).toISOString()), T0ms) === false);
t('26 segnaposto di 90 s = giro morto (il cron passa ogni 2 minuti)', CORRENTE_MORTO_DOPO_MS === 90000 && giroInterrotto(corr(new Date(T0ms - 90000).toISOString()), T0ms) === true);
t('27 `at` illeggibile = morto (nessun giro vivo lo riscrive cosi\')', giroInterrotto(corr('boh'), T0ms) === true);
t('28 lettura del segnaposto tollerante: assente, rotto o senza id -> null', leggiCorrente(undefined) === null && leggiCorrente('{x') === null && leggiCorrente('{"at":"x"}') === null);
const lc = leggiCorrente(JSON.stringify({ id: 'X', thread: 'T', dir: 'boh', at: T0 }));
t('29 andata e ritorno, direzione ignota -> in', lc && lc.id === 'X' && lc.thread === 'T' && lc.dir === 'in' && lc.at === T0, lc);
t('30 ERR_INTERROTTO sta nei 300 caratteri di contaStallo (il confronto esatto di daScavalcarePrimaDiProvare regge)',
  contaStallo(null, { id: 'X', thread: 'X', dir: 'in', err: ERR_INTERROTTO }, T0).err === ERR_INTERROTTO);

console.log('\n== il caso del 26-10 rigiocato: n=1 da un 400 di Gmail, poi solo giri morti ==');
let inc = { id: 'X', thread: 'X', dir: 'in', n: 1, first_at: T0, err: 'gmail_get 400: {}' };   // cs_stall_msg come in produzione
const morto = (prev, min) => contaStallo(prev, { id: 'X', thread: 'X', dir: 'in', err: ERR_INTERROTTO }, dopo(min));
t('31 con n=1 da errore catturato si riprova (v18), non si scavalca prima', daScavalcarePrimaDiProvare(inc, 'X') === false);
inc = morto(inc, 2);
t('32 primo giro morto riconosciuto: n=2, first_at fermo, severity error subito', inc.n === 2 && inc.first_at === T0 && severitaInterruzione(inc, Date.parse(dopo(2))) === 'error', inc);
inc = morto(morto(inc, 4), 6);
t('33 a n=4 si riprova ancora', inc.n === 4 && daScavalcarePrimaDiProvare(inc, 'X') === false);
inc = morto(inc, 8);
t('34 a n=5 giri morti si scavalca PRIMA di riprovare (riprovare = morire ancora)', inc.n === STALL_SKIP_AFTER && daScavalcarePrimaDiProvare(inc, 'X') === true);
t('35 ma solo per QUEL messaggio', daScavalcarePrimaDiProvare(inc, 'Y') === false && daScavalcarePrimaDiProvare(null, 'X') === false);
t('36 se l\'ultimo fallimento e\' un errore catturato si riprova come nella v18, anche a soglia',
  daScavalcarePrimaDiProvare({ ...inc, err: 'db_upsert_in: timeout' }, 'X') === false);
t('37 un solo giro morto da fresco resta warn (puo\' essere un picco isolato del worker)',
  severitaInterruzione(contaStallo(null, { id: 'Z', thread: 'Z', dir: 'in', err: ERR_INTERROTTO }, T0), T0ms + 60000) === 'warn');

// Il cablaggio: le funzioni pure non servono se il segnaposto si scrive DOPO il lavoro pesante o resta in giro.
console.log('\n== cablaggio nel sorgente ==');
const corpo = (start, stop) => { const i = s.indexOf(start); const j = s.indexOf(stop, i + 1); return i < 0 || j < 0 ? '' : s.slice(i, j); };
const pm = corpo('const processMessage = async', 'safeParse(mg.j');
t('38 processMessage: segnaposto prima del fetch Gmail e del parse', pm.indexOf('segnaCorrente(') > 0 && pm.indexOf('segnaCorrente(') < pm.indexOf('gGet('));
const po = corpo('const processOutbound = async', 'extractBody(msg.payload)');
t('39 processOutbound: segnaposto dopo lo scarto dei thread non tracciati e prima del fetch Gmail',
  po.indexOf("conv.canale === 'rumore'") > 0 && po.indexOf('segnaCorrente(') > po.indexOf("conv.canale === 'rumore'") && po.indexOf('segnaCorrente(') < po.indexOf('gGet('));
const giro = corpo('let tip = startId', 'await writeHealth(\n    stalled');
const chiusure = (giro.match(/await chiudiCorrente\(\);/g) || []).length;
t('40 il giro cancella il segnaposto sulle due uscite anticipate e prima della salute finale', chiusure === 3, chiusure);
t('41 il giro morto si riconosce PRIMA del ciclo dei messaggi', s.indexOf('giroInterrotto(corr') > 0 && s.indexOf('giroInterrotto(corr') < s.indexOf('let tip = startId'));
t('42 il giro legge il segnaposto insieme agli altri flag', /in\('key', \[[^\]]*'cs_ingest_corrente'/.test(s));

console.log(`\n${ok}/${ok + ko} verdi`);
if (ko) process.exit(1);
