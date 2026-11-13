// tests/cs_chat_sito.mjs (nel glob tests/cs_*.mjs della CI): chat del sito dentro Assistenza (Fase 1 pezzo 6, docs/PROPOSTA_chat_sito.md 7.6, 7.10 e
// sez. 10). Nessuna rete, nessun DB.
//   node tests/cs_chat_sito.mjs
// Tre parti:
//   1. i 25 punti di 7.6 fissati sul sorgente: ogni ramo nuovo nelle edge vive di Assistenza scatta solo su `chat_sito` o
//      sulle chiavi `chat:` (che nascono solo a chat accesa), e i punti "da non toccare" restano com'erano;
//   2. la scheda Chat (chat-staff `imposta`) accetta solo valori che chat-api (orariFlag, testoFlag) e push-eventi
//      (orariChat, oreSollecito) leggono allo STESSO modo: C7 del pezzo 4 (un chat_orari storto valeva "sempre fuori
//      orario" per chat-api e lunedi'-venerdi' 9-18 per push-eventi, un chat_sollecito_ore storto 24,48 in silenzio);
//   3. cs-sync togliTokenChat (buco del pezzo 3, C1): il token del link "Continua la chat" non resta in Assistenza.
// Autocontrollo: ogni guardia si prova anche su un sorgente rotto e deve scattare.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 300) : '')); } };
const blocco = (src, nome) => {
  const a = src.indexOf(`// ==== PURE:${nome} BEGIN ====`), b = src.indexOf(`// ==== PURE:${nome} END ====`);
  if (a < 0 || b < a) throw new Error('marcatori PURE:' + nome + ' non trovati');
  return src.slice(a, b);
};
const funzione = (src, nome) => { const i = src.indexOf(nome); if (i < 0) return null; const j = src.indexOf('\n}\n', i); return src.slice(i, j + 2); };

const SYNC = read('supabase/functions/cs-sync/index.ts');
const API = read('supabase/functions/cs-api/index.ts');
const CLS = read('supabase/functions/cs-classify/index.ts');
const ASSIST = read('supabase/functions/cs-assist/index.ts');
const PE = read('supabase/functions/push-eventi/index.ts');
const STAFF = read('supabase/functions/chat-staff/index.ts');
const CAPI = read('supabase/functions/chat-api/index.ts');
const CSAPI = read('web/src/lib/csApi.ts');
const UI = read('web/src/pages/Assistenza.tsx');
const UICHAT = read('web/src/pages/AssistenzaChat.tsx');
const M0193 = read('supabase/migrations/0193_chat_proiezione.sql');
const M0194 = read('supabase/migrations/0194_lead_inbound_senza_chat.sql');

