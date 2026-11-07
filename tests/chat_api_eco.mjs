// tests/chat_api_eco.mjs: la edge chat-api eco-1 (spike di Fase 0 della chat del sito, docs/PROPOSTA_chat_sito.md 13.3)
// ritagliata DAL SORGENTE che va in produzione (blocco PURE:chat-eco) e fatta girare in Node con Request veri e firme
// calcolate qui con node:crypto. Piu' le guardie sul sorgente. Nessuna rete, nessun DB.
//   node tests/chat_api_eco.mjs
// Perche' esiste: la edge e' pubblica (verify_jwt = false) e risponde a chiunque passi da amimi.it/apps/chat. Una firma
// controllata male, un parametro firmato ripetuto accettato, il valore di un parametro firmato nella risposta, una risposta
// senza no-store o una edge che non si spegne a fine spike non si vedono finche' qualcuno non li usa.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { createHmac, createHash } from 'node:crypto';
import { Script } from 'node:vm';

process.removeAllListeners('warning');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const SRC = read('supabase/functions/chat-api/index.ts');
const CONFIG = read('supabase/config.toml');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 300) : '')); } };

const B = '// ==== PURE:chat-eco BEGIN ====', E = '// ==== PURE:chat-eco END ====';
const a = SRC.indexOf(B), b = SRC.indexOf(E);
if (a < 0 || b < a) { console.error('marcatori PURE:chat-eco non trovati'); process.exit(1); }
const BLOCCO = SRC.slice(a + B.length, b);
const ESPORTA = ['gestisci', 'appProxyHmacHex', 'timingSafeEqualHex', 'paramRipetuti', 'idClienteValido', 'etaFirma', 'mascheraIp', 'vociXff',
  'posDaDestra', 'contaParametri', 'azioneDi', 'attesaDi', 'SPIKE_FINO_MS', 'MAX_SKEW_SEC', 'PAGINA_MISURA'];
const M = new Function(stripTypeScriptTypes(BLOCCO) + `\nreturn { ${ESPORTA.join(', ')} };`)();

const SECRET = 'segreto-di-prova-non-reale';
const ORA = Date.parse('2026-11-10T10:00:00Z');
const TS = String(Math.floor(ORA / 1000) - 7);   // firma di 7 s fa: il timestamp non coincide con l'ora del server
const EDGE = 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/chat-api';
// firma come Shopify: parametri ordinati, valori ripetuti uniti con ',', coppie concatenate, HMAC-SHA256 esadecimale
function firma(coppie, secret = SECRET) {
  const g = new Map();
  for (const [k, v] of coppie) { if (k === 'signature') continue; if (!g.has(k)) g.set(k, []); g.get(k).push(v); }
  const msg = [...g.keys()].sort().map((k) => `${k}=${g.get(k).join(',')}`).join('');
  return createHmac('sha256', secret).update(msg).digest('hex');
}
const SHOPIFY = (cliente = '', ts = TS) => [['shop', 'amimi-10000.myshopify.com'], ['logged_in_customer_id', cliente], ['path_prefix', '/apps/chat'], ['timestamp', ts]];
function url(azione, coppie, { firmaGiusta = true, senzaFirma = false } = {}) {
  const u = new URL(`${EDGE}/${azione}`);
  for (const [k, v] of coppie) u.searchParams.append(k, v);
  if (!senzaFirma) u.searchParams.append('signature', firmaGiusta ? firma(coppie) : '0'.repeat(64));
  return u.toString();
}
const attese = [];
const dorme = async (ms) => { attese.push(ms); };
const chiama = async (req, { ora = ORA, secret = SECRET } = {}) => {
  const r = await M.gestisci(req, ora, secret, dorme);
  const testo = r.status === 204 ? '' : await r.text();
  let d = null; try { d = JSON.parse(testo); } catch { d = null; }
  return { r, testo, d };
};
const post = (u, corpo, headers = {}) => new Request(u, { method: 'POST', body: corpo, headers: { 'content-type': 'application/json', ...headers } });

