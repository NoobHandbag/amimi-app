// tests/push_eventi_core.mjs: i blocchi PURE di push-eventi ritagliati DAL SORGENTE che va in produzione (candidati e
// messaggi dei sei eventi, ora di Roma del riepilogo, registro e baseline, giro di un evento con scritture e invio finti),
// piu' le guardie sul sorgente (PIN prima di tutto, anteprima solo con la chiave di servizio, NO-OP a flag spento, solo
// gli eventi accesi, inviaPush e mai il ripiego su ntfy, .limit su ogni lettura, error destrutturato, nessun ritentativo
// sulle scritture, nelle select solo le colonne ammesse). Nessuna rete, nessun DB.
//   node tests/push_eventi_core.mjs
// Perche' esiste (18-10, brief push_eventi_per_profilo): la edge manda notifiche vere ai telefoni del team a partire da
// dati che contengono nomi, email e testi delle clienti. Un campo copiato per sbaglio nel testo, un registro che lascia
// passare due volte la stessa chiave o un'ora di Roma sbagliata al cambio d'ora non si vedono finche' non succedono.
// 19-10 (decisione di Dan, "RIMUOVI QUESTO. ANZI, DEVE DIRLO!!"): le push su una cliente (cs_urgente,
// cs_cliente_ha_riscritto, spedizione_eccezione) DEVONO portare il suo nome, o l'email senza nome; tutto il resto della
// riga (oggetto, snippet, riassunto, corpo, motivo dell'AI, stato_by, referente) resta fuori, e b2b, riepilogo e sistema
// non portano dati delle clienti. Casi N1-N13 e autocontrolli AN1-AN2; N14-N16 dalla Gate 2 del 19-10 (la notizia della
// spedizione prima del nome, senza nome i testi del 18-10, un nome che e' un'email segue le regole dell'email).
// 21-10 (v3, OK di Dan in chat): spedizioni solo sugli stati che sono un problema vero (SP1-SP4) ed evento attivita_team
// con la migr 0168 (AT, GR, AG, M): una push per persona e tipo, ogni riga di change_log coperta una volta sola.
// Gate 2 dello stesso giorno: elenco dei problemi allargato (SP1), settimana troncata (Q9), anteprima prima
// dell'accensione (AG12, AG13), GR13 e AG7 che contano invece di `every` su elenchi forse vuoti, 0168 confrontata intera
// e con la prova finale che puo' davvero fallire (M2-M4, AM1).
// 31-10 (v4, CASI_APERTI 53, blocco di Supabase di 14 ore): a una ripartenza dopo uno stallo si salta solo il pregresso
// vecchio e il fresco parte (57h-57j, G2, G2b, G7, E5-E5c, A14b); G2 ed E5 dicevano la regola di prima (tutto saltato).
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

process.removeAllListeners('warning');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const SRC = read('supabase/functions/push-eventi/index.ts');
const PUSH_API = read('supabase/functions/push-api/index.ts');
const SHARED = read('supabase/functions/_shared/push.ts');
const CONFIG = read('supabase/config.toml');
const BLOCCHI = ['pe-base', 'pe-tempo', 'pe-messaggi', 'pe-registro', 'pe-giro', 'pe-salute'];
const cut = (s, name) => {
  const B = `// ==== PURE:${name} BEGIN ====`, E = `// ==== PURE:${name} END ====`;
  const a = s.indexOf(B), b = s.indexOf(E);
  if (a < 0 || b < 0 || b < a) return null;
  return s.slice(a + B.length, b).trim();
};
for (const b of BLOCCHI) if (cut(SRC, b) === null) { console.error(`marcatori PURE:${b} non trovati in push-eventi`); process.exit(1); }
const ESPORTA = ['APP_URL', 'LINK_ASSISTENZA', 'LINK_SALUTE', 'CHI_PERSONE', 'TEMA_EVENTO', 'temaDi', 'linkNegozio', 'ugualeCostante', 'flagVero', 'pulisci',
  'plurale', 'euro', 'soglia', 'numeroOrdine', 'statoCorriere', 'nomeCliente', 'TITOLO_MAX_PUSH', 'partiRoma', 'offsetRomaMin', 'dataRoma', 'mezzanotteRoma', 'finestraRiepilogo',
  'giorniLavorativiDopo', 'candB2b', 'msgB2b', 'candCsUrgente', 'msgCsUrgente', 'motivoFisso', 'MOTIVI_FISSI', 'candCsRiscritto', 'msgCsRiscritto',
  'candSpedizione', 'msgSpedizione', 'candCsSync', 'msgCsSync', 'durata', 'candRiepilogo', 'righeRiepilogo', 'msgRiepilogo', 'sommaOrdini', 'sommaCassa',
  'ordiniInRitardo', 'STALLO_MS', 'PRENOTATO_SCADUTO_MS', 'MAX_TENTATIVI', 'TETTO_INVII', 'serveBaseline', 'pianifica', 'statoDaEsito', 'esitoDaSalvare', 'eseguiPiano',
  'contaArrivi', 'RITARDO_LETTURA_MAX_MS', 'FINESTRA_RISCRITTO_MS', 'EVENTI_DI_STATO', 'baselineDi', 'chiusura', 'saluteGiro', 'conPrecedente', 'causaSicura', 'SEP_PRIMO',
  // 21-10 (v3): stati del corriere che sono un problema vero, evento attivita_team e giro a gruppi
  'statoProblema', 'contaProblemi', 'PROBLEMI_CORRIERE', 'candAttivita', 'msgGruppoAttivita', 'msgAttivita', 'PERSONA_TEAM', 'OP_ATTIVITA', 'eseguiGruppi'];
// Gate 3 (18-10): il resto della edge (letture degli eventi, giro, run, salute, anteprima) ritagliato DAL SORGENTE e
// guidato con un client finto che registra ogni chiamata. Tolti solo gli import e Deno.serve; inviaPush e sleep arrivano
// dal test (sleep registra la pausa e non aspetta: la rilettura di cs_sync e il ritentativo restano veri, solo istantanei).
const SLEEP_SRC = 'const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));';
const IMPURO = (() => {
  const a = SRC.indexOf('// ==== PURE:pe-salute END ===='), b = SRC.indexOf('Deno.serve(async (req) => {'), c = SRC.indexOf('// Anteprima: SOLO letture.');
  if (a < 0 || b < a || c < b || !SRC.includes(SLEEP_SRC)) return null;
  return SRC.slice(a, b).replace(SLEEP_SRC, 'const sleep = (ms: number) => { globalThis.__sonni.push(ms); return Promise.resolve(); };') + '\n' + SRC.slice(c);
})();
if (IMPURO === null) { console.error('parte impura di push-eventi non ritagliabile (marcatori, Deno.serve, anteprima o sleep cambiati)'); process.exit(1); }
const ESPORTA_IMPURO = ['EVENTI', 'ORDINE', 'giroEvento', 'eseguiRun', 'anteprima', 'leggiRegistro', 'depGiro', 'contaPerse24h', 'scriviSalute', 'LetturaFallita',
  'ScritturaFallita', 'causaDi', 'RILETTURA_CS_SYNC_MS', 'TEMPO_EVENTI_MS', 'SCADENZA_INVII_MS', 'leggiRigheOrdini', 'LIMITE_ATTIVITA', 'RIGHE_ORDINE_MAX'];
// fuori dal repo (come shopify_sync_guardie): una run interrotta non lascia un file da committare per sbaglio
const TMP_DIR = mkdtempSync(join(tmpdir(), 'amimi-push-eventi-'));
const TMP = join(TMP_DIR, 'pe.mjs'), TMP_I = join(TMP_DIR, 'pe_impuro.mjs'), TMP_P = join(TMP_DIR, 'push_payload.mjs');
const PURI = BLOCCHI.map((b) => cut(SRC, b)).join('\n');
// 19-10: il payload vero di push-api (blocco PURE push-payload, ritagliato dal suo sorgente) per misurare i titoli col nome
const PAYLOAD_API = cut(PUSH_API, 'push-payload');
if (PAYLOAD_API === null) { console.error('marcatori PURE:push-payload non trovati in push-api'); process.exit(1); }
writeFileSync(TMP, stripTypeScriptTypes(`${PURI}\nexport { ${ESPORTA.join(', ')} };\n`), 'utf8');
writeFileSync(TMP_I, stripTypeScriptTypes(`const inviaPush = (m) => globalThis.__invia(m);\n${PURI}\n${IMPURO}\nexport { ${[...ESPORTA, ...ESPORTA_IMPURO].join(', ')} };\n`), 'utf8');
writeFileSync(TMP_P, stripTypeScriptTypes(`${PAYLOAD_API}\nexport { costruisciPayload, PAYLOAD_MAX, TITOLO_MAX };\n`), 'utf8');
let M, MI, MP;
try { M = await import(pathToFileURL(TMP).href); MI = await import(pathToFileURL(TMP_I).href); MP = await import(pathToFileURL(TMP_P).href); } finally { try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* niente */ } }
const { APP_URL, LINK_ASSISTENZA, LINK_SALUTE, CHI_PERSONE, TEMA_EVENTO, temaDi, linkNegozio, ugualeCostante, flagVero, pulisci, plurale, euro, soglia, numeroOrdine,
  statoCorriere, nomeCliente, TITOLO_MAX_PUSH, partiRoma, offsetRomaMin, dataRoma, mezzanotteRoma, finestraRiepilogo, giorniLavorativiDopo, candB2b, msgB2b, candCsUrgente, msgCsUrgente, motivoFisso,
  MOTIVI_FISSI, candCsRiscritto, msgCsRiscritto, candSpedizione, msgSpedizione, candCsSync, msgCsSync, durata, candRiepilogo, righeRiepilogo, msgRiepilogo, sommaOrdini,
  sommaCassa, ordiniInRitardo, STALLO_MS, PRENOTATO_SCADUTO_MS, MAX_TENTATIVI, TETTO_INVII, serveBaseline, pianifica, statoDaEsito, esitoDaSalvare, eseguiPiano,
  contaArrivi, RITARDO_LETTURA_MAX_MS, FINESTRA_RISCRITTO_MS, EVENTI_DI_STATO, baselineDi, chiusura, saluteGiro, conPrecedente, causaSicura, SEP_PRIMO,
  statoProblema, contaProblemi, PROBLEMI_CORRIERE, candAttivita, msgGruppoAttivita, msgAttivita, PERSONA_TEAM, OP_ATTIVITA, eseguiGruppi } = M;

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 260) : '')); } };
const T = (s) => Date.parse(s);
const EM_DASH = String.fromCodePoint(0x2014);
const EMOJI = String.fromCodePoint(0x1f600);
const U1 = '3f2504e0-4f89-41d3-9a0c-0305e82c3301', U2 = '11111111-2222-4333-8444-555555555555', U3 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
// dati personali di prova. Decisione di Dan del 19-10: il nome della cliente (customer_name) o, senza nome, la sua email
// (customer_email) DEVONO arrivare nel titolo di cs_urgente, cs_cliente_ha_riscritto e spedizione_eccezione (CLIENTE);
// tutto il resto (PII) mai, in nessuna push. Le colonne finte `email` e `nome_cliente` hanno valori diversi: un nome preso
// da un campo che non e' customer_name / customer_email si vede.
const CLIENTE = 'Maria Rossi', CLIENTE_EMAIL = 'maria.rossi@example.com';
const PII = ['Oggetto riservato', 'Snippet riservato', 'Corpo della risposta del negozio', 'matrimonio 27-07', 'Giulia Referente', '+39 333 1234567',
  'Via Roma 1', 'Riassunto riservato', 'Mittente <x@y.it>', 'esca@example.com', 'Nome Esca', 'Operatrice Esca'];
const conPII = (extra) => ({ customer_name: CLIENTE, customer_email: CLIENTE_EMAIL, email: PII[9], subject: PII[0], snippet: PII[1], body_clean: PII[2], body_text: PII[2],
  urgenza_motivo: PII[3], referente: PII[4], telefono: PII[5], indirizzo: PII[6], summary: PII[7], label: PII[8], nome_cliente: PII[10], stato_by: PII[11], ...extra });
const perde = (msgs) => { const s = JSON.stringify(msgs.map((m) => [m.titolo, m.testo, m.url])); return PII.filter((p) => s.includes(p)); };
// b2b, riepilogo, sistema e salute: nessun dato della cliente, nemmeno il nome
const perdeTutto = (msgs) => { const s = JSON.stringify(msgs.map((m) => [m.titolo, m.testo, m.url])); return [CLIENTE, CLIENTE_EMAIL, ...PII].filter((p) => s.includes(p)); };
const testoValido = (msgs) => msgs.every((m) => typeof m.titolo === 'string' && m.titolo && typeof m.testo === 'string' && m.testo && !m.titolo.includes(EM_DASH) && !m.testo.includes(EM_DASH) && m.url.startsWith(APP_URL));

console.log('== base ==');
{
  t('1  APP_URL uguale a push-api e a _shared/push.ts; link #assistenza e #salute', APP_URL === (PUSH_API.match(/const APP_URL = '([^']+)'/) ?? [])[1]
    && APP_URL === (SHARED.match(/export const APP_URL = '([^']+)'/) ?? [])[1] && LINK_ASSISTENZA === APP_URL + '#assistenza' && LINK_SALUTE === APP_URL + '#salute');
  const chiApi = (PUSH_API.match(/const CHI_AMMESSI = (\[[^\]]+\])/) ?? [])[1];
  t('2  CHI_PERSONE = CHI_AMMESSI di push-api (Ale, Bene, Ginevra)', JSON.stringify(CHI_PERSONE) === '["Ale","Bene","Ginevra"]' && chiApi === "['Ale', 'Bene', 'Ginevra']", chiApi);
  t('3  temi del contratto: negozi, assistenza (x2), spedizioni, sistema, riepilogo e, dalla 0168 del 21-10, attivita', isDeepStrictEqual(TEMA_EVENTO, { b2b_risposta_negozio: 'negozi', cs_urgente: 'assistenza',
    cs_cliente_ha_riscritto: 'assistenza', spedizione_eccezione: 'spedizioni', sistema_cs_sync_fermo: 'sistema', riepilogo: 'riepilogo', attivita_team: 'attivita' }));
  t('4  temaDi: la riga a DB vince se e\' una chiave valida, altrimenti il tema del codice; evento sconosciuto -> vuoto', temaDi('negozi_vip', 'b2b_risposta_negozio') === 'negozi_vip'
    && temaDi(null, 'cs_urgente') === 'assistenza' && temaDi('Assistenza!', 'cs_urgente') === 'assistenza' && temaDi(42, 'riepilogo') === 'riepilogo' && temaDi(null, 'boh') === '');
  t('5  linkNegozio: uuid -> #negozi/outreach/<id> minuscolo; altro (anche iniezioni) -> la pipeline', linkNegozio(U1.toUpperCase()) === APP_URL + '#negozi/outreach/' + U1
    && [null, '', 'abc', U1 + '#x', U1 + '/../x', 'javascript:alert(1)', 42].every((v) => linkNegozio(v) === APP_URL + '#negozi/outreach'));
  const K = 'a'.repeat(64);
  t('6  ugualeCostante: uguali si\', diversi / prefisso / vuoti no', ugualeCostante(K, K) && !ugualeCostante(K, K.slice(0, -1)) && !ugualeCostante(K, K.slice(0, -1) + 'b') && !ugualeCostante('', '') && !ugualeCostante('x', ''));
  const spenti = ['false', null, undefined, '', 'yes', '1', 'on', true, 1, {}, ['true'], 'tru'];
  t('7  flagVero: SOLO la stringa "true" (spazi e maiuscole tollerati)', ['true', ' TRUE ', 'True\n'].every(flagVero) && spenti.every((v) => flagVero(v) === false), spenti.filter(flagVero));
  t('8  pulisci: controlli e a capo -> spazio, spazi compressi, taglio per punti di codice (emoji intere), non stringa -> vuoto',
    pulisci('  Glit\nter\u0000  shop  ', 60) === 'Glit ter shop' && Array.from(pulisci(EMOJI.repeat(70), 60)).length === 60 && pulisci(5, 10) === '' && pulisci('abcdef', 3) === 'abc');
  t('9  plurale ed euro (punto delle migliaia, arrotondato, NaN -> 0)', plurale(1, 'ordine', 'ordini') === '1 ordine' && plurale(0, 'ordine', 'ordini') === '0 ordini'
    && euro(1012.5) === '1.013' && euro(1234567) === '1.234.567' && euro(999) === '999' && euro('x') === '0' && euro(-1500) === '-1.500' && euro(0) === '0');
  t('10 soglia: numero nell\'intervallo, altrimenti il default (stringhe, fuori range, soglie non oggetto)', soglia({ minuti_fermo: 30 }, 'minuti_fermo', 15, 5, 1440) === 30
    && soglia({ minuti_fermo: '30' }, 'minuti_fermo', 15, 5, 1440) === 15 && soglia({ minuti_fermo: 2 }, 'minuti_fermo', 15, 5, 1440) === 15
    && soglia(null, 'x', 6, 1, 48) === 6 && soglia([1], 'x', 6, 1, 48) === 6 && soglia({ x: NaN }, 'x', 6, 1, 48) === 6);
  t('11 numeroOrdine: solo cifre col #; nomi e altro -> vuoto', numeroOrdine('1890') === '#1890' && numeroOrdine('#1890') === '#1890' && numeroOrdine(1890) === '#1890'
    && ['Maria Rossi', '#18a', '', null, '1890 Maria', '#'].every((v) => numeroOrdine(v) === ''));
  t('12 statoCorriere: stati TWS veri tenuti (maiuscolo), il resto -> vuoto, al massimo 40', statoCorriere('indirizzo errato') === 'INDIRIZZO ERRATO'
    && statoCorriere('N. CIVICO MANCANTE/ERRATO') === 'N. CIVICO MANCANTE/ERRATO' && statoCorriere('RIFIUTATA DAL DESTINATARIO') === 'RIFIUTATA DAL DESTINATARIO'
    && statoCorriere('x <script>') === '' && statoCorriere('mail: a@b.it') === '' && statoCorriere('A'.repeat(60)).length === 40 && statoCorriere(null) === '');
  // 19-10 (decisione di Dan): chi e' la cliente
  const RLO = String.fromCodePoint(0x202e), ZWSP = String.fromCodePoint(0x200b), LRI = String.fromCodePoint(0x2066), NL = String.fromCodePoint(10);
  t('N1 nomeCliente: il nome ripulito (a capo e controlli -> spazio, spazi compressi) e vince sull\'email', nomeCliente('  Maria' + NL + ' Rossi ', CLIENTE_EMAIL) === 'Maria Rossi'
    && nomeCliente('Giulia', 'g@x.it') === 'Giulia' && nomeCliente('maria.rossi@example.com', 'altro@x.it') === 'maria.rossi@example.com');
  const lungo = nomeCliente(EMOJI.repeat(30) + 'A'.repeat(50), null);
  t('N2 nomeCliente: al massimo 60 punti di codice (emoji intere); caratteri di formato (direzione del testo, larghezza zero) tolti', Array.from(lungo).length === 60
    && lungo.startsWith(EMOJI.repeat(30)) && nomeCliente('Maria' + RLO + ' Ros' + ZWSP + 'si' + LRI, null) === 'Maria Rossi' && nomeCliente(RLO + ZWSP, 'a@b.it') === 'a@b.it', lungo);
  t('N3 nomeCliente: senza nome (vuoto, spazi, null, non stringa) l\'email, senza spazi ai lati e minuscola', nomeCliente('', ' Maria.Rossi@Example.COM ') === CLIENTE_EMAIL
    && nomeCliente('   ', 'a@b.co.uk') === 'a@b.co.uk' && nomeCliente(null, 'x.y+z@dominio.it') === 'x.y+z@dominio.it' && nomeCliente(42, 'a@b.it') === 'a@b.it'
    && nomeCliente(undefined, 'a'.repeat(75) + '@b.it') === 'a'.repeat(75) + '@b.it');
  const noEmail = ['maria', 'a@b', '@b.it', 'a@', 'a@b.', 'a@.it', 'a b@c.it', 'a@b@c.it', 'a' + NL + '@b.it', 'a@b.it' + RLO, 'a'.repeat(76) + '@b.it', '', null, 42, { a: 1 }];
  t('N4 nomeCliente: un\'email che non ha la forma di un\'email (o oltre 80 caratteri: tagliata non e\' piu\' un\'email), o niente -> vuoto', noEmail.every((v) => nomeCliente(null, v) === '')
    && nomeCliente(null, null) === '', noEmail.filter((v) => nomeCliente(null, v) !== ''));
  // C4 della Gate 2 del 19-10: 3 urgenti su 19 hanno come nome l'email stessa (il mittente senza nome)
  const nomeEmail = [nomeCliente(' Maria.Rossi@Example.COM ', null), nomeCliente('a'.repeat(75) + '@b.it', null), nomeCliente('a'.repeat(76) + '@b.it', 'Altra@X.it'),
    nomeCliente('a'.repeat(76) + '@b.it', null), nomeCliente('Maria' + RLO + '@Example.com', null)];
  t('N16 nomeCliente: un nome che e\' un\'email segue le regole dell\'email (minuscola, intera fino a 80 anche oltre 60, oltre 80 scartata e vale l\'email della cliente)',
    isDeepStrictEqual(nomeEmail, [CLIENTE_EMAIL, 'a'.repeat(75) + '@b.it', 'altra@x.it', '', 'maria@example.com']), nomeEmail);
}

console.log('\n== ora di Roma ==');
{
  t('13 sanita\' del calendario: 18-10-2026 e 25-10-2026 domenica, 29-03-2026 domenica', [Date.UTC(2026, 9, 18), Date.UTC(2026, 9, 25), Date.UTC(2026, 2, 29)].every((x) => new Date(x).getUTCDay() === 0));
  const p = partiRoma(T('2026-10-18T21:05:00Z'));
  t('14 partiRoma: 18-10 21:05Z = domenica 23:05 di Roma; dataRoma', p.wd === 'Sun' && p.h === 23 && p.mi === 5 && dataRoma(T('2026-10-18T21:05:00Z')) === '2026-10-18'
    && dataRoma(T('2026-10-18T22:30:00Z')) === '2026-10-19', p);
  t('15 offset: +120 d\'estate, +60 d\'inverno, cambio alle 01:00Z del 25-10', offsetRomaMin(T('2026-10-25T00:59:00Z')) === 120 && offsetRomaMin(T('2026-10-25T01:00:00Z')) === 60
    && offsetRomaMin(T('2026-01-10T12:00:00Z')) === 60 && offsetRomaMin(T('2026-03-29T01:00:00Z')) === 120 && offsetRomaMin(T('2026-03-29T00:59:00Z')) === 60);
  const f = (s) => finestraRiepilogo(T(s));
  const casi = [
    ['2026-10-19T16:29:59Z', false, '2026-10-19'], ['2026-10-19T16:30:00Z', true, '2026-10-19'], ['2026-10-18T17:00:00Z', false, '2026-10-18'],
    ['2026-10-24T16:30:00Z', true, '2026-10-24'], ['2026-10-25T17:30:00Z', false, '2026-10-25'], ['2026-10-26T16:45:00Z', false, '2026-10-26'],
    ['2026-10-26T17:29:00Z', false, '2026-10-26'], ['2026-10-26T17:30:00Z', true, '2026-10-26'], ['2026-10-26T22:59:00Z', true, '2026-10-26'],
    ['2026-10-26T23:00:00Z', false, '2026-10-27'], ['2026-03-27T17:29:00Z', false, '2026-03-27'], ['2026-03-27T17:30:00Z', true, '2026-03-27'],
    ['2026-03-30T16:30:00Z', true, '2026-03-30'], ['2026-03-30T16:29:00Z', false, '2026-03-30'], ['2026-10-19T03:00:00Z', false, '2026-10-19'],
  ];
  const sbagli = casi.filter(([s, a, d]) => f(s).aperta !== a || f(s).data !== d).map(([s]) => [s, f(s)]);
  t('16 riepilogo: dalle 18:30 di Roma, lunedi\'-sabato; domenica no (anche il 25-10 del cambio d\'ora); 16:45Z del 26-10 = 17:45 CET chiuso; mezzanotte cambia giorno',
    sbagli.length === 0, sbagli);
  t('17 ts del riepilogo = le 18:30 di Roma di quel giorno (16:30Z d\'estate, 17:30Z d\'inverno)', f('2026-10-19T20:00:00Z').ts === T('2026-10-19T16:30:00Z')
    && f('2026-10-26T20:00:00Z').ts === T('2026-10-26T17:30:00Z') && f('2026-03-30T20:00:00Z').ts === T('2026-03-30T16:30:00Z'));
  const mz = (s) => new Date(mezzanotteRoma(T(s))).toISOString();
  t('18 mezzanotteRoma: giorno normale, giorno del cambio d\'ora (00:00 CEST anche alle 19:00 CET), giorno dopo, 29-03',
    mz('2026-10-18T21:05:00Z') === '2026-10-17T22:00:00.000Z' && mz('2026-10-25T18:00:00Z') === '2026-10-24T22:00:00.000Z' && mz('2026-10-25T00:30:00Z') === '2026-10-24T22:00:00.000Z'
    && mz('2026-10-25T01:30:00Z') === '2026-10-24T22:00:00.000Z' && mz('2026-10-26T18:00:00Z') === '2026-10-25T23:00:00.000Z' && mz('2026-03-29T17:00:00Z') === '2026-03-28T23:00:00.000Z',
    [mz('2026-10-25T18:00:00Z'), mz('2026-03-29T17:00:00Z')]);
  t('19 giorni lavorativi (lun-ven, dopo la data dell\'ordine e fino a oggi)', giorniLavorativiDopo('2026-10-19', '2026-10-23') === 4 && giorniLavorativiDopo('2026-10-19', '2026-10-26') === 5
    && giorniLavorativiDopo('2026-10-23', '2026-10-26') === 1 && giorniLavorativiDopo('2026-10-24', '2026-10-26') === 1 && giorniLavorativiDopo('2026-10-18', '2026-10-25') === 5
    && giorniLavorativiDopo('2026-10-19', '2026-10-19') === 0 && giorniLavorativiDopo('2026-10-26', '2026-10-19') === 0 && giorniLavorativiDopo('x', '2026-10-19') === 0);
  // la data dell'ordine e' quella di Roma: 12-10 21:30Z = lunedi' 23:30 (5 giorni), 12-10 22:30Z = martedi' 00:30 (4 giorni). In UTC sarebbero lo stesso giorno.
  const rit = ordiniInRitardo([{ order_number: '1890', created_at_shop: '2026-10-12T21:30:00Z' }, { order_number: '1891', created_at_shop: '2026-10-12T22:30:00Z' },
    { order_number: 'Maria Rossi', created_at_shop: '2026-10-01T10:00:00Z' }, { order_number: '1892', created_at_shop: null }, { order_number: '1893', created_at_shop: '2026-10-01T10:00:00Z' }], '2026-10-19', 4);
  t('20 ordini in ritardo: oltre 4 giorni lavorativi sulla data di ROMA dell\'ordine; numeri non validi o date mancanti fuori', isDeepStrictEqual(rit, ['#1890', '#1893']), rit);
}

