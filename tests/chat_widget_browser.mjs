// tests/chat_widget_browser.mjs: il widget della chat del sito (loader + pannello di shopify/amimi-chat) in un Chromium
// vero, con una pagina finta su https://amimi.test e chat-api e Turnstile finti (page.route): nessuna rete vera, nessun DB.
// Prova a mano di Gate 1 del pezzo 5 (non e' nella Action: vuole Playwright e il suo Chromium).
//   PLAYWRIGHT_BROWSERS_PATH=<cartella dei browser> node tests/chat_widget_browser.mjs [cartella per le schermate]
// Playwright si prende da web/node_modules (npm ci in web/). Controlla: niente rete prima del tocco (test 16), modulo,
// avvia con Turnstile, bottone con risposta fissa, link solo amimi.it, HTML come testo (test 13), passaggio, risposta del
// team vista entro un ciclo di poll (test 7 con D-8), polling fermo a pannello chiuso, pallino al ricaricamento, storia
// ripresa da capo, chat spenta (test 2), chat chiusa, vista da telefono.
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(process.env.AMIMI_WEB_PKG || join(ROOT, 'web', 'package.json'));
const { chromium } = require('playwright');
const ASSETS = join(ROOT, 'shopify', 'amimi-chat', 'extensions', 'chat-widget', 'assets');
const LOADER = readFileSync(join(ASSETS, 'chat-loader.js'), 'utf8');
const PANNELLO = readFileSync(join(ASSETS, 'chat-panel.js'), 'utf8');
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 300) : '')); } };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const ORIGINE = 'https://amimi.test';
const PAGINA = (prova) => `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Amimi</title>
<style>body{font-family:Georgia,serif;margin:0;padding:40px;background:#faf7f2} button{all:unset;color:red} div{color:purple}</style></head>
<body class="template-index"><h1>Negozio finto</h1><p>Contenuto della pagina.</p>
<div id="amimi-chat-embed" data-pannello="${ORIGINE}/cdn/shop/extensions/abc-123/1.0.0/assets/chat-panel.js" data-posizione="bottom_right" data-colore="#1f1f1f" data-prova="${prova}" hidden></div>
<script src="${ORIGINE}/cdn/shop/extensions/abc-123/1.0.0/assets/chat-loader.js" async></script></body></html>`;

