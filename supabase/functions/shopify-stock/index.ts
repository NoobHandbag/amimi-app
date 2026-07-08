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

    const resp = await fetch(`${API}/products.json?limit=250&fields=id,title,status,image,images,variants`, { headers: SH });
    if (!resp.ok) return json({ error: 'Shopify ' + resp.status, detail: (await resp.text()).slice(0, 200) }, 502);
    const { products } = await resp.json();

    // Group ALL variant inventory items per codice: dual-variant bags (SC/CC "Senza/Con Catena")
    // share ONE codice via the product-title alias — both inventory items must be kept and realigned.
    // Quando PIU' prodotti Shopify mappano allo stesso codice (es. il doppione ritirato "DARK LEOPARD
    // PONY" in bozza + la "SAVANA" attiva), titolo/immagine/status vengono dal MIGLIORE:
    // attivo batte bozza/archiviato, SKU esatto batte l'alias sul titolo (feedback 06-07, item 19).
    const byCodice = new Map<string, { qty: number; title: string; image: string | null; variant_id: string; items: string[]; status: string; score: number }>();
    for (const p of products ?? []) {
      const status = String(p.status ?? 'active');
      for (const v of p.variants ?? []) {
        // SKU is the CODICE_AMIIMI; fall back to product title via aliases, then normalized codice.
        let codice: string | null = null;
        let bySku = false;
        if (v.sku && byNorm.has(norm(v.sku))) { codice = byNorm.get(norm(v.sku))!; bySku = true; }
        else if (v.sku && [...byNorm.values()].includes(v.sku)) { codice = v.sku; bySku = true; }
        else codice = aliasMap.get(norm(p.title)) ?? (v.sku || null);
        if (!codice) continue;
        // image: the variant's own photo if it has one, else the product's featured/first image
        const vImg = (v.image_id && Array.isArray(p.images))
          ? (p.images.find((im: { id: number; src: string }) => im.id === v.image_id)?.src ?? null) : null;
        const image_url = vImg ?? p.image?.src ?? (Array.isArray(p.images) ? (p.images[0]?.src ?? null) : null);
        const score = (status === 'active' ? 2 : 0) + (bySku ? 1 : 0);
        const e = byCodice.get(codice);
        if (!e) {
          byCodice.set(codice, { qty: Number(v.inventory_quantity ?? 0), title: p.title, image: image_url, variant_id: String(v.id), items: [String(v.inventory_item_id)], status, score });
        } else {
          if (!e.items.includes(String(v.inventory_item_id))) e.items.push(String(v.inventory_item_id));
          if (score > e.score) {
            e.qty = Number(v.inventory_quantity ?? 0); e.title = p.title; e.image = image_url;
            e.variant_id = String(v.id); e.status = status; e.score = score;
          }
        }
      }
    }
    const rows = [...byCodice.entries()].map(([codice, e]) => ({
      codice, shopify_qty: e.qty, shopify_title: e.title, image_url: e.image, shopify_status: e.status,
      variant_id: e.variant_id, inventory_item_id: e.items[0], inventory_item_ids: e.items, synced_at: new Date().toISOString(),
    }));
    if (rows.length) await sb.from('shopify_stock').upsert(rows, { onConflict: 'codice' });
    return json({ ok: true, synced: rows.length, products: (products ?? []).length, dual: rows.filter((r) => r.inventory_item_ids.length > 1).length });
  }

  // ---- REALIGN_ALL: push automatico dello stock su Shopify (cron orario, GATED) ----
  // Policy (scelta owner 2026-07-03): SPECCHIO DEL REALE — target = disponibili_da_vendere − buffer
  // (buffer default 0), sia in su che in giù. Il "hold" conservativo del vecchio variant-sync
  // (non alzare senza conta fresca) è ora OPT-IN via app_flags.shopify_hold_raises='true' (default off:
  // con dati puliti Shopify deve rispecchiare lo stock reale). SKU non mappati mai toccati.
  if (action === 'realign_all') {
    const { data: flag } = await sb.from('app_flags').select('value').eq('key', 'shopify_autopush_enabled').maybeSingle();
    if (flag?.value !== 'true') return json({ ok: true, skipped: 'autopush disattivato (shopify_autopush_enabled != true)' });
    const dryRun = body.dryRun === true;

    const { data: locFlag } = await sb.from('app_flags').select('value').eq('key', 'shopify_location_id').maybeSingle();
    const locationId = Number(locFlag?.value || '107986518343');
    const { data: bufFlag } = await sb.from('app_flags').select('value').eq('key', 'shopify_expose_buffer').maybeSingle();
    const buffer = Number(bufFlag?.value ?? '0');
    const { data: holdFlag } = await sb.from('app_flags').select('value').eq('key', 'shopify_hold_raises').maybeSingle();
    const holdRaises = holdFlag?.value === 'true';
    // OPT-IN (default off): se un inventory item è tracked:false, riaccendi il tracking e ritenta. Mai gift card.
    const { data: autoEnFlag } = await sb.from('app_flags').select('value').eq('key', 'shopify_autoenable_tracking').maybeSingle();
    const autoEnableTracking = autoEnFlag?.value === 'true';

    const { data: stock } = await sb.from('shopify_stock').select('codice, shopify_qty, inventory_item_id, inventory_item_ids');
    const { data: inv } = await sb.from('v_inventory').select('codice, disponibili_da_vendere');
    const dispByCod = new Map((inv ?? []).map((r) => [r.codice, Math.max(0, Number(r.disponibili_da_vendere) || 0)]));
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const { data: fresh } = await sb.from('counts').select('codice').gte('data_conta', cutoff);
    const freshSet = new Set((fresh ?? []).map((r) => r.codice));

    let pushed = 0, held = 0, okCount = 0, failed = 0; const actions: Record<string, unknown>[] = []; const unmapped: string[] = []; const failedCodici: string[] = []; const untracked: string[] = [];
    // helper: scrive lo stock su un inventory item; true = Shopify ha accettato
    const setStock = async (item: string, available: number) => (await fetch(`${API}/inventory_levels/set.json`, {
      method: 'POST', headers: SH, body: JSON.stringify({ location_id: locationId, inventory_item_id: Number(item), available }),
    })).ok;
    // helper: diagnosi AUTHORITATIVE via GraphQL (tracked + gift card). Non ci si fida della stringa d'errore REST.
    const itemMeta = async (item: string): Promise<{ tracked: boolean; isGiftCard: boolean } | null> => {
      const r = await fetch(`${API}/graphql.json`, { method: 'POST', headers: SH, body: JSON.stringify({
        query: 'query($id:ID!){inventoryItem(id:$id){tracked variant{product{isGiftCard}}}}', variables: { id: `gid://shopify/InventoryItem/${item}` },
      }) });
      if (!r.ok) return null;
      const it = (await r.json())?.data?.inventoryItem;
      return it ? { tracked: it.tracked === true, isGiftCard: it?.variant?.product?.isGiftCard === true } : null;
    };
    // helper: riaccende il tracking magazzino su un item FISICO (mai gift card: garantito dal chiamante)
    const enableTracking = async (item: string): Promise<boolean> => {
      const r = await fetch(`${API}/graphql.json`, { method: 'POST', headers: SH, body: JSON.stringify({
        query: 'mutation($id:ID!){inventoryItemUpdate(id:$id,input:{tracked:true}){inventoryItem{tracked} userErrors{message}}}', variables: { id: `gid://shopify/InventoryItem/${item}` },
      }) });
      if (!r.ok) return false;
      const res = (await r.json())?.data?.inventoryItemUpdate;
      return res?.inventoryItem?.tracked === true && (!res.userErrors || res.userErrors.length === 0);
    };
    for (const s of stock ?? []) {
      const disp = dispByCod.get(s.codice);
      // SKU Shopify non mappato al catalogo: MAI toccarlo (azzerarlo nasconderebbe un prodotto vivo)
      if (disp === undefined) { unmapped.push(s.codice); continue; }
      const hasFresh = freshSet.has(s.codice);
      const target = Math.max(0, disp - buffer);
      const current = Number(s.shopify_qty) || 0;
      if (target === current) { okCount++; continue; }
      // hold solo se richiesto esplicitamente (modo conservativo): non alzare senza conta fresca
      if (holdRaises && target > current && !hasFresh) { held++; actions.push({ codice: s.codice, azione: 'HOLD (serve conta per alzare)', current, target }); continue; }
      actions.push({ codice: s.codice, azione: dryRun ? 'PUSH (dry)' : 'PUSH', current, target });
      if (dryRun) { pushed++; continue; }
      const items: string[] = (s.inventory_item_ids && s.inventory_item_ids.length) ? s.inventory_item_ids : [s.inventory_item_id].filter(Boolean);
      const failedItems: string[] = [];
      for (const item of items) { if (!(await setStock(item, target))) failedItems.push(item); }
      if (!failedItems.length) {
        pushed++;
        await sb.from('shopify_stock').update({ shopify_qty: target, synced_at: new Date().toISOString() }).eq('codice', s.codice);
      } else {
        // Un set fallito è un GUASTO vero (Shopify a vendere fantasmi, audit B19: NON mascherare) OPPURE una
        // variante con inventory item tracked:false: Shopify rifiuta la scrittura, ma NON è un fallimento, è
        // assenza di tracking magazzino. Lo separiamo nel bucket `untracked` (come `unmapped`) così non
        // maschera i guasti veri né tiene acceso un warn perenne. Dietro flag `shopify_autoenable_tracking`
        // (default off, MAI gift card) riaccendiamo il tracking e ritentiamo. Diagnosi authoritative via GraphQL.
        const stillFailed: string[] = []; let untrackedHere = false;
        for (const item of failedItems) {
          const meta = await itemMeta(item);
          if (meta && !meta.tracked && !meta.isGiftCard) {
            if (autoEnableTracking && (await enableTracking(item)) && (await setStock(item, target))) continue;
            untrackedHere = true;
          } else { stillFailed.push(item); }  // tracked / gift card / diagnosi non disponibile = trattalo come guasto vero
        }
        if (stillFailed.length) { failed++; failedCodici.push(s.codice); }
        else if (untrackedHere) { untracked.push(s.codice); }
        else {
          pushed++;
          await sb.from('shopify_stock').update({ shopify_qty: target, synced_at: new Date().toISOString() }).eq('codice', s.codice);
        }
      }
    }
    const summary = { pushed, held, ok: okCount, failed, failedCodici, untracked, unmapped, dryRun, buffer, actions: actions.slice(0, 40) };
    if (!dryRun) {
      const today = new Date().toISOString().slice(0, 10);
      await sb.from('health_log').delete().eq('day', today).eq('k', 'stock_autopush');
      // severity riflette solo i fallimenti VERI (prima era hardcoded 'ok' -> un push fallito era invisibile, B19).
      // Gli `untracked` sono informativi e NON alzano la severity: niente warn perenne (brief 08-07).
      await sb.from('health_log').insert({ day: today, k: 'stock_autopush', label: `autopush: ${pushed} push, ${held} hold, ${okCount} ok` + (failed ? `, ${failed} FALLITI: ${failedCodici.slice(0, 10).join(', ')}` : '') + (untracked.length ? `, ${untracked.length} untracked: ${untracked.slice(0, 10).join(', ')}` : ''), n: failed, severity: failed > 0 ? 'warn' : 'ok' });
      // logga anche i run con soli fallimenti/untracked (prima: solo pushed||held -> giorni di soli errori senza traccia, brief 08-07)
      if (pushed || held || failed || untracked.length) await sb.from('change_log').insert({ tbl: 'shopify_stock', row_id: 'realign_all', op: 'stock_autopush', after: summary, chi: 'cron', source: 'shopify-stock' });
    }
    return json({ ok: true, ...summary });
  }

  // ---- REALIGN: set Shopify available = gestionale disponibili (GATED) ----
  if (action === 'realign') {
    const { data: flag } = await sb.from('app_flags').select('value').eq('key', 'shopify_write_enabled').single();
    if (flag?.value !== 'true') return json({ error: 'Riallineamento Shopify disattivato (interruttore lato server spento).', gated: true }, 403);

    const codici: string[] = body.codici || [];
    if (!codici.length) return json({ error: 'nessun prodotto selezionato' }, 422);
    // Location is CONFIGURED, not fetched: the token only needs write_inventory (not read_locations).
    // Default = "Punto di ritiro" (the same id variant-sync hardcodes); override via app_flags.shopify_location_id.
    const { data: locFlag } = await sb.from('app_flags').select('value').eq('key', 'shopify_location_id').maybeSingle();
    const locationId = Number(locFlag?.value || '107986518343');

    const { data: stock } = await sb.from('shopify_stock').select('codice, inventory_item_id, inventory_item_ids').in('codice', codici);
    const { data: inv } = await sb.from('v_inventory').select('codice, disponibili_da_vendere').in('codice', codici);
    const target = new Map((inv ?? []).map((r) => [r.codice, Math.max(0, Number(r.disponibili_da_vendere) || 0)]));

    const results: Record<string, unknown>[] = [];
    for (const s of stock ?? []) {
      const available = target.get(s.codice) ?? 0;
      // push to EVERY variant's inventory item (SC + CC share the codice's physical stock)
      const items: string[] = (s.inventory_item_ids && s.inventory_item_ids.length) ? s.inventory_item_ids : [s.inventory_item_id].filter(Boolean);
      let allOk = true; const errs: Record<string, unknown>[] = [];
      for (const item of items) {
        const r = await fetch(`${API}/inventory_levels/set.json`, {
          method: 'POST', headers: SH,
          body: JSON.stringify({ location_id: locationId, inventory_item_id: Number(item), available }),
        });
        if (!r.ok) { allOk = false; errs.push({ item, status: r.status, detail: (await r.text()).slice(0, 120) }); }
      }
      results.push({ codice: s.codice, available, variants: items.length, ok: allOk, ...(allOk ? {} : { errs }) });
      if (allOk) await sb.from('shopify_stock').update({ shopify_qty: available, synced_at: new Date().toISOString() }).eq('codice', s.codice);
    }
    await sb.from('change_log').insert({ tbl: 'shopify_stock', row_id: 'realign', op: 'shopify_realign', after: { results }, chi: body.chi || null, source: 'shopify-stock' });
    return json({ ok: true, realigned: results.filter((r) => r.ok).length, results });
  }

  return json({ error: 'azione sconosciuta' }, 400);
});
