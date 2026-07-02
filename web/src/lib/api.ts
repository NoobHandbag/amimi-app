import { supabase } from './supabase';
import { nowYear } from './helpers';

const FN = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/write-api';

export type Product = {
  codice: string; item: string | null; variant: string | null;
  categoria: string | null; image_url: string | null; retail_price: number | null; cogs: number | null;
};
export type Supplier = { name: string; kind: string | null };

/** The single write path: PIN-checked Edge Function. Throws Error(message) on failure. */
export async function writeApi(action: string, payload: Record<string, unknown>, pin: string, chi: string) {
  const r = await fetch(FN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload, pin, chi }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Errore ${r.status}`);
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
};
export async function fetchInventory(): Promise<InvFull[]> {
  const { data, error } = await supabase
    .from('v_inventory')
    .select('codice,item,variant,categoria,giacenza_attuale,in_conto_vendita,disponibili_da_vendere,valore,retail_price,cogs,last_sale,on_shopify,image_url')
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

export type Activity = { id: number; tbl: string; chi: string | null; ts: string; codice: string | null };
export async function fetchRecent(): Promise<Activity[]> {
  const { data } = await supabase.from('change_log').select('id,tbl,chi,ts,after').order('ts', { ascending: false }).limit(15);
  return (data ?? []).map((r: { id: number; tbl: string; chi: string | null; ts: string; after: { codice?: string } | null }) =>
    ({ id: r.id, tbl: r.tbl, chi: r.chi, ts: r.ts, codice: r.after?.codice ?? null }));
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
export type OrdLine = Ordine & { nuovo_riordino: string | null; costo_unitario: number | null; data_consegna: string | null };
export type OrdGruppo = { gruppo: string; fornitore: string | null; data_ordine: string | null; righe: OrdLine[]; mancano: number; completo: boolean };

export async function fetchOrdiniGruppi(): Promise<OrdGruppo[]> {
  const { data, error } = await supabase
    .from('v_ordini_arrivo')
    .select('id,gruppo,codice,item,variant,fornitore,qty_ordered,qty_arrived,mancano,completo,nuovo_riordino,costo_unitario,data_consegna,data_ordine,image_url')
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
  source: string | null; is_new_model: boolean; bucket: ProdBucket; bucket_rank: number;
};
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
export async function approveExpense(id: string, status: 'approved' | 'rejected', edits: Record<string, unknown> | null, pin: string, chi: string) {
  return writeApi('expense_approve', { id, status, edits: edits ?? {} }, pin, chi);
}

// ---------- SECOND FLOW: sale → product correction ----------
export type SaleRow = { source: 'qromo' | 'shopify'; id: string; data: string | null; qty: number; price: number | null; descr: string; ref: string };
export async function fetchSalesByCodice(codice: string): Promise<SaleRow[]> {
  const [q, s] = await Promise.all([
    supabase.from('qromo_sales').select('id,data,quantita,prezzo,nome,cognome').eq('codice', codice).order('data', { ascending: false }).limit(40),
    supabase.from('shopify_line_items').select('id,created_at,quantita,price,lineitem_name,order_id').eq('codice', codice).order('created_at', { ascending: false }).limit(40),
  ]);
  // resolve Shopify order customer names, so returns show WHO bought (not the product name)
  const oids = [...new Set((s.data ?? []).map((r: { order_id: string }) => r.order_id).filter(Boolean))];
  const cust = new Map<string, string>();
  if (oids.length) {
    const { data: ords } = await supabase.from('shopify_orders').select('order_id, customer_name').in('order_id', oids);
    (ords ?? []).forEach((o: { order_id: string; customer_name: string | null }) => { if (o.customer_name) cust.set(o.order_id, o.customer_name); });
  }
  const out: SaleRow[] = [];
  (q.data ?? []).forEach((r: { id: string; data: string; quantita: number; prezzo: number; nome: string; cognome: string }) =>
    out.push({ source: 'qromo', id: r.id, data: r.data, qty: Number(r.quantita), price: r.prezzo, descr: `${r.nome ?? ''} ${r.cognome ?? ''}`.trim() || 'Vendita negozio', ref: 'POS' }));
  (s.data ?? []).forEach((r: { id: string; created_at: string; quantita: number; price: number; lineitem_name: string; order_id: string }) =>
    out.push({ source: 'shopify', id: r.id, data: (r.created_at ?? '').slice(0, 10), qty: Number(r.quantita), price: r.price, descr: cust.get(r.order_id) ?? r.lineitem_name ?? 'Ordine online', ref: '#' + (r.order_id ?? '') }));
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
  if (oids.length) {
    const { data: ords } = await supabase.from('shopify_orders').select('order_id, customer_name').in('order_id', oids);
    (ords ?? []).forEach((o: { order_id: string; customer_name: string | null }) => { if (o.customer_name) cust.set(o.order_id, o.customer_name); });
  }
  const lbl = (codice: string) => { const p = pm.get(codice); return { item: p?.item ?? null, variant: p?.variant ?? null }; };
  const out: RecentSale[] = [];
  (q.data ?? []).forEach((r: { id: string; codice: string; data: string; quantita: number; prezzo: number; nome: string; cognome: string }) =>
    out.push({ source: 'qromo', id: r.id, codice: r.codice, ...lbl(r.codice), data: r.data, qty: Number(r.quantita), price: r.prezzo, descr: `${r.nome ?? ''} ${r.cognome ?? ''}`.trim() || 'Vendita negozio', ref: 'POS' }));
  (s.data ?? []).forEach((r: { id: string; codice: string; created_at: string; quantita: number; price: number; lineitem_name: string; order_id: string }) =>
    out.push({ source: 'shopify', id: r.id, codice: r.codice, ...lbl(r.codice), data: (r.created_at ?? '').slice(0, 10), qty: Number(r.quantita), price: r.price, descr: cust.get(r.order_id) ?? r.lineitem_name ?? 'Ordine online', ref: '#' + (r.order_id ?? '') }));
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

// ---------- FLOW 6: NL -> SQL ----------
export type AskResult = { ok?: boolean; sql?: string; rows?: Record<string, unknown>[]; error?: string; needs_key?: boolean };
export const askData = (question: string, pin: string): Promise<AskResult> => fnCall('ask-data', { question, pin }) as Promise<AskResult>;

// ---------- NEW FEATURE: returns & exchanges ----------
export const addReturn = (payload: Record<string, unknown>, pin: string, chi: string) => writeApi('return', payload, pin, chi);

// ---------- NEW FEATURE: reorder board ----------
export type Reorder = { codice: string; item: string | null; variant: string | null; image_url: string | null; giacenza: number; disponibili: number; on_shopify: boolean; venduto_60d: number; in_arrivo: number; giorni_stock: number | null };
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

// ---------- suppliers: which ones are active (have orders) vs old ----------
export async function fetchActiveFornitori(): Promise<string[]> {
  const { data } = await supabase.from('supplier_orders').select('fornitore');
  return [...new Set((data ?? []).map((r: { fornitore: string }) => r.fornitore).filter(Boolean))] as string[];
}
// edit/correct a registered arrival: set the arrived TOTAL (stock follows the delta)
export const setArrival = (orderId: string, qty: number, data: string, pin: string, chi: string) =>
  writeApi('arrival_set', { order_id: orderId, qty, data }, pin, chi);

// last sale (date + amount) per product, for the conto-vendita list
export async function fetchLastSaleMap(): Promise<Map<string, { date: string | null; price: number | null }>> {
  const { data } = await supabase.from('v_last_sale').select('codice_norm, last_date, last_price');
  const m = new Map<string, { date: string | null; price: number | null }>();
  (data ?? []).forEach((r: { codice_norm: string; last_date: string | null; last_price: number | null }) =>
    m.set(r.codice_norm, { date: r.last_date, price: r.last_price }));
  return m;
}
