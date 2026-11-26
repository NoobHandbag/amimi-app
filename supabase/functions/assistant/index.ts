// assistant — FLOW 6 v3 (25-11-2026). In-app AI over live data. Read-only.
// Pipeline: gate(ai_enabled) -> Claude: question+history -> {percorso, sql} (structured output)
//   -> controllo del periodo (il mese/anno chiesto deve stare nella query, una riscrittura sola)
//   -> ask_select (RPC, SELECT-only, cap 200) -> righe vuote o tutte null = "la ricerca non ha trovato righe"
//   -> totali calcolati DAL CODICE -> Claude: prosa + mappa grafico/prodotti (structured output)
//   -> controllo dei numeri del testo contro righe e totali (una riscrittura sola, poi testo senza cifre)
//   -> l'edge materializza grafico e card DALLE righe (i numeri non arrivano mai dal modello).
// v3: Gemini -> Claude (decisione Dan del 25-11 in chat: chiave Anthropic al posto di Google, Opus 5.5, stessa chiave
// della chat del sito, cioe' il segreto delle Edge Functions ANTHROPIC_API_KEY, mai in app_flags). Prima la query la
// scriveva gemini-flash-lite e alla stessa domanda ("quanto abbiamo venduto offline a novembre") dava tre cifre diverse,
// una era il venduto di sempre, nessuna uguale al CE (dettaglio nel changelog del repo hub: questo repo e' pubblico,
// qui niente incassi veri). PIN-gated come ask-data. Nessuna scrittura da nessuna parte.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
// 2026-09-14 (audit gate, B65): una lettura fallita si ritenta UNA volta dopo 1,5 s, poi si dichiara (503). Prima un
// 504 su app_config/app_guides usciva come "PIN errato"/"guida non caricata" e uno su ask_select/v_inventory come
// "nessun dato": risposte plausibili ma false. Nessuna scrittura qui (Regola Ferrea 20).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn();
  if (!r.error) return r;
  await sleep(1500);
  return await fn();
};
const readFailed = (tabella: string, msg: string) => json({ error: `lettura fallita, riprova: ${tabella}: ${msg}` }, 503);
// Un errore SQL della query generata (SQLSTATE 22/42/0A/P0 = guardie ask_select, 57 = timeout) e' un esito della
// DOMANDA, non della lettura: risposta discorsiva come prima. Tutto il resto e' lettura fallita -> 503.
type SqlErr = { message: string; code?: string };
const isSqlErr = (e: SqlErr) => /^(22|42|0A|P0|57)/.test(String(e?.code ?? ''));
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ==== PURE:assistant BEGIN ====
// Tutto cio' che sta fra i due marcatori non importa nulla e non usa la rete: tests/assistant_guardie.mjs lo ritaglia
// dal sorgente che va in produzione e lo prova in Node.
// Il modello sta in UN punto (design 4.1). Effort: medium per scrivere la query (e' il passo che sbagliava), low per la prosa.
export const MODELLO = 'claude-opus-5-5';
export const EFFORT_SQL = 'medium';
export const EFFORT_RISPOSTA = 'low';
// USD per milione di token (listino Anthropic): input, output, scrittura cache 5 minuti, lettura cache.
// Una chiamata servita da un modello di ripiego (fallback sul rifiuto) si paga ai prezzi di quel modello; un modello
// fuori tabella si conta ai prezzi di Opus 5.5. I tentativi rifiutati prima del ripiego non sono contati (solo log).
export const PREZZI: Record<string, { i: number; o: number; cw: number; cr: number }> = {
  'claude-opus-5-5': { i: 4, o: 20, cw: 5, cr: 0.20 },
  'claude-opus-5': { i: 5, o: 25, cw: 6.25, cr: 0.50 },
  'claude-opus-4-8': { i: 5, o: 25, cw: 6.25, cr: 0.50 },
};