console.log('\n== candidati e messaggi (privacy) ==');
{
  const at = '2026-10-19T10:00:00.000Z';
  const righe = [conPII({ id: U1, account_id: U2, direzione: 'in', esito: null, at, chi: 'auto', canale: 'email' }),
    conPII({ id: U3, account_id: U2, direzione: 'in', esito: 'bounce', at }), conPII({ id: U2, account_id: U2, direzione: 'out', esito: null, at }),
    conPII({ id: 'non-uuid', account_id: U2, direzione: 'in', esito: null, at })];
  const c = candB2b(righe);
  t('21 b2b: solo i tocchi in senza esito con id uuid; chiave = id del tocco', c.length === 1 && c[0].chiave === U1 && c[0].ts === T(at) && c[0].rif.negozio === U2, c);
  const m = msgB2b(c, { [U2]: 'Glitter\nConcept  Store' }, 1);
  t('22 b2b: "<nome commerciale> ha risposto", scheda del negozio, tema negozi, totale da gestire', m.length === 1 && m[0].titolo === 'Glitter Concept Store ha risposto'
    && m[0].url === APP_URL + '#negozi/outreach/' + U2 && m[0].tema === 'negozi' && m[0].testo === 'In Negozi B2B: 1 risposta da gestire.' && !('chi' in m[0]), m);
  const m2 = msgB2b(c, {}, 0);
  t('23 b2b senza nome -> "Un negozio ha risposto"; nessun totale -> invito ad aprire la scheda', m2[0].titolo === 'Un negozio ha risposto' && m2[0].testo === 'Apri la scheda del negozio in Negozi B2B.');
  t('24 b2b: nessun dato personale della riga (corpo, oggetto, referente, email, nemmeno il nome di una cliente) nel messaggio', perdeTutto(m).length === 0 && perdeTutto(m2).length === 0
    && testoValido([...m, ...m2]), perdeTutto(m));

  // B1 (Gate 3 del 18-10): eta' da quando l'app ha visto la risposta (entro 72 ore dal messaggio), solo i tocchi del giro
  // automatico. Il caso Glitter del 14-10: risposta delle 16:33Z letta il giorno dopo alle 11:28Z (1.134 minuti).
  const ORA_B = T('2026-10-15T11:30:00Z'), H = 3600000, piano6 = (cs) => pianifica(cs, new Map(), { ora: ORA_B, baseline: false, etaMaxMs: 6 * H });
  const tocco = (o) => ({ id: U1, account_id: U2, direzione: 'in', esito: null, chi: 'auto', ...o });
  const glitter = candB2b([tocco({ at: '2026-10-14T16:33:00Z', created_at: '2026-10-15T11:28:00Z' })]);
  t('24b B1: risposta letta in ritardo (19 ore dopo il messaggio, vista 2 minuti fa) -> nuovo; ts = created_at', glitter.length === 1 && glitter[0].ts === T('2026-10-15T11:28:00Z')
    && piano6(glitter)[0].azione === 'nuovo' && RITARDO_LETTURA_MAX_MS === 72 * H, glitter);
  const recupero = candB2b([tocco({ at: new Date(ORA_B - 10 * 24 * H).toISOString(), created_at: new Date(ORA_B - 60000).toISOString() })]);
  t('24c B1: messaggio di 10 giorni fa importato adesso (recupero, aggancio di un thread) -> salta vecchio, nessuna push', piano6(recupero)[0].azione === 'salta' && piano6(recupero)[0].motivo === 'vecchio');
  t('24d B1: tocco scritto da una persona (portaConversazione, nuovo_negozio) o senza chi -> nessun candidato', [tocco({ chi: 'Benny', at: new Date(ORA_B - H).toISOString(), created_at: new Date(ORA_B - 60000).toISOString() }),
    tocco({ chi: null, at: new Date(ORA_B - H).toISOString() }), tocco({ chi: 'AUTO', at: new Date(ORA_B - H).toISOString() })].every((r) => candB2b([r]).length === 0));
  const due = candB2b([tocco({ id: U1, at: '2026-10-15T09:00:00Z' }), tocco({ id: U3, at: '2026-10-15T10:00:00Z' }), tocco({ id: '22222222-2222-4333-8444-555555555555', account_id: U3, at: '2026-10-15T08:00:00Z' })]);
  t('24e B1: per negozio solo il tocco piu\' recente del giro (un thread con piu\' risposte = una push)', due.length === 2 && due[0].chiave === U3 && due[1].rif.negozio === U3, due);
  const opt = candB2b([tocco({ esito: 'opt_out_da_verificare', at: '2026-10-15T11:00:00Z' }), tocco({ id: U3, account_id: U3, esito: 'opt_out', at: '2026-10-15T11:00:00Z' })]);
  const mo = msgB2b(opt, { [U2]: 'Glitter' }, 2);
  t('24f C7: un possibile opt-out da verificare (negozio gia\' avanti) e\' un messaggio da leggere; un opt-out vero no', opt.length === 1 && mo[0].titolo === 'Glitter: messaggio da leggere'
    && mo[0].testo === 'Forse chiede di non essere ricontattato: leggilo in Negozi B2B.' && mo[0].url === APP_URL + '#negozi/outreach/' + U2 && testoValido(mo), mo);

  const ev = [conPII({ id: 1, conversation_id: U1, azione: 'classify', urgente: 'true', at: '2026-10-19T09:00:00Z' }),
    conPII({ id: 2, conversation_id: U1, azione: 'urgenza_ricalcolo', urgente: true, at: '2026-10-19T09:30:00Z' }),
    conPII({ id: 3, conversation_id: U2, azione: 'classify', urgente: 'false', at }), conPII({ id: 4, conversation_id: U3, azione: 'summary', urgente: 'true', at }),
    conPII({ id: 5, conversation_id: 'x', azione: 'classify', urgente: 'true', at })];
  const cu = candCsUrgente(ev);
  t('25 cs_urgente: classify o urgenza_ricalcolo con urgente; una chiave <conversazione>:urgente, tenuto l\'evento piu\' recente', cu.length === 1 && cu[0].chiave === U1 + ':urgente'
    && cu[0].ts === T('2026-10-19T09:30:00Z') && cu[0].rif.conv === U1, cu);
  const conv = { [U1]: conPII({ id: U1, urgente: true, canale: 'email', stato: 'da_fare', categoria: 'Reso e rimborso', urgenza_motivo: 'matrimonio 27-07' }) };
  const mu = msgCsUrgente(cu, conv, 3);
  t('26 cs_urgente (19-10): "Richiesta urgente da <nome della cliente>", categoria e "3 urgenti aperte" nel testo, #assistenza, urgente; il motivo dell\'AI, oggetto, snippet, riassunto e stato_by NON entrano',
    mu.length === 1 && mu[0].titolo === 'Richiesta urgente da ' + CLIENTE && mu[0].testo === 'Reso e rimborso. 3 urgenti aperte.' && mu[0].url === LINK_ASSISTENZA && mu[0].urgente === true
    && mu[0].tema === 'assistenza' && perde(mu).length === 0 && testoValido(mu), { mu, perde: perde(mu) });
  const fisso = msgCsUrgente(cu, { [U1]: { ...conv[U1], urgenza_motivo: 'rischio disputa' } }, 1);
  t('27 cs_urgente: categoria, poi un motivo FISSO delle regole, tradotto, poi "1 urgente aperta"', fisso[0].testo === 'Reso e rimborso. Rischio di contestazione del pagamento. 1 urgente aperta.', fisso[0]);
  const senzaNome = msgCsUrgente(cu, { [U1]: { ...conv[U1], customer_name: '  ' } }, 1)[0], senzaEmail = msgCsUrgente(cu, { [U1]: { ...conv[U1], customer_name: null, customer_email: 'non-una-email' } }, 1)[0];
  t('N5 cs_urgente senza nome -> l\'email della cliente nel titolo; senza nome ne\' email valida -> il titolo del 18-10 con la categoria; mai l\'email finta di un\'altra colonna',
    senzaNome.titolo === 'Richiesta urgente da ' + CLIENTE_EMAIL && senzaEmail.titolo === 'Richiesta urgente: Reso e rimborso' && perde([senzaNome, senzaEmail]).length === 0, [senzaNome.titolo, senzaEmail.titolo]);
  t('28 motivoFisso: solo le quattro frasi delle regole, confronto esatto; nient\'altro (prototipo compreso)', Object.keys(MOTIVI_FISSI).length === 4
    && motivoFisso('2+ messaggi senza nostra risposta') !== '' && motivoFisso('thread riaperto (sollecito)') !== '' && motivoFisso('cliente in loco') !== ''
    && ['Rischio disputa', 'rischio disputa ', 'constructor', '__proto__', 'toString', 'matrimonio 27-07', null, 3].every((v) => motivoFisso(v) === ''));
  const nonPiu = [{ ...conv[U1], urgente: false }, { ...conv[U1], canale: 'rumore' }, { ...conv[U1], stato: 'fatto' }].map((v) => msgCsUrgente(cu, { [U1]: v }, 1).length);
  t('29 cs_urgente: conversazione non piu\' urgente, nel rumore, chiusa, o non letta -> nessun messaggio', nonPiu.every((n) => n === 0) && msgCsUrgente(cu, {}, 1).length === 0, nonPiu);
  t('29b cs_urgente senza cliente, senza categoria e senza aperte -> "Richiesta urgente" e invito ad aprire; con la sola categoria -> nel titolo (18-10); col nome -> nel testo', (() => {
    const v = { ...conv[U1], categoria: null, customer_name: null, customer_email: null };
    const x = msgCsUrgente(cu, { [U1]: v }, 0)[0], y = msgCsUrgente(cu, { [U1]: { ...v, categoria: 'Reso' } }, 0)[0];
    const z = msgCsUrgente(cu, { [U1]: { ...v, categoria: 'Reso', customer_name: CLIENTE } }, 0)[0];
    return x.titolo === 'Richiesta urgente' && x.testo === 'Apri l\'Assistenza.' && y.titolo === 'Richiesta urgente: Reso' && y.testo === 'Apri l\'Assistenza.'
      && z.titolo === 'Richiesta urgente da ' + CLIENTE && z.testo === 'Reso.';
  })());
  // B2 (Gate 3 del 18-10): il sollecito su una conversazione chiusa da una persona esiste SOLO con stato 'fatto'
  const chiusa = { urgente: true, canale: 'email_diretta', stato: 'fatto', categoria: 'Riparazione' };
  const sol = (o) => msgCsUrgente(cu, { [U1]: { ...chiusa, ...o } }, 2);
  const solA = sol({ urgenza_motivo: 'thread riaperto (sollecito)', stato_by: 'Ginevra' });
  t('29c B2: chiusa a mano e riaperta dalla cliente -> push, che dice dove trovarla (Concluse); stato_by non entra nel testo', solA.length === 1
    && solA[0].titolo === 'Richiesta urgente: Riparazione' && solA[0].testo === 'Sollecito: ha riscritto dopo la chiusura (in Concluse). 2 urgenti aperte.' && !JSON.stringify(solA).includes('Ginevra'), solA);
  const solB = sol({ urgenza_motivo: 'thread riaperto (sollecito)', stato_by: 'Ginevra', customer_name: 'Ginevra Bianchi' });
  t('N6 B2 col nome: il titolo porta il nome della CLIENTE, stato_by (chi del team ha chiuso) mai', solB[0]?.titolo === 'Richiesta urgente da Ginevra Bianchi'
    && !solB[0].testo.includes('Ginevra') && JSON.stringify(solB).split('Ginevra').length === 2, solB);
  const nonSol = [sol({ urgenza_motivo: 'thread riaperto (sollecito)', stato_by: 'auto' }), sol({ urgenza_motivo: 'thread riaperto (sollecito)', stato_by: null }),
    sol({ urgenza_motivo: 'thread riaperto (sollecito)', stato_by: '  ' }), sol({ urgenza_motivo: 'matrimonio 27-07', stato_by: 'Ginevra' }),
    sol({ urgenza_motivo: '2+ messaggi senza nostra risposta', stato_by: 'Ginevra' }), sol({ urgenza_motivo: 'thread riaperto (sollecito)', stato_by: 'Ginevra', canale: 'rumore' })];
  t('29d B2: chiusa da sola (un "grazie" con cs_reopen_skip_closure), senza chi, altro motivo, nel rumore -> nessuna push', nonSol.every((x) => x.length === 0), nonSol.map((x) => x.length));
  const chat = (canale) => msgCsUrgente(cu, { [U1]: { ...conv[U1], canale, urgenza_motivo: '2+ messaggi senza nostra risposta' } }, 1)[0].testo;
  t('29e C2: "2+ messaggi" in una chat_notifica (raffica di pochi minuti) non e\' un sollecito; in un\'email si\'', chat('chat_notifica') === 'Reso e rimborso. 1 urgente aperta.'
    && chat('email_diretta') === 'Reso e rimborso. Sollecito: due o piu\' messaggi senza risposta. 1 urgente aperta.');

  const rs = candCsRiscritto([conPII({ id: 123, conversation_id: U1, a: 'da_fare', at }), conPII({ id: 124, conversation_id: U1, a: 'fatto', at }),
    conPII({ id: '125', conversation_id: U2.toUpperCase(), a: 'da_fare', at: '2026-10-19T11:00:00Z' }), conPII({ id: 'x1', conversation_id: U1, a: 'da_fare', at: '2026-10-19T10:04:00Z' }),
    conPII({ id: 126, conversation_id: U3, a: 'da_fare', at: 'ieri' })]);
  t('30 cs_cliente_ha_riscritto (C3, 18-10): stato_auto verso da_fare; chiave = conversazione + finestra di 2 ore, tenuto l\'evento piu\' recente; senza istante fuori',
    rs.length === 2 && rs[0].chiave === U2 + ':2026-10-19T10:00:00.000Z' && rs[0].rif.conv === U2 && rs[1].chiave === U1 + ':2026-10-19T10:00:00.000Z'
    && rs[1].ts === T('2026-10-19T10:04:00Z') && FINESTRA_RISCRITTO_MS === 7200000, rs);
  // il retro-test del 18-10: una conversazione riaperta alle 09:34 e alle 09:38 prendeva due push in 4 minuti
  const raffica = candCsRiscritto([{ conversation_id: U1, a: 'da_fare', at: '2026-10-07T09:34:00Z' }, { conversation_id: U1, a: 'da_fare', at: '2026-10-07T09:38:00Z' },
    { conversation_id: U1, a: 'da_fare', at: '2026-10-07T13:10:00Z' }]);
  t('30b riaperture della stessa conversazione a 4 minuti: una chiave sola; 4 ore dopo: un\'altra', raffica.length === 2 && raffica[1].ts === T('2026-10-07T09:38:00Z')
    && pianifica(raffica, new Map(), { ora: T('2026-10-07T13:12:00Z'), baseline: false, etaMaxMs: 6 * 3600000 }).filter((p) => p.azione === 'nuovo').length === 2, raffica);
  const mr = msgCsRiscritto(rs, { [U1]: conv[U1], [U2]: conPII({ canale: 'rumore', stato: 'da_fare', categoria: 'Altro' }) }, 2);
  t('31 riscritto (19-10): "<nome della cliente> ha riscritto", categoria e "2 richieste aspettano una risposta" nel testo, conversazioni nel rumore fuori, nessun altro dato personale',
    mr.length === 1 && mr[0].titolo === CLIENTE + ' ha riscritto' && mr[0].testo === 'Reso e rimborso. 2 richieste aspettano una risposta.' && mr[0].url === LINK_ASSISTENZA
    && mr[0].tema === 'assistenza' && perde(mr).length === 0 && testoValido(mr), { mr, perde: perde(mr) });
  const rsEmail = msgCsRiscritto(rs.slice(1), { [U1]: { ...conv[U1], customer_name: '', customer_email: 'Maria.Rossi@Example.com' } }, 0)[0];
  const rsNessuno = msgCsRiscritto(rs.slice(1), { [U1]: { ...conv[U1], customer_name: null, customer_email: null, categoria: null } }, 1)[0];
  t('N7 riscritto senza nome -> "<email> ha riscritto" (minuscola); senza nome ne\' email -> "Una cliente ha riscritto"; senza categoria ne\' attesa -> invito ad aprire',
    rsEmail.titolo === CLIENTE_EMAIL + ' ha riscritto' && rsEmail.testo === 'Reso e rimborso.' && rsNessuno.titolo === 'Una cliente ha riscritto' && rsNessuno.testo === '1 richiesta aspetta una risposta.'
    && msgCsRiscritto(rs.slice(1), { [U1]: { ...conv[U1], customer_name: null, customer_email: null, categoria: null } }, 0)[0].testo === 'Apri l\'Assistenza.', [rsEmail, rsNessuno]);
  // C2 della Gate 2 del 19-10: la decisione chiede il nome, non un'altra impaginazione. Senza nome ne' email i testi sono
  // quelli del 18-10 parola per parola (categoria nel titolo, testo senza categoria)
  const anonima = { ...conv[U1], customer_name: null, customer_email: 'non-una-email' };
  const v1 = [msgCsUrgente(cu, { [U1]: { ...anonima, urgenza_motivo: 'rischio disputa' } }, 1)[0], msgCsUrgente(cu, { [U1]: anonima }, 0)[0],
    msgCsRiscritto(rs.slice(1), { [U1]: anonima }, 2)[0], msgCsRiscritto(rs.slice(1), { [U1]: anonima }, 0)[0]].map((m) => [m.titolo, m.testo]);
  t('N15 senza nome ne\' email cs_urgente e riscritto restano quelli del 18-10: "Richiesta urgente: <categoria>", "Una cliente ha riscritto: <categoria>"', isDeepStrictEqual(v1, [
    ['Richiesta urgente: Reso e rimborso', 'Rischio di contestazione del pagamento. 1 urgente aperta.'], ['Richiesta urgente: Reso e rimborso', 'Apri l\'Assistenza.'],
    ['Una cliente ha riscritto: Reso e rimborso', '2 richieste aspettano una risposta.'], ['Una cliente ha riscritto: Reso e rimborso', 'Apri l\'Assistenza.']]), v1);

  // 21-10 (v3): solo gli stati che sono un problema vero; uno stato illeggibile (prima: chiave ALTRO e "problema del
  // corriere") o di transito normale non e' piu' un candidato
  const sp = candSpedizione([conPII({ ldv: 'ABC123/1', order_name: '1890', stato_tws: 'INDIRIZZO ERRATO', classe: 'eccezione', updated_at: at }),
    conPII({ ldv: 'ABC124', order_name: '#1891', stato_tws: 'CONSEGNATA', classe: 'consegnata', updated_at: at }),
    conPII({ ldv: 'AB C', order_name: '1892', stato_tws: 'INDIRIZZO ERRATO', classe: 'eccezione', updated_at: at }),
    conPII({ ldv: 'ABC125', order_name: 'Maria Rossi', stato_tws: 'DESTINATARIO ASSENTE', classe: 'eccezione', updated_at: '2026-10-19T09:00:00Z' }),
    conPII({ ldv: 'ABC126', order_name: '1893', stato_tws: 'nota: chiamare Maria Rossi', classe: 'eccezione', updated_at: at }),
    conPII({ ldv: 'ABC127', order_name: '1894', stato_tws: 'IN CONSEGNA MATT.', classe: 'eccezione', updated_at: at })]);
  t('32 spedizione: solo classe eccezione con LDV in forma e stato che e\' un problema vero (21-10: illeggibile o di transito -> nessun candidato); chiave = LDV + stato senza spazi',
    sp.length === 2 && sp[0].chiave === 'ABC123/1:INDIRIZZO_ERRATO' && sp[1].chiave === 'ABC125:DESTINATARIO_ASSENTE'
    && candSpedizione([{ ldv: 'X1', stato_tws: 'N. CIVICO MANCANTE/ERRATO', classe: 'eccezione', updated_at: at }])[0].chiave === 'X1:N_CIVICO_MANCANTE_ERRATO', sp.map((x) => x.chiave));
  t('32b ogni chiave dei candidati e\' fatta di caratteri sicuri per un filtro .in() (niente spazi, virgole, parentesi, virgolette)', [...sp, ...candB2b(righe), ...candCsUrgente([{ conversation_id: U1, azione: 'classify', urgente: 'true', at }]),
    ...candCsSync({ severity: 'error', created_at: at }, T(at), 15), ...candRiepilogo({ aperta: true, data: '2026-10-19', ts: 0 })].every((x) => /^[A-Za-z0-9_.:/-]+$/.test(x.chiave)));
  const ms = msgSpedizione(sp, 3);
  t('33 spedizione (19-10): "Spedizione #1890: INDIRIZZO ERRATO (<nome della cliente>)", radice dell\'app; ordine non valido -> senza numero; nessun altro dato personale',
    ms.length === 2 && ms[0].titolo === `Spedizione #1890: INDIRIZZO ERRATO (${CLIENTE})` && ms[0].url === APP_URL && ms[0].tema === 'spedizioni' && ms[1].titolo === `Spedizione: DESTINATARIO ASSENTE (${CLIENTE})`
    && ms[0].testo === 'Il corriere segnala un problema. 3 spedizioni con un problema negli ultimi 7 giorni.' && perde(ms).length === 0 && testoValido(ms), { ms, perde: perde(ms) });
  t('33b spedizione: una sola nella settimana -> testo senza totale', msgSpedizione(sp.slice(0, 1), 1)[0].testo === 'Il corriere segnala un problema su questa spedizione.');
  // la vista non ha l'email: anche se una riga ne portasse una, non entra; senza nome niente parentesi
  const spSenza = msgSpedizione(candSpedizione([conPII({ ldv: 'L9', order_name: '1890', stato_tws: 'INDIRIZZO ERRATO', classe: 'eccezione', updated_at: at, customer_name: null })]), 1);
  t('N8 spedizione senza nome -> "Spedizione #1890: INDIRIZZO ERRATO", senza parentesi e mai l\'email', spSenza[0].titolo === 'Spedizione #1890: INDIRIZZO ERRATO'
    && perdeTutto(spSenza).length === 0, spSenza);
  // C1 della Gate 2 del 19-10: sul telefono chiuso il titolo e' una riga sola; il nome in mezzo spingeva lo stato fuori
  const coppie = [['1890', 'INDIRIZZO ERRATO'], ['', 'DESTINATARIO ASSENTE'], ['123456789', 'N. CIVICO MANCANTE/ERRATO'], ['1891', 'IN GIACENZA']].map(([o, s]) => {
    const r = { ldv: 'L2', order_name: o, stato_tws: s, classe: 'eccezione', updated_at: at };
    return [msgSpedizione(candSpedizione([{ ...r, customer_name: 'Anna Maria Bianchi Verdi' }]), 1)[0].titolo, msgSpedizione(candSpedizione([r]), 1)[0].titolo];
  });
  t('N14 spedizione: la notizia (ordine e stato del corriere) prima del nome, sempre; il titolo col nome = quello senza nome + " (<nome>)"',
    coppie.every(([con, senza]) => con === `${senza} (Anna Maria Bianchi Verdi)`), coppie);
  t('N9 il nome della cliente sta nel rif del candidato (per il titolo), mai nella chiave che finisce nel registro', sp[0].rif.cliente === CLIENTE
    && [...sp, ...rs, ...cu].every((x) => !x.chiave.includes('Maria') && !x.chiave.includes('@')), sp.map((x) => x.chiave));
  // push-api taglia il titolo a TITOLO_MAX punti di codice e il payload a PAYLOAD_MAX byte: coi nomi al massimo (emoji da 4
  // byte) nessun titolo si taglia, lo stato del corriere resta intero e nessun testo prende i tre puntini
  // stato del corriere lungo al massimo (40) e che e' un problema vero (21-10: gli altri non diventano candidati)
  const NOME_MAX = EMOJI.repeat(70), STATO_MAX = 'DESTINATARIO ASSENTE ' + 'A'.repeat(19);
  const spMax = msgSpedizione(candSpedizione([{ ldv: 'L1', order_name: '123456789', stato_tws: STATO_MAX, classe: 'eccezione', updated_at: at, customer_name: NOME_MAX }]), 999)[0];
  const convMax = { [U1]: { ...conv[U1], customer_name: NOME_MAX, categoria: EMOJI.repeat(50), urgenza_motivo: 'thread riaperto (sollecito)', stato: 'fatto', stato_by: 'Ale' } };
  const peggiori = [spMax, msgCsUrgente(cu, convMax, 999)[0], msgCsRiscritto(rs.slice(1), { [U1]: { ...convMax[U1], stato: 'da_fare' } }, 999)[0],
    msgCsUrgente(cu, { [U1]: { ...conv[U1], customer_name: null, customer_email: 'a'.repeat(75) + '@b.it' } }, 999)[0]];
  const payload = peggiori.map((m) => { const p = MP.costruisciPayload(m); return { m, p, n: new TextEncoder().encode(p).length, j: JSON.parse(p).notification }; });
  t('N10 titoli col nome al massimo: dentro TITOLO_MAX di push-api (stesso numero di TITOLO_MAX_PUSH), mai tagliati; spedizione: si accorcia il nome, lo stato resta intero; payload sotto PAYLOAD_MAX senza tagli',
    TITOLO_MAX_PUSH === MP.TITOLO_MAX && MP.TITOLO_MAX === Number((PUSH_API.match(/const TITOLO_MAX = (\d+);/) ?? [])[1])
    && Array.from(spMax.titolo).length === TITOLO_MAX_PUSH && spMax.titolo === `Spedizione #123456789: ${STATO_MAX} (${EMOJI.repeat(54)})`
    && payload.every((x) => x.n < MP.PAYLOAD_MAX && x.j.title === x.m.titolo && x.j.body === x.m.testo && Array.from(x.m.titolo).length <= MP.TITOLO_MAX),
    payload.map((x) => [x.n, Array.from(x.m.titolo).length, x.j.title === x.m.titolo, x.j.body === x.m.testo]));

  const ora = T('2026-10-19T12:00:00Z');
  const riga = (min, sev = 'ok') => conPII({ severity: sev, created_at: new Date(ora - min * 60000).toISOString(), label: 'giro fermato sul messaggio di Maria Rossi' });
  const fermo = candCsSync(riga(20), ora, 15);
  t('34 cs_sync: riga ok recente -> niente; riga di 20 minuti con soglia 15 -> fermo, chiave sull\'istante della riga, ts = riga + soglia',
    candCsSync(riga(5), ora, 15).length === 0 && fermo.length === 1 && fermo[0].chiave === 'cs_sync:fermo:' + new Date(ora - 20 * 60000).toISOString()
    && fermo[0].ts === ora - 5 * 60000 && fermo[0].rif.minuti === '20', fermo);
  const dopo = candCsSync(riga(20), ora + 3600000, 15), nuovo = candCsSync({ severity: 'ok', created_at: new Date(ora + 7200000).toISOString() }, ora + 3 * 3600000, 15);
  t('35 cs_sync: lo stesso stallo un\'ora dopo ha la STESSA chiave (una push per episodio), uno stallo nuovo ne ha un\'altra', dopo[0].chiave === fermo[0].chiave && nuovo[0].chiave !== fermo[0].chiave);
  const err = candCsSync(riga(1, 'error'), ora, 15);
  t('36 cs_sync in errore con la riga fresca: chiave per giorno di Roma; null o data illeggibile -> niente', err.length === 1 && err[0].chiave === 'cs_sync:errore:2026-10-19'
    && candCsSync(null, ora, 15).length === 0 && candCsSync({ severity: 'error', created_at: 'ieri' }, ora, 15).length === 0, err);
  const mcs = [...msgCsSync(fermo), ...msgCsSync(candCsSync(riga(70), ora, 15)), ...msgCsSync(candCsSync(riga(200), ora, 15)), ...msgCsSync(candCsSync(riga(3000), ora, 15)), ...msgCsSync(err)];
  t('37 cs_sync: "Posta clienti ferma da 20 minuti / 70 minuti / 3 ore / 2 giorni", errore generico, #salute, urgente, mai la label',
    mcs[0].testo.startsWith('Posta clienti ferma da 20 minuti') && mcs[1].testo.startsWith('Posta clienti ferma da 70 minuti') && mcs[2].testo.startsWith('Posta clienti ferma da 3 ore')
    && mcs[3].testo.startsWith('Posta clienti ferma da 2 giorni') && mcs[4].titolo === 'Posta clienti in errore' && mcs.every((x) => x.url === LINK_SALUTE && x.urgente === true && x.tema === 'sistema')
    && perdeTutto(mcs).length === 0 && !JSON.stringify(mcs).includes('Maria'), mcs.map((x) => x.testo));
  t('37b durata: 1 minuto, 119 minuti, 2 ore, 24 ore, 2 giorni', durata(1) === '1 minuto' && durata(119) === '119 minuti' && durata(120) === '2 ore' && durata(1440) === '24 ore' && durata(2880) === '2 giorni');
}

// 21-10 (v3, OK di Dan): in 3 giorni la classe 'eccezione' della vista aveva dato 20 candidati, 18 di transito normale
console.log('\n== spedizioni: solo gli stati che sono un problema vero (21-10) ==');
// una sezione che lancia (sorgente di prima, guasto piantato) e' un KO, non ferma la suite
try {
  // tutti gli stati mai visti in shipping_status (misurato il 21-10) e quelli di transito che la vista mette in eccezione
  const VISTI_PROBLEMA = ['DESTINATARIO ASSENTE', 'INDIRIZZO ERRATO', 'RIFIUTATA DAL DESTINATARIO', 'N. CIVICO MANCANTE/ERRATO'];
  const VISTI_NORMALI = ['CONSEGNATA', 'NUOVA', 'IN ATTESA DI AFFIDO', 'IN TRANSITO', 'PARTITA', 'IN PARTENZA TWS', 'RM - CONSEGNATA', 'FERIE'];
  const TRANSITO = ['IN CONSEGNA MATT.', 'IN CONSEGNA', 'RITIRATA', 'IN CONSEGNA POM.'];
  // stati del corriere che non abbiamo ancora visto ma che sono problemi (uno per voce dell'elenco), e trappole per un
  // confronto ingenuo "contiene" (PRESO contiene RESO, CORRETTO non e' ERRATO)
  const ALTRI_PROBLEMI = ['IN GIACENZA', 'SPEDIZIONE SMARRITA', 'MERCE DANNEGGIATA', 'RESPINTA', 'RESO AL MITTENTE', 'DESTINATARIO IRREPERIBILE', 'INDIRIZZO INESISTENTE',
    'DESTINATARIO SCONOSCIUTO', 'destinatario assente', 'Indirizzo errato', 'CIVICO MANCANTE',
    // Gate 2 del 21-10 (R12-C1, R5): le diciture comuni di una consegna non riuscita o di un rientro, una per pezzo nuovo
    'MANCATA CONSEGNA', 'TENTATA CONSEGNA', 'TENTATIVO DI CONSEGNA', 'CONSEGNA FALLITA', 'NON CONSEGNABILE', 'IN RESTITUZIONE AL MITTENTE', 'RIENTRO AL MITTENTE',
    'RITORNO AL MITTENTE', 'IN ATTESA ISTRUZIONI', 'INDIRIZZO INCOMPLETO', 'INDIRIZZO INSUFFICIENTE', 'DESTINATARIO CHIUSO', 'ESERCIZIO CHIUSO'];
  const TRAPPOLE = ['PRESO IN CARICO', 'INDIRIZZO CORRETTO', 'IN LAVORAZIONE', '', null, undefined, 42, 'nota: chiamare Maria Rossi',
    'SPEDIZIONE CHIUSA', 'PRATICA CHIUSA', 'CONSEGNABILE'];
  const sbagliatiP = [...VISTI_PROBLEMA, ...ALTRI_PROBLEMI].filter((s) => !statoProblema(s));
  const sbagliatiN = [...VISTI_NORMALI, ...TRANSITO, ...TRAPPOLE].filter((s) => statoProblema(s));
  // ogni pezzo dell'elenco ha almeno una voce qui che lo usa (un pezzo tolto o scritto male si vede)
  const senzaVoce = PROBLEMI_CORRIERE.filter((p) => ![...VISTI_PROBLEMA, ...ALTRI_PROBLEMI].some((s) => new RegExp(`(?:^|[^\\p{L}])${p}`, 'u').test(String(s).toUpperCase())));
  t('SP1 statoProblema: i 4 problemi visti e una voce per ogni pezzo dell\'elenco (maiuscole o no) si\'; gli 8 stati normali visti, i 4 di transito, PRESO, CORRETTO, SPEDIZIONE o PRATICA CHIUSA, illeggibili no',
    sbagliatiP.length === 0 && sbagliatiN.length === 0 && PROBLEMI_CORRIERE.length === 23 && senzaVoce.length === 0, { sbagliatiP, sbagliatiN, senzaVoce });
  const tre = [...Array(8).fill('IN CONSEGNA MATT.'), ...Array(4).fill('IN CONSEGNA'), ...Array(4).fill('RITIRATA'), ...Array(2).fill('IN CONSEGNA POM.'), ...Array(2).fill('DESTINATARIO ASSENTE')]
    .map((s, i) => ({ ldv: 'L' + i, order_name: String(1900 + i), stato_tws: s, classe: 'eccezione', updated_at: '2026-10-21T10:00:00Z', customer_name: 'Carla Bianchi' }));
  const c3 = candSpedizione(tre);
  t('SP2 i 20 candidati dei 3 giorni prima del 21-10 (18 di transito, 2 DESTINATARIO ASSENTE) -> 2 candidati, solo i DESTINATARIO ASSENTE', c3.length === 2
    && c3.every((x) => x.rif.stato === 'DESTINATARIO ASSENTE') && isDeepStrictEqual(c3.map((x) => x.chiave).sort(), ['L18:DESTINATARIO_ASSENTE', 'L19:DESTINATARIO_ASSENTE']), c3.map((x) => x.chiave));
  t('SP3 ogni stato mai visto passato da candSpedizione: candidati solo i quattro problemi', isDeepStrictEqual(candSpedizione([...VISTI_PROBLEMA, ...VISTI_NORMALI, ...TRANSITO]
    .map((s, i) => ({ ldv: 'V' + i, stato_tws: s, classe: 'eccezione', updated_at: '2026-10-21T10:00:00Z' }))).map((x) => x.rif.stato).sort(), [...VISTI_PROBLEMA].sort()));
  t('SP4 il totale dei 7 giorni conta i soli problemi veri della classe eccezione (20 righe dei 3 giorni -> 2; una consegnata con ASSENTE non conta)',
    contaProblemi(tre) === 2 && contaProblemi([...tre, { stato_tws: 'DESTINATARIO ASSENTE', classe: 'consegnata' }, null]) === 2 && contaProblemi(null) === 0);
} catch (e) { t('SP! eccezione nella sezione', false, String(e?.message ?? e)); }

