// tests/dominio_team.mjs: chi entra nelle sezioni col login (migr 0161). I domini del team sono UNA lista ripetuta in tre
// posti che devono coincidere: public.email_del_team (RLS cs_*/lead_*/mat_*, storage, loyalty_staff_email,
// loyalty_dashboard), EMAIL_TEAM nelle sette edge che fanno getUser (push-api dal 17-10), DOMINI_TEAM nel web (solo testi del login).
//   node tests/dominio_team.mjs
// Pinna anche il contrario: le regole sulle NOSTRE caselle (destinatari bloccati, mittenti "nostri") restano @amimi.it.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const noSql = (s) => s.replace(/^\s*--[^\n]*$/gm, '');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const domini = (alt) => alt.split('|').map((d) => d.replace(/\\\./g, '.'));

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 200) : '')); } };

const M = read('supabase/migrations/0161_dominio_team.sql');
const Mc = noSql(M);
const M147 = read('supabase/migrations/0147_loyalty_dashboard_gate2.sql');
const CLIENT = read('web/src/lib/csClient.ts');
const EDGE = ['ai-compila', 'cs-api', 'cs-assist', 'cs-send', 'lead-outreach', 'mat-api', 'push-api'];

console.log('\n== Una lista sola ==');
const sqlM = Mc.match(/lower\(p_email\) ~ '@\(([^)]+)\)\$'/);
const SQL = sqlM ? domini(sqlM[1]) : [];
t('1  SQL: email_del_team ammette amimi.it e telaioconsulting.com', same(SQL, ['amimi.it', 'telaioconsulting.com']), SQL);
const webM = CLIENT.match(/export const DOMINI_TEAM = \[([^\]]*)\];/);
const WEB = webM ? [...webM[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
t('2  web: DOMINI_TEAM = lista SQL', same(WEB, SQL), WEB);
t('3  web: il testo del login viene dalla lista', /export const EMAIL_TEAM_TESTO = DOMINI_TEAM\.map\(\(d\) => '@' \+ d\)\.join\(' o '\);/.test(CLIENT));

const edgeRe = {};
for (const e of EDGE) {
  const s = read(`supabase/functions/${e}/index.ts`);
  const m = s.match(/\nconst EMAIL_TEAM = \/@\(\?:([^)]+)\)\$\/;\n/);
  const d = m ? domini(m[1]) : [];
  if (m) edgeRe[e] = new RegExp(`@(?:${m[1]})$`);
  t(`4  ${e}: EMAIL_TEAM = lista SQL`, same(d, SQL), d);
  const gates = s.match(/if \(!EMAIL_TEAM\.test\((?:email|userEmail)\)\) return json\(\{ error: 'dominio non ammesso' \}, 403\);/g) ?? [];
  t(`5  ${e}: un solo cancello e passa da EMAIL_TEAM; nessun cancello @amimi.it rimasto`, gates.length === 1 && !/endsWith\('@amimi\.it'\)\) return json\(\{ error: 'dominio non ammesso'/.test(s), gates.length);
  t(`6  ${e}: l'email del cancello e' quella di getUser, in minuscolo (la regex non ha il flag i)`, /(?:email|userEmail) = \((?:user|ures\??\.user\??)\.email \|\| ''\)\.toLowerCase\(\);/.test(s));
}
const altre = readdirSync(ROOT + 'supabase/functions', { withFileTypes: true }).filter((d) => d.isDirectory() && !EDGE.includes(d.name)).map((d) => d.name)
  .filter((n) => { try { return /dominio non ammesso/.test(read(`supabase/functions/${n}/index.ts`)); } catch { return false; } });
t('7  nessun\'altra edge ha un cancello di dominio fuori dall\'elenco', altre.length === 0, altre.join(','));

console.log('\n== Stessi casi in SQL e nelle edge ==');
const CASI = [
  ['info@amimi.it', true], ['chiunque@telaioconsulting.com', true], ['x@telaioconsulting.com', true],
  ['x@amimi.it.evil.com', false], ['x@sub.amimi.it', false], ['x@telaioconsulting.com.it', false],
  ['x@evil-telaioconsulting.com', false], ['amimi.it', false], ['x@gmail.com', false], ['', false],
];
const sqlJs = new RegExp(`@(${SQL.map((d) => d.replace(/\./g, '\\.')).join('|')})$`);
t('8  la regex SQL (tradotta) da\' i risultati attesi', CASI.every(([e, v]) => sqlJs.test(e) === v), CASI.filter(([e, v]) => sqlJs.test(e) !== v).map((c) => c[0]));
for (const e of EDGE) t(`9  ${e}: la regex da\' i risultati attesi`, !!edgeRe[e] && CASI.every(([x, v]) => edgeRe[e].test(x) === v));
t('10 la prova dentro la 0161 controlla gli stessi indirizzi (piu\' maiuscole e null)',
  ['Info@Amimi.it', 'chiunque@telaioconsulting.com', 'X@TelaioConsulting.COM', 'x@amimi.it.evil.com', 'x@sub.amimi.it', 'x@telaioconsulting.com.it', 'x@evil-telaioconsulting.com', "email_del_team('amimi.it')", 'x@gmail.com', "email_del_team('')", 'email_del_team(null)'].every((c) => Mc.includes(c)));

console.log('\n== Migrazione 0161 ==');
t('11 email_del_team: immutable, search_path vuoto, mai ad anon', /create or replace function public\.email_del_team\(p_email text\) returns boolean\nlanguage sql immutable set search_path to '' as \$\$/.test(Mc)
  && /revoke all on function public\.email_del_team\(text\) from public, anon;/.test(Mc) && /grant execute on function public\.email_del_team\(text\) to authenticated, service_role;/.test(Mc));
const GATE = "(select public.email_del_team(auth.jwt() ->> 'email'))";
const POLICY = ['cs_conv_sel', 'cs_drf_sel', 'cs_evt_sel', 'cs_faq_sel', 'cs_msg_sel', 'lead_accounts_sel', 'lead_contacts_sel', 'lead_drafts_sel', 'lead_evidence_sel',
  'lead_inbound_esiti_sel', 'lead_knowledge_sel', 'lead_reviews_sel', 'lead_runs_sel', 'lead_scores_sel', 'lead_sequences_sel', 'lead_touches_sel', 'mat_assets_sel',
  'mat_items_sel', 'mat_offers_sel', 'mat_order_lines_sel', 'mat_orders_sel', 'mat_suppliers_sel', 'lead_reviews_ins', 'lead_touches_ins', 'lead_assets_sel', 'mat_assets_sel', 'mat_assets_ins'];
const alters = [...Mc.matchAll(/^alter policy (\w+) on ([\w.]+) (using|with check) \((.*)\);$/gm)];
t('12 27 alter policy, tutte e sole quelle col dominio scritto a mano (elenco letto in prod il 16-10)', alters.length === 27 && same(alters.map((a) => a[1]), POLICY), alters.map((a) => a[1]).join(','));
t('13 ogni policy chiama email_del_team una volta, in una select (initplan, non per riga)', alters.every((a) => a[4].split(GATE).length === 2));
t('14 le policy insert restano with check, quelle select using', alters.every((a) => (a[1].endsWith('_ins') ? a[3] === 'with check' : a[3] === 'using')));
t('15 storage: il bucket resta nella condizione, e mat-assets scrive solo sotto inbox/',
  alters.filter((a) => a[2] === 'storage.objects').every((a) => a[4].startsWith(`bucket_id = '${a[1].startsWith('lead') ? 'lead-assets' : 'mat-assets'}' and `)) && /mat_assets_ins on storage\.objects with check \(.* and name like 'inbox\/%'\);/.test(Mc));
t('16 nessun ilike sul dominio nel codice della 0161 (solo nei commenti)', !/ilike '%@amimi\.it'/.test(Mc));
t('17 loyalty_staff_email: id del token, email confermata, security definer (Gate 2 del 12-10); cambia solo la lista',
  /create or replace function public\.loyalty_staff_email\(\) returns text\nlanguage sql stable security definer set search_path to '' as \$\$\n {2}select u\.email::text from auth\.users u\n {2}where u\.id = auth\.uid\(\) and u\.email_confirmed_at is not null and public\.email_del_team\(u\.email\)\n\$\$;/.test(Mc));
const fnDash = (s) => { const i = s.indexOf('create or replace function public.loyalty_dashboard('); return s.slice(i, s.indexOf('\nend $$;\n', i) + 9); };
const atteso = fnDash(M147)
  .replace("  if v_email not ilike '%@amimi.it' then\n", '  if not public.email_del_team(v_email) then\n')
  .replace("riservato agli account @amimi.it'", "riservato agli account del team'");
t('18 loyalty_dashboard: corpo della 0147 identico, cambia solo il cancello', fnDash(M) === atteso && atteso !== fnDash(M147));
t('19 loyalty_dashboard: grant rimessi come nella 0147', /revoke all on function public\.loyalty_dashboard\(integer\) from anon, public;\ngrant execute on function public\.loyalty_dashboard\(integer\) to authenticated;/.test(Mc));
t('20 la 0161 si ferma da sola se resta una policy col dominio o se le policy non sono 27',
  /ilike '%amimi\.it%'\) then\n\s+raise exception '0161: resta una policy/.test(Mc) && /if n <> 27 then raise exception/.test(Mc) && /has_function_privilege\('anon', 'public\.email_del_team\(text\)', 'execute'\)/.test(Mc));

console.log('\n== Web ==');
const WEBF = ['pages/Assistenza.tsx', 'pages/Materiali.tsx', 'pages/Negozi.tsx', 'pages/Premia.tsx', 'pages/PremiaUgc.tsx', 'components/FoglioOrdine.tsx', 'components/SupplierOrderForm.tsx', 'lib/premiaApi.ts',
  'pages/Comportamento.tsx', 'lib/behApi.ts'];
const W = Object.fromEntries(WEBF.map((f) => [f, read('web/src/' + f).replace(/^\s*\/\/[^\n]*$/gm, '')]));
const oauth = ['pages/Assistenza.tsx', 'pages/Materiali.tsx', 'pages/Negozi.tsx', 'pages/Premia.tsx', 'pages/Comportamento.tsx'];
t('21 login Google senza hd (con hd=amimi.it Google nasconde gli account Telaio)', oauth.every((f) => /queryParams: \{ prompt: 'select_account' \}/.test(W[f])) && !Object.values(W).some((s) => /\bhd:/.test(s)));
t('22 nessuna etichetta o avviso del login dice ancora solo @amimi.it', !Object.values(W).some((s) => /Email \(@amimi\.it\)|qualsiasi casella @amimi\.it|login @amimi\.it|account @amimi\.it|Email @amimi\.it/.test(s)));
t('23 le etichette usano EMAIL_TEAM_TESTO', oauth.every((f) => W[f].includes('<label>Email ({EMAIL_TEAM_TESTO})</label>')) && (W['lib/premiaApi.ts'].match(/Sezione riservata agli account \$\{EMAIL_TEAM_TESTO\}\./g) ?? []).length === 2
  && (W['lib/behApi.ts'].match(/Sezione riservata agli account \$\{EMAIL_TEAM_TESTO\}\./g) ?? []).length === 1);

console.log('\n== Un indirizzo del team non riceve mai un invio vero (Gate 2 del 16-10) ==');
const CSSEND = read('supabase/functions/cs-send/index.ts'), LEAD = read('supabase/functions/lead-outreach/index.ts');
const CSSYNC = read('supabase/functions/cs-sync/index.ts'), LEADAPI = read('web/src/lib/leadApi.ts');
const codice = (s) => s.replace(/^\s*\/\/[^\n]*$/gm, '');
t('24 cs-send: un destinatario del team blocca l\'invio al cliente', /if \(EMAIL_TEAM\.test\(to\)\) return blocco\(/.test(CSSEND) && !/to\.endsWith\('@amimi\.it'\)/.test(CSSEND));
t('25 lead-outreach: invio e risposta a un indirizzo del team bloccati (dentro il blocco PURE:lead-guard, con la costante)',
  (LEAD.match(/else if \(EMAIL_TEAM\.test\(to\)\) b\.push\(/g) ?? []).length === 2 && !/to\.endsWith\('@amimi\.it'\)/.test(LEAD)
  && LEAD.indexOf('const EMAIL_TEAM') > LEAD.indexOf('// ==== PURE:lead-guard BEGIN ====') && LEAD.indexOf('const EMAIL_TEAM') < LEAD.indexOf('// ==== PURE:lead-guard END ===='));
t('26 web: indirizzoInterno dalla lista del team', /import \{ csClient, DOMINI_TEAM \} from '\.\/csClient';/.test(LEADAPI) && /export const indirizzoInterno = \(to: string\): boolean => DOMINI_TEAM\.some\(\(d\) => to\.trim\(\)\.toLowerCase\(\)\.endsWith\('@' \+ d\)\);/.test(LEADAPI));
const conti = { 'ai-compila': 2, 'cs-api': 2, 'cs-assist': 2, 'cs-send': 3, 'lead-outreach': 4, 'mat-api': 2, 'push-api': 2 };
t('27 EMAIL_TEAM solo nel cancello e nei blocchi sui destinatari (dichiarazione + usi contati)', EDGE.every((e) => (codice(read(`supabase/functions/${e}/index.ts`)).match(/EMAIL_TEAM/g) ?? []).length === conti[e]),
  EDGE.map((e) => e + '=' + (codice(read(`supabase/functions/${e}/index.ts`)).match(/EMAIL_TEAM/g) ?? []).length).join(' '));

console.log('\n== I mittenti "nostri" restano @amimi.it (le caselle Gmail sono di Amimi) ==');
t('28 lead-outreach: i messaggi da @amimi.it non sono risposte del negozio', /indirizzoDi\(from\)\.endsWith\('@amimi\.it'\)\) continue/.test(LEAD) && /indirizzoDi\(da\)\.endsWith\('@amimi\.it'\)\) continue/.test(LEAD));
t('29 cs-sync: "nostro" = @amimi.it', /const isAmimi = \(e: string\) => e\.endsWith\('@amimi\.it'\);/.test(CSSYNC));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
