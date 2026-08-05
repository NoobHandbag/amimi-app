// shopify-stock — THIRD FLOW. READ-ONLY pull of Shopify variant inventory into shopify_stock,
// plus a GATED realign (sets Shopify available = gestionale "disponibili") behind
// app_flags.shopify_write_enabled. Token in app_config (service-role). PIN-gated.
//
// 2026-08-05 (brief varianti divergenti 04-08, migr 0106): l'autopush guarda ora la quantita' di
// OGNI inventory item (`item_qtys`), non piu' il solo `shopify_qty` collassato sulla variante
// "migliore". Il difetto chiuso: un codice puo' avere piu' item (48 codici / 109 item), il mirror
// ne teneva UNA quantita', e `if (target === current) continue` bastava a saltare l'intero codice
// quando la rappresentante era allineata — lasciando una sorella alla deriva vendibile per sempre,
// perche' l'unica cosa che l'avrebbe riparata era proprio la push saltata. Caso reale: AGATA BAG
// FLORAL BORDEAUX EMBROIDERY acquistabile con giacenza 0 mentre health_log scriveva "136 ok". Non
// era una regressione della v15: il collasso nasce in 57b20e3 (06-07), la scorciatoia in 69ffa6e
// (03-07). Nuovo bucket `divergenti` accanto a `untracked`/`unmapped`: il caso si vede invece di
// sparire dentro `ok`. Regola Ferrea 15 invariata (writer unico, push gated dai flag).
//
// 2026-08-01 (brief cs_assist_migliorie punto 5): lo stesso pull alimenta ora anche
// `shopify_catalog` (handle della scheda + on_shopify), che fino a ieri era un seed del 24-06 mai
// piu' aggiornato. Da quando `cs-assist` ci costruisce sopra il link alla scheda prodotto per le
// risposte alle clienti, una tabella ferma e' un problema che si vede: 67 handle su 99 prodotti, e
// in peggioramento a ogni prodotto nuovo. Il pull di products.json c'era gia': serviva solo
// chiedere un campo in piu' e scrivere quello che si e' visto. Nessuno scope Shopify nuovo,
// nessuna chiamata in piu', e lo STOCK non cambia di una virgola (Regola Ferrea 15: il writer
// unico resta questo, e verso Shopify continua a scrivere solo il realign gated).
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
  // estratto in helper cosi' l'azione on-demand `sync_now` puo' rieseguire lo stesso identico giro.
  // `who` = attore per l'audit del prune in change_log ('cron' per i giri schedulati).
  const doSync = async (who = 'cron') => {
    const { data: al } = await sb.from('product_aliases').select('shopify_name_norm, codice');
    const aliasMap = new Map((al ?? []).map((r) => [r.shopify_name_norm, r.codice]));
    const { data: prods } = await sb.from('products').select('codice, codice_norm');
    const byNorm = new Map((prods ?? []).map((r) => [r.codice_norm, r.codice]));

    // Pull con PAGINAZIONE cursor-based (brief 23-07): products.json e' cappato a 250 prodotti
    // per pagina — la singola fetch troncava in silenzio oltre i 250 (mirror gia' a 245 codici).
    // Si segue rel="next" nell'header Link finche' c'e'. Una pagina fallita aborta TUTTO il giro
    // (niente upsert ne' prune su un pull parziale); cap di sicurezza anti-loop, MAI silenzioso.
    // deno-lint-ignore no-explicit-any
    const products: any[] = [];
    let pageUrl: string | null = `${API}/products.json?limit=250&fields=id,title,handle,status,image,images,variants`;
    let pages = 0;
    while (pageUrl) {
      if (++pages > 20) return { error: 'Shopify: oltre 20 pagine di prodotti, pull abortito (cap di sicurezza)', status: 502 };
      const resp = await fetch(pageUrl, { headers: SH });
      if (!resp.ok) return { error: 'Shopify ' + resp.status, detail: (await resp.text()).slice(0, 200), status: 502 };
      const page = await resp.json();
      products.push(...(page.products ?? []));
      const next = (resp.headers.get('link') ?? '').match(/<([^>]+)>;\s*rel="next"/);
      pageUrl = next ? next[1] : null;
    }

    // Group ALL variant inventory items per codice: dual-variant bags (SC/CC "Senza/Con Catena")
    // share ONE codice via the product-title alias — both inventory items must be kept and realigned.
    // Quando PIU' prodotti Shopify mappano allo stesso codice (es. il doppione ritirato "DARK LEOPARD
    // PONY" in bozza + la "SAVANA" attiva), titolo/immagine/status vengono dal MIGLIORE:
    // attivo batte bozza/archiviato, SKU esatto batte l'alias sul titolo (feedback 06-07, item 19).
    // `qtys` (migr 0106): la quantita' di OGNI inventory item, non solo della variante rappresentante.
    // `qty` resta il numero "collassato" della migliore (lo leggono UI e viste), ma non e' piu' il dato
    // su cui realign_all decide la push: bastava che la rappresentante fosse allineata perche' una
    // sorella alla deriva restasse invisibile per sempre (brief varianti divergenti 04-08).
    const byCodice = new Map<string, { qty: number; title: string; handle: string | null; image: string | null; variant_id: string; items: string[]; qtys: Record<string, number>; status: string; score: number }>();
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
        const itemId = String(v.inventory_item_id);
        const itemQty = Number(v.inventory_quantity ?? 0);
        if (!e) {
          byCodice.set(codice, { qty: itemQty, title: p.title, handle: p.handle ?? null, image: image_url, variant_id: String(v.id), items: [itemId], qtys: { [itemId]: itemQty }, status, score });
        } else {
          if (!e.items.includes(itemId)) e.items.push(itemId);
          e.qtys[itemId] = itemQty;
          if (score > e.score) {
            e.qty = itemQty; e.title = p.title; e.handle = p.handle ?? null; e.image = image_url;
            e.variant_id = String(v.id); e.status = status; e.score = score;
          }
        }
      }
    }
    const rows = [...byCodice.entries()].map(([codice, e]) => ({
      codice, shopify_qty: e.qty, shopify_title: e.title, image_url: e.image, shopify_status: e.status,
      variant_id: e.variant_id, inventory_item_id: e.items[0], inventory_item_ids: e.items, item_qtys: e.qtys,
      synced_at: new Date().toISOString(),
    }));
    let pruned = 0;
    if (rows.length) {
      await sb.from('shopify_stock').upsert(rows, { onConflict: 'codice' });
      // PRUNE (brief 23-07): il mirror e' lo SPECCHIO di Shopify — una riga non piu' vista nel
      // pull va rimossa (prodotto eliminato da Shopify), altrimenti resta per sempre con
      // synced_at congelato e, se era active, tiene on_shopify=true in v_inventory (caso
      // ANNIE_BAG_SILK_BROWN, 23 righe ferme al 06-07). Qui si arriva SOLO a pull completo e
      // non vuoto, quindi "non vista" = davvero assente, non un pull parziale. Tocca solo la
      // tabella mirror, mai Shopify (Regola Ferrea 15 invariata: unico stock writer, push gated).
      const { data: existing } = await sb.from('shopify_stock').select('codice');
      const gone = (existing ?? []).map((r) => r.codice as string).filter((c) => !byCodice.has(c));
      if (gone.length) {
        await sb.from('shopify_stock').delete().in('codice', gone);
        await sb.from('change_log').insert({ tbl: 'shopify_stock', row_id: 'sync', op: 'stock_prune', after: { pruned: gone.length, codici: gone.slice(0, 40) }, chi: who, source: 'shopify-stock' });
        pruned = gone.length;
      }
    }

    // CATALOGO (01-08): stesso pull, stesse regole del mirror sopra. `shopify_catalog` da' a
    // cs-assist l'handle con cui costruisce il link alla scheda nelle risposte alle clienti, e
    // fino a ieri era un seed del 24-06 che nessuno aggiornava. Solo i codici con un handle: senza
    // handle non c'e' URL, e un URL inventato finirebbe in una mail (Regola 1). `on_shopify` e' vera
    // solo per le schede `active`: linkare una bozza manda la cliente su una pagina che non esiste.
    let catalogo = 0, catalogoPruned = 0;
    if (rows.length) {
      const cat = [...byCodice.entries()]
        .filter(([, e]) => !!e.handle)
        .map(([codice, e]) => ({ codice, handle: e.handle, on_shopify: e.status === 'active', synced_at: new Date().toISOString() }));
      if (cat.length) {
        await sb.from('shopify_catalog').upsert(cat, { onConflict: 'codice' });
        // Prune con la stessa logica dello stock: ci si arriva solo a pull completo e non vuoto,
        // quindi "non vista" vuol dire davvero assente. Toglie anche le righe del vecchio seed che
        // avevano una grafia diversa dal codice canonico, senza lasciare doppioni case-insensitive.
        const vivi = new Set(cat.map((c) => c.codice));
        const { data: esistenti } = await sb.from('shopify_catalog').select('codice');
        const via = (esistenti ?? []).map((r) => r.codice as string).filter((c) => !vivi.has(c));
        if (via.length) {
          await sb.from('shopify_catalog').delete().in('codice', via);
          catalogoPruned = via.length;
        }
        catalogo = cat.length;
        if (catalogoPruned) await sb.from('change_log').insert({ tbl: 'shopify_catalog', row_id: 'sync', op: 'catalog_prune', after: { pruned: catalogoPruned, codici: via.slice(0, 40) }, chi: who, source: 'shopify-stock' });
      }
    }

    return { ok: true, synced: rows.length, pruned, catalogo, catalogoPruned, pages, products: products.length, dual: rows.filter((r) => r.inventory_item_ids.length > 1).length };
  };
  if (action === 'sync') { const r = await doSync() as { status?: number }; return json(r, r.status ?? 200); }

  // ---- REALIGN_ALL: push automatico dello stock su Shopify (cron orario, GATED) ----
  // Policy (scelta owner 2026-07-03): SPECCHIO DEL REALE — target = disponibili_da_vendere − buffer
  // (buffer default 0), sia in su che in giù. Il "hold" conservativo del vecchio variant-sync
  // (non alzare senza conta fresca) è ora OPT-IN via app_flags.shopify_hold_raises='true' (default off:
  // con dati puliti Shopify deve rispecchiare lo stock reale). SKU non mappati mai toccati.
  // estratto in helper (who = attore per l'audit: 'cron' o l'utente); sync_now lo richiama a valle di doSync.
  const doRealignAll = async (dryRun: boolean, who: string) => {
    const { data: flag } = await sb.from('app_flags').select('value').eq('key', 'shopify_autopush_enabled').maybeSingle();
    if (flag?.value !== 'true') return { ok: true, skipped: 'autopush disattivato (shopify_autopush_enabled != true)' };

    const { data: locFlag } = await sb.from('app_flags').select('value').eq('key', 'shopify_location_id').maybeSingle();
    const locationId = Number(locFlag?.value || '107986518343');
    const { data: bufFlag } = await sb.from('app_flags').select('value').eq('key', 'shopify_expose_buffer').maybeSingle();
    const buffer = Number(bufFlag?.value ?? '0');
    const { data: holdFlag } = await sb.from('app_flags').select('value').eq('key', 'shopify_hold_raises').maybeSingle();
    const holdRaises = holdFlag?.value === 'true';
    // OPT-IN (default off): se un inventory item è tracked:false, riaccendi il tracking e ritenta. Mai gift card.
    const { data: autoEnFlag } = await sb.from('app_flags').select('value').eq('key', 'shopify_autoenable_tracking').maybeSingle();
    const autoEnableTracking = autoEnFlag?.value === 'true';

    const { data: stock } = await sb.from('shopify_stock').select('codice, shopify_qty, inventory_item_id, inventory_item_ids, item_qtys');
    const { data: inv } = await sb.from('v_inventory').select('codice, disponibili_da_vendere');
    const dispByCod = new Map((inv ?? []).map((r) => [r.codice, Math.max(0, Number(r.disponibili_da_vendere) || 0)]));
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const { data: fresh } = await sb.from('counts').select('codice').gte('data_conta', cutoff);
    const freshSet = new Set((fresh ?? []).map((r) => r.codice));

    let pushed = 0, held = 0, okCount = 0, failed = 0; const actions: Record<string, unknown>[] = []; const unmapped: string[] = []; const failedCodici: string[] = []; const untracked: string[] = []; const divergenti: string[] = [];
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
      const items: string[] = (s.inventory_item_ids && s.inventory_item_ids.length) ? s.inventory_item_ids : [s.inventory_item_id].filter(Boolean);
      // ALLINEATO = OGNI inventory item e' a target, non solo la variante rappresentante (migr 0106).
      // Prima si confrontava il solo `shopify_qty` collassato: se la rappresentante coincideva col
      // gestionale il codice era contato `ok` e non si scriveva su NESSUN item, quindi una sorella
      // alla deriva (es. SC a 0 e CC a 1) restava vendibile per sempre e non si riparava mai da
      // sola, perche' l'unica cosa che l'avrebbe sistemata era saltata proprio da quel confronto.
      // `item_qtys` NULL = riga mai ri-sincronizzata dopo la 0106: si ricade sul confronto vecchio,
      // mai peggio di prima, e si ripara al primo `sync`.
      const qtys = s.item_qtys as Record<string, number> | null;
      const perItem = (qtys && items.length) ? items.map((it) => Number(qtys[it])) : null;
      const perItemNoto = !!perItem && perItem.every((q) => Number.isFinite(q));
      const allineato = perItemNoto ? perItem!.every((q) => q === target) : current === target;
      if (allineato) { okCount++; continue; }
      // DIVERGENTI: il numero collassato diceva "a posto" ma un item sorella no. Sono ESATTAMENTE le
      // righe che il codice vecchio saltava in silenzio: si riportano a parte (come `untracked` e
      // `unmapped`) perche' il caso si veda invece di sparire dentro `ok`. Non alzano la severity:
      // la push che segue li sistema nello stesso giro; se fallisce, e' `failed` e quello alza warn.
      if (current === target) divergenti.push(s.codice);
      // hold solo se richiesto esplicitamente (modo conservativo): non alzare senza conta fresca
      if (holdRaises && target > current && !hasFresh) { held++; actions.push({ codice: s.codice, azione: 'HOLD (serve conta per alzare)', current, target }); continue; }
      actions.push({ codice: s.codice, azione: dryRun ? 'PUSH (dry)' : 'PUSH', current, target, ...(perItemNoto ? { items_qty: perItem } : {}) });
      if (dryRun) { pushed++; continue; }
      const failedItems: string[] = [];
      for (const item of items) { if (!(await setStock(item, target))) failedItems.push(item); }
      if (!failedItems.length) {
        pushed++;
        // anche `item_qtys`: dopo una push riuscita OGNI item e' a target. Senza questo aggiornamento
        // il giro dopo rileggerebbe le quantita' vecchie, ri-vedrebbe la divergenza e ripusherebbe
        // ogni ora, tenendo acceso `divergenti` per sempre su un caso gia' risolto.
        await sb.from('shopify_stock').update({ shopify_qty: target, item_qtys: Object.fromEntries(items.map((it) => [it, target])), synced_at: new Date().toISOString() }).eq('codice', s.codice);
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
          // anche `item_qtys`, come sopra: senza, il giro dopo rileggerebbe le quantita' vecchie e
          // ripusherebbe ogni ora tenendo acceso `divergenti` su un caso gia' risolto.
          await sb.from('shopify_stock').update({ shopify_qty: target, item_qtys: Object.fromEntries(items.map((it) => [it, target])), synced_at: new Date().toISOString() }).eq('codice', s.codice);
        }
      }
    }
    const summary = { pushed, held, ok: okCount, failed, failedCodici, untracked, unmapped, divergenti, dryRun, buffer, actions: actions.slice(0, 40) };
    if (!dryRun) {
      const today = new Date().toISOString().slice(0, 10);
      await sb.from('health_log').delete().eq('day', today).eq('k', 'stock_autopush');
      // severity riflette solo i fallimenti VERI (prima era hardcoded 'ok' -> un push fallito era invisibile, B19).
      // Gli `untracked` sono informativi e NON alzano la severity: niente warn perenne (brief 08-07).
      await sb.from('health_log').insert({ day: today, k: 'stock_autopush', label: `autopush: ${pushed} push, ${held} hold, ${okCount} ok` + (failed ? `, ${failed} FALLITI: ${failedCodici.slice(0, 10).join(', ')}` : '') + (untracked.length ? `, ${untracked.length} untracked: ${untracked.slice(0, 10).join(', ')}` : '') + (divergenti.length ? `, ${divergenti.length} divergenti (varianti sorelle non allineate): ${divergenti.slice(0, 10).join(', ')}` : ''), n: failed, severity: failed > 0 ? 'warn' : 'ok' });
      // logga anche i run con soli fallimenti/untracked/divergenti (prima: solo pushed||held -> giorni di soli errori senza traccia, brief 08-07)
      if (pushed || held || failed || untracked.length || divergenti.length) await sb.from('change_log').insert({ tbl: 'shopify_stock', row_id: 'realign_all', op: 'stock_autopush', after: summary, chi: who, source: 'shopify-stock' });
    }
    return { ok: true, ...summary };
  };
  if (action === 'realign_all') return json(await doRealignAll(body.dryRun === true, 'cron'));

  // ---- SYNC_NOW: giro completo on-demand (sync -> realign_all), come i cron :17 + :27 ma a comando ----
  // Regola Ferrea 15: unico writer stock = questa edge. Nessun segreto nel client (PIN 'x' gia' usato
  // ovunque). Audit `chi` in change_log. Cooldown server-side anti doppio-click: se un sync_now e' girato
  // negli ultimi 45s, salta (i click ravvicinati spawnano run parallele; realign_all e' idempotente ma
  // cosi' non raddoppiamo le chiamate API Shopify). Il mirror e' gia' aggiornato inline da realign_all
  // per i codici pushati, quindi non serve un secondo sync a valle.
  if (action === 'sync_now') {
    const who = body.chi || 'app';
    if (body.force !== true) {
      const since = new Date(Date.now() - 45000).toISOString();
      const { data: recent } = await sb.from('change_log').select('id').eq('op', 'stock_sync_now').gte('ts', since).limit(1);
      if (recent && recent.length) return json({ ok: true, skipped: 'cooldown', cooldown_s: 45 });
    }
    const sync1 = await doSync(who) as Record<string, unknown>;
    // se il pull Shopify fallisce, aborta il giro (non riallineare su un mirror stantio)
    if (sync1.error) return json(sync1, (sync1.status as number) ?? 502);
    const realign = await doRealignAll(false, who) as Record<string, unknown>;
    await sb.from('change_log').insert({
      tbl: 'shopify_stock', row_id: 'sync_now', op: 'stock_sync_now',
      after: { synced: sync1.synced, pruned: sync1.pruned ?? null, pushed: realign.pushed ?? null, held: realign.held ?? null, ok: realign.ok ?? null, failed: realign.failed ?? null, untracked: realign.untracked ?? null, unmapped: realign.unmapped ?? null, divergenti: realign.divergenti ?? null, skipped: realign.skipped ?? null },
      chi: who, source: 'shopify-stock',
    });
    return json({ ok: true, sync: sync1, realign });
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
      // `item_qtys` come nell'autopush (migr 0106): dopo una push riuscita ogni item e' ad `available`.
      if (allOk) await sb.from('shopify_stock').update({ shopify_qty: available, item_qtys: Object.fromEntries(items.map((it) => [it, available])), synced_at: new Date().toISOString() }).eq('codice', s.codice);
    }
    await sb.from('change_log').insert({ tbl: 'shopify_stock', row_id: 'realign', op: 'shopify_realign', after: { results }, chi: body.chi || null, source: 'shopify-stock' });
    return json({ ok: true, realigned: results.filter((r) => r.ok).length, results });
  }

  return json({ error: 'azione sconosciuta' }, 400);
});
