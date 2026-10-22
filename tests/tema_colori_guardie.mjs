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
const isCss = (f) => f.endsWith('.css');
// Commenti via, stringhe intatte. Nel CSS esiste solo /* */. Nel TS/TSX le stringhe si riconoscono PRIMA dei commenti,
// altrimenti accept="image/*" apre un commento finto fino al prossimo */ (verifica Gate 3: ~400 righe saltate); // dopo
// ':' (URL) o dopo '\' (regex come /^image\//) non e' un commento.
const STR_O_COMMENTO = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|(?<![:\\/])\/\/[^\n]*/g;
const senzaCommenti = (s, css) => (css ? s.replace(/\/\*[\s\S]*?\*\//g, '') : s.replace(STR_O_COMMENTO, (m, str) => str ?? ''));

// ---- 1. palette GEEIQ ritirata ----
const RITIRATI_HEX = ['7c68fb', '5b35f2', '4c23de', 'd5d5ff', 'fc4f3f', 'c51f10', 'ffcbc6', '00bd9d', '028371', 'd8f5ec',
  'ff8614', 'c74d07', 'ffdea8', 'b380e5', 'e9dbf9', '7b3ab6', 'e6476f', 'fad1d9', 'b11f4e', '4678ec', '20acd8', '2e204d',
  '6b6580', 'faf7f2', 'ece6db', 'e3dccf', '3a2668', 'efe9ff', 'f6efff', 'ece9f6', '5c4d9c', 'efe7f7', 'b9a9df'];
const hexRgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
// tutte le 33 in forma rgb, piu' 92,53,242: il bagliore viola che il redesign di luglio aveva scritto a mano
const RITIRATI_RGB = new Set([...RITIRATI_HEX.map(hexRgb), '92,53,242']);
function ritirati(testo, css) {
  const t = senzaCommenti(testo, css).toLowerCase();
  const out = [];
  for (const h of RITIRATI_HEX) if (new RegExp(`#${h}(?:[0-9a-f]{2})?\\b`).test(t)) out.push('#' + h);   // anche #rrggbbaa
  // rgb()/rgba() a virgole o a spazi con "/ alfa" (CSS Color 4): spazi e barre diventano virgole
  const piatto = t.replace(/[\s/]+/g, ',').replace(/,+/g, ',');
  for (const m of piatto.matchAll(/rgba?\(,?(\d{1,3}),(\d{1,3}),(\d{1,3})[,)]/g)) {
    const k = `${m[1]},${m[2]},${m[3]}`;
    if (RITIRATI_RGB.has(k)) out.push(`rgb(${k})`);
  }
  return [...new Set(out)];
}
console.log('\n== 1. nessun colore GEEIQ ritirato scritto a mano in web/src ==');
check('autocontrollo: il rilevatore vede #7C68FB, rgba(46, 32, 77, .3) e ignora i commenti CSS',
  ritirati('a{color:#7C68FB;box-shadow:0 0 1px rgba(46, 32, 77, .3)} /* #fc4f3f */', true).length === 2);
check('autocontrollo: hex con alfa, rgb a spazi con "/ alfa", rgba di una tinta chiara (#d5d5ff)',
  ritirati('a{color:#7c68fb80;b:#2e204d33;box-shadow:0 1px rgb(46 32 77 / .3);c:rgba(213,213,255,.5)}', true).join(' ') === '#7c68fb #2e204d rgb(46,32,77) rgb(213,213,255)');
check('autocontrollo TSX: accept="image/*" non apre un commento, il colore dopo si vede; // e /* */ veri si tolgono',
  ritirati('<input accept="image/*"/>\n<b style={{color:\'#7c68fb\'}}/> {/* #fc4f3f */}\nconst u = \'https://x.it\'; // #00bd9d', false).join(' ') === '#7c68fb');
for (const [f, t] of Object.entries(src)) {
  if (f === TOKENS) continue;
  const r = ritirati(t, isCss(f));
  check(`${f}: nessun colore ritirato`, r.length === 0, r.join(' '));
}
check(`${TOKENS}: anche i token non usano piu' la palette GEEIQ`, ritirati(src[TOKENS], true).length === 0, ritirati(src[TOKENS], true).join(' '));

// ---- 2. ogni var(--x) e' definito o ha un fallback ----
console.log('\n== 2. ogni var(--x) usato in web/src e\' definito ==');
// definizioni: --x: in CSS e negli oggetti style, '--x': come chiave, setProperty('--x', ...)
const DEF = [/(?:^|[\s{;'"`(,])--([a-z0-9-]+)\s*:/gi, /['"]--([a-z0-9-]+)['"]\s*:/g, /setProperty\(\s*['"]--([a-z0-9-]+)/g];
const definiti = new Set();
for (const t of Object.values(src)) for (const re of DEF) for (const m of t.matchAll(re)) definiti.add(m[1]);
function nonDefiniti(testo, css, def) {
  const s = senzaCommenti(testo, css), out = [];
  for (const m of s.matchAll(/var\(\s*--([a-z0-9-]+)\s*(,)?/gi)) if (!m[2] && !def.has(m[1])) out.push('--' + m[1]);
  // nel TS/TSX il nome del token passa anche come stringa ('--interactive-tint', poi `var(${bg})`)
  if (!css) for (const m of s.matchAll(/['"`]--([a-z0-9-]+)['"`](?!\s*:)/g)) if (!def.has(m[1])) out.push('--' + m[1]);
  return [...new Set(out)];
}
check('autocontrollo: var(--non-esiste) e\' visto, var(--x, red) col fallback no',
  nonDefiniti('a{color:var(--non-esiste);b:var(--x, red)}', true, new Set()).join() === '--non-esiste');
check('autocontrollo TSX: il nome passato come stringa (\'--non-esiste\') e\' visto, \'--def\': definito no',
  nonDefiniti("const TC = { a: ['--non-esiste'] }; el.style.setProperty('--def', 'x'); const o = { '--def': 1 };", false, new Set(['def'])).join() === '--non-esiste');
for (const [f, t] of Object.entries(src)) {
  const n = nonDefiniti(t, isCss(f), definiti);
  check(`${f}: tutti i var() risolvono`, n.length === 0, n.join(' '));
}

// ---- 3. --amimi-* solo in tokens.css ----
console.log('\n== 3. la palette --amimi-* si usa solo in tokens.css ==');
for (const [f, t] of Object.entries(src)) {
  if (f === TOKENS) continue;
  check(`${f}: nessun --amimi-*`, !/--amimi-/.test(senzaCommenti(t, isCss(f))));
}

// ---- 4. token compositi dove valgono ----
console.log('\n== 4. --thumb-bg solo in background, --e2 solo come box-shadow intero ==');
function maluso(testo, css) {
  const out = [];
  for (const m of senzaCommenti(testo, css).matchAll(/([a-zA-Z-]+)\s*:\s*['"]?([^;'"\n}]*var\(--(thumb-bg|e2)\)[^;'"\n}]*)/g)) {
    const prop = m[1].toLowerCase().replace(/-/g, ''), val = m[2].trim(), tok = m[3];   // background-image = backgroundImage
    if (tok === 'thumb-bg' && !['background', 'backgroundimage'].includes(prop)) out.push(`${m[1]}: ${val}`);
    if (tok === 'e2' && !(prop === 'boxshadow' && val === 'var(--e2)')) out.push(`${m[1]}: ${val}`);
  }
  return out;
}
check('autocontrollo: background-color: var(--thumb-bg) e box-shadow: 0 1px var(--e2) sono visti',
  maluso('a{background-color: var(--thumb-bg); box-shadow: 0 1px var(--e2)} b{background: var(--thumb-bg) center/cover; box-shadow: var(--e2)}', true).length === 2);
for (const [f, t] of Object.entries(src)) {
  const m = maluso(t, isCss(f));
  check(`${f}: token compositi usati bene`, m.length === 0, m.join(' | '));
}

// ---- 5. predeploy contro il progetto finto ----
console.log('\n== 5. il predeploy rifiuta il progetto Supabase finto ==');
const guard = readFileSync(join(ROOT, 'web', 'scripts', 'check-bundle-env.mjs'), 'utf8');
check('check-bundle-env: host confrontato col progetto vero', /HOST_PROD\s*=\s*'imszbjeyplaiovylhkgl\.supabase\.co'/.test(guard) && /host\s*!==\s*HOST_PROD/.test(guard));
check('check-bundle-env: bundle col progetto finto fermato', /includes\('e2e-progetto-finto'\)\)\)\s*stop\(/.test(guard));

// ---- 6. contrasti dei token (Gate 2 del tema A "Contrasto", 21-10): testo 4,5:1, oggetti grafici 3:1 ----
// La palette si ritocca a mano: senza questo controllo un grigio o un rosso possono scendere sotto la soglia in silenzio
// (il 21-10 erano tre: grigio secondario sul grigio dei selettori, rosso e verde sulle loro tinte).
console.log('\n== 6. contrasti minimi dei token di tokens.css ==');
const rawTok = {};
for (const m of senzaCommenti(src[TOKENS], true).matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) if (!(m[1] in rawTok)) rawTok[m[1]] = m[2].trim();
function risolvi(v, prof = 0) {
  const m = /^var\(--([a-z0-9-]+)\)$/.exec(v);
  if (m) return prof < 10 && rawTok[m[1]] != null ? risolvi(rawTok[m[1]], prof + 1) : null;
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
}
const coloreDi = (t) => (t.startsWith('#') ? t : risolvi(`var(--${t})`));
const lumi = (hex) => [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
  .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrasto = (a, b) => { const [x, y] = [lumi(a), lumi(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
check('autocontrollo: #777777 su bianco sta sotto 4,5:1, #767676 no', contrasto('#777777', '#ffffff') < 4.5 && contrasto('#767676', '#ffffff') >= 4.5);
const COPPIE = [
  ['ink', 'bg', 4.5], ['ink', 'surface', 4.5], ['ink-muted', 'bg', 4.5], ['ink-muted', 'surface', 4.5], ['ink-muted', 'surface-alt', 4.5],
  ['#ffffff', 'interactive', 4.5], ['interactive', 'surface', 4.5], ['interactive-700', 'interactive-tint', 4.5],
  ['positive', 'positive-tint', 4.5], ['negative', 'negative-tint', 4.5], ['negative', 'bg', 4.5], ['warning-700', 'warning-tint', 4.5],
  ['positive-700', 'positive-tint', 4.5], ['negative-700', 'negative-tint', 4.5], ['ink', 'interactive-on-dark', 4.5],
  ['chart-bar', 'surface', 3], ['chart-current', 'surface', 3],
  // cornice 2 (22-10): sulla card scura testo ed esiti solo con questi (piu' il bianco), a 4,5:1 come testo;
  // --interactive-on-dark sul nero e' gia' la coppia ink/interactive-on-dark qui sopra (il contrasto e' simmetrico)
  ['warning-on-dark', 'ink', 4.5], ['negative-on-dark', 'ink', 4.5], ['ink-faint', 'ink', 4.5],
  // cornice 2, Gate 3: l'anello arancio di .mat-low (oggetto grafico, 3:1) sulla sua tinta e sulle superfici dove sta il campo,
  // e il segnaposto grigio dentro un campo a confidenza bassa
  ['warning', 'warning-tint', 3], ['warning', 'surface', 3], ['warning', 'surface-alt', 3], ['ink-muted', 'warning-tint', 4.5],
  // cornice 3 (22-10): i segni dei grafici del Cruscotto (--ink online e utile, --ink-muted B2B, --chart-bar) e l'icona
  // dell'azione tonda sul bianco non hanno coppie nuove: --ink e --ink-muted su --surface sono gia' nella prima riga a
  // 4,5:1, piu' severa del 3:1, e --chart-bar e' sopra. Che i segni usino davvero quei token lo dice la sezione 8
];
for (const [fg, bgk, min] of COPPIE) {
  const a = coloreDi(fg), b = coloreDi(bgk);
  if (!a || !b) { check(`${fg} su ${bgk}: token risolti`, false, `${fg}=${a} ${bgk}=${b}`); continue; }
  const r = contrasto(a, b);
  check(`${fg} su ${bgk}: ${r.toFixed(2)}:1 >= ${min}`, r >= min, `${a} su ${b}`);
}

// ---- 7. cornice 2 (Gate 3, 22-10): colori sulla card scura e stati dei campi che non devono sparire ----
// Le coppie della sezione 6 dicono solo che i token on-dark reggono sul nero: qui si controlla che le regole CSS della card
// scura (.hero, .ds-hero) usino davvero solo quelli. --negative (3,40:1) o --negative-tint sul nero passerebbero la sezione 6.
console.log('\n== 7. card scura e stati della cornice ==');
const SCURO_OK = new Set(['#fff', '#ffffff', 'var(--surface)', 'var(--warning-on-dark)', 'var(--negative-on-dark)',
  'var(--ink-faint)', 'var(--interactive-on-dark)', 'inherit', 'currentcolor']);
function coloriSulloScuro(testo) {
  const out = [];
  for (const m of senzaCommenti(testo, true).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\.(?:ds-)?hero(?![\w-])/.test(m[1])) continue;
    for (const d of m[2].matchAll(/(?<![\w-])color\s*:\s*([^;]+)/g)) {
      const v = d[1].replace(/!important/i, '').trim().toLowerCase();
      if (!SCURO_OK.has(v)) out.push(`${m[1].trim()} { color: ${v} }`);
    }
  }
  return out;
}
check('autocontrollo: color: var(--negative) sul KPI scuro e\' visto (anche dentro @media); var(--surface), #fff e background-color no',
  coloriSulloScuro('.ds-kpi.hero .v{color:var(--surface)} .ds-hero{color:#fff;background-color:var(--negative)} @media (x){.ds-kpi.hero.neg .v{color:var(--negative) !important}} .heros{color:red}')
    .join() === '.ds-kpi.hero.neg .v { color: var(--negative) }');
for (const [f, t] of Object.entries(src)) {
  if (!isCss(f)) continue;
  const o = coloriSulloScuro(t);
  check(`${f}: sulla card scura solo bianco e colori on-dark`, o.length === 0, o.join(' | '));
}
const SHELL = senzaCommenti(src['styles/shell.css'] ?? '', true);
const regoleShell = [...SHELL.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
// i campi del kit non hanno bordo: .mat-low (index.css) ridipinge solo border-color, quindi serve un anello che non dipende dal bordo
check('shell.css: un campo a confidenza bassa (.mat-low) ha l\'anello interno arancio',
  regoleShell.some(([s, d]) => /\.mat-low/.test(s) && /\binput\b/.test(s) && /box-shadow\s*:\s*inset[^;]*var\(--warning\)/.test(d)));
check('shell.css: il segnaposto dei campi del kit e\' --ink-muted (non il grigio del browser, 3,9:1 sul grigio)',
  regoleShell.some(([s, d]) => /input\.txt/.test(s) && /::placeholder/.test(s) && /(?<![\w-])color\s*:\s*var\(--ink-muted\)/.test(d)));

// ---- 8. grafici del Cruscotto (cornice 3, 22-10): ogni segno regge 3:1 sul bianco della card ----
// La sezione 6 dice solo che i token reggono: qui si guarda che i segni usino davvero token che reggono. Un ritorno della
// barra B2B a --ink-faint (2,50:1 sul bianco, quasi uguale all'offline) passava tutte le altre guardie.
console.log('\n== 8. grafici del Cruscotto: segni a 3:1 sul bianco ==');
const SEGNO = /\.ds-ch-(?:on|of|b2)(?![\w-])|\.ds-tbar(?![\w-])|\.ds-bars \.b(?![\w-])/;
function segniGrafici(css, tsx) {
  const out = [];
  for (const m of senzaCommenti(css, true).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!SEGNO.test(m[1])) continue;
    for (const d of m[2].matchAll(/(?<![\w-])background(?:-color)?\s*:\s*([^;]+)/g)) out.push([m[1].trim(), d[1].trim()]);
  }
  // l'imbuto passa il colore a funnelRow(...) come stringa 'var(--x)'
  for (const m of senzaCommenti(tsx, false).matchAll(/funnelRow\([^\n]*?'(var\(--[a-z0-9-]+\))'\)/g)) out.push(['funnelRow', m[1]]);
  return out;
}
const sottoSoglia = (segni) => segni.filter(([, v]) => { const c = /^var\(--[a-z0-9-]+\)$/.test(v) ? risolvi(v) : null; return !c || contrasto(c, coloreDi('surface')) < 3; });
const finti = segniGrafici('.scr-crusc .ds-ch-b2 { background: var(--ink-faint); } .ds-chbar { background: var(--ink-faint) } @media print { .ds-tbar.cur { background: red } }',
  "{funnelRow('MC2', null, 1, 1, 'var(--ink-faint)')}");
check('autocontrollo: --ink-faint su una barra dei canali e nell\'imbuto, un colore non da token sul trend: 3 sotto soglia; .ds-chbar (la traccia) non e\' un segno',
  finti.length === 3 && sottoSoglia(finti).length === 3);
const segniCss = Object.entries(src).filter(([f]) => isCss(f)).flatMap(([f, t]) => segniGrafici(t, '').map(([s, v]) => [`${f}: ${s}`, v]));
const segniImbuto = segniGrafici('', src['pages/Report.tsx'] ?? '');
check('i segni si trovano: barre dei canali (online, offline, B2B) in cruscotto.css e i quattro colori dell\'imbuto in Report.tsx',
  ['on', 'of', 'b2'].every((k) => segniCss.some(([s]) => s.startsWith('styles/screens/cruscotto.css') && s.includes(`.ds-ch-${k}`))) && segniImbuto.length === 4,
  `canali ${segniCss.length}, imbuto ${segniImbuto.length}`);
for (const [s, v] of [...segniCss, ...segniImbuto]) {
  const c = /^var\(--[a-z0-9-]+\)$/.test(v) ? risolvi(v) : null;
  check(`${s}: ${v} ${c ? contrasto(c, coloreDi('surface')).toFixed(2) + ':1' : 'non risolto'} >= 3 sul bianco`, sottoSoglia([[s, v]]).length === 0);
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