console.log('== 1. i 25 punti di 7.6 sul sorgente ==');
const punti = (s) => ({
  p1: (x) => /export type Canale = [^\n]*'chat_sito'/.test(x.CSAPI),
  p2: (x) => /chat_notifica: '💬 chat Inbox', chat_sito: '💬 chat sito'/.test(x.UI) && /chat_notifica: 'Chat Inbox', chat_sito: 'Chat sito'/.test(x.UI),
  p3: (x) => /chatRispondi\(sid, testo, ident, conferma\.sendKey\)/.test(x.UICHAT) && /setConferma\(\{ sendKey: crypto\.randomUUID\(\) \}\)/.test(x.UICHAT),
  p4: (x) => /chatAzione\('prendo_io', sid, ident\)/.test(x.UICHAT) && /chatAzione\('chiudi', sid, ident\)/.test(x.UICHAT) && /\{!isChatSito\(c\) && <div className="cs-actions-row">/.test(x.UI)
    && /c\.stato !== 'fatto' && !isChatSito\(c\)\) doSwipeDone\(c\)/.test(x.UI),
  p5: (x) => /Inviata anche via email/.test(x.UICHAT) && /Email non verificata/.test(x.UICHAT) && /fetchCardDelThread\(s\.gmail_thread_id\)/.test(x.UICHAT) && /'Gestita dal bot'/.test(x.UI)
    && !/presenza|visibile|last_seen/i.test(x.UICHAT.replace(/\/\/[^\n]*/g, '')),
  p6: (x) => /\.range\(pagina \* PAGINA, pagina \* PAGINA \+ PAGINA - 1\)/.test(x.CSAPI) && /\.limit\(quante\)/.test(x.CSAPI) && /q\.or\(`last_msg_at\.lt\."\$\{dopo\.last_msg_at\}",and\(last_msg_at\.eq\."\$\{dopo\.last_msg_at\}",id\.gt\.\$\{dopo\.id\}\),last_msg_at\.is\.null`\)/.test(x.CSAPI)
    && !/from\('cs_conversations'\)\.select\(CONV_COLS\)\s*\n?\s*\.neq\('canale', 'rumore'\)\s*\n?\s*\.order\('last_msg_at', \{ ascending: false, nullsFirst: false \}\);/.test(x.CSAPI)
    && /mostraProve \|\| !\(c\.flags \?\? \[\]\)\.includes\('prova'\)/.test(x.UI),
  p7: (x) => /return categoria === 'Collaborazioni e B2B' && canale !== 'chat_notifica' && canale !== 'chat_sito';/.test(x.CLS),
  p8: (x) => (x.CLS.match(/\.neq\('canale', 'rumore'\)\.neq\('canale', 'chat_sito'\)\.eq\('parse_failed', false\)/g) ?? []).length === 2,
  p9: (x) => /const CANALI_CODA = new Set\(\['email_diretta', 'form_contatto', 'form_evento', 'chat_notifica', 'chat_sito'\]\);/.test(x.API),
  p10: (x) => /return categoria === 'Collaborazioni e B2B' && canale !== 'chat_notifica' && canale !== 'chat_sito';/.test(x.API),
  p11: (x) => /const bloccabile = !chat && !isMittenteShopify\(sender\);/.test(x.API) && /isMittenteShopify\(sender\) && !isChatSito\(ex\)\) \{/.test(x.API),
  p12: (x) => /if \(isChatSito\(ex\)\) return json\(\{ error: 'chat del sito: lo stato si cambia da chat-staff/.test(x.API),
  p13: (x) => /if \(conv\.canale === 'chat_sito' \|\| String\(conv\.gmail_thread_id \?\? ''\)\.startsWith\('chat:'\)\) return json\(\{ error: 'chat del sito: niente dati ne\\' bozze AI \(7\.10\)' \}, 422\);/.test(x.ASSIST)
    && (x.ASSIST.match(/\.is\('summary', null\)\.neq\('canale', 'rumore'\)\.neq\('canale', 'chat_sito'\)/g) ?? []).length === 2
    && /if \(isChatSito\(c\)\) return;\n\s*\/\/ parte 3:/.test(x.UI),
  p14: (x) => /\.neq\('canale', 'rumore'\)\.neq\('canale', 'chat_sito'\)\.eq\('stato', 'da_fare'\);/.test(x.SYNC),
  p15: (x) => /select\('id, subject, canale, categoria'\)\.neq\('canale', 'rumore'\)\.neq\('canale', 'chat_sito'\);/.test(x.SYNC)
    && /select\('id, subject, customer_email, canale, categoria_source, order_number'\)\.neq\('canale', 'rumore'\)\.neq\('canale', 'chat_sito'\);/.test(x.SYNC),
  p16: (x) => /if \(String\(c\.gmail_thread_id\)\.includes\('#'\) \|\| String\(c\.gmail_thread_id\)\.startsWith\('chat:'\)\) continue;/.test(x.SYNC),
  p17: (x) => /\.is\('reply_to', null\)\.not\('gmail_message_id', 'like', 'chat:%'\)/.test(x.SYNC),
  p18: (x) => /\.eq\('canale', 'chat_notifica'\)\.neq\('stato', 'fatto'\)\.lt\('last_msg_at', soglia\)/.test(x.SYNC) && !/chat_autoclose[\s\S]{0,600}chat_sito/.test(x.SYNC),
  p20: (x) => /v\.urgente !== true \|\| v\.canale === 'rumore' \|\| v\.canale === 'chat_sito'\) continue;/.test(x.PE),
  p21: (x) => /lt\('last_msg_at', ieri\)\.neq\('canale', 'rumore'\)\.not\('flags', 'cs', '\["prova"\]'\)\), 'richieste ferme'\)/.test(x.PE)
    && /gte\('created_at', t0\)\.neq\('canale', 'rumore'\)\.not\('flags', 'cs', '\["prova"\]'\)\.or\('stato_by\.is\.null,stato_by\.neq\.bot'\)\), 'richieste nuove'\)/.test(x.PE),
  p23: (x) => /where c\.last_msg_at > now\(\) - interval '30 days'\n    and c\.gmail_thread_id not like 'chat:%'/.test(x.M0194) && /with \(security_invoker = on\)/.test(x.M0194),
  p25: (x) => /if \(!mail \|\| isChatSito\(c\)\) return \[\];/.test(x.UI) && /x\.canale !== 'rumore' && !isChatSito\(x\)/.test(x.UI) && /Stessa email dichiarata/.test(x.UICHAT),
});
const SRC = { SYNC, API, CLS, ASSIST, PE, CSAPI, UI, UICHAT, M0194 };
const P = punti();
for (const [k, f] of Object.entries(P)) t(`punto ${k.slice(1)} di 7.6`, f(SRC));
// i rami nuovi delle edge vive scattano solo su chat_sito o chat: (le stringhe nuove nel diff stanno in quei confronti)
t('cs-api: isChatSito guarda solo canale chat_sito o chiave chat:', (funzione(API, 'function isChatSito(') ?? '').trim().endsWith("return !!c && (c.canale === 'chat_sito' || String(c.gmail_thread_id ?? '').startsWith('chat:'));\n}"));
const interna = (src, nome) => { const i = src.indexOf(nome); if (i < 0) return null; const j = src.indexOf('\n  };\n', i); return j < 0 ? null : src.slice(i, j + 5); };
t('cs-sync: setStatoAuto e recomputeUrgency non nominano la chat (7.6: da non toccare)', [interna(SYNC, 'const setStatoAuto = async'), interna(SYNC, 'const recomputeUrgency = async')]
  .every((f) => f !== null && f.length > 200 && !/chat_sito|chat:/.test(f)));
