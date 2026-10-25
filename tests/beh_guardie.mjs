// tests/beh_guardie.mjs: guardie sul SORGENTE del modulo beh_* (comportamento utenti, migr 0169, edge beh-sync)
//   node tests/beh_guardie.mjs
//
// Pinnano cio' che rende beh_* un modulo (Regola Ferrea 19: prefisso proprio, core solo in lettura, flag OFF,
// rollback a flag) e le regole della Regola 20 (letture con error controllato, upsert sulla PK, tetto per giro).
// Le guardie di additivita' e di accesso leggono il testo con gli spazi normalizzati e hanno autoprove negative
// (mutazioni applicate in memoria che devono farle diventare rosse), come letture_controllate_guardie.mjs: la Gate 2
// del 25-10 aveva mostrato che le prime versioni passavano a vuoto su grant, viste, rpc e catene su piu' righe.
// La logica pura del passo ordini (classi delle sorgenti, landing, canale, date di Roma, testo sicuro per PostgREST)
// e' ritagliata dal sorgente (blocco PURE:beh-ordini) e provata qui su casi reali del 25-10-2026: se il codice
// cambia, il test rompe. Nessuna rete.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const M = read('supabase/migrations/0169_beh_schema.sql');
const M170 = read('supabase/migrations/0170_beh_meta.sql');
const M171 = read('supabase/migrations/0171_beh_dashboard.sql');
const SRC = read('supabase/functions/beh-sync/index.ts');
const RLS = read('tests/beh_rls.sql');
const noSql = (s) => s.replace(/--[^\n]*/g, '');
const noTs = (s) => s.replace(/^\s*\/\/[^\n]*$/gm, '');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 200) : '')); } };

