// chat-staff staff-1 (2026-11-08): le azioni del team sulla chat del sito, Fase 1 pezzo 3 (docs/PROPOSTA_chat_sito.md 7.8
// e 11.6, con D-8 modello ticket: ogni risposta parte subito anche per email, niente "Invia solo via email"). Edge nuova
// (Regola 19: cs-api non riceve azioni nuove). La chiama la PWA col JWT di una persona del team.
//
// Autorizzazione come cs-api: Bearer = access_token di Supabase Auth verificato con getUser (la anon key non e' un
// utente), email del team (stessa lista di public.email_del_team, migr 0161); `chi` dal selettore B/G/A, sconosciuto = 422.
// POST JSON, schema rigido per azione (campo sconosciuto = 422):
//   rispondi        {sessione_id, testo, chi, send_key} -> messaggio `staff` (send_key UNIQUE: un nuovo invio dello stesso
//                   dialogo non duplica), chat `aperta` con preso_da = chi, poi chat-send SUBITO (chiave di servizio, 25 s):
//                   la risposta dice se l'email e' partita (`inviata`), non partita (`errore` con la causa) o in coda (il
//                   giro di chat-send la riprova). `email_verificata` false = chat senza cliente Shopify loggata: il
//                   compositore mostra "email non verificata: niente dati d'ordine o personali in chat" (7.8, senza bottone).
//   prendo_io       {sessione_id, chi} -> `aperta`, preso_da = chi.
//   chiudi          {sessione_id, chi} -> `chiusa` (chiusa_at). Il widget rilegge una chat chiusa finche' il token vale.
//   revoca_accessi  {sessione_id, chi} -> revoca chat token e token di ripresa della sessione (5.4: email sbagliata, link
//                   inoltrato).
//   reinvia         {messaggio_id, chi} -> ritenta l'email di un messaggio che Gmail ha rifiutato ("non partita") o che e'
//                   ancora in coda; mai uno con esito ignoto (potrebbe essere partito) ne' uno gia' inviato.
//   cancella_dati   {sessione_id | email, conferma?, con_card_email?, chi} -> 11.6 e test 21. Senza `conferma: true` e'
//                   un'anteprima (sessioni trovate, messaggi, proiezioni, card email collegata) e non tocca niente. Con la
//                   conferma cancella la proiezione in cs_ (e, se chiesto, la card email del thread di risposta), i
//                   contatori della sessione e la sessione (in cascata messaggi e token; gli eventi restano senza
//                   sessione e senza dati personali). Audit in chat_eventi senza email ne' testi.
// Regola 19: scrive tabelle chat_* e, solo in cancella_dati, cancella righe cs_conversations della chat (cascata cs_);
// nessuna scrittura in change_log, nessuna chiamata a write-api, nessun PIN. Regola 20: letture con errore controllato e
// un ritentativo, scritture mai ritentate, idempotenza da send_key e update condizionati.
// Log: solo cause scritte nel codice e codici d'errore, mai testi, token o email.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// ==== PURE:chat-staff BEGIN ====
const VERSIONE = 'staff-1';
const CORS: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const EMAIL_TEAM = /@(?:amimi\.it|telaioconsulting\.com)$/;
const IDENT: Record<string, string> = { B: 'Benedetta', G: 'Ginevra', A: 'Ale' };
const TESTO_MAX = 4000;                          // tetto del DB (chat_messaggi_testo_ck)
const CORPO_MAX_BYTE = 32768;
const CANCELLA_MAX = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s\p{C}<>,;"@]+@[^\s\p{C}<>,;"@]+\.[^\s\p{C}<>,;"@]+$/u;
const SURROGATO_SOLO_RE = /\p{Cs}/u;
const CAMPI: Record<string, { ammessi: string[]; obbligatori: string[] }> = {
  rispondi: { ammessi: ['action', 'sessione_id', 'testo', 'chi', 'send_key'], obbligatori: ['sessione_id', 'testo', 'chi', 'send_key'] },
  prendo_io: { ammessi: ['action', 'sessione_id', 'chi'], obbligatori: ['sessione_id', 'chi'] },
  chiudi: { ammessi: ['action', 'sessione_id', 'chi'], obbligatori: ['sessione_id', 'chi'] },
  revoca_accessi: { ammessi: ['action', 'sessione_id', 'chi'], obbligatori: ['sessione_id', 'chi'] },
  reinvia: { ammessi: ['action', 'messaggio_id', 'chi'], obbligatori: ['messaggio_id', 'chi'] },
  cancella_dati: { ammessi: ['action', 'sessione_id', 'email', 'conferma', 'con_card_email', 'chi'], obbligatori: ['chi'] },
};
const PROMEMORIA_CANCELLA = [
  'Le email di risposta restano in info@amimi.it (thread "La tua richiesta in chat - Amimì"): vanno cancellate a mano da Gmail.',
  'Le chat di Shopify Inbox di prima non si cancellano dall\'app.',
  'Restano solo il registro e i contatori globali, senza email, nomi ne\' testi.',
];

type Sess = {
  id: string; stato: string; preso_da: string | null; customer_email: string; shopify_customer_id: string | null; prova: boolean;
  gmail_thread_id: string | null; cs_conversation_id: string | null; created_at: string; ultima_attivita_at: string;
};
type Msg = { id: string; sessione_id: string; seq: number; autore: string; email_stato: string | null; email_errore: string | null };
interface Db {
  utente(token: string): Promise<string | null>;
  sessione(id: string): Promise<Sess | null>;
  sessioniPerEmail(email: string, limite: number): Promise<Sess[]>;
  inserisciStaff(r: { sessione_id: string; autore: string; staff_nome: string; testo: string; send_key: string }): Promise<Msg | null>;
  messaggioPerSendKey(k: string): Promise<Msg | null>;
  messaggio(id: string): Promise<Msg | null>;
  aggiornaSessione(id: string, patch: Record<string, unknown>): Promise<Sess | null>;   // solo se non chiusa
  rimettiInCoda(id: string, erroreLetto: string): Promise<boolean>;
  revocaToken(sessioneId: string, oraIso: string): Promise<number>;
  contaMessaggi(sessioneId: string): Promise<number>;
  proiezioni(s: Sess): Promise<string[]>;
  cardEmail(threadId: string): Promise<string | null>;
  cancellaCs(ids: string[]): Promise<number>;
  cancellaContatori(sessioneId: string): Promise<number>;
  cancellaSessione(id: string): Promise<number>;
  evento(r: { sessione_id: string | null; tipo: string; chi: string; esito: string | null; dettaglio: Record<string, unknown> }): Promise<void>;
}
type Ambiente = { ora: number; db: Db; invio: (messaggioId: string) => Promise<string> };

class ErroreDb extends Error {
  causa: string;
  constructor(causa: string) { super(causa); this.causa = causa; }
}

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const errore = (e: string, s: number, extra: Record<string, unknown> = {}) => json({ ok: false, error: e, versione: VERSIONE, ...extra }, s);
const iso = (ms: number) => new Date(ms).toISOString();
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);
const cp = (s: string) => [...s].length;
function emailValida(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}
// testo dello staff: NFC, a capo normalizzati, via i controlli (a capo e tab esclusi) e i caratteri che rovesciano il testo
function testoStaff(v: unknown): string | null {
  if (typeof v !== 'string' || SURROGATO_SOLO_RE.test(v)) return null;
  const s = v.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, '').trim();
  const n = cp(s);
  return n >= 1 && n <= TESTO_MAX ? s : null;
}
function schema(d: Record<string, unknown>, azione: string): Response | null {
  const c = CAMPI[azione];
  for (const k of Object.keys(d)) if (!c.ammessi.includes(k)) return errore('campo_sconosciuto', 422);
  for (const k of c.obbligatori) if (d[k] === undefined || d[k] === null) return errore('campo_mancante', 422, { campo: k });
  return null;
}
async function leggiCorpo(req: Request): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get('content-length') ?? 0) > CORPO_MAX_BYTE) return null;
  const t = await req.text();
  if (new TextEncoder().encode(t).length > CORPO_MAX_BYTE) return null;
  try {
    const d = JSON.parse(t);
    return d !== null && typeof d === 'object' && !Array.isArray(d) ? d as Record<string, unknown> : null;
  } catch { return null; }
}
// esito dell'email dopo la chiamata a chat-send, riletto dal DB (fa fede la riga, non la risposta)
async function statoEmail(amb: Ambiente, id: string): Promise<{ email: string; email_errore: string | null }> {
  const m = await amb.db.messaggio(id);
  if (!m || m.email_stato === null) return { email: 'in_coda', email_errore: null };
  return { email: m.email_stato === 'prenotata' ? 'in_corso' : m.email_stato, email_errore: m.email_stato === 'errore' ? m.email_errore : null };
}
async function audit(amb: Ambiente, sessioneId: string | null, tipo: string, chi: string, esito: string | null, dettaglio: Record<string, unknown>) {
  try { await amb.db.evento({ sessione_id: sessioneId, tipo, chi, esito, dettaglio }); } catch { /* l'azione e' fatta: l'audit mancante non la annulla */ }
}

