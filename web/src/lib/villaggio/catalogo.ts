// Villaggio (16-10): lo "studio delle borse" in forma di funzioni pure. Dal nome di una variante (v_inventory.variant,
// o il nome scritto nell'ordine) ricava la FINITURA (materiale), la stampa e i COLORI; dall'item ricava il MODELLO (la
// sagoma 3D). Nessun import: lo usano la pagina, il mondo three.js e tests/villaggio_catalogo.mjs (Node 24 strippa i tipi).
// I nomi delle varianti non sono coerenti fra ordini e magazzino (COCCO_BORDOUX / COCCO_BURGUNDY, STRIPES_REED,
// ORGANZA BIANCA sullo stesso codice di EMBROIDERY WHITE): qui ci sono gli alias, e per le righe d'ordine la pagina
// legge l'aspetto dalla variante del MAGAZZINO con lo stesso codice, cosi' la pila e il carrello combaciano.

export type Fin = 'cocco' | 'patent' | 'suede' | 'sequin' | 'pony' | 'stripes' | 'checks' | 'pois' | 'embroidery' | 'roses'
  | 'floral' | 'organza' | 'tiedye' | 'satin' | 'toasted' | 'leather' | 'cotton';
export type Print = 'zebra' | 'cow' | 'leopard' | null;
export type Look = { fin: Fin; print: Print; cols: number[]; piercing: boolean; charm: boolean; multi: boolean; key: string };

/** I 13 modelli con una sagoma propria (fotografati sul sito il 16-10). L'ordine e' quello delle pedane in magazzino. */
export const MODEL_ORDER = ['Lea', 'Lea Maxi', 'Valentina', 'Sophie', 'Maria', 'Nina Maxi', 'Nina', 'Agata', 'Annie',
  'Laptop cover', 'Sunglass cover', 'Airpod cover', 'Porta carte'] as const;
export type Modello = (typeof MODEL_ORDER)[number];

const ITEM_MODEL: Record<string, Modello> = {
  'LEA BAG': 'Lea', 'LEA BAG MAXI': 'Lea Maxi', 'VALENTINA BAG': 'Valentina', 'SOPHIE BAG': 'Sophie', 'MARIA BAG': 'Maria',
  'NINA BAG MAXI': 'Nina Maxi', 'NINA BAG': 'Nina', 'AGATA BAG': 'Agata', 'ANNIE BAG': 'Annie', 'ANNIE BAG PAILLETTES': 'Annie',
  'LAPTOP COVER': 'Laptop cover', 'SUNGLASS COVER': 'Sunglass cover', 'AIRPOD COVER': 'Airpod cover',
  'CREDIT CARD CASE': 'Porta carte', 'PORTA CARTE': 'Porta carte',
};
const norm = (s: string | null | undefined) => String(s ?? '').toUpperCase().replace(/[_.]/g, ' ').replace(/\s+/g, ' ').trim();

/** Modello dall'item. "ANNIE BAG PAILLETTES" + "SILVER" diventa Annie con variante "PAILLETTES SILVER". null = modello sconosciuto. */
export function modelOf(item: string | null | undefined, variant: string | null | undefined): { model: Modello | null; variant: string } {
  const it = norm(item), v = String(variant ?? '');
  const model = ITEM_MODEL[it] ?? null;
  if (it === 'ANNIE BAG PAILLETTES' && !/PAILLETTES|PALLIETTES/i.test(v)) return { model, variant: 'PAILLETTES ' + v };
  return { model, variant: v };
}

/** "Francesco (pelle)" -> { nome: 'Francesco', tipo: 'pelle' } */
export function labOf(fornitore: string | null | undefined): { nome: string; tipo: string } {
  const f = String(fornitore ?? '').trim() || 'Senza fornitore';
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(f);
  return m ? { nome: m[1].trim(), tipo: m[2].trim().toLowerCase() } : { nome: f, tipo: '' };
}

