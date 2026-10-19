// tests/push_sw.mjs: il service worker delle notifiche native (web/public/sw.js, 17-10, brief notifiche native PR A).
// Lo carica davvero in node:vm con un self finto (registration, clients) e controlla:
//   1. nessun listener fetch (niente cache: l'aggiornamento resta quello di version.ts), install -> skipWaiting,
//      activate -> clients.claim;
//   2. push: forma Declarative Web Push e forma semplice, SEMPRE dentro event.waitUntil(showNotification), titolo
//      generico su dati rotti o assenti (Safari revoca l'iscrizione se una push non mostra niente); la notifica
//      dichiarativa di iOS 18.4+ (event.notification, event.data null col payload mutable) letta prima dei dati; MAI
//      navigate fra le opzioni (salterebbe notificationclick);
//   3. notificationclick: URL fuori scope -> radice dell'app; finestra dell'app aperta -> focus e messaggio
//      {tipo:'amimi-apri', hash}; nessuna finestra (o solo il Villaggio a se') -> openWindow.
//   5. sorgente del web (Gate 3 del 17-10): gli hash di tabDaHash (lib/push.ts) sono quelli del link diretto in App.tsx,
//      #assistenza e #salute compresi (18-10, push-eventi); il service worker si registra solo da lib/push.ts e
//      preparaRegistrazione si chiama solo dalla scheda Notifiche.
//      Link B2B ad app aperta (18-10, Gate 3 push-eventi, K2): PushKeeper mette la rotta nell'URL con replaceState DOPO
//      go() (mai location.hash) e manda EVENTO_ROTTA, che Negozi.tsx ascolta con lo stesso nome.
//   6. blocco PURE:push-web di lib/push.ts (18-10) ritagliato dal sorgente ed eseguito: tabDaHash, rottaDaHash (la
//      rotta di Negozi da mettere nell'URL) e temiPredefiniti (i temi spuntati alla prima iscrizione secondo
//      push_temi.predefinito_per, tutti se nessun tema ne ha).
// Autocontrollo: ogni rilevatore deve accorgersi di un difetto piantato apposta in una copia del sorgente.
//   node tests/push_sw.mjs   (nessuna rete, nessuna dipendenza; Node 24 per il blocco TypeScript)
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const leggi = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SCOPE = 'https://noobhandbag.github.io/amimi-app/';
const GENERICO = 'Amimì';

let ok = 0, ko = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ok  ' + name); }
  else { ko++; console.log('  KO  ' + name + (extra ? '\n      ' + extra : '')); }
};
const eq = (name, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  check(name, g === e, `atteso ${e}, ottenuto ${g}`);
};

/** sw.js in un contesto vm. finestre = le WindowClient che matchAll restituisce ({url, focusFallisce?}). */
function carica(src = SRC, finestre = []) {
  const listeners = {};
  const r = { listeners, mostrate: [], aperte: [], messaggi: [], focus: [], query: [], skip: 0, claim: 0 };
  const client = (f) => ({
    url: f.url,
    focus: async () => { r.focus.push(f.url); if (f.focusFallisce) throw new Error('focus negato'); return client(f); },
    postMessage: (m) => { r.messaggi.push({ url: f.url, m }); },
  });
  const self = {
    addEventListener: (tipo, fn) => { (listeners[tipo] ||= []).push(fn); },
    skipWaiting: () => { r.skip++; return Promise.resolve(); },
    registration: { scope: SCOPE, showNotification: (title, opts) => { r.mostrate.push({ title, opts }); return Promise.resolve(); } },
    clients: {
      claim: () => { r.claim++; return Promise.resolve(); },
      matchAll: async (q) => { r.query.push(q); return finestre.map(client); },
      openWindow: async (url) => { r.aperte.push(url); return null; },
    },
  };
  vm.runInContext(src, vm.createContext({ self, URL, console }), { filename: 'sw.js' });
  return r;
}

/** I dati di una push come PushMessageData: json() lancia su JSON rotto, come nel browser. null = push senza dati. */
const dati = (testo) => (testo === null ? null : { json: () => JSON.parse(testo), text: () => testo });

