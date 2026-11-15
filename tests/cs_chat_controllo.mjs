// tests/cs_chat_controllo.mjs: la edge chat-controllo ctl-1 (chat del sito, Fase 1 pezzo 8, docs/PROPOSTA_chat_sito.md 4.6
// punto 2, 8.10 riga 12, 13.4 test 19) ritagliata DAL SORGENTE che va in produzione (blocco PURE) e guidata in Node con
// Request veri, una rete finta (pagine e config) e un DB finto; piu' le guardie sul sorgente, su config.toml e sulla migr
// 0196. Nessuna rete. Nel glob `tests/cs_*.mjs` della CI (come cs_chat_sito e cs_chat_testi): il workflow non si tocca.
//   node tests/cs_chat_controllo.mjs
// Perche' esiste: un controllo che manda una push ogni mattina per niente (prima del go-live amimi.it non ha l'embed per
// scelta, e il link d'anteprima della copia scade dopo 2 giorni) viene ignorato, e allora il giorno che manca davvero la
// chat sul sito non lo vede nessuno. E il link d'anteprima non deve finire nel repo, che e' pubblico.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

process.removeAllListeners('warning');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const SRC = read('supabase/functions/chat-controllo/index.ts');
const CONFIG = read('supabase/config.toml');
const M0196 = read('supabase/migrations/0196_chat_controllo.sql');
const EMBED = read('shopify/amimi-chat/extensions/chat-widget/blocks/chat-embed.liquid');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 400) : '')); } };

function blocco(src, nome) {
  const B = `// ==== PURE:${nome} BEGIN ====`, E = `// ==== PURE:${nome} END ====`;
  const a = src.indexOf(B), b = src.indexOf(E);
  if (a < 0 || b < a) return null;
  return src.slice(a + B.length, b);
}
const ESPORTA = 'return { gestisci, analizza, esitoConfig, valuta, controllo, conRitento, modoDi, VERSIONE, K_SALUTE, URL_AMIMI, URL_CONFIG, ANTEPRIMA_RE, MARCATORE, INBOX, ErroreDb };';
const carica = (src) => new Function(stripTypeScriptTypes(blocco(src, 'chat-controllo')) + '\n' + ESPORTA)();
if (blocco(SRC, 'chat-controllo') === null) { console.error('marcatori PURE:chat-controllo non trovati'); process.exit(1); }
const C = carica(SRC);

// ---------- pagine finte (sintetiche: niente HTML vero del negozio nel repo) ----------
const LINK = 'https://k3x9q2w7z1m5b8v4-95215747399.shopifypreview.com';
const tema = (role) => `<script>var Shopify = Shopify || {};\nShopify.theme = {"name":"Symmetry - prova","id":123,"schema_name":"Symmetry","theme_store_id":568,"role":"${role}"};</script>`;
const embed = (prova) => `<!-- BEGIN app block: shopify://apps/amimi-chat/blocks/chat-embed/x -->\n<div\n  id="amimi-chat-embed"\n  data-pannello="https://cdn.shopify.com/x/chat-panel.js"\n  data-posizione="bottom_right"\n  data-colore="#1f1f1f"\n  ${prova === undefined ? '' : `data-prova="${prova}"`}\n  hidden\n></div>\n<!-- END app block -->`;
const INBOX_HTML = `<script id='shopify-chat-app-embed-data' type='application/json'>{"x":1}</script>`;
const pagina = ({ role = 'main', prova, marcatore = true, inbox = false, prima = '' } = {}) =>
  `<!doctype html><html><head>${tema(role)}</head><body>${prima}<main>Amimi</main>${marcatore ? embed(prova) : ''}${inbox ? INBOX_HTML : ''}</body></html>`;
const CONFIG_OK = JSON.stringify({ ok: true, versione: 'api-4', attiva: false });

