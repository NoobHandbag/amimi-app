// ugc-publish v1: recensioni dell'area membri pubblicate da sole sul sito (brief 2026-10-28, richiesta di Benedetta).
// Modulo ISOLATO (Regola 19), flag app_flags.ugc_publish_enabled default OFF: spento = {state:'off'} e nessuna
// scrittura; `dryRun:true` legge e mostra il piano anche a flag spento.
// Riconciliazione COMPLETA e idempotente a ogni giro (non a eventi), cron ogni 10 minuti (migr 0179):
//   - recensione pubblicabile (approvata, stelle, testo, consenso) -> metaobjectUpsert su handle recensione-<id> del
//     tipo recensione_cliente, SOLO se un campo cambia. Alla creazione publishable ACTIVE; all'aggiornamento niente
//     capabilities, cosi' una voce messa in Bozza dal team in admin resta in Bozza.
//   - voce recensione-<id> con id_sorgente = <id> non piu' pubblicabile (rifiutata, cancellata) -> metaobjectDelete,
//     con un freno (lib.deleteGuard) contro una lettura vuota o monca del gestionale.
//   - voci con altri handle o senza id_sorgente: mai toccate.
//   - custom.modello sulle schede (ACTIVE e DRAFT con handle in shopify_catalog): scritto se vuoto, mai sovrascritto se
//     diverso (segnalato in health_log): vedi lib.planModello.
// Privacy: su Shopify (metaobject PUBBLICO) vanno solo testo, stelle, firma, modello, borsa, data, id (lib.desiredFields).
// Scrive solo su Shopify, change_log (site_publish / site_unpublish) e health_log (k = ugc_publish). Non tocca loyalty_*.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  TYPE, chunk, deleteGuard, mergeHealth, missingScopes, ownedId, planModello, planReviews, titleCase,
  type Existing, type ShopProduct, type UgcRow,
} from './lib.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const SHOP = 'amimi-10000';
const API_VERSION = '2026-07';        // come loyalty-proxy e loyalty-orders: ripinnare insieme
const GQL = `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`;
const MAX_PAGES = 8;                  // 8 x 250 prodotti / voci: oltre e' un errore, non un taglio silenzioso
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn(); if (!r.error) return r; await sleep(1500); return await fn();
};
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const msg = (e: unknown) => String(e instanceof Error ? e.message : e);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const dryRun = body.dryRun === true;
  const today = () => new Date().toISOString().slice(0, 10);
  const health = async (label: string, n: number, sev: 'ok' | 'warn' | 'error') => {
    const { data: prev } = await sb.from('health_log').select('label, n, severity').eq('day', today()).eq('k', 'ugc_publish').maybeSingle();
    const row = mergeHealth(prev ?? null, { label: label.slice(0, 500), n, severity: sev });
    const { error } = await retryOnce(() => sb.from('health_log').upsert({ day: today(), k: 'ugc_publish', ...row, created_at: new Date().toISOString() }, { onConflict: 'day,k' }));
    return !error;
  };
  const fail = async (step: string, m: string, status = 500) => {
    if (!dryRun) await health(`ugc-publish FERMATO (${step}): ${m}`, 1, 'error');
    return json({ error: `${step}: ${m}` }, status);
  };

  // --- PIN (come le altre edge chiamate dal cron) + token ---
  const { data: cfg, error: cErr } = await retryOnce(() => sb.from('app_config').select('pin_hash, shopify_token').eq('id', 1).single());
  if (cErr) return fail('app_config', cErr.message, 503);
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);
  const token = String(cfg?.shopify_token ?? '');

  // --- flag: illeggibile = 503, mai "off" per un errore di rete ---
  const { data: flag, error: fErr } = await retryOnce(() => sb.from('app_flags').select('value').eq('key', 'ugc_publish_enabled').maybeSingle());
  if (fErr) return json({ error: `app_flags: ${fErr.message}` }, 503);
  const enabled = String(flag?.value ?? 'false').trim().toLowerCase() === 'true';
  if (!enabled && !dryRun) return json({ state: 'off' });
  if (!token) return fail('token', 'token Shopify mancante');

  // --- Admin API GraphQL: ritenta su 429 / 5xx / THROTTLED, versione servita annotata ---
  let servedVersion = '';
  const gql = async (query: string, variables: Record<string, unknown> = {}) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(GQL, { method: 'POST', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
      servedVersion = r.headers.get('x-shopify-api-version') ?? servedVersion;
      const transient = r.status === 429 || r.status >= 500;
      if (!transient && !r.ok) throw new Error(`Shopify HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      const j = transient ? null : await r.json();
      const throttled = Boolean(j?.errors?.some((e: { extensions?: { code?: string } }) => e?.extensions?.code === 'THROTTLED'));
      if (transient || throttled) {
        if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
        throw new Error(transient ? `Shopify HTTP ${r.status}` : 'Shopify THROTTLED');
      }
      if (j?.errors?.length) throw new Error('GraphQL: ' + JSON.stringify(j.errors).slice(0, 300));
      return j?.data;
    }
  };
  const versionNote = () => servedVersion && servedVersion !== API_VERSION ? ` | ATTENZIONE: API servita ${servedVersion}, pinnata ${API_VERSION}` : '';
  const pages = async <T>(query: string, pick: (d: any) => { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string } }) => {
    const out: T[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const conn = pick(await gql(query, { after }));
      out.push(...(conn?.nodes ?? []));
      if (!conn?.pageInfo?.hasNextPage) return out;
      after = conn.pageInfo.endCursor;
    }
    throw new Error(`oltre ${MAX_PAGES * 250} elementi: alzare MAX_PAGES`);
  };

  // --- 1. scope: senza write_metaobjects e write_products il giro non scrive e non cancella nulla ---
  let scopes: string[];
  try { scopes = ((await gql('{ currentAppInstallation { accessScopes { handle } } }'))?.currentAppInstallation?.accessScopes ?? []).map((s: { handle: string }) => s.handle); }
  catch (e) { return fail('Shopify', msg(e), 502); }
  const missing = missingScopes(scopes);
  if (missing.length) return fail('scope', `al token Shopify mancano ${missing.join(', ')}: vanno aggiunti nella custom app (owner)`, 412);

  // --- 2. gestionale: recensioni, catalogo, modelli. Qualunque errore ferma il giro PRIMA di scrivere. Il conteggio
  //     esatto contro le righe lette: PostgREST taglia a max_rows senza errore, e una recensione tagliata fuori
  //     sembrerebbe "non piu' pubblicabile" e verrebbe tolta dal sito ---
  const [ugc, cat, prods] = await Promise.all([
    retryOnce(() => sb.from('loyalty_ugc').select('id, kind, status, codice, rating, testo, firma, consenso_testo, created_at', { count: 'exact' }).eq('kind', 'recensione').eq('status', 'approvata').order('id')),
    retryOnce(() => sb.from('shopify_catalog').select('codice, handle', { count: 'exact' }).order('codice')),
    retryOnce(() => sb.from('products').select('codice, model', { count: 'exact' }).order('codice')),
  ]);
  const dbErr = ugc.error ?? cat.error ?? prods.error;
  if (dbErr) return fail('gestionale', dbErr.message, 503);
  for (const [name, r] of [['loyalty_ugc', ugc], ['shopify_catalog', cat], ['products', prods]] as const) {
    if (r.count == null || (r.data ?? []).length < r.count) return fail('gestionale', `${name}: lette ${(r.data ?? []).length} righe su ${r.count ?? '?'} (lettura tagliata)`, 503);
  }
  const rows = (ugc.data ?? []) as UgcRow[];
  const modelByCodice = new Map<string, string>();
  for (const p of prods.data ?? []) if (p.codice && p.model) modelByCodice.set(String(p.codice), titleCase(p.model));
  const handleByCodice = new Map<string, string>();
  const modelByHandle = new Map<string, string>();
  for (const c of cat.data ?? []) {
    if (!c.codice || !c.handle) continue;
    handleByCodice.set(String(c.codice), String(c.handle));
    const m = modelByCodice.get(String(c.codice));
    if (m && !modelByHandle.has(String(c.handle))) modelByHandle.set(String(c.handle), m);
  }

  // --- 3. Shopify: schede prodotto (con custom.modello) e voci recensione_cliente ---
  let products: ShopProduct[], existing: Existing[];
  try {
    products = (await pages<any>(
      `query($after: String) { products(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { id handle status metafield(namespace: "custom", key: "modello") { value } } } }`,
      (d) => d?.products,
    )).map((p) => ({ id: p.id, handle: p.handle, status: p.status, modello: p.metafield?.value ?? null }));
    existing = (await pages<any>(
      `query($after: String) { metaobjects(type: "${TYPE}", first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { id handle capabilities { publishable { status } } fields { key value } } } }`,
      (d) => d?.metaobjects,
    )).map((m) => ({ id: m.id, handle: m.handle, status: String(m.capabilities?.publishable?.status ?? ''), fields: Object.fromEntries((m.fields ?? []).map((f: { key: string; value: string | null }) => [f.key, f.value])) }));
  } catch (e) { return fail('Shopify', msg(e), 502); }

  // --- 4. piani (logica pura in lib.ts) ---
  const mod = planModello(products.filter((p) => modelByHandle.has(p.handle)), modelByHandle);
  const productByHandle = new Map(products.filter((p) => p.status !== 'ARCHIVED').map((p) => [p.handle, p]));
  const plan = planReviews(rows, existing, { handleByCodice, productByHandle, modelloByHandle: mod.modelloByHandle, modelByCodice });
  const owned = existing.filter((e) => ownedId(e) !== null).length;
  const stop = deleteGuard(plan.publishable, owned, plan.deletes.length, body.forceDeletes === true);

  if (dryRun) {
    return json({ ok: true, dryRun: true, enabled, api_version: servedVersion || API_VERSION, scopes_ok: true,
      recensioni: { pubblicabili: plan.publishable, sul_sito: existing.length, nostre: owned, altre: plan.foreign, identiche: plan.unchanged, bloccate: plan.blocked,
        crea: plan.upserts.filter((u) => u.create).map((u) => u.handle),
        aggiorna: plan.upserts.filter((u) => !u.create).map((u) => ({ handle: u.handle, campi: u.changed })),
        togli: plan.deletes.map((d) => d.handle), freno: stop },
      modello: { da_scrivere: mod.sets.map((s) => `${s.handle} = ${s.value}`), gia_giusti: mod.same, divergenti: mod.divergent } });
  }

  // --- 5. scritture ---
  const errors: string[] = [];
  const log = (op: string, u: { handle: string; ugcId: number }, after: Record<string, unknown>) =>
    sb.from('change_log').insert({ tbl: 'loyalty_ugc', row_id: String(u.ugcId), op, after: { handle: u.handle, ...after }, chi: 'ugc-publish', source: 'ugc-publish' });
  const noteErr = (s: string) => { if (errors.length < 5) errors.push(s); };

  // 5a. custom.modello prima delle recensioni (la recensione porta lo stesso valore)
  let modelloScritti = 0;
  for (const part of chunk(mod.sets, 25)) {
    try {
      const d = await gql(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`,
        { m: part.map((s) => ({ ownerId: s.ownerId, namespace: 'custom', key: 'modello', type: 'single_line_text_field', value: s.value })) });
      const ue = d?.metafieldsSet?.userErrors ?? [];
      if (ue.length) noteErr(`metafieldsSet: ${JSON.stringify(ue).slice(0, 200)}`); else modelloScritti += part.length;
    } catch (e) { noteErr(`metafieldsSet: ${msg(e)}`); }
  }

  let creati = 0, aggiornati = 0, tolti = 0;
  for (const u of plan.upserts) {
    try {
      const metaobject: Record<string, unknown> = { fields: u.fields };
      if (u.create) metaobject.capabilities = { publishable: { status: 'ACTIVE' } };
      const d = await gql(`mutation($h: MetaobjectHandleInput!, $m: MetaobjectUpsertInput!) { metaobjectUpsert(handle: $h, metaobject: $m) { metaobject { id handle } userErrors { field message code } } }`,
        { h: { type: TYPE, handle: u.handle }, m: metaobject });
      const ue = d?.metaobjectUpsert?.userErrors ?? [];
      if (ue.length) { noteErr(`${u.handle}: ${JSON.stringify(ue).slice(0, 200)}`); continue; }
      if (u.create) creati++; else aggiornati++;
      const { error } = await log('site_publish', u, { azione: u.create ? 'crea' : 'aggiorna', campi: u.changed, id: d?.metaobjectUpsert?.metaobject?.id });
      if (error) noteErr(`change_log ${u.handle}: ${error.message}`);
    } catch (e) { noteErr(`${u.handle}: ${msg(e)}`); }
  }

  if (stop) noteErr(stop);
  else for (const del of plan.deletes) {
    try {
      const d = await gql(`mutation($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message code } } }`, { id: del.id });
      const ue = d?.metaobjectDelete?.userErrors ?? [];
      if (ue.length) { noteErr(`${del.handle}: ${JSON.stringify(ue).slice(0, 200)}`); continue; }
      tolti++;
      const { error } = await log('site_unpublish', del, { id: del.id });
      if (error) noteErr(`change_log ${del.handle}: ${error.message}`);
    } catch (e) { noteErr(`${del.handle}: ${msg(e)}`); }
  }

  const label = `ugc-publish: pubblicabili ${plan.publishable}, sul sito ${existing.length}, creati ${creati}, aggiornati ${aggiornati}, tolti ${tolti}, identici ${plan.unchanged}`
    + `, modello scritto su ${modelloScritti} schede` + (mod.divergent.length ? `, modello DIVERSO dal gestionale su ${mod.divergent.length}: ${mod.divergent.slice(0, 3).map((x) => x.handle).join(', ')}` : '')
    + (plan.blocked.length ? `, handle occupati da voci non nostre: ${plan.blocked.slice(0, 3).join(', ')}` : '')
    + (errors.length ? `, ERRORI ${errors.length}: ${errors.slice(0, 3).join(' | ')}` : '') + versionNote();
  const sev = errors.length ? 'error' : (mod.divergent.length || plan.blocked.length || versionNote()) ? 'warn' : 'ok';
  await health(label, errors.length, sev);
  return json({ ok: !errors.length, creati, aggiornati, tolti, identici: plan.unchanged, modello_scritti: modelloScritti, modello_divergenti: mod.divergent.length, errors: errors.length ? errors : undefined });
});
