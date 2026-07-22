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

// Tassonomia BLOCCATA (design 6.2): etichetta canonica + emoji. Stesso ordine del design.
export const CS_CATEGORIES: { label: string; emoji: string }[] = [
  { label: 'Spedizione e stato ordine', emoji: '📦' },
  { label: 'Restock e disponibilita', emoji: '🔁' },
  { label: 'Ritiro, negozio, appuntamenti', emoji: '🏠' },
  { label: 'Codice sconto', emoji: '💸' },
  { label: 'Personalizzazione e cerimonia', emoji: '💍' },
  { label: 'Gift card e account', emoji: '🎁' },
  { label: 'Reso e rimborso', emoji: '↩️' },
  { label: 'Cambio e prodotto errato', emoji: '🔄' },
  { label: 'Info prodotto', emoji: 'ℹ️' },
  { label: 'Riparazione', emoji: '🔧' },
  { label: 'Pagamento', emoji: '💳' },
  { label: 'Collaborazioni e B2B', emoji: '📢' },
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

const CS_ASSIST_URL = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/cs-assist';

export type Bozza = { draft: string; fonti: string[]; da_verificare: number };

/** Genera una BOZZA di risposta con dati reali (Fase 3). JWT-gated (edge cs-assist): passa l'access token
 *  dell'utente loggato. Il recupero dati (giacenza/ordine/tracking) e' deterministico nell'edge; Gemini scrive
 *  usando SOLO quel blocco, con [DA VERIFICARE] dove un dato manca. NON invia (Fase 4). */
export async function generateDraft(conversationId: string, chi: string): Promise<Bozza> {
  const { data } = await csClient.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessione scaduta: rientra.');
  const r = await fetch(CS_ASSIST_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ action: 'draft', conversation_id: conversationId, chi }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || (j.needs_key ? 'Gemini non configurato' : 'Errore ' + r.status));
  return { draft: String(j.draft || ''), fonti: (j.fonti || []) as string[], da_verificare: Number(j.da_verificare || 0) };
}
