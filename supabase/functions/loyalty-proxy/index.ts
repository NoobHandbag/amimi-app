// loyalty-proxy v11 — punti fedelta' + stato di Mimi con identita' Shopify via App Proxy (niente secondo login).
// v11 (2026-09-21, quest audit Area Membri, Fase 6 bundle C):
//    T1  freschezza della firma: il `timestamp` firmato da Shopify deve stare entro MAX_SKEW_SEC, altrimenti 401
//        stale_signature (una richiesta firmata catturata non e' piu' rigiocabile all'infinito);
//    L3  coccola/memory_win via RPC loyalty_award_daily (migr 0136): cancello "1 al giorno" e accredito nella STESSA
//        transazione (due tap concorrenti = un solo premio); la RPC e' idempotente per giorno, quindi ha il retryOnce;
//    T9  `rewards` legge catalogo e storico con errori controllati: 503, mai un catalogo vuoto spacciato per vero;
//    flag letti con retryOnce e 503 su errore (prima: errore di lettura = "off" silenzioso);
//    S1  guardaroba dal DB (loyalty_order_credits.order_name -> shopify_line_items -> shopify_stock) invece di una
//        REST per ogni caricamento pagina; ripiego Admin API GraphQL pinnata API_VERSION SOLO per un membro senza
//        accrediti (T20: la 2024-01 era ritirata); T33 chiave capo = codice_norm (oggi identica a codice);
//    `wardrobe: null` (non leggibile) distinto da `[]` (nessun capo) + `wardrobe_source` per l'osservabilita';
//    visite in loyalty_visits (RPC loyalty_visit, migr 0137), mai bloccante.
// v10 (2026-09-20): rotta /club (pagina Area Membri via loyalty-page), rewards/redeem (Premia Fase 3, migr 0135).
// v6 (2026-09-13, sweep incidente doppioni): letture con retryOnce e fail-closed 503 prima di ogni scrittura;
//    insert audit su loyalty_events segnalato (warning + change_log) invece di ignorato. Happy path invariato.
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
//   - `club`       : GET, pagina HTML dell'Area Membri (edge loyalty-page), servita PRIMA della firma (e' pubblica).
//   - `balance`    : {points} del cliente loggato (0 se assente). INVARIATA (retro-compat pagina clicker).
//   - `add`        : clicker "Amimi Click". Dal v5 GATED dietro `app_flags.loyalty_click_enabled`
//                    (default 'false' => `{state:'off'}` senza scritture). Acceso: comportamento IDENTICO a prima.
//   - `state`      : UN giro per disegnare il profilo (punti, nanna, disponibilita' del giorno, worn, guardaroba).
//   - `coccola`    : +5, MAX 1 volta al giorno (Europe/Rome).
//   - `memory_win` : +5, MAX 1 volta al giorno (Europe/Rome). E' il gioco pubblico al posto del clicker.
//   - `nanna`      : POST {value:boolean} -> persiste lo stato "Mimi nel sacchettino".
//   - `wear`       : POST {codice} -> veste Mimi con un capo REALMENTE acquistato dal cliente, altrimenti 409.
//   - `rewards`    : catalogo premi attivi + ultimi riscatti del cliente (gated da loyalty_redeem_enabled).
//   - `redeem`     : POST {reward, idemp} -> detrae i punti (RPC atomica) e consegna un codice dal pool.
//
// SCELTE DI PROGETTO (dichiarate come chiede il brief):
//  * GIORNO = Europe/Rome per le azioni nuove (clientela italiana). `add` resta su UTC per non
//    cambiare il comportamento del clicker gia' in produzione (criterio 6 = retro-compat).
//  * PREMI FISSI decisi qui dentro (mai importi dal client). Il client dichiara solo "ho vinto":
//    accettato dall'owner perche' il premio e' fisso, piccolo e 1/giorno.
//  * coccola/memory NON passano dal DAILY_CAP del clicker: hanno un cancello piu' stretto (1/giorno
//    ciascuna, +5). I loro delta restano pero' su loyalty_events, quindi CONSUMANO il cap giornaliero
//    del clicker se l'owner lo riaccende. Scelta conservativa: mai piu' punti del previsto.
//  * GUARDAROBA (v11) dal DB: gli ordini del cliente sono quelli accreditati da loyalty-orders
//    (loyalty_order_credits.order_name, dopo il retroattivo = TUTTI gli ordini pagati), poi le nostre tabelle per
//    codice/titolo/immagine. Zero chiamate Admin API per caricamento pagina; il bucket REST resta alle edge core.
//    Ripiego (membro senza accrediti, es. primo ordine non ancora passato dal giro): Admin API GraphQL
//    `orders(query:"customer_id:<id>")`. Mai dati di altri clienti: si parte dall'id firmato e non si allarga il filtro.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// 2026-09-13 (sweep incidente doppioni): PostgREST risponde 504 su ~4% delle letture delle edge. Una lettura o
// una riga di telemetria sono idempotenti: UN solo ritentativo dopo 1,5 s, poi ci si ferma (Regola Ferrea 20).
// Mai sugli upsert/insert di punti ed eventi (le RPC idempotenti per costruzione, come loyalty_award_daily, si').
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn();
  if (!r.error) return r;
  await sleep(1500);
  return await fn();
};

