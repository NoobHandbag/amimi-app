import { test, expect, type Page } from '@playwright/test';

// Tab "Comportamento" (25-10, modulo beh_*, migr 0169-0171, decisioni D4 e D6): tessera solo di Ale e solo a flag
// beh_enabled acceso (vista v_beh_settings), scheda #comportamento con login del team e una sola RPC, beh_dashboard.
// Come notifiche.spec.ts NON tocca Supabase: ogni richiesta a *.supabase.co e' intercettata e riceve dati finti, la
// sessione del team e' un oggetto finto in localStorage. Lanciare dopo la build verso il progetto finto (come la CI):
//   VITE_SUPABASE_URL=https://e2e-progetto-finto.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_e2e_finto npx vite build
//   E2E_PORT=<porta libera> npx playwright test e2e/comportamento.spec.ts

const SESSIONE = JSON.stringify({
  access_token: 'finto', refresh_token: 'finto', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-0000000000bb', aud: 'authenticated', role: 'authenticated', email: 'prova@amimi.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
});

/** Risposta della RPC come la costruisce la 0171 (chiavi e tipi veri, numeri inventati). tracciati/pronti cambia la card scura. */
function dash(days: number, tracciati = 87, pronti = 120) {
  const giorni = Array.from({ length: days }, (_, i) => ({ day: new Date(Date.UTC(2026, 9, 24) - (days - 1 - i) * 86400000).toISOString().slice(0, 10), online: 4, tracciati: 3 }));
  return {
    state: 'on', generated_at: '2026-10-25T22:00:00Z', days, from: giorni[0].day, to: '2026-10-24', oggi: '2026-10-25', prev_from: '2026-08-26', prev_to: '2026-09-24', steps: ['ordini', 'meta'],
    ordini: {
      fonte: 'Shopify, origine degli ordini (beh_order_origin)', dati_al: '2026-10-25T21:00:00Z', online: pronti + 2, online_pronti: pronti, online_tracciati: tracciati,
      in_attribuzione: 2, prev_online_pronti: 100, prev_online_tracciati: 70, tutti: 130, prev_tutti: 110, lordo: 21500.5,
      per_canale: { online_store: pronti + 2, bozza: 3, facebook_instagram: 4, shop: 1 }, giorni,
    },
    fonti: {
      fonte: 'Shopify, Meta', ultima_visita: { direct: 40, search: 20, social: 15, paid_social: 8, email: 2, referral: 1, unknown: 1, none: 33 },
      prima_visita: { direct: 30, search: 30, social: 14, paid_social: 10, email: 1, none: 35 }, meta_dati_al: '2026-10-24',
      spesa_dal: giorni[0].day as string | null, giorni_spesa: days, giorni_spesa_mancanti: 0,
      spesa_meta: 1234.56 as number | null, ordini_cpa: 125, prev_spesa_meta: 1000 as number | null, prev_ordini_cpa: 100 as number | null,
      ads: { link_clicks: 4613, outbound_clicks: 2940, landing_page_views: 2180, dati_al: '2026-10-24' as string | null },
    },
    clienti: {
      fonte: 'Supabase', clienti: 888, con_2_ordini: 61, riacquisto_90: { ricomprato: 12, clienti: 500 },
      coorti: [{ coorte: '2026-05-01', maturita_giorni: 150, clienti: 80, ricomprato_90gg: 3 }, { coorte: '2026-09-01', maturita_giorni: 40, clienti: 120, ricomprato_90gg: 4 }],
    },
    premia: { fonte: 'Area Membri', aperture: 35, premio_pronto: 12, tap_riscatta: 6, riscatti: 4, ordini_amica12: 2, prev_aperture: 30 as number | null, tap_dal: '2026-10-05' },
    salute: {
      giri: [{ step: 'meta', status: 'ok', ended_at: '2026-10-25T06:13:20Z', rows_written: 33, window_to: '2026-10-25' }, { step: 'ordini', status: 'ok', ended_at: '2026-10-25T06:19:30Z', rows_written: 21, window_to: '2026-10-26' }],
      health: [{ k: 'beh_fresh', label: 'passi accesi: ordini, meta, giri recenti', severity: 'ok', day: '2026-10-25' } as { k: string; label: string; severity: string; day: string },
        { k: 'beh_quota_tracciata', label: 'quota tracciata 28 giorni: 72,4% (670 su 926 ordini online), soglia 60%', severity: 'ok', day: '2026-10-25' }],
    },
  };
}

