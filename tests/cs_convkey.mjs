// tests/cs_convkey.mjs — funzioni PURE del modulo Assistenza, ritagliate DAL SORGENTE che va in
// produzione (non ricopiate: se il codice cambia, il test rompe). Nessuna rete, nessun database.
//   node tests/cs_convkey.mjs
//
// Copre:
//  - `emailCliente`: chi e' il CLIENTE che ha scritto un messaggio. E' la base della cintura
//    cross-cliente di cs-send v4 e della guardia di cs-assist v21. La v3 di cs-send leggeva
//    `form_fields.Email` con la E maiuscola mentre cs-sync scrive le chiavi in MINUSCOLO: sul
//    canale form non ha mai bloccato nulla. Questo file esiste perche' non succeda una seconda volta.
//  - l'IMPRONTA delle due copie del blocco (cs-send e cs-assist non condividono moduli): se una
//    sola delle due viene modificata, il test diventa rosso invece di lasciare le due edge in
//    disaccordo silenzioso su chi sia un cliente.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FN = (n) => `${ROOT}supabase/functions/${n}/index.ts`;
const BEGIN = '// ==== PURE:cs-emailcliente BEGIN ====';
const END = '// ==== PURE:cs-emailcliente END ====';

function ritaglia(file) {
  const s = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const a = s.indexOf(BEGIN), b = s.indexOf(END);
  if (a < 0 || b < 0) throw new Error(`marcatori PURE:cs-emailcliente non trovati in ${file}`);
  return s.slice(a + BEGIN.length, b).trim();
}

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra).slice(0, 200) : '')); } };

const daSend = ritaglia(FN('cs-send'));
const daAssist = ritaglia(FN('cs-assist'));

console.log('\n== le due copie non devono divergere in silenzio ==');
const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
t(`1  impronta identica in cs-send e cs-assist (${h(daSend)})`, h(daSend) === h(daAssist), { cs_send: h(daSend), cs_assist: h(daAssist) });

