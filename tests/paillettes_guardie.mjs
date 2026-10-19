// tests/paillettes_guardie.mjs: guardie delle Paillettes del Villaggio (migr 0164, write-api v29, 16-10, rivista il 17-10).
//   node tests/paillettes_guardie.mjs   (Node 24 strippa i tipi TS all'import)
//
// Due meta'. Sul SORGENTE della migrazione: cio' che tiene il modulo spento alla nascita (Regola 19), fuori dalla anon
// key (RLS e niente grant sulle tabelle nuove, viste in sola lettura) e cio' che fa dire alla vista eventi solo la
// verita' (solo la giocatrice, solo da `dal`, ordini contati sulle righe che esistono ancora, arrivi solo in aumento e
// non annullati, conte nel giorno in cui sono state fatte). Su write-api: il blocco delle tre azioni e' ritagliato DAL
// SORGENTE che va in produzione ed eseguito contro un database finto in memoria (come tests/arrivo_adesso.mjs), piu' le
// cinture sul sorgente. Nessuna rete.
// Fase 3 (18-10, migr 0167, write-api v30): pin sulla 0167 (v_tempi_laboratori; v_villaggio_eventi uguale alla 0164 salvo
// la verifica che conta le righe sistemate e la data aggiunta dalle righe nate con la data), `chiudi` della verifica e la
// nuova `order_update`, ritagliata anche lei dal sorgente e fatta girare sullo stesso DB finto.
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

const TAB = 'vil_presenze|vil_verifiche|vil_conte_complete';
console.log('\n== migrazione 0164: spenta alla nascita, una transazione ==');
t('1  begin; ... commit; in una transazione', /^begin;$/m.test(M) && /^commit;$/m.test(M) && M.indexOf('begin;') < M.indexOf('commit;'));
t("2  villaggio_paillettes_enabled nasce 'false'", /\('villaggio_paillettes_enabled', 'false'\)/.test(m));
t("3  dal '2026-10-17' (segnaposto: al go-live = giorno dell'accensione) e giocatrice 'Ginevra'", /\('villaggio_paillettes_dal', '2026-10-17'\)/.test(m) && /\('villaggio_paillettes_chi', 'Ginevra'\)/.test(m)
  && /-- dal = giorno dell'accensione, si parte da zero \(Dan 17-10\)/.test(M));
t('4  flag con on conflict (key) do nothing (un re-run non spegne ne\' sposta nulla)', /\('villaggio_paillettes_chi', 'Ginevra'\)\s*on conflict \(key\) do nothing;/.test(m));
t('5  rollback dichiarato in fondo: flag a false', /-- Rollback: update app_flags set value = 'false' where key = 'villaggio_paillettes_enabled'/.test(M));
t('6  nessun tocco a tabelle core (niente alter/insert/update/delete fuori da app_flags e dalle tabelle nuove)',
  !new RegExp(`alter table (?!${TAB})\\w+`, 'i').test(m) && !/\b(update|delete from)\s+(?!app_flags)\w+/i.test(m.replace(/for (insert|update|delete)/g, ''))
  && ![...m.matchAll(/insert into (\w+)/g)].some((x) => x[1] !== 'app_flags'));
t('7  il nome vecchio supplier_checks non esiste piu\' (Regola 19: prefisso del modulo)', !/supplier_checks/.test(M) && !/supplier_checks/.test(SRC));

console.log('\n== tabelle nuove: forma del contratto, RLS, nessun grant ==');
t('8  vil_presenze (chi, giorno, ts) con PK (chi, giorno)', /create table if not exists vil_presenze \(\s*chi\s+text not null,\s*giorno\s+date not null,\s*ts\s+timestamptz not null default now\(\),\s*primary key \(chi, giorno\)\s*\);/.test(m));
t('9  vil_verifiche (id, ts, giorno, fornitore, chi, righe jsonb array, nota)',
  /create table if not exists vil_verifiche \(\s*id\s+uuid primary key default gen_random_uuid\(\),\s*ts\s+timestamptz not null default now\(\),\s*giorno\s+date not null,\s*fornitore\s+text not null,\s*chi\s+text not null,\s*righe\s+jsonb not null check \(jsonb_typeof\(righe\) = 'array'\),\s*nota\s+text\s*\);/.test(m));
t("10 vil_conte_complete (chi, mese 'YYYY-MM' col check, ts, codici >= 0) con PK (chi, mese)",
  /create table if not exists vil_conte_complete \(\s*chi\s+text not null,\s*mese\s+text not null check \(mese ~ '\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$'\),\s*ts\s+timestamptz not null default now\(\),\s*codici\s+int not null check \(codici >= 0\),\s*primary key \(chi, mese\)\s*\);/.test(m));
{ // il check del mese, preso dal sorgente, contro i casi veri (la regex SQL e' POSIX ma qui e' la stessa in JS)
  const re = new RegExp(/mese ~ '([^']+)'/.exec(m)?.[1] ?? 'x^');
  eq('11 check del mese: 2026-10 e 2026-01 si, 2026-13, 2026-00, 2026-1, 2026-10-01 no',
    ['2026-10', '2026-01', '2026-12', '2026-13', '2026-00', '2026-1', '2026-10-01', '26-10'].map((x) => re.test(x)), [true, true, true, false, false, false, false, false]);
}
t('12 RLS accesa su tutte e tre', ['vil_presenze', 'vil_verifiche', 'vil_conte_complete'].every((x) => new RegExp(`alter table ${x} enable row level security;`).test(m)));
t('13 privilegi revocati ad anon e authenticated (i default di public darebbero select)', /revoke all on vil_presenze, vil_verifiche, vil_conte_complete from public, anon, authenticated;/.test(m));
t('14 nessun grant e nessuna policy sulle tabelle nuove', !new RegExp(`grant [^;]* on [^;]*(${TAB})`, 'i').test(m) && !/create policy/i.test(m));

console.log('\n== viste: settings con le 4 chiavi, eventi in sola lettura ==');
t('15 v_villaggio_settings con villaggio_enabled + le 3 chiavi Paillettes',
  /create or replace view v_villaggio_settings as\nselect key, value from app_flags\nwhere key in \('villaggio_enabled', 'villaggio_paillettes_enabled', 'villaggio_paillettes_dal', 'villaggio_paillettes_chi'\);/.test(m));
t('16 v_villaggio_eventi senza security_invoker (owner postgres: anon non vede le tabelle sotto)', /create or replace view v_villaggio_eventi as\n/.test(m) && !/security_invoker/.test(m) && /alter view v_villaggio_eventi owner to postgres;/.test(m));
t('17 viste: revoke da public, anon, authenticated e poi SOLO select', /revoke all on v_villaggio_settings, v_villaggio_eventi from public, anon, authenticated;\ngrant select on v_villaggio_settings, v_villaggio_eventi to anon, authenticated;/.test(m) && !/grant (insert|update|delete|all)/i.test(m));
t('18 colonne tipo, giorno, ts, ref, n', /select ev\.tipo, ev\.giorno, ev\.ts, ev\.ref, ev\.n\nfrom ev\ncross join cfg/.test(m));
t('19 i sette tipi del contratto', ['presenza', 'ordine', 'arrivo', 'conta', 'verifica', 'data_aggiunta', 'conta_completa'].every((x) => new RegExp(`select '${x}'`).test(m)));
t('20 legge le tre chiavi da app_flags', /where key in \('villaggio_paillettes_enabled', 'villaggio_paillettes_chi', 'villaggio_paillettes_dal'\)/.test(m));
t("21 flag spento = nessuna riga (acceso solo se 'true')", /coalesce\(max\(value\) filter \(where key = 'villaggio_paillettes_enabled'\) = 'true', false\) as acceso/.test(m) && /where cfg\.acceso and /.test(m));
t('22 filtro giocatrice: chi = villaggio_paillettes_chi', /max\(value\) filter \(where key = 'villaggio_paillettes_chi'\) as chi/.test(m) && /ev\.chi = cfg\.chi/.test(m));
t('23 filtro dal: ts >= dal, mezzanotte di Roma', /::timestamp at time zone 'Europe\/Rome' as dal/.test(m) && /ev\.ts >= cfg\.dal;/.test(m));
t('24 dal letto in modo sicuro: regex ISO + pg_input_is_valid prima del cast (storto = NULL = nessuna riga)',
  /case when key = 'villaggio_paillettes_dal' and value ~ '\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$' and pg_input_is_valid\(value, 'date'\)\s*then value::date end/.test(m));