type Opzioni = {
  flag: 'true' | 'false'; sessione?: boolean; chi?: string;
  /** risposta della RPC per p_days: oggetto, { errore } per un errore PostgREST, ritardo in ms */
  rpc?: (days: number) => { body?: unknown; errore?: { code: string; message: string }; ms?: number };
};

async function apri(page: Page, hash: string, opts: Opzioni) {
  const chiamate: number[] = [];
  const errori: string[] = [];
  page.on('pageerror', (e) => errori.push(e.message));
  await page.addInitScript(({ sessione, chi }) => {
    if (sessione) localStorage.setItem('amimi-cs-auth', sessione);
    if (chi) localStorage.setItem('amimi_chi', chi);
  }, { sessione: opts.sessione ? SESSIONE : null, chi: opts.chi ?? null });
  await page.route(/supabase\.co\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/rest/v1/v_beh_settings')) {
      const riga = { key: 'beh_enabled', value: opts.flag };
      return json((req.headers()['accept'] ?? '').includes('application/vnd.pgrst.object+json') ? riga : [riga]);
    }
    if (url.pathname.endsWith('/rest/v1/rpc/beh_dashboard') && req.method() === 'POST') {
      const days = Number((req.postDataJSON() as { p_days: number }).p_days);
      chiamate.push(days);
      const r = (opts.rpc ?? ((d: number) => ({ body: dash(d) })))(days);
      if (r.ms) await new Promise((ok) => setTimeout(ok, r.ms));
      if (r.errore) return json({ ...r.errore, details: null, hint: null }, 403);
      return json(r.body);
    }
    return json([]);
  });
  await page.goto(hash);
  return { chiamate, errori };
}

const tessera = (page: Page) => page.locator('.ds-qbtn, .ds-mcard', { hasText: 'Comportamento' });
const cardScura = (page: Page) => page.locator('.scr-comportamento .ds-kpi.hero .v');

test('flag spento: nessuna tessera per Ale, nemmeno cercando, e #comportamento dice "non attiva" senza chiamare la RPC', async ({ page }) => {
  const r = await apri(page, '', { flag: 'false', sessione: true, chi: 'Ale' });
  await expect(page.getByText('Cosa vuoi fare?')).toBeVisible();
  await expect(tessera(page)).toHaveCount(0);
  await page.getByLabel('Cerca azione').fill('comportamento');
  await expect(page.getByText('Nessuna azione trovata.')).toBeVisible();
  await page.goto('#comportamento');
  await page.reload();
  await expect(page.getByText('Sezione non attiva (flag beh_enabled spento).')).toBeVisible();
  expect(r.chiamate).toEqual([]);
  expect(r.errori).toEqual([]);
});

test('flag acceso: la tessera c\'e\' solo per Ale (D4), non per Benny ne\' per Ginni', async ({ page }) => {
  await apri(page, '', { flag: 'true', sessione: true, chi: 'Ale' });
  await expect(tessera(page).first()).toBeVisible();
  for (const nome of ['Benny', 'Ginni']) {
    await page.locator('.seg button', { hasText: nome }).click();
    await expect(page.getByRole('heading', { name: new RegExp(`Ciao, ${nome}`) })).toBeVisible();
    await expect(tessera(page)).toHaveCount(0);
  }
});

