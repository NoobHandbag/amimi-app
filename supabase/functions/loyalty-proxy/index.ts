// loyalty-proxy v5 — punti fedelta' + stato di Mimi con identita' Shopify via App Proxy (niente secondo login).
// Brief v1: _CLAUDE_CODE_INBOX/done/2026-07-23_CLAUDE_CODE_BRIEF_loyalty_app_proxy.md
// Brief v5: _CLAUDE_CODE_INBOX/2026-07-24_CLAUDE_CODE_BRIEF_mimi_profilo_fase1.md (Mimi/Profilo, Fase 1+2)
//
// Sottosistema NON-core, ADDITIVO, gated. `verify_jwt=false` (pubblica ma PROTETTA da HMAC App Proxy):
// Shopify firma le richieste proxate con il CLIENT SECRET dell'app; la edge ricostruisce l'HMAC dei
// query param (ordinati, esclusa `signature`) e confronta timing-safe. Solo con firma valida legge
// `logged_in_customer_id` FIRMATO (mai dal body) e scrive col service_role. RLS nega ogni accesso
// diretto (anon/authenticated) alle tabelle loyalty_* e mimi_state: il canale di scrittura e' SOLO questa edge.
//
// Segreto: `app_flags.shopify_app_proxy_secret`, fallback env `SHOPIFY_APP_PROXY_SECRET`.
//   Assente => `{state:'needs_secret'}` 200.
//
// Azione dedotta dal path (App Proxy `/apps/premia/<azione>` -> `/loyalty-proxy/<azione>`) o da `?action=`:
//   - `balance`    : {points} del cliente loggato (0 se assente). INVARIATA (retro-compat pagina clicker).
//   - `add`        : clicker "Amimi Click". Dal v5 GATED dietro `app_flags.loyalty_click_enabled`
//                    (default 'false' => `{state:'off'}` senza scritture). Acceso: comportamento IDENTICO a prima.
//   - `state`      : UN giro per disegnare il profilo (punti, nanna, disponibilita' del giorno, worn, guardaroba).
//   - `coccola`    : +5, MAX 1 volta al giorno (Europe/Rome).
//   - `memory_win` : +5, MAX 1 volta al giorno (Europe/Rome). E' il gioco pubblico al posto del clicker.
//   - `nanna`      : POST {value:boolean} -> persiste lo stato "Mimi nel sacchettino".
//   - `wear`       : POST {codice} -> veste Mimi con un capo REALMENTE acquistato dal cliente, altrimenti 409.
//
// SCELTE DI PROGETTO (dichiarate come chiede il brief):
//  * GIORNO = Europe/Rome per le azioni nuove (clientela italiana). `add` resta su UTC per non
//    cambiare il comportamento del clicker gia' in produzione (criterio 6 = retro-compat).
//  * PREMI FISSI decisi qui dentro (mai importi dal client). Il client dichiara solo "ho vinto":
//    accettato dall'owner perche' il premio e' fisso, piccolo e 1/giorno.
//  * coccola/memory NON passano dal DAILY_CAP del clicker: hanno un cancello piu' stretto (1/giorno
//    ciascuna, +5). I loro delta restano pero' su loyalty_events, quindi CONSUMANO il cap giornaliero
//    del clicker se l'owner lo riaccende. Scelta conservativa: mai piu' punti del previsto.
//  * GUARDAROBA calcolato AL VOLO a ogni `state` (pochi ordini per cliente), nessuno snapshot da
//    invalidare. Fonte: Admin API `orders.json?customer_id=` per sapere QUALI ordini sono suoi
//    (l'App Proxy da' solo l'id numerico e `shopify_orders` NON ha il customer_id), poi le nostre
//    tabelle per codice/titolo/immagine. Serve solo `read_orders`, gia' in uso da shopify-sync:
//    NESSUNO scope nuovo, e l'app "Amimi Premia" resta a zero scope Admin API.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// anti-abuso clicker (design brief v1)
const CAP_PER_GAME = 100;     // punti massimi da una singola partita
const DAILY_CAP = 200;        // punti massimi per cliente al giorno
const RATE_LIMIT_SEC = 30;    // 1 partita ogni 30s per cliente

