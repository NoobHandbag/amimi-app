import { useState } from 'react';
import Report from './pages/Report';
import Ingest from './pages/Ingest';

export default function App() {
  const [tab, setTab] = useState<'report' | 'ingest'>('report');
  const [pin, setPinS] = useState(() => localStorage.getItem('amimi_pin') || '');
  const [chi, setChiS] = useState(() => localStorage.getItem('amimi_chi') || 'Ale');
  const setPin = (p: string) => { setPinS(p); localStorage.setItem('amimi_pin', p); };
  const setChi = (c: string) => { setChiS(c); localStorage.setItem('amimi_chi', c); };

  return (
    <div className="app">
      <main>
        {tab === 'report' ? <Report /> : <Ingest pin={pin} setPin={setPin} chi={chi} setChi={setChi} />}
      </main>
      <nav className="bottomnav">
        <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')} type="button"><span>📊</span>Cruscotto</button>
        <button className={tab === 'ingest' ? 'on' : ''} onClick={() => setTab('ingest')} type="button"><span>➕</span>Inserisci</button>
      </nav>
    </div>
  );
}
