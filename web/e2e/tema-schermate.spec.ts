import { test, expect, type Page, type Route, type Request } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Schermate di riferimento per il restyling (tema Amimi', 15-10; dati finti verosimili dal 21-10): le schermate principali
// e le sotto-viste che i revisori non vedevano (scheda prodotto, Riordino, hub Registra, Conta, Reso, tabella aperta,
// fornitore, carrello del nuovo ordine, thread Assistenza, Notifiche, Materie prime), a 390 px, su dati FINTI.
// Non e' un test: non asserisce niente, salva un PNG per schermata, cosi' prima e dopo un cambio di stile si confrontano
// sugli stessi dati. Fuori dalla CI, che nomina solo `negozi`, `e2e/notifiche.spec.ts`, `e2e/villaggio.spec.ts` ed
// `e2e/paillettes.spec.ts`.
// Rete: NESSUNA richiesta esce. Ogni richiesta che non va a localhost e' intercettata: quelle a *.supabase.co ricevono
// dati finti (rispondi), tutte le altre sono interrotte. La sessione del team e' un oggetto finto in localStorage.
// Dati: le viste e tabelle elencate in TABELLE hanno righe scritte a mano per una piccola marca milanese di borse fatte a
// mano (catalogo, ordini, CE di 10 mesi, Ads, clienti, assistenza, negozi B2B, materie prime), con select, filtri
// (eq, neq, in, is, gt/gte/lt/lte, like, not., or), order, limit/offset e count applicati come PostgREST. Le RPC (Premia),
// le edge (cs-assist, push-api) e le firme dello storage hanno risposte finte; le immagini sono SVG generati qui. Una
// tabella non elencata riceve righe inventate dalle colonne del select= (un select=* riceve una lista vuota).
// I flag letti dall'app (materie prime, Villaggio, notifiche, AI) sono accesi, come in produzione.
// Uso (da web/):
//   VITE_SUPABASE_URL=https://e2e-progetto-finto.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_e2e_finto npx vite build
//   E2E_PORT=<porta libera> SCHERMATE_DIR=<cartella> npx playwright test e2e/tema-schermate.spec.ts --retries=0
// Sempre col percorso intero: il filtro nudo `tema-schermate` e' una regex sul percorso assoluto, prende anche una
// cartella o un worktree con lo stesso nome e lancia tutti gli spec, compreso ingest.spec.ts, che legge e scrive dal vivo.
// SCHERMATE_DEBUG=1 stampa le letture senza dati scritti a mano, le colonne mancanti e gli errori della pagina.

const DIR = process.env.SCHERMATE_DIR || join(tmpdir(), 'amimi-schermate');
mkdirSync(DIR, { recursive: true });
const DEBUG = !!process.env.SCHERMATE_DEBUG;

type Riga = Record<string, unknown>;

// ---------------------------------------------------------------- tempo: l'orologio della pagina e' fermo qui
const ADESSO = new Date('2026-10-15T10:00:00Z');
const pad = (n: number) => String(n).padStart(2, '0');
// timestamptz come lo scrive PostgREST (2026-10-13T10:09:00+00:00): Tabelle mostra il valore grezzo
const pg = (iso: string) => iso.replace(/(\.\d+)?Z$/, '+00:00');
const isoFa = (giorni: number, ora = 10, min = 0) => pg(new Date(Date.UTC(2026, 9, 15 - giorni, ora, min)).toISOString());
const giornoFa = (giorni: number) => isoFa(giorni).slice(0, 10);
const tondo = (n: number) => Math.round(n * 100) / 100;
const titolo = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const codiceDi = (item: string, variant: string | null) => [item, variant].filter(Boolean).join('_').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
const uid = (serie: number, i: number) => `${((serie * 2654435761 + (i + 1) * 40503) >>> 0).toString(16).padStart(8, '0')}-4c3e-4a1b-8${String(serie).padStart(3, '0')}-${String(i + 1).padStart(12, '0')}`;

// ---------------------------------------------------------------- immagini finte (SVG, mai scaricate da fuori)
type Forma = 'borsa' | 'pochette' | 'charm' | 'tessuto' | 'negozio';
const MACCHIE = [[40, 64], [58, 74], [77, 62], [48, 87], [70, 88], [86, 78]];
function disegno(colore: string, forma: Forma, macchie: string | null = null, fondo = '#efe9e2'): string {
  const spot = (r: number) => (macchie ? MACCHIE.map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.7}" fill="${macchie}"/>`).join('') : '');
  let corpo = '';
  if (forma === 'borsa') corpo = `<path d="M42 50 C42 24 78 24 78 50" fill="none" stroke="${colore}" stroke-width="6"/><rect x="24" y="48" width="72" height="52" rx="10" fill="${colore}"/>${spot(4)}<rect x="54" y="56" width="12" height="7" rx="2" fill="#c9a548"/>`;
  if (forma === 'pochette') corpo = `<rect x="18" y="46" width="84" height="44" rx="9" fill="${colore}"/>${spot(3.5)}<path d="M18 55 L60 76 L102 55" fill="none" stroke="#00000033" stroke-width="2.5"/>`;
  if (forma === 'charm') corpo = `<circle cx="60" cy="30" r="8" fill="none" stroke="#b8963e" stroke-width="3"/><circle cx="60" cy="68" r="25" fill="${colore}"/><path d="M45 58 l8 5 M45 70 l9 2 M75 58 l-8 5 M75 70 l-9 2" stroke="#3a2a1a" stroke-width="2.5" stroke-linecap="round"/>`;
  if (forma === 'tessuto') corpo = `<rect width="120" height="120" fill="${colore}"/>${macchie ? spot(6) : ''}<path d="M0 30 L120 26 M0 62 L120 58 M0 94 L120 90" stroke="#ffffff22" stroke-width="3"/>`;
  if (forma === 'negozio') corpo = `<rect width="120" height="120" fill="${colore}"/><rect x="14" y="40" width="40" height="56" rx="3" fill="#ffffff55"/><rect x="66" y="40" width="40" height="56" rx="3" fill="#ffffff40"/><rect x="10" y="22" width="100" height="12" rx="2" fill="#00000040"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${fondo}"/>${corpo}</svg>`;
}
const svgUri = (s: string) => 'data:image/svg+xml,' + encodeURIComponent(s);

const COLORI: Record<string, string> = {
  'LEOPARDO SAVANA': '#c4925a', NERO: '#232120', 'COCCO VERDE': '#3e5b3b', CUOIO: '#8b5a32', BORDEAUX: '#6b1d2b', MUCCATA: '#ece7df',
  'VERDE BOSCO': '#2e4a33', ROSSO: '#a3262e', ORO: '#caa64a', ARGENTO: '#a9aeb5', 'VELLUTO BLU': '#24396f', 'ROSA CIPRIA': '#e2b3ab', SENAPE: '#c99a2e',
};
const macchieDi = (variant: string) => (variant.includes('LEOPARDO') ? '#3a2614' : variant === 'MUCCATA' ? '#2a2725' : null);
const formaDi = (item: string): Forma => (item.includes('CHARM') ? 'charm' : item.includes('POCHETTE') ? 'pochette' : 'borsa');

// immagine servita dallo storage finto: colore dalla parola nel percorso, forma dal bucket
const PAROLE_COLORE: [string, string][] = [['leopardo', '#c4925a'], ['nero', '#232120'], ['verde', '#3e5b3b'], ['cuoio', '#8b5a32'], ['bordeaux', '#6b1d2b'], ['rosso', '#a3262e'],
  ['blu', '#24396f'], ['cipria', '#e2b3ab'], ['cammello', '#b48a5c'], ['oro', '#caa64a'], ['argento', '#a9aeb5'], ['muccata', '#ece7df']];
const TAVOLOZZA = ['#7a5c4f', '#4f6a5c', '#8a6f3d', '#5c5f7a', '#9a5a4a', '#3f4a52'];
function immagineDa(percorso: string): string {
  const p = percorso.toLowerCase();
  const hash = [...p].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const colore = PAROLE_COLORE.find(([k]) => p.includes(k))?.[1] ?? TAVOLOZZA[hash % TAVOLOZZA.length];
  if (p.startsWith('lead-assets/')) return disegno(colore, 'negozio');
  if (p.startsWith('mat-assets/')) return disegno(colore, 'tessuto', p.includes('leopardo') ? '#3a2614' : null);
  return disegno(colore, p.includes('pochette') ? 'pochette' : 'borsa', p.includes('leopardo') ? '#3a2614' : null, '#e4ddd4');
}

// ---------------------------------------------------------------- catalogo: 17 varianti di 6 modelli
type Prodotto = {
  codice: string; item: string; variant: string; categoria: string; prezzo: number | null; cogs: number | null; giac: number; cv: number;
  shop: boolean; venduti: [number, number, number, number]; ultima: number | null; v60: number; foto: string | null;
};
function prodotto(item: string, variant: string, prezzo: number | null, cogs: number | null, giac: number, cv: number, shop: boolean,
  venduti: [number, number, number, number], ultima: number | null, v60: number, conFoto = true): Prodotto {
  return {
    codice: codiceDi(item, variant), item, variant, categoria: formaDi(item) === 'borsa' ? 'BAG' : 'ACCESSORY', prezzo, cogs, giac, cv, shop, venduti, ultima, v60,
    foto: conFoto ? svgUri(disegno(COLORI[variant], formaDi(item), macchieDi(variant))) : null,
  };
}
const PRODOTTI: Prodotto[] = [
  prodotto('LEA BAG', 'LEOPARDO SAVANA', 189, 58, 9, 2, true, [64, 18, 2, 4], 1, 14),
  prodotto('LEA BAG', 'NERO', 189, 56, 14, 0, true, [51, 12, 1, 3], 2, 11),
  prodotto('LEA BAG', 'COCCO VERDE', 199, 62, 2, 1, true, [38, 9, 0, 2], 3, 9),
  prodotto('SVEVA BAG', 'CUOIO', 229, 71, 6, 0, true, [22, 7, 1, 0], 4, 5),
  prodotto('SVEVA BAG', 'BORDEAUX', 229, 71, 0, 0, true, [19, 4, 0, 0], 9, 6),
  prodotto('SVEVA BAG', 'MUCCATA', 239, 74, 4, 0, false, [0, 2, 0, 0], 12, 2),
  prodotto('AGATA BAG', 'NERO', 159, 47, 11, 2, true, [33, 10, 1, 2], 1, 8),
  prodotto('AGATA BAG', 'VERDE BOSCO', 159, 47, 3, 0, true, [21, 6, 0, 0], 5, 6),
  prodotto('AGATA BAG', 'ROSSO', 159, 49, 7, 0, true, [12, 3, 0, 1], 6, 3),
  prodotto('CHARM TIGER', 'ORO', 39, 9, 24, 4, true, [71, 22, 5, 6], 0, 19),
  prodotto('CHARM TIGER', 'ARGENTO', 39, 9, 17, 0, true, [40, 11, 2, 0], 2, 9),
  prodotto('MIMI POCHETTE', 'LEOPARDO SAVANA', 79, 21, 8, 0, true, [26, 8, 1, 0], 3, 7),
  prodotto('MIMI POCHETTE', 'VELLUTO BLU', 79, 23, 1, 0, true, [17, 5, 0, 0], 7, 5),
  prodotto('LEA MINI', 'NERO', 149, 44, 5, 0, true, [29, 7, 0, 2], 2, 6),
  prodotto('LEA MINI', 'ROSA CIPRIA', 149, 44, 0, 0, true, [14, 3, 0, 0], 20, 2),
  prodotto('LEA MINI', 'COCCO VERDE', null, 46, 6, 0, false, [0, 0, 0, 0], null, 0, false),
  prodotto('AGATA BAG', 'SENAPE', 159, null, 0, 0, false, [6, 2, 0, 0], 140, 0, false),
];
const P = (codice: string) => PRODOTTI.find((p) => p.codice === codice)!;
const nomeDi = (p: Prodotto) => titolo(`${p.item} ${p.variant}`);
const acquistati = (p: Prodotto) => p.giac + p.cv + p.venduti.reduce((s, v) => s + v, 0);
const FORNITORE_DI: Record<string, string> = { 'LEA BAG': 'Bottega Tremezzo', 'LEA MINI': 'Bottega Tremezzo', 'MIMI POCHETTE': 'Bottega Tremezzo', 'SVEVA BAG': 'Atelier Brera', 'AGATA BAG': 'Pelletteria Rossi', 'CHARM TIGER': 'Minuterie Ghezzi' };
const CLIENTI = ['Giulia Rossi', 'Marta Bianchi', 'Sara Conti', 'Elena Greco', 'Chiara Villa', 'Anna Ferri', 'Federica Moretti', 'Valentina Riva', 'Francesca Galli', 'Laura Colombo', 'Alessia Marino', 'Beatrice Fontana', 'Camilla Sala', 'Ilaria Testa'];
const DOMINI = ['gmail.com', 'libero.it', 'icloud.com', 'hotmail.it'];
const emailDi = (nome: string, i = 0) => `${nome.toLowerCase().replace(/\s+/g, '.')}@${DOMINI[i % DOMINI.length]}`;

// ---------------------------------------------------------------- ordini fornitore (v_ordini_arrivo, supplier_orders)
// gruppo, fornitore, data ordine, codice, ordinati, arrivati, costo, consegna prevista, wip, nota
type RigaOrdine = [string, string, string, string, number, number, number | null, string | null, boolean?, string?];
const RIGHE_ORDINE: RigaOrdine[] = [
  ['BT-0922', 'Bottega Tremezzo', '2026-09-22', 'LEA_BAG_LEOPARDO_SAVANA', 20, 12, 58, '2026-10-20'],
  ['BT-0922', 'Bottega Tremezzo', '2026-09-22', 'LEA_BAG_NERO', 15, 0, 56, '2026-10-27', false, 'manici in cuoio naturale'],
  ['BT-0922', 'Bottega Tremezzo', '2026-09-22', 'LEA_BAG_COCCO_VERDE', 10, 10, 62, '2026-10-06'],
  ['AB-1002', 'Atelier Brera', '2026-10-02', 'SVEVA_BAG_BORDEAUX', 12, 0, 71, '2026-10-30'],
  ['AB-1002', 'Atelier Brera', '2026-10-02', 'SVEVA_BAG_CUOIO', 8, 0, 71, '2026-10-30'],
  ['PR-0910', 'Pelletteria Rossi', '2026-09-10', 'AGATA_BAG_NERO', 15, 15, 47, '2026-09-30'],
  ['PR-0910', 'Pelletteria Rossi', '2026-09-10', 'AGATA_BAG_VERDE_BOSCO', 10, 6, 47, '2026-10-10'],
  ['PR-0910', 'Pelletteria Rossi', '2026-09-10', 'LEA_MINI_ROSA_CIPRIA', 0, 0, null, null, true, 'pelle in affinamento'],
  ['MG-1008', 'Minuterie Ghezzi', '2026-10-08', 'CHARM_TIGER_ORO', 40, 0, 9, '2026-10-22'],
  ['MG-1008', 'Minuterie Ghezzi', '2026-10-08', 'CHARM_TIGER_ARGENTO', 30, 30, 9, '2026-10-14'],
  ['BT-0805', 'Bottega Tremezzo', '2026-08-05', 'LEA_MINI_NERO', 12, 12, 44, '2026-09-01'],
  ['BT-0805', 'Bottega Tremezzo', '2026-08-05', 'MIMI_POCHETTE_LEOPARDO_SAVANA', 15, 15, 21, '2026-09-01'],
  ['BT-0805', 'Bottega Tremezzo', '2026-08-05', 'LEA_MINI_COCCO_VERDE', 6, 6, 46, '2026-09-04'],
];
const ORDINI_ARRIVO: Riga[] = RIGHE_ORDINE.map(([gruppo, fornitore, data_ordine, codice, qty, arr, costo, consegna, wip = false, note = null], i) => {
  const p = P(codice);
  const completo = !wip && arr >= qty;
  return {
    id: uid(10, i), gruppo, codice, item: p.item, variant: p.variant, fornitore, qty_ordered: qty, qty_arrived: arr, mancano: wip ? 0 : Math.max(0, qty - arr), completo,
    nuovo_riordino: codice === 'LEA_MINI_COCCO_VERDE' ? 'Nuovo' : 'Riordino', costo_unitario: costo, data_consegna: consegna, data_consegna_display: consegna,
    data_ultimo_arrivo: arr > 0 ? (completo ? consegna : '2026-10-13') : null, data_ordine, image_url: p.foto, wip, note,
    created_at: `${data_ordine}T09:30:00+00:00`,
  };
});
const inArrivo = (codice: string) => ORDINI_ARRIVO.filter((o) => o.codice === codice && !o.completo).reduce((s, o) => s + Number(o.mancano), 0);

// ---------------------------------------------------------------- vendite: ordini online e scontrini del negozio
type OrdineOnline = { n: number; data: string; cliente: string; righe: number[]; pct: number; codice: string | null; rimborso: boolean; evaso: boolean; senzaMargine: boolean };
const ORDINI: OrdineOnline[] = [];
{
  let n = 1421, k = 0;
  for (let m = 1; m <= 10; m++) {
    const quanti = m === 10 ? 8 : m === 9 ? 10 : 5;
    for (let j = 0; j < quanti; j++, k++, n++) {
      const g = m === 10 ? 1 + Math.floor((j * 14) / quanti) : 2 + Math.floor((j * 27) / quanti);
      const data = `2026-${pad(m)}-${pad(g)}T${pad(8 + (k % 11))}:${pad((k * 17) % 60)}:00+00:00`;
      const a = (k * 7) % 15, b = (k * 3 + 5) % 15;
      const codice = m === 7 && j < 2 ? 'SALDI20' : k % 6 === 2 ? 'BENVENUTA10' : k % 6 === 5 && m >= 9 ? 'AMICA12' : null;
      const pct = codice === 'SALDI20' ? 0.2 : codice === 'BENVENUTA10' ? 0.1 : codice === 'AMICA12' ? 0.12 : 0;
      ORDINI.push({ n, data, cliente: CLIENTI[k % CLIENTI.length], righe: k % 4 === 0 && a !== b ? [a, b] : [a], pct, codice, rimborso: [7, 23, 44].includes(k), evaso: data < '2026-10-11', senzaMargine: k === 30 });
    }
  }
}
const lordoDi = (o: OrdineOnline) => o.righe.reduce((s, i) => s + (PRODOTTI[i].prezzo ?? 0), 0);
const SHOPIFY_ORDERS: Riga[] = ORDINI.map((o, i) => {
  const lordo = lordoDi(o), gross = tondo(lordo * (1 - o.pct));
  return {
    id: uid(20, i), order_id: String(o.n), order_number: '#' + o.n, customer_name: o.cliente, customer_email: emailDi(o.cliente, i), created_at_shop: o.data,
    net_total: tondo(gross / 1.22), gross_total: gross, financial_status: o.rimborso ? 'refunded' : 'paid', fulfillment_status: o.evaso ? 'fulfilled' : null, discount_code: o.codice,
  };
});
const SHOPIFY_LINE_ITEMS: Riga[] = ORDINI.flatMap((o, i) => o.righe.map((idx, j) => ({
  id: uid(21, i * 2 + j), codice: PRODOTTI[idx].codice, created_at: o.data, quantita: 1, price: PRODOTTI[idx].prezzo, lineitem_name: nomeDi(PRODOTTI[idx]), order_id: String(o.n),
})));
const SCONTRINI = [0, 9, 6, 1, 9, 11, 0, 13, 3, 9, 6, 2, 0, 10, 7, 9, 1, 11, 13, 8, 9, 0, 6, 3];
const PAGAMENTI = ['Carta', 'Contanti', 'Satispay', 'Carta'];
const QROMO_SALES: Riga[] = SCONTRINI.map((idx, k) => {
  const p = PRODOTTI[idx];
  const [nome, cognome] = k % 3 === 2 ? ['', ''] : CLIENTI[(k * 5) % CLIENTI.length].split(' ');
  return { id: uid(22, k), codice: p.codice, item: p.item, variant: p.variant, data: giornoFa(1 + k * 3), quantita: 1, prezzo: p.prezzo, nome: nome || null, cognome: cognome || null, payment_method: PAGAMENTI[k % 4], created_at: isoFa(1 + k * 3, 17) };
});
const RETTIFICHE: Riga[] = [
  { id: uid(24, 0), codice_norm: 'LEA_BAG_LEOPARDO_SAVANA', data: giornoFa(16), qty_delta: 1, motivo: 'conta fisica scaffale A' },
  { id: uid(24, 1), codice_norm: 'LEA_BAG_LEOPARDO_SAVANA', data: giornoFa(41), qty_delta: -1, motivo: 'cambio: uscita la Lea Bag Nero' },
  { id: uid(24, 2), codice_norm: 'AGATA_BAG_NERO', data: giornoFa(1), qty_delta: -1, motivo: 'conta fisica' },
];
// scheda prodotto: acquisti - righe di vendita + rettifiche = magazzino + conto vendita
const acquistatiInScheda = (p: Prodotto) =>
  p.giac + p.cv + [...SHOPIFY_LINE_ITEMS, ...QROMO_SALES].filter((r) => r.codice === p.codice).length
  - RETTIFICHE.filter((r) => r.codice_norm === p.codice).reduce((s, r) => s + Number(r.qty_delta), 0);

// ---------------------------------------------------------------- CE: 10 mesi del 2026, ottobre in corso
const ON = [9800, 11200, 13500, 12800, 15400, 14100, 12600, 9900, 16800, 8200];
const OFF = [3100, 2800, 3600, 4200, 4800, 3900, 3400, 2200, 4600, 2100];
const B2B = [0, 0, 600, 0, 1200, 0, 800, 0, 1500, 0];
const MKT = [1900, 2100, 2600, 2400, 2900, 2700, 2200, 1500, 3100, 900];
const EVENTI = [0, 0, 850, 0, 1200, 0, 0, 0, 1400, 0];
const OPEX = [1650, 1580, 1720, 1810, 1690, 1760, 1640, 1590, 1880, 480];
const TASSE = [1180, 940, 1020, 1350, 990, 1110, 1260, 870, 1040, 0];
function ceMese(m: number, f: number): Riga {
  const i = m - 1, inCorso = m === 10;
  const on = ON[i] * f, off = OFF[i] * f, b2b = B2B[i] * f, omni = on + off + b2b;
  const onP = Math.round(on / 104), offP = Math.round(off / 112), b2bP = Math.round(b2b / 72);
  const v = {
    cogs: -omni * 0.27, packaging: -(3.71 * (onP + offP) + Math.round(on / 168)), commissioni: -on * 1.22 * 0.024, logistica_var: -on * 0.055, resi: -omni * 0.018, compenso_soci: -omni * 0.025,
  };
  const mc1 = omni + Object.values(v).reduce((s, x) => s + x, 0);
  const fissi = { salari: inCorso ? 0 : -3200, tasse: -TASSE[i], logistica_mag: inCorso ? -310 : -620, opex: -OPEX[i], eventi: -EVENTI[i], marketing: -MKT[i] };
  const mc2 = mc1 + Object.values(fissi).reduce((s, x) => s + x, 0);
  const r: Riga = {
    year: 2026, month: m, online_lordo: on * 1.22, online_netto: on, online_pezzi: onP, offline_lordo: off * 1.22, offline_netto: off, offline_pezzi: offP,
    b2b_lordo: b2b * 1.22, b2b_netto: b2b, b2b_pezzi: b2bP, omni_netto: omni, ...v, mc1, ...fissi, mc2, base_compenso_soci: omni,
  };
  for (const k of Object.keys(r)) if (typeof r[k] === 'number' && k !== 'year' && k !== 'month') r[k] = tondo(r[k] as number);
  return r;
}
const MESI_CE = Array.from({ length: 10 }, (_, i) => i + 1);

// ---------------------------------------------------------------- tabelle e viste (PostgREST finto)
const SALUTE: Riga[] = [
  ['ce_drift_mesi_chiusi', 'Mesi chiusi allineati al CE congelato', 0, 'ok'], ['ce_ricavi_vs_shopify', 'Ordini del mese uguali a Shopify API', 0, 'ok'],
  ['ce_cogs_mancanti', 'Vendite senza COGS', 2, 'warn'], ['ce_qromo_unresolved', 'Vendite Qromo non risolte', 0, 'ok'], ['giacenze_negative', 'Giacenze negative', 0, 'ok'],
  ['spese_categoria', 'Spese con categoria non valida', 0, 'ok'], ['spese_da_verificare', 'Spese da verificare', 4, 'warn'], ['sync_stock', 'Sync stock Shopify nelle ultime 2 ore', 0, 'ok'],
  ['shopify_token', 'Token Shopify valido', 0, 'ok'], ['period_mismatch', 'Periodi del CE coerenti', 0, 'ok'],
].flatMap(([k, label, n, severity]) => [0, 1].map((fa) => ({ k, label, n, severity, day: giornoFa(fa) })));

const SPESE: Riga[] = [
  ['ADDEBITO SDD META PLATFORMS IRELAND LTD FB.ME/ADS', -1240.5, 'MARKETING', 'Meta Ads', true, 'DA VERIFICARE (Meta Ads settembre)', null, 'approved', '2026-09-30'],
  ['PAGAMENTO POS 03/10 ENI STATION MILANO VIALE FORLANINI', -62.4, 'LOGISTICA', 'Carburante', false, 'DA VERIFICARE (carburante ENI)', null, 'approved', '2026-10-03'],
  ['BONIFICO A BOTTEGA TREMEZZO SRL FATT. 118/2026', -2860, 'COGS', 'Produzione', true, 'DA VERIFICARE', null, 'approved', '2026-10-06'],
  ['Scatole regalo bordeaux 200 pz (Packly)', -318, 'PACKAGING', 'Scatole', true, null, 'Bene', 'pending', '2026-10-12'],
].map(([operazione, costo, categoria, sottocategoria, amimi, note, proposed_by, status, data], i) => ({
  id: uid(30, i), date_paid: data, operazione, costo, categoria, sottocategoria, amimi, note, proposed_by, status, year: 2026, month: Number(String(data).slice(5, 7)),
  date_reported: data, amimi_raw: amimi ? 'si' : 'No', created_at: `${data}T12:00:00+00:00`,
}));

const CHANGE_LOG: Riga[] = [
  ['gifts_offline', 'gift', 'Bene', isoFa(0, 9, 12), { codice: 'CHARM_TIGER_ORO', quantita: 1, nome: 'Redazione Grazia' }],
  ['shopify_stock', 'stock_autopush', 'cron', isoFa(0, 7, 27), { pushed: 3, held: 1 }],
  ['purchases', 'arrival', 'Ginevra', isoFa(1, 15, 40), { codice: 'CHARM_TIGER_ARGENTO', qty: 30 }],
  ['qromo_sales', 'qromo_sale', 'qromo-forward', isoFa(1, 15, 5), { codice: 'LEA_BAG_NERO', qty: 1 }],
  ['counts', 'count_apply', 'Ginevra', isoFa(1, 9, 5), { codice: 'AGATA_BAG_NERO', contati: 11, giac_prima: 12, delta: -1 }],
  ['expenses', 'expense_approve', 'Bene', isoFa(2, 13), { categoria: 'MARKETING', note: 'VERIFICATO (Meta Ads agosto)' }],
  ['products', 'product_verify', 'Bene', isoFa(3, 10), { codice: 'LEA_MINI_NERO' }],
  ['returns', 'return', 'Bene', isoFa(4, 12), { codice: 'AGATA_BAG_ROSSO', quantita: 1 }],
  ['expenses', 'expense_propose', 'Bene', isoFa(5, 9), { operazione: 'Scatole regalo bordeaux 200 pz', costo: -318, categoria: 'PACKAGING' }],
  ['supplier_orders', 'order_update', 'Ginevra', isoFa(5, 8), { codice: 'SVEVA_BAG_BORDEAUX', fornitore: 'Atelier Brera', data_consegna: '2026-10-30' }],
  ['supplier_orders', 'order_multi', 'Ginevra', isoFa(7, 8), { fornitore: 'Minuterie Ghezzi', righe: 2 }],
  ['ce_snapshots', 'close_month', 'Ale', isoFa(13, 16), { amimi: 21480.55, totale: 23105.1 }],
].map(([tbl, op, chi, ts, after], i) => ({ id: 9120 - i, tbl, row_id: tbl === 'ce_snapshots' ? '2026-09' : uid(40, i), op, chi, ts, after }));

const SPEDIZIONI: Riga[] = [
  ...[['Destinatario assente', 1471, 4], ['Indirizzo incompleto', 1475, 2], ['In giacenza presso il deposito', 1466, 7]].map(([stato, n, fa], i) => ({
    ldv: `TWS44${70 + i}1902`, order_name: '#' + n, stato_tws: stato, stato_raw: String(stato).toUpperCase(), shipped_date: giornoFa(Number(fa) + 2), seen_delivered_at: null,
    updated_at: isoFa(Number(fa), 18), customer_name: CLIENTI[(Number(n) * 3) % CLIENTI.length], data_ordine: giornoFa(Number(fa) + 3), classe: 'eccezione',
  })),
  ...Array.from({ length: 34 }, (_, i) => ({
    ldv: `TWS45${pad(i)}2210`, order_name: '#' + (1446 + i), stato_tws: 'Consegnata', stato_raw: 'CONSEGNATA', shipped_date: giornoFa(1 + Math.floor(i * 0.8)), seen_delivered_at: isoFa(Math.floor(i * 0.8), 12),
    updated_at: isoFa(Math.floor(i * 0.8), 12), customer_name: CLIENTI[i % CLIENTI.length], data_ordine: giornoFa(2 + Math.floor(i * 0.8)), classe: 'consegnata',
  })),
];

const RFM: Riga[] = [
  ['Beatrice Fontana', 'top', 6, 1146], ['Giulia Rossi', 'top', 5, 893], ['Laura Colombo', 'top', 4, 776], ['Marta Bianchi', 'ripetuto', 3, 547], ['Camilla Sala', 'ripetuto', 2, 388],
  ['Sara Conti', 'ripetuto', 2, 348], ['Elena Greco', 'ripetuto', 2, 318], ['Ilaria Testa', 'ripetuto', 2, 228], ['Chiara Villa', 'nuovo', 1, 189], ['Anna Ferri', 'nuovo', 1, 229],
  ['Federica Moretti', 'nuovo', 1, 159], ['Valentina Riva', 'nuovo', 1, 79], ['Francesca Galli', 'nuovo', 1, 189], ['Alessia Marino', 'nuovo', 1, 118], ['Martina Leone', 'una_tantum', 1, 189],
  ['Silvia Gatti', 'una_tantum', 1, 159], ['Paola Bruno', 'una_tantum', 1, 229], ['Roberta Costa', 'una_tantum', 1, 39], ['Giorgia Rinaldi', 'una_tantum', 1, 149], ['Noemi Caruso', 'una_tantum', 1, 79],
  ['Debora Ferrara', 'una_tantum', 1, 189], ['Cristina Lombardi', 'una_tantum', 1, 159], ['Serena Barbieri', 'una_tantum', 1, 199], ['Michela Pellegrini', 'dormiente', 2, 368],
  ['Daniela Santoro', 'dormiente', 1, 189], ['Teresa Mariani', 'dormiente', 1, 159], ['Lucia De Luca', 'dormiente', 1, 79], ['Irene Vitale', 'dormiente', 1, 229],
].map(([nome, segmento, frequency, monetary], i) => {
  const rec = segmento === 'dormiente' ? 190 + i * 7 : segmento === 'una_tantum' ? 95 + i * 4 : segmento === 'nuovo' ? 6 + i * 3 : 10 + i * 9;
  return {
    email: emailDi(String(nome), i), primo_ordine: giornoFa(rec + Number(frequency) * 70), ultimo_ordine: giornoFa(rec), recency_giorni: rec, frequency, monetary,
    aov: tondo(Number(monetary) / Number(frequency)), segmento,
  };
});
const COORTI: Riga[] = MESI_CE.map((m, i) => {
  const inizio = `2026-${pad(m)}-01`;
  const maturita = Math.round((ADESSO.getTime() - Date.parse(inizio + 'T00:00:00Z')) / 86400000);
  const clienti = [38, 44, 52, 49, 61, 57, 50, 39, 72, 31][i];
  return { coorte: inizio, maturita_giorni: maturita, clienti, ricomprato_30gg: 1 + (i % 3), ricomprato_60gg: 2 + (i % 3), ricomprato_90gg: maturita >= 90 ? 3 + (i % 4) : 2, netto_medio_cliente: [142, 151, 147, 158, 163, 149, 139, 144, 168, 152][i] };
});

const MARGINE_ORDINE: Riga[] = ORDINI.map((o, i) => {
  const lordo = lordoDi(o), sconto = tondo(lordo * o.pct), gross = lordo - sconto, netto = gross / 1.22;
  const cogs = o.righe.reduce((s, x) => s + (PRODOTTI[x].cogs ?? 0), 0), commissioni = gross * 0.024, packaging = 3.71 * o.righe.length + 1, rimborso = o.rimborso ? gross : 0;
  const margine = netto - cogs - commissioni - packaging - rimborso / 1.22;
  return {
    order_id: String(o.n), order_number: '#' + o.n, created_at_shop: o.data, year: 2026, month: Number(o.data.slice(5, 7)), pezzi: o.righe.length, ricavo_lordo: lordo, sconto,
    ricavo_netto: tondo(netto), cogs, commissioni: tondo(commissioni), packaging: tondo(packaging), spedizione_incassata: lordo >= 150 ? 0 : 7.9, rimborso: tondo(rimborso),
    margine_contribuzione: o.senzaMargine ? null : tondo(margine), margine_pct: o.senzaMargine ? null : tondo(margine / netto), refunded: o.rimborso, financial_status: o.rimborso ? 'refunded' : 'paid',
    _i: i,
  };
});
const MARGINE_SKU: Riga[] = PRODOTTI.slice(0, 15).flatMap((p, idx) => MESI_CE.flatMap((m) => (['online', 'offline'] as const).map((canale) => {
  const pezzi = canale === 'online' ? (idx * 3 + m * 5) % 4 : (idx + m) % 3 === 0 ? 1 : 0;
  const lordo = pezzi * (p.prezzo ?? 0), sconto = lordo * 0.06, netto = (lordo - sconto) / 1.22, cogs = pezzi * (p.cogs ?? 0);
  const commissioni = lordo * (canale === 'online' ? 0.025 : 0.012), packaging = pezzi * 3.71, margine = netto - cogs - commissioni - packaging;
  return {
    codice: p.codice, codice_norm: p.codice, item: p.item, variant: p.variant, year: 2026, month: m, canale, pezzi, ricavo_lordo: lordo, sconto: tondo(sconto), ricavo_netto: tondo(netto),
    cogs, commissioni: tondo(commissioni), packaging: tondo(packaging), margine_contribuzione: tondo(margine), margine_pct: netto ? tondo(margine / netto) : 0, pezzi_in_ordini_rimborsati: 0,
  };
}))).filter((r) => r.pezzi > 0);

// Ads: le campagne attive (COLD e SUPER HOT) con le loro creativita', e la vecchia serie mensile ferma al 01-07
const SET_DI: Record<string, string[]> = { ps_lea: ['LEA BAG', 'LEA MINI'], ps_agata: ['AGATA BAG'], ps_sveva: ['SVEVA BAG'], ps_charm: ['CHARM TIGER'], ps_tutte: ['LEA BAG', 'LEA MINI', 'SVEVA BAG', 'AGATA BAG', 'MIMI POCHETTE', 'CHARM TIGER'] };
const vivoSuShopify = (p: Prodotto) => p.shop && p.giac > 0;
const ADS: Riga[] = [
  ['Lea Leopardo · video UGC', 'COLD · Prospecting borse', 'Broad IT donne 25-54', 'ACTIVE', 'VIDEO', 'ps_lea', 412, 9, 1701, 1.42, 1.61, 1.55, 2.9, 'media', null, '#c4925a'],
  ['Sveva Bordeaux · foto studio', 'COLD · Prospecting borse', 'Broad IT donne 25-54', 'ACTIVE', 'SHARE', 'ps_sveva', 196, 2, 458, 0.71, 0.94, 1.12, 3.8, 'alta', 'Frequenza 3,8 a 7 giorni e CTR in calo: rinnova la creativita’ o allarga il pubblico. Nel set una sola Sveva e’ disponibile.', '#6b1d2b'],
  ['Carosello Agata · tre colori', 'COLD · Prospecting borse', 'Interessi moda artigianale', 'ACTIVE', 'SHARE', 'ps_agata', 268, 5, 795, 1.12, 1.08, 1.21, 2.1, 'ok', null, '#2e4a33'],
  ['Lea Nero · statica', 'COLD · Prospecting borse', 'Interessi moda artigianale', 'PAUSED', 'SHARE', 'ps_lea', 0, 0, 0, null, 0.88, 0.97, null, 'ok', null, '#232120'],
  ['Catalogo dinamico · tutte le borse', 'SUPER HOT · Retargeting 30g', 'Visitatori e carrelli 30g', 'ACTIVE', 'SHARE', 'ps_tutte', 233, 11, 2244, 2.31, 2.18, 2.05, 4.2, 'ok', null, '#8b5a32'],
  ['Charm Tiger · reel', 'SUPER HOT · Retargeting 30g', 'Visitatori e carrelli 30g', 'ACTIVE', 'VIDEO', 'ps_charm', 88, 4, 236, 1.87, 1.64, 1.7, 3.1, 'ok', null, '#caa64a'],
  ['Mimi Pochette · reel', 'SUPER HOT · Retargeting 30g', 'Visitatori e carrelli 30g', 'PAUSED', 'VIDEO', 'ps_tutte', 0, 0, 0, null, 1.2, 1.31, null, 'ok', null, '#24396f'],
].map(([ad_name, campaign_name, adset_name, effective_status, object_type, ps, spend, purch, value, ctr, ctrPrev, ctr90, freq, fatica, azione, colore], i) => {
  const prodotti = PRODOTTI.filter((p) => SET_DI[String(ps)].includes(p.item));
  const img = svgUri(disegno(String(colore), String(ad_name).includes('Charm') ? 'charm' : String(ad_name).includes('Pochette') ? 'pochette' : 'borsa', String(ad_name).includes('Leopardo') ? '#3a2614' : null, '#d9cfc4'));
  return {
    ad_id: `1202${pad(i)}55501`, as_of: giornoFa(1), ad_name, campaign_name, adset_name, campaign_id: String(campaign_name).startsWith('COLD') ? 'c1' : 'c2', adset_id: 'as' + String(adset_name).length,
    effective_status, product_set_id: ps, object_type, thumbnail_url: img, image_url: object_type === 'VIDEO' ? null : img, frame_url: object_type === 'VIDEO' ? img : null, link: null,
    spend_7: String(spend), purchases_7: String(purch), value_7: String(value), ctr_7: ctr == null ? null : String(ctr), ctr_prev7: String(ctrPrev), ctr_90: String(ctr90), cpm_7: '9.4',
    freq_media_giornaliera_7: freq == null ? null : String(tondo(Number(freq) / 4)), freq_7g: freq == null ? null : String(freq), cpa_7: Number(purch) ? String(tondo(Number(spend) / Number(purch))) : null,
    roas_7: Number(spend) ? String(tondo(Number(value) / Number(spend))) : null, prodotti_nel_set: prodotti.length, prodotti_risolti: prodotti.length,
    prodotti_oos: prodotti.filter((p) => !vivoSuShopify(p)).length, prodotti_non_su_shopify: prodotti.filter((p) => !p.shop).length,
    pct_oos: tondo(prodotti.filter((p) => !vivoSuShopify(p)).length / prodotti.length), stato_fatica: fatica, azione_suggerita: azione,
  };
});
const MODELLI_CATALOGO = [...new Set(PRODOTTI.map((p) => p.item))];
const ADS_CATALOGO: Riga[] = MODELLI_CATALOGO.map((item) => {
  const ps = PRODOTTI.filter((p) => p.item === item);
  return { categoria: ps[0].categoria, modello: titolo(item), prodotti: ps.length, su_shopify: ps.filter((p) => p.shop).length, live: ps.filter(vivoSuShopify).length };
});
const ADS_SET: Riga[] = Object.entries(SET_DI).flatMap(([ps, items]) => items.map((item) => {
  const pr = PRODOTTI.filter((p) => p.item === item);
  return { product_set_id: ps, categoria: pr[0].categoria, modello: titolo(item), prodotti: pr.length, live: pr.filter(vivoSuShopify).length };
}));
const SETTIMANE = ['2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07', '2026-08-31', '2026-08-24', '2026-08-17', '2026-08-10'];
const SPESA_SETT = [612, 1180, 1095, 1240, 1010, 980, 870, 760, 820, 905];
const ACQ_SETT = [17, 29, 24, 31, 22, 21, 17, 13, 16, 19];
const ADS_SETTIMANE: Riga[] = SETTIMANE.map((s, i) => ({
  settimana: s, spend: String(SPESA_SETT[i]), purchases: String(ACQ_SETT[i]), value: String(ACQ_SETT[i] * 176), cpa: String(tondo(SPESA_SETT[i] / ACQ_SETT[i])),
  roas: String(tondo((ACQ_SETT[i] * 176) / SPESA_SETT[i])), spend_wow: i < 9 ? String(SPESA_SETT[i] - SPESA_SETT[i + 1]) : null, purchases_wow: i < 9 ? String(ACQ_SETT[i] - ACQ_SETT[i + 1]) : null,
}));
const ADS_MENSILE: Riga[] = [820, 910, 1240, 1180, 1430, 1290].map((spend, i) => {
  const purchases = [14, 17, 24, 21, 27, 22][i];
  return { year: 2026, month: i + 1, spend, impressions: spend * 104, clicks: Math.round(spend * 1.6), purchases, purchase_value: purchases * 172, roas: tondo((purchases * 172) / spend) };
});

// Assistenza clienti: la coda e un thread di reso
const CONV: Riga[] = [
  ['Giulia Rossi', 'email_diretta', 'Reso e rimborso', 'da_fare', null, isoFa(0, 8, 41), 'Reso Lea Bag ordine #1478', 'Buongiorno, la Lea Bag è arrivata ma dal vivo il leopardo è più scuro: posso renderla?', 1478, false, null, [], 'Chiede il reso della Lea Bag Leopardo Savana (ordine #1478 del 6 ottobre) perché il colore dal vivo è più scuro. Ha già ordinato una volta.'],
  ['Marta Bianchi', 'form_contatto', 'Spedizione e stato ordine', 'da_fare', null, isoFa(0, 7, 12), 'Ordine #1480', 'Ho ordinato martedì e mi serve per sabato, riuscite a dirmi quando arriva?', 1480, true, 'evento sabato', ['sollecito'], 'Ordine #1480 non ancora spedito, le serve entro sabato per un evento. Secondo messaggio in tre giorni.'],
  [null, 'chat_notifica', 'Restock e disponibilita', 'da_fare', null, isoFa(1, 16, 30), null, 'Ciao! La Sveva bordeaux tornerà disponibile? Sul sito è esaurita', null, false, null, [], null, 'chiara.villa@libero.it'],
  ['Elena Greco', 'email_diretta', 'Personalizzazione e cerimonia', 'in_corso', 'Benedetta', isoFa(1, 10, 5), 'Pochette per damigelle', 'Vorrei sei Mimi Pochette uguali per le damigelle del mio matrimonio a maggio, si possono personalizzare con le iniziali?', null, false, null, [], 'Matrimonio a maggio: chiede 6 Mimi Pochette con le iniziali ricamate. Benedetta ha chiesto i colori.'],
  ['Sara Conti', 'form_evento', 'Ritiro, negozio, appuntamenti', 'da_fare', null, isoFa(3, 15), 'Appuntamento in showroom', 'Posso passare in showroom giovedì pomeriggio a vedere la Sveva dal vivo?', null, false, null, [], null],
  ['Marta Bianchi', 'email_diretta', 'Spedizione e stato ordine', 'da_fare', null, isoFa(2, 18), 'Info spedizione', 'Buonasera, quanto ci mette la spedizione a Bologna?', 1480, false, null, [], null],
  ['Anna Ferri', 'email_diretta', null, 'da_fare', null, isoFa(4, 9), 'Domanda sulla tracolla', 'Buongiorno, la tracolla della Agata si può accorciare? Sono alta 1,58', null, false, null, [], null],
  ['Federica Moretti', 'email_diretta', 'Codice sconto', 'fatto', 'auto', isoFa(2, 11), 'Codice benvenuto', 'Il codice BENVENUTA10 non funziona sul carrello', 1477, false, null, ['chiusura'], null],
  ['Valentina Riva', 'email_diretta', 'Cambio e prodotto errato', 'fatto', 'Ginevra', isoFa(7, 14), 'Cambio colore', 'Vorrei cambiare la Lea Mini nera con la rosa cipria', 1469, false, null, [], null],
  ['Notifiche Shopify', 'rumore', null, 'da_fare', null, isoFa(0, 6), 'Nuovo ordine #1481', 'Hai ricevuto un nuovo ordine', null, false, null, [], null, 'no-reply@shopify.com'],
].map(([nome, canale, categoria, stato, stato_by, last, subject, snippet, ordine, urgente, motivo, flags, summary, email], i) => ({
  id: uid(50, i), gmail_thread_id: `18f${pad(i)}a2b3c4d5e6`, canale, customer_email: email ?? emailDi(String(nome), i), customer_name: nome, stato, stato_by, last_msg_at: last,
  last_direction: 'in', subject, snippet, order_number: ordine, lingua: 'it', categoria, categoria_source: categoria ? 'ai' : 'ai_low', categoria_confidence: categoria ? 0.92 : 0.41,
  urgente, urgenza_motivo: motivo, flags, summary, parse_failed: false, created_at: isoFa(i === 5 ? 3 : 0, 6),
}));
const MESSAGGI: Riga[] = [
  ['in', null, isoFa(8, 9, 20), 'Ciao, ho appena ordinato la Lea Bag leopardo: riuscite a spedirla entro venerdì? Grazie!'],
  ['out', 'Benedetta', isoFa(8, 11, 2), 'Ciao Giulia, grazie mille per l’ordine! Parte oggi con TWS: ti arriva fra mercoledì e giovedì, ti mandiamo il tracking appena il corriere la ritira.\nUn abbraccio, Benedetta di Amimì'],
  ['in', null, isoFa(0, 8, 41), 'Buongiorno,\nla Lea Bag è arrivata ieri ed è bellissima, ma dal vivo il leopardo è più scuro di come lo vedevo in foto e non si abbina a quello che pensavo.\nPosso renderla? Ordine #1478.\nGrazie, Giulia'],
].map(([direction, sent_by, sent_at, body], i) => ({
  id: uid(51, i), conversation_id: uid(50, 0), direction, sent_by, from_email: direction === 'in' ? 'giulia.rossi@gmail.com' : 'info@amimi.it', to_email: direction === 'in' ? 'info@amimi.it' : 'giulia.rossi@gmail.com',
  sent_at, body_text: body, body_clean: body, is_via_tool: direction === 'out', form_fields: null,
}));

// Negozi B2B: la lista snella e la pipeline dell'outreach
const NEGOZI_B2B: Riga[] = [
  ['Studio Isola', 'boutique', 'Milano', 'reviewed', 86, 'A', 'da_contattare', 18400, 4.8, 212, [120, 210, 390], ['Maison Orsa', 'Tela Studio', 'Borse Lume'], true, 'Boutique di quartiere con borse artigianali italiane fra 150 e 300 €: lo stesso cliente di Amimì.'],
  ['Concept Nove', 'concept_store', 'Como', 'reviewed', 81, 'A', 'da_contattare', 9600, 4.7, 154, [95, 180, 320], ['Tela Studio', 'Nodo'], true, 'Concept store sul lago con una parete di accessori fatti a mano; vende già due marchi milanesi.'],
  ['Atelier Navigli', 'boutique', 'Milano', 'scored', 77, 'B', null, 12100, 4.6, 98, [140, 230, 410], ['Maison Orsa'], true, 'Buona affinità di stile, prezzi un po’ più alti della media Amimì.'],
  ['Dodici Gradi', 'concept_store', 'Torino', 'scored', 72, 'B', null, 7800, 4.5, 76, [80, 150, 260], ['Borse Lume'], false, 'Concept store giovane, feed curato, poche borse in vetrina.'],
  ['La Soffitta', 'boutique', 'Bologna', 'reviewed', 68, 'B', 'forse', 5400, 4.4, 133, [70, 130, 240], [], true, 'Boutique storica in centro, clientela adulta: da sentire in primavera.'],
  ['Maison Lido', 'hotel_shop', 'Venezia', 'scored', 64, 'B', null, 3100, 4.6, 41, [110, 190, 350], [], false, 'Shop di un boutique hotel al Lido, aperto da marzo a ottobre.'],
  ['Casa Verde', 'negozio_regalo', 'Bergamo', 'reviewed', 58, 'C', 'no', 2200, 4.3, 67, [25, 45, 90], [], false, null],
  ['Corte dei Fiori', 'boutique', 'Verona', 'enriched', null, null, null, 4100, 4.5, 58, null, [], false, null],
  ['Spazio Brera 12', 'boutique', 'Milano', 'rejected', 31, 'C', null, 26000, 4.2, 310, [450, 890, 2100], [], false, 'Vende solo grandi marchi del lusso.'],
].map(([nome, tipo, citta, stato, totale, tier, verdetto, follower, rating, recensioni, borse, peer, img, motivazione], i) => ({
  id: uid(60, i), nome, tipo, citta, paese: 'IT', website: null, ig_handle: String(nome).toLowerCase().replace(/[^a-z0-9]+/g, ''), telefono: null, email_generica: `info@${String(nome).toLowerCase().replace(/[^a-z0-9]+/g, '')}.it`,
  stato_ricerca: stato, lead_stage: i < 3 ? ['risposto', 'contattato', 'da_contattare'][i] : i === 4 ? 'interessato' : 'da_contattare', tier: stato === 'reviewed' ? tier : null, gancio: null, owner_note: null,
  verdetto, verdetto_motivo: verdetto === 'no' ? 'Troppo orientato al regalo sotto i 50 €.' : null, totale, tier_proposto: tier, esclusione: stato === 'rejected' ? motivazione : null,
  motivazione: stato === 'rejected' ? null : motivazione, n_evidenze: totale ? 9 + i : 3, ig_metrics: { follower }, maps: { rating, recensioni, telefono: null },
  brands_carried: { peer_match: peer, vendors: null }, price_band: borse ? { borse: { n: 8 + i, min: (borse as number[])[0], mediana: (borse as number[])[1], max: (borse as number[])[2] } } : null,
  img: img ? `ig/feed/${uid(60, i)}/1.jpg` : null,
}));
const OUTREACH: Riga[] = NEGOZI_B2B.slice(0, 5).filter((r) => r.lead_stage !== 'da_contattare' || r.verdetto === 'da_contattare').map((r, i) => ({
  id: r.id, nome: r.nome, tipo: r.tipo, citta: r.citta, provincia: null, paese: 'IT', website: null, ig_handle: r.ig_handle, email_generica: r.email_generica, telefono: null,
  lead_stage: r.lead_stage, verdetto: r.verdetto, verdetto_motivo: null, tier: r.tier, gancio: null, prossima_azione: i === 1 ? 'Follow-up dopo la prima email' : null,
  prossima_azione_at: i === 1 ? giornoFa(2) : null, owner_outreach: 'Bene', owner_note: null, totale: r.totale, tier_proposto: r.tier_proposto,
  ultimo_tocco_at: r.lead_stage === 'da_contattare' ? null : isoFa(i + 1, 11), ultimo_canale: 'email', ultima_direzione: i === 0 ? 'in' : 'out', ultimo_esito: i === 0 ? 'chiede_info' : null,
  ultimo_chi: 'Bene', n_tocchi: r.lead_stage === 'da_contattare' ? 0 : 2, n_email_out: r.lead_stage === 'da_contattare' ? 0 : 1, giorni_da_ultimo: i + 1, scaduta: i === 1, da_gestire: i === 0,
  thumb: null, follower: (r.ig_metrics as { follower: number }).follower, telefono_maps: null, email_sito: null, n_opt_out: 0, bozza_auto_tocco: null,
}));

// Materie prime: catalogo dei fornitori di pelli, tessuti e minuterie
const MAT_FORNITORI = ['Conceria Valdarno', 'Pellami Arzignano', 'Tessuti Brianza', 'Nastrificio Como', 'Minuterie Ghezzi'];
const MAT: Riga[] = [
  [0, 'Cocco', 'Cocco opaco stampato', 'CV-218', ['Verde bottiglia', 'Nero'], 38.5, 'mq', true],
  [0, 'Pelle vitello', 'Vitello liscio Dollaro', 'DOL-14', ['Cuoio', 'Bordeaux', 'Nero'], 46, 'mq', true],
  [1, 'Animalier', 'Cavallino leopardo savana', 'CAV-LS', ['Leopardo savana'], 62, 'mq', true],
  [1, 'Vernice', 'Vernice specchio', 'VS-90', ['Rosso'], 41, 'mq', false],
  [1, 'Crosta/Velour', 'Velour scamosciato', 'VEL-3', ['Cammello'], null, 'mq', false],
  [2, 'Tessuto velluto', 'Velluto liscio', 'TB-V12', ['Blu notte', 'Cipria'], 24, 'ml', true],
  [2, 'Tessuto', 'Raso duchesse', 'TB-R4', ['Cipria'], null, 'ml', false],
  [3, 'Nastri', 'Gros-grain 25 mm', 'GG25', ['Nero'], 0.9, 'mt', true],
  [4, 'Accessori metallici', 'Moschettone 25 mm', 'MO-25', ['Oro', 'Argento'], 1.2, 'pz', true],
  [4, 'Accessori metallici', 'Catena barbazzale', 'CB-8', ['Oro'], 6.8, 'mt', false],
].flatMap(([f, categoria, materiale, articolo, colori, prezzo, unita, acquistato], g) => (colori as string[]).map((colore, c) => ({
  item_id: uid(80, g * 4 + c), supplier_id: uid(81, Number(f)), fornitore: MAT_FORNITORI[Number(f)], categoria, materiale, articolo_fornitore: articolo, colore, unita, attivo: true, note: null,
  offerta_id: acquistato ? null : uid(82, g), offerta_tipo: acquistato ? null : 'listino', offerta_prezzo: acquistato ? null : prezzo, offerta_prezzo_text: prezzo == null ? '18-21' : null,
  offerta_unita: unita, disponibilita: 'pronto magazzino', min_ordine: unita === 'pz' ? '200 pz' : '10 ' + unita, lead_time: '3 settimane', offerta_data: giornoFa(40 + g), offerta_fonte: 'email',
  acquisto_documento: acquistato ? `FT ${110 + g}/2026` : null, acquisto_data: acquistato ? giornoFa(30 + g * 6) : null, acquisto_quantita: acquistato ? 12 + g : null, acquisto_unita: unita,
  acquisto_prezzo: acquistato ? prezzo : null, acquisto_importo: acquistato && prezzo != null ? tondo(Number(prezzo) * (12 + g)) : null, acquistato,
  prezzo_rif: prezzo, prezzo_rif_text: prezzo == null ? '18-21' : null, unita_rif: unita, foto_path: g === 9 ? null : `campioni/${String(materiale).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${colore.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`,
  n_foto: 1 + (g % 3), n_schede: g % 2, condizioni_pagamento: '30 gg data fattura', deposito_luogo: null, fornitore_email: null, fornitore_telefono: null, fornitore_referente: null,
})));
const MAT_FORN: Riga[] = MAT_FORNITORI.map((nome, i) => {
  const righe = MAT.filter((r) => r.fornitore === nome);
  return {
    id: uid(81, i), nome, ragione_sociale: `${nome} srl`, categoria_principale: righe[0].categoria, email: `ordini@${nome.toLowerCase().replace(/[^a-z]+/g, '')}.it`, telefono: `+39 02 5${i}41 2${i}87`,
    referente: CLIENTI[i + 8], indirizzo: null, piva_vat: null, deposito_luogo: i === 0 ? 'Santa Croce sull’Arno' : null, condizioni_pagamento: '30 gg data fattura', note: null, attivo: true,
    n_materiali: new Set(righe.map((r) => r.materiale)).size, categorie: [...new Set(righe.map((r) => r.categoria))].join(', '), n_offerte: righe.filter((r) => !r.acquistato).length,
    n_ordini: righe.filter((r) => r.acquistato).length, tot_imponibile: righe.reduce((s, r) => s + Number(r.acquisto_importo ?? 0), 0), ultimo_acquisto: righe.find((r) => r.acquisto_data)?.acquisto_data ?? null, n_asset: righe.length,
  };
});

// Premia: la dashboard del programma fedelta' e la coda delle recensioni
const PREMIA_GIORNI = Array.from({ length: 30 }, (_, j) => {
  const fa = 29 - j, visite = 22 + ((j * 7) % 23) + ((j + 3) % 7 < 2 ? 12 : 0), riscatti = (j * 7) % 5;
  return {
    day: giornoFa(fa), visite_clienti: visite, visite_hits: visite * 3, clienti_attivi: visite, coccole: visite * 2, memory: Math.round(visite * 0.6), accrediti_acquisto: 4 + (j % 5),
    punti_guadagnati: 520 + j * 9, punti_riscattati: riscatti * 100, riscatti, riscatti_falliti: fa === 4 ? 1 : 0,
  };
});
function premia(giorni: number): Riga {
  return {
    generated_at: isoFa(0, 9, 58), days: giorni, from: giornoFa(giorni - 1), to: giornoFa(0),
    health: [
      ['loyalty_ledger', 'saldi coerenti con lo storico punti', 0, 'ok'], ['loyalty_pool', '138 codici AMICA12 liberi', 138, 'ok'], ['loyalty_pending', 'nessun riscatto in attesa', 0, 'ok'],
      ['loyalty_orders_fresh', 'ultimo giro accrediti alle 08:02', 0, 'ok'], ['loyalty_birthday', 'giro compleanni finito (3 auguri)', 3, 'ok'],
      ['loyalty_bonus_second', '3 finestre seconda borsa scadute senza bonus', 3, 'warn'],
    ].map(([k, label, n, severity], i) => ({ k, label, n, severity, day: giornoFa(i === 4 ? 1 : 0) })),
    flags: { loyalty_redeem_enabled: 'on', loyalty_purchase_enabled: 'on', loyalty_profile_enabled: 'on', loyalty_bonus_second_enabled: 'test', loyalty_track_enabled: 'on' },
    orders_last_run: isoFa(0, 6, 2), kpi_daily: PREMIA_GIORNI.slice(-Math.min(30, giorni)),
    pool: [{ reward: 'amica12', label: 'AMICA12', cost_points: 100, active: true, liberi: 138, usati: 212, pending: 0, riscatti_14gg: 23, giorni_ritmo: 14 }],
    members: { totale: 1846, lt50: 1203, b50_99: 412, ge100: 231, tier_saldo: {}, tier_cumulato: {} },
    visitatori: { periodo: 612, totale: 1588, dal: '2026-09-12' }, second: { finestre_aperte: 96, in_scadenza_14gg: 17, bonus_dati: 41 }, redeem_rate: null,
    amica12: { riscattati_totale: 212, riscattati_periodo: 58, ordini_totale: 131, ordini_periodo: 37, lordo_totale: 24890, sconto_totale: 2987, con_reso: 4 },
    vendite: { ordini_periodo: 214, lordo_periodo: 31840, ordini_dopo_visita: 96, lordo_dopo_visita: 15120 },
    uplift: [
      { segmento: 'membro', ordini: 203, scontrino_medio_lordo: 151, lordo_totale: 30650, ordini_con_reso: 6, clienti_distinti_per_email: 188 },
      { segmento: 'ospite', ordini: 11, scontrino_medio_lordo: 108, lordo_totale: 1190, ordini_con_reso: 0, clienti_distinti_per_email: 11 },
    ],
    funnel: { aperture: 612, sessioni: 1490, visto_premio: 488, premio_pronto: 142, tap_riscatta: 71, riscatti: 58, ordini_amica12: 37, eventi: 5210, dal: '2026-10-11' },
    elementi: [
      { event: 'tap', element: 'mimi', n: 1320, clienti: 301 }, { event: 'tap', element: 'coccola', n: 980, clienti: 255 }, { event: 'view', element: 'redeem_ready', n: 410, clienti: 142 },
      { event: 'tap', element: 'gioco', n: 402, clienti: 133 }, { event: 'view', element: 'ugc', n: 210, clienti: 180 }, { event: 'tap', element: 'redeem', n: 88, clienti: 71 },
      { event: 'tap', element: 'copy_code', n: 64, clienti: 52 },
    ],
  };
}
const UGC: Riga[] = [
  { id: 41, kind: 'look', codice: 'LEA_BAG_LEOPARDO_SAVANA', titolo: 'Lea Bag Leopardo Savana', rating: null, testo: 'La porto ovunque, anche in ufficio: ormai me la chiedono tutte le colleghe!', firma: 'Giulia R.', foto: ['ugc/41/look-leopardo.jpg', 'ugc/41/dettaglio-leopardo.jpg'], verificata: true, cliente: 'gi***@gmail.com', status: 'in_revisione', motivo: null, punti: 30, created_at: isoFa(0, 18, 22), deciso_at: null, deciso_da: null },
  { id: 42, kind: 'recensione', codice: 'AGATA_BAG_NERO', titolo: 'Agata Bag Nero', rating: 5, testo: 'Pelle morbidissima e cuciture perfette. La tracolla si regola bene anche per chi è bassa come me.', firma: 'Sara', foto: [], verificata: false, cliente: 'sa***@libero.it', status: 'in_revisione', motivo: null, punti: 20, created_at: isoFa(1, 21, 3), deciso_at: null, deciso_da: null },
];

// Notifiche native: temi e telefoni iscritti
const TEMI = [
  { key: 'conti', etichetta: 'Controlli contabili', descrizione: 'Quando il controllo dei conti trova un errore nuovo', predefinito_per: ['Ale'] },
  { key: 'vendite', etichetta: 'Vendite ferme', descrizione: 'Quando non arrivano ordini da 24 ore', predefinito_per: ['Ale'] },
  { key: 'negozi', etichetta: 'Negozi B2B', descrizione: 'Quando un negozio contattato risponde', predefinito_per: ['Ale', 'Bene'] },
  { key: 'assistenza', etichetta: 'Assistenza clienti', descrizione: 'Richieste urgenti', predefinito_per: ['Ginevra'] },
  { key: 'spedizioni', etichetta: 'Spedizioni', descrizione: 'Problemi segnalati dal corriere', predefinito_per: ['Ginevra'] },
  { key: 'sistema', etichetta: 'Sistema', descrizione: 'Lettura della posta clienti ferma', predefinito_per: ['Ale'] },
  { key: 'riepilogo', etichetta: 'Riepilogo serale', descrizione: 'Alle 18:30, solo se c’è qualcosa', predefinito_per: ['Ale', 'Bene', 'Ginevra'] },
];
const VAPID_BYTES = [4, ...Array.from({ length: 64 }, (_, i) => i + 1)];
const VAPID = Buffer.from(VAPID_BYTES).toString('base64url');
// il telefono delle schermate e' l'iPhone di Ale, iscritto (device_id come la edge vera: mai restituito, solo "questo")
const DEVICE_QUI = uid(71, 0);
const DISPOSITIVI = [
  { id: uid(70, 0), device: DEVICE_QUI, chi: 'Ale', etichetta: 'iPhone · Safari', temi: ['conti', 'vendite', 'negozi', 'sistema', 'riepilogo'], created_at: isoFa(1, 8, 10), last_ok_at: isoFa(0, 6, 30), last_status: 201 },
  { id: uid(70, 1), device: uid(71, 1), chi: 'Ginevra', etichetta: 'Android · Chrome', temi: ['assistenza', 'spedizioni', 'riepilogo'], created_at: isoFa(1, 9), last_ok_at: isoFa(1, 16, 30), last_status: 201 },
  { id: uid(70, 2), device: uid(71, 2), chi: 'Bene', etichetta: 'iPhone · Safari', temi: ['negozi', 'riepilogo'], created_at: isoFa(0, 7, 45), last_ok_at: null, last_status: null },
];

const TABELLE: Record<string, Riga[]> = {
  products: [
    ...PRODOTTI.map((p, i) => ({
      codice: p.codice, item: p.item, variant: p.variant, model: p.item, categoria: p.categoria, image_url: p.foto, retail_price: p.prezzo, cogs: p.cogs,
      description: i % 5 === 3 ? null : `Borsa fatta a mano a Milano in ${titolo(p.variant).toLowerCase()}, con tracolla regolabile.`, seo_title: null, verificato: i < 15,
      status: p.shop ? 'active' : 'draft', created_at: isoFa(200 - i * 9),
    })),
    { codice: 'CLUTCH_ARIA', item: 'CLUTCH ARIA', variant: null, model: null, categoria: null, image_url: null, retail_price: null, cogs: null, description: null, seo_title: null, verificato: false, status: 'draft', created_at: isoFa(7) },
  ],
  v_inventory: PRODOTTI.map((p) => ({
    codice: p.codice, item: p.item, variant: p.variant, categoria: p.categoria, giacenza_attuale: p.giac, in_conto_vendita: p.cv, disponibili_da_vendere: p.giac, valore: tondo(p.giac * (p.cogs ?? 0)),
    retail_price: p.prezzo, cogs: p.cogs, last_sale: p.ultima == null ? null : giornoFa(p.ultima), on_shopify: p.shop, image_url: p.foto, qty_purchased: acquistati(p),
    shopify_sold: p.venduti[0], qromo_sold: p.venduti[1], gift_sold: p.venduti[2], b2b_venduto: p.venduti[3],
  })),
  v_reorder: PRODOTTI.map((p) => ({
    codice: p.codice, item: p.item, variant: p.variant, image_url: p.foto, giacenza: p.giac, disponibili: p.giac, on_shopify: p.shop, venduto_60d: p.v60, in_arrivo: inArrivo(p.codice),
    giorni_stock: p.v60 > 0 ? Math.round(p.giac / (p.v60 / 60)) : null, riordino_archiviato: p.codice === 'AGATA_BAG_SENAPE',
  })),
  v_sku_availability: PRODOTTI.map((p) => ({ codice: p.codice, item: p.item, variant: p.variant, image_url: p.foto, giacenza: p.giac, disponibili: p.giac, on_shopify: p.shop, stato: p.giac > 0 ? 'disponibile' : 'esaurito' })),
  shopify_stock: PRODOTTI.filter((p) => p.shop).map((p) => ({ codice: p.codice, shopify_qty: p.codice === 'LEA_BAG_NERO' ? p.giac - 1 : p.giac, synced_at: isoFa(0, 7, 27) })),
  v_shopify_align: PRODOTTI.filter((p) => p.shop).map((p) => ({ codice: p.codice, item: p.item, variant: p.variant, image_url: p.foto, giacenza: p.giac, disponibili: p.giac, shopify_qty: p.codice === 'LEA_BAG_NERO' ? p.giac - 1 : p.giac, diff: p.codice === 'LEA_BAG_NERO' ? 1 : 0, synced_at: isoFa(0, 7, 27), on_shopify: true })),
  v_last_sale: PRODOTTI.filter((p) => p.ultima != null).map((p) => ({ codice_norm: p.codice, last_date: giornoFa(p.ultima!), last_price: p.prezzo })),
  v_conto_vendita_negozio: [['Studio Isola', 'LEA_BAG_LEOPARDO_SAVANA', 2], ['Concept Nove', 'LEA_BAG_COCCO_VERDE', 1], ['Studio Isola', 'AGATA_BAG_NERO', 2], ['Casa Verde', 'CHARM_TIGER_ORO', 4]]
    .map(([negozio, codice, pezzi]) => { const p = P(String(codice)); return { negozio, codice, item: p.item, variant: p.variant, image_url: p.foto, pezzi }; }),
  negozi: ['Casa Verde', 'Concept Nove', 'Studio Isola'].map((name) => ({ name })),
  suppliers: [['Atelier Brera', 'pelle'], ['Bottega Tremezzo', 'pelle'], ['Laboratorio Sforza', 'pelle'], ['Minuterie Ghezzi', 'accessori'], ['Pelletteria Rossi', 'pelle']].map(([name, kind]) => ({ name, kind })),
  supplier_orders: ORDINI_ARRIVO,
  v_ordini_arrivo: ORDINI_ARRIVO,
  v_fornitore_prodotti: [...new Map(ORDINI_ARRIVO.map((o) => [`${o.fornitore}|${o.codice}`, o])).values()].map((o) => ({
    fornitore: o.fornitore, codice: o.codice, item: o.item, variant: o.variant, ultimo_costo: o.costo_unitario, image_url: o.image_url,
    n_ordini: ORDINI_ARRIVO.filter((x) => x.fornitore === o.fornitore && x.codice === o.codice).length + 2,
  })),
  v_tempi_laboratori: [['Bottega Tremezzo', 31, 14], ['Atelier Brera', 26, 9], ['Pelletteria Rossi', 22, 11], ['Minuterie Ghezzi', 8, 6]].map(([fornitore, giorni_mediani, righe]) => ({ fornitore, giorni_mediani, righe })),
  models: MODELLI_CATALOGO.map((m) => ({ model: m, categoria: formaDi(m) === 'borsa' ? 'BAG' : 'ACCESSORY', product_type: formaDi(m) === 'borsa' ? 'Borsa' : 'Accessorio', template_suffix: null })),
  // la scheda prodotto somma acquisti, rettifiche e le righe di vendita: qui gli acquisti tornano con quelle righe
  purchases: PRODOTTI.flatMap((p, i) => {
    const tot = acquistatiInScheda(p), q0 = Math.round(tot * 0.35), q1 = Math.min(tot - q0, Math.round(tot * 0.4));
    return [210, 120, 25].map((fa, j) => {
      const quantita = [q0, q1, tot - q0 - q1][j];
      return {
        id: uid(23, i * 3 + j), codice: p.codice, codice_norm: p.codice, item: p.item, variant: p.variant, data: giornoFa(fa - (i % 5)), quantita, costo_unitario: p.cogs,
        costo_totale: p.cogs == null ? null : tondo(p.cogs * quantita), fornitore: FORNITORE_DI[p.item], tipologia: j === 0 ? 'Nuovo' : 'Riordino', created_at: isoFa(fa - (i % 5), 15),
      };
    }).filter((r) => r.quantita > 0);
  }),
  stock_adjustments: RETTIFICHE,
  qromo_sales: QROMO_SALES,
  shopify_orders: SHOPIFY_ORDERS,
  shopify_line_items: SHOPIFY_LINE_ITEMS,
  v_products_todo: [
    ['CLUTCH_ARIA', 'nuovo', 1, 0, 0, true, 'ordine'], ['LEA_MINI_COCCO_VERDE', 'nuovo', 1, 6, 0, false, 'ordine'], ['AGATA_BAG_SENAPE', 'costo_ricavo', 2, 0, 8, false, 'import'],
    ['MIMI_POCHETTE_VELLUTO_BLU', 'pulizia', 3, 1, 22, false, 'import'], ['CHARM_TIGER_ARGENTO', 'pulizia', 3, 17, 53, false, 'import'], ['LEA_BAG_COCCO_VERDE', 'pulizia', 3, 2, 49, false, 'import'],
  ].map(([codice, bucket, rank, giacenza, venduto, nuovoModello, source]) => {
    const p = PRODOTTI.find((x) => x.codice === codice);
    const pulizia = bucket === 'pulizia';
    return {
      codice, item: p?.item ?? 'CLUTCH ARIA', variant: p?.variant ?? null, model: p?.item ?? null, categoria: p?.categoria ?? null, image_url: pulizia ? null : p?.foto ?? null,
      retail_price: p?.prezzo ?? null, cogs: p?.cogs ?? null, description: null, seo_title: null, verificato: false, missing_count: pulizia ? 2 : 4, giacenza, venduto,
      on_shopify: p?.shop ?? false, source, is_new_model: nuovoModello, bucket, bucket_rank: rank,
    };
  }),
  v_products_to_publish: [['SVEVA_BAG_MUCCATA', true], ['LEA_MINI_COCCO_VERDE', true], ['AGATA_BAG_SENAPE', false]].map(([codice, pronto]) => { const p = P(String(codice)); return { codice, item: p.item, variant: p.variant, pronto_stock: pronto, modello_censito: true }; }),
  v_ce_totale: MESI_CE.map((m) => ceMese(m, 1)),
  v_ce_amimi_summary: MESI_CE.map((m) => ceMese(m, 0.93)),
  v_ce_drill_sales: [
    ...ORDINI.map((o) => ({ year: 2026, month: Number(o.data.slice(5, 7)), canale: 'online', ref: String(o.n), descr: o.cliente, data: o.data.slice(0, 10), qty: o.righe.length, lordo: tondo(lordoDi(o) * (1 - o.pct)), commissioni: tondo(lordoDi(o) * 0.024), refund: o.rimborso ? tondo(lordoDi(o) * (1 - o.pct)) : 0, is_gift: false })),
    ...QROMO_SALES.map((q) => ({ year: 2026, month: Number(String(q.data).slice(5, 7)), canale: 'offline', ref: null, descr: [q.nome, q.cognome].filter(Boolean).join(' ') || null, data: q.data, qty: 1, lordo: q.prezzo, commissioni: 0, refund: 0, is_gift: false })),
  ],
  v_margine_ordine: MARGINE_ORDINE,
  v_margine_sku: MARGINE_SKU,
  v_sconti_codici: MARGINE_ORDINE.filter((o) => ORDINI[Number(o._i)].codice).map((o) => ({ year: 2026, month: o.month, codice: ORDINI[Number(o._i)].codice, ordini: 1, netto: o.ricavo_netto, sconto: o.sconto, margine: o.margine_contribuzione ?? 0, margine_pct_medio: o.margine_pct ?? 0 })),
  v_clienti_rfm: RFM,
  v_clienti_coorti: COORTI,
  v_ads_mensile: ADS_MENSILE,
  v_ads_creative_status: ADS,
  v_ads_weekly_account: ADS_SETTIMANE,
  v_ads_set_modelli: ADS_SET,
  v_ads_catalogo_modelli: ADS_CATALOGO,
  v_fonti_freschezza: [{
    ultimo_ordine_shopify: SHOPIFY_ORDERS[SHOPIFY_ORDERS.length - 1].created_at_shop, ultimo_sync_ordini: isoFa(0, 9, 40), ultima_vendita_qromo: isoFa(1, 17, 5), meta_ads_ultimo_giorno: '2026-07-01',
    meta_ads_ultimo_pull: isoFa(0, 6, 7), ultimo_batch_spedizioni: isoFa(1, 19), ultimo_sync_stock: isoFa(0, 9, 27), ultimo_health: isoFa(0, 7), ultima_spesa_pagata: '2026-09-30', ultimo_arrivo: '2026-10-13',
  }],
  v_movimenti_14gg: [{
    off_pezzi14: 11, off_lordo14: 1840, off_pezzi28: 9, off_lordo28: 1510, on_pezzi14: 46, on_lordo14: 7120, on_pezzi28: 41, on_lordo28: 6480, pezzi14: 57, pezzi28: 50, lordo14: 8960, lordo28: 7990,
    netto14: 7344.26, netto28: 6549.18, ordini14: 38, ordini28: 31, aov_lordo14: 235.79, sup_new14: 3, sup_arr14: 5, sup_open: 4, ret14: 2, ret28: 3, live: 128, draft: 9, soldout: 4,
  }],
  v_ops_flags: [{ shopify_write_enabled: 'true', shopify_autopush_enabled: 'true', shopify_hold_raises: 'false', shopify_expose_buffer: '1', ai_enabled: true }],
  v_digest_persone: [{
    gin_ordini14: 38, gin_ordini28: 31, gin_evasi14: 0, gin_evasi28: 0, gin_aov14: 187.37, ben_puliti14: 12, ben_resi14: 3, ben_spese14: 9, ben_todo: 3,
    dan_log14: 412, dan_attori14: 7, dan_health_ok: 8, dan_health_warn: 2, dan_health_bad: 0, dan_ce_bad: 0,
  }],
  v_digest_versioni: [{ migr_n: 168 }],
  v_digest_ordini_14gg: SHOPIFY_ORDERS.filter((o) => String(o.created_at_shop) >= giornoFa(14)).reverse().map((o) => ({ order_number: o.order_number, customer_name: o.customer_name, data: String(o.created_at_shop).slice(0, 10), evaso: o.fulfillment_status === 'fulfilled', gross_total: o.gross_total })),
  v_digest_pulizia_14gg: [['finalize_codice', 'Bene', 'products', 3], ['merge_varianti', 'Bene', 'products', 6], ['normalizza_item', 'Ale', 'products', 9]].map(([op, chi, tbl, fa], i) => ({ data: giornoFa(Number(fa)), op, chi, tbl, row_id: uid(41, i) })),
  v_digest_spese_14gg: SPESE.slice(0, 3).map((s) => ({ data: s.date_paid, op: 'expense_approve', chi: 'Bene', operazione: s.operazione, costo: s.costo })),
  v_digest_log_attori_14gg: [['cron', 188], ['shopify-sync', 96], ['qromo-forward', 41], ['Ginevra', 37], ['Bene', 31], ['Ale', 12], ['claude', 7]].map(([chi, n]) => ({ chi, n })),
  v_expenses_review: SPESE,
  v_expenses_pending: SPESE.filter((s) => s.status === 'pending'),
  expenses: SPESE,
  change_log: CHANGE_LOG,
  health_log: SALUTE,
  v_health: [{ k: 'ce_drift_live', label: 'Settembre (chiuso) differisce dal CE congelato di 12,40 €', n: 1, severity: 'bad' }, { k: 'giacenze_negative', label: 'Giacenze negative', n: 0, severity: 'ok' }],
  v_spedizioni_eccezioni: SPEDIZIONI,
  v_evasione_mensile: [6, 7, 8, 9, 10].map((m, i) => ({ year: 2026, month: m, ordini: [41, 47, 33, 58, 29][i], spediti: [41, 46, 33, 57, 24][i], giorni_medi: [1.8, 2.1, 2.6, 1.7, 1.5][i], giorni_mediani: [1, 2, 2, 1, 1][i], oltre_3gg: [3, 5, 6, 2, 1][i] })),
  v_villaggio_settings: [['villaggio_enabled', 'true'], ['villaggio_paillettes_enabled', 'true'], ['villaggio_paillettes_dal', '2026-10-16'], ['villaggio_paillettes_chi', 'Ginevra']].map(([key, value]) => ({ key, value })),
  v_push_settings: [{ key: 'push_enabled', value: 'true' }],
  v_mat_settings: [['mat_enabled', 'true'], ['mat_write_enabled', 'true'], ['ai_compila_enabled', 'true']].map(([key, value]) => ({ key, value })),
  v_mat_catalogo: MAT,
  v_mat_fornitori: MAT_FORN,
  v_mat_acquisti: MAT.filter((r) => r.acquistato).map((r, i) => ({
    line_id: uid(83, i), order_id: uid(84, i), supplier_id: r.supplier_id, fornitore: r.fornitore, tipo_documento: 'fattura', numero_documento: r.acquisto_documento, data_documento: r.acquisto_data,
    valuta: 'EUR', stato: 'registrato', totale_imponibile: r.acquisto_importo, totale_iva: r.acquisto_importo == null ? null : tondo(Number(r.acquisto_importo) * 0.22), totale_documento: null,
    condizioni_pagamento: r.condizioni_pagamento, item_id: r.item_id, categoria: r.categoria, materiale: r.materiale, colore: r.colore, quantita: r.acquisto_quantita, unita: r.unita,
    prezzo_unitario: r.acquisto_prezzo, sconto_text: null, importo: r.acquisto_importo, iva_percent: 22, note: null,
  })),
  v_mat_assets: [],
  cs_conversations: CONV,
  cs_messages: MESSAGGI,
  cs_drafts: [],
  v_lead_lista: NEGOZI_B2B,
  v_lead_outreach: OUTREACH,
  v_lead_inbound: [],
  v_lead_settings: [['lead_outreach_ai_enabled', 'true'], ['lead_linesheet_url', '']].map(([key, value]) => ({ key, value })),
};
// le righe di Tabelle si contano con una HEAD senza filtri: le tabelle vere sono piu' lunghe delle righe scritte qui
// shopify_orders no: la tabella aperta (schermata 24) mostra le righe che ha, e i due numeri devono coincidere
const CONTEGGI: Record<string, number> = { supplier_orders: 486, purchases: 1312, products: 214, qromo_sales: 688, b2b_movements: 94, returns: 61, gifts_offline: 143, expenses: 902, counts: 377 };

const RPC: Record<string, (b: Riga) => unknown> = {
  loyalty_dashboard: (b) => premia(Number(b.p_days) || 30),
  loyalty_ugc_queue: (b) => ({ conteggi: { in_revisione: 2, approvata: 17, rifiutata: 3 }, items: b.p_status === 'in_revisione' ? UGC : [] }),
};
const EDGE: Record<string, (b: Riga) => unknown> = {
  'cs-assist': (b) => (b.action === 'context' ? {
    ok: true, fonti: ['ordine Shopify #1478', 'tracking TWS', 'storico cliente'], gaps: [], order_admin_url: null,
    storia: { n_ordini: 2, totale: 378, prima: '2026-06-11', ultima: '2026-10-06', recenti: [{ numero: 1478, data: '2026-10-06', totale: 189, stato: 'fulfilled' }] },
    dati: {
      ordine: { order_number: 1478, gross_total: 189, fulfillment_status: 'fulfilled', created_at_shop: '2026-10-06T09:14:00Z', righe: [{ nome: 'Lea Bag Leopardo Savana', qta: 1 }] },
      tracking: { numero: 'TWS4471902', url: 'https://tracking.esempio.invalid/TWS4471902', corriere: 'TWS' },
      ship: { stato_tws: 'Consegnata', consegnata_il: '2026-10-14', updated_at: '2026-10-14T15:20:00Z' },
      prodotti: [{ item: 'Lea Bag', variant: 'Leopardo Savana', prezzo: 189, giacenza: 9, disponibili: 9, on_shopify: true, url: null }],
    },
  } : b.action === 'case_data' ? {
    ok: true, categoria: 'Reso e rimborso', verificato: true, tracking_url: null, order_admin_url: null, stato_tws: 'Consegnata', stato_tws_aggiornato: '2026-10-14T15:20:00Z',
    reso: { ordine_del: '2026-10-06', delivered_at: '2026-10-14', fonte: 'ordine Shopify #1478', giorni: 9, finestra: 14, verdetto: 'entro', non_applicabile: null, stato_pagamento: 'paid', difetto_sospetto: false },
    indirizzo: { fulfillment_presente: true, caso: 'consegnato' },
  } : { ok: false, error: 'azione non prevista nelle schermate' }),
  'push-api': (b) => (b.action === 'config' ? { enabled: true, vapidPublicKey: VAPID, temi: TEMI }
    : b.action === 'dispositivi' ? { dispositivi: DISPOSITIVI.map(({ device, ...d }) => ({ ...d, questo: device === b.device_id })) }
    : b.action === 'rinnova' ? { ok: true, trovato: DISPOSITIVI.some((d) => d.device === b.device_id) }
    : { error: 'scrittura non prevista nelle schermate' }),
};

// ---------------------------------------------------------------- PostgREST finto
// select=a,b:alias,c::text,rel(x,y) -> voci di primo livello
function dividi(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s + ',') {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  return out.filter(Boolean);
}
function colonne(select: string | null): string[] | null {
  if (!select || select.trim() === '*') return null;
  return dividi(select).map((s) => {
    const base = s.replace(/\(.*$/, '').replace(/::.*$/, '');
    return base.includes(':') ? base.split(':')[0] : base;
  });
}

// righe inventate dalle colonne (solo per le letture che TABELLE non conosce)
const MODELLI = ['Lea Bag', 'Sveva Bag', 'Agata Bag', 'Charm Tiger', 'Mimi Pochette', 'Lea Mini'];
const VARIANTI = ['Leopardo Savana', 'Nero', 'Verde Bosco', 'Rosso', 'Muccata', 'Cuoio'];
const BOOL = /^(is_|on_|has_)|^(verificato|edited|opt_out|pronto_stock|attivo|enabled|scaduta|da_gestire|letto|risolto)$/;
const DATA = /(^|_)(at|date|data|day|ts|giorno|captured|synced|scadenza)(_|$)/;
const NUM = /(qty|quant|giacenz|costo|cogs|price|prezzo|valore|value|lordo|netto|^mc\d|^n$|^n_|pezzi|disponibil|sold|vendut|mancano|diff|refund|commission|totale|importo|amount|spend|ricav|margin|count|tocch|score|rating|follower|pct|perc|tasso|rate|eur|ordini|vendite|sequenza|migr_n|last_price|in_conto|sessioni|click|impression|reach|roas|cpa|ctr|punti|saldo|giorni|delta|stock|sconto|media|mediana|min|max|peso|clienti|resi)/;
function valore(col: string, i: number): unknown {
  const c = col.toLowerCase();
  if (c === 'id' || c.endsWith('_id')) return uid(99, i);
  if (BOOL.test(c)) return i % 2 === 0;
  if (c === 'month' || c === 'mese') return 10 - (i % 10);
  if (c === 'year' || c === 'anno') return 2026;
  if (DATA.test(c) || /^data/.test(c)) return isoFa(i * 3, 9 + i, 30);
  if (c.includes('codice')) return PRODOTTI[i % PRODOTTI.length].codice;
  if (c === 'variant' || c === 'variante') return VARIANTI[i % 6];
  if (/^(item|model|modello|lineitem_name|title|product_type)$/.test(c)) return MODELLI[i % 6];
  if (/^(name|nome|label|negozio|fornitore|supplier|gruppo|citta)$/.test(c)) return ['Bottega Tremezzo', 'Atelier Brera', 'Pelletteria Rossi', 'Studio Isola', 'Concept Nove', 'Casa Verde'][i % 6];
  if (/^(customer_name|cognome|chi|raccolto_da|proposed_by|sent_by|autore|utente)$/.test(c)) return CLIENTI[i % CLIENTI.length];
  if (c.includes('email')) return emailDi(CLIENTI[i % CLIENTI.length], i);
  if (/(url|path|image|thumb|shot|asset)/.test(c)) return null;
  if (/^(payload|after|before|dati_usati|fatti_usati|form_fields|meta|json)$/.test(c)) return null;
  if (NUM.test(c)) return /qty|quant|pezzi|giacenz|disponibil|sold|vendut|mancano|^n$|^n_|count|stock|ordini|clienti|resi|giorni/.test(c) ? 2 + ((i * 7) % 23) : Math.round((180 + i * 137.5) * 100) / 100;
  if (/(note|nota|testo|body|oggetto|descr|motivo|errore|messaggio|summary|riepilogo)/.test(c)) return 'Nota di esempio, lunga quanto una nota vera.';
  return `${c.replace(/_/g, ' ')} ${i + 1}`;
}

const confronta = (a: unknown, b: unknown): number => {
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a === true || a === 'true') - Number(b === true || b === 'true');
  const na = Number(a), nb = Number(b);
  if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  const sa = String(a), sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};
// un filtro PostgREST (eq.x, in.(a,b), not.is.null, ...) su una riga; una colonna che la riga non ha non filtra
function passa(r: Riga, col: string, espr: string): boolean {
  if (!(col in r)) return true;
  const v = r[col];
  let e = espr, neg = false;
  if (e.startsWith('not.')) { neg = true; e = e.slice(4); }
  const punto = e.indexOf('.');
  const op = e.slice(0, punto), arg = e.slice(punto + 1);
  let ok = true;
  if (op === 'eq') ok = v != null && confronta(v, arg) === 0;
  else if (op === 'neq') ok = v != null && confronta(v, arg) !== 0;
  else if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
    const c = v == null ? NaN : confronta(v, arg);
    ok = op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
  } else if (op === 'in') ok = v != null && dividi(arg.replace(/^\(|\)$/g, '')).map((s) => s.replace(/^"|"$/g, '')).some((s) => confronta(v, s) === 0);
  else if (op === 'is') ok = arg === 'null' ? v == null : String(v) === arg;
  else if (op === 'like' || op === 'ilike') {
    const re = new RegExp('^' + arg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.') + '$', op === 'ilike' ? 'i' : '');
    ok = v != null && re.test(String(v));
  }
  return neg ? !ok : ok;
}
function passaLogico(r: Riga, espr: string, tutti: boolean): boolean {
  const parti = dividi(espr.replace(/^\(|\)$/g, '')).map((p) => [p.slice(0, p.indexOf('.')), p.slice(p.indexOf('.') + 1)] as const);
  return tutti ? parti.every(([c, e]) => passa(r, c, e)) : parti.some(([c, e]) => passa(r, c, e));
}
function ordina(rows: Riga[], order: string): Riga[] {
  const chiavi = order.split(',').map((s) => {
    const [col, ...mod] = s.split('.');
    const desc = mod.includes('desc');
    return { col, desc, nullsFirst: mod.includes('nullsfirst') ? true : mod.includes('nullslast') ? false : desc };
  });
  return [...rows].sort((a, b) => {
    for (const k of chiavi) {
      const va = a[k.col], vb = b[k.col];
      if (va == null && vb == null) continue;
      if (va == null) return k.nullsFirst ? -1 : 1;
      if (vb == null) return k.nullsFirst ? 1 : -1;
      const c = confronta(va, vb);
      if (c !== 0) return k.desc ? -c : c;
    }
    return 0;
  });
}
const mancanti = new Set<string>();
function proietta(r: Riga, select: string | null, tabella: string): Riga {
  const pulita = Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));
  if (!select || select.trim() === '*') return pulita;
  const out: Riga = {};
  for (const voce of dividi(select)) {
    if (voce === '*') { Object.assign(out, pulita); continue; }
    if (voce.includes('(')) { out[voce.replace(/\(.*$/, '').split(':')[0]] = null; continue; }
    const base = voce.replace(/::.*$/, '');
    const [alias, col] = base.includes(':') ? base.split(':') : [base, base];
    if (!(col in pulita) && DEBUG && !mancanti.has(tabella + '.' + col)) { mancanti.add(tabella + '.' + col); console.log(`[schermate] colonna senza dati: ${tabella}.${col}`); }
    out[alias] = col in pulita ? pulita[col] : null;
  }
  return out;
}