console.log('== firma (stessa di loyalty-proxy e di Shopify) ==');
{
  const coppie = [...SHOPIFY('123'), ['extra', 'b'], ['extra', 'a'], ['zeta', '1']];
  const p = new URLSearchParams(); for (const [k, v] of coppie) p.append(k, v);
  t('F1 appProxyHmacHex = HMAC di node:crypto (valori ripetuti uniti con virgola)', await M.appProxyHmacHex(p, SECRET) === firma(coppie));
  p.append('signature', 'qualsiasi');
  t('F2 la signature non entra nel messaggio firmato', await M.appProxyHmacHex(p, SECRET) === firma(coppie));
  t('F3 confronto a tempo costante: uguali e diversi', M.timingSafeEqualHex('ab12', 'ab12') && !M.timingSafeEqualHex('ab12', 'ab13') && !M.timingSafeEqualHex('ab', 'abc'));
}

console.log('\n== controlli puri ==');
{
  const p = (s) => new URLSearchParams(s);
  t('P1 nessun parametro di Shopify ripetuto', M.paramRipetuti(p('shop=a&timestamp=1&extra=1&extra=2')).length === 0);
  for (const k of ['logged_in_customer_id', 'path_prefix', 'shop', 'timestamp', 'signature'])
    t('P2 ' + k + ' ripetuto rifiutato', M.paramRipetuti(p(`${k}=1&${k}=2`)).includes(k));
  t('P3 id cliente: vuoto e cifre ok, altro no', M.idClienteValido('') && M.idClienteValido('7412345678901') && !M.idClienteValido('abc') && !M.idClienteValido('1 2') && !M.idClienteValido('1'.repeat(21)) && !M.idClienteValido('-1'));
  const s = ORA / 1000;
  t('P4 eta della firma: fresca, al limite, scaduta, nel futuro, non numerica', M.etaFirma(String(s), ORA) === 0 && M.etaFirma(String(s - 300), ORA) === 300
    && M.etaFirma(String(s - 301), ORA) === null && M.etaFirma(String(s + 301), ORA) === null && M.etaFirma('', ORA) === null && M.etaFirma(null, ORA) === null
    && M.etaFirma('1e9', ORA) === null && M.etaFirma(' 1', ORA) === null);
  t('P5 IP mascherati (v4, v6, altro)', M.mascheraIp('93.41.5.6') === '93.41.x.x' && M.mascheraIp('2a01:4f8:1:2::3') === '2a01:4f8:x' && M.mascheraIp('<script>') === '?');
  const v = M.vociXff('203.0.113.7, 93.41.5.6 ,10.0.0.1');
  t('P6 X-Forwarded-For: voci e posizione da destra', v.length === 3 && M.posDaDestra(v, '203.0.113.7') === 2 && M.posDaDestra(v, '10.0.0.1') === 0 && M.posDaDestra(v, '1.1.1.1') === null && M.posDaDestra(v, null) === null);
  const c = M.contaParametri(p('a=1&a=2&b=x&n%C3%B6=1'));
  t('P7 contaParametri: solo nomi e conteggi, nomi strani raccolti', c.a === 2 && c.b === 1 && c['(altro)'] === 1 && !JSON.stringify(c).includes('x'));
  const molti = new URLSearchParams(); for (let i = 0; i < 40; i++) molti.append('k' + i, 'v');
  const cm = M.contaParametri(molti);
  t('P8 contaParametri: al massimo 30 nomi, il resto contato a parte', Object.keys(cm).length === 31 && cm['(oltre 30)'] === 10);
  t('P9 azione dal percorso', M.azioneDi('/chat-api/eco') === 'eco' && M.azioneDi('/chat-api') === '' && M.azioneDi('/chat-api/Eco!') === '?' && M.azioneDi('/chat-api/misura') === 'misura');
  t('P10 attesa: 0..120 secondi', M.attesaDi('10') === 10 && M.attesaDi('999') === 120 && M.attesaDi('-3') === 0 && M.attesaDi('abc') === 0 && M.attesaDi(null) === 0 && M.attesaDi('2.9') === 2);
}

