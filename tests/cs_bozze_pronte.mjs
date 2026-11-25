// tests/cs_bozze_pronte.mjs — bozze pronte (cs-assist v33, migr 0210, UI Assistenza).
//   node tests/cs_bozze_pronte.mjs
//
// Perche' esiste. Il cron genera bozze senza che nessuno guardi: le guardie che lo tengono sicuro e
// pagabile sono nel codice, e un refactor le puo' togliere in silenzio. La decisione "scrivo o no"
// (blocco PURE:cs-predraft) si prova su casi veri; il resto si fissa sul sorgente. Tutti i finding del
// Gate 2 del 24-11 hanno qui il loro caso: A1 (tentativi che si accavallano o si ripetono all'infinito),
// A2 (messaggio arrivato durante la generazione), B1 (finestra dei candidati), B2 (insert non
// controllato), B3 (nota "pronte" sopra proposte nuove), B4 (errore passeggero = blocco), C1 (timeout).
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const EDGE = read('supabase/functions/cs-assist/index.ts');
const MIG = read('supabase/migrations/0210_cs_bozze_pronte.sql');
const API = read('web/src/lib/csApi.ts');
const UI = read('web/src/pages/Assistenza.tsx');
const CSS = read('web/src/styles/screens/assistenza.css');

const BEGIN = '// ==== PURE:cs-predraft BEGIN ====', END = '// ==== PURE:cs-predraft END ====';
const a = EDGE.indexOf(BEGIN), b = EDGE.indexOf(END);
if (a < 0 || b < 0) { console.error('marcatori PURE:cs-predraft non trovati'); process.exit(1); }
const costanti = ['PREDRAFT_CLAIM_MS', 'PREDRAFT_MAX_TENTATIVI'].map((n) => (EDGE.match(new RegExp(`const ${n} = [^;]+;`)) || [''])[0]).join('\n');
const TMP = `${ROOT}tests/_predraft.tmp.ts`;
writeFileSync(TMP, `${costanti}\n${EDGE.slice(a + BEGIN.length, b).trim()}\nexport { predraftStato, predraftKoPermanente, PREDRAFT_CLAIM_MS, PREDRAFT_MAX_TENTATIVI };\n`, 'utf8');
let predraftStato, predraftKoPermanente, PREDRAFT_CLAIM_MS, PREDRAFT_MAX_TENTATIVI;
try { ({ predraftStato, predraftKoPermanente, PREDRAFT_CLAIM_MS, PREDRAFT_MAX_TENTATIVI } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + JSON.stringify(extra) : '')); } };
const blocco = (src, da, al) => { const i = src.indexOf(da); const j = src.indexOf(al, i + da.length); return i < 0 || j < 0 ? '' : src.slice(i, j); };
const PRE = blocco(EDGE, "if (action === 'predraft') {", "// ---------- refine");

const U = '2026-11-24T10:00:00.000Z';                // ultimo messaggio della cliente
const ORA = Date.parse('2026-11-24T11:00:00.000Z');
const min = (m) => new Date(Date.parse(U) + m * 60000).toISOString();

