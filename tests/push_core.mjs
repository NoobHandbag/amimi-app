// tests/push_core.mjs: i blocchi PURE di push-api ritagliati DAL SORGENTE che va in produzione (payload Declarative Web
// Push, esiti del servizio push, host ammessi, validazione dell'iscrizione, Topic, confronto a tempo costante), piu' le
// guardie sul sorgente (cancello del team, ramo servizio solo per invia, letture controllate, scritture mai ritentate,
// versione di web-push pinnata, payload solo dal costruttore). Nessuna rete, nessun DB, nessuna libreria web-push.
//   node tests/push_core.mjs
// Perche' esiste (17-10, brief notifiche native): la edge manda POST verso indirizzi che arrivano dal telefono e cancella
// iscrizioni in base alla risposta del servizio push. Un host ammesso per sbaglio e' un SSRF, un esito letto male cancella
// telefoni buoni o tiene in vita quelli morti; nessuno dei due si vede finche' non succede.
// Gate 3 (17-10): anche le decisioni che prima vivevano solo nel sorgente sono blocchi PURE provati qui (coppia e padding
// delle chiavi VAPID, punto p256dh sulla curva, flag, effetto dell'esito sulla riga, giro di invia con spedizione finta,
// elenco dispositivi senza device_id, log ripulito); il resto e' fissato da guardie esatte, ognuna col suo autocontrollo.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createECDH, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = readFileSync(`${ROOT}supabase/functions/push-api/index.ts`, 'utf8').replace(/\r\n/g, '\n');
const CONFIG = readFileSync(`${ROOT}supabase/config.toml`, 'utf8').replace(/\r\n/g, '\n');
const BLOCCHI = ['push-confronto', 'push-endpoint', 'push-valida', 'push-payload', 'push-esito', 'push-topic', 'push-flag', 'push-giro', 'push-dispositivi'];
const cut = (s, name) => {
  const B = `// ==== PURE:${name} BEGIN ====`, E = `// ==== PURE:${name} END ====`;
  const a = s.indexOf(B), b = s.indexOf(E);
  if (a < 0 || b < 0 || b < a) return null;
  return s.slice(a + B.length, b).trim();
};
for (const b of BLOCCHI) if (cut(SRC, b) === null) { console.error(`marcatori PURE:${b} non trovati in push-api`); process.exit(1); }
const ESPORTA = ['ugualeCostante', 'endpointAmmesso', 'byteB64url', 'normDevice', 'normEtichetta', 'normTemi', 'temiNonAmmessi', 'validaSubscription',
  'validaIscrizione', 'controllaVapid', 'provaTroppoPresto', 'CHI_AMMESSI', 'APP_URL', 'PAYLOAD_MAX', 'pulisciTesto', 'navigaSicuro', 'costruisciPayload',
  'esitoInvio', 'MESSAGGI_ESITO', 'topicDi', 'puntoP256', 'vapidDa', 'coppiaVapidCoerente', 'vapidControllato', 'SUBJECT_DEFAULT', 'azioneEsito',
  'riassuntoErrore', 'flagVero', 'giroInvio', 'vistaDispositivi'];
const TMP = `${ROOT}tests/_push_core.tmp.ts`;
writeFileSync(TMP, `${BLOCCHI.map((b) => cut(SRC, b)).join('\n')}\nexport { ${ESPORTA.join(', ')} };\n`, 'utf8');
let M;
try { M = await import(pathToFileURL(TMP).href); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }
const { ugualeCostante, endpointAmmesso, byteB64url, normDevice, normEtichetta, normTemi, temiNonAmmessi, validaSubscription, validaIscrizione, controllaVapid,
  provaTroppoPresto, CHI_AMMESSI, APP_URL, PAYLOAD_MAX, pulisciTesto, navigaSicuro, costruisciPayload, esitoInvio, MESSAGGI_ESITO, topicDi, puntoP256, vapidDa,
  coppiaVapidCoerente, vapidControllato, SUBJECT_DEFAULT, azioneEsito, riassuntoErrore, flagVero, giroInvio, vistaDispositivi } = M;

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 220) : '')); } };
const bytes = (s) => new TextEncoder().encode(s).length;
const leggi = (s) => { try { return JSON.parse(s); } catch { return null; } };
const surrogatiSpaiati = (s) => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const d = s.charCodeAt(i + 1); if (!(d >= 0xdc00 && d <= 0xdfff)) return true; i++; }
    else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
};
const EMOJI = String.fromCodePoint(0x1f600);
const BACKSLASH = String.fromCharCode(92);
const EM_DASH = String.fromCodePoint(0x2014);

console.log('== payload Declarative Web Push ==');
{
  const p = costruisciPayload({ titolo: '  Conti  ', testo: ' Un errore nuovo nei conti. ', url: '#notifiche' });
  const o = leggi(p);
  t('1  forma: {web_push:8030, mutable:true, notification:{title, body, navigate, lang}} (mutable: su iOS 18.4+ la push passa da sw.js)',
    o && Object.keys(o).join() === 'web_push,mutable,notification' && o.web_push === 8030 && o.mutable === true
    && Object.keys(o.notification).join() === 'title,body,navigate,lang', o);
  t('2  titolo e testo ripuliti, lingua it', o?.notification.title === 'Conti' && o?.notification.body === 'Un errore nuovo nei conti.' && o?.notification.lang === 'it', o);
  t('3  navigate relativo (#notifiche) risolto dentro l\'app', o?.notification.navigate === APP_URL + '#notifiche', o?.notification.navigate);
  t('4  APP_URL e\' la radice della PWA', APP_URL === 'https://noobhandbag.github.io/amimi-app/');
  const vuoto = leggi(costruisciPayload({}));
  t('5  titolo vuoto -> Amimì, testo vuoto ammesso, navigate = radice', vuoto?.notification.title === 'Amimì' && vuoto?.notification.body === '' && vuoto?.notification.navigate === APP_URL, vuoto);
  const strani = leggi(costruisciPayload({ titolo: 42, testo: { a: 1 }, url: 7 }));
  t('6  campi non stringa -> default, niente "[object Object]"', strani?.notification.title === 'Amimì' && strani?.notification.body === '' && strani?.notification.navigate === APP_URL, strani);
  t('7  testo corto: nessun taglio', leggi(costruisciPayload({ titolo: 'x', testo: 'Ciao' }))?.notification.body === 'Ciao');
}
{
  const DENTRO = [['#conti', APP_URL + '#conti'], [APP_URL + '#vendite', APP_URL + '#vendite'], ['/amimi-app/#vendite', APP_URL + '#vendite'],
    [APP_URL + '?x=1#conti', APP_URL + '?x=1#conti'], [APP_URL, APP_URL]];
  t('8  URL dentro l\'app tenuti (anche relativi)', DENTRO.every(([u, e]) => navigaSicuro(u) === e), DENTRO.map(([u]) => navigaSicuro(u)));
  const FUORI = ['https://evil.com/', 'javascript:alert(1)', '//evil.com/amimi-app/', 'https://noobhandbag.github.io@evil.com/amimi-app/',
    'https://noobhandbag.github.io/amimi-app/../evil', 'https://noobhandbag.github.io/amimi-app/%2e%2e/evil', 'http://noobhandbag.github.io/amimi-app/',
    'https://noobhandbag.github.io/amimi-appX/', 'https://noobhandbag.github.io/amimi-app', 'https://noobhandbag.github.io.evil.com/amimi-app/',
    'https://user:pw@noobhandbag.github.io/amimi-app/', 'https://noobhandbag.github.io:444/amimi-app/', 'data:text/html,x', 'https://evil.com/?r=' + APP_URL,
    APP_URL + 'a'.repeat(1200), '', '   ', 42, null, undefined, {}];
  const sbagliati = FUORI.filter((u) => navigaSicuro(u) !== APP_URL);
  t('9  URL esterni, falsi o troppo lunghi -> radice dell\'app', sbagliati.length === 0, sbagliati);
  const viaPayload = leggi(costruisciPayload({ titolo: 'x', testo: 'y', url: 'https://evil.com/phish' }));
  t('10 un URL esterno nel payload diventa la radice', viaPayload?.notification.navigate === APP_URL, viaPayload);
}
{
  const lungo = costruisciPayload({ titolo: 'Conti', testo: 'a'.repeat(10000) });
  const o = leggi(lungo);
  t('11 testo ASCII lunghissimo: sotto 3.000 byte, JSON valido, finisce con ...', PAYLOAD_MAX === 3000 && bytes(lungo) < 3000 && o && o.notification.body.endsWith('...'), bytes(lungo));
  t('12 e il taglio usa quasi tutto lo spazio (> 2.990 byte)', bytes(lungo) > 2990, bytes(lungo));
  const emo = costruisciPayload({ titolo: EMOJI + ' Vendite', testo: EMOJI.repeat(3000) });
  const oe = leggi(emo);
  t('13 testo di emoji: sotto 3.000 byte, JSON valido, nessun surrogato spaiato', bytes(emo) < 3000 && bytes(emo) > 2990 && oe && !surrogatiSpaiati(oe.notification.body) && oe.notification.body.endsWith('...'), bytes(emo));
  t('14 nessuna sequenza di escape unicode nel JSON (emoji intere, controlli tolti)', !emo.includes(BACKSLASH + 'u') && !lungo.includes(BACKSLASH + 'u'));
  const esc = costruisciPayload({ titolo: 'x', testo: ('"' + BACKSLASH).repeat(2000) });
  t('15 virgolette e backslash (escape JSON contati nei byte): sotto 3.000, JSON valido', bytes(esc) < 3000 && bytes(esc) > 2990 && leggi(esc)?.notification.body.endsWith('...'), bytes(esc));
  const peggio = costruisciPayload({ titolo: EMOJI.repeat(500), testo: EMOJI.repeat(5000), url: APP_URL + '#' + 'b'.repeat(950) });
  const op = leggi(peggio);
  t('16 caso peggiore (titolo, URL e testo al massimo): sotto 3.000 e il testo c\'e\' ancora', bytes(peggio) < 3000 && op && op.notification.body.length > 10, bytes(peggio));
  t('17 titolo tagliato a 120 punti di codice, senza spezzare emoji', op && Array.from(op.notification.title).length === 120 && !surrogatiSpaiati(op.notification.title));
  const ctrl = leggi(costruisciPayload({ titolo: 'a\nb', testo: 'x' + String.fromCharCode(0) + 'y' + String.fromCharCode(9) + 'z' + String.fromCharCode(13) + '\nriga' }));
  t('18 controlli tolti (NUL, tab, CR), a capo tenuto nel testo e tolto dal titolo', ctrl?.notification.title === 'a b' && ctrl?.notification.body === 'x y z \nriga', ctrl);
  t('19 pulisciTesto: non stringa -> vuoto, DEL tolto', pulisciTesto(undefined) === '' && pulisciTesto('a' + String.fromCharCode(127) + 'b') === 'a b');
}

