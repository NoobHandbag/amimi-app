// tests/villaggio_catalogo.mjs: il catalogo del Villaggio (16-10): modello, finitura, colori e nome di ogni variante,
// e il passaggio dai dati (v_ordini_arrivo, v_inventory) alle pile, ai carrelli e ai furgoncini.
//   node tests/villaggio_catalogo.mjs   (Node 24 strippa i tipi TS all'import; nessuna rete, gira offline in CI)
//
// Il Villaggio disegna una pila per variante in magazzino e un carrello per riga d'ordine aperta. Chi decide QUALE
// sagoma, QUALE aspetto, quanti pezzi e quali arrivi sono le funzioni pure di web/src/lib/villaggio/catalogo.ts
// (modelOf, parseLook, nice, taglia, conTaglia, lastre, giorniAllaConsegna, costruisci, arriviFra): qui le importiamo
// DAVVERO e le proviamo sui nomi VERI delle varianti (copia datata qui sotto), su piccoli dati costruiti a mano e sui
// casi limite. Poi mettiamo le cinture sul sorgente perche' il Villaggio resti una vista: legge v_ordini_arrivo e
// v_inventory, scrive SOLO con ArrivoRow e SupplierOrderForm di Ordini, e si vede solo a flag villaggio_enabled acceso.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  modelOf, labOf, parseLook, nice, taglia, conTaglia, lastre, giorniAllaConsegna, costruisci, arriviFra,
  MODEL_ORDER, COLMAP, FIN_IT, PRINT_IT,
} from '../web/src/lib/villaggio/catalogo.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');

let ok = 0, ko = 0;
const eq = (name, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { ok++; console.log('  ok  ' + name); }
  else { ko++; console.log(`  KO  ${name}  atteso ${e}, ottenuto ${g}`); }
};
const t = (name, c) => { if (c) { ok++; console.log('  ok  ' + name); } else { ko++; console.log('  KO  ' + name); } };
const nota = (s) => console.log('  --  ' + s);

// --- Copia ridotta dei dati veri, letta il 16-10-2026 in SOLA lettura (progetto imszbjeyplaiovylhkgl) ---
// INV: select codice,item,variant,giacenza_attuale from v_inventory
//      where giacenza_attuale<>0 or codice in (select codice from v_ordini_arrivo where not completo)
// ORD: select codice,item,variant from v_ordini_arrivo where not completo
// I nomi sono copiati cosi' come sono, refusi compresi (COCCO_BORDOUX, STRIPES REED, PALLIETTES): sono il punto del test.
const INV = [
  ['AGATA_BAG_EMBROIDERY_WHITE', 'AGATA BAG', 'EMBROIDERY WHITE', 26],
  ['AGATA_BAG_FLORAL_LIGHT_GREY', 'AGATA BAG', 'FLORAL LIGHT GREY', -1],
  ['AGATA_BAG_FLOWER_LILLA', 'AGATA BAG', 'FLORAL LILAC', 26],
  ['AGATA_BAG_ROSE_BUTTER_LILLA', 'AGATA BAG', 'FLOWER LILLA', 0],
  ['AGATA_BAG_PALLIETTES_ADOC_ARGENTO_PER_SPOSA', 'AGATA BAG', 'PALLIETTES_ADOC_ARGENTO_PER_SPOSA', 3],
  ['AGATA_BAG_PERSONALIZZAZIONE_SPOSA', 'AGATA BAG', 'PERSONALIZZAZIONE_SPOSA', 1],
  ['AGATA_BAG_ROSE_BUTTER', 'AGATA BAG', 'ROSE BUTTER', 16],
  ['AGATA_BAG_ROSE_ROSE_BUTTER_LILLA', 'AGATA BAG', 'ROSE BUTTER LILLA', 3],
  ['AGATA_BAG_TIE_DYE_PINK', 'AGATA BAG', 'TIE DYE PINK', 1],
  ['AIRPOD_COVER_7X9_CHECKS_CHERRY_PINK', 'AIRPOD COVER', '7X9 CHECKS CHERRY PINK', 15],
  ['AIRPOD_COVER_7X9_CHECKS_FOREST_GREEN', 'AIRPOD COVER', '7X9 CHECKS FOREST GREEN', 12],
  ['AIRPOD_COVER_7X9_STRIPES_CANDY_PINK', 'AIRPOD COVER', '7X9 STRIPES CANDY PINK', 5],
  ['AIRPOD_COVER_7X9_STRIPES_LIGHT_BLUE', 'AIRPOD COVER', '7X9 STRIPES LIGHT BLUE', 18],
  ['AIRPOD_COVER_7X9_STRIPES_LIME_PINK', 'AIRPOD COVER', '7X9 STRIPES LIME PINK', 13],
  ['AIRPOD_COVER_7X9_STRIPES_RED', 'AIRPOD COVER', '7X9 STRIPES RED', 19],
  ['AIRPOD_COVER_9X11_CHECKS_CHERRY_PINK', 'AIRPOD COVER', '9X11 CHECKS CHERRY PINK', 13],
  ['AIRPOD_COVER_9X11_CHECKS_FOREST_GREEN', 'AIRPOD COVER', '9X11 CHECKS FOREST GREEN', 15],
  ['AIRPOD_COVER_9X11_STRIPES_CANDY_PINK', 'AIRPOD COVER', '9X11 STRIPES CANDY PINK', 9],
  ['AIRPOD_COVER_9X11_STRIPES_LIGHT_BLUE', 'AIRPOD COVER', '9X11 STRIPES LIGHT BLUE', 17],
  ['AIRPOD_COVER_9X11_STRIPES_LIME_PINK', 'AIRPOD COVER', '9X11 STRIPES LIME PINK', 13],
  ['AIRPOD_COVER_9X11_STRIPES_RED', 'AIRPOD COVER', '9X11 STRIPES RED', 20],
  ['ANNIE_BAG_BLUE', 'ANNIE BAG', 'BLUE', 3],
  ['ANNIE_BAG_EMBROIDERY_COLORFULL', 'ANNIE BAG', 'EMBROIDERY_COLORFULL', -1],
  ['ANNIE_BAG_PAILLETTES_CANDY_PINK', 'ANNIE BAG', 'PAILLETTES CANDY PINK', 7],
  ['ANNIE_BAG_PAILLETTES_GREY', 'ANNIE BAG', 'PAILLETTES GREY', 0],
  ['ANNIE_BAG_PAILLETTES_LIGHT_BLUE', 'ANNIE BAG', 'PAILLETTES LIGHT BLUE', 0],
  ['ANNIE_BAG_PAILLETTES_LIGHT_GREEN', 'ANNIE BAG', 'PAILLETTES LIGHT GREEN', 0],
  ['ANNIE_BAG_PAILLETTES_NUDE', 'ANNIE BAG', 'PAILLETTES NUDE', 0],
  ['ANNIE_BAG_PAILLETTES_PURPLE', 'ANNIE BAG', 'PAILLETTES PURPLE', 14],
  ['ANNIE_BAG_PEARL_GREY', 'ANNIE BAG', 'PEARL GREY', 5],
  ['ANNIE_BAG_STRIPES_PINK', 'ANNIE BAG', 'STRIPES PINK', 2],
  ['ANNIE_BAG_PAILLETTES_SILVER', 'ANNIE BAG PAILLETTES', 'SILVER', 4],
  ['CREDIT_CARD_CASE_COCCO_BEIGE', 'CREDIT CARD CASE', 'COCCO BEIGE', 1],
  ['CREDIT_CARD_CASE_COCCO_GREEN', 'CREDIT CARD CASE', 'COCCO GREEN', 1],
  ['CREDIT_CARD_CASE_COCCO_ORANGE', 'CREDIT CARD CASE', 'COCCO ORANGE', 0],
  ['CREDIT_CARD_CASE_COCCO_PINK', 'CREDIT CARD CASE', 'COCCO PINK', 3],
  ['CREDIT_CARD_CASE_COCCO_PURPLE', 'CREDIT CARD CASE', 'COCCO PURPLE', 3],
  ['LAPTOP_COVER_26X37_CHECKS_ORANGE', 'LAPTOP COVER', '26X37 CHECKS ORANGE', 11],
  ['LAPTOP_COVER_26X37_STRIPES_CANDY_PINK', 'LAPTOP COVER', '26X37 STRIPES CANDY PINK', 18],
  ['LAPTOP_COVER_26X37_STRIPES_CHERRY_PINK', 'LAPTOP COVER', '26X37 STRIPES CHERRY PINK', 20],
  ['LAPTOP_COVER_26X37_STRIPES_FOREST_GREEN', 'LAPTOP COVER', '26X37 STRIPES FOREST GREEN', 18],
  ['LAPTOP_COVER_26X37_STRIPES_LIGHT_BLUE', 'LAPTOP COVER', '26X37 STRIPES LIGHT BLUE', 19],
  ['LAPTOP_COVER_26X37_STRIPES_LIME_PINK', 'LAPTOP COVER', '26X37 STRIPES LIME PINK', 5],
  ['LAPTOP_COVER_26X37_STRIPES_RED', 'LAPTOP COVER', '26X37 STRIPES RED', 15],
  ['LEA_BAG_BLACK_WHITE_PONY', 'LEA BAG', 'BLACK WHITE PONY', 5],
  ['LEA_BAG_CAVALLINO_CHOCOLATE', 'LEA BAG', 'CAVALLINO CHOCOLATE', 1],
  ['LEA_BAG_CAVALLINO_SAVANA', 'LEA BAG', 'CAVALLINO_SAVANA', 0],
  ['LEA_BAG_COCCO_BLACK', 'LEA BAG', 'COCCO BLACK', 1],
  ['LEA_BAG_COCCO_GREEN', 'LEA BAG', 'COCCO GREEN', 6],
  ['LEA_BAG_COCCO_PINK', 'LEA BAG', 'COCCO PINK', 2],
  ['LEA_BAG_COCCO_BEIGE', 'LEA BAG', 'COCCO_BEIGE', 7],
  ['LEA_BAG_COCCO_BURGUNDY', 'LEA BAG', 'COCCO_BURGUNDY', 5],
  ['LEA_BAG_COCCO_FUCSIA', 'LEA BAG', 'COCCO_FUCSIA', 4],
  ['LEA_BAG_COCCO_PURPLE', 'LEA BAG', 'COCCO_PURPLE', 18],
  ['LEA_BAG_COCCO_SAND_CORAL', 'LEA BAG', 'COCCO_SAND_CORAL', 7],
  ['LEA_BAG_MILITARY_GREEN', 'LEA BAG', 'MILITARY GREEN', 10],
  ['LEA_BAG_MUCCATA_MARRONE', 'LEA BAG', 'MUCCATA MARRONE', 29],
  ['LEA_BAG_RED_PATENT', 'LEA BAG', 'RED PATENT', 30],
  ['LEA_BAG_SMOOTH_BROWN_LEATHER', 'LEA BAG', 'SMOOTH BROWN LEATHER', 7],
  ['LEA_BAG_TOASTED_LEATHER', 'LEA BAG', 'TOASTED LEATHER', 18],
  ['LEA_BAG_TOASTED_LEATHER_GREEN', 'LEA BAG', 'TOASTED LEATHER GREEN', 3],
  ['LEA_BAG_WHITE_PIERCING', 'LEA BAG', 'X RITA WHITE PIERCING', 0],
  ['LEA_BAG_ZEBRA', 'LEA BAG', 'ZEBRA', 4],
  ['LEA_BAG_ZEBRA_BROWN_PONY', 'LEA BAG', 'ZEBRA BROWN PONY', 2],
  ['LEA_BAG_MAXI_COCCO_BURGUNDY', 'LEA BAG MAXI', 'COCCO', 30],
  ['LEA_BAG_MAXI_COCCO_BLACK', 'LEA BAG MAXI', 'COCCO BLACK', 31],
  ['LEA_BAG_MAXI_COCCO_CHOCOLATE', 'LEA BAG MAXI', 'COCCO CHOCOLATE', 29],
  ['LEA_BAG_MAXI_COCCO_BORDOUX', 'LEA BAG MAXI', 'COCCO_BURGUNDY', 5],
  ['LEA_BAG_MAXI_COCCO_GREEN', 'LEA BAG MAXI', 'COCCO_GREEN', 2],
  ['LEA_BAG_MAXI_SUEDE_BLACK_CHARM', 'LEA BAG MAXI', 'SUEDE BLACK CHARM', 0],
  ['LEA_BAG_MAXI_SUEDE_CHOCOLATE', 'LEA BAG MAXI', 'SUEDE CHOCOLATE', 2],
  ['LEA_BAG_MAXI_SUEDE_CHOCOLATE_CHARM', 'LEA BAG MAXI', 'SUEDE CHOCOLATE CHARM', 0],
  ['LEA_BAG_MAXI_SUEDE_GREEN_CHARM', 'LEA BAG MAXI', 'SUEDE GREEN CHARM', 8],
  ['LEA_BAG_TOASTED_LEATHER_GREY_', 'LEA BAG TOASTED LEATHER GREY', null, 15],
  ['MARIA_BAG_BLACK_PIERCING', 'MARIA BAG', 'BLACK PIERCING', 7],
  ['MARIA_BAG_GREEN_PIERCING', 'MARIA BAG', 'GREEN PIERCING', 1],
  ['MARIA_BAG_ICE_BLUE_PIERCING', 'MARIA BAG', 'ICE BLUE PIERCING', 1],
  ['NINA_BAG_CHECKS_NAVY_BLUE', 'NINA BAG', 'CHECKS NAVY BLUE', 21],
  ['NINA_BAG_PEACH', 'NINA BAG', 'PEACH', 16],
  ['NINA_BAG_POIS', 'NINA BAG', 'POIS', 13],
  ['NINA_BAG_STRIPES_AZURE_RED', 'NINA BAG', 'STRIPES AZURE RED', 5],
  ['NINA_BAG_STRIPES_ICE_GREEN', 'NINA BAG', 'STRIPES ICE GREEN', 7],
  ['NINA_BAG_STRIPES_JUNGLE_GREEN', 'NINA BAG', 'STRIPES JUNGLE GREEN', 5],
  ['NINA_BAG_STRIPES_MINT', 'NINA BAG', 'STRIPES MINT', 2],
  ['NINA_BAG_STRIPES_ORANGE_RED', 'NINA BAG', 'STRIPES ORANGE RED', 4],
  ['NINA_BAG_STRIPES_PETROL_BLUE', 'NINA BAG', 'STRIPES PETROL BLUE', 9],
  ['NINA_BAG_STRIPES_STRAWBERRY', 'NINA BAG', 'STRIPES STRAWBERRY', 13],
  ['NINA_BAG_MAXI_CHECKS_CHERRY_YELLOW', 'NINA BAG MAXI', 'CHECKS CHERRY YELLOW', 19],
  ['NINA_BAG_MAXI_STRIPES_AZURE_RED', 'NINA BAG MAXI', 'STRIPES AZURE RED', 18],
  ['NINA_BAG_MAXI_STRIPES_ICE_GREEN', 'NINA BAG MAXI', 'STRIPES ICE GREEN', 12],
  ['NINA_BAG_MAXI_STRIPES_JUNGLE_GREEN', 'NINA BAG MAXI', 'STRIPES JUNGLE GREEN', 12],
  ['NINA_BAG_MAXI_STRIPES_ORANGE_RED', 'NINA BAG MAXI', 'STRIPES ORANGE RED', 17],
  ['NINA_BAG_MAXI_STRIPES_REED', 'NINA BAG MAXI', 'STRIPES REED', 25],
  ['SOPHIE_BAG_SUEDE_BURGUNDY', 'SOPHIE BAG', 'SUEDE BURGUNDY', 1],
  ['SOPHIE_BAG_SUEDE_LIGHT_BLUE', 'SOPHIE BAG', 'SUEDE LIGHT BLUE', 1],
  ['SOPHIE_BAG_SUEDE_PINK', 'SOPHIE BAG', 'SUEDE PINK', 3],
  ['SOPHIE_BAG_SUEDE_YELLOW', 'SOPHIE BAG', 'SUEDE YELLOW', 3],
  ['SOPHIE_BAG_VERDE', 'SOPHIE BAG', 'VERDE', 1],
  ['SUNGLASS_COVER_18X9_CHECKS_CHERRY_PINK', 'SUNGLASS COVER', '18X9 CHECKS CHERRY PINK', 14],
  ['SUNGLASS_COVER_18X9_CHECKS_FOREST_GREEN', 'SUNGLASS COVER', '18X9 CHECKS FOREST GREEN', 14],
  ['SUNGLASS_COVER_18X9_STRIPES_CANDY_PINK', 'SUNGLASS COVER', '18X9 STRIPES CANDY PINK', 5],
  ['SUNGLASS_COVER_18X9_STRIPES_LIGHT_BLUE', 'SUNGLASS COVER', '18X9 STRIPES LIGHT BLUE', 18],
  ['SUNGLASS_COVER_18X9_STRIPES_LIME_PINK', 'SUNGLASS COVER', '18X9 STRIPES LIME PINK', 11],
  ['SUNGLASS_COVER_18X9_STRIPES_RED', 'SUNGLASS COVER', '18X9 STRIPES RED', 15],
  ['VALENTINA_BAG_CHOCOLATE', 'VALENTINA BAG', 'CHOCOLATE', 14],
  ['VALENTINA_BAG_COCCO_BLACK', 'VALENTINA BAG', 'COCCO BLACK', 1],
  ['VALENTINA_BAG_GREEN_MILITARY', 'VALENTINA BAG', 'GREEN MILITARY', 6],
  ['VALENTINA_BAG_RED', 'VALENTINA BAG', 'RED', 13],
];
const ORD = [
  ['AGATA_BAG_EMBROIDERY_WHITE', 'AGATA BAG', 'ORGANZA BIANCA'],
  ['AGATA_BAG_ROSE_BUTTER', 'AGATA BAG', 'ROSE BIANCHE INT. BIANCO'],
  ['AGATA_BAG_ROSE_BUTTER_LILLA', 'AGATA BAG', 'ROSE BIANCHE INT. LILLA'],
  ['ANNIE_BAG_EMBROIDERY_COLORFULL', 'ANNIE BAG', 'EMBROIDERY_COLORFULL'],
  ['ANNIE_BAG_PAILLETTES_LIGHT_BLUE', 'ANNIE BAG', 'PALLIETTES AZZURRA'],
  ['ANNIE_BAG_PAILLETTES_GREY', 'ANNIE BAG', 'PALLIETTES GRIGIO'],
  ['ANNIE_BAG_PAILLETTES_NUDE', 'ANNIE BAG', 'PALLIETTES NUDE'],
  ['ANNIE_BAG_PAILLETTES_LIGHT_GREEN', 'ANNIE BAG', 'PALLIETTES VERDE'],
  ['LEA_BAG_CAVALLINO_SAVANA', 'LEA BAG', 'CAVALLINO_SAVANA'],
  ['LEA_BAG_COCCO_BLACK', 'LEA BAG', 'COCCO BLACK'],
  ['LEA_BAG_COCCO_GREEN', 'LEA BAG', 'COCCO GREEN'],
  ['LEA_BAG_MUCCATA_MARRONE', 'LEA BAG', 'MUCCATA MARRONE'],
  ['LEA_BAG_WHITE_PIERCING', 'LEA BAG', 'X RITA WHITE PIERCING'],
  ['LEA_BAG_MAXI_SUEDE_BLACK_CHARM', 'LEA BAG MAXI', 'CAMOSCIO_ASOLE_NERA'],
  ['LEA_BAG_MAXI_COCCO_BORDOUX', 'LEA BAG MAXI', 'COCCO_BORDOUX'],
  ['LEA_BAG_MAXI_SUEDE_CHOCOLATE', 'LEA BAG MAXI', 'SUEDE CHOCOLATE'],
  ['LEA_BAG_MAXI_SUEDE_CHOCOLATE_CHARM', 'LEA BAG MAXI', 'SUEDE CHOCOLATE CHARM'],
  ['CREDIT_CARD_CASE_COCCO_ORANGE', 'PORTA CARTE', 'COCCO ARANCIO'],
  ['CREDIT_CARD_CASE_COCCO_PURPLE', 'PORTA CARTE', 'COCCO MALVA'],
  ['CREDIT_CARD_CASE_COCCO_BEIGE', 'PORTA CARTE', 'COCCO PANNA'],
  ['CREDIT_CARD_CASE_COCCO_PINK', 'PORTA CARTE', 'COCCO ROSA'],
  ['CREDIT_CARD_CASE_COCCO_GREEN', 'PORTA CARTE', 'COCCO VERDE'],
];
// Varianti con giacenza che il Villaggio NON disegna (finiscono nella nota "Altri N pezzi ... pagina Magazzino").
const ECCEZIONI = {
  LEA_BAG_TOASTED_LEATHER_GREY_: "anagrafica sporca: la variante e' finita nell'item ('LEA BAG TOASTED LEATHER GREY'), variant null e codice con '_' finale. Si sistema il prodotto, non il catalogo",
};
const invBy = new Map(INV.map((r) => [r[0], r]));
// Come pilaFor() dentro costruisci(): modello dall'item, aspetto dalla variante (per le righe d'ordine quella di MAGAZZINO).
const look = (codice, item, variant) => {
  const m = modelOf(item, variant);
  return m.model ? { model: m.model, variant: m.variant, look: parseLook(m.model, m.variant, codice) } : null;
};
const lookInv = (codice) => { const r = invBy.get(codice); return r ? look(r[0], r[1], r[2]) : null; };
const pilaKey = (x) => x.model + '|' + x.look.key;

