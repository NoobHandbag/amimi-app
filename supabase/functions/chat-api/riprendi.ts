// chat-api: la pagina GET /apps/chat/riprendi (Fase 1 pezzo 5, docs/PROPOSTA_chat_sito.md 5.4 e 6.6, D-10). E' la pagina
// del link "Continua la chat" delle email di chat-send: `https://amimi.it/apps/chat/riprendi#t=<token di ripresa>` piu'
// `&prova=1` per le sessioni di prova. Il token sta dopo il `#`, quindi non arriva mai al server ne' ai log.
// La pagina e' statica (nessun dato della richiesta dentro) e va al proxy di Shopify come `application/liquid` con
// `{% layout none %}{% raw %}`, come loyalty-page e la /misura dello spike: senza il layout del tema non gira nessuno
// script di terzi, e il proxy non la riscrive in testo. Al caricamento toglie il token dall'indirizzo (resta solo in
// memoria) e non fa nessuna chiamata: i filtri antivirus delle email aprono i link. Solo al tocco su "Continua la chat"
// carica Turnstile (azione `chat_riprendi`, widget di prova con `prova=1`), scambia il token con POST /riprendi, salva il
// chat token nella chiave di localStorage del widget (`amimi_chat_v1`, stesso formato di chat-loader.js, con `o: true`
// perche' la bolla si apra da sola) e porta alla home. Guardie e prova di comportamento in tests/chat_api.mjs.
export const LIQUID_APRI = '{% layout none %}{% raw %}';
export const LIQUID_CHIUDI = '{% endraw %}';