// Schema generated to match the REAL views (categoria = BAG/ACCESSORY/null, not the stale ACCESSORI/PELLE/TESSUTO)
// plus a small business glossary so "borse tessili", "netto", "riordino", "offline" resolve without empty or wrong results.
export const SCHEMA = `
Postgres (Italian handbag business "Amimì"). Answer with ONE read-only SELECT.
Key relations (use the views, they are live):
- v_inventory(codice, item, variant, categoria, retail_price, cogs, image_url, status, qty_purchased, shopify_sold, qromo_sold, gift_sold, b2b_venduto, giacenza_attuale, disponibili_da_vendere, valore, last_sale, on_shopify)  -- one row per product; the *_sold / b2b_venduto columns are ALL-TIME totals: NEVER use them for a month or any period; valore = giacenza_attuale x retail_price (stock value at LIST price, VAT incl.), NOT at cost: stock value at cost = SUM(giacenza_attuale * cogs); image_url here is the product photo (products.image_url is often empty)
- v_reorder(codice, item, variant, image_url, giacenza, disponibili, on_shopify, venduto_60d, in_arrivo, giorni_stock)  -- what to reorder
- v_ce_amimi_summary(year, month, online_lordo, online_netto, offline_lordo, offline_netto, b2b_lordo, b2b_netto, omni_netto, cogs, packaging, commissioni, logistica_var, resi, salari, tasse, logistica_mag, opex, eventi, marketing, mc1, mc2, base_compenso_soci, compenso_soci)  -- Amimì brand P&L (ONLY when the user asks for the brand / "solo Amimì"); brand sales start month 2
- v_ce_totale(year, month, online_lordo, online_netto, online_pezzi, offline_lordo, offline_netto, offline_pezzi, b2b_lordo, b2b_netto, b2b_pezzi, omni_netto, cogs, ... same columns as above)  -- whole-business P&L, native/live, incl. January. DEFAULT for any P&L / conto economico / margini question (the app screens open on Totale). In both views costs are NEGATIVE; compenso_soci = partner compensation (rate from table ce_compensi_soci x base_compenso_soci; base = net sales ex VAT, net of refunds, without gifts_offline kind 'vendita_fuori_fatturato') is a VARIABLE cost already INSIDE mc1 and mc2: mc1 = omni_netto + cogs + packaging + commissioni + logistica_var + resi + compenso_soci. In v_ce_totale omni_netto also contains the historical sales collected outside official revenue (gifts_offline kind 'vendita_fuori_fatturato'), which base_compenso_soci leaves out; gifts have price 0.
- qromo_sales(data date, codice, item, variant, quantita, prezzo, nome, cognome, year, month)  -- in-person POS sales (Qromo); prezzo is the ROW total, VAT-inclusive: use SUM(prezzo), never prezzo*quantita (the P&L does the same)
- gifts_offline(year, month, data date, codice, nome, cognome, quantita, prezzo, cogs, kind)  -- offline rows outside Qromo/Shopify; prezzo and cogs are ROW totals (do not multiply by quantita), prezzo VAT-inclusive; kind = 'gift' (price 0), 'vendita_manuale' (manual sale), 'vendita_fuori_fatturato' (historical sale collected outside official revenue), 'rettifica' (stock out, no sale)
- shopify_orders(order_id, created_at_shop, customer_name, gross_total, net_total, discount_total, year, month)
- shopify_line_items(order_id, codice, lineitem_name, quantita, price, year, month)  -- online sales lines
- purchases(data date, codice, item, variant, quantita, costo_unitario, costo_totale, fornitore)
- supplier_orders(fornitore, codice, item, variant, qty_ordered, qty_arrived, data_ordine, data_consegna)
- expenses(date_paid date, operazione, costo, categoria, amimi boolean, status, year, month)  -- costo is NEGATIVE
- products(codice, item, variant, categoria, retail_price, cogs, image_url, verificato)
GLOSSARY (business):
- BAGS vs ACCESSORIES: categoria is EMPTY (NULL) on many products, bags included, so NEVER use categoria to find bags or accessories. A bag ("borsa") = item ILIKE '%BAG%' (models LEA, AGATA, ANNIE, NINA, MARIA, VALENTINA, LOLA, SOPHIE, SVEVA, GALIANO TOAST, also in the MAXI / PAILLETTES / SILK versions); in the sales tables, codice ILIKE '%BAG%' (codice = MODEL_VARIANT, e.g. LEA_BAG_COCCO_GREEN). Everything else is an accessory (cases, covers, chains, charms, scarves). When present, categoria is 'BAG' or 'ACCESSORY' (never 'ACCESSORI'/'PELLE'/'TESSUTO'). Do NOT ILIKE '%borsa%'.
- codice is case-insensitive: join sales tables to v_inventory/products on UPPER(codice). The app shows product photos by itself from the codice column.
- "borse tessili" (textile bags) = models Nina, Agata, Annie -> filter item ILIKE '%NINA%' OR item ILIKE '%AGATA%' OR item ILIKE '%ANNIE%'. "borse in pelle" (leather) = Lea, Valentina, Maria.
- prices are VAT-inclusive: netto = lordo/1.22 (IVA 22%). Money is EUR.
- SALES CHANNELS: "online" = Shopify (the website). "offline" = "non online" = "in negozio" = "di persona" = "mercatini" = "eventi" = "Qromo" = in-person sales = qromo_sales PLUS gifts_offline rows with kind 'vendita_manuale' or 'vendita_fuori_fatturato'. "B2B" = sales through shops.
- SALES TOTALS for a month, a period or a channel ALWAYS come from v_ce_totale: online_lordo/online_netto, offline_lordo/offline_netto, b2b_lordo/b2b_netto, omni_netto (net total of all channels). These are exactly the numbers of the app's Conto Economico screen. Select BOTH the lordo (VAT incl.) and the netto (ex VAT) column, plus year and month. Gross total of all channels = online_lordo + offline_lordo + b2b_lordo.
- PIECES: offline_pezzi in v_ce_totale also counts free gifts (kind 'gift', price 0). Pieces SOLD offline = SUM(quantita) of qromo_sales + SUM(quantita) of gifts_offline with kind IN ('vendita_manuale','vendita_fuori_fatturato').
- PER PRODUCT offline sales in a period = qromo_sales UNION ALL gifts_offline with kind IN ('vendita_manuale','vendita_fuori_fatturato'), filtered on year and month. Per product online = shopify_line_items.
- units sold per product of ALL TIME = shopify_sold + qromo_sold + b2b_venduto (from v_inventory). For a period, use the sales tables filtered on year and month instead.
- "disponibili da vendere" = disponibili_da_vendere; "giacenza"/"a stock" = giacenza_attuale; "esaurito"/"stock zero" = disponibili_da_vendere <= 0.
Rules: today's date is given with the question. A month named without a year means its most recent occurrence up to today (the current month included). When the question names a month or a year, the SELECT MUST filter on it (year and month columns, or a range on the date column). Use ILIKE for free-text names. When the question is about specific products, ALWAYS include the "codice" column so the app can show photos. One SELECT only, no semicolons, no comments, no markdown.
ROUTING: if the question asks HOW TO USE the app (operational instructions: "come registro/aggiungo/faccio/cambio X", "dove trovo X", "come funziona X", "a cosa serve X"), do NOT produce SQL: set percorso to "howto" and sql to an empty string. Otherwise (data/numbers: sales, stock, expenses, P&L, ...) set percorso to "dati" and put ONE SELECT in sql.`;

export const ISTRUZIONI_RISPOSTA = `Sei l'assistente dati di "Amimì" (borse artigianali). Chi legge non conosce i database: rispondi in ITALIANO, in modo chiaro e conciso (2-6 frasi).
Regole sui numeri, obbligatorie:
- Usa SOLO numeri presenti nelle righe o nei TOTALI CALCOLATI DAL PROGRAMMA. Non fare mai somme, medie, differenze, percentuali o conversioni a mente (neanche da lordo a netto): se un numero non c'e', non scriverlo.
- Se servono totali su piu' righe, usa i TOTALI CALCOLATI DAL PROGRAMMA.
- Importi in euro col formato italiano: punto per le migliaia, virgola per i decimali, due decimali (esempio: 1.234,50 €).
- Quando una colonna e' "lordo" scrivi "con IVA", quando e' "netto" scrivi "senza IVA".
- Scrivi sempre il periodo esatto (mese e anno) dei numeri, letto dalla query SQL o dalle colonne. Se e' il mese in corso, scrivi "fino a oggi".
- Se le righe non rispondono davvero alla domanda (periodo, canale o prodotto diversi da quelli chiesti), dillo chiaramente invece di forzare una risposta.
- Un valore di magazzino ("valore") e' a prezzo di listino con IVA: scrivilo. Un valore calcolato sul costo (cogs) e' "a costo": scrivilo.
- Le foto dei prodotti le mostra l'app da sola nelle schede: non scrivere mai che le foto mancano o non ci sono.
Poi scegli grafico e schede prodotto:
- "grafico" solo se una classifica o un andamento aiuta (classifica -> barre, andamento mensile -> linee, poche quote -> torta) e SOLO se label_col e value_col sono fra le colonne; altrimenti null.
- "prodotti" solo se le righe riguardano prodotti specifici e c'e' una colonna con il codice prodotto; value_col e value_label possono essere stringhe vuote. Altrimenti null.
- Se un solo numero risponde, grafico e prodotti sono null.`;