console.log('\n== la edge intera, richieste vere ==');
{
  const corpo = JSON.stringify({ n: 1, testo: 'prova ' + String.fromCharCode(224, 8364) });
  const anon = await chiama(post(url('eco', SHOPIFY('')), corpo, { 'x-forwarded-for': '203.0.113.7, 93.41.5.6', 'x-forwarded-host': 'amimi.it', 'x-amimi-prova': '1' }));
  t('E1 POST firmato anonimo: 200, firma ok, anonima', anon.r.status === 200 && anon.d?.firma === 'ok' && anon.d?.cliente === 'anonima' && anon.d?.metodo === 'POST', anon.d);
  t('E2 corpo intatto: byte e sha256 uguali, JSON riconosciuto', anon.d?.corpo?.byte === Buffer.byteLength(corpo) && anon.d?.corpo?.sha256 === createHash('sha256').update(corpo).digest('hex') && anon.d?.corpo?.json === true);
  t('E3 no-store e JSON su ogni risposta, nessun CORS', anon.r.headers.get('cache-control') === 'no-store' && /application\/json/.test(anon.r.headers.get('content-type')) && !anon.r.headers.has('access-control-allow-origin'));
  t('E4 negozio, prefix, eta della firma', anon.d?.negozio === 'amimi-10000' && anon.d?.path_prefix_atteso === true && anon.d?.eta_firma_s === 7);
  t('E5 header: XFF contato e mascherato, host, header di prova', anon.d?.header?.xff_voci === 2 && anon.d?.header?.xff_mascherati?.join('|') === '203.0.x.x|93.41.x.x'
    && anon.d?.header?.x_forwarded_host === 'amimi.it' && anon.d?.header?.x_amimi_prova === true && anon.d?.header?.cookie === false, anon.d?.header);
  const loggata = await chiama(post(url('eco', [...SHOPIFY('7412345678901'), ['ip_finto', '203.0.113.7']]), '{}', { 'x-forwarded-for': '203.0.113.7, 93.41.5.6' }));
  t('E6 loggata: "loggata" senza l\'id, ip_finto trovato alla posizione 1 da destra', loggata.r.status === 200 && loggata.d?.cliente === 'loggata' && loggata.d?.header?.pos_ip_finto === 1, loggata.d);
  const valori = ['7412345678901', 'amimi-10000.myshopify.com', '/apps/chat', TS, firma(SHOPIFY('7412345678901')), '203.0.113.7', '93.41.5.6'];
  t('E7 nessun valore firmato (id, shop, prefix, timestamp, signature) ne\' IP intero nella risposta', !valori.some((v) => loggata.testo.includes(v)), valori.filter((v) => loggata.testo.includes(v)));
  t('E8 parametri: solo i nomi, ognuno una volta', loggata.d?.parametri?.logged_in_customer_id === 1 && loggata.d?.parametri?.signature === 1 && loggata.d?.parametri?.ip_finto === 1);
  const get = await chiama(new Request(url('eco', SHOPIFY(''))));
  t('E9 GET firmato: 200, corpo vuoto', get.r.status === 200 && get.d?.corpo?.byte === 0 && get.d?.metodo === 'GET');
  const nonJson = await chiama(post(url('eco', SHOPIFY('')), 'non json'));
  t('E10 corpo non JSON: detto, non rifiutato', nonJson.r.status === 200 && nonJson.d?.corpo?.json === false);
}

