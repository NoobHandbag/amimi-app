import { supabase } from './supabase';
import { nowYear } from './helpers';

const FN = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/write-api';

// fix i (31-07): identificativo di CONTESTO accanto a chi. Su iOS l'app installata in home e la
// stessa app in Safari hanno localStorage SEPARATI (e quindi possono firmare chi diversi): un uuid
// per contesto, generato una volta e mandato in ogni scrittura, li rende distinguibili in change_log.
const ctxId = (() => {
  try {
    let c = localStorage.getItem('amimi_ctx');
    if (!c) { c = crypto.randomUUID().slice(0, 8); localStorage.setItem('amimi_ctx', c); }
    return c;
  } catch { return null; }
})();

export type Product = {
  codice: string; item: string | null; variant: string | null;
  categoria: string | null; image_url: string | null; retail_price: number | null; cogs: number | null;
};
export type Supplier = { name: string; kind: string | null };

/** The single write path: PIN-checked Edge Function. Throws Error(message) on failure.
 *  force=true scavalca la protezione mesi chiusi (usarlo SOLO dopo conferma esplicita dell'utente). */
export async function writeApi(action: string, payload: Record<string, unknown>, pin: string, chi: string, force = false) {
  const r = await fetch(FN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, pin, chi, ...(force ? { force: true } : {}), ...(ctxId ? { ctx: ctxId } : {}) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error || `Errore ${r.status}`) as Error & { closedMonth?: boolean; duplicato?: boolean };
    if (j.closed_month) e.closedMonth = true;
    // fix a (31-07): il server segnala un possibile doppio arrivo; la UI chiede conferma e ritenta
    if (j.duplicato_possibile) e.duplicato = true;
    throw e;
  }
  return j as { ok: boolean; id: string };
}

let _productCache: Product[] | null = null;
export function clearProductCache() { _productCache = null; }
export async function fetchProducts(): Promise<Product[]> {
  if (_productCache) return _productCache;
  const { data, error } = await supabase
    .from('products')
    .select('codice,item,variant,categoria,image_url,retail_price,cogs')
    .order('item');
  if (error) throw new Error(error.message);
  _productCache = (data ?? []) as Product[];
  return _productCache;
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data } = await supabase.from('suppliers').select('name,kind').order('name');
  return (data ?? []) as Supplier[];
}

export async function fetchGiacenze(): Promise<Map<string, number>> {
  const { data } = await supabase.from('v_inventory').select('codice,giacenza_attuale');
  const m = new Map<string, number>();
  (data ?? []).forEach((r: { codice: string; giacenza_attuale: number }) => m.set(r.codice, Number(r.giacenza_attuale)));
  return m;
}

/** Live giacenza for ONE product — used by the count form so an immediate re-count is never stale. */
export async function fetchGiacenzaOne(codice: string): Promise<number> {
  const { data } = await supabase.from('v_inventory').select('giacenza_attuale').eq('codice', codice).maybeSingle();
  return data ? Number((data as { giacenza_attuale: number }).giacenza_attuale) : 0;
}

export type InvFull = {
  codice: string; item: string | null; variant: string | null; categoria: string | null;
  giacenza_attuale: number; in_conto_vendita: number; disponibili_da_vendere: number;
  valore: number; retail_price: number | null; cogs: number | null; last_sale: string | null; on_shopify: boolean; image_url: string | null;
  // audit 06-09: per il pannello "Per linea" (sell-through = venduto / acquistato)
  qty_purchased: number; shopify_sold: number; qromo_sold: number; gift_sold: number; b2b_venduto: number;
};
export async function fetchInventory(): Promise<InvFull[]> {
  const { data, error } = await supabase
    .from('v_inventory')
    .select('codice,item,variant,categoria,giacenza_attuale,in_conto_vendita,disponibili_da_vendere,valore,retail_price,cogs,last_sale,on_shopify,image_url,qty_purchased,shopify_sold,qromo_sold,gift_sold,b2b_venduto')
    .order('giacenza_attuale');
  if (error) throw new Error(error.message);
  return (data ?? []) as InvFull[];
}

export type CV = { negozio: string; codice: string; item: string | null; variant: string | null; image_url: string | null; pezzi: number };
export async function fetchContoVendita(): Promise<CV[]> {
  const { data, error } = await supabase
    .from('v_conto_vendita_negozio')
    .select('negozio,codice,item,variant,image_url,pezzi')
    .order('negozio');
  if (error) throw new Error(error.message);
  return (data ?? []) as CV[];
}

export async function fetchNegozi(): Promise<string[]> {
  const { data } = await supabase.from('negozi').select('name').order('name');
  return (data ?? []).map((r: { name: string }) => r.name);
}

/** History-based smart prefill: the most recent purchase of a CODICE. */
export async function fetchLastPurchase(codice: string): Promise<{ costo_unitario: number | null; fornitore: string | null } | null> {
  const { data } = await supabase
    .from('purchases')
    .select('costo_unitario,fornitore,data')
    .eq('codice', codice)
    .order('data', { ascending: false })
    .limit(1);
  if (data && data[0]) return { costo_unitario: data[0].costo_unitario, fornitore: data[0].fornitore };
  return null;
}

/** Ultimo ORDINE fornitore del CODICE (supplier_orders): quantita' e costo per il prefill del form
 *  Nuovo ordine (decisione owner 31-07: mai piu' 5 hardcoded; mai ordinata = campo vuoto).
 *  qty = ultima qty_ordered > 0 (le righe WIP hanno 0); costo = ultimo costo_unitario non nullo. */
export async function fetchLastOrder(codice: string): Promise<{ qty_ordered: number | null; costo_unitario: number | null } | null> {
  const { data } = await supabase.from('supplier_orders').select('qty_ordered,costo_unitario,data_ordine')
    .eq('codice', codice).order('data_ordine', { ascending: false }).limit(8);
  const rows = (data ?? []) as { qty_ordered: number | null; costo_unitario: number | null }[];
  if (!rows.length) return null;
  const qty = rows.find((r) => Number(r.qty_ordered) > 0)?.qty_ordered ?? null;
  const costo = rows.find((r) => r.costo_unitario != null)?.costo_unitario ?? null;
  return { qty_ordered: qty == null ? null : Number(qty), costo_unitario: costo == null ? null : Number(costo) };
}