t('chat-api e chat-staff proiettano solo con l\'RPC chat_proietta (mai insert diretti in cs_)', /sb\.rpc\('chat_proietta', \{ p_sessione: sessioneId \}\)/.test(CAPI) && /sb\.rpc\('chat_proietta', \{ p_sessione: sessioneId \}\)/.test(STAFF)
  && !/from\('cs_(conversations|messages|events)'\)\.(insert|upsert|update)/.test(CAPI + STAFF));
t('0193: proiezione con canale scritto solo alla nascita, categoria mai toccata', /on conflict \(gmail_thread_id\) do update set/.test(M0193)
  && !/do update set[\s\S]{0,900}\bcanale\s*=/.test(M0193) && !/categoria\s*=/.test(M0193));
// autocontrollo: ogni punto scatta su un sorgente rotto
const rotti = {
  p1: { CSAPI: CSAPI.replace("'chat_notifica' | 'chat_sito'", "'chat_notifica'") }, p6: { CSAPI: CSAPI.replace('.range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1)', '') },
  p7: { CLS: CLS.replace(" && canale !== 'chat_sito';", ';') }, p8: { CLS: CLS.replace(".neq('canale', 'rumore').neq('canale', 'chat_sito').eq('parse_failed', false)", ".neq('canale', 'rumore').eq('parse_failed', false)") },
  p11: { API: API.replace('const bloccabile = !chat && !isMittenteShopify(sender);', 'const bloccabile = !isMittenteShopify(sender);') },
  p12: { API: API.replace("if (isChatSito(ex)) return json({ error: 'chat del sito: lo stato", "if (false) return json({ error: 'chat del sito: lo stato") },
  p13: { UI: UI.replace('if (isChatSito(c)) return;', '') }, p16: { SYNC: SYNC.replace(" || String(c.gmail_thread_id).startsWith('chat:')) continue;", ') continue;') },
  p18: { SYNC: SYNC.replace(".eq('canale', 'chat_notifica').neq('stato', 'fatto')", ".in('canale', ['chat_notifica', 'chat_sito']).neq('stato', 'fatto')") },
  p20: { PE: PE.replace(" || v.canale === 'chat_sito') continue;", ') continue;') }, p23: { M0194: M0194.replace("    and c.gmail_thread_id not like 'chat:%'\n", '') },
  p25: { UI: UI.replace(' && !isChatSito(x)', '') },
};
for (const [k, mod] of Object.entries(rotti)) t(`autocontrollo: il punto ${k.slice(1)} scatta su un sorgente rotto`, !P[k]({ ...SRC, ...mod }));

