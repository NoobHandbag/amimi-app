import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Guardia env in build (brief frontend_rete_di_sicurezza, parte 1; raccomandata il 26-07 e mai
// applicata). `web/.env.local` e' gitignored, quindi in un clone fresco, in una worktree isolata o
// su un runner NON esiste. `csClient.ts` chiama createClient(url, key) a livello di MODULO: senza
// url lancia in valutazione, React non monta, #root resta vuoto e TUTTE le schermate sono bianche,
// non solo quella che si stava guardando. Prima di oggi la build usciva 0 lo stesso e pubblicava
// un bundle morto: e' successo davvero la sera del 26-07. Qui la build si ferma e dice cosa manca.
// Vale solo per `build`: in `dev` l'errore si vede subito in console e bloccare sarebbe d'intralcio.
const RICHIESTE = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const mancanti = RICHIESTE.filter((k) => !String(env[k] ?? process.env[k] ?? '').trim())
    if (mancanti.length) {
      throw new Error(
        `\n\nBUILD FERMATA: manca ${mancanti.join(' e ')} in web/.env.local.\n` +
        `Il file e' gitignored (non arriva col clone): copialo dalla macchina dell'owner o ricrealo con\n` +
        `  VITE_SUPABASE_URL=https://<project-ref>.supabase.co\n` +
        `  VITE_SUPABASE_ANON_KEY=<anon key>\n` +
        `Senza, il bundle esce vivo ma l'app e' bianca su TUTTE le schermate.\n`,
      )
    }
  }
  return { base: '/amimi-app/', plugins: [react()] }
})
