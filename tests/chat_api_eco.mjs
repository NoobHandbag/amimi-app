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
  'posDaDestra', 'contaParametri', 'azioneDi', 'attesaDi', 'SPIKE_FINO_MS', 'MAX_SKEW_SEC', 'PAGINA_MISURA', 'nomiHeader', 'headerConIp',
  'esitoSiteverify', 'SITEVERIFY_URL', 'TOKEN_MAX'];
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
// siteverify finto (eco-2): registra le chiamate; `rispostaSv` decide cosa risponde Cloudflare
const verifiche = [];
let rispostaSv = { success: true, hostname: 'amimi.it', challenge_ts: '2026-11-10T09:59:50.000Z', 'error-codes': [], action: '', cdata: '' };
const siteverify = async (secret, token) => { verifiche.push({ secret, token }); if (rispostaSv instanceof Error) throw rispostaSv; return rispostaSv; };
const TS_SECRET = 'segreto-turnstile-di-prova';
const chiama = async (req, { ora = ORA, secret = SECRET, tsSecret = TS_SECRET } = {}) => {
  const r = await M.gestisci(req, ora, secret, dorme, { secret: tsSecret, siteverify });
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
  const valoriAnon = ['amimi-10000.myshopify.com', '/apps/chat', TS, firma(SHOPIFY('')), '203.0.113.7', '93.41.5.6'];
  t('E7b nemmeno nella risposta anonima e in quella GET', ![anon.testo, get.testo].some((x) => valoriAnon.some((v) => x.includes(v))));
  const proto = await chiama(new Request(url('eco', [...SHOPIFY(''), ['constructor', '1'], ['__proto__', '1'], ['toString', '1']])));
  t('E7c nomi come constructor, __proto__ e toString contati come gli altri', proto.d?.parametri?.constructor === 1 && proto.d?.parametri?.__proto__ === 1 && proto.d?.parametri?.toString === 1, proto.d?.parametri);
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
  // Gate 2 del 07-11: un corpo a pezzi senza content-length si ferma al tetto, non viene letto tutto
  let letti = 0;
  const flusso = new ReadableStream({ pull(c) { if (letti >= 1048576) { c.close(); return; } letti += 16384; c.enqueue(new Uint8Array(16384)); } });
  const chunk = await chiama(new Request(url('eco', SHOPIFY('')), { method: 'POST', body: flusso, duplex: 'half' }));
  t('R14b corpo a pezzi senza content-length oltre 64 KB: 413 e lettura fermata', chunk.r.status === 413 && letti < 1048576, { status: chunk.r.status, letti });
  const piccolo = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"a":')); c.enqueue(new TextEncoder().encode('1}')); c.close(); } });
  const pz = await chiama(new Request(url('eco', SHOPIFY('')), { method: 'POST', body: piccolo, duplex: 'half' }));
  t('R14c corpo a pezzi piccolo: ricomposto intero', pz.r.status === 200 && pz.d?.corpo?.byte === 7 && pz.d?.corpo?.sha256 === createHash('sha256').update('{"a":1}').digest('hex') && pz.d?.corpo?.json === true, pz.d?.corpo);
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

console.log('\n== eco-2: nomi degli header e IP dichiarato (S1) ==');
{
  const r = await chiama(post(url('eco', [...SHOPIFY(''), ['ip_atteso', '93.41.5.6']]), '{}', { 'x-forwarded-for': '203.0.113.7', 'x-client-ip': '93.41.5.6', 'x-altro': 'niente' }));
  t('H1 nomi degli header elencati, ordinati', Array.isArray(r.d?.header?.nomi) && r.d.header.nomi.includes('x-client-ip') && r.d.header.nomi.includes('x-altro') && r.d.header.nomi.join() === [...r.d.header.nomi].sort().join(), r.d?.header?.nomi);
  t('H2 ip_atteso trovato per nome di header, mai il valore', r.d?.header?.ip_atteso_in?.join() === 'x-client-ip' && !r.testo.includes('93.41.5.6') && !r.testo.includes('niente'), r.d?.header?.ip_atteso_in);
  const h = new Headers(); for (let i = 0; i < 80; i++) h.append('x-h' + i, 'v');
  t('H3 al massimo 60 nomi', M.nomiHeader(h).length === 60);
  t('H4 ip_atteso non plausibile: nessuna ricerca', M.headerConIp(new Headers({ a: 'xyz' }), 'x').length === 0 && M.headerConIp(new Headers({ a: '1.1.1.1' }), null).length === 0 && M.headerConIp(new Headers({ a: 'abc' }), 'abc').length === 0);
}

