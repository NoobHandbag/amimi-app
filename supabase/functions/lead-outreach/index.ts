// lead-outreach v1 (2026-09-22, missione M2 "Negozi B2B": bozze AI + invio dall'app).
// Modulo lead_* (Regola Ferrea 19): edge NUOVA, non un innesto in cs-assist/cs-send (vive, non si toccano).
// Riusa i loro SCHEMI, non il loro codice: Gemini in JSON mode come cs-assist (MAI thinkingConfig, tetto
// token alto: i token di ragionamento contano dentro maxOutputTokens), Gmail API da info@amimi.it col
// service account di cs-send (app_flags.cs_gmail_sa_key, domain-wide delegation con gmail.send).
// v7 (2026-10-03, migr 0149): listino e condizioni sono pubblici sulla line sheet (owner 03-10); la regola 4 del prompt
// non dice piu' "non ancora decise" ma "rimanda al link, non riscrivere il listino"; gli avvisi restano, col testo nuovo.
// v5 (2026-10-03): il From e' wholesale@amimi.it, alias "Invia messaggio come" della casella info@
// (Google Group che inoltra a info@). Se l'alias non risulta verificato si ripiega su info@ con un avviso.
//
// Azioni:
//   draft  (JWT @amimi.it) bozza della email di un tocco della sequenza per UN negozio -> lead_drafts 'proposta'.
//          I FATTI li recupera il CODICE (dossier, sequenza approvata, lead_knowledge, firma, link line sheet):
//          il modello scrive solo da quel blocco e mette [DA VERIFICARE: ...] dove manca qualcosa.
//   send   (JWT @amimi.it) invia il testo RIVISTO dalla persona (fa fede il box, non la bozza) e registra il
//          tocco in lead_touches. Revisione umana obbligatoria per costruzione: l'invio parte solo da un click
//          sulla bozza, e ogni segnaposto fra parentesi quadre rimasto nel testo lo BLOCCA.
//   sblocca (JWT @amimi.it) bozza rimasta in_invio da >10 min (esito incerto) -> errore, dopo controllo di Posta inviata.
//   diag   (JWT @amimi.it) stato dei flag e del service account, senza segreti ne' PII.
//   scarta (JWT @amimi.it) v6: una bozza non ancora partita passa a 'scartata' (il cron non la riscrive).
//   cron   (senza JWT, come gli altri cron; migr 0148) v6, Blocco 2. NO-OP finche' app_flags.lead_enabled non e' 'true'.
//          1) RISPOSTE: per ogni thread Gmail di un nostro tocco email, i messaggi non nostri e non ancora in
//             lead_touches entrano come tocco 'in' (upsert ignoreDuplicates su gmail_message_id). Una risposta vera
//             porta il negozio a "risposto" e ferma la sequenza; "no grazie" = opt-out; bounce e risposte automatiche
//             sono riconosciuti dal CODICE (blocco PURE:lead-inbound), mai dal modello.
//          2) FOLLOW-UP: negozio "contattato" con la prossima azione scaduta e nessuna risposta -> bozza AI del tocco
//             N+1 in lead_drafts ('proposta', origine 'auto'). L'INVIO RESTA UN CLICK UMANO: il cron non spedisce mai.
//          Se la lettura delle risposte fallisce, il giro NON propone follow-up (non sa chi ha risposto).
//          Tetti per giro (Regola 20c): MAX_THREAD thread letti, MAX_IN risposte scritte, MAX_BOZZE bozze.
//          Risponde solo con conteggi: nessun dato di terzi a chi chiama senza JWT.
//
// Idempotenza (Regola Ferrea 20): claim atomico sulla riga della bozza (UPDATE ... WHERE stato IN (...)), poi
// vincoli a DB della migr 0139: send_key UNIQUE e UN tocco per (negozio, numero di tocco) fra le bozze in
// invio o inviate. Il tocco in lead_touches entra con upsert ignoreDuplicates su gmail_message_id (UNIQUE).
// Ogni lettura che decide COSA si scrive destruttura `error` e si ferma; nessuna scrittura viene ritentata.
// Rollback: app_flags.lead_outreach_ai_enabled = false.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// una lettura idempotente puo' ritentare UNA volta (504 di PostgREST nei primi secondi del minuto); le scritture mai
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn();
  if (!r.error) return r;
  await sleep(1500);
  return await fn();
};

const GMAIL_USER = 'info@amimi.it';        // casella impersonata: Posta inviata e thread vivono qui
const FROM_ALIAS = 'wholesale@amimi.it';   // mittente mostrato al negozio (alias sendAs di GMAIL_USER)
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE_SEND = 'https://www.googleapis.com/auth/gmail.send';
const SCOPE_READ = 'https://www.googleapis.com/auth/gmail.readonly';   // solo per leggere Message-ID/References del tocco precedente
const MODEL = 'gemini-flash-latest';
const MAX_TOKENS = 8000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLAG_KEYS = ['lead_enabled', 'lead_outreach_ai_enabled', 'lead_linesheet_url', 'lead_firma', 'lead_tetto_giornaliero', 'gemini_api_key', 'cs_gmail_sa_key'];
// tetti del giro automatico (Regola 20c)
const MAX_THREAD = 150;        // thread Gmail letti per giro
const MAX_IN = 25;             // risposte scritte per giro
const MAX_BOZZE = 3;           // bozze di follow-up per giro (una chiamata Gemini ciascuna)
const MAX_CAND = 30;           // negozi esaminati per i follow-up
const FINESTRA_GG = 120;       // si guardano i thread dei tocchi inviati negli ultimi N giorni
const BUDGET_MS = 90_000;      // oltre, il giro si ferma e riprende al prossimo

