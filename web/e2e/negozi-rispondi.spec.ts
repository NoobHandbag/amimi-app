import { test, expect, type Page } from '@playwright/test';

// Cruscotto B2B, blocco B (lead-outreach v12, 15-10): "Rispondi" in cima alla timeline per i negozi che ci hanno scritto.
// Origine: il caso Glitter, la risposta ad Agnese non si poteva scrivere dal cruscotto (l'invio c'era solo per le bozze AI
// della sequenza a freddo). Come le altre spec di Negozi NON tocca Supabase: richieste intercettate, dati finti.
// Lanciare dopo `npm run build`:  npx playwright test negozi-rispondi

const ID = '00000000-0000-0000-0000-000000000006';
const base = (o: Record<string, unknown>) => ({
  id: ID, nome: 'Glitter Prova', tipo: 'boutique', citta: 'Ceva', paese: 'IT', stato_ricerca: 'reviewed', totale: 66.7, tier: null, tier_proposto: 'B',
  verdetto: 'da_contattare', verdetto_motivo: null, gancio: null, n_evidenze: 3, n_contatti: 1, thumb: null, follower: null,
  prossima_azione_at: '2026-10-15', owner_outreach: 'Benny', owner_note: null, email_generica: 'negozio@negozio.test', email_sito: null, telefono: null, telefono_maps: null,
  website: null, ig_handle: null, n_opt_out: 0, scaduta: false, da_gestire: true, bozza_auto_tocco: null, ultimo_esito: null, ultimo_chi: 'auto', giorni_da_ultimo: 0,
  ultimo_tocco_at: '2026-10-14T16:33:59Z', ultimo_canale: 'email', ultima_direzione: 'in', prossima_azione: 'rispondere al negozio', lead_stage: 'risposto', n_tocchi: 3, n_email_out: 1, ...o,
});
const tocco = (o: Record<string, unknown>) => ({ account_id: ID, contact_id: null, subject: null, stage_prima: null, stage_dopo: null, esito: null, prossima_azione: null, prossima_azione_at: null, sequenza_tocco: null, chi: null, gmail_message_id: null, gmail_thread_id: null, created_at: '2026-10-14T12:00:00Z', ...o });
const MODULO = tocco({ id: '00000000-0000-0000-0000-0000000000c1', canale: 'altro', direzione: 'in', subject: 'Modulo contatti amimi.it: richiesta', body_clean: 'agnese@negozio.test\nSiamo interessati ai vostri prodotti', gmail_message_id: '1a13a5b6f23cb74a', at: '2026-10-14T12:20:32Z' });
const NOSTRA = tocco({ id: '00000000-0000-0000-0000-0000000000c2', canale: 'email', direzione: 'out', subject: 'Amimì Milano x Glitter Prova', body_clean: 'Buongiorno Agnese', sequenza_tocco: 1, chi: 'Benny', gmail_message_id: '1a13a7a717a150bc', gmail_thread_id: '1a13a7a7135d6642', at: '2026-10-14T12:54:37Z' });
const RISPOSTA = tocco({ id: '00000000-0000-0000-0000-0000000000c3', canale: 'email', direzione: 'in', subject: 'Re: Amimì Milano x Glitter Prova', body_clean: 'agnese@negozio.test\nCiao! Io ci sarei domani', chi: 'auto', gmail_message_id: '1a13b43ad2833f23', gmail_thread_id: '1a13a7a7135d6642', at: '2026-10-14T16:33:59Z' });
const OPT = 'Se preferisce non ricevere altre email da parte mia, mi risponda "no grazie" e non la contatterò più.';
const seq = (n: number) => ({ id: `seq-${n}`, codice: 'boutique_it', tocco: n, canale: 'email', oggetto: `Oggetto ${n}`, corpo: `Gentile {{referente}},\ntesto del tocco ${n}.\n{{firma}}\n${OPT}`, giorni_attesa: n === 1 ? 0 : 5, attiva: true, chi_default: 'Benny' });
const FIRMA = 'Benedetta - Amimì Milano';
const SETTINGS = [{ key: 'lead_outreach_ai_enabled', value: 'true' }, { key: 'lead_enabled', value: 'true' }, { key: 'lead_firma', value: FIRMA }, { key: 'lead_linesheet_url', value: 'https://amimi.it/pages/amimi-trade' }, { key: 'lead_tetto_giornaliero', value: '20' }];

type Chiamata = { action?: string; account_id?: string; to?: string; oggetto?: string; testo?: string; send_key?: string };

