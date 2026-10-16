import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import './index.css'
import './styles/components.css'
import Villaggio from './pages/Villaggio.tsx'
import UpdateBanner from './components/UpdateBanner.tsx'

// Villaggio a se' (16-10): l'app da installare sul telefono di Ginni, /amimi-app/villaggio/ con il suo manifest.
// Stesso codice della scheda #villaggio dell'app intera: stesse letture, stesse scritture (moduli di Ordini).
// Chi scrive: la persona scelta nell'app intera su questo dispositivo, altrimenti Ginevra.
const chi = (() => { try { return localStorage.getItem('amimi_chi') || 'Ginevra' } catch { return 'Ginevra' } })()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Villaggio pin="x" chi={chi} onBack={() => { window.location.href = import.meta.env.BASE_URL }} />
    <UpdateBanner />
  </StrictMode>,
)
