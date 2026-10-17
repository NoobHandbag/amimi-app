// tests/villaggio_paillettes.mjs: le Paillettes del Villaggio (fase 2, 16-10), cioe' la logica pura di
// web/src/lib/villaggio/paillettes.ts: calcola (punti, livello, serie, medaglie), missioni e differenza.
//   node tests/villaggio_paillettes.mjs   (Node 24 strippa i tipi TS all'import; nessuna rete, gira offline in CI)
//
// I punti non si salvano: si ricalcolano dagli eventi della vista v_villaggio_eventi. Quindi tutto il gioco sta nelle
// regole e nei tetti di calcola(): qui li proviamo uno per uno con eventi costruiti a mano (presenza una volta al giorno,
// weekend che non rompe la serie, settimana piena solo 5 su 5, ordine con 0 righe che non vale, arrivo una volta per riga
// e giorno, verifica una volta per fornitore e settimana ISO, data una volta per riga, conta una volta per codice e
// giorno, conta completa all'80% in 7 giorni al massimo una volta al mese), poi i confini dei livelli, le medaglie, le
// missioni e la differenza fra due letture. In fondo la taratura: gli eventi VERI di Ginevra dal 17-08 (copia datata).
//
// Calendario usato: lunedi' 2026-10-12 ... venerdi' 2026-10-16, sabato 17, domenica 18, lunedi' 19.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calcola, missioni, differenza, VALORI, LIVELLI, MEDAGLIE } from '../web/src/lib/villaggio/paillettes.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');

let ok = 0, ko = 0;
const eq = (name, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { ok++; console.log('  ok  ' + name); }
  else { ko++; console.log(`  KO  ${name}  atteso ${e}, ottenuto ${g}`); }
};
const t = (name, c) => { if (c) { ok++; console.log('  ok  ' + name); } else { ko++; console.log('  KO  ' + name); } };
const nota = (s) => console.log('  --  ' + s);

// evento a mano: ts = giorno + ora (UTC, basta per l'ordine), ref e n come nella vista
const E = (tipo, giorno, ref = '', n = 1, ora = '10:00:00') => ({ tipo, giorno, ts: `${giorno}T${ora}Z`, ref, n });
const P = (giorno, ora) => E('presenza', giorno, giorno, 1, ora);
const C = (oggi, ...eventi) => calcola(eventi.flat(), oggi, []);
const tot = (oggi, ...eventi) => C(oggi, ...eventi).totale;
const LUN = '2026-10-12', MAR = '2026-10-13', MER = '2026-10-14', GIO = '2026-10-15', VEN = '2026-10-16';
const SAB = '2026-10-17', DOM = '2026-10-18', LUN2 = '2026-10-19';
const SETTIMANA = [LUN, MAR, MER, GIO, VEN];
// giorni lavorativi consecutivi a partire da un lunedi' (salta sabato e domenica)
const lavorativi = (da, quanti) => {
  const out = [];
  for (let d = Date.parse(da + 'T00:00:00Z'); out.length < quanti; d += 86400000) {
    const w = new Date(d).getUTCDay();
    if (w !== 0 && w !== 6) out.push(new Date(d).toISOString().slice(0, 10));
  }
  return out;
};

console.log('\n== VALORI e LIVELLI come da contratto ==');
eq('VALORI', VALORI, { presenza: 5, settimanaPiena: 50, ordine: 20, rigaOrdine: 5, arrivo: 10, verifica: 50, conta: 2, contaCompleta: 500, dataAggiunta: 15 });
eq('LIVELLI', LIVELLI.map((l) => [l.nome, l.da]), [['Stagista', 0], ['Junior', 300], ['Production Assistant', 1000], ['Coordinator', 2500],
  ['Production Manager', 5000], ['Head of Production', 9000], ['Executive Queen of Fashion Production', 15000]]);
eq('MEDAGLIE: gli 8 id del contratto', MEDAGLIE.map((m) => m.id), ['prima-presenza', 'settimana-perfetta', 'prima-verifica',
  'tutti-i-laboratori', 'prima-conta-completa', 'cento-arrivi', 'serie-20', 'date-a-posto']);
t('ogni medaglia ha nome e descrizione', MEDAGLIE.every((m) => m.nome && m.descrizione && typeof m.regola === 'function'));

console.log('\n== presenza: 1 al giorno, anche nel weekend ==');
eq('una presenza = 5', tot(VEN, P(VEN)), 5);
eq('due presenze lo stesso giorno = 5 e una sola voce', [tot(VEN, P(VEN, '08:00:00'), P(VEN, '15:00:00')),
  C(VEN, P(VEN, '08:00:00'), P(VEN, '15:00:00')).voci.length], [5, 1]);
eq('presenza di sabato vale i suoi 5', tot(SAB, P(SAB)), 5);
eq('voce della presenza', C(VEN, P(VEN)).voci[0], { giorno: VEN, ts: VEN + 'T10:00:00Z', tipo: 'presenza', ref: VEN, punti: 5, testo: 'Presenza' });

console.log('\n== serie: giorni lavorativi consecutivi, il weekend non la rompe ==');
eq('venerdi\' + lunedi\' = serie 2', C(LUN2, P(VEN), P(LUN2)).serie, 2);
eq('venerdi\' + sabato + lunedi\' = serie 2 (il sabato non conta) e 15 punti', [C(LUN2, P(VEN), P(SAB), P(LUN2)).serie,
  tot(LUN2, P(VEN), P(SAB), P(LUN2))], [2, 15]);
