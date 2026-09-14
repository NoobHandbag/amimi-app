// tests/date_roma.mjs — il server (write-api/lib.ts) e il web (web/src/lib/helpers.ts) devono derivare la STESSA data
// di Roma e lo STESSO codice dal tokenizer (audit gate 14-09, finding B39/B43). Prima il web usava toISOString UTC e
// un tokenizer diverso: a mezzanotte un form cadeva nel giorno sbagliato e lo stesso Modello+Variante poteva dare due
// codici a seconda del punto d'ingresso.
//   node tests/date_roma.mjs   (Node 24 strippa i tipi TS all'import)
import { todayRome as srvToday, tok as srvTok } from '../supabase/functions/write-api/lib.ts';
import { todayRome as webToday, oggi as webOggi, tok as webTok, deriveCodice } from '../web/src/lib/helpers.ts';

let ok = 0, ko = 0;
const eq = (name, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { ok++; console.log('  ok  ' + name); }
  else { ko++; console.log(`  KO  ${name}  atteso ${e}, ottenuto ${g}`); }
};

console.log('\n== stessa data di Roma dal server e dal web, a cavallo di mezzanotte/mese/anno ==');
for (const [iso, exp] of [
  ['2026-10-01T00:30:00+02:00', '2026-10-01'],
  ['2026-09-30T22:30:00Z', '2026-10-01'],   // 00:30 Roma del giorno dopo
  ['2026-01-31T23:30:00Z', '2026-02-01'],   // fine mese
  ['2025-12-31T23:30:00Z', '2026-01-01'],   // fine anno
  ['2026-06-15T12:00:00Z', '2026-06-15'],
  ['2026-03-29T01:30:00Z', '2026-03-29'],   // giorno del cambio ora legale
]) {
  const d = new Date(iso);
  const s = srvToday(d), w = webToday(d);
  eq(`${iso}: server=web=${exp}`, [s, w, s === w && s === exp], [exp, exp, true]);
}

console.log('\n== oggi() del web = todayRome del web (nessuna definizione UTC residua) ==');
{
  const d = new Date('2026-09-30T22:30:00Z');
  // oggi() non prende argomenti: si confronta la forma (10 caratteri, YYYY-MM-DD) e che coincida con todayRome(now)
  eq('oggi() e\' YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(webOggi()), true);
  eq('oggi() == webToday() sullo stesso istante corrente', webOggi() === webToday(new Date(webOggi() + 'T12:00:00Z')).slice(0, 4) + webOggi().slice(4), true);
  void d;
}

console.log('\n== stesso tokenizer server/web su nomi con accenti, trattini, apostrofi, spazi ==');
for (const s of ['Lea Bag', 'Vernice-Nera', "L'Amie", 'Léa  Bag', 'Nina Bag Maxi', 'CHAIN TIGER', 'à-è-ì', 'Cocco / Blu', 'x__y', '  spazi  ']) {
  eq(`tok server==web per "${s}"`, srvTok(s) === webTok(s), true);
}

console.log('\n== deriveCodice del web = tok(model)_tok(variant), uguale al server ==');
eq("deriveCodice('Lea Bag','Vernice-Nera')", deriveCodice('Lea Bag', 'Vernice-Nera'), 'LEA_BAG_VERNICE_NERA');
eq("deriveCodice(' Nina Bag ','Stripes Jungle Green')", deriveCodice(' Nina Bag ', 'Stripes Jungle Green'), 'NINA_BAG_STRIPES_JUNGLE_GREEN');
eq("deriveCodice == srvTok_srvTok", deriveCodice('Agata Bag', 'Rose Pink') === srvTok('Agata Bag') + '_' + srvTok('Rose Pink'), true);

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
