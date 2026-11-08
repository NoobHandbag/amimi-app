// tests/chat_guardie.mjs: guardie di Gate 1 sul sorgente del modulo chat_ (chat del sito, Fase 1; docs/PROPOSTA_chat_sito.md
// 5.9 punto 8 e 15.1). Nessuna rete, nessun DB.
//   node tests/chat_guardie.mjs
// Perche' esiste: i default privileges dello schema public danno lettura ad anon e authenticated su ogni tabella o vista
// nuova, rwU sulle sequenze ed EXECUTE sulle funzioni (letti in produzione l'8 novembre 2026). Una migrazione che dimentica un
// REVOKE, o una vista sulle tabelle della chat senza security_invoker, espone dati delle clienti al sito pubblico senza nessun
// errore. La prova viva e' tests/chat_rls.sql dopo l'apply; questa suite ferma il problema prima, in CI.
// Quali migrazioni: ogni file che nomina una tabella, vista, sequenza o funzione `chat_` nel CODICE (commenti e letterali
// esclusi), non solo quelle che creano tabelle (Gate 2 dell'8-11, B2: un `grant ... to anon` in una migrazione successiva
// sfuggiva). Due letture del file: `nudo` (senza commenti -- e /* */ e senza letterali, anche $tag$...$tag$) per cercare
// cio' che DEVE esserci, cosi' una revoca commentata o dentro una stringa non conta; `codice` (senza commenti, letterali
// tenuti) per cio' che NON deve esserci, cosi' un grant dentro un blocco DO si vede lo stesso.
// Regole:
//   R1  ogni tabella creata (anche unlogged, nomi con cifre) ha `enable row level security`
//   R2  ogni tabella creata e' in un `revoke all on ... from public, anon, authenticated` statico
//   R3  ogni sequenza ha un nome fisso e una revoca statica: `create sequence x` e identity `(sequence name x)`; un'identity
//       senza nome fisso non passa (la revoca dinamica in un DO non si puo' controllare qui)
//   R4  ogni funzione creata, di qualunque nome, ha `set search_path` e una revoca statica da public, anon e authenticated;
//       nessuna `security definer` (se un giorno serve: elenco SECDEF_AMMESSE qui sotto, con il perche')
//   R5  nessun grant ad anon o a public, da nessuna parte del codice
//   R6  nessuna policy aperta (`using (true)`, `with check (true)`); ogni policy e' di sola lettura del team con email_del_team
//       sulle tabelle lette dal team
//   R7  nessuna scrittura in change_log (5.1: l'audit della chat sta in chat_eventi)
//   R8  grant ad authenticated solo come SELECT per colonna sulle tabelle lette dal team
//   R9  ogni vista con `security_invoker` e una revoca statica da public, anon e authenticated; nessuna vista materializzata
//   R10 nessun `disable row level security`
// In piu': chat_sito_enabled nasce 'false' e senza sovrascrivere; tests/chat_rls.sql nomina ogni tabella creata.
// Autocontrollo: ogni regola si prova su esempi rotti e deve scattare (una guardia mai vista scattare non e' provata).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIGR = join(ROOT, 'supabase', 'migrations');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra !== '' ? '  <- ' + JSON.stringify(extra).slice(0, 300) : '')); } };

const LETTE_DAL_TEAM = new Set(['chat_sessioni', 'chat_messaggi']);
const SECDEF_AMMESSE = new Set();
const ID = '[a-z_][a-z0-9_]*';