eq('giovedi\', venerdi\' saltato, lunedi\' = serie 1', C(LUN2, P(GIO), P(LUN2)).serie, 1);
eq('lun-gio presenti, oggi venerdi\' non ancora: serie 4 (oggi non e\' finito)', C(VEN, SETTIMANA.slice(0, 4).map((g) => P(g))).serie, 4);
eq('lun-gio presenti, venerdi\' mancato, oggi lunedi\' non ancora: serie 0', C(LUN2, SETTIMANA.slice(0, 4).map((g) => P(g))).serie, 0);
eq('lun-ven presenti, oggi sabato: serie 5', C(SAB, SETTIMANA.map((g) => P(g))).serie, 5);
eq('lun-ven presenti, oggi domenica e presenza sabato: serie 5', C(DOM, SETTIMANA.map((g) => P(g)), P(SAB)).serie, 5);
eq('nessuna presenza: serie 0', C(VEN).serie, 0);

console.log('\n== settimana: i pallini lun-ven della settimana di oggi ==');
eq('lunedi\' e mercoledi\', oggi mercoledi\'', C(MER, P(LUN), P(MER)).settimana, [true, false, true, false, false]);
eq('stessa settimana vista di domenica', C(DOM, P(LUN), P(MER), P(DOM)).settimana, [true, false, true, false, false]);
eq('lunedi\' dopo: settimana nuova, tutta vuota', C(LUN2, P(LUN), P(MER)).settimana, [false, false, false, false, false]);

console.log('\n== settimana piena: +50 solo a 5 su 5 ==');
eq('4 su 5 + sabato: nessun premio (25)', tot(SAB, SETTIMANA.slice(0, 4).map((g) => P(g)), P(SAB)), 25);
eq('5 su 5: 25 + 50', tot(VEN, SETTIMANA.map((g) => P(g))), 75);
{
  const s = C(VEN, SETTIMANA.map((g) => P(g)));
  eq('il premio e\' la voce piu\' recente, sopra la presenza di venerdi\'', s.voci.slice(0, 2).map((v) => [v.tipo, v.giorno, v.ref, v.punti]),
    [['settimana_piena', VEN, LUN, 50], ['presenza', VEN, VEN, 5]]);
  eq('testo del premio', s.voci[0].testo, 'Settimana piena!');
}
eq('due settimane piene: 2 premi', tot(LUN2, SETTIMANA.map((g) => P(g)), lavorativi(LUN2, 5).map((g) => P(g))), 50 + 50 + 50);
eq('presenza doppia il venerdi\' non raddoppia il premio', tot(VEN, SETTIMANA.map((g) => P(g)), P(VEN, '18:00:00')), 75);

console.log('\n== ordine: 20 + 5 per riga, solo se ha ancora righe ==');
eq('ordine con 0 righe (tutto cancellato) = 0 e nessuna voce', [tot(VEN, E('ordine', VEN, 'g1', 0)), C(VEN, E('ordine', VEN, 'g1', 0)).voci.length], [0, 0]);
eq('ordine con 3 righe = 35', tot(VEN, E('ordine', VEN, 'g1', 3)), 35);
eq('testo con 3 righe e con 1 riga', [C(VEN, E('ordine', VEN, 'g1', 3)).voci[0].testo, C(VEN, E('ordine', VEN, 'g1', 1)).voci[0].testo],
  ['Ordine · 3 righe', 'Ordine · 1 riga']);
eq('due ordini lo stesso giorno contano entrambi (nessun tetto: le righe sono vere)', tot(VEN, E('ordine', VEN, 'g1', 1), E('ordine', VEN, 'g2', 1)), 50);

console.log('\n== arrivo: 10 per riga, una volta per (riga, giorno) ==');
eq('stessa riga due volte lo stesso giorno = 10', tot(VEN, E('arrivo', VEN, 'r1', 5, '09:00:00'), E('arrivo', VEN, 'r1', 3, '11:00:00')), 10);
eq('stessa riga in due giorni = 20', tot(VEN, E('arrivo', GIO, 'r1', 5), E('arrivo', VEN, 'r1', 3)), 20);
eq('due righe lo stesso giorno = 20', tot(VEN, E('arrivo', VEN, 'r1', 5), E('arrivo', VEN, 'r2', 3)), 20);
eq('testo con i pezzi', C(VEN, E('arrivo', VEN, 'r1', 12)).voci[0].testo, 'Arrivo registrato · 12 pz');

console.log('\n== verifica: 50, una volta per (fornitore, settimana ISO), solo con righe confermate ==');
const FR = 'Francesco (pelle)', SA = 'Sarte Milano (tessuto)', VI = 'Vincenzo (pelle)', FI = 'Fiorella (tessuto)';
eq('lunedi\' e venerdi\' stesso fornitore = 50', tot(VEN, E('verifica', LUN, FR, 3), E('verifica', VEN, FR, 3)), 50);
eq('domenica e\' ancora la stessa settimana ISO = 50', tot(DOM, E('verifica', LUN, FR, 3), E('verifica', DOM, FR, 3)), 50);
eq('lunedi\' dopo = settimana nuova = 100', tot(LUN2, E('verifica', LUN, FR, 3), E('verifica', LUN2, FR, 3)), 100);
eq('verifica senza righe confermate = 0', tot(VEN, E('verifica', VEN, FR, 0)), 0);
eq('una verifica a 0 non consuma la settimana: dopo, con 2 confermate = 50', tot(VEN, E('verifica', LUN, FR, 0), E('verifica', MER, FR, 2)), 50);
eq('due fornitori la stessa settimana = 100', tot(VEN, E('verifica', LUN, FR, 3), E('verifica', LUN, SA, 1)), 100);
eq('testo col nome del laboratorio', [C(VEN, E('verifica', VEN, FR, 3)).voci[0].testo, C(VEN, E('verifica', VEN, SA, 1)).voci[0].testo],
  ['Verifica con Francesco · 3 righe confermate', 'Verifica con Sarte Milano · 1 riga confermata']);