// --- additivita' della migrazione: ogni oggetto toccato e' del modulo; del core solo gli insert ammessi ---
const isMod = (x) => /^(public\.)?(v_)?beh_\w+$/.test(x);
const migViolations = (m) => {
  const s = noSql(m).replace(/\s+/g, ' ').toLowerCase();
  const v = [];
  for (const r of s.matchAll(/\bcreate (?:or replace )?(?:unique )?(materialized view|table|view|function|index|trigger|policy|type|sequence)(?: if not exists)? ([\w.]+)(?: on ([\w.]+))?/g)) {
    if (!isMod(r[2])) v.push(`create ${r[1]} ${r[2]}`);
    if (r[3] && !isMod(r[3])) v.push(`create ${r[1]} on ${r[3]}`);
  }
  for (const r of s.matchAll(/\bcreate (?:or replace )?(?:constraint )?trigger [\w.]+ [^;]*?\bon ([\w.]+)/g)) if (!isMod(r[1])) v.push(`trigger su ${r[1]}`);
  for (const r of s.matchAll(/\b(alter|drop) (materialized view|table|view|function|index|trigger|policy|type|sequence)(?: if (?:not )?exists)? (?:only )?([\w.]+)/g)) if (!isMod(r[3])) v.push(`${r[1]} ${r[2]} ${r[3]}`);
  for (const r of s.matchAll(/\b(?:grant|revoke) [^;]*? on ([^;]*?) (?:to|from) /g)) {
    for (const x of r[1].replace(/\([^)]*\)/g, '').split(',')) {
      const n = x.trim().replace(/^(table|function|sequence) /, '');
      if (!isMod(n)) v.push(`grant/revoke su ${n}`);
    }
  }
  const core = ['app_flags', 'change_log', 'health_log'];
  for (const r of s.matchAll(/\binsert into ([\w.]+)/g)) if (!(isMod(r[1]) || core.includes(r[1].replace(/^public\./, '')))) v.push(`insert in ${r[1]}`);
  for (const r of s.matchAll(/(?<!do )\bupdate ([\w.]+)/g)) if (!isMod(r[1])) v.push(`update ${r[1]}`);
  for (const r of s.matchAll(/\bdelete from ([\w.]+)/g)) if (!isMod(r[1])) v.push(`delete ${r[1]}`);
  for (const r of s.matchAll(/\btruncate (?:table )?([\w.]+)/g)) if (!isMod(r[1])) v.push(`truncate ${r[1]}`);
  const stmts = s.split(';');
  for (const st of stmts.filter((x) => /\binsert into (public\.)?app_flags\b/.test(x))) {
    const keys = [...st.matchAll(/\( ?'(\w+)',/g)].map((x) => x[1]);
    if (!keys.length || !keys.every((k) => k.startsWith('beh_'))) v.push(`app_flags chiavi ${keys}`);
    if (!/on conflict \(key\) do nothing ?$/.test(st)) v.push('app_flags senza on conflict do nothing');
  }
  for (const st of stmts.filter((x) => /\binsert into (public\.)?health_log\b/.test(x))) {
    const lits = [...st.matchAll(/'([a-z][a-z0-9_]*)'/g)].map((x) => x[1]).filter((x) => !['ok', 'warn', 'error'].includes(x));
    if (!lits.length || !lits.every((k) => k.startsWith('beh_'))) v.push(`health_log chiavi ${lits}`);
  }
  for (const st of stmts.filter((x) => /\binsert into (public\.)?change_log\b/.test(x))) if (!/'cron_create'/.test(st)) v.push('change_log diverso da cron_create');
  for (const r of s.matchAll(/cron\.schedule\( ?'([\w-]+)'/g)) if (!r[1].startsWith('beh-')) v.push(`cron ${r[1]}`);
  if (/cron\.(unschedule|alter_job)\(/.test(s)) v.push('cron.unschedule o cron.alter_job');
  return v;
};
const cronGate = (m, job = 'beh-sync-ordini', sched = '19 6') => new RegExp(`select cron\\.schedule\\('${job}', '${sched} \\* \\* \\*',\\s*\\$cmd\\$ select net\\.http_post\\([\\s\\S]*?\\) where exists \\(select 1 from public\\.app_flags where key = 'beh_enabled' and lower\\(btrim\\(value, E' \\\\t\\\\r\\\\n'\\)\\) = 'true'\\) \\$cmd\\$\\);`).test(m);

console.log('\n== Modulo additivo (Regola 19): migrazione 0169 ==');
{
  const sql = noSql(M);
  const tables = [...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
  const viol = migViolations(M);
  t('1  oggetti creati, alterati, concessi o revocati: solo beh_* e v_beh_*; core solo con gli insert ammessi', viol.length === 0, viol.join(' | '));
  const injM = (x) => M.replace('\ncommit;', `\n${x}\ncommit;`);
  const MUT_M = [
    ['grant su tabella core', 'grant select on shopify_orders to anon;'],
    ['tabella fuori prefisso', 'create table shopify_orders_extra (id int);'],
    ['funzione core ridefinita', 'create or replace function refresh_health_log() returns void language sql as $$ select 1 $$;'],
    ['vista core ridefinita', 'create or replace view v_inventory as select 1;'],
    ['flag di un altro modulo acceso', "insert into app_flags (key,value) values ('loyalty_redeem_enabled','true') on conflict (key) do update set value = excluded.value;"],
    ['chiave health_log di un altro modulo (forma select)', "insert into health_log (day, k, label, n, severity) select current_date, 'ce_drift', 'prova', 1, 'error';"],
    ['cron di un altro modulo', "select cron.schedule('ce-guard', '30 * * * *', $cmd$ select 1 $cmd$);"],
    ['update di una tabella core', 'update shopify_orders set x = 1;'],
  ];
  for (const [nome, mut] of MUT_M) {
    const mm = injM(mut);
    t(`1. autoprova: "${nome}" fa diventare rossa la guardia 1`, mm !== M && migViolations(mm).length > 0);
  }
  t('2  beh_enabled nasce false', /insert into app_flags \(key, value\) values \('beh_enabled', 'false'\) on conflict \(key\) do nothing/.test(M));
  t('3  RLS accesa e REVOKE a public, anon, authenticated su ogni tabella', tables.length >= 2 && tables.every((x) => new RegExp(`alter table ${x} enable row level security`).test(M)) && /revoke all on beh_sync_runs, beh_order_origin from public, anon, authenticated/.test(M));
  t('4  v_beh_settings espone SOLO beh_enabled, security_barrier, solo SELECT', /create or replace view v_beh_settings with \(security_barrier = true\) as\nselect key, value from app_flags where key in \('beh_enabled'\);\nrevoke all on v_beh_settings from public, anon, authenticated;\ngrant select on v_beh_settings to anon, authenticated;/.test(M));
  const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
  t('5  ogni funzione revocata ad anon e authenticated', fns.length >= 2 && fns.every((f) => new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`).test(M)), fns.join(','));
  t('6  a modulo spento beh_health_check non scrive niente', /if not exists \(select 1 from app_flags where key = 'beh_enabled' and lower\(btrim\(value, E' \\t\\r\\n'\)\) = 'true'\) then\n    return;/.test(M));
  t('7  a modulo spento il cron non chiama la edge (cancello nel comando)', cronGate(M));
  t('7. autoprova: senza il cancello la guardia 7 e\' rossa', !cronGate(M.replace(/ where exists \(select 1 from public\.app_flags where key = 'beh_enabled'[^$]*\$cmd\$/, ' $cmd$')));
  t('8  soglie con controllo di formato e al massimo 4 cifre intere (mai value::int nudo)', !/value::(int|numeric)/.test(sql) && /\^\[0-9\]\{1,4\}\(\\\.\[0-9\]\+\)\?\$/.test(M));
  t('9  passi letti come la edge: trim di spazi, tab e a capo, minuscole', /array_agg\(lower\(btrim\(x, E' \\t\\r\\n'\)\)\) filter \(where btrim\(x, E' \\t\\r\\n'\) <> ''\)/.test(M));
  t('10 beh_fresh conta solo i giri del cron (un backfill non copre un cron fermo)', /from beh_sync_runs r where r\.step = v_s and r\.action = 'run' and r\.status in \('ok', 'warn'\)/.test(M));
  t('11 guasto con soglia almeno 1 (soglia 0 non accende l\'error senza ordini)', (M.match(/v_n >= greatest\(v_guasto_min, 1\) and v_trk = 0/g) ?? []).length === 2);
  t('12 cron con timeout 60 s e change_log cron_create', /'beh-sync-ordini', '19 6 \* \* \*'/.test(M) && /timeout_milliseconds := 60000/.test(M) && /'beh-health', '47 6 \* \* \*'/.test(M) && (M.match(/'cron_create'/g) ?? []).length === 2);
  t('13 prova finale nella transazione (RLS, privilegi, contratto colonne, flag)', /0169: RLS spenta/.test(M) && /0169: colonne di beh_order_origin diverse dal contratto/.test(M) && /0169: beh_enabled nato qui vale/.test(M) && /aclexplode/.test(M));
  t('14 PK naturale per l\'idempotenza (Regola 20)', /order_gid_num\s+bigint primary key/.test(M));
}

console.log('\n== Migrazione 0170 (passo meta) ==');
{
  const viol = migViolations(M170);
  t('14a additiva come la 0169 (stessa guardia 1)', viol.length === 0, viol.join(' | '));
  t('14b autoprova: un grant su una tabella core nella 0170 fa diventare rossa la guardia', migViolations(M170.replace('\ncommit;', '\ngrant select on meta_ads_creative_daily to anon;\ncommit;')).length > 0);
  t('14c PK (date, ad_id), RLS, REVOKE e grant al solo service_role', /constraint beh_meta_outbound_daily_pk primary key \(date, ad_id\)/.test(M170) && /alter table beh_meta_outbound_daily enable row level security/.test(M170)
    && /revoke all on beh_meta_outbound_daily from public, anon, authenticated/.test(M170) && /grant select, insert, update, delete on beh_meta_outbound_daily to service_role/.test(M170));
  t('14d cron beh-sync-meta col cancello sul flag e timeout 60 s', cronGate(M170, 'beh-sync-meta', '13 6') && /timeout_milliseconds := 60000/.test(M170) && /'cron_create'/.test(M170));
  t('14e la prova nella transazione pretende il cancello', /command like '%where exists%beh_enabled%'/.test(M170));
}

console.log('\n== Migrazione 0171 (viste e RPC della tab) ==');
{
  const viol = migViolations(M171);
  t('14f additiva come la 0169 (stessa guardia 1)', viol.length === 0, viol.join(' | '));
  t('14g viste revocate ad anon e authenticated, solo ask_ro in lettura (D7)', /revoke all on v_beh_ordini_daily, v_beh_attribuzione_mensile, v_beh_ads_funnel_daily from public, anon, authenticated;/.test(M171)
    && /grant select on v_beh_ordini_daily, v_beh_attribuzione_mensile, v_beh_ads_funnel_daily to ask_ro;/.test(M171) && !/grant [^;]* to (anon|authenticated|public)[^;]*v_beh_/.test(noSql(M171)));
  t('14h RPC: security definer, cancello email_del_team con 42501 prima di ogni lettura, off a flag spento', /language plpgsql stable security definer set search_path to 'public'/.test(M171)
    && M171.indexOf("if not public.email_del_team(v_email) then") > 0 && M171.indexOf("using errcode = '42501'") < M171.indexOf('into v_run_day')
    && M171.indexOf('into v_run_day') < M171.indexOf('into v_meta_min, v_meta_max')
    && /return jsonb_build_object\('state', 'off'\);/.test(M171));
  t('14i RPC eseguibile solo da authenticated, mai da anon', /revoke all on function public\.beh_dashboard\(integer\) from public, anon;\ngrant execute on function public\.beh_dashboard\(integer\) to authenticated;/.test(M171));
  t('14j passi letti come la edge e la 0169', /array_agg\(lower\(btrim\(x, E' \\t\\r\\n'\)\)\) filter \(where btrim\(x, E' \\t\\r\\n'\) <> ''\)/.test(M171));
  t('14k periodo limitato (1-365 giorni)', /least\(greatest\(coalesce\(p_days, 30\), 1\), 365\)/.test(M171));
  // Gate 2 del passo 3 (25-10): B1 periodo con oggi vuoto, A1 confronti su periodi che cominciano prima dei dati
  t('14l il periodo finisce all\'ultimo giorno completo (mai oggi, ieri solo dopo il giro ordini) e nessun filtro usa >= v_from senza fine',
    /v_end   := least\(v_today - 1, coalesce\(v_run_day, v_today\) - 1\);/.test(M171) && /r\.window_to > \(r\.ended_at at time zone 'Europe\/Rome'\)::date;/.test(M171)
    && !/>= v_from\b/.test(M171) && /generate_series\(v_from, v_end, interval '1 day'\)/.test(M171));
  t('14m spesa e CPA sui soli giorni coperti, confronto sulla stessa lunghezza', /v_mend  := least\(v_end, v_meta_max\);/.test(M171) && /v_mlen  := greatest\(coalesce\(v_mend - v_from \+ 1, 0\), 0\);/.test(M171)
    && /where date between v_from - v_mlen and v_from - 1/.test(M171) && /o\.day between v_from - v_mlen and v_from - 1/.test(M171));
  t('14n periodo prima che comincia prima dei dati = null (spesa, ordini, aperture)', /'prev_spesa_meta', case when v_mlen = 0 or v_meta_min is null or v_from - v_mlen < v_meta_min then null/.test(M171)
    && (M171.match(/case when v_ord_min is null or v_pfrom < v_ord_min then null/g) ?? []).length === 3 && /'prev_aperture', case when v_vis_min is null or v_pfrom < v_vis_min then null/.test(M171));
  t('14o salute: ultimo giro del CRON per passo (un backfill non dice se il cron gira)', /where status <> 'running' and action = 'run' order by step, started_at desc/.test(M171));
}

console.log('\n== Test vivo tests/beh_rls.sql ==');
{
  // variable_conflict = 'error' in produzione: una variabile col nome di una colonna fa cadere il blocco con 42702
  const decl = RLS.slice(RLS.indexOf('\ndeclare\n'), RLS.indexOf('\nbegin\n'));
  const vars = [...decl.matchAll(/^ {2}(\w+) /gm)].map((m) => m[1]);
  const colonne = ['k', 'n', 'day', 'label', 'severity', 'id', 'created_at', 'key', 'value', 'step', 'action', 'status', 'moments', 'canale', 'ready', 'jobname', 'command'];
  t('15 nessuna variabile del blocco ha il nome di una colonna letta', vars.length >= 5 && vars.every((x) => !colonne.includes(x)), vars.join(','));
  t('16 a flag spento controlla solo le chiavi di beh_health_check (la riga beh_ordini della edge non conta)', /insert into health_log \(day, k, label, n, severity, created_at\) values \(current_date, 'beh_ordini'/.test(RLS) && /k in \('beh_fresh', 'beh_tracciamento_guasto', 'beh_quota_tracciata'\)\) then\n    raise exception 'KO H1/.test(RLS));
  t('17 severita\' degli allarmi provate (guasto error/ok, quota warn/ok/pochi ordini, backfill non conta)', /KO H4/.test(RLS) && /KO H5: 5 ordini online senza visite in 48 ore/.test(RLS) && /KO H6: 47 tracciati su 80/.test(RLS) && /pochi ordini/.test(RLS) && /'99999999999'/.test(RLS) && /' Ordini' \|\| chr\(10\)/.test(RLS));
}

// --- accessi della edge: inventario di ogni sb.from / sb.rpc sul testo con gli spazi normalizzati ---
const edgeViolations = (src) => {
  const f = noTs(src).replace(/\s+/g, ' ');
  const v = [];
  if (/\bsb ?\. ?rpc ?\(/.test(f) || /\/rest\/v1/.test(f) || /\.functions ?\. ?invoke ?\(/.test(f)) v.push('rpc, REST o invoke diretti');
  const tutti = [...f.matchAll(/\bsb ?\. ?from ?\(/g)].length;
  const acc = [...f.matchAll(/\bsb ?\. ?from ?\( ?'(\w+)' ?\) ?\. ?(\w+) ?\(/g)];
  if (tutti !== acc.length) v.push(`${tutti - acc.length} accessi con tabella non letterale`);
  for (const m of acc) {
    const [, tab, met] = m;
    if (['insert', 'upsert', 'update', 'delete'].includes(met)) {
      if (!(tab.startsWith('beh_') || tab === 'health_log')) v.push(`scrittura su ${tab}`);
    } else if (met === 'select') {
      if (!(tab.startsWith('beh_') || ['app_config', 'app_flags', 'meta_ads_creative_daily'].includes(tab))) v.push(`lettura di ${tab}`);
    } else v.push(`.${met}( su ${tab}`);
    const prima = f.slice(Math.max(0, m.index - 140), m.index);
    if (!/const \{[^}]*\berror\b[^}]*\} = await (?:retryOnce\(\(\) => )?$/.test(prima)) v.push(`${tab}.${met} senza error destrutturato`);
  }
  for (const m of f.matchAll(/retryOnce\(\(\) => sb ?\. ?from ?\( ?'(\w+)' ?\) ?\. ?(\w+) ?\(/g)) {
    const [, tab, met] = m;
    const dopo = f.slice(m.index, m.index + 420);
    const ammessa = met === 'select'
      || (tab === 'health_log' && met === 'upsert' && /\{ onConflict: 'day,k' \}\)\)/.test(dopo))
      || (tab === 'beh_sync_runs' && met === 'upsert' && /\{ id: runId,[^}]*\}, \{ onConflict: 'id', ignoreDuplicates: true \}\)\)/.test(dopo));
    if (!ammessa) v.push(`scrittura ritentata ${tab}.${met}`);
  }
  for (const m of f.matchAll(/\bhealth\( ?([^,]+?) ?,/g)) {
    if (!(/^'beh_\w+'$/.test(m[1]) || /^`beh_[^`]*`$/.test(m[1]) || m[1] === 'hkey()')) v.push(`chiave health ${m[1]}`);
  }
  return v;
};

console.log('\n== Edge beh-sync: flag, accessi, scritture solo beh_*, token ==');
{
  const keys = (SRC.match(/const FLAG_KEYS = \[([^\]]*)\]/)?.[1] ?? '').split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  const used = [...new Set([...SRC.matchAll(/fmap\.get\('([^']+)'\)/g)].map((m) => m[1]))];
  t('18 flag consumati = whitelist letta (un flag non caricato e\' un no-op silenzioso)', used.length > 0 && used.every((k) => keys.includes(k)) && keys.every((k) => used.includes(k)), `whitelist ${keys} usati ${used}`);
  const iRun = SRC.indexOf('const runId = crypto.randomUUID()');
  t('19 a flag spento o passo spento `run` risponde skipped prima di ogni scrittura', iRun > 0 && /if \(action === 'run' && !enabled\) return json\(\{ ok: true, skipped: 'disabled' \}\)/.test(SRC)
    && SRC.indexOf("skipped: 'disabled'") < iRun && SRC.indexOf("skipped: 'step_spento'") < iRun);
  const viol = edgeViolations(SRC);
  t('20 accessi: nessun rpc; letture solo app_config, app_flags e beh_*; scritture solo beh_* e health_log; error sempre destrutturato; ritentate solo letture e upsert idempotenti; chiavi health solo beh_*', viol.length === 0, viol.join(' | '));
  const anchor = "  if (action !== 'run' && action !== 'backfill')";
  const injS = (x) => SRC.replace(anchor, `  ${x}\n${anchor}`);
  const MUT_S = [
    ['rpc a una funzione core', "await sb.rpc('refresh_health_log');"],
    ['scrittura core su due righe', "await sb\n    .from('shopify_orders').update({ x: 1 });"],
    ['lettura senza error', "const { data: ex, count } = await sb.from('beh_order_origin').select('order_gid_num');"],
    ['scrittura ritentata su due righe', "await retryOnce(() => sb.from('beh_order_origin')\n    .upsert({}));"],
    ['chiave health in template di un altro modulo', "await health(`ce_${'drift'}`, 'x', 1, 'error');"],
    ['tabella non letterale', "const tab = 'shopify_orders'; await sb.from(tab).delete();"],
  ];
  for (const [nome, mut] of MUT_S) {
    const ss = injS(mut);
    t(`20. autoprova: "${nome}" fa diventare rossa la guardia 20`, ss !== SRC && edgeViolations(ss).length > 0);
  }
  t('21 backfill con chiave di salute sua (non copre l\'errore del cron)', /const hkey = \(\): string => !STEPS\.includes\(step\) \? 'beh_sync' : action === 'backfill' \? `beh_\$\{step\}_backfill` : `beh_\$\{step\}`;/.test(SRC));
  t('22 riga del giro con id della edge, upsert idempotente', /const runId = crypto\.randomUUID\(\);/.test(SRC) && /\.eq\('id', runId\)/.test(SRC));
  t('23 chiusura del giro controllata: non chiusa = warn', /const chiuso = await closeRun\(/.test(SRC) && /\(chiuso \? '' : ' \| riga del giro non chiusa in beh_sync_runs'\)/.test(SRC) && /vuoto \|\| !chiuso \|\| versionNote \? 'warn' : 'ok'/.test(SRC));
  t('24 0 ordini su almeno 2 giorni = warn (scope o filtro)', /const vuoto = nodes\.length === 0 && spanDays >= 2;/.test(SRC) && /errs\.length \? 'error' : vuoto \? 'warn' : 'ok'/.test(SRC));
  t('25 diag legge gli scope del token (read_all_orders) con il token in header', /access_scopes\.json`, \{ headers: \{ 'X-Shopify-Access-Token': token \} \}\)/.test(SRC) && /read_all_orders: scopes\.includes\('read_all_orders'\)/.test(SRC));
  t('26 upsert sulla PK naturale', /upsert\(chunk, \{ onConflict: 'order_gid_num' \}\)/.test(SRC));
  t('27 tetto per giro e blocchi di backfill limitati (Regola 20c)', /const MAX_ORDINI_RUN = 500;/.test(SRC) && /const MAX_ORDINI_BACKFILL = 1000;/.test(SRC) && /if \(nodes\.length > cap\) throw new Error/.test(SRC) && /span <= MAX_BACKFILL_DAYS/.test(SRC));
  t('28 token Shopify e token Meta solo in header, mai in URL', /'X-Shopify-Access-Token': token/.test(SRC) && /authorization: `Bearer \$\{metaToken\}`/.test(SRC) && !/access_token=\$\{|\?access_token|token=\$\{token\}|token=\$\{metaToken\}/.test(SRC));
  t('28a il redattore copre entrambi i token', /for \(const k of \[token, metaToken\]\) if \(k\) t = t\.split\(k\)\.join\('\*\*\*'\);/.test(SRC));
  t('28b passo meta: upsert sulla PK, tetto alle pagine e alle righe, warn se ads-sync ha spesa e qui 0 righe', /upsert\(chunk, \{ onConflict: 'date,ad_id' \}\)/.test(SRC) && /if \(\+\+pages > META_MAX_PAGES\) throw new Error/.test(SRC)
    && /if \(rows\.length > cap\) throw new Error/.test(SRC) && /const vuoto = rows\.length === 0 && !sErr && \(conSpesa \?\? 0\) > 0;/.test(SRC));
  // Gate 2 del passo 2 (25-10): un outbound_clicks tolto dai campi dava 0 ovunque, salute ok e suite verde (B1)
  const campiMeta = (s) => { const c = s.match(/const META_FIELDS = '([^']+)';/)?.[1] ?? ''; const usi = (s.match(/fields=\$\{META_FIELDS\}/g) ?? []).length;
    return c.split(',').includes('outbound_clicks') && c.split(',').includes('actions') && c.split(',').includes('inline_link_clicks') && usi === 2 && !/fields=ad_id/.test(s); };
  t('28d campi Meta in una sola costante usata da diag e giro, con outbound_clicks, actions e inline_link_clicks', campiMeta(SRC));
  t('28d. autoprova: togliere outbound_clicks dalla costante fa diventare rossa la guardia 28d', !campiMeta(SRC.replace("inline_link_clicks,outbound_clicks,actions", 'inline_link_clicks,actions')));
  t('28e outbound assente su tutte le righe con click = warn', /const senzaOutbound = tot\.link > 0 && !ins\.some\(\(r\) => Array\.isArray\(r\.outbound_clicks\)\);/.test(SRC)
    && /\(vuoto \|\| sErr \|\| senzaOutbound\) \? 'warn' : 'ok'/.test(SRC) && /vuoto \|\| sErr \|\| senzaOutbound \|\| !chiuso \? 'warn' : 'ok'/.test(SRC));
  t('28f finestra meta: giro fino a ieri, backfill mai oltre oggi escluso', /let to = step === 'meta' \? romeDate_\(0\) : romeDate_\(-1\);/.test(SRC) && /if \(step === 'meta' && to > romeDate_\(0\)\) to = romeDate_\(0\);/.test(SRC));
  t('28g token controllato per passo (il passo meta non chiede il token Shopify)', /if \(step === 'ordini' && !token\) return fail\('token'/.test(SRC) && /if \(step === 'meta' && !metaToken\) return fail\('token'/.test(SRC));
  t('28h metaGet: nodo singolo solo alla prima pagina', /if \(!Array\.isArray\(j\?\.data\)\) \{ if \(pages === 1\) return \[j\]; throw new Error/.test(SRC));
  t('28c stessa Graph e stesso account di ads-sync', /const GRAPH = 'https:\/\/graph\.facebook\.com\/v21\.0';/.test(SRC) && /const AD_ACCOUNT = 'act_686034712784477';/.test(SRC)
    && read('supabase/functions/ads-sync/index.ts').includes("const GRAPH = 'https://graph.facebook.com/v21.0';") && read('supabase/functions/ads-sync/index.ts').includes("const AD_ACCOUNT = 'act_686034712784477';"));
  t('29 ogni messaggio verso health_log e risposta passa dal redattore', /label: redact_\(label\)\.slice\(0, 500\)/.test(SRC) && /json\(\{ error: `\$\{where\}: \$\{redact_\(msg\)\}` \}/.test(SRC));
  t('30 API GraphQL pinnata come loyalty-orders', /const API_VERSION = '2026-07';/.test(SRC));
}

console.log('\n== PURE:beh-ordini, ritagliato dal sorgente ==');
const BEGIN = '// ==== PURE:beh-ordini BEGIN ====';
const END = '// ==== PURE:beh-ordini END ====';
const a = SRC.indexOf(BEGIN), b = SRC.indexOf(END);
if (a < 0 || b < 0) { console.error('marcatori PURE:beh-ordini non trovati in beh-sync'); process.exit(1); }
const TMP = `${ROOT}tests/_beh_ordini.tmp.ts`;
writeFileSync(TMP, `${SRC.slice(a + BEGIN.length, b).trim()}\nexport { gidNum, clean_, cut_, todayRome_, romeDay_, romeDate_, searchFrom_, searchTo_, canale_, hostOf_, landing_, srcClass_, toRow_ };\n`, 'utf8');
let P;
try { P = await import(pathToFileURL(TMP).href); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }
{
  const { clean_, cut_, romeDay_, romeDate_, searchFrom_, searchTo_, canale_, hostOf_, landing_, srcClass_, toRow_ } = P;
  // classi delle sorgenti sui casi visti il 25-10 (#1946-#1949 e la Fase 1)
  t('31 Google con SEO = search', srcClass_({ source: 'Google', sourceType: 'SEO', referrerUrl: 'https://www.google.com/' }) === 'search');
  t('32 direct senza referrer = direct', srcClass_({ source: 'direct', sourceType: null, referrerUrl: null }) === 'direct');
  t('33 #1949 ultima visita: direct con referrer amimi.it = direct (non referral)', srcClass_({ source: 'direct', sourceType: null, referrerUrl: 'https://amimi.it/', utmParameters: null }) === 'direct');
  t('34 #1947 ultima visita: direct dalla pagina prodotto di amimi.it = direct', srcClass_({ source: 'direct', referrerUrl: 'https://amimi.it/products/lea-bag-leopardo-savana', landingPage: 'https://amimi.it/checkouts/cn/x/it-it' }) === 'direct');
  t('35 host del negozio = nessun referrer (amimi.it, www, myshopify)', hostOf_('https://www.amimi.it/x') === '' && hostOf_('https://amimi-10000.myshopify.com/x') === '' && hostOf_('https://ami-milano.com/x') === 'ami-milano.com' && hostOf_('https://notamimi.it/') === 'notamimi.it');
  t('36 FacebookAds/cpm (ads catalogo) = paid_social', srcClass_({ source: 'https://facebook.com/', referrerUrl: 'https://facebook.com/', utmParameters: { source: 'FacebookAds', medium: 'cpm', campaign: 'Catalog' } }) === 'paid_social');
  t('37 ig/social link in bio = social', srcClass_({ source: 'Instagram', referrerUrl: 'https://l.instagram.com/', utmParameters: { source: 'ig', medium: 'social', campaign: 'link_in_bio' } }) === 'social');
  t('38 IGShopping/Social = social', srcClass_({ source: 'Instagram', utmParameters: { source: 'IGShopping', medium: 'Social' } }) === 'social');
  t('39 Klaviyo/email = email', srcClass_({ source: 'Klaviyo', utmParameters: { source: 'Klaviyo', medium: 'email' } }) === 'email');
  t('40 webmail senza UTM = email (non search, anche se e\' google.com)', srcClass_({ source: 'https://mail.google.com/', referrerUrl: 'https://mail.google.com/' }) === 'email');
  t('41 google/cpc = paid_search', srcClass_({ source: 'Google', referrerUrl: 'https://www.google.com/', utmParameters: { source: 'google', medium: 'cpc' } }) === 'paid_search');
  t('42 "an unknown source" = unknown', srcClass_({ source: 'an unknown source' }) === 'unknown');
  t('43 sito esterno = referral', srcClass_({ source: 'https://ami-milano.com/', referrerUrl: 'https://ami-milano.com/x' }) === 'referral');
  t('44 nessuna visita = none', srcClass_(null) === 'none');
  // landing: niente query string, niente token di checkout
  t('45 checkout con token = checkout', landing_('https://amimi.it/checkouts/cn/hWN1abcDEF/it-it?x=1') === 'checkout');
  t('46 pagina di stato ordine = checkout', landing_('https://amimi.it/71583990043/orders/9f8e7d6c5b4a') === 'checkout');
  t('47 prodotto senza query string', landing_('https://amimi.it/products/lea-bag-muccata-marrone?fbclid=IwAR123&utm_source=FacebookAds') === '/products/lea-bag-muccata-marrone');
  t('48 URL non valido = vuoto', landing_(null) === '' && landing_('non un url') === '');
  // canale da app.id (GID)
  t('49 canali noti dal GID', canale_('gid://shopify/App/580111') === 'online_store' && canale_('gid://shopify/App/1354745') === 'bozza' && canale_('gid://shopify/App/2329312') === 'facebook_instagram' && canale_('gid://shopify/App/3890849') === 'shop');
  t('50 app sconosciuta e app assente', canale_('gid://shopify/App/341262598145') === 'app:341262598145' && canale_(null) === 'sconosciuto');
  // date di Roma
  t('51 #1937 creato alle 22:39 UTC del 22-10 e\' del 23-10 a Roma', romeDay_(Date.parse('2026-10-22T22:39:08Z')) === '2026-10-23');
  t('52 romeDate_ nel giorno del cambio ora (25-10, 25 ore)', romeDate_(0, new Date('2026-10-25T23:30:00Z')) === '2026-10-26' && romeDate_(1, new Date('2026-10-25T12:00:00Z')) === '2026-10-24');
  t('53 finestra di ricerca: inizio 2 ore prima, fine alla mezzanotte UTC', searchFrom_('2026-10-18') === '2026-10-17T22:00:00Z' && searchTo_('2026-10-26') === '2026-10-26T00:00:00Z');
  // testo sicuro per PostgREST (CONOSCENZA 13-09): niente surrogati spaiati ne' NUL, taglio per carattere
  const emoji = String.fromCodePoint(0x1f9f3);
  const lungo = 'a'.repeat(99) + emoji + 'b';
  const spaiato = (s) => { for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const d = s.charCodeAt(i + 1); if (!(d >= 0xdc00 && d <= 0xdfff)) return true; i++; } else if (c >= 0xdc00 && c <= 0xdfff) return true; } return false; };
  t('54 l\'emoji a cavallo del carattere 100 resta intera', cut_(lungo, 100) === 'a'.repeat(99) + emoji && !spaiato(cut_(lungo, 100)));
  t('55 la premessa: uno slice nudo lascerebbe un surrogato spaiato', spaiato(lungo.slice(0, 100)));
  t('56 clean_ toglie NUL e surrogati spaiati', clean_('a' + String.fromCharCode(0) + 'b' + String.fromCharCode(0xd83d)) === 'ab');
  // riga completa da un nodo GraphQL
  const nodo = { id: 'gid://shopify/Order/6900000000001', name: '#1948', createdAt: '2026-10-25T09:10:00Z', test: false, cancelledAt: null, app: { id: 'gid://shopify/App/580111' },
    customerJourneySummary: { ready: true, momentsCount: { count: 1 },
      firstVisit: { occurredAt: '2026-10-25T09:06:00Z', source: 'https://facebook.com/', sourceType: null, referrerUrl: 'https://facebook.com/', landingPage: 'https://amimi.it/products/lea-bag-cocco-purple?fbclid=1', utmParameters: { source: 'FacebookAds', medium: 'cpm', campaign: 'Catalog' } },
      lastVisit: { occurredAt: '2026-10-25T09:06:00Z', source: 'https://facebook.com/', sourceType: null, referrerUrl: 'https://facebook.com/', landingPage: 'https://amimi.it/checkouts/cn/zz/it-it', utmParameters: { source: 'FacebookAds', medium: 'cpm', campaign: 'Catalog' } } } };
  const r = toRow_(nodo, '2026-10-25T10:00:00.000Z');
  t('57 riga da un ordine ads tracciato', r.order_gid_num === '6900000000001' && r.day === '2026-10-25' && r.canale === 'online_store' && r.ready === true && r.moments === 1
    && r.first_src === 'paid_social' && r.first_landing === '/products/lea-bag-cocco-purple' && r.last_landing === 'checkout' && r.first_ref_host === 'facebook.com' && r.days_to_conv === 0, JSON.stringify(r));
  const r2 = toRow_({ id: 'gid://shopify/Order/6900000000002', name: '#1949', createdAt: '2026-10-25T13:44:29Z', test: false, cancelledAt: null, app: { id: 'gid://shopify/App/580111' }, customerJourneySummary: { ready: true, momentsCount: { count: 0 }, firstVisit: null, lastVisit: null } }, 'x');
  t('58 ordine senza visite: moments 0, sorgenti none', r2.moments === 0 && r2.first_src === 'none' && r2.last_src === 'none' && r2.first_visit_at === null && r2.days_to_conv === null);
  const r3 = toRow_({ id: 'gid://shopify/Order/6900000000003', name: '#2000', createdAt: '2026-10-25T13:44:29Z', test: false, cancelledAt: null, app: { id: 'gid://shopify/App/1354745' }, customerJourneySummary: null }, 'x');
  t('59 bozza senza riepilogo: ready true, moments 0 (non resta da rileggere per sempre)', r3.canale === 'bozza' && r3.ready === true && r3.moments === 0);
  const r4 = toRow_({ id: 'gid://shopify/Order/6900000000004', name: '#2001', createdAt: '2026-10-25T13:44:29Z', test: false, cancelledAt: '2026-10-25T14:00:00Z', app: null, customerJourneySummary: { ready: false, momentsCount: null } }, 'x');
  t('60 attribuzione in corso: ready false, moments null; cancellato; app assente', r4.ready === false && r4.moments === null && r4.is_cancelled === true && r4.canale === 'sconosciuto');
  // #1949 vero: prima visita Google il 05-10 alle 23:07 di Roma, ordine il 25-10, ultima visita direct da amimi.it
  const r5 = toRow_({ id: 'gid://shopify/Order/6900000000005', name: '#1949', createdAt: '2026-10-25T13:44:29Z', test: false, cancelledAt: null, app: { id: 'gid://shopify/App/580111' },
    customerJourneySummary: { ready: true, momentsCount: { count: 3 },
      firstVisit: { occurredAt: '2026-10-05T21:07:05Z', source: 'Google', sourceType: 'SEO', referrerUrl: 'https://www.google.com/', landingPage: 'https://amimi.it/' },
      lastVisit: { occurredAt: '2026-10-25T13:30:00Z', source: 'direct', sourceType: null, referrerUrl: 'https://amimi.it/', landingPage: 'https://amimi.it/products/lea-bag' } } }, 'x');
  t('61 #1949: giorni di Roma 05-10 -> 25-10 = 20, ultima visita direct senza host', r5.days_to_conv === 20 && r5.first_src === 'search' && r5.last_src === 'direct' && r5.last_ref_host === '', JSON.stringify(r5));
  const r6 = toRow_({ id: 'gid://shopify/Order/6900000000006', name: '#x', createdAt: '2026-10-20T22:10:00Z', test: false, cancelledAt: null, app: { id: 'gid://shopify/App/580111' },
    customerJourneySummary: { ready: true, momentsCount: { count: 1 }, firstVisit: { occurredAt: '2026-10-20T21:50:00Z', source: 'direct' }, lastVisit: { occurredAt: '2026-10-20T21:50:00Z', source: 'direct' } } }, 'x');
  t('62 visita alle 23:50 e ordine alle 00:10 di Roma = 1 giorno (non blocchi di 24 ore)', r6.days_to_conv === 1 && r6.day === '2026-10-21', JSON.stringify(r6));
}

console.log('\n== PURE:beh-meta, ritagliato dal sorgente ==');
{
  const B2 = '// ==== PURE:beh-meta BEGIN ====', E2 = '// ==== PURE:beh-meta END ====';
  const a2 = SRC.indexOf(B2), b2 = SRC.indexOf(E2);
  if (a2 < 0 || b2 < 0) { console.error('marcatori PURE:beh-meta non trovati in beh-sync'); process.exit(1); }
  const TMP2 = `${ROOT}tests/_beh_meta.tmp.ts`;
  writeFileSync(TMP2, `${SRC.slice(a2 + B2.length, b2).trim()}\nexport { metaNum_, metaAction_, metaRow_, metaUntil_ };\n`, 'utf8');
  let Q;
  try { Q = await import(pathToFileURL(TMP2).href); }
  finally { try { unlinkSync(TMP2); } catch { /* niente */ } }
  const { metaRow_, metaUntil_ } = Q;
  // forma reale di una riga insights level=ad con time_increment=1 (Graph v21.0)
  const ins = { ad_id: '120211111111110001', campaign_id: '120211111111110000', date_start: '2026-10-24', date_stop: '2026-10-24', inline_link_clicks: '37',
    outbound_clicks: [{ action_type: 'outbound_click', value: '21' }],
    actions: [{ action_type: 'link_click', value: '37' }, { action_type: 'landing_page_view', value: '14' }, { action_type: 'omni_landing_page_view', value: '15' }, { action_type: 'view_content', value: '30' }] };
  const m1 = metaRow_(ins, 's');
  t('63 riga meta: link, outbound dalla lista, LPV = massimo fra le due forme (mai la somma)', m1.date === '2026-10-24' && m1.ad_id === '120211111111110001' && m1.link_clicks === 37 && m1.outbound_clicks === 21 && m1.landing_page_views === 15, JSON.stringify(m1));
  const m2 = metaRow_({ ad_id: '1', date_start: '2026-10-24', inline_link_clicks: 'x' }, 's');
  t('64 annuncio senza outbound ne\' azioni: zeri, non NaN; campaign_id vuoto', m2.link_clicks === 0 && m2.outbound_clicks === 0 && m2.landing_page_views === 0 && m2.campaign_id === '', JSON.stringify(m2));
  t('65 valore negativo o decimale: 0 o arrotondato', metaRow_({ ad_id: '1', date_start: '2026-10-24', inline_link_clicks: '-3', outbound_clicks: [{ action_type: 'outbound_click', value: '2.6' }] }, 's').link_clicks === 0
    && metaRow_({ ad_id: '1', date_start: '2026-10-24', outbound_clicks: [{ action_type: 'outbound_click', value: '2.6' }] }, 's').outbound_clicks === 3);
  t('66 to escluso -> until incluso di Meta, anche sul cambio ora', metaUntil_('2026-10-26') === '2026-10-25' && metaUntil_('2026-03-30') === '2026-03-29' && metaUntil_('2026-11-01') === '2026-10-31');
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