async function rispondi(d: Record<string, unknown>, amb: Ambiente, chi: string): Promise<Response> {
  const id = uuid(d.sessione_id);
  if (!id) return errore('campo_non_valido', 422, { campo: 'sessione_id' });
  const sendKey = uuid(d.send_key);
  if (!sendKey) return errore('campo_non_valido', 422, { campo: 'send_key' });
  const testo = testoStaff(d.testo);
  if (testo === null) return errore('campo_non_valido', 422, { campo: 'testo', max: TESTO_MAX });
  const s = await amb.db.sessione(id);
  if (!s) return errore('sessione_inesistente', 404);
  if (s.stato === 'chiusa') return errore('chiusa', 409);
  let m = await amb.db.inserisciStaff({ sessione_id: id, autore: 'staff', staff_nome: chi, testo, send_key: sendKey });
  const ripetuta = m === null;
  if (!m) {
    m = await amb.db.messaggioPerSendKey(sendKey);
    if (!m || m.sessione_id !== id || m.autore !== 'staff') return errore('send_key_gia_usata', 409);
  }
  const ora = iso(amb.ora);
  const dopo = await amb.db.aggiornaSessione(id, { stato: 'aperta', preso_da: chi, ultima_risposta_staff_at: ora, ultima_attivita_at: ora, updated_at: ora });
  if (m.email_stato === null) await amb.invio(m.id);
  const e = await statoEmail(amb, m.id);
  await audit(amb, id, 'staff_rispondi', chi, e.email, { seq: m.seq, ripetuta });
  return json({ ok: true, messaggio: { id: m.id, seq: m.seq }, stato: dopo?.stato ?? 'chiusa', ...e, email_verificata: s.shopify_customer_id !== null, ripetuta });
}