console.log('\n== data aggiunta: 15 per riga, una volta per riga in assoluto ==');
eq('stessa riga in due giorni = 15', tot(VEN, E('data_aggiunta', LUN, 'r1'), E('data_aggiunta', VEN, 'r1')), 15);
eq('stessa riga a mesi di distanza = 15', tot(VEN, E('data_aggiunta', '2026-08-03', 'r1'), E('data_aggiunta', VEN, 'r1')), 15);
eq('due righe = 30', tot(VEN, E('data_aggiunta', VEN, 'r1'), E('data_aggiunta', VEN, 'r2')), 30);

console.log('\n== conta: 2 per codice, una volta per (codice, giorno) ==');
eq('stesso codice due volte lo stesso giorno = 2', tot(VEN, E('conta', VEN, 'LEA', 1, '09:00:00'), E('conta', VEN, 'LEA', 1, '09:05:00')), 2);
eq('stesso codice il giorno dopo = 4', tot(VEN, E('conta', GIO, 'LEA'), E('conta', VEN, 'LEA')), 4);
eq('due codici lo stesso giorno = 4', tot(VEN, E('conta', VEN, 'LEA'), E('conta', VEN, 'NINA')), 4);

console.log('\n== conta completa: +500 quando 7 giorni di conte coprono l\'80% della base, al massimo una volta al mese ==');
{
  const BASE = Array.from({ length: 10 }, (_, i) => 'B' + i);
  const conte = (giorno, codici, ora0 = 9) => codici.map((c, i) => E('conta', giorno, c, 1, `${String(ora0 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`));
  const K = (ev, oggi = '2026-11-30', base = BASE) => calcola(ev.flat(), oggi, base);
  const complete = (s) => s.voci.filter((v) => v.tipo === 'conta_completa');
  eq('7 codici su 10 lo stesso giorno: niente (14)', [K([conte('2026-10-01', BASE.slice(0, 7))]).totale, complete(K([conte('2026-10-01', BASE.slice(0, 7))])).length], [14, 0]);
  {
    const s = K([conte('2026-10-01', BASE.slice(0, 8))]);
    eq('8 su 10: 16 + 500', s.totale, 516);
    eq('la voce cade sul giorno e sull\'evento che supera la soglia (l\'ottavo codice)', complete(s).map((v) => [v.giorno, v.ts, v.ref, v.punti, v.testo]),
      [['2026-10-01', '2026-10-01T09:07:00Z', '2026-10', 500, 'Conta completa!']]);
    eq('ed e\' sopra la conta che la fa scattare', s.voci.slice(0, 2).map((v) => v.tipo), ['conta_completa', 'conta']);
  }
  eq('4 il 01-10 e 4 il 07-10: dentro i 7 giorni (01..07) = premio', complete(K([conte('2026-10-01', BASE.slice(0, 4)), conte('2026-10-07', BASE.slice(4, 8))])).map((v) => v.giorno), ['2026-10-07']);
  eq('4 il 01-10 e 4 il 08-10: fuori finestra = niente', complete(K([conte('2026-10-01', BASE.slice(0, 4)), conte('2026-10-08', BASE.slice(4, 8))])).length, 0);
  eq('ricontare lo stesso codice non allarga la copertura', complete(K([conte('2026-10-01', BASE.slice(0, 7)), conte('2026-10-02', BASE.slice(0, 7))])).length, 0);
  eq('codici fuori dalla base (giacenza 0) non contano per la soglia, ma valgono i loro 2', [complete(K([conte('2026-10-01', [...BASE.slice(0, 7), 'Z1', 'Z2', 'Z3'])])).length,
    K([conte('2026-10-01', [...BASE.slice(0, 7), 'Z1', 'Z2', 'Z3'])]).totale], [0, 20]);
  eq('due giri completi nello stesso mese: un solo premio', complete(K([conte('2026-10-01', BASE), conte('2026-10-20', BASE)])).length, 1);
  eq('un giro a ottobre e uno a novembre: due premi', complete(K([conte('2026-10-01', BASE), conte('2026-11-02', BASE)])).map((v) => v.ref), ['2026-11', '2026-10']);
  eq('finestra a cavallo del mese: conta per il mese del giorno in cui si supera la soglia', complete(K([conte('2026-10-05', BASE),
    conte('2026-10-30', BASE.slice(0, 4)), conte('2026-11-02', BASE.slice(4, 8))])).map((v) => v.giorno), ['2026-11-02', '2026-10-05']);
  eq('base vuota: mai', complete(K([conte('2026-10-01', BASE)], '2026-10-01', [])).length, 0);
  const B7 = BASE.slice(0, 7);
  eq('base di 7: 5 contati (71%) niente, 6 (86%) premio', [complete(K([conte('2026-10-01', B7.slice(0, 5))], '2026-10-01', B7)).length,
    complete(K([conte('2026-10-01', B7.slice(0, 6))], '2026-10-01', B7)).length], [0, 1]);
  eq('base di 5: 4 contati = esattamente 80% = premio', complete(K([conte('2026-10-01', BASE.slice(0, 4))], '2026-10-01', BASE.slice(0, 5))).length, 1);
}