console.log('\n== esiti del servizio push ==');
{
  const casi = [
    [200, '', 'ok'], [201, '', 'ok'], [202, '', 'ok'],
    [404, '', 'rimuovi'], [410, 'push subscription has unsubscribed or expired.', 'rimuovi'],
    [400, '{"reason":"VapidPkHashMismatch"}', 'rimuovi'], [403, '{"reason":"VapidPkHashMismatch"}', 'rimuovi'],
    [403, 'the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions.', 'rimuovi'],
    [400, 'Credentials DO NOT CORRESPOND', 'rimuovi'], [403, { reason: 'VapidPkHashMismatch' }, 'rimuovi'],
    [403, '{"reason":"BadJwtToken"}', 'config'], [403, '', 'config'], [401, '', 'config'], [401, '{"reason":"ExpiredJwtToken"}', 'config'],
    [413, '', 'payload'], [429, 'slow down', 'limite'],
    [500, '', 'transitorio'], [502, '', 'transitorio'], [503, '', 'transitorio'], [504, '', 'transitorio'], [400, '{"reason":"BadWebPushTopic"}', 'transitorio'],
    [null, 'Socket timeout', 'transitorio'], [undefined, '', 'transitorio'], [NaN, '', 'transitorio'], ['201', '', 'transitorio'],
    [201, 'VapidPkHashMismatch', 'ok'],
  ];
  const sbagli = casi.filter(([s, c, e]) => esitoInvio(s, c) !== e).map(([s, c, e]) => ({ s, c, atteso: e, dato: esitoInvio(s, c) }));
  t('20 tutte le classi di codice del brief (2xx, 404/410, mismatch VAPID, 401/403, 413, 429, 5xx, rete)', sbagli.length === 0, sbagli);
  const effetto = (s, c) => azioneEsito(esitoInvio(s, c), s, 0, 'T').cancella;
  t('21 un 403 di mismatch cancella la riga, un 403 qualunque no (errore nostro: la riga resta)', esitoInvio(403, 'VapidPkHashMismatch') === 'rimuovi' && esitoInvio(403, 'Forbidden') === 'config'
    && effetto(403, 'VapidPkHashMismatch') === true && effetto(403, 'Forbidden') === false && effetto(401, '') === false);
  const T = '2026-10-17T10:00:00.000Z';
  const tabella = [
    ['ok', 201, 4, { cancella: false, patch: { last_status: 201, updated_at: T, last_ok_at: T, fail_count: 0 } }],
    ['rimuovi', 410, 4, { cancella: true, patch: {} }],
    ['rimuovi', 404, 4, { cancella: true, patch: {} }],
    ['config', 403, 4, { cancella: false, patch: { last_status: 403, updated_at: T } }],
    ['config', 401, 4, { cancella: false, patch: { last_status: 401, updated_at: T } }],
    ['payload', 413, 4, { cancella: false, patch: { last_status: 413, updated_at: T } }],
    ['limite', 429, 4, { cancella: false, patch: { last_status: 429, updated_at: T } }],
    ['transitorio', 503, 4, { cancella: false, patch: { last_status: 503, updated_at: T, fail_count: 5 } }],
    ['transitorio', null, 4, { cancella: false, patch: { last_status: 0, updated_at: T, fail_count: 5 } }],
    ['transitorio', 500, null, { cancella: false, patch: { last_status: 500, updated_at: T, fail_count: 1 } }],
    ['transitorio', 502, 'x', { cancella: false, patch: { last_status: 502, updated_at: T, fail_count: 1 } }],
  ];
  const diversi = tabella.filter(([e, s, f, atteso]) => !isDeepStrictEqual(azioneEsito(e, s, f, T), atteso)).map(([e, s, f]) => ({ e, s, f, dato: azioneEsito(e, s, f, T) }));
  t('21b effetto sulla riga: SOLO rimuovi cancella; ok azzera fail_count e scrive last_ok_at; transitorio +1; config, payload, limite lasciano fail_count; nessuna risposta = 0',
    diversi.length === 0, diversi);
  t('22 corpo ciclico non fa lanciare', (() => { const c = {}; c.c = c; try { return esitoInvio(403, c) === 'config'; } catch { return false; } })());
  const chiavi = ['ok', 'rimuovi', 'config', 'payload', 'limite', 'transitorio'];
  t('23 un messaggio italiano per ogni esito, senza em dash', chiavi.every((k) => typeof MESSAGGI_ESITO[k] === 'string' && MESSAGGI_ESITO[k].length > 10 && !MESSAGGI_ESITO[k].includes(EM_DASH))
    && Object.keys(MESSAGGI_ESITO).sort().join() === [...chiavi].sort().join());
}

console.log('\n== log di un invio non riuscito ==');
{
  const TOKEN = 'dGVzdA:APA91bTOKENSEGRETO';
  const rete = riassuntoErrore('TypeError', null, `error sending request for url (https://fcm.googleapis.com/fcm/send/${TOKEN}): connection reset`);
  t('23b URL -> [url] (il token dell\'endpoint non esce), nome dell\'errore, "nessuna risposta HTTP"', !rete.includes('APA91') && !rete.includes('fcm.googleapis')
    && rete.includes('[url]') && rete.startsWith('TypeError (nessuna risposta HTTP): ') && rete.includes('connection reset'), rete);
  const apple = riassuntoErrore('WebPushError', 403, '{"reason":"BadJwtToken"}');
  t('23c codice HTTP e corpo del servizio push tenuti', apple === 'WebPushError (403): {"reason":"BadJwtToken"}', apple);
  const lunghi = [riassuntoErrore('E', 500, 'x'.repeat(195) + ' https://web.push.apple.com/QGx2SEGRETO'), riassuntoErrore('E', 500, 'x'.repeat(150) + ' https://web.push.apple.com/QGx2SEGRETO fine')];
  t('23d testo al massimo 200 punti di codice; nessun pezzo di endpoint, ne\' al bordo del taglio ne\' in fondo al testo', lunghi.every((l) => Array.from(l.slice(l.indexOf(': ') + 2)).length <= 200
    && !l.includes('SEGRETO') && !l.includes('apple')) && lunghi[1].endsWith('[url] fine') && Array.from(riassuntoErrore('E', 500, EMOJI.repeat(500)).split(': ')[1]).length === 200, lunghi.map((l) => l.slice(-20)));
  const ctrl = riassuntoErrore('E' + String.fromCharCode(10) + 'x', 500, 'a' + String.fromCharCode(0) + 'b' + String.fromCharCode(10) + 'c' + String.fromCharCode(13) + String.fromCharCode(0x2028) + 'd');
  t('23e caratteri di controllo e a capo tolti (una riga di log sola)', ![...ctrl].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 0x2028) && ctrl === 'E x (500): a b c d', ctrl);
  const ciclico = {}; ciclico.c = ciclico;
  const ostile = new Proxy({}, { get() { throw new Error('no'); }, ownKeys() { throw new Error('no'); }, getOwnPropertyDescriptor() { throw new Error('no'); } });
  const strani = [undefined, null, {}, ciclico, Symbol('s'), Object.create(null), ostile, BigInt(10), 42, ['a'], 'x'.repeat(10000)];
  const lancia = [];
  for (const a of strani) for (const b of [a, 'E']) { try { const r = riassuntoErrore(b, a, a); if (typeof r !== 'string' || !r) lancia.push(String(typeof a)); } catch { lancia.push(typeof a); } }
  t('23f non lancia mai: undefined, oggetti ciclici, Symbol, senza prototipo, Proxy ostile, BigInt, 10.000 caratteri', lancia.length === 0, lancia);
}

