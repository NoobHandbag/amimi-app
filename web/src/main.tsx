import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
// Fraunces variable self-hosted, sotto-famiglia a solo asse wght: SOFT e WONK
// restano a 0 per costruzione (DESIGN.md §3.1). font-display: swap e' nel pacchetto.
import '@fontsource-variable/fraunces/wght.css'
import './index.css'
import './styles/components.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
