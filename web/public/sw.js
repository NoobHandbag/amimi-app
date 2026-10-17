// Service worker delle notifiche native (Web Push, PR A del 17-10, brief 2026-10-17_BRIEF_notifiche_native_web_push).
//
// SOLO notifiche: nessun listener fetch e nessuna cache. L'aggiornamento dell'app resta quello di version.ts e
// UpdateBanner (version.json letto con no-store): un service worker che servisse i file da una cache sua terrebbe in
// vita bundle vecchi, il problema che version.ts esiste per evitare. Senza listener fetch il browser non passa mai di
// qui per le richieste della pagina.
//
// Si registra dalla scheda Notifiche (lib/push.ts, preparaRegistrazione) appena la si apre con una sessione e il flag
// acceso, PRIMA del tocco su "Attiva" (su iPhone subscribe deve essere il primo await del gesto); mai all'avvio. Quindi
// ce l'ha ogni telefono che ha aperto quella scheda, anche senza iscriversi: innocuo finche' qui non c'e' un fetch.
// File JS semplice senza import: vive in web/public e Vite lo copia cosi' com'e' in /amimi-app/sw.js (scope /amimi-app/).

const TITOLO_GENERICO = 'Amimì';
const TESTO_GENERICO = "Apri l'app per i dettagli.";
const testo = (v) => (typeof v === 'string' && v.trim() ? v : null);

// push-api manda Declarative Web Push con mutable:true ({web_push:8030, mutable:true, notification:{title, body,
// navigate, lang}}, 17-10). Su iOS 18.4+ il browser passa la notifica gia' letta in event.notification e event.data e'
// null (Push API, "fire the push event"): va letta PRIMA dei dati, altrimenti ogni notifica su iPhone uscirebbe col
// titolo generico. Chrome e iOS piu' vecchi la passano in event.data; si accetta anche la forma semplice {title, body,
// url}. JSON rotto o campi mancanti: notifica generica, MAI nessuna notifica, perche' Safari revoca l'iscrizione a chi
// riceve una push senza mostrare niente.
function normalizza(radice) {
  const r = radice && typeof radice === 'object' ? radice : {};
  const n = r.notification && typeof r.notification === 'object' ? r.notification : r;
  return {
    title: testo(n.title) || TITOLO_GENERICO,
    body: testo(n.body) || (testo(n.title) ? '' : TESTO_GENERICO),
    url: testo(n.navigate) || testo(n.url) || testo(r.url) || null,
    tag: testo(n.tag) || testo(r.tag) || null,
  };
}
function leggiPayload(event) {
  const dichiarativa = event.notification;
  if (dichiarativa && typeof dichiarativa === 'object' && testo(dichiarativa.title)) return normalizza(dichiarativa);
  let j = null;
  try { j = event.data ? event.data.json() : null; } catch { j = null; }
  return normalizza(j);
}

// L'URL della notifica si apre solo se e' dentro lo scope dell'app: un payload con un indirizzo esterno apre l'app.
// new URL normalizza i ../ prima del confronto, quindi /amimi-app/../altro non passa.
function urlDentroScope(url, scope) {
  if (typeof url !== 'string' || !url) return scope;
  try {
    const u = new URL(url, scope).href;
    return u.startsWith(scope) ? u : scope;
  } catch {
    return scope;
  }
}

// La radice dell'app (con o senza index.html, query e hash). Il Villaggio a se' vive in /amimi-app/villaggio/, dentro
// lo stesso scope: una sua finestra non sa cambiare scheda, quindi non va confusa con l'app intera.
function allaRadice(url, scope) {
  const base = String(url).split('#')[0].split('?')[0];
  return base === scope || base === scope + 'index.html';
}

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  const p = leggiPayload(event);
  const scope = self.registration.scope;
  // MAI navigate fra le opzioni: una notifica con navigate fa navigare il browser da se' e notificationclick non parte
  // (Notifications spec, activation steps), quindi niente cambio di scheda con go() ad app aperta. L'URL va in data.url.
  const opzioni = { body: p.body, lang: 'it', icon: scope + 'icon-192.png', data: { url: p.url } };
  if (p.tag) opzioni.tag = p.tag;
  event.waitUntil(self.registration.showNotification(p.title, opzioni));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  const dati = event.notification.data;
  const url = urlDentroScope(dati && dati.url, scope);
  event.waitUntil((async () => {
    if (allaRadice(url, scope)) {
      const finestre = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const app = finestre.find((c) => allaRadice(c.url, scope));
      if (app) {
        // l'app aperta cambia scheda con go() (PushKeeper): una navigazione del service worker la ricaricherebbe da capo
        // e un cambio di location.hash verrebbe letto come "indietro" dal backnav
        try { await app.focus(); } catch { /* il focus puo' essere negato: il messaggio parte lo stesso */ }
        app.postMessage({ tipo: 'amimi-apri', hash: new URL(url).hash });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
