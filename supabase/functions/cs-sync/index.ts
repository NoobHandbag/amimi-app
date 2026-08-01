// cs-sync v8 — tool assistenza clienti, FASE 1: ingest reale della posta cliente in cs_*.
// v8 (2026-08-01, brief cs_pulizia_moduli_form): lo STAMPO dei moduli del sito (form_contatto /
//   form_evento, wrapper "Hai ricevuto un nuovo messaggio dal modulo di contatto...") viene tolto
//   da `body_clean` in modo deterministico, ZERO AI: testa fino all'etichetta del campo libero
//   ("Corpo:" per il contatto, "...Nella Casella Della Richiesta:" per l'evento, tolleranti al
//   word-wrap di Gmail), coda dal legalese "Cliccando Su Invia" in poi. Il taglio avviene DOPO il
//   taglio citazioni (una NOSTRA risposta che quota il modulo non deve perdere il proprio testo)
//   ed e' gated sul CONTENUTO (wrapper presente), non solo sul canale. `extractFormFields`
//   RISCRITTA sul formato reale (etichetta su riga propria, valore sulla riga dopo: la versione
//   vecchia assumeva "label: valore" sulla stessa riga e non ha mai popolato nulla, 0/438) e
//   chiamata solo quando il wrapper c'e' davvero; {} non si scrive piu' (NULL). `backfill_clean`
//   ora ri-deriva anche `form_fields` (solo dove NULL/vuoto) sui messaggi col wrapper.
// v7 (2026-07-31, brief redesign thread + body_clean, Parte A): colonna `cs_messages.body_clean`
//   (migr 0081) = SOLO le parole del mittente, pulite in modo deterministico (ZERO AI) dalla
//   funzione condivisa `stripQuoted` (stessa famiglia di stripQuote: stessi QUOTE_MARKERS per
//   inbound e outbound, come chiesto dal brief): taglio alla prima attribution line (anche a
//   inizio corpo), via le righe quotate '>', via la firma '-- ', boilerplate Inbox estratto per
//   chat_notifica, whitespace normalizzato. Output vuoto -> NULL (la UI fa fallback su body_text:
//   MAI perdere contenuto; body_text resta INTATTO). Valorizzata a ogni insert (in e out) +
//   azione `backfill_clean` (PIN, a blocchi) per lo storico gia' ingerito.
// v6 (2026-07-31, brief contesto risposte out): il replier ora VEDE le nostre risposte.
//   - la posta SENT non viene piu' scartata: un messaggio inviato entra come direction='out',
//     SOLO se il suo thread e' gia' in cs_conversations (fornitori/banca/newsletter restano fuori:
//     un out non crea MAI una conversazione) e mai sui thread 'rumore'. Niente classify sull'out.
//   - citazione del messaggio precedente TRONCATA (stripQuote: taglio al primo marcatore tipico
//     Gmail/Outlook IT+EN + cap 8000 char) per non gonfiare corpi, classificatore e prompt.
//   - azione `backfill_out` (PIN, una tantum, a blocchi con limit/offset): threads.get sui
//     gmail_thread_id gia' noti (canale != rumore) e ingest dei soli messaggi out mancanti;
//     idempotente (UNIQUE gmail_message_id), nessuna conversazione nuova, categorie intatte;
//     i corpi gia' scritti CONVERGONO se le regole di strip migliorano (out_aggiornati).
//   - `last_direction` DERIVATA dal messaggio piu' recente (prima era il letterale 'in').
//   - ricalcolo DETERMINISTICO dell'urgenza (recomputeUrgency) su nuovo messaggio in/out e nel
//     backfill: applica/spegne SOLO la regola sollecito di cs-classify (stessi motivi testuali),
//     senza AI, senza toccare categoria/categoria_source; un'urgenza decisa dall'AI non si tocca.
// v5 (2026-07-26): chat Shopify Inbox — se il "nome" nel subject e' un'email, va in customer_email.
// Design: Cowork12/projects/Servizio_Clienti_2026-06/DESIGN_Tool_Assistenza_Amimi_V1_2026-07-20.md
//
// Azione UNICA: `poll` (PIN-gated, verify_jwt=false come le altre edge, chiamata dal cron */2).
//   - Legge i messaggi NUOVI di info@amimi.it via Gmail API (service account + domain-wide delegation,
//     chiave in app_flags.cs_gmail_sa_key), classifica i 4 flussi cliente + pre-filtro rumore
//     (100% deterministico, ZERO AI in questa fase) e fa upsert idempotente in cs_conversations/cs_messages.
//   - Cursore Gmail in app_flags.cs_last_history_id: primo giro = SEED dal profilo (ingest nulla,
//     parte da qui in avanti, cosi' la coda non si riempie di storico); poi history.list incrementale;
//     404 (historyId scaduto) = RE-SEED + health_log warn (mai perdere il giro).
//   - dryRun=true: classifica i messaggi recenti e ritorna SOLO i CONTEGGI per flusso, scrive NULLA
//     (ne' righe ne' cursore): smoke test sicuro senza esporre contenuti.
//   - source='cron' + cs_enabled!='true' => skip: cs_enabled e' l'interruttore di go-live (deciso dall'owner).
//     Una poll MANUALE gira comunque (per test/diagnosi), ma la SEED-forward non ingerisce storico.
//   - Regola anti-perdita: se un messaggio non e' classificabile entra COMUNQUE come conversazione
//     'email_diretta' con parse_failed=true + evento cs_events 'parse_failed'. Mai persa, mai nel rumore.
//
// CURSORE (correttezza, dopo review): l'`historyId` che history.list ritorna e' SEMPRE il tip della
//   casella (identico su ogni pagina), NON un cursore per-pagina. Quindi si avanza cs_last_history_id
//   al tip SOLO se abbiamo drenato tutte le pagine E processato tutto; se ci si ferma prima (cap o
//   fallimento transitorio) si avanza all'id dell'ULTIMO record interamente processato, mai al tip:
//   il backlog si drena a blocchi e nessun messaggio viene mai scavalcato/perso.
//
// RIMOSSE le azioni Fase 0 `ping`/`status`: esponevano subject/from dell'ultimo messaggio a chiunque
//   conoscesse l'URL (caveat sicurezza). Ora le letture del tool passano dietro Supabase Auth (RLS
//   authenticated) e la edge ritorna solo conteggi.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const GMAIL_USER = 'info@amimi.it';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const BODY_MAX = 20000;
const MAX_MSGS_PER_POLL = 200;   // cap morbido: oltre, si drena al giro dopo (cursore = ultimo record sicuro)
const MAX_PAGES = 25;