/** Lancia l'evento e aspetta cio' che e' stato passato a waitUntil. Ritorna quante volte waitUntil e' stato chiamato. */
async function lancia(r, tipo, evento) {
  const attese = [];
  const e = { ...evento, waitUntil: (p) => { attese.push(p); } };
  for (const fn of r.listeners[tipo] ?? []) fn(e);
  await Promise.all(attese);
  return attese.length;
}
const push = (r, testo) => lancia(r, 'push', { data: dati(testo) });
/** Push con mutable:true su iOS 18.4+: il browser passa la notifica dichiarativa gia' letta e i dati null. */
const pushDichiarativa = (r, notification, testo = null) => lancia(r, 'push', { data: dati(testo), notification });
const NOTIFICA_IOS = { title: 'Controllo contabile', body: '2 errori nuovi', navigate: SCOPE + '#notifiche', lang: 'it', tag: '' };
function clic(r, data) {
  const notification = { data, chiusa: 0, close() { this.chiusa++; } };
  return lancia(r, 'notificationclick', { notification }).then((n) => ({ n, chiusa: notification.chiusa }));
}

// ---- rilevatori: usati sul sorgente vero e, nell'autocontrollo, su copie col difetto piantato ----
const senzaFetch = (src) => !carica(src).listeners.fetch;
async function genericaSuDatiRotti(src) {
  const r = carica(src);
  const n = await push(r, '{non e\' json');
  return n === 1 && r.mostrate.length === 1 && r.mostrate[0].title === GENERICO;
}
async function esternoVaAlloScope(src) {
  const r = carica(src);
  await clic(r, { url: 'https://phishing.example/amimi-app/' });
  return r.aperte.length === 1 && r.aperte[0] === SCOPE;
}
async function dichiarativaLetta(src) {
  const r = carica(src);
  const n = await pushDichiarativa(r, NOTIFICA_IOS);
  const m = r.mostrate[0];
  return n === 1 && r.mostrate.length === 1 && m.title === 'Controllo contabile' && m.opts.body === '2 errori nuovi'
    && m.opts.data?.url === SCOPE + '#notifiche';
}
async function maiNavigate(src) {
  const r = carica(src);
  await pushDichiarativa(r, NOTIFICA_IOS);
  await push(r, JSON.stringify({ web_push: 8030, mutable: true, notification: NOTIFICA_IOS }));
  return r.mostrate.length === 2 && r.mostrate.every((m) => !('navigate' in m.opts));
}

console.log('\n== 1. ciclo di vita, nessun fetch ==');
{
  const r = carica();
  check('nessun listener fetch', senzaFetch(SRC), 'listener: ' + Object.keys(r.listeners).join(', '));
  eq('listener registrati', Object.keys(r.listeners).sort(), ['activate', 'install', 'notificationclick', 'push']);
  await lancia(r, 'install', {});
  eq('install -> skipWaiting', r.skip, 1);
  const n = await lancia(r, 'activate', {});
  check('activate -> waitUntil(clients.claim())', n === 1 && r.claim === 1);
  check('nessuna cache nel sorgente', !/\bcaches\b|importScripts|^\s*import\s/m.test(SRC));
}

