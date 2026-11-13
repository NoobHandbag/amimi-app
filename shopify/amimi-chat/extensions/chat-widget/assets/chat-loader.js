// Amimi Chat, loader della bolla (pezzo 5; proposta 4.3, 5.4, 6.2, 11.10). Bolla in shadow DOM; senza chat in corso
// nessuna rete e nessuna scrittura prima del tocco (test 16); con un chat token valido un solo `aggiorna` per il pallino.
// Al tocco carica chat-panel.js dalla cartella di questo script. Solo textContent. Prove: tests/chat_widget_guardie.mjs;
// Shopify misura questo file NON compresso: sotto 10.000 byte (theme check AssetSizeAppBlockJavaScript).
(function () {
  'use strict';
  if (window.__amimiChat) return;
  var VERSIONE = 'w-1';
  var CHIAVE = 'amimi_chat_v1';
  var INATTIVITA_MS = 4 * 3600 * 1000;
  var BASE = '/apps/chat';
  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  var COLORE_RE = /^#[0-9a-fA-F]{6}$/;
  var SVG = 'http://www.w3.org/2000/svg';
  var PAGINE = { index: 'home', product: 'prodotto', collection: 'collezione', cart: 'carrello', search: 'ricerca', page: 'pagina', blog: 'blog', article: 'blog' };
  // il pannello sta nella cartella di questo script (Gate 2, C3)
  var MIO = (document.currentScript && document.currentScript.src) || '';
  var api = { versione: VERSIONE, chiave: CHIAVE, base: BASE, pannello: null };
  window.__amimiChat = api;

  // stato sul dispositivo: stesso formato in chat-panel.js e nella pagina riprendi di chat-api
  function leggi() {
    var o;
    try { o = JSON.parse(window.localStorage.getItem(CHIAVE) || 'null'); } catch (e) { return null; }
    if (!o || o.v !== 1 || typeof o.t !== 'string' || !TOKEN_RE.test(o.t) || typeof o.a !== 'number' || !isFinite(o.a)) return null;
    return { v: 1, t: o.t, p: o.p === true, a: o.a, s: typeof o.s === 'number' && o.s >= 0 ? Math.floor(o.s) : 0, o: o.o === true,
      e: typeof o.e === 'string' && o.e.length <= 260 ? o.e : '' };
  }
  function salva(o) { try { window.localStorage.setItem(CHIAVE, JSON.stringify(o)); return true; } catch (e) { return false; } }
  function togli() { try { window.localStorage.removeItem(CHIAVE); } catch (e) { /* storage non disponibile */ } }
  api.leggi = leggi;
  api.salva = salva;
  api.togli = togli;

  function pagina() {
    var m = ((document.body && document.body.className) || '').match(/\btemplate-([a-z]+)/);
    return (m && PAGINE[m[1]]) || 'altro';
  }
  api.pagina = pagina;
  function chiama(azione, corpo) {
    return fetch(BASE + '/' + azione, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { return d && typeof d === 'object' ? d : null; }, function () { return null; });
  }
  api.beacon = function (codice) { chiama('errore', { codice: codice, versione: VERSIONE, pagina: pagina() }); };

  // URL del blocco (asset_url): https, stesso host o CDN di Shopify, solo il chat-panel.js della cartella del loader
  function urlPannello(s) {
    try {
      var u = new URL(s, window.location.href);
      var m = new URL(MIO);
      if (u.protocol !== 'https:' || (u.hostname !== window.location.hostname && u.hostname !== 'cdn.shopify.com')) return null;
      if (!/\/extensions\/[A-Za-z0-9_\/.-]+\/assets\/chat-loader\.js$/.test(m.pathname)) return null;
      return u.origin === m.origin && u.pathname === m.pathname.replace(/chat-loader\.js$/, 'chat-panel.js') ? u.href : null;
    } catch (e) { return null; }
  }

  function el(tag, cls, testo) {
    var x = document.createElement(tag);
    if (cls) x.className = cls;
    if (testo) x.textContent = testo;
    return x;
  }
  function icona(d) {
    var s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', '26');
    s.setAttribute('height', '26');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    var p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.8');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    s.appendChild(p);
    return s;
  }
  var CSS = ':host{all:initial}' +
    '.bolla{position:fixed;bottom:20px;right:20px;z-index:2147483000;width:58px;height:58px;border:0;border-radius:50%;' +
    'background:var(--amc-colore,#1f1f1f);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.22);padding:0;font:600 12px/1 system-ui,-apple-system,sans-serif;transition:transform .15s}' +
    '.sx .bolla{right:auto;left:20px}.bolla:hover{transform:scale(1.05)}' +
    '.bolla:focus-visible{outline:3px solid #fff;box-shadow:0 0 0 6px var(--amc-colore,#1f1f1f)}' +
    '.bolla .chiusa{display:none}.aperto .bolla .apri{display:none}.aperto .bolla .chiusa{display:block}' +
    '.pallino{position:absolute;top:-3px;right:-3px;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:10px;' +
    'background:#c4302b;color:#fff;font:700 12px/20px system-ui,-apple-system,sans-serif;text-align:center}' +
    '.prova{position:absolute;bottom:-7px;left:50%;transform:translateX(-50%);padding:1px 5px;border-radius:4px;background:#ffd54f;' +
    'color:#1f1f1f;font:800 9px/12px system-ui,-apple-system,sans-serif;letter-spacing:.04em}' +
    '.carica{opacity:.7;cursor:progress}' +
    '@media (max-width:480px){.aperto .bolla{display:none}}' +
    '@media (prefers-reduced-motion:reduce){.bolla{transition:none}}';

  function avvia() {
    var cfg = document.getElementById('amimi-chat-embed');
    if (!cfg || !document.body) return;
    var prova = cfg.getAttribute('data-prova') === 'true';
    var colore = cfg.getAttribute('data-colore') || '';
    var host = el('div');
    host.id = 'amimi-chat-radice';
    if (COLORE_RE.test(colore)) host.style.setProperty('--amc-colore', colore);
    var radice = host.attachShadow({ mode: 'open' });
    var stile = el('style');
    stile.textContent = CSS;
    radice.appendChild(stile);
    var cornice = el('div', cfg.getAttribute('data-posizione') === 'bottom_left' ? 'sx' : '');
    radice.appendChild(cornice);
    var bolla = el('button', 'bolla');
    bolla.type = 'button';
    bolla.setAttribute('aria-label', 'Chat con Amim\u00ec');
    bolla.setAttribute('aria-expanded', 'false');
    bolla.appendChild(icona('M4.5 5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h-1A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5z')).setAttribute('class', 'apri');
    bolla.appendChild(icona('M6 6l12 12M18 6L6 18')).setAttribute('class', 'chiusa');
    if (prova) bolla.appendChild(el('span', 'prova', 'PROVA'));
    var pallino = el('span', 'pallino');
    pallino.hidden = true;
    pallino.setAttribute('aria-hidden', 'true');
    bolla.appendChild(pallino);
    cornice.appendChild(bolla);
    document.body.appendChild(host);

    api.host = host;
    api.radice = radice;
    api.cornice = cornice;
    api.bolla = bolla;
    api.impostazioni = { prova: prova, sinistra: cornice.className === 'sx' };
    api.pallino = function (n) {
      pallino.hidden = !(n > 0);
      pallino.textContent = n > 9 ? '9+' : String(n || '');
      bolla.setAttribute('aria-label', n > 0 ? 'Chat con Amim\u00ec: ' + n + ' nuove risposte' : 'Chat con Amim\u00ec');
    };
    api.aperto = function (si) {
      cornice.className = (api.impostazioni.sinistra ? 'sx' : '') + (si ? ' aperto' : '');
      bolla.setAttribute('aria-expanded', si ? 'true' : 'false');
    };

    var caricamento = false;
    function apri() {
      if (api.pannello) { api.pannello.alterna(); return; }
      if (caricamento) return;
      var src = urlPannello(cfg.getAttribute('data-pannello') || '');
      if (!src) { api.beacon('pannello_url'); return; }
      caricamento = true;
      bolla.classList.add('carica');
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      // pannello che non si registra: niente bolla muta (Gate 2, C5)
      s.onload = function () { bolla.classList.remove('carica'); if (!api.pannello) { caricamento = false; api.beacon('pannello_non_avviato'); } };
      s.onerror = function () { caricamento = false; bolla.classList.remove('carica'); api.beacon('pannello_non_caricato'); };
      document.head.appendChild(s);
    }
    api.daAprire = false;
    bolla.addEventListener('click', function () { api.daAprire = true; apri(); });

    // chat in corso: scaduta = via senza chiamate; o: true (pagina riprendi) = pannello aperto; altrimenti un aggiorna
    var st = leggi();
    if (!st || st.p !== prova) return;
    if (Date.now() - st.a > INATTIVITA_MS) { togli(); return; }
    if (st.o) {
      st.o = false;
      salva(st);
      api.daAprire = true;
      apri();
      return;
    }
    chiama('aggiorna', { token: st.t, dopo: st.s, vista: false }).then(function (d) {
      if (!d || api.pannello) return;
      if (d.ok !== true) { if (d.state === 'token_non_valido') togli(); return; }
      var n = 0;
      var ms = Array.isArray(d.messaggi) ? d.messaggi : [];
      var ultima = st.a;
      for (var i = 0; i < ms.length; i++) {
        if (!ms[i] || ms[i].autore !== 'staff') continue;
        n++;
        var at = Date.parse(ms[i].at);
        if (at > ultima && at <= Date.now()) ultima = at;
      }
      if (n === 0 && d.stato === 'chiusa') { togli(); return; }
      if (n > 0) {
        st.a = ultima;
        salva(st);
        api.pallino(d.altri ? 10 : n);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
  else avvia();
})();
