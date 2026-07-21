// cs-sync v2 — tool assistenza clienti, FASE 1: ingest reale della posta cliente in cs_*.
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
  // 1) Notifica chat Shopify Inbox (READ-ONLY): no-reply@mailer.shopify.com, subject "New Message from <nome>"
  if (fe.endsWith('@mailer.shopify.com') && /new message|nuovo messaggio/i.test(subject)) {
    const nm = (subject.match(/from\s+(.+?)\s*$/i)?.[1] || from.name || '').trim();
    return { canale: 'chat_notifica', email: null, name: nm || null };
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
function extractFormFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split('\n').slice(0, 40)) {
    const m = line.match(/^\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '/]{1,30}?)\s*:\s*(.+?)\s*$/);
    if (m) { const k = m[1].trim().toLowerCase(); if (!(k in out)) out[k] = m[2].trim().slice(0, 500); }
  }
  return out;
}
function extractOrderNumber(text: string): number | null {
  const m = text.match(/(?:ordine|order|#)\s*#?\s*(\d{3,6})/i);
  return m ? Number(m[1]) : null;
}
const detectLingua = (t: string) => (/\b(the|your|order|hello|hi|please|thanks|would|available)\b/i.test(t) && !/\b(il|la|per|grazie|ordine|ciao|salve|vorrei|disponibile)\b/i.test(t) ? 'en' : 'it');

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
  if (action !== 'poll') return json({ error: 'azione sconosciuta: ' + action }, 422);

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
      return {
        cl, from, to, subject, bodyText,
        sentAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
        snippet: stripNull((msg.snippet ?? '').slice(0, 300)),
        formFields: isForm ? extractFormFields(bodyText) : null,
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
      }, { onConflict: 'gmail_message_id', ignoreDuplicates: true, count: 'exact' });
      if (me) return 'transient';
      if (count) { newMsg += count; await sb.from('cs_events').insert({ conversation_id: convId, azione: 'ingest', chi: 'cs-sync', dettaglio: { canale: p.cl.canale, message_id: id } }); }
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
        if (lbl.includes('SENT') || lbl.includes('DRAFT') || lbl.includes('TRASH')) continue;   // solo posta in ingresso
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

  return json({ ok: true, processed, new_conversations: newConv, new_messages: newMsg, counts, parse_failed: parseFailed, historyId: newHistoryId, backlog: !drained, stalled });
});
