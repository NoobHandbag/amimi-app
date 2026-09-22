// ai-compila v1 (2026-09-23): strato AI "Compila" del modulo materie prime (e degli ordini prodotti, target ordine_prodotti).
// Brief: Cowork12/docs/Codice_e_Automazione/BRIEF_materie_prime_fase2_ai_compila_2026-09-23.md
//
// Cosa fa: riceve immagini (path nel bucket privato mat-assets, caricate dal client sotto inbox/, oppure base64) e la
// nota dell'operatrice, chiede a Gemini (JSON mode) di PROPORRE i campi del modulo, valida la struttura e la restituisce.
// Cosa NON fa: non scrive MAI sulle tabelle del modulo ne' sul core. L'unica scrittura e' il proprio log (ai_compila_log,
// prefisso proprio). L'AI propone, l'umano conferma, mat-api (o write-api order_multi per gli ordini) scrive.
//
// Autorizzazione (postura cs-api): access_token di un utente Supabase Auth reale (getUser), email @amimi.it; poi service_role.
// Flag ai_compila_enabled (default OFF): a OFF risponde {state:'off'} senza chiamare nessuno.
// Gemini: chiave app_flags.gemini_api_key, modello app_flags.ai_compila_model (default MODELLO_DEFAULT), responseMimeType
// application/json, temperature 0, MAI thinkingConfig (gotcha CONOSCENZA -> 400). Timeout 25 s. Errore = 503 ai_failed:
// mai una proposta vuota spacciata per "niente trovato" (Regola 20a).
// Tetti: 4 immagini, 4 MB l'una, testo 2.000 caratteri.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildPrompt, validaOutput, normalizzaOutput, responseSchema, MODELLO_DEFAULT, MAX_OUTPUT_TOKENS } from './prompt.ts';
import type { Target, Contesto } from './prompt.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn(); if (!r.error) return r; await sleep(1500); return await fn();
};
const MAX_IMG = 4, MAX_BYTES = 4 * 1024 * 1024, MAX_TESTO = 2000, TIMEOUT_MS = 25000;
const IDENT: Record<string, string> = { B: 'Benedetta', G: 'Ginevra', A: 'Ale' };
const TARGETS = new Set<Target>(['materiale', 'fornitore', 'ordine_prodotti']);
const MIME_OK = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function b64(bytes: Uint8Array): string {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}
const cleanJson = (t: string) => (t || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1) autorizzazione: access_token utente reale (la anon key non e' un utente), email @amimi.it
  const authz = req.headers.get('Authorization') || '';
  const token = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
  if (!token) return json({ error: 'non autenticato' }, 401);
  const { data: ures, error: uerr } = await createClient(url, anon).auth.getUser(token);
  const user = ures?.user;
  if (uerr || !user) return json({ error: 'sessione non valida' }, 401);
  const email = (user.email || '').toLowerCase();
  if (!email.endsWith('@amimi.it')) return json({ error: 'dominio non ammesso' }, 403);

  const body = await req.json().catch(() => ({}));
  const sb = createClient(url, svc);
  const chi = IDENT[String(body.chi || '').toUpperCase()] || 'ignoto';

  // 2) flag e chiave: letture controllate (null = 503, mai "off" per un errore di rete)
  const { data: flags, error: fErr } = await retryOnce(() => sb.from('app_flags').select('key, value').in('key', ['ai_compila_enabled', 'gemini_api_key', 'ai_compila_model']));
  if (fErr) return json({ error: 'read_failed' }, 503);
  const fmap = new Map((flags ?? []).map((r) => [r.key, String(r.value ?? '')]));
  if (fmap.get('ai_compila_enabled')?.trim().toLowerCase() !== 'true') return json({ state: 'off' });
  const key = (fmap.get('gemini_api_key') ?? '').trim();
  if (!key) return json({ ok: false, needs_key: true, error: 'Gemini non configurato (app_flags.gemini_api_key).' });
  const modello = (fmap.get('ai_compila_model') ?? '').trim() || MODELLO_DEFAULT;

  // 3) input
  const target = String(body.target || '') as Target;
  if (!TARGETS.has(target)) return json({ error: 'target non valido' }, 422);
  const testo = String(body.testo || '').slice(0, MAX_TESTO);
  const ctx = (body.contesto && typeof body.contesto === 'object' ? body.contesto : {}) as Contesto;
  const paths: string[] = Array.isArray(body.immagini) ? body.immagini.map((p: unknown) => String(p)).filter(Boolean) : [];
  const inline: Array<{ mime: string; data: string }> = Array.isArray(body.immagini_base64) ? body.immagini_base64 : [];
  if (paths.length + inline.length > MAX_IMG) return json({ error: `al massimo ${MAX_IMG} immagini` }, 422);
  if (!paths.length && !inline.length && !testo.trim()) return json({ error: 'serve almeno un\'immagine o una nota' }, 422);

  // immagini dal bucket privato: solo sotto inbox/ (cio' che l'utente ha appena caricato) o fra gli asset registrati
  const parts: Array<Record<string, unknown>> = [];
  for (const p of paths) {
    if (!p.startsWith('inbox/')) {
      const { data: reg, error: rErr } = await retryOnce(() => sb.from('mat_assets').select('path').eq('path', p).maybeSingle());
      if (rErr) return json({ error: 'read_failed' }, 503);
      if (!reg) return json({ error: `immagine non ammessa: ${p}` }, 422);
    }
    const { data: blob, error: dErr } = await sb.storage.from('mat-assets').download(p);
    if (dErr || !blob) return json({ error: `immagine non leggibile: ${p}` }, 422);
    if (blob.size > MAX_BYTES) return json({ error: `immagine troppo grande (max 4 MB): ${p}` }, 422);
    const mime = blob.type || (p.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
    if (!MIME_OK.has(mime)) return json({ error: `formato non ammesso: ${mime}` }, 422);
    parts.push({ inline_data: { mime_type: mime, data: b64(new Uint8Array(await blob.arrayBuffer())) } });
  }
  for (const im of inline) {
    const mime = String(im?.mime || ''); const data = String(im?.data || '');
    if (!MIME_OK.has(mime) || !data) return json({ error: 'immagine base64 non valida' }, 422);
    if (data.length * 0.75 > MAX_BYTES) return json({ error: 'immagine troppo grande (max 4 MB)' }, 422);
    parts.push({ inline_data: { mime_type: mime, data } });
  }
  const prompt = buildPrompt(target, testo, ctx);
  parts.unshift({ text: prompt });

  // 4) log "proposto" PRIMA della chiamata (cosi' un timeout resta visibile come errore, mai un buco)
  const inputHash = await sha256hex(target + '|' + testo + '|' + paths.join(',') + '|' + inline.length);
  const { data: logRow, error: lErr } = await sb.from('ai_compila_log').insert({ chi, email, target, n_immagini: parts.length - 1, input_hash: inputHash, testo: testo || null, modello, esito: 'proposto' }).select('id').single();
  if (lErr) return json({ error: 'log_failed: ' + lErr.message }, 500);
  const logId = String(logRow.id);
  const t0 = Date.now();
  const chiudi = async (patch: Record<string, unknown>) => { await sb.from('ai_compila_log').update({ ms: Date.now() - t0, ...patch }).eq('id', logId); };

  // 5) Gemini structured output (responseSchema = JSON valido per costruzione; mai thinkingConfig), con timeout.
  //    Una chiamata all'AI e' una lettura idempotente: UN ritentativo se il JSON non si legge (Regola 20d).
  const chiama = async (): Promise<string> => {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: 'application/json', responseSchema: responseSchema(target) } }),
      });
      const gj = await g.json();
      if (!g.ok) throw new Error('Gemini ' + g.status + ': ' + JSON.stringify(gj).slice(0, 300));
      const cand = gj?.candidates?.[0];
      if (cand?.finishReason && cand.finishReason !== 'STOP') throw new Error('Gemini finishReason ' + cand.finishReason);
      // il testo puo' arrivare spezzato su piu' parts (successo sul golden set del 23-09: parts[0] da solo era troncato)
      return ((cand?.content?.parts ?? []) as Array<{ text?: string }>).map((p) => p.text ?? '').join('');
    } finally { clearTimeout(timer); }
  };
  let raw = '';
  let proposta: unknown = null;
  try {
    raw = await chiama();
    try { proposta = JSON.parse(cleanJson(raw)); } catch { raw = await chiama(); try { proposta = JSON.parse(cleanJson(raw)); } catch { proposta = null; } }
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'timeout Gemini' : e.message) : String(e);
    await chiudi({ esito: 'errore', errore: msg.slice(0, 500) });
    return json({ error: 'ai_failed', detail: msg.slice(0, 200), log_id: logId }, 503);
  }
  if (proposta) proposta = normalizzaOutput(target, proposta);
  const problema = proposta ? validaOutput(target, proposta) : 'JSON non leggibile';
  if (problema) {
    await chiudi({ esito: 'errore', errore: problema, output: proposta ?? { raw: raw.slice(0, 2000) } });
    return json({ error: 'ai_invalid', detail: problema, log_id: logId }, 503);
  }
  await chiudi({ output: proposta });
  return json({ ok: true, log_id: logId, modello, proposta });
});
