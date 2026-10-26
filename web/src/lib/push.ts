import { csClient } from './csClient';
import type { Tab } from './people';

// Notifiche native (Web Push, PR A del 17-10, brief 2026-10-17_BRIEF_notifiche_native_web_push). Modulo isolato
// (Regola Ferrea 19): tutto passa dalla edge push-api col JWT del team (csClient), il flag e' app_flags.push_enabled
// letto da v_push_settings (api.ts, fetchPushEnabled). Il service worker (web/public/sw.js) fa solo notifiche: si
// registra dalla scheda Notifiche appena la si apre con una sessione e il flag acceso (preparaRegistrazione, PRIMA del
// tocco su "Attiva": su iPhone subscribe deve essere il primo await del gesto), mai all'avvio. Lo ha quindi ogni
// telefono che ha aperto la scheda, anche senza iscriversi (Gate 3 del 17-10).

const FN = import.meta.env.VITE_SUPABASE_URL as string;
const BASE = import.meta.env.BASE_URL;
/** uuid di QUESTO telefono, presente in localStorage solo finche' e' iscritto. */
export const CHIAVE_DEVICE = 'amimi_push_device';
/** Evento sulla window dopo un "Attiva" o un "Disattiva" riuscito: PushKeeper toglie l'avviso "Notifiche spente". */
export const EVENTO_ISCRIZIONE = 'amimi-push-iscrizione';
/** Evento sulla window (18-10, Gate 3 push-eventi): PushKeeper ha messo nell'URL la rotta interna di una notifica con
 *  history.replaceState, che non manda hashchange, e la pagina gia' aperta deve rileggerla. Negozi.tsx lo ascolta col
 *  nome scritto per esteso, senza importare questo modulo (Regola 19): tests/push_sw.mjs controlla che i nomi coincidano. */
export const EVENTO_ROTTA = 'amimi-rotta';

/** predefinito_per (18-10, migr 0166): le persone per cui il tema parte spuntato alla prima iscrizione. Facoltativo: una
 *  push-api di prima del 18-10 (o riportata indietro) non lo manda, e allora partono tutti i temi come prima. */
export type Tema = { key: string; etichetta: string; descrizione: string | null; predefinito_per?: string[] };
/** reason: solo a flag acceso ma chiavi VAPID mancanti o rotte sul server (push-api config, {enabled:false, reason}). */
export type PushConfig = { enabled: boolean; vapidPublicKey?: string; temi?: Tema[]; reason?: string };
/** Il device_id degli altri telefoni non arriva mai (Gate 3 del 17-10: basta a riscriverne la riga): push-api dice solo
 *  se la riga e' QUESTO telefono, confrontandola col device_id mandato con la richiesta. */
export type Dispositivo = {
  id: string; chi: string; etichetta: string | null; temi: string[]; created_at: string;
  last_ok_at: string | null; last_status: number | null; questo: boolean;
};
type Disattivo = { enabled: false; reason?: string };

// ---------------------------------------------------------------- navigazione da hash e temi predefiniti
// Blocco PURE (18-10): tests/push_sw.mjs lo ritaglia da qui e lo esegue in node, quindi niente import, rete o browser.
// ==== PURE:push-web BEGIN ====
/** Scheda dell'app per l'hash di una notifica toccata con l'app gia' aperta (PushKeeper). null = hash che non apre una
 *  scheda: si resta dove si e' e l'app viene solo in primo piano. Stessi hash del link diretto all'avvio in App.tsx, che
 *  resta nel core e non dipende da questo modulo (Regola 19; la guardia 25 di tests/mat_guardie.mjs lo legge li'). */
export function tabDaHash(hash: string): Tab | null {
  // #negozi la sezione B2B (10-09), #ads la reportistica Meta (18-09), #materiali il catalogo materie prime (22-09),
  // #premia la dashboard fedelta' (27-09), #villaggio l'isola 3D (16-10), #notifiche questa scheda (17-10),
  // #assistenza e #salute dalle notifiche degli eventi di push-eventi (18-10), #comportamento il modulo beh_* (25-10)
  for (const t of ['negozi', 'ads', 'materiali', 'premia', 'villaggio', 'notifiche', 'comportamento', 'assistenza', 'salute'] as const) {
    if (hash.startsWith('#' + t)) return t;
  }
  return null;
}

/** La rotta interna da mettere nell'URL quando il tocco su una notifica, ad app gia' aperta, porta in una scheda che ha
 *  sotto-rotte sue lette dall'hash (18-10, Gate 3 push-eventi): oggi solo Negozi B2B, dove b2b_risposta_negozio porta a
 *  #negozi/outreach/<id negozio>. Prima si cambiava solo scheda: si finiva sulla lista, o sul negozio aperto prima.
 *  null = scheda senza sotto-rotte, l'URL non si tocca. Una sotto-rotta con caratteri inattesi apre la lista. */
