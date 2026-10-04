// tests/arrivo_adesso.mjs — nel pannello arrivi (Ordini) si scrive quanto e' arrivato ADESSO, non il totale (03-10).
//   node tests/arrivo_adesso.mjs   (Node 24 strippa i tipi TS all'import)
//
// Il campo chiedeva "Arrivati in totale" e mandava il numero cosi' com'era ad arrival_set: chi scriveva "10 arrivate
// oggi" su una riga con 20 gia' arrivate ne toglieva 10 dal magazzino (LEA BAG COCCO GREEN, 02-10), e su una riga con
// 10 gia' arrivate non caricava niente (COCCO BLACK, stesso giorno) con il toast "Arrivo salvato". Qui: la logica pura
// (pianoArrivo) e le cinture del pannello sul sorgente, perche' chi "semplifica" Ordini.tsx non riporti il totale.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pianoArrivo } from '../web/src/lib/helpers.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');

let ok = 0, ko = 0;
const eq = (name, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { ok++; console.log('  ok  ' + name); }
  else { ko++; console.log(`  KO  ${name}  atteso ${e}, ottenuto ${g}`); }
};
const t = (name, c) => { if (c) { ok++; console.log('  ok  ' + name); } else { ko++; console.log('  KO  ' + name); } };

console.log("\n== modo 'adesso': il numero si SOMMA al gia' arrivato ==");
eq('COCCO GREEN 02-10: 20 gia arrivate, 10 adesso -> totale 30, +10', pianoArrivo('adesso', '10', 20), { ok: true, target: 30, delta: 10 });
eq('COCCO BLACK 02-10: 10 gia arrivate, 10 adesso -> totale 20, +10', pianoArrivo('adesso', '10', 10), { ok: true, target: 20, delta: 10 });
eq('primo arrivo: 0 gia arrivate, 8 adesso -> totale 8', pianoArrivo('adesso', '8', 0), { ok: true, target: 8, delta: 8 });
eq('spazi intorno al numero tollerati', pianoArrivo('adesso', ' 3 ', 5), { ok: true, target: 8, delta: 3 });
for (const [g, v] of [[0, '1'], [20, '10'], [7, '250']]) {
  const p = pianoArrivo('adesso', v, g);
  t(`in 'adesso' il delta e' sempre > 0 (gia ${g}, adesso ${v})`, p.ok && p.delta > 0 && p.target > g);
}

console.log("\n== modo 'adesso': input che non e' un arrivo -> rifiutato, mai un numero indovinato ==");
for (const v of ['', ' ', '0', '-3', '2.5', '2,5', 'abc', '1e2', '+4', '10000', '99999999999999999999']) {
  t(`'${v}' rifiutato`, pianoArrivo('adesso', v, 20).ok === false);
}

console.log("\n== modo 'totale' (correzione): il numero E' il totale, il delta puo' essere negativo o zero ==");
eq('correzione al ribasso: da 20 a 10 -> delta -10', pianoArrivo('totale', '10', 20), { ok: true, target: 10, delta: -10 });
eq('azzeramento prima di eliminare la riga: da 6 a 0', pianoArrivo('totale', '0', 6), { ok: true, target: 0, delta: -6 });
eq('totale invariato (solo costo o data): delta 0', pianoArrivo('totale', '10', 10), { ok: true, target: 10, delta: 0 });
eq('correzione al rialzo: da 3 a 5 -> delta +2', pianoArrivo('totale', '5', 3), { ok: true, target: 5, delta: 2 });
eq('9999 resta un numero accettato', pianoArrivo('adesso', '9999', 0), { ok: true, target: 9999, delta: 9999 });
for (const v of ['', '-1', '1.5', 'x', '10000']) t(`totale '${v}' rifiutato`, pianoArrivo('totale', v, 10).ok === false);

console.log('\n== cinture del pannello sul sorgente (web/src/pages/Ordini.tsx, web/src/lib/api.ts) ==');
{
  const ORD = read('web/src/pages/Ordini.tsx');
  const API = read('web/src/lib/api.ts');
  t("il campo non chiede piu' 'Arrivati in totale'", !/Arrivati in totale/.test(ORD));
  t("l'etichetta di default e' 'Arrivati adesso'", /'Arrivati adesso'/.test(ORD));
  t("una riga aperta parte in modo 'adesso'", /const modoBase: ModoArrivo = done \? 'totale' : 'adesso';/.test(ORD) && /useState<ModoArrivo>\(modoBase\)/.test(ORD));
  t('al server va il target calcolato da pianoArrivo, non il campo', /setArrival\(l\.id, target, /.test(ORD) && !/setArrival\(l\.id, Number\(n\)/.test(ORD));
  t('la riga viene riletta subito prima della scrittura', /const vivo = await fetchOrderArrived\(l\.id\);\s*\n\s*if \(vivo !== gia\) return toast\(/.test(ORD));
  t('una correzione al ribasso chiede conferma', /modo === 'totale' && delta < 0\s*\n\s*&& !window\.confirm\(/.test(ORD));
  t("un 'adesso' che supera l'ordinato chiede conferma", /modo === 'adesso' && ordinati != null && target > ordinati\s*\n\s*&& !window\.confirm\(/.test(ORD));
  const i = API.indexOf('export async function fetchOrderArrived');
  const FN = i < 0 ? '' : API.slice(i, API.indexOf('\n}\n', i));
  t('fetchOrderArrived esiste', FN.length > 0);
  t('fetchOrderArrived destruttura error e si ferma (Regola 20a)', /const \{ data, error \} = await supabase/.test(FN) && /if \(error\) throw new Error/.test(FN));
  t('fetchOrderArrived non ha un default numerico (niente || 0, niente ?? 0)', FN.length > 0 && !/(\|\||\?\?) 0/.test(FN));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
