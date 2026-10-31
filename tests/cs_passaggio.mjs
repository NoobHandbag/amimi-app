// tests/cs_passaggio.mjs — il PASSAGGIO del chatbot di Shopify Inbox e i mittenti condivisi di Shopify.
//   node tests/cs_passaggio.mjs
// Ritaglia DAL SORGENTE che va in produzione i blocchi PURE:cs-passaggio (cs-classify v9) e
// PURE:cs-api-mittente (cs-api v12): se il codice cambia, il test rompe. Nessuna rete, nessun DB.
//
// Perche' esiste (CASI_APERTI n.54, 31-10): dal 29-09 il chatbot di Shopify Inbox passa le chat al team con
// una notifica che dice solo "Agent transferred this conversation to your team for further support".
// cs-classify la etichettava a volte "Collaborazioni e B2B" (0,90-0,95) e la regola B2B -> rumore la
// nascondeva: 4 chat su 15, una cliente ha riscritto "Non ho ancora ricevuto risposta". In piu' il gesto
// "non e' un cliente" su una chat avrebbe messo in denylist il mittente Shopify condiviso, cioe' tutte le chat.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const src = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const blocco = (s, nome, dove) => {
  const B = `// ==== PURE:${nome} BEGIN ====`, E = `// ==== PURE:${nome} END ====`;
  const a = s.indexOf(B), b = s.indexOf(E);
  if (a < 0 || b < 0) { console.error(`marcatori PURE:${nome} non trovati in ${dove}`); process.exit(1); }
  return s.slice(a + B.length, b).trim();
};
const carica = async (codice, nomi, tag) => {
  const TMP = `${ROOT}tests/_passaggio_${tag}.tmp.ts`;
  writeFileSync(TMP, `${codice}\nexport { ${nomi.join(', ')} };\n`, 'utf8');
  try { return await import(pathToFileURL(TMP).href); }
  finally { try { unlinkSync(TMP); } catch { /* niente */ } }
};

const CLASSIFY = src('supabase/functions/cs-classify/index.ts');
const API = src('supabase/functions/cs-api/index.ts');
const UI = src('web/src/pages/Assistenza.tsx');
const bClassify = blocco(CLASSIFY, 'cs-passaggio', 'cs-classify');
const bApi = blocco(API, 'cs-api-mittente', 'cs-api');
const { isPassaggioAgente, b2bVaNelRumore } = await carica(bClassify, ['isPassaggioAgente', 'b2bVaNelRumore'], 'classify');
const api = await carica(bApi, ['isMittenteShopify', 'canaleDiRitorno', 'b2bVaNelRumore', 'voceDiDominioCheBlocca'], 'api');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra) : '')); } };

// corpo REALE di una notifica di passaggio (formato del 12-10 / 29-10, nome sostituito)
const NOTIFICA = (riga) => 'amimì\r\n\r\nYou have a new message from Cliente Prova\r\n\r\n' + riga +
  '\r\n\r\nSent via Inbox\r\n\r\nReply in Inbox \r\n( https://inbox.shopify.com/store/wb9gmn-0h/conversations/open/01a1882c-bb69-77ca-ba62-33e30104685c?context=email_new_message )\r\n';
const PASSAGGIO = 'Agent transferred this conversation to your team for\r\nfurther support';

console.log('== passaggio del chatbot riconosciuto (cs-classify) ==');
t('notifica completa del passaggio -> true', isPassaggioAgente(NOTIFICA(PASSAGGIO)) === true);
t('body_clean del passaggio (a capo dopo "for") -> true', isPassaggioAgente('Agent transferred this conversation to your team for\nfurther support') === true);
t('maiuscole/spazi diversi -> true', isPassaggioAgente('AGENT  transferred this\nconversation to your TEAM') === true);

console.log('\n== messaggi veri delle clienti in chat -> false ==');
for (const txt of ['Vorrei sapere a Roma dove la trovo', 'numero ordine Lea Bag Cocco Purple #1917', 'Non ho ancora ricevuto risposta',
  'Ordine 1880 borsa LEA BAG brown and white pony', 'Grazie per la risposta!', 'This customer sent a media message.',
  'can you transfer me to your team?', 'the agent was useless']) {
  t(`"${txt.slice(0, 40)}" -> false`, isPassaggioAgente(NOTIFICA(txt)) === false, txt);
}
t('vuoto / null -> false', isPassaggioAgente('') === false && isPassaggioAgente(null) === false && isPassaggioAgente(undefined) === false);

console.log('\n== regola B2B -> rumore: mai per una chat ==');
t('B2B in chat -> resta in coda', b2bVaNelRumore('Collaborazioni e B2B', 'chat_notifica') === false);
t('B2B via email -> rumore (regola owner 01-08 invariata)', b2bVaNelRumore('Collaborazioni e B2B', 'email_diretta') === true);
t('B2B dal modulo -> rumore (invariato)', b2bVaNelRumore('Collaborazioni e B2B', 'form_contatto') === true);
t('categoria non B2B in chat -> no', b2bVaNelRumore('Spedizione e stato ordine', 'chat_notifica') === false);
t('categoria nulla -> no', b2bVaNelRumore(null, 'email_diretta') === false);
t('cs-api applica la STESSA regola', ['chat_notifica', 'email_diretta', 'form_contatto', 'form_evento', 'rumore'].every((c) =>
  ['Collaborazioni e B2B', 'Info prodotto', null].every((k) => api.b2bVaNelRumore(k, c) === b2bVaNelRumore(k, c))));

