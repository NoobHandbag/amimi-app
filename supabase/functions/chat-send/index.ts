// chat-send send-1 (2026-11-08): l'email da info@ di ogni risposta dello staff nella chat del sito, Fase 1 pezzo 3
// (docs/PROPOSTA_chat_sito.md 6.5 e 7.9 come modificate da D-8, modello ticket: ogni risposta dello staff parte SUBITO
// per email e compare anche nel widget; niente presenza ne' regola dei 2 minuti). Edge nuova (Regola 19 e D-29): cs-send
// vuole una persona che preme Invia su un thread Gmail esistente, qui l'email nasce dalla chat.
//
// Chiamate (POST JSON, verify_jwt = false in supabase/config.toml):
//   invia {messaggio_id}  Bearer = chiave di servizio (la usa chat-staff subito dopo `rispondi`, confronto a tempo
//                         costante come push-api). Vale anche a chat spenta: a chat_sito_enabled false le chat aperte
//                         ricevono ancora le risposte dello staff (5.8), e una risposta e' un clic di una persona.
//   giro {pin}            cron ogni 5 minuti (migr 0187), PIN neutro come tutti i cron, o chiave di servizio. Rete di
//                         sicurezza: manda i messaggi dello staff rimasti senza email da oltre 2 minuti (chiamata da
//                         chat-staff caduta) e chiude come `errore` "esito ignoto" le prenotazioni ferme da oltre 15
//                         minuti, mai rimandate (Gmail potrebbe averle spedite). Nessun input: chiamarlo in piu' non
//                         cambia cosa parte ne' a chi. Gira anche a chat spenta (scostamento dalla Regola 19, Gate 2
//                         B3): chiude solo consegne che una persona ha avviato.
// Esiti di Gmail: 2xx con id = `inviata`; 4xx/5xx = `errore` "non partita" (chat-staff `reinvia` puo' ritentarla);
// nessuna risposta o 2xx senza id leggibile = `errore` "esito ignoto", mai rimandata (Gate 2, B1). Dopo `revoca_accessi`
// (evento `staff_revoca`) le email partono senza il link "Continua la chat" (Gate 2, B2).
// Destinatario: SOLO l'email della sessione (mai dal client), ricontrollata qui (5.7: niente a capo, virgole, <>), mai
// un dominio riservato (example.com, .test, .invalid: non riceve nessuno); una sessione `prova` scrive solo a indirizzi
// del team, una vera mai al team. Il nome della cliente non entra mai negli header.
// Thread: la prima email della sessione apre un thread Gmail (chat_sessioni.gmail_thread_id), le altre rispondono li'
// con In-Reply-To e References dell'ultimo messaggio (letti col token gmail.readonly, ripuliti). Un solo apritore per
// sessione: prenotazione `<sessione>:thread:<thread vecchio o primo>` in chat_eventi (UNIQUE).
// Idempotenza (7.9, Regola 20): email_stato da null a `prenotata` con un update condizionato PRIMA di Gmail, poi
// `inviata` con l'id Gmail o `errore`; al massimo un'email per messaggio. Ogni email porta un token di ripresa nuovo
// (chat_token tipo `ripresa`, 256 bit, nel DB solo lo SHA-256, 30 giorni, D-10) nel link "Continua la chat", dopo il `#`.
// Regola 19: scrive solo chat_messaggi (colonne email_*), chat_sessioni.gmail_thread_id, chat_token, chat_eventi e la
// propria riga health_log `chat_send`; legge app_flags per la sola chiave cs_gmail_sa_key (mai stampata) e app_config
// per il PIN del cron. Nessuna scrittura in change_log, nessuna chiamata a write-api.
// Log: solo cause scritte nel codice e codici d'errore, mai testi, token, email o risposte di Gmail.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// ==== PURE:chat-send-gmail BEGIN ====
// Copia di cs-send (stesse funzioni, stesso testo): tests/chat_staff_send.mjs confronta l'impronta di ognuna con cs-send
// e diventa rosso se divergono (7.9, punto 24 di 7.6). Se cambi una delle due, cambia anche l'altra.
const GMAIL_USER = 'info@amimi.it';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE_SEND = 'https://www.googleapis.com/auth/gmail.send';
const SCOPE_READ = 'https://www.googleapis.com/auth/gmail.readonly';
function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemToPkcs8(pem: string): Uint8Array {
  const raw = pem.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s+/g, '');
  const bin = atob(raw);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function googleAccessTokenFor(sa: { client_email: string; private_key: string }, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(enc.encode(JSON.stringify({ iss: sa.client_email, sub: GMAIL_USER, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 })));
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(sa.private_key).buffer as ArrayBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claims}`)));
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`google_token ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token as string;
}
const b64 = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const wrap76 = (s: string): string => s.replace(/(.{76})/g, '$1\r\n');
const encHdr = (s: string): string => (/[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${b64(s)}?=` : s);
// ==== PURE:chat-send-gmail END ====

// ==== PURE:chat-send BEGIN ====
const VERSIONE = 'send-1';
const GIRO_MAX = 20;                              // 7.3 (c): al massimo 20 email per giro
const ATTESA_GIRO_MS = 2 * 60 * 1000;             // il giro lascia 2 minuti alla via immediata di chat-staff
const PRENOTATA_MAX_MS = 15 * 60 * 1000;          // 7.9: oltre, esito ignoto, mai rimandata
const RISERVA_THREAD_MAX_MS = 15 * 60 * 1000;     // apritore del thread morto a meta': dopo 15 minuti si apre lo stesso
const RIPRESA_MS = 30 * 86400 * 1000;             // D-10
const CORPO_MAX_BYTE = 4096;
const LINK_RIPRESA = 'https://amimi.it/apps/chat/riprendi#t=';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 5.7, uguale a chat-api: una sola email, senza spazi, controlli, caratteri di formato e <>,;"
const EMAIL_RE = /^[^\s\p{C}<>,;"@]+@[^\s\p{C}<>,;"@]+\.[^\s\p{C}<>,;"@]+$/u;
const SQUADRA_RE = /@(?:amimi\.it|telaioconsulting\.com)$/;
// in piu' di EMAIL_RE: solo caratteri ASCII ammessi senza virgolette, niente commenti `()` ne' `[]\:` (Gate 2, C3: con
// `info@amimi.it(x)` il controllo del team si aggirava e Gmail avrebbe consegnato lo stesso)
const EMAIL_ASCII_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
// RFC 2606 e 6761: domini che non ricevono posta (la sessione di prova del pezzo 2 usa example.com)
const RISERVATI_RE = /(?:^|\.)(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/;
// Message-ID e References arrivano dal thread, quindi anche dalla cliente: entrano negli header solo se hanno forma di id
const MSGID_RE = /^<[\x21-\x3b\x3d\x3f-\x7e]{1,250}>$/;
const OGGETTO: Record<string, string> = { it: 'La tua richiesta in chat - Amimì', en: 'Your chat request - Amimì' };
const PIEDE_SENZA_LINK: Record<string, string> = { it: 'Per rispondere scrivi a questa email.', en: 'To reply, just answer this email.' };
const PIEDE: Record<string, string> = {
  it: 'Puoi rispondere a questa email oppure continuare la chat sul sito (il link vale 30 giorni):',
  en: 'You can reply to this email or continue the chat on our website (the link is valid for 30 days):',
};

type Sess = { id: string; stato: string; customer_email: string; lingua: string; prova: boolean; gmail_thread_id: string | null };
type Msg = { id: string; sessione_id: string; seq: number; autore: string; testo: string; email_stato: string | null; email_at: string | null; created_at: string };
type Intestazioni = { messageId: string; references: string };
type Gmail = {
  thread(threadId: string): Promise<{ status: number; ultimo: Intestazioni | null } | null>;   // null = senza scope di lettura
  invia(raw: string, threadId: string | null): Promise<{ status: number; id: string; threadId: string }>;
};
interface Db {
  pinOk(pin: string): Promise<boolean>;
  messaggio(id: string): Promise<Msg | null>;
  inCoda(primaDiIso: string, limite: number): Promise<Msg[]>;
  prenotateScadute(primaDiIso: string, limite: number): Promise<Msg[]>;
  sessione(id: string): Promise<Sess | null>;
  prenota(id: string, oraIso: string): Promise<boolean>;
  rilascia(id: string): Promise<void>;
  esito(id: string, patch: Record<string, unknown>, daStato: 'prenotata' | null, emailAt?: string | null): Promise<boolean>;
  riservaThread(sessioneId: string, chiave: string): Promise<boolean>;
  riservaAt(chiave: string): Promise<string | null>;
  revocata(sessioneId: string): Promise<boolean>;
  liberaThread(chiave: string): Promise<void>;
  salvaThread(sessioneId: string, threadId: string, vecchio: string | null): Promise<boolean>;
  creaRipresa(sessioneId: string, hash: string, scadeIso: string): Promise<void>;
  evento(r: { sessione_id: string | null; tipo: string; esito: string | null; dettaglio: Record<string, unknown> }): Promise<void>;
  conteggi(oraIso: string): Promise<{ errori: number; coda: number }>;
  salute(giorno: string, n: number, sev: string, label: string): Promise<void>;
}
type Ambiente = {
  ora: number;
  servizio: string;
  db: Db;
  apriGmail: () => Promise<Gmail>;
  casuale: (n: number) => Uint8Array;
};
type Esito = 'inviata' | 'errore' | 'gia_gestito' | 'in_attesa_thread' | 'thread_non_leggibile' | 'gmail_non_disponibile' | 'riprova';

class ErroreDb extends Error {
  causa: string;
  constructor(causa: string) { super(causa); this.causa = causa; }
}

const HEADER: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: HEADER });
const iso = (ms: number) => new Date(ms).toISOString();
const esadecimale = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
async function sha256hex(s: string): Promise<string> {
  return esadecimale(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}
// come push-api: nessun ritorno dentro il ciclo, stessa durata a lunghezze diverse
function ugualeCostante(a: string, b: string): boolean {
  const x = new TextEncoder().encode(String(a ?? '')), y = new TextEncoder().encode(String(b ?? ''));
  const n = Math.max(x.length, y.length);
  let d = x.length ^ y.length;
  for (let i = 0; i < n; i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return n > 0 && d === 0;
}

// destinatario o causa del rifiuto (testo fisso, finisce in email_errore: niente @)
function destinatario(s: Sess): { email: string } | { causa: string } {
  const e = String(s.customer_email ?? '').trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e) || !EMAIL_ASCII_RE.test(e)) return { causa: 'destinatario non valido' };
  if (RISERVATI_RE.test(e.slice(e.lastIndexOf('@') + 1))) return { causa: 'destinatario su un dominio riservato' };
  const squadra = SQUADRA_RE.test(e);
  if (s.prova && !squadra) return { causa: 'chat di prova: solo indirizzi del team' };
  if (!s.prova && squadra) return { causa: 'destinatario del team su una chat vera' };
  return { email: e };
}
function intestazioniPulite(u: Intestazioni | null): { inReplyTo: string; references: string } {
  const id = u && MSGID_RE.test(u.messageId.trim()) ? u.messageId.trim() : '';
  if (!id) return { inReplyTo: '', references: '' };
  const refs = String(u?.references ?? '').split(/\s+/).filter((r) => MSGID_RE.test(r)).slice(-20);
  return { inReplyTo: id, references: [...refs.filter((r) => r !== id), id].join(' ') };
}
// ultimo messaggio vero del thread (niente bozze ne' cestino), dalla risposta di threads.get con format=metadata
function ultimoDelThread(j: unknown): Intestazioni | null {
  const msgs = ((j as { messages?: { labelIds?: string[]; payload?: { headers?: { name?: string; value?: string }[] } }[] })?.messages ?? [])
    .filter((m) => !(m.labelIds ?? []).includes('DRAFT') && !(m.labelIds ?? []).includes('TRASH'));
  const last = msgs[msgs.length - 1];
  if (!last) return null;
  const h = (n: string) => (last.payload?.headers ?? []).find((x) => x.name?.toLowerCase() === n)?.value ?? '';
  return { messageId: h('message-id'), references: h('references') };
}
// link null = accessi revocati dallo staff (5.4): l'email parte senza "Continua la chat"
function componiMime(to: string, lingua: string, nuovo: boolean, testo: string, link: string | null, h: { inReplyTo: string; references: string }): string {
  const l = lingua === 'en' ? 'en' : 'it';
  const piede = link ? `${PIEDE[l]}\n${link}` : PIEDE_SENZA_LINK[l];
  const corpo = `${testo.replace(/\r\n?/g, '\n')}\n\n--\n${piede}\n\nAmimì Milano\n`.replace(/\n/g, '\r\n');
  return [
    `From: ${encHdr('Amimì')} <${GMAIL_USER}>`,
    `To: <${to}>`,
    `Subject: ${encHdr((nuovo ? '' : 'Re: ') + OGGETTO[l])}`,
    ...(h.inReplyTo ? [`In-Reply-To: ${h.inReplyTo}`, `References: ${h.references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(corpo)),
  ].join('\r\n');
}

