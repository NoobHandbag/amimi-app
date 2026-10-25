// beh-sync v1 (2026-10-25): modulo beh_* (comportamento utenti), Regola Ferrea 19: edge NUOVA, scrive solo tabelle
// beh_* e chiavi beh_* di health_log; del core legge app_config (PIN, token Shopify) e app_flags. Flag beh_enabled
// default OFF: a flag spento `run` risponde skipped senza scrivere niente. Disegno: gestionale-ami
// Cowork12/projects/Analisi_Comportamento_Utenti_2026-10/04_DESIGN_ECOSISTEMA.md (sez. 4.1 e 5).
//
// v1: solo il passo `ordini`. Per ogni ordine Shopify legge canale (app.id), stato dell'attribuzione e prima e ultima
// visita (customerJourneySummary, scope read_orders) e ne fa una riga di beh_order_origin. Senza dati del cliente:
// sorgenti come classi, referrer come solo host, landing come path senza query string (checkout = 'checkout').
// Idempotente a DB (Regola 20): upsert sulla PK order_gid_num; ogni lettura ha l'error controllato; tetto per giro.
//
// Azioni (POST JSON, sempre con `pin`, come le altre edge del cron):
//   run      (cron 06:19 UTC) `step`: 'ordini' -> ordini CREATI negli ultimi 7 giorni di Roma (finestra mobile: un giro
//            fallito si recupera il giorno dopo; gli ordini ancora ready=false si rileggono). A flag spento: skipped.
//   backfill (a mano) `step`, `from`, `to` (YYYY-MM-DD, `to` escluso, al massimo 62 giorni): funziona anche a flag spento,
//            di proposito, per riempire lo storico prima di accendere.
//   diag     (a mano) prova la lettura (5 ordini recenti con app e attribuzione) e risponde versione API servita e flag.
//   health   (a mano) ultimi giri per passo, in sola lettura.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const SHOP = 'amimi-10000';
const API_VERSION = '2026-07';        // come loyalty-orders: ripinnare ogni trimestre
const GQL = `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`;
const STEPS = ['ordini'];             // passi costruiti in questa versione
const FLAG_KEYS = ['beh_enabled', 'beh_steps'];
const WINDOW_DAYS = 7;                // finestra mobile del giro normale
const PAGE = 50;                      // ordini per pagina GraphQL (costo per nodo alto: app + due visite)
const MAX_ORDINI_RUN = 500;           // Regola 20c: tetto del giro normale (oggi 4-6 ordini al giorno)
const MAX_ORDINI_BACKFILL = 1000;     // tetto di un blocco di backfill
const MAX_BACKFILL_DAYS = 62;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Letture Supabase: un solo ritentativo dopo 1,5 s (PostgREST risponde 504 ai secondi :00-:03, CASI_APERTI n.19).
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn(); if (!r.error) return r; await sleep(1500); return await fn();
};
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const isDay = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + 'T00:00:00Z'));

