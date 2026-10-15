import { test, expect, type Page } from '@playwright/test';

// Cruscotto B2B, blocco C (lead-outreach v13, migr 0158, 15-10): in cima alla Coda i messaggi di Assistenza che possono
// essere un negozio ("Collega a", "Crea negozio", "Non e' un negozio") e "Nuovo negozio" per un ingresso da Instagram,
// telefono, visita o fiera. Come le altre spec di Negozi NON tocca Supabase: richieste intercettate, dati finti.
// Lanciare dopo `npm run build`:  npx playwright test negozi-inbound

const CONV = '00000000-0000-0000-0000-0000000000e1';
const ACC = '00000000-0000-0000-0000-0000000000a7';
const NUOVO = '00000000-0000-0000-0000-0000000000a8';
const INBOUND = [{
  conv_id: CONV, customer_email: 'buyer@boutiquebella.test', customer_name: 'Sara di Boutique Bella', subject: 'Nuovo messaggio cliente del giorno 15 ottobre 2026',
  snippet: 'Buongiorno, abbiamo un negozio a Bergamo e vorremmo il vostro listino', last_msg_at: '2026-10-15T09:00:00Z', gmail_thread_id: 'th1',
  da_modulo: true, a_wholesale: false, n_in: 1, candidati: [{ id: ACC, nome: 'Boutique Bella', citta: 'Bergamo', lead_stage: 'da_contattare', via: 'dominio' }],
}];
const SETTINGS = [{ key: 'lead_outreach_ai_enabled', value: 'true' }, { key: 'lead_enabled', value: 'true' }, { key: 'lead_firma', value: 'Benedetta - Amimì Milano' }, { key: 'lead_tetto_giornaliero', value: '20' }];

type Chiamata = { action?: string; conv_id?: string; account_id?: string; nome?: string; canale?: string; forza?: boolean; email?: string };

async function apri(page: Page): Promise<Chiamata[]> {
  const edge: Chiamata[] = [];
  let inbound = [...INBOUND];
  await page.addInitScript(() => {
    localStorage.setItem('amimi-cs-auth', JSON.stringify({
      access_token: 'finto', refresh_token: 'finto', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '00000000-0000-0000-0000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'prova@amimi.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    }));
    window.confirm = () => true;
  });
  await page.route(/supabase\.co\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.endsWith('/functions/v1/lead-outreach')) {
      const c = (req.postDataJSON() ?? {}) as Chiamata;
      edge.push(c);
      if (c.action === 'inbound_collega') { inbound = []; return json({ ok: true, account_id: c.account_id, tocchi: 1, contatto: true }); }
      if (c.action === 'inbound_scarta') { inbound = []; return json({ ok: true, scartato: c.conv_id }); }
      if (c.action === 'nuovo_negozio' && !c.forza) return json({ error: 'Esiste gia\' un negozio che puo\' essere lo stesso: controlla prima di crearne uno nuovo', bloccante: true, duplicati: [{ id: ACC, nome: 'Boutique Bella', citta: 'Bergamo', via: "nome e citta'" }] }, 409);
      if (c.action === 'nuovo_negozio') return json({ ok: true, account_id: NUOVO });
      return json({ error: 'azione non prevista dalla spec' }, 500);
    }
    if (url.pathname.endsWith('/v_lead_inbound')) return req.method() === 'HEAD' ? route.fulfill({ status: 200, headers: { ...cors, 'content-range': `0-0/${inbound.length}` } }) : json(inbound);
    if (url.pathname.endsWith('/v_lead_lista') || url.pathname.endsWith('/v_lead_dossier')) return json([]);
    if (url.pathname.endsWith('/v_lead_outreach')) return json([]);
    if (url.pathname.endsWith('/v_lead_settings')) return json(SETTINGS);
    return json([]);
  });
  await page.goto('#negozi/outreach/coda');
  await expect(page.getByRole('heading', { name: /Messaggi da collegare/ })).toBeVisible();
  return edge;
}

test.describe('schermo largo 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('un messaggio con un negozio candidato: "Collega a" porta i messaggi su quel negozio e il messaggio esce dalla lista', async ({ page }) => {
    const edge = await apri(page);
    await expect(page.locator('.or-inbound')).toContainText('Sara di Boutique Bella');
    await expect(page.locator('.or-inbound')).toContainText('modulo del sito');
    await page.getByRole('button', { name: 'Collega a Boutique Bella (Bergamo)' }).click();
    await expect.poll(() => edge.map((c) => c.action)).toEqual(['inbound_collega']);
    expect(edge[0]).toMatchObject({ conv_id: CONV, account_id: ACC });
  });

  test('"Non e\' un negozio" toglie il messaggio dalla lista dopo la conferma', async ({ page }) => {
    const edge = await apri(page);
    await page.getByRole('button', { name: 'Non è un negozio' }).click();
    await expect(page.getByText('Tolto dalla lista')).toBeVisible();
    expect(edge.map((c) => c.action)).toEqual(['inbound_scarta']);
    await expect(page.getByText('Nessun messaggio da collegare.')).toBeVisible();
  });

  test('"Nuovo negozio": se ne esiste uno uguale lo mostra, e solo dopo si puo\' creare comunque', async ({ page }) => {
    const edge = await apri(page);
    await page.getByRole('button', { name: 'Nuovo negozio' }).click();
    const form = page.locator('.or-inbound-form');
    await form.getByLabel('Nome del negozio').fill('Boutique Bella');
    await form.getByLabel('Città').fill('Bergamo');
    await form.getByLabel('Come ci ha contattato').selectOption('telefono');
    await form.getByRole('button', { name: 'Crea negozio' }).click();
    await expect(form).toContainText('Potrebbe essere già qui');
    await expect(form).toContainText('stesso nome e città');
    expect(edge[0]).toMatchObject({ action: 'nuovo_negozio', nome: 'Boutique Bella', canale: 'telefono', forza: false });
    await form.getByRole('button', { name: 'Crea comunque un negozio nuovo' }).click();
    await expect.poll(() => edge.length).toBe(2);
    expect(edge[1]).toMatchObject({ action: 'nuovo_negozio', forza: true });
  });
});