console.log('\n== host ammessi (anti-SSRF) ==');
const AMMETTE = [
  'https://fcm.googleapis.com/fcm/send/dGVzdA:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv3hVZjC9KtT8OvPVGJ-hQMRKRrZuJAEcl7B338qju59zJMjw2DELjzEvxwYv7hH5Ynpc1ODQ0aT4U4OFEeco8ohsN5PjL1iC2dNtk2BAokeMCg2ZXKqpc8FXKmhX94kIxQ',
  'https://fcm.googleapis.com/wp/dGVzdA:APA91bE-abc_123',
  'https://web.push.apple.com/QGx2bX8uVn0eY7K5S3dM6gZxR1vY9jK2mP4nQ8wE3tH5',
  'https://api.push.apple.com/3/device/abc',
  'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk_test-Token_123',
  'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB%2bXyz%3d',
];
const RIFIUTA = [
  'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com:443/fcm/send/x', 'https://fcm.googleapis.com:8443/fcm/send/x',
  'https://user:pass@fcm.googleapis.com/fcm/send/x', 'https://user@web.push.apple.com/x', 'https://fcm.googleapis.com.evil.com/fcm/send/x',
  'https://FCM.GOOGLEAPIS.COM.evil.com/x', 'https://evilpush.apple.com/x', 'https://push.apple.com/x', 'https://evil.com/fcm.googleapis.com/x',
  'https://evil.com/?h=web.push.apple.com', 'https://evilnotify.windows.com/x', 'https://notify.windows.com/x', 'https://push.services.mozilla.com.evil.com/x',
  'https://evilpush.services.mozilla.com/x', 'https://fcm.googleapis.com./x', 'https://fcm.googleapis.com', 'https://127.0.0.1/x', 'https://[::1]/x',
  'https://localhost/x', 'https:' + BACKSLASH + BACKSLASH + 'fcm.googleapis.com' + BACKSLASH + 'x', 'https://fcm.googleapis.com/fcm/send/x y',
  'https://.push.apple.com/x', 'https://a..push.apple.com/x', 'ftp://fcm.googleapis.com/x', 'javascript:alert(1)', 'https://fcm.googleapis.com/' + 'a'.repeat(2100),
  '', null, undefined, 42, {}, ['https://fcm.googleapis.com/x'],
];
{
  const noAmm = AMMETTE.filter((e) => endpointAmmesso(e) !== e);
  t('24 endpoint veri di FCM, Apple, Mozilla e WNS ammessi (e restituiti uguali)', noAmm.length === 0, noAmm);
  const passati = RIFIUTA.filter((e) => endpointAmmesso(e) !== null);
  t('25 rifiutati: http, porte (anche :443), credenziali, host simili senza il punto, IP, barre rovesciate, spazi, troppo lunghi, non stringhe', passati.length === 0, passati);
  t('26 spazi attorno tolti', endpointAmmesso('  ' + AMMETTE[1] + '  ') === AMMETTE[1]);
}

console.log('\n== validazione ==');
const P256 = createECDH('prime256v1').generateKeys().toString('base64url');
const P256_ALTRA = createECDH('prime256v1').generateKeys().toString('base64url');
// controprova indipendente da puntoP256: node:crypto rifiuta un JWK EC con un punto fuori curva
const sullaCurva = (b64) => { const b = Buffer.from(b64, 'base64url'); try { createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b.subarray(1, 33).toString('base64url'), y: b.subarray(33, 65).toString('base64url') }, format: 'jwk' }); return true; } catch { return false; } };
const FUORI_CURVA = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 0xab)]).toString('base64url');
const Y_SPOSTATA = (() => { const b = Buffer.from(P256, 'base64url'); b[64] ^= 1; return b.toString('base64url'); })();
const X_OLTRE_P = Buffer.concat([Buffer.from([4]), Buffer.alloc(32, 0xff), Buffer.from(P256, 'base64url').subarray(33)]).toString('base64url');
const AUTH = Buffer.alloc(16, 0x5c).toString('base64url');
const DEV = '3F2504E0-4F89-41D3-9A0C-0305E82C3301';
const base = () => ({ chi: 'Bene', device_id: DEV, subscription: { endpoint: AMMETTE[2], keys: { p256dh: P256, auth: AUTH } }, temi: ['conti', 'vendite', 'conti'], etichetta: '  iPhone   di Benny  ' });
{
  t('27 chiavi di prova realistiche (p256dh 87 caratteri da B, auth 22)', P256.length === 87 && P256.startsWith('B') && AUTH.length === 22);
  t('28 byteB64url: 65, 16, 32 byte e -1 su base64 non url o lunghezza impossibile',
    byteB64url(P256) === 65 && byteB64url(AUTH) === 16 && byteB64url(Buffer.alloc(32, 1).toString('base64url')) === 32 && byteB64url(P256 + '=') === 65
    && byteB64url('ab+c') === -1 && byteB64url('ab/c') === -1 && byteB64url('abcde') === -1 && byteB64url('') === -1 && byteB64url(5) === -1);
  const v = validaIscrizione(base());
  t('29 iscrizione valida, normalizzata (device_id minuscolo, temi senza doppioni, etichetta compressa)', v.ok && v.val.device_id === DEV.toLowerCase()
    && JSON.stringify(v.val.temi) === '["conti","vendite"]' && v.val.etichetta === 'iPhone di Benny' && v.val.chi === 'Bene' && v.val.endpoint === AMMETTE[2]
    && v.val.p256dh === P256 && v.val.auth === AUTH, v);
  t('30 chi = chiavi di PEOPLE del web (Ale, Bene, Ginevra), non i nomi mostrati', JSON.stringify(CHI_AMMESSI) === '["Ale","Bene","Ginevra"]'
    && ['Benny', 'Ginni', 'ale', 'ALE', '', null, 3].every((c) => validaIscrizione({ ...base(), chi: c }).ok === false));
  t('31 device_id non uuid rifiutato', ['abc', '3F2504E04F8941D39A0C0305E82C3301', '', null, 42, DEV + 'x'].every((d) => validaIscrizione({ ...base(), device_id: d }).ok === false)
    && normDevice(' ' + DEV + ' ') === DEV.toLowerCase());
  const ep = validaIscrizione({ ...base(), subscription: { endpoint: 'https://evil.com/x', keys: { p256dh: P256, auth: AUTH } } });
  t('32 endpoint fuori lista rifiutato all\'iscrizione', ep.ok === false && ep.error === 'endpoint non ammesso', ep);
  const p = (k) => validaSubscription({ endpoint: AMMETTE[0], keys: { p256dh: k, auth: AUTH } });
  t('33 p256dh: 64 o 66 byte, base64 standard, non 0x04, non stringa -> rifiutata; un punto vero (node:crypto) ammesso, col padding ripulito',
    !p(P256.slice(0, 86)).ok && !p(P256 + 'AA').ok && !p(P256.slice(0, 85) + '+/').ok && !p('A' + P256.slice(1)).ok && !p(null).ok
    && sullaCurva(P256_ALTRA) && p(P256_ALTRA).ok && p(P256_ALTRA + '=').ok && p(P256_ALTRA + '=').sub.p256dh === P256_ALTRA);
  const finti = [FUORI_CURVA, Y_SPOSTATA, X_OLTRE_P];
  const veri = Array.from({ length: 20 }, () => createECDH('prime256v1').generateKeys().toString('base64url'));
  t('33b p256dh di 65 byte con 0x04 ma FUORI dalla curva -> rifiutata (0xab ripetuto, y spostata di un bit, x oltre p); 20 punti veri tutti ammessi',
    finti.every((k) => k.length === 87 && k.startsWith('B') && !sullaCurva(k) && !p(k).ok && p(k).error === 'chiave p256dh non valida' && !puntoP256(k))
    && veri.every((k) => sullaCurva(k) && puntoP256(k) && p(k).ok) && !puntoP256(null) && !puntoP256(P256 + '='), finti.map((k) => [sullaCurva(k), p(k).ok]));
  const a = (k) => validaSubscription({ endpoint: AMMETTE[0], keys: { p256dh: P256, auth: k } });
  t('34 auth: 15 o 17 byte rifiutata, 16 ammessa', !a(Buffer.alloc(15, 1).toString('base64url')).ok && !a(Buffer.alloc(17, 1).toString('base64url')).ok && a(AUTH).ok && !a(undefined).ok);
  t('35 subscription assente o senza keys rifiutata', !validaSubscription(undefined).ok && !validaSubscription({ endpoint: AMMETTE[0] }).ok && !validaSubscription('x').ok);
  t('36 temi: assenti = [], non array / maiuscole / un carattere / trattino / numeri / oltre 32 -> rifiutati',
    JSON.stringify(normTemi(undefined)) === '[]' && JSON.stringify(normTemi(null)) === '[]' && normTemi('conti') === null && normTemi(['Conti']) === null
    && normTemi(['c']) === null && normTemi(['x-y']) === null && normTemi([1]) === null && normTemi(Array.from({ length: 33 }, (_, i) => 'tema_' + 'abcdefghijklmnopqrstuvwxyzabcdefg'[i])) === null
    && JSON.stringify(normTemi(['vendite', 'conti', 'vendite'])) === '["vendite","conti"]');
  t('37 temi fuori dagli attivi segnalati', JSON.stringify(temiNonAmmessi(['conti', 'vendite', 'nuovo'], ['conti'])) === '["vendite","nuovo"]' && temiNonAmmessi([], []).length === 0);
  const emo = normEtichetta(EMOJI.repeat(70));
  t('38 etichetta: 60 punti di codice (emoji intere), vuota -> null, controlli -> spazio, non stringa -> null',
    Array.from(emo).length === 60 && !surrogatiSpaiati(emo) && normEtichetta('   ') === null && normEtichetta('a' + String.fromCharCode(0) + 'b') === 'a b'
    && normEtichetta(5) === null && normEtichetta('x'.repeat(80)).length === 60);
  const PRIV = Buffer.alloc(32, 9).toString('base64url');
  t('39 controllaVapid: mancanti, chiavi rotte, subject senza mailto o in http -> motivo; mailto e https -> ok',
    controllaVapid('', PRIV, 'mailto:info@amimi.it') === 'chiavi VAPID mancanti' && controllaVapid(P256, '', 'mailto:info@amimi.it') === 'chiavi VAPID mancanti'
    && controllaVapid(AUTH, PRIV, 'mailto:info@amimi.it') !== '' && controllaVapid(P256, AUTH, 'mailto:info@amimi.it') !== ''
    && controllaVapid(P256, PRIV, 'info@amimi.it') !== '' && controllaVapid(P256, PRIV, 'http://amimi.it') !== ''
    && controllaVapid(P256, PRIV, 'mailto:info@amimi.it') === '' && controllaVapid(P256, PRIV, 'https://amimi.it') === '');
  const S = 'mailto:info@amimi.it';
  t('39b controllaVapid da sola applica la regola di web-push: padding "=" o caratteri non base64url -> motivo; pubblica fuori curva -> motivo',
    controllaVapid(P256 + '=', PRIV, S) === 'chiavi VAPID con padding o caratteri non base64url' && controllaVapid(P256, PRIV + '=', S) !== ''
    && controllaVapid(P256.slice(0, -1) + '+', PRIV, S) !== '' && controllaVapid(P256, PRIV.slice(0, -1) + '/', S) !== '' && controllaVapid(' ' + P256, PRIV, S) !== ''
    && controllaVapid(FUORI_CURVA, PRIV, S) === 'VAPID_PUBLIC_KEY non valida' && controllaVapid(Y_SPOSTATA, PRIV, S) === 'VAPID_PUBLIC_KEY non valida');
  const ora = Date.parse('2026-10-17T10:00:00Z');
  t('40 una prova al minuto: 30 s fa no, 61 s fa si\', mai provata si\', data illeggibile o futura lontana si\'',
    provaTroppoPresto('2026-10-17T09:59:30Z', ora) && !provaTroppoPresto('2026-10-17T09:58:59Z', ora) && !provaTroppoPresto(null, ora)
    && !provaTroppoPresto('ieri', ora) && !provaTroppoPresto('2030-01-01T00:00:00Z', ora) && provaTroppoPresto('2026-10-17T10:00:00.000+00:00', ora));
}

