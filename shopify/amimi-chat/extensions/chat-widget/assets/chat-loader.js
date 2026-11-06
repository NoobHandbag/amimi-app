// Amimi Chat, loader della bolla (Fase 0: scheletro per lo spike, docs/PROPOSTA_chat_sito.md 4.3 e 13.3).
// Disegna la bolla e basta: nessuna chiamata di rete, nessuna scrittura sul dispositivo (niente localStorage, cookie,
// sessionStorage), nessun innerHTML. Al clic, in Fase 0, solo un riquadro col rimando a info@amimi.it: il pannello vero
// (nome, email, messaggi, Turnstile) arriva in Fase 1 come secondo asset caricato al clic. Guardie in
// tests/chat_widget_guardie.mjs (anche il peso: sotto 10 KB compressi).
(function () {
  'use strict';
  if (window.__amimiChat) return;
  window.__amimiChat = { versione: 'fase0' };

  var COLORE_RE = /^#[0-9a-fA-F]{6}$/;

  function avvia() {
    var cfg = document.getElementById('amimi-chat-embed');
    if (!cfg) return;
    var sinistra = cfg.getAttribute('data-posizione') === 'bottom_left';
    var colore = COLORE_RE.test(cfg.getAttribute('data-colore') || '') ? cfg.getAttribute('data-colore') : '#1f1f1f';
    var prova = cfg.getAttribute('data-prova') === 'true';

    var lato = sinistra ? 'left' : 'right';
    var bolla = document.createElement('button');
    bolla.type = 'button';
    bolla.setAttribute('aria-label', 'Apri la chat con Amimi');
    bolla.setAttribute('aria-expanded', 'false');
    bolla.setAttribute('data-amimi-chat', 'bolla');
    bolla.textContent = prova ? 'Chat PROVA' : 'Chat';
    var s = bolla.style;
    s.position = 'fixed';
    s.bottom = '20px';
    s[lato] = '20px';
    s.zIndex = '2147483000';
    s.minWidth = '56px';
    s.height = '56px';
    s.padding = '0 18px';
    s.border = '0';
    s.borderRadius = '28px';
    s.background = colore;
    s.color = '#ffffff';
    s.font = '600 15px/1 system-ui, sans-serif';
    s.cursor = 'pointer';
    s.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.18)';

    var riquadro = null;
    bolla.addEventListener('click', function () {
      if (riquadro) {
        riquadro.remove();
        riquadro = null;
        bolla.setAttribute('aria-expanded', 'false');
        return;
      }
      riquadro = document.createElement('div');
      riquadro.setAttribute('role', 'dialog');
      riquadro.setAttribute('aria-label', 'Chat con Amimi');
      riquadro.setAttribute('data-amimi-chat', 'riquadro');
      var r = riquadro.style;
      r.position = 'fixed';
      r.bottom = '88px';
      r[lato] = '20px';
      r.zIndex = '2147483000';
      r.maxWidth = '300px';
      r.padding = '16px';
      r.borderRadius = '12px';
      r.background = '#ffffff';
      r.color = '#1f1f1f';
      r.font = '400 14px/1.4 system-ui, sans-serif';
      r.boxShadow = '0 6px 24px rgba(0, 0, 0, 0.2)';
      var testo = document.createElement('p');
      testo.style.margin = '0';
      testo.textContent = 'La chat è in preparazione. Per ora scrivici a info@amimi.it: ti rispondiamo noi.';
      riquadro.appendChild(testo);
      document.body.appendChild(riquadro);
      bolla.setAttribute('aria-expanded', 'true');
    });
    document.body.appendChild(bolla);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
  else avvia();
})();
