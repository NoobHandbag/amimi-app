// push-api v2 (2026-10-18, push-eventi): additiva. `invia` accetta `chi` facoltativo (Ale, Bene o Ginevra) e allora manda
// solo ai telefoni di quella persona (il riepilogo serale e' uno a testa); senza `chi` tutto come la v1. `config`
// restituisce anche `predefinito_per` di ogni tema (migr 0166: le persone per cui il tema parte spuntato all'iscrizione),
// quindi si deploya DOPO la 0166: prima la select di quella colonna fallirebbe e config risponderebbe 503.
// push-api v1 (2026-10-17): notifiche native dell'app (Web Push standard, VAPID, RFC 8030/8291/8292) al posto di ntfy.
// Brief: Cowork12/_CLAUDE_CODE_INBOX/2026-10-17_BRIEF_notifiche_native_web_push.md (sez. 4.2). Modulo push_* (Regola 19):
// scrive SOLO push_subscriptions, del core legge solo app_flags.push_enabled. A flag spento ogni azione utente risponde
// {enabled:false} e `invia` non manda niente: rollback = spegnere il flag.
//
// Autenticazione, due rami (verify_jwt = false in config.toml: il controllo lo fa la edge):
//   1) Bearer = SUPABASE_SERVICE_ROLE_KEY, confronto a tempo costante (nell'ambiente e' la sb_secret, CONOSCENZA 15-10):
//      ramo servizio, ammette SOLO `invia` (lo useranno le guardie nella PR B), 403 su ogni altra azione.
//   2) altrimenti getUser(token) + dominio del team, come cs-api; `invia` col JWT di una persona = 403.
//   Il PIN dell'app non vale mai: da qui partono notifiche verso telefoni veri.
//
// Azioni utente (POST JSON {action, ...}):
//   config      {}                                  -> {enabled, vapidPublicKey, temi:[{key, etichetta, descrizione, predefinito_per}]}
//   iscrivi     {chi, device_id, subscription:{endpoint, keys:{p256dh, auth}}, temi, etichetta} -> {ok, id}
//   rinnova     {device_id, subscription}           -> {ok, trovato}   (non tocca chi e temi)
//   temi        {device_id, temi}                   -> {ok, trovato}
//   disiscrivi  {device_id}                         -> {ok, rimossi}
//   dispositivi {device_id?}                        -> {dispositivi:[{id, chi, etichetta, temi, created_at, last_ok_at, last_status, questo}]}
//   rimuovi     {id}                                -> {ok, rimossi}
//   prova       {device_id}                         -> {ok, esito, messaggio}; 429 se l'ultima prova ha meno di un minuto
// Azione servizio:
//   invia       {tema, titolo, testo, url?, urgente?, dryRun?, chi?} -> {ok: inviati>=1, inviati, falliti, rimossi, destinatari, esiti}
//               tema spento o inesistente -> {ok:false, skipped:'tema_spento', inviati:0}; chi fuori dalle tre chiavi -> 422
//               La risposta (anche in dryRun) rimanda `chi` (la persona, o null = tutti): Gate 3 del 18-10 (RF-7), push-eventi
//               chiude come persa una push per una persona se la risposta non lo rimanda uguale (una push-api v1 manda a tutti).
// Endpoint e chiavi di un telefono non escono MAI da qui, ne' nelle risposte ne' nei log: bastano a mandargli notifiche.
// Dal 17-10 (Gate 2) nemmeno il device_id degli altri: e' l'unica chiave di rinnova, temi, disiscrivi e prova.
//
// Regola 20: ogni lettura destruttura `error`, ritenta UNA volta e chiude con 503; le scritture non si ritentano mai.
// npm:web-push@3.6.7 vive SOLO in questa edge e solo fuori dai blocchi PURE (i test non la caricano). Mai provata sul
// runtime Supabase: il primo collaudo e' una `prova` vera su Android e iPhone; se fallisce, ripiego jsr:@negrel/webpush.
// Blocchi PURE (confronto, host ammessi, validazione e chiavi VAPID, payload, esiti e loro effetto sulla riga, Topic,
// flag, giro di invio, elenco dispositivi): `node tests/push_core.mjs`.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// ==== PURE:push-confronto BEGIN ====
// Bearer contro la chiave di servizio: nessun ritorno dentro il ciclo e stesso numero di passi anche a lunghezze diverse,
// cosi' la durata del confronto non dice quanti caratteri sono giusti.
function ugualeCostante(a: string, b: string): boolean {
  const x = new TextEncoder().encode(String(a ?? '')), y = new TextEncoder().encode(String(b ?? ''));
  const n = Math.max(x.length, y.length);
  let d = x.length ^ y.length;
  for (let i = 0; i < n; i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return n > 0 && d === 0;
}
// ==== PURE:push-confronto END ====

// ==== PURE:push-endpoint BEGIN ====
// Anti-SSRF, a iscrizione E a invio: la edge fa una POST verso l'indirizzo che le passa il telefono, quindi accetta solo i
// servizi push veri (Google, Apple, Mozilla, Microsoft). Solo https, nessuna porta (nemmeno :443 scritto), nessuna
// credenziale nell'URL, host esatto o sottodominio col punto davanti: `evilpush.apple.com` e `fcm.googleapis.com.evil.com` no.
const HOST_PUSH_ESATTI = ['fcm.googleapis.com', 'web.push.apple.com'];
const HOST_PUSH_SUFFISSI = ['.push.apple.com', '.push.services.mozilla.com', '.notify.windows.com'];
const ENDPOINT_MAX = 2048;
function endpointAmmesso(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > ENDPOINT_MAX || /\s/.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '') return null;
  const host = u.hostname.toLowerCase();
  if (!host || host.startsWith('.') || host.includes('..')) return null;
  // il testo deve iniziare proprio con https://<host>/: cadono anche ":443" scritto, le barre rovesciate e le altre forme
  // che il parser normalizza in silenzio
  if (!s.toLowerCase().startsWith('https://' + host + '/')) return null;
  if (HOST_PUSH_ESATTI.includes(host) || HOST_PUSH_SUFFISSI.some((suf) => host.endsWith(suf))) return s;
  return null;
}
// ==== PURE:push-endpoint END ====