async function chiudiSenzaInvio(amb: Ambiente, m: Msg, causa: string): Promise<Esito> {
  const ora = iso(amb.ora);
  const fatto = await amb.db.esito(m.id, { email_stato: 'errore', email_errore: causa, email_at: ora }, null);
  if (fatto) await amb.db.evento({ sessione_id: m.sessione_id, tipo: 'email', esito: 'errore', dettaglio: { seq: m.seq, causa } }).catch(() => undefined);
  return fatto ? 'errore' : 'gia_gestito';
}

// Un messaggio dello staff: al massimo un'email, mai dopo una prenotazione altrui. Gmail si apre solo se serve.
async function processa(amb: Ambiente, m: Msg, gm: () => Promise<Gmail>): Promise<Esito> {
  if (m.autore !== 'staff' || m.email_stato !== null) return 'gia_gestito';
  const s = await amb.db.sessione(m.sessione_id);
  if (!s) return 'gia_gestito';
  const dest = destinatario(s);
  if ('causa' in dest) return await chiudiSenzaInvio(amb, m, dest.causa);
  let g: Gmail;
  try { g = await gm(); } catch { return 'gmail_non_disponibile'; }

  let threadVecchio = s.gmail_thread_id;
  let ultimo: Intestazioni | null = null;
  if (threadVecchio) {
    let t: { status: number; ultimo: Intestazioni | null } | null;
    try { t = await g.thread(threadVecchio); } catch { return 'thread_non_leggibile'; }
    if (t && t.status === 404) threadVecchio = null;                // thread cancellato in Gmail: se ne apre uno nuovo
    else if (t && t.status >= 400 && t.status < 500) return await chiudiSenzaInvio(amb, m, `non partita: thread gmail ${t.status}`);   // Gate 2, C5
    else if (t && t.status !== 200) return 'thread_non_leggibile';  // 5xx: resta in coda per il giro dopo
    else ultimo = t?.ultimo ?? null;
  }
  const nuovo = threadVecchio === null;
  const ora = iso(amb.ora);
  if (!(await amb.db.prenota(m.id, ora))) return 'gia_gestito';
  // da qui il messaggio e' nostro; finche' Gmail non e' chiamato si rilascia (e si libera il thread prenotato)
  let chiave: string | null = null;
  let raw = '';
  let esitoSenzaInvio: Esito | null = null;
  try {
    if (nuovo) {
      const k = `${s.id}:thread:${(s.gmail_thread_id ?? 'primo').toLowerCase()}`;
      if (await amb.db.riservaThread(s.id, k)) chiave = k;
      else {
        const at = await amb.db.riservaAt(k);
        if (at === null || amb.ora - Date.parse(at) < RISERVA_THREAD_MAX_MS) esitoSenzaInvio = 'in_attesa_thread';
      }
    }
    if (!esitoSenzaInvio) {
      let link: string | null = null;
      if (!(await amb.db.revocata(s.id))) {
        const token = b64url(amb.casuale(32));
        await amb.db.creaRipresa(s.id, await sha256hex(token), iso(amb.ora + RIPRESA_MS));
        link = LINK_RIPRESA + token + (s.prova ? '&prova=1' : '');
      }
      raw = b64url(new TextEncoder().encode(componiMime(dest.email, s.lingua, nuovo, m.testo, link, intestazioniPulite(ultimo))));
    }
  } catch {
    esitoSenzaInvio = 'riprova';
  }
  const libera = async () => { if (chiave) await amb.db.liberaThread(chiave).catch(() => undefined); };
  if (esitoSenzaInvio) {
    // Gmail non e' stato chiamato: il messaggio torna in coda, con una scrittura sola (Gate 2, C6)
    await amb.db.rilascia(m.id).catch(() => undefined);
    await libera();
    return esitoSenzaInvio;
  }

  let r: { status: number; id: string; threadId: string };
  try { r = await g.invia(raw, nuovo ? null : threadVecchio); } catch {
    await amb.db.esito(m.id, { email_stato: 'errore', email_errore: 'esito ignoto: Gmail non ha risposto', email_at: iso(amb.ora) }, 'prenotata', ora).catch(() => undefined);
    await amb.db.evento({ sessione_id: s.id, tipo: 'email', esito: 'errore', dettaglio: { seq: m.seq, causa: 'esito ignoto' } }).catch(() => undefined);
    return 'errore';
  }
  if (r.status >= 200 && r.status < 300 && !r.id) {
    // Gmail ha accettato ma la risposta non si legge (corpo troncato dal timeout, non JSON): l'email puo' essere partita.
    // Mai rimandabile e thread prenotato tenuto, come un esito ignoto (Gate 2, B1).
    await amb.db.esito(m.id, { email_stato: 'errore', email_errore: 'esito ignoto: risposta di Gmail illeggibile', email_at: iso(amb.ora) }, 'prenotata', ora).catch(() => undefined);
    await amb.db.evento({ sessione_id: s.id, tipo: 'email', esito: 'errore', dettaglio: { seq: m.seq, causa: 'esito ignoto' } }).catch(() => undefined);
    return 'errore';
  }
  if (r.status < 200 || r.status >= 300) {
    const causa = `non partita: gmail ${Number.isInteger(r.status) ? r.status : 0}`;
    await libera();
    await amb.db.esito(m.id, { email_stato: 'errore', email_errore: causa, email_at: iso(amb.ora) }, 'prenotata', ora).catch(() => undefined);
    await amb.db.evento({ sessione_id: s.id, tipo: 'email', esito: 'errore', dettaglio: { seq: m.seq, causa } }).catch(() => undefined);
    return 'errore';
  }
  // l'email E' partita: da qui nessun esito di errore, solo avvisi
  const dettaglio: Record<string, unknown> = { seq: m.seq, nuovo_thread: nuovo, prova: s.prova };
  try {
    if (!(await amb.db.esito(m.id, { email_stato: 'inviata', email_gmail_id: String(r.id).slice(0, 64), email_at: iso(amb.ora) }, 'prenotata', ora))) dettaglio.esito_non_scritto = true;
  } catch { dettaglio.esito_non_scritto = true; }
  if (nuovo && r.threadId) {
    try { if (!(await amb.db.salvaThread(s.id, String(r.threadId).slice(0, 64), s.gmail_thread_id))) dettaglio.thread_non_salvato = true; }
    catch { dettaglio.thread_non_salvato = true; }
  } else if (!nuovo && r.threadId && r.threadId !== threadVecchio) dettaglio.thread_cambiato = true;
  await amb.db.evento({ sessione_id: s.id, tipo: 'email', esito: 'inviata', dettaglio }).catch(() => undefined);
  return 'inviata';
}

