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
// Dalle Paillettes (fase 2) scrive anche con CountForm (giro di conta) e con le tre azioni sue, segnaPresenza,
// verificaFornitore e registraContaCompleta; i suoi interruttori arrivano tutti insieme da fetchVillaggioSettings.
// Dal secondo giro (16-10 sera) anche cinture e prove sulla pagina e sul mondo: l'ordine a meta' non si perde (apri,
// chiudi, lascia, la Home e onDone VERI ritagliati da Villaggio.tsx, con go() di App.tsx e il backnav vero su una
// history finta che fissa la meta di back() come Chromium), Esc nei campi, passo 3 sui dati veri, home() dell'app a
// se', thumbAsync cancellabile, riposo, ombre, e impasta() vera sul three.js di web/node_modules (saltata con una nota
// se manca: npm ci in web/).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
// Fuori dalla copia perche' a giacenza 0 e senza righe aperte, ma il Villaggio la legge lo stesso (fetchInventory non
// filtra): letta il 16-10-2026 in SOLA lettura con select codice,item,variant,giacenza_attuale from v_inventory
// where codice ilike '%VIOLA%' (l'altra, LEA_BAG_VERNICE_VIOLA, ha item e variant nulli: nessun modello, nessuna pila).
const VIOLA_VERA = ['LEA_BAG_COCCO_VIOLA', 'LEA BAG', 'COCCO_VIOLA', 0];
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

