// chat-api api-4 (2026-11-13): la chat del sito, Fase 1 pezzi 2, 5, 6 e 7 (docs/PROPOSTA_chat_sito.md 5.2-5.8, 6, 7.4, 8.4, con le
// decisioni di Dan dell'8 novembre 2026: modello ticket D-8, tetti D-12). Al posto dell'eco dello spike, che resta in
// eco.ts solo per le rotte /eco, /misura e /turnstile (misure dal telefono di Dan, si spegne da sola il 7 dicembre 2026).
// Il widget chiama amimi.it/apps/chat/<azione>; il proxy di "Amimi Chat" firma la query e inoltra qui. verify_jwt = false
// (supabase/config.toml): la credenziale della cliente e' il chat token nel corpo, mai nell'URL.
//
// Azioni (tutte con la firma del proxy; GET solo `config`, il resto POST con corpo JSON di al massimo 8 KB e schema rigido):
//   config     stato della chat e configurazione pubblica gia' composta (testi, bottoni con risposta, versione
//              dell'informativa). Mai valori grezzi di app_flags: si leggono solo le chiavi di FLAG_LETTI.
//   avvia      {email, nome?, lingua?, informativa, turnstile, prova?, testo?, client_id?} -> Turnstile (azione
//              `chat_avvia`, hostname controllato), tetto globale del giorno, sessione `bot`, chat token (solo l'hash nel
//              DB). Un primo testo libero va subito a una persona come in `invia`.
//   invia      {token, client_id, testo | bottone} -> testo libero: messaggio della cliente e, se la chat e' `bot`,
//              passaggio a una persona (Fase 1, 9.1); bottone: risposta fissa dalla riga di cs_faq di `chat_bottoni`.
//   passaggio  {token} -> "Parla con una persona": `attesa_persona`, avviso fisso con l'email mascherata (chat_testo_attesa,
//              o chat_testo_fuori_orario fuori da chat_orari), push subito al tema `assistenza` (8.4).
//   aggiorna   {token, dopo, vista?} -> stato e messaggi con seq > dopo (al massimo 50); vista = pannello aperto e scheda
//              visibile, scrive delivered_at ("vista in chat") sui messaggi dello staff restituiti. Contratto col widget
//              (Gate 2 dell'8-11, C4): il cursore `dopo` avanza SOLO con le risposte di aggiorna; il `seq` nelle
//              risposte di avvia, invia e passaggio serve a non mostrare due volte lo stesso messaggio, mai a saltare.
//              Su una chat chiusa aggiorna risponde ancora, in sola lettura, finche' il token vale (4 ore senza
//              attivita'): cosi' la cliente legge l'ultima risposta mandata prima della chiusura (scostamento da 5.4).
//   riprendi   POST {token_ripresa, turnstile, prova?} -> Turnstile (azione `chat_riprendi`), chat token nuovo per la
//              sessione del link "Continua la chat" (al massimo 3 attivi: il piu' vecchio si revoca). GET = la pagina del
//              link delle email (riprendi.ts, api-2 del pezzo 5): statica, in Liquid, scambio solo al tocco.
//   errore     {codice, versione, pagina} -> beacon d'errore del widget, al massimo 100 al giorno, senza testo libero.
// Rifiuti visti dal widget: 200 con `state` o 4xx, MAI 5xx (il proxy li trasforma in una pagina 500 HTML del tema, spike
// 13.3). Fallire chiusi (5.8): flag, segreti, contatori o DB illeggibili = nessuna chat, nessun messaggio, mai "passa".
// Regola 20: messaggi idempotenti su (sessione_id, client_msg_id), push prenotata su chat_eventi.chiave, passaggio con
// update condizionato su (stato, passaggi), letture con limit e errore controllato, una lettura ritenta una volta, una
// scrittura mai. Regola 19: scrive solo tabelle chat_* e la propria riga health_log `chat_api` (conteggi), legge app_flags
// (elenco chiuso) e cs_faq; nessuna scrittura in change_log, nessuna chiamata a write-api, nessun PIN.
// api-3 (pezzo 6, 7.4): dopo ogni scrittura della cliente (testo, bottone, passaggio) la chat si proietta in Assistenza
// con l'RPC chat_proietta (migr 0193: cs_conversations e cs_messages, canale chat_sito, chiavi chat:<id>); un errore non
// ferma la richiesta (la chat in chat_ e' gia' giusta), va in health_log come warn e il cron chat-proiezione la riprova.
// api-3 (B4 del pezzo 4, CASI_APERTI n.54 k): una cliente che riscrive con testo libero in una chat `aperta` gia' risposta
// dal team (o presa con prendo_io senza un passaggio) apre un passaggio nuovo, come la prima volta: avviso di attesa,
// push al tema `assistenza` e solleciti a 24 e 48 ore lavorative. Modello ticket: una risposta della cliente riapre il
// ticket. I messaggi successivi, finche' il team non risponde, non aprono altri passaggi.
// api-4 (pezzo 7, proposta 9.8, migr 0195): la risposta di un bottone puo' venire anche da una riga `risposta_chat` di
// cs_faq, il tipo delle voci importate dalla Knowledge base di Shopify per la sola chat (cs-assist non lo legge, quindi
// le bozze delle email non cambiano). Testi della pagina di ripresa col nome del marchio, Amimi con l'accento.
// Log: solo cause scritte nel codice e codici d'errore del DB, mai corpi, token, email, nomi o testi.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { inviaPush } from '../_shared/push.ts';
import type { EsitoPush, MsgPush } from '../_shared/push.ts';
import { rispondiEco } from './eco.ts';
import { LIQUID_APRI, LIQUID_CHIUDI, PAGINA_RIPRESA } from './riprendi.ts';

// ==== PURE:chat-api BEGIN ====
const VERSIONE = 'api-4';
const HEADER_BASE: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const ROTTE_ECO = ['eco', 'misura', 'turnstile'];
const METODO: Record<string, string> = { config: 'GET', avvia: 'POST', invia: 'POST', passaggio: 'POST', aggiorna: 'POST', riprendi: 'POST', errore: 'POST' };
const NEGOZI_NOTI = ['amimi-10000.myshopify.com', 'wb9gmn-0h.myshopify.com'];
const PARAM_SHOPIFY_UNICI = ['logged_in_customer_id', 'path_prefix', 'shop', 'timestamp', 'signature'];
const MAX_SKEW_SEC = 300;
const CORPO_MAX_BYTE = 8192;
const TESTO_MAX = 1000;
const NOME_MAX = 80;
const EMAIL_MAX = 254;
const TESTO_DB_MAX = 4000;
const TURNSTILE_TOKEN_MAX = 2048;
const MESSAGGI_PER_CHAT = 100;                 // D-12
const LIMITE_CHAT_GIORNO_DEFAULT = 50;         // D-12, se il flag e' illeggibile o fuori dai limiti
const LIMITE_CHAT_GIORNO_MAX = 10000;
const ERRORI_GIORNO = 100;
const RICHIESTE_SOGLIA = 5000;                 // D-12: sopra, chat_salute (pezzo 4) dalla riga health_log e da chat_eventi
const RICHIESTE_TETTO = 1000000;               // il massimo che la RPC accetta: il contatore conta, non ferma
const INATTIVITA_MS = 4 * 3600 * 1000;         // chat token: 4 ore senza attivita' della sessione (5.4)
const TOKEN_CHAT_MS = 30 * 86400 * 1000;       // scadenza assoluta di un chat token
const TOKEN_CHAT_ATTIVI = 3;
const RIPRESE_ORA = 10;
const AGGIORNA_LIMITE = 50;
const FLAG_CACHE_MS = 60000;
const SALUTE_OGNI_MS = 3600000;                // riga health_log riscritta almeno ogni ora da ogni istanza attiva
const LINK_ASSISTENZA = 'https://noobhandbag.github.io/amimi-app/#assistenza';
// Le sole chiavi di app_flags che la edge legge (sez. 10, test 18): nessun segreto, nessuna chiave fuori dalla chat.
const FLAG_LETTI = ['chat_sito_enabled', 'chat_limite_chat_giorno', 'chat_orari', 'chat_testo_saluto', 'chat_testo_orari',
  'chat_testo_attesa', 'chat_testo_fuori_orario', 'chat_testo_informativa', 'chat_bottoni'];
