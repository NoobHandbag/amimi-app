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

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('codice,item,variant,categoria,image_url,retail_price')
    .order('item');
  if (error) throw new Error(error.message);
  return (data ?? []) as Product[];
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
  valore: number; retail_price: number | null;
};
export async function fetchInventory(): Promise<InvFull[]> {
  const { data, error } = await supabase
    .from('v_inventory')
    .select('codice,item,variant,categoria,giacenza_attuale,in_conto_vendita,disponibili_da_vendere,valore,retail_price')
    .order('giacenza_attuale');
  if (error) throw new Error(error.message);
  return (data ?? []) as InvFull[];
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

export const oggi = () => new Date().toISOString().slice(0, 10);
