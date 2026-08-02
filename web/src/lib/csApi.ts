import { csClient } from './csClient';

// Letture della sezione Assistenza (Fase 1, SOLA LETTURA). Tutto passa dal client con la sessione
// utente: se non loggati, la RLS `authenticated` nega e le query tornano vuote/errore.

export type Canale = 'email_diretta' | 'form_contatto' | 'form_evento' | 'chat_notifica' | 'rumore';

export type CsConversation = {
  id: string;
  gmail_thread_id: string;
  canale: Canale;
  customer_email: string | null;
  customer_name: string | null;
  stato: string;
  stato_by: string | null;
  last_msg_at: string | null;
  last_direction: string | null;
  subject: string | null;
  snippet: string | null;
  order_number: number | null;
  lingua: string | null;
  categoria: string | null;
  categoria_source: string | null;      // ai | ai_low | manuale
  categoria_confidence: number | null;
  urgente: boolean | null;
  urgenza_motivo: string | null;
  flags: string[] | null;               // sollecito | reclamo_assistenza | chiusura
  summary: string | null;               // riassunto+storia 2 righe (Fase 3, cs-assist)
  parse_failed: boolean;
  created_at: string;
};

// Tassonomia BLOCCATA (design 6.2), ORDINATA PER FREQUENZA REALE via email (golden set 211,
// ANALISI casella 22-07: Spedizione 18%, Restock 14%, Ritiro 13%, Cambio 9%, Sconto 9%,
// Personalizzazione 8%, Reso 7%, Collab 7%, Info 4%, Riparazione 2%, Pagamento/Gift/Altro 1-2%;
// Modifica indirizzo = "frequente" dalla riunione 23-07, senza % storica: messa dopo Reso).
export const CS_CATEGORIES: { label: string; emoji: string }[] = [
  { label: 'Spedizione e stato ordine', emoji: '📦' },
  { label: 'Restock e disponibilita', emoji: '🔁' },
  { label: 'Ritiro, negozio, appuntamenti', emoji: '🏠' },
  { label: 'Cambio e prodotto errato', emoji: '🔄' },
  { label: 'Codice sconto', emoji: '💸' },
  { label: 'Personalizzazione e cerimonia', emoji: '💍' },
  { label: 'Reso e rimborso', emoji: '↩️' },
  { label: 'Modifica / correzione indirizzo', emoji: '📍' },
  { label: 'Collaborazioni e B2B', emoji: '📢' },
  { label: 'Info prodotto', emoji: 'ℹ️' },
  { label: 'Riparazione', emoji: '🔧' },
  { label: 'Pagamento', emoji: '💳' },
  { label: 'Gift card e account', emoji: '🎁' },
  { label: 'Altro / richiesta varia', emoji: '💬' },
];
export const catEmoji = (label: string | null): string => CS_CATEGORIES.find((c) => c.label === label)?.emoji ?? '🏷️';

export type CsMessage = {
  id: string;
  direction: string;
  sent_by: string | null;
  from_email: string | null;
  to_email: string | null;
  sent_at: string | null;
  body_text: string | null;
  body_clean: string | null;    // solo le parole del mittente (cs-sync stripQuoted, migr 0081); NULL = fallback su body_text
  is_via_tool: boolean;
  form_fields: Record<string, string> | null;
};

const CONV_COLS = 'id,gmail_thread_id,canale,customer_email,customer_name,stato,stato_by,last_msg_at,last_direction,subject,snippet,order_number,lingua,categoria,categoria_source,categoria_confidence,urgente,urgenza_motivo,flags,summary,parse_failed,created_at';

/** Coda cliente: tutto tranne il rumore, piu' recenti in cima. */
export async function fetchConversations(): Promise<CsConversation[]> {
  const { data, error } = await csClient
    .from('cs_conversations').select(CONV_COLS)
    .neq('canale', 'rumore')
    .order('last_msg_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CsConversation[];
}

/** Vista Rumore: solo canale=rumore (controllo che il filtro non abbia nascosto un cliente). */
export async function fetchRumore(): Promise<CsConversation[]> {
  const { data, error } = await csClient
    .from('cs_conversations').select(CONV_COLS)
    .eq('canale', 'rumore')
    .order('last_msg_at', { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as CsConversation[];
}

export async function fetchMessages(conversationId: string): Promise<CsMessage[]> {
  const { data, error } = await csClient
    .from('cs_messages')
    .select('id,direction,sent_by,from_email,to_email,sent_at,body_text,body_clean,is_via_tool,form_fields')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true, nullsFirst: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CsMessage[];
}

const CS_SYNC_URL = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/cs-sync';

/** Forza subito un giro di lettura della posta (stesso ingest del cron, PIN-gated, idempotente):
 *  cosi' il refresh della coda mostra le mail arrivate negli ultimi minuti senza aspettare il cron.
 *  Non lancia: un errore di rete non deve bloccare il reload (la coda si ricarica comunque). */
export async function csPollNow(): Promise<void> {
  try {
    await fetch(CS_SYNC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: 'x', action: 'poll' }),
    });
  } catch { /* ignora */ }
}