console.log('\n== livelli: confini, prossimo e frazione ==');
{
  // eventi che fanno esattamente T punti: conte (2 l'una) per il resto modulo 5, poi un ordine da 20 + 5n
  const perTotale = (T) => {
    if (!T) return [];
    const c = ((T % 5) * 3) % 5;
    return [...Array.from({ length: c }, (_, i) => E('conta', VEN, 'K' + i)), E('ordine', VEN, 'g', (T - 2 * c - 20) / 5)];
  };
  const S = (T) => calcola(perTotale(T), VEN, []);
  for (const [T, i] of [[0, 0], [299, 0], [300, 1], [999, 1], [1000, 2], [2499, 2], [2500, 3], [4999, 3], [5000, 4], [8999, 4],
    [9000, 5], [14999, 5], [15000, 6], [40000, 6]]) {
    const s = S(T);
    eq(`${T} paillettes -> ${LIVELLI[i].nome}`, [s.totale, s.livello, s.nomeLivello], [T, i, LIVELLI[i].nome]);
  }
  eq('a 299 il prossimo e\' Junior da 300', S(299).prossimo, { nome: 'Junior', da: 300 });
  eq('a 15000 nessun prossimo', S(15000).prossimo, null);
  eq('frazione: 0 a 0, 0.5 a 150, 0 a 300, 0.5 a 650, 1 in cima', [S(0).frazione, S(150).frazione, S(300).frazione, S(650).frazione, S(15000).frazione, S(40000).frazione],
    [0, 0.5, 0, 0.5, 1, 1]);
  eq('frazione a 14999 = 5999/6000', S(14999).frazione, 5999 / 6000);
  t('frazione sempre fra 0 e 1', [0, 1, 299, 300, 2501, 9999, 14999, 15000, 99999].every((T) => { const f = S(T).frazione; return f >= 0 && f <= 1; }));
}

console.log('\n== oggi: solo le paillettes del giorno ==');
eq('ieri 35 + oggi 10 + 5', C(VEN, E('ordine', GIO, 'g1', 3), E('arrivo', VEN, 'r1', 2), P(VEN)).oggi, 15);
eq('il premio settimana piena del venerdi\' conta in oggi', C(VEN, SETTIMANA.map((g) => P(g))).oggi, 55);

console.log('\n== medaglie ==');
{
  const ids = (...eventi) => C('2026-12-31', ...eventi).medaglie.map((m) => m.id);
  const ha = (id, ...eventi) => ids(...eventi).includes(id);
  eq('nessun evento, nessuna medaglia', ids(), []);
  t('prima-presenza con una presenza', ha('prima-presenza', P(VEN)));
  t('settimana-perfetta: no a 4 su 5 + sabato', !ha('settimana-perfetta', SETTIMANA.slice(0, 4).map((g) => P(g)), P(SAB)));
  t('settimana-perfetta: si\' a 5 su 5', ha('settimana-perfetta', SETTIMANA.map((g) => P(g))));
  t('prima-verifica: no con 0 righe confermate', !ha('prima-verifica', E('verifica', VEN, FR, 0)));
  t('prima-verifica: si\' con 1', ha('prima-verifica', E('verifica', VEN, FR, 1)));
  t('tutti-i-laboratori: 4 fornitori nella stessa settimana', ha('tutti-i-laboratori', [FR, SA, VI, FI].map((f, i) => E('verifica', SETTIMANA[i], f, 1))));
  t('tutti-i-laboratori: no con 3 + 1 la settimana dopo', !ha('tutti-i-laboratori', [FR, SA, VI].map((f) => E('verifica', LUN, f, 1)), E('verifica', LUN2, FI, 1)));
  t('tutti-i-laboratori: no se uno dei 4 non ha righe confermate', !ha('tutti-i-laboratori', [FR, SA, VI].map((f) => E('verifica', LUN, f, 1)), E('verifica', LUN, FI, 0)));
  t('tutti-i-laboratori: no con lo stesso fornitore 4 volte', !ha('tutti-i-laboratori', SETTIMANA.slice(0, 4).map((g) => E('verifica', g, FR, 1))));
  {
    const B = ['A', 'B', 'C', 'D', 'E'];
    t('prima-conta-completa', calcola(B.map((c) => E('conta', VEN, c)), VEN, B).medaglie.some((m) => m.id === 'prima-conta-completa'));
    t('prima-conta-completa: no sotto soglia', !calcola(B.slice(0, 3).map((c) => E('conta', VEN, c)), VEN, B).medaglie.some((m) => m.id === 'prima-conta-completa'));
  }
  const righeArrivate = (n) => Array.from({ length: n }, (_, i) => E('arrivo', VEN, 'r' + i, 1));
  t('cento-arrivi: 100 righe', ha('cento-arrivi', righeArrivate(100)));
  t('cento-arrivi: 99 righe no', !ha('cento-arrivi', righeArrivate(99)));
  t('cento-arrivi: 100 eventi ma uno doppio nello stesso giorno no', !ha('cento-arrivi', righeArrivate(99), E('arrivo', VEN, 'r0', 1, '18:00:00')));
  t('cento-arrivi: la stessa riga in 100 giorni diversi si\' (100 arrivi)', ha('cento-arrivi', Array.from({ length: 100 }, (_, i) =>
    E('arrivo', new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86400000).toISOString().slice(0, 10), 'r0', 1))));
  t('serie-20: 20 giorni lavorativi di fila', ha('serie-20', lavorativi('2026-09-21', 20).map((g) => P(g))));
  t('serie-20: 19 no', !ha('serie-20', lavorativi('2026-09-21', 19).map((g) => P(g))));
  t('serie-20: presa una volta resta anche se la serie poi si rompe', ha('serie-20', lavorativi('2026-09-21', 20).map((g) => P(g)), P('2026-11-02')));
  t('serie-20: i weekend presenti non allungano la serie (15 lavorativi + 6 weekend = no)', !ha('serie-20', lavorativi('2026-09-21', 15).map((g) => P(g)),
    ['2026-09-26', '2026-09-27', '2026-10-03', '2026-10-04', '2026-10-10', '2026-10-11'].map((g) => P(g))));
  const date = (n) => Array.from({ length: n }, (_, i) => E('data_aggiunta', VEN, 'r' + i));
  t('date-a-posto: 10 righe', ha('date-a-posto', date(10)));
  t('date-a-posto: 9 no', !ha('date-a-posto', date(9)));
  t('date-a-posto: 10 eventi sulla stessa riga no', !ha('date-a-posto', Array.from({ length: 10 }, (_, i) => E('data_aggiunta', lavorativi(LUN, 10)[i], 'r0'))));
  eq('in ordine di MEDAGLIE', ids(date(10), P(VEN), E('verifica', VEN, FR, 1)), ['prima-presenza', 'prima-verifica', 'date-a-posto']);
}

