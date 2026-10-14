// Preload di tests/lead_letture_errore.mjs: gli script di workers/lead/ girano con ./lib.mjs sostituita da
// tests/lead_finto_lib.mjs (client supabase finto). Niente rete e niente client vero: anche lanciato nel checkout con
// le dipendenze installate e SUPABASE_ACCESS_TOKEN impostato, uno script non puo' raggiungere la produzione.
//   node --import ./tests/lead_finto_hook.mjs workers/lead/<script>.mjs ...
import { registerHooks } from 'node:module';

const FINTA = new URL('./lead_finto_lib.mjs', import.meta.url).href;
const VIETATI = new Set(['@supabase/supabase-js', 'playwright']);
globalThis.fetch = () => { throw new Error('rete vietata: client supabase finto (tests/lead_finto_hook.mjs)'); };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (VIETATI.has(specifier)) throw new Error(`${specifier} vietato: il test usa il client finto`);
    if (specifier === './lib.mjs' && /\/workers\/lead\/[^/]+\.mjs$/.test(context.parentURL ?? '')) return { url: FINTA, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
