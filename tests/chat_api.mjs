// tests/chat_api.mjs: la edge chat-api api-1 (chat del sito, Fase 1 pezzo 2, docs/PROPOSTA_chat_sito.md 5.2-5.8, 6, 8.4)
// ritagliata DAL SORGENTE che va in produzione (blocco PURE:chat-api) e guidata in Node con Request veri, firme calcolate
// con node:crypto e un DB finto in memoria che riproduce i vincoli della migr 0186 che contano qui (UNIQUE dei messaggi,
// chiave degli eventi senza @, update condizionato, contatori col tetto). Piu' le guardie sul sorgente. Nessuna rete.
//   node tests/chat_api.mjs
// Perche' esiste: la edge e' pubblica (verify_jwt = false) e scrive col service role. Una firma controllata male, un token
// accettato scaduto, una push doppia, un 5xx (che il proxy di Shopify trasforma in una pagina HTML), un valore di
// app_flags fuori lista o un testo della cliente nei log non si vedono finche' qualcuno non li usa.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { createHmac, createHash, randomUUID, randomBytes } from 'node:crypto';

process.removeAllListeners('warning');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const SRC = read('supabase/functions/chat-api/index.ts');
const PE = read('supabase/functions/push-eventi/index.ts');
const CONFIG = read('supabase/config.toml');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 300) : '')); } };

const B = '// ==== PURE:chat-api BEGIN ====', E = '// ==== PURE:chat-api END ====';
const a = SRC.indexOf(B), b = SRC.indexOf(E);
if (a < 0 || b < a) { console.error('marcatori PURE:chat-api non trovati'); process.exit(1); }
const BLOCCO = SRC.slice(a + B.length, b);
const ESPORTA = ['gestisci', 'azzeraCache', 'azzeraSalute', 'ErroreDb', 'nomeCliente', 'statoDaEsito', 'inOrario', 'testoAttesa', 'interpretaFlag', 'mascheraEmail',
  'emailValida', 'nomePulito', 'testoPulito', 'uuidDa', 'FLAG_LETTI', 'HOST_ANTEPRIMA_RE', 'METODO', 'VERSIONE', 'ROTTE_ECO', 'messaggioPush'];
const M = new Function(stripTypeScriptTypes(BLOCCO) + `\nreturn { ${ESPORTA.join(', ')} };`)();

// ---------- firma come Shopify ----------
const SECRET = 'segreto-di-prova-non-reale';
const TS_PROD = 'segreto-turnstile-produzione-finto';
const TS_PROVA = 'segreto-turnstile-prova-finto';
const EDGE = 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/chat-api';
function firma(coppie, secret = SECRET) {
  const g = new Map();
  for (const [k, v] of coppie) { if (k === 'signature') continue; if (!g.has(k)) g.set(k, []); g.get(k).push(v); }
  return createHmac('sha256', secret).update([...g.keys()].sort().map((k) => `${k}=${g.get(k).join(',')}`).join('')).digest('hex');
}
const clock = { ora: Date.parse('2026-11-09T09:30:00Z') };       // lunedi', 10:30 a Roma: in orario
const shopify = (cliente = '', ts = String(Math.floor(clock.ora / 1000) - 5), shop = 'wb9gmn-0h.myshopify.com') =>
  [['shop', shop], ['logged_in_customer_id', cliente], ['path_prefix', '/apps/chat'], ['timestamp', ts]];
function url(azione, coppie, { firmaGiusta = true, senzaFirma = false, extra = [] } = {}) {
  const u = new URL(`${EDGE}/${azione}`);
  for (const [k, v] of [...coppie, ...extra]) u.searchParams.append(k, v);
  if (!senzaFirma) u.searchParams.append('signature', firmaGiusta ? firma([...coppie, ...extra]) : '0'.repeat(64));
  return u.toString();
}