// 21-10 (v3, OK di Dan in chat): "vorrei anche esser notificato quando le ragazze fanno operazioni tipo registra ordine,
// pezzi arrivati, e conta fisica". Righe con la forma di quelle vere di change_log (lette il 21-10: codici prodotto e
// fornitori, nessun dato di clienti); i campi di after arrivano come testo (after->>campo), l'id come numero.
const UA = '3ebca1e0-34ed-4461-afe8-a604cf9e9ade', UB = 'b00a4606-f191-48ff-a38c-18f6a7d7c43c', UC = '7c9c2bcb-36a4-403a-ab15-e82ff87cd6ed', UD = 'aea8a1f9-1c7a-4df0-aa93-a1303aaf4847';
const clArr = (id, codice, delta, ts = '2026-10-19T15:35:00Z', chi = 'Ginevra') => ({ id, ts, op: 'arrival_set', chi, codice, delta: String(delta), contati: null, giac_prima: null, fornitore: null, righe: null, gruppo: null });
const clOrd = (id, fornitore, righe, gruppo, ts = '2026-10-19T15:34:00Z', chi = 'Ginevra') => ({ id, ts, op: 'order_multi', chi, codice: null, delta: null, contati: null, giac_prima: null, fornitore, righe: String(righe), gruppo });
const clConta = (id, codice, contati, prima, ts = '2026-10-14T11:03:00Z', chi = 'Bene') => ({ id, ts, op: 'count_apply', chi, codice, delta: String(contati - prima), contati: String(contati), giac_prima: String(prima), fornitore: null, righe: null, gruppo: null });
console.log('\n== attivita del team: candidati e testi (21-10) ==');
// una sezione che lancia (sorgente di prima, guasto piantato) e' un KO, non ferma la suite
try {
  t('AT1 persone e azioni: solo Benny (Bene) e Ginni (Ginevra), mai Ale; solo order_multi, arrival_set, count_apply', isDeepStrictEqual(PERSONA_TEAM, { Bene: 'Benny', Ginevra: 'Ginni' })
    && Object.keys(PERSONA_TEAM).every((k) => CHI_PERSONE.includes(k)) && !('Ale' in PERSONA_TEAM) && isDeepStrictEqual(OP_ATTIVITA, ['order_multi', 'arrival_set', 'count_apply']));
  const righe = [
    { ...clArr(2341, 'GALIANO_TOAST_BAG_GREEN', 20, '2026-10-21T11:54:57Z'), ctx: '5f083d29', purchase_id: '08985bf5-d6f1-4311-9fd7-88c4931eaacc', costo: '7.9', customer_name: CLIENTE },
    clArr(1631, 'LEA_BAG_X', 5, '2026-10-21T11:00:00Z', 'Claude-Code'), clConta(1485, 'LEA_BAG_X', 5, 4, '2026-10-21T11:00:00Z', 'Ale'),
    { ...clArr(5, 'LEA_BAG_X', 3), op: 'order' }, clArr(6, 'LEA_BAG_X', 0), { ...clArr(7, 'LEA_BAG_X', 1), delta: null }, { ...clConta(8, 'LEA_BAG_X', 1, 1), id: 'x' },
    { ...clConta(9, 'LEA_BAG_X', 1, 1), id: -3 }, clConta(13, 'LEA_BAG_X', 1, 1, '2026-10-21T11:00:00Z', 'constructor'), clConta(14, 'LEA_BAG_X', 1, 1, '2026-10-21T11:00:00Z', 'bene'),
    { ...clConta('10', 'LEA_BAG_COCCO_BLACK', 0, 2, '2026-10-21T10:00:00Z') }, clOrd(11, 'Vincenzo\n(pelle)', 1, UA.toUpperCase(), '2026-10-21T09:00:00Z'),
    clArr(12, 'LEA BAG <x>', -3, '2026-10-21T08:00:00Z'),
  ];
  const ca = candAttivita(righe);
  t('AT2 candAttivita: una riga di change_log = un candidato cl:<id> (dal piu\' recente); fuori Ale, Claude-Code, chi strani o in minuscolo, azioni diverse, arrivi a delta 0 o senza delta, id non validi',
    isDeepStrictEqual(ca.map((c) => c.chiave), ['cl:2341', 'cl:10', 'cl:11', 'cl:12']) && ca[0].ts === T('2026-10-21T11:54:57Z')
    && isDeepStrictEqual(ca.map((c) => c.rif.gruppo), ['Ginevra:arrival_set', 'Bene:count_apply', 'Ginevra:order_multi', 'Ginevra:arrival_set']), ca.map((c) => c.chiave));
  t('AT3 rif: soli campi del testo (codice valido o vuoto, numeri interi, fornitore ripulito, ordine uuid minuscolo); mai ctx, purchase_id, costo o altro della riga',
    ca.every((c) => Object.keys(c.rif).join() === 'id,chi,op,gruppo,codice,delta,contati,prima,fornitore,righe,ordine') && ca[1].rif.contati === '0' && ca[1].rif.prima === '2'
    && ca[2].rif.fornitore === 'Vincenzo (pelle)' && ca[2].rif.ordine === UA && ca[3].rif.codice === '' && ca[3].rif.delta === '-3'
    && !/5f083d29|08985bf5|7\.9|Maria/.test(JSON.stringify(ca)) && ca.every((c) => /^[A-Za-z0-9_.:/-]+$/.test(c.chiave)), ca.map((c) => c.rif));
  const g = (rows, ordini = {}) => msgGruppoAttivita(candAttivita(rows), ordini);
  const arr = g([clArr(2319, 'AIRPODS_CASE_COCCO_BROWN', 70), clArr(2320, 'AIRPODS_CASE_BROWN_WHITE_PONY', 42), clArr(2321, 'AIRPODS_CASE_MILITARY_GREEN', 21)]);
  t('AT4 arrivi (19-10, tre arrivi di Ginni): "Ginni: pezzi arrivati", codici col +N in ordine di registrazione e il totale; radice dell\'app, tema attivita, nessun chi',
    arr?.titolo === 'Ginni: pezzi arrivati' && arr?.testo === 'AIRPODS_CASE_COCCO_BROWN +70, AIRPODS_CASE_BROWN_WHITE_PONY +42, AIRPODS_CASE_MILITARY_GREEN +21. In tutto 133 pezzi'
    && arr.url === APP_URL && arr.tema === 'attivita' && !('chi' in arr) && arr.urgente === undefined && testoValido([arr]), arr);
  const uno = g([clArr(2341, 'GALIANO_TOAST_BAG_GREEN', 20)]), netto = g([clArr(1, 'LEA_BAG_X', 10), clArr(2, 'LEA_BAG_X', -10), clArr(3, 'AGATA_BAG_Y', 4)]);
  const corr = g([clArr(4, 'LEA_BAG_X', -2)]), zero = g([clArr(5, 'LEA_BAG_X', 5), clArr(6, 'LEA_BAG_X', -5)]), tanti = g([1, 2, 3, 4, 5, 6].map((i) => clArr(i, 'COD_' + i, i)));
  t('AT5 arrivi: uno solo senza totale; al netto per codice (+10 e -10 sullo stesso codice spariscono); solo correzioni -> "arrivi corretti"; netto zero; oltre 4 codici "e altri N"',
    uno?.testo === 'GALIANO_TOAST_BAG_GREEN +20' && netto?.titolo === 'Ginni: pezzi arrivati' && netto?.testo === 'AGATA_BAG_Y +4'
    && corr?.titolo === 'Ginni: arrivi corretti' && corr?.testo === 'LEA_BAG_X -2' && zero?.titolo === 'Ginni: arrivi corretti' && zero?.testo === 'Arrivi corretti, nessun pezzo in piu\' o in meno.'
    && tanti?.testo === 'COD_1 +1, COD_2 +2, COD_3 +3, COD_4 +4, e altri 2. In tutto 21 pezzi', [uno, netto, corr, zero, tanti].map((m) => m && [m.titolo, m.testo]));
  const ORD = { [UA]: [{ gruppo: UA, codice: 'LEA_BAG_COCCO_BLACK', qty_ordered: 30, wip: false }],
    [UB]: [{ gruppo: UB, codice: 'AIRPODS_CASE_COCCO_BROWN', qty_ordered: '70', wip: false }],
    [UC]: ['LEA_BAG_E', 'LEA_BAG_B', 'LEA_BAG_D', 'LEA_BAG_A', 'LEA_BAG_C'].map((codice, i) => ({ gruppo: UC, codice, qty_ordered: i === 1 ? 0 : 5, wip: i === 1 })) };
  const o1 = g([clOrd(2329, 'Vincenzo (pelle)', 1, UA)], ORD), o3 = g([clOrd(2316, 'Vincenzo (pelle)', 1, UA), clOrd(2317, 'INDIA (tessuto)', 1, UB), clOrd(2318, 'Vincenzo (pelle)', 2, UD)], ORD);
  t('AT6 ordine: "Ginni ha registrato un ordine", "<fornitore>: 1 riga (CODICE x30)" dalle righe dell\'ordine; tre ordini: una riga di testo per ordine, un ordine senza righe lette dice fornitore e righe',
    o1?.titolo === 'Ginni ha registrato un ordine' && o1?.testo === 'Vincenzo (pelle): 1 riga (LEA_BAG_COCCO_BLACK x30)' && o3?.titolo === 'Ginni ha registrato 3 ordini'
    && o3?.testo === 'Vincenzo (pelle): 1 riga (LEA_BAG_COCCO_BLACK x30)\nINDIA (tessuto): 1 riga (AIRPODS_CASE_COCCO_BROWN x70)\nVincenzo (pelle): 2 righe' && testoValido([o1, o3]), [o1, o3].map((m) => m && [m.titolo, m.testo]));
  const o5 = g([clOrd(2400, 'Pelletteria Rossi', 5, UC)], ORD), o6 = g([1, 2, 3, 4, 5, 6].map((i) => clOrd(i, 'F' + i, 1, '')), ORD), oSenza = g([clOrd(2401, '', 0, '')], ORD);
  t('AT7 ordine: codici in ordine alfabetico, al massimo 3 e "e altri N", una riga WIP senza quantita\'; oltre 4 ordini "e altri N ordini"; senza fornitore ne\' righe "Fornitore"',
    o5?.testo === 'Pelletteria Rossi: 5 righe (LEA_BAG_A x5, LEA_BAG_B, LEA_BAG_C x5 e altri 2)' && o6?.titolo === 'Ginni ha registrato 6 ordini'
    && o6?.testo === 'F1: 1 riga\nF2: 1 riga\nF3: 1 riga\nF4: 1 riga\ne altri 2 ordini' && oSenza?.testo === 'Fornitore', [o5, o6, oSenza].map((m) => m && m.testo));
  const c1 = g([clConta(2215, 'LEA_BAG_LEOPARDO_SAVANA', 5, 4)]), c6 = g([1, 2, 3, 4, 5, 6].map((i) => clConta(2215 + i, 'COD_' + i, i, i + 1)));
  const cZero = g([{ ...clConta(3000, 'LEA_BAG_X', 0, 0), contati: '0' }]), cIll = g([{ ...clConta(3001, 'LEA_BAG_X', 1, 1), contati: 'x', giac_prima: null }]);
  t('AT8 conta: "Benny ha fatto una conta", "CODICE: contati (prima N)"; sei conte: "Benny ha fatto 6 conte", quattro e "e altri 2"; contati 0 resta 0; contati illeggibile -> "contato"',
    c1?.titolo === 'Benny ha fatto una conta' && c1?.testo === 'LEA_BAG_LEOPARDO_SAVANA: 5 (prima 4)' && c6?.titolo === 'Benny ha fatto 6 conte'
    && c6?.testo === 'COD_1: 1 (prima 2), COD_2: 2 (prima 3), COD_3: 3 (prima 4), COD_4: 4 (prima 5), e altri 2' && cZero?.testo === 'LEA_BAG_X: 0 (prima 0)' && cIll?.testo === 'LEA_BAG_X: contato'
    && testoValido([c1, c6]), [c1, c6, cZero, cIll].map((m) => m && [m.titolo, m.testo]));
  const misti = candAttivita([clArr(1, 'A', 1), clConta(2, 'B', 1, 1, '2026-10-19T15:36:00Z')]);
  t('AT9 un gruppo e\' una persona e un tipo: righe miste, vuote o non candidati -> nessun messaggio', msgGruppoAttivita(misti, {}) === null && msgGruppoAttivita([], {}) === null
    && msgGruppoAttivita([...candAttivita([clArr(1, 'A', 1)]), { chiave: 'x', ts: 0, rif: { chi: 'Ale', op: 'arrival_set', id: '9' } }], {}) === null
    && msgGruppoAttivita(candAttivita([clArr(1, 'A', 1, undefined, 'Bene'), clArr(2, 'B', 1)]), {}) === null);
  const tutti = msgAttivita(candAttivita([clArr(10, 'A', 1, '2026-10-19T15:40:00Z'), clConta(11, 'B', 2, 1, '2026-10-19T15:41:00Z'), clOrd(12, 'F', 1, UA, '2026-10-19T15:42:00Z'), clArr(13, 'C', 2, '2026-10-19T15:43:00Z'),
    clArr(14, 'D', 3, '2026-10-19T15:44:00Z', 'Bene')]), ORD);
  t('AT10 msgAttivita: un messaggio per persona e tipo (Ginni arrivi, Benny conte, Ginni ordini, Benny arrivi), ognuno con le sue sole righe', isDeepStrictEqual(tutti.map((m) => [m.chiave, m.titolo, m.testo]).sort(), [
    ['Bene:arrival_set', 'Benny: pezzi arrivati', 'D +3'], ['Bene:count_apply', 'Benny ha fatto una conta', 'B: 2 (prima 1)'], ['Ginevra:arrival_set', 'Ginni: pezzi arrivati', 'A +1, C +2. In tutto 3 pezzi'],
    ['Ginevra:order_multi', 'Ginni ha registrato un ordine', 'F: 1 riga (LEA_BAG_COCCO_BLACK x30)']]), tutti.map((m) => [m.chiave, m.titolo, m.testo]));
  const lungo = g([1, 2, 3, 4].map((i) => clOrd(i, 'X'.repeat(60), 8, UC)), ORD);
  t('AT11 testi corti: titolo sotto i 40 caratteri, payload di push-api sotto il limite senza tagli anche col caso peggiore', [arr, o3, c6, lungo].every((m) => Array.from(m.titolo).length <= 40
    && new TextEncoder().encode(MP.costruisciPayload(m)).length < MP.PAYLOAD_MAX && JSON.parse(MP.costruisciPayload(m)).notification.body === m.testo), lungo?.testo);
  // le cinque conte vere di Benny del 14-10 (1 minuto e mezzo, giacenze negative portate a 0): UNA push
  const b14 = g([clConta(2215, 'LEA_BAG_BLACK_PIERCING', 0, -1, '2026-10-14T11:02:04Z'), clConta(2216, 'LEA_BAG_RED_PATENT', 0, -1, '2026-10-14T11:02:42Z'),
    clConta(2217, 'AGATA_BAG_ROSE_PINK', 0, -1, '2026-10-14T11:02:56Z'), clConta(2218, 'AGATA_BAG_ROSE_BUTTER_GREEN', 0, -2, '2026-10-14T11:03:02Z'), clConta(2219, 'ANNIE_BAG_BROWN_CHOCOLATE', 0, -1, '2026-10-14T11:03:32Z')]);
  const o4 = g([clOrd(2402, 'Pelletteria Rossi', 4, UC)], { [UC]: ORD[UC].slice(0, 4) });
  t('AT12 le cinque conte di Benny del 14-10: "Benny ha fatto 5 conte", quattro voci con la giacenza negativa di prima e "e un altro"; un codice in piu\' nell\'ordine: "e un altro"',
    b14?.titolo === 'Benny ha fatto 5 conte' && b14?.testo === 'LEA_BAG_BLACK_PIERCING: 0 (prima -1), LEA_BAG_RED_PATENT: 0 (prima -1), AGATA_BAG_ROSE_PINK: 0 (prima -1), AGATA_BAG_ROSE_BUTTER_GREEN: 0 (prima -2), e un altro'
    && o4?.testo === 'Pelletteria Rossi: 4 righe (LEA_BAG_A x5, LEA_BAG_B, LEA_BAG_D x5 e un altro)', [b14?.testo, o4?.testo]);
} catch (e) { t('AT! eccezione nella sezione', false, String(e?.message ?? e)); }

console.log('\n== riepilogo ==');
{
  const aperta = { aperta: true, data: '2026-10-19', ts: T('2026-10-19T16:30:00Z') };
  const cr = candRiepilogo(aperta);
  t('38 riepilogo: finestra chiusa -> niente; aperta -> una chiave per persona riepilogo:<chi>:<data>', candRiepilogo({ ...aperta, aperta: false }).length === 0
    && cr.map((x) => x.chiave).join() === 'riepilogo:Ale:2026-10-19,riepilogo:Bene:2026-10-19,riepilogo:Ginevra:2026-10-19' && cr.every((x) => x.ts === aperta.ts));
  const C = { ordini: 8, incasso: 1012.5, scontrini: 2, incassoCassa: 240, arrivi: 3, ordiniFornitore: 1, premia: 1, csFerme: 21, b2bScadute: 2, daCompletare: 7, daPulire: 44,
    daCollegare: 4, followUpPronti: 4, daSpedire: ['1890', '#1893', 'Maria Rossi', '1901', '1902', '1903'], affido: 10, csNuove: 1 };
  const ale = righeRiepilogo('Ale', C, 4, 48), bene = righeRiepilogo('Bene', C, 4, 48), gin = righeRiepilogo('Ginevra', C, 4, 48);
  t('39 Ale: vendite (ordini, incasso, cassa), fornitori, Premia, team', isDeepStrictEqual(ale, ['Vendite: 8 ordini sul sito (1.013 EUR), 2 scontrini in cassa (240 EUR)',
    'Fornitori: 3 arrivi registrati, 1 ordine registrato', 'Premia: 1 contenuto da approvare', 'Team: 21 richieste ferme da oltre 24 ore, 2 azioni B2B scadute']), ale);
  t('40 Benny: prodotti da completare e da pulire, B2B con le sezioni della Coda (da collegare, azioni scadute, follow-up pronti da rivedere: B4 e C4 del 18-10)',
    isDeepStrictEqual(bene, ['Prodotti: 7 da completare, 44 da pulire', 'B2B: 4 messaggi da collegare, 2 azioni scadute, 4 follow-up pronti da rivedere'])
    && isDeepStrictEqual(righeRiepilogo('Bene', { ...C, daCompletare: 0, daPulire: 0, daCollegare: 0, b2bScadute: 1, followUpPronti: 1 }, 4, 48), ['B2B: 1 azione scaduta, 1 follow-up pronto da rivedere']), bene);
  t('41 Ginni: da spedire coi numeri d\'ordine (al massimo 3, poi "e altri N"; un nome non passa), affido, Assistenza', isDeepStrictEqual(gin, [
    'Da spedire da oltre 4 giorni lavorativi: 5 ordini (#1890, #1893, #1901 e altri 2)', 'In attesa di affido da oltre 48 ore: 10 spedizioni',
    'Assistenza: 1 richiesta nuova oggi, 21 ferme da oltre 24 ore']), gin);
  const ZERO = { ordini: 0, incasso: 0, scontrini: 0, incassoCassa: 0, arrivi: 0, ordiniFornitore: 0, premia: 0, csFerme: 0, b2bScadute: 0, daCompletare: 0, daPulire: 0, daCollegare: 0, followUpPronti: 0, daSpedire: [], affido: 0, csNuove: 0 };
  t('42 tutto a zero -> nessuna riga per nessuno; una sola voce diversa da zero -> una riga sola', CHI_PERSONE.every((p) => righeRiepilogo(p, ZERO, 4, 48).length === 0)
    && isDeepStrictEqual(righeRiepilogo('Ale', { ...ZERO, premia: 2 }, 4, 48), ['Premia: 2 contenuti da approvare'])
    && isDeepStrictEqual(righeRiepilogo('Ginevra', { ...ZERO, daSpedire: ['1890'] }, 5, 48), ['Da spedire da oltre 5 giorni lavorativi: 1 ordine (#1890)']));
  t('43 al massimo 4 righe per tutti, valori strani (negativi, NaN, stringhe) contano zero', CHI_PERSONE.every((p) => righeRiepilogo(p, C, 4, 48).length <= 4)
    && righeRiepilogo('Ale', { ...ZERO, ordini: -3, premia: NaN, arrivi: '5' }, 4, 48).length === 0 && righeRiepilogo('Dan', C, 4, 48).length === 0);
  const mr = msgRiepilogo(cr, { ...ZERO, premia: 1, csNuove: 2 }, 4, 48);
  t('44 msgRiepilogo: uno a testa col proprio chi, tema riepilogo, radice dell\'app; chi senza righe -> nessun messaggio', mr.length === 2 && mr[0].chi === 'Ale' && mr[1].chi === 'Ginevra'
    && mr.every((x) => x.tema === 'riepilogo' && x.url === APP_URL && x.titolo === 'Riepilogo di oggi') && mr[0].testo === 'Premia: 1 contenuto da approvare'
    && mr[1].testo === 'Assistenza: 2 richieste nuove oggi', mr);
  t('45 chi fuori dalle tre chiavi (Benny, Ginni, minuscolo) -> nessun messaggio, mai un riepilogo a tutti', msgRiepilogo([{ chiave: 'r', ts: 0, rif: { chi: 'Benny' } },
    { chiave: 'r2', ts: 0, rif: { chi: 'ginevra' } }, { chiave: 'r3', ts: 0, rif: {} }], C, 4, 48).length === 0);
  t('46 testo su piu\' righe (a capo fra le voci), niente em dash', msgRiepilogo(cr, C, 4, 48)[0].testo.split('\n').length === 4 && testoValido(msgRiepilogo(cr, C, 4, 48)));
  const rDati = msgRiepilogo(cr, { ...C, daSpedire: [...C.daSpedire, CLIENTE, CLIENTE_EMAIL, PII[0]] }, 4, 48);
  t('N11 il riepilogo serale non cambia col 19-10: nessun dato della cliente, nemmeno il nome (un nome al posto del numero d\'ordine non passa)',
    rDati.length === 3 && perdeTutto(rDati).length === 0, perdeTutto(rDati));
  // B3 (Gate 3 del 18-10): arrivi al netto per riga d'ordine. 29-09: +10 e -10 sulla stessa riga (storno) piu' un +4
  t('46b B3: arrivi = righe d\'ordine con arrivo netto positivo (0 e negativi fuori, storno annullato, legacy con qty, riga vuota fuori)',
    contaArrivi([{ row_id: 'x', delta: 5 }, { row_id: 'y', delta: 0 }, { row_id: 'z', delta: -2 }, { row_id: 'w', qty: 3 }]) === 2
    && contaArrivi([{ row_id: 'x', delta: '10' }, { row_id: 'x', delta: '-10' }, { row_id: 'y', delta: '4' }]) === 1
    && contaArrivi([{ row_id: 'a', delta: -10 }, { row_id: 'a', delta: 10 }, { row_id: 'a', delta: 10 }, { row_id: 'b', delta: 0 }, { row_id: 'b', delta: 10 }]) === 2
    && contaArrivi([{ row_id: 'v' }, { row_id: 'u', delta: null, qty: null }, { delta: 3 }, { row_id: '', delta: 3 }, { row_id: 't', delta: 'x' }]) === 0 && contaArrivi(null) === 0);
  t('47 somme: ordini (righe e lordo), cassa (scontrini distinti, prezzo = totale riga), valori non numerici ignorati',
    isDeepStrictEqual(sommaOrdini([{ gross_total: 100.5 }, { gross_total: '50' }, { gross_total: null }]), { n: 3, incasso: 150.5 })
    && isDeepStrictEqual(sommaCassa([{ order_id: 'A', prezzo: 120 }, { order_id: 'A', prezzo: 30 }, { order_id: 'B', prezzo: 'x' }, { order_id: null, prezzo: 10 }]), { scontrini: 2, incasso: 160 }));
}

console.log('\n== registro: baseline e piano ==');
const c = (k, ts) => ({ chiave: k, ts, rif: {} });
const ORA = T('2026-10-19T12:00:00Z');
const reg = (k, stato, tentativi = 1, minFa = 0) => ({ id: 'id-' + k, chiave: k, stato, tentativi, updated_at: new Date(ORA - minFa * 60000).toISOString() });
{
  t('48 costanti: stallo 2 ore, prenotato scaduto dopo 15 minuti, 3 tentativi, tetto 20 invii', STALLO_MS === 7200000 && PRENOTATO_SCADUTO_MS === 900000 && MAX_TENTATIVI === 3 && TETTO_INVII === 20);
  const iso = (min) => new Date(ORA - min * 60000).toISOString();
  t('49 baseline: prima accensione (baseline_at vuoto), ultimo giro assente o di oltre 2 ore -> si\'; giro di 5 minuti fa -> no',
    serveBaseline({ baseline_at: null, ultimo_giro_at: iso(5) }, ORA) && serveBaseline({ baseline_at: iso(600), ultimo_giro_at: null }, ORA)
    && serveBaseline({ baseline_at: iso(600), ultimo_giro_at: iso(121) }, ORA) && !serveBaseline({ baseline_at: iso(600), ultimo_giro_at: iso(5) }, ORA)
    && !serveBaseline({ baseline_at: iso(600), ultimo_giro_at: iso(119) }, ORA) && serveBaseline({ baseline_at: 'x', ultimo_giro_at: iso(5) }, ORA) && serveBaseline(null, ORA));
  const H = 3600000, MAX = 6 * H;
  const az = (piano) => piano.map((p) => `${p.cand.chiave}:${p.azione}${p.motivo ? ':' + p.motivo : ''}`);
  const base = pianifica([c('a', ORA - H), c('b', ORA - 7 * H)], new Map(), { ora: ORA, baseline: true, etaMaxMs: MAX });
  t('50 baseline: ogni candidato nuovo -> salta (baseline), anche quelli giovani; niente invii', isDeepStrictEqual(az(base), ['b:salta:baseline', 'a:salta:baseline']), az(base));
  const n = pianifica([c('a', ORA - H), c('b', ORA - 7 * H), c('x', NaN)], new Map(), { ora: ORA, baseline: false, etaMaxMs: MAX });
  t('51 nuovi: giovane -> nuovo; oltre 6 ore o senza data -> salta (vecchio); ordine dal piu\' vecchio', az(n).sort().join() === ['a:nuovo', 'b:salta:vecchio', 'x:salta:vecchio'].sort().join()
    && n[0].cand.chiave === 'x' && n[n.length - 1].cand.chiave === 'a', az(n));
  const R = new Map([['i', reg('i', 'inviato')], ['s', reg('s', 'saltato')], ['n', reg('n', 'nessun_iscritto')], ['p', reg('p', 'prenotato', 1, 5)],
    ['q', reg('q', 'prenotato', 1, 16)], ['f', reg('f', 'fallito', 2)], ['e', reg('e', 'fallito', 3)], ['z', reg('z', 'boh')], ['g', reg('g', 'fallito', 1.5)]]);
  const cs = ['i', 's', 'n', 'p', 'q', 'f', 'e', 'z', 'g'].map((k) => c(k, ORA - H));
  const p = Object.fromEntries(pianifica(cs, R, { ora: ORA, baseline: false, etaMaxMs: MAX }).map((x) => [x.cand.chiave, x.azione + ':' + x.motivo]));
  t('52 registro: inviato/saltato/nessun_iscritto finali; prenotato da 5 minuti in corso; da 16 minuti si riprende; fallito con 2 tentativi si riprende, con 3 no; stato ignoto e tentativi non interi fermi',
    isDeepStrictEqual(p, { i: 'fermo:inviato', s: 'fermo:saltato', n: 'fermo:nessun_iscritto', p: 'fermo:in_corso', q: 'ritenta:', f: 'ritenta:', e: 'fermo:tentativi_esauriti', z: 'fermo:stato_sconosciuto', g: 'fermo:tentativi_esauriti' }), p);
  const pb = Object.fromEntries(pianifica([c('f', ORA - H), c('q', ORA - 7 * H)], R, { ora: ORA, baseline: true, etaMaxMs: MAX }).map((x) => [x.cand.chiave, x.azione + ':' + x.motivo]));
  const pv = Object.fromEntries(pianifica([c('f', ORA - 7 * H)], R, { ora: ORA, baseline: false, etaMaxMs: MAX }).map((x) => [x.cand.chiave, x.azione + ':' + x.motivo]));
  t('53 un fallito non si riprende durante la baseline ne\' oltre le 6 ore', pb.f === 'fermo:baseline' && pb.q === 'fermo:baseline' && pv.f === 'fermo:vecchio', { pb, pv });
  const dup = pianifica([c('a', ORA - 10), c('a', ORA - 20), c('', ORA), null], new Map(), { ora: ORA, baseline: false, etaMaxMs: MAX });
  t('54 chiavi doppie: conta la prima; chiave vuota o candidato nullo ignorati', dup.length === 1 && dup[0].cand.ts === ORA - 10);
  const E = (o) => ({ ok: false, inviati: 0, falliti: 0, destinatari: null, status: 200, ...o });
  t('55 stato dall\'esito: ok -> inviato; 2xx con zero destinatari o tema spento -> nessun_iscritto (finale)',
    statoDaEsito(E({ ok: true, inviati: 1, destinatari: 1 })) === 'inviato' && statoDaEsito(E({ destinatari: 0 })) === 'nessun_iscritto' && statoDaEsito(E({ skipped: 'tema_spento' })) === 'nessun_iscritto');
  t('56 fallito (si riprova): push_enabled spento (disabled), 503, rete, risposta illeggibile, tutti i telefoni falliti, dryRun', [E({ skipped: 'disabled' }), E({ status: 503, destinatari: 0 }),
    E({ status: null, errore: 'rete' }), E({ errore: 'risposta di push-api non leggibile', destinatari: 0 }), E({ destinatari: 2, falliti: 2 }), E({ dryRun: true, destinatari: 0 }), null].every((x) => statoDaEsito(x) === 'fallito'));
  const s = esitoDaSalvare({ ok: false, inviati: 0, falliti: 1, destinatari: 1, status: 503, skipped: 'x'.repeat(80), errore: 'oltre 50 telefoni iscritti al tema conti di Maria Rossi' });
  t('57 esito sulla riga: soli conteggi, stato HTTP, skipped corto ed errore come booleano (mai il testo)', isDeepStrictEqual(Object.keys(s), ['inviati', 'falliti', 'destinatari', 'status', 'skipped', 'errore'])
    && s.errore === true && s.skipped.length === 40 && !JSON.stringify(s).includes('Maria'), s);

  // Gate 3 del 18-10
  const iso2 = (min) => new Date(ORA - min * 60000).toISOString();
  const bd = (ev) => JSON.stringify(baselineDi(ev, ORA));
  t('57b baselineDi: prima accensione = baseline (non ripartenza); pausa oltre 2 ore con baseline_at gia\' scritto = ripartenza; giro recente = niente',
    bd({ evento: 'cs_urgente', baseline_at: null, ultimo_giro_at: null }) === '{"seme":true,"baseline":true,"ripartenza":false}'
    && bd({ evento: 'cs_urgente', baseline_at: iso2(600), ultimo_giro_at: iso2(180) }) === '{"seme":true,"baseline":true,"ripartenza":true}'
    && bd({ evento: 'cs_urgente', baseline_at: iso2(600), ultimo_giro_at: iso2(5) }) === '{"seme":false,"baseline":false,"ripartenza":false}');
  t('57c RF-4: l\'evento di STATO (cs-sync fermo) semina baseline_at ma non salta il pregresso, ne\' alla prima accensione ne\' alla ripartenza',
    isDeepStrictEqual(EVENTI_DI_STATO, ['sistema_cs_sync_fermo']) && bd({ evento: 'sistema_cs_sync_fermo', baseline_at: null, ultimo_giro_at: null }) === '{"seme":true,"baseline":false,"ripartenza":false}'
    && bd({ evento: 'sistema_cs_sync_fermo', baseline_at: iso2(600), ultimo_giro_at: iso2(180) }) === '{"seme":true,"baseline":false,"ripartenza":false}');
  const stallo = pianifica([c('a', ORA - H)], new Map(), { ora: ORA, baseline: true, etaMaxMs: MAX, motivoBaseline: 'stallo' });
  const altro = pianifica([c('a', ORA - H)], new Map(), { ora: ORA, baseline: true, etaMaxMs: MAX, motivoBaseline: 'boh' });
  t('57d ripartenza: il pregresso si salta col motivo "stallo" (push perse), un motivo diverso vale "baseline"', az(stallo).join() === 'a:salta:stallo' && az(altro).join() === 'a:salta:baseline');
  // v4 (31-10, CASI_APERTI 53, blocco di Supabase di 14 ore): alla ripartenza si salta solo il pregresso vecchio. Un
  // candidato senza riga di registro con l'evento entro frescoMs (2 ore, estremo compreso) parte come in un giro normale
  const fr = (cs, o) => az(pianifica(cs, new Map(), { ora: ORA, baseline: true, etaMaxMs: MAX, ...o })).sort();
  const cinque = [c('f1', ORA - 60000), c('f2', ORA - 2 * H), c('v', ORA - 2 * H - 1), c('x', NaN), c('d', ORA - 7 * H)];
  t('57h v4 ripartenza: evento di 1 minuto o di 2 ore esatte -> nuovo (parte); di 2 ore e 1 ms, senza istante o oltre le 6 ore -> saltato stallo',
    isDeepStrictEqual(fr(cinque, { motivoBaseline: 'stallo', frescoMs: 2 * H }), ['d:salta:stallo', 'f1:nuovo', 'f2:nuovo', 'v:salta:stallo', 'x:salta:stallo']), fr(cinque, { motivoBaseline: 'stallo', frescoMs: 2 * H }));
  t('57i v4: la freschezza vale SOLO alla ripartenza (prima accensione: tutto baseline) e mai oltre l\'eta\' massima (finestra infinita del riepilogo: 5 ore si\', 7 no); senza frescoMs, o NaN, si salta tutto come nella v3',
    fr(cinque, { motivoBaseline: 'baseline', frescoMs: 2 * H }).every((x) => x.endsWith(':salta:baseline'))
    && isDeepStrictEqual(fr([c('r5', ORA - 5 * H), c('r7', ORA - 7 * H)], { motivoBaseline: 'stallo', frescoMs: Infinity }), ['r5:nuovo', 'r7:salta:stallo'])
    && fr(cinque, { motivoBaseline: 'stallo' }).every((x) => x.endsWith(':salta:stallo')) && fr(cinque, { motivoBaseline: 'stallo', frescoMs: NaN }).every((x) => x.endsWith(':salta:stallo')),
    fr([c('r5', ORA - 5 * H), c('r7', ORA - 7 * H)], { motivoBaseline: 'stallo', frescoMs: Infinity }));
  t('57j v4: una riga di registro da riprendere resta ferma (baseline) alla ripartenza anche se fresca, e si riprende al giro dopo',
    az(pianifica([c('f', ORA - 60000)], new Map([['f', reg('f', 'fallito', 1)]]), { ora: ORA, baseline: true, etaMaxMs: MAX, motivoBaseline: 'stallo', frescoMs: 2 * H })).join() === 'f:fermo:baseline');
  const okE = { ok: true, inviati: 1, falliti: 0, destinatari: 1, status: 200 };
  const ch = (e, m = {}) => { const x = chiusura(e, m); return `${x.stato}:${x.definitivo}:${Object.keys(x.esito).filter((k) => ['chi_ignorato', 'timeout'].includes(k)).join(',')}`; };
  t('57e RF-7: un riepilogo per Bene consegnato da una push-api che non rimanda chi (v1: a tutti) o lo rimanda diverso -> fallito definitivo (chi_ignorato), mai ritentato',
    ch(okE, { chi: 'Bene' }) === 'fallito:true:chi_ignorato' && ch({ ...okE, chi: null }, { chi: 'Bene' }) === 'fallito:true:chi_ignorato' && ch({ ...okE, chi: 'Ale' }, { chi: 'Bene' }) === 'fallito:true:chi_ignorato'
    && ch({ ...okE, chi: 'Bene' }, { chi: 'Bene' }) === 'inviato:false:' && ch(okE, {}) === 'inviato:false:' && ch({ ...okE, chi: null }, {}) === 'inviato:false:');
  const nessuno = { ok: false, inviati: 0, falliti: 0, destinatari: 0, status: 200 };
  t('57f RF-7: senza consegna il chi mancante non cambia niente (nessun iscritto resta nessun_iscritto)', ch(nessuno, { chi: 'Bene' }) === 'nessun_iscritto:false:');
  const scaduto = { ok: false, inviati: 0, falliti: 0, destinatari: null, status: null };
  t('57g RF-3: timeout del client (push-api puo\' aver consegnato) -> fallito definitivo (timeout); rete o 503 -> fallito normale, si riprova',
    ch({ ...scaduto, errore: 'TimeoutError: signal timed out' }) === 'fallito:true:timeout' && ch({ ...scaduto, errore: 'AbortError: The signal has been aborted' }) === 'fallito:true:timeout'
    && ch({ ...scaduto, errore: 'TypeError: error sending request' }) === 'fallito:false:' && ch({ ...scaduto, status: 503, errore: 'TimeoutError da push-api' }) === 'fallito:false:'
    && ch({ ...scaduto, errore: 'invio non riuscito' }) === 'fallito:false:');
}

