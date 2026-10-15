import { fetchLista, fetchListaUno, fetchDossierUno, fetchOutreach, fetchSequences, fetchLeadSettings, signedUrls } from './leadApi';
import type { LeadLista, LeadDossier, LeadOutreach, LeadSequence } from './leadApi';

// Cache in memoria della sezione Negozi B2B (15-10, "tutta la sezione e' LENTISSIMA, 5-10 secondi a ogni click").
// Vive a livello di modulo: sopravvive alle navigazioni fra Home e Negozi e si svuota solo ricaricando la pagina. Al
// rientro nella sezione i dati di qui si mostrano SUBITO e si aggiornano in background.
// Ogni lettura ha UNA promessa condivisa: chi arriva mentre un caricamento e' in corso aspetta quello, mai un secondo
// caricamento parallelo (due letture sovrapposte della lista mandavano PostgREST in timeout).
// Gli URL firmati del bucket privato lead-assets durano 1 ora: qui si tengono con l'istante della firma e si rifirmano
// dopo 50 minuti; un path che il bucket non conosce resta segnato (url null) per non richiederlo a ogni render.

const FIRMA_VALIDA_MS = 50 * 60 * 1000;
const RITENTA_DOPO_MS = 60 * 1000;   // firma fallita (rete, storage giu'): si riprova dopo un minuto, non a ogni render
const BLOCCO_FIRMA = 100;            // createSignedUrls accetta blocchi: 100 path per chiamata, chiamate in parallelo
const MAX_DOSSIER = 30;              // dossier completi tenuti (circa 15 KB l'uno): gli ultimi aperti

type Firmato = { url: string | null; at: number };
const cache = {
  lista: null as LeadLista[] | null,
  pipeline: null as LeadOutreach[] | null,
  sequences: null as LeadSequence[] | null,
  settings: null as Record<string, string> | null,
  dossier: new Map<string, LeadDossier>(),
  firme: new Map<string, Firmato>(),
};

type Slot<T> = { p: Promise<T> | null; at: number };
const slotLista: Slot<LeadLista[]> = { p: null, at: 0 };
const slotPipeline: Slot<LeadOutreach[]> = { p: null, at: 0 };
const slotSeqSet: Slot<{ sequences: LeadSequence[]; settings: Record<string, string> }> = { p: null, at: 0 };
const slotDossier = new Map<string, { p: Promise<LeadDossier | null>; at: number }>();
const firmeInCorso = new Map<string, Promise<void>>();

// `dopo` = l'istante di una scrittura appena fatta: una lettura partita PRIMA non vale (porterebbe a schermo dati vecchi
// come aggiornati, Gate 2 v15 B1) e se ne lancia una nuova; la vecchia finisce ma non scrive piu' la cache.
function condivisa<T>(slot: Slot<T>, fn: () => Promise<T>, applica: (r: T) => void, dopo = 0): Promise<T> {
  if (slot.p && slot.at >= dopo) return slot.p;
  const at = Date.now();
  const p = fn().then((r) => { if (slot.at === at) applica(r); return r; }).finally(() => { if (slot.p === p) slot.p = null; });
  slot.p = p; slot.at = at;
  return p;
}

export function leggiCache() {
  return { lista: cache.lista, pipeline: cache.pipeline, sequences: cache.sequences, settings: cache.settings };
}

export function caricaLista(dopo = 0): Promise<LeadLista[]> {
  return condivisa(slotLista, fetchLista, (r) => { cache.lista = r; }, dopo);
}
export function caricaPipeline(dopo = 0): Promise<LeadOutreach[]> {
  return condivisa(slotPipeline, fetchOutreach, (o) => { cache.pipeline = o; }, dopo);
}
// sequenze e settings insieme, in un solo giro: il compositore rende il template con firma e link gia' noti (Gate 2 del
// 25-09, B3). Si leggono una volta; `forza` le rilegge (bottone Aggiorna).
export function caricaSequenzeSettings(forza = false): Promise<{ sequences: LeadSequence[]; settings: Record<string, string> }> {
  if (!forza && cache.sequences && cache.settings) return Promise.resolve({ sequences: cache.sequences, settings: cache.settings });
  return condivisa(slotSeqSet, async () => {
    const [sequences, settings] = await Promise.all([fetchSequences(), fetchLeadSettings()]);
    return { sequences, settings };
  }, (r) => { cache.sequences = r.sequences; cache.settings = r.settings; });
}

