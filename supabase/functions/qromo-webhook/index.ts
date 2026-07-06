// qromo-webhook — DIRECT Qromo POS webhook -> Supabase. Removes the Google Sheet / Apps Script from the
// path. Today the chain is: Qromo -> Apps Script doPost -> Import -> SyncImportToDBQromo -> DB_QROMO ->
// QromoForwardToApp -> write-api. This one function does it ALL in one place, so the app survives a
// cutover that retires the Sheet:
//   - auth: Qromo sends `auth` in the body; matched to app_flags.qromo_webhook_secret.
//   - paid-logic: mirrors the doPost — never silently drop a PAID sale (paid / not-paid / paid-missing).
//   - resolve product NAME -> canonical CODICE: products (= PRODUCT_COGS&PRICE) first, then
//     product_aliases (= PRODUCT_MAP / Shopify site name). Unresolved names are still inserted with
//     resolver_status='unresolved' + the raw name (flagged, never lost).
//   - paid unit price = total_value_in_order/qty (fallback price), same as the live doPost.
//   - idempotency on sale_id = order_id + item index (re-sends dedup).
//   - inserts into qromo_sales (the SAME table the bridge writes), source='qromo-direct'.
// READ/WRITE: only writes qromo_sales. verify_jwt=false (Qromo posts raw, auth is the `auth` field).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const norm = (s: unknown) => (s ? String(s).toUpperCase().replace(/\s+/g, '_') : '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method === 'GET') return json({ ok: true, msg: 'qromo-webhook online (POST only)' });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }

  // auth (difesa in profondita', v3): accetta il NOSTRO secret (in body.auth o ?key= nell'URL del
  // webhook) OPPURE il token che Qromo ha generato per il webhook "Amimi App Supabase" (2026-07-03,
  // salvato in app_flags.qromo_webhook_token) — cosi' l'auth regge anche se Qromo strippa la query string.
  const { data: sf } = await sb.from('app_flags').select('key, value').in('key', ['qromo_webhook_secret', 'qromo_webhook_token']);
  const flags = new Map((sf ?? []).map((r: Record<string, string>) => [r.key, r.value]));
  const secret = flags.get('qromo_webhook_secret');
  const qToken = flags.get('qromo_webhook_token');
  const urlKey = new URL(req.url).searchParams.get('key') ?? '';
  const bodyAuth = String(body.auth ?? '');
  const authed = (!!secret && (bodyAuth === secret || urlKey === secret)) || (!!qToken && bodyAuth === qToken);
  if ((secret || qToken) && !authed) return json({ ok: false, error: 'auth' }, 401);

  const order = body.order ?? body?.data?.order ?? body?.payload?.order ?? null;
  if (!order) return json({ ok: true, skipped: 'no_order' });

  // paid-logic — never silently drop a paid sale (distinguish not-paid from paid-field-missing)
  const paidRaw = order.paid;
  const paidMissing = (paidRaw === undefined || paidRaw === null || paidRaw === '');
  const paid = paidRaw === true || paidRaw === 1 || String(paidRaw).toLowerCase() === 'true' || String(paidRaw) === '1';
  if (paidMissing) return json({ ok: true, skipped: 'paid_missing', order_id: order.order_id ?? null });
  if (!paid) return json({ ok: true, skipped: 'not_paid' });

  const items = order.menu_items ?? [];
  if (!items.length) return json({ ok: true, skipped: 'no_items' });

  // resolver maps: name -> canonical CODICE (products = PCP, product_aliases = PRODUCT_MAP)
  const { data: prods } = await sb.from('products').select('codice, codice_norm, item, variant, cogs');
  const byNorm = new Map((prods ?? []).map((r: Record<string, any>) => [r.codice_norm, r]));
  const { data: al } = await sb.from('product_aliases').select('shopify_name_norm, codice');
  const aliasMap = new Map((al ?? []).map((r: Record<string, any>) => [r.shopify_name_norm, r.codice]));

  const orderId = String(order.order_id ?? '');
  const dt = (String(order.order_date ?? '').slice(0, 10)) || new Date().toISOString().slice(0, 10);
  const d = new Date(dt);

  // nome cliente, se Qromo lo manda (feedback 06-07 item 9): le vendite POS sono di solito anonime,
  // ma quando il campo c'e' lo salviamo. Copre le forme note: customer{first/last_name|name}, client, customer_name.
  const cust = order.customer ?? order.client ?? null;
  const custNome = (cust?.first_name ?? cust?.name ?? order.customer_name ?? null) || null;
  const custCognome = (cust?.last_name ?? null) || null;

  let inserted = 0, skipped = 0, unresolved = 0; const errors: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const rawName = String(it.name ?? '');
    const qty = Number(it.quantity ?? 1);
    if (!(qty > 0)) { skipped++; continue; }
    const unit = (it.total_value_in_order != null && qty > 0) ? Number(it.total_value_in_order) / qty : Number(it.price ?? 0);

    // resolve: products by codice_norm first, then product_aliases (Shopify site name)
    const nn = norm(rawName);
    let codice: string, status: string, prod: Record<string, any> | null = null;
    if (byNorm.has(nn)) { prod = byNorm.get(nn)!; codice = prod.codice; status = 'resolved'; }
    else if (aliasMap.has(nn)) { codice = aliasMap.get(nn)!; prod = byNorm.get(norm(codice)) ?? null; status = prod ? 'resolved' : 'cogs_missing'; }
    else { codice = rawName; status = 'unresolved'; unresolved++; }

    const saleId = orderId ? `${orderId}_${i}` : `qd_${dt}_${nn}_${i}`; // stable per order+item -> idempotent
    const { data: ex } = await sb.from('qromo_sales').select('id').eq('sale_id', saleId).limit(1);
    if (ex && ex.length) { skipped++; continue; }

    const { error } = await sb.from('qromo_sales').insert({
      sale_id: saleId, order_id: orderId || null, data: dt, year: d.getFullYear(), month: d.getMonth() + 1,
      nome: custNome, cognome: custCognome,
      codice, item: prod?.item ?? null, variant: prod?.variant ?? null, quantita: qty, prezzo: unit,
      cogs: prod?.cogs ?? null, payment_method: order.payment_type ?? null, resolver_status: status,
      source: 'qromo-direct', note: status === 'unresolved' ? ('Qromo POS: ' + rawName) : null,
    });
    if (error) {
      // 23505 = la riga esiste gia' (re-delivery/race): dedup ATOMICO via l'indice UNIQUE parziale
      // qromo_sales_live_saleid_uq (audit B14) -> skip benigno, NON un errore da ritentare.
      if ((error as { code?: string }).code === '23505') { skipped++; }
      else { if (errors.length < 5) errors.push(`${saleId}: ${error.message}`); skipped++; }
    } else inserted++;
  }
  // Se un item ha fallito per un errore VERO (non 23505), rispondi non-200 cosi' Qromo RITENTA l'ordine
  // (audit B15: prima un errore per-item tornava 200 e la vendita era persa in silenzio). Il retry e'
  // idempotente grazie all'indice UNIQUE, quindi gli item gia' inseriti non si duplicano.
  const failed = errors.length > 0;
  return json({ ok: !failed, order_id: orderId, items: items.length, inserted, skipped, unresolved, errors: errors.length ? errors : undefined }, failed ? 500 : 200);
});