console.log("\n== VIOLA = PURPLE (16-10 notte): LEA_BAG_COCCO_VIOLA ha il cocco viola di LEA_BAG_COCCO_PURPLE ==");
{
  const [vc, vi, vv, vg] = VIOLA_VERA;
  const vio = look(vc, vi, vv), pur = lookInv('LEA_BAG_COCCO_PURPLE');
  eq("COLMAP: VIOLA e' lo stesso colore di PURPLE", [COLMAP.VIOLA, COLMAP.VIOLA === COLMAP.PURPLE], [0x74306f, true]);
  eq('LEA_BAG_COCCO_VIOLA (dato vero): Lea, cocco, il viola di PURPLE e la stessa chiave di LEA_BAG_COCCO_PURPLE (dato vero)',
    [vio?.model, vio?.look.fin, vio?.look.cols, vio?.look.key], ['Lea', 'cocco', [COLMAP.PURPLE], pur?.look.key]);
  t("...non piu' il cocco senza colore (prima VIOLA non era un colore e la borsa veniva marrone)", !!vio && vio.look.key !== parseLook('Lea', 'COCCO').key);
  eq("nice(): 'COCCO_VIOLA' e 'COCCO_PURPLE' si chiamano tutte e due 'Cocco viola'", [nice(vv), nice('COCCO_PURPLE')], ['Cocco viola', 'Cocco viola']);
  const invVero = INV.map(([c, i, v, g]) => invRow(c, i, v, String(g)));
  const conViola = costruisci([], [...invVero, invRow(vc, vi, vv, String(vg))], OGGI), senza = costruisci([], invVero, OGGI);
  const kp = conViola.codeToPila.get('LEA_BAG_COCCO_PURPLE'), P = conViola.pile.get(kp);
  eq('costruisci (copia vera + COCCO_VIOLA): i due codici nella stessa pila viola, giacenza per codice 18 e 0',
    [conViola.codeToPila.get(vc) === kp, P?.codes.map((c) => [c.codice, c.stock]), P?.stock, P?.name, P?.look.cols],
    [true, [['LEA_BAG_COCCO_PURPLE', 18], ['LEA_BAG_COCCO_VIOLA', 0]], 18, 'Cocco viola', [COLMAP.PURPLE]]);
  eq("...fusa, non una pila in piu' (e la pila di PURPLE resta quella di prima)", [conViola.pile.size, kp], [senza.pile.size, senza.codeToPila.get('LEA_BAG_COCCO_PURPLE')]);
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
// il pezzo di `s` da `da` (compreso) ad `a` (compreso se conA); '' se uno dei due manca
const ritaglia = (s, da, a, conA = false) => { const i = s.indexOf(da); if (i < 0) return ''; const j = s.indexOf(a, i + da.length); return j < 0 ? '' : s.slice(i, conA ? j + a.length : j); };
// toglie i tipi TS a un pezzo di sorgente ritagliato, per farlo girare davvero (null se Node non ha stripTypeScriptTypes)
let STRIP;
const sTS = async (src) => {
  if (STRIP === undefined) { try { ({ stripTypeScriptTypes: STRIP } = await import('node:module')); } catch { STRIP = null; } }
  if (typeof STRIP !== 'function' || !src) return null;
  const ew = process.emitWarning; process.emitWarning = () => {};   // ancora "experimental": niente avviso a ogni run
  try { return STRIP(src); } catch (e) { t('ritaglio che non compila: ' + e.message, false); return null; } finally { process.emitWarning = ew; }
};

const VIL = read('web/src/pages/Villaggio.tsx');
const VAPP = read('web/src/VillaggioApp.tsx');
const MONDO = read('web/src/lib/villaggio/mondo.ts');
const CAT = read('web/src/lib/villaggio/catalogo.ts');
const API = read('web/src/lib/api.ts');
const CSS = read('web/src/styles/villaggio.css');
// un metodo (su piu' righe) della classe Mondo, dalla sua riga alla sua graffa di chiusura a due spazi
const metodo = (nome) => {
  const m = new RegExp('\\n  (?:private |static )?' + nome + '\\(').exec(MONDO);
  if (!m) return '';
  const j = MONDO.indexOf('\n  }\n', m.index + 1);
  return j < 0 ? '' : MONDO.slice(m.index + 1, j + 4);
};

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
  // 16-10 sera: mergeGeometries per fondere le mesh ferme (impasta); viene dagli esempi di three, nessuna dipendenza nuova.
  // Paillettes (fase 2): parseLook per le due borse sul banco del chiosco-boutique (premio del livello 4)
  eq('mondo.ts importa (valori) solo three, mergeGeometries dagli esempi di three, lastre e parseLook da ./catalogo', importi(MONDO).filter((i) => !i.tipo).map((i) => i.da + ':' + i.nomi.join(',')).sort(),
    ['./catalogo:lastre,parseLook', 'three/examples/jsm/utils/BufferGeometryUtils.js:mergeGeometries', 'three:THREE']);
  const PKG = JSON.parse(read('web/package.json'));
  t("three e' una dipendenza dichiarata di web/ (gli esempi vengono con lo stesso pacchetto)", !!PKG.dependencies?.three && !PKG.dependencies?.['three-stdlib']);
  t("la pagina usa costruisci() e arriviFra() di catalogo.ts, non una copia sua", /\bcostruisci\b/.test(nomiDa(VIL, '../lib/villaggio/catalogo').join(' ')) && nomiDa(VIL, '../lib/villaggio/catalogo').includes('arriviFra')
    && !/function (costruisci|arriviFra)\s*\(/.test(VIL));
}

console.log('\n== cinture: le sole vie di scrittura sono ArrivoRow e SupplierOrderForm di Ordini, CountForm e le due delle Paillettes ==');
{
  // Paillettes (fase 2): CountForm di Magazzino per il giro di conta, paillettes.ts (funzioni pure, solo tipi) per i punti
  const OK_VIL = ['react', '../components/Icon', '../lib/api', './Ordini', '../components/SupplierOrderForm', '../components/CountForm', '../lib/people', '../lib/backnav',
    '../lib/villaggio/catalogo', '../lib/villaggio/mondo', '../lib/villaggio/paillettes', '../styles/villaggio.css'];
  eq('Villaggio.tsx importa (valori) solo da moduli noti', importi(VIL).filter((i) => !i.tipo && !OK_VIL.includes(i.da) && !/^@fontsource\//.test(i.da)).map((i) => i.da), []);
  eq("da lib/api le letture fetchInventory, fetchOrdiniGruppi, fetchVillaggioEventi e oggi, e le tre scritture segnaPresenza, verificaFornitore e registraContaCompleta",
    nomiDa(VIL, '../lib/api'), ['fetchInventory', 'fetchOrdiniGruppi', 'fetchVillaggioEventi', 'oggi', 'registraContaCompleta', 'segnaPresenza', 'verificaFornitore']);
  const corpoPres = ritaglia(API, 'export async function segnaPresenza(', '\n}\n'), corpoVer = ritaglia(API, 'export async function verificaFornitore(', '\n}\n');
  const corpoCC = ritaglia(API, 'export async function registraContaCompleta(', '\n}\n');
  t("segnaPresenza scrive solo l'azione villaggio_presenza, verificaFornitore solo fornitore_verifica, registraContaCompleta solo villaggio_conta_completa {codici}",
    conta(corpoPres, /writeApi\(/) === 1 && /writeApi\('villaggio_presenza', \{\}, 'x', chi\)/.test(corpoPres)
    && conta(corpoVer, /writeApi\(/) === 1 && /writeApi\('fornitore_verifica', payload, 'x', chi\)/.test(corpoVer)
    && conta(corpoCC, /writeApi\(/) === 1 && /writeApi\('villaggio_conta_completa', \{ codici \}, 'x', chi\)/.test(corpoCC));
  // la conta completa si registra solo in fondo al giro completo, e il bottone c'e' solo per chi gioca
  t('registraContaCompleta: una sola chiamata nella pagina, passata al giro solo per chi gioca (onRegistra)',
    conta(VIL, /registraContaCompleta\(/) === 1 && /onRegistra=\{gioca \? registraCompleta : undefined\}/.test(VIL));
  t('fetchVillaggioEventi legge e basta: v_villaggio_eventi, nessuna scrittura', /supabase\.from\('v_villaggio_eventi'\)\.select\(/.test(ritaglia(API, 'export async function fetchVillaggioEventi(', '\n}\n'))
    && !/writeApi|\.(insert|upsert|update|delete|rpc)\(/.test(ritaglia(API, 'export async function fetchVillaggioEventi(', '\n}\n')));
  eq('da CountForm il suo componente, che dal Villaggio si usa solo nel giro', [nomiDa(VIL, '../components/CountForm'), conta(VIL, /<CountForm\b/)], [['CountForm'], 1]);
  eq('da ./Ordini solo ArrivoRow', nomiDa(VIL, './Ordini'), ['ArrivoRow']);
  eq('da SupplierOrderForm il suo componente', nomiDa(VIL, '../components/SupplierOrderForm'), ['SupplierOrderForm']);
  t('usa <ArrivoRow> e <SupplierOrderForm>', /<ArrivoRow\b/.test(VIL) && /<SupplierOrderForm\b/.test(VIL));
  t('dopo un arrivo ArrivoRow ricarica con load (furgoncino)', /<ArrivoRow [^>]*reload=\{load\}/.test(VIL));
  // 16-10 notte: il modulo chiama onDone 700 ms dopo il salvataggio, anche se nel frattempo il pannello e' cambiato
  t("dopo un ordine SupplierOrderForm ricarica SEMPRE con load (e lo dice); Laboratori e modulo pulito solo se si e' ancora su QUESTO passo 4",
    /<SupplierOrderForm\b[\s\S]*?onDone=\{\(\) => \{\s*load\(\); toast\('Ordine salvato: lo trovi anche in Ordini\.'\);\s*(?:\/\/[^\n]*\n\s*)*if \(sheetRef\.current !== s\) return;\s*formSporco\.current = false;\s*sheetRef\.current = \{ t: 'labs' \}; setSheet\(\{ t: 'labs' \}\);\s*\}\} \/>/.test(VIL));
  const OK_VAPP = ['react', './pages/Villaggio.tsx', './components/ErrorBoundary.tsx', './lib/api.ts'];
  eq('VillaggioApp.tsx importa (valori) solo da moduli noti', importi(VAPP).filter((i) => !i.tipo && !OK_VAPP.includes(i.da)).map((i) => i.da), []);
  eq('VillaggioApp.tsx da lib/api solo fetchVillaggioSettings e VILLAGGIO_SPENTO', nomiDa(VAPP, './lib/api.ts'), ['VILLAGGIO_SPENTO', 'fetchVillaggioSettings']);
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
  // 16-10 sera: il molo buono e' quello DOPO aggiorna() (i posti scorrono quando un laboratorio sparisce); quello letto
  // prima serve solo se il capannone non c'e' piu' (ha chiuso la sua ultima riga)
  const iPrima = VIL.indexOf('const prima = arrivi.map((x) => W.dockOf(x.lab));'), iAgg = VIL.indexOf('W.aggiorna(m.dati)');
  const iArr = VIL.indexOf("W.arrivo(W.dockOf(x.lab) ?? prima[i], x.riga, x.n, m.codeToPila.get(x.riga.codice) ?? '');");
  t('i moli di riserva si leggono prima di aggiornare il mondo', iPrima > 0 && iAgg > iPrima);
  t("...il furgoncino parte dal molo letto DOPO aggiorna(), quello di prima solo se il laboratorio e' sparito", iArr > iAgg);
  eq('...e W.arrivo( e\' chiamato solo li\'', conta(VIL, /W\.arrivo\(/), 1);
  // il toast dell'arrivo non dice "(WIP)": la regex vera della pagina sull'etichetta vera di catalogo.ts
  const reWip = /x\.riga\.label\.replace\(\/((?:\\.|[^/\\])+)\/, ''\)\.toLowerCase\(\)/.exec(VIL)?.[1];
  t("il toast dell'arrivo toglie il suffisso (WIP) dall'etichetta", !!reWip);
  if (reWip) {
    const mw = costruisci(gruppiDi([wipLinea('w', 'LEA_BAG_ZEBRA', 'LEA BAG', 'ZEBRA', 0)]), [invRow('LEA_BAG_ZEBRA', 'LEA BAG', 'ZEBRA', 4)], OGGI);
    const lab = mw.righe.get('w')?.riga.label ?? '';
    eq(`...sull'etichetta di una WIP vera ('${lab}') resta solo il nome`, lab.replace(new RegExp(reWip), '').toLowerCase(), 'zebrato');
    eq("...e un'etichetta senza (WIP) resta com'e'", ('Cocco nero' + PUNTO + '30x20').replace(new RegExp(reWip), ''), 'Cocco nero' + PUNTO + '30x20');
  }
  const usati = [...new Set([...VIL.matchAll(/\bW\.(\w+)\(/g), ...VIL.matchAll(/mondoRef\.current\?\.(\w+)\(/g)].map((m) => m[1]))].sort();
  eq('i metodi del Mondo usati dalla pagina esistono (pubblici) in mondo.ts', usati.filter((m) => !new RegExp('^  ' + m + '\\(', 'm').test(MONDO)), []);
  t("onPartenza: evento dichiarato, emesso dal mondo e ascoltato dalla pagina",
    /onPartenza\?: \(n: number\) => void/.test(MONDO) && /this\.ev\.onPartenza\?\.\(/.test(MONDO) && /onPartenza: \(\) =>/.test(VIL));
}

console.log("\n== cinture: l'ordine a meta' non si perde (lascia, formSporco, Esc, indietro, X, Home) ==");
{
  const corpoLascia = ritaglia(VIL, '  const lascia = useCallback(() => {', '\n  }, []);', true);
  const corpoAttendi = ritaglia(VIL, '  const quandoArrivaIlBack = useCallback(', '\n  }, []);', true);
  const corpoApri = ritaglia(VIL, '  const apri = useCallback(', '\n  }, [lascia, quandoArrivaIlBack]);', true);
  const corpoFn = ritaglia(corpoApri, '      const fn = () => {', '\n      };', true);   // l'handler di backnav del pannello
  const corpoChiudi = ritaglia(VIL, '  const chiudi = useCallback(() => {', '\n  }, [lascia]);', true);
  t('ritagli presenti: lascia, quandoArrivaIlBack, apri (con il suo handler di backnav), chiudi', [corpoLascia, corpoAttendi, corpoApri, corpoFn, corpoChiudi].every(Boolean));
  // Paillettes (fase 2): la stessa guardia protegge la verifica fornitore e il giro di conta
  t("lascia(): chiede solo per un modulo gia' toccato: l'ordine (add, passo 4), la verifica, la conta del giro",
    /const cosa = !s \|\| !formSporco\.current \? null\s*: s\.t === 'add' && s\.step === 4 \? "l'ordine" : s\.t === 'verifica' \? 'la verifica' : s\.t === 'giro' \? 'la conta' : null;\s*if \(!cosa\) return true;/.test(corpoLascia));
  const jsLascia = await sTS(corpoLascia.replace(/^  const lascia = useCallback\(/, 'const lascia = ').replace(/\n  \}, \[\]\);$/, '\n  };'));
  if (jsLascia) {
    const prova = (s, sporco, ok) => {
      const chieste = [], formSporco = { current: sporco };
      const r = new Function('sheetRef', 'formSporco', 'window', jsLascia + '\nreturn lascia;')({ current: s }, formSporco, { confirm: (m) => { chieste.push(m); return ok; } })();
      return [r, chieste, formSporco.current];
    };
    const LASCI = (cosa) => `Lasci ${cosa} a metà? Quello che hai scritto si perde.`;
    eq('lascia() vera: nessun pannello -> true senza chiedere', prova(null, true, false), [true, [], true]);
    for (const [nome, s, cosa] of [['passo 4', { t: 'add', step: 4 }, "l'ordine"], ['verifica', { t: 'verifica', lab: 'x' }, 'la verifica'], ['giro', { t: 'giro', codici: ['A'] }, 'la conta']]) {
      eq(`lascia() vera, ${nome} non toccato: true senza chiedere`, prova(s, false, false), [true, [], false]);
      eq(`lascia() vera, ${nome} toccato, Annulla: false, resta toccato`, prova(s, true, false), [false, [LASCI(cosa)], true]);
      eq(`lascia() vera, ${nome} toccato, OK: true, modulo pulito`, prova(s, true, true), [true, [LASCI(cosa)], false]);
    }
    for (const s of [{ t: 'add', step: 3 }, { t: 'lab', key: 'x' }, { t: 'wh' }, { t: 'percorso' }, { t: 'missioni' }]) {
      eq(`lascia() vera, ${s.t}${s.step ? ' passo ' + s.step : ''} "toccato": non e' un modulo, true senza chiedere`, prova(s, true, false).slice(0, 2), [true, []]);
    }
  } else nota('lascia() non provata (ritaglio assente o node:module.stripTypeScriptTypes mancante)');
  t('lascia(): window.confirm; annulla -> false, conferma -> modulo pulito e true', /if \(!window\.confirm\([^)]*\)\) return false;\s*formSporco\.current = false;\s*return true;/.test(corpoLascia));
  eq('window.confirm compare solo in lascia()', [conta(VIL, /window\.confirm\(/), conta(corpoLascia, /window\.confirm\(/)], [1, 1]);
  // 16-10 notte: quello che si chiede con un back() della X ancora in volo (riaprire, la Home) aspetta che arrivi
  t("apri(): con un back() della X in volo aspetta che arrivi (quandoArrivaIlBack) e poi si rifa' da capo con apriRef",
    /^\s*const apri = useCallback\(\(s: Exclude<Sheet, null>\) => \{\s*if \(backPendenti\.current > 0\) \{ quandoArrivaIlBack\(\(\) => apriRef\.current\(s\)\); return; \}/.test(corpoApri));
  t('apri() (etichette della mappa, barra in basso, ?): con un pannello aperto passa prima da lascia()',
    /^\s*const apri = useCallback\(\(s: Exclude<Sheet, null>\) => \{\s*if \(backPendenti\.current > 0\) \{[^\n]*\}\s*if \(sheetRef\.current && !lascia\(\)\) return;/.test(corpoApri));
  t("apriRef: la tiene allineata un effetto, e nessun altro la riscrive", /useEffect\(\(\) => \{ apriRef\.current = apri; \}, \[apri\]\);/.test(VIL) && conta(VIL, /apriRef\.current = /) === 1);
  t('apri(): il pannello nuovo parte con il modulo pulito', /formSporco\.current = false;\s*sheetRef\.current = s;\s*setSheet\(s\);\s*\}, \[lascia, quandoArrivaIlBack\]\);$/.test(corpoApri));
  t("indietro (handler di backnav): passa da lascia(); se annulla il pannello resta e la sua voce torna nella history",
    /if \(!lascia\(\)\) \{ pushed\.current\.push\(fn\); pushBack\(fn\); return; \}\s*sheetRef\.current = null; setSheet\(null\);\s*\};$/.test(corpoFn));
  t('chiudi() (X, Esc, tocco sulla mappa): passa da lascia()', /^\s*const chiudi = useCallback\(\(\) => \{\s*if \(!sheetRef\.current \|\| !lascia\(\)\) return;/.test(corpoChiudi));
  t("passo 4, '< Cambia colore': passa da lascia()", /<button className="v-back" type="button" onClick=\{\(\) => \{ if \(lascia\(\)\) setSheet\(\{ \.\.\.s, step: 3 \}\); \}\}>[^<]*Cambia colore<\/button>/.test(VIL));
  t("Home dell'HUD: passa da lascia() e, se un back() della X e' in volo, aspetta che arrivi prima di onBack",
    /<button className="v-pill v-home" type="button" onClick=\{\(\) => \{ if \(lascia\(\)\) quandoArrivaIlBack\(onBack\); \}\} aria-label="Torna alla Home">/.test(VIL));
  t("giro di conta: 'Salta/Avanti' passa da lascia() prima di andare al codice dopo",
    /onClick=\{\(\) => \{ if \(lascia\(\)\) \{ pulisci\(\); setI\(\(x\) => x \+ 1\); \} \}\}>\{gia \? 'Avanti ›' : 'Salta ›'\}<\/button>/.test(VIL));
  eq("lascia() la chiamano solo apri() (e il suo handler), chiudi(), '< Cambia colore', la Home e 'Salta/Avanti' del giro", [conta(VIL, /\blascia\(\)/), conta(corpoApri, /\blascia\(\)/), conta(corpoFn, /\blascia\(\)/), conta(corpoChiudi, /\blascia\(\)/)], [6, 2, 1, 1]);
  const corpoNoGl = ritaglia(VIL, '{noGl && (', ')}');
  eq("onBack: diretto solo nel messaggio senza WebGL (li' nessun pannello si apre), altrove solo via quandoArrivaIlBack, mai chiamato a mano",
    [conta(VIL, /onClick=\{onBack\}/), corpoNoGl.includes('onClick={onBack}'), conta(VIL, /quandoArrivaIlBack\(onBack\)/), conta(VIL, /\bonBack\(/)], [1, true, 1, 0]);
  t('la X del pannello e Esc chiamano chiudi()', /<button ref=\{closeRef\} className="v-x" type="button" onClick=\{chiudi\}/.test(VIL));
  t('tocco sulla mappa: al passo 4, nella verifica e nel giro di conta non chiude proprio',
    /W\.onTap = \(\) => \{ const s = sheetRef\.current; if \(!s \|\| \(s\.t === 'add' && s\.step === 4\) \|\| s\.t === 'verifica' \|\| s\.t === 'giro'\) return; chiudi\(\); \};/.test(VIL));
  eq("setSheet(null) e sheetRef.current = null solo nell'handler di backnav e in chiudi(): niente chiusure che scavalcano lascia()",
    [conta(VIL, /setSheet\(null\)/), conta(corpoFn, /setSheet\(null\)/), conta(corpoChiudi, /setSheet\(null\)/), conta(VIL, /sheetRef\.current = null/), conta(corpoFn, /sheetRef\.current = null/), conta(corpoChiudi, /sheetRef\.current = null/)],
    [2, 1, 1, 2, 1, 1]);
  // il modulo si segna toccato
  t('.v-form si segna toccato a ogni input e a ogni click', /<div className="v-form" onInput=\{\(\) => \{ formSporco\.current = true; \}\} onClick=\{\(\) => \{ formSporco\.current = true; \}\}>/.test(VIL));
  const vForm = ritaglia(VIL, '<div className="v-form"', '</div>');
  t('...e SupplierOrderForm sta dentro .v-form', /<SupplierOrderForm\b/.test(vForm));
  // la verifica e il giro si segnano toccati con sporca(), la stessa cosa scritta una volta sola
  t('sporca() = formSporco a true; la usano la verifica (interruttori, date, nota) e il .v-form del giro (input e click)',
    /const sporca = \(\) => \{ formSporco\.current = true; \};/.test(VIL) && conta(VIL, /\bsporca\(\);/) === 2
    && /<div className="v-form v-conta" onInput=\{sporca\} onClick=\{sporca\}>/.test(VIL) && /<Verifica\b[^>]*sporca=\{sporca\}/.test(VIL) && /<Giro\b[\s\S]*?sporca=\{sporca\}/.test(VIL));
  eq('formSporco diventa true solo in .v-form (input e click) e in sporca()', conta(VIL, /formSporco\.current = true/), 3);
  t('scegliendo la variante al passo 3 il modulo parte pulito', /onClick=\{\(\) => \{ formSporco\.current = false; setSheet\(\{ \.\.\.s, step: 4, pila: p\.key, codice: c\.codice \}\); \}\}/.test(VIL));
  // Esc
  const corpoK = ritaglia(VIL, '    const k = (e: KeyboardEvent) => {', '\n    };', true);
  t("Esc: dentro input, textarea, select o contenteditable resta al campo; fuori chiama chiudi()",
    /if \(e\.key !== 'Escape' \|\| !sheetRef\.current\) return;[\s\S]*?if \(\(e\.target as HTMLElement \| null\)\?\.closest\?\.\('input, textarea, select, \[contenteditable="true"\]'\)\) return;\s*chiudi\(\);/.test(corpoK));
  const jsK = await sTS(corpoK);
  if (jsK) {
    const campo = (sel) => ({ closest: (q) => (q.split(',').map((x) => x.trim()).includes(sel) ? {} : null) });
    const fuori = { closest: () => null };
    const esc = (aperto, ev) => { let n = 0; new Function('sheetRef', 'chiudi', jsK + '\nreturn k;')({ current: aperto ? { t: 'labs' } : null }, () => { n++; })(ev); return n; };
    eq('Esc (vero handler) fuori dai campi con un pannello aperto: chiude', esc(true, { key: 'Escape', target: fuori }), 1);
    for (const f of ['input', 'textarea', 'select', '[contenteditable="true"]']) eq(`Esc dentro ${f}: non chiude`, esc(true, { key: 'Escape', target: campo(f) }), 0);
    eq('Esc senza target: chiude', esc(true, { key: 'Escape', target: null }), 1);
    eq('Esc su un target senza closest (document): chiude, non lancia', esc(true, { key: 'Escape', target: {} }), 1);
    eq('Esc senza pannello aperto: niente', esc(false, { key: 'Escape', target: fuori }), 0);
    eq('Invio: niente', esc(true, { key: 'Enter', target: fuori }), 0);
  } else nota("handler di Esc non provato (ritaglio assente o node:module.stripTypeScriptTypes mancante)");

  // la X chiude subito; il history.back() in volo lo conta backPendenti, e quello che si chiede nel frattempo aspetta
  t('chiudi(): chiude SUBITO, poi consuma la voce di history e conta il back() in volo',
    /if \(!sheetRef\.current \|\| !lascia\(\)\) return;\s*sheetRef\.current = null; setSheet\(null\);\s*let subito = false;\s*popBack\(\(\) => \{ subito = true; \}\);\s*if \(!subito\) backPendenti\.current\+\+;/.test(corpoChiudi));
  t("handler di backnav: un back() della X ancora in volo si consuma senza chiudere niente; all'ultimo parte quello che aspettava e la rete si spegne",
    /^\s*const fn = \(\) => \{\s*if \(backPendenti\.current > 0\) \{\s*if \(--backPendenti\.current === 0\) \{ window\.clearTimeout\(attesa\.current\); const g = dopoIlBack\.current; dopoIlBack\.current = null; g\?\.\(\); \}\s*return;\s*\}/.test(corpoFn));
  t("quandoArrivaIlBack: senza back() in volo esegue subito, altrimenti mette da parte (l'ultima richiesta vince)",
    /^\s*const quandoArrivaIlBack = useCallback\(\(f: \(\) => void\) => \{\s*if \(backPendenti\.current === 0\) \{ f\(\); return; \}\s*dopoIlBack\.current = f;/.test(corpoAttendi));
  t('...con una rete: dopo 2 s senza popstate azzera backPendenti e procede comunque',
    /window\.clearTimeout\(attesa\.current\);\s*attesa\.current = window\.setTimeout\(\(\) => \{ backPendenti\.current = 0; const g = dopoIlBack\.current; dopoIlBack\.current = null; g\?\.\(\); \}, 2000\);\s*\}, \[\]\);$/.test(corpoAttendi));
  const SCRIVE_BP = /(?:\+\+|--)backPendenti\.current|backPendenti\.current\s*(?:\+\+|--|[-+*/]?=(?!=))/;
  eq("backPendenti cresce solo in chiudi(), cala solo nell'handler e si azzera solo nella rete dei 2 s (e nessun'altra scrittura)",
    [conta(VIL, /backPendenti\.current\+\+/), conta(corpoChiudi, /backPendenti\.current\+\+/), conta(VIL, /--backPendenti\.current/), conta(corpoFn, /--backPendenti\.current/),
      conta(VIL, /backPendenti\.current = /), conta(corpoAttendi, /backPendenti\.current = 0;/), conta(VIL, /backPendenti\.current--/), conta(VIL, SCRIVE_BP)],
    [1, 1, 1, 1, 1, 1, 0, 3]);
  eq("dopoIlBack: lo scrive solo quandoArrivaIlBack, lo consumano (svuotandolo) solo l'handler e la rete",
    [conta(VIL, /dopoIlBack\.current = f;/), conta(VIL, /dopoIlBack\.current = null;/), conta(corpoFn, /dopoIlBack\.current = null;/), conta(corpoAttendi, /dopoIlBack\.current = null;/), conta(VIL, /dopoIlBack\.current = /)],
    [1, 2, 1, 1, 3]);
  t('allo smontaggio si spegne la rete dei 2 s', /useEffect\(\(\) => \(\) => window\.clearTimeout\(attesa\.current\), \[\]\);/.test(VIL));
  t('allo smontaggio killBack sugli handler spinti', /useEffect\(\(\) => \(\) => killBack\(pushed\.current\), \[\]\);/.test(VIL));

  // apri / chiudi / lascia / quandoArrivaIlBack VERI (ritagliati da Villaggio.tsx), la Home dell'HUD e onDone del passo
  // 4 VERI (dal JSX), go() VERO di App.tsx e il backnav VERO (lib/backnav.ts), su un browser finto alla Chromium:
  // history.back() fissa la meta QUANDO lo si chiama (indice di allora - 1) e resta "in volo" finche' non arriva il
  // popstate (flush), quindi una voce spinta nel frattempo viene scavalcata; sotto la prima voce si esce dall'app.
  // React ridotto all'osso: useRef, useCallback, useEffect (gira subito e conserva la pulizia per lo smontaggio).
  // Si parte sempre da Home -> Villaggio con go() di App, come nell'app intera.
  const blocco = ritaglia(VIL, '  const formSporco = useRef(false);', '  useEffect(() => () => killBack(pushed.current), []);');
  const RIGA_ATTESA = '    if (backPendenti.current > 0) { quandoArrivaIlBack(() => apriRef.current(s)); return; }\n';
  const APP_TSX = read('web/src/App.tsx');
  const corpoGo = ritaglia(APP_TSX, '  const go = (t: Tab, p?: string) => {', '\n  };', true);
  t("App.tsx: go() spinge una voce di history a ogni cambio di scheda (indietro = scheda di prima)", /if \(t !== tab\) \{ const prev = tab; pushBack\(\(\) => \{ setParam\(undefined\); setTab\(prev\); \}\); \}/.test(corpoGo));
  // l'onClick della Home qualunque sia (anche un onBack nudo): gli scenari girano lo stesso e dicono cosa si rompe
  const homeHud = /<button className="v-pill v-home" type="button" onClick=\{([^\n]*?)\} aria-label="Torna alla Home">/.exec(VIL)?.[1] ?? '';
  const srcOnDone = /<SupplierOrderForm\b[\s\S]*?onDone=\{(\(\) => \{[\s\S]*?\})\} \/>/.exec(VIL)?.[1] ?? '';
  const jsBlocco = await sTS(blocco), jsGo = await sTS(corpoGo), jsOnDone = await sTS(srcOnDone);
  // la stessa pagina senza l'attesa in apri() (com'era prima): serve a provare che la history finta vede il guaio
  const jsSenzaAttesa = blocco.includes(RIGA_ATTESA) ? await sTS(blocco.replace(RIGA_ATTESA, '')) : null;
  t('ritagli per gli scenari: blocco dei pannelli, go() di App, Home, onDone, e la riga dell\'attesa in apri()', !!(jsBlocco && jsGo && homeHud && jsOnDone && jsSenzaAttesa));
  if (jsBlocco && jsGo && homeHud && jsOnDone) {
    const winPrima = Object.getOwnPropertyDescriptor(globalThis, 'window'), histPrima = Object.getOwnPropertyDescriptor(globalThis, 'history');
    let giro = 0;
    const browser = async (src = jsBlocco) => {
      const B = { idx: 0, coda: [], uscito: 0, risposta: true, chieste: 0, pop: [], ora: 0, timer: new Map(), nt: 0 };
      globalThis.window = {
        addEventListener: (tipo, f) => { if (tipo === 'popstate') B.pop.push(f); },
        confirm: () => { B.chieste++; return B.risposta; },
        setTimeout: (f, ms) => { B.timer.set(++B.nt, { f, at: B.ora + ms }); return B.nt; },
        clearTimeout: (id) => { B.timer.delete(id); },
      };
      // pushState tronca le voci in avanti e va sulla nuova; back() fissa la meta adesso e arriva al flush
      globalThis.history = { pushState: () => { B.idx++; }, back: () => { B.coda.push(B.idx - 1); } };
      // un backnav nuovo per ogni scenario (la sua pila e' di modulo)
      const BN = await import(pathToFileURL(ROOT + 'web/src/lib/backnav.ts').href + '?giro=' + (++giro));
      B.flush = () => {
        while (B.coda.length) {
          const meta = B.coda.shift();
          if (meta < 0) { B.uscito++; continue; }
          if (meta === B.idx) continue;
          B.idx = meta; B.pop.forEach((f) => f({}));
        }
      };
      B.indietro = () => { history.back(); B.flush(); };
      // orologio finto per la rete dei 2 s
      B.avanza = (ms) => {
        const fine = B.ora + ms;
        for (;;) {
          const [id, x] = [...B.timer].filter(([, x]) => x.at <= fine).sort((a, b) => a[1].at - b[1].at)[0] ?? [];
          if (id == null) break;
          B.timer.delete(id); B.ora = x.at; x.f();
        }
        B.ora = fine;
      };
      // App: la scheda, go() vero (ricreato a ogni chiamata con la scheda di quel momento, come a ogni render)
      const app = { tab: 'home', onBack: 0, load: 0, toast: 0, montato: true };
      const go = (t) => new Function('tab', 'pushBack', 'setParam', 'setTab', jsGo + '\nreturn go;')(app.tab, BN.pushBack, () => {}, (x) => { app.tab = x; })(t);
      go('villaggio');
      const base = B.idx;
      // il Villaggio
      const st = { sheet: null }, sheetRef = { current: null }, pulizie = [];
      // setSheet + l'effetto della pagina che a ogni render riallinea sheetRef
      const setSheet = (s) => { st.sheet = s; sheetRef.current = s; };
      const useEffect = (f) => { const c = f(); if (typeof c === 'function') pulizie.push(c); };
      const P = new Function('useRef', 'useCallback', 'useEffect', 'sheetRef', 'setSheet', 'pushBack', 'popBack',
        src + '\nreturn { formSporco, lascia, apri, chiudi, backPendenti, pushed, quandoArrivaIlBack };')(
        (v) => ({ current: v }), (f) => f, useEffect, sheetRef, setSheet, BN.pushBack, BN.popBack);
      // smontaggio come la pagina: le pulizie degli effetti (la rete dei 2 s) e killBack sugli handler spinti
      const smonta = () => { if (!app.montato) return; app.montato = false; pulizie.forEach((f) => f()); BN.killBack(P.pushed.current); };
      // onBack di App.tsx: go('home'), e la scheda Villaggio si smonta
      const onBack = () => { app.onBack++; go('home'); smonta(); };
      const home = new Function('lascia', 'quandoArrivaIlBack', 'onBack', 'return ' + homeHud)(P.lascia, P.quandoArrivaIlBack, onBack);
      // onDone del passo 4 come lo crea il render del pannello `s`
      const onDone = (s) => new Function('load', 'toast', 'sheetRef', 's', 'formSporco', 'setSheet', 'return ' + jsOnDone)(
        () => { app.load++; }, () => { app.toast++; }, sheetRef, s, P.formSporco, setSheet);
      // come la pagina: passi 2 e 3 con setSheet, poi un input nel modulo
      const alPasso4 = (sporco) => { P.apri({ t: 'add', step: 1 }); setSheet({ t: 'add', step: 4, lab: 'Francesco (pelle)', model: 'Lea', pila: 'Lea|x', codice: 'LEA_BAG_COCCO_GREEN' }); P.formSporco.current = sporco; return sheetRef.current; };
      return { B, st, app, base, voci: () => B.idx - base, setSheet, smonta, onBack, home, onDone, alPasso4, ...P };
    };
    try {
      let S = await browser();
      eq('(0) da Home al Villaggio con go() di App: la sua voce di history', [S.app.tab, S.base], ['villaggio', 1]);
      S.apri({ t: 'labs' });
      eq('(1) apri: pannello aperto, una voce di history', [S.st.sheet?.t, S.voci()], ['labs', 1]);
      S.chiudi();
      eq('(1) X: chiuso SUBITO, il back() in volo contato', [S.st.sheet, S.B.coda.length, S.backPendenti.current], [null, 1, 1]);
      S.B.flush();
      eq('(1) arriva il popstate: resta chiuso, contatore a 0, history alla voce del Villaggio', [S.st.sheet, S.backPendenti.current, S.voci(), S.app.tab], [null, 0, 0, 'villaggio']);

      // X e subito un altro pannello, prima del popstate
      S = await browser();
      S.apri({ t: 'labs' }); S.chiudi(); S.apri({ t: 'wh' });
      eq("(2) X e subito un altro pannello: la riapertura aspetta il back (niente pannello, nessuna voce spinta prima)", [S.st.sheet, S.voci(), S.B.coda.length, S.B.timer.size], [null, 1, 1, 1]);
      S.B.flush();
      eq("(2) arriva il popstate: il pannello si apre ADESSO e spinge la sua voce dopo il back", [S.st.sheet?.t, S.backPendenti.current, S.voci(), S.B.timer.size], ['wh', 0, 1, 0]);
      S.B.indietro();
      eq("(2) un indietro vero lo chiude e si resta nel Villaggio, alla sua voce; nessuna conferma", [S.st.sheet, S.app.tab, S.voci(), S.B.chieste, S.B.uscito], [null, 'villaggio', 0, 0, 0]);
      S.B.indietro();
      eq("(2) l'indietro dopo e' quello di App: torna a Home, dentro l'app", [S.app.tab, S.B.idx, S.B.uscito], ['home', 0, 0]);
      S = await browser();
      S.apri({ t: 'labs' }); S.chiudi(); S.apri({ t: 'wh' }); S.B.flush(); S.chiudi(); S.B.flush();
      eq("(2) ...e la X del pannello riaperto lo chiude restando nel Villaggio", [S.st.sheet, S.app.tab, S.voci(), S.backPendenti.current, S.B.uscito], [null, 'villaggio', 0, 0, 0]);
      if (jsSenzaAttesa) {
        S = await browser(jsSenzaAttesa);
        S.apri({ t: 'labs' }); S.chiudi(); S.apri({ t: 'wh' }); S.B.flush(); S.B.indietro();
        eq("(2) prova della history finta: senza l'attesa (com'era prima) la voce spinta prima del back viene scavalcata e l'indietro scende sotto il Villaggio",
          [S.st.sheet, S.voci(), S.app.tab], [null, -1, 'villaggio']);
      }

      // X e subito la Home, prima del popstate
      S = await browser();
      S.apri({ t: 'labs' }); S.chiudi(); S.home();
      eq('(3) X e subito la Home: la Home aspetta il back (onBack non ancora chiamato)', [S.app.onBack, S.app.tab, S.B.timer.size], [0, 'villaggio', 1]);
      S.B.flush();
      eq("(3) arriva il popstate: onBack una volta, si e' a Home", [S.app.onBack, S.app.tab, S.backPendenti.current], [1, 'home', 0]);
      S.B.flush(); S.B.avanza(5000);
      eq('(3) nessun rimbalzo nel Villaggio, la rete dei 2 s spenta (onBack resta 1)', [S.app.tab, S.app.onBack, S.B.timer.size], ['home', 1, 0]);
      const tabs = []; S.B.indietro(); tabs.push(S.app.tab); S.B.indietro(); tabs.push(S.app.tab);
      eq("(3) history coerente: due indietro di App = Villaggio, poi Home, mai fuori dall'app", [tabs, S.B.idx, S.B.uscito], [['villaggio', 'home'], 0, 0]);
      S = await browser();
      S.apri({ t: 'labs' }); S.chiudi(); S.onBack(); S.B.flush();
      eq("(3) prova della history finta: con la Home di prima (onBack subito) il back in volo consuma la voce di App e si rimbalza nel Villaggio", S.app.tab, 'villaggio');
      S = await browser();
      S.apri({ t: 'labs' }); S.chiudi(); S.apri({ t: 'wh' }); S.home(); S.B.flush();
      eq("(3) X, un pannello e poi la Home prima del popstate: vince l'ultima richiesta, la Home (il pannello non si apre)", [S.app.onBack, S.app.tab, S.st.sheet, S.B.timer.size], [1, 'home', null, 0]);

      // la rete dei 2 s
      S = await browser();
      S.apri({ t: 'labs' }); S.chiudi(); S.B.coda.length = 0;   // il popstate non arriva (history toccata da altri)
      S.apri({ t: 'wh' }); S.B.avanza(1999);
      eq('(4) popstate perso: la riapertura aspetta ancora a 1,999 s', [S.st.sheet, S.backPendenti.current], [null, 1]);
      S.B.avanza(1);
      eq('(4) ...a 2 s procede comunque: contatore azzerato, pannello aperto con la sua voce, rete spenta', [S.st.sheet?.t, S.backPendenti.current, S.voci(), S.B.timer.size], ['wh', 0, 2, 0]);
      S.B.indietro();
      eq('(4) ...e un indietro lo chiude, nel Villaggio', [S.st.sheet, S.app.tab], [null, 'villaggio']);
      S = await browser();
      S.apri({ t: 'labs' }); S.chiudi(); S.B.coda.length = 0; S.home(); S.B.avanza(1999);
      eq('(4) popstate perso con la Home: a 1,999 s si aspetta ancora', [S.app.onBack, S.app.tab], [0, 'villaggio']);
      S.B.avanza(1);
      eq('(4) ...a 2 s onBack una volta, a Home', [S.app.onBack, S.app.tab, S.backPendenti.current], [1, 'home', 0]);
      S = await browser();
      S.apri({ t: 'labs' }); S.chiudi(); S.B.coda.length = 0; S.apri({ t: 'wh' }); S.smonta(); S.B.avanza(5000);
      eq("(4) smontato mentre aspetta: la rete si spegne e non riapre niente", [S.st.sheet, S.B.timer.size, S.voci()], [null, 0, 1]);

      // la Home col modulo dell'ordine
      S = await browser();
      S.alPasso4(true); S.B.risposta = false; S.home();
      eq("(5) Home col modulo toccato e 'annulla': si resta al passo 4 nel Villaggio", [S.st.sheet?.step, S.app.onBack, S.app.tab, S.B.chieste], [4, 0, 'villaggio', 1]);
      S.B.risposta = true; S.home();
      eq("(5) Home e 'ok': onBack una volta, a Home, modulo pulito", [S.app.onBack, S.app.tab, S.formSporco.current, S.B.chieste], [1, 'home', false, 2]);
      S = await browser();
      S.alPasso4(false); S.home();
      eq('(5) Home col passo 4 mai toccato: esce subito senza chiedere', [S.app.onBack, S.app.tab, S.B.chieste], [1, 'home', 0]);
      S = await browser();
      S.home();
      eq('(5) Home senza pannelli: esce subito senza chiedere', [S.app.onBack, S.app.tab, S.B.chieste], [1, 'home', 0]);

      S = await browser();
      S.apri({ t: 'lab', key: 'Francesco (pelle)' }); S.B.indietro();
      eq('(6) indietro su un pannello qualsiasi: chiude senza chiedere', [S.st.sheet, S.B.chieste, S.voci()], [null, 0, 0]);

      S = await browser();
      S.alPasso4(true); S.B.risposta = false; S.B.indietro();
      eq("(7) indietro col modulo toccato e 'annulla': resta al passo 4, la voce di history torna", [S.st.sheet?.step, S.B.chieste, S.voci()], [4, 1, 1]);
      S.B.risposta = true; S.B.indietro();
      eq("(7) di nuovo indietro e 'ok': chiuso, modulo pulito, history consumata", [S.st.sheet, S.formSporco.current, S.B.chieste, S.voci()], [null, false, 2, 0]);

      S = await browser();
      S.alPasso4(true); S.B.risposta = false; S.chiudi();
      eq("(8) X col modulo toccato e 'annulla': resta aperto, nessun back() partito", [S.st.sheet?.step, S.B.coda.length, S.backPendenti.current], [4, 0, 0]);
      S.B.risposta = true; S.chiudi(); S.B.flush();
      eq("(8) X e 'ok': chiuso, history consumata", [S.st.sheet, S.voci(), S.backPendenti.current, S.B.chieste], [null, 0, 0, 2]);

      S = await browser();
      S.alPasso4(true); S.B.risposta = false; S.apri({ t: 'lab', key: 'Vincenzo (pelle)' });
      eq("(9) etichetta della mappa o barra col modulo toccato e 'annulla': resta al passo 4", [S.st.sheet?.t, S.st.sheet?.step], ['add', 4]);
      S.B.risposta = true; S.apri({ t: 'lab', key: 'Vincenzo (pelle)' });
      eq("(9) 'ok': si passa al laboratorio, modulo pulito, nessuna voce di history in piu'", [S.st.sheet?.t, S.formSporco.current, S.voci(), S.B.chieste], ['lab', false, 1, 2]);
      S.B.indietro();
      eq('(9) un indietro lo chiude', S.st.sheet, null);

      S = await browser();
      S.alPasso4(false); S.chiudi(); S.B.flush();
      eq('(10) modulo al passo 4 mai toccato: X chiude senza chiedere', [S.st.sheet, S.B.chieste, S.voci()], [null, 0, 0]);
      S = await browser();
      S.apri({ t: 'add', step: 3, model: 'Lea' }); S.formSporco.current = true; S.chiudi(); S.B.flush();
      eq('(11) passo 3 (il modulo non c\'e\'): X chiude senza chiedere', [S.st.sheet, S.B.chieste], [null, 0]);
      S = await browser();
      S.apri({ t: 'add', step: 3, model: 'Lea' }); S.formSporco.current = true; S.apri({ t: 'labs' });
      eq('(12) apri() su un altro pannello: il segno "toccato" non passa al pannello nuovo', [S.st.sheet?.t, S.formSporco.current, S.B.chieste], ['labs', false, 0]);

      // onDone (700 ms dopo il salvataggio): ricarica sempre, cambia pannello solo se si e' ancora su QUEL passo 4
      S = await browser();
      let s4 = S.alPasso4(true); S.onDone(s4)();
      eq("(13) ordine salvato, ancora sul passo 4: ricarica, lo dice, Laboratori col modulo pulito, sempre una voce di history",
        [S.app.load, S.app.toast, S.st.sheet?.t, S.formSporco.current, S.voci()], [1, 1, 'labs', false, 1]);
      S.B.indietro();
      eq('(13) ...e un indietro chiude i Laboratori, nel Villaggio', [S.st.sheet, S.app.tab, S.B.chieste], [null, 'villaggio', 0]);
      S = await browser();
      s4 = S.alPasso4(true); let tardi = S.onDone(s4); S.chiudi(); S.B.flush(); tardi();
      eq('(14) salvato e chiuso con la X prima dei 700 ms: ricarica e lo dice, ma resta chiuso', [S.app.load, S.app.toast, S.st.sheet, S.voci()], [1, 1, null, 0]);
      S = await browser();
      s4 = S.alPasso4(true); tardi = S.onDone(s4);
      // '< Cambia colore' (conferma) e di nuovo lo stesso colore: un passo 4 uguale ma NUOVO, che si ritocca
      if (S.lascia()) S.setSheet({ ...s4, step: 3 });
      S.formSporco.current = false; S.setSheet({ ...S.st.sheet, step: 4, pila: s4.pila, codice: s4.codice }); S.formSporco.current = true;
      const s4bis = S.st.sheet; tardi();
      eq("(15) salvato, poi un altro passo 4 uguale e gia' toccato: ricarica e lo dice, ma il passo 4 nuovo resta e resta protetto",
        [S.app.load, S.app.toast, S.st.sheet === s4bis, S.st.sheet?.step, S.formSporco.current], [1, 1, true, 4, true]);
      S.B.risposta = false; S.chiudi();
      eq("(15) ...la X chiede ancora (e con 'annulla' resta)", [S.st.sheet === s4bis, S.B.chieste], [true, 2]);
      S = await browser();
      s4 = S.alPasso4(true); tardi = S.onDone(s4); S.B.risposta = true; S.apri({ t: 'wh' }); tardi();
      eq('(16) salvato e poi il Magazzino prima dei 700 ms: ricarica, resta sul Magazzino', [S.app.load, S.st.sheet?.t], [1, 'wh']);
    } catch (e) { t('scenari di apri/chiudi/lascia/Home: ' + e.message, false); }
    finally {
      if (winPrima) Object.defineProperty(globalThis, 'window', winPrima); else delete globalThis.window;
      if (histPrima) Object.defineProperty(globalThis, 'history', histPrima); else delete globalThis.history;
    }
  } else nota('apri/chiudi/lascia/Home non provati su un browser finto (ritaglio assente o node:module.stripTypeScriptTypes mancante)');
}

console.log("\n== cinture: passi 3 e 4, laboratorio senza fornitore, chi scrive, senza WebGL ==");
{
  const corpoVoci = ritaglia(VIL, 'const voci = [...mod.pile.values()]', 'voci.forEach((v) => quanti.set(v.nome, (quanti.get(v.nome) ?? 0) + 1));', true);
  t('passo 3: la pagina conta i nomi delle figure di un modello', !!corpoVoci);
  t('passo 3: sotto una figura con un nome doppio compare il codice', /\{\(quanti\.get\(nome\) \?\? 0\) > 1 && <small className="cod">\{c\.codice\}<\/small>\}/.test(VIL));
  const jsVoci = await sTS(corpoVoci);
  if (jsVoci) {
    const passo3 = new Function('mod', 's', 'conTaglia', jsVoci + '\nreturn { voci, quanti };');
    const doppi = (m) => MODEL_ORDER.flatMap((model) => { const { voci, quanti } = passo3(m, { model }, conTaglia); return voci.filter((v) => quanti.get(v.nome) > 1).map((v) => model + ' ' + v.c.codice + ' = ' + v.nome); });
    const mv = costruisci([], INV.map(([c, i, v, g]) => invRow(c, i, v, String(g))), OGGI);
    eq("dati veri: al passo 3 il codice compare solo sotto le due Agata 'Fiori lilla' (FLOWER LILLA e l'anagrafica di ROSE_BUTTER_LILLA)", doppi(mv),
      ['Agata AGATA_BAG_FLOWER_LILLA = Fiori lilla', 'Agata AGATA_BAG_ROSE_BUTTER_LILLA = Fiori lilla']);
    // dal 16-10 notte VIOLA = PURPLE: LEA_BAG_COCCO_VIOLA (giacenza 0, fuori dalla copia ma letta dal Villaggio) entra
    // nella pila di LEA_BAG_COCCO_PURPLE, e al passo 3 i due 'Cocco viola' si distinguono dal codice
    const mvv = costruisci([], [...INV.map(([c, i, v, g]) => invRow(c, i, v, String(g))), invRow(VIOLA_VERA[0], VIOLA_VERA[1], VIOLA_VERA[2], String(VIOLA_VERA[3]))], OGGI);
    eq("dati veri + LEA_BAG_COCCO_VIOLA: al passo 3 il codice compare anche sotto i due 'Cocco viola' di Lea", doppi(mvv),
      ['Lea LEA_BAG_COCCO_PURPLE = Cocco viola', 'Lea LEA_BAG_COCCO_VIOLA = Cocco viola', 'Agata AGATA_BAG_FLOWER_LILLA = Fiori lilla', 'Agata AGATA_BAG_ROSE_BUTTER_LILLA = Fiori lilla']);
    const mm = costruisci([], [
      invRow('VALENTINA_BAG_GREEN_MILITARY', 'VALENTINA BAG', 'GREEN MILITARY', 6), invRow('VALENTINA_BAG_MILITARY_GREEN', 'VALENTINA BAG', 'MILITARY GREEN', 2),
      invRow('LAPTOP_COVER_COCCO_BLACK_30X20', 'LAPTOP COVER', 'COCCO BLACK 30X20', 4), invRow('LAPTOP_COVER_COCCO_BLACK_40X30', 'LAPTOP COVER', 'COCCO BLACK 40X30', 1),
    ], OGGI);
    eq('a mano: GREEN MILITARY e MILITARY GREEN (stessa figura, stesso nome) col codice; le due taglie della cover no (nomi diversi)', doppi(mm),
      ['Valentina VALENTINA_BAG_GREEN_MILITARY = Verde militare', 'Valentina VALENTINA_BAG_MILITARY_GREEN = Verde militare']);
  } else nota('passo 3 non provato sui dati (ritaglio assente o node:module.stripTypeScriptTypes mancante)');
  t("passo 4: il codice si vede sempre, 'da <laboratorio>' solo con un fornitore vero",
    /<small>\{s\.codice\} . \{L\?\.forn \? `da \$\{L\.nome\}` : 'scegli il fornitore qui sotto'\} . in magazzino \{stockDi\(s\.codice\)\}<\/small>/.test(VIL));
  t("passo 2: 'Cambia fornitore (nome)' solo con un fornitore vero", /\{L\?\.forn \? `Cambia fornitore \(\$\{L\.nome\}\)` : 'Cambia fornitore'\}/.test(VIL));
  t('passo 1: le tile sono i soli laboratori con un fornitore', /mod\.labs\.filter\(\(x\) => x\.forn\)\.map\(/.test(VIL));
  t("laboratorio senza fornitore: '+ Ordina borse' dal passo 1, non '+ Ordina a Senza fornitore'",
    /\{lab\.forn\s*\? <button [^>]*onClick=\{\(\) => apri\(\{ t: 'add', step: 2, lab: lab\.key \}\)\}>\+ Ordina a \{lab\.nome\}<\/button>\s*: <button [^>]*onClick=\{\(\) => apri\(\{ t: 'add', step: 1 \}\)\}>\+ Ordina borse<\/button>\}/.test(VIL));
  t("chip della giacenza in rosso (neg) quando il codice e' sotto zero", /className=\{'v-chip stock' \+ \(stockDi\(r\.codice\) < 0 \? ' neg' : ''\)\}/.test(VIL) && /\.v-chip\.stock\.neg \{/.test(CSS));
  t('villaggio.css: .v-vt .cod (il codice sotto la figura)', /\.v-vt \.cod \{/.test(CSS));

  // chi scrive
  t('setChi facoltativo nella firma di Villaggio', /setChi\?: \(c: string\) => void/.test(VIL));
  t("pill 'scrive': un <select> su PEOPLE solo con setChi (app a se'), altrimenti solo da leggere",
    /\{setChi\s*\? <label className="v-pill v-chi">[\s\S]*?<select value=\{chi\} onChange=\{\(e\) => setChi\(e\.target\.value\)\} aria-label="Chi scrive">[\s\S]*?\{PEOPLE\.map\(\(p\) => <option key=\{p\} value=\{p\}>\{personaName\(p\)\}<\/option>\)\}[\s\S]*?: <div className="v-pill v-chi" aria-label=\{`Scrive \$\{personaName\(chi\)\}`\}><span><small>scrive<\/small><b>\{personaName\(chi\)\}<\/b><\/span><\/div>\}/.test(VIL));
  t('...una persona fuori da PEOPLE resta selezionata (ha la sua opzione)', /\(PEOPLE as readonly string\[\]\)\.includes\(chi\) \? null : <option value=\{chi\}>\{personaName\(chi\)\}<\/option>/.test(VIL));
  t("niente piu' cambiaChi a giro (il bottone che ruotava le persone)", !/cambiaChi/.test(VIL));
  t("villaggio.css: il <select> riceve i tocchi (l'HUD li lascia passare alla mappa)", /\.v-chi select \{[^}]*pointer-events: auto;/.test(CSS));

  // senza WebGL
  const hud = ritaglia(VIL, '<header ref={hudRef} className="v-hud">', '</header>');
  const iHome = hud.indexOf('className="v-pill v-home"'), iNo = hud.indexOf('{!noGl && <>');
  const hudGl = ritaglia(hud, '{!noGl && <>', '</>}');
  t("senza WebGL: la Home resta (fuori dal ramo), i numeri, 'scrive' e la legenda no", iHome > 0 && iNo > iHome
    && ['in magazzino</small>', 'in preparazione</small>', 'righe aperte</small>', 'v-chi', 'v-qb'].every((x) => hudGl.includes(x)));
  t('senza WebGL: niente barra in basso', /\{!noGl && <nav className="v-bar" aria-label="Azioni del villaggio">/.test(VIL));

  // '1 riga' al singolare (16-10 notte): intestazione del laboratorio e lista Laboratori
  const rRighe = VIL.split('\n').find((r) => r.startsWith('const righe = ')) ?? '';
  t("righe(n): '1 riga' al singolare, altrimenti 'n righe'", /^const righe = \(n: number\) => \(n === 1 \? '1 riga' : n \+ ' righe'\);$/.test(rRighe));
  const jsRighe = await sTS(rRighe);
  if (jsRighe) eq('righe() vera su 0, 1, 2, 12', [0, 1, 2, 12].map(new Function(jsRighe + '\nreturn righe;')()), ['0 righe', '1 riga', '2 righe', '12 righe']);
  else nota('righe() non provata (riga assente o node:module.stripTypeScriptTypes mancante)');
  eq("intestazione del laboratorio e lista Laboratori contano con righe(), niente '{n} righe' scritto a mano",
    [conta(VIL, /\{righe\(lab\.raw\.length \+ lab\.extra\.length\)\}, \{lab\.pz\} pz da arrivare/), conta(VIL, /\{righe\(L\.raw\.length \+ L\.extra\.length\)\} . \{L\.pz\} pz/), conta(VIL, /\} righe\b/)], [1, 1, 0]);

  // piccoli fix della stessa giornata
  t('scroll al modello con getBoundingClientRect (offsetTop dipendeva dal genitore posizionato)', /b\.scrollTop \+= el\.getBoundingClientRect\(\)\.top - b\.getBoundingClientRect\(\)\.top - 8;/.test(VIL) && !/offsetTop/.test(VIL));
  t('Ginni: il timer della scrittura si ferma a testo completo', /const tutto = ridotto \|\| k >= testo\.length;\s*useEffect\(\(\) => \{\s*if \(tutto\) return;[\s\S]*?\}, \[testo, tutto\]\);/.test(VIL));
  t('Thumb: la richiesta della miniatura si cancella allo smontaggio', /const via = thumbAsync\(model, look, \(u\) => \{ if \(on\) setSrc\(u\); \}\); return \(\) => \{ on = false; via\(\); \};/.test(VIL));
}

console.log("\n== cinture su mondo.ts: miniature, riposo, ombre, mesh fuse, costruttore protetto ==");
{
  // miniature
  const corpoTA = ritaglia(MONDO, 'export function thumbAsync(', '\n}\n', true);
  t('thumbAsync restituisce la funzione che toglie la richiesta dalla coda', /^export function thumbAsync\(model: Modello, look: Look, cb: \(u: string\) => void\): \(\) => void \{/.test(corpoTA)
    && /return \(\) => \{ const i = THQ\.indexOf\(job\); if \(i >= 0\) THQ\.splice\(i, 1\); \};\n\}\n$/.test(corpoTA));
  t('...dalla cache risponde subito e restituisce una funzione vuota', /if \(THC\[k\]\) \{ cb\(THC\[k\]\); return \(\) => \{\}; \}/.test(corpoTA));
  t('...senza un Mondo vivo la coda si svuota e il giro si ferma', /if \(!VIVI\) \{ THQ\.length = 0; thBusy = false; return; \}/.test(corpoTA));
  t("thumb(): se il secondo contesto WebGL non si crea, niente miniature (THKO) e la pagina va avanti",
    /try \{ TR = new THREE\.WebGLRenderer\([^)]*\); \}\s*catch \{ THKO = true; return ''; \}/.test(MONDO) && /if \(THKO\) return '';/.test(MONDO));
  t('liberaCache(): svuota anche la coda delle miniature e i canvas', /THQ\.length = 0;\s*for \(const k of Object\.keys\(CANV\)\) delete CANV\[k\];/.test(ritaglia(MONDO, 'function liberaCache() {', '\n}\n', true)));
  const jsTA = await sTS(corpoTA.replace(/^export /, ''));
  if (jsTA) {
    const fab = new Function('thumb', 'requestAnimationFrame', 'performance',
      'let THKO = false, thBusy = false, VIVI = 1; const THQ = [], THC = {};\n' + jsTA + '\nreturn { thumbAsync, THQ, THC, vivi: (n) => { VIVI = n; }, stato: () => ({ thBusy, THKO }) };');
    const raf = [], disegnate = [], arrivate = [];
    const T = fab((m, l) => { disegnate.push(m + '|' + l.key); if (l.key === 'rotta') throw new Error('contesto perso'); return 'url:' + m + '|' + l.key; }, (f) => raf.push(f), performance);
    const giraRaf = () => { while (raf.length) raf.shift()(); };
    const viaA = T.thumbAsync('Lea', { key: 'a' }, (u) => arrivate.push(['a', u]));
    T.thumbAsync('Lea', { key: 'b' }, (u) => arrivate.push(['b', u]));
    eq('thumbAsync (vera): due richieste in coda, un solo giro chiesto', [T.THQ.length, raf.length], [2, 1]);
    viaA();
    eq('...cancellata la prima (componente smontato): ne resta una', T.THQ.length, 1);
    giraRaf();
    eq('...al giro si disegna e si consegna solo la seconda', [disegnate, arrivate], [['Lea|b'], [['b', 'url:Lea|b']]]);
    viaA();
    eq('...cancellare di nuovo non toglie altro', T.THQ.length, 0);
    T.THC['Lea|c'] = 'url:cache';
    const subito = [], viaC = T.thumbAsync('Lea', { key: 'c' }, (u) => subito.push(u));
    eq('...dalla cache: risposta subito, niente coda, cancellazione innocua', [subito, T.THQ.length, raf.length, typeof viaC, viaC()], [['url:cache'], 0, 0, 'function', undefined]);
    T.thumbAsync('Lea', { key: 'd' }, (u) => arrivate.push(['d', u]));
    T.vivi(0); giraRaf();
    eq('...senza un Mondo vivo: coda vuota, niente disegnato, giro fermo', [T.THQ.length, disegnate.includes('Lea|d'), arrivate.some((x) => x[0] === 'd'), T.stato().thBusy], [0, false, false, false]);
    T.vivi(1);
    T.thumbAsync('Lea', { key: 'rotta' }, (u) => arrivate.push(['rotta', u]));
    giraRaf();
    eq("...thumb() che lancia: la richiesta riceve '' e THKO si accende", [arrivate.find((x) => x[0] === 'rotta'), T.stato().THKO, T.stato().thBusy], [['rotta', ''], true, false]);
  } else nota('thumbAsync non provata (ritaglio assente o node:module.stripTypeScriptTypes mancante)');

  // riposo
  const corpoFT = metodo('frameTick');
  t('RIPOSO_MS = 20 s', /^const RIPOSO_MS = 20000;$/m.test(MONDO));
  t("frameTick: sveglio solo senza reduced motion e con l'ultimo input piu' recente di RIPOSO_MS", /const vivo = !this\.reduce && now - this\.ultimoInput < RIPOSO_MS;/.test(corpoFT));
  t('...entrando a riposo, una volta sola: posa() e un ultimo disegno', /if \(vivo\) this\.fermo = false;\s*else if \(!this\.fermo\) \{ this\.posa\(\); this\.fermo = true; this\.dirty = true; \}/.test(corpoFT));
  t('...a riposo senza niente da fare non ridisegna: solo le etichette, 4 volte al secondo',
    /if \(!attivo && \(!vivo \|\| now - this\.lastRender < 33\)\) \{[\s\S]*?if \(now - this\.lastLabels > 250\) \{ this\.lastLabels = now; this\.updateLabels\(now\); \}\s*return;\s*\}/.test(corpoFT));
  t('...fumo, braccia e Ginni si muovono solo da svegli', /\n    if \(vivo\) \{\n      this\.ginni\.position\.y = /.test(corpoFT) && !/if \(!this\.reduce\)/.test(corpoFT));
  t('posa(): Ginni a terra, schiuma ferma, fumo spento, braccia giu\'', /this\.ginni\.position\.y = 0; this\.foam\.scale\.setScalar\(1\);[\s\S]*?\.opacity = 0;[\s\S]*?\.rotation\.x = 0;/.test(metodo('posa')));
  t("sveglia(): segna l'ultimo input e chiede un disegno", /private sveglia\(\) \{ this\.ultimoInput = performance\.now\(\); this\.dirty = true; \}/.test(MONDO));
  const SVEGLIE = [
    ['tween()', /private tween\([^\n]*this\.tweens\.push\(tw\); this\.sveglia\(\); return tw; \}/],
    ['pointerdown', /const down = \(e: PointerEvent\) => \{ this\.sveglia\(\);/],
    ['wheel', /const wheel = \(e: WheelEvent\) => \{ e\.preventDefault\(\); this\.zoomBy\([^\n]*\); this\.sveglia\(\); \};/],
    ['setCtx()', /\n  setCtx\(c: Ctx\) \{ this\.ctx = c; this\.sveglia\(\); \}/],
  ];
  for (const [n, re] of SVEGLIE) t(`sveglia() da ${n}`, re.test(MONDO));
  t('sveglia() da aggiorna() (dati nuovi)', /this\.shadowDirty = true; this\.sveglia\(\);\n  \}$/.test(metodo('aggiorna')));
  // Paillettes (fase 2): i premi nuovi, la festa e il "+n" si vedono anche a isola a riposo
  t('sveglia() da setLivello(), festa() e puntiFlottanti()', /^\s*setLivello\(i: number\) \{\n[^\n]*\n    this\.sveglia\(\);/.test(metodo('setLivello'))
    && /^\s*festa\(testo\?: string\) \{\n    this\.sveglia\(\);/.test(metodo('festa')) && /\n    this\.sveglia\(\);\n  \}$/.test(metodo('puntiFlottanti')));
  eq('sveglia() chiamata in quegli 8 posti e basta', conta(MONDO, /this\.sveglia\(\)/), 8);

  // ombre
  t('Tween ha il campo facoltativo ombre', /^type Tween = \{[^}\n]*ombre\?: boolean \};$/m.test(MONDO));
  t('il tween della camera non ricalcola le ombre (ombre = false)', /this\.camTw = this\.tween\([\s\S]*?\);\n    this\.camTw\.ombre = false;\n  \}$/.test(metodo('camTween')));
  // le scintille della festa (Paillettes) non fanno ombra: anche il loro tween non le ricalcola
  t('il tween delle scintille di festa() non ricalcola le ombre (ombre = false)', /const tw = this\.tween\(1500, [\s\S]*?\n    tw\.ombre = false;\n  \}$/.test(metodo('festa')));
  eq('ombre = false solo sulla camera e sulle scintille della festa', conta(MONDO, /\.ombre = false/), 2);
  t("frameTick: ombre ricalcolate solo con shadowDirty o con un tween che non e' della camera",
    /if \(this\.shadowDirty \|\| this\.tweens\.some\(\(tw\) => tw\.ombre !== false\)\) \{ this\.renderer\.shadowMap\.needsUpdate = true; this\.shadowDirty = false; \}/.test(corpoFT));
  t('shadowMap.autoUpdate spento', /this\.renderer\.shadowMap\.autoUpdate = false;/.test(MONDO));
  const braccia = [...MONDO.matchAll(/this\.add\(arm, [^\n]*\);/g)].map((m) => m[0]);
  t(`le braccia animate (${braccia.length} pezzi) non fanno ombra`, braccia.length >= 2 && braccia.every((r) => /\{ cast: false \}\);$/.test(r)));

  // mesh fuse
  const corpoImp = metodo('impasta'), corpoWH = metodo('buildWarehouseShell'), corpoLab = metodo('buildLab'), corpoF = metodo('buildFence'), corpoD = metodo('buildDecor');
  const corpoAgg = metodo('aggiorna'), corpoAll = metodo('allestisci');
  // Paillettes (fase 2): i premi dei livelli (buildPremi) si fondono in tre gruppi: i premi a terra, la mongolfiera (si
  // muove: fusa a parte e saltata dal gruppo dei premi) e la corona (figlia di Ginni, saltella con lei)
  t('premi: impasta(premi, [pallone]), poi il pallone e la corona per conto loro',
    /this\.impasta\(this\.premi, this\.pallone \? \[this\.pallone\] : \[\]\);\n    if \(this\.pallone\) this\.impasta\(this\.pallone\);\n    this\.impasta\(this\.corona\);/.test(metodo('buildPremi')));
  eq('impasta chiamata 9 volte (erba, magazzino, capannone, staccionata, sentieri, decori, premi, mongolfiera, corona)', conta(MONDO, /this\.impasta\(/), 9);
  t('magazzino: impasta(WH, [this.whInside]) per ultima, dopo WH.add(this.whInside)', /WH\.add\(this\.whInside\);\n    this\.impasta\(WH, \[this\.whInside\]\);\n  \}$/.test(corpoWH));
  t("...whInside (le pile, rifatte a ogni aggiorna) e' l'unica parte mobile: this.wh si usa solo nel guscio", conta(MONDO, /\bthis\.wh\b/) === 1 && /this\.wh\b/.test(corpoWH) && /this\.svuota\(this\.whInside\)/.test(metodo('layoutWarehouse')));
  const saltaLab = (/this\.impasta\(g, \[([^\]]*)\]\);/.exec(corpoLab)?.[1] ?? '').split(',').map((x) => x.trim().replace(/^\.\.\./, '')).filter(Boolean).sort();
  const mobiliLab = [...(/^type LabG = \{([^}]*)\};$/m.exec(MONDO)?.[1] ?? '').matchAll(/(\w+): THREE\.(?:Group|Mesh|Object3D)(?:\[\])?;/g)].map((m) => m[1]).filter((k) => k !== 'g').sort();
  eq("capannone: impasta(g, ...) salta tutte le parti di LabG che si muovono o si rifanno", saltaLab, mobiliLab);
  eq("...cioe' personaggio, cortile, i tre slot del banco e il fumo", mobiliLab, ['ch', 'hideSlot', 'puffs', 'rollSlot', 'spoolSlot', 'yard']);
  t('...per ultima, dopo i sassi del sentiero e prima del return', /this\.stones\(CART_HOME\.x, CART_HOME\.z, dock\.x, dock\.z\);\n    this\.impasta\(g, \[[^\]]*\]\);\n    return L;\n  \}$/.test(corpoLab));
  t('staccionata: pali e assi in un gruppo F, impasta(F) per ultima', /const postGeo = box\(0\.22, 1\.0, 0\.22\), F = new THREE\.Group\(\);\s*this\.scene\.add\(F\);/.test(corpoF)
    && /\n    this\.impasta\(F\);\n  \}$/.test(corpoF) && !/this\.add\(this\.scene,/.test(corpoF));
  t("erba: le 16 chiazze in un gruppo, impasta(erba) subito dopo",
    /const erba = new THREE\.Group\(\); this\.scene\.add\(erba\);\n\s*for \(let i = 0; i < 16; i\+\+\) \{\n[^\n]*\n\s*this\.add\(erba, new THREE\.CircleGeometry[^\n]*\n\s*\}\n\s*this\.impasta\(erba\);/.test(corpoAll));
  t('sentieri: impasta(this.paths) dopo aver costruito tutti i capannoni (i sassi li mette buildLab)',
    /this\.svuota\(this\.paths\);\s*dati\.labs\.slice\(0, LAB_SLOTS\.length\)\.forEach\(\(d, i\) => this\.labs\.set\(d\.key, this\.buildLab\(d, i\)\)\);\s*this\.impasta\(this\.paths\);/.test(corpoAgg));
  eq('...i sassi si aggiungono solo da buildLab, e solo stones() scrive in this.paths', [conta(MONDO, /this\.stones\(/), conta(corpoLab, /this\.stones\(/), conta(MONDO, /this\.add\(this\.paths,/), conta(metodo('stones'), /this\.add\(this\.paths,/)], [1, 1, 1, 1]);
  t('decori: svuota(D) in testa, impasta(D) per ultima', /const D = this\.decor;\s*this\.svuota\(D\);/.test(corpoD) && /\n    this\.impasta\(D\);\n  \}$/.test(corpoD));
  t('impasta non fonde mesh InstancedMesh, con figli, multi-materiale, trasparenti o con morph',
    /m\.isMesh && !\(m as THREE\.InstancedMesh\)\.isInstancedMesh && !m\.children\.length && !Array\.isArray\(m\.material\) && !m\.material\.transparent && !m\.geometry\.morphAttributes\.position/.test(corpoImp));
  t('impasta non libera le geometrie condivise (SHARED, keep)', /tolte\.forEach\(\(g\) => \{ if \(!SHARED\.has\(g\) && !this\.keep\.has\(g\)\) g\.dispose\(\); \}\);/.test(corpoImp));

  // impasta VERA (ritagliata da mondo.ts) su un capannone finto, con il three.js vero di web/node_modules (se c'e')
  const T3 = ROOT + 'web/node_modules/three/build/three.module.js', BGU = ROOT + 'web/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
  const jsImp = existsSync(T3) && existsSync(BGU) ? await sTS(corpoImp.replace(/^  private impasta\(/, 'function impasta(')) : null;
  if (jsImp) {
    try {
      const THREE = await import(pathToFileURL(T3).href);
      const { mergeGeometries } = await import(pathToFileURL(BGU).href);
      const SHARED = new WeakSet(), keep = new WeakSet();
      const impasta = new Function('THREE', 'mergeGeometries', 'SHARED', jsImp + '\nreturn impasta;')(THREE, mergeGeometries, SHARED);
      const A = new THREE.MeshLambertMaterial({ color: 0xff0000 }), B = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
      const VETRO = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
      const scene = new THREE.Scene(), root = new THREE.Group();
      root.position.set(3, 0.5, -2); root.rotation.y = Math.PI / 4; root.userData = { kind: 'lab', key: 'Francesco (pelle)' }; scene.add(root);
      const liberate = new Set();
      const mesh = (p, geo, mat, [x, y, z], o = {}) => {
        const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (o.ry) m.rotation.y = o.ry;
        m.castShadow = o.cast !== false; m.receiveShadow = true; geo.addEventListener('dispose', () => liberate.add(geo)); p.add(m); return m;
      };
      const G = new THREE.BoxGeometry(0.5, 0.5, 0.5); keep.add(G);     // geometria del Mondo (keep)
      const S = new THREE.SphereGeometry(0.3, 8, 6); SHARED.add(S);    // geometria di una cache di modulo
      mesh(root, new THREE.BoxGeometry(1, 1, 1), A, [0, 0, 0]);
      mesh(root, new THREE.BoxGeometry(1, 2, 1), A, [2, 0, 0], { ry: 0.3 });
      mesh(root, S, A, [0, 2, 0]);
      const albero = new THREE.Group(); albero.position.set(-2, 0, 1); albero.scale.setScalar(1.5); root.add(albero);
      mesh(albero, new THREE.CylinderGeometry(0.2, 0.3, 1, 8), A, [0, 0.5, 0]);
      mesh(albero, new THREE.SphereGeometry(1, 12, 8), A, [0, 1.8, 0]);
      mesh(albero, new THREE.SphereGeometry(0.6, 12, 8), B, [0.5, 1.5, 0]);
      mesh(root, G, B, [1, 0, 2]); mesh(root, G, B, [-1, 0, 2]);
      mesh(root, new THREE.BoxGeometry(1, 0.1, 1), A, [0, 0, -2], { cast: false }); mesh(root, new THREE.BoxGeometry(1, 0.1, 1), A, [1.5, 0, -2], { cast: false });
      const v1 = mesh(root, new THREE.SphereGeometry(0.3, 8, 6), VETRO, [0, 4, 0]), v2 = mesh(root, new THREE.SphereGeometry(0.3, 8, 6), VETRO, [0, 4.5, 0]);
      const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), A, 3); root.add(inst);
      const ch = new THREE.Group(); ch.position.set(-2.4, 0.3, -1.4); root.add(ch);
      const c1 = mesh(ch, new THREE.BoxGeometry(0.3, 0.4, 0.3), A, [0, 0.2, 0]), c2 = mesh(ch, new THREE.BoxGeometry(0.3, 0.4, 0.3), A, [0.3, 0.2, 0]);
      const slot = new THREE.Group(); root.add(slot);     // vuoto ma da saltare: lo riempie fillYard
      const vuoto = new THREE.Group(); root.add(vuoto);   // vuoto e non da saltare: va via
      // parte saltata con dentro un posto vuoto (come le pile del magazzino): dal 16-10 notte impasta non ci scende piu'
      const pile = new THREE.Group(), posto = new THREE.Group(); pile.add(posto); root.add(pile);
      const meshes = () => { const a = []; root.traverse((o) => { if (o.isMesh) a.push(o); }); return a; };
      // ogni triangolo disegnato, nei punti del mondo, con materiale e ombre
      const triangoli = () => {
        scene.updateMatrixWorld(true);
        const out = [], v = new THREE.Vector3(), r = (c) => (Math.round(c * 1e5) / 1e5).toFixed(5);
        for (const o of meshes()) {
          if (o.isInstancedMesh) continue;
          const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count;
          for (let i = 0; i < n; i += 3) {
            const tri = [0, 1, 2].map((k) => { v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld); return [v.x, v.y, v.z].map(r).join(','); }).sort().join(' ');
            out.push([o.material.uuid, o.castShadow, o.receiveShadow, tri].join('|'));
          }
        }
        return out.sort();
      };
      const prima = triangoli(), nPrima = meshes().length;
      impasta.call({ keep }, root, [ch, slot, pile]);
      const dopo = triangoli();
      const diversi = (x, y) => (x.length !== y.length ? 'conteggio ' + x.length + ' -> ' + y.length : x.findIndex((s, i) => s !== y[i]));
      eq('impasta (vera): gli stessi triangoli negli stessi punti del mondo, con lo stesso materiale e le stesse ombre', diversi(prima, dopo), -1);
      eq('...mesh (draw call) sotto il capannone: 15 -> 8', [nPrima, meshes().length], [15, 8]);
      const fuse = root.children.filter((o) => o.isMesh && !o.isInstancedMesh && o !== v1 && o !== v2);
      eq('...tre mesh fuse, figlie dirette del capannone: A con ombra, A senza, B con ombra (materiali originali)',
        fuse.map((m) => [m.material === A ? 'A' : m.material === B ? 'B' : '?', m.castShadow, m.receiveShadow]).sort(), [['A', false, true], ['A', true, true], ['B', true, true]]);
      t('...le parti saltate restano com\'erano (personaggio: stesse mesh, geometrie non liberate)', ch.parent === root && ch.children.length === 2 && ch.children[0] === c1 && ch.children[1] === c2 && !liberate.has(c1.geometry) && !liberate.has(c2.geometry));
      t('...trasparenti e InstancedMesh non si fondono', v1.parent === root && v2.parent === root && inst.parent === root);
      t("...il gruppo saltato vuoto resta, quello vuoto e no va via, e cosi' l'albero svuotato", slot.parent === root && vuoto.parent === null && albero.parent === null);
      t("...e il posto vuoto DENTRO una parte saltata resta al suo posto (impasta non scende nelle parti saltate)", pile.parent === root && posto.parent === pile && pile.children.length === 1);
      eq('...liberate le 7 geometrie fuse, non quella di keep ne\' quella SHARED', [liberate.size, liberate.has(G), liberate.has(S)], [7, false, false]);
      const sopra = root.localToWorld(new THREE.Vector3(2, 0, 0)); sopra.y += 10;
      const hit = new THREE.Raycaster(sopra, new THREE.Vector3(0, -1, 0)).intersectObjects([root], true)[0];
      let k = hit?.object; while (k && !k.userData.kind) k = k.parent;
      t('...il raycast (pick) colpisce una mesh fusa e risale al capannone con userData.kind', !!hit && fuse.includes(hit.object) && k === root && k.userData.kind === 'lab');
      impasta.call({ keep }, root, [ch, slot, pile]);
      eq('...una seconda passata non cambia niente', [meshes().length, diversi(dopo, triangoli())], [8, -1]);
    } catch (e) { t('impasta su three.js vero: ' + e.message, false); }
  } else nota('impasta non provata su three.js vero (web/node_modules assente: npm ci in web/, o stripTypeScriptTypes mancante)');

  // costruttore protetto
  t("costruttore: dopo VIVI++ il resto sta in allestisci(); se lancia, dispose() e rilancia", /VIVI\+\+;\n    try \{ this\.allestisci\(\); \} catch \(e\) \{ this\.dispose\(\); throw e; \}\n  \}/.test(MONDO));
  t('...prima di VIVI++ solo il renderer: senza WebGL toglie il canvas e rilancia (VIVI non cresce)',
    /try \{\s*this\.renderer = new THREE\.WebGLRenderer\(\{ canvas, antialias: true \}\);\s*\} catch \(e\) \{\s*canvas\.remove\(\);\s*throw e;\s*\}\s*VIVI\+\+;/.test(MONDO));
  eq('VIVI++ una volta sola', conta(MONDO, /VIVI\+\+/), 1);
  const corpoDisp = metodo('dispose');
  t("dispose(): una volta sola, toglie il canvas, VIVI giu', cache liberate all'ultimo Mondo",
    /if \(this\.disposed\) return;\s*this\.disposed = true;/.test(corpoDisp) && /this\.canvas\.remove\(\);\s*VIVI = Math\.max\(0, VIVI - 1\);\s*if \(!VIVI\) liberaCache\(\);/.test(corpoDisp));
  t("allestisci(): il ciclo di disegno parte per ultimo (se un passo prima lancia non resta un requestAnimationFrame appeso)", /this\.raf = requestAnimationFrame\(loop\);\n  \}$/.test(corpoAll));
  t('la pagina: un Mondo che lancia -> noGl, niente pagina bianca', /\} catch \{ setNoGl\(true\); return; \}/.test(VIL));
  t("resize(): ricalcola portrait e il tetto del pixel ratio (1,5 in verticale, 2 altrimenti)",
    /const portrait = a < 0\.8;\s*if \(portrait !== this\.portrait\) \{ this\.portrait = portrait; this\.renderer\.setPixelRatio\(Math\.min\(window\.devicePixelRatio \|\| 1, portrait \? 1\.5 : 2\)\); \}/.test(metodo('resize')));
}

console.log('\n== cinture: interruttore app_flags.villaggio_enabled (Regola Ferrea 19, migr 0162) ==');
{
  const APP = read('web/src/App.tsx');
  t('App.tsx carica Villaggio con lazy()', /const Villaggio = lazy\(\(\) => import\('\.\/pages\/Villaggio'\)\);/.test(APP));
  t('App.tsx non importa Villaggio in modo statico (three.js resterebbe nel bundle principale)', !/^import\s+Villaggio\b/m.test(APP) && !/^import[^;]*from '\.\/pages\/Villaggio'/m.test(APP));
  // Paillettes (fase 2): il flag del Villaggio arriva con gli altri interruttori (fetchVillaggioSettings), una lettura
  t('App.tsx legge gli interruttori una volta: null finche\' non arrivano, tutto spento se la lettura fallisce',
    /const \[vil, setVil\] = useState<VillaggioSettings \| null>\(null\);/.test(APP) && /fetchVillaggioSettings\(\)\.then\(setVil\)\.catch\(\(\) => setVil\(VILLAGGIO_SPENTO\)\)/.test(APP)
    && /const vilEnabled = vil && vil\.enabled;/.test(APP) && conta(APP, /fetchVillaggioSettings\(\)/) === 1 && !/fetchVillaggioEnabled/.test(APP));
  t('URL diretto #villaggio apre la scheda', /hash\.startsWith\('#villaggio'\) \? 'villaggio'/.test(APP));
  const a = APP.indexOf("{tab === 'villaggio' &&");
  const fine = [APP.indexOf("{tab === '", a + 1), APP.indexOf('</main>', a)].filter((x) => x > a);
  const blocco = a >= 0 && fine.length ? APP.slice(a, Math.min(...fine)) : '';
  const rami = /^\{tab === 'villaggio' && \(vilEnabled\s*\?([\s\S]*?)\n\s*:([\s\S]*)$/.exec(blocco);
  t('App.tsx: la scheda villaggio sceglie su vilEnabled', !!rami);
  t('...ramo acceso: <ErrorBoundary> con <Suspense> e <Villaggio>', !!rami && /^\s*<ErrorBoundary\b[\s\S]*<Suspense\b[\s\S]*<Villaggio\b[\s\S]*<\/Suspense>[\s\S]*<\/ErrorBoundary>/.test(rami[1]));
  t("...ramo spento: nessun <Villaggio>, dice 'non attiva'", !!rami && !/<Villaggio\b/.test(rami[2]) && /non attiva/.test(rami[2]));
  eq('App.tsx: <Villaggio> compare una volta sola (solo nel ramo acceso)', conta(APP, /<Villaggio\b/), 1);
  // 16-10 sera: nell'app intera chi scrive si sceglie come in tutte le altre schede, nel Villaggio la pill e' solo da leggere
  t("App.tsx passa a <Villaggio> pin, chi, paillettes (solo se 'true' letto), giocatrice e onBack, e NON setChi (la pill 'scrive' resta da leggere)",
    /<Villaggio pin=\{pin\} chi=\{chi\} paillettes=\{vil\?\.paillettes === true\} giocatrice=\{vil\?\.giocatrice\} onBack=\{\(\) => go\('home'\)\} \/>/.test(APP) && !/<Villaggio\b[^>]*\bsetChi\b/.test(APP));
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
  // le dipendenze si leggono come insieme (Gate 2 del 17-10): il letterale andava rosso appena un altro modulo ne
  // aggiungeva una (pushEnabled delle notifiche) e non diceva niente su vilEnabled, che e' il punto del test
  const depsHome = (HOME.match(/const \{ quick, gestione, altro \} = useMemo\([\s\S]*?\}, \[([^\]]*)\]\);/)?.[1] ?? '').split(',').map((d) => d.trim());
  t('Home: il filtro si ricalcola quando il flag arriva', ['cfg', 'matEnabled', 'vilEnabled'].every((d) => depsHome.includes(d)));

  // app a se': prima il flag, poi il Villaggio
  t('VillaggioApp: interruttori null finche\' non arrivano, tutto spento se la lettura fallisce',
    /const \[cfg, setCfg\] = useState<VillaggioSettings \| null>\(null\)/.test(VAPP) && /fetchVillaggioSettings\(\)\.then\(setCfg\)\.catch\(\(\) => setCfg\(VILLAGGIO_SPENTO\)\)/.test(VAPP));
  const iNull = VAPP.indexOf('if (cfg === null) return'), iSpento = VAPP.indexOf('if (!cfg.enabled) {'), iVil = VAPP.indexOf('<Villaggio ');
  t('VillaggioApp: attesa, poi flag spento, poi (solo dopo) <Villaggio>', iNull > 0 && iSpento > iNull && iVil > iSpento && /if \(!cfg\.enabled\) \{\s*return \(/.test(VAPP));
  eq('VillaggioApp: <Villaggio> una volta sola', conta(VAPP, /<Villaggio\b/), 1);
  t('VillaggioApp: <Villaggio> dentro <ErrorBoundary>', /<ErrorBoundary titolo="Villaggio" onBack=\{home\}><Villaggio\b[^>]*\/><\/ErrorBoundary>/.test(VAPP));
  t("VillaggioApp: l'app a se' passa setChi (menu 'scrive'), paillettes e giocatrice", /<Villaggio pin="x" chi=\{chi\} setChi=\{setChi\} paillettes=\{cfg\.paillettes\} giocatrice=\{cfg\.giocatrice\} onBack=\{home\} \/>/.test(VAPP));
  t("VillaggioApp: chi scrive parte da amimi_chi (o Ginevra) e ci torna a ogni cambio, con lo storage protetto",
    /const leggiChi = \(\) => \{ try \{ return localStorage\.getItem\('amimi_chi'\) \|\| 'Ginevra' \} catch \{ return 'Ginevra' \} \}/.test(VAPP)
    && /const setChi = \(c: string\) => \{ setChiS\(c\); try \{ localStorage\.setItem\('amimi_chi', c\) \} catch \{/.test(VAPP));
  // home(): la funzione vera, ritagliata e fatta girare su un window finto (installata su Android, su iPhone, nel browser)
  const rHome = ['const installata = ', 'const home = '].map((p) => VAPP.split('\n').find((r) => r.startsWith(p)) ?? '');
  t("VillaggioApp: installata() guarda display-mode standalone e navigator.standalone (iPhone)",
    /matchMedia\('\(display-mode: standalone\)'\)\.matches \|\| \(navigator as Navigator & \{ standalone\?: boolean \}\)\.standalone === true/.test(rHome[0]));
  t("VillaggioApp: home() installata apre l'app intera con window.open in una finestra sua, altrimenti ci va",
    /if \(installata\(\)\) window\.open\(import\.meta\.env\.BASE_URL, '_blank', 'noopener'\); else window\.location\.href = import\.meta\.env\.BASE_URL/.test(rHome[1]));
  const jsHome = rHome.every(Boolean) ? await sTS(rHome.join('\n').replace(/import\.meta\.env\.BASE_URL/g, 'BASE')) : null;
  if (jsHome) {
    const prova = (standalone, iosStandalone) => {
      const log = [], win = { matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' && standalone }), open: (...a) => { log.push(['open', ...a]); return null; }, location: { href: '/amimi-app/villaggio/' } };
      new Function('window', 'navigator', 'BASE', jsHome + '\nreturn home;')(win, iosStandalone ? { standalone: true } : {}, '/amimi-app/')();
      return [log, win.location.href];
    };
    eq("home() nel browser: va all'app intera nella stessa scheda", prova(false, false), [[], '/amimi-app/']);
    eq("home() installata (Android, display-mode standalone): window.open e la finestra del Villaggio resta", prova(true, false), [[['open', '/amimi-app/', '_blank', 'noopener']], '/amimi-app/villaggio/']);
    eq("home() installata su iPhone (navigator.standalone): window.open", prova(false, true), [[['open', '/amimi-app/', '_blank', 'noopener']], '/amimi-app/villaggio/']);
  } else nota('home() di VillaggioApp non provata (righe non trovate o node:module.stripTypeScriptTypes assente)');
  const MAIN = read('web/src/villaggio-main.tsx');
  t('villaggio-main.tsx monta VillaggioApp, non Villaggio direttamente', /import VillaggioApp from '\.\/VillaggioApp\.tsx'/.test(MAIN) && /<VillaggioApp\b/.test(MAIN)
    && !/import Villaggio from/.test(MAIN) && !/<Villaggio\b/.test(MAIN));

  // fetchVillaggioSettings(): l'unica lettura degli interruttori (App e VillaggioApp; la vecchia fetchVillaggioEnabled,
  // codice morto, e' stata tolta il 17-10). La funzione vera, ritagliata da api.ts (che a livello di modulo crea il client
  // supabase) e fatta girare su un client finto. Nessuna rete.
  t('fetchVillaggioEnabled non esiste piu\' (codice morto, 17-10): nessuno la definisce ne\' la importa',
    !/fetchVillaggioEnabled/.test(API) && !/fetchVillaggioEnabled/.test(APP) && !/fetchVillaggioEnabled/.test(VAPP) && !/fetchVillaggioEnabled/.test(VIL));
  const corpoSet = ritaglia(API, 'export const VILLAGGIO_SPENTO', '\n}\n', true);
  t('api.ts definisce VILLAGGIO_SPENTO e subito dopo fetchVillaggioSettings', /\nexport async function fetchVillaggioSettings\(\)/.test(corpoSet));
  const jsSet = await sTS(corpoSet.replace(/^export /gm, ''));
  if (jsSet) {
    const fvs = new Function('supabase', jsSet + '\nreturn fetchVillaggioSettings;');
    const prova = async (risposta) => {
      const log = [];
      const sb = { from(tab) { log.push(['from', tab]); return { select: async (c) => { log.push(['select', c]); return risposta; } }; } };
      try { return { v: await fvs(sb)(), log }; } catch (e) { return { v: 'lancia: ' + e.message, log }; }
    };
    const righe = (o) => ({ data: Object.entries(o).map(([key, value]) => ({ key, value })), error: null });
    const SPENTO = { enabled: false, paillettes: false, dal: null, giocatrice: null };
    const tutte = await prova(righe({ villaggio_enabled: 'true', villaggio_paillettes_enabled: 'true', villaggio_paillettes_dal: '2026-10-17', villaggio_paillettes_chi: 'Ginevra' }));
    eq('fetchVillaggioSettings: una lettura di tutte le chiavi di v_villaggio_settings', tutte.log, [['from', 'v_villaggio_settings'], ['select', 'key,value']]);
    eq('fetchVillaggioSettings: tutto acceso', tutte.v, { enabled: true, paillettes: true, dal: '2026-10-17', giocatrice: 'Ginevra' });
    const CASI = [
      ['errore (vista assente, permesso negato): tutto spento', { data: [{ key: 'villaggio_enabled', value: 'true' }], error: { message: 'x' } }, SPENTO],
      ['errore senza righe (relazione non ancora creata in prod): tutto spento', { data: null, error: { message: 'relation "v_villaggio_settings" does not exist' } }, SPENTO],
      ['nessuna riga', { data: null, error: null }, SPENTO],
      ['lista vuota (migrazione non applicata, flag mai inserito): tutto spento', { data: [], error: null }, SPENTO],
      ['prima della 0164 (solo villaggio_enabled): Paillettes spente', righe({ villaggio_enabled: 'true' }), { enabled: true, paillettes: false, dal: null, giocatrice: null }],
      ["flag delle Paillettes 'false' (come nasce)", righe({ villaggio_enabled: 'true', villaggio_paillettes_enabled: 'false', villaggio_paillettes_chi: 'Ginevra' }), { enabled: true, paillettes: false, dal: null, giocatrice: 'Ginevra' }],
      ["flag delle Paillettes 'TRUE' o '1': spento (il server accende solo con 'true')", righe({ villaggio_enabled: 'true', villaggio_paillettes_enabled: 'TRUE' }), { enabled: true, paillettes: false, dal: null, giocatrice: null }],
      ['giocatrice vuota = nessuna', righe({ villaggio_enabled: 'true', villaggio_paillettes_enabled: 'true', villaggio_paillettes_chi: '' }), { enabled: true, paillettes: true, dal: null, giocatrice: null }],
      ['giocatrice con spazi resta com\'e\' (il server confronta il valore grezzo)', righe({ villaggio_enabled: 'true', villaggio_paillettes_enabled: 'true', villaggio_paillettes_chi: 'Ginevra ' }), { enabled: true, paillettes: true, dal: null, giocatrice: 'Ginevra ' }],
      // 17-10: paillettes e dal grezzi, come li confrontano la write-api e v_villaggio_eventi (niente trim)
      ["flag delle Paillettes ' true' (con lo spazio): spento, come per il server", righe({ villaggio_enabled: 'true', villaggio_paillettes_enabled: ' true' }), { enabled: true, paillettes: false, dal: null, giocatrice: null }],
      ["flag delle Paillettes 'true ' (spazio in coda): spento", righe({ villaggio_enabled: 'true', villaggio_paillettes_enabled: 'true ' }), { enabled: true, paillettes: false, dal: null, giocatrice: null }],
      ['dal con gli spazi resta com\'e\'', righe({ villaggio_enabled: 'true', villaggio_paillettes_dal: ' 2026-10-17 ' }), { enabled: true, paillettes: false, dal: ' 2026-10-17 ', giocatrice: null }],
    ];
    for (const [nome, risposta, atteso] of CASI) eq(`fetchVillaggioSettings: ${nome}`, (await prova(risposta)).v, atteso);
    // villaggio_enabled: gli stessi casi che provava fetchVillaggioEnabled (spazi e maiuscole, '1', il booleano jsonb)
    const VIL_ENABLED = [
      ["'true'", 'true', true], ["'false'", 'false', false], ['null', null, false], ["'boh'", 'boh', false],
      ["' TRUE ' (spazi e maiuscole)", ' TRUE ', true], ['true (booleano jsonb)', true, true], ["'1'", '1', true], ["'on'", 'on', true], ["'yes'", 'yes', true],
    ];
    for (const [nome, value, atteso] of VIL_ENABLED) eq(`fetchVillaggioSettings: villaggio_enabled ${nome} -> ${atteso}`, (await prova(righe({ villaggio_enabled: value }))).v.enabled, atteso);
  } else nota('fetchVillaggioSettings non provata su un client finto (manca il corpo o node:module.stripTypeScriptTypes)');

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
  t("api.ts legge la stessa vista e la stessa chiave della migrazione", /from\('v_villaggio_settings'\)/.test(corpoSet) && /v\.get\('villaggio_enabled'\)/.test(corpoSet));
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
  // 16-10 sera: di nuovo lo scope stretto. Con /amimi-app/ l'app del Villaggio si contendeva con l'app intera i link
  // dentro /amimi-app/ (la push di ce-guard): ora la Home, installata, apre l'app intera con window.open (VillaggioApp)
  eq('manifest: scope /amimi-app/villaggio/', man?.scope, '/amimi-app/villaggio/');
  t('manifest: start_url dentro lo scope', !!man && String(man.start_url).startsWith(String(man.scope)));
  eq('manifest: display standalone', man?.display, 'standalone');
  t("manifest: id diverso da quello dell'app intera (si installano tutte e due)", !!man && !!manApp && (manApp.id ?? manApp.start_url) !== man.id);
  eq("manifest dell'app intera: scope /amimi-app/ (invariato)", manApp?.scope, '/amimi-app/');
  t("manifest: scope del Villaggio diverso e piu' stretto di quello dell'app intera (i link dell'app restano all'app)",
    !!man && !!manApp && man.scope !== manApp.scope && String(man.scope).startsWith(String(manApp.scope)));
  for (const ic of man?.icons ?? []) t(`manifest: icona ${ic.src} esiste in web/public`, ic.src.startsWith('/amimi-app/') && existsSync(ROOT + 'web/public/' + ic.src.slice('/amimi-app/'.length)));
  // 18-10, scelta di Dan: il Villaggio ha la sua icona (il fienile sulla collina), non quella dell'app intera
  t("manifest: le icone del Villaggio sono sue (/amimi-app/villaggio/), con la maskable", !!man?.icons?.length
    && man.icons.every((ic) => ic.src.startsWith('/amimi-app/villaggio/')) && man.icons.some((ic) => ic.purpose === 'maskable'));
  t('villaggio/index.html: favicon e icona iPhone sono quelle del Villaggio', /<link rel="icon"[^>]*href="\/villaggio\/icon\.svg"/.test(HTML)
    && /<link rel="apple-touch-icon" href="\/villaggio\/apple-touch-icon-180\.png"/.test(HTML));

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
