import { csClient } from './csClient';

// Letture e scritture della sezione "Negozi B2B" (modulo lead_*, migr 0111). Tutto passa dal client
// con la sessione utente loggato (@amimi.it): la RLS `authenticated` nega ai non loggati.
// Scrittura UNICA dalla UI: lead_reviews (decisione umana); un trigger a DB la riflette sull'account.

export type Criterio = { punti: number | null; peso: number; prova?: string | null; evidence_id?: string | null };
export type Criteri = Record<string, Criterio>;

export type LeadDossier = {
  id: string;
  nome: string;
  tipo: string;
  gruppo_id: string | null;
  gruppo_nome: string | null;
  indirizzo: string | null;
  citta: string | null;
  provincia: string | null;
  paese: string;
  website: string | null;
  ig_handle: string | null;
  google_maps_url: string | null;
  telefono: string | null;
  email_generica: string | null;
  piva: string | null;
  fonte_seed: string;
  priorita_tipologia: number | null;
  stato_ricerca: 'seed' | 'enriched' | 'scored' | 'reviewed' | 'rejected';
  rejected_motivo: string | null;
  lead_stage: string;
  tier: 'A' | 'B' | 'C' | null;
  verdetto: 'da_contattare' | 'forse' | 'no' | null;
  verdetto_motivo: string | null;
  verdetto_chi: string | null;
  verdetto_at: string | null;
  gancio: string | null;
  owner_note: string | null;
  contattato_prima: boolean;
  chi: string | null;
  created_at: string;
  updated_at: string;
  score_id: string | null;
  totale: number | null;
  tier_proposto: 'A' | 'B' | 'C' | null;
  criteri: Criteri | null;
  bonus: Record<string, number> | null;
  esclusione: string | null;
  dati_incompleti: boolean | null;
  motivazione: string | null;
  perche_no: string | null;
  rubrica_version: string | null;
  scored_at: string | null;
  ultima_review_azione: string | null;
  ultima_review_chi: string | null;
  ultima_review_at: string | null;
  shot_home: string | null;
  shot_home_mobile: string | null;
  shot_ig: string | null;
  shot_maps: string | null;
  shot_maps_photos: string | null;
  thumb: string | null;
  ig_posts: { handle?: string; n?: number; n_scaricati?: number; cadenza?: { primo: string; ultimo: string; n: number; giorni: number } | null; post?: { i: number; url: string | null; alt: string; data: string | null; reel: boolean; asset_path: string | null }[] } | null;
  maps_reviews: { n?: number; recensioni?: { stelle: string | null; testo: string }[] } | null;
  site_products: { fonte?: string; n?: number; n_borse?: number; prodotti?: { titolo: string; prezzo: number | null; vendor: string | null; tipo: string | null; borsa: boolean; url: string; asset_path: string | null }[] } | null;
  stampa: { query?: string; n?: number; risultati?: { url: string; dominio: string; titolo: string; snippet: string }[] } | null;
  site_meta: { url?: string; title?: string; meta?: string | null; lang?: string | null; platform?: string | null; ecommerce?: boolean; emails?: string[]; piva?: string | null } | null;
  about_text: { url?: string; testo?: string } | null;
  ig_metrics: { follower?: number | null; seguiti?: number | null; post?: number | null; bio?: string | null; login_wall?: boolean; errore?: string; post_alt?: string[] } | null;
  maps: { rating?: number | null; recensioni?: number | null; categoria?: string | null; indirizzo?: string | null; telefono?: string | null; orari?: string | null; sito?: string | null; errore?: string; chiuso_definitivamente?: boolean } | null;
  brands_carried: { fonte?: string; vendors?: string[] | null; peer_match?: string[]; lista_pagina?: string | null } | null;
  price_band: { n_prodotti?: number; tutti?: { n: number; min: number; mediana: number; max: number } | null; borse?: { n: number; min: number; mediana: number; max: number } | null } | null;
  n_evidenze: number;
  n_contatti: number;
};

export type LeadEvidence = {
  id: string;
  tipo: string;
  payload: Record<string, unknown> | null;
  asset_path: string | null;
  raccolto_da: string;
  note: string | null;
  captured_at: string;
};