// chat-api finta, coi contratti di chat-api api-2 (docs/EDGE_FUNCTIONS.md)
function nuovoServer() {
  const S = { attiva: true, stato: null, msgs: [], seq: 0, token: 'T'.repeat(43), chiamate: [], viste: [] };
  const msg = (autore, testo, extra = {}) => { const m = { seq: ++S.seq, autore, testo, at: new Date().toISOString(), via_email: false, ...extra }; S.msgs.push(m); return m; };
  const attesa = () => { S.stato = 'attesa_persona'; return msg('sistema', 'Abbiamo ricevuto la tua richiesta: ti risponderemo il prima possibile, di solito entro 2 giorni lavorativi, e riceverai la risposta via email all\'indirizzo c***@esempio.it.'); };
  S.risposta = (azione, b) => {
    S.chiamate.push({ azione, b });
    if (azione === 'config') return S.attiva ? { ok: true, versione: 'api-2', attiva: true, testi: {
      saluto: { it: 'Ciao, questa e\' la chat di Amimi. Le risposte rapide sono testi preparati dal team.', en: 'Hi' },
      orari: { it: 'Il team risponde nei giorni lavorativi, di solito entro 2 giorni lavorativi.', en: 'x' },
      informativa: { it: 'Usiamo la tua email e i messaggi di questa chat per risponderti, anche per email.', en: 'x' } },
      bottoni: [{ id: 'resi', it: 'Resi', en: 'Returns' }], informativa_versione: 'i-abc123', limiti: { testo: 1000, nome: 80 } } : { ok: true, versione: 'api-2', attiva: false };
    if (azione === 'avvia') {
      if (!S.attiva) return { ok: false, state: 'spenta' };
      if (b.turnstile !== 'TS-ok' || b.informativa !== 'i-abc123') return { ok: false, state: 'verifica_fallita' };
      S.stato = 'bot';
      const out = [];
      if (b.testo) { out.push(msg('cliente', b.testo)); out.push(attesa()); }
      return { ok: true, token: S.token, stato: S.stato, email: 'c***@esempio.it', messaggi: out };
    }
    if (b.token !== S.token) return { ok: false, state: 'token_non_valido' };
    if (azione === 'invia') {
      if (!S.attiva) return { ok: false, state: 'spenta' };
      if (S.stato === 'chiusa') return { http: 409, ok: false, state: 'chiusa' };
      if (b.bottone === 'resi') return { ok: true, stato: S.stato, messaggi: [msg('cliente', 'Resi'), msg('automatica', 'Per i resi vedi https://amimi.it/pages/resi. Non https://evil.com/x ne\' https://amimi.it@evil.com <b>grassetto</b>')] };
      const out = [msg('cliente', b.testo)];
      if (S.stato === 'bot') out.push(attesa());
      return { ok: true, stato: S.stato, messaggi: out };
    }
    if (azione === 'passaggio') { const out = S.stato === 'bot' ? [attesa()] : []; return { ok: true, stato: S.stato, email: 'c***@esempio.it', messaggi: out }; }
    if (azione === 'aggiorna') {
      S.viste.push(b.vista);
      const nuovi = S.msgs.filter((m) => m.seq > b.dopo);
      return { ok: true, stato: S.stato, messaggi: nuovi.slice(0, 50), altri: nuovi.length > 50 };
    }
    if (azione === 'errore') return { ok: true, contato: true };
    return { ok: false, error: 'not_found', http: 404 };
  };
  S.msg = msg;
  return S;
}
const TURNSTILE_FINTO = `window.turnstile={render:function(el,o){window.__tsOpts={sitekey:o.sitekey,action:o.action,execution:o.execution};window.__tsCb=o.callback;return 'w1'},
execute:function(){setTimeout(function(){window.__tsCb('TS-ok')},80)},reset:function(){}};`;