export const PAGINA_RIPRESA = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>Amimi: continua la chat</title>
<style>
body{margin:0;background:#f6f4f1;color:#1f1f1f;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:440px;margin:12vh auto 0;padding:28px 24px;background:#fff;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.08)}
.marchio{margin:0 0 6px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:13px}
h1{margin:0 0 10px;font-size:22px;line-height:1.25}
p{margin:0 0 14px}
.piccolo{font-size:14px;color:#555}
button{display:block;width:100%;border:0;border-radius:24px;padding:13px 18px;background:#1f1f1f;color:#fff;font:600 16px/1.2 system-ui,-apple-system,sans-serif;cursor:pointer}
button:disabled{opacity:.55;cursor:default}
button:focus-visible{outline:3px solid #1f1f1f;outline-offset:3px}
#ts{display:flex;justify-content:center;margin:0 0 12px}
#esito{min-height:1.5em}
a{color:inherit}
</style></head>
<body><main>
<p class="marchio">Amimi</p>
<h1 id="titolo">Continua la chat</h1>
<p id="testo">Tocca il pulsante per riaprire su questo dispositivo la tua chat con il team Amimi.</p>
<div id="ts"></div>
<button id="vai" type="button">Continua la chat</button>
<p id="esito" role="status" aria-live="polite"></p>
<p class="piccolo" id="nota">Puoi anche rispondere direttamente all'email: il team la riceve come le altre.</p>
</main>
<script>
(function () {
  'use strict';
  var CHIAVE = 'amimi_chat_v1';
  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  var TURNSTILE_JS = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var SITEKEY = { produzione: '0x4AAAAAAF2QTzI4g31RhjIS', prova: '0x4AAAAAAF33Q02jrHXJLHjr' };
  var en = /^en\\b/i.test(navigator.language || '');
  var T = en ? {
    titolo: 'Continue the chat', testo: 'Tap the button to reopen your chat with the Amimi team on this device.', vai: 'Continue the chat',
    nota: 'You can also reply directly to the email: our team receives it like any other.', verifica: 'Anti-spam check in progress...',
    fatto: 'Done: opening the chat...', linkKo: 'This link is not complete. Open it again from the email, or reply to the email.',
    scaduto: 'This link is no longer valid (links last 30 days). Reply to the email or write to info@amimi.it.',
    verificaKo: 'We could not complete the anti-spam check. Please try again.', spenta: 'The chat is not available right now. Reply to the email or write to info@amimi.it.',
    troppo: 'Too many attempts: please try again later.', riprova: 'Something went wrong. Please try again.',
    storage: 'This browser does not let us keep the chat open (private browsing?). Reply to the email instead.',
    sostituisci: 'Another chat is already open on this device. This link opens the chat of ', siSostituisci: 'Yes, open this chat'
  } : {
    titolo: 'Continua la chat', testo: 'Tocca il pulsante per riaprire su questo dispositivo la tua chat con il team Amimi.', vai: 'Continua la chat',
    nota: 'Puoi anche rispondere direttamente all\\'email: il team la riceve come le altre.', verifica: 'Verifica anti-spam in corso...',
    fatto: 'Fatto: apro la chat...', linkKo: 'Questo link non \\u00e8 completo. Aprilo di nuovo dall\\'email, oppure rispondi all\\'email.',
    scaduto: 'Questo link non vale pi\\u00f9 (dura 30 giorni). Rispondi all\\'email o scrivici a info@amimi.it.',
    verificaKo: 'Non siamo riusciti a completare la verifica anti-spam. Riprova.', spenta: 'La chat non \\u00e8 disponibile in questo momento. Rispondi all\\'email o scrivici a info@amimi.it.',
    troppo: 'Troppi tentativi: riprova pi\\u00f9 tardi.', riprova: 'Qualcosa non ha funzionato. Riprova.',
    storage: 'Questo browser non ci lascia tenere aperta la chat (navigazione privata?). Rispondi all\\'email.',
    sostituisci: 'Su questo dispositivo c\\'\\u00e8 gi\\u00e0 un\\'altra chat aperta. Questo link apre la chat di ', siSostituisci: 'S\\u00ec, apri questa chat'
  };
  var $ = function (id) { return document.getElementById(id); };
  var vai = $('vai');
  var esito = $('esito');
  if (en) document.documentElement.lang = 'en';
  $('titolo').textContent = T.titolo;
  $('testo').textContent = T.testo;
  $('nota').textContent = T.nota;
  vai.textContent = T.vai;

  // il token resta solo in memoria: via dall'indirizzo e dalla cronologia subito
  var q = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  var tok = q.get('t') || '';
  var prova = q.get('prova') === '1';
  if (location.hash) history.replaceState(null, '', location.pathname);
  if (!TOKEN_RE.test(tok)) { esito.textContent = T.linkKo; vai.hidden = true; return; }
  var dove = /\\/riprendi$/.test(location.pathname) ? location.pathname : '/apps/chat/riprendi';

  var tsId = null;
  var finito = false;
  function libera(testo) { esito.textContent = testo; vai.disabled = false; }
  function chiudi(testo) { esito.textContent = testo; vai.hidden = true; finito = true; }
  var inAttesa = null;
  function altraChatAttiva(nuovoToken) {
    var o = null;
    try { o = JSON.parse(localStorage.getItem(CHIAVE) || 'null'); } catch (e) { return false; }
    return !!o && typeof o.t === 'string' && o.t !== nuovoToken && typeof o.a === 'number' && Date.now() - o.a < 4 * 3600 * 1000;
  }
  function salvaEVai(nuovo) {
    try { localStorage.setItem(CHIAVE, JSON.stringify(nuovo)); }
    catch (e) { chiudi(T.storage); return; }
    chiudi(T.fatto);
    location.replace(en ? '/en' : '/');
  }
  function scambia(ts) {
    fetch(dove, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token_ripresa: tok, turnstile: ts, prova: prova }),
      credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var d = null;
        try { d = JSON.parse(t); } catch (e) { d = null; }
        if (d && d.ok === true && typeof d.token === 'string' && TOKEN_RE.test(d.token)) {
          var em = typeof d.email === 'string' && d.email.length <= 260 ? d.email : '';
          var nuovo = { v: 1, t: d.token, p: prova, a: Date.now(), s: 0, o: true, e: em };
          // un'altra chat ancora attiva su questo dispositivo: prima di sostituirla si chiede, mostrando di chi e' quella del
          // link (Gate 2 del pezzo 5, B3: un link "Continua la chat" mandato da qualcun altro)
          if (altraChatAttiva(d.token)) { inAttesa = nuovo; esito.textContent = T.sostituisci + (em || '***') + '?'; vai.textContent = T.siSostituisci; vai.disabled = false; return; }
          salvaEVai(nuovo);
          return;
        }
        var st = d && d.state;
        if (st === 'token_non_valido') chiudi(T.scaduto);
        else if (st === 'spenta' || st === 'non_disponibile') chiudi(T.spenta);
        else if (st === 'troppo_veloce') libera(T.troppo);
        else libera(st === 'verifica_fallita' ? T.verificaKo : T.riprova);
      }, function () { libera(T.riprova); });
  }
  function verifica() {
    try {
      if (tsId === null) {
        tsId = window.turnstile.render('#ts', { sitekey: prova ? SITEKEY.prova : SITEKEY.produzione, action: 'chat_riprendi', language: en ? 'en' : 'it',
          callback: function (ts) { if (!finito) scambia(ts); },
          'error-callback': function () { libera(T.verificaKo); }, 'timeout-callback': function () { libera(T.verificaKo); } });
      } else window.turnstile.reset(tsId);
    } catch (e) { libera(T.verificaKo); }
  }
  vai.addEventListener('click', function () {
    if (finito) return;
    if (inAttesa) { var n = inAttesa; inAttesa = null; salvaEVai(n); return; }
    vai.disabled = true;
    esito.textContent = T.verifica;
    if (window.turnstile) { verifica(); return; }
    var s = document.createElement('script');
    s.src = TURNSTILE_JS;
    s.async = true;
    s.onload = function () { if (window.turnstile) verifica(); else libera(T.verificaKo); };
    s.onerror = function () { libera(T.verificaKo); };
    document.head.appendChild(s);
  });
})();
</script>
</body></html>
`;