export const ISTRUZIONI_SPESA = `L'utente vuole forse registrare una SPESA nell'app gestionale "Amimì" (borse artigianali). Estrai i dati dalla richiesta.
Regole: "e_spesa" = false se NON e' chiaramente una spesa da REGISTRARE, o se manca un importo numerico chiaro (NON inventare importi; in quel caso costo = 0). "costo" = solo il numero, senza segno. "categoria" = la piu' probabile fra quelle valide, "" se incerta. "operazione" = descrizione breve (es. "imballaggi"). "amimi" = true se e' una spesa del brand (default true), false se chiaramente di altro business.`;

export const ISTRUZIONI_HOWTO = `Sei l'assistente dell'app gestionale "Amimì" (PWA per un e-commerce di borse artigianali). Rispondi alla domanda su COME USARE l'app usando SOLO le informazioni della GUIDA qui sotto. NON inventare schermate, bottoni o passaggi che non sono nella guida. Se la guida non copre la domanda, dillo con onesta' e indica la sezione dell'app piu' probabile dove guardare (Home, Registra, Ordini, Magazzino, Tabelle). Rispondi in italiano, conciso, con passi numerati quando utile, in testo semplice.`;

export const FORMATO_SQL = {
  type: 'object', additionalProperties: false, required: ['percorso', 'sql'],
  properties: { percorso: { type: 'string', enum: ['dati', 'howto'] }, sql: { type: 'string' } },
};
export const FORMATO_RISPOSTA = {
  type: 'object', additionalProperties: false, required: ['testo', 'grafico', 'prodotti'],
  properties: {
    testo: { type: 'string' },
    grafico: { anyOf: [{ type: 'null' }, {
      type: 'object', additionalProperties: false, required: ['tipo', 'titolo', 'label_col', 'value_col'],
      properties: { tipo: { type: 'string', enum: ['barre', 'linee', 'torta'] }, titolo: { type: 'string' }, label_col: { type: 'string' }, value_col: { type: 'string' } },
    }] },
    prodotti: { anyOf: [{ type: 'null' }, {
      type: 'object', additionalProperties: false, required: ['codice_col', 'value_col', 'value_label'],
      properties: { codice_col: { type: 'string' }, value_col: { type: 'string' }, value_label: { type: 'string' } },
    }] },
  },
};
export const EXPENSE_CATS = ['COGS', 'LOGISTICA', 'MARKETING', 'OPEX', 'PACKAGING', 'SALARI', 'TASSE'];
export const FORMATO_SPESA = {
  type: 'object', additionalProperties: false, required: ['e_spesa', 'costo', 'categoria', 'operazione', 'amimi'],
  properties: { e_spesa: { type: 'boolean' }, costo: { type: 'number' }, categoria: { type: 'string' }, operazione: { type: 'string' }, amimi: { type: 'boolean' } },
};

export const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const TESTO_VUOTO = 'La mia ricerca non ha trovato righe per questa domanda. Non vuol dire per forza che non ci siano dati: prova a riformularla, per esempio indicando mese e anno.';
export const TESTO_PERIODO = 'Non sono riuscito a costruire una ricerca che filtri davvero il periodo chiesto, quindi non ti do un numero che potrebbe essere sbagliato. Prova a riformulare indicando mese e anno (per esempio "vendite offline di novembre 2026").';
export const TESTO_NUMERI = 'Ho trovato i dati, ma non sono riuscito a scrivere una risposta con numeri tutti verificati sulle righe. Li trovi nelle fonti qui sotto.';

// Data di oggi a Roma, YYYY-MM-DD (l'anno non e' piu' scritto fisso nel prompt: "novembre" a gennaio 2027 = novembre 2026).
export function oggiRoma(ora: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ora);
}

export function cleanSql(t: string): string {
  let s = String(t ?? '').trim();
  s = s.replace(/^```(sql)?/i, '').replace(/```$/, '').trim();
  s = s.replace(/;+\s*$/, '').trim();
  return s;
}
export function norm(s: unknown): string { return String(s ?? '').toUpperCase().replace(/\s+/g, '').replace(/_+/g, '_'); }
export function isNum(v: unknown): boolean { return typeof v === 'number' && Number.isFinite(v); }
// Un valore di riga come numero: numero vero o stringa numerica (Postgres numeric puo' arrivare come stringa). Altrimenti null.
export function aNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

// Solo le domande dell'utente (le ultime 4): le risposte di prima dell'assistente possono contenere numeri sbagliati e
// trascinarli nella domanda dopo (25-11: "nullo" a novembre ha portato a zero righe su ottobre).
export function storiaUtente(storia: unknown): string {
  if (!Array.isArray(storia)) return '';
  const domande = storia.filter((m) => m && typeof m === 'object' && String((m as Record<string, unknown>).ruolo) !== 'assistant')
    .map((m) => String((m as Record<string, unknown>).testo ?? '').trim().slice(0, 400)).filter(Boolean).slice(-4);
  return domande.length ? `Domande precedenti dell'utente, per capire i riferimenti dei follow-up:\n${domande.map((d) => '- ' + d).join('\n')}\n` : '';
}