console.log('== analizza: ruolo del tema, marcatore, Modalita\' prova del SUO tag, Inbox ==');
{
  const a = C.analizza(pagina({ role: 'unpublished', prova: 'true' }));
  t('A1 copia accesa in prova: ruolo unpublished, marcatore, prova true, niente Inbox', isDeepStrictEqual(a, { ruolo: 'unpublished', marcatore: true, prova: 'true', inbox: false }), a);
  t('A2 home pubblicata con Inbox e senza embed (amimi.it prima del go-live)', isDeepStrictEqual(C.analizza(pagina({ marcatore: false, inbox: true })), { ruolo: 'main', marcatore: false, prova: null, inbox: true }));
  t('A3 data-prova di un ALTRO elemento non conta; il marcatore senza data-prova = non leggibile', C.analizza(pagina({ prima: '<div data-prova="true"></div>' })).prova === null
    && C.analizza(pagina({ prova: 'false', prima: '<div data-prova="true"></div>' })).prova === 'false' && C.analizza(pagina({ prova: 'boh' })).prova === null);
  t('A4 senza Shopify.theme il ruolo e\' null; un ruolo strano non passa', C.analizza('<html>' + embed('true') + '</html>').ruolo === null
    && C.analizza(pagina({ role: 'Main<script>' })).ruolo === null);
  t('A5 il marcatore e\' l\'id fisso del blocco vero (chat-embed.liquid) e non cambia senza che questa suite lo sappia', EMBED.includes('id="amimi-chat-embed"') && C.MARCATORE === 'id="amimi-chat-embed"'
    && EMBED.includes('data-prova="{{ block.settings.modalita_prova }}"') && C.INBOX === 'shopify-chat-app-embed-data');
}

console.log('\n== esitoConfig: firma valida solo con la risposta di chat-api via proxy ==');
{
  const e = (stato, testo) => C.esitoConfig({ stato, testo });
  t('C1 200 {ok, versione api-N, attiva} = ok, accesa o spenta', e(200, CONFIG_OK) === 'ok' && e(200, JSON.stringify({ ok: true, versione: 'api-12', attiva: true, testi: {} })) === 'ok');
  t('C2 secret assente, firma rifiutata, 5xx del proxy (HTML), rete, JSON storti', e(200, JSON.stringify({ ok: false, state: 'needs_secret' })) === 'secret_mancante' && e(401, '{"ok":false,"error":"bad_signature"}') === 'firma_rifiutata'
    && e(500, '<html>500</html>') === 'http_500' && e(null, null) === 'senza_risposta' && e(200, null) === 'senza_risposta' && e(200, '<html>') === 'risposta_non_valida'
    && e(200, JSON.stringify({ ok: true })) === 'risposta_non_valida' && e(200, JSON.stringify({ ok: true, versione: 'eco-2', attiva: false })) === 'risposta_non_valida'
    && e(200, JSON.stringify([1])) === 'risposta_non_valida' && e(200, JSON.stringify({ ok: false, state: 'riprova' })) === 'risposta_non_valida');
}