const CS_API_URL = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/cs-api';

/** Correzione manuale della categoria (PRIMA scrittura dalla UI). Passa l'access token dell'utente
 *  loggato: la edge cs-api lo verifica (getUser + @amimi.it) e scrive col service_role, tracciando
 *  `chi` (l'identita' del selettore, non il login). categoria=null riporta a "da confermare". */
export async function setCategoria(conversationId: string, categoria: string | null, chi: string): Promise<void> {
  const { data } = await csClient.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessione scaduta: rientra.');
  const r = await fetch(CS_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ action: 'set_categoria', conversation_id: conversationId, categoria, chi }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || ('Errore ' + r.status));
}

async function callCsApi(bodyObj: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await csClient.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessione scaduta: rientra.');
  const r = await fetch(CS_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(bodyObj),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || ('Errore ' + r.status));
  return j as Record<string, unknown>;
}

// --- Motore AI: quale motore risponde + istruzioni "come rispondere" editabili dal team (feedback 24-07) ---
export type AiConfig = { istruzioni: string; provider: 'claude' | 'gemini'; model: string };
export async function getAiConfig(): Promise<AiConfig> {
  const j = await callCsApi({ action: 'get_ai_config' });
  return { istruzioni: String(j.istruzioni ?? ''), provider: j.provider === 'claude' ? 'claude' : 'gemini', model: String(j.model ?? '') };
}
export async function setAiIstruzioni(istruzioni: string, chi: string): Promise<void> {
  await callCsApi({ action: 'set_ai_istruzioni', istruzioni, chi });
}

export type Stato = 'da_fare' | 'in_corso' | 'fatto';
/** Workflow coda: da_fare (da iniziare) -> in_corso (presa in carico da `chi`) -> fatto (conclusa).
 *  Tornare a da_fare azzera l'assegnazione. Scrive via cs-api (JWT) + cs_events 'stato'. */
export async function setStato(conversationId: string, stato: Stato, chi: string): Promise<void> {
  await callCsApi({ action: 'set_stato', conversation_id: conversationId, stato, chi });
}

/** v24 (schema RAMI): registra quale ESITO l'operatrice ha davvero usato. Si chiama DOPO l'invio
 *  riuscito (o dopo la copia in Inbox sul canale chat), mai al click di anteprima: una bozza
 *  guardata non e' una bozza scelta. Best-effort per costruzione: e' telemetria, e non deve mai
 *  trasformare un invio riuscito in un errore a video. Idempotente lato edge (la prima scelta vince). */
export async function recordRamo(draftId: string, ramo: string, chi: string): Promise<void> {
  try { await callCsApi({ action: 'draft_ramo', draft_id: draftId, ramo, chi }); } catch { /* niente */ }
}

/** Salva il testo su cui si sta lavorando dentro la bozza (brief cs_crop_residui_e_versione, parte 3).
 *  Senza, `cs_drafts.testo` resta il primo getto del modello e una bozza ricaricata sarebbe DIVERSA
 *  da quella che l'operatrice aveva davanti. Best-effort: se fallisce non si interrompe il lavoro. */
export async function salvaTestoBozza(draftId: string, testo: string): Promise<void> {
  try { await callCsApi({ action: 'draft_testo', draft_id: draftId, testo }); } catch { /* niente */ }
}

/** L'ultima bozza salvata per la conversazione, con la data. Lettura diretta da PostgREST col JWT
 *  dell'utente (stessa via delle altre letture cs_*): nessuna spesa AI, nessuna edge. */
