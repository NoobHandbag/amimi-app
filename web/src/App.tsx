import { useState } from 'react';
import Report from './pages/Report';
import Ingest from './pages/Ingest';
import Inventory from './pages/Inventory';

export default function App() {
  const [tab, setTab] = useState<'report' | 'ingest' | 'inv'>('report');
  const [pin, setPinS] = useState(() => localStorage.getItem('amimi_pin') || '');
  const [chi, setChiS] = useState(() => localStorage.getItem('amimi_chi') || 'Ale');
  const setPin = (p: string) => { setPinS(p); localStorage.setItem('amimi_pin', p); };
  const setChi = (c: string) => { setChiS(c); localStorage.setItem('amimi_chi', c); };

  return (
    <div className="app">
      <main>
        {tab === 'report' && <Report />}
        {tab === 'ingest' && <Ingest pin={pin} setPin={setPin} chi={chi} setChi={setChi} />}
        {tab === 'inv' && <Inventory />}
      </main>
      <nav className="bottomnav">
        <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')} type="button"><span>📊</span>Cruscotto</button>
        <button className={tab === 'ingest' ? 'on' : ''} onClick={() => setTab('ingest')} type="button"><span>➕</span>Inserisci</button>
        <button className={tab === 'inv' ? 'on' : ''} onClick={() => setTab('inv')} type="button"><span>📦</span>Inventario</button>
      </nav>
    </div>
  );
}
