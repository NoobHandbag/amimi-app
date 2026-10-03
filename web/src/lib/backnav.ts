// backnav — il gesto "indietro" di Android (swipe dal bordo) naviga DENTRO l'app invece di uscirne.
// Ogni sotto-stato (tab, drawer, form aperto) registra un handler di chiusura e spinge una entry
// nella History: lo swipe fa history.back() -> popstate -> chiudiamo il sotto-stato.
// Contratto: entrando in un sotto-stato chiama pushBack(chiudi); il bottone UI di chiusura
// chiama popBack(chiudi) (consuma la entry di history, con fallback se la pila e' vuota).
const stack: (() => void)[] = [];
// handler di una pagina smontata (es. si esce da Negozi B2B con la barra in basso lasciando una scheda aperta):
// la loro voce di history resta, ma "indietro" la scavalca invece di eseguire una chiusura che non esiste piu'
const dead = new WeakSet<() => void>();
let inited = false;

function init() {
  if (inited) return;
  inited = true;
  window.addEventListener('popstate', () => {
    const fn = stack.pop();
    if (!fn) return;
    if (dead.has(fn)) { if (stack.length) history.back(); return; }
    fn();
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

// chi smonta dichiara morti gli handler che aveva spinto e che sono ancora nella pila
export function killBack(fns: (() => void)[]) {
  for (const fn of fns) if (stack.includes(fn)) dead.add(fn);
}
