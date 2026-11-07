// chat-api eco-2 (2026-11-07): ECO DELLO SPIKE di Fase 0 della chat del sito (docs/PROPOSTA_chat_sito.md 13.3, decisione
// D-4 di Dan del 6 novembre 2026). NON e' la chat: nessuna tabella, nessuna lettura o scrittura del DB; l'unica chiamata
// fuori e' il siteverify di Turnstile (S6). Risponde con conteggi e tempi per misurare l'App Proxy dell'app Shopify "Amimi
// Chat" (amimi.it/apps/chat/<azione> arriva qui come /chat-api/<azione>, shopify/amimi-chat/shopify.app.toml). Si spegne da
// sola a SPIKE_FINO (503); la Fase 1 la riscrive da capo.
// eco-2 (stesso giorno, dopo S1): `eco` dice anche i NOMI degli header che arrivano e quali contengono l'IP dichiarato in
// `ip_atteso` (S1 ha visto che l'IP del client non e' in X-Forwarded-For); rotta `POST /turnstile` per S6 (token del widget
// di prova -> siteverify col secret di prova; risponde solo esito, hostname, codici d'errore ed eta' della sfida); pulsante
// S6 nella pagina /misura, che carica lo script di Turnstile solo al clic, con la sitekey presa da `?sitekey=`.
//
// Rotte, tutte con la firma del proxy (verify_jwt = false in supabase/config.toml: il proxy non manda JWT):
//   GET|POST /eco     JSON: firma ok, eta' della firma, anonima o loggata (mai l'id), quante volte compare ogni nome di
//                     parametro, X-Forwarded-For (quante voci, IP mascherati, posizione da destra degli IP che il client
//                     dichiara in `ip_atteso` e `ip_finto`), corpo (byte, sha256, JSON si' o no), tempi. `?attesa=<s>`
//                     (al massimo 120) ritarda la risposta per misurare il timeout del proxy (S3).
//   GET /misura       pagina HTML per il team con i pulsanti delle misure S1-S4: gira sul telefono e sul PC, stessa origine
//                     della vetrina, non salva nulla sul dispositivo.
//   POST /turnstile   (eco-2, S6) {token} -> siteverify col secret di prova: success, hostname, codici, eta' della sfida.
//   altro             404, prima di ogni altro controllo.
// Firma come loyalty-proxy (HMAC-SHA256 esadecimale dei parametri ordinati, confronto a tempo costante, timestamp entro
// 300 s), piu' i controlli di sez. 5.2: 401 se `shop`, `logged_in_customer_id`, `path_prefix`, `timestamp` o `signature`
// compaiono piu' di una volta, o se `logged_in_customer_id` non e' vuoto e non e' di sole cifre.
// Segreto: env CHAT_APP_PROXY_SECRET, il client secret di "Amimi Chat" (lo mette Dan fra i segreti delle edge; separato da
// quello di Premia). Assente: 503 needs_secret. Nella risposta mai il valore dei parametri firmati; nessun log.
// Secret del widget Turnstile di PROVA: env CHAT_TURNSTILE_PROVA_SECRET (Dan). Assente: /turnstile risponde 503
// needs_turnstile_secret. Il token non torna mai indietro e non si logga.
// Ogni risposta ha Cache-Control: no-store. Nessun header CORS: il widget chiama dalla stessa origine (sez. 4.8).

// ==== PURE:chat-eco BEGIN ====
const VERSIONE = 'eco-2';
const SPIKE_FINO_MS = Date.parse('2026-12-07T00:00:00Z');
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TOKEN_MAX = 2048;                // lunghezza massima di un token Turnstile (doc Cloudflare, validazione lato server)
const CORPO_TURNSTILE_MAX = 4096;
const MAX_SKEW_SEC = 300;
const ATTESA_MAX_S = 120;
const CORPO_MAX_BYTE = 65536;
const NEGOZI_NOTI: Record<string, string> = { 'amimi-10000.myshopify.com': 'amimi-10000', 'wb9gmn-0h.myshopify.com': 'wb9gmn-0h' };
const PREFIX_ATTESO = '/apps/chat';
const PARAM_SHOPIFY_UNICI = ['logged_in_customer_id', 'path_prefix', 'shop', 'timestamp', 'signature'];
const HEADER_BASE: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...HEADER_BASE, 'Content-Type': 'application/json; charset=utf-8' } });

