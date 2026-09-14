// tests/letture_controllate_guardie.mjs — guardie sul SORGENTE delle 11 edge function corrette il 2026-09-13
//   node tests/letture_controllate_guardie.mjs
//
// Brief `letture_non_controllate_edge_functions` (sweep dell'incidente doppioni Shopify, Regola Ferrea 20): in ogni
// funzione le letture supabase-js da cui dipende una scrittura o una guardia destrutturano `error`, ritentano UNA
// volta (retryOnce) e falliscono CHIUSE. La classe non e' collaudabile a runtime (compare solo quando PostgREST
// risponde male), quindi questo file legge i sorgenti e verifica che i frammenti di ogni fix ci siano ancora e che
// nessun retry avvolga una scrittura di dati. I frammenti sono quelli restituiti dagli agenti che hanno fatto i fix,
// rivisti da un revisore indipendente per funzione (piu' i ritocchi post-review); se uno sparisce "per semplificare", il test lo dice.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 160) : '')); } };

// frammenti attesi per funzione (verbatim, confronto letterale)
const MARKERS = {
  "cs-api": [
    "const { data: flag, error: flagErr } = await retryOnce(() => sb.from('app_flags').select('value').eq('key', 'cs_noise_senders').maybeSingle());",
    "if (flagErr) return json({ error: 'denylist non leggibile, riprova: ' + flagErr.message }, 503);",
    "const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {",
    "// 2026-09-13 (sweep incidente doppioni): stessa cintura di add_noise"
  ],
  "loyalty-proxy": [
    "const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {",
    "const { data, error } = await retryOnce(() => sb.from('loyalty_points').select('points').eq('shopify_customer_id', customerId).maybeSingle());",
    "const readPoints = async (): Promise<number | null> => {",
    "const { data, error } = await retryOnce(() => sb.from('mimi_state')",
    "const readMimi = async (): Promise<MimiState | null> => {",
    "if (points === null) throw new Error('read_failed');",
    "if (e instanceof Error && e.message === 'read_failed') return json({ error: 'read_failed' }, 503);",
    "if (mimi === null) return json({ error: 'read_failed' }, 503);",
    "if (points === null || mimi === null) return json({ error: 'read_failed' }, 503);",
    "const { data: lastEv, error: lastErr } = await retryOnce(() => sb.from('loyalty_events')",
    "if (lastErr) return json({ error: 'read_failed' }, 503);",
    "const { data: todayEv, error: todayErr } = await retryOnce(() => sb.from('loyalty_events')",
    "if (todayErr) return json({ error: 'read_failed' }, 503);",
    "const { error: evErr } = await sb.from('loyalty_events').insert({ shopify_customer_id: customerId, delta, source, meta: { fisso: true } });",
    "const { error: evErr } = await sb.from('loyalty_events').insert({ shopify_customer_id: customerId, delta: added, source: 'game_click', meta: { score: requested } });",
    "if (evErr) await noteEventFailed(",
    "tbl: 'loyalty_events', row_id: customerId, op: 'event_insert_failed',",
    "warning: 'event_insert_failed'"
  ],
  "write-api": [
    "class GuardReadError extends Error {}",
    "if (e instanceof GuardReadError) return json({ error: e.message, guard_unavailable: true }, 503);",
    "async function handle(req: Request): Promise<Response> {",
    "const { data, error } = await retryOnce(() => sb.from('ce_snapshots').select('id').eq('year', yy).eq('month', mm).limit(1));",
    "if (error) throw new GuardReadError(`guardia mesi chiusi non valutabile",
    "const { data, error } = await retryOnce(() => sb.from('change_log')",
    "if (error) throw new GuardReadError(`guardia anti-doppione non valutabile",
    "const { data: pr, error: pre } = await retryOnce(() => sb.from('products').select('cogs').eq('codice_norm', cnorm(ord.codice)).maybeSingle());",
    "if (pre) return json({ error: `lettura costo prodotto fallita (${pre.message}): arrivo NON registrato, riprova` }, 502);",
    "const { count: otherOrders, error: oce } = await retryOnce(() => sb.from('supplier_orders')",
    "const { data: inv, error: ive } = await retryOnce(() => sb.from('v_inventory')",
    "stub_reap_error",
    "const { data: invRow, error: ive } = await retryOnce(() => sb.from('v_inventory')",
    "const { count: ordCount, error: oce } = await retryOnce(() => sb.from('supplier_orders')",
    "const { count: shopCount, error: sce } = await retryOnce(() => sb.from('shopify_stock')",
    "const { count, error: hce } = await retryOnce(() => sb.from(t).select('*', { count: 'exact', head: true }).eq('codice', codice));",
    "const { data: snaps, error: sne } = await retryOnce(() => sb.from('ce_snapshots').select('year, month'));",
    "const { data: shopRows, error: she } = await retryOnce(() => sb.from('shopify_stock').select('codice'));",
    "const onShop = !!she ||",
    "const cascata_fallita: Record<string, string> = {};",
    "if (ce) cascata_fallita[t] = ce.message;",
    "const { data: exRow, error: exe } = await retryOnce(() => sb.from('expenses').select('year, month, status, categoria').eq('id', id).maybeSingle());",
    "if (exe) return json({ error: `spesa non leggibile (${exe.message}): approvazione rifiutata, riprova` }, 503);",
    "const { data: exist, error: exe } = await retryOnce(() => sb.from('expenses').select('id, year, month, date_paid, costo, operazione'));",
    "const { data: np, error: npe } = await retryOnce(() => sb.from('products').select('cogs, item, variant').eq('codice_norm', nc).maybeSingle());",
    "const { data: adjs, error: ae } = await sb.from('stock_adjustments').delete().eq('return_id', rid).select('id');",
    "if (ae) return json({ error: `aggiustamenti del sostituto NON revertiti",
    "const { data: pr, error: pre } = await retryOnce(() => sb.from('products').select('cogs').eq('codice_norm', cn).maybeSingle());",
    "const { data: npc, error: npe } = await retryOnce(() => sb.from('non_product_codici').select('codice'));",
    "if (!exRow) return json({ error: 'spesa non trovata' }, 404);"
  ],
  "qromo-webhook": [
    "const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {",
    "const { data: sf, error: sfErr } = await retryOnce(() => sb.from('app_flags').select('key, value').in('key', ['qromo_webhook_secret', 'qromo_webhook_token']));",
    "if (sfErr || (!secret && !qToken)) return json({ ok: false, error: 'auth unavailable' }, 503);",
    "const { data: prods, error: prodsErr } = await retryOnce(() => sb.from('products').select('codice, codice_norm, item, variant, cogs'));",
    "if (prodsErr) return json({ ok: false, error: 'products read failed: ' + prodsErr.message }, 500);",
    "const { data: al, error: alErr } = await retryOnce(() => sb.from('product_aliases').select('shopify_name_norm, codice'));",
    "if (alErr) return json({ ok: false, error: 'product_aliases read failed: ' + alErr.message }, 500);"
  ],
  "sales-guard": [
    "const { data: ruleRows, error: rulesErr } = await retryOnce(() => sb.from('alert_rules')",
    "if (rulesErr) return json({ ok: false, error: 'lettura alert_rules fallita, guardia non valutata: ' + rulesErr.message }, 503);",
    "const { count, error: cntErr } = await retryOnce(() => sb.from('shopify_orders').select('order_id', { count: 'exact', head: true })",
    "if (cntErr) return json({ ok: false, error: 'conteggio shopify_orders fallito, guardia non valutata: ' + cntErr.message }, 503);",
    "const { data: anom, error: anomErr } = await retryOnce(() => sb.from('v_sales_anomalie')",
    "if (anomErr) return json({ ok: false, error: 'lettura v_sales_anomalie fallita, guardia non valutata: ' + anomErr.message }, 503);",
    "const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {",
    "if (frowsErr) return json({ ok: false, error: 'lettura app_flags fallita, guardia non valutata: ' + frowsErr.message }, 503);"
  ],
  "shopify-stock": [
    "const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> =>",
    "const { error: upErr } = await sb.from('shopify_stock').upsert(rows, { onConflict: 'codice' });",
    "if (upErr) return { error: 'shopify_stock upsert fallito: ' + upErr.message, status: 502 };",
    "const { data: flag, error: gateErr } = await retryOnce(() => sb.from('app_flags').select('value').eq('key', 'shopify_autopush_enabled').maybeSingle());",
    "const msg = 'autopush FERMATO: shopify_autopush_enabled non letto: ' + gateErr.message;",
    "const { data: locFlag, error: locErr } = await retryOnce(() => sb.from('app_flags').select('value').eq('key', 'shopify_location_id').maybeSingle());",
    "const { data: bufFlag, error: bufErr } = await retryOnce(() => sb.from('app_flags').select('value').eq('key', 'shopify_expose_buffer').maybeSingle());",
    "const { data: holdFlag, error: holdErr } = await retryOnce(() => sb.from('app_flags').select('value').eq('key', 'shopify_hold_raises').maybeSingle());",
    "const { data: autoEnFlag, error: autoEnErr } = await retryOnce(() => sb.from('app_flags').select('value').eq('key', 'shopify_autoenable_tracking').maybeSingle());",
    "const flagErr = locErr ?? bufErr ?? holdErr ?? autoEnErr;",
    "const msg = 'autopush FERMATO: flag app_flags non letti: ' + flagErr.message;",
    "if (action === 'realign_all') { const r = await doRealignAll(body.dryRun === true, 'cron') as { status?: number }; return json(r, r.status ?? 200); }"
  ],
  "shipping-status-sync": [
    "const { data: existing, error: exErr } = await retryOnce(() => sb.from('shipping_status').select('ldv,stato_tws,seen_delivered_at').in('ldv', ldvs));",
    "if (exErr) return json({ error: 'lettura shipping_status fallita: ' + exErr.message.slice(0, 120) }, 500);",
    "const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {"
  ],
  "cs-send": [
    "const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {",
    "const { data: inMsgs, error: inErr } = await retryOnce(() => sb.from('cs_messages')",
    "if (inErr) return json({ error: 'verifica cross-cliente non eseguibile, riprova (' + inErr.message.slice(0, 120) + ')' }, 503);",
    "const { data: lastOuts, error: outErr } = await retryOnce(() => sb.from('cs_messages')",
    "if (outErr) return json({ error: 'verifica anti doppio invio non eseguibile, riprova (' + outErr.message.slice(0, 120) + ')' }, 503);"
  ],
  "cs-assist": [
    "const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> =>",
    "const { data: msgs, error: msgsErr } = await retryOnce(() => sb.from('cs_messages').select('direction,body_text,body_clean,form_fields,from_email,reply_to,sent_at')",
    "if (msgsErr) return json({ error: 'thread non leggibile, riprova: ' + msgsErr.message }, 503);",
    "if (lc instanceof Response) return lc;",
    "const { data: msgs, error: msgsErr } = await retryOnce(() => sb.from('cs_messages').select('direction,body_text,body_clean').eq('conversation_id', c.id as string)",
    "if (msgsErr) { failed++; continue; }"
  ],
  "cs-sync": [
    "const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {",
    "const { data: msgs, error: msgsErr } = await retryOnce(() => sb.from('cs_messages').select('direction,from_email,sent_at').eq('conversation_id', convId));",
    "if (msgsErr) return false;",
    "const { data, error: convErr } = await retryOnce(() => sb.from('cs_conversations').select('id, canale, last_msg_at, customer_email').eq('gmail_thread_id', threadId).maybeSingle());",
    "if (convErr) { lastErr = 'db_conv_out: ' + String(convErr.message ?? '').slice(0, 250); return 'transient'; }",
    "const { data: ord, error: ordErr } = await retryOnce(() => sb.from('shopify_orders').select('order_number, email').eq('order_number', String(n)).limit(1).maybeSingle());",
    "if (ordErr) { letturaOrdineFallita++;",
    "let qc = sb.from('cs_conversations').select('id, canale, snippet').order('id', { ascending: true }).limit(limit);",
    "if (convErr) return json({ ok: false, error: 'cs_conversations non leggibile: ' + convErr.message }, 502);",
    "const { data: convRows, error: convErr } = await retryOnce(() => sb.from('cs_conversations').select('id, canale, customer_name').in('id', convIds.slice(i, i + 100)));",
    "const { data: ex0, error: e0 } = await retryOnce(() => sb.from('cs_conversations').select('id,canale,categoria,last_msg_at,customer_email').eq('gmail_thread_id', threadId).maybeSingle());",
    "if (e0) throw new Error('conv_lookup_failed: ' + String(e0.message ?? '').slice(0, 250));"
  ],
  "cs-classify": [
    "const { data: msgs, error: me } = await retryOnce(() => sb.from('cs_messages')",
    "if (me) { failed++; continue; }",
    "const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {",
    "2026-09-13 (sweep incidente doppioni): lettura fallita = thread vuoto"
  ]
};