console.log('\n== valuta: cosa aspettarsi prima del go-live (copia) e dopo (amimi.it) ==');
const pag = (stato, testo) => ({ motivo: null, r: { stato, testo } });
{
  const v = (modo, p, cfg = 'ok') => C.valuta(modo, p, cfg);
  const okCopia = v('copia', pag(200, pagina({ role: 'unpublished', prova: 'true' })));
  t('V1 copia controllata, tutto atteso: ok, n 0, label fissa', okCopia.severity === 'ok' && okCopia.n === 0 && okCopia.pagina === 'controllata' && isDeepStrictEqual(okCopia.mancano, [])
    && okCopia.label === 'Chat del sito, copia di prova del tema: embed presente in Modalita\' prova, Inbox assente; config con firma valida', okCopia);
  const okHome = v('amimi.it', pag(200, pagina({ prova: 'false' })));
  t('V2 amimi.it dopo il go-live, tutto atteso: ok', okHome.severity === 'ok' && okHome.n === 0
    && okHome.label === 'Chat del sito, home di amimi.it: embed presente, Modalita\' prova spenta, Inbox assente; config con firma valida', okHome);
  const copiaSpenta = v('copia', pag(200, pagina({ role: 'unpublished', prova: 'false', inbox: true })));
  t('V3 copia con Modalita\' prova spenta e Inbox: error, n 2', copiaSpenta.severity === 'error' && isDeepStrictEqual(copiaSpenta.mancano, ['prova', 'inbox'])
    && copiaSpenta.label === 'Chat del sito, copia di prova del tema: embed non in Modalita\' prova; c\'e\' la chat di Inbox; config con firma valida', copiaSpenta);
  const homePrima = v('amimi.it', pag(200, pagina({ marcatore: false, inbox: true })));
  t('V4 amimi.it com\'e\' oggi (prima del go-live): manca l\'embed, c\'e\' Inbox = error (per questo prima del go-live si guarda la copia)', homePrima.severity === 'error'
    && isDeepStrictEqual(homePrima.mancano, ['marcatore', 'inbox']) && homePrima.n === 2, homePrima);
  t('V5 amimi.it con l\'embed in Modalita\' prova, o prova non leggibile: error', isDeepStrictEqual(v('amimi.it', pag(200, pagina({ prova: 'true' }))).mancano, ['prova'])
    && v('amimi.it', pag(200, pagina({ prova: 'true' }))).label.includes('embed in Modalita\' prova') && isDeepStrictEqual(v('amimi.it', pag(200, pagina({}))).mancano, ['prova'])
    && v('amimi.it', pag(200, pagina({}))).label.includes('Modalita\' prova non leggibile'));
  const non = (p) => { const e = v('copia', p); return [e.pagina, e.severity, e.n]; };
  t('V6 copia non controllata: link scaduto (410, 404) o assente = ok senza push; non raggiungibile, link non valido o che apre il tema pubblicato = warn senza push',
    isDeepStrictEqual(non(pag(410, 'gone')), ['scaduta', 'ok', 0]) && isDeepStrictEqual(non(pag(404, 'x')), ['scaduta', 'ok', 0])
    && isDeepStrictEqual(non({ motivo: 'senza_link', r: null }), ['senza_link', 'ok', 0]) && isDeepStrictEqual(non({ motivo: 'link_non_valido', r: null }), ['link_non_valido', 'warn', 0])
    && isDeepStrictEqual(non(pag(503, 'x')), ['non_raggiungibile', 'warn', 0]) && isDeepStrictEqual(non(pag(null, null)), ['non_raggiungibile', 'warn', 0])
    && isDeepStrictEqual(non(pag(200, pagina({ role: 'main', marcatore: false, inbox: true }))), ['non_e_la_copia', 'warn', 0]) && isDeepStrictEqual(non(pag(200, null)), ['non_raggiungibile', 'warn', 0])
    && v('copia', pag(410, 'x')).label === 'Chat del sito, copia di prova del tema: pagina non controllata (link d\'anteprima scaduto); config con firma valida');
  const cfgKo = v('copia', pag(410, 'x'), 'firma_rifiutata');
  t('V7 config senza firma valida = error anche con il link scaduto (il proxy e\' del negozio, non del tema)', cfgKo.severity === 'error' && isDeepStrictEqual(cfgKo.mancano, ['config'])
    && cfgKo.label === 'Chat del sito, copia di prova del tema: pagina non controllata (link d\'anteprima scaduto); config senza firma valida (firma rifiutata)'
    && v('amimi.it', pag(200, pagina({ prova: 'false' })), 'http_500').label.endsWith('config senza firma valida (HTTP 500)')
    && v('amimi.it', pag(200, pagina({ prova: 'false' })), 'secret_mancante').label.endsWith('(secret del proxy assente)'));
  const giu = v('amimi.it', pag(503, 'x')), rete = v('amimi.it', pag(null, null));
  t('V8 amimi.it non leggibile = error (dal go-live la home DEVE rispondere)', giu.severity === 'error' && isDeepStrictEqual(giu.mancano, ['home']) && giu.label.includes('home non leggibile (HTTP 503)')
    && rete.label.includes('home non leggibile (senza risposta)') && v('amimi.it', pag(410, 'x')).severity === 'error');
  // ogni combinazione: label di solo testo fisso, mai un pezzo della pagina o il link; niente em dash; corta
  const tutte = [];
  for (const modo of ['copia', 'amimi.it']) for (const st of [200, 404, 410, 500, null]) for (const role of ['main', 'unpublished']) for (const prova of ['true', 'false', undefined])
    for (const inbox of [true, false]) for (const marcatore of [true, false]) for (const cfg of ['ok', 'firma_rifiutata', 'http_502', 'senza_risposta'])
      tutte.push(v(modo, pag(st, st === null ? null : pagina({ role, prova, inbox, marcatore, prima: 'Maria Rossi <b>' + LINK + '</b>' })), cfg));
  for (const motivo of ['senza_link', 'link_non_valido']) tutte.push(v('copia', { motivo, r: null }, 'ok'));
  const brutte = tutte.filter((e) => e.label.length > 300 || /Maria|shopifypreview|<|>|—/.test(e.label) || !e.label.startsWith('Chat del sito, ')
    || !['ok', 'warn', 'error'].includes(e.severity) || (e.severity === 'error') !== (e.n > 0) || e.n !== e.mancano.length);
  t(`V9 ${tutte.length} combinazioni: label di testo fisso (mai la pagina o il link), al massimo 300 caratteri, error se e solo se manca qualcosa`, brutte.length === 0 && tutte.length > 900, brutte[0]);
}

