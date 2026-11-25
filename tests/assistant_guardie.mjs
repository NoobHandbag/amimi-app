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
  'MESI', 'TESTO_VUOTO', 'oggiRoma', 'cleanSql', 'aNumero', 'storiaUtente', 'mesiNellaDomanda', 'anniNellaDomanda', 'controllaPeriodo', 'righeVuote',
  'totaliCalcolati', 'numeriNelTesto', 'numeriNonVerificati', 'valoriConsentiti', 'costoUsd'];
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
t('un mese nominato va filtrato nella query', /When the question names a month or a year, the SELECT MUST filter on it/.test(S));

console.log('\n== data di oggi a Roma ==');
t('25-11 23:30 UTC = 26-11 a Roma', M.oggiRoma(new Date('2026-11-25T23:30:00Z')) === '2026-11-26');
t('31-12 23:30 UTC = 01-01-2027 a Roma', M.oggiRoma(new Date('2026-12-31T23:30:00Z')) === '2027-01-01');
t('estate (UTC+2): 30-06 22:30 UTC = 01-07', M.oggiRoma(new Date('2026-06-30T22:30:00Z')) === '2026-07-01');

console.log('\n== controllo del periodo (query vere del 25-11) ==');
const NOV = 'Quanto abbiamo venduto offline a novembre';
t('il venduto di sempre: SUM su v_inventory senza mese -> bloccata', M.controllaPeriodo(NOV, 'SELECT sum(qromo_sold * retail_price) as venduto_offline_lordo FROM v_inventory') !== null);
t('qromo_sales month = 11 AND year = 2026 -> passa', M.controllaPeriodo(NOV, 'SELECT SUM(quantita * prezzo) AS t FROM qromo_sales WHERE month = 11 AND year = 2026') === null);
t('v_ce_totale year = 2026 AND month = 11 -> passa', M.controllaPeriodo(NOV, 'SELECT year, month, offline_lordo, offline_netto FROM v_ce_totale WHERE year = 2026 AND month = 11') === null);
t('follow-up "Per ottobre?" con month = 10 -> passa', M.controllaPeriodo('Per ottobre? Intendo vendite non online', 'SELECT codice FROM qromo_sales WHERE month = 10') === null);
t('novembre ma la query filtra month = 1 -> bloccata', M.controllaPeriodo(NOV, 'SELECT * FROM v_ce_totale WHERE year = 2026 AND month = 1') !== null);
t('gennaio ma la query filtra month = 11 -> bloccata', M.controllaPeriodo('vendite di gennaio', 'SELECT * FROM v_ce_totale WHERE month = 11') !== null);
t('gennaio con month = 10 -> bloccata (1 non e\' dentro 10)', M.controllaPeriodo('vendite di gennaio', 'SELECT * FROM v_ce_totale WHERE month = 10') !== null);
t('intervallo di date sulla colonna data -> passa', M.controllaPeriodo(NOV, "SELECT SUM(prezzo) FROM qromo_sales WHERE data >= '2026-11-01' AND data < '2026-12-01'") === null);
t('EXTRACT(MONTH FROM data) = 11 -> passa', M.controllaPeriodo(NOV, 'SELECT SUM(prezzo) FROM qromo_sales WHERE EXTRACT(MONTH FROM data) = 11') === null);
t("to_char(data, 'YYYY-MM') = '2026-11' -> passa", M.controllaPeriodo(NOV, "SELECT SUM(prezzo) FROM qromo_sales WHERE to_char(data, 'YYYY-MM') = '2026-11'") === null);
t('month IN (10, 11) per ottobre -> passa', M.controllaPeriodo('e a ottobre?', 'SELECT * FROM v_ce_totale WHERE month IN (10, 11)') === null);
t('da gennaio a settembre con BETWEEN 1 AND 9 -> passa', M.controllaPeriodo('vendite da gennaio a settembre 2026', 'SELECT * FROM v_ce_totale WHERE year = 2026 AND month BETWEEN 1 AND 9') === null);
t('da gennaio a settembre con month <= 9 -> passa (basta un mese dell\'intervallo)', M.controllaPeriodo('vendite da gennaio a settembre 2026', 'SELECT * FROM v_ce_totale WHERE year = 2026 AND month <= 9') === null);
t('anno nominato ma assente dalla query -> bloccata', M.controllaPeriodo('vendite offline di novembre 2025', 'SELECT * FROM v_ce_totale WHERE year = 2026 AND month = 11') !== null);
t('nessun periodo nella domanda -> nessun controllo', M.controllaPeriodo('quali borse sono esaurite?', 'SELECT codice FROM v_inventory WHERE disponibili_da_vendere <= 0') === null);
t('"maggiore" non e\' maggio', JSON.stringify(M.mesiNellaDomanda('la borsa con il prezzo maggiore')) === '[]');
t('mesi riconosciuti anche con maiuscole e punteggiatura', JSON.stringify(M.mesiNellaDomanda('Novembre, e Ottobre?')) === '[10,11]');
t('anni nella domanda', JSON.stringify(M.anniNellaDomanda('nel 2025 e nel 2026, non 120260')) === '[2025,2026]');