// Turnstile (5.5, S6): il widget di produzione vale solo su amimi.it; quello di prova anche sulle anteprime di QUESTO
// negozio (`<token>-<id del negozio>.shopifypreview.com`), mai di un altro. Le chiavi di prova di Cloudflare passano sempre:
// un secret di quel tipo vale come assente e il token finto e' rifiutato prima di chiamare Cloudflare.
const HOST_PRODUZIONE = ['amimi.it', 'www.amimi.it'];
const HOST_ANTEPRIMA_RE = /^[a-z0-9]{1,64}-95215747399\.shopifypreview\.com$/;
const SEGRETO_DI_PROVA_CF_RE = /^[0-9]x0+AA$/;
const TOKEN_FINTO_CF = 'XXXX.DUMMY.TOKEN.XXXX';
const PAGINE = ['home', 'prodotto', 'collezione', 'carrello', 'ricerca', 'pagina', 'blog', 'altro'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
// 5.7: una sola email, senza spazi, caratteri di controllo o di formato e senza <>,;" (chat-send la rimette in `To:`);
// il DB ha un secondo cancello (chat_sessioni_email_ck)
// meta' di una emoji (surrogato senza la sua coppia): Postgres la rifiuta (22P02) e il messaggio resterebbe in `riprova`
// per sempre, consumando il tetto (Gate 2 dell'8-11, B1). In modalita' u una coppia valida e' un solo punto di codice.
const SURROGATO_SOLO_RE = /\p{Cs}/u;
const EMAIL_RE = /^[^\s\p{C}<>,;"@]+@[^\s\p{C}<>,;"@]+\.[^\s\p{C}<>,;"@]+$/u;

type Sessione = {
  id: string; stato: string; passaggi: number; passaggio_at: string | null; customer_email: string; customer_name: string | null;
  lingua: string; prova: boolean; ultima_attivita_at: string; chiusa_at: string | null; ultima_risposta_staff_at: string | null;
};
type TokenRiga = { id: string; tipo: string; scade_at: string; revocato_at: string | null; sessione: Sessione | null };
type Messaggio = { id: string; seq: number; autore: string; testo: string; created_at: string; email_stato: string | null; delivered_at: string | null };
type NuovoMessaggio = { sessione_id: string; autore: string; testo: string; client_msg_id: string; fonte: string | null };
type Evento = { sessione_id: string | null; tipo: string; chiave: string | null; esito: string | null; dettaglio: Record<string, unknown> };
interface Db {
  flag(chiavi: string[]): Promise<Record<string, string>>;
  contatore(chiave: string, finestraS: number, tetto: number): Promise<number | null>;
  token(hash: string, tipo: string): Promise<TokenRiga | null>;
  creaSessione(r: Record<string, unknown>): Promise<Sessione>;
  creaToken(r: { sessione_id: string; tipo: string; hash: string; scade_at: string }): Promise<void>;
  tokenAttivi(sessioneId: string, oraIso: string): Promise<{ id: string }[]>;
  revocaToken(ids: string[], oraIso: string): Promise<void>;
  usaToken(id: string, oraIso: string): Promise<void>;
  aggiornaSessione(id: string, patch: Record<string, unknown>, se: { stato?: string; passaggi?: number; risposta?: string | null }): Promise<Sessione | null>;
  sessione(id: string): Promise<Sessione | null>;
  inserisciMessaggi(righe: NuovoMessaggio[]): Promise<Messaggio[]>;
  messaggiDopo(sessioneId: string, dopo: number, limite: number): Promise<Messaggio[]>;
  messaggioCliente(sessioneId: string, clientId: string): Promise<{ created_at: string } | null>;
  segnaViste(ids: string[], oraIso: string): Promise<void>;
  evento(r: Evento): Promise<boolean>;
  esitoEvento(chiave: string, esito: string, dettaglio: Record<string, unknown>): Promise<void>;
  faq(id: number): Promise<{ testo_it: string | null; testo_en: string | null; attiva: boolean } | null>;
  salute(giorno: string, n: number, severity: string, causa: string | null): Promise<void>;
  proietta(sessioneId: string): Promise<void>;
}
type Ambiente = {
  ora: number;
  segreti: { proxy: string; turnstile: string; turnstileProva: string };
  db: Db;
  siteverify: (secret: string, token: string) => Promise<unknown>;
  push: (m: MsgPush) => Promise<EsitoPush>;
  sfondo: (p: Promise<unknown>) => void;
  casuale: (n: number) => Uint8Array;
  eco: ((req: Request) => Promise<Response>) | null;
  pagine: { riprendi: string };
};
type Testo = { it: string; en: string };
type Bottone = { id: string; it: string; en: string; faq: number | null };
type Orari = { tz: string; giorni: number[]; dalle: string; alle: string; chiusure: string[] };
type Flag = {
  attiva: boolean; limiteGiorno: number; orari: Orari | null; bottoni: Bottone[]; informativaGrezza: string | null;
  testi: { saluto: Testo | null; orari: Testo | null; attesa: Testo | null; fuori_orario: Testo | null; informativa: Testo | null };
};
type Problema = { sev: string; causa: string };

class ErroreDb extends Error {
  causa: string;
  constructor(causa: string) { super(causa); this.causa = causa; }
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...HEADER_BASE, 'Content-Type': 'application/json; charset=utf-8' } });
const rifiuto = (state: string, extra: Record<string, unknown> = {}, s = 200) => json({ ok: false, state, ...extra }, s);
const campo = (nome: string) => json({ ok: false, error: 'campo_non_valido', campo: nome }, 422);
const iso = (ms: number) => new Date(ms).toISOString();
const giornoUtc = (ms: number) => iso(ms).slice(0, 10);
const esadecimale = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const oggetto = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const GRAVITA: Record<string, number> = { ok: 0, warn: 1, error: 2 };

// ---- firma del proxy: copia di eco-2 (e di loyalty-proxy v16) ----
async function appProxyHmacHex(params: URLSearchParams, secret: string): Promise<string> {
  const grouped = new Map<string, string[]>();
  for (const [k, v] of params) {
    if (k === 'signature') continue;
    (grouped.get(k) ?? grouped.set(k, []).get(k)!).push(v);
  }
  const message = [...grouped.keys()].sort().map((k) => `${k}=${grouped.get(k)!.join(',')}`).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return esadecimale(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))));
}
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const paramRipetuti = (params: URLSearchParams): string[] => PARAM_SHOPIFY_UNICI.filter((k) => params.getAll(k).length > 1);
const idClienteValido = (v: string): boolean => v === '' || /^[0-9]{1,20}$/.test(v);
function etaFirma(ts: string | null, oraMs: number): number | null {
  if (ts === null || !/^[0-9]{1,12}$/.test(ts)) return null;
  const eta = Math.round(oraMs / 1000 - Number(ts));
  return Math.abs(eta) > MAX_SKEW_SEC ? null : eta;
}
function azioneDi(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  return /^[a-z0-9_-]{1,30}$/.test(last) ? last : '?';
}
// corpo letto a pezzi e fermato appena supera il tetto, anche senza content-length; null = troppo grande
async function leggiCorpo(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const pezzi: Uint8Array[] = [];
  let tot = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tot += value.byteLength;
    if (tot > max) { await reader.cancel(); return null; }
    pezzi.push(value);
  }
  const out = new Uint8Array(tot);
  let at = 0;
  for (const p of pezzi) { out.set(p, at); at += p.byteLength; }
  return out;
}
// firma, parametri ripetuti, eta', id cliente, negozio. Restituisce l'id della cliente loggata ('' se anonima).
async function controllaFirma(params: URLSearchParams, secret: string, oraMs: number): Promise<string | Response> {
  if (!secret) return rifiuto('needs_secret');
  const signature = params.get('signature') ?? '';
  if (!signature) return json({ ok: false, error: 'missing_signature' }, 401);
  if (!timingSafeEqualHex(signature.toLowerCase(), await appProxyHmacHex(params, secret))) return json({ ok: false, error: 'bad_signature' }, 401);
  if (paramRipetuti(params).length) return json({ ok: false, error: 'repeated_param' }, 401);
  if (etaFirma(params.get('timestamp'), oraMs) === null) return json({ ok: false, error: 'stale_signature' }, 401);
  const cliente = params.get('logged_in_customer_id') ?? '';
  if (!idClienteValido(cliente)) return json({ ok: false, error: 'bad_customer_id' }, 401);
  if (!NEGOZI_NOTI.includes(params.get('shop') ?? '')) return json({ ok: false, error: 'bad_shop' }, 401);
  return cliente;
}

