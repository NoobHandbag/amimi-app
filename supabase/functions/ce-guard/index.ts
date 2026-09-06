// ce-guard — la guardia contabile. PIN-gated, gira OGNI ORA al minuto 30 (pg_cron job
// 'ce-guard-daily', schedule '30 * * * *': il nome dice daily, la schedule dice orario) e on-demand.
// Conseguenza da non dimenticare: le chiavi scritte qui DEVONO iniziare per `ce_`, altrimenti la
// delete a fine run (che filtra `k like 'ce_%'`) non le ripulisce, il secondo giro del giorno
// sbatte sull'unique index health_log(day,k) e l'insert intero fallisce -> la guardia smette di
// scrivere per il resto della giornata, in silenzio.
// Azioni:
//   run          -> esegue TUTTI i check e scrive l'esito in health_log (chiavi ce_*)
//   close_month  -> {year, month, chi} congela il CE del mese (amimi+totale) in ce_snapshots
//   status       -> ritorna i check di oggi
// Check: invarianti MC1/MC2, vendite non risolte, COGS mancanti, giacenze negative,
// categorie spese non valide, DRIFT dei mesi chiusi (vs ce_snapshots), riconciliazione
// ESTERNA con Shopify Admin API (count ordini mese corrente + precedente), collegamento
// app <-> Shopify (sku mismatch / sku non a catalogo / merce senza scheda).
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

  // 2bis) FRESCHEZZA del canale Qromo (caso aperto n.15, audit dashboard 06-09). Il check sopra guarda
  // le righe che CI SONO, questo guarda quelle che MANCANO: 32 giorni di buco (30-07 -> 31-08) sono
  // passati inosservati perche' tutto restava verde. Il negozio vende a giorni alterni e chiude in
  // agosto, quindi soglie larghe: warn da 10 giorni, error da 21. n = giorni di silenzio, 0 se sano.
  const { data: lastQ } = await sb.from('qromo_sales').select('data').order('data', { ascending: false }).limit(1);
  const lastQIso = lastQ?.[0]?.data ? String(lastQ[0].data).slice(0, 10) : null;
  const qDays = lastQIso ? Math.floor((now.getTime() - new Date(lastQIso + 'T12:00:00Z').getTime()) / 86400000) : 9999;
  add('ce_qromo_freschezza', `Ultima vendita Qromo ${lastQIso ?? 'mai'}: ${qDays} giorni fa (atteso <10)`, qDays >= 10 ? qDays : 0, qDays >= 21 ? 'error' : 'warn');

  // 3) COGS mancanti su vendite risolte (Shopify righe + Qromo)
  const { count: liNoCogs } = await sb.from('shopify_line_items').select('*', { count: 'exact', head: true }).not('codice', 'is', null).is('cogs_snapshot', null);
  const { count: qrNoCogs } = await sb.from('qromo_sales').select('*', { count: 'exact', head: true }).not('codice', 'is', null).is('cogs', null).neq('resolver_status', 'unresolved');
  add('ce_cogs_mancanti', 'Righe vendita risolte senza COGS (Shopify+Qromo)', (liNoCogs ?? 0) + (qrNoCogs ?? 0), 'warn');

  // 4) giacenze negative
  const { data: inv } = await sb.from('v_inventory').select('codice, giacenza_attuale, disponibili_da_vendere');
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
  // l'etichetta deve mostrare il delta che ha fatto scattare il filtro: prima stampava solo netto,
  // nascondendo il drift su mc2 (l'utile) — l'allarme diceva "netto +0" mentre 400 EUR si muovevano (A4).
  const driftLabel = (d: Record<string, unknown>) => {
    const parts: string[] = [];
    if (Math.abs(N(d.delta_netto)) > 0.01) parts.push(`netto ${N(d.delta_netto) >= 0 ? '+' : ''}${d.delta_netto}`);
    if (Math.abs(N(d.delta_mc2)) > 0.01) parts.push(`mc2 ${N(d.delta_mc2) >= 0 ? '+' : ''}${d.delta_mc2}`);
    return `${d.ce} ${d.year}-${d.month} (${parts.join(', ')})`;
  };
  add('ce_drift_mesi_chiusi', 'Mesi CHIUSI i cui numeri sono cambiati' + (drifted.length ? ': ' + drifted.map(driftLabel).join(', ') : ''), drifted.length);

  // 8) riconciliazione ESTERNA Shopify: count ordini mese corrente + precedente vs Admin API
  let shopifyChecked = 0, shopifyMismatch = 0, shopifyErr = 0; const shopDetails: string[] = [];
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
        if (!r.ok) { shopifyErr++; continue; }  // NON ingoiare: un token morto deve accendere ce_shopify_token (A10)
        const apiCount = (await r.json()).count ?? 0;
        const { count: dbCount } = await sb.from('shopify_orders').select('*', { count: 'exact', head: true }).eq('year', y).eq('month', m);
        shopifyChecked++;
        if (apiCount !== (dbCount ?? 0)) { shopifyMismatch++; shopDetails.push(`${y}-${m}: api=${apiCount} db=${dbCount}`); }
      } catch { shopifyErr++; }
    }
  } else { shopifyErr = 1; }
  add('ce_shopify_reconcile', `Riconciliazione ordini vs Shopify API (${shopifyChecked} mesi)` + (shopDetails.length ? ': ' + shopDetails.join(', ') : ''), shopifyMismatch);
  // token/connessione Shopify: se l'API non risponde o il token e' assente/morto, l'intera pipeline
  // Shopify (sync ordini, stock, autopush) e' cieca ma tutti i cron restano verdi. Questo lo accende.
  add('ce_shopify_token', 'Chiamate Shopify fallite (token assente/scaduto o API giu)', shopifyErr);

  // 9) freschezza sync: se lo stock Shopify non si aggiorna da >2h, un cron/edge e' morto in silenzio (A10)
  const { data: freshRow } = await sb.from('shopify_stock').select('synced_at').order('synced_at', { ascending: false }).limit(1);
  const lastSync = freshRow?.[0]?.synced_at ? new Date(freshRow[0].synced_at as string).getTime() : 0;
  const staleMin = lastSync ? Math.round((now.getTime() - lastSync) / 60000) : 99999;
  add('ce_sync_freshness', `Ultimo sync stock Shopify: ${staleMin} min fa (atteso <120)`, staleMin > 120 ? staleMin : 0);

  // 10) COLLEGAMENTO app <-> Shopify (3 sentinelle, brief 29-07, caso LEA BAG BLACK & WHITE PONY).
  // Il guasto: una scheda ACTIVE con SKU su un codice DIVERSO ma ancora a catalogo (doppione storico
  // a giacenza 0). In shopify-stock la mappatura va prima per SKU e usa l'alias del titolo SOLO se lo
  // SKU non matcha nessun codice: con uno SKU che matcha un codice vero l'alias non entra mai in gioco,
  // l'autopush spinge la disponibilita' del codice fantasma (0) e il codice vero non ha nemmeno una
  // riga in shopify_stock. Silenzioso da aprile a fine luglio: non e' unmapped, il push riesce, le
  // vendite arrivano corrette dal resolver per NOME di shopify-sync. Qui le sentinelle.
  // SOLO LETTURE: nessun SKU viene corretto da qui (una auto-correzione su un mismatch mal
  // interpretato sposterebbe lo stock del prodotto sbagliato). La correzione e' un gesto umano.
  // La normalizzazione deve restare IDENTICA a quella di shopify-stock (`norm`, riga 8 di quella
  // funzione: s.toUpperCase().replace(/\s+/g,'_')), altrimenti il check e' cieco proprio sui titoli
  // con spazi doppi. Se una cambia, cambiano entrambe.
  const norm = (s: string | null | undefined) => (s ? s.toUpperCase().replace(/\s+/g, '_') : '');
  const { data: stockRows } = await sb.from('shopify_stock').select('codice, shopify_title, shopify_status');
  const { data: aliasRows } = await sb.from('product_aliases').select('shopify_name_norm, codice');
  // Map e non join SQL: product_aliases ha shopify_name_norm duplicati (14 al 29-07) e un join
  // moltiplicherebbe le righe, gonfiando i conteggi. Una entry per titolo, come fa shopify-stock.
  const aliasByTitle = new Map((aliasRows ?? []).map((r) => [r.shopify_name_norm as string, r.codice as string]));
  const invByNorm = new Map((inv ?? []).map((r) => [norm(r.codice as string), r]));
  // Confronti case-insensitive: gli SKU legacy in Title_Case sono validi per scelta (Regola Ferrea 4,
  // i join passano da codice_norm), quindi una differenza di solo maiuscole NON e' un mismatch.

  // A) sku_mismatch: lo SKU aggancia un codice diverso da quello suggerito dall'alias sul titolo.
  const mism = (stockRows ?? []).filter((s) => {
    const fromTitle = aliasByTitle.get(norm(s.shopify_title as string));
    return !!fromTitle && !!s.codice && norm(fromTitle) !== norm(s.codice as string);
  });
  const mismActive = mism.filter((s) => s.shopify_status === 'active');
  // n = le sole ACTIVE (quelle azionabili): una draft non e' vendibile e non deve tenere acceso un
  // warn perenne, come il bucket `untracked` di shopify-stock. Il totale sta nell'etichetta.
  const mismEx = [...mismActive, ...mism.filter((s) => s.shopify_status !== 'active')].slice(0, 2)
    .map((s) => `"${s.shopify_title}": SKU->${s.codice}, titolo->${aliasByTitle.get(norm(s.shopify_title as string))}`);
  // quante ACTIVE non hanno alias sul titolo: su quelle il check A non puo' pronunciarsi (copertura).
  const noAlias = (stockRows ?? []).filter((s) => s.shopify_status === 'active' && !aliasByTitle.has(norm(s.shopify_title as string))).length;
  add('ce_sku_mismatch',
    `SKU Shopify agganciato al codice sbagliato: ${mism.length} schede, ${mismActive.length} attive`
    + (mismEx.length ? ' · ' + mismEx.join(' | ') : '')
    + (noAlias ? ` (${noAlias} attive senza alias sul titolo: non confrontabili)` : ''),
    mismActive.length, 'warn');

  // B) sku_unmapped_active: scheda ACTIVE il cui codice risolto non esiste a catalogo -> realign_all
  // la mette nel bucket `unmapped` e la SALTA senza alzare severity (giusto per le ~88 draft/archived
  // del vecchio catalogo, sbagliato per una scheda viva: quel prodotto non riceve mai stock).
  // Nota: si guarda il codice RISOLTO, non lo SKU grezzo (shopify_stock non lo conserva). Uno SKU
  // sbagliato ma recuperato dall'alias del titolo finisce sul codice giusto: lo stock va dove deve,
  // quindi non e' un guasto e non compare qui. Per scelta: qui stanno solo le schede che NON ricevono stock.
  const unmapped = (stockRows ?? []).filter((s) => s.shopify_status === 'active' && !invByNorm.has(norm(s.codice as string)));
  add('ce_sku_unmapped_active',
    `Schede Shopify attive con codice non a catalogo (stock mai spinto): ${unmapped.length}`
    + (unmapped.length ? ' · ' + unmapped.slice(0, 2).map((s) => `"${s.shopify_title}" (${s.codice ?? 'nessun codice'})`).join(' | ') : ''),
    unmapped.length, 'warn');

  // C) stock_senza_scheda: merce disponibile che il sito non puo' vendere. INFORMATIVO, mai warn:
  // spesso e' una scelta di catalogo (prodotto mai pubblicato) e un warn qui sarebbe perenne.
  // Unico posto dove n > 0 con severity 'ok' e' voluto: e' un contatore, non un allarme.
  const { data: ignFlag } = await sb.from('app_flags').select('value').eq('key', 'ceguard_no_shopify_ignore').maybeSingle();
  const ignore = new Set(String(ignFlag?.value ?? '').split(',').map((c) => norm(c.trim())).filter(Boolean));
  const stockCodici = new Set((stockRows ?? []).map((s) => norm(s.codice as string)));
  const senzaScheda = (inv ?? []).filter((r) => N(r.disponibili_da_vendere) > 0 && !stockCodici.has(norm(r.codice as string)) && !ignore.has(norm(r.codice as string)));
  const pezzi = senzaScheda.reduce((t, r) => t + N(r.disponibili_da_vendere), 0);
  checks.push({
    k: 'ce_stock_senza_scheda',
    label: `Merce disponibile senza scheda Shopify: ${senzaScheda.length} codici, ${pezzi} pezzi (informativo)`
      + (senzaScheda.length ? ' · es. ' + senzaScheda.slice(0, 2).map((r) => `${r.codice} (${N(r.disponibili_da_vendere)})`).join(', ') : ''),
    n: senzaScheda.length,
    severity: 'ok',
  });

  // scrivi in health_log (sostituisce le chiavi ce_* di oggi)
  const today = now.toISOString().slice(0, 10);
  await sb.from('health_log').delete().eq('day', today).like('k', 'ce_%');
  await sb.from('health_log').insert(checks.map((c) => ({ day: today, ...c })));

  const problems = checks.filter((c) => c.severity !== 'ok');

  // NOTIFICHE ATTIVE (ntfy, 2026-07-09): al CAMBIO dell'insieme dei problemi ERROR manda una push
  // al topic ntfy del titolare (app sul telefono). "Solo su cambio" = niente spam orario; la firma
  // e' l'insieme delle CHIAVI error (non i conteggi) per non pingare sui flap di conteggio. Il topic
  // vive in app_flags.ntfy_topic (service-role); se assente -> no-op. Mai rompere la guardia.
  try {
    const { data: tf } = await sb.from('app_flags').select('value').eq('key', 'ntfy_topic').maybeSingle();
    const topic = tf?.value as string | undefined;
    if (topic) {
      const errs = checks.filter((c) => c.severity === 'error');
      const sig = errs.map((c) => c.k).sort().join(',');
      const { data: lf } = await sb.from('app_flags').select('value').eq('key', 'ceguard_alert_state').maybeSingle();
      const prev = (lf?.value as string | undefined) ?? '';
      if (sig !== prev) {
        const hasProblems = sig !== '';
        const title = hasProblems ? `Amimi: ${errs.length} da controllare` : 'Amimi: tutto a posto';
        const message = hasProblems ? errs.map((c) => '- ' + c.label).join('\n') : 'I problemi segnalati sono rientrati.';
        await fetch('https://ntfy.sh', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, title, message, priority: hasProblems ? 4 : 3, tags: [hasProblems ? 'warning' : 'white_check_mark'], click: 'https://noobhandbag.github.io/amimi-app/' }),
        });
        await sb.from('app_flags').upsert({ key: 'ceguard_alert_state', value: sig }, { onConflict: 'key' });
      }
    }
  } catch (_e) { /* la notifica non deve mai rompere la guardia contabile */ }

  return json({ ok: true, all_green: problems.length === 0, checks, problems });
});
