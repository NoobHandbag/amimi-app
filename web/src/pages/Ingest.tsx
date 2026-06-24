import { useState } from 'react';
import CountForm from '../components/CountForm';

const TIPI = [
  { k: 'count', icon: '🔢', label: 'Conta fisica', desc: 'Conta i pezzi reali a scaffale' },
  { k: 'purchase', icon: '📦', label: 'Arrivo / Acquisto', desc: 'Registra merce in arrivo' },
  { k: 'gift', icon: '🎁', label: 'Regalo / Rettifica', desc: 'Pezzo regalato o rettifica' },
  { k: 'b2b', icon: '🏬', label: 'Movimento B2B', desc: 'Conto vendita / wholesale' },
  { k: 'product', icon: '🏷️', label: 'Nuovo prodotto', desc: 'Anagrafica nuovo articolo' },
];

export default function Ingest({ pin, setPin, chi, setChi }: {
  pin: string; setPin: (p: string) => void; chi: string; setChi: (c: string) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const cur = TIPI.find((t) => t.k === sel);

  return (
    <div className="screen">
      <header>
        <h1>Inserisci</h1>
        <div className="operbar">
          <div className="seg">
            {['Ale', 'Bene'].map((c) => (
              <button key={c} className={chi === c ? 'on' : ''} onClick={() => setChi(c)}>{c}</button>
            ))}
          </div>
          <input className="pinmini" type="password" inputMode="numeric" placeholder="PIN"
            value={pin} onChange={(e) => setPin(e.target.value)} />
        </div>
      </header>

      {!sel ? (
        <div className="tipi">
          {TIPI.map((t) => (
            <button key={t.k} className="tipo" onClick={() => setSel(t.k)} type="button">
              <span className="ti">{t.icon}</span>
              <span className="tt">{t.label}</span>
              <span className="td">{t.desc}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <button className="back" onClick={() => setSel(null)} type="button">← {cur?.label}</button>
          {!pin && <div className="msg err">Inserisci il PIN in alto per salvare.</div>}
          {sel === 'count' ? (
            <CountForm pin={pin} chi={chi} />
          ) : (
            <div className="card muted center">Il modulo “{cur?.label}” arriva nel prossimo aggiornamento di stanotte.</div>
          )}
        </>
      )}
    </div>
  );
}