console.log('\n== missioni: al massimo 3, verifica > conta > date; guidano, non danno punti ==');
{
  const R = (late, ok) => [...Array(late).fill({ late: true, wip: false }), ...Array(ok).fill({ late: false, wip: false })];
  const lab = (forn, nome, late, ok, senzaData) => ({ key: forn ?? '', nome, forn, righe: R(late, ok), senzaData });
  const LF = lab(FR, 'Francesco', 5, 7, 7), LS = lab(SA, 'Sarte Milano', 4, 4, 4), LV = lab(VI, 'Vincenzo', 0, 2, 2), LFI = lab(FI, 'Fiorella', 0, 1, 1);
  const LX = lab(null, 'Senza fornitore', 9, 0, 9);
  const LABS = [LX, LV, LS, LF, LFI];
  const M = (eventi = [], negativi = [], labs = LABS, oggi = VEN) => missioni({ labs, negativi, eventi, oggi });
  const forma = (ms) => ms.map((m) => [m.id, m.testo, m.azione, m.fatta]);
  eq('niente di fatto, 2 negativi: le 3 missioni in ordine', forma(M([], ['N1', 'N2'])), [
    ['verifica:' + FR, 'Verifica con Francesco · 5 righe in ritardo', { t: 'verifica', lab: FR }, false],
    ['conta-negativi', 'Conta i 2 codici negativi', { t: 'conta', codici: ['N1', 'N2'] }, false],
    ['date:' + SA, 'Chiedi a Sarte Milano la data di 4 righe', { t: 'verifica', lab: SA }, false],
  ]);
  t('il laboratorio senza fornitore non e\' mai una missione', !M([], ['N1']).some((m) => m.azione.t === 'verifica' && m.azione.lab === ''));
  eq('Francesco verificato lunedi\': tocca a Sarte, e le date a Vincenzo', M([E('verifica', LUN, FR, 3)]).map((m) => m.id), ['verifica:' + SA, 'date:' + VI]);
  eq('Francesco verificato la settimana scorsa: torna in cima', M([E('verifica', '2026-10-09', FR, 3)]).map((m) => m.id), ['verifica:' + FR, 'date:' + SA]);
  eq('una verifica a 0 righe confermate e\' comunque una verifica (la missione e\' passare le righe)', M([E('verifica', LUN, FR, 0)])[0].id, 'verifica:' + SA);
  {
    const dopo = [lab(FR, 'Francesco', 0, 12, 0), LS, LV, LFI];
    eq('Francesco verificato oggi, date spostate (ritardi a 0): la missione resta sua, fatta', forma(M([E('verifica', VEN, FR, 12)], [], dopo))[0],
      ['verifica:' + FR, 'Verifica con Francesco', { t: 'verifica', lab: FR }, true]);
    eq('e la missione date passa al prossimo laboratorio', M([E('verifica', VEN, FR, 12)], [], dopo)[1].id, 'date:' + SA);
  }
  eq('verificato oggi un altro laboratorio: e\' quello la missione verifica, fatta', forma(M([E('verifica', VEN, VI, 2)]))[0],
    ['verifica:' + VI, 'Verifica con Vincenzo', { t: 'verifica', lab: VI }, true]);
  eq('due verificati oggi: verifica e date tutte e due fatte', M([E('verifica', VEN, FR, 3), E('verifica', VEN, SA, 2)]).map((m) => [m.id, m.fatta]),
    [['verifica:' + FR, true], ['date:' + SA, true]]);
  eq('verifica di ieri non fa "fatta" oggi, ma toglie il laboratorio per la settimana', M([E('verifica', GIO, SA, 2)]).map((m) => [m.id, m.fatta]),
    [['verifica:' + FR, false], ['date:' + VI, false]]);
  eq('conta: fatta quando tutti i negativi sono contati oggi', [M([E('conta', VEN, 'N1')], ['N1', 'N2'])[1].fatta,
    M([E('conta', VEN, 'N1'), E('conta', VEN, 'N2')], ['N1', 'N2'])[1].fatta, M([E('conta', GIO, 'N1'), E('conta', GIO, 'N2')], ['N1', 'N2'])[1].fatta], [false, true, false]);
  eq('niente negativi, niente missione conta', M([], []).some((m) => m.id === 'conta-negativi'), false);
  eq('singolari', forma(missioni({ labs: [lab(FR, 'Francesco', 1, 0, 0), lab(SA, 'Sarte Milano', 0, 1, 1)], negativi: ['N1'], eventi: [], oggi: VEN })).map((m) => m[1]),
    ['Verifica con Francesco · 1 riga in ritardo', 'Conta il codice negativo', 'Chiedi a Sarte Milano la data di 1 riga']);
  eq('nessun ritardo: niente missione verifica, resta quella delle date', M([], [], [LV, LFI]).map((m) => m.id), ['date:' + VI]);
  eq('ritardi pari: vince il nome in ordine alfabetico', missioni({ labs: [lab(SA, 'Sarte Milano', 2, 0, 0), lab(FR, 'Francesco', 2, 0, 0)], negativi: [], eventi: [], oggi: VEN })[0].id,
    'verifica:' + FR);
  eq('tutto a posto: nessuna missione', missioni({ labs: [lab(FR, 'Francesco', 0, 3, 0)], negativi: [], eventi: [], oggi: VEN }), []);
  t('mai piu\' di 3', M([], ['N1', 'N2', 'N3']).length <= 3);
  eq('le missioni non toccano i punti: stessi eventi, stesso totale', tot(VEN, E('verifica', VEN, FR, 3)), 50);
  eq('di lunedi\' la settimana riparte: Francesco verificato venerdi\' torna in cima', missioni({ labs: LABS, negativi: [], eventi: [E('verifica', VEN, FR, 3)], oggi: LUN2 })[0].id,
    'verifica:' + FR);
}