export function mesiNellaDomanda(testo: string): number[] {
  const t = String(testo ?? '').toLowerCase();
  const out: number[] = [];
  MESI.forEach((m, i) => { if (new RegExp('(^|[^a-zàèéìòù])' + m + '($|[^a-zàèéìòù])').test(t)) out.push(i + 1); });
  return out;
}
export function anniNellaDomanda(testo: string): number[] {
  return [...new Set((String(testo ?? '').match(/(?<!\d)20\d\d(?!\d)/g) ?? []).map(Number))];
}
// L'anno di un mese nominato senza anno: la sua ultima occorrenza fino a oggi ("dicembre" a novembre 2026 = dicembre 2025).
export function annoInferito(mese: number, oggi: string): number {
  const [y, m] = String(oggi).split('-').map(Number);
  return mese <= m ? y : y - 1;
}
// Mesi e anni che la query FILTRA davvero: "month = 11", "q.month in (10, 11)", "month between 1 and 9", "month <= 9",
// "extract(month from data) = 11", "date_part('month', data) = 11", "to_char(data, 'MM') = '11'", "make_date(2026, 11, 1)",
// e le date fra apici ('2026-11-01', '2026-11'), tranne il limite superiore escluso ("< '2026-12-01'", che non e' dicembre).
// Un "LIMIT 1" o un "ROUND(x, 2)" dopo la parola month non conta piu' come mese (Gate 2 del 26-11, C5).
export function filtriPeriodo(sql: string): { mesi: Set<number>; anni: Set<number> } {
  let s = String(sql ?? '').toLowerCase();
  s = s.replace(/extract\s*\(\s*(month|year)\s+from\s+[^)]*\)/g, ' $1 ')
    .replace(/date_part\s*\(\s*'(month|year)'\s*,\s*[^)]*\)/g, ' $1 ')
    .replace(/to_char\s*\([^,()]+,\s*'mm'\s*\)/g, ' month ').replace(/to_char\s*\([^,()]+,\s*'yyyy'\s*\)/g, ' year ')
    .replace(/\b\w+\.(month|year)\b/g, ' $1 ');
  const mesi = new Set<number>(), anni = new Set<number>();
  const intervallo = (set: Set<number>, lo: number, hi: number, min: number, max: number) => { for (let x = Math.max(lo, min); x <= Math.min(hi, max); x++) set.add(x); };
  for (const [campo, set, min, max] of [['month', mesi, 1, 12], ['year', anni, 2000, 2100]] as const) {
    let m: RegExpExecArray | null;
    const eq = new RegExp(`\\b${campo}\\b\\s*=\\s*'?(\\d{1,4})'?(?!\\d)`, 'g');
    while ((m = eq.exec(s)) !== null) set.add(Number(m[1]));
    const inn = new RegExp(`\\b${campo}\\b\\s+in\\s*\\(([^)]*)\\)`, 'g');
    while ((m = inn.exec(s)) !== null) for (const d of m[1].match(/\d{1,4}/g) ?? []) set.add(Number(d));
    const tra = new RegExp(`\\b${campo}\\b\\s+between\\s+'?(\\d{1,4})'?\\s+and\\s+'?(\\d{1,4})'?`, 'g');
    while ((m = tra.exec(s)) !== null) intervallo(set, Number(m[1]), Number(m[2]), min, max);
    let lo: number | null = null, hi: number | null = null;
    const ge = new RegExp(`\\b${campo}\\b\\s*(>=|>)\\s*'?(\\d{1,4})'?`, 'g');
    while ((m = ge.exec(s)) !== null) lo = Number(m[2]) + (m[1] === '>' ? 1 : 0);
    const le = new RegExp(`\\b${campo}\\b\\s*(<=|<)\\s*'?(\\d{1,4})'?`, 'g');
    while ((m = le.exec(s)) !== null) hi = Number(m[2]) - (m[1] === '<' ? 1 : 0);
    if (lo != null || hi != null) intervallo(set, lo ?? min, hi ?? max, min, max);
  }
  let m: RegExpExecArray | null;
  const data = /(<=|<)?\s*'(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/g;
  while ((m = data.exec(s)) !== null) {
    if (m[1] === '<' && (m[4] == null || Number(m[4]) === 1)) continue;   // limite superiore escluso: il mese dopo non e' filtrato
    anni.add(Number(m[2])); mesi.add(Number(m[3]));
  }
  const md = /make_date\s*\(\s*(\d{4})\s*,\s*(\d{1,2})/g;
  while ((m = md.exec(s)) !== null) { anni.add(Number(m[1])); mesi.add(Number(m[2])); }
  return { mesi, anni };
}
// Il mese e' un obiettivo, non un filtro ("cosa riordinare per dicembre?"): niente controllo sul mese.
const MESE_OBIETTIVO = /\b(riordin\w*|ordinar\w*|comprar\w*|preparar\w*|prevision\w*|preved\w*|scorte|servir\w*)\b/i;
// null = la query filtra il periodo nominato nella domanda (o la domanda non ne nomina); altrimenti cosa manca.
// Un mese senza anno vuole anche l'anno nella query: quello dell'ultima occorrenza del mese, o un anno gia' nominato
// nelle domande di prima (Gate 2 del 26-11, B3: "month = 1" da solo a gennaio 2027 somma gennaio 2026 e gennaio 2027).
// Con due o piu' mesi (un intervallo, "da gennaio a settembre") basta che uno compaia.
export function controllaPeriodo(domanda: string, sql: string, oggi: string, storia = ''): string | null {
  const mesi = MESE_OBIETTIVO.test(domanda) ? [] : mesiNellaDomanda(domanda);
  const anni = anniNellaDomanda(domanda);
  if (!mesi.length && !anni.length) return null;
  const f = filtriPeriodo(sql);
  const manca: string[] = [];
  if (mesi.length && !mesi.some((m) => f.mesi.has(m))) manca.push('il mese (' + mesi.map((m) => MESI[m - 1]).join(', ') + ')');
  for (const a of anni) if (!f.anni.has(a)) manca.push("l'anno " + a);
  if (mesi.length && !anni.length) {
    const attesi = new Set<number>([...mesi.map((m) => annoInferito(m, oggi)), ...anniNellaDomanda(storia)]);
    if (![...f.anni].some((a) => attesi.has(a))) manca.push("l'anno (" + [...attesi].sort().join(' o ') + ')');
  }
  return manca.length ? manca.join(' e ') : null;
}

const NON_SOMMARE = /^(year|month|anno|mese|giorno|day|id|.*_id)$/i;
const r2 = (x: number) => Math.round(x * 100) / 100;

// Righe che non hanno trovato niente: nessuna riga, oppure righe in cui, tolte anno/mese/id, i valori sono tutti null o
// sono zeri accanto a un null (COUNT 0 e SUM null). Non e' "vendite nulle" (25-11: una query con un filtro che non
// trovava niente tornava una riga null e l'assistente rispondeva "venduto offline nullo" su un mese con vendite).
export function righeVuote(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return true;
  return rows.every((r) => {
    if (r == null || typeof r !== 'object') return true;
    const v = Object.entries(r as Record<string, unknown>).filter(([k]) => !NON_SOMMARE.test(k)).map(([, x]) => x);
    if (v.every((x) => x == null)) return true;
    return v.some((x) => x == null) && v.every((x) => x == null || aNumero(x) === 0);
  });
}

