import { test, expect, type Page } from '@playwright/test';

// Badge "da fare" del bottone B2B nella barra (CASI_APERTI n.38 a, 15-10): prima si rileggeva a OGNI cambio di tab
// (3 richieste, di cui v_lead_inbound la piu' cara). Ora: al mount, ogni 5 minuti a scheda visibile, al ritorno in
// primo piano e quando si ESCE da Negozi. Come negozi-layout.spec.ts NON tocca Supabase: ogni richiesta al progetto e'
// intercettata e riceve dati finti, e la sessione e' un oggetto finto in localStorage.
// Il badge conta con richieste HEAD (select=id, count exact); la pagina Negozi legge le stesse viste con GET, quindi
// contare le HEAD su v_lead_outreach isola le letture del badge.
// Lanciare dopo `npm run build`:  npx playwright test negozi-badge

type Stato = { head: number; outreach: number; inbound: number; guasto?: boolean; ritardoProssima?: number };
const SESSIONE = JSON.stringify({
  access_token: 'finto', refresh_token: 'finto', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'prova@amimi.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
});

async function apri(page: Page, stato: Stato, opts: { clock?: boolean; senzaSessione?: boolean } = {}): Promise<{ n: () => number }> {
  let head = 0;
  if (opts.clock) await page.clock.install();
  if (!opts.senzaSessione) await page.addInitScript((s) => { localStorage.setItem('amimi-cs-auth', s); }, SESSIONE);
  await page.route(/supabase\.co\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, headers: Record<string, string> = {}) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
    // content-range non e' un'intestazione CORS "sicura": senza expose il browser la nasconde al client e il conteggio resta null
    const conteggio = (n: number) => route.fulfill({ status: 200, headers: { 'content-range': `*/${n}`, 'access-control-expose-headers': 'content-range' }, body: '' });
    if (req.method() === 'HEAD' && url.pathname.endsWith('/v_lead_outreach')) {
      head++;
      if (stato.guasto) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'guasto finto' }) });
      const valore = stato.outreach;   // il valore e' quello del momento in cui la richiesta parte, anche se la risposta e' lenta
      const ritardo = stato.ritardoProssima ?? 0;
      stato.ritardoProssima = 0;
      if (ritardo) await new Promise((r) => setTimeout(r, ritardo));
      return conteggio(valore);
    }
    if (req.method() === 'HEAD' && url.pathname.endsWith('/v_lead_inbound')) return conteggio(stato.inbound);
    if (url.pathname.endsWith('/v_lead_settings')) return json({ value: 'true' });   // lead_outreach_ai_enabled: .maybeSingle()
    return json([]);
  });
  await page.goto('');
  return { n: () => head };
}

const bottone = (page: Page, nome: RegExp) => page.locator('.bottomnav button', { hasText: nome });
const badge = (page: Page) => page.locator('.bottomnav .navbdg');
// il numero di richieste e' quello DEL BADGE: aspetta che le risposte siano arrivate e che la pagina sia ferma
const ferma = (page: Page) => page.waitForTimeout(400);

test('il badge si legge al mount e i cambi di tab non lo rileggono', async ({ page }) => {
  const stato: Stato = { head: 0, outreach: 2, inbound: 1 };
  const r = await apri(page, stato);
  await expect(badge(page)).toHaveText('3');   // 2 da fare + 1 messaggio da collegare
  expect(r.n()).toBe(1);

  // il numero finto cambia: se una rilettura partisse, il badge lo mostrerebbe
  stato.outreach = 9;
  for (const nome of [/^Tabelle/, /^Magazzino/, /^Home/, /^Magazzino/, /^Tabelle/, /^Home/]) {
    await bottone(page, nome).click();
    await ferma(page);
  }
  expect(r.n()).toBe(1);
  await expect(badge(page)).toHaveText('3');
});

test('uscendo da Negozi il badge si rilegge; entrarci no', async ({ page }) => {
  const stato: Stato = { head: 0, outreach: 2, inbound: 1 };
  const r = await apri(page, stato);
  await expect(badge(page)).toHaveText('3');
  expect(r.n()).toBe(1);

  await bottone(page, /B2B$/).click();
  await ferma(page);
  expect(r.n()).toBe(1);   // entrare in Negozi non rilegge

  stato.outreach = 5;   // una scrittura fatta dentro Negozi ha cambiato il da-fare
  await bottone(page, /^Home/).click();
  await expect(badge(page)).toHaveText('6');
  expect(r.n()).toBe(2);

  await bottone(page, /^Tabelle/).click();
  await ferma(page);
  expect(r.n()).toBe(2);   // un cambio di tab qualunque, dopo, non rilegge
});