console.log('\n== chiavi VAPID dall\'ambiente ==');
const coppia = () => {
  const k = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
  return { pub: Buffer.concat([Buffer.from([4]), Buffer.from(k.x, 'base64url'), Buffer.from(k.y, 'base64url')]).toString('base64url'), priv: k.d };
};
const VA = coppia(), VB = coppia();
{
  const B64URL = /^[A-Za-z0-9_-]+$/;
  const pad = vapidDa(VA.pub + '=', '  ' + VA.priv + '=\n', '');
  t('39c vapidDa: padding "=" e spazi tolti da entrambe le chiavi PRIMA di web-push, subject vuoto -> mailto:info@amimi.it',
    SUBJECT_DEFAULT === 'mailto:info@amimi.it' && pad.motivo === '' && isDeepStrictEqual(pad.vapid, { publicKey: VA.pub, privateKey: VA.priv, subject: SUBJECT_DEFAULT })
    && B64URL.test(pad.vapid.publicKey) && B64URL.test(pad.vapid.privateKey), pad);
  const https = vapidDa(VA.pub, VA.priv, ' https://amimi.it ');
  t('39d vapidDa: subject dato tenuto; mancanti, tre "=", caratteri non base64url, pubblica fuori curva -> vapid null col motivo',
    https.vapid?.subject === 'https://amimi.it' && vapidDa(undefined, undefined, undefined).motivo === 'chiavi VAPID mancanti' && vapidDa(undefined, null, '').vapid === null
    && vapidDa(VA.pub + '===', VA.priv, '').vapid === null && vapidDa(VA.pub, VA.priv.slice(0, -1) + '+', '').vapid === null
    && vapidDa(FUORI_CURVA, VA.priv, '').motivo === 'VAPID_PUBLIC_KEY non valida' && vapidDa(VA.pub, VA.priv, 'info@amimi.it').motivo === 'VAPID_SUBJECT non valido');
  const vere = (await coppiaVapidCoerente(VA.pub, VA.priv)) && (await coppiaVapidCoerente(VB.pub, VB.priv));
  t('39e coppiaVapidCoerente: le due coppie vere (WebCrypto, firma e verifica ES256) -> si\'', vere);
  const miste = [[VB.pub, VA.priv], [VA.pub, VB.priv], [VA.pub, ''], [VA.pub, 'xx'], ['', VA.priv], [FUORI_CURVA, VA.priv], [VA.pub, Buffer.alloc(32, 0).toString('base64url')],
    [VA.pub, Buffer.alloc(32, 0xff).toString('base64url')], [VA.pub, VA.priv + '='], [AUTH, VA.priv]];
  const passate = [];
  for (const [a, b] of miste) { try { if (await coppiaVapidCoerente(a, b)) passate.push([a.slice(0, 6), b.slice(0, 6)]); } catch (e) { passate.push('lancia: ' + e.message); } }
  t('39f coppiaVapidCoerente: pubblica di B con privata di A (e viceversa), privata zero o oltre n, chiavi rotte -> no, senza lanciare', passate.length === 0, passate);
  // Node rifiuta gia' all'import un JWK con x, y che non vanno con d; un runtime che non li confronta (Deno non e' provato)
  // arriva alla firma: qui si simula con un import che usa solo d, e la coppia mista deve cadere alla verifica
  const veroCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const s = globalThis.crypto.subtle;
  const PKCS8_P256 = Buffer.from('308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420', 'hex');
  const lasco = { importKey: (f, k, ...r) => (f === 'jwk' ? s.importKey('pkcs8', Buffer.concat([PKCS8_P256, Buffer.from(k.d, 'base64url')]), ...r) : s.importKey(f, k, ...r)),
    sign: (...a) => s.sign(...a), verify: (...a) => s.verify(...a) };
  let veraLasco, mistaLasco;
  Object.defineProperty(globalThis, 'crypto', { value: { subtle: lasco }, configurable: true });
  try { veraLasco = await coppiaVapidCoerente(VA.pub, VA.priv); mistaLasco = await coppiaVapidCoerente(VB.pub, VA.priv); }
  finally { Object.defineProperty(globalThis, 'crypto', veroCrypto); }
  t('39h anche con un import che non confronta x e y con d, la coppia mista cade alla verifica della firma e quella vera passa', veraLasco === true && mistaLasco === false, { veraLasco, mistaLasco });
  const ok = await vapidControllato(VA.pub + '=', VA.priv, '');
  const mista = await vapidControllato(VB.pub, VA.priv, '');
  const rotta = await vapidControllato('', '', '');
  t('39g vapidControllato (quello che usa vapidDaEnv): coppia vera col padding -> chiavi ripulite; coppia mista -> "non sono la stessa coppia"; mancanti -> il motivo di vapidDa',
    ok.motivo === '' && ok.vapid?.publicKey === VA.pub && mista.vapid === null && mista.motivo === 'VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY non sono la stessa coppia (o WebCrypto non le accetta: vedi i log)'
    && rotta.vapid === null && rotta.motivo === 'chiavi VAPID mancanti', { ok, mista, rotta });
}

console.log('\n== flag push_enabled ==');
{
  const accesi = ['true', 'TRUE ', ' True\n'];
  const spenti = ['false', null, undefined, '', 'yes', 1, '1', 'on', 'True1', 'tru', 0, false, true, {}, ['true'], { toString: () => 'true' }];
  t('68 flagVero: acceso SOLO con la stringa "true" (maiuscole e spazi tollerati); false, assente, vuoto, yes, 1, on, non stringhe -> spento',
    accesi.every((v) => flagVero(v) === true) && spenti.every((v) => flagVero(v) === false), spenti.filter((v) => flagVero(v) !== false));
}