// un solo Gmail per richiesta, aperto alla prima email da mandare
function gmailPigro(amb: Ambiente): () => Promise<Gmail> {
  let p: Promise<Gmail> | null = null;
  return () => (p ??= amb.apriGmail());
}

async function leggiCorpo(req: Request): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get('content-length') ?? 0) > CORPO_MAX_BYTE) return null;
  const t = await req.text();
  if (t.length > CORPO_MAX_BYTE) return null;
  try {
    const d = JSON.parse(t);
    return d !== null && typeof d === 'object' && !Array.isArray(d) ? d as Record<string, unknown> : null;
  } catch { return null; }
}

// Gira anche a chat spenta, scostamento dichiarato dalla Regola 19 (Gate 2, B3): a chat_sito_enabled false lo staff
// risponde ancora alle chat aperte e `invia` manda; il giro chiude soltanto consegne che una persona ha gia' avviato
// (rimandate, prenotazioni scadute) e scrive la salute. Senza risposte dello staff non fa niente.
async function giro(amb: Ambiente): Promise<Response> {
  const ora = iso(amb.ora);
  const conti: Record<string, number> = {};
  const conta = (k: string) => { conti[k] = (conti[k] ?? 0) + 1; };
  for (const m of await amb.db.prenotateScadute(iso(amb.ora - PRENOTATA_MAX_MS), 50)) {
    if (await amb.db.esito(m.id, { email_stato: 'errore', email_errore: 'esito ignoto: prenotazione scaduta', email_at: ora }, 'prenotata', m.email_at)) {
      conta('scadute');
      await amb.db.evento({ sessione_id: m.sessione_id, tipo: 'email', esito: 'errore', dettaglio: { seq: m.seq, causa: 'esito ignoto' } }).catch(() => undefined);
    }
  }
  const coda = await amb.db.inCoda(iso(amb.ora - ATTESA_GIRO_MS), GIRO_MAX + 1);
  const gm = gmailPigro(amb);
  for (const m of coda.slice(0, GIRO_MAX)) {
    try { conta(await processa(amb, m, gm)); } catch { conta('riprova'); }
  }
  let sev = 'ok';
  const cause: string[] = [];
  if (coda.length > GIRO_MAX) { sev = 'warn'; cause.push(`coda oltre ${GIRO_MAX}`); }
  if (conti.gmail_non_disponibile) { sev = 'error'; cause.push('Gmail non disponibile'); }
  if (conti.riprova || conti.thread_non_leggibile) { if (sev === 'ok') sev = 'warn'; cause.push('invii rimandati'); }
  let c = { errori: 0, coda: 0 };
  try { c = await amb.db.conteggi(ora); } catch { if (sev === 'ok') sev = 'warn'; cause.push('conteggi non letti'); }
  if (c.errori > 0 || c.coda > 0) sev = 'error';
  const label = `chat-send ${VERSIONE}: ${conti.inviata ?? 0} inviate in questo giro, ${c.errori} non partite nelle 24 ore, ${c.coda} in coda da oltre 10 minuti`
    + (cause.length ? ' | ' + cause.join(', ') : '');
  try { await amb.db.salute(ora.slice(0, 10), c.errori + c.coda, sev, label); } catch { /* telemetria: mai bloccante */ }
  return json({ ok: true, ...conti, coda: Math.min(coda.length, GIRO_MAX) });
}

