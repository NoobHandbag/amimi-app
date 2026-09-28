import { csClient } from './csClient';

// Sezione "Premia" (dashboard del programma fedelta', migr 0146). UNA lettura: la RPC loyalty_dashboard, col client
// della sessione @amimi.it (stesso login di Assistenza, Negozi, Materiali). Le tabelle loyalty_* restano chiuse ad anon e
// authenticated: la RPC restituisce solo aggregati (nessun codice sconto, nessun id cliente) e rifiuta chi non e' @amimi.it.

export type HealthItem = { k: string; label: string; n: number; severity: string; day: string };
export type KpiDay = {
  day: string; visite_clienti: number; visite_hits: number; clienti_attivi: number; coccole: number; memory: number;
  accrediti_acquisto: number; punti_guadagnati: number; punti_riscattati: number; riscatti: number; riscatti_falliti: number;
};
export type PoolRow = { reward: string; label: string; cost_points: number; active: boolean; liberi: number; usati: number; pending: number; riscatti_14gg: number; giorni_ritmo: number | null };
export type PremiaDash = {
  generated_at: string; days: number; from: string; to: string;
  health: HealthItem[];
  flags: Record<string, 'on' | 'off' | 'test'>;
  orders_last_run: string | null;
  kpi_daily: KpiDay[];
  pool: PoolRow[];
  members: { totale: number; lt50: number; b50_99: number; ge100: number; tier_saldo: Record<string, number>; tier_cumulato: Record<string, number> };
  visitatori: { periodo: number; totale: number; dal: string | null };
  second: { finestre_aperte: number; in_scadenza_14gg: number; bonus_dati: number };
  redeem_rate: { punti_guadagnati_totali: number; punti_riscattati_totali: number; pct_riscattato: number; riscatti_evasi: number; riscatti_pending: number; membri: number; membri_con_tessera_piena: number } | null;
  amica12: { riscattati_totale: number; riscattati_periodo: number; ordini_totale: number; ordini_periodo: number; lordo_totale: number; sconto_totale: number; con_reso: number };
  vendite: { ordini_periodo: number; lordo_periodo: number; ordini_dopo_visita: number; lordo_dopo_visita: number };
  uplift: { segmento: string; ordini: number; scontrino_medio_lordo: number; lordo_totale: number; ordini_con_reso: number; clienti_distinti_per_email: number }[];
  funnel: { aperture: number; sessioni: number; visto_premio: number; premio_pronto: number; tap_riscatta: number; riscatti: number; ordini_amica12: number; eventi: number; dal: string | null };
  elementi: { event: string; element: string | null; n: number; clienti: number }[];
};

export async function fetchPremiaDashboard(days: number): Promise<PremiaDash> {
  const { data, error } = await csClient.rpc('loyalty_dashboard', { p_days: days });
  if (error) throw new Error(error.code === '42501' ? 'Sezione riservata agli account @amimi.it.' : error.message);
  return data as PremiaDash;
}