const esadecimale = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// HMAC App Proxy: hex(HMAC-SHA256(secret, join ordinato dei parametri esclusa `signature`)); valori ripetuti uniti con ','
// e coppie key=value concatenate senza separatore. Copia di loyalty-proxy (appProxyHmacHex).
async function appProxyHmacHex(params: URLSearchParams, secret: string): Promise<string> {
  const grouped = new Map<string, string[]>();
  for (const [k, v] of params) {
    if (k === 'signature') continue;
    (grouped.get(k) ?? grouped.set(k, []).get(k)!).push(v);
  }
  const message = [...grouped.keys()].sort().map((k) => `${k}=${grouped.get(k)!.join(',')}`).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return esadecimale(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))));
}
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const paramRipetuti = (params: URLSearchParams): string[] => PARAM_SHOPIFY_UNICI.filter((k) => params.getAll(k).length > 1);
const idClienteValido = (v: string): boolean => v === '' || /^[0-9]{1,20}$/.test(v);
// eta' della firma in secondi, o null se manca, non e' un numero o sta fuori da MAX_SKEW_SEC (anche nel futuro)
function etaFirma(ts: string | null, oraMs: number): number | null {
  if (ts === null || !/^[0-9]{1,12}$/.test(ts)) return null;
  const eta = Math.round(oraMs / 1000 - Number(ts));
  return Math.abs(eta) > MAX_SKEW_SEC ? null : eta;
}