console.log('== decisione del cron (PURE:cs-predraft) ==');
t('1  nessuna bozza, nessun evento: da fare', predraftStato(U, [], [], ORA) === 'da_fare');
t('2  bozza basata sull\'ultimo messaggio: coperta', predraftStato(U, [{ created_at: min(1), base_msg_at: U }], [], ORA) === 'coperta');
t('3  A2: bozza scritta DOPO ma basata su un messaggio PRIMA: da fare', predraftStato(U, [{ created_at: min(1), base_msg_at: min(-3) }], [], ORA) === 'da_fare');
t('4  bozza di prima della v33 (senza base): conta created_at', predraftStato(U, [{ created_at: min(2), base_msg_at: null }], [], ORA) === 'coperta');
t('5  bozza vecchia senza base: da fare', predraftStato(U, [{ created_at: min(-5), base_msg_at: null }], [], ORA) === 'da_fare');
t('6  A1: tentativo in corso da 2 minuti (a mano o cron): in corso', predraftStato(U, [], [{ azione: 'draft_start', chi: 'Ginevra', at: new Date(ORA - 2 * 60000).toISOString() }], ORA) === 'in_corso');
t('7  tentativo del cron fallito 20 minuti fa: si riprova', predraftStato(U, [], [{ azione: 'draft_start', chi: 'auto', at: new Date(ORA - 20 * 60000).toISOString() }], ORA) === 'da_fare');
t('8  A1: due tentativi del cron falliti: basta', predraftStato(U, [], [{ azione: 'draft_start', chi: 'auto', at: min(5) }, { azione: 'draft_start', chi: 'auto', at: min(20) }], ORA) === 'tentativi_finiti');
t('9  tentativi dell\'operatrice non consumano quelli del cron', predraftStato(U, [], [{ azione: 'draft_start', chi: 'Ginevra', at: min(5) }, { azione: 'draft_start', chi: 'Ale', at: min(20) }], ORA) === 'da_fare');
t('10 ko permanente dopo l\'ultimo messaggio: fermo', predraftStato(U, [], [{ azione: 'predraft_ko', chi: 'auto', at: min(3) }], ORA) === 'ko');
t('11 eventi PRIMA dell\'ultimo messaggio non contano (la cliente ha riscritto)', predraftStato(U, [], [{ azione: 'predraft_ko', chi: 'auto', at: min(-10) }, { azione: 'draft_start', chi: 'auto', at: min(-9) }, { azione: 'draft_start', chi: 'auto', at: min(-8) }], ORA) === 'da_fare');
t('12 ultimo messaggio illeggibile: non generare', predraftStato('boh', [], [], ORA) !== 'da_fare');
t('13 costanti: claim 10 minuti, 2 tentativi', PREDRAFT_CLAIM_MS === 600000 && PREDRAFT_MAX_TENTATIVI === 2);
t('14 B4: 404/422/400 permanenti, 502/503/500 no', [404, 422, 400].every(predraftKoPermanente) && ![500, 502, 503].some(predraftKoPermanente));

console.log('\n== edge, sul sorgente ==');
t('15 la bozza a mano passa da faiBozza', /if \(action === 'draft'\) return await faiBozza\(\);/.test(EDGE));
t('16 predraft chiama faiBozza una sola volta, dentro un try', (PRE.match(/faiBozza\(\)/g) || []).length === 1 && /try \{ r = await faiBozza\(\); \}/.test(PRE));
t('17 predraft NON e\' tra le azioni JWT (va col PIN del cron)', !/JWT_ACTIONS = new Set\([^)]*predraft/.test(EDGE));
t('18 interruttore nella whitelist e cron spento se cs_enabled o cs_predraft_attivo non sono true', /'cs_predraft_attivo'\]\);/.test(EDGE) && /flags\.cs_enabled !== 'true' \|\| flags\.cs_predraft_attivo !== 'true'/.test(PRE));
t('19 solo email e moduli, mai fatte, ultimo messaggio della cliente, gia\' classificate, 7 giorni, mai B2B',
  /\.in\('canale', PREDRAFT_CANALI\)/.test(PRE) && /PREDRAFT_CANALI = \['email_diretta', 'form_contatto', 'form_evento'\]/.test(EDGE)
  && /\.neq\('stato', 'fatto'\)/.test(PRE) && /\.eq\('last_direction', 'in'\)/.test(PRE) && /\.not\('categoria_source', 'is', null\)/.test(PRE)
  && /PREDRAFT_GIORNI = 7;/.test(EDGE) && /c\.categoria !== 'Collaborazioni e B2B'/.test(PRE));
