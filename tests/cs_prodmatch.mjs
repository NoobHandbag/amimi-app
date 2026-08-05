// tests/cs_prodmatch.mjs — il MATCH del prodotto citato dalla cliente, ritagliato DAL SORGENTE che
// va in produzione (blocco PURE:cs-matchprod di cs-assist): se il codice cambia, il test rompe.
// Nessuna rete, nessun database.
//   node tests/cs_prodmatch.mjs
//
// Perche' esiste. Il 2026-08-04 l'owner ha segnalato che a "E quella verde invece?" il tool
// rispondeva con UNA bozza sola, che dava la verde per esaurita. Non era un difetto di UX ma di
// correttezza: basta che esista un'altra variante verde disponibile e la frase mandata alla
// cliente e' falsa. Le cause erano DUE e distinte, misurate sui dati veri:
//   (A) il catalogo e' scritto in inglese e le clienti scrivono in italiano: "verde" non ha MAI
//       combaciato con GREEN, quindi le tre Lea Bag verdi non prendevano un solo punto di
//       variante e vinceva LEA_BAG_CAVALLINO_VERDE_KAKI, l'unica scritta in italiano per caso;
//   (B) tutte le altre Lea Bag combaciavano per il solo nome del modello e restavano a pari
//       merito: le quattro mostrate uscivano nell'ordine di lettura del DB, cioe' a caso.
//
// I codici e le giacenze delle fixture sono quelli VERI del 2026-08-04 (query su v_inventory): il
// caso che ha aperto il brief si replica qui senza toccare la produzione.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = `${ROOT}supabase/functions/cs-assist/index.ts`;
const BEGIN = '// ==== PURE:cs-matchprod BEGIN ====';
const END = '// ==== PURE:cs-matchprod END ====';

const s = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const a = s.indexOf(BEGIN), b = s.indexOf(END);
if (a < 0 || b < 0) { console.error('blocco PURE:cs-matchprod non trovato in cs-assist'); process.exit(1); }
const blocco = s.slice(a + BEGIN.length, b)
  .replace(/^type Cand = .*$/m, '')            // i tipi non servono a runtime
  .replace(/: Record<string, string\[\]>/g, '')
  .replace(/<T extends Cand>/g, '')
  .replace(/\(scored: T\[\], max = 4\): T\[\]/g, '(scored, max = 4)')
  .replace(/\(tw: Set<string>\): Set<string>/g, '(tw)')
  .replace(/\(c: Cand\)/g, '(c)')
  .replace(/const SOLO_MODELLO = 2;/, 'const SOLO_MODELLO = 2;');
const tmp = `${ROOT}tests/.tmp_matchprod.mjs`;
writeFileSync(tmp, blocco + '\nexport { SYN, espandiSinonimi, ordinaCandidati, SOLO_MODELLO };\n');
const M = await import(pathToFileURL(tmp).href);
unlinkSync(tmp);

let ok = 0, ko = 0;
const t = (name, cond) => { if (cond) { ok++; console.log('  ok  ' + name); } else { ko++; console.log('  KO  ' + name); } };

console.log('== ponte lessicale italiano -> catalogo ==');
t('1 "verde" porta a GREEN (la causa A del brief)', M.espandiSinonimi(new Set(['verde'])).has('green'));
t('2 e regge nel verso opposto: "green" porta a verde', M.espandiSinonimi(new Set(['green'])).has('verde'));
t('3 le parole originali non si perdono mai', (() => { const o = M.espandiSinonimi(new Set(['verde', 'lea'])); return o.has('verde') && o.has('lea'); })());
t('4 una parola fuori mappa passa intatta e NON inventa sinonimi', (() => { const o = M.espandiSinonimi(new Set(['pizza'])); return o.size === 1 && o.has('pizza'); })());
t('5 il turchese aggancia il refuso VERO del catalogo (turqoise)', M.espandiSinonimi(new Set(['turchese'])).has('turqoise'));
t('6 nessun sinonimo verso parole che il catalogo non usa (oro, argento)', !M.SYN.oro && !M.SYN.argento);

// Il caso reale. Punteggi come li calcola matchProducts: modelHit 2, ogni parola di variante +3.
// "E quella verde invece?" su un thread il cui oggetto e' "Disponibilita' lea bag":
// tutte le Lea Bag prendono 'lea' (2); quelle con GREEN/VERDE nella variante prendono anche +3.
const P = (codice, disponibili, on_shopify) => ({ codice, disponibili, on_shopify, pari: false });
const CASO_VERDE = [
  { p: P('LEA_BAG_COCCO_GREEN', 0, true), score: 5 },
  { p: P('LEA_BAG_TOASTED_LEATHER_GREEN', 3, false), score: 5 },
  { p: P('LEA_BAG_KAKI_GREEN_PONY', 1, false), score: 5 },
  { p: P('LEA_BAG_CAVALLINO_VERDE_KAKI', 0, false), score: 5 },
  { p: P('LEA_BAG_GREEN', 0, false), score: 5 },
  { p: P('LEA_BAG_MAXI', 0, false), score: 2 },              // il fratello che usciva a caso
  { p: P('LEA_BAG_COCCO_BLACK', 2, true), score: 2 },
];

