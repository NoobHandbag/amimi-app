// tests/cs_spam.mjs — il pre-filtro SPAM "esperto e-commerce", ritagliato DAL SORGENTE che va in
// produzione (blocco PURE:cs-spam di cs-sync): se il codice cambia, il test rompe. Nessuna rete/DB.
//   node tests/cs_spam.mjs
//
// Perche' esiste. Il 13-09 l'owner ha visto 60 "conversazioni cliente" in coda: gran parte erano bot
// che scrivono da gmail usa e getta con pitch commerciali. Il pre-filtro rumore per DOMINIO non li
// prende (gmail.com non si blocca per dominio) e Gemini, che vede solo il testo e non il mittente,
// scambia una sonda per un cliente. Il punteggio e' tarato su TUTTO lo storico (misura in SQL): a
// soglia 3, ZERO clienti noti flaggati. Meta' di questo file e' la guardia opposta: un cliente vero
// con l'anno di nascita nell'email (mario1985), il commercialista, una domanda vera che nomina una
// commissione PayPal - NON devono mai superare la soglia da soli.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BEGIN = '// ==== PURE:cs-spam BEGIN ====';
const END = '// ==== PURE:cs-spam END ====';
const s = readFileSync(`${ROOT}supabase/functions/cs-sync/index.ts`, 'utf8').replace(/\r\n/g, '\n');
const a = s.indexOf(BEGIN), b = s.indexOf(END);
if (a < 0 || b < 0) { console.error('marcatori PURE:cs-spam non trovati in cs-sync'); process.exit(1); }
const TMP = `${ROOT}tests/_spam.tmp.ts`;
writeFileSync(TMP, `${s.slice(a + BEGIN.length, b).trim()}\nexport { SPAM_THRESHOLD, vendorSpamScore };\n`, 'utf8');
let SPAM_THRESHOLD, vendorSpamScore;
try { ({ SPAM_THRESHOLD, vendorSpamScore } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra) : '')); } };
const spam = (em, subj, body) => vendorSpamScore(em, subj, body).score >= SPAM_THRESHOLD;
const sc = (em, subj, body) => vendorSpamScore(em, subj, body).score;

console.log('== SPAM veri dai dati reali del 13-09 (devono superare la soglia) ==');
t('1  probe da throwaway "expert" che sembra spedizione', spam('consistencyexpert14@gmail.com', 'Amimi', 'Can you deliver my order?'), sc('consistencyexpert14@gmail.com','Amimi','Can you deliver my order?'));
t('2  "consult" che sembra una domanda di spedizione', spam('holarconsult120@gmail.com', 'Do you ship locally or internationally', ''));
t('3  lettere unicode fancy + merchantservice', spam('danielmerchantservice@gmail.com', '', '\u{1D609}\u{1D622}\u{1D63B} test messaggio'));
t('4  digital + BFCM pitch', spam('newtondigital6@gmail.com', 'BFCM is getting closer', 'I reviewed your store and spotted adjustments'));
t('5  cifre + pitch commissione', spam('sandalrose330@gmail.com', 'Hi', 'Se posso aiutarti a generare 10-20 vendite, saresti disposto a pagarmi una commissione del 5%?'));
t('6  growth + observation pitch', spam('josephisaacgrowth@gmail.com', 'Amimi observation about your product?', 'your product has real demand'));
t('7  expert alone (parola forte) basta', spam('kemsonexpert53@gmail.com', '', 'can we agree on a 2% commission based on 15 to 20 daily orders?'));
t('8  consult + quick idea', spam('ellieconsult20@gmail.com', 'A quick idea for your Amimi', 'I will skip the usual pitch'));

console.log('\n== CLIENTI VERI e contatti reali (NON devono mai essere spam da soli) ==');
t('9  cliente con Re: a ordine confermato', !spam('giulia.wood14@icloud.com', 'Re: Ordine #1731 confermato', 'e possibile sapere se arriva oggi?'));
t('10 cliente nuovo con anno di nascita nell email (mario1985)', !spam('mario1985@gmail.com', 'Info Lea bag', 'la lea rossa e ancora disponibile?'), sc('mario1985@gmail.com','Info Lea bag','la lea rossa e ancora disponibile?'));
t('11 altro anno di nascita nuovo cliente', !spam('giulia2000@gmail.com', 'domanda', 'ci sta un portatile dentro la nina?'));
t('12 il commercialista che parla di PayPal e commissioni', !spam('smonetti@studiocssf.it', 'Re: Pagamenti collaboratrici tramite PayPal', 'ok per la commissione, procedo con il bonifico'), sc('smonetti@studiocssf.it','Re: Pagamenti collaboratrici tramite PayPal','ok per la commissione, procedo'));
t('13 cliente che chiede della commissione PayPal (pitch da solo = 2 < 3)', !spam('marco.rossi@gmail.com', 'pagamento', 'quanto e la commissione se pago con paypal?'));
t('14 domanda ambigua da throwaway debole -> lasciata a Gemini, non spam', !spam('marryjohny631@gmail.com', '', 'Amimi you send across countries?'), sc('marryjohny631@gmail.com','','Amimi you send across countries?'));
t('15 emoji NON e lettera fancy (ciao con manina)', !spam('vobrightluv@gmail.com', 'Domanda veloce', 'Ciao \u{1F44B}, sto parlando col proprietario?'), sc('vobrightluv@gmail.com','Domanda veloce','Ciao \u{1F44B} sto parlando col proprietario?'));
t('16 fornitore pelli, dominio proprio', !spam('info@damapel.it', 'Cocco', 'Vi allego la foto del cocco nero disponibile'));
t('17 una sola lettera fancy non basta (serve >= 3)', !spam('anna.verdi@gmail.com', 'info', 'la \u{1D400} borsa'), sc('anna.verdi@gmail.com','info','la \u{1D400} borsa'));
t('18 cliente che scrive "potenziale" senza altri segnali', !spam('laura.b@libero.it', 'idea', 'questa borsa ha un gran potenziale secondo me'));

console.log('\n== struttura del punteggio ==');
t('19 soglia = 3', SPAM_THRESHOLD === 3, SPAM_THRESHOLD);
t('20 math da solo (3) basta', sc('x@gmail.com', '', '\u{1D5D4}\u{1D5D5}\u{1D5D6} bold') >= 3);
t('21 pitch da solo (2) NON basta', sc('x@gmail.com', '', 'I reviewed your store') === 2);
t('22 throwaway debole da solo (1) NON basta', sc('anna1234@gmail.com', 'ciao', 'vorrei info') === 1);
t('23 i motivi sono elencati per l audit', vendorSpamScore('kamalgrowth7@gmail.com', 'x', 'I reviewed your store').reasons.length >= 2);

console.log(`\n${ok}/${ok + ko} verdi`);
if (ko) process.exit(1);
