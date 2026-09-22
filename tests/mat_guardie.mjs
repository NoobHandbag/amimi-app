// tests/mat_guardie.mjs: guardie sul SORGENTE del modulo mat_* (materie prime, migr 0140, Fase 1 catalogo).
//   node tests/mat_guardie.mjs
// Pinnano cio' che rende il modulo un modulo (Regola Ferrea 19) e cio' che lo tiene fuori dalla anon key:
// RLS su ogni tabella, viste security_invoker, bucket privato, flag OFF, pagina che legge SOLO col client loggato.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
t('10 v_mat_settings espone SOLO mat_enabled', /create or replace view v_mat_settings as\nselect key, value from app_flags where key in \('mat_enabled'\)/.test(M));
t('11 bucket mat-assets PRIVATO con policy select @amimi.it', /\('mat-assets', 'mat-assets', false\)/.test(M) && /bucket_id = 'mat-assets' and \(auth\.jwt\(\) ->> 'email'\) ilike '%@amimi\.it'/.test(M));
t('12 nessun grant di scrittura ai ruoli applicativi (Fase 1 sola lettura)', !/grant (insert|update|delete|all)/i.test(noSql(M)));

console.log('\n== Idempotenza a DB (Regola 20) ==');
t('13 UNIQUE fornitore (lower nome)', /unique index if not exists mat_suppliers_nome_uq on mat_suppliers \(lower\(nome\)\)/.test(M));
t('14 UNIQUE materiale (fornitore + materiale + colore)', /mat_items_uq on mat_items \(supplier_id, lower\(materiale\), lower\(coalesce\(colore, ''\)\)\)/.test(M));
t('15 UNIQUE ordine (fornitore + numero) e riga (ordine + item)', /mat_orders_uq on mat_orders \(supplier_id, lower\(numero_documento\)\)/.test(M) && /mat_order_lines_uq on mat_order_lines \(order_id, item_id\)/.test(M));
t('16 asset: path unique', /path\s+text not null unique/.test(M));
t('17 seed: dry-run di default, --apply esplicito, 23505 = gia\' presente, somma attesa 4769.08', /APPLY = args\.includes\('--apply'\)/.test(SEED) && /23505/.test(SEED) && /SOMMA_IMPONIBILI_ATTESA = 4769\.08/.test(SEED));
t('18 seed: letture con error destrutturato e stop (20a)', /const \{ data: found, error: e1 \}/.test(SEED) && /if \(e1\) throw/.test(SEED));

