// write-api — the ONLY write path into the replica.
// Public anon key is read-only (writes revoked). PIN-gated; uses the service-role key to write,
// logging every change to change_log. Handles inserts + the special flows (arrival, multi-order,
// product verification, expenses, sale correction).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const TABLES: Record<string, string> = {
  purchase: 'purchases', gift: 'gifts_offline', b2b: 'b2b_movements',
  product: 'products', order: 'supplier_orders',
};
const noSpaces = (s: unknown) => typeof s === 'string' && s.length > 0 && !/\s/.test(s);

function validate(action: string, p: Record<string, unknown>): string[] {
  const e: string[] = [];
  const codice = p.codice as string | undefined;
  const reqCodice = () => {
    if (!codice) e.push('CODICE mancante');
    else if (!noSpaces(codice)) e.push('CODICE contiene spazi — usa underscore');
  };
  const qty = Number(p.quantita);
  if (action === 'purchase') {
    reqCodice();
    if (!(qty > 0)) e.push('quantità deve essere > 0');
    if (p.costo_unitario != null && Number(p.costo_unitario) < 0) e.push('costo unitario negativo');
    if (!p.data) e.push('data mancante');
  } else if (action === 'count') {
    reqCodice();
    if (p.contati == null || Number(p.contati) < 0) e.push('pezzi contati non validi');
  } else if (action === 'gift') {
    reqCodice();
    if (!(qty > 0)) e.push('quantità deve essere > 0');
  } else if (action === 'b2b') {
    reqCodice();
    if (!(qty > 0)) e.push('quantità deve essere > 0');
    if (!['invio', 'reso', 'venduto'].includes(String(p.tipo_movimento))) e.push('tipo_movimento non valido');
    if (!['conto_vendita', 'wholesale'].includes(String(p.modello))) e.push('modello non valido');
  } else if (action === 'product') {
    reqCodice();
    if (codice && /_$/.test(codice)) e.push('CODICE non finalizzato (termina con _)');
  } else if (action === 'order') {
    reqCodice();
    if (!(Number(p.qty_ordered) > 0)) e.push('quantità ordinata deve essere > 0');
  }
  return e;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: { action?: string; payload?: Record<string, unknown>; pin?: string; chi?: string };
  try { body = await req.json(); } catch { return json({ error: 'JSON non valido' }, 400); }
  const { action = '', payload = {}, pin = '', chi = '' } = body;

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg } = await sb.from('app_config').select('pin_hash').eq('id', 1).single();
  const ok = cfg?.pin_hash && pin && (await sha256hex(String(pin))) === cfg.pin_hash;
  if (!ok) return json({ error: 'PIN errato' }, 401);

  const today = new Date().toISOString().slice(0, 10);
  const logp = (tbl: string, row_id: string, op: string, after: unknown) =>
    sb.from('change_log').insert({ tbl, row_id, op, after, chi: chi || null, source: 'write-api' });

  // --- FLOW 1: mark an arrival against a supplier order (date editable) ---
  if (action === 'arrival') {
    const oid = payload.order_id as string;
    const qty = Number(payload.qty);
    const arrDate = (payload.data as string) || today;
    if (!oid || !(qty > 0)) return json({ error: 'arrivo non valido' }, 422);
    const { data: ord } = await sb.from('supplier_orders').select('*').eq('id', oid).single();
    if (!ord) return json({ error: 'ordine non trovato' }, 404);
    const newArr = Number(ord.qty_arrived) + qty;
    const { error: ue } = await sb.from('supplier_orders').update({ qty_arrived: newArr, data_ultimo_arrivo: arrDate }).eq('id', oid);
    if (ue) return json({ error: ue.message }, 400);
    const { data: pur } = await sb.from('purchases').insert({
      codice: ord.codice, item: ord.item, variant: ord.variant, categoria: 'BAG',
      tipologia: 'Prodotto Finito', unita_misura: 'Pezzi', quantita: qty, data: arrDate,
      costo_unitario: ord.costo_unitario ?? null, fornitore: ord.fornitore, source: 'app-arrivo', chi: chi || null,
    }).select().single();
    await logp('supplier_orders', String(oid), 'arrival', { codice: ord.codice, qty, arrived: newArr, data: arrDate });
    return json({ ok: true, arrived: newArr, ordered: ord.qty_ordered, purchase_id: pur?.id });
  }

  // --- FLOW 1b: SET the arrived total (edit/correct a registered arrival). Adjusts stock by the delta. ---
  if (action === 'arrival_set') {
    const oid = payload.order_id as string;
    const target = Number(payload.qty);
    const arrDate = (payload.data as string) || today;
    if (!oid || isNaN(target) || target < 0) return json({ error: 'valore arrivo non valido' }, 422);
    const { data: ord } = await sb.from('supplier_orders').select('*').eq('id', oid).single();
    if (!ord) return json({ error: 'ordine non trovato' }, 404);
    const current = Number(ord.qty_arrived) || 0;
    const delta = target - current;
    const { error: ue } = await sb.from('supplier_orders').update({ qty_arrived: target, data_ultimo_arrivo: arrDate }).eq('id', oid);
    if (ue) return json({ error: ue.message }, 400);
    if (delta !== 0) await sb.from('purchases').insert({
      codice: ord.codice, item: ord.item, variant: ord.variant, categoria: 'BAG',
      tipologia: 'Prodotto Finito', unita_misura: 'Pezzi', quantita: delta, data: arrDate,
      costo_unitario: ord.costo_unitario ?? null, fornitore: ord.fornitore, source: 'app-arrivo-edit', chi: chi || null,
    });
    await logp('supplier_orders', String(oid), 'arrival_set', { codice: ord.codice, target, delta, data: arrDate });
    return json({ ok: true, arrived: target, ordered: ord.qty_ordered });
  }

  // --- FLOW 1: create a multi-bag supplier order (one gruppo, N lines) ---
  if (action === 'order_multi') {
    const fornitore = String(payload.fornitore || '').trim();
    const righe = (payload.righe as Record<string, unknown>[]) || [];
    const dataOrdine = (payload.data_ordine as string) || today;
    if (!fornitore) return json({ error: 'fornitore mancante' }, 422);
    if (!righe.length) return json({ error: 'nessuna riga' }, 422);
    const gruppo = crypto.randomUUID();
    const rows = righe.map((r) => ({
      gruppo, fornitore, data_ordine: dataOrdine,
      codice: String(r.codice || ''), item: (r.item as string) ?? null, variant: (r.variant as string) ?? null,
      qty_ordered: Number(r.qty_ordered) || 0, qty_arrived: 0,
      nuovo_riordino: (r.nuovo_riordino as string) ?? null,
      costo_unitario: r.costo_unitario != null ? Number(r.costo_unitario) : null,
      data_consegna: (r.data_consegna as string) ?? null, note: (r.note as string) ?? null,
      source: 'app', chi: chi || null,
    })).filter((r) => r.codice && r.qty_ordered > 0);
    if (!rows.length) return json({ error: 'righe non valide (CODICE + quantità)' }, 422);
    const { data, error } = await sb.from('supplier_orders').insert(rows).select();
    if (error) return json({ error: error.message }, 400);
    // Create product stubs for bags not yet in the catalog, so they surface in FLOW 2 (verifica).
    const codici = [...new Set(rows.map((r) => r.codice))];
    const { data: existing } = await sb.from('products').select('codice').in('codice', codici);
    const have = new Set((existing || []).map((e: { codice: string }) => e.codice));
    const seen = new Set<string>();
    const stubs = rows.filter((r) => !have.has(r.codice) && !seen.has(r.codice) && seen.add(r.codice)).map((r) => ({
      codice: r.codice, item: r.item, model: r.item, variant: r.variant,
      categoria: 'BAG', verificato: false, status: 'nuovo', source: 'app-ordine', chi: chi || null,
    }));
    if (stubs.length) await sb.from('products').upsert(stubs, { onConflict: 'codice', ignoreDuplicates: true });
    await logp('supplier_orders', gruppo, 'order_multi', { fornitore, righe: rows.length, gruppo, stubs: stubs.length });
    return json({ ok: true, gruppo, lines: data?.length ?? 0, stubs: stubs.length });
  }

  // --- FLOW 2: verify / complete a product's details (Benedetta) ---
  if (action === 'product_verify') {
    const codice = String(payload.codice || '');
    if (!codice) return json({ error: 'CODICE mancante' }, 422);
    const upd: Record<string, unknown> = { verificato: true, updated_at: new Date().toISOString() };
    for (const f of ['item', 'variant', 'categoria', 'image_url', 'description', 'seo_title']) {
      if (payload[f] != null && String(payload[f]).trim() !== '') upd[f] = payload[f];
    }
    if (payload.retail_price != null && payload.retail_price !== '') upd.retail_price = Number(payload.retail_price);
    const { data, error } = await sb.from('products').update(upd).eq('codice', codice).select().single();
    if (error) return json({ error: error.message }, 400);
    await logp('products', String(data.id), 'product_verify', upd);
    return json({ ok: true, codice });
  }

  // --- FLOW 4/5: expenses (manual=approved, proposta=pending, approve/reject) ---
  if (action === 'expense_manual' || action === 'expense_propose') {
    const costoRaw = Number(payload.costo);
    if (!Number.isFinite(costoRaw) || costoRaw === 0) return json({ error: 'importo non valido' }, 422);
    const categoria = String(payload.categoria || '').toUpperCase();
    const VALID = ['COGS', 'LOGISTICA', 'MARKETING', 'OPEX', 'PACKAGING', 'SALARI', 'TASSE'];
    const datePaid = (payload.date_paid as string) || today;
    const d = new Date(datePaid);
    const row = {
      year: d.getFullYear(), month: d.getMonth() + 1, date_reported: datePaid, date_paid: datePaid,
      operazione: String(payload.operazione || '').trim() || 'Spesa', costo: -Math.abs(costoRaw),
      categoria, sottocategoria: (payload.sottocategoria as string) ?? null,
      amimi_raw: (payload.amimi === true || payload.amimi === 'si') ? 'si' : 'No',
      note: (payload.note as string) ?? null, source: 'app', chi: chi || null,
      status: action === 'expense_manual' ? 'approved' : 'pending',
      proposed_by: chi || null, approved_by: action === 'expense_manual' ? (chi || null) : null,
    };
    const { data, error } = await sb.from('expenses').insert(row).select().single();
    if (error) return json({ error: error.message }, 400);
    await logp('expenses', String(data.id), action, data);
    return json({ ok: true, id: data.id, status: row.status });
  }
  if (action === 'expense_approve') {
    const id = String(payload.id || '');
    const decision = String(payload.status || 'approved');
    if (!id) return json({ error: 'id mancante' }, 422);
    const upd: Record<string, unknown> = { status: decision === 'rejected' ? 'rejected' : 'approved', approved_by: chi || null };
    const edits = (payload.edits as Record<string, unknown>) || {};
    for (const f of ['operazione', 'categoria', 'sottocategoria', 'note']) if (edits[f] != null) upd[f] = edits[f];
    if (edits.costo != null) upd.costo = -Math.abs(Number(edits.costo));
    if (edits.amimi != null) { upd.amimi_raw = (edits.amimi === true || edits.amimi === 'si') ? 'si' : 'No'; }
    const { data, error } = await sb.from('expenses').update(upd).eq('id', id).select().single();
    if (error) return json({ error: error.message }, 400);
    await logp('expenses', id, 'expense_approve', upd);
    return json({ ok: true, id, status: upd.status });
  }

  // --- SECOND FLOW: reassign a sale to the real product (inventory follows automatically) ---
  if (action === 'sale_correct') {
    const src = String(payload.source || '');
    const id = String(payload.id || '');
    const newCodice = String(payload.new_codice || '');
    if (!id || !newCodice) return json({ error: 'vendita o prodotto mancante' }, 422);
    const isShop = src === 'shopify';
    const tbl = isShop ? 'shopify_line_items' : 'qromo_sales';
    const { data: before } = await sb.from(tbl).select('*').eq('id', id).single();
    if (!before) return json({ error: 'vendita non trovata' }, 404);
    // qromo_sales has item/variant columns; shopify_line_items does not (only codice + lineitem_name)
    const upd: Record<string, unknown> = isShop
      ? { codice: newCodice, resolved: true }
      : {
          codice: newCodice,
          item: (payload.new_item as string) ?? before.item ?? null,
          variant: (payload.new_variant as string) ?? before.variant ?? null,
        };
    const { error } = await sb.from(tbl).update(upd).eq('id', id);
    if (error) return json({ error: error.message }, 400);
    await logp(tbl, id, 'sale_correct', { from: before.codice, to: newCodice });
    return json({ ok: true, from: before.codice, to: newCodice, shopify_stock_pending: true });
  }

  // --- NEW: returns & exchanges (records money + stock effect) ---
  if (action === 'return') {
    const codice = String(payload.codice || '');
    const qty = Number(payload.quantita);
    if (!codice) return json({ error: 'CODICE mancante' }, 422);
    if (!noSpaces(codice)) return json({ error: 'CODICE contiene spazi' }, 422);
    if (!(qty > 0)) return json({ error: 'quantità deve essere > 0' }, 422);
    const dt = (payload.data as string) || today;
    const d = new Date(dt);
    const row = {
      data: dt, year: d.getFullYear(), month: d.getMonth() + 1,
      codice, item: (payload.item as string) ?? null, variant: (payload.variant as string) ?? null,
      quantita: qty, canale: (payload.canale as string) ?? null,
      importo_rimborsato: payload.importo_rimborsato != null ? Math.abs(Number(payload.importo_rimborsato)) : 0,
      rientra_stock: payload.rientra_stock !== false,
      motivo: (payload.motivo as string) ?? null, sostituito_con: (payload.sostituito_con as string) ?? null,
      note: (payload.note as string) ?? null, source: 'app', chi: chi || null,
    };
    const { data, error } = await sb.from('returns').insert(row).select().single();
    if (error) return json({ error: error.message }, 400);
    await logp('returns', String(data.id), 'return', data);
    return json({ ok: true, id: data.id, rientra_stock: row.rientra_stock });
  }

  // --- Qromo forward: a resolved DB_QROMO row pushed from the Apps Script sync (idempotent on sale_id) ---
  if (action === 'qromo_sale') {
    const codice = String(payload.codice || '');
    const qty = Number(payload.quantita);
    const saleId = (payload.sale_id as string) || null;
    if (!codice) return json({ error: 'CODICE mancante' }, 422);
    if (!(qty > 0)) return json({ error: 'quantità deve essere > 0' }, 422);
    if (saleId) {
      const { data: ex } = await sb.from('qromo_sales').select('id').eq('sale_id', saleId).limit(1);
      if (ex && ex.length) return json({ ok: true, skipped: true, sale_id: saleId });
    }
    const dt = (payload.data as string) || today;
    const d = new Date(dt);
    const row = {
      sale_id: saleId, order_id: (payload.order_id as string) ?? null, data: dt,
      year: d.getFullYear(), month: d.getMonth() + 1,
      nome: (payload.nome as string) ?? null, cognome: (payload.cognome as string) ?? null,
      codice, item: (payload.item as string) ?? null, variant: (payload.variant as string) ?? null,
      quantita: qty, payment_method: (payload.payment_method as string) ?? null,
      prezzo: payload.prezzo != null ? Number(payload.prezzo) : null,
      cogs: payload.cogs != null ? Number(payload.cogs) : null,
      resolver_status: (payload.resolver_status as string) ?? 'forwarded',
      source: 'qromo-forward', note: (payload.note as string) ?? null,
    };
    // fallback COGS: il forwarder non sempre lo manda -> snapshot dal listino (products).
    // Trovato dalla ce-guard 03-07: 5 vendite di luglio senza COGS.
    if (row.cogs == null && codice) {
      const cn = codice.toUpperCase().replace(/\s+/g, '_');
      const { data: pr } = await sb.from('products').select('cogs').eq('codice_norm', cn).maybeSingle();
      if (pr?.cogs != null) row.cogs = Number(pr.cogs);
    }
    const { data, error } = await sb.from('qromo_sales').insert(row).select().single();
    if (error) return json({ error: error.message }, 400);
    await logp('qromo_sales', String(data.id), 'qromo_sale', { sale_id: saleId, codice, qty });
    return json({ ok: true, id: data.id });
  }

  // --- COUNT: a physical count is applied as a stock rectification (Approccio 1) ---
  // The count row stays the audit log; if it differs from the live giacenza we write an
  // adjustment of exactly (contati - giacenza_live), so v_inventory shows == contati.
  if (action === 'count') {
    const codice = String(payload.codice || '');
    const contati = Number(payload.contati);
    if (!codice || !noSpaces(codice)) return json({ error: 'CODICE mancante o con spazi' }, 422);
    if (isNaN(contati) || contati < 0) return json({ error: 'pezzi contati non validi' }, 422);
    const dt = (payload.data_conta as string) || today;
    // recompute the delta SERVER-SIDE against the live giacenza (which already includes prior
    // adjustments) — never trust the client snapshot, so re-counts converge instead of stacking.
    // NB: a failed read MUST abort, otherwise giacLive would silently fall back to 0 for an
    // existing product and write a bogus full-stock adjustment. null-with-no-error = genuinely
    // new product (baseline 0). No per-codice lock: assumes counts of the same SKU aren't truly
    // concurrent (single shop + UI busy-guard); a later re-count self-heals any double-apply.
    const { data: invRow, error: re } = await sb.from('v_inventory').select('giacenza_attuale').eq('codice', codice).maybeSingle();
    if (re) return json({ error: 'lettura giacenza fallita: ' + re.message }, 400);
    const giacLive = Number(invRow?.giacenza_attuale ?? 0);
    const delta = contati - giacLive;
    const { data: cnt, error: ce } = await sb.from('counts').insert({
      codice, modello: (payload.modello as string) ?? null, variante: (payload.variante as string) ?? null,
      contati, giac_snapshot: giacLive, delta, data_conta: dt,
      nota: (payload.nota as string) ?? null, stato: delta === 0 ? 'combacia' : 'applicata',
      source: 'app', chi: chi || null,
    }).select().single();
    if (ce) return json({ error: ce.message }, 400);
    let adjustment_id: string | null = null;
    if (delta !== 0) {
      const { data: a, error: ae } = await sb.from('stock_adjustments').insert({
        codice, qty_delta: delta, motivo: 'conta', count_id: cnt.id, data: dt, chi: chi || null, source: 'app',
      }).select('id').single();
      if (ae) return json({ error: ae.message }, 400);
      adjustment_id = a.id;
    }
    await logp('counts', String(cnt.id), 'count_apply', { codice, contati, giac_prima: giacLive, delta, adjustment_id });
    return json({ ok: true, id: cnt.id, contati, giac_prima: giacLive, delta, giac_dopo: contati, adjustment_id });
  }

  // --- generic insert (purchase/gift/b2b/product/order) ---
  const table = TABLES[action];
  if (!table) return json({ error: 'azione sconosciuta: ' + action }, 400);

  const errs = validate(action, payload);
  if (errs.length) return json({ error: errs.join(' · '), validation: errs }, 422);

  const row = { ...payload, source: 'app', chi: chi || null };
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) return json({ error: error.message }, 400);

  await logp(table, String(data.id), 'insert', data);
  return json({ ok: true, id: data.id, row: data });
});
