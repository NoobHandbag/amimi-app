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
  parse_failed: boolean;
  created_at: string;
};

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

const CONV_COLS = 'id,gmail_thread_id,canale,customer_email,customer_name,stato,stato_by,last_msg_at,last_direction,subject,snippet,order_number,lingua,parse_failed,created_at';

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
