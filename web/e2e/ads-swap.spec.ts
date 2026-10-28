import { test, expect, type Locator, type Page } from '@playwright/test';

// Card "Creativita' da cambiare" del Cruscotto (28-10, viste v_ads_swap e v_ads_periodo_14g della migr 0175; Gate 2 X4).
// Come villaggio.spec.ts NON tocca Supabase: ogni richiesta a *.supabase.co e' intercettata e riceve dati finti (le due
// viste qui sotto, tutto il resto []). Casi: vista assente (migrazione non applicata), dati vecchi, stato sconosciuto,
// CPA sulle soglie, frequency 7g non letta, gruppo "In pausa", e la tabella 14 contro 14 ('0 acq.', frecce a voce, base
// piccola). Lanciare dopo la build verso il progetto finto (come la CI):
//   VITE_SUPABASE_URL=https://e2e-progetto-finto.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_e2e_finto npx vite build
//   E2E_PORT=<porta libera> npx playwright test e2e/ads-swap.spec.ts
// Sempre col percorso del file (il worktree si chiama ads-cruscotto: un filtro nudo puo' prendere anche ingest.spec.ts).
// NON e' nella CI: l'elenco degli spec sta in .github/workflows/amimi-app-tests.yml, una riga da aggiungere su decisione
// dell'owner.

type Riga = Record<string, unknown>;
const romaIso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const giornoFa = (n: number) => romaIso(new Date(Date.now() - n * 86400000));
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const IERI = giornoFa(1);

/** Una riga di v_ads_swap con le colonne vere (PostgREST: numeric come stringhe); un ad sano e consegnato, stato ok. */
const ad = (id: string, nome: string, extra: Riga = {}): Riga => ({
  as_of: IERI, ad_id: id, ad_name: nome, campaign_id: 'c1', campaign_name: 'COLD · Prospecting borse', adset_id: 'as1', adset_name: 'Broad IT donne 25-54',
  effective_status: 'ACTIVE', object_type: 'SHARE', frame_url: null, image_url: null, thumbnail_url: null, pubblico: 'cold', first_day: giornoFa(40), giorni_live: 40,
  spend_7: '120', impressions_7: '14000', link_ctr_7: '1.1', link_ctr_base: '1.15', impressions_base: '30000', ctr_var_pct: '-4',
  cpm_7: '8.6', cpm_base: '8.2', cpm_var_pct: '5', freq_7g: '1.8', freq_soglia: '2.5',
  spend_14: '240', purchases_14: '4', value_14: '760', cpa_14: '60', roas_14: '3.17', hook_7: null, hook_base: null, quota_adset_7: '40', pct_oos: '0',
  segnale_freq: false, segnale_ctr: false, segnale_spesa: false, stato: 'ok', motivo: 'nessun segnale di fatica', ordine: 4,
  freq_mancante: false, freq_al: IERI, ...extra,
});

/** Una riga di v_ads_periodo_14g (una finestra di un oggetto). */
const per = (level: string, wk: 'cur14' | 'prev14', id: string, nome: string, extra: Riga = {}): Riga => ({
  level, window_key: wk, since: giornoFa(wk === 'cur14' ? 14 : 28), until: giornoFa(wk === 'cur14' ? 1 : 15), as_of: IERI,
  object_id: id, object_name: nome, campaign_id: level === 'campaign' ? id : null, campaign_name: level === 'campaign' ? nome : null, adset_id: null, adset_name: null,
  object_type: null, effective_status: null, spend: '100', impressions: '12000', reach: '8000', frequency: '1.5', clicks: '200', link_clicks: '120', link_ctr: '1',
  cpc_link: '0.83', cpm: '8.33', landing_page_views: '90', lpv_rate: '75', add_to_cart: '10', atc_rate: '11.1', initiate_checkout: '5', purchases: '2',
  purchase_value: '380', roas: '3.8', cpa: '50', video_3s_views: '0', hook_rate: null, thruplays: '0', hold_rate: null, days_with_spend: '14', ...extra,
});

const ASSENTE = (vista: string) => ({ code: 'PGRST205', details: null, hint: null, message: `Could not find the table 'public.${vista}' in the schema cache` });

async function apri(page: Page, dati: { swap: Riga[] | '404'; periodo?: Riga[] | '404' }) {
  const errori: string[] = [];
  page.on('pageerror', (e) => errori.push(e.message));
  await page.addInitScript(() => localStorage.setItem('amimi_chi', 'Ale'));
  await page.route(/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route(/supabase\.co\//, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/rest/v1/v_ads_swap')) return dati.swap === '404' ? json(ASSENTE('v_ads_swap'), 404) : json(dati.swap);
    if (url.pathname.endsWith('/rest/v1/v_ads_periodo_14g')) {
      const p = dati.periodo ?? [];
      return p === '404' ? json(ASSENTE('v_ads_periodo_14g'), 404) : json(p);
    }
    return json([]);
  });
  await page.goto('');
  await page.locator('.ds-qbtn', { hasText: 'Cruscotto finanze' }).click();
  const card = page.locator('section.ads-swap');
  await expect(card.getByRole('heading', { name: "Creativita' da cambiare" })).toBeVisible();
  return { card, errori };
}
const adDi = (card: Locator, nome: string) => card.locator('.sw-ad', { hasText: nome });
const box = (card: Locator, nome: string, etichetta: string) => adDi(card, nome).locator('.sw-m', { hasText: etichetta });