t('25 giorno = data di Roma del ts per ordine, arrivo (change_log), conta (counts) e conta completa',
  (m.match(/\(c\.ts at time zone 'Europe\/Rome'\)::date/g) ?? []).length === 2 && /\(k\.ts at time zone 'Europe\/Rome'\)::date/.test(m) && /\(x\.ts at time zone 'Europe\/Rome'\)::date/.test(m));
t("26 ordine: change_log op order_multi source write-api, ref = row_id (gruppo)", /select 'ordine', \(c\.ts at time zone 'Europe\/Rome'\)::date, c\.ts, c\.row_id,/.test(m) && /where c\.op = 'order_multi' and c\.source = 'write-api'/.test(m));
t('27 ordine: n = righe di supplier_orders del gruppo che ESISTONO ANCORA', /\(select count\(\*\)::int from supplier_orders so where so\.gruppo::text = c\.row_id\)/.test(m));
t("28 arrivo: solo arrival_set da write-api con delta > 0, n = delta", /where c\.op = 'arrival_set' and c\.source = 'write-api'\n\s+and \(case when jsonb_typeof\(c\.after -> 'delta'\) = 'number' then \(c\.after -> 'delta'\)::numeric end\) > 0/.test(m) && /c\.row_id, \(c\.after -> 'delta'\)::numeric::int, c\.chi/.test(m));
t('29 arrivo: solo se la riga ordine esiste ancora con qty_arrived > 0 (un arrivo annullato non vale)',
  /> 0\n\s+and exists \(select 1 from supplier_orders so where so\.id::text = c\.row_id and so\.qty_arrived > 0\)\n\s+union all/.test(m));
t('30 conta: da counts, ref = codice, giorno = data di Roma del ts (data_conta la sceglie il chiamante), n = 1',
  /select 'conta', \(k\.ts at time zone 'Europe\/Rome'\)::date, k\.ts, k\.codice, 1, k\.chi\n\s+from counts k/.test(m) && !/data_conta/.test(m));
t('31 presenza: ref = giorno, n = 1', /select 'presenza'::text as tipo, p\.giorno, p\.ts, p\.giorno::text as ref, 1 as n, p\.chi\n\s+from vil_presenze p/.test(m));
t('32 verifica: da vil_verifiche, ref = fornitore, n = righe con confermata true', /select 'verifica', s\.giorno, s\.ts, s\.fornitore,\n\s+\(select count\(\*\)::int from jsonb_array_elements\(s\.righe\) e where e -> 'confermata' = 'true'::jsonb\), s\.chi\n\s+from vil_verifiche s/.test(m));
t('33 data_aggiunta: una riga per elemento con data_prima null e data_dopo non null, ref = id', /select 'data_aggiunta', s\.giorno, s\.ts, e ->> 'id', 1, s\.chi\n\s+from vil_verifiche s/.test(m) && /where e ->> 'data_prima' is null and e ->> 'data_dopo' is not null/.test(m));
t('34 conta_completa: da vil_conte_complete, ref = mese, n = codici', /select 'conta_completa', \(x\.ts at time zone 'Europe\/Rome'\)::date, x\.ts, x\.mese, x\.codici, x\.chi\n\s+from vil_conte_complete x\n\)/.test(m));

