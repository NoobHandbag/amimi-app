// ce-guard — la guardia contabile. PIN-gated, gira ogni giorno alle 06:30 (pg_cron) e on-demand.
// Azioni:
//   run          -> esegue TUTTI i check e scrive l'esito in health_log (chiavi ce_*)
//   close_month  -> {year, month, chi} congela il CE del mese (amimi+totale) in ce_snapshots
//   status       -> ritorna i check di oggi
// Check: invarianti MC1/MC2, vendite non risolte, COGS mancanti, giacenze negative,
// categorie spese non valide, DRIFT dei mesi chiusi (vs ce_snapshots), riconciliazione
// ESTERNA con Shopify Admin API (count ordini mese corrente + precedente).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const SHOP = 'amimi-10000';
const N = (x: unknown) => Number(x) || 0;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg } = await sb.from('app_config').select('pin_hash, shopify_token').eq('id', 1).single();
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);
  const action = body.action || 'run';
  const now = new Date();
  const YEAR = now.getUTCFullYear();

  // ---- close_month: congela il CE del mese in ce_snapshots (mai sovrascrive in silenzio) ----
  if (action === 'close_month') {
    const y = Number(body.year || YEAR), m = Number(body.month);
    if (!m || m < 1 || m > 12) return json({ error: 'month mancante' }, 422);
    const out: Record<string, string> = {};
    for (const [ce, view] of [['amimi', 'v_ce_amimi_summary'], ['totale', 'v_ce_totale']] as const) {
      const { data: rows } = await sb.from(view).select('*').eq('year', y).eq('month', m);
      if (!rows?.length) { out[ce] = 'nessun dato'; continue; }
      const { error } = await sb.from('ce_snapshots').insert({ ce, year: y, month: m, snapshot: rows[0], closed_by: body.chi || null });
      out[ce] = error ? (error.message.includes('duplicate') ? 'gia chiuso (non sovrascritto)' : 'ERR ' + error.message) : 'chiuso';
    }
    await sb.from('change_log').insert({ tbl: 'ce_snapshots', row_id: `${y}-${m}`, op: 'close_month', after: out, chi: body.chi || null, source: 'ce-guard' });
    return json({ ok: true, year: y, month: m, ...out });
  }

  if (action === 'status') {
    const { data } = await sb.from('health_log').select('*').like('k', 'ce_%').eq('day', now.toISOString().slice(0, 10)).order('k');
    return json({ ok: true, checks: data });
  }

  // ---- run: tutti i check ----
  const checks: { k: string; label: string; n: number; severity: string }[] = [];
  const add = (k: string, label: string, n: number, bad: 'warn' | 'error' = 'error') =>
    checks.push({ k, label, n, severity: n === 0 ? 'ok' : bad });

  // 1) invarianti MC1/MC2 su entrambi i CE (tolleranza 2 cent)
  let mcViol = 0; const mcDetails: string[] = [];
  for (const [ce, view] of [['amimi', 'v_ce_amimi_summary'], ['totale', 'v_ce_totale']] as const) {
    const { data: rows } = await sb.from(view).select('*').eq('year', YEAR);
    for (const r of rows ?? []) {
      const mc1c = N(r.omni_netto) + N(r.cogs) + N(r.packaging) + N(r.commissioni) + N(r.logistica_var) + N(r.resi);
      const mc2c = N(r.mc1) + N(r.salari) + N(r.tasse) + N(r.logistica_mag) + N(r.opex) + N(r.eventi) + N(r.marketing);
      if (Math.abs(mc1c - N(r.mc1)) > 0.02) { mcViol++; mcDetails.push(`${ce} M${r.month} mc1`); }
      if (Math.abs(mc2c - N(r.mc2)) > 0.02) { mcViol++; mcDetails.push(`${ce} M${r.month} mc2`); }
    }
  }
  add('ce_invarianti_mc', 'Invarianti MC1/MC2 (netto-variabili-fissi)' + (mcDetails.length ? ': ' + mcDetails.join(', ') : ''), mcViol);

  // 2) vendite Qromo non risolte
  const { count: unres } = await sb.from('qromo_sales').select('*', { count: 'exact', head: true }).eq('resolver_status', 'unresolved');
  add('ce_qromo_unresolved', 'Vendite Qromo con prodotto non risolto', unres ?? 0);

  // 3) COGS mancanti su vendite risolte (Shopify righe + Qromo)
  const { count: liNoCogs } = await sb.from('shopify_line_items').select('*', { count: 'exact', head: true }).not('codice', 'is', null).is('cogs_snapshot', null);
  const { count: qrNoCogs } = await sb.from('qromo_sales').select('*', { count: 'exact', head: true }).not('codice', 'is', null).is('cogs', null).neq('resolver_status', 'unresolved');
  add('ce_cogs_mancanti', 'Righe vendita risolte senza COGS (Shopify+Qromo)', (liNoCogs ?? 0) + (qrNoCogs ?? 0), 'warn');

  // 4) giacenze negative
  const { data: inv } = await sb.from('v_inventory').select('codice, giacenza_attuale');
  const neg = (inv ?? []).filter((r) => N(r.giacenza_attuale) < 0).length;
  add('ce_giacenze_negative', 'Prodotti con giacenza negativa', neg);

  // 5) spese con categoria non valida
  const { count: badCat } = await sb.from('expenses').select('*', { count: 'exact', head: true }).eq('categoria_valid', false);
  add('ce_expenses_categoria', 'Spese con CATEGORIA non valida', badCat ?? 0);

  // 6) spese in coda di revisione (informativo)
  const { count: pend } = await sb.from('v_expenses_review').select('*', { count: 'exact', head: true });
  add('ce_expenses_da_verificare', 'Spese in coda di revisione', pend ?? 0, 'warn');

  // 7) DRIFT dei mesi chiusi: i numeri del passato NON devono muoversi
  const { data: drift } = await sb.from('v_ce_drift').select('*');
  const drifted = (drift ?? []).filter((r) => Math.abs(N(r.delta_netto)) > 0.01 || Math.abs(N(r.delta_mc2)) > 0.01);
  add('ce_drift_mesi_chiusi', 'Mesi CHIUSI i cui numeri sono cambiati' + (drifted.length ? ': ' + drifted.map((d) => `${d.ce} ${d.year}-${d.month} (netto ${d.delta_netto >= 0 ? '+' : ''}${d.delta_netto})`).join(', ') : ''), drifted.length);

  // 8) riconciliazione ESTERNA Shopify: count ordini mese corrente + precedente vs Admin API
  let shopifyChecked = 0, shopifyMismatch = 0; const shopDetails: string[] = [];
  if (cfg.shopify_token) {
    const months: [number, number][] = [];
    const cm = now.getUTCMonth() + 1;
    months.push([YEAR, cm]);
    months.push(cm === 1 ? [YEAR - 1, 12] : [YEAR, cm - 1]);
    for (const [y, m] of months) {
      const from = `${y}-${String(m).padStart(2, '0')}-01T00:00:00Z`;
      const to = m === 12 ? `${y + 1}-01-01T00:00:00Z` : `${y}-${String(m + 1).padStart(2, '0')}-01T00:00:00Z`;
      try {
        const r = await fetch(`https://${SHOP}.myshopify.com/admin/api/2024-01/orders/count.json?status=any&created_at_min=${from}&created_at_max=${to}`,
          { headers: { 'X-Shopify-Access-Token': cfg.shopify_token } });
        if (!r.ok) continue;
        const apiCount = (await r.json()).count ?? 0;
        const { count: dbCount } = await sb.from('shopify_orders').select('*', { count: 'exact', head: true }).eq('year', y).eq('month', m);
        shopifyChecked++;
        if (apiCount !== (dbCount ?? 0)) { shopifyMismatch++; shopDetails.push(`${y}-${m}: api=${apiCount} db=${dbCount}`); }
      } catch { /* rete: riprova domani */ }
    }
  }
  add('ce_shopify_reconcile', `Riconciliazione ordini vs Shopify API (${shopifyChecked} mesi)` + (shopDetails.length ? ': ' + shopDetails.join(', ') : ''), shopifyMismatch);

  // scrivi in health_log (sostituisce le chiavi ce_* di oggi)
  const today = now.toISOString().slice(0, 10);
  await sb.from('health_log').delete().eq('day', today).like('k', 'ce_%');
  await sb.from('health_log').insert(checks.map((c) => ({ day: today, ...c })));

  const problems = checks.filter((c) => c.severity !== 'ok');
  return json({ ok: true, all_green: problems.length === 0, checks, problems });
});