async function cambiaStato(d: Record<string, unknown>, amb: Ambiente, chi: string, azione: string): Promise<Response> {
  const id = uuid(d.sessione_id);
  if (!id) return errore('campo_non_valido', 422, { campo: 'sessione_id' });
  const s = await amb.db.sessione(id);
  if (!s) return errore('sessione_inesistente', 404);
  const ora = iso(amb.ora);
  if (azione === 'revoca_accessi') {
    const n = await amb.db.revocaToken(id, ora);
    await audit(amb, id, 'staff_revoca', chi, 'fatto', { token: n });
    return json({ ok: true, revocati: n });
  }
  if (s.stato === 'chiusa') return azione === 'chiudi' ? json({ ok: true, stato: 'chiusa', gia_chiusa: true }) : errore('chiusa', 409);
  const patch = azione === 'chiudi' ? { stato: 'chiusa', chiusa_at: ora, updated_at: ora } : { stato: 'aperta', preso_da: chi, updated_at: ora };
  const dopo = await amb.db.aggiornaSessione(id, patch);
  if (!dopo) return azione === 'chiudi' ? json({ ok: true, stato: 'chiusa', gia_chiusa: true }) : errore('chiusa', 409);
  await audit(amb, id, azione === 'chiudi' ? 'staff_chiudi' : 'staff_prendo', chi, 'fatto', { da: s.stato });
  return json({ ok: true, stato: dopo.stato });
}

