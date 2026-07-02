// shopify-sync — READ-ONLY pull of new Shopify orders into the replica.
// Token lives in app_config (service-role only). PIN-gated. Only inserts orders NEWER than the
// snapshot (never touches validated historical data); idempotent (skips existing order_id).
// New live orders use an ESTIMATED payment fee (~2.2%+€0.25) and free_shipping=0 — flagged;
// historical months stay cent-exact from the seed.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const norm = (s: string | null | undefined) => (s ? s.toUpperCase().replace(/\s+/g, '_') : '');
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const SHOP = 'amimi-10000';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg } = await sb.from('app_config').select('pin_hash, shopify_token').eq('id', 1).single();
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);
  const token = cfg.shopify_token;
  if (!token) return json({ error: 'token Shopify mancante' }, 500);

  // existing orders + latest date
  const { data: ex } = await sb.from('shopify_orders').select('order_id, created_at_shop');
  const existing = new Set((ex ?? []).map((r) => r.order_id));
  let maxDate = '2026-02-01T00:00:00Z';
  for (const r of ex ?? []) if (r.created_at_shop && r.created_at_shop > maxDate) maxDate = r.created_at_shop;
  const sinceDate = body.dryRun ? new Date(Date.now() - 60 * 86400000).toISOString() : maxDate;

  // resolution maps
  const { data: al } = await sb.from('product_aliases').select('shopify_name_norm, codice');
  const aliasMap = new Map((al ?? []).map((r) => [r.shopify_name_norm, r.codice]));
  const { data: pr } = await sb.from('products').select('codice_norm, cogs');
  const cogsByNorm = new Map((pr ?? []).map((r) => [r.codice_norm, r.cogs]));

  const url = `https://${SHOP}.myshopify.com/admin/api/2024-01/orders.json?status=any&created_at_min=${encodeURIComponent(sinceDate)}&limit=${body.dryRun ? 5 : 250}&order=created_at+asc`;
  const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
  if (!resp.ok) return json({ error: 'Shopify ' + resp.status, detail: (await resp.text()).slice(0, 200) }, 502);
  const { orders } = await resp.json();

  const parse = (o: Record<string, any>) => {
    const d = new Date(o.created_at);
    const gross = Number(o.total_price);
    const shipping = Number(o.total_shipping_price_set?.shop_money?.amount ?? 0);
    const refund = (o.refunds ?? []).reduce((s: number, rf: any) => s + (rf.transactions ?? []).reduce((t: number, tx: any) => t + Number(tx.amount || 0), 0), 0);
    const order = {
      order_id: o.name, order_number: String(o.order_number), created_at_shop: o.created_at,
      customer_name: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || null,
      email: o.email, financial_status: o.financial_status, fulfillment_status: o.fulfillment_status,
      gross_total: gross, discount_total: Number(o.total_discounts || 0), shipping_total: shipping,
      payment_fees: -Math.round((gross * 0.022 + 0.25) * 100) / 100, refund_amount: refund,
      free_shipping: false, free_shipping_amt: 0, currency: o.currency,
      year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, vendor: null,
      fulfilled_at: o.fulfillments?.[0]?.created_at ?? null,
      discount_codes: (o.discount_codes ?? []).map((c: any) => c.code).filter(Boolean).join('+') || null,
    };
    const lines = (o.line_items ?? []).map((it: any) => {
      const nm = it.name ?? it.title;
      const codice = aliasMap.get(norm(nm)) ?? null;
      const cn = codice ? norm(codice) : null;
      return { order_id: o.name, lineitem_name: nm, codice, resolved: !!codice, quantita: Number(it.quantity), price: Number(it.price), cogs_snapshot: cn ? (cogsByNorm.get(cn) ?? null) : null, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
    });
    return { order, lines };
  };

  // ---- one-off: backfill fulfilled_at + discount_codes on EXISTING rows (never touches amounts) ----
  if (body.action === 'backfill_meta') {
    let sinceId = 0, updated = 0, scanned = 0;
    for (let page = 0; page < 20; page++) {
      const u = `https://${SHOP}.myshopify.com/admin/api/2024-01/orders.json?status=any&limit=250&since_id=${sinceId}&fields=id,name,fulfillments,discount_codes`;
      const r = await fetch(u, { headers: { 'X-Shopify-Access-Token': token } });
      if (!r.ok) return json({ error: 'Shopify ' + r.status, updated, scanned }, 502);
      const batch = (await r.json()).orders ?? [];
      if (!batch.length) break;
      for (const o of batch) {
        sinceId = Math.max(sinceId, Number(o.id));
        scanned++;
        const fulfilled_at = o.fulfillments?.[0]?.created_at ?? null;
        const discount_codes = (o.discount_codes ?? []).map((c: { code?: string }) => c.code).filter(Boolean).join('+') || null;
        if (!fulfilled_at && !discount_codes) continue;
        const { error: ue, count } = await sb.from('shopify_orders')
          .update({ fulfilled_at, discount_codes }, { count: 'exact' }).eq('order_id', o.name);
        if (!ue && count) updated += count;
      }
      if (batch.length < 250) break;
    }
    return json({ ok: true, backfill: true, scanned, updated });
  }

  if (body.dryRun) {
    const preview = (orders ?? []).slice(0, 3).map(parse);
    return json({ ok: true, dryRun: true, fetched: orders.length, preview });
  }

  let inserted = 0, lineCount = 0; const errors: string[] = [];
  for (const o of orders ?? []) {
    if (existing.has(o.name)) continue;
    const { order, lines } = parse(o);
    const { error: oe } = await sb.from('shopify_orders').insert(order);
    if (oe) { if (errors.length < 5) errors.push(`${o.name}: ${oe.message}`); continue; }
    inserted++;
    if (lines.length) { await sb.from('shopify_line_items').insert(lines); lineCount += lines.length; }
    existing.add(o.name);
  }
  return json({ ok: true, fetched: orders.length, inserted, lineCount, errors: errors.length ? errors : undefined });
});
