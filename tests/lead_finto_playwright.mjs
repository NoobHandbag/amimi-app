// Playwright finto per tests/lead_letture_errore.mjs (via lead_finto_hook.mjs): collect.mjs gira offline, senza browser
// e senza rete. Ogni pagina e' vuota e ogni ricerca di elementi trova zero elementi; solo il pannello di Google Maps
// (div[role="main"]) e l'URL della scheda vengono da LEAD_FINTO.maps = { testo, url }.
const maps = JSON.parse(process.env.LEAD_FINTO || '{}').maps ?? {};
const loc = (testo = '') => {
  const l = { first: () => l, locator: () => loc(), count: async () => 0, click: async () => {}, innerText: async () => testo, getAttribute: async () => null, evaluateAll: async () => [], all: async () => [] };
  return l;
};
const pagina = () => ({
  goto: async () => null, waitForTimeout: async () => {}, close: async () => {}, screenshot: async () => null,
  content: async () => '', title: async () => '', url: () => maps.url ?? 'about:blank',
  getByRole: () => loc(), locator: (sel) => loc(/role="main"/.test(sel) ? maps.testo ?? '' : ''),
});
const risposta = { ok: () => true, status: () => 200, headers: () => ({}), text: async () => '', json: async () => ({}), body: async () => Buffer.alloc(0) };
const contesto = () => ({ newPage: async () => pagina(), close: async () => {}, request: { get: async () => risposta } });

export const chromium = { launch: async () => ({ newContext: async () => contesto(), close: async () => {} }) };
