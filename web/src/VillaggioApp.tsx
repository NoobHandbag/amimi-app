import { useEffect, useState } from 'react'
import Villaggio from './pages/Villaggio.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { PEOPLE, personaName } from './lib/people.tsx'
import { VILLAGGIO_SPENTO, fetchVillaggioSettings } from './lib/api.ts'
import type { VillaggioSettings } from './lib/api.ts'

// Villaggio a se' (16-10): l'app da installare sul telefono di Ginni, /amimi-app/villaggio/ con il suo manifest.
// Stesso codice della scheda #villaggio dell'app intera: stesse letture, stesse scritture, stessi interruttori
// app_flags.villaggio_enabled e villaggio_paillettes_enabled. Chi scrive: la persona scelta su questo dispositivo
// (amimi_chi, condiviso con l'app intera nello stesso browser; su iPhone l'app installata ha uno storage suo). Senza una
// scelta salvata la si chiede alla prima apertura (fase 3, 18-10): mai una persona presa a caso, perche' gli arrivi firmati
// da un'altra non danno le Paillettes a Ginni. Si cambia dal menu "scrive" nell'HUD.
const leggiChi = () => { try { return localStorage.getItem('amimi_chi') || '' } catch { return '' } }
// Installata, l'app ha scope /amimi-app/villaggio/ (diverso dall'app intera, cosi' le due non si contendono i link, per
// esempio la push di ce-guard): la Home apre l'app intera in una finestra sua invece di caricarla qui dentro. Su iPhone
// quella finestra ha uno storage suo, dove chi partirebbe da 'Ale': ?chi= le dice chi stava usando il Villaggio (App.tsx
// lo legge una volta). Non installata, lo storage e' lo stesso e basta l'indirizzo.
const installata = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const home = (chi = '') => { if (installata()) window.open(import.meta.env.BASE_URL + (chi ? '?chi=' + encodeURIComponent(chi) : ''), '_blank', 'noopener'); else window.location.href = import.meta.env.BASE_URL }

export default function VillaggioApp() {
  // null finche' gli interruttori non arrivano; una lettura fallita vale tutto spento
  const [cfg, setCfg] = useState<VillaggioSettings | null>(null)
  const [chi, setChiS] = useState(leggiChi)
  const setChi = (c: string) => { setChiS(c); try { localStorage.setItem('amimi_chi', c) } catch { /* storage non disponibile: vale fino alla chiusura */ } }
  useEffect(() => { fetchVillaggioSettings().then(setCfg).catch(() => setCfg(VILLAGGIO_SPENTO)) }, [])
  const casa = () => home(chi)
  if (cfg && !cfg.enabled) {
    return (
      <div className="screen">
        <header><h1>Villaggio</h1></header>
        <div className="card muted center">
          <p>Il Villaggio non è attivo (flag villaggio_enabled spento). Ordini e Magazzino sono nell'app.</p>
          <button className="chip on" type="button" onClick={casa}>Apri l'app</button>
        </div>
      </div>
    )
  }
  // gli interruttori intanto si leggono: scelta la persona, il villaggio parte senza aspettare di piu'
  if (!chi) {
    return (
      <div className="screen">
        <header><h1>Villaggio</h1></header>
        <div className="card center">
          <p>Chi usa questo telefono? Arrivi, ordini e conte del Villaggio porteranno il suo nome. Si cambia quando vuoi dal menu "scrive".</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            {PEOPLE.map((p) => <button key={p} className="chip" type="button" style={{ minHeight: 44, minWidth: 96, fontSize: 16 }} onClick={() => setChi(p)}>{personaName(p)}</button>)}
          </div>
        </div>
      </div>
    )
  }
  if (cfg === null) return <div className="screen"><div className="card muted center">Carico il villaggio…</div></div>
  return <ErrorBoundary titolo="Villaggio" onBack={casa}><Villaggio pin="x" chi={chi} setChi={setChi} paillettes={cfg.paillettes} giocatrice={cfg.giocatrice} onBack={casa} /></ErrorBoundary>
}
