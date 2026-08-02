import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

// --- Identita' della versione (brief cs_crop_residui_e_versione, parte 2) ---
// Le operatrici tengono la PWA aperta per ore ed e' successo davvero: durante un collaudo la scheda
// girava su un bundle vecchio e stava per essere consegnato all'owner un "bug critico non risolto"
// che era solo cache. Servono DUE cose diverse, e vanno tenute diverse:
//   - `build`: un intero crescente. E' cio' su cui si CONFRONTA, e si avvisa solo se il pubblicato e'
//     PIU' NUOVO del proprio. Un confronto per disuguaglianza avviserebbe anche chi e' gia' avanti
//     (la CDN puo' servire per qualche minuto un version.json piu' vecchio del bundle appena preso).
//   - `label`: la stringa leggibile da mostrare a video, per poter chiedere "che versione vedi?".
const BUILD = Date.now()
const COMMIT = (() => {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() }
  catch { return 'sconosciuto' }
})()
const LABEL = `${new Date(BUILD).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${COMMIT}`

// Scrive dist/version.json a build finita. `entry` e' il nome del chunk di ingresso, che porta
// l'hash del CONTENUTO: cambia se e solo se il bundle cambia davvero, quindi una ricostruzione
// identica non fa comparire l'avviso a nessuno.
const versionePlugin = () => ({
  name: 'amimi-versione',
  writeBundle(options: { dir?: string }, bundle: Record<string, { type: string; isEntry?: boolean; fileName: string }>) {
    const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry)
    const dir = options.dir
    if (!dir) return
    writeFileSync(join(dir, 'version.json'), JSON.stringify({ build: BUILD, label: LABEL, entry: entry?.fileName ?? null }))
  },
})

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
  return {
    base: '/amimi-app/',
    plugins: [react(), versionePlugin()],
    define: {
      __AMIMI_BUILD__: JSON.stringify(BUILD),
      __AMIMI_LABEL__: JSON.stringify(LABEL),
    },
  }
})