export type Activity = { id: number; tbl: string; rowId: string | null; op: string | null; chi: string | null; ts: string; codice: string | null; after: Record<string, unknown> | null };
export async function fetchRecent(): Promise<Activity[]> {
  const { data } = await supabase.from('change_log').select('id,tbl,row_id,op,chi,ts,after').order('ts', { ascending: false }).limit(25);
  return (data ?? []).map((r: { id: number; tbl: string; row_id: string | null; op: string | null; chi: string | null; ts: string; after: Record<string, unknown> | null }) =>
    ({ id: r.id, tbl: r.tbl, rowId: r.row_id, op: r.op, chi: r.chi, ts: r.ts, codice: (r.after as { codice?: string } | null)?.codice ?? null, after: r.after ?? null }));
}

export type Ordine = {
  id: string; codice: string; item: string | null; variant: string | null; fornitore: string | null;
  qty_ordered: number; qty_arrived: number; mancano: number; completo: boolean;
  data_ordine: string | null; image_url: string | null;
};
export async function fetchOrdiniArrivo(): Promise<Ordine[]> {
  const { data, error } = await supabase
    .from('v_ordini_arrivo')
    .select('id,codice,item,variant,fornitore,qty_ordered,qty_arrived,mancano,completo,data_ordine,image_url')
    .order('completo').order('data_ordine');
  if (error) throw new Error(error.message);
  return (data ?? []) as Ordine[];
}

export type CeTot = { year: number; month: number; online_netto: number; offline_netto: number; b2b_netto: number; lordo: number; netto: number; mc1: number; mc2: number };
/** Whole-business P&L (CE_TOTALE): now COMPUTED natively by v_ce_totale (Amimì + gifts + all
 *  expenses + the irreducibly-manual non-Amimì Jan/Feb block), not the old static sheet copy. */
export async function fetchCeTotale(): Promise<CeTot[]> {
  const { data, error } = await supabase
    .from('v_ce_totale')
    .select('year,month,online_netto,offline_netto,b2b_netto,omni_netto,mc1,mc2')
    .eq('year', nowYear())
    .order('month');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { year: number; month: number; online_netto: number; offline_netto: number; b2b_netto: number; omni_netto: number; mc1: number; mc2: number }) => ({
    year: r.year, month: r.month,
    online_netto: Number(r.online_netto), offline_netto: Number(r.offline_netto), b2b_netto: Number(r.b2b_netto),
    netto: Number(r.omni_netto), lordo: Number(r.omni_netto) * 1.22, mc1: Number(r.mc1), mc2: Number(r.mc2),
  })) as CeTot[];
}