export type LeadContact = { id: string; nome: string | null; ruolo: string | null; email: string | null; telefono: string | null; linkedin_url: string | null; fonte: string | null; opt_out: boolean; note: string | null };
export type LeadReview = { id: string; chi: string; azione: string; tier: string | null; verdetto: string | null; motivo: string | null; nota: string | null; created_at: string };
export const VERDETTO_LABEL: Record<string, string> = { da_contattare: 'Da contattare', forse: 'Forse', no: 'No' };

export const TIPO_LABEL: Record<string, string> = {
  boutique: 'Boutique', concept_store: 'Concept store', hotel_shop: 'Boutique hotel', gruppo_multimarca: 'Gruppo / catena',
  corner_department: 'Corner department', negozio_regalo: 'Negozio regalo', online_multibrand: 'Multibrand online',
};
export const STATO_LABEL: Record<string, string> = { seed: 'Da raccogliere', enriched: 'Raccolto', scored: 'Valutato', reviewed: 'Rivisto', rejected: 'Scartato' };
export const CRITERI_ORDER: { key: string; label: string; peso: number }[] = [
  { key: 'brand', label: 'Brand a scaffale', peso: 25 },
  { key: 'stile', label: 'Stile e identita’ visiva', peso: 20 },
  { key: 'posto', label: 'Posto e cliente', peso: 20 },
  { key: 'vitalita', label: 'Vitalita’', peso: 15 },
  { key: 'raggiungibilita', label: 'Raggiungibilita’', peso: 10 },
  { key: 'digitale', label: 'Presenza digitale', peso: 10 },
];

// A pagine: PostgREST taglia a 1.000 righe SENZA errore (Regola Ferrea 20b). Il 22-09 la lista mostrava
// "1000 profili" su 1.535, e i negozi oltre la millesima riga non si potevano ne' cercare ne' aprire.
const PAGE = 1000;
export async function fetchDossier(): Promise<LeadDossier[]> {
  const out: LeadDossier[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await csClient.from('v_lead_dossier').select('*').order('totale', { ascending: false, nullsFirst: false }).order('nome').order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as LeadDossier[]));
    // ci si ferma solo su una pagina VUOTA: un db-max-rows piu' basso di PAGE rifarebbe il taglio silenzioso
    if (!(data ?? []).length) return out;
  }
}

// v15 (15-10, "ci mette 5-10 secondi ogni volta"): la LISTA legge la vista snella v_lead_lista (migr 0160), circa 4 MB
// invece dei 23,5 di v_lead_dossier letti in 8 pagine in serie. La prima pagina porta il conteggio, le altre partono in
// parallelo. Regola 20b: se le righe lette non sono quante dice il conteggio, errore (mai una lista monca in silenzio).
// Il dossier completo si legge per id quando si apre la scheda (fetchDossierUno).
export type LeadLista = Pick<LeadDossier, 'id' | 'nome' | 'tipo' | 'citta' | 'paese' | 'website' | 'ig_handle' | 'telefono' | 'email_generica' | 'stato_ricerca' | 'lead_stage' | 'tier' | 'gancio' | 'owner_note' | 'verdetto' | 'verdetto_motivo' | 'totale' | 'tier_proposto' | 'esclusione' | 'motivazione' | 'n_evidenze'> & {
  ig_metrics: { follower?: number | null } | null;
  maps: { rating?: number | null; recensioni?: number | null; telefono?: string | null } | null;
  brands_carried: { peer_match?: string[] | null; vendors?: string[] | null } | null;
  price_band: { borse?: { n: number; min: number; mediana: number; max: number } | null } | null;
  img: string | null;   // una sola immagine per scheda: miniatura del feed, poi Instagram, sito mobile, sito desktop
};
const ordinaLista = <T,>(q: T) => (q as unknown as { order: (c: string, o?: Record<string, boolean>) => T }).order('totale', { ascending: false, nullsFirst: false }) as T;
export async function fetchLista(): Promise<LeadLista[]> {
  const base = () => ordinaLista(csClient.from('v_lead_lista').select('*')).order('nome').order('id');
  const { data: prima, error, count } = await ordinaLista(csClient.from('v_lead_lista').select('*', { count: 'exact' })).order('nome').order('id').range(0, PAGE - 1);
  if (error) throw new Error(error.message);
  const tot = count ?? (prima ?? []).length;
  if ((prima ?? []).length < Math.min(PAGE, tot)) throw new Error('lista dei negozi incompleta (il server ha tagliato la prima pagina): riprova');
  const pagine: number[] = [];
  for (let from = PAGE; from < tot; from += PAGE) pagine.push(from);
  const resto = await Promise.all(pagine.map(async (from) => {
    const { data, error: e } = await base().range(from, from + PAGE - 1);
    if (e) throw new Error(e.message);
    return (data ?? []) as LeadLista[];
  }));
  const visti = new Set<string>();
  const out = [...((prima ?? []) as LeadLista[]), ...resto.flat()].filter((r) => (visti.has(r.id) ? false : (visti.add(r.id), true)));
  if (out.length < tot) throw new Error(`lista dei negozi incompleta (${out.length} su ${tot}): riprova`);
  return out;
}
export async function fetchListaUno(id: string): Promise<LeadLista | null> {
  const { data, error } = await csClient.from('v_lead_lista').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as LeadLista | null;
}
export async function fetchDossierUno(id: string): Promise<LeadDossier | null> {
  const { data, error } = await csClient.from('v_lead_dossier').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as LeadDossier | null;
}