console.log('\n== Frontend: sola lettura col client loggato ==');
const anonReads = noTs(API).match(/\bsupabase\.from\('([^']+)'\)/g) ?? [];
t('19 matApi usa il client anon per UNA sola lettura, v_mat_settings (il flag)', anonReads.length === 1 && anonReads[0] === "supabase.from('v_mat_settings')", anonReads.join(','));
t('20 matApi legge le viste v_mat_* via csClient', /csClient\.from\('v_mat_catalogo'\)/.test(API) && /csClient\.from\('v_mat_fornitori'\)/.test(API) && /csClient\.from\('v_mat_acquisti'\)/.test(API) && /csClient\.from\('v_mat_assets'\)/.test(API));
t('21 matApi: URL firmati dal bucket mat-assets (mai URL pubblici)', /storage\.from\('mat-assets'\)\.createSignedUrls/.test(API) && !/getPublicUrl/.test(API));
t('22 la pagina non importa il client anon e non scrive (nessun insert/update/delete)', !/lib\/supabase'/.test(PAGE) && !/\.(insert|update|delete|upsert)\(/.test(noTs(PAGE)));
t('23 login gate: la pagina mostra il login se non c\'e\' sessione csClient', /csClient\.auth\.getSession/.test(PAGE) && /signInWithPassword/.test(PAGE));
t('24 Tab materiali dichiarata e tile "Materie prime" per Ginevra', /'materiali'/.test(PEOPLE) && /label: 'Materie prime', tab: 'materiali'/.test(PEOPLE));
t('25 App: rotta #materiali e pagina gated dal flag', /#materiali/.test(APP) && /matEnabled/.test(APP));

// ---------------------------------------------------------------- Fase 2 (migr 0144, mat-api, ai-compila)
const M2 = read('supabase/migrations/0144_mat_fase2.sql');
const MAPI = read('supabase/functions/mat-api/index.ts');
const AI = read('supabase/functions/ai-compila/index.ts');
const PROMPT = read('supabase/functions/ai-compila/prompt.ts');
const TOML = read('supabase/config.toml');
const ORD = read('web/src/components/SupplierOrderForm.tsx');
const mapi = noTs(MAPI), ai = noTs(AI);

console.log('\n== Fase 2: migrazione 0144 ==');
t('26 ai_compila_log con RLS e nessun privilegio ai ruoli applicativi', /create table if not exists ai_compila_log/.test(M2) && /alter table ai_compila_log enable row level security/.test(M2) && /revoke all on ai_compila_log from anon, authenticated/.test(M2));
t('27 policy INSERT bucket solo @amimi.it e solo sotto inbox/', /create policy mat_assets_ins on storage\.objects for insert to authenticated/.test(M2) && /name like 'inbox\/%'/.test(M2) && /ilike '%@amimi\.it'/.test(M2));
t('28 flag mat_write_enabled e ai_compila_enabled inseriti a false', /\('mat_write_enabled', 'false'\)/.test(M2) && /\('ai_compila_enabled', 'false'\)/.test(M2));
t('29 nessun ALTER su tabelle core, nessun grant di scrittura a authenticated su mat_*', !/alter table (?!mat_|ai_compila)\w+/i.test(noSql(M2)) && !/grant (insert|update|delete|all) on mat_/i.test(noSql(M2)));
t('30 v_mat_settings espone solo i tre flag del modulo', /where key in \('mat_enabled', 'mat_write_enabled', 'ai_compila_enabled'\)/.test(M2));

console.log('\n== Fase 2: mat-api (scritture) ==');
t('31 mat-api: getUser sul token utente, la anon key non basta, email @amimi.it', /auth\.getUser\(token\)/.test(mapi) && /endsWith\('@amimi\.it'\)/.test(mapi));
t('32 mat-api: chi obbligatorio dal selettore (B/G/A)', /IDENT\[String\(body\.chi/.test(mapi) && /chi mancante/.test(mapi));
t('33 mat-api: flag mat_write_enabled letto con errore controllato, OFF = state off', /'mat_write_enabled'/.test(mapi) && /throw new ReadError\('flag non leggibile/.test(mapi) && /return json\(\{ state: 'off' \}\)/.test(mapi));
t('34 mat-api: scrive solo tabelle mat_* e ai_compila_log (mai core, write-api, change_log)', ![...mapi.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]).some((tb) => !tb.startsWith('mat_') && tb !== 'ai_compila_log' && tb !== 'app_flags') && !/change_log|write-api|purchases|supplier_orders/.test(mapi));
t('35 mat-api: nessun DELETE (non attivo al posto di cancellare)', !/\.delete\(/.test(mapi) && /item_set_attivo/.test(mapi));
t('36 mat-api: ogni azione di scrittura passa da audit mat_events', (mapi.match(/await audit\(/g) ?? []).length >= 6 && /from\('mat_events'\)\.insert/.test(mapi));
t('37 mat-api: 23505 trattato come gia\' presente (chiave naturale = UNIQUE a DB)', (mapi.match(/23505/g) ?? []).length >= 4);
t('38 mat-api: asset_add solo sotto inbox/ e con file verificato nel bucket', /path\.startsWith\('inbox\/'\)/.test(mapi) && /storage\.from\('mat-assets'\)\.list\(/.test(mapi));
t('39 mat-api: categoria e unita validate sulle liste, prezzo numerico >= 0', /CATEGORIE\.has\(categoria\)/.test(mapi) && /UNITA\.has\(/.test(mapi) && /n >= 0 \? n : 'bad'/.test(mapi));

console.log('\n== Fase 2: ai-compila (sola lettura + Gemini) ==');
t('40 ai-compila: stessa autorizzazione (getUser + @amimi.it)', /auth\.getUser\(token\)/.test(ai) && /endsWith\('@amimi\.it'\)/.test(ai));
t('41 ai-compila: flag ai_compila_enabled, OFF = state off senza chiamare Gemini', /'ai_compila_enabled'/.test(ai) && ai.indexOf("return json({ state: 'off' })") < ai.indexOf('generativelanguage.googleapis.com'));
t('42 ai-compila: scrive SOLO ai_compila_log', ![...ai.matchAll(/\.from\('([a-z_]+)'\)\.(insert|update|upsert|delete)/g)].some((m) => m[1] !== 'ai_compila_log'));
t('43 ai-compila: JSON mode (responseMimeType), temperatura 0, MAI thinkingConfig', /responseMimeType: 'application\/json'/.test(ai) && /temperature: 0/.test(ai) && !/thinkingConfig/.test(ai + PROMPT));
t('44 ai-compila: tetti (4 immagini, 4 MB, testo 2000) e timeout 25 s', /MAX_IMG = 4/.test(ai) && /4 \* 1024 \* 1024/.test(ai) && /MAX_TESTO = 2000/.test(ai) && /TIMEOUT_MS = 25000/.test(ai));
t('45 ai-compila: errore Gemini = 503 ai_failed, mai una proposta vuota', /return json\(\{ error: 'ai_failed'/.test(ai) && /ai_invalid/.test(ai));
t('46 ai-compila: immagini solo da inbox/ o dagli asset registrati', /p\.startsWith\('inbox\/'\)/.test(ai) && /from\('mat_assets'\)\.select\('path'\)/.test(ai));
t('47 prompt: Regola 1 nel prompt (numero solo se scritto, range in testo)', /SOLO se e' scritto nel documento/.test(PROMPT) && /vanno nel campo di testo fedele/.test(PROMPT));
t('48 prompt: validaOutput rifiuta prezzo con valore E testo, categoria fuori lista', /prezzo con valore E testo insieme/.test(PROMPT) && /categoria fuori lista/.test(PROMPT));
t('49 prompt.ts senza dipendenze Deno (importabile dal golden test in Node)', !/Deno\./.test(PROMPT) && !/from 'jsr:/.test(PROMPT));
t('50 config.toml: verify_jwt = false pinnato per mat-api e ai-compila', /\[functions\.mat-api\]\s*\nverify_jwt = false/.test(TOML) && /\[functions\.ai-compila\]\s*\nverify_jwt = false/.test(TOML));

console.log('\n== Fase 2: frontend ==');
t('51 matApi: scritture solo via mat-api con il token utente, mai insert/update diretti', /functions\/v1\/\$\{name\}/.test(API) && /authorization: 'Bearer ' \+ token/.test(API) && !/\.(insert|update|upsert|delete)\(/.test(noTs(API)));
t('52 matApi: upload solo sotto inbox/ nel bucket mat-assets', /`inbox\/\$\{chiKey\(chi\)\}\/\$\{day\}\/\$\{crypto\.randomUUID\(\)\}/.test(API) && /storage\.from\('mat-assets'\)\.upload/.test(API));
t('53 pagina: bottoni di scrittura gated da settings.write, Compila da settings.ai', /settings\.write && <button/.test(PAGE) && /abilitato=\{settings\.ai\}/.test(PAGE));
t('54 pagina: salvataggio solo dopo conferma umana (Conferma e salva), mai auto-save dopo Compila', /Conferma e salva/.test(PAGE) && !/onCompila[\s\S]{0,200}salva\(\)/.test(PAGE));
t('55 pagina: confidenza bassa evidenziata (mat-low) e prezzo numerico validato', /mat-low/.test(PAGE) && /\^\\d\+\(\[\.,\]\\d\+\)\?\$/.test(PAGE));
t('56 ordini: la proposta AI aggiunge SOLO varianti esistenti, le altre restano da confermare (nessuno stub automatico)', /nonTrovate\.push/.test(ORD) && !/nuovo: true, wip: false \}\]\);[\s\S]{0,80}aggiunte\+\+/.test(ORD) && /createOrderMulti\(forn, dataOrd, righe, pin, chi\)/.test(ORD));
t('57 ordini: pannello AI gated dal flag e dal login csClient', /aiOn && \(/.test(ORD) && /aiLogged/.test(ORD) && /fetchMatSettings\(\)/.test(ORD));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
