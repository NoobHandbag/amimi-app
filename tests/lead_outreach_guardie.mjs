// tests/lead_outreach_guardie.mjs — guardie di invio della edge lead-outreach (bozze AI B2B), ritagliate
// DAL SORGENTE che va in produzione (blocco PURE:lead-guard): se il codice cambia, il test rompe.
// Piu' asserzioni sul sorgente per le regole che non stanno nel blocco puro (flag, claim, vincoli). Nessuna rete/DB.
//   node tests/lead_outreach_guardie.mjs
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BEGIN = '// ==== PURE:lead-guard BEGIN ====';
const END = '// ==== PURE:lead-guard END ====';
const src = readFileSync(`${ROOT}supabase/functions/lead-outreach/index.ts`, 'utf8').replace(/\r\n/g, '\n');
const mig = readFileSync(`${ROOT}supabase/migrations/0139_lead_outreach_ai.sql`, 'utf8');
const a = src.indexOf(BEGIN), b = src.indexOf(END);
if (a < 0 || b < 0) { console.error('marcatori PURE:lead-guard non trovati in lead-outreach'); process.exit(1); }
const TMP = `${ROOT}tests/_leadguard.tmp.ts`;
writeFileSync(TMP, `${src.slice(a + BEGIN.length, b).trim()}\nexport { bloccantiInvio, completaTesto, avvisiContenuto, segnapostoResidui, inizioGiornoRoma };\n`, 'utf8');
let bloccantiInvio, completaTesto, avvisiContenuto, segnapostoResidui, inizioGiornoRoma;
try { ({ bloccantiInvio, completaTesto, avvisiContenuto, segnapostoResidui, inizioGiornoRoma } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra) : '')); } };
const OPT = 'Se preferisce non ricevere altre email da parte mia, mi risponda "no grazie" e non la contatterò più.';
const body = 'Gentile team di Ivy,\nvi scrivo da Amimì Milano: borse artigianali fatte a mano, pelle Made in Italy. Vi va di fissare un appuntamento?\n\n' + OPT;
const pulita = { to: 'info@negozio.it', oggetto: 'Amimì Milano per Ivy', testo: body };

console.log('== invio: blocchi ==');
t('1  email pulita passa', bloccantiInvio(pulita).length === 0, bloccantiInvio(pulita));
t('2  segnaposto [DA VERIFICARE] blocca', bloccantiInvio({ ...pulita, testo: body + ' [DA VERIFICARE: link line sheet]' }).length === 1);
t('3  segnaposto {{referente}} rimasto blocca', bloccantiInvio({ ...pulita, testo: body + ' {{referente}}' }).length === 1);
t('4  segnaposto nell\'OGGETTO blocca', bloccantiInvio({ ...pulita, oggetto: 'Per [nome]' }).length === 1);
t('5  destinatario vuoto blocca', bloccantiInvio({ ...pulita, to: '' }).length === 1);
t('6  destinatario @amimi.it blocca', bloccantiInvio({ ...pulita, to: 'info@amimi.it' }).length === 1);
t('7  destinatario malformato blocca', bloccantiInvio({ ...pulita, to: 'negozio.it' }).length === 1);
t('8  oggetto vuoto blocca', bloccantiInvio({ ...pulita, oggetto: '  ' }).length === 1);
t('9  testo troppo corto blocca', bloccantiInvio({ ...pulita, testo: 'Ciao' }).some((b) => b.includes('troppo corto')));
t('10 segnapostoResidui trova entrambe le forme', segnapostoResidui('a [x] b {{y}}').length === 2);

console.log('== completaTesto ==');
const firma = 'Benedetta - Amimì Milano\nwholesale@amimi.it';
const c1 = completaTesto('Testo senza chiusura', firma, 'it');
t('11 aggiunge la firma se manca', c1.includes('Benedetta - Amimì Milano'));
t('12 aggiunge l\'opt-out italiano se manca', /no grazie/.test(c1));
const c2 = completaTesto(`Testo\n\n${firma}\n\nSe preferisce non ricevere altre email, mi risponda "no grazie".`, firma, 'it');
t('13 non duplica firma ne\' opt-out', c2.split('Benedetta - Amimì Milano').length === 2 && c2.split('no grazie').length === 2, c2);
t('14 opt-out inglese per lingua en', /no thanks/.test(completaTesto('Text', firma, 'en')));

console.log('== avvisi di contenuto (CONOSCENZA sez. 1) ==');
t('15 India segnalata', avvisiContenuto('Il cotone viene dall\'India').length >= 1);
t('16 cotone Made in Italy segnalato', avvisiContenuto('cotone colorato Made in Italy').length === 1);
t('17 pelle Made in Italy NON segnalata', avvisiContenuto('pelle Made in Italy').length === 0);
t('18 percentuale segnalata (condizioni non decise)', avvisiContenuto('margine del 30%').length === 1);