// Toglie i commenti e, se `letterali`, svuota i letterali ('...', E'...', $tag$...$tag$) lasciando ''.
function pulisci(sql, letterali) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i], d = sql[i + 1];
    if (c === '-' && d === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      let prof = 1; i += 2;
      while (i < sql.length && prof > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { prof++; i += 2; } else if (sql[i] === '*' && sql[i + 1] === '/') { prof--; i += 2; } else i++;
      }
      out += ' ';
      continue;
    }
    if (c === "'") {
      const escape = /(^|[^a-z0-9_])e$/i.test(out);
      const inizio = i;
      i++;
      while (i < sql.length) {
        if (escape && sql[i] === '\\') { i += 2; continue; }
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      out += letterali ? "''" : sql.slice(inizio, i);
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const fine = sql.indexOf(m[0], i + m[0].length);
        const stop = fine < 0 ? sql.length : fine + m[0].length;
        out += letterali ? "''" : sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out.toLowerCase();
}

// la lista di un `revoke all on [sequence|function] <lista> from <ruoli>;` contiene il nome e i ruoli sono i tre
function revocato(nudo, tipo, nome) {
  const re = new RegExp(`revoke\\s+all\\s+(?:privileges\\s+)?on\\s+${tipo ? tipo + '\\s+' : '(?!function\\b|sequence\\b)(?:table\\s+)?'}([^;]+?)\\s+from\\s+([^;]+);`, 'g');
  for (const m of nudo.matchAll(re)) {
    const nomi = m[1].split(/,(?![^(]*\))/).map((x) => x.trim().replace(/^public\./, '').replace(/\s*\(.*$/s, ''));
    const ruoli = m[2];
    if (nomi.includes(nome) && /\bpublic\b/.test(ruoli) && /\banon\b/.test(ruoli) && /\bauthenticated\b/.test(ruoli)) return true;
  }
  return false;
}

function corpoTabella(nudo, inizio) {
  let i = inizio, prof = 1;
  while (i < nudo.length && prof > 0) { if (nudo[i] === '(') prof++; else if (nudo[i] === ')') prof--; i++; }
  return nudo.slice(inizio, i - 1);
}

function controlla(sqlGrezzo) {
  const nudo = pulisci(sqlGrezzo, true);
  const codice = pulisci(sqlGrezzo, false);
  const problemi = [];
  const tabelle = [];
  for (const m of nudo.matchAll(new RegExp(`create\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?(${ID})\\s*\\(`, 'g'))) {
    const tab = m[1];
    tabelle.push(tab);
    if (!new RegExp(`alter\\s+table\\s+(?:only\\s+)?(?:public\\.)?${tab}\\s+enable\\s+row\\s+level\\s+security`).test(nudo)) problemi.push(`R1 ${tab}`);
    if (!revocato(nudo, '', tab)) problemi.push(`R2 ${tab}`);
    const corpo = corpoTabella(nudo, m.index + m[0].length);
    for (const idm of corpo.matchAll(new RegExp(`(?:^|,)\\s*(${ID})\\s+[a-z]+\\s+generated\\s+(?:always|by\\s+default)\\s+as\\s+identity(\\s*\\(([^)]*)\\))?`, 'g'))) {
      const nomeSeq = /sequence\s+name\s+(?:public\.)?([a-z_][a-z0-9_]*)/.exec(idm[3] ?? '')?.[1];
      if (!nomeSeq) problemi.push(`R3 ${tab}.${idm[1]} identity senza sequence name`);
      else if (!revocato(nudo, 'sequence', nomeSeq)) problemi.push(`R3 ${nomeSeq}`);
    }
  }
  for (const m of nudo.matchAll(new RegExp(`create\\s+sequence\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?(${ID})`, 'g'))) {
    if (!revocato(nudo, 'sequence', m[1])) problemi.push(`R3 ${m[1]}`);
  }
  for (const f of nudo.matchAll(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?(${ID})\\s*\\(([^)]*)\\)([\\s\\S]*?)\\bas\\s+''`, 'g'))) {
    const nome = f[1];
    if (!/set\s+search_path/.test(f[3])) problemi.push(`R4 search_path ${nome}`);
    if (/security\s+definer/.test(f[3]) && !SECDEF_AMMESSE.has(nome)) problemi.push(`R4 security definer ${nome}`);
    if (!revocato(nudo, 'function', nome)) problemi.push(`R4 revoke ${nome}`);
  }
  for (const v of nudo.matchAll(new RegExp(`create\\s+(?:or\\s+replace\\s+)?(materialized\\s+)?view\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?(${ID})([^;]*?)\\bas\\b`, 'g'))) {
    const nome = v[2];
    if (v[1]) { problemi.push(`R9 materialized ${nome}`); continue; }
    if (!/with\s*\([^)]*security_invoker\s*=\s*(?:true|on|''|1)/.test(v[3])) problemi.push(`R9 security_invoker ${nome}`);
    if (!revocato(nudo, '', nome)) problemi.push(`R9 revoke ${nome}`);
  }
  for (const g of codice.matchAll(/\bgrant\s+([^;]+?)\s+to\s+([^;]+?)(?:\s+with\s+grant\s+option)?\s*;/g)) {
    const a = g[2];
    if (/\banon\b/.test(a) || /\bpublic\b/.test(a)) problemi.push(`R5 ${g[0].replace(/\s+/g, ' ').slice(0, 80)}`);
    if (/\bauthenticated\b/.test(a)) {
      const m = /^select\s*\(([^)]*)\)\s+on\s+(?:table\s+)?(?:public\.)?([a-z_][a-z0-9_]*)$/.exec(g[1].trim());
      if (!(m && LETTE_DAL_TEAM.has(m[2]))) problemi.push(`R8 ${g[0].replace(/\s+/g, ' ').slice(0, 80)}`);
    }
  }
  if (/\b(?:using|with\s+check)\s*\(\s*\(?\s*true\s*\)?\s*\)/.test(codice)) problemi.push('R6 policy aperta');
  for (const p of codice.matchAll(new RegExp(`create\\s+policy\\s+("?[^\\s"]+"?)\\s+on\\s+(?:public\\.)?(${ID})([^;]*);`, 'g'))) {
    const corpo = p[3];
    if (!/^\s*(?:as\s+permissive\s+)?for\s+select\s+to\s+authenticated\s+using\s*\(\s*\(\s*select\s+public\.email_del_team\(\s*auth\.jwt\(\)\s*->>\s*'email'\s*\)\s*\)\s*\)\s*$/.test(corpo)
        || !LETTE_DAL_TEAM.has(p[2])) {
      problemi.push(`R6 policy ${p[1]}`);
    }
  }
  if (/insert\s+into\s+(?:public\.)?change_log\b/.test(codice)) problemi.push('R7 change_log');
  if (/disable\s+row\s+level\s+security/.test(codice)) problemi.push('R10 disable rls');
  return { tabelle, problemi };
}

const nominaLaChat = (sql) => /\bchat_[a-z0-9_]+/.test(pulisci(sql, true));

// 1) migrazioni vere: ogni file che nomina la chat nel codice
const files = readdirSync(MIGR).filter((f) => f.endsWith('.sql')).sort();
const dellaChat = files.filter((f) => nominaLaChat(read(join(MIGR, f))));
t('le migrazioni della chat sono trovate (0186_chat_schema.sql compresa)', dellaChat.includes('0186_chat_schema.sql'), dellaChat);
t('nessuna migrazione prima della 0186 nomina la chat nel codice', dellaChat.every((f) => f >= '0186'), dellaChat);
const tutteLeTabelle = new Set();
for (const f of dellaChat) {
  const { tabelle, problemi } = controlla(read(join(MIGR, f)));
  tabelle.forEach((x) => tutteLeTabelle.add(x));
  t(`${f}: R1-R10 rispettate (${tabelle.length} tabelle create)`, problemi.length === 0, problemi);
}
t('0186 crea le cinque tabelle del contratto', ['chat_sessioni', 'chat_messaggi', 'chat_token', 'chat_eventi', 'chat_contatori'].every((x) => tutteLeTabelle.has(x)), [...tutteLeTabelle]);

// 2) l'interruttore nasce spento e senza sovrascrivere una scelta fatta dopo (si legge col codice, letterali tenuti)
const M0186 = pulisci(read(join(MIGR, '0186_chat_schema.sql')), false);
t("0186: chat_sito_enabled nasce 'false'", /\(\s*'chat_sito_enabled'\s*,\s*'false'\s*\)/.test(M0186));
t('0186: i flag entrano con on conflict (key) do nothing', /insert\s+into\s+app_flags[\s\S]*?on\s+conflict\s*\(\s*key\s*\)\s+do\s+nothing/.test(M0186));
t('0186: chat_sollecito_ore = 24,48 (D-8) e chat_limite_chat_giorno = 50 (D-12)',
  /\(\s*'chat_sollecito_ore'\s*,\s*'24,48'\s*\)/.test(M0186) && /\(\s*'chat_limite_chat_giorno'\s*,\s*'50'\s*\)/.test(M0186));
t('0186: nessuna chiave chat_ di app_flags che sembri un segreto', [...M0186.matchAll(/\(\s*'(chat_[a-z_]+)'\s*,/g)].every((m) => !/secret|token|key|pin|password/.test(m[1])));
t('0186: seq dei messaggi assegnato dal trigger dopo il lock della sessione (B3)',
  /perform\s+1\s+from\s+chat_sessioni\s+where\s+id\s*=\s*new\.sessione_id\s+for\s+update\s*;\s*new\.seq\s*:=\s*nextval\(/.test(M0186)
  && /create\s+trigger\s+chat_messaggi_ordina\s+before\s+insert\s+on\s+chat_messaggi\s+for\s+each\s+row/.test(M0186));

// 3) la prova viva copre ogni tabella creata
const RLS = read(join(ROOT, 'tests', 'chat_rls.sql'));
for (const tab of tutteLeTabelle) t(`tests/chat_rls.sql nomina public.${tab}`, RLS.includes(`public.${tab}`));
t("tests/chat_rls.sql finisce sempre in eccezione TEST_OK (rollback voluto)", /raise exception 'TEST_OK:[^']*rollback voluto\)'/.test(RLS.replace(/''/g, '')));

// 4) autocontrollo: l'esempio buono passa, ogni esempio rotto fa scattare la sua regola
const BUONO = `create table if not exists chat_x (id bigint generated always as identity (sequence name chat_x_id_sq) primary key, a text);
create sequence if not exists chat_y_sq;
alter table chat_x enable row level security;
revoke all on chat_x from public, anon, authenticated;
revoke all on sequence chat_x_id_sq, chat_y_sq from public, anon, authenticated;
create or replace function public.chat_f(p int) returns int language sql set search_path to 'public' as $f$ select 1 $f$;
revoke all on function public.chat_f(int) from public, anon, authenticated;
create view v_chat_x with (security_invoker = true) as select a from chat_x;
revoke all on v_chat_x from public, anon, authenticated;
grant select (id, testo) on chat_messaggi to authenticated;
create policy chat_messaggi_sel on chat_messaggi for select to authenticated using ((select public.email_del_team(auth.jwt() ->> 'email')));`;
t("autocontrollo: l'esempio buono passa", controlla(BUONO).problemi.length === 0, controlla(BUONO).problemi);
const rotti = [
  ['R1', BUONO.replace('alter table chat_x enable row level security;', '')],
  ['R2', BUONO.replace('revoke all on chat_x from public, anon, authenticated;', 'revoke all on chat_x from anon;')],
  ['R2', BUONO.replace('revoke all on chat_x from public, anon, authenticated;', '/* revoke all on chat_x from public, anon, authenticated; */')],
  ['R2', BUONO.replace('revoke all on chat_x from public, anon, authenticated;', "do $$ begin execute 'revoke all on chat_x from public, anon, authenticated;'; end $$;")],
  ['R1', BUONO + '\ncreate unlogged table chat_log2 (a int);\nrevoke all on chat_log2 from public, anon, authenticated;'],
  ['R2', BUONO + '\ncreate table chat_log2 (a int);\nalter table chat_log2 enable row level security;'],
  ['R3', BUONO.replace(' (sequence name chat_x_id_sq)', '')],
  ['R3', BUONO.replace('revoke all on sequence chat_x_id_sq, chat_y_sq', 'revoke all on sequence chat_x_id_sq')],
  ['R4 search_path', BUONO.replace("set search_path to 'public' ", '')],
  ['R4 revoke', BUONO.replace('revoke all on function public.chat_f(int) from public, anon, authenticated;', '')],
  ['R4 security definer', BUONO + "\ncreate function public.proietta(p int) returns int language sql security definer set search_path to 'public' as $f$ select 1 $f$;\nrevoke all on function public.proietta(int) from public, anon, authenticated;"],
  ['R4 revoke', BUONO + "\ncreate function public.proietta(p int) returns int language sql set search_path to 'public' as $f$ select 1 $f$;"],
  ['R5', BUONO + '\ngrant select on chat_x to anon;'],
  ['R5', BUONO + "\ndo $$ begin execute 'grant select on chat_x to anon;'; end $$;"],
  ['R6', BUONO + '\ncreate policy chat_x_sel on chat_x for select to authenticated using (true);'],
  ['R6', BUONO + "\ncreate policy chat_sessioni_tutto on chat_sessioni for all to authenticated using ((select public.email_del_team(auth.jwt() ->> 'email')));"],
  ['R7', BUONO + "\ninsert into change_log (tbl) values ('chat_x');"],
  ['R8', BUONO + '\ngrant select on chat_x to authenticated;'],
  ['R8', BUONO + '\ngrant update (testo) on chat_messaggi to authenticated;'],
  ['R9 security_invoker', BUONO.replace(' with (security_invoker = true)', '')],
  ['R9 revoke', BUONO.replace('revoke all on v_chat_x from public, anon, authenticated;', '')],
  ['R9 materialized', BUONO + '\ncreate materialized view v_chat_m as select 1 from chat_x;'],
  ['R10', BUONO + '\nalter table chat_x disable row level security;'],
];
for (const [regola, sql] of rotti) {
  const p = controlla(sql).problemi;
  t(`autocontrollo: ${regola} scatta (${p.join('; ').slice(0, 70)})`, p.some((x) => x.startsWith(regola)), p);
}
t('autocontrollo: un commento con "grant ... to anon" non conta', controlla(BUONO + '\n-- grant select on chat_x to anon;\n/* grant select on chat_x to anon; */').problemi.length === 0);
t('autocontrollo: una migrazione che fa solo un grant su chat_ viene letta', nominaLaChat('grant select on chat_messaggi to anon;') && controlla('grant select on chat_messaggi to anon;').problemi.some((x) => x.startsWith('R5')));
t('autocontrollo: una stringa che nomina chat_ non basta a far leggere un file', !nominaLaChat("select 'chat_notifica'; -- chat_x\n/* chat_y */"));

console.log(`\nchat_guardie: ${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
