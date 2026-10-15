// Regole pure del cruscotto B2B (Negozi B2B > Pipeline), senza import: le usa la scheda outreach e le prova
// tests/lead_outreach_guardie.mjs importando questo file. Decisioni dell'owner del 15-10 (report del cruscotto, sez. 8).

export type ToccoMinimo = { direzione: string; esito: string | null };

// esiti di un tocco in entrata che NON vogliono dire "il negozio ci ha scritto"
export const NON_CONVERSAZIONE = ['bounce', 'risposta_automatica', 'opt_out'];

// Il negozio ci ha scritto: almeno un tocco in entrata che non sia un bounce, una risposta automatica o un opt-out.
// Vale per ogni canale: un modulo, un'email, una telefonata o una visita registrate come "Loro -> noi" contano.
export function negozioCiHaScritto(tocchi: ToccoMinimo[]): boolean {
  return tocchi.some((t) => t.direzione === 'in' && !NON_CONVERSAZIONE.includes(t.esito ?? ''));
}

// v12 (blocco B): come si prepara il riquadro "Rispondi". Stessa regola della edge (bersaglioRisposta): la risposta va
// nel thread dell'ultimo messaggio vero (un tocco con id Gmail, bounce e risposte automatiche esclusi); se quel messaggio
// e' il modulo del sito (senza thread) parte un'email nuova. Il destinatario e' chi ci ha scritto per ultimo (la prima
// riga dei tocchi in entrata scritti dal giro e' il suo indirizzo), altrimenti l'email del negozio.
export type ToccoRisposta = ToccoMinimo & { at: string; canale: string; subject: string | null; body_clean: string | null; gmail_message_id: string | null; gmail_thread_id: string | null };
const EMAIL_RIGA = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
export function rispostaPreparata(tocchi: ToccoRisposta[], nome: string, emailNegozio: string): { to: string; oggetto: string; nelThread: boolean; riferimento: { subject: string; at: string } | null } {
  const ord = [...tocchi].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const msg = ord.find((t) => t.gmail_message_id && t.esito !== 'bounce' && t.esito !== 'risposta_automatica');
  // chi ci ha scritto per ultimo per EMAIL o dal modulo: una telefonata o un DM registrati dopo non cambiano il destinatario
  const ultimoIn = ord.find((t) => t.direzione === 'in' && (t.canale === 'email' || t.canale === 'altro') && !NON_CONVERSAZIONE.includes(t.esito ?? ''));
  const riga = (ultimoIn?.body_clean ?? '').split('\n')[0].trim();
  const to = EMAIL_RIGA.test(riga) ? riga.toLowerCase() : emailNegozio;
  const base = String(msg?.subject ?? '').replace(/^\s*((re|r|fwd?|i)\s*:\s*)+/i, '').trim();
  if (msg?.gmail_thread_id) return { to, oggetto: `Re: ${base || `Amimì Milano per ${nome}`}`, nelThread: true, riferimento: { subject: base, at: msg.at } };
  return { to, oggetto: `Amimì Milano per ${nome}`, nelThread: false, riferimento: msg ? { subject: base, at: msg.at } : null };
}
// gli stessi avvisi di contenuto della edge (avvisiContenuto, PURE:lead-guard), mostrati MENTRE si scrive la risposta:
// una persona non li vede in una bozza AI, quindi devono comparire prima del click. Provati sugli stessi testi.
export function avvisiTesto(testo: string): string[] {
  const a: string[] = [];
  const low = testo.toLowerCase();
  if (/\bindia\b/.test(low)) a.push('il testo nomina l\'India: non si dice mai');
  if (/cotone[^.\n]{0,80}(made in italy|in italia|italian)|(made in italy|in italia)[^.\n]{0,80}cotone/.test(low)) a.push('il testo associa il cotone all\'Italia: vale solo per la pelle');
  if (/\d+\s?%/.test(testo)) a.push('il testo contiene una percentuale: nelle email non si scrivono sconti ne\' supplementi, si rimanda alla line sheet');
  if (/ordine minimo|minimo d.ordine|conto vendita|consignment|minimum order/.test(low)) a.push('il testo cita minimi d\'ordine o conto vendita: controlla che coincida con la line sheet (primo ordine 12 pezzi e 400 euro netto; il conto vendita non c\'e\' piu\')');
  if (/alleg|attach/.test(low)) a.push('il testo parla di un allegato: l\'email parte senza allegati');
  return a;
}

