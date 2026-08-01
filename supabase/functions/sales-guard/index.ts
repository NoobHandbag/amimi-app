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
  const { data: frows } = await sb.from('app_flags').select('key,value').in('key', ['sales_guard_enabled', 'ntfy_topic_sales', 'ntfy_topic', 'sales_guard_alert_state']);
  for (const r of frows ?? []) flags[r.key] = r.value ?? '';
  const source = String(body.source || 'manual');
  if (source === 'cron' && flags.sales_guard_enabled !== 'true') return json({ ok: true, skipped: 'disabled' });
  const dryRun = body.dryRun === true;

  const { data: ruleRows } = await sb.from('alert_rules').select('metrica,soglia,finestra_giorni,severity,attivo');
  const rules = new Map<string, { soglia: number; finestra: number; severity: string; attivo: boolean }>();
  for (const r of (ruleRows ?? []) as Row[]) rules.set(String(r.metrica), { soglia: Number(r.soglia), finestra: Number(r.finestra_giorni), severity: String(r.severity), attivo: r.attivo === true });

  const checks: Check[] = [];

  // S1: zero ordini nelle ultime 24 ORE (rolling, non giorno di calendario: alle 07:45 il giorno
  // corrente e' appena iniziato e non deve fare rumore)
  const r1 = rules.get('sales_zero_ordini');
  if (r1?.attivo) {
    const { count } = await sb.from('shopify_orders').select('order_id', { count: 'exact', head: true })
      .gte('created_at_shop', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    const n = count ?? 0;
    checks.push(n <= r1.soglia
      ? { k: 'sales_zero_ordini', label: `ZERO ordini nelle ultime 24 ore: probabile guasto (checkout, dominio, pagamenti), mai successo in 90 giorni`, n: 1, severity: 'error' }
      : { k: 'sales_zero_ordini', label: `${n} ordini nelle ultime 24 ore`, n: 0, severity: 'ok' });
  }

  // S2-S5: le liste correnti arrivano dalla vista (stesse soglie di alert_rules, un solo posto)
  const { data: anom } = await sb.from('v_sales_anomalie').select('tipo,codice,dettaglio,valore');
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

  // scrivi in health_log (sostituisce le chiavi sales_* di oggi; refresh_health_log le esclude, migr 0087)
  const today = new Date().toISOString().slice(0, 10);
  await sb.from('health_log').delete().eq('day', today).like('k', 'sales\\_%');
  const { error: insErr } = await sb.from('health_log').insert(checks.map((c) => ({ day: today, ...c })));
  if (insErr) return json({ ok: false, error: insErr.message }, 500);

  // push ntfy SOLO al cambio dell'insieme degli ERROR (pattern ce-guard, stato dedicato).
  // Topic dedicato ntfy_topic_sales, fallback su ntfy_topic; assente -> no-op. Mai rompere la guardia.
  let notified = false;
  try {
    const topic = (flags.ntfy_topic_sales || flags.ntfy_topic || '').trim();
    if (topic) {
      const errs = checks.filter((c) => c.severity === 'error').map((c) => c.k).sort();
      const sig = errs.join(',');
      const last = flags.sales_guard_alert_state ?? '';
      if (sig !== last) {
        const title = errs.length ? 'Vendite: serve un occhio' : 'Vendite: rientrato, tutto ok';
        const msg = errs.length ? checks.filter((c) => c.severity === 'error').map((c) => c.label).join('\n') : 'I problemi segnalati sono rientrati.';
        await fetch('https://ntfy.sh', {
          method: 'POST',
          body: JSON.stringify({ topic, title, message: msg.slice(0, 800), priority: errs.length ? 5 : 3, tags: [errs.length ? 'rotating_light' : 'white_check_mark'] }),
          headers: { 'Content-Type': 'application/json' },
        });
        await sb.from('app_flags').upsert({ key: 'sales_guard_alert_state', value: sig }, { onConflict: 'key' });
        notified = true;
      }
    }
  } catch { /* la notifica non deve mai rompere la guardia */ }

  return json({ ok: true, checks, notified });
});