// ==== PURE:push-valida BEGIN ====
// chi = chiavi di PEOPLE del web (i nomi mostrati sono Ale, Benny, Ginni), come il check di push_subscriptions (migr 0163)
const CHI_AMMESSI = ['Ale', 'Bene', 'Ginevra'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMA_RE = /^[a-z_]{2,32}$/;
const TEMI_MAX = 32;
const ETICHETTA_MAX = 60;
const PROVA_OGNI_MS = 60000;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
// byte di una stringa base64url (il padding '=' e' tollerato e tolto); -1 se non e' base64url
function byteB64url(v: unknown): number {
  if (typeof v !== 'string') return -1;
  const s = v.trim().replace(/={1,2}$/, '');
  if (!B64URL_RE.test(s) || s.length % 4 === 1) return -1;
  return Math.floor((s.length * 3) / 4);
}
const senzaPadding = (s: string) => s.trim().replace(/={1,2}$/, '');
function byteDaB64url(s: string): Uint8Array | null {
  if (!B64URL_RE.test(s) || s.length % 4 === 1) return null;
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const b64urlDaByte = (a: Uint8Array) => btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// Punto P-256 non compresso (0x04 || x || y) che sta DAVVERO sulla curva: y^2 = x^3 - 3x + b mod p (Gate 2, 17-10). 65 byte
// che iniziano per 0x04 non bastano: con un punto fuori curva web-push lancia a ogni invio, l'errore conta come
// transitorio e la riga non verrebbe mai tolta.
const P256_P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
const P256_B = BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b');
function puntoP256(v: unknown): boolean {
  const b = typeof v === 'string' ? byteDaB64url(v) : null;
  if (!b || b.length !== 65 || b[0] !== 4) return false;
  const n = (a: Uint8Array) => BigInt('0x' + Array.from(a, (x) => x.toString(16).padStart(2, '0')).join(''));
  const x = n(b.subarray(1, 33)), y = n(b.subarray(33, 65));
  if (x >= P256_P || y >= P256_P) return false;
  return (y * y - (x * x * x - BigInt(3) * x + P256_B)) % P256_P === BigInt(0);
}
function normDevice(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return UUID_RE.test(s) ? s : null;
}
// testo libero del telefono: caratteri di controllo -> spazio, spazi compressi, taglio per punti di codice (un'emoji non
// si spezza a meta')
function normEtichetta(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = Array.from(v, (c) => { const k = c.codePointAt(0) ?? 0; return k < 32 || k === 127 ? ' ' : c; }).join('').replace(/\s+/g, ' ').trim();
  return s ? Array.from(s).slice(0, ETICHETTA_MAX).join('').trim() : null;
}
// temi assenti = nessun tema; altrimenti chiavi valide senza doppioni, nell'ordine del telefono. Che siano temi ATTIVI lo
// decide la edge leggendo push_temi solo per queste chiavi (Regola 20b, mai la tabella intera).
function normTemi(v: unknown): string[] | null {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > TEMI_MAX) return null;
  const out: string[] = [];
  for (const t of v) {
    if (typeof t !== 'string' || !TEMA_RE.test(t)) return null;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}
function temiNonAmmessi(temi: string[], ammessi: string[]): string[] {
  const ok = new Set(ammessi);
  return temi.filter((t) => !ok.has(t));
}
type Sub = { endpoint: string; p256dh: string; auth: string };
// p256dh = punto P-256 non compresso sulla curva (65 byte, il primo e' 0x04); auth = 16 byte.
// Sono i controlli che web-push farebbe all'invio: qui una chiave rotta non entra nemmeno.
function validaSubscription(v: unknown): { ok: true; sub: Sub } | { ok: false; error: string } {
  const o = (v && typeof v === 'object' ? v : {}) as { endpoint?: unknown; keys?: unknown };
  const endpoint = endpointAmmesso(o.endpoint);
  if (!endpoint) return { ok: false, error: 'endpoint non ammesso' };
  const k = (o.keys && typeof o.keys === 'object' ? o.keys : {}) as { p256dh?: unknown; auth?: unknown };
  if (typeof k.p256dh !== 'string' || !puntoP256(senzaPadding(k.p256dh))) return { ok: false, error: 'chiave p256dh non valida' };
  if (byteB64url(k.auth) !== 16) return { ok: false, error: 'chiave auth non valida' };
  return { ok: true, sub: { endpoint, p256dh: senzaPadding(k.p256dh), auth: senzaPadding(String(k.auth)) } };
}
type Iscrizione = Sub & { chi: string; device_id: string; temi: string[]; etichetta: string | null };
function validaIscrizione(b: Record<string, unknown>): { ok: true; val: Iscrizione } | { ok: false; error: string } {
  const chi = typeof b.chi === 'string' ? b.chi : '';
  if (!CHI_AMMESSI.includes(chi)) return { ok: false, error: 'chi non valido (Ale, Bene o Ginevra)' };
  const device_id = normDevice(b.device_id);
  if (!device_id) return { ok: false, error: 'device_id non valido' };
  const s = validaSubscription(b.subscription);
  if (!s.ok) return s;
  const temi = normTemi(b.temi);
  if (!temi) return { ok: false, error: 'temi non validi' };
  return { ok: true, val: { ...s.sub, chi, device_id, temi, etichetta: normEtichetta(b.etichetta) } };
}
// chiavi VAPID dall'ambiente: '' se a posto, altrimenti il motivo (config lo restituisce, invia e prova chiudono con 503).
// Una chiave rotta fermata qui non arriva a web-push, che altrimenti lancerebbe su ogni telefono. Il carattere ammesso e'
// quello di web-push (/^[A-Za-z0-9_-]+$/, niente '='): una chiave che passa qui passa anche li' (Gate 2, 17-10).
function controllaVapid(pub: string, priv: string, subject: string): string {
  if (!pub || !priv) return 'chiavi VAPID mancanti';
  if (!B64URL_RE.test(pub) || !B64URL_RE.test(priv)) return 'chiavi VAPID con padding o caratteri non base64url';
  if (byteB64url(pub) !== 65 || !puntoP256(pub)) return 'VAPID_PUBLIC_KEY non valida';
  if (byteB64url(priv) !== 32) return 'VAPID_PRIVATE_KEY non valida';
  if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject) && !/^https:\/\/[^\s/]+\.[^\s]+$/.test(subject)) return 'VAPID_SUBJECT non valido';
  return '';
}
const SUBJECT_DEFAULT = 'mailto:info@amimi.it';
type Vapid = { publicKey: string; privateKey: string; subject: string };
// I segreti cosi' come arrivano: il padding '=' (generatori Python, copia a mano) si toglie qui, prima del controllo e
// prima di web-push, cosi' una chiave giusta col padding funziona invece di far fallire ogni invio come "transitorio".
function vapidDa(pub: unknown, priv: unknown, subject: unknown): { vapid: Vapid | null; motivo: string } {
  const publicKey = senzaPadding(String(pub ?? '')), privateKey = senzaPadding(String(priv ?? ''));
  const s = String(subject ?? '').trim() || SUBJECT_DEFAULT;
  const motivo = controllaVapid(publicKey, privateKey, s);
  return { vapid: motivo ? null : { publicKey, privateKey, subject: s }, motivo };
}
// La chiave pubblica e' DAVVERO quella della privata? Si firma un testo fisso con la privata (JWK d + x, y della pubblica)
// e si verifica con la pubblica. Senza questo controllo una pubblica incollata da un'altra coppia passerebbe: config la
// darebbe ai telefoni e ogni invio verrebbe rifiutato dal servizio push (Gate 2, 17-10). Una chiave che WebCrypto rifiuta
// (fuori intervallo, x e y che non vanno con d) non e' una coppia usabile: false.
async function coppiaVapidCoerente(pub: string, priv: string, segnala?: (nome: string) => void): Promise<boolean> {
  const p = byteDaB64url(pub);
  if (!p || p.length !== 65 || p[0] !== 4 || !B64URL_RE.test(priv)) return false;
  const alg = { name: 'ECDSA', namedCurve: 'P-256' };
  const firmaAlg = { name: 'ECDSA', hash: 'SHA-256' };
  const testo = new TextEncoder().encode('amimi push-api coppia VAPID');
  try {
    const privata = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: priv, x: b64urlDaByte(p.subarray(1, 33)), y: b64urlDaByte(p.subarray(33, 65)) }, alg, false, ['sign']);
    const pubblica = await crypto.subtle.importKey('raw', p, alg, false, ['verify']);
    return await crypto.subtle.verify(firmaAlg, pubblica, await crypto.subtle.sign(firmaAlg, privata, testo), testo);
  } catch (e) {
    // chiave rifiutata oppure runtime che non sa importarla: in tutti e due i casi il modulo resta chiuso, ma `segnala`
    // (il log, fuori dal blocco) dice quale (Gate 3, 17-10: senza, si ruoterebbero le chiavi per niente). Solo il nome.
    segnala?.(String((e as { name?: unknown })?.name ?? 'errore'));
    return false;
  }
}
async function vapidControllato(pub: unknown, priv: unknown, subject: unknown, segnala?: (nome: string) => void): Promise<{ vapid: Vapid | null; motivo: string }> {
  const r = vapidDa(pub, priv, subject);
  if (!r.vapid) return r;
  if (!(await coppiaVapidCoerente(r.vapid.publicKey, r.vapid.privateKey, segnala))) return { vapid: null, motivo: 'VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY non sono la stessa coppia (o WebCrypto non le accetta: vedi i log)' };
  return r;
}
// una prova al minuto per telefono; scarto assoluto, cosi' una data futura scritta per sbaglio non blocca per sempre
function provaTroppoPresto(lastTestAt: unknown, ora: number): boolean {
  if (typeof lastTestAt !== 'string' || !lastTestAt) return false;
  const t = Date.parse(lastTestAt);
  return Number.isFinite(t) && Math.abs(ora - t) < PROVA_OGNI_MS;
}
// ==== PURE:push-valida END ====

