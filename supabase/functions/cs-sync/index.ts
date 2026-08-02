// cs-sync v15 — tool assistenza clienti, FASE 1: ingest reale della posta cliente in cs_*.
// v15 (2026-08-02, brief cs_crop_e_dati_falsi Parte 1): il CROP delle email. Nella bolla comparivano
//   ancora citazioni, forward, firme dei client di posta e la nostra mail precedente per intero:
//   quindici righe per capirne sei. Non era un difetto ma QUATTRO cause distinte, tutte misurate su
//   `cs_messages` (dettaglio sui marcatori piu' sotto): attribution italiana senza "giorno",
//   marcatori che pretendevano un a capo (c'e' chi manda 1.062 caratteri su una riga sola, tagliati
//   ZERO), "Messaggio Inoltrato" assente, firma tagliata solo a riga esattamente "--".
//   Il taglio delle firme vive SOLO in `stripQuoted` (body_clean): `body_text` resta la rete di
//   sicurezza e il contenuto di "Email completa". Test: `node tests/cs_crop.mjs` (33 casi, di cui
//   11 sono la guardia opposta: il crop non deve mangiarsi il testo vero).
//   `backfill_clean` accetta ora `dry: true`: misura l'impatto sullo storico senza scrivere e
//   restituisce solo lunghezze, mai testo di clienti.
// v14 (2026-08-01 notte, brief cs_reply_to_fonte_indipendente): il riconoscimento dello STAMPO del
//   modulo dentro il corpo faceva due lavori (separare due clienti in due conversazioni; dare
//   l'email di chi ha scritto quel messaggio) e, se sbagliava, li faceva fallire INSIEME e in
//   silenzio. Ora l'header `Reply-To` si CONSERVA in `cs_messages.reply_to` (migr 0100): e' la
//   stessa informazione, ma non passa dal corpo, quindi la cintura cross-cliente di cs-send ha una
//   fonte che sopravvive a un cambio di template. In piu' un giro che incontra una notifica del
//   modulo con uno stampo ignoto NON resta muto: scrive `cs_stampo_ignoto` in `health_log`.
//   Azione nuova `backfill_replyto` per lo storico (rilegge il solo header da Gmail, a blocchi).
// v12 (2026-08-01 notte, brief cs_uiux_rifiniture punto 2): lo stampo del modulo del sito arriva
//   anche in INGLESE (il template segue la lingua della sessione del visitatore) e i marcatori
//   erano solo italiani: sulle notifiche EN non scattava ne' il taglio del boilerplate ne'
//   l'estrazione dei campi, e in coda si vedevano card intestate "amimi' (Shopify)" con dentro il
//   modulo intero. Aggiunti i marcatori EN presi dai messaggi VERI, non indovinati: testata
//   "You received a new message from your online store..." (il brief ipotizzava "You've received",
//   che non esiste), campo libero "Body:", coda "By Clicking Submit...". In piu' il NOME della
//   cliente si prende dal campo "Name:" del modulo e batte quello del mittente della notifica:
//   e' la vera causa di "amimi' (Shopify)" nelle card, e riguardava anche le notifiche italiane.
//   `backfill_clean` ripara anche i nomi gia' scritti (`nomi_scritti` nella risposta).
// v11 (2026-08-01, decisione owner in chat): i thread "Collaborazioni e B2B" NON tornano in coda
//   quando arriva una nuova mail (la promozione rumore->cliente di ensureConv li esclude): il B2B
//   si risponde su Gmail, in app non deve comparire. Uscita dalla coda: cs-classify v7 + migr 0091.
// v10 (2026-08-01, brief cs_stato_automatico_e_rumore, PARTE B, apply su OK owner in chat):
//   regola PREVENTIVA sul bulk mail: un messaggio con header `List-Unsubscribe` o
//   `Precedence: bulk/list` non e' un contatto commerciale, qualunque cosa dica il testo ->
//   canale 'rumore'. Il check sta DOPO i rami form/chat (le notifiche Shopify dei moduli e della
//   chat sono gia' instradate prima e NON possono finirci) e PRIMA del default email_diretta.
//   Deterministico, zero AI: vale piu' di qualunque prompt. Denylist estesa per DOMINIO
//   (12 vendor, forma '@dominio') + riclassifica storico = migr 0090.
// v9 (2026-08-01, brief cs_stato_automatico_e_rumore, PARTE A - decisione testuale owner "assolutamente
//   deve essere automatico"): lo stato della coda segue la realta' della posta, senza gesti manuali.
//   - nuovo `out` ingerito -> conversazione `fatto` con stato_by='auto' + evento cs_events 'stato_auto';
//   - nuovo `in` su conversazione `fatto` chiusa DALL'AUTOMATISMO -> riapre a `da_fare` (stato_by='auto');
//   - LA MANO UMANA VINCE SEMPRE: se stato_by e' un nome di persona l'automatismo non tocca nulla
//     (protegge i "fatto senza risposta" = decisioni consapevoli; un thread chiuso a mano che riceve
//     una replica NON viene riaperto, ma recomputeUrgency lo accende gia' come 'thread riaperto');
//   - doppio out / stato gia' giusto -> zero scritture (niente eventi ridondanti);
//   - azione `backfill_stato` (PIN, dry_run DEFAULT): una tantum, chiude con stato_by='auto' le
//     conversazioni da_fare non marcate a mano il cui ULTIMO messaggio e' un nostro out. NB: "ha un
//     out" NON basta (misurato 01-08: 28 con out ma solo 13 con l'out per ultimo; le altre 15 hanno
//     una replica del cliente DOPO e devono restare aperte, e' cio' che la regola live produrrebbe).
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
function classify(from: { email: string; name: string }, replyTo: { email: string; name: string }, subject: string, body: string, extraDeny: string[], bulk = false): { canale: Canale; email: string | null; name: string | null } {
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
  // 4bis) v10: bulk mail per HEADER (List-Unsubscribe / Precedence bulk): newsletter e marketing
  // vendor, qualunque cosa dica il testo. DOPO form/chat (mai su una richiesta cliente dai moduli).
  if (bulk) return { canale: 'rumore', email: fe, name: from.name || null };
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
  const SKIP_KEYS = new Set(['corpo', 'body']);   // v12: 'body' = il 'corpo' del template EN
  const keep = (k: string) => !SKIP_KEYS.has(k) && !k.includes('richiesta') && !k.includes('cliccando') && !k.includes('clicking');
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
// ==== PURE:cs-crop BEGIN ====
// v8: riconoscimento + taglio dello stampo del modulo. Gated sul CONTENUTO: se il wrapper non c'e'
// (es. la risposta del cliente nello stesso thread) non tocca nulla. Ritorna null = "non era uno
// stampo riconoscibile" (il chiamante lascia il testo com'e', mai un taglio sbagliato); ritorna ''
// = stampo riconosciuto ma SENZA testo libero (a valle diventa body_clean NULL, la UI usa il grezzo).
// v12 (brief cs_uiux_rifiniture punto 2): lo stampo arriva anche in INGLESE, perche' il template
// segue la lingua della sessione del visitatore. Con i soli marcatori italiani non scattava niente:
// ne' il taglio ne' l'estrazione dei campi, e in coda comparivano card intestate "amimi' (Shopify)"
// con dentro il boilerplate. I marcatori EN sono presi dai messaggi VERI in `cs_messages`, non
// indovinati: la testata reale e' "You received a new message..." (non "You've received", che era
// l'ipotesi del brief), la coda e' "By Clicking Submit The User Declares...".
const FORM_WRAP_RE = /(?:Hai\s+ricevuto\s+un\s+nuovo\s+messaggio\s+dal\s+modulo\s+di\s+contatto|You\s+(?:have\s+)?received\s+a\s+new\s+message\s+from\s+your\s+online\s+store)/i;
function stripFormPrint(s: string): string | null {
  if (!FORM_WRAP_RE.test(s)) return null;
  // coda: legalese di consenso fino in fondo (include il "SI'"/"Yes" finale), IT o EN
  let t = s.replace(/(?:^|\n)\s*(?:Cliccando\s+Su\s+Invia|By\s+Clicking\s+Submit)[\s\S]*$/i, '');
  // testa: tutto fino all'etichetta del campo libero (tollerante al word-wrap: \s+ attraversa i newline)
  const m = t.match(/(?:(?:^|\n)\s*(?:Corpo|Body)|Nella\s+Casella\s+Della\s+Richiesta)\s*:\s*/i);
  if (!m || m.index == null) return null;   // wrapper presente ma formato ignoto: non tagliare
  t = t.slice(m.index + m[0].length);
  return t.trim();
}
// v12: il nome che il modulo ha raccolto dal campo "Name:". Senza, `classify` ripiega sul nome del
// MITTENTE, che per le notifiche del modulo e' "amimi' (Shopify)": in coda si leggeva il nostro
// nome al posto di quello della cliente. Vale IT ed EN (lo stampo italiano usa comunque "Name:").
const nomeDalModulo = (ff: Record<string, string> | null): string | null => {
  const v = String(ff?.name ?? ff?.nome ?? '').trim();
  return v && v.length <= 80 ? v : null;
};
function extractOrderNumber(text: string): number | null {
  const m = text.match(/(?:ordine|order|#)\s*#?\s*(\d{3,6})/i);
  return m ? Number(m[1]) : null;
}
const detectLingua = (t: string) => (/\b(the|your|order|hello|hi|please|thanks|would|available)\b/i.test(t) && !/\b(il|la|per|grazie|ordine|ciao|salve|vorrei|disponibile)\b/i.test(t) ? 'en' : 'it');

// v6: tronca la citazione del thread precedente nel corpo di una RISPOSTA (le mail Gmail includono
// tutto il quotato). Regola: taglio al PRIMO marcatore tipico (Gmail IT/EN, Outlook IT/EN, righe
// quotate '>'), poi cap 8000 char. Prevedibile e documentata; meglio perdere una coda ambigua che
// gonfiare corpi/classificatore/prompt col thread intero duplicato.
// v15 (2026-08-02, brief cs_crop_e_dati_falsi Parte 1): quattro cause MISURATE su `cs_messages`
// per cui la bolla mostrava ancora citazioni, forward e firme.
//   (A) l'attribution italiana pretendeva la parola "giorno", che le mail vere NON scrivono:
//       le forme reali sono "Il 22/07/2026 10:13, X ha scritto:" e "Il 31 Luglio 2026, alle
//       17:14:05 UTC X<mail> ha scritto:". Ora basta una DATA dopo "Il". Il vincolo della data
//       non e' cosmetico: senza, "Il corriere mi ha scritto:" mangerebbe il testo vero.
//   (B) ogni marcatore pretendeva un a capo prima, e c'e' chi manda il corpo su UNA riga sola
//       (misurato: 1.062 caratteri, zero \n, tagliato ZERO). L'ancora e' ora un confine, non un
//       newline: i marcatori agganciano anche a meta' riga.
//   (C) i forward italiani scrivono "Messaggio Inoltrato", che non era in lista.
//   (D) la firma si tagliava solo se la riga era ESATTAMENTE "--". Vedi SIG_MARKERS.
const QUOTE_MARKERS = [
  // NB: l'attribution nelle mail reali VA A CAPO nel mezzo (l'email wrappa su una riga nuova):
  // serve [\s\S] lazy, non '.', per attraversare i newline; e il wrap puo' cadere anche PRIMA di
  // "ha scritto"/"wrote", quindi \s al posto dello spazio.
  /(?:^|[\s>])Il\s+(?:giorno\b|\d{1,2}\b)[\s\S]{0,220}?\sha\s+scritto:/i,   // Gmail/Thunderbird/Libero IT
  /(?:^|[\s>])On\s[\s\S]{0,220}?\swrote:/i,                                 // Gmail EN
  /(?:^|[\s>])-{2,}\s*(?:Original Message|Messaggio originale|Messaggio Inoltrato|Forwarded message)\s*-{2,}/i,
  /\r?\n_{5,}\r?\n/,                                       // divisore Outlook
  /(?:^|[\s>])Da:\s.{1,120}\r?\n\s*(?:Inviato|Data):/i,    // blocco header Outlook IT
  /(?:^|[\s>])From:\s.{1,120}\r?\n\s*Sent:/i,              // blocco header Outlook EN
  /(?:^|[\s>])>\s?(?:Il giorno|On|Da:|From:)\b/i,          // prima riga quotata col prefisso >
];
// v15 causa (D): le firme dei client di posta. Agganciano anche a meta' riga, perche' il caso
// peggiore misurato non ha nemmeno un a capo. Vivono SOLO in stripQuoted (body_clean) e NON in
// stripQuote (body_text): body_text resta la rete di sicurezza e il contenuto di "Email completa",
// quindi la firma si vede ancora espandendo. Regola invariata: mai perdere testo.
const SIG_MARKERS = [
  // riga che comincia con "--", anche se prosegue. ESATTAMENTE due trattini: tre o piu' sono una
  // riga divisoria (le notifiche Shopify sottolineano cosi' i titoli) e tagliarle li' butta via il
  // corpo. Il delimitatore di firma della posta e' "--", non "-----".
  /(?:^|\n)[ \t]*-{2}(?!-)(?=[ \t]|\r?\n|$)/,
  /(?:^|[\s>])-{2,}[ \t]+(?=Inviato\b|Sent\b|Amim)/i,      // "-- Inviato da Libero Mail", "-- Amimi https://..."
  /(?:^|[\s>])Inviato\s+da(?:l)?\s+(?:il\s+)?(?:mio\s+)?(?:iPhone|iPad|iPod|Android|Libero|Outlook|Yahoo|Samsung|Huawei|Windows|Mail\b)/i,
  /(?:^|[\s>])Sent\s+from\s+(?:my\s+)?(?:iPhone|iPad|iPod|Android|Outlook|Yahoo|Samsung|Galaxy|Windows|Mail\b)/i,
  /(?:^|[\s>])(?:Get|Scarica)\s+Outlook\s+(?:for|per)\s+(?:iOS|Android)/i,
];
// indice del primo marcatore che aggancia (o la fine): condiviso da stripQuote e stripQuoted, cosi'
// le due funzioni non possono divergere sul punto di taglio.
function firstMarker(t: string, markers: RegExp[]): number {
  let cut = t.length;
  for (const re of markers) { const m = t.match(re); if (m && m.index != null && m.index < cut) cut = m.index; }
  return cut;
}
// v15 causa (D), seconda meta': le firme scritte come righe interamente fra asterischi in coda
// ("*Cordiali Saluti*", "*Nome Cognome*", "*MAIL: ... *"). Si tolgono solo dalla CODA e solo se
// resta qualcosa: un messaggio che e' tutto fra asterischi non deve sparire.
function dropAsteriskTail(s: string): string {
  const lines = s.split('\n');
  let end = lines.length;
  while (end > 0) {
    const l = lines[end - 1].trim();
    if (!l) { end--; continue; }
    if (/^\*.+\*$/.test(l)) { end--; continue; }
    break;
  }
  return end > 0 ? lines.slice(0, end).join('\n') : s;
}
function stripQuote(t: string): string {
  return t.slice(0, firstMarker(t, QUOTE_MARKERS)).trim().slice(0, 8000);
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
  // taglio alla prima attribution line (i marcatori agganciano a inizio corpo e a meta' riga: v15)
  s = s.slice(0, firstMarker(s, QUOTE_MARKERS));
  const kept: string[] = [];
  for (const line of s.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*>/.test(line)) continue;          // riga quotata residua
    kept.push(line);
  }
  // v15: la firma si taglia DOPO aver tolto le righe quotate, sulla stringa risultante
  s = kept.join('\n');
  s = dropAsteriskTail(s.slice(0, firstMarker(s, SIG_MARKERS)));
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
  // v8: stampo del modulo del sito: via testa (campi) e coda (legalese), restano le parole della
  // cliente. DOPO il taglio citazioni: una NOSTRA risposta che quota il modulo ha gia' perso il
  // quotato qui sopra, quindi il wrapper non c'e' piu' e questo passo non la tocca.
  if (canale === 'form_contatto' || canale === 'form_evento') {
    const f = stripFormPrint(s);
    if (f !== null) s = f;
  }
  return s || null;
}
// v15: l'anteprima della card = le stesse parole della bolla, su una riga sola. `ripiego` e' lo
// snippet di Gmail: si usa solo se dopo la pulizia non resta niente, cosi' una card non resta muta.
function snippetDa(clean: string | null, ripiego: string): string {
  const s = (clean || '').replace(/\s+/g, ' ').trim();
  return (s || (ripiego || '').replace(/\s+/g, ' ').trim()).slice(0, 300);
}
// ==== PURE:cs-crop END ====

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
  nuovaSubmission: boolean;   // v13: questo messaggio E' un invio nuovo dal modulo del sito
  replyTo: string | null;     // v14: header Reply-To, conservato (migr 0100)
  stampoIgnoto: boolean;      // v14: notifica del modulo con un template che non riconosciamo
};

// ==== PURE:cs-convkey BEGIN ====
// v13 (brief cs_form_thread_merge). L'oggetto della notifica del modulo ha granularita' al MINUTO
// ("New customer message on 1 August 2026 at 17:38"): due invii nello stesso minuto danno oggetto,
// mittente e destinatario identici, Gmail li accoda nello STESSO thread, e una conversazione sola
// finisce per contenere le richieste di due persone diverse.
//
// SCELTA DI PROGETTO, e il motivo per cui non e' quella "pulita": il vincolo UNIQUE su
// `gmail_thread_id` NON viene tolto. Toglierlo aprirebbe la condizione "due righe per thread", su
// cui oggi si romperebbero cinque `.eq('gmail_thread_id', X).maybeSingle()` di questo file: con due
// righe PostgREST non ritorna la prima, ritorna `data=null` piu' un errore PGRST116 che il codice
// non destruttura, e l'esito sarebbe il cursore Gmail fermo (la posta smette di entrare) oppure la
// nostra risposta scartata in silenzio. Quel percorso da qui non e' provabile end to end, perche'
// serve il token Gmail. Quindi la conversazione nuova nasce con una chiave DIVERSA,
// `<thread>#<gmail_message_id>`: per il database e' un valore nuovo, il vincolo UNIQUE resta valido,
// e ogni lookup esistente per il thread vero continua a trovare esattamente una riga.
// PREZZO DICHIARATO: `gmail_thread_id` smette di essere sempre un id Gmail puro. Chi lo usa per
// chiamare l'API Gmail deve saltare le chiavi che contengono '#' (il thread vero e' `split('#')[0]`).
// Verificato prima di scegliere: 0 conversazioni contengono gia' un '#', quindi non collide.
const chiaveFratelli = (threadId: string) => threadId + '#%';
const isFormCanale = (c: unknown) => c === 'form_contatto' || c === 'form_evento';
const normEmail = (v: unknown): string | null => {
  const hit = String(v ?? '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return hit ? hit[0] : null;
};
type Fratello = { id: string; canale?: unknown; categoria?: unknown; last_msg_at?: unknown; customer_email?: unknown };
type DecisioneConv = { modo: 'attach'; id: string } | { modo: 'create'; key: string };
/**
 * Decide DOVE va a finire un messaggio in ingresso. Funzione PURA: nessun IO, cosi' e' provabile.
 * `ex` = la conversazione gia' presente sul thread (null se il thread e' nuovo).
 * Ordine delle regole, e ognuna ha il suo perche':
 *  1. thread nuovo -> si crea con la chiave = thread id: identico a oggi;
 *  2. `ex` non e' una conversazione da modulo -> ci si attacca: email_diretta, chat_notifica e
 *     rumore non cambiano di una virgola, li' il threading di Gmail e' quello giusto;
 *  3. non sappiamo chi scrive, o non sapevamo chi era il primo, o e' la STESSA persona -> attach:
 *     un dato mancante non deve mai spezzare una conversazione;
 *  4. esiste gia' un "fratello" con quella email -> attach a lui: il terzo invio della stessa
 *     persona non crea una terza scheda, e il suo follow-up atterra sulla SUA conversazione;
 *  5. e' davvero un invio nuovo dal modulo, da un'altra persona -> si crea con chiave suffissata;
 *  6. tutto il resto (un follow-up da un indirizzo mai visto, che non e' uno stampo del modulo)
 *     -> attach: non si frammenta per un caso ambiguo, ci pensa la cintura di cs-send.
 */
function decidiConv(ex: Fratello | null, fratelli: Fratello[], msg: { id: string; threadId: string; email: string | null; nuovaSubmission: boolean }): DecisioneConv {
  if (!ex) return { modo: 'create', key: msg.threadId };
  if (!isFormCanale(ex.canale)) return { modo: 'attach', id: ex.id };
  const mia = normEmail(msg.email), sua = normEmail(ex.customer_email);
  if (!mia || !sua || mia === sua) return { modo: 'attach', id: ex.id };
  const gemello = fratelli.find((f) => normEmail(f.customer_email) === mia);
  if (gemello) return { modo: 'attach', id: gemello.id };
  if (msg.nuovaSubmission) return { modo: 'create', key: `${msg.threadId}#${msg.id}` };
  return { modo: 'attach', id: ex.id };
}
// ==== PURE:cs-convkey END ====

// ==== PURE:cs-sollecito BEGIN ====
// La regola "2+ messaggi del cliente e nessuna nostra risposta = sollecito" e' giusta per la posta
// normale, ma su una RAFFICA dal modulo (due invii a 43 secondi, che finiscono nello stesso thread)
// accende un'urgenza che nessuno ha sollecitato: e' successo davvero il 01-08.
// GATED SUL CANALE, e non e' un dettaglio: le notifiche della CHAT del sito arrivano da
// `no-reply@mailer.shopify.com`, che e' anch'esso un mittente wrapper, e due messaggi di chat
// ravvicinati sono la norma. Senza il cancello sul canale questa regola spegnerebbe il sollecito
// proprio quando la cliente e' collegata al sito e sta aspettando (trovato da una verifica
// avversariale, con un caso gia' presente nei dati: due notifiche di chat a 23 secondi).
// La raffica si riconosce senza AI: canale da modulo, almeno due messaggi in ingresso, TUTTI dal
// mittente wrapper, e meno di 10 minuti fra il primo e l'ultimo. La soglia e' scelta a tavolino,
// non misurata: serve solo a separare "due invii di fila" da "una cliente che risollecita ore dopo".
// TRE SEDI, UNA REGOLA: questo blocco e' copia IDENTICA in cs-sync, cs-classify e cs-send.
// `tests/cs_convkey.mjs` ne confronta l'impronta e diventa rosso se una sola delle tre cambia.
const RAFFICA_MS = 10 * 60 * 1000;
const isCanaleModulo = (c: unknown) => c === 'form_contatto' || c === 'form_evento';
const isWrapperSender = (e: unknown) => /@(?:shopify\.com|mailer\.shopify\.com|shopifyemail\.com)$/.test(String(e ?? '').toLowerCase());
function isRafficaModulo(inbound: { from_email?: unknown; sent_at?: unknown }[], canale: unknown): boolean {
  if (!isCanaleModulo(canale)) return false;
  if (!Array.isArray(inbound) || inbound.length < 2) return false;
  if (!inbound.every((m) => isWrapperSender(m.from_email))) return false;
  const ts = inbound.map((m) => Date.parse(String(m.sent_at ?? ''))).filter((n) => Number.isFinite(n));
  if (ts.length !== inbound.length) return false;
  return Math.max(...ts) - Math.min(...ts) < RAFFICA_MS;
}
// ==== PURE:cs-sollecito END ====

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg } = await sb.from('app_config').select('pin_hash').eq('id', 1).single();
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);

  const action = String(body.action || 'poll');
  if (action !== 'poll' && action !== 'backfill_out' && action !== 'backfill_clean' && action !== 'backfill_stato' && action !== 'backfill_replyto' && action !== 'backfill_snippet') return json({ error: 'azione sconosciuta: ' + action }, 422);

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

  // v14 (brief cs_reply_to_fonte_indipendente punto 5): chiave PROPRIA per gli stampi non
  // riconosciuti, e ACCUMULA sulla giornata invece di sovrascrivere. Due dettagli che non sono
  // dettagli: (a) se finisse dentro la chiave `cs_sync` il giro successivo la cancellerebbe, e la
  // segnalazione durerebbe cinque minuti; (b) l'unique index e' (day,k), quindi un INSERT nudo al
  // secondo giro della giornata fallirebbe e porterebbe via anche il resto della scrittura, che e'
  // esattamente il modo in cui una guardia si spegne in silenzio (caso ce-guard, 29-07).
  const writeStampoIgnoto = async (n: number, lingue: string[]) => {
    if (n <= 0) return;   // zero non si scrive: la chiave esiste solo quando c'e' qualcosa da vedere
    const today = new Date().toISOString().slice(0, 10);
    const { data: ex } = await sb.from('health_log').select('n').eq('day', today).eq('k', 'cs_stampo_ignoto').maybeSingle();
    const tot = (Number(ex?.n) || 0) + n;
    await sb.from('health_log').delete().eq('day', today).eq('k', 'cs_stampo_ignoto');
    await sb.from('health_log').insert({
      day: today, k: 'cs_stampo_ignoto', n: tot, severity: 'warn', created_at: new Date().toISOString(),
      label: `notifiche dal modulo del sito con uno stampo NON riconosciuto (lingua sospetta: ${lingue.join(', ') || 'n/d'}): i campi del modulo non vengono estratti e due invii ravvicinati non si separano. Controllare il template Shopify e aggiungere i marcatori a FORM_WRAP_RE.`,
    });
  };

  // v9: transizione AUTOMATICA dello stato (Parte A). La mano umana vince sempre: se stato_by e'
  // il nome di una persona non si tocca nulla; la riapertura vale solo per cio' che l'automatismo
  // stesso ha chiuso; stato gia' giusto = zero scritture (niente eventi ridondanti).
  const setStatoAuto = async (convId: string, nuovo: 'fatto' | 'da_fare', motivo: string): Promise<boolean> => {
    const { data: c } = await sb.from('cs_conversations').select('id, stato, stato_by').eq('id', convId).maybeSingle();
    if (!c) return false;
    if (c.stato_by && c.stato_by !== 'auto') return false;   // marcatura umana: mai sovrascritta
    if (c.stato === nuovo) return false;
    if (nuovo === 'da_fare' && !(c.stato === 'fatto' && c.stato_by === 'auto')) return false;   // riapre solo cio' che ha chiuso da sola
    const { error } = await sb.from('cs_conversations').update({ stato: nuovo, stato_by: 'auto', stato_at: new Date().toISOString() }).eq('id', convId);
    if (error) return false;
    await sb.from('cs_events').insert({ conversation_id: convId, azione: 'stato_auto', chi: 'cs-sync', dettaglio: { da: c.stato, a: nuovo, motivo } });
    return true;
  };

  // --- BACKFILL stato (v9, una tantum, dry_run DEFAULT: si applica solo con apply:true) ---
  // Chiude con stato_by='auto' le conversazioni non-rumore, da_fare, NON marcate a mano, il cui
  // ULTIMO messaggio e' un nostro out. Solo DB, niente Gmail. Idempotente: re-run scrive 0.
  if (action === 'backfill_stato') {
    const apply = body.apply === true;
    const { data: convs } = await sb.from('cs_conversations')
      .select('id, subject, stato, stato_by')
      .neq('canale', 'rumore').eq('stato', 'da_fare');
    const candidates: { id: string; subject: string }[] = [];
    for (const c of (convs ?? []) as { id: string; subject: string | null; stato: string; stato_by: string | null }[]) {
      if (c.stato_by && c.stato_by !== 'auto') continue;
      const { data: lastM } = await sb.from('cs_messages').select('direction').eq('conversation_id', c.id).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1);
      if (lastM && lastM[0]?.direction === 'out') candidates.push({ id: c.id, subject: String(c.subject ?? '').slice(0, 80) });
    }
    if (!apply) return json({ ok: true, dry_run: true, chiudibili: candidates.length, elenco: candidates });
    let closed = 0;
    for (const c of candidates) if (await setStatoAuto(c.id, 'fatto', 'backfill: risposta gia\' inviata')) closed++;
    return json({ ok: true, dry_run: false, chiusi: closed });
  }

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
  // v14: notifiche del modulo con uno stampo che non riconosciamo. Contate qui, scritte a fine giro
  // su una chiave PROPRIA di health_log: se finissero dentro `cs_sync` sparirebbero al giro dopo.
  let stampoIgnoto = 0;
  const lingueIgnote = new Set<string>();
  let outMsg = 0;

  // v6: ricalcolo DETERMINISTICO dell'urgenza. Replica ESATTAMENTE la regola sollecito di
  // cs-classify (ruleUrgency, stessi motivi testuali) e la applica/spegne quando i conteggi
  // in/out cambiano. MAI l'AI, MAI categoria/categoria_source (il filtro "pesca solo mai
  // tentate" di cs-classify resta intatto: fix 1 audit anti-loop). Un'urgenza decisa dall'AI
  // (motivo diverso dai due della regola) non viene mai toccata da qui.
  const RULE_MOTIVI = ['thread riaperto (sollecito)', '2+ messaggi senza nostra risposta'];
  const recomputeUrgency = async (convId: string): Promise<boolean> => {
    const { data: c } = await sb.from('cs_conversations')
      .select('id, canale, stato, stato_at, last_direction, last_msg_at, categoria_source, urgente, urgenza_motivo, flags')
      .eq('id', convId).maybeSingle();
    if (!c || !c.categoria_source) return false;   // mai classificata: ci pensera' cs-classify alla pesca
    const { data: msgs } = await sb.from('cs_messages').select('direction,from_email,sent_at').eq('conversation_id', convId);
    const inMsgs = (msgs ?? []).filter((m) => m.direction === 'in');
    const inCnt = inMsgs.length;
    const outCnt = (msgs ?? []).filter((m) => m.direction === 'out').length;
    const reopened = String(c.stato) === 'fatto' && c.last_direction === 'in' && !!c.last_msg_at && (!c.stato_at || (c.last_msg_at as string) > (c.stato_at as string));
    // v13: una RAFFICA dal modulo (due invii di fila nello stesso thread) non e' un sollecito
    const ruleUrg = reopened || (inCnt >= 2 && outCnt === 0 && !isRafficaModulo(inMsgs, c.canale));
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
    let conv: { id: string; canale: string; last_msg_at: string | null; customer_email?: string | null } | null = null;
    try {
      const { data } = await sb.from('cs_conversations').select('id, canale, last_msg_at, customer_email').eq('gmail_thread_id', threadId).maybeSingle();
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
    // v13: se sul thread del modulo esistono schede separate (raffica), la nostra risposta va appesa
    // a QUELLA della destinataria, non alla prima. Succede quando si risponde a mano da Gmail dentro
    // il thread del wrapper. Fail-soft: qualunque intoppo lascia il bersaglio di oggi. Non si crea
    // mai una conversazione da un messaggio in uscita: quel principio non cambia.
    if (isFormCanale(conv.canale) && normEmail(to.email) && normEmail(to.email) !== normEmail(conv.customer_email)) {
      try {
        const { data: frat, error: eFrat } = await sb.from('cs_conversations')
          .select('id, canale, last_msg_at, customer_email').like('gmail_thread_id', chiaveFratelli(threadId));
        if (eFrat) throw new Error('fratelli_non_leggibili');   // ripiego: bersaglio di oggi
        const g = ((frat ?? []) as typeof conv[]).find((f) => f && normEmail(f.customer_email) === normEmail(to.email));
        if (g) conv = g;
      } catch { /* fail-soft */ }
    }
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
        await setStatoAuto(conv.id, 'fatto', 'risposta inviata');   // v9: abbiamo risposto -> chiusa da sola
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
      // v13: una chiave suffissata non e' un thread Gmail: la GET /threads/<chiave> darebbe 404 a
      // ogni giro. Per il canale form questo backfill non serve comunque, perche' le nostre risposte
      // ai moduli partono in un thread NUOVO e la riga out la scrive cs-send.
      if (String(c.gmail_thread_id).includes('#')) continue;
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

  // --- BACKFILL snippet (v15): l'anteprima delle card gia' in coda ---
  // Le card mostravano il boilerplate del modulo perche' `snippet` veniva da Gmail. Qui si riallinea
  // all'ULTIMO messaggio in ingresso della conversazione, che e' quello che l'anteprima rappresenta.
  // `dry: true` conta e non scrive. Idempotente: rieseguito a regime scrive 0.
  if (action === 'backfill_snippet') {
    const dry = body.dry === true;
    const { data: convRows } = await sb.from('cs_conversations').select('id, canale, snippet');
    const convs = (convRows ?? []) as { id: string; canale: string; snippet: string | null }[];
    let scanned = 0, wrote = 0, invariati = 0, senzaIn = 0; const errors: string[] = [];
    for (const c of convs) {
      scanned++;
      const { data: mrows } = await sb.from('cs_messages')
        .select('body_text, body_clean, sent_at').eq('conversation_id', c.id).eq('direction', 'in')
        .order('sent_at', { ascending: false, nullsFirst: false }).limit(1);
      const m = (mrows ?? [])[0] as { body_text: string | null; body_clean: string | null } | undefined;
      if (!m) { senzaIn++; continue; }
      const nuovo = snippetDa(m.body_clean ?? stripQuoted(m.body_text ?? '', c.canale), c.snippet ?? '');
      if (!nuovo || nuovo === (c.snippet ?? '')) { invariati++; continue; }
      if (dry) { wrote++; continue; }
      const { error: ue } = await sb.from('cs_conversations').update({ snippet: nuovo }).eq('id', c.id);
      if (ue) { errors.push(c.id.slice(0, 8) + ':' + ue.message.slice(0, 60)); continue; }
      wrote++;
    }
    return json({ ok: true, ...(dry ? { dry: true } : {}), scanned, snippet_scritti: wrote, invariati, senza_messaggi_in: senzaIn, ...(errors.length ? { errors: errors.slice(0, 10) } : {}) });
  }

  // --- BACKFILL body_clean (v7): pulisce lo storico gia' ingerito con la STESSA stripQuoted ---
  // A blocchi (limit/offset su righe con body_clean NULL e body_text presente); body_text MAI
  // toccato; idempotente (ri-eseguito a coda vuota scrive 0). `force: true` ricalcola TUTTE le
  // righe (convergenza se le regole di strip migliorano in futuro).
  if (action === 'backfill_clean') {
    const limit = Math.min(Number(body.limit) || 200, 400);
    const force = body.force === true;
    // v15: prova a vuoto. Calcola esattamente cio' che scriverebbe e NON scrive niente, restituendo
    // la distribuzione dell'impatto (quante righe cambiano, quante DIVENTEREBBERO NULL, i tagli piu'
    // profondi) con le sole lunghezze: nessun testo di cliente esce da qui. Serve a misurare il
    // rischio opposto al difetto - un crop troppo aggressivo che si mangia le parole vere - PRIMA
    // di toccare lo storico.
    const dry = body.dry === true;
    const tagli: { id: string; da: number; a: number }[] = [];
    let sarebbeNull = 0;
    const { data: convRows } = await sb.from('cs_conversations').select('id, canale, customer_name');
    const canaleOf = new Map<string, string>();
    const nomeOf = new Map<string, string | null>();
    for (const c of (convRows ?? []) as { id: string; canale: string; customer_name: string | null }[]) { canaleOf.set(c.id, c.canale); nomeOf.set(c.id, c.customer_name); }
    // v12: un nome "amimi' (Shopify)" o vuoto su una conversazione da modulo e' il nome del MITTENTE
    // della notifica, non della cliente: e' quello che la card mostrava al posto suo.
    const nomeDaSostituire = (n: string | null) => !n || /shopify/i.test(n) || isAmimi(String(n).toLowerCase());
    const nomiScritti: string[] = [];
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
      if (clean !== m.body_clean) {
        const da = (m.body_clean ?? m.body_text).length, a = (clean ?? '').length;
        if (clean === null && m.body_clean !== null) sarebbeNull++;
        if (a < da) tagli.push({ id: m.id, da, a });
      }
      if (dry) { if (Object.keys(upd).length) wrote++; else invariati++; continue; }
      // v8: ri-deriva anche form_fields (solo dove NULL/vuoto) sui messaggi 'in' col wrapper del modulo
      if ((canale === 'form_contatto' || canale === 'form_evento') && m.direction === 'in'
        && (!m.form_fields || !Object.keys(m.form_fields).length) && FORM_WRAP_RE.test(m.body_text)) {
        const ff = extractFormFields(m.body_text);
        if (Object.keys(ff).length) upd.form_fields = ff;
      }
      // v12: e con i campi arriva anche il NOME della cliente, che sulla conversazione mancava
      if ((canale === 'form_contatto' || canale === 'form_evento') && m.direction === 'in' && FORM_WRAP_RE.test(m.body_text)) {
        const nome = nomeDalModulo((upd.form_fields as Record<string, string>) ?? m.form_fields ?? extractFormFields(m.body_text));
        if (nome && nomeDaSostituire(nomeOf.get(m.conversation_id) ?? null)) {
          const { error: ne } = await sb.from('cs_conversations').update({ customer_name: nome }).eq('id', m.conversation_id);
          if (ne) errors.push(m.conversation_id + ':nome:' + ne.message.slice(0, 50));
          else { nomeOf.set(m.conversation_id, nome); nomiScritti.push(m.conversation_id); }
        }
      }
      if (!Object.keys(upd).length) { invariati++; continue; }
      const { error: ue } = await sb.from('cs_messages').update(upd).eq('id', m.id);
      if (ue) { errors.push(m.id + ':' + ue.message.slice(0, 60)); continue; }
      if (upd.body_clean !== undefined) wrote++;
      if (upd.form_fields !== undefined) fieldsWrote++;
    }
    const { count: remaining } = await sb.from('cs_messages').select('id', { count: 'exact', head: true }).is('body_clean', null).not('body_text', 'is', null);
    if (dry) {
      tagli.sort((a, b) => (b.da - b.a) - (a.da - a.a));
      return json({
        ok: true, dry: true, scanned, cambierebbero: wrote, invariati, last_id: lastId,
        sarebbero_null: sarebbeNull,
        tagli_piu_profondi: tagli.slice(0, 15).map((x) => ({ id: x.id.slice(0, 8), da: x.da, a: x.a })),
      });
    }
    return json({ ok: true, scanned, clean_scritti: wrote, fields_scritti: fieldsWrote, nomi_scritti: nomiScritti.length, invariati, last_id: lastId, remaining: remaining ?? 0, ...(errors.length ? { errors: errors.slice(0, 10) } : {}) });
  }

  // --- BACKFILL reply_to (v14, brief cs_reply_to_fonte_indipendente punto 2) ---
  // Rilegge da Gmail il SOLO header Reply-To dei messaggi in ingresso che ancora non ce l'hanno.
  // Formato `metadata` con un header solo: la chiamata piu' leggera che Gmail offra. A blocchi, con
  // keyset su id come `backfill_clean`, e per lo stesso motivo: la maggior parte della posta diretta
  // NON ha un Reply-To, quindi quelle righe restano legittimamente NULL e senza keyset occuperebbero
  // per sempre la testa della coda. Il giro finisce quando una pagina non torna piu' righe, non
  // quando `remaining` va a zero. Idempotente: tocca solo cio' che e' NULL e scrive solo se trova.
  // Un messaggio non piu' su Gmail (404) si salta e si dichiara: non e' un errore, e' storia.
  if (action === 'backfill_replyto') {
    const limit = Math.min(Number(body.limit) || 200, 400);
    let q = sb.from('cs_messages').select('id, gmail_message_id').eq('direction', 'in').is('reply_to', null).order('id', { ascending: true }).limit(limit);
    if (body.after_id) q = q.gt('id', String(body.after_id));
    const { data: msgs, error: qe } = await q;
    if (qe) return json({ ok: false, error: qe.message }, 500);
    let scanned = 0, wrote = 0, senzaHeader = 0, spariti = 0; let lastId: string | null = null; const errors: string[] = [];
    for (const m of (msgs ?? []) as { id: string; gmail_message_id: string }[]) {
      scanned++; lastId = m.id;
      const mg = await gGet(`/messages/${encodeURIComponent(m.gmail_message_id)}?format=metadata&metadataHeaders=Reply-To`, token);
      if (mg.status === 404) { spariti++; continue; }
      if (!mg.ok) { errors.push(m.id + ':gmail ' + mg.status); continue; }
      const rt = parseAddr(hdr((mg.j as GMsg).payload?.headers, 'reply-to')).email;
      if (!rt) { senzaHeader++; continue; }
      const { error: ue } = await sb.from('cs_messages').update({ reply_to: rt }).eq('id', m.id);
      if (ue) { errors.push(m.id + ':' + ue.message.slice(0, 60)); continue; }
      wrote++;
    }
    const { count: remaining } = await sb.from('cs_messages').select('id', { count: 'exact', head: true }).eq('direction', 'in').is('reply_to', null);
    return json({ ok: true, scanned, scritti: wrote, senza_header: senzaHeader, spariti_da_gmail: spariti, last_id: lastId, remaining: remaining ?? 0, ...(errors.length ? { errors: errors.slice(0, 10) } : {}) });
  }

  // --- DRY RUN: classifica i messaggi recenti, ritorna SOLO conteggi, scrive NULLA ---
  if (dryRun) {
    const lst = await gGet('/messages?maxResults=40&q=' + encodeURIComponent('in:inbox newer_than:30d'), token);
    if (!lst.ok) return json({ ok: false, error: 'gmail_list ' + lst.status, detail: JSON.stringify(lst.j).slice(0, 200) });
    const ids = ((lst.j.messages as { id: string }[]) ?? []).map((m) => m.id);
    for (const id of ids) {
      const mg = await gGet(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe&metadataHeaders=Precedence`, token);
      if (!mg.ok) { parseFailed++; continue; }
      const p = (mg.j as GMsg).payload;
      const from = parseAddr(hdr(p?.headers, 'from'));
      const replyTo = parseAddr(hdr(p?.headers, 'reply-to'));
      const subject = hdr(p?.headers, 'subject');
      const bulk = !!hdr(p?.headers, 'list-unsubscribe') || /\b(bulk|list)\b/i.test(hdr(p?.headers, 'precedence'));
      counts[classify(from, replyTo, subject, '', extraDeny, bulk).canale]++;
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
      // v10: header di bulk mail = segnale deterministico di newsletter/marketing
      const bulk = !!hdr(H, 'list-unsubscribe') || /\b(bulk|list)\b/i.test(hdr(H, 'precedence'));
      const cl = classify(from, replyTo, subject, bodyText, extraDeny, bulk);
      const isForm = cl.canale === 'form_contatto' || cl.canale === 'form_evento';
      // v8: i campi si estraggono solo dallo STAMPO vero (wrapper presente), mai dalle risposte
      // successive del cliente nello stesso thread; {} non si scrive (resta NULL, la UI non accende)
      const ff = isForm && FORM_WRAP_RE.test(bodyText) ? extractFormFields(bodyText) : {};
      // v12: il nome scritto dalla cliente nel modulo batte quello del mittente della notifica
      const nomeForm = isForm ? nomeDalModulo(ff) : null;
      if (nomeForm) cl.name = nomeForm;
      // v13: questo messaggio e' un INVIO NUOVO dal modulo (non una risposta della cliente nello
      // stesso thread)? Le tre condizioni sono gia' tutte calcolate qui sopra: costo zero.
      const nuovaSubmission = isForm && FORM_WRAP_RE.test(bodyText) && isShopifySender(from.email);
      // v14 (brief cs_reply_to_fonte_indipendente punto 5): NON restare muti su uno stampo ignoto.
      // `classify` mette su canale modulo solo cio' che arriva dal mittente wrapper Shopify CON un
      // reply-to cliente: se una riga cosi' non aggancia i marcatori IT/EN, il template e' cambiato
      // (una terza lingua, o un ritocco di Shopify). Le risposte della cliente dentro lo stesso
      // thread NON entrano qui: `classify` le manda su email_diretta, quindi isForm e' false.
      // Misurato il 01-08 sui dati veri: 19 messaggi in ingresso su canale modulo, 19 con lo stampo,
      // quindi oggi questo contatore vale zero, e vale zero per il motivo giusto.
      const stampoIgnoto = isForm && !FORM_WRAP_RE.test(bodyText);
      return {
        cl, from, to, subject, bodyText, nuovaSubmission, stampoIgnoto,
        replyTo: replyTo.email || null,
        sentAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
        // v15 (UAT 02-08): l'anteprima della card in coda mostrava ancora il boilerplate inglese del
        // modulo ("You received a new message from your online store's contact form. Country Code:
        // GB Name: ..."), mentre la bolla nel thread era gia' pulita: lo snippet arrivava da Gmail,
        // che non sa niente di `body_clean`. Ora e' lo STESSO testo della bolla. Ripiego sullo
        // snippet di Gmail se la pulizia non lascia niente: mai una card senza anteprima.
        snippet: stripNull(snippetDa(stripQuoted(bodyText, cl.canale), msg.snippet ?? '')),
        formFields: Object.keys(ff).length ? ff : null,
        order: extractOrderNumber(subject + '\n' + bodyText), lingua: detectLingua(bodyText || subject),
      };
    } catch { return null; }
  };

  // conversazione: idempotente su gmail_thread_id, non clobbera stato/stato_by; promuove un thread
  // gia' marcato rumore se arriva un messaggio cliente reale. Lancia su errore DB reale (-> transient).
  const ensureConv = async (threadId: string, cl: Parsed['cl'], meta: { sentAt: string | null; subject: string; snippet: string; order: number | null; lingua: string }, msg: { id: string; nuovaSubmission: boolean } = { id: '', nuovaSubmission: false }): Promise<string> => {
    const { data: ex0 } = await sb.from('cs_conversations').select('id,canale,categoria,last_msg_at,customer_email').eq('gmail_thread_id', threadId).maybeSingle();
    let ex = ex0 as Fratello | null;
    // v13: raffica dal modulo. Solo se la conversazione sul thread e' da MODULO e l'email in arrivo
    // e' di un'ALTRA persona si va a vedere se serve una scheda a parte. Tutto il ramo e' FAIL-SOFT:
    // qualunque intoppo ricade sul comportamento di oggi, e non lancia MAI, perche' un throw qui
    // significherebbe 'transient' e cursore Gmail fermo.
    if (ex && isFormCanale(ex.canale) && normEmail(cl.email) && normEmail(ex.customer_email) && normEmail(cl.email) !== normEmail(ex.customer_email)) {
      try {
        const { data: frat, error: eFrat } = await sb.from('cs_conversations')
          .select('id,canale,categoria,last_msg_at,customer_email').like('gmail_thread_id', chiaveFratelli(threadId));
        // se la lettura dei fratelli FALLISCE non si puo' decidere: senza quell'elenco decidiConv non
        // trova il gemello e creerebbe una scheda in piu' ogni volta. Ripiego = comportamento di oggi.
        if (eFrat) throw new Error('fratelli_non_leggibili');
        const d = decidiConv(ex, (frat ?? []) as Fratello[], { id: msg.id, threadId, email: cl.email, nuovaSubmission: msg.nuovaSubmission });
        if (d.modo === 'attach' && d.id !== ex.id) {
          const scelto = ((frat ?? []) as Fratello[]).find((f) => f.id === d.id);
          if (scelto) ex = scelto;
        } else if (d.modo === 'create') {
          const { data: ins2, error: e2 } = await sb.from('cs_conversations').insert({
            gmail_thread_id: d.key, canale: cl.canale, customer_email: cl.email, customer_name: cl.name,
            last_msg_at: meta.sentAt, last_direction: 'in', subject: meta.subject, snippet: meta.snippet, order_number: meta.order, lingua: meta.lingua,
          }).select('id').single();
          if (!e2 && ins2) { newConv++; return ins2.id as string; }
          // la chiave e' unica per costruzione: qui la maybeSingle e' legittima
          const { data: gia } = await sb.from('cs_conversations').select('id').eq('gmail_thread_id', d.key).maybeSingle();
          if (gia) return gia.id as string;   // stesso messaggio ripassato dal cursore: idempotente
        }
      } catch { /* fail-soft: si prosegue sulla conversazione di oggi */ }
    }
    if (ex) {
      const upd: Record<string, unknown> = {};
      // last_*/subject/snippet solo se il messaggio e' PIU' RECENTE: il re-processo (cursore che torna a
      // safeHid) puo' ripassare un messaggio vecchio dello stesso thread e non deve regredire la coda.
      if (!ex.last_msg_at || (!!meta.sentAt && meta.sentAt > (ex.last_msg_at as string))) {
        upd.last_msg_at = meta.sentAt; upd.last_direction = 'in'; upd.subject = meta.subject; upd.snippet = meta.snippet;
      }
      if (meta.order) upd.order_number = meta.order;
      // v13: su una conversazione da MODULO che ha gia' una sua cliente, l'email non si sovrascrive
      // piu' (prima l'ultimo messaggio vinceva e cambiava il destinatario dell'invio). Sugli altri
      // canali resta il comportamento di oggi: li' il thread e' della stessa persona per costruzione.
      if (cl.email && !(isFormCanale(ex.canale) && normEmail(ex.customer_email) && normEmail(ex.customer_email) !== normEmail(cl.email))) upd.customer_email = cl.email;
      if (cl.name) upd.customer_name = cl.name;
      // un cliente reale "promuove" un thread-rumore; ECCETTO i B2B (v11, owner 01-08: si
      // rispondono su Gmail, una nuova mail sullo stesso thread non li riporta in coda)
      if (cl.canale !== 'rumore' && ex.canale === 'rumore' && ex.categoria !== 'Collaborazioni e B2B') upd.canale = cl.canale;
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
      const convId = await ensureConv(threadId, p.cl, { sentAt: p.sentAt, subject: p.subject, snippet: p.snippet, order: p.order, lingua: p.lingua }, { id, nuovaSubmission: p.nuovaSubmission });
      const { error: me, count } = await sb.from('cs_messages').upsert({
        gmail_message_id: id, conversation_id: convId, direction: 'in',
        from_email: p.from.email || null, to_email: p.to.email || null, sent_at: p.sentAt, body_text: p.bodyText || null, form_fields: p.formFields,
        body_clean: stripQuoted(p.bodyText, p.cl.canale), reply_to: p.replyTo,
      }, { onConflict: 'gmail_message_id', ignoreDuplicates: true, count: 'exact' });
      if (me) return 'transient';
      if (count) {
        newMsg += count;
        await sb.from('cs_events').insert({ conversation_id: convId, azione: 'ingest', chi: 'cs-sync', dettaglio: { canale: p.cl.canale, message_id: id } });
        // v9: il cliente ha replicato a una conversazione chiusa DALL'AUTOMATISMO -> si riapre
        // (setStatoAuto la lascia intatta se e' stata chiusa a mano: la mano umana vince)
        await setStatoAuto(convId, 'da_fare', 'nuovo messaggio del cliente dopo la risposta');
        // v6: su un NUOVO messaggio cliente di una conversazione gia' classificata, la regola
        // sollecito va rivalutata subito (senza AI, senza toccare categoria)
        await recomputeUrgency(convId);
      }
      if (p.stampoIgnoto) { stampoIgnoto++; lingueIgnote.add(p.lingua); }
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
  await writeStampoIgnoto(stampoIgnoto, [...lingueIgnote]);

  return json({ ok: true, processed, new_conversations: newConv, new_messages: newMsg, out_messages: outMsg, counts, parse_failed: parseFailed, stampo_ignoto: stampoIgnoto, historyId: newHistoryId, backlog: !drained, stalled });
});
