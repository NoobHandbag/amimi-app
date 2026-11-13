// tests/cs_chat_testi.mjs (nel glob tests/cs_*.mjs della CI): i testi della chat del sito (Fase 1 pezzo 7,
// docs/PROPOSTA_chat_sito.md 9.1 e 9.8, D-15; migr 0195). Nessuna rete, nessun DB.
//   node tests/cs_chat_testi.mjs
// Tre parti:
//   1. le bozze delle email NON cambiano: faqTono di cs-assist, il suo codice vero, gira su un cs_faq finto con e senza le
//      voci `risposta_chat` (anche a categoria nulla, anche mescolate fra le altre righe) e deve dare lo stesso risultato
//      per ogni categoria e lingua; chi legge cs_faq e' fissato (chat-api, chat-staff, cs-assist e nessun altro);
//   2. la migrazione 0195: 15 voci della sola chat, italiano e inglese, i fatti decisi da Dan il 3 novembre 2026 (reso
//      dalla consegna, solo info@, niente codici sconto, niente telefono, cotone senza paese), i quattro bottoni collegati
//      e la guardia che si ferma se chat_bottoni non e' quello della 0186;
//   3. la scheda Chat della PWA dice se una risposta vale solo per la chat o e' la stessa delle bozze.
// Autocontrollo: le guardie della parte 1 si provano su un cs-assist rotto e devono scattare.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 300) : '')); } };
const funzione = (src, nome) => { const i = src.indexOf(nome); if (i < 0) return null; const j = src.indexOf('\n}\n', i); return src.slice(i, j + 2); };

const ASSIST = read('supabase/functions/cs-assist/index.ts');
const CLS = read('supabase/functions/cs-classify/index.ts');
const M0195 = read('supabase/migrations/0195_chat_testi_bottoni.sql');
const M0186 = read('supabase/migrations/0186_chat_schema.sql');
const SCHEDA = read('web/src/pages/AssistenzaChat.tsx');
const CANON = [...((CLS.match(/const CANON = \[([\s\S]*?)\];/) ?? ['', ''])[1]).matchAll(/'([^']+)'/g)].map((m) => m[1]);

// ---- le voci della migrazione ----
const voci = [...M0195.matchAll(/\('risposta_chat', '((?:[^']|'')*)', (null|'(?:[^']|'')*'),\s*\$t\$([\s\S]*?)\$t\$,\s*\$t\$([\s\S]*?)\$t\$, (true|false)\)/g)]
  .map((m) => ({ titolo: m[1].replace(/''/g, "'"), handle: m[1].split(':')[0], categoria: m[2] === 'null' ? null : m[2].slice(1, -1).replace(/''/g, "'"), it: m[3], en: m[4], attiva: m[5] === 'true' }));