// ==== PURE:push-destinatari BEGIN ====
// v2 (18-10, push-eventi). `chi` di invia: assente, null o vuoto = tutti gli iscritti al tema (la v1, ce-guard e
// sales-guard); altrimenti una delle tre chiavi esatte, e la lettura delle iscrizioni filtra su quella sola. Un valore
// sbagliato e' un errore, mai un ripiego su "tutti": il riepilogo di una persona finirebbe sui telefoni degli altri.
// Il filtro e' sempre una lista per `.in('chi', ...)`: senza chi sono le tre chiavi del check di push_subscriptions.
function chiDestinatario(v: unknown): { ok: true; filtro: string[]; chi: string | null } | { ok: false } {
  if (v === undefined || v === null || v === '') return { ok: true, filtro: [...CHI_AMMESSI], chi: null };
  if (typeof v === 'string' && CHI_AMMESSI.includes(v)) return { ok: true, filtro: [v], chi: v };
  return { ok: false };
}
// Temi per config, campo per campo. predefinito_per (migr 0166) arriva come text[]: qui restano solo le tre chiavi, una
// volta sola, nell'ordine della riga; assente o non array = nessuno (la scheda allora spunta tutti, come prima).
function vistaTemi(righe: unknown): { key: unknown; etichetta: unknown; descrizione: unknown; predefinito_per: string[] }[] {
  return (Array.isArray(righe) ? righe : []).map((x) => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const p = Array.isArray(r.predefinito_per) ? r.predefinito_per.filter((c): c is string => typeof c === 'string' && CHI_AMMESSI.includes(c)) : [];
    return { key: r.key, etichetta: r.etichetta, descrizione: r.descrizione, predefinito_per: [...new Set(p)] };
  });
}
// ==== PURE:push-destinatari END ====

