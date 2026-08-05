// tests/cs_deny.mjs — il pre-filtro RUMORE, ritagliato DAL SORGENTE che va in produzione
// (blocco PURE:cs-deny di cs-sync): se il codice cambia, il test rompe.
// Nessuna rete, nessun database.
//   node tests/cs_deny.mjs
//
// Perche' esiste. `CASI_APERTI.md` n.15 (02-08): due mail non-cliente erano entrate in coda come
// conversazioni vere e il tool ci aveva scritto sopra risposte di assistenza. Verificato al codice
// e a DB, le cause NON erano no-code:
//   (a) la denylist non e' mai retroattiva -> azione `reapply_noise`, provata a parte;
//   (b) le voci in forma `@dominio` non coprevano i SOTTOdomini, perche' il match era substring
//       sulla stringa intera: `@booking.com` non agganciava `...@property.booking.com`.
// Nel correggere (b) e' emerso il difetto opposto, che vale quanto l'altro: la stessa voce
// matchava anche l'OGGETTO, quindi una cliente che scrive "ho prenotato su booking.com" finiva nel
// rumore. Meta' di questo file e' la guardia contro quel falso positivo: mandare una cliente vera
// nel rumore e' molto peggio che lasciare una notifica in coda.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BEGIN = '// ==== PURE:cs-deny BEGIN ====';
const END = '// ==== PURE:cs-deny END ====';
const s = readFileSync(`${ROOT}supabase/functions/cs-sync/index.ts`, 'utf8').replace(/\r\n/g, '\n');
const a = s.indexOf(BEGIN), b = s.indexOf(END);
if (a < 0 || b < 0) { console.error('marcatori PURE:cs-deny non trovati in cs-sync'); process.exit(1); }
const TMP = `${ROOT}tests/_deny.tmp.ts`;
writeFileSync(TMP, `${s.slice(a + BEGIN.length, b).trim()}\nexport { denyMatch, isNoiseSender };\n`, 'utf8');
let denyMatch, isNoiseSender;
try { ({ denyMatch, isNoiseSender } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra) : '')); } };

console.log('== (b) le voci di dominio coprono i SOTTOdomini ==');
t('1  il caso di CASI_APERTI n.15: @booking.com aggancia property.booking.com',
  denyMatch('@booking.com', 'noreply@property.booking.com', 'La tua prenotazione'));
t('2  e ovviamente il dominio nudo', denyMatch('@booking.com', 'noreply@booking.com', 'x'));
t('3  vale anche senza chiocciola davanti', denyMatch('klaviyo.com', 'bounce@send.klaviyo.com', 'x'));
t('4  sottodominio profondo', denyMatch('@google.com', 'a@mail.notifiche.google.com', 'x'));

console.log('\n== e NON agganciano un dominio che li contiene per caso ==');
t('5  booking.com non aggancia notbooking.com', !denyMatch('@booking.com', 'x@notbooking.com', 'x'));
t('6  google.com non aggancia googlemail.com (e\' li\' che vivono clienti VERE)',
  !denyMatch('@google.com', 'carola.balzaretti@googlemail.com', 'Re: Order #1516 confirmed'));
t('7  ne\' un dominio che finisce con lo stesso testo senza il punto',
  !denyMatch('@shopify.com', 'x@myshopify.com', 'x'));

console.log('\n== la guardia che conta: una voce di DOMINIO non guarda l\'oggetto ==');
t('8  una cliente che NOMINA booking.com resta una cliente',
  !denyMatch('@booking.com', 'maria.rossi@gmail.com', 'Ho prenotato su booking.com, posso ritirare in negozio?'));
t('9  e vale anche per il dominio nudo nell\'oggetto',
  !denyMatch('paypal.com', 'maria.rossi@gmail.com', 'Ho pagato con paypal.com ma non vedo l\'ordine'));

console.log('\n== indirizzo esatto ==');
t('10 un indirizzo pieno matcha solo se stesso', denyMatch('payments-noreply@google.com', 'payments-noreply@google.com', 'x'));
t('11 e non un altro indirizzo dello stesso dominio',
  !denyMatch('payments-noreply@google.com', 'una.persona@google.com', 'x'));

console.log('\n== testo libero: le voci nate per l\'OGGETTO continuano a funzionare ==');
t('12 "Report Domain: amimi.it" aggancia l\'oggetto, come prima',
  denyMatch('Report Domain: amimi.it', 'noreply@dmarc.example.com', 'Report Domain: amimi.it Submitter: example'));
t('13 una parola sola senza punto resta testo libero',
  denyMatch('newsletter', 'x@example.org', 'La nostra newsletter di agosto'));
t('14 voce vuota o soli spazi non aggancia niente',
  !denyMatch('', 'x@y.com', 'x') && !denyMatch('   ', 'x@y.com', 'x'));

console.log('\n== i quattro mittenti Google dello screenshot 04-08 ==');
const DENY = ['accounts.google.com', 'payments-noreply@google.com', 'googlepay-noreply@google.com', 'gemini-notes@google.com'];
for (const [n, addr] of [
  ['15 no-reply@accounts.google.com', 'no-reply@accounts.google.com'],
  ['16 payments-noreply@google.com', 'payments-noreply@google.com'],
  ['17 googlepay-noreply@google.com', 'googlepay-noreply@google.com'],
  ['18 gemini-notes@google.com', 'gemini-notes@google.com'],
]) t(n, isNoiseSender(addr, 'Avviso', DENY));
t('19 e con quella denylist una cliente su googlemail resta FUORI dal rumore',
  !isNoiseSender('carola.balzaretti@googlemail.com', 'Re: Order #1516 confirmed', DENY));
t('20 come una cliente su gmail', !isNoiseSender('maria.rossi@gmail.com', 'Domanda su un ordine', DENY));

console.log('\n== regole native, invariate ==');
t('21 i bounce', isNoiseSender('mailer-daemon@googlemail.com', 'Delivery Status', []));
t('22 i report DMARC', isNoiseSender('noreply@dmarc.example.com', 'Report Domain: amimi.it', []));
t('23 klaviyo', isNoiseSender('x@send.klaviyo.com', 'Newsletter', []));
t('24 e una cliente qualunque con denylist vuota NON e\' rumore',
  !isNoiseSender('maria.rossi@gmail.com', 'Vorrei cambiare la borsa', []));

console.log(`\n${ok}/${ok + ko} verdi` + (ko ? ` — ${ko} ROSSI` : ''));
process.exitCode = ko ? 1 : 0;