// ---- input (5.7) ----
async function leggiJson(req: Request): Promise<Record<string, unknown> | Response> {
  if (Number(req.headers.get('content-length') ?? 0) > CORPO_MAX_BYTE) return json({ ok: false, error: 'body_too_large' }, 413);
  const buf = await leggiCorpo(req, CORPO_MAX_BYTE);
  if (buf === null) return json({ ok: false, error: 'body_too_large' }, 413);
  let d: unknown;
  try { d = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buf)); } catch { return json({ ok: false, error: 'json_non_valido' }, 400); }
  if (d === null || typeof d !== 'object' || Array.isArray(d)) return json({ ok: false, error: 'json_non_valido' }, 400);
  return d as Record<string, unknown>;
}
// schema rigido: un campo sconosciuto e' un 422; un obbligatorio assente (o null) pure. I nomi nella risposta vengono
// dall'elenco del codice, mai dall'input.
function schema(d: Record<string, unknown>, ammessi: string[], obbligatori: string[]): Response | null {
  for (const k of Object.keys(d)) if (!ammessi.includes(k)) return json({ ok: false, error: 'campo_sconosciuto' }, 422);
  for (const k of obbligatori) if (d[k] === undefined || d[k] === null) return json({ ok: false, error: 'campo_mancante', campo: k }, 422);
  return null;
}
const cp = (s: string) => [...s].length;
function emailValida(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= EMAIL_MAX && EMAIL_RE.test(e) ? e : null;
}
// nome: facoltativo; a capo, controlli e caratteri di formato diventano spazi; oltre NOME_MAX = rifiutato (mai tagliato)
function nomePulito(v: unknown): string | null | false {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || SURROGATO_SOLO_RE.test(v)) return false;
  const s = v.normalize('NFC').replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return cp(s) <= NOME_MAX ? s : false;
}
// messaggio: NFC, a capo normalizzati, via i controlli (a capo escluso) e i caratteri che rovesciano il testo; 1-1000
function testoPulito(v: unknown): string | false {
  if (typeof v !== 'string' || SURROGATO_SOLO_RE.test(v)) return false;
  const s = v.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, '').trim();
  const n = cp(s);
  return n >= 1 && n <= TESTO_MAX ? s : false;
}
const uuidValido = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);
const tokenValido = (v: unknown): string | null => (typeof v === 'string' && TOKEN_RE.test(v) ? v : null);
const turnstileValido = (v: unknown): string | null => (typeof v === 'string' && v.length >= 1 && v.length <= TURNSTILE_TOKEN_MAX && /^[\x21-\x7E]+$/.test(v) ? v : null);
function mascheraEmail(e: string): string {
  const i = e.lastIndexOf('@');
  return i < 1 ? '***' : `${[...e.slice(0, i)][0]}***${e.slice(i)}`;
}

// ---- token, hash, id derivati ----
async function sha256hex(s: string): Promise<string> {
  return esadecimale(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}
function base64url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const nuovoToken = (amb: Ambiente) => base64url(amb.casuale(32));   // 256 bit; nel DB solo lo SHA-256
// uuid stabile da una stringa (formato v8): client_msg_id dei messaggi che la edge scrive da se' (risposta fissa, avviso
// di attesa), cosi' un nuovo invio con lo stesso client_id non li duplica (Regola 20)
async function uuidDa(s: string): Promise<string> {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = esadecimale(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---- flag (sez. 10): elenco chiuso, 60 s in memoria, valori illeggibili = default prudenti ----
let CACHE_FLAG: { at: number; v: Record<string, string> } | null = null;
const azzeraCache = () => { CACHE_FLAG = null; };
let ULTIMA_SALUTE = 0;
const azzeraSalute = () => { ULTIMA_SALUTE = 0; };
function testoFlag(v: string | undefined): Testo | null {
  try {
    const o = oggetto(JSON.parse(v ?? ''));
    const ok = (x: unknown) => typeof x === 'string' && cp(x) >= 1 && cp(x) <= TESTO_MAX;
    return ok(o.it) && ok(o.en) ? { it: o.it as string, en: o.en as string } : null;
  } catch { return null; }
}
function orariFlag(v: string | undefined): Orari | null {
  try {
    const o = oggetto(JSON.parse(v ?? ''));
    const ora = (x: unknown) => typeof x === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(x);
    const giorni = Array.isArray(o.giorni) ? o.giorni.filter((g: unknown): g is number => typeof g === 'number' && Number.isInteger(g) && g >= 1 && g <= 7) : [];
    const chiusure = Array.isArray(o.chiusure) ? o.chiusure.filter((c: unknown): c is string => typeof c === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c)).slice(0, 400) : [];
    if (typeof o.tz !== 'string' || !/^[A-Za-z_]+\/[A-Za-z_]+$/.test(o.tz) || !ora(o.dalle) || !ora(o.alle)) return null;
    return { tz: o.tz, giorni, dalle: o.dalle as string, alle: o.alle as string, chiusure };
  } catch { return null; }
}
function bottoniFlag(v: string | undefined): Bottone[] {
  try {
    const a = JSON.parse(v ?? '');
    if (!Array.isArray(a)) return [];
    const etichetta = (x: unknown) => typeof x === 'string' && cp(x) >= 1 && cp(x) <= 40;
    const out: Bottone[] = [];
    for (const r of a.slice(0, 8)) {
      const o = oggetto(r);
      if (typeof o.id !== 'string' || !/^[a-z0-9_]{1,30}$/.test(o.id) || !etichetta(o.it) || !etichetta(o.en)) continue;
      if (out.some((b) => b.id === o.id)) continue;
      const faq = Number.isSafeInteger(o.faq) && (o.faq as number) > 0 ? (o.faq as number) : null;
      out.push({ id: o.id, it: o.it as string, en: o.en as string, faq });
    }
    return out;
  } catch { return []; }
}
function interpretaFlag(v: Record<string, string>): Flag {
  const lim = Number((v.chat_limite_chat_giorno ?? '').trim());
  return {
    attiva: (v.chat_sito_enabled ?? '').trim().toLowerCase() === 'true',
    limiteGiorno: Number.isInteger(lim) && lim >= 1 && lim <= LIMITE_CHAT_GIORNO_MAX ? lim : LIMITE_CHAT_GIORNO_DEFAULT,
    orari: orariFlag(v.chat_orari),
    bottoni: bottoniFlag(v.chat_bottoni),
    informativaGrezza: typeof v.chat_testo_informativa === 'string' ? v.chat_testo_informativa : null,
    testi: {
      saluto: testoFlag(v.chat_testo_saluto), orari: testoFlag(v.chat_testo_orari), attesa: testoFlag(v.chat_testo_attesa),
      fuori_orario: testoFlag(v.chat_testo_fuori_orario), informativa: testoFlag(v.chat_testo_informativa),
    },
  };
}
async function leggiFlag(amb: Ambiente): Promise<Flag> {
  if (CACHE_FLAG && amb.ora >= CACHE_FLAG.at && amb.ora - CACHE_FLAG.at < FLAG_CACHE_MS) return interpretaFlag(CACHE_FLAG.v);
  const v = await amb.db.flag(FLAG_LETTI);
  const solo: Record<string, string> = {};
  for (const k of FLAG_LETTI) if (typeof v[k] === 'string') solo[k] = v[k];
  CACHE_FLAG = { at: amb.ora, v: solo };
  return interpretaFlag(solo);
}

// ---- orari e testi d'attesa (D-8, 9.13) ----
const GIORNI_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
function inOrario(o: Orari | null, oraMs: number): boolean {
  if (!o) return false;
  try {
    const parti = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: o.tz, weekday: 'short', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(oraMs)).map((p) => [p.type, p.value]));
    const data = `${parti.year}-${parti.month}-${parti.day}`;
    const hhmm = `${parti.hour}:${parti.minute}`;
    return o.giorni.includes(GIORNI_ISO[parti.weekday] ?? 0) && !o.chiusure.includes(data) && hhmm >= o.dalle && hhmm < o.alle;
  } catch { return false; }
}
const ATTESA_RISERVA: Testo = {
  it: 'Abbiamo ricevuto la tua richiesta: il team ti risponder\u00e0 appena possibile e riceverai la risposta via email all\'indirizzo {email}.',
  en: 'We have received your request: our team will reply as soon as possible and you will receive the reply by email at {email}.',
};
function testoAttesa(f: Flag, s: Sessione, oraMs: number): string {
  const t = (inOrario(f.orari, oraMs) ? f.testi.attesa : f.testi.fuori_orario) ?? f.testi.fuori_orario ?? ATTESA_RISERVA;
  const base = s.lingua === 'en' ? t.en : t.it;
  return [...base.split('{email}').join(mascheraEmail(s.customer_email))].slice(0, TESTO_DB_MAX).join('');
}

