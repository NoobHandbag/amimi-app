// tests/lead_priority.mjs — priorita' dei seed del loop "100 pronti" (workers/lead/priority.mjs), tutto offline.
//   node tests/lead_priority.mjs
import { parseMapsNote, resaFonte, fattoreMaps, prioritaSeed, scegliLotto } from '../workers/lead/priority.mjs';

let ok = 0, ko = 0;
const eq = (name, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { ok++; console.log('  ok  ' + name); }
  else { ko++; console.log(`  KO  ${name}  atteso ${e}, ottenuto ${g}`); }
};

console.log('\n== nota Maps del seed -> rating e recensioni ==');
eq('virgola decimale', parseMapsNote('Maps "concept store" Milano · 4,6 (123)'), { rating: 4.6, rec: 123 });
eq('punto decimale', parseMapsNote('Maps "boutique donna" Monza · 5.0 (6)'), { rating: 5, rec: 6 });
eq('nota assente', parseMapsNote(null), { rating: null, rec: null });
eq('nota senza rating (Benny)', parseMapsNote('Benny: rivende Lisa Corti'), { rating: null, rec: null });

console.log('\n== resa della fonte: prior (ab+1)/(giudicati+3) ==');
eq('fonte mai giudicata = 1/3', resaFonte({}, 'maps:nuova').toFixed(3), '0.333');
eq('14 buoni su 22', resaFonte({ 'maps:concept store': { giudicati: 22, ab: 14 } }, 'maps:concept store').toFixed(3), '0.600');
eq('3 buoni su 19 < mai giudicata', resaFonte({ x: { giudicati: 19, ab: 3 } }, 'x') < resaFonte({}, 'y'), true);

console.log('\n== segnale Maps ==');
eq('4,6 con 123 recensioni = 1', fattoreMaps({ rating: 4.6, rec: 123 }), 1);
eq('4,3 con 50 = 0,9', fattoreMaps({ rating: 4.3, rec: 50 }), 0.9);
eq('5,0 con 6 recensioni = 0,6 (troppo poche)', fattoreMaps({ rating: 5, rec: 6 }), 0.6);
eq('3,8 = 0,4', fattoreMaps({ rating: 3.8, rec: 200 }), 0.4);

console.log('\n== priorita\': fonte buona e vicina batte fonte debole, nome fuori target dimezza ==');
const stats = { 'maps:concept store': { giudicati: 22, ab: 14 }, 'maps:boutique donna': { giudicati: 19, ab: 3 } };
const cs = { nome: 'Nomad', citta: 'Milano', fonte_seed: 'maps:concept store', owner_note: '· 4,7 (80)' };
const bd = { nome: 'Boutique Anna', citta: 'Milano', fonte_seed: 'maps:boutique donna', owner_note: '· 4,7 (80)' };
const csLontano = { ...cs, citta: 'Genova' };
const sposa = { ...cs, nome: 'Atelier Sposa Nomad' };
eq('concept store > boutique donna', prioritaSeed(cs, stats) > prioritaSeed(bd, stats), true);
eq('Milano > Genova a parita\'', prioritaSeed(cs, stats) > prioritaSeed(csLontano, stats), true);
eq('nome "sposa" = meta\'', prioritaSeed(sposa, stats), Math.round(prioritaSeed(cs, stats) / 2 * 1000) / 1000);

console.log('\n== lotto: n rispettato, tetto per citta\', riempimento se il tetto lascia buchi ==');
const mk = (i, citta) => ({ id: `id${i}`, nome: `N${i}`, citta, fonte_seed: 'maps:concept store', owner_note: '· 4,7 (80)', created_at: `2026-09-10T00:00:${String(i).padStart(2, '0')}Z` });
const tuttiMilano = Array.from({ length: 10 }, (_, i) => mk(i, 'Milano'));
const misti = [...tuttiMilano, mk(20, 'Como'), mk(21, 'Pavia')];
const l1 = scegliLotto(misti, stats, 6, 3);
eq('lotto di 6', l1.length, 6);
eq('Como e Pavia entrano prima del 4o di Milano', l1.slice(0, 5).map((a) => a.citta).sort(), ['Como', 'Milano', 'Milano', 'Milano', 'Pavia']);
eq('solo Milano: il tetto non lascia il lotto corto', scegliLotto(tuttiMilano, stats, 6, 3).length, 6);
eq('a parita\' vince il seed piu\' vecchio', scegliLotto(tuttiMilano, stats, 1, 3)[0].id, 'id0');

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