// IP mascherati: il chiamante riconosce il suo prefisso, nessun indirizzo intero esce dalla edge
function mascheraIp(ip: string): string {
  const s = ip.trim();
  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.x.x`;
  if (s.includes(':') && /^[0-9a-f:]+$/i.test(s)) return s.split(':').slice(0, 2).join(':') + ':x';
  return '?';
}
const vociXff = (h: string | null): string[] => (h ?? '').split(',').map((v) => v.trim()).filter(Boolean).slice(0, 20);
// posizione contata da destra (0 = ultima voce, quella aggiunta dall'ultimo passaggio), null se assente
function posDaDestra(voci: string[], ip: string | null): number | null {
  if (!ip) return null;
  const i = voci.lastIndexOf(ip.trim());
  return i < 0 ? null : voci.length - 1 - i;
}
// solo i NOMI dei parametri, con quante volte compaiono; mai i valori
function contaParametri(params: URLSearchParams): Record<string, number> {
  // senza prototipo: un parametro chiamato `constructor` o `__proto__` si conta come gli altri (Gate 2 del 07-11)
  const out: Record<string, number> = Object.create(null);
  for (const k of params.keys()) {
    const nome = /^[a-z0-9_]{1,40}$/i.test(k) ? k : '(altro)';
    if (!(nome in out) && Object.keys(out).length >= 30) { out['(oltre 30)'] = (out['(oltre 30)'] ?? 0) + 1; continue; }
    out[nome] = (out[nome] ?? 0) + 1;
  }
  return out;
}
function azioneDi(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  if (last === 'chat-api') return '';
  return /^[a-z0-9_-]{1,30}$/.test(last) ? last : '?';
}
function attesaDi(v: string | null): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, ATTESA_MAX_S) : 0;
}
// corpo letto a pezzi e fermato appena supera il tetto, anche senza content-length (Gate 2 del 07-11); null = troppo grande
async function leggiCorpo(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const pezzi: Uint8Array[] = [];
  let tot = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tot += value.byteLength;
    if (tot > max) { await reader.cancel(); return null; }
    pezzi.push(value);
  }
  const out = new Uint8Array(tot);
  let at = 0;
  for (const p of pezzi) { out.set(p, at); at += p.byteLength; }
  return out;
}
const hostPulito = (h: string | null): string | null => (h === null ? null : /^[a-z0-9.-]{1,120}$/i.test(h) ? h.toLowerCase() : '?');

// eco-2: soli NOMI degli header (mai i valori), e quali contengono l'IP che il client dichiara (S1)
const nomeHeader = (k: string) => (/^[a-z0-9-]{1,60}$/.test(k) ? k : '(altro)');
// prima si ordinano tutti, poi si taglia, e si dice quanti restano fuori (Gate 2 del 07-11)
function nomiHeader(h: Headers): string[] {
  const tutti = [...h.keys()].map(nomeHeader).sort();
  return tutti.length > 60 ? [...tutti.slice(0, 60), `(altri ${tutti.length - 60})`] : tutti;
}
// confronto esatto voce per voce (virgole e spazi separano), mai per sottostringa: 1.2.3.4 non e' dentro 21.2.3.45
function headerConIp(h: Headers, ip: string | null): string[] {
  if (!ip || !/^[0-9a-f.:]{7,45}$/i.test(ip)) return [];
  const cerca = ip.toLowerCase();
  const out: string[] = [];
  for (const [k, v] of h) if (v.toLowerCase().split(/[\s,;]+/).includes(cerca)) out.push(nomeHeader(k));
  return out.sort();
}
// esito di siteverify ridotto a cio' che serve a S6: niente token, niente altri campi
function esitoSiteverify(r: unknown, oraMs: number) {
  const o = r !== null && typeof r === 'object' ? (r as Record<string, unknown>) : {};
  const codici = Array.isArray(o['error-codes'])
    ? (o['error-codes'] as unknown[]).filter((c): c is string => typeof c === 'string' && /^[a-z0-9-]{1,40}$/.test(c)).slice(0, 5)
    : [];
  const sfida = typeof o.challenge_ts === 'string' ? Date.parse(o.challenge_ts) : NaN;
  return {
    success: o.success === true,
    hostname: typeof o.hostname === 'string' ? hostPulito(o.hostname) : null,
    error_codes: codici,
    eta_sfida_s: Number.isFinite(sfida) ? Math.round((oraMs - sfida) / 1000) : null,
  };
}
type Turnstile = { secret: string; siteverify: (secret: string, token: string) => Promise<unknown> };

async function gestisci(req: Request, oraMs: number, secret: string, dorme: (ms: number) => Promise<unknown>, ts: Turnstile): Promise<Response> {
  const t0 = performance.now();
  if (oraMs >= SPIKE_FINO_MS) return json({ error: 'spike_finito' }, 503);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADER_BASE });
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const url = new URL(req.url);
  const params = url.searchParams;
  const azione = azioneDi(url.pathname);
  if (azione !== 'eco' && azione !== 'misura' && azione !== 'turnstile') return json({ error: 'not_found' }, 404);

  if (!secret) return json({ state: 'needs_secret' }, 503);
  const signature = params.get('signature') ?? '';
  if (!signature) return json({ error: 'missing_signature' }, 401);
  if (!timingSafeEqualHex(signature.toLowerCase(), await appProxyHmacHex(params, secret))) return json({ error: 'bad_signature' }, 401);
  const ripetuti = paramRipetuti(params);
  if (ripetuti.length) return json({ error: 'repeated_param', nomi: ripetuti }, 401);
  const eta = etaFirma(params.get('timestamp'), oraMs);
  if (eta === null) return json({ error: 'stale_signature' }, 401);
  const cliente = params.get('logged_in_customer_id') ?? '';
  if (!idClienteValido(cliente)) return json({ error: 'bad_customer_id' }, 401);

  if (azione === 'misura') {
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    return new Response(PAGINA_MISURA, { status: 200, headers: { ...HEADER_BASE, 'Content-Type': 'text/html; charset=utf-8' } });
  }

  if (azione === 'turnstile') {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!ts.secret) return json({ state: 'needs_turnstile_secret' }, 503);
    const buf = await leggiCorpo(req, CORPO_TURNSTILE_MAX);
    if (buf === null) return json({ error: 'body_too_large' }, 413);
    let token = '';
    try {
      const d = JSON.parse(new TextDecoder().decode(buf));
      token = d !== null && typeof d === 'object' && typeof d.token === 'string' ? d.token : '';
    } catch { token = ''; }
    if (!token || token.length > TOKEN_MAX) return json({ error: 'bad_token' }, 400);
    let esito: unknown;
    try { esito = await ts.siteverify(ts.secret, token); } catch { return json({ error: 'siteverify_unreachable' }, 502); }
    return json({ ok: true, versione: VERSIONE, azione, ...esitoSiteverify(esito, oraMs), edge_ms: Math.round(performance.now() - t0) });
  }

  let corpo = { byte: 0, sha256: '', json: false };
  if (req.method === 'POST') {
    if (Number(req.headers.get('content-length') ?? 0) > CORPO_MAX_BYTE) return json({ error: 'body_too_large' }, 413);
    const buf = await leggiCorpo(req, CORPO_MAX_BYTE);
    if (buf === null) return json({ error: 'body_too_large' }, 413);
    let isJson = false;
    try { JSON.parse(new TextDecoder().decode(buf)); isJson = true; } catch { isJson = false; }
    corpo = { byte: buf.byteLength, sha256: esadecimale(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))), json: isJson };
  }
  const attesa = attesaDi(params.get('attesa'));
  if (attesa) await dorme(attesa * 1000);

  const h = req.headers;
  const xff = vociXff(h.get('x-forwarded-for'));
  const ipSolo = (v: string | null) => (v ? mascheraIp(v) : null);
  return json({
    ok: true,
    versione: VERSIONE,
    azione,
    metodo: req.method,
    firma: 'ok',
    eta_firma_s: eta,
    negozio: Object.hasOwn(NEGOZI_NOTI, params.get('shop') ?? '') ? NEGOZI_NOTI[params.get('shop') ?? ''] : 'altro',
    path_prefix_atteso: params.get('path_prefix') === PREFIX_ATTESO,
    cliente: cliente ? 'loggata' : 'anonima',
    parametri: contaParametri(params),
    header: {
      xff_voci: xff.length,
      xff_mascherati: xff.map(mascheraIp),
      pos_ip_atteso: posDaDestra(xff, params.get('ip_atteso')),
      pos_ip_finto: posDaDestra(xff, params.get('ip_finto')),
      x_real_ip: ipSolo(h.get('x-real-ip')),
      cf_connecting_ip: ipSolo(h.get('cf-connecting-ip')),
      x_forwarded_host: hostPulito(h.get('x-forwarded-host')),
      cookie: h.has('cookie'),
      x_amimi_prova: h.has('x-amimi-prova'),
      content_type: (h.get('content-type') ?? '').split(';')[0].trim().slice(0, 60),
      nomi: nomiHeader(h),
      ip_atteso_in: headerConIp(h, params.get('ip_atteso')),
    },
    corpo,
    attesa_s: attesa,
    ora_server_ms: oraMs,
    edge_ms: Math.round(performance.now() - t0),
  });
}

// Pagina delle misure. Niente innerHTML, niente storage, niente cookie scritti: risultati a video e, a richiesta, negli
// appunti. La chiamata diretta (S2) va all'indirizzo della edge senza firma e riceve 401: serve solo il tempo di andata e
// ritorno, in modalita' no-cors, senza leggere la risposta.
const PAGINA_MISURA = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Amimi Chat, misure</title>
<style>body{font:15px/1.45 system-ui,-apple-system,sans-serif;margin:16px;max-width:760px;color:#222;background:#fff}
button{font:inherit;padding:10px 14px;margin:4px 6px 4px 0;border:1px solid #999;border-radius:8px;background:#f3f3f3}
button:disabled{opacity:.5}pre{white-space:pre-wrap;word-break:break-word;background:#f6f6f6;padding:10px;border-radius:8px;font-size:13px}</style>
</head><body>
<h1>Amimi Chat: misure della Fase 0</h1>
<p>Pagina di prova del team. Misura solo tempi e risposte del collegamento; non salva nulla sul telefono.
Tieni lo schermo acceso finche' una misura non dice FINITO.</p>
<p>Rete: <b id="rete"></b></p>
<div>
<button id="b-s1">S1: 100 invii</button>
<button id="b-s2">S2: velocita'</button>
<button id="b-s3">S3: cache e attese (4 min)</button>
<button id="b-s4">S4: 10 minuti ogni 3 s</button>
<button id="b-s6">S6: Turnstile</button>
<button id="b-copia">Copia i risultati</button>
</div>
<div id="ts"></div>
<pre id="out">Pronta.</pre>
<script>
(function () {
  var p = location.pathname, i = p.lastIndexOf('/misura');
  var BASE = i >= 0 ? p.slice(0, i) : '/apps/chat';
  var DIRETTA = 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/chat-api/eco';
  var out = document.getElementById('out');
  var ris = { pagina: 'eco-1', host: location.host, inizio: new Date().toISOString() };
  function rete() { var c = navigator.connection; return c ? String(c.effectiveType || '?') + (c.type ? ' / ' + c.type : '') : 'non nota'; }
  document.getElementById('rete').textContent = rete();
  function scrivi(s) { out.textContent = s; }
  function aggiungi(s) { out.textContent += '\\n' + s; }
  function adesso() { return performance.now(); }
  function perc(a, q) { if (!a.length) return null; var b = a.slice().sort(function (x, y) { return x - y; }); return Math.round(b[Math.max(0, Math.ceil(q * b.length) - 1)]); }
  function riassunto(a) { return { n: a.length, p50: perc(a, 0.5), p95: perc(a, 0.95), min: perc(a, 0), max: perc(a, 1) }; }
  function pausa(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function eco(metodo, query, corpo, extra) {
    var h = {};
    if (corpo !== undefined) h['Content-Type'] = 'application/json';
    if (extra) for (var k in extra) h[k] = extra[k];
    var t = adesso();
    return fetch(BASE + '/eco' + (query || ''), { method: metodo, headers: h, body: corpo, cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        return r.text().then(function (txt) {
          var d = null; try { d = JSON.parse(txt); } catch (e) { d = null; }
          return { status: r.status, ms: adesso() - t, d: d, cc: r.headers.get('cache-control'), age: r.headers.get('age') };
        });
      })
      .catch(function () { return { status: 0, ms: adesso() - t, d: null }; });
  }
  function diretta() {
    var t = adesso();
    return fetch(DIRETTA, { method: 'POST', mode: 'no-cors', cache: 'no-store', credentials: 'omit', body: 'x' })
      .then(function () { return adesso() - t; }).catch(function () { return null; });
  }
  function sha(txt) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    });
  }
  function bottoni(on) { var bs = document.querySelectorAll('button'); for (var j = 0; j < bs.length; j++) if (bs[j].id !== 'b-copia') bs[j].disabled = !on; }
  function esegui(nome, fn) { bottoni(false); fn().then(function () { aggiungi('\\nFINITO ' + nome); }, function (e) { aggiungi('\\nERRORE ' + nome + ': ' + String(e)); }).then(function () { bottoni(true); }); }

  async function s1() {
    scrivi('S1: 100 invii...');
    var ok = 0, ko = [], cli = {}, tempi = [], ultimo = null;
    for (var n = 0; n < 100; n++) {
      var corpo = JSON.stringify({ n: n, testo: 'prova ' + n + ' ' + String.fromCharCode(224, 232, 8364) });
      var atteso = await sha(corpo);
      var r = await eco('POST', '?s1=' + n, corpo);
      tempi.push(r.ms);
      if (r.d && r.d.cliente) cli[r.d.cliente] = (cli[r.d.cliente] || 0) + 1;
      if (r.status === 200 && r.d && r.d.firma === 'ok' && r.d.corpo && r.d.corpo.sha256 === atteso && r.d.corpo.json) { ok++; ultimo = r.d; }
      else if (ko.length < 5) ko.push({ n: n, status: r.status, errore: r.d && (r.d.error || r.d.state) });
      if (n % 10 === 9) aggiungi('  ' + (n + 1) + '/100');
    }
    var finto = await eco('POST', '?logged_in_customer_id=1', '{}');
    var xff = await eco('POST', '?ip_finto=203.0.113.7', '{}', { 'X-Forwarded-For': '203.0.113.7', 'X-Amimi-Prova': '1' });
    ris.s1 = {
      ok: ok, su: 100, ko: ko, cliente: cli, tempi: riassunto(tempi),
      negozio: ultimo && ultimo.negozio, path_prefix_atteso: ultimo && ultimo.path_prefix_atteso, eta_firma_s: ultimo && ultimo.eta_firma_s,
      parametri: ultimo && ultimo.parametri, header: ultimo && ultimo.header,
      id_aggiunto: { status: finto.status, errore: finto.d && finto.d.error, cliente: finto.d && finto.d.cliente, parametri: finto.d && finto.d.parametri },
      xff_finto: { status: xff.status, header: xff.d && xff.d.header }
    };
    aggiungi(JSON.stringify(ris.s1, null, 1));
  }
  async function s2() {
    scrivi('S2: velocita\\' (30 invii via amimi.it e 30 diretti, alternati)...');
    await eco('POST', '?s2=caldo', '{}'); await diretta();
    var px = [], dx = [];
    for (var n = 0; n < 30; n++) {
      var r = await eco('POST', '?s2=' + n, '{}'); if (r.status === 200) px.push(r.ms);
      var d = await diretta(); if (d !== null) dx.push(d);
      if (n % 10 === 9) aggiungi('  ' + (n + 1) + '/30');
    }
    var a = riassunto(px), b = riassunto(dx);
    var diff = a.p95 !== null && b.p95 !== null ? a.p95 - b.p95 : null;
    ris.s2 = { rete: rete(), proxy: a, diretta: b, differenza_p95_ms: diff, soglia_ms: 1000, verdetto: diff === null ? 'NON MISURATO' : diff <= 1000 ? 'PASSA' : 'NON PASSA' };
    aggiungi(JSON.stringify(ris.s2, null, 1));
  }
  async function s3() {
    scrivi('S3: cache...');
    var a = await eco('GET', '?s3=cache'), b = await eco('GET', '?s3=cache');
    ris.s3 = { cache: { stessa_risposta: !!(a.d && b.d && a.d.ora_server_ms === b.d.ora_server_ms), status: [a.status, b.status], cache_control: [a.cc, b.cc], age: [a.age, b.age] }, attese: [] };
    aggiungi(JSON.stringify(ris.s3.cache));
    var lista = [10, 30, 60, 120];
    for (var j = 0; j < lista.length; j++) {
      aggiungi('  attesa ' + lista[j] + ' s...');
      var r = await eco('GET', '?attesa=' + lista[j]);
      var e = { attesa_s: lista[j], status: r.status, ms: Math.round(r.ms), risposta_della_edge: !!(r.d && r.d.attesa_s === lista[j]) };
      ris.s3.attese.push(e); aggiungi('  ' + JSON.stringify(e));
    }
  }
  async function s4() {
    scrivi('S4: un invio ogni 3 secondi per 10 minuti...');
    var fine = Date.now() + 600000, c = { invii: 0, ok: 0, s429: 0, rete_assente: 0, altri: {} }, tempi = [];
    while (Date.now() < fine) {
      var t = Date.now();
      var r = await eco('POST', '?s4=1', '{}');
      c.invii++; tempi.push(r.ms);
      if (r.status === 200) c.ok++; else if (r.status === 429) c.s429++; else if (r.status === 0) c.rete_assente++; else c.altri[r.status] = (c.altri[r.status] || 0) + 1;
      if (c.invii % 20 === 0) aggiungi('  ' + c.invii + ' invii, ok ' + c.ok + ', 429 ' + c.s429 + ', minuti rimasti ' + Math.ceil((fine - Date.now()) / 60000));
      var resto = 3000 - (Date.now() - t); if (resto > 0) await pausa(resto);
    }
    c.tempi = riassunto(tempi); c.rete = rete(); ris.s4 = c;
    aggiungi(JSON.stringify(ris.s4, null, 1));
  }
  document.getElementById('b-s1').addEventListener('click', function () { esegui('S1', s1); });
  document.getElementById('b-s2').addEventListener('click', function () { esegui('S2', s2); });
  document.getElementById('b-s3').addEventListener('click', function () { esegui('S3', s3); });
  var widgetId = null;
  function caricaTurnstile() {
    return new Promise(function (ok, ko) {
      if (window.turnstile) { ok(window.turnstile); return; }
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = function () { ok(window.turnstile); };
      s.onerror = function () { ko(new Error('script di Turnstile non caricato')); };
      document.head.appendChild(s);
    });
  }
  async function s6() {
    var chiave = new URLSearchParams(location.search).get('sitekey') || '';
    if (!/^[0-9A-Za-z_-]{10,64}$/.test(chiave)) { scrivi('S6: serve la sitekey nella barra degli indirizzi (?sitekey=...).'); return; }
    scrivi('S6: carico Turnstile...');
    var tsApi = await caricaTurnstile();
    if (widgetId !== null) { tsApi.remove(widgetId); widgetId = null; }
    var token = await new Promise(function (ok, ko) {
      var timer = setTimeout(function () { ko(new Error('nessun token entro 60 s')); }, 60000);
      function fine(f, v) { clearTimeout(timer); f(v); }
      widgetId = tsApi.render('#ts', { sitekey: chiave,
        callback: function (t) { fine(ok, t); },
        'error-callback': function (c) { fine(ko, new Error('errore di Turnstile ' + c)); },
        'expired-callback': function () { fine(ko, new Error('token di Turnstile scaduto')); },
        'timeout-callback': function () { fine(ko, new Error('sfida di Turnstile scaduta')); } });
    });
    aggiungi('  token ricevuto, verifico...');
    var t = adesso();
    var r = await fetch(BASE + '/turnstile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token }), cache: 'no-store', credentials: 'same-origin' })
      .then(function (x) { return x.json().then(function (d) { return { status: x.status, d: d }; }, function () { return { status: x.status, d: null }; }); },
        function () { return { status: 0, d: null }; });
    ris.s6 = { host_pagina: location.host, status: r.status, success: r.d && r.d.success, hostname: r.d && r.d.hostname,
      hostname_uguale: !!(r.d && r.d.hostname === location.host), errori: r.d && (r.d.error_codes || r.d.error || r.d.state), eta_sfida_s: r.d && r.d.eta_sfida_s, ms: Math.round(adesso() - t) };
    aggiungi(JSON.stringify(ris.s6, null, 1));
  }
  document.getElementById('b-s4').addEventListener('click', function () { esegui('S4', s4); });
  document.getElementById('b-s6').addEventListener('click', function () { esegui('S6', s6); });
  document.getElementById('b-copia').addEventListener('click', function () {
    var t = JSON.stringify(ris, null, 1);
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { aggiungi('\\nCopiati negli appunti.'); }, function () { scrivi(t); });
    else scrivi(t);
  });
})();
</script>
</body></html>
`;
// ==== PURE:chat-eco END ====

// L'unica chiamata fuori della edge: siteverify di Turnstile (S6), con 10 s di tetto. Il secret va nel corpo, mai nell'URL.
const siteverify = async (secret: string, token: string): Promise<unknown> => {
  const r = await fetch(SITEVERIFY_URL, { method: 'POST', body: new URLSearchParams({ secret, response: token }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('siteverify HTTP ' + r.status);   // un 5xx di Cloudflare e' "irraggiungibile" (502), non "token rifiutato"
  return await r.json();
};

Deno.serve((req) =>
  gestisci(req, Date.now(), (Deno.env.get('CHAT_APP_PROXY_SECRET') ?? '').trim(), (ms) => new Promise((r) => setTimeout(r, ms)),
    { secret: (Deno.env.get('CHAT_TURNSTILE_PROVA_SECRET') ?? '').trim(), siteverify }));