console.log('\n== giro di un evento (scritture e invio finti) ==');
{
  const finto = (o = {}) => {
    const log = [];
    const d = {
      salta: async (righe) => { log.push(['salta', righe.map((x) => x.chiave + ':' + x.motivo).join('|')]); if (o.saltaLancia) throw new Error('db giu'); },
      prenota: async (k) => { log.push(['prenota', k]); if (o.prenotaLancia) throw new Error('db giu'); return (o.conflitto ?? []).includes(k) ? null : { id: 'id-' + k }; },
      riprendi: async (r) => { log.push(['riprendi', r.chiave]); return !o.ripresaPersa; },
      invia: async (m) => { log.push(['invia', m.chiave, m.chi ?? null]); if (o.inviaLancia) throw new Error('x'); return o.esito ? o.esito(m) : { ok: true, inviati: 1, falliti: 0, destinatari: 1, status: 200 }; },
      chiudi: async (id, ten, stato, esito, definitivo) => { log.push(['chiudi', id, ten, stato, Object.keys(esito).join(','), ...(definitivo ? ['definitivo'] : [])]); return !o.chiudiFallisce; },
      adesso: () => o.adesso ?? 0,
    };
    return { d, log };
  };
  const msg = (k, extra = {}) => ({ chiave: k, titolo: 'T ' + k, testo: 'x', url: APP_URL, tema: 'negozi', ...extra });
  const mappa = (ks, extra) => new Map(ks.map((k) => [k, msg(k, extra)]));
  const piano = (ks, R = new Map(), baseline = false) => pianifica(ks.map((k, i) => c(k, ORA - (ks.length - i) * 60000)), R, { ora: ORA, baseline, etaMaxMs: 6 * 3600000 });

  let f = finto(); let b = { invii: 20, scade: 1 };
  let r = await eseguiPiano(piano(['a', 'b']), mappa(['a', 'b']), b, f.d);
  t('58 flusso: per ogni messaggio prenota -> invia -> chiudi (inviato, tentativi 1), in sequenza dal piu\' vecchio; budget scalato',
    isDeepStrictEqual(f.log, [['prenota', 'a'], ['invia', 'a', null], ['chiudi', 'id-a', 1, 'inviato', 'inviati,falliti,destinatari,status'], ['prenota', 'b'], ['invia', 'b', null],
      ['chiudi', 'id-b', 1, 'inviato', 'inviati,falliti,destinatari,status']]) && r.inviati === 2 && b.invii === 18 && r.candidati === 2, f.log);
  f = finto(); b = { invii: 2, scade: 1 };
  r = await eseguiPiano(piano(['a', 'b', 'c', 'd']), mappa(['a', 'b', 'c', 'd']), b, f.d);
  t('59 tetto: con 2 invii disponibili su 4, partono i 2 piu\' vecchi e gli altri restano NON prenotati (rimandati al giro dopo)', r.inviati === 2 && r.rimandati === 2
    && f.log.filter((x) => x[0] === 'prenota').map((x) => x[1]).join() === 'a,b' && b.invii === 0, r);
  const b2 = { invii: 3, scade: 1 };
  const r1 = await eseguiPiano(piano(['a', 'b']), mappa(['a', 'b']), b2, finto().d), r2 = await eseguiPiano(piano(['c', 'd']), mappa(['c', 'd']), b2, finto().d);
  t('60 il tetto vale per il giro intero: due eventi con lo stesso budget di 3 -> 3 invii in tutto', r1.inviati + r2.inviati === 3 && r2.rimandati === 1);
  f = finto({ adesso: 10 }); r = await eseguiPiano(piano(['a']), mappa(['a']), { invii: 20, scade: 5 }, f.d);
  t('61 tempo scaduto: nessuna prenotazione e nessun invio, rimandato', r.rimandati === 1 && f.log.length === 0);
  f = finto({ conflitto: ['a'] }); b = { invii: 5, scade: 1 };
  r = await eseguiPiano(piano(['a', 'b']), mappa(['a', 'b']), b, f.d);
  t('62 prenotazione persa sul vincolo UNIQUE (un altro giro l\'ha presa): niente invio e il budget non scende', r.presi_da_altri === 1 && r.inviati === 1 && b.invii === 4
    && !f.log.some((x) => x[0] === 'invia' && x[1] === 'a'));
  const R = new Map([['q', reg('q', 'prenotato', 1, 16)], ['f', reg('f', 'fallito', 2)]]);
  f = finto(); r = await eseguiPiano(piano(['q', 'f'], R), mappa(['q', 'f']), { invii: 5, scade: 1 }, f.d);
  t('63 ripresa: prenotato scaduto e fallito si riprendono (confronto su stato e tentativi), chiusi con tentativi + 1', r.inviati === 2
    && isDeepStrictEqual(f.log.filter((x) => x[0] === 'chiudi').map((x) => [x[1], x[2]]), [['id-q', 2], ['id-f', 3]]) && !f.log.some((x) => x[0] === 'prenota'), f.log);
  f = finto({ ripresaPersa: true }); r = await eseguiPiano(piano(['q'], R), mappa(['q']), { invii: 5, scade: 1 }, f.d);
  t('64 ripresa persa (un altro giro ha cambiato stato o tentativi): niente invio', r.presi_da_altri === 1 && !f.log.some((x) => x[0] === 'invia'));
  f = finto(); r = await eseguiPiano(piano(['a', 'b'], new Map(), true), mappa(['a', 'b']), { invii: 5, scade: 1 }, f.d);
  t('65 baseline: UNA scrittura dei saltati per tutte le chiavi, nessuna prenotazione, nessun invio', isDeepStrictEqual(f.log, [['salta', 'a:baseline|b:baseline']]) && r.saltati === 2 && r.inviati === 0, f.log);
  f = finto({ saltaLancia: true }); let lanciato = false;
  try { await eseguiPiano([...piano(['v'], new Map(), true), ...piano(['a'])], mappa(['a']), { invii: 5, scade: 1 }, f.d); } catch { lanciato = true; }
  t('66 scrittura dei saltati fallita: il giro dell\'evento si ferma (lancia) PRIMA di ogni invio', lanciato && !f.log.some((x) => x[0] === 'invia' || x[0] === 'prenota'));
  f = finto({ prenotaLancia: true }); lanciato = false;
  try { await eseguiPiano(piano(['a', 'b']), mappa(['a', 'b']), { invii: 5, scade: 1 }, f.d); } catch { lanciato = true; }
  t('67 prenotazione fallita (errore del DB, non conflitto): si ferma senza inviare', lanciato && !f.log.some((x) => x[0] === 'invia'));
  f = finto(); r = await eseguiPiano(piano(['a', 'b']), mappa(['b']), { invii: 5, scade: 1 }, f.d);
  t('68 candidato nuovo senza messaggio (non piu\' urgente, riepilogo a zero): si chiude come saltato, non si invia', isDeepStrictEqual(f.log[0], ['salta', 'a:niente_da_dire'])
    && r.saltati === 1 && r.inviati === 1 && !f.log.some((x) => x[0] === 'prenota' && x[1] === 'a'));
  f = finto({ esito: () => ({ ok: false, inviati: 0, falliti: 0, destinatari: 0, status: 200 }) }); r = await eseguiPiano(piano(['a']), mappa(['a']), { invii: 5, scade: 1 }, f.d);
  t('69 nessun telefono iscritto: chiuso nessun_iscritto (finale), non fallito', r.nessun_iscritto === 1 && r.falliti === 0 && f.log.find((x) => x[0] === 'chiudi')[3] === 'nessun_iscritto');
  f = finto({ inviaLancia: true }); r = await eseguiPiano(piano(['a']), mappa(['a']), { invii: 5, scade: 1 }, f.d);
  t('70 un invio che lancia conta come fallito e la riga si chiude lo stesso', r.falliti === 1 && f.log.find((x) => x[0] === 'chiudi')[3] === 'fallito');
  f = finto({ chiudiFallisce: true }); r = await eseguiPiano(piano(['a']), mappa(['a']), { invii: 5, scade: 1 }, f.d);
  t('71 esito non scritto: contato in scritture_fallite (l\'invio e\' partito, la riga resta prenotata)', r.scritture_fallite === 1 && r.inviati === 1);
  f = finto(); await eseguiPiano(piano(['riepilogo:Bene:2026-10-19']), mappa(['riepilogo:Bene:2026-10-19'], { tema: 'riepilogo', chi: 'Bene' }), { invii: 5, scade: 1 }, f.d);
  t('72 il riepilogo arriva a invia col suo chi', isDeepStrictEqual(f.log.find((x) => x[0] === 'invia'), ['invia', 'riepilogo:Bene:2026-10-19', 'Bene']));
  t('73 resoconto: soli numeri (nessuna chiave o testo esce dal giro)', Object.values(r).every((v) => typeof v === 'number'));
  // Gate 3 del 18-10
  const Re = new Map([['e', reg('e', 'fallito', 3)]]);
  f = finto(); r = await eseguiPiano(piano(['e'], Re), mappa(['e']), { invii: 5, scade: 1 }, f.d);
  t('73b RF-2: una push ferma per tentativi esauriti si conta in esauriti a ogni giro (la salute la vede), niente invio', r.esauriti === 1 && r.gia_gestiti === 1 && !f.log.some((x) => x[0] === 'invia'), r);
  f = finto({ esito: () => ({ ok: false, inviati: 0, falliti: 0, destinatari: null, status: null, errore: 'TimeoutError: signal timed out' }) });
  r = await eseguiPiano(piano(['a']), mappa(['a']), { invii: 5, scade: 1 }, f.d);
  t('73c RF-3: timeout del client -> chiusa fallito DEFINITIVA (con esito timeout), contata fra falliti ed esauriti', r.falliti === 1 && r.esauriti === 1
    && isDeepStrictEqual(f.log.find((x) => x[0] === 'chiudi'), ['chiudi', 'id-a', 1, 'fallito', 'inviati,falliti,destinatari,status,errore,timeout', 'definitivo']), f.log);
  f = finto(); r = await eseguiPiano(piano(['riepilogo:Bene:2026-10-19']), mappa(['riepilogo:Bene:2026-10-19'], { tema: 'riepilogo', chi: 'Bene' }), { invii: 5, scade: 1 }, f.d);
  t('73d RF-7: riepilogo per Bene con una push-api che non rimanda chi -> fallito definitivo (chi_ignorato), mai inviato', r.inviati === 0 && r.falliti === 1 && r.esauriti === 1
    && f.log.find((x) => x[0] === 'chiudi')[3] === 'fallito' && f.log.find((x) => x[0] === 'chiudi')[4].endsWith('chi_ignorato') && f.log.find((x) => x[0] === 'chiudi')[5] === 'definitivo', f.log);
  f = finto({ esito: (m) => ({ ok: true, inviati: 1, falliti: 0, destinatari: 1, status: 200, chi: m.chi ?? null }) });
  r = await eseguiPiano(piano(['riepilogo:Bene:2026-10-19']), mappa(['riepilogo:Bene:2026-10-19'], { tema: 'riepilogo', chi: 'Bene' }), { invii: 5, scade: 1 }, f.d);
  t('73e RF-7: push-api v2 che rimanda chi = Bene -> inviato', r.inviati === 1 && r.esauriti === 0 && f.log.find((x) => x[0] === 'chiudi').length === 5);
}

// 21-10 (v3): il giro a gruppi di attivita_team, con scritture e invio finti. Ogni riga di change_log ha la sua riga di
// registro; una push per persona e tipo, col testo delle sole righe prese da QUESTO giro.
console.log('\n== attivita del team: giro a gruppi (scritture e invio finti) ==');
// una sezione che lancia (sorgente di prima, guasto piantato) e' un KO, non ferma la suite
try {
  const H = 3600000, ORA_T = T('2026-10-19T15:40:00Z');
  const finto = (o = {}) => {
    const log = [];
    const d = {
      salta: async (righe) => { log.push(['salta', righe.map((x) => x.chiave + ':' + x.motivo).join('|')]); },
      prenota: async (k) => { log.push(['prenota', k]); if (o.prenotaLancia) throw new Error('db giu'); return (o.conflitto ?? []).includes(k) ? null : { id: 'id-' + k }; },
      riprendi: async (r) => { log.push(['riprendi', r.chiave]); return !(o.ripresaPersa ?? []).includes(r.chiave); },
      invia: async (m) => { log.push(['invia', m.titolo, m.testo]); if (o.inviaLancia) throw new Error('x'); return o.esito ? o.esito(m) : { ok: true, inviati: 1, falliti: 0, destinatari: 1, status: 200 }; },
      chiudi: async (id, ten, stato, esito, definitivo) => { log.push(['chiudi', id, ten, stato, ...(definitivo ? ['definitivo'] : [])]); return !(o.chiudiFallisce ?? []).includes(id); },
      adesso: () => o.adesso ?? 0,
    };
    return { d, log };
  };
  const pianoDi = (rows, R = new Map(), baseline = false) => pianifica(candAttivita(rows), R, { ora: ORA_T, baseline, etaMaxMs: 6 * H });
  const comp = (cs) => msgGruppoAttivita(cs, {});
  const regA = (k, stato, tentativi, minFa = 30) => ({ id: 'id-' + k, chiave: k, stato, tentativi, updated_at: new Date(ORA_T - minFa * 60000).toISOString() });
  const ginni = [clArr(2319, 'AIRPODS_CASE_COCCO_BROWN', 70), clArr(2320, 'AIRPODS_CASE_BROWN_WHITE_PONY', 42), clArr(2321, 'AIRPODS_CASE_MILITARY_GREEN', 21)];
  const benny = [clConta(2322, 'LEA_BAG_X', 5, 4, '2026-10-19T15:36:00Z')];

  let f = finto(), b = { invii: 20, scade: 1 };
  let r = await eseguiGruppi(pianoDi([...ginni, ...benny]), (c) => c.rif.gruppo, comp, b, f.d);
  const invii = (l) => l.filter((x) => x[0] === 'invia').map((x) => [x[1], x[2]]);
  t('GR1 quattro righe di due persone -> DUE push (una per persona e tipo), ogni riga prenotata e chiusa inviata una volta, budget scalato di 2',
    isDeepStrictEqual(invii(f.log), [['Ginni: pezzi arrivati', 'AIRPODS_CASE_COCCO_BROWN +70, AIRPODS_CASE_BROWN_WHITE_PONY +42, AIRPODS_CASE_MILITARY_GREEN +21. In tutto 133 pezzi'],
      ['Benny ha fatto una conta', 'LEA_BAG_X: 5 (prima 4)']]) && f.log.filter((x) => x[0] === 'prenota').length === 4
    && isDeepStrictEqual(f.log.filter((x) => x[0] === 'chiudi').map((x) => x.slice(1).join(':')).sort(), ['id-cl:2319:1:inviato', 'id-cl:2320:1:inviato', 'id-cl:2321:1:inviato', 'id-cl:2322:1:inviato'])
    && r.inviati === 2 && r.candidati === 4 && b.invii === 18, f.log);
  // la prenotazione di cl:2320 e' di un altro giro sovrapposto: questo giro non la manda e non la dice
  f = finto({ conflitto: ['cl:2320'] });
  r = await eseguiGruppi(pianoDi(ginni), (c) => c.rif.gruppo, comp, { invii: 20, scade: 1 }, f.d);
  t('GR2 una riga presa da un altro giro: la push dice SOLO le righe prese da questo (testo senza BROWN_WHITE_PONY), presi_da_altri 1, chiuse le sole due',
    isDeepStrictEqual(invii(f.log), [['Ginni: pezzi arrivati', 'AIRPODS_CASE_COCCO_BROWN +70, AIRPODS_CASE_MILITARY_GREEN +21. In tutto 91 pezzi']]) && r.presi_da_altri === 1
    && f.log.filter((x) => x[0] === 'chiudi').length === 2 && !f.log.some((x) => x[0] === 'chiudi' && x[1] === 'id-cl:2320'), f.log);
  f = finto(); b = { invii: 1, scade: 1 };
  r = await eseguiGruppi(pianoDi([...ginni, ...benny]), (c) => c.rif.gruppo, comp, b, f.d);
  t('GR3 tetto: con un invio disponibile parte il gruppo piu\' vecchio; le righe dell\'altro non si prenotano (rimandate al giro dopo, nessuna riga di registro)',
    r.inviati === 1 && r.rimandati === 1 && !f.log.some((x) => x[0] === 'prenota' && x[1] === 'cl:2322') && b.invii === 0 && invii(f.log)[0][0] === 'Ginni: pezzi arrivati', r);
  f = finto({ adesso: 10 }); r = await eseguiGruppi(pianoDi(ginni), (c) => c.rif.gruppo, comp, { invii: 20, scade: 5 }, f.d);
  t('GR4 tempo scaduto: nessuna prenotazione e nessun invio, le tre righe rimandate', r.rimandati === 3 && f.log.length === 0);
  // ritenta: cl:2319 fallita al giro prima (1 tentativo), cl:2323 nuova: una push sola con tutte e due
  const R = new Map([['cl:2319', regA('cl:2319', 'fallito', 1)], ['cl:2320', regA('cl:2320', 'inviato', 1)], ['cl:2321', regA('cl:2321', 'fallito', 3)]]);
  f = finto();
  r = await eseguiGruppi(pianoDi([...ginni, clArr(2323, 'LEA_BAG_Y', 4, '2026-10-19T15:38:00Z')], R), (c) => c.rif.gruppo, comp, { invii: 20, scade: 1 }, f.d);
  t('GR5 una riga fallita si riprende INSIEME alla nuova dello stesso gruppo: una push, la ripresa chiusa coi suoi tentativi (2), la nuova con 1; inviata e tentativi esauriti ferme',
    isDeepStrictEqual(invii(f.log), [['Ginni: pezzi arrivati', 'AIRPODS_CASE_COCCO_BROWN +70, LEA_BAG_Y +4. In tutto 74 pezzi']]) && isDeepStrictEqual(f.log.filter((x) => x[0] === 'riprendi').map((x) => x[1]), ['cl:2319'])
    && isDeepStrictEqual(f.log.filter((x) => x[0] === 'chiudi').map((x) => x.slice(1).join(':')), ['id-cl:2319:2:inviato', 'id-cl:2323:1:inviato']) && r.gia_gestiti === 2 && r.esauriti === 1, f.log);
  f = finto({ ripresaPersa: ['cl:2319'] });
  r = await eseguiGruppi(pianoDi(ginni.slice(0, 1), R), (c) => c.rif.gruppo, comp, { invii: 20, scade: 1 }, f.d);
  t('GR6 ripresa persa (un altro giro ha cambiato stato o tentativi) e nessun\'altra riga: nessun invio, budget intatto', r.presi_da_altri === 1 && !f.log.some((x) => x[0] === 'invia'));
  f = finto(); r = await eseguiGruppi(pianoDi(ginni, new Map(), true), (c) => c.rif.gruppo, comp, { invii: 20, scade: 1 }, f.d);
  t('GR7 baseline (prima accensione): UNA scrittura dei saltati per tutte le righe, nessuna prenotazione, nessun invio', isDeepStrictEqual(f.log, [['salta', 'cl:2319:baseline|cl:2320:baseline|cl:2321:baseline']]) && r.saltati === 3);
  f = finto(); r = await eseguiGruppi(pianoDi([clArr(2300, 'VECCHIO', 3, '2026-10-19T08:00:00Z'), ...ginni]), (c) => c.rif.gruppo, comp, { invii: 20, scade: 1 }, f.d);
  t('GR8 una riga di oltre 6 ore non parte (saltata vecchia) e non finisce nel testo delle nuove', isDeepStrictEqual(f.log[0], ['salta', 'cl:2300:vecchio']) && !invii(f.log)[0][1].includes('VECCHIO'));
  f = finto({ esito: () => ({ ok: false, inviati: 0, falliti: 0, destinatari: null, status: 503, errore: 'push-api ha risposto 503' }) });
  r = await eseguiGruppi(pianoDi(ginni), (c) => c.rif.gruppo, comp, { invii: 20, scade: 1 }, f.d);
  t('GR9 push-api giu\': UNA push fallita, le tre righe chiuse fallite (si riprenderanno insieme), non definitive', r.falliti === 1 && r.inviati === 0
    && f.log.filter((x) => x[0] === 'chiudi').every((x) => x[3] === 'fallito' && x.length === 4) && f.log.filter((x) => x[0] === 'chiudi').length === 3, f.log);
  f = finto({ esito: () => ({ ok: false, inviati: 0, falliti: 0, destinatari: null, status: null, errore: 'TimeoutError: signal timed out' }) });
  r = await eseguiGruppi(pianoDi(ginni), (c) => c.rif.gruppo, comp, { invii: 20, scade: 1 }, f.d);
  t('GR10 timeout del client (push-api puo\' aver consegnato): tutte le righe della push chiuse fallite DEFINITIVE, mai rimandate', r.esauriti === 1
    && f.log.filter((x) => x[0] === 'chiudi').every((x) => x[3] === 'fallito' && x[4] === 'definitivo') && f.log.filter((x) => x[0] === 'chiudi').length === 3);
  f = finto({ inviaLancia: true }); r = await eseguiGruppi(pianoDi(benny), (c) => c.rif.gruppo, comp, { invii: 20, scade: 1 }, f.d);
  t('GR11 un invio che lancia conta come fallito e le righe si chiudono lo stesso', r.falliti === 1 && f.log.find((x) => x[0] === 'chiudi')[3] === 'fallito');
  f = finto({ chiudiFallisce: ['id-cl:2320'] }); r = await eseguiGruppi(pianoDi(ginni), (c) => c.rif.gruppo, comp, { invii: 20, scade: 1 }, f.d);
  t('GR12 esito non scritto su una riga: contato in scritture_fallite (una per riga), la push conta una volta', r.scritture_fallite === 1 && r.inviati === 1);
  f = finto(); r = await eseguiGruppi(pianoDi(ginni), (c) => c.rif.gruppo, () => null, { invii: 20, scade: 1 }, f.d);
  // Gate 2 del 21-10 (R1): anche il numero delle chiusure, perche' `every` su un elenco vuoto e' vero e una riga lasciata
  // prenotata passava
  t('GR13 nessun testo per righe gia\' prese: chiuse saltate (finali, mai lasciate prenotate), nessun invio, budget intatto', r.saltati === 3 && !f.log.some((x) => x[0] === 'invia')
    && f.log.filter((x) => x[0] === 'chiudi').every((x) => x[3] === 'saltato') && f.log.filter((x) => x[0] === 'chiudi').length === 3
    && f.log.filter((x) => x[0] === 'prenota').length === 3, f.log);
  f = finto(); r = await eseguiGruppi(pianoDi(ginni), () => '', comp, { invii: 20, scade: 1 }, f.d);
  t('GR14 righe senza gruppo: le nuove si chiudono saltate (niente_da_dire), nessuna prenotazione', isDeepStrictEqual(f.log, [['salta', 'cl:2319:niente_da_dire|cl:2320:niente_da_dire|cl:2321:niente_da_dire']]));
  f = finto({ prenotaLancia: true }); let lanciato = false;
  try { await eseguiGruppi(pianoDi(ginni), (c) => c.rif.gruppo, comp, { invii: 20, scade: 1 }, f.d); } catch { lanciato = true; }
  t('GR15 prenotazione fallita (errore del DB): si ferma senza inviare', lanciato && !f.log.some((x) => x[0] === 'invia'));
  t('GR16 resoconto: soli numeri', Object.values(r).every((v) => typeof v === 'number'));
} catch (e) { t('GR! eccezione nella sezione', false, String(e?.message ?? e)); }

console.log('\n== salute del giro (PURE) ==');
{
  const ORA_S = T('2026-10-18T22:30:00Z'), min = (m) => new Date(ORA_S - m * 60000).toISOString();
  const pulito = { inviati: 0, falliti: 0, esauriti: 0, scritture_fallite: 0, nessun_iscritto: 0, persi_stallo: 0 };
  const sg = (esiti, perse = 0, ultimo = {}) => saluteGiro(esiti, ultimo, ORA_S, perse, Object.keys(esiti).length);
  const sev = (esiti, perse, ultimo) => sg(esiti, perse, ultimo).severity;
  t('S1 tutto pulito -> ok, label coi soli conteggi', sev({ cs_urgente: pulito, riepilogo: { ...pulito, inviati: 2 } }) === 'ok'
    && sg({ cs_urgente: pulito, riepilogo: { ...pulito, inviati: 2 } }).label === '2 eventi accesi, 2 push inviate' && sg({ x_y: pulito }).n === 0);
  const PII_ERR = 'cs_events urgenti: Failing row contains (Maria Rossi, maria.rossi@example.com, #1890)';
  const er = sg({ cs_urgente: { errore: PII_ERR, causa: 'lettura cs_events urgenti' }, riepilogo: pulito }, 0, { cs_urgente: min(10) });
  t('S2 un evento in errore (lettura fallita) -> error; nella label il nome e la causa del CODICE, mai il messaggio di PostgREST', er.severity === 'error'
    && er.label === '2 eventi accesi, 0 push inviate; in errore: cs_urgente (lettura cs_events urgenti)' && perdeTutto([{ titolo: er.label, testo: er.problema, url: '' }]).length === 0
    && !er.label.includes('#1890') && er.problema === 'in errore: cs_urgente (lettura cs_events urgenti)', er);
  const er31 = sg({ cs_urgente: { errore: 'x', causa: 'lettura cs_events urgenti' } }, 0, { cs_urgente: min(31) });
  const erMai = sg({ cs_urgente: { errore: 'x', causa: 'causa: con "virgolette" e <tag>' } }, 0, {});
  t('S3 in errore da oltre 30 minuti (o mai girato): detto nella label; una causa con caratteri strani diventa "errore imprevisto"', er31.label.includes('fermi da oltre 30 minuti: cs_urgente')
    && erMai.label.includes('fermi da oltre 30 minuti: cs_urgente') && erMai.label.includes('cs_urgente (errore imprevisto)') && !er.label.includes('fermi'), [er31.label, erMai.label]);
  t('S4 push-api giu\' (falliti senza nessun inviato) -> error; falliti con altri inviati -> warn', sev({ a_b: { ...pulito, falliti: 1 } }) === 'error'
    && sev({ a_b: { ...pulito, falliti: 1, inviati: 2 } }) === 'warn' && sg({ a_b: { ...pulito, falliti: 1 } }).label.includes('1 invio fallito, nessuno riuscito'));
  t('S5 esito non registrato (possibile doppione) -> error', sev({ a_b: { ...pulito, inviati: 1, scritture_fallite: 1 } }) === 'error'
    && sg({ a_b: { ...pulito, inviati: 1, scritture_fallite: 1 } }).label.includes('1 esito non registrato (possibile doppione fra 15 minuti)'));
  t('S6 RF-2: push persa dopo l\'ultimo tentativo (anche senza registro leggibile) -> warn', sev({ a_b: { ...pulito, esauriti: 1 } }, 1) === 'warn'
    && sev({ a_b: { ...pulito, esauriti: 1 } }, null) === 'warn' && sg({ a_b: { ...pulito, esauriti: 1 } }, null).label.includes('1 push persa dopo l\'ultimo tentativo'));
  t('S7 RF-2/B6: pregresso saltato a una ripartenza dopo una pausa -> warn, col nome e il numero', sev({ cs_urgente: { ...pulito, persi_stallo: 3 } }) === 'warn'
    && sg({ cs_urgente: { ...pulito, persi_stallo: 3 } }).label.includes('ripartiti dopo una pausa di oltre 2 ore: cs_urgente (3 push non inviate)'));
  t('S8 RF-2: push perse nelle ultime 24 ore (registro) tengono il warn anche a giro pulito; registro non leggibile -> warn', sev({ a_b: pulito }, 2) === 'warn'
    && sg({ a_b: pulito }, 2).label.includes('2 push perse nelle ultime 24 ore') && sev({ a_b: pulito }, null) === 'warn' && sg({ a_b: pulito }, null).label.includes('registro delle ultime 24 ore non leggibile'));
  t('S9 RF-5: evento rimandato per tempo -> warn; nessun iscritto e\' solo informazione (ok)', sev({ a_b: { rimandato: 'tempo' } }) === 'warn'
    && sg({ a_b: { rimandato: 'tempo' } }).label.includes('rimandati per tempo: a_b') && sev({ a_b: { ...pulito, nessun_iscritto: 1 } }) === 'ok'
    && sg({ a_b: { ...pulito, nessun_iscritto: 1 } }).label === '1 evento acceso, 0 push inviate, 1 senza telefoni iscritti');
  t('S10 nomi che non sono nomi di evento non entrano nella label', !sg({ 'Maria Rossi': { errore: 'x' }, a_b: pulito }).label.includes('Maria') && sev({ 'Maria Rossi': { errore: 'x' } }) === 'ok');
  t('S11 causaSicura: testo del codice tenuto, altro -> "errore imprevisto"', causaSicura('lettura cs_events urgenti') === 'lettura cs_events urgenti'
    && causaSicura('scrittura registro saltati') === 'scrittura registro saltati' && causaSicura('a@b.it') === 'errore imprevisto' && causaSicura(null) === 'errore imprevisto');
  // B6: nello stesso giorno la gravita' non scende, e la label tiene il primo problema del giorno
  const okS = sg({ a_b: pulito });
  const p1 = conPrecedente(er, null, ORA_S);
  t('S12 B6: primo problema del giorno, con l\'ora UTC, dopo il separatore', p1.severity === 'error' && p1.label === er.label + SEP_PRIMO + '22:30 UTC in errore: cs_urgente (lettura cs_events urgenti)', p1);
  const p2 = conPrecedente(okS, { severity: 'error', label: p1.label }, ORA_S + 300000);
  t('S13 B6: giro pulito dopo un errore -> resta error, "adesso a posto" e il primo problema tenuto', p2.severity === 'error'
    && p2.label === 'adesso a posto; ' + okS.label + SEP_PRIMO + '22:30 UTC in errore: cs_urgente (lettura cs_events urgenti)', p2);
  const p3 = conPrecedente(sg({ a_b: { ...pulito, falliti: 1, inviati: 1 } }), { severity: 'error', label: p1.label }, ORA_S + 600000);
  t('S14 B6: un warn dopo un error resta error; il primo problema non si sovrascrive', p3.severity === 'error' && p3.label.endsWith(SEP_PRIMO + '22:30 UTC in errore: cs_urgente (lettura cs_events urgenti)')
    && !p3.label.startsWith('adesso a posto'), p3);
  t('S15 riga di oggi ok (o assente) e giro pulito -> ok, senza primo problema', conPrecedente(okS, { severity: 'ok', label: okS.label }, ORA_S).severity === 'ok'
    && !conPrecedente(okS, null, ORA_S).label.includes(SEP_PRIMO) && conPrecedente(okS, { severity: 'boh', label: 7 }, ORA_S).severity === 'ok');
  const lunga = conPrecedente({ ...er, label: 'x'.repeat(900) }, null, ORA_S);
  t('S16 label al massimo 500 caratteri e il primo problema sopravvive al taglio', lunga.label.length === 500 && lunga.label.includes(SEP_PRIMO + '22:30 UTC'));
}

// ---------------------------------------------------------------------------------------------------------------------
// Gate 3 del 18-10: il resto della edge (MI, ritagliato dal sorgente) col client finto. Ogni chiamata diventa una FIRMA
// (tabella, operazione, colonne, head, filtri coi valori, ordine, limite): le letture si fissano per firma, quindi un
// filtro tolto o un valore spostato (la mezzanotte di Roma, le 48 ore dell'affido, i 30 giorni) cambia la firma, la
// lettura non trova risposta e il caso diventa rosso. Una lettura che il test non conosce torna errore.
const firma = (q) => [q.table, q.op, q.cols ?? '', q.head ? 'head' : '', ...q.filtri, ...q.ordine, q.limite != null ? 'limit:' + q.limite : ''].filter(Boolean).join(' ');
function sbFinto(risponde) {
  const log = [];
  const from = (table) => {
    const q = { table, op: 'select', cols: null, head: false, filtri: [], ordine: [], limite: null, payload: null, opz: null, ritorna: null };
    const b = {
      select(cols, o) { if (q.op === 'select' && q.cols === null) { q.cols = cols; q.head = o?.head === true; } else q.ritorna = cols; return b; },
      insert(v, o) { q.op = 'insert'; q.payload = v; q.opz = o ?? null; return b; },
      upsert(v, o) { q.op = 'upsert'; q.payload = v; q.opz = o ?? null; return b; },
      update(v) { q.op = 'update'; q.payload = v; return b; },
      delete() { q.op = 'delete'; return b; },
      order(c, o) { q.ordine.push(`${c}:${o?.ascending === false ? 'desc' : 'asc'}`); return b; },
      limit(n) { q.limite = n; return b; },
      then(ok, ko) {
        log.push(q);
        return Promise.resolve().then(() => risponde(q, firma(q))).then((r) => r ?? { data: null, count: null, error: { message: 'chiamata non prevista dal test: ' + firma(q) } }).then(ok, ko);
      },
    };
    for (const f of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'in', 'or', 'not', 'contains']) b[f] = (...a) => { q.filtri.push(f + ':' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('|')); return b; };
    return b;
  };
  return { sb: { from }, log };
}
// un mondo per il giro: registro push_eventi_inviati simulato (prenota, salta, riprendi e chiudi coi loro confronti),
// health_log di oggi, scritture registrate. `risposte` del caso decide le letture degli eventi.
function mondo(o = {}) {
  const reg = new Map((o.registro ?? []).map((r) => [r.chiave, { ...r }]));
  const scritte = [];
  let health = o.health ?? null;
  const filtro = (q, nome) => { const x = q.filtri.find((f) => f.startsWith(nome + '|')); return x === undefined ? undefined : x.slice(nome.length + 1); };
  const risponde = (q, f) => {
    const st = o.risposte?.(q, f);
    if (st !== undefined) return st;
    if (q.op !== 'select') {
      scritte.push({ table: q.table, op: q.op, payload: q.payload, opz: q.opz, ritorna: q.ritorna, filtri: q.filtri });
      if (o.scrittureFallite?.(q)) return { data: null, error: { message: 'scrittura finta fallita' } };
      if (q.table === 'push_eventi_inviati' && q.op === 'upsert') {
        const righe = Array.isArray(q.payload) ? q.payload : [q.payload];
        const nuove = righe.filter((r) => !reg.has(r.chiave));
        for (const r of nuove) reg.set(r.chiave, { id: 'id-' + r.chiave, ...r });
        return { data: q.ritorna ? nuove.map((r) => ({ id: 'id-' + r.chiave })) : null, error: null };
      }
      if (q.table === 'push_eventi_inviati' && q.op === 'update') {
        const id = filtro(q, 'eq:id'), stato = filtro(q, 'eq:stato'), ten = filtro(q, 'eq:tentativi');
        const r = [...reg.values()].find((x) => String(x.id) === id && (stato === undefined || x.stato === stato) && String(x.tentativi) === ten);
        if (r && !o.chiudiZero) Object.assign(r, q.payload);
        return { data: r && !o.chiudiZero ? [{ id: r.id }] : [], error: null };
      }
      if (q.table === 'health_log' && q.op === 'upsert') { health = { ...q.payload }; return { data: null, error: null }; }
      if (q.table === 'push_eventi' && q.op === 'update') return { data: null, error: null };
      return undefined;
    }
    if (q.table === 'push_eventi') return { data: o.eventi ?? [], error: null };
    if (q.table === 'push_eventi_inviati' && q.head) return { count: o.perse ? o.perse(f, reg) : 0, error: null };
    if (q.table === 'push_eventi_inviati') {
      const chiavi = JSON.parse(filtro(q, 'in:chiave') ?? '[]');
      return { data: chiavi.filter((k) => reg.has(k)).map((k) => ({ ...reg.get(k) })), error: null };
    }
    if (q.table === 'health_log' && q.filtri.includes('eq:k|push_eventi')) return o.healthGuasta ? { data: null, error: { message: 'giu' } } : { data: health ? [health] : [], error: null };
    return undefined;
  };
  const s = sbFinto(risponde);
  return { sb: s.sb, log: s.log, scritte, reg, get health() { return health; } };
}
const inviate = [];
globalThis.__invia = async (m) => { inviate.push(m); return globalThis.__esitoInvio ? globalThis.__esitoInvio(m) : { ok: true, inviati: 1, falliti: 0, destinatari: 1, status: 200, chi: m.chi ?? null }; };
globalThis.__sonni = [];
const evRiga = (evento, o = {}) => ({ evento, tema: null, attivo: true, soglie: {}, baseline_at: null, ultimo_giro_at: null, ...o });
const ctxDi = (ora, flags = {}) => ({ ora, flags, finestra: finestraRiepilogo(ora) });

