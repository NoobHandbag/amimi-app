// tests/cs_crop.mjs — il CROP delle email (body_clean), ritagliato DAL SORGENTE che va in
// produzione (blocco PURE:cs-crop di cs-sync): se il codice cambia, il test rompe.
// Nessuna rete, nessun database.
//   node tests/cs_crop.mjs
//
// Perche' esiste. Il 2026-08-02 la UAT dell'owner ha trovato che nella bolla comparivano ancora
// citazioni, forward, firme dei client di posta e la nostra intera mail precedente. Le cause erano
// QUATTRO e distinte, tutte misurate su `cs_messages`:
//   (A) l'attribution italiana pretendeva la parola "giorno", che le mail vere non scrivono;
//   (B) ogni marcatore pretendeva un a capo prima, e c'e' chi manda il corpo su UNA riga sola;
//   (C) "Messaggio Inoltrato" non era in lista;
//   (D) la firma si tagliava solo se la riga era ESATTAMENTE "--".
//
// I casi qui sotto hanno la STESSA FORMA dei cinque messaggi reali del brief, con nomi e indirizzi
// inventati: questo repository e' PUBBLICO e la posta delle clienti non ci entra. Le lunghezze
// attese sui messaggi veri si verificano a database, non qui.
//
// La seconda meta' del file conta quanto la prima: un crop piu' aggressivo rischia di mangiarsi il
// testo vero. I casi "NON deve tagliare" sono la guardia contro quell'errore.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FN = (n) => `${ROOT}supabase/functions/${n}/index.ts`;
const BEGIN = '// ==== PURE:cs-crop BEGIN ====';
const END = '// ==== PURE:cs-crop END ====';

function ritaglia(file) {
  const s = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const a = s.indexOf(BEGIN), b = s.indexOf(END);
  if (a < 0 || b < 0) throw new Error(`marcatori PURE:cs-crop non trovati in ${file}`);
  return s.slice(a + BEGIN.length, b).trim();
}

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra).slice(0, 300) : '')); } };

