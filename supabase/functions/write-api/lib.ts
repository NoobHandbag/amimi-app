// write-api/lib.ts — helper PURI condivisi (2026-09-14, audit gate blocco 1).
// Modulo puro: importabile sia da Deno (l'edge) sia da Node 24 (i test, che strippano i tipi).
// Niente sintassi TS esotica (no enum/namespace/parameter properties), nessun import.
//
// Perche' esiste: l'audit del 14-09 ha trovato che Number(payload.x) accetta null/''/[]  come 0 (finding A5:
// count azzera un codice, arrival_set scrive un acquisto negativo) e che new Date(x) legge le date col fuso
// (finding B4/B18/B39: a mezzanotte una scrittura cade nel giorno o nel mese sbagliato). Qui vivono le
// conversioni sicure, in un posto solo, con i loro test (tests/write_api_num.mjs).

// num: accetta SOLO un numero finito (typeof number, oppure una stringa numerica in notazione punto).
// Rifiuta (torna null) null, undefined, '', '  ', '12,50' (virgola), 'abc', [], {}, true/false, NaN, Infinity.
// opts: min, max (inclusivi), integer (deve essere intero), nonZero (diverso da 0). Fuori vincolo -> null.
export function num(
  v: unknown,
  opts?: { min?: number; max?: number; integer?: boolean; nonZero?: boolean },
): number | null {
  let n: number;
  if (typeof v === 'number') {
    n = v;
  } else if (typeof v === 'string') {
    const s = v.trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    n = Number(s);
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  const o = opts ?? {};
  if (o.integer && !Number.isInteger(n)) return null;
  if (o.nonZero && n === 0) return null;
  if (o.min != null && n < o.min) return null;
  if (o.max != null && n > o.max) return null;
  return n;
}

// isoDate: SOLO 'YYYY-MM-DD' con data di calendario valida (nessun parsing a fuso). 2026-02-30 -> null.
export function isoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dim = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d > dim[mo - 1]) return null;
  return s;
}

// todayRome: la data di OGGI a Roma in 'YYYY-MM-DD'. Intl con timeZone, mai il fuso del server (UTC).
export function todayRome(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// ymFromIso: {year, month} presi dalla STRINGA ISO (mai da new Date(): eviterebbe il fuso ma e' inutile).
export function ymFromIso(iso: string): { year: number; month: number } {
  return { year: Number(String(iso).slice(0, 4)), month: Number(String(iso).slice(5, 7)) };
}

// tok v2 (v21): nome -> CODICE. NFD senza diacritici, MAIUSCOLO, ogni sequenza non alfanumerica -> UN '_',
// niente '_' ai bordi. Identico al tokenizer del web (helpers.ts) per un solo codice da ogni ingresso.
export const tok = (s: unknown): string => String(s ?? '')
  .normalize('NFD').replace(/\p{M}/gu, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// cnorm: identico alla colonna generata products.codice_norm (upper + ogni spazio -> _).
export const cnorm = (s: unknown): string => String(s ?? '').toUpperCase().replace(/\s+/g, '_');

// Le 8 categorie di spesa vive in expenses (contate a DB il 14-09). EVENTI e' una categoria vera (riga
// nel CE). Una categoria fuori da questa lista sparisce da ogni riga del CE: si rifiuta all'ingresso.
export const VALID_CATEGORIE = ['COGS', 'EVENTI', 'LOGISTICA', 'MARKETING', 'OPEX', 'PACKAGING', 'SALARI', 'TASSE'];
