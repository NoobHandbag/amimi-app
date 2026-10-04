// tests/foglio_ordine.mjs: ordine da FOGLIO scritto a mano (04-10). Offline, senza rete: comportamento di
// normalizzaOutput/validaOutput sul target foglio_ordine (lo stesso prompt.ts della edge) + guardie sul sorgente della
// edge e della schermata. La lettura vera dei fogli e' nel golden manuale tests/foglio_ordine_golden.mjs.
//   node tests/foglio_ordine.mjs
import { readFileSync } from 'node:fs';
import { normalizzaOutput, validaOutput, responseSchema, buildPrompt, MODELLO_FOGLIO_DEFAULT } from '../supabase/functions/ai-compila/prompt.ts';

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 200) : '')); } };
const campo = (valore, confidenza = 0.9) => ({ valore, confidenza, fonte: '' });
const riga = (x = {}) => ({
  foglio: 1, posizione: 1, modello: { ...campo('LEA BAG'), match_esistente: 'LEA BAG' }, campione: { descrizione: 'cocco verde', scritto: null },
  candidati: [], quantita: campo(10), tutta: false, stima_pezzi: null, quantita_scritta: '10', interno: campo('91'), note: null, box: [100, 50, 200, 900], ...x,
});
const proposta = (righe) => ({ avviso: null, fornitore: { ...campo(null, 0), match_esistente: null }, data_ordine: campo(null, 0), righe, note: campo(null, 0) });
const CTX = { catalogo: ['LEA BAG | COCCO GREEN', 'LEA BAG | ZEBRA PONY', 'LEA BAG | COCCO_ORANGE', 'LEA BAG MAXI | COCCO BLACK'] };
const norm = (p) => normalizzaOutput('foglio_ordine', JSON.parse(JSON.stringify(p)), CTX);

console.log('\n== foglio_ordine: normalizzazione e validazione ==');
{
  const p = norm(proposta([riga({ candidati: ['cocco green', 'COCCO NERO INVENTATO', 'LEA BAG | Cocco_Orange', 'COCCO BLACK'] })]));
  t('1 candidati: solo varianti del catalogo del MODELLO del foglio, col nome esatto del catalogo', JSON.stringify(p.righe[0].candidati) === JSON.stringify(['COCCO GREEN', 'COCCO_ORANGE']), JSON.stringify(p.righe[0].candidati));
  t('2 candidati: una variante di un ALTRO modello (COCCO BLACK e\' solo della Maxi) non passa', !p.righe[0].candidati.includes('COCCO BLACK'));
}
{
  const p = norm(proposta([riga({ candidati: ['A', 'B', 'C', 'D'] })]));
  t('3 senza match nel catalogo nessun candidato inventato', p.righe[0].candidati.length === 0, JSON.stringify(p.righe[0].candidati));
}
{
  const p = norm(proposta([riga({ tutta: true, quantita: campo(10), stima_pezzi: null })]));
  t('4 TUTTA con un numero in quantita: il numero diventa la stima, la quantita torna null', p.righe[0].quantita.valore === null && p.righe[0].stima_pezzi === 10, JSON.stringify(p.righe[0]));
  t('5 ...e la proposta normalizzata e\' valida', validaOutput('foglio_ordine', p) === null, validaOutput('foglio_ordine', p));
}
{
  const p = norm(proposta([riga({ tutta: true, quantita: campo(12), stima_pezzi: 40 })]));
  t('6 TUTTA con stima gia\' letta: la stima resta quella, la quantita torna null', p.righe[0].quantita.valore === null && p.righe[0].stima_pezzi === 40);
}
t('7 validaOutput: riga TUTTA con quantita (non normalizzata) = rifiutata', /TUTTA/.test(validaOutput('foglio_ordine', proposta([riga({ tutta: true, quantita: campo(5) })])) ?? ''));
t('8 validaOutput: quantita non intera = rifiutata', /quantita/.test(validaOutput('foglio_ordine', proposta([riga({ quantita: campo(2.5) })])) ?? ''));
t('9 validaOutput: tutta non booleano = rifiutata', /tutta/.test(validaOutput('foglio_ordine', proposta([riga({ tutta: 'si' })])) ?? ''));
t('10 validaOutput: candidati mancanti = rifiutata', /candidati/.test(validaOutput('foglio_ordine', proposta([riga({ candidati: undefined })])) ?? ''));
{
  const p = norm(proposta([riga({ box: [300, 10, 200, 900] }), riga({ box: [1, 2, 3] }), riga({ box: [-20, 0, 1200, 1000] }), riga({ stima_pezzi: 'dieci' })]));
  t('11 box: rettangolo rovesciato o incompleto = null, fuori scala = riportato in 0-1000', p.righe[0].box === null && p.righe[1].box === null && JSON.stringify(p.righe[2].box) === '[0,0,1000,1000]', JSON.stringify(p.righe.map((r) => r.box)));
  t('12 stima non numerica = null', p.righe[3].stima_pezzi === null);
}
{
  const p = normalizzaOutput('foglio_ordine', JSON.parse(JSON.stringify(proposta([riga({ candidati: ['X'] })]))), { catalogo: 'non e\' una lista' });
  t('13 contesto con catalogo non-lista: nessun crash, candidati lasciati (li filtra comunque il client)', Array.isArray(p.righe[0].candidati));
  t('14 buildPrompt regge un catalogo non-lista', typeof buildPrompt('foglio_ordine', '', { catalogo: 'x' }) === 'string');
}
{
  const s = responseSchema('foglio_ordine');
  const it = s.properties.righe.items;
  t('15 responseSchema foglio: righe con candidati, tutta, stima, interno, box obbligatori', ['candidati', 'tutta', 'stima_pezzi', 'interno', 'box', 'quantita'].every((k) => it.required.includes(k)));
  t('16 responseSchema ordine_prodotti invariato (niente campi del foglio)', !('candidati' in responseSchema('ordine_prodotti').properties.righe.items.properties));
  const pr = buildPrompt('foglio_ordine', '', CTX);
  t('17 prompt: TUTTA = quantita da definire all\'arrivo, stima mai in quantita, cancellature ignorate', /"tutta" e' true e "quantita.valore" e' null/.test(pr) && /mai in "quantita"/.test(pr) && /CANCELLATE/.test(pr));
  t('18 prompt: candidati solo dalla lista, mai un nome fuori lista; catalogo nel prompt', /Mai un nome fuori lista/.test(pr) && pr.includes('LEA BAG | ZEBRA PONY'));
  t('19 modello di default del foglio = flash (misura del 04-10)', MODELLO_FOGLIO_DEFAULT === 'gemini-flash-latest');
}

