// shipping-status-sync v1 (2026-08-01, brief stato_tws_in_app) — ingest dello stato TWS per LDV.
// Canale di scrittura sanzionato della tabella `shipping_status` (migr 0086): il sync spedizioni
// (Apps Script SyncShopify.gs, trigger orario) a fine giro POSTa il batch degli stati correnti.
// Scelta di review dichiarata: edge DEDICATA PIN-gated (stile qromo-webhook) e NON un'azione
// write-api, per non toccare una edge viva da 60k char per della telemetria (Regola Ferrea 19:
// edge nuove, mai innesti in quelle vive; shipping_status non tocca CE/stock/vendite, quindi
// come per cs_*/loyalty_* la edge protetta E' il canale controllato, nota della Regola 13).
//
// Azione unica: { pin, stati: [{ order_name, ldv, stato, stato_raw?, date? }] } (cap 300).
//   - upsert idempotente su ldv: re-POST identico = 0 aggiornamenti;
//   - stato normalizzato UPPERCASE/trim in `stato_tws`, originale in `stato_raw`;
//   - delivered_at: alla PRIMA osservazione di CONSEGNATA si fissa alla data corrente
//     Europe/Rome (APPROSSIMAZIONE dichiarata: TWS non espone la data di consegna nel getList);
//   - telemetria: health_log 'shipping_status' (replace giornaliero) sempre; change_log UNA riga
//     per run SOLO se qualcosa e' cambiato (conteggi, mai una riga per LDV: alta frequenza).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const MAX_BATCH = 300;
// data corrente in Europe/Rome (per delivered_at alla prima CONSEGNATA osservata)
const todayRome = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
// TWS date "dd-MM-yyyy" -> ISO; null se non parsabile (mai inventare date)
const twsDateToIso = (d: string): string | null => {
  const m = (d || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

type StatoIn = { order_name?: unknown; ldv?: unknown; stato?: unknown; stato_raw?: unknown; date?: unknown };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg } = await sb.from('app_config').select('pin_hash').eq('id', 1).single();
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);

  const stati = Array.isArray(body.stati) ? (body.stati as StatoIn[]).slice(0, MAX_BATCH) : [];
  if (!stati.length) return json({ error: 'stati vuoto' }, 422);

  // stato corrente gia' a DB per confrontare (aggiornati = cambi VERI, non upsert ciechi)
  const ldvs = stati.map((s) => String(s.ldv ?? '').trim()).filter(Boolean);
  const { data: existing } = await sb.from('shipping_status').select('ldv,stato_tws,delivered_at').in('ldv', ldvs);
  const exByLdv = new Map<string, { stato_tws: string; delivered_at: string | null }>();
  for (const e of (existing ?? []) as { ldv: string; stato_tws: string; delivered_at: string | null }[]) exByLdv.set(e.ldv, e);

  let nuovi = 0, aggiornati = 0, invariati = 0, scartati = 0; const errors: string[] = [];
  for (const s of stati) {
    const ldv = String(s.ldv ?? '').trim();
    const orderName = String(s.order_name ?? '').trim();
    const statoRaw = String(s.stato ?? '').trim();
    const stato = statoRaw.toUpperCase().replace(/\s+/g, ' ');
    if (!ldv || !orderName || !stato) { scartati++; continue; }   // senza ordine non serve a cs-assist
    const ex = exByLdv.get(ldv);
    if (ex && ex.stato_tws === stato) { invariati++; continue; }   // idempotente: nessun update
    const row: Record<string, unknown> = {
      ldv, order_name: orderName.startsWith('#') ? orderName : '#' + orderName,
      stato_tws: stato, stato_raw: String(s.stato_raw ?? statoRaw) || null,
      updated_at: new Date().toISOString(),
    };
    // shipped_date solo se il batch la porta: un POST senza data non azzera quella gia' salvata
    const iso = twsDateToIso(String(s.date ?? ''));
    if (iso) row.shipped_date = iso;
    // prima osservazione di CONSEGNATA -> delivered_at = oggi Roma (approssimazione dichiarata);
    // mai sovrascrivere un delivered_at gia' fissato
    if (stato.startsWith('CONSEGNATA') && !ex?.delivered_at) row.delivered_at = todayRome();
    const { error } = await sb.from('shipping_status').upsert(row, { onConflict: 'ldv' });
    if (error) { errors.push(ldv + ':' + error.message.slice(0, 60)); continue; }
    if (ex) aggiornati++; else nuovi++;
  }

  const today = new Date().toISOString().slice(0, 10);
  await sb.from('health_log').delete().eq('day', today).eq('k', 'shipping_status');
  await sb.from('health_log').insert({
    day: today, k: 'shipping_status', n: nuovi + aggiornati,
    label: `batch ${stati.length}: ${nuovi} nuovi, ${aggiornati} aggiornati, ${invariati} invariati`,
    severity: errors.length ? 'warn' : 'ok', created_at: new Date().toISOString(),
  });
  if (nuovi + aggiornati > 0) {
    await sb.from('change_log').insert({
      tbl: 'shipping_status', row_id: 'batch', op: 'shipping_status_sync', chi: 'ship-sync', source: 'shipping-status-sync',
      after: { batch: stati.length, nuovi, aggiornati, invariati, scartati, errori: errors.length },
    });
  }
  return json({ ok: true, batch: stati.length, nuovi, aggiornati, invariati, scartati, ...(errors.length ? { errors: errors.slice(0, 10) } : {}) });
});
