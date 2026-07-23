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

const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
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
  const { data: li } = await sb.from('shopify_line_items').select('lineitem_name,quantita').eq('order_id', o.order_id as string);
  const righe = ((li ?? []) as Row[]).map((r) => ({ nome: String(r.lineitem_name ?? ''), qta: Number(r.quantita ?? 0) }));
  return { order_number: o.order_number, financial_status: o.financial_status, fulfillment_status: o.fulfillment_status, fulfilled_at: o.fulfilled_at, gross_total: o.gross_total, email: o.email, order_id: o.order_id, righe };
}

// Shopify Admin API: cerca l'ordine per NOME (#numero) e ritorna id numerico (per il link admin) + tracking.
// Il DB non tiene ne' l'id numerico ne' il tracking (order_id e' il NOME #1518). Best-effort: null se fallisce.
type OrdMeta = { adminId: number | null; tracking: { numero: string; url: string; corriere: string } | null };
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
    return { adminId: (o.id as number) ?? null, tracking };
  } catch { return null; }
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
  const { data: frows } = await sb.from('app_flags').select('key,value').in('key', ['gemini_api_key', 'cs_enabled']);
  for (const r of frows ?? []) flags[r.key] = r.value ?? '';
  const { data: cfg } = await sb.from('app_config').select('pin_hash, shopify_token').eq('id', 1).single();
  const token = String(cfg?.shopify_token ?? '');

  // Azioni che scrivono/leggono per la UI = gate JWT (utente reale @amimi.it), come cs-api. Le altre = PIN.
  const JWT_ACTIONS = new Set(['context', 'draft', 'refine']);
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

  // ---------- draft: 3 opzioni (JWT), Gemini flash, una sola chiamata ----------
  if (action === 'draft') {
    if (!key) return json({ ok: false, needs_key: true, error: 'Gemini non configurato.' });
    const lc = await loadConv(true);
    if (!lc) return json({ error: 'conversazione inesistente' }, 404);
    const conv = lc.conv;
    const ctx = await assembleContext(sb, conv, lc.inbound, token, (conv.categoria as string) ?? null);
    const threadTxt = lc.recent.map((m) => `${m.direction === 'out' ? 'Noi' : 'Cliente'}: ${String(m.body_text ?? '').slice(0, 800)}`).join('\n') || String(conv.subject ?? '');

    const prompt = `Sei chi risponde al servizio clienti di "Amimi'" (borse artigianali, Milano). Scrivi TRE versioni ALTERNATIVE della stessa risposta email al cliente, con toni diversi, tutte pronte da ritoccare. NON inviarle.
LE TRE VERSIONI (usa esattamente questi tre "tono"): "breve" = 2-3 righe, dritta al punto, cordiale; "calda" = piu' empatica e personale, un pizzico di calore; "formale" = piu' completa e composta, adatta a casi delicati.
${STYLE_RULES}
Lingua: ${conv.lingua === 'en' ? 'inglese' : 'italiano'}. Categoria: ${conv.categoria ?? 'n/d'}. Cliente: ${conv.customer_name ?? ''}.

Ultimi messaggi (il piu' recente e' del cliente):
${threadTxt}

BLOCCO DATI (l'unica fonte di numeri che puoi usare):
${datiBlock(ctx.dati)}
${ctx.tono.length ? `\nEsempi del NOSTRO tono (imita lo stile, non copiare i contenuti):\n${ctx.tono.map((t) => '- ' + t).join('\n')}` : ''}

Rispondi SOLO con JSON valido in questo formato ESATTO, niente altro testo:
{"opzioni":[{"tono":"breve","testo":"..."},{"tono":"calda","testo":"..."},{"tono":"formale","testo":"..."}]}`;

    let opzioni: { tono: string; testo: string }[] = [];
    try {
      const raw = await gemini(MODEL_DRAFT, prompt, key, 1400, true);
      const parsed = JSON.parse(cleanJson(raw)) as { opzioni?: { tono?: unknown; testo?: unknown }[] };
      opzioni = (Array.isArray(parsed?.opzioni) ? parsed.opzioni : []).map((o) => ({ tono: String(o.tono ?? ''), testo: String(o.testo ?? '') })).filter((o) => o.testo);
    } catch { opzioni = []; }
    if (!opzioni.length) {
      // fallback robusto: una sola bozza in testo semplice (come la Fase 3 originale), mai un errore secco
      try {
        const single = await gemini(MODEL_DRAFT, prompt.replace(/Rispondi SOLO con JSON[\s\S]*$/, 'Scrivi SOLO una bozza (nessun JSON, nessuna spiegazione):'), key, 700);
        if (single) opzioni = [{ tono: 'bozza', testo: single }];
      } catch (e) { return json({ ok: false, error: (e as Error).message }, 502); }
    }
    if (!opzioni.length) return json({ ok: false, error: 'bozza vuota' }, 502);
    const options = opzioni.slice(0, 3).map((o) => ({ tono: o.tono, testo: o.testo, da_verificare: countDaVerificare(o.testo) }));

    const { data: ins } = await sb.from('cs_drafts').insert({ conversation_id: conv.id, testo: options[0].testo, dati_usati: ctx.dati as unknown as Row, model: MODEL_DRAFT }).select('id').single();
    await sb.from('cs_events').insert({ conversation_id: conv.id, azione: 'draft', chi, dettaglio: { draft_id: ins?.id, n_options: options.length } });
    return json({
      ok: true, options, draft: options[0].testo, da_verificare: options[0].da_verificare,   // draft = retro-compat
      fonti: ctx.dati.fonti, order_admin_url: ctx.order_admin_url, storia: ctx.storia, draft_id: ins?.id,
    });
  }

  // ---------- refine: riscrivi una bozza data applicando un'istruzione (JWT), Gemini flash ----------
  if (action === 'refine') {
    if (!key) return json({ ok: false, needs_key: true, error: 'Gemini non configurato.' });
    const testo = String(body.testo || '').trim();
    const istruzione = String(body.istruzione || '').trim();
    if (!testo || !istruzione) return json({ error: 'servono testo e istruzione' }, 422);
    const lc = await loadConv(true);
    if (!lc) return json({ error: 'conversazione inesistente' }, 404);
    const conv = lc.conv;
    const ctx = await assembleContext(sb, conv, lc.inbound, token, (conv.categoria as string) ?? null);

    const prompt = `Sei chi risponde al servizio clienti di "Amimi'". Ti do una BOZZA di risposta al cliente e una richiesta di modifica. Riscrivi la bozza applicando la modifica. NON inviarla.
${STYLE_RULES}
Lingua: ${conv.lingua === 'en' ? 'inglese' : 'italiano'}.
RICHIESTA DI MODIFICA (dalla collega): ${istruzione.slice(0, 400)}

BOZZA ATTUALE:
${testo.slice(0, 2500)}

BLOCCO DATI (l'unica fonte di numeri che puoi usare):
${datiBlock(ctx.dati)}

Scrivi SOLO la nuova bozza (nessuna spiegazione, nessun oggetto):`;

    let out = '';
    try { out = await gemini(MODEL_DRAFT, prompt, key, 800); }
    catch { try { out = await gemini(MODEL_SUMMARY, prompt, key, 800); } catch (e) { return json({ ok: false, error: (e as Error).message }, 502); } }
    if (!out) return json({ ok: false, error: 'bozza vuota' }, 502);
    await sb.from('cs_events').insert({ conversation_id: conv.id, azione: 'refine', chi, dettaglio: { istruzione: istruzione.slice(0, 200) } });
    return json({ ok: true, draft: out, da_verificare: countDaVerificare(out) });
  }

  return json({ error: 'azione sconosciuta: ' + action }, 422);
});
