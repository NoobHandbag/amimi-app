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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
