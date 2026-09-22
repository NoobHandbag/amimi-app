// lead-outreach v1 (2026-09-22, missione M2 "Negozi B2B": bozze AI + invio dall'app).
// Modulo lead_* (Regola Ferrea 19): edge NUOVA, non un innesto in cs-assist/cs-send (vive, non si toccano).
// Riusa i loro SCHEMI, non il loro codice: Gemini in JSON mode come cs-assist (MAI thinkingConfig, tetto
// token alto: i token di ragionamento contano dentro maxOutputTokens), Gmail API da info@amimi.it col
// service account di cs-send (app_flags.cs_gmail_sa_key, domain-wide delegation con gmail.send).
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

const GMAIL_USER = 'info@amimi.it';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE_SEND = 'https://www.googleapis.com/auth/gmail.send';
const MODEL = 'gemini-flash-latest';
const MAX_TOKENS = 8000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLAG_KEYS = ['lead_outreach_ai_enabled', 'lead_linesheet_url', 'lead_firma', 'lead_tetto_giornaliero', 'gemini_api_key', 'cs_gmail_sa_key'];

// ==== PURE:lead-guard BEGIN ====
// Regole di invio, pure e testate in tests/lead_outreach_guardie.mjs. Un blocco qui = l'email NON parte.
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const OPT_OUT_IT = 'Se preferisce non ricevere altre email da parte mia, mi risponda "no grazie" e non la contatterò più.';
const OPT_OUT_EN = 'If you would rather not hear from me again, just reply "no thanks" and I will not contact you further.';
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
  return b;
}
// garantisce firma e riga di opt-out anche se il modello le ha dimenticate (mai due volte)
function completaTesto(testo: string, firma: string, lingua: 'it' | 'en'): string {
  let t = testo.trim();
  const f = firma.trim();
  if (f && !t.includes(f.split('\n')[0].trim())) t += `\n\n${f}`;
  const opt = lingua === 'en' ? OPT_OUT_EN : OPT_OUT_IT;
  if (!/no grazie|no thanks/i.test(t)) t += `\n\n${opt}`;
  return t;
}
// cotone = produzione India: mai "Italia" ne' "India" associati al cotone (CONOSCENZA sez. 1)
function avvisiContenuto(testo: string): string[] {
  const a: string[] = [];
  const low = testo.toLowerCase();
  if (/\bindia\b/.test(low)) a.push('il testo nomina l\'India: non si dice mai');
  if (/cotone[^.\n]{0,80}(made in italy|in italia|italian)|(made in italy|in italia)[^.\n]{0,80}cotone/.test(low)) a.push('il testo associa il cotone all\'Italia: vale solo per la pelle');
  if (/\d+\s?%/.test(testo)) a.push('il testo contiene una percentuale: le condizioni commerciali non sono ancora decise');
  if (/ordine minimo|minimo d.ordine|conto vendita|consignment|minimum order/.test(low)) a.push('il testo cita minimi d\'ordine o conto vendita: condizioni non ancora decise');
  if (/alleg|attach/.test(low)) a.push('il testo parla di un allegato: l\'email parte senza allegati');
  return a;
}
// mezzanotte di oggi a Roma, in ISO UTC (il tetto e' "al giorno" per chi lavora in Italia, non per UTC)
function inizioGiornoRoma(now = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  const romaComeUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const offsetMin = Math.round((romaComeUtc - now.getTime()) / 60000);
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
async function googleAccessToken(sa: { client_email: string; private_key: string }, scope: string): Promise<string> {
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

async function gemini(prompt: string, key: string): Promise<{ text: string; finish: string }> {
  // MAI thinkingConfig (400); tetto alto perche' il ragionamento consuma lo stesso budget (CONOSCENZA 01-08)
  const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: MAX_TOKENS, responseMimeType: 'application/json' } }),
  });
  const gj = await g.json();
  if (!g.ok) throw new Error('Gemini ' + g.status + ': ' + JSON.stringify(gj).slice(0, 200));
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
    '4. Condizioni commerciali (sconti, percentuali, margini, minimi d\'ordine, conto vendita, prezzi all\'ingrosso): NON scriverle, non sono ancora decise, ANCHE SE il template le cita. Si possono citare solo i prezzi AL PUBBLICO se sono in AMIMI.',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  if (!['draft', 'send', 'sblocca', 'diag'].includes(action)) return json({ error: 'azione sconosciuta' }, 422);

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
    let sa = 'assente';
    if (flags.cs_gmail_sa_key) {
      try { await googleAccessToken(JSON.parse(flags.cs_gmail_sa_key), SCOPE_SEND); sa = 'ok (gmail.send)'; }
      catch (e) { sa = (e as Error).message.slice(0, 160); }
    }
    return json({ ok: true, enabled, gemini: !!flags.gemini_api_key, service_account: sa, linesheet: !!flags.lead_linesheet_url, firma: !!flags.lead_firma, tetto: Number(flags.lead_tetto_giornaliero || 20) });
  }
  if (!enabled) return json({ error: 'Bozze e invio B2B spenti (app_flags.lead_outreach_ai_enabled = false).', bloccante: true }, 403);

  // ------------------------------------------------------------------------------------------ draft
  if (action === 'draft') {
    const accountId = String(body.account_id || '');
    if (!UUID_RE.test(accountId)) return json({ error: 'account_id non valido' }, 422);
    const tocco = Math.max(1, Math.min(4, Number(body.tocco || 1)));
    if (!flags.gemini_api_key) return json({ error: 'gemini_api_key assente' }, 500);

    const { data: d, error: dErr } = await retryOnce(() => sb.from('v_lead_dossier').select('*').eq('id', accountId).maybeSingle());
    if (dErr) return json({ error: 'lettura dossier fallita, riprova: ' + dErr.message }, 503);
    if (!d) return json({ error: 'negozio inesistente' }, 404);
    if (d.verdetto === 'no' || d.stato_ricerca === 'rejected') return json({ error: 'negozio con verdetto "no" o scartato: niente bozza', bloccante: true }, 409);
    const lingua: 'it' | 'en' = body.lingua === 'en' || (body.lingua !== 'it' && d.paese && d.paese !== 'IT') ? 'en' : 'it';
    const codice = lingua === 'en' ? 'boutique_en' : 'boutique_it';

    const { data: seq, error: sErr } = await retryOnce(() => sb.from('lead_sequences').select('oggetto,corpo,canale').eq('codice', codice).eq('tocco', tocco).eq('attiva', true).maybeSingle());
    if (sErr) return json({ error: 'lettura sequenza fallita, riprova: ' + sErr.message }, 503);
    if (!seq || seq.canale !== 'email') return json({ error: `nessun template email attivo per ${codice} tocco ${tocco}` }, 404);
    const { data: kn, error: kErr } = await retryOnce(() => sb.from('lead_knowledge').select('titolo,contenuto').eq('attiva', true).order('id').limit(40));
    if (kErr) return json({ error: 'lettura lead_knowledge fallita, riprova: ' + kErr.message }, 503);

    const firma = flags.lead_firma || '[DA VERIFICARE: firma]';
    const referente = String(body.referente || '').trim().slice(0, 80);
    const vars = { nome_negozio: String(d.nome), citta: String(d.citta ?? ''), referente: referente || (lingua === 'en' ? `${d.nome} team` : `team di ${d.nome}`), gancio: String(d.gancio ?? '[DA VERIFICARE: gancio]'), firma };
    const template = { oggetto: fill(String(seq.oggetto ?? ''), vars), corpo: fill(String(seq.corpo), vars) };
    const prompt = buildPrompt({ lingua, negozio: fattiNegozio(d), template, knowledge: (kn ?? []) as { titolo: string; contenuto: string }[], linesheet: flags.lead_linesheet_url || '', firma, referente, tocco });

    let parsed: { oggetto?: string; testo?: string; fatti_usati?: string[] } | null = null;
    let finish = '';
    try {
      const g = await gemini(prompt, flags.gemini_api_key);
      finish = g.finish;
      parsed = JSON.parse(g.text);
    } catch (e) {
      return json({ error: 'generazione non riuscita: ' + (e as Error).message.slice(0, 200) + (finish ? ` (${finish})` : '') }, 502);
    }
    // la misura va fatta PRIMA di aggiungere firma e opt-out, che da sole superano qualunque soglia
    const grezzo = String(parsed?.testo ?? '').trim();
    if (grezzo.length < 80) return json({ error: `bozza vuota o troncata (${finish}): riprova` }, 502);
    const testo = completaTesto(grezzo, flags.lead_firma || '', lingua);
    const oggetto = String(parsed?.oggetto ?? template.oggetto).trim().slice(0, 200);
    const to = String(d.email_generica ?? '') || (((d.site_meta ?? {}) as { emails?: string[] }).emails ?? [])[0] || '';

    const { data: ins, error: iErr } = await sb.from('lead_drafts').insert({
      account_id: accountId, lingua, testo, oggetto, to_email: to || null, sequenza_tocco: tocco, model: MODEL,
      fatti_usati: { fatti_usati: parsed?.fatti_usati ?? [], avvisi: avvisiContenuto(testo) }, stato: 'proposta', chi,
    }).select('id').single();
    if (iErr) return json({ error: 'salvataggio bozza fallito: ' + iErr.message }, 500);
    return json({ ok: true, draft_id: ins.id, oggetto, testo, to, lingua, tocco, segnaposto: segnapostoResidui(`${oggetto}\n${testo}`), avvisi: avvisiContenuto(testo) });
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
  const tetto = Number(flags.lead_tetto_giornaliero || 20);
  const { count: nOggi, error: cErr } = await retryOnce(() => sb.from('lead_drafts').select('id', { count: 'exact', head: true }).or(`stato.eq.in_invio,sent_at.gte.${inizioGiornoRoma()}`));
  if (cErr) return json({ error: 'conteggio invii fallito, riprova: ' + cErr.message }, 503);
  if ((nOggi ?? 0) >= tetto) return json({ error: `tetto di ${tetto} invii al giorno raggiunto`, bloccante: true }, 429);

  // follow-up nello stesso thread Gmail del tocco precedente (nella nostra casella); senza thread niente "Re:" finto
  const { data: prevT, error: ptErr } = await retryOnce(() => sb.from('lead_touches').select('gmail_thread_id').eq('account_id', dr.account_id).eq('direzione', 'out').eq('canale', 'email').not('gmail_thread_id', 'is', null).order('at', { ascending: false }).limit(1));
  if (ptErr) return json({ error: 'lettura thread fallita, riprova: ' + ptErr.message }, 503);
  const threadId = tocco > 1 ? (prevT?.[0]?.gmail_thread_id ?? null) : null;
  const oggettoInvio = threadId ? oggetto : oggetto.replace(/^\s*(re|r)\s*:\s*/i, '');

  if (!flags.cs_gmail_sa_key) return json({ error: 'chiave service account assente (app_flags.cs_gmail_sa_key)' }, 500);
  let gtoken = '';
  try { gtoken = await googleAccessToken(JSON.parse(flags.cs_gmail_sa_key), SCOPE_SEND); }
  catch (e) { return json({ error: 'autenticazione Google fallita: ' + (e as Error).message.slice(0, 180) }, 502); }

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
    `From: ${encHdr('Amimì Milano')} <${GMAIL_USER}>`,
    `To: <${to}>`,
    `Subject: ${encHdr(oggettoInvio)}`,
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
  const warnings: string[] = [];
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

  return json({ ok: true, to, oggetto: oggettoInvio, gmail_message_id: gmailMsgId, prossimo: nextAt, ...(warnings.length ? { warnings } : {}) });
});