console.log('\n== rifiuti, prima di guardare corpo e attesa ==');
{
  attese.length = 0;
  const casi = [
    ['R1 senza segreto: 503 needs_secret', await chiama(post(url('eco', SHOPIFY('')), '{}'), { secret: '' }), 503, 'needs_secret'],
    ['R2 senza firma (chiamata diretta): 401', await chiama(post(url('eco', [], { senzaFirma: true }) + '?attesa=60', '{}')), 401, 'missing_signature'],
    ['R3 firma sbagliata: 401', await chiama(post(url('eco', [...SHOPIFY(''), ['attesa', '60']], { firmaGiusta: false }), '{}')), 401, 'bad_signature'],
    ['R4 firma di un altro segreto: 401', await chiama(post(url('eco', SHOPIFY('')), '{}'), { secret: 'altro' }), 401, 'bad_signature'],
    ['R5 firma scaduta (301 s): 401', await chiama(post(url('eco', SHOPIFY('', String(Math.floor(ORA / 1000) - 301))), '{}')), 401, 'stale_signature'],
    ['R6 id aggiunto dal client e ripetuto: 401', await chiama(post(url('eco', [...SHOPIFY(''), ['logged_in_customer_id', '1']]), '{}')), 401, 'repeated_param'],
    ['R7 shop ripetuto: 401', await chiama(post(url('eco', [...SHOPIFY(''), ['shop', 'altro.myshopify.com']]), '{}')), 401, 'repeated_param'],
    ['R8 id non di sole cifre: 401', await chiama(post(url('eco', SHOPIFY('abc')), '{}')), 401, 'bad_customer_id'],
    ['R9 rotta sconosciuta: 404 anche senza firma', await chiama(post(`${EDGE}/admin`, '{}')), 404, 'not_found'],
    ['R10 dopo SPIKE_FINO: 503 anche firmata', await chiama(post(url('eco', SHOPIFY('', String(Math.floor(M.SPIKE_FINO_MS / 1000)))), '{}'), { ora: M.SPIKE_FINO_MS }), 503, 'spike_finito'],
    ['R11 metodo PUT: 405', await chiama(new Request(url('eco', SHOPIFY('')), { method: 'PUT', body: '{}' })), 405, 'method_not_allowed'],
  ];
  for (const [nome, res, status, err] of casi) t(nome, res.r.status === status && (res.d?.error === err || res.d?.state === err) && res.r.headers.get('cache-control') === 'no-store', { status: res.r.status, d: res.d });
  t('R12 nessuna attesa eseguita per richieste rifiutate', attese.length === 0, attese);
  const r2 = await chiama(post(url('eco', [...SHOPIFY(''), ['signature', 'b'.repeat(64)]]), '{}'));
  t('R13 signature ripetuta: 401', r2.r.status === 401, r2.d);
  const grande = await chiama(post(url('eco', SHOPIFY('')), 'x'.repeat(65537)));
  t('R14 corpo oltre 64 KB: 413', grande.r.status === 413 && grande.d?.error === 'body_too_large');
  const opt = await chiama(new Request(`${EDGE}/eco`, { method: 'OPTIONS' }));
  t('R15 OPTIONS: 204 senza CORS', opt.r.status === 204 && !opt.r.headers.has('access-control-allow-origin'));
  t('R16 SPIKE_FINO fissato al 7 dicembre 2026', M.SPIKE_FINO_MS === Date.parse('2026-12-07T00:00:00Z'));
}

console.log('\n== attesa (S3) ==');
{
  attese.length = 0;
  const r = await chiama(new Request(url('eco', [...SHOPIFY(''), ['attesa', '30']])));
  t('A1 attesa=30: la edge aspetta 30 s e lo dice', r.r.status === 200 && r.d?.attesa_s === 30 && attese.join() === '30000', { d: r.d?.attesa_s, attese });
  attese.length = 0;
  const r2 = await chiama(new Request(url('eco', [...SHOPIFY(''), ['attesa', '9999']])));
  t('A2 attesa oltre 120 s: tagliata a 120', r2.d?.attesa_s === 120 && attese.join() === '120000');
}