t('20 B1: candidati fino a 200, bozze ed eventi letti tutti insieme', /PREDRAFT_CANDIDATI = 200;/.test(EDGE) && /\.in\('conversation_id', ids\)\.in\('source', \['app', 'auto'\]\)/.test(PRE) && /\.in\('azione', \['draft_start', 'predraft_ko'\]\)/.test(PRE));
t('21 lettura incerta di bozze o eventi = 503, nessuna bozza', /if \(be \|\| ee\) return json\(/.test(PRE));
t('22 A1: faiBozza scrive draft_start prima di chiamare il modello', /azione: 'draft_start', chi, dettaglio: \{ source: draftSource \}/.test(EDGE));
t('23 A2: la risposta salvata porta base_msg_at', /base_msg_at: baseMsgAt \|\| null/.test(EDGE));
t('24 B2: insert della bozza controllato (503 se non salvata)', /if \(insErr \|\| !ins\?\.id\) return json\(\{ ok: false, error: 'bozza non salvata/.test(EDGE));
t('25 B4: predraft_ko scritto solo per esiti permanenti', /if \(predraftKoPermanente\(r\.status\)\) \{\n\s+await sb\.from\('cs_events'\)\.insert\(\{ conversation_id: scelta\.id, azione: 'predraft_ko'/.test(PRE));
t('26 source auto e chi auto', /action === 'predraft' \? 'auto' : body\.source === 'eval'/.test(EDGE) && /const chi = action === 'predraft' \? 'auto'/.test(EDGE));
t('27 la riga salva la risposta completa', /risposta: risposta as unknown as Row \}\)\.select\('id'\)/.test(EDGE));

console.log('\n== migrazione ==');
t('28 colonna risposta jsonb', /add column if not exists risposta jsonb/.test(MIG));
t('29 interruttore creato SPENTO', /\('cs_predraft_attivo', 'false'\)/.test(MIG));
t('30 PIN mai nel repo: comando copiato dal cron del riassunto', !/"pin"/.test(MIG) && /replace\(cmd, '"action":"summary"', '"action":"predraft"'\)/.test(MIG));
t('31 C1: timeout di 60 s aggiunto e verificato', /timeout_milliseconds := 60000,'\)/.test(MIG) && /position\('timeout_milliseconds := 60000' in nuovo\) = 0/.test(MIG));
t('32 cron ogni 2 minuti', /'cs-assist-predraft', '\*\/2 \* \* \* \*', nuovo\)/.test(MIG));

console.log('\n== web ==');
t('33 ultimaBozza legge anche le bozze auto e la risposta', /\.in\('source', \['app', 'auto'\]\)/.test(API) && /select\('id, testo, created_at, edited, dati_usati, source, risposta'\)/.test(API));
t('34 live e salvata passano dallo stesso traduttore', /return proposteDa\(j\);/.test(API) && /proposteDa\(b\.risposta\)/.test(UI));
t('35 proposte salvate solo se non ritoccate, nessuna generazione in corso, thread fermo dopo la BASE',
  /if \(!b \|\| !b\.risposta \|\| b\.edited \|\| letti === null \|\| genRef\.current\) return;/.test(UI)
  && /const base = Date\.parse\(String\(b\.risposta\.base_msg_at \?\? b\.created_at\)\);/.test(UI)
  && /!letti\.some\(\(m\) => m\.sent_at && Date\.parse\(m\.sent_at\) > base\)/.test(UI));
t('36 anche il riquadro "C\'e\' gia\' una bozza" guarda la base', /Date\.parse\(String\(bozzaSalvata\.risposta\?\.base_msg_at \?\? q\)\)/.test(UI));
t('37 B3: dopo una generazione la nota "pronte" sparisce', /applicaProposte\(r\); setPronte\(null\);/.test(UI) && /finally \{ genRef\.current = false; \}/.test(UI));
t('38 il draftId delle proposte salvate e\' la riga della bozza', /draftId: b\.id/.test(UI));
t('39 C2: giorno e ora nello stesso fuso', /const giornoLocale = \(iso: string\) => new Date\(iso\)\.toLocaleDateString/.test(UI) && !/fmtData\(pronte/.test(UI) && !/fmtData\(q\.slice/.test(UI));
t('40 C4: il caricamento sta sopra le proposte, non al loro posto', /\{genBozza && \(/.test(UI) && /\{!options \? \(!genBozza && \(/.test(UI));
t('41 animazione con avviso di restare, movimento ridotto rispettato', /className="cs-gen"/.test(UI) && /resta su questa conversazione/.test(UI) && /@keyframes cs-gen-fill/.test(CSS) && /prefers-reduced-motion: reduce\) \{ \.scr-assist \.cs-gen-dots/.test(CSS));

// 25-11: con le bozze pronte draftMode e' vero gia' all'apertura; la riga delle azioni (Prendo io,
// Conclusa, ⋯ Non e' un cliente) stava sotto !draftMode e spariva. Si comprimono solo le chip.
const TESTATA = blocco(UI, "{c.canale !== 'rumore' && (", "{!draftMode && c.canale === 'rumore'");
t('42 azioni della testata visibili anche con le bozze a schermo (solo le chip si comprimono)',
  /\{!draftMode && <div className="cs-chiprow">/.test(TESTATA) && /\{!isChatSito\(c\) && <div className="cs-actions-row">/.test(TESTATA)
  && /Non è un cliente/.test(TESTATA) && (TESTATA.match(/draftMode &&/g) || []).length === 1 && !/!draftMode && c\.canale !== 'rumore'/.test(UI));

console.log(`\n${ok}/${ok + ko} verdi`);
if (ko) process.exit(1);