console.log('\n== RF-1: la riga cs_sync letta nel buco del delete+insert di cs-sync ==');
{
  const ORA_R = T('2026-10-18T03:06:00.900Z'), ctx = ctxDi(ORA_R);
  const IERI = { severity: 'ok', created_at: '2026-10-17T23:58:01.261Z' }, FRESCA = { severity: 'ok', created_at: '2026-10-18T03:06:02.400Z' };
  const HL = 'health_log select severity, created_at eq:k|cs_sync created_at:desc limit:1';
  // il meccanismo, sui blocchi PURE: la riga di ieri letta alle 03:06 sembra uno stallo di 3 ore e partirebbe
  const finto = candCsSync(IERI, ORA_R, 15);
  t('R1a il buco del delete+insert: la riga di ieri vista alle 03:06 = "ferma da 3 ore", nuovo; una riga nata un attimo dopo ora = niente', finto.length === 1 && finto[0].rif.tipo === 'fermo'
    && pianifica(finto, new Map(), { ora: ORA_R, baseline: false, etaMaxMs: 6 * 3600000 })[0].azione === 'nuovo' && candCsSync({ severity: 'ok', created_at: new Date(ORA_R + 1500).toISOString() }, ORA_R, 15).length === 0);
  const prova = async (righe) => {
    let i = 0;
    const w = mondo({ risposte: (q, f) => (f === HL ? { data: [righe[Math.min(i++, righe.length - 1)]], error: null } : undefined) });
    globalThis.__sonni = [];
    const c = await MI.EVENTI.sistema_cs_sync_fermo.candidati(w.sb, ctx, evRiga('sistema_cs_sync_fermo'));
    return { c, letture: w.log.filter((q) => firma(q) === HL).length, altre: w.log.filter((q) => firma(q) !== HL).length, sonni: [...globalThis.__sonni] };
  };
  const buco = await prova([IERI, FRESCA]);
  t('R1b RF-1: prima lettura nel buco, seconda dopo 3 s con la riga nuova -> nessun candidato (due letture, una pausa di 3 s)', buco.c.length === 0 && buco.letture === 2 && buco.altre === 0
    && isDeepStrictEqual(buco.sonni, [MI.RILETTURA_CS_SYNC_MS]) && MI.RILETTURA_CS_SYNC_MS === 3000, buco);
  const vero = await prova([IERI, IERI]);
  t('R1c RF-1: stallo vero (anche la seconda lettura vede la riga vecchia) -> un candidato "fermo"', vero.c.length === 1 && vero.c[0].rif.tipo === 'fermo' && vero.letture === 2, vero);
  const sano = await prova([FRESCA]);
  t('R1d RF-1: riga fresca alla prima lettura -> una lettura sola, nessuna pausa', sano.c.length === 0 && sano.letture === 1 && sano.sonni.length === 0, sano);
  const err = await prova([{ severity: 'error', created_at: '2026-10-18T03:05:00.000Z' }]);
  t('R1e la riga in errore (fresca) non chiede la rilettura: candidato errore del giorno', err.c.length === 1 && err.c[0].rif.tipo === 'errore' && err.letture === 1, err);
  const wg = mondo({ risposte: (q, f) => (f === HL ? { data: null, error: { message: 'Failing row contains (Maria Rossi)' } } : undefined) });
  let lf = null;
  try { await MI.EVENTI.sistema_cs_sync_fermo.candidati(wg.sb, ctx, evRiga('sistema_cs_sync_fermo')); } catch (e) { lf = e; }
  t('R1f lettura fallita (anche dopo il ritentativo) -> LetturaFallita con la causa del codice', lf instanceof MI.LetturaFallita && lf.cosa === 'health_log cs_sync' && MI.causaDi(lf) === 'lettura health_log cs_sync');
}

console.log('\n== letture e testi di ogni evento, per firma (F4, B1-B5, C5, C7) ==');
{
  const ORA_Q = T('2026-10-19T17:00:00Z'), ctx = ctxDi(ORA_Q, { lead_outreach_ai_enabled: 'true' }), G = '2026-10-18T17:00:00.000Z';
  const LETTURE = {
    // cs_urgente
    [`cs_events select id, conversation_id, azione, at, urgente:dettaglio->>urgente in:azione|["classify","urgenza_ricalcolo"] eq:dettaglio->>urgente|true gte:at|${G} at:desc limit:50`]:
      { data: [{ id: 1, conversation_id: U1, azione: 'classify', at: '2026-10-19T16:50:00Z', urgente: 'true' }] },
    // 19-10 (decisione di Dan): nome ed email della cliente nella lettura delle conversazioni, nome in quella delle spedizioni
    [`cs_conversations select id, canale, categoria, urgente, urgenza_motivo, stato, stato_by, customer_name, customer_email in:id|["${U1}"] limit:2`]:
      { data: [{ id: U1, canale: 'email_diretta', categoria: 'Reso', urgente: true, urgenza_motivo: 'rischio disputa', stato: 'da_fare', stato_by: null, customer_name: 'Carla Bianchi', customer_email: 'carla@example.com' }] },
    'cs_conversations select id head eq:urgente|true neq:canale|rumore neq:stato|fatto': { count: 43 },
    // spedizione_eccezione
    [`v_spedizioni_eccezioni select ldv, order_name, stato_tws, updated_at, classe, customer_name eq:classe|eccezione gte:updated_at|${G} updated_at:desc limit:50`]:
      { data: [{ ldv: 'L1', order_name: '1890', stato_tws: 'INDIRIZZO ERRATO', updated_at: '2026-10-19T16:00:00Z', classe: 'eccezione', customer_name: 'Carla Bianchi' }] },
    // 21-10: le righe della settimana (LDV, stato, classe) per contare i soli problemi veri, non un conteggio della classe
    'v_spedizioni_eccezioni select ldv, stato_tws, classe eq:classe|eccezione gte:updated_at|2026-10-12T17:00:00.000Z limit:501':
      { data: ['DESTINATARIO ASSENTE', 'IN CONSEGNA MATT.', 'INDIRIZZO ERRATO', 'RITIRATA', 'N. CIVICO MANCANTE/ERRATO', 'IN CONSEGNA'].map((s, i) => ({ ldv: 'L' + i, stato_tws: s, classe: 'eccezione' })) },
    // b2b_risposta_negozio (B1: chi auto e opt_out_da_verificare nella lettura, created_at per l'eta')
    [`lead_touches select id, account_id, direzione, esito, chi, at, created_at eq:direzione|in eq:chi|auto or:esito.is.null,esito.eq.opt_out_da_verificare gte:created_at|${G} created_at:desc limit:50`]:
      { data: [{ id: U1, account_id: U2, direzione: 'in', esito: null, chi: 'auto', at: '2026-10-18T22:40:00Z', created_at: '2026-10-19T16:45:00Z' }] },
    [`lead_accounts select id, nome in:id|["${U2}"] limit:2`]: { data: [{ id: U2, nome: 'Glitter' }] },
    'v_lead_outreach select id head eq:da_gestire|true': { count: 53 },
    // cs_cliente_ha_riscritto
    [`cs_events select conversation_id, at, a:dettaglio->>a eq:azione|stato_auto eq:dettaglio->>a|da_fare gte:at|${G} at:desc limit:50`]:
      { data: [{ conversation_id: U3, at: '2026-10-19T16:30:00Z', a: 'da_fare' }] },
    [`cs_conversations select id, canale, categoria, urgente, urgenza_motivo, stato, stato_by, customer_name, customer_email in:id|["${U3}"] limit:2`]:
      { data: [{ id: U3, canale: 'email_diretta', categoria: 'Spedizione', urgente: false, stato: 'da_fare', customer_name: null, customer_email: 'Lucia.Verdi@Example.com' }] },
    'cs_conversations select id head eq:stato|da_fare eq:last_direction|in neq:canale|rumore': { count: 59 },
    // riepilogo: lunedi' 19-10 alle 19:00 di Roma (CEST), mezzanotte di Roma = 18-10 22:00Z
    'shopify_orders select gross_total gte:created_at_shop|2026-10-18T22:00:00.000Z limit:501': { data: [{ gross_total: 100 }, { gross_total: 50.4 }] },
    'qromo_sales select order_id, prezzo eq:data|2026-10-19 limit:1001': { data: [{ order_id: 'A', prezzo: 120 }, { order_id: 'B', prezzo: 30 }] },
    'shopify_orders select order_number, created_at_shop is:fulfilled_at|null or:fulfillment_status.is.null,fulfillment_status.neq.fulfilled eq:financial_status|paid gte:created_at_shop|2026-09-19T17:00:00.000Z lt:created_at_shop|2026-10-15T17:00:00.000Z created_at_shop:asc limit:201':
      { data: [{ order_number: '1890', created_at_shop: '2026-10-12T10:00:00Z' }] },
    'change_log select row_id, delta:after->>delta, qty:after->>qty in:op|["arrival","arrival_set"] gte:ts|2026-10-18T22:00:00.000Z limit:501':
      { data: [{ row_id: 'a', delta: '5', qty: null }, { row_id: 'a', delta: '-5', qty: null }, { row_id: 'b', delta: '3', qty: null }, { row_id: 'c', delta: null, qty: '2' }] },
    'change_log select id head in:op|["order","order_multi"] gte:ts|2026-10-18T22:00:00.000Z': { count: 7 },
    'loyalty_ugc select id head eq:status|in_revisione': { count: 11 },
    'cs_conversations select id head eq:stato|da_fare eq:last_direction|in lt:last_msg_at|2026-10-18T17:00:00.000Z neq:canale|rumore': { count: 13 },
    'v_lead_outreach select id head eq:scaduta|true eq:da_gestire|false is:bozza_auto_tocco|null': { count: 17 },
    'v_products_todo select codice head in:bucket|["nuovo","costo_ricavo"]': { count: 19 },
    'v_products_todo select codice head eq:bucket|pulizia': { count: 23 },
    'v_lead_inbound select conv_id head': { count: 29 },
    'v_lead_outreach select id head not:bozza_auto_tocco|is|null eq:da_gestire|false': { count: 31 },
    'shipping_status select ldv head eq:stato_tws|IN ATTESA DI AFFIDO lt:updated_at|2026-10-17T17:00:00.000Z gte:shipped_date|2026-09-19': { count: 37 },
    'cs_conversations select id head gte:created_at|2026-10-18T22:00:00.000Z neq:canale|rumore': { count: 41 },
  };
  const vista = new Set();
  const w = mondo({ risposte: (q, f) => { if (!(f in LETTURE)) return undefined; vista.add(f); return { data: null, count: null, error: null, ...LETTURE[f] }; } });
  const msgs = {};
  for (const nome of ['cs_urgente', 'spedizione_eccezione', 'b2b_risposta_negozio', 'cs_cliente_ha_riscritto', 'riepilogo']) {
    try {
      const ev = evRiga(nome);
      const cands = await MI.EVENTI[nome].candidati(w.sb, ctx, ev);
      msgs[nome] = (await MI.EVENTI[nome].componi(w.sb, ctx, ev, cands)).map((m) => [m.titolo, m.testo, m.chi ?? '']);
    } catch (e) { msgs[nome] = 'ERRORE ' + e.message; }
  }
  const nonViste = Object.keys(LETTURE).filter((f) => !vista.has(f)), inattese = w.log.map(firma).filter((f) => !(f in LETTURE));
  t('Q1 F4: ogni lettura di ogni evento ha la firma attesa (tabella, colonne, filtri coi valori, ordine, limite): nessuna mancante, nessuna in piu\'',
    nonViste.length === 0 && inattese.length === 0 && w.scritte.length === 0, { nonViste, inattese, msgs });
  t('Q2 cs_urgente: il nome della cliente nel titolo (19-10); categoria, motivo fisso, il conteggio delle urgenti aperte nel testo', isDeepStrictEqual(msgs.cs_urgente,
    [['Richiesta urgente da Carla Bianchi', 'Reso. Rischio di contestazione del pagamento. 43 urgenti aperte.', '']]), msgs.cs_urgente);
  t('Q3 spedizione: ordine, nome della cliente (19-10), stato, il conteggio della settimana dei soli problemi veri (21-10: 3 su 6 righe)', isDeepStrictEqual(msgs.spedizione_eccezione,
    [['Spedizione #1890: INDIRIZZO ERRATO (Carla Bianchi)', 'Il corriere segnala un problema. 3 spedizioni con un problema negli ultimi 7 giorni.', '']]), msgs.spedizione_eccezione);
  t('Q4 b2b: nome commerciale e risposte da gestire', isDeepStrictEqual(msgs.b2b_risposta_negozio, [['Glitter ha risposto', 'In Negozi B2B: 53 risposte da gestire.', '']]), msgs.b2b_risposta_negozio);
  t('Q5 riscritto: senza nome l\'email della cliente, minuscola, nel titolo (19-10); categoria e richieste in attesa nel testo', isDeepStrictEqual(msgs.cs_cliente_ha_riscritto,
    [['lucia.verdi@example.com ha riscritto', 'Spedizione. 59 richieste aspettano una risposta.', '']]), msgs.cs_cliente_ha_riscritto);
  t('Q6 riepilogo: ogni numero sotto la sua voce (arrivi al netto B3, azioni scadute e follow-up pronti della Coda B4, affido dei soli 30 giorni B5, da spedire con fulfillment_status C5)',
    isDeepStrictEqual(msgs.riepilogo, [
      ['Riepilogo di oggi', 'Vendite: 2 ordini sul sito (150 EUR), 2 scontrini in cassa (150 EUR)\nFornitori: 2 arrivi registrati, 7 ordini registrati\nPremia: 11 contenuti da approvare\nTeam: 13 richieste ferme da oltre 24 ore, 17 azioni B2B scadute', 'Ale'],
      ['Riepilogo di oggi', 'Prodotti: 19 da completare, 23 da pulire\nB2B: 29 messaggi da collegare, 17 azioni scadute, 31 follow-up pronti da rivedere', 'Bene'],
      ['Riepilogo di oggi', 'Da spedire da oltre 4 giorni lavorativi: 1 ordine (#1890)\nIn attesa di affido da oltre 48 ore: 37 spedizioni\nAssistenza: 41 richieste nuove oggi, 13 ferme da oltre 24 ore', 'Ginevra'],
    ]), msgs.riepilogo);
  t('Q7 B4: il riepilogo non legge piu\' lead_drafts (le bozze in proposta non scadono mai: 4 nel riepilogo, 0 nell\'app)', !/\.from\('lead_drafts'\)/.test(SRC.replace(/^\s*\/\/[^\n]*$/gm, '')));
  const tante = mondo({ risposte: (q, f) => (f.startsWith('change_log select row_id') ? { data: Array.from({ length: 501 }, (_, i) => ({ row_id: String(i), delta: '1' })), error: null }
    : f in LETTURE ? { data: null, count: null, error: null, ...LETTURE[f] } : undefined) });
  let tr = null;
  try { await MI.EVENTI.riepilogo.componi(tante.sb, ctx, evRiga('riepilogo'), candRiepilogo(ctx.finestra)); } catch (e) { tr = e; }
  t('Q8 B3: oltre 500 righe di arrivi = lettura troncata, il riepilogo si ferma (mai un numero falso)', tr instanceof MI.LetturaFallita && tr.cosa === 'arrivi del giorno');
  // Gate 2 del 21-10 (R4): il totale dei 7 giorni delle spedizioni si conta dalle righe (contaProblemi); una lettura piena
  // fino al limite o fallita ferma l'evento invece di dare un numero piu' basso del vero (Regola 20b)
  const SETT = 'v_spedizioni_eccezioni select ldv, stato_tws, classe eq:classe|eccezione gte:updated_at|2026-10-12T17:00:00.000Z limit:501';
  const sped = async (risposta) => {
    const w9 = mondo({ risposte: (q, f) => (f === SETT ? risposta : f in LETTURE ? { data: null, count: null, error: null, ...LETTURE[f] } : undefined) });
    const ev = evRiga('spedizione_eccezione');
    try { await MI.EVENTI.spedizione_eccezione.componi(w9.sb, ctx, ev, await MI.EVENTI.spedizione_eccezione.candidati(w9.sb, ctx, ev)); return null; } catch (e) { return e; }
  };
  const sp501 = await sped({ data: Array.from({ length: 501 }, (_, i) => ({ ldv: 'L' + i, stato_tws: 'DESTINATARIO ASSENTE', classe: 'eccezione' })), error: null });
  const spGiu = await sped({ data: null, error: { message: 'giu' } });
  const sp500 = await sped({ data: Array.from({ length: 500 }, (_, i) => ({ ldv: 'L' + i, stato_tws: 'DESTINATARIO ASSENTE', classe: 'eccezione' })), error: null });
  t('Q9 spedizioni: oltre 500 righe della settimana (lettura troncata) o lettura fallita = l\'evento si ferma (eccezioni della settimana); 500 righe passano',
    [sp501, spGiu].every((e) => e instanceof MI.LetturaFallita && e.cosa === 'eccezioni della settimana') && sp500 === null, [String(sp501?.message), String(spGiu?.message), String(sp500?.message)]);
}

console.log('\n== giro di un evento col client finto (F3, RF-4, RF-6, RF-3) ==');
{
  const ORA_G = T('2026-10-19T12:00:00Z'), ctx = ctxDi(ORA_G), min = (m) => new Date(ORA_G - m * 60000).toISOString();
  const b2bRighe = [{ id: U1, account_id: U2, direzione: 'in', esito: null, chi: 'auto', at: min(30), created_at: min(29) },
    { id: U3, account_id: U3, direzione: 'in', esito: null, chi: 'auto', at: min(20), created_at: min(19) }];
  const risposteB2b = (q, f) => (q.table === 'lead_touches' ? { data: b2bRighe, error: null } : q.table === 'lead_accounts' ? { data: [{ id: U2, nome: 'Glitter' }, { id: U3, nome: 'Bijou' }], error: null }
    : q.table === 'v_lead_outreach' ? { count: 2, error: null } : undefined);
  const gira = async (ev, o = {}) => {
    inviate.length = 0;
    const w = mondo({ risposte: risposteB2b, ...o });
    const r = await MI.giroEvento(w.sb, ev, ctx, { invii: 20, scade: Infinity }, () => 0);
    return { r, w, inviate: inviate.map((m) => m.titolo) };
  };
  const salti = (w) => w.scritte.filter((s) => s.table === 'push_eventi_inviati' && s.op === 'upsert' && Array.isArray(s.payload)).flatMap((s) => s.payload.map((x) => `${x.chiave}:${x.stato}:${x.esito.motivo}`));
  const pe = (w) => w.scritte.filter((s) => s.table === 'push_eventi' && s.op === 'update').map((s) => Object.keys(s.payload).sort().join(','));
  const prima = await gira(evRiga('b2b_risposta_negozio'));
  t('G1 F3: prima accensione (baseline_at vuoto) con due risposte giovani -> una scrittura di saltati (baseline), nessun invio, baseline_at scritto',
    isDeepStrictEqual(salti(prima.w), [`${U1}:saltato:baseline`, `${U3}:saltato:baseline`]) && prima.inviate.length === 0 && isDeepStrictEqual(pe(prima.w), ['baseline_at,ultimo_giro_at'])
    && prima.r.baseline === true && prima.r.persi_stallo === 0, { s: salti(prima.w), i: prima.inviate, pe: pe(prima.w) });
  // v4 (31-10, CASI_APERTI 53): alla ripartenza partono le risposte delle ultime 2 ore (19, 29 e 115 minuti); quella di 150
  // minuti fa, nata nella pausa, resta saltata col motivo "stallo" (push persa, contata in persi_stallo). Fino alla v3
  // saltavano tutte, anche quelle nate dopo la fine del blocco.
  const U4 = '44444444-4444-4444-8444-444444444444', U5 = '55555555-5555-4555-8555-555555555555';
  const vecchia = { id: U4, account_id: U1, direzione: 'in', esito: null, chi: 'auto', at: min(151), created_at: min(150) };
  const quasi = { id: U5, account_id: U5, direzione: 'in', esito: null, chi: 'auto', at: min(116), created_at: min(115) };
  const conVecchia = (extra) => (q, f) => (q.table === 'lead_touches' ? { data: [...b2bRighe, vecchia, ...extra], error: null } : risposteB2b(q, f));
  const ripresa = await gira(evRiga('b2b_risposta_negozio', { baseline_at: min(3000), ultimo_giro_at: min(180) }), { risposte: conVecchia([quasi]) });
  t('G2 v4 ripartenza dopo una pausa di 3 ore -> le risposte delle ultime 2 ore partono (dalla piu\' vecchia), quella di 150 minuti fa resta saltata come stallo; baseline_at riscritto',
    isDeepStrictEqual(ripresa.inviate, ['Un negozio ha risposto', 'Glitter ha risposto', 'Bijou ha risposto']) && isDeepStrictEqual(salti(ripresa.w), [`${U4}:saltato:stallo`])
    && ripresa.r.persi_stallo === 1 && ripresa.r.inviati === 3 && ripresa.r.baseline === true && isDeepStrictEqual(pe(ripresa.w), ['baseline_at,ultimo_giro_at']), { i: ripresa.inviate, s: salti(ripresa.w), r: ripresa.r });
  // il tetto vale anche alla ripartenza: una fresca non presa resta senza riga di registro e parte al giro dopo, che non e'
  // piu' una ripartenza; la vecchia, saltata, non parte mai
  inviate.length = 0;
  const wT = mondo({ risposte: conVecchia([]) });
  const rT = await MI.giroEvento(wT.sb, evRiga('b2b_risposta_negozio', { baseline_at: min(3000), ultimo_giro_at: min(180) }), ctx, { invii: 1, scade: Infinity }, () => 0);
  const primoGiro = inviate.map((m) => m.titolo);
  inviate.length = 0;
  const wT2 = mondo({ risposte: conVecchia([]), registro: [...wT.reg.values()] });
  const rT2 = await MI.giroEvento(wT2.sb, evRiga('b2b_risposta_negozio', { baseline_at: min(0), ultimo_giro_at: min(0) }), ctxDi(ORA_G + 300000), { invii: 20, scade: Infinity }, () => 0);
  t('G2b v4 tetto alla ripartenza: con un invio disponibile parte la fresca piu\' vecchia, l\'altra resta rimandata senza riga e parte al giro dopo; la vecchia mai',
    isDeepStrictEqual(primoGiro, ['Glitter ha risposto']) && rT.rimandati === 1 && rT.persi_stallo === 1 && !wT.reg.has(U3)
    && isDeepStrictEqual(inviate.map((m) => m.titolo), ['Bijou ha risposto']) && rT2.inviati === 1 && rT2.baseline === false && rT2.persi_stallo === 0 && wT2.reg.get(U4)?.stato === 'saltato',
    { primoGiro, r1: rT, secondo: inviate.map((m) => m.titolo), r2: rT2 });
  const normale = await gira(evRiga('b2b_risposta_negozio', { baseline_at: min(3000), ultimo_giro_at: min(5) }));
  t('G3 giro normale -> due invii (prenota, invia, chiudi inviato), solo ultimo_giro_at', isDeepStrictEqual(normale.inviate, ['Glitter ha risposto', 'Bijou ha risposto'])
    && [...normale.w.reg.values()].every((x) => x.stato === 'inviato' && x.tentativi === 1) && isDeepStrictEqual(pe(normale.w), ['ultimo_giro_at']) && normale.r.inviati === 2, normale.inviate);
  // RF-4: lo stato (cs-sync fermo da 3 ore) all'accensione e' una notizia di adesso
  const HL = 'health_log select severity, created_at eq:k|cs_sync created_at:desc limit:1';
  const fermo = await gira(evRiga('sistema_cs_sync_fermo'), { risposte: (q, f) => (f === HL ? { data: [{ severity: 'ok', created_at: min(180) }], error: null } : undefined) });
  t('G4 RF-4: cs-sync fermo da 3 ore quando l\'evento si accende -> la push parte (niente baseline per gli eventi di stato), baseline_at scritto lo stesso',
    isDeepStrictEqual(fermo.inviate, ['Posta clienti ferma']) && salti(fermo.w).length === 0 && isDeepStrictEqual(pe(fermo.w), ['baseline_at,ultimo_giro_at']), { i: fermo.inviate, s: salti(fermo.w) });
  // RF-6: chiudi che non aggiorna nessuna riga = esito non registrato
  const zero = await gira(evRiga('b2b_risposta_negozio', { baseline_at: min(3000), ultimo_giro_at: min(5) }), { chiudiZero: true });
  t('G5 RF-6: chiusura che aggiorna zero righe -> scritture_fallite (prima contava come scritta)', zero.r.scritture_fallite === 2 && zero.r.inviati === 2, zero.r);
  const chiusure = (w) => w.scritte.filter((s) => s.table === 'push_eventi_inviati' && s.op === 'update' && s.payload.stato !== 'prenotato');
  globalThis.__esitoInvio = () => ({ ok: false, inviati: 0, falliti: 0, destinatari: null, status: null, errore: 'TimeoutError: signal timed out' });
  const scad = await gira(evRiga('b2b_risposta_negozio', { baseline_at: min(3000), ultimo_giro_at: min(5) }));
  globalThis.__esitoInvio = null;
  const dopo = pianifica(candB2b(b2bRighe), new Map([...scad.w.reg.values()].map((x) => [x.chiave, { ...x, updated_at: min(0) }])), { ora: ORA_G + 300000, baseline: false, etaMaxMs: 6 * 3600000 });
  t('G6 RF-3: timeout -> la riga si chiude fallito coi tentativi al massimo (esito timeout, chiusa con .select(id)); il giro dopo non la rimanda',
    chiusure(scad.w).length === 2 && chiusure(scad.w).every((s) => s.payload.stato === 'fallito' && s.payload.tentativi === MAX_TENTATIVI && s.payload.esito.timeout === true && s.ritorna === 'id')
    && dopo.every((p) => p.azione === 'fermo' && p.motivo === 'tentativi_esauriti') && scad.r.esauriti === 2, { c: chiusure(scad.w).map((s) => s.payload), dopo: dopo.map((p) => p.motivo) });
  // v4 (31-10): il riepilogo ha un istante sintetico (le 18:30 di Roma, quando diventa dovuto) e i numeri si calcolano
  // all'invio: a una ripartenza resta fresco finche' la finestra e' aperta, anche oltre le 2 ore. Lunedi' 19-10 alle 21:00
  // di Roma, ultimo giro alle 18:00: 2 ore e mezza dalle 18:30, quindi un fatto vero della stessa eta' sarebbe stallo (G2)
  const ORA_RP = T('2026-10-19T19:00:00Z'), minRp = (m) => new Date(ORA_RP - m * 60000).toISOString();
  const LETTURE_RP = ['shopify_orders', 'qromo_sales', 'change_log', 'loyalty_ugc', 'cs_conversations', 'v_lead_outreach', 'v_products_todo', 'v_lead_inbound', 'shipping_status'];
  const wRp = mondo({ risposte: (q) => (q.op === 'select' && LETTURE_RP.includes(q.table) ? (q.head ? { count: 1, error: null } : { data: [], error: null }) : undefined) });
  inviate.length = 0;
  const rRp = await MI.giroEvento(wRp.sb, evRiga('riepilogo', { baseline_at: minRp(3000), ultimo_giro_at: minRp(180) }), ctxDi(ORA_RP), { invii: 20, scade: Infinity }, () => 0);
  t('G7 v4 riepilogo a una ripartenza alle 21:00 (2 ore e mezza dalle 18:30) -> parte a tutti e tre, niente stallo',
    isDeepStrictEqual(inviate.map((m) => `${m.titolo}:${m.chi}`), ['Riepilogo di oggi:Ale', 'Riepilogo di oggi:Bene', 'Riepilogo di oggi:Ginevra']) && rRp.baseline === true && rRp.persi_stallo === 0
    && salti(wRp).length === 0 && rRp.inviati === 3, { i: inviate.map((m) => m.chi), r: rRp, s: salti(wRp) });
}