console.log('== sorgente e migrazione ==');
t('19 flag default OFF nella migrazione', /\('lead_outreach_ai_enabled', 'false'\)/.test(mig));
t('20 la edge rifiuta bozza e invio a flag spento', /if \(!enabled\) return json\(/.test(src));
t('21 send_key UNIQUE a DB', /unique index[^;]*lead_drafts \(send_key\)/i.test(mig));
t('22 un tocco per negozio a DB (in_invio/inviata)', /unique index[^;]*\(account_id, sequenza_tocco\)[^;]*in_invio[^;]*inviata/is.test(mig));
t('23 claim atomico su stato prima di Gmail', src.indexOf(".in('stato', ['proposta', 'approvata', 'errore'])") > 0 && src.indexOf(".in('stato', ['proposta', 'approvata', 'errore'])") < src.indexOf('/messages/send'));
t('24 tocco registrato con upsert ignoreDuplicates su gmail_message_id', /onConflict: 'gmail_message_id', ignoreDuplicates: true/.test(src));
t('25 niente thinkingConfig nelle chiamate Gemini', !/thinkingConfig\s*:/.test(src));
t('26 tetto giornaliero con conteggio head:true, sul giorno di Roma', src.includes("head: true }).or(`stato.eq.in_invio,sent_at.gte.${inizioGiornoRoma()}`)"));
t('27 verdetto "da_contattare" obbligatorio per l\'invio', /acc\.verdetto !== 'da_contattare'/.test(src));
t('28 JWT @amimi.it per tutte le azioni di una persona (il cron: test 82)', /endsWith\('@amimi\.it'\)\) return json\(\{ error: 'dominio non ammesso' \}, 403\)/.test(src));
// Regola 20a: ogni select supabase-js destruttura l'error (nessun `const { data: x } = await sb.from`)
t('29 nessuna lettura con error ignorato', !/const \{ data: \w+ \} = await (retryOnce\(\(\) => )?sb\.from/.test(src));

console.log('== fix della revisione Gate 2 (22-09) ==');
t('30 allegato promesso segnalato', avvisiContenuto('le allego il catalogo').length === 1);
t('31 conto vendita / ordine minimo segnalati', avvisiContenuto('conto vendita').length === 1 && avvisiContenuto('ordine minimo basso').length === 1);
t('32 giorno di Roma in estate (CEST): 00:30 a Roma = 22:00Z del giorno prima', inizioGiornoRoma(new Date('2026-09-22T22:30:00Z')) === '2026-09-22T22:00:00.000Z', inizioGiornoRoma(new Date('2026-09-22T22:30:00Z')));
t('33 giorno di Roma in inverno (CET)', inizioGiornoRoma(new Date('2026-12-10T12:00:00Z')) === '2026-12-09T23:00:00.000Z', inizioGiornoRoma(new Date('2026-12-10T12:00:00Z')));
t('34 bozza corta misurata PRIMA di firma e opt-out', src.indexOf('grezzo.length < 80') > 0 && src.indexOf('grezzo.length < 80') < src.indexOf('completaTesto(grezzo'));
t('35 tocco gia\' registrato a mano blocca l\'invio (prima del claim)', src.indexOf(".eq('sequenza_tocco', tocco)") > 0 && src.indexOf(".eq('sequenza_tocco', tocco)") < src.indexOf("update({ stato: 'in_invio'"));
t('36 un tocco email in uscita per negozio anche a DB', /unique index[^;]*lead_touches \(account_id, sequenza_tocco\)[^;]*direzione = 'out'/is.test(mig));
t('37 opt-out anche per INDIRIZZO, su tutti i negozi', /ilike\('email', to\.replace/.test(src));
t('38 rete giu\' durante l\'invio = esito incerto, bozza resta bloccata', /incerto: true/.test(src));
t('39 sblocca solo dopo 10 minuti e solo da in_invio', /\.eq\('stato', 'in_invio'\)\.lt\('updated_at', limite\)/.test(src));
t('40 follow-up nel thread del tocco precedente, senza "Re:" finto se manca', /const oggettoInvio = threadId\s*\n\s*\?[^\n]*prev\?\.subject[\s\S]{0,200}: oggetto\.replace\(\/\^\\s\*\(re\|r\)/.test(src));
t('41 id Gmail vuoto -> null, mai stringa vuota nella chiave UNIQUE', /\|\| null;/.test(src) && !/gmail_message_id: ''/.test(src));

console.log('== Gate 3 sul codice unito (revisione 22-09 notte) ==');
const chiusura4 = 'Gentile team,\nnon voglio disturbarla oltre. Le lascio il catalogo, se in futuro vorra’ inserire le nostre borse mi trova qui. Le auguro buon lavoro.\n\nBenedetta - Amimì Milano\nNon la contatterò ulteriormente salvo un suo cenno.';
t('42 tocco 4: la chiusura definitiva NON riceve anche la riga "no grazie"', !/no grazie/.test(completaTesto(chiusura4, firma, 'it')));
t('43 senza riga di opt-out l\'invio si blocca', bloccantiInvio({ ...pulita, testo: body.replace(OPT, '').trim() + ' Grazie.' }).some((b) => b.includes('opt-out')));
t('44 la chiusura del tocco 4 vale come opt-out', !bloccantiInvio({ ...pulita, testo: chiusura4 }).some((b) => b.includes('opt-out')));
t('45 tetto non numerico = invio fermo, non tetto disattivato', /Number\.isFinite\(tetto\)/.test(src) && !/Number\(flags\.lead_tetto_giornaliero/.test(src));
t('46 negozio scartato dopo la bozza: invio bloccato', src.indexOf("acc.stato_ricerca === 'rejected'") > src.indexOf("acc.verdetto !== 'da_contattare'"));
t('47 giorno di Roma indifferente ai secondi', inizioGiornoRoma(new Date('2026-09-22T22:30:45Z')) === '2026-09-22T22:00:00.000Z' && inizioGiornoRoma(new Date('2026-09-22T22:30:59.900Z')) === '2026-09-22T22:00:00.000Z');
t('48 follow-up con In-Reply-To/References dal messaggio precedente (scope readonly)', /In-Reply-To: \$\{inReplyTo\}/.test(src) && /googleAccessToken\(sa, SCOPE_READ\)/.test(src) && /format=metadata&metadataHeaders=Message-ID/.test(src));
t('49 header di reply mancanti = avviso, mai blocco dell\'invio', /warnings\.push\(`header di reply non impostati/.test(src));
t('50 chiave Gemini nell\'header, mai nell\'URL; errori ripuliti prima di arrivare alla UI (Gate 2 mat, A1)', /'x-goog-api-key': key/.test(src) && !/generateContent\?key=/.test(src.replace(/^\s*\/\/[^\n]*$/gm, '')) && /scrub\(\(e as Error\)\.message/.test(src));
// v4 (25-09): {{linesheet}} nei template viene dal flag; senza flag resta un [DA VERIFICARE], che bloccantiInvio ferma
const webApi = readFileSync(`${ROOT}web/src/lib/leadApi.ts`, 'utf8').replace(/\r\n/g, '\n');
t('51 {{linesheet}}: edge e compositore lo riempiono dal flag lead_linesheet_url, e senza flag resta un segnaposto bloccante', /linesheet: flags\.lead_linesheet_url \|\| '\[DA VERIFICARE: link line sheet\]'/.test(src) && /linesheet \|\| '\[LINK LINE SHEET: manca app_flags\.lead_linesheet_url\]'/.test(webApi) && bloccantiInvio({ ...pulita, testo: body + ' [DA VERIFICARE: link line sheet]' }).length === 1);
const mig145 = readFileSync(`${ROOT}supabase/migrations/0145_lead_outreach_contenuti.sql`, 'utf8').replace(/\r\n/g, '\n');
const mig145Sql = mig145.replace(/^\s*--[^\n]*$/gm, '');   // i commenti raccontano cosa si e' tolto: si valuta solo l'SQL
const [mig145Tpl, mig145Know = ''] = mig145Sql.split('insert into lead_knowledge');
t('52 migr 0145: template con il link (IT 1 e 4, EN 1 e 4), senza allegati, senza "come anticipato", senza prezzi promessi in pagina, senza minimi; knowledge senza percentuali ne listino; insert rieseguibile', (mig145Tpl.match(/\{\{linesheet\}\}/g) ?? []).length >= 4 && !/allego|come anticipato|catalogo wholesale/.test(mig145Sql) && !/con i prezzi|colori e prezzi|and prices/.test(mig145Tpl) && !/ordine minimo|minimo d.ordine|rischio zero|un paio di pezzi/.test(mig145Tpl) && !/\d+\s?%/.test(mig145Sql.replace(/100% naturale/g, '')) && !/\d+ \/ \d+/.test(mig145Know) && /lead_linesheet_url/.test(mig145Sql) && /where not exists/.test(mig145Know));
const tpl145 = [...mig145Tpl.matchAll(/E'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'").replace(/\\n/g, '\n').replace(/\{\{[a-z_]+\}\}/g, 'x'));
t('53 migr 0145: nessun template fa scattare avvisiContenuto (cotone/Italia, condizioni, allegati, percentuali)', tpl145.length >= 9 && tpl145.every((x) => avvisiContenuto(x).length === 0));
// v5 (03-10): mittente wholesale@ (alias sendAs di info@), con ripiego dichiarato su info@
const webOut = readFileSync(`${ROOT}web/src/pages/Outreach.tsx`, 'utf8').replace(/\r\n/g, '\n');
t('54 From = alias wholesale@ solo se Gmail lo da\' verificato; altrimenti info@ con avviso; la casella impersonata resta info@', /const FROM_ALIAS = 'wholesale@amimi\.it'/.test(src) && /const GMAIL_USER = 'info@amimi\.it'/.test(src) && /sub: GMAIL_USER/.test(src) && /verificationStatus === 'accepted'\) return \{ from: FROM_ALIAS/.test(src) && (src.match(/return \{ from: GMAIL_USER, avviso: /g) ?? []).length === 2 && /AbortSignal\.timeout\(5000\)/.test(src) && src.indexOf('await mittente(sa)', src.indexOf("action === 'diag'") + 600) > 0 && src.lastIndexOf('await mittente(sa)') < src.indexOf("stato: 'in_invio'", src.lastIndexOf('await mittente(sa)')) && src.lastIndexOf('await mittente(sa)') > src.indexOf('const warnings: string[]') && /<\$\{mitt\.from\}>/.test(src) && !/<\$\{GMAIL_USER\}>/.test(src) && /if \(mitt\.avviso\) warnings\.push\(mitt\.avviso\)/.test(src));
t('55 il compositore dichiara il mittente wholesale@ e mostra quello vero restituito dalla edge', /LEAD_MITTENTE = 'wholesale@amimi\.it'/.test(webApi) && /Inviare adesso da \$\{LEAD_MITTENTE\}/.test(webOut) && /res\.from \? ` da \$\{res\.from\}`/.test(webOut) && !/da info@amimi\.it/.test(webOut) && /from: mitt\.from/.test(src));

console.log('== Blocco 2 (v5, migr 0148): risposte lette dal cron e follow-up proposti ==');
const B2 = '// ==== PURE:lead-inbound BEGIN ====', E2 = '// ==== PURE:lead-inbound END ====';
const a2 = src.indexOf(B2), b2 = src.indexOf(E2);
if (a2 < 0 || b2 < 0) { console.error('marcatori PURE:lead-inbound non trovati in lead-outreach'); process.exit(1); }
const TMP2 = `${ROOT}tests/_leadinbound.tmp.ts`;
writeFileSync(TMP2, `${src.slice(a2 + B2.length, b2).trim()}\nexport { indirizzoDi, tagliaCitazione, classificaInbound, jsonSafe, oggiRoma, prossimoFollowUp };\n`, 'utf8');
let indirizzoDi, tagliaCitazione, classificaInbound, jsonSafe, oggiRoma, prossimoFollowUp;
try { ({ indirizzoDi, tagliaCitazione, classificaInbound, jsonSafe, oggiRoma, prossimoFollowUp } = await import(pathToFileURL(TMP2).href)); }
finally { try { unlinkSync(TMP2); } catch { /* niente */ } }
const mig148 = readFileSync(`${ROOT}supabase/migrations/0148_lead_blocco2_cron.sql`, 'utf8').replace(/\r\n/g, '\n');
const NOSTRA = '\n\nIl giorno lun 5 ott 2026 alle ore 10:12 Amimì Milano <info@amimi.it> ha scritto:\n> Gentile team,\n> ' + OPT;
const msg = (o) => ({ from: 'Negozio <info@negozio.it>', subject: 'Re: Amimì Milano per Ivy', autoSubmitted: '', testo: '', ...o });

t('54 indirizzoDi: "Nome <a@b.it>" e indirizzo nudo, in minuscolo', indirizzoDi('Ivy Store <Info@Negozio.IT>') === 'info@negozio.it' && indirizzoDi('info@negozio.it') === 'info@negozio.it');
t('55 la citazione della NOSTRA email viene tagliata (stile Gmail italiano)', tagliaCitazione('Buongiorno, ci interessa.' + NOSTRA) === 'Buongiorno, ci interessa.', tagliaCitazione('Buongiorno, ci interessa.' + NOSTRA));
t('56 citazione Gmail inglese su due righe e separatore Outlook', tagliaCitazione('Thanks, send it over.\n\nOn Mon, 5 Oct 2026 at 10:12, Amimì Milano <info@amimi.it>\nwrote:\n> text') === 'Thanks, send it over.' && tagliaCitazione('Va bene.\n\n________________________________\nDa: Amimì <info@amimi.it>') === 'Va bene.');
t('57 risposta interessata con la nostra riga "no grazie" CITATA: NON e\' opt-out', classificaInbound(msg({ testo: 'Buongiorno, ci interessa: passate pure giovedì.' + NOSTRA })) === null);
t('58 "No grazie" scritto dal negozio = opt-out (anche con la citazione sotto)', classificaInbound(msg({ testo: 'No grazie.' + NOSTRA })) === 'opt_out' && classificaInbound(msg({ testo: 'No, thanks' })) === 'opt_out' && classificaInbound(msg({ testo: 'Per favore non contattateci più.' })) === 'opt_out');
t('59 una risposta lunga che contiene "no grazie" resta a una persona', classificaInbound(msg({ testo: 'No grazie per il conto vendita, ma ' + 'ci interessa capire meglio i modelli in pelle e i tempi di consegna. '.repeat(6) })) === null);
t('60 bounce: mailer-daemon o oggetto di mancato recapito', classificaInbound(msg({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)', autoSubmitted: 'auto-replied' })) === 'bounce' && classificaInbound(msg({ subject: 'Undeliverable: Amimì Milano per Ivy' })) === 'bounce');
t('61 risposta automatica: header Auto-Submitted o oggetto "Risposta automatica"', classificaInbound(msg({ autoSubmitted: 'auto-replied', testo: 'Sono fuori ufficio' })) === 'risposta_automatica' && classificaInbound(msg({ subject: 'Risposta automatica: Amimì Milano per Ivy' })) === 'risposta_automatica' && classificaInbound(msg({ autoSubmitted: 'no', testo: 'Ci sentiamo lunedì per fissare.' })) === null);
t('62 jsonSafe toglie NUL e surrogati spaiati, lascia le emoji intere', jsonSafe('a\u0000b\uD83Dc') === 'abc' && jsonSafe('ok 😀') === 'ok 😀');
t('63 oggiRoma: alle 22:30Z in estate a Roma e\' gia\' domani', oggiRoma(new Date('2026-09-22T22:30:00Z')) === '2026-09-23' && oggiRoma(new Date('2026-12-10T12:00:00Z')) === '2026-12-10');
const outT = (n, at, th = 'th1') => ({ direzione: 'out', canale: 'email', sequenza_tocco: n, esito: null, at, gmail_thread_id: th });
const inT = (esito, at) => ({ direzione: 'in', canale: 'email', sequenza_tocco: null, esito, at });
t('64 follow-up: dopo il tocco 1 senza risposte si propone il 2', prossimoFollowUp([outT(1, '2026-10-01T08:00:00+00:00')]).tocco === 2);
t('65 follow-up: una risposta vera dopo l\'ultimo invio ferma la sequenza', 'salta' in prossimoFollowUp([outT(1, '2026-10-01T08:00:00+00:00'), inT(null, '2026-10-02T09:00:00.5+00:00')]));
t('66 follow-up: una risposta automatica NON ferma la sequenza, un bounce si\'', prossimoFollowUp([outT(1, '2026-10-01T08:00:00+00:00'), inT('risposta_automatica', '2026-10-01T08:01:00+00:00')]).tocco === 2 && prossimoFollowUp([outT(1, '2026-10-01T08:00:00+00:00'), inT('bounce', '2026-10-01T08:01:00+00:00')]).salta === 'email non valida');
t('67 follow-up: dopo il tocco 4 niente, e niente senza un tocco email registrato', 'salta' in prossimoFollowUp([outT(4, '2026-10-01T08:00:00+00:00')]) && 'salta' in prossimoFollowUp([{ direzione: 'out', canale: 'telefono', sequenza_tocco: 0, esito: null, at: '2026-10-01T08:00:00+00:00' }]));
t('68 follow-up: una risposta PRIMA dell\'ultimo invio non lo ferma (confronto per istante, non per stringa)', prossimoFollowUp([outT(1, '2026-10-01T08:00:00+00:00'), inT(null, '2026-10-02T09:00:00+00:00'), outT(2, '2026-10-02T09:00:00.4+00:00')]).tocco === 3);
const cronFn = src.slice(src.indexOf('async function giroCron'), src.indexOf('Deno.serve('));
const iGate = cronFn.indexOf("flags.lead_enabled !== 'true'");
t('69 cron NO-OP a lead_enabled spento: esce prima di Gmail e di ogni scrittura', iGate > 0 && iGate < cronFn.indexOf('leggiRisposte(') && iGate < cronFn.indexOf("from('health_log')"));
t('70 il cron non spedisce MAI: un solo messages/send, dentro l\'azione send', src.split('/messages/send').length === 2 && src.indexOf('/messages/send') > src.indexOf('Deno.serve('));
t('71 senza lettura riuscita niente follow-up; per negozio: thread letto in questo giro e nessuna risposta non scritta', /if \(inbound && flags\.lead_outreach_ai_enabled === 'true'\)/.test(cronFn) && /if \(sospesi\.has\(a\.id\)\)/.test(src) && /if \(!letti\.has\(fu\.thread\)\)/.test(src) && src.split('letti.add(th)').length === 3);
t('72 risposta scritta con upsert ignoreDuplicates su gmail_message_id; esistenza con .in() sui soli id', /from\('lead_touches'\)\.upsert\(riga, \{ onConflict: 'gmail_message_id', ignoreDuplicates: true \}\)/.test(src) && /\.in\('gmail_message_id', ids\)/.test(src));
t('73 tetti per giro dichiarati e usati (thread, risposte, bozze)', /const MAX_THREAD = \d+/.test(src) && /const MAX_IN = \d+/.test(src) && /const MAX_BOZZE = \d+/.test(src) && /slice\(0, MAX_THREAD\)/.test(src) && /slice\(0, MAX_IN\)/.test(src) && /esito\.proposte\) >= MAX_BOZZE/.test(src));
t('74 un messaggio illeggibile non ferma il giro (niente stallo sullo stesso record)', /if \(!r\.ok\) \{ illeggibile\(/.test(src) && /if \(iErr\) \{ illeggibile\(/.test(src));
t('75 messaggi SENT/DRAFT e mittenti @amimi.it non sono risposte', /lbl\.includes\('SENT'\) \|\| lbl\.includes\('DRAFT'\)/.test(src) && /indirizzoDi\(from\)\.endsWith\('@amimi\.it'\)\) continue/.test(src));
t('76 il cron risponde solo con conteggi: nessun testo, oggetto o indirizzo nella risposta', !/body_clean|subject|from\b/.test(cronFn.slice(cronFn.lastIndexOf('return json('))));
t('77 lead_enabled nella whitelist dei flag letti (un flag non elencato vale undefined per sempre)', /const FLAG_KEYS = \[[^\]]*'lead_enabled'/.test(src));
t('78 migr 0148: una bozza automatica per (negozio, tocco) a DB, e la edge la marca origine auto', /unique index[^;]*lead_drafts \(account_id, sequenza_tocco\)[^;]*origine = 'auto'/is.test(mig148) && /origine: p\.origine/.test(src) && /origine: 'auto' \}\)/.test(src));
t('79 migr 0148: cron con azione cron ai :20 e :50, e nessun flag acceso dalla migrazione', /cron\.schedule\('lead-outreach-cron', '20,50 \* \* \* \*'/.test(mig148) && /"action":"cron"/.test(mig148) && !/update app_flags|insert into app_flags/.test(mig148));
t('80 migr 0148: la vista resta security_invoker e chiusa ad anon, colonna nuova in coda', /create or replace view v_lead_outreach with \(security_invoker = on\)/.test(mig148) && /revoke all on v_lead_outreach from anon/.test(mig148) && /as bozza_auto_tocco\s*\nfrom lead_accounts/.test(mig148));
t('81 scarta: solo bozze non partite', /update\(\{ stato: 'scartata'[^\n]*\n\s*\.eq\('id', id\)\.in\('stato', \['proposta', 'approvata', 'errore'\]\)/.test(src));
const iJwt = src.indexOf("return json({ error: 'dominio non ammesso' }, 403)");
t('82 solo il cron esce prima del JWT: bozza, invio, sblocca e scarta vengono dopo', src.indexOf("if (action === 'cron') return await giroCron(") < src.indexOf("if (!tk) return json({ error: 'non autenticato' }, 401)") && src.indexOf("if (action === 'scarta')") > iJwt && src.indexOf("if (action === 'draft')") > iJwt && src.indexOf("if (action === 'sblocca')") > iJwt);

console.log('== Gate 3 del Blocco 2 (revisione indipendente 03-10) ==');
const cfg = readFileSync(`${ROOT}supabase/config.toml`, 'utf8').replace(/\r\n/g, '\n');
t('83 B3 "Perché no, grazie, passi giovedì" e "non mi scriva qui ma a acquisti@..." NON sono opt-out', classificaInbound(msg({ testo: 'Perché no, grazie, passi giovedì.' })) === null && classificaInbound(msg({ testo: 'Non mi scriva qui ma a acquisti@negozio.it' })) === null && classificaInbound(msg({ testo: 'Buongiorno, no grazie.' })) === 'opt_out' && classificaInbound(msg({ testo: 'Please do not contact us again' })) === 'opt_out');
t('84 B6 ultimo tocco registrato a mano (senza thread): nessun follow-up automatico', 'salta' in prossimoFollowUp([outT(1, '2026-10-01T08:00:00+00:00', null)]) && prossimoFollowUp([outT(1, '2026-10-01T08:00:00+00:00')]).thread === 'th1');
t('85 B5 bounce con orario Gmail di poco PRECEDENTE alla registrazione del tocco: follow-up fermo; un bounce vecchio no', prossimoFollowUp([outT(1, '2026-10-01T08:00:05+00:00'), inT('bounce', '2026-10-01T08:00:02+00:00')]).salta === 'email non valida' && prossimoFollowUp([outT(1, '2026-10-01T08:00:00+00:00'), inT('bounce', '2026-10-01T08:00:02+00:00'), outT(2, '2026-10-06T08:00:00+00:00')]).tocco === 3);
t('86 B1 i thread dei negozi "contattato" si leggono per primi', /sort\(\(a, b\) => inSequenza\(b\) - inSequenza\(a\)\)\.slice\(0, MAX_THREAD\)/.test(src));
t('87 B2 candidati dalla vista che esclude a monte bounce, opt-out, bozze gia\' scritte e tocchi a mano; solo service_role', /from\('v_lead_followup_due'\)/.test(src) && /create or replace view v_lead_followup_due with \(security_invoker = on\)/.test(mig148) && /lo\.gmail_thread_id is not null/.test(mig148) && /c\.opt_out/.test(mig148) && /d\.origine = 'auto' or d\.stato in/.test(mig148) && /is distinct from 'risposta_automatica'/.test(mig148) && /revoke all on v_lead_followup_due from anon, authenticated, public/.test(mig148));
t('88 B4 i messaggi da @amimi.it si scartano alla lettura del thread, prima del tetto delle risposte', src.indexOf("indirizzoDi(da).endsWith('@amimi.it')) continue") > 0 && src.indexOf("indirizzoDi(da).endsWith('@amimi.it')) continue") < src.indexOf('slice(0, MAX_IN)'));
t('89 azione cron senza JWT: al massimo un giro ogni 5 minuti, e verify_jwt pinnato in config.toml', /skipped: 'giro recente'/.test(cronFn) && cronFn.indexOf("skipped: 'giro recente'") < cronFn.indexOf('leggiRisposte(') && /\[functions\.lead-outreach\]\nverify_jwt = false/.test(cfg));
t('90 una risposta in uno stadio avanzato non sovrascrive la prossima azione decisa da una persona', /st === 'da_contattare' \|\| st === 'contattato' \|\| st === 'risposto'\) \? \{ \.\.\.base, prossima_azione: 'rispondere al negozio'/.test(src));

console.log('== v7 (migr 0149): line sheet del 02-10 pubblicata con listino e condizioni ==');
const mig149 = readFileSync(`${ROOT}supabase/migrations/0149_lead_linesheet_0210.sql`, 'utf8').replace(/\r\n/g, '\n');
const sql149 = mig149.replace(/^\s*--[^\n]*$/gm, '');
t('v7-1 knowledge: listino nuovo (51/135, 71/185, 73/190, 19/50, 29/77) e nessun prezzo del listino vecchio', /51 e 135/.test(sql149) && /71 e 185/.test(sql149) && /73 e 190/.test(sql149) && /19 e 50/.test(sql149) && /29 e 77/.test(sql149) && !/\b(55|76|68|32)\b e \d/.test(sql149));
t('v7-2 knowledge: condizioni definite, vendita ferma, niente conto vendita; nessuna nota interna (fido, formula, margine)', /vendita ferma: il conto vendita non c''e'' piu''/.test(sql149) && /12 pezzi e almeno 400 euro netto/.test(sql149) && !/fido|1\.500|2,6|COGS|margine sotto|BOZZA/i.test(sql149));
t('v7-3 knowledge e template: nessuna percentuale, cotone mai accostato all\'Italia, India mai', !/\d+\s?%/.test(sql149) && avvisiContenuto(sql149.replace(/conto vendita|ordine minimo|non allegati/g, '')).length === 0, avvisiContenuto(sql149.replace(/conto vendita|ordine minimo|non allegati/g, '')));
t('v7-4 template: il listino non e\' piu\' "all\'appuntamento", si rimanda al link; controllo finale con RAISE', /listino wholesale e condizioni: \{\{linesheet\}\}/.test(sql149) && /wholesale prices and terms: \{\{linesheet\}\}/.test(sql149) && (sql149.match(/raise exception/g) ?? []).length === 3);
t('v7-5 prompt: regola 4 rimanda alla line sheet, vieta di riscrivere il listino e il conto vendita; niente "non sono ancora decise"', /'4\. Listino wholesale e condizioni commerciali sono pubblicati nella line sheet/.test(src) && /NON riscrivere il listino/.test(src) && /Il conto vendita non esiste piu/.test(src) && !/non sono ancora decise/.test(src));
t('v7-6 gli avvisi su percentuali e minimi restano attivi (la persona li vede prima di inviare)', avvisiContenuto('sconto del 10%').length === 1 && avvisiContenuto('ordine minimo di 12 pezzi').length === 1 && avvisiContenuto('possiamo fare conto vendita').length === 1);

console.log('== Blocco 2, layout telefono (04-10): Pipeline a lista sotto i 700 px, tabella con colonna Negozio ferma ==');
// La misura vera (375 px e 1024 px, dati finti) sta in web/e2e/negozi-layout.spec.ts; qui si tiene fermo il sorgente.
const css = readFileSync(`${ROOT}web/src/index.css`, 'utf8').replace(/\r\n/g, '\n');
const webNeg = readFileSync(`${ROOT}web/src/pages/Negozi.tsx`, 'utf8').replace(/\r\n/g, '\n');
// tutti i blocchi a 699 px, in qualunque punto del file (non solo il primo)
const telBlocchi = [...css.matchAll(/@media \(max-width: 699px\) \{\n((?:[ \t]+[^\n]*\n)+)\}/g)];
const tel = telBlocchi.map((m) => m[1]).join('');
const tabella = webNeg.match(/<table className="sortable lead-table">[\s\S]*?<\/table>/)?.[0] ?? '';
t('L1 sotto i 700 px la Pipeline non e\' piu\' un kanban a scorrimento laterale e gli stadi vuoti spariscono', /\.or-board \{ display: block; overflow-x: visible;/.test(tel) && /\.or-col\.empty \{ display: none; \}/.test(tel));
t('L2 il kanban resta su schermo largo: griglia a colonne fuori dal blocco telefono, nessun display:none sugli stadi vuoti', /\n\.or-board \{ display: grid; grid-auto-flow: column;/.test(css) && !/\.or-col\.empty/.test(telBlocchi.reduce((c, m) => c.replace(m[0], ''), css)));
t('L3 OutreachBoard marca gli stadi vuoti e dice quando la pipeline e\' vuota', /className=\{list\.length \? 'or-col' : 'or-col empty'\}/.test(webOut) && /!rows\.length && <p className="muted or-solo-tel">/.test(webOut) && /\.or-solo-tel \{ display: block; \}/.test(tel));
t('L4 colonna Negozio ferma a ogni larghezza, con fondo pieno (senza, le altre celle si leggono sotto); su telefono troncata con il filo a destra e il nome intero nel title', /\n\.lead-table th:first-child, \.lead-table td:first-child \{ position: sticky; left: 0; z-index: 1; background: var\(--card\); \}/.test(css) && /\.lead-table th:first-child, \.lead-table td:first-child \{ max-width: 42vw; overflow: hidden; text-overflow: ellipsis; background: linear-gradient\(to left, var\(--line\) 1px, transparent 1px\) var\(--card\); \}/.test(tel) && /<td className=\"l\" title=\{r\.nome\}>\{r\.nome\}<\/td>/.test(tabella));
t('L5 su telefono spariscono Rating, Brand affini ed Evid., in testata e nelle righe, e nient\'altro', /\.lead-tel-no \{ display: none; \}/.test(tel) && !/\.lead-tel-no/.test(telBlocchi.reduce((c, m) => c.replace(m[0], ''), css)) && [...tabella.matchAll(/<th className="lead-tel-no">([^<]+)<\/th>/g)].map((m) => m[1]).join('|') === 'Rating|Brand affini|Evid.' && (tabella.match(/<td className="(?:l )?lead-tel-no">/g) ?? []).length === 3 && (tabella.match(/lead-tel-no/g) ?? []).length === 6);
t('L6 il contenitore che scorre e\' raggiungibile da tastiera e dice che si scorre di lato', /<div className="tablewrap" role="region" aria-label="Tabella negozi: scorri di lato per le altre colonne" tabIndex=\{0\}><table className="sortable lead-table">/.test(webNeg));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