export async function syncShopify(pin: string) {
  const r = await fetch((import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/shopify-sync', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Errore ${r.status}`);
  return j as { ok: boolean; inserted?: number };
}

export const oggi = () => new Date().toISOString().slice(0, 10);

// ---------- FLOW 1: multi-bag supplier orders ----------
export type OrdLine = Ordine & { nuovo_riordino: string | null; costo_unitario: number | null; data_consegna: string | null; data_consegna_display: string | null; wip?: boolean };
export type OrdGruppo = { gruppo: string; fornitore: string | null; data_ordine: string | null; righe: OrdLine[]; mancano: number; completo: boolean };

export async function fetchOrdiniGruppi(): Promise<OrdGruppo[]> {
  const { data, error } = await supabase
    .from('v_ordini_arrivo')
    .select('id,gruppo,codice,item,variant,fornitore,qty_ordered,qty_arrived,mancano,completo,nuovo_riordino,costo_unitario,data_consegna,data_consegna_display,data_ordine,image_url,wip')
    .order('data_ordine', { ascending: false });
  if (error) throw new Error(error.message);
  const byG = new Map<string, OrdGruppo>();
  (data ?? []).forEach((r: OrdLine & { gruppo: string }) => {
    const g = byG.get(r.gruppo) ?? { gruppo: r.gruppo, fornitore: r.fornitore, data_ordine: r.data_ordine, righe: [], mancano: 0, completo: true };
    g.righe.push(r as OrdLine); g.mancano += Number(r.mancano) || 0; g.completo = g.completo && r.completo;
    byG.set(r.gruppo, g);
  });
  return [...byG.values()].sort((a, b) => Number(a.completo) - Number(b.completo) || (b.data_ordine ?? '').localeCompare(a.data_ordine ?? ''));
}

export type FornProd = { fornitore: string; codice: string; item: string | null; variant: string | null; ultimo_costo: number | null; image_url: string | null; n_ordini: number };
export async function fetchFornitoreProdotti(fornitore: string): Promise<FornProd[]> {
  const { data } = await supabase.from('v_fornitore_prodotti').select('*').eq('fornitore', fornitore).order('item');
  return (data ?? []) as FornProd[];
}

export async function createOrderMulti(fornitore: string, dataOrdine: string, righe: Record<string, unknown>[], pin: string, chi: string) {
  return writeApi('order_multi', { fornitore, data_ordine: dataOrdine, righe }, pin, chi);
}

// ---------- FLOW 2: product-detail verification ----------
export type ProdBucket = 'nuovo' | 'costo_ricavo' | 'pulizia';
export type ProdTodo = {
  codice: string; item: string | null; variant: string | null; model: string | null; categoria: string | null;
  image_url: string | null; retail_price: number | null; cogs: number | null; description: string | null;
  seo_title: string | null; verificato: boolean; missing_count: number; giacenza: number; venduto: number; on_shopify: boolean;
  source: string | null; is_new_model: boolean; bucket: ProdBucket; bucket_rank: number; stub_orfano?: boolean;
};

// tabella models (migr 0073): modello -> categoria/product_type/template/collezioni.
// La picklist ordini unisce questi ai modelli gia' a catalogo.
export type ModelRow = { model: string; categoria: string; product_type: string | null; template_suffix: string | null };
export async function fetchModels(): Promise<ModelRow[]> {
  const { data } = await supabase.from('models').select('model,categoria,product_type,template_suffix').order('model');
  return (data ?? []) as ModelRow[];
}

// v_products_to_publish (migr 0074): l'UNICO segnale "pronto per Shopify" (brief 23-07 D.1).
// pronto_stock e' informativo (bozza anche prima dell'arrivo, decisione owner 23-07).
export type ToPublish = { codice: string; item: string | null; variant: string | null; pronto_stock: boolean; modello_censito: boolean };
export async function fetchToPublish(): Promise<ToPublish[]> {
  const { data, error } = await supabase.from('v_products_to_publish').select('codice,item,variant,pronto_stock,modello_censito');
  if (error) throw new Error(error.message);
  return (data ?? []) as ToPublish[];
}
export async function fetchProductsTodo(): Promise<ProdTodo[]> {
  const { data, error } = await supabase.from('v_products_todo').select('*');
  if (error) throw new Error(error.message);
  // bucket first (nuovi da ordine → impatto ricavi/costi → pulizia), then sold-first, then most-missing
  return ((data ?? []) as ProdTodo[]).sort((a, b) =>
    a.bucket_rank - b.bucket_rank
    || (b.venduto > 0 ? 1 : 0) - (a.venduto > 0 ? 1 : 0)
    || b.missing_count - a.missing_count);
}
export async function verifyProduct(payload: Record<string, unknown>, pin: string, chi: string) {
  return writeApi('product_verify', payload, pin, chi);
}
// COGS dall'ordine fornitore (le "info di Ginni", item 26): l'ultimo costo_unitario ordinato per il codice
export async function fetchLastOrderCost(codice: string): Promise<number | null> {
  const { data } = await supabase.from('supplier_orders').select('costo_unitario,data_ordine')
    .eq('codice', codice).not('costo_unitario', 'is', null)
    .order('data_ordine', { ascending: false }).limit(1);
  return data && data[0] && data[0].costo_unitario != null ? Number(data[0].costo_unitario) : null;
}
// descrizione di default dal modello (item 26): quella di una variante sorella gia' compilata
export async function fetchSiblingDescription(item: string, excludeCodice: string): Promise<string | null> {
  const { data } = await supabase.from('products').select('description')
    .eq('item', item).neq('codice', excludeCodice).not('description', 'is', null).limit(5);
  const d = (data ?? []).map((r: { description: string | null }) => (r.description ?? '').trim()).find((s: string) => s.length > 0);
  return d || null;
}

// ---------- FLOW 4/5: expenses ----------
export type ExpPending = { id: string; date_paid: string | null; operazione: string | null; costo: number; categoria: string | null; sottocategoria: string | null; amimi: boolean; note: string | null; proposed_by: string | null; status: string };
export async function fetchExpensesPending(): Promise<ExpPending[]> {
  const { data, error } = await supabase.from('v_expenses_pending').select('*');
  if (error) throw new Error(error.message);
  return (data ?? []) as ExpPending[];
}
// coda di revisione completa: proposte pending + storiche con nota "DA VERIFICARE"
export type ExpReview = ExpPending & { year: number; month: number; date_reported: string | null; amimi_raw: string | null; created_at: string };
export async function fetchExpensesReview(): Promise<ExpReview[]> {
  const { data, error } = await supabase.from('v_expenses_review').select('*');
  if (error) throw new Error(error.message);
  return (data ?? []) as ExpReview[];
}
export async function fetchExpensesRecent(): Promise<ExpPending[]> {
  const { data } = await supabase.from('expenses').select('id,date_paid,operazione,costo,categoria,sottocategoria,amimi,note,proposed_by,status')
    .order('created_at', { ascending: false }).limit(20);
  return (data ?? []) as ExpPending[];
}
export async function addExpense(action: 'expense_manual' | 'expense_propose', payload: Record<string, unknown>, pin: string, chi: string) {
  return writeApi(action, payload, pin, chi);
}
export async function approveExpense(id: string, status: 'approved' | 'rejected', edits: Record<string, unknown> | null, pin: string, chi: string, force = false) {
  return writeApi('expense_approve', { id, status, edits: edits ?? {} }, pin, chi, force);
}

// ---------- SECOND FLOW: sale → product correction ----------
export type SaleRow = { source: 'qromo' | 'shopify'; id: string; data: string | null; qty: number; price: number | null; descr: string; ref: string; adminUrl?: string };
// deep-link all'ordine in admin Shopify (feedback 06-07 item 6). order_id qui e' il NAME ('#1452'):
// l'URL di ricerca per name funziona senza conoscere l'id numerico interno.
export const shopifyOrderUrl = (orderId: string | null | undefined): string | undefined =>
  orderId ? `https://admin.shopify.com/store/amimi-10000/orders?query=name%3A${encodeURIComponent(String(orderId).replace(/^#/, ''))}` : undefined;

export async function fetchSalesByCodice(codice: string): Promise<SaleRow[]> {
  const [q, s] = await Promise.all([
    supabase.from('qromo_sales').select('id,data,quantita,prezzo,nome,cognome').eq('codice', codice).order('data', { ascending: false }).limit(40),
    supabase.from('shopify_line_items').select('id,created_at,quantita,price,lineitem_name,order_id').eq('codice', codice).order('created_at', { ascending: false }).limit(40),
  ]);
  // resolve Shopify order customer names + REAL order date (feedback 06-07 item 9 + 22):
  // shopify_line_items.created_at e' il timestamp di import (tutto 07-01 per lo storico),
  // la data vera della vendita e' shopify_orders.created_at_shop.
  const oids = [...new Set((s.data ?? []).map((r: { order_id: string }) => r.order_id).filter(Boolean))];
  const cust = new Map<string, string>();
  const odate = new Map<string, string>();
  if (oids.length) {
    const { data: ords } = await supabase.from('shopify_orders').select('order_id, customer_name, created_at_shop').in('order_id', oids);
    (ords ?? []).forEach((o: { order_id: string; customer_name: string | null; created_at_shop: string | null }) => {
      if (o.customer_name) cust.set(o.order_id, o.customer_name);
      if (o.created_at_shop) odate.set(o.order_id, o.created_at_shop.slice(0, 10));
    });
  }
  const out: SaleRow[] = [];
  (q.data ?? []).forEach((r: { id: string; data: string; quantita: number; prezzo: number; nome: string; cognome: string }) =>
    out.push({ source: 'qromo', id: r.id, data: r.data, qty: Number(r.quantita), price: r.prezzo, descr: `${r.nome ?? ''} ${r.cognome ?? ''}`.trim() || 'Vendita negozio', ref: 'POS' }));
  (s.data ?? []).forEach((r: { id: string; created_at: string; quantita: number; price: number; lineitem_name: string; order_id: string }) =>
    out.push({ source: 'shopify', id: r.id, data: odate.get(r.order_id) ?? (r.created_at ?? '').slice(0, 10), qty: Number(r.quantita), price: r.price, descr: cust.get(r.order_id) ?? r.lineitem_name ?? 'Ordine online', ref: '#' + (r.order_id ?? ''), adminUrl: shopifyOrderUrl(r.order_id) }));
  return out.sort((a, b) => (b.data ?? '').localeCompare(a.data ?? ''));
}
// recent sales across both channels, with the product they are CURRENTLY attributed to —
// lets "Correggi vendita" start from the sale/order instead of the product.
export type RecentSale = SaleRow & { codice: string; item: string | null; variant: string | null };
export async function fetchRecentSales(limit = 60): Promise<RecentSale[]> {
  const [q, s, prods] = await Promise.all([
    supabase.from('qromo_sales').select('id,codice,data,quantita,prezzo,nome,cognome').order('data', { ascending: false }).limit(limit),
    supabase.from('shopify_line_items').select('id,codice,created_at,quantita,price,lineitem_name,order_id').order('created_at', { ascending: false }).limit(limit),
    fetchProducts(),
  ]);
  const pm = new Map(prods.map((p) => [p.codice, p]));
  const oids = [...new Set((s.data ?? []).map((r: { order_id: string }) => r.order_id).filter(Boolean))];
  const cust = new Map<string, string>();
  const odate = new Map<string, string>();
  if (oids.length) {
    const { data: ords } = await supabase.from('shopify_orders').select('order_id, customer_name, created_at_shop').in('order_id', oids);
    (ords ?? []).forEach((o: { order_id: string; customer_name: string | null; created_at_shop: string | null }) => {
      if (o.customer_name) cust.set(o.order_id, o.customer_name);
      if (o.created_at_shop) odate.set(o.order_id, o.created_at_shop.slice(0, 10));
    });
  }
  const lbl = (codice: string) => { const p = pm.get(codice); return { item: p?.item ?? null, variant: p?.variant ?? null }; };
  const out: RecentSale[] = [];
  (q.data ?? []).forEach((r: { id: string; codice: string; data: string; quantita: number; prezzo: number; nome: string; cognome: string }) =>
    out.push({ source: 'qromo', id: r.id, codice: r.codice, ...lbl(r.codice), data: r.data, qty: Number(r.quantita), price: r.prezzo, descr: `${r.nome ?? ''} ${r.cognome ?? ''}`.trim() || 'Vendita negozio', ref: 'POS' }));
  (s.data ?? []).forEach((r: { id: string; codice: string; created_at: string; quantita: number; price: number; lineitem_name: string; order_id: string }) =>
    out.push({ source: 'shopify', id: r.id, codice: r.codice, ...lbl(r.codice), data: odate.get(r.order_id) ?? (r.created_at ?? '').slice(0, 10), qty: Number(r.quantita), price: r.price, descr: cust.get(r.order_id) ?? r.lineitem_name ?? 'Ordine online', ref: '#' + (r.order_id ?? ''), adminUrl: shopifyOrderUrl(r.order_id) }));
  return out.sort((a, b) => (b.data ?? '').localeCompare(a.data ?? ''));
}
export async function correctSale(payload: Record<string, unknown>, pin: string, chi: string) {
  return writeApi('sale_correct', payload, pin, chi);
}

// ---------- THIRD FLOW: Shopify inventory alignment ----------
export type ShopAlign = { codice: string; item: string | null; variant: string | null; image_url: string | null; giacenza: number; disponibili: number; shopify_qty: number | null; diff: number; synced_at: string | null; on_shopify: boolean };
export async function fetchShopifyAlign(): Promise<ShopAlign[]> {
  const { data, error } = await supabase
    .from('v_shopify_align')
    .select('codice,item,variant,image_url,giacenza,disponibili,shopify_qty,diff,synced_at,on_shopify');
  if (error) throw new Error(error.message);
  return ((data ?? []) as ShopAlign[]).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}
function fnCall(fn: string, body: Record<string, unknown>) {
  return fetch((import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/' + fn, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok && !j.error) throw new Error('Errore ' + r.status); return j; });
}
export const syncShopifyStock = (pin: string) => fnCall('shopify-stock', { action: 'sync', pin });
export const realignShopify = (codici: string[], pin: string, chi: string) => fnCall('shopify-stock', { action: 'realign', codici, pin, chi });
// giro completo on-demand (come i cron :17 + :27): pull mirror -> push Shopify := disponibili.
// Unico writer stock = edge shopify-stock (Regola 15). Cooldown lato server (45s) + disable lato client.
export type SyncNowResult = { ok?: boolean; skipped?: string; cooldown_s?: number; error?: string;
  sync?: { synced?: number }; realign?: { skipped?: string; pushed?: number; held?: number; ok?: number; failed?: number; untracked?: string[]; unmapped?: string[] } };
export const syncNowShopify = (pin: string, chi: string): Promise<SyncNowResult> =>
  fnCall('shopify-stock', { action: 'sync_now', pin, chi }) as Promise<SyncNowResult>;

// ---------- FLOW 6: NL -> SQL ----------
export type AskResult = { ok?: boolean; sql?: string; rows?: Record<string, unknown>[]; error?: string; needs_key?: boolean };
export const askData = (question: string, pin: string): Promise<AskResult> => fnCall('ask-data', { question, pin }) as Promise<AskResult>;

// §6 redesign: riepilogo Gemini delle ultime attività (change_log). Sola lettura, gated PIN.
export type ActivityDigest = { summary?: string | null; generated_at?: string; count?: number; error?: string; needs_key?: boolean };
export const fetchActivityDigest = (pin: string): Promise<ActivityDigest> => fnCall('activity-digest', { pin }) as Promise<ActivityDigest>;

// ---------- FLOW 6 v2: Assistente AI (read-only, gated ai_enabled) ----------
export type AsstMsg = { ruolo: 'user' | 'assistant'; testo: string };
export type AsstGrafico = { tipo: 'barre' | 'linee' | 'torta'; titolo: string; etichette: string[]; valori: number[] };
export type AsstProdotto = {
  codice: string; nome: string | null; variante: string | null; image_url: string | null;
  prezzo: number | null; disponibili: number | null; giacenza: number | null; stato: string | null;
  venduto_tot: number | null; valore: number | null; valore_label: string | null;
};
// Fase 3: a PROPOSED action the assistant returns for the user to confirm (execution goes via write-api).
export type AsstAzione = {
  tipo: 'expense_propose';
  payload: { costo: number; categoria: string; operazione: string; amimi: boolean };
  descrizione: string;
  categoria_valide: string[];
};
export type AsstResult = {
  ok?: boolean; gated?: boolean; howto?: boolean; testo?: string; grafico?: AsstGrafico; prodotti?: AsstProdotto[];
  azione?: AsstAzione; sql?: string; righe?: Record<string, unknown>[]; error?: string; needs_key?: boolean;
};
export const askAssistant = (domanda: string, storia: AsstMsg[], pin: string): Promise<AsstResult> =>
  fnCall('assistant', { domanda, storia, pin }) as Promise<AsstResult>;

// ---------- NEW FEATURE: returns & exchanges ----------
export const addReturn = (payload: Record<string, unknown>, pin: string, chi: string) => writeApi('return', payload, pin, chi);

// ---------- NEW FEATURE: reorder board ----------
export type Reorder = { codice: string; item: string | null; variant: string | null; image_url: string | null; giacenza: number; disponibili: number; on_shopify: boolean; venduto_60d: number; in_arrivo: number; giorni_stock: number | null; riordino_archiviato: boolean };
export async function fetchReorder(): Promise<Reorder[]> {
  const { data, error } = await supabase.from('v_reorder').select('*');
  if (error) throw new Error(error.message);
  // urgency: best-sellers running out, nothing incoming, first
  return ((data ?? []) as Reorder[]).sort((a, b) => {
    const ua = a.venduto_60d / Math.max(1, a.giacenza + a.in_arrivo);
    const ub = b.venduto_60d / Math.max(1, b.giacenza + b.in_arrivo);
    return ub - ua;
  });
}

// ---------- NEW FEATURE: SKU availability ----------
export type SkuAvail = { codice: string; item: string | null; variant: string | null; image_url: string | null; giacenza: number; disponibili: number; on_shopify: boolean; stato: string };
export async function fetchSkuAvailability(): Promise<SkuAvail[]> {
  const { data, error } = await supabase.from('v_sku_availability').select('*');
  if (error) throw new Error(error.message);
  return (data ?? []) as SkuAvail[];
}

// ---------- NEW FEATURE: Meta Ads card ----------
export type AdsMese = { year: number; month: number; spend: number; impressions: number; clicks: number; purchases: number; purchase_value: number; roas: number };
export async function fetchAdsMensile(): Promise<AdsMese[]> {
  const { data, error } = await supabase.from('v_ads_mensile').select('*').eq('year', nowYear()).order('month');
  if (error) throw new Error(error.message);
  return (data ?? []) as AdsMese[];
}

// ---------- PAGE: Salute & Movimenti (read-only pulse of the ecosystem) ----------
// Numbers come from v_movimenti_14gg (same window logic as the Cowork digest task) so the
// in-app page and the digest agree to the cent. Everything here is read-only.
export type Movimenti = {
  off_pezzi14: number; off_lordo14: number; off_pezzi28: number; off_lordo28: number;
  on_pezzi14: number; on_lordo14: number; on_pezzi28: number; on_lordo28: number;
  pezzi14: number; pezzi28: number; lordo14: number; lordo28: number; netto14: number; netto28: number;
  ordini14: number; ordini28: number; aov_lordo14: number | null;
  sup_new14: number; sup_arr14: number; sup_open: number; ret14: number; ret28: number;
  live: number; draft: number; soldout: number;
};
const MOV_KEYS: (keyof Movimenti)[] = ['off_pezzi14', 'off_lordo14', 'off_pezzi28', 'off_lordo28', 'on_pezzi14', 'on_lordo14', 'on_pezzi28', 'on_lordo28', 'pezzi14', 'pezzi28', 'lordo14', 'lordo28', 'netto14', 'netto28', 'ordini14', 'ordini28', 'aov_lordo14', 'sup_new14', 'sup_arr14', 'sup_open', 'ret14', 'ret28', 'live', 'draft', 'soldout'];
export async function fetchMovimenti14gg(): Promise<Movimenti> {
  const { data, error } = await supabase.from('v_movimenti_14gg').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Record<string, unknown>;
  const out = {} as Record<string, number | null>;
  for (const k of MOV_KEYS) out[k] = r[k] == null ? (k === 'aov_lordo14' ? null : 0) : Number(r[k]); // numeric cols arrive as strings via PostgREST
  return out as unknown as Movimenti;
}

export type OpsFlags = { write: boolean; autopush: boolean; hold_raises: boolean; expose_buffer: number; ai_enabled: boolean };
export async function fetchOpsFlags(): Promise<OpsFlags> {
  const { data } = await supabase.from('v_ops_flags').select('*').maybeSingle();
  const r = (data ?? {}) as Record<string, unknown>;
  // shopify_* flags arrive as text from app_flags; ai_enabled arrives as a real boolean from app_config.
  const b = (v: unknown) => v === true || v === 'true' || v === '1' || v === 'on' || v === 'yes';
  return { write: b(r.shopify_write_enabled), autopush: b(r.shopify_autopush_enabled), hold_raises: b(r.shopify_hold_raises), expose_buffer: Number(r.shopify_expose_buffer ?? 0), ai_enabled: b(r.ai_enabled) };
}

export type HealthRow = { k: string; label: string; n: number; severity: string };
export async function fetchHealthLatest(): Promise<{ day: string | null; rows: HealthRow[] }> {
  const last = await supabase.from('health_log').select('day').order('day', { ascending: false }).limit(1);
  const day = last.data && last.data[0] ? (last.data[0] as { day: string }).day : null;
  if (!day) return { day: null, rows: [] };
  const { data } = await supabase.from('health_log').select('k,label,n,severity').eq('day', day);
  const rank = (s: string) => (s === 'bad' ? 0 : s === 'warn' ? 1 : 2);
  const rows = ((data ?? []) as HealthRow[]).sort((a, b) => rank(a.severity) - rank(b.severity) || a.k.localeCompare(b.k));
  return { day, rows };
}

// ---------- PAGE: Salute — per-person digest (brief 2026-07-08) ----------
// Movements of the last 14 days split by the person responsible. Aggregate headline numbers come
// from v_digest_persone (one row); each KPI has a drill-down list from a dedicated view. Read-only.
export type DigestPersone = {
  gin_ordini14: number; gin_ordini28: number; gin_evasi14: number; gin_evasi28: number; gin_aov14: number | null;
  ben_puliti14: number; ben_resi14: number; ben_spese14: number; ben_todo: number;
  dan_log14: number; dan_attori14: number; dan_health_ok: number; dan_health_warn: number; dan_health_bad: number; dan_ce_bad: number;
};
const DIGEST_KEYS: (keyof DigestPersone)[] = ['gin_ordini14', 'gin_ordini28', 'gin_evasi14', 'gin_evasi28', 'gin_aov14', 'ben_puliti14', 'ben_resi14', 'ben_spese14', 'ben_todo', 'dan_log14', 'dan_attori14', 'dan_health_ok', 'dan_health_warn', 'dan_health_bad', 'dan_ce_bad'];
export async function fetchDigestPersone(): Promise<DigestPersone> {
  const { data, error } = await supabase.from('v_digest_persone').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Record<string, unknown>;
  const out = {} as Record<string, number | null>;
  for (const k of DIGEST_KEYS) out[k] = r[k] == null ? (k === 'gin_aov14' ? null : 0) : Number(r[k]); // numeric cols arrive as strings via PostgREST
  return out as unknown as DigestPersone;
}

// Live count of applied DB migrations (safe subset via the SECURITY DEFINER view). Edge-function
// versions are NOT in the DB — the app keeps them as a static reference (EDGE_FUNCTIONS in Salute.tsx).
export async function fetchDigestVersioni(): Promise<{ migr_n: number }> {
  const { data } = await supabase.from('v_digest_versioni').select('migr_n').maybeSingle();
  return { migr_n: Number((data as { migr_n?: number } | null)?.migr_n ?? 0) };
}

export type DigestOrdine = { order_number: string | null; customer_name: string | null; data: string | null; evaso: boolean; gross_total: number | null };
export async function fetchDigestOrdini(): Promise<DigestOrdine[]> {
  const { data, error } = await supabase.from('v_digest_ordini_14gg').select('*').limit(200);
  if (error) throw new Error(error.message);
  return ((data ?? []) as DigestOrdine[]).map((r) => ({ ...r, gross_total: r.gross_total == null ? null : Number(r.gross_total) }));
}

export type DigestPulizia = { data: string | null; op: string | null; chi: string | null; tbl: string | null; row_id: string | null };
export async function fetchDigestPulizia(): Promise<DigestPulizia[]> {
  const { data, error } = await supabase.from('v_digest_pulizia_14gg').select('*').limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as DigestPulizia[];
}

export type DigestSpesa = { data: string | null; op: string | null; chi: string | null; operazione: string | null; costo: number | null };
export async function fetchDigestSpese(): Promise<DigestSpesa[]> {
  const { data, error } = await supabase.from('v_digest_spese_14gg').select('*').limit(200);
  if (error) throw new Error(error.message);
  return ((data ?? []) as DigestSpesa[]).map((r) => ({ ...r, costo: r.costo == null ? null : Number(r.costo) }));
}

export type DigestAttore = { chi: string | null; n: number };
export async function fetchDigestLogAttori(): Promise<DigestAttore[]> {
  const { data, error } = await supabase.from('v_digest_log_attori_14gg').select('*').limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as DigestAttore[]).map((r) => ({ chi: r.chi, n: Number(r.n) }));
}

// Shipping has no courier API (TWS sends LDV lists by email, tracked in the Cowork digest). These two are
// INFORMATIVE proxies, not alarms: last offline (Qromo) sale date, and recent online orders not yet fulfilled.
export async function fetchOpsExtra(): Promise<{ lastQromo: string | null; unfulfilledRecent: number }> {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [q, o] = await Promise.all([
    supabase.from('qromo_sales').select('data').order('data', { ascending: false }).limit(1),
    supabase.from('shopify_orders').select('order_id', { count: 'exact', head: true })
      .gte('created_at_shop', since).or('fulfillment_status.is.null,fulfillment_status.eq.unfulfilled'),
  ]);
  return {
    lastQromo: q.data && q.data[0] ? (q.data[0] as { data: string }).data : null,
    unfulfilledRecent: o.count ?? 0,
  };
}

// ---------- product detail drawer: live Shopify qty per codice + purchase history ----------
const cnorm = (s: string) => (s || '').toUpperCase().replace(/\s+/g, '_');
export async function fetchShopStockMap(): Promise<Map<string, number>> {
  const { data } = await supabase.from('shopify_stock').select('codice, shopify_qty');
  const m = new Map<string, number>();
  (data ?? []).forEach((r: { codice: string; shopify_qty: number }) => m.set(cnorm(r.codice), Number(r.shopify_qty)));
  return m;
}
export type PurchaseRow = { id: string; data: string | null; quantita: number; costo_unitario: number | null; fornitore: string | null };
export async function fetchPurchasesByCodice(codice: string): Promise<PurchaseRow[]> {
  const { data } = await supabase.from('purchases').select('id,data,quantita,costo_unitario,fornitore')
    .eq('codice_norm', cnorm(codice)).order('data', { ascending: false }).limit(60);
  return (data ?? []) as PurchaseRow[];
}
// rettifiche stock (conte, cambi) per la scheda prodotto: il +1 da conta DEVE vedersi (item 4)
export type AdjustmentRow = { id: string; data: string | null; qty_delta: number; motivo: string | null };
export async function fetchAdjustmentsByCodice(codice: string): Promise<AdjustmentRow[]> {
  const { data } = await supabase.from('stock_adjustments').select('id,data,qty_delta,motivo')
    .eq('codice_norm', cnorm(codice)).order('data', { ascending: false }).limit(60);
  return (data ?? []) as AdjustmentRow[];
}

// ---------- suppliers: which ones are active (have orders) vs old ----------
export async function fetchActiveFornitori(): Promise<string[]> {
  const { data } = await supabase.from('supplier_orders').select('fornitore');
  return [...new Set((data ?? []).map((r: { fornitore: string }) => r.fornitore).filter(Boolean))] as string[];
}
// edit/correct a registered arrival: set the arrived TOTAL (stock follows the delta);
// costo opzionale per risolvere le righe WIP all'arrivo. confirmDup (fix a, 31-07): il server
// blocca un possibile doppio arrivo in giornata; si supera solo dopo conferma dell'utente.
export const setArrival = (orderId: string, qty: number, data: string, pin: string, chi: string, costo?: number | null, confirmDup = false, force = false) =>
  writeApi('arrival_set', { order_id: orderId, qty, data, ...(costo != null ? { costo_unitario: costo } : {}), ...(confirmDup ? { confirm_duplicato: true } : {}) }, pin, chi, force);

// cancella una riga ordine fornitore (item 10); il server blocca se ha arrivi registrati
export const deleteOrder = (orderId: string, pin: string, chi: string) =>
  writeApi('order_delete', { order_id: orderId }, pin, chi);

// archivio riordino (item 20): nasconde/ripristina un prodotto dalla lista riordino
export const archiveReorder = (codice: string, archived: boolean, pin: string, chi: string) =>
  writeApi('reorder_archive', { codice, archived }, pin, chi);

// last sale (date + amount) per product, for the conto-vendita list
export async function fetchLastSaleMap(): Promise<Map<string, { date: string | null; price: number | null }>> {
  const { data } = await supabase.from('v_last_sale').select('codice_norm, last_date, last_price');
  const m = new Map<string, { date: string | null; price: number | null }>();
  (data ?? []).forEach((r: { codice_norm: string; last_date: string | null; last_price: number | null }) =>
    m.set(r.codice_norm, { date: r.last_date, price: r.last_price }));
  return m;
}

// ---------- CE dettagliato + drilldown (migr 0108) ----------
// La griglia completa riga x mese, come il vecchio CE_Master, con drilldown reale su ogni cella.
// I numeri arrivano dalle stesse viste del Cruscotto (parity-validate); le tre viste v_ce_drill_*
// restituiscono le RIGHE che sommano alla cella (verificato diff 0,00, Amimì e Totale).
export type CeFull = {
  year: number; month: number;
  online_lordo: number; online_netto: number; online_pezzi: number;
  offline_lordo: number; offline_netto: number; offline_pezzi: number;
  b2b_lordo: number; b2b_netto: number; b2b_pezzi: number;
  omni_netto: number; cogs: number; packaging: number; commissioni: number;
  logistica_var: number; resi: number; salari: number; tasse: number;
  logistica_mag: number; opex: number; eventi: number; marketing: number;
  mc1: number; mc2: number;
};
const CE_COLS = 'year,month,online_lordo,online_netto,online_pezzi,offline_lordo,offline_netto,offline_pezzi,b2b_lordo,b2b_netto,b2b_pezzi,omni_netto,cogs,packaging,commissioni,logistica_var,resi,salari,tasse,logistica_mag,opex,eventi,marketing,mc1,mc2';
/** Full CE grid for the active scope. Amimì = v_ce_amimi_summary (brand), Totale = v_ce_totale. */
export async function fetchCeGrid(scope: 'amimi' | 'totale'): Promise<CeFull[]> {
  const view = scope === 'amimi' ? 'v_ce_amimi_summary' : 'v_ce_totale';
  const { data, error } = await supabase.from(view).select(CE_COLS).eq('year', nowYear()).order('month');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => {
    const o = {} as Record<string, number>;
    CE_COLS.split(',').forEach((c) => { o[c] = Number(r[c] ?? 0); });
    return o as unknown as CeFull;
  });
}

export type DrillExp = { date_paid: string | null; operazione: string | null; categoria: string | null; sottocategoria: string | null; costo: number; amimi: boolean };
/** Righe di spesa dietro una voce di costo (sal/tasse/opex/ev/mkt/lvar/lmag). amimiOnly per lo scope brand. */
export async function fetchDrillExpense(ceLine: string, month: number, amimiOnly: boolean): Promise<DrillExp[]> {
  let q = supabase.from('v_ce_drill_expense')
    .select('date_paid,operazione,categoria,sottocategoria,costo,amimi')
    .eq('ce_line', ceLine).eq('year', nowYear()).eq('month', month);
  if (amimiOnly) q = q.eq('amimi', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as DrillExp[]).map((r) => ({ ...r, costo: Number(r.costo) })).sort((a, b) => a.costo - b.costo);
}

export type DrillCogs = { codice: string; item: string | null; variant: string | null; canale: string; qty: number; costo: number };
/** COGS per codice (aggregato dalle righe di venduto). includeGift = scope Totale. */
export async function fetchDrillCogs(month: number, includeGift: boolean): Promise<DrillCogs[]> {
  const canali = includeGift ? ['online', 'offline', 'b2b', 'gift'] : ['online', 'offline', 'b2b'];
  const { data, error } = await supabase.from('v_ce_drill_cogs')
    .select('codice,item,variant,canale,qty,costo').eq('year', nowYear()).eq('month', month).in('canale', canali);
  if (error) throw new Error(error.message);
  // una riga per line item/vendita: aggrega per codice per una lista prodotti leggibile
  const byC = new Map<string, DrillCogs>();
  ((data ?? []) as DrillCogs[]).forEach((r) => {
    const key = r.codice ?? '—';
    const e = byC.get(key) ?? { codice: key, item: r.item, variant: r.variant, canale: r.canale, qty: 0, costo: 0 };
    e.qty += Number(r.qty) || 0; e.costo += Number(r.costo) || 0;
    if (!e.item && r.item) { e.item = r.item; e.variant = r.variant; }
    byC.set(key, e);
  });
  return [...byC.values()].filter((r) => r.costo !== 0 || r.qty !== 0).sort((a, b) => a.costo - b.costo);
}

export type DrillSale = { canale: string; ref: string | null; descr: string | null; data: string | null; qty: number | null; lordo: number; commissioni: number; refund: number; is_gift: boolean };
/** Righe di ricavo (ordini online, scontrini, gift, b2b) di un mese, per i canali richiesti. */
export async function fetchDrillSales(canali: string[], month: number): Promise<DrillSale[]> {
  const { data, error } = await supabase.from('v_ce_drill_sales')
    .select('canale,ref,descr,data,qty,lordo,commissioni,refund,is_gift')
    .eq('year', nowYear()).eq('month', month).in('canale', canali);
  if (error) throw new Error(error.message);
  return ((data ?? []) as DrillSale[]).map((r) => ({
    ...r, qty: r.qty == null ? null : Number(r.qty), lordo: Number(r.lordo), commissioni: Number(r.commissioni), refund: Number(r.refund),
  }));
}

// ---------- Audit dashboard 2026-09-06 (migr 0109): freschezza fonti, margini, clienti, spedizioni, sconti ----------
// PostgREST consegna i numeric come stringhe: si convertono qui, una volta, mai nei componenti.
function numify<T extends Record<string, unknown>>(r: T, keys: string[]): T {
  const o = { ...r } as Record<string, unknown>;
  for (const k of keys) o[k] = Number(o[k]) || 0;
  return o as T;
}

export type Freschezza = {
  ultimo_ordine_shopify: string | null; ultimo_sync_ordini: string | null; ultima_vendita_qromo: string | null;
  meta_ads_ultimo_giorno: string | null; meta_ads_ultimo_pull: string | null; ultimo_batch_spedizioni: string | null;
  ultimo_sync_stock: string | null; ultimo_health: string | null; ultima_spesa_pagata: string | null; ultimo_arrivo: string | null;
};
export async function fetchFreschezza(): Promise<Freschezza | null> {
  const { data, error } = await supabase.from('v_fonti_freschezza').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Freschezza | null) ?? null;
}

/** Netto dei primi N giorni del mese in corso contro gli stessi N giorni del mese precedente (online + POS,
 *  dalle righe di v_ce_drill_sales che ricostruiscono il lordo del CE). La Home confrontava il mese
 *  parziale col mese pieno e a inizio mese scriveva "-71%". */
export async function fetchNettoMtd(): Promise<{ cur: number; prev: number; day: number } | null> {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth() + 1; const day = now.getDate();
  if (m < 2) return null;
  const { data, error } = await supabase.from('v_ce_drill_sales').select('month,data,lordo')
    .eq('year', y).in('month', [m, m - 1]).in('canale', ['online', 'offline']);
  if (error) throw new Error(error.message);
  let cur = 0, prev = 0;
  (data ?? []).forEach((r: { month: number; data: string | null; lordo: number }) => {
    const d = r.data ? Number(String(r.data).slice(8, 10)) : 0;
    if (d < 1 || d > day) return;
    if (Number(r.month) === m) cur += Number(r.lordo) || 0; else prev += Number(r.lordo) || 0;
  });
  return { cur: cur / 1.22, prev: prev / 1.22, day };
}

export type MargOrdine = {
  order_id: string; order_number: string | null; created_at_shop: string | null; year: number; month: number;
  pezzi: number; ricavo_lordo: number; sconto: number; ricavo_netto: number; cogs: number; commissioni: number; packaging: number;
  spedizione_incassata: number; rimborso: number; margine_contribuzione: number; margine_pct: number; refunded: boolean; financial_status: string | null;
  /** false = la vista non sa calcolare il margine (COGS mancante): non e' una perdita, e' un buco dati */
  margine_noto: boolean;
};
const MO_NUM = ['pezzi', 'ricavo_lordo', 'sconto', 'ricavo_netto', 'cogs', 'commissioni', 'packaging', 'spedizione_incassata', 'rimborso', 'margine_contribuzione', 'margine_pct', 'month', 'year'];
export async function fetchMargineOrdini(): Promise<MargOrdine[]> {
  const { data, error } = await supabase.from('v_margine_ordine').select('*').eq('year', nowYear()).order('created_at_shop', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as MargOrdine[]).map((r) => ({ ...numify(r, MO_NUM), margine_noto: r.margine_contribuzione != null }));
}

export type MargSku = {
  codice: string; codice_norm: string; item: string | null; variant: string | null; year: number; month: number; canale: string;
  pezzi: number; ricavo_lordo: number; sconto: number; ricavo_netto: number; cogs: number; commissioni: number; packaging: number;
  margine_contribuzione: number; margine_pct: number; pezzi_in_ordini_rimborsati: number;
};
const MS_NUM = ['pezzi', 'ricavo_lordo', 'sconto', 'ricavo_netto', 'cogs', 'commissioni', 'packaging', 'margine_contribuzione', 'margine_pct', 'pezzi_in_ordini_rimborsati', 'month', 'year'];
export async function fetchMargineSku(): Promise<MargSku[]> {
  const { data, error } = await supabase.from('v_margine_sku').select('*').eq('year', nowYear());
  if (error) throw new Error(error.message);
  return ((data ?? []) as MargSku[]).map((r) => numify(r, MS_NUM));
}

export type ClienteRfm = { email: string; primo_ordine: string | null; ultimo_ordine: string | null; recency_giorni: number; frequency: number; monetary: number; aov: number; segmento: string };
export async function fetchClientiRfm(): Promise<ClienteRfm[]> {
  const { data, error } = await supabase.from('v_clienti_rfm').select('*').order('monetary', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ClienteRfm[]).map((r) => numify(r, ['recency_giorni', 'frequency', 'monetary', 'aov']));
}
export type Coorte = { coorte: string; maturita_giorni: number; clienti: number; ricomprato_30gg: number; ricomprato_60gg: number; ricomprato_90gg: number; netto_medio_cliente: number };
export async function fetchCoorti(): Promise<Coorte[]> {
  const { data, error } = await supabase.from('v_clienti_coorti').select('*').order('coorte');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Coorte[]).map((r) => numify(r, ['maturita_giorni', 'clienti', 'ricomprato_30gg', 'ricomprato_60gg', 'ricomprato_90gg', 'netto_medio_cliente']));
}

