import { test, expect, type Page } from '@playwright/test';

// Compositore di Negozi B2B, invio di prova (lead-outreach v8, 08-10). Origine: una prova mandata a info@ e' stata
// rifiutata dalla edge (destinatario @amimi.it) e il messaggio, in cima alla scheda, non si vedeva con il bottone
// Invia a schermo: e' sembrata un'email mai arrivata. Come negozi-layout NON tocca Supabase: ogni richiesta verso il
// progetto, edge compresa, e' intercettata e riceve dati finti; la sessione e' un oggetto finto in localStorage.
// Lanciare dopo `npm run build`:  npx playwright test negozi-prova

const ID = '00000000-0000-0000-0000-000000000003';
const NEGOZIO = {
  id: ID, nome: 'Wait and See', tipo: 'boutique', citta: 'Milano', paese: 'IT', stato_ricerca: 'scored', totale: 90, tier: null, tier_proposto: 'A',
  verdetto: 'da_contattare', verdetto_motivo: null, n_evidenze: 12, n_contatti: 1, ig_metrics: { follower: 12000 }, maps: { rating: 4.7, recensioni: 210 },
  price_band: null, brands_carried: { peer_match: [] }, thumb: null, shot_ig: null, shot_home: null, shot_home_mobile: null, gancio: 'Ho visto la vostra selezione di accessori colorati.',
};
const OUTREACH = [{
  ...NEGOZIO, lead_stage: 'contattato', n_tocchi: 1, n_email_out: 1, n_opt_out: 0, scaduta: false, da_gestire: false, bozza_auto_tocco: 2,
  prossima_azione: 'follow-up 2 di 4', prossima_azione_at: '2026-10-08', ultimo_tocco_at: '2026-10-03T11:03:58Z', ultimo_canale: 'email', ultima_direzione: 'out',
  ultimo_chi: 'Ale', ultimo_esito: null, giorni_da_ultimo: 5, owner_outreach: null, email_generica: 'info@negozio.test', email_sito: null, telefono: null, telefono_maps: null,
  website: null, ig_handle: null, follower: 12000,
}];
const OPT = 'Se preferisce non ricevere altre email da parte mia, mi risponda "no grazie" e non la contatterò più.';
const TESTO = `Gentile team di Wait and See,\nvolevo solo assicurarmi che avesse ricevuto la mia email con la line sheet: https://amimi.it/pages/amimi-trade\n\nBenedetta - Amimì Milano\n${OPT}`;
const seq = (tocco: number, oggetto: string) => ({ id: `seq-${tocco}`, codice: 'boutique_it', tocco, canale: 'email', oggetto, corpo: `Gentile {{referente}},\ntesto del tocco ${tocco}.\n{{firma}}\n${OPT}`, giorni_attesa: tocco === 1 ? 0 : 5, attiva: true, chi_default: 'Benny' });
const SEQUENZE = [seq(1, 'Amimì Milano per {{nome_negozio}}'), seq(2, 'Re: Amimì Milano per {{nome_negozio}}'), seq(3, 'Un\'idea per {{nome_negozio}}')];
const BOZZE = [{ id: '00000000-0000-0000-0000-0000000000d2', account_id: ID, lingua: 'it', oggetto: 'Re: Amimì Milano per Wait and See', testo: TESTO, to_email: null, sequenza_tocco: 2, stato: 'proposta', chi: 'auto', sent_by: null, sent_at: null, errore: null, created_at: '2026-10-07T22:20:23Z', fatti_usati: { avvisi: [] }, origine: 'auto' }];
const SETTINGS = [{ key: 'lead_outreach_ai_enabled', value: 'true' }, { key: 'lead_enabled', value: 'true' }, { key: 'lead_firma', value: 'Benedetta - Amimì Milano' }, { key: 'lead_linesheet_url', value: 'https://amimi.it/pages/amimi-trade' }, { key: 'lead_tetto_giornaliero', value: '20' }];
const RIFIUTO = 'Invio bloccato: il destinatario e\' un indirizzo @amimi.it';

// chiamate arrivate alla edge finta, per controllare COSA manda il compositore
type Chiamata = { action?: string; to?: string; oggetto?: string; testo?: string; [k: string]: unknown };

