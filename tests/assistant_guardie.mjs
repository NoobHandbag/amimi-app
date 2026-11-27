// tests/assistant_guardie.mjs: l'edge `assistant` ("Chiedi ad Amimi'") v3, passata da Gemini a Claude il 25-11-2026.
// Il blocco PURE:assistant e' ritagliato DAL SORGENTE che va in produzione e provato in Node; il resto e' controllato
// sul testo del sorgente. Nessuna rete, nessuna chiave.
//   node tests/assistant_guardie.mjs
// Perche' esiste: il 25-11 la stessa domanda ("quanto abbiamo venduto offline a novembre") dava tre cifre diverse (una era
// il venduto di sempre, una "nullo"), nessuna uguale al CE, e su ottobre il testo contava due pezzi in meno delle righe.
// Le query sono quelle vere di quel giorno; i NUMERI qui sono finti (questo repo e' pubblico: niente incassi veri).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

process.removeAllListeners('warning');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = readFileSync(ROOT + 'supabase/functions/assistant/index.ts', 'utf8').replace(/\r\n/g, '\n');
// il codice senza i commenti di riga: i commenti raccontano la storia (Gemini, temperature) e non devono far cadere i controlli
const CODICE = SRC.replace(/(^|[ \t])\/\/[^\n]*/gm, '$1');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 400) : '')); } };

const B = '// ==== PURE:assistant BEGIN ====', E = '// ==== PURE:assistant END ====';
const a = SRC.indexOf(B), b = SRC.indexOf(E);
if (a < 0 || b < a) { console.error('marcatori PURE:assistant non trovati'); process.exit(1); }
const BLOCCO = SRC.slice(a + B.length, b);
const ESPORTA = ['MODELLO', 'EFFORT_SQL', 'EFFORT_RISPOSTA', 'PREZZI', 'SCHEMA', 'ISTRUZIONI_RISPOSTA', 'FORMATO_SQL', 'FORMATO_RISPOSTA', 'FORMATO_SPESA',
  'MESI', 'TESTO_VUOTO', 'oggiRoma', 'annoInferito', 'filtriPeriodo', 'tempoChiamata', 'SCADENZA_MS', 'CHIAMATA_MAX_MS', 'CHIAMATA_MIN_MS', 'cleanSql', 'aNumero', 'storiaUtente', 'mesiNellaDomanda', 'anniNellaDomanda', 'controllaPeriodo', 'righeVuote',
  'totaliCalcolati', 'numeriNelTesto', 'numeriNonVerificati', 'valoriConsentiti', 'costoUsd', 'CATEGORIE_SPESA', 'domandaSiNo', 'verificaSiNo'];
const M = new Function(stripTypeScriptTypes(BLOCCO).replace(/^export /gm, '') + `\nreturn { ${ESPORTA.join(', ')} };`)();

