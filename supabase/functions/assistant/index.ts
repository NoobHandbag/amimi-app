// assistant — FLOW 6 v2. In-app AI over live data. Read-only.
// Pipeline: gate(ai_enabled) -> Gemini(flash-lite): question+history -> ONE SELECT
//   -> ask_select (RPC, SELECT-only, cap 200) -> Gemini(flash): prose + chart/products mapping
//   -> edge materializes chart values and product cards FROM the real rows (numbers never come from Gemini).
// Key in app_flags.gemini_api_key (server-only). PIN-gated like ask-data. No writes anywhere.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Model names live in ONE place (design 4.1): flash-lite for the mechanical NL->SQL step, flash for the answer.
const MODEL_SQL = 'gemini-flash-lite-latest';
const MODEL_ANSWER = 'gemini-flash-latest';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Schema generated to match the REAL views (categoria = BAG/ACCESSORY/null, not the stale ACCESSORI/PELLE/TESSUTO)
// plus a small business glossary so "borse tessili", "netto", "riordino" resolve without empty results.
const SCHEMA = `
Postgres (Italian handbag business "Amimì"). Answer with ONE read-only SELECT.
Key relations (use the views, they are live):
- v_inventory(codice, item, variant, categoria, retail_price, cogs, image_url, status, qty_purchased, shopify_sold, qromo_sold, gift_sold, b2b_venduto, giacenza_attuale, disponibili_da_vendere, valore, last_sale, on_shopify)
- v_reorder(codice, item, variant, image_url, giacenza, disponibili, on_shopify, venduto_60d, in_arrivo, giorni_stock)  -- what to reorder
- v_ce_amimi_summary(year, month, online_lordo, online_netto, offline_lordo, offline_netto, b2b_lordo, b2b_netto, omni_netto, cogs, packaging, commissioni, logistica_var, resi, salari, tasse, logistica_mag, opex, eventi, marketing, mc1, mc2)  -- Amimì brand P&L; brand sales start month 2
- v_ce_totale(year, month, online_lordo, online_netto, offline_lordo, offline_netto, b2b_lordo, b2b_netto, omni_netto, cogs, ...)  -- whole-business P&L, native/live, incl. January. Use THIS for "totale".
- qromo_sales(data date, codice, item, variant, quantita, prezzo, nome, cognome, year, month)  -- offline/POS sales
- shopify_orders(order_id, created_at_shop, customer_name, gross_total, net_total, discount_total, year, month)
- shopify_line_items(order_id, codice, lineitem_name, quantita, price, year, month)  -- online sales lines
- purchases(data date, codice, item, variant, quantita, costo_unitario, costo_totale, fornitore)
- supplier_orders(fornitore, codice, item, variant, qty_ordered, qty_arrived, data_ordine, data_consegna)
- expenses(date_paid date, operazione, costo, categoria, amimi boolean, status, year, month)  -- costo is NEGATIVE
- products(codice, item, variant, categoria, retail_price, cogs, image_url, verificato)
GLOSSARY (business):
- categoria has exactly 3 real values: 'BAG' (all handbags, leather AND textile), 'ACCESSORY', or NULL. NEVER filter categoria='ACCESSORI'/'PELLE'/'TESSUTO' (those do not exist). Do NOT ILIKE '%borsa%'.
- "borse tessili" (textile bags) = models Nina, Agata, Annie -> filter item ILIKE '%NINA%' OR item ILIKE '%AGATA%' OR item ILIKE '%ANNIE%'. "borse in pelle" (leather) = Lea, Valentina, Maria.
- prices are VAT-inclusive: netto = lordo/1.22 (IVA 22%). Money is EUR.
- units sold per product = shopify_sold + qromo_sold + b2b_venduto (from v_inventory; no need to re-aggregate the sales tables).
- "disponibili da vendere" = disponibili_da_vendere; "giacenza"/"a stock" = giacenza_attuale; "esaurito"/"stock zero" = disponibili_da_vendere <= 0.
Rules: current year is 2026. Use ILIKE for free-text names. When the question is about specific products, ALWAYS include the "codice" column so the app can show photos. One SELECT only, no semicolons, no comments, no markdown. Return ONLY the SQL.`;

function cleanSql(t: string): string {
  let s = (t || '').trim();
  s = s.replace(/^```(sql)?/i, '').replace(/```$/, '').trim();
  s = s.replace(/;+\s*$/, '').trim();
  return s;
}
function cleanJson(t: string): string {
  let s = (t || '').trim();
  s = s.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return s;
}
function norm(s: unknown): string { return String(s ?? '').toUpperCase().replace(/\s+/g, '').replace(/_+/g, '_'); }
function isNum(v: unknown): boolean { return typeof v === 'number' && Number.isFinite(v); }