console.log('\n== righe vuote: "la ricerca non ha trovato righe", mai "vendite nulle" ==');
t('nessuna riga -> vuota', M.righeVuote([]) === true);
t('una riga tutta null (SUM su zero righe, il caso "nullo" del 25-11) -> vuota', M.righeVuote([{ totale_venduto_offline: null }]) === true);
t('uno zero vero non e\' vuoto', M.righeVuote([{ totale: 0 }]) === false);
t('una riga con un valore non e\' vuota', M.righeVuote([{ a: null, b: 'x' }]) === false);
t('il testo per le righe vuote non parla di vendite nulle', !/null|zero|nessuna vendita/i.test(M.TESTO_VUOTO) && /non ha trovato righe/.test(M.TESTO_VUOTO));
t('il flusso usa righeVuote prima del passo risposta', /if \(righeVuote\(rows\)\) return json\(\{ ok: true, testo: TESTO_VUOTO/.test(SRC)
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
t('"3.456" letto come 3456 o come 3,456', JSON.stringify(M.numeriNelTesto('3.456')[0].letture) === '[3456,3.456]');
t('numeri dentro i codici prodotto non si leggono', M.numeriNelTesto('COLD_AD_2 e LEA2').length === 0);
t('cifre dentro le stringhe delle righe ammesse (varianti, date)', M.numeriNonVerificati('la MAXI 2 venduta il 3 marzo', M.valoriConsentiti([{ variant: 'MAXI 2' }], { righe: 1, colonne: {} }, 'x', 'SELECT 1')).length === 0);
t('il flusso riscrive UNA volta e poi passa al testo senza cifre',
  /for \(let tentativo = 0; tentativo < 2; tentativo\+\+\)/.test(SRC) && /if \(tentativo === 1\) testo = TESTO_NUMERI;/.test(SRC));
t('il passo risposta vede la query (periodo e filtri) e i totali calcolati', /Query SQL eseguita: \$\{sql\}/.test(SRC) && /TOTALI CALCOLATI DAL PROGRAMMA/.test(SRC) && /TOTALI CALCOLATI DAL PROGRAMMA/.test(M.ISTRUZIONI_RISPOSTA));
t('istruzioni: niente conti a mente, formato italiano, IVA e periodo dichiarati',
  /Non fare mai somme, medie, differenze, percentuali o conversioni a mente/.test(M.ISTRUZIONI_RISPOSTA) && /1\.234,50 €/.test(M.ISTRUZIONI_RISPOSTA)
  && /con IVA/.test(M.ISTRUZIONI_RISPOSTA) && /fino a oggi/.test(M.ISTRUZIONI_RISPOSTA));

console.log('\n== storia: solo le domande dell\'utente ==');
const ST = M.storiaUtente([{ ruolo: 'user', testo: 'q1' }, { ruolo: 'assistant', testo: 'il totale e\' nullo' }, { ruolo: 'user', testo: 'q2' }, { ruolo: 'user', testo: 'q3' }, { ruolo: 'user', testo: 'q4' }, { ruolo: 'user', testo: 'q5' }]);
t('le risposte dell\'assistente non tornano nel prompt', !/nullo/.test(ST));
t('ultime 4 domande', /- q2\n- q3\n- q4\n- q5/.test(ST) && !/q1/.test(ST));
t('storia non valida -> stringa vuota', M.storiaUtente(null) === '' && M.storiaUtente('x') === '');

console.log('\n== controllo del periodo nel flusso ==');
t('controllaPeriodo prima di ask_select, con UNA riscrittura e poi il testo onesto',
  SRC.indexOf('controllaPeriodo(question, passo.sql)') < SRC.indexOf("sb.rpc('ask_select'") && /return json\(\{ ok: true, testo: TESTO_PERIODO/.test(SRC));

console.log('\n== costi ==');
t('costo Opus 5.5: 1M input = 4 USD, 1M output = 20, 1M letture cache = 0,20', M.costoUsd('claude-opus-5-5', { input: 1e6, output: 0, cache_scrittura: 0, cache_lettura: 0 }) === 4
  && M.costoUsd('claude-opus-5-5', { input: 0, output: 1e6, cache_scrittura: 0, cache_lettura: 0 }) === 20
  && M.costoUsd('claude-opus-5-5', { input: 0, output: 0, cache_scrittura: 0, cache_lettura: 1e6 }) === 0.2);
t('una domanda tipica (5.000 in, 1.500 out) costa 0,05 USD', M.costoUsd('claude-opus-5-5', { input: 5000, output: 1500, cache_scrittura: 0, cache_lettura: 0 }) === 0.05);
t('modello sconosciuto (fallback) -> prezzi di Opus 5.5, non NaN', M.costoUsd('claude-altro', { input: 1e6, output: 0, cache_scrittura: 0, cache_lettura: 0 }) === 4);

console.log('\n== resta in sola lettura ==');
t('nessuna scrittura: niente insert/update/delete/upsert/rpc diverse da ask_select', !/\.(insert|update|delete|upsert)\(/.test(SRC) && (SRC.match(/\.rpc\(/g) || []).length === 1);
t('la proposta di spesa resta una proposta (write-api la scrive dall\'app)', /tipo: 'expense_propose'/.test(SRC) && !/write-api|writeApi/.test(SRC.replace(/\/\/[^\n]*/g, '')));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
