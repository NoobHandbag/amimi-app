// backnav — il gesto "indietro" di Android (swipe dal bordo) naviga DENTRO l'app invece di uscirne.
// Ogni sotto-stato (tab, drawer, form aperto) registra un handler di chiusura e spinge una entry
// nella History: lo swipe fa history.back() -> popstate -> chiudiamo il sotto-stato.
// Contratto: entrando in un sotto-stato chiama pushBack(chiudi); il bottone UI di chiusura
// chiama popBack(chiudi) (consuma la entry di history, con fallback se la pila e' vuota).
const stack: (() => void)[] = [];
let inited = false;

function init() {
  if (inited) return;
  inited = true;
  window.addEventListener('popstate', () => {
    const fn = stack.pop();
    if (fn) fn();
  });
}

export function pushBack(onBack: () => void) {
  init();
  stack.push(onBack);
  history.pushState({ amimi: stack.length }, '');
}

export function popBack(fallback?: () => void) {
  if (stack.length) history.back();
  else fallback?.();
}
