// tests/lead_letture_errore.mjs: letture con `error` controllato negli script locali di workers/lead/ (Regola Ferrea 20 a)
//   node tests/lead_letture_errore.mjs
//
// 14-10: session_write.mjs, judge_write.mjs, judge_digest.mjs, judge_dump.mjs e collect.mjs leggevano lead_* senza
// destrutturare `error`: una lettura fallita da' data = null e lo script proseguiva con un default vuoto (session_write
// reinseriva un contatto gia' presente, judge_write scriveva il punteggio senza risolvere gli id evidenza e senza
// sapere se una persona aveva gia' deciso). Ora la riga (o il giro, per i dump) si ferma con un errore visibile.
// 14-10, seconda parte: anche le SCRITTURE con error ignorato (collect.mjs: gli update di lead_accounts da Maps, lo stato
// enriched e ig_handle; endRun in lib.mjs). Ora l'update fallito fa uscire l'account in errore nel log del giro
// (n_err, scritture_ko) senza cambiare cosa si scrive dopo, e una chiusura del giro non scritta e' STOP con exit 1.
// Con la migr 0157 lead_contacts ha gli indici unici (account + email, account + nome senza email) e session_write
// tratta il 23505 come "gia presente".
// Parte 1, offline: gli script girano davvero, con ./lib.mjs sostituita da un client finto (lead_finto_hook.mjs e
// lead_finto_lib.mjs: niente rete, niente client vero, ma startRun/endRun/evidence quelli VERI di lib.mjs) che fa fallire
// la select o la scrittura scelta e registra cosa verrebbe scritto; collect.mjs con un Playwright finto (pagine vuote).
// Parte 2, sul sorgente: rilevatore di `{ data }` (o `{ count }`) destrutturato da un await senza `error`, o con `error`
// non guardato prima dell'await successivo, e rilevatore di scritture awaited senza `error` destrutturato, in
// workers/lead/*.mjs, con autocontrollo sulle versioni vecchie.
// Gemello di tests/lead_seed_indice.mjs (amimi-app#54, in main dal 14-10 sera insieme a questo file).
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
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const json = (v) => { const f = join(TMP, `in${++n}.json`); writeFileSync(f, JSON.stringify(v)); return f; };
function gira(script, args, { tabelle = {}, guasti = [], errori = {}, maps, prima } = {}) {
  const k = ++n, out = join(TMP, `out${k}.json`), cwd = join(TMP, `cwd${k}`);
  mkdirSync(cwd);
  prima?.(cwd);
  const env = { ...process.env, SUPABASE_ACCESS_TOKEN: '', LEAD_FINTO: JSON.stringify({ tabelle, guasti, errori, maps, out }) };
  const p = spawnSync(process.execPath, ['--import', HOOK, join(ROOT, 'workers/lead', script), ...args], { cwd, env, encoding: 'utf8', timeout: 60000 });
  return { code: p.status, testo: `${p.stdout ?? ''}${p.stderr ?? ''}`, scritture: existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null, cwd };
}
// scritte = andate a buon fine; tentate = anche quelle respinte dal finto (fallita: true)
const scritte = (r, tabella, op) => (r.scritture ?? []).filter((w) => w.tabella === tabella && (!op || w.op === op) && !w.fallita);
const tentate = (r, tabella, op) => (r.scritture ?? []).filter((w) => w.tabella === tabella && (!op || w.op === op));
const fineRun = (r) => scritte(r, 'lead_runs', 'update')[0]?.riga;
const STOP_FINE = /STOP: chiusura del giro run-finto non scritta in lead_runs \(504/;

console.log('\n== il client finto non lascia passare quello vero ==');
for (const [nome, codice, atteso] of [
  ['@supabase/supabase-js', "await import('@supabase/supabase-js')", /supabase-js vietato/],
  ['playwright', "await import('playwright')", /playwright vietato/],
  ['fetch', "await fetch('https://example.invalid')", /rete vietata/],
]) {
  const p = spawnSync(process.execPath, ['--import', HOOK, '--input-type=module', '-e', codice], { encoding: 'utf8', timeout: 30000 });
  t(`${nome} bloccato dal preload`, p.status !== 0 && atteso.test(p.stderr), p.stderr);
}
{
  // gate 14-10, C3: l'hook vale solo in questo processo, quindi uno script lead non puo' lanciare processi figli
  // (next_batch.mjs avvia collect.mjs, che nel figlio userebbe la lib e il Playwright veri)
  const r = gira('next_batch.mjs', ['--n', '1']);
  t('child_process vietato agli script lead sotto test (next_batch.mjs si ferma prima di partire)', r.code !== 0 && /child_process vietato/.test(r.testo) && !(r.scritture ?? []).length, `exit ${r.code} ` + r.testo);
}
{
  const F = readFileSync(new URL('./lead_finto_lib.mjs', import.meta.url), 'utf8');
  t('il finto riusa startRun/endRun/evidence VERI di lib.mjs (nessuna copia locale)', F.includes("export * from '../workers/lead/lib.mjs';") && !/function (startRun|endRun|evidence)\b/.test(F), 'copia locale nel finto');
}

const ACC = 'A1';
const CONTATTO = { account_id: ACC, nome: 'Maria Rossi', email: 'maria@negozio.it' };
const CONTATTI = { lead_contacts: [{ id: 'C1', account_id: ACC, nome: 'Maria Rossi', email: 'Maria@Negozio.it' }] };

console.log('\n== session_write.mjs: contatti gia\' presenti ==');
{
  const r = gira('session_write.mjs', [json({ contacts: [CONTATTO] })], { tabelle: CONTATTI });
  t('client finto in uso (registro delle scritture presente)', r.scritture !== null, r.testo);
  t('lettura ok, contatto gia\' presente: nessun insert', scritte(r, 'lead_contacts', 'insert').length === 0 && fineRun(r)?.n_err === 0 && r.code === 0, r.testo);
}
{
  const r = gira('session_write.mjs', [json({ contacts: [CONTATTO] })], { tabelle: CONTATTI, guasti: ['lead_contacts'] });
  t('lettura dei contatti in errore: il contatto NON viene reinserito', r.scritture !== null && scritte(r, 'lead_contacts', 'insert').length === 0, JSON.stringify(scritte(r, 'lead_contacts')));
  t('... e la riga e\' un errore visibile (ERR a schermo, n_err 1 e motivo nel log di lead_runs, exit 1)',
    /ERR contatto/.test(r.testo) && r.code === 1 && fineRun(r)?.n_err === 1 && /non leggibili/.test(JSON.stringify(fineRun(r)?.log)), r.testo);
}
{
  const r = gira('session_write.mjs', [json({ contacts: [{ account_id: ACC, nome: 'Anna Bianchi', email: 'anna@negozio.it' }] })], { tabelle: CONTATTI });
  t('contatto nuovo con lettura ok: inserito una volta', scritte(r, 'lead_contacts', 'insert').length === 1, r.testo);
}

console.log('\n== session_write.mjs: indice unico su lead_contacts (migr 0157) ==');
const NUOVO = { account_id: ACC, nome: 'Anna Bianchi', email: 'anna@negozio.it' };
const DOPPIONE = { code: '23505', message: 'duplicate key value violates unique constraint "lead_contacts_account_email_uq"' };
{
  // la lettura non vede il contatto (scritto da un'altra sessione subito dopo): l'insert lo prova, l'indice lo respinge
  const r = gira('session_write.mjs', [json({ contacts: [NUOVO] })], { tabelle: CONTATTI, errori: { 'lead_contacts:insert': DOPPIONE } });
  const f = fineRun(r);
  t('23505 sull\'insert: "gia presente" nel log del giro, non un errore', r.code === 0 && tentate(r, 'lead_contacts', 'insert').length === 1 && f?.n_err === 0 && f?.n_ok === 0
    && f?.log?.[0]?.esito === 'gia presente' && /^indice unico \(.*lead_contacts_account_email_uq/.test(f?.log?.[0]?.da ?? '') && !/ERR contatto/.test(r.testo), JSON.stringify(f) + r.testo);
}
{
  // Gate 3 del 14-10: '' e spazi ai bordi. Due persone con email '' diventano due righe senza email (indice sul nome,
  // non su email ''), e un'email con spazi si confronta e si scrive pulita
  const r = gira('session_write.mjs', [json({ contacts: [{ account_id: ACC, nome: 'Luca Verdi', email: '' }, { account_id: ACC, nome: 'Sara Neri', email: '  ' }] })], { tabelle: CONTATTI });
  const ins = scritte(r, 'lead_contacts', 'insert').map((w) => w.riga);
  t('email \'\' o solo spazi: scritta null, contatti distinti per nome', ins.length === 2 && ins.every((x) => x.email === null), JSON.stringify(ins));
  const s = gira('session_write.mjs', [json({ contacts: [{ account_id: ACC, nome: 'Maria R.', email: ' MARIA@negozio.it ' }, { ...NUOVO, email: ' anna@negozio.it ' }] })], { tabelle: CONTATTI });
  const ins2 = scritte(s, 'lead_contacts', 'insert').map((w) => w.riga);
  t('email con spazi ai bordi: riconosciuta gia\' presente, e quella nuova scritta senza spazi', ins2.length === 1 && ins2[0].email === 'anna@negozio.it' && fineRun(s)?.log?.[0]?.esito === 'gia presente', JSON.stringify(ins2));
}
{
  const r = gira('session_write.mjs', [json({ contacts: [NUOVO] })], { tabelle: CONTATTI, errori: { 'lead_contacts:insert': { code: '23503', message: 'insert or update on table "lead_contacts" violates foreign key constraint' } } });
  t('altro errore sull\'insert (23503): resta un errore (ERR a schermo, n_err 1, exit 1)', /ERR contatto/.test(r.testo) && r.code === 1 && fineRun(r)?.n_err === 1, r.testo);
}


console.log('\n== session_write.mjs: righe in errore nel file .errori.json (gate 14-10, B3) ==');
{
  // lead_evidence non ha una chiave: rilanciare il file intero dopo un errore duplicherebbe le evidenze gia' scritte
  const EVS = [{ account_id: ACC, tipo: 'ig_sessione', payload: { follower: 1 } }, { account_id: ACC, tipo: 'contatti_trovati', payload: { telefoni: ['1'] } }];
  const PERSONA = { account_id: ACC, nome: 'Giulia Blu', email: 'giulia@negozio.it' };
  const f = json({ evidence: EVS, contacts: [PERSONA] }), fk = f.replace(/\.json$/, '.errori.json');
  const r = gira('session_write.mjs', [f], { tabelle: CONTATTI, errori: { 'lead_contacts:insert': { code: '23503', message: 'violates foreign key constraint (finto)' } } });
  const ko = existsSync(fk) ? JSON.parse(readFileSync(fk, 'utf8')) : null;
  t('contatto respinto: exit 1, le due evidenze scritte, nel file errori solo il contatto', r.code === 1 && scritte(r, 'lead_evidence', 'insert').length === 2
    && ko?.evidence?.length === 0 && ko?.contacts?.length === 1 && ko.contacts[0].email === PERSONA.email && /rilancia solo quel file/.test(r.testo), JSON.stringify(ko) + r.testo);
  const r2 = gira('session_write.mjs', [fk], { tabelle: CONTATTI });
  t('... rilanciando il file errori: nessuna evidenza riscritta, il contatto entra, exit 0', r2.code === 0 && tentate(r2, 'lead_evidence', 'insert').length === 0
    && scritte(r2, 'lead_contacts', 'insert').length === 1, JSON.stringify(r2.scritture) + r2.testo);
  const fe = json({ evidence: EVS }), fek = fe.replace(/\.json$/, '.errori.json');
  const e = gira('session_write.mjs', [fe], { tabelle: CONTATTI, errori: { 'lead_evidence:insert': { message: '504 Gateway Timeout (finto)' } } });
  const koe = existsSync(fek) ? JSON.parse(readFileSync(fek, 'utf8')) : null;
  t('evidenze respinte: tutte e due nel file errori, exit 1', e.code === 1 && koe?.evidence?.length === 2 && koe?.contacts?.length === 0, JSON.stringify(koe) + e.testo);
  const fg = json({ evidence: EVS }), g = gira('session_write.mjs', [fg], { tabelle: CONTATTI });
  t('giro senza errori: nessun file errori', g.code === 0 && !existsSync(fg.replace(/\.json$/, '.errori.json')), g.testo);
}

const EV = { id: 'e1e1e1e1-aaaa-bbbb-cccc-000000000001', account_id: ACC };
const CRITERI = Object.fromEntries(['brand', 'stile', 'posto', 'vitalita', 'raggiungibilita', 'digitale'].map((k) => [k, { punti: 7 }]));
const SCORE = { account_id: ACC, nome: 'Negozio Uno', criteri: { ...CRITERI, brand: { punti: 8, prova: 'brand affine', evidence_id: 'e1e1e1e1' } }, gancio: 'brand affine in vetrina', gancio_evidence_id: 'e1e1e1e1' };
const DB_JUDGE = (stato) => ({ lead_evidence: [EV], lead_accounts: [{ id: ACC, nome: 'Negozio Uno', stato_ricerca: stato, tier: null }] });

console.log('\n== judge_write.mjs: evidenze e stato corrente ==');
{
  const r = gira('judge_write.mjs', [json([SCORE])], { tabelle: DB_JUDGE('enriched') });
  const s = scritte(r, 'lead_scores', 'insert')[0]?.riga, u = scritte(r, 'lead_accounts', 'update')[0]?.riga;
  t('letture ok: un punteggio, id evidenza abbreviato risolto al pieno, exit 0', r.code === 0 && s?.criteri?.brand?.evidence_id === EV.id && s?.tier_proposto === 'B', JSON.stringify(s));
  t('letture ok: account a scored con il gancio e la sua evidenza', u?.stato_ricerca === 'scored' && u?.gancio_evidence_id === EV.id, JSON.stringify(u));
}
for (const [guasto, cosa] of [['lead_evidence', 'evidenze dell\'account'], ['lead_accounts', 'stato corrente dell\'account']]) {
  const r = gira('judge_write.mjs', [json([SCORE])], { tabelle: DB_JUDGE('enriched'), guasti: [guasto] });
  t(`lettura ${cosa} in errore: nessun punteggio e nessun update`, r.scritture !== null && scritte(r, 'lead_scores').length === 0 && scritte(r, 'lead_accounts').length === 0,
    JSON.stringify(r.scritture?.filter((w) => w.tabella !== 'lead_runs')));
  t(`... errore visibile (ERR a schermo, n_err 1 in lead_runs, exit 1)`, /ERR Negozio Uno/.test(r.testo) && r.code === 1 && fineRun(r)?.n_err === 1 && /non leggibil/.test(JSON.stringify(fineRun(r)?.log)), r.testo);
}
{
  const r = gira('judge_write.mjs', [json([SCORE])], { tabelle: DB_JUDGE('reviewed') });
  const u = scritte(r, 'lead_accounts', 'update')[0]?.riga;
  t('decisione umana gia\' presa (reviewed): lo stato non si tocca', u && !('stato_ricerca' in u), JSON.stringify(u));
}

console.log('\n== endRun (lib.mjs vera): chiusura del giro non scritta ==');
{
  const r = gira('session_write.mjs', [json({ contacts: [NUOVO] })], { tabelle: CONTATTI, errori: { 'lead_runs:update': { message: '504 Gateway Timeout (finto)' } } });
  t('session_write: endRun respinto = STOP a schermo con i conteggi ed exit code non zero', r.code !== 0 && STOP_FINE.test(r.testo) && /ok 1, err 0/.test(r.testo), `exit ${r.code} ` + r.testo);
  t('... le scritture del giro restano (endRun non annulla niente)', scritte(r, 'lead_contacts', 'insert').length === 1, JSON.stringify(r.scritture));
  const k = gira('judge_write.mjs', [json([SCORE])], { tabelle: DB_JUDGE('enriched'), errori: { 'lead_runs:update': { message: '504 Gateway Timeout (finto)' } } });
  t('judge_write: endRun respinto = STOP ed exit code non zero', k.code !== 0 && STOP_FINE.test(k.testo), `exit ${k.code} ` + k.testo);
  const g = gira('session_write.mjs', [json({ contacts: [NUOVO] })], { tabelle: CONTATTI });
  t('controllo: endRun ok = exit 0 e giro chiuso', g.code === 0 && fineRun(g)?.n_ok === 1 && !!fineRun(g)?.ended_at, `exit ${g.code} ` + g.testo);
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
  const vecchio = (cwd) => { mkdirSync(join(cwd, 'out/judge'), { recursive: true }); writeFileSync(join(cwd, 'out/judge/_index.json'), '[{"nome":"giro di prima"}]'); };
  const g = gira('judge_dump.mjs', ['--id', ACC], { tabelle: DB_DUMP, guasti: ['lead_evidence'], prima: vecchio });
  t('dump, evidenze in errore: STOP con il motivo, nessun evidence.json vuoto', g.code !== 0 && /STOP: evidenze di Negozio Uno non leggibili \(504/.test(g.testo) && !existsSync(join(g.cwd, 'out/judge/negozio_uno/evidence.json')), g.testo);
  t('dump interrotto: l\'_index.json del giro prima non resta accanto ai file nuovi', !existsSync(join(g.cwd, 'out/judge/_index.json')));
}
{
  await import('./lead_finto_hook.mjs'); // il finto riusa lib.mjs vera: il suo supabase-js passa dall'hook
  // il finto legge LEAD_FINTO quando si carica: tabelle di prova solo per i controlli qui sotto
  process.env.LEAD_FINTO = JSON.stringify({ tabelle: { x: [{ id: 1, c: 'Forlì', p: { a: 1, b: 2 } }, { id: 2, c: null, p: { a: 2 } }, { id: 3, c: 'Roma', p: { a: 1 } }] } });
  const { supa } = await import('./lead_finto_lib.mjs');
  delete process.env.LEAD_FINTO;
  const sb = await supa();
  const ids = (r) => (r.data ?? []).map((x) => x.id).join(',');
  // dal 14-10 il finto simula anche contains() (jsonb a un livello): prima lanciava, ora deve filtrare davvero
  t('client finto: contains() filtra davvero, non ignora il filtro', ids(await sb.from('x').select('id').contains('p', { a: 1 }).order('id')) === '1,3' && ids(await sb.from('x').select('id').contains('p', { a: 1, b: 2 })) === '1');
  t('client finto: or() con ilike e is.null, range e count exact come PostgREST', await (async () => {
    const r = await sb.from('x').select('id', { count: 'exact' }).or('c.ilike."%forl_%",c.is.null').order('id').range(1, 1);
    return ids(r) === '2' && r.count === 2;
  })());
  t('client finto: un filtro or() che non conosce rompe lo script', /non simulato/.test((() => { try { sb.from('x').select('id').or('c.gt.1'); return ''; } catch (e) { return e.message; } })()));
}

console.log('\n== collect.mjs (Playwright finto): update di lead_accounts e chiusura del giro ==');
// un account nato da Maps (niente sito ne' handle): Maps trova sito, telefono e indirizzo, il sito (vuoto) gira, l'handle
// arriva dalla site_meta gia' in lead_evidence. Tocca tutte e tre le scritture: anagrafica da Maps, stato, ig_handle.
const DB_COLLECT = {
  lead_accounts: [{ id: ACC, nome: 'Negozio Uno', citta: 'Milano', stato_ricerca: 'seed', website: null, ig_handle: null }],
  lead_evidence: [{ account_id: ACC, tipo: 'site_meta', payload: { ig_from_site: 'negozio_uno' } }],
};
const MAPS = { testo: 'Negozio Uno\n4,6\n(120)\nBoutique\nVia Roma 1, 20121 Milano MI\n02 1234 5678\nnegozio-uno.it\n', url: 'https://www.google.com/maps/place/Negozio+Uno/@45.4642,9.19,17z/data=!4m6!3m5!1s0x4786c6:0x1234!8m2' };
const COLLECT = ['--id', ACC, '--only', 'maps,site,press'];
const senzaOra = (w) => { const { updated_at, ...riga } = w.riga; return JSON.stringify({ riga, eq: w.eq }); };
{
  const r = gira('collect.mjs', COLLECT, { tabelle: DB_COLLECT, maps: MAPS });
  const upd = scritte(r, 'lead_accounts', 'update'), f = fineRun(r);
  t('collect, scritture ok: tre update (anagrafica da Maps, stato enriched, ig_handle), n_ok 1', r.code === 0 && upd.length === 3 && upd[0].riga.website === 'https://negozio-uno.it'
    && upd[1].riga.stato_ricerca === 'enriched' && upd[2].riga.ig_handle === 'negozio_uno' && f?.n_ok === 1 && f?.n_err === 0 && !f?.log?.[0]?.scritture_ko, `exit ${r.code} ` + JSON.stringify(upd) + r.testo);
  const k = gira('collect.mjs', COLLECT, { tabelle: DB_COLLECT, maps: MAPS, errori: { 'lead_accounts:update': { message: '504 Gateway Timeout (finto)' } } });
  const fk = fineRun(k), ko3 = fk?.log?.[0]?.scritture_ko ?? [];
  t('collect, update respinti: l\'account esce in errore nel log del giro (n_err 1, tre scritture_ko con il motivo)', k.code === 0 && fk?.n_ok === 0 && fk?.n_err === 1 && ko3.length === 3
    && /^anagrafica da Maps \(.*website.*\): 504/.test(ko3[0]) && /^stato enriched: 504/.test(ko3[1]) && /^ig_handle dal sito: 504/.test(ko3[2]), `exit ${k.code} ` + JSON.stringify(fk) + k.testo);
  t('... e a schermo (ERR scrittura, una riga per update)', (k.testo.match(/ERR scrittura/g) ?? []).length === 3, k.testo);
  t('... senza cambiare cosa si scrive: tentati gli stessi tre update del giro buono', JSON.stringify(tentate(k, 'lead_accounts', 'update').map(senzaOra)) === JSON.stringify(upd.map(senzaOra)),
    JSON.stringify(tentate(k, 'lead_accounts', 'update')));
  const e = gira('collect.mjs', COLLECT, { tabelle: DB_COLLECT, maps: MAPS, errori: { 'lead_runs:update': { message: '504 Gateway Timeout (finto)' } } });
  t('collect, endRun respinto: STOP a schermo ed exit code non zero', e.code !== 0 && STOP_FINE.test(e.testo), `exit ${e.code} ` + e.testo);
  const g = gira('collect.mjs', COLLECT, { tabelle: DB_COLLECT, maps: MAPS, guasti: ['lead_evidence'] });
  const ug = scritte(g, 'lead_accounts', 'update');
  t('collect, site_meta non leggibile: nessun ig_handle scritto, motivo nel log del giro', g.code === 0 && ug.length === 2 && !ug.some((w) => 'ig_handle' in w.riga)
    && /^non letto: 504/.test(fineRun(g)?.log?.[0]?.ig_dal_sito ?? ''), JSON.stringify(ug) + JSON.stringify(fineRun(g)?.log));
  // gate 14-10, B1: con lo stadio IG. Handle dal sito non letto e nessun handle in anagrafica: lo stadio IG non deve
  // scrivere "nessun handle" (e' falso, non lo sappiamo) e l'account esce in errore (lo stop-loss del 20% lo vede)
  const IG = ['--id', ACC, '--only', 'site,ig'];
  const nessunHandle = (r) => scritte(r, 'lead_evidence', 'insert').filter((w) => /nessun handle/.test(JSON.stringify(w.riga?.payload ?? {})));
  const s1 = gira('collect.mjs', IG, { tabelle: DB_COLLECT, guasti: ['lead_evidence'] });
  t('collect, handle dal sito non letto e nessun handle in anagrafica: stadio IG saltato, account in errore', s1.code === 0 && !nessunHandle(s1).length
    && fineRun(s1)?.log?.[0]?.ig === 'saltato: handle dal sito non letto' && fineRun(s1)?.n_ok === 0 && fineRun(s1)?.n_err === 1, JSON.stringify(fineRun(s1)) + s1.testo);
  const DB_HANDLE = { ...DB_COLLECT, lead_accounts: [{ ...DB_COLLECT.lead_accounts[0], ig_handle: 'negozio_uno' }] };
  const s2 = gira('collect.mjs', IG, { tabelle: DB_HANDLE, guasti: ['lead_evidence'] });
  t('... con l\'handle in anagrafica lo stadio IG gira lo stesso', s2.code === 0 && !nessunHandle(s2).length && /^(ok|partial|err|login|no_)/.test(fineRun(s2)?.log?.[0]?.ig ?? '')
    && fineRun(s2)?.log?.[0]?.ig !== 'saltato: handle dal sito non letto', JSON.stringify(fineRun(s2)) + s2.testo);
  const s3 = gira('collect.mjs', IG, { tabelle: DB_COLLECT });
  t('... e con la lettura buona usa l\'handle del sito (niente "nessun handle", account non in errore per la lettura)', s3.code === 0 && !nessunHandle(s3).length
    && fineRun(s3)?.log?.[0]?.ig !== 'saltato: handle dal sito non letto' && !fineRun(s3)?.log?.[0]?.ig_dal_sito, JSON.stringify(fineRun(s3)) + s3.testo);
}

// ---- Parte 2: sul sorgente ----
console.log('\n== collect.mjs sul sorgente: handle IG dal sito ==');
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
  for (const m of s.matchAll(/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*await\s+(?:sb|q)\b[^;]*;/g)) out.push('risultato non destrutturato: ' + m[0].trim());
  for (const m of s.matchAll(/\.then\(\s*(?:async\s*)?\(\s*\{([^{}]*)\}\s*\)\s*=>/g)) if (/\b(data|count)\b/.test(m[1]) && !/\berror\b/.test(m[1])) out.push('then senza error: ' + m[0]);
  return out;
}
console.log('\n== workers/lead/*.mjs: nessuna lettura con error ignorato ==');
// dal 14-10 sera anche seed.mjs (amimi-app#54): le voci IN_ATTESA_54 che la ammettevano sono state tolte (gate, C5)
for (const f of readdirSync(ROOT + 'workers/lead').filter((x) => x.endsWith('.mjs')).sort()) {
  const trovate = letturaSenzaErrore(read('workers/lead/' + f));
  t(`${f}: ogni lettura destruttura error e lo guarda prima di proseguire`, trovate.length === 0, trovate[0]);
}

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
  ['risultato non destrutturato (res.data senza res.error)', "const res = await sb.from('lead_contacts').select('id').eq('account_id', a);\nconst same = (res.data ?? []).find(f);", 1],
  ['query costruita prima, non destrutturata', 'const r = await q;', 1],
  ['.then con { data } senza error', "sb.from('lead_evidence').select('id').then(({ data }) => use(data));", 1],
  ['.then con { data, error }', "sb.from('lead_evidence').select('id').then(({ data, error }) => { if (error) throw error; use(data); });", 0],
  ['await di un helper (startRun, tutte) non e\' una lettura nuda', "const runId = DRY ? null : await startRun(sb, 'x', 1, 'n');\nconst acc = await tutte(() => sb.from('lead_accounts').select('id', { count: 'exact' }).order('id'), 'x');", 0],
];
for (const [nome, src, atteso] of CASI) t(`rilevatore: ${nome} -> ${atteso ? 'segnalato' : 'non segnalato'}`, letturaSenzaErrore(src).length === atteso, JSON.stringify(letturaSenzaErrore(src)));

// Rilevatore sulle scritture. Ogni await la cui espressione (fino al ';' o all'await successivo) e' una scrittura
// supabase-js (`.from(...)` poi insert/update/upsert/delete, o storage upload/remove) deve stare in un
// `const { ..., error } = await ...`; che `error` sia guardato prima dell'await successivo lo controlla gia'
// letturaSenzaErrore. Gli helper che fanno throw (startRun, endRun, evidence, upload) non hanno `.from(` nella chiamata:
// li copre il loro corpo in lib.mjs.
const SCRITTURA = /\.from\([^)]*\)[\s\S]*\.(?:insert|update|upsert|delete|upload|remove)\(/;
function scritturaSenzaErrore(src) {
  const s = flat(src), out = [];
  for (const m of s.matchAll(/\bawait\b/g)) {
    const dopo = s.slice(m.index + 5), fine = dopo.search(/;|\bawait\b/);
    const expr = 'await' + (fine < 0 ? dopo : dopo.slice(0, fine + (dopo[fine] === ';' ? 1 : 0)));
    if (!SCRITTURA.test(expr)) continue;
    const d = s.slice(Math.max(0, m.index - 400), m.index).match(/\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*$/);
    if (!d || !d[1].split(',').some((c) => c.split(':')[0].trim() === 'error')) out.push(expr.trim());
  }
  return out;
}
// l'insert dell'evidenza fonte di seed.mjs com'era prima di amimi-app#54: resta solo per l'autocontrollo qui sotto
const SEED_SCRITTURA_VECCHIA = "await sb.from('lead_evidence').insert({ account_id: hit, run_id: runId, tipo: 'fonte', payload: { fonte_seed: r.fonte_seed, nome_visto: r.nome, nota: r.owner_note ?? null }, raccolto_da: 'script' });";

console.log('\n== workers/lead/*.mjs: nessuna scrittura con error ignorato ==');
for (const f of readdirSync(ROOT + 'workers/lead').filter((x) => x.endsWith('.mjs')).sort()) {
  const trovate = scritturaSenzaErrore(read('workers/lead/' + f));
  t(`${f}: ogni scrittura destruttura error`, trovate.length === 0, trovate[0]);
}

console.log('\n== autocontrollo del rilevatore sulle scritture ==');
// le cinque scritture del 14-10 come erano prima del fix (collect.mjs x3, endRun in lib.mjs, seed.mjs): tutte viste
const VECCHIE_SCRITTURE = [
  "      if (Object.keys(upd).length) await sb.from('lead_accounts').update({ ...upd, updated_at: new Date().toISOString() }).eq('id', acc.id);",
  "    if (!DRY && anyOk && acc.stato_ricerca === 'seed') await sb.from('lead_accounts').update({ stato_ricerca: 'enriched', updated_at: new Date().toISOString() }).eq('id', acc.id);",
  "    if (!DRY && siteIg && !acc.ig_handle) await sb.from('lead_accounts').update({ ig_handle: siteIg }).eq('id', acc.id);",
  "export async function endRun(sb, id, { n_ok, n_err, log }) {\n  await sb.from('lead_runs').update({ ended_at: new Date().toISOString(), n_ok, n_err, log }).eq('id', id);\n}",
  SEED_SCRITTURA_VECCHIA,
];
t('le cinque scritture del 14-10 (versione vecchia) sono tutte segnalate', VECCHIE_SCRITTURE.every((v) => scritturaSenzaErrore(v).length === 1), VECCHIE_SCRITTURE.find((v) => scritturaSenzaErrore(v).length !== 1));
const CASI_SCRITTURA = [
  ['update a capo senza error', "await sb.from('lead_accounts')\n  .update({ a: 1 })\n  .eq('id', x);", 1],
  ['upload su storage senza error', 'await sb.storage.from(BUCKET).upload(p, buf, { upsert: true });', 1],
  ['delete dentro un if senza error', "if (x) await sb.from('lead_evidence').delete().eq('id', y);", 1],
  ['insert().select() con solo data', "const { data } = await sb.from('lead_runs').insert(r).select('id').single();", 1],
  ['scrittura dopo una lettura, stessa riga', "const { data, error } = await sb.from('x').select('id'); if (!error) await sb.from('x').insert(r);", 1],
  ['insert con error', "const { error } = await sb.from('lead_contacts').insert(r);", 0],
  ['upsert con error in alias', "const { error: e } = await sb.from('x').upsert(r, { onConflict: 'k' }); if (e) throw e;", 0],
  ['insert().select().single() con data ed error', "const { data, error } = await sb.from('lead_runs').insert(r).select('id').single();", 0],
  ['helper che fa throw (niente .from nella chiamata)', "await evidence(sb, { account_id: a, tipo: 'x' });", 0],
  ['select con error: non e\' una scrittura', "const { data, error } = await sb.from('x').select('id').eq('a', 1);", 0],
];
for (const [nome, src, atteso] of CASI_SCRITTURA) t(`rilevatore scritture: ${nome} -> ${atteso ? 'segnalato' : 'non segnalato'}`, scritturaSenzaErrore(src).length === atteso, JSON.stringify(scritturaSenzaErrore(src)));
t('una scrittura con error guardato solo dopo l\'await successivo la vede letturaSenzaErrore',
  letturaSenzaErrore("const { error } = await sb.from('lead_accounts').update(u).eq('id', x);\nawait altro();\nif (error) throw error;").length === 1);

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
