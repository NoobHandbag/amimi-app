// cs-assist — tool assistenza clienti, FASE 3/4-lite: recupero DATI + riassunto/storia + bozze.
// v15 (2026-08-01, brief cs_link_prodotto_torna_disponibile): il LINK della scheda prodotto entra
//   nel BLOCCO DATI. Per ogni prodotto agganciato con riga in `shopify_catalog` (94/94 con handle)
//   si costruisce `url` = SITE_URL + /products/ + handle (join case-insensitive su upper(codice),
//   Regola Ferrea 4: catalogo in Title_Case legacy, v_inventory MAIUSCOLO). I segnaposto di LINK
//   delle risposte standard ([link], [link prodotto], [product link]) sono gli unici che il modello
//   non puo' riempire: li risolve il CODICE prima del prompt (url reale se c'e', altrimenti
//   [DA VERIFICARE: link scheda prodotto] — mai promettere "sulla pagina del prodotto" a vuoto).
//   Safety net deterministico sui testi generati: un segnaposto link sopravvissuto viene risolto o
//   rimosso; ogni altro token [tra parentesi] non-DA VERIFICARE finisce in non_grounded (evidenziato
//   in UI). Prodotto esaurito ma a catalogo: il BLOCCO DATI dice esplicitamente che sulla scheda
//   c'e' il bottone "Avvisami quando torna disponibile" (form Klaviyo live dal 19-06, non si tocca).
//   In piu': allineato il flag rinominato dalla migr 0084 (`cs_ai_model` -> `cs_ai_model_claude`,
//   residuo dichiarato del brief cs_ai_model_allineamento: la v14 leggeva una chiave morta).
// v14 (2026-07-31 sera, richiesta owner "contesto massimo" + valori riconfermati dal sito):
//   - THREAD INTERO nel prompt (ultimi 30 messaggi, prima 4): su conversazioni lunghe l'AI
//     perdeva l'inizio; col piano Gemini a pagamento il costo e' spiccioli.
//   - CONOSCENZA DI CASA nel prompt: tabella `cs_knowledge` (migr 0082, pattern app_guides,
//     editabile senza redeploy) = tono di voce, valori operativi correnti (fonte unica), criteri
//     di escalation + linee guida della categoria. Entra anche nel corpus del linter (14, 3.90,
//     gli indirizzi ecc. sono fatti consentiti, non "numeri inventati").
//   - CONVERSAZIONI PRECEDENTI dello stesso cliente (riassunti, max 5) nel prompt della bozza:
//     l'AI sa se ha gia' chiesto resi/cambi/solleciti.
//   - RESO: finestra 14 giorni dalla DATA DELL'ORDINE (decisione owner 31-07, allineata al sito;
//     prima 15 dalla consegna): il verdetto entro/fuori si calcola da created_at_shop dell'ordine,
//     quindi e' SEMPRE disponibile quando l'ordine e' verificato (niente piu' data di consegna da
//     confermare a mano per il reso; delivered_at resta per il caso indirizzo).
// v13 (2026-07-31, brief redesign thread + body_clean, Parte A punto 5): la cronologia passata al
//   modello (draft/refine/summary) e il testo per match prodotti/caso usano `body_clean` (migr 0081,
//   fallback body_text: mai perdere contesto); il CORPUS del linter di aderenza resta sul RAW
//   (body_text): un numero presente solo nella citazione (es. totale ordine) resta un fatto
//   consentito e non diventa un falso positivo "non nel gestionale". Decisione dichiarata nel
//   changelog CODE. In piu': `created_at_shop` esposto nell'ordine del context (card Ordine UI).
// v12 (2026-07-31 notte, richiesta owner): FALLBACK Claude -> Gemini nell'uso NORMALE dell'app.
//   Se Claude e' configurato ma fallisce (credito API a zero, outage), la bozza NON muore: si
//   ripiega su Gemini, `cs_drafts.model` registra il modello REALMENTE usato e la risposta porta
//   `engine_fallback`. Con `model_override` attivo il fallback resta SPENTO: un A/B che ripiega
//   in silenzio e' un confronto falsato (deve fallire rumorosamente).
// v11 (2026-07-31, brief contesto risposte out, punti 4-7):
//   - richieste in INGLESE: le risposte standard entrano nel prompt con `testo_en` (fallback
//     testo_it se vuoto); gli esempi di tono restano IT (0/6 hanno testo_en: lacuna di contenuto
//     dichiarata, la colma Cowork con l'owner, non si inventano).
//   - esempi di tono ORDINATI per categoria della conversazione (prima i suoi, poi gli altri fino
//     al cap 6, prima erano in ordine di id) e passati ANCHE a `refine` (prima il tono spariva
//     alla prima richiesta di modifica).
//   - FAQ trasversali: le righe cs_faq con categoria NULL entrano SEMPRE (prima una conversazione
//     classificata le escludeva in silenzio; oggi 0 righe NULL, fix preventivo).
//   - residuo guard cross-cliente: ordine trovato SOLO per numero citato nel testo e SENZA email
//     del cliente -> NON entra in dati/fonti (potenzialmente di un terzo), gap esplicito al suo posto.
// v10 (2026-07-31, brief harness eval): `model_override` opzionale su draft/refine (solo JWT,
//   allowlist esplicita, MAI fallback silenzioso: Claude senza chiave -> needs_key) per l'A/B
//   modello senza toccare app_flags; `source` ('app'|'eval') su cs_drafts per distinguere le bozze
//   generate dall'harness (migr 0080). Nessun cambio di comportamento senza override.
// v9 (2026-07-26): bozze anche per la chat del sito (chat_notifica): boilerplate della notifica
//   Shopify Inbox rimosso dal testo passato al modello, prompt in tono chat (niente formato email).
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
const SITE_URL = 'https://amimi.it';   // dominio del sito: unico posto in cui e' scritto (v15)
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