console.log('\n== controllo: quali chiamate fuori, con un ritentativo solo dove serve ==');
const reteFinta = (risposte) => {
  const log = [], sonni = [];
  return { log, sonni, scarica: async (url, accetta, max) => { log.push([url, accetta, max]); const q = risposte[url]; const r = typeof q === 'function' ? q(log.filter((x) => x[0] === url).length) : q; return r ?? { stato: null, testo: null }; },
    dormi: async (ms) => { sonni.push(ms); } };
};
await (async () => {
  const r1 = reteFinta({ [LINK]: { stato: 200, testo: pagina({ role: 'unpublished', prova: 'true' }) }, 'https://amimi.it/apps/chat/config': { stato: 200, testo: CONFIG_OK } });
  const e1 = await C.controllo('copia', LINK + '\n', r1);
  t('K1 copia: due chiamate (link e config), Accept giusti, tetti, nessuna pausa; esito ok', e1.severity === 'ok' && isDeepStrictEqual(r1.log.map((x) => x[0]).sort(), [LINK, C.URL_CONFIG].sort())
    && r1.log.find((x) => x[0] === LINK)[1] === 'text/html' && r1.log.find((x) => x[0] === C.URL_CONFIG)[1] === 'application/json' && r1.log.every((x) => x[2] > 0) && r1.sonni.length === 0, r1.log);
  const r2 = reteFinta({ 'https://amimi.it/': { stato: 200, testo: pagina({ prova: 'false' }) }, 'https://amimi.it/apps/chat/config': { stato: 200, testo: CONFIG_OK } });
  const e2 = await C.controllo('amimi.it', LINK, r2);
  t('K2 amimi.it: la home e config, MAI il link d\'anteprima', e2.severity === 'ok' && isDeepStrictEqual(r2.log.map((x) => x[0]).sort(), ['https://amimi.it/', 'https://amimi.it/apps/chat/config']));
  for (const [cosa, link] of [['vuoto', ''], ['altro dominio', 'https://evil.example.com'], ['con percorso', LINK + '/admin'], ['http', LINK.replace('https', 'http')], ['amimi.it', 'https://amimi.it/']]) {
    const r = reteFinta({ 'https://amimi.it/apps/chat/config': { stato: 200, testo: CONFIG_OK } });
    const e = await C.controllo('copia', link, r);
    t(`K3 link ${cosa}: nessuna chiamata alla pagina (solo config), copia non controllata`, isDeepStrictEqual(r.log.map((x) => x[0]), [C.URL_CONFIG]) && e.pagina === (link ? 'link_non_valido' : 'senza_link'), [r.log, e.pagina]);
  }
  const r4 = reteFinta({ [LINK]: (n) => (n === 1 ? { stato: 503, testo: 'x' } : { stato: 200, testo: pagina({ role: 'unpublished', prova: 'true' }) }), 'https://amimi.it/apps/chat/config': (n) => (n === 1 ? { stato: null, testo: null } : { stato: 200, testo: CONFIG_OK }) });
  const e4 = await C.controllo('copia', LINK, r4);
  t('K4 Regola 20d: senza risposta o 5xx si ritenta UNA volta dopo una pausa; poi vale il secondo', e4.severity === 'ok' && r4.log.length === 4 && r4.sonni.length === 2 && r4.sonni.every((ms) => ms === 2000), [r4.log.length, r4.sonni]);
  const r5 = reteFinta({ [LINK]: { stato: 410, testo: 'gone' }, 'https://amimi.it/apps/chat/config': { stato: 401, testo: '{}' } });
  const e5 = await C.controllo('copia', LINK, r5);
  t('K5 410 e 401 sono risposte: nessun ritentativo', r5.log.length === 2 && r5.sonni.length === 0 && e5.pagina === 'scaduta' && e5.config === 'firma_rifiutata' && e5.severity === 'error');
  const r6 = reteFinta({});
  const e6 = await C.controllo('amimi.it', '', r6);
  t('K6 tutto giu\' due volte: error con home e config, quattro chiamate', r6.log.length === 4 && isDeepStrictEqual(e6.mancano, ['home', 'config']));
})();