console.log('\n== 2. push ==');
{
  const r = carica();
  const n = await push(r, JSON.stringify({ web_push: 8030, notification: { title: 'Controllo contabile', body: '2 errori nuovi', navigate: SCOPE + '#notifiche', lang: 'it' } }));
  eq('dichiarativa: una notifica dentro waitUntil', [n, r.mostrate.length], [1, 1]);
  const m = r.mostrate[0];
  eq('dichiarativa: titolo', m.title, 'Controllo contabile');
  eq('dichiarativa: opzioni', m.opts, { body: '2 errori nuovi', lang: 'it', icon: SCOPE + 'icon-192.png', data: { url: SCOPE + '#notifiche' } });
  check('dichiarativa: niente tag se non c\'e\'', !('tag' in m.opts));
}
{
  // la forma che push-api manda dal 17-10 (Gate 3): Chrome e iOS sotto 18.4 la passano in event.data, mutable compreso
  const r = carica();
  const n = await push(r, JSON.stringify({ web_push: 8030, mutable: true, notification: { title: 'Controllo contabile', body: '2 errori nuovi', navigate: SCOPE + '#notifiche', lang: 'it' } }));
  eq('mutable nei dati (Chrome): una notifica dentro waitUntil', [n, r.mostrate.length], [1, 1]);
  eq('mutable nei dati (Chrome): titolo e opzioni', [r.mostrate[0].title, r.mostrate[0].opts],
    ['Controllo contabile', { body: '2 errori nuovi', lang: 'it', icon: SCOPE + 'icon-192.png', data: { url: SCOPE + '#notifiche' } }]);
}
{
  // iOS 18.4+ col payload mutable: event.data null, la notifica dichiarativa in event.notification (B1 Gate 2)
  const r = carica();
  const n = await pushDichiarativa(r, NOTIFICA_IOS);
  eq('iOS mutable (dati null): una notifica dentro waitUntil', [n, r.mostrate.length], [1, 1]);
  eq('iOS mutable (dati null): titolo e testo veri, url in data.url', [r.mostrate[0].title, r.mostrate[0].opts],
    ['Controllo contabile', { body: '2 errori nuovi', lang: 'it', icon: SCOPE + 'icon-192.png', data: { url: SCOPE + '#notifiche' } }]);
  check('iOS mutable: niente navigate fra le opzioni (notificationclick deve partire)', !('navigate' in r.mostrate[0].opts), JSON.stringify(r.mostrate[0].opts));
  check('iOS mutable: tag vuoto della notifica non passato', !('tag' in r.mostrate[0].opts));
}
{
  const r = carica();
  await pushDichiarativa(r, NOTIFICA_IOS, JSON.stringify({ title: 'Dai dati', body: 'altro' }));
  eq('notifica dichiarativa e dati insieme: vale la dichiarativa', r.mostrate[0].title, 'Controllo contabile');
}
{
  const r = carica();
  await pushDichiarativa(r, { title: '  ', body: '', navigate: SCOPE }, JSON.stringify({ title: 'Vendite ferme', body: 'Nessun ordine', url: SCOPE + '#negozi' }));
  eq('notifica dichiarativa senza titolo: valgono i dati', [r.mostrate[0].title, r.mostrate[0].opts.body, r.mostrate[0].opts.data.url], ['Vendite ferme', 'Nessun ordine', SCOPE + '#negozi']);
}
{
  const r = carica();
  const n = await pushDichiarativa(r, null);
  check('dati null e notification null: notifica generica dentro waitUntil', n === 1 && r.mostrate.length === 1 && r.mostrate[0].title === GENERICO && r.mostrate[0].opts.body.length > 0,
    JSON.stringify(r.mostrate));
}
check('nessuna forma passa navigate fra le opzioni', await maiNavigate(SRC));
{
  const r = carica();
  await push(r, JSON.stringify({ title: 'Vendite ferme', body: 'Nessun ordine da 24 ore', url: SCOPE, tag: 'vendite' }));
  eq('semplice: titolo, testo, url, tag', [r.mostrate[0].title, r.mostrate[0].opts.body, r.mostrate[0].opts.data.url, r.mostrate[0].opts.tag], ['Vendite ferme', 'Nessun ordine da 24 ore', SCOPE, 'vendite']);
}
{
  const r = carica();
  await push(r, JSON.stringify({ title: 'Solo titolo' }));
  eq('solo titolo: testo vuoto, url null', [r.mostrate[0].title, r.mostrate[0].opts.body, r.mostrate[0].opts.data.url], ['Solo titolo', '', null]);
}
check('JSON rotto: notifica generica comunque', await genericaSuDatiRotti(SRC));
for (const [nome, testo] of [['push senza dati', null], ['JSON numero', '42'], ['JSON null', 'null'], ['titolo vuoto', '{"title":"  ","body":""}'], ['notification non oggetto', '{"web_push":8030,"notification":"x"}']]) {
  const r = carica();
  const n = await push(r, testo);
  check(`${nome}: notifica generica dentro waitUntil`, n === 1 && r.mostrate.length === 1 && r.mostrate[0].title === GENERICO && r.mostrate[0].opts.body.length > 0,
    JSON.stringify(r.mostrate));
}

