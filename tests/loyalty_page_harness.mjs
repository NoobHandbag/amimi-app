// tests/loyalty_page_harness.mjs: banco di prova locale della pagina Area Membri (nessuna chiamata alla produzione).
//   node tests/loyalty_page_harness.mjs <cartella di uscita>
//   poi servire la cartella (es. python -m http.server 8765 --directory <cartella>) e aprire:
//     /run.html                      tutte le prove automatiche (esito in pagina: "N ok, M KO")
//     /index.html?s=<scenario>       la pagina con il server finto (scenari in tests/loyalty_page_mock.js)
//     /index.html?s=evento_ok&evento=GALLIANO22   il giro del QR
// La pagina e' quella VERA (src/index.html + src/mimi.webp, come la compila build.mjs): cambia solo fetch(), che
// tests/loyalty_page_mock.js sostituisce per /apps/premia/*. Le foto delle borse arrivano dal CDN Shopify: serve rete.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const out = process.argv[2];
if (!out) { console.error('uso: node tests/loyalty_page_harness.mjs <cartella di uscita>'); process.exit(1); }

const SRC = ROOT + 'supabase/functions/loyalty-page/src/';
const TOKEN = '__MIMI_DATA_URI__';
let html = readFileSync(SRC + 'index.html', 'utf8').replace(/\r\n/g, '\n');
if (html.split(TOKEN).length !== 2) { console.error('segnaposto ' + TOKEN + ' non trovato una volta sola'); process.exit(1); }
html = html.replace(TOKEN, 'data:image/webp;base64,' + readFileSync(SRC + 'mimi.webp').toString('base64'));
if (html.split('<body>').length !== 2) { console.error('<body> non trovato una volta sola'); process.exit(1); }
const mock = readFileSync(ROOT + 'tests/loyalty_page_mock.js', 'utf8');
html = html.replace('<body>', '<body>\n<script>\n' + mock + '\n</script>');

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), html);
copyFileSync(ROOT + 'tests/loyalty_page_runner.html', join(out, 'run.html'));
console.log('banco di prova scritto in ' + out + ' (index.html ' + html.length + ' byte, run.html)');