// v15: segnaposto di LINK nelle risposte standard ([link], [link prodotto], [product link]): il modello
// non puo' riempirli, li risolve il CODICE. Nel prompt: URL reale se c'e', altrimenti [DA VERIFICARE]
// (mai un rimando a vuoto). Sul testo GENERATO (safety net): URL reale o rimozione secca.
const LINK_PH_RE = /\[(?:link(?:\s+prodotto)?|product\s+link)\]/gi;
const resolveLinkPh = (t: string, url: string | null): string =>
  (t || '').replace(LINK_PH_RE, url ?? '[DA VERIFICARE: link scheda prodotto]');
const scrubLinkPh = (t: string, url: string | null): string =>
  (t || '').replace(LINK_PH_RE, url ?? '').replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').trim();

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
// (tono migliore, niente quota giornaliera come Gemini free). v12: fallback a Gemini se Claude fallisce (no override).
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
type Prod = { codice: string; item: string; variant: string; prezzo: number | null; giacenza: number; disponibili: number; on_shopify: boolean; url: string | null };

// match prodotti citati nel testo: modello (item) presente + overlap parole variante; fallback alias sito.
async function matchProducts(sb: ReturnType<typeof createClient>, text: string): Promise<Prod[]> {
  const tw = words(text);
  if (tw.size === 0) return [];
  const { data: inv } = await sb.from('v_inventory').select('codice,item,variant,retail_price,giacenza_attuale,disponibili_da_vendere,on_shopify');
  const rows = (inv ?? []) as Row[];
  // v15: link scheda da shopify_catalog.handle (join case-insensitive, Regola Ferrea 4:
  // catalogo Title_Case legacy vs v_inventory MAIUSCOLO). Nessun handle = nessun URL, mai inventarlo.
  const { data: cat } = await sb.from('shopify_catalog').select('codice,handle,on_shopify');
  const handleByCod = new Map<string, string>();
  for (const c of (cat ?? []) as Row[]) {
    if (c.on_shopify === true && c.handle) handleByCod.set(String(c.codice).toUpperCase(), String(c.handle));
  }
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
    const handle = handleByCod.get(String(r.codice).toUpperCase()) ?? null;
    const prod: Prod = {
      codice: String(r.codice), item, variant,
      prezzo: r.retail_price == null ? null : Number(r.retail_price),
      giacenza: Number(r.giacenza_attuale ?? 0), disponibili: Number(r.disponibili_da_vendere ?? 0), on_shopify: r.on_shopify === true,
      url: handle ? `${SITE_URL}/products/${handle}` : null,
    };
    scored.push({ p: prod, score: (modelHit ? 2 : 0) + varHits * 3 + (isAlias ? 4 : 0) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map((x) => x.p);
}

type Ord = { order_number: unknown; financial_status: unknown; fulfillment_status: unknown; fulfilled_at: unknown; gross_total: unknown; email: unknown; order_id: unknown; created_at_shop: unknown; righe: { nome: string; qta: number }[] } | null;
async function lookupOrder(sb: ReturnType<typeof createClient>, orderNumber: number | null, email: string | null): Promise<Ord> {
  let q = sb.from('shopify_orders').select('order_id,order_number,financial_status,fulfillment_status,fulfilled_at,gross_total,email,created_at_shop').order('created_at_shop', { ascending: false }).limit(1);
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
  return { order_number: o.order_number, financial_status: o.financial_status, fulfillment_status: o.fulfillment_status, fulfilled_at: o.fulfilled_at, gross_total: o.gross_total, email: o.email, order_id: o.order_id, created_at_shop: o.created_at_shop, righe };
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
type CasoReso = { ordine_del: string | null; delivered_at: string | null; fonte: string | null; giorni: number | null; finestra: number; verdetto: 'entro' | 'fuori' | 'sconosciuto'; difetto_sospetto: boolean };
type CasoIndirizzo = { fulfillment_presente: boolean; caso: 'correggibile' | 'verificare_tracking' | 'consegnato' | 'sconosciuto' };

function computeCaso(conv: Row, ordine: Ord, meta: OrdMeta | null, inbound: string, finestra: number, confirmedDate: string | null): { verificato: boolean; reso: CasoReso; indirizzo: CasoIndirizzo } {
  // Guard (review 24-07): il numero ordine viene dal TESTO del cliente. L'ordine e' "verificato" solo se
  // abbiamo potuto agganciarlo all'email del cliente (lookupOrder gia' scarta i mismatch). Senza email,
  // nessun verdetto: SCONOSCIUTO, mai un caso calcolato sull'ordine di un terzo.
  const verificato = !!ordine && !!(conv.customer_email);
  const difetto = DIFETTO_RE.test(inbound);

  // v14 (owner 31-07, allineato al sito): la finestra reso decorre dalla DATA DELL'ORDINE
  // (created_at_shop), non piu' dalla consegna. Verdetto quindi SEMPRE calcolabile a ordine
  // verificato. La data di consegna (confermata dalla collega > shipment_status Shopify) resta
  // in uso per il caso INDIRIZZO ('consegnato') e come info.
  let delivered: string | null = null, fonte: string | null = null;
  if (confirmedDate && /^\d{4}-\d{2}-\d{2}$/.test(confirmedDate)) { delivered = confirmedDate; fonte = 'confermata dalla collega'; }
  else if (verificato && meta?.shipment_status === 'delivered' && meta.f_updated_at) { delivered = String(meta.f_updated_at).slice(0, 10); fonte = 'shopify (approssimata)'; }
  const ordineDel = verificato && ordine?.created_at_shop ? String(ordine.created_at_shop).slice(0, 10) : null;
  let giorni: number | null = null;
  let verdetto: CasoReso['verdetto'] = 'sconosciuto';
  if (ordineDel) {
    giorni = Math.floor((Date.now() - new Date(ordineDel + 'T12:00:00Z').getTime()) / 86400000);
    if (giorni >= 0) verdetto = giorni <= finestra ? 'entro' : 'fuori';
  }
  const reso: CasoReso = { ordine_del: ordineDel, delivered_at: delivered, fonte: ordineDel ? 'data ordine (Shopify)' : fonte, giorni, finestra, verdetto, difetto_sospetto: difetto };

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
    else if (cd.reso.verdetto === 'entro') L.push(`- Reso AMMESSO: ordine del ${cd.reso.ordine_del} (${cd.reso.giorni} giorni fa, entro i ${cd.reso.finestra} dalla data dell'ordine). Istruzioni + link resi; spedizione di rientro a carico del cliente; rimborso entro 14 giorni dal rientro sul metodo originale.` + (categoria === 'Cambio e prodotto errato' ? ' Per il CAMBIO: stessa finestra, spese a carico del cliente (salvo errore nostro: allora scuse e spese nostre).' : ''));
    else if (cd.reso.verdetto === 'fuori') L.push(`- Reso NON ammesso: ordine del ${cd.reso.ordine_del}, ${cd.reso.giorni} giorni fa (finestra ${cd.reso.finestra} dalla data dell'ordine). Rifiuto GARBATO con un'alternativa concreta; se dovesse emergere un difetto, cambia tutto: proponi il contatto.`);
    else L.push(`- Ordine NON identificato con certezza: nessun verdetto sulla finestra. Spiega la regola dei ${cd.reso.finestra} giorni dalla data dell'ordine in generale e usa [DA VERIFICARE: numero ordine].`);
  }
  return L.join('\n') + '\n';
}

// --- Linter di aderenza ("ensure context" 24-07): controllo DETERMINISTICO post-bozza, ZERO AI ---
// Estrae numeri/prezzi/date/URL dalla bozza e verifica che esistano nel CORPUS dei fatti consentiti
// (messaggi del cliente + BLOCCO DATI + caso + fonti + risposte standard/tono + istruzioni team).
// Cio' che non trova torna in `non_grounded[]`: la UI lo evidenzia, l'operatrice decide. Mai bloccante.
function factKeys(text: string): Set<string> {
  const out = new Set<string>();
  const t = text || '';
  // date ISO yyyy-mm-dd -> chiavi d/m e d/m/yyyy
  for (const m of t.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) { out.add('d:' + (+m[3]) + '/' + (+m[2])); out.add('d:' + (+m[3]) + '/' + (+m[2]) + '/' + m[1]); }
  // date dd/mm[/yyyy]
  for (const m of t.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)) {
    out.add('d:' + (+m[1]) + '/' + (+m[2]));
    if (m[3]) out.add('d:' + (+m[1]) + '/' + (+m[2]) + '/' + (m[3].length === 2 ? '20' + m[3] : m[3]));
  }
  // numeri (prezzi, quantita', finestre): normalizza il formato italiano (1.234,56 -> 1234.56)
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*/g)) {
    let s = m[0];
    if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = parseFloat(s);
    if (Number.isFinite(n)) out.add('n:' + String(n));
  }
  // domini/URL (tld solo lettere, per non matchare parole attaccate da un punto)
  for (const m of t.matchAll(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,6})((?:\/[^\s"',;!?)\]]*)?)/gi)) {
    const host = m[1].toLowerCase();
    out.add('u:' + host);
    if (m[2]) out.add('u:' + host + m[2].replace(/[.,;:!?)]+$/, '').toLowerCase());
  }
  return out;
}
function lintDraft(testo: string, corpus: Set<string>): string[] {
  // i placeholder [DA VERIFICARE: ...] sono gia' flag espliciti: non ri-segnalarli
  const clean = (testo || '').replace(/\[DA VERIFICARE[^\]]*\]/gi, ' ');
  const missing: string[] = [];
  const seen = new Set<string>();
  const flag = (raw: string, key: string) => { if (!corpus.has(key) && !seen.has(raw)) { seen.add(raw); missing.push(raw); } };
  for (const m of clean.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)) flag(m[0], 'd:' + (+m[1]) + '/' + (+m[2]));
  for (const m of clean.matchAll(/(?<![\d/.,])(\d+(?:[.,]\d+)*)(?![\d/])/g)) {
    let s = m[1];
    if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = parseFloat(s);
    if (Number.isFinite(n)) flag(m[1], 'n:' + String(n));
  }
  for (const m of clean.matchAll(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,6})((?:\/[^\s"',;!?)\]]*)?)/gi)) {
    const host = m[1].toLowerCase();
    const full = 'u:' + host + (m[2] ? m[2].replace(/[.,;:!?)]+$/, '').toLowerCase() : '');
    if (!corpus.has(full) && !corpus.has('u:' + host)) flag(m[0], full);
  }
  // v15: un token [tra parentesi] sopravvissuto nella bozza (che non sia un [DA VERIFICARE], gia'
  // rimosso da `clean`) e' un segnaposto non riempito: sempre segnalato all'operatrice.
  for (const m of clean.matchAll(/\[[^\]\n]{1,60}\]/g)) flag(m[0], 'ph:' + m[0]);
  return missing.slice(0, 8);
}

