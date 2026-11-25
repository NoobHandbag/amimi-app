// tests/chat_widget_browser.mjs: il widget della chat del sito (loader + pannello di shopify/amimi-chat) in un Chromium
// vero, con una pagina finta su https://amimi.test e chat-api e Turnstile finti (page.route): nessuna rete vera, nessun DB.
// Prova a mano di Gate 1 del pezzo 5 (non e' nella Action: vuole Playwright e il suo Chromium).
//   PLAYWRIGHT_BROWSERS_PATH=<cartella dei browser> node tests/chat_widget_browser.mjs [cartella per le schermate]
// Playwright si prende da web/node_modules (npm ci in web/). Controlla (w-2, Fase 2 ridotta): niente rete prima del tocco (test 16), apertura sul
// saluto dell'assistente senza modulo, Turnstile e avvia senza email al primo invio, risposta del bot, scheda email al passaggio, bottone con risposta fissa, link solo amimi.it, HTML come testo (test 13), passaggio, risposta del
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

// chat-api finta, coi contratti di chat-api api-6 (docs/EDGE_FUNCTIONS.md): bot acceso, sessione senza email fino al passaggio
function nuovoServer() {
  const S = { attiva: true, ai: true, stato: null, email: null, serveEmail: false, msgs: [], seq: 0, token: 'T'.repeat(43), chiamate: [], viste: [] };
  const msg = (autore, testo, extra = {}) => { const m = { seq: ++S.seq, autore, testo, at: new Date().toISOString(), via_email: false, ...extra }; S.msgs.push(m); return m; };
  const attesa = () => { S.stato = 'attesa_persona'; S.serveEmail = false; return msg('sistema', 'Abbiamo ricevuto la tua richiesta: ti risponderemo il prima possibile, di solito entro 2 giorni lavorativi, e riceverai la risposta via email all\'indirizzo ' + S.email + '.'); };
  const chiediEmail = () => { S.serveEmail = true; return msg('automatica', 'Passo la tua domanda al team Amimì, che ti risponde via email, di solito entro 2 giorni lavorativi. Scrivimi la tua email (e il tuo nome, se vuoi).'); };
  const stato = () => ({ stato: S.stato, email: S.email, serve_email: S.serveEmail && S.stato === 'bot' });
  S.risposta = (azione, b) => {
    S.chiamate.push({ azione, b });
    if (azione === 'config') return S.attiva ? { ok: true, versione: 'api-6', attiva: true, ai: S.ai, testi: {
      saluto: { it: S.ai ? 'Ciao, sono l\'assistente automatico di Amimì: come posso aiutarti?' : 'Ciao, questa è la chat di Amimì.', en: 'Hi' },
      orari: { it: 'Il team risponde nei giorni lavorativi, di solito entro 2 giorni lavorativi.', en: 'x' },
      informativa: { it: 'In questa chat ti risponde un assistente AI che usa solo le informazioni di Amimì.', en: 'x' },
      etichetta: S.ai ? { it: 'Stai scrivendo a un assistente AI: può sbagliare.', en: 'x' } : null },
      bottoni: [{ id: 'resi', it: 'Resi', en: 'Returns' }], informativa_versione: 'i-abc123', limiti: { testo: 1000, nome: 80 } } : { ok: true, versione: 'api-6', attiva: false };
    if (azione === 'avvia') {
      if (!S.attiva) return { ok: false, state: 'spenta' };
      if (b.turnstile !== 'TS-ok' || b.informativa !== 'i-abc123' || 'email' in b) return { ok: false, state: 'verifica_fallita' };
      S.stato = 'bot';
      return { ok: true, token: S.token, ...stato(), messaggi: [] };
    }
    if (b.token !== S.token) return { ok: false, state: 'token_non_valido' };
    if (azione === 'invia') {
      if (!S.attiva) return { ok: false, state: 'spenta' };
      if (S.failNext) { const f = S.failNext; S.failNext = null; return f === 'troppo_veloce' ? { http: 429, ok: false, state: f, retry_after_s: 2 } : { ok: false, state: f }; }
      if (S.stato === 'chiusa') return { http: 409, ok: false, state: 'chiusa' };
      if (b.bottone === 'resi') return { ok: true, ...stato(), messaggi: [msg('cliente', 'Resi'), msg('automatica', 'Per i resi vedi https://amimi.it/pages/resi. Non https://evil.com/x ne\' https://amimi.it@evil.com <b>grassetto</b>')] };
      const out = [msg('cliente', b.testo)];
      if (S.stato === 'bot') {
        const em = /[^\s@]+@[^\s@]+\.[a-z]+/i.exec(b.testo);
        if (em && S.serveEmail) { S.email = em[0][0] + '***' + em[0].slice(em[0].indexOf('@')); out.push(attesa()); }
        else if (/persona|ordine/i.test(b.testo)) { out.push(msg('ai', 'Su questo ti aiuta il team: passo la tua domanda.')); out.push(chiediEmail()); }
        else out.push(msg('ai', 'La Lea Bag Maxi Cocco Black costa 180,00 EUR ed è disponibile: https://amimi.it/products/lea-bag-maxi-cocco-black <script>window.__xss=1</script>'));
      }
      return { ok: true, ...stato(), messaggi: out };
    }
    if (azione === 'passaggio') {
      if (S.stato !== 'bot') return { ok: true, ...stato(), messaggi: [] };
      if (b.email) { S.email = b.email[0] + '***' + b.email.slice(b.email.indexOf('@')); S.nome = b.nome ?? null; return { ok: true, messaggi: [attesa()], ...stato() }; }
      return { ok: true, messaggi: S.serveEmail ? [] : [chiediEmail()], ...stato() };
    }
    if (azione === 'aggiorna') {
      S.viste.push(b.vista);
      const nuovi = S.msgs.filter((m) => m.seq > b.dopo);
      return { ok: true, ...stato(), messaggi: nuovi.slice(0, 50), altri: nuovi.length > 50 };
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
      if (azione === 'invia' && S.lento) await pausa(S.lento);
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
  console.log('== apertura sul bot, senza modulo (w-2) ==');
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
  await chat(p).locator('textarea').waitFor();
  t('B3 al tocco: config chiesta e pannello aperto sul saluto dell\'assistente, col campo per scrivere e i bottoni; NESSUN modulo ne\' campo email',
    S.chiamate[0]?.azione === 'config' && await chat(p).getByText('Ciao, sono l\'assistente automatico di Amimì: come posso aiutarti?').isVisible()
    && (await chat(p).locator('form.modulo').count()) === 0 && (await chat(p).locator('input[type=email]').count()) === 0 && await chat(p).getByRole('button', { name: 'Resi' }).isVisible());
  t('B3b AI Act (11.3): testata "Assistente AI di Amimì", saluto firmato "Assistente AI", etichetta fissa vicino al campo',
    await chat(p).getByRole('heading', { name: 'Assistente AI di Amimì' }).isVisible() && await chat(p).locator('.msg .chi', { hasText: 'Assistente AI' }).first().isVisible()
    && await chat(p).getByText('Stai scrivendo a un assistente AI', { exact: false }).isVisible());
  t('B3c all\'apertura nessuna sessione: niente avvia, niente Turnstile (solo al primo gesto)', !S.chiamate.some((c) => c.azione === 'avvia') && !reti.some((u) => u.includes('challenges.cloudflare')));
  await chat(p).getByRole('button', { name: 'Informativa' }).click();
  t('B3d il link "Informativa" mostra l\'informativa breve nel pannello, col link alla privacy', await chat(p).getByText('In questa chat ti risponde un assistente AI', { exact: false }).first().isVisible()
    && await chat(p).getByText('Informativa sulla privacy').first().isVisible());
  await schermata(p, '02_apertura');

  console.log('\n== primo messaggio e risposta del bot ==');
  S.lento = 1200;
  await chat(p).locator('textarea').fill('quanto costa la lea maxi nera?');
  await chat(p).locator('textarea').press('Enter');
  await chat(p).getByText('L\'assistente sta scrivendo...').waitFor();
  t('B4 durante il turno del bot: "L\'assistente sta scrivendo..."', true);
  await chat(p).getByText('La Lea Bag Maxi Cocco Black costa', { exact: false }).waitFor();
  S.lento = 0;
  const av = S.chiamate.find((c) => c.azione === 'avvia')?.b ?? {};
  t('B5 al primo invio: Turnstile (chat_avvia, sitekey di produzione) poi avvia SENZA email, poi invia col testo', av.turnstile === 'TS-ok' && !('email' in av) && av.informativa === 'i-abc123'
    && av.prova === false && av.lingua === 'it' && (await p.evaluate(() => window.__tsOpts)).sitekey === '0x4AAAAAAF2QTzI4g31RhjIS'
    && S.chiamate.findIndex((c) => c.azione === 'avvia') < S.chiamate.findIndex((c) => c.azione === 'invia'), av);
  const linkBot = await chat(p).locator('.msg.ai a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  t('B6 risposta del bot firmata "Assistente AI", link amimi.it cliccabile, HTML come testo', await chat(p).locator('.msg.ai .chi', { hasText: 'Assistente AI' }).isVisible()
    && JSON.stringify(linkBot) === '["https://amimi.it/products/lea-bag-maxi-cocco-black"]' && (await p.evaluate(() => window.__xss)) === undefined
    && await chat(p).getByText('<script>', { exact: false }).isVisible() && !(await chat(p).getByText('L\'assistente sta scrivendo...').isVisible()), linkBot);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('amimi_chat_v1')));
  t('B7 chat token salvato nel formato del loader, senza email (non c\'e\')', st?.v === 1 && st.t === 'T'.repeat(43) && st.p === false && st.e === '' && st.s === 0, st);
  await chat(p).getByRole('button', { name: 'Resi' }).click();
  await chat(p).getByText('Per i resi vedi', { exact: false }).waitFor();
  const linkResi = await chat(p).locator('.msg.automatica a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  t('B8 bottone: risposta fissa firmata "Assistente AI" (bot acceso); link solo verso amimi.it, gli altri testo; HTML come testo (test 13)',
    JSON.stringify(linkResi) === '["https://amimi.it/pages/resi"]' && await chat(p).getByText('<b>grassetto</b>', { exact: false }).isVisible() && (await chat(p).locator('.msg b').count()) === 0, linkResi);
  t('B8b un solo avvia per tutta la chat', S.chiamate.filter((c) => c.azione === 'avvia').length === 1);
  await schermata(p, '03_risposta_bot');

  console.log('\n== passaggio al team: l\'email si chiede nella conversazione ==');
  await chat(p).locator('textarea').fill('voglio parlare con una persona del mio ordine');
  await chat(p).locator('textarea').press('Enter');
  await chat(p).locator('.msg.scheda input[type=email]').waitFor();
  t('B9 il bot passa al team: la sua frase, la richiesta dell\'email e la scheda con email, nome facoltativo e informativa breve',
    await chat(p).getByText('Scrivimi la tua email', { exact: false }).isVisible() && await chat(p).locator('.msg.scheda input[type=text]').isVisible()
    && await chat(p).locator('.msg.scheda').getByText('In questa chat ti risponde un assistente AI', { exact: false }).isVisible());
  await schermata(p, '04_scheda_email');
  await chat(p).locator('.msg.scheda input[type=email]').fill('non-valida');
  await chat(p).getByRole('button', { name: 'Invia al team' }).click();
  t('B10 email non valida: errore nella scheda, nessun passaggio', await chat(p).getByText('Scrivi un indirizzo email valido.').isVisible() && !S.chiamate.some((c) => c.azione === 'passaggio'));
  await chat(p).locator('.msg.scheda input[type=email]').fill('Cliente@Esempio.it');
  await chat(p).locator('.msg.scheda input[type=text]').fill('Giulia');
  await chat(p).getByRole('button', { name: 'Invia al team' }).click();
  await chat(p).getByText('di solito entro 2 giorni lavorativi, e riceverai', { exact: false }).waitFor();
  const pp = S.chiamate.find((c) => c.azione === 'passaggio')?.b ?? {};
  t('B11 passaggio con email minuscola e nome; scheda tolta; conferma da ticket; "Il team è stato avvisato"; a chi vanno le risposte',
    pp.email === 'cliente@esempio.it' && pp.nome === 'Giulia' && (await chat(p).locator('.msg.scheda').count()) === 0
    && await chat(p).getByRole('button', { name: 'Il team è stato avvisato' }).isDisabled()
    && await chat(p).getByText('Le risposte del team arrivano via email a c***@esempio.it', { exact: false }).isVisible(), pp);
  await schermata(p, '05_passaggio');
  S.msg('staff', '<img src=x onerror="window.__xss=1"> Ciao Giulia! Ecco il link https://amimi.it/pages/faq', { via_email: true });
  await chat(p).getByText('Ciao Giulia!', { exact: false }).waitFor({ timeout: 8000 });
  t('B12 risposta del team vista entro un ciclo di poll, "Team Amimì" e "inviato anche via email", senza eseguire HTML', await chat(p).locator('.msg.staff .chi').first().isVisible()
    && await chat(p).getByText('inviato anche via email', { exact: false }).isVisible() && (await p.evaluate(() => window.__xss)) === undefined && S.viste.at(-1) === true);
  t('B13 nessun errore JavaScript nella pagina', errori.length === 0, errori);
  S.failNext = 'riprova';
  await chat(p).locator('textarea').fill('Messaggio che non parte subito');
  await chat(p).locator('textarea').press('Enter');
  await chat(p).getByRole('button', { name: 'Riprova' }).waitFor();
  await chat(p).getByRole('button', { name: 'Riprova' }).click();
  await chat(p).locator('.msg.fallito').waitFor({ state: 'detached' });
  const inv = S.chiamate.filter((c) => c.azione === 'invia' && c.b.testo === 'Messaggio che non parte subito');
  t('B14 invio non partito: bolla "Non inviato" con Riprova, che rimanda lo STESSO client_id', inv.length === 2 && inv[0].b.client_id === inv[1].b.client_id);
  await chat(p).getByRole('button', { name: 'Chiudi la chat' }).click();
  const n1 = S.chiamate.filter((c) => c.azione === 'aggiorna').length;
  await pausa(12000);
  t('B15 pannello chiuso: il polling si ferma (D-8)', S.chiamate.filter((c) => c.azione === 'aggiorna').length === n1);

  console.log('\n== ritorno sulla pagina ==');
  S.msg('staff', 'Un altro dettaglio dal team.');
  const m0 = S.chiamate.length;
  await p.reload();
  await pausa(800);
  const dopoRicarica = S.chiamate.slice(m0);
  t('B16 ricarica con una chat in corso: un solo aggiorna (vista false), pallino', dopoRicarica.length === 1 && dopoRicarica[0].azione === 'aggiorna' && dopoRicarica[0].b.vista === false
    && Number(await chat(p).locator('.pallino').textContent()) >= 1, dopoRicarica);
  await chat(p).locator('button.bolla').click();
  await chat(p).getByText('Un altro dettaglio dal team.').waitFor();
  const testi = await chat(p).locator('.msg[data-seq]').allTextContents();
  t('B17 riapertura: storia da capo, ogni messaggio una volta sola', testi.length === S.msgs.length && new Set(testi).size === testi.length, { n: testi.length, attesi: S.msgs.length });
  S.stato = 'chiusa';
  await chat(p).locator('textarea').fill('Scrivo su una chat chiusa');
  await chat(p).locator('textarea').press('Enter');
  await chat(p).getByText('Questa chat è stata chiusa', { exact: false }).waitFor({ timeout: 8000 });
  t('B18 chat chiusa dal team: scrittura bloccata, testo lasciato a vista, "Nuova chat"', await chat(p).locator('textarea').isDisabled() && (await chat(p).locator('textarea').inputValue()) === 'Scrivo su una chat chiusa'
    && await chat(p).getByRole('button', { name: 'Nuova chat' }).isVisible());
  await chat(p).getByRole('button', { name: 'Nuova chat' }).click();
  t('B19 "Nuova chat": token tolto, di nuovo il saluto col campo per scrivere (niente modulo)', (await p.evaluate(() => localStorage.getItem('amimi_chat_v1'))) === null
    && await chat(p).locator('textarea').isEnabled() && (await chat(p).locator('form.modulo').count()) === 0);
  await ctx.close();

  console.log('\n== bot spento, "Parla con una persona" senza email, chat spenta e telefono ==');
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const S3 = nuovoServer();
  S3.ai = false;
  await prepara(ctx3, S3);
  const p3 = await ctx3.newPage();
  await p3.goto(ORIGINE + '/');
  await chat(p3).locator('button.bolla').click();
  await chat(p3).locator('textarea').waitFor();
  t('B20 bot spento: testata e firme della Fase 1, saluto e orari, sempre senza modulo', await chat(p3).getByRole('heading', { name: 'Chat Amimì: risposte automatiche e team' }).isVisible()
    && await chat(p3).getByText('Il team risponde nei giorni lavorativi', { exact: false }).isVisible() && (await chat(p3).locator('form.modulo').count()) === 0);
  await chat(p3).getByRole('button', { name: 'Parla con una persona' }).click();
  await chat(p3).locator('.msg.scheda input[type=email]').waitFor();
  t('B21 "Parla con una persona" su una chat nuova: avvia, poi la chat chiede l\'email con la scheda', S3.chiamate.some((c) => c.azione === 'avvia') && S3.chiamate.some((c) => c.azione === 'passaggio'));
  await ctx3.close();
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const S2 = nuovoServer();
  S2.attiva = false;
  await prepara(ctx2, S2, true);
  const p2 = await ctx2.newPage();
  await p2.goto(ORIGINE + '/');
  await chat(p2).locator('button.bolla').click();
  await chat(p2).getByText('La chat non è disponibile in questo momento', { exact: false }).waitFor();
  t('B22 chat spenta: il pannello rimanda a info@amimi.it, niente campo per scrivere', await chat(p2).locator('a[href="mailto:info@amimi.it"]').isVisible() && (await chat(p2).locator('textarea').count()) === 0);
  t('B23 modalita\' prova: scritta PROVA', (await chat(p2).getByText('PROVA').count()) >= 1);
  await schermata(p2, '06_spenta_telefono');
  S2.attiva = true;
  await chat(p2).getByRole('button', { name: 'Chiudi la chat' }).click();
  await p2.reload();
  await chat(p2).locator('button.bolla').click();
  await chat(p2).locator('textarea').waitFor();
  const box = await chat(p2).locator('.pannello').boundingBox();
  t('B24 telefono: il pannello occupa lo schermo intero', box && box.width === 390 && box.height === 780, box);
  await chat(p2).locator('textarea').fill('ciao');
  await chat(p2).getByRole('button', { name: 'Invia' }).click();
  await chat(p2).locator('.msg.ai').waitFor();
  t('B25 widget di prova: sitekey di prova e prova true', (await p2.evaluate(() => window.__tsOpts)).sitekey === '0x4AAAAAAF33Q02jrHXJLHjr' && S2.chiamate.find((c) => c.azione === 'avvia')?.b.prova === true);
  await schermata(p2, '07_chat_telefono');
  await ctx2.close();
} finally {
  await browser.close();
}
console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