console.log('\n== modelOf: ogni item noto ha la sua sagoma, uno sconosciuto nessuna ==');
{
  const ITEMS = [
    ['LEA BAG', 'Lea'], ['LEA BAG MAXI', 'Lea Maxi'], ['NINA BAG', 'Nina'], ['NINA BAG MAXI', 'Nina Maxi'], ['AGATA BAG', 'Agata'],
    ['ANNIE BAG', 'Annie'], ['ANNIE BAG PAILLETTES', 'Annie'], ['MARIA BAG', 'Maria'], ['SOPHIE BAG', 'Sophie'], ['VALENTINA BAG', 'Valentina'],
    ['AIRPOD COVER', 'Airpod cover'], ['SUNGLASS COVER', 'Sunglass cover'], ['LAPTOP COVER', 'Laptop cover'],
    ['CREDIT CARD CASE', 'Porta carte'], ['PORTA CARTE', 'Porta carte'],
  ];
  for (const [item, m] of ITEMS) eq(`'${item}' -> ${m}`, modelOf(item, 'BLACK').model, m);
  t('i 15 item coprono tutti e 13 i modelli di MODEL_ORDER, senza doppioni', MODEL_ORDER.length === 13 && new Set(MODEL_ORDER).size === 13
    && MODEL_ORDER.every((m) => ITEMS.some(([, x]) => x === m)));
  eq("maiuscole, '_' e spazi doppi non contano: 'Lea Bag'", modelOf('Lea Bag', 'COCCO GREEN').model, 'Lea');
  eq("maiuscole, '_' e spazi doppi non contano: 'lea_bag_maxi'", modelOf('lea_bag_maxi', 'COCCO').model, 'Lea Maxi');
  eq("maiuscole, '_' e spazi doppi non contano: '  NINA   BAG '", modelOf('  NINA   BAG ', 'POIS').model, 'Nina');
  eq("ANNIE BAG PAILLETTES + SILVER -> Annie 'PAILLETTES SILVER'", modelOf('ANNIE BAG PAILLETTES', 'SILVER'), { model: 'Annie', variant: 'PAILLETTES SILVER' });
  eq("ANNIE BAG PAILLETTES con variante che dice gia' PAILLETTES: niente doppione", modelOf('ANNIE BAG PAILLETTES', 'PAILLETTES SILVER').variant, 'PAILLETTES SILVER');
  eq("ANNIE BAG PAILLETTES con il refuso PALLIETTES: niente doppione", modelOf('ANNIE BAG PAILLETTES', 'palliettes silver').variant, 'palliettes silver');
  eq('la variante passa invariata sugli altri item', modelOf('LEA BAG', 'COCCO_PURPLE'), { model: 'Lea', variant: 'COCCO_PURPLE' });
  eq('variante nulla -> stringa vuota', modelOf('LEA BAG', null), { model: 'Lea', variant: '' });
  for (const item of ['LEA BAG TOASTED LEATHER GREY', 'GIFT CARD', 'LEA', 'BAG', '', null, undefined]) {
    eq(`item sconosciuto ${JSON.stringify(item)} -> null`, modelOf(item, 'BLACK').model, null);
  }
}

console.log('\n== labOf: "Nome (tipo)" -> laboratorio e tipo ==');
eq("'Francesco (pelle)'", labOf('Francesco (pelle)'), { nome: 'Francesco', tipo: 'pelle' });
eq("'Vincenzo (pelle)'", labOf('Vincenzo (pelle)'), { nome: 'Vincenzo', tipo: 'pelle' });
eq("'Fiorella (tessuto)'", labOf('Fiorella (tessuto)'), { nome: 'Fiorella', tipo: 'tessuto' });
eq("'Sarte Milano (tessuto)': il nome puo' avere spazi", labOf('Sarte Milano (tessuto)'), { nome: 'Sarte Milano', tipo: 'tessuto' });
eq("spazi intorno e tipo maiuscolo: '  Francesco ( Pelle )  '", labOf('  Francesco ( Pelle )  '), { nome: 'Francesco', tipo: 'pelle' });
eq("senza parentesi: tutto nome, tipo vuoto", labOf('Laboratorio Rossi'), { nome: 'Laboratorio Rossi', tipo: '' });
for (const f of ['', '   ', null, undefined]) eq(`fornitore vuoto ${JSON.stringify(f)} -> 'Senza fornitore'`, labOf(f), { nome: 'Senza fornitore', tipo: '' });