// ---------- DB finto (vincoli della 0186 che contano per la edge) ----------
const EMAIL_DB = /^[^\s\p{Cc}<>,;"@]+@[^\s\p{Cc}<>,;"@]+\.[^\s\p{Cc}<>,;"@]+$/u;
const iso = (ms) => new Date(ms).toISOString();
const malformato = (v) => typeof v === 'string' && !v.isWellFormed();
function nuovoDb() {
  const st = { flag: new Map(), cont: new Map(), sess: new Map(), tok: [], msg: [], ev: [], faq: new Map(), salute: [], seq: 0, tseq: 0,
    guasti: new Map(), flagChiesti: [], chiamate: [] };
  const guasto = (nome) => { const g = st.guasti.get(nome); if (g > 0) { st.guasti.set(nome, g - 1); throw new M.ErroreDb('guasto ' + nome); } };
  const COLS = ['id', 'stato', 'passaggi', 'passaggio_at', 'customer_email', 'customer_name', 'lingua', 'prova', 'ultima_attivita_at', 'chiusa_at'];
  const proj = (s) => Object.fromEntries(COLS.map((k) => [k, s[k] ?? (k === 'prova' ? false : null)]));
  const pick = (m) => ({ id: m.id, seq: m.seq, autore: m.autore, testo: m.testo, created_at: m.created_at, email_stato: m.email_stato, delivered_at: m.delivered_at });
  const db = {
    async flag(chiavi) { st.chiamate.push('flag'); guasto('flag'); st.flagChiesti.push([...chiavi]); const o = {}; for (const k of chiavi) if (st.flag.has(k)) o[k] = st.flag.get(k); return o; },
    async contatore(chiave, fin, tetto) {
      st.chiamate.push('contatore:' + chiave); guasto('contatore');
      if (!/^[a-z][a-z0-9_:.-]{0,199}$/.test(chiave) || !(tetto >= 1 && tetto <= 1e6) || !(fin >= 0 && fin <= 604800)) throw new M.ErroreDb('22023');
      const k = chiave + '|' + (fin === 0 ? 0 : Math.floor(clock.ora / 1000 / fin) * fin);
      const n = Math.min((st.cont.get(k) ?? 0) + 1, tetto + 1);
      st.cont.set(k, n);
      return n <= tetto ? n : null;
    },
    async token(hash, tipo) {
      st.chiamate.push('token:' + tipo); guasto('token');
      const x = st.tok.find((y) => y.hash === hash && y.tipo === tipo);
      if (!x) return null;
      const s = st.sess.get(x.sessione_id);
      return { id: x.id, tipo: x.tipo, scade_at: x.scade_at, revocato_at: x.revocato_at, sessione: s ? proj(s) : null };
    },
    async creaSessione(r) {
      guasto('creaSessione');
      if (Object.values(r).some(malformato)) throw new M.ErroreDb('22P02');
      if (!EMAIL_DB.test(r.customer_email) || r.customer_email.length > 254) throw new M.ErroreDb('23514 email');
      if (r.customer_name !== null && (/[\p{Cc}]/u.test(r.customer_name) || [...r.customer_name].length > 80)) throw new M.ErroreDb('23514 nome');
      const s = { id: randomUUID(), passaggi: 0, passaggio_at: null, chiusa_at: null, ultimo_cliente_at: null, ...r };
      st.sess.set(s.id, s);
      return proj(s);
    },
    async creaToken(r) {
      guasto('creaToken');
      if (!/^[0-9a-f]{64}$/.test(r.hash) || st.tok.some((y) => y.hash === r.hash)) throw new M.ErroreDb('23505 token');
      st.tok.push({ id: randomUUID(), revocato_at: null, usato_at: null, created_at: iso(clock.ora), n: ++st.tseq, ...r });
    },
    async tokenAttivi(sid, oraIso) { return st.tok.filter((y) => y.sessione_id === sid && y.tipo === 'chat' && !y.revocato_at && y.scade_at > oraIso).sort((p, q) => q.n - p.n).map((y) => ({ id: y.id })); },
    async revocaToken(ids, oraIso) { for (const y of st.tok) if (ids.includes(y.id) && !y.revocato_at) y.revocato_at = oraIso; },
    async usaToken(id, oraIso) { const y = st.tok.find((z) => z.id === id); if (y) y.usato_at = oraIso; },
    async aggiornaSessione(id, patch, se) {
      st.chiamate.push('aggiornaSessione'); guasto('aggiornaSessione');
      const s = st.sess.get(id);
      if (!s || (se.stato !== undefined && s.stato !== se.stato) || (se.passaggi !== undefined && s.passaggi !== se.passaggi)) return null;
      const dopo = { ...s, ...patch };
      if (dopo.stato === 'attesa_persona' && !(dopo.passaggi >= 1 && dopo.passaggio_at)) throw new M.ErroreDb('23514 passaggio');
      Object.assign(s, patch);
      return proj(s);
    },
    async sessione(id) { const s = st.sess.get(id); return s ? proj(s) : null; },
    async inserisciMessaggi(righe) {
      st.chiamate.push('inserisciMessaggi'); guasto('inserisciMessaggi');
      if (righe.some((r) => Object.values(r).some(malformato))) throw new M.ErroreDb('22P02');
      for (const r of righe) {
        if (!st.sess.has(r.sessione_id)) throw new M.ErroreDb('23503');
        if (typeof r.testo !== 'string' || [...r.testo].length < 1 || [...r.testo].length > 4000) throw new M.ErroreDb('23514 testo');
        if (r.autore === 'cliente' && !r.client_msg_id) throw new M.ErroreDb('23514 client');
        if (!['cliente', 'automatica', 'ai', 'staff', 'sistema'].includes(r.autore)) throw new M.ErroreDb('23514 autore');
      }
      const out = [];
      for (const r of righe) {
        if (st.msg.some((m) => m.sessione_id === r.sessione_id && m.client_msg_id === r.client_msg_id)) continue;
        const m = { id: randomUUID(), seq: ++st.seq, staff_nome: null, delivered_at: null, email_stato: null, created_at: iso(clock.ora), ...r };
        st.msg.push(m);
        out.push(pick(m));
      }
      return out;
    },
    async messaggiDopo(sid, dopo, lim) { return st.msg.filter((m) => m.sessione_id === sid && m.seq > dopo).sort((p, q) => q.seq - p.seq).reverse().slice(0, lim).map(pick); },
    async segnaViste(ids, oraIso) { for (const m of st.msg) if (ids.includes(m.id) && m.autore === 'staff' && !m.delivered_at) m.delivered_at = oraIso; },
    async evento(r) {
      st.chiamate.push('evento:' + r.tipo); guasto('evento');
      if (!/^[a-z][a-z0-9_]{1,47}$/.test(r.tipo) || JSON.stringify([r.chiave, r.esito, r.dettaglio]).includes('@')) throw new M.ErroreDb('23514 evento');
      if (r.chiave !== null && !/^[a-z0-9][a-z0-9_:.-]*$/.test(r.chiave)) throw new M.ErroreDb('23514 chiave');
      if (r.chiave !== null && st.ev.some((e) => e.chiave === r.chiave)) return false;
      st.ev.push({ ...JSON.parse(JSON.stringify(r)), at: iso(clock.ora) });
      return true;
    },
    async esitoEvento(chiave, esito, dettaglio) { guasto('esitoEvento'); const e = st.ev.find((x) => x.chiave === chiave); if (e) { e.esito = esito; e.dettaglio = dettaglio; } },
    async faq(id) { return st.faq.get(id) ?? null; },
    async salute(giorno, n, severity, causa) { st.salute.push({ giorno, n, severity, causa }); },
  };
  return { db, st };
}
const FLAG_BASE = {
  chat_sito_enabled: 'true', chat_limite_chat_giorno: '50',
  chat_orari: JSON.stringify({ tz: 'Europe/Rome', giorni: [1, 2, 3, 4, 5], dalle: '09:00', alle: '18:00', chiusure: [] }),
  chat_testo_saluto: JSON.stringify({ it: 'Ciao', en: 'Hi' }), chat_testo_orari: JSON.stringify({ it: 'Orari', en: 'Hours' }),
  chat_testo_attesa: JSON.stringify({ it: 'ATTESA entro 2 giorni a {email}', en: 'WAIT within 2 days at {email}' }),
  chat_testo_fuori_orario: JSON.stringify({ it: 'FUORI ORARIO a {email}', en: 'OUT OF HOURS at {email}' }),
  chat_testo_informativa: JSON.stringify({ it: 'Informativa', en: 'Notice' }),
  chat_bottoni: JSON.stringify([{ id: 'spedizioni', it: 'Spedizioni', en: 'Shipping', faq: 7 }, { id: 'resi', it: 'Resi', en: 'Returns', faq: null }]),
  cs_gmail_sa_key: 'SEGRETO-CHE-NON-DEVE-USCIRE', chat_sollecito_ore: '24,48',
};
function nuovo(flag = {}) {
  const x = nuovoDb();
  for (const [k, v] of Object.entries({ ...FLAG_BASE, ...flag })) if (v !== undefined) x.st.flag.set(k, v);
  x.st.faq.set(7, { testo_it: 'Spediamo in 2 giorni.', testo_en: 'We ship in 2 days.', attiva: true });
  return x;
}

// ---------- ambiente e chiamate ----------
let sfondi = [];
const pushInviati = [];
let rispostaPush = { ok: true, inviati: 1, falliti: 0, destinatari: 1, status: 200 };
const svChiamate = [];
// siteverify finto: azione dedotta dal token ('A...' avvia, 'R...' riprendi), host amimi.it, salvo `svRisposta`
let svRisposta = null;
const sv = async (secret, token) => {
  svChiamate.push({ secret, token });
  if (svRisposta instanceof Error) throw svRisposta;
  if (svRisposta) return svRisposta;
  return { success: true, hostname: 'amimi.it', action: token.startsWith('R') ? 'chat_riprendi' : 'chat_avvia', challenge_ts: iso(clock.ora - 3000) };
};
const STATI = [];
const echi = [];
async function chiama(x, azione, corpo, { metodo = 'POST', cliente = '', segreti = {}, opz = {}, cache = false, coppie } = {}) {
  if (!cache) M.azzeraCache();
  const init = metodo === 'GET' ? { method: 'GET' } : { method: metodo, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo ?? {}), headers: { 'content-type': 'application/json' } };
  const req = new Request(url(azione, coppie ?? shopify(cliente), opz), init);
  const amb = { ora: clock.ora, segreti: { proxy: SECRET, turnstile: TS_PROD, turnstileProva: TS_PROVA, ...segreti }, db: x.db, siteverify: sv,
    push: async (m) => { pushInviati.push(m); if (rispostaPush instanceof Error) throw rispostaPush; return rispostaPush; },
    sfondo: (p) => sfondi.push(p), casuale: (n) => new Uint8Array(randomBytes(n)), eco: async (r) => { echi.push(r.url); return new Response('eco'); } };
  const r = await M.gestisci(req, amb);
  const attese = sfondi; sfondi = [];
  await Promise.all(attese);
  STATI.push({ azione, status: r.status, cc: r.headers.get('cache-control'), ct: r.headers.get('content-type') });
  const testo = r.status === 204 ? '' : await r.text();
  let d = null; try { d = JSON.parse(testo); } catch { d = null; }
  return { r, d, testo };
}
const sha = (s) => createHash('sha256').update(s).digest('hex');
let nTs = 0;
const tsA = () => 'A' + (++nTs) + '-token-turnstile';
const tsR = () => 'R' + (++nTs) + '-token-turnstile';
const avvia = (x, extra = {}, o = {}) => chiama(x, 'avvia', { email: 'Cliente.Prova@Esempio.it', nome: 'Giulia', informativa: 'i-abc123', turnstile: tsA(), ...extra }, o);
const sessioneDi = (x, token) => x.st.sess.get(x.st.tok.find((y) => y.hash === sha(token)).sessione_id);

console.log('== firma, rotte, metodi ==');
{
  const x = nuovo();
  const r404 = await chiama(x, 'qualcosa', {});
  t('R1 azione sconosciuta: 404 prima di ogni altro controllo (nessuna lettura, nessun contatore)', r404.r.status === 404 && x.st.chiamate.length === 0);
  const r405 = await chiama(x, 'avvia', null, { metodo: 'GET' });
  t('R2 GET su un\'azione POST: 405', r405.r.status === 405);
  const r405b = await chiama(x, 'config', {}, { metodo: 'POST' });
  t('R3 POST su config: 405', r405b.r.status === 405);
  const eco0 = echi.length;
  for (const az of ['eco', 'misura', 'turnstile']) await chiama(x, az, {});
  t('R4 /eco, /misura e /turnstile vanno all\'eco dello spike (eco.ts) e contano fra le richieste (Gate 2, C9); 404 e 405 non contano',
    echi.length === eco0 + 3 && x.st.chiamate.filter((c) => c === 'contatore:glob:richieste').length === 3 && x.st.chiamate.every((c) => c === 'contatore:glob:richieste'));
  const ns = await chiama(x, 'config', null, { metodo: 'GET', segreti: { proxy: '' } });
  t('F1 secret del proxy assente: 200 needs_secret (mai 5xx)', ns.r.status === 200 && ns.d.state === 'needs_secret');
  const senza = await chiama(x, 'config', null, { metodo: 'GET', opz: { senzaFirma: true } });
  t('F2 senza firma: 401', senza.r.status === 401 && senza.d.error === 'missing_signature');
  const sbagliata = await chiama(x, 'config', null, { metodo: 'GET', opz: { firmaGiusta: false } });
  t('F3 firma sbagliata: 401', sbagliata.r.status === 401 && sbagliata.d.error === 'bad_signature');
  for (const k of ['logged_in_customer_id', 'shop', 'timestamp', 'path_prefix']) {
    const c = shopify(); const v = c.find((y) => y[0] === k)[1];
    const rr = await chiama(x, 'config', null, { metodo: 'GET', opz: { extra: [[k, v]] } });
    t(`F4 ${k} ripetuto (firma valida): 401`, rr.r.status === 401 && rr.d.error === 'repeated_param');
  }
  const vecchia = await chiama(x, 'config', null, { metodo: 'GET', coppie: shopify('', String(Math.floor(clock.ora / 1000) - 301)) });
  t('F5 firma di oltre 300 s: 401', vecchia.r.status === 401 && vecchia.d.error === 'stale_signature');
  const futura = await chiama(x, 'config', null, { metodo: 'GET', coppie: shopify('', String(Math.floor(clock.ora / 1000) + 301)) });
  t('F6 firma dal futuro oltre 300 s: 401', futura.r.status === 401);
  const idFinto = await chiama(x, 'config', null, { metodo: 'GET', coppie: shopify('12a') });
  t('F7 logged_in_customer_id non di sole cifre: 401', idFinto.r.status === 401 && idFinto.d.error === 'bad_customer_id');
  const altroNeg = await chiama(x, 'config', null, { metodo: 'GET', coppie: shopify('', undefined, 'altro-negozio.myshopify.com') });
  t('F8 negozio sconosciuto (firma valida): 401', altroNeg.r.status === 401 && altroNeg.d.error === 'bad_shop');
  const legacy = await chiama(x, 'config', null, { metodo: 'GET', coppie: shopify('', undefined, 'amimi-10000.myshopify.com') });
  t('F9 handle dell\'admin accettato come il dominio myshopify', legacy.r.status === 200);
  const opt = await chiama(x, 'avvia', null, { metodo: 'OPTIONS' });
  t('F10 OPTIONS: 204 senza CORS', opt.r.status === 204 && !opt.r.headers.has('access-control-allow-origin'));
}