const RISERVATI = new Set(['select', 'order', 'limit', 'offset', 'or', 'and', 'columns', 'on_conflict']);
const UTENTE = { id: '00000000-0000-0000-0000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'prova@amimi.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const corpoDi = (req: Request): Riga => { try { return (req.postDataJSON() ?? {}) as Riga; } catch { return {}; } };

async function rispondi(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  // la risposta arriva da un'altra origine: senza expose-headers il browser nasconde content-range e i count diventano 0
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range' };
  const json = (body: unknown, headers: Record<string, string> = {}) => route.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, ...headers }, body: JSON.stringify(body) });
  if (p.startsWith('/auth/v1/')) return json(p.endsWith('/user') ? UTENTE : {});
  if (p.startsWith('/functions/v1/')) {
    const f = EDGE[p.slice('/functions/v1/'.length)];
    return json(f ? f(corpoDi(req)) : {});
  }
  if (p.startsWith('/storage/v1/object/sign/')) {
    const resto = p.slice('/storage/v1/object/sign/'.length);
    if (req.method() === 'POST') {
      const paths = (corpoDi(req).paths ?? []) as string[];
      return json(paths.map((x) => ({ error: null, path: x, signedURL: `/object/sign/${resto}/${x}?token=finto` })));
    }
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: cors, body: immagineDa(decodeURIComponent(resto)) });
  }
  if (p.startsWith('/rest/v1/rpc/')) {
    const f = RPC[p.slice('/rest/v1/rpc/'.length)];
    if (!f && DEBUG) console.log(`[schermate] rpc senza dati: ${p}`);
    return json(f ? f(corpoDi(req)) : []);
  }
  if (!p.startsWith('/rest/v1/') || (req.method() !== 'GET' && req.method() !== 'HEAD')) return json([]);
  const tabella = p.slice('/rest/v1/'.length);
  const select = url.searchParams.get('select');
  const fissa = TABELLE[tabella];
  const da = Number(url.searchParams.get('offset') ?? 0);
  let rows: Riga[];
  let totale: number;
  if (fissa) {
    rows = fissa;
    let filtrata = false;
    for (const [k, v] of url.searchParams) {
      if (k === 'or' || k === 'and') { rows = rows.filter((r) => passaLogico(r, v, k === 'and')); filtrata = true; } else if (!RISERVATI.has(k)) { rows = rows.filter((r) => passa(r, k, v)); filtrata = true; }
    }
    if (url.searchParams.get('order')) rows = ordina(rows, url.searchParams.get('order')!);
    totale = req.method() === 'HEAD' && !filtrata && CONTEGGI[tabella] ? CONTEGGI[tabella] : rows.length;
    const quanti = url.searchParams.get('limit');
    rows = rows.slice(da, quanti == null ? undefined : da + Number(quanti)).map((r) => proietta(r, select, tabella));
  } else if (req.method() === 'HEAD' && CONTEGGI[tabella]) {
    rows = [];
    totale = CONTEGGI[tabella];
  } else {
    const cols = colonne(select);
    if (DEBUG) console.log(`[schermate] lettura senza dati scritti a mano: ${tabella}?select=${select}`);
    rows = cols ? Array.from({ length: 6 }, (_, i) => Object.fromEntries(cols.map((c) => [c, valore(c, i)]))) : [];
    totale = rows.length;
  }
  const range = { 'content-range': rows.length ? `${da}-${da + rows.length - 1}/${totale}` : `*/${totale}` };
  if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, ...range }, body: '' });
  if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) return json(rows[0] ?? null, range);
  return json(rows, range);
}

