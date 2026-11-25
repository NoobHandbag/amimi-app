// tests/cs_nonumano.mjs — risposte automatiche e mittenti di sistema (cs-sync v37), ritagliati DAL
// SORGENTE che va in produzione (blocco PURE:cs-nonumano): se il codice cambia, il test rompe.
//   node tests/cs_nonumano.mjs
//
// Perche' esiste. Il 23-11 Ginevra ha trovato in coda posta che nessuno doveva leggere. Su TUTTO lo
// storico i mittenti noreply/notifications e gli oggetti "Risposta automatica" non hanno mai toccato
// una cliente vera; le 9 conversazioni che erano passate erano tutte da buttare. Meta' dei casi qui
// sotto e' la guardia opposta: una cliente che scrive "risposta" o "notifica" nell'oggetto, un
// indirizzo personale che contiene "news" o "info", la notifica di contestazione (auto-generated).
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BEGIN = '// ==== PURE:cs-nonumano BEGIN ====';
const END = '// ==== PURE:cs-nonumano END ====';
const s = readFileSync(`${ROOT}supabase/functions/cs-sync/index.ts`, 'utf8').replace(/\r\n/g, '\n');
const a = s.indexOf(BEGIN), b = s.indexOf(END);
if (a < 0 || b < 0) { console.error('marcatori PURE:cs-nonumano non trovati in cs-sync'); process.exit(1); }
const TMP = `${ROOT}tests/_nonumano.tmp.ts`;
writeFileSync(TMP, `${s.slice(a + BEGIN.length, b).trim()}\nexport { isRispostaAutomatica, isMittenteDiSistema };\n`, 'utf8');
let isRispostaAutomatica, isMittenteDiSistema;
try { ({ isRispostaAutomatica, isMittenteDiSistema } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra) : '')); } };
const auto = (subj, as = '', xa = '') => isRispostaAutomatica(subj, as, xa);

console.log('== risposte automatiche (vanno nel rumore) ==');
t('1  oggetto "Risposta automatica:" (Moschino, 30-10)', auto('Risposta automatica: Voi, con le nostre borse'));
t('2  oggetto "Automatic reply:"', auto('Automatic reply: Un pacco dell\'ordine #1790 e\' pronto'));
t('3  oggetto francese con spazio prima dei due punti', auto('Réponse automatique : Il nuovo credit card case'));
t('4  oggetto "Out of Office"', auto('Out of Office: back on Monday'));
t('5  header Auto-Submitted: auto-replied, oggetto qualunque', auto('Re: la tua richiesta', 'auto-replied'));
t('6  header X-Autoreply: yes', auto('Re: ordine', '', 'yes'));
t('7  oggetto "Abwesenheitsnotiz"', auto('Abwesenheitsnotiz: Lea Bag'));

console.log('\n== NON sono risposte automatiche (restano in coda) ==');
t('8  cliente: "Re: risposta alla tua richiesta"', !auto('Re: Risposta alla tua richiesta - Amimì'));
t('9  cliente che cita la risposta automatica a meta\' oggetto', !auto('ho ricevuto solo una risposta automatica, ordine 2012'));
t('10 Auto-Submitted: auto-generated (notifiche che contano) non basta', !auto('Contestazione aperta', 'auto-generated'));
t('11 Auto-Submitted: no', !auto('Domanda', 'no'));
t('12 oggetto vuoto e nessun header', !auto(''));

console.log('\n== mittenti di sistema (vanno nel rumore) ==');
for (const [i, em] of [['13', 'no-reply@shipping.amazon.it'], ['14', 'noreply@adobe.com'], ['15', 'noreply@ads.google.com'], ['16', 'noreply@fatturazioneelettronica.aruba.it'], ['17', 'do-not-reply@ikea.com'], ['18', 'notifications@notifications.virginactive.com'], ['19', 'no-reply-2f5kuu7b1ihjm3zrl_ftew@mail.anthropic.com'], ['20', 'noreply.internetbanking@nexi.it'], ['21', 'newsletter@formeidee.it'], ['22', 'NoReply@DHL.com']]) {
  t(`${i} ${em}`, isMittenteDiSistema(em));
}