console.log('\n== config e flag (sez. 10, test 18) ==');
{
  const x = nuovo();
  const c = await chiama(x, 'config', null, { metodo: 'GET' });
  t('C1 chiavi della risposta esattamente quelle pubbliche', JSON.stringify(Object.keys(c.d).sort()) === JSON.stringify(['attiva', 'bottoni', 'informativa_versione', 'limiti', 'ok', 'testi', 'versione']), Object.keys(c.d));
  t('C2 bottoni solo con una risposta fissa (faq), senza l\'id di cs_faq', c.d.bottoni.length === 1 && c.d.bottoni[0].id === 'spedizioni' && !('faq' in c.d.bottoni[0]));
  t('C3 testi pubblici: saluto, orari, informativa (non attesa, non fuori orario)', JSON.stringify(Object.keys(c.d.testi).sort()) === '["informativa","orari","saluto"]' && c.d.testi.saluto.it === 'Ciao');
  t('C4 versione dell\'informativa = impronta del testo', c.d.informativa_versione === 'i-' + sha(FLAG_BASE.chat_testo_informativa).slice(0, 12));
  t('C5 nessun valore fuori lista nella risposta (segreto e sollecito)', !c.testo.includes('SEGRETO') && !c.testo.includes('24,48'));
  t('C6 la edge chiede ad app_flags solo FLAG_LETTI', x.st.flagChiesti.every((k) => JSON.stringify(k) === JSON.stringify(M.FLAG_LETTI)));
  t('C7 FLAG_LETTI: nove chiavi chat_*, nessun segreto', M.FLAG_LETTI.length === 9 && M.FLAG_LETTI.every((k) => /^chat_[a-z_]+$/.test(k)) && !M.FLAG_LETTI.some((k) => /key|token|secret|pin/.test(k)));
  x.st.flag.set('chat_sito_enabled', 'false');
  const off = await chiama(x, 'config', null, { metodo: 'GET' });
  t('C8 chat spenta: solo {ok, versione, attiva:false}', off.d.attiva === false && JSON.stringify(Object.keys(off.d).sort()) === '["attiva","ok","versione"]');
  x.st.flag.set('chat_sito_enabled', ' TRUE ');
  t('C9 acceso solo con la stringa true (spazi e maiuscole tollerati)', (await chiama(x, 'config', null, { metodo: 'GET' })).d.attiva === true);
  x.st.flag.set('chat_sito_enabled', 'si');
  t('C10 un valore diverso vale spenta', (await chiama(x, 'config', null, { metodo: 'GET' })).d.attiva === false);
  x.st.flag.set('chat_sito_enabled', 'true');
  x.st.guasti.set('flag', 2);
  const err = await chiama(x, 'config', null, { metodo: 'GET' });
  t('C11 flag illeggibili: config risponde spenta, 200, e la salute va in error', err.r.status === 200 && err.d.attiva === false && x.st.salute.at(-1)?.severity === 'error');
  // cache di 60 s: la seconda chiamata non rilegge, oltre 60 s si'
  const y = nuovo();
  M.azzeraCache();
  await chiama(y, 'config', null, { metodo: 'GET', cache: true });
  await chiama(y, 'config', null, { metodo: 'GET', cache: true });
  const prima = y.st.chiamate.filter((z) => z === 'flag').length;
  clock.ora += 61000;
  await chiama(y, 'config', null, { metodo: 'GET', cache: true });
  t('C12 flag tenuti in memoria al massimo 60 s', prima === 1 && y.st.chiamate.filter((z) => z === 'flag').length === 2);
  const f = M.interpretaFlag({ chat_limite_chat_giorno: '0', chat_bottoni: '[{"id":"X Y","it":"a","en":"b","faq":1}]', chat_orari: '{"tz":"Europe/Rome"}', chat_testo_saluto: '{"it":"a"}' });
  t('C13 flag malformati: limite 50, bottoni scartati, orari nulli, testo nullo', f.limiteGiorno === 50 && f.bottoni.length === 0 && f.orari === null && f.testi.saluto === null && f.attiva === false);
}

console.log('\n== corpo e schema (5.7) ==');
{
  const x = nuovo();
  const grande = await chiama(x, 'avvia', JSON.stringify({ email: 'a@b.it', informativa: 'x', turnstile: 'A', nome: 'x'.repeat(9000) }));
  t('S1 corpo oltre 8 KB: 413', grande.r.status === 413);
  t('S2 JSON rotto: 400', (await chiama(x, 'avvia', '{rotto')).r.status === 400);
  t('S3 array al posto dell\'oggetto: 400', (await chiama(x, 'avvia', '[1]')).r.status === 400);
  const sconosciuto = await chiama(x, 'avvia', { email: 'a@b.it', informativa: 'x', turnstile: tsA(), extra: 1 });
  t('S4 campo sconosciuto: 422 senza ripetere il nome', sconosciuto.r.status === 422 && sconosciuto.d.error === 'campo_sconosciuto' && !sconosciuto.testo.includes('extra'));
  const proto = await chiama(x, 'avvia', '{"email":"a@b.it","informativa":"x","turnstile":"A1","__proto__":{"prova":true}}');
  t('S5 __proto__ nel corpo: campo sconosciuto', proto.r.status === 422);
  const manca = await chiama(x, 'avvia', { email: 'a@b.it', turnstile: tsA() });
  t('S6 obbligatorio assente: 422 campo_mancante', manca.r.status === 422 && manca.d.campo === 'informativa');
  for (const em of ['a@b.it,c@d.it', 'a@b.it\nBcc: x@y.it', 'a b@c.it', 'a@b', '<a@b.it>', 'a@b.it;', 'a"b@c.it', 'a\u200b@b.it', 'x'.repeat(250) + '@b.it']) {
    const r = await avvia(x, { email: em });
    t('S7 email rifiutata: ' + JSON.stringify(em).slice(0, 30), r.r.status === 422 && r.d.campo === 'email' && !r.testo.includes('@'));
  }
  t('S8 nome oltre 80: 422', (await avvia(x, { nome: 'n'.repeat(81) })).d?.campo === 'nome');
  t('S9 lingua fuori lista: 422', (await avvia(x, { lingua: 'fr' })).d?.campo === 'lingua');
  t('S10 prova non booleano: 422', (await avvia(x, { prova: 'true' })).d?.campo === 'prova');
  t('S11 testo oltre 1000: 422', (await avvia(x, { testo: 'x'.repeat(1001), client_id: randomUUID() })).d?.campo === 'testo');
  t('S12 testo senza client_id: 422', (await avvia(x, { testo: 'ciao' })).d?.campo === 'client_id');
  t('S13 client_id senza testo: 422', (await avvia(x, { client_id: randomUUID() })).d?.campo === 'client_id');
  t('S14 turnstile oltre 2048: 422', (await avvia(x, { turnstile: 'A'.repeat(2049) })).d?.campo === 'turnstile');
  const mezza = String.fromCharCode(0xD83D);
  t('S14b nome con mezza emoji: 422 prima del DB (Gate 2, B1)', (await avvia(x, { nome: 'Giulia ' + mezza })).d?.campo === 'nome');
  t('S14c testo con mezza emoji: 422 prima del DB (Gate 2, B1)', (await avvia(x, { testo: 'ciao ' + mezza, client_id: randomUUID() })).d?.campo === 'testo');
  t('S14d emoji intera (coppia valida): accettata dai pulitori', M.testoPulito('ciao ' + String.fromCodePoint(0x1F600)) !== false && M.nomePulito('Giu' + String.fromCodePoint(0x1F600)) !== false);
  t('S15 nessuna sessione creata dai rifiuti di schema', x.st.sess.size === 0 && svChiamate.length === 0);
  t('S16 pulizia: nome senza a capo ne\' caratteri di formato; testo senza controlli, a capo tenuti, HTML come testo',
    M.nomePulito(' Giu\nlia\u202E ') === 'Giu lia' && M.testoPulito('<b>ciao</b>\u0007\r\nriga\u202E') === '<b>ciao</b>\nriga' && M.testoPulito('   ') === false);
  t('S17 1000 punti di codice passano anche con emoji (lunghezza in punti di codice)', M.testoPulito('\u{1F600}'.repeat(1000)) !== false && M.testoPulito('\u{1F600}'.repeat(1001)) === false);
}