// il blocco e' TypeScript: Node 24 toglie i tipi da solo su file .ts
const TMP = `${ROOT}tests/_emailcliente.tmp.ts`;
writeFileSync(TMP, `${daSend}\nexport { emailCliente };\n`, 'utf8');
let emailCliente;
try { ({ emailCliente } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

console.log('\n== chiave dei campi del modulo: e\' minuscola, e la v3 non lo sapeva ==');
t('2  chiave minuscola (cio\' che cs-sync scrive DAVVERO)', emailCliente({ form_fields: { email: 'anna@example.com' }, from_email: 'mailer@shopify.com' }) === 'anna@example.com');
t('3  chiave maiuscola', emailCliente({ form_fields: { Email: 'anna@example.com' } }) === 'anna@example.com');
t('4  chiave tutta maiuscola', emailCliente({ form_fields: { EMAIL: 'anna@example.com' } }) === 'anna@example.com');
t('5  chiave con spazi', emailCliente({ form_fields: { ' Email ': 'anna@example.com' } }) === 'anna@example.com');
t('6  REGRESSIONE v3: form_fields minuscolo + wrapper come mittente -> NON piu\' cieco',
  emailCliente({ form_fields: { email: 'anna@example.com', name: 'Anna' }, from_email: 'mailer@shopify.com' }) === 'anna@example.com');

console.log('\n== il valore va ripulito, o lo stesso indirizzo conta due volte ==');
t('7  forma <mailto:> di Outlook', emailCliente({ from_email: 'monica_s@hotmail.it<mailto:monica_s@hotmail.it>' }) === 'monica_s@hotmail.it');
t('8  forma "Nome Cognome <mail>"', emailCliente({ from_email: 'Anna Rossi <anna@example.com>' }) === 'anna@example.com');
t('9  maiuscole normalizzate', emailCliente({ from_email: 'Anna@Example.COM' }) === 'anna@example.com');
t('10 spazi attorno', emailCliente({ from_email: '   anna@example.com  ' }) === 'anna@example.com');
t('11 la stessa persona in tre forme conta UNA volta',
  new Set(['monica_s@hotmail.it<mailto:monica_s@hotmail.it>', 'Monica_S@hotmail.it', ' monica_s@hotmail.it ']
    .map((v) => emailCliente({ from_email: v }))).size === 1);

console.log('\n== chi NON e\' un cliente ==');
t('12 wrapper del modulo', emailCliente({ from_email: 'mailer@shopify.com' }) === null);
t('13 notifica chat', emailCliente({ from_email: 'no-reply@mailer.shopify.com' }) === null);
t('14 posta di casa', emailCliente({ from_email: 'info@amimi.it' }) === null);
t('15 shopifyemail.com', emailCliente({ from_email: 'x@shopifyemail.com' }) === null);
t('16 valore spazzatura', emailCliente({ from_email: 'nessuna email qui' }) === null);
t('17 tutto vuoto', emailCliente({}) === null && emailCliente({ from_email: null, form_fields: null }) === null);
t('18 form_fields senza campo email -> ripiega sul mittente',
  emailCliente({ form_fields: { name: 'Anna' }, from_email: 'anna@example.com' }) === 'anna@example.com');
t('19 campo email vuoto -> ripiega sul mittente',
  emailCliente({ form_fields: { email: '   ' }, from_email: 'anna@example.com' }) === 'anna@example.com');

console.log('\n== il caso del brief: due submit nello stesso minuto ==');
{
  const inMsgs = [
    { form_fields: { name: 'Anna', email: 'anna@example.com' }, from_email: 'mailer@shopify.com' },
    { form_fields: { name: 'Bea', email: 'bea@example.com' }, from_email: 'mailer@shopify.com' },
  ];
  const set = new Set(inMsgs.map(emailCliente).filter(Boolean));
  t('20 due clienti diversi vengono visti come due (la v3 ne vedeva ZERO)', set.size === 2, [...set]);
}
{
  const inMsgs = [
    { form_fields: { email: 'anna@example.com' }, from_email: 'mailer@shopify.com' },
    { form_fields: { email: 'Anna@Example.com' }, from_email: 'mailer@shopify.com' },
    { from_email: 'anna@example.com' },
  ];
  const set = new Set(inMsgs.map(emailCliente).filter(Boolean));
  t('21 la stessa cliente due volte NON blocca l\'invio', set.size === 1, [...set]);
}
{
  const inMsgs = [{ from_email: 'anna@example.com' }, { from_email: 'info@amimi.it' }];
  const set = new Set(inMsgs.map(emailCliente).filter(Boolean));
  t('22 una nostra mail nel thread non conta come secondo cliente', set.size === 1, [...set]);
}

// ---------------------------------------------------------------------------------------------
// chiave della conversazione (cs-sync v13) e regola della raffica (tre sedi)
// ---------------------------------------------------------------------------------------------
function ritagliaMarcato(file, nome) {
  const s = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const b = `// ==== PURE:${nome} BEGIN ====`, e = `// ==== PURE:${nome} END ====`;
  const a = s.indexOf(b), z = s.indexOf(e);
  if (a < 0 || z < 0) throw new Error(`marcatori PURE:${nome} non trovati in ${file}`);
  return s.slice(a + b.length, z).trim();
}

console.log('\n== la regola del sollecito vive in TRE sedi: devono restare identiche ==');
const soll = {
  'cs-sync': ritagliaMarcato(FN('cs-sync'), 'cs-sollecito'),
  'cs-classify': ritagliaMarcato(FN('cs-classify'), 'cs-sollecito'),
  'cs-send': ritagliaMarcato(FN('cs-send'), 'cs-sollecito'),
};
const impronte = Object.fromEntries(Object.entries(soll).map(([k, v]) => [k, h(v)]));
t(`23 impronta identica nelle tre sedi (${impronte['cs-sync']})`, new Set(Object.values(impronte)).size === 1, impronte);

const TMP2 = `${ROOT}tests/_convkey.tmp.ts`;
writeFileSync(TMP2, `${ritagliaMarcato(FN('cs-sync'), 'cs-convkey')}\n${soll['cs-sync']}\nexport { decidiConv, normEmail, isFormCanale, chiaveFratelli, isRafficaModulo };\n`, 'utf8');
let M2;
try { M2 = await import(pathToFileURL(TMP2).href); }
finally { try { unlinkSync(TMP2); } catch { /* niente */ } }
const { decidiConv, normEmail, chiaveFratelli, isRafficaModulo } = M2;

const TH = 'thread123';
const form = (email, id = 'c1') => ({ id, canale: 'form_contatto', customer_email: email });
const msg = (o = {}) => ({ id: 'm1', threadId: TH, email: null, nuovaSubmission: false, ...o });

console.log('\n== decidiConv: cio\' che NON deve cambiare ==');
t('24 thread nuovo -> si crea con la chiave = thread id (identico a oggi)',
  JSON.stringify(decidiConv(null, [], msg({ email: 'a@x.it', nuovaSubmission: true }))) === JSON.stringify({ modo: 'create', key: TH }));
t('25 email_diretta con due mittenti diversi -> NON si spezza',
  decidiConv({ id: 'c1', canale: 'email_diretta', customer_email: 'a@x.it' }, [], msg({ email: 'b@x.it', nuovaSubmission: true })).modo === 'attach');
t('26 chat_notifica -> non si spezza',
  decidiConv({ id: 'c1', canale: 'chat_notifica', customer_email: 'a@x.it' }, [], msg({ email: 'b@x.it', nuovaSubmission: true })).modo === 'attach');
t('27 rumore -> non si spezza',
  decidiConv({ id: 'c1', canale: 'rumore', customer_email: 'a@x.it' }, [], msg({ email: 'b@x.it', nuovaSubmission: true })).modo === 'attach');
t('28 stessa cliente -> UNA conversazione (comportamento dichiarato del brief)',
  decidiConv(form('a@x.it'), [], msg({ email: 'a@x.it', nuovaSubmission: true })).modo === 'attach');
t('29 stessa cliente scritta con altre maiuscole -> ancora una sola',
  decidiConv(form('a@x.it'), [], msg({ email: 'A@X.it', nuovaSubmission: true })).modo === 'attach');
t('30 email in arrivo sconosciuta -> attach, un dato mancante non spezza mai',
  decidiConv(form('a@x.it'), [], msg({ email: null, nuovaSubmission: true })).modo === 'attach');
t('31 conversazione senza customer_email -> attach',
  decidiConv(form(null), [], msg({ email: 'b@x.it', nuovaSubmission: true })).modo === 'attach');
t('32 follow-up da indirizzo mai visto che NON e\' uno stampo -> attach, niente frammentazione',
  decidiConv(form('a@x.it'), [], msg({ email: 'b@x.it', nuovaSubmission: false })).modo === 'attach');

console.log('\n== decidiConv: il caso del brief ==');
{
  const d = decidiConv(form('a@x.it'), [], msg({ id: 'MSG2', email: 'b@x.it', nuovaSubmission: true }));
  t('33 due clienti, secondo invio dal modulo -> conversazione NUOVA con chiave suffissata',
    d.modo === 'create' && d.key === `${TH}#MSG2`, d);
  t('34 la chiave nuova e\' diversa dal thread: il vincolo UNIQUE regge', d.key !== TH);
}
{
  const d = decidiConv(form('a@x.it'), [], msg({ id: 'MSG2', email: 'b@x.it', nuovaSubmission: true }));
  const d2 = decidiConv(form('a@x.it'), [], msg({ id: 'MSG2', email: 'b@x.it', nuovaSubmission: true }));
  t('35 stesso messaggio ripassato dal cursore -> stessa chiave (idempotente)', d.key === d2.key);
}
{
  const fratelli = [form('b@x.it', 'c2')];
  const d = decidiConv(form('a@x.it'), fratelli, msg({ id: 'MSG3', email: 'b@x.it', nuovaSubmission: true }));
  t('36 terzo invio della stessa persona -> si attacca al fratello, niente terza scheda',
    d.modo === 'attach' && d.id === 'c2', d);
}
{
  const fratelli = [form('b@x.it', 'c2')];
  const d = decidiConv(form('a@x.it'), fratelli, msg({ id: 'MSG4', email: 'b@x.it', nuovaSubmission: false }));
  t('37 follow-up della seconda cliente -> atterra sulla SUA conversazione, non su quella della prima',
    d.modo === 'attach' && d.id === 'c2', d);
}
t('38 il filtro dei fratelli e\' ancorato al thread', chiaveFratelli(TH) === TH + '#%');
t('39 normEmail estrae anche dalla forma <mailto:>', normEmail('a@x.it<mailto:a@x.it>') === 'a@x.it');

console.log('\n== raffica dal modulo: non e\' un sollecito ==');
const W = 'mailer@shopify.com';
const at = (min) => new Date(Date.UTC(2026, 7, 1, 17, min, 0)).toISOString();
t('40 due notifiche del modulo a 43 secondi -> raffica',
  isRafficaModulo([{ from_email: W, sent_at: at(38) }, { from_email: W, sent_at: '2026-08-01T17:38:43.000Z' }]));
t('41 due notifiche a 4 ore -> NON raffica (e\' un sollecito vero)',
  !isRafficaModulo([{ from_email: W, sent_at: at(0) }, { from_email: W, sent_at: new Date(Date.UTC(2026, 7, 1, 21, 0, 0)).toISOString() }]));
t('42 una notifica e una mail della cliente -> NON raffica',
  !isRafficaModulo([{ from_email: W, sent_at: at(38) }, { from_email: 'anna@x.it', sent_at: at(39) }]));
t('43 due mail dirette della cliente -> NON raffica, il sollecito resta',
  !isRafficaModulo([{ from_email: 'anna@x.it', sent_at: at(38) }, { from_email: 'anna@x.it', sent_at: at(39) }]));
t('44 sent_at mancante -> NON raffica (nel dubbio, la regola di prima)',
  !isRafficaModulo([{ from_email: W, sent_at: null }, { from_email: W, sent_at: at(39) }]));
t('45 un solo messaggio -> NON raffica', !isRafficaModulo([{ from_email: W, sent_at: at(38) }]));
t('46 lista vuota -> NON raffica', !isRafficaModulo([]));

console.log(`\n${ok}/${ok + ko} verdi` + (ko ? ` — ${ko} ROSSI` : ''));
process.exitCode = ko ? 1 : 0;