test('flag acceso senza sessione: la tessera apre la scheda e la scheda chiede il login del team', async ({ page }) => {
  const r = await apri(page, '', { flag: 'true', chi: 'Ale' });
  await tessera(page).first().click();
  await expect(page.getByRole('button', { name: 'Accedi con Google' })).toBeVisible();
  await expect(page.getByText(/Email \(@amimi\.it/)).toBeVisible();
  expect(r.chiamate).toEqual([]);
});

test('flag acceso con sessione: card scura, sorgenti, ads, clienti, Area Membri e salute coi numeri della RPC; 7 giorni rilegge', async ({ page }) => {
  const r = await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale' });
  await expect(cardScura(page)).toHaveText('72,5%');
  await expect(page.getByText('87 su 120, piu\' 2 ancora in attribuzione', { exact: false })).toBeVisible();
  await expect(page.getByText('Nessuna visita registrata (di solito cookie non accettati)')).toBeVisible();
  await expect(page.getByText('il periodo finisce all\'ultimo giorno completo, mai oggi', { exact: false })).toBeVisible();
  await expect(page.locator('.kpi', { hasText: 'Spesa Meta' }).locator('.ds-delta')).toHaveText('+23%');
  await expect(page.getByText('Uscite verso il sito')).toBeVisible();
  // it-IT non raggruppa le 4 cifre (minimumGroupingDigits 2): 2940, come in Premia
  await expect(page.locator('.cmp-flab', { hasText: 'Uscite verso il sito' })).toContainText('2940 · 63,7%');
  await expect(page.locator('.kpi', { hasText: 'Costo per ordine (blended)' })).toContainText('9,88');
  await expect(page.locator('.kpi', { hasText: 'Riacquisto entro 90 giorni' })).toContainText('2,4%');
  await expect(page.getByText('2026-09 (non ancora a 90 giorni)')).toBeVisible();
  await expect(page.locator('.cmp-flab', { hasText: 'Hanno aperto l\'area' })).toContainText('35');
  await expect(page.locator('.cmp-hrow .rt', { hasText: 'Ads Meta (click e pagine caricate)' })).toBeVisible();
  await expect(page.getByText('Passi accesi: Ordini (Shopify), Ads Meta (click e pagine caricate).', { exact: false })).toBeVisible();
  // niente lineette lunghe nel testo (regola di casa) e nessun NaN o undefined a schermo
  const testo = await page.locator('.scr-comportamento').innerText();
  expect(testo).not.toContain(String.fromCharCode(0x2014));
  expect(testo).not.toMatch(/NaN|undefined|Infinity/);
  await page.locator('.seg button', { hasText: '7 giorni' }).click();
  await expect.poll(() => r.chiamate).toEqual([30, 7]);
  await expect(cardScura(page)).toHaveText('72,5%');
  expect(r.errori).toEqual([]);
});

test('cambio di periodo rapido: la risposta lenta dei 30 giorni non copre quella dei 7', async ({ page }) => {
  const r = await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale',
    rpc: (d) => (d === 30 ? { body: dash(30, 60, 120), ms: 1500 } : { body: dash(d) }) });
  await page.locator('.seg button', { hasText: '7 giorni' }).click();
  await expect(cardScura(page)).toHaveText('72,5%');
  await page.waitForTimeout(2000);
  await expect(cardScura(page)).toHaveText('72,5%');
  expect(r.chiamate).toEqual([30, 7]);
});

test('zero ordini nel periodo: niente divisioni per zero a schermo', async ({ page }) => {
  const vuota = () => { const x = dash(7, 0, 0); x.ordini.giorni = []; x.fonti.ultima_visita = {}; x.fonti.ordini_cpa = 0; x.fonti.prev_ordini_cpa = 0; x.clienti.riacquisto_90 = { ricomprato: 0, clienti: 0 }; return x; };
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: vuota() }) });
  await expect(cardScura(page)).toHaveText('n.d.');
  const testo = await page.locator('.scr-comportamento').innerText();
  expect(testo).not.toMatch(/NaN|undefined|Infinity/);
});

test('periodo prima che comincia prima dei dati (prev null): "n.d." al posto delle frecce, mai una percentuale inventata', async ({ page }) => {
  const senzaPrima = () => {
    const x = dash(90); x.fonti.prev_spesa_meta = null; x.fonti.prev_ordini_cpa = null; x.premia.prev_aperture = null;
    (x.ordini as Record<string, unknown>).prev_tutti = null; (x.ordini as Record<string, unknown>).prev_online_pronti = null; (x.ordini as Record<string, unknown>).prev_online_tracciati = null;
    return x;
  };
  const r = await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: senzaPrima() }) });
  await expect(cardScura(page)).toHaveText('72,5%');
  await expect(page.locator('.scr-comportamento .ds-kpi.hero .s')).toContainText('Periodo prima n.d.');
  // la tessera per etichetta esatta: hasText non distingue le maiuscole e "Lordo degli ordini, tutti i canali" la contiene
  const tessKpi = (k: string) => page.locator('.kpi').filter({ has: page.locator('.k', { hasText: new RegExp(`^${k.replace(/[()]/g, '\\$&')}$`) }) });
  for (const k of ['Ordini, tutti i canali', 'Spesa Meta', 'Costo per ordine (blended)']) {
    await expect(tessKpi(k)).toHaveCount(1);
    await expect(tessKpi(k).locator('.ds-delta')).toHaveCount(0);
    await expect(tessKpi(k)).toContainText('n.d.');
  }
  await expect(page.locator('p.note', { hasText: 'Aperture rispetto al periodo prima' })).toContainText('n.d.');
  const testo = await page.locator('.scr-comportamento').innerText();
  expect(testo).not.toMatch(/NaN|undefined|Infinity|null/);
  expect(r.errori).toEqual([]);
});