console.log('\n== write-api v29: cinture sul sorgente ==');
const BEGIN = '  // --- PAILLETTES (v29, migr 0164)', END = "  // v21: l'insert generico 'order' bypassava";
const a = SRC.indexOf(BEGIN), b = SRC.indexOf(END);
if (a < 0 || b < 0 || b < a) { console.error('blocco Paillettes non trovato in write-api/index.ts'); process.exit(1); }
const BLK = SRC.slice(a, b), F = flat(BLK);
const at = (s) => BLK.indexOf(s);
t('35 le tre azioni nello stesso blocco', /if \(action === 'villaggio_presenza' \|\| action === 'villaggio_conta_completa' \|\| action === 'fornitore_verifica'\)/.test(BLK));
t('36 flag letto da app_flags con error destrutturato e retryOnce (Regola 20 a)', /const \{ data: flags, error: fe \} = await retryOnce\(\(\) => sb\.from\('app_flags'\)\.select\('key, value'\)\.in\('key', \['villaggio_paillettes_enabled', 'villaggio_paillettes_chi'\]\)\);/.test(F));
t('37 lettura del flag fallita = 503, mai "acceso"', /if \(fe\) return json\(\{ error: `[^`]*` \}, 503\);/.test(BLK) && at('if (fe)') < at("!== 'true'"));
t("38 flag diverso da 'true' = 409 paillettes spente, prima di ogni scrittura delle tre azioni", /if \(flag\('villaggio_paillettes_enabled'\) !== 'true'\) return json\(\{ error: 'paillettes spente' \}, 409\);/.test(BLK)
  && [at("sb.from('vil_presenze')"), at("sb.from('vil_conte_complete')"), at('.update('), at("sb.from('vil_verifiche')")].every((i) => i > 0 && at("'paillettes spente'") < i));
t('39 presenza: chi diverso dalla giocatrice = ok ignorata, nessuna scrittura', /if \(!chi \|\| chi !== flag\('villaggio_paillettes_chi'\)\) return json\(\{ ok: true, nuova: false, ignorata: true \}\);/.test(BLK)
  && at('ignorata: true') < at("sb.from('vil_presenze')"));
t('40 presenza idempotente: on conflict (chi, giorno) do nothing, giorno = oggi a Roma', /sb\.from\('vil_presenze'\)\.upsert\(\{ chi, giorno: today \}, \{ onConflict: 'chi,giorno', ignoreDuplicates: true \}\)\.select\('giorno'\)/.test(F) && /const today = todayRome\(\)/.test(SRC));
t('41 presenza e conta completa: niente change_log (non sono dati di business)', !/logp\('vil_/.test(BLK) && !/tbl: 'vil_/.test(BLK));
{
  const CC = BLK.slice(at("if (action === 'villaggio_conta_completa') {"), at('const fornitore ='));
  t('42 conta completa: codici con num() intero >= 0, altrimenti 422', /const codici = num\(payload\.codici, \{ integer: true, min: 0 \}\);\n\s+if \(codici == null\) return json\(\{ error: '[^']+' \}, 422\);/.test(CC));
  t('43 conta completa: chi diverso dalla giocatrice = ok ignorata prima della scrittura', /if \(!chi \|\| chi !== flag\('villaggio_paillettes_chi'\)\) return json\(\{ ok: true, nuova: false, ignorata: true \}\);/.test(CC)
    && CC.indexOf('ignorata: true') < CC.indexOf("sb.from('vil_conte_complete')"));
  t('44 conta completa: una al mese, mese di Roma da todayRome, on conflict (chi, mese) do nothing', /sb\.from\('vil_conte_complete'\)\.upsert\(\{ chi, mese: today\.slice\(0, 7\), codici \}, \{ onConflict: 'chi,mese', ignoreDuplicates: true \}\)\.select\('mese'\)/.test(flat(CC))
    && /if \(ke\) return json\(\{ error: ke\.message \}, 400\);\n\s+return json\(\{ ok: true, nuova: \(ins \?\? \[\]\)\.length > 0 \}\);/.test(CC));
}
t('45 verifica: una lettura filtrata per fornitore, con quantita\' e wip, error destrutturato', /const \{ data: lette, error: le \} = /.test(BLK)
  && /String\(r\?\.id \?\? ''\)\.trim\(\)\.toLowerCase\(\)/.test(BLK)
  && /sb\.from\('supplier_orders'\)\.select\('id, codice, data_consegna, qty_ordered, qty_arrived, wip'\)\.in\('id', \[\.\.\.chieste\.keys\(\)\]\)\.eq\('fornitore', fornitore\)/.test(F) && /if \(le\) return json\(/.test(BLK));
t('46 verifica: solo le righe aperte (wip o qty_arrived < qty_ordered, con num(): qty_ordered null = chiusa come in SQL)', /\.filter\(\(r\) => r\.wip === true \|\| \(num\(r\.qty_arrived\) \?\? 0\) < \(num\(r\.qty_ordered\) \?\? 0\)\)/.test(BLK) && /for \(const r of aperte\)/.test(BLK));
t('47 verifica: una data vuota non cancella mai una data (dopo = chiesta ?? prima)', /const dopo = ch\.data \?\? prima;/.test(BLK));
t('48 verifica: update della SOLA data e solo se cambia', /if \(prima !== dopo\) \{\n\s+const \{ error: ue \} = await sb\.from\('supplier_orders'\)\.update\(\{ data_consegna: dopo \}\)\.eq\('id', r\.id\);/.test(BLK));
t("49 verifica: change_log op order_date con before e after", /await logp\('supplier_orders', String\(r\.id\), 'order_date', \{ codice: r\.codice, fornitore, data_consegna: dopo \}, \{ data_consegna: prima \}\);/.test(BLK)
  && /\.\.\.\(before !== undefined \? \{ before \} : \{\}\),/.test(SRC));
t('50 verifica: vil_verifiche con giorno di Roma e righe data_prima/data_dopo/confermata', /sb\.from\('vil_verifiche'\)\.insert\(\{ giorno: today, fornitore, chi, righe, nota \}\)\.select\('id'\)\.single\(\)/.test(F)
  && /righe\.push\(\{ id: r\.id, codice: r\.codice, confermata: ch\.confermata, data_prima: prima, data_dopo: dopo \}\);/.test(BLK));
t('51 verifica: niente compare-and-set e niente op_id (scelta di Dan, 16-10)', !/op_id/.test(noTs(BLK)) && !/\.update\([^)]*\)\.eq\('id', r\.id\)\.eq\(/.test(F));
t('52 date validate con isoDate (lib.ts), mai new Date()', /isoDate\(r\.data_consegna\)/.test(BLK) && !/new Date\(/.test(BLK));

console.log('\n== write-api v29: il blocco vero contro un database finto ==');
const TMP = `${ROOT}tests/_paillettes.${process.pid}.tmp.ts`;
writeFileSync(TMP, `import { isoDate, num } from '../supabase/functions/write-api/lib.ts';
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
const U4 = '44444444-4444-4444-8444-444444444444', U5 = '55555555-5555-4555-8555-555555555555';
const FR = 'Francesco (pelle)';
// Database finto con le sole catene che il blocco usa. `rompi` fa fallire una tabella+operazione ('tbl.op'), oppure
// solo la n-esima chiamata ('tbl.op#n').
const mondo = ({ acceso = 'true', giocatrice = 'Ginevra', rompi = null, today = '2026-10-17' } = {}) => {
  const st = {
    flags: [{ key: 'villaggio_paillettes_enabled', value: acceso }, { key: 'villaggio_paillettes_chi', value: giocatrice }],
    presenze: [], conte: [], checks: [], log: [], letture: [], update: [], chiamate: {},
    ordini: [
      { id: U1, codice: 'LEA_BAG_ROSSO', fornitore: FR, data_consegna: null, qty_ordered: 10, qty_arrived: 0, wip: false, costo_unitario: null, note: null },
      { id: U2, codice: 'AGATA_NERO', fornitore: FR, data_consegna: '2026-10-20', qty_ordered: 6, qty_arrived: 2, wip: false, costo_unitario: 40, note: null },
      { id: U3, codice: 'RITA_VERDE', fornitore: 'Altro lab', data_consegna: null, qty_ordered: 4, qty_arrived: 0, wip: false, costo_unitario: '38.50', note: 'interno nero' },
      // chiusa: tutto arrivato, non si verifica piu'
      { id: U4, codice: 'LEA_BAG_NERO', fornitore: FR, data_consegna: null, qty_ordered: 5, qty_arrived: 5, wip: false, costo_unitario: 42, note: null },
      // WIP: quantita' da definire (qty 0), e' aperta
      { id: U5, codice: 'MIA_BAG_ORO', fornitore: FR, data_consegna: null, qty_ordered: 0, qty_arrived: 0, wip: true, costo_unitario: null, note: null },
    ],
  };
  const exec = (q) => {
    const k = `${q.tbl}.${q.op}`;
    st.chiamate[k] = (st.chiamate[k] ?? 0) + 1;
    if (rompi && (rompi === k || rompi === `${k}#${st.chiamate[k]}`)) return { data: null, error: { message: 'errore finto' } };
    const passa = (r) => q.filtri.every(([c, v, op]) => (op === 'in' ? v.includes(r[c]) : r[c] === v));
    if (q.tbl === 'app_flags' && q.op === 'select') return { data: st.flags.filter(passa), error: null };
    if (q.tbl === 'vil_presenze' && q.op === 'upsert') {
      const c = q.body;
      if (st.presenze.some((p) => p.chi === c.chi && p.giorno === c.giorno)) return { data: [], error: null };
      st.presenze.push({ ...c }); return { data: [{ giorno: c.giorno }], error: null };
    }
    if (q.tbl === 'vil_conte_complete' && q.op === 'upsert') {
      const c = q.body;
      if (q.opts?.onConflict !== 'chi,mese' || q.opts?.ignoreDuplicates !== true) throw new Error('upsert senza on conflict (chi, mese) do nothing');
      if (st.conte.some((p) => p.chi === c.chi && p.mese === c.mese)) return { data: [], error: null };
      st.conte.push({ ...c }); return { data: [{ mese: c.mese }], error: null };
    }
    if (q.tbl === 'supplier_orders' && q.op === 'select') {
      st.letture.push({ cols: q.cols, filtri: q.filtri });
      const trovate = st.ordini.filter(passa).map((r) => ({ ...r }));
      if (q.uno && trovate.length > 1) throw new Error('maybeSingle con piu\' di una riga');
      return { data: q.uno ? (trovate[0] ?? null) : trovate, error: null };
    }
    if (q.tbl === 'supplier_orders' && q.op === 'update') {
      st.update.push(Object.keys(q.body));
      st.ordini.filter(passa).forEach((r) => Object.assign(r, q.body)); return { data: null, error: null };
    }
    if (q.tbl === 'vil_verifiche' && q.op === 'insert') { st.checks.push(q.body); return { data: { id: 'chk' + st.checks.length }, error: null }; }
    throw new Error(`query non prevista dal DB finto: ${q.tbl}.${q.op}`);
  };
  const sb = { from: (tbl) => {
    const q = { tbl, op: 'select', filtri: [], body: null, opts: null, cols: null };
    const k = {
      select(cols) { if (q.op === 'select') q.cols = cols; return k; },
      update(body) { q.op = 'update'; q.body = body; return k; },
      insert(body) { q.op = 'insert'; q.body = body; return k; },
      upsert(body, opts) { q.op = 'upsert'; q.body = body; q.opts = opts; return k; },
      eq(c, v) { q.filtri.push([c, v, 'eq']); return k; },
      in(c, v) { q.filtri.push([c, v, 'in']); return k; },
      single() { return k; },
      maybeSingle() { q.uno = true; return k; },
      then(res, rej) { return Promise.resolve().then(() => exec(q)).then(res, rej); },
    };
    return k;
  } };
  const ctx = (action, payload, chi = 'Ginevra') => ({
    action, payload, sb, today, chi,
    json: (body, status = 200) => ({ status, body }),
    retryOnce: async (fn) => await fn(), logp: async (...args) => { st.log.push(args); },
  });
  return { st, ctx };
};
const verifica = (righe, extra = {}) => ({ fornitore: FR, righe, ...extra });

{ // flag spento: tutte e tre 409, nessuna scrittura
  const { st, ctx } = mondo({ acceso: 'false' });
  const p = await run(ctx('villaggio_presenza', {}));
  const c = await run(ctx('villaggio_conta_completa', { codici: 120 }));
  const v = await run(ctx('fornitore_verifica', verifica([{ id: U1, confermata: true, data_consegna: '2026-11-01' }])));
  eq("53 flag 'false': presenza, conta completa e verifica 409 paillettes spente, zero scritture",
    [p.status, p.body.error, c.status, c.body.error, v.status, v.body.error, st.presenze.length, st.conte.length, st.update.length, st.checks.length],
    [409, 'paillettes spente', 409, 'paillettes spente', 409, 'paillettes spente', 0, 0, 0, 0]);
}
{ // flag assente = spento
  const { st, ctx } = mondo({ acceso: null });
  st.flags = st.flags.filter((f) => f.key !== 'villaggio_paillettes_enabled');
  const p = await run(ctx('villaggio_presenza', {}));
  const c = await run(ctx('villaggio_conta_completa', { codici: 3 }));
  eq('54 flag assente = spento: 409', [p.status, c.status, st.presenze.length, st.conte.length], [409, 409, 0, 0]);
}
{ // lettura del flag fallita: 503 e niente scritto
  const { st, ctx } = mondo({ rompi: 'app_flags.select' });
  const p = await run(ctx('villaggio_presenza', {}));
  const c = await run(ctx('villaggio_conta_completa', { codici: 3 }));
  const v = await run(ctx('fornitore_verifica', verifica([{ id: U1, confermata: true, data_consegna: '2026-11-01' }])));
  eq('55 flag non leggibile: 503 per tutte e tre, nessuna scrittura', [p.status, c.status, v.status, st.presenze.length, st.conte.length, st.update.length], [503, 503, 503, 0, 0, 0]);
}
{ // presenza: la prima del giorno e' nuova, la seconda no
  const { st, ctx } = mondo();
  const r1 = await run(ctx('villaggio_presenza', {}));
  const r2 = await run(ctx('villaggio_presenza', {}));
  eq('56 presenza: nuova true poi false, una sola riga col giorno di Roma', [r1.status, r1.body, r2.body, st.presenze], [200, { ok: true, nuova: true }, { ok: true, nuova: false }, [{ chi: 'Ginevra', giorno: '2026-10-17' }]]);
  t('57 presenza: niente change_log', st.log.length === 0);
}
{ // chi diverso dalla giocatrice (o vuoto): ignorata
  const { st, ctx } = mondo();
  const r1 = await run(ctx('villaggio_presenza', {}, 'Bene'));
  const r2 = await run(ctx('villaggio_presenza', {}, ''));
  eq('58 chi non giocatrice o vuoto: ok ignorata, nessuna riga', [r1.status, r1.body, r2.body, st.presenze.length], [200, { ok: true, nuova: false, ignorata: true }, { ok: true, nuova: false, ignorata: true }, 0]);
}
{ // presenza: insert fallito = errore, non "ok"
  const { ctx } = mondo({ rompi: 'vil_presenze.upsert' });
  const r = await run(ctx('villaggio_presenza', {}));
  t('59 presenza: insert fallito = 400, mai ok', r.status === 400 && !r.body.ok);
}

console.log('\n   -- conta completa: una registrazione al mese --');
{ // la prima del mese e' nuova; la seconda dello stesso mese no e non cambia i codici; il mese dopo si riparte
  const { st, ctx } = mondo({ today: '2026-10-31' });
  const r1 = await run(ctx('villaggio_conta_completa', { codici: 182 }));
  const r2 = await run(ctx('villaggio_conta_completa', { codici: 190 }));
  eq('60 conta completa: nuova true poi false, una riga (Ginevra, 2026-10, 182)', [r1.status, r1.body, r2.status, r2.body, st.conte], [200, { ok: true, nuova: true }, 200, { ok: true, nuova: false }, [{ chi: 'Ginevra', mese: '2026-10', codici: 182 }]]);
  t('61 conta completa: niente change_log', st.log.length === 0);
  const { st: st2, ctx: ctx2 } = mondo({ today: '2026-11-01' });
  st2.conte.push(...st.conte);
  const r3 = await run(ctx2('villaggio_conta_completa', { codici: 175 }));
  eq('62 il primo del mese dopo (giorno di Roma) e\' un mese nuovo', [r3.body, st2.conte.map((c) => c.mese)], [{ ok: true, nuova: true }, ['2026-10', '2026-11']]);
}
{ // zero codici e' una conta vera (magazzino vuoto): si registra
  const { st, ctx } = mondo();
  const r1 = await run(ctx('villaggio_conta_completa', { codici: 0 }));
  eq('63 codici 0 ammesso', [r1.status, r1.body, st.conte[0]?.codici], [200, { ok: true, nuova: true }, 0]);
}
for (const [nome, payload] of [
  ['codici assente', {}],
  ['codici null', { codici: null }],
  ["codici ''", { codici: '' }],
  ['codici -1', { codici: -1 }],
  ['codici 1.5', { codici: 1.5 }],
  ["codici 'tanti'", { codici: 'tanti' }],
  ['codici [3]', { codici: [3] }],
]) {
  const { st, ctx } = mondo();
  const r = await run(ctx('villaggio_conta_completa', payload));
  eq(`64 ${nome}: 422, nessuna riga`, [r.status, st.conte.length], [422, 0]);
}
{ // chi diverso dalla giocatrice (o vuoto): ignorata, niente scritto
  const { st, ctx } = mondo();
  const r1 = await run(ctx('villaggio_conta_completa', { codici: 50 }, 'Bene'));
  const r2 = await run(ctx('villaggio_conta_completa', { codici: 50 }, ''));
  eq('65 conta completa di chi non gioca: ok ignorata, nessuna riga', [r1.status, r1.body, r2.body, st.conte.length], [200, { ok: true, nuova: false, ignorata: true }, { ok: true, nuova: false, ignorata: true }, 0]);
}
{ // scrittura fallita = errore, non "ok"
  const { ctx } = mondo({ rompi: 'vil_conte_complete.upsert' });
  const r = await run(ctx('villaggio_conta_completa', { codici: 50 }));
  t('66 conta completa: upsert fallito = 400, mai ok', r.status === 400 && !r.body.ok);
}

console.log('\n   -- verifica fornitore --');
{ // verifica normale: una data aggiunta, una invariata, una riga di un altro fornitore e una chiusa ignorate, un WIP aperto
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', verifica([
    { id: U1, confermata: true, data_consegna: '2026-10-30' },
    { id: U2, confermata: false, data_consegna: '2026-10-20' },
    { id: U3, confermata: true, data_consegna: '2026-11-15' },
    { id: U4, confermata: true, data_consegna: '2026-11-20' },
    { id: U5, confermata: true, data_consegna: null },
    { id: 'non-un-uuid', confermata: true, data_consegna: null },
  ], { nota: '  tutto in lavorazione  ' })));
  eq('67 verifica: ok, check_id, una data cambiata, nessuna riga chiusa', [r.status, r.body], [200, { ok: true, check_id: 'chk1', date_cambiate: 1, righe_chiuse: 0 }]);
  eq('68 UNA lettura: id (solo uuid) e fornitore, con quantita\' e wip', st.letture, [{ cols: 'id, codice, data_consegna, qty_ordered, qty_arrived, wip', filtri: [['id', [U1, U2, U3, U4, U5], 'in'], ['fornitore', FR, 'eq']] }]);
  eq('69 update solo sulla riga cambiata e solo della data; la riga chiusa non si tocca',
    [st.update, st.ordini.map((o) => o.data_consegna)], [[['data_consegna']], ['2026-10-30', '2026-10-20', null, null, null]]);
  eq('70 change_log order_date con before/after sulla riga cambiata', st.log.map((l) => [l[0], l[1], l[2], l[3].data_consegna, l[4]]), [['supplier_orders', U1, 'order_date', '2026-10-30', { data_consegna: null }]]);
  eq('71 vil_verifiche: giorno di Roma, chi, nota ripulita, solo righe aperte con data_prima/data_dopo/confermata', st.checks, [{
    giorno: '2026-10-17', fornitore: FR, chi: 'Ginevra',
    righe: [
      { id: U1, codice: 'LEA_BAG_ROSSO', confermata: true, data_prima: null, data_dopo: '2026-10-30' },
      { id: U2, codice: 'AGATA_NERO', confermata: false, data_prima: '2026-10-20', data_dopo: '2026-10-20' },
      { id: U5, codice: 'MIA_BAG_ORO', confermata: true, data_prima: null, data_dopo: null },
    ],
    nota: 'tutto in lavorazione',
  }]);
}
{ // una data vuota (o null) non cancella mai una data: si ignora, data_dopo = data_prima, nessun update
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U2, confermata: true, data_consegna: '' }, { id: U1, confermata: true, data_consegna: null }])));
  eq("72 data '' o null: nessuna data tolta, nessun update ne' change_log", [r.status, r.body.date_cambiate, st.update.length, st.log.length, st.ordini[1].data_consegna], [200, 0, 0, 0, '2026-10-20']);
  eq('73 ... e la verifica registra la data che resta (data_dopo = data_prima)', st.checks[0].righe.map((x) => [x.id, x.data_prima, x.data_dopo]), [[U1, null, null], [U2, '2026-10-20', '2026-10-20']]);
}
{ // correggere una data e' un cambio: update e change_log con la data vecchia nel before
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U2, confermata: true, data_consegna: '2026-11-05' }])));
  eq('74 data corretta: update e change_log con before', [r.body.date_cambiate, st.ordini[1].data_consegna, st.log[0]?.[4], st.checks[0].righe[0].data_dopo], [1, '2026-11-05', { data_consegna: '2026-10-20' }, '2026-11-05']);
}
for (const [nome, payload] of [
  ['fornitore vuoto', { fornitore: '  ', righe: [{ id: U1, confermata: true, data_consegna: null }] }],
  ['righe vuote', verifica([])],
  ['righe non array', { fornitore: FR, righe: 'x' }],
  ['data 2026-02-30', verifica([{ id: U1, confermata: true, data_consegna: '2026-02-30' }])],
  ['data 30/10/2026', verifica([{ id: U1, confermata: true, data_consegna: '30/10/2026' }])],
  ['nessuna riga del fornitore', verifica([{ id: U3, confermata: true, data_consegna: null }])],
  ['solo righe chiuse', verifica([{ id: U4, confermata: true, data_consegna: '2026-11-20' }])],
]) {
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', payload));
  eq(`75 ${nome}: 422, zero scritture`, [r.status, st.update.length, st.checks.length], [422, 0, 0]);
}
{ // quantita' come stringhe numeriche (numeric di PostgREST) e qty_ordered null: come in SQL, null = non aperta
  const { st, ctx } = mondo();
  Object.assign(st.ordini[0], { qty_ordered: '3', qty_arrived: '1' });
  Object.assign(st.ordini[1], { qty_ordered: null, qty_arrived: 0 });
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U1, confermata: true, data_consegna: '2026-10-30' }, { id: U2, confermata: true, data_consegna: '2026-11-05' }])));
  eq("75b qty '1' di '3' aperta, qty_ordered null chiusa", [r.status, st.checks[0]?.righe.map((x) => x.id), st.ordini[1].data_consegna], [200, [U1], '2026-10-20']);
}
{ // una data storta in fondo ferma TUTTO: nessuna data cambiata prima
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U1, confermata: true, data_consegna: '2026-10-30' }, { id: U2, confermata: true, data_consegna: '2026-13-01' }])));
  eq('76 una data non valida: 422 prima di ogni update', [r.status, st.update.length, st.ordini[0].data_consegna], [422, 0, null]);
}
{ // chi vuoto: vil_verifiche.chi e' NOT NULL, ci si ferma prima delle date
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U1, confermata: true, data_consegna: '2026-10-30' }]), ''));
  eq('77 chi vuoto: 422, nessuna data toccata', [r.status, st.update.length], [422, 0]);
}
{ // un altro membro del team puo' verificare: si registra col suo chi (la vista conta solo la giocatrice)
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U1, confermata: true, data_consegna: '2026-10-30' }]), 'Bene'));
  eq('78 verifica di Bene: salvata con chi Bene', [r.status, st.checks[0]?.chi], [200, 'Bene']);
}
{ // lettura delle righe fallita: ci si ferma (Regola 20 a), mai "nessuna riga"
  const { st, ctx } = mondo({ rompi: 'supplier_orders.select' });
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U1, confermata: true, data_consegna: '2026-10-30' }])));
  eq('79 righe non leggibili: 503, zero scritture', [r.status, st.update.length, st.checks.length], [503, 0, 0]);
}
{ // update fallito: niente verifica registrata
  const { st, ctx } = mondo({ rompi: 'supplier_orders.update' });
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U1, confermata: true, data_consegna: '2026-10-30' }])));
  eq('80 update fallito: 400, nessun change_log, nessuna verifica', [r.status, st.log.length, st.checks.length], [400, 0, 0]);
}
{ // a meta' strada (accettato, Dan 17-10): la prima data resta scritta col suo change_log, la verifica non si registra,
  // quindi quella data aggiunta perde i suoi 15 punti (al nuovo tentativo data_prima non e' piu' null)
  const { st, ctx } = mondo({ rompi: 'supplier_orders.update#2' });
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U1, confermata: true, data_consegna: '2026-10-30' }, { id: U5, confermata: true, data_consegna: '2026-11-10' }])));
  eq('81 update fallito alla seconda riga: 400, prima data scritta e loggata, nessuna verifica',
    [r.status, st.ordini[0].data_consegna, st.ordini[4].data_consegna, st.log.length, st.checks.length], [400, '2026-10-30', null, 1, 0]);
  const { st: st2, ctx: ctx2 } = mondo();
  st2.ordini = st.ordini.map((o) => ({ ...o }));
  const r2 = await run(ctx2('fornitore_verifica', verifica([{ id: U1, confermata: true, data_consegna: '2026-10-30' }, { id: U5, confermata: true, data_consegna: '2026-11-10' }])));
  eq('82 ... il nuovo tentativo registra U1 con data_prima gia\' piena (niente data_aggiunta per lei)', [r2.status, st2.checks[0].righe.map((x) => [x.data_prima, x.data_dopo])], [200, [['2026-10-30', '2026-10-30'], [null, '2026-11-10']]]);
}
{ // insert della verifica fallito: errore con le date gia' cambiate
  const { ctx } = mondo({ rompi: 'vil_verifiche.insert' });
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U1, confermata: true, data_consegna: '2026-10-30' }])));
  eq('83 verifica non registrata: 400 con date_cambiate', [r.status, r.body.ok ?? false, r.body.date_cambiate], [400, false, 1]);
}