export async function fetchEvidence(accountId: string): Promise<LeadEvidence[]> {
  const { data, error } = await csClient.from('lead_evidence').select('id,tipo,payload,asset_path,raccolto_da,note,captured_at').eq('account_id', accountId).order('captured_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadEvidence[];
}

export async function fetchContacts(accountId: string): Promise<LeadContact[]> {
  const { data, error } = await csClient.from('lead_contacts').select('id,nome,ruolo,email,telefono,linkedin_url,fonte,opt_out,note').eq('account_id', accountId).order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadContact[];
}

export async function fetchReviews(accountId: string): Promise<LeadReview[]> {
  const { data, error } = await csClient.from('lead_reviews').select('id,chi,azione,tier,verdetto,motivo,nota,created_at').eq('account_id', accountId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadReview[];
}

// URL firmati (bucket privato lead-assets): 1 ora, in blocco. Mappa path -> url.
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(paths.filter(Boolean))];
  if (!uniq.length) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    const { data, error } = await csClient.storage.from('lead-assets').createSignedUrls(chunk, 3600);
    if (error) throw new Error(error.message);
    for (const d of data ?? []) if (d.signedUrl && d.path) out[d.path] = d.signedUrl;
  }
  return out;
}

// Tutti i path immagine di un dossier (screenshot, feed IG, foto prodotto) per firmarli insieme.
export function assetPathsOf(r: LeadDossier): string[] {
  return [r.thumb, r.shot_ig, r.shot_home, r.shot_home_mobile, r.shot_maps, r.shot_maps_photos,
    ...(r.ig_posts?.post ?? []).map((p) => p.asset_path), ...(r.site_products?.prodotti ?? []).map((p) => p.asset_path)]
    .filter((p): p is string => !!p);
}

