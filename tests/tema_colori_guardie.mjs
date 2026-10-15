// tests/tema_colori_guardie.mjs: il tema Amimì (fasi 0 e 1, 15-10) tiene i colori nei token. Guardie sul sorgente:
//   1. nessun colore della palette GEEIQ ritirata (viola, coral, emerald, arancio, Dark Amethyst, lavanda...) torna
//      scritto a mano in web/src: la palette vive SOLO in web/src/styles/tokens.css (gate 2 fase 0, rilievo 1);
//   2. ogni var(--x) usato in web/src e' definito da qualche parte (o ha un fallback): un token rinominato o
//      scritto male non da' errore, l'elemento perde il colore in silenzio;
//   3. i nomi --amimi-* (la palette) si usano solo in tokens.css: i componenti passano dai token di ruolo;
//   4. --thumb-bg (gradiente) e --e2 (ombra intera) stanno solo dove valgono: background abbreviato e box-shadow;
//   5. il predeploy (web/scripts/check-bundle-env.mjs) rifiuta un bundle verso il progetto Supabase finto degli e2e.
// Autocontrollo: ogni rilevatore deve vedere un caso piantato apposta.
//   node tests/tema_colori_guardie.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'web', 'src');
let ok = 0, ko = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ok  ' + name); }
  else { ko++; console.log('  KO  ' + name + (extra ? '\n      ' + extra : '')); }
};

const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|tsx?|mjs)$/.test(n)) files.push(p);
  }
})(SRC);
const rel = (p) => relative(SRC, p).replace(/\\/g, '/');
const TOKENS = 'styles/tokens.css';
const src = Object.fromEntries(files.map((p) => [rel(p), readFileSync(p, 'utf8')]));
const senzaCommenti = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// ---- 1. palette GEEIQ ritirata ----
const RITIRATI_HEX = ['7c68fb', '5b35f2', '4c23de', 'd5d5ff', 'fc4f3f', 'c51f10', 'ffcbc6', '00bd9d', '028371', 'd8f5ec',
  'ff8614', 'c74d07', 'ffdea8', 'b380e5', 'e9dbf9', '7b3ab6', 'e6476f', 'fad1d9', 'b11f4e', '4678ec', '20acd8', '2e204d',
  '6b6580', 'faf7f2', 'ece6db', 'e3dccf', '3a2668', 'efe9ff', 'f6efff', 'ece9f6', '5c4d9c', 'efe7f7', 'b9a9df'];
const RITIRATI_RGB = ['124,104,251', '92,53,242', '76,35,222', '252,79,63', '0,189,157', '255,134,20', '46,32,77', '179,128,229', '230,71,111'];
function ritirati(testo) {
  const t = senzaCommenti(testo).toLowerCase();
  const out = [];
  for (const h of RITIRATI_HEX) if (new RegExp(`#${h}\\b`).test(t)) out.push('#' + h);
  const rgb = t.replace(/\s+/g, '');
  for (const r of RITIRATI_RGB) if (rgb.includes(`rgba(${r},`) || rgb.includes(`rgb(${r})`)) out.push(`rgb(${r})`);
  return out;
}
console.log('\n== 1. nessun colore GEEIQ ritirato scritto a mano in web/src ==');
check('autocontrollo: il rilevatore vede #7C68FB, rgba(46, 32, 77, .3) e ignora i commenti',
  ritirati('a{color:#7C68FB;box-shadow:0 0 1px rgba(46, 32, 77, .3)} /* #fc4f3f */').length === 2);
for (const [f, t] of Object.entries(src)) {
  if (f === TOKENS) continue;
  const r = ritirati(t);
  check(`${f}: nessun colore ritirato`, r.length === 0, r.join(' '));
}
check(`${TOKENS}: anche i token non usano piu' la palette GEEIQ`, ritirati(src[TOKENS]).length === 0, ritirati(src[TOKENS]).join(' '));

// ---- 2. ogni var(--x) e' definito o ha un fallback ----
console.log('\n== 2. ogni var(--x) usato in web/src e\' definito ==');
const definiti = new Set();
for (const t of Object.values(src)) for (const m of t.matchAll(/(?:^|[\s{;'"`(,])--([a-z0-9-]+)\s*:/gi)) definiti.add(m[1]);
function nonDefiniti(testo, def) {
  const out = [];
  for (const m of senzaCommenti(testo).matchAll(/var\(\s*--([a-z0-9-]+)\s*(,)?/gi)) if (!m[2] && !def.has(m[1])) out.push('--' + m[1]);
  return [...new Set(out)];
}
check('autocontrollo: var(--non-esiste) e\' visto, var(--x, red) col fallback no',
  nonDefiniti('a{color:var(--non-esiste);b:var(--x, red)}', new Set()).join() === '--non-esiste');
for (const [f, t] of Object.entries(src)) {
  const n = nonDefiniti(t, definiti);
  check(`${f}: tutti i var() risolvono`, n.length === 0, n.join(' '));
}

// ---- 3. --amimi-* solo in tokens.css ----
console.log('\n== 3. la palette --amimi-* si usa solo in tokens.css ==');
for (const [f, t] of Object.entries(src)) {
  if (f === TOKENS) continue;
  check(`${f}: nessun --amimi-*`, !/--amimi-/.test(senzaCommenti(t)));
}

// ---- 4. token compositi dove valgono ----
console.log('\n== 4. --thumb-bg solo in background, --e2 solo come box-shadow intero ==');
function maluso(testo) {
  const out = [];
  for (const m of senzaCommenti(testo).matchAll(/([a-zA-Z-]+)\s*:\s*['"]?([^;'"\n}]*var\(--(thumb-bg|e2)\)[^;'"\n}]*)/g)) {
    const prop = m[1].toLowerCase().replace(/-/g, ''), val = m[2].trim(), tok = m[3];   // background-image = backgroundImage
    if (tok === 'thumb-bg' && !['background', 'backgroundimage'].includes(prop)) out.push(`${m[1]}: ${val}`);
    if (tok === 'e2' && !(prop === 'boxshadow' && val === 'var(--e2)')) out.push(`${m[1]}: ${val}`);
  }
  return out;
}
check('autocontrollo: background-color: var(--thumb-bg) e box-shadow: 0 1px var(--e2) sono visti',
  maluso('a{background-color: var(--thumb-bg); box-shadow: 0 1px var(--e2)} b{background: var(--thumb-bg) center/cover; box-shadow: var(--e2)}').length === 2);
for (const [f, t] of Object.entries(src)) {
  const m = maluso(t);
  check(`${f}: token compositi usati bene`, m.length === 0, m.join(' | '));
}

// ---- 5. predeploy contro il progetto finto ----
console.log('\n== 5. il predeploy rifiuta il progetto Supabase finto ==');
const guard = readFileSync(join(ROOT, 'web', 'scripts', 'check-bundle-env.mjs'), 'utf8');
check('check-bundle-env: host confrontato col progetto vero', /HOST_PROD\s*=\s*'imszbjeyplaiovylhkgl\.supabase\.co'/.test(guard) && /host\s*!==\s*HOST_PROD/.test(guard));
check('check-bundle-env: bundle col progetto finto fermato', /includes\('e2e-progetto-finto'\)\)\)\s*stop\(/.test(guard));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