// ==== PURE:push-payload BEGIN ====
// Declarative Web Push (WebKit): JSON con web_push 8030, che Safari 18.4+ mostra anche senza service worker; gli altri
// browser lo passano a sw.js. Sotto i 3.000 byte: i servizi push garantiscono 4.096 byte di messaggio CIFRATO (RFC 8030)
// e cifratura e intestazione ne prendono circa 100. Si taglia il testo, mai il JSON, e mai a meta' di un'emoji.
// mutable: true in cima (Gate 2, 17-10): senza, iOS 18.4+ mostra la notifica da solo e non sveglia sw.js, e il tocco
// naviga verso `navigate` senza notificationclick (niente amimi-apri, e con l'app aperta backnav lo legge come "indietro").
// Con mutable l'evento push arriva a sw.js con event.notification (event.data e' null): sw.js lo legge per primo.
const APP_URL = 'https://noobhandbag.github.io/amimi-app/';
const APP_ORIGIN = 'https://noobhandbag.github.io';
const PAYLOAD_MAX = 3000;
const TITOLO_MAX = 120;
const URL_MAX = 1000;
const TITOLO_DEFAULT = 'Amimì';
function pulisciTesto(v: unknown): string {
  if (typeof v !== 'string') return '';
  return Array.from(v, (c) => { const k = c.codePointAt(0) ?? 0; return (k < 32 && k !== 10) || k === 127 ? ' ' : c; }).join('').trim();
}
// navigate sempre dentro l'app: un relativo ('#notifiche') si risolve sulla radice, tutto il resto diventa la radice
function navigaSicuro(v: unknown): string {
  if (typeof v !== 'string' || !v.trim() || v.length > URL_MAX) return APP_URL;
  try {
    const u = new URL(v.trim(), APP_URL);
    if (u.origin === APP_ORIGIN && u.username === '' && u.password === '' && u.href.startsWith(APP_URL) && u.href.length <= URL_MAX) return u.href;
  } catch { /* URL illeggibile: radice */ }
  return APP_URL;
}
const tagliaCp = (s: string, n: number) => Array.from(s).slice(0, n).join('');
function costruisciPayload(p: { titolo?: unknown; testo?: unknown; url?: unknown }): string {
  const enc = new TextEncoder();
  const titolo = tagliaCp(pulisciTesto(p.titolo).replace(/\n+/g, ' '), TITOLO_MAX).trim() || TITOLO_DEFAULT;
  const navigate = navigaSicuro(p.url);
  const crea = (body: string) => JSON.stringify({ web_push: 8030, mutable: true, notification: { title: titolo, body, navigate, lang: 'it' } });
  const sta = (s: string) => enc.encode(s).length < PAYLOAD_MAX;
  const testo = pulisciTesto(p.testo);
  if (sta(crea(testo))) return crea(testo);
  // ricerca binaria sui punti di codice del testo: i byte crescono col prefisso, si tiene il piu' lungo che sta
  const cp = Array.from(testo);
  let lo = 0, hi = cp.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (sta(crea(cp.slice(0, mid).join('') + '...'))) lo = mid; else hi = mid - 1;
  }
  return crea(cp.slice(0, lo).join('').trimEnd() + '...');
}
// ==== PURE:push-payload END ====

// ==== PURE:push-esito BEGIN ====
// Cosa fare dopo una consegna, dal codice HTTP del servizio push (brief 4.2):
//   2xx ok | 404/410 iscrizione morta: si cancella | 400/403 con VapidPkHashMismatch (Apple) o "do not correspond" (FCM):
//   iscrizione nata con un'altra chiave VAPID, non tornera' valida: si cancella | altri 401/403: errore NOSTRO di
//   configurazione, la riga resta | 413 payload | 429 il servizio chiede di rallentare: si ferma il giro | il resto
//   (5xx, 400 generico, rete, timeout) e' transitorio: fail_count + 1.
type Esito = 'ok' | 'rimuovi' | 'config' | 'payload' | 'limite' | 'transitorio';
function esitoInvio(status: unknown, corpo: unknown): Esito {
  const s = typeof status === 'number' && Number.isFinite(status) ? status : 0;
  let testo = '';
  if (typeof corpo === 'string') testo = corpo;
  else if (corpo != null) { try { testo = JSON.stringify(corpo) ?? ''; } catch { testo = ''; } }
  if (s >= 200 && s < 300) return 'ok';
  if (s === 404 || s === 410) return 'rimuovi';
  if ((s === 400 || s === 403) && (testo.includes('VapidPkHashMismatch') || /do not correspond/i.test(testo))) return 'rimuovi';
  if (s === 401 || s === 403) return 'config';
  if (s === 413) return 'payload';
  if (s === 429) return 'limite';
  return 'transitorio';
}
const MESSAGGI_ESITO: Record<Esito, string> = {
  ok: 'Prova inviata: la notifica arriva di solito in pochi secondi.',
  rimuovi: 'Il servizio push non riconosce piu\' questo telefono e l\'iscrizione e\' stata tolta: riattiva le notifiche.',
  config: 'Il servizio push rifiuta le chiavi del server: la prova non e\' partita, va controllata la configurazione.',
  payload: 'Il servizio push ha rifiutato il messaggio perche\' troppo grande.',
  limite: 'Il servizio push chiede di rallentare: riprova fra qualche minuto.',
  transitorio: 'Il servizio push non ha risposto come doveva: riprova fra poco.',
};
// Effetto dell'esito sulla riga, deciso QUI e non dentro registraEsito (Gate 2, 17-10: la mappa esito -> cancella non
// era testata). Solo 'rimuovi' cancella; 'ok' azzera fail_count; 'transitorio' lo aumenta di uno; config, payload e
// limite lasciano fail_count com'e' (errore nostro o del messaggio, non del telefono). last_status 0 = nessuna risposta HTTP.
function azioneEsito(esito: Esito, status: number | null, failCount: unknown, nowIso: string): { cancella: boolean; patch: Record<string, unknown> } {
  if (esito === 'rimuovi') return { cancella: true, patch: {} };
  const patch: Record<string, unknown> = { last_status: typeof status === 'number' && Number.isFinite(status) ? status : 0, updated_at: nowIso };
  if (esito === 'ok') { patch.last_ok_at = nowIso; patch.fail_count = 0; }
  if (esito === 'transitorio') patch.fail_count = (typeof failCount === 'number' && Number.isFinite(failCount) ? failCount : 0) + 1;
  return { cancella: false, patch };
}
// Riga di log di un invio non riuscito (Gate 2, 17-10: prima il motivo si perdeva e un guasto della libreria sembrava
// rete). Ogni URL diventa [url] PRIMA del taglio: gli errori di rete riportano l'endpoint intero, che basta a mandare
// notifiche a quel telefono. Caratteri di controllo tolti, al massimo 200 punti di codice di testo. Non lancia mai.
const RIASSUNTO_MAX = 200;
function riassuntoErrore(nome: unknown, status: unknown, corpo: unknown): string {
  try {
    const testo = (v: unknown): string => {
      if (typeof v === 'string') return v;
      if (v == null) return '';
      try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
    };
    const pulito = (v: unknown) => Array.from(testo(v).replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi, '[url]'), (c) => {
      const k = c.codePointAt(0) ?? 0;
      return k < 32 || (k >= 127 && k <= 159) || k === 8232 || k === 8233 ? ' ' : c;
    }).join('').replace(/\s+/g, ' ').trim();
    const n = Array.from(pulito(nome)).slice(0, 60).join('') || 'Errore';
    const s = typeof status === 'number' && Number.isFinite(status) ? String(status) : 'nessuna risposta HTTP';
    const t = Array.from(pulito(corpo)).slice(0, RIASSUNTO_MAX).join('');
    return `${n} (${s})${t ? ': ' + t : ''}`;
  } catch {
    return 'errore non descrivibile';
  }
}
// ==== PURE:push-esito END ====

