// shopify-stock/decide.ts — decisione PURA dell'autopush (audit gate 14-09, finding A3).
// Modulo puro, importabile da Deno (l'edge) e da Node 24 (tests/autopush_decision.mjs). Niente sintassi TS esotica.
//
// Perche' esiste: l'autopush (:27) scrive su Shopify available := disponibili_da_vendere - buffer. Ma
// disponibili_da_vendere conosce SOLO gli ordini gia' ingeriti nel DB; se il sync ordini e' indietro (la finestra
// :07/:17/:27, o un giro fermo), il target e' piu' alto del reale e la push RIALZEREBBE uno stock appena venduto.
// La regola: un ribasso e' sempre sicuro (togliere dallo scaffale cio' che non c'e'); un RIALZO si fa solo se il
// DB e' allineato a Shopify (raisesAllowed) oppure c'e' una conta fisica fresca (hasFresh, autorevole).

// isRaise: la push alzerebbe lo stock su Shopify per almeno una variante sorella (o sul valore collassato).
export function isRaise(target: number, current: number, perItem: number[] | null): boolean {
  return perItem && perItem.length ? perItem.some((q) => target > q) : target > current;
}

// decide: 'ok' = gia' allineato (niente scrittura), 'push' = scrivi target, 'hold' = rialzo tenuto.
export function decide(i: {
  target: number; current: number; perItem: number[] | null;
  hasFresh: boolean; holdRaises: boolean; raisesAllowed: boolean;
}): 'ok' | 'push' | 'hold' {
  const allineato = i.perItem && i.perItem.length ? i.perItem.every((q) => q === i.target) : i.current === i.target;
  if (allineato) return 'ok';
  if (isRaise(i.target, i.current, i.perItem) && !i.hasFresh && (i.holdRaises || !i.raisesAllowed)) return 'hold';
  return 'push';
}