// ---- push (8.4, 8.7): copie di push-eventi, con test d'impronta (tests/chat_api.mjs) ----
function pulisci(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const s = Array.from(v, (c) => { const k = c.codePointAt(0) ?? 0; return k < 32 || (k >= 127 && k <= 159) || k === 8232 || k === 8233 ? ' ' : c; }).join('').replace(/\s+/g, ' ').trim();
  const cp = Array.from(s);
  return cp.length > max ? cp.slice(0, max).join('').trimEnd() : s;
}
const EMAIL_CLIENTE_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
function emailCliente(v: unknown): string {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return e.length <= 80 && EMAIL_CLIENTE_RE.test(e) && !/\p{C}/u.test(e) ? e : '';
}
function nomeCliente(nome: unknown, email: unknown): string {
  const grezzo = typeof nome === 'string' ? nome.replace(/\p{Cf}/gu, '') : nome;
  if (typeof grezzo === 'string' && EMAIL_CLIENTE_RE.test(grezzo.trim())) return emailCliente(grezzo) || emailCliente(email);
  return pulisci(grezzo, 60) || emailCliente(email);
}
function statoDaEsito(e: EsitoPush): 'inviato' | 'nessun_iscritto' | 'fallito' {
  if (e?.ok === true) return 'inviato';
  const ok2xx = typeof e?.status === 'number' && e.status >= 200 && e.status < 300;
  if (ok2xx && !e.errore && e.dryRun !== true && (e.skipped === 'tema_spento' || (!e.skipped && e.destinatari === 0))) return 'nessun_iscritto';
  return 'fallito';
}
function esitoDaSalvare(e: EsitoPush): Record<string, unknown> {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { inviati: n(e?.inviati), falliti: n(e?.falliti), destinatari: n(e?.destinatari), status: n(e?.status),
    ...(typeof e?.skipped === 'string' ? { skipped: e.skipped.slice(0, 40) } : {}), ...(e?.errore ? { errore: true } : {}) };
}
function messaggioPush(s: Sessione, urgente: boolean): MsgPush {
  const chi = nomeCliente(s.customer_name, s.customer_email) || 'Una cliente';
  return { tema: 'assistenza', titolo: `${s.prova ? 'PROVA ' : ''}Chat del sito: ${chi} chiede una persona`, testo: 'Apri Assistenza.', url: LINK_ASSISTENZA, urgente };
}
async function mandaPushPassaggio(amb: Ambiente, s: Sessione, chiave: string, urgente: boolean): Promise<void> {
  let esito: EsitoPush;
  try { esito = await amb.push(messaggioPush(s, urgente)); } catch { esito = { ok: false, inviati: 0, falliti: 0, destinatari: null, status: null, errore: 'eccezione' }; }
  try { await amb.db.esitoEvento(chiave, statoDaEsito(esito), esitoDaSalvare(esito)); } catch { /* resta `prenotato`: lo ritenta il sollecito (8.4) */ }
}

// ---- eventi e salute ----
async function eventoUnaVolta(amb: Ambiente, tipo: string, chiave: string, sessioneId: string | null, problemi: Problema[]): Promise<void> {
  try { await amb.db.evento({ sessione_id: sessioneId, tipo, chiave, esito: null, dettaglio: {} }); }
  catch { problemi.push({ sev: 'warn', causa: 'evento non registrato' }); }
}
// una riga health_log `chat_api` al giorno UTC (5.8), solo conteggi. refresh_health_log() delle 06:00 UTC cancella le
// righe del giorno che non sono ce_*, sales_* o shipping_status (migr 0087), quindi la gravita' del giorno vive nei
// contatori glob:sev_warn e glob:sev_error, che quel giro non tocca, e la riga si riscrive al primo problema, alla prima
// richiesta del giorno, ogni 500 e almeno ogni ora da ogni istanza (Gate 2 dell'8-11, B2). Dalla soglia di D-12 in poi
// l'evento quota:<giorno> si ritenta ogni 100 richieste (C8). Mai bloccante.
async function chiudiSalute(amb: Ambiente, giorno: string, conto: Promise<number | null>, problemi: Problema[]): Promise<void> {
  let n: number | null = null;
  try { n = await conto; } catch { problemi.push({ sev: 'warn', causa: 'contatore delle richieste non scritto' }); }
  if (n !== null && n >= RICHIESTE_SOGLIA && (n === RICHIESTE_SOGLIA || n % 100 === 0)) {
    problemi.push({ sev: 'warn', causa: `oltre ${RICHIESTE_SOGLIA} richieste nel giorno` });
    await eventoUnaVolta(amb, 'quota', `quota:${giorno}`, null, problemi);
  }
  let sev = 'ok';
  let causa: string | null = null;
  for (const p of problemi) if (GRAVITA[p.sev] > GRAVITA[sev]) { sev = p.sev; causa = p.causa; }
  if (sev !== 'ok') {
    try { await amb.db.contatore(`glob:sev_${sev}`, 86400, RICHIESTE_TETTO); } catch { /* la riga sotto dice comunque la gravita' */ }
  }
  const pietra = n === 1 || (n !== null && n % 500 === 0);
  const scaduta = amb.ora - ULTIMA_SALUTE >= SALUTE_OGNI_MS;
  if (sev === 'ok' && !pietra && !scaduta) return;
  ULTIMA_SALUTE = amb.ora;
  try { await amb.db.salute(giorno, n ?? 0, sev, causa); } catch { /* telemetria: mai bloccante */ }
}

// ---- Turnstile (5.5) ----
async function verificaTurnstile(amb: Ambiente, token: string, prova: boolean, azione: string, problemi: Problema[]): Promise<'ok' | 'ko' | 'non_disponibile'> {
  const secret = prova ? amb.segreti.turnstileProva : amb.segreti.turnstile;
  if (!secret || SEGRETO_DI_PROVA_CF_RE.test(secret)) {
    problemi.push({ sev: 'warn', causa: prova ? 'secret di Turnstile di prova assente' : 'secret di Turnstile assente' });
    return 'non_disponibile';
  }
  let esito = 'ko';
  if (token !== TOKEN_FINTO_CF) {
    let r: unknown;
    try { r = await amb.siteverify(secret, token); } catch {
      problemi.push({ sev: 'warn', causa: 'siteverify non raggiungibile' });
      return 'non_disponibile';
    }
    const o = oggetto(r);
    const host = typeof o.hostname === 'string' ? o.hostname.toLowerCase() : '';
    const hostOk = HOST_PRODUZIONE.includes(host) || (prova && HOST_ANTEPRIMA_RE.test(host));
    if (o.success === true && hostOk && o.action === azione) esito = 'ok';
  }
  if (esito === 'ko') await amb.db.contatore('glob:turnstile_ko', 86400, RICHIESTE_TETTO).catch(() => null);
  return esito as 'ok' | 'ko';
}

// ---- token di chat: la credenziale della cliente (5.4) ----
async function tokenChat(amb: Ambiente, token: string): Promise<Sessione | Response> {
  const r = await amb.db.token(await sha256hex(token), 'chat');
  // rifiuto neutro: sconosciuto, revocato, scaduto o sessione ferma da oltre 4 ore danno la stessa risposta
  if (!r || !r.sessione || r.revocato_at !== null || !(Date.parse(r.scade_at) > amb.ora)
      || !(Date.parse(r.sessione.ultima_attivita_at) > amb.ora - INATTIVITA_MS)) return rifiuto('token_non_valido');
  return r.sessione;
}
async function emettiToken(amb: Ambiente, s: Sessione): Promise<string> {
  const token = nuovoToken(amb);
  await amb.db.creaToken({ sessione_id: s.id, tipo: 'chat', hash: await sha256hex(token), scade_at: iso(amb.ora + TOKEN_CHAT_MS) });
  return token;
}
const pubblico = (m: Messaggio) => ({ seq: m.seq, autore: m.autore, testo: m.testo, at: m.created_at, via_email: m.email_stato === 'inviata' });
const ordinati = (ms: Messaggio[]) => [...ms].sort((a, b) => a.seq - b.seq);

