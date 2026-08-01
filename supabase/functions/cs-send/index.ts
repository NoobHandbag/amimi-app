// cs-send v2 — tool assistenza clienti, FASE 4: INVIO della risposta dall'app.
// v2 (2026-08-01, durante il collaudo E2E): azione `diag` (PIN, nessun invio, nessuna PII, nessun
//   segreto in risposta) che prova a ottenere il token Google scope per scope e dice QUALE e'
//   autorizzato sulla domain-wide delegation. Nasce da un caso reale: Google risponde
//   `unauthorized_client` senza dire quale scope manca, e un ritocco alla delegation aveva
//   sostituito gmail.readonly con gmail.send spegnendo l'ingest di cs-sync in silenzio.
// Brief: 2026-07-31_CLAUDE_CODE_BRIEF_cs_fase4_invio_dallapp.md (decisione owner 31-07/01-08).
// EDGE DEDICATA (Regola Ferrea 19: mai innesti in edge vive). Nessun invio automatico: arriva qui
// solo il click esplicito dell'operatrice DOPO il dialog di conferma (destinatario + testo +
// warning del linter in vista, lato UI).
//
// Canali (campo `canale` di cs_conversations):
//   - email_diretta: risposta NEL thread Gmail esistente (threadId + In-Reply-To/References +
//     Subject coerente: Gmail accoda allo stesso thread solo se tutti e tre combaciano).
//   - form_contatto / form_evento: il wrapper mailer@shopify.com non e' rispondibile -> email
//     NUOVA a customer_email (estratta dal reply-to all'ingest). form_evento incluso: stessa
//     identica meccanica del form_contatto (scostamento dichiarato: il brief elencava solo
//     form_contatto, ma escludere gli eventi avrebbe lasciato le richieste cerimonia al copia-incolla).
//   - chat_notifica / rumore: NESSUN invio da qui (la chat vive dentro Shopify Inbox, decisione
//     owner 01-08; il tool offre "Copia e apri in Inbox" lato UI). Rifiuto esplicito 422.
//
// ANTI DOPPIO INVIO (tabella cs_sends, migr 0092): la UI genera una send_key (uuid) all'apertura
// del dialog; qui la si RIVENDICA con un INSERT prima di chiamare Gmail. Doppio click / retry di
// rete = stessa chiave = niente seconda email (PK). In piu' guardia soft cross-key: stesso testo
// gia' inviato come `out` nella stessa conversazione negli ultimi 10 minuti -> 409.
//
// DOPO l'invio riuscito la mail E' PARTITA: da li' in poi MAI un fake-failure (l'operatrice
// riproverebbe = doppia email). La contabilita' post-invio (riga cs_messages, stato, urgenza)
// che fallisce diventa `warnings[]` espliciti nella risposta, mai silenzio.
//
// STATO + URGENZA — SPECCHIO DICHIARATO di cs-sync (setStatoAuto v9 + recomputeUrgency v6):
// il brief chiedeva "l'out scritto fara' scattare 'fatto' da solo, senza duplicare logiche", ma
// contro il codice reale non regge: cs-sync deduplica su gmail_message_id (ignoreDuplicates),
// quindi un out PRE-scritto da qui rende il suo passaggio un no-op (setStatoAuto non scatta mai);
// e la risposta a un form apre un thread Gmail NUOVO che cs-sync non traccia per design (un out
// non crea conversazioni). Percio' la STESSA regola (semantica identica: stato_by='auto', la mano
// umana vince sempre, riapre solo cio' che l'automatismo ha chiuso) vive qui in copia speculare.
// SE CAMBI LA REGOLA IN cs-sync, CAMBIALA ANCHE QUI (due sedi dichiarate, una regola).
//
// Autorizzazione: come cs-api (belt-and-suspenders): access_token utente Supabase Auth reale
// (getUser: la anon key NON e' un utente) + email @amimi.it; poi scrive col service_role.
// Gmail: service account con domain-wide delegation (chiave in app_flags.cs_gmail_sa_key),
// scope gmail.send + gmail.readonly (il readonly serve SOLO a leggere gli header del thread per
// il reply corretto). Prerequisito owner (fatto 01-08): gmail.send aggiunto alla delegation.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const GMAIL_USER = 'info@amimi.it';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// send per spedire; readonly SOLO per leggere gli header del thread (In-Reply-To/References/Subject).
// Si chiedono con DUE token distinti: una delegation che autorizza uno ma non l'altro rifiuta la
// richiesta congiunta, e l'invio non deve dipendere dallo scope di lettura (v2, caso reale 01-08).
const SCOPE_SEND = 'https://www.googleapis.com/auth/gmail.send';
const SCOPE_READ = 'https://www.googleapis.com/auth/gmail.readonly';
const SCOPES = `${SCOPE_SEND} ${SCOPE_READ}`;
const TESTO_MAX = 12000;
const DEDUP_WINDOW_MS = 10 * 60 * 1000;   // guardia soft: stesso testo, stessa conversazione, 10 minuti