test.use({ locale: 'it-IT', timezoneId: 'Europe/Rome' });

test('vista assente (404 PGRST205): la card resta e dice "migrazione 0175 non applicata"', async ({ page }) => {
  const { card, errori } = await apri(page, { swap: '404', periodo: '404' });
  await expect(card.locator('.sw-err', { hasText: "Creativita' non lette" })).toContainText('migrazione 0175 non applicata');
  await expect(card.locator('.sw-err', { hasText: 'Confronto 14 giorni non letto' })).toContainText('migrazione 0175 non applicata');
  await expect(card.locator('.sw-ad')).toHaveCount(0);
  expect(errori).toEqual([]);
});

test('dati di 4 giorni fa: fascia role=alert "Dati Meta fermi"', async ({ page }) => {
  const asOf = giornoFa(4);
  const { card, errori } = await apri(page, { swap: [ad('a1', 'Ad vecchio', { as_of: asOf, freq_al: asOf })] });
  const alert = card.getByRole('alert');
  await expect(alert).toHaveCount(1);
  await expect(alert).toContainText(`Dati Meta fermi al ${ddmm(asOf)} (4 giorni fa)`);
  expect(errori).toEqual([]);
});

test("stato sconosciuto 'xyz': finisce fra quelli da osservare, nessuna fascia coi dati di ieri", async ({ page }) => {
  const { card, errori } = await apri(page, { swap: [ad('a1', 'Ad sconosciuto', { stato: 'xyz', ordine: 9, motivo: 'stato nuovo della vista' })] });
  const gruppo = card.locator('.sw-grp', { has: page.locator('h3.sw-gh', { hasText: 'Da osservare' }) });
  await expect(gruppo.locator('.sw-ad', { hasText: 'Ad sconosciuto' })).toBeVisible();
  await expect(adDi(card, 'Ad sconosciuto').locator('.ds-pill')).toHaveText('da osservare');
  await expect(card.locator('.sw-counts')).toContainText('1 da osservare');
  await expect(card.getByRole('alert')).toHaveCount(0);
  expect(errori).toEqual([]);
});

test('CPA 14g sulle soglie: 50 arancio, 80 rosso', async ({ page }) => {
  const { card, errori } = await apri(page, { swap: [
    ad('a1', 'Ad CPA cinquanta', { cpa_14: '50', spend_14: '200', purchases_14: '4' }),
    ad('a2', 'Ad CPA ottanta', { cpa_14: '80', spend_14: '160', purchases_14: '2' }),
  ] });
  await expect(box(card, 'Ad CPA cinquanta', 'CPA 14g')).toHaveClass(/\bwarn\b/);
  await expect(box(card, 'Ad CPA ottanta', 'CPA 14g')).toHaveClass(/\bneg\b/);
  expect(errori).toEqual([]);
});

// frequency 7g non letta per as_of (meta_ad_freq7 ferma): freq_7g null e freq_mancante sull'ad attivo e consegnato
const SENZA_FREQ = (freqAl: string | null) => ad('a1', 'Ad senza frequency', { freq_7g: null, freq_mancante: true, freq_al: freqAl });

test('frequency 7g ferma a 3 giorni fa: fascia "ferma al", box n/d arancio', async ({ page }) => {
  const freqAl = giornoFa(3);
  const { card, errori } = await apri(page, { swap: [SENZA_FREQ(freqAl)] });
  const fascia = card.locator('.sw-freq');
  await expect(fascia).toHaveText(`Frequency 7g ferma al ${ddmm(freqAl)}: le creativita' non sono valutate sulla frequency.`);
  await expect(fascia).toHaveAttribute('role', 'alert');
  const freq = box(card, 'Ad senza frequency', 'freq 7g');
  await expect(freq.locator('b')).toContainText('n/d');
  await expect(freq).toHaveClass(/\bwarn\b/);
  expect(errori).toEqual([]);
});

test('frequency 7g mai letta (freq_al null): fascia "non letta"', async ({ page }) => {
  const { card, errori } = await apri(page, { swap: [SENZA_FREQ(null)] });
  await expect(card.locator('.sw-freq')).toHaveText("Frequency 7g non letta: le creativita' non sono valutate sulla frequency.");
  expect(errori).toEqual([]);
});

test('frequency 7g letta per as_of ma non per questo ad: niente fascia, box n/d arancio', async ({ page }) => {
  const { card, errori } = await apri(page, { swap: [SENZA_FREQ(IERI)] });
  await expect(adDi(card, 'Ad senza frequency')).toBeVisible();
  await expect(card.locator('.sw-freq')).toHaveCount(0);
  await expect(box(card, 'Ad senza frequency', 'freq 7g')).toHaveClass(/\bwarn\b/);
  expect(errori).toEqual([]);
});