// ---- messaggi della cliente ----
const attesaFinestra = (amb: Ambiente, finestraS: number) => Math.max(1, Math.ceil(finestraS - (amb.ora / 1000) % finestraS));
// 5 azioni in 10 s per chat (in media una ogni 2 s, 5.6): una riga di contatore ogni 10 s, non ogni 2 (Gate 2, C3)
async function limiteVeloce(amb: Ambiente, s: Sessione): Promise<Response | null> {
  return (await amb.db.contatore(`sess:${s.id}:msg10s`, 10, 5)) === null ? rifiuto('troppo_veloce', { retry_after_s: attesaFinestra(amb, 10) }, 429) : null;
}
async function limiteMessaggi(amb: Ambiente, s: Sessione, problemi: Problema[]): Promise<Response | null> {
  if ((await amb.db.contatore(`sess:${s.id}:msg`, 0, MESSAGGI_PER_CHAT)) !== null) return null;
  await eventoUnaVolta(amb, 'limite_messaggi', `${s.id}:limite_messaggi`, s.id, problemi);
  return rifiuto('limite_messaggi');
}
// passaggio a una persona: update condizionato (stato e passaggi letti), chi lo vince e' il passaggio nuovo
async function aPersona(amb: Ambiente, s: Sessione, cliente: boolean): Promise<Sessione> {
  const ora = iso(amb.ora);
  const patch: Record<string, unknown> = { stato: 'attesa_persona', passaggi: s.passaggi + 1, passaggio_at: ora, ultima_attivita_at: ora, updated_at: ora };
  if (cliente) patch.ultimo_cliente_at = ora;
  // la risposta dello staff letta e' nella condizione: una risposta arrivata nel frattempo fa perdere l'update (Gate 2, B2)
  const vinto = await amb.db.aggiornaSessione(s.id, patch, { stato: s.stato, passaggi: s.passaggi, risposta: s.ultima_risposta_staff_at });
  if (vinto) return vinto;
  const letta = await amb.db.sessione(s.id);
  if (!letta) throw new ErroreDb('sessione non riletta');
  return letta;
}
// effetti del passaggio n, idempotenti: avviso di attesa (uuid derivato) e prenotazione della push (chiave UNIQUE); la push
// parte solo per chi ha inserito la chiave, dopo la risposta (EdgeRuntime.waitUntil)
async function effettiPassaggio(amb: Ambiente, f: Flag, s: Sessione): Promise<Messaggio[]> {
  const n = s.passaggi;
  const avviso = await amb.db.inserisciMessaggi([{ sessione_id: s.id, autore: 'sistema', testo: testoAttesa(f, s, amb.ora),
    client_msg_id: await uuidDa(`${s.id}:passaggio:${n}:attesa`), fonte: 'attesa' }]);
  const chiave = `${s.id}:passaggio:${n}`;
  const mia = await amb.db.evento({ sessione_id: s.id, tipo: 'push_passaggio', chiave, esito: 'prenotato', dettaglio: { n, prova: s.prova } });
  if (mia) amb.sfondo(mandaPushPassaggio(amb, s, chiave, inOrario(f.orari, amb.ora)));
  return avviso;
}
async function toccaSessione(amb: Ambiente, s: Sessione, cliente: boolean): Promise<Sessione> {
  const ora = iso(amb.ora);
  const patch: Record<string, unknown> = { ultima_attivita_at: ora, updated_at: ora };
  if (cliente) patch.ultimo_cliente_at = ora;
  return (await amb.db.aggiornaSessione(s.id, patch, {})) ?? s;
}
// B4 (api-3): la chat aspetta gia' il team quando c'e' un passaggio e nessuna risposta dello staff dopo di esso (stessa
// regola di attesaChat in push-eventi, che decide i solleciti). Una chat `aperta` che NON aspetta il team (risposta gia'
// data, o presa con prendo_io senza passaggio) riceve un passaggio nuovo al primo testo libero della cliente.
function aspettaIlTeam(s: Sessione): boolean {
  const p = Date.parse(s.passaggio_at ?? '');
  if (!Number.isFinite(p)) return false;
  const r = Date.parse(s.ultima_risposta_staff_at ?? '');
  return !(Number.isFinite(r) && r >= p);
}
const serveUnaPersona = (s: Sessione) => s.stato === 'bot' || (s.stato === 'aperta' && !aspettaIlTeam(s));
// testo libero: messaggio della cliente, poi (Fase 1) passaggio se la chat e' del bot o se il team le ha gia' risposto
// (B4). Gli effetti del passaggio si rifanno anche quando il messaggio e' un doppione (nuovo invio dopo un errore a
// meta'): sono idempotenti.
async function testoLibero(amb: Ambiente, f: Flag, s: Sessione, clientId: string, testo: string): Promise<{ sessione: Sessione; messaggi: Messaggio[] }> {
  const ins = await amb.db.inserisciMessaggi([{ sessione_id: s.id, autore: 'cliente', testo, client_msg_id: clientId, fonte: null }]);
  const doppione = ins.length === 0;
  let sess: Sessione;
  let nuovo = false;
  // B4 solo per un messaggio arrivato DOPO l'ultima risposta dello staff (Gate 2, B2): un doppione salvato prima della
  // risposta non riapre una domanda gia' evasa; un doppione salvato dopo (primo invio caduto prima del passaggio) si'.
  // Da `bot` il passaggio si rifa' come prima: gli effetti sono idempotenti.
  let persona = serveUnaPersona(s);
  if (persona && s.stato === 'aperta' && doppione) {
    const m = await amb.db.messaggioCliente(s.id, clientId);
    const risposta = Date.parse(s.ultima_risposta_staff_at ?? '');
    persona = m !== null && !(Number.isFinite(risposta) && Date.parse(m.created_at) <= risposta);
  }
  if (persona) {
    sess = await aPersona(amb, s, true);
    nuovo = sess.passaggi > s.passaggi;
  } else sess = await toccaSessione(amb, s, true);
  const extra = sess.stato === 'attesa_persona' && (nuovo || doppione) ? await effettiPassaggio(amb, f, sess) : [];
  return { sessione: sess, messaggi: ordinati([...ins, ...extra]) };
}

// 7.4 (api-3): la chat in Assistenza. Mai bloccante: chat_ e' gia' giusta, il cron chat-proiezione riprova.
async function proietta(amb: Ambiente, sessioneId: string, problemi: Problema[]): Promise<void> {
  try { await amb.db.proietta(sessioneId); } catch { problemi.push({ sev: 'warn', causa: 'proiezione in Assistenza non scritta' }); }
}

// ---- azioni ----
async function azioneConfig(amb: Ambiente, problemi: Problema[]): Promise<Response> {
  let f: Flag;
  try { f = await leggiFlag(amb); } catch {
    problemi.push({ sev: 'error', causa: 'flag non letti' });
    return json({ ok: true, versione: VERSIONE, attiva: false });     // 5.8: config illeggibile = spenta
  }
  if (!f.attiva) return json({ ok: true, versione: VERSIONE, attiva: false });
  return json({
    ok: true, versione: VERSIONE, attiva: true,
    testi: { saluto: f.testi.saluto, orari: f.testi.orari, informativa: f.testi.informativa },
    bottoni: f.bottoni.filter((b) => b.faq !== null).map((b) => ({ id: b.id, it: b.it, en: b.en })),
    informativa_versione: f.informativaGrezza === null ? null : 'i-' + (await sha256hex(f.informativaGrezza)).slice(0, 12),
    limiti: { testo: TESTO_MAX, nome: NOME_MAX },
  });
}

