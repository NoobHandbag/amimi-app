// shopify-sync — READ-ONLY pull of new Shopify orders into the replica.
// Token lives in app_config (service-role only). PIN-gated. Only inserts orders NEWER than the
// snapshot (never touches validated historical data); idempotent on order_id.
// New live orders use an ESTIMATED payment fee (~2.2%+€0.25) and free_shipping=0 — flagged;
// historical months stay cent-exact from the seed.
//
// 2026-09-13 v7 (incidente doppioni 12-09 -> 13-09, brief Cowork "dedup_shopify_orders_fix_sync", migr 0117).
// Cosa era successo: la v6 leggeva TUTTA shopify_orders per sapere quali ordini esistevano e da quale data
// ripartire, con `const { data: ex } = await ...` e l'errore ignorato. Il 12-09 02:07, 12-09 14:07 e 13-09
// 02:07 UTC PostgREST ha risposto 504 (thread uccisi dal timeout manager in quei minuti), `ex` era null,
// `existing` vuoto, `maxDate` tornava al 1 febbraio e i 250 ordini letti da Shopify entravano tutti come
// nuovi: 756 righe ordine e 884 righe d'ordine doppie in tre giri. In piu' dal 12-09 14:07 la tabella superava
// le 1.000 righe e la stessa select senza range tornava TRONCATA al cap PostgREST, per cui l'ordine piu'
// recente restava fuori da `existing` e veniva reinserito a ogni giro (#1752 x7). L'autopush ha poi spinto
// su Shopify quantita' calcolate su vendite contate 2-4 volte. Cinque regole, tutte qui dentro:
//  1. ogni lettura da cui dipende COSA si scrive e' controllata: se fallisce il giro si FERMA (500 +
//     health_log `shopify_sync` error), mai un default vuoto al suo posto;
//  2. niente letture di intere tabelle: ultimo ordine noto = 1 riga con limit; esistenza SOLO per i nomi
//     appena letti da Shopify (<= 250, con .in); anagrafica letta per intero ma con guardia sul cap 1.000;
//  3. insert dell'ordine come upsert `ignoreDuplicates` sul vincolo UNIQUE(order_id) della migr 0117:
//     anche se l'esistenza fosse letta male, un secondo insert NON entra e le righe non si scrivono;
//  4. cintura: in un giro di cron si inseriscono al massimo MAX_INSERTS_CRON ordini (un'ora normale ne porta
//     0-5); oltre, nessun insert e health_log error. Un backfill vero si lancia a mano (action 'backfill');
//  5. righe d'ordine: se l'insert fallisce, l'ordine appena scritto viene tolto e ritentato al giro dopo
//     (prima restava per sempre senza righe: caso #1734 del 09-09, vendita mai scalata dallo stock).
// Inoltre: `order=created_at+asc` rimosso (orders.json non lo onora: i tre batch erano i 250 piu' recenti),
// pagina piena (250) = giro fermato perche' potrebbe essere incompleta; il resync dei 45 giorni aggiorna solo
// cio' che cambia (prima 250 update a vuoto ogni ora) e porta anche `fulfilled_at` (era il solo campo che
// differiva fra le copie: NULL all'ingest, evaso dopo); nuova colonna `shopify_line_id` sulle righe (unica
// dove presente) + azione `backfill_line_ids` per lo storico; telemetria giornaliera in health_log chiave
// `shopify_sync` (come `stock_autopush` in shopify-stock). Guardie sul sorgente: tests/shopify_sync_guardie.mjs.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const norm = (s: string | null | undefined) => (s ? s.toUpperCase().replace(/\s+/g, '_') : '');
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const SHOP = 'amimi-10000';
const API = `https://${SHOP}.myshopify.com/admin/api/2024-01`;
// Tetto di ordini NUOVI inseribili in un giro di cron. 250 secchi sono la firma dell'incidente del 12-09
// ("nessun ordine esistente" -> tutto nuovo); un'ora vera di questo negozio ne porta 0-5.
const MAX_INSERTS_CRON = 50;
// Cap di PostgREST sulle select senza range: una risposta con esattamente questo numero di righe e' TRONCATA.
const POSTGREST_CAP = 1000;
const refundOf = (o: Record<string, any>) => (o.refunds ?? []).reduce((s: number, rf: any) => s + (rf.transactions ?? []).reduce((t: number, tx: any) => t + Number(tx.amount || 0), 0), 0);
// PostgREST risponde 504 anche su letture banali: 4% delle chiamate REST delle edge (439 su 10.462 nelle 24 ore
// al 13-09), il 90% nei secondi :00-:03 di ogni minuto, cioe' proprio quando partono i cron (postgrest_logs
// "Thread killed by timeout manager" a :00/:01 e :46/:47 di ogni minuto, DB scarico: caso aperto per l'owner).
// Una lettura o una riga di telemetria sono idempotenti: UN solo ritentativo dopo 1,5 s prima di dichiarare il
// giro fermato. Mai piu' di uno e MAI sugli insert di ordini/righe: il fermo deve restare visibile, non mascherato.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn();
  if (!r.error) return r;
  await sleep(1500);
  return await fn();
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = () => new Date().toISOString().slice(0, 10);
  // una riga al giorno per chiave (unique day,k): stesso pattern di stock_autopush in shopify-stock
  // upsert su (day,k), NON delete+insert: sotto l'indice unico una delete fallita lasciava in piedi la riga vecchia
  // (magari un 'ok') proprio sul canale che ce-guard rispecchia al banner. `created_at` = ora dell'ultimo giro,
  // cosi' ce-guard vede anche un cron fermo (nessun giro da piu' di 2 ore).
  const health = async (label: string, n: number, severity: 'ok' | 'warn' | 'error') => {
    const { error } = await retryOnce(() => sb.from('health_log').upsert({ day: today(), k: 'shopify_sync', label: label.slice(0, 500), n, severity, created_at: new Date().toISOString() }, { onConflict: 'day,k' }));
    return !error;
  };
  // una lettura fallita FERMA il giro: niente insert su uno stato letto male. Un dryRun (anteprima) non scrive
  // telemetria: non e' un giro del cron e non deve accendere il banner.
  const fail = async (step: string, msg: string, status = 500) => {
    if (!body.dryRun) await health(`sync FERMATO (${step}): ${msg}`, 1, 'error');
    return json({ error: `${step}: ${msg}` }, status);
  };

  const { data: cfg, error: cfgErr } = await retryOnce(() => sb.from('app_config').select('pin_hash, shopify_token').eq('id', 1).single());
  if (cfgErr) return fail('app_config', cfgErr.message);
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);
  const token = cfg.shopify_token;
  if (!token) return fail('token', 'token Shopify mancante');
  const SH = { 'X-Shopify-Access-Token': token };

  // ---- one-off: backfill fulfilled_at + discount_codes + customer_name on EXISTING rows ----
  // (feedback 2026-07-06 item 9: il seed ETL non aveva i nomi cliente — 433/452 ordini senza nome)
  if (body.action === 'backfill_meta') {
    let sinceId = 0, updated = 0, scanned = 0;
    for (let page = 0; page < 20; page++) {
      const u = `${API}/orders.json?status=any&limit=250&since_id=${sinceId}&fields=id,name,fulfillments,discount_codes,customer`;
      const r = await fetch(u, { headers: SH });
      if (!r.ok) return json({ error: 'Shopify ' + r.status, updated, scanned }, 502);
      const batch = (await r.json()).orders ?? [];
      if (!batch.length) break;
      for (const o of batch) {
        sinceId = Math.max(sinceId, Number(o.id));
        scanned++;
        const fulfilled_at = o.fulfillments?.[0]?.created_at ?? null;
        const discount_codes = (o.discount_codes ?? []).map((c: { code?: string }) => c.code).filter(Boolean).join('+') || null;
        const customer_name = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || null;
        if (!fulfilled_at && !discount_codes && !customer_name) continue;
        const upd: Record<string, unknown> = { fulfilled_at, discount_codes };
        if (customer_name) upd.customer_name = customer_name; // mai sbiancare un nome esistente
        const { error: ue, count } = await sb.from('shopify_orders').update(upd, { count: 'exact' }).eq('order_id', o.name);
        if (!ue && count) updated += count;
      }
      if (batch.length < 250) break;
    }
    return json({ ok: true, backfill: true, scanned, updated });
  }

  // ---- v7, una tantum dopo la migr 0117: abbina alle righe storiche (shopify_line_id NULL) l'id della riga
  // Shopify. Ordini letti con since_id (ordinamento per id, deterministico) dal 2026-07-01. Match per (ordine,
  // nome riga, prezzo, quantita') SOLO quando e' univoco su entrambi i lati; il resto resta NULL e viene
  // riportato, mai indovinato. dry_run di default: si scrive solo con dry_run === false. ----
  if (body.action === 'backfill_line_ids') {
    const dry = body.dry_run !== false;
    const since = String(body.since || '2026-07-01T00:00:00Z');
    let sinceId = 0, pages = 0; const shop: Record<string, any[]> = {};
    while (pages++ < 10) {
      const u = `${API}/orders.json?status=any&limit=250&since_id=${sinceId}&created_at_min=${encodeURIComponent(since)}&fields=id,name,line_items`;
      const r = await fetch(u, { headers: SH });
      if (!r.ok) return json({ error: 'Shopify ' + r.status, detail: (await r.text()).slice(0, 200) }, 502);
      const batch = (await r.json()).orders ?? [];
      if (!batch.length) break;
      for (const o of batch) { sinceId = Math.max(sinceId, Number(o.id)); shop[String(o.name)] = o.line_items ?? []; }
      if (batch.length < 250) break;
    }
    const names = Object.keys(shop);
    const rows: Record<string, any>[] = [];
    for (let i = 0; i < names.length; i += 200) {
      const { data, error } = await retryOnce(() => sb.from('shopify_line_items').select('id, order_id, lineitem_name, price, quantita').is('shopify_line_id', null).in('order_id', names.slice(i, i + 200)));
      if (error) return json({ error: 'lettura righe: ' + error.message }, 500);
      rows.push(...(data ?? []));
    }
    const key = (n: unknown, p: unknown, q: unknown) => `${String(n ?? '')}|${Number(p).toFixed(2)}|${Number(q)}`;
    const group = <T>(items: T[], k: (x: T) => string) => { const m = new Map<string, T[]>(); for (const it of items) { const kk = k(it); (m.get(kk) ?? m.set(kk, []).get(kk)!).push(it); } return m; };
    let matched = 0, ambiguous = 0, unmatched = 0, written = 0; const ambigui: string[] = []; const errors: string[] = [];
    const updates: { id: string; shopify_line_id: number }[] = [];
    for (const [name, dbRows] of group(rows, (r) => String(r.order_id))) {
      const shopByKey = group(shop[name] ?? [], (it) => key(it.name ?? it.title, it.price, it.quantity));
      for (const [k, dbs] of group(dbRows, (r) => key(r.lineitem_name, r.price, r.quantita))) {
        const shops = shopByKey.get(k) ?? [];
        if (dbs.length === 1 && shops.length === 1) { updates.push({ id: String(dbs[0].id), shopify_line_id: Number(shops[0].id) }); matched++; }
        else if (!shops.length) unmatched += dbs.length;
        else { ambiguous += dbs.length; if (ambigui.length < 20) ambigui.push(`${name} ${k}`); }
      }
    }
    if (!dry) {
      for (const u of updates) {
        const { error } = await sb.from('shopify_line_items').update({ shopify_line_id: u.shopify_line_id }).eq('id', u.id);
        if (error) { if (errors.length < 5) errors.push(`${u.id}: ${error.message}`); } else written++;
      }
    }
    await sb.from('change_log').insert({ tbl: 'shopify_line_items', row_id: 'backfill_line_ids', op: 'backfill_line_ids', after: { dry_run: dry, orders: names.length, righe_senza_id: rows.length, matched, written, ambiguous, unmatched }, chi: body.chi || 'claude-code', source: 'shopify-sync' });
    return json({ ok: true, dry_run: dry, orders: names.length, righe_senza_id: rows.length, matched, written, ambiguous, unmatched, ambigui, errors: errors.length ? errors : undefined });
  }

  // ---- giro normale (cron :07) e backfill esplicito ----
  const isBackfill = body.action === 'backfill';
  // ultimo ordine noto: UNA riga con limit, non tutta la tabella (cap PostgREST 1.000: dal 12-09 14:07 la lettura
  // intera tornava troncata e l'ordine piu' recente restava fuori da `existing`)
  const { data: lastRow, error: lastErr } = await retryOnce(() => sb.from('shopify_orders').select('created_at_shop').not('created_at_shop', 'is', null).order('created_at_shop', { ascending: false }).limit(1));
  if (lastErr) return fail('ultimo ordine', lastErr.message);
  const maxDate = String(lastRow?.[0]?.created_at_shop ?? '2026-02-01T00:00:00Z');
  const sinceDate = body.dryRun ? new Date(Date.now() - 60 * 86400000).toISOString() : (isBackfill && body.since ? String(body.since) : maxDate);

  // anagrafica per il resolver: letta per intero (196 prodotti / 407 alias al 13-09), ma con guardia sul cap:
  // a 1.000 righe la risposta e' troncata in silenzio e le righe uscirebbero "non risolte" e senza COGS
  const { data: al, error: alErr } = await retryOnce(() => sb.from('product_aliases').select('shopify_name_norm, codice'));
  if (alErr) return fail('product_aliases', alErr.message);
  const { data: pr, error: prErr } = await retryOnce(() => sb.from('products').select('codice, codice_norm, cogs'));
  if (prErr) return fail('products', prErr.message);
  if (!pr?.length) return fail('products', 'anagrafica vuota: nessun prodotto letto');
  if ((al ?? []).length >= POSTGREST_CAP || (pr ?? []).length >= POSTGREST_CAP) return fail('cap PostgREST', `anagrafica a ${POSTGREST_CAP}+ righe: la lettura e' troncata, serve la paginazione`);
  // mesi chiusi (Regola Ferrea 11): il resync non scrive fulfilled_at su ordini di un mese in ce_snapshots.
  // Rimborso e stato invece si aggiornano anche li' (comportamento v6, voluto: il drift accende ce_drift e l'owner ri-chiude).
  const { data: closedRows, error: clErr } = await retryOnce(() => sb.from('ce_snapshots').select('year, month'));
  if (clErr) return fail('ce_snapshots', clErr.message);
  const closedMax = Math.max(0, ...(closedRows ?? []).map((r) => Number(r.year) * 100 + Number(r.month)));
  const aliasMap = new Map((al ?? []).map((r) => [r.shopify_name_norm, r.codice]));
  const cogsByNorm = new Map((pr ?? []).map((r) => [r.codice_norm, r.cogs]));
  const codiceByNorm = new Map((pr ?? []).map((r) => [r.codice_norm, r.codice]));

  // Resolver con FALLBACK (audit A5/C25): prima l'alias, poi il nome Shopify == CODICE, poi il nome
  // senza il descrittore " - Senza Catena", infine lo SKU. Prima esisteva SOLO il lookup alias esatto,
  // quindi un titolo rinominato o con suffisso lasciava codice=null -> ricavo con COGS 0 e stock non scalato.
  const resolveCodice = (nm: string, sku?: string): string | null => {
    const n1 = norm(nm);
    if (aliasMap.has(n1)) return aliasMap.get(n1)!;
    if (codiceByNorm.has(n1)) return codiceByNorm.get(n1)!;
    const base = String(nm).split(/\s[-–]\s/)[0];
    const n2 = norm(base);
    if (n2 && n2 !== n1) {
      if (aliasMap.has(n2)) return aliasMap.get(n2)!;
      if (codiceByNorm.has(n2)) return codiceByNorm.get(n2)!;
    }
    const ns = norm(sku ?? '');
    if (ns && codiceByNorm.has(ns)) return codiceByNorm.get(ns)!;
    return null;
  };

  // niente `order=`: orders.json non lo onora e restituisce i piu' RECENTI. Nel giro di cron, con created_at_min =
  // ultimo ordine noto, arrivano TUTTI i nuovi finche' sono meno di 250; a 250 la pagina puo' essere incompleta e
  // il giro si ferma (vedi sotto). Nel backfill invece si pagina con since_id (ordinamento per id, dal piu'
  // vecchio): con una sola pagina "recenti" gli ordini fra `since` e il 250esimo piu' recente non verrebbero
  // mai piu' richiesti, perche' il giro dopo riparte dall'ultimo ordine noto.
  const orders: Record<string, any>[] = [];
  if (isBackfill && !body.dryRun) {
    let sinceId = 0;
    for (let page = 0; page < 8; page++) {
      const r = await fetch(`${API}/orders.json?status=any&created_at_min=${encodeURIComponent(sinceDate)}&since_id=${sinceId}&limit=250`, { headers: SH });
      if (!r.ok) return fail('Shopify', r.status + ' ' + (await r.text()).slice(0, 200), 502);
      const batch: Record<string, any>[] = (await r.json()).orders ?? [];
      if (!batch.length) break;
      orders.push(...batch);
      for (const o of batch) sinceId = Math.max(sinceId, Number(o.id));
      if (batch.length < 250) break;
      if (page === 7) return fail('backfill', `oltre 2000 ordini da ${sinceDate}: restringere con since`, 409);
    }
  } else {
    const url = `${API}/orders.json?status=any&created_at_min=${encodeURIComponent(sinceDate)}&limit=${body.dryRun ? 5 : 250}`;
    const resp = await fetch(url, { headers: SH });
    if (!resp.ok) return fail('Shopify', resp.status + ' ' + (await resp.text()).slice(0, 200), 502);
    orders.push(...(((await resp.json()).orders ?? []) as Record<string, any>[]));
  }

  const parse = (o: Record<string, any>) => {
    const d = new Date(o.created_at);
    const gross = Number(o.total_price);
    const shipping = Number(o.total_shipping_price_set?.shop_money?.amount ?? 0);
    const order = {
      order_id: o.name, order_number: String(o.order_number), created_at_shop: o.created_at,
      customer_name: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || null,
      email: o.email, financial_status: o.financial_status, fulfillment_status: o.fulfillment_status,
      gross_total: gross, discount_total: Number(o.total_discounts || 0), shipping_total: shipping,
      payment_fees: -Math.round((gross * 0.022 + 0.25) * 100) / 100, refund_amount: refundOf(o),
      free_shipping: false, free_shipping_amt: 0, currency: o.currency,
      year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, vendor: null,
      fulfilled_at: o.fulfillments?.[0]?.created_at ?? null,
      discount_codes: (o.discount_codes ?? []).map((c: any) => c.code).filter(Boolean).join('+') || null,
    };
    const lines = (o.line_items ?? []).map((it: any) => {
      const nm = it.name ?? it.title;
      const codice = resolveCodice(nm, it.sku);
      const cn = codice ? norm(codice) : null;
      return { order_id: o.name, lineitem_name: nm, codice, resolved: !!codice, quantita: Number(it.quantity), price: Number(it.price), cogs_snapshot: cn ? (cogsByNorm.get(cn) ?? null) : null, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, shopify_line_id: Number(it.id) || null };
    });
    return { order, lines };
  };

  if (body.dryRun) {
    const preview = orders.slice(0, 3).map(parse);
    return json({ ok: true, dryRun: true, fetched: orders.length, since: sinceDate, preview });
  }
  if (orders.length >= 250 && !isBackfill) return fail('pagina piena', `Shopify ha restituito 250 ordini da ${sinceDate}: la pagina puo' essere incompleta, nessun insert. Backfill a mano con action 'backfill' (since opzionale)`, 409);

  // esistenza SOLO per i nomi appena letti (<= 250: nessun cap)
  const names = orders.map((o) => String(o.name));
  const existing = new Set<string>();
  if (names.length) {
    const { data: ex, error: exErr } = await retryOnce(() => sb.from('shopify_orders').select('order_id').in('order_id', names));
    if (exErr) return fail('ordini esistenti', exErr.message);
    for (const r of ex ?? []) existing.add(String(r.order_id));
  }
  const nuovi = orders.filter((o) => !existing.has(String(o.name)));
  const cap = isBackfill ? 250 : MAX_INSERTS_CRON;
  if (nuovi.length > cap) return fail('cintura', `${nuovi.length} ordini da inserire in un giro (tetto ${cap}): nessun insert. Se e' un backfill vero: action 'backfill'`, 409);

  let inserted = 0, lineCount = 0, skipped = 0; const errors: string[] = []; const insertedNames: string[] = [];
  for (const o of nuovi) {
    const { order, lines } = parse(o);
    // upsert ignoreDuplicates sul vincolo UNIQUE(order_id): se l'ordine c'e' gia' (corsa fra due run, esistenza
    // letta male) `ins` torna vuoto e NON si scrivono righe. E' la cintura che non puo' "tornare vuota".
    const { data: ins, error: oe } = await sb.from('shopify_orders').upsert(order, { onConflict: 'order_id', ignoreDuplicates: true }).select('id');
    if (oe) { if (errors.length < 5) errors.push(`${o.name}: ${oe.message}`); continue; }
    if (!ins?.length) { skipped++; continue; }
    if (lines.length) {
      const { error: le } = await sb.from('shopify_line_items').insert(lines);
      if (le) {
        // prima l'errore era ignorato e l'ordine restava SENZA righe per sempre (#1734, 09-09): vendita mai
        // scalata dallo stock ne' contata nel COGS. Ora si toglie l'ordine appena scritto e si ritenta al giro dopo.
        // Se anche la delete fallisce, l'ordine resta senza righe: si dice forte (ce_shopify_doppioni lo conta).
        const { error: de } = await sb.from('shopify_orders').delete().eq('id', ins[0].id);
        if (errors.length < 5) errors.push(de ? `${o.name} ORDINE SENZA RIGHE (righe: ${le.message}; delete fallita: ${de.message})` : `${o.name} righe: ${le.message}`);
        continue;
      }
      lineCount += lines.length;
    }
    inserted++; insertedNames.push(String(o.name));
  }

  // Re-sync rimborsi/stato (audit A7): un ordine puo' essere rimborsato/evaso/modificato DOPO il primo ingest;
  // il pull normale (created_at_min) non lo ripesca. Ripassa gli ordini AGGIORNATI negli ultimi 45 giorni e
  // aggiorna SOLO refund/financial/fulfillment/fulfilled_at (mai importi/righe), e SOLO se qualcosa cambia.
  // Un rimborso su un mese chiuso accendera' ce_drift -> l'owner ri-chiude: e' il comportamento contabile corretto.
  let resynced = 0, resyncErr = 0;
  const updSince = new Date(Date.now() - 45 * 86400000).toISOString();
  const ru = `${API}/orders.json?status=any&updated_at_min=${encodeURIComponent(updSince)}&limit=250&fields=id,name,financial_status,fulfillment_status,fulfillments,refunds`;
  const rr = await fetch(ru, { headers: SH });
  if (rr.ok) {
    const upd: Record<string, any>[] = (await rr.json()).orders ?? [];
    const uNames = upd.map((o) => String(o.name));
    const known = new Map<string, Record<string, any>>();
    if (uNames.length) {
      const { data: kn, error: kErr } = await retryOnce(() => sb.from('shopify_orders').select('order_id, refund_amount, financial_status, fulfillment_status, fulfilled_at, year, month').in('order_id', uNames));
      if (kErr) resyncErr++;
      for (const r of kn ?? []) known.set(String(r.order_id), r);
    }
    for (const o of upd) {
      const k = known.get(String(o.name));
      if (!k) continue;
      const refund = refundOf(o);
      const meseAperto = Number(k.year) * 100 + Number(k.month) > closedMax;
      const fulfilled_at = k.fulfilled_at ?? (meseAperto ? (o.fulfillments?.[0]?.created_at ?? null) : null);
      const same = Math.abs(Number(k.refund_amount ?? 0) - refund) < 0.005 && (k.financial_status ?? null) === (o.financial_status ?? null)
        && (k.fulfillment_status ?? null) === (o.fulfillment_status ?? null) && (k.fulfilled_at ?? null) === fulfilled_at;
      if (same) continue;
      const { error: ue } = await sb.from('shopify_orders').update({ refund_amount: refund, financial_status: o.financial_status, fulfillment_status: o.fulfillment_status, fulfilled_at }).eq('order_id', o.name);
      if (ue) resyncErr++; else resynced++;
    }
  } else resyncErr++;

  const label = `sync: letti ${orders.length}, nuovi ${inserted} (${lineCount} righe${insertedNames.length ? ': ' + insertedNames.slice(0, 8).join(' ') : ''}), gia' presenti ${existing.size + skipped}, resync ${resynced}`
    + (errors.length ? `, ERRORI ${errors.length}: ${errors.slice(0, 3).join(' | ')}` : '') + (resyncErr ? `, resync falliti ${resyncErr}` : '');
  await health(label, errors.length + resyncErr, errors.length ? 'error' : (resyncErr ? 'warn' : 'ok'));
  return json({ ok: true, fetched: orders.length, since: sinceDate, inserted, lineCount, skipped, resynced, resyncErr, errors: errors.length ? errors : undefined });
});