// Una riga della lista riletta dopo una scrittura (verdetto, tier, nota...): sostituisce quella in cache senza rileggere
// tutto. Torna la lista aggiornata, o null se la lista non e' ancora in cache (allora la riga arrivera' col primo giro).
export async function aggiornaRigaLista(id: string): Promise<LeadLista[] | null> {
  const riga = await fetchListaUno(id);
  if (!cache.lista) return null;
  const i = cache.lista.findIndex((r) => r.id === id);
  if (!riga) { if (i < 0) return cache.lista; cache.lista = cache.lista.filter((r) => r.id !== id); return cache.lista; }
  cache.lista = i < 0 ? [...cache.lista, riga] : cache.lista.map((r) => (r.id === id ? riga : r));
  return cache.lista;
}
// Negozi presenti in pipeline ma non nella lista in cache (creati dalla Coda o collegati da Assistenza): poche righe,
// lette una per una invece di rifare tutta la lista. Torna la lista aggiornata o null se non c'era nulla da fare.
export async function righeMancanti(ids: string[], max = 10): Promise<LeadLista[] | null> {
  if (!cache.lista) return null;
  const noti = new Set(cache.lista.map((r) => r.id));
  const nuovi = [...new Set(ids.filter((id) => !noti.has(id)))].slice(0, max);
  if (!nuovi.length) return null;
  const righe = (await Promise.all(nuovi.map((id) => fetchListaUno(id)))).filter((r): r is LeadLista => !!r);
  if (!righe.length) return null;
  cache.lista = [...cache.lista, ...righe];
  return cache.lista;
}

export function dossierInCache(id: string): LeadDossier | null {
  return cache.dossier.get(id) ?? null;
}
// Il dossier completo di un negozio (v_lead_dossier per id): si tiene per rientrarci subito, si rilegge in background.
export function caricaDossier(id: string, dopo = 0): Promise<LeadDossier | null> {
  const inCorso = slotDossier.get(id);
  if (inCorso && inCorso.at >= dopo) return inCorso.p;
  const at = Date.now();
  const p = fetchDossierUno(id).then((d) => {
    if (slotDossier.get(id)?.at !== at) return d;   // e' partita una lettura piu' nuova: la cache e' sua
    if (d) {
      cache.dossier.delete(id); cache.dossier.set(id, d);
      while (cache.dossier.size > MAX_DOSSIER) { const primo = cache.dossier.keys().next().value; if (primo === undefined) break; cache.dossier.delete(primo); }
    } else cache.dossier.delete(id);
    return d;
  }).finally(() => { if (slotDossier.get(id)?.p === p) slotDossier.delete(id); });
  slotDossier.set(id, { p, at });
  return p;
}

const valida = (p: string, now: number) => { const f = cache.firme.get(p); return !!f && now - f.at < FIRMA_VALIDA_MS; };
// tutti gli URL firmati ancora validi: stato iniziale di `urls` al rientro nella sezione
export function urlsValidi(): Record<string, string> {
  const now = Date.now(); const out: Record<string, string> = {};
  for (const [p, f] of cache.firme) if (f.url && now - f.at < FIRMA_VALIDA_MS) out[p] = f.url;
  return out;
}
// i path che non hanno una firma valida e non sono gia' in firma: cio' che un render deve ancora chiedere
export function daFirmare(paths: (string | null | undefined)[]): string[] {
  const now = Date.now();
  return [...new Set(paths.filter((p): p is string => !!p))].filter((p) => !valida(p, now) && !firmeInCorso.has(p));
}
// Firma i path mancanti o scaduti a blocchi da 100 in parallelo; chi chiede un path gia' in firma aspetta quella
// chiamata invece di rifarla. Torna gli URL validi dei path chiesti (anche quelli gia' in cache).
export async function firma(paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const uniq = [...new Set(paths.filter((p): p is string => !!p))];
  const now = Date.now();
  const mancanti = uniq.filter((p) => !valida(p, now) && !firmeInCorso.has(p));
  const attese = uniq.map((p) => firmeInCorso.get(p)).filter((p): p is Promise<void> => !!p);
  const blocchi: string[][] = [];
  for (let i = 0; i < mancanti.length; i += BLOCCO_FIRMA) blocchi.push(mancanti.slice(i, i + BLOCCO_FIRMA));
  const lavori = blocchi.map(async (b) => {
    const at = Date.now();
    try {
      const s = await signedUrls(b);
      for (const p of b) cache.firme.set(p, { url: s[p] ?? null, at });
    } catch (e) {
      for (const p of b) cache.firme.set(p, { url: null, at: at - FIRMA_VALIDA_MS + RITENTA_DOPO_MS });
      throw e;
    } finally { for (const p of b) firmeInCorso.delete(p); }
  });
  blocchi.forEach((b, i) => b.forEach((p) => firmeInCorso.set(p, lavori[i])));
  // un blocco fallito non nasconde quelli riusciti (Gate 2 v15, B3): gli URL arrivati tornano sempre, e l'errore li porta
  // con se' (`urls`) cosi' chi lo prende li mette a schermo prima di mostrare l'avviso
  const esiti = await Promise.allSettled([...lavori, ...attese]);
  const out: Record<string, string> = {};
  const dopo = Date.now();
  for (const p of uniq) { const f = cache.firme.get(p); if (f?.url && dopo - f.at < FIRMA_VALIDA_MS) out[p] = f.url; }
  const ko = esiti.find((e): e is PromiseRejectedResult => e.status === 'rejected');
  if (ko) {
    const err = new Error(String((ko.reason as Error)?.message ?? ko.reason)) as Error & { urls?: Record<string, string> };
    err.urls = out;
    throw err;
  }
  return out;
}