async function azioneAvvia(d: Record<string, unknown>, amb: Ambiente, cliente: string, giorno: string, problemi: Problema[]): Promise<Response> {
  const e = schema(d, ['email', 'nome', 'lingua', 'informativa', 'turnstile', 'prova', 'testo', 'client_id'], ['email', 'informativa', 'turnstile']);
  if (e) return e;
  const email = emailValida(d.email);
  if (!email) return campo('email');
  const nome = nomePulito(d.nome);
  if (nome === false) return campo('nome');
  const lingua = d.lingua === undefined || d.lingua === null ? 'it' : d.lingua;
  if (lingua !== 'it' && lingua !== 'en') return campo('lingua');
  if (typeof d.informativa !== 'string' || !/^[a-z0-9._-]{1,64}$/i.test(d.informativa)) return campo('informativa');
  const prova = d.prova === undefined || d.prova === null ? false : d.prova;
  if (typeof prova !== 'boolean') return campo('prova');
  const ts = turnstileValido(d.turnstile);
  if (!ts) return campo('turnstile');
  let testo: string | null = null;
  let clientId: string | null = null;
  if (d.testo !== undefined && d.testo !== null) {
    const t = testoPulito(d.testo);
    if (t === false) return campo('testo');
    testo = t;
    clientId = uuidValido(d.client_id);
    if (!clientId) return campo('client_id');
  } else if (d.client_id !== undefined && d.client_id !== null) return campo('client_id');

  let f: Flag;
  try { f = await leggiFlag(amb); } catch { problemi.push({ sev: 'error', causa: 'flag non letti' }); return rifiuto('non_disponibile'); }
  if (!f.attiva) return rifiuto('spenta');
  const v = await verificaTurnstile(amb, ts, prova, 'chat_avvia', problemi);
  if (v !== 'ok') return rifiuto(v === 'ko' ? 'verifica_fallita' : 'non_disponibile');
  if ((await amb.db.contatore('glob:chat_giorno', 86400, f.limiteGiorno)) === null) {
    problemi.push({ sev: 'warn', causa: 'tetto delle chat nuove del giorno' });
    await eventoUnaVolta(amb, 'limite_globale', `limite:${giorno}`, null, problemi);
    return rifiuto('limite');
  }
  const ora = iso(amb.ora);
  let s = await amb.db.creaSessione({ stato: 'bot', customer_email: email, customer_name: nome, lingua, informativa_versione: d.informativa,
    informativa_at: ora, shopify_customer_id: cliente || null, prova, ultima_attivita_at: ora, created_at: ora, updated_at: ora });
  const token = await emettiToken(amb, s);
  try { await amb.db.evento({ sessione_id: s.id, tipo: 'avvia', chiave: null, esito: null, dettaglio: { prova, lingua, loggata: cliente !== '' } }); }
  catch { problemi.push({ sev: 'warn', causa: 'evento non registrato' }); }
  let messaggi: Messaggio[] = [];
  let testoSalvato: boolean | null = null;
  if (testo !== null && clientId !== null) {
    // la sessione c'e' gia': se il primo messaggio non passa la cliente ha comunque il suo token e lo rimanda con `invia`
    try {
      if ((await amb.db.contatore(`sess:${s.id}:msg`, 0, MESSAGGI_PER_CHAT)) === null) throw new ErroreDb('tetto dei messaggi al primo messaggio');
      const r = await testoLibero(amb, f, s, clientId, testo);
      s = r.sessione;
      messaggi = r.messaggi;
      testoSalvato = true;
      await proietta(amb, s.id, problemi);
    } catch (x) {
      problemi.push({ sev: 'error', causa: x instanceof ErroreDb ? x.causa : 'primo messaggio non salvato' });
      testoSalvato = false;
    }
  }
  return json({ ok: true, token, stato: s.stato, email: mascheraEmail(email), messaggi: messaggi.map(pubblico),
    ...(testoSalvato === null ? {} : { testo_salvato: testoSalvato }) });
}

async function azioneInvia(d: Record<string, unknown>, amb: Ambiente, problemi: Problema[]): Promise<Response> {
  const e = schema(d, ['token', 'client_id', 'testo', 'bottone'], ['token', 'client_id']);
  if (e) return e;
  const token = tokenValido(d.token);
  if (!token) return campo('token');
  const clientId = uuidValido(d.client_id);
  if (!clientId) return campo('client_id');
  const haTesto = d.testo !== undefined && d.testo !== null;
  const haBottone = d.bottone !== undefined && d.bottone !== null;
  if (haTesto === haBottone) return campo(haTesto ? 'bottone' : 'testo');
  const testo = haTesto ? testoPulito(d.testo) : null;
  if (testo === false) return campo('testo');
  if (haBottone && (typeof d.bottone !== 'string' || !/^[a-z0-9_]{1,30}$/.test(d.bottone))) return campo('bottone');

  let f: Flag;
  try { f = await leggiFlag(amb); } catch { problemi.push({ sev: 'error', causa: 'flag non letti' }); return rifiuto('non_disponibile'); }
  if (!f.attiva) return rifiuto('spenta');
  const s = await tokenChat(amb, token);
  if (s instanceof Response) return s;
  if (s.stato === 'chiusa') return rifiuto('chiusa', {}, 409);
  const veloce = await limiteVeloce(amb, s);
  if (veloce) return veloce;

  if (testo !== null) {
    const tetto = await limiteMessaggi(amb, s, problemi);
    if (tetto) return tetto;
    const r = await testoLibero(amb, f, s, clientId, testo);
    await proietta(amb, s.id, problemi);
    return json({ ok: true, stato: r.sessione.stato, messaggi: r.messaggi.map(pubblico) });
  }
  // bottone: risposta fissa dalla riga di cs_faq che il bottone indica; lo stato non cambia (7.5)
  const b = f.bottoni.find((x) => x.id === d.bottone);
  if (!b || b.faq === null) return rifiuto('bottone_non_disponibile');
  const faq = await amb.db.faq(b.faq);
  const risposta = faq && faq.attiva ? ((s.lingua === 'en' ? faq.testo_en : null) || faq.testo_it) : null;
  if (typeof risposta !== 'string' || !risposta.trim()) return rifiuto('bottone_non_disponibile');
  const tetto = await limiteMessaggi(amb, s, problemi);
  if (tetto) return tetto;
  const ins = await amb.db.inserisciMessaggi([
    { sessione_id: s.id, autore: 'cliente', testo: s.lingua === 'en' ? b.en : b.it, client_msg_id: clientId, fonte: `bottone:${b.id}` },
    { sessione_id: s.id, autore: 'automatica', testo: [...risposta.trim()].slice(0, TESTO_DB_MAX).join(''), client_msg_id: await uuidDa(`${clientId}:risposta`), fonte: `faq:${b.faq}` },
  ]);
  const sess = await toccaSessione(amb, s, true);
  await proietta(amb, s.id, problemi);
  return json({ ok: true, stato: sess.stato, messaggi: ordinati(ins).map(pubblico) });
}

async function azionePassaggio(d: Record<string, unknown>, amb: Ambiente, problemi: Problema[]): Promise<Response> {
  const e = schema(d, ['token'], ['token']);
  if (e) return e;
  const token = tokenValido(d.token);
  if (!token) return campo('token');
  let f: Flag;
  try { f = await leggiFlag(amb); } catch { problemi.push({ sev: 'error', causa: 'flag non letti' }); return rifiuto('non_disponibile'); }
  if (!f.attiva) return rifiuto('spenta');
  const s = await tokenChat(amb, token);
  if (s instanceof Response) return s;
  if (s.stato === 'chiusa') return rifiuto('chiusa', {}, 409);
  const veloce = await limiteVeloce(amb, s);
  if (veloce) return veloce;
  if (s.stato === 'aperta') {
    const sess = await toccaSessione(amb, s, false);
    return json({ ok: true, stato: sess.stato, email: mascheraEmail(s.customer_email), messaggi: [] });
  }
  // bot: passaggio nuovo; attesa_persona: ripetizione, gli effetti sono idempotenti (nessuna push in piu')
  const sess = s.stato === 'bot' ? await aPersona(amb, s, false) : await toccaSessione(amb, s, false);
  const messaggi = sess.stato === 'attesa_persona' ? await effettiPassaggio(amb, f, sess) : [];
  await proietta(amb, s.id, problemi);
  return json({ ok: true, stato: sess.stato, email: mascheraEmail(sess.customer_email), messaggi: ordinati(messaggi).map(pubblico) });
}

async function azioneAggiorna(d: Record<string, unknown>, amb: Ambiente, problemi: Problema[]): Promise<Response> {
  const e = schema(d, ['token', 'dopo', 'vista'], ['token', 'dopo']);
  if (e) return e;
  const token = tokenValido(d.token);
  if (!token) return campo('token');
  if (!Number.isSafeInteger(d.dopo) || (d.dopo as number) < 0) return campo('dopo');
  if (d.vista !== undefined && d.vista !== null && typeof d.vista !== 'boolean') return campo('vista');
  // a chat spenta aggiorna continua sulle chat aperte (5.8): nessun flag qui
  const s = await tokenChat(amb, token);
  if (s instanceof Response) return s;
  if ((await amb.db.contatore(`sess:${s.id}:agg10s`, 10, 10)) === null) return rifiuto('troppo_veloce', { retry_after_s: attesaFinestra(amb, 10) }, 429);
  const righe = await amb.db.messaggiDopo(s.id, d.dopo as number, AGGIORNA_LIMITE + 1);
  const messaggi = ordinati(righe).slice(0, AGGIORNA_LIMITE);
  if (d.vista === true) {
    const viste = messaggi.filter((m) => m.autore === 'staff' && m.delivered_at === null).map((m) => m.id);
    if (viste.length) {
      try { await amb.db.segnaViste(viste, iso(amb.ora)); } catch { problemi.push({ sev: 'warn', causa: 'vista in chat non scritta' }); }
    }
  }
  return json({ ok: true, stato: s.stato, messaggi: messaggi.map(pubblico), altri: righe.length > AGGIORNA_LIMITE });
}

