import { csClient } from './csClient';

// Letture della sezione Assistenza (Fase 1, SOLA LETTURA). Tutto passa dal client con la sessione
// utente: se non loggati, la RLS `authenticated` nega e le query tornano vuote/errore.

// chat_sito (13-11, chat del sito pezzo 6): le chat del widget nostro proiettate da chat_ (migr 0193); chat_notifica = le
// notifiche email delle chat di Shopify Inbox ("Chat Inbox").
export type Canale = 'email_diretta' | 'form_contatto' | 'form_evento' | 'chat_notifica' | 'chat_sito' | 'rumore';

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
  gmail_message_id?: string;    // chat del sito: 'chat:<id di chat_messaggi>' (esito dell'email della risposta)
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

// Regola 20 (b), punto 6 di PROPOSTA_chat_sito 7.6: senza limite PostgREST taglia in silenzio a 1.000 righe, e con le chat
// la coda ci arriva in qualche mese. Le aperte si leggono TUTTE a pagine (sono poche: 3 al 13-11); delle concluse solo le
// piu' recenti, poi "Carica le concluse piu' vecchie". Concluse a CURSORE (Gate 2, B1): ordine stabile (last_msg_at
// decrescente con i null in fondo, poi id) e la pagina dopo parte dall'ultima riga gia' in mano, non da un offset, cosi'
// una conclusa riaperta o una nuova fra due letture non fa saltare ne' ripetere righe.
export const PAGINA_CONCLUSE = 300;
const PAGINA = 1000;
export type CursoreConcluse = { last_msg_at: string | null; id: string };
/** L'ultima conclusa nell'ordine della coda: da li' parte la pagina dopo. */
export function cursoreDi(convs: CsConversation[]): CursoreConcluse | null {
  const ord = (a: CsConversation, b: CsConversation) => {
    if (a.last_msg_at !== b.last_msg_at) {
      if (a.last_msg_at === null) return 1;
      if (b.last_msg_at === null) return -1;
      return a.last_msg_at < b.last_msg_at ? 1 : -1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  const ultima = convs.filter((c) => c.stato === 'fatto').sort(ord).pop();
  return ultima ? { last_msg_at: ultima.last_msg_at, id: ultima.id } : null;
}
export async function fetchConcluse(dopo: CursoreConcluse | null, quante = PAGINA_CONCLUSE): Promise<CsConversation[]> {
  let q = csClient
    .from('cs_conversations').select(CONV_COLS)
    .neq('canale', 'rumore').eq('stato', 'fatto');
  if (dopo) {
    q = dopo.last_msg_at === null
      ? q.is('last_msg_at', null).gt('id', dopo.id)
      : q.or(`last_msg_at.lt."${dopo.last_msg_at}",and(last_msg_at.eq."${dopo.last_msg_at}",id.gt.${dopo.id}),last_msg_at.is.null`);
  }
  const { data, error } = await q
    .order('last_msg_at', { ascending: false, nullsFirst: false }).order('id', { ascending: true })
    .limit(quante);
  if (error) throw new Error(error.message);
  return (data ?? []) as CsConversation[];
}
/** Coda cliente: tutto tranne il rumore, piu' recenti in cima. Aperte tutte, concluse le ultime PAGINA_CONCLUSE;
 *  `altreConcluse` = la pagina delle concluse era piena (ce ne possono essere di piu' vecchie). */
export async function fetchCoda(): Promise<{ convs: CsConversation[]; altreConcluse: boolean }> {
  const aperte: CsConversation[] = [];
  for (let pagina = 0; pagina < 20; pagina++) {
    const { data, error } = await csClient
      .from('cs_conversations').select(CONV_COLS)
      .neq('canale', 'rumore').neq('stato', 'fatto')
      .order('last_msg_at', { ascending: false, nullsFirst: false }).order('id', { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error) throw new Error(error.message);
    aperte.push(...((data ?? []) as CsConversation[]));
    if ((data ?? []).length < PAGINA) break;
  }
  const concluse = await fetchConcluse(null);
  // una conversazione che cambia stato fra le due letture non compare due volte (vince la lettura delle aperte, Gate 2 C1)
  const ids = new Set(aperte.map((c) => c.id));
  return { convs: [...aperte, ...concluse.filter((c) => !ids.has(c.id))], altreConcluse: concluse.length >= PAGINA_CONCLUSE };
}
export async function fetchConversations(): Promise<CsConversation[]> {
  return (await fetchCoda()).convs;
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
    .select('id,gmail_message_id,direction,sent_by,from_email,to_email,sent_at,body_text,body_clean,is_via_tool,form_fields')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true, nullsFirst: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CsMessage[];
}

// ---- chat del sito (pezzo 6, PROPOSTA_chat_sito 7.6 e 7.8): la chat sta in chat_ (fonte di verita'), Assistenza ne
// legge la proiezione in cs_ e chiama chat-staff per ogni azione. Letture col JWT del team: chat_sessioni e chat_messaggi
// hanno grant per colonna al solo team (migr 0186), quindi qui si elencano le colonne, mai select=*.
export const sessioneDiChat = (c: { gmail_thread_id?: string | null }): string | null => {
  const m = /^chat:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(c.gmail_thread_id ?? '');
  return m ? m[1].toLowerCase() : null;
};
export const isChatSito = (c: { canale?: string | null; gmail_thread_id?: string | null }): boolean => c.canale === 'chat_sito' || sessioneDiChat(c) !== null;
export type ChatSessione = {
  id: string; stato: 'bot' | 'attesa_persona' | 'aperta' | 'chiusa'; preso_da: string | null; customer_email: string; shopify_customer_id: string | null;
  lingua: string; prova: boolean; passaggi: number; passaggio_at: string | null; ultima_risposta_staff_at: string | null; chiusa_at: string | null; gmail_thread_id: string | null;
};
export type ChatEmail = { id: string; seq: number; autore: string; email_stato: 'prenotata' | 'inviata' | 'errore' | null; email_errore: string | null; email_at: string | null; delivered_at: string | null };
export async function fetchChatSessione(sessioneId: string): Promise<ChatSessione | null> {
  const { data, error } = await csClient.from('chat_sessioni')
    .select('id,stato,preso_da,customer_email,shopify_customer_id,lingua,prova,passaggi,passaggio_at,ultima_risposta_staff_at,chiusa_at,gmail_thread_id')
    .eq('id', sessioneId).limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as ChatSessione | undefined) ?? null;
}
/** Per id del messaggio (la proiezione lo porta in cs_messages come chat:<id>): l'ordine vero (`seq`: bottone e risposta
 *  fissa hanno lo stesso istante, Gate 2 C2) e l'esito dell'email delle risposte dello staff. Una chat ha al massimo 100
 *  messaggi della cliente, piu' le risposte: 1.000 bastano. */
export async function fetchChatEmail(sessioneId: string): Promise<Record<string, ChatEmail>> {
  const { data, error } = await csClient.from('chat_messaggi')
    .select('id,seq,autore,email_stato,email_errore,email_at,delivered_at')
    .eq('sessione_id', sessioneId).order('seq', { ascending: true }).limit(1000);
  if (error) throw new Error(error.message);
  return Object.fromEntries(((data ?? []) as ChatEmail[]).map((m) => [m.id, m]));
}
/** La card email della risposta della cliente al thread di chat-send (7.9): stesso gmail_thread_id. */
export async function fetchCardDelThread(threadId: string): Promise<CsConversation | null> {
  const { data, error } = await csClient.from('cs_conversations').select(CONV_COLS).eq('gmail_thread_id', threadId).limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as CsConversation | undefined) ?? null;
}
const CHAT_STAFF_URL = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/chat-staff';
async function callChatStaff(bodyObj: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await csClient.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessione scaduta: rientra.');
  const r = await fetch(CHAT_STAFF_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(bodyObj),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(ERRORI_CHAT[String(j.error ?? '')] ?? (j.error ? String(j.error) : 'Errore ' + r.status));
  return j as Record<string, unknown>;
}
const ERRORI_CHAT: Record<string, string> = {
  chiusa: 'La chat è chiusa: non riceve più risposte. Se la cliente riscrive, si apre una chat nuova.',
  gia_inviata: 'L’email era già partita (l’ha mandata il giro automatico).',
  in_corso: 'L’email sta partendo proprio ora: aggiorna tra qualche secondo.',
  cambiato: 'L’email è cambiata nel frattempo: aggiorna e riprova.',
  chiave_assente: 'Impostazione non trovata nel database.',
  faq_inesistente: 'Risposta non trovata (o non è una risposta standard).',
  troppe_sessioni: 'Troppe chat con questa email: cancellale una per una.',
  chi_sconosciuto: 'Scegli chi sei dal menu in alto.',
  sessione_non_valida: 'Sessione scaduta: rientra.',
  non_autenticato: 'Sessione scaduta: rientra.',
  dominio_non_ammesso: 'Questo account non è del team.',
  messaggio_inesistente: 'Messaggio non trovato.',
  non_dello_staff: 'Si riprovano solo le email delle risposte del team.',
  send_key_gia_usata: 'Questo invio è già stato usato per un’altra chat: chiudi e riapri il dialogo.',
  sessione_inesistente: 'Chat non trovata: forse è stata cancellata.',
  riprova: 'Il database non risponde: riprova tra poco.',
  campo_non_valido: 'Valore non valido.',
  chiave_non_ammessa: 'Questa impostazione non si cambia da qui.',
  faq_non_dei_bottoni: 'Si possono cambiare solo le risposte dei bottoni rapidi.',
  non_reinviabile: 'Questa email non si può riprovare: potrebbe essere già arrivata.',
};
export type EsitoEmailChat = 'inviata' | 'errore' | 'in_corso' | 'in_coda';
export type RispostaChat = { email: EsitoEmailChat; email_errore: string | null; email_verificata: boolean; ripetuta: boolean; proiezione: boolean; stato: string };
/** "Invia in chat": la risposta compare nella chat e parte SUBITO per email da info@ (D-8). sendKey nasce all'apertura del dialogo. */
export async function chatRispondi(sessioneId: string, testo: string, chi: string, sendKey: string): Promise<RispostaChat> {
  const j = await callChatStaff({ action: 'rispondi', sessione_id: sessioneId, testo, chi, send_key: sendKey });
  return { email: (j.email as EsitoEmailChat) ?? 'in_coda', email_errore: (j.email_errore as string) ?? null, email_verificata: j.email_verificata === true,
    ripetuta: j.ripetuta === true, proiezione: j.proiezione !== false, stato: String(j.stato ?? '') };
}
export async function chatAzione(azione: 'prendo_io' | 'chiudi' | 'revoca_accessi', sessioneId: string, chi: string): Promise<Record<string, unknown>> {
  return await callChatStaff({ action: azione, sessione_id: sessioneId, chi });
}
export async function chatReinvia(messaggioId: string, chi: string): Promise<{ email: EsitoEmailChat; email_errore: string | null }> {
  const j = await callChatStaff({ action: 'reinvia', messaggio_id: messaggioId, chi });
  return { email: (j.email as EsitoEmailChat) ?? 'in_coda', email_errore: (j.email_errore as string) ?? null };
}
export type AnteprimaCancella = { trovate: number; sessioni: { id: string; messaggi: number; proiezioni: number; card_email: boolean; prova: boolean }[]; promemoria: string[] };
export async function chatCancellaDati(sessioneId: string, chi: string, conferma: boolean, conCardEmail = false): Promise<AnteprimaCancella & { cancellate?: Record<string, number> }> {
  const j = await callChatStaff({ action: 'cancella_dati', sessione_id: sessioneId, chi, ...(conferma ? { conferma: true, con_card_email: conCardEmail } : {}) });
  return j as unknown as AnteprimaCancella & { cancellate?: Record<string, number> };
}
export type ImpostazioniChat = { valori: Record<string, string>; faq: { id: number; tipo: string; titolo: string | null; testo_it: string | null; testo_en: string | null; attiva: boolean }[]; scrivibili: string[] };
export async function chatImpostazioni(chi: string): Promise<ImpostazioniChat> {
  return (await callChatStaff({ action: 'impostazioni', chi })) as unknown as ImpostazioniChat;
}
export async function chatImposta(chiave: string, valore: unknown, chi: string): Promise<{ valore: string; invariato: boolean }> {
  const j = await callChatStaff({ action: 'imposta', chiave, valore, chi });
  return { valore: String(j.valore ?? ''), invariato: j.invariato === true };
}
export async function chatConoscenza(faqId: number, patch: { testo_it?: string; testo_en?: string; attiva?: boolean }, chi: string): Promise<void> {
  await callChatStaff({ action: 'conoscenza_testo', faq_id: faqId, ...patch, chi });
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
 *  e sposta QUESTA conversazione nel Rumore. Reversibile a mano (denylist in app_flags, vista Rumore).
 *  cs-api v12 (31-10): un mittente CONDIVISO di Shopify (chat del sito, modulo contatti) non si blocca mai:
 *  si sposta solo la conversazione. */
export async function addNoise(conversationId: string, sender: string, chi: string): Promise<void> {
  await callCsApi({ action: 'add_noise', conversation_id: conversationId, sender, chi });
}

/** Gesto INVERSO (brief rumore vendor, 01-08): riporta la conversazione dal Rumore alla coda
 *  (dal 31-10, cs-api v12: nel canale con cui era entrata, una chat torna chat; prima sempre
 *  email_diretta) e toglie il mittente esatto dalla denylist. Se a bloccare e' una voce
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
// v31 (Dan 03-11-2026): la finestra reso decorre dalla CONSEGNA. `delivered_at`, `fonte` e `giorni`
// parlano della consegna su cui si e' contato (null se non nota: verdetto 'sconosciuto' anche a ordine
// verificato, e la collega puo' confermare la data dal tracking); `ordine_del` resta un'informazione.
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
