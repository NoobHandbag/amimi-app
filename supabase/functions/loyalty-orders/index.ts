// loyalty-orders — Premia Fase 2: accredito punti sugli ACQUISTI. Modulo ISOLATO (Regola 19),
// flag loyalty_purchase_enabled default OFF (cron NO-OP). Legge gli ordini PAGATI dall'Admin API
// (stesso token read_orders di shopify-sync) e accredita UNA volta per ordine via la funzione
// atomica loyalty_credit_order (Regola 20). Il client non decide MAI i punti.
// Giro normale (action 'run'): ordini AGGIORNATI di recente, PAGATI, creati DOPO loyalty_orders_since.
// Retroattivo (action 'backfill', a mano, tetto alto): dal 'since' passato nel body.
// NON tocca CE / stock / Qromo: scrive solo loyalty_* (canale service_role, come loyalty-proxy).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const SHOP = 'amimi-10000';
const API = `https://${SHOP}.myshopify.com/admin/api/2024-01`;
const MAX_CREDIT_RUN = 50;        // tetto ordini accreditabili in un giro normale (Regola 20)
const LOOKBACK_DAYS = 3;          // finestra updated_at del giro normale (cattura anche i pagamenti tardivi)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn(); if (!r.error) return r; await sleep(1500); return await fn();
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = () => new Date().toISOString().slice(0, 10);
  const health = async (label: string, n: number, sev: 'ok' | 'warn' | 'error') => {
    const { error } = await retryOnce(() => sb.from('health_log').upsert({ day: today(), k: 'loyalty_orders', label: label.slice(0, 500), n, severity: sev, created_at: new Date().toISOString() }, { onConflict: 'day,k' }));
    return !error;
  };
  const fail = async (step: string, msg: string, status = 500) => {
    if (!body.dryRun) await health(`loyalty-orders FERMATO (${step}): ${msg}`, 1, 'error');
    return json({ error: `${step}: ${msg}` }, status);
  };

  // --- flag + config ---
  const { data: flags, error: fErr } = await retryOnce(() => sb.from('app_flags').select('key, value').in('key', ['loyalty_purchase_enabled', 'loyalty_euro_per_point', 'loyalty_orders_since']));
  if (fErr) return fail('app_flags', fErr.message);
  const fmap = new Map((flags ?? []).map((r) => [r.key, r.value]));
  const enabled = String(fmap.get('loyalty_purchase_enabled') ?? 'false').trim().toLowerCase() === 'true';
  if (!enabled) return json({ state: 'off' });                       // Regola 19: NO-OP a flag spento
  const euroPerPoint = Number(fmap.get('loyalty_euro_per_point') ?? '1') || 1;
  const launch = String(fmap.get('loyalty_orders_since') ?? '2026-01-01T00:00:00Z');

  // --- token (Admin API, come shopify-sync) ---
  const { data: cfg, error: cErr } = await retryOnce(() => sb.from('app_config').select('shopify_token').eq('id', 1).single());
  if (cErr) return fail('app_config', cErr.message);
  const token = String(cfg?.shopify_token ?? '');
  if (!token) return fail('token', 'token Shopify mancante');
  const SH = { 'X-Shopify-Access-Token': token };

  const isBackfill = body.action === 'backfill';
  const fields = 'id,name,created_at,updated_at,financial_status,total_price,subtotal_price,customer';

  // --- pull ordini PAGATI ---
  const orders: Record<string, any>[] = [];
  if (isBackfill) {
    const since = String(body.since || launch);
    let sinceId = 0;
    for (let page = 0; page < 8; page++) {
      const r = await fetch(`${API}/orders.json?status=any&financial_status=paid&created_at_min=${encodeURIComponent(since)}&since_id=${sinceId}&limit=250&fields=${fields}`, { headers: SH });
      if (!r.ok) return fail('Shopify', r.status + ' ' + (await r.text()).slice(0, 200), 502);
      const batch: Record<string, any>[] = (await r.json()).orders ?? [];
      if (!batch.length) break;
      orders.push(...batch);
      for (const o of batch) sinceId = Math.max(sinceId, Number(o.id));
      if (batch.length < 250) break;
      if (page === 7) return fail('backfill', `oltre 2000 ordini da ${since}: restringere con since`, 409);
    }
  } else {
    const updSince = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
    const r = await fetch(`${API}/orders.json?status=any&financial_status=paid&updated_at_min=${encodeURIComponent(updSince)}&limit=250&fields=${fields}`, { headers: SH });
    if (!r.ok) return fail('Shopify', r.status + ' ' + (await r.text()).slice(0, 200), 502);
    orders.push(...(((await r.json()).orders ?? []) as Record<string, any>[]));
  }

  // candidati: pagati, con customer, creati DOPO il lancio (niente retroattivo automatico)
  const paid = orders.filter((o) => String(o.financial_status) === 'paid' && o.customer?.id && String(o.created_at) >= launch);
  const cap = isBackfill ? 1000 : MAX_CREDIT_RUN;
  if (paid.length > cap) return fail('cintura', `${paid.length} ordini da accreditare (tetto ${cap}): niente accredito. Retroattivo: action 'backfill' con since piu' stretto`, 409);

  if (body.dryRun) {
    return json({ ok: true, dryRun: true, launch, fetched: orders.length, candidati: paid.length,
      preview: paid.slice(0, 5).map((o) => ({ order: o.name, cust: String(o.customer.id), base: Number(o.subtotal_price ?? o.total_price), points: Math.floor(Number(o.subtotal_price ?? o.total_price) * euroPerPoint) })) });
  }

  let credited = 0, added = 0, skipped = 0; const errors: string[] = [];
  for (const o of paid) {
    const base = Number(o.subtotal_price ?? o.total_price ?? 0);
    const pts = Math.floor(base * euroPerPoint);
    const { data: res, error } = await sb.rpc('loyalty_credit_order', { p_order_id: String(o.id), p_customer_id: String(o.customer.id), p_points: pts, p_total: base });
    if (error) { if (errors.length < 5) errors.push(`${o.name}: ${error.message}`); continue; }
    if ((res as any)?.credited) { credited++; added += pts; } else skipped++;
  }

  const label = `orders: letti ${orders.length}, candidati ${paid.length}, accreditati ${credited} (+${added} pt), gia'/skip ${skipped}` + (errors.length ? `, ERRORI ${errors.length}: ${errors.slice(0, 3).join(' | ')}` : '');
  await health(label, errors.length, errors.length ? 'error' : 'ok');
  return json({ ok: true, launch, fetched: orders.length, candidati: paid.length, credited, added, skipped, errors: errors.length ? errors : undefined });
});