async function azioneRiprendi(d: Record<string, unknown>, amb: Ambiente, problemi: Problema[]): Promise<Response> {
  const e = schema(d, ['token_ripresa', 'turnstile', 'prova'], ['token_ripresa', 'turnstile']);
  if (e) return e;
  const tr = tokenValido(d.token_ripresa);
  if (!tr) return campo('token_ripresa');
  const ts = turnstileValido(d.turnstile);
  if (!ts) return campo('turnstile');
  const prova = d.prova === undefined || d.prova === null ? false : d.prova;
  if (typeof prova !== 'boolean') return campo('prova');
  let f: Flag;
  try { f = await leggiFlag(amb); } catch { problemi.push({ sev: 'error', causa: 'flag non letti' }); return rifiuto('non_disponibile'); }
  if (!f.attiva) return rifiuto('spenta');
  // Turnstile prima del token: senza una sfida risolta nessuno puo' provare token di ripresa
  const v = await verificaTurnstile(amb, ts, prova, 'chat_riprendi', problemi);
  if (v !== 'ok') return rifiuto(v === 'ko' ? 'verifica_fallita' : 'non_disponibile');
  const r = await amb.db.token(await sha256hex(tr), 'ripresa');
  if (!r || !r.sessione || r.revocato_at !== null || !(Date.parse(r.scade_at) > amb.ora) || r.sessione.prova !== prova) return rifiuto('token_non_valido');
  const s0 = r.sessione;
  if ((await amb.db.contatore(`sess:${s0.id}:riprendi`, 3600, RIPRESE_ORA)) === null) return rifiuto('troppo_veloce', { retry_after_s: 3600 }, 429);
  const ora = iso(amb.ora);
  const token = await emettiToken(amb, s0);
  try {
    const attivi = await amb.db.tokenAttivi(s0.id, ora);
    if (attivi.length > TOKEN_CHAT_ATTIVI) await amb.db.revocaToken(attivi.slice(TOKEN_CHAT_ATTIVI).map((x) => x.id), ora);
    await amb.db.usaToken(r.id, ora);
  } catch { problemi.push({ sev: 'warn', causa: 'token vecchi non revocati' }); }
  const s = await toccaSessione(amb, s0, false);
  return json({ ok: true, token, stato: s.stato, email: mascheraEmail(s.customer_email) });
}

async function azioneErrore(d: Record<string, unknown>, amb: Ambiente, giorno: string, problemi: Problema[]): Promise<Response> {
  const e = schema(d, ['codice', 'versione', 'pagina'], ['codice', 'versione', 'pagina']);
  if (e) return e;
  if (typeof d.codice !== 'string' || !/^[a-z0-9_]{1,40}$/.test(d.codice)) return campo('codice');
  if (typeof d.versione !== 'string' || !/^[0-9a-z._-]{1,20}$/.test(d.versione)) return campo('versione');
  if (typeof d.pagina !== 'string' || !PAGINE.includes(d.pagina)) return campo('pagina');
  if ((await amb.db.contatore('glob:errore', 86400, ERRORI_GIORNO)) === null) {
    await eventoUnaVolta(amb, 'tetto_beacon', `beacon:${giorno}`, null, problemi);
    return json({ ok: true, contato: false });
  }
  await amb.db.evento({ sessione_id: null, tipo: 'errore_widget', chiave: null, esito: null, dettaglio: { codice: d.codice, versione: d.versione, pagina: d.pagina } });
  return json({ ok: true, contato: true });
}

async function gestisci(req: Request, amb: Ambiente): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADER_BASE });
  const url = new URL(req.url);
  const azione = azioneDi(url.pathname);
  const eco = amb.eco !== null && ROTTE_ECO.includes(azione);
  if (!eco && !Object.hasOwn(METODO, azione)) return json({ ok: false, error: 'not_found' }, 404);
  // riprendi: POST scambia il token, GET e' la pagina del link delle email
  const paginaRiprendi = azione === 'riprendi' && req.method === 'GET';
  if (!eco && req.method !== METODO[azione] && !paginaRiprendi) return json({ ok: false, error: 'method_not_allowed' }, 405);
  const giorno = giornoUtc(amb.ora);
  // ogni richiesta instradata conta, anche rifiutata, eco compresa (5.8, D-12): in parallelo, mai bloccante
  const conto = amb.db.contatore('glob:richieste', 86400, RICHIESTE_TETTO);
  conto.catch(() => null);
  const problemi: Problema[] = [];
  let r: Response;
  try {
    if (eco && amb.eco) {
      r = await amb.eco(req);
      amb.sfondo(chiudiSalute(amb, giorno, conto, problemi).catch(() => undefined));
      return r;
    }
    const firma = await controllaFirma(url.searchParams, amb.segreti.proxy, amb.ora);
    if (firma instanceof Response) r = firma;
    else if (azione === 'config') r = await azioneConfig(amb, problemi);
    // statica, senza nessun dato della richiesta; il proxy riscrive text/html in text/plain, quindi Liquid (spike 13.3)
    else if (paginaRiprendi) r = new Response(amb.pagine.riprendi, { status: 200, headers: { ...HEADER_BASE, 'Content-Type': 'application/liquid; charset=utf-8' } });
    else {
      const d = await leggiJson(req);
      if (d instanceof Response) r = d;
      else if (azione === 'avvia') r = await azioneAvvia(d, amb, firma, giorno, problemi);
      else if (azione === 'invia') r = await azioneInvia(d, amb, problemi);
      else if (azione === 'passaggio') r = await azionePassaggio(d, amb, problemi);
      else if (azione === 'aggiorna') r = await azioneAggiorna(d, amb, problemi);
      else if (azione === 'riprendi') r = await azioneRiprendi(d, amb, problemi);
      else r = await azioneErrore(d, amb, giorno, problemi);
    }
  } catch (x) {
    // DB, contatori o eccezioni: fallire chiusi con un 200 che il widget sa ripetere (mai 5xx, che il proxy fa HTML)
    problemi.push({ sev: 'error', causa: x instanceof ErroreDb ? x.causa : 'eccezione' });
    r = rifiuto('riprova');
  }
  amb.sfondo(chiudiSalute(amb, giorno, conto, problemi).catch(() => undefined));
  return r;
}
// ==== PURE:chat-api END ====

// ---- adattatore Supabase (service role). Letture con un ritentativo, scritture mai (Regola 20d). Log: causa e codice. ----
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn();
  if (!r.error) return r;
  await new Promise((ok) => setTimeout(ok, 300));
  return await fn();
};
const codice = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && /^[A-Z0-9]{1,10}$/.test(c) ? c : '?';
};
const fallito = (causa: string, e: unknown): ErroreDb => {
  console.error('chat-api: ' + causa, codice(e));
  return new ErroreDb(causa);
};
const COL_SESSIONE = 'id, stato, passaggi, passaggio_at, customer_email, customer_name, lingua, prova, ultima_attivita_at, chiusa_at, ultima_risposta_staff_at';
const COL_MESSAGGIO = 'id, seq, autore, testo, created_at, email_stato, delivered_at';