// 21-10 (v3): attivita_team dalla lettura al registro, col client finto e il registro simulato (UNIQUE evento + chiave,
// confronti di ripresa e chiusura). La prova chiesta: righe che arrivano in due giri di fila, ognuna in UNA push.
console.log('\n== attivita del team: giri di fila col client finto (letture, registro, una riga una volta) ==');
// una sezione che lancia (sorgente di prima, guasto piantato) e' un KO, non ferma la suite
try {
  const ORA_A = T('2026-10-21T12:00:00Z'), MIN = 60000;
  const CL = (ora) => `change_log select id, ts, op, chi, codice:after->>codice, delta:after->>delta, contati:after->>contati, giac_prima:after->>giac_prima, fornitore:after->>fornitore, righe:after->>righe, gruppo:after->>gruppo in:op|["order_multi","arrival_set","count_apply"] in:chi|["Bene","Ginevra"] gte:ts|${new Date(ora - 86400000).toISOString()} id:desc limit:201`;
  const SO = (gruppi) => `supplier_orders select gruppo, codice, qty_ordered, wip in:gruppo|${JSON.stringify(gruppi)} limit:501`;
  const giraAtt = async (ora, righeCl, o = {}) => {
    inviate.length = 0;
    const w = mondo({ registro: o.registro, risposte: (q, f) => (f === CL(ora) ? (o.clRisposta ?? { data: righeCl, error: null })
      : q.table === 'supplier_orders' && q.op === 'select' ? (o.so ? o.so(f) : { data: null, error: { message: 'lettura non prevista: ' + f } }) : undefined) });
    const ev = evRiga('attivita_team', { baseline_at: 'baseline_at' in o ? o.baseline_at : new Date(ora - 3000 * MIN).toISOString(), ultimo_giro_at: new Date(ora - 5 * MIN).toISOString() });
    let r = null, err = null;
    try { r = await MI.giroEvento(w.sb, ev, ctxDi(ora), { invii: 20, scade: Infinity }, () => 0); } catch (e) { err = e; }
    return { r, err, w, push: inviate.map((m) => [m.titolo, m.testo]), meta: inviate.map((m) => [m.tema, m.url, m.chi ?? null, m.urgente]), reg: [...w.reg.values()].map((x) => ({ ...x })) };
  };
  const a100 = clArr(100, 'GALIANO_TOAST_BAG_GREEN', 20, '2026-10-21T11:54:54Z'), a101 = clArr(101, 'GALIANO_TOAST_BAG_BUTTER_YELLOW', 20, '2026-10-21T11:54:57Z');
  const a102 = clArr(102, 'LEA_BAG_COCCO_BLACK', 30, '2026-10-21T12:03:00Z');
  const g1 = await giraAtt(ORA_A, [a101, a100]);
  t('AG1 giro 1: due arrivi di Ginni -> UNA push "Ginni: pezzi arrivati" con tutti e due, tema attivita, radice dell\'app, a tutti gli iscritti al tema (nessun chi), non urgente; cl:100 e cl:101 inviate',
    isDeepStrictEqual(g1.push, [['Ginni: pezzi arrivati', 'GALIANO_TOAST_BAG_GREEN +20, GALIANO_TOAST_BAG_BUTTER_YELLOW +20. In tutto 40 pezzi']])
    && isDeepStrictEqual(g1.meta, [['attivita', APP_URL, null, false]]) && isDeepStrictEqual(g1.reg.map((x) => `${x.chiave}:${x.stato}:${x.tentativi}`).sort(), ['cl:100:inviato:1', 'cl:101:inviato:1'])
    && g1.r?.inviati === 1 && g1.r?.candidati === 2, { push: g1.push, reg: g1.reg, err: g1.err?.message });
  const g2 = await giraAtt(ORA_A + 5 * MIN, [a102, a101, a100], { registro: g1.reg });
  t('AG2 giro 2 (5 minuti dopo): la lettura rivede 100 e 101 e trova la nuova 102 -> UNA push con la SOLA 102; 100 e 101 non ripartono (registro: inviate)',
    isDeepStrictEqual(g2.push, [['Ginni: pezzi arrivati', 'LEA_BAG_COCCO_BLACK +30']]) && g2.r?.gia_gestiti === 2 && g2.r?.inviati === 1
    && isDeepStrictEqual(g2.reg.map((x) => `${x.chiave}:${x.stato}`).sort(), ['cl:100:inviato', 'cl:101:inviato', 'cl:102:inviato']), { push: g2.push, r: g2.r, err: g2.err?.message });
  const g3 = await giraAtt(ORA_A + 10 * MIN, [a102, a101, a100], { registro: g2.reg });
  const prenotazioni = [g1, g2, g3].flatMap((g) => g.w.scritte.filter((s) => s.table === 'push_eventi_inviati' && s.op === 'upsert' && !Array.isArray(s.payload)).map((s) => s.payload.chiave));
  t('AG3 giro 3 senza righe nuove: nessuna push; in tre giri ogni riga di change_log prenotata UNA volta sola (cl:100, cl:101, cl:102)', g3.push.length === 0 && g3.r?.gia_gestiti === 3
    && isDeepStrictEqual(prenotazioni.sort(), ['cl:100', 'cl:101', 'cl:102']), prenotazioni);
  // push-api giu' al giro 1, al giro 2 riparte con la riga nuova: una push sola con tutte e tre
  globalThis.__esitoInvio = () => ({ ok: false, inviati: 0, falliti: 0, destinatari: null, status: 503, errore: 'push-api ha risposto 503' });
  const f1 = await giraAtt(ORA_A, [a101, a100]);
  globalThis.__esitoInvio = null;
  const f2 = await giraAtt(ORA_A + 5 * MIN, [a102, a101, a100], { registro: f1.reg });
  t('AG4 invio fallito al giro 1 (righe fallite, 1 tentativo); al giro 2 le due riprese e la nuova partono in UNA push, chiuse coi loro tentativi (2, 2, 1)',
    f1.r?.falliti === 1 && f1.reg.every((x) => x.stato === 'fallito' && x.tentativi === 1)
    && isDeepStrictEqual(f2.push, [['Ginni: pezzi arrivati', 'GALIANO_TOAST_BAG_GREEN +20, GALIANO_TOAST_BAG_BUTTER_YELLOW +20, LEA_BAG_COCCO_BLACK +30. In tutto 70 pezzi']])
    && isDeepStrictEqual(f2.reg.map((x) => `${x.chiave}:${x.stato}:${x.tentativi}`).sort(), ['cl:100:inviato:2', 'cl:101:inviato:2', 'cl:102:inviato:1']), { f1: f1.reg, f2: f2.reg, push: f2.push });
  // un giro con le tre operazioni: tre push, i codici dell'ordine da supplier_orders (una lettura sui soli gruppi)
  const o200 = clOrd(200, 'Vincenzo (pelle)', 1, UC, '2026-10-21T11:50:00Z'), c300 = clConta(300, 'LEA_BAG_LEOPARDO_SAVANA', 5, 4, '2026-10-21T11:52:00Z');
  const m3 = await giraAtt(ORA_A, [a101, c300, a100, o200], { so: (f) => (f === SO([UC]) ? { data: [{ gruppo: UC, codice: 'LEA_BAG_COCCO_BLACK', qty_ordered: 30, wip: false }], error: null } : undefined) });
  t('AG5 un giro con ordine, conta e arrivi -> tre push (Ginni ordine, Benny conta, Ginni arrivi), dalla piu\' vecchia; supplier_orders letta UNA volta sui soli gruppi degli ordini',
    isDeepStrictEqual(m3.push, [['Ginni ha registrato un ordine', 'Vincenzo (pelle): 1 riga (LEA_BAG_COCCO_BLACK x30)'], ['Benny ha fatto una conta', 'LEA_BAG_LEOPARDO_SAVANA: 5 (prima 4)'],
      ['Ginni: pezzi arrivati', 'GALIANO_TOAST_BAG_GREEN +20, GALIANO_TOAST_BAG_BUTTER_YELLOW +20. In tutto 40 pezzi']]) && m3.w.log.filter((q) => q.table === 'supplier_orders').length === 1
    && m3.w.log.filter((q) => firma(q) === CL(ORA_A)).length === 1, { push: m3.push, err: m3.err?.message });
  const firme = m3.w.log.filter((q) => q.op === 'select').map(firma);
  t('AG6 letture: change_log (soli campi del testo, azioni e persone filtrate, 24 ore, dalla piu\' recente, limite 201), il registro sulle sole chiavi, supplier_orders sui soli gruppi; nient\'altro',
    isDeepStrictEqual(firme, [CL(ORA_A), `push_eventi_inviati select id, chiave, stato, tentativi, updated_at eq:evento|attivita_team in:chiave|${JSON.stringify(['cl:101', 'cl:100', 'cl:300', 'cl:200'])} limit:5`, SO([UC])]), firme);
  const b1 = await giraAtt(ORA_A, [a101, a100], { baseline_at: null });
  t('AG7 prima accensione: le righe che ci sono gia\' si segnano saltate (baseline) senza nessuna push, baseline_at scritto', b1.push.length === 0 && b1.reg.length === 2
    && b1.reg.every((x) => x.stato === 'saltato' && x.esito.motivo === 'baseline') && b1.w.scritte.some((s) => s.table === 'push_eventi' && 'baseline_at' in s.payload), b1.reg);
  const v1 = await giraAtt(ORA_A, [a101, clArr(99, 'VECCHIO', 5, '2026-10-21T05:30:00Z')]);
  t('AG8 una riga di oltre 6 ore non diventa mai una push (saltata vecchia); quella giovane parte', isDeepStrictEqual(v1.push, [['Ginni: pezzi arrivati', 'GALIANO_TOAST_BAG_BUTTER_YELLOW +20']])
    && v1.reg.find((x) => x.chiave === 'cl:99')?.esito?.motivo === 'vecchio');
  const pieno = await giraAtt(ORA_A, Array.from({ length: 201 }, (_, i) => clArr(1000 - i, 'X', 1, '2026-10-21T11:00:00Z')));
  const giu = await giraAtt(ORA_A, [], { clRisposta: { data: null, error: { message: 'giu' } } });
  t('AG9 lettura piena fino al limite (righe piu\' vecchie forse non viste) o fallita: l\'evento si ferma con la causa del codice, nessuna scrittura (Regola 20)',
    pieno.err instanceof MI.LetturaFallita && pieno.err.cosa === 'change_log attivita' && pieno.w.scritte.length === 0 && MI.LIMITE_ATTIVITA === 200
    && giu.err instanceof MI.LetturaFallita && giu.w.scritte.length === 0 && giu.w.log.filter((q) => firma(q) === CL(ORA_A)).length === 2, [pieno.err?.message, giu.err?.message]);
  const soGiu = await giraAtt(ORA_A, [o200], { so: () => ({ data: null, error: { message: 'giu' } }) });
  const soPiena = await giraAtt(ORA_A, [o200], { so: () => ({ data: Array.from({ length: 501 }, () => ({ gruppo: UC, codice: 'X', qty_ordered: 1, wip: false })), error: null }) });
  t('AG10 righe degli ordini non leggibili o oltre il limite: l\'evento si ferma PRIMA di prenotare (nessuna riga di registro presa, nessuna push)',
    [soGiu, soPiena].every((x) => x.err instanceof MI.LetturaFallita && x.err.cosa === 'righe degli ordini' && x.w.scritte.length === 0 && x.push.length === 0) && MI.RIGHE_ORDINE_MAX === 500);
  // run intero con l'evento acceso: la risposta e il log non portano codici, fornitori o testi
  const logA = [];
  inviate.length = 0;
  const wr = mondo({ eventi: [evRiga('attivita_team', { baseline_at: new Date(ORA_A - 3000 * MIN).toISOString(), ultimo_giro_at: new Date(ORA_A - 5 * MIN).toISOString() })],
    risposte: (q, f) => (f === CL(ORA_A) ? { data: [a101, a100, o200], error: null } : q.table === 'supplier_orders' ? { data: [{ gruppo: UC, codice: 'LEA_BAG_COCCO_BLACK', qty_ordered: 30, wip: false }], error: null } : undefined) });
  const l0 = console.log, e0 = console.error;
  console.log = (...x) => { logA.push(x.join(' ')); }; console.error = (...x) => { logA.push(x.join(' ')); };
  let corpoRun;
  try { corpoRun = await (await MI.eseguiRun(wr.sb, ctxDi(ORA_A), () => 0)).json(); } finally { console.log = l0; console.error = e0; }
  const fuori = JSON.stringify(corpoRun) + logA.join('') + JSON.stringify(wr.scritte);
  t('AG11 run con attivita_team acceso: due push, salute ok ("1 evento acceso, 2 push inviate"); risposta, log, registro e health_log senza codici, fornitori o testi',
    inviate.length === 2 && corpoRun.ok === true && wr.health?.label === '1 evento acceso, 2 push inviate' && wr.health?.severity === 'ok'
    && !/GALIANO|LEA_BAG|Vincenzo|Ginni|pezzi arrivati/.test(fuori), { corpoRun, h: wr.health });
  // anteprima: per ogni riga il testo del suo gruppo (solo per quelle che partirebbero), partirebbe = push
  const wa = mondo({ eventi: [evRiga('attivita_team', { baseline_at: new Date(ORA_A - 3000 * MIN).toISOString(), ultimo_giro_at: new Date(ORA_A - 5 * MIN).toISOString() })],
    registro: [{ id: 'id-cl:100', chiave: 'cl:100', stato: 'inviato', tentativi: 1, updated_at: new Date(ORA_A - 60000).toISOString() }],
    risposte: (q, f) => (f === CL(ORA_A) ? { data: [a102, a101, a100, c300], error: null } : q.op === 'select' && q.head ? { count: 0, error: null }
      : q.op === 'select' && !['push_eventi', 'push_eventi_inviati', 'change_log'].includes(q.table) ? { data: [], error: null } : undefined) });
  inviate.length = 0;
  const ant = await (await MI.anteprima(wa.sb, ctxDi(ORA_A), false)).json();
  const ea = ant.eventi.find((e) => e.evento === 'attivita_team');
  const perChiave = Object.fromEntries((ea?.messaggi ?? []).map((m) => [m.chiave, m.titolo ? `${m.decisione}|${m.titolo}|${m.testo}${m.non_partirebbe ? '|non_partirebbe' : ''}` : `${m.decisione}|-`]));
  t('AG12 anteprima di attivita_team: 2 push (Ginni arrivi con le sole 101 e 102, Benny conta); la riga gia\' inviata col testo del suo gruppo di righe ferme, segnata non_partirebbe (Gate 2, C2); nessuna scrittura ne\' invio',
    ea?.partirebbe === 2 && ea?.candidati === 4 && perChiave['cl:100'] === 'fermo|Ginni: pezzi arrivati|GALIANO_TOAST_BAG_GREEN +20|non_partirebbe'
    && perChiave['cl:101'] === 'nuovo|Ginni: pezzi arrivati|GALIANO_TOAST_BAG_BUTTER_YELLOW +20, LEA_BAG_COCCO_BLACK +30. In tutto 50 pezzi'
    && perChiave['cl:102'] === perChiave['cl:101'] && perChiave['cl:300'] === 'nuovo|Benny ha fatto una conta|LEA_BAG_LEOPARDO_SAVANA: 5 (prima 4)' && wa.scritte.length === 0 && inviate.length === 0, { ea, err: ea?.errore });
  // Gate 2 del 21-10 (C2): prima dell'accensione (baseline_at vuoto) ogni riga e' baseline; l'anteprima deve far vedere
  // lo stesso i titoli e i testi veri dei gruppi, segnati non_partirebbe, e partirebbe 0
  const wb = mondo({ eventi: [evRiga('attivita_team', { baseline_at: null, ultimo_giro_at: null })],
    risposte: (q, f) => (f === CL(ORA_A) ? { data: [c300, a101, a100, o200], error: null }
      : q.table === 'supplier_orders' && q.op === 'select' ? (f === SO([UC]) ? { data: [{ gruppo: UC, codice: 'LEA_BAG_COCCO_BLACK', qty_ordered: 30, wip: false }], error: null } : { data: null, error: { message: 'lettura non prevista: ' + f } })
      : q.op === 'select' && q.head ? { count: 0, error: null } : q.op === 'select' && !['push_eventi', 'push_eventi_inviati', 'change_log'].includes(q.table) ? { data: [], error: null } : undefined) });
  inviate.length = 0;
  const antB = await (await MI.anteprima(wb.sb, ctxDi(ORA_A), false)).json();
  const eb = antB.eventi.find((e) => e.evento === 'attivita_team');
  const perB = Object.fromEntries((eb?.messaggi ?? []).map((m) => [m.chiave, m.titolo ? `${m.decisione}|${m.motivo}|${m.titolo}|${m.testo}|${m.non_partirebbe === true}` : `${m.decisione}|-`]));
  t('AG13 anteprima prima dell\'accensione (baseline): partirebbe 0, ma ogni riga col titolo e il testo veri del suo gruppo, segnati non_partirebbe; nessuna scrittura ne\' invio',
    eb?.partirebbe === 0 && eb?.candidati === 4 && eb?.baseline === true
    && perB['cl:100'] === 'salta|baseline|Ginni: pezzi arrivati|GALIANO_TOAST_BAG_GREEN +20, GALIANO_TOAST_BAG_BUTTER_YELLOW +20. In tutto 40 pezzi|true' && perB['cl:101'] === perB['cl:100']
    && perB['cl:200'] === 'salta|baseline|Ginni ha registrato un ordine|Vincenzo (pelle): 1 riga (LEA_BAG_COCCO_BLACK x30)|true'
    && perB['cl:300'] === 'salta|baseline|Benny ha fatto una conta|LEA_BAG_LEOPARDO_SAVANA: 5 (prima 4)|true' && wb.scritte.length === 0 && inviate.length === 0, { eb, err: eb?.errore });
} catch (e) { t('AG! eccezione nella sezione', false, String(e?.message ?? e)); }

console.log('\n== run col client finto: salute in health_log (K1, RF-2, B6, MIG-B1, RF-5, RF-6) ==');
const runs = [], logRun = [], scritteRun = [], inviateRun = [];
{
  const ORA_E = T('2026-10-18T22:30:00Z'), ctx = ctxDi(ORA_E), min = (m) => new Date(ORA_E - m * 60000).toISOString();
  const CS = `cs_events select id, conversation_id, azione, at, urgente:dettaglio->>urgente in:azione|["classify","urgenza_ricalcolo"] eq:dettaglio->>urgente|true gte:at|${new Date(ORA_E - 86400000).toISOString()} at:desc limit:50`;
  const CONV = `cs_conversations select id, canale, categoria, urgente, urgenza_motivo, stato, stato_by, customer_name, customer_email in:id|["${U1}"] limit:2`;
  const SPED = `v_spedizioni_eccezioni select ldv, order_name, stato_tws, updated_at, classe, customer_name eq:classe|eccezione gte:updated_at|${new Date(ORA_E - 86400000).toISOString()} updated_at:desc limit:50`;
  const urgente = { data: [{ id: 1, conversation_id: U1, azione: 'classify', at: min(20), urgente: 'true' }], error: null };
  // 19-10: la conversazione porta nome ed email della cliente; finiscono nella push e da nessun'altra parte (E14)
  const convOk = { data: [{ id: U1, canale: 'email_diretta', categoria: 'Reso', urgente: true, stato: 'da_fare', customer_name: 'Carla Bianchi', customer_email: 'carla@example.com' }], error: null };
  const base = (f) => (f === CS ? { data: [], error: null } : f === SPED ? { data: [], error: null } : f.startsWith('cs_conversations select id head') ? { count: 1, error: null } : f === CONV ? convOk : undefined);
  const evCs = (o = {}) => evRiga('cs_urgente', { baseline_at: min(3000), ultimo_giro_at: min(5), ...o });
  const run = async (o = {}) => {
    inviate.length = 0; globalThis.__sonni = [];
    const w = mondo({ eventi: [evCs()], ...o, risposte: (q, f) => (o.risposte ? o.risposte(q, f) : undefined) ?? base(f) });
    const log0 = console.log, err0 = console.error;
    console.log = (...x) => { logRun.push(x.join(' ')); };
    console.error = (...x) => { logRun.push(x.join(' ')); };
    let res;
    try { res = await MI.eseguiRun(w.sb, ctx, o.adesso ?? (() => 0)); } finally { console.log = log0; console.error = err0; }
    const corpo = await res.json();
    const hu = w.scritte.filter((s) => s.table === 'health_log');
    runs.push(corpo);
    scritteRun.push(JSON.stringify(w.scritte));
    inviateRun.push(...inviate.map((m) => m.titolo));
    return { w, corpo, status: res.status, hu, h: w.health };
  };
  const pulito = await run();
  t('E1 K1: giro pulito -> UNA upsert health_log (k push_eventi, giorno UTC 2026-10-18 anche se a Roma e\' gia\' il 19, onConflict day,k), severity ok, risposta ok',
    pulito.hu.length === 1 && pulito.hu[0].op === 'upsert' && isDeepStrictEqual(pulito.hu[0].opz, { onConflict: 'day,k' }) && pulito.h?.day === '2026-10-18' && pulito.h?.k === 'push_eventi'
    && pulito.h?.severity === 'ok' && pulito.h?.label === '1 evento acceso, 0 push inviate' && pulito.h?.n === 0 && typeof pulito.h?.created_at === 'string' && pulito.corpo.ok === true && pulito.corpo.salute === 'ok', pulito.h);
  const guasto = await run({ risposte: (q, f) => (f === CS ? { data: null, error: { message: 'Failing row contains (Maria Rossi, #1890)' } } : undefined) });
  t('E2 RF-2/B6: lettura dei candidati fallita (anche dopo il ritentativo) -> error in health_log col nome e la causa del codice, mai il messaggio; ultimo_giro_at non toccato',
    guasto.h?.severity === 'error' && guasto.h?.label.startsWith('1 evento acceso, 0 push inviate; in errore: cs_urgente (lettura cs_events urgenti)') && !guasto.h?.label.includes('Maria')
    && !guasto.h?.label.includes('1890') && guasto.corpo.ok === false && guasto.w.scritte.filter((s) => s.table === 'push_eventi').length === 0
    && guasto.w.log.filter((q) => firma(q) === CS).length === 2 && guasto.corpo.eventi.cs_urgente.errore.includes('Maria'), guasto.h);
  // RF-2: push-api giu' per quattro giri: i primi tre falliscono (error), il quarto trova i tentativi esauriti e resta warn
  const registro = [];
  const giu = { risposte: (q, f) => (f === CS ? urgente : undefined) };
  globalThis.__esitoInvio = () => ({ ok: false, inviati: 0, falliti: 0, destinatari: null, status: 503, errore: 'push-api ha risposto 503' });
  const giri = [];
  let regAttuale = [];
  for (let i = 0; i < 4; i++) {
    const r = await run({ ...giu, registro: regAttuale.map((x) => ({ ...x, updated_at: min(1) })) });
    regAttuale = [...r.w.reg.values()];
    giri.push({ sev: r.h?.severity, ok: r.corpo.ok, invii: inviate.length, label: r.h?.label });
  }
  globalThis.__esitoInvio = null;
  registro.push(...regAttuale);
  t('E3 RF-2/MIG-B1: push-api giu\' -> giri 1-3 error (falliti senza inviati); il 4 trova i tentativi esauriti: warn, mai ok; tre invii in tutto',
    giri.slice(0, 3).every((g) => g.sev === 'error' && g.invii === 1 && g.label.includes('1 invio fallito, nessuno riuscito')) && giri[3].sev === 'warn' && giri[3].invii === 0 && giri[3].ok === false
    && regAttuale[0].stato === 'fallito' && regAttuale[0].tentativi === 3, giri);
  const perse = await run({ perse: (f) => (f.includes('eq:stato|fallito') ? 1 : 0) });
  t('E4 RF-2: giro pulito ma una push persa nelle ultime 24 ore (registro) -> warn per un giorno', perse.h?.severity === 'warn' && perse.h?.label.includes('1 push persa nelle ultime 24 ore')
    && perse.w.log.some((q) => firma(q) === `push_eventi_inviati select id head eq:stato|fallito gte:tentativi|3 gte:updated_at|${min(1440)}`)
    && perse.w.log.some((q) => firma(q) === `push_eventi_inviati select id head eq:stato|saltato eq:esito->>motivo|stallo gte:updated_at|${min(1440)}`), perse.h);
  // B6 e RF-2: un guasto che dura oltre le 2 ore si trasforma in `saltato` alla ripartenza: deve restare visibile
  // dalla v4 (31-10) salta solo il pregresso vecchio: qui l'urgente e' nata nella pausa, 170 minuti fa
  const urgenteVecchia = { data: [{ ...urgente.data[0], at: min(170) }], error: null };
  const convRotta = { data: null, error: { message: 'colonna rinominata' } };
  const stallo = await run({ eventi: [evCs({ ultimo_giro_at: min(180) })], risposte: (q, f) => (f === CS ? urgenteVecchia : f === CONV ? convRotta : undefined) });
  t('E5 B6: ripartenza dopo un guasto di 3 ore (componi ancora rotto), urgente di 170 minuti fa -> saltata come stallo senza comporla, warn, risposta non ok',
    stallo.h?.severity === 'warn' && stallo.h?.label.includes('ripartiti dopo una pausa di oltre 2 ore: cs_urgente (1 push non inviata)') && stallo.corpo.ok === false && inviate.length === 0
    && stallo.w.scritte.some((s) => s.table === 'push_eventi_inviati' && Array.isArray(s.payload) && s.payload[0].esito.motivo === 'stallo'), stallo.h);
  // v4: un'urgente fresca a una ripartenza con componi ancora rotto non diventa uno stallo silenzioso: l'evento si ferma
  // (error), niente registro e niente ultimo_giro_at, e il giro dopo decide di nuovo
  const frescaRotta = await run({ eventi: [evCs({ ultimo_giro_at: min(180) })], risposte: (q, f) => (f === CS ? urgente : f === CONV ? convRotta : undefined) });
  t('E5b v4 ripartenza con un\'urgente di 20 minuti fa e componi rotto -> error (lettura cs_conversations), nessuno stallo scritto, ultimo_giro_at non toccato',
    frescaRotta.h?.severity === 'error' && frescaRotta.h?.label.includes('in errore: cs_urgente (lettura cs_conversations)') && inviate.length === 0
    && !frescaRotta.w.scritte.some((s) => s.table === 'push_eventi_inviati') && !frescaRotta.w.scritte.some((s) => s.table === 'push_eventi'), frescaRotta.h);
  // v4, il caso del 31-10 (CASI_APERTI 53): Supabase bloccato dalle 22:49 alle 12:58 UTC, cs-classify alle 13:00,
  // push-eventi alle 13:01. Ultimo giro 14 ore fa, classify urgente di un minuto fa: la push parte e la salute resta ok
  const blocco = await run({ eventi: [evCs({ ultimo_giro_at: min(14 * 60) })], risposte: (q, f) => (f === CS ? { data: [{ ...urgente.data[0], at: min(1) }], error: null } : undefined) });
  t('E5c v4 31-10: ripartenza dopo un blocco di 14 ore, urgente classificata un minuto prima -> la push parte, nessuno stallo, salute ok, baseline_at riscritto',
    isDeepStrictEqual(inviate.map((m) => m.titolo), ['Richiesta urgente da Carla Bianchi']) && blocco.h?.severity === 'ok' && blocco.corpo.ok === true
    && blocco.corpo.eventi.cs_urgente?.inviati === 1 && blocco.corpo.eventi.cs_urgente?.persi_stallo === 0 && blocco.corpo.eventi.cs_urgente?.baseline === true
    && !blocco.w.scritte.some((s) => s.table === 'push_eventi_inviati' && Array.isArray(s.payload))
    && blocco.w.scritte.some((s) => s.table === 'push_eventi' && s.op === 'update' && 'baseline_at' in s.payload), { h: blocco.h, e: blocco.corpo.eventi });
  const acceso = await run({ eventi: [evCs({ baseline_at: null, ultimo_giro_at: null })], risposte: (q, f) => (f === CS ? urgente : undefined) });
  t('E6 RF-2: prima accensione con pregresso -> saltato baseline, salute ok', acceso.h?.severity === 'ok' && acceso.corpo.ok === true
    && acceso.w.scritte.some((s) => s.table === 'push_eventi_inviati' && Array.isArray(s.payload) && s.payload[0].esito.motivo === 'baseline'), acceso.h);
  const appiccicoso = await run({ health: { day: '2026-10-18', k: 'push_eventi', severity: 'error', label: 'x' + SEP_PRIMO + '20:05 UTC in errore: riepilogo (lettura ordini del giorno)' } });
  t('E7 B6: riga di oggi in error e giro pulito -> resta error, "adesso a posto" e il primo problema del giorno; la risposta del giro dice ok',
    appiccicoso.h?.severity === 'error' && appiccicoso.h?.label === 'adesso a posto; 1 evento acceso, 0 push inviate' + SEP_PRIMO + '20:05 UTC in errore: riepilogo (lettura ordini del giorno)'
    && appiccicoso.corpo.ok === true && appiccicoso.corpo.salute === 'error', appiccicoso.h);
  const cieca = await run({ healthGuasta: true });
  const ciecaErr = await run({ healthGuasta: true, risposte: (q, f) => (f === CS ? { data: null, error: { message: 'giu' } } : undefined) });
  t('E8 B6: riga di oggi non leggibile -> un giro pulito NON riscrive (non copre un errore che non vede); un giro in errore scrive error',
    cieca.hu.length === 0 && cieca.corpo.errore_salute === 'salute di oggi non leggibile: riga non riscritta' && cieca.corpo.ok === false
    && ciecaErr.hu.length === 1 && ciecaErr.h?.severity === 'error', { c: cieca.corpo, e: ciecaErr.h });
  const scritturaGiu = await run({ scrittureFallite: (q) => q.table === 'health_log' });
  t('E9 health_log non scritto -> risposta non ok con errore_salute (mai ritentato: una sola upsert)', scritturaGiu.hu.length === 1 && scritturaGiu.corpo.ok === false
    && scritturaGiu.corpo.errore_salute === 'health_log non scritto');
  let orologio = 0;
  const lento = await run({ eventi: [evCs(), evRiga('spedizione_eccezione', { baseline_at: min(3000), ultimo_giro_at: min(5) })], adesso: () => orologio,
    risposte: (q, f) => { if (f === CS) { orologio += 31000; return { data: [], error: null }; } return undefined; } });
  t('E10 RF-5: oltre 30 s dall\'inizio un evento non si comincia: rimandato, ultimo_giro_at non toccato, warn', lento.corpo.eventi.spedizione_eccezione?.rimandato === 'tempo'
    && !lento.w.log.some((q) => firma(q) === SPED) && lento.w.scritte.filter((s) => s.table === 'push_eventi').length === 1 && lento.h?.severity === 'warn'
    && lento.h?.label.includes('rimandati per tempo: spedizione_eccezione') && MI.TEMPO_EVENTI_MS === 30000, lento.corpo);
  const ignoto = await run({ eventi: [evCs(), evRiga('evento_futuro')] });
  t('E11 RF-6: evento acceso sconosciuto a questa versione -> error, nome nella label', ignoto.h?.severity === 'error' && ignoto.h?.label.includes('in errore: evento_futuro (evento sconosciuto)') && ignoto.corpo.ok === false, ignoto.h);
  const illeggibili = await run({ risposte: (q) => (q.table === 'push_eventi' && q.op === 'select' ? { data: null, error: { message: 'giu' } } : undefined) });
  t('E12 eventi non leggibili -> 503 e la salute lo scrive (error)', illeggibili.status === 503 && illeggibili.hu.length === 1 && illeggibili.h?.severity === 'error'
    && illeggibili.h?.label.startsWith('eventi non leggibili'), illeggibili.h);
  const chiusuraZero = await run({ risposte: (q, f) => (f === CS ? urgente : undefined), chiudiZero: true });
  t('E13 RF-6: esito non registrato (chiusura su zero righe) -> error', chiusuraZero.h?.severity === 'error' && chiusuraZero.h?.label.includes('1 esito non registrato'), chiusuraZero.h);
  const tutte = JSON.stringify(runs) + JSON.stringify(logRun);
  t('E14 risposte e log del run: mai titolo o testo di una push (il testo degli errori resta in risposta e log, mai in health_log: E2)',!tutte.includes('Richiesta urgente') && !tutte.includes('Reso') && logRun.length >= 14);
  const fuoriPush = tutte + scritteRun.join('');
  t('N12 (19-10) il nome della cliente parte nella push (E3, E13) e non finisce mai in risposta, log, registro (prenotazioni, esiti, saltati) o health_log',
    inviateRun.filter((x) => x === 'Richiesta urgente da Carla Bianchi').length >= 4 && !/Carla|Bianchi|carla@/i.test(fuoriPush) && scritteRun.length >= 14, inviateRun);
}

console.log('\n== anteprima col client finto ==');
{
  const ORA_A = T('2026-10-19T17:00:00Z');
  inviate.length = 0;
  const w = mondo({ eventi: [], risposte: (q) => (q.op === 'select' && q.head ? { count: 0, error: null } : q.op === 'select' && q.table !== 'push_eventi' && q.table !== 'push_eventi_inviati' ? { data: [], error: null } : undefined) });
  const res = await MI.anteprima(w.sb, ctxDi(ORA_A), true);
  const corpo = await res.json();
  t('V1 anteprima: nessuna scrittura (registro, push_eventi, health_log) e nessun invio, tutti e sette gli eventi', w.scritte.length === 0 && inviate.length === 0
    && corpo.eventi.length === 7 && corpo.eventi.every((e) => !e.errore), corpo.eventi.map((e) => e.errore ?? e.evento));
}