export const COLMAP: Record<string, number> = {
  'MILITARY GREEN': 0x5b6440, 'GREEN MILITARY': 0x5b6440, 'SAND CORAL': 0xe9a184, 'LIGHT BLUE': 0x9ccbec, 'ICE BLUE': 0xc3e2f2,
  'NAVY BLUE': 0x24396b, 'PETROL BLUE': 0x1f6272, 'FOREST GREEN': 0x2f6246, 'JUNGLE GREEN': 0x2f8a55, 'ICE GREEN': 0xbfe8d6,
  'LIGHT GREEN': 0xa8dfa2, 'LIGHT GREY': 0xc9cacf, 'PEARL GREY': 0xd5d6dc, 'CANDY PINK': 0xf6a6c2, 'CHERRY PINK': 0xdf4560,
  BLACK: 0x211e24, NERO: 0x211e24, NERA: 0x211e24, WHITE: 0xf6f3ec, BIANCO: 0xf6f3ec, BIANCA: 0xf6f3ec, BIANCHE: 0xf6f3ec,
  PANNA: 0xf1e6cf, BEIGE: 0xd9c2a0, PURPLE: 0x74306f, MALVA: 0xb88aab, GREEN: 0x2f7a4c, VERDE: 0x3f8a58, FUCSIA: 0xd6337f,
  PINK: 0xf08fb0, ROSA: 0xf08fb0, BURGUNDY: 0x6c1f30, BORDEAUX: 0x6c1f30, BORDOUX: 0x6c1f30, BORODUX: 0x6c1f30,
  CHOCOLATE: 0x4b2c1e, MARRONE: 0x6b4026, BROWN: 0x5a3520, RED: 0xc8232f, REED: 0xc8232f, ROSSO: 0xc8232f, ROSSA: 0xc8232f,
  YELLOW: 0xf2c84b, GIALLO: 0xf2c84b, PEACH: 0xf7b89a, MINT: 0x9fe0c8, STRAWBERRY: 0xe3445c, ORANGE: 0xef8a33, ARANCIO: 0xef8a33,
  LILAC: 0xc4a6e2, LILLA: 0xc4a6e2, BUTTER: 0xf6e3a2, GREY: 0xb9bac2, GRIGIO: 0xb9bac2, GRIGIA: 0xb9bac2, SILVER: 0xd5d7de,
  ARGENTO: 0xd5d7de, NUDE: 0xe8c4ab, BLUE: 0x3f63b8, BLU: 0x3f63b8, AZZURRA: 0x8ecbe8, AZZURRO: 0x8ecbe8, CHERRY: 0xd92f3c,
  LIME: 0xc6e05a, AZURE: 0x5aa9e6, SPOSA: 0xf7f3ea,
};
const IT: Record<string, string> = {
  COCCO: 'cocco', PATENT: 'vernice', SUEDE: 'camoscio', CHARM: 'con charm', PAILLETTES: 'paillettes', PALLIETTES: 'paillettes',
  STRIPES: 'righe', CHECKS: 'quadretti', POIS: 'pois', EMBROIDERY: 'ricamo', FLORAL: 'fiori', FLOWER: 'fiori', ROSE: 'rose',
  PONY: 'pony', ZEBRA: 'zebrato', MUCCATA: 'muccata', CAVALLINO: 'cavallino', SAVANA: 'savana', TOASTED: 'pelle toasted',
  LEATHER: '', PIERCING: 'con piercing', SATIN: 'raso', PEARL: 'perla', COLORFUL: 'multicolore', COLORFULL: 'multicolore',
  'MILITARY GREEN': 'verde militare', 'GREEN MILITARY': 'verde militare', 'SAND CORAL': 'corallo', 'LIGHT BLUE': 'azzurro',
  'ICE BLUE': 'ghiaccio', 'NAVY BLUE': 'blu navy', 'PETROL BLUE': 'petrolio', 'FOREST GREEN': 'verde bosco',
  'JUNGLE GREEN': 'verde giungla', 'ICE GREEN': 'verde ghiaccio', 'LIGHT GREEN': 'verde chiaro', 'LIGHT GREY': 'grigio chiaro',
  'PEARL GREY': 'grigio perla', 'CANDY PINK': 'rosa caramella', 'CHERRY PINK': 'rosa ciliegia',
  BLACK: 'nero', WHITE: 'bianco', BEIGE: 'beige', PURPLE: 'viola', GREEN: 'verde', FUCSIA: 'fucsia', PINK: 'rosa',
  BURGUNDY: 'bordeaux', BORDOUX: 'bordeaux', BORODUX: 'bordeaux', CHOCOLATE: 'cioccolato', BROWN: 'marrone', RED: 'rosso',
  REED: 'rosso', YELLOW: 'giallo', PEACH: 'pesca', MINT: 'menta', STRAWBERRY: 'fragola', ORANGE: 'arancio', LILAC: 'lilla',
  BUTTER: 'burro', GREY: 'grigio', SILVER: 'argento', NUDE: 'nude', BLUE: 'blu', CHERRY: 'ciliegia', LIME: 'lime',
  AZURE: 'azzurro', ADOC: '', PER: 'per',
};
const DEF_FIN: Partial<Record<Modello, Fin>> = { Annie: 'satin', Nina: 'cotton', 'Nina Maxi': 'cotton', Agata: 'cotton', Sophie: 'suede',
  'Airpod cover': 'cotton', 'Sunglass cover': 'cotton', 'Laptop cover': 'cotton', Lea: 'pony' };