console.log('\n== dati veri (16-10): ogni variante con giacenza o in arrivo ha un modello, salvo eccezioni motivate ==');
{
  for (const [codice, item, variant, g] of INV) {
    if (g === 0) continue;
    const m = modelOf(item, variant).model;
    if (ECCEZIONI[codice]) t(`${codice}: eccezione ancora vera (${ECCEZIONI[codice].slice(0, 40)}...)`, m === null);
    else t(`${codice} (${g} pz): modello ${m}`, m !== null);
  }
  for (const [codice, item, variant] of ORD) {
    const iv = invBy.get(codice);
    t(`ordine aperto ${codice}: il codice esiste in magazzino`, !!iv);
    t(`ordine aperto ${codice}: modello noto (item ${iv?.[1] ?? item})`, modelOf(iv?.[1] ?? item, iv?.[2] ?? variant).model !== null);
  }
  for (const k of Object.keys(ECCEZIONI)) t(`eccezione ${k} presente nei dati (altrimenti va tolta)`, invBy.has(k));
}

console.log('\n== dati veri: ogni aspetto e\' ben formato ==');
{
  const tutti = [...INV.map((r) => [r[0], r[1], r[2]]), ...ORD];
  const malformati = [];
  for (const [codice, item, variant] of tutti) {
    const x = look(codice, item, variant);
    if (!x) continue;
    const L = x.look;
    const bene = FIN_IT[L.fin] != null && (L.print === null || PRINT_IT[L.print] != null) && L.cols.length >= 1
      && L.cols.every((c) => Number.isInteger(c) && c >= 0 && c <= 0xffffff) && typeof L.key === 'string' && L.key.startsWith(L.fin + '-')
      && parseLook(x.model, x.variant, codice).key === L.key;
    if (!bene) malformati.push(codice + ' ' + variant);
  }
  eq('finitura nota, colori validi, chiave stabile su tutte le varianti vere', malformati, []);
}

console.log('\n== finiture attese sui casi chiave (varianti vere) ==');
{
  const fin = (codice) => { const x = lookInv(codice); return x ? [x.look.fin, x.look.print] : null; };
  const CASI = [
    ['LEA_BAG_COCCO_PURPLE', 'cocco', null], ['LEA_BAG_COCCO_SAND_CORAL', 'cocco', null], ['LEA_BAG_MAXI_COCCO_BURGUNDY', 'cocco', null],
    ['CREDIT_CARD_CASE_COCCO_PINK', 'cocco', null], ['VALENTINA_BAG_COCCO_BLACK', 'cocco', null],
    ['LEA_BAG_ZEBRA', 'pony', 'zebra'], ['LEA_BAG_ZEBRA_BROWN_PONY', 'pony', 'zebra'], ['LEA_BAG_MUCCATA_MARRONE', 'pony', 'cow'],
    ['LEA_BAG_CAVALLINO_SAVANA', 'pony', 'leopard'], ['LEA_BAG_BLACK_WHITE_PONY', 'pony', 'cow'], ['LEA_BAG_CAVALLINO_CHOCOLATE', 'pony', null],
    ['LEA_BAG_RED_PATENT', 'patent', null],
    ['LEA_BAG_MAXI_SUEDE_CHOCOLATE', 'suede', null], ['SOPHIE_BAG_SUEDE_PINK', 'suede', null],
    ['ANNIE_BAG_PAILLETTES_PURPLE', 'sequin', null], ['AGATA_BAG_PALLIETTES_ADOC_ARGENTO_PER_SPOSA', 'sequin', null], ['ANNIE_BAG_PAILLETTES_SILVER', 'sequin', null],
    ['ANNIE_BAG_PEARL_GREY', 'satin', null], ['LEA_BAG_WHITE_PIERCING', 'leather', null], ['MARIA_BAG_BLACK_PIERCING', 'leather', null],
    ['LEA_BAG_SMOOTH_BROWN_LEATHER', 'leather', null], ['LEA_BAG_TOASTED_LEATHER', 'toasted', null], ['LEA_BAG_TOASTED_LEATHER_GREEN', 'toasted', null],
    ['NINA_BAG_STRIPES_MINT', 'stripes', null], ['AIRPOD_COVER_7X9_STRIPES_RED', 'stripes', null], ['NINA_BAG_CHECKS_NAVY_BLUE', 'checks', null],
    ['LAPTOP_COVER_26X37_CHECKS_ORANGE', 'checks', null], ['NINA_BAG_POIS', 'pois', null],
    ['AGATA_BAG_FLORAL_LIGHT_GREY', 'floral', null], ['AGATA_BAG_FLOWER_LILLA', 'floral', null], ['AGATA_BAG_ROSE_BUTTER', 'roses', null],
    ['AGATA_BAG_ROSE_ROSE_BUTTER_LILLA', 'roses', null], ['AGATA_BAG_EMBROIDERY_WHITE', 'embroidery', null], ['ANNIE_BAG_EMBROIDERY_COLORFULL', 'embroidery', null],
    ['AGATA_BAG_TIE_DYE_PINK', 'tiedye', null],
  ];
  for (const [c, f, p] of CASI) eq(`${c} (${invBy.get(c)[2]}) -> ${f}${p ? ' ' + p : ''}`, fin(c), [f, p]);
  eq("CAMOSCIO (ordine LEA_BAG_MAXI_SUEDE_BLACK_CHARM) -> suede con asole", [parseLook('Lea Maxi', 'CAMOSCIO_ASOLE_NERA').fin, parseLook('Lea Maxi', 'CAMOSCIO_ASOLE_NERA').piercing], ['suede', true]);
  eq('PALLIETTES (refuso negli ordini) -> sequin', parseLook('Annie', 'PALLIETTES AZZURRA').fin, 'sequin');
  eq('ROSE BIANCHE INT. LILLA (ordine) -> roses', parseLook('Agata', 'ROSE BIANCHE INT. LILLA').fin, 'roses');
  eq('ORGANZA BIANCA (ordine) -> organza', parseLook('Agata', 'ORGANZA BIANCA').fin, 'organza');
  const rita = lookInv('LEA_BAG_WHITE_PIERCING').look;
  eq('X RITA WHITE PIERCING: pelle bianca con piercing', [rita.fin, rita.cols, rita.piercing, rita.charm], ['leather', [COLMAP.WHITE], true, false]);
  const charm = lookInv('LEA_BAG_MAXI_SUEDE_GREEN_CHARM').look;
  eq('SUEDE GREEN CHARM: charm acceso, piercing spento', [charm.charm, charm.piercing], [true, false]);
  const multi = lookInv('ANNIE_BAG_EMBROIDERY_COLORFULL').look;
  t('EMBROIDERY_COLORFULL: multi acceso', multi.multi === true);
  t('EMBROIDERY WHITE: multi spento', lookInv('AGATA_BAG_EMBROIDERY_WHITE').look.multi === false);
  t('charm, piercing e multi entrano nella chiave', lookInv('LEA_BAG_MAXI_SUEDE_CHOCOLATE').look.key !== lookInv('LEA_BAG_MAXI_SUEDE_CHOCOLATE_CHARM').look.key);
  const bwp = lookInv('LEA_BAG_BLACK_WHITE_PONY').look, zeb = lookInv('LEA_BAG_ZEBRA').look, sav = lookInv('LEA_BAG_CAVALLINO_SAVANA').look;
  t('le stampe hanno sempre due colori (fondo e macchia)', [bwp, zeb, sav, lookInv('LEA_BAG_MUCCATA_MARRONE').look].every((l) => l.cols.length === 2));
  t('MUCCATA MARRONE: fondo marrone, non nero', lookInv('LEA_BAG_MUCCATA_MARRONE').look.cols[0] === COLMAP.MARRONE);
  t('BLACK WHITE PONY e MUCCATA MARRONE sono due pile diverse', bwp.key !== lookInv('LEA_BAG_MUCCATA_MARRONE').look.key);
  t('ZEBRA e ZEBRA BROWN PONY sono due pile diverse', zeb.key !== lookInv('LEA_BAG_ZEBRA_BROWN_PONY').look.key);
  eq('STRIPES AZURE RED: due colori nell\'ordine del nome', lookInv('NINA_BAG_STRIPES_AZURE_RED').look.cols, [COLMAP.AZURE, COLMAP.RED]);
  eq("i colori di due parole vincono sulla parola sola: 'CHECKS CHERRY PINK'", lookInv('AIRPOD_COVER_7X9_CHECKS_CHERRY_PINK').look.cols, [COLMAP['CHERRY PINK']]);
  eq("'CHECKS CHERRY YELLOW' resta ciliegia + giallo", lookInv('NINA_BAG_MAXI_CHECKS_CHERRY_YELLOW').look.cols, [COLMAP.CHERRY, COLMAP.YELLOW]);
  eq("'PEARL GREY' e' grigio perla, non grigio", lookInv('ANNIE_BAG_PEARL_GREY').look.cols, [COLMAP['PEARL GREY']]);
}

console.log('\n== finitura di riserva per modello, quando il nome non la dice ==');
eq('Annie BLUE -> satin', parseLook('Annie', 'BLUE').fin, 'satin');
eq('Nina PEACH -> cotton', parseLook('Nina', 'PEACH').fin, 'cotton');
eq('Sophie VERDE -> suede', parseLook('Sophie', 'VERDE').fin, 'suede');
eq('Lea MILITARY GREEN -> pony', parseLook('Lea', 'MILITARY GREEN').fin, 'pony');
eq('Valentina RED -> leather (nessuna riserva)', parseLook('Valentina', 'RED').fin, 'leather');
eq('modello sconosciuto, nome muto -> leather', parseLook(null, 'BOH').fin, 'leather');
eq('variante vuota: colore di default della finitura, mai lista vuota', parseLook('Nina', null).cols.length, 1);

console.log('\n== alias: nomi diversi della stessa borsa -> la STESSA chiave (stessa pila) ==');
{
  const k = (m, v, c) => parseLook(m, v, c).key;
  const ref = k('Lea Maxi', 'COCCO_BURGUNDY', 'LEA_BAG_MAXI_COCCO_BORDOUX');
  eq('COCCO_BORDOUX = COCCO_BURGUNDY', k('Lea Maxi', 'COCCO_BORDOUX', 'LEA_BAG_MAXI_COCCO_BORDOUX'), ref);
  eq('COCCO_BORODUX = COCCO_BURGUNDY', k('Lea Maxi', 'COCCO_BORODUX', 'LEA_BAG_MAXI_COCCO_BORDOUX'), ref);
  eq('COCCO BURGUNDY con lo spazio = con il trattino basso', k('Lea Maxi', 'COCCO BURGUNDY'), ref);
  eq("'COCCO' sul codice LEA_BAG_MAXI_COCCO_BURGUNDY = COCCO_BURGUNDY (colore dal codice)", k('Lea Maxi', 'COCCO', 'LEA_BAG_MAXI_COCCO_BURGUNDY'), ref);
  t("'COCCO' senza codice NON indovina il bordeaux", k('Lea Maxi', 'COCCO') !== ref);
  eq('il colore della variante vince su quello del codice', parseLook('Lea', 'COCCO GREEN', 'LEA_BAG_COCCO_BLACK').cols, [COLMAP.GREEN]);
  eq('STRIPES_REED = STRIPES RED', k('Nina Maxi', 'STRIPES_REED'), k('Nina Maxi', 'STRIPES RED'));
  eq('STRIPES REED (dato vero) = STRIPES RED', lookInv('NINA_BAG_MAXI_STRIPES_REED').look.key, k('Nina Maxi', 'STRIPES RED'));
  eq('GREEN MILITARY = MILITARY GREEN', k('Valentina', 'GREEN MILITARY'), k('Valentina', 'MILITARY GREEN'));
  eq('FLORAL LILAC = FLOWER LILLA', k('Agata', 'FLORAL LILAC'), k('Agata', 'FLOWER LILLA'));
  eq('minuscole e punti non contano', k('Lea', 'cocco.purple'), k('Lea', 'COCCO_PURPLE'));
  // cover: la taglia (7X9, 9X11) non e' un aspetto, lo stesso disegno fa una pila sola
  const cover = INV.filter((r) => r[1] === 'AIRPOD COVER');
  const perDisegno = new Map();
  for (const [c, , v] of cover) { const d = v.replace(/^\d+X\d+\s+/, ''); (perDisegno.get(d) ?? perDisegno.set(d, []).get(d)).push(lookInv(c).look.key); }
  for (const [d, keys] of perDisegno) eq(`AIRPOD COVER 7X9 e 9X11 '${d}': stessa chiave`, [keys.length, new Set(keys).size], [2, 1]);
  eq('i 6 disegni delle airpod cover restano 6 chiavi diverse', new Set([...perDisegno.values()].map((k) => k[0])).size, 6);
}

