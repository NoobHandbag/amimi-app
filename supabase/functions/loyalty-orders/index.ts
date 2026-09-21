// loyalty-orders v3 — Premia Fase 2: accredito punti sugli ACQUISTI + STORNO resi. Modulo ISOLATO (Regola 19),
// flag loyalty_purchase_enabled default OFF: le azioni che scrivono sono NO-OP, `dryRun` e `diag` restano leggibili.
// v3 (2026-09-21, quest audit Area Membri, Fase 6 bundle B):
//   T20 Admin API GraphQL pinnata ad API_VERSION (la REST 2024-01 era ritirata e servita in fall-forward); il bucket REST
//       resta alle altre 6 edge. La versione SERVITA (header x-shopify-api-version) e' confrontata a ogni giro: diversa
//       da quella pinnata = health warn (il calendario deprecazioni si accende da solo).
//   L1  date confrontate per epoch (Date.parse), mai per stringa con fusi diversi.
//   L2  giro a LOTTI: accredita fino a MAX_CREDIT_RUN per giro e riporta il resto; mai piu' un rifiuto in blocco.
//   L8  finestra updated_at che si allarga fino all'ultimo giro riuscito (app_flags.loyalty_orders_last_run) se il cron
//       e' rimasto fermo; paginazione a cursore.
//   T2  PIN come le altre edge chiamate dal cron (sha256(body.pin) = app_config.pin_hash).
//   L5/G2 STORNO resi proporzionale e idempotente via RPC loyalty_reverse_order (migr 0136), da due fonti: gli ordini
//       con rimborso visti nella finestra Shopify e la coda DB v_loyalty_refunds_due (shopify_orders.refund_amount).
//   L7  partially_refunded accreditati per intero e poi stornati in proporzione (stesso modello, ledger leggibile).
//   order_name nell'accredito (RPC a 5 argomenti): ponte verso shopify_orders / shopify_line_items (guardaroba dal DB).
//   Ordini `test` (gateway fittizio) mai accreditati.
// Il client non decide MAI i punti: floor(subtotale * loyalty_euro_per_point), UNA volta per ordine (RPC atomica
// loyalty_credit_order, Regola 20). NON tocca CE / stock / Qromo: scrive solo loyalty_* e il cursore in app_flags.
//
// Azioni (POST JSON, sempre con `pin`):
//   run      (cron ogni 15 min): ordini AGGIORNATI nella finestra e creati dopo loyalty_orders_since -> accredito;
//            ordini con rimborso -> storno; poi la coda DB. `dryRun:true` = anteprima e totali, nessuna scrittura.
//   backfill (a mano): ordini CREATI in [since, until) (until default = watermark), a chunk (consiglio: un mese);
//            tetto `max` accrediti per chiamata (default 300, massimo 1000), oltre si ferma e dice da dove ripartire.
//   refunds  (a mano): solo la coda DB v_loyalty_refunds_due -> storno.
//   diag     (a mano): versione API richiesta/servita, scope del token, flag; nessuna scrittura.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const SHOP = 'amimi-10000';
const API_VERSION = '2026-07';        // stabile fino al 2027-07: ripinnare ogni trimestre (LOYALTY_RUNBOOK §10)
const GQL = `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`;
const MAX_CREDIT_RUN = 100;           // accrediti per giro normale: il resto passa al giro dopo (tetto, non rifiuto)
const MAX_CREDIT_BACKFILL = 300;      // default per chiamata di backfill (body.max, massimo 1000)
const LOOKBACK_DAYS = 3;              // finestra minima updated_at del giro normale (pagamenti tardivi, rimborsi)
const PAGE = 250;                     // ordini per pagina GraphQL (massimo Shopify)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn(); if (!r.error) return r; await sleep(1500); return await fn();
};
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const N = (x: unknown) => Number(x) || 0;
const gidNum = (gid: unknown) => String(gid ?? '').split('/').pop() ?? '';
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

