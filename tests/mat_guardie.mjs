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
t('19 matApi non importa il client anon per i dati (solo v_mat_settings)', !/from '\.\/supabase'/.test(noTs(API).replace(/fetchMatEnabled[\s\S]*?\n}\n/, '')) || (noTs(API).match(/supabase\.from\(/g) ?? []).length === 1 && /supabase\.from\('v_mat_settings'\)/.test(API));
t('20 matApi legge le viste v_mat_* via csClient', /csClient\.from\('v_mat_catalogo'\)/.test(API) && /csClient\.from\('v_mat_fornitori'\)/.test(API) && /csClient\.from\('v_mat_acquisti'\)/.test(API) && /csClient\.from\('v_mat_assets'\)/.test(API));
t('21 matApi: URL firmati dal bucket mat-assets (mai URL pubblici)', /storage\.from\('mat-assets'\)\.createSignedUrls/.test(API) && !/getPublicUrl/.test(API));
t('22 la pagina non importa il client anon e non scrive (nessun insert/update/delete)', !/lib\/supabase'/.test(PAGE) && !/\.(insert|update|delete|upsert)\(/.test(noTs(PAGE)));
t('23 login gate: la pagina mostra il login se non c\'e\' sessione csClient', /csClient\.auth\.getSession/.test(PAGE) && /signInWithPassword/.test(PAGE));
t('24 Tab materiali dichiarata e tile "Materie prime" per Ginevra', /'materiali'/.test(PEOPLE) && /label: 'Materie prime', tab: 'materiali'/.test(PEOPLE));
t('25 App: rotta #materiali e pagina gated dal flag', /#materiali/.test(APP) && /matEnabled/.test(APP));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
