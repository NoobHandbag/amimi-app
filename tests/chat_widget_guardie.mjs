// tests/chat_widget_guardie.mjs: guardie di Gate 1 sull'app Shopify "Amimi Chat" (shopify/amimi-chat/), chat del sito:
// Fase 0 (toml ed estensione, docs/PROPOSTA_chat_sito.md 4.2-4.9 e 15.1, decisione D-4 di Dan del 6 novembre 2026) e
// Fase 1 pezzo 5 (loader, pannello, blocco; 4.3, 5.4, 5.7, 6.2 con D-8, 11.10, test 13 e 16 di 13.4). Nessuna rete, nessun DB.
//   node tests/chat_widget_guardie.mjs
// Perche' esiste: un `shopify app deploy` porta TUTTO il toml sull'app in pochi minuti (scope e proxy compresi) e loader e
// pannello girano su ogni pagina di amimi.it. Un client secret nel repo pubblico, uno scope in piu', il proxy su un altro
// subpath, un innerHTML, una chiamata di rete o una scrittura sul dispositivo prima del tocco, un link verso un altro sito,
// un pannello caricato da un host qualsiasi o un loader oltre i 10 KB compressi non si vedono finche' non sono in vetrina.
// Il loader si esegue davvero in un DOM finto (D1-D12): cosa chiama e cosa scrive al caricamento e al tocco.
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
let LOADER = read(join(EXT, 'assets', 'chat-loader.js'));
const PANNELLO = read(join(EXT, 'assets', 'chat-panel.js'));
const RIPRENDI = read(join(ROOT, 'supabase', 'functions', 'chat-api', 'riprendi.ts'));

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
// ogni file sotto shopify/: niente segreti, niente .env
const tuttiIFile = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? tuttiIFile(p) : [p]; });
const FILE_SHOPIFY = tuttiIFile(join(ROOT, 'shopify'));
// il blocco (pezzo 5): oltre alle impostazioni, l'URL dell'asset del pannello; nient'altro di Liquid
function blocco(liquid, blocchi) {
  const sc = schemaDi(liquid);
  const corpo = liquid.replace(/\{% comment %\}[\s\S]*?\{% endcomment %\}/g, '').replace(/\{% schema %\}[\s\S]*?\{% endschema %\}/, '');
  const prova = sc?.settings?.find((x) => x.id === 'modalita_prova');
  const espr = [...corpo.matchAll(/\{\{([^}]*)\}\}/g)].map((x) => x[1].trim());
  return isDeepStrictEqual(blocchi, ['chat-embed.liquid']) && sc !== null && sc.target === 'body' && sc.javascript === 'chat-loader.js'
    && prova?.type === 'checkbox' && prova.default === true
    && isDeepStrictEqual(sc.settings.map((x) => x.id), ['posizione', 'colore', 'modalita_prova'])
    && corpo.includes('id="amimi-chat-embed"') && !/\bcustomer\b|\bshop\.metafields\b|<script|\{%/i.test(corpo)
    && isDeepStrictEqual(espr, ["'chat-panel.js' | asset_url", 'block.settings.posizione | escape', 'block.settings.colore | escape', 'block.settings.modalita_prova'])
    && corpo.includes(`data-pannello="{{ 'chat-panel.js' | asset_url }}"`);
}
const senzaCommenti = (s) => s.replace(/^\s*\/\/.*$/gm, '');
const sintassiOk = (s) => { try { new Script(s); return true; } catch { return false; } };
const pesoGz = (s) => gzipSync(Buffer.from(s, 'utf8')).length;
// vietati in loader e pannello: HTML da stringhe, codice da stringhe, canali di rete diversi da fetch, cookie, IndexedDB
const VIETATI = [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new\s+Function\s*\(/, /set(?:Timeout|Interval)\s*\(\s*['"`]/,
  /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/, /\bimport\s*\(/, /sessionStorage/, /document\.cookie/, /indexedDB/, /console\./, /postMessage/, /\.srcdoc\b/];
function loaderStatico(s) {
  const c = senzaCommenti(s);
  // Shopify (theme check AssetSizeAppBlockJavaScript) misura il file NON compresso, soglia 10.000 byte (09-11)
  return sintassiOk(s) && VIETATI.every((re) => !re.test(c)) && Buffer.byteLength(s, 'utf8') < 10000 && pesoGz(s) < 10240 && c.includes("getElementById('amimi-chat-embed')")
    && (c.match(/\bfetch\(/g) ?? []).length === 1 && /fetch\(BASE \+ '\/' \+ azione, \{ method: 'POST'/.test(c)
    && (c.match(/createElement\('script'\)/g) ?? []).length === 1 && /s\.src = src;/.test(c)
    && (c.match(/localStorage/g) ?? []).length === 3 && (c.match(/localStorage\.(getItem|setItem|removeItem)\(CHIAVE/g) ?? []).length === 3
    && /attachShadow\(/.test(c) && !SEGRETI.test(s);
}
const TS_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
function pannelloStatico(s) {
  const c = senzaCommenti(s);
  const host = [...new Set((c.match(/https:\/\/[a-z0-9.-]+/g) ?? []))];
  return sintassiOk(s) && VIETATI.every((re) => !re.test(c)) && !/localStorage/.test(c)
    && (c.match(/\bfetch\(/g) ?? []).length === 1 && /fetch\(A\.base \+ '\/' \+ azione, opz\)/.test(c)
    && (c.match(/createElement\('script'\)/g) ?? []).length === 1 && /s\.src = TURNSTILE_JS;/.test(c) && c.includes(`var TURNSTILE_JS = '${TS_URL}';`)
    && isDeepStrictEqual(host, ['https://challenges.cloudflare.com']) && /A\.salva\(\{ v: 1, t: S\.token, p: prova, a: S\.attivita, s: S\.cursore, o: false, e: S\.email \|\| '' \}\)/.test(c)
    && /action: 'chat_avvia', execution: 'execute'/.test(c) && !SEGRETI.test(s);
}

console.log('== shopify.app.toml ==');
t('T1 client_id dell\'app creata il 07-11, nome, embedded false, un application_url https e nient\'altro in cima', tomlApp(TOML), leggiToml(TOML)['']);
t('T2 scope solo write_app_proxy; proxy apps/chat verso chat-api; network access solo Turnstile; nessuna chiave di segreto', tomlApp(TOML));
console.log('\n== estensione ==');
t('E1 shopify.extension.toml: tema, "Amimi Chat"', estensione(EXT_TOML), leggiToml(EXT_TOML));
t('E2 un solo blocco (chat-embed.liquid) app embed in body col loader, URL del pannello con asset_url, impostazioni posizione, colore e Modalità prova (accesa di default); marcatore amimi-chat-embed; nessun dato della cliente', blocco(LIQUID, BLOCCHI), schemaDi(LIQUID));
t('E3 due soli asset: loader e pannello', isDeepStrictEqual(readdirSync(join(EXT, 'assets')).sort(), ['chat-loader.js', 'chat-panel.js']));
console.log('\n== loader e pannello, sul sorgente ==');
t('L1 loader: sintassi, nessun HTML da stringhe, una sola fetch (verso /apps/chat), un solo script (il pannello), localStorage solo sulla sua chiave, shadow DOM, sotto 10.000 byte NON compressi (misura di Shopify)', loaderStatico(LOADER), { byte: Buffer.byteLength(LOADER, 'utf8'), gz: pesoGz(LOADER), vietati: VIETATI.filter((re) => re.test(senzaCommenti(LOADER))).map(String) });
t('L2 pannello: sintassi, nessun HTML da stringhe, nessun localStorage diretto, una sola fetch (verso /apps/chat), un solo script (Turnstile), nessun altro host, stato salvato nel formato del loader', pannelloStatico(PANNELLO), { gz: pesoGz(PANNELLO), vietati: VIETATI.filter((re) => re.test(senzaCommenti(PANNELLO))).map(String) });
const chiaveDi = (s) => (s.match(/var CHIAVE = '([a-z0-9_]+)';/) ?? [])[1];
const sitekeyDi = (s) => (s.match(/var SITEKEY = (\{ produzione: '[^']+', prova: '[^']+' \});/) ?? [])[1];
t('L3 la pagina riprendi di chat-api usa la stessa chiave, lo stesso formato e le stesse sitekey del widget', chiaveDi(LOADER) === 'amimi_chat_v1' && chiaveDi(RIPRENDI) === 'amimi_chat_v1'
  && sitekeyDi(PANNELLO) !== undefined && sitekeyDi(PANNELLO) === sitekeyDi(RIPRENDI)
  && sitekeyDi(PANNELLO) === "{ produzione: '0x4AAAAAAF2QTzI4g31RhjIS', prova: '0x4AAAAAAF33Q02jrHXJLHjr' }"
  && /var nuovo = \{ v: 1, t: d\.token, p: prova, a: Date\.now\(\), s: 0, o: true, e: em \};/.test(RIPRENDI) && /localStorage\.setItem\(CHIAVE, JSON\.stringify\(nuovo\)\)/.test(RIPRENDI) && RIPRENDI.includes(`var TURNSTILE_JS = '${TS_URL}';`));
t('L5 pannello: la storia a pagine si ferma a pannello chiuso (Gate 2, C2); una chat piu\' nuova di un\'altra scheda non si sovrascrive (C4); ogni chiamata ha un tempo massimo e non rifiuta mai (B2)',
  /if \(S\.aperto && !document\.hidden\) S\.timer = setTimeout\(function \(\) \{ aggiorna\(p \+ 1\); \}, 300\);/.test(PANNELLO) && /if \(!nuova && ora && ora\.t !== S\.token\) return;/.test(PANNELLO)
  && /ctrl\.abort\(\); \}, ATTESA_RETE_MS\)/.test(PANNELLO) && /\.then\(function \(x\) \{ fine\(\); return x; \}, function \(\) \{ fine\(\); return \{ http: 0, d: null \}; \}\);/.test(PANNELLO));
t('L6 link all\'informativa dalla radice della lingua di Shopify (forma controllata), mai un prefisso scritto a mano; la pagina riprendi torna a "/"', /a\.href = radiceLingua\(\) \+ 'policies\/privacy-policy';/.test(PANNELLO) && !/'\/en\//.test(senzaCommenti(PANNELLO))
  && /location\.replace\('\/'\);/.test(RIPRENDI) && !/location\.replace\(en/.test(RIPRENDI));
t('L4 versione del widget uguale nel loader e nel pannello (il pannello rifiuta un loader diverso)', /var VERSIONE = 'w-1';/.test(LOADER) && /A\.versione !== 'w-1'/.test(PANNELLO) && /var VERSIONE = 'w-1';/.test(PANNELLO));

// ---- il loader in un DOM finto (S8, test 16): cosa fa al caricamento e al tocco ----
class FakeEl {
  constructor(tag) { this.tag = tag; this.children = []; this.attr = {}; this.style = { prop: {}, setProperty(k, v) { this.prop[k] = v; } }; this.on = {}; this.hidden = false; this.className = ''; this.textContent = ''; this._cls = new Set();
    this.classList = { add: (c) => this._cls.add(c), remove: (c) => this._cls.delete(c) }; }
  appendChild(c) { this.children.push(c); if (this.alAggiungere) this.alAggiungere(c); return c; }
  setAttribute(k, v) { this.attr[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attr, k) ? this.attr[k] : null; }
  addEventListener(tp, f) { this.on[tp] = f; }
  attachShadow(o) { this.shadow = new FakeEl('#shadow'); this.shadow.mode = o.mode; return this.shadow; }
}
function eseguiLoader({ storage = null, prova = false, mio = 'https://amimi.it/cdn/shop/extensions/abc-123/1.0.0/assets/chat-loader.js', pannello = 'https://amimi.it/cdn/shop/extensions/abc-123/1.0.0/assets/chat-panel.js', risposta = { ok: true, stato: 'aperta', messaggi: [], altri: false }, ora = Date.parse('2026-11-09T10:00:00Z') } = {}) {
  const log = { fetch: [], get: 0, set: [], remove: 0, script: [] };
  const cfg = new FakeEl('div');
  cfg.attr = { 'data-prova': String(prova), 'data-colore': '#1f1f1f', 'data-posizione': 'bottom_right', 'data-pannello': pannello };
  const body = new FakeEl('body');
  body.className = 'template-product';
  const head = new FakeEl('head');
  head.alAggiungere = (s) => log.script.push(s.src);
  const doc = { readyState: 'complete', currentScript: mio === null ? null : { src: mio }, body, head, getElementById: (id) => (id === 'amimi-chat-embed' ? cfg : null), createElement: (tag) => new FakeEl(tag),
    createElementNS: (ns, tag) => new FakeEl(tag), addEventListener() {} };
  const mem = new Map(storage === null ? [] : [['amimi_chat_v1', typeof storage === 'string' ? storage : JSON.stringify(storage)]]);
  const win = { location: { href: 'https://amimi.it/products/lea', hostname: 'amimi.it' },
    localStorage: { getItem: (k) => { log.get++; return mem.has(k) ? mem.get(k) : null; }, setItem: (k, v) => { log.set.push([k, v]); mem.set(k, v); }, removeItem: (k) => { log.remove++; mem.delete(k); } } };
  const fetchFinto = (u, o) => { log.fetch.push({ u, corpo: JSON.parse(o.body), metodo: o.method }); return Promise.resolve({ json: () => Promise.resolve(risposta) }); };
  const DateFinta = class extends Date { static now() { return ora; } };
  new Function('window', 'document', 'fetch', 'URL', 'Date', LOADER)(win, doc, fetchFinto, URL, DateFinta);
  const host = body.children.find((c) => c.attr.id === undefined && c.shadow) ?? body.children[0];
  const bolla = host?.shadow?.children.find((c) => c.tag === 'div')?.children.find((c) => c.tag === 'button');
  return { log, win, host, bolla, mem, prima: { fetch: log.fetch.length, set: log.set.length, remove: log.remove, script: log.script.length } };
}
const attesa = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const TOK = 'a'.repeat(43);
const ORA = Date.parse('2026-11-09T10:00:00Z');
console.log('\n== loader in un DOM finto (S8, test 16) ==');
{
  const x = eseguiLoader();
  await attesa();
  t('D1 senza chat in corso: bolla disegnata in uno shadow DOM, nessuna chiamata, niente scritto o tolto, nessuno script', x.host?.shadow?.mode === 'open' && x.bolla?.attr['aria-label'] === 'Chat con Amimi'
    && x.log.fetch.length === 0 && x.log.set.length === 0 && x.log.remove === 0 && x.log.script.length === 0);
  x.bolla.on.click();
  await attesa();
  t('D2 al tocco: solo lo script del pannello (asset dell\'estensione), nessuna chiamata, niente scritto', JSON.stringify(x.log.script) === JSON.stringify(['https://amimi.it/cdn/shop/extensions/abc-123/1.0.0/assets/chat-panel.js'])
    && x.log.fetch.length === 0 && x.log.set.length === 0 && x.win.__amimiChat.daAprire === true);
  const y = eseguiLoader({ storage: { v: 1, t: TOK, p: false, a: ORA - 3600000, s: 7, o: false }, risposta: { ok: true, stato: 'aperta', messaggi: [{ seq: 8, autore: 'staff', at: new Date(ORA - 60000).toISOString() }, { seq: 9, autore: 'cliente' }, { seq: 10, autore: 'staff', at: new Date(ORA - 30000).toISOString() }], altri: false } });
  await attesa();
  t('D3 chat in corso: un solo aggiorna (dopo = ultimo visto, vista false), pallino col numero delle risposte del team', y.log.fetch.length === 1 && y.log.fetch[0].u === '/apps/chat/aggiorna'
    && JSON.stringify(y.log.fetch[0].corpo) === JSON.stringify({ token: TOK, dopo: 7, vista: false }) && y.log.script.length === 0, y.log.fetch);
  const pall = y.bolla.children.find((c) => c.className === 'pallino');
  t('D4 pallino visibile con 2 e attivita\' portata all\'ora dell\'ultima risposta del team (non ad adesso)', pall?.hidden === false && pall.textContent === '2' && JSON.parse(y.mem.get('amimi_chat_v1')).a === ORA - 30000);
  const z = eseguiLoader({ storage: { v: 1, t: TOK, p: false, a: ORA - 5 * 3600000, s: 0, o: false } });
  await attesa();
  t('D5 token oltre 4 ore di inattivita\': cancellato senza chiamate', z.log.fetch.length === 0 && z.log.remove === 1);
  const w = eseguiLoader({ storage: { v: 1, t: TOK, p: true, a: ORA - 60000, s: 0, o: false } });
  await attesa();
  t('D6 token di una chat di prova sul widget vero: ignorato, nessuna chiamata, niente toccato', w.log.fetch.length === 0 && w.log.remove === 0 && w.log.set.length === 0);
  const v = eseguiLoader({ storage: { v: 1, t: TOK, p: false, a: ORA - 60000, s: 0, o: true } });
  await attesa();
  t('D7 arrivo dalla pagina riprendi (o: true): il pannello si carica e si apre da solo, nessun aggiorna, o rimesso a false', v.log.fetch.length === 0 && v.log.script.length === 1 && v.win.__amimiChat.daAprire === true
    && JSON.parse(v.mem.get('amimi_chat_v1')).o === false);
  const u = eseguiLoader({ storage: { v: 1, t: TOK, p: false, a: ORA - 60000, s: 3, o: false }, risposta: { ok: false, state: 'token_non_valido' } });
  await attesa();
  t('D8 token rifiutato dal server: cancellato', u.log.fetch.length === 1 && u.log.remove === 1);
  const c = eseguiLoader({ storage: { v: 1, t: TOK, p: false, a: ORA - 60000, s: 3, o: false }, risposta: { ok: true, stato: 'chiusa', messaggi: [], altri: false } });
  await attesa();
  t('D9 chat chiusa senza risposte nuove: cancellata', c.log.remove === 1);
  const r = eseguiLoader({ storage: '{rotto' });
  await attesa();
  t('D10 stato illeggibile: come nessuna chat (nessuna chiamata, niente scritto)', r.log.fetch.length === 0 && r.log.set.length === 0 && r.log.remove === 0);
  const sbagliati = ['http://amimi.it/cdn/shop/extensions/a/assets/chat-panel.js', 'https://evil.com/cdn/shop/extensions/a/assets/chat-panel.js', 'https://amimi.it/cdn/shop/extensions/a/assets/altro.js',
    'javascript:alert(1)', '//evil.com/extensions/a/assets/chat-panel.js', 'https://amimi.it.evil.com/extensions/a/assets/chat-panel.js', 'https://amimi.it/files/chat-panel.js', '',
    'https://cdn.shopify.com/extensions/altra-app-999/1.0.0/assets/chat-panel.js', 'https://amimi.it/cdn/shop/extensions/abc-123/0.9.0/assets/chat-panel.js', 'https://amimi.it/cdn/shop/extensions/altra/1.0.0/assets/chat-panel.js'];
  let rifiutati = 0;
  for (const p of sbagliati) {
    const q = eseguiLoader({ pannello: p });
    q.bolla.on.click();
    await attesa();
    if (q.log.script.length === 0 && q.log.fetch.length === 1 && q.log.fetch[0].u === '/apps/chat/errore' && q.log.fetch[0].corpo.codice === 'pannello_url' && q.log.fetch[0].corpo.pagina === 'prodotto') rifiutati++;
  }
  t('D11 URL del pannello non valido (altro host, http, altro file, javascript:, il chat-panel.js di un\'altra app o di un\'altra versione): nessuno script, solo il beacon d\'errore', rifiutati === sbagliati.length, rifiutati);
  const cdn = eseguiLoader({ mio: 'https://cdn.shopify.com/extensions/0193-ab/amimi-chat-3/assets/chat-loader.js', pannello: 'https://cdn.shopify.com/extensions/0193-ab/amimi-chat-3/assets/chat-panel.js?v=1' });
  cdn.bolla.on.click();
  t('D12 URL del pannello sulla CDN di Shopify, nella cartella del loader: accettato', cdn.log.script.length === 1);
  const senza = eseguiLoader({ mio: null });
  senza.bolla.on.click();
  await attesa();
  t('D13 loader senza il proprio indirizzo (currentScript): nessuno script, beacon', senza.log.script.length === 0 && senza.log.fetch[0]?.corpo.codice === 'pannello_url');
}

// ---- funzioni pure del pannello ----
const PB = '// ==== PURE:chat-panel BEGIN ====', PE = '// ==== PURE:chat-panel END ====';
const pa = PANNELLO.indexOf(PB), pb = PANNELLO.indexOf(PE);
const P = pa > 0 && pb > pa ? new Function(PANNELLO.slice(pa + PB.length, pb) + '\nreturn { linkSicuro, pezziTesto, intervallo, emailOk, nuovoUuid, leggiRisposta, messaggioValido, TESTI };')() : null;
console.log('\n== pannello: funzioni pure ==');
t('U0 blocco PURE:chat-panel trovato', P !== null);
if (P) {
  const no = ['https://amimi.it.evil.com/x', 'https://amimi.it@evil.com/', 'https://u:p@amimi.it/', '//evil.com', 'javascript:alert(1)', 'http://amimi.it/', 'https://amimi.it:8443/', 'https://evil.com/?amimi.it', 'data:text/html,x'];
  const si = ['https://amimi.it/', 'https://www.amimi.it/pages/resi', 'https://amimi.it/policies/refund-policy#x'];
  t('U1 link cliccabili solo https su amimi.it o www.amimi.it, senza credenziali ne\' porta', no.every((u) => P.linkSicuro(u) === null) && si.every((u) => P.linkSicuro(u) !== null));
  const pz = P.pezziTesto('Vedi https://amimi.it/pages/resi. Oppure https://evil.com/x e https://amimi.it@evil.com');
  t('U2 testo a pezzi: il link buono senza il punto finale, gli altri restano testo', pz.length === 3 && pz[1].href === 'https://amimi.it/pages/resi' && pz[1].t === 'https://amimi.it/pages/resi'
    && pz[0].t === 'Vedi ' && pz[2].href === undefined && pz.map((x) => x.t).join('') === 'Vedi https://amimi.it/pages/resi. Oppure https://evil.com/x e https://amimi.it@evil.com', pz);
  const html = P.pezziTesto('<img src=x onerror=alert(1)><script>alert(1)</script>');
  t('U3 HTML e script restano testo (nessun pezzo e\' markup)', html.length === 1 && html[0].href === undefined);
  t('U4 cadenza del polling (D-8): 5 s, 20 s, 60 s, poi fermo a 30 minuti', P.intervallo(0) === 5000 && P.intervallo(119999) === 5000 && P.intervallo(120000) === 20000 && P.intervallo(599999) === 20000
    && P.intervallo(600000) === 60000 && P.intervallo(1799999) === 60000 && P.intervallo(1800000) === null);
  t('U5 email: una sola, senza spazi ne\' <>,;"', P.emailOk('a@b.it') && !P.emailOk('a@b.it,c@d.it') && !P.emailOk('a@b.it\nBcc: x@y.it') && !P.emailOk('a b@c.it') && !P.emailOk('a@b') && !P.emailOk('x'.repeat(250) + '@b.it'));
  const fintoCrypto = { getRandomValues: (b) => { for (let i = 0; i < b.length; i++) b[i] = i * 17; return b; } };
  t('U6 uuid v4 anche senza randomUUID', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(P.nuovoUuid(fintoCrypto)) && P.nuovoUuid({ randomUUID: () => 'x' }) === 'x');
  t('U7 risposta non JSON (pagina 500 del proxy) o un array: null', P.leggiRisposta('<html>') === null && P.leggiRisposta('[1]') === null && P.leggiRisposta('{"ok":true}').ok === true);
  t('U8 messaggi: autore sconosciuto, seq o testo non validi scartati; via_email solo se true', P.messaggioValido({ seq: 1, autore: 'admin', testo: 'x' }) === null && P.messaggioValido({ seq: '1', autore: 'staff', testo: 'x' }) === null
    && P.messaggioValido({ seq: 2, autore: 'staff', testo: 3 }) === null && P.messaggioValido({ seq: 3, autore: 'staff', testo: 'ok', via_email: 'si' }).via_email === false
    && JSON.stringify(P.messaggioValido({ seq: 4, autore: 'sistema', testo: 't', at: 'x', extra: 1 })) === '{"seq":4,"autore":"sistema","testo":"t","at":"x","via_email":false}');
  const ki = Object.keys(P.TESTI.it).sort(), ke = Object.keys(P.TESTI.en).sort();
  t('U9 testi italiani e inglesi con le stesse voci, tutte non vuote', isDeepStrictEqual(ki, ke) && ki.every((k) => P.TESTI.it[k] && P.TESTI.en[k]));
  t('U10 il titolo dice chi risponde (11.3, riga 1) e l\'etichetta fissa vicino al campo (riga 3)', P.TESTI.it.titolo === 'Chat Amimi: risposte automatiche e team' && P.TESTI.it.etichetta === 'Risposte automatiche e team Amimi.');
}

console.log('\n== file della cartella ==');
const conSegreti = FILE_SHOPIFY.filter((p) => SEGRETI.test(readFileSync(p, 'utf8')) || /(^|[\\/])\.env/.test(p)).map((p) => relative(ROOT, p));
t('F1 nessun file sotto shopify/ con un segreto o un .env', conSegreti.length === 0 && FILE_SHOPIFY.length >= 6, conSegreti);

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
t('A2 blocco con un secondo file, prova spenta di default, customer letto, target head o un\'altra espressione -> visto', [
  !blocco(LIQUID, ['chat-embed.liquid', 'altro.liquid']),
  !blocco(pianta(LIQUID, '"default": true', '"default": false'), BLOCCHI),
  !blocco(pianta(LIQUID, 'hidden\n></div>', 'hidden data-c="{{ customer.email }}"\n></div>'), BLOCCHI),
  !blocco(pianta(LIQUID, '"target": "body"', '"target": "head"'), BLOCCHI),
  !blocco(pianta(LIQUID, "{{ 'chat-panel.js' | asset_url }}", "{{ 'altro.js' | asset_url }}"), BLOCCHI),
].every(Boolean));
t('A3 loader con innerHTML, una fetch o uno script in piu\', sessionStorage, sintassi rotta o oltre 10 KB compressi -> visto', [
  pianta(LOADER, "x.textContent = testo;", 'x.innerHTML = testo;'),
  pianta(LOADER, "var api = { versione", "fetch('/apps/chat/config'); var api = { versione"),
  pianta(LOADER, "var api = { versione", "document.createElement('script'); var api = { versione"),
  pianta(LOADER, "var api = { versione", "sessionStorage.setItem('a', '1'); var api = { versione"),
  pianta(LOADER, "var api = { versione", "localStorage.setItem('altro', '1'); var api = { versione"),
  pianta(LOADER, "'use strict';", "'use strict'; var x = ;"),
  LOADER + '\n// ' + Array.from({ length: 30000 }, (_, i) => ((i * 7919) % 65536).toString(36)).join(''),
  LOADER + '\n// ' + 'x'.repeat(10000 - Buffer.byteLength(LOADER, 'utf8')),
].every((s) => !loaderStatico(s)));
t('A4 pannello con innerHTML, localStorage diretto, un altro host, un altro script o una fetch in piu\' -> visto', [
  pianta(PANNELLO, "if (testo) x.textContent = testo;", 'if (testo) x.innerHTML = testo;'),
  pianta(PANNELLO, "function svuota(x)", "function zz() { localStorage.getItem('a'); }\n  function svuota(x)"),
  pianta(PANNELLO, "function svuota(x)", "var Q = 'https://evil.com/x';\n  function svuota(x)"),
  pianta(PANNELLO, "function svuota(x)", "function zz() { document.createElement('script'); }\n  function svuota(x)"),
  pianta(PANNELLO, "function svuota(x)", "function zz() { fetch('/x'); }\n  function svuota(x)"),
].every((s) => !pannelloStatico(s)));
{
  // il test di comportamento vede davvero una chiamata prima del tocco
  const orig = LOADER;
  LOADER = pianta(orig, "  var st = leggi();\n", "  chiama('config', {});\n  var st = leggi();\n");
  const x = eseguiLoader();
  await attesa();
  LOADER = orig;
  t('A5 un loader che chiama prima del tocco viene visto dal DOM finto', x.log.fetch.length === 1);
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