console.log('\n== gestisci: chi puo\' cosa, una volta al giorno, cosa si scrive ==');
const SVC = 'chiave_di_servizio_finta';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const T0 = Date.parse('2026-11-16T08:07:00Z');
function dbFinto(o = {}) {
  const st = { flags: { modo: 'copia', anteprima: LINK, ...(o.flags ?? {}) }, righe: new Map((o.righe ?? []).map((r) => [`${r.day}|${r.k}`, r])), scritte: [], letture: [], rotto: o.rotto ?? {} };
  const db = {
    async flags() { st.letture.push('flags'); if (st.rotto.flags) throw new C.ErroreDb('flag non letti'); return { ...st.flags }; },
    async pinOk(pin) { st.letture.push('pin'); if (st.rotto.pin) throw new C.ErroreDb('PIN non letto'); return sha(pin) === sha('x'); },
    async rigaDiOggi(g) { st.letture.push('oggi:' + g); if (st.rotto.oggi) throw new C.ErroreDb('riga di oggi non letta'); return st.righe.has(`${g}|${C.K_SALUTE}`); },
    async scrivi(r) { if (st.rotto.scrivi) throw new C.ErroreDb('health_log non scritto'); st.scritte.push(r); st.righe.set(`${r.day}|${r.k}`, r); },
  };
  return { st, db };
}
const reteOk = () => reteFinta({ [LINK]: { stato: 200, testo: pagina({ role: 'unpublished', prova: 'true' }) }, 'https://amimi.it/': { stato: 200, testo: pagina({ marcatore: false, inbox: true }) },
  'https://amimi.it/apps/chat/config': { stato: 200, testo: CONFIG_OK } });
