// shopify-stock — THIRD FLOW. READ-ONLY pull of Shopify variant inventory into shopify_stock,
// plus a GATED realign (sets Shopify available = gestionale "disponibili") behind
// app_flags.shopify_write_enabled. Token in app_config (service-role). PIN-gated.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const norm = (s: string | null | undefined) => (s ? s.toUpperCase().replace(/\s+/g, '_') : '');
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const SHOP = 'amimi-10000';
const API = `https://${SHOP}.myshopify.com/admin/api/2024-01`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg } = await sb.from('app_config').select('pin_hash, shopify_token').eq('id', 1).single();
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);
  const token = cfg.shopify_token;
  if (!token) return json({ error: 'token Shopify mancante' }, 500);
  const SH = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };
  const action = body.action || 'sync';

  // ---- SYNC: pull variant inventory, map SKU -> codice, upsert shopify_stock ----
  if (action === 'sync') {
    const { data: al } = await sb.from('product_aliases').select('shopify_name_norm, codice');
    const aliasMap = new Map((al ?? []).map((r) => [r.shopify_name_norm, r.codice]));
    const { data: prods } = await sb.from('products').select('codice, codice_norm');
    const byNorm = new Map((prods ?? []).map((r) => [r.codice_norm, r.codice]));

    const resp = await fetch(`${API}/products.json?limit=250&fields=id,title,image,images,variants`, { headers: SH });
    if (!resp.ok) return json({ error: 'Shopify ' + resp.status, detail: (await resp.text()).slice(0, 200) }, 502);
    const { products } = await resp.json();

    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const p of products ?? []) {
      for (const v of p.variants ?? []) {
        // SKU is the CODICE_AMIIMI; fall back to product title via aliases, then normalized codice.
        let codice: string | null = null;
        if (v.sku && byNorm.has(norm(v.sku))) codice = byNorm.get(norm(v.sku))!;
        else if (v.sku && [...byNorm.values()].includes(v.sku)) codice = v.sku;
        else codice = aliasMap.get(norm(p.title)) ?? (v.sku || null);
        if (!codice || seen.has(codice)) continue;
        seen.add(codice);
        // image: the variant's own photo if it has one, else the product's featured/first image
        const vImg = (v.image_id && Array.isArray(p.images))
          ? (p.images.find((im: { id: number; src: string }) => im.id === v.image_id)?.src ?? null) : null;
        const image_url = vImg ?? p.image?.src ?? (Array.isArray(p.images) ? (p.images[0]?.src ?? null) : null);
        rows.push({
          codice, shopify_qty: Number(v.inventory_quantity ?? 0), shopify_title: p.title, image_url,
          variant_id: String(v.id), inventory_item_id: String(v.inventory_item_id), synced_at: new Date().toISOString(),
        });
      }
    }
    if (rows.length) await sb.from('shopify_stock').upsert(rows, { onConflict: 'codice' });
    return json({ ok: true, synced: rows.length, products: (products ?? []).length });
  }

  // ---- REALIGN: set Shopify available = gestionale disponibili (GATED) ----
  if (action === 'realign') {
    const { data: flag } = await sb.from('app_flags').select('value').eq('key', 'shopify_write_enabled').single();
    if (flag?.value !== 'true') return json({ error: 'Riallineamento Shopify disattivato (interruttore lato server spento).', gated: true }, 403);

    const codici: string[] = body.codici || [];
    if (!codici.length) return json({ error: 'nessun prodotto selezionato' }, 422);
    const loc = await fetch(`${API}/locations.json`, { headers: SH }).then((r) => r.json()).catch(() => null);
    const locationId = loc?.locations?.find((l: Record<string, unknown>) => l.active)?.id ?? loc?.locations?.[0]?.id;
    if (!locationId) return json({ error: 'location Shopify non trovata' }, 502);

    const { data: stock } = await sb.from('shopify_stock').select('codice, inventory_item_id').in('codice', codici);
    const { data: inv } = await sb.from('v_inventory').select('codice, disponibili_da_vendere').in('codice', codici);
    const target = new Map((inv ?? []).map((r) => [r.codice, Math.max(0, Number(r.disponibili_da_vendere) || 0)]));

    const results: Record<string, unknown>[] = [];
    for (const s of stock ?? []) {
      const available = target.get(s.codice) ?? 0;
      const r = await fetch(`${API}/inventory_levels/set.json`, {
        method: 'POST', headers: SH,
        body: JSON.stringify({ location_id: locationId, inventory_item_id: Number(s.inventory_item_id), available }),
      });
      results.push({ codice: s.codice, available, ok: r.ok });
      if (r.ok) await sb.from('shopify_stock').update({ shopify_qty: available, synced_at: new Date().toISOString() }).eq('codice', s.codice);
    }
    await sb.from('change_log').insert({ tbl: 'shopify_stock', row_id: 'realign', op: 'shopify_realign', after: { results }, chi: body.chi || null, source: 'shopify-stock' });
    return json({ ok: true, realigned: results.filter((r) => r.ok).length, results });
  }

  return json({ error: 'azione sconosciuta' }, 400);
});