console.log('\n== dati veri: quali codici finiscono nella STESSA pila (model + chiave) ==');
const PILE_VERE = new Map();
{
  for (const [c, i, v] of INV) { const x = look(c, i, v); if (x) (PILE_VERE.get(pilaKey(x)) ?? PILE_VERE.set(pilaKey(x), []).get(pilaKey(x))).push(c); }
  const fusi = [...PILE_VERE.values()].filter((g) => g.length > 1).map((g) => [...g].sort().join(' + ')).sort();
  const ATTESI = [
    // alias del colore: stesso cocco bordeaux scritto in due modi (variante 'COCCO' + colore dal codice)
    'LEA_BAG_MAXI_COCCO_BORDOUX + LEA_BAG_MAXI_COCCO_BURGUNDY',
    // taglie della stessa airpod cover
    'AIRPOD_COVER_7X9_CHECKS_CHERRY_PINK + AIRPOD_COVER_9X11_CHECKS_CHERRY_PINK',
    'AIRPOD_COVER_7X9_CHECKS_FOREST_GREEN + AIRPOD_COVER_9X11_CHECKS_FOREST_GREEN',
    'AIRPOD_COVER_7X9_STRIPES_CANDY_PINK + AIRPOD_COVER_9X11_STRIPES_CANDY_PINK',
    'AIRPOD_COVER_7X9_STRIPES_LIGHT_BLUE + AIRPOD_COVER_9X11_STRIPES_LIGHT_BLUE',
    'AIRPOD_COVER_7X9_STRIPES_LIME_PINK + AIRPOD_COVER_9X11_STRIPES_LIME_PINK',
    'AIRPOD_COVER_7X9_STRIPES_RED + AIRPOD_COVER_9X11_STRIPES_RED',
    // anagrafica: il codice dice ROSE_BUTTER_LILLA ma la variante in magazzino dice FLOWER LILLA (= FLORAL LILAC)
    'AGATA_BAG_FLOWER_LILLA + AGATA_BAG_ROSE_BUTTER_LILLA',
  ].sort();
  eq('solo le fusioni volute (alias, taglie) e quella dovuta all\'anagrafica', fusi, ATTESI);
  eq('pile distinte nel magazzino vero', PILE_VERE.size, INV.length - Object.keys(ECCEZIONI).length - 8);
}

console.log('\n== righe d\'ordine: perche\' l\'aspetto si legge dalla variante di MAGAZZINO ==');
// con il nome scritto nell'ordine alcune righe cadrebbero su una pila diversa da quella del loro codice
const ORD_DIVERSE = ORD.filter(([c, i, v]) => { const a = look(c, i, v), b = lookInv(c); return a && b && pilaKey(a) !== pilaKey(b); }).map((r) => r[0]).sort();
{
  eq("col nome dell'ordine queste righe finirebbero su un'altra pila (ORGANZA BIANCA, PALLIETTES AZZURRA, COCCO MALVA, CAMOSCIO_ASOLE_NERA...)", ORD_DIVERSE, [
    'AGATA_BAG_EMBROIDERY_WHITE', 'AGATA_BAG_ROSE_BUTTER', 'AGATA_BAG_ROSE_BUTTER_LILLA', 'ANNIE_BAG_PAILLETTES_LIGHT_BLUE', 'ANNIE_BAG_PAILLETTES_LIGHT_GREEN',
    'CREDIT_CARD_CASE_COCCO_BEIGE', 'CREDIT_CARD_CASE_COCCO_GREEN', 'CREDIT_CARD_CASE_COCCO_PURPLE', 'LEA_BAG_MAXI_SUEDE_BLACK_CHARM',
  ]);
  eq('ogni codice degli ordini aperti ha la sua variante di magazzino', ORD.filter(([c]) => !lookInv(c)).map((r) => r[0]), []);
  t('COCCO_BORDOUX (ordine) e la pila COCCO_BURGUNDY di magazzino: stessa pila anche dal nome dell\'ordine',
    pilaKey(look('LEA_BAG_MAXI_COCCO_BORDOUX', 'LEA BAG MAXI', 'COCCO_BORDOUX')) === pilaKey(lookInv('LEA_BAG_MAXI_COCCO_BURGUNDY')));
  // che costruisci() usi davvero la variante di magazzino lo prova il blocco "costruisci() sui dati veri" qui sotto
}

console.log('\n== nice(): nome italiano leggibile ==');
{
  eq("'COCCO_PURPLE' -> 'Cocco viola'", nice('COCCO_PURPLE'), 'Cocco viola');
  eq("'9X11 STRIPES RED' -> 'Righe rosso' (taglia tolta)", nice('9X11 STRIPES RED'), 'Righe rosso');
  eq("'7X9 CHECKS CHERRY PINK' -> 'Quadretti rosa ciliegia'", nice('7X9 CHECKS CHERRY PINK'), 'Quadretti rosa ciliegia');
  eq("'26X37 STRIPES CANDY PINK' -> 'Righe rosa caramella'", nice('26X37 STRIPES CANDY PINK'), 'Righe rosa caramella');
  eq("'18X9 STRIPES LIME PINK' -> 'Righe lime rosa'", nice('18X9 STRIPES LIME PINK'), 'Righe lime rosa');
  eq("'STRIPES_REED' -> 'Righe rosso'", nice('STRIPES_REED'), 'Righe rosso');
  eq("'COCCO_BORDOUX' -> 'Cocco bordeaux'", nice('COCCO_BORDOUX'), 'Cocco bordeaux');
  eq("'COCCO_SAND_CORAL' -> 'Cocco corallo'", nice('COCCO_SAND_CORAL'), 'Cocco corallo');
  eq("'MILITARY GREEN' -> 'Verde militare'", nice('MILITARY GREEN'), 'Verde militare');
  eq("'SUEDE BLACK CHARM' -> 'Camoscio nero con charm'", nice('SUEDE BLACK CHARM'), 'Camoscio nero con charm');
  eq("'TOASTED LEATHER GREEN' -> 'Pelle toasted verde'", nice('TOASTED LEATHER GREEN'), 'Pelle toasted verde');
  eq("'EMBROIDERY_COLORFULL' -> 'Ricamo multicolore'", nice('EMBROIDERY_COLORFULL'), 'Ricamo multicolore');
  eq("'PALLIETTES_ADOC_ARGENTO_PER_SPOSA' -> 'Paillettes argento per sposa'", nice('PALLIETTES_ADOC_ARGENTO_PER_SPOSA'), 'Paillettes argento per sposa');
  eq("'X RITA WHITE PIERCING' -> 'X rita bianco con piercing'", nice('X RITA WHITE PIERCING'), 'X rita bianco con piercing');
  eq("minuscole come maiuscole: 'cocco_purple'", nice('cocco_purple'), 'Cocco viola');
  for (const v of ['', '   ', null, undefined, '___', '7X9', 'ADOC', 'LEATHER']) eq(`${JSON.stringify(v)} -> mai stringa vuota`, nice(v), 'Variante senza nome');
  const nomi = [...INV.map((r) => modelOf(r[1], r[2]).variant), ...ORD.map((r) => r[2])];
  const brutti = nomi.map((v) => [v, nice(v)]).filter(([, n]) => !n || /_/.test(n) || /\d+x\d+/i.test(n) || /\s{2}/.test(n) || n !== n.trim() || n[0] !== n[0].toUpperCase());
  eq(`tutti i ${nomi.length} nomi veri: niente '_', niente taglie, niente spazi doppi, maiuscola iniziale`, brutti, []);
}

console.log('\n== taglia() e conTaglia(): la misura resta sulle righe, non sulle pile ==');
const PUNTO = ' ' + String.fromCharCode(0xb7) + ' ';   // ' · ' fra nome e misura
{
  eq("taglia('COCCO BLACK 30X20') = '30x20'", taglia('COCCO BLACK 30X20'), '30x20');
  eq("taglia('COCCO BLACK 40X30') = '40x30'", taglia('COCCO BLACK 40X30'), '40x30');
  eq("taglia('COCCO_BLACK_30X20'): anche col trattino basso", taglia('COCCO_BLACK_30X20'), '30x20');
  eq("taglia('cocco black 30x20'): anche minuscola", taglia('cocco black 30x20'), '30x20');
  eq("taglia('7X9 STRIPES RED') (dato vero, misura in testa) = '7x9'", taglia('7X9 STRIPES RED'), '7x9');
  eq("taglia('26X37 STRIPES CANDY PINK') = '26x37'", taglia('26X37 STRIPES CANDY PINK'), '26x37');
  for (const v of ['COCCO BLACK', 'X RITA WHITE PIERCING', '', null, undefined]) eq(`taglia(${JSON.stringify(v)}) = '' (nessuna misura)`, taglia(v), '');
  eq("conTaglia('COCCO BLACK 30X20') = 'Cocco nero · 30x20'", conTaglia('COCCO BLACK 30X20'), 'Cocco nero' + PUNTO + '30x20');
  eq("conTaglia('COCCO BLACK 40X30') = 'Cocco nero · 40x30'", conTaglia('COCCO BLACK 40X30'), 'Cocco nero' + PUNTO + '40x30');
  t("le due taglie: stesso nice(), conTaglia() diverso", nice('COCCO BLACK 30X20') === nice('COCCO BLACK 40X30') && conTaglia('COCCO BLACK 30X20') !== conTaglia('COCCO BLACK 40X30'));
  t("...e stessa chiave d'aspetto (la taglia non entra nella pila)", parseLook('Laptop cover', 'COCCO BLACK 30X20').key === parseLook('Laptop cover', 'COCCO BLACK 40X30').key);
  eq("conTaglia senza misura = nice(): 'COCCO_PURPLE' -> 'Cocco viola'", conTaglia('COCCO_PURPLE'), 'Cocco viola');
  eq("conTaglia(null) = 'Variante senza nome'", conTaglia(null), 'Variante senza nome');
  const storte = INV.filter(([, item, v]) => !!taglia(v) !== /COVER$/.test(item)).map((r) => r[0]);
  eq('dati veri: hanno la misura tutte e sole le cover', storte, []);
}

console.log('\n== lastre(): 1 lastra ogni 2 pezzi, almeno 1, tetto 24 ==');
for (const [n, l] of [[0, 0], [1, 1], [2, 1], [3, 2], [4, 2], [30, 15], [47, 24], [48, 24], [1000, 24], [-1, 0], [-30, 0], [NaN, 0]]) eq(`lastre(${n}) = ${l}`, lastre(n), l);
t('lastre non cala mai al crescere dei pezzi (0..100)', Array.from({ length: 100 }, (_, i) => lastre(i + 1) >= lastre(i)).every(Boolean));

console.log('\n== giorniAllaConsegna(): giorni fra oggi e la consegna ==');
eq('data nulla -> null', giorniAllaConsegna(null, '2026-10-16'), null);
eq('data assente -> null', giorniAllaConsegna(undefined, '2026-10-16'), null);
eq('data vuota -> null', giorniAllaConsegna('', '2026-10-16'), null);
eq('data illeggibile -> null', giorniAllaConsegna('presto', '2026-10-16'), null);
eq('oggi -> 0', giorniAllaConsegna('2026-10-16', '2026-10-16'), 0);
eq('passata (dato vero 2026-05-20 al 16-10) -> -149, in ritardo', giorniAllaConsegna('2026-05-20', '2026-10-16'), -149);
eq('ieri -> -1', giorniAllaConsegna('2026-10-15', '2026-10-16'), -1);
eq('futura -> +7', giorniAllaConsegna('2026-10-23', '2026-10-16'), 7);
eq('timestamp: conta solo il giorno', giorniAllaConsegna('2026-10-20T23:30:00+02:00', '2026-10-16'), 4);
eq("a cavallo del cambio d'ora (25-10): giorni interi", giorniAllaConsegna('2026-10-26', '2026-10-24'), 2);
eq('a cavallo dell\'anno', giorniAllaConsegna('2027-01-02', '2026-12-30'), 3);

