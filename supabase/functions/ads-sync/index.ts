// ads-sync — pull READ-ONLY di Meta Ads a livello ad/creativita' nel replica Supabase.
// Additivo e isolato: scrive SOLO meta_ads_creative_daily / meta_ad_creative / meta_product_set_map (migr 0128).
// NON tocca meta_ads_daily (livello campagna, storica) ne' altre tabelle.
//
// Token Meta in app_config.meta_token (service-role only), come shopify_token. Se manca: NON pulla,
// scrive health_log 'ads_sync' warn e ritorna ok (no-op sicuro). PIN-gated come le altre edge.
// Idempotente: upsert su (date,ad_id), (ad_id) e (product_set_id,retailer_id).
//
// Sorgente: Meta Graph v21.0, account act_686034712784477, catalogo 916048904718661 ("catalogo Amimi Shopify").
// Il mapping creativita'->prodotto e' via catalogo: creative.product_set_id -> prodotti del set ->
// retailer_id -> codice_norm dell'app (best-effort in v1, vedi resolveCodice_).
//
// v1 (2026-09-18), audit gate Gate 2 con revisore indipendente, finding chiusi qui dentro:
//  A1 il token viaggia SOLO in header (authorization Bearer), mai in querystring, e ogni messaggio che finisce in
//     health_log (leggibile da anon) passa da redact_; B3 gli errori sull'anagrafica creative sono contati e pesano
//     sulla severity; B4 l'health check legge il nodo singolo dell'account (metaGetOne_); B5 un pull troncato a
//     maxPages e' un errore dichiarato, non un giorno parziale; B6 dedup prima di ogni upsert (un doppione in una
//     risposta Meta farebbe saltare l'intero giorno); B7 date di Roma con Intl e aritmetica su mezzanotte UTC.
//  A2 (Regola Ferrea 20) le letture di products/product_aliases da cui dipende COSA si scrive sono controllate:
//     un 504 di PostgREST ferma il giro invece di sbiancare codice_norm. Guardie: tests/ads_sync_guardie.mjs e
//     tests/letture_controllate_guardie.mjs.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string | null | undefined) => (s ? s.toUpperCase().replace(/\s+/g, '_') : '');
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Letture Supabase: un solo ritentativo dopo 1,5s (PostgREST risponde 504 al 4% delle chiamate, caso aperto #19).
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn();
  if (!r.error) return r;
  await sleep(1500);
  return await fn();
};
// Cap di PostgREST sulle select senza range (come shopify-sync): a 1.000 righe la risposta e' TRONCATA in silenzio.
const POSTGREST_CAP = 1000;
// A1: il token non deve mai finire in un messaggio loggato. Viaggia in header, ma paging.next di Meta puo'
// riportarlo in querystring e un rigetto di fetch cita l'URL intero: si redige sempre, prima di scrivere.
const redact_ = (s: string) => String(s ?? '').replace(/access_token=[^&\s)]*/gi, 'access_token=***');

const GRAPH = 'https://graph.facebook.com/v21.0';
const AD_ACCOUNT = 'act_686034712784477';
const CATALOG_ID = '916048904718661'; // assunto: unico catalogo del business (C3), non letto dal set
// Nomi "actions" di Meta -> nostre colonne. Meta espone la stessa conversione anche come omni_* e
// offsite_conversion.fb_pixel_*: tutte le forme mappano sulla stessa colonna e parseActions_ tiene il valore
// MASSIMO (stesso evento visto da piu' attribuzioni: non si sommano). Cosi' nessuna forma resta a zero (C10).
const ACTION_MAP: Record<string, string> = {
  landing_page_view: 'landing_page_views', omni_landing_page_view: 'landing_page_views',
  view_content: 'view_content', omni_view_content: 'view_content', 'offsite_conversion.fb_pixel_view_content': 'view_content',
  add_to_cart: 'add_to_cart', omni_add_to_cart: 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart': 'add_to_cart',
  initiate_checkout: 'initiate_checkout', omni_initiated_checkout: 'initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout': 'initiate_checkout',
  add_payment_info: 'add_payment_info', omni_add_payment_info: 'add_payment_info', 'offsite_conversion.fb_pixel_add_payment_info': 'add_payment_info',
  purchase: 'purchases', omni_purchase: 'purchases', 'offsite_conversion.fb_pixel_purchase': 'purchases',
};
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function parseActions_(arr: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(arr)) return out;
  for (const it of arr as Array<{ action_type?: string; value?: unknown }>) {
    const mapped = ACTION_MAP[it.action_type ?? ''] ?? it.action_type ?? '';
    if (!mapped) continue;
    const v = num(it.value);
    if (!(mapped in out) || v > out[mapped]) out[mapped] = v;
  }
  return out;
}