console.log('\n== migrazione 0167: due viste in sola lettura, una transazione ==');
const M6 = read('supabase/migrations/0167_villaggio_fase3.sql');
const m6 = noSql(M6);
t('84 begin; ... commit; in una sola transazione', (M6.match(/^begin;$/gm) ?? []).length === 1 && /^commit;$/m.test(M6) && M6.indexOf('begin;') < M6.indexOf('commit;'));
t('85 nessuna tabella, nessuna scrittura di dati, nessun flag: solo viste, owner, revoke e grant',
  !/create table/i.test(m6) && !/\b(insert into|delete from|alter table|drop )/i.test(m6) && !/\bupdate\s+\w+\s+set\b/i.test(m6)
  && !/app_flags \(/.test(m6) && !/v_villaggio_settings/.test(m6));
t('86 v_tempi_laboratori: fornitore, giorni_mediani (mediana arrotondata, intera), righe; solo laboratori con almeno 3 righe',
  /create or replace view v_tempi_laboratori as\n/.test(m6)
  && /select fornitore,\n\s+round\(percentile_cont\(0\.5\) within group \(order by giorni\)::numeric\)::int as giorni_mediani,\n\s+count\(\*\)::int as righe\nfrom righe\ngroup by fornitore\nhaving count\(\*\) >= 3;/.test(m6));
t('87 primo arrivo = primo AUMENTO in change_log da arrival (qty) o arrival_set (delta), cast solo sui numeri',
  /select c\.row_id, min\(c\.ts\) as ts\n\s+from change_log c\n\s+where c\.tbl = 'supplier_orders' and c\.op in \('arrival', 'arrival_set'\)\n\s+and coalesce\(case when jsonb_typeof\(c\.after -> 'delta'\) = 'number' then \(c\.after -> 'delta'\)::numeric end,\n\s+case when jsonb_typeof\(c\.after -> 'qty'\) = 'number' then \(c\.after -> 'qty'\)::numeric end, 0\) > 0\n\s+group by c\.row_id/.test(m6));
t("88 solo righe scritte PRIMA dell'arrivo: giorno del primo arrivo dopo il giorno di creazione (date di Roma)",
  /and \(p\.ts at time zone 'Europe\/Rome'\)::date > \(so\.created_at at time zone 'Europe\/Rome'\)::date/.test(m6));
t('89 giorni = primo arrivo meno data_ordine, ultimi 365 giorni (oggi di Roma), mai un primo arrivo prima di data_ordine',
  /\(p\.ts at time zone 'Europe\/Rome'\)::date - so\.data_ordine as giorni/.test(m6) && /and so\.data_ordine >= \(now\(\) at time zone 'Europe\/Rome'\)::date - 365/.test(m6)
  && /and \(p\.ts at time zone 'Europe\/Rome'\)::date >= so\.data_ordine\n\)/.test(m6));
{
  const vista = (s) => { const i = s.indexOf('create or replace view v_villaggio_eventi as'), j = s.indexOf('where cfg.acceso and ev.chi = cfg.chi and ev.ts >= cfg.dal;', i); return i < 0 || j < 0 ? '' : s.slice(i, j); };
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const V4 = norm(vista(m)), V6 = norm(vista(m6));
  const VER4 = norm(`select 'verifica', s.giorno, s.ts, s.fornitore, (select count(*)::int from jsonb_array_elements(s.righe) e where e -> 'confermata' = 'true'::jsonb), s.chi from vil_verifiche s`);
  const VER6 = norm(`select 'verifica', s.giorno, s.ts, s.fornitore, (select count(*)::int from jsonb_array_elements(s.righe) e where e -> 'chiusa' = 'true'::jsonb or ((e ->> 'data_dopo') is not null and (e ->> 'data_dopo') is distinct from (e ->> 'data_prima'))), s.chi from vil_verifiche s`);
  const NATA = norm(`union all select 'data_aggiunta', (so.created_at at time zone 'Europe/Rome')::date, so.created_at, so.id::text, 1, so.chi from supplier_orders so where so.data_consegna is not null and not exists (select 1 from change_log c where c.tbl = 'supplier_orders' and c.row_id = so.id::text and c.op in ('order_date', 'order_update') and c.before -> 'data_consegna' = 'null'::jsonb)`);
  const CC = " union all select 'conta_completa'";
  // split/join e non replace: nessun $ del testo SQL diventa un pattern di sostituzione
  const atteso = V4.split(VER4).join(VER6).split(CC).join(' ' + NATA + CC);
  t("90 v_villaggio_eventi della 0167 = quella della 0164 con SOLO il ramo verifica cambiato e il ramo data_aggiunta da supplier_orders in piu'",
    V4.length > 0 && V4.split(VER4).length === 2 && V4.split(CC).length === 2 && V6 === atteso, 'differisce dalla 0164 oltre i due rami');
  t('91 verifica: n = righe chiuse o con la data dopo diversa da quella di prima; confermare soltanto non conta', V6.includes(VER6) && !/'confermata'/.test(V6));
  t('92 data_aggiunta dalla nascita: righe con data, ma non una data arrivata dopo (order_date o order_update con before.data_consegna = null)', V6.includes(NATA));
  t('93 filtri della 0164 intatti (flag acceso, giocatrice, dal)', /\)\nselect ev\.tipo, ev\.giorno, ev\.ts, ev\.ref, ev\.n\nfrom ev\ncross join cfg\nwhere cfg\.acceso and ev\.chi = cfg\.chi and ev\.ts >= cfg\.dal;/.test(m6));
}
t('94 owner postgres per entrambe, senza security_invoker', /alter view v_villaggio_eventi owner to postgres;/.test(m6) && /alter view v_tempi_laboratori owner to postgres;/.test(m6) && !/security_invoker/.test(m6));
t('95 revoke da public, anon, authenticated e poi SOLO select su entrambe', /revoke all on v_villaggio_eventi, v_tempi_laboratori from public, anon, authenticated;\ngrant select on v_villaggio_eventi, v_tempi_laboratori to anon, authenticated;/.test(m6) && !/grant (insert|update|delete|all)/i.test(m6));
t('96 rollback dichiarato in fondo', /-- Rollback: drop view v_tempi_laboratori;/.test(M6));

