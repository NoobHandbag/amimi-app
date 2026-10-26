// tests/shopify_sync_guardie.mjs — guardie sul SORGENTE di shopify-sync, ce-guard e migr 0117
//   node tests/shopify_sync_guardie.mjs
//
// Nato dall'incidente del 12-09-2026 (756 righe ordine e 884 righe d'ordine doppie in tre giri di cron): la v6
// leggeva TUTTA shopify_orders con `const { data: ex } = await ...` e l'errore ignorato; con un 504 di PostgREST
// `existing` era vuoto e i 250 ordini letti da Shopify entravano tutti come nuovi; oltre le 1.000 righe la stessa
// select tornava troncata e l'ordine piu' recente veniva reinserito a ogni giro. Nessun test lo avrebbe visto:
// e' un guasto che compare solo quando il database risponde male, cioe' mai in un collaudo.
// Questo file quindi non prova la funzione: legge il sorgente e verifica che le cinque regole della v7 ci siano
// ancora. Se qualcuno le toglie "per semplificare", il test lo dice.
import { readFileSync, writeFileSync, rmSync, readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const SYNC = read('supabase/functions/shopify-sync/index.ts');
const GUARD = read('supabase/functions/ce-guard/index.ts');
const SALES = read('supabase/functions/sales-guard/index.ts');
const STOCK = read('supabase/functions/shopify-stock/index.ts');
const MIG = read('supabase/migrations/0117_shopify_orders_dedup_unique.sql');
// Audit gate 14-09 (finding B57): le catene che vanno a capo prima del `.select(` sfuggivano alle regex a riga
// singola (una lettura di tutta la tabella scritta su due righe, la forma esatta dell'incidente v6, non veniva
// contata). Le righe si esaminano dopo aver riattaccato le continuazioni.
const flat = (src) => src.replace(/\)\s*\n\s*\./g, ').');
const lines = flat(SYNC).split('\n');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 200) : '')); } };

