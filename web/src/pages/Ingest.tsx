import { useState } from 'react';
import CountForm from '../components/CountForm';
import PurchaseForm from '../components/PurchaseForm';
import NewProductForm from '../components/NewProductForm';
import GiftForm from '../components/GiftForm';
import B2BForm from '../components/B2BForm';
import ReturnForm from '../components/ReturnForm';
import SpeseManage from '../components/SpeseManage';
import RecentFeed from '../components/RecentFeed';
import { PERSONA, PersonaPicker } from '../lib/people';

const TIPI = [
  { k: 'count', icon: '🔢', label: 'Conta fisica', desc: 'Conta i pezzi reali a scaffale' },
  { k: 'purchase', icon: '📦', label: 'Arrivo / Acquisto', desc: 'Registra merce in arrivo' },
  { k: 'reso', icon: '↩️', label: 'Reso / Cambio', desc: 'Parti dalla vendita, poi correggi/rimborsa' },
  { k: 'gift', icon: '🎁', label: 'Regalo / Vendita manuale', desc: 'Regalo, oppure vendita offline fuori Qromo' },
  { k: 'b2b', icon: '🏬', label: 'Movimento B2B', desc: 'Conto vendita / wholesale' },
  { k: 'product', icon: '🏷️', label: 'Nuovo prodotto', desc: 'Anagrafica nuovo articolo' },
  { k: 'spesa', icon: '💶', label: 'Spese', desc: 'Proponi e approva spese' },
];

export default function Ingest({ pin, chi, setChi, initial }: {
  pin: string; chi: string; setChi: (c: string) => void; initial?: string;
}) {
  const [sel, setSel] = useState<string | null>(initial ?? null);
  const allowed = PERSONA[chi]?.registra ?? TIPI.map((t) => t.k);
  const tipi = TIPI.filter((t) => allowed.includes(t.k));
  const cur = TIPI.find((t) => t.k === sel);

  return (
    <div className="screen">
      <header>
        <h1>Registra</h1>
        <PersonaPicker chi={chi} setChi={setChi} />
      </header>

      {!sel ? (
        <>
          <div className="tipi">
            {tipi.map((t) => (
              <button key={t.k} className="tipo" onClick={() => setSel(t.k)} type="button">
                <span className="ti">{t.icon}</span>
                <span className="tt">{t.label}</span>
                <span className="td">{t.desc}</span>
              </button>
            ))}
          </div>
          <RecentFeed />
        </>
      ) : (
        <>
          <button className="back" onClick={() => setSel(null)} type="button">← {cur?.label}</button>
          {sel === 'count' && <CountForm pin={pin} chi={chi} />}
          {sel === 'purchase' && <PurchaseForm pin={pin} chi={chi} />}
          {sel === 'product' && <NewProductForm pin={pin} chi={chi} />}
          {sel === 'gift' && <GiftForm pin={pin} chi={chi} />}
          {sel === 'b2b' && <B2BForm pin={pin} chi={chi} />}
          {sel === 'reso' && <ReturnForm pin={pin} chi={chi} />}
          {sel === 'spesa' && <SpeseManage pin={pin} chi={chi} />}
        </>
      )}
    </div>
  );
}