// ==== PURE:lead-inbound BEGIN ====
// Lettura delle risposte, pura e testata in tests/lead_outreach_guardie.mjs. Classifica il CODICE, non il modello.
function indirizzoDi(from: string): string {
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(from) ?? /([^\s<>"']+@[^\s<>"']+)/.exec(from);
  return (m ? m[1] : '').trim().toLowerCase();
}
// toglie il testo citato (la nostra email sotto la risposta): senza, il nostro "mi risponda no grazie" citato
// farebbe scattare un opt-out a ogni risposta
function tagliaCitazione(t: string): string {
  const s = t.replace(/\r\n/g, '\n');
  const tagli = [
    /(^|\n)[ \t]*>/,
    /(^|\n)(Il giorno|Il|On)\b[^\n]{0,240}\n?[^\n]{0,120}(ha scritto|wrote)\s*:/i,
    /(^|\n)-{2,}\s*(Messaggio originale|Original Message|Messaggio inoltrato|Forwarded message)/i,
    /(^|\n)_{5,}/,
    /(^|\n)(Da|From):[^\n]*@[^\n]*\n(Inviato|Sent|Data|Date):/i,
  ];
  let cut = s.length;
  for (const re of tagli) { const m = re.exec(s); if (m && m.index < cut) cut = m.index; }
  return s.slice(0, cut).trim();
}
// 'bounce' | 'risposta_automatica' | 'opt_out' | null (= risposta vera, la gestisce una persona)
function classificaInbound(p: { from: string; subject: string; autoSubmitted: string; testo: string }): string | null {
  const from = indirizzoDi(p.from);
  const sub = p.subject.trim();
  if (/^(mailer-daemon|postmaster)@/.test(from) || /delivery status notification|undeliver|mail delivery (failed|subsystem)|delivery (has )?failed|mancat[oa] (recapito|consegna)|non recapitabil|returned mail|address not found|indirizzo non trovato/i.test(sub)) return 'bounce';
  const auto = p.autoSubmitted.trim().toLowerCase();
  if ((auto && auto !== 'no') || /^(risposta automatica|automatic reply|auto[- ]?reply|autoreply|out of (the )?office|fuori sede|fuori ufficio|assenza)/i.test(sub)) return 'risposta_automatica';
  const pulito = tagliaCitazione(p.testo);
  // opt-out solo se il rifiuto APRE un messaggio breve e senza indirizzi: "Perché no, grazie, passi giovedì" e
  // "non mi scriva qui ma a acquisti@..." restano a una persona. Sbagliare verso l'opt-out chiude un negozio interessato.
  if (pulito.length <= 160 && !pulito.includes('@') && /^[\s\W]*(buongiorno|buonasera|salve|gentile \w+|hello|hi|dear \w+)?[\s\W]*(no,?\s+(grazie|thanks|thank you)|unsubscribe|cancellatemi|rimuovetemi|(per favore|per cortesia|vi prego di|la prego di|please)?\s*(non|do not|don'?t)\s+(ci\s+|mi\s+)?(contatt|scriv|contact|email|write))/i.test(pulito)) return 'opt_out';
  return null;
}
// PostgREST rifiuta il NUL e un surrogato UTF-16 spaiato (CONOSCENZA 13-09): pulizia all'ULTIMO passo, dopo i tagli
function jsonSafe(s: string): string {
  return s.replace(/\u0000/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}
// oggi a Roma, YYYY-MM-DD (le scadenze sono date di chi lavora in Italia)
function oggiRoma(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
// il follow-up da proporre, o il motivo per cui NON si propone. `tocchi` = tutti i tocchi del negozio.
function prossimoFollowUp(tocchi: { direzione: string; canale: string; sequenza_tocco: number | null; esito: string | null; at: string; gmail_thread_id?: string | null }[]): { tocco: number; thread: string } | { salta: string } {
  const out = tocchi.filter((t) => t.direzione === 'out' && t.canale === 'email' && t.sequenza_tocco != null);
  if (!out.length) return { salta: 'nessun tocco email registrato' };
  const last = out.reduce((a, b) => (Number(b.sequenza_tocco) > Number(a.sequenza_tocco) ? b : a));
  const n = Number(last.sequenza_tocco);
  if (n >= 4) return { salta: 'sequenza finita' };
  // un tocco registrato a mano ("Segna come inviata") non ha thread: le sue risposte non si possono leggere
  if (!last.gmail_thread_id) return { salta: 'ultimo tocco inviato fuori dall’app: risposte non leggibili' };
  // un bounce immediato porta l'orario di Gmail, che puo' precedere di poco la registrazione del nostro tocco
  const tLast = Date.parse(last.at);
  const dopo = tocchi.filter((t) => t.direzione === 'in' && t.esito !== 'risposta_automatica' && Date.parse(t.at) > tLast - (t.esito === 'bounce' ? 600_000 : 0));
  if (dopo.length) return { salta: dopo.some((t) => t.esito === 'bounce') ? 'email non valida' : 'il negozio ha risposto' };
  return { tocco: n + 1, thread: last.gmail_thread_id };
}
// ==== PURE:lead-inbound END ====

// ==== PURE:lead-guard BEGIN ====
// Regole di invio, pure e testate in tests/lead_outreach_guardie.mjs. Un blocco qui = l'email NON parte.
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const OPT_OUT_IT = 'Se preferisce non ricevere altre email da parte mia, mi risponda "no grazie" e non la contatterò più.';
const OPT_OUT_EN = 'If you would rather not hear from me again, just reply "no thanks" and I will not contact you further.';
// ogni email chiude con la riga di opt-out, oppure (tocco 4) con la chiusura definitiva "non la contatterò ulteriormente"
const CHIUSURA_RE = /no grazie|no thanks|non la contatter[oò] ulteriormente|won'?t contact you again|will not contact you/i;
function segnapostoResidui(t: string): string[] {
  const out: string[] = [];
  for (const m of t.matchAll(/\[[^\]\n]{1,200}\]|\{\{[^}\n]{1,60}\}\}/g)) out.push(m[0]);
  return out;
}
function bloccantiInvio(p: { to: string; oggetto: string; testo: string }): string[] {
  const b: string[] = [];
  const to = p.to.trim().toLowerCase();
  if (!EMAIL_RE.test(to)) b.push('destinatario mancante o non valido');
  else if (to.endsWith('@amimi.it')) b.push('il destinatario e\' un indirizzo @amimi.it');
  if (!p.oggetto.trim()) b.push('oggetto vuoto');
  if (p.oggetto.length > 200) b.push('oggetto troppo lungo');
  if (p.testo.trim().length < 80) b.push('testo troppo corto');
  if (p.testo.length > 6000) b.push('testo troppo lungo');
  const seg = segnapostoResidui(`${p.oggetto}\n${p.testo}`);
  if (seg.length) b.push(`restano ${seg.length} parti da completare fra parentesi: ${seg.slice(0, 3).join(' ')}`);
  if (!CHIUSURA_RE.test(p.testo)) b.push('manca la riga di opt-out ("no grazie") o la chiusura definitiva del tocco 4');
  return b;
}
// garantisce firma e riga di opt-out anche se il modello le ha dimenticate (mai due volte)
function completaTesto(testo: string, firma: string, lingua: 'it' | 'en'): string {
  let t = testo.trim();
  const f = firma.trim();
  if (f && !t.includes(f.split('\n')[0].trim())) t += `\n\n${f}`;
  const opt = lingua === 'en' ? OPT_OUT_EN : OPT_OUT_IT;
  if (!CHIUSURA_RE.test(t)) t += `\n\n${opt}`;
  return t;
}
// cotone = produzione India: mai "Italia" ne' "India" associati al cotone (CONOSCENZA sez. 1)
function avvisiContenuto(testo: string): string[] {
  const a: string[] = [];
  const low = testo.toLowerCase();
  if (/\bindia\b/.test(low)) a.push('il testo nomina l\'India: non si dice mai');
  if (/cotone[^.\n]{0,80}(made in italy|in italia|italian)|(made in italy|in italia)[^.\n]{0,80}cotone/.test(low)) a.push('il testo associa il cotone all\'Italia: vale solo per la pelle');
  if (/\d+\s?%/.test(testo)) a.push('il testo contiene una percentuale: nelle email non si scrivono sconti ne\' supplementi, si rimanda alla line sheet');
  if (/ordine minimo|minimo d.ordine|conto vendita|consignment|minimum order/.test(low)) a.push('il testo cita minimi d\'ordine o conto vendita: controlla che coincida con la line sheet (primo ordine 12 pezzi e 400 euro netto; il conto vendita non c\'e\' piu\')');
  if (/alleg|attach/.test(low)) a.push('il testo parla di un allegato: l\'email parte senza allegati');
  return a;
}
// mezzanotte di oggi a Roma, in ISO UTC (il tetto e' "al giorno" per chi lavora in Italia, non per UTC)
function inizioGiornoRoma(now = new Date()): string {
  const base = new Date(now.getTime()); base.setUTCSeconds(0, 0);   // i secondi sfalserebbero l'offset di un minuto
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(base).map((x) => [x.type, x.value]));
  const romaComeUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const offsetMin = Math.round((romaComeUtc - base.getTime()) / 60000);
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day) - offsetMin * 60000).toISOString();
}
// ==== PURE:lead-guard END ====

type Flags = Record<string, string>;
type Row = Record<string, unknown>;

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
async function googleAccessToken(sa: { client_email: string; private_key: string }, scope: string, signal?: AbortSignal): Promise<string> {
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
    ...(signal ? { signal } : {}),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`google_token ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token as string;
}
// Gmail riscrive in silenzio il From se l'alias non e' fra i sendAs verificati della casella: lo si controlla
// prima, cosi' la UI dice il mittente vero. Qualunque dubbio (alias assente, non verificato, Gmail giu') = info@.
// Tetto di 5 secondi sulle due chiamate: gira PRIMA del claim e non deve tenere appeso l'invio.
async function mittente(sa: { client_email: string; private_key: string }): Promise<{ from: string; avviso: string }> {
  try {
    const signal = AbortSignal.timeout(5000);
    const rtoken = await googleAccessToken(sa, SCOPE_READ, signal);
    const r = await fetch(`${GMAIL}/settings/sendAs/${encodeURIComponent(FROM_ALIAS)}`, { headers: { Authorization: `Bearer ${rtoken}` }, signal });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.verificationStatus === 'accepted') return { from: FROM_ALIAS, avviso: '' };
    const perche = r.ok ? `non verificato in Gmail (${j?.verificationStatus ?? 'stato assente'})` : `non leggibile in Gmail (${r.status})`;
    return { from: GMAIL_USER, avviso: `alias ${FROM_ALIAS} ${perche}: inviata da ${GMAIL_USER}` };
  } catch (e) {
    return { from: GMAIL_USER, avviso: `alias ${FROM_ALIAS} non controllabile (${scrub((e as Error).message).slice(0, 100)}): inviata da ${GMAIL_USER}` };
  }
}
const b64 = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const wrap76 = (s: string): string => s.replace(/(.{76})/g, '$1\r\n');
const encHdr = (s: string): string => (/[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${b64(s)}?=` : s);

// nessun segreto in un messaggio d'errore (Gate 2 del 23-09, A1): la chiave sta nell'header, non nell'URL, perche' un
// errore di rete di Deno cita l'URL intero nel messaggio, e quel messaggio arriva alla UI
const scrub = (s: string) => s.replace(/key=[^&\s)]+/gi, 'key=***').replace(/AIza[0-9A-Za-z_-]{20,}/g, '***');
async function gemini(prompt: string, key: string): Promise<{ text: string; finish: string }> {
  // MAI thinkingConfig (400); tetto alto perche' il ragionamento consuma lo stesso budget (CONOSCENZA 01-08)
  const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: MAX_TOKENS, responseMimeType: 'application/json' } }),
  });
  const gj = await g.json();
  if (!g.ok) throw new Error(scrub('Gemini ' + g.status + ': ' + JSON.stringify(gj).slice(0, 200)));
  const cand = gj?.candidates?.[0];
  return { text: String(cand?.content?.parts?.[0]?.text ?? '').trim(), finish: String(cand?.finishReason ?? 'n/d') };
}