console.log('\n== pagina delle misure ==');
{
  const g = await chiama(new Request(url('misura', SHOPIFY(''))));
  t('M1 GET /misura firmata: 200 HTML con no-store', g.r.status === 200 && /text\/html/.test(g.r.headers.get('content-type')) && g.r.headers.get('cache-control') === 'no-store');
  const senza = await chiama(new Request(url('misura', [], { senzaFirma: true })));
  t('M2 /misura senza firma: 401', senza.r.status === 401);
  const p = await chiama(post(url('misura', SHOPIFY('')), '{}'));
  t('M3 POST /misura: 405', p.r.status === 405);
  const html = M.PAGINA_MISURA;
  const js = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
  let sintassi = null; try { new Script(js); } catch (e) { sintassi = e.message; }
  t('M4 lo script della pagina e\' JavaScript valido', sintassi === null, sintassi);
  t('M5 niente innerHTML, storage, cookie, eval', !/innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function/.test(html));
  t('M6 nessuna risorsa esterna caricata dalla pagina', !/<script[^>]+src=|<link[^>]+href=|<img|<iframe/.test(html));
  t('M7 fuori dalla vetrina chiama solo la edge stessa, in no-cors e senza credenziali', (html.match(/https:\/\/[a-z0-9.-]+/g) ?? []).every((h) => h === 'https://imszbjeyplaiovylhkgl.supabase.co') && /mode: 'no-cors', cache: 'no-store', credentials: 'omit'/.test(html));
  t('M8 id finto di S1 non e\' di una cliente (1) e XFF finto in TEST-NET-3', /logged_in_customer_id=1'/.test(html) && /203\.0\.113\.7/.test(html));
  t('M9 soglia di S2 = 1 secondo (D-7 di Dan)', /soglia_ms: 1000/.test(html) && /diff <= 1000/.test(html));
}

console.log('\n== guardie sul sorgente ==');
{
  const fuori = SRC.slice(0, a) + SRC.slice(b);
  const codice = BLOCCO.slice(0, BLOCCO.indexOf('const PAGINA_MISURA'));
  t('G1 nessun import, nessun client Supabase, nessuna fetch nella edge', !/\bimport\b|createClient|\bfetch\(/.test(codice + fuori.replace(/^\/\/.*$/gm, '')));
  t('G2 nessun log (corpi, header, parametri)', !/console\./.test(SRC));
  t('G3 segreto solo da CHAT_APP_PROXY_SECRET (mai quello di Premia, mai app_flags)', /Deno\.env\.get\('CHAT_APP_PROXY_SECRET'\)/.test(fuori) && !/SHOPIFY_APP_PROXY_SECRET|app_flags|shopify_app_proxy_secret/.test(SRC.replace(/^\/\/.*$/gm, '')));
  const pos = (s) => codice.indexOf(s);
  t('G4 ordine: segreto, firma, ripetuti, eta, id; poi corpo e attesa', pos("if (!secret)") < pos('missing_signature') && pos('missing_signature') < pos('bad_signature') && pos('bad_signature') < pos('repeated_param')
    && pos('repeated_param') < pos('stale_signature') && pos('stale_signature') < pos('bad_customer_id') && pos('bad_customer_id') < pos('req.arrayBuffer()') && pos('bad_customer_id') < pos('await dorme('));
  t('G5 ogni Response porta HEADER_BASE (no-store)', (codice.match(/new Response\(/g) ?? []).length === (codice.match(/new Response\([^\n]*HEADER_BASE/g) ?? []).length);
  t('G6 nessun header CORS', !/Access-Control-Allow/i.test(SRC));
  t('G7 nella risposta nessun params.get messo cosi\' com\'e\' (solo confronti e conteggi)', !/:\s*params\.get\('[a-z_]+'\)\s*[,}\n]/.test(codice) && !/\.\.\.\s*params/.test(codice));
  t('G8 [functions.chat-api] verify_jwt = false in config.toml', /\[functions\.chat-api\]\s*\nverify_jwt = false/.test(CONFIG));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