export function rottaDaHash(hash: string): string | null {
  if (tabDaHash(hash) !== 'negozi') return null;
  return /^#negozi(?:\/[0-9A-Za-z_-]+)*$/.test(hash) ? hash : '#negozi';
}

/** Temi spuntati prima della prima iscrizione (18-10, brief push-eventi): quelli che hanno la persona in predefinito_per,
 *  nell'ordine di config, cosi' Ginni non riceve i conti e Ale non riceve l'Assistenza se non li sceglie. Se nessun tema
 *  ha predefiniti (push-api di prima del 18-10) partono tutti, come prima: meglio una notifica in piu' che un telefono
 *  iscritto a niente. */
export function temiPredefiniti(temi: readonly Tema[], chi: string): string[] {
  const lista = (t: Tema) => (Array.isArray(t.predefinito_per) ? t.predefinito_per : []);
  if (!temi.some((t) => lista(t).length > 0)) return temi.map((t) => t.key);
  return temi.filter((t) => lista(t).includes(chi)).map((t) => t.key);
}
// ==== PURE:push-web END ====

// ---------------------------------------------------------------- dispositivo
export function leggiDevice(): string | null {
  try { return localStorage.getItem(CHIAVE_DEVICE); } catch { return null; }
}
export function salvaDevice(id: string): void {
  try { localStorage.setItem(CHIAVE_DEVICE, id); } catch { /* storage negato: l'iscrizione vale lo stesso, manca solo il controllo all'avvio */ }
}
export function togliDevice(): void {
  try { localStorage.removeItem(CHIAVE_DEVICE); } catch { /* come sopra */ }
}

type NavigatorIOS = Navigator & { standalone?: boolean };
/** iPadOS si presenta come un Mac: lo tradisce il touch. */
const eIPad = () => /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const eIOS = () => /iPhone|iPod/.test(navigator.userAgent) || eIPad();
const installata = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as NavigatorIOS).standalone === true;

/** ok = si puo' iscrivere; ios-safari = iPhone/iPad fuori dalla schermata Home (Apple da' le push solo all'app
 *  installata, iOS 16.4+); ios-vecchio = installata ma senza PushManager (iOS sotto 16.4); no = browser senza push. */
export type Supporto = 'ok' | 'ios-safari' | 'ios-vecchio' | 'no';
export function supportoPush(): Supporto {
  const api = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (eIOS()) return !installata() ? 'ios-safari' : api ? 'ok' : 'ios-vecchio';
  return api ? 'ok' : 'no';
}
export const swSupportato = () => 'serviceWorker' in navigator && 'PushManager' in window;

/** Etichetta leggibile del telefono per l'elenco dei dispositivi, dallo user agent ("iPhone · Safari", "Android · Chrome").
 *  L'app aperta dalla schermata Home di iOS non dichiara il browser: resta solo "iPhone". Edge prima di Chrome (il suo
 *  user agent contiene anche Chrome), CriOS e FxiOS sono Chrome e Firefox su iOS. */
export function etichettaDispositivo(ua = navigator.userAgent, ipad = eIPad()): string {
  const os = /iPhone|iPod/.test(ua) ? 'iPhone' : ipad || /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux|X11|CrOS/.test(ua) ? 'Linux' : 'Dispositivo';
  const br = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS|Chromium/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : '';
  return (br ? `${os} · ${br}` : os).slice(0, 60);
}

// ---------------------------------------------------------------- service worker e iscrizione del browser
/** La chiave pubblica VAPID (base64url) come la vuole pushManager.subscribe. Una chiave P-256 non compressa e' 65 byte
 *  e comincia con 0x04: altro = configurazione sbagliata, meglio fermarsi qui che con un errore oscuro del browser. */