type Row = Record<string, unknown>;

async function gemini(model: string, prompt: string, key: string, maxTokens: number, jsonMode = false) {
  const gc: Record<string, unknown> = { temperature: 0, maxOutputTokens: maxTokens };
  // JSON mode forces clean, parseable output (no markdown, no reasoning prose leaking into the answer).
  if (jsonMode) gc.responseMimeType = 'application/json';
  const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: gc }),
  });
  const gj = await g.json();
  if (!g.ok) throw new Error('Gemini ' + g.status + ': ' + JSON.stringify(gj).slice(0, 300));
  return String(gj?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

function historyText(storia: unknown): string {
  if (!Array.isArray(storia)) return '';
  const last = storia.slice(-6).map((m) => {
    const r = (m && typeof m === 'object') ? (m as Row) : {};
    const who = String(r.ruolo) === 'assistant' ? 'Assistente' : 'Utente';
    const t = String(r.testo ?? '').slice(0, 400);
    return t ? `${who}: ${t}` : '';
  }).filter(Boolean);
  return last.length ? `\nConversazione recente (per capire i riferimenti dei follow-up):\n${last.join('\n')}\n` : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 0) gate + PIN
  const { data: cfg } = await sb.from('app_config').select('pin_hash, ai_enabled').eq('id', 1).single();
  if (!cfg?.ai_enabled) return json({ ok: true, gated: true, testo: "L'assistente non è attivo." });
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);

  const question = String(body.domanda ?? body.question ?? '').trim();
  if (!question) return json({ error: 'domanda mancante' }, 422);

  // Read-only: if the user asks to CHANGE something, say so plainly instead of running a no-op query.
  // Narrow, high-precision verb list (destructive imperatives) to avoid flagging legit read questions like "vendite".
  if (/\b(azzer|cancell|elimin|svuot|resett|sovrascriv|rimuov|modific|aggiorn|imposta|corregg|registr|inserisc)\w*/i.test(question)) {
    return json({ ok: true, testo: 'Sono in sola lettura: ti mostro e analizzo i dati, ma non modifico niente nell’app (conta, spese, ordini, stock). Per registrare o cambiare qualcosa usa le funzioni Registra / Inserisci dell’app.' });
  }

  const { data: flag } = await sb.from('app_flags').select('value').eq('key', 'gemini_api_key').single();
  const key = flag?.value;
  if (!key) return json({ ok: true, testo: 'Assistente non configurato (manca la chiave Gemini).', needs_key: true });

  // 1) NL -> SQL (flash-lite)
  let sql = '';
  try {
    sql = cleanSql(await gemini(MODEL_SQL, `${SCHEMA}\n${historyText(body.storia)}\nDomanda: ${question}\nSQL:`, key, 400));
  } catch (e) { return json({ error: (e as Error).message }, 502); }
  if (!/^\s*select\b/i.test(sql)) {
    return json({ ok: true, testo: 'Non sono riuscito a trasformare la domanda in una richiesta sui dati. Prova a chiedere di vendite, stock, riordini o conto economico.', sql, righe: [] });
  }

  // 2) run through the guarded executor (SELECT-only, cap 200)
  const { data: rowsRaw, error } = await sb.rpc('ask_select', { q: sql });
  if (error) return json({ ok: true, testo: 'La query non ha funzionato: ' + error.message + '. Prova a riformulare la domanda.', sql, righe: [] });
  const rows: Row[] = Array.isArray(rowsRaw) ? rowsRaw as Row[] : [];
  if (!rows.length) {
    return json({ ok: true, testo: 'Non ho trovato dati per questa domanda. Forse il nome non corrisponde, o non ci sono ancora movimenti: prova a riformulare.', sql, righe: [] });
  }

  const cols = Object.keys(rows[0]);

  // 3) answer + chart/product MAPPING (flash). Gemini chooses columns and writes prose; numbers stay in the rows.
  const sample = JSON.stringify(rows.slice(0, 40));
  const answerPrompt = `Sei l'assistente dati di "Amimì" (borse artigianali). Rispondi in ITALIANO, in modo chiaro e conciso (2-6 frasi), usando SOLO i numeri presenti nelle righe qui sotto: non inventare mai cifre.
Domanda dell'utente: ${question}
${historyText(body.storia)}
Colonne disponibili: ${JSON.stringify(cols)}
Righe (JSON, max 40 mostrate): ${sample}

Restituisci SOLO un oggetto JSON valido (niente markdown) con questa forma:
{
  "testo": "la risposta in italiano, con i numeri veri dentro",
  "grafico": { "tipo": "barre"|"linee"|"torta", "titolo": "titolo breve", "label_col": "<nome colonna etichette>", "value_col": "<nome colonna valori numerici>" } | null,
  "prodotti": { "codice_col": "<colonna che contiene il CODICE prodotto>", "value_col": "<colonna valore da mostrare sulla card, opzionale>", "value_label": "<etichetta breve del valore, es. venduti>" } | null
}
Regole: metti "grafico" solo se una classifica/andamento aiuta (una classifica -> barre; un andamento mensile -> linee; poche quote -> torta) e SOLO se label_col e value_col esistono tra le colonne. Metti "prodotti" solo se le righe riguardano prodotti specifici e c'è una colonna con il codice. Se un singolo numero risponde, lascia grafico e prodotti a null. Non aggiungere testo fuori dal JSON.`;

  // The answer pass is best-effort: if Gemini or the JSON parse fails, we still return the real rows
  // with a plain fallback text (never a fabricated answer). Failures are logged server-side, not exposed.
  let parsed: Row = {};
  try {
    const raw = await gemini(MODEL_ANSWER, answerPrompt, key, 2048, true);
    try { parsed = JSON.parse(cleanJson(raw)) as Row; }
    catch { console.warn('assistant: answer JSON parse failed:', raw.slice(0, 200)); }
  } catch (e) { console.warn('assistant: answer pass failed:', (e as Error).message.slice(0, 200)); }

  const testo = String(parsed.testo ?? '').trim()
    || `Ho trovato ${rows.length} ${rows.length === 1 ? 'risultato' : 'risultati'}. Vedi il dettaglio nelle fonti qui sotto.`;

  // materialize the chart FROM the rows (values never come from Gemini)
  let grafico: { tipo: string; titolo: string; etichette: string[]; valori: number[] } | undefined;
  const gspec = parsed.grafico as Row | null | undefined;
  if (gspec && typeof gspec === 'object') {
    const lc = String(gspec.label_col ?? ''); const vc = String(gspec.value_col ?? '');
    if (cols.includes(lc) && cols.includes(vc) && rows.some((r) => isNum(r[vc]) || (r[vc] != null && !isNaN(Number(r[vc]))))) {
      const slice = rows.slice(0, 12);
      const tipo = ['barre', 'linee', 'torta'].includes(String(gspec.tipo)) ? String(gspec.tipo) : 'barre';
      grafico = {
        tipo, titolo: String(gspec.titolo ?? '').slice(0, 80),
        etichette: slice.map((r) => String(r[lc] ?? '')),
        valori: slice.map((r) => Number(r[vc] ?? 0)),
      };
    }
  }

  // materialize product cards FROM the rows, enriched with real image/price/stock from v_inventory
  let prodotti: Row[] | undefined;
  const pspec = parsed.prodotti as Row | null | undefined;
  if (pspec && typeof pspec === 'object') {
    const cc = String(pspec.codice_col ?? '');
    if (cols.includes(cc)) {
      const { data: invRaw } = await sb.from('v_inventory')
        .select('codice, codice_norm, item, variant, image_url, retail_price, giacenza_attuale, disponibili_da_vendere, status, shopify_sold, qromo_sold, b2b_venduto');
      const inv = (invRaw ?? []) as Row[];
      const lut = new Map<string, Row>();
      for (const p of inv) { lut.set(norm(p.codice_norm), p); lut.set(norm(p.codice), p); }
      const vc = String(pspec.value_col ?? '');
      const hasVal = cols.includes(vc);
      const valLabel = String(pspec.value_label ?? 'valore').slice(0, 18);
      const seen = new Set<string>();
      const out: Row[] = [];
      for (const r of rows) {
        const codRaw = r[cc]; if (codRaw == null || String(codRaw).trim() === '') continue;
        const k = norm(codRaw); if (seen.has(k)) continue; seen.add(k);
        const p = lut.get(k);
        const sold = p ? Number(p.shopify_sold ?? 0) + Number(p.qromo_sold ?? 0) + Number(p.b2b_venduto ?? 0) : null;
        out.push({
          codice: String(codRaw),
          nome: p ? p.item : null,
          variante: p ? p.variant : null,
          image_url: p ? p.image_url : null,
          prezzo: p && p.retail_price != null ? Number(p.retail_price) : null,
          disponibili: p && p.disponibili_da_vendere != null ? Number(p.disponibili_da_vendere) : null,
          giacenza: p && p.giacenza_attuale != null ? Number(p.giacenza_attuale) : null,
          stato: p ? p.status : null,
          venduto_tot: sold,
          valore: hasVal && (isNum(r[vc]) || (r[vc] != null && !isNaN(Number(r[vc])))) ? Number(r[vc]) : null,
          valore_label: hasVal ? valLabel : null,
        });
        if (out.length >= 12) break;
      }
      if (out.length) prodotti = out;
    }
  }

  return json({ ok: true, testo, grafico, prodotti, sql, righe: rows });
});