// --- Dati costruiti a mano, con la forma di web/src/lib/api.ts (InvFull, OrdLine, OrdGruppo) e le regole di
// v_ordini_arrivo (definizione letta il 16-10): mancano = coalesce(qty_ordered,0) - coalesce(qty_arrived,0);
// completo = per una WIP qty_arrived > 0, altrimenti qty_arrived >= qty_ordered; data_consegna_display =
// coalesce(data_consegna, data_ultimo_arrivo), cioe' sull'ultimo arrivo quando la consegna non c'e' (il caso di tutte
// le righe aperte del 16-10). ---
const OGGI = '2026-10-16';
const invRow = (codice, item, variant, g) => ({
  codice, item, variant, categoria: null, giacenza_attuale: g, in_conto_vendita: 0, disponibili_da_vendere: Math.max(0, Number(g) || 0),
  valore: 0, retail_price: null, cogs: null, last_sale: null, on_shopify: true, image_url: null,
  qty_purchased: 0, shopify_sold: 0, qromo_sold: 0, gift_sold: 0, b2b_venduto: 0,
});
const linea = (id, codice, item, variant, o, arr, extra = {}) => ({
  id, codice, item, variant, fornitore: 'Francesco (pelle)', qty_ordered: o, qty_arrived: arr, mancano: (o ?? 0) - arr,
  completo: o != null && arr >= o, data_ordine: '2026-10-01', image_url: null, nuovo_riordino: null, costo_unitario: null,
  data_consegna: null, data_consegna_display: null, wip: false, note: null, ...extra,
});
const wipLinea = (id, codice, item, variant, arr, extra = {}) => linea(id, codice, item, variant, null, arr, { wip: true, completo: arr > 0, ...extra });
// come fetchOrdiniGruppi(): un gruppo per ordine (qui uno per fornitore), mancano sommati, completo se tutte complete
const gruppiDi = (righe) => {
  const by = new Map();
  for (const l of righe) {
    const k = l.fornitore ?? '';
    const g = by.get(k) ?? { gruppo: 'g-' + (k || 'senza'), fornitore: l.fornitore, data_ordine: l.data_ordine, righe: [], mancano: 0, completo: true };
    g.righe.push(l); g.mancano += Number(l.mancano) || 0; g.completo = g.completo && l.completo;
    by.set(k, g);
  }
  return [...by.values()];
};
// la lettura "prima" che load() in Villaggio.tsx conserva fra due caricamenti (prevArrived)
const fotoArrivi = (gruppi) => new Map(gruppi.flatMap((g) => g.righe.map((l) => [l.id, Number(l.qty_arrived) || 0])));
const sommaIncoming = (m) => [...m.pile.values()].reduce((s, p) => s + p.incoming, 0);

console.log('\n== costruisci() sui dati veri (16-10), importata da catalogo.ts ==');
{
  const inv = INV.map(([c, i, v, g]) => invRow(c, i, v, String(g)));   // numeric come stringa: costruisci() fa Number()
  // le righe aperte vere (quantita' finte): come il 16-10, data_consegna nulla e data_consegna_display nel passato;
  // solo la prima ha una consegna promessa, gia' passata
  const righe = ORD.map(([c, i, v], k) => linea('o' + k, c, i, v, 10, 2,
    k === 0 ? { data_consegna: '2026-05-20', data_consegna_display: '2026-05-20' } : { data_consegna_display: '2026-05-20' }));
  righe.push(linea('chiusa', 'LEA_BAG_COCCO_PINK', 'LEA BAG', 'COCCO PINK', 5, 5));
  righe.push(wipLinea('wip', 'LEA_BAG_ZEBRA', 'LEA BAG', 'ZEBRA', 0));
  const m = costruisci(gruppiDi(righe), inv, OGGI);
  const L = m.labs[0];
  eq('un laboratorio: chiave = fornitore, nome e tipo da labOf', [m.labs.length, L.key, L.forn, L.nome, L.tipo], [1, 'Francesco (pelle)', 'Francesco (pelle)', 'Francesco', 'pelle']);
  eq('magazzino: totale = somma delle giacenze positive', m.tot.stock, INV.reduce((s, r) => s + Math.max(0, r[3]), 0));
  eq('dati.totale = tot.stock', m.dati.totale, m.tot.stock);
  eq("fuori dal villaggio solo i 15 pezzi dell'eccezione", m.tot.fuori, 15);
  eq('una pila per aspetto, come nel conteggio delle pile vere', m.pile.size, PILE_VERE.size);
  eq('nessuna riga aperta resta senza pila (extra vuoto)', L.extra.map((l) => l.codice), []);
  eq('righe aperte + WIP nel laboratorio, la completa no', [L.righe.length, L.righe.some((r) => r.id === 'chiusa'), m.righe.has('chiusa')], [ORD.length + 1, false, false]);
  eq('righe aperte contate (WIP compresa)', m.tot.open, ORD.length + 1);
  eq('in preparazione = somma dei mancano delle righe aperte non WIP', [m.tot.prep, L.pz], [ORD.length * 8, ORD.length * 8]);
  eq('in arrivo sulle pile = la stessa somma', sommaIncoming(m), ORD.length * 8);
  t("ogni riga ha l'aspetto della pila del suo codice", L.righe.every((r) => m.pile.get(m.codeToPila.get(r.codice))?.look.key === r.look.key));
  eq('ogni codice in ordine cade sulla pila della sua variante di MAGAZZINO, non del nome nell\'ordine',
    ORD.filter(([c]) => m.codeToPila.get(c) !== pilaKey(lookInv(c))).map((r) => r[0]), []);
  t('...comprese le 9 righe il cui nome nell\'ordine porterebbe altrove (ORGANZA BIANCA, COCCO MALVA, ...)',
    ORD_DIVERSE.length === 9 && ORD_DIVERSE.every((c) => { const o = ORD.find((r) => r[0] === c); return m.codeToPila.get(c) !== pilaKey(look(o[0], o[1], o[2])); }));
  const w = L.righe.find((r) => r.id === 'wip');
  eq('riga WIP: ordinato sconosciuto -> o = arrivati + 1, wip, etichetta (WIP)', [w?.a, w?.o, w?.wip, / \(WIP\)$/.test(w?.label ?? '')], [0, 1, true, true]);
  eq('in ritardo solo la riga con data_consegna passata, non quelle con la sola data_consegna_display passata',
    L.righe.filter((r) => r.late).map((r) => r.id), ['o0']);
  t('pile visibili: solo con giacenza, in arrivo o negative', m.dati.pile.every((p) => p.stock !== 0 || p.incoming > 0 || p.neg));
  t('pile nascoste: senza giacenza, senza arrivi e non negative', [...m.pile.values()].filter((p) => !m.dati.pile.includes(p)).every((p) => p.stock === 0 && p.incoming === 0 && !p.neg));
  t('LEA_BAG_WHITE_PIERCING (0 pz, in arrivo) resta visibile', m.dati.pile.some((p) => p.codes.some((x) => x.codice === 'LEA_BAG_WHITE_PIERCING')));
  const bord = m.pile.get(m.codeToPila.get('LEA_BAG_MAXI_COCCO_BURGUNDY'));
  eq('la pila Lea Maxi cocco bordeaux somma i due codici alias (30 + 5), ognuno col suo stock',
    [bord?.stock, bord?.codes.map((c) => [c.codice, c.stock]).sort(), m.stockCodice.get('LEA_BAG_MAXI_COCCO_BURGUNDY'), m.stockCodice.get('LEA_BAG_MAXI_COCCO_BORDOUX')],
    [35, [['LEA_BAG_MAXI_COCCO_BORDOUX', 5], ['LEA_BAG_MAXI_COCCO_BURGUNDY', 30]], 30, 5]);
  const fl = m.pile.get(m.codeToPila.get('AGATA_BAG_FLORAL_LIGHT_GREY'));
  eq('AGATA_BAG_FLORAL_LIGHT_GREY (-1): pila negativa e visibile', [fl?.stock, fl?.neg, m.dati.pile.includes(fl)], [-1, true, true]);
}

console.log('\n== costruisci() su dati a mano: ritardi, WIP, modelli non disegnati, stock per codice, senza fornitore ==');
{
  const inv = [
    invRow('LEA_BAG_COCCO_GREEN', 'LEA BAG', 'COCCO GREEN', 6),
    invRow('LEA_BAG_COCCO_BLACK', 'LEA BAG', 'COCCO BLACK', 1),
    invRow('LEA_BAG_ZEBRA', 'LEA BAG', 'ZEBRA', 4),
    // due taglie della stessa cover: stessa pila, stock separati; la seconda e' negativa
    invRow('LAPTOP_COVER_COCCO_BLACK_30X20', 'LAPTOP COVER', 'COCCO BLACK 30X20', 4),
    invRow('LAPTOP_COVER_COCCO_BLACK_40X30', 'LAPTOP COVER', 'COCCO BLACK 40X30', -1),
    // +1 e -1: la pila fa 0 ma resta visibile perche' una taglia e' negativa
    invRow('SUNGLASS_COVER_COCCO_PINK_18X9', 'SUNGLASS COVER', 'COCCO PINK 18X9', 1),
    invRow('SUNGLASS_COVER_COCCO_PINK_20X10', 'SUNGLASS COVER', 'COCCO PINK 20X10', -1),
    invRow('NINA_BAG_POIS', 'NINA BAG', 'POIS', 0),
    invRow('GIFT_CARD_50', 'GIFT CARD', '50 EURO', 3),
  ];
  const righe = [
    linea('late', 'LEA_BAG_COCCO_GREEN', 'LEA BAG', 'COCCO GREEN', 10, 4, { data_consegna: '2026-10-15', data_consegna_display: '2026-10-15' }),
    linea('oggi', 'LEA_BAG_COCCO_BLACK', 'LEA BAG', 'COCCO BLACK', 5, 0, { data_consegna: '2026-10-16', data_consegna_display: '2026-10-16' }),
    linea('disp', 'LAPTOP_COVER_COCCO_BLACK_30X20', 'LAPTOP COVER', 'COCCO BLACK 30X20', 3, 1, { data_consegna_display: '2026-05-20' }),
    wipLinea('wip1', 'LEA_BAG_ZEBRA', 'LEA BAG', 'ZEBRA', 0, { data_consegna_display: '2026-09-01' }),
    // WIP con una stima nell'ordinato: resta WIP, i suoi 6 non contano
    linea('wip2', 'LEA_BAG_ZEBRA', 'LEA BAG', 'ZEBRA', 6, 0, { wip: true }),
    linea('gift', 'GIFT_CARD_50', 'GIFT CARD', '50 EURO', 4, 1),
    // codice non ancora in magazzino: aspetto dal nome dell'ordine, pila nuova a 0 pezzi
    linea('nuovo', 'LEA_BAG_COCCO_FUCSIA', 'LEA BAG', 'COCCO_FUCSIA', 2, 0),
    linea('tg40', 'LAPTOP_COVER_COCCO_BLACK_40X30', 'LAPTOP COVER', 'COCCO BLACK 40X30', 2, 0, { data_consegna: '2026-11-30', data_consegna_display: '2026-11-30' }),
    linea('nf', 'LEA_BAG_COCCO_GREEN', 'LEA BAG', 'COCCO GREEN', 3, 0, { fornitore: null }),
    linea('vc', 'LEA_BAG_COCCO_BLACK', 'LEA BAG', 'COCCO BLACK', 4, 4, { fornitore: 'Vincenzo (pelle)' }),
  ];
  const m = costruisci(gruppiDi(righe), inv, OGGI);
  const F = m.labs.find((l) => l.key === 'Francesco (pelle)'), S = m.labs.find((l) => l.key === '');
  const R = (id) => m.righe.get(id)?.riga;
  const pila = (codice) => m.pile.get(m.codeToPila.get(codice));

  eq('laboratori in ordine di nome; Vincenzo (solo righe complete) non c\'e\'', m.labs.map((l) => l.key), ['Francesco (pelle)', '']);
  eq('fornitore null -> laboratorio con chiave \'\', forn null, nome \'Senza fornitore\'', [S?.key, S?.forn, S?.nome, S?.tipo, S?.righe.map((r) => r.id), S?.pz], ['', null, 'Senza fornitore', '', ['nf'], 3]);
  eq("la riga senza fornitore punta al laboratorio ''", m.righe.get('nf')?.lab, '');

  // ritardo: solo data_consegna
  eq('data_consegna ieri -> in ritardo', R('late')?.late, true);
  eq('data_consegna oggi -> non in ritardo', R('oggi')?.late, false);
  eq('data_consegna nulla e data_consegna_display nel passato -> NON in ritardo', R('disp')?.late, false);
  eq('data_consegna futura -> non in ritardo', R('tg40')?.late, false);
  eq('WIP senza data_consegna (display nel passato) -> non in ritardo', R('wip1')?.late, false);

  // WIP
  eq('WIP (qty_ordered null): wip, a = 0, o = a + 1, etichetta (WIP)', [R('wip1')?.wip, R('wip1')?.a, R('wip1')?.o, R('wip1')?.label], [true, 0, 1, 'Zebrato (WIP)']);
  eq('WIP con stima 6 nell\'ordinato: comunque o = a + 1', [R('wip2')?.wip, R('wip2')?.o], [true, 1]);
  eq('righe non WIP: wip false, o = ordinato', [R('late')?.wip, R('late')?.a, R('late')?.o], [false, 4, 10]);
  eq('la pila della Zebra non aspetta niente dalle WIP', pila('LEA_BAG_ZEBRA')?.incoming, 0);

  // modelli che il villaggio non disegna
  eq('gift card: in extra, non fra le righe disegnate', [F?.extra.map((l) => l.id), F?.righe.some((r) => r.id === 'gift'), m.righe.has('gift'), m.codeToPila.has('GIFT_CARD_50')], [['gift'], false, false, false]);
  eq('Francesco: righe disegnate nell\'ordine della lettura', F?.righe.map((r) => r.id), ['late', 'oggi', 'disp', 'wip1', 'wip2', 'nuovo', 'tg40']);
  eq('raw e righe allineati (la pagina li accoppia per indice)', F?.raw.map((l) => l.id), F?.righe.map((r) => r.id));
  eq('pz di Francesco = 6 + 5 + 2 + 3 (gift, extra) + 2 + 2, WIP escluse', F?.pz, 20);
  eq('tot: prep (WIP escluse, extra compresi), righe aperte (complete escluse)', [m.tot.prep, m.tot.open], [23, 9]);
  eq("in arrivo sulle pile = prep meno i 3 dell'extra", sommaIncoming(m), 20);
  eq('magazzino: positivi soli, gift card fuori dal villaggio', [m.tot.stock, m.tot.fuori, m.dati.totale], [19, 3, 19]);

  // stock per codice dentro la stessa pila
  const lap = pila('LAPTOP_COVER_COCCO_BLACK_30X20');
  t('le due taglie della laptop cover sono la stessa pila', !!lap && m.codeToPila.get('LAPTOP_COVER_COCCO_BLACK_30X20') === m.codeToPila.get('LAPTOP_COVER_COCCO_BLACK_40X30'));
  eq('codes[] tiene lo stock di ogni taglia', lap?.codes.map((c) => [c.codice, c.variant, c.stock]),
    [['LAPTOP_COVER_COCCO_BLACK_30X20', 'COCCO BLACK 30X20', 4], ['LAPTOP_COVER_COCCO_BLACK_40X30', 'COCCO BLACK 40X30', -1]]);
  eq('stockCodice tiene lo stock di ogni taglia', [m.stockCodice.get('LAPTOP_COVER_COCCO_BLACK_30X20'), m.stockCodice.get('LAPTOP_COVER_COCCO_BLACK_40X30')], [4, -1]);
  eq('la pila somma le taglie (4 - 1), e\' negativa e visibile, aspetta 2 + 2', [lap?.stock, lap?.neg, m.dati.pile.includes(lap), lap?.incoming], [3, true, true, 4]);
  eq('nome della pila senza misura', lap?.name, 'Cocco nero');
  eq('le righe delle due taglie si distinguono dall\'etichetta', [R('disp')?.label, R('tg40')?.label], ['Cocco nero' + PUNTO + '30x20', 'Cocco nero' + PUNTO + '40x30']);
  const sun = pila('SUNGLASS_COVER_COCCO_PINK_18X9');
  eq('sunglass cover +1 e -1: pila a 0 ma negativa, resta visibile', [sun?.stock, sun?.neg, sun?.incoming, m.dati.pile.includes(sun), sun?.codes.map((c) => c.stock)], [0, true, 0, true, [1, -1]]);
  const pois = pila('NINA_BAG_POIS');
  eq('Nina pois a 0, senza ordini: nella mappa ma non visibile', [!!pois, m.dati.pile.includes(pois)], [true, false]);
  t('le pile non negative hanno neg spento', [pila('LEA_BAG_COCCO_GREEN'), pila('LEA_BAG_ZEBRA'), pois].every((p) => !p?.neg));

  // codice che il magazzino non conosce ancora
  const fu = pila('LEA_BAG_COCCO_FUCSIA');
  eq('codice nuovo: pila Lea dal nome dell\'ordine, 0 pezzi, 2 in arrivo, visibile', [fu?.model, fu?.stock, fu?.incoming, m.dati.pile.includes(fu), fu?.codes.map((c) => [c.codice, c.stock])],
    ['Lea', 0, 2, true, [['LEA_BAG_COCCO_FUCSIA', 0]]]);
  eq('...e nessuno stock per codice inventato', m.stockCodice.has('LEA_BAG_COCCO_FUCSIA'), false);
  eq('la pila Lea cocco verde aspetta 6 (Francesco) + 3 (senza fornitore)', pila('LEA_BAG_COCCO_GREEN')?.incoming, 9);
  eq('visibili: 6 pile su 7', [m.dati.pile.length, m.pile.size], [6, 7]);
}

