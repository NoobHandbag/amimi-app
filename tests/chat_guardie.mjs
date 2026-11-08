// tests/chat_guardie.mjs: guardie di Gate 1 sul sorgente del modulo chat_ (chat del sito, Fase 1; docs/PROPOSTA_chat_sito.md
// 5.9 punto 8 e 15.1). Nessuna rete, nessun DB.
//   node tests/chat_guardie.mjs
// Perche' esiste: i default privileges dello schema public danno lettura ad anon e authenticated su ogni tabella nuova, rwU
// sulle sequenze ed EXECUTE sulle funzioni (letti in produzione l'8 novembre 2026). Una migrazione della chat che dimentica
// un REVOKE espone dati delle clienti al sito pubblico senza nessun errore. La prova viva e' tests/chat_rls.sql dopo l'apply;
// questa suite ferma il problema prima, in CI, su ogni migrazione che crea o tocca tabelle chat_.
// Regole, per ogni migrazione che crea tabelle o funzioni chat_:
//   R1 ogni tabella chat_ creata ha `enable row level security` nello stesso file
//   R2 ogni tabella chat_ creata e' in un `revoke all on ... from public, anon, authenticated`
//   R3 ogni colonna identity di una tabella chat_ ha la sua sequenza revocata (pg_get_serial_sequence + revoke on sequence)
//   R4 ogni funzione chat_ ha `set search_path` e un `revoke all on function` da public, anon e authenticated
//   R5 nessun grant ad anon o a public
//   R6 nessuna policy aperta (`using (true)`, `with check (true)`) e ogni policy e' di sola lettura del team con email_del_team
//   R7 nessuna scrittura in change_log (5.1: l'audit della chat sta in chat_eventi)
//   R8 un grant ad authenticated solo come SELECT per colonna sulle tabelle lette dal team (chat_sessioni, chat_messaggi)
// In piu': chat_sito_enabled nasce 'false' e senza sovrascrivere; tests/chat_rls.sql nomina ogni tabella chat_ creata.
// Autocontrollo: ogni regola si prova su un esempio rotto e deve scattare (una guardia mai vista scattare non e' provata).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIGR = join(ROOT, 'supabase', 'migrations');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 300) : '')); } };

const LETTE_DAL_TEAM = new Set(['chat_sessioni', 'chat_messaggi']);

// via i commenti di riga (le regole leggono solo il codice)
const senzaCommenti = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

function tabelleCreate(sql) {
  return [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(chat_[a-z_]+)\s*\(/gi)].map((m) => m[1].toLowerCase());
}

