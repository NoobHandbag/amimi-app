// sales-guard v3 (2026-09-14, audit gate B13/B60): verdetti in health_log con UN upsert controllato su (day,k) al posto
// di delete non controllata + insert (un 504 sulla delete faceva fallire l'insert sull'unique, il giorno restava senza
// righe sales_*); fallito -> 500 e niente ntfy. Prune controllato (non fatale) delle chiavi sales_* non piu' nell'insieme.
// Risposta di ntfy controllata: sales_guard_alert_state e `notified` solo a push consegnata, altrimenti `ntfy_failed`.
// sales-guard v1 (2026-08-01, brief sales_guard_alerts A7) — la guardia delle VENDITE.
// ce-guard sorveglia i conti, questa sorveglia le vendite: SOLO segnali deterministici e
// azionabili, NIENTE anomaly detection sugli aggregati (scarto tipo settimanale 57%: qualunque
// soglia sul totale suonerebbe in continuazione, misura del 31-07 nel brief).
//
// Cron GIORNALIERO (sales-guard-daily 05:45 UTC, migr 0087; NB ce-guard malgrado il nome gira
// ORARIO, schedule NON copiato per design). Flag `sales_guard_enabled` default false: a flag
// spento il giro cron e' NO-OP; una run MANUALE (senza source=cron) gira comunque per test.
//
// Segnali (soglie in `alert_rules`, MAI hardcoded; tarate sul backtest 90gg del 01-08):
//   S1 sales_zero_ordini      error  ordini nelle ultime 24 ORE = 0 (0/90 nel backtest: quando
//                                    accade di solito e' il checkout rotto, non il mercato).
//                                    UNICO segnale che fa push ntfy, al CAMBIO di stato.
//   S2 sales_best_seller_fermo warn  aggregato: codici con >= soglia pezzi nei 30gg precedenti,
//                                    zero negli ultimi 14, disponibili > 0 (1,17 accensioni/sett).
//   S3 sales_low_stock         warn  aggregato: giorni_stock <= soglia E velocita' sopra mediana
//                                    (riusa v_reorder, non ricalcola).
//   S4 sales_esaurito_pubblicato info aggregato: conteggio pubblicato_esaurito (un solo numero).
//   S5 sales_sconto_anomalo    warn  usi di un codice sconto oltre soglia nella finestra.
// S2-S5 vivono in health_log (banner app + dashboard) e NON fanno mai push: il budget "max ~2
// accensioni/settimana" del brief vale per cio' che suona, e a suonare e' solo S1.
// Le liste correnti di S2/S3/S4/S5 si ispezionano a mano in `v_sales_anomalie` (migr 0087).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// 2026-09-13 (sweep incidente doppioni): PostgREST risponde 504 su ~4% delle letture delle edge (Regola Ferrea 20).
// Una lettura e' idempotente: UN solo ritentativo dopo 1,5 s, poi la guardia si ferma a vuoto (mai su insert/update/delete).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn();
  if (!r.error) return r;
  await sleep(1500);
  return await fn();
};