// ==== PURE:beh-ordini BEGIN ====
// Logica pura del passo ordini: ritagliata da tests/beh_guardie.mjs e provata su casi reali del 25-10.
const gidNum = (gid: unknown): string => String(gid ?? '').split('/').pop() ?? '';
// testo sicuro per PostgREST: niente NUL ne' surrogati UTF-16 spaiati (CONOSCENZA 13-09), taglio per carattere
const clean_ = (s: string): string => {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0 || (c >= 0xd800 && c <= 0xdfff)) continue;
    out += ch;
  }
  return out;
};
const cut_ = (s: unknown, n: number): string => clean_(Array.from(String(s ?? '')).slice(0, n).join(''));
const todayRome_ = (now: Date = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(now);
const romeDay_ = (ms: number): string => todayRome_(new Date(ms));
// giorno di Roma spostato di N giorni, aritmetica sulla mezzanotte UTC (stampo ads-sync: il cambio ora non salta giorni)
const romeDate_ = (offsetDays: number, now: Date = new Date()): string =>
  new Date(Date.parse(todayRome_(now) + 'T00:00:00Z') - offsetDays * 86400000).toISOString().slice(0, 10);
// istanti UTC della ricerca per i giorni di Roma [from, to): la mezzanotte di Roma cade alle 22:00 o 23:00 UTC del
// giorno prima, quindi l'inizio si anticipa di 2 ore e la fine resta alla mezzanotte UTC (sempre dopo quella di Roma).
// La finestra e' un po' piu' larga del dovuto: il giorno vero di ogni ordine lo ricalcola romeDay_, e l'upsert sulla
// PK rende innocui gli ordini letti da due blocchi vicini.
const isoZ_ = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const searchFrom_ = (day: string): string => isoZ_(Date.parse(day + 'T00:00:00Z') - 2 * 3600000);
const searchTo_ = (day: string): string => isoZ_(Date.parse(day + 'T00:00:00Z'));
const CANALI: Record<string, string> = { '580111': 'online_store', '1354745': 'bozza', '2329312': 'facebook_instagram', '3890849': 'shop' };
const canale_ = (appGid: unknown): string => { const id = gidNum(appGid); if (!/^\d+$/.test(id)) return 'sconosciuto'; return CANALI[id] ?? `app:${id}`; };
// host del referrer; il negozio stesso (amimi.it, il dominio myshopify) conta come referrer assente: una sessione che
// riparte da una scheda di amimi.it gia' aperta Shopify la chiama 'direct' (Gate 2 del 25-10: 15 visite su 60)
const SHOP_HOST = /(^|\.)(amimi\.it|myshopify\.com)$/;
const hostOf_ = (u: unknown): string => {
  let h = '';
  try { h = new URL(String(u ?? '')).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
  return SHOP_HOST.test(h) ? '' : h;
};
const landing_ = (u: unknown): string => {
  let p = '';
  try { p = new URL(String(u ?? '')).pathname.toLowerCase(); } catch { return ''; }
  if (/\/checkouts?\//.test(p) || /\/orders\//.test(p) || /thank[_-]?you/.test(p)) return 'checkout';
  return cut_(p, 200);
};
const SOCIAL_HOST = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|tiktok\.com|pinterest\.[a-z.]+|youtube\.com|youtu\.be|t\.co|twitter\.com|x\.com|threads\.net|linkedin\.com|snapchat\.com)$/;
const SEARCH_HOST = /(^|\.)(google\.[a-z.]+|bing\.com|yahoo\.[a-z.]+|duckduckgo\.com|ecosia\.org|yandex\.[a-z.]+|baidu\.com)$/;
const MAIL_HOST = /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|mail\.yahoo\.com|mail\.libero\.it|webmail\.[a-z.]+)$/;
const PAID_MEDIUM = /^(cpc|ppc|cpm|cpv|paid|paid_?social|paidsocial|paid_?search|display|ads?)$/;
const SOCIAL_WORD = /(facebook|instagram|^ig$|^fb$|tiktok|pinterest|youtube)/;
const SEARCH_WORD = /(google|bing|yahoo|duckduckgo|ecosia)/;
const EMAIL_WORD = /(klaviyo|shopify_email|newsletter|substack|mailchimp|^email$)/;
// classe della sorgente di una visita, sullo stile di referrer_source di ShopifyQL piu' il pagato
// deno-lint-ignore no-explicit-any
const srcClass_ = (v: any): string => {
  if (!v) return 'none';
  const u = v.utmParameters ?? {};
  const src = String(u.source ?? '').toLowerCase().trim();
  const med = String(u.medium ?? '').toLowerCase().trim();
  const host = hostOf_(v.referrerUrl);
  const sname = String(v.source ?? '').toLowerCase().trim();
  const tactic = String(v.sourceType ?? '').toUpperCase();
  const social = SOCIAL_HOST.test(host) || SOCIAL_WORD.test(src) || SOCIAL_WORD.test(sname);
  const search = SEARCH_HOST.test(host) || SEARCH_WORD.test(src) || SEARCH_WORD.test(sname) || tactic === 'SEO';
  if (PAID_MEDIUM.test(med) || src === 'facebookads' || tactic === 'AD') return search && !social ? 'paid_search' : 'paid_social';
  if (med === 'email' || EMAIL_WORD.test(src) || MAIL_HOST.test(host) || tactic === 'NEWSLETTER' || tactic === 'ABANDONED_CART') return 'email';
  if (search) return 'search';
  if (social || med === 'social') return 'social';
  if (sname === 'direct' && !src) return 'direct';
  if (host) return 'referral';
  if (!src && !sname) return 'direct';
  return 'unknown';
};
// una riga di beh_order_origin da un nodo Order di GraphQL
// deno-lint-ignore no-explicit-any
const toRow_ = (o: any, syncedAt: string) => {
  const cj = o.customerJourneySummary ?? null;
  const fv = cj?.firstVisit ?? null;
  const lv = cj?.lastVisit ?? null;
  const createdMs = Date.parse(String(o.createdAt));
  const firstMs = fv?.occurredAt ? Date.parse(String(fv.occurredAt)) : NaN;
  const utm = (v: any, k: string) => cut_(v?.utmParameters?.[k] ?? '', 100);
  return {
    order_gid_num: gidNum(o.id),
    order_name: cut_(o.name, 40),
    created_at_shop: new Date(createdMs).toISOString(),
    day: romeDay_(createdMs),
    canale: canale_(o.app?.id),
    app_id: gidNum(o.app?.id),
    is_test: Boolean(o.test),
    is_cancelled: Boolean(o.cancelledAt),
    ready: cj ? Boolean(cj.ready) : true,
    moments: cj ? (cj.momentsCount?.count ?? null) : 0,
    first_src: srcClass_(fv),
    last_src: srcClass_(lv),
    first_ref_host: cut_(hostOf_(fv?.referrerUrl), 120),
    last_ref_host: cut_(hostOf_(lv?.referrerUrl), 120),
    first_utm_source: utm(fv, 'source'), first_utm_medium: utm(fv, 'medium'), first_utm_campaign: utm(fv, 'campaign'),
    last_utm_source: utm(lv, 'source'), last_utm_medium: utm(lv, 'medium'), last_utm_campaign: utm(lv, 'campaign'),
    first_landing: landing_(fv?.landingPage),
    last_landing: landing_(lv?.landingPage),
    first_visit_at: Number.isFinite(firstMs) ? new Date(firstMs).toISOString() : null,
    // giorni di calendario di Roma fra la prima visita e l'ordine (#1949: 05-10 -> 25-10 = 20), non blocchi di 24 ore
    days_to_conv: Number.isFinite(firstMs) && Number.isFinite(createdMs)
      ? Math.max(0, Math.round((Date.parse(romeDay_(createdMs) + 'T00:00:00Z') - Date.parse(romeDay_(firstMs) + 'T00:00:00Z')) / 86400000)) : null,
    synced_at: syncedAt,
  };
};
// ==== PURE:beh-ordini END ====

const VISIT = 'occurredAt source sourceType referrerUrl landingPage utmParameters { source medium campaign }';
const ORDER_FIELDS = `id name createdAt test cancelledAt app { id }
  customerJourneySummary { ready momentsCount { count } firstVisit { ${VISIT} } lastVisit { ${VISIT} } }`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const action = String(body.action ?? 'run').toLowerCase();
  const step = String(body.step ?? '').toLowerCase();
  const source = String(body.source ?? 'manuale').slice(0, 20);
  let token = '';
  // niente chiavi nei log: health_log e' leggibile da anon (redazione del valore e dei formati noti)
  const redact_ = (s: unknown) => {
    let t = String(s ?? '');
    if (token) t = t.split(token).join('***');
    return t.replace(/shpat_[A-Za-z0-9]+/g, 'shpat_***').replace(/access_token=[^&\s)]*/gi, 'access_token=***');
  };
  const todayUtc = () => new Date().toISOString().slice(0, 10);   // chiave health in UTC, come le altre edge
  const health = async (k: string, label: string, n: number, severity: 'ok' | 'warn' | 'error') => {
    const { error } = await retryOnce(() => sb.from('health_log').upsert(
      { day: todayUtc(), k, label: redact_(label).slice(0, 500), n, severity, created_at: new Date().toISOString() }, { onConflict: 'day,k' }));
    return !error;
  };
  // chiave di salute del passo: il backfill ne ha una sua, cosi' un backfill riuscito non copre l'errore del cron
  const hkey = (): string => !STEPS.includes(step) ? 'beh_sync' : action === 'backfill' ? `beh_${step}_backfill` : `beh_${step}`;
  const fail = async (where: string, msg: string, status = 500) => {
    await health(hkey(), `beh-sync FERMATO (${where}): ${msg}`, 1, 'error');
    return json({ error: `${where}: ${redact_(msg)}` }, status);
  };

  // --- PIN + token (come loyalty-orders) ---
  const { data: cfg, error: cErr } = await retryOnce(() => sb.from('app_config').select('pin_hash, shopify_token').eq('id', 1).single());
  if (cErr) return fail('app_config', cErr.message, 503);
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);
  token = String(cfg?.shopify_token ?? '');

  // --- flag (whitelist, lettura controllata: fallita = 503, mai "acceso") ---
  const { data: flags, error: fErr } = await retryOnce(() => sb.from('app_flags').select('key, value').in('key', FLAG_KEYS));
  if (fErr) return fail('app_flags', fErr.message, 503);
  const fmap = new Map((flags ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const enabled = String(fmap.get('beh_enabled') ?? 'false').trim().toLowerCase() === 'true';
  const stepsOn = String(fmap.get('beh_steps') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

  // --- Admin API GraphQL: ritentativo su 429 / 5xx / THROTTLED (lettura idempotente), costo e versione annotati ---
  let servedVersion = '';
  let costTot = 0;
  const gql = async (query: string, variables: Record<string, unknown>) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(GQL, { method: 'POST', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
      servedVersion = r.headers.get('x-shopify-api-version') ?? servedVersion;
      const transient = r.status === 429 || r.status >= 500;
      if (!transient && !r.ok) throw new Error(`Shopify HTTP ${r.status} ${redact_((await r.text()).slice(0, 200))}`);
      const j = transient ? null : await r.json();
      const throttled = Boolean(j?.errors?.some((e: { extensions?: { code?: string } }) => e?.extensions?.code === 'THROTTLED'));
      if (transient || throttled) {
        if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
        throw new Error(transient ? `Shopify HTTP ${r.status}` : 'Shopify THROTTLED');
      }
      if (j?.errors?.length) throw new Error('GraphQL: ' + redact_(JSON.stringify(j.errors).slice(0, 300)));
      costTot += Number(j?.extensions?.cost?.actualQueryCost) || 0;
      return j?.data;
    }
  };

  if (action === 'diag') {
    if (!token) return json({ ok: false, error: 'token Shopify mancante' });
    // scope del token (stampo loyalty-orders): senza read_all_orders Shopify da' 0 ordini oltre i 60 giorni, senza errore
    let scopes: string[] = []; let scopeErr = '';
    try {
      const r = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_scopes.json`, { headers: { 'X-Shopify-Access-Token': token } });
      if (r.ok) scopes = (((await r.json())?.access_scopes ?? []) as Array<{ handle: string }>).map((s) => s.handle); else scopeErr = `HTTP ${r.status}`;
    } catch (e) { scopeErr = redact_(e instanceof Error ? e.message : e); }
    try {
      const d = await gql(`{ orders(first: 50, sortKey: CREATED_AT, reverse: true) { nodes { name app { id name } customerJourneySummary { ready momentsCount { count } lastVisit { ${VISIT} } } } } }`, {});
      // deno-lint-ignore no-explicit-any
      const nodi: any[] = d?.orders?.nodes ?? [];
      const app = new Map<string, { app_name: string | null; canale: string; ordini: number }>();
      for (const n of nodi) {
        const id = gidNum(n.app?.id);
        const cur = app.get(id) ?? { app_name: n.app?.name ?? null, canale: canale_(n.app?.id), ordini: 0 };
        cur.ordini++; app.set(id, cur);
      }
      const ordini = nodi.slice(0, 5).map((n) => ({
        name: n.name, canale: canale_(n.app?.id), ready: n.customerJourneySummary?.ready ?? null,
        moments: n.customerJourneySummary?.momentsCount?.count ?? null, last_src: srcClass_(n.customerJourneySummary?.lastVisit ?? null),
      }));
      return json({ ok: !scopeErr, api_version_requested: API_VERSION, api_version_served: servedVersion || null, costo: costTot,
        scopes: { read_orders: scopes.includes('read_orders'), read_all_orders: scopes.includes('read_all_orders'), read_reports: scopes.includes('read_reports'), errore: scopeErr || undefined },
        app: Object.fromEntries(app), ordini, flags: { enabled, steps: stepsOn } });
    } catch (e) {
      return json({ ok: false, api_version_requested: API_VERSION, api_version_served: servedVersion || null, error: redact_(e instanceof Error ? e.message : e) });
    }
  }

  if (action === 'health') {
    const { data: runs, error } = await retryOnce(() => sb.from('beh_sync_runs')
      .select('step, action, source, status, started_at, ended_at, window_from, window_to, rows_read, rows_written, error')
      .order('started_at', { ascending: false }).limit(20));
    if (error) return json({ error: `beh_sync_runs: ${error.message}` }, 503);
    return json({ ok: true, flags: { enabled, steps: stepsOn }, runs });
  }

  if (action !== 'run' && action !== 'backfill') return json({ error: `azione sconosciuta: ${action}` }, 400);
  if (!STEPS.includes(step)) return json({ error: `passo sconosciuto: ${step || '(vuoto)'}` }, 400);
  if (action === 'run' && !enabled) return json({ ok: true, skipped: 'disabled' });           // Regola 19: NO-OP
  if (action === 'run' && !stepsOn.includes(step)) return json({ ok: true, skipped: 'step_spento', step });
  if (!token) return fail('token', 'token Shopify mancante');

  // --- finestra: giro normale = ultimi 7 giorni di Roma fino a domani escluso; backfill = [from, to) ---
  let from = romeDate_(WINDOW_DAYS);
  let to = romeDate_(-1);
  let cap = MAX_ORDINI_RUN;
  if (action === 'backfill') {
    if (!isDay(body.from) || !isDay(body.to)) return json({ error: 'backfill: from e to obbligatori, YYYY-MM-DD' }, 400);
    from = String(body.from); to = String(body.to);
    const span = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
    if (!(span > 0 && span <= MAX_BACKFILL_DAYS)) return json({ error: `backfill: da 1 a ${MAX_BACKFILL_DAYS} giorni, to escluso` }, 400);
    cap = MAX_ORDINI_BACKFILL;
  }

  // riga del giro con l'id scelto qui: l'upsert su quell'id e' idempotente, quindi puo' ritentare una volta (il cron
  // scatta ai secondi :00-:03, quando PostgREST da' piu' 504, CASI_APERTI n.19) senza creare doppioni
  const runId = crypto.randomUUID();
  const { error: rErr } = await retryOnce(() => sb.from('beh_sync_runs').upsert(
    { id: runId, step, action, source, run_day: todayRome_(), started_at: new Date().toISOString(), status: 'running', window_from: from, window_to: to },
    { onConflict: 'id', ignoreDuplicates: true }));
  if (rErr) return fail('beh_sync_runs', rErr.message);
  const closeRun = async (status: 'ok' | 'warn' | 'error', patch: Record<string, unknown>) => {
    const { error } = await sb.from('beh_sync_runs').update({ status, ended_at: new Date().toISOString(), ...patch }).eq('id', runId);
    return !error;
  };
  const spanDays = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;

  try {
    // --- lettura degli ordini creati nella finestra, a cursore, con tetto ---
    // deno-lint-ignore no-explicit-any
    const nodes: any[] = [];
    let after: string | null = null;
    const q = `created_at:>='${searchFrom_(from)}' AND created_at:<'${searchTo_(to)}'`;
    for (;;) {
      const data = await gql(
        `query($q: String!, $n: Int!, $after: String) { orders(first: $n, after: $after, query: $q, sortKey: CREATED_AT) { pageInfo { hasNextPage endCursor } nodes { ${ORDER_FIELDS} } } }`,
        { q, n: PAGE, after },
      );
      const conn = data?.orders;
      if (!conn) throw new Error('risposta GraphQL senza orders');
      nodes.push(...(conn.nodes ?? []));
      if (nodes.length > cap) throw new Error(`oltre ${cap} ordini nella finestra ${from}..${to}: restringere il backfill`);
      if (!conn.pageInfo?.hasNextPage) break;
      after = String(conn.pageInfo.endCursor);
    }

    // --- righe, dedup sulla PK, upsert a blocchi ---
    const syncedAt = new Date().toISOString();
    const byId = new Map<string, ReturnType<typeof toRow_>>();
    for (const o of nodes) { const r = toRow_(o, syncedAt); if (/^\d+$/.test(r.order_gid_num)) byId.set(r.order_gid_num, r); }
    const rows = [...byId.values()];
    let written = 0;
    const errs: string[] = [];
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await sb.from('beh_order_origin').upsert(chunk, { onConflict: 'order_gid_num' });
      if (error) errs.push(error.message); else written += chunk.length;
    }
    const online = rows.filter((r) => r.canale === 'online_store' && !r.is_test && !r.is_cancelled && r.ready);
    const tracked = online.filter((r) => (r.moments ?? 0) > 0).length;
    const pending = rows.filter((r) => !r.ready).length;
    const meta = { api_version_served: servedVersion || null, costo: costTot, online: online.length, tracciati: tracked, in_attribuzione: pending };
    // 0 ordini su piu' giorni non e' un dato credibile per amimi.it (4-6 al giorno): scope o filtro da controllare
    const vuoto = nodes.length === 0 && spanDays >= 2;
    const status: 'ok' | 'warn' | 'error' = errs.length ? 'error' : vuoto ? 'warn' : 'ok';
    const chiuso = await closeRun(status, { rows_read: nodes.length, rows_written: written, error: errs.length ? redact_(errs.join(' | ')).slice(0, 500) : null, meta });
    const versionNote = servedVersion && servedVersion !== API_VERSION ? ` | ATTENZIONE: API servita ${servedVersion}, pinnata ${API_VERSION}` : '';
    const note = (errs.length ? ` | ERRORI upsert: ${errs.length}` : '') + (vuoto ? ' | NESSUN ordine nella finestra: controllare scope e filtro' : '')
      + (chiuso ? '' : ' | riga del giro non chiusa in beh_sync_runs') + versionNote;
    await health(hkey(),
      `ordini ${from}..${to}: letti ${nodes.length}, scritti ${written}; online ${online.length}, tracciati ${tracked}, in attribuzione ${pending}` + note,
      errs.length, errs.length ? 'error' : (vuoto || !chiuso || versionNote ? 'warn' : 'ok'));
    return json({ ok: !errs.length, step, action, from, to, letti: nodes.length, scritti: written, online: online.length, tracciati: tracked, in_attribuzione: pending, costo: costTot, avvisi: note || undefined, errori: errs.length ? errs.map(redact_) : undefined });
  } catch (e) {
    const msg = redact_(e instanceof Error ? e.message : e);
    await closeRun('error', { error: msg.slice(0, 500), meta: { api_version_served: servedVersion || null, costo: costTot } });
    return fail('ordini', msg, 502);
  }
});