console.log('\n== avvia e Turnstile (5.5, test 14) ==');
{
  let x = nuovo({ chat_sito_enabled: 'false' });
  const sv0 = svChiamate.length;
  const off = await avvia(x);
  t('A1 chat spenta: spenta, nessuna sessione, nessuna chiamata a Cloudflare', off.d.state === 'spenta' && x.st.sess.size === 0 && svChiamate.length === sv0);
  x = nuovo();
  const ok1 = await avvia(x, { nome: ' Giulia\n ' }, { cliente: '12345' });
  const s1 = sessioneDi(x, ok1.d.token);
  t('A2 sessione creata: token di 43 caratteri, stato bot, email in minuscolo e mascherata', ok1.d.ok === true && /^[A-Za-z0-9_-]{43}$/.test(ok1.d.token) && ok1.d.stato === 'bot' && s1.customer_email === 'cliente.prova@esempio.it' && ok1.d.email === 'c***@esempio.it');
  t('A3 nel DB solo l\'hash del token, mai il token', x.st.tok.length === 1 && x.st.tok[0].hash === sha(ok1.d.token) && !JSON.stringify([...x.st.sess.values(), x.st.tok, x.st.ev]).includes(ok1.d.token));
  t('A4 id cliente solo dal parametro firmato; nome ripulito; prova false; informativa salvata', s1.shopify_customer_id === '12345' && s1.customer_name === 'Giulia' && s1.prova === false && s1.informativa_versione === 'i-abc123');
  t('A5 siteverify col secret di produzione', svChiamate.at(-1).secret === TS_PROD);
  t('A6 evento di audit senza dati personali', x.st.ev.some((e) => e.tipo === 'avvia' && e.dettaglio.loggata === true && !JSON.stringify(e).includes('esempio')));
  const casi = [
    ['token finto delle chiavi di prova di Cloudflare', { turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }, null, 'verifica_fallita', false],
    ['success false', {}, { success: false, hostname: 'amimi.it', action: 'chat_avvia' }, 'verifica_fallita', true],
    ['hostname di un altro sito', {}, { success: true, hostname: 'evil.com', action: 'chat_avvia' }, 'verifica_fallita', true],
    ['hostname che contiene amimi.it', {}, { success: true, hostname: 'amimi.it.evil.com', action: 'chat_avvia' }, 'verifica_fallita', true],
    ['anteprima con il widget di produzione', {}, { success: true, hostname: 'abc123-95215747399.shopifypreview.com', action: 'chat_avvia' }, 'verifica_fallita', true],
    ['azione diversa (token della pagina delle misure)', {}, { success: true, hostname: 'amimi.it', action: '' }, 'verifica_fallita', true],
    ['azione di riprendi su avvia', {}, { success: true, hostname: 'amimi.it', action: 'chat_riprendi' }, 'verifica_fallita', true],
  ];
  for (const [nome, extra, risp, atteso, chiamaCf] of casi) {
    const y = nuovo(); svRisposta = risp; const n0 = svChiamate.length;
    const r = await avvia(y, extra);
    t('A7 ' + nome + ': ' + atteso + ', nessuna sessione', r.d.state === atteso && y.st.sess.size === 0 && (svChiamate.length > n0) === chiamaCf, r.d);
    svRisposta = null;
  }
  {
    const y = nuovo(); svRisposta = { success: true, hostname: 'abc123-95215747399.shopifypreview.com', action: 'chat_avvia' };
    const r = await avvia(y, { prova: true });
    t('A8 prova: widget di prova sull\'anteprima di QUESTO negozio, secret di prova, sessione prova', r.d.ok === true && svChiamate.at(-1).secret === TS_PROVA && sessioneDi(y, r.d.token).prova === true);
    svRisposta = { success: true, hostname: 'abc123-11111111111.shopifypreview.com', action: 'chat_avvia' };
    t('A9 prova: anteprima di un altro negozio rifiutata', (await avvia(y, { prova: true })).d.state === 'verifica_fallita');
    svRisposta = null;
    t('A10 prova senza secret di prova: non_disponibile', (await avvia(y, { prova: true }, { segreti: { turnstileProva: '' } })).d.state === 'non_disponibile');
  }
  {
    const y = nuovo();
    const r1 = await avvia(y, {}, { segreti: { turnstile: '' } });
    const r2 = await avvia(y, {}, { segreti: { turnstile: '1x0000000000000000000000000000000AA' } });
    const r3 = await avvia(y, {}, { segreti: { turnstile: '2x0000000000000000000000000000000AA' } });
    t('A11 secret di produzione assente o di prova di Cloudflare: non_disponibile, warn in salute', [r1, r2, r3].every((r) => r.d.state === 'non_disponibile') && y.st.sess.size === 0 && y.st.salute.at(-1)?.severity === 'warn');
    svRisposta = new Error('rete');
    const r4 = await avvia(y);
    t('A12 siteverify irraggiungibile: non_disponibile, nessuna chat', r4.r.status === 200 && r4.d.state === 'non_disponibile' && y.st.sess.size === 0);
    svRisposta = null;
  }
  {
    const y = nuovo({ chat_limite_chat_giorno: '2' });
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await avvia(y));
    t('A13 tetto delle chat del giorno (dal flag): la terza e la quarta rifiutate', r[0].d.ok && r[1].d.ok && r[2].d.state === 'limite' && r[3].d.state === 'limite' && y.st.sess.size === 2);
    t('A14 un solo evento limite_globale nel giorno, chiave limite:<giorno>', y.st.ev.filter((e) => e.tipo === 'limite_globale').length === 1 && y.st.ev.some((e) => e.chiave === 'limite:2026-11-09'));
    const tsKo0 = [...y.st.cont.entries()].find(([k]) => k.startsWith('glob:chat_giorno'))?.[1];
    svRisposta = { success: false };
    await avvia(y);
    svRisposta = null;
    t('A15 un Turnstile negativo non consuma il tetto del giorno', [...y.st.cont.entries()].find(([k]) => k.startsWith('glob:chat_giorno'))?.[1] === tsKo0);
  }
  {
    const y = nuovo();
    y.st.guasti.set('contatore', 0);
    const ordine = [];
    const orig = y.db.contatore;
    y.db.contatore = async (...q) => { if (q[0] === 'glob:chat_giorno') { ordine.push('tetto'); throw new M.ErroreDb('rpc'); } return orig(...q); };
    const r = await avvia(y);
    t('A16 RPC dei contatori in errore: riprova (200), nessuna sessione (fallire chiusi)', r.r.status === 200 && r.d.state === 'riprova' && y.st.sess.size === 0 && ordine.length === 1);
  }
}