// verifica avversariale del 25-10 (C1, C3, C4, C9)
test('spesa con giorni mancanti, Meta acceso senza click nel periodo, nessun giorno di spesa: n.d. e il motivo giusto', async ({ page }) => {
  const casi = [
    { nome: 'giorni mancanti', fn: (x: ReturnType<typeof dash>) => { x.fonti.spesa_meta = null; x.fonti.giorni_spesa_mancanti = 2; }, testo: '2 giorni del periodo hanno click Meta ma nessuna riga di spesa' },
    { nome: 'nessun click', fn: (x: ReturnType<typeof dash>) => { x.fonti.ads.dati_al = null; }, testo: 'Nessun click Meta letto nel periodo' },
    { nome: 'nessun giorno di spesa', fn: (x: ReturnType<typeof dash>) => { x.fonti.giorni_spesa = 0; x.fonti.spesa_dal = null; x.fonti.spesa_meta = null; x.fonti.ordini_cpa = 0; }, testo: 'spesa e costo per ordine sono n.d., non zero' },
  ];
  for (const c of casi) {
    const x = dash(30); c.fn(x);
    // stesso indirizzo con hash = navigazione nello stesso documento, che non ricarica: si passa da una pagina vuota
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.goto('about:blank');
    await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: x }) });
    await expect(page.getByText(c.testo, { exact: false }), c.nome).toBeVisible();
    await expect(page.getByText('Il passo Meta del modulo e\' spento'), c.nome).toHaveCount(0);
    if (x.fonti.spesa_meta == null) {
      await expect(page.locator('.kpi').filter({ has: page.locator('.k', { hasText: /^Spesa Meta$/ }) }), c.nome).toContainText('n.d.');
      await expect(page.locator('.kpi').filter({ has: page.locator('.k', { hasText: /^Costo per ordine \(blended\)$/ }) }), c.nome).toContainText('n.d.');
    }
    const testo = await page.locator('.scr-comportamento').innerText();
    expect(testo, c.nome).not.toMatch(/NaN|undefined|Infinity|null|0,00/);
  }
});

test('salute: una riga di ieri e\' datata, un giro del cron fermo da 9 giorni non lascia "Tutto in ordine", un passo spento non conta', async ({ page }) => {
  const x = dash(30);
  x.salute.health = [{ k: 'beh_fresh', label: 'passi accesi: ordini, meta, giri recenti', severity: 'ok', day: '2026-10-24' }];
  x.salute.giri = [{ step: 'ordini', status: 'ok', ended_at: '2026-10-16T06:19:30Z', rows_written: 21, window_to: '2026-10-17' },
    { step: 'crux', status: 'error', ended_at: '2026-10-25T06:30:00Z', rows_written: 0, window_to: '2026-10-25' }];
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: x }) });
  const salute = page.locator('.card', { has: page.locator('h2', { hasText: 'Salute delle fonti' }) });
  await expect(salute).toContainText('(del 24 ott)');
  await expect(salute).toContainText('fermo da piu\' di 48 ore');
  await expect(salute.locator('h2 .ds-pill')).toHaveText('Da tenere d’occhio');
  await expect(salute).not.toContainText('crux');
});

test('Area Membri: stesse definizioni di Premia, non gli stessi numeri; tracciamento dei tap datato', async ({ page }) => {
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale' });
  const nota = page.locator('p.note', { hasText: 'Aperture rispetto al periodo prima' });
  await expect(nota).toContainText('Stesse definizioni della tab Premia');
  await expect(nota).not.toContainText('Stessi numeri della tab Premia');
  await expect(nota).toContainText('attivo dal 05 ott');
});

test('RPC che rifiuta (42501) o che risponde off: messaggio chiaro, nessun numero', async ({ page }) => {
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ errore: { code: '42501', message: 'beh_dashboard: riservato agli account del team' } }) });
  await expect(page.getByText(/Sezione riservata agli account/)).toBeVisible();
  await expect(cardScura(page)).toHaveCount(0);
});

test('RPC che risponde off (flag spento dopo l\'apertura dell\'app): "Sezione non attiva"', async ({ page }) => {
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: { state: 'off' } }) });
  await expect(page.getByText('Sezione non attiva (flag beh_enabled spento).')).toBeVisible();
});