// ---------------------------------------------------------------- pagina
async function apri(page: Page, hash = '') {
  await page.clock.setFixedTime(ADESSO);
  await page.addInitScript((u) => {
    localStorage.setItem('amimi-cs-auth', JSON.stringify({ access_token: 'finto', refresh_token: 'finto', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: u }));
    localStorage.setItem('amimi_chi', 'Ale');
    // Assistenza: l'identita' che firma (Benedetta), altrimenti la sezione si ferma su "Chi sei?"
    localStorage.setItem('amimi_cs_ident', 'B');
  }, UTENTE);
  if (DEBUG) page.on('pageerror', (e) => console.log(`[schermate] errore della pagina: ${e.message}`));
  // tutto cio' che non e' la preview locale: *.supabase.co riceve dati finti, il resto non parte. Sul contesto, non
  // sulla pagina, cosi' valgono anche per le schede aperte con target=_blank; i WebSocket si chiudono senza connettersi
  await page.context().route((u) => u.hostname !== 'localhost' && u.hostname !== '127.0.0.1', (route) => {
    const host = new URL(route.request().url()).hostname;
    return host.endsWith('.supabase.co') ? rispondi(route) : route.abort('blockedbyclient');
  });
  await page.context().routeWebSocket(() => true, (ws) => ws.close());
  await page.goto(hash);
  await page.waitForLoadState('networkidle');
}