async function reinvia(d: Record<string, unknown>, amb: Ambiente, chi: string): Promise<Response> {
  const id = uuid(d.messaggio_id);
  if (!id) return errore('campo_non_valido', 422, { campo: 'messaggio_id' });
  const m = await amb.db.messaggio(id);
  if (!m) return errore('messaggio_inesistente', 404);
  if (m.autore !== 'staff') return errore('non_dello_staff', 422);
  if (m.email_stato === 'inviata') return errore('gia_inviata', 409);
  if (m.email_stato === 'prenotata') return errore('in_corso', 409);
  if (m.email_stato === 'errore') {
    // solo un rifiuto di Gmail e' sicuramente non partito; "esito ignoto" potrebbe essere arrivato, un destinatario non
    // valido resta tale
    if (!/^non partita: /.test(m.email_errore ?? '')) return errore('non_reinviabile', 409, { motivo: m.email_errore });
    if (!(await amb.db.rimettiInCoda(id, m.email_errore as string))) return errore('cambiato', 409);
  }
  await amb.invio(id);
  const e = await statoEmail(amb, id);
  await audit(amb, m.sessione_id, 'staff_reinvia', chi, e.email, { seq: m.seq });
  return json({ ok: true, ...e });
}

async function cancellaDati(d: Record<string, unknown>, amb: Ambiente, chi: string): Promise<Response> {
  const perSessione = d.sessione_id !== undefined && d.sessione_id !== null;
  const perEmail = d.email !== undefined && d.email !== null;
  if (perSessione === perEmail) return errore('campo_non_valido', 422, { campo: 'sessione_id o email' });
  for (const k of ['conferma', 'con_card_email']) if (d[k] !== undefined && d[k] !== null && typeof d[k] !== 'boolean') return errore('campo_non_valido', 422, { campo: k });
  let sessioni: Sess[];
  if (perSessione) {
    const id = uuid(d.sessione_id);
    if (!id) return errore('campo_non_valido', 422, { campo: 'sessione_id' });
    const s = await amb.db.sessione(id);
    sessioni = s ? [s] : [];
  } else {
    const e = emailValida(d.email);
    if (!e) return errore('campo_non_valido', 422, { campo: 'email' });
    sessioni = await amb.db.sessioniPerEmail(e, CANCELLA_MAX + 1);
    if (sessioni.length > CANCELLA_MAX) return errore('troppe_sessioni', 422, { max: CANCELLA_MAX });
  }
  const voci: { s: Sess; messaggi: number; proiezioni: string[]; card: string | null }[] = [];
  for (const s of sessioni) {
    voci.push({ s, messaggi: await amb.db.contaMessaggi(s.id), proiezioni: await amb.db.proiezioni(s), card: s.gmail_thread_id ? await amb.db.cardEmail(s.gmail_thread_id) : null });
  }
  const anteprima = voci.map((v) => ({ id: v.s.id, stato: v.s.stato, prova: v.s.prova, creata: v.s.created_at, ultima_attivita: v.s.ultima_attivita_at,
    messaggi: v.messaggi, proiezioni: v.proiezioni.length, card_email: v.card !== null }));
  if (d.conferma !== true) return json({ ok: true, anteprima: true, trovate: voci.length, sessioni: anteprima, promemoria: PROMEMORIA_CANCELLA });
  const conti = { sessioni: 0, messaggi: 0, proiezioni: 0, card_email: 0, contatori: 0 };
  const per = perSessione ? 'sessione' : 'email';
  try {
    for (const v of voci) {
      // prima le righe cs_ (un errore lascia la sessione, quindi la cancellazione si puo' ripetere), poi la sessione
      const cs = [...v.proiezioni, ...(d.con_card_email === true && v.card ? [v.card] : [])];
      if (cs.length) {
        const n = await amb.db.cancellaCs(cs);
        const card = d.con_card_email === true && v.card ? 1 : 0;
        conti.card_email += Math.min(card, n);
        conti.proiezioni += Math.max(0, n - card);
      }
      conti.contatori += await amb.db.cancellaContatori(v.s.id);
      if ((await amb.db.cancellaSessione(v.s.id)) === 1) { conti.sessioni++; conti.messaggi += v.messaggi; }
    }
  } catch (x) {
    await audit(amb, null, 'cancella_dati', chi, 'parziale', { per, ...conti });
    return errore('riprova', 503, { causa: x instanceof ErroreDb ? x.causa : 'eccezione', fatte: conti });
  }
  await audit(amb, null, 'cancella_dati', chi, 'fatto', { per, ...conti });
  return json({ ok: true, cancellate: conti, promemoria: PROMEMORIA_CANCELLA });
}