console.log('\n== 3. notificationclick ==');
check('URL esterno: si apre la radice dell\'app', await esternoVaAlloScope(SRC));
{
  const r = carica();
  const { n, chiusa } = await clic(r, { url: SCOPE + '../altro/' });
  eq('../ fuori dallo scope: radice dell\'app, notifica chiusa, waitUntil', [r.aperte, chiusa, n], [[SCOPE], 1, 1]);
}
{
  const r = carica();
  await clic(r, { url: 'javascript:alert(1)' });
  eq('javascript: -> radice dell\'app', r.aperte, [SCOPE]);
}
{
  const r = carica(SRC, [{ url: SCOPE + '?v=123#negozi' }]);
  await clic(r, { url: SCOPE + '#notifiche' });
  eq('finestra dell\'app aperta: focus', r.focus, [SCOPE + '?v=123#negozi']);
  eq('finestra dell\'app aperta: messaggio con l\'hash', r.messaggi, [{ url: SCOPE + '?v=123#negozi', m: { tipo: 'amimi-apri', hash: '#notifiche' } }]);
  eq('finestra dell\'app aperta: nessuna finestra nuova', r.aperte, []);
  eq('matchAll: finestre, anche non controllate', r.query, [{ type: 'window', includeUncontrolled: true }]);
}
{
  const r = carica(SRC, [{ url: SCOPE, focusFallisce: true }]);
  await clic(r, { url: '#negozi' });
  eq('focus negato: il messaggio parte lo stesso (hash relativo risolto nello scope)', r.messaggi.map((x) => x.m), [{ tipo: 'amimi-apri', hash: '#negozi' }]);
}
{
  const r = carica();
  await clic(r, { url: SCOPE + '#notifiche' });
  eq('nessuna finestra: openWindow con l\'URL', r.aperte, [SCOPE + '#notifiche']);
}
{
  const r = carica(SRC, [{ url: SCOPE + 'villaggio/' }]);
  await clic(r, { url: SCOPE + '#notifiche' });
  eq('solo il Villaggio a se\' aperto: non riceve il messaggio, si apre l\'app', [r.messaggi, r.aperte], [[], [SCOPE + '#notifiche']]);
}
{
  const r = carica(SRC, [{ url: SCOPE }]);
  await clic(r, { url: SCOPE + 'villaggio/' });
  eq('URL dentro lo scope ma non alla radice: openWindow, niente messaggio', [r.messaggi, r.aperte], [[], [SCOPE + 'villaggio/']]);
}
{
  const r = carica();
  await clic(r, null);
  eq('notifica senza dati: radice dell\'app', r.aperte, [SCOPE]);
}

console.log('\n== 4. autocontrollo: difetti piantati ==');
const pianta = (nome, da, a) => {
  const n = SRC.split(da).length - 1;
  check(`autocontrollo: il punto da guastare per "${nome}" esiste una volta`, n === 1, `trovato ${n} volte: ${da}`);
  return SRC.replace(da, a);
};
check('autocontrollo: un listener fetch aggiunto e\' visto', !senzaFetch(SRC + "\nself.addEventListener('fetch', () => {});\n"));
check('autocontrollo: una push generica non mostrata e\' vista',
  !(await genericaSuDatiRotti(pianta('push generica', 'event.waitUntil(self.registration.showNotification(p.title, opzioni));',
    "if (p.title !== 'Amimì') event.waitUntil(self.registration.showNotification(p.title, opzioni));"))));
check('autocontrollo: un URL esterno lasciato passare e\' visto',
  !(await esternoVaAlloScope(pianta('controllo dello scope', 'return u.startsWith(scope) ? u : scope;', 'return u;'))));
check('autocontrollo: la notifica dichiarativa ignorata (solo event.data) e\' vista',
  !(await dichiarativaLetta(pianta('lettura della dichiarativa',
    'if (dichiarativa && typeof dichiarativa === \'object\' && testo(dichiarativa.title)) return normalizza(dichiarativa);', ''))));
check('autocontrollo: navigate passato fra le opzioni e\' visto',
  !(await maiNavigate(pianta('opzioni della notifica', 'data: { url: p.url } };', 'data: { url: p.url }, navigate: p.url };'))));