// Totali calcolati dal programma: per ogni colonna numerica (non anno/mese/id) somma, numero di valori, minimo e massimo.
// Il modello li riceve gia' fatti e non deve sommare a mente (25-11: il testo contava due pezzi in meno delle righe).
export function totaliCalcolati(rows: Record<string, unknown>[]): { righe: number; colonne: Record<string, { somma: number; valori: number; min: number; max: number }> } {
  const colonne: Record<string, { somma: number; valori: number; min: number; max: number }> = {};
  const cols = rows.length ? Object.keys(rows[0]) : [];
  for (const c of cols) {
    if (NON_SOMMARE.test(c)) continue;
    let somma = 0, valori = 0, min = Infinity, max = -Infinity, numerica = true;
    for (const r of rows) {
      const v = r[c];
      if (v == null) continue;
      const n = aNumero(v);
      if (n == null) { numerica = false; break; }
      somma += n; valori++; if (n < min) min = n; if (n > max) max = n;
    }
    if (numerica && valori > 0) colonne[c] = { somma: r2(somma), valori, min, max };
  }
  return { righe: rows.length, colonne };
}

// I numeri del testo da verificare. Prima si tolgono quelli che non sono dati: date ("25 novembre", "25/11", "26.11.2026",
// "2026-11-25"), ordinali e posizioni in classifica ("1°", "al 3°", "top 3", "le prime 5", "1. LEA ... 2. NINA") e gli
// anni da soli (2000-2099 senza separatori e senza euro dopo). "3.456" e' sempre 3456 (migliaia all'italiana: le
// istruzioni chiedono quel formato, e la lettura 3,456 lasciava passare importi sbagliati, Gate 2 del 26-11, B1);
// "1.234,50" e' 1234,5; "1234.50" e' 1234,5.
export function numeriNelTesto(testo: string): { raw: string; valore: number; decimali: number; percento: boolean }[] {
  let t = String(testo ?? '');
  t = t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ').replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, ' ');
  t = t.replace(new RegExp('\\b\\d{1,2}(°|º)?\\s+(' + MESI.join('|') + ')\\b', 'gi'), ' ');
  t = t.replace(/\b\d+\s*[°ºª]/g, ' ').replace(/\b(top|primi|prime|primo|prima|ultimi|ultime)\s+\d+\b/gi, ' ');
  t = t.replace(/(^|[\n;,:(]\s*)\d{1,2}[.)](?=\s)/g, '$1 ');
  const out: { raw: string; valore: number; decimali: number; percento: boolean }[] = [];
  const re = /(?<![\w.,])(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?![\w])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const raw = m[1];
    const dopo = t.slice(re.lastIndex, re.lastIndex + 8);
    const percento = /^\s*%/.test(dopo);
    const euro = /^\s*(€|euro|eur)/i.test(dopo);
    if (/^20\d\d$/.test(raw) && !euro && !percento) continue;
    let valore: number, decimali = 0;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) {
      const [intero, dec = ''] = raw.split(',');
      valore = Number(intero.replace(/\./g, '') + (dec ? '.' + dec : '')); decimali = dec.length;
    } else if (/^\d+,\d+$/.test(raw)) { valore = Number(raw.replace(',', '.')); decimali = raw.split(',')[1].length; }
    else if (/^\d+\.\d+$/.test(raw)) { valore = Number(raw); decimali = raw.split('.')[1].length; }
    else valore = Number(raw);
    out.push({ raw, valore, decimali, percento });
  }
  return out;
}
// I numeri del testo che non corrispondono a nessun valore consentito, a meno dell'arrotondamento ai decimali scritti
// (una percentuale vale anche come frazione, con la tolleranza divisa per 100; il 22% dell'IVA e' sempre ammesso).
// Vuoto = testo verificato.
export function numeriNonVerificati(testo: string, consentiti: number[]): string[] {
  const ok = [...new Set(consentiti.filter((x) => Number.isFinite(x)).map((x) => Math.abs(x)))];
  const vicino = (x: number, toll: number) => ok.some((a) => Math.abs(a - x) <= toll);
  const male: string[] = [];
  for (const n of numeriNelTesto(testo)) {
    const toll = 0.5 * Math.pow(10, -n.decimali) + 1e-9;
    const buono = vicino(n.valore, toll) || (n.percento && (n.valore === 22 || vicino(n.valore / 100, toll / 100)));
    if (!buono) male.push(n.raw);
  }
  return male;
}
// Numeri "a se'" di un testo (non quelli dentro un nome: b2b, venduto_60d, LEA_BAG_2).
function numeriSciolti(s: string): number[] {
  return (String(s ?? '').match(/(?<![\w.])\d+(?:\.\d+)?(?![\w])/g) ?? []).map(Number);
}
// I valori consentiti per il controllo: ogni valore numerico delle righe, le cifre sciolte delle stringhe delle righe
// (varianti come "MAXI 2"; non le date, che nel testo si tolgono), i totali, il numero di righe, i numeri sciolti della
// domanda e della query (LIMIT 5, month = 11, year = 2026), la data di oggi.
export function valoriConsentiti(rows: Record<string, unknown>[], tot: ReturnType<typeof totaliCalcolati>, domanda: string, sql: string, oggi = ''): number[] {
  const v: number[] = [tot.righe];
  for (const r of rows) for (const x of Object.values(r)) {
    const n = aNumero(x);
    if (n != null) { v.push(n); continue; }
    if (typeof x === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(x)) v.push(...numeriSciolti(x));
  }
  for (const c of Object.values(tot.colonne)) v.push(c.somma, c.valori, c.min, c.max);
  v.push(...numeriSciolti(domanda), ...numeriSciolti(sql), ...String(oggi).split('-').map(Number).filter(Number.isFinite));
  return v;
}

// Tempo: l'edge ha un tetto di circa 150 s. La richiesta intera ne usa al massimo 120, ogni chiamata al modello al massimo
// 50 e almeno 10, senza ritentativi dell'SDK (che su un 429 aspetta il retry-after senza tetto). Le riscritture si
// saltano se il tempo non basta (Gate 2 del 26-11, B2).
export const SCADENZA_MS = 120000;
export const CHIAMATA_MAX_MS = 50000;
export const CHIAMATA_MIN_MS = 10000;
export function tempoChiamata(scadenza: number, ora: number): number | null {
  const resto = scadenza - ora - 3000;
  return resto < CHIAMATA_MIN_MS ? null : Math.min(CHIAMATA_MAX_MS, resto);
}