console.log('\n== foglio_ordine: guardie sul sorgente ==');
const AI = readFileSync(new URL('../supabase/functions/ai-compila/index.ts', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../web/src/components/FoglioOrdine.tsx', import.meta.url), 'utf8');
const ORD = readFileSync(new URL('../web/src/pages/Ordini.tsx', import.meta.url), 'utf8');
t('20 edge: target foglio_ordine ammesso, modello da ai_foglio_model CARICATO nella whitelist dei flag', /'foglio_ordine'\]\)/.test(AI) && /\.in\('key', \[[^\]]*'ai_foglio_model'/.test(AI) && /fmap\.get\('ai_foglio_model'\)/.test(AI));
t('21 edge: timeout del foglio dedicato, quello comune invariato', /TIMEOUT_FOGLIO_MS = 50000/.test(AI) && /TIMEOUT_MS = 25000/.test(AI) && /foglio \? TIMEOUT_FOGLIO_MS : TIMEOUT_MS/.test(AI));
t('22 edge: la normalizzazione riceve il contesto (filtro candidati sul catalogo)', /normalizzaOutput\(target, proposta, ctx\)/.test(AI));
t('23 schermata: scrive SOLO via createOrderMulti (write-api order_multi), mai insert diretti', /createOrderMulti\(forn\.trim\(\), dataOrd, payload, pin, chi\)/.test(UI) && !/\.(insert|update|upsert|delete)\(/.test(UI));
t('24 schermata: nessuna variante preselezionata (scelta parte null, si sceglie a mano)', /scelta: null, primoScelto: false, wip: !!x\.tutta/.test(UI) && !/scelta: \{ tipo: 'esistente'[^}]*\}[^\n]*candidati\[0\]\)/.test(UI.split('const daRiga')[1]?.split('async function leggi')[0] ?? ''));
t('25 schermata: TUTTA = riga WIP (da definire all\'arrivo), quantita 0 al server', /wip: !!x\.tutta/.test(UI) && /qty_ordered: r\.wip \? 0 : Number\(r\.qty\)/.test(UI));
t('26 schermata: interno nella nota della riga', /`Interno \$\{r\.interno\.trim\(\)\}`/.test(UI) && /note \}/.test(UI));
t('27 schermata: inserimento bloccato senza variante, quantita o fornitore, e con la stessa borsa su piu righe', /righe senza variante/.test(UI) && /quantità mancant/.test(UI) && /scegli il fornitore/.test(UI) && /stessa borsa su più righe/.test(UI) && /disabled=\{busy \|\| problemi\.length > 0\}/.test(UI));
t('28 schermata: un foglio per chiamata AI', /aiCompila<PropostaFoglio>\(chi, 'foglio_ordine', \[path\]/.test(UI));
t('29 schermata: varianti nuove solo su tocco esplicito, codice provvisorio derivato', /tipo: 'nuova', variant: nuova\.v\.trim\(\)/.test(UI) && /deriveCodice\(r\.modello, s\.variant\)/.test(UI));
t('30 Ordini: bottone "Ordine da foglio" solo a flag AI acceso; nota della riga visibile in lista', /\{aiOn && <button[\s\S]{0,160}setFoglio\(true\)/.test(ORD) && /\{l\.note && </.test(ORD));

console.log(`\n== ${ok} ok, ${ko} KO ==`);
process.exit(ko ? 1 : 0);
