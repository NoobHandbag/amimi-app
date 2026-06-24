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

export const oggi = () => new Date().toISOString().slice(0, 10);
