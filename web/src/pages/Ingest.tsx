import { useState } from 'react';
import CountForm from '../components/CountForm';
import PurchaseForm from '../components/PurchaseForm';
import NewProductForm from '../components/NewProductForm';
import GiftForm from '../components/GiftForm';
import B2BForm from '../components/B2BForm';
import ExpenseForm from '../components/ExpenseForm';
import ReturnForm from '../components/ReturnForm';
import RecentFeed from '../components/RecentFeed';

const TIPI = [
  { k: 'count', icon: '🔢', label: 'Conta fisica', desc: 'Conta i pezzi reali a scaffale' },
  { k: 'purchase', icon: '📦', label: 'Arrivo / Acquisto', desc: 'Registra merce in arrivo' },
  { k: 'reso', icon: '↩️', label: 'Reso / Cambio', desc: 'Reso cliente, rientro stock e rimborso' },
  { k: 'gift', icon: '🎁', label: 'Regalo / Rettifica', desc: 'Pezzo regalato o rettifica' },
  { k: 'b2b', icon: '🏬', label: 'Movimento B2B', desc: 'Conto vendita / wholesale' },
  { k: 'product', icon: '🏷️', label: 'Nuovo prodotto', desc: 'Anagrafica nuovo articolo' },
  { k: 'spesa', icon: '💶', label: 'Spesa', desc: 'Proponi una spesa da approvare' },
];

export default function Ingest({ pin, chi, setChi }: {
  pin: string; chi: string; setChi: (c: string) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const cur = TIPI.find((t) => t.k === sel);

  return (
    <div className="screen">
      <header>
        <h1>Inserisci</h1>
        <div className="seg wrap">
          {['Ale', 'Bene', 'Ginevra', 'Dan'].map((c) => (
            <button key={c} className={chi === c ? 'on' : ''} onClick={() => setChi(c)}>{c}</button>
          ))}
        </div>
      </header>

      {!sel ? (
        <>
          <div className="tipi">
            {TIPI.map((t) => (
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
          {sel === 'spesa' && <ExpenseForm pin={pin} chi={chi} mode="expense_propose" />}
        </>
      )}
    </div>
  );
}