async function apri(page: Page, opts: { lento?: boolean } = {}): Promise<Chiamata[]> {
  const chiamate: Chiamata[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('amimi-cs-auth', JSON.stringify({
      access_token: 'finto', refresh_token: 'finto', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '00000000-0000-0000-0000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'prova@amimi.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    }));
  });
  await page.route(/supabase\.co\//, async (route) => {
    const url = new URL(route.request().url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.endsWith('/functions/v1/lead-outreach')) {
      const c = (route.request().postDataJSON() ?? {}) as Chiamata;
      chiamate.push(c);
      if (opts.lento) await new Promise((r) => setTimeout(r, 1500));
      if (c.action === 'prova') return json({ ok: true, prova: true, to: 'prova@amimi.it', from: 'wholesale@amimi.it', oggetto: '[PROVA] ' + c.oggetto, segnaposto: 0 });
      if (c.action === 'send') return json({ error: RIFIUTO, bloccante: true }, 422);
      return json({ error: 'azione non prevista dalla spec' }, 500);
    }
    if (url.pathname.endsWith('/v_lead_dossier')) return json(Number(url.searchParams.get('offset') ?? 0) > 0 ? [] : [NEGOZIO]);
    if (url.pathname.endsWith('/v_lead_outreach')) return json(OUTREACH);
    if (url.pathname.endsWith('/lead_sequences')) return json(SEQUENZE);
    if (url.pathname.endsWith('/v_lead_settings')) return json(SETTINGS);
    if (url.pathname.endsWith('/lead_drafts')) return json(BOZZE);
    return json([]);
  });
  await page.goto(`#negozi/outreach/${ID}`);
  // la scheda apre da sola il follow-up scritto dal giro automatico: il compositore parte gia' dalla bozza
  await expect(page.locator('.or-compositore textarea')).toHaveValue(TESTO);
  return chiamate;
}

test.describe('schermo largo 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('prova: parte con solo oggetto e testo, e l\'esito compare in fondo al compositore, a schermo', async ({ page }) => {
    const chiamate = await apri(page);
    const prova = page.getByRole('button', { name: 'Manda una prova a me' });
    await prova.scrollIntoViewIfNeeded();
    await prova.click();
    const esito = page.locator('.or-compositore .or-esito .note');
    await expect(esito).toContainText('Prova inviata a prova@amimi.it da wholesale@amimi.it');
    await expect(esito).toContainText('Non conta come invio');
    await expect(esito).toBeInViewport();
    expect(chiamate).toHaveLength(1);
    expect(Object.keys(chiamate[0]).sort()).toEqual(['action', 'oggetto', 'testo']);   // mai un destinatario dal client
    expect(chiamate[0].action).toBe('prova');
    expect(chiamate[0].testo).toBe(TESTO);
    // la bozza e' ancora aperta e inviabile: la prova non l'ha consumata
    await expect(page.getByRole('button', { name: 'Invia da wholesale@amimi.it' })).toBeEnabled();
  });

  test('durante la prova il bottone Invia non dice "Invio…" e non si puo\' premere', async ({ page }) => {
    await apri(page, { lento: true });
    await page.getByRole('button', { name: 'Manda una prova a me' }).click();
    await expect(page.getByRole('button', { name: 'Mando la prova…' })).toBeDisabled();
    const invia = page.getByRole('button', { name: 'Invia da wholesale@amimi.it' });
    await expect(invia).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Invio…' })).toHaveCount(0);
    await expect(page.locator('.or-compositore .or-esito .note')).toContainText('Prova inviata');
    await expect(invia).toBeEnabled();
  });

  test('destinatario @amimi.it: Invia fermo, e la nota dice di usare la prova', async ({ page }) => {
    const chiamate = await apri(page);
    await page.getByLabel('Destinatario').fill('info@amimi.it');
    await expect(page.getByRole('button', { name: 'Invia da wholesale@amimi.it' })).toBeDisabled();
    await expect(page.locator('.or-compositore .or-ai .note', { hasText: 'Gli indirizzi @amimi.it non ricevono' })).toContainText('Manda una prova a me');
    expect(chiamate).toHaveLength(0);
  });

  test('invio rifiutato dalla edge: l\'errore e\' rosso, accanto al bottone e a schermo, non in cima alla scheda', async ({ page }) => {
    const chiamate = await apri(page);
    page.on('dialog', (d) => d.accept());
    const invia = page.getByRole('button', { name: 'Invia da wholesale@amimi.it' });
    await invia.scrollIntoViewIfNeeded();
    await invia.click();
    const errore = page.locator('.or-compositore .or-esito .err');
    await expect(errore).toHaveText(RIFIUTO);
    await expect(errore).toBeInViewport();
    await expect(invia).toBeInViewport();                               // bottone ed esito nella stessa schermata
    await expect(page.getByText(RIFIUTO)).toHaveCount(1);               // una volta sola, dentro il compositore
    expect(chiamate.map((c) => c.action)).toEqual(['send']);
    expect(chiamate[0].to).toBe('info@negozio.test');
    // cambiare tocco toglie l'esito della bozza di prima
    await page.getByLabel('Tocco').selectOption('3');
    await expect(page.locator('.or-compositore .or-esito .err')).toHaveCount(0);
  });
});
