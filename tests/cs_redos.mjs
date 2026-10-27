// tests/cs_redos.mjs — le regex dell'ingest di cs-sync devono restare LINEARI sui corpi delle email.
// Ritagliate DAL SORGENTE che va in produzione (blocchi PURE:cs-crop e PURE:cs-html). Nessuna rete, nessun DB.
//   node tests/cs_redos.mjs
//
// Perche' esiste. Dalle 12:20 UTC del 26-10-2026 ogni giro di cs-sync e' morto con 546 WORKER_RESOURCE_LIMIT
// ("CPU Time exceeded"), circa 250 di fila, e la posta di info@ non e' entrata in Assistenza per un giorno.
// Il messaggio era la risposta di un fornitore da un helpdesk, con dentro la conferma d'ordine citata: nella
// parte text/plain, dopo "Stato dell'ordine", ~2.100 caratteri di soli spazi, tab e a capo. La regex v15
// `ordine\s*(?:numero|nr\.?|n[°.])?\s*#?\s*(\d{3,6})\b` provava ogni modo di dividere quegli spazi fra tre
// `\s*` (cubico): 7 secondi misurati, contro 2 secondi di CPU concessi alla edge. Il testo qui sotto e' una
// ricostruzione SINTETICA della stessa forma (questo repository e' pubblico, la posta non ci entra).
//
// Ogni caso gira in un worker con un tempo massimo: se una regex torna esponenziale o cubica il test FALLISCE
// invece di restare appeso. La seconda meta' prova che le regex nuove riconoscono ESATTAMENTE gli stessi
// numeri d'ordine delle vecchie, sui casi dove le vecchie finiscono.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const src = readFileSync(`${ROOT}supabase/functions/cs-sync/index.ts`, 'utf8').replace(/\r\n/g, '\n');
const blocco = (nome) => {
  const B = `// ==== PURE:${nome} BEGIN ====`, E = `// ==== PURE:${nome} END ====`;
  const a = src.indexOf(B), b = src.indexOf(E);
  if (a < 0 || b < 0) { console.error(`marcatori PURE:${nome} non trovati in cs-sync`); process.exit(1); }
  return src.slice(a + B.length, b).trim();
};
const TMP = `${ROOT}tests/_redos.tmp.ts`;
writeFileSync(TMP, `${blocco('cs-crop')}\n${blocco('cs-html')}\nexport { extractOrderNumber, stripQuoted, stripQuote, stripHtml, ORDER_PATTERNS };\n`, 'utf8');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 300) : '')); } };

