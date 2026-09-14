// Pricing + SEO helpers (pure logic, from the brand rules in CLAUDE.md).

// 2026-09-14 (audit gate, B39): la data di riferimento e' quella di Roma, non UTC ne' il fuso del
// telefono: fra le 00:00 e le 02:00 i form venivano retrodatati a ieri e il primo del mese la
// scrittura cadeva nel mese prima (magari chiuso). Modulo PURO: niente import di api/supabase.
export const todayRome = (now: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};
export const oggi = (): string => todayRome();

/** Current month (1-12) and year, derived from the clock — never hardcode (it rots at month/year change). */
export const nowMonth = (): number => Number(todayRome().slice(5, 7));
export const nowYear = (): number => Number(todayRome().slice(0, 4));

// 2026-09-14 (audit gate, B43): tokenizer identico al tok v2 del server (write-api): NFD senza
// diacritici, MAIUSCOLO, ogni sequenza non alfanumerica -> un solo '_', niente '_' ai bordi.
// Il CODICE lo deriva il server; qui serve solo per l'anteprima nei form.
export const tok = (s: unknown) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
export const deriveCodice = (model: string, variant: string) => tok(model) + '_' + tok(variant);
const MESI_FULL = ['', 'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const meseNome = (m: number): string => MESI_FULL[m] ?? '';

/** Human product name: strip underscores, de-dup a model prefix the variant repeats, and
 *  render in Title Case (regola condivisa: display Title Case, storage MAIUSCOLO). */
export function prettyName(item: string | null, variant: string | null, codice?: string | null): string {
  const deUnder = (s: string) => s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const titleCase = (s: string) => s.split(' ').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');
  const it = titleCase(deUnder(item ?? ''));
  let va = titleCase(deUnder(variant ?? ''));
  if (it && va) {
    const low = va.toLowerCase(), ilow = it.toLowerCase();
    if (low === ilow) va = '';
    else if (low.startsWith(ilow + ' ')) va = va.slice(it.length).trim();
  }
  return [it, va].filter(Boolean).join(' ').trim() || deUnder(codice ?? '') || '—';
}

/** Suggest a VAT-inclusive retail price from COGS at a target net margin. Prices are IVA 22% inclusive. */
export function suggestPrice(cogs: number, margin = 0.62): number {
  if (!(cogs > 0)) return 0;
  const netto = cogs / (1 - margin);     // net margin = (netto - cogs) / netto
  const lordo = netto * 1.22;            // add IVA
  // round to a clean retail ending: nearest 10 above ~100, nearest 5 below
  if (lordo >= 100) return Math.round(lordo / 10) * 10 - 0.1;   // e.g. 119.90
  return Math.round(lordo / 5) * 5 - 0.1;                       // e.g. 64.90
}

/** Effective net margin for a given VAT-inclusive price + COGS. */
export function marginOf(priceLordo: number, cogs: number): number {
  const netto = priceLordo / 1.22;
  return netto > 0 ? (netto - cogs) / netto : 0;
}

const CLEAN = (s: string) => s.replace(/_/g, ' ').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * SEO title to the Amimì formula (60–70 chars target).
 * Leather (Lea/Valentina/Maria/Annie/Agata/Isabella/Lola): "...in vera pelle Made in Italy".
 * Nina (cotton/textile): NO "Made in Italy".
 */
export function genSeoTitle(item: string, variant: string | null): string {
  const model = (item || '').replace(/\s*bag.*/i, '').trim() || item || '';
  const colore = CLEAN(variant || '');
  const isNina = /nina/i.test(item || '');
  if (isNina) {
    return `Borsa in cotone AMIMI Nina ${colore} - borsa fatta a mano in cotone naturale`.replace(/\s+/g, ' ').trim();
  }
  return `Borsa a tracolla AMIMI ${model} in ${colore} - borsa fatta a mano in vera pelle Made in Italy`.replace(/\s+/g, ' ').trim();
}