async function gestisci(req: Request, amb: Ambiente): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return errore('method_not_allowed', 405);
  const authz = req.headers.get('Authorization') ?? '';
  const token = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
  if (!token) return errore('non_autenticato', 401);
  const d = await leggiCorpo(req);
  if (!d) return errore('json_non_valido', 400);
  const azione = typeof d.action === 'string' && Object.hasOwn(CAMPI, d.action) ? d.action : null;
  if (!azione) return errore('azione_sconosciuta', 400);
  try {
    const email = await amb.db.utente(token);
    if (!email) return errore('sessione_non_valida', 401);
    if (!EMAIL_TEAM.test(email.toLowerCase())) return errore('dominio_non_ammesso', 403);
    const e = schema(d, azione);
    if (e) return e;
    const chi = typeof d.chi === 'string' && Object.hasOwn(IDENT, d.chi.toUpperCase()) ? IDENT[d.chi.toUpperCase()] : null;
    if (!chi) return errore('chi_sconosciuto', 422);
    if (azione === 'rispondi') return await rispondi(d, amb, chi);
    if (azione === 'reinvia') return await reinvia(d, amb, chi);
    if (azione === 'cancella_dati') return await cancellaDati(d, amb, chi);
    return await cambiaStato(d, amb, chi, azione);
  } catch (x) {
    return errore('riprova', 503, { causa: x instanceof ErroreDb ? x.causa : 'eccezione' });
  }
}
// ==== PURE:chat-staff END ====

// ---- adattatori (service role). Letture con un ritentativo, scritture mai (Regola 20d). ----
const retryOnce = async <T extends { error: unknown }>(fn: () => PromiseLike<T>): Promise<T> => {
  const r = await fn();
  if (!r.error) return r;
  await new Promise((ok) => setTimeout(ok, 300));
  return await fn();
};
const codice = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && /^[A-Z0-9]{1,10}$/.test(c) ? c : '?';
};
const fallito = (causa: string, e: unknown): ErroreDb => {
  console.error('chat-staff: ' + causa, codice(e));
  return new ErroreDb(causa);
};
const COL_SESS = 'id, stato, preso_da, customer_email, shopify_customer_id, prova, gmail_thread_id, cs_conversation_id, created_at, ultima_attivita_at';
const COL_MSG = 'id, sessione_id, seq, autore, email_stato, email_errore';
const env = (k: string) => (Deno.env.get(k) ?? '').trim();

