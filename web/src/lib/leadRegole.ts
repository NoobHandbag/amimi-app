// Regole pure del cruscotto B2B (Negozi B2B > Pipeline), senza import: le usa la scheda outreach e le prova
// tests/lead_outreach_guardie.mjs importando questo file. Decisioni dell'owner del 15-10 (report del cruscotto, sez. 8).

export type ToccoMinimo = { direzione: string; esito: string | null };

// esiti di un tocco in entrata che NON vogliono dire "il negozio ci ha scritto"
const NON_CONVERSAZIONE = ['bounce', 'risposta_automatica', 'opt_out'];

// Il negozio ci ha scritto: almeno un tocco in entrata che non sia un bounce, una risposta automatica o un opt-out.
// Vale per ogni canale: un modulo, un'email, una telefonata o una visita registrate come "Loro -> noi" contano.
export function negozioCiHaScritto(tocchi: ToccoMinimo[]): boolean {
  return tocchi.some((t) => t.direzione === 'in' && !NON_CONVERSAZIONE.includes(t.esito ?? ''));
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
      messaggio: `Registrata come inviata. Il negozio ci aveva gia’ scritto: niente sequenza a freddo, promemoria fra ${GIORNI_ATTESA_RISPOSTA} giorni se non risponde.`,
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
