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
      spesa_dal: giorni[0].day as string | null, spesa_al: '2026-10-24' as string | null, giorni_spesa: days, giorni_spesa_mancanti: 0, giorni_spesa_mancanti_salute: 0,
      ultimo_giorno_spesa_mancante: null as string | null, giorni_spesa_mancanti_prima: 0, giorni_click_mancanti: 0, ultimo_giorno_click_mancante: null as string | null,
      click_mancanti_recenti: 0, click_mancanti_salute: 0, click_mancanti_vecchi: 0,
      spesa_meta: 1234.56 as number | null, ordini_cpa: 125, prev_spesa_meta: 1000 as number | null, prev_ordini_cpa: 100 as number | null,
      ads: { link_clicks: 4613, outbound_clicks: 2940, landing_page_views: 2180, dati_al: '2026-10-24' as string | null },
    },
    clienti: {
      fonte: 'Supabase', clienti: 888, con_2_ordini: 61, riacquisto_90: { ricomprato: 12, clienti: 500 },
      coorti: [{ coorte: '2026-05-01', maturita_giorni: 150, clienti: 80, ricomprato_90gg: 3 }, { coorte: '2026-09-01', maturita_giorni: 40, clienti: 120, ricomprato_90gg: 4 }],
    },
    premia: { fonte: 'Area Membri', aperture: 35, premio_pronto: 12, tap_riscatta: 6, riscatti: 4, ordini_amica12: 2, prev_aperture: 30 as number | null, tap_dal: '2026-10-05' },
    salute: {
      giri: [{ step: 'meta', status: 'ok', ended_at: '2026-10-25T06:13:20Z', rows_written: 33, window_to: '2026-10-25', soglia_ore: 48 }, { step: 'ordini', status: 'ok', ended_at: '2026-10-25T06:19:30Z', rows_written: 21, window_to: '2026-10-26', soglia_ore: 48 }],
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
    { nome: 'giorni mancanti recenti', fn: (x: ReturnType<typeof dash>) => { x.fonti.spesa_meta = null; x.fonti.giorni_spesa_mancanti = 2; x.fonti.giorni_spesa_mancanti_salute = 2; x.fonti.ultimo_giorno_spesa_mancante = '2026-10-20'; },
      testo: "2 giorni del periodo non hanno nessuna riga di spesa (l'ultimo il 20 ott)", anche: 'per quei giorni: li elenca anche "Giorni mancanti" in Salute' },
    // quinto giro: la frase su Salute viene dal conteggio del server, non dal solo giorno piu' recente
    { nome: 'giorni mancanti misti', fn: (x: ReturnType<typeof dash>) => { x.fonti.spesa_meta = null; x.fonti.giorni_spesa_mancanti = 3; x.fonti.giorni_spesa_mancanti_salute = 1; x.fonti.ultimo_giorno_spesa_mancante = '2026-10-20'; },
      testo: '3 giorni del periodo non hanno nessuna riga di spesa', anche: 'per quei giorni: di questi uno lo elenca anche "Giorni mancanti" in Salute' },
    { nome: 'giorno mancante vecchio', fn: (x: ReturnType<typeof dash>) => { x.fonti.spesa_meta = null; x.fonti.giorni_spesa_mancanti = 1; x.fonti.ultimo_giorno_spesa_mancante = '2026-08-01'; },
      testo: "non ha nessuna riga di spesa: ads-sync non l'ha letto, o le ads erano tutte ferme. Se erano attive serve un recupero di ads-sync per quel giorno.", senza: 'Giorni mancanti' },
    { nome: 'giorno mancante in Salute', fn: (x: ReturnType<typeof dash>) => { x.fonti.spesa_meta = null; x.fonti.giorni_spesa_mancanti = 1; x.fonti.giorni_spesa_mancanti_salute = 1; x.fonti.ultimo_giorno_spesa_mancante = '2026-10-20'; },
      testo: 'Spesa n.d.: 1 giorno del periodo (il 20 ott) non ha nessuna riga di spesa', anche: 'per quel giorno: lo elenca anche "Giorni mancanti" in Salute', senza: "l'ultimo" },
    { nome: 'solo il periodo prima', fn: (x: ReturnType<typeof dash>) => { x.fonti.prev_spesa_meta = null; x.fonti.prev_ordini_cpa = null; x.fonti.giorni_spesa_mancanti_prima = 2; },
      testo: 'Confronto n.d.: nel periodo prima 2 giorni non hanno righe di spesa' },
    { nome: 'click parziali recenti', fn: (x: ReturnType<typeof dash>) => { x.fonti.giorni_click_mancanti = 3; x.fonti.click_mancanti_recenti = 3; x.fonti.ultimo_giorno_click_mancante = '2026-10-23'; },
      testo: "Click parziali: 3 giorni del periodo non sono stati letti dal giro Meta (l'ultimo il 23 ott)", anche: "Sono nella finestra del cron (ultimi 7 giorni): il prossimo giro del cron li rilegge; se restano mancanti li elenchera'", senza: 'fuori dalla finestra' },
    { nome: 'click parziali in Salute', fn: (x: ReturnType<typeof dash>) => { x.fonti.giorni_click_mancanti = 1; x.fonti.click_mancanti_salute = 1; x.fonti.ultimo_giorno_click_mancante = '2026-10-10'; },
      testo: 'Click parziali: 1 giorno del periodo (il 10 ott) non e\' stato letto dal giro Meta', anche: ['E\' fuori dalla finestra del cron, ma degli ultimi 35 giorni: lo elenca "Giorni mancanti" in Salute.', 'Uscite verso il sito (parziali)'], senza: 'rilegge' },
    { nome: 'click parziali vecchi', fn: (x: ReturnType<typeof dash>) => { x.fonti.giorni_click_mancanti = 2; x.fonti.click_mancanti_vecchi = 2; x.fonti.ultimo_giorno_click_mancante = '2026-09-01'; },
      testo: '2 giorni del periodo non sono stati letti', anche: "Sono di piu' di 35 giorni fa: nessun giro li rilegge piu' e Salute non li elenca: serve un backfill di beh-sync per quei giorni.", senza: 'Giorni mancanti' },
    { nome: 'click parziali misti', fn: (x: ReturnType<typeof dash>) => { Object.assign(x.fonti, { giorni_click_mancanti: 4, click_mancanti_recenti: 1, click_mancanti_salute: 2, click_mancanti_vecchi: 1, ultimo_giorno_click_mancante: '2026-10-20' }); },
      testo: '4 giorni del periodo non sono stati letti', anche: ["Uno e' nella finestra del cron (ultimi 7 giorni): il prossimo giro del cron lo rilegge; se resta mancante lo elenchera'",
        '2 sono fuori dalla finestra del cron, ma degli ultimi 35 giorni: li elenca "Giorni mancanti" in Salute.', "Uno e' di piu' di 35 giorni fa: nessun giro lo rilegge piu' e Salute non lo elenca: serve un backfill di beh-sync per quel giorno."] },
    // igiene del quinto giro: oltre l'ultima riga di spesa la finestra conta solo giorni senza consegna letti, e lo dice
    { nome: 'pausa in coda', fn: (x: ReturnType<typeof dash>) => { x.fonti.meta_dati_al = '2026-10-22'; x.fonti.spesa_al = '2026-10-24'; },
      testo: "righe per annuncio fino al 22 ott; dal 23 ott al 24 ott il giro Meta non ha trovato consegne, quindi spesa 0" },
    { nome: 'periodo tutto senza consegne', fn: (x: ReturnType<typeof dash>) => { x.fonti.meta_dati_al = '2026-10-10'; x.fonti.spesa_dal = '2026-10-18'; x.fonti.giorni_spesa = 7; x.fonti.spesa_al = '2026-10-24'; },
      testo: "7 giorni dal 18 ott al 24 ott gia' coperti dalla spesa (righe per annuncio fino al 10 ott; dal 18 ott al 24 ott il giro Meta" },
    { nome: 'nessun click', fn: (x: ReturnType<typeof dash>) => { x.fonti.ads.dati_al = null; }, testo: 'Nessun click Meta letto nel periodo' },
    { nome: 'nessun giorno di spesa', fn: (x: ReturnType<typeof dash>) => { x.fonti.giorni_spesa = 0; x.fonti.spesa_dal = null; x.fonti.spesa_al = null; x.fonti.spesa_meta = null; x.fonti.ordini_cpa = 0; },
      testo: "Nessun giorno del periodo e' coperto dalla spesa per annuncio (righe fino al 24 ott): spesa e costo per ordine sono n.d., non zero" },
    // sesto giro: finestra vuota per il primo giorno del periodo non coperto, contato mancante dal server
    { nome: 'primo giorno non coperto', fn: (x: ReturnType<typeof dash>) => { Object.assign(x.fonti, { giorni_spesa: 0, spesa_dal: null, spesa_al: null, spesa_meta: null, ordini_cpa: 0,
        meta_dati_al: '2026-07-01', giorni_spesa_mancanti: 1, ultimo_giorno_spesa_mancante: '2026-10-18', giorni_spesa_mancanti_salute: 1 }); },
      testo: 'Spesa n.d.: 1 giorno del periodo (il 18 ott) non ha nessuna riga di spesa', anche: ['per quel giorno: lo elenca anche "Giorni mancanti" in Salute', "Nessun giorno del periodo e' coperto dalla spesa per annuncio (righe fino al 01 lug)"] },
  ];
  for (const c of casi) {
    const x = dash(30); c.fn(x);
    // stesso indirizzo con hash = navigazione nello stesso documento, che non ricarica: si passa da una pagina vuota
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.goto('about:blank');
    await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: x }) });
    await expect(page.getByText(c.testo, { exact: false }), c.nome).toBeVisible();
    const cc = c as { anche?: string | string[]; senza?: string };
    for (const a of ([] as string[]).concat(cc.anche ?? [])) await expect(page.getByText(a, { exact: false }).first(), c.nome).toBeVisible();
    if (cc.senza) await expect(page.locator('p.note.warn', { hasText: c.testo }), c.nome).not.toContainText(cc.senza);
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
  x.salute.giri = [{ step: 'ordini', status: 'ok', ended_at: '2026-10-16T06:19:30Z', rows_written: 21, window_to: '2026-10-17', soglia_ore: 48 },
    { step: 'crux', status: 'error', ended_at: '2026-10-25T06:30:00Z', rows_written: 0, window_to: '2026-10-25', soglia_ore: 192 }];
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: x }) });
  const salute = page.locator('.card', { has: page.locator('h2', { hasText: 'Salute delle fonti' }) });
  await expect(salute).toContainText('(del 24 ott)');
  await expect(salute).toContainText('fermo da piu\' di 48 ore');
  await expect(salute.locator('h2 .ds-pill')).toHaveText('Da tenere d’occhio');
  await expect(salute).not.toContainText('crux');
});