const chiama = async (corpo, o = {}) => {
  const { st, db } = o.dbf ?? dbFinto(o);
  const rete = o.rete ?? reteOk();
  const h = { 'Content-Type': 'application/json', ...(o.bearer ? { Authorization: 'Bearer ' + o.bearer } : {}) };
  const req = new Request('https://x.supabase.co/functions/v1/chat-controllo', { method: o.metodo ?? 'POST', headers: h, ...(o.metodo === 'GET' ? {} : { body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }) });
  const l0 = console.log, e0 = console.error, righeLog = [];
  console.log = (...a) => righeLog.push(a.join(' ')); console.error = (...a) => righeLog.push(a.join(' '));
  let res;
  try { res = await C.gestisci(req, { ora: o.ora ?? T0, servizio: SVC, db, rete }); } finally { console.log = l0; console.error = e0; }
  const testo = await res.text();
  return { s: res.status, b: JSON.parse(testo), testo, st, rete, righeLog };
};
// una alla volta: chiama() sostituisce console.log per raccogliere i log, in parallelo si incrocerebbero
const inFila = async (fs) => { const out = []; for (const f of fs) out.push(await f()); return out; };
await (async () => {
  const cron = await chiama({ action: 'controlla', pin: 'x' });
  t('G1 cron col PIN: controllo fatto e UNA riga health_log di oggi (giorno UTC, k chat_controllo, label, n, severity)', cron.s === 200 && cron.b.scritto === true && cron.st.scritte.length === 1
    && isDeepStrictEqual(cron.st.scritte[0], { day: '2026-11-16', k: 'chat_controllo', label: cron.b.esito.label, n: 0, severity: 'ok' }) && cron.rete.log.length === 2, cron.b);
  const dbf = dbFinto({ righe: [{ day: '2026-11-16', k: 'chat_controllo', label: 'x', n: 0, severity: 'ok' }] });
  const rif = await chiama({ action: 'controlla', pin: 'x' }, { dbf });
  t('G2 una volta al giorno: con la riga di oggi il PIN non fa nessuna chiamata fuori ne\' scrittura', rif.s === 200 && rif.b.saltato === 'fatto_oggi' && rif.rete.log.length === 0 && rif.st.scritte.length === 0);
  const forza = await chiama({ action: 'controlla', forza: true }, { dbf: dbFinto({ righe: [{ day: '2026-11-16', k: 'chat_controllo', label: 'x', n: 0, severity: 'ok' }] }), bearer: SVC });
  t('G3 forza con la chiave di servizio: rifa il controllo e riscrive la riga di oggi', forza.s === 200 && forza.b.scritto === true && forza.st.scritte.length === 1 && forza.rete.log.length === 2
    && !forza.st.letture.some((l) => l.startsWith('oggi:')));
  const ant = await chiama({ action: 'anteprima' }, { bearer: SVC });
  t('G4 anteprima con la chiave di servizio: controllo senza scrivere niente', ant.s === 200 && ant.b.scritto === false && ant.st.scritte.length === 0 && ant.rete.log.length === 2 && ant.b.esito.severity === 'ok');
  const no = await inFila([() => chiama({ action: 'controlla' }), () => chiama({ action: 'controlla', pin: 'y' }), () => chiama({ action: 'controlla', pin: 'x', forza: true }),
    () => chiama({ action: 'anteprima', pin: 'x' }), () => chiama({ action: 'anteprima' }, { bearer: SVC + 'x' }), () => chiama({ action: 'controlla', forza: true }, { bearer: 'x' })]);
  t('G5 senza credenziali giuste: 401 e nessuna lettura dei flag, nessuna chiamata fuori (forza e anteprima solo con la chiave di servizio, il PIN non basta)',
    no.every((r) => r.s === 401 && r.b.error === 'non_autorizzato' && r.rete.log.length === 0 && r.st.scritte.length === 0 && !r.st.letture.includes('flags')), no.map((r) => [r.s, r.st.letture]));
  const altre = [await chiama({ action: 'boh', pin: 'x' }), await chiama('non json', {}), await chiama('[1]', {}), await chiama(null, { metodo: 'GET' }), await chiama('{"action":"controlla","pin":"' + 'x'.repeat(3000) + '"}')];
  t('G6 azione sconosciuta 400, JSON storto o troppo grande 400, GET 405, mai una chiamata fuori', isDeepStrictEqual(altre.map((r) => r.s), [400, 400, 400, 405, 400]) && altre.every((r) => r.rete.log.length === 0));
  const spenti = await inFila(['spento', '', 'Amimi', 'amimi'].map((m) => () => chiama({ action: 'controlla', pin: 'x' }, { flags: { modo: m } })));
  t('G7 controllo spento (spento, assente, valori storti): nessuna chiamata, nessuna riga', spenti.every((r) => r.s === 200 && r.b.saltato === 'spento' && r.rete.log.length === 0 && r.st.scritte.length === 0)
    && C.modoDi(' AMIMI.IT ') === 'amimi.it' && C.modoDi('copia') === 'copia' && C.modoDi(true) === null);
  const live = await chiama({ action: 'controlla', pin: 'x' }, { flags: { modo: 'amimi.it' } });
  t('G8 dal go-live (un solo valore cambiato): amimi.it controllata, e com\'e\' oggi (senza embed, con Inbox) e\' un error', live.st.scritte[0]?.severity === 'error' && live.st.scritte[0]?.n === 2
    && live.rete.log.some((x) => x[0] === 'https://amimi.it/') && !live.rete.log.some((x) => x[0] === LINK));
  const guasti = await inFila(['flags', 'pin', 'oggi', 'scrivi'].map((k) => () => chiama({ action: 'controlla', pin: 'x' }, { rotto: { [k]: true } })));
  t('G9 Regola 20a: lettura o scrittura fallita = 503 con la causa del codice, mai un controllo a meta\' scritto come buono',
    isDeepStrictEqual(guasti.map((r) => [r.s, r.b.causa]), [[503, 'flag non letti'], [503, 'PIN non letto'], [503, 'riga di oggi non letta'], [503, 'health_log non scritto']])
    && guasti.slice(0, 3).every((r) => r.rete.log.length === 0 && r.st.scritte.length === 0));
  const tutte = [cron, rif, forza, ant, live, ...no, ...altre, ...spenti, ...guasti];
  t('G10 risposte e log: mai il link d\'anteprima ne\' un pezzo della pagina', tutte.every((r) => !r.testo.includes('shopifypreview') && !r.testo.includes('k3x9q2w7') && !r.testo.includes('<')
    && r.righeLog.every((l) => !l.includes('shopifypreview') && !l.includes('<'))) && cron.righeLog.length === 1);
  t('G11 la riga e\' del giorno UTC della chiamata', (await chiama({ action: 'controlla', pin: 'x' }, { ora: Date.parse('2026-11-16T23:59:59Z') })).st.scritte[0].day === '2026-11-16');
})();

