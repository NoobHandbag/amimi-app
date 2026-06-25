// write-api — the ONLY write path into the replica.
// Public anon key is read-only (writes revoked). PIN-gated; uses the service-role key to write,
// logging every change to change_log. Handles inserts + the special 'arrival' flow.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const TABLES: Record<string, string> = {
  purchase: 'purchases', count: 'counts', gift: 'gifts_offline', b2b: 'b2b_movements',
  product: 'products', order: 'supplier_orders',
};
const noSpaces = (s: unknown) => typeof s === 'string' && s.length > 0 && !/\s/.test(s);

function validate(action: string, p: Record<string, unknown>): string[] {
  const e: string[] = [];
  const codice = p.codice as string | undefined;
  const reqCodice = () => {
    if (!codice) e.push('CODICE mancante');
    else if (!noSpaces(codice)) e.push('CODICE contiene spazi — usa underscore');
  };
  const qty = Number(p.quantita);
  if (action === 'purchase') {
    reqCodice();
    if (!(qty > 0)) e.push('quantità deve essere > 0');
    if (p.costo_unitario != null && Number(p.costo_unitario) < 0) e.push('costo unitario negativo');
    if (!p.data) e.push('data mancante');
  } else if (action === 'count') {
    reqCodice();
    if (p.contati == null || Number(p.contati) < 0) e.push('pezzi contati non validi');
  } else if (action === 'gift') {
    reqCodice();
    if (!(qty > 0)) e.push('quantità deve essere > 0');
  } else if (action === 'b2b') {
    reqCodice();
    if (!(qty > 0)) e.push('quantità deve essere > 0');
    if (!['invio', 'reso', 'venduto'].includes(String(p.tipo_movimento))) e.push('tipo_movimento non valido');
    if (!['conto_vendita', 'wholesale'].includes(String(p.modello))) e.push('modello non valido');
  } else if (action === 'product') {
    reqCodice();
    if (codice && /_$/.test(codice)) e.push('CODICE non finalizzato (termina con _)');
  } else if (action === 'order') {
    reqCodice();
    if (!(Number(p.qty_ordered) > 0)) e.push('quantità ordinata deve essere > 0');
  }
  return e;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: { action?: string; payload?: Record<string, unknown>; pin?: string; chi?: string };
  try { body = await req.json(); } catch { return json({ error: 'JSON non valido' }, 400); }
  const { action = '', payload = {}, pin = '', chi = '' } = body;

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg } = await sb.from('app_config').select('pin_hash').eq('id', 1).single();
  const ok = cfg?.pin_hash && pin && (await sha256hex(String(pin))) === cfg.pin_hash;
  if (!ok) return json({ error: 'PIN errato' }, 401);

  const today = new Date().toISOString().slice(0, 10);

  // --- special: mark an arrival against a supplier order (updates order + creates a purchase) ---
  if (action === 'arrival') {
    const oid = payload.order_id as string;
    const qty = Number(payload.qty);
    if (!oid || !(qty > 0)) return json({ error: 'arrivo non valido' }, 422);
    const { data: ord } = await sb.from('supplier_orders').select('*').eq('id', oid).single();
    if (!ord) return json({ error: 'ordine non trovato' }, 404);
    const newArr = Number(ord.qty_arrived) + qty;
    const { error: ue } = await sb.from('supplier_orders').update({ qty_arrived: newArr, data_ultimo_arrivo: today }).eq('id', oid);
    if (ue) return json({ error: ue.message }, 400);
    const { data: pur } = await sb.from('purchases').insert({
      codice: ord.codice, item: ord.item, variant: ord.variant, categoria: 'BAG',
      tipologia: 'Prodotto Finito', unita_misura: 'Pezzi', quantita: qty, data: today,
      fornitore: ord.fornitore, source: 'app-arrivo', chi: chi || null,
    }).select().single();
    await sb.from('change_log').insert({ tbl: 'supplier_orders', row_id: String(oid), op: 'arrival', after: { codice: ord.codice, qty, arrived: newArr }, chi: chi || null, source: 'write-api' });
    return json({ ok: true, arrived: newArr, ordered: ord.qty_ordered, purchase_id: pur?.id });
  }

  // --- generic insert (incl. 'order') ---
  const table = TABLES[action];
  if (!table) return json({ error: 'azione sconosciuta: ' + action }, 400);

  const errs = validate(action, payload);
  if (errs.length) return json({ error: errs.join(' · '), validation: errs }, 422);

  const row = { ...payload, source: 'app', chi: chi || null };
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) return json({ error: error.message }, 400);

  await sb.from('change_log').insert({
    tbl: table, row_id: String(data.id), op: 'insert', after: data, chi: chi || null, source: 'write-api',
  });
  return json({ ok: true, id: data.id, row: data });
});