const IDENT: Record<string, string> = { B: 'Benedetta', G: 'Ginevra', A: 'Ale' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const countDaVerificare = (t: string) => (t.match(/\[DA VERIFICARE[^\]]*\]/gi) || []).length;

// --- OAuth 2.0 JWT bearer grant (identico a cs-sync, scope diversi) ---
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

// --- MIME (testo semplice UTF-8, base64) ---
const b64 = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const wrap76 = (s: string): string => s.replace(/(.{76})/g, '$1\r\n');
// RFC 2047: header non-ASCII (Subject, display name) codificati =?UTF-8?B?...?=
const encHdr = (s: string): string => (/[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${b64(s)}?=` : s);

type Hdr = { name?: string; value?: string };
const hdr = (headers: Hdr[] | undefined, name: string) => (headers ?? []).find((h) => h.name?.toLowerCase() === name)?.value ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || 'send');
  if (action !== 'send' && action !== 'diag') return json({ error: 'azione sconosciuta' }, 422);
  const sb = createClient(url, svc);

  // 1) autorizzazione. `send` (tocca il cliente) = utente Supabase Auth reale @amimi.it, pattern
  // cs-api. `diag` (solo tecnica: nessuna PII, nessun segreto, nessun invio) = PIN, come le azioni
  // di servizio delle altre edge del modulo: deve restare invocabile anche senza sessione browser.
  let userEmail = '';
  if (action === 'diag') {
    const { data: cfgD } = await sb.from('app_config').select('pin_hash').eq('id', 1).single();
    if (!cfgD?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfgD.pin_hash) return json({ error: 'PIN errato' }, 401);
  } else {
    const authz = req.headers.get('Authorization') || '';
    const tk = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
    if (!tk) return json({ error: 'non autenticato' }, 401);
    const { data: ures, error: uerr } = await createClient(url, anon).auth.getUser(tk);
    const user = ures?.user;
    if (uerr || !user) return json({ error: 'sessione non valida' }, 401);
    userEmail = (user.email || '').toLowerCase();
    if (!userEmail.endsWith('@amimi.it')) return json({ error: 'dominio non ammesso' }, 403);
  }

  // --- diag (v2): quali scope Gmail sono davvero autorizzati sulla domain-wide delegation? ---
  // Nessun invio, nessuna PII, nessun segreto in risposta: solo ok/errore per scope. Serve quando
  // Google risponde `unauthorized_client`, che NON dice quale scope manca (caso reale 01-08: un
  // ritocco alla delegation aveva sostituito gmail.readonly con gmail.send, spegnendo l'ingest).
  if (action === 'diag') {
    const { data: fl } = await sb.from('app_flags').select('value').eq('key', 'cs_gmail_sa_key').maybeSingle();
    if (!fl?.value) return json({ ok: false, error: 'chiave service account assente' }, 500);
    let saD: { client_email?: string; private_key?: string; client_id?: string };
    try { saD = JSON.parse(String(fl.value)); } catch { return json({ ok: false, error: 'chiave non valida' }, 500); }
    const probes: Record<string, string> = {
      readonly: 'https://www.googleapis.com/auth/gmail.readonly',
      send: 'https://www.googleapis.com/auth/gmail.send',
      entrambi: SCOPES,
    };
    const esiti: Record<string, string> = {};
    for (const [nome, scope] of Object.entries(probes)) {
      try { await googleAccessTokenFor(saD as { client_email: string; private_key: string }, scope); esiti[nome] = 'ok'; }
      catch (e) { esiti[nome] = (e as Error).message.slice(0, 160); }
    }
    return json({ ok: true, service_account: saD.client_email, client_id: saD.client_id, scope_autorizzati: esiti });
  }

  // 2) input: conversazione, chi firma, testo finale (fa fede il box, non la bozza), send_key
  const convId = String(body.conversation_id || '');
  if (!UUID_RE.test(convId)) return json({ error: 'conversation_id non valido' }, 422);
  const chi = IDENT[String(body.chi || '').toUpperCase()];
  if (!chi) return json({ error: 'seleziona chi sei (B/G/A) prima di inviare' }, 422);
  const testo = String(body.testo || '').replace(/\r\n?/g, '\n').trim();
  if (!testo) return json({ error: 'testo vuoto: niente da inviare' }, 422);
  if (testo.length > TESTO_MAX) return json({ error: `testo troppo lungo (${testo.length} > ${TESTO_MAX})` }, 422);
  const sendKey = String(body.send_key || '').toLowerCase();
  if (!UUID_RE.test(sendKey)) return json({ error: 'send_key mancante o non valida' }, 422);

  const { data: conv } = await sb.from('cs_conversations')
    .select('id, gmail_thread_id, canale, customer_email, customer_name, subject, lingua, stato, stato_by, last_msg_at')
    .eq('id', convId).maybeSingle();
  if (!conv) return json({ error: 'conversazione inesistente' }, 404);

  // 3) canale: solo email_diretta e form_*; chat e rumore NON si inviano da qui (server-side, non solo UI)
  const canale = String(conv.canale);
  if (canale === 'chat_notifica') return json({ error: 'le chat del sito si rispondono dentro Shopify Inbox (usa "Copia e apri in Inbox")' }, 422);
  if (canale !== 'email_diretta' && canale !== 'form_contatto' && canale !== 'form_evento') return json({ error: `invio non disponibile per il canale "${canale}"` }, 422);

  // 4) destinatario: SEMPRE dal DB (customer_email), mai dal client; mai il wrapper, mai noi stessi
  const to = String(conv.customer_email || '').trim().toLowerCase();
  if (!to || !to.includes('@')) return json({ error: 'email del cliente mancante: impossibile inviare da qui' }, 422);
  if (to === 'mailer@shopify.com' || to.endsWith('@shopify.com') || to.endsWith('@shopifyemail.com') || to.endsWith('@mailer.shopify.com')) {
    return json({ error: 'il destinatario risolto e\' il wrapper Shopify, non il cliente: invio bloccato' }, 422);
  }
  if (to.endsWith('@amimi.it')) return json({ error: 'il destinatario risolto e\' un indirizzo @amimi.it: invio bloccato' }, 422);

  // 5) guardia soft anti doppio invio cross-key: stesso testo gia' uscito da poco in questa conversazione
  const { data: lastOuts } = await sb.from('cs_messages')
    .select('body_text, sent_at').eq('conversation_id', convId).eq('direction', 'out')
    .order('sent_at', { ascending: false }).limit(5);
  for (const m of (lastOuts ?? []) as { body_text: string | null; sent_at: string | null }[]) {
    if (!m.sent_at || Date.now() - new Date(m.sent_at).getTime() > DEDUP_WINDOW_MS) continue;
    if ((m.body_text || '').trim() === testo) return json({ error: 'questa identica risposta risulta gia\' inviata pochi minuti fa: doppio invio evitato' }, 409);
  }

  // 6) idempotenza: rivendica la send_key PRIMA di chiamare Gmail (doppio click = stessa chiave)
  const testoSha = await sha256hex(testo);
  const nowIso = () => new Date().toISOString();
  const { error: claimErr } = await sb.from('cs_sends').insert({ send_key: sendKey, conversation_id: convId, chi, to_email: to, testo_sha: testoSha });
  if (claimErr) {
    const { data: ex } = await sb.from('cs_sends').select('status, gmail_message_id, created_at').eq('send_key', sendKey).maybeSingle();
    if (!ex) return json({ error: 'registro invii non disponibile: invio bloccato (' + claimErr.message.slice(0, 120) + ')' }, 500);
    if (ex.status === 'sent') return json({ ok: true, already_sent: true, to, gmail_message_id: ex.gmail_message_id });
    const fresh = ex.created_at && Date.now() - new Date(ex.created_at as string).getTime() < 2 * 60 * 1000;
    if (ex.status === 'sending' && fresh) return json({ error: 'invio gia\' in corso per questa conferma: attendi l\'esito' }, 409);
    // tentativo precedente fallito (o rimasto appeso): la stessa chiave riprova
    await sb.from('cs_sends').update({ status: 'sending', error: null, testo_sha: testoSha, updated_at: nowIso() }).eq('send_key', sendKey);
  }
  const sendFail = async (status: number, msg: string) => {
    await sb.from('cs_sends').update({ status: 'error', error: msg.slice(0, 500), updated_at: nowIso() }).eq('send_key', sendKey);
    return json({ error: msg }, status);
  };

  // 7) Gmail: token del service account (delegation con gmail.send, prerequisito owner)
  const { data: flag } = await sb.from('app_flags').select('value').eq('key', 'cs_gmail_sa_key').maybeSingle();
  if (!flag?.value) return await sendFail(500, 'chiave service account assente (app_flags.cs_gmail_sa_key)');
  let sa: { client_email?: string; private_key?: string };
  try { sa = JSON.parse(String(flag.value)); } catch { return await sendFail(500, 'chiave service account non valida (JSON)'); }
  if (!sa.client_email || !sa.private_key) return await sendFail(500, 'chiave service account incompleta');
  // Due token SEPARATI, non uno solo con entrambi gli scope (v2, dopo il caso reale 01-08: una
  // delegation con `gmail.send` ma senza `gmail.readonly` rifiuta la richiesta CONGIUNTA, quindi
  // un token unico rendeva l'invio ostaggio di uno scope che serve solo a leggere gli header).
  //   - send: OBBLIGATORIO. Senza, non si spedisce e si dice perche'.
  //   - readonly: BEST-EFFORT, serve solo agli header di reply (In-Reply-To/References). Se manca,
  //     si risponde comunque nel thread (threadId + Subject dal DB, che e' cio' che Gmail usa per
  //     accodare) e lo si DICHIARA nei warning: il threading su client non-Gmail puo' risultare
  //     meno solido. Mai silenzioso.
  let gtoken: string;
  try { gtoken = await googleAccessTokenFor(sa as { client_email: string; private_key: string }, SCOPE_SEND); }
  catch (e) { return await sendFail(502, 'autenticazione Google fallita: lo scope gmail.send non risulta autorizzato sulla domain-wide delegation. ' + (e as Error).message.slice(0, 180)); }
  let readToken: string | null = null;
  try { readToken = await googleAccessTokenFor(sa as { client_email: string; private_key: string }, SCOPE_READ); }
  catch { readToken = null; }

  // 8) costruzione del messaggio
  let subject: string;
  let inReplyTo = '', references = '', threadId: string | null = null;
  const preWarn: string[] = [];
  if (canale === 'email_diretta') {
    // reply NEL thread. Con lo scope di lettura: header veri dell'ultimo messaggio del thread.
    // Senza: threadId + Subject dal DB (Gmail accoda lo stesso), e lo si dichiara.
    let lastMsgId = '', lastRefs = '', lastSubj = '';
    if (readToken) {
      const tr = await fetch(`${GMAIL}/threads/${encodeURIComponent(String(conv.gmail_thread_id))}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`, { headers: { Authorization: `Bearer ${readToken}` } });
      const tj = await tr.json().catch(() => ({}));
      if (!tr.ok) return await sendFail(502, `thread Gmail non leggibile (${tr.status}): risposta nel thread impossibile, invio bloccato`);
      const msgs = ((tj as { messages?: { labelIds?: string[]; payload?: { headers?: Hdr[] } }[] }).messages ?? [])
        .filter((m) => !(m.labelIds ?? []).includes('DRAFT') && !(m.labelIds ?? []).includes('TRASH'));
      const last = msgs[msgs.length - 1];
      if (!last) return await sendFail(502, 'thread Gmail vuoto: risposta nel thread impossibile, invio bloccato');
      const H = last.payload?.headers;
      lastMsgId = hdr(H, 'message-id');
      lastRefs = hdr(H, 'references');
      lastSubj = hdr(H, 'subject');
    } else {
      preWarn.push('header di reply non impostati: lo scope gmail.readonly non e\' autorizzato sulla delegation (la risposta resta nel thread via threadId, ma su client non-Gmail il collegamento puo\' essere piu\' debole)');
    }
    const subjBase = lastSubj || String(conv.subject || '');
    if (!subjBase) return await sendFail(502, 'oggetto del thread sconosciuto: invio bloccato');
    subject = /^re:\s/i.test(subjBase) ? subjBase : 'Re: ' + subjBase;
    if (lastMsgId) { inReplyTo = lastMsgId; references = (lastRefs ? lastRefs + ' ' : '') + lastMsgId; }
    threadId = String(conv.gmail_thread_id);
  } else {
    // form: email NUOVA al cliente, oggetto deterministico che richiama la richiesta (mai il wrapper)
    const en = conv.lingua === 'en';
    subject = canale === 'form_evento'
      ? (en ? 'Your event request - Amimì' : 'La tua richiesta evento - Amimì')
      : (en ? 'Reply to your request - Amimì' : 'Risposta alla tua richiesta - Amimì');
  }

  const mime = [
    `From: ${encHdr('Amimì')} <${GMAIL_USER}>`,
    `To: <${to}>`,
    `Subject: ${encHdr(subject)}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(testo)),
  ].join('\r\n');

  // 9) invio. Da qui in poi, se Gmail risponde ok, la mail E' PARTITA: mai piu' un errore "finto".
  const sr = await fetch(`${GMAIL}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${gtoken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(new TextEncoder().encode(mime)), ...(threadId ? { threadId } : {}) }),
  });
  const sj = await sr.json().catch(() => ({}));
  if (!sr.ok) return await sendFail(502, `Gmail ha rifiutato l'invio (${sr.status}): ${JSON.stringify(sj).slice(0, 250)}`);
  const gmailMsgId = String((sj as { id?: string }).id ?? '');
  const gmailThreadId = String((sj as { threadId?: string }).threadId ?? '');
  const sentAt = nowIso();
  const warnings: string[] = [...preWarn];

  // 10) contabilita' post-invio (ogni fallimento = warning esplicito, mai fake-failure)
  // riga `out` con is_via_tool/sent_by; se cs-sync ci ha battuto sul tempo (poll nel mezzo), la
  // riga esiste gia' senza quei campi: si MARCA invece di inserire (upsert ignoreDuplicates + update).
  try {
    const { error: me, count } = await sb.from('cs_messages').upsert({
      gmail_message_id: gmailMsgId, conversation_id: convId, direction: 'out',
      sent_by: chi, from_email: GMAIL_USER, to_email: to, sent_at: sentAt,
      body_text: testo, body_clean: testo, is_via_tool: true,
    }, { onConflict: 'gmail_message_id', ignoreDuplicates: true, count: 'exact' });
    if (me) warnings.push('riga messaggio non scritta: ' + me.message.slice(0, 120));
    else if (!count) {
      const { error: ue } = await sb.from('cs_messages').update({ is_via_tool: true, sent_by: chi, to_email: to }).eq('gmail_message_id', gmailMsgId);
      if (ue) warnings.push('marcatura via-tool non scritta: ' + ue.message.slice(0, 120));
    }
  } catch (e) { warnings.push('riga messaggio non scritta: ' + (e as Error).message.slice(0, 120)); }

  try {
    if (!conv.last_msg_at || sentAt > String(conv.last_msg_at)) {
      await sb.from('cs_conversations').update({ last_msg_at: sentAt, last_direction: 'out' }).eq('id', convId);
    }
  } catch { warnings.push('last_msg_at non aggiornato'); }

  // SPECCHIO di cs-sync setStatoAuto (v9): abbiamo risposto -> 'fatto' con stato_by='auto'.
  // La mano umana vince sempre (una presa in carico 'in_corso' di una persona NON viene chiusa:
  // identico alla risposta da Gmail; si chiude col bottone Conclusa).
  let statoAuto = false;
  try {
    const { data: c } = await sb.from('cs_conversations').select('id, stato, stato_by').eq('id', convId).maybeSingle();
    if (c && (!c.stato_by || c.stato_by === 'auto') && c.stato !== 'fatto') {
      const { error } = await sb.from('cs_conversations').update({ stato: 'fatto', stato_by: 'auto', stato_at: nowIso() }).eq('id', convId);
      if (!error) {
        statoAuto = true;
        await sb.from('cs_events').insert({ conversation_id: convId, azione: 'stato_auto', chi: 'cs-send', dettaglio: { da: c.stato, a: 'fatto', motivo: 'risposta inviata dal tool' } });
      } else warnings.push('stato non aggiornato: ' + error.message.slice(0, 120));
    }
  } catch (e) { warnings.push('stato non aggiornato: ' + (e as Error).message.slice(0, 120)); }

  // SPECCHIO di cs-sync recomputeUrgency (v6): dopo un nostro out la regola sollecito si spegne
  // (solo urgenze DELLA REGOLA, mai quelle decise dall'AI; mai categoria/categoria_source).
  try {
    const RULE_MOTIVI = ['thread riaperto (sollecito)', '2+ messaggi senza nostra risposta'];
    const { data: c } = await sb.from('cs_conversations')
      .select('id, stato, stato_at, last_direction, last_msg_at, categoria_source, urgente, urgenza_motivo, flags')
      .eq('id', convId).maybeSingle();
    if (c && c.categoria_source) {
      const { data: msgs } = await sb.from('cs_messages').select('direction').eq('conversation_id', convId);
      const inCnt = (msgs ?? []).filter((m) => m.direction === 'in').length;
      const outCnt = (msgs ?? []).filter((m) => m.direction === 'out').length;
      const reopened = String(c.stato) === 'fatto' && c.last_direction === 'in' && !!c.last_msg_at && (!c.stato_at || (c.last_msg_at as string) > (c.stato_at as string));
      const ruleUrg = reopened || (inCnt >= 2 && outCnt === 0);
      const ruleMotivo = reopened ? 'thread riaperto (sollecito)' : '2+ messaggi senza nostra risposta';
      const cflags: string[] = Array.isArray(c.flags) ? [...new Set((c.flags as unknown[]).map(String))] : [];
      const upd: Record<string, unknown> = {};
      if (ruleUrg) {
        if (c.urgente !== true) { upd.urgente = true; upd.urgenza_motivo = ruleMotivo; }
        if (!cflags.includes('sollecito')) upd.flags = [...cflags, 'sollecito'];
      } else if (c.urgente === true && RULE_MOTIVI.includes(String(c.urgenza_motivo ?? ''))) {
        upd.urgente = false; upd.urgenza_motivo = null;
        if (cflags.includes('sollecito')) upd.flags = cflags.filter((f) => f !== 'sollecito');
      } else if (cflags.includes('sollecito')) {
        upd.flags = cflags.filter((f) => f !== 'sollecito');
      }
      if (Object.keys(upd).length) {
        const { error } = await sb.from('cs_conversations').update(upd).eq('id', convId);
        if (!error) await sb.from('cs_events').insert({ conversation_id: convId, azione: 'urgenza_ricalcolo', chi: 'cs-send', dettaglio: { in: inCnt, out: outCnt, ...upd } });
      }
    }
  } catch { warnings.push('urgenza non ricalcolata'); }

  try {
    await sb.from('cs_events').insert({
      conversation_id: convId, azione: 'send', chi,
      dettaglio: { send_key: sendKey, to, canale, gmail_message_id: gmailMsgId, gmail_thread_id: gmailThreadId, subject, da_verificare: countDaVerificare(testo), by_email: userEmail },
    });
  } catch { warnings.push('evento send non registrato'); }

  try {
    await sb.from('cs_sends').update({ status: 'sent', gmail_message_id: gmailMsgId, gmail_thread_id: gmailThreadId, updated_at: nowIso() }).eq('send_key', sendKey);
  } catch { warnings.push('registro invii non aggiornato'); }

  return json({ ok: true, to, subject, canale, gmail_message_id: gmailMsgId, gmail_thread_id: gmailThreadId, stato_auto: statoAuto, ...(warnings.length ? { warnings } : {}) });
});
