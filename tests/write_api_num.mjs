// tests/write_api_num.mjs — unit sul modulo PURO supabase/functions/write-api/lib.ts (audit gate 14-09, finding A5/B4).
//   node tests/write_api_num.mjs   (Node 24 strippa i tipi TS all'import)
//
// num() e isoDate() sono la rete di sicurezza che rende un numero/una data invalidi un 422, invece del vecchio
// Number(null)=0 (che azzerava un codice con una conta vuota) o new Date('14/09/2026') (che leggeva il mese sbagliato).
// Se qualcuno "semplifica" questi helper, i casi qui sotto lo dicono.
import { num, isoDate, todayRome, ymFromIso, tok, cnorm, VALID_CATEGORIE } from '../supabase/functions/write-api/lib.ts';

let ok = 0, ko = 0;
const eq = (name, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { ok++; console.log('  ok  ' + name); }
  else { ko++; console.log(`  KO  ${name}  atteso ${e}, ottenuto ${g}`); }
};

console.log('\n== num: rifiuta tutto cio\' che non e\' un numero finito ==');
eq('num(null)', num(null), null);
eq('num(undefined)', num(undefined), null);
eq("num('')", num(''), null);
eq("num('   ')", num('   '), null);
eq("num('12,50') (virgola)", num('12,50'), null);
eq("num('abc')", num('abc'), null);
eq('num([])', num([]), null);
eq('num({})', num({}), null);
eq('num(true)', num(true), null);
eq('num(false)', num(false), null);
eq('num(NaN)', num(NaN), null);
eq('num(Infinity)', num(Infinity), null);
eq("num('  3 ')", num('  3 '), 3);
eq('num(3)', num(3), 3);
eq("num('12.50')", num('12.50'), 12.5);
eq('num(-5)', num(-5), -5);
eq('num(0)', num(0), 0);

console.log('\n== num: vincoli integer / nonZero / min / max ==');
eq('num(2.5, {integer})', num(2.5, { integer: true }), null);
eq('num(3, {integer})', num(3, { integer: true }), 3);
eq('num(0, {nonZero})', num(0, { nonZero: true }), null);
eq('num(1, {nonZero})', num(1, { nonZero: true }), 1);
eq('num(-1, {min:0})', num(-1, { min: 0 }), null);
eq('num(0, {min:0})', num(0, { min: 0 }), 0);
eq("num('1.5', {min:0,max:1})", num('1.5', { min: 0, max: 1 }), null);
eq("num('0.5', {min:0,max:1})", num('0.5', { min: 0, max: 1 }), 0.5);
eq("num('', {min:0}) resta null", num('', { min: 0 }), null);
eq('num(50, {min:0,max:1}) (perc B2B 50 invece di 0,5)', num(50, { min: 0, max: 1 }), null);

console.log('\n== isoDate: solo YYYY-MM-DD di calendario ==');
eq("isoDate('2026-09-14')", isoDate('2026-09-14'), '2026-09-14');
eq("isoDate('2026-02-30') (giorno inesistente)", isoDate('2026-02-30'), null);
eq("isoDate('2026-02-29') (non bisestile)", isoDate('2026-02-29'), null);
eq("isoDate('2024-02-29') (bisestile)", isoDate('2024-02-29'), '2024-02-29');
eq("isoDate('2026-9-4') (non zero-padded)", isoDate('2026-9-4'), null);
eq("isoDate('14/09/2026')", isoDate('14/09/2026'), null);
eq("isoDate('2026-09-14T10:00')", isoDate('2026-09-14T10:00'), null);
eq("isoDate('2026-13-01') (mese 13)", isoDate('2026-13-01'), null);
eq('isoDate(null)', isoDate(null), null);
eq('isoDate(20260914)', isoDate(20260914), null);

console.log('\n== todayRome: data di Roma, mai UTC ==');
eq("00:30 CEST del 1/10 -> 2026-10-01", todayRome(new Date('2026-10-01T00:30:00+02:00')), '2026-10-01');
eq("22:30Z del 30/9 (00:30 Roma) -> 2026-10-01", todayRome(new Date('2026-09-30T22:30:00Z')), '2026-10-01');
eq("23:30Z del 31/1 (00:30 Roma) -> 2026-02-01", todayRome(new Date('2026-01-31T23:30:00Z')), '2026-02-01');
eq("12:00Z meta' giornata -> stesso giorno", todayRome(new Date('2026-06-15T12:00:00Z')), '2026-06-15');

console.log('\n== ymFromIso: dalla STRINGA, non da new Date() ==');
eq("ymFromIso('2026-10-01')", ymFromIso('2026-10-01'), { year: 2026, month: 10 });
eq("ymFromIso('2026-01-31')", ymFromIso('2026-01-31'), { year: 2026, month: 1 });

console.log('\n== tok / cnorm: stesso codice del server e del web ==');
eq("tok('Lea Bag')", tok('Lea Bag'), 'LEA_BAG');
eq("tok('Vernice-Nera')", tok('Vernice-Nera'), 'VERNICE_NERA');
eq("tok('Léa  Bag!')  (accenti + doppio spazio + punteggiatura)", tok('Léa  Bag!'), 'LEA_BAG');
eq("tok(\"L'Amie\")", tok("L'Amie"), 'L_AMIE');
eq("tok('__x__') (underscore ai bordi)", tok('__x__'), 'X');
eq("cnorm('lea bag rossa')", cnorm('lea bag rossa'), 'LEA_BAG_ROSSA');

console.log('\n== VALID_CATEGORIE: 8 voci, quelle vive in expenses ==');
eq('VALID_CATEGORIE.length', VALID_CATEGORIE.length, 8);
eq('contiene EVENTI', VALID_CATEGORIE.includes('EVENTI'), true);
eq('contiene COGS', VALID_CATEGORIE.includes('COGS'), true);
eq('NON contiene una inventata', VALID_CATEGORIE.includes('VARIE'), false);

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