console.log('\n== giro di invia (spedizione e registrazione finte) ==');
{
  const EP = 'https://web.push.apple.com/QGx2bX8uVn0eY7K5S3dM6gZxR1vY9jK2mP4nQ8wE3tH5';
  const righe = (n, ep = EP) => Array.from({ length: n }, (_, i) => ({ id: 'r' + i, endpoint: ep, p256dh: P256, auth: AUTH, fail_count: 0 }));
  const giro = async (lista, risposte, o = {}) => {
    const spedite = [], registrate = [], ordine = [];
    let ora = 0;
    const g = await giroInvio(lista, {
      spedisci: async (r) => { ordine.push('s:' + r.id); spedite.push(r.id); const x = risposte[spedite.length - 1] ?? [201, '']; ora += o.passo ?? 0; await new Promise((ok) => setTimeout(ok, 1)); return { status: x[0], corpo: x[1], nome: '' }; },
      registra: async (r, esito, res) => { ordine.push('g:' + r.id); registrate.push([r.id, esito, res.status]); return o.cancellaDavvero === false ? false : esito === 'rimuovi'; },
      adesso: () => ora,
      fine: o.fine ?? 1000,
    });
    return { g, spedite, registrate, ordine };
  };
  const a = await giro(righe(4), [[201, ''], [410, ''], [503, ''], [201, '']]);
  t('69 conti: 2 arrivati, 410 rimosso, 503 fallito -> inviati 2, falliti 2, rimossi 1, esiti per classe, ogni riga registrata col suo esito', a.g.ok === true && a.g.inviati === 2
    && a.g.falliti === 2 && a.g.rimossi === 1 && a.g.fermato === '' && isDeepStrictEqual(a.g.esiti, { ok: 2, rimuovi: 1, transitorio: 1 }) && a.spedite.length === 4
    && isDeepStrictEqual(a.registrate, [['r0', 'ok', 201], ['r1', 'rimuovi', 410], ['r2', 'transitorio', 503], ['r3', 'ok', 201]]), a.g);
  const b = await giro(righe(4), [[201, ''], [429, 'slow down'], [201, ''], [201, '']]);
  t('70 un 429 ferma il giro: nessuna spedizione dopo, i telefoni rimasti contano come falliti, fermato = limite', b.spedite.length === 2 && b.g.inviati === 1
    && b.g.falliti === 3 && b.g.fermato === 'limite' && isDeepStrictEqual(b.g.esiti, { ok: 1, limite: 1 }) && b.registrate.length === 2 && b.g.ok === true, b.g);
  const c = await giro(righe(4), [], { passo: 600, fine: 1000 });
  const c0 = await giro(righe(3), [], { fine: -1 });
  t('71 tetto di tempo: oltre `fine` nessuna nuova spedizione, i rimasti falliti, fermato = tempo; gia\' scaduto -> zero spedizioni, ok false',
    c.spedite.length === 2 && c.g.inviati === 2 && c.g.falliti === 2 && c.g.fermato === 'tempo' && c0.spedite.length === 0 && c0.g.falliti === 3 && c0.g.ok === false && c0.g.fermato === 'tempo', { c: c.g, c0: c0.g });
  const lista = righe(3); lista[1] = { ...lista[1], endpoint: 'https://evil.com/x' };
  const d = await giro(lista, [[201, ''], [201, '']]);
  t('72 host non ammesso: non parte e la riga non si tocca, conta come fallito in esiti.host_non_ammesso; gli altri partono', d.spedite.join() === 'r0,r2'
    && d.registrate.map((x) => x[0]).join() === 'r0,r2' && d.g.inviati === 2 && d.g.falliti === 1 && d.g.esiti.host_non_ammesso === 1, d.g);
  const e = await giro(righe(3), [[503, ''], [500, ''], [null, 'Socket timeout']]);
  const vuoto = await giro([], []);
  const uno = await giro(righe(3), [[503, ''], [201, ''], [413, '']]);
  t('73 ok solo con almeno un arrivo: tutti falliti -> ok false, elenco vuoto -> ok false e tutto a zero, un arrivo su tre -> ok true',
    e.g.ok === false && e.g.inviati === 0 && e.g.falliti === 3 && vuoto.g.ok === false && vuoto.g.inviati + vuoto.g.falliti + vuoto.g.rimossi === 0 && uno.g.ok === true && uno.g.inviati === 1, { e: e.g, vuoto: vuoto.g });
  const f = await giro(righe(2), [[410, ''], [404, '']], { cancellaDavvero: false });
  t('74 rimossi conta le righe cancellate DAVVERO (registra), non gli esiti: un 410 su una riga gia\' rinnovata non conta', f.g.rimossi === 0 && f.g.esiti.rimuovi === 2, f.g);
  t('75 in sequenza: ogni riga spedita e registrata prima della successiva', a.ordine.join() === 's:r0,g:r0,s:r1,g:r1,s:r2,g:r2,s:r3,g:r3', a.ordine);
}

console.log('\n== elenco dispositivi ==');
{
  const MIO = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const righe = [
    { id: 'a', chi: 'Ale', etichetta: 'iPhone', temi: ['conti'], created_at: 'c1', last_ok_at: null, last_status: 201, device_id: MIO.toUpperCase(), endpoint: 'https://web.push.apple.com/x', p256dh: P256, auth: AUTH, user_email: 'info@amimi.it' },
    { id: 'b', chi: 'Bene', etichetta: null, temi: [], created_at: 'c2', last_ok_at: 'o2', last_status: null, device_id: '11111111-2222-4333-8444-555555555555' },
  ];
  const v = vistaDispositivi(righe, MIO);
  const CONTRATTO = 'id,chi,etichetta,temi,created_at,last_ok_at,last_status,questo';
  t('76 dispositivi: solo i campi del contratto + questo; device_id, endpoint, chiavi ed email non escono; questo solo sulla riga del telefono che chiede',
    v.length === 2 && v.every((r) => Object.keys(r).join() === CONTRATTO) && v[0].questo === true && v[1].questo === false && v[0].chi === 'Ale' && v[1].last_ok_at === 'o2'
    && !/device_id|endpoint|p256dh|auth|user_email|amimi\.it|3f2504e0|11111111/i.test(JSON.stringify(v)), v);
  t('76b dispositivi: device_id assente o non valido -> nessuna riga e\' questo; elenco non array -> vuoto', vistaDispositivi(righe, null).every((r) => r.questo === false)
    && vistaDispositivi(righe, normDevice('abc')).every((r) => r.questo === false) && vistaDispositivi(righe, normDevice(' ' + MIO.toUpperCase() + ' '))[0].questo === true
    && vistaDispositivi(null, MIO).length === 0 && vistaDispositivi([null, 3], MIO).every((r) => r.questo === false));
}

console.log('\n== Topic ==');
{
  const vari = ['conti', 'vendite ferme!', 'x'.repeat(40), 'a.b/c+d=e', 'tema_con-trattino'];
  t('41 Topic: tema ridotto a [A-Za-z0-9_-], al massimo 32', topicDi('conti') === 'conti' && topicDi('vendite ferme!') === 'venditeferme' && topicDi('x'.repeat(40)).length === 32
    && vari.every((v) => /^[A-Za-z0-9_-]{1,32}$/.test(topicDi(v))));
  t('42 Topic vuoto -> nessun header (undefined)', topicDi('') === undefined && topicDi(null) === undefined && topicDi('àè') === undefined && topicDi('!!!') === undefined);
}

console.log('\n== confronto a tempo costante ==');
{
  const K = 'sb_' + 'secret_' + 'Q'.repeat(30);
  t('43 uguali si\', diversi / prefisso / piu\' lunghi / vuoti no', ugualeCostante(K, K) && !ugualeCostante(K, K.slice(0, -1) + 'R') && !ugualeCostante(K, K.slice(0, -1))
    && !ugualeCostante(K + 'x', K) && !ugualeCostante('', '') && !ugualeCostante('x', '') && !ugualeCostante('', 'x') && !ugualeCostante('è', 'e') && ugualeCostante('è', 'è'));
  const corpo = cut(SRC, 'push-confronto');
  const ciclo = corpo.split('\n').find((l) => l.includes('for (')) ?? '';
  t('44 nessun ritorno dentro il ciclo, un solo return in fondo', ciclo && !ciclo.includes('return') && (corpo.match(/return /g) ?? []).length === 1, ciclo);
}