console.log('\n== arriviFra(): il furgoncino fra due letture (prevArrived e prevMod di load()) ==');
{
  const inv = [
    invRow('LEA_BAG_COCCO_GREEN', 'LEA BAG', 'COCCO GREEN', 6),
    invRow('LEA_BAG_COCCO_BLACK', 'LEA BAG', 'COCCO BLACK', 1),
    invRow('LEA_BAG_ZEBRA', 'LEA BAG', 'ZEBRA', 4),
  ];
  const r1 = linea('r1', 'LEA_BAG_COCCO_GREEN', 'LEA BAG', 'COCCO GREEN', 10, 4);
  const r2 = linea('r2', 'LEA_BAG_COCCO_BLACK', 'LEA BAG', 'COCCO BLACK', 5, 0);
  const v1 = linea('v1', 'LEA_BAG_COCCO_BLACK', 'LEA BAG', 'COCCO BLACK', 10, 4, { fornitore: 'Vincenzo (pelle)' });
  const w1 = wipLinea('w1', 'LEA_BAG_ZEBRA', 'LEA BAG', 'ZEBRA', 0);
  const PRIMA = [r1, r2, v1, w1];
  // arrivo registrato con ArrivoRow (write-api arrival_set); la view ricalcola mancano e completo
  const arriva = (l, n) => ({ ...l, qty_arrived: n, mancano: (l.qty_ordered ?? 0) - n, completo: l.wip ? n > 0 : n >= l.qty_ordered });
  // arrival_set su una WIP: ordinato = arrivati, la WIP si risolve, la view la da' completa
  const arrivaWip = (l, n) => ({ ...l, wip: false, qty_ordered: n, qty_arrived: n, mancano: 0, completo: true });
  const sostituisci = (...nuove) => PRIMA.map((l) => nuove.find((x) => x.id === l.id) ?? l);
  const G0 = gruppiDi(PRIMA), M0 = costruisci(G0, inv, OGGI), P0 = fotoArrivi(G0);
  const furgoni = (G, prima = P0, prec = M0) => arriviFra(prima, prec, costruisci(G, inv, OGGI), G).map((x) => [x.lab, x.riga.codice, x.n]);

  // (a) primo caricamento
  eq('(a) primo caricamento (prec null, nessuna lettura prima): nessun furgoncino', arriviFra(new Map(), null, M0, G0), []);
  const G1 = gruppiDi(sostituisci(arriva(r1, 7)));
  eq('(a) prec null vince anche con una lettura prima e arrivi veri', arriviFra(P0, null, costruisci(G1, inv, OGGI), G1), []);

  // (b) arrivo parziale
  eq('(b) arrivo parziale 4 -> 7 di 10: un furgoncino da 3, laboratorio di Francesco', furgoni(G1), [['Francesco (pelle)', 'LEA_BAG_COCCO_GREEN', 3]]);
  t('(b) la riga e\' quella del modello precedente', arriviFra(P0, M0, costruisci(G1, inv, OGGI), G1)[0]?.riga === M0.righe.get('r1').riga);

  // (c) arrivo che completa la riga e chiude il laboratorio
  const G2 = gruppiDi(sostituisci(arriva(v1, 10)));
  const M2 = costruisci(G2, inv, OGGI);
  eq('(c) premessa: v1 completa sparisce dal modello nuovo e Vincenzo con lei', [M2.righe.has('v1'), M2.labs.some((l) => l.key === 'Vincenzo (pelle)')], [false, false]);
  const c = arriviFra(P0, M0, M2, G2);
  eq('(c) arrivo che COMPLETA la riga (4 -> 10 di 10): furgoncino da 6 dal laboratorio di Vincenzo', c.map((x) => [x.lab, x.riga.codice, x.n]), [['Vincenzo (pelle)', 'LEA_BAG_COCCO_BLACK', 6]]);
  t('(c) riga e laboratorio presi dal modello PRECEDENTE', c[0]?.riga === M0.righe.get('v1').riga && M0.labs.some((l) => l.key === c[0]?.lab));

  // (d) WIP
  const G3 = gruppiDi(sostituisci(arrivaWip(w1, 8)));
  const d = arriviFra(P0, M0, costruisci(G3, inv, OGGI), G3);
  eq('(d) primo arrivo su una WIP (0 -> 8, la view la chiude): furgoncino da 8', d.map((x) => [x.lab, x.riga.codice, x.n]), [['Francesco (pelle)', 'LEA_BAG_ZEBRA', 8]]);
  eq('(d) la riga del furgoncino e\' la WIP di prima', d[0]?.riga.wip, true);

  // (e) nessun cambiamento
  eq('(e) nessun arrivo: nessun furgoncino', furgoni(G0), []);
  // altri casi
  eq('correzione all\'indietro (4 -> 2): nessun furgoncino', furgoni(gruppiDi(sostituisci(arriva(r1, 2)))), []);
  eq('riga nuova, assente nella lettura prima, con 3 arrivati: nessun furgoncino', furgoni(gruppiDi([...PRIMA, linea('n1', 'LEA_BAG_ZEBRA', 'LEA BAG', 'ZEBRA', 5, 3)])), []);
  eq('due arrivi nella stessa lettura (uno parziale, uno che completa): due furgoncini in ordine',
    furgoni(gruppiDi(sostituisci(arriva(r1, 5), arriva(r2, 5)))), [['Francesco (pelle)', 'LEA_BAG_COCCO_GREEN', 1], ['Francesco (pelle)', 'LEA_BAG_COCCO_BLACK', 5]]);

  // una sessione intera, come load(): prima lettura, arrivo parziale, arrivo che completa, rilettura uguale
  let prevA = new Map(), prevM = null;
  const carica = (righe) => { const g = gruppiDi(righe); const m = costruisci(g, inv, OGGI); const a = arriviFra(prevA, prevM, m, g); prevA = fotoArrivi(g); prevM = m; return a.map((x) => [x.riga.codice, x.n]); };
  const giro = [carica(PRIMA), carica(sostituisci(arriva(r1, 7))), carica(sostituisci(arriva(r1, 10))), carica(sostituisci(arriva(r1, 10)))];
  eq('sessione come load(): [] -> 3 pezzi -> 3 pezzi (completa) -> []', giro, [[], [['LEA_BAG_COCCO_GREEN', 3]], [['LEA_BAG_COCCO_GREEN', 3]], []]);
}

