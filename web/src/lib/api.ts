import { supabase } from './supabase';

const FN = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/write-api';

export type Product = {
  codice: string; item: string | null; variant: string | null;
  categoria: string | null; image_url: string | null; retail_price: number | null;
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
    .select('codice,item,variant,categoria,image_url,retail_price')
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

export type InvFull = {
  codice: string; item: string | null; variant: string | null; categoria: string | null;
  giacenza_attuale: number; in_conto_vendita: number; disponibili_da_vendere: number;
  valore: number; retail_price: number | null; last_sale: string | null; on_shopify: boolean; image_url: string | null;
};
export async function fetchInventory(): Promise<InvFull[]> {
  const { data, error } = await supabase
    .from('v_inventory')
    .select('codice,item,variant,categoria,giacenza_attuale,in_conto_vendita,disponibili_da_vendere,valore,retail_price,last_sale,on_shopify,image_url')
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

export type CeTot = { year: number; month: number; online_netto: number; offline_netto: number; lordo: number; netto: number; mc1: number; mc2: number };
/** Whole-business P&L (CE_TOTALE), sheet-sourced. Includes January. */
export async function fetchCeTotale(): Promise<CeTot[]> {
  const { data, error } = await supabase
    .from('ce_totale_monthly')
    .select('year,month,online_netto,offline_netto,lordo,netto,mc1,mc2')
    .eq('year', 2026)
    .order('month');
  if (error) throw new Error(error.message);
  return (data ?? []) as CeTot[];
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