console.log('\n== passaggio a una persona e push (8.4, 9.13, test 5) ==');
{
  const x = nuovo();
  const p0 = pushInviati.length;
  const r = await avvia(x, { testo: 'Vorrei sapere del mio reso <script>', client_id: randomUUID() });
  const s = sessioneDi(x, r.d.token);
  t('P1 primo messaggio libero: messaggio della cliente, avviso di attesa, attesa_persona', r.d.stato === 'attesa_persona' && r.d.testo_salvato === true
    && r.d.messaggi.map((m) => m.autore).join() === 'cliente,sistema' && s.passaggi === 1 && s.passaggio_at !== null);
  t('P2 avviso di attesa in orario, con l\'email mascherata', r.d.messaggi[1].testo === 'ATTESA entro 2 giorni a c***@esempio.it');
  t('P3 una push sola, tema assistenza, titolo col nome, mai il testo della chat', pushInviati.length === p0 + 1 && pushInviati.at(-1).tema === 'assistenza'
    && pushInviati.at(-1).titolo === 'Chat del sito: Giulia chiede una persona' && !JSON.stringify(pushInviati.at(-1)).includes('reso') && pushInviati.at(-1).urgente === true);
  t('P4 prenotazione in chat_eventi con chiave <sessione>:passaggio:1 ed esito inviato', x.st.ev.some((e) => e.chiave === `${s.id}:passaggio:1` && e.esito === 'inviato' && e.dettaglio.inviati === 1));
  t('P5 HTML salvato come testo (il widget lo mostra con textContent)', x.st.msg.some((m) => m.testo === 'Vorrei sapere del mio reso <script>'));
  const tok = r.d.token;
  const cid = randomUUID();
  clock.ora += 3000;
  const i2 = await chiama(x, 'invia', { token: tok, client_id: cid, testo: 'Altro dettaglio' });
  t('P6 un altro messaggio in attesa_persona: salvato, nessuna push in piu\'', i2.d.ok && i2.d.messaggi.length === 1 && pushInviati.length === p0 + 1);
  clock.ora += 3000;
  const i3 = await chiama(x, 'invia', { token: tok, client_id: cid, testo: 'Altro dettaglio' });
  t('P7 stesso client_id rimandato: nessun doppione, nessuna push', i3.d.ok && i3.d.messaggi.length === 0 && x.st.msg.filter((m) => m.client_msg_id === cid).length === 1 && pushInviati.length === p0 + 1);
  clock.ora += 3000;
  const pp = await chiama(x, 'passaggio', { token: tok });
  t('P8 "Parla con una persona" ripetuto in attesa: niente avviso nuovo, niente push', pp.d.ok && pp.d.stato === 'attesa_persona' && pp.d.messaggi.length === 0 && pushInviati.length === p0 + 1);
}
{
  // passaggio dal bottone, fuori orario, in inglese, prova, senza nome: email nella push
  const x = nuovo();
  clock.ora = Date.parse('2026-11-14T10:00:00Z');                 // sabato
  const r = await avvia(x, { nome: null, lingua: 'en', prova: true }, {});
  svRisposta = null;
  const s = sessioneDi(x, r.d?.token ?? 'x'.repeat(43));
  const p0 = pushInviati.length;
  clock.ora += 3000;
  const pp = await chiama(x, 'passaggio', { token: r.d.token });
  t('P9 bottone "Parla con una persona": attesa_persona, avviso fuori orario in inglese', pp.d.stato === 'attesa_persona' && pp.d.messaggi[0]?.testo === 'OUT OF HOURS at c***@esempio.it' && pp.d.email === 'c***@esempio.it');
  t('P10 push di una sessione di prova: titolo PROVA, email al posto del nome, non urgente fuori orario', pushInviati.length === p0 + 1
    && pushInviati.at(-1).titolo === 'PROVA Chat del sito: cliente.prova@esempio.it chiede una persona' && pushInviati.at(-1).urgente === false);
  t('P11 dopo il passaggio: passaggi 1', s.passaggi === 1);
  clock.ora = Date.parse('2026-11-09T09:30:00Z');
}
{
  // guasto a meta': passaggio scritto, prenotazione della push fallita; il nuovo tentativo completa senza doppioni
  const x = nuovo();
  const r = await avvia(x);
  const s = sessioneDi(x, r.d.token);
  const p0 = pushInviati.length;
  x.st.guasti.set('evento', 1);
  clock.ora += 3000;
  const cid = randomUUID();
  const i1 = await chiama(x, 'invia', { token: r.d.token, client_id: cid, testo: 'Serve aiuto' });
  t('G1 guasto alla prenotazione: riprova, stato gia\' attesa_persona, nessuna push', i1.d.state === 'riprova' && s.stato === 'attesa_persona' && pushInviati.length === p0);
  clock.ora += 3000;
  const i2 = await chiama(x, 'invia', { token: r.d.token, client_id: cid, testo: 'Serve aiuto' });
  t('G2 stesso client_id: completa (avviso e una push), messaggio non duplicato', i2.d.ok && pushInviati.length === p0 + 1
    && x.st.msg.filter((m) => m.client_msg_id === cid).length === 1 && x.st.msg.filter((m) => m.sessione_id === s.id && m.autore === 'sistema').length === 1);
  t('G3 riga health_log in error per il guasto, senza dati della cliente', x.st.salute.some((h) => h.severity === 'error' && !/esempio|Giulia|aiuto/.test(JSON.stringify(h))));
}
{
  // due passaggi concorrenti: una push sola
  const x = nuovo();
  const r = await avvia(x);
  const p0 = pushInviati.length;
  clock.ora += 3000;
  const corpo = { token: r.d.token };
  M.azzeraCache();
  const mk = () => ({ ora: clock.ora, segreti: { proxy: SECRET, turnstile: TS_PROD, turnstileProva: TS_PROVA }, db: x.db, siteverify: sv,
    push: async (m) => { pushInviati.push(m); return rispostaPush; }, sfondo: (p) => sfondi.push(p), casuale: (n) => new Uint8Array(randomBytes(n)), eco: null });
  const req = () => new Request(url('passaggio', shopify()), { method: 'POST', body: JSON.stringify(corpo) });
  // il limite di velocita' non deve fermare il secondo: qui si prova la corsa persa di aPersona (Gate 2, C1)
  const origC = x.db.contatore;
  x.db.contatore = async (...q) => (String(q[0]).endsWith(':msg10s') ? 1 : origC(...q));
  const agg0 = x.st.chiamate.filter((c) => c === 'aggiornaSessione').length;
  const [u1, u2] = await Promise.all([M.gestisci(req(), mk()), M.gestisci(req(), mk())]);
  await Promise.all(sfondi.splice(0));
  x.db.contatore = origC;
  const d1 = await u1.json(), d2 = await u2.json();
  t('G4 due passaggi insieme: entrambi ok, due update condizionati (uno perso), una push, un avviso, passaggi 1',
    x.st.chiamate.filter((c) => c === 'aggiornaSessione').length - agg0 === 2 && pushInviati.length === p0 + 1 && x.st.msg.filter((m) => m.autore === 'sistema').length === 1
    && sessioneDi(x, r.d.token).passaggi === 1 && [d1, d2].every((d) => d.ok === true && d.stato === 'attesa_persona'), [d1, d2]);
}
{
  const x = nuovo();
  const esiti = [[{ ok: false, inviati: 0, falliti: 0, destinatari: 0, status: 200 }, 'nessun_iscritto'], [{ ok: false, inviati: 0, falliti: 0, destinatari: null, status: 200, skipped: 'tema_spento' }, 'nessun_iscritto'],
    [{ ok: false, inviati: 0, falliti: 1, destinatari: 1, status: 200 }, 'fallito'], [new Error('rete'), 'fallito']];
  for (const [risp, atteso] of esiti) {
    rispostaPush = risp;
    const r = await avvia(x, { testo: 'aiuto', client_id: randomUUID() });
    const s = sessioneDi(x, r.d.token);
    t('G5 esito della push di passaggio: ' + atteso, x.st.ev.find((e) => e.chiave === `${s.id}:passaggio:1`)?.esito === atteso && r.d.ok === true);
  }
  rispostaPush = { ok: true, inviati: 1, falliti: 0, destinatari: 1, status: 200 };
}

console.log('\n== invia, bottoni, limiti (test 12, 13) ==');
{
  const x = nuovo();
  const r = await avvia(x, { lingua: 'en' });
  const tok = r.d.token;
  const s = sessioneDi(x, tok);
  clock.ora += 3000;
  const b1 = await chiama(x, 'invia', { token: tok, client_id: randomUUID(), bottone: 'spedizioni' });
  t('I1 bottone con risposta: cliente + risposta automatica in inglese, stato resta bot', b1.d.ok && b1.d.stato === 'bot' && b1.d.messaggi.map((m) => m.autore + ':' + m.testo).join('|') === 'cliente:Shipping|automatica:We ship in 2 days.');
  t('I2 fonte della risposta = faq:7, nessuna push', x.st.msg.some((m) => m.fonte === 'faq:7') && !x.st.ev.some((e) => e.tipo === 'push_passaggio'));
  clock.ora += 3000;
  const contaMsg = () => x.st.cont.get(`sess:${s.id}:msg|0`) ?? 0;
  const m0 = contaMsg();
  t('I3 bottone senza risposta (faq null): bottone_non_disponibile, tetto dei messaggi non consumato (Gate 2, C2)',
    (await chiama(x, 'invia', { token: tok, client_id: randomUUID(), bottone: 'resi' })).d.state === 'bottone_non_disponibile' && contaMsg() === m0);
  clock.ora += 3000;
  t('I4 bottone sconosciuto: bottone_non_disponibile', (await chiama(x, 'invia', { token: tok, client_id: randomUUID(), bottone: 'nessuno' })).d.state === 'bottone_non_disponibile');
  x.st.faq.set(7, { testo_it: 'Spediamo.', testo_en: null, attiva: false });
  clock.ora += 3000;
  t('I5 risposta fissa disattivata: bottone_non_disponibile', (await chiama(x, 'invia', { token: tok, client_id: randomUUID(), bottone: 'spedizioni' })).d.state === 'bottone_non_disponibile');
  x.st.faq.set(7, { testo_it: 'Spediamo.', testo_en: null, attiva: true });
  clock.ora += 3000;
  const cid = randomUUID();
  const b2 = await chiama(x, 'invia', { token: tok, client_id: cid, bottone: 'spedizioni' });
  clock.ora += 3000;
  const b3 = await chiama(x, 'invia', { token: tok, client_id: cid, bottone: 'spedizioni' });
  t('I6 testo inglese assente: italiano; stesso client_id: nessuna risposta doppia', b2.d.messaggi[1].testo === 'Spediamo.' && b3.d.messaggi.length === 0 && x.st.msg.filter((m) => m.sessione_id === s.id && m.autore === 'automatica').length === 2);
  t('I7 testo e bottone insieme: 422', (await chiama(x, 'invia', { token: tok, client_id: randomUUID(), testo: 'a', bottone: 'spedizioni' })).r.status === 422);
  t('I8 ne\' testo ne\' bottone: 422', (await chiama(x, 'invia', { token: tok, client_id: randomUUID() })).r.status === 422);
  t('I9 client_id non uuid: 422', (await chiama(x, 'invia', { token: tok, client_id: 'abc', testo: 'a' })).d.campo === 'client_id');
  clock.ora = Math.ceil(clock.ora / 10000) * 10000 + 1000;
  const cinque = [];
  for (let i = 0; i < 5; i++) cinque.push((await chiama(x, 'invia', { token: tok, client_id: randomUUID(), testo: 'n' + i })).d.ok);
  const veloce = await chiama(x, 'invia', { token: tok, client_id: randomUUID(), testo: 'sei' });
  t('I10 5 messaggi in 10 s passano, il sesto 429 con retry_after fino alla finestra dopo (Gate 2, C3)', cinque.every(Boolean) && veloce.r.status === 429 && veloce.d.state === 'troppo_veloce' && veloce.d.retry_after_s === 9);
  clock.ora += 10000;
  x.st.flag.set('chat_sito_enabled', 'false');
  clock.ora += 3000;
  const spenta = await chiama(x, 'invia', { token: tok, client_id: randomUUID(), testo: 'tre' });
  t('I11 chat spenta: spenta, testo non salvato (test 2)', spenta.d.state === 'spenta' && !x.st.msg.some((m) => m.testo === 'tre'));
  x.st.flag.set('chat_sito_enabled', 'true');
}
{
  const x = nuovo();
  const r = await avvia(x);
  const s = sessioneDi(x, r.d.token);
  const esiti = [];
  for (let i = 0; i < 101; i++) {
    clock.ora += 2000;
    esiti.push((await chiama(x, 'invia', { token: r.d.token, client_id: randomUUID(), testo: 'm' + i })).d);
  }
  t('I12 100 messaggi della cliente per chat (D-12): il 101-esimo rifiutato', esiti.slice(0, 100).every((d) => d.ok) && esiti[100].state === 'limite_messaggi'
    && x.st.msg.filter((m) => m.sessione_id === s.id && m.autore === 'cliente').length === 100);
  clock.ora += 2000;
  await chiama(x, 'invia', { token: r.d.token, client_id: randomUUID(), testo: 'ancora' });
  t('I13 evento limite_messaggi una volta sola per chat', x.st.ev.filter((e) => e.tipo === 'limite_messaggi').length === 1);
}
{
  const x = nuovo();
  const r = await avvia(x);
  const s = sessioneDi(x, r.d.token);
  x.st.sess.get(s.id).stato = 'chiusa'; x.st.sess.get(s.id).chiusa_at = iso(clock.ora);
  clock.ora += 3000;
  const c = await chiama(x, 'invia', { token: r.d.token, client_id: randomUUID(), testo: 'ci sei?' });
  t('I14 chat chiusa: 409 chiusa (si apre una chat nuova)', c.r.status === 409 && c.d.state === 'chiusa');
  t('I15 passaggio su una chat chiusa: 409', (await chiama(x, 'passaggio', { token: r.d.token })).r.status === 409);
  const ag = await chiama(x, 'aggiorna', { token: r.d.token, dopo: 0 });
  t('I16 aggiorna su una chat chiusa: si rilegge (stato chiusa)', ag.d.ok && ag.d.stato === 'chiusa');
}

