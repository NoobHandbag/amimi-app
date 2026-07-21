// Centralized people + persona-driven navigation. Dan removed (= Ale, same person).
// The Home surfaces only the tiles relevant to each persona; Registra shows the same actions for everyone.

export type Tab = 'home' | 'registra' | 'ordini' | 'magazzino' | 'cruscotto' | 'salute' | 'assistenza';
export type Tile = { icon: string; label: string; tab: Tab; param?: string; badge?: 'arrivi' | 'todo' };

export const PEOPLE = ['Ale', 'Bene', 'Ginevra'] as const;

export const PERSONA: Record<string, { name: string; finance: boolean; tiles: Tile[] }> = {
  Ale: {
    name: 'Ale', finance: true,
    tiles: [
      { icon: 'chart', label: 'Cruscotto finanze', tab: 'cruscotto' },
      { icon: 'pulse', label: 'Salute & Movimenti', tab: 'salute' },
      { icon: 'bag', label: 'Registra vendita', tab: 'registra', param: 'gift' },
      { icon: 'recycle', label: 'Cosa riprodurre', tab: 'magazzino', param: 'riordino' },
      { icon: 'sparkles', label: 'Pulizia dati', tab: 'registra', param: 'pulizia', badge: 'todo' },
      { icon: 'box', label: 'Ordini in arrivo', tab: 'ordini', badge: 'arrivi' },
    ],
  },
  Bene: {
    name: 'Benny', finance: false,
    tiles: [
      { icon: 'chat', label: 'Assistenza clienti', tab: 'assistenza' },
      { icon: 'sparkles', label: 'Pulizia dati', tab: 'registra', param: 'pulizia', badge: 'todo' },
      { icon: 'bag', label: 'Registra vendita', tab: 'registra', param: 'gift' },
      { icon: 'return', label: 'Reso / Cambio', tab: 'registra', param: 'reso' },
      { icon: 'euro', label: 'Spese', tab: 'registra', param: 'spesa' },
    ],
  },
  Ginevra: {
    name: 'Ginni', finance: false,
    tiles: [
      { icon: 'chat', label: 'Assistenza clienti', tab: 'assistenza' },
      { icon: 'plus', label: 'Nuovo ordine fornitore', tab: 'ordini', param: 'new' },
      { icon: 'inbox', label: 'Registra arrivi', tab: 'ordini' },
      { icon: 'count', label: 'Registra conta', tab: 'registra', param: 'count' },
    ],
  },
};

// Union di TUTTE le azioni raggiungibili dall'app (per la sezione "Tutte le azioni" in Home).
// Il Cruscotto compare solo per le persona con finance=true.
export const ALL_ACTIONS: Tile[] = [
  { icon: 'chart', label: 'Cruscotto finanze', tab: 'cruscotto' },
  { icon: 'pulse', label: 'Salute & Movimenti', tab: 'salute' },
  { icon: 'chat', label: 'Assistenza clienti', tab: 'assistenza' },
  { icon: 'bag', label: 'Registra vendita', tab: 'registra', param: 'gift' },
  { icon: 'return', label: 'Reso / Cambio', tab: 'registra', param: 'reso' },
  { icon: 'count', label: 'Registra conta', tab: 'registra', param: 'count' },
  { icon: 'handshake', label: 'Movimento B2B', tab: 'registra', param: 'b2b' },
  { icon: 'tag', label: 'Nuovo prodotto', tab: 'registra', param: 'product' },
  { icon: 'search', label: 'Prodotti & prezzi', tab: 'registra', param: 'catalogo' },
  { icon: 'euro', label: 'Spese', tab: 'registra', param: 'spesa' },
  { icon: 'sparkles', label: 'Pulizia dati', tab: 'registra', param: 'pulizia', badge: 'todo' },
  { icon: 'rocket', label: 'Pubblica su Shopify', tab: 'registra', param: 'pubblica' },
  { icon: 'table', label: 'Tabelle (dati grezzi)', tab: 'registra', param: 'tabelle' },
  { icon: 'plus', label: 'Nuovo ordine fornitore', tab: 'ordini', param: 'new' },
  { icon: 'inbox', label: 'Ordini e arrivi', tab: 'ordini', badge: 'arrivi' },
  // Magazzino e Disponibilita' tolti dai quick-link (feedback 06-07 item 12): gia' in bottom-nav.
  { icon: 'recycle', label: 'Cosa riprodurre', tab: 'magazzino', param: 'riordino' },
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