function dbSupabase(sb: SupabaseClient): Db {
  return {
    async flag(chiavi) {
      const { data, error } = await retryOnce(() => sb.from('app_flags').select('key, value').in('key', chiavi).limit(chiavi.length));
      if (error) throw fallito('flag non letti', error);
      const out: Record<string, string> = {};
      for (const r of (data ?? []) as { key: string; value: unknown }[]) if (chiavi.includes(r.key) && typeof r.value === 'string') out[r.key] = r.value;
      return out;
    },
    async proietta(sessioneId) {
      // scrittura: mai ritentata (Regola 20 d); l'RPC e' idempotente e la riprova il cron chat-proiezione
      const { data, error } = await sb.rpc('chat_proietta', { p_sessione: sessioneId });
      if (error) throw fallito('proiezione non scritta', error);
      const esito = (data as { esito?: unknown } | null)?.esito;
      if (esito !== 'fatto' && esito !== 'vuota') throw fallito('proiezione con esito inatteso', null);
    },
    async contatore(chiave, finestraS, tetto) {
      const { data, error } = await sb.rpc('chat_contatore_incrementa', { p_chiave: chiave, p_finestra_secondi: finestraS, p_tetto: tetto });
      if (error) throw fallito('contatore non scritto', error);
      return typeof data === 'number' ? data : null;
    },
    async token(hash, tipo) {
      const { data, error } = await retryOnce(() => sb.from('chat_token').select(`id, tipo, scade_at, revocato_at, sessione:chat_sessioni(${COL_SESSIONE})`)
        .eq('hash', hash).eq('tipo', tipo).limit(1));
      if (error) throw fallito('token non letto', error);
      return ((data ?? [])[0] as unknown as TokenRiga | undefined) ?? null;
    },
    async creaSessione(r) {
      const { data, error } = await sb.from('chat_sessioni').insert(r).select(COL_SESSIONE).single();
      if (error || !data) throw fallito('sessione non creata', error);
      return data as Sessione;
    },
    async creaToken(r) {
      const { error } = await sb.from('chat_token').insert(r);
      if (error) throw fallito('token non salvato', error);
    },
    async tokenAttivi(sessioneId, oraIso) {
      const { data, error } = await retryOnce(() => sb.from('chat_token').select('id').eq('sessione_id', sessioneId).eq('tipo', 'chat')
        .is('revocato_at', null).gt('scade_at', oraIso).order('created_at', { ascending: false }).limit(50));
      if (error) throw fallito('token attivi non letti', error);
      return (data ?? []) as { id: string }[];
    },
    async revocaToken(ids, oraIso) {
      const { error } = await sb.from('chat_token').update({ revocato_at: oraIso }).in('id', ids).is('revocato_at', null);
      if (error) throw fallito('token non revocati', error);
    },
    async usaToken(id, oraIso) {
      const { error } = await sb.from('chat_token').update({ usato_at: oraIso }).eq('id', id);
      if (error) throw fallito('uso del token non scritto', error);
    },
    async aggiornaSessione(id, patch, se) {
      let q = sb.from('chat_sessioni').update(patch).eq('id', id);
      if (se.stato !== undefined) q = q.eq('stato', se.stato);
      if (se.passaggi !== undefined) q = q.eq('passaggi', se.passaggi);
      if (se.risposta !== undefined) q = se.risposta === null ? q.is('ultima_risposta_staff_at', null) : q.eq('ultima_risposta_staff_at', se.risposta);
      const { data, error } = await q.select(COL_SESSIONE);
      if (error) throw fallito('sessione non aggiornata', error);
      return ((data ?? [])[0] as Sessione | undefined) ?? null;
    },
    async sessione(id) {
      const { data, error } = await retryOnce(() => sb.from('chat_sessioni').select(COL_SESSIONE).eq('id', id).limit(1));
      if (error) throw fallito('sessione non letta', error);
      return ((data ?? [])[0] as Sessione | undefined) ?? null;
    },
    async inserisciMessaggi(righe) {
      const { data, error } = await sb.from('chat_messaggi').upsert(righe, { onConflict: 'sessione_id,client_msg_id', ignoreDuplicates: true }).select(COL_MESSAGGIO);
      if (error) throw fallito('messaggio non salvato', error);
      return (data ?? []) as Messaggio[];
    },
    async messaggioCliente(sessioneId, clientId) {
      const { data, error } = await retryOnce(() => sb.from('chat_messaggi').select('created_at').eq('sessione_id', sessioneId).eq('client_msg_id', clientId).limit(1));
      if (error) throw fallito('messaggio non riletto', error);
      return ((data ?? [])[0] as { created_at: string } | undefined) ?? null;
    },
    async messaggiDopo(sessioneId, dopo, limite) {
      const { data, error } = await retryOnce(() => sb.from('chat_messaggi').select(COL_MESSAGGIO).eq('sessione_id', sessioneId).gt('seq', dopo)
        .order('seq', { ascending: true }).limit(limite));
      if (error) throw fallito('messaggi non letti', error);
      return (data ?? []) as Messaggio[];
    },
    async segnaViste(ids, oraIso) {
      const { error } = await sb.from('chat_messaggi').update({ delivered_at: oraIso }).in('id', ids).eq('autore', 'staff').is('delivered_at', null);
      if (error) throw fallito('vista in chat non scritta', error);
    },
    async evento(r) {
      if (r.chiave === null) {
        const { error } = await sb.from('chat_eventi').insert(r);
        if (error) throw fallito('evento non scritto', error);
        return true;
      }
      const { data, error } = await sb.from('chat_eventi').upsert(r, { onConflict: 'chiave', ignoreDuplicates: true }).select('id');
      if (error) throw fallito('evento non scritto', error);
      return (data ?? []).length > 0;
    },
    async esitoEvento(chiave, esito, dettaglio) {
      const { error } = await sb.from('chat_eventi').update({ esito, dettaglio }).eq('chiave', chiave);
      if (error) throw fallito('esito della push non scritto', error);
    },
    async faq(id) {
      const { data, error } = await retryOnce(() => sb.from('cs_faq').select('testo_it, testo_en, attiva').eq('id', id).in('tipo', ['faq', 'risposta_standard', 'risposta_chat']).limit(1));
      if (error) throw fallito('risposta fissa non letta', error);
      return ((data ?? [])[0] as { testo_it: string | null; testo_en: string | null; attiva: boolean } | undefined) ?? null;
    },
    // la gravita' del giorno dai contatori glob:sev_* (sopravvivono al refresh delle 06:00); lettura fallita = si scrive
    // comunque con la gravita' di questa richiesta, mai si salta un errore
    async salute(giorno, n, severity, causa) {
      const finestra = `${giorno}T00:00:00Z`;
      const { data, error } = await retryOnce(() => sb.from('chat_contatori').select('chiave, n').in('chiave', ['glob:sev_error', 'glob:sev_warn']).eq('finestra', finestra).limit(2));
      if (error) console.error('chat-api: gravita del giorno non letta', codice(error));
      let errori = 0;
      let avvisi = 0;
      for (const r of (data ?? []) as { chiave: string; n: number }[]) {
        if (r.chiave === 'glob:sev_error') errori = r.n;
        if (r.chiave === 'glob:sev_warn') avvisi = r.n;
      }
      const delGiorno = errori > 0 ? 'error' : avvisi > 0 ? 'warn' : 'ok';
      const sev = GRAVITA[delGiorno] >= GRAVITA[severity] ? delGiorno : severity;
      const label = `chat-api ${VERSIONE}: ${n} richieste oggi, ${errori} con errore, ${avvisi} con avviso` + (causa ? ` | ${causa}` : '') + (error ? ' | gravita del giorno non letta' : '');
      const { error: e2 } = await sb.from('health_log').upsert({ day: giorno, k: 'chat_api', label, n, severity: sev, created_at: new Date().toISOString() }, { onConflict: 'day,k' });
      if (e2) throw fallito('health_log non scritto', e2);
    },
  };
}

// L'unica chiamata fuori della edge oltre a push-api: siteverify di Turnstile, 10 s di tetto, secret nel corpo.
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const siteverify = async (secret: string, token: string): Promise<unknown> => {
  const r = await fetch(SITEVERIFY_URL, { method: 'POST', body: new URLSearchParams({ secret, response: token }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('siteverify HTTP ' + r.status);
  return await r.json();
};
const env = (k: string) => (Deno.env.get(k) ?? '').trim();
const DB = dbSupabase(createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } }));
// EdgeRuntime.waitUntil tiene viva l'istanza fino alla fine della push e della riga di salute (Background Tasks di Supabase)
const sfondo = (p: Promise<unknown>) => {
  const er = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(p);
};

Deno.serve((req) => gestisci(req, {
  ora: Date.now(),
  segreti: { proxy: env('CHAT_APP_PROXY_SECRET'), turnstile: env('CHAT_TURNSTILE_PRODUZIONE_SECRET'), turnstileProva: env('CHAT_TURNSTILE_PROVA_SECRET') },
  db: DB,
  siteverify,
  push: (m) => inviaPush(m),
  sfondo,
  casuale: (n) => crypto.getRandomValues(new Uint8Array(n)),
  eco: rispondiEco,
  pagine: { riprendi: LIQUID_APRI + PAGINA_RIPRESA + LIQUID_CHIUDI },
}));