console.log('\n== shopify-sync: nessuna lettura di intere tabelle core ==');
{
  const reads = lines.filter((l) => /from\('shopify_orders'\)\s*\.select\(/.test(l));
  t(`1  shopify_orders letta ${reads.length} volte, sempre con .in/.limit/.eq sulla stessa riga`, reads.length > 0 && reads.every((l) => /\.(in|limit|eq)\(/.test(l)), reads.find((l) => !/\.(in|limit|eq)\(/.test(l)));
  const li = lines.filter((l) => /from\('shopify_line_items'\)\s*\.select\(/.test(l));
  t(`2  shopify_line_items letta ${li.length} volte, sempre con .in/.limit/.eq`, li.every((l) => /\.(in|limit|eq)\(/.test(l)));
  t('3  guardia sul cap PostgREST per l\'anagrafica letta intera', /POSTGREST_CAP\s*=\s*1000/.test(SYNC) && /length >= POSTGREST_CAP/.test(SYNC));
  // autocontrollo (finding B57): la forma dell'incidente v6 scritta su due righe deve essere VISTA dal test 1
  const evil = "  const { data: ex0 } = await sb.from('shopify_orders')\n    .select('order_id, created_at_shop');";
  const visto = flat(evil).split('\n').filter((l) => /from\('shopify_orders'\)\s*\.select\(/.test(l));
  t('3b rilevatore: lettura intera su due righe contata e riconosciuta senza .in/.limit/.eq', visto.length === 1 && !/\.(in|limit|eq)\(/.test(visto[0]));
}

console.log('\n== shopify-sync: ogni lettura/scrittura core destruttura `error` ==');
{
  const tables = ['app_config', 'shopify_orders', 'shopify_line_items', 'products', 'product_aliases'];
  for (const tbl of tables) {
    const ops = lines.filter((l) => new RegExp(`await (retryOnce\\(\\(\\) => )?sb\\.from\\('${tbl}'\\)\\.(select|insert|upsert|update)\\(`).test(l) && !/\.delete\(/.test(l));
    const senzaErrore = ops.filter((l) => !/\{[^}]*\berror\b[^}]*\}\s*=\s*await (retryOnce\(\(\) => )?sb\.from/.test(l));
    t(`4  ${tbl}: ${ops.length} operazioni, tutte con error destrutturato`, ops.length > 0 && senzaErrore.length === 0, senzaErrore[0]);
    const scritture = lines.filter((l) => new RegExp(`sb\\.from\\('${tbl}'\\)\\.(insert|upsert|update|delete)\\(`).test(l));
    t(`4b ${tbl}: nessun retry sulle scritture di dati (${scritture.length})`, scritture.every((l) => !/retryOnce/.test(l)), scritture.find((l) => /retryOnce/.test(l)));
  }
  t('5  una lettura fallita ferma il giro: helper fail() che scrive health_log e risponde errore', /const fail = async/.test(SYNC) && /return fail\('ultimo ordine'/.test(SYNC) && /return fail\('ordini esistenti'/.test(SYNC) && /return fail\('products'/.test(SYNC) && /return fail\('product_aliases'/.test(SYNC));
}

console.log('\n== shopify-sync: cinture ==');
{
  const cap = SYNC.match(/const MAX_INSERTS_CRON = (\d+)/);
  t('6  tetto MAX_INSERTS_CRON definito e <= 50', !!cap && Number(cap[1]) <= 50, cap?.[0]);
  t('7  tetto applicato prima degli insert', /nuovi\.length > cap/.test(SYNC) && SYNC.indexOf('nuovi.length > cap') < SYNC.indexOf(".upsert(order"));
  t('8  insert ordine = upsert ignoreDuplicates su order_id (vincolo UNIQUE migr 0117)', /upsert\(order, \{ onConflict: 'order_id', ignoreDuplicates: true \}\)\.select\('id'\)/.test(SYNC));
  t('9  righe inserite SOLO se l\'upsert ha restituito la riga ordine', SYNC.indexOf('if (!ins?.length)') > 0 && SYNC.indexOf('if (!ins?.length)') < SYNC.indexOf("from('shopify_line_items').insert(lines)"));
  t('10 righe fallite: l\'ordine appena scritto viene tolto (ritento al giro dopo)', /from\('shopify_orders'\)\.delete\(\)\.eq\('id', ins\[0\]\.id\)/.test(SYNC));
  t('11 pagina piena (250) = giro fermato', /orders\.length >= 250 && !isBackfill\) return fail/.test(SYNC));
  const fetchUrl = lines.find((l) => /const url = `\$\{API\}\/orders\.json/.test(l)) ?? '';
  t('12 niente order=created_at nella fetch (orders.json non lo onora)', fetchUrl.length > 0 && !/order=/.test(fetchUrl), fetchUrl);
  t('13 le righe portano shopify_line_id', /shopify_line_id: Number\(it\.id\)/.test(SYNC));
  t('14 telemetria: health_log chiave shopify_sync scritta sia a successo che a errore, con upsert su (day,k)', /k: 'shopify_sync'/.test(SYNC) && /onConflict: 'day,k'/.test(SYNC) && (SYNC.match(/await health\(/g) ?? []).length >= 2 && /await health\(label/.test(SYNC));
  t('15 un dryRun (anteprima) non scrive telemetria', /if \(!body\.dryRun\) await health\(/.test(SYNC));
  t('16 delete di compensazione controllata (ordine senza righe detto forte)', /const \{ error: de \} = await sb\.from\('shopify_orders'\)\.delete\(\)/.test(SYNC) && /ORDINE SENZA RIGHE/.test(SYNC));
  t('17 backfill pagina con since_id (mai una sola pagina "recenti")', /isBackfill && !body\.dryRun/.test(SYNC) && /since_id=\$\{sinceId\}&limit=250/.test(SYNC));
  t('18 resync: fulfilled_at mai scritto in un mese chiuso (Regola Ferrea 11)', /from\('ce_snapshots'\)\.select\('year, month'\)/.test(SYNC) && /meseAperto/.test(SYNC));
}

console.log('\n== migr 0117: vincoli ==');
{
  const RB = read('supabase/snippets/0117_rollback_shopify_dedup.sql');
  t('19b rollback scritto (non applicato) con lista colonne esplicita e senza codice_norm', /drop constraint if exists shopify_orders_order_id_key/.test(RB) && /insert into shopify_line_items \(id, order_id, lineitem_name, codice, resolved/.test(RB) && !/insert into shopify_line_items \([^)]*codice_norm/.test(RB));
  t('15 UNIQUE su shopify_orders.order_id', /alter table shopify_orders add constraint shopify_orders_order_id_key unique \(order_id\)/.test(MIG));
  t('16 indice unico parziale su shopify_line_items.shopify_line_id', /create unique index shopify_line_items_shopify_line_id_uq on shopify_line_items \(shopify_line_id\) where shopify_line_id is not null/.test(MIG));
  t('17 backup prima di cancellare', /create table _bak_shopify_orders_2026_09_13 as select \* from shopify_orders/.test(MIG) && MIG.indexOf('_bak_shopify_orders_2026_09_13') < MIG.indexOf('delete from shopify_orders'));
  t('18 conteggi attesi con RAISE (756 / 884 / 753 / 829)', /v_del_o <> 756/.test(MIG) && /v_del_li <> 884/.test(MIG) && /v_righe <> 753 or v_li <> 829/.test(MIG));
  t('19 guardia mesi chiusi (Regola Ferrea 11)', /Regola Ferrea 11/.test(MIG) && /ce_snapshots/.test(MIG));
  t('20 vista v_shopify_doppioni', /create or replace view v_shopify_doppioni/.test(MIG));
}

console.log('\n== ce-guard: il doppione si vede al primo giro ==');
{
  t('21 check ce_shopify_doppioni da v_shopify_doppioni', /v_shopify_doppioni/.test(GUARD) && /add\('ce_shopify_doppioni'/.test(GUARD));
  t('22 letture fallite non producono verdi per finta: ce_guard_letture', /add\('ce_guard_letture'/.test(GUARD) && /failedReads/.test(GUARD));
  // solo il blocco `run` (le azioni close_month/status leggono anche loro, ma non decidono un check)
  const RUN = GUARD.slice(GUARD.indexOf('// ---- run: tutti i check ----'));
  const reads = RUN.split('\n').filter((l) => /await sb\.from\('(v_inventory|v_ce_drift|shopify_orders|shopify_stock|qromo_sales|v_shopify_doppioni|health_log)'\)/.test(l) && /\.select\(/.test(l));
  const nonTracciate = reads.filter((l) => !/read\(/.test(l));
  t(`23 le ${reads.length} letture che decidono un check passano da read()`, reads.length > 0 && nonTracciate.length === 0, nonTracciate[0]);
  t('24 il fermo del sync arriva al banner: ce_shopify_sync rispecchia health_log.shopify_sync prima della delete ce_%', /eq\('k', 'shopify_sync'\)/.test(RUN) && /add\('ce_shopify_sync'/.test(RUN) && RUN.indexOf("add('ce_shopify_sync'") < RUN.indexOf("delete().eq('day', today).like('k', 'ce_%')"));
  t('25 un cron del sync fermo/morto accende ce_shopify_sync (nessun giro da >120 min o nessuna riga dopo le 02 UTC)', /syncFermo/.test(RUN) && /> 120/.test(RUN) && /getUTCHours\(\) >= 2/.test(RUN));
  t('26 un conteggio DB non letto nel reconcile non finisce in ce_shopify_token', /if \(dbRes\.error\) continue;/.test(RUN));
  // 2026-09-14 (audit gate): il guardiano di conservazione delle spese (anti-logistica) e' cablato
  t('26b ce-guard controlla la completezza spese (v_ce_completezza) e ricavi (v_vendite_orfane)',
    /v_ce_completezza/.test(GUARD) && /add\('ce_completezza_spese'/.test(GUARD) && /v_vendite_orfane/.test(GUARD) && /add\('ce_completezza_ricavi'/.test(GUARD));
}

console.log('\n== guardie: verdetti in health_log con upsert controllato (audit gate 14-09, B13/B60) ==');
{
  const flat = (s) => s.replace(/\)\s*\n\s*\./g, ').');
  // ce-guard v6, sales-guard v3: un solo upsert su (day,k) con error destrutturato, niente piu' delete+insert non controllato
  for (const [nome, src] of [['ce-guard', GUARD], ['sales-guard', SALES]]) {
    const f = flat(src);
    t(`27 ${nome}: verdetti scritti con upsert(..., { onConflict: 'day,k' }) e error destrutturato`,
      /const \{ error: \w+ \} = await sb\.from\('health_log'\)\.upsert\(checks\.map/.test(f) && /onConflict: 'day,k'/.test(f), nome);
    t(`28 ${nome}: la scrittura fallita ferma con errore e NON tocca ntfy`, /health_log non scrivibile/.test(src));
    // ntfy: la fetch e' assegnata e .ok controllato prima di aggiornare lo stato dell'alert
    t(`29 ${nome}: const res = await fetch(ntfy) e stato alert aggiornato solo se res.ok`,
      /const res = await fetch\(/.test(src) && /res\.ok/.test(src) && /_alert_state/.test(src), nome);
  }
  // shopify-stock v17: un helper unico writeAutopushHealth con upsert; niente piu' delete su health_log
  const fs = flat(STOCK);
  t("30 shopify-stock: writeAutopushHealth fa upsert su (day,k) con error destrutturato",
    /const writeAutopushHealth = async/.test(STOCK) && /const \{ error \} = await sb\.from\('health_log'\)\.upsert\(\{ day, k: 'stock_autopush'/.test(fs) && /onConflict: 'day,k'/.test(fs));
  t("31 shopify-stock: nessun delete non controllato di health_log stock_autopush (sostituito dall'upsert)",
    !/from\('health_log'\)\.delete\(\)\.eq\('day', today\)\.eq\('k', 'stock_autopush'\)/.test(fs));
}

// ==== secondo canale degli avvisi (PR B delle notifiche native, 17-10-2026) ====
// ce-guard e sales-guard mandano gli avvisi anche come notifica dell'app via push-api, dietro app_flags.push_canale_guardie
// (nasce 'ntfy'). La logica sta in supabase/functions/_shared/push.ts: qui si carica QUEL file coi tipi tolti e lo si guida
// con spedizioni e fetch finti; poi guardie sul sorgente dei due guardiani. Brief: Cowork12/_CLAUDE_CODE_INBOX/
// 2026-10-17_BRIEF_notifiche_guardie_PR_B.md.
const PUSH_SRC = read('supabase/functions/_shared/push.ts');
const PUSH_API = read('supabase/functions/push-api/index.ts');
const MIG165 = read('supabase/migrations/0165_push_canale_guardie.sql');
process.removeAllListeners('warning');
// fuori dal repo (Gate 2 del 17-10, C4): una run interrotta non lascia un file da committare per sbaglio
const TMP_DIR = mkdtempSync(join(tmpdir(), 'amimi-push-'));
const TMP_PUSH = join(TMP_DIR, 'push.mjs');
writeFileSync(TMP_PUSH, stripTypeScriptTypes(PUSH_SRC), 'utf8');
let P;
try { P = await import(pathToFileURL(TMP_PUSH).href); } finally { try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* niente */ } }
const { canaleEffettivo, consegnata, consegnaAvviso, esitoDaRisposta, inviaPush, APP_URL, TIMEOUT_PUSH_MS } = P;

console.log('\n== push: canaleEffettivo (interruttore push_canale_guardie) ==');
{
  t('40 acceso + entrambi / push / ntfy', canaleEffettivo('true', 'entrambi') === 'entrambi' && canaleEffettivo('true', 'push') === 'push' && canaleEffettivo('true', 'ntfy') === 'ntfy');
  t('41 maiuscole e spazi tollerati', canaleEffettivo(' TRUE ', '  Push ') === 'push' && canaleEffettivo('True', 'ENTRAMBI') === 'entrambi');
  t('42 valore assente, vuoto o sconosciuto = ntfy', [undefined, null, '', 'boh', 'push,ntfy', 'entrambi!'].every((v) => canaleEffettivo('true', v) === 'ntfy'));
  t('43 push_enabled non "true" forza ntfy anche con push/entrambi', ['false', undefined, null, '', '1', 'yes', 'on', true].every((v) => canaleEffettivo(v, 'push') === 'ntfy' && canaleEffettivo(v, 'entrambi') === 'ntfy'));
}

console.log('\n== push: consegnata (quando lo stato dell\'avviso si salva) ==');
{
  const OK = { ok: true }, KO = { ok: false };
  t('44 ntfy: decide solo ntfy, la push non conta', consegnata('ntfy', true, null) && !consegnata('ntfy', false, OK) && !consegnata('ntfy', null, OK) && !consegnata('ntfy', null, null));
  t('45 entrambi: decide ntfy quando e\' partito', consegnata('entrambi', true, KO) && !consegnata('entrambi', false, OK) && consegnata('entrambi', true, null));
  t('46 entrambi senza topic ntfy (null): decide la push', consegnata('entrambi', null, OK) && !consegnata('entrambi', null, KO) && !consegnata('entrambi', null, null));
  t('47 push: basta la push o il ripiego ntfy', consegnata('push', null, OK) && consegnata('push', true, KO) && !consegnata('push', false, KO) && !consegnata('push', null, KO) && !consegnata('push', null, null));
}

console.log('\n== push: consegnaAvviso (chi parte, in che ordine) ==');
{
  const PUSH_OK = { ok: true, inviati: 2, falliti: 0, destinatari: 2, status: 200 };
  const PUSH_ZERO = { ok: false, inviati: 0, falliti: 0, destinatari: 0, status: 200 };
  const finto = (rNtfy, rPush) => {
    const log = [];
    return {
      log,
      ntfy: async () => { log.push('ntfy'); if (rNtfy instanceof Error) throw rNtfy; return rNtfy; },
      push: async () => { log.push('push'); if (rPush instanceof Error) throw rPush; return rPush; },
    };
  };
  let f = finto(true, PUSH_OK);
  let r = await consegnaAvviso('ntfy', f.ntfy, f.push);
  t('48 ntfy: la push non parte mai', f.log.join() === 'ntfy' && r.consegnata === true && r.push === null, f.log);
  f = finto(false, PUSH_OK); r = await consegnaAvviso('ntfy', f.ntfy, f.push);
  t('49 ntfy fallito: non consegnato (il giro dopo riprova, come prima)', r.consegnata === false && f.log.join() === 'ntfy');
  f = finto(true, PUSH_OK); r = await consegnaAvviso('push', f.ntfy, f.push);
  t('50 push arrivata: ntfy non parte', f.log.join() === 'push' && r.consegnata === true && r.ntfyOk === null, f.log);
  f = finto(true, PUSH_ZERO); r = await consegnaAvviso('push', f.ntfy, f.push);
  t('51 push a zero telefoni: ripiego ntfy DOPO la push, consegnato da ntfy', f.log.join() === 'push,ntfy' && r.consegnata === true, f.log);
  f = finto(false, PUSH_ZERO); r = await consegnaAvviso('push', f.ntfy, f.push);
  t('52 push a zero e ntfy fallito: non consegnato', r.consegnata === false);
  f = finto(false, PUSH_OK); r = await consegnaAvviso('entrambi', f.ntfy, f.push);
  t('53 entrambi: partono tutti e due, decide ntfy (push ok + ntfy ko = non consegnato)', f.log.length === 2 && f.log.includes('ntfy') && f.log.includes('push') && r.consegnata === false && r.push?.ok === true);
  // in parallelo: ntfy aspetta che la push sia partita; se fossero in sequenza (prima ntfy) ntfy scadrebbe e varrebbe false
  let pushPartita; const partita = new Promise((res) => { pushPartita = res; });
  r = await consegnaAvviso('entrambi',
    async () => { await Promise.race([partita, new Promise((_, rej) => setTimeout(() => rej(new Error('push non partita in parallelo')), 500))]); return true; },
    async () => { pushPartita(); return PUSH_OK; });
  t('54 entrambi: ntfy e push in parallelo', r.consegnata === true && r.ntfyOk === true);
  f = finto(new Error('ntfy esploso'), PUSH_OK);
  try { r = await consegnaAvviso('ntfy', f.ntfy, f.push); } catch { r = null; }
  t('55 una spedizione ntfy che lancia conta come fallita e non esce', r?.ntfyOk === false && r?.consegnata === false);
  f = finto(true, new Error('push esplosa')); r = await consegnaAvviso('push', f.ntfy, f.push);
  t('56 una push che lancia: esito ok:false con errore, poi il ripiego ntfy', r.push?.ok === false && /push esplosa/.test(r.push?.errore ?? '') && f.log.join() === 'push,ntfy' && r.consegnata === true, r);
  f = finto(null, PUSH_ZERO); r = await consegnaAvviso('push', f.ntfy, f.push);
  t('57 push a zero e nessun topic ntfy (null): non consegnato', r.consegnata === false && r.ntfyOk === null);
}

console.log('\n== push: esitoDaRisposta (la risposta di push-api) ==');
{
  const e1 = esitoDaRisposta(200, { ok: true, inviati: 2, falliti: 1, rimossi: 0, destinatari: 3, esiti: { ok: 2 } });
  t('58 2xx con telefoni raggiunti: ok, conteggi', e1.ok === true && e1.inviati === 2 && e1.falliti === 1 && e1.destinatari === 3 && e1.status === 200 && !('errore' in e1), e1);
  t('59 skipped disabled / tema_spento: non ok, motivo riportato', esitoDaRisposta(200, { ok: false, skipped: 'disabled', inviati: 0 }).skipped === 'disabled'
    && esitoDaRisposta(200, { ok: false, skipped: 'tema_spento', inviati: 0 }).ok === false);
  t('60 ok:true ma zero inviati (fuori contratto) = non ok', esitoDaRisposta(200, { ok: true, inviati: 0 }).ok === false);
  const dry = esitoDaRisposta(200, { ok: true, dryRun: true, inviati: 0, destinatari: 3 });
  t('61 dryRun: ok = ci sono destinatari, dryRun riportato', dry.ok === true && dry.dryRun === true && dry.destinatari === 3);
  const e503 = esitoDaRisposta(503, { error: 'oltre 50 telefoni iscritti al tema conti: invio fermato' });
  t('62 errore di push-api: non ok, testo del servizio', e503.ok === false && e503.status === 503 && /oltre 50/.test(e503.errore));
  t('63 corpo assente, array o stringa: non ok, errore generico sui non-2xx', esitoDaRisposta(401, null).errore === 'push-api ha risposto 401'
    && esitoDaRisposta(200, [1]).ok === false && esitoDaRisposta(200, 'x').ok === false && esitoDaRisposta(500, { ok: true, inviati: 5 }).ok === false);
  // RF-7 (Gate 3 del 18-10, push-eventi): il chi rimandato da push-api v2 passa nell'esito (null = tutti), e assente resta
  // assente (push-api v1): push-eventi distingue cosi' una push per una persona finita a tutti. I guardiani non lo guardano.
  const conChi = esitoDaRisposta(200, { ok: true, inviati: 1, destinatari: 1, chi: 'Bene' }), tutti = esitoDaRisposta(200, { ok: true, inviati: 1, destinatari: 1, chi: null });
  t('63b chi rimandato: stringa (tagliata a 20) o null riportati; assente o di altro tipo -> nessuna chiave chi', conChi.chi === 'Bene' && tutti.chi === null && 'chi' in tutti
    && !('chi' in e1) && !('chi' in esitoDaRisposta(200, { ok: true, inviati: 1, chi: 3 })) && esitoDaRisposta(200, { ok: true, inviati: 1, chi: 'x'.repeat(40) }).chi.length === 20);
}

console.log('\n== push: inviaPush (POST a push-api, mai un\'eccezione) ==');
{
  const KEY = 'chiave_servizio_FINTA_per_test';  // non nel formato sb_secret_: la scansione segreti della Gate 1 resta muta
  const ENV = { url: 'https://progetto.supabase.co/', key: KEY };
  const risposta = (status, corpo) => ({ status, json: async () => { if (corpo === undefined) throw new SyntaxError('non JSON'); return corpo; } });
  let visto = null;
  const fetchFinto = (res) => async (url, init) => { visto = { url, init }; if (res instanceof Error) throw res; return res; };
  const msg = { tema: 'conti', titolo: 'Amimi: 2 da controllare', testo: '- riga', urgente: true };
  let e = await inviaPush(msg, ENV, fetchFinto(risposta(200, { ok: true, inviati: 1, falliti: 0, destinatari: 1 })));
  const body = JSON.parse(visto.init.body);
  t('64 URL = SUPABASE_URL + /functions/v1/push-api (senza doppia barra)', visto.url === 'https://progetto.supabase.co/functions/v1/push-api', visto.url);
  t('65 POST, Bearer con la chiave di servizio, JSON', visto.init.method === 'POST' && visto.init.headers.Authorization === 'Bearer ' + KEY && visto.init.headers['Content-Type'] === 'application/json');
  t('66 corpo: action invia, tema, titolo, testo, url di default, urgente; nessun dryRun', body.action === 'invia' && body.tema === 'conti' && body.titolo === msg.titolo && body.testo === msg.testo && body.url === APP_URL && body.urgente === true && !('dryRun' in body), body);
  // tre telefoni x 10 s di push-api piu' i ritentativi delle sue letture stanno sotto i 40 s (Gate 2 del 17-10, C2)
  t('67 c\'e\' un timeout (AbortSignal), fra 35 e 60 s', visto.init.signal instanceof AbortSignal && TIMEOUT_PUSH_MS >= 35000 && TIMEOUT_PUSH_MS <= 60000);
  t('68 risposta 2xx con un telefono: ok', e.ok === true && e.inviati === 1);
  e = await inviaPush({ ...msg, dryRun: true, urgente: undefined }, ENV, fetchFinto(risposta(200, { ok: false, dryRun: true, inviati: 0, destinatari: 0 })));
  const b2 = JSON.parse(visto.init.body);
  t('69 dryRun passato a push-api; urgente assente = false', b2.dryRun === true && b2.urgente === false && e.dryRun === true && e.ok === false);
  // 18-10 (push-eventi): chi facoltativo passa a push-api solo se c'e'; i guardiani non lo mandano e il corpo resta quello di prima
  await inviaPush({ ...msg, chi: 'Bene' }, ENV, fetchFinto(risposta(200, { ok: true, inviati: 1, destinatari: 1 })));
  const b3 = JSON.parse(visto.init.body);
  await inviaPush({ ...msg, chi: '' }, ENV, fetchFinto(risposta(200, { ok: true, inviati: 1, destinatari: 1 })));
  const b4 = JSON.parse(visto.init.body);
  t('69b chi passato solo se dato (Bene -> chi: Bene); vuoto o assente -> nessuna chiave chi, come i guardiani', b3.chi === 'Bene' && !('chi' in b4) && !('chi' in body), { b3, b4 });
  const esiti = [];
  esiti.push(await inviaPush(msg, ENV, fetchFinto(new Error(`rete giu verso ${KEY}`))));
  esiti.push(await inviaPush(msg, ENV, fetchFinto(new DOMException('signal timed out', 'TimeoutError'))));
  esiti.push(await inviaPush(msg, ENV, fetchFinto(risposta(200, undefined))));
  esiti.push(await inviaPush(msg, ENV, fetchFinto(risposta(401, { error: 'sessione non valida' }))));
  t('70 errore di rete: esito con errore, nessuna eccezione, chiave oscurata', esiti[0].ok === false && /\[chiave\]/.test(esiti[0].errore) && !esiti[0].errore.includes(KEY), esiti[0]);
  t('71 timeout: esito TimeoutError', esiti[1].ok === false && /^TimeoutError/.test(esiti[1].errore), esiti[1]);
  t('72 risposta non JSON (anche un 2xx): non ok, con errore', esiti[2].ok === false && esiti[2].status === 200 && esiti[2].errore === 'risposta di push-api non leggibile', esiti[2]);
  t('73 401 (chiave rifiutata): non ok, testo del servizio', esiti[3].ok === false && esiti[3].status === 401 && esiti[3].errore === 'sessione non valida');
  let chiamato = false;
  const senzaChiave = await inviaPush(msg, { url: 'https://progetto.supabase.co', key: '' }, async () => { chiamato = true; return risposta(200, {}); });
  t('74 chiave o URL mancanti: niente fetch, esito con errore', !chiamato && senzaChiave.ok === false && /mancanti/.test(senzaChiave.errore));
  t('75 la chiave non compare in nessun esito', [e, ...esiti, senzaChiave].every((x) => !JSON.stringify(x).includes(KEY)));
  t('76 in produzione legge SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY', /Deno\.env\.get\('SUPABASE_URL'\)/.test(PUSH_SRC) && /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/.test(PUSH_SRC));
  t('77 il modulo condiviso non importa niente (i guardiani restano senza web-push)', !/^\s*import\s/m.test(PUSH_SRC));
  t('78 push-api legge esattamente i campi che manda inviaPush (dal 18-10 anche chi, validato da chiDestinatario)', ['tema', 'titolo', 'testo', 'url'].every((k) => PUSH_API.includes(`body.${k}`)) && /body\.urgente === true/.test(PUSH_API) && /body\.dryRun === true/.test(PUSH_API)
    && PUSH_API.includes('chiDestinatario(body.chi)'));
  const apiUrl = PUSH_API.match(/const APP_URL = '([^']+)'/)?.[1];
  t('79 APP_URL uguale a quello di push-api e al click di ntfy di ce-guard', APP_URL === apiUrl && GUARD.includes(`click: '${APP_URL}'`), apiUrl);
}

console.log('\n== push: guardie sul sorgente di ce-guard e sales-guard ==');
{
  // whitelist dei flag (CONOSCENZA 02-08): un flag letto ma non elencato nella .in() vale undefined per sempre, in silenzio
  const listaIn = (src, chiave) => {
    for (const m of src.matchAll(/\.in\('key', \[([^\]]*)\]\)/g)) {
      const keys = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
      if (keys.includes(chiave)) return keys;
    }
    return [];
  };
  const orfaniCe = (src) => { const l = listaIn(src, 'ntfy_topic'); return [...src.matchAll(/\bflag\('([^']+)'\)/g)].map((x) => x[1]).filter((k) => !l.includes(k)); };
  const orfaniSales = (src) => { const l = listaIn(src, 'sales_guard_enabled'); return [...src.matchAll(/\bflags\.(\w+)/g)].map((x) => x[1]).filter((k) => !l.includes(k)); };
  const lCe = listaIn(GUARD, 'ntfy_topic'), lSa = listaIn(SALES, 'sales_guard_enabled');
  t('80 ce-guard: topic e interruttore in UNA lettura .in() di app_flags', ['ntfy_topic', 'push_enabled', 'push_canale_guardie'].every((k) => lCe.includes(k)), lCe);
  t('81 ce-guard: ogni flag(...) consumato sta nella whitelist', orfaniCe(GUARD).length === 0 && (GUARD.match(/\bflag\('/g) ?? []).length >= 3, orfaniCe(GUARD));
  t('82 sales-guard: push_enabled e push_canale_guardie nella whitelist', ['push_enabled', 'push_canale_guardie'].every((k) => lSa.includes(k)), lSa);
  t('83 sales-guard: ogni flags.X consumato sta nella whitelist', orfaniSales(SALES).length === 0, orfaniSales(SALES));
  t('83b rilevatore: un flag letto e non elencato viene visto', orfaniCe(".in('key', ['ntfy_topic']) flag('ntfy_topic') flag('assente')").join() === 'assente'
    && orfaniSales(".in('key', ['sales_guard_enabled']) flags.sales_guard_enabled flags.assente").join() === 'assente');
  t('84 entrambi decidono il canale con canaleEffettivo(push_enabled, push_canale_guardie)',
    /canale = canaleEffettivo\(flag\('push_enabled'\), flag\('push_canale_guardie'\)\)/.test(GUARD) && /canale = canaleEffettivo\(flags\.push_enabled, flags\.push_canale_guardie\)/.test(SALES));
  t('85 il blocco avvisi entra con un topic OPPURE un canale diverso da ntfy, e senza topic ntfy non parte (null)',
    [GUARD, SALES].every((s) => /if \(topic \|\| canale !== 'ntfy'\) \{/.test(s) && /if \(!topic\) return null;/.test(s)));
  // stato salvato SOLO ad avviso consegnato
  t('86 ce-guard: ceguard_alert_state salvato solo dentro if (av.consegnata), una volta sola',
    /if \(av\.consegnata\) \{\s*const \{ error: stErr \} = await sb\.from\('app_flags'\)\.upsert\(\[\{ key: 'ceguard_alert_state'/.test(GUARD) && (GUARD.match(/key: 'ceguard_alert_state'/g) ?? []).length === 1);
  t('87 sales-guard: sales_guard_alert_state salvato solo dentro if (av.consegnata), con l\'errore controllato',
    /if \(av\.consegnata\) \{\s*notified = true;\s*const \{ error: stErr \} = await sb\.from\('app_flags'\)\.upsert\(\{ key: 'sales_guard_alert_state'/.test(SALES)
    && /if \(stErr\) ntfyError = /.test(SALES) && (SALES.match(/key: 'sales_guard_alert_state'/g) ?? []).length === 1);
  const nonControllate = (src) => src.split('\n').filter((l) => /\.from\('app_flags'\)\.upsert\(/.test(l) && !/const \{ error: \w+ \} = await/.test(l));
  t('88 nessuna scrittura di app_flags senza error destrutturato nei due guardiani', nonControllate(GUARD).length === 0 && nonControllate(SALES).length === 0, [...nonControllate(GUARD), ...nonControllate(SALES)][0]);
  t('88b rilevatore: la riga della v3 (upsert non controllato) viene vista',
    nonControllate("          await sb.from('app_flags').upsert({ key: 'sales_guard_alert_state', value: sig }, { onConflict: 'key' });").length === 1);
  // temi, titoli, testi e priorita' invariati; la push porta gli stessi titolo e testo di ntfy
  t('89 ce-guard: push col tema conti, stessi titolo e testo, urgente coi problemi',
    /inviaPush\(\{ tema: 'conti', titolo: title, testo: message, url: APP_URL, urgente: hasProblems \}\)/.test(GUARD));
  t('90 sales-guard: push col tema vendite, stessi titolo e testo (800), urgente con l\'errore',
    /inviaPush\(\{ tema: 'vendite', titolo: title, testo: msg\.slice\(0, 800\), url: APP_URL, urgente: errs\.length > 0 \}\)/.test(SALES));
  t('91 ce-guard: titoli, priorita\', tag e click di ntfy invariati',
    GUARD.includes("const title = hasProblems ? `Amimi: ${errs.length} da controllare` : 'Amimi: tutto a posto';")
    && GUARD.includes("priority: hasProblems ? 4 : 3, tags: [hasProblems ? 'warning' : 'white_check_mark'], click: 'https://noobhandbag.github.io/amimi-app/'"));
  t('92 sales-guard: titoli, testo, priorita\' e tag di ntfy invariati',
    SALES.includes("const title = errs.length ? 'Vendite: serve un occhio' : 'Vendite: rientrato, tutto ok';")
    && SALES.includes("message: msg.slice(0, 800), priority: errs.length ? 5 : 3, tags: [errs.length ? 'rotating_light' : 'white_check_mark']"));
  t('93 decisione invariata: ce-guard decidiAlert, sales-guard firma degli error contro lo stato',
    /const dec = decidiAlert\(errs, prev, alertDetail \?\? \{\}, alertDetail \? prevDetail : null\);/.test(GUARD) && /if \(sig !== last\) \{/.test(SALES));
  t('94 sales-guard dryRun: prova a vuoto di push-api (dryRun: true) PRIMA di ogni scrittura, e riporta il canale',
    /if \(dryRun\) \{\s*const push_prova = await inviaPush\(\{[^}]*dryRun: true \}\);\s*return json\(\{ ok: true, dryRun: true, checks, canale: canaleEffettivo\(/.test(SALES)
    && SALES.indexOf('if (dryRun) {') < SALES.indexOf("from('health_log').upsert("));
  t('95 le risposte dicono il canale e l\'esito della push', /checks, problems, canale,/.test(GUARD) && /checks, notified, canale,/.test(SALES)
    && [GUARD, SALES].every((s) => /\.\.\.\(esitoPush \? \{ push: esitoPush \} : \{\}\)/.test(s)));
  // web-push solo in push-api: i guardiani (e il modulo condiviso) non la caricano
  const FN = `${ROOT}supabase/functions`;
  const tsFiles = readdirSync(FN, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'push-api')
    .flatMap((d) => readdirSync(`${FN}/${d.name}`).filter((n) => n.endsWith('.ts')).map((n) => `${FN}/${d.name}/${n}`));
  const conWebPush = tsFiles.filter((f) => /from ['"](npm:|jsr:)?[^'"]*web-?push/i.test(readFileSync(f, 'utf8')));
  t(`96 nessun import di web-push fuori da push-api (${tsFiles.length} file)`, tsFiles.length > 10 && conWebPush.length === 0 && existsSync(`${FN}/_shared/push.ts`), conWebPush[0]);
  t('97 i due guardiani importano il client da ../_shared/push.ts', [GUARD, SALES].every((s) => /from '\.\.\/_shared\/push\.ts';/.test(s)));
  // Gate 2 del 17-10 (C1): il caso 29 resta verde anche con `return true` al posto di `return res.ok` (lo `res.ok` di
  // `if (!res.ok)` basta alla sua regex), e niente fissava che consegnaAvviso riceva il canale vero. Qui la forma esatta.
  const ntfyEsatto = /if \(!res\.ok\) ntfyFailed = res\.status;\s*return res\.ok;\s*\} catch \(e\) \{ ntfyError = 'ntfy non raggiungibile: ' \+ [^}]*return false; \}/;
  t('100 mandaNtfy: ok = res.ok, ntfy_failed sul non-2xx, false (non null) su un errore di rete', [GUARD, SALES].every((s) => ntfyEsatto.test(s)));
  t('100b rilevatore: `return true` al posto di `return res.ok` viene visto',
    !ntfyEsatto.test("if (!res.ok) ntfyFailed = res.status;\n            return true;\n          } catch (e) { ntfyError = 'ntfy non raggiungibile: ' + x; return false; }"));
  t('101 consegnaAvviso riceve il canale letto dai flag (mai una modalita\' scritta a mano)',
    [GUARD, SALES].every((s) => /const av = await consegnaAvviso\(canale, mandaNtfy, /.test(s) && (s.match(/consegnaAvviso\(/g) ?? []).length === 1));
  // Gate 2 del 17-10 (C3): _shared/push.ts finisce nel bundle di OGNI edge che lo importa, quindi una modifica si deploya
  // su tutte. L'elenco sta in EDGE_FUNCTIONS.md (ce-guard v10): un importatore nuovo fa diventare rosso questo caso.
  // 18-10: push-eventi e' il terzo (usa solo inviaPush; caso 103 e tests/push_eventi_core.mjs).
  const importatori = readdirSync(FN, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(`${FN}/${d.name}/index.ts`))
    .filter((d) => /from '\.\.\/_shared\/push\.ts'/.test(readFileSync(`${FN}/${d.name}/index.ts`, 'utf8'))).map((d) => d.name).sort();
  t('102 _shared/push.ts e\' importato solo da ce-guard, push-eventi e sales-guard (una modifica = deploy di tutte e tre)', importatori.join() === 'ce-guard,push-eventi,sales-guard', importatori);
  const PE = existsSync(`${FN}/push-eventi/index.ts`) ? readFileSync(`${FN}/push-eventi/index.ts`, 'utf8').replace(/^\s*\/\/[^\n]*$/gm, '') : '';
  t('103 push-eventi importa SOLO inviaPush (piu\' il tipo dell\'esito): mai consegnaAvviso, quindi mai il ripiego su ntfy',
    /import \{ inviaPush \} from '\.\.\/_shared\/push\.ts';/.test(PE) && !/consegnaAvviso|canaleEffettivo|ntfy/i.test(PE));
}

console.log('\n== migr 0165: interruttore ==');
{
  t('98 push_canale_guardie nasce ntfy, senza sovrascrivere un valore gia\' cambiato', /insert into app_flags \(key, value\) values \('push_canale_guardie', 'ntfy'\) on conflict \(key\) do nothing/.test(MIG165));
  t('99 controllo a fine migrazione con RAISE', /raise exception '0165: push_canale_guardie nato qui vale % invece di ntfy'/.test(MIG165) && /raise exception '0165: manca app_flags\.push_canale_guardie'/.test(MIG165));
}

// ==== ce-guard v11 (18-10-2026): ce_shopify_reconcile conta solo gli ordini nati prima dell'ora piena del giro ====
// Il 17-10 alle 11:30 ce-guard contava Shopify fino ad ADESSO contro un DB fermo al sync delle 11:07: #1912, nato alle
// 11:14:18, era su Shopify e non ancora nell'app, e il check e' diventato rosso per un'ora (falso allarme da tempi, 34
// episodi nei primi 17 giorni di ottobre). Report: Cowork12/_CLAUDE_CODE_INBOX/REPORT_ntfy_429_e_riconciliazione_ordini_
// 2026-10-17.md, proposta A. Qui si ritaglia il blocco PURE:ceguard-reconcile dal sorgente e lo si guida con ordini finti.
console.log('\n== ce-guard: riconciliazione ordini fino all\'ora piena (v11) ==');
{
  const B = '// ==== PURE:ceguard-reconcile BEGIN ====', E = '// ==== PURE:ceguard-reconcile END ====';
  const a = GUARD.indexOf(B), b = GUARD.indexOf(E);
  t('103 il blocco PURE:ceguard-reconcile c\'e\' in ce-guard', a >= 0 && b > a);
  let finestraReconcile = null;
  if (a >= 0 && b > a) {
    const dir = mkdtempSync(join(tmpdir(), 'amimi-reconcile-'));
    const f = join(dir, 'reconcile.mjs');
    writeFileSync(f, stripTypeScriptTypes(GUARD.slice(a + B.length, b)) + '\nexport { finestraReconcile };\n', 'utf8');
    try { ({ finestraReconcile } = await import(pathToFileURL(f).href)); } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* niente */ } }
  }
  if (finestraReconcile) {
    const W = (now, y, m) => finestraReconcile(new Date(now), y, m);
    const ms = (s) => Date.parse(s);
    // il modello dei due conteggi: l'API conta min <= creato <= max (created_at_max e' incluso per Shopify), il DB conta
    // gli ordini gia' entrati col sync e nati prima del cutoff (year/month UTC, come shopify-sync)
    const conta = (w, ordini) => w.vuota ? { api: 0, db: 0 } : {
      api: ordini.filter((o) => ms(o.creato) >= ms(w.min) && ms(o.creato) <= ms(w.max)).length,
      db: ordini.filter((o) => o.nelDb && ms(o.creato) >= ms(w.min) && ms(o.creato) < ms(w.cutoff)).length,
    };
    // la finestra di prima (v10): API da inizio mese a fine mese, DB solo year/month
    const contaPrima = (ordini) => ({ api: ordini.length, db: ordini.filter((o) => o.nelDb).length });
    const GIRO = '2026-10-17T11:30:00Z';
    const w = W(GIRO, 2026, 10);
    t('104 giro delle 11:30 del 17-10: da inizio mese alle 10:59:59, cutoff 11:00', w.vuota === false && w.min === '2026-10-01T00:00:00Z'
      && w.max === '2026-10-17T10:59:59Z' && w.cutoff === '2026-10-17T11:00:00Z', JSON.stringify(w));
    const base = [{ creato: '2026-10-02T09:00:00Z', nelDb: true }, { creato: '2026-10-17T10:40:00Z', nelDb: true }];
    const caso = [...base, { creato: '2026-10-17T11:14:18Z', nelDb: false }];
    const c1 = conta(w, caso), p1 = contaPrima(caso);
    t('105 il caso del 17-10: l\'ordine nato alle 11:14:18 e non ancora nel DB resta fuori dai due conti (prima: api = db + 1)',
      c1.api === c1.db && c1.api === 2 && p1.api === p1.db + 1, JSON.stringify({ c1, p1 }));
    const c2 = conta(w, [...base, { creato: '2026-10-17T11:00:00Z', nelDb: false }]);
    t('106 un ordine nato alle 11:00:00 esatte e\' fuori da tutti e due (non riaccende l\'error)', c2.api === c2.db, JSON.stringify(c2));
    const c3 = conta(w, [...base, { creato: '2026-10-17T10:59:59Z', nelDb: true }]);
    t('107 uno nato alle 10:59:59 ed entrato col sync conta su tutti e due', c3.api === 3 && c3.db === 3, JSON.stringify(c3));
    const c4 = conta(w, [...base, { creato: '2026-10-17T10:20:00Z', nelDb: false }]);
    t('108 un ammanco vero resta visibile: un ordine delle 10:20 che il DB non ha -> api = db + 1', c4.api === c4.db + 1, JSON.stringify(c4));
    const ws = W(GIRO, 2026, 9);
    t('109 il mese prima e\' intero, fino all\'ultimo secondo', ws.vuota === false && ws.min === '2026-09-01T00:00:00Z' && ws.max === '2026-09-30T23:59:59Z', JSON.stringify(ws));
    const cs = conta(ws, [{ creato: '2026-10-01T00:00:00Z', nelDb: false }, { creato: '2026-09-30T23:59:59Z', nelDb: true }]);
    t('110 un ordine nato alle 00:00:00 del primo del mese non conta piu\' anche nel mese prima', cs.api === 1 && cs.db === 1, JSON.stringify(cs));
    const nov = W('2026-11-01T00:30:00Z', 2026, 11), ott = W('2026-11-01T00:30:00Z', 2026, 10);
    t('111 giro delle 00:30 del primo del mese: mese nuovo vuoto (0 = 0), quello prima intero',
      nov.vuota === true && JSON.stringify(conta(nov, caso)) === '{"api":0,"db":0}' && ott.vuota === false && ott.max === '2026-10-31T23:59:59Z', JSON.stringify({ nov, ott }));
    const gen = W('2027-01-01T00:30:00Z', 2027, 1), dic = W('2027-01-01T00:30:00Z', 2026, 12);
    t('112 dicembre -> gennaio: dicembre fino al 31 alle 23:59:59, gennaio vuoto', gen.vuota && dic.min === '2026-12-01T00:00:00Z' && dic.max === '2026-12-31T23:59:59Z', JSON.stringify({ gen, dic }));
    t('113 bordo dell\'ora: alle 00:59:59.999 il cutoff e\' 00:00, alle 01:00:00 e\' 01:00',
      W('2026-10-18T00:59:59.999Z', 2026, 10).cutoff === '2026-10-18T00:00:00Z' && W('2026-10-18T01:00:00Z', 2026, 10).cutoff === '2026-10-18T01:00:00Z');
  } else t('104-113 comportamento della finestra non provato: blocco assente o non caricabile', false);
  const RUN8 = GUARD.slice(GUARD.indexOf('// 8) riconciliazione ESTERNA Shopify'), GUARD.indexOf("add('ce_shopify_token'"));
  t('114 la finestra si calcola per ogni mese del ciclo', /for \(const \[y, m\] of months\) \{\s*const w = finestraReconcile\(now, y, m\);/.test(RUN8));
  t('115 finestra vuota: 0 = 0 contato e nessuna chiamata (il continue sta prima della fetch)',
    /if \(w\.vuota\) \{ shopifyChecked\+\+; continue; \}/.test(RUN8) && RUN8.indexOf('if (w.vuota)') >= 0 && RUN8.indexOf('if (w.vuota)') < RUN8.indexOf('await fetch('));
  t('116 l\'API Shopify riceve gli estremi della finestra', /created_at_min=\$\{w\.min\}&created_at_max=\$\{w\.max\}/.test(RUN8) && !/created_at_max=\$\{to\}/.test(RUN8));
  t('117 il conteggio DB e\' year/month piu\' created_at_shop < cutoff, sempre da read()',
    /read\(`shopify_orders \$\{y\}-\$\{m\}`, await sb\.from\('shopify_orders'\)\.select\('\*', \{ count: 'exact', head: true \}\)\.eq\('year', y\)\.eq\('month', m\)\.lt\('created_at_shop', w\.cutoff\)\)/.test(RUN8));
  t('118 l\'etichetta dice fino a che ora si e\' contato', /il corrente fino alle \$\{oraPiena\} UTC\)` \+ \(shopDetails/.test(GUARD));
}

// Gift card fuori dal CE (26-10, migr 0172 + shopify-sync v9, CASI_APERTI n.18). Le due gift card vendute (#1663, #1877)
// restavano senza codice: orfane per sempre e contate come ricavo all'acquisto E al riscatto (#1682, #1937), cioe' 150,00
// EUR lordi due volte. Qui: la riga gift card va su GIFT_CARD con COGS 0 (il blocco PURE ritagliato dal sorgente) e la
// migrazione toglie GIFT_CARD dalle quattro viste CE senza ribatterle a mano.
console.log('\n== gift card: shopify-sync v9 e migr 0172 ==');
{
  const B = '// ==== PURE:sync-resolver BEGIN ====', E = '// ==== PURE:sync-resolver END ====';
  const a = SYNC.indexOf(B), b = SYNC.indexOf(E);
  let rigaCodiceCogs = null;
  if (a >= 0 && b > a) {
    const dir = mkdtempSync(join(tmpdir(), 'amimi-giftcard-'));
    const f = join(dir, 'resolver.mjs');
    writeFileSync(f, stripTypeScriptTypes(SYNC.slice(a + B.length, b)) + '\nexport { rigaCodiceCogs };\n', 'utf8');
    try { ({ rigaCodiceCogs } = await import(pathToFileURL(f).href)); } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* niente */ } }
  }
  t('119 rigaCodiceCogs c\'e\' nel blocco PURE:sync-resolver', typeof rigaCodiceCogs === 'function');
  if (rigaCodiceCogs) {
    const chiamate = [];
    const resolve = (nm, sku) => { chiamate.push([nm, sku]); return ({ 'LEA BAG BLACK': 'LEA_BAG_BLACK', 'GIFT CARD Amimì - 50,00 €': 'GIFT_CARD' })[nm] ?? null; };
    const cogs = new Map([['LEA_BAG_BLACK', 45]]);
    const r1 = rigaCodiceCogs({ name: 'GIFT CARD Amimì - 50,00 €', sku: null, gift_card: true }, resolve, cogs);
    t('120 riga con gift_card true -> GIFT_CARD, COGS 0 (non NULL: ce_cogs_mancanti resta muto)', r1.codice === 'GIFT_CARD' && r1.cogs === 0, r1);
    t('121 il flag gift_card vince sul titolo: il resolver non viene nemmeno chiamato', chiamate.length === 0, chiamate);
    const r2 = rigaCodiceCogs({ name: 'GIFT CARD Amimì - 50,00 €', sku: null }, resolve, cogs);
    t('122 senza flag, il titolo risolto su GIFT_CARD (alias della 0172) prende COGS 0 lo stesso', r2.codice === 'GIFT_CARD' && r2.cogs === 0, r2);
    const r3 = rigaCodiceCogs({ name: 'LEA BAG BLACK', sku: 'X', gift_card: false }, resolve, cogs);
    t('123 riga normale: codice dal resolver (titolo, SKU passati) e COGS di anagrafica', r3.codice === 'LEA_BAG_BLACK' && r3.cogs === 45 && chiamate.at(-1)?.[1] === 'X', r3);
    const r4 = rigaCodiceCogs({ title: 'BORSA MISTERIOSA' }, resolve, cogs);
    t('124 riga non risolta: codice NULL e COGS NULL (resta orfana e visibile, mai uno 0 inventato)', r4.codice === null && r4.cogs === null, r4);
    const r5 = rigaCodiceCogs({ name: 'LEA BAG BLACK', gift_card: 'true' }, resolve, cogs);
    t('125 solo il booleano true conta come gift card (una stringa no)', r5.codice === 'LEA_BAG_BLACK', r5);
  } else t('120-125 comportamento non provato: blocco assente o non caricabile', false);
  t('126 il giro scrive codice e cogs_snapshot dalla funzione pura', /const \{ codice, cogs \} = rigaCodiceCogs\(it, resolveCodice, cogsByNorm\);/.test(SYNC) && /cogs_snapshot: cogs,/.test(SYNC));
  t('127 il calcolo vecchio di cogs_snapshot nel giro non c\'e\' piu\' (una sola strada, dalla funzione pura)', !/cogs_snapshot: cn \?/.test(SYNC) && !/const codice = resolveCodice\(nm, it\.sku\)/.test(SYNC));

  const p = 'supabase/migrations/0172_gift_card_fuori_ce.sql';
  const M = existsSync(ROOT + p) ? read(p) : '';
  t('128 la migrazione 0172 esiste', M.length > 0);
  t('129 le quattro viste CE si riscrivono da pg_get_viewdef, non a mano',
    ['v_ce_amimi', 'v_ce_totale', 'v_ce_drill_sales', 'v_ce_drill_cogs'].every((v) => M.includes(`pg_get_viewdef('public.${v}'::regclass, true)`)));
  t('130 ogni vista ha la guardia "esattamente un\'occorrenza" prima della sostituzione', (M.match(/if v_n <> 1 then raise exception '0172: v_ce_/g) || []).length === 4);
  t('131 il filtro esclude solo GIFT_CARD (ORDINE_TEST resta nel CE: vendita e rimborso, netto 0)',
    (M.match(/IS DISTINCT FROM ''GIFT_CARD''::text/g) || []).length === 2 && !/IS DISTINCT FROM ''ORDINE_TEST''/.test(M));
  t('132 righe ripuntate con COGS 0 e resolved true, before/after in change_log',
    /set codice = r\.codice, resolved = true, cogs_snapshot = 0/.test(M) && /'gift_card_fuori_ce'/.test(M));
  t('133 guardia: nessuna riga gift card fuori dalle due attese (mesi chiusi)', /righe gift card non previste/.test(M));
  t('134 controllo: nel CE si muove solo cio\' che dipende dalle vendite gift card', /cambiate oltre le sole vendite gift card/.test(M));
  t('135 controllo: nessun drift nuovo sui mesi chiusi e shopify_orphan = 0', /mesi chiusi in drift prima % dopo %/.test(M) && /shopify_orphan = % dopo il ripuntamento/.test(M));
  t('136 controllo: righe risolte senza COGS invariate (ce_cogs_mancanti)', /righe risolte senza COGS prima % dopo %/.test(M));
  t('137 la i accentata dell\'alias e\' in escape U& (file ASCII)', /U&'GIFT CARD Amim\\00EC'/.test(M) && !/[^\x00-\x7F]/.test(M));
  // Gate 2 del 26-10: lo stack isolato si costruisce da schema.sql, non dalle migrazioni (TEST_INVARIANTS sez. 2)
  const S = read('supabase/schema.sql');
  t('138 schema.sql porta lo stesso filtro nelle quattro viste CE (3 sulle righe intere + 1 sul ramo li)',
    (S.match(/FROM "public"\."shopify_line_items" WHERE \("shopify_line_items"\."codice_norm" IS DISTINCT FROM 'GIFT_CARD'::"text"\)/g) || []).length === 3
    && /WHERE \("li"\."codice_norm" IS DISTINCT FROM 'GIFT_CARD'::"text"\)\nUNION ALL/.test(S));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
