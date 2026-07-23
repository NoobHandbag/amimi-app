// Pricing + SEO helpers (pure logic, from the brand rules in CLAUDE.md).

/** Current month (1-12) and year, derived from the clock — never hardcode (it rots at month/year change). */
export const nowMonth = (): number => new Date().getMonth() + 1;
export const nowYear = (): number => new Date().getFullYear();
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
