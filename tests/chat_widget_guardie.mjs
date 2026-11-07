// tests/chat_widget_guardie.mjs: guardie di Gate 1 sull'app Shopify "Amimi Chat" (shopify/amimi-chat/), chat del sito
// Fase 0 (docs/PROPOSTA_chat_sito.md 4.2-4.9 e 15.1, decisione D-4 di Dan del 6 novembre 2026). Nessuna rete, nessun DB.
//   node tests/chat_widget_guardie.mjs
// Perche' esiste: un `shopify app deploy` porta TUTTO il toml sull'app in pochi minuti (scope e proxy compresi) e il loader
// gira su ogni pagina di amimi.it. Un client secret nel repo pubblico, uno scope in piu', il proxy su un altro subpath, un
// innerHTML, una chiamata di rete o una scrittura sul dispositivo prima del clic, o un loader oltre i 10 KB compressi non si
// vedono finche' non sono in vetrina.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Script } from 'node:vm';
import { isDeepStrictEqual } from 'node:util';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APP = join(ROOT, 'shopify', 'amimi-chat');
const EXT = join(APP, 'extensions', 'chat-widget');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const TOML = read(join(APP, 'shopify.app.toml'));
const EXT_TOML = read(join(EXT, 'shopify.extension.toml'));
const BLOCCHI = readdirSync(join(EXT, 'blocks'));
const LIQUID = read(join(EXT, 'blocks', 'chat-embed.liquid'));
const LOADER = read(join(EXT, 'assets', 'chat-loader.js'));

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 260) : '')); } };