const DEF_COL: Record<Fin, number> = { cocco: 0x5a3a2a, patent: 0xc41f2c, suede: 0x7a5a3a, sequin: 0xd5d7de, pony: 0x6b4026,
  stripes: 0xc4202c, checks: 0x24396b, pois: 0x24396b, embroidery: 0xf7f3ea, roses: 0xf6e3a2, floral: 0xc4a6e2, organza: 0xf6f3ee,
  tiedye: 0xf08fb0, satin: 0xd3d4da, toasted: 0x7a4527, leather: 0x6b4026, cotton: 0xf3e6d0 };
export const FIN_IT: Record<Fin, string> = { cocco: 'Cocco', patent: 'Vernice', suede: 'Camoscio', sequin: 'Paillettes', pony: 'Pony',
  stripes: 'Righe', checks: 'Quadretti', pois: 'Pois', embroidery: 'Ricamo', roses: 'Rose', floral: 'Fiori', organza: 'Organza',
  tiedye: 'Tie dye', satin: 'Raso', toasted: 'Pelle toasted', leather: 'Pelle liscia', cotton: 'Cotone' };
export const PRINT_IT: Record<'zebra' | 'cow' | 'leopard', string> = { zebra: 'Pony zebrato', cow: 'Pony muccato', leopard: 'Pony leopardato' };

const words = (s: string) => norm(s).replace(/\b\d+X\d+\b/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
function scan(w: string[], map: Record<string, number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.length; i++) {
    const two = i + 1 < w.length ? w[i] + ' ' + w[i + 1] : null;
    if (two && map[two] != null) { out.push(map[two]); i++; continue; }
    if (map[w[i]] != null) out.push(map[w[i]]);
  }
  return out;
}

/** Nome leggibile in italiano: "COCCO_PURPLE" -> "Cocco viola", "9X11 STRIPES RED" -> "Righe rosso". */
export function nice(v: string | null | undefined): string {
  const w = words(String(v ?? ''));
  const out: string[] = [];
  for (let i = 0; i < w.length; i++) {
    const two = i + 1 < w.length ? w[i] + ' ' + w[i + 1] : null;
    if (two && IT[two] != null) { out.push(IT[two]); i++; continue; }
    out.push(IT[w[i]] != null ? IT[w[i]] : w[i].toLowerCase());
  }
  const s = out.filter(Boolean).join(' ').replace('pelle toasted pelle', 'pelle toasted').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Variante senza nome';
}