export function costoUsd(modello: string, u: { input: number; output: number; cache_scrittura: number; cache_lettura: number }): number {
  const p = PREZZI[modello] ?? PREZZI[MODELLO];
  // token x USD per milione = micro-dollari: arrotondati all'unita' e riportati in dollari (6 decimali)
  return Math.round(u.input * p.i + u.output * p.o + u.cache_scrittura * p.cw + u.cache_lettura * p.cr) / 1e6;
}
// ==== PURE:assistant END ====

type Row = Record<string, unknown>;
type Uso = { input: number; output: number; cache_scrittura: number; cache_lettura: number; chiamate: number; modelli: string[]; costo_usd: number };
class RifiutoModello extends Error {}
class TempoFinito extends Error {}

// Una chiamata a Claude con output strutturato. Thinking adattivo (su Opus 5.5 non si spegne), effort esplicito,
// fallback lato server sul rifiuto (fallbacks "default"), prompt di sistema in cache. Nessun campionamento (la versione
// API dell'SDK 1.8.0 rifiuta temperature). Tempo dalla scadenza della richiesta, nessun ritentativo dell'SDK.
// Ritorna l'oggetto JSON gia' parsato.
async function chiama(client: Anthropic, uso: Uso, p: { system: string; user: string; effort: string; formato: Record<string, unknown>; maxTokens?: number; scadenza: number }): Promise<Row> {
  const timeout = tempoChiamata(p.scadenza, Date.now());
  if (timeout == null) throw new TempoFinito('tempo della richiesta finito');
  const richiesta = {
    model: MODELLO,
    max_tokens: p.maxTokens ?? 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: p.effort, format: { type: 'json_schema', schema: p.formato } },
    system: [{ type: 'text', text: p.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: p.user }],
  };
  const r = await client.beta.messages.create(richiesta as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
    { timeout, maxRetries: 0 });
  const u = { input: Number(r.usage?.input_tokens ?? 0), output: Number(r.usage?.output_tokens ?? 0),
    cache_scrittura: Number(r.usage?.cache_creation_input_tokens ?? 0), cache_lettura: Number(r.usage?.cache_read_input_tokens ?? 0) };
  uso.chiamate++;
  uso.input += u.input; uso.output += u.output; uso.cache_scrittura += u.cache_scrittura; uso.cache_lettura += u.cache_lettura;
  uso.costo_usd = Math.round((uso.costo_usd + costoUsd(r.model, u)) * 1e6) / 1e6;
  if (!uso.modelli.includes(r.model)) uso.modelli.push(r.model);
  if (r.stop_reason === 'refusal') throw new RifiutoModello('il modello ha rifiutato la richiesta');
  if (r.stop_reason === 'max_tokens') throw new Error('risposta del modello troncata');
  const testo = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  return JSON.parse(testo) as Row;
}

// Errore del modello -> messaggio per chi usa l'app (il pannello mostra `error`). Niente dettagli tecnici della chiave.
function erroreModello(e: unknown): { msg: string; status: number } {
  if (e instanceof TempoFinito) return { msg: 'Il modello ci ha messo troppo a rispondere: riprova.', status: 504 };
  if (e instanceof RifiutoModello) return { msg: 'Il modello non ha voluto rispondere a questa domanda. Prova a riformularla.', status: 502 };
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { msg: 'Assistente non configurato: la chiave Anthropic non e\' valida.', status: 502 };
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(String((e as Error).message))) return { msg: 'Assistente fermo: il credito Anthropic e\' finito.', status: 502 };
  if (e instanceof Anthropic.RateLimitError) return { msg: 'Troppe domande in poco tempo: riprova fra un minuto.', status: 429 };
  if (e instanceof Anthropic.APIConnectionTimeoutError) return { msg: 'Il modello ci ha messo troppo a rispondere: riprova.', status: 504 };
  if (e instanceof Anthropic.APIError) return { msg: `Errore del modello (${e.status ?? 'rete'}): riprova.`, status: 502 };
  return { msg: 'Errore del modello: ' + String((e as Error)?.message ?? e).slice(0, 200), status: 502 };
}