export function chiaveVapid(b64: string | undefined): Uint8Array<ArrayBuffer> | null {
  if (!b64) return null;
  try {
    const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.length === 65 && out[0] === 4 ? out : null;
  } catch { return null; }
}
const stessaChiave = (a: ArrayBuffer, b: Uint8Array) => {
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

/** Registra (o ritrova e fa controllare l'aggiornamento di) sw.js e aspetta che sia attivo: pushManager.subscribe vuole
 *  un worker attivo. Si chiama all'apertura della scheda Notifiche, PRIMA del tocco su "Attiva": su iPhone Safari vuole
 *  subscribe dentro il gesto, e un await prima lo farebbe uscire dal gesto. updateViaCache 'none': sw.js non passa mai
 *  dalla cache HTTP del browser (GitHub Pages da' max-age=600 a tutto). Se l'iscrizione esistente e' legata a una chiave
 *  VAPID diversa (chiave ruotata) la si toglie qui: subscribe con la chiave nuova fallirebbe con InvalidStateError. */
export async function preparaRegistrazione(chiave: Uint8Array | null): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE, updateViaCache: 'none' });
  if (!reg) throw new Error('Il browser non ha registrato il servizio notifiche.');
  const pronta = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((ok) => setTimeout(() => ok(null), 15000)),
  ]);
  if (!pronta) throw new Error('Il servizio notifiche non si è avviato: chiudi e riapri l’app.');
  if (chiave) {
    const vecchia = await pronta.pushManager.getSubscription();
    const sua = vecchia?.options.applicationServerKey;
    if (vecchia && sua && !stessaChiave(sua, chiave)) await vecchia.unsubscribe();
  }
  return pronta;
}

/** Endpoint e chiavi come li vuole push-api (mai expirationTime e niente altro). */
export function datiIscrizione(sub: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const j = sub.toJSON();
  return { endpoint: sub.endpoint, keys: { p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' } };
}

// ---------------------------------------------------------------- push-api
async function token(): Promise<string> {
  const { data } = await csClient.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error('Sessione scaduta: rientra.');
  return t;
}

const MESSAGGI: Record<number, string> = {
  401: 'Sessione scaduta: rientra.',
  403: 'Questo account non può gestire le notifiche: serve una casella del team.',
  429: 'Aspetta un minuto prima di un’altra prova.',
  503: 'Il servizio notifiche non risponde: riprova fra poco.',
};

/** Una chiamata a push-api. lettura = config e dispositivi: su rete assente o 5xx si ritenta UNA volta (Regola Ferrea
 *  20 d). Le scritture (iscrivi, rinnova, temi, disiscrivi, rimuovi, prova) mai: un secondo giro potrebbe ripetere
 *  un'azione gia' fatta di cui si e' persa solo la risposta. */
async function chiama<T>(action: string, body: Record<string, unknown> = {}, lettura = false): Promise<T> {
  const t = await token();
  const una = () => fetch(`${FN}/functions/v1/push-api`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t },
    body: JSON.stringify({ action, ...body }),
  });
  let r: Response;
  try { r = await una(); }
  catch {
    if (!lettura) throw new Error('Rete assente: controlla la connessione e riprova.');
    try { r = await una(); } catch { throw new Error('Rete assente: controlla la connessione e riprova.'); }
  }
  if (lettura && r.status >= 500) {
    try { r = await una(); } catch { throw new Error('Rete assente: controlla la connessione e riprova.'); }
  }
  const j = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok || typeof j.error === 'string') {
    const dettaglio = typeof j.error === 'string' ? j.error : '';
    throw new Error(MESSAGGI[r.status] ?? (dettaglio || `Errore ${r.status} dal servizio notifiche.`));
  }
  return j as T;
}

export const pushConfig = () => chiama<PushConfig>('config', {}, true);
export const dispositivi = (device_id: string | null) =>
  chiama<{ dispositivi: Dispositivo[] } | Disattivo>('dispositivi', device_id ? { device_id } : {}, true);
export const iscrivi = (p: { chi: string; device_id: string; subscription: ReturnType<typeof datiIscrizione>; temi: string[]; etichetta: string }) =>
  chiama<{ ok: true; id: string } | Disattivo>('iscrivi', p);
export const rinnova = (device_id: string, sub: PushSubscription) =>
  chiama<{ ok: true; trovato: boolean } | Disattivo>('rinnova', { device_id, subscription: datiIscrizione(sub) });
export const salvaTemi = (device_id: string, temi: string[]) => chiama<{ ok: true; trovato: boolean } | Disattivo>('temi', { device_id, temi });
export const disiscrivi = (device_id: string) => chiama<{ ok: true; rimossi: number } | Disattivo>('disiscrivi', { device_id });
export const rimuovi = (id: string) => chiama<{ ok: true; rimossi: number } | Disattivo>('rimuovi', { id });
/** esito = la classe (ok, rimuovi, config, payload, limite, transitorio); messaggio = la frase italiana da mostrare. */
export const prova = (device_id: string) => chiama<{ ok: boolean; esito: string; messaggio?: string } | Disattivo>('prova', { device_id });

/** Risposta a flag spento (push-api risponde {enabled:false} a ogni azione utente). */
export const spento = (r: object): r is Disattivo => (r as { enabled?: unknown }).enabled === false;