export type BozzaSalvata = { id: string; testo: string; created_at: string; edited: boolean; fonti: string[] };
export async function ultimaBozza(conversationId: string): Promise<BozzaSalvata | null> {
  const { data, error } = await csClient.from('cs_drafts')
    .select('id, testo, created_at, edited, dati_usati, source')
    .eq('conversation_id', conversationId).eq('source', 'app')
    .order('created_at', { ascending: false }).limit(1);
  if (error || !data || !data.length) return null;
  const r = data[0] as { id: string; testo: string | null; created_at: string; edited: boolean | null; dati_usati: { fonti?: string[] } | null };
  if (!r.testo || !r.testo.trim()) return null;
  return { id: r.id, testo: r.testo, created_at: r.created_at, edited: r.edited === true, fonti: r.dati_usati?.fonti ?? [] };
}

/** "Non e' un cliente": aggiunge il mittente alla denylist rumore (le prossime mail non entrano in coda)
 *  e sposta QUESTA conversazione nel Rumore. Reversibile a mano (denylist in app_flags, vista Rumore). */
export async function addNoise(conversationId: string, sender: string, chi: string): Promise<void> {
  await callCsApi({ action: 'add_noise', conversation_id: conversationId, sender, chi });
}

/** Gesto INVERSO (brief rumore vendor, 01-08): riporta la conversazione dal Rumore alla coda
 *  (canale email_diretta) e toglie il mittente esatto dalla denylist. Se a bloccare e' una voce
 *  di DOMINIO, la voce resta (coprirebbe altri mittenti) e viene ritornata per mostrarla. */
export async function removeNoise(conversationId: string, chi: string): Promise<{ dominio_che_blocca: string | null }> {
  const j = await callCsApi({ action: 'remove_noise', conversation_id: conversationId, chi });
  return { dominio_che_blocca: (j as { dominio_che_blocca?: string | null }).dominio_che_blocca ?? null };
}

const CS_ASSIST_URL = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/cs-assist';

export type OrderHistory = { n_ordini: number; totale: number; prima: string | null; ultima: string | null; recenti: { numero: number; data: string; totale: number; stato: string | null }[] };
// dati gia' recuperati dal context (cs-assist assembleContext): alimentano la strip "fatti" della testata
export type CtxOrdine = { order_number: number | null; gross_total: number | null; fulfillment_status: string | null; created_at_shop: string | null; righe: { nome: string; qta: number }[] };
export type CtxTracking = { numero: string; url: string; corriere: string };
// brief cs_info_utili: il prodotto agganciato e lo stato del corriere. NON sono un recupero nuovo:
// l'azione `context` di cs-assist restituisce gia' `dati` per intero (prodotti, ordine, tracking,
// ship), era questo client a tenersi solo ordine e tracking e a buttare via il resto. Zero chiamate
// in piu', zero costo AI: cambia solo cosa leggiamo della risposta che arriva gia'.
export type CtxProdotto = { item: string; variant: string; prezzo: number | null; giacenza: number; disponibili: number; on_shopify: boolean; url: string | null };
export type CtxShip = { stato_tws: string; consegnata_il: string | null; updated_at: string };
export type CsContext = { fonti: string[]; gaps?: string[]; order_admin_url: string | null; storia: OrderHistory | null; ordine?: CtxOrdine | null; tracking?: CtxTracking | null; prodotti?: CtxProdotto[]; ship?: CtxShip | null };
// non_grounded = linter di aderenza server-side: numeri/date/URL della bozza NON trovati nei dati reali
// v19: `troncata` = il testo non finisce con punteggiatura o emoji, cioe' la generazione si e'
// interrotta a meta'. Non e' un dettaglio estetico: e' testo che l'operatrice puo' inviare.
// v24 (schema RAMI, flag `cs_rami_enabled`): `titolo` = l'ESITO che l'alternativa assume, in massimo
// 5 parole. Presente solo col nuovo schema; col vecchio la scelta resta l'etichetta di `tono`.
export type DraftOption = { tono: string; titolo?: string; testo: string; da_verificare: number; non_grounded?: string[]; troncata?: boolean };