test('ritorno in primo piano della scheda: una lettura, e non da nascosta', async ({ page }) => {
  const stato: Stato = { head: 0, outreach: 2, inbound: 0 };
  const r = await apri(page, stato);
  await expect(badge(page)).toHaveText('2');
  expect(r.n()).toBe(1);

  const vis = (hidden: boolean) => page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  stato.outreach = 4;
  await vis(true);
  await ferma(page);
  expect(r.n()).toBe(1);   // la scheda va in secondo piano: nessuna lettura
  await vis(false);
  await expect(badge(page)).toHaveText('4');
  expect(r.n()).toBe(2);
});

test('ogni 5 minuti a scheda visibile; da nascosta niente', async ({ page }) => {
  const stato: Stato = { head: 0, outreach: 2, inbound: 0 };
  const r = await apri(page, stato, { clock: true });
  await expect(badge(page)).toHaveText('2');
  expect(r.n()).toBe(1);

  await page.clock.fastForward('04:00');
  await ferma(page);
  expect(r.n()).toBe(1);   // prima dei 5 minuti niente

  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  stato.outreach = 7;
  await page.clock.fastForward('02:00');   // il tick dei 5 minuti cade a scheda nascosta
  await ferma(page);
  expect(r.n()).toBe(1);

  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
  await page.clock.fastForward('05:05');
  await expect(badge(page)).toHaveText('7');
  expect(r.n()).toBe(2);
});

test('senza login niente richieste; dopo il login il cambio di tab successivo legge, e poi si smette', async ({ page }) => {
  const stato: Stato = { head: 0, outreach: 2, inbound: 1 };
  const r = await apri(page, stato, { senzaSessione: true });
  await ferma(page);
  expect(r.n()).toBe(0);
  await expect(badge(page)).toHaveCount(0);

  await bottone(page, /^Tabelle/).click();
  await ferma(page);
  expect(r.n()).toBe(0);   // ancora senza sessione: nessuna richiesta

  await page.evaluate((s) => { localStorage.setItem('amimi-cs-auth', s); }, SESSIONE);   // il login e' avvenuto in un'altra schermata
  await bottone(page, /^Home/).click();
  await expect(badge(page)).toHaveText('3');
  expect(r.n()).toBe(1);

  await bottone(page, /^Magazzino/).click();
  await ferma(page);
  expect(r.n()).toBe(1);   // con un numero valido si torna a leggere per eventi
});

test('una lettura fallita non vale "0 da fare": si riprova al cambio di tab successivo, poi si smette', async ({ page }) => {
  const stato: Stato = { head: 0, outreach: 2, inbound: 0, guasto: true };
  const r = await apri(page, stato);
  await expect.poll(() => r.n()).toBe(1);
  await expect(badge(page)).toHaveCount(0);

  await bottone(page, /^Tabelle/).click();
  await expect.poll(() => r.n()).toBe(2);   // ancora guasto: riprova

  stato.guasto = false;
  await bottone(page, /^Home/).click();
  await expect(badge(page)).toHaveText('2');
  expect(r.n()).toBe(3);

  await bottone(page, /^Magazzino/).click();
  await ferma(page);
  expect(r.n()).toBe(3);
});

test('uscendo da Assistenza il badge si rilegge (login, logout e categoria cambiano il da-fare)', async ({ page }) => {
  const stato: Stato = { head: 0, outreach: 2, inbound: 1 };
  const r = await apri(page, stato);
  await expect(badge(page)).toHaveText('3');
  expect(r.n()).toBe(1);

  await bottone(page, /^Assistenza/).click();
  await ferma(page);
  expect(r.n()).toBe(1);   // entrare in Assistenza non rilegge

  stato.outreach = 6;
  await bottone(page, /^Home/).click();
  await expect(badge(page)).toHaveText('7');
  expect(r.n()).toBe(2);
});

test('una risposta in ritardo non sovrascrive una lettura piu\' recente', async ({ page }) => {
  const stato: Stato = { head: 0, outreach: 2, inbound: 0 };
  const r = await apri(page, stato);
  await expect(badge(page)).toHaveText('2');

  await bottone(page, /B2B$/).click();
  await ferma(page);
  stato.ritardoProssima = 1500;   // la lettura del ritorno in primo piano parte col valore 2 e arriva dopo 1,5 s
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => r.n()).toBe(2);
  stato.outreach = 7;   // una scrittura dentro Negozi: uscendo, la lettura veloce vede 7
  await bottone(page, /^Home/).click();
  await expect(badge(page)).toHaveText('7');
  expect(r.n()).toBe(3);

  await page.waitForTimeout(1900);   // la risposta lenta (2) e' arrivata: non deve rimettere il numero vecchio
  await expect(badge(page)).toHaveText('7');
});