async function gestisci(req: Request, amb: Ambiente): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const d = await leggiCorpo(req);
  if (!d) return json({ ok: false, error: 'json_non_valido' }, 400);
  const authz = req.headers.get('Authorization') ?? '';
  const bearer = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
  const servizio = bearer !== '' && amb.servizio !== '' && ugualeCostante(bearer, amb.servizio);
  try {
    if (d.action === 'invia') {
      if (!servizio) return json({ ok: false, error: 'non_autorizzato' }, 401);
      const id = typeof d.messaggio_id === 'string' && UUID_RE.test(d.messaggio_id) ? d.messaggio_id.toLowerCase() : null;
      if (!id) return json({ ok: false, error: 'messaggio_id' }, 422);
      const m = await amb.db.messaggio(id);
      if (!m) return json({ ok: false, error: 'messaggio_inesistente' }, 404);
      return json({ ok: true, esito: await processa(amb, m, gmailPigro(amb)) });
    }
    if (d.action === 'giro') {
      if (!servizio && !(typeof d.pin === 'string' && d.pin !== '' && await amb.db.pinOk(d.pin))) return json({ ok: false, error: 'non_autorizzato' }, 401);
      return await giro(amb);
    }
    return json({ ok: false, error: 'azione_sconosciuta' }, 400);
  } catch (x) {
    return json({ ok: false, error: 'riprova', causa: x instanceof ErroreDb ? x.causa : 'eccezione' }, 503);
  }
}
// ==== PURE:chat-send END ====