// Header JWT dell'utente loggato (edge cs-assist verifica getUser + @amimi.it).
async function jwtHeaders(): Promise<Record<string, string>> {
  const { data } = await csClient.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessione scaduta: rientra.');
  return { 'content-type': 'application/json', authorization: 'Bearer ' + token };
}
async function callAssist(bodyObj: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(CS_ASSIST_URL, { method: 'POST', headers: await jwtHeaders(), body: JSON.stringify(bodyObj) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || (j.needs_key ? 'AI non configurata' : 'Errore ' + r.status));
  return j as Record<string, unknown>;
}

/** CONTESTO del thread (nessuna spesa AI): link ordine Shopify + storico acquisti cliente + fonti.
 *  Chiamata all'apertura del thread per popolare la testata. */
export async function fetchContext(conversationId: string): Promise<CsContext> {
  const j = await callAssist({ action: 'context', conversation_id: conversationId });
  const dati = (j.dati ?? {}) as { ordine?: unknown; tracking?: unknown; prodotti?: unknown; ship?: unknown };
  const o = dati.ordine as Record<string, unknown> | null | undefined;
  const ordine: CtxOrdine | null = o ? {
    order_number: o.order_number == null ? null : Number(o.order_number),
    gross_total: o.gross_total == null ? null : Number(o.gross_total),
    fulfillment_status: (o.fulfillment_status as string) ?? null,
    created_at_shop: (o.created_at_shop as string) ?? null,
    righe: Array.isArray(o.righe) ? (o.righe as { nome: string; qta: number }[]) : [],
  } : null;
  return {
    fonti: (j.fonti || []) as string[], gaps: (j.gaps || []) as string[],
    order_admin_url: (j.order_admin_url as string) ?? null, storia: (j.storia as OrderHistory) ?? null,
    ordine, tracking: (dati.tracking as CtxTracking) ?? null,
    prodotti: Array.isArray(dati.prodotti) ? (dati.prodotti as CtxProdotto[]) : [],
    ship: (dati.ship as CtxShip) ?? null,
  };
}

// --- Motore dei verdetti (design Parte B): il codice decide il caso, l'AI scrive la frase ---
export const CASE_CATS = new Set(['Reso e rimborso', 'Cambio e prodotto errato', 'Modifica / correzione indirizzo']);
// v14: la finestra reso decorre dalla DATA DELL'ORDINE (ordine_del); delivered_at resta come info
// e per il caso indirizzo ('consegnato', confermabile dalla collega dal tracking).
// v18: 'non_applicabile' = l'ordine e' agganciato ma la finestra non c'entra (rimborsato, annullato,
// oppure merce ancora non ritirata dal corriere). Diverso da 'sconosciuto', che vuol dire "non so
// di che ordine parliamo". Il campo puo' mancare se l'edge live e' ancora a una versione precedente.
export type NonApplicabile = 'rimborsato' | 'rimborsato_parziale' | 'annullato' | 'pre_ritiro';
export type CasoReso = { ordine_del: string | null; delivered_at: string | null; fonte: string | null; giorni: number | null; finestra: number; verdetto: 'entro' | 'fuori' | 'non_applicabile' | 'sconosciuto'; non_applicabile?: NonApplicabile | null; stato_pagamento?: string | null; difetto_sospetto: boolean };
export type CasoIndirizzo = { fulfillment_presente: boolean; caso: 'correggibile' | 'verificare_tracking' | 'consegnato' | 'sconosciuto' };
// v25: `rami` = gli ESITI ammessi dal motore dei verdetti per questo caso (uno solo quando i dati
// decidono). Oggi nessuna schermata li mostra: servono a vedere cosa il motore ha deciso senza
// dover leggere il prompt, e sono la stessa lista che finisce nel blocco CASO della bozza.
export type CaseData = { categoria: string | null; verificato: boolean; reso: CasoReso; indirizzo: CasoIndirizzo; rami?: { titolo: string; istruzione: string }[]; tracking_url: string | null; order_admin_url: string | null; stato_tws?: string | null; stato_tws_aggiornato?: string | null };

/** Verdetto del caso (reso/cambio/indirizzo), calcolato dal CODICE (nessuna AI). `deliveredAt` opzionale =
 *  data di consegna CONFERMATA dalla collega dal tracking (il verdetto resta deterministico). Se l'edge live
 *  non ha ancora l'azione (deploy pending) la chiamata fallisce: il chiamante nasconde il pannello. */
export async function fetchCaseData(conversationId: string, deliveredAt?: string): Promise<CaseData> {
  const j = await callAssist({ action: 'case_data', conversation_id: conversationId, ...(deliveredAt ? { delivered_at: deliveredAt } : {}) });
  return j as unknown as CaseData;
}

/** Genera 3 opzioni di risposta (toni breve/calda/formale) con dati reali. JWT-gated; Gemini scrive usando
 *  SOLO il blocco DATI, con [DA VERIFICARE] dove un dato manca. Sui casi (reso/indirizzo) il verdetto del
 *  sistema VINCOLA la bozza; `deliveredAt` = data confermata dalla collega. NON invia (Fase 4). */
export async function generateOptions(conversationId: string, chi: string, deliveredAt?: string): Promise<{ options: DraftOption[]; fonti: string[]; order_admin_url: string | null; storia: OrderHistory | null; fallbackSingola: boolean; troncate: number; schema: 'rami' | 'toni'; draftId: string | null }> {
  const j = await callAssist({ action: 'draft', conversation_id: conversationId, chi, ...(deliveredAt ? { delivered_at: deliveredAt } : {}) });
  const options = (j.options || []) as DraftOption[];
  return {
    options: options.length ? options : [{ tono: 'bozza', testo: String(j.draft || ''), da_verificare: Number(j.da_verificare || 0) }],
    fonti: (j.fonti || []) as string[], order_admin_url: (j.order_admin_url as string) ?? null, storia: (j.storia as OrderHistory) ?? null,
    // v24: quale schema ha prodotto queste alternative (toni oppure rami), e l'id della bozza, che
    // serve a registrare DOPO l'invio quale ramo e' stato davvero usato.
    schema: j.schema === 'rami' ? 'rami' : 'toni',
    draftId: (j.draft_id as string) ?? null,
    // cs-assist v17: la generazione a 3 opzioni si e' interrotta e si e' ripiegato su una bozza sola.
    // Serve dirlo: una opzione invece di tre, senza spiegazione, sembrava un capriccio del tool.
    fallbackSingola: j.fallback_singola === true,
    // v19: quante opzioni risultano tagliate a meta'. La edge riprova gia' da sola con piu' budget:
    // se arriva qui vuol dire che non e' bastato, e l'operatrice deve saperlo PRIMA di inviare.
    troncate: Number(j.troncate || 0),
  };
}

/** Riscrive la bozza corrente applicando un'istruzione della collega ("più formale", "aggiungi X"),
 *  sempre vincolata ai dati reali. */
export async function refineDraft(conversationId: string, chi: string, testo: string, istruzione: string): Promise<{ draft: string; da_verificare: number; non_grounded: string[] }> {
  const j = await callAssist({ action: 'refine', conversation_id: conversationId, chi, testo, istruzione });
  return { draft: String(j.draft || ''), da_verificare: Number(j.da_verificare || 0), non_grounded: (j.non_grounded || []) as string[] };
}

const CS_SEND_URL = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/cs-send';

export type SendResult = { to: string; subject: string; stato_auto: boolean; already_sent: boolean; warnings: string[] };
/** FASE 4 — INVIO dall'app (edge dedicata cs-send, JWT). Parte SOLO dal dialog di conferma:
 *  email_diretta = risposta nello stesso thread Gmail; form_contatto/form_evento = email nuova a
 *  customer_email (mai al wrapper Shopify). `sendKey` (uuid, generata all'apertura del dialog) e'
 *  l'anti doppio invio: doppio click o retry di rete con la stessa chiave non producono una
 *  seconda email. `warnings` = contabilita' post-invio fallita (la mail e' comunque partita). */
export async function sendReply(conversationId: string, chi: string, testo: string, sendKey: string): Promise<SendResult> {
  const { data } = await csClient.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessione scaduta: rientra.');
  const r = await fetch(CS_SEND_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ action: 'send', conversation_id: conversationId, chi, testo, send_key: sendKey }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    // cs-send v7: rifiuto STRUTTURALE = ripremere Invia dara' lo stesso esito. Il flag viaggia
    // sull'errore perche' la UI possa spegnere il bottone invece di lasciarlo acceso sotto il
    // messaggio rosso (brief cs_crop_e_dati_falsi 3.1).
    const e = new Error(j.error || ('Errore ' + r.status)) as Error & { bloccante?: boolean };
    if (j.bloccante === true) e.bloccante = true;
    throw e;
  }
  return {
    to: String(j.to || ''), subject: String(j.subject || ''), stato_auto: j.stato_auto === true,
    already_sent: j.already_sent === true, warnings: (j.warnings || []) as string[],
  };
}