// TOML minimo: sezioni [x] e righe chiave = valore (stringhe, booleani, array di stringhe). I commenti si tolgono prima.
function leggiToml(s) {
  const out = { '': {} };
  let sez = '';
  for (const grezza of s.split('\n')) {
    const l = grezza.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
    if (!l) continue;
    const m = l.match(/^\[([a-z_.]+)\]$/);
    if (m) { sez = m[1]; out[sez] ??= {}; continue; }
    const kv = l.match(/^([a-z_]+)\s*=\s*(.+)$/);
    if (!kv) { out.__illeggibili = [...(out.__illeggibili ?? []), l]; continue; }
    let v;
    try { v = JSON.parse(kv[2]); } catch { v = { __grezzo: kv[2] }; }
    out[sez][kv[1]] = v;
  }
  return out;
}
// client_id dell'app "Amimi Chat" della Dev Dashboard (07-11): non e' un segreto, cambia solo se l'app si ricrea
const CLIENT_ID = 'df701ddc2254e2776d6e961abbb7dff8';
const SEGRETI = /client_secret|api_secret|secret_key|shpss_|shpat_|shpca_|sb_secret_|eyJhbGciOi|access_token|password/i;
function tomlApp(s) {
  const c = leggiToml(s);
  const chiaviCima = Object.keys(c['']).sort();
  return c.__illeggibili === undefined && c[''].client_id === CLIENT_ID && c[''].name === 'Amimi Chat' && c[''].embedded === false
    && typeof c[''].application_url === 'string' && c[''].application_url.startsWith('https://')
    && isDeepStrictEqual(chiaviCima, ['application_url', 'client_id', 'embedded', 'name'])
    && isDeepStrictEqual(c.access_scopes, { scopes: 'write_app_proxy' })
    && isDeepStrictEqual(c.app_proxy, { url: 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/chat-api', prefix: 'apps', subpath: 'chat' })
    && isDeepStrictEqual(c.network_access, { allowed_sources: ['https://challenges.cloudflare.com'], allowed_navigation_hosts: [] })
    && Array.isArray(c.auth?.redirect_urls) && c.auth.redirect_urls.length >= 1 && typeof c.webhooks?.api_version === 'string'
    && isDeepStrictEqual(Object.keys(c).sort(), ['', 'access_scopes', 'app_proxy', 'auth', 'network_access', 'webhooks'])
    && !SEGRETI.test(s);
}
function estensione(s) {
  const c = leggiToml(s);
  return c.__illeggibili === undefined && c[''].type === 'theme' && c[''].name === 'Amimi Chat' && !SEGRETI.test(s);
}
function schemaDi(liquid) {
  const m = liquid.match(/\{% schema %\}([\s\S]*?)\{% endschema %\}/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
function blocco(liquid, blocchi) {
  const sc = schemaDi(liquid);
  const corpo = liquid.replace(/\{% comment %\}[\s\S]*?\{% endcomment %\}/g, '').replace(/\{% schema %\}[\s\S]*?\{% endschema %\}/, '');
  const prova = sc?.settings?.find((x) => x.id === 'modalita_prova');
  return isDeepStrictEqual(blocchi, ['chat-embed.liquid']) && sc !== null && sc.target === 'body' && sc.javascript === 'chat-loader.js'
    && prova?.type === 'checkbox' && prova.default === true
    && isDeepStrictEqual(sc.settings.map((x) => x.id), ['posizione', 'colore', 'modalita_prova'])
    && corpo.includes('id="amimi-chat-embed"') && !/\bcustomer\b|\bshop\.metafields\b|<script/i.test(corpo)
    && [...corpo.matchAll(/\{\{([^}]*)\}\}/g)].every((x) => /^\s*block\.settings\.(posizione \| escape|colore \| escape|modalita_prova)\s*$/.test(x[1]));
}
// il loader, prima e dopo il clic (Fase 0): niente rete, niente scritture sul dispositivo, niente HTML da stringhe
const VIETATI_LOADER = [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new\s+Function\s*\(/, /set(?:Timeout|Interval)\s*\(\s*['"`]/,
  /\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/, /\bimport\s*\(/, /localStorage/, /sessionStorage/, /document\.cookie/, /indexedDB/, /createElement\(\s*['"]script/];
const sintassiOk = (s) => { try { new Script(s); return true; } catch { return false; } };
const pesoGz = (s) => gzipSync(Buffer.from(s, 'utf8')).length;
// i commenti di riga si tolgono prima di cercare (il commento in testa al loader nomina cio' che il loader NON fa)
const senzaCommenti = (s) => s.replace(/^\s*\/\/.*$/gm, '');
function loader(s) {
  const c = senzaCommenti(s);
  return sintassiOk(s) && VIETATI_LOADER.every((re) => !re.test(c)) && pesoGz(s) < 10240 && c.includes("getElementById('amimi-chat-embed')")
    && c.includes('.textContent =') && !SEGRETI.test(s);
}
// ogni file sotto shopify/: niente segreti, niente .env
const tuttiIFile = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? tuttiIFile(p) : [p]; });
const FILE_SHOPIFY = tuttiIFile(join(ROOT, 'shopify'));

console.log('== shopify.app.toml ==');
t('T1 client_id dell\'app creata il 07-11, nome, embedded false, un application_url https e nient\'altro in cima', tomlApp(TOML), leggiToml(TOML)['']);
t('T2 scope solo write_app_proxy; proxy apps/chat verso chat-api; network access solo Turnstile; nessuna chiave di segreto', tomlApp(TOML));
console.log('\n== estensione ==');
t('E1 shopify.extension.toml: tema, "Amimi Chat"', estensione(EXT_TOML), leggiToml(EXT_TOML));
t('E2 un solo blocco (chat-embed.liquid) app embed in body col loader, impostazioni posizione, colore e Modalità prova (accesa di default); marcatore amimi-chat-embed; nessun dato della cliente', blocco(LIQUID, BLOCCHI), schemaDi(LIQUID));
console.log('\n== loader ==');
t('L1 sintassi, nessun innerHTML/eval/script, nessuna rete, nessuna scrittura sul dispositivo, testi con textContent, sotto 10 KB compressi', loader(LOADER), { gz: pesoGz(LOADER), vietati: VIETATI_LOADER.filter((re) => re.test(LOADER)).map(String) });
console.log('\n== file della cartella ==');
const conSegreti = FILE_SHOPIFY.filter((p) => SEGRETI.test(readFileSync(p, 'utf8')) || /(^|[\\/])\.env/.test(p)).map((p) => relative(ROOT, p));
t('F1 nessun file sotto shopify/ con un segreto o un .env', conSegreti.length === 0 && FILE_SHOPIFY.length >= 5, conSegreti);

console.log('\n== autocontrollo ==');
const pianta = (s, da, a) => { const x = s.replace(da, () => a); if (x === s) { console.log('  KO  autocontrollo: frammento non trovato: ' + da.slice(0, 80)); ko++; } return x; };
t('A1 toml con client secret, uno scope in piu\', il proxy su un altro subpath, Supabase fra le fonti o un altro client_id -> visto', [
  pianta(TOML, `client_id = "${CLIENT_ID}"`, `client_id = "${CLIENT_ID}"\nclient_secret = "x"`),
  pianta(TOML, 'scopes = "write_app_proxy"', 'scopes = "write_app_proxy,read_customers"'),
  pianta(TOML, 'subpath = "chat"', 'subpath = "chat2"'),
  pianta(TOML, 'allowed_sources = ["https://challenges.cloudflare.com"]', 'allowed_sources = ["https://challenges.cloudflare.com", "https://imszbjeyplaiovylhkgl.supabase.co"]'),
  pianta(TOML, `client_id = "${CLIENT_ID}"`, 'client_id = ""'),
  pianta(TOML, '\n[network_access]', '\n[build]\ninclude_config_on_deploy = true\n\n[network_access]'),
].every((s) => !tomlApp(s)));
t('A2 blocco con un secondo file, prova spenta di default, customer letto o target head -> visto', [
  !blocco(LIQUID, ['chat-embed.liquid', 'altro.liquid']),
  !blocco(pianta(LIQUID, '"default": true', '"default": false'), BLOCCHI),
  !blocco(pianta(LIQUID, 'hidden\n></div>', 'hidden data-c="{{ customer.email }}"\n></div>'), BLOCCHI),
  !blocco(pianta(LIQUID, '"target": "body"', '"target": "head"'), BLOCCHI),
].every(Boolean));
t('A3 loader con innerHTML, fetch, localStorage, sendBeacon, sintassi rotta o oltre 10 KB compressi -> visto', [
  pianta(LOADER, 'testo.textContent =', 'testo.innerHTML ='),
  pianta(LOADER, "window.__amimiChat = { versione: 'fase0' };", "window.__amimiChat = { versione: 'fase0' }; fetch('/apps/chat/config');"),
  pianta(LOADER, "window.__amimiChat = { versione: 'fase0' };", "window.__amimiChat = { versione: 'fase0' }; localStorage.setItem('a', '1');"),
  pianta(LOADER, "window.__amimiChat = { versione: 'fase0' };", "window.__amimiChat = { versione: 'fase0' }; navigator.sendBeacon('/x');"),
  pianta(LOADER, "'use strict';", "'use strict'; var x = ;"),
  LOADER + '\n// ' + Array.from({ length: 30000 }, (_, i) => ((i * 7919) % 65536).toString(36)).join(''),
].every((s) => !loader(s)));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