console.log('\n== 2. scheda Chat: i valori che chat-staff accetta li leggono uguale chat-api e push-eventi ==');
const F = new Function(stripTypeScriptTypes(blocco(STAFF, 'chat-staff')) + '\nreturn { valoreScheda, faqDeiBottoni };')();
const CA = new Function(stripTypeScriptTypes(blocco(CAPI, 'chat-api')) + '\nreturn { interpretaFlag, inOrario };')();
const peSrc = ['const FUSO = \'Europe/Rome\';', (PE.match(/const ORARI_CHAT_DEFAULT[^\n]+/) ?? [''])[0], (PE.match(/const ORA_HHMM_RE[^\n]+/) ?? [''])[0], funzione(PE, 'function orariChat('),
  (PE.match(/const ORE_SOLLECITO_DEFAULT[^\n]+/) ?? [''])[0], funzione(PE, 'function oreSollecito(')].join('\n');
const PEF = new Function(stripTypeScriptTypes(peSrc) + '\nreturn { orariChat, oreSollecito, ORARI_CHAT_DEFAULT };')();
const ORARI = [
  { tz: 'Europe/Rome', giorni: [1, 2, 3, 4, 5], dalle: '09:00', alle: '18:00', chiusure: [] },
  { tz: 'Europe/Rome', giorni: [6, 1, 1], dalle: '00:00', alle: '23:59', chiusure: ['2026-12-25', '2026-12-24'] },
  { tz: 'Europe/Rome', giorni: [7], dalle: '10:30', alle: '10:31' },
];
for (const o of ORARI) {
  const v = F.valoreScheda('chat_orari', o);
  const a = CA.interpretaFlag({ chat_orari: v }).orari, p = PEF.orariChat(v);
  t(`orari ${JSON.stringify(o).slice(0, 70)}: accettati e letti uguale`, v !== null && a !== null && p !== PEF.ORARI_CHAT_DEFAULT && JSON.stringify(a) === JSON.stringify(p), { v, a, p });
}
const STORTI = [
  { tz: 'Europe/Rome', giorni: [], dalle: '09:00', alle: '18:00', chiusure: [] }, { tz: 'Europe/Rome', giorni: [1], dalle: '18:00', alle: '18:00', chiusure: [] },
  { tz: 'Marte/Base', giorni: [1], dalle: '09:00', alle: '18:00', chiusure: [] }, { tz: 'Europe/Rome', giorni: [0, 1], dalle: '09:00', alle: '18:00', chiusure: [] },
];
for (const o of STORTI) {
  const letture = [CA.interpretaFlag({ chat_orari: JSON.stringify(o) }).orari, PEF.orariChat(JSON.stringify(o))];
  t(`orari storti ${JSON.stringify(o).slice(0, 60)}: rifiutati (chat-api e push-eventi li leggerebbero diversi)`, F.valoreScheda('chat_orari', o) === null, letture);
}
for (const [a, b] of [[24, 48], [0.05, 0.1], [1.5, 240], [0.123, 0.124]]) {
  const v = F.valoreScheda('chat_sollecito_ore', [a, b]);
  t(`solleciti ${a},${b}: salvati "${v}" e letti uguale da push-eventi`, v === `${a},${b}` && JSON.stringify(PEF.oreSollecito(v)) === JSON.stringify([a, b]));
}
for (const x of [[0.0001, 1], [1, 1], [2, 1], [1, 241], [1.2345, 2]]) t(`solleciti ${x}: rifiutati`, F.valoreScheda('chat_sollecito_ore', x) === null);
const tx = F.valoreScheda('chat_testo_attesa', { it: 'Ti rispondiamo entro 2 giorni a {email}', en: 'We reply within 2 days to {email}' });
t('testo: chat-api lo legge (testoFlag) cosi\' come salvato', JSON.stringify(CA.interpretaFlag({ chat_testo_attesa: tx }).testi.attesa) === tx);
t('testo oltre i 1000 punti di codice di chat-api: rifiutato', F.valoreScheda('chat_testo_saluto', { it: 'x'.repeat(1001), en: 'y' }) === null
  && F.valoreScheda('chat_testo_saluto', { it: '😀'.repeat(1000), en: 'y' }) !== null);