// Un caso = funzione + input, eseguito in un worker che importa il modulo ritagliato. Ritorna i ms o Infinity.
const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
import(workerData.mod).then((M) => {
  const t0 = performance.now();
  const r = M[workerData.fn](...workerData.args);
  parentPort.postMessage({ ms: performance.now() - t0, r: typeof r === 'string' ? r.length : r });
});`;
const MAX_MS = 10000;
const misura = (fn, ...args) => new Promise((res) => {
  const w = new Worker(WORKER, { eval: true, workerData: { mod: pathToFileURL(TMP).href, fn, args } });
  const to = setTimeout(() => { w.terminate(); res({ ms: Infinity, r: null }); }, MAX_MS);
  w.once('message', (m) => { clearTimeout(to); w.terminate(); res(m); });
  w.once('error', (e) => { clearTimeout(to); res({ ms: Infinity, r: 'ERR ' + e.message }); });
});

try {
  const M = await import(pathToFileURL(TMP).href);
  // corsa di spazi della stessa FORMA di quella reale: spazi, tab, CRLF mescolati, nessuna cifra dopo
  const ws = (n) => ('              \t\r\n\t\t\t\r\n\t\t\t\t\r\n    ').repeat(Math.ceil(n / 30)).slice(0, n);
  // Soglia larga apposta: il runner della CI e' lento, e la forma vecchia su questi input impiega secondi o non finisce.
  const SOGLIA = 1500;

  console.log('== il messaggio del 26-10, ricostruito: deve finire in fretta ==');
  const incidente = 'Buongiorno, le etichette partono domani.\r\n\r\nStato dell\'ordine' + ws(2132) + 'Assistenza e chat in linea';
  let m = await misura('extractOrderNumber', incidente);
  t(`1  extractOrderNumber sul messaggio ricostruito (${Math.round(m.ms)} ms, la v15 ne impiegava ~7000)`, m.ms < SOGLIA && m.r === null, m);
  m = await misura('extractOrderNumber', 'Re: Ticket [#1345981] Re: Il tuo ordine #2610140103\n' + incidente);
  t(`2  con l'oggetto vero davanti (numeri di 7 e 10 cifre: nessun ordine) (${Math.round(m.ms)} ms)`, m.ms < SOGLIA && m.r === null, m);

  console.log('\n== al limite di BODY_MAX (20000 caratteri) ==');
  for (const [n, w] of [['3', 'ordine'], ['4', 'order'], ['5', 'ordinazione'], ['6', 'ordine n.'], ['7', 'ordine numero'], ['8', 'n.'], ['9', 'numero'], ['10', 'nr']]) {
    m = await misura('extractOrderNumber', 'testo ' + w + ws(20000) + 'fine');
    t(`${n.padEnd(2)} "${w}" + 20000 spazi senza cifre (${Math.round(m.ms)} ms)`, m.ms < SOGLIA && m.r === null, m);
  }
  m = await misura('extractOrderNumber', ('ordine ' + ws(40)).repeat(400) + 'ordine 1538');
  t(`11 tanti "ordine" seguiti da spazi, poi il numero vero (${Math.round(m.ms)} ms)`, m.ms < SOGLIA && m.r === 1538, m);
  m = await misura('extractOrderNumber', 'ordine' + ws(20000) + '1538');
  t(`12 "ordine", 20000 spazi e poi il numero: si trova ancora (${Math.round(m.ms)} ms)`, m.ms < SOGLIA && m.r === 1538, m);

  console.log('\n== [ \\t]+\\n di stripHtml e stripQuoted: lineare anche su corse lunghe senza a capo ==');
  m = await misura('stripHtml', '<p>x' + ' '.repeat(100000) + 'x</p>');
  t(`13 stripHtml su 100000 spazi di fila (gira sull'HTML intero, prima di BODY_MAX) (${Math.round(m.ms)} ms)`, m.ms < SOGLIA, m);
  m = await misura('stripHtml', ('<td>' + ' '.repeat(60) + '</td>').repeat(3000));
  t(`14 stripHtml su una tabella da newsletter (${Math.round(m.ms)} ms)`, m.ms < SOGLIA, m);
  m = await misura('stripQuoted', 'Ciao' + ' '.repeat(20000) + 'x', 'email_diretta');
  t(`15 stripQuoted su 20000 spazi di fila (${Math.round(m.ms)} ms)`, m.ms < SOGLIA, m);
  m = await misura('stripQuoted', incidente, 'email_diretta');
  t(`16 stripQuoted sul messaggio ricostruito (${Math.round(m.ms)} ms)`, m.ms < SOGLIA, m);

  console.log('\n== stesso risultato di prima dove il prima finiva ==');
  t('17 stripHtml toglie ancora gli spazi a fine riga', M.stripHtml('<p>a   \t\nb</p>') === 'a\nb', M.stripHtml('<p>a   \t\nb</p>'));
  t('18 stripHtml: righe di soli spazi diventano vuote come prima', M.stripHtml('a\n   \n\n\n\nb') === 'a\n\nb', M.stripHtml('a\n   \n\n\n\nb'));
  t('19 stripQuoted: spazi a fine riga tolti come prima', M.stripQuoted('ciao   \nseconda riga \t\nfine', 'email_diretta') === 'ciao\nseconda riga\nfine');

  // Le forme v15, copiate qui come riferimento: cio' che riconoscevano deve restare riconosciuto, e niente di piu'.
  const VECCHIE = [
    /#\s*(\d{3,6})\b/,
    /\b(?:ordine|ordinazione|order)\s*(?:numero|nr\.?|n[°.])?\s*#?\s*(\d{3,6})\b/i,
    /\b(?:numero|nr\.?|n[°.])\s*#?\s*(\d{3,6})\b/i,
  ];
  const conVecchie = (text) => {
    for (let i = 0; i < VECCHIE.length; i++) {
      const x = text.match(VECCHIE[i]); if (!x) continue;
      const n = Number(x[1]);
      if (i === VECCHIE.length - 1 && n >= 1900 && n <= 2099) continue;
      return n;
    }
    return null;
  };
  t('20 tre forme, nello stesso ordine di prima', M.ORDER_PATTERNS.length === 3);
  // corpus: tutte le combinazioni corte di parola, separatori, prefissi e numeri (le vecchie qui finiscono subito)
  const parole = ['ordine', 'Ordine', 'ORDER', 'ordinazione', 'numero', 'nr', 'nr.', 'n.', 'n°', 'pratica', ''];
  const sep = ['', ' ', '  ', '\n', ' \t ', '\r\n'];
  const pre = ['', 'n.', 'nr', 'nr.', 'numero', 'n°', '#', '# ', 'n. #', 'numero#'];
  const num = ['1538', '12', '2026', '1234567', '20152', 'abc'];
  let casi = 0, diversi = [];
  for (const p of parole) for (const s1 of sep) for (const q of pre) for (const s2 of sep) for (const n of num) {
    const txt = `il mio ${p}${s1}${q}${s2}${n} grazie`;
    casi++;
    const a = conVecchie(txt), b = M.extractOrderNumber(txt);
    if (a !== b) diversi.push({ txt, prima: a, ora: b });
  }
  t(`21 ${casi} combinazioni corte: stesso numero d'ordine (o null) con le forme vecchie e nuove`, diversi.length === 0, diversi.slice(0, 5));
  const reali = ['informazioni su spedizione ordine del 23 luglio 2026 n. 1538', 'il mio CAP e\' n. 20152 e l\'ordine #1538 non arriva',
    'ho ordinato il 23 luglio, pratica n. 2026', 'ordine 2026', 'Re: ordine n.1612 - reso', 'ORDINE NR. 1499', 'order #1605 shipping?'];
  diversi = reali.filter((x) => conVecchie(x) !== M.extractOrderNumber(x));
  t('22 le frasi dei test del crop e altre forme vere: stesso risultato', diversi.length === 0, diversi);
} finally {
  try { unlinkSync(TMP); } catch { /* niente */ }
}

console.log(`\n${ok}/${ok + ko} verdi` + (ko ? ` — ${ko} ROSSI` : ''));
process.exitCode = ko ? 1 : 0;
