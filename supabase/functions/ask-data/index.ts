// ask-data — FLOW 6. Natural-language question -> SQL (Gemini) -> guarded SELECT (ask_select RPC).
// Gemini key in app_flags.gemini_api_key (server-only). PIN-gated. Read-only, capped at 200 rows.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const SCHEMA = `
Postgres (Italian handbag business "Amimì"). Answer with ONE read-only SELECT.
Key relations:
- v_inventory(codice, item, variant, categoria, giacenza_attuale, disponibili_da_vendere, valore, retail_price, cogs, last_sale, on_shopify, shopify_sold, qromo_sold, b2b_venduto)
- v_ce_amimi_summary(year, month, omni_netto, online_netto, offline_netto, b2b_netto, cogs, mc1, mc2)  -- Amimì brand P&L; sales start month 2
- ce_totale_monthly(year, month, lordo, netto, mc1, mc2, online_netto, offline_netto)  -- whole-business P&L incl. January
- qromo_sales(data date, codice, item, variant, quantita, prezzo, nome, cognome, year, month)  -- offline/POS sales
- shopify_orders(order_id, created_at_shop, customer_name, gross_total, net_total, discount_total, year, month)
- shopify_line_items(order_id, codice, lineitem_name, quantita, price, year, month)  -- online sales lines
- purchases(data date, codice, item, variant, quantita, costo_unitario, costo_totale, fornitore)
- supplier_orders(fornitore, codice, item, variant, qty_ordered, qty_arrived, data_ordine, data_consegna)
- expenses(date_paid date, operazione, costo, categoria, amimi boolean, status, year, month)  -- costo is NEGATIVE
- gifts_offline(data date, codice, nome, cognome, quantita)
- products(codice, item, variant, categoria, retail_price, cogs, verificato)
- suppliers(name), negozi(name)
Rules: prices are VAT-inclusive (netto = lordo/1.22, IVA 22%). expenses.costo is negative. Money is EUR.
products.categoria values are exactly: BAG, PELLE, TESSUTO, ACCESSORI, ALTRO (BAG = le borse). Do NOT ILIKE '%borsa%'.
For "quante borse / pezzi in magazzino" use SUM(giacenza_attuale) from v_inventory (optionally where categoria='BAG').
For best-sellers / units sold per product, prefer v_inventory columns shopify_sold + qromo_sold + b2b_venduto (no need to re-aggregate the sales tables).
Current year 2026. Use ILIKE for free-text names. Prefer the views. One SELECT only, no semicolons, no comments.
Return ONLY the SQL, no markdown, no explanation.`;

function cleanSql(t: string): string {
  let s = (t || '').trim();
  s = s.replace(/^```(sql)?/i, '').replace(/```$/,'').trim();
  s = s.replace(/;+\s*$/, '').trim();
  return s;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cfg } = await sb.from('app_config').select('pin_hash').eq('id', 1).single();
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);

  const question = String(body.question || '').trim();
  if (!question) return json({ error: 'domanda mancante' }, 422);

  const { data: flag } = await sb.from('app_flags').select('value').eq('key', 'gemini_api_key').single();
  const key = flag?.value;
  if (!key) return json({ error: 'Gemini non configurato. Aggiungi la chiave in app_flags.gemini_api_key.', needs_key: true }, 200);

  // 1) NL -> SQL via Gemini
  let sql = '';
  try {
    const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${SCHEMA}\n\nDomanda: ${question}\nSQL:` }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 400 },
      }),
    });
    const gj = await g.json();
    if (!g.ok) return json({ error: 'Gemini ' + g.status, detail: JSON.stringify(gj).slice(0, 300) }, 502);
    sql = cleanSql(gj?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
  } catch (e) { return json({ error: 'Gemini non raggiungibile: ' + (e as Error).message }, 502); }

  if (!/^\s*select\b/i.test(sql)) return json({ error: 'La domanda non ha prodotto una query valida.', sql }, 200);

  // 2) run it through the guarded executor
  const { data, error } = await sb.rpc('ask_select', { q: sql });
  if (error) return json({ error: 'Esecuzione fallita: ' + error.message, sql }, 200);
  return json({ ok: true, sql, rows: data ?? [] });
});