console.log('\n== 5. sorgente del web: hash delle schede e registrazione del service worker ==');
const PUSH_TS = leggi('web/src/lib/push.ts');
const APP_TSX = leggi('web/src/App.tsx');
/** Gli hash di tabDaHash: l'elenco del for ... of [...] as const. */
function hashDiTabDaHash(src) {
  const corpo = src.match(/export function tabDaHash[\s\S]*?\n}\n/)?.[0] ?? '';
  const lista = corpo.match(/for \(const t of \[([^\]]*)\] as const\)/)?.[1] ?? '';
  return [...lista.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
}
/** Gli hash del link diretto all'avvio in App.tsx: la catena hash.startsWith('#x') ? 'x' : ... dentro useState<Tab>. */
function hashDiApp(src) {
  const riga = src.split('\n').find((l) => l.includes('useState<Tab>(')) ?? '';
  return [...riga.matchAll(/hash\.startsWith\('#([a-z]+)'\) \? '([a-z]+)'/g)].map((m) => (m[1] === m[2] ? m[1] : `${m[1]}->${m[2]}`));
}
const daPush = hashDiTabDaHash(PUSH_TS), daApp = hashDiApp(APP_TSX);
check('tabDaHash letto (almeno negozi e notifiche)', daPush.includes('negozi') && daPush.includes('notifiche'), JSON.stringify(daPush));
check('App.tsx: catena degli hash letta, ogni hash apre la scheda col suo nome', daApp.length >= 2 && daApp.every((h) => !h.includes('->')), JSON.stringify(daApp));
eq('stessi hash, nello stesso ordine, in tabDaHash e nel link diretto di App.tsx', daPush, daApp);
// i link di push-eventi (18-10): l'Assistenza e la Salute devono aprirsi sia ad app chiusa (App.tsx) sia aperta (tabDaHash)
for (const h of ['assistenza', 'salute']) {
  check(`#${h} nel link diretto di App.tsx e in tabDaHash`, daApp.includes(h) && daPush.includes(h), JSON.stringify({ daApp, daPush }));
}
check('autocontrollo: una scheda nuova aggiunta solo ad App.tsx e\' vista',
  JSON.stringify(hashDiTabDaHash(PUSH_TS)) !== JSON.stringify(hashDiApp(APP_TSX.replace("window.location.hash.startsWith('#notifiche') ? 'notifiche' :", "window.location.hash.startsWith('#notifiche') ? 'notifiche' : window.location.hash.startsWith('#nuova') ? 'nuova' :"))));
check('autocontrollo: #salute tolto dal solo App.tsx e\' visto',
  JSON.stringify(hashDiTabDaHash(PUSH_TS)) !== JSON.stringify(hashDiApp(APP_TSX.replace(" window.location.hash.startsWith('#salute') ? 'salute' :", ''))));

