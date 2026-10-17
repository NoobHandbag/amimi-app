// tests/paillettes_guardie.mjs: guardie delle Paillettes del Villaggio (migr 0164, write-api v29, 16-10).
//   node tests/paillettes_guardie.mjs   (Node 24 strippa i tipi TS all'import)
//
// Due meta'. Sul SORGENTE della migrazione: cio' che tiene il modulo spento alla nascita (Regola 19), fuori dalla anon
// key (RLS e niente grant sulle tabelle nuove, viste in sola lettura) e cio' che fa dire alla vista eventi solo la
// verita' (solo la giocatrice, solo da `dal`, ordini contati sulle righe che esistono ancora, arrivi solo in aumento).
// Su write-api: il blocco delle due azioni e' ritagliato DAL SORGENTE che va in produzione ed eseguito contro un
// database finto in memoria (come tests/arrivo_adesso.mjs), piu' le cinture sul sorgente. Nessuna rete.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const M = read('supabase/migrations/0164_villaggio_paillettes.sql');
const SRC = read('supabase/functions/write-api/index.ts');
const noSql = (s) => s.replace(/--[^\n]*/g, '');
const m = noSql(M);
const noTs = (s) => s.replace(/^\s*\/\/[^\n]*$/gm, '');
// le catene supabase-js vanno a capo prima di .select/.upsert: si riattaccano prima di cercare
const flat = (s) => s.replace(/\)\s*\n\s*\./g, ').');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 160) : '')); } };
const eq = (n, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { ok++; console.log('  ok  ' + n); } else { ko++; console.log(`  KO  ${n}  atteso ${e}, ottenuto ${g}`); }
};

console.log('\n== migrazione 0164: spenta alla nascita, una transazione ==');
t('1  begin; ... commit; in una transazione', /^begin;$/m.test(M) && /^commit;$/m.test(M) && M.indexOf('begin;') < M.indexOf('commit;'));
t("2  villaggio_paillettes_enabled nasce 'false'", /\('villaggio_paillettes_enabled', 'false'\)/.test(m));
t("3  dal '2026-10-17' e giocatrice 'Ginevra'", /\('villaggio_paillettes_dal', '2026-10-17'\)/.test(m) && /\('villaggio_paillettes_chi', 'Ginevra'\)/.test(m));
t('4  flag con on conflict (key) do nothing (un re-run non spegne ne\' sposta nulla)', /\('villaggio_paillettes_chi', 'Ginevra'\)\s*on conflict \(key\) do nothing;/.test(m));
t('5  rollback dichiarato in fondo: flag a false', /-- Rollback: update app_flags set value = 'false' where key = 'villaggio_paillettes_enabled'/.test(M));
t('6  nessun tocco a tabelle core (niente alter/insert/update/delete fuori da app_flags e dalle tabelle nuove)',
  !/alter table (?!vil_presenze|supplier_checks)\w+/i.test(m) && !/\b(update|delete from)\s+(?!app_flags)\w+/i.test(m.replace(/for (insert|update|delete)/g, ''))
  && ![...m.matchAll(/insert into (\w+)/g)].some((x) => x[1] !== 'app_flags'));

console.log('\n== tabelle nuove: forma del contratto, RLS, nessun grant ==');
t('7  vil_presenze (chi, giorno, ts) con PK (chi, giorno)', /create table if not exists vil_presenze \(\s*chi\s+text not null,\s*giorno\s+date not null,\s*ts\s+timestamptz not null default now\(\),\s*primary key \(chi, giorno\)\s*\);/.test(m));
t('8  supplier_checks (id, ts, giorno, fornitore, chi, righe jsonb array, nota)',
  /create table if not exists supplier_checks \(\s*id\s+uuid primary key default gen_random_uuid\(\),\s*ts\s+timestamptz not null default now\(\),\s*giorno\s+date not null,\s*fornitore\s+text not null,\s*chi\s+text not null,\s*righe\s+jsonb not null check \(jsonb_typeof\(righe\) = 'array'\),\s*nota\s+text\s*\);/.test(m));
t('9  RLS accesa su entrambe', /alter table vil_presenze enable row level security;/.test(m) && /alter table supplier_checks enable row level security;/.test(m));
t('10 privilegi revocati ad anon e authenticated (i default di public darebbero select)', /revoke all on vil_presenze, supplier_checks from public, anon, authenticated;/.test(m));
t('11 nessun grant e nessuna policy sulle tabelle nuove', !/grant [^;]* on (vil_presenze|supplier_checks)/i.test(m) && !/create policy/i.test(m));

