import { supabase } from './supabase';
import { csClient, EMAIL_TEAM_TESTO } from './csClient';

// Tab "Comportamento" (modulo beh_*, migr 0169-0171). Due letture: il flag dalla vista v_beh_settings col client anon
// (errore o assenza = spento, cosi' la tile non compare) e la RPC beh_dashboard col login del team (stessa sessione di
// Premia e Assistenza), che rifiuta chi non e' del team (42501) e restituisce solo aggregati, nessun dato del cliente.

export type BehHealth = { k: string; label: string; severity: string; day: string };
// soglia_ore: oltre questa eta' il giro del cron e' fermo (la stessa regola di beh_fresh, decisa dal server)
export type BehGiro = { step: string; status: string; ended_at: string | null; rows_written: number | null; window_to: string | null; soglia_ore: number };
export type BehCoorte = { coorte: string; maturita_giorni: number; clienti: number; ricomprato_90gg: number };
// I prev_* sono null quando il periodo prima comincia prima del primo giorno della fonte (Gate 2 del passo 3): meglio
// "n.d." che una freccia su un periodo coperto a meta'. `to` e' l'ultimo giorno completo (mai oggi), `oggi` il giorno di Roma.
export type BehOn = {
  state: 'on'; generated_at: string; days: number; from: string; to: string; oggi: string; prev_from: string; prev_to: string; steps: string[];
  ordini: {
    fonte: string; dati_al: string | null; online: number; online_pronti: number; online_tracciati: number; in_attribuzione: number;
    prev_online_pronti: number | null; prev_online_tracciati: number | null; tutti: number; prev_tutti: number | null; lordo: number;
    per_canale: Record<string, number>; giorni: { day: string; online: number; tracciati: number }[];
  };
  fonti: {
    fonte: string; ultima_visita: Record<string, number>; prima_visita: Record<string, number>; meta_dati_al: string | null;
    // spesa_meta null = nessun giorno coperto, o un giorno di calendario senza righe di spesa che nessun giro Meta riuscito
    // ha letto senza click (giorni_spesa_mancanti); giorni_click_mancanti = giorni del periodo senza click letti (funnel parziale)
    spesa_dal: string | null; giorni_spesa: number; giorni_spesa_mancanti: number; ultimo_giorno_spesa_mancante: string | null; giorni_spesa_mancanti_prima: number;
    giorni_click_mancanti: number;
    spesa_meta: number | null; ordini_cpa: number; prev_spesa_meta: number | null; prev_ordini_cpa: number | null;
    ads: { link_clicks: number; outbound_clicks: number; landing_page_views: number; dati_al: string | null };
  };
  clienti: { fonte: string; clienti: number; con_2_ordini: number; riacquisto_90: { ricomprato: number; clienti: number }; coorti: BehCoorte[] };
  premia: { fonte: string; aperture: number; premio_pronto: number; tap_riscatta: number; riscatti: number; ordini_amica12: number; prev_aperture: number | null; tap_dal: string | null };
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