const piuGiorni = (oggi: Date, n: number): string => { const d = new Date(oggi.getTime()); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
export const GIORNI_ATTESA_RISPOSTA = 5;

// Cosa registra "Segna come inviata". Per un negozio che non ci ha mai scritto e' un tocco della sequenza a freddo,
// con il follow-up successivo. Per un negozio che ci ha scritto (blocco A4) NON e' un tocco della sequenza: niente
// numero di tocco (non consuma i 4 della sequenza), niente "follow-up N di 4", e un promemoria se non risponde.
export function dopoInvioManuale(p: { ciHaScritto: boolean; email: boolean; tocco: number; prossimo: { tocco: number; giorni_attesa: number } | null; oggi: Date }): { sequenza_tocco: number | null; prossima_azione: string; prossima_azione_at: string | null; avanzaTocco: boolean; messaggio: string } {
  if (p.email && p.ciHaScritto) {
    return {
      sequenza_tocco: null, prossima_azione: 'attesa risposta del negozio', prossima_azione_at: piuGiorni(p.oggi, GIORNI_ATTESA_RISPOSTA), avanzaTocco: false,
      messaggio: `Registrata come inviata. Il negozio ci aveva già scritto: niente sequenza a freddo, promemoria fra ${GIORNI_ATTESA_RISPOSTA} giorni se non risponde.`,
    };
  }
  return {
    sequenza_tocco: p.tocco,
    prossima_azione: p.prossimo ? `follow-up ${p.prossimo.tocco} di 4` : 'chiusura: nessun altro tocco',
    prossima_azione_at: p.prossimo ? piuGiorni(p.oggi, p.prossimo.giorni_attesa) : null,
    avanzaTocco: true,
    messaggio: p.prossimo ? `Registrata come inviata. Follow-up ${p.prossimo.tocco} fra ${p.prossimo.giorni_attesa} giorni.` : 'Registrata come inviata. Sequenza finita.',
  };
}

// v15 (15-10, "fallo come Assistenza"): la scheda del negozio mostra la conversazione a bolle e un solo compositore.
// Regole pure della scheda, senza import, provate da tests/lead_outreach_guardie.mjs.

export type ToccoConv = ToccoRisposta & { id: string; chi: string | null; sequenza_tocco: number | null; stage_dopo: string | null; prossima_azione: string | null; prossima_azione_at: string | null };
export type ElementoConv = {
  tipo: 'bolla' | 'nota'; id: string; direzione: string; canale: string; at: string; chi: string | null; esito: string | null;
  subject: string | null; testo: string; mittente: string | null; sequenza_tocco: number | null; stage_dopo: string | null;
  gmail_thread_id: string | null; prossima_azione: string | null; prossima_azione_at: string | null;
};

// La conversazione in ordine cronologico (la piu' vecchia in alto). Bolla = email (in o out) e messaggi in entrata
// importati o del modulo (canale altro); nota = telefonate, visite, Instagram, note e spostamenti, bounce e risposte
// automatiche. In una bolla in entrata la prima riga di body_clean, se e' un indirizzo email, diventa il mittente.
export function ordinaConversazione(tocchi: ToccoConv[]): ElementoConv[] {
  const ord = [...tocchi].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  return ord.map((t) => {
    const automatico = t.direzione === 'in' && NON_CONVERSAZIONE.includes(t.esito ?? '');
    const bolla = !automatico && (t.canale === 'email' || (t.direzione === 'in' && t.canale === 'altro'));
    const righe = String(t.body_clean ?? '').split('\n');
    const primaRiga = (righe[0] ?? '').trim();
    const conMittente = bolla && t.direzione === 'in' && EMAIL_RIGA.test(primaRiga);
    const testo = (conMittente ? righe.slice(1).join('\n') : righe.join('\n')).trim();
    return {
      tipo: bolla ? 'bolla' : 'nota', id: t.id, direzione: t.direzione, canale: t.canale, at: t.at, chi: t.chi, esito: t.esito,
      subject: t.subject, testo, mittente: conMittente ? primaRiga.toLowerCase() : null, sequenza_tocco: t.sequenza_tocco, stage_dopo: t.stage_dopo,
      gmail_thread_id: t.gmail_thread_id, prossima_azione: t.prossima_azione, prossima_azione_at: t.prossima_azione_at,
    };
  });
}

// La proposta di risposta AI piu' recente ancora aperta: sequenza_tocco null, stato 'proposta', fatti_usati.tipo
// 'risposta' (le bozze della sequenza a freddo e le risposte gia' partite non contano). Null se non c'e'.
export type BozzaMinima = { sequenza_tocco: number | null; stato: string; created_at: string; fatti_usati: { tipo?: string } | null };
export function propostaSalvata<T extends BozzaMinima>(drafts: T[]): T | null {
  const aperte = drafts.filter((d) => d.sequenza_tocco == null && d.stato === 'proposta' && d.fatti_usati?.tipo === 'risposta');
  aperte.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return aperte[0] ?? null;
}

// Una proposta inganna se dopo di lei e' successo qualcosa: il negozio ha scritto di nuovo (tocco in entrata vero,
// non bounce o automatico) o e' gia' partita un'email nostra. Date confrontate come istanti, non come stringhe.
export function propostaStantia(createdAt: string, tocchi: (ToccoMinimo & { at: string; canale: string })[]): { scrittoDopo: boolean; rispostoDopo: boolean } {
  const q = Date.parse(createdAt);
  const dopo = tocchi.filter((t) => Date.parse(t.at) > q);
  return {
    scrittoDopo: dopo.some((t) => t.direzione === 'in' && !NON_CONVERSAZIONE.includes(t.esito ?? '')),
    rispostoDopo: dopo.some((t) => t.direzione === 'out' && t.canale === 'email'),
  };
}

// Data dell'ultima email nostra se e' piu' recente dell'ultimo messaggio vero del negozio (quindi una risposta risulta
// gia' partita e da allora il negozio non ha piu' scritto), altrimenti null. Stessa regola dell'avviso di Assistenza.
export function giaRisposto(tocchi: (ToccoMinimo & { at: string; canale: string })[]): string | null {
  const ultimo = (f: (t: ToccoMinimo & { at: string; canale: string }) => boolean): string | null => tocchi.filter(f).map((t) => t.at).sort((a, b) => Date.parse(a) - Date.parse(b)).pop() ?? null;
  const out = ultimo((t) => t.direzione === 'out' && t.canale === 'email');
  const inn = ultimo((t) => t.direzione === 'in' && !NON_CONVERSAZIONE.includes(t.esito ?? ''));
  if (!out || (inn && Date.parse(inn) > Date.parse(out))) return null;
  return out;
}

// Modo iniziale del compositore: 'risposta' se il negozio ci ha scritto e si puo' contattare (non opt_out, non
// chiuso_no, nessun opt-out registrato), altrimenti la sequenza a freddo. La persona puo' sempre cambiarlo.
export function modoIniziale(tocchi: ToccoMinimo[], stage: string, nOptOut: number): 'risposta' | 'sequenza' {
  return negozioCiHaScritto(tocchi) && stage !== 'opt_out' && stage !== 'chiuso_no' && nOptOut === 0 ? 'risposta' : 'sequenza';
}
