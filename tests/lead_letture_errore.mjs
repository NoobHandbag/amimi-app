// tests/lead_letture_errore.mjs: letture con `error` controllato negli script locali di workers/lead/ (Regola Ferrea 20 a)
//   node tests/lead_letture_errore.mjs
//
// 14-10: session_write.mjs, judge_write.mjs, judge_digest.mjs, judge_dump.mjs e collect.mjs leggevano lead_* senza
// destrutturare `error`: una lettura fallita da' data = null e lo script proseguiva con un default vuoto (session_write
// reinseriva un contatto gia' presente, judge_write scriveva il punteggio senza risolvere gli id evidenza e senza
// sapere se una persona aveva gia' deciso). Ora la riga (o il giro, per i dump) si ferma con un errore visibile.
// Parte 1, offline: gli script girano davvero, con ./lib.mjs sostituita da un client finto (lead_finto_hook.mjs e
// lead_finto_lib.mjs: niente rete, niente client vero) che fa fallire la select scelta e registra cosa verrebbe scritto.
// Parte 2, sul sorgente: rilevatore di `{ data }` (o `{ count }`) destrutturato da un await senza `error`, o con `error`
// non guardato prima dell'await successivo, in workers/lead/*.mjs, con autocontrollo.
// Gemello di tests/lead_seed_indice.mjs (amimi-app#54, non in main il 14-10): quando entra, i due si possono fondere.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HOOK = new URL('./lead_finto_hook.mjs', import.meta.url).href;
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 200) : '')); } };

// ---- Parte 1: gli script contro il client finto ----
const TMP = mkdtempSync(join(tmpdir(), 'lead-letture-'));
let n = 0;
const json = (v) => { const f = join(TMP, `in${++n}.json`); writeFileSync(f, JSON.stringify(v)); return f; };
function gira(script, args, { tabelle = {}, guasti = [] } = {}) {
  const k = ++n, out = join(TMP, `out${k}.json`), cwd = join(TMP, `cwd${k}`);
  mkdirSync(cwd);
  const env = { ...process.env, SUPABASE_ACCESS_TOKEN: '', LEAD_FINTO: JSON.stringify({ tabelle, guasti, out }) };
  const p = spawnSync(process.execPath, ['--import', HOOK, join(ROOT, 'workers/lead', script), ...args], { cwd, env, encoding: 'utf8', timeout: 60000 });
  return { code: p.status, testo: `${p.stdout ?? ''}${p.stderr ?? ''}`, scritture: existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null, cwd };
}
const scritte = (r, tabella, op) => (r.scritture ?? []).filter((w) => w.tabella === tabella && (!op || w.op === op));
const fineRun = (r) => scritte(r, 'lead_runs', 'update')[0]?.riga;

console.log('\n== il client finto non lascia passare quello vero ==');
for (const [nome, codice, atteso] of [
  ['@supabase/supabase-js', "await import('@supabase/supabase-js')", /supabase-js vietato/],
  ['fetch', "await fetch('https://example.invalid')", /rete vietata/],
]) {
  const p = spawnSync(process.execPath, ['--import', HOOK, '--input-type=module', '-e', codice], { encoding: 'utf8', timeout: 30000 });
  t(`${nome} bloccato dal preload`, p.status !== 0 && atteso.test(p.stderr), p.stderr);
}

const ACC = 'A1';
const CONTATTO = { account_id: ACC, nome: 'Maria Rossi', email: 'maria@negozio.it' };
const CONTATTI = { lead_contacts: [{ id: 'C1', account_id: ACC, nome: 'Maria Rossi', email: 'Maria@Negozio.it' }] };