console.log('\n== contratto fra vista, write-api e web ==');
t("97 la vista legge chiusa: true, la chiave che scrive la write-api", /chiusa: true \}\);/.test(BLK) && /e -> 'chiusa' = 'true'::jsonb/.test(m6));
t("98 le op dell'esclusione esistono nella write-api col before di data_consegna (order_date, order_update)",
  /'order_date', \{ codice: r\.codice, fornitore, data_consegna: dopo \}, \{ data_consegna: prima \}\)/.test(BLK) && /logp\('supplier_orders', id, 'order_update', \{[^}]*\.\.\.dopo \}, prima\);/.test(SRC));
{
  const API = read('web/src/lib/api.ts');
  t('99 il web legge v_tempi_laboratori con le colonne della vista', /from\('v_tempi_laboratori'\)\.select\('fornitore,giorni_mediani,righe'\)/.test(API));
  t('100 il web manda order_update con id (non order_id)', /writeApi\('order_update', \{ id\b/.test(API));
}

console.log('\n== write-api v30: cinture sul sorgente ==');
t('101 chiudi vale solo se === true', /chieste\.set\(id, \{ confermata: r\.confermata === true, data, chiudi: r\.chiudi === true \}\);/.test(BLK));
t('102 chiusura: ordinato = arrivato (num) e wip spento, sulla sola riga, senza compare-and-set',
  /const arrivati = num\(r\.qty_arrived\) \?\? 0;\n\s+const \{ error: xe \} = await sb\.from\('supplier_orders'\)\.update\(\{ qty_ordered: arrivati, wip: false \}\)\.eq\('id', r\.id\);/.test(BLK));
t('103 chiusura: change_log order_close con before (ordinato e wip di prima) e after',
  /await logp\('supplier_orders', String\(r\.id\), 'order_close', \{ codice: r\.codice, fornitore, qty_ordered: arrivati, qty_arrived: arrivati, wip: false \}, \{ qty_ordered: num\(r\.qty_ordered\), wip: r\.wip === true \}\);/.test(BLK));
t('104 una riga chiusa tiene la sua data (data_dopo = data_prima) e salta il ramo delle date',
  /righe\.push\(\{ id: r\.id, codice: r\.codice, confermata: ch\.confermata, data_prima: prima, data_dopo: prima, chiusa: true \}\);\n\s+continue;/.test(BLK)
  && BLK.indexOf("'order_close'") < BLK.indexOf('const dopo = ch.data ?? prima;'));
t('105 si chiude solo dentro il giro delle righe APERTE lette per quel fornitore',
  BLK.indexOf(".eq('fornitore', fornitore)") > 0 && BLK.indexOf(".eq('fornitore', fornitore)") < BLK.indexOf('for (const r of aperte)') && BLK.indexOf('for (const r of aperte)') < BLK.indexOf('if (ch.chiudi)'));
t("106 risposta con righe_chiuse, anche sull'errore della verifica", /return json\(\{ ok: true, check_id: chk\.id, date_cambiate: cambiate, righe_chiuse: chiuse \}\);/.test(BLK) && /date_cambiate: cambiate, righe_chiuse: chiuse \}, 400\)/.test(BLK));
const UB = '  // --- ORDER_UPDATE (v30', UE = '  // --- NEW (brief 2026-07-14): elimina una riga di anagrafica prodotto';
const ua = SRC.indexOf(UB), ub = SRC.indexOf(UE);
if (ua < 0 || ub < 0 || ub < ua) { console.error('blocco order_update non trovato in write-api/index.ts'); process.exit(1); }
const UBLK = SRC.slice(ua, ub), UF = flat(UBLK);
t('107 order_update sta fuori dal blocco Paillettes e non legge flag', ua < a && /if \(action === 'order_update'\) \{/.test(UBLK) && !/app_flags/.test(UBLK));
t("108 una sola lettura, con retryOnce ed error destrutturato: 503 se fallisce, 404 se la riga non c'e'",
  /const \{ data: riga, error: re \} = await retryOnce\(\(\) => sb\.from\('supplier_orders'\)\.select\('id, codice, fornitore, qty_ordered, qty_arrived, costo_unitario, note, data_consegna, data_ordine, wip'\)\.eq\('id', id\)\.maybeSingle\(\)\);/.test(UF)
  && /if \(re\) return json\(\{ error: `[^`]*` \}, 503\);\n\s+if \(!riga\) return json\(\{ error: '[^']+' \}, 404\);/.test(UBLK));
t('109 righe con arrivi o WIP = 409 prima della scrittura', /if \(\(num\(riga\.qty_arrived\) \?\? 0\) > 0\) return json\(\{ error: `[^`]*`, has_arrivals: true \}, 409\);/.test(UBLK)
  && /if \(riga\.wip === true\) return json\(\{ error: "[^"]*", wip: true \}, 409\);/.test(UBLK)
  && UBLK.indexOf('has_arrivals: true') < UBLK.indexOf('.update(') && UBLK.indexOf('wip: true }, 409') < UBLK.indexOf('.update('));
t("110 si cambiano solo quantita', costo, nota e consegna: ogni altro campo (codice, fornitore...) = 422",
  /const CAMPI = \['qty_ordered', 'costo_unitario', 'note', 'data_consegna'\];/.test(UBLK) && /const estranei = Object\.keys\(payload\)\.filter\(\(k\) => k !== 'id' && !CAMPI\.includes\(k\)\);/.test(UBLK));
t('111 update della sola riga coi soli campi cambiati, change_log order_update con before e after',
  /const \{ error: ue \} = await sb\.from\('supplier_orders'\)\.update\(dopo\)\.eq\('id', id\);/.test(UBLK) && /await logp\('supplier_orders', id, 'order_update', \{ codice: riga\.codice, fornitore: riga\.fornitore, \.\.\.dopo \}, prima\);/.test(UBLK));
t('112 niente guardia mesi chiusi (nessun effetto sul CE), niente compare-and-set, niente op_id',
  !/closed(Date|Month|Err)/.test(UBLK) && !/\.update\(dopo\)\.eq\('id', id\)\.eq\(/.test(UF) && !/op_id/.test(noTs(UBLK)));
t("113 numeri con num() e date con isoDate (lib.ts), mai Number() ne' new Date()",
  /num\(payload\.qty_ordered, \{ integer: true, min: 1 \}\)/.test(UBLK) && /num\(payload\.costo_unitario, \{ min: 0 \}\)/.test(UBLK) && /isoDate\(payload\.data_consegna\)/.test(UBLK) && !/Number\(|new Date\(/.test(UBLK));
t('114 nessun retry su una scrittura', !/retryOnce\(\(\) => sb\.from\('[^']+'\)\.(insert|update|upsert|delete)\(/.test(UF));

console.log("\n== write-api v30: chiudi nella verifica (blocco vero, DB finto) ==");
{ // una data spostata e due righe chiuse (una parziale, una WIP) nella stessa verifica
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', verifica([
    { id: U1, confermata: true, data_consegna: '2026-10-30' },
    { id: U2, confermata: true, data_consegna: '2026-12-24', chiudi: true },
    { id: U5, confermata: false, data_consegna: null, chiudi: true },
  ])));
  eq('115 risposta: una data cambiata, due righe chiuse', [r.status, r.body], [200, { ok: true, check_id: 'chk1', date_cambiate: 1, righe_chiuse: 2 }]);
  eq('116 a DB: U2 ordinato = arrivato (2), U5 WIP chiusa a 0 e wip spento, date di U2 e U5 non toccate',
    st.ordini.filter((o) => [U1, U2, U5].includes(o.id)).map((o) => [o.id, o.qty_ordered, o.qty_arrived, o.wip, o.data_consegna]),
    [[U1, 10, 0, false, '2026-10-30'], [U2, 2, 2, false, '2026-10-20'], [U5, 0, 0, false, null]]);
  eq('117 update: la sola data sulla prima, solo ordinato e wip sulle chiuse', st.update, [['data_consegna'], ['qty_ordered', 'wip'], ['qty_ordered', 'wip']]);
  eq('118 change_log: order_date, poi order_close con before e after per ogni riga chiusa', st.log.map((l) => [l[2], l[1], l[3], l[4]]), [
    ['order_date', U1, { codice: 'LEA_BAG_ROSSO', fornitore: FR, data_consegna: '2026-10-30' }, { data_consegna: null }],
    ['order_close', U2, { codice: 'AGATA_NERO', fornitore: FR, qty_ordered: 2, qty_arrived: 2, wip: false }, { qty_ordered: 6, wip: false }],
    ['order_close', U5, { codice: 'MIA_BAG_ORO', fornitore: FR, qty_ordered: 0, qty_arrived: 0, wip: false }, { qty_ordered: 0, wip: true }],
  ]);
  eq('119 vil_verifiche: chiusa true solo sulle chiuse, con data_dopo = data_prima', st.checks[0].righe, [
    { id: U1, codice: 'LEA_BAG_ROSSO', confermata: true, data_prima: null, data_dopo: '2026-10-30' },
    { id: U2, codice: 'AGATA_NERO', confermata: true, data_prima: '2026-10-20', data_dopo: '2026-10-20', chiusa: true },
    { id: U5, codice: 'MIA_BAG_ORO', confermata: false, data_prima: null, data_dopo: null, chiusa: true },
  ]);
}
{ // chiudere non scrive la data che arriva col client e non toglie quella che c'e': niente data aggiunta da una chiusura
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U1, confermata: true, data_consegna: '2026-11-11', chiudi: true }, { id: U2, confermata: true, data_consegna: null, chiudi: true }])));
  eq('120 chiudi con una data o senza: nessun order_date, U1 resta senza data, U2 tiene la sua',
    [r.body.date_cambiate, r.body.righe_chiuse, st.log.map((l) => l[2]), st.ordini[0].data_consegna, st.ordini[1].data_consegna, st.checks[0].righe.map((x) => [x.data_prima, x.data_dopo])],
    [0, 2, ['order_close', 'order_close'], null, '2026-10-20', [[null, null], ['2026-10-20', '2026-10-20']]]);
  eq('121 U1 chiusa senza arrivi: ordinato 0 (completa per v_ordini_arrivo)', [st.ordini[0].qty_ordered, st.ordini[0].qty_arrived, st.ordini[0].wip], [0, 0, false]);
}
{ // chiudi vale solo === true e solo sulle righe aperte di quel fornitore
  const { st, ctx } = mondo();
  const r = await run(ctx('fornitore_verifica', verifica([
    { id: U1, confermata: true, data_consegna: null, chiudi: 'true' },
    { id: U3, confermata: true, data_consegna: null, chiudi: true },
    { id: U4, confermata: true, data_consegna: null, chiudi: true },
    { id: U5, confermata: true, data_consegna: null, chiudi: 1 },
  ])));
  eq("122 chiudi 'true' o 1 non chiude; riga di un altro fornitore e riga gia' completa ignorate",
    [r.status, r.body.righe_chiuse, st.update.length, st.log.length, st.ordini.map((o) => o.qty_ordered), st.checks[0].righe.map((x) => [x.id, x.chiusa ?? false])],
    [200, 0, 0, 0, [10, 6, 4, 5, 0], [[U1, false], [U5, false]]]);
}
{ // chiusura fallita a meta': la prima resta col suo change_log, la verifica non si registra (come per le date)
  const { st, ctx } = mondo({ rompi: 'supplier_orders.update#2' });
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U1, confermata: true, data_consegna: null, chiudi: true }, { id: U2, confermata: true, data_consegna: null, chiudi: true }])));
  eq('123 seconda chiusura fallita: 400, la prima chiusa e loggata, nessuna verifica',
    [r.status, r.body.ok ?? false, st.ordini[0].qty_ordered, st.ordini[1].qty_ordered, st.log.map((l) => l[2]), st.checks.length], [400, false, 0, 6, ['order_close'], 0]);
  t("124 ... e il messaggio dice cosa e' gia' stato fatto", /0 date cambiate e 1 righe chiuse prima di questa/.test(r.body.error ?? ''), r.body.error);
}
{ // insert della verifica fallito dopo una chiusura
  const { ctx } = mondo({ rompi: 'vil_verifiche.insert' });
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U2, confermata: true, data_consegna: null, chiudi: true }])));
  eq('125 verifica non registrata dopo una chiusura: 400 con righe_chiuse 1', [r.status, r.body.date_cambiate, r.body.righe_chiuse], [400, 0, 1]);
}
{ // flag spento: niente si chiude
  const { st, ctx } = mondo({ acceso: 'false' });
  const r = await run(ctx('fornitore_verifica', verifica([{ id: U2, confermata: true, data_consegna: null, chiudi: true }])));
  eq('126 flag spento: 409 e nessuna riga chiusa', [r.status, st.update.length, st.ordini[1].qty_ordered], [409, 0, 6]);
}