// premi fissi Mimi (design brief v5, decisioni owner 24-07)
const PREMIO_COCCOLA = 5;
const PREMIO_MEMORY = 5;

const SHOP = 'amimi-10000';

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

// Giorno civile italiano in formato YYYY-MM-DD. 'en-CA' rende gia' ISO; il timeZone fa il lavoro
// vero (l'ora legale la gestisce Intl, non noi). Confronto tra date = confronto tra stringhe ISO.
function romeToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
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

  type MimiState = { nanna: boolean; last_coccola: string | null; last_memory: string | null; worn: string | null };
  const readMimi = async (): Promise<MimiState> => {
    const { data } = await sb.from('mimi_state')
      .select('nanna, last_coccola, last_memory, worn').eq('shopify_customer_id', customerId).maybeSingle();
    return {
      nanna: Boolean(data?.nanna ?? false),
      last_coccola: (data?.last_coccola as string | null) ?? null,
      last_memory: (data?.last_memory as string | null) ?? null,
      worn: (data?.worn as string | null) ?? null,
    };
  };
  const saveMimi = async (patch: Record<string, unknown>): Promise<boolean> => {
    const { error } = await sb.from('mimi_state')
      .upsert({ shopify_customer_id: customerId, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'shopify_customer_id' });
    return !error;
  };

  // Accredito a premio FISSO (coccola/memory). Nessun importo dal client, nessun cap giornaliero
  // del clicker: il cancello e' il "1 volta al giorno" del chiamante, piu' stretto.
  const award = async (delta: number, source: string): Promise<number> => {
    const points = await readPoints();
    const newPoints = points + delta;
    const { error } = await sb.from('loyalty_points')
      .upsert({ shopify_customer_id: customerId, points: newPoints, updated_at: new Date().toISOString() },
        { onConflict: 'shopify_customer_id' });
    if (error) throw new Error('write_failed');
    await sb.from('loyalty_events').insert({ shopify_customer_id: customerId, delta, source, meta: { fisso: true } });
    return newPoints;
  };

  // --- GUARDAROBA: solo gli acquisti ONLINE del cliente loggato ---
  // 1) Admin API: quali ordini sono di QUESTO customer id (unica fonte che lega id -> ordini).
  // 2) Nostre tabelle: da quegli ordini -> codice/titolo/immagine gia' risolti.
  // Mai dati di altri clienti: si parte dall'id firmato e non si allarga mai il filtro.
  const wardrobe = async (): Promise<Array<Record<string, unknown>>> => {
    const { data: cfg } = await sb.from('app_config').select('shopify_token').eq('id', 1).single();
    const token = String(cfg?.shopify_token ?? '');
    if (!token) return [];

    const r = await fetch(
      `https://${SHOP}.myshopify.com/admin/api/2024-01/orders.json?status=any&customer_id=${encodeURIComponent(customerId)}&fields=id,name,created_at&limit=250`,
      { headers: { 'X-Shopify-Access-Token': token } },
    );
    if (!r.ok) return [];
    const orders = ((await r.json())?.orders ?? []) as Array<{ name?: string; created_at?: string }>;
    if (!orders.length) return [];

    // `shopify_line_items.order_id` tiene il NOME dell'ordine ('#1582'), non l'id numerico.
    const names = orders.map((o) => String(o.name ?? '')).filter(Boolean);
    const dataOrdine = new Map(orders.map((o) => [String(o.name ?? ''), String(o.created_at ?? '').slice(0, 10)]));
    if (!names.length) return [];

    const { data: items } = await sb.from('shopify_line_items')
      .select('order_id, lineitem_name, codice').in('order_id', names);
    if (!items?.length) return [];

    const codici = [...new Set(items.map((i) => String(i.codice ?? '')).filter(Boolean))];
    const imgs = new Map<string, { img: string | null; titolo: string | null }>();
    if (codici.length) {
      const { data: stock } = await sb.from('shopify_stock')
        .select('codice, image_url, shopify_title').in('codice', codici);
      for (const s of stock ?? []) {
        imgs.set(String(s.codice), { img: (s.image_url as string | null) ?? null, titolo: (s.shopify_title as string | null) ?? null });
      }
    }

    // un capo per codice (il piu' recente), niente doppioni nel guardaroba
    const perCodice = new Map<string, Record<string, unknown>>();
    for (const i of items) {
      const codice = String(i.codice ?? '');
      if (!codice) continue;                                   // riga non risolta: non finisce nel guardaroba
      const data = dataOrdine.get(String(i.order_id)) ?? null;
      const prev = perCodice.get(codice);
      if (prev && String(prev.data ?? '') >= String(data ?? '')) continue;
      perCodice.set(codice, {
        codice,
        titolo: imgs.get(codice)?.titolo ?? String(i.lineitem_name ?? ''),
        img: imgs.get(codice)?.img ?? null,
        data,
        canale: 'online',
      });
    }
    return [...perCodice.values()].sort((a, b) => String(b.data ?? '').localeCompare(String(a.data ?? '')));
  };

  if (action === 'balance') {
    return json({ points: await readPoints() });
  }

  if (action === 'state') {
    const oggi = romeToday();
    const [points, mimi, guardaroba] = await Promise.all([readPoints(), readMimi(), wardrobe()]);
    return json({
      points,
      nanna: mimi.nanna,
      coccola_disponibile: mimi.last_coccola !== oggi,
      memory_disponibile: mimi.last_memory !== oggi,
      worn: mimi.worn,
      wardrobe: guardaroba,
    });
  }

  if (action === 'coccola' || action === 'memory_win') {
    const oggi = romeToday();
    const mimi = await readMimi();
    const campo = action === 'coccola' ? 'last_coccola' : 'last_memory';
    const gia = action === 'coccola' ? mimi.last_coccola : mimi.last_memory;
    if (gia === oggi) return json({ done_today: true, points: await readPoints() });

    const delta = action === 'coccola' ? PREMIO_COCCOLA : PREMIO_MEMORY;
    const source = action === 'coccola' ? 'mimi_coccola' : 'game_memory';
    let points: number;
    try {
      points = await award(delta, source);
    } catch {
      return json({ error: 'write_failed' }, 500);
    }
    // La data si segna DOPO l'accredito: se qui fallisse, il peggio e' un secondo premio piu' tardi,
    // mai un premio perso senza punti.
    if (!await saveMimi({ [campo]: oggi })) return json({ error: 'write_failed' }, 500);
    return json({ points, added: delta });
  }

  if (action === 'nanna') {
    const body = await req.json().catch(() => ({}));
    const value = (body as { value?: unknown }).value;
    if (typeof value !== 'boolean') return json({ error: 'invalid_value' }, 400);
    if (!await saveMimi({ nanna: value })) return json({ error: 'write_failed' }, 500);
    return json({ nanna: value });
  }

  if (action === 'wear') {
    const body = await req.json().catch(() => ({}));
    const codice = String((body as { codice?: unknown }).codice ?? '').trim();
    if (!codice) return json({ error: 'invalid_codice' }, 400);
    const posseduti = new Set((await wardrobe()).map((w) => String(w.codice)));
    if (!posseduti.has(codice)) return json({ error: 'not_owned', codice }, 409);
    if (!await saveMimi({ worn: codice })) return json({ error: 'write_failed' }, 500);
    return json({ worn: codice });
  }

  if (action === 'add') {
    // Clicker in RISERVA: spento per il pubblico finche' l'owner non accende il flag (decisione 24-07).
    const { data: flag } = await sb.from('app_flags').select('value').eq('key', 'loyalty_click_enabled').maybeSingle();
    if (String(flag?.value ?? 'false').trim().toLowerCase() !== 'true') return json({ state: 'off' });

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

    // cap giornaliero: somma dei delta positivi di oggi (UTC: comportamento storico del clicker)
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