console.log('\n== guardie sul sorgente ==');
const codice = (s) => s.replace(/^\s*\/\/[^\n]*$/gm, '');
const flat = (s) => s.replace(/\)\s*\n\s*\./g, ').');
const fuoriPure = (s) => { let r = s; for (const b of BLOCCHI) { const x = cut(r, b); if (x !== null) r = r.replace(x, ''); } return r; };
const corpoFunzione = (s, firma) => { const i = s.indexOf(firma); if (i < 0) return ''; const j = s.indexOf('\n}\n', i); return j < 0 ? '' : s.slice(i, j + 2); };
const corpoServe = (s) => { const i = s.indexOf('Deno.serve(async (req) => {'); if (i < 0) return ''; const j = s.indexOf('\n});\n', i); return j < 0 ? '' : s.slice(i, j + 4); };
const righeSb = (s) => flat(codice(s)).split('\n').filter((l) => l.includes('sb.from('));
const SCRITTURA = /\.(insert|update|upsert|delete)\(/;
const RETRY_SU_SCRITTURA = /retryOnce\(\(\) => sb\.from\('[^']+'\)\.(insert|update|upsert|delete)\(/;
const PIN_401 = "if (!pinHash || typeof body.pin !== 'string' || !body.pin || !ugualeCostante(await sha256hex(body.pin), pinHash)) return json({ error: 'PIN errato' }, 401);";
const CFG = "const { data: cfg, error: cfgErr } = await retryOnce(() => sb.from('app_config').select('pin_hash').eq('id', 1).limit(1));";
const SERV_403 = "if (!svc || !ugualeCostante(token, svc)) return json({ error: 'anteprima solo con la chiave di servizio' }, 403);";
const NOOP = "if (!flagVero(flags.push_eventi_enabled) || !flagVero(flags.push_enabled)) return json({ ok: true, skipped: 'disabled' });";
const SOLO_ATTIVI = "const { data: righe, error: eErr } = await retryOnce(() => sb.from('push_eventi').select('evento, tema, attivo, soglie, baseline_at, ultimo_giro_at').eq('attivo', true).limit(50));";

const pinPrima = (s) => {
  const f = codice(corpoServe(s));
  const c = f.indexOf(CFG), e = f.indexOf("if (cfgErr) return json({ error: 'configurazione non leggibile, riprova' }, 503);"), p = f.indexOf(PIN_401);
  const a = f.indexOf("const action = typeof body.action === 'string' && body.action ? body.action : 'run';");
  const altre = (f.slice(0, c).match(/sb\.from\(/g) ?? []).length;
  return c > 0 && e > c && p > e && a > p && altre === 0 && (codice(s).match(/sha256hex\(/g) ?? []).length === 2;
};
const anteprimaProtetta = (s) => {
  const f = codice(corpoServe(s));
  const g = f.indexOf("if (action === 'anteprima') {"), no = f.indexOf(SERV_403), fl = f.indexOf(".from('app_flags')"), call = f.indexOf('if (action === \'anteprima\') return await anteprima(sb, ctx, body.forza_riepilogo === true);');
  return g > f.indexOf(PIN_401) && no > g && fl > no && call > fl && (codice(s).match(/await anteprima\(/g) ?? []).length === 1;
};
const RUN_DOPO_NOOP = 'return await eseguiRun(sb, ctx);';
const corpoRun = (s) => codice(corpoFunzione(s, 'async function eseguiRun('));
// Gate 3 (18-10): il run sta in eseguiRun, che Deno.serve chiama UNA volta e solo dopo il NO-OP; la lettura degli eventi
// (e quindi ogni scrittura, health_log compresa) sta li' dentro
const noopAFlagSpento = (s) => {
  const f = codice(corpoServe(s));
  const n = f.indexOf(NOOP), r = f.indexOf(RUN_DOPO_NOOP);
  return n > f.indexOf("if (action === 'anteprima') return await anteprima(") && r > n && (codice(s).match(/eseguiRun\(sb, ctx/g) ?? []).length === 1
    && !/\.from\('push_eventi'\)/.test(f) && corpoRun(s).includes(SOLO_ATTIVI)
    && f.includes("const { data: frows, error: fErr } = await retryOnce(() => sb.from('app_flags').select('key, value').in('key', ['push_eventi_enabled', 'push_enabled', 'lead_outreach_ai_enabled']).limit(10));")
    && f.includes("if (fErr) return json({ ok: false, error: 'flag non leggibili, riprova' }, 503);");
};
const soloAttivi = (s) => {
  const f = corpoRun(s);
  return f.includes(SOLO_ATTIVI) && f.includes('const attivi = new Map(((righe ?? []) as RigaEvento[]).filter((r) => r.attivo === true).map((r) => [r.evento, r]));')
    && f.includes('const ev = attivi.get(nome);') && f.includes('if (!ev) continue;') && (codice(s).match(/giroEvento\(sb,/g) ?? []).length === 1;
};
const soloInviaPush = (s) => {
  const c = codice(s);
  return c.includes("import { inviaPush } from '../_shared/push.ts';") && !/consegnaAvviso|canaleEffettivo|ntfy/i.test(c) && (c.match(/inviaPush\(/g) ?? []).length === 1
    && !/\bfetch\(/.test(c) && c.includes("invia: (m) => inviaPush({ tema, titolo: m.titolo, testo: m.testo, url: m.url, urgente: m.urgente === true, ...(m.chi ? { chi: m.chi } : {}) }),");
};
const lettureSenzaLimite = (s) => righeSb(s).filter((l) => l.includes('.select(') && !SCRITTURA.test(l) && !l.includes('.limit(') && !l.includes("{ count: 'exact', head: true }"));
const lettureSenzaError = (s) => righeSb(s).filter((l) => !/const \{[^}]*\berror\b[^}]*\} = await (?:retryOnce\(\(\) => )?sb\.from\(/.test(l) && !/^\s*conta\(retryOnce\(\(\) => sb\.from\(/.test(l)
  && !/const aperte = await conta\(retryOnce|const settimana = await conta\(retryOnce|const daGestire = await conta\(retryOnce|const inAttesa = await conta\(retryOnce|collegare \? conta\(retryOnce/.test(l));
const lettureNonRitentate = (s) => righeSb(s).filter((l) => l.includes('.select(') && !SCRITTURA.test(l) && !l.includes('retryOnce(() => sb.from('));
const scrittureRitentate = (s) => righeSb(s).filter((l) => RETRY_SU_SCRITTURA.test(l));
// K1 (18-10): fuori dal modulo push_* la edge scrive SOLO la sua riga di salute, con questa riga esatta
const SALUTE_UPSERT = "const { error } = await sb.from('health_log').upsert({ day, k: 'push_eventi', label: r.label, n: r.n, severity: r.severity, created_at: new Date().toISOString() }, { onConflict: 'day,k' });";
const scrittureFuoriModulo = (s) => righeSb(s).filter((l) => SCRITTURA.test(l) && !/sb\.from\('(push_eventi_inviati|push_eventi)'\)/.test(l) && l.trim() !== SALUTE_UPSERT);
// F5 (18-10): le colonne lette sono un ELENCO AMMESSO per tabella, non un elenco di quelle vietate (raw di shopify_orders
// passava). health_log per chiave: di cs_sync mai la label (puo' citare un oggetto o un mittente), di push_eventi si'
// (e' la riga che la edge stessa scrive, soli nomi e numeri). Le espressioni json sono ammesse una per una.
const AMMESSE = {
  app_config: ['pin_hash'], app_flags: ['key', 'value'],
  push_eventi: ['evento', 'tema', 'attivo', 'soglie', 'baseline_at', 'ultimo_giro_at'], push_eventi_inviati: ['id', 'chiave', 'stato', 'tentativi', 'updated_at'],
  'health_log:cs_sync': ['severity', 'created_at'], 'health_log:push_eventi': ['severity', 'label'],
  cs_events: ['id', 'conversation_id', 'azione', 'at', 'dettaglio->>urgente', 'dettaglio->>a'],
  // customer_name e customer_email dal 19-10 (decisione di Dan), e SOLO nelle due letture di LETTURE_CLIENTE (caso N13)
  cs_conversations: ['id', 'canale', 'categoria', 'urgente', 'urgenza_motivo', 'stato', 'stato_by', 'customer_name', 'customer_email'],
  v_spedizioni_eccezioni: ['ldv', 'order_name', 'stato_tws', 'updated_at', 'classe', 'customer_name'],
  lead_touches: ['id', 'account_id', 'direzione', 'esito', 'chi', 'at', 'created_at'], lead_accounts: ['id', 'nome'],
  v_lead_outreach: ['id'], v_lead_inbound: ['conv_id'], v_products_todo: ['codice'], loyalty_ugc: ['id'], shipping_status: ['ldv'],
  shopify_orders: ['gross_total', 'order_number', 'created_at_shop'], qromo_sales: ['order_id', 'prezzo'],
  // 21-10 (attivita_team): istante, azione, chi e i soli campi di after che finiscono nel testo; mai ctx, purchase_id, costo
  change_log: ['id', 'row_id', 'after->>delta', 'after->>qty', 'ts', 'op', 'chi', 'after->>codice', 'after->>contati', 'after->>giac_prima', 'after->>fornitore', 'after->>righe', 'after->>gruppo'],
  supplier_orders: ['gruppo', 'codice', 'qty_ordered', 'wip'],
};
const selectFuoriElenco = (s) => {
  const out = [];
  let viste = 0;
  for (const l of righeSb(s)) {
    const tab = (l.match(/sb\.from\('([^']+)'\)/) ?? [])[1];
    const k = tab === 'health_log' ? `health_log:${(l.match(/\.eq\('k', '([^']+)'\)/) ?? [])[1]}` : tab;
    for (const m of l.matchAll(/\.select\('([^']*)'/g)) {
      viste++;
      for (const col of m[1].split(',').map((x) => x.trim()).map((x) => (x.includes(':') ? x.slice(x.indexOf(':') + 1) : x))) if (!(AMMESSE[k] ?? []).includes(col)) out.push(`${k}: ${col}`);
    }
  }
  const tutte = (codice(s).match(/\.select\(/g) ?? []).length;
  if (viste !== tutte) out.push(`select fuori da una riga sb.from: ${tutte - viste}`);
  return out;
};
// 19-10 (decisione di Dan): nome ed email della cliente si leggono in queste due select esatte e in nessun'altra (non nei
// conteggi, non in altre tabelle), e si usano SOLO come argomenti di nomeCliente (nessun altro percorso verso il testo)
const LETTURE_CLIENTE = [
  "sb.from('cs_conversations').select('id, canale, categoria, urgente, urgenza_motivo, stato, stato_by, customer_name, customer_email').in('id', ids).limit(ids.length + 1)",
  "sb.from('v_spedizioni_eccezioni').select('ldv, order_name, stato_tws, updated_at, classe, customer_name').eq('classe', 'eccezione')",
];
const USI_CLIENTE = [['nomeCliente(v.customer_name, v.customer_email)', 2], ['nomeCliente(r.customer_name, null)', 1]];
const lettureCliente = (s) => {
  const righe = righeSb(s).filter((l) => /customer_/.test(l));
  const out = righe.filter((l) => !LETTURE_CLIENTE.some((x) => l.includes(x))).map((l) => 'lettura fuori elenco: ' + l.trim().slice(0, 120));
  for (const x of LETTURE_CLIENTE) if (righe.filter((l) => l.includes(x)).length !== 1) out.push('lettura mancante o doppia: ' + x.slice(0, 60));
  let resto = flat(codice(s));
  for (const x of LETTURE_CLIENTE) resto = resto.split(x).join('');
  for (const [uso, n] of USI_CLIENTE) { const k = resto.split(uso).length - 1; if (k !== n) out.push(`${uso}: ${k} invece di ${n}`); resto = resto.split(uso).join(''); }
  if (/customer_/.test(resto)) out.push('customer_ fuori da nomeCliente: ' + (resto.match(/[^\n]*customer_[^\n]*/) ?? [''])[0].trim().slice(0, 120));
  return out;
};
const anteprimaSoloLettura = (s) => {
  const f = codice(corpoFunzione(s, 'async function anteprima('));
  return f.length > 200 && !SCRITTURA.test(f) && !/depGiro|eseguiPiano|eseguiGruppi|inviaPush|giroEvento|eseguiRun|scriviSalute|health_log/.test(f)
    && f.includes(".from('push_eventi').select('evento, tema, attivo, soglie, baseline_at, ultimo_giro_at').limit(50)") && f.includes('const { baseline, ripartenza } = baselineDi(ev, c.ora);')
    && f.includes("motivoBaseline: ripartenza ? 'stallo' : 'baseline', frescoMs: frescoRipartenzaMs(ev.evento) });");
};
const CHIUDI = ".update({ stato, esito, updated_at: ora(), ...(definitivo ? { tentativi: MAX_TENTATIVI } : {}) }).eq('id', id).eq('tentativi', tentativi).select('id');\n      if (error) console.error('push-eventi: esito non registrato', evento, String(id), errTesto(error));\n      return !error && (data ?? []).length > 0;";
const registroScritture = (s) => {
  const f = codice(corpoFunzione(s, 'function depGiro('));
  return f.includes("upsert({ evento, chiave, stato: 'prenotato', tentativi: 1, updated_at: ora() }, { onConflict: 'evento,chiave', ignoreDuplicates: true }).select('id');")
    && f.includes("{ onConflict: 'evento,chiave', ignoreDuplicates: true });") && f.includes(".eq('id', r.id).eq('stato', r.stato).eq('tentativi', r.tentativi).select('id');")
    && f.includes(CHIUDI) && (f.match(/\.insert\(/g) ?? []).length === 0;
};
// F3 (18-10): da dove viene `baseline` (baselineDi, una sola assegnazione) e che arrivi davvero a pianifica
const BASELINE_DI = 'const { seme, baseline, ripartenza } = baselineDi(ev, ctx.ora);';
// v4 (31-10): con la finestra fresca della ripartenza dell'evento (frescoRipartenzaMs)
const PIANIFICA_GIRO = "const piano = pianifica(cands, registro, { ora: ctx.ora, baseline, etaMaxMs: soglia(ev.soglie, 'eta_max_ore', 6, 1, 48) * 3600000, motivoBaseline: ripartenza ? 'stallo' : 'baseline', frescoMs: frescoRipartenzaMs(ev.evento) });";
const giroComposto = (s) => {
  const f = codice(corpoFunzione(s, 'async function giroEvento('));
  const bl = f.indexOf(BASELINE_DI), pl = f.indexOf(PIANIFICA_GIRO), co = f.indexOf("const daComporre = piano.filter((p) => p.azione === 'nuovo' || p.azione === 'ritenta').map((p) => p.cand);");
  // 21-10 (v3): due rami dopo la composizione, a gruppi (eseguiGruppi, dettagli letti PRIMA di ogni prenotazione) e per
  // candidato (eseguiPiano), con lo stesso piano e lo stesso depGiro; ultimo_giro_at dopo entrambi
  const dp = f.indexOf('const dep = depGiro(sb, ev.evento, tema, adesso);'), dt = f.indexOf('const dettagli = daComporre.length ? await g.dettagli(sb, ctx, ev, daComporre) : {};');
  const eg = f.indexOf('r = await eseguiGruppi(piano, g.gruppoDi, (cs) => { const m = g.messaggio(cs, dettagli); return m && { ...m, tema }; }, budget, dep);');
  const es = Math.max(eg, f.indexOf('r = await eseguiPiano(piano, msgs, budget, dep);'));
  if (!(dp > co && dt > dp && eg > dt && f.indexOf('r = await eseguiPiano(piano, msgs, budget, dep);') > eg && (f.match(/await eseguiGruppi\(|await eseguiPiano\(/g) ?? []).length === 2)) return false;
  const up = f.indexOf(".from('push_eventi').update(seme ? { ultimo_giro_at: fine, baseline_at: fine } : { ultimo_giro_at: fine }).eq('evento', ev.evento);");
  const assegna = (f.match(/\b(?:const|let|var)\s+(?:\{[^}]*\b(?:seme|baseline|ripartenza)\b[^}]*\}|(?:seme|baseline|ripartenza)\b)|\b(?:seme|baseline|ripartenza)\s*=[^=>]/g) ?? []).length;
  return bl > 0 && pl > bl && co > pl && es > co && up > es && assegna === 1 && f.includes('const registro = await leggiRegistro(sb, ev.evento, cands.map((c) => c.chiave));')
    && f.includes('msgs.set(m.chiave, { ...m, tema })') && f.includes("const persi_stallo = piano.filter((p) => p.azione === 'salta' && p.motivo === 'stallo').length;");
};
const flagsOrfani = (s) => { const l = [...(s.match(/\.in\('key', \[([^\]]*)\]\)/) ?? ['', ''])[1].matchAll(/'([^']+)'/g)].map((x) => x[1]); return [...codice(s).matchAll(/\bflags\.(\w+)/g)].map((x) => x[1]).filter((k) => !l.includes(k)); };
const rispostaRunSoloConteggi = (s) => {
  const f = corpoRun(s);
  return f.includes("console.log(JSON.stringify({ fn: 'push-eventi', azione: 'run', eventi: esiti, inviati, errori, salute: salute.severity, durata_ms }));")
    && f.includes("return json({ ok: delGiro.severity === 'ok' && salute.scritta, eventi: esiti, inviati, salute: salute.severity, ...(salute.errore ? { errore_salute: salute.errore } : {}), durata_ms });")
    && codice(corpoFunzione(s, 'async function giroEvento(')).includes("return { ...r, baseline, persi_stallo, ...(error ? { errore: 'push_eventi non aggiornato: ' + errTesto(error), causa: 'scrittura push_eventi' } : {}) };");
};
// K1, RF-2, B6, MIG-B1 (18-10): UNA upsert di health_log, solo in scriviSalute, giorno UTC, mai ritentata, gravita' da
// conPrecedente; scriviSalute chiamata solo da eseguiRun (due volte: eventi non leggibili, fine del giro), alla fine del giro
const saluteScritta = (s) => {
  const c = codice(s), sv = codice(corpoFunzione(s, 'async function scriviSalute(')), run = corpoRun(s);
  const righeHl = righeSb(s).filter((l) => l.includes("sb.from('health_log')") && SCRITTURA.test(l));
  const fine = run.indexOf('const salute = await scriviSalute(sb, ctx.ora, delGiro);');
  return righeHl.length === 1 && righeHl[0].trim() === SALUTE_UPSERT && sv.includes(SALUTE_UPSERT) && sv.includes('const day = new Date(ora).toISOString().slice(0, 10);') && !/dataRoma/.test(sv)
    && sv.includes("const { data, error: pErr } = await retryOnce(() => sb.from('health_log').select('severity, label').eq('day', day).eq('k', 'push_eventi').limit(1));")
    && sv.includes("if (pErr && s.severity !== 'error') return {") && sv.includes('const r = conPrecedente(s, pErr ? null : ((data ?? []) as Riga[])[0] ?? null, ora);')
    && (c.match(/scriviSalute\(sb, /g) ?? []).length === 2 && (run.match(/scriviSalute\(sb, ctx\.ora, /g) ?? []).length === 2
    && run.includes('const delGiro = saluteGiro(esiti, ultimoGiro, ctx.ora, perse24h, attivi.size);') && fine > run.indexOf('for (const nome of attivi.keys()) if (!EVENTI[nome])')
    && fine > run.indexOf('const perse24h = await contaPerse24h(sb, ctx);') && fine < run.indexOf("console.log(JSON.stringify({ fn: 'push-eventi'")
    && run.includes("esiti[nome] = { errore: errTesto(e), causa: causaDi(e) };") && !/errTesto|\.errore\}/.test(cut(s, 'pe-salute') ?? 'errTesto');
};
// RF-1 (18-10): la riga cs_sync si rilegge dopo 3 s solo se la prima dice "ferma", e decide la seconda
const pezzo = (s, da, a) => { const i = s.indexOf(da); if (i < 0) return ''; const j = s.indexOf(a, i + da.length); return j < 0 ? '' : s.slice(i, j); };
const rilettura = (s) => {
  const f = codice(pezzo(s, '  sistema_cs_sync_fermo: {', '  cs_urgente: {'));
  const l1 = f.indexOf('let riga = await leggi();'), g = f.indexOf("if (candCsSync(riga, ctx.ora, minuti).some((c) => c.rif.tipo === 'fermo')) {");
  const z = f.indexOf('await sleep(RILETTURA_CS_SYNC_MS);'), l2 = f.indexOf('riga = await leggi();', z);
  return (f.match(/sb\.from\('health_log'\)/g) ?? []).length === 1 && l1 > 0 && g > l1 && z > g && l2 > z && f.indexOf('return candCsSync(riga, ctx.ora, minuti);') > l2
    && SRC.includes('const RILETTURA_CS_SYNC_MS = 3000;');
};

t('74 PIN prima di ogni azione: app_config letta con retryOnce ed error (503), confronto a tempo costante dello sha256 (401), poi l\'azione; nessuna altra lettura prima', pinPrima(SRC));
t('75 anteprima: 403 senza la chiave di servizio (il PIN dell\'app e\' pubblico), PRIMA dei flag e dell\'anteprima', anteprimaProtetta(SRC));
t('76 run: flag letti in whitelist con error (503); NO-OP a push_eventi_enabled o push_enabled spenti, PRIMA di leggere gli eventi', noopAFlagSpento(SRC));
t('77 run: legge SOLO gli eventi con attivo = true (.eq e filtro), e giroEvento parte solo da li\'', soloAttivi(SRC));
t('78 invio solo con inviaPush (una chiamata, col chi del messaggio); mai consegnaAvviso, canaleEffettivo, ntfy o fetch diretti', soloInviaPush(SRC));
const sl = lettureSenzaLimite(SRC), se = lettureSenzaError(SRC), nr = lettureNonRitentate(SRC), sr = scrittureRitentate(SRC), sf = scrittureFuoriModulo(SRC);
t('79 ogni lettura ha .limit() oppure e\' un conteggio head:true (Regola 20b)', sl.length === 0 && righeSb(SRC).length >= 25, sl[0] ?? righeSb(SRC).length);
t('80 ogni chiamata sb.from destruttura error (o passa da conta, che lo controlla)', se.length === 0 && /if \(error \|\| count == null\) throw new LetturaFallita\(/.test(SRC), se[0]);
t('81 ogni lettura passa da retryOnce', nr.length === 0, nr[0]);
t('82 nessun retryOnce attorno a insert/update/upsert/delete (Regola 20d)', sr.length === 0, sr[0]);
t('83 scrive SOLO push_eventi_inviati, push_eventi e la SUA riga di salute in health_log (K1, Regola 19: telemetria propria), core in sola lettura',
  sf.length === 0 && righeSb(SRC).filter((l) => SCRITTURA.test(l)).length === 6 && righeSb(SRC).filter((l) => SCRITTURA.test(l) && l.includes("sb.from('health_log')")).length === 1, sf[0]);
const sp = selectFuoriElenco(SRC);
t('84 F5: ogni colonna letta sta nell\'elenco ammesso della sua tabella (mai oggetto, snippet, riassunto, corpo, raw, label di cs_sync, *; nome ed email della cliente solo dove dice N13)', sp.length === 0, sp);
const lc = lettureCliente(SRC);
t('N13 (19-10) nome ed email della cliente: letti SOLO nella select delle conversazioni (customer_name, customer_email) e in quella delle spedizioni (customer_name), usati SOLO da nomeCliente',
  lc.length === 0, lc);
t('85 anteprima: solo letture (nessuna scrittura, nessun giro, nessun inviaPush), tutti gli eventi accesi o no', anteprimaSoloLettura(SRC));
t('86 registro: prenotazione su UNIQUE (evento, chiave) con ignoreDuplicates, ripresa con confronto su stato e tentativi, esito sul proprio tentativo; nessun insert nudo', registroScritture(SRC));
t('87 giroEvento: registro sulle chiavi dei candidati, piano, composizione SOLO per nuovo/ritenta, giro, poi ultimo_giro_at (e baseline_at)', giroComposto(SRC));
t('88 ogni flags.X consumato sta nella whitelist della lettura', flagsOrfani(SRC).length === 0, flagsOrfani(SRC));
t('89 risposta e log del run: conteggi ed errori per evento e la salute, mai titoli o testi', rispostaRunSoloConteggi(SRC));
t('89b K1/RF-2/B6/MIG-B1: una sola upsert di health_log (k push_eventi, giorno UTC, onConflict day,k, mai ritentata) in scriviSalute, dopo il giro, con la gravita\' del giorno', saluteScritta(SRC));
t('89c RF-1: cs_sync riletta dopo 3 s solo se la prima lettura dice ferma, e decide la seconda', rilettura(SRC));
{
  const impuri = BLOCCHI.filter((b) => /Deno\.|\bimport\b|\bsb\.|fetch\(|createClient|console\.|inviaPush/.test(codice(cut(SRC, b))));
  t('90 blocchi PURE senza Deno, import, client, rete, log o invio', impuri.length === 0, impuri);
  const ordine = (SRC.match(/const ORDINE = (\[[^\]]+\])/) ?? [])[1] ?? '';
  const eventi = [...(SRC.slice(SRC.indexOf('const EVENTI: Record<string, DefEvento> = {'), SRC.indexOf('const ORDINE = ')).matchAll(/^ {2}(\w+): \{$/gm))].map((m) => m[1]);
  t('91 i sette eventi del contratto (attivita_team dal 21-10, prima del riepilogo), in ORDINE (sistema e urgente prima, riepilogo ultimo) e in EVENTI', ordine === "['sistema_cs_sync_fermo', 'cs_urgente', 'spedizione_eccezione', 'b2b_risposta_negozio', 'cs_cliente_ha_riscritto', 'attivita_team', 'riepilogo']"
    && eventi.slice().sort().join() === Object.keys(TEMA_EVENTO).sort().join(), { ordine, eventi });
  const run92 = corpoRun(SRC);
  t('92 tetto e tempo: budget di TETTO_INVII per giro, nessun invio nuovo dopo 15 s e nessun evento cominciato dopo 30 s (RF-5, timeout del cron 60 s); finestra 24 ore, limite 50',
    run92.includes('const budget: Budget = { invii: TETTO_INVII, scade: inizio + SCADENZA_INVII_MS };') && SRC.includes('const SCADENZA_INVII_MS = 15000;') && SRC.includes('const TEMPO_EVENTI_MS = 30000;')
    && run92.indexOf("if (adesso() - inizio > TEMPO_EVENTI_MS) { esiti[nome] = { rimandato: 'tempo' }; continue; }") > run92.indexOf('if (!ev) continue;')
    && run92.indexOf("if (adesso() - inizio > TEMPO_EVENTI_MS)") < run92.indexOf('await giroEvento(') && SRC.includes('const FINESTRA_MS = 24 * 3600000;') && SRC.includes('const LIMITE = 50;')
    && (SRC.match(/soglia\(ev\.soglie, 'eta_max_ore', 6, 1, 48\)/g) ?? []).length === 2);
  t('93 config.toml: verify_jwt = false per push-eventi', /\n\[functions\.push-eventi\]\nverify_jwt = false\n/.test(CONFIG + '\n'));
  t('94 lettura di cs_sync senza label; cs_events con il solo campo del dettaglio che serve; v_spedizioni_eccezioni con customer_name (19-10) e senza le altre colonne',
    SRC.includes(".from('health_log').select('severity, created_at').eq('k', 'cs_sync')") && SRC.includes("urgente:dettaglio->>urgente") && SRC.includes("a:dettaglio->>a")
    && !/select\('[^']*\bdettaglio\b(?!->>)/.test(SRC) && SRC.includes(".from('v_spedizioni_eccezioni').select('ldv, order_name, stato_tws, updated_at, classe, customer_name')"));
  const nessunEm = !SRC.includes(EM_DASH) && !PUSH_API.includes(EM_DASH);
  t('95 nessun em dash nei sorgenti nuovi', nessunEm);
}

// Contratto fra le parti scritte in parallelo (integrazione del 18-10): la migrazione non si puo' eseguire offline e un
// nome diverso fra SQL, edge, push-api e web non lo vede nessun'altra suite. La prima stesura della 0166 aveva un CHECK
// sul nome evento senza cifre: b2b_risposta_negozio sarebbe stato rifiutato e la migrazione intera annullata all'apply.
console.log('\n== contratto con la migrazione 0166, push-api e il web ==');
const MIGR = read('supabase/migrations/0166_push_eventi.sql');
const MIGR_0168 = read('supabase/migrations/0168_push_attivita.sql');
const MIGR_0138 = read('supabase/migrations/0138_loyalty_orders_cron.sql');
const RLS = read('tests/push_eventi_rls.sql');
const WEB_PUSH = read('web/src/lib/push.ts');
const WEB_APP = read('web/src/App.tsx');
const WEB_PEOPLE = read('web/src/lib/people.tsx');
const tra = (s, da, a) => { const i = s.indexOf(da); if (i < 0) return ''; const j = s.indexOf(a, i + da.length); return j < 0 ? '' : s.slice(i + da.length, j); };
const listaSql = (s) => [...String(s ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1]);
const TEMI_ATTESI = { negozi: ['Ale', 'Bene'], assistenza: ['Ginevra'], spedizioni: ['Ginevra'], sistema: ['Ale'], riepilogo: ['Ale', 'Bene', 'Ginevra'] };
// il pattern del CHECK e' una classe di caratteri semplice, che si legge uguale in POSIX (Postgres) e in JS
const eventiFuoriCheck = (m) => {
  const re = (m.match(/constraint push_eventi_evento_ck check \(evento ~ '([^']+)'\)/) ?? [])[1];
  return re ? Object.keys(TEMA_EVENTO).filter((e) => !new RegExp(re).test(e)) : ['CHECK non trovato'];
};
const eventiMigr = (m) => Object.fromEntries([...tra(m, 'insert into push_eventi (evento, tema, attivo, descrizione) values', 'on conflict (evento) do nothing')
  .matchAll(/\('([^']+)',\s*'([^']+)',\s*false,/g)].map((x) => [x[1], x[2]]));
const temiMigr = (m) => Object.fromEntries([...tra(m, 'insert into push_temi (key, etichetta, descrizione, ordine, predefinito_per) values', 'on conflict (key) do nothing')
  .matchAll(/\('([^']+)',\s*'(?:[^']|'')*',\s*'(?:[^']|'')*',\s*\d+,\s*array\[([^\]]*)\]\)/g)].map((x) => [x[1], listaSql(x[2])]));
const colonne = (m, tab) => tra(m, `create table if not exists ${tab} (\n`, '\n);').split('\n').map((l) => (l.match(/^\s+([a-z_]+)\s/) ?? [])[1]).filter((c) => c && c !== 'constraint');
const colSelect = (s, tab) => [...codice(s).matchAll(new RegExp(`\\.from\\('${tab}'\\)\\.select\\('([^']*)'`, 'g'))].flatMap((x) => x[1].split(',').map((c) => c.trim()));
const cronDi = (m) => {
  const x = m.match(/cron\.schedule\('push-eventi', '([^']+)',[\s\S]*?url := '([^']+)',[\s\S]*?body := '([^']+)'::jsonb,\s*timeout_milliseconds := (\d+)/);
  if (!x) return null;
  let body = null; try { body = JSON.parse(x[3]); } catch { /* corpo illeggibile = null */ }
  return { schedule: x[1], url: x[2], body, timeout: Number(x[4]) };
};
const PIN_CRON_0138 = (() => { try { return JSON.parse((MIGR_0138.match(/body := '([^']+)'::jsonb/) ?? [])[1]).pin; } catch { return undefined; } })();
const SCADENZA = Number((SRC.match(/const SCADENZA_INVII_MS = (\d+);/) ?? [])[1]);
const TIMEOUT_PUSH = Number((SHARED.match(/export const TIMEOUT_PUSH_MS = (\d+);/) ?? [])[1]);
const cronCoerente = (m) => {
  const c = cronDi(m);
  if (!c || !c.body) return false;
  const minuti = c.schedule.split(' ')[0].split(',').map(Number);
  return c.url === 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/push-eventi' && c.body.action === 'run' && SRC.includes("if (action !== 'run' && action !== 'anteprima')")
    && typeof c.body.pin === 'string' && c.body.pin !== '' && c.body.pin === PIN_CRON_0138 && c.schedule.endsWith(' * * * *') && minuti.length === 12
    && minuti.every((v, i) => Number.isInteger(v) && v >= 0 && v < 60 && (i === 0 || v - minuti[i - 1] === 5))
    && Number.isFinite(SCADENZA) && Number.isFinite(TIMEOUT_PUSH) && c.timeout >= SCADENZA + TIMEOUT_PUSH;
};
const temiCoerenti = (m) => {
  const temi = temiMigr(m);
  // 21-10: il tema attivita nasce nella 0168; i temi delle due migrazioni insieme coprono quelli degli eventi
  const tutti = { ...temi, ...temiMigr(MIGR_0168) };
  const chiCheck = listaSql((m.match(/check \(predefinito_per <@ array\[([^\]]*)\]::text\[\]\)/) ?? [])[1]);
  const people = listaSql((WEB_PEOPLE.match(/export const PEOPLE = \[([^\]]*)\]/) ?? [])[1]);
  const temaApi = new RegExp((PUSH_API.match(/const TEMA_RE = \/(.+)\/;/) ?? [])[1] ?? '^$');
  return isDeepStrictEqual(temi, TEMI_ATTESI) && isDeepStrictEqual(chiCheck, CHI_PERSONE) && isDeepStrictEqual(people, CHI_PERSONE)
    && Object.values(TEMA_EVENTO).every((k) => k in tutti) && Object.keys(tutti).every((k) => temaApi.test(k) && temaDi(k, 'x') === k)
    && /update push_temi set predefinito_per = array\['Ale'\]\n where key in \('conti', 'vendite'\)/.test(m);
};
{
  const fuori = eventiFuoriCheck(MIGR);
  t('96 ogni evento della edge passa il CHECK push_eventi_evento_ck della 0166 (b2b_risposta_negozio ha una cifra)', fuori.length === 0, fuori);
  // 21-10: il settimo (attivita_team) nasce nella 0168; le due migrazioni insieme sono il contratto con la edge
  const em = { ...eventiMigr(MIGR), ...eventiMigr(MIGR_0168) };
  const rls = Object.fromEntries([...tra(RLS, 'join (values', ') x(ev, tema)').matchAll(/\('([^']+)', '([^']+)'\)/g)].map((x) => [x[1], x[2]]));
  t('97 i sei eventi della 0166 piu\' attivita_team della 0168 (e la prova D di push_eventi_rls.sql) sono quelli della edge, ognuno sul suo tema',
    Object.keys(eventiMigr(MIGR)).length === 6 && isDeepStrictEqual(eventiMigr(MIGR_0168), { attivita_team: 'attivita' }) && isDeepStrictEqual(em, TEMA_EVENTO) && isDeepStrictEqual(rls, TEMA_EVENTO)
    && RLS.includes("if n <> 7 then raise exception 'KO D:"), { em, rls });
  t('98 temi nuovi e predefinito_per come il contratto; le tre chiavi = CHECK della 0166 = PEOPLE del web = CHI_PERSONE; chiavi valide per push-api; conti e vendite ad Ale',
    temiCoerenti(MIGR), temiMigr(MIGR));
  const stati = listaSql((MIGR.match(/push_eventi_inviati_stato_ck check \(stato in \(([^)]*)\)\)/) ?? [])[1]);
  const scritti = [...new Set([...[...codice(SRC).matchAll(/stato: '([a-z_]+)'/g)].map((x) => x[1]),
    ...[{ ok: true }, { ok: false, status: 200, destinatari: 0 }, null].map(statoDaEsito)])];
  t('99 ogni stato che la edge scrive e\' ammesso dal CHECK della 0166', scritti.length === 5 && scritti.every((s) => stati.includes(s)), { scritti, stati });
  const uk = ((MIGR.match(/constraint push_eventi_inviati_uk unique \(([^)]*)\)/) ?? [])[1] ?? '').replace(/\s/g, '');
  const conflitti = [...codice(SRC).matchAll(/sb\.from\('push_eventi_inviati'\)[^\n]*?onConflict: '([^']+)'/g)].map((x) => x[1]);
  t('100 onConflict delle due scritture del registro = colonne del vincolo UNIQUE push_eventi_inviati_uk', uk === 'evento,chiave' && conflitti.length === 2 && conflitti.every((c) => c === uk), { uk, conflitti });
  const ce = colonne(MIGR, 'push_eventi'), ci = colonne(MIGR, 'push_eventi_inviati');
  const mancanti = [...colSelect(SRC, 'push_eventi').filter((c) => !ce.includes(c)), ...colSelect(SRC, 'push_eventi_inviati').filter((c) => !ci.includes(c)),
    ...['ultimo_giro_at', 'baseline_at'].filter((c) => !ce.includes(c)), ...['evento', 'chiave', 'stato', 'tentativi', 'esito', 'updated_at'].filter((c) => !ci.includes(c))];
  t('101 colonne lette e scritte dalla edge = colonne create dalla 0166', isDeepStrictEqual(ce, ['evento', 'tema', 'attivo', 'descrizione', 'soglie', 'baseline_at', 'ultimo_giro_at'])
    && isDeepStrictEqual(ci, ['id', 'evento', 'chiave', 'stato', 'tentativi', 'esito', 'created_at', 'updated_at']) && colSelect(SRC, 'push_eventi').length >= 6 && mancanti.length === 0, { ce, ci, mancanti });
  t('102 cron: URL di push-eventi, action run (accettata dalla edge), PIN dei cron come la 0138, ogni 5 minuti, timeout >= 15 s di invii + 40 s di inviaPush',
    cronCoerente(MIGR), cronDi(MIGR));
  const tabWeb = listaSql((WEB_PUSH.match(/for \(const t of \[([^\]]*)\] as const\)/) ?? [])[1]);
  const hashApp = [...WEB_APP.matchAll(/hash\.startsWith\('#([a-z]+)'\) \? '([a-z]+)'/g)].filter((x) => x[1] === x[2]).map((x) => x[1]);
  const link = [LINK_ASSISTENZA, LINK_SALUTE, linkNegozio(U1)].map((u) => u.slice(APP_URL.length).replace(/^#/, '').split('/')[0]);
  t('103 i link delle notifiche (#assistenza, #salute, #negozi/...) aprono una scheda sia all\'avvio (App.tsx) sia ad app aperta (tabDaHash)',
    isDeepStrictEqual(link, ['assistenza', 'salute', 'negozi']) && link.every((h) => tabWeb.includes(h) && hashApp.includes(h)), { link, tabWeb, hashApp });
  // sostituzione con una funzione: nel testo piantato "$'" verrebbe letto come "il resto della stringa"
  const pianta = (s, da, a) => { const x = s.replace(da, () => a); if (x === s) { console.log('  KO  autocontrollo: frammento non trovato: ' + da.slice(0, 80)); ko++; } return x; };
  t('A19 il CHECK della prima stesura ([a-z_] senza cifre) -> visto', isDeepStrictEqual(eventiFuoriCheck(pianta(MIGR, "'^[a-z][a-z0-9_]{1,47}$'", "'^[a-z_]{2,48}$'")), ['b2b_risposta_negozio']));
  t('A20 un tema predefinito per un nome mostrato, o conti e vendite non toccati -> visto', [pianta(MIGR, "30, array['Ale', 'Bene']", "30, array['Ale', 'Benny']"),
    pianta(MIGR, "update push_temi set predefinito_per = array['Ale']\n", "update push_temi set predefinito_per = array['Ale', 'Bene']\n")].every((m) => !temiCoerenti(m)));
  t('A21 cron con action diversa, senza PIN o col timeout di default -> visto', [pianta(MIGR, '{"action":"run","pin":"x","source":"cron"}', '{"action":"cron","pin":"x","source":"cron"}'),
    pianta(MIGR, '{"action":"run","pin":"x","source":"cron"}', '{"action":"run","source":"cron"}'), pianta(MIGR, 'timeout_milliseconds := 60000\n', 'timeout_milliseconds := 5000\n')]
    .every((m) => !cronCoerente(m)));

  // MIG-C2 (Gate 3 del 18-10): nella prova annullata prima dell'apply ogni `do $$` diventa un blocco annidato di UN solo
  // DO; un `return` dentro uscirebbe da quello, saltando il resto e l'eccezione TEST_OK: la prova diventerebbe un apply
  const corpiDo = (m) => [...m.matchAll(/^do \$\$([\s\S]*?)^end \$\$;/gm)].map((x) => x[1].replace(/--[^\n]*/g, ''));
  const returnNeiDo = (m) => corpiDo(m).filter((c) => /\breturn\b/i.test(c));
  t('104 MIG-C2: nessun `return` nei blocchi DO della 0166', corpiDo(MIGR).length === 7 && returnNeiDo(MIGR).length === 0, returnNeiDo(MIGR));
  t('A24 il return del passo 8 della prima stesura -> visto', returnNeiDo(pianta(MIGR, '  if v_nati is not null then\n', '  if v_nati is null then return; end if;\n  if true then\n')).length === 1);
  // MIG-B1 (Gate 3 del 18-10): la salute del giro che si vede anche a edge ferma, del modulo e a modulo spento muta
  const minutiCron = (m, nome) => (m.match(new RegExp(`cron\\.schedule\\('${nome}', '([^ ']+) \\* \\* \\* \\*'`)) ?? [])[1]?.split(',').map(Number) ?? [];
  const saluteSql = (m) => {
    const fn = tra(m, 'create or replace function public.push_eventi_salute() returns void', '$fn$;');
    const giro = minutiCron(m, 'push-eventi'), salute = minutiCron(m, 'push-eventi-salute');
    return fn.includes("language plpgsql security definer set search_path to 'public' as $fn$")
      && fn.includes("if exists (select 1 from app_flags where key = 'push_eventi_enabled' and lower(btrim(value, E' \\t\\r\\n')) = 'true')")
      && fn.includes("and exists (select 1 from app_flags where key = 'push_enabled' and lower(btrim(value, E' \\t\\r\\n')) = 'true') then")
      && fn.includes("values (current_date, 'push_eventi_fresh',") && fn.includes('on conflict (day, k) do update set label = excluded.label, n = excluded.n, severity = excluded.severity, created_at = excluded.created_at;')
      && fn.includes("e.ultimo_giro_at < now() - interval '30 minutes'") && fn.includes("case when v_fermi is not null then 'error' when v_mai is not null then 'warn' else 'ok' end")
      && !/\bdelete\b|\bupdate\s+(?!set)/i.test(fn.replace(/do update set/g, ''))
      && m.includes('revoke all on function public.push_eventi_salute() from public, anon, authenticated;') && m.includes('grant execute on function public.push_eventi_salute() to service_role;')
      && m.includes("select cron.schedule('push-eventi-salute', '3,33 * * * *', $cmd$ select public.push_eventi_salute() $cmd$);")
      && salute.length === 2 && salute.every((x) => !giro.includes(x)) && m.includes("c_schedule_salute constant text := '3,33 * * * *';")
      && m.includes("if has_function_privilege(r, 'public.push_eventi_salute()', 'execute') then")
      && RLS.includes("'select public.push_eventi_salute()'") && RLS.includes('KO F: a modulo spento push_eventi_salute() ha scritto health_log');
  };
  t('105 MIG-B1: push_eventi_salute() del modulo (security definer, solo service_role, NO-OP a modulo spento, upsert push_eventi_fresh), cron alle :03 e :33 fuori dai minuti del giro, provata in push_eventi_rls.sql',
    saluteSql(MIGR));
  t('A25 salute che scrive a modulo spento, eseguibile da anon, sul minuto del giro o senza prova F -> visto', [
    pianta(MIGR, "  if exists (select 1 from app_flags where key = 'push_eventi_enabled' and lower(btrim(value, E' \\t\\r\\n')) = 'true')\n", '  if true\n'),
    pianta(MIGR, 'revoke all on function public.push_eventi_salute() from public, anon, authenticated;', 'revoke all on function public.push_eventi_salute() from public;'),
    pianta(MIGR, "select cron.schedule('push-eventi-salute', '3,33 * * * *',", "select cron.schedule('push-eventi-salute', '1,31 * * * *',"),
  ].every((m) => !saluteSql(m)));

  // 21-10: la 0168 (tema attivita, evento attivita_team, il tema sul telefono di Ale), contratto con la edge e push-api
  const temaAtt = (m) => (m.match(/insert into push_temi \(key, etichetta, descrizione, ordine, predefinito_per\) values\n {4}\('attivita', '((?:[^']|'')*)', '((?:[^']|'')*)', (\d+), array\[([^\]]*)\]\)\n {2}on conflict \(key\) do nothing;/) ?? []).slice(1);
  const contrattoAtt = (m) => {
    const [etichetta, descrizione, ordine, persone] = temaAtt(m);
    const temaApi = new RegExp((PUSH_API.match(/const TEMA_RE = \/(.+)\/;/) ?? [])[1] ?? '^$');
    return etichetta === 'Attivit' + String.fromCodePoint(0xe0) + ' del team' && descrizione === 'Quando Benny o Ginni registrano ordini, arrivi o conte' && ordine === '80'
      && isDeepStrictEqual(listaSql(persone), ['Ale']) && temaApi.test('attivita') && TEMA_EVENTO.attivita_team === 'attivita'
      && isDeepStrictEqual(eventiMigr(m), { attivita_team: 'attivita' }) && Object.keys(temiMigr(m)).join() === 'attivita'
      && !/\\u00e0|\\xe0|&agrave;/i.test(m) && !/\b(insert into|update|delete from) app_flags\b/i.test(m) && !/create table|cron\.schedule|alter table/i.test(m)
      && m.startsWith('-- 0168_push_attivita.sql') && /\nbegin;\n/.test(m) && m.trimEnd().endsWith('commit;');
  };
  t('M1 0168: tema attivita "Attività del team" (a accentata vera nel file, non un escape), descrizione e ordine 80, predefinito per la sola Ale; evento attivita_team spento sul tema attivita; nessun flag, tabella o cron toccati',
    contrattoAtt(MIGR_0168), temaAtt(MIGR_0168));
  // Gate 2 del 21-10 (R3): il passo 3 si confronta INTERO, non a pezzi (un `or s.chi = 'Bene'` aggiunto o il prima preso
  // dal dopo lasciavano tutti i pezzi al loro posto), e cosi' la riga del passo 1 che decide se il tema e' nato qui
  const PASSO3 = [
    "  if current_setting('amimi.push_attivita_tema_nato_qui', true) = 'true' then",
    '    with prima as (',
    '      select s.id, s.temi from push_subscriptions s',
    "       where exists (select 1 from push_temi t where t.key = 'attivita' and s.chi = any(t.predefinito_per))",
    "         and not ('attivita' = any(s.temi))",
    '       for update),',
    '    agg as (',
    '      update push_subscriptions s',
    "         set temi = s.temi || array['attivita'],",
    '             updated_at = now()',
    '        from prima p',
    '       where s.id = p.id',
    '      returning s.id, p.temi as temi_prima, s.temi as temi_dopo),',
    '    ins as (',
    '      insert into change_log (tbl, row_id, op, before, after, chi, source)',
    "      select 'push_subscriptions', id::text, 'temi_aggiunti', jsonb_build_object('temi', temi_prima),",
    "             jsonb_build_object('temi', temi_dopo, 'migr', '0168_push_attivita'), 'claude-code', 'push-eventi'",
    '        from agg',
    '      returning 1)',
    '    select (select count(*) from push_subscriptions s',
    "             where exists (select 1 from push_temi t where t.key = 'attivita' and t.predefinito_per @> array[s.chi])",
    "               and not (s.temi @> array['attivita'])),",
    '           (select count(*) from agg), (select count(*) from ins)',
    '      into v_attesi, v_aggiornati, v_log;',
    '  end if;',
    "  perform set_config('amimi.push_attivita_telefoni_attesi', v_attesi::text, true);",
    "  perform set_config('amimi.push_attivita_telefoni_aggiornati', v_aggiornati::text, true);",
    "  perform set_config('amimi.push_attivita_righe_log', v_log::text, true);",
    'end $$;',
  ].join('\n');
  const telefoni = (m) => {
    const p3 = tra(m, '-- 3)', '-- 4)');
    const corpo = p3.slice(p3.indexOf('\nbegin\n') + 7, p3.lastIndexOf('end $$;') + 7);
    return corpo === PASSO3 && (p3.match(/\bupdate \w+/gi) ?? []).join() === 'update push_subscriptions';
  };
  t('M2 0168: il tema si aggiunge ai telefoni del profilo (Ale) SOLO se e\' nato qui, in fondo e senza doppioni, con una riga di change_log per telefono (prima e dopo dei soli temi); passo 3 confrontato intero (Gate 2, R3)',
    telefoni(MIGR_0168), tra(MIGR_0168, '-- 3)', '-- 4)').slice(-900));
  const nascita = (m) => {
    const p1 = tra(m, '-- 1)', '-- 2)'), p2 = tra(m, '-- 2)', '-- 3)');
    return p1.includes("\n  perform set_config('amimi.push_attivita_tema_nato_qui', found::text, true);\nend $$;")
      && p2.includes("\n  perform set_config('amimi.push_attivita_evento_nato_qui', found::text, true);\nend $$;")
      && p1.includes('insert into push_temi (') && !p1.includes('push_eventi') && p2.includes('insert into push_eventi (') && !p2.includes('push_temi')
      && m.indexOf('insert into push_temi (') < m.indexOf('insert into push_eventi (');
  };
  t('M4 0168 (Gate 2, R3): "nato qui" viene da found subito dopo ogni insert; il tema nasce PRIMA dell\'evento che lo cita (chiave esterna)', nascita(MIGR_0168));
  const prova0168 = (m) => {
    const p4 = tra(m, '-- 4)', '\ncommit;');
    return ["raise exception '0168: manca il tema attivita';", "raise exception '0168: manca l''evento attivita_team sul tema attivita';",
      "and attivo = false and soglie = '{}'::jsonb", "raise exception '0168: un telefono del profilo non ha ricevuto il tema attivita';",
      "raise exception '0168: un telefono iscritto ha un tema doppio';", "raise exception '0168: push_enabled o push_eventi_enabled cambiati dalla migrazione';",
      "and etichetta = 'Attivit" + String.fromCodePoint(0xe0) + " del team'",
      // Gate 2 del 21-10 (R2): i tre conteggi del passo 3 devono coincidere, nessun telefono fuori dal profilo, dopo = prima + attivita
      "or v_attesi < 0 or v_aggiornati < 0 or v_log < 0 then", "if v_tema_nato and (v_aggiornati <> v_attesi or v_log <> v_aggiornati) then",
      "raise exception '0168: un telefono fuori dal profilo ha il tema attivita';",
      "and (after->'temi') is distinct from ((before->'temi') || '[\"attivita\"]'::jsonb)) then"].every((x) => p4.includes(x))
      && !/v_log\s*<\s*v_aggiornati/.test(p4);
  };
  t('M3 0168: prova finale nella stessa transazione (tema, evento spento, telefoni dentro e fuori dal profilo, conteggi che coincidono, change_log, doppioni, interruttori invariati); 5 blocchi DO e nessun `return` (MIG-C2)',
    prova0168(MIGR_0168) && corpiDo(MIGR_0168).length === 5 && returnNeiDo(MIGR_0168).length === 0, returnNeiDo(MIGR_0168));
  const scambiati = (() => {
    const b1 = '-- 1)' + tra(MIGR_0168, '-- 1)', '-- 2)'), b2 = '-- 2)' + tra(MIGR_0168, '-- 2)', '-- 3)');
    return MIGR_0168.replace(b1 + b2, b2 + b1);
  })();
  const passi = (m) => contrattoAtt(m) && telefoni(m) && nascita(m) && prova0168(m) && returnNeiDo(m).length === 0;
  t('AM1 0168 col tema per Bene, l\'evento acceso, la a senza accento, un flag toccato, un return, il tema aggiunto anche a un re-run, il prima preso dal dopo, un telefono di Bene nel passo 3, l\'evento prima del tema o una prova finale indebolita -> visto', [
    pianta(MIGR_0168, "80, array['Ale'])", "80, array['Ale', 'Bene'])"), pianta(MIGR_0168, "('attivita_team', 'attivita', false,", "('attivita_team', 'attivita', true,"),
    pianta(MIGR_0168, "('attivita', 'Attivit" + String.fromCodePoint(0xe0) + " del team',", "('attivita', 'Attivita'' del team',"),
    pianta(MIGR_0168, '\ncommit;', "\nupdate app_flags set value = 'true' where key = 'push_eventi_enabled';\ncommit;"),
  ].every((m) => !contrattoAtt(m)) && returnNeiDo(pianta(MIGR_0168, "  if current_setting('amimi.push_attivita_tema_nato_qui', true) = 'true' then\n    with prima", "  if v_log > 0 then return; end if;\n  if current_setting('amimi.push_attivita_tema_nato_qui', true) = 'true' then\n    with prima")).length === 1
    && [
      pianta(MIGR_0168, "  if current_setting('amimi.push_attivita_tema_nato_qui', true) = 'true' then\n    with prima", '  if true then\n    with prima'),
      // MIG1: il prima della riga di change_log preso dal dopo
      pianta(MIGR_0168, "'temi_aggiunti', jsonb_build_object('temi', temi_prima),", "'temi_aggiunti', jsonb_build_object('temi', temi_dopo),"),
      // MIG2: anche il telefono di Bene nel passo 3
      pianta(MIGR_0168, "         and not ('attivita' = any(s.temi))\n       for update),", "            or s.chi = 'Bene'\n         and not ('attivita' = any(s.temi))\n       for update),"),
      // MIG3: "nato qui" sempre vero, un re-run rimetterebbe il tema tolto
      pianta(MIGR_0168, "perform set_config('amimi.push_attivita_tema_nato_qui', found::text, true);", "perform set_config('amimi.push_attivita_tema_nato_qui', 'true', true);"),
      // l'evento prima del tema: all'apply la chiave esterna (23503), nella prova annullata o qui
      scambiati,
      // R2: la prova finale torna al confronto che non poteva fallire, o perde il controllo dei telefoni fuori profilo
      pianta(MIGR_0168, 'if v_tema_nato and (v_aggiornati <> v_attesi or v_log <> v_aggiornati) then', 'if v_tema_nato and v_log < v_aggiornati then'),
      pianta(MIGR_0168, "raise exception '0168: un telefono fuori dal profilo ha il tema attivita';", 'null;'),
      // il conteggio dei telefoni attesi preso dagli aggiornati
      pianta(MIGR_0168, "    select (select count(*) from push_subscriptions s\n             where exists (select 1 from push_temi t where t.key = 'attivita' and t.predefinito_per @> array[s.chi])\n               and not (s.temi @> array['attivita'])),", '    select (select count(*) from agg),'),
    ].every((m) => m !== MIGR_0168 && !passi(m)) && passi(MIGR_0168) && scambiati !== MIGR_0168);
}

console.log('\n== autocontrollo dei rilevatori ==');
{
  const pianta = (da, a) => { const s = SRC.replace(da, a); if (s === SRC) { console.log('  KO  autocontrollo: frammento non trovato: ' + da.slice(0, 80)); ko++; } return s; };
  t('A1 PIN controllato dopo l\'azione, o una lettura prima del PIN -> visto', [pianta(PIN_401 + '\n', '').replace("if (action !== 'run' && action !== 'anteprima')", PIN_401 + "\n  if (action !== 'run' && action !== 'anteprima')"),
    pianta(CFG, "const { data: x0, error: e0 } = await retryOnce(() => sb.from('push_eventi').select('evento').limit(1));\n  " + CFG)].every((s) => !pinPrima(s)));
  t('A2 anteprima senza la chiave di servizio -> visto', !anteprimaProtetta(pianta(SERV_403, '')));
  t('A3 NO-OP tolto, o solo su push_eventi_enabled, o dopo la lettura degli eventi -> visto', [pianta(NOOP, ''),
    pianta(NOOP, "if (!flagVero(flags.push_eventi_enabled)) return json({ ok: true, skipped: 'disabled' });"),
    pianta(NOOP + '\n', '').replace(SOLO_ATTIVI, SOLO_ATTIVI + '\n  ' + NOOP)].every((s) => !noopAFlagSpento(s)));
  t('A4 run che legge anche gli eventi spenti -> visto', [pianta(".select('evento, tema, attivo, soglie, baseline_at, ultimo_giro_at').eq('attivo', true).limit(50)", ".select('evento, tema, attivo, soglie, baseline_at, ultimo_giro_at').limit(50)"),
    pianta('.filter((r) => r.attivo === true)', '')].every((s) => !soloAttivi(s)));
  t('A5 consegnaAvviso, ntfy o un fetch diretto -> visto', [pianta("import { inviaPush } from '../_shared/push.ts';", "import { consegnaAvviso, inviaPush } from '../_shared/push.ts';"),
    pianta("invia: (m) => inviaPush(", "invia: (m) => fetch('https://ntfy.sh', {}).then(() => inviaPush("), pianta('...(m.chi ? { chi: m.chi } : {})', '')].every((s) => !soloInviaPush(s)));
  t('A6 lettura senza .limit -> vista', lettureSenzaLimite(pianta(".eq('k', 'cs_sync').order('created_at', { ascending: false }).limit(1)", ".eq('k', 'cs_sync').order('created_at', { ascending: false })")).length === 1);
  t('A7 lettura senza error destrutturato -> vista', lettureSenzaError(pianta("const { data, error } = await retryOnce(() => sb.from('health_log')", "const { data } = await retryOnce(() => sb.from('health_log')")).length === 1);
  t('A8 lettura senza ritentativo -> vista', lettureNonRitentate(pianta("await retryOnce(() => sb.from('lead_accounts').select('id, nome').in('id', ids).limit(ids.length + 1));", "await sb.from('lead_accounts').select('id, nome').in('id', ids).limit(ids.length + 1);")).length === 1);
  t('A9 scrittura ritentata, anche su due righe -> vista', scrittureRitentate(pianta("const { error } = await sb.from('push_eventi').update(", "const { error } = await retryOnce(() => sb.from('push_eventi')\n    .update(")).length === 1);
  t('A10 scrittura su una tabella del core, o un\'altra scrittura di health_log -> vista', [pianta("const fine = new Date().toISOString();", "const fine = new Date().toISOString();\n  const { error: x } = await sb.from('cs_conversations').update({ stato: 'fatto' }).eq('id', ev.evento);"),
    pianta("const fine = new Date().toISOString();", "const fine = new Date().toISOString();\n  const { error: x } = await sb.from('health_log').upsert({ k: 'push_eventi' });")].every((s) => scrittureFuoriModulo(s).length === 1));
  t('A11 select con stato_raw o customer_email delle spedizioni, oggetto o snippet delle conversazioni, label di cs_sync, oggetto, *, raw di shopify_orders (F5), email_generica -> vista', [
    pianta("select('ldv, order_name, stato_tws, updated_at, classe, customer_name')", "select('ldv, order_name, stato_tws, updated_at, classe, customer_name, stato_raw')"),
    pianta("select('ldv, order_name, stato_tws, updated_at, classe, customer_name')", "select('ldv, order_name, stato_tws, updated_at, classe, customer_name, customer_email')"),
    pianta("stato_by, customer_name, customer_email')", "stato_by, customer_name, customer_email, subject')"), pianta("stato_by, customer_name, customer_email')", "stato_by, customer_name, customer_email, snippet')"),
    pianta("select('severity, created_at')", "select('severity, created_at, label')"), pianta("select('id, account_id, direzione, esito, chi, at, created_at')", "select('id, account_id, direzione, esito, chi, at, created_at, subject')"),
    pianta("select('id, canale, categoria, urgente, urgenza_motivo, stato, stato_by, customer_name, customer_email')", "select('*')"), pianta(".from('shopify_orders').select('gross_total')", ".from('shopify_orders').select('gross_total, raw')"),
    pianta("select('id, nome')", "select('id, nome, email_generica')"), pianta("select('row_id, delta:after->>delta, qty:after->>qty')", "select('row_id, d:after')")].every((s) => selectFuoriElenco(s).length >= 1));
  const PART = 'const partirebbe = new Set(piano.filter(';
  t('A12 anteprima che scrive, invia (anche a gruppi, 21-10) o scrive la salute -> visto', [pianta(PART, "await sb.from('push_eventi_inviati').upsert({ evento: nome });\n      " + PART),
    pianta(PART, "await eseguiPiano(piano, msgs, { invii: 1, scade: 0 }, depGiro(sb, nome, tema, Date.now));\n      " + PART),
    pianta(PART, "await eseguiGruppi(piano, (x) => x.chiave, () => null, { invii: 1, scade: 0 }, depGiro(sb, nome, tema, Date.now));\n      " + PART),
    pianta(PART, "await scriviSalute(sb, c.ora, saluteGiro({}, {}, c.ora, 0, 0));\n      " + PART)].every((s) => !anteprimaSoloLettura(s)));
  t('A13 prenotazione senza ignoreDuplicates, ripresa senza confronto, esito senza tentativi -> visto', [pianta("stato: 'prenotato', tentativi: 1, updated_at: ora() }, { onConflict: 'evento,chiave', ignoreDuplicates: true }).select('id');", "stato: 'prenotato', tentativi: 1, updated_at: ora() }, { onConflict: 'evento,chiave' }).select('id');"),
    pianta(".eq('stato', r.stato).eq('tentativi', r.tentativi)", ''), pianta(".eq('id', id).eq('tentativi', tentativi).select('id');", ".eq('id', id).select('id');"),
    pianta('      return !error && (data ?? []).length > 0;\n    },\n    adesso,', '      return !error;\n    },\n    adesso,'),
    pianta('...(definitivo ? { tentativi: MAX_TENTATIVI } : {}) })', '})')].every((s) => !registroScritture(s)));
  t('A14 composizione di tutti i candidati, baseline_at mai scritto, baseline spenta (F3: costante, falsa nella chiamata, riassegnata) o stallo mai contato -> visto', [
    pianta("piano.filter((p) => p.azione === 'nuovo' || p.azione === 'ritenta').map((p) => p.cand);", 'cands;'),
    pianta('seme ? { ultimo_giro_at: fine, baseline_at: fine } : { ultimo_giro_at: fine }', '{ ultimo_giro_at: fine }'),
    pianta(BASELINE_DI, 'const { seme, ripartenza } = baselineDi(ev, ctx.ora); const baseline = false;'),
    pianta('const piano = pianifica(cands, registro, { ora: ctx.ora, baseline, etaMaxMs:', 'const piano = pianifica(cands, registro, { ora: ctx.ora, baseline: false, etaMaxMs:'),
    pianta(BASELINE_DI, BASELINE_DI.replace('const', 'let') + '\n  baseline = false;'),
    pianta("motivoBaseline: ripartenza ? 'stallo' : 'baseline', frescoMs: frescoRipartenzaMs(ev.evento) });\n  const daComporre", "motivoBaseline: 'baseline', frescoMs: frescoRipartenzaMs(ev.evento) });\n  const daComporre"),
    // v4 (31-10): la finestra fresca tolta dal giro (si torna a saltare tutto) o uguale per tutti gli eventi
    pianta(", frescoMs: frescoRipartenzaMs(ev.evento) });\n  const daComporre", " });\n  const daComporre"),
    pianta(", frescoMs: frescoRipartenzaMs(ev.evento) });\n  const daComporre", ", frescoMs: STALLO_MS });\n  const daComporre"),
  ].every((s) => !giroComposto(s)));
  t('A14b v4 anteprima senza la finestra fresca della ripartenza -> vista (direbbe stallo per una push che il run manda)',
    !anteprimaSoloLettura(pianta("motivoBaseline: ripartenza ? 'stallo' : 'baseline', frescoMs: frescoRipartenzaMs(ev.evento) });\n      // a gruppi", "motivoBaseline: ripartenza ? 'stallo' : 'baseline' });\n      // a gruppi")));
  t('A15 flag consumato e non elencato -> visto', flagsOrfani(pianta('flagVero(ctx.flags.lead_outreach_ai_enabled)', 'flagVero(ctx.flags.lead_outreach_nuovo)')).length === 1);
  t('A16 risposta del run con i messaggi -> vista', !rispostaRunSoloConteggi(pianta('salute: salute.severity, ...(salute.errore ? { errore_salute: salute.errore } : {}), durata_ms });', 'salute: salute.severity, durata_ms, msgs: [] });')));
  const UPS = SALUTE_UPSERT;
  t('A22 salute: upsert tolta, ritentata, col giorno di Roma, senza la riga di prima, scritta prima dei controlli degli eventi sconosciuti, run chiamato prima del NO-OP, label con errTesto -> visto', [
    pianta(UPS, 'const error = null;'),
    pianta(UPS, UPS.replace("await sb.from('health_log').upsert(", "await retryOnce(() => sb.from('health_log').upsert(").replace("onConflict: 'day,k' });", "onConflict: 'day,k' }));")),
    pianta('const day = new Date(ora).toISOString().slice(0, 10);', 'const day = dataRoma(ora);'),
    pianta('const r = conPrecedente(s, pErr ? null : ((data ?? []) as Riga[])[0] ?? null, ora);', 'const r = { severity: s.severity, label: s.label, n: s.n };'),
    pianta('  const salute = await scriviSalute(sb, ctx.ora, delGiro);\n', '').replace("  for (const nome of attivi.keys()) if (!EVENTI[nome])", "  const salute = await scriviSalute(sb, ctx.ora, saluteGiro(esiti, {}, ctx.ora, 0, attivi.size));\n  for (const nome of attivi.keys()) if (!EVENTI[nome])"),
    pianta("esiti[nome] = { errore: errTesto(e), causa: causaDi(e) };", "esiti[nome] = { errore: errTesto(e), causa: errTesto(e) };"),
  ].every((s) => !saluteScritta(s)) && !noopAFlagSpento(pianta("if (action === 'anteprima') return await anteprima(sb, ctx, body.forza_riepilogo === true);",
    "if (action === 'anteprima') return await anteprima(sb, ctx, body.forza_riepilogo === true);\n  if (action === 'run') return await eseguiRun(sb, ctx);")));
  t('A23 RF-1: rilettura tolta, senza pausa o decisa sulla prima lettura -> vista', [
    pianta("if (candCsSync(riga, ctx.ora, minuti).some((c) => c.rif.tipo === 'fermo')) {\n        await sleep(RILETTURA_CS_SYNC_MS);\n        riga = await leggi();\n      }", ''),
    pianta('        await sleep(RILETTURA_CS_SYNC_MS);\n', ''),
    pianta('riga = await leggi();\n      }\n      return candCsSync(riga, ctx.ora, minuti);', 'await leggi();\n      }\n      return candCsSync(riga, ctx.ora, minuti);'),
  ].every((s) => !rilettura(s)));
  // prova che i casi di privacy vedono davvero una fuga: un builder che copia l'oggetto nel testo
  const fuga = [{ chiave: 'k', titolo: 'x', testo: 'Oggetto riservato', url: APP_URL }];
  const conNome = [{ chiave: 'k', titolo: CLIENTE + ' ha riscritto', testo: CLIENTE_EMAIL, url: APP_URL }];
  t('A17 il controllo di privacy vede un campo personale nel testo; dal 19-10 il nome e l\'email della cliente li vede solo perdeTutto (b2b, riepilogo, sistema, salute)',
    perde(fuga).length === 1 && perdeTutto(fuga).length === 1 && perde(conNome).length === 0 && perdeTutto(conNome).length === 2);
  // un motivo dell'AI che passasse il filtro: il caso 26 deve diventare rosso
  const motivoLibero = (v) => (typeof v === 'string' ? v : '');
  const ui = { titolo: 'x', testo: [motivoLibero('matrimonio 27-07'), '3 urgenti aperte'].join('. '), url: APP_URL };
  t('A18 un filtro dei motivi che lascia passare il testo dell\'AI viene visto dal controllo di privacy', perde([ui]).length === 1);
  // 19-10: N13 vede nome ed email letti dove non servono (anche dove l'elenco F5 della tabella li ammette) o usati fuori da nomeCliente
  t('AN1 nome o email della cliente in un conteggio, in un\'altra tabella, o una delle due letture cambiata -> vista', [
    pianta(".from('cs_conversations').select('id', { count: 'exact', head: true }).eq('urgente', true)", ".from('cs_conversations').select('id, customer_name', { count: 'exact', head: true }).eq('urgente', true)"),
    pianta(".from('v_spedizioni_eccezioni').select('ldv, stato_tws, classe')", ".from('v_spedizioni_eccezioni').select('ldv, stato_tws, classe, customer_name')"),
    pianta("select('id, nome')", "select('id, nome, customer_name')"),
    pianta("stato_by, customer_name, customer_email')", "stato_by, customer_name')"),
  ].every((s) => lettureCliente(s).length >= 1));
  t('AN2 nome o email della cliente usati fuori da nomeCliente (senza pulizia, email nella spedizione, email nel testo) -> visti', [
    pianta('const cliente = nomeCliente(v.customer_name, v.customer_email);\n    const motivo', 'const cliente = pulisci(v.customer_name, 60);\n    const motivo'),
    pianta('nomeCliente(r.customer_name, null)', 'nomeCliente(r.customer_name, r.customer_email)'),
    pianta("const parti = [cliente ? cat : '', inAttesa", "const parti = [cliente ? cat : '', String(v.customer_email ?? ''), inAttesa"),
  ].every((s) => lettureCliente(s).length >= 1));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