console.log('\n== session_write.mjs: contatti gia\' presenti ==');
{
  const r = gira('session_write.mjs', [json({ contacts: [CONTATTO] })], { tabelle: CONTATTI });
  t('client finto in uso (registro delle scritture presente)', r.scritture !== null, r.testo);
  t('lettura ok, contatto gia\' presente: nessun insert', scritte(r, 'lead_contacts', 'insert').length === 0 && fineRun(r)?.n_err === 0, r.testo);
}
{
  const r = gira('session_write.mjs', [json({ contacts: [CONTATTO] })], { tabelle: CONTATTI, guasti: ['lead_contacts'] });
  t('lettura dei contatti in errore: il contatto NON viene reinserito', r.scritture !== null && scritte(r, 'lead_contacts', 'insert').length === 0, JSON.stringify(scritte(r, 'lead_contacts')));
  t('... e la riga e\' un errore visibile (ERR a schermo, n_err 1 e motivo nel log di lead_runs)',
    /ERR contatto/.test(r.testo) && fineRun(r)?.n_err === 1 && /non leggibili/.test(JSON.stringify(fineRun(r)?.log)), r.testo);
}
{
  const r = gira('session_write.mjs', [json({ contacts: [{ account_id: ACC, nome: 'Anna Bianchi', email: 'anna@negozio.it' }] })], { tabelle: CONTATTI });
  t('contatto nuovo con lettura ok: inserito una volta', scritte(r, 'lead_contacts', 'insert').length === 1, r.testo);
}

const EV = { id: 'e1e1e1e1-aaaa-bbbb-cccc-000000000001', account_id: ACC };
const CRITERI = Object.fromEntries(['brand', 'stile', 'posto', 'vitalita', 'raggiungibilita', 'digitale'].map((k) => [k, { punti: 7 }]));
const SCORE = { account_id: ACC, nome: 'Negozio Uno', criteri: { ...CRITERI, brand: { punti: 8, prova: 'brand affine', evidence_id: 'e1e1e1e1' } }, gancio: 'brand affine in vetrina', gancio_evidence_id: 'e1e1e1e1' };
const DB_JUDGE = (stato) => ({ lead_evidence: [EV], lead_accounts: [{ id: ACC, nome: 'Negozio Uno', stato_ricerca: stato, tier: null }] });

console.log('\n== judge_write.mjs: evidenze e stato corrente ==');
{
  const r = gira('judge_write.mjs', [json([SCORE])], { tabelle: DB_JUDGE('enriched') });
  const s = scritte(r, 'lead_scores', 'insert')[0]?.riga, u = scritte(r, 'lead_accounts', 'update')[0]?.riga;
  t('letture ok: un punteggio, id evidenza abbreviato risolto al pieno', s?.criteri?.brand?.evidence_id === EV.id && s?.tier_proposto === 'B', JSON.stringify(s));
  t('letture ok: account a scored con il gancio e la sua evidenza', u?.stato_ricerca === 'scored' && u?.gancio_evidence_id === EV.id, JSON.stringify(u));
}
for (const [guasto, cosa] of [['lead_evidence', 'evidenze dell\'account'], ['lead_accounts', 'stato corrente dell\'account']]) {
  const r = gira('judge_write.mjs', [json([SCORE])], { tabelle: DB_JUDGE('enriched'), guasti: [guasto] });
  t(`lettura ${cosa} in errore: nessun punteggio e nessun update`, r.scritture !== null && scritte(r, 'lead_scores').length === 0 && scritte(r, 'lead_accounts').length === 0,
    JSON.stringify(r.scritture?.filter((w) => w.tabella !== 'lead_runs')));
  t(`... errore visibile (ERR a schermo, n_err 1 in lead_runs)`, /ERR Negozio Uno/.test(r.testo) && fineRun(r)?.n_err === 1 && /non leggibil/.test(JSON.stringify(fineRun(r)?.log)), r.testo);
}
{
  const r = gira('judge_write.mjs', [json([SCORE])], { tabelle: DB_JUDGE('reviewed') });
  const u = scritte(r, 'lead_accounts', 'update')[0]?.riga;
  t('decisione umana gia\' presa (reviewed): lo stato non si tocca', u && !('stato_ricerca' in u), JSON.stringify(u));
}