/** Aspetto della variante. `codice` serve da riserva per i colori: "COCCO" sul codice LEA_BAG_MAXI_COCCO_BURGUNDY e' bordeaux. */
export function parseLook(model: Modello | null, variant: string | null | undefined, codice?: string | null): Look {
  const w = words(String(variant ?? ''));
  const S = ' ' + w.join(' ') + ' ';
  const has = (t: string) => S.indexOf(' ' + t + ' ') >= 0;
  let fin: Fin, print: Print = null;
  if (has('COCCO')) fin = 'cocco';
  else if (has('PATENT') || has('VERNICE')) fin = 'patent';
  else if (has('SUEDE') || has('CAMOSCIO')) fin = 'suede';
  else if (has('PAILLETTES') || has('PALLIETTES')) fin = 'sequin';
  else if (has('ZEBRA')) { fin = 'pony'; print = 'zebra'; }
  else if (has('MUCCATA')) { fin = 'pony'; print = 'cow'; }
  else if (has('SAVANA') || has('LEOPARD')) { fin = 'pony'; print = 'leopard'; }
  else if (has('PONY') && has('BLACK') && has('WHITE')) { fin = 'pony'; print = 'cow'; }
  else if (has('PONY') || has('CAVALLINO')) fin = 'pony';
  else if (has('STRIPES')) fin = 'stripes';
  else if (has('CHECKS')) fin = 'checks';
  else if (has('POIS')) fin = 'pois';
  else if (has('EMBROIDERY') || has('RICAMO')) fin = 'embroidery';
  else if (has('ROSE')) fin = 'roses';
  else if (has('FLORAL') || has('FLOWER')) fin = 'floral';
  else if (has('ORGANZA')) fin = 'organza';
  else if (has('TIE')) fin = 'tiedye';
  else if (has('SATIN') || has('PEARL')) fin = 'satin';
  else if (has('TOASTED')) fin = 'toasted';
  else if (has('LEATHER') || has('PIERCING')) fin = 'leather';
  else fin = (model && DEF_FIN[model]) || 'leather';
  let cols = scan(w, COLMAP);
  if (!cols.length && codice) cols = scan(words(codice), COLMAP);
  if (print === 'zebra') cols = [cols[0] ?? 0x1e1c21, 0xf4efe4];
  if (print === 'cow') cols = [!cols.length || cols[0] === COLMAP.BLACK ? 0x1e1c21 : cols[0], 0xf6efe2];
  if (print === 'leopard') cols = [0xd8a55a, 0x3a2414];
  if (!cols.length) cols = [DEF_COL[fin]];
  const piercing = has('PIERCING') || has('ASOLE');
  const charm = has('CHARM');
  const multi = has('COLORFUL') || has('COLORFULL');
  const key = [fin, print ?? '', cols.map((c) => c.toString(16)).join('.'), piercing ? 'p' : '', charm ? 'c' : '', multi ? 'm' : ''].join('-');
  return { fin, print, cols, piercing, charm, multi, key };
}

/** Pezzi -> lastre della pila (1 lastra = 2 pezzi, minimo 1 se c'e' almeno un pezzo, tetto 24). Uguale in magazzino e nei laboratori. */
export const lastre = (pezzi: number) => (pezzi > 0 ? Math.min(24, Math.max(1, Math.round(pezzi / 2))) : 0);

/** Giorni fra oggi e la consegna (negativo = in ritardo), null se la riga non ha data. Date ISO 'YYYY-MM-DD'. */
export function giorniAllaConsegna(consegna: string | null | undefined, oggi: string): number | null {
  if (!consegna) return null;
  const a = Date.parse(String(consegna).slice(0, 10) + 'T00:00:00Z'), b = Date.parse(oggi.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}