console.log('\n== il caso che ha aperto il brief: "E quella verde invece?" ==');
const out = M.ordinaCandidati(CASO_VERDE.map((x) => ({ ...x, p: { ...x.p } })));
t('7 i fratelli solo-modello spariscono (via LEA_BAG_MAXI, che con la domanda non c\'entra)',
  !out.some((x) => x.p.codice === 'LEA_BAG_MAXI' || x.p.codice === 'LEA_BAG_COCCO_BLACK'));
t('8 restano solo candidati con un segnale di variante vero', out.every((x) => x.score > M.SOLO_MODELLO));
t('9 AMBIGUO: piu' + ' di un candidato a pari merito in cima', out.filter((x) => x.p.pari).length >= 2);
t('10 in cima cio\' che si puo\' davvero comprare (a catalogo E disponibile)', (() => {
  const vend = [{ p: P('LEA_BAG_COCCO_GREEN', 4, true), score: 5 }, { p: P('LEA_BAG_TOASTED_LEATHER_GREEN', 3, false), score: 5 }];
  return M.ordinaCandidati(vend)[0].p.codice === 'LEA_BAG_COCCO_GREEN';
})());
t('11 a parita\' di vendibilita\' vince la giacenza piu\' alta', (() => {
  const o = M.ordinaCandidati([{ p: P('B_UNO', 1, false), score: 5 }, { p: P('A_TRE', 3, false), score: 5 }]);
  return o[0].p.codice === 'A_TRE';
})());
t('12 e a parita\' piena l\'ordine e\' STABILE (due giri, stessa lista)', (() => {
  const mk = () => [{ p: P('ZZZ', 0, false), score: 5 }, { p: P('AAA', 0, false), score: 5 }];
  return JSON.stringify(M.ordinaCandidati(mk()).map((x) => x.p.codice)) === JSON.stringify(M.ordinaCandidati(mk()).map((x) => x.p.codice))
    && M.ordinaCandidati(mk())[0].p.codice === 'AAA';
})());
t('13 il flag pari marca TUTTI quelli a pari merito, anche oltre il taglio a 4', (() => {
  const many = CASO_VERDE.filter((x) => x.score === 5).map((x) => ({ ...x, p: { ...x.p } }));
  M.ordinaCandidati(many, 4);
  return many.filter((x) => x.p.pari).length === 5;
})());

// La guardia opposta, che vale quanto le altre: uno scarto troppo aggressivo lascerebbe la bozza
// senza NESSUN prodotto proprio quando il modello era l'unica cosa che sapevamo.
console.log('\n== guardia opposta: mai svuotare la lista ==');
t('14 se NIENTE identifica la variante, i fratelli solo-modello restano', (() => {
  const soloModello = [{ p: P('LEA_BAG_COCCO_BLACK', 2, true), score: 2 }, { p: P('LEA_BAG_MAXI', 0, false), score: 2 }];
  return M.ordinaCandidati(soloModello).length === 2;
})());
t('15 e in quel caso l\'ambiguita\' scatta lo stesso (sono a pari merito)', (() => {
  const soloModello = [{ p: P('LEA_BAG_COCCO_BLACK', 2, true), score: 2 }, { p: P('LEA_BAG_MAXI', 0, false), score: 2 }];
  return M.ordinaCandidati(soloModello).filter((x) => x.p.pari).length === 2;
})());
t('16 un solo candidato NON e\' ambiguo (la bozza resta una, come deve)', (() => {
  const uno = [{ p: P('LEA_BAG_COCCO_GREEN', 0, true), score: 5 }, { p: P('LEA_BAG_MAXI', 0, false), score: 2 }];
  const o = M.ordinaCandidati(uno);
  return o.length === 1 && o.filter((x) => x.p.pari).length === 1;
})());
t('17 lista vuota non esplode', M.ordinaCandidati([]).length === 0);
t('18 l\'ordine dell\'ordine verificato (score 10+) batte tutto e spegne l\'ambiguita\'', (() => {
  const conOrdine = [{ p: P('MARIA_BAG_ICE_BLUE_PIERCING', 0, true), score: 12 }, { p: P('LEA_BAG_COCCO_GREEN', 0, true), score: 5 }];
  const o = M.ordinaCandidati(conOrdine);
  return o[0].p.codice === 'MARIA_BAG_ICE_BLUE_PIERCING' && o.filter((x) => x.p.pari).length === 1;
})());

console.log(`\n${ok}/${ok + ko} verdi` + (ko ? ` — ${ko} ROSSI` : ''));
process.exitCode = ko ? 1 : 0;
