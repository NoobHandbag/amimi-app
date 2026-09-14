// activity-digest — §6 redesign. Riassume in italiano le ultime attività dal change_log con Gemini.
// SOLA LETTURA (nessuna scrittura). PIN-gated come ask-data. Gemini key in app_flags.gemini_api_key (server-only).
// Cache lato client (la pagina Salute salva l'ultimo riassunto in localStorage con timestamp).
// v3 (2026-09-14, audit gate B65): letture controllate. Prima un 504 su change_log diventava "Nessuna
// attivita' recente" (dato falso ma plausibile nel feed) e un 504 su app_config diventava "PIN errato".
// Ora ogni lettura ritenta una volta e poi risponde 503 con errore esplicito (Regola Ferrea 20).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
// 2026-09-14 (audit gate): una lettura fallita si ritenta UNA volta dopo 1,5 s, poi si dichiara. Mai su scritture (qui non ce ne sono).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn();
  if (!r.error) return r;
  await sleep(1500);
  return await fn();
};
const readFailed = (tabella: string, msg: string) => json({ error: `lettura fallita, riprova: ${tabella}: ${msg}` }, 503);
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const PERSON = (c: string | null): string => {
  const k = (c ?? '').toLowerCase();
  if (['qromo-forward', 'shopify-sync', 'cron', 'claude', 'ce-guard'].includes(c ?? '')) return 'automatico';
  if (k.startsWith('bene') || k.startsWith('benny')) return 'Benny';
  if (k.startsWith('gin')) return 'Ginni';
  if (k.startsWith('ale') || k.startsWith('dan')) return 'Ale';
  return c ?? '—';
};

async function gemini(key: string, model: string, prompt: string) {
  // flash-lite: niente "thinking" che divora il budget di output (come ask-data). MAI thinkingConfig (400).
  const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 320 } }),
  });
  return { ok: g.ok, status: g.status, body: await g.json() };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg, error: cfgErr } = await retryOnce(() => sb.from('app_config').select('pin_hash').eq('id', 1).single());
  if (cfgErr) return readFailed('app_config', cfgErr.message);
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);

  // maybeSingle: chiave assente = needs_key (come prima); chiave NON LEGGIBILE = 503.
  const { data: flag, error: flagErr } = await retryOnce(() => sb.from('app_flags').select('value').eq('key', 'gemini_api_key').maybeSingle());
  if (flagErr) return readFailed('app_flags', flagErr.message);
  const key = flag?.value;
  if (!key) return json({ summary: null, needs_key: true }, 200);

  const { data: rows, error: rowsErr } = await retryOnce(() => sb.from('change_log').select('tbl,op,chi,ts,after').order('ts', { ascending: false }).limit(25));
  if (rowsErr) return readFailed('change_log', rowsErr.message);
  if (!rows?.length) return json({ summary: 'Nessuna attività recente da riassumere.', generated_at: new Date().toISOString(), count: 0 });

  const lines = rows.map((r: { tbl: string; op: string | null; chi: string | null; after: Record<string, unknown> | null }) => {
    const a = r.after ?? {};
    const bits = ['codice', 'quantita', 'costo', 'fornitore', 'categoria', 'contati', 'righe', 'qty', 'pushed', 'operazione']
      .map((k) => (a[k] != null ? `${k}=${String(a[k]).slice(0, 28)}` : null)).filter(Boolean).join(' ');
    return `- ${r.op ?? r.tbl} (${PERSON(r.chi)}) ${bits}`.trim();
  }).join('\n');

  const prompt = `Sei l'assistente operativo di Amimì, brand di borse artigianali. Guardando queste ultime attività registrate nel gestionale (chi ha fatto cosa, più recenti in alto), scrivi un riassunto in italiano di 2-3 frasi brevi e concrete: cosa si è mosso di recente (vendite, arrivi, spese, catalogo, sistema). Tono pratico, niente elenco puntato, niente termini da database (tabelle/colonne), niente codici grezzi. Se c'è poco, dillo con naturalezza.\n\nAttività:\n${lines}\n\nRiassunto:`;

  try {
    let g = await gemini(key, 'gemini-flash-lite-latest', prompt);
    if (!g.ok && (g.status === 503 || g.status === 429)) g = await gemini(key, 'gemini-flash-lite-latest', prompt); // retry su overload/quota transitori
    if (!g.ok) return json({ error: 'Gemini ' + g.status, detail: JSON.stringify(g.body).slice(0, 200) }, 502);
    const summary = (g.body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    return json({ summary, generated_at: new Date().toISOString(), count: rows.length });
  } catch (e) {
    return json({ error: 'Gemini non raggiungibile: ' + (e as Error).message }, 502);
  }
});