// ---- parte 1: cs-assist ----
console.log('\n== le bozze delle email non cambiano (faqTono di cs-assist, codice vero) ==');
const faqToneSrc = funzione(ASSIST, 'async function faqTono(');
const crea = (src) => new Function(stripTypeScriptTypes(src) + '\nreturn faqTono;')();
// cs_faq finto: le 19 righe di produzione (tipi e categorie letti il 13 novembre 2026), testi segnaposto distinti
const BASE = [
  [1, 'esempio_tono', 'Restock e disponibilita'], [2, 'esempio_tono', 'Spedizione e stato ordine'], [3, 'esempio_tono', 'Ritiro, negozio, appuntamenti'],
  [4, 'esempio_tono', 'Codice sconto'], [5, 'esempio_tono', 'Reso e rimborso'], [6, 'esempio_tono', 'Personalizzazione e cerimonia'],
  [7, 'risposta_standard', 'Spedizione e stato ordine'], [8, 'risposta_standard', 'Restock e disponibilita'], [9, 'risposta_standard', 'Ritiro, negozio, appuntamenti'],
  [10, 'risposta_standard', 'Cambio e prodotto errato'], [11, 'risposta_standard', 'Codice sconto'], [12, 'risposta_standard', 'Personalizzazione e cerimonia'],
  [13, 'risposta_standard', 'Reso e rimborso'], [14, 'risposta_standard', 'Info prodotto'], [15, 'risposta_standard', 'Riparazione'], [16, 'risposta_standard', 'Pagamento'],
  [17, 'risposta_standard', 'Gift card e account'], [18, 'risposta_standard', 'Modifica / correzione indirizzo'], [21, 'risposta_standard', 'Codice sconto'],
].map(([id, tipo, categoria]) => ({ id, tipo, categoria, attiva: true, testo_it: `IT ${id}`, testo_en: tipo === 'esempio_tono' ? null : `EN ${id}` }));
const CHAT = voci.map((v, i) => ({ id: 22 + i, tipo: 'risposta_chat', categoria: v.categoria, attiva: true, testo_it: v.it, testo_en: v.en }));
// righe in tre ordini fisici: senza le voci, voci in fondo, voci mescolate (una lettura senza order by le restituisce come capita)
const mescolate = () => { const out = []; let j = 0; for (const r of BASE) { out.push(r); if (j < CHAT.length) out.push(CHAT[j++]); } return [...out, ...CHAT.slice(j)]; };
const ORDINI = { senza: BASE, in_fondo: [...BASE, ...CHAT], in_testa: [...CHAT, ...BASE], mescolate: mescolate() };
const sbFinto = (righe) => ({
  from(tab) {
    if (tab !== 'cs_faq') throw new Error('tabella inattesa ' + tab);
    return { select(cols) { const c = cols.split(','); return { eq(k, v) { return Promise.resolve({ data: righe.filter((r) => r[k] === v).map((r) => Object.fromEntries(c.map((x) => [x, r[x]]))), error: null }); } }; } };
  },
});
async function confronta(fn) {
  const diverse = [];
  for (const categoria of [null, '', ...CANON]) {
    for (const lingua of [null, 'it', 'en']) {
      const base = JSON.stringify(await fn(sbFinto(ORDINI.senza), categoria, lingua));
      for (const [nome, righe] of Object.entries(ORDINI)) {
        if (JSON.stringify(await fn(sbFinto(righe), categoria, lingua)) !== base) diverse.push(`${nome}/${categoria}/${lingua}`);
      }
    }
  }
  return diverse;
}
t('P0 faqTono trovata in cs-assist, 14 categorie di cs-classify, 15 voci nella migrazione', !!faqToneSrc && CANON.length === 14 && voci.length === 15, { canon: CANON.length, voci: voci.length });
const faqTono = crea(faqToneSrc);
const vere = await confronta(faqTono);
t('P1 con le voci risposta_chat (in fondo, in testa, mescolate) le risposte standard e gli esempi di tono di ogni bozza restano identici, per ogni categoria e lingua', vere.length === 0, vere);
const campione = await faqTono(sbFinto(ORDINI.mescolate), null, 'en');
t('P2 anche una conversazione senza categoria (dove entrano tutte le risposte) non vede nessuna voce della chat', campione.standard.length === 4 && campione.standard.every((s) => /^EN \d+$/.test(s)) && campione.tono.every((s) => /^IT \d+$/.test(s)), campione);
// chi legge cs_faq: le edge che la nominano, e la PWA mai
const edge = readdirSync(ROOT + 'supabase/functions', { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .flatMap((d) => readdirSync(ROOT + 'supabase/functions/' + d.name).filter((f) => f.endsWith('.ts')).map((f) => `${d.name}/${f}`))
  .filter((p) => /from\('cs_faq'\)/.test(read('supabase/functions/' + p))).sort();
t('P3 leggono cs_faq solo chat-api, chat-staff e cs-assist (un lettore nuovo va guardato qui)', JSON.stringify(edge) === JSON.stringify(['chat-api/index.ts', 'chat-staff/index.ts', 'cs-assist/index.ts']), edge);
const pwa = (function cerca(dir) { return readdirSync(ROOT + dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? cerca(dir + '/' + d.name) : /\.(ts|tsx)$/.test(d.name) && /cs_faq/.test(read(dir + '/' + d.name)) ? [dir + '/' + d.name] : []); })('web/src');
t('P4 la PWA non legge cs_faq (la scheda Chat passa da chat-staff)', pwa.length === 0, pwa);
t('P5 cs-assist legge cs_faq in un punto solo e non nomina il tipo della chat', (ASSIST.match(/from\('cs_faq'\)/g) ?? []).length === 1 && !/risposta_chat/.test(ASSIST));
// autocontrollo: un cs-assist che lasciasse entrare le voci della chat deve far scattare P1
const rottaStd = faqToneSrc.replace("(r.tipo === 'faq' || r.tipo === 'risposta_standard')", "(r.tipo === 'faq' || r.tipo === 'risposta_standard' || r.tipo === 'risposta_chat')");
const rottaTono = faqToneSrc.replace("rows.filter((r) => r.tipo === 'esempio_tono')", "rows.filter((r) => r.tipo === 'esempio_tono' || r.tipo === 'risposta_chat')");
t('P6 autocontrollo: cs-assist che legge anche risposta_chat fra le risposte o fra i toni -> visto', rottaStd !== faqToneSrc && rottaTono !== faqToneSrc
  && (await confronta(crea(rottaStd))).length > 0 && (await confronta(crea(rottaTono))).length > 0);

// ---- parte 2: la migrazione ----
console.log('\n== migrazione 0195: le 15 voci e i bottoni ==');
const HANDLE = ['faq-negozio-fisico-showroom', 'faq-ritiro-di-persona', 'faq-costi-e-tempi-spedizione', 'faq-corriere-e-tracking', 'faq-dove-e-il-mio-ordine',
  'faq-annullare-modificare-ordine', 'faq-reso-e-spedizione-reso', 'faq-reso-a-mano-milano', 'faq-articolo-difettoso', 'faq-codice-newsletter',
  'faq-riassortimento', 'faq-su-misura', 'faq-contatti', 'faq-produzione-e-materiali', 'faq-altri-negozi'];
const cp = (s) => [...s].length;
const di = (h) => voci.find((v) => v.handle === h) ?? { it: '', en: '' };
t('M1 le 15 voci faq-* della Knowledge base, una volta ciascuna, tutte attive', JSON.stringify(voci.map((v) => v.handle)) === JSON.stringify(HANDLE) && voci.every((v) => v.attiva), voci.map((v) => v.handle));
t('M2 titolo "handle: domanda", categoria della tassonomia di cs-classify o nulla', voci.every((v) => /^faq-[a-z-]+: \S.*\?|^faq-[a-z-]+: \S/.test(v.titolo) && (v.categoria === null || CANON.includes(v.categoria))), voci.filter((v) => v.categoria !== null && !CANON.includes(v.categoria)));
t('M3 italiano e inglese pieni, diversi, entro i 4.000 caratteri di un messaggio della chat (TESTO_DB_MAX)', voci.every((v) => v.it.trim() && v.en.trim() && v.it !== v.en && cp(v.it) <= 4000 && cp(v.en) <= 4000));
const tutti = voci.flatMap((v) => [v.it, v.en]);
t('M4 niente segnaposto ne\' link: la chat mostra il testo cosi\' com\'e\'', tutti.every((s) => !/[{}\[\]]|https?:|www\./.test(s)), tutti.filter((s) => /[{}\[\]]|https?:|www\./.test(s)));
t('M5 una sola email, info@amimi.it (D2 del 3 novembre); niente telefono (D7)', tutti.every((s) => [...s.matchAll(/[\w.+-]+@[\w.-]+/g)].every((m) => m[0].replace(/[.,;:]$/, '') === 'info@amimi.it'))
  && tutti.every((s) => !/support@|\+39|\b3\d{2}\s?\d{3}\s?\d{4}\b|telefono\s*:|phone\s*:/i.test(s)));
t('M6 nessun codice sconto (AMIMI10, AMICA12, PERTE...): la voce del codice non lo dice, apposta', tutti.every((s) => !/\b[A-Z]{4,}\d{1,3}\b|\bPERTE\b|AMICA|AMIMI10/.test(s)));
t('M7 reso entro 14 giorni dalla CONSEGNA (D1), mai dall\'ordine', /entro 14 giorni dalla consegna/.test(di('faq-reso-e-spedizione-reso').it) && /within 14 days of delivery/.test(di('faq-reso-e-spedizione-reso').en)
  && tutti.every((s) => !/dalla data dell'ordine|dall'ordine|from the order date|of (the )?order date/i.test(s)));
const frasiCotone = voci.flatMap((v) => [v.it, v.en]).flatMap((s) => s.split(/(?<=\.)\s+/)).filter((f) => /cotone|cotton/i.test(f));
t('M8 cotone: mai Italia ne\' India nella frase del cotone (CONOSCENZA sez. 1)', frasiCotone.length >= 2 && frasiCotone.every((f) => !/itali|italy|india/i.test(f)), frasiCotone);
t('M9 portineria e orari del ritiro uguali in italiano e inglese (D3)', ['faq-ritiro-di-persona', 'faq-reso-a-mano-milano'].every((h) => ['Fulcorina 13, 20123', '8:00-13:00', '14:00-17:00', '8:00-11:00'].every((x) => di(h).it.includes(x) && di(h).en.includes(x))));
t('M10 spedizione: stessi importi e tempi nelle due lingue', ['3,90', '100', '15', '200', '40', '600', '2-6', '4-8', '9-15'].every((x) => di('faq-costi-e-tempi-spedizione').it.includes(x))
  && ['3.90', '100', '15', '200', '40', '600', '2-6', '4-8', '9-15'].every((x) => di('faq-costi-e-tempi-spedizione').en.includes(x)));
// i bottoni
const mappa = [...((M0195.match(/join \(values ([\s\S]*?)\) as mp\(bottone, handle\)/) ?? ['', ''])[1]).matchAll(/\('([a-z_]+)', '([a-z-]+)'\)/g)].map((m) => [m[1], m[2]]);
t('M11 i quattro bottoni puntano alla voce del loro argomento', JSON.stringify(mappa) === JSON.stringify([['spedizioni', 'faq-costi-e-tempi-spedizione'], ['resi', 'faq-reso-e-spedizione-reso'], ['ritiri', 'faq-ritiro-di-persona'], ['ordine', 'faq-dove-e-il-mio-ordine']]), mappa);
// chat_bottoni come nasce nella 0186: jsonb_build_object('id', ..., 'it', ..., 'en', ..., 'faq', null) per bottone
const seed0186 = (M0186.match(/\('chat_bottoni', jsonb_build_array\(([\s\S]*?)\)::text\)/) ?? ['', ''])[1];
const lett = (s) => (s.startsWith('$t$') ? s.slice(3, -3) : s.slice(1, -1).replace(/''/g, "'"));
const LETT = "('(?:[^']|'')*'|\\$t\\$[\\s\\S]*?\\$t\\$)";
const b0186 = [...seed0186.matchAll(new RegExp(`jsonb_build_object\\('id', ${LETT}, 'it', ${LETT}, 'en', ${LETT}, 'faq', null\\)`, 'g'))]
  .map((m) => ({ en: lett(m[3]), id: lett(m[1]), it: lett(m[2]), faq: null }));
t('M12 chat_bottoni della 0186 = quello che la 0195 si aspetta (quattro bottoni in quell\'ordine, faq null): lo stack locale la applica',
  JSON.stringify(b0186.map((b) => b.id)) === '["spedizioni","resi","ritiri","ordine"]' && b0186.every((b) => b.faq === null), seed0186);
t('M13 la 0195 si ferma invece di sovrascrivere: voci gia\' importate, chat_bottoni diverso, collegamento incompleto; una transazione',
  /if n <> 0 then\s+raise exception '0195: in cs_faq ci sono gia''/.test(M0195) && /v_ids is distinct from array\['spedizioni', 'resi', 'ritiri', 'ordine'\]/.test(M0195)
  && /jsonb_typeof\(e -> 'faq'\) <> 'number'/.test(M0195) && /^begin;$/m.test(M0195) && /^commit;$/m.test(M0195) && /for update/.test(M0195));
t('M14 la 0195 tocca solo cs_faq (insert di risposta_chat) e la chiave chat_bottoni di app_flags',
  [...M0195.replace(/--.*$/gm, '').matchAll(/\b(insert into|update|delete from)\s+([a-z_.]+)/gi)].map((m) => m[1].toLowerCase() + ' ' + m[2]).join('|') === 'insert into public.cs_faq|update public.app_flags'
  && /update public\.app_flags set value = v_nuovo::text where key = 'chat_bottoni';/.test(M0195));
t('M15 il rollback scritto nella testata rimette chat_bottoni della 0186 (faq null) e toglie solo le voci della chat',
  /delete from cs_faq where tipo = 'risposta_chat';/.test(M0195) && (() => { const r = (M0195.match(/--\s+update app_flags set value = '(.*)' where key = 'chat_bottoni';/) ?? ['', ''])[1].replace(/''/g, "'"); try { return JSON.stringify(JSON.parse(r)) === JSON.stringify(b0186); } catch { return false; } })());

// ---- parte 3: la scheda Chat ----
console.log('\n== scheda Chat ==');
t('S1 la nota sotto ogni risposta dice se vale solo per la chat (risposta_chat) o e\' la stessa delle bozze', /tipo === 'risposta_chat' \? 'Vale solo per la chat: le bozze delle email non la usano\.' : 'È la stessa risposta standard che usano le bozze delle email\.'/.test(SCHEDA)
  && /notaRisposta\(imp\?\.faq\.find\(\(f\) => f\.id === b\.faq\)\?\.tipo\)/.test(SCHEDA) && existsSync(ROOT + 'web/e2e/assistenza-chat.spec.ts')
  && /scheda Chat \(pezzo 7\)/.test(read('web/e2e/assistenza-chat.spec.ts')));

console.log(`\ncs_chat_testi: ${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
