// tests/mat_guardie.mjs: guardie sul SORGENTE del modulo mat_* (materie prime, migr 0140 Fase 1 catalogo; migr 0144 Fase 2).
//   node tests/mat_guardie.mjs
// Pinnano cio' che rende il modulo un modulo (Regola Ferrea 19) e cio' che lo tiene fuori dalla anon key:
// RLS su ogni tabella, viste security_invoker, bucket privato, flag OFF, pagina che legge SOLO col client loggato.
// Fase 2 (23-09): scritture SOLO dalla edge mat-api con audit, strato AI ai-compila in sola lettura, upload solo sotto inbox/.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const M = read('supabase/migrations/0140_mat_schema.sql');
const API = read('web/src/lib/matApi.ts');
const PAGE = read('web/src/pages/Materiali.tsx');
const PEOPLE = read('web/src/lib/people.tsx');
const APP = read('web/src/App.tsx');
const SEED = read('etl/seed_mat.mjs');
const noSql = (s) => s.replace(/^\s*--[^\n]*$/gm, '');
const noTs = (s) => s.replace(/^\s*\/\/[^\n]*$/gm, '');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 160) : '')); } };

console.log('\n== Modulo additivo (Regola 19) ==');
const tables = [...M.matchAll(/create table if not exists (mat_\w+)/g)].map((m) => m[1]);
t('1  sette tabelle mat_*', tables.length === 7 && tables.every((x) => x.startsWith('mat_')), tables.join(','));
t('2  nessun ALTER TABLE su tabelle core', !/alter table (?!mat_)\w+/i.test(noSql(M)));
t('3  nessun tocco a write-api, change_log, purchases, supplier_orders', !/change_log|write-api|insert into purchases|supplier_orders/i.test(noSql(M)));
t('4  flag mat_enabled inserito a false', /insert into app_flags \(key, value\) values \('mat_enabled', 'false'\)/.test(M));
t('5  FK al core solo in lettura: suppliers(id) referenziata, mai scritta', /references suppliers\(id\)/.test(M) && !/insert into suppliers|update suppliers/i.test(noSql(M)));