console.log('\n== NON sono mittenti di sistema (persone, restano in coda) ==');
for (const [i, em] of [['23', 'info@damapel.it'], ['24', 'newsom.anna@gmail.com'], ['25', 'notarianni@libero.it'], ['26', 'mailerfabio@hotmail.it'], ['27', 'commerciale@formeidee.it'], ['28', 'service@paypal.it'], ['29', 'support@amimi.it'], ['30', 'alessia.alerts.fan@gmail.com']]) {
  t(`${i} ${em}`, !isMittenteDiSistema(em));
}
t('31 indirizzo vuoto o senza @', !isMittenteDiSistema('') && !isMittenteDiSistema('noreply'));

console.log('\n== Gate 2 del 24-11 ==');
for (const [i, em] of [['32', 'news.giulia@gmail.com'], ['33', 'news_anna@libero.it'], ['34', 'alert.maria@gmail.com'], ['35', 'mailer-mario@hotmail.it'], ['36', 'notify@updates.notion.com']]) {
  t(`${i} B2: ${em} non e' sistema (si decide con l'AI)`, !isMittenteDiSistema(em));
}
t('37 B1: wrapper chat di Shopify con oggetto nuovo resta in coda', !isMittenteDiSistema('no-reply@mailer.shopify.com'));
t('38 B1: noreply con Reply-To di una persona resta in coda', !isMittenteDiSistema('noreply@marketplace.it', 'giulia.rossi@gmail.com'));
t('39 B1: noreply con Reply-To anch\'esso di sistema va nel rumore', isMittenteDiSistema('noreply@adobe.com', 'no-reply@adobe.com'));
t('40 B1: Reply-To uguale al mittente', isMittenteDiSistema('noreply@adobe.com', 'NoReply@adobe.com'));
t('41 C1: X-Autoreply: no non conta', !auto('Domanda', '', 'no'));
t('42 C1: X-Autoreply: true conta', auto('Domanda', '', 'true'));
t('43 C2: "Out of office hours shopping?" e\' una cliente', !auto('Out of office hours shopping?'));
t('44 C2: "Out of office" da solo conta', auto('Out of office'));

// v38 (25-11, Dan: "se ha un noreply ovunque, non e' una persona"). I primi sette sono indirizzi veri
// dello storico che la v37 lasciava passare (cloudplatform-noreply era finito in coda).
console.log('\n== v38: noreply in qualunque punto dell\'indirizzo ==');
for (const [i, em] of [['45', 'cloudplatform-noreply@google.com'], ['46', 'googlebase-noreply@google.com'], ['47', 'payments-noreply@google.com'], ['48', 'drive-shares-dm-noreply@google.com'], ['49', 'posteinfo-noreply@posteitaliane.it'], ['50', 'no_reply@communications.paypal.com'], ['51', 'google-workspace-alerts-noreply@google.com'], ['52', 'info@noreply.esempio.it'], ['53', 'mail.do_not_reply@banca.it'], ['54', 'alerts-no-reply@banca.it'], ['55', 'servizio.donotreply@inps.it'], ['56', 'NO.REPLY@ESEMPIO.COM']]) {
  t(`${i} ${em}`, isMittenteDiSistema(em));
}
for (const [i, em] of [['57', 'stefano.reply@gmail.com'], ['58', 'marino@reply.it'], ['59', 'info@replyshop.it'], ['60', 'bruno_reply@libero.it']]) {
  t(`${i} persona: ${em} resta in coda`, !isMittenteDiSistema(em));
}
t('61 le due eccezioni della v37 valgono anche col noreply in mezzo', !isMittenteDiSistema('shop-noreply@mailer.shopify.com') && !isMittenteDiSistema('marketplace-noreply@zalando.it', 'giulia.rossi@gmail.com'));

console.log(`\n${ok}/${ok + ko} verdi`);
if (ko) process.exit(1);
