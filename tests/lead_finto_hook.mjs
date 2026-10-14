// Preload di tests/lead_letture_errore.mjs: gli script di workers/lead/ girano con ./lib.mjs sostituita da
// tests/lead_finto_lib.mjs (client supabase finto) e playwright sostituito da tests/lead_finto_playwright.mjs (pagine
// vuote). Niente rete e niente client vero: anche lanciato nel checkout con le dipendenze installate e
// SUPABASE_ACCESS_TOKEN impostato, uno script non puo' raggiungere la produzione ne' aprire un browser.
//   node --import ./tests/lead_finto_hook.mjs workers/lead/<script>.mjs ...
import { registerHooks } from 'node:module';

const FINTA = new URL('./lead_finto_lib.mjs', import.meta.url).href;
const PLAYWRIGHT_FINTO = new URL('./lead_finto_playwright.mjs', import.meta.url).href;
// il finto riusa la lib VERA (startRun, endRun, evidence...): il suo supabase-js e' un createClient che non crea niente
const LIB_VERA = new URL('../workers/lead/lib.mjs', import.meta.url).href;
const SUPABASE_MUTO = 'data:text/javascript,' + encodeURIComponent("export function createClient() { throw new Error('@supabase/supabase-js vietato: il test usa il client finto'); }");
const SCRIPT_LEAD = /\/workers\/lead\/[^/]+\.mjs$/;
const VIETATI = new Set(['@supabase/supabase-js', 'playwright']);
globalThis.fetch = () => { throw new Error('rete vietata: client supabase finto (tests/lead_finto_hook.mjs)'); };
registerHooks({
  resolve(specifier, context, nextResolve) {
    const da = context.parentURL ?? '';
    if (specifier === '@supabase/supabase-js' && da === LIB_VERA) return { url: SUPABASE_MUTO, shortCircuit: true };
    if (specifier === 'playwright' && SCRIPT_LEAD.test(da)) return { url: PLAYWRIGHT_FINTO, shortCircuit: true };
    if (VIETATI.has(specifier)) throw new Error(`${specifier} vietato: il test usa il client finto`);
    if (specifier === './lib.mjs' && SCRIPT_LEAD.test(da)) return { url: FINTA, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
