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

  let body: { action?: string; payload?: Record<string, unknown>; pin?: string; chi?: string; force?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'JSON non valido' }, 400); }
  const { action = '', payload = {}, pin = '', chi = '', force = false } = body;

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg } = await sb.from('app_config').select('pin_hash').eq('id', 1).single();
  const ok = cfg?.pin_hash && pin && (await sha256hex(String(pin))) === cfg.pin_hash;
  if (!ok) return json({ error: 'PIN errato' }, 401);

  const today = new Date().toISOString().slice(0, 10);
  const logp = (tbl: string, row_id: string, op: string, after: unknown) =>
    sb.from('change_log').insert({ tbl, row_id, op, after, chi: chi || null, source: 'write-api' });

  // Protezione mesi chiusi (audit 2026-07-06, A3): una scrittura datata in un mese gia' congelato
  // in ce_snapshots fa derivare in silenzio un P&L che l'owner ha gia' comunicato. Blocca, a meno
  // di force esplicito (con motivo consigliato). Il mese corrente non e' mai chiuso -> le operazioni
  // quotidiane non sono toccate; scatta solo su scritture retrodatate in gen-giu.
  const closedMonth = async (y: unknown, m: unknown): Promise<boolean> => {
    const yy = Number(y), mm = Number(m);
    if (!yy || !mm) return false;
    const { data } = await sb.from('ce_snapshots').select('id').eq('year', yy).eq('month', mm).limit(1);
    return !!(data && data.length);
  };
  const closedErr = (y: unknown, m: unknown) =>
    json({ error: `Mese ${Number(m)}/${Number(y)} CHIUSO: i numeri sono congelati. Riaprilo o passa force:true (con motivo) per scrivere comunque.`, closed_month: true, year: Number(y), month: Number(m) }, 409);

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
    // costo opzionale all'arrivo (feedback 06-07 item 18): su una riga WIP il costo si scopre quando
    // le borse arrivano; se passato, aggiorna anche la riga ordine.
    const costo = payload.costo_unitario != null && payload.costo_unitario !== '' ? Number(payload.costo_unitario) : null;
    const updOrd: Record<string, unknown> = { qty_arrived: target, data_ultimo_arrivo: arrDate };
    if (costo != null && Number.isFinite(costo) && costo >= 0) updOrd.costo_unitario = costo;
    // riga WIP: quantita' ordinata ignota; l'arrivo la RISOLVE (ordinato = arrivato totale)
    if (ord.wip && target > 0) { updOrd.qty_ordered = target; updOrd.wip = false; }
    const { error: ue } = await sb.from('supplier_orders').update(updOrd).eq('id', oid);
    if (ue) return json({ error: ue.message }, 400);
    if (delta !== 0) await sb.from('purchases').insert({
      codice: ord.codice, item: ord.item, variant: ord.variant, categoria: 'BAG',
      tipologia: 'Prodotto Finito', unita_misura: 'Pezzi', quantita: delta, data: arrDate,
      costo_unitario: (updOrd.costo_unitario as number | undefined) ?? ord.costo_unitario ?? null,
      fornitore: ord.fornitore, source: 'app-arrivo-edit', chi: chi || null,
    });
    await logp('supplier_orders', String(oid), 'arrival_set', { codice: ord.codice, target, delta, data: arrDate, costo: updOrd.costo_unitario ?? null, wip_resolved: !!(ord.wip && target > 0) });
    return json({ ok: true, arrived: target, ordered: (updOrd.qty_ordered as number | undefined) ?? ord.qty_ordered });
  }

  // --- NEW (feedback 06-07 item 10): delete a supplier-order line ---
  // Sicurezza: se ha arrivi registrati serve prima azzerarli (l'azzeramento scrive il purchase
  // negativo che riporta lo stock a posto), oppure force:true esplicito che li cancella insieme.
  if (action === 'order_delete') {
    const oid = payload.order_id as string;
    if (!oid) return json({ error: 'order_id mancante' }, 422);
    const { data: ord } = await sb.from('supplier_orders').select('*').eq('id', oid).single();
    if (!ord) return json({ error: 'ordine non trovato' }, 404);
    if (Number(ord.qty_arrived) > 0 && !force) {
      return json({ error: `Questa riga ha ${ord.qty_arrived} pezzi gia' registrati come arrivati: prima azzera gli arrivi (salva "0" come totale arrivato), poi elimina.`, has_arrivals: true }, 409);
    }
    const { error: de } = await sb.from('supplier_orders').delete().eq('id', oid);
    if (de) return json({ error: de.message }, 400);
    await logp('supplier_orders', String(oid), 'order_delete', { codice: ord.codice, qty_ordered: ord.qty_ordered, qty_arrived: ord.qty_arrived, fornitore: ord.fornitore });

    // Reap dello stub orfano (simmetria con order_multi, che CREA lo stub prodotto): se questa era
    // l'ULTIMA riga d'ordine per il codice e il prodotto e' ancora uno stub app-ordine MAI toccato
    // (non verificato, zero movimenti di magazzino), cancellalo. Senza questo lo stub resterebbe per
    // sempre nella lista "da verificare" anche se l'ordine che l'ha generato non esiste piu'.
    let stub_reaped: string | null = null;
    const { data: prod } = await sb.from('products')
      .select('id, codice, source, verificato').eq('codice', ord.codice).maybeSingle();
    if (prod && prod.verificato === false && prod.source === 'app-ordine') {
      const { count: otherOrders } = await sb.from('supplier_orders')
        .select('*', { count: 'exact', head: true }).eq('codice', ord.codice);
      if (!otherOrders) {
        const { data: inv } = await sb.from('v_inventory')
          .select('qty_purchased, shopify_sold, qromo_sold, gift_sold, b2b_venduto, resi_rientrati, aggiustamenti')
          .eq('codice', ord.codice).maybeSingle();
        const touched = !!inv && [inv.qty_purchased, inv.shopify_sold, inv.qromo_sold, inv.gift_sold,
          inv.b2b_venduto, inv.resi_rientrati, inv.aggiustamenti].some((v) => Number(v) !== 0);
        if (!touched) {
          const { error: pde } = await sb.from('products').delete().eq('id', prod.id);
          if (!pde) {
            stub_reaped = prod.codice;
            await logp('products', String(prod.id), 'stub_reaped_on_order_delete',
              { codice: prod.codice, motivo: 'stub app-ordine mai toccato; ultima riga ordine cancellata' });
          }
        }
      }
    }
    return json({ ok: true, deleted: oid, stub_reaped });
  }

  // --- NEW (feedback 06-07 item 20): archivio riordino (nasconde dal riordino, ripristinabile) ---
  if (action === 'reorder_archive') {
    const codice = String(payload.codice || '');
    const archived = payload.archived !== false;
    if (!codice) return json({ error: 'CODICE mancante' }, 422);
    const { data, error } = await sb.from('products').update({ riordino_archiviato: archived }).eq('codice', codice).select('id, codice').single();
    if (error) return json({ error: error.message }, 400);
    await logp('products', String(data.id), 'reorder_archive', { codice, archived });
    return json({ ok: true, codice, archived });
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
      // riga WIP (feedback 06-07 item 18): quantita'/costo ancora ignoti (es. affinamento pelle);
      // qty_ordered resta 0 e si risolve alla registrazione dell'arrivo.
      wip: r.wip === true,
      qty_ordered: r.wip === true ? 0 : (Number(r.qty_ordered) || 0), qty_arrived: 0,
      nuovo_riordino: (r.nuovo_riordino as string) ?? null,
      costo_unitario: r.costo_unitario != null ? Number(r.costo_unitario) : null,
      data_consegna: (r.data_consegna as string) ?? null, note: (r.note as string) ?? null,
      source: 'app', chi: chi || null,
    })).filter((r) => r.codice && (r.qty_ordered > 0 || r.wip));
    if (!rows.length) return json({ error: 'righe non valide (CODICE + quantità)' }, 422);
    const { data, error } = await sb.from('supplier_orders').insert(rows).select();
    if (error) return json({ error: error.message }, 400);
    // Create product stubs for bags not yet in the catalog, so they surface in FLOW 2 (verifica).
    const codici = [...new Set(rows.map((r) => r.codice))];
    const { data: existing } = await sb.from('products').select('codice').in('codice', codici);
    const have = new Set((existing || []).map((e: { codice: string }) => e.codice));
    const seen = new Set<string>();
    // nomi in MAIUSCOLO (decisione call 06-07): item e variant sempre uppercase alla scrittura
    const stubs = rows.filter((r) => !have.has(r.codice) && !seen.has(r.codice) && seen.add(r.codice)).map((r) => ({
      codice: r.codice, item: r.item ? r.item.toUpperCase() : r.item, model: r.item ? r.item.toUpperCase() : r.item,
      variant: r.variant ? r.variant.toUpperCase() : r.variant,
      categoria: 'BAG', verificato: false, status: 'nuovo', source: 'app-ordine', chi: chi || null,
    }));
    if (stubs.length) await sb.from('products').upsert(stubs, { onConflict: 'codice', ignoreDuplicates: true });
    await logp('supplier_orders', gruppo, 'order_multi', { fornitore, righe: rows.length, gruppo, stubs: stubs.length });
    return json({ ok: true, gruppo, lines: data?.length ?? 0, stubs: stubs.length });
  }

  // --- FLOW 2: verify / complete a product's details (Benny) ---
  if (action === 'product_verify') {
    const codice = String(payload.codice || '');
    if (!codice) return json({ error: 'CODICE mancante' }, 422);
    const { data: cur } = await sb.from('products').select('id, codice, verificato').eq('codice', codice).single();
    if (!cur) return json({ error: 'prodotto non trovato' }, 404);
    const upd: Record<string, unknown> = { verificato: true, updated_at: new Date().toISOString() };
    for (const f of ['item', 'variant', 'categoria', 'image_url', 'description', 'seo_title']) {
      if (payload[f] != null && String(payload[f]).trim() !== '') upd[f] = payload[f];
    }
    // nomi in MAIUSCOLO (decisione call 06-07): difesa server-side, qualunque client scriva
    if (typeof upd.item === 'string') upd.item = (upd.item as string).toUpperCase();
    if (typeof upd.variant === 'string') upd.variant = (upd.variant as string).toUpperCase();
    if (payload.retail_price != null && payload.retail_price !== '') upd.retail_price = Number(payload.retail_price);
    // COGS editabile dal catalogo (2026-07-04): cambia i margini FUTURI; le vendite passate
    // tengono il loro snapshot cogs — nessun ricalcolo retroattivo.
    if (payload.cogs != null && payload.cogs !== '') upd.cogs = Number(payload.cogs);

    // CODICE DEFINITIVO alla verifica di Benny (decisione owner 06-07): il codice nato con
    // l'ordine di Ginni e' PROVVISORIO. Alla prima verifica (o finche' il codice resta non
    // finalizzato, cioe' termina con '_') si rigenera dai Modello+Variante finali, MAIUSCOLO.
    // Le verifiche successive non lo toccano piu'. Se il derivato collide con un altro
    // prodotto, la verifica passa SENZA rename (segnalato in risposta).
    const tok = (s: unknown) => String(s ?? '').toUpperCase().trim().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    let newCodice: string | null = null;
    let renameSkipped: string | null = null;
    if ((!cur.verificato || /_$/.test(cur.codice)) && typeof upd.item === 'string' && typeof upd.variant === 'string') {
      const derived = `${tok(upd.item)}_${tok(upd.variant)}`;
      if (derived && !/^_|_$/.test(derived) && derived !== cur.codice) {
        const { data: clash } = await sb.from('products').select('id').eq('codice_norm', derived).neq('id', cur.id).maybeSingle();
        if (clash) renameSkipped = `codice ${derived} gia' esistente: verifica salvata senza rinomina`;
        else newCodice = derived;
      }
    }
    if (newCodice) upd.codice = newCodice;

    const { data, error } = await sb.from('products').update(upd).eq('id', cur.id).select().single();
    if (error) return json({ error: error.message }, 400);

    // cascata: le righe gia' scritte col codice provvisorio seguono il codice definitivo
    const cascata: Record<string, number> = {};
    if (newCodice) {
      for (const t of ['supplier_orders', 'purchases', 'qromo_sales', 'shopify_line_items', 'gifts_offline', 'returns', 'counts', 'stock_adjustments']) {
        const { count, error: ce } = await sb.from(t).update({ codice: newCodice }, { count: 'exact' }).eq('codice', cur.codice);
        if (!ce && count) cascata[t] = count;
      }
    }
    await logp('products', String(data.id), 'product_verify', { ...upd, ...(newCodice ? { codice_da: cur.codice, codice_a: newCodice, cascata } : {}) });
    return json({ ok: true, codice: newCodice ?? codice, renamed: !!newCodice, ...(renameSkipped ? { warning: renameSkipped } : {}) });
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
    // una spesa APPROVATA (expense_manual) datata in un mese chiuso ne sposta il CE: blocca.
    // le proposte (expense_propose) restano pending e non toccano il CE finche' non approvate.
    if (action === 'expense_manual' && !force && await closedMonth(row.year, row.month)) return closedErr(row.year, row.month);
    const { data, error } = await sb.from('expenses').insert(row).select().single();
    if (error) return json({ error: error.message }, 400);
    await logp('expenses', String(data.id), action, data);
    return json({ ok: true, id: data.id, status: row.status });
  }
  if (action === 'expense_approve') {
    const id = String(payload.id || '');
    const decision = String(payload.status || 'approved');
    if (!id) return json({ error: 'id mancante' }, 422);
    const edits = (payload.edits as Record<string, unknown>) || {};
    // approvare una spesa datata in un mese chiuso ne muove il CE (fu questo + una ricategorizzazione
    // a far derivare giugno). Blocca l'approvazione verso un mese chiuso (il reject e' sempre ok).
    // ECCEZIONE (feedback 06-07 item 1): confermare SENZA cambiare nulla di contabile (solo nota,
    // spesa GIA' approved) non muove il CE — era il caso delle 3 spese storiche "DA VERIFICARE" che
    // non si confermavano mai (il 409 veniva pure ingoiato dal client senza messaggio).
    const movesCE = edits.categoria != null || edits.costo != null || edits.amimi != null || edits.sottocategoria != null;
    if (decision !== 'rejected' && !force) {
      const { data: exRow } = await sb.from('expenses').select('year, month, status').eq('id', id).single();
      const noteOnly = !movesCE && exRow?.status === 'approved';
      if (exRow && !noteOnly && await closedMonth(exRow.year, exRow.month)) return closedErr(exRow.year, exRow.month);
    }
    const upd: Record<string, unknown> = { status: decision === 'rejected' ? 'rejected' : 'approved', approved_by: chi || null };
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
    // ripuntare una vendita di un mese chiuso ne cambia il COGS/CE: blocca senza force.
    if (!force && await closedMonth(before.year, before.month)) return closedErr(before.year, before.month);
    // qromo_sales has item/variant columns; shopify_line_items does not (only codice + lineitem_name)
    // Ri-snapshotta il COGS dal prodotto di destinazione (audit B17): prima cambiava solo il codice e
    // il CE teneva il COGS del prodotto SBAGLIATO. Il codice_norm di prodotti/righe e' generato.
    const nc = newCodice.toUpperCase().replace(/\s+/g, '_');
    const { data: np } = await sb.from('products').select('cogs, item, variant').eq('codice_norm', nc).maybeSingle();
    const upd: Record<string, unknown> = isShop
      ? { codice: newCodice, resolved: true, cogs_snapshot: np?.cogs ?? null }
      : {
          codice: newCodice,
          item: (payload.new_item as string) ?? np?.item ?? before.item ?? null,
          variant: (payload.new_variant as string) ?? np?.variant ?? before.variant ?? null,
          cogs: np?.cogs ?? before.cogs ?? null,
        };
    const { error } = await sb.from(tbl).update(upd).eq('id', id);
    if (error) return json({ error: error.message }, 400);
    await logp(tbl, id, 'sale_correct', { from: before.codice, to: newCodice, cogs: np?.cogs ?? null });
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
    // importo CON SEGNO (feedback 06-07 item 5): positivo = rimborso al cliente; NEGATIVO = il
    // cliente ha pagato la differenza (cambio con borsa piu' cara). Prima Math.abs mangiava il segno.
    const impRaw = payload.importo_rimborsato != null ? Number(payload.importo_rimborsato) : 0;
    if (!Number.isFinite(impRaw)) return json({ error: 'importo rimborsato non valido' }, 422);
    const row = {
      data: dt, year: d.getFullYear(), month: d.getMonth() + 1,
      codice, item: (payload.item as string) ?? null, variant: (payload.variant as string) ?? null,
      quantita: qty, canale: (payload.canale as string) ?? null,
      importo_rimborsato: impRaw,
      rientra_stock: payload.rientra_stock !== false,
      motivo: (payload.motivo as string) ?? null, sostituito_con: (payload.sostituito_con as string) ?? null,
      note: (payload.note as string) ?? null, source: 'app', chi: chi || null,
    };
    if (!force && await closedMonth(row.year, row.month)) return closedErr(row.year, row.month);
    const { data, error } = await sb.from('returns').insert(row).select().single();
    if (error) return json({ error: error.message }, 400);
    // Cambio merce (audit A9): la borsa resa rientra (rientra_stock) ma il RIMPIAZZO e' uscito dal
    // negozio. Prima nessuno scalava il sostituto -> il suo stock restava gonfiato per sempre. Registra
    // un aggiustamento di -qty sul codice sostituto (ledger, tracciabile).
    let sostituzione_id: string | null = null;
    const sost = String(payload.sostituito_con || '').trim();
    if (sost) {
      const { data: adj } = await sb.from('stock_adjustments').insert({
        codice: sost, qty_delta: -qty, motivo: 'cambio (sostituto uscito)', data: dt, chi: chi || null, source: 'app',
      }).select('id').single();
      sostituzione_id = adj?.id ?? null;
    }
    await logp('returns', String(data.id), 'return', { ...data, sostituzione_adjustment: sostituzione_id });
    return json({ ok: true, id: data.id, rientra_stock: row.rientra_stock, sostituzione_id });
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

  // gift/b2b portano year/month (derivati client-side): blocca la scrittura in un mese chiuso.
  if (!force && await closedMonth((payload as Record<string, unknown>).year, (payload as Record<string, unknown>).month))
    return closedErr((payload as Record<string, unknown>).year, (payload as Record<string, unknown>).month);

  const row = { ...payload, source: 'app', chi: chi || null };
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) return json({ error: error.message }, 400);

  await logp(table, String(data.id), 'insert', data);
  return json({ ok: true, id: data.id, row: data });
});
