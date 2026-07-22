import { useState } from 'react';
import type { Tab } from './lib/people';
import Home from './pages/Home';
import Report from './pages/Report';
import Salute from './pages/Salute';
import Assistenza from './pages/Assistenza';
import Ingest from './pages/Ingest';
import Ordini from './pages/Ordini';
import Inventory from './pages/Inventory';
import Icon from './components/Icon';
import AssistantPanel from './components/AssistantPanel';
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
        {tab === 'salute' && <Salute onBack={() => go('home')} chi={chi} />}
        {tab === 'assistenza' && <Assistenza onBack={() => go('home')} />}
        {tab === 'registra' && <Ingest pin={pin} chi={chi} initial={param} />}
        {tab === 'ordini' && <Ordini pin={pin} chi={chi} initial={param} />}
        {tab === 'magazzino' && <Inventory pin={pin} chi={chi} initial={param} go={go} />}
      </main>
      {/* nav ridotta (decisione call 06-07, item 13+28): Registra e Ordini vivono nella Home
          ("la home page fa tutto"); al loro posto l'accesso diretto alle Tabelle (dati grezzi). */}
      <nav className="bottomnav">
        {navBtn('home', 'home', 'Home')}
        <button className={tab === 'registra' && (param ?? '').startsWith('tabelle') ? 'on' : ''} onClick={() => go('registra', 'tabelle')} type="button"><span><Icon name="table" size={22} /></span>Tabelle</button>
        {navBtn('magazzino', 'chart', 'Magazzino')}
        {navBtn('assistenza', 'chat', 'Assistenza')}
      </nav>
      {/* "Chiedi ad Amimì": overlay presente su ogni schermata, si auto-nasconde se ai_enabled = false */}
      <AssistantPanel pin={pin} chi={chi} />
    </div>
  );
}