type Order = { id: string; name: string; created_at: number; updated_at: number; status: string; test: boolean; customer: string; base: number; refunded: number };
const ORDER_FIELDS = `id name createdAt updatedAt displayFinancialStatus test customer { id }
  subtotalPriceSet { shopMoney { amount } } totalPriceSet { shopMoney { amount } } totalRefundedSet { shopMoney { amount } }`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const action = String(body.action ?? 'run').toLowerCase();
  const dryRun = body.dryRun === true;
  const today = () => new Date().toISOString().slice(0, 10);
  const health = async (label: string, n: number, sev: 'ok' | 'warn' | 'error', k = 'loyalty_orders') => {
    const { error } = await retryOnce(() => sb.from('health_log').upsert({ day: today(), k, label: label.slice(0, 500), n, severity: sev, created_at: new Date().toISOString() }, { onConflict: 'day,k' }));
    return !error;
  };
  const fail = async (step: string, msg: string, status = 500) => {
    if (!dryRun) await health(`loyalty-orders FERMATO (${step}): ${msg}`, 1, 'error');
    return json({ error: `${step}: ${msg}` }, status);
  };

  // --- PIN (T2: stessa posta delle altre edge chiamate dal cron) + token ---
  const { data: cfg, error: cErr } = await retryOnce(() => sb.from('app_config').select('pin_hash, shopify_token').eq('id', 1).single());
  if (cErr) return fail('app_config', cErr.message);
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);
  const token = String(cfg?.shopify_token ?? '');
  if (!token) return fail('token', 'token Shopify mancante');

  // --- flag ---
  const { data: flags, error: fErr } = await retryOnce(() => sb.from('app_flags').select('key, value').in('key', ['loyalty_purchase_enabled', 'loyalty_euro_per_point', 'loyalty_orders_since', 'loyalty_orders_last_run']));
  if (fErr) return fail('app_flags', fErr.message);
  const fmap = new Map((flags ?? []).map((r) => [r.key, r.value]));
  const enabled = String(fmap.get('loyalty_purchase_enabled') ?? 'false').trim().toLowerCase() === 'true';
  const euroPerPoint = Number(fmap.get('loyalty_euro_per_point') ?? '1') || 1;
  const launchIso = String(fmap.get('loyalty_orders_since') ?? '2026-01-01T00:00:00Z');
  const launchMs = Date.parse(launchIso);
  if (!Number.isFinite(launchMs)) return fail('app_flags', `loyalty_orders_since non e' una data ISO: ${launchIso}`);
  const lastRunMs = Date.parse(String(fmap.get('loyalty_orders_last_run') ?? ''));
  const pointsOf = (o: Order) => Math.floor(o.base * euroPerPoint);

  // --- Admin API GraphQL: un ritentativo su 429 / 5xx / THROTTLED, versione servita annotata ---
  let servedVersion = '';
  const gql = async (query: string, variables: Record<string, unknown>) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(GQL, { method: 'POST', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
      servedVersion = r.headers.get('x-shopify-api-version') ?? servedVersion;
      const transient = r.status === 429 || r.status >= 500;
      if (!transient && !r.ok) throw new Error(`Shopify HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      const j = transient ? null : await r.json();
      const throttled = Boolean(j?.errors?.some((e: { extensions?: { code?: string } }) => e?.extensions?.code === 'THROTTLED'));
      if (transient || throttled) {
        if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
        throw new Error(transient ? `Shopify HTTP ${r.status}` : 'Shopify THROTTLED');
      }
      if (j?.errors?.length) throw new Error('GraphQL: ' + JSON.stringify(j.errors).slice(0, 300));
      return j?.data;
    }
  };
  const versionMismatch = () => Boolean(servedVersion) && servedVersion !== API_VERSION;
  const versionNote = () => versionMismatch() ? ` | ATTENZIONE: API servita ${servedVersion}, pinnata ${API_VERSION}` : '';

  const pullOrders = async (q: string, sortKey: 'UPDATED_AT' | 'CREATED_AT', maxPages: number): Promise<Order[]> => {
    const out: Order[] = [];
    let after: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const data = await gql(
        `query($q: String!, $n: Int!, $after: String) { orders(first: $n, after: $after, query: $q, sortKey: ${sortKey}) { pageInfo { hasNextPage endCursor } nodes { ${ORDER_FIELDS} } } }`,
        { q, n: PAGE, after },
      );
      const conn = data?.orders;
      for (const o of (conn?.nodes ?? []) as Record<string, any>[]) {
        out.push({
          id: gidNum(o.id), name: String(o.name ?? ''), created_at: Date.parse(o.createdAt), updated_at: Date.parse(o.updatedAt),
          status: String(o.displayFinancialStatus ?? ''), test: Boolean(o.test), customer: gidNum(o.customer?.id),
          base: N(o.subtotalPriceSet?.shopMoney?.amount) || N(o.totalPriceSet?.shopMoney?.amount),
          refunded: N(o.totalRefundedSet?.shopMoney?.amount),
        });
      }
      if (!conn?.pageInfo?.hasNextPage) break;
      if (page === maxPages - 1) throw new Error(`oltre ${maxPages * PAGE} ordini nella finestra: restringere since/until`);
      after = String(conn.pageInfo.endCursor);
    }
    return out;
  };

  // candidati all'accredito: non di test, con cliente, pagati (anche parzialmente rimborsati: lo storno fa il resto)
  const creditable = (o: Order) => !o.test && !!o.customer && (o.status === 'PAID' || o.status === 'PARTIALLY_REFUNDED');
  const credit = async (o: Order) => {
    const pts = pointsOf(o);
    const { data: res, error } = await sb.rpc('loyalty_credit_order', { p_order_id: o.id, p_customer_id: o.customer, p_points: pts, p_total: o.base, p_order_name: o.name });
    if (error) throw new Error(`${o.name}: ${error.message}`);
    return { credited: Boolean((res as { credited?: boolean } | null)?.credited), pts };
  };
  // storno idempotente: not_credited / already / nothing = 0 punti mossi
  const reverse = async (orderId: string, refunded: number, name: string) => {
    const { data: res, error } = await sb.rpc('loyalty_reverse_order', { p_order_id: orderId, p_refunded: refunded });
    if (error) throw new Error(`${name} storno: ${error.message}`);
    return N((res as { reversed?: number } | null)?.reversed);
  };
  const preview = (list: Order[]) => list.slice(0, 5).map((o) => ({ order: o.name, created_at: iso(o.created_at), status: o.status, cust: o.customer, base: o.base, points: pointsOf(o), refunded: o.refunded }));
  const stimaStorno = (o: Order) => o.refunded > 0 && o.base > 0 ? Math.min(pointsOf(o), Math.floor(pointsOf(o) * Math.min(o.refunded / o.base, 1))) : 0;

  // coda DB degli storni dovuti (shopify_orders.refund_amount): letta a fine giro e con l'action 'refunds'
  const dueFromDb = async (limit: number) => {
    const { data, error } = await retryOnce(() => sb.from('v_loyalty_refunds_due').select('shopify_order_id, order_name, points, points_reversed, target, refund_amount').limit(limit));
    if (error) throw new Error(`v_loyalty_refunds_due: ${error.message}`);
    return (data ?? []) as Array<{ shopify_order_id: string; order_name: string; points: number; points_reversed: number; target: number; refund_amount: number }>;
  };

  if (action === 'diag') {
    let scopes: string[] = []; let scopeErr = '';
    try {
      const r = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_scopes.json`, { headers: { 'X-Shopify-Access-Token': token } });
      if (r.ok) scopes = (((await r.json())?.access_scopes ?? []) as Array<{ handle: string }>).map((s) => s.handle); else scopeErr = `HTTP ${r.status}`;
    } catch (e) { scopeErr = String(e instanceof Error ? e.message : e); }
    let shopName = ''; let gqlErr = '';
    try { const d = await gql('{ shop { name } }', {}); shopName = String(d?.shop?.name ?? ''); } catch (e) { gqlErr = String(e instanceof Error ? e.message : e); }
    return json({ ok: !gqlErr, api_version_requested: API_VERSION, api_version_served: servedVersion || null, shop: shopName, scopes, scope_error: scopeErr || undefined, gql_error: gqlErr || undefined,
      flags: { enabled, euroPerPoint, launch: launchIso, last_run: fmap.get('loyalty_orders_last_run') || null } });
  }

  if (!enabled && !dryRun) return json({ state: 'off' });           // Regola 19: NO-OP a flag spento (le scritture)

  if (action === 'run') {
    const nowMs = Date.now();
    let sinceMs = nowMs - LOOKBACK_DAYS * 86400000;
    if (Number.isFinite(lastRunMs) && lastRunMs - 3600000 < sinceMs) sinceMs = lastRunMs - 3600000;   // L8: cron fermo -> finestra fino all'ultimo giro
    sinceMs = Math.max(sinceMs, launchMs - 86400000);                                                  // prima del watermark accredita solo il backfill
    const q = `updated_at:>=${iso(sinceMs)} (financial_status:paid OR financial_status:partially_refunded OR financial_status:refunded)`;
    let orders: Order[];
    try { orders = await pullOrders(q, 'UPDATED_AT', 8); } catch (e) { return fail('Shopify', String(e instanceof Error ? e.message : e), 502); }
    const cands = orders.filter((o) => creditable(o) && o.created_at >= launchMs).sort((a, b) => a.created_at - b.created_at);
    const refunds = orders.filter((o) => o.refunded > 0);
    const batch = cands.slice(0, MAX_CREDIT_RUN);
    const resto = cands.length - batch.length;
    if (dryRun) {
      let inCoda = -1; try { inCoda = (await dueFromDb(50)).length; } catch { /* solo anteprima */ }
      return json({ ok: true, dryRun: true, api_version: servedVersion || API_VERSION, launch: launchIso, window_from: iso(sinceMs), fetched: orders.length,
        candidati: cands.length, in_questo_giro: batch.length, resto, punti_stimati: batch.reduce((s, o) => s + pointsOf(o), 0),
        con_rimborso: refunds.length, storno_coda_db: inCoda, preview: preview(batch) });
    }
    let credited = 0, added = 0, skipped = 0, reversed = 0, reversedOrders = 0, dbReversed = 0, dbOrders = 0; const errors: string[] = [];
    for (const o of batch) {
      try { const r = await credit(o); if (r.credited) { credited++; added += r.pts; } else skipped++; }
      catch (e) { if (errors.length < 5) errors.push(String(e instanceof Error ? e.message : e)); }
    }
    for (const o of refunds) {
      try { const n = await reverse(o.id, o.refunded, o.name); if (n > 0) { reversed += n; reversedOrders++; } }
      catch (e) { if (errors.length < 5) errors.push(String(e instanceof Error ? e.message : e)); }
    }
    try {
      for (const d of await dueFromDb(50)) {
        const n = await reverse(d.shopify_order_id, N(d.refund_amount), d.order_name);
        if (n > 0) { dbReversed += n; dbOrders++; }
      }
    } catch (e) { if (errors.length < 5) errors.push(String(e instanceof Error ? e.message : e)); }
    // cursore L8: avanza solo se il giro e' pulito (con errori resta indietro e la finestra ricopre gli ordini mancati)
    if (!errors.length) {
      const { error: curErr } = await sb.from('app_flags').upsert({ key: 'loyalty_orders_last_run', value: iso(nowMs) }, { onConflict: 'key' });
      if (curErr) errors.push(`cursore: ${curErr.message}`);
    }
    const label = `orders v3: letti ${orders.length}, candidati ${cands.length}, accreditati ${credited} (+${added} pt), gia'/skip ${skipped}, resto ${resto}, stornati ${reversedOrders} ord (-${reversed} pt) + coda DB ${dbOrders} ord (-${dbReversed} pt)`
      + (errors.length ? `, ERRORI ${errors.length}: ${errors.slice(0, 3).join(' | ')}` : '') + versionNote();
    await health(label, errors.length, errors.length ? 'error' : versionMismatch() ? 'warn' : 'ok');
    return json({ ok: true, api_version: servedVersion || API_VERSION, launch: launchIso, window_from: iso(sinceMs), fetched: orders.length, candidati: cands.length,
      credited, added, skipped, resto, reversed_orders: reversedOrders, reversed_points: reversed, db_reversed_orders: dbOrders, db_reversed_points: dbReversed,
      errors: errors.length ? errors : undefined });
  }

  if (action === 'backfill') {
    const sinceMs = Date.parse(String(body.since ?? ''));
    if (!Number.isFinite(sinceMs)) return json({ error: "backfill: 'since' (ISO) obbligatorio, es. 2026-02-01T00:00:00Z" }, 400);
    const untilMs = body.until ? Date.parse(String(body.until)) : launchMs;
    if (!Number.isFinite(untilMs) || untilMs <= sinceMs) return json({ error: "backfill: 'until' non valido (default: watermark loyalty_orders_since)" }, 400);
    const max = Math.min(1000, Math.max(1, Number(body.max) || MAX_CREDIT_BACKFILL));
    const q = `created_at:>=${iso(sinceMs)} created_at:<${iso(untilMs)} (financial_status:paid OR financial_status:partially_refunded)`;
    let orders: Order[];
    try { orders = await pullOrders(q, 'CREATED_AT', 8); } catch (e) { return fail('Shopify', String(e instanceof Error ? e.message : e), 502); }
    const cands = orders.filter(creditable).sort((a, b) => a.created_at - b.created_at);
    const batch = cands.slice(0, max);
    const resto = cands.length - batch.length;
    const nextSince = resto ? iso(cands[max].created_at) : null;
    const totals = {
      since: iso(sinceMs), until: iso(untilMs), fetched: orders.length, candidati: cands.length, in_questa_chiamata: batch.length, resto, next_since: nextSince,
      punti: batch.reduce((s, o) => s + pointsOf(o), 0), clienti: new Set(batch.map((o) => o.customer)).size,
      parzialmente_rimborsati: batch.filter((o) => o.refunded > 0).length, punti_storno_stimati: batch.reduce((s, o) => s + stimaStorno(o), 0),
      senza_cliente: orders.filter((o) => !o.customer).length, di_test: orders.filter((o) => o.test).length,
    };
    if (dryRun) return json({ ok: true, dryRun: true, api_version: servedVersion || API_VERSION, ...totals, preview: preview(batch) });
    let credited = 0, added = 0, skipped = 0, reversed = 0, reversedOrders = 0; const errors: string[] = [];
    for (const o of batch) {
      try { const r = await credit(o); if (r.credited) { credited++; added += r.pts; } else skipped++; }
      catch (e) { if (errors.length < 5) errors.push(String(e instanceof Error ? e.message : e)); }
    }
    for (const o of batch.filter((o) => o.refunded > 0)) {
      try { const n = await reverse(o.id, o.refunded, o.name); if (n > 0) { reversed += n; reversedOrders++; } }
      catch (e) { if (errors.length < 5) errors.push(String(e instanceof Error ? e.message : e)); }
    }
    const label = `backfill ${totals.since}..${totals.until}: letti ${orders.length}, candidati ${cands.length}, accreditati ${credited} (+${added} pt), gia'/skip ${skipped}, resto ${resto}, stornati ${reversedOrders} ord (-${reversed} pt)`
      + (errors.length ? `, ERRORI ${errors.length}: ${errors.slice(0, 3).join(' | ')}` : '') + versionNote();
    await health(label, errors.length, errors.length ? 'error' : versionMismatch() ? 'warn' : 'ok', 'loyalty_backfill');
    return json({ ok: true, api_version: servedVersion || API_VERSION, ...totals, credited, added, skipped, reversed_orders: reversedOrders, reversed_points: reversed, errors: errors.length ? errors : undefined });
  }

  if (action === 'refunds') {
    let due: Awaited<ReturnType<typeof dueFromDb>>;
    try { due = await dueFromDb(200); } catch (e) { return fail('refunds', String(e instanceof Error ? e.message : e)); }
    if (dryRun) return json({ ok: true, dryRun: true, in_coda: due.length, preview: due.slice(0, 10) });
    let reversed = 0, n = 0; const errors: string[] = [];
    for (const d of due) {
      try { const r = await reverse(d.shopify_order_id, N(d.refund_amount), d.order_name); if (r > 0) { reversed += r; n++; } }
      catch (e) { if (errors.length < 5) errors.push(String(e instanceof Error ? e.message : e)); }
    }
    await health(`refunds (coda DB): ${due.length} in coda, stornati ${n} ord (-${reversed} pt)` + (errors.length ? `, ERRORI ${errors.length}: ${errors.slice(0, 3).join(' | ')}` : ''), errors.length, errors.length ? 'error' : 'ok', 'loyalty_refunds');
    return json({ ok: true, in_coda: due.length, reversed_orders: n, reversed_points: reversed, errors: errors.length ? errors : undefined });
  }

  return json({ error: 'unknown_action', action }, 422);
});
