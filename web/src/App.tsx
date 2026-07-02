import { useState } from 'react';
import type { Tab } from './lib/people';
import Home from './pages/Home';
import Report from './pages/Report';
import Ingest from './pages/Ingest';
import Ordini from './pages/Ordini';
import Inventory from './pages/Inventory';
import Icon from './components/Icon';
import { pushBack } from './lib/backnav';

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [param, setParam] = useState<string | undefined>();
  const [chi, setChiS] = useState(() => localStorage.getItem('amimi_chi') || 'Ale');
  const setChi = (c: string) => { setChiS(c); localStorage.setItem('amimi_chi', c); };
  const go = (t: Tab, p?: string) => {
    // swipe-back Android: ogni cambio tab spinge una entry di history che riporta al tab precedente
    if (t !== tab) { const prev = tab; pushBack(() => { setParam(undefined); setTab(prev); }); }
    setParam(p); setTab(t);
  };
  const pin = 'x'; // PIN removed per design; writes go through the service-role write-api.

  const navBtn = (t: Tab, icon: string, label: string) => (
    <button className={tab === t || (t === 'home' && tab === 'cruscotto') ? 'on' : ''} onClick={() => go(t)} type="button"><span><Icon name={icon} size={22} /></span>{label}</button>
  );

  return (
    <div className="app">
      <main>
        {tab === 'home' && <Home chi={chi} setChi={setChi} go={go} />}
        {tab === 'cruscotto' && <Report onBack={() => go('home')} />}
        {tab === 'registra' && <Ingest pin={pin} chi={chi} initial={param} />}
        {tab === 'ordini' && <Ordini pin={pin} chi={chi} initial={param} />}
        {tab === 'magazzino' && <Inventory pin={pin} chi={chi} initial={param} go={go} />}
      </main>
      <nav className="bottomnav">
        {navBtn('home', 'home', 'Home')}
        {navBtn('registra', 'plus', 'Registra')}
        {navBtn('ordini', 'box', 'Ordini')}
        {navBtn('magazzino', 'chart', 'Magazzino')}
      </nav>
    </div>
  );
}