const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => v[k] ?? `[DA VERIFICARE: ${k}]`);

// blocco FATTI: tutto cio' che il modello puo' usare, raccolto dal codice. Niente qui = niente nell'email.
function fattiNegozio(d: Row): Record<string, unknown> {
  const bc = (d.brands_carried ?? {}) as { peer_match?: string[]; vendors?: string[] | null };
  const pb = (d.price_band ?? {}) as { borse?: { min: number; mediana: number; max: number } | null };
  const ig = (d.ig_metrics ?? {}) as { follower?: number | null; bio?: string | null };
  const mp = (d.maps ?? {}) as { categoria?: string | null; rating?: number | null };
  const sm = (d.site_meta ?? {}) as { meta?: string | null };
  return {
    nome: d.nome, tipo: d.tipo, citta: d.citta, paese: d.paese,
    gancio_dal_dossier: d.gancio ?? null,
    brand_affini_a_scaffale: bc.peer_match ?? [],
    brand_a_catalogo: (bc.vendors ?? []).slice(0, 15),
    borse_a_catalogo_eur: pb.borse ? { min: pb.borse.min, mediana: pb.borse.mediana, max: pb.borse.max } : null,
    instagram_follower: ig.follower ?? null,
    bio_instagram: ig.bio ? String(ig.bio).slice(0, 300) : null,
    descrizione_sito: sm.meta ? String(sm.meta).slice(0, 300) : null,
    categoria_google: mp.categoria ?? null,
    valutazione_interna: d.motivazione ? String(d.motivazione).slice(0, 500) : null,
    nota_owner: d.owner_note ?? null,
  };
}

function buildPrompt(p: { lingua: 'it' | 'en'; negozio: Record<string, unknown>; template: { oggetto: string; corpo: string }; knowledge: { titolo: string; contenuto: string }[]; linesheet: string; firma: string; referente: string; tocco: number }): string {
  const it = p.lingua === 'it';
  return [
    `Sei ${p.firma.split('\n')[0].split(' - ')[0] || 'Benedetta'} di Amimì Milano, brand di borse artigianali. Scrivi la email ${p.tocco === 1 ? 'di PRIMO contatto' : `di follow-up (tocco ${p.tocco} di 4)`} a un negozio multimarca, per proporgli di vendere le nostre borse.`,
    `Lingua: ${it ? 'italiano, registro "lei"' : 'English'}.`,
    '',
    'REGOLE (vincolanti):',
    '1. Usa SOLO i fatti nei blocchi NEGOZIO, AMIMI e LINK. Nessun numero, prezzo, condizione, nome o data che non sia scritto li\'.',
    '2. Una sola frase personale sul negozio, presa dal NEGOZIO (gancio, brand affini, stile). Se non c\'e\' niente di specifico, scrivi [DA VERIFICARE: gancio personale] al suo posto.',
    '3. Obiettivo della email: fargli guardare la line sheet e fissare un appuntamento (in negozio o in showroom a Milano). Chiudi con una domanda semplice.',
    '4. Listino wholesale e condizioni commerciali sono pubblicati nella line sheet (v7, migr 0149): nell\'email rimanda al link e NON riscrivere il listino, ANCHE SE il template lo fa. Puoi citare al massimo UN dato delle condizioni, solo se e\' scritto identico nel blocco AMIMI (per esempio il primo ordine da 12 pezzi). Mai sconti, percentuali, margini o credito al negozio. Il conto vendita non esiste piu\': non proporlo.',
    '4b. L\'email parte SENZA allegati: non scrivere "in allegato" o "le allego". Non dare per scontata una telefonata precedente ("come anticipato", "come da telefonata"), anche se il template lo dice.',
    '5. Il cotone NON e\' fatto in Italia: "Made in Italy" o "in Italia" solo per la pelle. Non nominare mai l\'India.',
    `6. Line sheet: ${p.linesheet ? `inserisci questo link esatto: ${p.linesheet}` : 'il link non esiste ancora: scrivi [DA VERIFICARE: link line sheet] dove andrebbe'}.`,
    `7. Referente: ${p.referente ? `rivolgiti a ${p.referente}` : 'nome non noto, usa un saluto generico al team del negozio'}.`,
    '8. Breve: massimo 130 parole nel corpo, niente elenchi puntati, niente punti esclamativi, niente em dash.',
    `9. Chiudi con questa firma, identica:\n${p.firma}`,
    `10. Ultima riga, identica: ${it ? OPT_OUT_IT : OPT_OUT_EN}`,
    '',
    'Il TEMPLATE qui sotto e\' il testo approvato dal team per questo tocco: prendilo come riferimento di tono e di contenuto, ma personalizzalo.',
    '',
    `NEGOZIO:\n${JSON.stringify(p.negozio, null, 1)}`,
    '',
    `AMIMI (template approvato):\nOggetto: ${p.template.oggetto}\n${p.template.corpo}`,
    ...(p.knowledge.length ? ['', 'AMIMI (note del team):', ...p.knowledge.map((k) => `- ${k.titolo}: ${k.contenuto}`)] : []),
    '',
    `LINK: ${p.linesheet || '(nessuno)'}`,
    '',
    'Rispondi SOLO con JSON: {"oggetto": "...", "testo": "...", "fatti_usati": ["..."]} dove fatti_usati elenca i fatti del blocco NEGOZIO che hai usato.',
  ].join('\n');
}

