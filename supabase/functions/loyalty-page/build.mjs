// supabase/functions/loyalty-page/build.mjs — genera index.ts (la edge) dalle sorgenti in src/.
//   node supabase/functions/loyalty-page/build.mjs           scrive index.ts
//   node supabase/functions/loyalty-page/build.mjs --check   exit 1 se index.ts non corrisponde a src (Gate 1)
//
// Perche' esiste: l'App Proxy Shopify serve come text/plain (con nosniff) tutto cio' che NON e'
// Content-Type application/liquid. Per rendere la pagina come HTML va avvolta in
// {% layout none %}{% raw %}...{% endraw %} e servita come application/liquid: Shopify la rende
// standalone (senza tema) e la restituisce al browser come text/html. Il markup resta verbatim.
// index.ts e' un file GENERATO: non modificarlo a mano, modificare le sorgenti e rilanciare il build.
//
// Due pagine dal 2026-10-11 (call del 09-10):
//   src/index.html     la pagina NUOVA (punti Mimi' e percorso), servita con ?v=2
//   src/index.v1.html  la pagina di prima (tessera a timbri e livelli), servita senza parametri: e' il rollback
// Quale delle due arriva alla cliente lo decide loyalty-proxy (rotta /club: ?anteprima=1 o flag loyalty_page_v2).
// Quando la nuova e' stabile: togliere index.v1.html, BODY_V1 e il parametro.
// Il sorgente di design della pagina nuova vive anche in Cowork12/projects/Premia_Area_Membri_2026-09/PROD/index.html:
// i due file devono restare identici (copiare la' dopo ogni modifica).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const MIMI_TOKEN = '__MIMI_DATA_URI__';   // segnaposto nella costante MIMI di src/index.html: qui diventa src/mimi.webp in base64
const fail = (msg) => { console.error('loyalty-page: ' + msg); process.exit(1); };
const wrap = (file, withMimi) => {
  let html = readFileSync(DIR + 'src/' + file, 'utf8').replace(/\r\n/g, '\n');
  if (withMimi) {
    if (html.split(MIMI_TOKEN).length !== 2) fail(file + ' deve contenere il segnaposto ' + MIMI_TOKEN + ' una volta sola');
    html = html.replace(MIMI_TOKEN, 'data:image/webp;base64,' + readFileSync(DIR + 'src/mimi.webp').toString('base64'));
  }
  if (html.includes('{% endraw %}')) fail(file + ' contiene {% endraw %}, la pagina si romperebbe');
  return '{% layout none %}{% raw %}' + html + '{% endraw %}';
};
const body = wrap('index.html', true);
const bodyV1 = wrap('index.v1.html', false);
const out = [
  '// loyalty-page - serve la pagina Area Membri Premia come application/liquid (richiesto da App Proxy).',
  '// {% layout none %} = standalone senza tema; {% raw %} = markup verbatim (Liquid non lo parsa).',
  '// BODY = pagina nuova (?v=2), BODY_V1 = pagina di prima (default, rollback). GENERATO da build.mjs: non modificare a mano.',
  'const BODY = ' + JSON.stringify(body) + ';',
  'const BODY_V1 = ' + JSON.stringify(bodyV1) + ';',
  'const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };',
  'Deno.serve((req) => {',
  '  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });',
  '  const v2 = new URL(req.url).searchParams.get("v") === "2";',
  '  return new Response(v2 ? BODY : BODY_V1, { headers: { ...cors, "Content-Type": "application/liquid; charset=utf-8" } });',
  '});',
  '',
].join('\n');

if (process.argv.includes('--check')) {
  let cur = '';
  try { cur = readFileSync(DIR + 'index.ts', 'utf8').replace(/\r\n/g, '\n'); } catch { /* assente = non aggiornato */ }
  if (cur !== out) {
    console.error('loyalty-page: index.ts NON corrisponde alle sorgenti in src/. Rilanciare: node supabase/functions/loyalty-page/build.mjs');
    process.exit(1);
  }
  console.log('loyalty-page: index.ts aggiornato rispetto a src (' + body.length + ' byte la pagina nuova, ' + bodyV1.length + ' quella di prima)');
  process.exit(0);
}

writeFileSync(DIR + 'index.ts', out);
console.log('loyalty-page: index.ts rigenerato (' + body.length + ' byte la pagina nuova, ' + bodyV1.length + ' quella di prima)');