function dbSupabase(sb: SupabaseClient, anon: SupabaseClient): Db {
  const uno = <T>(data: unknown): T | null => ((data ?? []) as T[])[0] ?? null;
  return {
    async utente(token) {
      const { data, error } = await anon.auth.getUser(token);
      if (error || !data?.user) return null;
      return (data.user.email ?? '').toLowerCase() || null;
    },
    async sessione(id) {
      const { data, error } = await retryOnce(() => sb.from('chat_sessioni').select(COL_SESS).eq('id', id).limit(1));
      if (error) throw fallito('sessione non letta', error);
      return uno<Sess>(data);
    },
    async sessioniPerEmail(email, limite) {
      // chat-api salva l'email gia' in minuscolo (emailValida): uguaglianza esatta, niente ilike con caratteri jolly
      const { data, error } = await retryOnce(() => sb.from('chat_sessioni').select(COL_SESS).eq('customer_email', email)
        .order('created_at', { ascending: true }).limit(limite));
      if (error) throw fallito('sessioni non lette', error);
      return (data ?? []) as Sess[];
    },
    async inserisciStaff(r) {
      const { data, error } = await sb.from('chat_messaggi').upsert(r, { onConflict: 'send_key', ignoreDuplicates: true }).select(COL_MSG);
      if (error) throw fallito('messaggio non salvato', error);
      return uno<Msg>(data);
    },
    async messaggioPerSendKey(k) {
      const { data, error } = await retryOnce(() => sb.from('chat_messaggi').select(COL_MSG).eq('send_key', k).limit(1));
      if (error) throw fallito('messaggio non letto', error);
      return uno<Msg>(data);
    },
    async messaggio(id) {
      const { data, error } = await retryOnce(() => sb.from('chat_messaggi').select(COL_MSG).eq('id', id).limit(1));
      if (error) throw fallito('messaggio non letto', error);
      return uno<Msg>(data);
    },
    async aggiornaSessione(id, patch) {
      const { data, error } = await sb.from('chat_sessioni').update(patch).eq('id', id).neq('stato', 'chiusa').select(COL_SESS);
      if (error) throw fallito('sessione non aggiornata', error);
      return uno<Sess>(data);
    },
    async rimettiInCoda(id, erroreLetto) {
      const { data, error } = await sb.from('chat_messaggi').update({ email_stato: null, email_at: null, email_errore: null })
        .eq('id', id).eq('email_stato', 'errore').eq('email_errore', erroreLetto).select('id');
      if (error) throw fallito('messaggio non rimesso in coda', error);
      return (data ?? []).length === 1;
    },
    async revocaToken(sessioneId, ora) {
      const { data, error } = await sb.from('chat_token').update({ revocato_at: ora }).eq('sessione_id', sessioneId).is('revocato_at', null).select('id');
      if (error) throw fallito('token non revocati', error);
      return (data ?? []).length;
    },
    async contaMessaggi(sessioneId) {
      const { count, error } = await retryOnce(() => sb.from('chat_messaggi').select('id', { count: 'exact', head: true }).eq('sessione_id', sessioneId));
      if (error) throw fallito('messaggi non contati', error);
      return count ?? 0;
    },
    async proiezioni(s) {
      const { data, error } = await retryOnce(() => sb.from('cs_conversations').select('id').eq('gmail_thread_id', `chat:${s.id}`).limit(2));
      if (error) throw fallito('proiezione non letta', error);
      return [...new Set([...((data ?? []) as { id: string }[]).map((r) => r.id), ...(s.cs_conversation_id ? [s.cs_conversation_id] : [])])];
    },
    async cardEmail(threadId) {
      const { data, error } = await retryOnce(() => sb.from('cs_conversations').select('id').eq('gmail_thread_id', threadId).limit(1));
      if (error) throw fallito('card email non letta', error);
      return uno<{ id: string }>(data)?.id ?? null;
    },
    async cancellaCs(ids) {
      const { data, error } = await sb.from('cs_conversations').delete().in('id', ids).select('id');
      if (error) throw fallito('righe cs non cancellate', error);
      return (data ?? []).length;
    },
    async cancellaContatori(sessioneId) {
      const { data, error } = await sb.from('chat_contatori').delete().like('chiave', `sess:${sessioneId}:%`).select('chiave');
      if (error) throw fallito('contatori non cancellati', error);
      return (data ?? []).length;
    },
    async cancellaSessione(id) {
      const { data, error } = await sb.from('chat_sessioni').delete().eq('id', id).select('id');
      if (error) throw fallito('sessione non cancellata', error);
      return (data ?? []).length;
    },
    async evento(r) {
      const { error } = await sb.from('chat_eventi').insert({ ...r, chiave: null });
      if (error) throw fallito('evento non scritto', error);
    },
  };
}

// chat-send subito dopo la risposta, con la chiave di servizio (nell'ambiente delle edge e' la sb_secret). Non lancia
// mai: rete, timeout o rifiuto lasciano il messaggio in coda per il giro di chat-send.
async function invio(messaggioId: string): Promise<string> {
  try {
    const r = await fetch(env('SUPABASE_URL').replace(/\/+$/, '') + '/functions/v1/chat-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY') },
      body: JSON.stringify({ action: 'invia', messaggio_id: messaggioId }),
      signal: AbortSignal.timeout(25000),
    });
    const j = (await r.json().catch(() => null)) as { esito?: unknown } | null;
    return typeof j?.esito === 'string' ? j.esito : 'in_coda';
  } catch {
    console.error('chat-staff: chat-send non raggiunta');
    return 'in_coda';
  }
}

const SB = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const ANON = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
const DB = dbSupabase(SB, ANON);

Deno.serve((req) => gestisci(req, { ora: Date.now(), db: DB, invio }));