console.log('\n== eco-2: rotta /turnstile (S6) ==');
{
  const tok = 'tok-' + 'a'.repeat(40);
  verifiche.length = 0;
  rispostaSv = { success: true, hostname: 'amimi.it', challenge_ts: '2026-11-10T09:59:50.000Z', 'error-codes': [], action: 'x', cdata: 'segreto-del-cliente' };
  const ok = await chiama(post(url('turnstile', SHOPIFY('')), JSON.stringify({ token: tok })));
  t('T1 token valido: 200 con success, hostname, codici ed eta della sfida', ok.r.status === 200 && ok.d?.success === true && ok.d?.hostname === 'amimi.it' && Array.isArray(ok.d?.error_codes) && ok.d?.eta_sfida_s === 10, ok.d);
  t('T2 siteverify chiamato una volta col secret di prova e il token', verifiche.length === 1 && verifiche[0].secret === TS_SECRET && verifiche[0].token === tok);
  t('T3 nella risposta mai token, secret, action o cdata', ![tok, TS_SECRET, 'segreto-del-cliente', SECRET].some((v) => ok.testo.includes(v)) && !('action' in (ok.d ?? {})) && !('cdata' in (ok.d ?? {})), ok.testo);
  rispostaSv = { success: false, 'error-codes': ['invalid-input-response', 'Bad Code!', 7], hostname: 'evil host' };
  const no = await chiama(post(url('turnstile', SHOPIFY('')), JSON.stringify({ token: tok })));
  t('T4 token rifiutato: success false, solo codici puliti, hostname sporco reso ?', no.r.status === 200 && no.d?.success === false && no.d?.error_codes?.join() === 'invalid-input-response' && no.d?.hostname === '?', no.d);
  rispostaSv = new Error('rete');
  const giu = await chiama(post(url('turnstile', SHOPIFY('')), JSON.stringify({ token: tok })));
  t('T5 siteverify irraggiungibile: 502, mai "passa"', giu.r.status === 502 && giu.d?.error === 'siteverify_unreachable' && giu.d?.success === undefined);
  rispostaSv = { success: true, hostname: 'amimi.it' };
  verifiche.length = 0;
  const casi = [
    ['T6 senza secret di Turnstile: 503', await chiama(post(url('turnstile', SHOPIFY('')), JSON.stringify({ token: tok })), { tsSecret: '' }), 503],
    ['T7 GET: 405', await chiama(new Request(url('turnstile', SHOPIFY('')))), 405],
    ['T8 senza firma: 401', await chiama(post(url('turnstile', [], { senzaFirma: true }), JSON.stringify({ token: tok }))), 401],
    ['T9 token assente: 400', await chiama(post(url('turnstile', SHOPIFY('')), '{}')), 400],
    ['T10 token non stringa: 400', await chiama(post(url('turnstile', SHOPIFY('')), JSON.stringify({ token: 12345678 }))), 400],
    ['T11 token oltre 2048: 400', await chiama(post(url('turnstile', SHOPIFY('')), JSON.stringify({ token: 'a'.repeat(M.TOKEN_MAX + 1) }))), 400],
    ['T12 corpo non JSON: 400', await chiama(post(url('turnstile', SHOPIFY('')), 'token=abc')), 400],
    ['T13 corpo oltre 4 KB: 413', await chiama(post(url('turnstile', SHOPIFY('')), JSON.stringify({ token: 'a'.repeat(5000) }))), 413],
    ['T14 JSON null: 400', await chiama(post(url('turnstile', SHOPIFY('')), 'null')), 400],
  ];
  for (const [nome, res, st] of casi) t(nome, res.r.status === st && res.r.headers.get('cache-control') === 'no-store', { status: res.r.status, d: res.d });
  t('T15 nessun siteverify per le richieste rifiutate', verifiche.length === 0, verifiche.length);
  t('T16 esitoSiteverify su risposta non oggetto', JSON.stringify(M.esitoSiteverify(null, ORA)) === JSON.stringify({ success: false, hostname: null, error_codes: [], eta_sfida_s: null }));
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
  t('M7 fuori dalla vetrina solo la edge (no-cors, senza credenziali) e lo script di Turnstile', (html.match(/https:\/\/[a-z0-9.-]+/g) ?? []).every((h) => h === 'https://imszbjeyplaiovylhkgl.supabase.co' || h === 'https://challenges.cloudflare.com') && /mode: 'no-cors', cache: 'no-store', credentials: 'omit'/.test(html));
  // eco-2: lo script di Turnstile si carica solo dentro s6 (al clic), con la sitekey dall'indirizzo controllata
  const s6 = js.slice(js.indexOf('function caricaTurnstile'), js.indexOf("document.getElementById('b-s4')"));
  t('M10 Turnstile caricato solo da caricaTurnstile, chiamata solo da s6 e dal suo pulsante', (js.match(/challenges\.cloudflare\.com/g) ?? []).length === 1 && s6.includes('challenges.cloudflare.com')
    && (js.match(/caricaTurnstile\(\)/g) ?? []).length === 2 && (js.match(/await caricaTurnstile\(\)/g) ?? []).length === 1 && /esegui\('S6', s6\)/.test(js) && /\[0-9A-Za-z_-\]\{10,64\}/.test(s6));
  t('M11 S6 manda il token solo a /apps/chat/turnstile della stessa origine e mostra solo esito e hostname', /fetch\(BASE \+ '\/turnstile'/.test(s6) && !/token:\s*token[^}]*\}\s*\)\s*;\s*aggiungi/.test(s6) && !/ris\.s6 = \{[^}]*token/.test(s6));
  t('M12 il contenitore del widget c\'e\'', /<div id="ts"><\/div>/.test(html));
  t('M8 id finto di S1 non e\' di una cliente (1) e XFF finto in TEST-NET-3', /logged_in_customer_id=1'/.test(html) && /203\.0\.113\.7/.test(html));
  t('M9 soglia di S2 = 1 secondo (D-7 di Dan)', /soglia_ms: 1000/.test(html) && /diff <= 1000/.test(html));
}