test('salute: soglia del giro fermo sul confine (30 ore no, 49 ore si) e righe di un passo spento nascoste', async ({ page }) => {
  // generated_at del finto = 25-10 22:00 UTC
  const conGiro = (ended: string) => { const x = dash(30); x.salute.giri = [{ step: 'ordini', status: 'ok', ended_at: ended, rows_written: 5, window_to: '2026-10-26', soglia_ore: 48 }]; return x; };
  const salute = () => page.locator('.card', { has: page.locator('h2', { hasText: 'Salute delle fonti' }) });
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: conGiro('2026-10-24T16:00:00Z') }) });
  await expect(salute().locator('h2 .ds-pill')).toHaveText('Tutto in ordine');
  await expect(salute()).not.toContainText('fermo da');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('about:blank');
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: conGiro('2026-10-23T21:00:00Z') }) });
  await expect(salute()).toContainText("fermo da piu' di 48 ore");
  await expect(salute().locator('h2 .ds-pill')).toHaveText('Da tenere d’occhio');
  // la soglia la decide il server (soglia_ore): 24 ore a 30 ore = fermo, 72 ore a 49 ore = non fermo (terzo giro del 26-10)
  const conSoglia = (ended: string, soglia: number) => { const x = conGiro(ended); x.salute.giri[0].soglia_ore = soglia; return x; };
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('about:blank');
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: conSoglia('2026-10-24T16:00:00Z', 24) }) });
  await expect(salute()).toContainText("fermo da piu' di 24 ore");
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('about:blank');
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: conSoglia('2026-10-23T21:00:00Z', 72) }) });
  await expect(salute()).not.toContainText('fermo da');
  await expect(salute().locator('h2 .ds-pill')).toHaveText('Tutto in ordine');
  // soglia di 84 ore a 90 ore: "piu' di 3 giorni", per difetto (non 4)
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('about:blank');
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: conSoglia('2026-10-25T04:00:00Z', 84) }) });
  await expect(salute()).not.toContainText('fermo da');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('about:blank');
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: conSoglia('2026-10-22T04:00:00Z', 84) }) });
  await expect(salute()).toContainText("fermo da piu' di 3 giorni");
  // passo meta spento: la sua riga di errore e il suo giro non contano
  const x = dash(30); x.steps = ['ordini'];
  x.salute.health = [{ k: 'beh_meta', label: 'beh-sync FERMATO (meta): token', severity: 'error', day: '2026-10-25' }];
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('about:blank');
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale', rpc: () => ({ body: x }) });
  await expect(salute()).not.toContainText('FERMATO');
  await expect(salute().locator('h2 .ds-pill')).toHaveText('Tutto in ordine');
});

test('Area Membri: stesse definizioni di Premia, non gli stessi numeri; tracciamento dei tap datato', async ({ page }) => {
  await apri(page, '#comportamento', { flag: 'true', sessione: true, chi: 'Ale' });
  const nota = page.locator('p.note', { hasText: 'Aperture rispetto al periodo prima' });
  await expect(nota).toContainText('Stesse definizioni della tab Premia');
  await expect(nota).not.toContainText('Stessi numeri della tab Premia');
  await expect(nota).toContainText('dati dal 05 ott');
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