console.log('\n== viste: settings con le 4 chiavi, eventi in sola lettura ==');
t('12 v_villaggio_settings con villaggio_enabled + le 3 chiavi Paillettes',
  /create or replace view v_villaggio_settings as\nselect key, value from app_flags\nwhere key in \('villaggio_enabled', 'villaggio_paillettes_enabled', 'villaggio_paillettes_dal', 'villaggio_paillettes_chi'\);/.test(m));
t('13 v_villaggio_eventi senza security_invoker (owner postgres: anon non vede le tabelle sotto)', /create or replace view v_villaggio_eventi as\n/.test(m) && !/security_invoker/.test(m) && /alter view v_villaggio_eventi owner to postgres;/.test(m));
t('14 viste: revoke da public, anon, authenticated e poi SOLO select', /revoke all on v_villaggio_settings, v_villaggio_eventi from public, anon, authenticated;\ngrant select on v_villaggio_settings, v_villaggio_eventi to anon, authenticated;/.test(m) && !/grant (insert|update|delete|all)/i.test(m));
t('15 colonne tipo, giorno, ts, ref, n', /select ev\.tipo, ev\.giorno, ev\.ts, ev\.ref, ev\.n\nfrom ev\ncross join cfg/.test(m));
t('16 i sei tipi del contratto', ['presenza', 'ordine', 'arrivo', 'conta', 'verifica', 'data_aggiunta'].every((x) => new RegExp(`select '${x}'`).test(m)));
t('17 legge le tre chiavi da app_flags', /where key in \('villaggio_paillettes_enabled', 'villaggio_paillettes_chi', 'villaggio_paillettes_dal'\)/.test(m));
t("18 flag spento = nessuna riga (acceso solo se 'true')", /coalesce\(max\(value\) filter \(where key = 'villaggio_paillettes_enabled'\) = 'true', false\) as acceso/.test(m) && /where cfg\.acceso and /.test(m));
t('19 filtro giocatrice: chi = villaggio_paillettes_chi', /max\(value\) filter \(where key = 'villaggio_paillettes_chi'\) as chi/.test(m) && /ev\.chi = cfg\.chi/.test(m));
t('20 filtro dal: ts >= dal, mezzanotte di Roma', /::timestamp at time zone 'Europe\/Rome' as dal/.test(m) && /ev\.ts >= cfg\.dal;/.test(m));
t('21 dal letto in modo sicuro: regex ISO + pg_input_is_valid prima del cast (storto = NULL = nessuna riga)',
  /case when key = 'villaggio_paillettes_dal' and value ~ '\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$' and pg_input_is_valid\(value, 'date'\)\s*then value::date end/.test(m));
t('22 giorno delle righe di change_log = data di Roma del ts', (m.match(/\(c\.ts at time zone 'Europe\/Rome'\)::date/g) ?? []).length === 2);
t("23 ordine: change_log op order_multi source write-api, ref = row_id (gruppo)", /select 'ordine', \(c\.ts at time zone 'Europe\/Rome'\)::date, c\.ts, c\.row_id,/.test(m) && /where c\.op = 'order_multi' and c\.source = 'write-api'/.test(m));
t('24 ordine: n = righe di supplier_orders del gruppo che ESISTONO ANCORA', /\(select count\(\*\)::int from supplier_orders so where so\.gruppo::text = c\.row_id\)/.test(m));
t("25 arrivo: solo arrival_set da write-api con delta > 0, n = delta", /where c\.op = 'arrival_set' and c\.source = 'write-api'\n\s+and \(case when jsonb_typeof\(c\.after -> 'delta'\) = 'number' then \(c\.after -> 'delta'\)::numeric end\) > 0/.test(m) && /c\.row_id, \(c\.after -> 'delta'\)::numeric::int, c\.chi/.test(m));
t('26 conta: da counts, ref = codice, giorno = data_conta, n = 1', /select 'conta', coalesce\(k\.data_conta, \(k\.ts at time zone 'Europe\/Rome'\)::date\), k\.ts, k\.codice, 1, k\.chi\n\s+from counts k/.test(m));
t('27 presenza: ref = giorno, n = 1', /select 'presenza'::text as tipo, p\.giorno, p\.ts, p\.giorno::text as ref, 1 as n, p\.chi\n\s+from vil_presenze p/.test(m));
t('28 verifica: ref = fornitore, n = righe con confermata true', /select 'verifica', s\.giorno, s\.ts, s\.fornitore,\n\s+\(select count\(\*\)::int from jsonb_array_elements\(s\.righe\) e where e -> 'confermata' = 'true'::jsonb\)/.test(m));
t('29 data_aggiunta: una riga per elemento con data_prima null e data_dopo non null, ref = id', /select 'data_aggiunta', s\.giorno, s\.ts, e ->> 'id', 1, s\.chi/.test(m) && /where e ->> 'data_prima' is null and e ->> 'data_dopo' is not null/.test(m));