// bozza di UN tocco per UN negozio: usata dall'azione draft (persona) e dal giro cron (follow-up automatico)
// deno-lint-ignore no-explicit-any
async function creaBozza(sb: any, flags: Flags, p: { accountId: string; tocco: number; lingua?: string; referente?: string; chi: string; origine: 'manuale' | 'auto' }): Promise<{ status: number; body: Record<string, unknown> }> {
  const { accountId, tocco } = p;
  if (!flags.gemini_api_key) return { status: 500, body: { error: 'gemini_api_key assente' } };

  const { data: d, error: dErr } = await retryOnce(() => sb.from('v_lead_dossier').select('*').eq('id', accountId).maybeSingle());
  if (dErr) return { status: 503, body: { error: 'lettura dossier fallita, riprova: ' + dErr.message } };
  if (!d) return { status: 404, body: { error: 'negozio inesistente' } };
  if (d.verdetto === 'no' || d.stato_ricerca === 'rejected') return { status: 409, body: { error: 'negozio con verdetto "no" o scartato: niente bozza', bloccante: true } };
  const lingua: 'it' | 'en' = p.lingua === 'en' || (p.lingua !== 'it' && d.paese && d.paese !== 'IT') ? 'en' : 'it';
  const codice = lingua === 'en' ? 'boutique_en' : 'boutique_it';

  const { data: seq, error: sErr } = await retryOnce(() => sb.from('lead_sequences').select('oggetto,corpo,canale').eq('codice', codice).eq('tocco', tocco).eq('attiva', true).maybeSingle());
  if (sErr) return { status: 503, body: { error: 'lettura sequenza fallita, riprova: ' + sErr.message } };
  if (!seq || seq.canale !== 'email') return { status: 404, body: { error: `nessun template email attivo per ${codice} tocco ${tocco}` } };
  const { data: kn, error: kErr } = await retryOnce(() => sb.from('lead_knowledge').select('titolo,contenuto').eq('attiva', true).order('id').limit(40));
  if (kErr) return { status: 503, body: { error: 'lettura lead_knowledge fallita, riprova: ' + kErr.message } };

  const firma = flags.lead_firma || '[DA VERIFICARE: firma]';
  const referente = String(p.referente || '').trim().slice(0, 80);
  // v4: {{linesheet}} nei template = link della pagina riservata; senza flag resta un [DA VERIFICARE] che blocca l'invio
  const vars = { nome_negozio: String(d.nome), citta: String(d.citta ?? ''), referente: referente || (lingua === 'en' ? `${d.nome} team` : `team di ${d.nome}`), gancio: String(d.gancio ?? '[DA VERIFICARE: gancio]'), firma, linesheet: flags.lead_linesheet_url || '[DA VERIFICARE: link line sheet]' };
  const template = { oggetto: fill(String(seq.oggetto ?? ''), vars), corpo: fill(String(seq.corpo), vars) };
  const prompt = buildPrompt({ lingua, negozio: fattiNegozio(d), template, knowledge: (kn ?? []) as { titolo: string; contenuto: string }[], linesheet: flags.lead_linesheet_url || '', firma, referente, tocco });

  let parsed: { oggetto?: string; testo?: string; fatti_usati?: string[] } | null = null;
  let finish = '';
  try {
    const g = await gemini(prompt, flags.gemini_api_key);
    finish = g.finish;
    parsed = JSON.parse(g.text);
  } catch (e) {
    return { status: 502, body: { error: 'generazione non riuscita: ' + scrub((e as Error).message.slice(0, 200)) + (finish ? ` (${finish})` : '') } };
  }
  // la misura va fatta PRIMA di aggiungere firma e opt-out, che da sole superano qualunque soglia
  const grezzo = String(parsed?.testo ?? '').trim();
  if (grezzo.length < 80) return { status: 502, body: { error: `bozza vuota o troncata (${finish}): riprova` } };
  const testo = completaTesto(grezzo, flags.lead_firma || '', lingua);
  const oggetto = String(parsed?.oggetto ?? template.oggetto).trim().slice(0, 200);
  const to = String(d.email_generica ?? '') || (((d.site_meta ?? {}) as { emails?: string[] }).emails ?? [])[0] || '';

  const { data: ins, error: iErr } = await sb.from('lead_drafts').insert({
    account_id: accountId, lingua, testo, oggetto, to_email: to || null, sequenza_tocco: tocco, model: MODEL,
    fatti_usati: { fatti_usati: parsed?.fatti_usati ?? [], avvisi: avvisiContenuto(testo) }, stato: 'proposta', chi: p.chi, origine: p.origine,
  }).select('id').single();
  // 23505 = lead_drafts_auto_uq (migr 0148): la bozza automatica di questo tocco esiste gia'
  if (iErr) return { status: iErr.code === '23505' ? 409 : 500, body: { error: iErr.code === '23505' ? 'bozza automatica già presente per questo tocco' : 'salvataggio bozza fallito: ' + iErr.message, doppione: iErr.code === '23505' } };
  return { status: 200, body: { ok: true, draft_id: ins.id, oggetto, testo, to, lingua, tocco, segnaposto: segnapostoResidui(`${oggetto}\n${testo}`), avvisi: avvisiContenuto(testo) } };
}

