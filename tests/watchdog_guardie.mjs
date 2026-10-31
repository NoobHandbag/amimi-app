// tests/watchdog_guardie.mjs: guardie sul SORGENTE della migr 0181 (watchdog esterno e spazio in v_health, 31-10-2026)
//   node tests/watchdog_guardie.mjs
//
// La prova viva (tests/watchdog_rls.sql) gira solo dopo l'apply. Qui si fissa il testo: nessun hash o segreto nella
// migrazione e mai il pin_hash delle edge; RPC security definer con search_path, execute al solo anon, PIN sbagliato =
// {ok:false} e nient'altro; i sei giri con la chiave health_log, il job pg_cron e il flag che le edge scrivono e leggono
// davvero (un nome cambiato da una parte sola rende il watchdog cieco o falso); le 12 righe di v_health identiche alla
// 0035 piu' storage_mb e db_mb con le soglie 700 e 400 prima di `n = 0`; nessuna scrittura, nessun innesto nel core
// (refresh_health_log, trigger, cron). Ogni controllo e' una funzione del testo: l'autocontrollo la prova su un sorgente
// rotto apposta.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const MIG = 'supabase/migrations/';
const nomi = readdirSync(ROOT + MIG);
const M181 = nomi.includes('0181_watchdog.sql') ? read(MIG + '0181_watchdog.sql') : '';
const M035 = read(MIG + '0035_observability_detectors.sql');
const RLS = (() => { try { return read('tests/watchdog_rls.sql'); } catch { return ''; } })();
const edge = (n) => read(`supabase/functions/${n}/index.ts`);
const noComments = (s) => s.replace(/--[^\n]*/g, '');
const flat = (s) => s.replace(/\s+/g, ' ').trim();

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 200) : '')); } };

// ---- rilevatori (funzioni del testo, provate anche sui sorgenti rotti in fondo) ----
const funzione = (src) => (noComments(src).match(/create or replace function public\.watchdog_status\(p_pin text\)[\s\S]*?\nend \$fn\$;/) ?? [''])[0];
const vista = (src) => (noComments(src).match(/create or replace view v_health as[\s\S]*?\nfrom checks;/) ?? [''])[0];
const righeChecks = (v) => (v.match(/with checks as \(([\s\S]*?)\n\)\nselect k, label, n,/) ?? ['', ''])[1];
// le 12 righe di prima: il blocco checks della 0035 deve comparire identico (spazi a parte) in testa a quello nuovo
const vecchieUguali = (src) => {
  const prima = flat(righeChecks(vista(M035)));
  const ora = flat(righeChecks(vista(src)));
  return prima.length > 2000 && ora.startsWith(prima + ' union all');
};
const sevOk = (v) => /case\s+when k = 'storage_mb'::text then case when n >= 700 then 'warn'::text else 'ok'::text end\s+when k = 'db_mb'::text then case when n >= 400 then 'warn'::text else 'ok'::text end\s+when n = 0 then 'ok'::text/.test(v)
  && !/'storage_mb'[^\n]*'bad'|'db_mb'[^\n]*'bad'/.test(v);
const nuoveRighe = (v) => /select 'storage_mb', '[^']+',\s+\(select round\(coalesce\(sum\(case when o\.metadata->>'size' ~ '\^\[0-9\]\+\$' then \(o\.metadata->>'size'\)::numeric else 0::numeric end\), 0::numeric\) \/ 1048576\)::bigint\s+from storage\.objects o\)/.test(v)
  && /select 'db_mb', '[^']+',\s+round\(pg_database_size\(current_database\(\)\)::numeric \/ 1048576\)::bigint\n\)/.test(v);
