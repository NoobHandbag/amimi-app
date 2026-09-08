import { csClient } from './csClient';

// Letture e scritture della sezione "Negozi B2B" (modulo lead_*, migr 0111). Tutto passa dal client
// con la sessione utente loggato (@amimi.it): la RLS `authenticated` nega ai non loggati.
// Scrittura UNICA dalla UI: lead_reviews (decisione umana); un trigger a DB la riflette sull'account.

export type Criterio = { punti: number | null; peso: number; prova?: string | null; evidence_id?: string | null };
export type Criteri = Record<string, Criterio>;

export type LeadDossier = {
  id: string;
  nome: string;
  tipo: string;
  gruppo_id: string | null;
  gruppo_nome: string | null;
  indirizzo: string | null;
  citta: string | null;
  provincia: string | null;
  paese: string;
  website: string | null;
  ig_handle: string | null;
  google_maps_url: string | null;
  telefono: string | null;
  email_generica: string | null;
  piva: string | null;
  fonte_seed: string;
  priorita_tipologia: number | null;
  stato_ricerca: 'seed' | 'enriched' | 'scored' | 'reviewed' | 'rejected';
  rejected_motivo: string | null;
  lead_stage: string;
  tier: 'A' | 'B' | 'C' | null;
  gancio: string | null;
  owner_note: string | null;
  contattato_prima: boolean;
  chi: string | null;
  created_at: string;
  updated_at: string;
  score_id: string | null;
  totale: number | null;
  tier_proposto: 'A' | 'B' | 'C' | null;
  criteri: Criteri | null;
  bonus: Record<string, number> | null;
  esclusione: string | null;
  dati_incompleti: boolean | null;
  motivazione: string | null;
  perche_no: string | null;
  rubrica_version: string | null;
  scored_at: string | null;
  ultima_review_azione: string | null;
  ultima_review_chi: string | null;
  ultima_review_at: string | null;
  shot_home: string | null;
  shot_home_mobile: string | null;
  shot_ig: string | null;
  shot_maps: string | null;
  ig_metrics: { follower?: number | null; seguiti?: number | null; post?: number | null; bio?: string | null; login_wall?: boolean; errore?: string; post_alt?: string[] } | null;
  maps: { rating?: number | null; recensioni?: number | null; categoria?: string | null; indirizzo?: string | null; telefono?: string | null; orari?: string | null; sito?: string | null; errore?: string; chiuso_definitivamente?: boolean } | null;
  brands_carried: { fonte?: string; vendors?: string[] | null; peer_match?: string[]; lista_pagina?: string | null } | null;
  price_band: { n_prodotti?: number; tutti?: { n: number; min: number; mediana: number; max: number } | null; borse?: { n: number; min: number; mediana: number; max: number } | null } | null;
  n_evidenze: number;
  n_contatti: number;
};

export type LeadEvidence = {
  id: string;
  tipo: string;
  payload: Record<string, unknown> | null;
  asset_path: string | null;
  raccolto_da: string;
  note: string | null;
  captured_at: string;
};

export type LeadContact = { id: string; nome: string | null; ruolo: string | null; email: string | null; telefono: string | null; linkedin_url: string | null; fonte: string | null; opt_out: boolean; note: string | null };
export type LeadReview = { id: string; chi: string; azione: string; tier: string | null; motivo: string | null; nota: string | null; created_at: string };

export const TIPO_LABEL: Record<string, string> = {
  boutique: 'Boutique', concept_store: 'Concept store', hotel_shop: 'Boutique hotel', gruppo_multimarca: 'Gruppo / catena',
  corner_department: 'Corner department', negozio_regalo: 'Negozio regalo', online_multibrand: 'Multibrand online',
};
export const STATO_LABEL: Record<string, string> = { seed: 'Da raccogliere', enriched: 'Raccolto', scored: 'Valutato', reviewed: 'Rivisto', rejected: 'Scartato' };
export const CRITERI_ORDER: { key: string; label: string; peso: number }[] = [
  { key: 'brand', label: 'Brand a scaffale', peso: 25 },
  { key: 'stile', label: 'Stile e identita’ visiva', peso: 20 },
  { key: 'posto', label: 'Posto e cliente', peso: 20 },
  { key: 'vitalita', label: 'Vitalita’', peso: 15 },
  { key: 'raggiungibilita', label: 'Raggiungibilita’', peso: 10 },
  { key: 'digitale', label: 'Presenza digitale', peso: 10 },
];

export async function fetchDossier(): Promise<LeadDossier[]> {
  const { data, error } = await csClient.from('v_lead_dossier').select('*').order('totale', { ascending: false, nullsFirst: false }).order('nome');
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadDossier[];
}

export async function fetchEvidence(accountId: string): Promise<LeadEvidence[]> {
  const { data, error } = await csClient.from('lead_evidence').select('id,tipo,payload,asset_path,raccolto_da,note,captured_at').eq('account_id', accountId).order('captured_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadEvidence[];
}

export async function fetchContacts(accountId: string): Promise<LeadContact[]> {
  const { data, error } = await csClient.from('lead_contacts').select('id,nome,ruolo,email,telefono,linkedin_url,fonte,opt_out,note').eq('account_id', accountId).order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadContact[];
}

export async function fetchReviews(accountId: string): Promise<LeadReview[]> {
  const { data, error } = await csClient.from('lead_reviews').select('id,chi,azione,tier,motivo,nota,created_at').eq('account_id', accountId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadReview[];
}

// URL firmati (bucket privato lead-assets): 1 ora, in blocco. Mappa path -> url.
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(paths.filter(Boolean))];
  if (!uniq.length) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    const { data, error } = await csClient.storage.from('lead-assets').createSignedUrls(chunk, 3600);
    if (error) throw new Error(error.message);
    for (const d of data ?? []) if (d.signedUrl && d.path) out[d.path] = d.signedUrl;
  }
  return out;
}

export async function addReview(r: { account_id: string; chi: string; azione: 'tier' | 'scarta' | 'ricontrolla' | 'nota'; tier?: 'A' | 'B' | 'C' | null; motivo?: string | null; nota?: string | null }) {
  const { error } = await csClient.from('lead_reviews').insert(r);
  if (error) throw new Error(error.message);
}