test('in pausa: gruppo chiuso "In pausa (1)" che si apre col tocco, niente "Nessun ad attivo"', async ({ page }) => {
  const { card, errori } = await apri(page, { swap: [ad('a1', 'Ad in pausa', { effective_status: 'PAUSED', stato: 'in_pausa', ordine: 6, motivo: 'non attiva su Meta (PAUSED)' })] });
  const btn = card.getByRole('button', { name: 'In pausa (1)' });
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(adDi(card, 'Ad in pausa')).toHaveCount(0);
  await expect(card.getByText('Nessun ad attivo o con spesa negli ultimi 14 giorni.')).toHaveCount(0);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(adDi(card, 'Ad in pausa').locator('.ds-pill')).toHaveText('in pausa');
  expect(errori).toEqual([]);
});

test('CTR su base piccola: variazione grigia con "(base piccola)"; base piena: rossa, "peggio" a voce', async ({ page }) => {
  const { card, errori } = await apri(page, { swap: [
    ad('a1', 'Ad base piccola', { impressions_base: '640', link_ctr_base: '1.6', link_ctr_7: '1.1', ctr_var_pct: '-31', stato: 'nuova', ordine: 3 }),
    ad('a2', 'Ad base piena', { link_ctr_base: '1.6', link_ctr_7: '1.1', ctr_var_pct: '-31' }),
  ] });
  const piccola = box(card, 'Ad base piccola', 'CTR link 7g').locator('.sw-d');
  await expect(piccola).toHaveClass(/\bflat\b/);
  await expect(piccola).toContainText('-31% vs inizio (base piccola)');
  const piena = box(card, 'Ad base piena', 'CTR link 7g').locator('.sw-d');
  await expect(piena).toHaveClass(/\bbad\b/);
  await expect(piena).not.toContainText('base piccola');
  await expect(piena.locator('.sw-sr')).toHaveText(', peggio');
  expect(errori).toEqual([]);
});

test("14 contro 14: CPA senza acquisti '0 acq.' sul limite inferiore, frecce col verdetto a voce", async ({ page }) => {
  const periodo = [
    per('campaign', 'cur14', 'c1', 'Campagna ottanta', { spend: '80', purchases: '0', cpa: null, roas: '0', purchase_value: '0' }),
    per('campaign', 'prev14', 'c1', 'Campagna ottanta', { spend: '50', purchases: '0', cpa: null, roas: '0', purchase_value: '0' }),
    per('campaign', 'cur14', 'c2', 'Campagna cinquanta', { spend: '50', purchases: '0', cpa: null, roas: '0', purchase_value: '0' }),
    per('campaign', 'prev14', 'c2', 'Campagna cinquanta', { spend: '30', purchases: '1', cpa: '30', roas: '2' }),
    per('campaign', 'cur14', 'c3', 'Campagna venti', { spend: '20', purchases: '0', cpa: null, roas: '0', purchase_value: '0' }),
    per('campaign', 'cur14', 'c4', 'Campagna buona', { spend: '120', purchases: '3', cpa: '40', roas: '3' }),
    per('campaign', 'prev14', 'c4', 'Campagna buona', { spend: '100', purchases: '2', cpa: '50', roas: '2' }),
  ];
  const { card, errori } = await apri(page, { swap: [ad('a1', 'Ad qualunque')], periodo });
  const riga = (nome: string) => card.locator('tr.sw-lv-campaign', { hasText: nome });
  const cpa = (nome: string) => riga(nome).locator('td.sw-c').nth(2);   // Spesa, ROAS, CPA
  await expect(cpa('Campagna ottanta').locator('b')).toHaveText('0 acq.');
  await expect(cpa('Campagna ottanta').locator('b')).toHaveClass('neg');
  await expect(cpa('Campagna ottanta').locator('small')).toHaveText('0 acq.');
  await expect(cpa('Campagna cinquanta').locator('b')).toHaveClass('warn');
  await expect(cpa('Campagna cinquanta').getByRole('img')).toHaveCount(0);   // nessuna freccia senza due numeri
  await expect(cpa('Campagna venti').locator('b')).toHaveText('0 acq.');
  expect(await cpa('Campagna venti').locator('b').getAttribute('class')).toBeNull();
  // la spesa sale senza verdetto; ROAS da 2 a 3: su e meglio; CPA da 50 a 40: giu' e meglio; ROAS da 2 a 0: giu' e peggio
  const freccia = (nome: string, col: number) => riga(nome).locator('td.sw-c').nth(col).getByRole('img');
  await expect(freccia('Campagna buona', 0)).toHaveAttribute('aria-label', 'in aumento');
  await expect(freccia('Campagna buona', 1)).toHaveAttribute('aria-label', 'in aumento, meglio');
  await expect(freccia('Campagna buona', 2)).toHaveAttribute('aria-label', 'in calo, meglio');
  await expect(freccia('Campagna cinquanta', 1)).toHaveAttribute('aria-label', 'in calo, peggio');
  await expect(freccia('Campagna buona', 1)).toHaveText('▲');   // a schermo la stessa freccia di prima
  expect(errori).toEqual([]);
});