console.log('\n== judge_digest.mjs e judge_dump.mjs: il materiale per il giudizio ==');
const DB_DUMP = { lead_accounts: [{ id: ACC, nome: 'Negozio Uno', citta: 'Milano', stato_ricerca: 'enriched' }], lead_evidence: [{ ...EV, tipo: 'site_meta', payload: { platform: 'shopify' } }] };
{
  const r = gira('judge_digest.mjs', ['--id', ACC], { tabelle: DB_DUMP });
  t('digest, letture ok: stampa l\'account con l\'evidenza', r.code === 0 && /### Negozio Uno/.test(r.testo) && /\[site_meta e1e1e1e1\]/.test(r.testo), r.testo);
  const g = gira('judge_digest.mjs', ['--id', ACC], { tabelle: DB_DUMP, guasti: ['lead_evidence'] });
  t('digest, evidenze in errore: STOP con il motivo, non un account "senza evidenze"', g.code !== 0 && /STOP: evidenze di Negozio Uno non leggibili \(504/.test(g.testo), g.testo);
}
{
  const r = gira('judge_dump.mjs', ['--id', ACC], { tabelle: DB_DUMP });
  t('dump, letture ok: evidence.json scritto', r.code === 0 && existsSync(join(r.cwd, 'out/judge/negozio_uno/evidence.json')), r.testo);
  const g = gira('judge_dump.mjs', ['--id', ACC], { tabelle: DB_DUMP, guasti: ['lead_evidence'] });
  t('dump, evidenze in errore: STOP con il motivo, nessun evidence.json vuoto', g.code !== 0 && /STOP: evidenze di Negozio Uno non leggibili \(504/.test(g.testo) && !existsSync(join(g.cwd, 'out/judge/negozio_uno/evidence.json')), g.testo);
}
rmSync(TMP, { recursive: true, force: true });

// ---- Parte 2: sul sorgente ----
console.log('\n== collect.mjs: handle IG dal sito (non collaudabile offline: Playwright e rete) ==');
{
  const SRC = read('workers/lead/collect.mjs');
  t('collect.mjs: la lettura site_meta destruttura error', SRC.includes("const { data, error: igErr } = await sb.from('lead_evidence').select('payload')"), 'frammento assente');
  t('collect.mjs: errore visibile nel log del giro, handle lasciato null (verso il sicuro)', SRC.includes('if (igErr) { res.ig_dal_sito = `non letto: ${igErr.message}`;'), 'frammento assente');
}
{
  const SRC = read('workers/lead/judge_write.mjs');
  const stato = SRC.indexOf(".from('lead_accounts').select('stato_ricerca,tier')"), ins = SRC.indexOf(".from('lead_scores').insert(");
  t('judge_write.mjs: lo stato corrente si legge PRIMA di scrivere il punteggio', stato > 0 && ins > 0 && stato < ins, `${stato} / ${ins}`);
}

// Rilevatore. Ogni `{ ... }` destrutturato da un await che contiene `data` o `count` deve contenere anche `error`, e il
// nome di `error` deve comparire prima dell'await successivo (guardarlo dopo una scrittura e' troppo tardi).
const flat = (src) => src.replace(/\)\s*\n\s*\./g, ').');
function letturaSenzaErrore(src) {
  const s = flat(src), out = [];
  for (const m of s.matchAll(/\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*await\b/g)) {
    const campi = m[1].split(',').map((c) => c.trim()).filter(Boolean).map((c) => { const [k, a] = c.split(':').map((x) => x.trim()); return { k, a: a || k }; });
    const fine = s.indexOf(';', m.index), stmt = s.slice(m.index, fine + 1).trim();
    const err = campi.find((c) => c.k === 'error');
    if (!err) { if (campi.some((c) => c.k === 'data' || c.k === 'count')) out.push(stmt); continue; }
    const resto = s.slice(fine + 1), prossimo = resto.search(/\bawait\b/);
    if (!new RegExp(`(?<![\\w$.])${err.a}(?![\\w$])`).test(prossimo < 0 ? resto : resto.slice(0, prossimo))) out.push('error non guardato: ' + stmt);
  }
  return out;
}
// amimi-app#54 (aperta il 14-10) corregge questa lettura di seed.mjs nello stesso punto (error destrutturato, throw):
// finche' non entra in main resta ammessa qui, poi la voce non trova piu' niente e si puo' togliere.
const IN_ATTESA_54 = "seed.mjs|const { data: ev } = await sb.from('lead_evidence').select('id').eq('account_id', hit).eq('tipo', 'fonte').contains('payload', { fonte_seed: r.fonte_seed }).limit(1);";

console.log('\n== workers/lead/*.mjs: nessuna lettura con error ignorato ==');
let attesa = false;
for (const f of readdirSync(ROOT + 'workers/lead').filter((x) => x.endsWith('.mjs')).sort()) {
  const trovate = letturaSenzaErrore(read('workers/lead/' + f)).filter((q) => { if (`${f}|${q}` === IN_ATTESA_54) { attesa = true; return false; } return true; });
  t(`${f}: ogni lettura destruttura error e lo guarda prima di proseguire`, trovate.length === 0, trovate[0]);
}
console.log(attesa ? '  nota  seed.mjs: la lettura delle evidenze fonte e\' in attesa di amimi-app#54' : '  nota  amimi-app#54 e\' in main: la voce IN_ATTESA_54 si puo\' togliere');

console.log('\n== autocontrollo del rilevatore ==');
// le sei letture del 14-10, come erano in main prima del fix: tutte viste
const VECCHIE = [
  "const { data: cur } = await sb.from('lead_contacts').select('id,nome,email').eq('account_id', c.account_id);",
  "const { data: evs } = await sb.from('lead_evidence').select('id').eq('account_id', r.account_id);",
  "const { data: cur } = await sb.from('lead_accounts').select('stato_ricerca,tier').eq('id', r.account_id).single();",
  "if (!DRY) { const { data } = await sb.from('lead_evidence').select('payload').eq('account_id', acc.id).eq('tipo', 'site_meta').order('captured_at', { ascending: false }).limit(1); siteIg = data?.[0]?.payload?.ig_from_site || null; }",
  "const { data: ev } = await sb.from('lead_evidence').select('id,tipo,payload,asset_path,captured_at,note').eq('account_id', a.id).order('captured_at');",
  "const { data: ev } = await sb.from('lead_evidence').select('*').eq('account_id', a.id).order('captured_at');",
];
t('le sei letture del 14-10 (versione vecchia) sono tutte segnalate', VECCHIE.every((v) => letturaSenzaErrore(v).length === 1), VECCHIE.find((v) => letturaSenzaErrore(v).length !== 1));
const CASI = [
  ['catena a capo senza error', "const { data } = await sb.from('lead_evidence')\n  .select('payload')\n  .limit(1);", 1],
  ['query costruita prima, senza error', 'const { data: accounts } = await q;', 1],
  ['data e count senza error', "const { data: ev, count } = await sb.from('lead_evidence').select('id', { count: 'exact' }).eq('account_id', a);", 1],
  ['solo count senza error', "const { count } = await sb.from('lead_scores').select('id', { count: 'exact', head: true });", 1],
  ['error guardato solo dopo una scrittura', "const { data, error } = await sb.from('lead_contacts').select('id').eq('account_id', x);\nawait sb.from('lead_contacts').insert(r);\nif (error) throw error;", 1],
  ['error con alias mai usato', "const { data: cur, error: curErr } = await sb.from('lead_accounts').select('id').eq('id', x).single();\nconst y = cur.id;", 1],
  ['error con alias guardato subito', "const { data: cur, error: curErr } = await sb.from('lead_accounts').select('id').eq('id', x).single();\nif (curErr) throw curErr;", 0],
  ['query costruita prima, con error', 'const { data, error } = await q; if (error) throw error;', 0],
  ['insert con error guardato', "const { error } = await sb.from('lead_evidence').insert(row); if (error) throw error;", 0],
  ['download storage con error guardato', "const { data, error: de } = await sb.storage.from(BUCKET).download(p);\nif (de) { console.log(de.message); continue; }", 0],
  ['proprieta\' .error di un altro oggetto non conta come controllo', "const { data, error } = await q;\nif (x.error) throw x.error;", 1],
];
for (const [nome, src, atteso] of CASI) t(`rilevatore: ${nome} -> ${atteso ? 'segnalato' : 'non segnalato'}`, letturaSenzaErrore(src).length === atteso, JSON.stringify(letturaSenzaErrore(src)));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
