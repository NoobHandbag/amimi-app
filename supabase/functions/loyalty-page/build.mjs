// supabase/functions/loyalty-page/build.mjs — genera index.ts (la edge) da src/index.html (la sorgente).
//   node supabase/functions/loyalty-page/build.mjs           scrive index.ts
//   node supabase/functions/loyalty-page/build.mjs --check   exit 1 se index.ts non corrisponde a src (Gate 1)
//
// Perche' esiste: l'App Proxy Shopify serve come text/plain (con nosniff) tutto cio' che NON e'
// Content-Type application/liquid. Per rendere la pagina come HTML va avvolta in
// {% layout none %}{% raw %}...{% endraw %} e servita come application/liquid: Shopify la rende
// standalone (senza tema) e la restituisce al browser come text/html. Il markup resta verbatim.
// index.ts e' un file GENERATO: non modificarlo a mano, modificare src/index.html e rilanciare il build.
// Il sorgente di design vive anche in Cowork12/projects/Premia_Area_Membri_2026-09/PROD/index.html:
// i due file devono restare identici (copiare qui dopo ogni modifica).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const html = readFileSync(DIR + 'src/index.html', 'utf8').replace(/\r\n/g, '\n');
const body = '{% layout none %}{% raw %}' + html + '{% endraw %}';
const out = [
  '// loyalty-page - serve la pagina Area Membri Premia come application/liquid (richiesto da App Proxy).',
  '// {% layout none %} = standalone senza tema; {% raw %} = markup verbatim (Liquid non lo parsa).',
  'const BODY = ' + JSON.stringify(body) + ';',
  'const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };',
  'Deno.serve((req) => {',
  '  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });',
  '  return new Response(BODY, { headers: { ...cors, "Content-Type": "application/liquid; charset=utf-8" } });',
  '});',
  '',
].join('\n');

if (process.argv.includes('--check')) {
  let cur = '';
  try { cur = readFileSync(DIR + 'index.ts', 'utf8').replace(/\r\n/g, '\n'); } catch { /* assente = non aggiornato */ }
  if (cur !== out) {
    console.error('loyalty-page: index.ts NON corrisponde a src/index.html. Rilanciare: node supabase/functions/loyalty-page/build.mjs');
    process.exit(1);
  }
  console.log('loyalty-page: index.ts aggiornato rispetto a src/index.html (' + body.length + ' byte di body)');
  process.exit(0);
}

writeFileSync(DIR + 'index.ts', out);
console.log('loyalty-page: index.ts rigenerato, body bytes ' + body.length);
