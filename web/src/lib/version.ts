// Controllo versione (brief cs_crop_residui_e_versione, parte 2).
//
// Il problema, e non e' teorico: le operatrici tengono la PWA aperta per ore e la scheda continua a
// eseguire il bundle che ha caricato all'avvio. Durante un collaudo del 02-08 e' successo davvero -
// la scheda girava su un bundle vecchio, il difetto era gia' corretto, e stava per essere
// consegnato all'owner come "bug critico non risolto". Non esiste service worker nel progetto
// (verificato: nessun sw.js, nessun vite-plugin-pwa), quindi non c'e' nessun ciclo di aggiornamento
// che se ne occupi: va fatto a mano.
//
// COSA SI CONFRONTA. Un intero crescente generato al build (`build`), non il nome del file e non
// una data leggibile. Il confronto e' MONOTONO - si avvisa solo se il pubblicato e' PIU' NUOVO del
// proprio - perche' la CDN di GitHub Pages puo' servire per qualche minuto un `version.json` piu'
// vecchio del bundle appena scaricato: con un confronto per disuguaglianza si direbbe "c'e' una
// versione nuova" proprio a chi e' gia' aggiornato.
//
// CACHE, misurata sul sito vivo il 02-08: la CDN davanti a GitHub Pages IGNORA la query string
// (stesso file con `?a=1` e poi `?b=2` risponde MISS e poi HIT), quindi il vecchio trucco del
// cache-busting per query NON serve a bucare la CDN. Serve invece a bucare la cache del BROWSER,
// che e' il layer che conta qui (`Cache-Control: max-age=600` su tutti i file). Percio': `no-store`
// sulla lettura di version.json, e la query solo al momento del ricaricamento.

declare const __AMIMI_BUILD__: number;
declare const __AMIMI_LABEL__: string;

/** Il momento del build di QUESTO bundle. Intero crescente. */
export const BUILD_MIO: number = typeof __AMIMI_BUILD__ === 'number' ? __AMIMI_BUILD__ : 0;
/** La versione leggibile di QUESTO bundle, per poter chiedere "che versione vedi?". */
export const VERSIONE_MIA: string = typeof __AMIMI_LABEL__ === 'string' ? __AMIMI_LABEL__ : 'sviluppo';

export type Pubblicata = { build: number; label: string; entry: string | null };

/** Legge la versione pubblicata. `null` se non si sa (rete assente, file mancante, JSON rotto):
 *  nel dubbio non si avvisa nessuno, perche' un falso allarme fa perdere il lavoro in corso. */
export async function versionePubblicata(): Promise<Pubblicata | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    const build = Number(j?.build);
    if (!Number.isFinite(build) || build <= 0) return null;
    return { build, label: String(j?.label ?? ''), entry: j?.entry ? String(j.entry) : null };
  } catch { return null; }
}

/** C'e' una versione piu' nuova della mia? Solo in avanti, mai all'indietro. */
export async function cEUnAggiornamento(): Promise<Pubblicata | null> {
  if (!BUILD_MIO) return null;   // in `npm run dev` il define non c'e': il meccanismo si spegne da solo
  const p = await versionePubblicata();
  return p && p.build > BUILD_MIO ? p : null;
}

/** Ricarica prendendo davvero i file nuovi. La query non buca la CDN (non entra nella sua chiave di
 *  cache) ma buca la cache del BROWSER, che e' quella che qui tiene in vita l'index.html vecchio. */
export function ricaricaAggiornando(build: number): void {
  const base = location.href.split('#')[0].split('?')[0];
  location.replace(`${base}?v=${build}`);
}
