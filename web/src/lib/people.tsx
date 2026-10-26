// Centralized people + persona-driven navigation. Dan removed (= Ale, same person).
// The Home surfaces only the tiles relevant to each persona; Registra shows the same actions for everyone.

export type Tab = 'home' | 'registra' | 'ordini' | 'magazzino' | 'cruscotto' | 'ce' | 'margini' | 'clienti' | 'salute' | 'assistenza' | 'negozi' | 'ads' | 'materiali' | 'premia' | 'villaggio' | 'notifiche' | 'comportamento';
/** Tab visibili SOLO alle persona con finance=true (Home le filtra). 'ads' (18-09) si raggiunge dal Cruscotto o da #ads.
 *  'comportamento' (25-10, decisione D4): tessera solo di Ale, ed e' solo interfaccia: la RPC accetta tutto il team. */
export const FINANCE_TABS: ReadonlySet<Tab> = new Set<Tab>(['cruscotto', 'ce', 'margini', 'clienti', 'ads', 'premia', 'comportamento']);
export type Tile = { icon: string; label: string; tab: Tab; param?: string; badge?: 'arrivi' | 'todo' };

export const PEOPLE = ['Ale', 'Bene', 'Ginevra'] as const;

export const PERSONA: Record<string, { name: string; finance: boolean; tiles: Tile[] }> = {
  Ale: {
    name: 'Ale', finance: true,
    tiles: [
      { icon: 'chart', label: 'Cruscotto finanze', tab: 'cruscotto' },
      { icon: 'euro', label: 'CE dettagliato', tab: 'ce' },
      { icon: 'pulse', label: 'Salute & Movimenti', tab: 'salute' },
      { icon: 'bag', label: 'Registra vendita', tab: 'registra', param: 'gift' },
      { icon: 'tag', label: 'Margini', tab: 'margini' },
      { icon: 'handshake', label: 'Clienti', tab: 'clienti' },
      { icon: 'gift', label: 'Premia', tab: 'premia' },
      { icon: 'search', label: 'Comportamento', tab: 'comportamento' },
      { icon: 'store', label: 'Negozi B2B', tab: 'negozi' },
      { icon: 'recycle', label: 'Cosa riprodurre', tab: 'magazzino', param: 'riordino' },
      { icon: 'sparkles', label: 'Pulizia dati', tab: 'registra', param: 'pulizia', badge: 'todo' },
      { icon: 'box', label: 'Ordini in arrivo', tab: 'ordini', badge: 'arrivi' },
      { icon: 'globe', label: 'Villaggio', tab: 'villaggio' },
    ],
  },
  Bene: {
    name: 'Benny', finance: false,
    tiles: [
      { icon: 'sparkles', label: 'Pulizia dati', tab: 'registra', param: 'pulizia', badge: 'todo' },
      { icon: 'bag', label: 'Registra vendita', tab: 'registra', param: 'gift' },
      { icon: 'return', label: 'Reso / Cambio', tab: 'registra', param: 'reso' },
      { icon: 'euro', label: 'Spese', tab: 'registra', param: 'spesa' },
      { icon: 'store', label: 'Negozi B2B', tab: 'negozi' },
    ],
  },
  Ginevra: {
    name: 'Ginni', finance: false,
    tiles: [
      { icon: 'plus', label: 'Nuovo ordine fornitore', tab: 'ordini', param: 'new' },
      { icon: 'inbox', label: 'Registra arrivi', tab: 'ordini' },
      { icon: 'swatch', label: 'Materie prime', tab: 'materiali' },
      { icon: 'count', label: 'Registra conta', tab: 'registra', param: 'count' },
      { icon: 'globe', label: 'Villaggio', tab: 'villaggio' },
    ],
  },
};

// Union di TUTTE le azioni raggiungibili dall'app (per la sezione "Tutte le azioni" in Home).
// Il Cruscotto compare solo per le persona con finance=true.
export const ALL_ACTIONS: Tile[] = [
  { icon: 'chart', label: 'Cruscotto finanze', tab: 'cruscotto' },
  { icon: 'euro', label: 'CE dettagliato', tab: 'ce' },
  { icon: 'tag', label: 'Margini', tab: 'margini' },
  { icon: 'handshake', label: 'Clienti', tab: 'clienti' },
  { icon: 'pulse', label: 'Salute & Movimenti', tab: 'salute' },
  { icon: 'gift', label: 'Premia (programma fedeltà)', tab: 'premia' },
  // Comportamento (modulo beh_*, 25-10): la Home la mostra solo a flag beh_enabled acceso
  { icon: 'search', label: 'Comportamento (da dove arrivano gli ordini)', tab: 'comportamento' },
  { icon: 'bag', label: 'Registra vendita', tab: 'registra', param: 'gift' },
  { icon: 'return', label: 'Reso / Cambio', tab: 'registra', param: 'reso' },
  { icon: 'count', label: 'Registra conta', tab: 'registra', param: 'count' },
  { icon: 'handshake', label: 'Movimento B2B', tab: 'registra', param: 'b2b' },
  { icon: 'store', label: 'Negozi B2B (ricerca e outreach)', tab: 'negozi' },
  { icon: 'tag', label: 'Nuovo prodotto', tab: 'registra', param: 'product' },
  { icon: 'search', label: 'Prodotti & prezzi', tab: 'registra', param: 'catalogo' },
  { icon: 'euro', label: 'Spese', tab: 'registra', param: 'spesa' },
  { icon: 'sparkles', label: 'Pulizia dati', tab: 'registra', param: 'pulizia', badge: 'todo' },
  { icon: 'rocket', label: 'Pubblica su Shopify', tab: 'registra', param: 'pubblica' },
  { icon: 'table', label: 'Tabelle (dati grezzi)', tab: 'registra', param: 'tabelle' },
  { icon: 'plus', label: 'Nuovo ordine fornitore', tab: 'ordini', param: 'new' },
  { icon: 'inbox', label: 'Ordini e arrivi', tab: 'ordini', badge: 'arrivi' },
  // Materie prime (modulo mat_*, 22-09): la Home la mostra solo a flag mat_enabled acceso
  { icon: 'swatch', label: 'Materie prime (catalogo fornitori)', tab: 'materiali' },
  // Magazzino e Disponibilita' tolti dai quick-link (feedback 06-07 item 12): gia' in bottom-nav.
  { icon: 'recycle', label: 'Cosa riprodurre', tab: 'magazzino', param: 'riordino' },
  // Villaggio (16-10): ordini e magazzino come isola 3D; legge le stesse viste e scrive con i moduli di Ordini
  { icon: 'globe', label: 'Villaggio (ordini e magazzino in 3D)', tab: 'villaggio' },
];

export const personaName = (chi: string) => PERSONA[chi]?.name ?? chi;

export function PersonaPicker({ chi, setChi }: { chi: string; setChi: (c: string) => void }) {
  return (
    <div className="seg wrap">
      {PEOPLE.map((c) => (
        <button key={c} className={chi === c ? 'on' : ''} onClick={() => setChi(c)} type="button">{PERSONA[c].name}</button>
      ))}
    </div>
  );
}