// intera: la finestra diventa alta quanto la pagina (finche' l'altezza non si ferma: le immagini lazy e i blocchi in vh
// la cambiano), poi si fotografa la finestra. Cosi' la barra in basso e il bottone dell'assistente (fixed) restano in
// fondo, e il pannello dell'assistente, chiuso appena sotto il bordo, non compare come in uno screenshot fullPage. Per
// i pannelli sovrapposti (scheda prodotto) resta il telefono, 390x844.
async function scatta(page: Page, nome: string, { intera = true } = {}) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  if (intera) {
    let alta = 844;
    for (let giro = 0; giro < 5; giro++) {
      const h = await page.evaluate(() => Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)));
      if (h <= alta && giro > 0) break;
      alta = Math.max(alta, h);
      await page.setViewportSize({ width: 390, height: alta });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(300);
    }
  }
  // una pagina che scorre di lato a 390 px e' un difetto che lo screenshot non mostra: lo dice il log
  const largo = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (largo > 0) console.log(`[schermate] ${nome}: la pagina scorre di lato di ${largo} px`);
  await page.screenshot({ path: join(DIR, `${nome}.png`), animations: 'disabled' });
}

async function cerca(page: Page, etichetta: string) {
  await page.getByLabel('Cerca azione').fill(etichetta);
  await page.locator('button.ds-mcard, button.ds-qbtn', { hasText: etichetta }).first().click();
}
const nav = (page: Page, etichetta: string) => page.locator('.bottomnav button', { hasText: etichetta }).click();