console.log('\n== differenza fra due letture ==');
{
  const S = (...ev) => C(VEN, ...ev);
  eq('prima lettura (prima = null): niente da festeggiare', differenza(null, S(P(VEN), E('ordine', VEN, 'g', 60))), { punti: 0, livelloNuovo: null, medaglieNuove: [] });
  const a = S(E('ordine', VEN, 'g', 54)), b = S(E('ordine', VEN, 'g', 54), E('arrivo', VEN, 'r1', 2));  // 290 -> 300
  eq('290 -> 300: +10 e Junior', [a.totale, b.totale, differenza(a, b).punti, differenza(a, b).livelloNuovo], [290, 300, 10, 'Junior']);
  eq('stesso livello: livelloNuovo null', differenza(S(E('arrivo', VEN, 'r1', 1)), S(E('arrivo', VEN, 'r1', 1), E('arrivo', VEN, 'r2', 1))).livelloNuovo, null);
  eq('due livelli in un colpo: il nome di quello raggiunto', differenza(S(), S(E('ordine', VEN, 'g', 196))).livelloNuovo, 'Production Assistant');
  eq('medaglia nuova', differenza(S(E('arrivo', VEN, 'r1', 1)), S(E('arrivo', VEN, 'r1', 1), P(VEN))).medaglieNuove.map((m) => m.id), ['prima-presenza']);
  eq('medaglia gia\' presa non torna', differenza(S(P(GIO)), S(P(GIO), P(VEN))).medaglieNuove, []);
  eq('righe cancellate da un ordine: punti negativi, nessun livello', [differenza(S(E('ordine', VEN, 'g', 3)), S(E('ordine', VEN, 'g', 1))).punti,
    differenza(S(E('ordine', VEN, 'g', 3)), S(E('ordine', VEN, 'g', 1))).livelloNuovo], [-10, null]);
}

console.log('\n== calcola e\' pura e deterministica ==');
{
  const ev = [...SETTIMANA.map((g) => P(g)), E('ordine', MAR, 'g1', 2), E('arrivo', MER, 'r1', 4), E('arrivo', MER, 'r1', 1, '10:00:00'),
    E('verifica', GIO, FR, 2), E('data_aggiunta', GIO, 'r9'), E('conta', VEN, 'A'), E('conta', VEN, 'B', 1, '10:00:00')];
  const copia = JSON.stringify(ev);
  const s1 = calcola(ev, VEN, ['A', 'B']);
  t('l\'array in ingresso non viene toccato', JSON.stringify(ev) === copia);
  const mescolato = [...ev].reverse();
  mescolato.push(mescolato.shift());
  t('stessi eventi in un altro ordine (anche con ts uguali): stesso stato', JSON.stringify(calcola(mescolato, VEN, ['A', 'B'])) === JSON.stringify(s1));
  t('stesso input due volte: stesso stato', JSON.stringify(calcola(ev, VEN, ['A', 'B'])) === JSON.stringify(s1));
  t('voci dalla piu\' recente', s1.voci.every((v, i) => i === 0 || Date.parse(s1.voci[i - 1].ts) >= Date.parse(v.ts)));
  t('voci solo con punti > 0, e sommano al totale', s1.voci.every((v) => v.punti > 0) && s1.voci.reduce((s, v) => s + v.punti, 0) === s1.totale);
  eq('ts nel formato di PostgREST (microsecondi, +00:00) ordinati bene', calcola([
    { tipo: 'arrivo', giorno: VEN, ts: '2026-10-16T09:00:00.5+00:00', ref: 'r2', n: 1 },
    { tipo: 'arrivo', giorno: VEN, ts: '2026-10-16T09:00:00.123456+00:00', ref: 'r1', n: 1 },
  ], VEN, []).voci.map((v) => v.ref), ['r2', 'r1']);
}