// ==== PURE:push-topic BEGIN ====
// Header Topic (RFC 8030 5.4): una notifica non ancora consegnata viene SOSTITUITA dalla successiva con lo stesso Topic
// (telefono spento: al risveglio arriva l'ultimo avviso di quel tema, non la fila). Solo caratteri base64url e al massimo
// 32, altrimenti web-push lancia: il tema si riduce invece di far fallire l'invio.
function topicDi(tema: unknown): string | undefined {
  const t = String(tema ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  return t || undefined;
}
// ==== PURE:push-topic END ====

// ==== PURE:push-flag BEGIN ====
// Il rollback del modulo (Regola 19) e' questo: acceso SOLO con la stringa 'true' (maiuscole e spazi tollerati; app_flags.value
// e' text, migr 0013). Riga assente, valore vuoto o qualunque altra cosa = spento. Fuori da flagAcceso perche' un refactor
// che apre per sbaglio (`!== 'false'`, default 'true') si veda nei test (Gate 2, 17-10).
function flagVero(v: unknown): boolean {
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}
// ==== PURE:push-flag END ====

// ==== PURE:push-giro BEGIN ====
// Il giro di invia, con spedizione e registrazione passate da fuori (Gate 2, 17-10: conteggi, stop al 429 e tetto di
// tempo erano scritti solo nel sorgente). In sequenza: un 429 ferma il giro e i telefoni rimasti contano come falliti,
// come quelli oltre il tetto di tempo; un host non ammesso non parte e non tocca la riga; ok solo se almeno uno e' arrivato.
type Spedito = { status: number | null; corpo: string; nome: string };
type Giro<R> = { spedisci: (r: R) => Promise<Spedito>; registra: (r: R, esito: Esito, res: Spedito) => Promise<boolean>; adesso: () => number; fine: number };
async function giroInvio<R extends { endpoint: string }>(lista: R[], deps: Giro<R>): Promise<{ ok: boolean; inviati: number; falliti: number; rimossi: number; esiti: Record<string, number>; fermato: string }> {
  const esiti: Record<string, number> = {};
  let inviati = 0, falliti = 0, rimossi = 0, fermato = '';
  for (const r of lista) {
    if (!fermato && deps.adesso() > deps.fine) fermato = 'tempo';
    if (fermato) { falliti++; continue; }
    if (!endpointAmmesso(r.endpoint)) { falliti++; esiti.host_non_ammesso = (esiti.host_non_ammesso ?? 0) + 1; continue; }
    const res = await deps.spedisci(r);
    const esito = esitoInvio(res.status, res.corpo);
    esiti[esito] = (esiti[esito] ?? 0) + 1;
    if (esito === 'ok') inviati++; else falliti++;
    if (await deps.registra(r, esito, res)) rimossi++;
    if (esito === 'limite') fermato = 'limite';
  }
  return { ok: inviati >= 1, inviati, falliti, rimossi, esiti, fermato };
}
// ==== PURE:push-giro END ====

// ==== PURE:push-dispositivi BEGIN ====
// Elenco dei telefoni per la scheda: campi scelti uno per uno (se un domani la select prende di piu', qui non passa).
// device_id non esce (Gate 2, 17-10: e' l'unica chiave di rinnova, temi, disiscrivi e prova, e con quello di un altro
// telefono si dirottano le sue notifiche): il telefono manda il suo e riceve `questo` sulla propria riga. device_id
// assente o non uuid: nessuna riga e' `questo`.
function vistaDispositivi(righe: unknown, mio: string | null): { id: unknown; chi: unknown; etichetta: unknown; temi: unknown; created_at: unknown; last_ok_at: unknown; last_status: unknown; questo: boolean }[] {
  return (Array.isArray(righe) ? righe : []).map((x) => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    return { id: r.id, chi: r.chi, etichetta: r.etichetta, temi: r.temi, created_at: r.created_at, last_ok_at: r.last_ok_at, last_status: r.last_status,
      questo: mio !== null && typeof r.device_id === 'string' && r.device_id.toLowerCase() === mio };
  });
}
// ==== PURE:push-dispositivi END ====

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
// Chi entra col JWT: gli account del team. Stessa lista di public.email_del_team (migr 0161) e di DOMINI_TEAM del web
// (tests/dominio_team.mjs controlla che coincidano).
const EMAIL_TEAM = /@(?:amimi\.it|telaioconsulting\.com)$/;
// PostgREST risponde 504 anche su letture banali: una lettura e' idempotente, UN ritentativo dopo 1,5 s, mai sulle scritture
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn(); if (!r.error) return r; await sleep(1500); return await fn();
};
// lettura fallita anche dopo il ritentativo: 503 e nessuna scrittura, mai un default vuoto al suo posto (Regola 20a)
class ReadError extends Error {}