// Audit gate 14-09: le catene supabase-js spesso vanno a capo prima del `.select(`/`.upsert(`: senza questa
// normalizzazione una scrittura ritentata scritta su due righe passava a vuoto (finding B57).
const flat = (src) => src.replace(/\)\s*\n\s*\./g, ').');
const TELEMETRIA = /'(health_log|cs_events|change_log)'/;
const RETRY_SU_SCRITTURA = /retryOnce\(\(\) => sb\.from\('[^']+'\)\.(insert|update|upsert|delete)\(/;
for (const [fn, snippets] of Object.entries(MARKERS)) {
  const SRC = read(`supabase/functions/${fn}/index.ts`);
  console.log(`\n== ${fn} ==`);
  t(`${fn}: helper retryOnce presente`, /const retryOnce = async/.test(SRC));
  for (const s of snippets) t(`${fn}: ${s.slice(0, 90)}`, SRC.includes(s), 'frammento assente');
  const retryScritture = flat(SRC).split('\n').filter((l) => RETRY_SU_SCRITTURA.test(l) && !TELEMETRIA.test(l));
  t(`${fn}: nessun retry su scritture di dati`, retryScritture.length === 0, retryScritture[0]);
}

console.log('\n== autocontrollo del rilevatore ==');
{
  const evil1 = "const { error } = await retryOnce(() => sb.from('loyalty_points').upsert({ a: 1 }));";
  const evil2 = "const { error } = await retryOnce(() => sb.from('loyalty_points')\n      .upsert({ a: 1 }));";
  const buona = "const { data } = await retryOnce(() => sb.from('cs_messages')\n      .select('id'));";
  const tele = "await retryOnce(() => sb.from('health_log')\n  .upsert({ k: 'x' }, { onConflict: 'day,k' }));";
  const hit = (s) => flat(s).split('\n').some((l) => RETRY_SU_SCRITTURA.test(l) && !TELEMETRIA.test(l));
  t('rilevatore: retry su scrittura in una riga', hit(evil1));
  t('rilevatore: retry su scrittura su DUE righe', hit(evil2));
  t('rilevatore: retry su lettura su due righe non segnalato', !hit(buona));
  t('rilevatore: telemetria ritentata non segnalata', !hit(tele));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