console.log('\n== token di chat (5.4, test 11) ==');
{
  const x = nuovo();
  const r = await avvia(x);
  const s = sessioneDi(x, r.d.token);
  clock.ora += 3000;
  const sconosciuto = await chiama(x, 'aggiorna', { token: 'a'.repeat(43), dopo: 0 });
  t('T1 token sconosciuto: token_non_valido', sconosciuto.d.state === 'token_non_valido');
  t('T2 token di forma sbagliata: 422', (await chiama(x, 'aggiorna', { token: 'corto', dopo: 0 })).r.status === 422);
  clock.ora = Date.parse(s.ultima_attivita_at) + 4 * 3600 * 1000 - 1000;
  t('T3 a 4 ore meno un secondo dall\'ultima attivita\': valido', (await chiama(x, 'aggiorna', { token: r.d.token, dopo: 0 })).d.ok === true);
  clock.ora += 2000;
  t('T4 oltre 4 ore senza attivita\': token_non_valido (come uno sconosciuto)', (await chiama(x, 'aggiorna', { token: r.d.token, dopo: 0 })).d.state === 'token_non_valido');
  t('T5 i poll non allungano la vita del token', x.st.sess.get(s.id).ultima_attivita_at === s.ultima_attivita_at);
  clock.ora = Date.parse('2026-11-09T09:30:00Z');
  const y = nuovo();
  const r2 = await avvia(y);
  y.st.tok[0].revocato_at = iso(clock.ora);
  clock.ora += 3000;
  t('T6 token revocato: token_non_valido', (await chiama(y, 'aggiorna', { token: r2.d.token, dopo: 0 })).d.state === 'token_non_valido');
  y.st.tok[0].revocato_at = null; y.st.tok[0].scade_at = iso(clock.ora - 1);
  t('T7 token oltre la scadenza assoluta: token_non_valido', (await chiama(y, 'aggiorna', { token: r2.d.token, dopo: 0 })).d.state === 'token_non_valido');
  const z = nuovo();
  const r3 = await avvia(z);
  z.st.tok[0].tipo = 'ripresa';
  clock.ora += 3000;
  t('T8 un token di ripresa non vale come token di chat', (await chiama(z, 'aggiorna', { token: r3.d.token, dopo: 0 })).d.state === 'token_non_valido');
}

console.log('\n== aggiorna (6.2) ==');
{
  const x = nuovo();
  const r = await avvia(x, { testo: 'ciao', client_id: randomUUID() });
  const s = sessioneDi(x, r.d.token);
  x.st.msg.push({ id: randomUUID(), seq: ++x.st.seq, sessione_id: s.id, autore: 'staff', staff_nome: 'Ginevra', testo: 'Risposta del team', client_msg_id: null,
    send_key: randomUUID(), fonte: null, delivered_at: null, email_stato: 'inviata', created_at: iso(clock.ora) });
  clock.ora += 3000;
  const a1 = await chiama(x, 'aggiorna', { token: r.d.token, dopo: 0 });
  t('A20 messaggi in ordine di seq, staff come "staff" senza nome, via_email dallo stato dell\'email', a1.d.ok && a1.d.messaggi.map((m) => m.autore).join() === 'cliente,sistema,staff'
    && a1.d.messaggi[2].via_email === true && !a1.testo.includes('Ginevra') && a1.d.altri === false);
  t('A21 senza vista: delivered_at resta vuoto', x.st.msg.at(-1).delivered_at === null);
  clock.ora += 1500;
  const a2 = await chiama(x, 'aggiorna', { token: r.d.token, dopo: a1.d.messaggi[1].seq, vista: true });
  t('A22 cursore: solo i messaggi dopo; con vista: delivered_at scritto sullo staff', a2.d.messaggi.length === 1 && x.st.msg.at(-1).delivered_at !== null);
  clock.ora = Math.ceil(clock.ora / 10000) * 10000 + 2000;
  const dieci = [];
  for (let i = 0; i < 10; i++) dieci.push((await chiama(x, 'aggiorna', { token: r.d.token, dopo: 0 })).d.ok);
  const veloce = await chiama(x, 'aggiorna', { token: r.d.token, dopo: 0 });
  t('A23 10 aggiorna in 10 s passano, l\'undicesimo 429 (in media uno al secondo, Gate 2 C3)', dieci.every(Boolean) && veloce.r.status === 429 && veloce.d.retry_after_s === 8);
  clock.ora += 10000;
  for (let i = 0; i < 60; i++) x.st.msg.push({ id: randomUUID(), seq: ++x.st.seq, sessione_id: s.id, autore: 'sistema', testo: 'n' + i, client_msg_id: randomUUID(), delivered_at: null, email_stato: null, created_at: iso(clock.ora) });
  clock.ora += 1500;
  const a3 = await chiama(x, 'aggiorna', { token: r.d.token, dopo: 0 });
  t('A24 al massimo 50 per volta, con altri = true', a3.d.messaggi.length === 50 && a3.d.altri === true);
  x.st.flag.set('chat_sito_enabled', 'false');
  clock.ora += 1500;
  t('A25 chat spenta: aggiorna continua sulle chat aperte (5.8)', (await chiama(x, 'aggiorna', { token: r.d.token, dopo: 0 })).d.ok === true);
  clock.ora += 1500;
  t('A26 dopo negativo o non intero: 422', (await chiama(x, 'aggiorna', { token: r.d.token, dopo: -1 })).r.status === 422 && (await chiama(x, 'aggiorna', { token: r.d.token, dopo: 1.5 })).r.status === 422);
}