type Sb = ReturnType<typeof createClient>;
type Riga = { id: string; endpoint: string; p256dh: string; auth: string; fail_count: number | null };

const AZIONI_UTENTE = ['config', 'iscrivi', 'rinnova', 'temi', 'disiscrivi', 'dispositivi', 'rimuovi', 'prova'];
const MAX_ISCRIZIONI = 30;
const TTL_INVIO = 86400;
const TTL_PROVA = 300;
const TIMEOUT_INVIO_MS = 10000;
// tetto di durata del giro di invia: oltre, i telefoni rimasti contano come falliti e il chiamante lo vede in `fermato`
const GIRO_MAX_MS = 100000;

// La coppia VAPID si verifica una volta per isolate (una firma e una verifica): si rifa' solo se i segreti letti cambiano.
let vapidVisto: { segreti: string; esito: Promise<{ vapid: Vapid | null; motivo: string }> } | null = null;
function vapidDaEnv(): Promise<{ vapid: Vapid | null; motivo: string }> {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY') ?? '', priv = Deno.env.get('VAPID_PRIVATE_KEY') ?? '', subject = Deno.env.get('VAPID_SUBJECT') ?? '';
  const segreti = [pub, priv, subject].join('\n');
  if (vapidVisto?.segreti !== segreti) vapidVisto = { segreti, esito: vapidControllato(pub, priv, subject, (nome) => console.error('push-api: verifica della coppia VAPID non eseguita', nome)) };
  return vapidVisto.esito;
}

async function flagAcceso(sb: Sb): Promise<boolean> {
  const { data, error } = await retryOnce(() => sb.from('app_flags').select('key, value').in('key', ['push_enabled']));
  if (error) throw new ReadError('flag non leggibile, riprova');
  const riga = ((data ?? []) as { key: string; value: unknown }[]).find((r) => r.key === 'push_enabled');
  return flagVero(riga?.value);
}

// solo i temi richiesti, e solo se attivi: una chiave spenta o inesistente torna fuori da temiNonAmmessi
async function temiAttivi(sb: Sb, temi: string[]): Promise<string[]> {
  if (!temi.length) return [];
  const { data, error } = await retryOnce(() => sb.from('push_temi').select('key').in('key', temi).eq('attivo', true));
  if (error) throw new ReadError('temi non leggibili, riprova');
  return ((data ?? []) as { key: string }[]).map((r) => String(r.key));
}

// UNICO punto che chiama la libreria; il payload arriva gia' costruito da costruisciPayload. Un errore senza codice HTTP
// (rete, timeout, libreria) torna con status null e finisce fra i transitori; nome e testo servono solo al log.
async function spedisci(r: Riga, payload: string, o: { ttl: number; urgency: string; topic: string | undefined }, v: Vapid): Promise<Spedito> {
  try {
    const res = await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload, {
      vapidDetails: { subject: v.subject, publicKey: v.publicKey, privateKey: v.privateKey },
      TTL: o.ttl, urgency: o.urgency, topic: o.topic, contentEncoding: 'aes128gcm', timeout: TIMEOUT_INVIO_MS,
    });
    return { status: res.statusCode, corpo: '', nome: '' };
  } catch (e) {
    const err = (e && typeof e === 'object' ? e : { message: e }) as { name?: unknown; statusCode?: unknown; body?: unknown; message?: unknown };
    return { status: typeof err.statusCode === 'number' ? err.statusCode : null, corpo: String(err.body ?? err.message ?? '').slice(0, 500), nome: String(err.name ?? '') };
  }
}

// Esito sulla riga, una scrittura sola e mai ritentata; cosa scrivere lo decide azioneEsito. Filtro su id E endpoint
// (Gate 2, 17-10): se nel frattempo rinnova ha messo un endpoint nuovo sulla stessa riga, il 410 del vecchio non la
// cancella e l'esito del vecchio non finisce sul nuovo. Una scrittura fallita dopo una consegna non annulla la consegna:
// si scrive nei log della edge e il giro continua. Ritorna true se la riga e' stata cancellata davvero.
async function registraEsito(sb: Sb, r: Riga, esito: Esito, status: number | null): Promise<boolean> {
  const a = azioneEsito(esito, status, r.fail_count, new Date().toISOString());
  if (a.cancella) {
    const { data, error } = await sb.from('push_subscriptions').delete().eq('id', r.id).eq('endpoint', r.endpoint).select('id');
    if (error) console.error('push-api: cancellazione non riuscita', r.id, error.message);
    return !error && (data ?? []).length > 0;
  }
  const { error } = await sb.from('push_subscriptions').update(a.patch).eq('id', r.id).eq('endpoint', r.endpoint);
  if (error) console.error('push-api: esito non registrato', r.id, error.message);
  return false;
}

// Dopo ogni invio (invia e prova): un invio non riuscito lascia una riga di log col motivo ripulito, poi l'esito va
// sulla riga. Nel log solo l'id della riga: mai endpoint, p256dh, auth o la riga intera.
async function chiudiInvio(sb: Sb, r: Riga, esito: Esito, res: Spedito): Promise<boolean> {
  if (esito !== 'ok') console.error('push-api: invio non riuscito', JSON.stringify({ id: r.id, esito, motivo: riassuntoErrore(res.nome, res.status, res.corpo) }));
  return await registraEsito(sb, r, esito, res.status);
}

