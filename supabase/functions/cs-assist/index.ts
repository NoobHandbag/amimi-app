// cs-assist — tool assistenza clienti, FASE 3/4-lite: recupero DATI + riassunto/storia + bozze.
// Design: Cowork12/projects/Servizio_Clienti_2026-06/DESIGN_Tool_Assistenza_Amimi_V1_2026-07-20.md (6.1, 6.3, 8).
//
// Il recupero dati e' DETERMINISTICO (dal codice, non dall'AI): giacenza/disponibilita'/prezzo da v_inventory,
// ordine da shopify_orders (per numero o email), tracking + id admin via Shopify Admin API, storico acquisti
// da shopify_orders per email, FAQ/tono da cs_faq. Gemini scrive SOLO usando quel blocco DATI; un dato mancante
// diventa [DA VERIFICARE: ...] (Regola Ferrea 1).
//
// Azioni:
//   - context (JWT): assembla il CONTESTO (dati/fonti + link ordine Shopify + storico acquisti cliente),
//       NESSUN Gemini. La UI la chiama all'apertura del thread per popolare la testata (nessuna spesa AI).
//   - dry_data (PIN): come context ma PIN-gated, per test/diagnosi senza login.
//   - draft (JWT): assembla DATI -> Gemini -> TRE opzioni di risposta (toni: breve/calda/formale) in una sola
//       chiamata. Ritorna {options:[{tono,testo,da_verificare}], fonti, order_admin_url, storia}. Retro-compat:
//       ritorna anche `draft` = testo della prima opzione. Scrive cs_drafts (la 1a) + cs_events. Nessun invio.
//   - refine (JWT): riscrive una bozza data applicando un'istruzione ("piu' formale", "aggiungi X"), sempre
//       vincolata al BLOCCO DATI. Ritorna {draft, da_verificare}. Scrive cs_events 'refine'.
//   - summary (PIN, cron */7): riempie cs_conversations.summary dove NULL. Gemini flash-lite. Decoupled.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const SHOP = 'amimi-10000';
const MODEL_SUMMARY = 'gemini-flash-lite-latest';
const MODEL_DRAFT = 'gemini-flash-latest';
const MAX_SUMMARY_PER_RUN = 8;

const stripMarks = (s: string): string => [...s.normalize('NFD')].filter((ch) => { const c = ch.codePointAt(0)!; return c < 0x300 || c > 0x36f; }).join('');
const norm = (s: string): string => stripMarks((s || '').toLowerCase()).replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length >= 2));
// parole troppo comuni per essere segnale di variante
const STOP = new Set(['bag', 'the', 'con', 'senza', 'and', 'borsa', 'mini', 'maxi', 'new', 'del', 'della']);

type Row = Record<string, unknown>;
const cleanJson = (t: string) => (t || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
const countDaVerificare = (t: string) => (t.match(/\[DA VERIFICARE[^\]]*\]/gi) || []).length;

async function gemini(model: string, prompt: string, key: string, maxTokens: number, jsonMode = false): Promise<string> {
  const genCfg: Record<string, unknown> = { temperature: 0.3, maxOutputTokens: maxTokens };
  if (jsonMode) genCfg.responseMimeType = 'application/json';   // MAI thinkingConfig (400), gotcha CONOSCENZA
  const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: genCfg }),
  });
  const gj = await g.json();
  if (!g.ok) throw new Error('Gemini ' + g.status + ': ' + JSON.stringify(gj).slice(0, 200));
  return String(gj?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
}

// Claude (Anthropic Messages API) — motore preferito per bozze/refine quando c'e' app_flags.anthropic_api_key
// (tono migliore, niente quota giornaliera come Gemini free). Fallback automatico a Gemini se la chiave manca.
async function claude(model: string, system: string, user: string, key: string, maxTokens: number): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Claude ' + r.status + ': ' + JSON.stringify(j).slice(0, 200));
  const parts = Array.isArray(j?.content) ? j.content : [];
  return parts.filter((p: Row) => p.type === 'text').map((p: Row) => String(p.text ?? '')).join('').trim();
}

// --- Recupero DATI (deterministico) ---
type Prod = { codice: string; item: string; variant: string; prezzo: number | null; giacenza: number; disponibili: number; on_shopify: boolean };