console.log('\n== write-api v29: cinture sul sorgente ==');
const BEGIN = '  // --- PAILLETTES (v29, migr 0164)', END = "  // v21: l'insert generico 'order' bypassava";
const a = SRC.indexOf(BEGIN), b = SRC.indexOf(END);
if (a < 0 || b < 0 || b < a) { console.error('blocco Paillettes non trovato in write-api/index.ts'); process.exit(1); }
const BLK = SRC.slice(a, b), F = flat(BLK);
t('30 le due azioni nello stesso blocco', /if \(action === 'villaggio_presenza' \|\| action === 'fornitore_verifica'\)/.test(BLK));
t('31 flag letto da app_flags con error destrutturato e retryOnce (Regola 20 a)', /const \{ data: flags, error: fe \} = await retryOnce\(\(\) => sb\.from\('app_flags'\)\.select\('key, value'\)\.in\('key', \['villaggio_paillettes_enabled', 'villaggio_paillettes_chi'\]\)\);/.test(F));
t('32 lettura del flag fallita = 503, mai "acceso"', /if \(fe\) return json\(\{ error: `[^`]*` \}, 503\);/.test(BLK) && BLK.indexOf('if (fe)') < BLK.indexOf("!== 'true'"));
t("33 flag diverso da 'true' = 409 paillettes spente, prima di ogni scrittura", /if \(flag\('villaggio_paillettes_enabled'\) !== 'true'\) return json\(\{ error: 'paillettes spente' \}, 409\);/.test(BLK)
  && BLK.indexOf("'paillettes spente'") < BLK.indexOf("sb.from('vil_presenze')") && BLK.indexOf("'paillettes spente'") < BLK.indexOf(".update("));
t('34 presenza: chi diverso dalla giocatrice = ok ignorata, nessuna scrittura', /if \(!chi \|\| chi !== flag\('villaggio_paillettes_chi'\)\) return json\(\{ ok: true, nuova: false, ignorata: true \}\);/.test(BLK)
  && BLK.indexOf('ignorata: true') < BLK.indexOf("sb.from('vil_presenze')"));
t('35 presenza idempotente: on conflict (chi, giorno) do nothing, giorno = oggi a Roma', /sb\.from\('vil_presenze'\)\.upsert\(\{ chi, giorno: today \}, \{ onConflict: 'chi,giorno', ignoreDuplicates: true \}\)\.select\('giorno'\)/.test(F) && /const today = todayRome\(\)/.test(SRC));
t('36 presenza: niente change_log (non e\' un dato di business)', !/logp\('vil_presenze'/.test(BLK) && !/tbl: 'vil_presenze'/.test(BLK));
t('37 verifica: una lettura filtrata per fornitore con error destrutturato', /const \{ data: lette, error: le \} = /.test(BLK) && /sb\.from\('supplier_orders'\)\.select\('id, codice, data_consegna'\)\.in\('id', \[\.\.\.chieste\.keys\(\)\]\)\.eq\('fornitore', fornitore\)/.test(F) && /if \(le\) return json\(/.test(BLK));
t('38 verifica: update della SOLA data e solo se cambia', /if \(prima !== ch\.data\) \{\n\s+const \{ error: ue \} = await sb\.from\('supplier_orders'\)\.update\(\{ data_consegna: ch\.data \}\)\.eq\('id', r\.id\);/.test(BLK));
t("39 verifica: change_log op order_date con before e after", /await logp\('supplier_orders', String\(r\.id\), 'order_date', \{ codice: r\.codice, fornitore, data_consegna: ch\.data \}, \{ data_consegna: prima \}\);/.test(BLK)
  && /\.\.\.\(before !== undefined \? \{ before \} : \{\}\),/.test(SRC));
t('40 verifica: supplier_checks con giorno di Roma e righe data_prima/data_dopo/confermata', /sb\.from\('supplier_checks'\)\.insert\(\{ giorno: today, fornitore, chi, righe, nota \}\)\.select\('id'\)\.single\(\)/.test(F)
  && /righe\.push\(\{ id: r\.id, codice: r\.codice, confermata: ch\.confermata, data_prima: prima, data_dopo: ch\.data \}\);/.test(BLK));
t('41 verifica: niente compare-and-set e niente op_id (scelta di Dan, 16-10)', !/op_id/.test(noTs(BLK)) && !/\.update\([^)]*\)\.eq\('id', r\.id\)\.eq\(/.test(F));
t('42 date validate con isoDate (lib.ts), mai new Date()', /isoDate\(r\.data_consegna\)/.test(BLK) && !/new Date\(/.test(BLK));

console.log('\n== write-api v29: il blocco vero contro un database finto ==');
const TMP = `${ROOT}tests/_paillettes.${process.pid}.tmp.ts`;
writeFileSync(TMP, `import { isoDate } from '../supabase/functions/write-api/lib.ts';
export async function run(ctx: any): Promise<any> {
  const { action, payload, sb, json, today, chi, retryOnce, logp } = ctx;
${BLK}
  return json({ fallthrough: true }, 599);
}
`, 'utf8');
let run;
try { ({ run } = await import(pathToFileURL(TMP).href)); }
finally { try { unlinkSync(TMP); } catch { /* niente */ } }

const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222', U3 = '33333333-3333-4333-8333-333333333333';
// Database finto con le sole catene che il blocco usa. `rompi` fa fallire una tabella+operazione.
const mondo = ({ acceso = 'true', giocatrice = 'Ginevra', rompi = null } = {}) => {
  const st = {
    flags: [{ key: 'villaggio_paillettes_enabled', value: acceso }, { key: 'villaggio_paillettes_chi', value: giocatrice }],
    presenze: [], checks: [], log: [], letture: [], update: [],
    ordini: [
      { id: U1, codice: 'LEA_BAG_ROSSO', fornitore: 'Francesco (pelle)', data_consegna: null },
      { id: U2, codice: 'AGATA_NERO', fornitore: 'Francesco (pelle)', data_consegna: '2026-10-20' },
      { id: U3, codice: 'RITA_VERDE', fornitore: 'Altro lab', data_consegna: null },
    ],
  };
  const exec = (q) => {
    if (rompi && rompi === `${q.tbl}.${q.op}`) return { data: null, error: { message: 'errore finto' } };
    const passa = (r) => q.filtri.every(([c, v, op]) => (op === 'in' ? v.includes(r[c]) : r[c] === v));
    if (q.tbl === 'app_flags' && q.op === 'select') return { data: st.flags.filter(passa), error: null };
    if (q.tbl === 'vil_presenze' && q.op === 'upsert') {
      const c = q.body;
      if (st.presenze.some((p) => p.chi === c.chi && p.giorno === c.giorno)) return { data: [], error: null };
      st.presenze.push({ ...c }); return { data: [{ giorno: c.giorno }], error: null };
    }
    if (q.tbl === 'supplier_orders' && q.op === 'select') { st.letture.push(q.filtri); return { data: st.ordini.filter(passa).map((r) => ({ ...r })), error: null }; }
    if (q.tbl === 'supplier_orders' && q.op === 'update') {
      const keys = Object.keys(q.body);
      st.update.push(keys);
      st.ordini.filter(passa).forEach((r) => Object.assign(r, q.body)); return { data: null, error: null };
    }
    if (q.tbl === 'supplier_checks' && q.op === 'insert') { st.checks.push(q.body); return { data: { id: 'chk' + st.checks.length }, error: null }; }
    throw new Error(`query non prevista dal DB finto: ${q.tbl}.${q.op}`);
  };
  const sb = { from: (tbl) => {
    const q = { tbl, op: 'select', filtri: [], body: null };
    const k = {
      select() { return k; },
      update(body) { q.op = 'update'; q.body = body; return k; },
      insert(body) { q.op = 'insert'; q.body = body; return k; },
      upsert(body) { q.op = 'upsert'; q.body = body; return k; },
      eq(c, v) { q.filtri.push([c, v, 'eq']); return k; },
      in(c, v) { q.filtri.push([c, v, 'in']); return k; },
      single() { return k; },
      then(res, rej) { return Promise.resolve().then(() => exec(q)).then(res, rej); },
    };
    return k;
  } };
  const ctx = (action, payload, chi = 'Ginevra') => ({
    action, payload, sb, today: '2026-10-17', chi,
    json: (body, status = 200) => ({ status, body }),
    retryOnce: async (fn) => await fn(), logp: async (...args) => { st.log.push(args); },
  });
  return { st, ctx };
};

{ // flag spento: entrambe 409, nessuna scrittura
  const { st, ctx } = mondo({ acceso: 'false' });
  const p = await run(ctx('villaggio_presenza', {}));
  const v = await run(ctx('fornitore_verifica', { fornitore: 'Francesco (pelle)', righe: [{ id: U1, confermata: true, data_consegna: '2026-11-01' }] }));
  eq("43 flag 'false': presenza e verifica 409 paillettes spente, zero scritture", [p.status, p.body.error, v.status, v.body.error, st.presenze.length, st.update.length, st.checks.length], [409, 'paillettes spente', 409, 'paillettes spente', 0, 0, 0]);
}
{ // flag assente = spento
  const { st, ctx } = mondo({ acceso: null });
  st.flags = st.flags.filter((f) => f.key !== 'villaggio_paillettes_enabled');
  const p = await run(ctx('villaggio_presenza', {}));
  eq('44 flag assente = spento: 409', [p.status, st.presenze.length], [409, 0]);
}
{ // lettura del flag fallita: 503 e niente scritto
  const { st, ctx } = mondo({ rompi: 'app_flags.select' });
  const p = await run(ctx('villaggio_presenza', {}));
  eq('45 flag non leggibile: 503, nessuna presenza', [p.status, st.presenze.length], [503, 0]);
}
{ // presenza: la prima del giorno e' nuova, la seconda no
  const { st, ctx } = mondo();
  const r1 = await run(ctx('villaggio_presenza', {}));
  const r2 = await run(ctx('villaggio_presenza', {}));
  eq('46 presenza: nuova true poi false, una sola riga col giorno di Roma', [r1.status, r1.body, r2.body, st.presenze], [200, { ok: true, nuova: true }, { ok: true, nuova: false }, [{ chi: 'Ginevra', giorno: '2026-10-17' }]]);
  t('47 presenza: niente change_log', st.log.length === 0);
}
{ // chi diverso dalla giocatrice (o vuoto): ignorata
  const { st, ctx } = mondo();
  const r1 = await run(ctx('villaggio_presenza', {}, 'Bene'));
  const r2 = await run(ctx('villaggio_presenza', {}, ''));
  eq('48 chi non giocatrice o vuoto: ok ignorata, nessuna riga', [r1.status, r1.body, r2.body, st.presenze.length], [200, { ok: true, nuova: false, ignorata: true }, { ok: true, nuova: false, ignorata: true }, 0]);
}
{ // presenza: insert fallito = errore, non "ok"
  const { ctx } = mondo({ rompi: 'vil_presenze.upsert' });
  const r = await run(ctx('villaggio_presenza', {}));
  t('49 presenza: insert fallito = 400, mai ok', r.status === 400 && !r.body.ok);
}
{ // verifica normale: una data aggiunta, una invariata, una riga di un altro fornitore ignorata
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', {
    fornitore: 'Francesco (pelle)', nota: '  tutto in lavorazione  ',
    righe: [
      { id: U1, confermata: true, data_consegna: '2026-10-30' },
      { id: U2, confermata: false, data_consegna: '2026-10-20' },
      { id: U3, confermata: true, data_consegna: '2026-11-15' },
      { id: 'non-un-uuid', confermata: true, data_consegna: null },
    ],
  }));
  eq('50 verifica: ok, check_id, una data cambiata', [r.status, r.body], [200, { ok: true, check_id: 'chk1', date_cambiate: 1 }]);
  eq('51 la lettura filtra per id (solo uuid) e per fornitore', st.letture[0], [['id', [U1, U2, U3], 'in'], ['fornitore', 'Francesco (pelle)', 'eq']]);
  eq('52 update solo sulla riga cambiata e solo della data', [st.update, st.ordini.map((o) => o.data_consegna)], [[['data_consegna']], ['2026-10-30', '2026-10-20', null]]);
  eq('53 change_log order_date con before/after sulla riga cambiata', st.log.map((l) => [l[0], l[1], l[2], l[3].data_consegna, l[4]]), [['supplier_orders', U1, 'order_date', '2026-10-30', { data_consegna: null }]]);
  eq('54 supplier_checks: giorno di Roma, chi, nota ripulita, righe lette con data_prima/data_dopo/confermata', st.checks, [{
    giorno: '2026-10-17', fornitore: 'Francesco (pelle)', chi: 'Ginevra',
    righe: [
      { id: U1, codice: 'LEA_BAG_ROSSO', confermata: true, data_prima: null, data_dopo: '2026-10-30' },
      { id: U2, codice: 'AGATA_NERO', confermata: false, data_prima: '2026-10-20', data_dopo: '2026-10-20' },
    ],
    nota: 'tutto in lavorazione',
  }]);
}
{ // togliere una data e' un cambio (null), una data vuota vale null
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', { fornitore: 'Francesco (pelle)', righe: [{ id: U2, confermata: true, data_consegna: '' }] }));
  eq("55 data '' = nessuna data: la data tolta si salva e si logga", [r.body.date_cambiate, st.ordini[1].data_consegna, st.checks[0].righe[0].data_dopo], [1, null, null]);
}
for (const [nome, payload] of [
  ['fornitore vuoto', { fornitore: '  ', righe: [{ id: U1, confermata: true, data_consegna: null }] }],
  ['righe vuote', { fornitore: 'Francesco (pelle)', righe: [] }],
  ['righe non array', { fornitore: 'Francesco (pelle)', righe: 'x' }],
  ['data 2026-02-30', { fornitore: 'Francesco (pelle)', righe: [{ id: U1, confermata: true, data_consegna: '2026-02-30' }] }],
  ['data 30/10/2026', { fornitore: 'Francesco (pelle)', righe: [{ id: U1, confermata: true, data_consegna: '30/10/2026' }] }],
  ['nessuna riga del fornitore', { fornitore: 'Francesco (pelle)', righe: [{ id: U3, confermata: true, data_consegna: null }] }],
]) {
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', payload));
  eq(`56 ${nome}: 422, zero scritture`, [r.status, st.update.length, st.checks.length], [422, 0, 0]);
}
{ // una data storta in fondo ferma TUTTO: nessuna data cambiata prima
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', { fornitore: 'Francesco (pelle)', righe: [{ id: U1, confermata: true, data_consegna: '2026-10-30' }, { id: U2, confermata: true, data_consegna: '2026-13-01' }] }));
  eq('57 una data non valida: 422 prima di ogni update', [r.status, st.update.length, st.ordini[0].data_consegna], [422, 0, null]);
}
{ // chi vuoto: supplier_checks.chi e' NOT NULL, ci si ferma prima delle date
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', { fornitore: 'Francesco (pelle)', righe: [{ id: U1, confermata: true, data_consegna: '2026-10-30' }] }, ''));
  eq('58 chi vuoto: 422, nessuna data toccata', [r.status, st.update.length], [422, 0]);
}
{ // un altro membro del team puo' verificare: si registra col suo chi (la vista conta solo la giocatrice)
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', { fornitore: 'Francesco (pelle)', righe: [{ id: U1, confermata: true, data_consegna: '2026-10-30' }] }, 'Bene'));
  eq('59 verifica di Bene: salvata con chi Bene', [r.status, st.checks[0]?.chi], [200, 'Bene']);
}
{ // lettura delle righe fallita: ci si ferma (Regola 20 a), mai "nessuna riga"
  const { st, ctx } = mondo({ rompi: 'supplier_orders.select' });
  const r = await run(ctx('fornitore_verifica', { fornitore: 'Francesco (pelle)', righe: [{ id: U1, confermata: true, data_consegna: '2026-10-30' }] }));
  eq('60 righe non leggibili: 503, zero scritture', [r.status, st.update.length, st.checks.length], [503, 0, 0]);
}
{ // update fallito: niente verifica registrata
  const { st, ctx } = mondo({ rompi: 'supplier_orders.update' });
  const r = await run(ctx('fornitore_verifica', { fornitore: 'Francesco (pelle)', righe: [{ id: U1, confermata: true, data_consegna: '2026-10-30' }] }));
  eq('61 update fallito: 400, nessun change_log, nessuna verifica', [r.status, st.log.length, st.checks.length], [400, 0, 0]);
}
{ // insert della verifica fallito: errore con le date gia' cambiate
  const { ctx } = mondo({ rompi: 'supplier_checks.insert' });
  const r = await run(ctx('fornitore_verifica', { fornitore: 'Francesco (pelle)', righe: [{ id: U1, confermata: true, data_consegna: '2026-10-30' }] }));
  eq('62 verifica non registrata: 400 con date_cambiate', [r.status, r.body.ok ?? false, r.body.date_cambiate], [400, false, 1]);
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exitCode = ko ? 1 : 0;   // non process.exit(): su Windows (Node 24) ogni tanto chiude con "Assertion failed ... UV_HANDLE_CLOSING"
