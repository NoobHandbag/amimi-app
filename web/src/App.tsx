import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { Tab } from './lib/people';
import { fetchMatEnabled } from './lib/matApi';
import Materiali from './pages/Materiali';
import Home from './pages/Home';
import Report from './pages/Report';
import CeDetail from './pages/CeDetail';
import Margini from './pages/Margini';
import Clienti from './pages/Clienti';
import Salute from './pages/Salute';
import Assistenza from './pages/Assistenza';
import Ingest from './pages/Ingest';
import Ordini from './pages/Ordini';
import Inventory from './pages/Inventory';
import Negozi from './pages/Negozi';
import Ads from './pages/Ads';
import Premia from './pages/Premia';
import Icon from './components/Icon';
import AssistantPanel from './components/AssistantPanel';
import UpdateBanner from './components/UpdateBanner';
import { pushBack } from './lib/backnav';
import { fetchLeadTodo } from './lib/leadApi';
import { fetchVillaggioEnabled } from './lib/api';
import ErrorBoundary from './components/ErrorBoundary';
// three.js pesa: il Villaggio si scarica solo quando lo si apre
const Villaggio = lazy(() => import('./pages/Villaggio'));

export default function App() {
  // URL diretto: .../amimi-app/#negozi apre la sezione B2B (richiesta owner 10-09); #ads la reportistica Meta (18-09);
  // #materiali il catalogo materie prime (22-09); #premia la dashboard del programma fedeltà (27-09)
  const [tab, setTab] = useState<Tab>(() => (window.location.hash.startsWith('#negozi') ? 'negozi' : window.location.hash.startsWith('#ads') ? 'ads' : window.location.hash.startsWith('#materiali') ? 'materiali' : window.location.hash.startsWith('#premia') ? 'premia' : window.location.hash.startsWith('#villaggio') ? 'villaggio' : 'home'));
  const [param, setParam] = useState<string | undefined>();
  // Modulo mat_* (materie prime): a flag spento la tile in Home non compare, Ordini non mostra il segmented e la
  // pagina dice "non attiva". Rollback = spegnere app_flags.mat_enabled (Regola Ferrea 19). Letto una volta all'avvio.
  const [matEnabled, setMatEnabled] = useState(false);
  useEffect(() => { fetchMatEnabled().then(setMatEnabled).catch(() => setMatEnabled(false)); }, []);
  // Villaggio (16-10): stesso schema, flag villaggio_enabled (migr 0162). null = non ancora letto, cosi' #villaggio
  // aperto da link non mostra 'non attiva' per un attimo.
  const [vilEnabled, setVilEnabled] = useState<boolean | null>(null);
  useEffect(() => { fetchVillaggioEnabled().then(setVilEnabled).catch(() => setVilEnabled(false)); }, []);
  // badge del bottone B2B nella barra: "da fare" dell'outreach (0 senza login). 3 richieste, di cui v_lead_inbound la piu'
  // cara (CASI_APERTI n.38 a): si legge al mount, ogni 5 minuti a scheda visibile, al ritorno in primo piano e quando si
  // ESCE da Negozi o da Assistenza (scrivono: una scrittura, il login o la categoria di una conversazione cambiano il
  // da-fare); NON a ogni cambio di tab. Unica eccezione: senza login (zero richieste) o dopo una lettura fallita si
  // riprova al cambio di tab successivo, come prima. Conta solo l'esito dell'ultima lettura partita.
  const [leadTodo, setLeadTodo] = useState(0);
  const daRiprovare = useRef(false);
  const ultimaLettura = useRef(0);
  const leggiBadge = useCallback(() => {
    const mia = ++ultimaLettura.current;
    fetchLeadTodo()
      .then(({ n, riprova }) => { if (mia === ultimaLettura.current) { daRiprovare.current = riprova; setLeadTodo(n); } })
      .catch(() => { if (mia === ultimaLettura.current) { daRiprovare.current = true; setLeadTodo(0); } });
  }, []);
  useEffect(() => {
    const seVisibile = () => { if (!document.hidden) leggiBadge(); };
    leggiBadge();
    const id = window.setInterval(seVisibile, 5 * 60000);
    document.addEventListener('visibilitychange', seVisibile);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', seVisibile); };
  }, [leggiBadge]);
  const tabPrec = useRef(tab);
  useEffect(() => {
    if (daRiprovare.current || (tab !== tabPrec.current && (tabPrec.current === 'negozi' || tabPrec.current === 'assistenza'))) leggiBadge();
    tabPrec.current = tab;
  }, [tab, leggiBadge]);
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
        {tab === 'home' && <Home chi={chi} setChi={setChi} go={go} matEnabled={matEnabled} vilEnabled={vilEnabled === true} />}
        {tab === 'materiali' && (matEnabled
          ? <Materiali chi={chi} onBack={() => go('home')} onProdotti={() => go('ordini')} />
          : <div className="screen"><header><h1>Materie prime</h1><button className="badge" onClick={() => go('home')} type="button">‹ Home</button></header><div className="card muted center">Sezione non attiva (flag mat_enabled spento).</div></div>)}
        {tab === 'cruscotto' && <Report onBack={() => go('home')} onDetail={() => go('ce')} onAds={() => go('ads')} onVillaggio={vilEnabled ? () => go('villaggio') : undefined} />}
        {tab === 'ads' && <Ads onBack={() => go('home')} pin={pin} chi={chi} />}
        {tab === 'ce' && <CeDetail onBack={() => go('home')} />}
        {tab === 'margini' && <Margini onBack={() => go('home')} />}
        {tab === 'clienti' && <Clienti onBack={() => go('home')} />}
        {tab === 'salute' && <Salute onBack={() => go('home')} chi={chi} go={go} pin={pin} />}
        {tab === 'assistenza' && <Assistenza onBack={() => go('home')} />}
        {tab === 'premia' && <Premia onBack={() => go('home')} />}
        {tab === 'negozi' && <Negozi onBack={() => go('home')} chi={chi} setChi={setChi} />}
        {tab === 'registra' && <Ingest pin={pin} chi={chi} initial={param} />}
        {tab === 'ordini' && <Ordini pin={pin} chi={chi} initial={param} onMateriali={matEnabled ? () => go('materiali') : undefined} />}
        {tab === 'magazzino' && <Inventory pin={pin} chi={chi} initial={param} go={go} />}
        {tab === 'villaggio' && (vilEnabled
          ? <ErrorBoundary titolo="Villaggio" onBack={() => go('home')}><Suspense fallback={<div className="screen"><div className="card muted center">Carico il villaggio…</div></div>}><Villaggio pin={pin} chi={chi} setChi={setChi} onBack={() => go('home')} /></Suspense></ErrorBoundary>
          : <div className="screen"><header><h1>Villaggio</h1><button className="badge" onClick={() => go('home')} type="button">‹ Home</button></header><div className="card muted center">{vilEnabled === null ? 'Carico…' : 'Sezione non attiva (flag villaggio_enabled spento).'}</div></div>)}
      </main>
      {/* nav ridotta (decisione call 06-07, item 13+28): Registra e Ordini vivono nella Home
          ("la home page fa tutto"); al loro posto l'accesso diretto alle Tabelle (dati grezzi). */}
      <nav className="bottomnav">
        {navBtn('home', 'home', 'Home')}
        <button className={tab === 'registra' && (param ?? '').startsWith('tabelle') ? 'on' : ''} onClick={() => go('registra', 'tabelle')} type="button"><span><Icon name="table" size={22} /></span>Tabelle</button>
        {navBtn('magazzino', 'chart', 'Magazzino')}
        {navBtn('assistenza', 'chat', 'Assistenza')}
        <button className={tab === 'negozi' ? 'on' : ''} onClick={() => go('negozi')} type="button" aria-label={leadTodo ? `B2B, ${leadTodo} da fare` : 'B2B'}><span className="navico"><Icon name="store" size={22} />{leadTodo > 0 && <i className="navbdg">{leadTodo > 99 ? '99+' : leadTodo}</i>}</span>B2B</button>
      </nav>
      {/* "Chiedi ad Amimì": overlay presente su ogni schermata, si auto-nasconde se ai_enabled = false */}
      <AssistantPanel pin={pin} chi={chi} nascondiFab={tab === 'assistenza' || tab === 'villaggio'} />
      {/* avvisa quando e' stata pubblicata una versione nuova: la PWA resta aperta per ore e
          altrimenti si continua a lavorare su un bundle vecchio senza nessun segnale */}
      <UpdateBanner />
    </div>
  );
}