async function prepara(contesto, S, prova = false) {
  const reti = [];
  await contesto.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    reti.push(u.origin + u.pathname);
    if (u.origin === ORIGINE && u.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: PAGINA(prova) });
    if (u.pathname.endsWith('/assets/chat-loader.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: LOADER });
    if (u.pathname.endsWith('/assets/chat-panel.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: PANNELLO });
    if (u.origin === 'https://challenges.cloudflare.com') return route.fulfill({ status: 200, contentType: 'application/javascript', body: TURNSTILE_FINTO });
    if (u.origin === ORIGINE && u.pathname.startsWith('/apps/chat/')) {
      const azione = u.pathname.slice('/apps/chat/'.length);
      const corpo = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null;
      const d = S.risposta(azione, corpo);
      const http = d.http ?? 200;
      delete d.http;
      return route.fulfill({ status: http, contentType: 'application/json; charset=utf-8', body: JSON.stringify(d) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return reti;
}
const chat = (p) => p.locator('#amimi-chat-radice');
async function schermata(p, nome) { if (OUT) await p.screenshot({ path: join(OUT, nome + '.png') }); }

const browser = await chromium.launch();
try {
  console.log('== caricamento e modulo ==');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const S = nuovoServer();
  const reti = await prepara(ctx, S);
  const p = await ctx.newPage();
  const errori = [];
  p.on('pageerror', (e) => errori.push(String(e)));
  await p.goto(ORIGINE + '/');
  await p.waitForTimeout(500);
  const primaDelTocco = reti.filter((u) => /\/apps\/chat\/|challenges\.cloudflare|chat-panel/.test(u));
  const storage0 = await p.evaluate(() => localStorage.length);
  t('B1 al caricamento: nessuna chiamata a chat-api, Turnstile o pannello, niente in localStorage (test 16)', primaDelTocco.length === 0 && storage0 === 0, primaDelTocco);
  const bolla = chat(p).locator('button.bolla');
  t('B2 bolla visibile, non toccata dal CSS del tema (shadow DOM)', await bolla.isVisible() && (await bolla.evaluate((b) => getComputedStyle(b).backgroundColor)) === 'rgb(31, 31, 31)');
  await schermata(p, '01_bolla');
  await bolla.click();
  await chat(p).locator('form.modulo').waitFor();
  t('B3 al tocco: pannello caricato, config chiesta, modulo con saluto, orari e informativa', S.chiamate[0]?.azione === 'config' && await chat(p).getByText('Ciao, questa e\' la chat di Amimi').isVisible()
    && await chat(p).getByText('Informativa sulla privacy').isVisible());
  await schermata(p, '02_modulo');
  await chat(p).locator('input[type=email]').fill('non-valida');
  await chat(p).getByRole('button', { name: 'Inizia la chat' }).click();
  t('B4 email non valida: errore nel modulo, nessun avvia', await chat(p).getByText('Scrivi un indirizzo email valido.').isVisible() && !S.chiamate.some((c) => c.azione === 'avvia'));
  await chat(p).locator('input[type=email]').fill('Cliente@Esempio.it');
  await chat(p).locator('input[type=text]').fill('Giulia');
  await chat(p).getByRole('button', { name: 'Inizia la chat' }).click();
  await chat(p).locator('.lista').waitFor({ state: 'attached' });
  const av = S.chiamate.find((c) => c.azione === 'avvia')?.b ?? {};
  t('B5 avvia con Turnstile (azione chat_avvia, sitekey di produzione), email minuscola, nome, informativa, prova false', av.turnstile === 'TS-ok' && av.email === 'cliente@esempio.it' && av.nome === 'Giulia'
    && av.informativa === 'i-abc123' && av.prova === false && av.lingua === 'it' && (await p.evaluate(() => window.__tsOpts)).sitekey === '0x4AAAAAAF2QTzI4g31RhjIS', av);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('amimi_chat_v1')));
  t('B6 chat token salvato nel formato del loader', st?.v === 1 && st.t === 'T'.repeat(43) && st.p === false && typeof st.a === 'number' && st.o === false);

  console.log('\n== chat ==');
  await chat(p).getByRole('button', { name: 'Resi' }).click();
  await chat(p).getByText('Risposta automatica').waitFor();
  const linkBuoni = await chat(p).locator('.msg a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  t('B7 bottone: risposta fissa; link solo verso amimi.it, gli altri restano testo; HTML come testo (test 13)', JSON.stringify(linkBuoni) === '["https://amimi.it/pages/resi"]'
    && await chat(p).getByText('<b>grassetto</b>', { exact: false }).isVisible() && (await chat(p).locator('.msg b').count()) === 0, linkBuoni);
  await chat(p).locator('textarea').fill('Vorrei sapere se la Lea nera torna disponibile');
  await chat(p).locator('textarea').press('Enter');
  await chat(p).getByText('di solito entro 2 giorni lavorativi').waitFor();
  t('B8 testo libero: messaggio e conferma da ticket con l\'email mascherata; "Parla con una persona" diventa "Il team e\' stato avvisato"', await chat(p).getByRole('button', { name: 'Il team \u00e8 stato avvisato' }).isDisabled());
  await schermata(p, '03_chat_attesa');
  const n0 = S.chiamate.length;
  S.msg('staff', '<img src=x onerror="window.__xss=1"> Ciao Giulia! Ecco il link https://amimi.it/pages/faq', { via_email: true });
  await chat(p).getByText('Ciao Giulia!', { exact: false }).waitFor({ timeout: 8000 });
  t('B9 risposta del team vista entro un ciclo di poll (5 s), con "Team Amimi" e "inviato anche via email", senza eseguire HTML', await chat(p).locator('.msg.staff .chi').first().isVisible()
    && await chat(p).getByText('inviato anche via email', { exact: false }).isVisible() && (await p.evaluate(() => window.__xss)) === undefined && S.viste.at(-1) === true);
  t('B10 nessun errore JavaScript nella pagina', errori.length === 0, errori);
  await schermata(p, '04_risposta_team');
  await chat(p).getByRole('button', { name: 'Chiudi la chat' }).click();
  const n1 = S.chiamate.filter((c) => c.azione === 'aggiorna').length;
  await pausa(12000);
  t('B11 pannello chiuso: il polling si ferma (D-8)', S.chiamate.filter((c) => c.azione === 'aggiorna').length === n1 && S.chiamate.length > n0);

  console.log('\n== ritorno sulla pagina ==');
  S.msg('staff', 'Un altro dettaglio dal team.');
  const m0 = S.chiamate.length;
  await p.reload();
  await pausa(800);
  const dopoRicarica = S.chiamate.slice(m0);
  t('B12 ricarica con una chat in corso: un solo aggiorna (vista false), pallino 1', dopoRicarica.length === 1 && dopoRicarica[0].azione === 'aggiorna' && dopoRicarica[0].b.vista === false
    && (await chat(p).locator('.pallino').textContent()) === '1', dopoRicarica);
  await schermata(p, '05_pallino');
  await chat(p).locator('button.bolla').click();
  await chat(p).getByText('Un altro dettaglio dal team.').waitFor();
  const testi = await chat(p).locator('.msg').allTextContents();
  t('B13 riapertura: storia da capo, ogni messaggio una volta sola, pallino tolto', testi.length === S.msgs.length && new Set(testi).size === testi.length && await chat(p).locator('.pallino').isHidden(), { n: testi.length, attesi: S.msgs.length });
  S.stato = 'chiusa';
  await chat(p).getByText('Questa chat \u00e8 stata chiusa', { exact: false }).waitFor({ timeout: 8000 });
  t('B14 chat chiusa dal team: scrittura bloccata, "Nuova chat"', await chat(p).locator('textarea').isDisabled() && await chat(p).getByRole('button', { name: 'Nuova chat' }).isVisible());
  await chat(p).getByRole('button', { name: 'Nuova chat' }).click();
  t('B15 "Nuova chat": token tolto, di nuovo il modulo', (await p.evaluate(() => localStorage.getItem('amimi_chat_v1'))) === null && await chat(p).locator('form.modulo').isVisible());
  await ctx.close();

  console.log('\n== chat spenta (test 2) e telefono ==');
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const S2 = nuovoServer();
  S2.attiva = false;
  await prepara(ctx2, S2, true);
  const p2 = await ctx2.newPage();
  await p2.goto(ORIGINE + '/');
  await chat(p2).locator('button.bolla').click();
  await chat(p2).getByText('La chat non \u00e8 disponibile in questo momento', { exact: false }).waitFor();
  t('B16 chat spenta: il pannello rimanda a info@amimi.it, nessun modulo', await chat(p2).locator('a[href="mailto:info@amimi.it"]').isVisible() && (await chat(p2).locator('form.modulo').count()) === 0);
  t('B17 modalita\' prova: scritta PROVA sulla bolla e nel pannello', (await chat(p2).getByText('PROVA').count()) >= 1);
  await schermata(p2, '06_spenta_telefono');
  S2.attiva = true;
  await chat(p2).getByRole('button', { name: 'Chiudi la chat' }).click();
  await p2.reload();
  await chat(p2).locator('button.bolla').click();
  await chat(p2).locator('form.modulo').waitFor();
  const box = await chat(p2).locator('.pannello').boundingBox();
  t('B18 telefono: il pannello occupa lo schermo intero', box && box.width === 390 && box.height === 780, box);
  await chat(p2).locator('input[type=email]').fill('prova@esempio.it');
  await chat(p2).getByRole('button', { name: 'Inizia la chat' }).click();
  await chat(p2).locator('.lista').waitFor({ state: 'attached' });
  t('B19 widget di prova: sitekey di prova e prova true', (await p2.evaluate(() => window.__tsOpts)).sitekey === '0x4AAAAAAF33Q02jrHXJLHjr' && S2.chiamate.find((c) => c.azione === 'avvia')?.b.prova === true);
  await schermata(p2, '07_chat_telefono');
  await ctx2.close();
} finally {
  await browser.close();
}
console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
