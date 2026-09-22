import { csClient } from './csClient';
import { supabase } from './supabase';

// Letture della sezione "Materie prime" (modulo mat_*, migr 0140, Fase 1 = catalogo in sola lettura).
// Tutto passa dal client con la sessione utente loggato (@amimi.it): la RLS `authenticated` nega ai non
// loggati. Unica lettura col client anon: il flag mat_enabled (vista v_mat_settings), che la Home usa
// per nascondere la tile a modulo spento. Nessuna scrittura da qui: la Fase 2 porta l'edge mat-api.

export const CATEGORIE = ['Tessuto', 'Tessuto velluto', 'Animalier', 'Cocco', 'Vitello stampato', 'Pelle vitello', 'Vernice', 'Crosta/Velour', 'Nappa', 'Nastri', 'Accessori metallici'] as const;
export type Categoria = typeof CATEGORIE[number];

// Segnaposto colorato per categoria (stessi colori del select Notion di Ginevra): le card senza foto restano leggibili.
export const TINTA: Record<string, [string, string]> = {
  'Tessuto': ['#5b8def', '#3b62c2'], 'Tessuto velluto': ['#4d6fd6', '#2f4aa3'], 'Animalier': ['#e8934a', '#b8622a'],
  'Cocco': ['#9c6b45', '#6b4429'], 'Vitello stampato': ['#e2b93b', '#b08a1d'], 'Pelle vitello': ['#5aa86c', '#3b7d4b'],
  'Vernice': ['#8a67d6', '#5f43a8'], 'Crosta/Velour': ['#9a9a9a', '#6e6e6e'], 'Nappa': ['#e07aa0', '#b04f75'],
  'Nastri': ['#d9534f', '#a63a36'], 'Accessori metallici': ['#7d8a99', '#55616e'],
};

export type MatCatalogo = {
  item_id: string; supplier_id: string; fornitore: string; categoria: string; materiale: string; articolo_fornitore: string | null;
  colore: string | null; unita: string | null; attivo: boolean; note: string | null;
  offerta_id: string | null; offerta_tipo: string | null; offerta_prezzo: number | null; offerta_prezzo_text: string | null;
  offerta_unita: string | null; disponibilita: string | null; min_ordine: string | null; lead_time: string | null;
  offerta_data: string | null; offerta_fonte: string | null;
  acquisto_documento: string | null; acquisto_data: string | null; acquisto_quantita: number | null; acquisto_unita: string | null;
  acquisto_prezzo: number | null; acquisto_importo: number | null; acquistato: boolean;
  prezzo_rif: number | null; prezzo_rif_text: string | null; unita_rif: string | null;
  foto_path: string | null; n_foto: number; n_schede: number;
  condizioni_pagamento: string | null; deposito_luogo: string | null; fornitore_email: string | null; fornitore_telefono: string | null;
  fornitore_referente: string | null;
};
export type MatFornitore = {
  id: string; nome: string; ragione_sociale: string | null; categoria_principale: string | null; email: string | null; telefono: string | null;
  referente: string | null; indirizzo: string | null; piva_vat: string | null; deposito_luogo: string | null; condizioni_pagamento: string | null;
  note: string | null; attivo: boolean; n_materiali: number; categorie: string | null; n_offerte: number; n_ordini: number;
  tot_imponibile: number | null; ultimo_acquisto: string | null; n_asset: number;
};
export type MatAcquisto = {
  line_id: string; order_id: string; supplier_id: string; fornitore: string; tipo_documento: string | null; numero_documento: string;
  data_documento: string | null; valuta: string; stato: string; totale_imponibile: number | null; totale_iva: number | null;
  totale_documento: number | null; condizioni_pagamento: string | null; item_id: string; categoria: string; materiale: string; colore: string | null;
  quantita: number | null; unita: string | null; prezzo_unitario: number | null; sconto_text: string | null; importo: number | null;
  iva_percent: number | null; note: string | null;
};
export type MatAsset = {
  id: string; supplier_id: string; item_id: string | null; materiale: string | null; order_id: string | null; path: string;
  tipo: 'foto' | 'scheda_tecnica' | 'proforma' | 'documento' | 'campione'; titolo: string | null; mime: string | null; bytes: number | null;
  fonte: string | null; created_at: string; fornitore: string; item_materiale: string | null; item_colore: string | null; ordine_documento: string | null;
};