// Fase 3 (gated ai_actions_enabled): parse a request into a PROPOSED expense. Read-only — never writes.
// Returns null unless it is clearly an expense with a real amount (never invents an amount). The user
// reviews/adjusts (esp. categoria) and confirms in the app; execution goes through write-api (expense_propose,
// which lands PENDING and does not touch the CE until separately approved).
async function proposeExpense(client: Anthropic, uso: Uso, question: string, storia: unknown, scadenza: number) {
  let p: Row;
  try {
    p = await chiama(client, uso, {
      system: ISTRUZIONI_SPESA + `\nCategorie valide: ${EXPENSE_CATS.join(', ')}.`,
      user: `${storiaUtente(storia)}\nRichiesta: ${question}`, effort: EFFORT_RISPOSTA, formato: FORMATO_SPESA, maxTokens: 2000, scadenza,
    });
  } catch { return null; }
  if (p.e_spesa !== true) return null;
  const costo = Number(p.costo);
  if (!Number.isFinite(costo) || costo <= 0) return null;
  const cat = EXPENSE_CATS.includes(String(p.categoria ?? '').toUpperCase()) ? String(p.categoria).toUpperCase() : '';
  const operazione = String(p.operazione ?? '').trim().slice(0, 80) || 'Spesa';
  const amimi = p.amimi !== false;
  const descrizione = `Proposta spesa: −${costo}€${operazione !== 'Spesa' ? ' · ' + operazione : ''}${cat ? ' · ' + cat : ' · (scegli la categoria)'}${amimi ? ' · Amimì' : ''}. Resta IN ATTESA di approvazione: non tocca il conto economico finché non la approvi tu in Registra > Spese.`;
  return { tipo: 'expense_propose', payload: { costo, categoria: cat, operazione, amimi }, descrizione, categoria_valide: EXPENSE_CATS };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 0) gate + PIN
  const { data: cfg, error: cfgErr } = await retryOnce(() => sb.from('app_config').select('pin_hash, ai_enabled, ai_actions_enabled').eq('id', 1).single());
  if (cfgErr) return readFailed('app_config', cfgErr.message);
  if (!cfg?.ai_enabled) return json({ ok: true, gated: true, testo: "L'assistente non è attivo." });
  if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);

  const question = String(body.domanda ?? body.question ?? '').trim();
  if (!question) return json({ error: 'domanda mancante' }, 422);

  // La chiave e' un segreto delle Edge Functions (lo stesso della chat del sito), mai in app_flags.
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ ok: true, testo: 'Assistente non configurato (manca la chiave Anthropic).', needs_key: true });
  const client = new Anthropic({ apiKey });
  const scadenza = Date.now() + SCADENZA_MS;
  const uso: Uso = { input: 0, output: 0, cache_scrittura: 0, cache_lettura: 0, chiamate: 0, modelli: [], costo_usd: 0 };
  const usoOut = () => ({ ...uso });
  const oggi = oggiRoma(new Date());
  const storia = storiaUtente(body.storia);

  // How-to phrasing ("come/dove/a cosa serve/cosa vuol dire...") is a question ABOUT the app, not a command:
  // it must reach the how-to path, so it is excluded from the write-intent branch below.
  const isHowtoish = /\b(come|dove|a cosa serve|cosa (vuol dire|significa)|come si|come funziona|si pu[oò]|posso|spiegami|mi spieghi)\b/i.test(question);

  // Write-intent (imperative change). Fase 3: if ai_actions_enabled, try to PROPOSE a supported action.
  // The assistant NEVER writes: it returns a proposal the user confirms; execution goes via write-api.
  // Not enabled, or not a supported action -> plain read-only message.
  if (!isHowtoish && /\b(azzer|cancell|elimin|svuot|resett|sovrascriv|rimuov|modific|aggiorn|imposta|corregg|registr|inserisc|aggiung)\w*/i.test(question)) {
    if (cfg?.ai_actions_enabled) {
      const azione = await proposeExpense(client, uso, question, body.storia, scadenza);
      if (azione) return json({ ok: true, azione, uso: usoOut() });
    }
    return json({ ok: true, testo: 'Sono in sola lettura: ti mostro e analizzo i dati, ma non modifico niente nell’app (conta, spese, ordini, stock). Per registrare o cambiare qualcosa usa le funzioni Registra / Inserisci dell’app.' });
  }

  // 1) route: NL -> {percorso, sql}. Se la domanda nomina un mese o un anno e la query non lo filtra, UNA riscrittura.
  const scriviSql = async (nota: string) => {
    const p = await chiama(client, uso, {
      system: SCHEMA, effort: EFFORT_SQL, formato: FORMATO_SQL, maxTokens: 8000, scadenza,
      user: `Oggi e' ${oggi} (Europe/Rome).\n${storia}\nDomanda: ${question}${nota ? '\n\n' + nota : ''}`,
    });
    return { percorso: String(p.percorso ?? ''), sql: cleanSql(String(p.sql ?? '')) };
  };
  let passo: { percorso: string; sql: string };
  try {
    passo = await scriviSql('');
    if (passo.percorso !== 'howto' && /^\s*select\b/i.test(passo.sql)) {
      const manca = controllaPeriodo(question, passo.sql, oggi, storia);
      if (manca) {
        console.warn('assistant: la query non filtra ' + manca + ', riscrivo: ' + passo.sql.slice(0, 300));
        const prima = passo.sql;
        // senza il tempo per riscriverla, meglio nessun numero che un numero del periodo sbagliato
        if (tempoChiamata(scadenza, Date.now()) == null) return json({ ok: true, testo: TESTO_PERIODO, sql: prima, righe: [], uso: usoOut() });
        passo = await scriviSql(`ATTENZIONE: questa query non filtra ${manca} che la domanda nomina:\n${prima}\nRiscrivila filtrando year e month (o un intervallo sulla colonna data).`);
        if (passo.percorso !== 'howto' && controllaPeriodo(question, passo.sql, oggi, storia)) {
          return json({ ok: true, testo: TESTO_PERIODO, sql: passo.sql, righe: [], uso: usoOut() });
        }
      }
    }
  } catch (e) { const er = erroreModello(e); return json({ error: er.msg }, er.status); }

  // 1b) HOW-TO route: answer from the how-to corpus (no SQL, no data). Grounded only in the corpus;
  // if not covered -> honest pointer to the app section, never invented UI steps (design 4.4, Regola 1).
  if (passo.percorso === 'howto') {
    const { data: g, error: gErr } = await retryOnce(() => sb.from('app_guides').select('content').eq('id', 1).maybeSingle());
    if (gErr) return readFailed('app_guides', gErr.message);
    const corpus = String(g?.content ?? '');
    if (!corpus) return json({ ok: true, howto: true, testo: 'La guida non è ancora caricata. Dai un’occhiata alle sezioni Registra e Ordini della Home, oppure chiedimi qualcosa sui tuoi dati.' });
    let testo = '';
    try {
      const h = await chiama(client, uso, {
        system: `${ISTRUZIONI_HOWTO}\n\nGUIDA:\n${corpus}`, effort: EFFORT_RISPOSTA, maxTokens: 6000, scadenza,
        formato: { type: 'object', additionalProperties: false, required: ['testo'], properties: { testo: { type: 'string' } } },
        user: `${storia}\nDomanda: ${question}`,
      });
      testo = String(h.testo ?? '').trim();
    } catch (e) { console.warn('assistant: howto fallito: ' + String((e as Error)?.message ?? e).slice(0, 150)); }
    if (!testo) testo = 'Non sono sicuro di come si faccia esattamente. Dai un’occhiata alle sezioni Registra e Ordini della Home, oppure chiedimi qualcosa sui tuoi dati.';
    return json({ ok: true, howto: true, testo, uso: usoOut() });
  }

  const sql = passo.sql;
  if (!/^\s*select\b/i.test(sql)) {
    return json({ ok: true, testo: 'Non sono riuscito a trasformare la domanda in una richiesta sui dati. Prova a chiedere di vendite, stock, riordini o conto economico.', sql, righe: [], uso: usoOut() });
  }

  // 2) run through the guarded executor (SELECT-only, cap 200)
  // 2026-09-14 (audit gate, B65): un errore SQL della query generata resta una risposta discorsiva (la domanda va
  // riformulata); un 504/connessione e' lettura fallita -> retryOnce e 503, non "nessun dato" per finta.
  const runAsk = async (): Promise<{ data: unknown; error: SqlErr | null; sqlError: SqlErr | null }> => {
    const r = await sb.rpc('ask_select', { q: sql });
    return (r.error && isSqlErr(r.error)) ? { data: null, error: null, sqlError: r.error } : { data: r.data, error: r.error, sqlError: null };
  };
  const { data: rowsRaw, error, sqlError } = await retryOnce(runAsk);
  if (sqlError) return json({ ok: true, testo: 'La query non ha funzionato: ' + sqlError.message + '. Prova a riformulare la domanda.', sql, righe: [], uso: usoOut() });
  if (error) return readFailed('ask_select', error.message);
  const rows: Row[] = Array.isArray(rowsRaw) ? rowsRaw as Row[] : [];
  if (righeVuote(rows)) return json({ ok: true, testo: TESTO_VUOTO, sql, righe: rows, uso: usoOut() });

  const cols = Object.keys(rows[0]);
  const tot = totaliCalcolati(rows);
  const consentiti = valoriConsentiti(rows, tot, question, sql, oggi);
  const tetto = rows.length >= 200;

  // 3) answer + chart/product MAPPING. Claude sceglie colonne e scrive la prosa; i numeri restano nelle righe e nei totali,
  // e il testo si controlla numero per numero. Una riscrittura sola, poi testo senza cifre.
  const base = `Oggi: ${oggi} (Europe/Rome).\nDomanda dell'utente: ${question}\n${storia}\nQuery SQL eseguita: ${sql}\nColonne: ${JSON.stringify(cols)}\n`
    + `Numero di righe: ${rows.length}${tetto ? ' (tetto di 200 raggiunto: ce ne sono probabilmente altre)' : ''}\n`
    + (tetto
      ? `TOTALI CALCOLATI DAL PROGRAMMA sulle SOLE 200 righe ricevute, NON sono totali completi: se li usi, scrivi che riguardano solo le prime 200 righe: ${JSON.stringify(tot.colonne)}\n`
      : `TOTALI CALCOLATI DAL PROGRAMMA (somma, numero di valori, minimo e massimo di ogni colonna numerica, su TUTTE le righe): ${JSON.stringify(tot.colonne)}\n`)
    + `Righe (JSON, max 40 mostrate): ${JSON.stringify(rows.slice(0, 40))}`;
  let parsed: Row = {};
  let testo = '';
  try {
    for (let tentativo = 0; tentativo < 2; tentativo++) {
      const nota = tentativo === 0 ? '' : `\n\nATTENZIONE: la risposta di prima conteneva numeri che non sono nelle righe ne' nei totali (${numeriNonVerificati(testo, consentiti).join(', ')}). Riscrivila usando SOLO numeri presenti.`;
      parsed = await chiama(client, uso, { system: ISTRUZIONI_RISPOSTA, user: base + nota, effort: EFFORT_RISPOSTA, formato: FORMATO_RISPOSTA, maxTokens: 6000, scadenza });
      testo = String(parsed.testo ?? '').trim();
      const male = numeriNonVerificati(testo, consentiti);
      if (!male.length) break;
      console.warn('assistant: numeri non verificati (' + male.join(', ') + ') al tentativo ' + (tentativo + 1));
      // dopo la riscrittura, o senza il tempo per farla: il testo senza cifre (grafico e card restano, vengono dalle righe)
      if (tentativo === 1 || tempoChiamata(scadenza, Date.now()) == null) { testo = TESTO_NUMERI; break; }
    }
  } catch (e) {
    // Se il passo risposta cade dopo che la query ha funzionato, le righe ci sono: si mostrano con un testo onesto.
    console.warn('assistant: passo risposta fallito: ' + String((e as Error)?.message ?? e).slice(0, 150));
    testo = `Ho trovato ${rows.length} ${rows.length === 1 ? 'riga' : 'righe'}, ma non sono riuscito a scrivere la risposta. Le trovi nelle fonti qui sotto.`;
    parsed = {};
  }
  if (!testo) testo = `Ho trovato ${rows.length} ${rows.length === 1 ? 'riga' : 'righe'}. Vedi il dettaglio nelle fonti qui sotto.`;

  // materialize the chart FROM the rows (values never come from the model)
  let grafico: { tipo: string; titolo: string; etichette: string[]; valori: number[] } | undefined;
  const gspec = parsed.grafico as Row | null | undefined;
  if (gspec && typeof gspec === 'object') {
    const lc = String(gspec.label_col ?? ''); const vc = String(gspec.value_col ?? '');
    if (cols.includes(lc) && cols.includes(vc) && rows.some((r) => isNum(r[vc]) || (r[vc] != null && !isNaN(Number(r[vc]))))) {
      const slice = rows.slice(0, 12);
      const tipo = ['barre', 'linee', 'torta'].includes(String(gspec.tipo)) ? String(gspec.tipo) : 'barre';
      grafico = {
        // il titolo e' testo del modello: con un numero non verificato si toglie (Gate 2 del 26-11, C2)
        tipo, titolo: numeriNonVerificati(String(gspec.titolo ?? ''), consentiti).length ? '' : String(gspec.titolo ?? '').slice(0, 80),
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
      // 2026-09-14 (audit gate, B65): le schede prodotto sono un arricchimento del testo (i numeri sono gia' nelle
      // righe); se v_inventory non e' leggibile dopo il ritentativo si OMETTONO le schede invece di mostrarle a vuoto.
      const { data: invRaw, error: invErr } = await retryOnce(() => sb.from('v_inventory')
        .select('codice, codice_norm, item, variant, image_url, retail_price, giacenza_attuale, disponibili_da_vendere, status, shopify_sold, qromo_sold, b2b_venduto'));
      const inv = (invErr ? [] : (invRaw ?? [])) as Row[];
      const lut = new Map<string, Row>();
      for (const p of inv) { lut.set(norm(p.codice_norm), p); lut.set(norm(p.codice), p); }
      const vc = String(pspec.value_col ?? '');
      const hasVal = cols.includes(vc);
      const etichetta = String(pspec.value_label ?? '').slice(0, 18);
      const valLabel = etichetta && !numeriNonVerificati(etichetta, consentiti).length ? etichetta : 'valore';
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

  const u = usoOut();
  console.log(`assistant: ${u.chiamate} chiamate ${u.modelli.join(',')} in ${u.input} out ${u.output} cache_w ${u.cache_scrittura} cache_r ${u.cache_lettura} usd ${u.costo_usd}`);
  return json({ ok: true, testo, grafico, prodotti, sql, righe: rows, uso: u });
});
