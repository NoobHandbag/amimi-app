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
//   5. sorgente del web (Gate 3 del 17-10): gli hash di tabDaHash (lib/push.ts) sono quelli del link diretto in App.tsx;
//      il service worker si registra solo da lib/push.ts e preparaRegistrazione si chiama solo dalla scheda Notifiche.
// Autocontrollo: cinque rilevatori devono accorgersi di un difetto piantato apposta in una copia del sorgente.
//   node tests/push_sw.mjs   (nessuna rete, nessuna dipendenza)
import { readFileSync, readdirSync } from 'node:fs';
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
check('autocontrollo: una scheda nuova aggiunta solo ad App.tsx e\' vista',
  JSON.stringify(hashDiTabDaHash(PUSH_TS)) !== JSON.stringify(hashDiApp(APP_TSX.replace("window.location.hash.startsWith('#notifiche') ? 'notifiche' :", "window.location.hash.startsWith('#notifiche') ? 'notifiche' : window.location.hash.startsWith('#nuova') ? 'nuova' :"))));

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
// G2-ISO-6: il worker c'e' su ogni telefono che ha aperto la scheda Notifiche, non solo su chi si e' iscritto
const affermazioneFalsa = /non si e' (?:mai )?iscritto non (?:ce l'ha|ne ha uno)/;
eq('nessun commento dice che senza iscrizione il service worker non c\'e\'',
  [['web/public/sw.js', SRC], ['web/src/lib/push.ts', PUSH_TS], ['web/src/components/PushKeeper.tsx', leggi('web/src/components/PushKeeper.tsx')]]
    .filter(([, s]) => affermazioneFalsa.test(s)).map(([f]) => f), []);

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
