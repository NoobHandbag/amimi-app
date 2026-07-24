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
    .select('id,direction,sent_by,from_email,to_email,sent_at,body_text,is_via_tool,form_fields')
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

/** "Non e' un cliente": aggiunge il mittente alla denylist rumore (le prossime mail non entrano in coda)
 *  e sposta QUESTA conversazione nel Rumore. Reversibile a mano (denylist in app_flags, vista Rumore). */
export async function addNoise(conversationId: string, sender: string, chi: string): Promise<void> {
  await callCsApi({ action: 'add_noise', conversation_id: conversationId, sender, chi });
}

const CS_ASSIST_URL = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/cs-assist';

export type OrderHistory = { n_ordini: number; totale: number; prima: string | null; ultima: string | null; recenti: { numero: number; data: string; totale: number; stato: string | null }[] };
export type CsContext = { fonti: string[]; order_admin_url: string | null; storia: OrderHistory | null };
export type DraftOption = { tono: string; testo: string; da_verificare: number };

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
  return { fonti: (j.fonti || []) as string[], order_admin_url: (j.order_admin_url as string) ?? null, storia: (j.storia as OrderHistory) ?? null };
}

// --- Motore dei verdetti (design Parte B): il codice decide il caso, l'AI scrive la frase ---
export const CASE_CATS = new Set(['Reso e rimborso', 'Cambio e prodotto errato', 'Modifica / correzione indirizzo']);
export type CasoReso = { delivered_at: string | null; fonte: string | null; giorni: number | null; finestra: number; verdetto: 'entro' | 'fuori' | 'sconosciuto'; difetto_sospetto: boolean };
export type CasoIndirizzo = { fulfillment_presente: boolean; caso: 'correggibile' | 'verificare_tracking' | 'consegnato' | 'sconosciuto' };
export type CaseData = { categoria: string | null; verificato: boolean; reso: CasoReso; indirizzo: CasoIndirizzo; tracking_url: string | null; order_admin_url: string | null };

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
export async function generateOptions(conversationId: string, chi: string, deliveredAt?: string): Promise<{ options: DraftOption[]; fonti: string[]; order_admin_url: string | null; storia: OrderHistory | null }> {
  const j = await callAssist({ action: 'draft', conversation_id: conversationId, chi, ...(deliveredAt ? { delivered_at: deliveredAt } : {}) });
  const options = (j.options || []) as DraftOption[];
  return {
    options: options.length ? options : [{ tono: 'bozza', testo: String(j.draft || ''), da_verificare: Number(j.da_verificare || 0) }],
    fonti: (j.fonti || []) as string[], order_admin_url: (j.order_admin_url as string) ?? null, storia: (j.storia as OrderHistory) ?? null,
  };
}

/** Riscrive la bozza corrente applicando un'istruzione della collega ("più formale", "aggiungi X"),
 *  sempre vincolata ai dati reali. */
export async function refineDraft(conversationId: string, chi: string, testo: string, istruzione: string): Promise<{ draft: string; da_verificare: number }> {
  const j = await callAssist({ action: 'refine', conversation_id: conversationId, chi, testo, istruzione });
  return { draft: String(j.draft || ''), da_verificare: Number(j.da_verificare || 0) };
}
