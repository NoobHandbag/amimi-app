import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import './index.css'
import './styles/components.css'
import VillaggioApp from './VillaggioApp.tsx'
import UpdateBanner from './components/UpdateBanner.tsx'

// ingresso dell'app a se' del Villaggio (villaggio/index.html): la logica e' in VillaggioApp.tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VillaggioApp />
    <UpdateBanner />
  </StrictMode>,
)
