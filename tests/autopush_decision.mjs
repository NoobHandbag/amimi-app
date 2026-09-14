// tests/autopush_decision.mjs — modulo PURO della decisione autopush (audit gate 14-09, A3).
//   node tests/autopush_decision.mjs
// Il rischio (rialzare uno stock appena venduto quando il DB e' indietro rispetto a Shopify) compare solo in una
// finestra di corsa fra i cron, cioe' quasi mai in un collaudo: qui la decisione e' isolata e testata a tavolino.
import { decide, isRaise } from '../supabase/functions/shopify-stock/decide.ts';

let ok = 0, ko = 0;
const eq = (name, got, exp) => { if (got === exp) { ok++; console.log('  ok  ' + name); } else { ko++; console.log(`  KO  ${name}  atteso ${exp}, ottenuto ${got}`); } };
const D = (o) => decide({ target: 0, current: 0, perItem: null, hasFresh: false, holdRaises: false, raisesAllowed: true, ...o });

console.log('\n== isRaise ==');
eq('collassato: target>current e\' un rialzo', isRaise(5, 3, null), true);
eq('collassato: target<current NON e\' un rialzo', isRaise(2, 3, null), false);
eq('collassato: target==current NON e\' un rialzo', isRaise(3, 3, null), false);
eq('perItem: una sorella sotto target e\' un rialzo', isRaise(4, 4, [4, 2]), true);
eq('perItem: tutte >= target non e\' un rialzo', isRaise(3, 3, [3, 5]), false);

console.log('\n== decide: allineato -> ok ==');
eq('collassato uguale', D({ target: 3, current: 3 }), 'ok');
eq('perItem tutte a target', D({ target: 3, current: 3, perItem: [3, 3] }), 'ok');

console.log('\n== decide: ribasso passa SEMPRE (anche se il sync non e\' allineato) ==');
eq('ribasso, sync non allineato -> push', D({ target: 1, current: 5, raisesAllowed: false }), 'push');
eq('ribasso, hold_raises on -> push', D({ target: 1, current: 5, holdRaises: true }), 'push');
eq('ribasso su una sorella -> push', D({ target: 2, current: 2, perItem: [2, 5], raisesAllowed: false }), 'push');

console.log('\n== decide: rialzo tenuto quando il DB non e\' allineato (A3) ==');
eq('rialzo, sync NON fresco (raisesAllowed=false), niente conta -> hold', D({ target: 5, current: 3, raisesAllowed: false }), 'hold');
eq('rialzo, sync fresco (raisesAllowed=true) -> push', D({ target: 5, current: 3, raisesAllowed: true }), 'push');
eq('rialzo, sync NON fresco ma conta FRESCA -> push (la conta e\' autorevole)', D({ target: 5, current: 3, raisesAllowed: false, hasFresh: true }), 'push');
eq('rialzo, hold_raises on senza conta -> hold', D({ target: 5, current: 3, holdRaises: true, raisesAllowed: true }), 'hold');
eq('rialzo, hold_raises on con conta -> push', D({ target: 5, current: 3, holdRaises: true, hasFresh: true }), 'push');
eq('rialzo su una sorella, sync non allineato -> hold', D({ target: 4, current: 4, perItem: [4, 2], raisesAllowed: false }), 'hold');
eq('divergenza pura (collassato ok, sorella sotto), sync fresco -> push', D({ target: 4, current: 4, perItem: [4, 2], raisesAllowed: true }), 'push');

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
