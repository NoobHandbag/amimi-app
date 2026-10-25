import { supabase } from './supabase';
import { csClient, EMAIL_TEAM_TESTO } from './csClient';

// Tab "Comportamento" (modulo beh_*, migr 0169-0171). Due letture: il flag dalla vista v_beh_settings col client anon
// (errore o assenza = spento, cosi' la tile non compare) e la RPC beh_dashboard col login del team (stessa sessione di
// Premia e Assistenza), che rifiuta chi non e' del team (42501) e restituisce solo aggregati, nessun dato del cliente.

export type BehHealth = { k: string; label: string; severity: string; day: string };
export type BehGiro = { step: string; status: string; ended_at: string | null; rows_written: number | null; window_to: string | null };
export type BehCoorte = { coorte: string; maturita_giorni: number; clienti: number; ricomprato_90gg: number };
export type BehOn = {
  state: 'on'; generated_at: string; days: number; from: string; to: string; prev_from: string; prev_to: string; steps: string[];
  ordini: {
    fonte: string; dati_al: string | null; online: number; online_pronti: number; online_tracciati: number; in_attribuzione: number;
    prev_online_pronti: number; prev_online_tracciati: number; tutti: number; prev_tutti: number; lordo: number;
    per_canale: Record<string, number>; giorni: { day: string; online: number; tracciati: number }[];
  };
  fonti: {
    fonte: string; ultima_visita: Record<string, number>; prima_visita: Record<string, number>; meta_dati_al: string | null;
    spesa_meta: number; ordini_cpa: number; prev_spesa_meta: number; prev_ordini_cpa: number;
    ads: { link_clicks: number; outbound_clicks: number; landing_page_views: number; dati_al: string | null };
  };
  clienti: { fonte: string; clienti: number; con_2_ordini: number; riacquisto_90: { ricomprato: number; clienti: number }; coorti: BehCoorte[] };
  premia: { fonte: string; aperture: number; premio_pronto: number; tap_riscatta: number; riscatti: number; ordini_amica12: number; prev_aperture: number };
  salute: { giri: BehGiro[]; health: BehHealth[] };
};
export type BehDash = { state: 'off' } | BehOn;

/** Flag del modulo, col client anon: acceso solo con 'true' (spazi e maiuscole tollerati), come lo legge la RPC. */
export async function fetchBehEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from('v_beh_settings').select('key,value').eq('key', 'beh_enabled').maybeSingle();
  if (error || !data) return false;
  return String((data as { value: unknown }).value ?? '').trim().toLowerCase() === 'true';
}

export async function fetchBehDashboard(days: number): Promise<BehDash> {
  const { data, error } = await csClient.rpc('beh_dashboard', { p_days: days });
  if (error) throw new Error(error.code === '42501' ? `Sezione riservata agli account ${EMAIL_TEAM_TESTO}.` : error.message);
  return data as BehDash;
}