/** Ogni .ts/.tsx sotto web/src, con percorso relativo a web/src. */
function sorgenti(dir = new URL('../web/src/', import.meta.url), pre = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...sorgenti(new URL(e.name + '/', dir), pre + e.name + '/'));
    else if (/\.tsx?$/.test(e.name)) out.push({ rel: pre + e.name, src: readFileSync(new URL(e.name, dir), 'utf8') });
  }
  return out;
}
const WEB = sorgenti();
eq('serviceWorker.register solo in lib/push.ts', WEB.filter((f) => /serviceWorker\.register\(/.test(f.src)).map((f) => f.rel), ['lib/push.ts']);
eq('preparaRegistrazione chiamata solo dalla scheda Notifiche',
  WEB.filter((f) => /(?<!function )preparaRegistrazione\(/.test(f.src)).map((f) => f.rel), ['pages/Notifiche.tsx']);
// K2 (Gate 3 del 18-10): il tocco su una notifica B2B ad app aperta deve aprire il negozio della notifica. PushKeeper,
// nel listener del messaggio amimi-apri: go(t), poi rottaDaHash, replaceState (sulla voce nuova di go, cosi' quella di
// prima tiene il suo URL), poi EVENTO_ROTTA; mai location.hash (popstate = "indietro" per il backnav). Negozi.tsx
// rilegge la rotta su quell'evento, col nome scritto per esteso (non importa il modulo notifiche).
const PUSHKEEPER = leggi('web/src/components/PushKeeper.tsx');
const NEGOZI = leggi('web/src/pages/Negozi.tsx');
function rottaNellUrl(pk, neg, push) {
  const nome = push.match(/export const EVENTO_ROTTA = '([^']+)';/)?.[1];
  const corpo = pk.match(/const suMessaggio = [\s\S]*?\n {4}};\n/)?.[0] ?? '';
  const go = corpo.indexOf('goRef.current(t);');
  const calcolo = corpo.indexOf('const rotta = rottaDaHash(d.hash);');
  const sostituisci = corpo.indexOf("history.replaceState(history.state, '', rotta);");
  const evento = corpo.indexOf('window.dispatchEvent(new Event(EVENTO_ROTTA));');
  return !!nome && go > 0 && calcolo > go && sostituisci > calcolo && evento > sostituisci
    && !/location\.hash\s*=(?!=)/.test(pk)
    && neg.includes(`window.addEventListener('${nome}', h);`) && neg.includes(`window.removeEventListener('${nome}', h);`);
}
check('K2: PushKeeper mette la rotta con replaceState dopo go() e manda EVENTO_ROTTA; Negozi lo ascolta con lo stesso nome', rottaNellUrl(PUSHKEEPER, NEGOZI, PUSH_TS));
{
  const pk = (da, a) => { const n = PUSHKEEPER.split(da).length - 1; check(`autocontrollo: il punto da guastare in PushKeeper esiste una volta: ${da.trim().split('\n')[0]}`, n === 1); return PUSHKEEPER.replace(da, a); };
  check('autocontrollo: EVENTO_ROTTA non mandato e\' visto', !rottaNellUrl(pk('      window.dispatchEvent(new Event(EVENTO_ROTTA));\n', ''), NEGOZI, PUSH_TS));
  check('autocontrollo: location.hash al posto di replaceState e\' visto', !rottaNellUrl(pk("history.replaceState(history.state, '', rotta);", 'location.hash = rotta;'), NEGOZI, PUSH_TS));
  check('autocontrollo: replaceState prima di go() e\' visto (la voce di prima prenderebbe l\'URL del negozio)',
    !rottaNellUrl(pk('      goRef.current(t);\n      const rotta = rottaDaHash(d.hash);\n      if (rotta === null) return;\n      history.replaceState(history.state, \'\', rotta);\n',
      '      const rotta = rottaDaHash(d.hash);\n      if (rotta !== null) history.replaceState(history.state, \'\', rotta);\n      goRef.current(t);\n      if (rotta === null) return;\n'), NEGOZI, PUSH_TS));
  const n = NEGOZI.split("window.addEventListener('amimi-rotta', h);").length - 1;
  check('autocontrollo: il listener di Negozi da togliere esiste una volta', n === 1);
  check('autocontrollo: Negozi che non ascolta l\'evento e\' visto', !rottaNellUrl(PUSHKEEPER, NEGOZI.replace(" window.addEventListener('amimi-rotta', h);", ''), PUSH_TS));
  check('autocontrollo: un nome diverso in lib/push.ts e\' visto', !rottaNellUrl(PUSHKEEPER, NEGOZI, PUSH_TS.replace("export const EVENTO_ROTTA = 'amimi-rotta';", "export const EVENTO_ROTTA = 'amimi-rotta-negozi';")));
}

// G2-ISO-6: il worker c'e' su ogni telefono che ha aperto la scheda Notifiche, non solo su chi si e' iscritto
const affermazioneFalsa = /non si e' (?:mai )?iscritto non (?:ce l'ha|ne ha uno)/;
eq('nessun commento dice che senza iscrizione il service worker non c\'e\'',
  [['web/public/sw.js', SRC], ['web/src/lib/push.ts', PUSH_TS], ['web/src/components/PushKeeper.tsx', leggi('web/src/components/PushKeeper.tsx')]]
    .filter(([, s]) => affermazioneFalsa.test(s)).map(([f]) => f), []);

