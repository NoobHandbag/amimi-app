// Villaggio, fase 3 (18-10): l'ambiente dell'isola, cioe' stagione, luce del giorno e meteo vero di Milano, per
// Mondo.setAmbiente. Tutto e' funzione pura di una data (si prova da Node), tranne leggiMeteo: una sola lettura da
// Open-Meteo (gratis, senza chiave, nessun dato personale nella richiesta), tenuta 30 minuti sul telefono. Il meteo e'
// decorazione: se la lettura non va l'isola resta serena e la pagina non aspetta e non avvisa.

export type Stagione = 'primavera' | 'estate' | 'autunno' | 'inverno';
export type Momento = 'mattina' | 'giorno' | 'tramonto' | 'sera';
export type Meteo = 'sereno' | 'nuvole' | 'pioggia' | 'neve' | 'nebbia';
export type Ambiente = { stagione: Stagione; momento: Momento; meteo: Meteo };

export const METEO_URL = 'https://api.open-meteo.com/v1/forecast?latitude=45.4642&longitude=9.19&current=weather_code,is_day';
export const METEO_KEY = 'amimi_villaggio_meteo';
export const METEO_TTL_MS = 30 * 60 * 1000;
/** Ogni quanto la pagina ricalcola l'ambiente (luce e stagione cambiano piano: mai a ogni fotogramma). */
export const AMBIENTE_OGNI_MS = 15 * 60 * 1000;
const METEO: readonly Meteo[] = ['sereno', 'nuvole', 'pioggia', 'neve', 'nebbia'];

/** Ora e mese del calendario di Roma (l'ora legale la decide Intl, non il codice). */
function roma(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', month: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { mese: get('month'), minuti: (get('hour') % 24) * 60 + get('minute') };
}
export const meseRoma = (d: Date) => roma(d).mese;
/** Minuti dalla mezzanotte, ora di Roma. */
export const minutiRoma = (d: Date) => roma(d).minuti;

/** Le stagioni come le vede un albero di Milano, non il calendario astronomico: le chiome sono arancio a ottobre e
 *  novembre, settembre e' ancora estate. */
export function stagioneDi(mese: number): Stagione {
  if (mese >= 3 && mese <= 5) return 'primavera';
  if (mese >= 6 && mese <= 9) return 'estate';
  if (mese === 10 || mese === 11) return 'autunno';
  return 'inverno';
}

/** Alba e tramonto a Milano, in minuti dalla mezzanotte UTC (serie di Spencer per declinazione ed equazione del tempo,
 *  errore di pochi minuti: basta per scegliere la luce). */
export function soleMilano(d: Date): { alba: number; tramonto: number } {
  const n = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000);
  const g = 2 * Math.PI / 365 * n;
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const phi = 45.4642 * Math.PI / 180;
  const ha = Math.acos(Math.cos(90.833 * Math.PI / 180) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl)) * 180 / Math.PI;
  const mezzogiorno = 720 - 4 * 9.19 - eqt;
  return { alba: mezzogiorno - 4 * ha, tramonto: mezzogiorno + 4 * ha };
}

/** Il momento del giorno a Roma, dal sole vero di Milano: in dicembre alle 17 e' gia' sera, in giugno no. La mattina
 *  dura almeno fino alle 10:30 (l'ora in cui si apre il Villaggio), il tramonto va da un'ora prima a mezz'ora dopo. */
export function momentoDi(d: Date): Momento {
  const m = minutiRoma(d);
  const utc = d.getUTCHours() * 60 + d.getUTCMinutes();
  const scarto = (((m - utc) % 1440) + 1440) % 1440;
  const s = soleMilano(d), alba = s.alba + scarto, tramonto = s.tramonto + scarto;
  if (m < alba - 20 || m >= tramonto + 30) return 'sera';
  if (m >= tramonto - 60) return 'tramonto';
  if (m < Math.max(alba + 150, 630)) return 'mattina';
  return 'giorno';
}

/** Codice meteo WMO di Open-Meteo -> il meteo dell'isola. Un codice sconosciuto o assente e' sereno. */
export function meteoDaCodice(code: unknown): Meteo {
  const c = typeof code === 'number' ? code : typeof code === 'string' && code.trim() !== '' ? Number(code) : NaN;
  if (!Number.isFinite(c)) return 'sereno';
  if (c === 2 || c === 3) return 'nuvole';
  if (c === 45 || c === 48) return 'nebbia';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95 && c <= 99)) return 'pioggia';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'neve';
  return 'sereno';
}

/** Il meteo salvato da meno di METEO_TTL_MS (`raw` = il valore di localStorage), altrimenti null. */
export function meteoInCache(raw: string | null, ora: number): Meteo | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { t?: unknown; meteo?: unknown } | null;
    const t = Number(v?.t);
    if (!Number.isFinite(t) || ora - t < 0 || ora - t >= METEO_TTL_MS) return null;
    return METEO.includes(v?.meteo as Meteo) ? (v?.meteo as Meteo) : null;
  } catch {
    return null;
  }
}

export const ambienteDi = (d: Date, meteo: Meteo): Ambiente => ({ stagione: stagioneDi(meseRoma(d)), momento: momentoDi(d), meteo });

/** Il meteo di Milano adesso: dalla cache se ha meno di 30 minuti, se no da Open-Meteo. Non lancia mai: senza rete,
 *  con una risposta storta o dopo 8 s vale 'sereno', e non si salva, cosi' la prossima chiamata riprova. */
export async function leggiMeteo(ora = Date.now()): Promise<Meteo> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(METEO_KEY); } catch { /* storage non disponibile: si chiede alla rete */ }
  const salvato = meteoInCache(raw, ora);
  if (salvato) return salvato;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(METEO_URL, { signal: ctl.signal });
    if (!r.ok) return 'sereno';
    const j = (await r.json()) as { current?: { weather_code?: unknown } } | null;
    const code = j?.current?.weather_code;
    if (typeof code !== 'number') return 'sereno';
    const meteo = meteoDaCodice(code);
    try { localStorage.setItem(METEO_KEY, JSON.stringify({ t: ora, meteo })); } catch { /* resta per questa lettura */ }
    return meteo;
  } catch {
    return 'sereno';
  } finally {
    clearTimeout(timer);
  }
}

/** L'ambiente di adesso, da passare a Mondo.setAmbiente all'apertura e ogni AMBIENTE_OGNI_MS. */
export async function leggiAmbiente(d = new Date()): Promise<Ambiente> {
  return ambienteDi(d, await leggiMeteo(d.getTime()));
}