// anti-abuso clicker (design brief v1)
const CAP_PER_GAME = 100;     // punti massimi da una singola partita
const DAILY_CAP = 200;        // punti massimi per cliente al giorno
const RATE_LIMIT_SEC = 30;    // 1 partita ogni 30s per cliente

// premi fissi Mimi (design brief v5, decisioni owner 24-07)
const PREMIO_COCCOLA = 5;
const PREMIO_MEMORY = 5;

const SHOP = 'amimi-10000';
const API_VERSION = '2026-07';   // Admin API (solo ripiego guardaroba): stabile fino al 2027-07, ripinnare ogni trimestre (LOYALTY_RUNBOOK §10)
const MAX_SKEW_SEC = 300;        // T1: eta' massima di una firma App Proxy (Shopify firma anche `timestamp`)

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

  // Area Membri (Premia): pagina HTML servita dalla edge separata loyalty-page, same-origin su
  // amimi.it/apps/premia/club cosi' le fetch a /apps/premia/* portano il login. Rotta ISOLATA in
  // early-return: NON tocca secret / firma / identita' / azioni sottostanti. Aggiunta 2026-09-20 (B1).
  {
    const _p = new URL(req.url).pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && (_p[_p.length - 1] ?? '') === 'club') {
      try {
        const _r = await fetch('https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/loyalty-page');
        const _ct = _r.headers.get('content-type') || 'application/liquid; charset=utf-8';
        return new Response(await _r.text(), { status: 200, headers: { ...cors, 'Content-Type': _ct } });
      } catch (_e) {
        return new Response('Area Membri non disponibile, riprova.', { status: 503, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    }
  }

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

  // --- v11 (T1): freschezza della firma. `timestamp` (secondi Unix) e' fra i param firmati: manometterlo rompe la
  //     firma, quindi qui e' affidabile. Una richiesta firmata catturata vale al massimo MAX_SKEW_SEC.
  const ts = Number(params.get('timestamp'));
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_SEC) return json({ error: 'stale_signature' }, 401);

  // --- identita': SOLO da params firmati, mai dal body ---
  const customerId = (params.get('logged_in_customer_id') ?? '').trim();
  if (!customerId) return json({ state: 'login_required' });

  // --- azione: path (App Proxy) o ?action=, default per metodo ---
  const segs = url.pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  const pathAction = last && last !== 'loyalty-proxy' ? last : '';
  const action = (params.get('action') || pathAction || (req.method === 'POST' ? 'add' : 'balance')).toLowerCase();

  // 2026-09-13 (sweep incidente doppioni): lettura fallita = saldo 0 e l'upsert 0+delta azzerava il cliente. Ora null = fermarsi.
  const readPoints = async (): Promise<number | null> => {
    const { data, error } = await retryOnce(() => sb.from('loyalty_points').select('points').eq('shopify_customer_id', customerId).maybeSingle());
    if (error) return null;
    return data?.points ?? 0;
  };

  type MimiState = { nanna: boolean; last_coccola: string | null; last_memory: string | null; worn: string | null };
  // 2026-09-13 (sweep incidente doppioni): lettura fallita = guardia "1 volta al giorno" a vuoto. Ora null = fermarsi.
  const readMimi = async (): Promise<MimiState | null> => {
    const { data, error } = await retryOnce(() => sb.from('mimi_state')
      .select('nanna, last_coccola, last_memory, worn').eq('shopify_customer_id', customerId).maybeSingle());
    if (error) return null;
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

  // v11: flag letti con retryOnce; null = non leggibile (il chiamante risponde 503), mai "off" per un errore di rete.
  const readFlag = async (key: string): Promise<boolean | null> => {
    const { data, error } = await retryOnce(() => sb.from('app_flags').select('value').eq('key', key).maybeSingle());
    if (error) return null;
    return String(data?.value ?? 'false').trim().toLowerCase() === 'true';
  };

  // 2026-09-13 (sweep incidente doppioni): insert audit su loyalty_events ignorato = rate-limit e cap giornaliero
  // sottostimati nelle chiamate successive, con punti gia' accreditati. Niente retry sull'insert (non idempotente):
  // si segnala in risposta (warning) e su change_log, cosi' il buco resta visibile.
  let eventInsertFailed = false;
  const noteEventFailed = async (delta: number, source: string, msg: string): Promise<void> => {
    eventInsertFailed = true;
    console.error('loyalty-proxy: insert loyalty_events fallito', { customerId, delta, source, msg });
    try {
      await retryOnce(() => sb.from('change_log').insert({
        tbl: 'loyalty_events', row_id: customerId, op: 'event_insert_failed',
        after: { delta, source, error: msg }, chi: 'loyalty-proxy', source: 'loyalty-proxy',
      }));
    } catch { /* telemetria: non deve mai bloccare un accredito gia' fatto */ }
  };

  // --- GUARDAROBA (v11): solo gli acquisti del cliente loggato, dal DB ---
  // items: null = non leggibile (503 dove serve decidere, "non disponibile" in pagina); [] = nessun capo.
  type Ward = { items: Array<Record<string, unknown>> | null; source: 'db' | 'api' | 'none' | 'error' };
  const wardrobe = async (): Promise<Ward> => {
    const { data: creds, error: cErr } = await retryOnce(() => sb.from('loyalty_order_credits').select('order_name').eq('shopify_customer_id', customerId).not('order_name', 'is', null));
    if (cErr) return { items: null, source: 'error' };
    let names = [...new Set((creds ?? []).map((c) => String(c.order_name ?? '')).filter(Boolean))];
    let source: Ward['source'] = 'db';
    let dataOrdine = new Map<string, string>();
    if (names.length) {
      const { data: ords, error: oErr } = await retryOnce(() => sb.from('shopify_orders').select('order_id, created_at_shop').in('order_id', names));
      if (oErr) return { items: null, source: 'error' };
      dataOrdine = new Map((ords ?? []).map((o) => [String(o.order_id), String(o.created_at_shop ?? '').slice(0, 10)]));
    } else {
      // ripiego: membro senza accrediti (es. primo ordine non ancora passato dal giro di loyalty-orders)
      source = 'api';
      const { data: cfg, error: kErr } = await retryOnce(() => sb.from('app_config').select('shopify_token').eq('id', 1).single());
      if (kErr) return { items: null, source: 'error' };
      const token = String(cfg?.shopify_token ?? '');
      if (!token) return { items: [], source: 'none' };
      let orders: Array<{ name?: string; createdAt?: string }> = [];
      try {
        const r = await fetch(`https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`, {
          method: 'POST', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: 'query($q: String!) { orders(first: 250, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { name createdAt } } }',
            variables: { q: `customer_id:${customerId}` },
          }),
        });
        if (!r.ok) return { items: null, source: 'error' };
        const j = await r.json();
        if (j?.errors?.length) return { items: null, source: 'error' };
        orders = (j?.data?.orders?.nodes ?? []) as Array<{ name?: string; createdAt?: string }>;
      } catch { return { items: null, source: 'error' }; }
      names = orders.map((o) => String(o.name ?? '')).filter(Boolean);
      if (!names.length) return { items: [], source: 'none' };
      dataOrdine = new Map(orders.map((o) => [String(o.name ?? ''), String(o.createdAt ?? '').slice(0, 10)]));
    }

    // `shopify_line_items.order_id` tiene il NOME dell'ordine ('#1582'), non l'id numerico.
    const { data: items, error: iErr } = await retryOnce(() => sb.from('shopify_line_items')
      .select('order_id, lineitem_name, codice, codice_norm').in('order_id', names));
    if (iErr) return { items: null, source: 'error' };
    if (!items?.length) return { items: [], source };

    const codeOf = (i: Record<string, unknown>) => String(i.codice_norm || i.codice || '');   // T33: la chiave canonica e' codice_norm
    const codici = [...new Set(items.map(codeOf).filter(Boolean))];
    const imgs = new Map<string, { img: string | null; titolo: string | null }>();
    if (codici.length) {
      const { data: stock, error: sErr } = await retryOnce(() => sb.from('shopify_stock')
        .select('codice, image_url, shopify_title').in('codice', codici));
      if (sErr) return { items: null, source: 'error' };
      for (const s of stock ?? []) {
        imgs.set(String(s.codice), { img: (s.image_url as string | null) ?? null, titolo: (s.shopify_title as string | null) ?? null });
      }
    }

    // un capo per codice (il piu' recente), niente doppioni nel guardaroba
    const perCodice = new Map<string, Record<string, unknown>>();
    for (const i of items) {
      const codice = codeOf(i);
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
    return { items: [...perCodice.values()].sort((a, b) => String(b.data ?? '').localeCompare(String(a.data ?? ''))), source };
  };

  if (action === 'balance') {
    const points = await readPoints();
    // 2026-09-13 (sweep incidente doppioni): saldo non letto = 503, non un finto 0
    if (points === null) return json({ error: 'read_failed' }, 503);
    return json({ points });
  }

  if (action === 'state') {
    const oggi = romeToday();
    // v11: visita registrata in loyalty_visits (idempotente per cliente e giorno, migr 0137): telemetria, mai bloccante
    const visit = sb.rpc('loyalty_visit', { p_customer: customerId, p_day: oggi }).then(() => null, () => null);
    const [points, mimi, ward] = await Promise.all([readPoints(), readMimi(), wardrobe(), visit]);
    // 2026-09-13 (sweep incidente doppioni): saldo o stato Mimi non letti = 503, non un profilo finto (0 punti, tutto disponibile)
    if (points === null || mimi === null) return json({ error: 'read_failed' }, 503);
    return json({
      points,
      nanna: mimi.nanna,
      coccola_disponibile: mimi.last_coccola !== oggi,
      memory_disponibile: mimi.last_memory !== oggi,
      worn: mimi.worn,
      wardrobe: ward.items,
      wardrobe_source: ward.source,
    });
  }

  if (action === 'coccola' || action === 'memory_win') {
    const oggi = romeToday();
    const kind = action === 'coccola' ? 'coccola' : 'memory';
    const delta = kind === 'coccola' ? PREMIO_COCCOLA : PREMIO_MEMORY;
    // v11 (L3): cancello "1 volta al giorno" e accredito nella STESSA transazione (RPC loyalty_award_daily, migr 0136):
    // due tap concorrenti non producono piu' due premi. Il premio resta fisso e deciso qui, mai dal client. La RPC e'
    // idempotente per giorno (seconda chiamata = done_today), quindi il retryOnce e' sicuro anche se la prima e' passata.
    const { data: aw, error: awErr } = await retryOnce(() => sb.rpc('loyalty_award_daily', { p_customer: customerId, p_kind: kind, p_delta: delta, p_day: oggi }));
    if (awErr) return json({ error: 'write_failed' }, 500);
    const a = (aw ?? {}) as { ok?: boolean; done_today?: boolean; points?: number; added?: number; reason?: string };
    if (!a.ok) return json({ error: a.reason ?? 'write_failed' }, 400);
    if (a.done_today) return json({ done_today: true, points: a.points ?? 0 });
    return json({ points: a.points, added: a.added ?? delta });
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
    const ward = await wardrobe();
    if (ward.items === null) return json({ error: 'read_failed' }, 503);   // possesso non verificabile = niente scrittura
    const posseduti = new Set(ward.items.map((w) => String(w.codice)));
    if (!posseduti.has(codice)) return json({ error: 'not_owned', codice }, 409);
    if (!await saveMimi({ worn: codice })) return json({ error: 'write_failed' }, 500);
    return json({ worn: codice });
  }

  if (action === 'add') {
    // Clicker in RISERVA: spento per il pubblico finche' l'owner non accende il flag (decisione 24-07).
    const on = await readFlag('loyalty_click_enabled');
    if (on === null) return json({ error: 'read_failed' }, 503);
    if (!on) return json({ state: 'off' });

    const body = await req.json().catch(() => ({}));
    const rawScore = Number((body as { score?: unknown }).score);
    if (!Number.isFinite(rawScore)) return json({ error: 'invalid_score' }, 400);
    const requested = Math.max(0, Math.floor(rawScore));       // quanto chiesto (post-arrotondamento)
    const score = Math.min(CAP_PER_GAME, requested);            // clamp a punteggio-partita
    const points = await readPoints();
    // 2026-09-13 (sweep incidente doppioni): saldo non letto = 503 prima di ogni scrittura (prima: upsert di 0+added)
    if (points === null) return json({ error: 'read_failed' }, 503);

    // rate-limit: ultimo evento del cliente entro RATE_LIMIT_SEC => niente scrittura
    // 2026-09-13 (sweep incidente doppioni): lettura fallita = rate-limit a vuoto; ora la guardia non valutabile rifiuta
    const { data: lastEv, error: lastErr } = await retryOnce(() => sb.from('loyalty_events')
      .select('created_at').eq('shopify_customer_id', customerId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle());
    if (lastErr) return json({ error: 'read_failed' }, 503);
    if (lastEv?.created_at) {
      const ageSec = (Date.now() - new Date(lastEv.created_at as string).getTime()) / 1000;
      if (ageSec < RATE_LIMIT_SEC) return json({ capped: true, reason: 'rate', points });
    }

    // cap giornaliero: somma dei delta positivi di oggi (UTC: comportamento storico del clicker)
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    // 2026-09-13 (sweep incidente doppioni): lettura fallita = cap giornaliero a vuoto; ora la guardia non valutabile rifiuta
    const { data: todayEv, error: todayErr } = await retryOnce(() => sb.from('loyalty_events')
      .select('delta').eq('shopify_customer_id', customerId).gte('created_at', dayStart.toISOString()));
    if (todayErr) return json({ error: 'read_failed' }, 503);
    const todaySum = (todayEv ?? []).reduce((s, e) => s + Math.max(0, (e.delta as number) ?? 0), 0);
    const remaining = Math.max(0, DAILY_CAP - todaySum);
    const added = Math.min(score, remaining);
    if (added <= 0) return json({ capped: true, reason: remaining <= 0 ? 'daily' : 'zero', points });

    const newPoints = points + added;
    const { error: upErr } = await sb.from('loyalty_points')
      .upsert({ shopify_customer_id: customerId, points: newPoints, updated_at: new Date().toISOString() }, { onConflict: 'shopify_customer_id' });
    if (upErr) return json({ error: 'write_failed' }, 500);
    // 2026-09-13 (sweep incidente doppioni): insert audit ignorato = cap/rate-limit sottostimati; ora segnalato
    const { error: evErr } = await sb.from('loyalty_events').insert({ shopify_customer_id: customerId, delta: added, source: 'game_click', meta: { score: requested } });
    if (evErr) await noteEventFailed(added, 'game_click', evErr.message);

    // capped = abbiamo accreditato MENO di quanto chiesto (per clamp-partita o cap giornaliero)
    return json({ points: newPoints, added, capped: added < requested, ...(eventInsertFailed ? { warning: 'event_insert_failed' } : {}) });
  }

  // --- RISCATTO (Premia Fase 3): punti -> premio. Modulo isolato (Regola 19), gated da
  // loyalty_redeem_enabled (default OFF => {state:'off'}). Consegna SCOPE-FREE: pesca un codice sconto
  // pre-generato dall'owner (pool loyalty_reward_codes). Pool vuoto => redemption 'pending' (evasione
  // manuale). Migr 0135: loyalty_rewards/redemptions/reward_codes + RPC atomiche loyalty_redeem/claim_code;
  // migr 0136: claim idempotente (mai un secondo codice) e ramo 'already' solo per il proprietario dell'idemp.
  if (action === 'rewards' || action === 'redeem') {
    const on = await readFlag('loyalty_redeem_enabled');
    if (on === null) return json({ error: 'read_failed' }, 503);
    if (!on) return json({ state: 'off' });

    if (action === 'rewards') {
      const [{ data: cat, error: catErr }, { data: mine, error: mineErr }, points] = await Promise.all([
        retryOnce(() => sb.from('loyalty_rewards').select('key, label, cost_points, kind, value, sort').eq('active', true).order('sort')),
        retryOnce(() => sb.from('loyalty_redemptions').select('reward_key, cost_points, status, discount_code, created_at')
          .eq('shopify_customer_id', customerId).order('created_at', { ascending: false }).limit(20)),
        readPoints(),
      ]);
      // v11 (T9): una lettura fallita del catalogo o dello storico non diventa un "nessun premio" / "nessun riscatto"
      if (catErr || mineErr || points === null) return json({ error: 'read_failed' }, 503);
      return json({ points, rewards: cat ?? [], redemptions: mine ?? [] });
    }

    // action === 'redeem' (POST {reward, idemp})
    const rbody = await req.json().catch(() => ({}));
    const rewardKey = String((rbody as { reward?: unknown }).reward ?? '').trim();
    const idemp = String((rbody as { idemp?: unknown }).idemp ?? '').trim();
    if (!rewardKey || idemp.length < 8) return json({ error: 'invalid_request' }, 400);

    // detrazione atomica + record idempotente (Regola 20). Il client NON decide mai i punti.
    const { data: red, error: rErr } = await sb.rpc('loyalty_redeem', { p_customer: customerId, p_reward_key: rewardKey, p_idemp: idemp });
    if (rErr) return json({ error: 'redeem_failed' }, 500);
    const r = red as { ok?: boolean; reason?: string; status?: string; code?: string | null; new_balance?: number; redemption_id?: number; cost?: number };
    if (!r?.ok) {
      const pts = await readPoints();
      return json({ ok: false, reason: r?.reason ?? 'error', points: pts ?? undefined }, r?.reason === 'insufficient' ? 409 : 400);
    }
    if (r.reason === 'already') {                                  // doppio invio: stato esistente, nessun doppio addebito
      const pts = await readPoints();
      return json({ ok: true, already: true, status: r.status, code: r.code ?? null, points: pts ?? undefined });
    }

    // consegna: pesca un codice libero dal pool (se presente); altrimenti la redemption resta 'pending'.
    // La claim e' idempotente (migr 0136): richiamarla restituisce lo stesso codice, mai un secondo.
    let code: string | null = null;
    try {
      const { data: c } = await sb.rpc('loyalty_claim_code', { p_reward_key: rewardKey, p_customer: customerId, p_redemption_id: r.redemption_id });
      code = (c as string | null) ?? null;
    } catch { /* pool non disponibile: pending, l'owner la evade */ }

    return json({ ok: true, status: code ? 'fulfilled' : 'pending', code, points: r.new_balance, cost: r.cost });
  }

  return json({ error: 'unknown_action', action }, 422);
});