console.log('\n== mittenti condivisi di Shopify: mai in denylist (cs-api) ==');
t('chat: no-reply@mailer.shopify.com', api.isMittenteShopify('no-reply@mailer.shopify.com') === true);
t('modulo: mailer@shopify.com', api.isMittenteShopify('mailer@shopify.com') === true);
t('maiuscole e spazi', api.isMittenteShopify('  No-Reply@Mailer.Shopify.com ') === true);
t('shopifyemail.com', api.isMittenteShopify('x@shopifyemail.com') === true);
t('cliente gmail -> bloccabile', api.isMittenteShopify('cliente@gmail.com') === false);
t('dominio che FINISCE in shopify.com ma non lo e\' -> bloccabile', api.isMittenteShopify('a@notshopify.com') === false);
t('vuoto -> bloccabile (lo ferma la validazione esistente)', api.isMittenteShopify('') === false);

console.log('\n== canale di ritorno dal rumore ==');
t('chat torna chat', api.canaleDiRitorno('chat_notifica') === 'chat_notifica');
t('modulo torna modulo', api.canaleDiRitorno('form_contatto') === 'form_contatto' && api.canaleDiRitorno('form_evento') === 'form_evento');
t('email torna email', api.canaleDiRitorno('email_diretta') === 'email_diretta');
t('entrata gia\' come rumore -> email (come prima della v12)', api.canaleDiRitorno('rumore') === 'email_diretta');
t('nessun evento ingest -> email', api.canaleDiRitorno(undefined) === 'email_diretta' && api.canaleDiRitorno(null) === 'email_diretta');

console.log('\n== voce di dominio che blocca ancora il mittente ==');
const voci = ['Report Domain: amimi.it', 'photosi.com', '@booking.com', 'support@dhl.com', 'vincenzo.terramagra@libero.it', 'conceria-alpaca.it'];
t('dominio nudo copre il sottodominio', api.voceDiDominioCheBlocca(voci, 'order@order.photosi.com') === 'photosi.com');
t('"@dominio" copre il sottodominio', api.voceDiDominioCheBlocca(voci, 'x@property.booking.com') === '@booking.com');
t('dominio esatto', api.voceDiDominioCheBlocca(voci, 'info@conceria-alpaca.it') === 'conceria-alpaca.it');
t('indirizzo esatto NON e\' una voce di dominio', api.voceDiDominioCheBlocca(voci, 'support@dhl.com') === null);
t('libero.it NON e\' bloccato dalla voce di un indirizzo', api.voceDiDominioCheBlocca(voci, 'cliente@libero.it') === null);
t('suffisso senza punto non conta', api.voceDiDominioCheBlocca(voci, 'x@notphotosi.com') === null);
t('testo libero ignorato', api.voceDiDominioCheBlocca(['Report Domain: amimi.it'], 'a@amimi.it') === null);

console.log('\n== guardie sul sorgente ==');
t('cs-classify: la vecchia regola B2B senza canale non c\'e\' piu\'', !/if \(categoria === 'Collaborazioni e B2B'\) upd\.canale = 'rumore'/.test(CLASSIFY));
t('cs-classify: rumore solo via b2bVaNelRumore(categoria, c.canale)', /if \(b2bVaNelRumore\(categoria, c\.canale\)\) upd\.canale = 'rumore';/.test(CLASSIFY));
t('cs-classify: un passaggio da solo NON va a Gemini', /if \(passaggi > 0 && inbound\.length === 0\) \{[\s\S]{0,400}?ai = \{ categoria: ''/.test(CLASSIFY));
t('cs-classify: flag passaggio_agente', /flags: \[\.\.\.ai\.flags, 'passaggio_agente'\]/.test(CLASSIFY));
t('cs-classify: il sollecito conta solo i messaggi veri (inbound filtrato)', /inboundCount: inbound\.length/.test(CLASSIFY) && /const inbound = isChat \? inboundTutti\.filter\(\(m\) => !isPassaggioAgente\(m\.body_text\)\) : inboundTutti;/.test(CLASSIFY));
t('cs-api add_noise: la denylist si scrive solo se bloccabile', /const bloccabile = !isMittenteShopify\(sender\);/.test(API) && /if \(bloccabile\) \{[\s\S]{0,900}?upsert\(\{ key: 'cs_noise_senders'/.test(API));
t('cs-api remove_noise: torna nel canale d\'origine', /update\(\{ canale: canaleDest \}\)/.test(API) && !/update\(\{ canale: 'email_diretta' \}\)/.test(API));
t('cs-api set_categoria: rumore solo via b2bVaNelRumore', /if \(b2bVaNelRumore\(categoria, ex\.canale\) && ex\.canale !== 'rumore'\) updCat\.canale = 'rumore';/.test(API));
const reDi = (s) => (s.match(/const RE_PASSAGGIO_AGENTE = (\/[^\n]+\/i);/) || [])[1];
t('UI e cs-classify usano la STESSA regex del passaggio', !!reDi(UI) && reDi(UI) === reDi(CLASSIFY), [reDi(UI), reDi(CLASSIFY)]);
const shopDi = (s) => (s.match(/\/@\(\?:shopify\\\.com\|mailer\\\.shopify\\\.com\|shopifyemail\\\.com\)\$\//g) || []).length;
t('UI e cs-api riconoscono gli stessi mittenti Shopify', shopDi(UI) === 1 && shopDi(API) === 1);

console.log(`\n== ${ok} ok, ${ko} ko ==`);
process.exit(ko ? 1 : 0);