// corpo della create table: dalla parentesi aperta alla sua chiusa
function corpoTabella(sql, nome) {
  const m = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${nome}\\s*\\(`, 'i').exec(sql);
  if (!m) return '';
  let i = m.index + m[0].length, prof = 1;
  const inizio = i;
  while (i < sql.length && prof > 0) { if (sql[i] === '(') prof++; else if (sql[i] === ')') prof--; i++; }
  return sql.slice(inizio, i - 1);
}

function controlla(sqlGrezzo) {
  const sql = senzaCommenti(sqlGrezzo);
  const problemi = [];
  const tabelle = tabelleCreate(sql);
  const revoche = [...sql.matchAll(/revoke\s+all\s+on\s+(?!function|sequence)([^;]+?)\s+from\s+([^;]+);/gi)];
  for (const tab of tabelle) {
    if (!new RegExp(`alter\\s+table\\s+(?:public\\.)?${tab}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(sql)) problemi.push(`R1 ${tab}`);
    const revocata = revoche.some((r) => r[1].split(',').map((x) => x.trim().replace(/^public\./i, '').toLowerCase()).includes(tab)
      && /\bpublic\b/i.test(r[2]) && /\banon\b/i.test(r[2]) && /\bauthenticated\b/i.test(r[2]));
    if (!revocata) problemi.push(`R2 ${tab}`);
    const corpo = corpoTabella(sql, tab);
    for (const m of corpo.matchAll(/(?:^|,)\s*([a-z_]+)\s+(?:big)?int(?:eger)?\s+generated\s+(?:always|by\s+default)\s+as\s+identity/gi)) {
      const col = m[1].toLowerCase();
      const seqVista = new RegExp(`pg_get_serial_sequence\\(\\s*'public\\.${tab}'\\s*,\\s*'${col}'\\s*\\)`, 'i').test(sql);
      const revocaSeq = /revoke\s+all\s+on\s+sequence\s+%s\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(sql)
        || /revoke\s+all\s+on\s+sequence\s+[^;]+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(sql);
      if (!seqVista || !revocaSeq) problemi.push(`R3 ${tab}.${col}`);
    }
  }
  for (const f of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(chat_[a-z_]+)\s*\(([^)]*)\)([\s\S]*?)\bas\s+\$/gi)) {
    const nome = f[1].toLowerCase();
    if (!/set\s+search_path/i.test(f[3])) problemi.push(`R4 search_path ${nome}`);
    if (!new RegExp(`revoke\\s+all\\s+on\\s+function\\s+(?:public\\.)?${nome}\\s*\\([^)]*\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i').test(sql)) problemi.push(`R4 revoke ${nome}`);
  }
  for (const g of sql.matchAll(/\bgrant\s+([^;]+?)\s+to\s+([^;]+);/gi)) {
    const a = g[2].toLowerCase();
    if (/\banon\b/.test(a) || /\bpublic\b/.test(a)) problemi.push(`R5 ${g[0].replace(/\s+/g, ' ').slice(0, 80)}`);
    if (/\bauthenticated\b/.test(a)) {
      const m = /^select\s*\(([^)]*)\)\s+on\s+(?:table\s+)?(?:public\.)?([a-z_]+)$/i.exec(g[1].trim());
      const colonnaPerColonna = m && LETTE_DAL_TEAM.has(m[2].toLowerCase());
      const funzioneTeam = /^execute\s+on\s+function\s+(?:public\.)?email_del_team/i.test(g[1].trim());
      if (!colonnaPerColonna && !funzioneTeam) problemi.push(`R8 ${g[0].replace(/\s+/g, ' ').slice(0, 80)}`);
    }
  }
  if (/\b(?:using|with\s+check)\s*\(\s*true\s*\)/i.test(sql)) problemi.push('R6 policy aperta');
  for (const p of sql.matchAll(/create\s+policy\s+([a-z_]+)\s+on\s+(?:public\.)?([a-z_]+)([^;]*);/gi)) {
    const corpo = p[3];
    if (!/for\s+select\s+to\s+authenticated/i.test(corpo) || !/using\s*\(\s*\(\s*select\s+public\.email_del_team\(\s*auth\.jwt\(\)\s*->>\s*'email'\s*\)\s*\)\s*\)/i.test(corpo)
        || /with\s+check/i.test(corpo) || !LETTE_DAL_TEAM.has(p[2].toLowerCase())) {
      problemi.push(`R6 policy ${p[1]}`);
    }
  }
  if (/insert\s+into\s+(?:public\.)?change_log\b/i.test(sql)) problemi.push('R7 change_log');
  return { tabelle, problemi };
}

// 1) migrazioni vere: quelle che creano tabelle o funzioni chat_
const files = readdirSync(MIGR).filter((f) => f.endsWith('.sql')).sort();
const dellaChat = files.filter((f) => /create\s+(?:table|(?:or\s+replace\s+)?function)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?chat_/i.test(senzaCommenti(read(join(MIGR, f)))));
t('almeno una migrazione crea tabelle chat_ (0186_chat_schema.sql)', dellaChat.includes('0186_chat_schema.sql'), dellaChat);
const tutteLeTabelle = new Set();
for (const f of dellaChat) {
  const { tabelle, problemi } = controlla(read(join(MIGR, f)));
  tabelle.forEach((x) => tutteLeTabelle.add(x));
  t(`${f}: R1-R8 rispettate (${tabelle.length} tabelle chat_)`, problemi.length === 0, problemi);
}
t('0186 crea le cinque tabelle del contratto', ['chat_sessioni', 'chat_messaggi', 'chat_token', 'chat_eventi', 'chat_contatori'].every((x) => tutteLeTabelle.has(x)), [...tutteLeTabelle]);

// 2) l'interruttore nasce spento e senza sovrascrivere una scelta fatta dopo
const M0186 = senzaCommenti(read(join(MIGR, '0186_chat_schema.sql')));
t("0186: chat_sito_enabled nasce 'false'", /\(\s*'chat_sito_enabled'\s*,\s*'false'\s*\)/.test(M0186));
t('0186: i flag entrano con on conflict (key) do nothing', /insert\s+into\s+app_flags[\s\S]*?on\s+conflict\s*\(\s*key\s*\)\s+do\s+nothing/i.test(M0186));
t('0186: chat_sollecito_ore = 24,48 (D-8) e chat_limite_chat_giorno = 50 (D-12)',
  /\(\s*'chat_sollecito_ore'\s*,\s*'24,48'\s*\)/.test(M0186) && /\(\s*'chat_limite_chat_giorno'\s*,\s*'50'\s*\)/.test(M0186));
t('0186: nessuna chiave app_flags segreta (solo chat_*)', [...M0186.matchAll(/\(\s*'([a-z_]+)'\s*,/g)].filter((m) => /secret|token|key|pin/i.test(m[1]) && m[1].startsWith('chat_')).length === 0);

// 3) la prova viva copre ogni tabella creata
const RLS = read(join(ROOT, 'tests', 'chat_rls.sql'));
for (const tab of tutteLeTabelle) t(`tests/chat_rls.sql nomina public.${tab}`, RLS.includes(`public.${tab}`));
t("tests/chat_rls.sql finisce sempre in eccezione TEST_OK (rollback voluto)", /raise exception 'TEST_OK:[^']*rollback voluto\)'/.test(RLS.replace(/''/g, '')));

// 4) autocontrollo: ogni regola deve scattare su un esempio rotto
const BUONO = `create table if not exists chat_x (id bigint generated always as identity primary key, a text);
alter table chat_x enable row level security;
revoke all on chat_x from public, anon, authenticated;
do $$ begin execute format('revoke all on sequence %s from public, anon, authenticated', pg_get_serial_sequence('public.chat_x', 'id')); end $$;
create or replace function public.chat_f(p int) returns int language sql set search_path to 'public' as $f$ select 1 $f$;
revoke all on function public.chat_f(int) from public, anon, authenticated;`;
t('autocontrollo: l\'esempio buono passa', controlla(BUONO).problemi.length === 0, controlla(BUONO).problemi);
const rotti = [
  ['R1', BUONO.replace('alter table chat_x enable row level security;', '')],
  ['R2', BUONO.replace('revoke all on chat_x from public, anon, authenticated;', 'revoke all on chat_x from anon;')],
  ['R3', BUONO.replace(/do \$\$[^\n]*\n/, '')],
  ['R4 search_path', BUONO.replace("set search_path to 'public' ", '')],
  ['R4 revoke', BUONO.replace('revoke all on function public.chat_f(int) from public, anon, authenticated;', '')],
  ['R5', BUONO + '\ngrant select on chat_x to anon;'],
  ['R6', BUONO + "\ncreate policy chat_x_sel on chat_x for select to authenticated using (true);"],
  ['R6', BUONO + "\ncreate policy chat_sessioni_sel on chat_sessioni for all to authenticated using ((select public.email_del_team(auth.jwt() ->> 'email')));"],
  ['R7', BUONO + "\ninsert into change_log (tbl) values ('chat_x');"],
  ['R8', BUONO + '\ngrant select on chat_x to authenticated;'],
  ['R8', BUONO + '\ngrant update (testo) on chat_messaggi to authenticated;'],
];
for (const [regola, sql] of rotti) {
  const p = controlla(sql).problemi;
  t(`autocontrollo: ${regola} scatta sull'esempio rotto`, p.some((x) => x.startsWith(regola)), p);
}
t('autocontrollo: un commento con "grant ... to anon" non conta', controlla(BUONO + '\n-- grant select on chat_x to anon;').problemi.length === 0);

console.log(`\nchat_guardie: ${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