export type SpedEcc = { ldv: string | null; order_name: string | null; stato_tws: string | null; stato_raw: string | null; shipped_date: string | null; seen_delivered_at: string | null; updated_at: string | null; customer_name: string | null; data_ordine: string | null; classe: string };
export async function fetchSpedizioniEccezioni(): Promise<SpedEcc[]> {
  const { data, error } = await supabase.from('v_spedizioni_eccezioni').select('*').eq('classe', 'eccezione').order('updated_at', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as SpedEcc[];
}
/** Giorni da ordine a spedizione per mese (migr 0110): data di spedizione TWS, con fulfilled_at solo come
 *  ripiego. fulfilled_at non e' piu' scritto dal sync dopo il cutover (lug 3/175): senza il tracking la
 *  metrica direbbe "nessun ordine evaso". Precisione a giorni interi perche' la fonte e' una DATA. */
/** Spedizioni con data TWS negli ultimi 14 giorni e nei 14 precedenti: sostituisce "ordini evasi"
 *  (gin_evasi14, da fulfilled_at) che dopo il cutover resta a zero. */
export async function fetchSpediti14(): Promise<{ n14: number; n28: number }> {
  const d = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const [a, b] = await Promise.all([
    supabase.from('v_spedizioni_eccezioni').select('ldv', { count: 'exact', head: true }).gte('shipped_date', d(14)),
    supabase.from('v_spedizioni_eccezioni').select('ldv', { count: 'exact', head: true }).gte('shipped_date', d(28)).lt('shipped_date', d(14)),
  ]);
  return { n14: a.count ?? 0, n28: b.count ?? 0 };
}
export type Evasione = { year: number; month: number; ordini: number; spediti: number; giorni_medi: number | null; giorni_mediani: number | null; oltre_3gg: number };
export async function fetchEvasione(): Promise<Evasione[]> {
  const { data, error } = await supabase.from('v_evasione_mensile').select('*').eq('year', nowYear()).order('month');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Evasione[]).map((r) => ({ ...numify(r, ['year', 'month', 'ordini', 'spediti', 'oltre_3gg']), giorni_medi: r.giorni_medi == null ? null : Number(r.giorni_medi), giorni_mediani: r.giorni_mediani == null ? null : Number(r.giorni_mediani) }));
}

export type Sconto = { year: number; month: number; codice: string; ordini: number; netto: number; sconto: number; margine: number; margine_pct_medio: number };
export async function fetchSconti(): Promise<Sconto[]> {
  const { data, error } = await supabase.from('v_sconti_codici').select('*').eq('year', nowYear());
  if (error) throw new Error(error.message);
  return ((data ?? []) as Sconto[]).map((r) => numify(r, ['year', 'month', 'ordini', 'netto', 'sconto', 'margine', 'margine_pct_medio']));
}