// --- OAuth 2.0 JWT bearer grant: il service account impersona GMAIL_USER (domain-wide delegation) ---
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
async function googleAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(enc.encode(JSON.stringify({ iss: sa.client_email, sub: GMAIL_USER, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })));
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

// --- Gmail helpers ---
type Hdr = { name?: string; value?: string };
type Part = { mimeType?: string; filename?: string; body?: { data?: string }; parts?: Part[] };
type GMsg = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: { headers?: Hdr[]; mimeType?: string; body?: { data?: string }; parts?: Part[] } };

function decodeB64Url(data: string): string {
  let b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  b64 += '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
function findPart(part: Part | undefined, mime: string): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data && !part.filename) return decodeB64Url(part.body.data);
  for (const p of part.parts ?? []) { const r = findPart(p, mime); if (r) return r; }
  return null;
}
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}
function extractBody(payload: GMsg['payload']): string {
  if (!payload) return '';
  const plain = findPart(payload as Part, 'text/plain');
  if (plain != null) return plain.slice(0, BODY_MAX);
  const html = findPart(payload as Part, 'text/html');
  if (html != null) return stripHtml(html).slice(0, BODY_MAX);
  if (payload.body?.data) return decodeB64Url(payload.body.data).slice(0, BODY_MAX);
  return '';
}
const hdr = (headers: Hdr[] | undefined, name: string) => (headers ?? []).find((h) => h.name?.toLowerCase() === name)?.value ?? '';
// Postgres text/jsonb RIFIUTANO il byte NUL (): un corpo che lo contiene (capita, quoted-printable/
// base64) farebbe fallire deterministicamente ogni scrittura -> livelock del cursore. Si toglie a monte.
const stripNull = (s: string) => s.replace(/\u0000/g, '');
function parseAddr(v: string): { email: string; name: string } {
  const m = v.match(/<([^>]+)>/);
  const email = (m ? m[1] : v).trim().toLowerCase();
  let name = m ? v.slice(0, v.indexOf('<')).trim() : '';
  name = name.replace(/^["']|["']$/g, '').trim();
  return { email, name };
}

// --- classificazione deterministica dei flussi (design sez. 3, 5; niente AI) ---
type Canale = 'email_diretta' | 'form_contatto' | 'form_evento' | 'chat_notifica' | 'rumore';
const isAmimi = (e: string) => e.endsWith('@amimi.it');
const isShopifySender = (e: string) => e === 'mailer@shopify.com' || e.endsWith('@shopifyemail.com') || e.endsWith('@shopify.com');
function isNoiseSender(from: string, subject: string, extraDeny: string[]): boolean {
  const s = subject.toLowerCase();
  if (/dmarc/.test(from) || /^report[\s_-]?domain/i.test(subject) || s.includes('dmarc aggregate')) return true;   // report DMARC
  if (from === 'mailer-daemon@googlemail.com' || from.startsWith('mailer-daemon@') || from.startsWith('postmaster@')) return true; // bounce
  if (from.endsWith('@send.klaviyo.com') || from.endsWith('@klaviyomail.com') || from.endsWith('@bounce.klaviyo.com')) return true; // newsletter/marketing
  for (const d of extraDeny) { const t = d.trim().toLowerCase(); if (t && (from.includes(t) || s.includes(t))) return true; }  // denylist estendibile via app_flags.cs_noise_senders
  return false;
}
function classify(from: { email: string; name: string }, replyTo: { email: string; name: string }, subject: string, body: string, extraDeny: string[]): { canale: Canale; email: string | null; name: string | null } {
  const fe = from.email, rt = replyTo.email;
  // 1) Notifica chat Shopify Inbox: no-reply@mailer.shopify.com, subject "New Message from <nome>".
  //    Se il visitatore lascia l'email in chat, Shopify la usa come nome: catturarla in customer_email
  //    sblocca storia/ordine/bozze. La RISPOSTA resta dentro Shopify Inbox (Inbox non ha API pubblica).
  if (fe.endsWith('@mailer.shopify.com') && /new message|nuovo messaggio/i.test(subject)) {
    const nm = (subject.match(/from\s+(.+?)\s*$/i)?.[1] || from.name || '').trim();
    const asEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nm) ? nm.toLowerCase() : null;
    return { canale: 'chat_notifica', email: asEmail, name: nm || null };
  }
  // 2) Form del sito (mittente Shopify CON reply-to del cliente) vs 3) notifica admin Shopify (senza reply-to cliente)
  if (isShopifySender(fe)) {
    const custReplyTo = rt && rt !== fe && !isShopifySender(rt) && !isAmimi(rt);
    if (custReplyTo) {
      const isEvento = /evento|event/i.test(subject) || /hai un evento/i.test(body);
      return { canale: isEvento ? 'form_evento' : 'form_contatto', email: rt, name: replyTo.name || from.name || null };
    }
    return { canale: 'rumore', email: null, name: null };  // notifica amministrativa Shopify
  }
  // 4) Rumore noto (DMARC, bounce, newsletter, denylist owner)
  if (isNoiseSender(fe, subject, extraDeny)) return { canale: 'rumore', email: fe, name: from.name || null };
  // 5) Posta interna Amimi' (non e' un cliente)
  if (isAmimi(fe)) return { canale: 'rumore', email: fe, name: from.name || null };
  // 6) Default: un umano ci ha scritto direttamente = cliente (incl. risposte alle mail transazionali)
  return { canale: 'email_diretta', email: fe, name: from.name || null };
}
// v8: lo stampo REALE del modulo Shopify mette l'etichetta su una riga ("Name:") e il valore su
// quella DOPO, con una riga vuota tra i blocchi; la vecchia versione same-line non agganciava mai.
// Un'etichetta e' valida solo se corta (esclude la domanda lunga e il legalese) e preceduta da una
// riga vuota (esclude i frammenti di word-wrap tipo "...Della Richiesta:" a fine domanda).
function extractFormFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = (body || '').replace(/\r\n?/g, '\n').split('\n').slice(0, 60);
  const LABEL_RE = /^\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '/]{1,30})\s*:\s*$/;
  // 'corpo' e' il campo libero del form_contatto: il suo contenuto e' body_clean, non un campo
  const SKIP_KEYS = new Set(['corpo']);
  const keep = (k: string) => !SKIP_KEYS.has(k) && !k.includes('richiesta') && !k.includes('cliccando');
  for (let i = 0; i < lines.length; i++) {
    const same = lines[i].match(/^\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '/]{1,30}?)\s*:\s*(.+?)\s*$/);
    if (same) { const k = same[1].trim().toLowerCase(); if (keep(k) && !(k in out)) out[k] = same[2].trim().slice(0, 500); continue; }
    const label = lines[i].match(LABEL_RE);
    if (!label) continue;
    if (i > 0 && lines[i - 1].trim()) continue;   // frammento di wrap, non un'etichetta di campo
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const v = (lines[j] ?? '').trim();
    if (v && !LABEL_RE.test(v)) { const k = label[1].trim().toLowerCase(); if (keep(k) && !(k in out)) out[k] = v.slice(0, 500); }
  }
  return out;
}
// v8: riconoscimento + taglio dello stampo del modulo. Gated sul CONTENUTO: se il wrapper non c'e'
// (es. la risposta del cliente nello stesso thread) non tocca nulla. Ritorna null = "non era uno
// stampo riconoscibile" (il chiamante lascia il testo com'e', mai un taglio sbagliato); ritorna ''
// = stampo riconosciuto ma SENZA testo libero (a valle diventa body_clean NULL, la UI usa il grezzo).
const FORM_WRAP_RE = /Hai\s+ricevuto\s+un\s+nuovo\s+messaggio\s+dal\s+modulo\s+di\s+contatto/i;
function stripFormPrint(s: string): string | null {
  if (!FORM_WRAP_RE.test(s)) return null;
  // coda: legalese "Cliccando Su Invia ..." fino in fondo (include il "SÌ" di consenso)
  let t = s.replace(/(?:^|\n)\s*Cliccando\s+Su\s+Invia[\s\S]*$/i, '');
  // testa: tutto fino all'etichetta del campo libero (tollerante al word-wrap: \s+ attraversa i newline)
  const m = t.match(/(?:(?:^|\n)\s*Corpo|Nella\s+Casella\s+Della\s+Richiesta)\s*:\s*/i);
  if (!m || m.index == null) return null;   // wrapper presente ma formato ignoto: non tagliare
  t = t.slice(m.index + m[0].length);
  return t.trim();
}
function extractOrderNumber(text: string): number | null {
  const m = text.match(/(?:ordine|order|#)\s*#?\s*(\d{3,6})/i);
  return m ? Number(m[1]) : null;
}
const detectLingua = (t: string) => (/\b(the|your|order|hello|hi|please|thanks|would|available)\b/i.test(t) && !/\b(il|la|per|grazie|ordine|ciao|salve|vorrei|disponibile)\b/i.test(t) ? 'en' : 'it');

// v6: tronca la citazione del thread precedente nel corpo di una RISPOSTA (le mail Gmail includono
// tutto il quotato). Regola: taglio al PRIMO marcatore tipico (Gmail IT/EN, Outlook IT/EN, righe
// quotate '>'), poi cap 8000 char. Prevedibile e documentata; meglio perdere una coda ambigua che
// gonfiare corpi/classificatore/prompt col thread intero duplicato.
const QUOTE_MARKERS = [
  // NB: "Il giorno <data> <nome> <email> ha scritto:" nelle mail reali VA A CAPO nel mezzo
  // (l'email wrappa su una riga nuova): serve [\s\S] lazy, non '.', per attraversare i newline;
  // e il wrap puo' cadere anche PRIMA di "ha scritto"/"wrote", quindi \s al posto dello spazio.
  /\r?\nIl giorno [\s\S]{0,220}?\sha scritto:/i,   // Gmail IT
  /\r?\nOn [\s\S]{0,220}?\swrote:/i,               // Gmail EN
  /\r?\n-{2,}\s*(Original Message|Messaggio originale)\s*-{2,}/i,
  /\r?\n_{5,}\r?\n/,                              // divisore Outlook
  /\r?\nDa:\s.{1,120}\r?\n(Inviato|Data):/i,      // blocco header Outlook IT
  /\r?\nFrom:\s.{1,120}\r?\nSent:/i,              // blocco header Outlook EN
  /\r?\n>\s?(Il giorno|On|Da:|From:)\b/i,         // prima riga quotata col prefisso >
];
function stripQuote(t: string): string {
  let cut = t.length;
  for (const re of QUOTE_MARKERS) { const m = t.match(re); if (m && m.index != null && m.index < cut) cut = m.index; }
  return t.slice(0, cut).trim().slice(0, 8000);
}

// v7: pulizia COMPLETA per body_clean (funzione condivisa in/out, stessa famiglia di stripQuote:
// stessi QUOTE_MARKERS). In piu' rispetto a stripQuote: marcatore riconosciuto anche a INIZIO
// corpo (messaggio che e' solo una citazione -> NULL), via le righe quotate '>' residue, via la
// firma da '-- ' in poi, boilerplate della notifica Inbox estratto per chat_notifica, whitespace
// normalizzato. Ritorna NULL se non resta nulla: la UI fa fallback su body_text (mai perdere).
function stripQuoted(t: string, canale?: string): string | null {
  let s = t || '';
  if (canale === 'chat_notifica') {
    const m = s.match(/new message from[^\n]*\n+([\s\S]*?)\n+\s*Sent via Inbox/i);
    if (m) s = m[1];
  }
  // taglio alla prima attribution line; probe con \n iniettato per agganciare un marcatore a inizio corpo
  const probe = '\n' + s;
  let cut = s.length;
  for (const re of QUOTE_MARKERS) {
    const m = probe.match(re);
    if (m && m.index != null && Math.max(0, m.index - 1) < cut) cut = Math.max(0, m.index - 1);
  }
  s = s.slice(0, cut);
  const kept: string[] = [];
  for (const line of s.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*>/.test(line)) continue;          // riga quotata residua
    if (/^--\s*$/.test(line)) break;           // firma: da qui in poi via
    kept.push(line);
  }
  s = kept.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
  // v8: stampo del modulo del sito: via testa (campi) e coda (legalese), restano le parole della
  // cliente. DOPO il taglio citazioni: una NOSTRA risposta che quota il modulo ha gia' perso il
  // quotato qui sopra, quindi il wrapper non c'e' piu' e questo passo non la tocca.
  if (canale === 'form_contatto' || canale === 'form_evento') {
    const f = stripFormPrint(s);
    if (f !== null) s = f;
  }
  return s || null;
}

async function gGet(path: string, token: string): Promise<{ ok: boolean; status: number; j: Record<string, unknown> }> {
  const r = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

type Parsed = {
  cl: { canale: Canale; email: string | null; name: string | null };
  from: { email: string; name: string }; to: { email: string; name: string };
  subject: string; bodyText: string; sentAt: string | null; snippet: string;
  formFields: Record<string, string> | null; order: number | null; lingua: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg } = await sb.from('app_config').select('pin_hash').eq('id', 1).single();
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);

  const action = String(body.action || 'poll');
  if (action !== 'poll' && action !== 'backfill_out' && action !== 'backfill_clean') return json({ error: 'azione sconosciuta: ' + action }, 422);

  const flags: Record<string, string> = {};
  const { data: rows } = await sb.from('app_flags').select('key,value').in('key', ['cs_enabled', 'cs_last_history_id', 'cs_gmail_sa_key', 'cs_noise_senders']);
  for (const r of rows ?? []) flags[r.key] = r.value ?? '';

  const enabled = flags.cs_enabled === 'true';
  const source = String(body.source || 'manual');
  const dryRun = body.dryRun === true;
  if (source === 'cron' && !enabled) return json({ ok: true, skipped: 'disabled' });
  const extraDeny = (flags.cs_noise_senders || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

  const writeHealth = async (n: number, label: string, severity: 'ok' | 'warn' | 'error') => {
    const today = new Date().toISOString().slice(0, 10);
    await sb.from('health_log').delete().eq('day', today).eq('k', 'cs_sync');
    await sb.from('health_log').insert({ day: today, k: 'cs_sync', label, n, severity, created_at: new Date().toISOString() });
  };

  // --- chiave service account ---
  if (!flags.cs_gmail_sa_key) { if (!dryRun) await writeHealth(1, 'chiave SA assente', 'error'); return json({ ok: false, needs_key: true }); }
  let sa: { client_email?: string; private_key?: string };
  try { sa = JSON.parse(flags.cs_gmail_sa_key); } catch { if (!dryRun) await writeHealth(1, 'sa_key_invalid_json', 'error'); return json({ ok: false, error: 'sa_key_invalid_json' }); }
  if (!sa.client_email || !sa.private_key) return json({ ok: false, error: 'sa_key_missing_fields' });

  let token: string;
  try { token = await googleAccessToken(sa as { client_email: string; private_key: string }); }
  catch (e) { if (!dryRun) await writeHealth(1, 'google_auth_failed', 'error'); return json({ ok: false, error: 'google_auth_failed', detail: (e as Error).message.slice(0, 200) }); }

  const counts: Record<Canale, number> = { email_diretta: 0, form_contatto: 0, form_evento: 0, chat_notifica: 0, rumore: 0 };
  let parseFailed = 0;
  let outMsg = 0;

  // v6: ricalcolo DETERMINISTICO dell'urgenza. Replica ESATTAMENTE la regola sollecito di
  // cs-classify (ruleUrgency, stessi motivi testuali) e la applica/spegne quando i conteggi
  // in/out cambiano. MAI l'AI, MAI categoria/categoria_source (il filtro "pesca solo mai
  // tentate" di cs-classify resta intatto: fix 1 audit anti-loop). Un'urgenza decisa dall'AI
  // (motivo diverso dai due della regola) non viene mai toccata da qui.
  const RULE_MOTIVI = ['thread riaperto (sollecito)', '2+ messaggi senza nostra risposta'];
  const recomputeUrgency = async (convId: string): Promise<boolean> => {
    const { data: c } = await sb.from('cs_conversations')
      .select('id, stato, stato_at, last_direction, last_msg_at, categoria_source, urgente, urgenza_motivo, flags')
      .eq('id', convId).maybeSingle();
    if (!c || !c.categoria_source) return false;   // mai classificata: ci pensera' cs-classify alla pesca
    const { data: msgs } = await sb.from('cs_messages').select('direction').eq('conversation_id', convId);
    const inCnt = (msgs ?? []).filter((m) => m.direction === 'in').length;
    const outCnt = (msgs ?? []).filter((m) => m.direction === 'out').length;
    const reopened = String(c.stato) === 'fatto' && c.last_direction === 'in' && !!c.last_msg_at && (!c.stato_at || (c.last_msg_at as string) > (c.stato_at as string));
    const ruleUrg = reopened || (inCnt >= 2 && outCnt === 0);
    const ruleMotivo = reopened ? 'thread riaperto (sollecito)' : '2+ messaggi senza nostra risposta';
    const flags: string[] = Array.isArray(c.flags) ? [...new Set((c.flags as unknown[]).map(String))] : [];
    const upd: Record<string, unknown> = {};
    if (ruleUrg) {
      if (c.urgente !== true) { upd.urgente = true; upd.urgenza_motivo = ruleMotivo; }
      if (!flags.includes('sollecito')) upd.flags = [...flags, 'sollecito'];
    } else if (c.urgente === true && RULE_MOTIVI.includes(String(c.urgenza_motivo ?? ''))) {
      // l'urgenza era della REGOLA e la regola non vale piu' (abbiamo risposto): si spegne
      upd.urgente = false; upd.urgenza_motivo = null;
      if (flags.includes('sollecito')) upd.flags = flags.filter((f) => f !== 'sollecito');
    } else if (flags.includes('sollecito')) {
      upd.flags = flags.filter((f) => f !== 'sollecito');
    }
    if (!Object.keys(upd).length) return false;
    const { error } = await sb.from('cs_conversations').update(upd).eq('id', convId);
    if (error) return false;
    await sb.from('cs_events').insert({ conversation_id: convId, azione: 'urgenza_ricalcolo', chi: 'cs-sync', dettaglio: { in: inCnt, out: outCnt, ...upd } });
    return true;
  };

  // v6: ingest di un messaggio INVIATO. SOLO su thread gia' tracciato e non-rumore: un out non
  // crea mai una conversazione (fornitori/banca/commercialista restano fuori, design 8.1).
  const processOutbound = async (id: string, threadId: string): Promise<'done' | 'transient'> => {
    let conv: { id: string; canale: string; last_msg_at: string | null } | null = null;
    try {
      const { data } = await sb.from('cs_conversations').select('id, canale, last_msg_at').eq('gmail_thread_id', threadId).maybeSingle();
      conv = (data as typeof conv) ?? null;
    } catch { return 'transient'; }
    if (!conv || conv.canale === 'rumore') return 'done';
    let mg: { ok: boolean; status: number; j: Record<string, unknown> };
    try { mg = await gGet(`/messages/${id}?format=full`, token); } catch { return 'transient'; }
    if (mg.status === 404) return 'done';
    if (!mg.ok) return 'transient';
    const msg = mg.j as GMsg;
    const H = msg.payload?.headers;
    const to = parseAddr(hdr(H, 'to'));
    const sentAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null;
    const rawBody = stripNull(extractBody(msg.payload));
    const bodyText = stripQuote(rawBody);
    try {
      const { error: me, count } = await sb.from('cs_messages').upsert({
        gmail_message_id: id, conversation_id: conv.id, direction: 'out',
        from_email: GMAIL_USER, to_email: to.email || null, sent_at: sentAt, body_text: bodyText || null,
        body_clean: stripQuoted(rawBody, conv.canale),
      }, { onConflict: 'gmail_message_id', ignoreDuplicates: true, count: 'exact' });
      if (me) return 'transient';
      if (count) {
        outMsg += count;
        await sb.from('cs_events').insert({ conversation_id: conv.id, azione: 'ingest', chi: 'cs-sync', dettaglio: { direction: 'out', message_id: id } });
        if (!conv.last_msg_at || (sentAt && sentAt > conv.last_msg_at)) {
          await sb.from('cs_conversations').update({ last_msg_at: sentAt, last_direction: 'out' }).eq('id', conv.id);
        }
        await recomputeUrgency(conv.id);
      }
      return 'done';
    } catch { return 'transient'; }
  };

  // --- BACKFILL una tantum (v6): porta dentro le risposte GIA' inviate sui thread noti ---
  // history.list e' incrementale: senza questo, la cronologia resta muta sui thread aperti.
  // A blocchi (limit/offset) per stare nei tempi della edge; idempotente (UNIQUE gmail_message_id):
  // ri-eseguito scrive 0. Nessuna conversazione nuova, nessuna riclassificazione.
  if (action === 'backfill_out') {
    const limit = Math.min(Number(body.limit) || 60, 120);
    const offset = Number(body.offset) || 0;
    const { data: convs } = await sb.from('cs_conversations')
      .select('id, gmail_thread_id, canale')
      .neq('canale', 'rumore')
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);
    let scanned = 0, wrote = 0, updated = 0, urgFixed = 0; const errors: string[] = [];
    for (const c of (convs ?? []) as { id: string; gmail_thread_id: string; canale: string }[]) {
      scanned++;
      let th: { ok: boolean; status: number; j: Record<string, unknown> };
      try { th = await gGet(`/threads/${encodeURIComponent(c.gmail_thread_id)}?format=full`, token); }
      catch { errors.push(c.gmail_thread_id + ':fetch'); continue; }
      if (!th.ok) { errors.push(c.gmail_thread_id + ':' + th.status); continue; }
      let convWrote = 0;
      for (const m of ((th.j as { messages?: GMsg[] }).messages ?? [])) {
        const lbl = m.labelIds ?? [];
        if (lbl.includes('DRAFT') || lbl.includes('TRASH')) continue;
        const H = m.payload?.headers;
        const from = parseAddr(hdr(H, 'from'));
        if (!(lbl.includes('SENT') || isAmimi(from.email))) continue;   // solo i NOSTRI messaggi
        const to = parseAddr(hdr(H, 'to'));
        const sentAt = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null;
        const rawBody = stripNull(extractBody(m.payload));
        const bodyText = stripQuote(rawBody);
        const bodyClean = stripQuoted(rawBody, c.canale);
        const { error: me, count } = await sb.from('cs_messages').upsert({
          gmail_message_id: m.id, conversation_id: c.id, direction: 'out',
          from_email: from.email || GMAIL_USER, to_email: to.email || null, sent_at: sentAt, body_text: bodyText || null,
          body_clean: bodyClean,
        }, { onConflict: 'gmail_message_id', ignoreDuplicates: true, count: 'exact' });
        if (me) { errors.push(m.id + ':' + me.message.slice(0, 60)); continue; }
        if (count) { wrote += count; convWrote += count; }
        else if (bodyText) {
          // riga gia' presente: CONVERGI corpo e clean se le regole di strip sono migliorate nel
          // frattempo (ri-derivati dalla fonte Gmail, idempotente); non conta come "scritto"
          const { count: uc } = await sb.from('cs_messages').update({ body_text: bodyText, body_clean: bodyClean }, { count: 'exact' })
            .eq('gmail_message_id', m.id).eq('direction', 'out').neq('body_text', bodyText);
          if (uc) updated += uc;
        }
      }
      if (convWrote) {
        // last_msg_at/last_direction DERIVATI dal messaggio realmente piu' recente
        const { data: lastM } = await sb.from('cs_messages').select('direction, sent_at')
          .eq('conversation_id', c.id).not('sent_at', 'is', null)
          .order('sent_at', { ascending: false }).limit(1);
        if (lastM && lastM[0]?.sent_at) {
          await sb.from('cs_conversations').update({ last_msg_at: lastM[0].sent_at, last_direction: lastM[0].direction }).eq('id', c.id);
        }
        if (await recomputeUrgency(c.id)) urgFixed++;
      }
    }
    return json({ ok: true, scanned, out_scritti: wrote, out_aggiornati: updated, urgenze_ricalcolate: urgFixed, offset, next_offset: offset + scanned, ...(errors.length ? { errors: errors.slice(0, 10) } : {}) });
  }

  // --- BACKFILL body_clean (v7): pulisce lo storico gia' ingerito con la STESSA stripQuoted ---
  // A blocchi (limit/offset su righe con body_clean NULL e body_text presente); body_text MAI
  // toccato; idempotente (ri-eseguito a coda vuota scrive 0). `force: true` ricalcola TUTTE le
  // righe (convergenza se le regole di strip migliorano in futuro).
  if (action === 'backfill_clean') {
    const limit = Math.min(Number(body.limit) || 200, 400);
    const force = body.force === true;
    const { data: convRows } = await sb.from('cs_conversations').select('id, canale');
    const canaleOf = new Map<string, string>();
    for (const c of (convRows ?? []) as { id: string; canale: string }[]) canaleOf.set(c.id, c.canale);
    // keyset su id (le righe con clean legittimamente NULL restano NULL: senza keyset
    // occuperebbero per sempre la testa della coda non-force)
    let q = sb.from('cs_messages').select('id, conversation_id, direction, body_text, body_clean, form_fields').not('body_text', 'is', null).order('id', { ascending: true }).limit(limit);
    if (!force) q = q.is('body_clean', null);
    if (body.after_id) q = q.gt('id', String(body.after_id));
    const { data: msgs, error: qe } = await q;
    if (qe) return json({ ok: false, error: qe.message }, 500);
    let scanned = 0, wrote = 0, invariati = 0, fieldsWrote = 0; let lastId: string | null = null; const errors: string[] = [];
    for (const m of (msgs ?? []) as { id: string; conversation_id: string; direction: string; body_text: string; body_clean: string | null; form_fields: Record<string, string> | null }[]) {
      scanned++; lastId = m.id;
      const canale = canaleOf.get(m.conversation_id);
      const clean = stripQuoted(m.body_text, canale);
      const upd: Record<string, unknown> = {};
      if (clean !== m.body_clean) upd.body_clean = clean;
      // v8: ri-deriva anche form_fields (solo dove NULL/vuoto) sui messaggi 'in' col wrapper del modulo
      if ((canale === 'form_contatto' || canale === 'form_evento') && m.direction === 'in'
        && (!m.form_fields || !Object.keys(m.form_fields).length) && FORM_WRAP_RE.test(m.body_text)) {
        const ff = extractFormFields(m.body_text);
        if (Object.keys(ff).length) upd.form_fields = ff;
      }
      if (!Object.keys(upd).length) { invariati++; continue; }
      const { error: ue } = await sb.from('cs_messages').update(upd).eq('id', m.id);
      if (ue) { errors.push(m.id + ':' + ue.message.slice(0, 60)); continue; }
      if (upd.body_clean !== undefined) wrote++;
      if (upd.form_fields !== undefined) fieldsWrote++;
    }
    const { count: remaining } = await sb.from('cs_messages').select('id', { count: 'exact', head: true }).is('body_clean', null).not('body_text', 'is', null);
    return json({ ok: true, scanned, clean_scritti: wrote, fields_scritti: fieldsWrote, invariati, last_id: lastId, remaining: remaining ?? 0, ...(errors.length ? { errors: errors.slice(0, 10) } : {}) });
  }

  // --- DRY RUN: classifica i messaggi recenti, ritorna SOLO conteggi, scrive NULLA ---
  if (dryRun) {
    const lst = await gGet('/messages?maxResults=40&q=' + encodeURIComponent('in:inbox newer_than:30d'), token);
    if (!lst.ok) return json({ ok: false, error: 'gmail_list ' + lst.status, detail: JSON.stringify(lst.j).slice(0, 200) });
    const ids = ((lst.j.messages as { id: string }[]) ?? []).map((m) => m.id);
    for (const id of ids) {
      const mg = await gGet(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject`, token);
      if (!mg.ok) { parseFailed++; continue; }
      const p = (mg.j as GMsg).payload;
      const from = parseAddr(hdr(p?.headers, 'from'));
      const replyTo = parseAddr(hdr(p?.headers, 'reply-to'));
      const subject = hdr(p?.headers, 'subject');
      counts[classify(from, replyTo, subject, '', extraDeny).canale]++;
    }
    return json({ ok: true, dryRun: true, scanned: ids.length, counts, parse_failed: parseFailed });
  }

  // --- SEED: primo giro senza cursore = parti da adesso (non ingerire lo storico) ---
  if (!flags.cs_last_history_id) {
    const prof = await gGet('/profile', token);
    if (!prof.ok) { await writeHealth(1, 'gmail_profile ' + prof.status, 'error'); return json({ ok: false, error: 'gmail_profile ' + prof.status }); }
    const hid = String((prof.j as { historyId?: string }).historyId ?? '');
    await sb.from('app_flags').upsert({ key: 'cs_last_history_id', value: hid }, { onConflict: 'key' });
    await writeHealth(0, 'seed cursore Gmail (da qui in avanti)', 'ok');
    return json({ ok: true, seeded: true, historyId: hid });
  }

  // --- INCREMENTALE ---
  const startId = flags.cs_last_history_id;
  let newConv = 0, newMsg = 0, processed = 0;

  const safeParse = (msg: GMsg): Parsed | null => {
    try {
      const H = msg.payload?.headers;
      const from = parseAddr(hdr(H, 'from')); const replyTo = parseAddr(hdr(H, 'reply-to')); const to = parseAddr(hdr(H, 'to'));
      const subject = stripNull(hdr(H, 'subject')); const bodyText = stripNull(extractBody(msg.payload));   // NUL -> Postgres rifiuta
      const cl = classify(from, replyTo, subject, bodyText, extraDeny);
      const isForm = cl.canale === 'form_contatto' || cl.canale === 'form_evento';
      // v8: i campi si estraggono solo dallo STAMPO vero (wrapper presente), mai dalle risposte
      // successive del cliente nello stesso thread; {} non si scrive (resta NULL, la UI non accende)
      const ff = isForm && FORM_WRAP_RE.test(bodyText) ? extractFormFields(bodyText) : {};
      return {
        cl, from, to, subject, bodyText,
        sentAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
        snippet: stripNull((msg.snippet ?? '').slice(0, 300)),
        formFields: Object.keys(ff).length ? ff : null,
        order: extractOrderNumber(subject + '\n' + bodyText), lingua: detectLingua(bodyText || subject),
      };
    } catch { return null; }
  };

  // conversazione: idempotente su gmail_thread_id, non clobbera stato/stato_by; promuove un thread
  // gia' marcato rumore se arriva un messaggio cliente reale. Lancia su errore DB reale (-> transient).
  const ensureConv = async (threadId: string, cl: Parsed['cl'], meta: { sentAt: string | null; subject: string; snippet: string; order: number | null; lingua: string }): Promise<string> => {
    const { data: ex } = await sb.from('cs_conversations').select('id,canale,last_msg_at').eq('gmail_thread_id', threadId).maybeSingle();
    if (ex) {
      const upd: Record<string, unknown> = {};
      // last_*/subject/snippet solo se il messaggio e' PIU' RECENTE: il re-processo (cursore che torna a
      // safeHid) puo' ripassare un messaggio vecchio dello stesso thread e non deve regredire la coda.
      if (!ex.last_msg_at || (!!meta.sentAt && meta.sentAt > (ex.last_msg_at as string))) {
        upd.last_msg_at = meta.sentAt; upd.last_direction = 'in'; upd.subject = meta.subject; upd.snippet = meta.snippet;
      }
      if (meta.order) upd.order_number = meta.order;
      if (cl.email) upd.customer_email = cl.email;
      if (cl.name) upd.customer_name = cl.name;
      if (cl.canale !== 'rumore' && ex.canale === 'rumore') upd.canale = cl.canale;   // un cliente reale "promuove" un thread-rumore
      if (Object.keys(upd).length) await sb.from('cs_conversations').update(upd).eq('id', ex.id as string);
      return ex.id as string;
    }
    const { data: ins, error } = await sb.from('cs_conversations').insert({
      gmail_thread_id: threadId, canale: cl.canale, customer_email: cl.email, customer_name: cl.name,
      last_msg_at: meta.sentAt, last_direction: 'in', subject: meta.subject, snippet: meta.snippet, order_number: meta.order, lingua: meta.lingua,
    }).select('id').single();
    if (!error && ins) { newConv++; return ins.id as string; }
    const { data: again } = await sb.from('cs_conversations').select('id').eq('gmail_thread_id', threadId).maybeSingle();  // corsa UNIQUE: rileggi
    if (again) return again.id as string;
    throw new Error('conv_insert_failed: ' + (error?.message ?? 'unknown'));   // errore DB reale -> transient
  };

  // anti-perdita idempotente: conversazione grezza (parse_failed) + riga messaggio SENZA corpo
  // (UNIQUE su gmail_message_id -> niente doppioni al re-processo); evento solo alla prima volta.
  const antiLoss = async (threadId: string, messageId: string, detail: Record<string, unknown>) => {
    const { data: ex } = await sb.from('cs_conversations').select('id').eq('gmail_thread_id', threadId).maybeSingle();
    let cid = ex?.id as string | undefined;
    if (!cid) {
      const { data: ins, error: ce } = await sb.from('cs_conversations').insert({ gmail_thread_id: threadId, canale: 'email_diretta', subject: '(non interpretabile)', parse_failed: true }).select('id').single();
      if (!ce && ins) { cid = ins.id as string; newConv++; }
      else {   // corsa UNIQUE o errore DB: rileggi; se manca -> errore reale, PROPAGA (chiamante -> transient, ripresa)
        const { data: again } = await sb.from('cs_conversations').select('id').eq('gmail_thread_id', threadId).maybeSingle();
        if (!again) throw new Error('antiloss_conv_failed: ' + (ce?.message ?? 'no id'));
        cid = again.id as string;
      }
    } else {
      const { error: ue } = await sb.from('cs_conversations').update({ parse_failed: true }).eq('id', cid);
      if (ue) throw new Error('antiloss_update_failed: ' + ue.message);
    }
    const { error: me, count } = await sb.from('cs_messages').upsert({ gmail_message_id: messageId, conversation_id: cid, direction: 'in', body_text: null }, { onConflict: 'gmail_message_id', ignoreDuplicates: true, count: 'exact' });
    if (me) throw new Error('antiloss_msg_failed: ' + me.message);   // errore DB -> transient: mail non persa, ripresa al giro dopo
    if (count) await sb.from('cs_events').insert({ conversation_id: cid, azione: 'parse_failed', chi: 'cs-sync', dettaglio: { message_id: messageId, ...detail } });
  };

  // 'done' = record avanzabile (ingerito / dup benigno / rimosso da Gmail / parse_failed gestito);
  // 'transient' = errore recuperabile (5xx/429/rete/DB) -> NON avanzare il cursore, si riprova.
  const processMessage = async (id: string, threadId: string): Promise<'done' | 'transient'> => {
    let mg: { ok: boolean; status: number; j: Record<string, unknown> };
    try { mg = await gGet(`/messages/${id}?format=full`, token); } catch { return 'transient'; }
    if (mg.status === 404) return 'done';   // messaggio rimosso da Gmail: niente da ingerire
    if (!mg.ok) return 'transient';          // 5xx/429/...: riprova al giro dopo (cursore fermo)
    const p = safeParse(mg.j as GMsg);
    if (!p) { parseFailed++; try { await antiLoss(threadId, id, {}); return 'done'; } catch { return 'transient'; } }
    try {
      const convId = await ensureConv(threadId, p.cl, { sentAt: p.sentAt, subject: p.subject, snippet: p.snippet, order: p.order, lingua: p.lingua });
      const { error: me, count } = await sb.from('cs_messages').upsert({
        gmail_message_id: id, conversation_id: convId, direction: 'in',
        from_email: p.from.email || null, to_email: p.to.email || null, sent_at: p.sentAt, body_text: p.bodyText || null, form_fields: p.formFields,
        body_clean: stripQuoted(p.bodyText, p.cl.canale),
      }, { onConflict: 'gmail_message_id', ignoreDuplicates: true, count: 'exact' });
      if (me) return 'transient';
      if (count) {
        newMsg += count;
        await sb.from('cs_events').insert({ conversation_id: convId, azione: 'ingest', chi: 'cs-sync', dettaglio: { canale: p.cl.canale, message_id: id } });
        // v6: su un NUOVO messaggio cliente di una conversazione gia' classificata, la regola
        // sollecito va rivalutata subito (senza AI, senza toccare categoria)
        await recomputeUrgency(convId);
      }
      counts[p.cl.canale]++; processed++;
      return 'done';
    } catch { return 'transient'; }   // errore DB recuperabile: cursore fermo, si riprova
  };

  let tip = startId, safeHid = startId;
  let pageToken: string | undefined; let pages = 0; let stopped = false;
  do {
    const q = `/history?startHistoryId=${encodeURIComponent(startId)}&historyTypes=messageAdded` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const h = await gGet(q, token);
    if (h.status === 404) {   // historyId scaduto -> re-seed, mai perdere il giro
      const prof = await gGet('/profile', token);
      const hid = String((prof.j as { historyId?: string }).historyId ?? '');
      await sb.from('app_flags').upsert({ key: 'cs_last_history_id', value: hid }, { onConflict: 'key' });
      await writeHealth(1, 're-seed: historyId scaduto', 'warn');
      return json({ ok: true, reseeded: true, historyId: hid });
    }
    if (!h.ok) {   // errore lista: NON scavalcare, avanza solo fino all'ultimo record sicuro
      await sb.from('app_flags').upsert({ key: 'cs_last_history_id', value: safeHid }, { onConflict: 'key' });
      await writeHealth(1, 'gmail_history ' + h.status, 'error');
      return json({ ok: false, error: 'gmail_history ' + h.status, advanced: safeHid !== startId });
    }
    tip = String(h.j.historyId ?? tip);
    for (const rec of (h.j.history as { id?: string; messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[]) ?? []) {
      let recOk = true;
      for (const ma of rec.messagesAdded ?? []) {
        const lbl = ma.message.labelIds ?? [];
        if (lbl.includes('DRAFT') || lbl.includes('TRASH')) continue;
        // v6: la posta INVIATA non si scarta piu': entra come 'out' sui soli thread gia' tracciati
        if (lbl.includes('SENT')) {
          if (await processOutbound(ma.message.id, ma.message.threadId) === 'transient') { recOk = false; break; }
          continue;
        }
        if (await processMessage(ma.message.id, ma.message.threadId) === 'transient') { recOk = false; break; }
      }
      if (!recOk) { stopped = true; break; }   // non superare un record con un fallimento transitorio
      if (rec.id) safeHid = String(rec.id);     // record intero processato -> cursore sicuro avanza
    }
    if (stopped) break;
    pageToken = h.j.nextPageToken as string | undefined;
    pages++;
  } while (pageToken && pages < MAX_PAGES && processed < MAX_MSGS_PER_POLL);

  // Avanza al tip SOLO se abbiamo drenato tutte le pagine senza fermarci; altrimenti all'ultimo record
  // interamente processato (il backlog residuo si drena ai giri successivi, nessun messaggio scavalcato).
  const drained = !pageToken && !stopped;
  const newHistoryId = drained ? tip : safeHid;
  await sb.from('app_flags').upsert({ key: 'cs_last_history_id', value: newHistoryId }, { onConflict: 'key' });
  // un giro fermato da un errore ricorrente su un messaggio SENZA alcun avanzamento = potenziale stallo:
  // NON scriverlo verde (un singolo hiccup transitorio si autorisolve e torna 'ok' al giro dopo).
  const stalled = stopped && processed === 0;
  await writeHealth(
    stalled ? 1 : parseFailed,
    stalled ? 'giro fermato su un messaggio, nessun avanzamento (si riprova)' : (parseFailed ? `giro ok, ${parseFailed} non interpretati` : 'giro ok'),
    stalled || parseFailed ? 'warn' : 'ok',
  );

  return json({ ok: true, processed, new_conversations: newConv, new_messages: newMsg, out_messages: outMsg, counts, parse_failed: parseFailed, historyId: newHistoryId, backlog: !drained, stalled });
});