const TMP = `${ROOT}tests/_crop.tmp.ts`;
writeFileSync(TMP, `${ritaglia(FN('cs-sync'))}\nexport { stripQuoted, stripQuote, extractOrderNumber };\n`, 'utf8');
let stripQuoted, stripQuote, extractOrderNumber;
try { ({ stripQuoted, stripQuote, extractOrderNumber } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

// ---------------------------------------------------------------------------------------------
console.log('\n== causa A: l\'attribution italiana senza la parola "giorno" ==');

t('1  "Il 22/07/2026 10:13, X ha scritto:" (Thunderbird)',
  stripQuoted('Buongiorno,\n\ndi seguito l\'indirizzo.\n\nMaria\n\nIl 22/07/2026 10:13, Assistenza ha scritto:\n> testo nostro precedente')
  === 'Buongiorno,\n\ndi seguito l\'indirizzo.\n\nMaria');

t('2  "Il 31 Luglio 2026, alle 17:14:05 UTC X<mail> ha scritto:" (Libero)',
  stripQuoted('ok per me\n\nIl 31 Luglio 2026, alle 17:14:05 UTC Assistenza<info@example.com> ha scritto:\nCiao, ti scriviamo in merito...')
  === 'ok per me');

t('3  "Il giorno ... ha scritto:" continua a funzionare (nessuna regressione)',
  stripQuoted('grazie mille\n\nIl giorno mer 30 lug 2026 alle ore 10:00 Assistenza <info@example.com> ha\nscritto:\n> vecchio')
  === 'grazie mille');

t('3b "Il Gio 23 Lug 2026, 15:05 X <mail> ha scritto:" (Gmail mobile, i 3 residui del collaudo)',
  stripQuoted('Grazie mille\n\nIl Gio 23 Lug 2026, 15:05 Assistenza <info@example.com> ha scritto:')
  === 'Grazie mille', stripQuoted('Grazie mille\n\nIl Gio 23 Lug 2026, 15:05 Assistenza <info@example.com> ha scritto:'));

t('3c la stessa forma col giorno in minuscolo e il punto',
  stripQuoted('va bene\n\nIl lun. 20 Lug 2026, 10:16 amimi <info@example.com> ha scritto:') === 'va bene');

t('4  l\'attribution che va a capo nel mezzo',
  stripQuoted('va bene\n\nIl 22/07/2026 10:13, Assistenza\n<info@example.com> ha scritto:\nvecchio testo')
  === 'va bene');

// ---------------------------------------------------------------------------------------------
console.log('\n== causa B: il corpo su UNA riga sola (il caso peggiore misurato: 1.062 char, zero \\n) ==');

const UNA_RIGA = 'Va bene la borsa con un gift Grazie -- Inviato da Libero Mail '
  + 'Il 31 Luglio 2026, alle 17:14:05 UTC Assistenza<info@example.com> ha scritto: '
  + 'Ciao Anna, ti contattiamo in merito al tuo recente ordine. Purtroppo, a causa di un errore '
  + 'di sistema, la borsa che hai acquistato risulta esaurita. Per scusarci possiamo offrirti una '
  + 'delle seguenti soluzioni: la spedizione con un gift in omaggio; oppure con uno sconto '
  + 'dedicato. Un caro saluto, Il Team -- Amimi https://example.com/';

t('5  restano SOLO le parole della cliente', stripQuoted(UNA_RIGA) === 'Va bene la borsa con un gift Grazie', stripQuoted(UNA_RIGA));
t('6  e non e\' piu\' lungo del testo utile', (stripQuoted(UNA_RIGA) ?? '').length < 40, (stripQuoted(UNA_RIGA) ?? '').length);

t('7  attribution a meta\' riga senza firma in mezzo',
  stripQuoted('confermo tutto Il 22/07/2026 10:44, Assistenza ha scritto: testo vecchio molto lungo')
  === 'confermo tutto');

// ---------------------------------------------------------------------------------------------
console.log('\n== causa C: il forward italiano ==');

t('8  "-------- Messaggio Inoltrato --------"',
  stripQuoted('allego anche copia ordine\nCordiali saluti\nMaria\n\n-------- Messaggio Inoltrato --------\nOggetto: \tRe: RICHIESTA\nData: \tWed, 22 Jul 2026 10:36:52 +0200\nMittente: \tMaria Bianchi <maria@example.com>\nA: \tAssistenza <info@example.com>\n\nBuongiorno,\n\ntesto inoltrato')
  === 'allego anche copia ordine\nCordiali saluti\nMaria');

t('9  "Forwarded message" inglese',
  stripQuoted('vedi sotto\n\n---------- Forwarded message ----------\nFrom: x@example.com') === 'vedi sotto');

t('10 "Messaggio originale" continua a funzionare',
  stripQuoted('ecco\n\n-------- Messaggio originale --------\nDa: x@example.com') === 'ecco');

// ---------------------------------------------------------------------------------------------
console.log('\n== causa D: le firme ==');

t('11 riga esattamente "--" (nessuna regressione)',
  stripQuoted('Buongiorno,\nvi scrivo per un reso.\n\n--\nMaria Bianchi\nTel 000') === 'Buongiorno,\nvi scrivo per un reso.');

t('12 "-- Inviato da Libero Mail" (marcatore e testo sulla stessa riga)',
  stripQuoted('grazie mille\n\n-- Inviato da Libero Mail') === 'grazie mille');

t('13 "Inviato da iPhone" senza i due trattini',
  stripQuoted('ok perfetto\n\nInviato da iPhone') === 'ok perfetto');

t('14 "Inviato dal mio iPhone"',
  stripQuoted('ci sentiamo\n\nInviato dal mio iPhone') === 'ci sentiamo');

t('15 "Sent from my iPhone"',
  stripQuoted('thanks a lot\n\nSent from my iPhone') === 'thanks a lot');

t('16 "Inviato da Outlook per Android"',
  stripQuoted('va benissimo\n\nInviato da Outlook per Android') === 'va benissimo');

t('17 "Get Outlook for iOS"',
  stripQuoted('perfect\n\nGet Outlook for iOS') === 'perfect');

t('18 le righe fra asterischi in coda',
  stripQuoted('Ciao,\n\nho ricevuto la borsa e mi piace tanto.\n\nGrazie mille!\n\n*Cordiali Saluti*\n\n*Maria Bianchi*\n\n*MAIL: maria@example.com <maria@example.com> *')
  === 'Ciao,\n\nho ricevuto la borsa e mi piace tanto.\n\nGrazie mille!');

t('19 il NOSTRO footer quando viene citato',
  stripQuoted('Un caro saluto,\nIl Team\n\n-- Amimi https://example.com/ https://www.instagram.com/esempio/')
  === 'Un caro saluto,\nIl Team');

// ---------------------------------------------------------------------------------------------
console.log('\n== la guardia che conta: il crop NON deve mangiarsi il testo vero ==');

const NON_TOCCARE = [
  ['20 "Il corriere mi ha scritto:" non e\' un\'attribution (manca la data)',
    'Il corriere mi ha scritto: consegna prevista domani. Confermate?'],
  ['21 "il pacco e\' stato inviato da Poste Italiane"',
    'Buongiorno, il pacco e\' stato inviato da Poste Italiane la settimana scorsa.'],
  ['22 "me lo ha inviato da Milano una mia amica"',
    'Ho ricevuto la borsa: me lo ha inviato da Milano una mia amica, e vorrei cambiarla.'],
  ['23 un trattino singolo a inizio riga e un elenco',
    'Vorrei sapere:\n- se avete la borsa in nero\n- e quanto costa la spedizione'],
  ['24 messaggio pulito e corto',
    'ok grazie!'],
  ['25 "Sent from my colleague" non e\' una firma di client',
    'The parcel was sent from my colleague in Rome, can you check?'],
  ['26 una data nel testo senza "ha scritto:"',
    'Ho ordinato Il 22/07/2026 e non ho ancora ricevuto niente, potete controllare?'],
  // I tre casi qui sotto vengono da una verifica avversariale del 02-08 e sono il motivo per cui il
  // marcatore pretende ANNO e ORA insieme. Il 26b e' un difetto LATENTE della v15 spedita stamattina:
  // "il giorno" apriva l'alternativa e la frase veniva troncata a "Ho ricevuto il pacco,".
  ['26a giorno della settimana + data completa, ma nessuna ora: e\' prosa',
    'Il mar. 4 agosto 2026 il vicino mi ha scritto: pacco ritirato, tutto bene'],
  ['26b REGRESSIONE v15: "il giorno dopo ... mi ha scritto:"',
    'Ho ricevuto il pacco, il giorno dopo il corriere mi ha scritto: consegna riuscita'],
  ['26c un\'ora senza anno non e\' un\'attribution',
    'Il pacco e\' arrivato alle 15:30 e mia sorella mi ha scritto: tutto ok'],
  ['26d "Il giorno" nudo senza data ne\' ora',
    'Il giorno della consegna nessuno mi ha scritto: sono rimasta senza notizie'],
];
for (const [nome, testo] of NON_TOCCARE) t(nome, stripQuoted(testo) === testo, { atteso: testo, avuto: stripQuoted(testo) });

t('27a una riga divisoria di trattini NON e\' una firma (titolo sottolineato)',
  stripQuoted('Nuova disputa per l\'ordine aperta\n---------------------------------\nIl cliente ha presentato una disputa per l\'ordine #1506.')
  === 'Nuova disputa per l\'ordine aperta\n---------------------------------\nIl cliente ha presentato una disputa per l\'ordine #1506.',
  stripQuoted('Nuova disputa per l\'ordine aperta\n---------------------------------\nIl cliente ha presentato una disputa per l\'ordine #1506.'));

t('27 un messaggio TUTTO fra asterischi non sparisce',
  stripQuoted('*grazie mille davvero*') === '*grazie mille davvero*', stripQuoted('*grazie mille davvero*'));

t('28 testo vero + citazione: non torna mai NULL',
  stripQuoted('ok\n\nIl 22/07/2026 10:13, Assistenza ha scritto:\nvecchio') === 'ok');

t('29 messaggio che e\' SOLO una citazione -> NULL (la UI ripiega sul grezzo)',
  stripQuoted('Il 22/07/2026 10:13, Assistenza ha scritto:\nvecchio testo') === null);

t('30 stringa vuota -> NULL', stripQuoted('') === null && stripQuoted('   ') === null);

// ---------------------------------------------------------------------------------------------
console.log('\n== body_text (stripQuote) taglia le citazioni ma NON le firme ==');
// body_text e la rete di sicurezza e il contenuto di "Email completa": la firma deve restare
// visibile espandendo, altrimenti il toggle non mostra piu' niente di diverso.

t('31 stripQuote taglia la citazione',
  stripQuote('ok grazie!\n\nIl 22/07/2026 10:44, Assistenza ha scritto:\nvecchio') === 'ok grazie!');

t('32 stripQuote NON taglia la firma',
  stripQuote('grazie mille\n\n-- Inviato da Libero Mail') === 'grazie mille\n\n-- Inviato da Libero Mail');

t('33 stripQuote non torna mai null (e una string)',
  typeof stripQuote('') === 'string');

// ---------------------------------------------------------------------------------------------
console.log('\n== il numero d\'ordine scritto senza cancelletto (Parte 5.1) ==');
// Caso reale: la cliente scrive TRE volte "ordine del 23 luglio 2026 n. 1538" e la conversazione
// resta senza numero, perche' la regex pretendeva le cifre subito dopo "ordine".

t('34 il caso del brief: "ordine del 23 luglio 2026 n. 1538"',
  extractOrderNumber('informazioni su spedizione ordine del 23 luglio 2026 n. 1538') === 1538,
  extractOrderNumber('informazioni su spedizione ordine del 23 luglio 2026 n. 1538'));

t('35 "#1538" (nessuna regressione)', extractOrderNumber('il mio ordine #1538 e\' partito?') === 1538);
t('36 "ordine 1538"', extractOrderNumber('buongiorno, ordine 1538, quando arriva?') === 1538);
t('37 "ordine n. 1538"', extractOrderNumber('ordine n. 1538') === 1538);
t('38 "ordine nr 1538"', extractOrderNumber('ordine nr 1538') === 1538);
t('39 "numero 1538"', extractOrderNumber('vi scrivo per il numero 1538') === 1538);
t('40 "n° 1538"', extractOrderNumber('n° 1538, grazie') === 1538);
t('41 il cancelletto batte il "n." che viene prima',
  extractOrderNumber('il mio CAP e\' n. 20152 e l\'ordine #1538 non arriva') === 1538,
  extractOrderNumber('il mio CAP e\' n. 20152 e l\'ordine #1538 non arriva'));
t('42 un ANNO dopo un "n." nudo non e\' un ordine',
  extractOrderNumber('ho ordinato il 23 luglio, pratica n. 2026') === null,
  extractOrderNumber('ho ordinato il 23 luglio, pratica n. 2026'));
t('43 ma con "ordine" davanti al numero si crede al numero',
  extractOrderNumber('ordine 2026') === 2026);
t('44 nessun numero -> null', extractOrderNumber('vorrei sapere quando arriva la mia borsa') === null);
t('45 una data non e\' un ordine', extractOrderNumber('ho ordinato il 23 luglio 2026') === null,
  extractOrderNumber('ho ordinato il 23 luglio 2026'));

console.log(`\n${ok}/${ok + ko} verdi` + (ko ? ` — ${ko} ROSSI` : ''));
process.exitCode = ko ? 1 : 0;
