// Centralized people + persona-driven navigation. Dan removed (= Ale, same person).
// The Home surfaces only the tiles relevant to each persona; Registra filters its actions too.

export type Tab = 'home' | 'registra' | 'ordini' | 'prodotti' | 'magazzino' | 'cruscotto';
export type Tile = { icon: string; label: string; tab: Tab; param?: string; badge?: 'arrivi' | 'todo' };

export const PEOPLE = ['Ale', 'Bene', 'Ginevra'] as const;

export const PERSONA: Record<string, { name: string; finance: boolean; registra: string[]; tiles: Tile[] }> = {
  Ale: {
    name: 'Ale', finance: true,
    registra: ['gift', 'reso', 'count', 'purchase', 'b2b', 'product', 'spesa'],
    tiles: [
      { icon: '📊', label: 'Cruscotto finanze', tab: 'cruscotto' },
      { icon: '🛍️', label: 'Registra vendita', tab: 'registra', param: 'gift' },
      { icon: '🔁', label: 'Cosa riprodurre', tab: 'magazzino', param: 'riordino' },
      { icon: '🏷️', label: 'Prodotti da finire', tab: 'prodotti', param: 'prod', badge: 'todo' },
      { icon: '📦', label: 'Ordini in arrivo', tab: 'ordini', badge: 'arrivi' },
      { icon: '🩺', label: 'Diagnostica', tab: 'prodotti', param: 'diag' },
    ],
  },
  Bene: {
    name: 'Benedetta', finance: false,
    registra: ['count', 'product', 'reso'],
    tiles: [
      { icon: '🏷️', label: 'Prodotti da finire', tab: 'prodotti', param: 'prod', badge: 'todo' },
      { icon: '🚀', label: 'Pubblica su Shopify', tab: 'prodotti', param: 'pubblica' },
      { icon: '🔢', label: 'Registra conta', tab: 'registra', param: 'count' },
      { icon: '📦', label: 'Ordini in arrivo', tab: 'ordini', badge: 'arrivi' },
    ],
  },
  Ginevra: {
    name: 'Ginevra', finance: false,
    registra: ['purchase', 'count'],
    tiles: [
      { icon: '➕', label: 'Nuovo ordine fornitore', tab: 'ordini', param: 'new' },
      { icon: '📦', label: 'Registra arrivi', tab: 'ordini' },
      { icon: '🔢', label: 'Registra conta', tab: 'registra', param: 'count' },
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
