// tests/cs_chat_decisioni_25_11.mjs (nel glob tests/cs_*.mjs della CI): le decisioni di Dan del 25 novembre 2026 sulla chat
// del sito e sulle bozze email di Assistenza (migr 0211, cs-assist v34): reso come la chat (P2), ritiro anche per pre-ordini
// e su misura, dazi fuori UE pagati da Amimì, nome vero del pulsante di riassortimento (P3 e voce 11), titolo dell'email di
// ritiro in inglese (voce 2). Nessuna rete, nessun DB.
//   node tests/cs_chat_decisioni_25_11.mjs
// Tre parti: cosa tocca la 0211; i fatti (anche nel codice di cs-assist); le guardie finali scattano sui testi vecchi e
// tacciono sui nuovi (autocontrollo).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 300) : '')); } };

const M = read('supabase/migrations/0211_cs_reso_dazi_preordini.sql');
const M0195 = read('supabase/migrations/0195_chat_testi_bottoni.sql');
const ASSIST = read('supabase/functions/cs-assist/index.ts');
const corpo = M.replace(/--.*$/gm, '');
const sql = (s) => "'" + s.replace(/'/g, "''") + "'";
const voce = (handle) => (M0195.match(new RegExp(`\\('risposta_chat', '${handle}:(?:[^']|'')*', (?:null|'(?:[^']|'')*'),\\s*\\$t\\$([\\s\\S]*?)\\$t\\$,\\s*\\$t\\$([\\s\\S]*?)\\$t\\$`)) ?? ['', '', '']);

// le coppie (vecchio -> nuovo) decise il 25-11, per esteso: la migrazione deve contenerle alla lettera
const COPPIE = [
  { r: 'f13 it', vecchio: "La richiesta va fatta entro 14 giorni dalla consegna e la spedizione di reso e' a carico del cliente. Appena riceviamo la borsa procediamo con il rimborso, entro 14 giorni sul metodo di pagamento originale",
    nuovo: "La richiesta va fatta entro 14 giorni dalla consegna e la spedizione di reso e' a carico del cliente: non forniamo etichette di reso. Gli articoli fatti su misura o su ordine speciale non si possono restituire. Appena riceviamo la borsa e controlliamo che sia in perfette condizioni, procediamo con il rimborso sul metodo di pagamento originale, entro 14 giorni", reso: true },
  { r: 'f13 en', vecchio: "Requests must be made within 14 days of delivery and return shipping is at the customer's expense. As soon as we receive the bag we'll process the refund within 14 days to the original payment method",
    nuovo: "Requests must be made within 14 days of delivery and return shipping is at the customer's expense: we do not provide return labels. Made-to-measure and special-order items cannot be returned. As soon as we receive the bag and check that it is in perfect condition, we'll process the refund to the original payment method within 14 days", reso: true },
  { r: 'f5 it', vecchio: 'Appena ci arriva la borsa procediamo col rimborso, entro 14 giorni sul metodo di pagamento originale',
    nuovo: 'Appena ci arriva la borsa e controlliamo che sia in perfette condizioni, procediamo col rimborso, entro 14 giorni sul metodo di pagamento originale', reso: true },
  { r: 'k2 rimborso', vecchio: 'rimborso entro 14 giorni dal rientro sul metodo di pagamento originale;',
    nuovo: "rimborso sul metodo di pagamento originale entro 14 giorni dall'accettazione del reso, dopo il controllo delle condizioni;", reso: true },
  { r: 'k2 ritiro', vecchio: 'RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano (non per pre-ordini o personalizzati), in portineria,',
    nuovo: 'RITIRO ORDINI ONLINE: Via Santa Maria Fulcorina 13, 20123 Milano, in portineria,' },
  { r: 'k8', vecchio: 'Entro: istruzioni + link resi, spese di rientro a carico del cliente, rimborso entro 14 giorni dal rientro.',
    nuovo: "Entro: istruzioni + link resi, spese di rientro a carico del cliente (niente etichette di reso), rimborso entro 14 giorni dall'accettazione del reso, dopo il controllo delle condizioni.", reso: true },
  { r: 'f39 it', vecchio: "Fuori dall'Unione Europea dazi e tasse di importazione sono a carico di chi riceve il pacco.",
    nuovo: "Per le spedizioni fuori dall'Unione Europea dazi e tasse di importazione li paga Amimì.", chat: true, dazi: true },
  { r: 'f39 en', vecchio: 'Outside the European Union, import duties and taxes are paid by the recipient.',
    nuovo: 'For shipments outside the European Union, import duties and taxes are paid by Amimì.', chat: true, dazi: true },
  { r: 'f8 it', vecchio: 'Iscriviti al "torna disponibile" sulla pagina del prodotto ([link])',
    nuovo: 'Tocca "Avvisami quando torna disponibile" sulla pagina del prodotto ([link])', pulsante: true },
  { r: 'f8 en', vecchio: 'Sign up for the "back in stock" alert on the product page ([link])',
    nuovo: 'Tap "Avvisami quando torna disponibile" (notify me when it is back in stock) on the product page ([link])', pulsante: true },
  { r: 'k5', vecchio: 'invita a iscriversi al "torna disponibile" sulla pagina prodotto',
    nuovo: 'invita a toccare "Avvisami quando torna disponibile" sulla pagina prodotto', pulsante: true },
  { r: 'f47 en', vecchio: 'On the page of a sold-out product there is a button to be notified when it is back in stock:',
    nuovo: 'On the page of a sold-out product there is a button, "Avvisami quando torna disponibile" (notify me when it is back in stock):', chat: true, pulsante: true },
  { r: 'f38 en', vecchio: 'Please come only after you have received the email telling you that your order is ready for pickup.',
    nuovo: 'Please come only after you have received the email "Your order is ready for pickup".', chat: true },
];
const di = (r) => COPPIE.find((c) => c.r === r);

// ---- parte 1: cosa tocca ----
console.log('\n== migrazione 0211: cosa tocca ==');
const scritture = [...corpo.matchAll(/\b(insert into|update|delete from|alter table|create|drop)\s+([a-z_.]+)/gi)].map((m) => m[1].toLowerCase() + ' ' + m[2]);
t('T1 solo UPDATE su cs_knowledge e cs_faq (niente insert, delete, DDL, app_flags)', scritture.length > 0 && scritture.every((s) => s === 'update cs_knowledge' || s === 'update cs_faq'), scritture);
const idK = [...corpo.matchAll(/update cs_knowledge[\s\S]*?where id = (\d+);/g)].map((m) => +m[1]);
const idF = [...corpo.matchAll(/update cs_faq[\s\S]*?where id = (\d+);/g)].map((m) => +m[1]);
t('T2 righe: cs_faq 13, 5, 39, 8, 47, 38 e cs_knowledge 2, 8, 5, una UPDATE ciascuna', JSON.stringify(idK) === '[2,8,5]' && JSON.stringify(idF) === '[13,5,39,8,47,38]', { idK, idF });
const guardie = [...corpo.matchAll(/if n <> 1 then\s+raise exception '(cs_knowledge|cs_faq) id (\d+): testo atteso non trovato/g)].map((m) => m[1].slice(3, 4) + m[2]);
t('T3 ogni UPDATE ha prima la sua guardia "testo atteso non trovato" (riga cambiata a mano, anche dalla scheda Chat = stop)', JSON.stringify(guardie) === '["f13","f5","k2","k8","f39","f8","k5","f47","f38"]', guardie);
const finale = (corpo.match(/-- Guardia finale[\s\S]*?raise exception 'restano/) ?? [''])[0] || corpo.slice(corpo.indexOf("select contenuto as t from cs_knowledge where attiva"), corpo.indexOf("raise exception 'restano"));
t('T4 un blocco solo, con guardia finale sulle righe attive di tutte e due le tabelle, controlli positivi e tetto dei 6.000 caratteri della 0174', (corpo.match(/^do \$\$/gm) ?? []).length === 1 && /end \$\$;\s*$/.test(corpo)
  && /select contenuto as t from cs_knowledge where attiva\s+union all select coalesce\(testo_it, ''\) \|\| ' ' \|\| coalesce\(testo_en, ''\) from cs_faq where attiva\s+\) s where s\.t ~\*/.test(corpo)
  && /if n <> 0 then\s+raise exception 'restano % righe cs_\* attive con testi superati dalle decisioni del 25-11/.test(corpo)
  && /if n <> 6 then\s+raise exception 'frasi nuove in % righe di cs_faq su 6'/.test(corpo) && /if n <> 3 then\s+raise exception 'frasi nuove in % righe di cs_knowledge su 3'/.test(corpo)
  && /if peggiore > 6000 then/.test(corpo) && /regexp_matches\(r\.s, '\[\\U00010000-\\U0010FFFF\]', 'g'\)/.test(corpo)
  && /where k\.attiva and \(k\.categoria is null or k\.categoria = c\.categoria\)/.test(corpo), finale.slice(0, 80));
t('T5 tipi: A7 e A2 risposte standard, la 5 esempio di tono, 39, 47 e 38 voci della chat; categorie delle righe di conoscenza',
  /where id = 13 and tipo = 'risposta_standard'/.test(corpo) && /where id = 8 and tipo = 'risposta_standard'/.test(corpo) && /where id = 5 and tipo = 'esempio_tono'/.test(corpo)
  && [39, 47, 38].every((id) => new RegExp(`where id = ${id} and tipo = 'risposta_chat'`).test(corpo))
  && /where id = 2 and categoria is null/.test(corpo) && /where id = 8 and categoria = 'Reso e rimborso'/.test(corpo) && /where id = 5 and categoria = 'Restock e disponibilita'/.test(corpo));
const mancanti = COPPIE.filter((c) => !corpo.includes(sql(c.vecchio)) || !corpo.includes(sql(c.nuovo))).map((c) => c.r);
t('T6 ogni frase vecchia e nuova decisa il 25-11 e\' nella migrazione alla lettera', mancanti.length === 0, mancanti);
const occorrenze = (x) => corpo.split(sql(x)).length - 1;
const contate = COPPIE.map((c) => [c.r, occorrenze(c.vecchio)]).filter(([, n]) => n !== 2);
t('T7 ogni frase vecchia compare due volte, nella guardia e nella replace: un refuso in una sola delle due si vede', contate.length === 0, contate);
// ogni ramo dei controlli positivi deve davvero cercare qualcosa (Gate 2, C3): niente "(id = 38)" da solo
const posF = corpo.slice(corpo.indexOf('-- Controllo positivo') >= 0 ? 0 : 0, corpo.length);
const bloccoF = (corpo.match(/select count\(\*\) into n from cs_faq\s+where \(id = 13[\s\S]*?if n <> 6 then/) ?? [''])[0];
const bloccoK = (corpo.match(/select count\(\*\) into n from cs_knowledge\s+where \(id = 2 [\s\S]*?if n <> 3 then/) ?? [''])[0];
const rami = (b) => b.split(/\n\s+or \(|where \(/).slice(1);
t('T8 controlli positivi dopo le UPDATE e prima del tetto, ogni ramo con almeno un position(...) > 0',
  bloccoF && bloccoK && rami(bloccoF).length === 6 && rami(bloccoK).length === 3 && [...rami(bloccoF), ...rami(bloccoK)].every((r) => /position\('[^']/.test(r) && /\) > 0/.test(r))
  && corpo.indexOf(bloccoF) > corpo.lastIndexOf('update cs_faq') && corpo.indexOf(bloccoK) < corpo.indexOf('if peggiore > 6000') && posF.length > 0, { f: rami(bloccoF).length, k: rami(bloccoK).length });
// la voce 2 (38) e la 47 si toccano solo in inglese: la UPDATE della 38 e della 47 non nomina testo_it (Gate 2, C3: lo slice
// del primo test cercava i commenti in un testo senza commenti)
const upd = (id) => { const fine = corpo.indexOf(`where id = ${id};`, corpo.indexOf(`raise exception 'cs_faq id ${id}:`)); const ini = corpo.lastIndexOf('update cs_faq', fine); return ini >= 0 && fine > ini ? corpo.slice(ini, fine) : ''; };
t('T9 voce 2 e voce 11 toccate solo in inglese; l\'italiano della voce 2 resta com\'e\'', upd(38) && upd(47) && !/testo_it/.test(upd(38)) && !/testo_it/.test(upd(47)) && /testo_en = replace\(testo_en,/.test(upd(38)), { u38: upd(38).slice(0, 60) });

// ---- parte 2: i fatti ----
console.log('\n== i fatti ==');
const [, v7it, v7en] = voce('faq-reso-e-spedizione-reso');
const a7it = di('f13 it').nuovo, a7en = di('f13 en').nuovo;
t('F1 A7 dice le cose della voce 7 della chat: niente etichette, su misura e ordini speciali non restituibili, rimborso dopo il controllo delle condizioni',
  /non forniamo etichette di reso/.test(v7it) && /non forniamo etichette di reso/.test(a7it) && /su misura o su ordine speciale/.test(v7it) && /su misura o su ordine speciale non si possono restituire/.test(a7it)
  && /perfette condizioni/.test(v7it) && /controlliamo che sia in perfette condizioni, procediamo con il rimborso/.test(a7it)
  && /do not provide return labels/.test(v7en) && /we do not provide return labels/.test(a7en) && /Made-to-measure and special-order items/.test(v7en) && /Made-to-measure and special-order items cannot be returned/.test(a7en)
  && /check that it is in perfect condition, we'll process the refund/.test(a7en), { v7it, a7it });
t('F2 reso: nessuna frase nuova fa partire il rimborso "appena arriva la borsa" o "dal rientro"', COPPIE.filter((c) => c.reso).every((c) => !/(riceviamo|arriva) la borsa procediamo|receive the bag we'll|dal rientro/.test(c.nuovo)));
t('F3 conoscenza (righe 2 e 8): rimborso entro 14 giorni dall\'accettazione del reso, come la voce 7 ("dall\'accettazione del reso")', /dall'accettazione del reso/.test(v7it)
  && /entro 14 giorni dall'accettazione del reso, dopo il controllo delle condizioni/.test(di('k2 rimborso').nuovo) && /entro 14 giorni dall'accettazione del reso, dopo il controllo delle condizioni/.test(di('k8').nuovo));
const righeReso = ASSIST.split('\n').filter((l) => /Reso AMMESSO: consegnato il/.test(l));
t('F4 cs-assist v34: le due righe del reso ammesso (ramo e blocco CASO) come A7 (etichette solo sui resi, comportamento in cs_rami 112-113), mai piu\' "dal rientro"', righeReso.length === 2
  && righeReso.every((l) => l.includes("${categoria === 'Reso e rimborso' ? ', niente etichette di reso' : ''}; rimborso sul metodo originale entro 14 giorni dall'accettazione del reso, dopo il controllo che sia in perfette condizioni.") && !/dal rientro/.test(l))
  && !/dal rientro/.test(ASSIST.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')) && /^\/\/ sorgente v34 \(2026-11-25/m.test(ASSIST), righeReso.map((l) => l.trim().slice(0, 60)));
t('F5 la riga 2 non esclude piu\' pre-ordini e su misura dal ritiro, il resto della frase resta', !/pre-ordini|personalizzati/.test(di('k2 ritiro').nuovo) && di('k2 ritiro').nuovo === di('k2 ritiro').vecchio.replace(' (non per pre-ordini o personalizzati)', ''));
const dazi = COPPIE.filter((c) => c.dazi);
t('F6 dazi: la voce 3 dice in italiano e inglese che fuori UE li paga Amimì, mai piu\' "chi riceve" / "recipient"', dazi.every((c) => /Amimì\.$/.test(c.nuovo) && !/chi riceve|recipient/.test(c.nuovo)) && /fuori dall'Unione Europea/.test(dazi[0].nuovo) && /outside the European Union/.test(dazi[1].nuovo));
const NOME = 'Avvisami quando torna disponibile';
t('F7 il pulsante si chiama come sul sito (letto il 25-11, anche su /en/) e come lo nominano la voce 11 italiana e cs-assist', COPPIE.filter((c) => c.pulsante).every((c) => c.nuovo.includes(`"${NOME}"`))
  && voce('faq-riassortimento')[1].includes(`"${NOME}"`) && ASSIST.includes(`bottone "${NOME}"`));
t('F8 voce 2 in inglese: il titolo dell\'email standard di Shopify per il ritiro', di('f38 en').nuovo.includes('"Your order is ready for pickup"') && voce('faq-ritiro-di-persona')[1].includes('"il tuo ordine è pronto per il ritiro"'));
t('F9 niente segnaposto, link, email o telefono nelle frasi nuove della chat', COPPIE.filter((c) => c.chat).every((c) => !/[{}\[\]]|https?:|www\.|@|\+39/.test(c.nuovo)));

// ---- parte 3: autocontrollo della guardia finale ----
console.log('\n== guardia finale: scatta sui testi vecchi, tace sui nuovi ==');
const re = new RegExp((corpo.match(/s\.t ~\* '((?:[^']|'')+)'/) ?? ['', '$^'])[1].replace(/''/g, "'"), 'i');
const coperte = COPPIE.filter((c) => !['f47 en', 'f38 en'].includes(c.r));
t('G1 la guardia finale vede ogni frase vecchia di reso, ritiro, dazi, A2 e riga 5', coperte.every((c) => re.test(c.vecchio)), coperte.filter((c) => !re.test(c.vecchio)).map((c) => c.r));
t('G2 e non vede nessuna frase nuova', COPPIE.every((c) => !re.test(c.nuovo)), COPPIE.filter((c) => re.test(c.nuovo)).map((c) => c.r));
t('G3 e vede le varianti della stessa frase vecchia ("iscriversi al", "iscriviti al") e "dal rientro" ovunque', re.test('invita a iscriversi al "torna disponibile"') && re.test('Iscriviti al "torna disponibile"') && re.test('rimborso entro 14 giorni dal rientro.'));

console.log(`\ncs_chat_decisioni_25_11: ${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