type Row = Record<string, unknown>;
type Check = { k: string; label: string; n: number; severity: 'ok' | 'warn' | 'error' | 'info' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg } = await sb.from('app_config').select('pin_hash').eq('id', 1).single();
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);
  const action = String(body.action || 'run');
  if (action !== 'run') return json({ error: 'azione sconosciuta: ' + action }, 422);

  const flags: Record<string, string> = {};
  // 2026-09-13 (sweep incidente doppioni): flag non letti = guardia che si crede spenta e non gira, in silenzio
  const { data: frows, error: frowsErr } = await retryOnce(() => sb.from('app_flags').select('key,value').in('key', ['sales_guard_enabled', 'ntfy_topic_sales', 'ntfy_topic', 'sales_guard_alert_state']));
  if (frowsErr) return json({ ok: false, error: 'lettura app_flags fallita, guardia non valutata: ' + frowsErr.message }, 503);
  for (const r of frows ?? []) flags[r.key] = r.value ?? '';
  const source = String(body.source || 'manual');
  if (source === 'cron' && flags.sales_guard_enabled !== 'true') return json({ ok: true, skipped: 'disabled' });
  const dryRun = body.dryRun === true;

  // 2026-09-13 (sweep incidente doppioni): lettura fallita = zero checks, righe sales_* di oggi cancellate e non
  // rimpiazzate, push falso "rientrato": si esce PRIMA di toccare health_log/app_flags/ntfy.
  const { data: ruleRows, error: rulesErr } = await retryOnce(() => sb.from('alert_rules').select('metrica,soglia,finestra_giorni,severity,attivo'));
  if (rulesErr) return json({ ok: false, error: 'lettura alert_rules fallita, guardia non valutata: ' + rulesErr.message }, 503);
  const rules = new Map<string, { soglia: number; finestra: number; severity: string; attivo: boolean }>();
  for (const r of (ruleRows ?? []) as Row[]) rules.set(String(r.metrica), { soglia: Number(r.soglia), finestra: Number(r.finestra_giorni), severity: String(r.severity), attivo: r.attivo === true });

  const checks: Check[] = [];

  // S1: zero ordini nelle ultime 24 ORE (rolling, non giorno di calendario: alle 07:45 il giorno
  // corrente e' appena iniziato e non deve fare rumore)
  const r1 = rules.get('sales_zero_ordini');
  if (r1?.attivo) {
    // 2026-09-13 (sweep incidente doppioni): count fallito era letto come 0 ordini = push priorita' 5 falso + stato alert ribaltato.
    const { count, error: cntErr } = await retryOnce(() => sb.from('shopify_orders').select('order_id', { count: 'exact', head: true })
      .gte('created_at_shop', new Date(Date.now() - 24 * 3600 * 1000).toISOString()));
    if (cntErr) return json({ ok: false, error: 'conteggio shopify_orders fallito, guardia non valutata: ' + cntErr.message }, 503);
    const n = count ?? 0;
    checks.push(n <= r1.soglia
      ? { k: 'sales_zero_ordini', label: `ZERO ordini nelle ultime 24 ore: probabile guasto (checkout, dominio, pagamenti), mai successo in 90 giorni`, n: 1, severity: 'error' }
      : { k: 'sales_zero_ordini', label: `${n} ordini nelle ultime 24 ore`, n: 0, severity: 'ok' });
  }

  // S2-S5: le liste correnti arrivano dalla vista (stesse soglie di alert_rules, un solo posto)
  // 2026-09-13 (sweep incidente doppioni): lettura fallita = liste vuote = S2-S5 tutti "ok" a vuoto in health_log.
  const { data: anom, error: anomErr } = await retryOnce(() => sb.from('v_sales_anomalie').select('tipo,codice,dettaglio,valore'));
  if (anomErr) return json({ ok: false, error: 'lettura v_sales_anomalie fallita, guardia non valutata: ' + anomErr.message }, 503);
  const byTipo = new Map<string, Row[]>();
  for (const a of (anom ?? []) as Row[]) {
    const t = String(a.tipo);
    if (!byTipo.has(t)) byTipo.set(t, []);
    byTipo.get(t)!.push(a);
  }
  const agg = (metrica: string, tipo: string, labelOk: string, labelSome: (n: number, top: string) => string) => {
    const r = rules.get(metrica);
    if (!r?.attivo) return;
    const rows = byTipo.get(tipo) ?? [];
    const top = rows.slice(0, 3).map((x) => String(x.codice)).join(', ');
    checks.push(rows.length
      ? { k: metrica, label: labelSome(rows.length, top), n: rows.length, severity: r.severity as Check['severity'] }
      : { k: metrica, label: labelOk, n: 0, severity: 'ok' });
  };
  agg('sales_best_seller_fermo', 'best_seller_fermo', 'nessun best seller fermo',
    (n, top) => `${n} best seller con stock ma FERMI da 14 giorni (vendevano prima): ${top}${n > 3 ? '…' : ''} — controllare scheda/foto/prezzo (dettaglio in v_sales_anomalie)`);
  agg('sales_low_stock', 'low_stock', 'nessun codice veloce sotto soglia stock',
    (n, top) => `${n} codici che vendono sopra la mediana con <= 14 giorni di stock: ${top}${n > 3 ? '…' : ''} (riordino? dettaglio in v_sales_anomalie)`);
  agg('sales_esaurito_pubblicato', 'esaurito_pubblicato', 'nessun esaurito pubblicato',
    (n) => `${n} schede pubblicate su Shopify ma esaurite: traffico che non converte (dettaglio in v_sales_anomalie)`);
  agg('sales_sconto_anomalo', 'sconto_anomalo', 'nessun codice sconto oltre soglia',
    (n, top) => `${n} codici sconto oltre soglia d'uso: ${top} — verificare che non sia un leak (dettaglio in v_sales_anomalie)`);

  if (dryRun) return json({ ok: true, dryRun: true, checks });

  // scrivi in health_log: UN upsert controllato su (day,k), indice unico health_log_day_k (refresh_health_log esclude
  // le sales_*, migr 0087). 2026-09-14 (audit gate, B13): prima delete NON controllata + insert: un 504 sulla delete
  // faceva fallire l'insert intero (unique) e il giorno restava senza righe sales_*. Scrittura fallita = 500 e NIENTE
  // ntfy: i verdetti precedenti restano. Niente retry: e' una scrittura (Regola Ferrea 20).
  const today = new Date().toISOString().slice(0, 10);
  const { error: insErr } = await sb.from('health_log').upsert(checks.map((c) => ({ day: today, ...c })), { onConflict: 'day,k' });
  if (insErr) return json({ ok: false, error: 'health_log non scrivibile: ' + insErr.message }, 500);
  // chiavi sales_* di oggi non piu' nell'insieme (regola disattivata in alert_rules): pulizia controllata, non fatale.
  // Con zero checks (tutte le regole spente) si cancellano tutte, senza passare un `in.()` vuoto a PostgREST.
  const keep = checks.map((c) => c.k);
  const prune = sb.from('health_log').delete().eq('day', today).like('k', 'sales\\_%');
  const { error: staleErr } = await (keep.length ? prune.not('k', 'in', `(${keep.join(',')})`) : prune);

  // push ntfy SOLO al cambio dell'insieme degli ERROR (pattern ce-guard, stato dedicato).
  // Topic dedicato ntfy_topic_sales, fallback su ntfy_topic; assente -> no-op. Mai rompere la guardia.
  // 2026-09-14 (audit gate, B60): la risposta di ntfy non era controllata: un 429/5xx perdeva la push ma lo stato
  // veniva aggiornato come se fosse partita, e S1 non suonava piu' fino al prossimo cambio. Stato e `notified` SOLO
  // a push consegnata (res.ok); altrimenti `ntfy_failed` in risposta e il giro dopo riprova.
  let notified = false; let ntfyFailed: number | null = null; let ntfyError: string | null = null;
  try {
    const topic = (flags.ntfy_topic_sales || flags.ntfy_topic || '').trim();
    if (topic) {
      const errs = checks.filter((c) => c.severity === 'error').map((c) => c.k).sort();
      const sig = errs.join(',');
      const last = flags.sales_guard_alert_state ?? '';
      if (sig !== last) {
        const title = errs.length ? 'Vendite: serve un occhio' : 'Vendite: rientrato, tutto ok';
        const msg = errs.length ? checks.filter((c) => c.severity === 'error').map((c) => c.label).join('\n') : 'I problemi segnalati sono rientrati.';
        const res = await fetch('https://ntfy.sh', {
          method: 'POST',
          body: JSON.stringify({ topic, title, message: msg.slice(0, 800), priority: errs.length ? 5 : 3, tags: [errs.length ? 'rotating_light' : 'white_check_mark'] }),
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          await sb.from('app_flags').upsert({ key: 'sales_guard_alert_state', value: sig }, { onConflict: 'key' });
          notified = true;
        } else ntfyFailed = res.status;
      }
    }
  } catch (e) { ntfyError = e instanceof Error ? e.message : String(e); /* la notifica non deve mai rompere la guardia */ }

  return json({
    ok: true, checks, notified,
    ...(staleErr ? { stale_keys_error: staleErr.message } : {}),
    ...(ntfyFailed !== null ? { ntfy_failed: ntfyFailed } : {}),
    ...(ntfyError ? { ntfy_error: ntfyError } : {}),
  });
});