console.log('\n== cinture sul sorgente: paillettes.ts e\' importabile da Node e non legge l\'orologio ==');
{
  // sul codice, non sui commenti (l'intestazione spiega proprio perche' niente Date.now)
  const src = read('web/src/lib/villaggio/paillettes.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  t('nessun import di valori (solo "import type", se mai)', !/^\s*import\s+(?!type\b)/m.test(src));
  t('niente Date.now()', !/Date\.now\s*\(/.test(src));
  t('niente new Date() senza argomenti', !/new Date\(\s*\)/.test(src));
  t('niente Math.random', !/Math\.random/.test(src));
  t('niente em dash, commenti compresi', !/—/.test(read('web/src/lib/villaggio/paillettes.ts')));
}

// --- Taratura sugli eventi veri ---
// Copia datata, letta il 17-10-2026 (01:00 Roma) in SOLA lettura dal progetto imszbjeyplaiovylhkgl, cosi' come li darebbe
// v_villaggio_eventi con villaggio_paillettes_dal = '2026-08-17' e chi = 'Ginevra':
//   ordine: change_log op='order_multi' source='write-api', n = righe di supplier_orders con quel gruppo che esistono oggi
//   arrivo: change_log op='arrival_set' source='write-api' con (after->>'delta')::numeric > 0, n = delta
//   conta:  counts chi='Ginevra'
// giorno = (ts at time zone 'Europe/Rome')::date (l'arrivo delle 22:07 UTC del 01-10 e' del 02-10). ref accorciati ai primi
// 8 caratteri (bastano a distinguerli). Le presenze non esistevano: una per ogni giorno con almeno un evento, all'ora del primo.
// Nessuna verifica e nessuna data aggiunta: sono azioni nuove. Base del magazzino: 98 codici con giacenza diversa da 0 al
// 16-10 (qui conta solo il numero: con 1 codice contato la conta completa e' comunque lontana).
const VERI = [
  ['ordine', '2026-09-02', '2026-09-02T08:42:50Z', '620482c7', 3], ['arrivo', '2026-09-02', '2026-09-02T14:51:59Z', '820a2458', 20],
  ['arrivo', '2026-09-02', '2026-09-02T14:53:04Z', '8284c0f9', 20], ['arrivo', '2026-09-02', '2026-09-02T14:53:46Z', 'bb41463f', 7],
  ['arrivo', '2026-09-02', '2026-09-02T14:54:09Z', '232b8561', 8], ['arrivo', '2026-09-02', '2026-09-02T14:54:20Z', 'e409421a', 10],
  ['arrivo', '2026-09-02', '2026-09-02T14:54:32Z', '4adcddbd', 12], ['conta', '2026-09-08', '2026-09-08T13:46:01Z', 'LEA_BAG_COCCO_PURPLE', 1],
  ['conta', '2026-09-08', '2026-09-08T13:47:00Z', 'LEA_BAG_COCCO_PURPLE', 1], ['ordine', '2026-09-08', '2026-09-08T13:57:00Z', '4480ee04', 0],
  ['ordine', '2026-09-08', '2026-09-08T13:57:47Z', '4e8641ac', 1], ['arrivo', '2026-09-09', '2026-09-09T12:57:56Z', '3c4734fc', 10],
  ['arrivo', '2026-09-09', '2026-09-09T12:58:10Z', '74d1cf06', 10], ['arrivo', '2026-09-14', '2026-09-14T09:12:57Z', '0c800d32', 1],
  ['ordine', '2026-09-14', '2026-09-14T09:15:05Z', '98668dd1', 1], ['arrivo', '2026-09-14', '2026-09-14T09:15:50Z', 'c995d80e', 1],
  ['arrivo', '2026-09-21', '2026-09-21T13:32:13Z', '1a8c88c6', 3], ['arrivo', '2026-09-21', '2026-09-21T13:32:21Z', '627497f2', 1],
  ['arrivo', '2026-09-21', '2026-09-21T13:32:27Z', 'a3f5eec7', 6], ['arrivo', '2026-09-21', '2026-09-21T14:08:53Z', '3c4734fc', 10],
  ['arrivo', '2026-09-25', '2026-09-25T15:43:26Z', 'd809438a', 10], ['ordine', '2026-09-25', '2026-09-25T15:45:39Z', '8d80a2e5', 1],
  ['arrivo', '2026-09-25', '2026-09-25T15:45:45Z', '65149147', 12], ['arrivo', '2026-09-25', '2026-09-25T15:46:13Z', '286b5941', 10],
  ['ordine', '2026-09-25', '2026-09-25T15:47:23Z', '700098ca', 1], ['arrivo', '2026-09-25', '2026-09-25T15:47:29Z', 'fcb9cb84', 12],
  ['arrivo', '2026-09-25', '2026-09-25T15:48:05Z', '125d04b4', 10], ['arrivo', '2026-09-25', '2026-09-25T15:48:22Z', 'c0eee226', 4],
  ['arrivo', '2026-09-25', '2026-09-25T15:48:27Z', 'e8599a91', 4], ['arrivo', '2026-09-25', '2026-09-25T15:48:37Z', 'eb1f906b', 4],
  ['ordine', '2026-09-29', '2026-09-29T10:14:34Z', '52aaab6f', 0], ['arrivo', '2026-09-29', '2026-09-29T10:16:52Z', '3e513c7d', 10],
  ['ordine', '2026-09-29', '2026-09-29T10:31:17Z', 'b2ebd3b4', 0], ['ordine', '2026-09-29', '2026-09-29T10:36:29Z', '5655b4dd', 1],
  ['arrivo', '2026-09-29', '2026-09-29T10:37:13Z', '9476ec5e', 10], ['conta', '2026-09-29', '2026-09-29T10:39:02Z', 'LEA_BAG_COCCO_PURPLE', 1],
  ['ordine', '2026-09-29', '2026-09-29T14:22:55Z', '9145600e', 1], ['ordine', '2026-09-29', '2026-09-29T14:23:37Z', '0cb476db', 1],
  ['arrivo', '2026-09-29', '2026-09-29T14:23:43Z', 'abe690dc', 14], ['arrivo', '2026-10-02', '2026-10-01T22:07:52Z', '3c4734fc', 10],
  ['arrivo', '2026-10-02', '2026-10-01T22:08:01Z', '74d1cf06', 10], ['arrivo', '2026-10-02', '2026-10-01T22:08:55Z', '3c4734fc', 10],
  ['ordine', '2026-10-04', '2026-10-04T19:04:24Z', '0d08b545', 1], ['arrivo', '2026-10-04', '2026-10-04T19:04:34Z', '48f6e8fd', 10],
  ['ordine', '2026-10-05', '2026-10-05T13:59:06Z', 'a751c4c1', 6], ['ordine', '2026-10-06', '2026-10-06T08:48:03Z', '6dfa063c', 1],
  ['arrivo', '2026-10-06', '2026-10-06T08:48:19Z', 'c80604b8', 2], ['ordine', '2026-10-06', '2026-10-06T08:59:02Z', '6a77b57b', 1],
  ['ordine', '2026-10-06', '2026-10-06T08:59:21Z', '5735416c', 1], ['arrivo', '2026-10-07', '2026-10-07T08:53:52Z', 'ceeee57d', 8],
  ['arrivo', '2026-10-07', '2026-10-07T08:54:01Z', '48f6e8fd', 20], ['arrivo', '2026-10-07', '2026-10-07T08:54:17Z', 'fbb498da', 21],
  ['arrivo', '2026-10-07', '2026-10-07T08:54:22Z', '7fb259fe', 30], ['arrivo', '2026-10-07', '2026-10-07T08:54:31Z', '9476ec5e', 20],
  ['arrivo', '2026-10-07', '2026-10-07T08:54:45Z', '47e6b752', 13], ['ordine', '2026-10-08', '2026-10-08T08:43:42Z', 'a1be60c6', 1],
  ['arrivo', '2026-10-08', '2026-10-08T08:43:51Z', 'd2b86cde', 5], ['arrivo', '2026-10-08', '2026-10-08T08:47:55Z', '74d1cf06', 1],
  ['ordine', '2026-10-08', '2026-10-08T08:51:30Z', '44a7d27c', 1], ['arrivo', '2026-10-08', '2026-10-08T08:51:37Z', 'a800b7d6', 10],
  ['arrivo', '2026-10-14', '2026-10-14T13:20:33Z', '3c4734fc', 9], ['ordine', '2026-10-16', '2026-10-16T13:38:18Z', '8fca7715', 1],
  ['ordine', '2026-10-16', '2026-10-16T13:39:07Z', 'd84a000f', 1], ['ordine', '2026-10-16', '2026-10-16T13:40:32Z', '373f9a91', 1],
  ['arrivo', '2026-10-16', '2026-10-16T13:40:39Z', '65ef4f41', 30], ['arrivo', '2026-10-16', '2026-10-16T13:40:46Z', '7263a867', 30],
  ['arrivo', '2026-10-16', '2026-10-16T13:40:49Z', '2802b042', 7], ['arrivo', '2026-10-16', '2026-10-16T13:40:56Z', 'd04b2cf7', 18],
  ['arrivo', '2026-10-16', '2026-10-16T13:41:00Z', 'd196201c', 15],
].map(([tipo, giorno, ts, ref, n]) => ({ tipo, giorno, ts, ref, n }));

console.log('\n== taratura: gli eventi veri di Ginevra dal 17-08 al 16-10 ==');
{
  const primi = new Map();
  for (const e of VERI) if (!primi.has(e.giorno) || Date.parse(e.ts) < Date.parse(primi.get(e.giorno))) primi.set(e.giorno, e.ts);
  const presenze = [...primi].map(([giorno, ts]) => ({ tipo: 'presenza', giorno, ts, ref: giorno, n: 1 }));
  const BASE98 = ['LEA_BAG_COCCO_PURPLE', ...Array.from({ length: 97 }, (_, i) => 'CODICE_' + i)];
  const s = calcola([...VERI, ...presenze], VEN, BASE98);
  const per = (tipo) => s.voci.filter((v) => v.tipo === tipo).reduce((a, v) => a + v.punti, 0);
  eq('copia completa: 21 ordini, 45 arrivi, 3 conte, 15 giorni con eventi', [VERI.filter((e) => e.tipo === 'ordine').length,
    VERI.filter((e) => e.tipo === 'arrivo').length, VERI.filter((e) => e.tipo === 'conta').length, presenze.length], [21, 45, 3, 15]);
  // 18 ordini con righe (16 da 1 riga, uno da 3, uno da 6) = 400 + 35 + 50; 44 arrivi distinti per (riga, giorno) = 440
  // (3c4734fc due volte il 02-10); la stessa conta due volte l'08-09 vale una; 15 presenze; nessuna settimana piena
  eq('per tipo: ordine 485, arrivo 440, conta 4, presenza 75, settimana piena 0', [per('ordine'), per('arrivo'), per('conta'), per('presenza'),
    per('settimana_piena')], [485, 440, 4, 75, 0]);
  eq('totale 1004 = Production Assistant (soglia 1000)', [s.totale, s.nomeLivello], [1004, 'Production Assistant']);
  eq('medaglie dallo storico: solo prima-presenza', s.medaglie.map((m) => m.id), ['prima-presenza']);
  const giorniFinestra = (Date.parse(VEN) - Date.parse('2026-08-17')) / 86400000 + 1;
  const giorniAttiva = (Date.parse(VEN) - Date.parse('2026-09-02')) / 86400000 + 1;
  const regina = LIVELLI[LIVELLI.length - 1].da;
  for (const [nome, giorni] of [['finestra 17-08..16-10', giorniFinestra], ['dal primo evento, 02-09..16-10', giorniAttiva]]) {
    const mese = (s.totale / giorni) * 30;
    nota(`${nome}: ${giorni} giorni, ${Math.round(mese)} paillettes ogni 30 giorni, regina (15.000) in ${(regina / mese).toFixed(1)} mesi`);
  }
  // le presenze vere saranno una per giorno lavorativo, non solo nei giorni con un ordine o un arrivo
  const ogniGiorno = lavorativi('2026-09-07', 30).filter((g) => g <= VEN);
  const conPresenze = calcola([...VERI, ...presenze, ...['2026-09-02', '2026-09-03', '2026-09-04', ...ogniGiorno].map((g) => P(g, '06:00:00'))], VEN, BASE98);
  const meseP = (conPresenze.totale / giorniAttiva) * 30;
  nota(`stesso storico con una presenza ogni giorno lavorativo dal 02-09: ${conPresenze.totale} paillettes, ${Math.round(meseP)} ogni 30 giorni, regina in ${(regina / meseP).toFixed(1)} mesi`);
  t('la taratura gira (numeri sopra: LIVELLI li decide l\'owner, il test non li corregge)', s.totale > 0);
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