console.log('\n== riprendi (5.4, test 10) ==');
{
  const x = nuovo();
  const r = await avvia(x);
  const s = sessioneDi(x, r.d.token);
  const ripresa = randomBytes(32).toString('base64url');
  x.st.tok.push({ id: randomUUID(), sessione_id: s.id, tipo: 'ripresa', hash: sha(ripresa), scade_at: iso(clock.ora + 30 * 86400000), revocato_at: null, usato_at: null, created_at: iso(clock.ora), n: ++x.st.tseq });
  clock.ora += 5 * 3600 * 1000;                                   // il chat token del primo dispositivo e' scaduto
  t('R10 chat token vecchio scaduto dopo 5 ore', (await chiama(x, 'aggiorna', { token: r.d.token, dopo: 0 })).d.state === 'token_non_valido');
  const nTok0 = x.st.chiamate.filter((c) => c === 'token:ripresa').length;
  svRisposta = { success: false };
  const ts = await chiama(x, 'riprendi', { token_ripresa: ripresa, turnstile: tsR() });
  svRisposta = null;
  t('R11 Turnstile negativo: verifica_fallita prima di leggere il token', ts.d.state === 'verifica_fallita' && x.st.chiamate.filter((c) => c === 'token:ripresa').length === nTok0);
  const avvTok = await chiama(x, 'riprendi', { token_ripresa: ripresa, turnstile: tsA() });
  t('R12 token Turnstile di avvia su riprendi: rifiutato (azione)', avvTok.d.state === 'verifica_fallita');
  const ok1 = await chiama(x, 'riprendi', { token_ripresa: ripresa, turnstile: tsR() });
  t('R13 ripresa: chat token nuovo, email mascherata, ultima attivita\' aggiornata, uso registrato', ok1.d.ok && /^[A-Za-z0-9_-]{43}$/.test(ok1.d.token) && ok1.d.email === 'c***@esempio.it'
    && x.st.sess.get(s.id).ultima_attivita_at === iso(clock.ora) && x.st.tok.find((y) => y.tipo === 'ripresa').usato_at !== null);
  clock.ora += 1500;
  const ag = await chiama(x, 'aggiorna', { token: ok1.d.token, dopo: 0 });
  t('R14 il token nuovo legge la stessa chat', ag.d.ok === true);
  const toks = [ok1.d.token];
  for (let i = 0; i < 3; i++) { clock.ora += 1000; toks.push((await chiama(x, 'riprendi', { token_ripresa: ripresa, turnstile: tsR() })).d.token); }
  const attivi = x.st.tok.filter((y) => y.tipo === 'chat' && !y.revocato_at && y.sessione_id === s.id);
  t('R15 al massimo 3 chat token attivi: il piu\' vecchio revocato', attivi.length === 3 && !attivi.some((y) => y.hash === sha(toks[0])) && x.st.tok.find((y) => y.hash === sha(toks[0])).revocato_at !== null);
  clock.ora += 1500;
  t('R16 il token revocato non legge piu\'', (await chiama(x, 'aggiorna', { token: toks[0], dopo: 0 })).d.state === 'token_non_valido');
  const alterato = ripresa.slice(0, -1) + (ripresa.at(-1) === 'A' ? 'B' : 'A');
  t('R17 token di ripresa alterato: token_non_valido, nessun dato', (await chiama(x, 'riprendi', { token_ripresa: alterato, turnstile: tsR() })).testo === '{"ok":false,"state":"token_non_valido"}');
  t('R18 un chat token non vale come token di ripresa', (await chiama(x, 'riprendi', { token_ripresa: toks[3], turnstile: tsR() })).d.state === 'token_non_valido');
  svRisposta = { success: true, hostname: 'amimi.it', action: 'chat_riprendi' };
  t('R19 widget di prova su una sessione vera: token_non_valido', (await chiama(x, 'riprendi', { token_ripresa: ripresa, turnstile: tsR(), prova: true })).d.state === 'token_non_valido');
  svRisposta = null;
  x.st.tok.find((y) => y.tipo === 'ripresa').scade_at = iso(clock.ora - 1);
  t('R20 token di ripresa scaduto (30 giorni): token_non_valido', (await chiama(x, 'riprendi', { token_ripresa: ripresa, turnstile: tsR() })).d.state === 'token_non_valido');
  const y = nuovo({ chat_sito_enabled: 'false' });
  t('R21 chat spenta: riprendi risponde spenta', (await chiama(y, 'riprendi', { token_ripresa: ripresa, turnstile: tsR() })).d.state === 'spenta');
}

console.log('\n== errore del widget (8.10 riga 13) ==');
{
  const x = nuovo();
  const ok1 = await chiama(x, 'errore', { codice: 'pannello_non_aperto', versione: '1.0.0', pagina: 'prodotto' });
  t('E1 beacon contato, evento senza testo libero', ok1.d.contato === true && x.st.ev.some((e) => e.tipo === 'errore_widget' && e.dettaglio.codice === 'pannello_non_aperto'));
  t('E2 codice con testo libero: 422', (await chiama(x, 'errore', { codice: 'Errore: x', versione: '1', pagina: 'home' })).r.status === 422);
  t('E3 pagina fuori lista (URL): 422', (await chiama(x, 'errore', { codice: 'x', versione: '1', pagina: 'https://amimi.it/x' })).r.status === 422);
  for (let i = 0; i < 101; i++) await chiama(x, 'errore', { codice: 'x', versione: '1', pagina: 'home' });
  t('E4 oltre 100 al giorno: non piu\' contati, un solo evento tetto_beacon', x.st.ev.filter((e) => e.tipo === 'errore_widget').length === 100 && x.st.ev.filter((e) => e.tipo === 'tetto_beacon').length === 1);
  const y = nuovo({ chat_sito_enabled: 'false' });
  t('E5 il beacon funziona anche a chat spenta', (await chiama(y, 'errore', { codice: 'x', versione: '1', pagina: 'home' })).d.contato === true);
}

console.log('\n== salute (5.8, D-12) ==');
{
  M.azzeraSalute();
  const x = nuovo();
  await chiama(x, 'config', null, { metodo: 'GET' });
  t('H1 prima richiesta del giorno: una riga ok con n = 1', x.st.salute.length === 1 && x.st.salute[0].n === 1 && x.st.salute[0].severity === 'ok' && x.st.salute[0].giorno === '2026-11-09');
  await chiama(x, 'config', null, { metodo: 'GET' });
  t('H2 richieste normali: nessuna scrittura in piu\'', x.st.salute.length === 1);
  x.st.cont.set('glob:richieste|' + Math.floor(clock.ora / 1000 / 86400) * 86400, 4999);
  await chiama(x, 'config', null, { metodo: 'GET' });
  t('H3 alla richiesta 5.000: warn ed evento quota:<giorno> (chat_salute, pezzo 4)', x.st.salute.at(-1).n === 5000 && x.st.salute.at(-1).severity === 'warn' && x.st.ev.some((e) => e.chiave === 'quota:2026-11-09'));
  await chiama(x, 'avvia', { email: 'a@b.it', informativa: 'x', turnstile: tsA(), extra: 1 }, { opz: { firmaGiusta: false } });
  t('H4 anche le richieste rifiutate contano', x.st.cont.get('glob:richieste|' + Math.floor(clock.ora / 1000 / 86400) * 86400) === 5001);
  const y = nuovo();
  const orig = y.db.contatore;
  y.db.contatore = async (...q) => { if (q[0] === 'glob:richieste') throw new M.ErroreDb('x'); return orig(...q); };
  const r = await chiama(y, 'config', null, { metodo: 'GET' });
  t('H5 contatore delle richieste in errore: la risposta non cambia, warn in salute', r.d.attiva === true && y.st.salute.at(-1)?.severity === 'warn');
  // B2: la gravita' del giorno vive nei contatori glob:sev_*, che il refresh delle 06:00 UTC non cancella
  const z = nuovo();
  z.st.guasti.set('flag', 1);
  await chiama(z, 'avvia', { email: 'a@b.it', informativa: 'x', turnstile: tsA() });
  const giornoZ = Math.floor(clock.ora / 1000 / 86400) * 86400;
  t('H6 un problema conta in glob:sev_error del giorno e scrive la riga in error', z.st.cont.get('glob:sev_error|' + giornoZ) === 1 && z.st.salute.at(-1)?.severity === 'error');
  const w0 = z.st.salute.length;
  await chiama(z, 'config', null, { metodo: 'GET' });
  const w1 = z.st.salute.length;
  clock.ora += 3600 * 1000;
  await chiama(z, 'config', null, { metodo: 'GET' });
  t('H7 nell\'ora nessuna riscrittura; dopo un\'ora una richiesta normale riscrive la riga (dopo il refresh delle 06:00)', w1 === w0 && z.st.salute.length === w0 + 1 && z.st.salute.at(-1).severity === 'ok');
  clock.ora = Date.parse('2026-11-09T09:30:00Z');
  const q = nuovo();
  q.st.cont.set('glob:richieste|' + Math.floor(clock.ora / 1000 / 86400) * 86400, 5099);
  await chiama(q, 'config', null, { metodo: 'GET' });
  t('H8 oltre la soglia l\'evento quota si ritenta ogni 100 richieste, una riga sola (Gate 2, C8)', q.st.ev.filter((e) => e.chiave === 'quota:2026-11-09').length === 1 && q.st.salute.at(-1)?.severity === 'warn');
}

console.log('\n== orari (D-8) e funzioni pure ==');
{
  const o = { tz: 'Europe/Rome', giorni: [1, 2, 3, 4, 5], dalle: '09:00', alle: '18:00', chiusure: ['2026-12-25'] };
  t('O1 lunedi\' 10:30 a Roma (09:30 UTC): in orario', M.inOrario(o, Date.parse('2026-11-09T09:30:00Z')));
  t('O2 lunedi\' 08:30 a Roma: fuori', !M.inOrario(o, Date.parse('2026-11-09T07:30:00Z')));
  t('O3 lunedi\' 18:00 a Roma: fuori (alle escluso)', !M.inOrario(o, Date.parse('2026-11-09T17:00:00Z')));
  t('O4 sabato: fuori', !M.inOrario(o, Date.parse('2026-11-14T10:00:00Z')));
  t('O5 giorno di chiusura: fuori', !M.inOrario(o, Date.parse('2026-12-25T10:00:00Z')));
  t('O6 ora legale: 1 luglio 07:30 UTC = 09:30 a Roma, in orario', M.inOrario({ ...o, chiusure: [] }, Date.parse('2026-07-01T07:30:00Z')));
  t('O7 fuso illeggibile o orari nulli: fuori orario (testo senza tempi promessi)', !M.inOrario({ ...o, tz: 'Marte/Base' }, Date.parse('2026-11-09T09:30:00Z')) && !M.inOrario(null, 0));
  const lunga = { ...M.interpretaFlag({}), testi: { attesa: { it: (String.fromCodePoint(0x1F600) + '{email}').repeat(140), en: 'x' }, fuori_orario: null } };
  const att = M.testoAttesa(lunga, { lingua: 'it', customer_email: 'n'.repeat(240) + '@esempio.it' }, Date.parse('2026-11-09T09:30:00Z'));
  t('O7b avviso di attesa tagliato a 4000 punti di codice, senza mezze emoji (Gate 2, B1)', [...att].length <= 4000 && att.isWellFormed());
  t('O8 email mascherata', M.mascheraEmail('nome@esempio.it') === 'n***@esempio.it' && M.mascheraEmail('\u00e8@x.it') === '\u00e8***@x.it');
  const u1 = await M.uuidDa('a'), u2 = await M.uuidDa('a'), u3 = await M.uuidDa('b');
  t('O9 uuid derivati: stabili, distinti, formato uuid valido per Postgres', u1 === u2 && u1 !== u3 && /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u1));
  t('O10 push: chi e\' la cliente senza testo; caratteri di formato tolti dal nome', M.messaggioPush({ customer_name: 'Ann\u202Ea', customer_email: 'a@b.it', prova: false }, true).titolo === 'Chat del sito: Anna chiede una persona'
    && M.messaggioPush({ customer_name: null, customer_email: 'NON EMAIL', prova: false }, true).titolo === 'Chat del sito: Una cliente chiede una persona');
}