const DA_HOME: [string, string][] = [
  ['02-cruscotto', 'Cruscotto finanze'], ['03-ce-dettagliato', 'CE dettagliato'], ['04-margini', 'Margini'],
  ['05-clienti', 'Clienti'], ['06-salute', 'Salute & Movimenti'], ['07-premia', 'Premia'],
  ['08-registra-vendita', 'Registra vendita'], ['09-spese', 'Spese'], ['10-prodotti-prezzi', 'Prodotti & prezzi'],
  ['11-ordini-arrivi', 'Ordini in arrivo'], ['12-nuovo-ordine', 'Nuovo ordine fornitore'], ['13-pulizia-dati', 'Pulizia dati'],
];
const DA_NAV: [string, string][] = [['14-magazzino', 'Magazzino'], ['15-tabelle', 'Tabelle'], ['16-assistenza', 'Assistenza'], ['17-b2b', 'B2B']];

test.describe('schermate tema', () => {
  test.use({ viewport: { width: 390, height: 844 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });

  test('01-home', async ({ page }) => {
    await apri(page);
    await scatta(page, '01-home');
  });

  for (const [nome, etichetta] of DA_HOME) {
    test(nome, async ({ page }) => {
      await apri(page);
      await cerca(page, etichetta);
      await scatta(page, nome);
    });
  }

  for (const [nome, etichetta] of DA_NAV) {
    test(nome, async ({ page }) => {
      await apri(page);
      await nav(page, etichetta);
      await scatta(page, nome);
    });
  }

  test('18-ads', async ({ page }) => {
    await apri(page, '#ads');
    await scatta(page, '18-ads');
  });

  // ---- sotto-viste
  test('19-registra-hub', async ({ page }) => {
    // l'hub non ha una voce sua: Tabelle, poi Magazzino, poi indietro riporta a Registra senza parametro
    await apri(page);
    await nav(page, 'Tabelle');
    await nav(page, 'Magazzino');
    await page.evaluate(() => history.back());
    await page.locator('.tipi .tipo', { hasText: 'Conta fisica' }).waitFor();
    await scatta(page, '19-registra-hub');
  });

  test('20-conta', async ({ page }) => {
    await apri(page);
    await cerca(page, 'Registra conta');
    await page.locator('.ds-pcard', { hasText: 'Agata Bag Nero' }).click();
    await page.locator('.sysrow b', { hasText: 'pz' }).waitFor();
    await page.locator('.stepper input.num').fill('10');
    await scatta(page, '20-conta');
  });

  test('21-reso', async ({ page }) => {
    await apri(page);
    await cerca(page, 'Reso / Cambio');
    await page.locator('.ds-pcard', { hasText: 'Lea Bag Leopardo Savana' }).click();
    await page.locator('.salerow').first().waitFor();
    await scatta(page, '21-reso');
  });

  test('22-magazzino-scheda', async ({ page }) => {
    await apri(page);
    await nav(page, 'Magazzino');
    await page.locator('.ds-prow', { hasText: 'Lea Bag Leopardo Savana' }).click();
    await page.locator('.drawer .list .row').first().waitFor();
    await scatta(page, '22-magazzino-scheda', { intera: false });
  });

  test('23-riordino', async ({ page }) => {
    await apri(page);
    await cerca(page, 'Cosa riprodurre');
    await page.locator('.list .row').first().waitFor();
    await scatta(page, '23-riordino');
  });

  test('24-tabella-aperta', async ({ page }) => {
    await apri(page);
    await nav(page, 'Tabelle');
    await page.locator('.tipo', { hasText: 'Vendite Shopify' }).click();
    await page.locator('.ds-dt tbody tr').first().waitFor();
    await scatta(page, '24-tabella-aperta');
  });

  test('25-ordini-fornitore', async ({ page }) => {
    await apri(page);
    await cerca(page, 'Ordini in arrivo');
    await page.locator('.ds-scard', { hasText: 'Bottega Tremezzo' }).click();
    await page.locator('.ds-lrow .ds-lhead').first().click();
    await page.locator('.ds-recv').waitFor();
    await scatta(page, '25-ordini-fornitore');
  });

  test('26-nuovo-ordine-carrello', async ({ page }) => {
    await apri(page);
    await cerca(page, 'Nuovo ordine fornitore');
    await page.locator('button.ds-fp', { hasText: 'Bottega Tremezzo' }).click();
    const borsa = page.getByPlaceholder(/Cerca una borsa da ordinare/);
    for (const q of ['lea bag leopardo', 'lea bag nero']) {
      await borsa.fill(q);
      await page.locator('.ds-prow').first().click();
    }
    await expect(page.locator('.cartrow[data-cart-codice]')).toHaveCount(2);
    await expect(page.locator('#toast-host .toast')).toHaveCount(0, { timeout: 8000 });
    await scatta(page, '26-nuovo-ordine-carrello');
  });

  test('27-assistenza-thread', async ({ page }) => {
    await apri(page);
    await nav(page, 'Assistenza');
    await page.locator('.cs-card', { hasText: 'Giulia Rossi' }).click();
    await page.locator('.cs-msg').first().waitFor();
    await page.locator('.cs-case').waitFor();
    await scatta(page, '27-assistenza-thread');
  });

  test('28-notifiche', async ({ page }) => {
    // playwright.config blocca i service worker: qui uno finto, con questo telefono gia' iscritto (l'iPhone di Ale)
    await page.addInitScript(({ device, bytes }) => {
      localStorage.setItem('amimi_push_device', device);
      const endpoint = 'https://push.esempio.invalid/finto';
      const sub = {
        endpoint, options: { applicationServerKey: new Uint8Array(bytes).buffer, userVisibleOnly: true },
        toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p256dh-finto', auth: 'auth-finto' } }), unsubscribe: async () => true,
      };
      const reg = { scope: location.origin + '/amimi-app/', pushManager: { getSubscription: async () => sub, subscribe: async () => sub } };
      const sw = Object.assign(new EventTarget(), { controller: null, register: async () => reg, ready: Promise.resolve(reg), getRegistration: async () => reg, startMessages: () => {} });
      Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => sw, configurable: true });
      Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
    }, { device: DEVICE_QUI, bytes: VAPID_BYTES });
    await apri(page, '#notifiche');
    await page.getByText('Chi usa questo telefono').waitFor();
    await scatta(page, '28-notifiche');
  });

  test('29-materie-prime', async ({ page }) => {
    await apri(page, '#materiali');
    await page.locator('.mat-card').first().waitFor();
    await scatta(page, '29-materie-prime');
  });
});