// ---- adattatori (service role). Letture con un ritentativo, scritture mai (Regola 20d). ----
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
  console.error('chat-send: ' + causa, codice(e));
  return new ErroreDb(causa);
};
const COL_MSG = 'id, sessione_id, seq, autore, testo, email_stato, email_at, created_at';

function dbSupabase(sb: SupabaseClient): Db {
  return {
    async pinOk(pin) {
      const { data, error } = await retryOnce(() => sb.from('app_config').select('pin_hash').eq('id', 1).limit(1));
      if (error) throw fallito('PIN non letto', error);
      const h = String(((data ?? [])[0] as { pin_hash?: unknown } | undefined)?.pin_hash ?? '');
      return h !== '' && ugualeCostante(await sha256hex(pin), h);
    },
    async messaggio(id) {
      const { data, error } = await retryOnce(() => sb.from('chat_messaggi').select(COL_MSG).eq('id', id).limit(1));
      if (error) throw fallito('messaggio non letto', error);
      return ((data ?? [])[0] as Msg | undefined) ?? null;
    },
    async inCoda(primaDi, limite) {
      const { data, error } = await retryOnce(() => sb.from('chat_messaggi').select(COL_MSG).eq('autore', 'staff').is('email_stato', null)
        .lt('created_at', primaDi).order('created_at', { ascending: true }).limit(limite));
      if (error) throw fallito('coda non letta', error);
      return (data ?? []) as Msg[];
    },
    async prenotateScadute(primaDi, limite) {
      const { data, error } = await retryOnce(() => sb.from('chat_messaggi').select(COL_MSG).eq('autore', 'staff').eq('email_stato', 'prenotata')
        .lt('email_at', primaDi).order('email_at', { ascending: true }).limit(limite));
      if (error) throw fallito('prenotazioni non lette', error);
      return (data ?? []) as Msg[];
    },
    async sessione(id) {
      const { data, error } = await retryOnce(() => sb.from('chat_sessioni').select('id, stato, customer_email, lingua, prova, gmail_thread_id').eq('id', id).limit(1));
      if (error) throw fallito('sessione non letta', error);
      return ((data ?? [])[0] as Sess | undefined) ?? null;
    },
    async prenota(id, ora) {
      const { data, error } = await sb.from('chat_messaggi').update({ email_stato: 'prenotata', email_at: ora }).eq('id', id).eq('autore', 'staff').is('email_stato', null).select('id');
      if (error) throw fallito('prenotazione non scritta', error);
      return (data ?? []).length === 1;
    },
    async rilascia(id) {
      const { error } = await sb.from('chat_messaggi').update({ email_stato: null, email_at: null }).eq('id', id).eq('email_stato', 'prenotata');
      if (error) throw fallito('prenotazione non rilasciata', error);
    },
    async esito(id, patch, daStato, emailAt) {
      let q = sb.from('chat_messaggi').update(patch).eq('id', id);
      q = daStato === null ? q.is('email_stato', null) : q.eq('email_stato', daStato);
      if (emailAt) q = q.eq('email_at', emailAt);
      const { data, error } = await q.select('id');
      if (error) throw fallito('esito non scritto', error);
      return (data ?? []).length === 1;
    },
    async riservaThread(sessioneId, chiave) {
      const { data, error } = await sb.from('chat_eventi').upsert({ sessione_id: sessioneId, tipo: 'thread_email', chiave, esito: 'prenotato', dettaglio: {} },
        { onConflict: 'chiave', ignoreDuplicates: true }).select('id');
      if (error) throw fallito('prenotazione del thread non scritta', error);
      return (data ?? []).length === 1;
    },
    async riservaAt(chiave) {
      const { data, error } = await retryOnce(() => sb.from('chat_eventi').select('at').eq('chiave', chiave).limit(1));
      if (error) throw fallito('prenotazione del thread non letta', error);
      return ((data ?? [])[0] as { at?: string } | undefined)?.at ?? null;
    },
    async revocata(sessioneId) {
      const { data, error } = await retryOnce(() => sb.from('chat_eventi').select('id').eq('sessione_id', sessioneId).eq('tipo', 'staff_revoca').limit(1));
      if (error) throw fallito('revoca non letta', error);
      return (data ?? []).length > 0;
    },
    async liberaThread(chiave) {
      const { error } = await sb.from('chat_eventi').delete().eq('chiave', chiave).eq('tipo', 'thread_email').eq('esito', 'prenotato');
      if (error) throw fallito('prenotazione del thread non liberata', error);
    },
    async salvaThread(sessioneId, threadId, vecchio) {
      let q = sb.from('chat_sessioni').update({ gmail_thread_id: threadId, updated_at: new Date().toISOString() }).eq('id', sessioneId);
      q = vecchio === null ? q.is('gmail_thread_id', null) : q.eq('gmail_thread_id', vecchio);
      const { data, error } = await q.select('id');
      if (error) throw fallito('thread non salvato', error);
      return (data ?? []).length === 1;
    },
    async creaRipresa(sessioneId, hash, scade) {
      const { error } = await sb.from('chat_token').insert({ sessione_id: sessioneId, tipo: 'ripresa', hash, scade_at: scade });
      if (error) throw fallito('token di ripresa non salvato', error);
    },
    async evento(r) {
      const { error } = await sb.from('chat_eventi').insert({ ...r, chiave: null, chi: 'chat-send' });
      if (error) throw fallito('evento non scritto', error);
    },
    async conteggi(ora) {
      const t = Date.parse(ora);
      const [e, c] = await Promise.all([
        retryOnce(() => sb.from('chat_messaggi').select('id', { count: 'exact', head: true }).eq('autore', 'staff').eq('email_stato', 'errore').gt('email_at', new Date(t - 86400000).toISOString())),
        retryOnce(() => sb.from('chat_messaggi').select('id', { count: 'exact', head: true }).eq('autore', 'staff').is('email_stato', null).lt('created_at', new Date(t - 600000).toISOString())),
      ]);
      if (e.error || c.error) throw fallito('conteggi non letti', e.error ?? c.error);
      return { errori: e.count ?? 0, coda: c.count ?? 0 };
    },
    async salute(giorno, n, severity, label) {
      const { error } = await sb.from('health_log').upsert({ day: giorno, k: 'chat_send', label, n, severity, created_at: new Date().toISOString() }, { onConflict: 'day,k' });
      if (error) throw fallito('health_log non scritto', error);
    },
  };
}

