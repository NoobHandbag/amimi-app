// Pricing + SEO helpers (pure logic, from the brand rules in CLAUDE.md).

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