console.log('\n== 6. blocco PURE:push-web di lib/push.ts (tabDaHash, temiPredefiniti) ==');
/** Il blocco fra i marcatori, null se mancano. */
function bloccoWeb(src) {
  const B = '// ==== PURE:push-web BEGIN ====', E = '// ==== PURE:push-web END ====';
  const a = src.indexOf(B), b = src.indexOf(E);
  return a < 0 || b < a ? null : src.slice(a + B.length, b);
}
/** Il blocco eseguito davvero: scritto come .mts in una cartella temporanea (Node 24 toglie i tipi da solo). */
async function caricaBlocco(src) {
  const corpo = bloccoWeb(src);
  if (corpo === null) return null;
  const dir = mkdtempSync(join(tmpdir(), 'push_sw-'));
  try {
    const f = join(dir, 'push_web.mts');
    writeFileSync(f, corpo, 'utf8');
    return await import(pathToFileURL(f).href);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const BLOCCO = bloccoWeb(PUSH_TS);
check('marcatori PURE:push-web presenti in lib/push.ts', BLOCCO !== null);
check('blocco PURE senza import, rete, storage o browser', BLOCCO !== null && !/\bimport\b|fetch\(|csClient|localStorage|navigator|window\.|document\./.test(BLOCCO));
const W = await caricaBlocco(PUSH_TS);
check('blocco PURE eseguibile ed esporta tabDaHash, rottaDaHash e temiPredefiniti', typeof W?.tabDaHash === 'function' && typeof W?.rottaDaHash === 'function' && typeof W?.temiPredefiniti === 'function');

/** tabDaHash: gli hash dei link delle notifiche aprono la scheda giusta, il resto nessuna. */
function tabGiuste(m) {
  if (typeof m?.tabDaHash !== 'function') return false;
  const casi = [
    ['#assistenza', 'assistenza'], ['#salute', 'salute'], ['#notifiche', 'notifiche'], ['#negozi', 'negozi'],
    ['#negozi/outreach/7f1c', 'negozi'], ['#villaggio', 'villaggio'], ['', null], ['#', null], ['#boh', null], ['assistenza', null],
  ];
  return casi.every(([h, t]) => m.tabDaHash(h) === t);
}
check('tabDaHash: #assistenza, #salute e gli altri hash aprono la loro scheda; vuoto, sconosciuto o senza # nessuna', !!W && tabGiuste(W),
  W ? JSON.stringify(['#assistenza', '#salute', '#negozi/outreach/7f1c', '#boh', ''].map((h) => [h, W.tabDaHash(h)])) : '');

/** rottaDaHash (K2, 18-10): la rotta di Negozi va nell'URL com'e' (link di b2b_risposta_negozio, dossier, coda);
 *  caratteri inattesi -> la lista; le altre schede non hanno rotte e l'URL non si tocca. */
const NEGOZIO = '7f1c2a3b-0000-4000-8000-00000000abcd';
function rotteGiuste(m) {
  if (typeof m?.rottaDaHash !== 'function') return false;
  const casi = [
    ['#negozi/outreach/' + NEGOZIO, '#negozi/outreach/' + NEGOZIO], ['#negozi', '#negozi'], ['#negozi/outreach', '#negozi/outreach'],
    ['#negozi/outreach/coda', '#negozi/outreach/coda'], ['#negozi/' + NEGOZIO, '#negozi/' + NEGOZIO],
    ['#negozi/outreach/x?y=1', '#negozi'], ['#negozi/outreach/<b>', '#negozi'], ['#negozi//', '#negozi'], ['#negozix', '#negozi'],
    ['#assistenza', null], ['#salute', null], ['#notifiche', null], ['#villaggio', null], ['', null], ['#boh', null], ['negozi/outreach/1', null],
  ];
  return casi.every(([h, r]) => m.rottaDaHash(h) === r);
}
check('rottaDaHash: #negozi/... nell\'URL com\'e\', caratteri inattesi -> #negozi, altre schede e hash sconosciuti null', !!W && rotteGiuste(W),
  typeof W?.rottaDaHash === 'function' ? JSON.stringify(['#negozi/outreach/' + NEGOZIO, '#negozi/outreach/x?y=1', '#assistenza', ''].map((h) => [h, W.rottaDaHash(h)])) : 'rottaDaHash assente');

// i temi del 18-10 come li manda config dopo la migrazione 0166 (le etichette qui non contano)
const T = (key, predefinito_per) => ({ key, etichetta: key, descrizione: null, ...(predefinito_per === undefined ? {} : { predefinito_per }) });
const TEMI_18 = [
  T('conti', ['Ale']), T('vendite', ['Ale']), T('negozi', ['Ale', 'Bene']), T('assistenza', ['Ginevra']),
  T('spedizioni', ['Ginevra']), T('sistema', ['Ale']), T('riepilogo', ['Ale', 'Bene', 'Ginevra']),
];
/** temiPredefiniti: le persone del contratto 18-10 e i ripieghi. */
function predefinitiGiusti(m) {
  if (typeof m?.temiPredefiniti !== 'function') return false;
  const p = m.temiPredefiniti;
  const casi = [
    [p(TEMI_18, 'Ale'), ['conti', 'vendite', 'negozi', 'sistema', 'riepilogo']],
    [p(TEMI_18, 'Bene'), ['negozi', 'riepilogo']],
    [p(TEMI_18, 'Ginevra'), ['assistenza', 'spedizioni', 'riepilogo']],
    // push-api di prima del 18-10: nessun campo, partono tutti come prima
    [p([T('conti'), T('vendite')], 'Ginevra'), ['conti', 'vendite']],
    // campo presente ma vuoto ovunque: stesso ripiego
    [p([T('conti', []), T('vendite', [])], 'Bene'), ['conti', 'vendite']],
    // campo rotto (null, stringa) letto come vuoto; un tema con predefiniti basta a non ripiegare su tutti
    [p([T('conti', null), T('vendite', 'Ale'), T('negozi', ['Bene'])], 'Bene'), ['negozi']],
    [p([T('conti', null), T('vendite', 'Ale'), T('negozi', ['Bene'])], 'Ale'), []],
    // persona sconosciuta: niente spuntato (Attiva resta comunque spento senza persona valida)
    [p(TEMI_18, 'Mario'), []],
    [p([], 'Ale'), []],
  ];
  return casi.every(([got, exp]) => JSON.stringify(got) === JSON.stringify(exp));
}
check('temiPredefiniti: Ale, Benny e Ginni hanno i loro temi, nell\'ordine di config; tutti se nessun tema ha predefiniti', !!W && predefinitiGiusti(W),
  W ? JSON.stringify(['Ale', 'Bene', 'Ginevra'].map((c) => [c, W.temiPredefiniti(TEMI_18, c)])) : '');
check('temiPredefiniti non tocca la lista che riceve', !!W && (() => { const prima = JSON.stringify(TEMI_18); W.temiPredefiniti(TEMI_18, 'Ale'); return JSON.stringify(TEMI_18) === prima; })());

const piantaWeb = (nome, da, a) => {
  const n = PUSH_TS.split(da).length - 1;
  check(`autocontrollo: il punto da guastare per "${nome}" esiste una volta`, n === 1, `trovato ${n} volte: ${da}`);
  return PUSH_TS.replace(da, a);
};
{
  const m = await caricaBlocco(piantaWeb('ripiego su tutti', 'if (!temi.some((t) => lista(t).length > 0)) return temi.map((t) => t.key);\n', ''));
  check('autocontrollo: senza il ripiego su tutti i temi e\' visto', !!m && !predefinitiGiusti(m));
}
{
  const m = await caricaBlocco(piantaWeb('filtro per persona', 'return temi.filter((t) => lista(t).includes(chi)).map((t) => t.key);', 'return temi.map((t) => t.key);'));
  check('autocontrollo: tutti i temi spuntati per chiunque e\' visto', !!m && !predefinitiGiusti(m));
}
{
  const m = await caricaBlocco(piantaWeb('hash di salute', ", 'assistenza', 'salute'] as const", ", 'assistenza'] as const"));
  check('autocontrollo: #salute tolto da tabDaHash e\' visto', !!m && !tabGiuste(m));
}
{
  const m = await caricaBlocco(piantaWeb('rotta solo per Negozi', "if (tabDaHash(hash) !== 'negozi') return null;\n", "if (tabDaHash(hash) === null) return null;\n"));
  check('autocontrollo: una rotta scritta anche per le altre schede e\' vista', !!m && !rotteGiuste(m));
}
{
  const m = await caricaBlocco(piantaWeb('controllo dei caratteri', "return /^#negozi(?:\\/[0-9A-Za-z_-]+)*$/.test(hash) ? hash : '#negozi';", 'return hash;'));
  check('autocontrollo: un hash con caratteri inattesi messo nell\'URL e\' visto', !!m && !rotteGiuste(m));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