// match prodotti citati nel testo: modello (item) presente + overlap parole variante; fallback alias sito.
async function matchProducts(sb: ReturnType<typeof createClient>, text: string): Promise<Prod[]> {
  const tw = words(text);
  if (tw.size === 0) return [];
  const { data: inv } = await sb.from('v_inventory').select('codice,item,variant,retail_price,giacenza_attuale,disponibili_da_vendere,on_shopify');
  const rows = (inv ?? []) as Row[];
  const { data: aliases } = await sb.from('product_aliases').select('shopify_name_norm,codice');
  const aliasHit = new Set<string>();
  for (const a of (aliases ?? []) as Row[]) {
    const meaningful = [...words(String(a.shopify_name_norm ?? ''))].filter((w) => !STOP.has(w));
    const hits = meaningful.filter((w) => tw.has(w)).length;
    // strict: quasi tutte le parole significative dell'alias devono comparire (evita match su 2 parole comuni)
    if (meaningful.length >= 2 && hits >= Math.max(2, Math.ceil(meaningful.length * 0.7))) aliasHit.add(String(a.codice));
  }
  const scored: { p: Prod; score: number }[] = [];
  for (const r of rows) {
    const item = String(r.item ?? ''); const variant = String(r.variant ?? '');
    const modelWords = [...words(item)].filter((w) => !STOP.has(w));
    const varWords = [...words(variant)].filter((w) => !STOP.has(w));
    const modelHit = modelWords.length > 0 && modelWords.some((w) => tw.has(w));
    const varHits = varWords.filter((w) => tw.has(w)).length;
    const isAlias = aliasHit.has(String(r.codice));
    if (!modelHit && !isAlias) continue;
    const prod: Prod = {
      codice: String(r.codice), item, variant,
      prezzo: r.retail_price == null ? null : Number(r.retail_price),
      giacenza: Number(r.giacenza_attuale ?? 0), disponibili: Number(r.disponibili_da_vendere ?? 0), on_shopify: r.on_shopify === true,
    };
    scored.push({ p: prod, score: (modelHit ? 2 : 0) + varHits * 3 + (isAlias ? 4 : 0) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map((x) => x.p);
}

type Ord = { order_number: unknown; financial_status: unknown; fulfillment_status: unknown; fulfilled_at: unknown; gross_total: unknown; email: unknown; order_id: unknown; righe: { nome: string; qta: number }[] } | null;
async function lookupOrder(sb: ReturnType<typeof createClient>, orderNumber: number | null, email: string | null): Promise<Ord> {
  let q = sb.from('shopify_orders').select('order_id,order_number,financial_status,fulfillment_status,fulfilled_at,gross_total,email').order('created_at_shop', { ascending: false }).limit(1);
  if (orderNumber) q = q.eq('order_number', orderNumber);
  else if (email) q = q.eq('email', email.toLowerCase());
  else return null;
  const { data } = await q;
  const o = (data ?? [])[0] as Row | undefined;
  if (!o) return null;
  // guard cross-cliente (audit 2026-07-24): il numero ordine e' estratto dal TESTO del cliente, quindi
  // puo' citare un ordine ALTRUI. Se conosciamo l'email del cliente, l'ordine deve essere suo (match
  // case-insensitive lato codice, evita anche il bug case-sensitivity di shopify_orders.email).
  if (orderNumber && email && String(o.email ?? '').toLowerCase() !== email.toLowerCase()) return null;
  const { data: li } = await sb.from('shopify_line_items').select('lineitem_name,quantita').eq('order_id', o.order_id as string);
  const righe = ((li ?? []) as Row[]).map((r) => ({ nome: String(r.lineitem_name ?? ''), qta: Number(r.quantita ?? 0) }));
  return { order_number: o.order_number, financial_status: o.financial_status, fulfillment_status: o.fulfillment_status, fulfilled_at: o.fulfilled_at, gross_total: o.gross_total, email: o.email, order_id: o.order_id, righe };
}

// Shopify Admin API: cerca l'ordine per NOME (#numero) e ritorna id numerico (per il link admin) + tracking.
// Il DB non tiene ne' l'id numerico ne' il tracking (order_id e' il NOME #1518). Best-effort: null se fallisce.
type OrdMeta = { adminId: number | null; tracking: { numero: string; url: string; corriere: string } | null; shipment_status: string | null; f_updated_at: string | null };
async function fetchOrderMeta(orderNumber: unknown, token: string): Promise<OrdMeta | null> {
  if (!orderNumber || !token) return null;
  try {
    const r = await fetch(`https://${SHOP}.myshopify.com/admin/api/2024-01/orders.json?status=any&name=${encodeURIComponent('#' + orderNumber)}&fields=id,name,fulfillments&limit=1`, { headers: { 'X-Shopify-Access-Token': token } });
    if (!r.ok) return null;
    const j = await r.json();
    const o = (j.orders ?? [])[0];
    if (!o) return null;
    const f = (o.fulfillments ?? [])[0];
    const numero = f?.tracking_number || (f?.tracking_numbers ?? [])[0] || '';
    const tracking = numero
      ? { numero: String(numero), url: String(f?.tracking_url || (f?.tracking_urls ?? [])[0] || `https://www.mytws.it/tracking-status;ldv=${numero}`), corriere: String(f?.tracking_company || 'TWS') }
      : null;
    // shipment_status: nel NOSTRO flusso quasi sempre null (i fulfillment li crea amimi-ship senza events,
    // review 24-07); se un giorno c'e' 'delivered', updated_at e' un'APPROSSIMAZIONE della data di consegna.
    return { adminId: (o.id as number) ?? null, tracking, shipment_status: (f?.shipment_status as string) ?? null, f_updated_at: (f?.updated_at as string) ?? null };
  } catch { return null; }
}

// --- Motore dei verdetti (design Parte B 24-07): il CODICE decide il caso, l'AI scrive la frase ---
const DIFETTO_RE = /difett|rott[oa]|scucit|staccat|danneggiat|rovinat|macchiat|non funziona|si (e'|è) (rotta|scucita|staccata|aperta)/i;
const CASE_CATS = new Set(['Reso e rimborso', 'Cambio e prodotto errato', 'Modifica / correzione indirizzo']);
type CasoReso = { delivered_at: string | null; fonte: string | null; giorni: number | null; finestra: number; verdetto: 'entro' | 'fuori' | 'sconosciuto'; difetto_sospetto: boolean };
type CasoIndirizzo = { fulfillment_presente: boolean; caso: 'correggibile' | 'verificare_tracking' | 'consegnato' | 'sconosciuto' };

function computeCaso(conv: Row, ordine: Ord, meta: OrdMeta | null, inbound: string, finestra: number, confirmedDate: string | null): { verificato: boolean; reso: CasoReso; indirizzo: CasoIndirizzo } {
  // Guard (review 24-07): il numero ordine viene dal TESTO del cliente. L'ordine e' "verificato" solo se
  // abbiamo potuto agganciarlo all'email del cliente (lookupOrder gia' scarta i mismatch). Senza email,
  // nessun verdetto: SCONOSCIUTO, mai un caso calcolato sull'ordine di un terzo.
  const verificato = !!ordine && !!(conv.customer_email);
  const difetto = DIFETTO_RE.test(inbound);

  // RESO: data di consegna = confermata dalla collega (STEP 1 pragmatico) > shipment_status delivered (approx).
  let delivered: string | null = null, fonte: string | null = null;
  if (confirmedDate && /^\d{4}-\d{2}-\d{2}$/.test(confirmedDate)) { delivered = confirmedDate; fonte = 'confermata dalla collega'; }
  else if (verificato && meta?.shipment_status === 'delivered' && meta.f_updated_at) { delivered = String(meta.f_updated_at).slice(0, 10); fonte = 'shopify (approssimata)'; }
  let giorni: number | null = null;
  let verdetto: CasoReso['verdetto'] = 'sconosciuto';
  if (delivered && (verificato || fonte === 'confermata dalla collega')) {
    giorni = Math.floor((Date.now() - new Date(delivered + 'T12:00:00Z').getTime()) / 86400000);
    if (giorni >= 0) verdetto = giorni <= finestra ? 'entro' : 'fuori';
  }
  const reso: CasoReso = { delivered_at: delivered, fonte, giorni, finestra, verdetto, difetto_sospetto: difetto };

  // INDIRIZZO: fulfillment ASSENTE = non ritirato (affidabile: ship-sync evade solo al ritiro) -> correggibile.
  // Fulfillment PRESENTE senza fonte delivered -> "verificare dal tracking" (MAI "in transito" secco, review 24-07).
  const fulf = String(ordine?.fulfillment_status ?? '');
  const fulfPresente = fulf === 'fulfilled' || fulf === 'partial';
  let casoInd: CasoIndirizzo['caso'] = 'sconosciuto';
  if (verificato) {
    if (!fulfPresente) casoInd = 'correggibile';
    else if (delivered) casoInd = 'consegnato';
    else casoInd = 'verificare_tracking';
  }
  return { verificato, reso, indirizzo: { fulfillment_presente: fulfPresente, caso: casoInd } };
}

// Blocco CASO da iniettare nel prompt draft: vincolante, l'AI scrive DENTRO il caso, non lo decide.
function casoBlock(categoria: string | null, cd: { verificato: boolean; reso: CasoReso; indirizzo: CasoIndirizzo }): string {
  if (!categoria || !CASE_CATS.has(categoria)) return '';
  const L: string[] = ['CASO CALCOLATO DAL SISTEMA (vincolante: scrivi la risposta DENTRO questo caso, non metterlo in dubbio):'];
  if (categoria === 'Modifica / correzione indirizzo') {
    if (cd.indirizzo.caso === 'correggibile') L.push("- Spedizione NON ancora ritirata dal corriere: la correzione E' POSSIBILE. Rassicura e chiedi l'indirizzo completo e corretto (via, civico, CAP, citta').");
    else if (cd.indirizzo.caso === 'consegnato') L.push('- Il pacco risulta GIA\' CONSEGNATO: nessuna modifica possibile. Empatia + passi concreti (vicini, portineria); se non salta fuori, segnalazione al corriere. Niente promesse impossibili.');
    else if (cd.indirizzo.caso === 'verificare_tracking') L.push("- Spedizione GIA' PARTITA ma non sappiamo se e' in viaggio o gia' consegnata: resta PRUDENTE su entrambe le ipotesi (se in viaggio: ritorno al mittente e rispedizione a carico del cliente con costo [DA VERIFICARE], oppure attendere; se consegnata: controllare vicini/portineria). NON affermare con certezza nessuna delle due.");
    else L.push('- Stato spedizione NON determinabile dai dati: niente verdetti, usa [DA VERIFICARE: stato spedizione].');
  } else {
    if (cd.reso.difetto_sospetto) L.push('- POSSIBILE DIFETTO segnalato dal cliente: la finestra reso NON si applica da sola (garanzia legale 24 mesi). Bozza prudente: chiedi una foto, proponi riparazione/cambio o contatto. MAI un rifiuto.');
    else if (cd.reso.verdetto === 'entro') L.push(`- Reso AMMESSO: consegna il ${cd.reso.delivered_at} (${cd.reso.giorni} giorni fa, entro i ${cd.reso.finestra}). Istruzioni + link resi; spedizione di rientro a carico del cliente; rimborso entro 14 giorni dal rientro sul metodo originale.` + (categoria === 'Cambio e prodotto errato' ? ' Per il CAMBIO: stessa finestra, spese a carico del cliente (salvo errore nostro: allora scuse e spese nostre).' : ''));
    else if (cd.reso.verdetto === 'fuori') L.push(`- Reso NON ammesso: consegna il ${cd.reso.delivered_at}, ${cd.reso.giorni} giorni fa (finestra ${cd.reso.finestra}). Rifiuto GARBATO con un'alternativa concreta; se dovesse emergere un difetto, cambia tutto: proponi il contatto.`);
    else L.push('- Data di consegna NON nota: nessun verdetto sulla finestra. Spiega la regola dei 15 giorni dalla consegna in generale e usa [DA VERIFICARE: data di consegna].');
  }
  return L.join('\n') + '\n';
}

// Storico acquisti del cliente (per email): totale, conteggio, ordini recenti. Solo Shopify (il POS Qromo
// non tiene l'email cliente). Sola lettura, nessun PII oltre a cio' che la UI gia' vede sul thread.
type Storia = { n_ordini: number; totale: number; prima: string | null; ultima: string | null; recenti: { numero: unknown; data: string; totale: number; stato: unknown }[] };
async function purchaseHistory(sb: ReturnType<typeof createClient>, email: string | null): Promise<Storia | null> {
  if (!email) return null;
  const { data } = await sb.from('shopify_orders')
    .select('order_number,created_at_shop,gross_total,financial_status')
    .eq('email', email.toLowerCase()).order('created_at_shop', { ascending: false }).limit(30);
  const orders = (data ?? []) as Row[];
  if (!orders.length) return { n_ordini: 0, totale: 0, prima: null, ultima: null, recenti: [] };
  const totale = orders.reduce((s, o) => s + Number(o.gross_total ?? 0), 0);
  const recenti = orders.slice(0, 6).map((o) => ({ numero: o.order_number, data: String(o.created_at_shop ?? '').slice(0, 10), totale: Number(o.gross_total ?? 0), stato: o.financial_status }));
  return {
    n_ordini: orders.length, totale: Math.round(totale * 100) / 100,
    ultima: String(orders[0].created_at_shop ?? '').slice(0, 10),
    prima: String(orders[orders.length - 1].created_at_shop ?? '').slice(0, 10),
    recenti,
  };
}

type Dati = { prodotti: Prod[]; ordine: Ord; tracking: OrdMeta['tracking']; standard: string[]; fonti: string[] };
type Ctx = { dati: Dati; tono: string[]; order_admin_url: string | null; storia: Storia | null };

async function faqTono(sb: ReturnType<typeof createClient>, categoria: string | null): Promise<{ tono: string[]; standard: string[] }> {
  const { data } = await sb.from('cs_faq').select('tipo,testo_it,categoria').eq('attiva', true);
  const rows = (data ?? []) as Row[];
  const tono = rows.filter((r) => r.tipo === 'esempio_tono').map((r) => String(r.testo_it ?? '')).filter(Boolean).slice(0, 6);
  const standard = rows.filter((r) => (r.tipo === 'faq' || r.tipo === 'risposta_standard') && (!categoria || r.categoria === categoria)).map((r) => String(r.testo_it ?? '')).filter(Boolean).slice(0, 4);
  return { tono, standard };
}

async function assembleContext(sb: ReturnType<typeof createClient>, conv: Row, inboundText: string, token: string, categoria: string | null): Promise<Ctx> {
  const prodotti = await matchProducts(sb, inboundText);
  const ordine = await lookupOrder(sb, (conv.order_number as number) ?? null, (conv.customer_email as string) ?? null);
  const wantsTracking = categoria === 'Spedizione e stato ordine' || /tracking|spedizione|corriere|dov.?\s*e|arriv/i.test(inboundText);
  const meta = ordine ? await fetchOrderMeta(ordine.order_number, token) : null;
  const tracking = meta && wantsTracking ? meta.tracking : null;
  const order_admin_url = meta?.adminId ? `https://admin.shopify.com/store/${SHOP}/orders/${meta.adminId}` : null;
  const { tono, standard } = await faqTono(sb, categoria);
  const storia = await purchaseHistory(sb, (conv.customer_email as string) ?? null);
  const fonti: string[] = [];
  for (const p of prodotti) fonti.push(`${p.item} ${p.variant}: disponibili ${p.disponibili}, giacenza ${p.giacenza}${p.prezzo != null ? `, prezzo ${p.prezzo}EUR` : ''}${p.on_shopify ? ', a catalogo' : ''} (v_inventory)`);
  if (ordine) fonti.push(`Ordine #${ordine.order_number}: pagamento ${ordine.financial_status ?? 'n/d'}, evasione ${ordine.fulfillment_status ?? 'non evaso'}${ordine.fulfilled_at ? `, evaso il ${String(ordine.fulfilled_at).slice(0, 10)}` : ''} (shopify_orders)`);
  if (tracking) fonti.push(`Tracking ${tracking.corriere} ${tracking.numero} (Shopify Admin API, live)`);
  if (storia && storia.n_ordini > 0) fonti.push(`Cliente: ${storia.n_ordini} ordini, ${storia.totale}EUR totali (storico Shopify)`);
  return { dati: { prodotti, ordine, tracking, standard, fonti }, tono, order_admin_url, storia };
}

function datiBlock(d: Dati): string {
  const L: string[] = [];
  if (d.prodotti.length) {
    L.push('PRODOTTI (giacenza/disponibilita/prezzo dal gestionale):');
    for (const p of d.prodotti) L.push(`- ${p.item} ${p.variant}: disponibili da vendere ${p.disponibili}, giacenza ${p.giacenza}${p.prezzo != null ? `, prezzo ${p.prezzo} EUR` : ''}${p.on_shopify ? ', a catalogo sul sito' : ', non a catalogo'}`);
  } else L.push('PRODOTTI: nessun prodotto identificato con certezza dal testo.');
  if (d.ordine) {
    L.push(`ORDINE #${d.ordine.order_number}: pagamento ${d.ordine.financial_status ?? 'n/d'}, evasione ${d.ordine.fulfillment_status ?? 'non ancora evaso'}${d.ordine.fulfilled_at ? `, evaso il ${String(d.ordine.fulfilled_at).slice(0, 10)}` : ''}.`);
    if (d.ordine.righe.length) L.push('  contenuto: ' + d.ordine.righe.map((r) => `${r.qta}x ${r.nome}`).join(', '));
  } else L.push('ORDINE: nessun ordine trovato per questo cliente.');
  if (d.tracking) L.push(`TRACKING: ${d.tracking.corriere} numero ${d.tracking.numero}, link ${d.tracking.url}.`);
  else L.push('TRACKING: non disponibile dai dati (usa [DA VERIFICARE: tracking] se serve).');
  if (d.standard.length) L.push('RISPOSTE STANDARD DISPONIBILI:\n' + d.standard.map((s) => '- ' + s).join('\n'));
  return L.join('\n');
}

const STYLE_RULES = `STILE: dai del tu (dai del lei solo se il cliente e' formale o arrabbiato), frasi corte, 1-2 emoji leggere al massimo, chiudi con "Grazie, Team Amimi'". Niente promesse su date/numeri non nei DATI.
REGOLA FERREA anti-invenzione: cita SOLO dati presenti nel BLOCCO DATI qui sotto. Se ti serve un dato che NON c'e' (prezzo, data, indirizzo, tracking, condizione), NON inventarlo: scrivi il segnaposto [DA VERIFICARE: cosa manca].
CASI DA NON CHIUDERE DA SOLA (scrivi una risposta PRUDENTE che raccoglie info e propone il contatto di una persona; non promettere e non rifiutare): difetto/garanzia -> NON negare mai il reso citando solo i 14 giorni del recesso (la garanzia legale dura 24 mesi), proponi riparazione/cambio o il contatto; disputa/chargeback/banca -> massima cautela + persona; reclamo/rivenditore/proposta B2B/preventivo cerimonia -> raccogli info e rimanda a una persona.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(url, svc);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');

  const flags: Record<string, string> = {};
  const { data: frows } = await sb.from('app_flags').select('key,value').in('key', ['gemini_api_key', 'cs_enabled', 'cs_reso_finestra_giorni', 'anthropic_api_key', 'cs_ai_model', 'cs_ai_istruzioni']);
  for (const r of frows ?? []) flags[r.key] = r.value ?? '';
  const { data: cfg } = await sb.from('app_config').select('pin_hash, shopify_token').eq('id', 1).single();
  const token = String(cfg?.shopify_token ?? '');

  // Azioni che scrivono/leggono dati cliente per la UI = gate JWT (utente reale @amimi.it), come cs-api.
  // dry_data ritorna lo STESSO payload PII di context: DEVE essere JWT (non PIN pubblico). Solo summary
  // (aggregato, cron) resta PIN. (audit 2026-07-24: dry_data dietro PIN 'x' esponeva PII cliente.)
  const JWT_ACTIONS = new Set(['context', 'dry_data', 'draft', 'refine', 'case_data']);
  const chi = ({ B: 'Benedetta', G: 'Ginevra', A: 'Ale' } as Record<string, string>)[String(body.chi || '').toUpperCase()] || 'ignoto';
  if (JWT_ACTIONS.has(action)) {
    const authz = req.headers.get('Authorization') || '';
    const tk = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
    if (!tk) return json({ error: 'non autenticato' }, 401);
    const { data: ures, error: uerr } = await createClient(url, anon).auth.getUser(tk);
    const email = (ures?.user?.email || '').toLowerCase();
    if (uerr || !ures?.user) return json({ error: 'sessione non valida' }, 401);
    if (!email.endsWith('@amimi.it')) return json({ error: 'dominio non ammesso' }, 403);
  } else {
    if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);
  }

  const key = flags.gemini_api_key;
  // Motore AI: Claude se c'e' anthropic_api_key (owner lo mette a mano, mai in repo/chat), altrimenti Gemini free.
  const claudeKey = (flags.anthropic_api_key || '').trim();
  const claudeModel = (flags.cs_ai_model || 'claude-sonnet-5').trim();
  const draftModel = claudeKey ? claudeModel : MODEL_DRAFT;
  const haveLLM = !!claudeKey || !!key;
  // "come rispondere": istruzioni editabili dal team (app_flags.cs_ai_istruzioni), iniettate come CONTESTO
  // in ogni bozza. Guidano il tono; non superano MAI la regola anti-invenzione.
  const aiIstruzioni = (flags.cs_ai_istruzioni || '').trim();
  const istruzioniBlock = aiIstruzioni ? `\nISTRUZIONI DEL TEAM (come rispondere; priorita' sullo stile generico, MAI sull'anti-invenzione):\n${aiIstruzioni}\n` : '';
  // LLM unificato: Claude (system separato) se configurato, altrimenti Gemini (system+user concatenati).
  const runLLM = async (system: string, userMsg: string, maxTok: number, jsonMode: boolean): Promise<string> => {
    if (claudeKey) return await claude(claudeModel, system, userMsg, claudeKey, maxTok);
    try { return await gemini(MODEL_DRAFT, system + '\n\n' + userMsg, key, maxTok, jsonMode); }
    catch (e) { if (jsonMode) throw e; return await gemini(MODEL_SUMMARY, system + '\n\n' + userMsg, key, maxTok, false); }
  };

  // carica conversazione + testo del cliente (usato da context/dry_data/draft/refine)
  const loadConv = async (withLingua = false): Promise<{ conv: Row; inbound: string; recent: Row[] } | null> => {
    const convId = String(body.conversation_id || '');
    const cols = 'id,canale,customer_email,customer_name,order_number,categoria,subject' + (withLingua ? ',lingua' : '');
    const { data: conv } = await sb.from('cs_conversations').select(cols).eq('id', convId).maybeSingle();
    if (!conv) return null;
    const { data: msgs } = await sb.from('cs_messages').select('direction,body_text,form_fields,sent_at').eq('conversation_id', convId).order('sent_at', { ascending: false }).limit(4);
    const recent = ((msgs ?? []) as Row[]).slice().reverse();
    const lastIn = [...recent].reverse().find((m) => m.direction === 'in') as Row | undefined;
    const inbound = [conv.subject, lastIn?.body_text, lastIn?.form_fields ? JSON.stringify(lastIn.form_fields) : ''].filter(Boolean).join(' ');
    return { conv: conv as Row, inbound, recent };
  };

  // ---------- context / dry_data: assembla il CONTESTO, nessun Gemini ----------
  if (action === 'context' || action === 'dry_data') {
    const lc = await loadConv();
    if (!lc) return json({ error: 'conversazione inesistente' }, 404);
    const ctx = await assembleContext(sb, lc.conv, lc.inbound, token, (lc.conv.categoria as string) ?? null);
    return json({ ok: true, fonti: ctx.dati.fonti, order_admin_url: ctx.order_admin_url, storia: ctx.storia, dati: ctx.dati });
  }

  // ---------- case_data: motore dei verdetti (JWT, NESSUN Gemini) ----------
  // La UI lo chiama su Reso/Cambio/Indirizzo; `delivered_at` opzionale = data confermata dalla collega
  // dal tracking (STEP 1 pragmatico): il verdetto resta deterministico, su un fatto umano.
  if (action === 'case_data') {
    const lc = await loadConv();
    if (!lc) return json({ error: 'conversazione inesistente' }, 404);
    const conv = lc.conv;
    const ordine = await lookupOrder(sb, (conv.order_number as number) ?? null, (conv.customer_email as string) ?? null);
    const meta = ordine ? await fetchOrderMeta(ordine.order_number, token) : null;
    const finestra = Number(flags.cs_reso_finestra_giorni) || 15;
    const confirmed = String(body.delivered_at || '').trim() || null;
    const cd = computeCaso(conv, ordine, meta, lc.inbound, finestra, confirmed);
    return json({
      ok: true, categoria: (conv.categoria as string) ?? null, verificato: cd.verificato,
      reso: cd.reso, indirizzo: cd.indirizzo,
      tracking_url: meta?.tracking?.url ?? null,
      order_admin_url: meta?.adminId ? `https://admin.shopify.com/store/${SHOP}/orders/${meta.adminId}` : null,
    });
  }

  // ---------- summary: riassunto+storia (cron), Gemini flash-lite ----------
  if (action === 'summary') {
    if (String(body.source || 'manual') === 'cron' && flags.cs_enabled !== 'true') return json({ ok: true, skipped: 'disabled' });
    if (!key) return json({ ok: false, needs_key: true });
    const limit = Math.min(Number(body.limit) || MAX_SUMMARY_PER_RUN, MAX_SUMMARY_PER_RUN);
    const { data: convs } = await sb.from('cs_conversations').select('id,customer_email,customer_name,subject,snippet,categoria').is('summary', null).neq('canale', 'rumore').eq('parse_failed', false).order('last_msg_at', { ascending: true, nullsFirst: true }).limit(limit);
    let done = 0, failed = 0;
    for (const c of (convs ?? []) as Row[]) {
      const { data: msgs } = await sb.from('cs_messages').select('direction,body_text').eq('conversation_id', c.id as string).order('sent_at', { ascending: true }).limit(12);
      const thread = ((msgs ?? []) as Row[]).map((m) => `${m.direction === 'out' ? 'Noi' : 'Cliente'}: ${String(m.body_text ?? '').slice(0, 500)}`).join('\n');
      let storia = '';
      if (c.customer_email) {
        const { data: altre } = await sb.from('cs_conversations').select('subject,categoria,stato,last_msg_at,summary').eq('customer_email', c.customer_email as string).neq('id', c.id as string).order('last_msg_at', { ascending: false }).limit(5);
        storia = ((altre ?? []) as Row[]).map((a) => `- ${String(a.last_msg_at ?? '').slice(0, 10)} [${a.categoria ?? '?'}/${a.stato}] ${a.subject ?? ''}`).join('\n');
      }
      const prompt = `Sei l'assistente di "Amimi'" (borse artigianali). Scrivi un RIASSUNTO in MASSIMO 2 righe di questa conversazione cliente: chi e', cosa vuole ORA, e (se rilevante) cosa le abbiamo gia' detto/fatto nelle conversazioni precedenti. Italiano, conciso, niente elenchi, niente saluti. Non inventare nulla: se non sai, ometti.
Cliente: ${c.customer_name ?? c.customer_email ?? 'sconosciuto'}
Conversazione attuale:
${thread || String(c.subject ?? '')}
${storia ? `Altre conversazioni dello stesso cliente:\n${storia}` : ''}
Riassunto (max 2 righe):`;
      try {
        const s = (await gemini(MODEL_SUMMARY, prompt, key, 200)).slice(0, 600);
        await sb.from('cs_conversations').update({ summary: s, summary_at: new Date().toISOString() }).eq('id', c.id as string);
        await sb.from('cs_events').insert({ conversation_id: c.id, azione: 'summary', chi: 'cs-assist', dettaglio: { len: s.length } });
        done++;
      } catch { failed++; }
    }
    const { count: remaining } = await sb.from('cs_conversations').select('id', { count: 'exact', head: true }).is('summary', null).neq('canale', 'rumore').eq('parse_failed', false);
    return json({ ok: true, done, failed, remaining: remaining ?? 0 });
  }

  // ---------- draft: 3 opzioni (JWT), Claude o Gemini, una sola chiamata ----------
  if (action === 'draft') {
    if (!haveLLM) return json({ ok: false, needs_key: true, error: 'Nessun motore AI configurato (Gemini o Claude).' });
    const lc = await loadConv(true);
    if (!lc) return json({ error: 'conversazione inesistente' }, 404);
    const conv = lc.conv;
    const ctx = await assembleContext(sb, conv, lc.inbound, token, (conv.categoria as string) ?? null);
    const threadTxt = lc.recent.map((m) => `${m.direction === 'out' ? 'Noi' : 'Cliente'}: ${String(m.body_text ?? '').slice(0, 800)}`).join('\n') || String(conv.subject ?? '');
    // motore dei verdetti: sulle categorie a caso (reso/cambio/indirizzo) il CASO e' calcolato dal codice
    // (con eventuale delivered_at confermata dalla collega) e VINCOLA la bozza. L'AI non decide, esegue.
    let casoTxt = '';
    if (CASE_CATS.has(String(conv.categoria ?? ''))) {
      const meta2 = ctx.dati.ordine ? await fetchOrderMeta(ctx.dati.ordine.order_number, token) : null;
      const cd = computeCaso(conv, ctx.dati.ordine, meta2, lc.inbound, Number(flags.cs_reso_finestra_giorni) || 15, String(body.delivered_at || '').trim() || null);
      casoTxt = casoBlock((conv.categoria as string) ?? null, cd);
    }

    const system = `Sei chi risponde al servizio clienti di "Amimi'" (borse artigianali, Milano). Scrivi TRE versioni ALTERNATIVE della stessa risposta email al cliente, con toni diversi, tutte pronte da ritoccare. NON inviarle.
LE TRE VERSIONI (usa esattamente questi tre "tono"): "breve" = 2-3 righe, dritta al punto, cordiale; "calda" = piu' empatica e personale, un pizzico di calore; "formale" = piu' completa e composta, adatta a casi delicati.
${STYLE_RULES}${istruzioniBlock}${casoTxt}`;
    const user = `Lingua: ${conv.lingua === 'en' ? 'inglese' : 'italiano'}. Categoria: ${conv.categoria ?? 'n/d'}. Cliente: ${conv.customer_name ?? ''}.

Ultimi messaggi (il piu' recente e' del cliente):
${threadTxt}

BLOCCO DATI (l'unica fonte di numeri che puoi usare):
${datiBlock(ctx.dati)}
${ctx.tono.length ? `\nEsempi del NOSTRO tono (imita lo stile, non copiare i contenuti):\n${ctx.tono.map((t) => '- ' + t).join('\n')}` : ''}

Rispondi SOLO con JSON valido in questo formato ESATTO, niente altro testo (nessun markdown, nessun **grassetto**):
{"opzioni":[{"tono":"breve","testo":"..."},{"tono":"calda","testo":"..."},{"tono":"formale","testo":"..."}]}`;

    // pulizia bozza: via i titoli markdown tipo **BREVE** e i grassetti (la mail e' testo semplice)
    const tidy = (t: string) => t.replace(/^\s*\*\*[^*\n]{2,24}\*\*\s*/i, '').replace(/\*\*/g, '').trim();
    let opzioni: { tono: string; testo: string }[] = [];
    try {
      const raw = await runLLM(system, user, 2400, true);   // Claude se configurato, altrimenti Gemini (1400 troncava, bug 24-07)
      let parsed: { opzioni?: { tono?: unknown; testo?: unknown }[] } = {};
      try { parsed = JSON.parse(cleanJson(raw)); }
      catch {   // JSON sporco/troncato: prova a estrarre il blocco { ... } piu' esterno
        const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
        if (a >= 0 && b > a) { try { parsed = JSON.parse(raw.slice(a, b + 1)); } catch { parsed = {}; } }
      }
      opzioni = (Array.isArray(parsed?.opzioni) ? parsed.opzioni : []).map((o) => ({ tono: String(o.tono ?? ''), testo: tidy(String(o.testo ?? '')) })).filter((o) => o.testo);
    } catch { opzioni = []; }
    if (!opzioni.length) {
      // fallback robusto: UNA sola bozza in testo semplice. NON chiede piu' "TRE versioni" (bug 24-07).
      try {
        const sysSingle = system
          .replace('Scrivi TRE versioni ALTERNATIVE della stessa risposta email al cliente, con toni diversi, tutte pronte da ritoccare. NON inviarle.', 'Scrivi UNA bozza di risposta email al cliente, pronta da ritoccare. NON inviarla.')
          .replace(/LE TRE VERSIONI[^\n]*\n/, '');
        const usrSingle = user.replace(/Rispondi SOLO con JSON[\s\S]*$/, 'Scrivi SOLO la bozza (nessun JSON, nessun titolo, nessuna spiegazione, nessun markdown):');
        const single = await runLLM(sysSingle, usrSingle, 1000, false);
        if (single) opzioni = [{ tono: 'bozza', testo: tidy(single) }];
      } catch (e) { return json({ ok: false, error: (e as Error).message }, 502); }
    }
    if (!opzioni.length) return json({ ok: false, error: 'bozza vuota' }, 502);
    const options = opzioni.slice(0, 3).map((o) => ({ tono: o.tono, testo: o.testo, da_verificare: countDaVerificare(o.testo) }));

    const { data: ins } = await sb.from('cs_drafts').insert({ conversation_id: conv.id, testo: options[0].testo, dati_usati: ctx.dati as unknown as Row, model: draftModel }).select('id').single();
    await sb.from('cs_events').insert({ conversation_id: conv.id, azione: 'draft', chi, dettaglio: { draft_id: ins?.id, n_options: options.length } });
    return json({
      ok: true, options, draft: options[0].testo, da_verificare: options[0].da_verificare,   // draft = retro-compat
      fonti: ctx.dati.fonti, order_admin_url: ctx.order_admin_url, storia: ctx.storia, draft_id: ins?.id,
    });
  }

  // ---------- refine: riscrivi una bozza data applicando un'istruzione (JWT), Claude o Gemini ----------
  if (action === 'refine') {
    if (!haveLLM) return json({ ok: false, needs_key: true, error: 'Nessun motore AI configurato (Gemini o Claude).' });
    const testo = String(body.testo || '').trim();
    const istruzione = String(body.istruzione || '').trim();
    if (!testo || !istruzione) return json({ error: 'servono testo e istruzione' }, 422);
    const lc = await loadConv(true);
    if (!lc) return json({ error: 'conversazione inesistente' }, 404);
    const conv = lc.conv;
    const ctx = await assembleContext(sb, conv, lc.inbound, token, (conv.categoria as string) ?? null);

    const sysR = `Sei chi risponde al servizio clienti di "Amimi'". Ti do una BOZZA di risposta al cliente e una richiesta di modifica. Riscrivi la bozza applicando la modifica. NON inviarla.
${STYLE_RULES}${istruzioniBlock}`;
    const usrR = `Lingua: ${conv.lingua === 'en' ? 'inglese' : 'italiano'}.
RICHIESTA DI MODIFICA (dalla collega): ${istruzione.slice(0, 400)}

BOZZA ATTUALE:
${testo.slice(0, 2500)}

BLOCCO DATI (l'unica fonte di numeri che puoi usare):
${datiBlock(ctx.dati)}

Scrivi SOLO la nuova bozza (nessuna spiegazione, nessun oggetto, nessun markdown):`;

    let out = '';
    try { out = await runLLM(sysR, usrR, 800, false); }
    catch (e) { return json({ ok: false, error: (e as Error).message }, 502); }
    if (!out) return json({ ok: false, error: 'bozza vuota' }, 502);
    out = out.replace(/^\s*\*\*[^*\n]{2,24}\*\*\s*/i, '').replace(/\*\*/g, '').trim();
    await sb.from('cs_events').insert({ conversation_id: conv.id, azione: 'refine', chi, dettaglio: { istruzione: istruzione.slice(0, 200) } });
    return json({ ok: true, draft: out, da_verificare: countDaVerificare(out) });
  }

  return json({ error: 'azione sconosciuta: ' + action }, 422);
});