// ------------------------------------------------------------------------------------------- cron
// testo leggibile di un messaggio Gmail: text/plain se c'e', altrimenti l'HTML senza tag
type GPart = { mimeType?: string; body?: { data?: string }; parts?: GPart[] };
function b64urlToText(data: string): string {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
function corpoMessaggio(payload: GPart | undefined): string {
  const trova = (p: GPart | undefined, mime: string): string => {
    if (!p) return '';
    if (p.mimeType === mime && p.body?.data) return b64urlToText(p.body.data);
    for (const c of p.parts ?? []) { const t = trova(c, mime); if (t) return t; }
    return '';
  };
  const plain = trova(payload, 'text/plain');
  if (plain) return plain;
  const html = trova(payload, 'text/html');
  return html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n');
}

// deno-lint-ignore no-explicit-any
async function leggiRisposte(sb: any, flags: Flags, t0: number): Promise<{ esito: Record<string, number | boolean | string>; sospesi: Set<string>; letti: Set<string> }> {
  const esito: Record<string, number | boolean | string> = { thread: 0, thread_troncati: false, nuove: 0, risposte: 0, opt_out: 0, bounce: 0, automatiche: 0, rimandate: 0, illeggibili: 0 };
  // negozi con una risposta arrivata ma NON ancora scritta (oltre il tetto, o messaggio illeggibile): niente follow-up per loro
  const sospesi = new Set<string>();
  // thread letti fino in fondo in questo giro: un follow-up si propone solo se il thread dell'ultimo tocco e' qui
  const letti = new Set<string>();
  const fine = () => ({ esito, sospesi, letti });
  const dal = new Date(Date.now() - FINESTRA_GG * 864e5).toISOString();
  const { data: outs, error: oErr } = await retryOnce(() => sb.from('lead_touches').select('account_id,gmail_thread_id,at')
    .eq('direzione', 'out').eq('canale', 'email').not('gmail_thread_id', 'is', null).gte('at', dal).order('at', { ascending: false }).limit(MAX_THREAD * 4 + 1));
  if (oErr) throw new Error('lettura tocchi inviati fallita: ' + oErr.message);
  const threadAcc = new Map<string, string>();
  for (const r of (outs ?? []) as { account_id: string; gmail_thread_id: string }[]) if (!threadAcc.has(r.gmail_thread_id)) threadAcc.set(r.gmail_thread_id, r.account_id);
  if (!threadAcc.size) return fine();
  // stadio dei negozi: prima i thread dei "contattato" (li' una risposta ferma la sequenza), poi gli altri per recenza.
  // Senza questa precedenza, oltre MAX_THREAD thread i piu' vecchi (quelli in scadenza) non verrebbero mai letti.
  const stage = new Map<string, string>();
  const tuttiAcc = [...new Set(threadAcc.values())];
  for (let i = 0; i < tuttiAcc.length; i += 100) {
    const ids = tuttiAcc.slice(i, i + 100);
    const { data: accs, error: aErr } = await retryOnce(() => sb.from('lead_accounts').select('id,lead_stage').in('id', ids));
    if (aErr) throw new Error('lettura stadio negozi fallita: ' + aErr.message);
    for (const a of (accs ?? []) as { id: string; lead_stage: string }[]) stage.set(a.id, a.lead_stage);
  }
  const inSequenza = (th: string) => Number(stage.get(threadAcc.get(th)!) === 'contattato');
  const threads = [...threadAcc.keys()].sort((a, b) => inSequenza(b) - inSequenza(a)).slice(0, MAX_THREAD);
  esito.thread_troncati = threadAcc.size > MAX_THREAD || (outs ?? []).length > MAX_THREAD * 4;

  if (!flags.cs_gmail_sa_key) throw new Error('chiave service account assente (app_flags.cs_gmail_sa_key)');
  const token = await googleAccessToken(JSON.parse(flags.cs_gmail_sa_key), SCOPE_READ);
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  // 1) quali messaggi non nostri ci sono in quei thread (format=metadata: id, etichette e mittente, niente corpo)
  const cand: { id: string; threadId: string; accountId: string; at: number }[] = [];
  for (const th of threads) {
    if (Date.now() - t0 > BUDGET_MS) { esito.thread_troncati = true; break; }
    const r = await fetch(`${GMAIL}/threads/${encodeURIComponent(th)}?format=metadata&metadataHeaders=From`, auth);
    if (r.status === 404) { letti.add(th); continue; }   // thread cancellato dalla casella: niente da leggere
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Gmail threads.get ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
    esito.thread = Number(esito.thread) + 1;
    for (const m of ((j as { messages?: { id: string; labelIds?: string[]; internalDate?: string; payload?: { headers?: { name?: string; value?: string }[] } }[] }).messages ?? [])) {
      const lbl = m.labelIds ?? [];
      if (lbl.includes('SENT') || lbl.includes('DRAFT')) continue;
      // un messaggio da @amimi.it (collega in copia, inoltro interno) non e' una risposta: scartato QUI, cosi' non
      // occupa a ogni giro un posto fra le risposte da scrivere
      const da = (m.payload?.headers ?? []).find((h) => h.name?.toLowerCase() === 'from')?.value ?? '';
      if (indirizzoDi(da).endsWith('@amimi.it')) continue;
      cand.push({ id: m.id, threadId: th, accountId: threadAcc.get(th)!, at: Number(m.internalDate ?? Date.now()) });
    }
    letti.add(th);
  }
  if (!cand.length) return fine();

  // 2) quali sono gia' in lead_touches: .in() sui soli id da controllare (Regola 20b), a blocchi
  const noti = new Set<string>();
  for (let i = 0; i < cand.length; i += 100) {
    const ids = cand.slice(i, i + 100).map((c) => c.id);
    const { data: ex, error: exErr } = await retryOnce(() => sb.from('lead_touches').select('gmail_message_id').in('gmail_message_id', ids));
    if (exErr) throw new Error('lettura tocchi esistenti fallita: ' + exErr.message);
    for (const r of (ex ?? []) as { gmail_message_id: string }[]) noti.add(r.gmail_message_id);
  }
  const nuovi = cand.filter((c) => !noti.has(c.id)).sort((a, b) => a.at - b.at);
  esito.rimandate = Math.max(0, nuovi.length - MAX_IN);
  for (const c of nuovi.slice(MAX_IN)) sospesi.add(c.accountId);
  const lotto = nuovi.slice(0, MAX_IN);
  if (!lotto.length) return fine();

  // 3) un tocco 'in' per messaggio, in ordine di arrivo. Lo stadio lo aggiorna il trigger lead_touches_apply:
  //    qui lo si segue in locale solo per non riportare indietro un negozio con un stage_dopo stantio.
  const oggi = oggiRoma();
  for (const c of lotto) {
    if (Date.now() - t0 > BUDGET_MS) { esito.rimandate = Number(esito.rimandate) + 1; sospesi.add(c.accountId); continue; }
    // un messaggio che non si legge o non si scrive NON ferma il giro (sarebbe uno stallo sullo stesso record a ogni
    // giro, CONOSCENZA 13-09): si conta, si segnala in health_log, si riprova al prossimo, e quel negozio resta sospeso
    const illeggibile = (perche: string) => { esito.illeggibili = Number(esito.illeggibili) + 1; sospesi.add(c.accountId); if (!esito.primo_errore) esito.primo_errore = perche.slice(0, 200); };
    const r = await fetch(`${GMAIL}/messages/${encodeURIComponent(c.id)}?format=full`, auth);
    const m = await r.json().catch(() => ({}));
    if (!r.ok) { illeggibile(`Gmail messages.get ${r.status}`); continue; }
    const hs = ((m as { payload?: { headers?: { name?: string; value?: string }[] } }).payload?.headers ?? []);
    const hdr = (n: string) => hs.find((h) => h.name?.toLowerCase() === n)?.value ?? '';
    const from = hdr('from');
    // un messaggio da @amimi.it nel thread (collega in copia, inoltro interno) non e' una risposta del negozio
    if (indirizzoDi(from).endsWith('@amimi.it')) continue;
    const testo = corpoMessaggio((m as { payload?: GPart }).payload);
    const tipo = classificaInbound({ from, subject: hdr('subject'), autoSubmitted: hdr('auto-submitted'), testo });
    const st = stage.get(c.accountId) ?? null;
    const pulito = tagliaCitazione(testo) || testo.trim();
    const base = {
      account_id: c.accountId, canale: 'email', direzione: 'in', gmail_message_id: c.id, gmail_thread_id: c.threadId,
      subject: jsonSafe(hdr('subject').slice(0, 300)) || null, body_clean: jsonSafe(`${indirizzoDi(from)}\n${pulito}`.slice(0, 4000)),
      stage_prima: st, chi: 'auto', at: new Date(c.at).toISOString(), esito: tipo,
    };
    const riga = tipo === 'risposta_automatica' ? { ...base, stage_dopo: st }   // non ferma la sequenza, non tocca la scadenza
      : tipo === 'bounce' ? { ...base, stage_dopo: st, prossima_azione: 'email non valida: cercare un altro indirizzo', prossima_azione_at: oggi }
      : tipo === 'opt_out' ? { ...base, prossima_azione: 'opt-out: non contattare più' }   // stadio e contatti: trigger
      : (st === 'da_contattare' || st === 'contattato' || st === 'risposto') ? { ...base, prossima_azione: 'rispondere al negozio', prossima_azione_at: oggi }
      : base;   // stadi avanzati: la prossima azione l'ha decisa una persona, non si sovrascrive
    const { data: ins, error: iErr } = await sb.from('lead_touches').upsert(riga, { onConflict: 'gmail_message_id', ignoreDuplicates: true }).select('id');
    if (iErr) { illeggibile('scrittura della risposta fallita: ' + iErr.message); continue; }
    if (!ins?.length) continue;   // gia' scritta da un giro concorrente
    esito.nuove = Number(esito.nuove) + 1;
    if (tipo === 'bounce') esito.bounce = Number(esito.bounce) + 1;
    else if (tipo === 'risposta_automatica') esito.automatiche = Number(esito.automatiche) + 1;
    else if (tipo === 'opt_out') { esito.opt_out = Number(esito.opt_out) + 1; stage.set(c.accountId, 'opt_out'); }
    else { esito.risposte = Number(esito.risposte) + 1; if (st === 'da_contattare' || st === 'contattato') stage.set(c.accountId, 'risposto'); }
  }
  return fine();
}

// deno-lint-ignore no-explicit-any
async function proponiFollowUp(sb: any, flags: Flags, t0: number, sospesi: Set<string>, letti: Set<string>): Promise<Record<string, number | string>> {
  const esito: Record<string, number | string> = { candidati: 0, proposte: 0, saltati: 0, errori: 0 };
  // v_lead_followup_due (migr 0148) esclude A MONTE chi non va riproposto (risposta o bounce, opt-out, bozza gia' scritta,
  // ultimo tocco a mano): cosi' i negozi saltati non occupano per sempre i primi MAX_CAND posti. I controlli qui sotto
  // restano come seconda cintura, sulla stessa regola (prossimoFollowUp).
  const { data: accs, error: aErr } = await retryOnce(() => sb.from('v_lead_followup_due').select('id,paese').order('prossima_azione_at', { ascending: true }).limit(MAX_CAND));
  if (aErr) throw new Error('lettura negozi in scadenza fallita: ' + aErr.message);
  esito.candidati = (accs ?? []).length;
  for (const a of (accs ?? []) as { id: string; paese: string | null }[]) {
    if (Number(esito.proposte) >= MAX_BOZZE || Date.now() - t0 > BUDGET_MS) break;
    if (sospesi.has(a.id)) { esito.saltati = Number(esito.saltati) + 1; continue; }
    const { data: tocchi, error: tErr } = await retryOnce(() => sb.from('lead_touches').select('direzione,canale,sequenza_tocco,esito,at,gmail_thread_id').eq('account_id', a.id).order('at', { ascending: false }).limit(200));
    if (tErr) throw new Error('lettura tocchi fallita: ' + tErr.message);
    const fu = prossimoFollowUp((tocchi ?? []) as { direzione: string; canale: string; sequenza_tocco: number | null; esito: string | null; at: string; gmail_thread_id: string | null }[]);
    if ('salta' in fu) { esito.saltati = Number(esito.saltati) + 1; continue; }
    // il thread dell'ultimo tocco non e' stato letto in questo giro: non si sa se hanno risposto, si riprova al prossimo
    if (!letti.has(fu.thread)) { esito.saltati = Number(esito.saltati) + 1; continue; }
    const { count: nOpt, error: oErr } = await retryOnce(() => sb.from('lead_contacts').select('id', { count: 'exact', head: true }).eq('account_id', a.id).eq('opt_out', true));
    if (oErr) throw new Error('lettura opt-out fallita: ' + oErr.message);
    if ((nOpt ?? 0) > 0) { esito.saltati = Number(esito.saltati) + 1; continue; }
    // bozze del negozio: una automatica per tocco (vincolo a DB), e niente doppione di una bozza gia' scritta da una persona
    const { data: bozze, error: bErr } = await retryOnce(() => sb.from('lead_drafts').select('stato,origine,lingua,sequenza_tocco,sent_at').eq('account_id', a.id).order('created_at', { ascending: false }).limit(100));
    if (bErr) throw new Error('lettura bozze fallita: ' + bErr.message);
    const bz = (bozze ?? []) as { stato: string; origine: string; lingua: string | null; sequenza_tocco: number | null; sent_at: string | null }[];
    if (bz.some((b) => b.sequenza_tocco === fu.tocco && (b.origine === 'auto' || ['proposta', 'approvata', 'in_invio', 'inviata'].includes(b.stato)))) { esito.saltati = Number(esito.saltati) + 1; continue; }
    // lingua: quella dell'ultima email partita dall'app, altrimenti dal paese
    const lingua = bz.find((b) => b.stato === 'inviata' && b.lingua)?.lingua ?? undefined;
    const r = await creaBozza(sb, flags, { accountId: a.id, tocco: fu.tocco, lingua, chi: 'auto', origine: 'auto' });
    if (r.status === 200) esito.proposte = Number(esito.proposte) + 1;
    else if (r.body.doppione) esito.saltati = Number(esito.saltati) + 1;
    else {
      esito.errori = Number(esito.errori) + 1;
      if (!esito.primo_errore) esito.primo_errore = String(r.body.error ?? '').slice(0, 200);
      if (r.status === 502 || r.status === 503) break;   // Gemini o DB in difficolta': si riprova al prossimo giro
    }
  }
  return esito;
}

// deno-lint-ignore no-explicit-any
async function giroCron(sb: any): Promise<Response> {
  const t0 = Date.now();
  const { data: frows, error: ferr } = await retryOnce(() => sb.from('app_flags').select('key,value').in('key', FLAG_KEYS));
  if (ferr) return json({ error: 'lettura flag fallita' }, 503);
  const flags: Flags = Object.fromEntries(((frows ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value ?? '']));
  // NO-OP a flag spento (Regola 19): niente Gmail, niente scritture, nemmeno in health_log
  if (flags.lead_enabled !== 'true') return json({ ok: true, skipped: 'lead_enabled spento' });
  // l'azione non chiede JWT: chiunque la chiami, parte al massimo un giro ogni 5 minuti
  const { data: ult, error: uErr } = await retryOnce(() => sb.from('health_log').select('created_at').eq('k', 'lead_cron').order('created_at', { ascending: false }).limit(1));
  if (uErr) return json({ error: 'lettura ultimo giro fallita' }, 503);
  const ultimo = (ult ?? [])[0]?.created_at as string | undefined;
  if (ultimo && Date.now() - Date.parse(ultimo) < 5 * 60000) return json({ ok: true, skipped: 'giro recente' });

  let inbound: Record<string, number | boolean | string> | null = null;
  let sospesi = new Set<string>();
  let letti = new Set<string>();
  let followup: Record<string, number | string> | null = null;
  const errori: string[] = [];
  try { const r = await leggiRisposte(sb, flags, t0); inbound = r.esito; sospesi = r.sospesi; letti = r.letti; }
  catch (e) { errori.push('risposte: ' + scrub((e as Error).message.slice(0, 200))); }
  // senza una lettura riuscita delle risposte non si sa chi ha risposto: nessun follow-up in questo giro. A lettura
  // riuscita il follow-up e' deciso negozio per negozio: thread letto in questo giro e nessuna risposta in sospeso.
  if (inbound && flags.lead_outreach_ai_enabled === 'true') {
    try { followup = await proponiFollowUp(sb, flags, t0, sospesi, letti); }
    catch (e) { errori.push('follow-up: ' + scrub((e as Error).message.slice(0, 200))); }
  }
  const fuErr = (followup?.primo_errore ? `; errore bozza: ${followup.primo_errore}` : '') + (inbound?.illeggibili ? `; ${inbound.illeggibili} risposte non lette: ${inbound.primo_errore ?? ''}` : '');
  const label = errori.length ? errori.join(' | ')
    : `risposte ${inbound?.nuove ?? 0} (vere ${inbound?.risposte ?? 0}, opt-out ${inbound?.opt_out ?? 0}, bounce ${inbound?.bounce ?? 0}, automatiche ${inbound?.automatiche ?? 0}), follow-up proposti ${followup?.proposte ?? 0}${followup?.saltati ? ` (${followup.saltati} rimandati)` : ''}${inbound?.thread_troncati || inbound?.rimandate ? '; giro troncato, il resto al prossimo' : ''}${fuErr}`;
  const sev = errori.length ? 'error' : (inbound?.thread_troncati || inbound?.rimandate || fuErr) ? 'warn' : 'ok';
  const { error: hErr } = await sb.from('health_log').upsert({ day: oggiRoma(), k: 'lead_cron', label: jsonSafe(label.slice(0, 500)), n: Number(inbound?.nuove ?? 0) + Number(followup?.proposte ?? 0), severity: sev, created_at: new Date().toISOString() }, { onConflict: 'day,k' });
  return json({ ok: !errori.length, inbound: inbound ? { ...inbound, primo_errore: undefined } : null, followup: followup ? { ...followup, primo_errore: undefined } : null, errori: errori.length, health: hErr ? 'non scritto' : sev, ms: Date.now() - t0 }, errori.length ? 500 : 200);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  if (!['draft', 'send', 'sblocca', 'diag', 'scarta', 'cron'].includes(action)) return json({ error: 'azione sconosciuta' }, 422);
  // giro automatico: nessun JWT (lo chiama pg_cron), nessun dato di terzi in risposta, NO-OP a lead_enabled spento
  if (action === 'cron') return await giroCron(createClient(url, svc));

  // 1) autorizzazione: utente reale @amimi.it (dati di terzi e invio a terzi)
  const authz = req.headers.get('Authorization') || '';
  const tk = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
  if (!tk) return json({ error: 'non autenticato' }, 401);
  const { data: ures, error: uerr } = await createClient(url, anon).auth.getUser(tk);
  if (uerr || !ures?.user) return json({ error: 'sessione non valida' }, 401);
  const userEmail = (ures.user.email || '').toLowerCase();
  if (!userEmail.endsWith('@amimi.it')) return json({ error: 'dominio non ammesso' }, 403);
  const chi = String(body.chi || userEmail).slice(0, 60);

  const sb = createClient(url, svc);
  const { data: frows, error: ferr } = await retryOnce(() => sb.from('app_flags').select('key,value').in('key', FLAG_KEYS));
  if (ferr) return json({ error: 'lettura flag fallita, riprova: ' + ferr.message }, 503);
  const flags: Flags = Object.fromEntries((frows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value ?? '']));
  const enabled = flags.lead_outreach_ai_enabled === 'true';

  if (action === 'diag') {
    let sa = 'assente', mitt = GMAIL_USER, mittAvviso = '';
    if (flags.cs_gmail_sa_key) {
      try {
        const k = JSON.parse(flags.cs_gmail_sa_key);
        await googleAccessToken(k, SCOPE_SEND); sa = 'ok (gmail.send)';
        const m = await mittente(k); mitt = m.from; mittAvviso = m.avviso;
      }
      catch (e) { sa = (e as Error).message.slice(0, 160); }
    }
    return json({ ok: true, enabled, cron: flags.lead_enabled === 'true', mittente: mitt, ...(mittAvviso ? { mittente_avviso: mittAvviso } : {}), gemini: !!flags.gemini_api_key, service_account: sa, linesheet: !!flags.lead_linesheet_url, firma: !!flags.lead_firma, tetto: Number.parseInt(flags.lead_tetto_giornaliero || '20', 10) });
  }
  if (!enabled) return json({ error: 'Bozze e invio B2B spenti (app_flags.lead_outreach_ai_enabled = false).', bloccante: true }, 403);

  // ------------------------------------------------------------------------------------------ draft
  if (action === 'draft') {
    const accountId = String(body.account_id || '');
    if (!UUID_RE.test(accountId)) return json({ error: 'account_id non valido' }, 422);
    const tocco = Math.max(1, Math.min(4, Number(body.tocco || 1)));
    const r = await creaBozza(sb, flags, { accountId, tocco, lingua: body.lingua, referente: body.referente, chi, origine: 'manuale' });
    return json(r.body, r.status);
  }

  // ----------------------------------------------------------------------------------------- scarta
  // v6: una bozza non partita esce dalla Coda. Mai su una bozza in invio o inviata.
  if (action === 'scarta') {
    const id = String(body.draft_id || '');
    if (!UUID_RE.test(id)) return json({ error: 'draft_id non valido' }, 422);
    const { data: sc, error: scErr } = await sb.from('lead_drafts')
      .update({ stato: 'scartata', errore: `scartata da ${chi}`, updated_at: new Date().toISOString() })
      .eq('id', id).in('stato', ['proposta', 'approvata', 'errore']).select('id');
    if (scErr) return json({ error: 'scarto fallito: ' + scErr.message }, 500);
    if (!sc?.length) return json({ error: 'niente da scartare: la bozza è già partita o già scartata', bloccante: true }, 409);
    return json({ ok: true, scartata: id });
  }

  // ---------------------------------------------------------------------------------------- sblocca
  // Una bozza resta 'in_invio' se la funzione muore fra il claim e l'esito di Gmail: stato INCERTO, che
  // blocca giustamente quel tocco. Una persona controlla "Posta inviata" di info@ e, se l'email NON c'e',
  // la sblocca qui (passa a 'errore' e si puo' reinviare). Solo dopo 10 minuti, mai su una bozza inviata.
  if (action === 'sblocca') {
    const id = String(body.draft_id || '');
    if (!UUID_RE.test(id)) return json({ error: 'draft_id non valido' }, 422);
    const limite = new Date(Date.now() - 10 * 60000).toISOString();
    const { data: sb1, error: sbErr } = await sb.from('lead_drafts')
      .update({ stato: 'errore', errore: `sbloccata da ${chi} (${userEmail}): email non trovata in Posta inviata`, updated_at: new Date().toISOString() })
      .eq('id', id).eq('stato', 'in_invio').lt('updated_at', limite).select('id');
    if (sbErr) return json({ error: 'sblocco fallito: ' + sbErr.message }, 500);
    if (!sb1?.length) return json({ error: 'niente da sbloccare: la bozza non e\' in invio da piu\' di 10 minuti', bloccante: true }, 409);
    return json({ ok: true, sbloccata: id });
  }

  // ------------------------------------------------------------------------------------------- send
  const draftId = String(body.draft_id || '');
  const sendKey = String(body.send_key || '');
  if (!UUID_RE.test(draftId) || !UUID_RE.test(sendKey)) return json({ error: 'draft_id o send_key non validi' }, 422);
  const to = String(body.to || '').trim().toLowerCase();
  const oggetto = String(body.oggetto || '').trim();
  const testo = String(body.testo || '').replace(/\r\n/g, '\n').trim();
  const blocchi = bloccantiInvio({ to, oggetto, testo });
  if (blocchi.length) return json({ error: 'Invio bloccato: ' + blocchi.join('; '), bloccante: true }, 422);

  const { data: dr, error: drErr } = await retryOnce(() => sb.from('lead_drafts').select('id,account_id,stato,send_key,sequenza_tocco,lingua,gmail_message_id').eq('id', draftId).maybeSingle());
  if (drErr) return json({ error: 'lettura bozza fallita, riprova: ' + drErr.message }, 503);
  if (!dr) return json({ error: 'bozza inesistente', bloccante: true }, 404);
  if (dr.stato === 'inviata' && dr.send_key === sendKey) return json({ ok: true, already_sent: true, to, gmail_message_id: dr.gmail_message_id });
  if (dr.stato === 'inviata' || dr.stato === 'in_invio') return json({ error: 'questa bozza e\' gia\' stata inviata (o e\' in invio)', bloccante: true }, 409);
  if (dr.stato === 'scartata') return json({ error: 'bozza scartata', bloccante: true }, 409);

  // negozio: opt-out e verdetto (una persona ha detto "no" = non si scrive)
  const { data: acc, error: aErr } = await retryOnce(() => sb.from('lead_accounts').select('id,nome,lead_stage,verdetto,stato_ricerca').eq('id', dr.account_id).maybeSingle());
  if (aErr) return json({ error: 'lettura negozio fallita, riprova: ' + aErr.message }, 503);
  if (!acc) return json({ error: 'negozio inesistente', bloccante: true }, 404);
  if (acc.lead_stage === 'opt_out' || acc.lead_stage === 'chiuso_no') return json({ error: `negozio in stadio ${acc.lead_stage}: non si contatta`, bloccante: true }, 409);
  if (acc.verdetto !== 'da_contattare') return json({ error: 'serve il verdetto "Da contattare" prima di scrivere', bloccante: true }, 409);
  if (acc.stato_ricerca === 'rejected') return json({ error: 'negozio scartato dopo la bozza: non si scrive', bloccante: true }, 409);
  const { count: nOpt, error: oErr } = await retryOnce(() => sb.from('lead_contacts').select('id', { count: 'exact', head: true }).eq('account_id', dr.account_id).eq('opt_out', true));
  if (oErr) return json({ error: 'lettura opt-out fallita, riprova: ' + oErr.message }, 503);
  if ((nOpt ?? 0) > 0) return json({ error: 'opt-out registrato su questo negozio: non si contatta', bloccante: true }, 409);
  // l'indirizzo e' testo libero: un opt-out vale per la PERSONA, anche se sta su un altro negozio (es. sede di un gruppo)
  const { count: nOptTo, error: otErr } = await retryOnce(() => sb.from('lead_contacts').select('id', { count: 'exact', head: true }).ilike('email', to.replace(/[\\%_]/g, '\\$&')).eq('opt_out', true));
  if (otErr) return json({ error: 'lettura opt-out fallita, riprova: ' + otErr.message }, 503);
  if ((nOptTo ?? 0) > 0) return json({ error: `${to} ha chiesto di non essere contattato`, bloccante: true }, 409);

  // lo stesso tocco registrato A MANO (Gmail + "Segna come inviata") conta come inviato
  const tocco = Number(dr.sequenza_tocco ?? 1);
  const { count: nTocco, error: ntErr } = await retryOnce(() => sb.from('lead_touches').select('id', { count: 'exact', head: true }).eq('account_id', dr.account_id).eq('direzione', 'out').eq('canale', 'email').eq('sequenza_tocco', tocco));
  if (ntErr) return json({ error: 'lettura tocchi fallita, riprova: ' + ntErr.message }, 503);
  if ((nTocco ?? 0) > 0) return json({ error: `il tocco ${tocco} risulta gia' inviato a questo negozio (vedi Timeline)`, bloccante: true }, 409);

  // tetto giornaliero (Regola 20c) sul giorno di ROMA: inviate oggi + quelle in invio. Conteggio head:true.
  // Non atomico con il claim: due invii contemporanei all'ultimo posto passano entrambi (tetto morbido, accettato).
  const tetto = Number.parseInt(flags.lead_tetto_giornaliero || '20', 10);
  if (!Number.isFinite(tetto) || tetto < 0) return json({ error: 'app_flags.lead_tetto_giornaliero non e\' un numero: invio fermo finche\' non viene corretto' }, 500);
  const { count: nOggi, error: cErr } = await retryOnce(() => sb.from('lead_drafts').select('id', { count: 'exact', head: true }).or(`stato.eq.in_invio,sent_at.gte.${inizioGiornoRoma()}`));
  if (cErr) return json({ error: 'conteggio invii fallito, riprova: ' + cErr.message }, 503);
  if ((nOggi ?? 0) >= tetto) return json({ error: `tetto di ${tetto} invii al giorno raggiunto`, bloccante: true }, 429);

  // follow-up: stesso thread Gmail del tocco precedente (threadId, che vale solo nella NOSTRA casella) piu' gli header
  // In-Reply-To/References letti dal messaggio precedente con lo scope readonly, come fa cs-send: senza quegli header il
  // destinatario riceve un "Re:" che apre una conversazione nuova. Senza thread niente "Re:" finto; con thread, un
  // oggetto che inizia per "Re:" riprende quello del primo invio (Gmail incrocia anche l'oggetto).
  const warnings: string[] = [];
  const { data: prevT, error: ptErr } = await retryOnce(() => sb.from('lead_touches').select('gmail_thread_id,gmail_message_id,subject').eq('account_id', dr.account_id).eq('direzione', 'out').eq('canale', 'email').not('gmail_thread_id', 'is', null).order('at', { ascending: false }).limit(1));
  if (ptErr) return json({ error: 'lettura thread fallita, riprova: ' + ptErr.message }, 503);
  const prev = tocco > 1 ? (prevT?.[0] ?? null) : null;
  const threadId: string | null = prev?.gmail_thread_id ?? null;
  const oggettoInvio = threadId
    ? (/^\s*(re|r)\s*:/i.test(oggetto) && prev?.subject ? 'Re: ' + String(prev.subject).replace(/^\s*(re|r)\s*:\s*/i, '') : oggetto)
    : oggetto.replace(/^\s*(re|r)\s*:\s*/i, '');

  if (!flags.cs_gmail_sa_key) return json({ error: 'chiave service account assente (app_flags.cs_gmail_sa_key)' }, 500);
  let sa: { client_email: string; private_key: string };
  try { sa = JSON.parse(flags.cs_gmail_sa_key); } catch { return json({ error: 'chiave service account non valida' }, 500); }
  let gtoken = '';
  try { gtoken = await googleAccessToken(sa, SCOPE_SEND); }
  catch (e) { return json({ error: 'autenticazione Google fallita: ' + (e as Error).message.slice(0, 180) }, 502); }
  const mitt = await mittente(sa);
  if (mitt.avviso) warnings.push(mitt.avviso);
  let inReplyTo = '', references = '';
  if (threadId && prev?.gmail_message_id) {
    try {
      const rtoken = await googleAccessToken(sa, SCOPE_READ);
      const mr = await fetch(`${GMAIL}/messages/${encodeURIComponent(String(prev.gmail_message_id))}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`, { headers: { Authorization: `Bearer ${rtoken}` } });
      const mj = await mr.json().catch(() => ({}));
      const hs = (mj?.payload?.headers ?? []) as { name?: string; value?: string }[];
      const hdr = (n: string) => hs.find((h) => h.name?.toLowerCase() === n)?.value ?? '';
      const mid = mr.ok ? hdr('message-id') : '';
      if (mid) { inReplyTo = mid; references = (hdr('references') ? hdr('references') + ' ' : '') + mid; }
      else warnings.push(`header di reply non impostati (Gmail ${mr.status}): il follow-up si vede come thread solo nella nostra casella`);
    } catch (e) {
      warnings.push('header di reply non impostati: ' + (e as Error).message.slice(0, 120));
    }
  }

  // claim atomico: solo UNA richiesta porta la bozza in 'in_invio'. L'indice unico (account, tocco) della
  // migr 0139 fa fallire qui il secondo invio dello stesso tocco allo stesso negozio.
  const { data: claimed, error: clErr } = await sb.from('lead_drafts')
    .update({ stato: 'in_invio', send_key: sendKey, to_email: to, oggetto: oggettoInvio, testo, sent_by: chi, errore: null, updated_at: new Date().toISOString() })
    .eq('id', draftId).in('stato', ['proposta', 'approvata', 'errore']).select('id');
  if (clErr) {
    const dup = /duplicate key|unique/i.test(clErr.message);
    return json({ error: dup ? `il tocco ${dr.sequenza_tocco} e' gia' stato inviato a questo negozio` : 'blocco della bozza fallito: ' + clErr.message, bloccante: dup }, dup ? 409 : 500);
  }
  if (!claimed?.length) return json({ error: 'la bozza e\' cambiata nel frattempo (gia\' in invio?): ricarica', bloccante: true }, 409);

  const mime = [
    `From: ${encHdr('Amimì Milano')} <${mitt.from}>`,
    `To: <${to}>`,
    `Subject: ${encHdr(oggettoInvio)}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(testo)),
  ].join('\r\n');
  let sr: Response;
  try {
    sr = await fetch(`${GMAIL}/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gtoken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: b64url(new TextEncoder().encode(mime)), ...(threadId ? { threadId } : {}) }),
    });
  } catch (e) {
    // esito INCERTO (la richiesta puo' essere arrivata a Gmail): la bozza resta 'in_invio' e blocca il tocco.
    // Si sblocca a mano dopo aver guardato "Posta inviata" (azione sblocca), mai con un reinvio automatico.
    return json({ error: 'Rete giu\' durante l\'invio: esito incerto. Controlla "Posta inviata" di info@amimi.it prima di riprovare. ' + (e as Error).message.slice(0, 120), bloccante: true, incerto: true }, 504);
  }
  const sj = await sr.json().catch(() => ({}));
  if (!sr.ok) {
    const msg = `Gmail ha rifiutato l'invio (${sr.status}): ${JSON.stringify(sj).slice(0, 250)}`;
    const { error: eErr } = await sb.from('lead_drafts').update({ stato: 'errore', errore: msg, updated_at: new Date().toISOString() }).eq('id', draftId);
    return json({ error: msg + (eErr ? ' (e la bozza e\' rimasta in invio: sbloccala)' : '') }, 502);
  }
  // da qui la mail E' PARTITA: gli errori successivi sono avvisi, mai un fallimento dell'invio
  const gmailMsgId = String((sj as { id?: string }).id ?? '') || null;
  const gmailThreadId = String((sj as { threadId?: string }).threadId ?? '') || null;
  if (!gmailMsgId) warnings.push('Gmail non ha restituito l\'id del messaggio: il tocco e\' registrato senza');
  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb.from('lead_drafts').update({ stato: 'inviata', sent_at: nowIso, gmail_message_id: gmailMsgId, gmail_thread_id: gmailThreadId, updated_at: nowIso }).eq('id', draftId);
  if (upErr) warnings.push('email partita, ma lo stato della bozza non e\' stato aggiornato: ' + upErr.message);

  const codice = dr.lingua === 'en' ? 'boutique_en' : 'boutique_it';
  const { data: next, error: nErr } = await sb.from('lead_sequences').select('tocco,giorni_attesa').eq('codice', codice).eq('tocco', tocco + 1).eq('attiva', true).maybeSingle();
  if (nErr) warnings.push('prossimo follow-up non calcolato: ' + nErr.message);
  const nextAt = next ? new Date(Date.now() + Number(next.giorni_attesa) * 864e5).toISOString().slice(0, 10) : null;
  const touch = {
    account_id: dr.account_id, canale: 'email', direzione: 'out', gmail_message_id: gmailMsgId, gmail_thread_id: gmailThreadId,
    subject: oggettoInvio, body_clean: testo, stage_prima: acc.lead_stage, sequenza_tocco: tocco, chi,
    prossima_azione: next ? `follow-up ${next.tocco} di 4` : 'chiusura: nessun altro tocco', prossima_azione_at: nextAt,
  };
  const { error: tErr } = gmailMsgId
    ? await sb.from('lead_touches').upsert(touch, { onConflict: 'gmail_message_id', ignoreDuplicates: true })
    : await sb.from('lead_touches').insert(touch);
  if (tErr) warnings.push('email partita, ma il tocco non e\' stato registrato: registralo a mano. ' + tErr.message);

  return json({ ok: true, to, from: mitt.from, oggetto: oggettoInvio, gmail_message_id: gmailMsgId, prossimo: nextAt, ...(warnings.length ? { warnings } : {}) });
});
