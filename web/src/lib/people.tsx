// Centralized people + persona-driven navigation. Dan removed (= Ale, same person).
// The Home surfaces only the tiles relevant to each persona; Registra shows the same actions for everyone.

export type Tab = 'home' | 'registra' | 'ordini' | 'magazzino' | 'cruscotto';
export type Tile = { icon: string; label: string; tab: Tab; param?: string; badge?: 'arrivi' | 'todo' };

export const PEOPLE = ['Ale', 'Bene', 'Ginevra'] as const;

export const PERSONA: Record<string, { name: string; finance: boolean; tiles: Tile[] }> = {
  Ale: {
    name: 'Ale', finance: true,
    tiles: [
      { icon: 'chart', label: 'Cruscotto finanze', tab: 'cruscotto' },
      { icon: 'bag', label: 'Registra vendita', tab: 'registra', param: 'gift' },
      { icon: 'recycle', label: 'Cosa riprodurre', tab: 'magazzino', param: 'riordino' },
      { icon: 'sparkles', label: 'Pulizia dati', tab: 'registra', param: 'pulizia', badge: 'todo' },
      { icon: 'box', label: 'Ordini in arrivo', tab: 'ordini', badge: 'arrivi' },
    ],
  },
  Bene: {
    name: 'Benedetta', finance: false,
    tiles: [
      { icon: 'sparkles', label: 'Pulizia dati', tab: 'registra', param: 'pulizia', badge: 'todo' },
      { icon: 'rocket', label: 'Pubblica su Shopify', tab: 'registra', param: 'pubblica' },
      { icon: 'count', label: 'Registra conta', tab: 'registra', param: 'count' },
      { icon: 'box', label: 'Ordini in arrivo', tab: 'ordini', badge: 'arrivi' },
    ],
  },
  Ginevra: {
    name: 'Ginevra', finance: false,
    tiles: [
      { icon: 'plus', label: 'Nuovo ordine fornitore', tab: 'ordini', param: 'new' },
      { icon: 'inbox', label: 'Registra arrivi', tab: 'ordini' },
      { icon: 'count', label: 'Registra conta', tab: 'registra', param: 'count' },
    ],
  },
};

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