console.log('\n== blocco puro senza import ne\' rete ==');
t('il blocco PURE non importa nulla e non chiama la rete', !/\bimport\b|fetch\(|Deno\./.test(BLOCCO));

console.log('\n== modello e chiave (decisione Dan 25-11: Anthropic al posto di Google, Opus 5.5, chiave della chat del sito) ==');
t('modello in un punto solo: claude-opus-5-5', M.MODELLO === 'claude-opus-5-5' && (SRC.match(/'claude-opus-5-5'/g) || []).length === 2);
t('effort espliciti: medium per la query, low per la prosa', M.EFFORT_SQL === 'medium' && M.EFFORT_RISPOSTA === 'low');
t('nessuna traccia di Gemini (ne\' modello, ne\' endpoint, ne\' chiave in app_flags)', !/gemini|generativelanguage|gemini_api_key/i.test(CODICE));
t('SDK Anthropic fissato alla stessa versione della chat del sito', /^import Anthropic from 'npm:@anthropic-ai\/sdk@1\.8\.0';$/m.test(SRC)
  && /from 'npm:@anthropic-ai\/sdk@1\.8\.0'/.test(readFileSync(ROOT + 'supabase/functions/chat-api/bot.ts', 'utf8')));
t('chiave dal segreto delle Edge Functions ANTHROPIC_API_KEY, mai da app_flags', /Deno\.env\.get\('ANTHROPIC_API_KEY'\)/.test(SRC) && !/from\('app_flags'\)/.test(SRC));
t('chiave assente -> needs_key, non un errore muto', /if \(!apiKey\) return json\(\{ ok: true, testo: 'Assistente non configurato \(manca la chiave Anthropic\)\.', needs_key: true \}\)/.test(SRC));
t('nessun parametro di campionamento (la versione API dell\'SDK 1.8.0 lo rifiuta)', !/temperature|top_p|top_k/.test(CODICE));
t('thinking adattivo, mai disabled ne\' budget_tokens (400 su Opus 5.5)', /thinking: \{ type: 'adaptive' \}/.test(SRC) && !/budget_tokens|type: 'disabled'/.test(CODICE));
t('fallback lato server sul rifiuto, con il suo header beta', /betas: \['server-side-fallback-2026-07-01'\],\n\s*fallbacks: 'default',/.test(SRC));
t('stop_reason refusal e max_tokens gestiti prima di leggere il testo',
  /if \(r\.stop_reason === 'refusal'\) throw new RifiutoModello/.test(SRC) && /if \(r\.stop_reason === 'max_tokens'\) throw/.test(SRC)
  && SRC.indexOf("r.stop_reason === 'refusal'") < SRC.indexOf('const testo = r.content'));
t('output strutturato json_schema su ogni chiamata', /output_config: \{ effort: p\.effort, format: \{ type: 'json_schema', schema: p\.formato \} \}/.test(SRC));
t('prompt di sistema in cache', /system: \[\{ type: 'text', text: p\.system, cache_control: \{ type: 'ephemeral' \} \}\]/.test(SRC));
t('il credito finito ha un messaggio suo', /credit balance/.test(SRC) && /il credito Anthropic e\\' finito/.test(SRC));

console.log('\n== formati per gli output strutturati (ogni oggetto con additionalProperties false e required completo) ==');
const oggettiOk = (s) => {
  if (!s || typeof s !== 'object') return true;
  if (s.type === 'object' && (s.additionalProperties !== false || JSON.stringify([...s.required].sort()) !== JSON.stringify(Object.keys(s.properties).sort()))) return false;
  return Object.values(s).every((v) => (Array.isArray(v) ? v.every(oggettiOk) : oggettiOk(v)));
};
for (const f of ['FORMATO_SQL', 'FORMATO_RISPOSTA', 'FORMATO_SPESA']) t(f + ' valido per gli output strutturati', oggettiOk(M[f]));
t('FORMATO_SQL: percorso dati o howto', JSON.stringify(M.FORMATO_SQL.properties.percorso.enum) === '["dati","howto"]');
t('la guida how-to ha un formato inline valido', /formato: \{ type: 'object', additionalProperties: false, required: \['testo'\], properties: \{ testo: \{ type: 'string' \} \} \}/.test(SRC));

console.log('\n== prompt della query: offline come il CE, niente anno fisso, niente totali di sempre per un mese ==');
const S = M.SCHEMA;
t('offline = Qromo + vendite manuali e fuori fatturato di gifts_offline', /"offline" = "non online"[^\n]*qromo_sales PLUS gifts_offline rows with kind 'vendita_manuale' or 'vendita_fuori_fatturato'/.test(S));
t('i totali per mese/canale vengono da v_ce_totale, lordo E netto', /SALES TOTALS[^\n]*ALWAYS come from v_ce_totale[^\n]*Select BOTH the lordo \(VAT incl\.\) and the netto/.test(S));
t('offline_pezzi conta anche gli omaggi: i pezzi venduti si contano a parte', /offline_pezzi in v_ce_totale also counts free gifts/.test(S));
t('le colonne *_sold di v_inventory sono di sempre, mai per un periodo', /ALL-TIME totals: NEVER use them for a month or any period/.test(S));
t('qromo_sales.prezzo e\' il totale di riga: SUM(prezzo), mai prezzo*quantita (come il CE)', /prezzo is the ROW total, VAT-inclusive: use SUM\(prezzo\), never prezzo\*quantita/.test(S));
t('anno non piu\' scritto fisso ("current year is 2026"): la data arriva con la domanda', !/current year is/i.test(S) && /today's date is given with the question/.test(S)
  && /user: `Oggi e' \$\{oggi\} \(Europe\/Rome\)/.test(SRC));
t('borse per nome (item/codice ILIKE BAG), mai per categoria: 340 borse a magazzino hanno la categoria vuota (26-11)',
  /NEVER use categoria to find bags or accessories\. A bag \("borsa"\) = item ILIKE '%BAG%'/.test(S) && /in the sales tables, codice ILIKE '%BAG%'/.test(S)
  && !/categoria has exactly 3 real values/.test(S));
t('join sui codici senza maiuscole/minuscole', /join sales tables to v_inventory\/products on UPPER\(codice\)/.test(S));
t('valore di magazzino = giacenza x listino, non costo', /valore = giacenza_attuale x retail_price \(stock value at LIST price, VAT incl\.\), NOT at cost/.test(S)
  && /a prezzo di listino con IVA/.test(M.ISTRUZIONI_RISPOSTA));
t('foto: le mostra l\'app, il testo non dice mai che mancano (26-11: "foto non disponibili" con 5 card con foto)',
  /image_url here is the product photo \(products\.image_url is often empty\)/.test(S) && /non scrivere mai che le foto mancano/.test(M.ISTRUZIONI_RISPOSTA));
t('giorni in ora italiana: created_at_shop e\' UTC (27-11: "ieri" contava 32 ordini invece di 29)',
  /created_at_shop is a UTC timestamp: for a day in Italy \(oggi, ieri, a date\) ALWAYS use \(created_at_shop AT TIME ZONE 'Europe\/Rome'\)::date/.test(S)
  && /created_at is the IMPORT time, never use it/.test(S));
t('"Qromo" da solo = solo la cassa, non tutto l\'offline', /"Qromo" alone means the POS till only = qromo_sales \(manual offline sales excluded\)/.test(S)
  && !/"eventi" = "Qromo"/.test(S));
t('un mese nominato va filtrato nella query', /When the question names a month or a year, the SELECT MUST filter on it/.test(S));

console.log('\n== data di oggi a Roma ==');
t('25-11 23:30 UTC = 26-11 a Roma', M.oggiRoma(new Date('2026-11-25T23:30:00Z')) === '2026-11-26');
t('31-12 23:30 UTC = 01-01-2027 a Roma', M.oggiRoma(new Date('2026-12-31T23:30:00Z')) === '2027-01-01');
t('estate (UTC+2): 30-06 22:30 UTC = 01-07', M.oggiRoma(new Date('2026-06-30T22:30:00Z')) === '2026-07-01');

console.log('\n== controllo del periodo (query vere del 25-11 e casi della Gate 2 del 26-11) ==');
const OGGI = '2026-11-26';
const CP = (d, q, oggi = OGGI, storia = '') => M.controllaPeriodo(d, q, oggi, storia);
const NOV = 'Quanto abbiamo venduto offline a novembre';
t('il venduto di sempre: SUM su v_inventory senza mese -> bloccata', CP(NOV, 'SELECT sum(qromo_sold * retail_price) as venduto_offline_lordo FROM v_inventory') !== null);
t('qromo_sales month = 11 AND year = 2026 -> passa', CP(NOV, 'SELECT SUM(quantita * prezzo) AS t FROM qromo_sales WHERE month = 11 AND year = 2026') === null);
t('v_ce_totale year = 2026 AND month = 11 -> passa', CP(NOV, 'SELECT year, month, offline_lordo, offline_netto FROM v_ce_totale WHERE year = 2026 AND month = 11') === null);
t('follow-up "Per ottobre?" con q.year = 2026 AND q.month = 10 -> passa', CP('Per ottobre? Intendo vendite non online', 'SELECT codice FROM qromo_sales q WHERE q.year = 2026 AND q.month = 10') === null);
t('B3: mese senza anno nella query ("month = 10" da solo) -> bloccata', CP('Per ottobre? Intendo vendite non online', 'SELECT codice FROM qromo_sales WHERE month = 10') !== null);
t('B3: a gennaio 2027 "gennaio" vuole il 2027, non il 2026', CP('vendite offline di gennaio', 'SELECT SUM(prezzo) FROM qromo_sales WHERE year = 2026 AND month = 1', '2027-01-15') !== null
  && CP('vendite offline di gennaio', 'SELECT SUM(prezzo) FROM qromo_sales WHERE year = 2027 AND month = 1', '2027-01-15') === null);
t('"dicembre" chiesto a novembre 2026 = dicembre 2025', CP('vendite di dicembre', 'SELECT * FROM v_ce_totale WHERE year = 2025 AND month = 12') === null
  && CP('vendite di dicembre', 'SELECT * FROM v_ce_totale WHERE year = 2026 AND month = 12') !== null);
t('un anno gia\' nominato nelle domande di prima vale per il follow-up', CP('e a ottobre?', 'SELECT * FROM v_ce_totale WHERE year = 2025 AND month = 10', OGGI, '- vendite offline di novembre 2025') === null);
t('anno annoInferito: novembre a novembre = anno in corso, dicembre = anno prima', M.annoInferito(11, OGGI) === 2026 && M.annoInferito(12, OGGI) === 2025);
t('novembre ma la query filtra month = 1 -> bloccata', CP(NOV, 'SELECT * FROM v_ce_totale WHERE year = 2026 AND month = 1') !== null);
t('gennaio ma la query filtra month = 11 -> bloccata', CP('vendite di gennaio', 'SELECT * FROM v_ce_totale WHERE year = 2026 AND month = 11') !== null);
t('gennaio con month = 10 -> bloccata (1 non e\' dentro 10)', CP('vendite di gennaio', 'SELECT * FROM v_ce_totale WHERE year = 2026 AND month = 10') !== null);
t('intervallo di date sulla colonna data -> passa', CP(NOV, "SELECT SUM(prezzo) FROM qromo_sales WHERE data >= '2026-11-01' AND data < '2026-12-01'") === null);
t('C5: il limite superiore escluso non vale come mese dopo (gennaio non e\' febbraio)', CP('vendite di febbraio', "SELECT SUM(prezzo) FROM qromo_sales WHERE data >= '2026-01-01' AND data < '2026-02-01'") !== null);
t('EXTRACT(MONTH FROM data) = 11 AND EXTRACT(YEAR FROM data) = 2026 -> passa', CP(NOV, 'SELECT SUM(prezzo) FROM qromo_sales WHERE EXTRACT(MONTH FROM data) = 11 AND EXTRACT(YEAR FROM data) = 2026') === null);
t("to_char(data, 'YYYY-MM') = '2026-11' -> passa", CP(NOV, "SELECT SUM(prezzo) FROM qromo_sales WHERE to_char(data, 'YYYY-MM') = '2026-11'") === null);
t("C5: to_char(data, 'MM') = '11' con l'anno -> passa", CP(NOV, "SELECT SUM(prezzo) FROM qromo_sales WHERE to_char(data, 'MM') = '11' AND to_char(data, 'YYYY') = '2026'") === null);
t('C5: make_date(2026, 11, 1) -> passa', CP(NOV, 'SELECT SUM(prezzo) FROM qromo_sales WHERE data >= make_date(2026, 11, 1)') === null);
t('C5: "LIMIT 1" o "ROUND(x, 2)" dopo month non contano come gennaio/febbraio',
  CP('vendite di gennaio', 'SELECT month, ROUND(SUM(prezzo), 2) FROM qromo_sales WHERE year = 2026 GROUP BY month ORDER BY month LIMIT 1') !== null);
t('month IN (10, 11) per ottobre -> passa', CP('e a ottobre?', 'SELECT * FROM v_ce_totale WHERE year = 2026 AND month IN (10, 11)') === null);
t('da gennaio a settembre con BETWEEN 1 AND 9 -> passa', CP('vendite da gennaio a settembre 2026', 'SELECT * FROM v_ce_totale WHERE year = 2026 AND month BETWEEN 1 AND 9') === null);
t('da gennaio a settembre con month <= 9 -> passa', CP('vendite da gennaio a settembre 2026', 'SELECT * FROM v_ce_totale WHERE year = 2026 AND month <= 9') === null);
t('anno nominato ma assente dalla query -> bloccata', CP('vendite offline di novembre 2025', 'SELECT * FROM v_ce_totale WHERE year = 2026 AND month = 11') !== null);
t('nessun periodo nella domanda -> nessun controllo', CP('quali borse sono esaurite?', 'SELECT codice FROM v_inventory WHERE disponibili_da_vendere <= 0') === null);
t('C5: mese come obiettivo ("cosa riordinare per dicembre?") -> nessun controllo sul mese', CP('Cosa devo riordinare per dicembre?', 'SELECT * FROM v_reorder') === null);
t('"maggiore" non e\' maggio', JSON.stringify(M.mesiNellaDomanda('la borsa con il prezzo maggiore')) === '[]');
t('mesi riconosciuti anche con maiuscole e punteggiatura', JSON.stringify(M.mesiNellaDomanda('Novembre, e Ottobre?')) === '[10,11]');
t('anni nella domanda', JSON.stringify(M.anniNellaDomanda('nel 2025 e nel 2026, non 120260')) === '[2025,2026]');
console.log('\n== righe vuote: "la ricerca non ha trovato righe", mai "vendite nulle" ==');
t('nessuna riga -> vuota', M.righeVuote([]) === true);
t('una riga tutta null (SUM su zero righe, il caso "nullo" del 25-11) -> vuota', M.righeVuote([{ totale_venduto_offline: null }]) === true);
t('uno zero vero non e\' vuoto', M.righeVuote([{ totale: 0 }]) === false);
t('una riga con un valore non e\' vuota', M.righeVuote([{ a: null, b: 'x' }]) === false);
t('C4: anno e mese pieni ma totale null -> vuota', M.righeVuote([{ year: 2026, month: 11, totale: null }]) === true);
t('C4: COUNT 0 e SUM null -> vuota', M.righeVuote([{ n: 0, totale: null }]) === true);
t('C4: COUNT 0 e SUM 0 (zero vero, nessun null) -> non vuota', M.righeVuote([{ n: 0, totale: 0 }]) === false);
t('C4: un totale vero con anno e mese -> non vuota', M.righeVuote([{ year: 2026, month: 11, totale: 15 }]) === false);
t('il testo per le righe vuote non parla di vendite nulle', !/null|zero|nessuna vendita/i.test(M.TESTO_VUOTO) && /non ha trovato righe/.test(M.TESTO_VUOTO));
t('il flusso usa righeVuote prima del passo risposta', /if \(righeVuote\(rows\)\) \{/.test(SRC)
  && SRC.indexOf('righeVuote(rows)') < SRC.indexOf('ISTRUZIONI_RISPOSTA, user: base'));

console.log('\n== totali dal programma e controllo dei numeri (righe finte: 20 righe, 27 pezzi, 3.110,50 euro) ==');
// righe finte con la forma di quelle del 25-11 (una per prodotto, quantita e fatturato): 20 righe, 27 pezzi, 3.110,50 euro
const OTT = [[5, 600], [3, 390], [2, 250], ...Array(16).fill([1, 110]), [1, 110.5]].map(([q, f], i) => ({ codice: 'COD_' + i, item: 'LEA BAG', quantita_totale: q, fatturato_lordo: f, month: 10, year: 2026 }));
const TOT = M.totaliCalcolati(OTT);
t('totali delle righe di prova: 27 pezzi, 3.110,50 euro', TOT.colonne.quantita_totale?.somma === 27 && TOT.colonne.fatturato_lordo?.somma === 3110.5, TOT.colonne);
t('anno e mese non si sommano, le stringhe neanche', !('year' in TOT.colonne) && !('month' in TOT.colonne) && !('item' in TOT.colonne) && TOT.righe === 20);
t('numeri come stringhe (numeric di Postgres) sommati', M.totaliCalcolati([{ x: '1.50' }, { x: '2' }]).colonne.x.somma === 3.5);
const OK_OTT = M.valoriConsentiti(OTT, TOT, 'Per ottobre? Intendo vendite non online', 'SELECT ... WHERE q.year = 2026 AND q.month = 10');
t('"3.110,50 € con 27 pezzi" -> verificato', M.numeriNonVerificati('A ottobre 2026 le vendite offline sono state 3.110,50 € con IVA, per 27 pezzi.', OK_OTT).length === 0,
  M.numeriNonVerificati('A ottobre 2026 le vendite offline sono state 3.110,50 € con IVA, per 27 pezzi.', OK_OTT));
t('"25 pezzi" (due in meno, l\'errore del 25-11) -> bloccato', JSON.stringify(M.numeriNonVerificati('3.110,50 € per complessivi 25 pezzi venduti.', OK_OTT)) === '["25"]');
t('una riga citata (5 pezzi per 600 €) -> verificata', M.numeriNonVerificati('La LEA BAG piu\' venduta ha fatto 5 pezzi per 600,00 €.', OK_OTT).length === 0);
const NOV_RIGA = [{ year: 2026, month: 11, offline_lordo: '1500.00', offline_netto: '1229.5081967213114754' }];
const OK_NOV = M.valoriConsentiti(NOV_RIGA, M.totaliCalcolati(NOV_RIGA), NOV, 'SELECT year, month, offline_lordo, offline_netto FROM v_ce_totale WHERE year = 2026 AND month = 11');
t('1.500,00 € con IVA e 1.229,51 € senza IVA dalla riga del CE -> verificati',
  M.numeriNonVerificati('A novembre 2026, fino a oggi, 1.500,00 € con IVA (1.229,51 € senza IVA).', OK_NOV).length === 0);
t('1.500 € senza decimali -> verificato (arrotondamento all\'unita\')', M.numeriNonVerificati('circa 1.500 €', OK_NOV).length === 0);
t('un totale che non e\' nella riga (il venduto di sempre) -> bloccato', JSON.stringify(M.numeriNonVerificati('A novembre 18.250 €.', OK_NOV)) === '["18.250"]');
t('netto calcolato a mente da un lordo che la riga non ha -> bloccato',
  M.numeriNonVerificati('1.220,00 € con IVA, cioe\' 1.000,00 € senza IVA', M.valoriConsentiti([{ t: 1220 }], M.totaliCalcolati([{ t: 1220 }]), NOV, 'SELECT 1')).includes('1.000,00'));
t('date e anni nel testo non si controllano ("fino al 25 novembre 2026", "nel 2026")', M.numeriNonVerificati('Dati fino al 25 novembre 2026, cioe\' nel 2026; aggiornati il 2026-11-25 e il 25/11.', [1]).length === 0);
t('un importo che sembra un anno ma ha l\'euro dopo si controlla', JSON.stringify(M.numeriNonVerificati('totale 2050 €', [1])) === '["2050"]');
t('percentuale da una frazione nelle righe (0,45 -> 45%)', M.numeriNonVerificati('il 45% delle vendite', [0.45]).length === 0);
t('IVA 22% sempre ammessa', M.numeriNonVerificati('prezzi con IVA al 22%', [1]).length === 0);
t('valori negativi (costi) letti in valore assoluto', M.numeriNonVerificati('spese per 1.234,50 €', [-1234.5]).length === 0);
t('B1: "3.456" e\' sempre 3456 (migliaia), mai 3,456', M.numeriNelTesto('3.456')[0].valore === 3456 && M.numeriNelTesto('3.456').length === 1);
{
  // la riga del CE di prova: 1.500,00 con IVA, 1.229,51 senza IVA. Questi testi sono tutti SBAGLIATI e devono cadere.
  const sbagliati = ['1.700 € con IVA', '1.000 €', '1.400 € senza IVA', '11.250 €', '1.220 €', "l'80% del totale", 'il 99%', 'il 150%', 'crescita del 120%'];
  const cadute = sbagliati.filter((x) => M.numeriNonVerificati(x, OK_NOV).length === 1);
  t('B1: importi in migliaia e percentuali sbagliate non passano piu\'', cadute.length === sbagliati.length, sbagliati.filter((x) => !cadute.includes(x)));
  const zeri = M.valoriConsentiti([{ a: 0, b: 15 }], M.totaliCalcolati([{ a: 0, b: 15 }]), 'x', 'SELECT 1');
  t('B1: con uno 0 nelle righe "il 30%" non passa', M.numeriNonVerificati('il 30% delle vendite', zeri).length === 1);
  t('B1: le cifre dentro i nomi della query (b2b, venduto_60d) non sono valori ammessi',
    M.numeriNonVerificati('60 pezzi e 2 negozi', M.valoriConsentiti([{ x: 15 }], M.totaliCalcolati([{ x: 15 }]), 'x', 'SELECT b2b_venduto, venduto_60d FROM v_reorder')).length === 2);
  const DATE = [{ data: '2026-11-03', prezzo: 120 }, { data: '2026-11-17', prezzo: 90 }];
  t('B1: le date delle righe non ammettono ogni numero da 1 a 31', M.numeriNonVerificati('17 pezzi', M.valoriConsentiti(DATE, M.totaliCalcolati(DATE), 'x', 'SELECT 1')).length === 1);
}
{
  // B4: classifiche corrette con posizioni e ordinali
  const RK = [{ codice: 'A', venduti: 12 }, { codice: 'B', venduti: 9 }, { codice: 'C', venduti: 7 }, { codice: 'D', venduti: 6 }, { codice: 'E', venduti: 5 }];
  const OK_RK = M.valoriConsentiti(RK, M.totaliCalcolati(RK), 'Le piu\' vendute con foto', 'SELECT codice, venduti FROM x ORDER BY venduti DESC LIMIT 5');
  t('B4: lista numerata "1. LEA (12), 2. NINA (9), 3. AGATA (7), 4. ANNIE (6)" -> verificata', M.numeriNonVerificati('1. LEA (12), 2. NINA (9), 3. AGATA (7), 4. ANNIE (6)', OK_RK).length === 0,
    M.numeriNonVerificati('1. LEA (12), 2. NINA (9), 3. AGATA (7), 4. ANNIE (6)', OK_RK));
  t('B4: lista a capo "1) ... 3) ..." -> verificata', M.numeriNonVerificati('Classifica:\n1) LEA con 12 pezzi\n3) AGATA con 7 pezzi', OK_RK).length === 0);
  t('B4: ordinali e "top 3" -> verificati', M.numeriNonVerificati('Al 3° posto la AGATA con 7 pezzi; nella top 3 c\'e\' anche la NINA (9).', OK_RK).length === 0);
  t('B4: un conteggio sbagliato dentro la classifica cade lo stesso', JSON.stringify(M.numeriNonVerificati('1. LEA (13), 2. NINA (9)', OK_RK)) === '["13"]');
}
{
  // C3: giorno di oggi e date puntate
  const OK_OGGI = M.valoriConsentiti([{ x: 15 }], M.totaliCalcolati([{ x: 15 }]), 'x', 'SELECT 1', '2026-11-26');
  t('C3: "nei primi 26 giorni" (oggi e\' il 26) -> verificato', M.numeriNonVerificati('nei primi 26 giorni del mese', OK_OGGI).length === 0);
  t('C3: data puntata "26.11.2026" non e\' un numero da verificare', M.numeriNonVerificati('aggiornato al 26.11.2026', [1]).length === 0);
}
t('numeri dentro i codici prodotto non si leggono', M.numeriNelTesto('COLD_AD_2 e LEA2').length === 0);
t('cifre dentro le stringhe delle righe ammesse (varianti, date)', M.numeriNonVerificati('la MAXI 2 venduta il 3 marzo', M.valoriConsentiti([{ variant: 'MAXI 2' }], { righe: 1, colonne: {} }, 'x', 'SELECT 1')).length === 0);
t('il flusso riscrive UNA volta (se c\'e\' tempo) e poi passa al testo senza cifre',
  /for \(let tentativo = 0; tentativo < 2; tentativo\+\+\)/.test(SRC) && /if \(tentativo === 1 \|\| tempoChiamata\(scadenza, Date\.now\(\)\) == null\) \{ testo = TESTO_NUMERI; break; \}/.test(SRC));
t('C6: al tetto di 200 righe i totali sono dichiarati parziali', /TOTALI CALCOLATI DAL PROGRAMMA sulle SOLE 200 righe ricevute, NON sono totali completi/.test(SRC));
t('C2: titolo del grafico ed etichetta delle card con un numero non verificato si tolgono',
  /titolo: numeriNonVerificati\(String\(gspec\.titolo \?\? ''\), consentiti\)\.length \? '' :/.test(SRC) && /etichetta && !numeriNonVerificati\(etichetta, consentiti\)\.length/.test(SRC));
t('il passo risposta vede la query (periodo e filtri) e i totali calcolati', /Query SQL eseguita: \$\{sql\}/.test(SRC) && /TOTALI CALCOLATI DAL PROGRAMMA/.test(SRC) && /TOTALI CALCOLATI DAL PROGRAMMA/.test(M.ISTRUZIONI_RISPOSTA));
t('istruzioni: niente conti a mente, formato italiano, IVA e periodo dichiarati',
  /Non fare mai somme, medie, differenze, percentuali o conversioni a mente/.test(M.ISTRUZIONI_RISPOSTA) && /1\.234,50 €/.test(M.ISTRUZIONI_RISPOSTA)
  && /con IVA/.test(M.ISTRUZIONI_RISPOSTA) && /fino a oggi/.test(M.ISTRUZIONI_RISPOSTA));

console.log('\n== domande si\'/no con zero righe: il codice costruisce ed esegue la SUA query di esistenza (27-11) ==');
{
  const si = ['Abbiamo venduto qualcosa in negozio ieri?', 'Ci sono ordini oggi?', "C'e' stato qualche ordine a novembre?", "C’è stato qualche ordine a novembre?",
    "È arrivato l'ordine dal fornitore?", 'Hai venduto borse Nina a ottobre?', 'Did we sell anything yesterday?', 'Ieri abbiamo venduto qualcosa in negozio?',
    'Oggi ci sono ordini?', 'In negozio ieri abbiamo venduto qualcosa?', 'Risultano vendite ieri?', 'Any sales yesterday?', 'e a ottobre abbiamo venduto qualcosa in negozio?'];
  const no = ['Quanto abbiamo venduto ieri?', 'Quali borse sono esaurite?', 'Abbiamo venduto quanti pezzi a ottobre?', 'Come registro una spesa?',
    'Vendite del modello Pippo a ottobre', 'Quando e\' arrivato l\'ultimo ordine?', 'Chi ha comprato di piu\'?', 'How much did we sell yesterday?', 'Le 5 borse piu\' vendute', 'e ieri?',
    "È vero che non abbiamo venduto nulla in negozio ieri?", 'Abbiamo venduto zero borse in negozio ieri?', 'Abbiamo chiuso ieri senza vendite in negozio?', 'Ci sono ordini non evasi?'];
  const siKo = si.filter((d) => !M.domandaSiNo(d)), noKo = no.filter((d) => M.domandaSiNo(d));
  t('domande si\'/no riconosciute (apostrofo curvo, È, inglese, "ieri abbiamo...", "risultano")', siKo.length === 0, siKo);
  t('quanto/quali/come/chi, frasi senza verbo e domande NEGATIVE (non, nulla, zero, senza) NON sono si\'/no', noKo.length === 0, noKo);

  const OGGI = '2026-11-27', ADESSO = new Date('2026-11-27T13:00:00Z');
  const V = (d, adesso = ADESSO) => M.verificaSiNo(d, OGGI, adesso);
  const n1 = V('Abbiamo venduto qualcosa in negozio ieri?');
  t('negozio ieri: query del codice su cassa + vendite manuali (non omaggi), giorno italiano scritto',
    n1?.sql === "SELECT x FROM (SELECT 1 AS x FROM qromo_sales WHERE data = '2026-11-26' UNION ALL SELECT 1 AS x FROM gifts_offline WHERE kind IN ('vendita_manuale','vendita_fuori_fatturato') AND data = '2026-11-26') t LIMIT 1", n1?.sql);
  t('negozio ieri: testi "No" e "Si\'" scritti dal codice con periodo e fonti',
    n1?.no === 'No: ieri, 26 novembre 2026, non risulta nessuna vendita nella cassa Qromo e nelle vendite manuali.'
    && n1?.si === 'Si\', ieri, 26 novembre 2026, risulta almeno una vendita nella cassa Qromo o nelle vendite manuali. Per i numeri chiedimi "quanto" con lo stesso periodo.', n1);
  t('stesso risultato con le parole in un altro ordine', V('Ieri abbiamo venduto qualcosa in negozio?')?.sql === n1.sql);
  const n2 = V('Did we sell anything yesterday?');
  t('nessun canale: sito (giorno italiano su created_at_shop) + cassa + vendite manuali', /^SELECT x FROM \(SELECT 1 AS x FROM shopify_orders WHERE \(created_at_shop AT TIME ZONE 'Europe\/Rome'\)::date = '2026-11-26' UNION ALL SELECT 1 AS x FROM qromo_sales WHERE data = '2026-11-26' UNION ALL SELECT 1 AS x FROM gifts_offline WHERE kind IN \('vendita_manuale','vendita_fuori_fatturato'\) AND data = '2026-11-26'\) t LIMIT 1$/.test(n2?.sql ?? ''), n2);
  const n3 = V('Ci sono ordini online oggi?');
  t('ordini online oggi: solo sito, con l\'avviso che gli ordini arrivano una volta all\'ora', /FROM shopify_orders WHERE \(created_at_shop AT TIME ZONE 'Europe\/Rome'\)::date = '2026-11-27'\) t LIMIT 1$/.test(n3?.sql ?? '') && /una volta all'ora/.test(n3?.no ?? ''), n3);
  t('ordini del sito "ieri" subito dopo mezzanotte (cron al minuto 7): non verificabile', V('Ci sono ordini online ieri?', new Date('2026-11-26T23:05:00Z')) === null && V('Ci sono ordini online ieri?') !== null);
  const n4 = V('Abbiamo speso qualcosa in marketing a novembre?');
  t('spese di marketing a novembre: categoria esatta, anno e mese', n4?.sql === "SELECT x FROM (SELECT 1 AS x FROM expenses WHERE year = 2026 AND month = 11 AND categoria = 'MARKETING') t LIMIT 1"
    && n4?.no === 'No: a novembre 2026 non risulta nessuna spesa di MARKETING nelle spese registrate.', n4);
  t('"eventi" nelle spese e\' la categoria EVENTI, nelle vendite e\' il canale offline', /categoria = 'EVENTI'/.test(V('Abbiamo speso per eventi a ottobre?')?.sql ?? '') && /qromo_sales.*gifts_offline/.test(V('Abbiamo venduto qualcosa agli eventi a ottobre?')?.sql ?? ''));
  t('giorno con "con Qromo": solo la cassa', V('Abbiamo venduto qualcosa con Qromo il 3 novembre?')?.sql === "SELECT x FROM (SELECT 1 AS x FROM qromo_sales WHERE data = '2026-11-03') t LIMIT 1");
  t('mese passato senza anno = ultima occorrenza (dicembre a novembre 2026 = dicembre 2025)', /year = 2025 AND month = 12/.test(V('Abbiamo venduto qualcosa a dicembre?')?.sql ?? ''));
  t('domanda senza periodo: tutti i dati, e il testo lo dice', /\(in tutti i dati dell'app\)\./.test(V('Abbiamo mai venduto qualcosa in negozio?')?.no ?? '') && !/WHERE true AND|data =|year =/.test(V('Abbiamo mai venduto qualcosa in negozio?')?.sql.replace("kind IN ('vendita_manuale','vendita_fuori_fatturato') AND true", '') ?? 'x'));
  // tutte le domande trovate dalle due Gate 2 del 27-11: nessuna e' verificabile, quindi restano su TESTO_VUOTO
  const nonVerificabili = [
    'Abbiamo venduto la Lea cocco verde a novembre?', 'Abbiamo venduto borse Nina a ottobre?', 'Abbiamo venduto qualcosa a Giulia Rossi in negozio a novembre?',
    'Abbiamo venduto piu\' di 3 borse in negozio ieri?', 'Ci sono ordini sopra i 300 euro a novembre?', 'Ci sono ordini non evasi?', 'Ci sono ordini da spedire oggi?',
    "C'e' qualche spesa da approvare?", 'Ci sono spese sopra i 1000 euro a novembre?', "È vero che non abbiamo venduto nulla in negozio ieri?", 'Abbiamo venduto zero borse in negozio ieri?',
    'Abbiamo chiuso ieri senza vendite in negozio?', 'Abbiamo venduto qualcosa in negozio il primo novembre?', 'Abbiamo venduto qualcosa in negozio a fine novembre?',
    'Abbiamo ricevuto ordini online ieri sera?', "Abbiamo venduto qualcosa l'altro ieri?", 'Abbiamo venduto qualcosa in negozio il 30 novembre?', 'Abbiamo venduto qualcosa sullo shop ieri?',
    'Abbiamo venduto qualcosa ai negozi a ottobre?', 'Ci sono ordini B2B a ottobre?', 'Abbiamo venduto qualcosa questa settimana?', 'Abbiamo venduto e speso qualcosa ieri?',
    'Abbiamo speso in marketing e tasse a novembre?', 'Sono arrivate le borse Lea?', 'Ci sono stati resi a novembre?', 'Ci sono borse esaurite?', 'Abbiamo venduto la stessa borsa sia online che in negozio a novembre?',
    'Abbiamo venduto qualcosa nel 2027?', 'Abbiamo venduto qualcosa il 31 novembre?', 'Abbiamo venduto qualcosa ieri e oggi?', 'Ci sono ordini in negozio ieri?'];
  const passati = nonVerificabili.filter((d) => V(d) !== null);
  t('prodotti, clienti, importi, stati, negazioni, giorni presi per mesi, ore, futuro, canali ambigui, due argomenti: niente verifica', passati.length === 0, passati);
  t('la verifica non guarda la query del modello (nessun parametro sql)', !/export function verificaSiNo\([^)]*sql/.test(SRC));
  t('flusso: verifica solo con zero righe, query del codice via ask_select con retryOnce, testi del codice, altrimenti TESTO_VUOTO; nessun modello',
    /if \(righeVuote\(rows\)\) \{[\s\S]{0,400}const v = verificaSiNo\(question, oggi, new Date\(\)\);\n\s*if \(v\) \{\n\s*const \{ data: esiste, error: vErr \} = await retryOnce\(\(\) => sb\.rpc\('ask_select', \{ q: v\.sql \}\)\);\n\s*if \(!vErr && Array\.isArray\(esiste\)\) return json\(\{ ok: true, testo: esiste\.length \? v\.si : v\.no, sql, sql_verifica: v\.sql, righe: rows, uso: usoOut\(\) \}\);/.test(SRC)
    && /console\.warn\('assistant: verifica si\/no fallita: '[^\n]*\n\s*\}\n\s*return json\(\{ ok: true, testo: TESTO_VUOTO/.test(SRC)
    && !/ISTRUZIONI_NO|FORMATO_NO|rispostaNo/.test(SRC));
  t('una riga di soli id (SELECT order_id) con un valore NON e\' vuota (Gate 2 del 27-11, A1: bug gia\' in produzione)',
    M.righeVuote([{ order_id: '#1801' }]) === false && M.righeVuote([{ order_id: null }]) === true && M.righeVuote([{ year: 2026, month: 11 }]) === false);
  t('la query non chiede mai di usare CURRENT_DATE o now()', /NEVER use CURRENT_DATE, now\(\) or interval arithmetic \(the database clock is UTC\)/.test(M.SCHEMA));
}

console.log('\n== storia: solo le domande dell\'utente ==');
const ST = M.storiaUtente([{ ruolo: 'user', testo: 'q1' }, { ruolo: 'assistant', testo: 'il totale e\' nullo' }, { ruolo: 'user', testo: 'q2' }, { ruolo: 'user', testo: 'q3' }, { ruolo: 'user', testo: 'q4' }, { ruolo: 'user', testo: 'q5' }]);
t('le risposte dell\'assistente non tornano nel prompt', !/nullo/.test(ST));
t('ultime 4 domande', /- q2\n- q3\n- q4\n- q5/.test(ST) && !/q1/.test(ST));
t('storia non valida -> stringa vuota', M.storiaUtente(null) === '' && M.storiaUtente('x') === '');

console.log('\n== controllo del periodo nel flusso ==');
t('controllaPeriodo prima di ask_select, con UNA riscrittura e poi il testo onesto',
  SRC.indexOf('controllaPeriodo(question, passo.sql, oggi, storia)') < SRC.indexOf("sb.rpc('ask_select'") && /return json\(\{ ok: true, testo: TESTO_PERIODO/.test(SRC));

console.log('\n== costi ==');
t('costo Opus 5.5: 1M input = 4 USD, 1M output = 20, 1M letture cache = 0,20', M.costoUsd('claude-opus-5-5', { input: 1e6, output: 0, cache_scrittura: 0, cache_lettura: 0 }) === 4
  && M.costoUsd('claude-opus-5-5', { input: 0, output: 1e6, cache_scrittura: 0, cache_lettura: 0 }) === 20
  && M.costoUsd('claude-opus-5-5', { input: 0, output: 0, cache_scrittura: 0, cache_lettura: 1e6 }) === 0.2);
t('una domanda tipica (5.000 in, 1.500 out) costa 0,05 USD', M.costoUsd('claude-opus-5-5', { input: 5000, output: 1500, cache_scrittura: 0, cache_lettura: 0 }) === 0.05);
t('C7: una chiamata servita da un ripiego si paga ai prezzi del ripiego', M.costoUsd('claude-opus-4-8', { input: 1e6, output: 0, cache_scrittura: 0, cache_lettura: 0 }) === 5
  && /uso\.costo_usd = Math\.round\(\(uso\.costo_usd \+ costoUsd\(r\.model, u\)\) \* 1e6\) \/ 1e6;/.test(SRC));
t('modello sconosciuto -> prezzi di Opus 5.5, non NaN', M.costoUsd('claude-altro', { input: 1e6, output: 0, cache_scrittura: 0, cache_lettura: 0 }) === 4);

console.log('\n== tempo (Gate 2 del 26-11, B2: niente piu\' 4 chiamate da 60 s con ritentativi contro i 150 s dell\'edge) ==');
t('tetto della richiesta 120 s, chiamata fra 10 e 50 s', M.SCADENZA_MS === 120000 && M.CHIAMATA_MAX_MS === 50000 && M.CHIAMATA_MIN_MS === 10000);
t('tempoChiamata: all\'inizio 50 s, verso la fine il resto meno 3 s, sotto i 10 s nessuna chiamata',
  M.tempoChiamata(120000, 0) === 50000 && M.tempoChiamata(120000, 90000) === 27000 && M.tempoChiamata(120000, 108000) === null);
t('ogni chiamata prende il tempo dalla scadenza e non ritenta (l\'SDK su un 429 aspetta il retry-after senza tetto)',
  /const timeout = tempoChiamata\(p\.scadenza, Date\.now\(\)\);\n\s*if \(timeout == null\) throw new TempoFinito/.test(SRC) && /\{ timeout, maxRetries: 0 \}/.test(SRC) && !/maxRetries: [1-9]/.test(SRC));
t('scadenza unica per la richiesta, passata a ogni chiamata', /const scadenza = Date\.now\(\) \+ SCADENZA_MS;/.test(SRC) && (SRC.match(/scadenza[,}\s]/g) || []).length >= 6);
t('senza tempo per riscrivere la query: TESTO_PERIODO, mai un numero del periodo sbagliato',
  /if \(tempoChiamata\(scadenza, Date\.now\(\)\) == null\) return json\(\{ ok: true, testo: TESTO_PERIODO/.test(SRC));

console.log('\n== resta in sola lettura ==');
t('nessuna scrittura: niente insert/update/delete/upsert, e ogni rpc e\' ask_select (sola lettura)', !/\.(insert|update|delete|upsert)\(/.test(SRC)
  && (SRC.match(/\.rpc\(/g) || []).length === (SRC.match(/\.rpc\('ask_select'/g) || []).length && (SRC.match(/\.rpc\('ask_select'/g) || []).length === 2);
t('la proposta di spesa resta una proposta (write-api la scrive dall\'app)', /tipo: 'expense_propose'/.test(SRC) && !/write-api|writeApi/.test(SRC.replace(/\/\/[^\n]*/g, '')));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