// Gmail col service account di cs-send (app_flags.cs_gmail_sa_key, letta solo qui e mai stampata): token di invio
// obbligatorio, token di lettura solo per gli header del thread (senza, si risponde nel thread senza In-Reply-To).
async function apriGmail(sb: SupabaseClient): Promise<Gmail> {
  const { data, error } = await retryOnce(() => sb.from('app_flags').select('value').eq('key', 'cs_gmail_sa_key').limit(1));
  if (error) throw fallito('chiave del service account non letta', error);
  let sa: { client_email?: string; private_key?: string };
  try { sa = JSON.parse(String(((data ?? [])[0] as { value?: unknown } | undefined)?.value ?? '')); } catch { throw new ErroreDb('chiave del service account non valida'); }
  if (!sa.client_email || !sa.private_key) throw new ErroreDb('chiave del service account incompleta');
  const cred = sa as { client_email: string; private_key: string };
  let invio: string;
  try { invio = await googleAccessTokenFor(cred, SCOPE_SEND); } catch { console.error('chat-send: token gmail.send non ottenuto'); throw new ErroreDb('token gmail.send'); }
  let lettura: string | null = null;
  try { lettura = await googleAccessTokenFor(cred, SCOPE_READ); } catch { lettura = null; }
  return {
    async thread(threadId) {
      if (!lettura) return null;
      const r = await fetch(`${GMAIL}/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`,
        { headers: { Authorization: `Bearer ${lettura}` }, signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => null);
      return { status: r.status, ultimo: r.ok ? ultimoDelThread(j) : null };
    },
    async invia(raw, threadId) {
      const r = await fetch(`${GMAIL}/messages/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${invio}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
        signal: AbortSignal.timeout(20000),
      });
      const j = (await r.json().catch(() => ({}))) as { id?: unknown; threadId?: unknown };
      return { status: r.status, id: typeof j.id === 'string' ? j.id : '', threadId: typeof j.threadId === 'string' ? j.threadId : '' };
    },
  };
}

const env = (k: string) => (Deno.env.get(k) ?? '').trim();
const SB = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const DB = dbSupabase(SB);

Deno.serve((req) => gestisci(req, {
  ora: Date.now(),
  servizio: env('SUPABASE_SERVICE_ROLE_KEY'),
  db: DB,
  apriGmail: () => apriGmail(SB),
  casuale: (n) => crypto.getRandomValues(new Uint8Array(n)),
}));
