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
t('28 JWT @amimi.it per tutte le azioni', /endsWith\('@amimi\.it'\)\) return json\(\{ error: 'dominio non ammesso' \}, 403\)/.test(src));
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

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