// --- Contratto di contesto per categoria ("ensure context" 24-07): dati OBBLIGATORI per rispondere ---
// Se mancano, la UI lo dice PRIMA di generare; la bozza usera' [DA VERIFICARE], mai inventare.
// (Il gap "data di consegna" di reso/cambio lo mostra gia' il pannello caso: non duplicato qui.)
function contractGaps(categoria: string | null, dati: Dati): string[] {
  const gaps: string[] = [];
  const cat = categoria ?? '';
  const needOrder = ['Spedizione e stato ordine', 'Reso e rimborso', 'Cambio e prodotto errato', 'Modifica / correzione indirizzo', 'Pagamento'].includes(cat);
  if (needOrder && !dati.ordine) gaps.push('ordine non trovato (numero/email mancanti o non combacianti)');
  if (cat === 'Spedizione e stato ordine' && dati.ordine && !dati.tracking) gaps.push('tracking non ancora disponibile');
  if ((cat === 'Restock e disponibilita' || cat === 'Info prodotto') && dati.prodotti.length === 0) gaps.push('prodotto non identificato dal testo');
  return gaps;
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
type Ctx = { dati: Dati; tono: string[]; order_admin_url: string | null; storia: Storia | null; gapExtra: string[]; conoscenza: string[]; precedenti: string[] };

// v14: conoscenza di casa (cs_knowledge, migr 0082): righe con categoria NULL sempre, piu' quelle
// della categoria della conversazione. Editabile a DB senza redeploy; cap prudente sul totale.
async function csKnowledge(sb: ReturnType<typeof createClient>, categoria: string | null): Promise<string[]> {
  const { data } = await sb.from('cs_knowledge').select('categoria,titolo,contenuto').eq('attiva', true).order('id');
  const rows = ((data ?? []) as Row[]).filter((r) => r.categoria == null || (categoria != null && r.categoria === categoria));
  const out: string[] = [];
  let tot = 0;
  for (const r of rows) {
    const s = `[${r.titolo}] ${String(r.contenuto ?? '')}`;
    if (tot + s.length > 6000) break;
    out.push(s); tot += s.length;
  }
  return out;
}

async function faqTono(sb: ReturnType<typeof createClient>, categoria: string | null, lingua: string | null): Promise<{ tono: string[]; standard: string[] }> {
  const { data } = await sb.from('cs_faq').select('tipo,testo_it,testo_en,categoria').eq('attiva', true);
  const rows = (data ?? []) as Row[];
  // v11: esempi di tono PRIMA quelli della categoria della conversazione, poi gli altri, cap 6
  // (prima erano in ordine di id: su un reso arrivavano anche cerimonia, ritiro e restock in testa)
  const toni = rows.filter((r) => r.tipo === 'esempio_tono');
  const tono = [
    ...toni.filter((r) => categoria != null && r.categoria === categoria),
    ...toni.filter((r) => !(categoria != null && r.categoria === categoria)),
  ].map((r) => String(r.testo_it ?? '')).filter(Boolean).slice(0, 6);
  // v11: risposte standard della categoria + le TRASVERSALI (categoria NULL, mai escluse);
  // in inglese entra testo_en se popolato (12/12 lo hanno), fallback testo_it
  const standard = rows
    .filter((r) => (r.tipo === 'faq' || r.tipo === 'risposta_standard') && (!categoria || r.categoria === categoria || r.categoria == null))
    .sort((a, b) => Number(b.categoria != null) - Number(a.categoria != null))
    .map((r) => {
      const en = String(r.testo_en ?? '').trim();
      return lingua === 'en' && en ? en : String(r.testo_it ?? '');
    }).filter(Boolean).slice(0, 4);
  return { tono, standard };
}

async function assembleContext(sb: ReturnType<typeof createClient>, conv: Row, inboundText: string, token: string, categoria: string | null): Promise<Ctx> {
  const prodotti = await matchProducts(sb, inboundText);
  let ordine = await lookupOrder(sb, (conv.order_number as number) ?? null, (conv.customer_email as string) ?? null);
  const gapExtra: string[] = [];
  // v11 (residuo audit fix 5): il numero ordine viene dal TESTO del cliente. Se non abbiamo la sua
  // email per verificarlo, l'ordine trovato per solo numero e' potenzialmente di un TERZO: non
  // entra nei dati ne' nelle fonti, al suo posto un gap esplicito. (I verdetti erano gia' bloccati.)
  if (ordine && conv.order_number && !conv.customer_email) {
    ordine = null;
    gapExtra.push("ordine citato non verificabile come suo (manca l'email del cliente): chiedere conferma, non dare dettagli");
  }
  const wantsTracking = categoria === 'Spedizione e stato ordine' || /tracking|spedizione|corriere|dov.?\s*e|arriv/i.test(inboundText);
  const meta = ordine ? await fetchOrderMeta(ordine.order_number, token) : null;
  const tracking = meta && wantsTracking ? meta.tracking : null;
  const order_admin_url = meta?.adminId ? `https://admin.shopify.com/store/${SHOP}/orders/${meta.adminId}` : null;
  const { tono, standard: standardRaw } = await faqTono(sb, categoria, (conv.lingua as string) ?? null);
  // v15: i segnaposto di link si risolvono QUI, prima del prompt: il miglior prodotto agganciato
  // con scheda a catalogo presta il suo URL; senza URL resta un [DA VERIFICARE] esplicito.
  const bestUrl = prodotti.find((p) => p.url)?.url ?? null;
  const standard = standardRaw.map((s) => resolveLinkPh(s, bestUrl));
  const storia = await purchaseHistory(sb, (conv.customer_email as string) ?? null);
  const conoscenza = await csKnowledge(sb, categoria);
  // v14: conversazioni PRECEDENTI dello stesso cliente (riassunti, max 5): l'AI sa se ha gia'
  // chiesto resi/cambi/solleciti senza rileggere i thread interi. Contesto, non fonte di promesse.
  let precedenti: string[] = [];
  if (conv.customer_email && conv.id) {
    const { data: altre } = await sb.from('cs_conversations')
      .select('subject,categoria,stato,last_msg_at,summary')
      .eq('customer_email', String(conv.customer_email)).neq('id', String(conv.id))
      .order('last_msg_at', { ascending: false }).limit(5);
    precedenti = ((altre ?? []) as Row[]).map((a) =>
      `- ${String(a.last_msg_at ?? '').slice(0, 10)} [${a.categoria ?? '?'}${a.stato ? '/' + a.stato : ''}] ${String(a.subject ?? '').slice(0, 80)}${a.summary ? ': ' + String(a.summary).slice(0, 200) : ''}`);
  }
  const fonti: string[] = [];
  for (const p of prodotti) fonti.push(`${p.item} ${p.variant}: disponibili ${p.disponibili}, giacenza ${p.giacenza}${p.prezzo != null ? `, prezzo ${p.prezzo}EUR` : ''}${p.on_shopify ? ', a catalogo' : ''} (v_inventory)`);
  for (const p of prodotti) if (p.url) fonti.push(`Link scheda ${p.item} ${p.variant}: ${p.url} (shopify_catalog)`);
  if (ordine) fonti.push(`Ordine #${ordine.order_number}: pagamento ${ordine.financial_status ?? 'n/d'}, evasione ${ordine.fulfillment_status ?? 'non evaso'}${ordine.fulfilled_at ? `, evaso il ${String(ordine.fulfilled_at).slice(0, 10)}` : ''} (shopify_orders)`);
  if (tracking) fonti.push(`Tracking ${tracking.corriere} ${tracking.numero} (Shopify Admin API, live)`);
  if (storia && storia.n_ordini > 0) fonti.push(`Cliente: ${storia.n_ordini} ordini, ${storia.totale}EUR totali (storico Shopify)`);
  return { dati: { prodotti, ordine, tracking, standard, fonti }, tono, order_admin_url, storia, gapExtra, conoscenza, precedenti };
}

function datiBlock(d: Dati): string {
  const L: string[] = [];
  if (d.prodotti.length) {
    L.push('PRODOTTI (giacenza/disponibilita/prezzo dal gestionale):');
    for (const p of d.prodotti) L.push(`- ${p.item} ${p.variant}: disponibili da vendere ${p.disponibili}, giacenza ${p.giacenza}${p.prezzo != null ? `, prezzo ${p.prezzo} EUR` : ''}${p.on_shopify ? ', a catalogo sul sito' : ', non a catalogo'}${p.url ? `, link scheda: ${p.url}` : p.on_shopify ? ', link scheda NON disponibile (non rimandare alla pagina del prodotto: se serve, usa [DA VERIFICARE: link scheda prodotto])' : ''}`);
    // v15: prodotto esaurito ma con scheda a catalogo -> la bozza deve dare il link dell'avviso restock
    const soldOutLink = d.prodotti.filter((p) => p.disponibili <= 0 && p.url);
    if (soldOutLink.length) L.push('NOTA RESTOCK: sulla scheda del prodotto esaurito (link qui sopra) c\'e\' il bottone "Avvisami quando torna disponibile": nella risposta INDICA quel link come il posto dove iscriversi all\'avviso ("qui puoi iscriverti per essere avvisata quando torna: <link>").');
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
  const { data: frows } = await sb.from('app_flags').select('key,value').in('key', ['gemini_api_key', 'cs_enabled', 'cs_reso_finestra_giorni', 'anthropic_api_key', 'cs_ai_model_claude', 'cs_ai_istruzioni']);
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
  // migr 0084: `cs_ai_model` -> `cs_ai_model_claude` (e' SOLO il nome del modello Claude, non il selettore di motore)
  const claudeModel = (flags.cs_ai_model_claude || 'claude-sonnet-5').trim();
  // model_override (harness eval, brief 29-07): A/B sulle stesse conversazioni senza toccare i flag
  // globali, e baseline Gemini rigenerabile anche DOPO l'inserimento della chiave Anthropic. Vale solo
  // per draft/refine (rami JWT: qui siamo gia' oltre il gate), allowlist esplicita, e MAI fallback
  // silenzioso su un altro modello: falserebbe il confronto.
  const MODEL_ALLOW = ['gemini-flash-latest', 'claude-sonnet-5'];
  const override = String(body.model_override || '').trim();
  if (override && !['draft', 'refine'].includes(action)) return json({ error: 'model_override vale solo per draft/refine' }, 400);
  if (override && !MODEL_ALLOW.includes(override)) return json({ error: `model_override non ammesso: "${override}" (ammessi: ${MODEL_ALLOW.join(', ')})` }, 400);
  const useClaude = override ? override.startsWith('claude-') : !!claudeKey;
  const effModel = override || (claudeKey ? claudeModel : MODEL_DRAFT);
  const haveLLM = !!claudeKey || !!key;
  // v12: il modello REALMENTE usato (il fallback puo' cambiarlo in corsa) finisce in cs_drafts.model
  let usedModel = effModel;
  let claudeFellBack: string | null = null;
  // bozze dell'harness marcate 'eval' (migr 0080): distinguibili con una query, la UI non le vede mai
  // (le opzioni mostrate arrivano dalla risposta live, cs_drafts non viene letta dal client).
  const draftSource = body.source === 'eval' ? 'eval' : 'app';
  // "come rispondere": istruzioni editabili dal team (app_flags.cs_ai_istruzioni), iniettate come CONTESTO
  // in ogni bozza. Guidano il tono; non superano MAI la regola anti-invenzione.
  const aiIstruzioni = (flags.cs_ai_istruzioni || '').trim();
  const istruzioniBlock = aiIstruzioni ? `\nISTRUZIONI DEL TEAM (come rispondere; priorita' sullo stile generico, MAI sull'anti-invenzione):\n${aiIstruzioni}\n` : '';
  // LLM unificato: Claude (system separato) se richiesto/configurato, altrimenti Gemini (system+user
  // concatenati). v12: nell'uso NORMALE (senza override) un errore Claude RIPIEGA su Gemini invece
  // di far morire la bozza (caso reale 31-07: chiave valida, credito API a zero, bozze tutte in
  // errore). Con override attivo OGNI fallback resta disattivato, anche il retry flash-lite: il
  // modello del run deve restare quello chiesto (integrita' dell'A/B), meglio un errore che un
  // dato falsato.
  const runLLM = async (system: string, userMsg: string, maxTok: number, jsonMode: boolean): Promise<string> => {
    if (useClaude) {
      try { const out = await claude(effModel, system, userMsg, claudeKey, maxTok); usedModel = effModel; return out; }
      catch (e) {
        if (override || !key) throw e;
        claudeFellBack = (e as Error).message.slice(0, 150);
        const out = await gemini(MODEL_DRAFT, system + '\n\n' + userMsg, key, maxTok, jsonMode);
        usedModel = MODEL_DRAFT;
        return out;
      }
    }
    try { const out = await gemini(effModel, system + '\n\n' + userMsg, key, maxTok, jsonMode); usedModel = effModel; return out; }
    catch (e) {
      if (jsonMode || override) throw e;
      const out = await gemini(MODEL_SUMMARY, system + '\n\n' + userMsg, key, maxTok, false);
      usedModel = MODEL_SUMMARY;
      return out;
    }
  };

  // notifica chat Shopify Inbox: al modello serve il messaggio del cliente, non il boilerplate della
  // notifica ("You have a new message from ... / Sent via Inbox / Reply in Inbox (url)").
  const stripChat = (t: string): string => {
    const m = (t || '').match(/new message from[^\n]*\n+([\s\S]*?)\n+\s*Sent via Inbox/i);
    return m ? m[1].trim() : (t || '');
  };

  // carica conversazione + testo del cliente (usato da context/dry_data/draft/refine)
  // v11: lingua SEMPRE caricata (serve a faqTono per scegliere testo_en anche su context)
  // v13: ogni messaggio porta `testo` = body_clean (fallback: stripChat/raw). Il PROMPT usa
  // `testo` (meno rumore); il CORPUS del linter usa il RAW body_text (i numeri citati restano
  // fatti consentiti). body_text nei row NON viene piu' sovrascritto.
  const loadConv = async (_withLingua = false): Promise<{ conv: Row; inbound: string; recent: Row[] } | null> => {
    const convId = String(body.conversation_id || '');
    const cols = 'id,canale,customer_email,customer_name,order_number,categoria,subject,lingua';
    const { data: conv } = await sb.from('cs_conversations').select(cols).eq('id', convId).maybeSingle();
    if (!conv) return null;
    // v14: THREAD INTERO (cap 30 messaggi, i piu' recenti): prima si vedevano solo gli ultimi 4
    const { data: msgs } = await sb.from('cs_messages').select('direction,body_text,body_clean,form_fields,sent_at').eq('conversation_id', convId).order('sent_at', { ascending: false }).limit(30);
    const recent = ((msgs ?? []) as Row[]).slice().reverse().map((m): Row => ({
      ...m,
      testo: String(m.body_clean ?? '') || (conv.canale === 'chat_notifica' ? stripChat(String(m.body_text ?? '')) : String(m.body_text ?? '')),
    }));
    const lastIn = [...recent].reverse().find((m) => m.direction === 'in') as Row | undefined;
    const inbound = [conv.subject, lastIn?.testo, lastIn?.form_fields ? JSON.stringify(lastIn.form_fields) : ''].filter(Boolean).join(' ');
    return { conv: conv as Row, inbound, recent };
  };
  // cronologia per il prompt (CLEAN) e per il corpus del linter (RAW, slice piu' larga: regex, zero AI)
  const threadClean = (recent: Row[], subject: unknown): string =>
    recent.map((m) => `${m.direction === 'out' ? 'Noi' : 'Cliente'}: ${String(m.testo ?? '').slice(0, 800)}`).join('\n') || String(subject ?? '');
  const threadRaw = (recent: Row[], subject: unknown): string =>
    recent.map((m) => `${m.direction === 'out' ? 'Noi' : 'Cliente'}: ${String(m.body_text ?? '').slice(0, 4000)}`).join('\n') || String(subject ?? '');

  // ---------- context / dry_data: assembla il CONTESTO, nessun Gemini ----------
  if (action === 'context' || action === 'dry_data') {
    const lc = await loadConv();
    if (!lc) return json({ error: 'conversazione inesistente' }, 404);
    const ctx = await assembleContext(sb, lc.conv, lc.inbound, token, (lc.conv.categoria as string) ?? null);
    // contratto di contesto: cosa manca per rispondere bene a QUESTA categoria (mostrato prima di generare)
    const gaps = [...contractGaps((lc.conv.categoria as string) ?? null, ctx.dati), ...ctx.gapExtra];
    return json({ ok: true, fonti: ctx.dati.fonti, gaps, order_admin_url: ctx.order_admin_url, storia: ctx.storia, dati: ctx.dati });
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
    const finestra = Number(flags.cs_reso_finestra_giorni) || 14;
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
      const { data: msgs } = await sb.from('cs_messages').select('direction,body_text,body_clean').eq('conversation_id', c.id as string).order('sent_at', { ascending: true }).limit(12);
      const thread = ((msgs ?? []) as Row[]).map((m) => `${m.direction === 'out' ? 'Noi' : 'Cliente'}: ${(String(m.body_clean ?? '') || String(m.body_text ?? '')).slice(0, 500)}`).join('\n');
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
    // chiave del motore RICHIESTO assente -> needs_key, mai ripiegare sull'altro (falserebbe l'A/B)
    if (useClaude && !claudeKey) return json({ ok: false, needs_key: true, error: 'model_override Claude ma anthropic_api_key assente: nessun fallback.' });
    if (!useClaude && !key) return json({ ok: false, needs_key: true, error: 'motore Gemini richiesto ma gemini_api_key assente.' });
    const lc = await loadConv(true);
    if (!lc) return json({ error: 'conversazione inesistente' }, 404);
    const conv = lc.conv;
    const ctx = await assembleContext(sb, conv, lc.inbound, token, (conv.categoria as string) ?? null);
    const threadTxt = threadClean(lc.recent, conv.subject);
    // motore dei verdetti: sulle categorie a caso (reso/cambio/indirizzo) il CASO e' calcolato dal codice
    // (con eventuale delivered_at confermata dalla collega) e VINCOLA la bozza. L'AI non decide, esegue.
    let casoTxt = '';
    if (CASE_CATS.has(String(conv.categoria ?? ''))) {
      const meta2 = ctx.dati.ordine ? await fetchOrderMeta(ctx.dati.ordine.order_number, token) : null;
      const cd = computeCaso(conv, ctx.dati.ordine, meta2, lc.inbound, Number(flags.cs_reso_finestra_giorni) || 14, String(body.delivered_at || '').trim() || null);
      casoTxt = casoBlock((conv.categoria as string) ?? null, cd);
    }

    // canale chat: la bozza verra' incollata nella chat di Shopify Inbox, non in una email
    const chatBlock = conv.canale === 'chat_notifica' ? `\nCANALE CHAT: la risposta verra' incollata nella CHAT del sito (Shopify Inbox), NON in una email: niente oggetto, niente intestazioni da email, messaggi corti stile chat (anche la versione "formale" resta un messaggio di chat, solo piu' composto).` : '';
    const system = `Sei chi risponde al servizio clienti di "Amimi'" (borse artigianali, Milano). Scrivi TRE versioni ALTERNATIVE della stessa risposta ${conv.canale === 'chat_notifica' ? 'in chat' : 'email'} al cliente, con toni diversi, tutte pronte da ritoccare. NON inviarle.
LE TRE VERSIONI (usa esattamente questi tre "tono"): "breve" = 2-3 righe, dritta al punto, cordiale; "calda" = piu' empatica e personale, un pizzico di calore; "formale" = piu' completa e composta, adatta a casi delicati.
${STYLE_RULES}${istruzioniBlock}${casoTxt}${chatBlock}`;
    const user = `Lingua: ${conv.lingua === 'en' ? 'inglese' : 'italiano'}. Categoria: ${conv.categoria ?? 'n/d'}. Cliente: ${conv.customer_name ?? ''}.
${ctx.conoscenza.length ? `\nCONOSCENZA DI CASA (regole e fatti Amimi'; se un valore qui contraddice il BLOCCO DATI, vince il BLOCCO DATI):\n${ctx.conoscenza.map((k) => '- ' + k).join('\n')}\n` : ''}${ctx.precedenti.length ? `\nCONVERSAZIONI PRECEDENTI DI QUESTO CLIENTE (contesto: tienine conto nel tono e nei riferimenti, NON promettere nulla in base a queste):\n${ctx.precedenti.join('\n')}\n` : ''}
Conversazione (il piu' recente e' del cliente):
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
          .replace(/Scrivi TRE versioni ALTERNATIVE della stessa risposta [^\n]+? al cliente, con toni diversi, tutte pronte da ritoccare\. NON inviarle\./, 'Scrivi UNA bozza di risposta al cliente, pronta da ritoccare. NON inviarla.')
          .replace(/LE TRE VERSIONI[^\n]*\n/, '');
        const usrSingle = user.replace(/Rispondi SOLO con JSON[\s\S]*$/, 'Scrivi SOLO la bozza (nessun JSON, nessun titolo, nessuna spiegazione, nessun markdown):');
        const single = await runLLM(sysSingle, usrSingle, 1000, false);
        if (single) opzioni = [{ tono: 'bozza', testo: tidy(single) }];
      } catch (e) { return json({ ok: false, error: (e as Error).message }, 502); }
    }
    if (!opzioni.length) return json({ ok: false, error: 'bozza vuota' }, 502);
    // linter di aderenza: ogni numero/data/URL della bozza deve esistere nel corpus dei fatti
    // consentiti. v13: il corpus usa il thread RAW (citazioni incluse), il prompt quello CLEAN.
    const lintCorpus = factKeys([
      threadRaw(lc.recent, conv.subject), datiBlock(ctx.dati), casoTxt, ctx.dati.fonti.join('\n'), ctx.tono.join('\n'),
      aiIstruzioni, STYLE_RULES, JSON.stringify(ctx.storia ?? ''), String(conv.order_number ?? ''),
      ctx.conoscenza.join('\n'), ctx.precedenti.join('\n'),   // v14: i valori di casa (14, 3.90, CAP...) sono fatti consentiti
    ].join('\n'));
    // v15: safety net sui segnaposto di LINK sopravvissuti alla generazione (url reale o rimozione)
    const bestUrlD = ctx.dati.prodotti.find((p) => p.url)?.url ?? null;
    const options = opzioni.slice(0, 3).map((o) => { const testo = scrubLinkPh(o.testo, bestUrlD); return { tono: o.tono, testo, da_verificare: countDaVerificare(testo), non_grounded: lintDraft(testo, lintCorpus) }; });

    const { data: ins } = await sb.from('cs_drafts').insert({ conversation_id: conv.id, testo: options[0].testo, dati_usati: ctx.dati as unknown as Row, model: usedModel, source: draftSource }).select('id').single();
    await sb.from('cs_events').insert({ conversation_id: conv.id, azione: 'draft', chi, dettaglio: { draft_id: ins?.id, n_options: options.length, ...(draftSource === 'eval' ? { source: 'eval', model: usedModel } : {}), ...(claudeFellBack ? { fallback_da_claude: claudeFellBack } : {}) } });
    return json({
      ok: true, options, draft: options[0].testo, da_verificare: options[0].da_verificare,   // draft = retro-compat
      fonti: ctx.dati.fonti, order_admin_url: ctx.order_admin_url, storia: ctx.storia, draft_id: ins?.id,
      ...(claudeFellBack ? { engine_fallback: 'gemini' } : {}),
    });
  }

  // ---------- refine: riscrivi una bozza data applicando un'istruzione (JWT), Claude o Gemini ----------
  if (action === 'refine') {
    if (!haveLLM) return json({ ok: false, needs_key: true, error: 'Nessun motore AI configurato (Gemini o Claude).' });
    if (useClaude && !claudeKey) return json({ ok: false, needs_key: true, error: 'model_override Claude ma anthropic_api_key assente: nessun fallback.' });
    if (!useClaude && !key) return json({ ok: false, needs_key: true, error: 'motore Gemini richiesto ma gemini_api_key assente.' });
    const testo = String(body.testo || '').trim();
    const istruzione = String(body.istruzione || '').trim();
    if (!testo || !istruzione) return json({ error: 'servono testo e istruzione' }, 422);
    const lc = await loadConv(true);
    if (!lc) return json({ error: 'conversazione inesistente' }, 404);
    const conv = lc.conv;
    const ctx = await assembleContext(sb, conv, lc.inbound, token, (conv.categoria as string) ?? null);

    const chatBlockR = conv.canale === 'chat_notifica' ? `\nCANALE CHAT: la risposta verra' incollata nella CHAT del sito (Shopify Inbox), NON in una email: niente oggetto, niente intestazioni da email, messaggio corto stile chat.` : '';
    const sysR = `Sei chi risponde al servizio clienti di "Amimi'". Ti do una BOZZA di risposta al cliente e una richiesta di modifica. Riscrivi la bozza applicando la modifica. NON inviarla.
${STYLE_RULES}${istruzioniBlock}${chatBlockR}`;
    const usrR = `Lingua: ${conv.lingua === 'en' ? 'inglese' : 'italiano'}.
RICHIESTA DI MODIFICA (dalla collega): ${istruzione.slice(0, 400)}

BOZZA ATTUALE:
${testo.slice(0, 2500)}

BLOCCO DATI (l'unica fonte di numeri che puoi usare):
${datiBlock(ctx.dati)}
${ctx.conoscenza.length ? `\nCONOSCENZA DI CASA (regole e fatti Amimi'; se contraddice il BLOCCO DATI, vince il BLOCCO DATI):\n${ctx.conoscenza.map((k) => '- ' + k).join('\n')}` : ''}
${ctx.tono.length ? `\nEsempi del NOSTRO tono (imita lo stile, non copiare i contenuti):\n${ctx.tono.map((t) => '- ' + t).join('\n')}` : ''}

Scrivi SOLO la nuova bozza (nessuna spiegazione, nessun oggetto, nessun markdown):`;

    let out = '';
    try { out = await runLLM(sysR, usrR, 800, false); }
    catch (e) { return json({ ok: false, error: (e as Error).message }, 502); }
    if (!out) return json({ ok: false, error: 'bozza vuota' }, 502);
    out = out.replace(/^\s*\*\*[^*\n]{2,24}\*\*\s*/i, '').replace(/\*\*/g, '').trim();
    out = scrubLinkPh(out, ctx.dati.prodotti.find((p) => p.url)?.url ?? null);   // v15: safety net link
    // linter di aderenza anche sulla riscrittura (la bozza di partenza NON e' fonte: potrebbe gia' inventare)
    // v13: corpus sul thread RAW (citazioni incluse), come su draft
    const lintCorpusR = factKeys([
      threadRaw(lc.recent, conv.subject), datiBlock(ctx.dati), ctx.dati.fonti.join('\n'), ctx.tono.join('\n'),
      aiIstruzioni, STYLE_RULES, JSON.stringify(ctx.storia ?? ''), String(conv.order_number ?? ''), istruzione,
      ctx.conoscenza.join('\n'),   // v14: i valori di casa sono fatti consentiti anche in riscrittura
    ].join('\n'));
    await sb.from('cs_events').insert({ conversation_id: conv.id, azione: 'refine', chi, dettaglio: { istruzione: istruzione.slice(0, 200), ...(claudeFellBack ? { fallback_da_claude: claudeFellBack } : {}) } });
    return json({ ok: true, draft: out, da_verificare: countDaVerificare(out), non_grounded: lintDraft(out, lintCorpusR), ...(claudeFellBack ? { engine_fallback: 'gemini' } : {}) });
  }

  return json({ error: 'azione sconosciuta: ' + action }, 422);
});