t('faqDeiBottoni: stesso criterio di bottoniFlag di chat-api (id intero positivo, primi 8)', JSON.stringify(F.faqDeiBottoni('[{"faq":7},{"faq":null},{"faq":"8"},{"faq":7},{"faq":-1},{"faq":1.5}]')) === '[7]'
  && JSON.stringify(F.faqDeiBottoni('non json')) === '[]');

console.log('\n== 3. cs-sync togliTokenChat (C1 del pezzo 3) ==');
const S = new Function(stripTypeScriptTypes(blocco(SYNC, 'cs-tokenchat')) + '\nreturn { togliTokenChat };')();
const TOK = 'Ab0_-cDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcd';
t('il token di prova e\' di 43 caratteri base64url', TOK.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(TOK));
const LINK = 'https://amimi.it/apps/chat/riprendi#t=';
const casi = [
  ['link semplice', `Continua la chat: ${LINK}${TOK}\nAmimì Milano`, `Continua la chat: ${LINK}[link personale tolto]\nAmimì Milano`],
  ['sessione di prova', `${LINK}${TOK}&prova=1 fine`, `${LINK}[link personale tolto]&prova=1 fine`],
  ['citato con "> " e a capo dentro il token', `> ${LINK}${TOK.slice(0, 30)}\n> ${TOK.slice(30)}\n> Amimì`, `> ${LINK}[link personale tolto]\n> Amimì`],
  ['due link', `${LINK}${TOK} e ${LINK}${TOK}.`, `${LINK}[link personale tolto] e ${LINK}[link personale tolto].`],
  ['altro #t= (un video) intatto', 'https://youtu.be/x#t=30s e https://amimi.it/apps/chat/riprendi senza token', 'https://youtu.be/x#t=30s e https://amimi.it/apps/chat/riprendi senza token'],
  ['testo senza link intatto', 'Buongiorno, ordine #1917', 'Buongiorno, ordine #1917'],
  ['vuoto', '', ''],
];
for (const [n, a, b] of casi) t(`togliTokenChat: ${n}`, S.togliTokenChat(a) === b, S.togliTokenChat(a));
t('togliTokenChat: nessun pezzo del token sopravvive', !S.togliTokenChat(`x ${LINK}${TOK.slice(0, 20)}\r\n>  ${TOK.slice(20)} y`).includes(TOK.slice(20, 30)));
const lungo = (LINK + ' '.repeat(50)).repeat(4000) + LINK + 'a'.repeat(200000);
const t0 = Date.now(); S.togliTokenChat(lungo);
t('togliTokenChat lineare: 400 KB di link e spazi in meno di 200 ms', Date.now() - t0 < 200, Date.now() - t0);
t('cs-sync: il token si toglie nei tre punti dove entra un corpo (out, backfill_out, in) e dallo snippet di Gmail',
  (SYNC.match(/togliTokenChat\(stripNull\(extractBody\((msg|m)\.payload\)\)\)/g) ?? []).length === 3 && /togliTokenChat\(msg\.snippet \?\? ''\)/.test(SYNC)
  && !/[^(]stripNull\(extractBody\(/.test(SYNC.replace(/togliTokenChat\(stripNull\(extractBody\(/g, '')));

console.log('\n== 4. Gate 2 del pezzo 6 ==');
t('B3: cs-api add_noise su una chat ancora aperta = 422 (lettura controllata di chat_sessioni, 503 se non leggibile)',
  /from\('chat_sessioni'\)\.select\('stato'\)\.eq\('id', sid\)\.limit\(1\)\);\n\s*if \(sErr\) return json\(\{ error: 'chat non leggibile, riprova: ' \+ sErr\.message \}, 503\);/.test(API)
  && /if \(statoChat !== undefined && statoChat !== 'chiusa'\) return json\(\{ error: 'chat ancora aperta: chiudila prima/.test(API)
  && /if \(aperta\) await chatAzione\('chiudi', sid, ident\);\n\s*await addNoise\(/.test(UICHAT));
t('C4: backfill_order_number, backfill_snippet e backfill_clean saltano la chat',
  /\.is\('order_number', null\)\.neq\('canale', 'rumore'\)\.neq\('canale', 'chat_sito'\);/.test(SYNC)
  && /select\('id, canale, snippet'\)\.neq\('canale', 'chat_sito'\)/.test(SYNC)
  && /\.not\('body_text', 'is', null\)\.not\('gmail_message_id', 'like', 'chat:%'\)/.test(SYNC));
t('C6: le conversazioni precedenti di un\'email (contesto e riassunto di cs-assist) non contano le chat',
  (ASSIST.match(/\.eq\('customer_email', [^\n]{0,80}\.neq\('id', [^\n]{0,40}\.neq\('canale', 'chat_sito'\)/g) ?? []).length === 2);
const COD = `https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Famimi.it%2Fapps%2Fchat%2Friprendi%23t%3D${TOK}%26prova%3D1&data=x`;
t('C5: token tolto anche dal link codificato di un client (Outlook Safe Links)', S.togliTokenChat(COD) === 'https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Famimi.it%2Fapps%2Fchat%2Friprendi%23t%3D[link personale tolto]%26prova%3D1&data=x', S.togliTokenChat(COD));
t('C5: maiuscole nella codifica (%2F, %23, %3D) e testo intorno intatti', !S.togliTokenChat(`Vedi APPS%2FCHAT%2FRIPRENDI%23T%3D${TOK} ciao`).includes(TOK) && S.togliTokenChat(`Vedi APPS%2FCHAT%2FRIPRENDI%23T%3D${TOK} ciao`).endsWith(' ciao'));
const B2 = read('supabase/functions/chat-api/index.ts');
t('B2: B4 solo per un messaggio nuovo, e una risposta concorrente dello staff fa perdere l\'update', /if \(persona && s\.stato === 'aperta' && doppione\) \{/.test(B2)
  && /if \(se\.risposta !== undefined\) q = se\.risposta === null \? q\.is\('ultima_risposta_staff_at', null\) : q\.eq\('ultima_risposta_staff_at', se\.risposta\);/.test(B2));
t('B4: il cron della proiezione conta gli errori in glob:proiezione_ko e passa prima le sessioni recenti', /perform chat_contatore_incrementa\('glob:proiezione_ko', 86400, 1000000\);/.test(M0193)
  && /order by s\.ultima_attivita_at desc\n\s*limit 50/.test(M0193) && /'glob:proiezione_ko'\]/.test(PE));

console.log(`\ncs_chat_sito: ${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