console.log('\n== guardie sul sorgente ==');
{
  const fuori = SRC.slice(0, a) + SRC.slice(b);
  const codice = BLOCCO.slice(0, BLOCCO.indexOf('const PAGINA_MISURA'));
  const fuoriCodice = fuori.replace(/^\/\/.*$/gm, '');
  t('G1 nessun import ne\' client Supabase; nessuna fetch nel blocco puro', !/\bimport\b|createClient|\bfetch\(/.test(codice + fuoriCodice.replace(/fetch\(SITEVERIFY_URL/, '')));
  t('G1b fuori dal blocco una sola fetch, verso SITEVERIFY_URL, POST col secret nel corpo e tetto di 10 s', (fuoriCodice.match(/\bfetch\(/g) ?? []).length === 1
    && /fetch\(SITEVERIFY_URL, \{ method: 'POST', body: new URLSearchParams\(\{ secret, response: token \}\), signal: AbortSignal\.timeout\(10000\) \}\)/.test(fuoriCodice)
    && M.SITEVERIFY_URL === 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  t('G1c secret di Turnstile solo da CHAT_TURNSTILE_PROVA_SECRET', /Deno\.env\.get\('CHAT_TURNSTILE_PROVA_SECRET'\)/.test(fuoriCodice));
  t('G2 nessun log (corpi, header, parametri)', !/console\./.test(SRC));
  t('G3 segreto solo da CHAT_APP_PROXY_SECRET (mai quello di Premia, mai app_flags)', /Deno\.env\.get\('CHAT_APP_PROXY_SECRET'\)/.test(fuori) && !/SHOPIFY_APP_PROXY_SECRET|app_flags|shopify_app_proxy_secret/.test(SRC.replace(/^\/\/.*$/gm, '')));
  const pos = (s) => codice.indexOf(s);
  t('G4 ordine: segreto, firma, ripetuti, eta, id; poi corpo e attesa', pos("if (!secret)") < pos('missing_signature') && pos('missing_signature') < pos('bad_signature') && pos('bad_signature') < pos('repeated_param')
    && pos('repeated_param') < pos('stale_signature') && pos('stale_signature') < pos('bad_customer_id') && pos('bad_customer_id') < pos('await leggiCorpo(req') && pos('bad_customer_id') < pos('await dorme('));
  t('G5 ogni Response porta HEADER_BASE (no-store)', (codice.match(/new Response\(/g) ?? []).length === (codice.match(/new Response\([^\n]*HEADER_BASE/g) ?? []).length);
  t('G6 nessun header CORS', !/Access-Control-Allow/i.test(SRC));
  t('G7 nella risposta nessun params.get messo cosi\' com\'e\' (solo confronti e conteggi)', !/:\s*params\.get\('[a-z_]+'\)\s*[,}\n]/.test(codice) && !/\.\.\.\s*params/.test(codice));
  t('G8 [functions.chat-api] verify_jwt = false in config.toml', /\[functions\.chat-api\]\s*\nverify_jwt = false/.test(CONFIG));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
