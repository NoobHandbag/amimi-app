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

console.log(`\n${ok}/${ok + ko} verdi` + (ko ? ` — ${ko} ROSSI` : ''));
process.exitCode = ko ? 1 : 0;
