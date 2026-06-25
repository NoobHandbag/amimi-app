import { useState } from 'react';
import Report from './pages/Report';
import Ingest from './pages/Ingest';
import Arrivi from './pages/Arrivi';
import Inventory from './pages/Inventory';

export default function App() {
  const [tab, setTab] = useState<'report' | 'ingest' | 'arrivi' | 'inv'>('report');
  const [chi, setChiS] = useState(() => localStorage.getItem('amimi_chi') || 'Ale');
  const setChi = (c: string) => { setChiS(c); localStorage.setItem('amimi_chi', c); };
  const pin = 'x'; // PIN removed per design; writes are open (relaxed posture, test replica)

  return (
    <div className="app">
      <main>
        {tab === 'report' && <Report />}
        {tab === 'ingest' && <Ingest pin={pin} chi={chi} setChi={setChi} />}
        {tab === 'arrivi' && <Arrivi pin={pin} chi={chi} setChi={setChi} />}
        {tab === 'inv' && <Inventory />}
      </main>
      <nav className="bottomnav">
        <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')} type="button"><span>📊</span>Cruscotto</button>
        <button className={tab === 'ingest' ? 'on' : ''} onClick={() => setTab('ingest')} type="button"><span>➕</span>Inserisci</button>
        <button className={tab === 'arrivi' ? 'on' : ''} onClick={() => setTab('arrivi')} type="button"><span>📦</span>In arrivo</button>
        <button className={tab === 'inv' ? 'on' : ''} onClick={() => setTab('inv')} type="button"><span>🏠</span>Inventario</button>
      </nav>
    </div>
  );
}