/** Flag del modulo, letto col client anon (v_mat_settings espone solo questa chiave). Errore o assenza = spento. */
export async function fetchMatEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from('v_mat_settings').select('key,value').eq('key', 'mat_enabled').maybeSingle();
  if (error) return false;
  const v = String((data as { value?: string } | null)?.value ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}

export async function fetchCatalogo(): Promise<MatCatalogo[]> {
  const { data, error } = await csClient.from('v_mat_catalogo').select('*').eq('attivo', true).order('fornitore').order('materiale').order('colore');
  if (error) throw new Error(error.message);
  return (data ?? []) as MatCatalogo[];
}
export async function fetchFornitori(): Promise<MatFornitore[]> {
  const { data, error } = await csClient.from('v_mat_fornitori').select('*').order('nome');
  if (error) throw new Error(error.message);
  return (data ?? []) as MatFornitore[];
}
export async function fetchAcquisti(): Promise<MatAcquisto[]> {
  const { data, error } = await csClient.from('v_mat_acquisti').select('*').order('data_documento', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MatAcquisto[];
}
export async function fetchAssets(supplierId: string): Promise<MatAsset[]> {
  const { data, error } = await csClient.from('v_mat_assets').select('*').eq('supplier_id', supplierId).order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as MatAsset[];
}

// URL firmati (bucket privato mat-assets): 1 ora, in blocco. Mappa path -> url. Stesso pattern di leadApi.
export async function signedUrls(paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const uniq = [...new Set(paths.filter((p): p is string => !!p))];
  if (!uniq.length) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    const { data, error } = await csClient.storage.from('mat-assets').createSignedUrls(chunk, 3600);
    if (error) throw new Error(error.message);
    for (const d of data ?? []) if (d.signedUrl && d.path) out[d.path] = d.signedUrl;
  }
  return out;
}

// ---- helper di presentazione ----
const nf = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: n < 1 ? 3 : 2, maximumFractionDigits: n < 1 ? 3 : 2 });
/** "66,00 €/mq" da un numero, oppure il testo fedele ("40-45/mq") quando il prezzo e' un range o a scaglioni. */
export function fmtPrezzo(prezzo: number | null | undefined, text: string | null | undefined, unita: string | null | undefined): string {
  if (prezzo != null) return `${nf(Number(prezzo))} €${unita ? '/' + unita : ''}`;
  if (text) return /€/.test(text) ? text : `€ ${text}`;
  return 'prezzo n/d';
}
export const groupKey = (r: { fornitore: string; materiale: string }) => `${r.fornitore}|${r.materiale.toLowerCase()}`;

export type MatGruppo = {
  key: string; fornitore: string; supplier_id: string; categoria: string; materiale: string; articolo_fornitore: string | null;
  righe: MatCatalogo[]; foto_path: string | null; acquistato: boolean; prezzo: string; unita: string | null; n_foto: number;
};
/** Una card per materiale (decisione D3): le righe colore dello stesso materiale si fondono, i prezzi si riassumono. */
export function raggruppa(rows: MatCatalogo[]): MatGruppo[] {
  const m = new Map<string, MatGruppo>();
  for (const r of rows) {
    const k = groupKey(r);
    const g = m.get(k) ?? { key: k, fornitore: r.fornitore, supplier_id: r.supplier_id, categoria: r.categoria, materiale: r.materiale, articolo_fornitore: r.articolo_fornitore, righe: [], foto_path: null, acquistato: false, prezzo: '', unita: r.unita_rif, n_foto: 0 };
    g.righe.push(r);
    if (!g.foto_path && r.foto_path) g.foto_path = r.foto_path;
    g.acquistato = g.acquistato || r.acquistato;
    g.n_foto = Math.max(g.n_foto, Number(r.n_foto ?? 0));
    m.set(k, g);
  }
  for (const g of m.values()) {
    const nums = g.righe.map((r) => r.prezzo_rif).filter((p): p is number => p != null).map(Number);
    const unita = g.righe.find((r) => r.unita_rif)?.unita_rif ?? null;
    if (nums.length) {
      const lo = Math.min(...nums), hi = Math.max(...nums);
      g.prezzo = lo === hi ? fmtPrezzo(lo, null, unita) : `da ${nf(lo)} a ${nf(hi)} €${unita ? '/' + unita : ''}`;
    } else {
      g.prezzo = fmtPrezzo(null, g.righe.find((r) => r.prezzo_rif_text)?.prezzo_rif_text, unita);
    }
    g.unita = unita;
  }
  return [...m.values()];
}
