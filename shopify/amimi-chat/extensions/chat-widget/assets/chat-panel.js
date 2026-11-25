// Amimi Chat, pannello (w-2, Fase 2 ridotta del 25-11-2026: il chatbot vero chiesto da Dan; prima w-1, Fase 1 pezzo 5;
// docs/PROPOSTA_chat_sito.md 3.2, 4.3, 5.3-5.8, 6.2, 9, 11.3, 11.7, 11.10). Caricato da chat-loader.js solo al tocco sulla
// bolla: da qui partono `config` e, al primo invio, Turnstile (render esplicito, sfida solo su execute) e il chat token,
// che nasce con `avvia`. Niente modulo d'apertura: il pannello si apre sul saluto dell'assistente col campo per scrivere e
// i bottoni rapidi. Il bot (chat-api api-6) risponde da se'; quando serve una persona la chat chiede l'email e qui compare
// il campo email (e nome facoltativo) dentro la conversazione, con l'informativa breve. Modello ticket per il team (D-8):
// ogni risposta del team arriva per email e compare anche qui; il polling gira SOLO a pannello aperto e scheda visibile,
// con la cadenza ridotta di `intervallo`. Tutto cio' che arriva dalla rete e' un dato: solo textContent, mai innerHTML; un
// link e' cliccabile solo se e' https su amimi.it o www.amimi.it (5.7). Stato sul dispositivo: la chiave di chat-loader.js
// (stesso formato della pagina riprendi). Guardie e prove in tests/chat_widget_guardie.mjs.
(function () {
  'use strict';
  var A = window.__amimiChat;
  if (!A || A.versione !== 'w-2' || A.pannello || !A.radice) return;

  // ==== PURE:chat-panel BEGIN ====
  var VERSIONE = 'w-2';
  var INATTIVITA_MS = 4 * 3600 * 1000;
  var TS_VALIDO_MS = 280000;
  var TS_ATTESA_MS = 60000;
  var PAGINE_STORIA = 6;
  var ATTESA_RETE_MS = 20000;
  var ATTESA_BOT_MS = 35000;           // un turno del bot dura al massimo 22 s lato server; il proxy chiude a 30 s
  var ERRORI_DI_FILA = 6;
  var TURNSTILE_JS = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var SITEKEY = { produzione: '0x4AAAAAAF2QTzI4g31RhjIS', prova: '0x4AAAAAAF33Q02jrHXJLHjr' };
  var HOST_LINK = ['amimi.it', 'www.amimi.it'];
  var EMAIL_RE = /^[^\s<>,;"@]+@[^\s<>,;"@]+\.[^\s<>,;"@]+$/;
  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  var TESTI = {
    it: {
      titolo: 'Chat Amim\u00ec: risposte automatiche e team', titoloAi: 'Assistente AI di Amim\u00ec', chiudi: 'Chiudi la chat', prova: 'PROVA', carica: 'Un momento...',
      nome: 'Nome (facoltativo)', email: 'La tua email', inviaTeam: 'Invia al team', emailTitolo: 'Per passarti al team',
      verifica: 'Un attimo...', emailKo: 'Scrivi un indirizzo email valido.', nomeKo: 'Il nome \u00e8 troppo lungo.',
      testoKo: 'Il messaggio \u00e8 troppo lungo.', informativa: 'Informativa', privacy: 'Informativa sulla privacy',
      etichetta: 'Risposte automatiche e team Amim\u00ec.', scrivi: 'Scrivi un messaggio', scriviAi: 'Scrivi la tua domanda', invia: 'Invia', persona: 'Parla con una persona',
      personaFatto: 'Il team \u00e8 stato avvisato', tu: 'Tu', automatica: 'Risposta automatica', ai: 'Assistente AI', staff: 'Team Amim\u00ec', anchePerEmail: 'inviato anche via email',
      sta: 'L\'assistente sta scrivendo...', inInvio: 'Invio...', nonInviato: 'Non inviato.', riprova: 'Riprova', spenta: 'La chat non \u00e8 disponibile in questo momento. Scrivici a ',
      spentaChat: 'La chat non \u00e8 disponibile in questo momento: i messaggi nuovi non partono. Scrivici a ', nonDisponibile: 'La chat non risponde in questo momento. Riprova tra poco o scrivici a ',
      limite: 'Oggi la chat ha raggiunto il numero massimo di conversazioni. Scrivici a ', verificaKo: 'Non siamo riusciti a completare la verifica anti-spam. Riprova o scrivici a ',
      limiteMessaggi: 'Hai raggiunto il numero massimo di messaggi per questa chat: ti rispondiamo via email.', troppoVeloce: 'Un attimo: riprova tra qualche secondo.',
      chiusa: 'Questa chat \u00e8 stata chiusa. Se ti serve ancora aiuto, apri una nuova chat.', scaduta: 'La chat non \u00e8 pi\u00f9 attiva su questo dispositivo. Le risposte del team ti arrivano via email, con il link per continuare la chat.',
      nuova: 'Nuova chat', fermo: 'Quando il team risponde ti arriva un\'email; la risposta compare anche qui.', controlla: 'Controlla adesso',
      errore: 'La chat non si \u00e8 caricata. ', riprovaCarica: 'Riprova', inviaA: 'Le risposte del team arrivano via email a ', bottoneKo: 'Questa risposta non \u00e8 disponibile ora.'
    },
    en: {
      titolo: 'Amim\u00ec chat: automatic answers and team', titoloAi: 'Amim\u00ec AI assistant', chiudi: 'Close the chat', prova: 'TEST', carica: 'One moment...',
      nome: 'Name (optional)', email: 'Your email', inviaTeam: 'Send to the team', emailTitolo: 'To pass you to our team',
      verifica: 'One moment...', emailKo: 'Please enter a valid email address.', nomeKo: 'The name is too long.',
      testoKo: 'The message is too long.', informativa: 'Privacy', privacy: 'Privacy notice',
      etichetta: 'Automatic answers and Amim\u00ec team.', scrivi: 'Write a message', scriviAi: 'Write your question', invia: 'Send', persona: 'Talk to a person',
      personaFatto: 'Our team has been notified', tu: 'You', automatica: 'Automatic answer', ai: 'AI assistant', staff: 'Amim\u00ec team', anchePerEmail: 'also sent by email',
      sta: 'The assistant is typing...', inInvio: 'Sending...', nonInviato: 'Not sent.', riprova: 'Retry', spenta: 'The chat is not available right now. Write to us at ',
      spentaChat: 'The chat is not available right now: new messages cannot be sent. Write to us at ', nonDisponibile: 'The chat is not responding right now. Please try again shortly or write to us at ',
      limite: 'The chat has reached its maximum number of conversations for today. Write to us at ', verificaKo: 'We could not complete the anti-spam check. Please try again or write to us at ',
      limiteMessaggi: 'You have reached the maximum number of messages for this chat: we will reply by email.', troppoVeloce: 'One moment: please try again in a few seconds.',
      chiusa: 'This chat has been closed. If you still need help, start a new chat.', scaduta: 'The chat is no longer active on this device. Our replies reach you by email, with a link to continue the chat.',
      nuova: 'New chat', fermo: 'When our team replies you will get an email; the reply also appears here.', controlla: 'Check now',
      errore: 'The chat did not load. ', riprovaCarica: 'Retry', inviaA: 'Our replies are sent by email to ', bottoneKo: 'This answer is not available right now.'
    }
  };
  // un link e' cliccabile solo se e' https su amimi.it o www.amimi.it, senza credenziali ne' porta nell'URL (5.7): l'URL
  // ricomposto deve cominciare esattamente con https://<host>/
  function linkSicuro(s) {
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== 'https:' || HOST_LINK.indexOf(u.hostname) < 0 || u.href.indexOf('https://' + u.hostname + '/') !== 0) return null;
    return u.href;
  }
  // il testo in pezzi: [{t: testo}] o [{t: testo, href: link sicuro}]; la punteggiatura in coda resta fuori dal link
  function pezziTesto(s) {
    var out = [];
    var re = /https:\/\/[^\s<>"']+/g;
    var da = 0;
    var m;
    s = String(s);
    while ((m = re.exec(s)) !== null) {
      var u = m[0].replace(/[.,;:!?)\]]+$/, '');
      var href = linkSicuro(u);
      if (!href) continue;
      if (m.index > da) out.push({ t: s.slice(da, m.index) });
      out.push({ t: u, href: href });
      da = m.index + u.length;
      re.lastIndex = da;
    }
    if (da < s.length) out.push({ t: s.slice(da) });
    return out;
  }
  // cadenza del polling (6.2 rivista al ribasso dopo D-8): ms di quiete dall'ultimo messaggio -> attesa, null = fermo
  function intervallo(quieteMs) {
    if (quieteMs < 120000) return 5000;
    if (quieteMs < 600000) return 20000;
    if (quieteMs < 1800000) return 60000;
    return null;
  }
  function emailOk(s) { return typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s); }
  function contaCp(s) { return Array.from(s).length; }
  function nuovoUuid(c) {
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = '';
    for (var i = 0; i < 16; i++) h += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  // la risposta di chat-api, letta come dato: un oggetto o null (il proxy trasforma un 5xx in una pagina HTML)
  function leggiRisposta(testo) {
    var d;
    try { d = JSON.parse(testo); } catch (e) { return null; }
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  }
  // un messaggio della risposta, controllato campo per campo; null = scartato
  function messaggioValido(m) {
    if (!m || typeof m !== 'object' || typeof m.seq !== 'number' || !isFinite(m.seq) || m.seq < 0 || typeof m.testo !== 'string') return null;
    var autori = ['cliente', 'automatica', 'ai', 'staff', 'sistema'];
    if (autori.indexOf(m.autore) < 0) return null;
    return { seq: m.seq, autore: m.autore, testo: m.testo, at: typeof m.at === 'string' ? m.at : '', via_email: m.via_email === true };
  }
  // chi firma la bolla (11.3 riga 4): l'assistente AI e' sempre "Assistente AI"; le risposte fisse, col bot acceso,
  // vengono dallo stesso assistente; il team e' "Team Amimi"; gli avvisi della chat non hanno firma
  function firma(autore, ai, T) {
    if (autore === 'cliente') return T.tu;
    if (autore === 'ai') return T.ai;
    if (autore === 'automatica') return ai ? T.ai : T.automatica;
    if (autore === 'staff') return T.staff;
    return '';
  }
  // ==== PURE:chat-panel END ====

  var prova = A.impostazioni.prova === true;
  var lingua = /^en\b/i.test(document.documentElement.lang || '') ? 'en' : 'it';
  var T = TESTI[lingua];
  var S = {
    aperto: false, iniziato: false, config: null, token: null, stato: null, email: null, cursore: 0, visti: {},
    attivita: 0, movimento: 0, timer: null, fermo: false, inVolo: false, serveEmail: false, avvio: null,
    tsId: null, tsToken: null, tsAt: 0, tsInCorso: false, tsAttese: [], tsCarica: [], errori: 0
  };

  function el(tag, cls, testo) {
    var x = document.createElement(tag);
    if (cls) x.className = cls;
    if (testo) x.textContent = testo;
    return x;
  }
  function svuota(x) { while (x.firstChild) x.removeChild(x.firstChild); }
  function mail(dove, prima) {
    dove.appendChild(document.createTextNode(prima));
    var a = el('a', '', 'info@amimi.it');
    a.href = 'mailto:info@amimi.it';
    dove.appendChild(a);
    dove.appendChild(document.createTextNode('.'));
    return dove;
  }
  // ogni esito diventa {http, d}: rete giu', corpo interrotto o chiamata ferma oltre l'attesa = {http: 0, d: null},
  // mai una promessa rifiutata (che lascerebbe il pannello fermo a meta', Gate 2 B2)
  function chiama(azione, corpo, attesaMs) {
    var opz = { method: corpo ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store' };
    if (corpo) { opz.headers = { 'Content-Type': 'application/json' }; opz.body = JSON.stringify(corpo); }
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var tm = null;
    if (ctrl) { opz.signal = ctrl.signal; tm = setTimeout(function () { ctrl.abort(); }, attesaMs || ATTESA_RETE_MS); }
    var fine = function () { if (tm) clearTimeout(tm); };
    return fetch(A.base + '/' + azione, opz)
      .then(function (r) { return r.text().then(function (t) { return { http: r.status, d: leggiRisposta(t) }; }); })
      .then(function (x) { fine(); return x; }, function () { fine(); return { http: 0, d: null }; });
  }

  // ---- struttura del pannello ----
  var CSS = '[hidden]{display:none!important}' +
    '.pannello{position:fixed;bottom:92px;right:20px;z-index:2147483001;width:380px;max-width:calc(100vw - 32px);height:620px;max-height:calc(100vh - 116px);' +
    'display:flex;flex-direction:column;background:#fff;color:#1f1f1f;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.24);overflow:hidden;' +
    'font:400 15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:left}' +
    '.sx .pannello{right:auto;left:20px}.pannello:focus{outline:none}' +
    '.testata{display:flex;align-items:center;gap:8px;padding:14px 10px 14px 18px;background:var(--amc-colore,#1f1f1f);color:#fff}' +
    '.testata h2{flex:1;margin:0;font:600 15px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff}' +
    '.tag{padding:2px 6px;border-radius:4px;background:#ffd54f;color:#1f1f1f;font-size:11px;font-weight:800;letter-spacing:.04em}' +
    '.x{width:36px;height:36px;border:0;border-radius:50%;background:transparent;color:#fff;font:400 24px/1 system-ui,sans-serif;cursor:pointer}' +
    '.x:hover{background:rgba(255,255,255,.15)}' +
    'button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #1f1f1f;outline-offset:2px}' +
    '.testata .x:focus-visible{outline-color:#fff}' +
    '.corpo{flex:1;display:flex;flex-direction:column;min-height:0}' +
    '.scorre{flex:1;overflow-y:auto;padding:16px 16px 8px;overscroll-behavior:contain}' +
    '.intro p{margin:0 0 10px}.piccolo{font-size:13px;color:#555}.piccolo a,.intro a,.avviso a{color:inherit}' +
    'form.modulo{display:flex;flex-direction:column;gap:8px;margin:0}' +
    'label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600;color:#333}' +
    'input,textarea{font:400 16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f1f1f;background:#fff;border:1px solid #bbb;' +
    'border-radius:10px;padding:9px 11px;box-sizing:border-box;width:100%;margin:0}' +
    'textarea{resize:none}' +
    '.prim{border:0;border-radius:22px;padding:11px 18px;background:var(--amc-colore,#1f1f1f);color:#fff;font:600 15px/1.2 system-ui,-apple-system,sans-serif;cursor:pointer}' +
    '.prim:disabled,.chip:disabled{opacity:.55;cursor:default}' +
    '.errore{color:#b3261e;font-size:13px;margin:0}' +
    '.avviso{margin:8px 16px;padding:10px 12px;border-radius:10px;background:#fff4e5;color:#5f3b00;font-size:14px}' +
    '.info{margin:0 16px 8px;padding:10px 12px;border-radius:10px;background:#f6f6f6;color:#333;font-size:13px}.info a{color:inherit}' +
    '.lista{display:flex;flex-direction:column;gap:10px}' +
    '.msg{max-width:85%;padding:9px 12px;border-radius:14px;background:#f2f2f2;align-self:flex-start;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '.msg.cliente{align-self:flex-end;background:var(--amc-colore,#1f1f1f);color:#fff}' +
    '.msg.cliente a{color:#fff}.msg.staff{background:#eef3ec}' +
    '.msg.sistema{align-self:center;max-width:92%;background:#fff8e1;font-size:14px;text-align:center}' +
    '.msg.sta{font-style:italic;color:#555}' +
    '.scheda{align-self:stretch;max-width:none;background:#fff;border:1px solid #ddd;white-space:normal}' +
    '.chi{display:block;font-size:12px;font-weight:700;margin-bottom:2px}' +
    '.meta{display:block;font-size:11px;opacity:.7;margin-top:4px}' +
    '.msg.in-invio{opacity:.6}.msg.fallito{opacity:1;outline:2px solid #b3261e}' +
    '.link{background:none;border:0;padding:0;color:inherit;text-decoration:underline;font:inherit;cursor:pointer}' +
    '.rapidi{display:flex;flex-wrap:wrap;gap:6px;padding:8px 16px 0}' +
    '.chip{border:1px solid #1f1f1f;border-radius:16px;padding:6px 12px;background:#fff;color:#1f1f1f;font:500 14px/1.2 system-ui,-apple-system,sans-serif;cursor:pointer}' +
    '.chip.persona{background:#1f1f1f;color:#fff}' +
    '.scrivi{display:flex;gap:8px;align-items:flex-end;padding:10px 16px 6px}' +
    '.scrivi textarea{flex:1;max-height:120px}' +
    '.nota{padding:0 16px 10px;font-size:12px;color:#555}.nota a,.nota .link{color:inherit}' +
    '.fondo{text-align:center;font-size:13px;color:#555;padding:4px 0}' +
    '.ts{display:flex;justify-content:center}' +
    '@media (max-width:480px){.pannello{top:0;left:0;right:0;bottom:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0}.sx .pannello{left:0}}';

  var stile = el('style');
  stile.textContent = CSS;
  A.radice.appendChild(stile);
  var pannello = el('section', 'pannello');
  pannello.setAttribute('role', 'dialog');
  pannello.setAttribute('aria-labelledby', 'amc-titolo');
  pannello.tabIndex = -1;
  pannello.hidden = true;
  var testata = el('div', 'testata');
  var h2 = el('h2', '', T.titolo);
  h2.id = 'amc-titolo';
  testata.appendChild(h2);
  if (prova) testata.appendChild(el('span', 'tag', T.prova));
  var bx = el('button', 'x', '\u00d7');
  bx.type = 'button';
  bx.setAttribute('aria-label', T.chiudi);
  bx.addEventListener('click', function () { chiudi(); });
  testata.appendChild(bx);
  pannello.appendChild(testata);
  var corpo = el('div', 'corpo');
  pannello.appendChild(corpo);
  // Turnstile al primo gesto nella chat (tasto, tocco o testo), non all'apertura; preparaTs non fa nulla con un token
  corpo.addEventListener('keydown', function () { if (V.nome === 'chat') preparaTs(); });
  corpo.addEventListener('pointerdown', function () { if (V.nome === 'chat') preparaTs(); });
  corpo.addEventListener('input', function () { if (V.nome === 'chat') preparaTs(); });
  A.cornice.appendChild(pannello);
  pannello.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); chiudi(); } });
  // Turnstile disegna in un div del DOM della pagina (il suo iframe), mostrato dentro il pannello con uno slot
  var tsBox = el('div');
  tsBox.setAttribute('slot', 'amc-ts');
  A.host.appendChild(tsBox);

  // ---- stato sul dispositivo ----
  // s = il cursore di aggiorna, mai il seq di avvia, invia o passaggio (contratto C4 di chat-api, Gate 2 B1); una chat piu'
  // nuova salvata da un'altra scheda o dalla pagina riprendi non si sovrascrive (C4), salvo una chat appena aperta qui
  function salvaStato(nuova) {
    if (!S.token) return;
    var ora = A.leggi();
    if (!nuova && ora && ora.t !== S.token) return;
    A.salva({ v: 1, t: S.token, p: prova, a: S.attivita, s: S.cursore, o: false, e: S.email || '' });
  }
  function dimentica() {
    A.togli();
    S.token = null; S.stato = null; S.email = null; S.cursore = 0; S.visti = {}; S.fermo = false; S.errori = 0; S.serveEmail = false;
    ferma();
  }

  // ---- Turnstile: script solo quando serve, sfida solo su execute ----
  function caricaTurnstile(cb) {
    if (window.turnstile) { cb(true); return; }
    S.tsCarica.push(cb);
    if (S.tsCarica.length > 1) return;
    var s = document.createElement('script');
    s.src = TURNSTILE_JS;
    s.async = true;
    var fine = function (ok) { var l = S.tsCarica; S.tsCarica = []; for (var i = 0; i < l.length; i++) l[i](ok); };
    s.onload = function () { fine(!!window.turnstile); };
    s.onerror = function () { A.beacon('turnstile_non_caricato'); fine(false); };
    document.head.appendChild(s);
  }
  function rispondiTs(tok) {
    var l = S.tsAttese;
    S.tsAttese = [];
    S.tsInCorso = false;
    if (tok && l.length) { l[0](tok); for (var i = 1; i < l.length; i++) l[i](null); return; }
    if (tok) { S.tsToken = tok; S.tsAt = Date.now(); return; }
    for (var j = 0; j < l.length; j++) l[j](null);
  }
  function eseguiTs() {
    caricaTurnstile(function (ok) {
      if (!ok) { rispondiTs(null); return; }
      try {
        if (S.tsId === null) {
          S.tsId = window.turnstile.render(tsBox, {
            sitekey: prova ? SITEKEY.prova : SITEKEY.produzione, action: 'chat_avvia', execution: 'execute', appearance: 'interaction-only',
            language: lingua, callback: function (t) { rispondiTs(typeof t === 'string' ? t : null); },
            'error-callback': function () { A.beacon('turnstile_errore'); rispondiTs(null); },
            'expired-callback': function () { S.tsToken = null; }, 'timeout-callback': function () { rispondiTs(null); }
          });
        } else window.turnstile.reset(S.tsId);
        window.turnstile.execute(S.tsId);
      } catch (e) { rispondiTs(null); }
    });
  }
  // la sfida parte al primo gesto nella chat ancora senza token (tasto, tocco, testo), non all'apertura
  function preparaTs() {
    if (S.token || S.tsInCorso || (S.tsToken && Date.now() - S.tsAt < TS_VALIDO_MS)) return;
    S.tsInCorso = true;
    eseguiTs();
  }
  // un token nuovo e non ancora usato (monouso, 300 s); null = verifica non riuscita
  function tokenTs(cb) {
    if (S.tsToken && Date.now() - S.tsAt < TS_VALIDO_MS) { var t = S.tsToken; S.tsToken = null; cb(t); return; }
    S.tsToken = null;
    var fatto = false;
    var una = function (x) {
      if (fatto) return;
      fatto = true;
      var k = S.tsAttese.indexOf(una);
      if (k >= 0) S.tsAttese.splice(k, 1);
      cb(x);
    };
    S.tsAttese.push(una);
    // sfida mai conclusa: si rinuncia, e il prossimo invio ne fa partire una nuova
    setTimeout(function () { if (!fatto) { S.tsInCorso = false; una(null); } }, TS_ATTESA_MS);
    if (!S.tsInCorso) { S.tsInCorso = true; eseguiTs(); }
  }

  // ---- viste ----
  var V = {};
  function vista(nome) {
    svuota(corpo);
    V = { nome: nome };
    return corpo;
  }
  function vistaTesto(prima, conMail, bottone, azione) {
    var c = vista('testo');
    var sc = el('div', 'scorre');
    var p = el('p');
    if (conMail) mail(p, prima); else p.textContent = prima;
    sc.appendChild(p);
    if (bottone) {
      var b = el('button', 'prim', bottone);
      b.type = 'button';
      b.addEventListener('click', azione);
      sc.appendChild(b);
    }
    c.appendChild(sc);
  }
  // la radice della lingua della pagina ('/' o '/en/'), da Shopify.routes.root se ha una forma attesa: un prefisso
  // scritto a mano non esiste su ogni dominio (sull'anteprima /en/ da' 404, 09-11)
  function radiceLingua() {
    var r = window.Shopify && window.Shopify.routes && window.Shopify.routes.root;
    return typeof r === 'string' && /^\/([a-z]{2}(-[a-z]{2})?\/)?$/i.test(r) ? r : '/';
  }
  function linkPrivacy() {
    var a = el('a', '', T.privacy);
    a.href = radiceLingua() + 'policies/privacy-policy';
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }
  function campo(etichetta, tag, tipo, max) {
    var l = el('label', '', etichetta);
    var i = el(tag);
    if (tipo) i.type = tipo;
    if (max) i.maxLength = max;
    l.appendChild(i);
    return { l: l, i: i };
  }
  // l'informativa breve (11.7): a vista dal link vicino al campo, e sempre dentro la scheda dell'email
  function testoInformativa(dove) {
    var cfg = S.config;
    if (!cfg || !cfg.testi || !cfg.testi.informativa) return;
    dove.appendChild(document.createTextNode(cfg.testi.informativa[lingua] + ' '));
    dove.appendChild(linkPrivacy());
  }

  function vistaChat() {
    var c = vista('chat');
    var cfg = S.config;
    var ai = !!(cfg && cfg.ai);
    h2.textContent = ai ? T.titoloAi : T.titolo;
    var sc = el('div', 'scorre');
    var lista = el('div', 'lista');
    lista.setAttribute('role', 'log');
    lista.setAttribute('aria-live', 'polite');
    // il saluto dell'assistente apre la chat (11.3 riga 2): una bolla fissa, non un messaggio salvato
    if (cfg && cfg.attiva && cfg.testi.saluto) {
      var saluto = el('div', 'msg automatica');
      saluto.appendChild(el('span', 'chi', firma('automatica', ai, T)));
      saluto.appendChild(el('span', '', cfg.testi.saluto[lingua]));
      lista.appendChild(saluto);
      if (!ai && cfg.testi.orari) lista.appendChild(el('p', 'piccolo', cfg.testi.orari[lingua]));
    }
    sc.appendChild(lista);
    var fondo = el('div', 'fondo');
    fondo.hidden = true;
    sc.appendChild(fondo);
    c.appendChild(sc);
    var av = el('div', 'avviso');
    av.hidden = true;
    av.setAttribute('role', 'status');
    c.appendChild(av);
    var info = el('div', 'info');
    info.hidden = true;
    testoInformativa(info);
    c.appendChild(info);
    var rapidi = el('div', 'rapidi');
    var bott = cfg && cfg.attiva ? cfg.bottoni : [];
    for (var i = 0; i < bott.length; i++) {
      (function (b) {
        var x = el('button', 'chip', b[lingua]);
        x.type = 'button';
        x.addEventListener('click', function () { inviaBottone(b, x); });
        rapidi.appendChild(x);
      })(bott[i]);
    }
    var pers = el('button', 'chip persona', T.persona);
    pers.type = 'button';
    pers.addEventListener('click', function () { chiediPersona(pers); });
    rapidi.appendChild(pers);
    c.appendChild(rapidi);
    var slot = el('slot', 'ts');
    slot.setAttribute('name', 'amc-ts');
    c.appendChild(slot);
    var form = el('form', 'scrivi');
    var ta = el('textarea');
    ta.rows = 2;
    ta.maxLength = cfg ? cfg.limiti.testo : 1000;
    ta.placeholder = ai ? T.scriviAi : T.scrivi;
    ta.setAttribute('aria-label', ai ? T.scriviAi : T.scrivi);
    var bi = el('button', 'prim', T.invia);
    bi.type = 'submit';
    form.appendChild(ta);
    form.appendChild(bi);
    c.appendChild(form);
    // l'etichetta fissa vicino al campo (11.3 riga 3): col bot "Stai scrivendo a un assistente AI", poi l'informativa
    var nota = el('div', 'nota');
    var dest = el('span', 'dest');
    nota.appendChild(dest);
    nota.appendChild(document.createTextNode(((ai && cfg.testi.etichetta) ? cfg.testi.etichetta[lingua] : T.etichetta) + ' '));
    var li = el('button', 'link', T.informativa);
    li.type = 'button';
    li.setAttribute('aria-expanded', 'false');
    li.addEventListener('click', function () { info.hidden = !info.hidden; li.setAttribute('aria-expanded', info.hidden ? 'false' : 'true'); });
    nota.appendChild(li);
    c.appendChild(nota);
    form.addEventListener('submit', function (e) { e.preventDefault(); inviaTesto(); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); inviaTesto(); }
    });
    V.lista = lista; V.scorre = sc; V.fondo = fondo; V.avviso = av; V.testo = ta; V.invia = bi; V.persona = pers; V.rapidi = rapidi; V.form = form; V.dest = dest; V.scheda = null;
    mostraDestinatario();
    if (cfg && !cfg.attiva) bloccaScrittura(T.spentaChat);
    aggiornaPersona();
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) ta.focus();
  }
  function bloccaScrittura(testo) {
    if (V.nome !== 'chat') return;
    V.testo.disabled = true;
    V.invia.disabled = true;
    var b = V.rapidi.querySelectorAll('button');
    for (var i = 0; i < b.length; i++) b[i].disabled = true;
    togliSchedaEmail();
    avviso(testo, true);
  }
  function avviso(testo, conMail) {
    if (V.nome !== 'chat') return;
    svuota(V.avviso);
    if (!testo) { V.avviso.hidden = true; return; }
    if (conMail) mail(V.avviso, testo); else V.avviso.textContent = testo;
    V.avviso.hidden = false;
  }
  // a chi vanno le risposte: sempre a vista, cosi' una chat aperta da un link di altri si riconosce (Gate 2, B3)
  function mostraDestinatario() {
    if (V.nome !== 'chat') return;
    V.dest.textContent = S.email ? T.inviaA + S.email + '. ' : '';
  }
  function aggiornaPersona() {
    if (V.nome !== 'chat') return;
    var gia = S.stato === 'attesa_persona' || S.stato === 'aperta';
    V.persona.textContent = gia ? T.personaFatto : T.persona;
    V.persona.disabled = gia || S.stato === 'chiusa' || !(S.config && S.config.attiva);
  }
  function inBasso() { if (V.scorre) V.scorre.scrollTop = V.scorre.scrollHeight; }
  function ora(at) {
    var d = new Date(at);
    if (isNaN(d.getTime())) return '';
    var oggi = new Date().toDateString() === d.toDateString();
    var o = oggi ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
    try { return d.toLocaleString(lingua === 'en' ? 'en-GB' : 'it-IT', o); } catch (e) { return ''; }
  }
  function bollaMsg(m) {
    var b = el('div', 'msg ' + m.autore);
    var chi = firma(m.autore, !!(S.config && S.config.ai), T);
    if (chi) b.appendChild(el('span', 'chi', chi));
    var p = el('span');
    var pz = pezziTesto(m.testo);
    for (var i = 0; i < pz.length; i++) {
      if (pz[i].href) {
        var a = el('a', '', pz[i].t);
        a.href = pz[i].href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        p.appendChild(a);
      } else p.appendChild(document.createTextNode(pz[i].t));
    }
    b.appendChild(p);
    var meta = ora(m.at) + (m.via_email && m.autore === 'staff' ? ' \u00b7 ' + T.anchePerEmail : '');
    if (meta) b.appendChild(el('span', 'meta', meta));
    return b;
  }
  // mostra i messaggi della risposta una volta sola (per seq), in ordine; restituisce quanti sono nuovi e non della cliente
  function mostra(lista) {
    if (V.nome !== 'chat' || !Array.isArray(lista)) return 0;
    var nuovi = 0;
    for (var i = 0; i < lista.length; i++) {
      var m = messaggioValido(lista[i]);
      if (!m || S.visti[m.seq]) continue;
      S.visti[m.seq] = 1;
      var b = bollaMsg(m);
      b.setAttribute('data-seq', String(m.seq));
      var dopo = null;
      var figli = V.lista.querySelectorAll('[data-seq]');
      for (var j = 0; j < figli.length; j++) if (Number(figli[j].getAttribute('data-seq')) > m.seq) { dopo = figli[j]; break; }
      var inv = V.lista.querySelector('.in-invio,.fallito,.sta,.scheda');
      V.lista.insertBefore(b, dopo || inv);
      if (m.autore !== 'cliente') nuovi++;
    }
    if (nuovi && S.aperto) inBasso();
    return nuovi;
  }
  // lo stato comune delle risposte di avvia, invia, passaggio e aggiorna
  function leggiStato(d) {
    if (typeof d.stato === 'string') S.stato = d.stato;
    if (typeof d.email === 'string') { S.email = d.email; mostraDestinatario(); }
    S.serveEmail = d.serve_email === true && S.stato === 'bot';
    if (S.serveEmail) mostraSchedaEmail(); else togliSchedaEmail();
    aggiornaPersona();
  }

  // ---- la scheda dell'email, dentro la conversazione, solo quando la chat la chiede ----
  function togliSchedaEmail() {
    if (V.scheda && V.scheda.parentNode) V.scheda.parentNode.removeChild(V.scheda);
    if (V.nome === 'chat') V.scheda = null;
  }
  function mostraSchedaEmail() {
    // mai a chat spenta o chiusa (scrittura bloccata): Gate 2 del 25-11, C6
    if (V.nome !== 'chat' || V.scheda || V.testo.disabled) return;
    var cfg = S.config;
    var b = el('div', 'msg scheda');
    var f = el('form', 'modulo');
    f.noValidate = true;
    f.appendChild(el('span', 'chi', T.emailTitolo));
    var email = campo(T.email, 'input', 'email', 254);
    email.i.autocomplete = 'email';
    email.i.required = true;
    var nome = campo(T.nome, 'input', 'text', cfg.limiti.nome);
    nome.i.autocomplete = 'name';
    var info = el('p', 'piccolo');
    testoInformativa(info);
    var err = el('p', 'errore');
    err.setAttribute('role', 'alert');
    var vai = el('button', 'prim', T.inviaTeam);
    vai.type = 'submit';
    f.appendChild(email.l);
    f.appendChild(nome.l);
    f.appendChild(info);
    f.appendChild(err);
    f.appendChild(vai);
    b.appendChild(f);
    V.lista.appendChild(b);
    V.scheda = b;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var em = email.i.value.trim().toLowerCase();
      var no = nome.i.value.trim();
      err.textContent = '';
      if (!emailOk(em)) { err.textContent = T.emailKo; email.i.focus(); return; }
      if (contaCp(no) > cfg.limiti.nome) { err.textContent = T.nomeKo; nome.i.focus(); return; }
      vai.disabled = true;
      var corpoP = { token: S.token, email: em };
      if (no) corpoP.nome = no;
      chiama('passaggio', corpoP).then(function (r) {
        vai.disabled = false;
        var d = r.d;
        if (d && d.ok === true) {
          S.attivita = Date.now();
          S.movimento = Date.now();
          leggiStato(d);
          mostra(d.messaggi);
          salvaStato();
          inBasso();
          programma();
          return;
        }
        if (rifiutoComune(r, '')) return;
        if (r.http === 422 && d && d.campo === 'email') { err.textContent = T.emailKo; return; }
        if (r.http === 422 && d && d.campo === 'nome') { err.textContent = T.nomeKo; return; }
        mail(err, d && d.state === 'troppo_veloce' ? T.troppoVeloce + ' ' : T.nonDisponibile);
      });
    });
    inBasso();
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) email.i.focus();
  }

  // ---- la chat nasce al primo invio: Turnstile, poi `avvia` senza email ----
  function assicuraChat(cb) {
    if (S.token) { cb(true); return; }
    if (S.avvio) { S.avvio.push(cb); return; }
    S.avvio = [cb];
    var fine = function (ok) { var l = S.avvio; S.avvio = null; for (var i = 0; i < l.length; i++) l[i](ok); };
    var cfg = S.config;
    tokenTs(function (ts) {
      if (!ts) { avviso(T.verificaKo, true); fine(false); return; }
      chiama('avvia', { lingua: lingua, informativa: cfg.informativa_versione, turnstile: ts, prova: prova }).then(function (r) {
        var d = r.d;
        if (d && d.ok === true && typeof d.token === 'string' && TOKEN_RE.test(d.token)) {
          S.token = d.token;
          S.attivita = Date.now();
          S.movimento = Date.now();
          S.cursore = 0;
          leggiStato(d);
          salvaStato(true);
          fine(true);
          return;
        }
        var st = d && d.state;
        if (st === 'spenta') { if (S.config) S.config.attiva = false; bloccaScrittura(T.spentaChat); }
        else avviso(st === 'verifica_fallita' ? T.verificaKo : st === 'limite' ? T.limite : T.nonDisponibile, true);
        fine(false);
      });
    });
  }
  // "l'assistente sta scrivendo": solo mentre aspettiamo una risposta del bot
  function staScrivendo(si) {
    if (V.nome !== 'chat') return;
    var x = V.lista.querySelector('.sta');
    if (!si) { if (x) x.parentNode.removeChild(x); return; }
    if (x || !(S.config && S.config.ai) || S.stato !== 'bot') return;
    V.lista.appendChild(el('div', 'msg sta', T.sta));
    inBasso();
  }

  // ---- azioni della cliente ----
  function rifiutoComune(r, testo) {
    var d = r.d;
    var st = d && d.state;
    if (st === 'token_non_valido') { dimentica(); vistaTesto(T.scaduta, false, T.nuova, nuovaChat); return true; }
    if (st === 'spenta') { if (S.config) S.config.attiva = false; bloccaScrittura(T.spentaChat); if (testo) V.testo.value = testo; return true; }
    if (st === 'chiusa') { mostraChiusa(); if (testo && V.testo) V.testo.value = testo; return true; }
    if (st === 'limite_messaggi') { avviso(T.limiteMessaggi, false); if (testo) V.testo.value = testo; return true; }
    return false;
  }
  function inviaTesto(riprovaDi) {
    if (V.nome !== 'chat' || !S.config || !S.config.attiva) return;
    var testo = riprovaDi ? riprovaDi.testo : V.testo.value.trim();
    if (!testo) return;
    if (contaCp(testo) > S.config.limiti.testo) { avviso(T.testoKo, false); return; }
    var cid = riprovaDi ? riprovaDi.cid : nuovoUuid(window.crypto);
    var b = riprovaDi ? riprovaDi.bolla : el('div', 'msg cliente in-invio');
    if (!riprovaDi) {
      b.appendChild(el('span', '', testo));
      b.appendChild(el('span', 'meta', T.inInvio));
      V.lista.insertBefore(b, V.lista.querySelector('.scheda'));
      V.testo.value = '';
      inBasso();
    }
    b.className = 'msg cliente in-invio';
    avviso('', false);
    var fallito = function (d) {
      staScrivendo(false);
      b.className = 'msg cliente fallito';
      var meta = b.querySelector('.meta');
      svuota(meta);
      meta.appendChild(document.createTextNode((d && d.state === 'troppo_veloce' ? T.troppoVeloce : T.nonInviato) + ' '));
      var rb = el('button', 'link', T.riprova);
      rb.type = 'button';
      rb.addEventListener('click', function () { meta.textContent = T.inInvio; inviaTesto({ testo: testo, cid: cid, bolla: b }); });
      meta.appendChild(rb);
    };
    assicuraChat(function (ok) {
      if (!ok) { fallito(null); return; }
      staScrivendo(true);
      chiama('invia', { token: S.token, client_id: cid, testo: testo }, ATTESA_BOT_MS).then(function (r) {
        var d = r.d;
        staScrivendo(false);
        if (d && d.ok === true) {
          if (b.parentNode) b.parentNode.removeChild(b);
          S.attivita = Date.now();
          S.movimento = Date.now();
          mostra(d.messaggi);
          leggiStato(d);
          salvaStato();
          inBasso();
          riprogramma(1500);
          return;
        }
        if (rifiutoComune(r, testo)) { if (b.parentNode) b.parentNode.removeChild(b); return; }
        fallito(d);
      });
    });
  }
  function inviaBottone(bt, x) {
    x.disabled = true;
    assicuraChat(function (ok) {
      if (!ok) { x.disabled = false; return; }
      chiama('invia', { token: S.token, client_id: nuovoUuid(window.crypto), bottone: bt.id }).then(function (r) {
        x.disabled = false;
        var d = r.d;
        if (d && d.ok === true) {
          S.attivita = Date.now();
          S.movimento = Date.now();
          mostra(d.messaggi);
          leggiStato(d);
          salvaStato();
          inBasso();
          return;
        }
        if (rifiutoComune(r, '')) return;
        avviso(d && d.state === 'bottone_non_disponibile' ? T.bottoneKo : d && d.state === 'troppo_veloce' ? T.troppoVeloce : T.nonInviato, false);
      });
    });
  }
  function chiediPersona(x) {
    x.disabled = true;
    assicuraChat(function (ok) {
      if (!ok) { aggiornaPersona(); return; }
      chiama('passaggio', { token: S.token }).then(function (r) {
        var d = r.d;
        if (d && d.ok === true) {
          S.attivita = Date.now();
          S.movimento = Date.now();
          mostra(d.messaggi);
          leggiStato(d);
          salvaStato();
          inBasso();
          programma();
          return;
        }
        aggiornaPersona();
        if (rifiutoComune(r, '')) return;
        avviso(d && d.state === 'troppo_veloce' ? T.troppoVeloce : T.nonInviato, false);
      });
    });
  }
  function mostraChiusa() {
    S.stato = 'chiusa';
    ferma();
    if (V.nome !== 'chat') return;
    V.testo.disabled = true;
    V.invia.disabled = true;
    var b = V.rapidi.querySelectorAll('button');
    for (var i = 0; i < b.length; i++) b[i].disabled = true;
    togliSchedaEmail();
    svuota(V.avviso);
    V.avviso.appendChild(document.createTextNode(T.chiusa + ' '));
    var n = el('button', 'link', T.nuova);
    n.type = 'button';
    n.addEventListener('click', nuovaChat);
    V.avviso.appendChild(n);
    V.avviso.hidden = false;
  }
  function nuovaChat() {
    dimentica();
    if (S.config && S.config.attiva) vistaChat(); else vistaTesto(T.spenta, true);
  }

  // ---- polling: solo a pannello aperto e scheda visibile, e solo con una chat nata ----
  function ferma() { if (S.timer) { clearTimeout(S.timer); S.timer = null; } }
  function riprogramma(ms) { ferma(); if (S.aperto && !document.hidden && S.token) S.timer = setTimeout(aggiorna, ms); }
  function programma() {
    ferma();
    if (!S.aperto || document.hidden || !S.token || S.stato === 'chiusa' || V.nome !== 'chat') return;
    var ms = intervallo(Date.now() - S.movimento);
    if (ms === null) { mostraFermo(); return; }
    S.timer = setTimeout(aggiorna, ms);
  }
  function mostraFermo() {
    ferma();
    S.fermo = true;
    if (V.nome !== 'chat') return;
    svuota(V.fondo);
    V.fondo.appendChild(document.createTextNode(T.fermo + ' '));
    var b = el('button', 'link', T.controlla);
    b.type = 'button';
    b.addEventListener('click', function () { S.fermo = false; S.errori = 0; S.movimento = Date.now() - 600000; V.fondo.hidden = true; aggiorna(); });
    V.fondo.appendChild(b);
    V.fondo.hidden = false;
  }
  function aggiorna(pagine) {
    if (!S.token || S.inVolo) return;
    S.inVolo = true;
    ferma();
    chiama('aggiorna', { token: S.token, dopo: S.cursore, vista: S.aperto && !document.hidden }).then(function (r) {
      S.inVolo = false;
      var d = r.d;
      if (d && d.ok === true) {
        var ms = Array.isArray(d.messaggi) ? d.messaggi : [];
        for (var i = 0; i < ms.length; i++) if (ms[i] && typeof ms[i].seq === 'number' && ms[i].seq > S.cursore) S.cursore = ms[i].seq;
        var nuovi = mostra(ms);
        if (nuovi) { S.movimento = Date.now(); S.attivita = Date.now(); if (V.fondo) V.fondo.hidden = true; S.fermo = false; }
        leggiStato(d);
        salvaStato();
        if (S.stato === 'chiusa') { mostraChiusa(); return; }
        S.errori = 0;
        var p = typeof pagine === 'number' ? pagine : 0;
        if (d.altri === true && p < PAGINE_STORIA) {
          if (S.aperto && !document.hidden) S.timer = setTimeout(function () { aggiorna(p + 1); }, 300);
          return;
        }
        programma();
        return;
      }
      if (d && d.state === 'troppo_veloce') { riprogramma(Math.min(60, Math.max(1, Number(d.retry_after_s) || 10)) * 1000); return; }
      if (rifiutoComune(r, '')) return;
      if (++S.errori >= ERRORI_DI_FILA) { mostraFermo(); return; }
      riprogramma(10000);
    });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { ferma(); return; }
    if (S.aperto && S.token && V.nome === 'chat' && S.stato !== 'chiusa' && !S.fermo) aggiorna();
  });

  // ---- apertura ----
  function configValida(d) {
    if (!d || d.ok !== true || typeof d.attiva !== 'boolean') return null;
    if (!d.attiva) return { attiva: false };
    var t = d.testi && typeof d.testi === 'object' ? d.testi : {};
    var testo = function (x) { return x && typeof x.it === 'string' && typeof x.en === 'string' ? { it: x.it, en: x.en } : null; };
    var bott = [];
    var lb = Array.isArray(d.bottoni) ? d.bottoni.slice(0, 8) : [];
    for (var i = 0; i < lb.length; i++) {
      var b = lb[i];
      if (b && typeof b.id === 'string' && /^[a-z0-9_]{1,30}$/.test(b.id) && typeof b.it === 'string' && typeof b.en === 'string') bott.push({ id: b.id, it: b.it, en: b.en });
    }
    var lim = d.limiti && typeof d.limiti === 'object' ? d.limiti : {};
    var inf = testo(t.informativa);
    if (!inf || typeof d.informativa_versione !== 'string') return null;
    var ai = d.ai === true && !!testo(t.etichetta);
    return {
      attiva: true, ai: ai, testi: { saluto: testo(t.saluto), orari: testo(t.orari), informativa: inf, etichetta: ai ? testo(t.etichetta) : null },
      bottoni: bott, informativa_versione: d.informativa_versione,
      limiti: { testo: Number.isInteger(lim.testo) && lim.testo > 0 ? lim.testo : 1000, nome: Number.isInteger(lim.nome) && lim.nome > 0 ? lim.nome : 80 }
    };
  }
  function inizia() {
    S.iniziato = true;
    var st = A.leggi();
    if (st && st.p === prova && Date.now() - st.a <= INATTIVITA_MS) { S.token = st.t; S.attivita = st.a; S.email = st.e || null; }
    else if (st && st.p === prova) A.togli();
    vistaTesto(T.carica, false);
    chiama('config').then(function (r) {
      var cfg = configValida(r.d);
      if (!cfg) {
        A.beacon(r.http === 0 ? 'config_rete' : 'config_non_valida');
        S.iniziato = false;
        vistaTesto(T.errore, false, T.riprovaCarica, inizia);
        return;
      }
      S.config = cfg.attiva ? cfg : { attiva: false, ai: false, bottoni: [], limiti: { testo: 1000, nome: 80 }, testi: {} };
      if (S.token) {
        vistaChat();
        S.movimento = Date.now();
        S.cursore = 0;
        aggiorna(0);
        return;
      }
      if (!cfg.attiva) { vistaTesto(T.spenta, true); return; }
      // niente modulo: la chat si apre sul saluto, col campo per scrivere; la sessione nasce al primo invio
      vistaChat();
    });
  }
  function apri() {
    S.aperto = true;
    pannello.hidden = false;
    A.aperto(true);
    A.pallino(0);
    if (!S.iniziato) inizia();
    else if (V.nome === 'chat' && S.token && S.stato !== 'chiusa') { S.fermo = false; if (V.fondo) V.fondo.hidden = true; aggiorna(); }
    if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) pannello.focus();
  }
  function chiudi() {
    S.aperto = false;
    pannello.hidden = true;
    A.aperto(false);
    ferma();
    A.bolla.focus();
  }
  A.pannello = { alterna: function () { if (S.aperto) chiudi(); else apri(); } };
  if (A.daAprire) apri();
})();