async function apri(page: Page, riga: Record<string, unknown>, tocchi: Record<string, unknown>[], opts: { reteGiu?: boolean } = {}): Promise<Chiamata[]> {
  const edge: Chiamata[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('amimi-cs-auth', JSON.stringify({
      access_token: 'finto', refresh_token: 'finto', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '00000000-0000-0000-0000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'prova@amimi.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    }));
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
      // rete giu' sulla prima risposta: la richiesta e' partita, l'esito non si sa
      if (c.action === 'rispondi' && opts.reteGiu && edge.filter((x) => x.action === 'rispondi').length === 1) return route.abort('connectionreset');
      if (c.action === 'rispondi') return json({ ok: true, to: c.to, from: 'wholesale@amimi.it', oggetto: c.oggetto, nel_thread: true, gmail_message_id: 'abcdef0123456789' });
      if (c.action === 'prova') return json({ ok: true, prova: true, to: 'prova@amimi.it', from: 'wholesale@amimi.it', oggetto: '[PROVA] ' + c.oggetto, segnaposto: 0 });
      return json({ error: 'azione non prevista dalla spec' }, 500);
    }
    if (url.pathname.endsWith('/lead_touches')) return json(tocchi);
    if (url.pathname.endsWith('/v_lead_dossier')) return json(Number(url.searchParams.get('offset') ?? 0) > 0 ? [] : [riga]);
    if (url.pathname.endsWith('/v_lead_outreach')) return json([riga]);
    if (url.pathname.endsWith('/lead_sequences')) return json([seq(1), seq(2), seq(3), seq(4)]);
    if (url.pathname.endsWith('/v_lead_settings')) return json(SETTINGS);
    return json([]);
  });
  await page.goto(`#negozi/outreach/${ID}`);
  await expect(page.locator('.or-timeline .or-ev')).toHaveCount(tocchi.length);
  return edge;
}

test.describe('schermo largo 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('chi ci ha scritto: Rispondi preparato nel thread, invio con conferma e chiave nuova per la risposta dopo', async ({ page }) => {
    const edge = await apri(page, base({}), [RISPOSTA, NOSTRA, MODULO]);
    const box = page.locator('.or-rispondi');
    await expect(box).toContainText('Nel thread di');
    await expect(box.getByLabel('Destinatario')).toHaveValue('agnese@negozio.test');
    await expect(box.getByLabel('Oggetto')).toHaveValue('Re: Amimì Milano x Glitter Prova');
    const invia = box.getByRole('button', { name: 'Invia risposta da wholesale@amimi.it' });
    await expect(invia).toBeDisabled();   // solo la firma: non e' ancora una risposta
    await box.getByLabel('Risposta').fill(`Ciao Agnese, ti chiamo domani mattina.\n\n${FIRMA}`);
    page.on('dialog', (d) => d.accept());
    await invia.click();
    await expect(box.locator('.or-esito')).toContainText('Risposta inviata a agnese@negozio.test');
    expect(edge.map((c) => c.action)).toEqual(['rispondi']);
    expect(edge[0]).toMatchObject({ account_id: ID, to: 'agnese@negozio.test', oggetto: 'Re: Amimì Milano x Glitter Prova' });
    expect(edge[0].testo).toContain('ti chiamo domani mattina');
    const primaChiave = edge[0].send_key;
    await box.getByLabel('Risposta').fill(`Seconda risposta.\n\n${FIRMA}`);
    await invia.click();
    await expect.poll(() => edge.length).toBe(2);
    expect(edge[1].send_key).not.toBe(primaChiave);
  });

  test("rete giu' durante la risposta (Gate Fable, A): esito incerto, e il secondo click riusa la STESSA chiave", async({ page }) => {
    const edge = await apri(page, base({}), [RISPOSTA, NOSTRA, MODULO], { reteGiu: true });
    const box = page.locator('.or-rispondi');
    await box.getByLabel('Risposta').fill(`Ciao Agnese, ti chiamo domani.\n\n${FIRMA}`);
    page.on('dialog', (d) => d.accept());
    const invia = box.getByRole('button', { name: 'Invia risposta da wholesale@amimi.it' });
    await invia.click();
    await expect(box.locator('.or-esito .err')).toContainText('Esito incerto');
    await invia.click();
    await expect.poll(() => edge.filter((c) => c.action === 'rispondi').length).toBe(2);
    const [a1, a2] = edge.filter((c) => c.action === 'rispondi');
    expect(a2.send_key).toBe(a1.send_key);
  });

  test('ultimo messaggio = modulo del sito: Rispondi e\' un\'email nuova; la prova manda solo oggetto e testo', async ({ page }) => {
    const edge = await apri(page, base({ n_email_out: 0, n_tocchi: 1 }), [MODULO]);
    const box = page.locator('.or-rispondi');
    await expect(box).toContainText('Email nuova');
    await expect(box.getByLabel('Oggetto')).toHaveValue('Amimì Milano per Glitter Prova');
    await box.getByLabel('Risposta').fill(`Buongiorno, grazie del messaggio.\n\n${FIRMA}`);
    await box.getByRole('button', { name: 'Prova della risposta a me' }).click();
    await expect(box.locator('.or-esito')).toContainText('Prova inviata');
    expect(edge.map((c) => c.action)).toEqual(['prova']);
    expect(Object.keys(edge[0]).sort()).toEqual(['action', 'oggetto', 'testo']);
  });

  test('negozio che non ci ha mai scritto: nessun Rispondi, resta la sequenza a freddo', async ({ page }) => {
    await apri(page, base({ lead_stage: 'contattato', da_gestire: false, ultima_direzione: 'out', n_tocchi: 1 }), [NOSTRA]);
    await expect(page.locator('.or-rispondi')).toHaveCount(0);
    await expect(page.locator('.or-compositore')).toContainText('Compositore');
  });
});