// Ramo servizio. Un tema, al massimo 50 telefoni: la lettura ne prende 51 e oltre 50 si ferma (nessun troncamento muto).
async function inviaTema(sb: Sb, body: Record<string, unknown>): Promise<Response> {
  if (!(await flagAcceso(sb))) return json({ ok: false, skipped: 'disabled', inviati: 0 });
  const tema = typeof body.tema === 'string' ? body.tema.trim() : '';
  if (!TEMA_RE.test(tema)) return json({ error: 'tema non valido' }, 422);
  if (!pulisciTesto(body.titolo) && !pulisciTesto(body.testo)) return json({ error: 'titolo o testo mancanti' }, 422);
  const dest = chiDestinatario(body.chi);
  if (!dest.ok) return json({ error: 'chi non valido (Ale, Bene o Ginevra)' }, 422);
  // tema spento (push_temi.attivo = false) o inesistente: niente invio (Gate 2, 17-10). Prima un tema tolto dalla scheda
  // continuava ad arrivare ai telefoni che l'avevano gia', senza piu' la casella per toglierlo.
  if (!(await temiAttivi(sb, [tema])).includes(tema)) return json({ ok: false, skipped: 'tema_spento', inviati: 0 });
  const { vapid, motivo } = await vapidDaEnv();
  if (!vapid) return json({ error: motivo }, 503);
  const { data: righe, error } = await retryOnce(() => sb.from('push_subscriptions').select('id, endpoint, p256dh, auth, fail_count').contains('temi', [tema]).in('chi', dest.filtro).order('created_at', { ascending: true }).limit(51));
  if (error) throw new ReadError('iscrizioni non leggibili, riprova');
  const lista = (righe ?? []) as Riga[];
  if (lista.length > 50) return json({ ok: false, error: `oltre 50 telefoni iscritti al tema ${tema}: invio fermato`, inviati: 0 }, 503);
  const destinatari = lista.length;
  const payload = costruisciPayload({ titolo: body.titolo, testo: body.testo, url: body.url });
  if (body.dryRun === true) return json({ ok: destinatari >= 1, dryRun: true, inviati: 0, falliti: 0, rimossi: 0, destinatari, chi: dest.chi });

  const opz = { ttl: TTL_INVIO, urgency: body.urgente === true ? 'high' : 'normal', topic: topicDi(tema) };
  const g = await giroInvio(lista, {
    spedisci: (r) => spedisci(r, payload, opz, vapid),
    registra: (r, esito, res) => chiudiInvio(sb, r, esito, res),
    adesso: Date.now,
    fine: Date.now() + GIRO_MAX_MS,
  });
  console.log(JSON.stringify({ azione: 'invia', tema, chi: dest.chi ?? 'tutti', destinatari, inviati: g.inviati, falliti: g.falliti, rimossi: g.rimossi, esiti: g.esiti, fermato: g.fermato }));
  return json({ ok: g.ok, inviati: g.inviati, falliti: g.falliti, rimossi: g.rimossi, destinatari, esiti: g.esiti, chi: dest.chi, ...(g.fermato ? { fermato: g.fermato } : {}) });
}