console.log('\n== guardie sul sorgente, su config.toml e sulla migr 0196 ==');
const codiceDi = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const unFetch = (s) => {
  const c = codiceDi(s);
  return (c.match(/\bfetch\(/g) ?? []).length === 1 && c.includes("const r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA, Accept: accetta }, signal: AbortSignal.timeout(TIMEOUT_MS) });")
    && !/credentials|cookie/i.test(c) && c.includes("const url = modo === 'amimi.it' ? URL_AMIMI : link;")
    && c.includes("const motivo = modo === 'copia' ? (!link ? 'senza_link' : !ANTEPRIMA_RE.test(link) ? 'link_non_valido' : null) : null;");
};
const soloDueFlag = (s) => { const c = codiceDi(s); return (c.match(/from\('app_flags'\)/g) ?? []).length === 1 && c.includes(".from('app_flags').select('key, value').in('key', [FLAG_MODO, FLAG_ANTEPRIMA]).limit(3)"); };
const soloSalute = (s) => {
  const c = codiceDi(s);
  const scritture = c.match(/\.(insert|update|upsert|delete|rpc)\(/g) ?? [];
  return scritture.length === 1 && c.includes(".from('health_log').upsert({ ...r, created_at: new Date().toISOString() }, { onConflict: 'day,k' })") && !/change_log|write-api/.test(c);
};
const logPulito = (s) => {
  const c = codiceDi(s);
  const righe = c.split('\n').filter((l) => /console\.(log|error)/.test(l));
  return righe.length > 0 && righe.every((l) => !/\b(anteprima|url|link|testo|html|f\.)\b/.test(l.replace(/'[^']*'/g, '')));
};
const unaVolta = (s) => codiceDi(s).includes("if (scrive && !forza && await amb.db.rigaDiOggi(giorno)) return json({ ok: true, versione: VERSIONE, saltato: 'fatto_oggi' });")
  && codiceDi(s).includes("if (d.action === 'anteprima' || (d.action === 'controlla' && forza)) {\n      if (!servizio) return json({ ok: false, error: 'non_autorizzato' }, 401);");
t('S1 una sola fetch, senza cookie ne\' credenziali, verso amimi.it o il link d\'anteprima solo se ha la forma giusta', unFetch(SRC));
t('S2 di app_flags solo le due chiavi del controllo, con elenco esplicito', soloDueFlag(SRC));
t('S3 scrive SOLO la sua riga health_log (upsert su day,k); niente change_log, niente write-api', soloSalute(SRC));
t('S4 log e risposte senza link, URL o testo delle pagine', logPulito(SRC));
t('S5 una volta al giorno col PIN; forza e anteprima solo con la chiave di servizio', unaVolta(SRC));
t('S6 config.toml: chat-controllo con verify_jwt = false (il cron non manda JWT)', /\n\[functions\.chat-controllo\]\nverify_jwt = false\n/.test(CONFIG));
t('S7 il link d\'anteprima ha solo la forma https://<token>-<negozio>.shopifypreview.com', C.ANTEPRIMA_RE.test(LINK) && C.ANTEPRIMA_RE.test(LINK + '/') && !C.ANTEPRIMA_RE.test(LINK + '/x')
  && !C.ANTEPRIMA_RE.test(LINK + '?a=1') && !C.ANTEPRIMA_RE.test('https://x-1.shopifypreview.com.evil.com') && !C.ANTEPRIMA_RE.test('https://a-123456.shopifypreview.com@evil.com/'));
const m = M0196;
const migrOk = (s) => /\nbegin;\n/.test(s) && s.trimEnd().endsWith('commit;')
  && s.includes("insert into app_flags (key, value) values\n    ('chat_controllo_home', 'copia'),\n    ('chat_controllo_anteprima', '')\n  on conflict (key) do nothing;")
  && s.includes("select cron.schedule('chat-controllo', '7 8 * * *',") && s.includes("body := '{\"action\":\"controlla\",\"pin\":\"x\"}'::jsonb,")
  && s.includes("url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/chat-controllo',")
  && s.includes("if has_table_privilege('anon', 'public.app_flags', 'select') or has_table_privilege('authenticated', 'public.app_flags', 'select') then")
  && !/shopifypreview\.com/.test(s.replace(/--.*$/gm, '')) && !/\bgrant\b/i.test(s.replace(/--.*$/gm, '')) && !/insert\s+into\s+change_log/i.test(s);
t('S8 0196: chiavi nate copia e vuoto senza sovrascrivere, cron 08:07 UTC col PIN neutro, prova che app_flags non e\' leggibile da anon, nessun link, nessun grant', migrOk(m));

// nessun link d'anteprima vero nel repo pubblico (i finti dei test hanno token corti o sono qui sopra)
const VERO_RE = /\b(?![a-z0-9]*k3x9q2w7)[a-z0-9]{12,40}-[0-9]{6,15}\.shopifypreview\.com/;
const cerca = (dir, out = []) => {
  for (const n of readdirSync(ROOT + dir)) {
    if (['node_modules', '.git', 'dist', '.claude'].includes(n)) continue;
    const p = dir ? `${dir}/${n}` : n;
    const s = statSync(ROOT + p);
    if (s.isDirectory()) cerca(p, out);
    else if (s.size < 2_000_000 && /\.(md|ts|tsx|mjs|js|sql|toml|json|liquid|yml|txt|html)$/.test(n) && VERO_RE.test(readFileSync(ROOT + p, 'utf8'))) out.push(p);
  }
  return out;
};
const conLink = cerca('');
t('S9 nessun link d\'anteprima vero nei file del repo (sta solo in app_flags e nel repo hub)', conLink.length === 0, conLink);

console.log('\n== autocontrollo: ogni guardia scatta su un sorgente rotto ==');
const pianta = (s, da, a) => { const x = s.replace(da, () => a); if (x === s) { console.log('  KO  autocontrollo: frammento non trovato: ' + da.slice(0, 80)); ko++; } return x; };
t('X1 una seconda fetch, i cookie o un URL dal flag senza controllo -> visti', [
  pianta(SRC, 'async function controllo(', "async function altro() { await fetch('https://x'); }\nasync function controllo("),
  pianta(SRC, "headers: { 'User-Agent': UA, Accept: accetta }", "headers: { 'User-Agent': UA, Accept: accetta }, credentials: 'include'"),
  pianta(SRC, "!ANTEPRIMA_RE.test(link) ? 'link_non_valido' : null", "null"),
].every((s) => !unFetch(s)));
t('X2 un filtro largo su app_flags -> visto', !soloDueFlag(pianta(SRC, ".in('key', [FLAG_MODO, FLAG_ANTEPRIMA])", ".like('key', 'chat_%')")));
t('X3 un insert altrove o change_log -> visti', [pianta(SRC, 'async pinOk(pin) {', "async pinOk(pin) { await sb.from('change_log').insert({});"),
  pianta(SRC, ".upsert({ ...r, created_at: new Date().toISOString() }, { onConflict: 'day,k' })", ".insert({ ...r })")].every((s) => !soloSalute(s)));
t('X4 il link nel log -> visto', !logPulito(pianta(SRC, "console.log(JSON.stringify({ fn: 'chat-controllo', azione: d.action,", "console.log(JSON.stringify({ fn: 'chat-controllo', link: f.anteprima, azione: d.action,")));
t('X5 il PIN che basta per forza, o niente guardia giornaliera -> visti', [pianta(SRC, "if (d.action === 'anteprima' || (d.action === 'controlla' && forza)) {", "if (d.action === 'anteprima') {"),
  pianta(SRC, 'if (scrive && !forza && await amb.db.rigaDiOggi(giorno))', 'if (false)')].every((s) => !unaVolta(s)));
t('X6 migrazione che sovrascrive, col link, o senza la prova su anon -> viste', [pianta(m, 'on conflict (key) do nothing;', 'on conflict (key) do update set value = excluded.value;'),
  pianta(m, "('chat_controllo_anteprima', '')", "('chat_controllo_anteprima', 'https://k3x9q2w7z1m5b8v4-95215747399.shopifypreview.com')"),
  pianta(m, "if has_table_privilege('anon', 'public.app_flags', 'select') or has_table_privilege('authenticated', 'public.app_flags', 'select') then", 'if false then')].every((s) => !migrOk(s)));
t('X7 un link vero in un file -> visto dalla ricerca', VERO_RE.test('vedi https://' + 'q7'.repeat(8) + '-95215747399.shopifypreview.com qui') && !VERO_RE.test('https://<token>-<shop_id>.shopifypreview.com')
  && !VERO_RE.test('abc123-95215747399.shopifypreview.com'));
const Crotto = carica(pianta(SRC, "if (modo === 'copia' && (r.stato === 404 || r.stato === 410)) pagina = 'scaduta';", "if (false) pagina = 'scaduta';"));
t('X8 senza il caso "scaduto" il 410 diventa warn (la suite lo vede in V6)', Crotto.valuta('copia', pag(410, 'x'), 'ok').severity === 'warn');

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