const hashScritto = (src) => /\b[0-9a-f]{64}\b/i.test(src) || /\b[0-9a-f]{40,}\b/i.test(noComments(src));
const pinEdge = (src) => /(?<![a-z_])pin_hash\b/.test(noComments(src));
const scrive = (src) => [...noComments(src).matchAll(/\b(insert\s+into|update\s+[a-z_.]+\s+set|delete\s+from|truncate)\b[^;]*/gi)].map((m) => m[0].slice(0, 60));
const innesti = (src) => /refresh_health_log|create\s+(or\s+replace\s+)?trigger|cron\.(schedule|alter_job|unschedule)|net\.http_(post|get)/i.test(noComments(src));
const grantOk = (src) => {
  const s = noComments(src);
  const g = [...s.matchAll(/\b(grant|revoke)\b[^;]*watchdog_status[^;]*;/gi)].map((m) => flat(m[0]));
  return g.length === 2
    && g[0] === 'revoke all on function public.watchdog_status(text) from public, anon, authenticated, service_role;'
    && g[1] === 'grant execute on function public.watchdog_status(text) to anon;';
};
const intestOk = (f) => /^create or replace function public\.watchdog_status\(p_pin text\) returns jsonb\nlanguage plpgsql stable security definer set search_path to 'public' as \$fn\$/.test(f);
const pinOk = (f) => flat(f).includes("if coalesce(v_hash, '') = '' then return jsonb_build_object('ok', false, 'motivo', 'non_configurato'); end if;")
  && flat(f).includes("if p_pin is null or encode(sha256(convert_to(p_pin, 'UTF8')), 'hex') <> lower(v_hash) then return jsonb_build_object('ok', false); end if;")
  && flat(f).includes("select btrim(c.watchdog_pin_hash) into v_hash from public.app_config c where c.id = 1;")
  && (f.match(/return jsonb_build_object\(/g) || []).length === 3
  && f.indexOf("'ok', false)") < f.indexOf("'giri'");
// nella risposta buona solo chiavi note, nessun testo libero (label di health_log, corpi di pg_net)
const chiaviRisposta = (f) => [...(f.match(/return jsonb_build_object\(\s*'ok', true,[\s\S]*$/) ?? [''])[0].matchAll(/^\s{4}'([a-z0-9_]+)',/gm)].map((m) => m[1]);
const testoLibero = (f) => /\b(label|content|error_msg|headers|return_message|command)\b/.test(f.replace(/r\.status_code|r\.created/g, ''));
const GIRI = [
  ['shopify_sync', 'shopify-sync-hourly', null],
  ['stock_autopush', 'shopify-autopush-hourly', 'shopify_autopush_enabled'],
  ['cs_sync', 'cs-sync-poll', 'cs_enabled'],
  ['loyalty_orders', 'loyalty-orders-poll', 'loyalty_purchase_enabled'],
  ['ce_guard_letture', 'ce-guard-daily', null],
  ['ads_sync', 'ads-sync-daily', null],
];
const giri = (f) => [...f.matchAll(/\('([a-z_]+)',\s+'([a-z-]+)',\s+(null::text|'[a-z_]+')\)/g)].map((m) => [m[1], m[2], m[3] === 'null::text' ? null : m[3].slice(1, -1)]);

console.log('\n== M: file, numero, niente segreti ==');
{
  t('1  0181_watchdog.sql esiste ed e\' l\'unica 0181', M181.length > 0 && nomi.filter((n) => n.startsWith('0181_')).length === 1, nomi.filter((n) => n.startsWith('0181_')).join(' '));
  t('2  colonna nuova app_config.watchdog_pin_hash text, add column if not exists', /\nalter table public\.app_config add column if not exists watchdog_pin_hash text;\n/.test(M181));
  t('3  nessun hash o esadecimale lungo nella migrazione', M181.length > 0 && !hashScritto(M181));
  t('4  mai il pin_hash delle edge (solo watchdog_pin_hash)', M181.length > 0 && !pinEdge(M181));
  t('5  nessuna scrittura di dati (insert, update, delete, truncate)', M181.length > 0 && scrive(M181).length === 0, scrive(M181).join(' | '));
  t('6  nessun innesto nel core: niente refresh_health_log, trigger, cron, pg_net in scrittura', M181.length > 0 && !innesti(M181));
}

console.log('\n== F: watchdog_status ==');
const F = funzione(M181);
{
  t('7  funzione trovata', F.length > 1500, F.length);
  t('8  returns jsonb, plpgsql stable, security definer, search_path public', intestOk(F));
  t('9  revoke da public, anon, authenticated, service_role; execute al solo anon', grantOk(M181));
  t('10 hash vuoto = non_configurato; PIN nullo o sbagliato = {ok:false} e basta, PRIMA di ogni lettura', pinOk(F));
  t('11 risposta buona: solo ok, now, giri, net_402_30m, net_5xx_30m, storage_mb, db_mb',
    JSON.stringify(chiaviRisposta(F)) === JSON.stringify(['ok', 'now', 'giri', 'net_402_30m', 'net_5xx_30m', 'storage_mb', 'db_mb']), chiaviRisposta(F).join(','));
  t('12 nessun testo libero letto (label, content, error_msg, headers, return_message, command)', F.length > 0 && !testoLibero(F));
  t('13 i sei giri: chiave health_log, job pg_cron, flag', JSON.stringify(giri(F)) === JSON.stringify(GIRI), JSON.stringify(giri(F)));
  t('14 per giro: log da health_log (ultimi 3 giorni), cron dagli avvii riusciti, on dal flag (spazi e maiuscole tollerati)',
    flat(F).includes("'log', (select max(h.created_at) from public.health_log h where h.k = g.k and h.day >= current_date - 3)")
    && flat(F).includes("'cron', (select max(d.start_time) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = g.job and d.status = 'succeeded' and d.runid > v_runid)")
    && flat(F).includes("else exists (select 1 from public.app_flags f where f.key = g.flag and lower(btrim(f.value, E' \\t\\r\\n')) = 'true') end"));
  t('15 cron.job_run_details letto per finestra di runid (indice), non intero', flat(F).includes('select coalesce(max(d.runid), 0) - 5000 into v_runid from cron.job_run_details d;'));
  t('16 pg_net: 402 e 5xx negli ultimi 30 minuti, solo conteggi',
    flat(F).includes("'net_402_30m', (select count(*) from net._http_response r where r.status_code = 402 and r.created > now() - interval '30 minutes')")
    && flat(F).includes("'net_5xx_30m', (select count(*) from net._http_response r where r.status_code between 500 and 599 and r.created > now() - interval '30 minutes')"));
  t('17 Storage col cast protetto, database con pg_database_size', /'storage_mb', \(select round\(coalesce\(sum\(case when o\.metadata->>'size' ~ '\^\[0-9\]\+\$'/.test(F)
    && /'db_mb', round\(pg_database_size\(current_database\(\)\)::numeric \/ 1048576, 1\)/.test(F));
}

console.log('\n== X: i nomi esistono davvero dall\'altra parte ==');
{
  const scrittore = { shopify_sync: ['shopify-sync', "k: 'shopify_sync'"], stock_autopush: ['shopify-stock', "k: 'stock_autopush'"], cs_sync: ['cs-sync', "k: 'cs_sync'"],
    loyalty_orders: ['loyalty-orders', "k = 'loyalty_orders'"], ce_guard_letture: ['ce-guard', "add('ce_guard_letture'"], ads_sync: ['ads-sync', "k: 'ads_sync'"] };
  for (const [k, job, flag] of GIRI) {
    const [e, frammento] = scrittore[k];
    const src = edge(e);
    t(`18 ${k}: la edge ${e} scrive la chiave`, src.includes(frammento));
    if (flag) t(`19 ${k}: la edge ${e} legge il flag ${flag}`, src.includes(`'${flag}'`));
    const creato = nomi.filter((n) => n < '0181').some((n) => read(MIG + n).includes(`'${job}'`));
    t(`20 ${k}: il job ${job} compare nelle migrazioni`, creato);
  }
  // ce-guard e l'autopush fanno l'upsert senza created_at: per loro vale 'cron' (lo dice l'Apps Script); se un giorno
  // scrivono created_at questo test lo segnala, e il watchdog puo' tornare su 'log'
  t('21 ce-guard: upsert dei verdetti senza created_at (motivo del cron)', /sb\.from\('health_log'\)\.upsert\(checks\.map\(\(c\) => \(\{ day: today, \.\.\.c \}\)\)/.test(edge('ce-guard')));
  t('22 shopify-stock: upsert di stock_autopush senza created_at (motivo del cron)', edge('shopify-stock').includes("upsert({ day, k: 'stock_autopush', ...row }, { onConflict: 'day,k' })"));
}

console.log('\n== V: v_health ==');
const V = vista(M181);
{
  t('23 vista trovata, colonne k, label, n, severity', V.length > 2000 && /\nselect k, label, n,\n  case\n[\s\S]*\n  end as severity\nfrom checks;$/.test(V));
  t('24 le 12 righe della 0035 identiche, in testa', vecchieUguali(M181));
  t('25 storage_mb (cast protetto) e db_mb in coda, n bigint', nuoveRighe(V));
  t('26 soglie 700 e 400 prima di n = 0, mai bad', sevOk(V));
  t('27 il resto della gravita\' come nella 0035', flat(V).includes(flat(`when k = any (array['stock_neg'::text,'cogs_missing'::text,'price_missing'::text,'orders_orphan'::text,'shopify_orphan'::text,'qromo_orphan'::text,'dup_codice'::text,'period_mismatch'::text,'ce_drift_live'::text]) then 'bad'::text
    else 'warn'::text`)));
}

console.log('\n== P: prove ==');
{
  const pre = noComments(M181).split('\ndo $$')[1] ?? '';
  t('28 la migrazione si controlla da sola: anon esegue, gli altri no, PUBLIC no, PIN a caso chiuso, 14 righe in v_health, CONNECT',
    pre.includes("has_function_privilege('anon', 'public.watchdog_status(text)', 'execute')") && pre.includes("array['authenticated', 'service_role', 'ask_ro']")
    && pre.includes('a.grantee = 0') && pre.includes('public.watchdog_status(gen_random_uuid()::text)') && pre.includes('if v_n <> 14') && pre.includes("has_database_privilege(r, current_database(), 'connect')"));
  t('29 prova viva: blocco unico che finisce in TEST_OK', RLS.startsWith('-- tests/watchdog_rls.sql') && /\n  raise exception 'TEST_OK: [^\n]*\nend \$t\$;\n$/.test(RLS) && (RLS.match(/^do \$t\$$/gm) || []).length === 1);
  t('30 prova viva: authenticated = 42501, anon col PIN giusto e sbagliato, app_config chiusa ad anon',
    RLS.includes("if st <> '42501' then raise exception 'KO U: authenticated esegue la RPC") && RLS.includes("public.watchdog_status('sbagliato')")
    && RLS.includes("'select watchdog_pin_hash from public.app_config'"));
  t('31 prova viva: PIN con uno spazio, maiuscolo, vuoto e nullo = {ok:false}', RLS.includes("array['sbagliato', '', ' ' || v_pin, v_pin || ' ', upper(v_pin)]") && RLS.includes('public.watchdog_status(null)'));
}

console.log('\n== autocontrollo: i controlli vedono un sorgente rotto ==');
{
  const rotto = (da, a) => { const s = M181.replace(da, a); if (s === M181) throw new Error('mutazione a vuoto: ' + da); return s; };
  if (M181) {
    t('32 grant anche ad authenticated -> KO', !grantOk(rotto('to anon;\n', 'to anon, authenticated;\n')));
    t('33 hash scritto nella migrazione -> KO', hashScritto(M181 + "\nupdate public.app_config set watchdog_pin_hash = '" + 'ab'.repeat(32) + "' where id = 1;\n"));
    t('34 confronto col pin_hash delle edge -> KO', pinEdge(rotto('select btrim(c.watchdog_pin_hash)', 'select btrim(c.pin_hash)')));
    t('35 PIN sbagliato che risponde con i dati -> KO', !pinOk(funzione(rotto("return jsonb_build_object('ok', false);", "return jsonb_build_object('ok', false, 'now', now());"))));
    t('36 label di health_log nella risposta -> KO', testoLibero(funzione(rotto("'log', (select max(h.created_at)", "'log', (select max(h.label)"))));
    t('37 soglia dello Storage dopo n = 0 -> KO', !sevOk(vista(rotto("    when k = 'storage_mb'::text then case when n >= 700 then 'warn'::text else 'ok'::text end\n", '').replace("    when n = 0 then 'ok'::text\n", "    when n = 0 then 'ok'::text\n    when k = 'storage_mb'::text then case when n >= 700 then 'warn'::text else 'ok'::text end\n"))));
    t('38 una riga vecchia cambiata -> KO', !vecchieUguali(rotto("'Prodotti con giacenza negativa'", "'Prodotti con giacenza sotto zero'")));
    t('39 cast dello Storage senza protezione -> KO', !nuoveRighe(vista(rotto("(select round(coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::numeric else 0::numeric end), 0::numeric) / 1048576)::bigint", "(select round(coalesce(sum((o.metadata->>'size')::numeric), 0::numeric) / 1048576)::bigint"))));
    t('40 un giro col job sbagliato -> KO', JSON.stringify(giri(funzione(rotto("'cs-sync-poll'", "'cs-sync'")))) !== JSON.stringify(GIRI));
    t('41 un trigger su health_log -> KO', innesti(M181 + '\ncreate trigger x before update on health_log for each row execute function f();\n'));
    t('42 una scrittura su health_log -> KO', scrive(M181 + "\ninsert into health_log (day, k) values (current_date, 'x');\n").length === 1);
  } else {
    t('32-42 autocontrollo (serve la 0181)', false);
  }
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