Deno.serve(async (req) => {
  try { return await handle(req); } catch (e) {
    if (e instanceof ReadError) return json({ error: e.message }, 503);
    throw e;
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const raw = await req.json().catch(() => null);
  const body: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const action = typeof body.action === 'string' ? body.action : '';
  if (action !== 'invia' && !AZIONI_UTENTE.includes(action)) return json({ error: 'azione sconosciuta' }, 400);

  // 1) autorizzazione
  const authz = req.headers.get('Authorization') || '';
  const token = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
  if (!token) return json({ error: 'non autenticato' }, 401);
  const sb = createClient(url, svc);
  if (ugualeCostante(token, svc)) {
    if (action !== 'invia') return json({ error: 'chiave di servizio ammessa solo per invia' }, 403);
    return await inviaTema(sb, body);
  }
  const { data: ures, error: uerr } = await createClient(url, anon).auth.getUser(token);
  const user = ures?.user;
  if (uerr || !user) return json({ error: 'sessione non valida' }, 401);
  const email = (user.email || '').toLowerCase();
  if (!EMAIL_TEAM.test(email)) return json({ error: 'dominio non ammesso' }, 403);
  if (action === 'invia') return json({ error: 'invia si chiama solo con la chiave di servizio' }, 403);

  // 2) flag: a modulo spento nessuna lettura e nessuna scrittura delle tabelle push_*
  if (!(await flagAcceso(sb))) return json({ enabled: false });
  const ora = new Date().toISOString();

  if (action === 'config') {
    const { vapid, motivo } = await vapidDaEnv();
    if (!vapid) return json({ enabled: false, reason: motivo });
    const { data, error } = await retryOnce(() => sb.from('push_temi').select('key, etichetta, descrizione, predefinito_per').eq('attivo', true).order('ordine', { ascending: true }).order('key', { ascending: true }).limit(100));
    if (error) throw new ReadError('temi non leggibili, riprova');
    return json({ enabled: true, vapidPublicKey: vapid.publicKey, temi: vistaTemi(data) });
  }

  if (action === 'iscrivi') {
    const v = validaIscrizione(body);
    if (!v.ok) return json({ error: v.error }, 422);
    const it = v.val;
    const fuori = temiNonAmmessi(it.temi, await temiAttivi(sb, it.temi));
    if (fuori.length) return json({ error: 'temi non disponibili: ' + fuori.join(', ') }, 422);
    // tetto di 30 righe: conta solo una riga NUOVA, chi rinnova il proprio telefono passa anche a tetto pieno
    const { count, error: cErr } = await retryOnce(() => sb.from('push_subscriptions').select('id', { count: 'exact', head: true }));
    if (cErr || count == null) throw new ReadError('iscrizioni non contabili, riprova');
    if (count >= MAX_ISCRIZIONI) {
      const { data: perDevice, error: dErr } = await retryOnce(() => sb.from('push_subscriptions').select('id').eq('device_id', it.device_id).maybeSingle());
      const { data: perEndpoint, error: eErr } = await retryOnce(() => sb.from('push_subscriptions').select('id').eq('endpoint', it.endpoint).maybeSingle());
      if (dErr || eErr) throw new ReadError('iscrizioni non leggibili, riprova');
      if (!perDevice && !perEndpoint) return json({ error: `ci sono gia' ${MAX_ISCRIZIONI} telefoni iscritti: rimuovine uno dall'elenco` }, 422);
    }
    // su iOS getSubscription() puo' tornare null mentre il vecchio endpoint consegna ancora: lo stesso telefono con un
    // endpoint nuovo SOSTITUISCE la sua riga (via quella vecchia, poi upsert sull'endpoint), non la duplica
    const { error: delErr } = await sb.from('push_subscriptions').delete().eq('device_id', it.device_id).neq('endpoint', it.endpoint);
    if (delErr) return json({ error: 'scrittura fallita: ' + delErr.message }, 500);
    const { data: up, error: upErr } = await sb.from('push_subscriptions').upsert({ endpoint: it.endpoint, p256dh: it.p256dh, auth: it.auth, device_id: it.device_id, chi: it.chi, temi: it.temi, etichetta: it.etichetta, user_email: email, updated_at: ora, last_seen_at: ora, last_status: null, fail_count: 0 }, { onConflict: 'endpoint' }).select('id').single();
    if (upErr) return json({ error: 'scrittura fallita: ' + upErr.message }, 500);
    return json({ ok: true, id: up.id });
  }

  if (action === 'rinnova') {
    const deviceId = normDevice(body.device_id);
    if (!deviceId) return json({ error: 'device_id non valido' }, 422);
    const s = validaSubscription(body.subscription);
    if (!s.ok) return json({ error: s.error }, 422);
    // un UPDATE filtrato sul device: se la riga non c'e' non crea niente (trovato:false) e non tocca chi e temi
    const { data, error } = await sb.from('push_subscriptions').update({ endpoint: s.sub.endpoint, p256dh: s.sub.p256dh, auth: s.sub.auth, last_seen_at: ora, updated_at: ora }).eq('device_id', deviceId).select('id');
    if (error) return error.code === '23505' ? json({ error: 'questo endpoint e\' gia\' iscritto con un altro telefono' }, 422) : json({ error: 'scrittura fallita: ' + error.message }, 500);
    return json({ ok: true, trovato: (data ?? []).length > 0 });
  }

  if (action === 'temi') {
    const deviceId = normDevice(body.device_id);
    if (!deviceId) return json({ error: 'device_id non valido' }, 422);
    const temi = normTemi(body.temi);
    if (!temi) return json({ error: 'temi non validi' }, 422);
    const fuori = temiNonAmmessi(temi, await temiAttivi(sb, temi));
    if (fuori.length) return json({ error: 'temi non disponibili: ' + fuori.join(', ') }, 422);
    const { data, error } = await sb.from('push_subscriptions').update({ temi, updated_at: ora }).eq('device_id', deviceId).select('id');
    if (error) return json({ error: 'scrittura fallita: ' + error.message }, 500);
    return json({ ok: true, trovato: (data ?? []).length > 0 });
  }

  if (action === 'disiscrivi') {
    const deviceId = normDevice(body.device_id);
    if (!deviceId) return json({ error: 'device_id non valido' }, 422);
    const { data, error } = await sb.from('push_subscriptions').delete().eq('device_id', deviceId).select('id');
    if (error) return json({ error: 'scrittura fallita: ' + error.message }, 500);
    return json({ ok: true, rimossi: (data ?? []).length });
  }

  if (action === 'dispositivi') {
    // MAI endpoint, p256dh o auth: bastano a mandare notifiche a quel telefono. device_id si legge solo per calcolare
    // `questo` e non esce (vistaDispositivi).
    const { data, error } = await retryOnce(() => sb.from('push_subscriptions').select('id, chi, etichetta, temi, created_at, last_ok_at, last_status, device_id').order('created_at', { ascending: true }).limit(100));
    if (error) throw new ReadError('dispositivi non leggibili, riprova');
    return json({ dispositivi: vistaDispositivi(data, normDevice(body.device_id)) });
  }

  if (action === 'rimuovi') {
    const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
    if (!UUID_RE.test(id)) return json({ error: 'id non valido' }, 422);
    const { data, error } = await sb.from('push_subscriptions').delete().eq('id', id).select('id');
    if (error) return json({ error: 'scrittura fallita: ' + error.message }, 500);
    return json({ ok: true, rimossi: (data ?? []).length });
  }

  if (action === 'prova') {
    const deviceId = normDevice(body.device_id);
    if (!deviceId) return json({ error: 'device_id non valido' }, 422);
    const { vapid, motivo } = await vapidDaEnv();
    if (!vapid) return json({ error: motivo }, 503);
    const { data: riga, error } = await retryOnce(() => sb.from('push_subscriptions').select('id, endpoint, p256dh, auth, fail_count, last_test_at').eq('device_id', deviceId).maybeSingle());
    if (error) throw new ReadError('iscrizione non leggibile, riprova');
    if (!riga) return json({ error: 'questo telefono non risulta iscritto' }, 404);
    if (provaTroppoPresto(riga.last_test_at, Date.now())) return json({ error: 'aspetta un minuto' }, 429);
    if (!endpointAmmesso(riga.endpoint)) return json({ error: 'endpoint non ammesso' }, 422);
    // il tetto si scrive PRIMA dell'invio: se la scrittura non riesce la prova non parte (il tetto non si aggira)
    const { error: tErr } = await sb.from('push_subscriptions').update({ last_test_at: ora }).eq('id', riga.id);
    if (tErr) return json({ error: 'scrittura fallita: ' + tErr.message }, 500);
    const payload = costruisciPayload({ titolo: 'Prova notifiche', testo: 'Se leggi questo messaggio, le notifiche su questo telefono funzionano.', url: APP_URL + '#notifiche' });
    const res = await spedisci(riga as Riga, payload, { ttl: TTL_PROVA, urgency: 'normal', topic: topicDi('prova') }, vapid);
    const esito = esitoInvio(res.status, res.corpo);
    await chiudiInvio(sb, riga as Riga, esito, res);
    return json({ ok: esito === 'ok', esito, messaggio: MESSAGGI_ESITO[esito] });
  }

  return json({ error: 'azione sconosciuta' }, 400);
}