console.log('\n== Sicurezza (postura lead_*) ==');
const loop = M.match(/foreach t in array array\[([^\]]+)\]/);
const inLoop = loop ? loop[1].split(',').map((s) => s.trim().replace(/'/g, '')) : [];
t('6  ogni tabella mat_* passa dal blocco RLS (enable + revoke + policy @amimi.it)', tables.every((x) => inLoop.includes(x)) && /enable row level security/.test(M) && /revoke all on %I from anon, authenticated/.test(M) && /ilike ''%%@amimi.it''/.test(M), tables.filter((x) => !inLoop.includes(x)).join(','));
t('7  mat_events non leggibile dagli utenti applicativi', /revoke all on mat_events from authenticated/.test(M));
const views = [...M.matchAll(/create or replace view (v_mat_\w+)( with \(security_invoker = on\))?/g)];
t('8  viste dati con security_invoker = on (tutte tranne v_mat_settings)', views.filter((v) => v[1] !== 'v_mat_settings').every((v) => !!v[2]) && views.length === 5, views.map((v) => v[1] + (v[2] ? '' : '!')).join(','));
t('9  viste dati revocate ad anon', /revoke all on v_mat_catalogo, v_mat_fornitori, v_mat_acquisti, v_mat_assets from anon, public/.test(M));
t('10 v_mat_settings (0140) esponeva SOLO mat_enabled; la 0144 aggiunge i due flag di Fase 2 (test 30)', /create or replace view v_mat_settings as\nselect key, value from app_flags where key in \('mat_enabled'\)/.test(M));
t('11 bucket mat-assets PRIVATO con policy select @amimi.it', /\('mat-assets', 'mat-assets', false\)/.test(M) && /bucket_id = 'mat-assets' and \(auth\.jwt\(\) ->> 'email'\) ilike '%@amimi\.it'/.test(M));
t('12 nessun grant di scrittura ai ruoli applicativi (Fase 1 sola lettura)', !/grant (insert|update|delete|all)/i.test(noSql(M)));

console.log('\n== Idempotenza a DB (Regola 20) ==');
t('13 UNIQUE fornitore (lower nome)', /unique index if not exists mat_suppliers_nome_uq on mat_suppliers \(lower\(nome\)\)/.test(M));
t('14 UNIQUE materiale (fornitore + materiale + colore)', /mat_items_uq on mat_items \(supplier_id, lower\(materiale\), lower\(coalesce\(colore, ''\)\)\)/.test(M));
t('15 UNIQUE ordine (fornitore + numero) e riga (ordine + item)', /mat_orders_uq on mat_orders \(supplier_id, lower\(numero_documento\)\)/.test(M) && /mat_order_lines_uq on mat_order_lines \(order_id, item_id\)/.test(M));
t('16 asset: path unique', /path\s+text not null unique/.test(M));
t('17 seed: dry-run di default, --apply esplicito, 23505 = gia\' presente, somma attesa 4769.08', /APPLY = args\.includes\('--apply'\)/.test(SEED) && /23505/.test(SEED) && /SOMMA_IMPONIBILI_ATTESA = 4769\.08/.test(SEED));
t('18 seed: letture con error destrutturato e stop (20a)', /const \{ data: found, error: e1 \}/.test(SEED) && /if \(e1\) throw/.test(SEED));

console.log('\n== Frontend: letture col client loggato ==');
const anonReads = noTs(API).match(/\bsupabase\.from\('([^']+)'\)/g) ?? [];
t('19 matApi usa il client anon per UNA sola lettura, v_mat_settings (il flag)', anonReads.length === 1 && anonReads[0] === "supabase.from('v_mat_settings')", anonReads.join(','));
t('20 matApi legge le viste v_mat_* via csClient', /csClient\.from\('v_mat_catalogo'\)/.test(API) && /csClient\.from\('v_mat_fornitori'\)/.test(API) && /csClient\.from\('v_mat_acquisti'\)/.test(API) && /csClient\.from\('v_mat_assets'\)/.test(API));
t('21 matApi: URL firmati dal bucket mat-assets (mai URL pubblici)', /storage\.from\('mat-assets'\)\.createSignedUrls/.test(API) && !/getPublicUrl/.test(API));
t('22 la pagina non importa il client anon e non scrive (nessun insert/update/delete)', !/lib\/supabase'/.test(PAGE) && !/\.(insert|update|delete|upsert)\(/.test(noTs(PAGE)));
t('23 login gate: la pagina mostra il login se non c\'e\' sessione csClient', /csClient\.auth\.getSession/.test(PAGE) && /signInWithPassword/.test(PAGE));
t('24 Tab materiali dichiarata e tile "Materie prime" per Ginevra', /'materiali'/.test(PEOPLE) && /label: 'Materie prime', tab: 'materiali'/.test(PEOPLE));
t('25 App: rotta #materiali e pagina gated dal flag', /#materiali/.test(APP) && /matEnabled/.test(APP));

// ---------------------------------------------------------------------------------------------------
// Fase 2 (migr 0144, edge mat-api + ai-compila, form con "Compila"): brief 23-09, D5-D8 accettate.
// ---------------------------------------------------------------------------------------------------
const M2 = read('supabase/migrations/0144_mat_fase2.sql');
const MAPI = read('supabase/functions/mat-api/index.ts');
const AIC = read('supabase/functions/ai-compila/index.ts');
const NUOVO = read('web/src/pages/MaterialiNuovo.tsx');
const cut = (src, tag) => { const a = src.indexOf(`// ==== PURE:${tag} BEGIN ====`), b = src.indexOf(`// ==== PURE:${tag} END ====`); if (a < 0 || b < 0) throw new Error('marcatori PURE:' + tag + ' non trovati'); return src.slice(a, b).split('\n').slice(1).join('\n'); };
const loadPure = async (src, tag, exportsList, file) => { const TMP = ROOT + 'tests/' + file; writeFileSync(TMP, `${cut(src, tag)}\nexport { ${exportsList} };\n`, 'utf8'); try { return await import(pathToFileURL(TMP).href); } finally { try { unlinkSync(TMP); } catch { /* niente */ } } };
const G = await loadPure(MAPI, 'mat-api-guard', 'num, chiDa, dataOk, ilikeEsc, str, CATEGORIE', '_matguard.tmp.ts');
const A = await loadPure(AIC, 'ai-compila', 'buildPrompt, normalizza, TARGETS', '_aicompila.tmp.ts');
// scritture di una edge: le tabelle su cui chiama insert/update/upsert/delete (catene anche su piu' righe)
const scritture = (src) => [...noTs(src).replace(/\n\s*/g, ' ').matchAll(/\.from\('([^']+)'\)(?:\s*\.[a-zA-Z]+\([^)]*\))*?\s*\.(insert|update|upsert|delete)\(/g)].map((m) => m[1]);

console.log('\n== Fase 2: migrazione 0144 ==');
t('26 ai_compila_log con RLS, nessun privilegio ai ruoli applicativi, nessuna policy', /create table if not exists ai_compila_log/.test(M2) && /alter table ai_compila_log enable row level security/.test(M2) && /revoke all on ai_compila_log from anon, authenticated/.test(M2) && !/create policy \w+ on ai_compila_log/.test(M2));
t('27 upload consentito SOLO sotto inbox/ del bucket mat-assets, solo @amimi.it, solo INSERT', /create policy mat_assets_ins on storage\.objects for insert to authenticated\s+with check \(bucket_id = 'mat-assets' and \(auth\.jwt\(\) ->> 'email'\) ilike '%@amimi\.it' and name like 'inbox\/%'\)/.test(M2) && !/for (update|delete)/i.test(noSql(M2)));
t('28 flag mat_write_enabled e ai_compila_enabled inseriti a false', /\('mat_write_enabled', 'false'\)/.test(M2) && /\('ai_compila_enabled', 'false'\)/.test(M2));
t('29 nessun grant di scrittura sulle tabelle e nessun ALTER del core', !/grant (insert|update|delete|all)/i.test(noSql(M2)) && !/alter table (?!mat_|ai_compila_log)\w+/i.test(noSql(M2)));
t('30 v_mat_settings espone solo mat_enabled, mat_write_enabled, ai_compila_enabled', /create or replace view v_mat_settings as\nselect key, value from app_flags where key in \('mat_enabled', 'mat_write_enabled', 'ai_compila_enabled'\)/.test(M2));

console.log('\n== Fase 2: mat-api (scritture) ==');
t('31 JWT utente reale (getUser) + dominio @amimi.it, anon key rifiutata', /auth\.getUser\(token\)/.test(MAPI) && /endsWith\('@amimi\.it'\)\) return json\(\{ error: 'dominio non ammesso' \}, 403\)/.test(MAPI));
t('32 flag mat_write_enabled letto con errore controllato; spento = state off PRIMA di ogni azione', /const \{ data: fl, error: flErr \}/.test(MAPI) && /if \(flErr\) throw new ReadError/.test(MAPI) && MAPI.indexOf("state: 'off'") > 0 && MAPI.indexOf("state: 'off'") < MAPI.indexOf("if (action === 'supplier_upsert')"));
const tabMapi = [...new Set(scritture(MAPI))];
t('33 mat-api scrive SOLO su tabelle mat_* e ai_compila_log (mai core, mai write-api)', tabMapi.length >= 5 && tabMapi.every((x) => x.startsWith('mat_') || x === 'ai_compila_log'), tabMapi.join(','));
t('34 ogni scrittura di dati ha il suo audit in mat_events', (MAPI.match(/await audit\('/g) || []).length >= 6 && /from\('mat_events'\)\.insert/.test(MAPI));
t('35 asset_add: solo path sotto inbox/ e verifica che il file esista nel bucket', /path\.startsWith\('inbox\/'\)/.test(MAPI) && /storage\.from\('mat-assets'\)\.list\(dir/.test(MAPI) && /file non trovato nel bucket/.test(MAPI));
t('36 nessun retryOnce su insert/update/upsert (Regola 20d)', !/retryOnce\(\(\) => sb\.from\('[^']+'\)(?:\.[a-zA-Z]+\([^)]*\))*\.(insert|update|upsert|delete)\(/.test(MAPI.replace(/\n\s*/g, '')));
t('37 23505 = gia\' presente, mai un doppione (fornitore, item, offerta, asset)', (MAPI.match(/23505/g) || []).length >= 4);
t('38 order_add e\' Fase 3 (501), DELETE mai', /order_add[^\n]*501/.test(MAPI) && !/\.delete\(/.test(noTs(MAPI)));
t('39 num(): virgola italiana, migliaia, vuoto = null, testo = NaN', G.num('48,44') === 48.44 && G.num('1.000,00') === 1000 && G.num(' 0,656 ') === 0.656 && G.num('') === null && Number.isNaN(G.num('abc')) && G.num(66) === 66);
t('40 chiDa(): selettore persona come cs-api; nomi lunghi restano fedeli', G.chiDa('Ginni') === 'Ginevra' && G.chiDa('Benny') === 'Benedetta' && G.chiDa('Ale') === 'Ale' && G.chiDa('Claude Code') === 'Claude Code' && G.chiDa('') === 'ignoto');
t('41 dataOk(), ilikeEsc(), str()', G.dataOk('2026-09-23') === '2026-09-23' && G.dataOk('2026-13-01') === 'INVALIDA' && G.dataOk('') === null && G.ilikeEsc('M_M 100%') === 'M\\_M 100\\%' && G.str('  x\u0000y  ') === 'xy' && G.CATEGORIE.length === 11);

console.log('\n== Fase 2: ai-compila (sola lettura) ==');
const tabAic = [...new Set(scritture(AIC))];
t('42 ai-compila scrive SOLO ai_compila_log', tabAic.length === 1 && tabAic[0] === 'ai_compila_log', tabAic.join(','));
t('43 Gemini in JSON mode, temperature 0, tetto token largo, MAI thinkingConfig (nel codice; i commenti lo citano come divieto)', /responseMimeType: 'application\/json'/.test(AIC) && /temperature: 0,/.test(AIC) && /MAX_TOKENS = 8000/.test(AIC) && !/thinkingConfig/.test(noTs(AIC)));
t('44 tetto 4 immagini da 4 MB, mime ammessi, timeout 25 s con AbortController', /MAX_IMG = 4/.test(AIC) && /MAX_BYTES = 4 \* 1024 \* 1024/.test(AIC) && /TIMEOUT_MS = 25000/.test(AIC) && /new AbortController\(\)/.test(AIC) && /application\/pdf/.test(AIC));
t('45 errore = 503 ai_failed (mai una proposta vuota spacciata per buona); risposta vuota = errore', /'ai_failed: '/.test(AIC) && /\}, 503\)/.test(AIC) && /risposta vuota/.test(AIC));
t('46 flag ai_compila_enabled spento = 403 state off; JWT @amimi.it', /flags\.ai_compila_enabled !== 'true'\) return json\(\{ state: 'off'/.test(AIC) && /auth\.getUser\(token\)/.test(AIC));
t('47 path immagini solo sotto inbox/, mai ".."', /startsWith\('inbox\/'\) \|\| p\.includes\('\.\.'\)/.test(AIC));
const P = A.buildPrompt('materiale', 'nota di prova', { fornitori: [{ id: 'abc', nome: 'Damapel' }] });
t('48 prompt: mai una stima, range e scaglioni in prezzo_text, match con il contesto, colori fedeli, niente em dash', /MAI una stima/.test(P) && /prezzo_text/.test(P) && /match_fornitore_id/.test(P) && /Damapel \(id abc\)/.test(P) && /non normalizzati/.test(P) && !/—/.test(P));
const N = A.normalizza('materiale', { fornitore: { v: 'Ego', c: 0.9, f: 'intestazione' }, match_fornitore_id: 'zzz', righe: [{ categoria: { v: 'Vernice', c: 1 }, materiale: { v: 'Vernice', c: 1 }, prezzo: { v: '49,16 fino a 6 pelli', c: 0.4 }, prezzo_text: { v: '49,16/mq (<6 pelli); 46,66/mq (6-30 mq)', c: 0.9 }, quantita: { v: '12,5', c: 0.8 }, unita: { v: 'metri', c: 0.5 } }, { categoria: { v: 'Pelle', c: 0.3 }, materiale: { v: 'x', c: 1 }, prezzo: { v: '48,44', c: 0.9 } }], totale_documento: { v: 'n/d', c: 0 } }, { fornitori: [{ id: 'abc', nome: 'Ego' }] });
t('49 normalizza(): prezzo con testo -> null (resta in prezzo_text), "48,44" -> 48.44, "12,5" -> 12.5, enum non validi -> null', N.righe[0].prezzo.v === null && N.righe[0].prezzo_text.v.includes('49,16') && N.righe[1].prezzo.v === 48.44 && N.righe[0].quantita.v === 12.5 && N.righe[0].unita.v === null && N.righe[1].categoria.v === null && N.righe[0].categoria.v === 'Vernice', JSON.stringify(N.righe[0]));
t('50 normalizza(): match_fornitore_id fuori dal contesto -> null; campo non oggetto -> {v,c,f}', N.match_fornitore_id === null && N.totale_documento.v === null && N.fornitore.f === 'intestazione' && A.TARGETS.length === 3);

console.log('\n== Fase 2: frontend ==');
t('51 il form non importa il client anon e non scrive diretto (insert/update/delete)', !/lib\/supabase'/.test(NUOVO) && !/\.(insert|update|delete|upsert)\(/.test(noTs(NUOVO)));
t('52 upload SOLO nel bucket mat-assets sotto inbox/, mai URL pubblici', /storage\.from\('mat-assets'\)\.upload\(path/.test(API) && /const path = `inbox\/\$\{who\}/.test(API) && !/getPublicUrl/.test(API));
t('53 "Compila" compare solo con aiOn; Salva scrive via mat-api con ai_log_id', /\{aiOn && <div className="lead-actions"><button[^>]*onClick=\{compila\}/.test(NUOVO) && /matWrite\('item_upsert'/.test(NUOVO) && /ai_log_id: aiLog/.test(NUOVO));
t('54 matApi chiama le edge con il JWT di sessione (Bearer), mai con la anon key', /authorization: 'Bearer ' \+ token/.test(API) && /functions\/v1\/mat-api/.test(API) && /functions\/v1\/ai-compila/.test(API));
t('55 la pagina legge i flag da v_mat_settings via csClient e gata i bottoni', /csClient\.from\('v_mat_settings'\)/.test(API) && /canWrite = settings\.mat_write_enabled === 'true'/.test(PAGE) && /aiOn = canWrite && settings\.ai_compila_enabled === 'true'/.test(PAGE));

console.log('\n== Gate 2 del 23-09 (fix fissati) ==');
const LO = read('supabase/functions/lead-outreach/index.ts');
t('56 A1: la chiave Gemini viaggia nell\'header x-goog-api-key, mai nell\'URL, e gli errori sono ripuliti (ai-compila)', /'x-goog-api-key': flags\.gemini_api_key/.test(AIC) && !/generateContent\?key=/.test(noTs(AIC)) && /const scrub = /.test(AIC) && /errore = scrub\(/.test(AIC));
t('57 A1: idem per lead-outreach (draft)', /'x-goog-api-key': key/.test(LO) && !/generateContent\?key=/.test(noTs(LO)) && /scrub\(\(e as Error\)\.message/.test(LO));
t('58 B5: num("1.000") = 1000 (migliaio italiano), "1.000,5" = 1000.5, "1.5" = 1.5', G.num('1.000') === 1000 && G.num('1.000,5') === 1000.5 && G.num('1.5') === 1.5 && G.num('12.345.678') === 12345678);
t('59 A2/B4: upload agganciato al File (identita\'), non alla posizione; niente capture forzato', /c\.file === f/.test(NUOVO) && /cs\.filter\(\(c\) => f\.includes\(c\.file\)\)/.test(NUOVO) && !/capture="environment"/.test(noTs(NUOVO)));
t('60 B1/B2/B3: foto di un documento non e\' "foto"; righe non attive raggiungibili; offerte doppie contate', /docTipo === 'proforma' \|\| docTipo === 'fattura'\) return 'proforma'/.test(NUOVO) && !/\.eq\('attivo', true\)/.test(API) && /tipo === 'inattivi'/.test(PAGE) && /offerteDup\+\+/.test(NUOVO) && /dataOfferta = docData \|\| new Date\(\)/.test(NUOVO));
t('61 C1/C3: mime mai octet-stream (estensione), item_upsert vuoto = 500, log AI solo sulla prima riga di materiale', /application\/octet-stream/.test(API) && /mimeDaNome\(nome\)/.test(MAPI) && /materiale non creato e non ritrovato/.test(MAPI) && /\.\.\.\(i === 0 \? aiExtra : \{\}\)/.test(NUOVO) && !/supplier_upsert', \{ nome: nomeForn, \.\.\.aiExtra/.test(NUOVO));
t('62 C2/C4: tetti del bucket in 0144, search_path sul trigger', /file_size_limit = 10485760/.test(M2) && /allowed_mime_types = array\[/.test(M2) && /language plpgsql set search_path = public/.test(M2));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
