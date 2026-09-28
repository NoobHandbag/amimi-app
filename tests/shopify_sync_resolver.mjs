// tests/shopify_sync_resolver.mjs — il resolver riga d'ordine -> CODICE di shopify-sync, ritagliato DAL SORGENTE
// che va in produzione (blocco PURE:sync-resolver): se il codice cambia, il test rompe. Nessuna rete, nessun DB.
//   node tests/shopify_sync_resolver.mjs
//
// Perche' esiste. Il 27-09 la riga #1810 (titolo "LEA BAG BAMBI PONY", SKU LEA_BAG_PONY_BAMBI) e' stata risolta
// sul doppione LEA_BAG_BAMBI_PONY perche' il titolo uguale a un codice a catalogo vinceva sullo SKU. shopify-stock
// mappa invece per SKU, quindi la vendita scalava un codice e lo stock veniva spinto dall'altro: sul sito un pezzo
// in piu' del reale. Dalla v8 lo SKU a catalogo vince sempre; il titolo resta il ripiego.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BEGIN = '// ==== PURE:sync-resolver BEGIN ====';
const END = '// ==== PURE:sync-resolver END ====';
const s = readFileSync(`${ROOT}supabase/functions/shopify-sync/index.ts`, 'utf8').replace(/\r\n/g, '\n');
const a = s.indexOf(BEGIN), b = s.indexOf(END);
if (a < 0 || b < 0) { console.error('marcatori PURE:sync-resolver non trovati in shopify-sync'); process.exit(1); }
const TMP = `${ROOT}tests/_sync_resolver.tmp.ts`;
writeFileSync(TMP, `${s.slice(a + BEGIN.length, b).trim()}\nexport { norm, resolveCodiceWith };\n`, 'utf8');
let norm, resolveCodiceWith;
try { ({ norm, resolveCodiceWith } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra) : '')); } };

const catalogo = ['LEA_BAG_PONY_BAMBI', 'LEA_BAG_BAMBI_PONY', 'LEA_BAG_ZEBRA', 'LEA_BAG_ZEBRA_PONY', 'Lea_Bag_BLACK', 'NINA_BAG_JUNGLE_GREEN'];
const codiceByNorm = new Map(catalogo.map((c) => [norm(c), c]));
const aliasMap = new Map([['LEA_BAG_ZEBRA_PONY', 'LEA_BAG_ZEBRA'], ['NINA_BAG_JUNGLE', 'NINA_BAG_JUNGLE_GREEN']]);
const r = (nm, sku) => resolveCodiceWith(aliasMap, codiceByNorm, nm, sku);

console.log('== caso Bambi (27-09) ==');
t('1  SKU LEA_BAG_PONY_BAMBI + titolo "LEA BAG BAMBI PONY" -> LEA_BAG_PONY_BAMBI (lo SKU vince sul titolo == codice)', r('LEA BAG BAMBI PONY', 'LEA_BAG_PONY_BAMBI') === 'LEA_BAG_PONY_BAMBI', r('LEA BAG BAMBI PONY', 'LEA_BAG_PONY_BAMBI'));
t('2  lo SKU vince anche sull\'alias del titolo', r('LEA BAG ZEBRA PONY', 'LEA_BAG_ZEBRA_PONY') === 'LEA_BAG_ZEBRA_PONY');
t('3  SKU in minuscolo/Title_Case: confronto case-insensitive, restituisce il codice come a catalogo', r('qualunque', 'lea_bag_black') === 'Lea_Bag_BLACK');

console.log('\n== il titolo resta il ripiego ==');
t('4  SKU vuoto -> alias del titolo', r('LEA BAG ZEBRA PONY', '') === 'LEA_BAG_ZEBRA');
t('5  SKU null (custom item) -> titolo == codice', r('LEA BAG BAMBI PONY', null) === 'LEA_BAG_BAMBI_PONY');
t('6  SKU non a catalogo -> alias del titolo', r('LEA BAG ZEBRA PONY', 'SKU_VECCHIO_123') === 'LEA_BAG_ZEBRA');
t('7  titolo con " - Senza Catena" -> alias della base', r('NINA BAG JUNGLE - Senza Catena', undefined) === 'NINA_BAG_JUNGLE_GREEN');
t('8  titolo con trattino lungo " – " -> codice della base', r('LEA BAG ZEBRA – edizione', '') === 'LEA_BAG_ZEBRA', r('LEA BAG ZEBRA – edizione', ''));
t('9  niente di niente -> null (riga non risolta, mai un codice a caso)', r('BORSA MISTERIOSA', 'XYZ') === null);
t('10 titolo undefined non esplode', r(undefined, undefined) === null);

console.log('\n== il wiring nel sorgente ==');
t('11 resolveCodice nel giro passa dal blocco puro', /const resolveCodice = \(nm: string, sku\?: string\): string \| null => resolveCodiceWith\(aliasMap, codiceByNorm, nm, sku\);/.test(s));
t('12 le righe d\'ordine chiamano resolveCodice con lo SKU della riga', /resolveCodice\(nm, it\.sku\)/.test(s));
const body = s.slice(a, b);
t('13 nel blocco lo SKU e\' controllato PRIMA dell\'alias', body.indexOf('codiceByNorm.has(ns)') > 0 && body.indexOf('codiceByNorm.has(ns)') < body.indexOf('aliasMap.has(n1)'));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