console.log('\n== write-api v30: order_update (blocco vero, DB finto) ==');
const TMPU = `${ROOT}tests/_order_update.${process.pid}.tmp.ts`;
writeFileSync(TMPU, `import { isoDate, num } from '../supabase/functions/write-api/lib.ts';
export async function run(ctx: any): Promise<any> {
  const { action, payload, sb, json, retryOnce, logp } = ctx;
${UBLK}
  return json({ fallthrough: true }, 599);
}
`, 'utf8');
let runU;
try { ({ run: runU } = await import(pathToFileURL(TMPU).href)); }
finally { try { unlinkSync(TMPU); } catch { /* niente */ } }

{ // la correzione tipica, a Paillettes spente (order_update non dipende dal gioco)
  const { st, ctx } = mondo({ acceso: 'false' });
  const r = await runU(ctx('order_update', { id: U1, qty_ordered: 12, costo_unitario: '15.5', note: '  interno cuoio  ', data_consegna: '2026-11-30' }));
  eq('127 order_update: 200 con i quattro campi cambiati', [r.status, r.body], [200, { ok: true, id: U1, cambiati: ['qty_ordered', 'costo_unitario', 'note', 'data_consegna'] }]);
  eq('128 riga a DB: numeri da num(), nota ripulita, codice e fornitore intatti',
    [st.ordini[0].qty_ordered, st.ordini[0].costo_unitario, st.ordini[0].note, st.ordini[0].data_consegna, st.ordini[0].codice, st.ordini[0].fornitore, st.ordini[0].qty_arrived], [12, 15.5, 'interno cuoio', '2026-11-30', 'LEA_BAG_ROSSO', FR, 0]);
  eq('129 UNA lettura per id, UN update, nessuna lettura dei flag',
    [st.letture, st.update, st.chiamate['app_flags.select'] ?? 0],
    [[{ cols: 'id, codice, fornitore, qty_ordered, qty_arrived, costo_unitario, note, data_consegna, data_ordine, wip', filtri: [['id', U1, 'eq']] }], [['qty_ordered', 'costo_unitario', 'note', 'data_consegna']], 0]);
  eq('130 change_log order_update: after con codice e fornitore, before con i valori di prima', st.log.map((l) => [l[0], l[1], l[2], l[3], l[4]]), [['supplier_orders', U1, 'order_update',
    { codice: 'LEA_BAG_ROSSO', fornitore: FR, qty_ordered: 12, costo_unitario: 15.5, note: 'interno cuoio', data_consegna: '2026-11-30' },
    { qty_ordered: 10, costo_unitario: null, note: null, data_consegna: null }]]);
  t('131 ... il before porta data_consegna come JSON null, cioe\' cio\' che la vista cerca per non contarla come data aggiunta', String(JSON.stringify(st.log[0]?.[4])).includes('"data_consegna":null'));
}
{ // solo cio' che cambia: numeric di PostgREST come stringa ('38.50') uguale a 38.5
  const { st, ctx } = mondo();
  const r = await runU(ctx('order_update', { id: U3, qty_ordered: '4', costo_unitario: 38.5, note: 'interno nero e cuoio' }));
  eq("132 quantita' e costo uguali a quelli a DB: cambia solo la nota, ed e' l'unica nel before e nell'after",
    [r.body.cambiati, st.update, st.log[0]?.[3], st.log[0]?.[4]], [['note'], [['note']], { codice: 'RITA_VERDE', fornitore: 'Altro lab', note: 'interno nero e cuoio' }, { note: 'interno nero' }]);
}
{ // niente cambia: nessuna scrittura
  const { st, ctx } = mondo();
  const r = await runU(ctx('order_update', { id: U1, qty_ordered: 10, note: null }));
  eq("133 tutto uguale: 200 cambiati [] e nessun update ne' change_log", [r.status, r.body, st.update.length, st.log.length], [200, { ok: true, id: U1, cambiati: [] }, 0, 0]);
}
{ // null o '' tolgono costo, nota e consegna
  const { st, ctx } = mondo();
  Object.assign(st.ordini[2], { data_consegna: '2026-11-03' });
  const r = await runU(ctx('order_update', { id: U3, costo_unitario: null, note: '', data_consegna: '' }));
  eq("134 null o '' tolgono costo, nota e consegna, col valore di prima nel before",
    [r.body.cambiati, [st.ordini[2].costo_unitario, st.ordini[2].note, st.ordini[2].data_consegna], st.log[0]?.[4]],
    [['costo_unitario', 'note', 'data_consegna'], [null, null, null], { costo_unitario: 38.5, note: 'interno nero', data_consegna: '2026-11-03' }]);
}
{ // id con maiuscole e spazi: Postgres risponde gli uuid in minuscolo
  const { st, ctx } = mondo();
  const U6 = 'abcdef01-2345-4678-9abc-def012345678';
  st.ordini.push({ id: U6, codice: 'LEA_BAG_BLU', fornitore: FR, data_consegna: null, qty_ordered: 3, qty_arrived: 0, wip: false, costo_unitario: null, note: null });
  const r = await runU(ctx('order_update', { id: '  ' + U6.toUpperCase() + ' ', note: 'x' }));
  eq('135 id con maiuscole e spazi: trovato e scritto in minuscolo', [r.status, st.letture[0]?.filtri, st.log[0]?.[1]], [200, [['id', U6, 'eq']], U6]);
}
for (const [nome, payload] of [
  ['id assente', { note: 'x' }],
  ['order_id al posto di id', { order_id: U1, note: 'x' }],
  ['id non uuid', { id: 'riga-1', note: 'x' }],
  ['nessun campo', { id: U1 }],
  ['codice', { id: U1, codice: 'LEA_BAG_NERO' }],
  ['fornitore', { id: U1, fornitore: 'Altro lab', note: 'x' }],
  ['qty_arrived', { id: U1, qty_arrived: 3 }],
  ['wip', { id: U1, wip: true }],
  ["quantita' 0", { id: U1, qty_ordered: 0 }],
  ["quantita' 1.5", { id: U1, qty_ordered: 1.5 }],
  ["quantita' ''", { id: U1, qty_ordered: '' }],
  ["quantita' null", { id: U1, qty_ordered: null }],
  ['costo -1', { id: U1, costo_unitario: -1 }],
  ["costo '12,50'", { id: U1, costo_unitario: '12,50' }],
  ['nota numero', { id: U1, note: 5 }],
  ['data 2026-02-30', { id: U1, data_consegna: '2026-02-30' }],
  ['data 30/11/2026', { id: U1, data_consegna: '30/11/2026' }],
]) {
  const { st, ctx } = mondo();
  const r = await runU(ctx('order_update', payload));
  eq(`136 ${nome}: 422, nessuna lettura ne' scrittura`, [r.status, st.letture.length, st.update.length, st.log.length], [422, 0, 0, 0]);
}
{ // una consegna nuova prima dell'ordine: 422 senza scrivere; uguale all'ordine va; una data vecchia storta non blocca la nota
  const { st, ctx } = mondo();
  Object.assign(st.ordini[0], { data_ordine: '2026-10-10' });
  const r1 = await runU(ctx('order_update', { id: U1, data_consegna: '2026-10-09' }));
  eq("142 consegna prima dell'ordine: 422, nessun update ne' change_log", [r1.status, st.update.length, st.log.length], [422, 0, 0]);
  const r2 = await runU(ctx('order_update', { id: U1, data_consegna: '2026-10-10' }));
  eq("143 consegna il giorno dell'ordine: 200", [r2.status, r2.body.cambiati], [200, ['data_consegna']]);
  Object.assign(st.ordini[0], { data_consegna: '2026-10-01' });
  const r3 = await runU(ctx('order_update', { id: U1, note: 'x' }));
  eq('144 la data vecchia (gia\' prima dell\'ordine) non blocca la nota', [r3.status, r3.body.cambiati], [200, ['note']]);
}
{ // righe con arrivi (anche tutti) e WIP: 409, zero scritture
  const { st, ctx } = mondo();
  const r1 = await runU(ctx('order_update', { id: U2, costo_unitario: 30 }));
  const r2 = await runU(ctx('order_update', { id: U5, qty_ordered: 4 }));
  const r3 = await runU(ctx('order_update', { id: U4, note: 'x' }));
  eq('137 arrivi = 409 has_arrivals, WIP = 409 wip, zero scritture',
    [r1.status, r1.body.has_arrivals, r2.status, r2.body.wip, r3.status, r3.body.has_arrivals, st.update.length, st.log.length], [409, true, 409, true, 409, true, 0, 0]);
}
{ // qty_arrived come stringa numerica di PostgREST
  const { st, ctx } = mondo();
  Object.assign(st.ordini[0], { qty_arrived: '1' });
  const r = await runU(ctx('order_update', { id: U1, note: 'x' }));
  eq("138 qty_arrived '1': ha arrivi, 409", [r.status, st.update.length], [409, 0]);
}
{ // riga che non c'e'
  const { st, ctx } = mondo();
  const r = await runU(ctx('order_update', { id: '99999999-9999-4999-8999-999999999999', note: 'x' }));
  eq('139 riga inesistente: 404, nessuna scrittura', [r.status, st.update.length], [404, 0]);
}
{ // lettura fallita: 503, mai "riga senza arrivi"
  const { st, ctx } = mondo({ rompi: 'supplier_orders.select' });
  const r = await runU(ctx('order_update', { id: U1, note: 'x' }));
  eq('140 lettura fallita: 503, nessuna scrittura', [r.status, st.update.length, st.log.length], [503, 0, 0]);
}
{ // update fallito: niente change_log
  const { st, ctx } = mondo({ rompi: 'supplier_orders.update' });
  const r = await runU(ctx('order_update', { id: U1, note: 'x' }));
  eq('141 update fallito: 400, nessun change_log', [r.status, r.body.ok ?? false, st.log.length], [400, false, 0]);
}

console.log('\n== write-api v30: order_multi valida data_consegna ==');
{
  const OM = SRC.slice(SRC.indexOf("if (action === 'order_multi') {"), SRC.indexOf('const { data: prods, error: pe }', SRC.indexOf("if (action === 'order_multi') {")));
  t("145 order_multi: data_consegna passa da isoDate e non precede l'ordine (422 prima di leggere il catalogo)",
    OM.length > 0 && /const consegnaErrs = righe\.filter\(\(r\) => r\.data_consegna != null && r\.data_consegna !== '' && !\(\(isoDate\(r\.data_consegna\) \?\? ''\) >= dataOrdine\)\)/.test(OM) && /if \(consegnaErrs\.length\) return json\(.*, 422\);/.test(OM));
  t("146 order_multi scrive la data normalizzata da isoDate ('' = nessuna data), mai la stringa com'arriva",
    /data_consegna: r\.data_consegna != null && r\.data_consegna !== '' \? isoDate\(r\.data_consegna\) : null,/.test(OM) && !/data_consegna: \(r\.data_consegna as string\)/.test(OM));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exitCode = ko ? 1 : 0;   // non process.exit(): su Windows (Node 24) ogni tanto chiude con "Assertion failed ... UV_HANDLE_CLOSING"
