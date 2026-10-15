import { test, expect, type Page } from '@playwright/test';

// Layout telefono di Negozi B2B (Blocco 2, report UI/UX del 22-09): Pipeline a lista sotto i 700 px, tabella con la
// colonna Negozio ferma. Dal 15-10 (velocita': "la sezione B2B e' lentissima") la lista legge la vista snella v_lead_lista
// e la Pipeline si mostra appena arriva, senza aspettare la lista. A differenza delle altre spec NON tocca Supabase: ogni
// richiesta verso il progetto e' intercettata e riceve dati finti, e la sessione e' un oggetto finto in localStorage
// (nessuna credenziale vera).
// Lanciare dopo `npm run build`:  npx playwright test negozi-layout

const IMG = 'ig/feed/00000000-0000-0000-0000-000000000001/1.jpg';
// una riga di v_lead_lista: i campi snelli della scheda, piu' `img` (l'unica immagine della card)
const neg = (i: number, nome: string, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-0000-0000-00000000000${i}`, nome, tipo: 'boutique', citta: 'Milano', paese: 'IT', stato_ricerca: 'scored', lead_stage: 'da_contattare',
  totale: 90 - i * 5, tier: null, tier_proposto: 'A', verdetto: 'da_contattare', verdetto_motivo: null, gancio: null, owner_note: null, esclusione: null, motivazione: null, n_evidenze: 12,
  website: null, ig_handle: null, telefono: null, email_generica: 'info@negozio.test',
  ig_metrics: { follower: 12000 + i }, maps: { rating: 4.7, recensioni: 210 }, price_band: { borse: { n: 9, min: 80, mediana: 160, max: 320 } },
  brands_carried: { peer_match: ['Brand Uno', 'Brand Due', 'Brand Tre'] }, img: i === 1 ? IMG : null, ...extra,
});
const LISTA = [neg(1, 'Boutique Con Un Nome Molto Lungo Davvero Di Prova'), neg(2, 'Ivy'), neg(3, 'Wait and See'), neg(4, 'Blu Boutique')];
const out = (i: number, lead_stage: string) => ({
  ...neg(i, LISTA[i - 1].nome), lead_stage, n_tocchi: lead_stage === 'da_contattare' ? 0 : 1, n_email_out: lead_stage === 'da_contattare' ? 0 : 1,
  scaduta: false, da_gestire: false, bozza_auto_tocco: null, prossima_azione: null, prossima_azione_at: null, ultimo_tocco_at: null, giorni_da_ultimo: null,
  telefono_maps: null, email_sito: null, thumb: null, follower: 12000 + i, n_opt_out: 0,
});
const OUTREACH = [out(1, 'da_contattare'), out(2, 'da_contattare'), out(3, 'contattato'), out(4, 'risposto')];
const STADI_PIENI = 3;   // da_contattare, contattato, risposto
const STADI = 9;         // senza Opt-out, che compare solo se ha negozi
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function apri(page: Page, hash: string, opts: { listaLenta?: boolean } = {}): Promise<{ listaArrivata: boolean }> {
  const stato = { listaArrivata: false };
  await page.addInitScript(() => {
    localStorage.setItem('amimi-cs-auth', JSON.stringify({
      access_token: 'finto', refresh_token: 'finto', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '00000000-0000-0000-0000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'prova@amimi.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    }));
  });
  await page.route(/supabase\.co\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/v_lead_lista')) {
      const id = url.searchParams.get('id');
      if (id) return json(LISTA.filter((r) => `eq.${r.id}` === id));   // una riga per id (dopo una scrittura, o mancante in lista)
      if (opts.listaLenta) await new Promise((r) => setTimeout(r, 2000));
      stato.listaArrivata = true;
      return json(Number(url.searchParams.get('offset') ?? 0) > 0 ? [] : LISTA);
    }
    if (url.pathname.endsWith('/v_lead_outreach')) return json(OUTREACH);
    // bucket privato lead-assets: la firma (POST) e poi l'immagine firmata
    if (url.pathname.endsWith('/storage/v1/object/sign/lead-assets') && req.method() === 'POST') {
      const { paths } = (req.postDataJSON() ?? { paths: [] }) as { paths: string[] };
      return json(paths.map((p) => ({ error: null, path: p, signedURL: `/object/sign/lead-assets/${p}?token=finto` })));
    }
    if (url.pathname.includes('/storage/v1/object/sign/lead-assets/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 });
    return json([]);
  });
  await page.goto(hash);
  return stato;
}

test.describe('telefono 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('Pipeline: lista unica per stadio, niente scorrimento laterale, stadi vuoti nascosti', async ({ page }) => {
    await apri(page, '#negozi/outreach');
    await expect(page.locator('.or-card')).toHaveCount(OUTREACH.length);
    const m = await page.evaluate(() => {
      const board = document.querySelector('.or-board') as HTMLElement;
      const vis = (el: Element) => getComputedStyle(el).display !== 'none';
      const cols = [...document.querySelectorAll('.or-col')];
      return {
        display: getComputedStyle(board).display, overflowBoard: board.scrollWidth - board.clientWidth, overflowPagina: document.documentElement.scrollWidth - window.innerWidth,
        colonne: cols.length, visibili: cols.filter(vis).length, vuoteVisibili: cols.filter((c) => c.classList.contains('empty') && vis(c)).length,
        cardMin: Math.min(...[...document.querySelectorAll('.or-card')].map((c) => c.getBoundingClientRect().width)), boardW: board.clientWidth,
      };
    });
    expect(m.display).toBe('block');
    expect(m.overflowBoard).toBeLessThanOrEqual(1);
    expect(m.overflowPagina).toBeLessThanOrEqual(0);
    expect(m.colonne).toBe(STADI);
    expect(m.visibili).toBe(STADI_PIENI);
    expect(m.vuoteVisibili).toBe(0);
    expect(m.cardMin).toBeGreaterThan(m.boardW - 40);   // le card occupano la riga, non una colonna da 210 px
    await expect(page.locator('.or-solo-tel')).toHaveCount(0);   // la pipeline non e' vuota
  });

  test('Tabella: Negozio resta fermo scorrendo, Rating / Brand affini / Evid. nascosti', async ({ page }) => {
    await apri(page, '#negozi');
    await page.getByRole('button', { name: 'Tabella', exact: true }).click();
    await expect(page.locator('.lead-table tbody tr')).toHaveCount(LISTA.length);
    for (const h of ['Rating', 'Brand affini', 'Evid.']) await expect(page.locator('.lead-table th', { hasText: h })).toBeHidden();
    for (const h of ['Negozio', 'Score', 'Verdetto', 'Follower']) await expect(page.locator('.lead-table th', { hasText: h })).toHaveCount(1);
    const m = await page.evaluate(() => {
      const wrap = document.querySelector('.tablewrap') as HTMLElement;
      const riga = document.querySelector('.lead-table tbody tr') as HTMLElement;
      const [nome, citta] = [riga.children[0], riga.children[1]] as HTMLElement[];
      const prima = { nome: nome.getBoundingClientRect().left, citta: citta.getBoundingClientRect().left };
      wrap.scrollLeft = 120;
      const dopo = { nome: nome.getBoundingClientRect().left, citta: citta.getBoundingClientRect().left };
      return {
        scorre: wrap.scrollWidth - wrap.clientWidth, scrollLeft: wrap.scrollLeft, prima, dopo, wrapLeft: wrap.getBoundingClientRect().left,
        nomeW: nome.getBoundingClientRect().width, nomeRight: nome.getBoundingClientRect().right, fondo: getComputedStyle(nome).backgroundColor,
        overflowPagina: document.documentElement.scrollWidth - window.innerWidth,
        celleNascoste: [...riga.children].filter((c) => getComputedStyle(c).display === 'none').length,
      };
    });
    expect(m.scrollLeft).toBe(120);                                    // la tabella scorre ancora di lato
    expect(Math.abs(m.dopo.nome - m.prima.nome)).toBeLessThanOrEqual(1);   // ma il nome non si muove
    expect(Math.abs(m.dopo.nome - m.wrapLeft)).toBeLessThanOrEqual(1);
    expect(m.prima.citta - m.dopo.citta).toBeGreaterThan(100);          // le altre colonne si'
    expect(m.dopo.citta).toBeLessThan(m.nomeRight);                     // e passano sotto la cella ferma
    expect(m.fondo).not.toBe('rgba(0, 0, 0, 0)');                       // che ha un fondo pieno
    expect(m.nomeW).toBeLessThanOrEqual(375 * 0.42 + 1);                // un nome lungo non occupa tutto lo schermo
    expect(m.celleNascoste).toBe(3);
    expect(m.overflowPagina).toBeLessThanOrEqual(0);
  });
});

test.describe('schermo largo 1024 px', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('Pipeline: resta il kanban con tutti gli stadi, anche vuoti', async ({ page }) => {
    await apri(page, '#negozi/outreach');
    await expect(page.locator('.or-card')).toHaveCount(OUTREACH.length);
    const m = await page.evaluate(() => {
      const board = document.querySelector('.or-board') as HTMLElement;
      const cols = [...document.querySelectorAll('.or-col')];
      return { display: getComputedStyle(board).display, visibili: cols.filter((c) => getComputedStyle(c).display !== 'none').length, righe: new Set(cols.map((c) => Math.round(c.getBoundingClientRect().top))).size };
    });
    expect(m.display).toBe('grid');
    expect(m.visibili).toBe(STADI);
    expect(m.righe).toBe(1);   // colonne affiancate
  });

  test('Tabella: tutte e 12 le colonne', async ({ page }) => {
    await apri(page, '#negozi');
    await page.getByRole('button', { name: 'Tabella', exact: true }).click();
    await expect(page.locator('.lead-table tbody tr')).toHaveCount(LISTA.length);
    for (const h of ['Rating', 'Brand affini', 'Evid.']) await expect(page.locator('.lead-table th', { hasText: h })).toBeVisible();
    expect(await page.locator('.lead-table thead th').count()).toBe(12);
  });

  test('Pipeline: le card compaiono PRIMA che la lista (lenta 2 s) sia arrivata, e la lista arriva da sola dopo', async ({ page }) => {
    const stato = await apri(page, '#negozi/outreach', { listaLenta: true });
    await expect(page.locator('.or-card')).toHaveCount(OUTREACH.length);
    expect(stato.listaArrivata).toBe(false);
    await expect.poll(() => stato.listaArrivata, { timeout: 6000 }).toBe(true);
    await page.getByRole('button', { name: 'Negozi', exact: true }).click();
    await expect(page.locator('.lead-card')).toHaveCount(LISTA.length);
  });

  test('Schede: la miniatura e\' un <img loading="lazy"> con l\'URL firmato del bucket', async ({ page }) => {
    await apri(page, '#negozi');
    await expect(page.locator('.lead-card')).toHaveCount(LISTA.length);
    const img = page.locator('.lead-card .lead-thumb img');
    await expect(img).toHaveCount(1);   // solo la scheda con `img`
    await expect(img).toHaveAttribute('loading', 'lazy');
    await expect(img).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/lead-assets\/ig\/feed\/.*token=finto/);
    await expect(page.locator('.lead-card .lead-thumb', { hasText: 'nessuna immagine' })).toHaveCount(LISTA.length - 1);
  });
});