// GET Meta con paginazione: token in header (A1), segue paging.next, throw su errore Meta e su troncamento (B5):
// una pagina mancante scriverebbe un giorno parziale che l'upsert tratterebbe come completo.
async function metaGetAll_(token: string, firstUrl: string, maxPages = 25): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  const H = { accept: 'application/json', authorization: `Bearer ${token}` };
  let url: string | null = firstUrl;
  let page = 0;
  while (url && page++ < maxPages) {
    const resp = await fetch(url, { headers: H });
    const bodyTxt = await resp.text();
    if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${redact_(bodyTxt).slice(0, 300)}`);
    const jd = JSON.parse(bodyTxt);
    if (jd.error) throw new Error(`Meta API: ${jd.error.message} (code ${jd.error.code})`);
    for (const r of jd.data ?? []) rows.push(r);
    url = jd.paging?.next ?? null;
    if (url) await sleep(250); // gentile col rate limit Meta
  }
  if (url) throw new Error(`troncato a ${maxPages} pagine su ${firstUrl.split('?')[0]}: dati incompleti`);
  return rows;
}
// Nodo singolo (B4): /act_xxx?fields=... ritorna un oggetto, non {data:[...]}.
async function metaGetOne_(token: string, url: string): Promise<Record<string, any>> {
  const resp = await fetch(url, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${redact_(txt).slice(0, 300)}`);
  const jd = JSON.parse(txt);
  if (jd.error) throw new Error(`Meta API: ${jd.error.message} (code ${jd.error.code})`);
  return jd;
}
// B7: data di Roma con Intl (come write-api lib.todayRome e shipping-status-sync), aritmetica sui giorni ancorata
// alla mezzanotte UTC (ogni giorno = 86.400.000 ms): il cambio ora non salta ne' duplica un giorno.
const todayRome_ = (now: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(now);
const romeDate_ = (offsetDays: number, now: Date = new Date()) =>
  new Date(Date.parse(todayRome_(now) + 'T00:00:00Z') - offsetDays * 86400000).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({} as Record<string, any>));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = () => new Date().toISOString().slice(0, 10); // chiave health in UTC, come shopify-sync (C11)
  const health = async (label: string, n: number, severity: 'ok' | 'warn' | 'error') => {
    const { error } = await retryOnce(() => sb.from('health_log').upsert({ day: today(), k: 'ads_sync', label: redact_(label).slice(0, 500), n, severity, created_at: new Date().toISOString() }, { onConflict: 'day,k' }));
    return !error;
  };
  const fail = async (step: string, msg: string, status = 500) => {
    if (!body.dryRun) await health(`ads-sync FERMATO (${step}): ${redact_(msg)}`, 1, 'error');
    return json({ error: `${step}: ${redact_(msg)}` }, status);
  };

  // ---- auth: PIN + token Meta da app_config (come shopify-sync) ----
  const { data: cfg, error: cfgErr } = await retryOnce(() => sb.from('app_config').select('pin_hash, meta_token').eq('id', 1).single());
  if (cfgErr) return fail('app_config', cfgErr.message);
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);
  const token = (cfg.meta_token ?? '').trim();
  if (!token) {
    // no-op dichiarato: nessun token, nessun pull. NON e' un errore, non deve accendere il banner rosso.
    await health('meta_token mancante in app_config: nessun pull (metti il token, vedi SETUP_GUIDE_System_User_Token.md)', 0, 'warn');
    return json({ ok: true, skipped: 'no_token' });
  }

  // ---- health check: il token vede l'account? (nodo singolo, B4) ----
  if (body.action === 'health') {
    try {
      const acct = await metaGetOne_(token, `${GRAPH}/${AD_ACCOUNT}?fields=name,currency,account_status`);
      if (!acct?.name) return fail('health', 'account non leggibile col token corrente', 502);
      await health(`token ok, account ${acct.name} (${acct.currency ?? '?'}, status ${acct.account_status ?? '?'})`, 0, 'ok');
      return json({ ok: true, account: { name: acct.name, currency: acct.currency, account_status: acct.account_status } });
    } catch (e) {
      return fail('health', (e as Error).message, 502);
    }
  }

  // ---- date da pullare: default IERI (Roma). Backfill a blocchi di max 30 giorni per invocazione (C6, wall-clock
  // edge): action='backfill', days<=30, offset = giorni da saltare per il blocco successivo (risposta: next_offset). ----
  const isBackfill = body.action === 'backfill';
  const days = isBackfill ? Math.min(30, Math.max(1, Number(body.days) || 14)) : 1;
  const startOffset = isBackfill ? Math.max(0, Number(body.offset) || 0) : 0;
  const dates: string[] = [];
  for (let i = startOffset + days; i >= startOffset + 1; i--) dates.push(romeDate_(i));

  const insightFields = [
    'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name', 'objective',
    'spend', 'impressions', 'reach', 'frequency', 'clicks', 'inline_link_clicks', 'ctr', 'cpc', 'cpm',
    'actions', 'action_values',
  ].join(',');

  let dailyRows = 0, dailyErr = 0;
  try {
    for (const date of dates) {
      const tr = encodeURIComponent(JSON.stringify({ since: date, until: date }));
      const url = `${GRAPH}/${AD_ACCOUNT}/insights?level=ad&time_range=${tr}&fields=${insightFields}&limit=200`;
      const ins = await metaGetAll_(token, url);
      const rows = ins.map((r) => {
        const a = parseActions_(r.actions);
        const av = parseActions_(r.action_values);
        const spend = num(r.spend);
        const purchases = a['purchases'] || 0;
        const purchaseValue = av['purchases'] || 0; // action_values 'purchase' (e forme omni/offsite) -> 'purchases'
        return {
          date, account_id: AD_ACCOUNT,
          campaign_id: r.campaign_id ?? null, campaign_name: r.campaign_name ?? null, campaign_objective: r.objective ?? null,
          adset_id: r.adset_id ?? null, adset_name: r.adset_name ?? null,
          ad_id: String(r.ad_id ?? ''), ad_name: r.ad_name ?? null,
          ad_status: null, creative_id: null, // riservati: insights level=ad non li espone (C4); stato in meta_ad_creative
          spend, impressions: num(r.impressions), reach: num(r.reach), frequency: num(r.frequency),
          clicks: num(r.clicks), link_clicks: num(r.inline_link_clicks), ctr: num(r.ctr), cpc: num(r.cpc), cpm: num(r.cpm),
          landing_page_views: a['landing_page_views'] || 0, view_content: a['view_content'] || 0,
          add_to_cart: a['add_to_cart'] || 0, initiate_checkout: a['initiate_checkout'] || 0, add_payment_info: a['add_payment_info'] || 0,
          purchases, purchase_value: purchaseValue,
          cpa: purchases > 0 ? spend / purchases : null, roas: spend > 0 ? purchaseValue / spend : null,
          pulled_at: new Date().toISOString(), source: 'ads-sync',
        };
      }).filter((r) => r.ad_id);
      if (rows.length) {
        // B6: un ad ripetuto nella stessa risposta (Meta pagina su dati vivi) manderebbe in 21000 l'intero upsert
        const dedup = [...new Map(rows.map((r) => [r.ad_id, r])).values()];
        const { error } = await sb.from('meta_ads_creative_daily').upsert(dedup, { onConflict: 'date,ad_id' });
        if (error) { dailyErr++; } else dailyRows += dedup.length;
      }
      await sleep(200);
    }
  } catch (e) {
    return fail('insights', (e as Error).message, 502);
  }

  // ---- anagrafica creative: ads + creative (product_set_id, destinazione, thumbnail). Errori contati (B3). ----
  let creativeRows = 0, creativeErr = 0; const setIds = new Set<string>();
  try {
    const creativeSub = 'creative{id,object_type,thumbnail_url,url_tags,product_set_id,object_story_spec{link_data{link,name}}}';
    const ads = await metaGetAll_(token, `${GRAPH}/${AD_ACCOUNT}/ads?fields=id,name,adset_id,campaign_id,effective_status,${creativeSub}&limit=100`);
    const anag = ads.map((ad) => {
      const c = ad.creative ?? {};
      const psid = c.product_set_id ?? null;
      if (psid) setIds.add(String(psid));
      return {
        ad_id: String(ad.id), creative_id: c.id ?? null, ad_name: ad.name ?? null,
        adset_id: ad.adset_id ?? null, campaign_id: ad.campaign_id ?? null,
        object_type: c.object_type ?? null, title: c.object_story_spec?.link_data?.name ?? null,
        thumbnail_url: c.thumbnail_url ?? null, link: c.object_story_spec?.link_data?.link ?? null,
        url_tags: c.url_tags ?? null, product_set_id: psid, catalog_id: psid ? CATALOG_ID : null,
        effective_status: ad.effective_status ?? null, last_seen: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
    });
    if (!anag.length) creativeErr++; // 0 ad = token senza ads_read o account vuoto: non e' "tutto ok"
    for (let i = 0; i < anag.length; i += 200) {
      const { error } = await sb.from('meta_ad_creative').upsert(anag.slice(i, i + 200), { onConflict: 'ad_id' });
      if (error) creativeErr++; else creativeRows += Math.min(200, anag.length - i);
    }
  } catch (e) {
    // l'anagrafica e' secondaria: se Meta fallisce qui, i daily sono gia' scritti. Warn, non fermare tutto.
    await health(`daily ${dailyRows}, anagrafica creative FALLITA: ${(e as Error).message}`, 1, 'warn');
    return json({ ok: true, dailyRows, dailyErr, creativeWarn: redact_((e as Error).message) });
  }

  // ---- mappa product_set -> retailer_id -> codice_norm (best-effort v1). A2: le letture da cui dipende COSA si
  // scrive sono controllate e fail-closed: un 504 su products/product_aliases FERMA il giro invece di sbiancare
  // codice_norm su tutte le righe (stessa regola 1 di shopify-sync v7). ----
  let mapRows = 0, mapErr = 0;
  const { data: al, error: alErr } = await retryOnce(() => sb.from('product_aliases').select('shopify_name_norm, codice'));
  if (alErr) return fail('product_aliases', alErr.message);
  const { data: pr, error: prErr } = await retryOnce(() => sb.from('products').select('codice, codice_norm'));
  if (prErr) return fail('products', prErr.message);
  if (!pr?.length) return fail('products', 'anagrafica vuota: nessun prodotto letto');
  if ((al ?? []).length >= POSTGREST_CAP || (pr ?? []).length >= POSTGREST_CAP) return fail('cap PostgREST', `anagrafica a ${POSTGREST_CAP}+ righe: la lettura e' troncata, serve la paginazione`);
  try {
    const aliasMap = new Map((al ?? []).map((r: any) => [r.shopify_name_norm, r.codice]));
    const codiceByNorm = new Map((pr ?? []).map((r: any) => [r.codice_norm, r.codice]));
    // Risoluzione per nome prodotto normalizzato sull'anagrafica app (products/alias), come il resolver di
    // shopify-sync; retailer_id e nome restano salvati grezzi per un match migliore dopo.
    const resolveCodice_ = (name: string, retailer: string): string | null => {
      const n1 = norm(name);
      if (aliasMap.has(n1)) return norm(aliasMap.get(n1)!);
      if (codiceByNorm.has(n1)) return n1;
      const nr = norm(retailer);
      if (codiceByNorm.has(nr)) return nr;
      return null;
    };
    for (const setId of setIds) {
      const prods = await metaGetAll_(token, `${GRAPH}/${setId}/products?fields=retailer_id,name,availability&limit=100`, 10);
      const rows = prods.map((p) => {
        const retailer = String(p.retailer_id ?? '');
        const codice = resolveCodice_(String(p.name ?? ''), retailer);
        return { product_set_id: setId, catalog_id: CATALOG_ID, retailer_id: retailer, codice_norm: codice, product_name: p.name ?? null, availability: p.availability ?? null, last_seen: new Date().toISOString() };
      }).filter((r) => r.retailer_id);
      if (rows.length) {
        const dedupMap = [...new Map(rows.map((r) => [`${r.product_set_id}|${r.retailer_id}`, r])).values()];
        const { error } = await sb.from('meta_product_set_map').upsert(dedupMap, { onConflict: 'product_set_id,retailer_id' });
        if (error) mapErr++; else mapRows += dedupMap.length;
      }
      await sleep(200);
    }
  } catch (e) {
    await health(`daily ${dailyRows}, creative ${creativeRows}, product_set map FALLITA: ${(e as Error).message}`, 1, 'warn');
    return json({ ok: true, dailyRows, dailyErr, creativeRows, creativeErr, mapWarn: redact_((e as Error).message) });
  }

  const sev = dailyErr || mapErr || creativeErr ? 'warn' : 'ok';
  await health(`pull ${dates.length}g (${dates[0]} -> ${dates[dates.length - 1]}): ${dailyRows} righe ad-day, ${creativeRows} creative, ${mapRows} righe set-map, set ${setIds.size}` + (dailyErr || mapErr || creativeErr ? `, errori daily ${dailyErr} creative ${creativeErr} map ${mapErr}` : ''), dailyErr + mapErr + creativeErr, sev as 'ok' | 'warn');
  return json({ ok: true, dates: dates.length, from: dates[0], to: dates[dates.length - 1], dailyRows, dailyErr, creativeRows, creativeErr, mapRows, mapErr, sets: setIds.size, next_offset: isBackfill ? startOffset + days : undefined });
});
