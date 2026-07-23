// loyalty-proxy v1 — punti fedelta' con identita' Shopify via App Proxy (niente secondo login).
// Brief: _CLAUDE_CODE_INBOX/2026-07-22_CLAUDE_CODE_BRIEF_loyalty_app_proxy.md
//
// Sottosistema NON-core, ADDITIVO, gated. `verify_jwt=false` (pubblica ma PROTETTA da HMAC App Proxy):
// Shopify firma le richieste proxate con il CLIENT SECRET dell'app; la edge ricostruisce l'HMAC dei
// query param (ordinati, esclusa `signature`) e confronta timing-safe. Solo con firma valida legge
// `logged_in_customer_id` FIRMATO (mai dal body) e scrive col service_role. RLS nega ogni accesso
// diretto (anon/authenticated) alle tabelle loyalty_*: il canale di scrittura e' SOLO questa edge.
//
// Segreto: `app_flags.shopify_app_proxy_secret` (convenzione codebase: come qromo_webhook_secret /
//   gemini_api_key / cs_gmail_sa_key), con fallback env `SHOPIFY_APP_PROXY_SECRET`. L'owner/Cowork lo
//   inserisce DOPO aver configurato l'app Shopify (canale sicuro, mai in repo/chat). Finche' manca:
//   risposta `{state:'needs_secret'}` 200 => deployabile e testabile PRIMA della config Shopify.
//
// Azione dedotta dal path (App Proxy `/apps/premia/add` -> `/loyalty-proxy/add`) o da `?action=`:
//   - `balance` : {points} del cliente loggato (0 se assente).
//   - `add`     : POST {score} -> anti-abuso PRIMA di scrivere (clamp score, cap giornaliero, rate-limit),
//                 poi loyalty_points.points += clamp + insert loyalty_events. Mai sforare.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// anti-abuso (design brief)
const CAP_PER_GAME = 100;     // punti massimi da una singola partita
const DAILY_CAP = 200;        // punti massimi per cliente al giorno
const RATE_LIMIT_SEC = 30;    // 1 partita ogni 30s per cliente

// --- HMAC App Proxy: hex(HMAC-SHA256(secret, join_ordinato_dei_query_param_esclusa_signature)) ---
// I valori multipli per la stessa chiave si uniscono con ','; le coppie key=value si concatenano SENZA
// separatore. (Algoritmo App Proxy Shopify; distinto dall'HMAC base64 dei webhook.)
async function appProxyHmacHex(params: URLSearchParams, secret: string): Promise<string> {
  const grouped = new Map<string, string[]>();
  for (const [k, v] of params) {
    if (k === 'signature') continue;
    (grouped.get(k) ?? grouped.set(k, []).get(k)!).push(v);
  }
  const message = [...grouped.keys()].sort().map((k) => `${k}=${grouped.get(k)!.join(',')}`).join('');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// confronto a tempo costante su stringhe esadecimali (evita timing oracle sulla firma)
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = new URL(req.url);
  const params = url.searchParams;
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // --- segreto (app_flags -> env). Assente => needs_secret (deployabile prima della config Shopify) ---
  let secret = '';
  try {
    const { data } = await sb.from('app_flags').select('value').eq('key', 'shopify_app_proxy_secret').maybeSingle();
    secret = (data?.value ?? '').trim();
  } catch { /* ignora: fallback env sotto */ }
  if (!secret) secret = (Deno.env.get('SHOPIFY_APP_PROXY_SECRET') ?? '').trim();
  if (!secret) return json({ state: 'needs_secret' });

  // --- verifica firma App Proxy ---
  const signature = params.get('signature') ?? '';
  if (!signature) return json({ error: 'missing_signature' }, 401);
  const expected = await appProxyHmacHex(params, secret);
  if (!timingSafeEqualHex(signature.toLowerCase(), expected)) return json({ error: 'bad_signature' }, 401);

  // --- identita': SOLO da params firmati, mai dal body ---
  const customerId = (params.get('logged_in_customer_id') ?? '').trim();
  if (!customerId) return json({ state: 'login_required' });

  // --- azione: path (App Proxy) o ?action=, default per metodo ---
  const segs = url.pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  const pathAction = last && last !== 'loyalty-proxy' ? last : '';
  const action = (params.get('action') || pathAction || (req.method === 'POST' ? 'add' : 'balance')).toLowerCase();

  const readPoints = async (): Promise<number> => {
    const { data } = await sb.from('loyalty_points').select('points').eq('shopify_customer_id', customerId).maybeSingle();
    return data?.points ?? 0;
  };

  if (action === 'balance') {
    return json({ points: await readPoints() });
  }

  if (action === 'add') {
    const body = await req.json().catch(() => ({}));
    const rawScore = Number((body as { score?: unknown }).score);
    if (!Number.isFinite(rawScore)) return json({ error: 'invalid_score' }, 400);
    const requested = Math.max(0, Math.floor(rawScore));       // quanto chiesto (post-arrotondamento)
    const score = Math.min(CAP_PER_GAME, requested);            // clamp a punteggio-partita
    const points = await readPoints();

    // rate-limit: ultimo evento del cliente entro RATE_LIMIT_SEC => niente scrittura
    const { data: lastEv } = await sb.from('loyalty_events')
      .select('created_at').eq('shopify_customer_id', customerId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (lastEv?.created_at) {
      const ageSec = (Date.now() - new Date(lastEv.created_at as string).getTime()) / 1000;
      if (ageSec < RATE_LIMIT_SEC) return json({ capped: true, reason: 'rate', points });
    }

    // cap giornaliero: somma dei delta positivi di oggi
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { data: todayEv } = await sb.from('loyalty_events')
      .select('delta').eq('shopify_customer_id', customerId).gte('created_at', dayStart.toISOString());
    const todaySum = (todayEv ?? []).reduce((s, e) => s + Math.max(0, (e.delta as number) ?? 0), 0);
    const remaining = Math.max(0, DAILY_CAP - todaySum);
    const added = Math.min(score, remaining);
    if (added <= 0) return json({ capped: true, reason: remaining <= 0 ? 'daily' : 'zero', points });

    const newPoints = points + added;
    const { error: upErr } = await sb.from('loyalty_points')
      .upsert({ shopify_customer_id: customerId, points: newPoints, updated_at: new Date().toISOString() }, { onConflict: 'shopify_customer_id' });
    if (upErr) return json({ error: 'write_failed' }, 500);
    await sb.from('loyalty_events').insert({ shopify_customer_id: customerId, delta: added, source: 'game_click', meta: { score: requested } });

    // capped = abbiamo accreditato MENO di quanto chiesto (per clamp-partita o cap giornaliero)
    return json({ points: newPoints, added, capped: added < requested });
  }

  return json({ error: 'unknown_action', action }, 422);
});