console.log('\n== guardie sul sorgente ==');
const codice = (s) => s.replace(/^\s*\/\/[^\n]*$/gm, '');
const fuoriPure = (s) => { let r = s; for (const b of BLOCCHI) { const x = cut(r, b); if (x !== null) r = r.replace(x, ''); } return r; };
const flat = (s) => s.replace(/\)\s*\n\s*\./g, ').');
const righeSb = (s) => flat(codice(s)).split('\n').filter((l) => l.includes('sb.from('));
const SCRITTURA = /\.(insert|update|upsert|delete)\(/;
const RETRY_SU_SCRITTURA = /retryOnce\(\(\) => sb\.from\('[^']+'\)\.(insert|update|upsert|delete)\(/;
const GATE = "if (!EMAIL_TEAM.test(email)) return json({ error: 'dominio non ammesso' }, 403);";
const AZIONI_UTENTE = ['config', 'iscrivi', 'rinnova', 'temi', 'disiscrivi', 'dispositivi', 'rimuovi', 'prova'];

const cancelloPrima = (s) => {
  const u = s.indexOf('.auth.getUser(token)'), g = s.indexOf(GATE);
  return u > 0 && g > u && AZIONI_UTENTE.every((a) => { const i = s.indexOf(`if (action === '${a}')`); return i > g; });
};
const servizioSoloInvia = (s) => {
  const a = s.indexOf('if (ugualeCostante(token, svc)) {');
  if (a < 0) return false;
  const blocco = s.slice(a, s.indexOf('\n  }\n', a));
  const no = blocco.indexOf("if (action !== 'invia') return json({ error: "), call = blocco.indexOf('return await inviaTema(sb, body);');
  const chiamate = (codice(s).match(/inviaTema\(/g) ?? []).length;
  const g = s.indexOf(GATE), rif = s.indexOf("if (action === 'invia') return json({ error: ");
  return no >= 0 && /403\);/.test(blocco.slice(no, call)) && call > no && chiamate === 2 && (s.match(/ugualeCostante\(token, svc\)/g) ?? []).length === 1
    && rif > g && /, 403\);/.test(s.slice(rif, s.indexOf('\n', rif)));
};
const nessunPin = (s) => !/\bpin\b|pin_hash|PIN_HASH/i.test(codice(s));
const tetto51 = (s) => { const r = righeSb(s).find((l) => l.includes(".contains('temi', [tema])")); return !!r && r.includes('retryOnce(() => sb.from(') && r.includes('.limit(51)') && /if \(lista\.length > 50\)/.test(s); };
const lettureSenzaError = (s) => righeSb(s).filter((l) => !/const \{[^}]*\berror\b[^}]*\} = await (?:retryOnce\(\(\) => )?sb\.from\(/.test(l));
const lettureNonRitentate = (s) => righeSb(s).filter((l) => l.includes('.select(') && !SCRITTURA.test(l) && !l.includes('retryOnce(() => sb.from('));
const scrittureRitentate = (s) => righeSb(s).filter((l) => RETRY_SU_SCRITTURA.test(l));
const risposteConSegreti = (s) => codice(s).split('\n').filter((l) => l.includes('json({') && /p256dh|\bendpoint:|\bauth:|\.endpoint\b|\.auth\b/.test(l.slice(l.indexOf('json({'))));
const versionePinnata = (s) => { const c = codice(s); return (c.match(/npm:web-push/g) ?? []).length === 1 && c.includes("import webpush from 'npm:web-push@3.6.7';") && !/jsr:@negrel/.test(c); };
// corpo di una funzione di primo livello (fino alla prima graffa chiusa a inizio riga) e di un ramo `if (action === ...)`
const corpoFunzione = (s, firma) => { const i = s.indexOf(firma); if (i < 0) return ''; const j = s.indexOf('\n}\n', i); return j < 0 ? '' : s.slice(i, j + 2); };
const ramo = (s, a) => { const i = s.indexOf(`if (action === '${a}') {`); if (i < 0) return ''; const j = s.indexOf('\n  }\n', i); return j < 0 ? '' : s.slice(i, j + 4); };
const flagSoloDaFlagVero = (s) => {
  const f = codice(corpoFunzione(s, 'async function flagAcceso('));
  return f.includes('return flagVero(riga?.value);') && (f.match(/\breturn\b/g) ?? []).length === 1;
};
const registraDaAzione = (s) => {
  const f = codice(corpoFunzione(s, 'async function registraEsito('));
  const se = f.indexOf('if (a.cancella) {'), fineSe = f.indexOf('\n  }\n', se);
  const del = f.indexOf("const { data, error } = await sb.from('push_subscriptions').delete().eq('id', r.id).eq('endpoint', r.endpoint).select('id');");
  const upd = f.indexOf("const { error } = await sb.from('push_subscriptions').update(a.patch).eq('id', r.id).eq('endpoint', r.endpoint);");
  return f.includes('const a = azioneEsito(esito, status, r.fail_count, new Date().toISOString());') && se > 0 && del > se && del < fineSe
    && f.slice(se, fineSe).includes('return !error && (data ?? []).length > 0;') && upd > fineSe
    && (f.match(/\.delete\(/g) ?? []).length === 1 && (f.match(/\.update\(/g) ?? []).length === 1 && !/\besito\b\s*[!=]==/.test(f);
};
const giroDiInvia = (s) => {
  const f = codice(corpoFunzione(s, 'async function inviaTema('));
  const lettura = f.indexOf(".contains('temi', [tema])");
  const stop = f.indexOf('if (lista.length > 50) return json({ ok: false, error: `oltre 50 telefoni iscritti al tema ${tema}: invio fermato`, inviati: 0 }, 503);');
  const dry = f.indexOf('if (body.dryRun === true) return json({ ok: destinatari >= 1, dryRun: true, inviati: 0, falliti: 0, rimossi: 0, destinatari });');
  const g = f.indexOf('const g = await giroInvio(lista, {');
  return lettura > 0 && stop > lettura && dry > stop && g > dry && (f.match(/giroInvio\(/g) ?? []).length === 1 && (f.match(/spedisci\(/g) ?? []).length === 1
    && f.includes('spedisci: (r) => spedisci(r, payload, opz, vapid),') && f.includes('registra: (r, esito, res) => chiudiInvio(sb, r, esito, res),')
    && f.includes('adesso: Date.now,') && f.includes('fine: Date.now() + GIRO_MAX_MS,')
    && f.includes('return json({ ok: g.ok, inviati: g.inviati, falliti: g.falliti, rimossi: g.rimossi, destinatari, esiti: g.esiti, ...(g.fermato ? { fermato: g.fermato } : {}) });');
};
const temaSpentoFermato = (s) => {
  const f = codice(corpoFunzione(s, 'async function inviaTema('));
  const sp = f.indexOf("if (!(await temiAttivi(sb, [tema])).includes(tema)) return json({ ok: false, skipped: 'tema_spento', inviati: 0 });");
  return sp > f.indexOf('if (!TEMA_RE.test(tema))') && sp < f.indexOf('await vapidDaEnv()') && sp < f.indexOf(".from('push_subscriptions')")
    && corpoFunzione(s, 'async function temiAttivi(').includes(".from('push_temi').select('key').in('key', temi).eq('attivo', true)");
};
const tetto30 = (s) => {
  const b = codice(ramo(s, 'iscrivi'));
  const se = b.indexOf('if (count >= MAX_ISCRIZIONI) {'), fineSe = b.indexOf('\n    }\n', se);
  const no = b.indexOf("if (!perDevice && !perEndpoint) return json({ error: `ci sono gia' ${MAX_ISCRIZIONI} telefoni iscritti: rimuovine uno dall'elenco` }, 422);");
  return se > 0 && no > se && no < fineSe && fineSe < b.indexOf('.delete()');
};
const temiControllati = (s) => {
  const b = codice(ramo(s, 'temi'));
  const c = b.indexOf('const fuori = temiNonAmmessi(temi, await temiAttivi(sb, temi));');
  const no = b.indexOf("if (fuori.length) return json({ error: 'temi non disponibili: ' + fuori.join(', ') }, 422);");
  return c > 0 && no > c && b.indexOf('.update({ temi, updated_at: ora })') > no;
};
const cancellazioniFiltrate = (s) => {
  const r = codice(ramo(s, 'rimuovi')), d = codice(ramo(s, 'disiscrivi'));
  return r.includes("const { data, error } = await sb.from('push_subscriptions').delete().eq('id', id).select('id');") && !r.includes('.neq(') && (r.match(/\.delete\(/g) ?? []).length === 1
    && d.includes("const { data, error } = await sb.from('push_subscriptions').delete().eq('device_id', deviceId).select('id');") && !d.includes('.neq(') && (d.match(/\.delete\(/g) ?? []).length === 1;
};
const configSoloAttivi = (s) => codice(ramo(s, 'config')).includes(".from('push_temi').select('key, etichetta, descrizione').eq('attivo', true).order('ordine', { ascending: true })");
const dispositiviDallaVista = (s) => codice(ramo(s, 'dispositivi')).includes('return json({ dispositivi: vistaDispositivi(data, normDevice(body.device_id)) });')
  && (codice(ramo(s, 'dispositivi')).match(/json\(/g) ?? []).length === 1;
const logDiOgniInvio = (s) => {
  const f = codice(corpoFunzione(s, 'async function chiudiInvio('));
  const fuori = codice(fuoriPure(s));
  return f.includes("if (esito !== 'ok') console.error('push-api: invio non riuscito', JSON.stringify({ id: r.id, esito, motivo: riassuntoErrore(res.nome, res.status, res.corpo) }));")
    && f.includes('return await registraEsito(sb, r, esito, res.status);') && (fuori.match(/registraEsito\(/g) ?? []).length === 2 && (fuori.match(/chiudiInvio\(/g) ?? []).length === 3
    && codice(ramo(s, 'prova')).includes('await chiudiInvio(sb, riga as Riga, esito, res);') && codice(corpoFunzione(s, 'async function inviaTema(')).includes('chiudiInvio(sb, r, esito, res)');
};
const consoleConSegreti = (s) => codice(s).split('\n').filter((l) => /console\.\w+\(/.test(l)
  && (/\.endpoint\b|p256dh|\.auth\b|\bkeys\b|\bsub\b/.test(l) || /[(,]\s*(r|riga|righe|lista|body|res|e|err)\s*[,)]/.test(l) || (/\.corpo\b/.test(l) && !/riassuntoErrore\(/.test(l))));
const vapidVerificato = (s) => {
  const f = codice(corpoFunzione(s, 'function vapidDaEnv('));
  const c = codice(s);
  return f.includes("const pub = Deno.env.get('VAPID_PUBLIC_KEY') ?? '', priv = Deno.env.get('VAPID_PRIVATE_KEY') ?? '', subject = Deno.env.get('VAPID_SUBJECT') ?? '';")
    && f.includes("vapidVisto = { segreti, esito: vapidControllato(pub, priv, subject, (nome) => console.error('push-api: verifica della coppia VAPID non eseguita', nome)) };") && (c.match(/Deno\.env\.get\('VAPID_/g) ?? []).length === 3
    && (c.match(/await vapidDaEnv\(\)/g) ?? []).length === 3 && (c.match(/vapidDaEnv\(\)/g) ?? []).length === 4
    && codice(corpoFunzione(s, 'async function vapidControllato(')).includes('if (!(await coppiaVapidCoerente(r.vapid.publicKey, r.vapid.privateKey, segnala))) return { vapid: null, motivo:');
};
const payloadSoloDalCostruttore = (s) => {
  const f = codice(fuoriPure(s));
  const chiamate = [...f.matchAll(/(?<!function )spedisci\(([^,]+), ([^,]+),/g)];
  const assegnazioni = [...f.matchAll(/const payload = ([A-Za-z]+)\(/g)].map((m) => m[1]);
  return !/web_push|8030/.test(f) && (f.match(/webpush\.sendNotification\(/g) ?? []).length === 1 && chiamate.length === 2 && chiamate.every((m) => m[2] === 'payload')
    && assegnazioni.length === 2 && assegnazioni.every((x) => x === 'costruisciPayload');
};

t('45 getUser e cancello del team PRIMA di ogni azione utente', cancelloPrima(SRC));
t('46 chiave di servizio: SOLO invia (403 sul resto), invia col JWT = 403, inviaTema chiamata una volta', servizioSoloInvia(SRC));
t('47 nessun PIN accettato (ne\' body.pin ne\' pin_hash)', nessunPin(SRC));
t('48 fan-out di invia: .contains(temi) ritentata, .limit(51) e stop oltre 50', tetto51(SRC));
const se = lettureSenzaError(SRC);
t('49 ogni chiamata sb.from destruttura error (letture e scritture)', se.length === 0 && righeSb(SRC).length >= 15, se[0] ?? righeSb(SRC).length);
const nr = lettureNonRitentate(SRC);
t('50 ogni lettura passa da retryOnce', nr.length === 0, nr[0]);
const sr = scrittureRitentate(SRC);
t('51 nessun retryOnce attorno a insert/update/upsert/delete', sr.length === 0, sr[0]);
t('52 npm:web-push@3.6.7 pinnata, un solo import, nessun ripiego attivo', versionePinnata(SRC));
t('53 payload solo da costruisciPayload, una sola chiamata a sendNotification', payloadSoloDalCostruttore(SRC));
{
  const impuri = BLOCCHI.filter((b) => /Deno\.|\bimport\b|webpush|\bsb\.|fetch\(|createClient|console\./.test(codice(cut(SRC, b))));
  t('54 blocchi PURE senza Deno, import, web-push, client o rete', impuri.length === 0, impuri);
  const i = SRC.indexOf("if (action === 'dispositivi')");
  const sel = (SRC.slice(i).match(/\.select\('([^']+)'\)/) ?? [])[1] ?? '';
  t('55 dispositivi: MAI endpoint, p256dh o auth nella select (device_id solo per `questo`), risposta SOLO da vistaDispositivi col device_id del telefono',
    sel === 'id, chi, etichetta, temi, created_at, last_ok_at, last_status, device_id' && dispositiviDallaVista(SRC), sel);
  const risposte = risposteConSegreti(SRC);
  t('56 nessuna risposta json porta endpoint o chiavi', risposte.length === 0, risposte[0]);
  t('57 flag letto con .in(push_enabled), error destrutturato, retryOnce, 503; flagAcceso decide SOLO con flagVero', SRC.includes("const { data, error } = await retryOnce(() => sb.from('app_flags').select('key, value').in('key', ['push_enabled']));")
    && SRC.includes("if (error) throw new ReadError('flag non leggibile, riprova');") && /if \(e instanceof ReadError\) return json\(\{ error: e\.message \}, 503\);/.test(SRC)
    && flagSoloDaFlagVero(SRC));
  const fu = SRC.indexOf("if (!(await flagAcceso(sb))) return json({ enabled: false });");
  t('58 a flag spento: {enabled:false} prima di ogni azione utente; invia -> skipped:disabled come prima cosa', fu > SRC.indexOf(GATE) && fu < SRC.indexOf("if (action === 'config')")
    && /async function inviaTema\([^)]*\): Promise<Response> \{\n {2}if \(!\(await flagAcceso\(sb\)\)\) return json\(\{ ok: false, skipped: 'disabled', inviati: 0 \}\);/.test(SRC));
  const pv = SRC.slice(SRC.indexOf("if (action === 'prova')"));
  const tt = pv.indexOf('.update({ last_test_at: ora })'), tk = pv.indexOf('if (tErr) return json('), sp = pv.indexOf('spedisci(');
  t('59 prova: 429 "aspetta un minuto", last_test_at scritto PRIMA dell\'invio e invio fermo se la scrittura fallisce', tt > 0 && tk > tt && sp > tk
    && pv.includes("if (provaTroppoPresto(riga.last_test_at, Date.now())) return json({ error: 'aspetta un minuto' }, 429);") && pv.indexOf('aspetta un minuto') < tt);
  t('60 opzioni di invio: aes128gcm, TTL 86400 (prova 300), Urgency high solo se urgente, Topic dal tema', SRC.includes("contentEncoding: 'aes128gcm'")
    && SRC.includes('const TTL_INVIO = 86400;') && SRC.includes('const TTL_PROVA = 300;') && SRC.includes("urgency: body.urgente === true ? 'high' : 'normal', topic: topicDi(tema)")
    && SRC.includes('TTL: o.ttl, urgency: o.urgency, topic: o.topic,'));
  const isc = SRC.slice(SRC.indexOf("if (action === 'iscrivi')"), SRC.indexOf("if (action === 'rinnova')"));
  t('61 iscrivi: tetto 30 con count head:true, via la riga vecchia dello stesso telefono, poi upsert sull\'endpoint', SRC.includes('const MAX_ISCRIZIONI = 30;')
    && isc.includes(".select('id', { count: 'exact', head: true })") && isc.includes('if (cErr || count == null) throw new ReadError(') && isc.includes('if (count >= MAX_ISCRIZIONI)')
    && isc.indexOf(".delete().eq('device_id', it.device_id).neq('endpoint', it.endpoint)") > 0
    && isc.indexOf(".delete().eq('device_id', it.device_id).neq('endpoint', it.endpoint)") < isc.indexOf("{ onConflict: 'endpoint' }")
    && isc.indexOf('temiNonAmmessi(it.temi, await temiAttivi(sb, it.temi))') < isc.indexOf('.delete()'));
  t('62 temi validati sui soli temi richiesti (.in), mai tutta push_temi', SRC.includes(".from('push_temi').select('key').in('key', temi).eq('attivo', true)"));
  t('63 VAPID mancanti: config -> enabled:false + reason, invia e prova -> 503', SRC.includes('if (!vapid) return json({ enabled: false, reason: motivo });')
    && (SRC.match(/if \(!vapid\) return json\(\{ error: motivo \}, 503\);/g) ?? []).length === 2);
  t('64 endpoint ricontrollato anche all\'invio (invia e prova)', SRC.includes('if (!endpointAmmesso(r.endpoint))') && SRC.includes('if (!endpointAmmesso(riga.endpoint))'));
  t('65 un 429 del servizio ferma il giro', SRC.includes("if (esito === 'limite') fermato = 'limite';"));
  t('66 config.toml: verify_jwt = false per push-api', /\n\[functions\.push-api\]\nverify_jwt = false\n/.test(CONFIG));
  t('67 rinnova e temi non creano righe: UPDATE filtrato sul device, trovato dal numero di righe toccate',
    /if \(action === 'rinnova'\)[\s\S]*?\.update\(\{ endpoint: s\.sub\.endpoint, p256dh: s\.sub\.p256dh, auth: s\.sub\.auth, last_seen_at: ora, updated_at: ora \}\)\.eq\('device_id', deviceId\)\.select\('id'\);[\s\S]*?trovato: \(data \?\? \[\]\)\.length > 0/.test(SRC)
    && !/if \(action === 'rinnova'\)[\s\S]*?\.upsert\([\s\S]*?if \(action === 'temi'\)/.test(SRC));
  t('77 registraEsito esegue azioneEsito: una sola delete dietro `if (a.cancella)`, una sola update con a.patch, entrambe su id E endpoint, nessuna scelta a mano sull\'esito',
    registraDaAzione(SRC));
  t('78 invia: oltre 50 -> 503 e dryRun -> risposta, entrambi PRIMA del giro; un solo giroInvio con la spedizione e chiudiInvio veri; risposta dai conti del giro', giroDiInvia(SRC));
  t('79 invia: tema spento o inesistente (temiAttivi, .eq(attivo, true)) -> skipped tema_spento, prima delle chiavi e delle iscrizioni', temaSpentoFermato(SRC));
  t('80 iscrivi: a 30 righe un telefono nuovo -> 422 (dentro `if (count >= MAX_ISCRIZIONI)`, prima di ogni scrittura)', tetto30(SRC));
  t('81 azione temi: temiAttivi e 422 sui temi spenti PRIMA dell\'update', temiControllati(SRC));
  t('82 rimuovi cancella con .eq(id), disiscrivi con .eq(device_id): una delete ciascuno, mai .neq', cancellazioniFiltrate(SRC));
  t('83 config: solo temi attivi (.eq(attivo, true)), per ordine', configSoloAttivi(SRC));
  t('84 ogni invio (invia e prova) passa da chiudiInvio: log col riassunto ripulito se non ok, poi registraEsito (che nessun altro chiama)', logDiOgniInvio(SRC));
  const cs = consoleConSegreti(SRC);
  t('85 nessun console.* riceve endpoint, p256dh, auth, la riga intera o il corpo grezzo dell\'errore', cs.length === 0 && (codice(SRC).match(/console\.\w+\(/g) ?? []).length >= 4, cs[0]);
  t('86 vapidDaEnv passa i segreti grezzi a vapidControllato (padding tolto e coppia verificata), e config, invia e prova lo attendono', vapidVerificato(SRC));
}

console.log('\n== autocontrollo dei rilevatori ==');
{
  const pianta = (da, a) => { const s = SRC.replace(da, a); if (s === SRC) { console.log('  KO  autocontrollo: frammento da sostituire non trovato: ' + da.slice(0, 80)); ko++; } return s; };
  const g1 = pianta(GATE + '\n', '').replace("if (action === 'config') {", "if (action === 'config') {\n    " + GATE);
  t('A1 cancello spostato dopo una azione -> visto', !cancelloPrima(g1));
  t('A2 invia raggiungibile col JWT -> visto', !servizioSoloInvia(pianta("if (action === 'invia') return json({ error: 'invia si chiama solo con la chiave di servizio' }, 403);", "if (action === 'invia') return await inviaTema(sb, body);")));
  t('A3 ramo servizio che lascia passare altre azioni -> visto', !servizioSoloInvia(pianta("if (action !== 'invia') return json({ error: 'chiave di servizio ammessa solo per invia' }, 403);", '')));
  t('A4 PIN accettato -> visto', !nessunPin(pianta('const sb = createClient(url, svc);', "const sb = createClient(url, svc);\n  if (body.pin === 'x') return await inviaTema(sb, body);")));
  t('A5 fan-out senza tetto -> visto', !tetto51(pianta('.limit(51)', '.limit(1000)')));
  t('A6 lettura che non destruttura error -> vista', lettureSenzaError(pianta("const { data, error } = await retryOnce(() => sb.from('push_temi').select('key')", "const { data } = await retryOnce(() => sb.from('push_temi').select('key')")).length === 1);
  t('A7 lettura senza ritentativo -> vista', lettureNonRitentate(pianta("await retryOnce(() => sb.from('push_temi').select('key').in('key', temi).eq('attivo', true));", "await sb.from('push_temi').select('key').in('key', temi).eq('attivo', true);")).length === 1);
  t('A8 scrittura ritentata, anche su due righe -> vista', scrittureRitentate(pianta("await sb.from('push_subscriptions').delete().eq('id', r.id).eq('endpoint', r.endpoint).select('id');", "await retryOnce(() => sb.from('push_subscriptions')\n      .delete().eq('id', r.id).eq('endpoint', r.endpoint).select('id'));")).length === 1);
  t('A9 versione di web-push non pinnata -> vista', !versionePinnata(pianta("import webpush from 'npm:web-push@3.6.7';", "import webpush from 'npm:web-push';")));
  t('A10 payload scritto a mano fuori dal costruttore -> visto', !payloadSoloDalCostruttore(pianta("const payload = costruisciPayload({ titolo: 'Prova notifiche'", "const payload = JSON.stringify({ web_push: 8030, titolo: 'Prova notifiche'")));
  t('A13 risposta che espone l\'endpoint -> vista', risposteConSegreti(pianta("return json({ ok: true, id: up.id });", "return json({ ok: true, id: up.id, endpoint: it.endpoint });")).length === 1);
  // le mutazioni sopravvissute alla Gate 2 (17-10), riscritte sul sorgente nuovo: ognuna deve far cadere la sua guardia
  const FLAG = 'return flagVero(riga?.value);';
  t('A14 flagAcceso che apre da solo (return true, !== false, default true) -> visto', [pianta(FLAG, 'return true;'), pianta(FLAG, "return riga?.value !== 'false';"),
    pianta(FLAG, "return flagVero(riga?.value ?? 'true');"), pianta(FLAG, "if (!riga) return true;\n  " + FLAG)].every((s) => !flagSoloDaFlagVero(s)));
  const DEL_ESITO = "const { data, error } = await sb.from('push_subscriptions').delete().eq('id', r.id).eq('endpoint', r.endpoint).select('id');";
  const UPD_ESITO = "const { error } = await sb.from('push_subscriptions').update(a.patch).eq('id', r.id).eq('endpoint', r.endpoint);";
  t('A15 registraEsito che cancella fuori da azioneEsito (esito !== ok, config), senza filtro endpoint o con un patch a mano -> visto', [
    pianta('if (a.cancella) {', "if (a.cancella || esito === 'config') {"),
    pianta("const a = azioneEsito(esito, status, r.fail_count, new Date().toISOString());", "const a = azioneEsito(esito, status, r.fail_count, new Date().toISOString());\n  if (esito !== 'ok') { await sb.from('push_subscriptions').delete().eq('id', r.id); return true; }"),
    pianta(DEL_ESITO, DEL_ESITO.replace(".eq('endpoint', r.endpoint)", '')), pianta(UPD_ESITO, UPD_ESITO.replace(".eq('endpoint', r.endpoint)", '')),
    pianta(UPD_ESITO, UPD_ESITO.replace('update(a.patch)', 'update({ ...a.patch, fail_count: 0 })')),
  ].every((s) => !registraDaAzione(s)));
  const STOP50 = 'if (lista.length > 50) return json({ ok: false, error: `oltre 50 telefoni iscritti al tema ${tema}: invio fermato`, inviati: 0 }, 503);';
  t('A16 giro di invia: stop oltre 50 che solo logga, dryRun che spedisce, ok sempre vero, spedizione fuori dal giro -> visto', [
    pianta(STOP50, "if (lista.length > 50) console.log('oltre 50');"), pianta('if (body.dryRun === true) return json(', "if (body.dryRun === 'mai') return json("),
    pianta('return json({ ok: g.ok,', 'return json({ ok: true,'), pianta('const g = await giroInvio(lista, {', "await spedisci(lista[0], payload, opz, vapid);\n  const g = await giroInvio(lista, {"),
    pianta('registra: (r, esito, res) => chiudiInvio(sb, r, esito, res),', 'registra: async () => false,'),
  ].every((s) => !giroDiInvia(s)));
  const SPENTO = "if (!(await temiAttivi(sb, [tema])).includes(tema)) return json({ ok: false, skipped: 'tema_spento', inviati: 0 });";
  t('A17 invia senza il controllo del tema spento, o con temiAttivi che non guarda attivo -> visto', [pianta(SPENTO, ''),
    pianta(".from('push_temi').select('key').in('key', temi).eq('attivo', true)", ".from('push_temi').select('key').in('key', temi)")].every((s) => !temaSpentoFermato(s)));
  t('A18 tetto di 30 ignorato -> visto', !tetto30(pianta('if (!perDevice && !perEndpoint) return json(', 'if (false) return json(')));
  t('A19 azione temi senza il controllo dei temi attivi -> visto', !temiControllati(pianta("const fuori = temiNonAmmessi(temi, await temiAttivi(sb, temi));\n    if (fuori.length) return json({ error: 'temi non disponibili: ' + fuori.join(', ') }, 422);\n", '')));
  t('A20 rimuovi con .neq(id) o disiscrivi con .neq(device_id) -> visto', [
    pianta(".delete().eq('id', id).select('id');", ".delete().neq('id', id).select('id');"),
    pianta(".delete().eq('device_id', deviceId).select('id');", ".delete().neq('device_id', deviceId).select('id');"),
  ].every((s) => !cancellazioniFiltrate(s)));
  t('A21 config che restituisce anche i temi spenti -> visto', !configSoloAttivi(pianta(".select('key, etichetta, descrizione').eq('attivo', true).order(", ".select('key, etichetta, descrizione').order(")));
  t('A22 dispositivi che restituisce le righe grezze (device_id compreso) -> visto', !dispositiviDallaVista(pianta('return json({ dispositivi: vistaDispositivi(data, normDevice(body.device_id)) });', 'return json({ dispositivi: data ?? [] });')));
  t('A23 prova che salta il log, o log senza riassunto -> visto', [pianta('await chiudiInvio(sb, riga as Riga, esito, res);', 'await registraEsito(sb, riga as Riga, esito, res.status);'),
    pianta('motivo: riassuntoErrore(res.nome, res.status, res.corpo)', 'motivo: res.corpo')].every((s) => !logDiOgniInvio(s)));
  const LOG = "console.error('push-api: invio non riuscito', JSON.stringify({ id: r.id, esito, motivo: riassuntoErrore(res.nome, res.status, res.corpo) }));";
  t('A24 log con endpoint, chiavi, riga intera o corpo grezzo -> visto', [`console.error('x', r.endpoint);`, `console.error('x', riga);`, `console.log('x', res.corpo);`,
    `console.error('x', JSON.stringify({ p256dh: r.p256dh }));`, `console.warn(r);`].every((l) => consoleConSegreti(pianta(LOG, LOG + '\n  ' + l)).length === 1));
  t('A25 vapidDaEnv che salta la verifica della coppia, o un chiamante che non la attende -> visto', [
    pianta("vapidVisto = { segreti, esito: vapidControllato(pub, priv, subject, (nome) => console.error('push-api: verifica della coppia VAPID non eseguita', nome)) };", 'vapidVisto = { segreti, esito: Promise.resolve(vapidDa(pub, priv, subject)) };'),
    pianta("if (action === 'config') {\n    const { vapid, motivo } = await vapidDaEnv();", "if (action === 'config') {\n    const { vapid, motivo } = vapidDa(Deno.env.get('VAPID_PUBLIC_KEY'), Deno.env.get('VAPID_PRIVATE_KEY'), '');"),
    pianta('if (!(await coppiaVapidCoerente(r.vapid.publicKey, r.vapid.privateKey, segnala))) return { vapid: null, motivo:', 'if (false) return { vapid: null, motivo:'),
  ].every((s) => !vapidVerificato(s)));
  const ingenuo = (s) => typeof s === 'string' && /fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com/.test(s);
  t('A11 i casi di rifiuto battono un controllo ingenuo "contiene il dominio"', RIFIUTA.filter(ingenuo).length >= 10, RIFIUTA.filter(ingenuo).length);
  const esitoIngenuo = (s) => (s >= 200 && s < 300 ? 'ok' : s >= 400 && s < 500 ? 'rimuovi' : 'transitorio');
  t('A12 i casi di esito battono "ogni 4xx cancella"', [[403, 'Forbidden', 'config'], [401, '', 'config'], [429, '', 'limite'], [413, '', 'payload']].every(([s, c, e]) => esitoIngenuo(s) !== e && esitoInvio(s, c) === e));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