export async function addReview(r: { account_id: string; chi: string; azione: 'tier' | 'scarta' | 'ricontrolla' | 'nota' | 'verdetto'; tier?: 'A' | 'B' | 'C' | null; verdetto?: 'da_contattare' | 'forse' | 'no' | null; motivo?: string | null; nota?: string | null }) {
  const { error } = await csClient.from('lead_reviews').insert(r);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------------------------
// Outreach, tappa 1 (migr 0114/0115): pipeline, tocchi, sequenze. Scrittura UI: INSERT su lead_touches.
export type LeadStage = 'da_contattare' | 'contattato' | 'risposto' | 'interessato' | 'materiale_inviato' | 'appuntamento' | 'primo_ordine' | 'attivo' | 'chiuso_no' | 'opt_out';
export const STAGES: { key: LeadStage; label: string }[] = [
  { key: 'da_contattare', label: 'Da contattare' }, { key: 'contattato', label: 'Contattato' }, { key: 'risposto', label: 'Risposto' },
  { key: 'interessato', label: 'Interessato' }, { key: 'materiale_inviato', label: 'Materiale inviato' }, { key: 'appuntamento', label: 'Appuntamento' },
  { key: 'primo_ordine', label: 'Primo ordine' }, { key: 'attivo', label: 'Attivo' }, { key: 'chiuso_no', label: 'Chiuso no' }, { key: 'opt_out', label: 'Opt-out' },
];
export const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
export const ESITI: { key: string; label: string }[] = [
  { key: 'interessato', label: 'Interessato' }, { key: 'chiede_info', label: 'Chiede informazioni' }, { key: 'piu_avanti', label: 'Più avanti' },
  { key: 'nessuna_risposta', label: 'Nessuna risposta' }, { key: 'no', label: 'No' }, { key: 'bounce', label: 'Email non valida' }, { key: 'opt_out', label: 'Opt-out (non contattare più)' }, { key: 'risposta_automatica', label: 'Risposta automatica' }, { key: 'opt_out_da_verificare', label: 'Forse opt-out: da verificare' }, { key: 'altro', label: 'Altro' },
];

export type LeadOutreach = {
  id: string; nome: string; tipo: string; citta: string | null; provincia: string | null; paese: string;
  website: string | null; ig_handle: string | null; email_generica: string | null; telefono: string | null;
  lead_stage: LeadStage; verdetto: string | null; verdetto_motivo: string | null; tier: string | null; gancio: string | null;
  prossima_azione: string | null; prossima_azione_at: string | null; owner_outreach: string | null; owner_note: string | null;
  totale: number | null; tier_proposto: string | null;
  ultimo_tocco_at: string | null; ultimo_canale: string | null; ultima_direzione: string | null; ultimo_esito: string | null; ultimo_chi: string | null;
  n_tocchi: number; n_email_out: number; giorni_da_ultimo: number | null; scaduta: boolean; da_gestire: boolean;
  thumb: string | null; follower: number | null; telefono_maps: string | null; email_sito: string | null; n_opt_out: number;
  bozza_auto_tocco: number | null;   // migr 0148: follow-up gia' scritto dal cron, da rivedere e inviare
};
export type LeadTouch = {
  id: string; account_id: string; contact_id: string | null; canale: string; direzione: 'in' | 'out'; subject: string | null; body_clean: string | null;
  stage_prima: string | null; stage_dopo: string | null; esito: string | null; prossima_azione: string | null; prossima_azione_at: string | null;
  sequenza_tocco: number | null; chi: string | null; at: string; created_at: string;
  gmail_message_id: string | null; gmail_thread_id: string | null;   // v11: senza thread il giro non ne legge le risposte
};
export type LeadSequence = { id: number; codice: string; tocco: number; giorni_attesa: number; canale: string; lingua: string; oggetto: string | null; corpo: string; chi_default: string | null; attiva: boolean };

export async function fetchOutreach(): Promise<LeadOutreach[]> {
  const { data, error } = await csClient.from('v_lead_outreach').select('*').order('prossima_azione_at', { ascending: true, nullsFirst: false }).order('totale', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadOutreach[];
}
export async function fetchTouches(accountId: string): Promise<LeadTouch[]> {
  const { data, error } = await csClient.from('lead_touches').select('*').eq('account_id', accountId).order('at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadTouch[];
}
// restituisce l'id del tocco scritto (v11: serve per collegarlo subito all'email di Posta inviata)
export async function addTouch(t: { account_id: string; canale: string; direzione: 'in' | 'out'; subject?: string | null; body_clean?: string | null; stage_prima?: string | null; stage_dopo?: string | null; esito?: string | null; prossima_azione?: string | null; prossima_azione_at?: string | null; sequenza_tocco?: number | null; chi: string; at?: string }): Promise<string> {
  const { data, error } = await csClient.from('lead_touches').insert(t).select('id').single();
  // 23505 = indice unico lead_touches_tocco_out_uq (migr 0139): lo stesso tocco email risulta gia' registrato
  if (error) throw new Error(error.code === '23505' ? `Il tocco ${t.sequenza_tocco ?? ''} risulta già registrato per questo negozio: guarda la Timeline.` : error.message);
  return String((data as { id: string }).id);
}
export async function fetchSequences(): Promise<LeadSequence[]> {
  const { data, error } = await csClient.from('lead_sequences').select('*').eq('attiva', true).order('codice').order('tocco');
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadSequence[];
}
export async function fetchLeadSettings(): Promise<Record<string, string>> {
  const { data, error } = await csClient.from('v_lead_settings').select('key,value');
  if (error) return {};
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
}
// ---------------------------------------------------------------------------------------------
// Bozze AI e invio dall'app (edge lead-outreach, migr 0139). La UI legge lead_drafts (RLS @amimi.it) e non ci
// scrive mai: bozza e invio passano dalla edge, che verifica il JWT e fa le guardie (flag, verdetto, opt-out,
// tetto giornaliero, segnaposto rimasti, un tocco per negozio).
export type LeadDraft = {
  id: string; account_id: string; lingua: string | null; oggetto: string | null; testo: string; to_email: string | null;
  sequenza_tocco: number | null; stato: 'proposta' | 'approvata' | 'in_invio' | 'inviata' | 'errore' | 'scartata';
  chi: string | null; sent_by: string | null; sent_at: string | null; errore: string | null; created_at: string;
  // v15: una proposta di risposta (sequenza_tocco null, stato 'proposta') porta tipo 'risposta' e le sue alternative
  fatti_usati: { fatti_usati?: string[]; avvisi?: string[]; tipo?: 'risposta'; alternative?: { titolo: string; testo: string; non_grounded?: string[]; troncata?: boolean; avvisi?: string[]; segnaposto?: string[] }[] } | null;
  origine: 'manuale' | 'auto';
};
export async function fetchDrafts(accountId: string): Promise<LeadDraft[]> {
  const { data, error } = await csClient.from('lead_drafts').select('id,account_id,lingua,oggetto,testo,to_email,sequenza_tocco,stato,chi,sent_by,sent_at,errore,created_at,fatti_usati,origine').eq('account_id', accountId).order('created_at', { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadDraft[];
}
const LEAD_OUTREACH_URL = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/lead-outreach';
async function callOutreach(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await csClient.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessione scaduta: rientra.');
  // Gate Fable (15-10, A): se la rete cade fra browser ed edge, o il gateway risponde senza un corpo della edge, la richiesta
  // puo' essere arrivata ed eseguita: e' un esito INCERTO, come la rete giu' fra edge e Gmail. Chi invia tiene la stessa
  // chiave (send_key), cosi' un secondo click non rimanda l'email.
  const INCERTO = payload.action === 'send' || payload.action === 'rispondi'
    ? 'Esito incerto (la rete si è interrotta): controlla \u201cPosta inviata\u201d di info@amimi.it prima di riprovare.'
    : 'Esito incerto (la rete si è interrotta): ricarica la pagina e controlla se e\u2019 andata prima di riprovare.';
  let r: Response;
  try { r = await fetch(LEAD_OUTREACH_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(payload) }); }
  catch { const e = new Error(INCERTO) as Error & { incerto?: boolean }; e.incerto = true; throw e; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    const senzaCorpo = r.status >= 500 && !j.error;
    const e = new Error(senzaCorpo ? INCERTO : j.error || 'Errore ' + r.status) as Error & { bloccante?: boolean; incerto?: boolean; codice?: string; dati?: Record<string, unknown> };
    if (j.bloccante === true) e.bloccante = true;
    if (j.incerto === true || senzaCorpo) e.incerto = true;   // la stessa chiave non deve ripartire
    if (typeof j.codice === 'string') e.codice = j.codice;   // v15: cosa e' successo alla proposta (il web decide su questo, non sul testo)
    e.dati = j;   // v13: un 409 di "negozio gia' esistente" porta i candidati (duplicati)
    throw e;
  }
  return j;
}
export type DraftResult = { draft_id: string; oggetto: string; testo: string; to: string; lingua: string; tocco: number; segnaposto: string[]; avvisi: string[] };
export async function generaBozza(p: { account_id: string; tocco: number; referente?: string; lingua?: 'it' | 'en'; chi: string }): Promise<DraftResult> {
  return (await callOutreach({ action: 'draft', ...p })) as unknown as DraftResult;
}
export const LEAD_MITTENTE = 'wholesale@amimi.it';   // alias sendAs di info@: la edge ripiega su info@ se non e' verificato
export type LeadSendResult = { to: string; from?: string; oggetto: string; already_sent?: boolean; prossimo: string | null; warnings?: string[] };
export async function inviaBozza(p: { draft_id: string; send_key: string; to: string; oggetto: string; testo: string; chi: string }): Promise<LeadSendResult> {
  return (await callOutreach({ action: 'send', ...p })) as unknown as LeadSendResult;
}
// prova (edge v8): il testo del compositore alla casella di chi e' loggato, con "[PROVA]" nell'oggetto. Il destinatario
// lo decide la edge dal login; bozza, tocchi e tetto non cambiano. L'invio vero rifiuta gli indirizzi @amimi.it.
export type LeadProvaResult = { to: string; from?: string; segnaposto?: number; warnings?: string[] };
export async function inviaProva(p: { oggetto: string; testo: string }): Promise<LeadProvaResult> {
  return (await callOutreach({ action: 'prova', ...p })) as unknown as LeadProvaResult;
}
export const indirizzoInterno = (to: string): boolean => /@amimi\.it$/i.test(to.trim());
// bozza rimasta 'in_invio' (esito incerto): si sblocca solo dopo aver controllato "Posta inviata" di info@
export async function sbloccaBozza(p: { draft_id: string; chi: string }): Promise<void> {
  await callOutreach({ action: 'sblocca', ...p });
}
// v12 (blocco B): risposta scritta dalla persona a un negozio che ci ha scritto. La edge decide il thread, non conta il
// tetto e non chiede la riga di opt-out; send_key nuovo per ogni risposta (lo stesso solo per ripetere la stessa richiesta).
export type LeadRispostaResult = { to: string; from?: string; oggetto: string; nel_thread?: boolean; already_sent?: boolean; warnings?: string[] };
// v15: `draft_id` facoltativo = la proposta AI da cui parte il testo (la edge la porta in invio con un UPDATE); fa fede il box
export async function inviaRisposta(p: { account_id: string; to: string; oggetto: string; testo: string; send_key: string; chi: string; draft_id?: string | null }): Promise<LeadRispostaResult> {
  return (await callOutreach({ action: 'rispondi', ...p })) as unknown as LeadRispostaResult;
}
// v15 (edge lead-outreach v15, flag lead_risposta_ai_enabled): la proposta di risposta dalla CONVERSAZIONE col negozio, come
// in Assistenza: 1-3 alternative per esito, con titolo; `non_grounded` = numeri, date e link che NON stanno nei fatti
// (linter della edge); `segnaposto` = [DA VERIFICARE] rimasti, che bloccano l'invio. Generare non spedisce nulla.
export type Alternativa = { titolo: string; testo: string; non_grounded: string[]; troncata: boolean; avvisi: string[]; segnaposto: string[] };
export type PropostaRisposta = { draft_id: string; alternative: Alternativa[]; lingua: 'it' | 'en'; oggetto: string; to: string; ultimo_at: string | null };
export async function proponiRisposta(p: { account_id: string; chi: string }): Promise<PropostaRisposta> {
  return (await callOutreach({ action: 'proponi_risposta', ...p })) as unknown as PropostaRisposta;
}
// v15: il testo del box riscritto con l'istruzione della persona ("piu' breve", "proponi martedi'"); vale anche per la sequenza
// a freddo (modo 'sequenza': la riga di opt-out resta). Non scrive nulla: il testo torna nel box e la persona decide.
export async function rifinisciTesto(p: { account_id: string; testo: string; istruzione: string; modo: 'risposta' | 'sequenza'; lingua?: 'it' | 'en'; chi: string }): Promise<Alternativa> {
  return (await callOutreach({ action: 'rifinisci', ...p })) as unknown as Alternativa;
}
// v11 (blocco A3): le email di Posta inviata di info@ che si possono collegare a un tocco registrato a mano. La scelta
// e' sempre della persona: l'edge propone, aggancia scrive (solo le due colonne Gmail di quel tocco).
export type InviataCandidata = { gmail_message_id: string; oggetto: string; data: string; a: string };
export async function cercaInviate(touch_id: string): Promise<{ candidati: InviataCandidata[]; gia_agganciato?: boolean; motivo?: string }> {
  const j = await callOutreach({ action: 'cerca_inviate', touch_id });
  return { candidati: (j.candidati ?? []) as InviataCandidata[], gia_agganciato: j.gia_agganciato === true, motivo: typeof j.motivo === 'string' ? j.motivo : undefined };
}
export async function agganciaTocco(p: { touch_id: string; gmail_message_id: string; chi: string }): Promise<void> {
  await callOutreach({ action: 'aggancia', ...p });
}
// una bozza non partita esce dalla Coda (il cron non la riscrive: una bozza automatica per tocco)
export async function scartaBozza(p: { draft_id: string; chi: string }): Promise<void> {
  await callOutreach({ action: 'scarta', ...p });
}
// "da fare" del B2B per il badge nella barra in basso: risposte da gestire, azioni scadute, follow-up da rivedere.
// null = nessun numero valido: senza sessione (la sezione vuole il login @amimi.it) o con una vista in errore, che non
// e' "0 da fare". Il badge e' un aiuto, mai un blocco: chi lo mostra tratta null come 0 e riprova al cambio di tab
// successivo (senza sessione non fa richieste); con un numero valido legge per eventi (App.tsx, CASI_APERTI n.38 a).
export async function fetchLeadTodo(): Promise<number | null> {
  const { data } = await csClient.auth.getSession();
  if (!data.session) return null;
  const [{ count, error }, { count: nIn, error: inErr }, { data: flag }] = await Promise.all([
    csClient.from('v_lead_outreach').select('id', { count: 'exact', head: true }).or('scaduta.eq.true,da_gestire.eq.true,bozza_auto_tocco.not.is.null'),
    csClient.from('v_lead_inbound').select('conv_id', { count: 'exact', head: true }),   // v13: messaggi da collegare
    csClient.from('v_lead_settings').select('value').eq('key', 'lead_outreach_ai_enabled').maybeSingle(),
  ]);
  // i messaggi da collegare si vedono in Coda solo col flag acceso: senza, il badge non li conta (Gate 2, 15-10)
  const inbound = (flag as { value?: string } | null)?.value === 'true' && !inErr ? nIn ?? 0 : 0;
  if (error || (inErr && (flag as { value?: string } | null)?.value === 'true')) return null;
  return (count ?? 0) + inbound;
}

// v13 (blocco C, migr 0158): messaggi di Assistenza che possono essere un negozio, non ancora nel cruscotto. Si leggono
// dalla vista (RLS @amimi.it); collegare, creare e scartare passano dalla edge, che scrive solo tabelle lead_*.
export type NegozioCandidato = { id: string; nome: string; citta: string | null; lead_stage?: string; via: string };
export type LeadInbound = {
  conv_id: string; customer_email: string | null; customer_name: string | null; subject: string | null; snippet: string | null; last_msg_at: string;
  gmail_thread_id: string | null; da_modulo: boolean; a_wholesale: boolean; n_in: number; candidati: NegozioCandidato[];
};
export async function fetchInbound(): Promise<LeadInbound[]> {
  const { data, error } = await csClient.from('v_lead_inbound').select('*').order('last_msg_at', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadInbound[];
}
export async function inboundCollega(p: { conv_id: string; account_id: string; chi: string }): Promise<{ tocchi: number }> {
  return (await callOutreach({ action: 'inbound_collega', ...p })) as unknown as { tocchi: number };
}
export async function inboundScarta(p: { conv_id: string; chi: string }): Promise<void> {
  await callOutreach({ action: 'inbound_scarta', ...p });
}
export type DatiNegozio = { nome: string; citta: string; tipo: string; email?: string; telefono?: string; ig_handle?: string; website?: string; referente?: string; nota?: string; forza?: boolean };
export async function inboundCrea(p: DatiNegozio & { conv_id: string; chi: string }): Promise<{ account_id: string }> {
  return (await callOutreach({ action: 'inbound_crea', ...p })) as unknown as { account_id: string };
}
export async function nuovoNegozio(p: DatiNegozio & { canale: string; chi: string }): Promise<{ account_id: string }> {
  return (await callOutreach({ action: 'nuovo_negozio', ...p })) as unknown as { account_id: string };
}
// stessi segnaposto che la edge blocca: la UI li mostra PRIMA di premere Invia
export const segnaposto = (s: string): string[] => [...s.matchAll(/\[[^\]\n]{1,200}\]|\{\{[^}\n]{1,60}\}\}/g)].map((m) => m[0]);

// riempie i segnaposto del template con i dati del negozio; i buchi restano visibili fra parentesi quadre
// (e bloccano l'invio dall'app). {{linesheet}} = app_flags.lead_linesheet_url (migr 0145).
export function renderTemplate(tpl: string, r: { nome: string; citta?: string | null; gancio?: string | null }, referente: string | null, firma: string, linesheet = ''): string {
  return tpl
    .replace(/\{\{nome_negozio\}\}/g, r.nome)
    .replace(/\{\{citta\}\}/g, r.citta ?? '[città]')
    .replace(/\{\{referente\}\}/g, referente?.trim() || `team di ${r.nome}`)
    .replace(/\{\{gancio\}\}/g, r.gancio ?? '[GANCIO DA SCRIVERE: una cosa vera vista nel dossier]')
    .replace(/\{\{linesheet\}\}/g, linesheet || '[LINK LINE SHEET: manca app_flags.lead_linesheet_url]')
    .replace(/\{\{firma\}\}/g, firma);
}