console.log('\n== impronte: copie di push-eventi (8.7) e regole comuni ==');
{
  const corpo = (src, nome) => { const i = src.indexOf(nome); if (i < 0) return null; const j = src.indexOf('\n}\n', i); return src.slice(i, j + 2); };
  for (const nome of ['function pulisci(', 'function emailCliente(', 'function nomeCliente(', 'function statoDaEsito(', 'function esitoDaSalvare(']) {
    t('I ' + nome.slice(9, -1) + ' identica a push-eventi', corpo(BLOCCO, nome) !== null && corpo(BLOCCO, nome) === corpo(PE, nome));
  }
  const re = (src) => (src.match(/const EMAIL_CLIENTE_RE = [^\n]+/) ?? [''])[0];
  t('I EMAIL_CLIENTE_RE identica a push-eventi', re(BLOCCO) !== '' && re(BLOCCO) === re(PE));
  const ECO = read('supabase/functions/chat-api/eco.ts');
  for (const nome of ['async function appProxyHmacHex(', 'function timingSafeEqualHex(', 'async function leggiCorpo(', 'function etaFirma(']) {
    t('I ' + nome.replace(/^(async )?function /, '').slice(0, -1) + ' identica a eco.ts (provata contro node:crypto da tests/chat_api_eco.mjs)', corpo(BLOCCO, nome) !== null && corpo(BLOCCO, nome) === corpo(ECO, nome));
  }
  t('I statoDaEsito: mappa di push-eventi', M.statoDaEsito({ ok: true }) === 'inviato' && M.statoDaEsito({ ok: false, status: 200, destinatari: 0 }) === 'nessun_iscritto' && M.statoDaEsito({ ok: false, status: 500 }) === 'fallito');
}

console.log('\n== tutte le risposte ==');
{
  t('X1 nessuna risposta 5xx in tutto il giro (il proxy li fa diventare HTML)', STATI.every((s) => s.status < 500), STATI.filter((s) => s.status >= 500));
  t('X2 ogni risposta della chat porta Cache-Control: no-store', STATI.filter((s) => s.status !== 204 && !['eco', 'misura', 'turnstile'].includes(s.azione)).every((s) => s.cc === 'no-store'));
  t('X3 ogni risposta della chat e\' JSON', STATI.filter((s) => s.status !== 204 && !['eco', 'misura', 'turnstile'].includes(s.azione)).every((s) => s.ct === 'application/json; charset=utf-8'));
}

console.log('\n== guardie sul sorgente ==');
{
  const senzaCommenti = (s) => s.replace(/^\s*\/\/.*$/gm, '');
  const codice = senzaCommenti(SRC);
  const fuori = senzaCommenti(SRC.slice(0, a) + SRC.slice(b));
  t('G1 [functions.chat-api] verify_jwt = false in config.toml', /\[functions\.chat-api\]\s*\nverify_jwt = false/.test(CONFIG));
  t('G2 nessuno status 5xx nel blocco puro', !/,\s*5\d\d\)/.test(senzaCommenti(BLOCCO)) && !/status:\s*5\d\d/.test(senzaCommenti(BLOCCO)));
  t('G3 ogni Response porta HEADER_BASE', (BLOCCO.match(/new Response\(/g) ?? []).length === (BLOCCO.match(/new Response\([^\n]*HEADER_BASE/g) ?? []).length);
  t('G4 nessun header CORS', !/Access-Control-Allow/i.test(SRC));
  const logs = codice.match(/console\.error\([^\n]*/g) ?? [];
  t('G5 log: solo console.error con causa fissa e codice del DB, mai altro', !/console\.(log|info|warn|debug|trace)/.test(codice) && logs.length === 2
    && logs.every((l) => /^console\.error\(('chat-api: ' \+ causa|'chat-api: [a-z ]+'), codice\((e|error)\)\);$/.test(l)), logs);
  const envs = [...codice.matchAll(/env\('([A-Z_]+)'\)/g)].map((m) => m[1]).sort();
  t('G6 segreti e ambiente: solo i cinque nomi attesi, letti fuori dal blocco puro', JSON.stringify([...new Set(envs)]) === JSON.stringify(['CHAT_APP_PROXY_SECRET', 'CHAT_TURNSTILE_PRODUZIONE_SECRET', 'CHAT_TURNSTILE_PROVA_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'])
    && !/Deno\.env/.test(BLOCCO) && (codice.match(/Deno\.env\.get\(/g) ?? []).length === 1);
  const tabelle = [...new Set([...fuori.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]))].sort();
  t('G7 tabelle toccate: solo chat_*, app_flags, cs_faq e health_log', JSON.stringify(tabelle) === JSON.stringify(['app_flags', 'chat_contatori', 'chat_eventi', 'chat_messaggi', 'chat_sessioni', 'chat_token', 'cs_faq', 'health_log']), tabelle);
  t('G7b chat_contatori solo letta (si scrive solo con la RPC atomica)', !/from\('chat_contatori'\)\.(insert|update|upsert|delete)/.test(fuori));
  t('G7c un bottone legge da cs_faq solo righe pubblicabili, mai gli esempi di tono (Gate 2, C5)', /from\('cs_faq'\)\.select\('testo_it, testo_en, attiva'\)\.eq\('id', id\)\.in\('tipo', \['faq', 'risposta_standard'\]\)/.test(fuori));
  t('G8 app_flags letta solo con .in() sull\'elenco chiuso, mai select *', /from\('app_flags'\)\.select\('key, value'\)\.in\('key', chiavi\)/.test(fuori) && !/select\('\*'\)/.test(codice));
  t('G9 cs_faq e app_flags in sola lettura', !/from\('(cs_faq|app_flags)'\)\.(insert|update|upsert|delete)/.test(fuori));
  t('G10 health_log: una sola scrittura, k chat_api, e la gravita\' del giorno dai contatori', (fuori.match(/from\('health_log'\)/g) ?? []).length === 1 && !/k: '(?!chat_api)/.test(fuori) && /k: 'chat_api'/.test(fuori)
    && /in\('chiave', \['glob:sev_error', 'glob:sev_warn'\]\)/.test(fuori));
  t('G11 niente write-api, PIN, change_log, cs_conversations o cs_messages (proiezione nel pezzo dei 25 punti)', !/write-api|\bpin\b|pin_hash|change_log|cs_conversations|cs_messages|cs_events/.test(codice));
  t('G12 una sola RPC, quella dei contatori', [...codice.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1]).join() === 'chat_contatore_incrementa');
  t('G13 fetch: solo siteverify (push via _shared/push.ts)', (fuori.match(/\bfetch\(/g) ?? []).length === 1 && /fetch\(SITEVERIFY_URL, \{ method: 'POST', body: new URLSearchParams\(\{ secret, response: token \}\), signal: AbortSignal\.timeout\(10000\) \}\)/.test(fuori) && !/\bfetch\(/.test(senzaCommenti(BLOCCO)));
  t('G14 importa _shared/push.ts (chat-api e\' importatrice: test 102) e l\'eco', /from '\.\.\/_shared\/push\.ts';/.test(SRC) && /import \{ rispondiEco \} from '\.\/eco\.ts';/.test(SRC) && /eco: rispondiEco,/.test(fuori));
  t('G15 le rotte dell\'eco sono solo le tre dello spike', JSON.stringify(M.ROTTE_ECO) === '["eco","misura","turnstile"]' && JSON.stringify(Object.keys(M.METODO).sort()) === '["aggiorna","avvia","config","errore","invia","passaggio","riprendi"]');
  t('G16 messaggi idempotenti su (sessione_id, client_msg_id); eventi sulla chiave', /onConflict: 'sessione_id,client_msg_id', ignoreDuplicates: true/.test(fuori) && /onConflict: 'chiave', ignoreDuplicates: true/.test(fuori));
  t('G17 le scritture non ritentano: retryOnce solo su select', [...fuori.matchAll(/retryOnce\(\(\) => sb\.from\('[a-z_]+'\)\.([a-z]+)\(/g)].every((m) => m[1] === 'select'));
  t('G18 passaggio con update condizionato su stato e passaggi', /aggiornaSessione\(s\.id, patch, \{ stato: 'bot', passaggi: s\.passaggi \}\)/.test(BLOCCO));
  t('G19 host di prova legato all\'id del negozio', M.HOST_ANTEPRIMA_RE.test('abc-95215747399.shopifypreview.com') && !M.HOST_ANTEPRIMA_RE.test('abc-95215747399.shopifypreview.com.evil.it') && !M.HOST_ANTEPRIMA_RE.test('x.abc-95215747399.shopifypreview.com'));
  t('G20 il token di chat non finisce mai in un URL ne\' in un log', !/searchParams\.get\('token/.test(SRC) && !/console\.error\([^)]*token/.test(codice));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