// --- Cinture sul sorgente ---
const IMPORT_RE = /^import\s+(?:(type)\s+)?(?:([^;'"]*?)\s+from\s+)?'([^']+)'/gm;
const importi = (s) => [...s.matchAll(IMPORT_RE)].map((m) => ({ tipo: !!m[1], nomi: (m[2] ?? '').replace(/[{}*]/g, ' ').split(/[\s,]+/).filter((x) => x && x !== 'as'), da: m[3] }));
const nomiDa = (s, da) => importi(s).filter((i) => !i.tipo && i.da === da).flatMap((i) => i.nomi).sort();
const conta = (s, re) => [...s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))].length;

const VIL = read('web/src/pages/Villaggio.tsx');
const VAPP = read('web/src/VillaggioApp.tsx');
const MONDO = read('web/src/lib/villaggio/mondo.ts');
const CAT = read('web/src/lib/villaggio/catalogo.ts');
const API = read('web/src/lib/api.ts');

console.log('\n== cinture sul sorgente: il Villaggio legge e basta (Villaggio.tsx, VillaggioApp.tsx, mondo.ts, catalogo.ts) ==');
{
  for (const [n, s] of [['Villaggio.tsx', VIL], ['VillaggioApp.tsx', VAPP], ['mondo.ts', MONDO], ['catalogo.ts', CAT]]) {
    t(`${n}: niente writeApi ne' sbWrite`, !/\b(writeApi|sbWrite)\b/.test(s));
    for (const vietato of ['setArrival', 'createOrderMulti', 'deleteOrder', 'archiveReorder', 'verifyProduct', 'addExpense', 'correctSale']) {
      t(`${n}: non usa ${vietato}`, !new RegExp('\\b' + vietato + '\\b').test(s));
    }
    t(`${n}: nessun URL di write-api o di una edge function`, !/['"`/]write-api\b/.test(s) && !/functions\/v1/.test(s));
    t(`${n}: nessun client supabase (supabase, csClient, createClient)`, !/\b(supabase|csClient|createClient)\b/i.test(s));
    t(`${n}: niente .insert( .upsert( .rpc(`, !/\.(insert|upsert|rpc)\s*\(/.test(s));
    t(`${n}: niente .from('tabella') (le letture passano da lib/api)`, !/\.from\(\s*['"`]/.test(s));
    const coda = [...s.matchAll(/([\w$.\])]+)\s*\.\s*(update|delete)\s*\(/g)].filter((m) => /[)\]]$/.test(m[1]) || /supabase|from|\beq\b/i.test(m[1])).map((m) => m[0]);
    eq(`${n}: .update( e .delete( solo su oggetti con nome (Map, Set), mai in coda a una query`, coda, []);
    t(`${n}: niente fetch( diretto`, !/\bfetch\s*\(/.test(s));
    t(`${n}: niente import( dinamici ne' require( (scavalcherebbero l'elenco degli import)`, !/\bimport\s*\(/.test(s) && !/\brequire\s*\(/.test(s));
    eq(`${n}: ogni riga 'import' e' letta da queste cinture`, importi(s).length, conta(s, /^import\b/m));
  }
  t("catalogo.ts importa solo TIPI (spariscono a runtime: per questo questo test lo importa in Node)", importi(CAT).length > 0 && importi(CAT).every((i) => i.tipo));
  eq('mondo.ts importa (valori) solo three e lastre da ./catalogo', importi(MONDO).filter((i) => !i.tipo).map((i) => i.da + ':' + i.nomi.join(',')).sort(), ['./catalogo:lastre', 'three:THREE']);
  t("la pagina usa costruisci() e arriviFra() di catalogo.ts, non una copia sua", /\bcostruisci\b/.test(nomiDa(VIL, '../lib/villaggio/catalogo').join(' ')) && nomiDa(VIL, '../lib/villaggio/catalogo').includes('arriviFra')
    && !/function (costruisci|arriviFra)\s*\(/.test(VIL));
}

console.log('\n== cinture: le sole vie di scrittura sono ArrivoRow e SupplierOrderForm di Ordini ==');
{
  const OK_VIL = ['react', '../components/Icon', '../lib/api', './Ordini', '../components/SupplierOrderForm', '../lib/people', '../lib/backnav',
    '../lib/villaggio/catalogo', '../lib/villaggio/mondo', '../styles/villaggio.css'];
  eq('Villaggio.tsx importa (valori) solo da moduli noti', importi(VIL).filter((i) => !i.tipo && !OK_VIL.includes(i.da) && !/^@fontsource\//.test(i.da)).map((i) => i.da), []);
  eq("da lib/api solo le letture fetchInventory, fetchOrdiniGruppi e oggi", nomiDa(VIL, '../lib/api'), ['fetchInventory', 'fetchOrdiniGruppi', 'oggi']);
  eq('da ./Ordini solo ArrivoRow', nomiDa(VIL, './Ordini'), ['ArrivoRow']);
  eq('da SupplierOrderForm il suo componente', nomiDa(VIL, '../components/SupplierOrderForm'), ['SupplierOrderForm']);
  t('usa <ArrivoRow> e <SupplierOrderForm>', /<ArrivoRow\b/.test(VIL) && /<SupplierOrderForm\b/.test(VIL));
  t('dopo un arrivo ArrivoRow ricarica con load (furgoncino)', /<ArrivoRow [^>]*reload=\{load\}/.test(VIL));
  t('dopo un ordine SupplierOrderForm ricarica con load', /<SupplierOrderForm\b[\s\S]*?onDone=\{\(\) => \{\s*load\(\);/.test(VIL));
  const OK_VAPP = ['react', './pages/Villaggio.tsx', './components/ErrorBoundary.tsx', './lib/api.ts'];
  eq('VillaggioApp.tsx importa (valori) solo da moduli noti', importi(VAPP).filter((i) => !i.tipo && !OK_VAPP.includes(i.da)).map((i) => i.da), []);
  eq('VillaggioApp.tsx da lib/api solo fetchVillaggioEnabled', nomiDa(VAPP, './lib/api.ts'), ['fetchVillaggioEnabled']);
  for (const f of ['web/src/lib/people.tsx', 'web/src/lib/backnav.ts', 'web/src/components/Icon.tsx', 'web/src/components/ErrorBoundary.tsx']) {
    const s = read(f);
    t(`${f.split('/').pop()} (importato dal Villaggio) non scrive: niente writeApi, supabase, fetch(`, !/\b(writeApi|sbWrite|supabase|csClient)\b/.test(s) && !/\bfetch\s*\(/.test(s));
  }
  const ORDINI = read('web/src/pages/Ordini.tsx');
  t('Ordini.tsx esporta ArrivoRow', /^export function ArrivoRow\(/m.test(ORDINI));
  const ar = /export function ArrivoRow\(\{ ([^}]*) \}/.exec(ORDINI)?.[1] ?? '';
  t('ArrivoRow accetta le prop che passa il Villaggio (l, pin, chi, reload, defaultOpen, altri)', ['l', 'pin', 'chi', 'reload', 'defaultOpen', 'altri'].every((p) => new RegExp('\\b' + p + '\\b').test(ar)));
  const corpoAR = ORDINI.slice(ORDINI.indexOf('export function ArrivoRow('), ORDINI.indexOf('\n}\n', ORDINI.indexOf('export function ArrivoRow(')));
  t('ArrivoRow scrive con setArrival', /\bsetArrival\(/.test(corpoAR));
  t("setArrival e' write-api arrival_set", /export const setArrival = [^;]*writeApi\('arrival_set'/.test(API));
  const SOF = read('web/src/components/SupplierOrderForm.tsx');
  t('SupplierOrderForm accetta initialForn e initialCodice (li passa il Villaggio)', /initialForn\?: string/.test(SOF) && /initialCodice\?: string/.test(SOF));
  t('SupplierOrderForm scrive con createOrderMulti', /\bcreateOrderMulti\(/.test(SOF));
  t("createOrderMulti e' write-api order_multi", /export async function createOrderMulti\([^)]*\) \{\s*return writeApi\('order_multi'/.test(API));
}

console.log('\n== cinture: load() confronta la lettura e il modello PRECEDENTI, e legge i moli prima di aggiornare ==');
{
  t('load() costruisce il modello con costruisci(g, inv, oggi())', /const m = costruisci\(g, inv, oggi\(\)\);/.test(VIL));
  t('load() passa a arriviFra la lettura e il modello precedenti', /arriviFra\(prevArrived\.current, prevMod\.current, m, g\)/.test(VIL));
  t('load() conserva qty_arrived di ogni riga e il modello per la prossima volta',
    /prevArrived\.current = new Map\(g\.flatMap\(\(gr\) => gr\.righe\.map\(\(l\) => \[l\.id, Number\(l\.qty_arrived\) \|\| 0\]/.test(VIL) && /prevMod\.current = m;/.test(VIL));
  t('al montaggio prevMod torna null prima del primo load (nessun furgoncino al primo giro)', /prevMod\.current = null;\s*\n\s*load\(\);/.test(VIL));
  const iDock = VIL.indexOf('W.dockOf(x.lab)'), iAgg = VIL.indexOf('W.aggiorna(m.dati)');
  t("i moli si leggono prima di aggiornare il mondo (un laboratorio che chiude l'ultima riga sparisce)", iDock > 0 && iAgg > iDock);
  const usati = [...new Set([...VIL.matchAll(/\bW\.(\w+)\(/g), ...VIL.matchAll(/mondoRef\.current\?\.(\w+)\(/g)].map((m) => m[1]))].sort();
  eq('i metodi del Mondo usati dalla pagina esistono (pubblici) in mondo.ts', usati.filter((m) => !new RegExp('^  ' + m + '\\(', 'm').test(MONDO)), []);
  t("onPartenza: evento dichiarato, emesso dal mondo e ascoltato dalla pagina",
    /onPartenza\?: \(n: number\) => void/.test(MONDO) && /this\.ev\.onPartenza\?\.\(/.test(MONDO) && /onPartenza: \(\) =>/.test(VIL));
}

console.log('\n== cinture: interruttore app_flags.villaggio_enabled (Regola Ferrea 19, migr 0162) ==');
{
  const APP = read('web/src/App.tsx');
  t('App.tsx carica Villaggio con lazy()', /const Villaggio = lazy\(\(\) => import\('\.\/pages\/Villaggio'\)\);/.test(APP));
  t('App.tsx non importa Villaggio in modo statico (three.js resterebbe nel bundle principale)', !/^import\s+Villaggio\b/m.test(APP) && !/^import[^;]*from '\.\/pages\/Villaggio'/m.test(APP));
  t('App.tsx legge il flag una volta: null finche\' non arriva, false se la lettura fallisce',
    /const \[vilEnabled, setVilEnabled\] = useState<boolean \| null>\(null\);/.test(APP) && /fetchVillaggioEnabled\(\)\.then\(setVilEnabled\)\.catch\(\(\) => setVilEnabled\(false\)\)/.test(APP));
  t('URL diretto #villaggio apre la scheda', /hash\.startsWith\('#villaggio'\) \? 'villaggio'/.test(APP));
  const a = APP.indexOf("{tab === 'villaggio' &&");
  const fine = [APP.indexOf("{tab === '", a + 1), APP.indexOf('</main>', a)].filter((x) => x > a);
  const blocco = a >= 0 && fine.length ? APP.slice(a, Math.min(...fine)) : '';
  const rami = /^\{tab === 'villaggio' && \(vilEnabled\s*\?([\s\S]*?)\n\s*:([\s\S]*)$/.exec(blocco);
  t('App.tsx: la scheda villaggio sceglie su vilEnabled', !!rami);
  t('...ramo acceso: <ErrorBoundary> con <Suspense> e <Villaggio>', !!rami && /^\s*<ErrorBoundary\b[\s\S]*<Suspense\b[\s\S]*<Villaggio\b[\s\S]*<\/Suspense>[\s\S]*<\/ErrorBoundary>/.test(rami[1]));
  t("...ramo spento: nessun <Villaggio>, dice 'non attiva'", !!rami && !/<Villaggio\b/.test(rami[2]) && /non attiva/.test(rami[2]));
  eq('App.tsx: <Villaggio> compare una volta sola (solo nel ramo acceso)', conta(APP, /<Villaggio\b/), 1);
  const riga = (s, pezzo) => s.split('\n').find((r) => r.includes(pezzo)) ?? '';
  t('il Cruscotto riceve onVillaggio solo a flag acceso', /<Report\b.*onVillaggio=\{vilEnabled \? \(\) => go\('villaggio'\) : undefined\}/.test(riga(APP, "tab === 'cruscotto' &&")));
  const REP = read('web/src/pages/Report.tsx');
  t("Report.tsx: onVillaggio e' facoltativo", /onVillaggio\?: \(\) => void/.test(REP));
  const iSe = REP.indexOf('{onVillaggio && ('), iBtn = REP.indexOf('onClick={onVillaggio}>Apri il Villaggio');
  t("Report.tsx: il bottone 'Apri il Villaggio' esiste solo dentro {onVillaggio && (...)}", iSe > 0 && iBtn > iSe && conta(REP, /onClick=\{onVillaggio\}/) === 1);
  t('App.tsx passa a Home vilEnabled === true', /<Home\b[^>]*vilEnabled=\{vilEnabled === true\}/.test(APP));
  const HOME = read('web/src/pages/Home.tsx');
  t('Home: vilEnabled spento per default', /vilEnabled = false/.test(HOME) && /vilEnabled\?: boolean/.test(HOME));
  t("Home: il filtro delle tile toglie 'villaggio' a flag spento", /const acceso = \(t: Tile\) => [^;\n]*\(vilEnabled \|\| t\.tab !== 'villaggio'\)/.test(HOME));
  t('Home: il filtro vale per le tile della persona e per tutte le azioni', /cfg\.tiles\.filter\(acceso\)/.test(HOME) && /ALL_ACTIONS\.filter\(acceso\)/.test(HOME));
  t('Home: nessuna lista di tile non filtrata (cfg.tiles e ALL_ACTIONS si leggono una volta sola)', conta(HOME, /cfg\.tiles\b/) === 1 && conta(HOME, /\bALL_ACTIONS\b/) === 2);
  t('Home: il filtro si ricalcola quando il flag arriva', /\}, \[cfg, matEnabled, vilEnabled\]\);/.test(HOME));

  // app a se': prima il flag, poi il Villaggio
  t('VillaggioApp: stato del flag null finche\' non arriva, false se la lettura fallisce',
    /useState<boolean \| null>\(null\)/.test(VAPP) && /fetchVillaggioEnabled\(\)\.then\(setAcceso\)\.catch\(\(\) => setAcceso\(false\)\)/.test(VAPP));
  const iNull = VAPP.indexOf('if (acceso === null) return'), iSpento = VAPP.indexOf('if (!acceso) {'), iVil = VAPP.indexOf('<Villaggio ');
  t('VillaggioApp: attesa, poi flag spento, poi (solo dopo) <Villaggio>', iNull > 0 && iSpento > iNull && iVil > iSpento && /if \(!acceso\) \{\s*return \(/.test(VAPP));
  eq('VillaggioApp: <Villaggio> una volta sola', conta(VAPP, /<Villaggio\b/), 1);
  t('VillaggioApp: <Villaggio> dentro <ErrorBoundary>', /<ErrorBoundary titolo="Villaggio" onBack=\{home\}><Villaggio\b[^>]*\/><\/ErrorBoundary>/.test(VAPP));
  const MAIN = read('web/src/villaggio-main.tsx');
  t('villaggio-main.tsx monta VillaggioApp, non Villaggio direttamente', /import VillaggioApp from '\.\/VillaggioApp\.tsx'/.test(MAIN) && /<VillaggioApp\b/.test(MAIN)
    && !/import Villaggio from/.test(MAIN) && !/<Villaggio\b/.test(MAIN));

  // fetchVillaggioEnabled(): la funzione vera, ritagliata da api.ts (che a livello di modulo crea il client supabase)
  // e fatta girare su un client finto. Nessuna rete.
  const a0 = API.indexOf('export async function fetchVillaggioEnabled('), b0 = API.indexOf('\n}\n', a0);
  t('api.ts definisce fetchVillaggioEnabled', a0 >= 0 && b0 > a0);
  const corpo = a0 >= 0 && b0 > a0 ? API.slice(a0, b0 + 2) : '';
  t('fetchVillaggioEnabled: errore o riga assente -> false', /if \(error \|\| !data\) return false;/.test(corpo));
  let strip = null;
  try { ({ stripTypeScriptTypes: strip } = await import('node:module')); } catch { strip = null; }
  if (corpo && typeof strip === 'function') {
    const ew = process.emitWarning; process.emitWarning = () => {};   // stripTypeScriptTypes e' ancora "experimental": niente avviso a ogni run
    let fve = () => () => { throw new Error('fetchVillaggioEnabled non compila'); };
    try { fve = new Function('supabase', strip(corpo.replace(/^export /, '')) + '\nreturn fetchVillaggioEnabled;'); }
    catch (e) { t('fetchVillaggioEnabled ritagliata compila: ' + e.message, false); }
    finally { process.emitWarning = ew; }
    const prova = async (risposta) => {
      const log = [];
      const sb = { from(tab) { log.push(['from', tab]); return { select(c) { log.push(['select', c]); return { eq(k, v) { log.push(['eq', k, v]); return { maybeSingle: async () => risposta }; } }; } }; } };
      try { return { v: await fve(sb)(), log }; } catch (e) { return { v: 'lancia: ' + e.message, log }; }
    };
    const acceso = await prova({ data: { key: 'villaggio_enabled', value: 'true' }, error: null });
    eq("legge v_villaggio_settings, chiave villaggio_enabled", acceso.log, [['from', 'v_villaggio_settings'], ['select', 'key,value'], ['eq', 'key', 'villaggio_enabled']]);
    eq("value 'true' -> true", acceso.v, true);
    const CASI = [
      ["errore (permesso negato, vista non ancora creata in prod)", { data: null, error: { message: 'relation "v_villaggio_settings" does not exist' } }, false],
      ['errore anche se arriva una riga', { data: { key: 'villaggio_enabled', value: 'true' }, error: { message: 'x' } }, false],
      ['riga assente (migrazione non applicata, flag mai inserito)', { data: null, error: null }, false],
      ["value 'false'", { data: { key: 'villaggio_enabled', value: 'false' }, error: null }, false],
      ['value null', { data: { key: 'villaggio_enabled', value: null }, error: null }, false],
      ["value 'boh'", { data: { key: 'villaggio_enabled', value: 'boh' }, error: null }, false],
      ["value ' TRUE ' (spazi e maiuscole)", { data: { key: 'villaggio_enabled', value: ' TRUE ' }, error: null }, true],
      ['value true (booleano jsonb)', { data: { key: 'villaggio_enabled', value: true }, error: null }, true],
      ["value '1'", { data: { key: 'villaggio_enabled', value: '1' }, error: null }, true],
    ];
    for (const [nome, risposta, atteso] of CASI) eq(`fetchVillaggioEnabled: ${nome} -> ${atteso}`, (await prova(risposta)).v, atteso);
  } else nota('fetchVillaggioEnabled non provata su un client finto (manca il corpo o node:module.stripTypeScriptTypes)');

  const MIG_FILE = 'supabase/migrations/0162_villaggio_flag.sql';
  t(`${MIG_FILE} esiste`, existsSync(ROOT + MIG_FILE));
  const MIG = existsSync(ROOT + MIG_FILE) ? read(MIG_FILE).replace(/--.*$/gm, '') : '';
  t("0162 inserisce villaggio_enabled = 'false' con on conflict do nothing (non spegne un flag gia' acceso)",
    /insert into app_flags\s*\(\s*key\s*,\s*value\s*\)\s*values\s*\(\s*'villaggio_enabled'\s*,\s*'false'\s*\)\s*on conflict\s*\(\s*key\s*\)\s*do nothing\s*;/i.test(MIG));
  t('0162: la vista v_villaggio_settings espone solo la chiave villaggio_enabled',
    /create or replace view v_villaggio_settings as\s+select key, value from app_flags where key in \('villaggio_enabled'\)\s*;/i.test(MIG));
  t('0162: grant select on v_villaggio_settings to anon', /grant\s+select\s+on\s+(?:table\s+)?v_villaggio_settings\s+to\s+[^;]*\banon\b/i.test(MIG));
  t('0162: app_flags resta chiusa (nessun grant su app_flags)', !/grant[^;]*\bon\s+(?:table\s+)?(?:public\.)?app_flags\b/i.test(MIG));
  t('0162: nessuna tabella nuova, nessun update o delete', !/create\s+table|\bupdate\s+\w|\bdelete\s+from/i.test(MIG));
  t('0162: dentro begin / commit', /^\s*begin;/m.test(MIG) && /^\s*commit;/m.test(MIG));
  eq('un solo file 0162_ in supabase/migrations', readdirSync(ROOT + 'supabase/migrations').filter((f) => f.startsWith('0162_')), ['0162_villaggio_flag.sql']);
  t("api.ts legge la stessa vista e la stessa chiave della migrazione", /from\('v_villaggio_settings'\)/.test(corpo) && /eq\('key', 'villaggio_enabled'\)/.test(corpo));
}

console.log('\n== cinture: tile, icone e persone ==');
{
  const PEO = read('web/src/lib/people.tsx');
  t("'villaggio' e' un Tab", /export type Tab = [^;]*'villaggio'/.test(PEO));
  const blocco = (nome) => { const a = PEO.indexOf(`  ${nome}: {`); const b = PEO.indexOf('\n  },', a); return a >= 0 && b > a ? PEO.slice(a, b) : ''; };
  t('tile Villaggio per Ale', /tab: 'villaggio'/.test(blocco('Ale')));
  t('tile Villaggio per Ginevra', /tab: 'villaggio'/.test(blocco('Ginevra')));
  const all = PEO.slice(PEO.indexOf('export const ALL_ACTIONS'));
  t('Villaggio fra le azioni di tutti (ALL_ACTIONS)', /tab: 'villaggio'/.test(all.slice(0, all.indexOf('];'))));
  t("'villaggio' non e' fra le FINANCE_TABS (Ginevra lo deve vedere)", !/FINANCE_TABS[^;]*'villaggio'/.test(PEO));
  const ICO = read('web/src/components/Icon.tsx');
  const icone = new Set([...ICO.matchAll(/^\s+'?([a-z][\w-]*)'?:\s*</gm)].map((m) => m[1]));
  const usate = ['globe', ...[...VIL.matchAll(/<Icon name="([^"]+)"/g)].map((m) => m[1])];
  eq('le icone usate da tile e Villaggio esistono in Icon.tsx', usate.filter((n) => !icone.has(n)), []);
}

console.log('\n== cinture sull\'app a se\' (per Ginni): build, html, manifest ==');
{
  const VITE = read('web/vite.config.ts');
  const VITE_CODICE = VITE.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const input = /rollupOptions:\s*\{\s*input:\s*\{([^}]*)\}/.exec(VITE_CODICE)?.[1] ?? '';
  const ingressi = [...input.matchAll(/(\w+):\s*resolve\(__dirname,\s*'([^']+)'\)/g)].map((m) => [m[1], m[2]]);
  eq('rollupOptions.input: main -> index.html, villaggio -> villaggio/index.html', ingressi, [['main', 'index.html'], ['villaggio', 'villaggio/index.html']]);
  const nomeEntry = /chunks\.find\(\(c\) => c\.name === '([^']+)'\)/.exec(VITE_CODICE)?.[1] ?? null;
  eq("version.json: il chunk d'ingresso si sceglie per nome, 'main'", nomeEntry, 'main');
  t("...e quel nome e' una chiave di rollupOptions.input (l'app intera, non il Villaggio)", ingressi.some(([k, f]) => k === nomeEntry && f === 'index.html'));
  t('...fra i soli chunk d\'ingresso', /const chunks = Object\.values\(bundle\)\.filter\(\(c\) => c\.type === 'chunk' && c\.isEntry\)/.test(VITE_CODICE));
  t('nessuna scelta per facadeModuleId (con un ingresso HTML non e\' src/main.tsx)', !/facadeModuleId/.test(VITE_CODICE));
  const HTML = read('web/villaggio/index.html');
  t("villaggio/index.html carica /src/villaggio-main.tsx, che esiste", /<script type="module" src="\/src\/villaggio-main\.tsx"><\/script>/.test(HTML) && existsSync(ROOT + 'web/src/villaggio-main.tsx'));
  t('villaggio/index.html punta al manifest del Villaggio', /<link rel="manifest" href="\/villaggio\/manifest\.webmanifest" \/>/.test(HTML));
  for (const [, href] of HTML.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="\/([^"]+)"/g)) t(`villaggio/index.html: /${href} esiste in web/public`, existsSync(ROOT + 'web/public/' + href));
  let man = null, manApp = null;
  try { man = JSON.parse(read('web/public/villaggio/manifest.webmanifest')); } catch { /* resta null */ }
  try { manApp = JSON.parse(read('web/public/manifest.webmanifest')); } catch { /* resta null */ }
  t('manifest.webmanifest del Villaggio e\' JSON valido', !!man);
  eq('manifest: id /amimi-app/villaggio/', man?.id, '/amimi-app/villaggio/');
  eq('manifest: start_url /amimi-app/villaggio/', man?.start_url, '/amimi-app/villaggio/');
  eq('manifest: scope /amimi-app/', man?.scope, '/amimi-app/');
  t('manifest: start_url dentro lo scope', !!man && String(man.start_url).startsWith(String(man.scope)));
  eq('manifest: display standalone', man?.display, 'standalone');
  t("manifest: id diverso da quello dell'app intera (si installano tutte e due)", !!man && !!manApp && (manApp.id ?? manApp.start_url) !== man.id);
  for (const ic of man?.icons ?? []) t(`manifest: icona ${ic.src} esiste in web/public`, ic.src.startsWith('/amimi-app/') && existsSync(ROOT + 'web/public/' + ic.src.slice('/amimi-app/'.length)));

  // l'ultima build, se c'e': version.json deve nominare il chunk che carica index.html (quello dell'app intera)
  const D = 'web/dist/';
  if (existsSync(ROOT + D + 'version.json') && existsSync(ROOT + D + 'index.html')) {
    let ver = null;
    try { ver = JSON.parse(read(D + 'version.json')); } catch { /* resta null */ }
    const entry = ver?.entry ?? '';
    t(`dist: index.html carica l'entry di version.json (${entry || 'vuota'})`, !!entry && read(D + 'index.html').includes(`src="/amimi-app/${entry}"`));
    if (existsSync(ROOT + D + 'villaggio/index.html')) {
      const VH = read(D + 'villaggio/index.html');
      t("dist: villaggio/index.html NON carica quell'entry (ha la sua)", !!entry && !VH.includes(entry) && /<script type="module"[^>]*src="\/amimi-app\/assets\/[^"]+\.js"/.test(VH));
      t('dist: villaggio/index.html punta a /amimi-app/villaggio/manifest.webmanifest, che esiste', /href="\/amimi-app\/villaggio\/manifest\.webmanifest"/.test(VH) && existsSync(ROOT + D + 'villaggio/manifest.webmanifest'));
    } else nota('web/dist/villaggio/index.html assente: controllo dell\'ingresso Villaggio saltato');
  } else nota('web/dist senza version.json o index.html: controllo della build saltato (serve npm run build in web/)');
}

console.log(`\n${ok} ok, ${ko} KO`);
// exit 1 a ogni KO. process.exit solo in quel caso: chiamato a fine run riuscito, su Windows (Node 24) ogni tanto chiude
// con "Assertion failed ... UV_HANDLE_CLOSING" (vedi arrivo_adesso.mjs); a run verde il processo esce da se' con 0.
if (ko) process.exit(1);
