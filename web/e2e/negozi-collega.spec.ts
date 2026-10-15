import { test, expect, type Page } from '@playwright/test';

// Cruscotto B2B, blocco A (lead-outreach v11, 15-10). Origine: il caso Glitter, un'email mandata da Gmail e registrata con
// "Segna come inviata" restava senza thread, la risposta del negozio non entrava in conversazione e la prossima azione
// diceva "follow-up 2 di 4" a un negozio che ci aveva scritto lui. Dal 15-10 (v15) la scheda e' una colonna con le bolle
// della conversazione e un compositore solo: "Segna come inviata" sta nel modo "Sequenza a freddo". Come negozi-prova NON
// tocca Supabase: ogni richiesta verso il progetto, edge compresa, e' intercettata e riceve dati finti; la sessione e' un
// oggetto finto in localStorage.
// Lanciare dopo `npm run build`:  npx playwright test negozi-collega

const ID = '00000000-0000-0000-0000-000000000005';
const T_OUT = '00000000-0000-0000-0000-0000000000b1';
const NUOVO = '00000000-0000-0000-0000-0000000000b9';
const base = (o: Record<string, unknown>) => ({
  id: ID, nome: 'Glitter Prova', tipo: 'boutique', citta: 'Ceva', paese: 'IT', stato_ricerca: 'reviewed', totale: 66.7, tier: null, tier_proposto: 'B',
  verdetto: 'da_contattare', verdetto_motivo: null, gancio: null, n_evidenze: 3, n_contatti: 1, thumb: null, img: null, follower: null,
  prossima_azione_at: null, owner_outreach: 'Benny', owner_note: null, email_generica: 'agnese@negozio.test', email_sito: null, telefono: null, telefono_maps: null,
  website: null, ig_handle: null, n_opt_out: 0, scaduta: false, da_gestire: false, bozza_auto_tocco: null, ultimo_esito: null, ultimo_chi: 'Benny', giorni_da_ultimo: 1,
  ultimo_tocco_at: '2026-10-14T12:54:37Z', ultimo_canale: 'email', ultima_direzione: 'out', ...o,
});
const tocco = (o: Record<string, unknown>) => ({ account_id: ID, contact_id: null, subject: null, stage_prima: null, stage_dopo: null, esito: null, prossima_azione: null, prossima_azione_at: null, sequenza_tocco: null, chi: null, gmail_message_id: null, gmail_thread_id: null, created_at: '2026-10-14T12:54:37Z', ...o });
// negozio che ci ha scritto dal modulo (tocco in) e a cui Benny ha risposto da Gmail (tocco out senza thread)
const SCRITTO = {
  riga: base({ lead_stage: 'risposto', n_tocchi: 2, n_email_out: 1, prossima_azione: 'follow-up 2 di 4' }),
  tocchi: [
    tocco({ id: T_OUT, canale: 'email', direzione: 'out', subject: 'Amimì Milano x Glitter Prova', body_clean: 'Buongiorno Agnese, possiamo sentirci?', sequenza_tocco: 1, chi: 'Benny', at: '2026-10-14T12:54:37Z' }),
    tocco({ id: '00000000-0000-0000-0000-0000000000a1', canale: 'altro', direzione: 'in', subject: 'Modulo contatti amimi.it', body_clean: 'Siamo interessati ai vostri prodotti', gmail_message_id: '1a13a5b6f23cb74a', at: '2026-10-14T12:20:32Z' }),
  ],
};
// negozio a freddo: solo la nostra prima email, nessuna risposta
const FREDDO = {
  riga: base({ lead_stage: 'contattato', n_tocchi: 1, n_email_out: 1, prossima_azione: 'follow-up 2 di 4', prossima_azione_at: '2026-10-19' }),
  tocchi: [tocco({ id: T_OUT, canale: 'email', direzione: 'out', subject: 'Amimì Milano per Glitter Prova', body_clean: 'Gentile team', sequenza_tocco: 1, chi: 'Benny', at: '2026-10-14T12:54:37Z', gmail_message_id: '1a13a7a717a150bc', gmail_thread_id: '1a13a7a7135d6642' })],
};
const OPT = 'Se preferisce non ricevere altre email da parte mia, mi risponda "no grazie" e non la contatterò più.';
const seq = (n: number) => ({ id: `seq-${n}`, codice: 'boutique_it', tocco: n, canale: 'email', oggetto: `Oggetto ${n}`, corpo: `Gentile {{referente}},\ntesto del tocco ${n}.\n{{firma}}\n${OPT}`, giorni_attesa: n === 1 ? 0 : 5, attiva: true, chi_default: 'Benny' });
const SETTINGS = [{ key: 'lead_outreach_ai_enabled', value: 'true' }, { key: 'lead_risposta_ai_enabled', value: 'true' }, { key: 'lead_enabled', value: 'true' }, { key: 'lead_firma', value: 'Benedetta - Amimì Milano' }, { key: 'lead_linesheet_url', value: 'https://amimi.it/pages/amimi-trade' }, { key: 'lead_tetto_giornaliero', value: '20' }];
const CANDIDATO = { gmail_message_id: '1a13a7a717a150bc', oggetto: 'Amimì Milano x Glitter Prova', data: '2026-10-14T12:54:24Z', a: 'agnese@negozio.test' };

type Chiamata = { action?: string; touch_id?: string; gmail_message_id?: string; chi?: string };
type Scenario = { riga: Record<string, unknown>; tocchi: Record<string, unknown>[] };

async function apri(page: Page, sc: Scenario): Promise<{ edge: Chiamata[]; inserti: Record<string, unknown>[] }> {
  const edge: Chiamata[] = [];
  const inserti: Record<string, unknown>[] = [];
  const tocchi = [...sc.tocchi];
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
      if (c.action === 'cerca_inviate') return json({ ok: true, candidati: [CANDIDATO], esclusi: 0 });
      if (c.action === 'aggancia') return json({ ok: true, touch_id: c.touch_id, gmail_message_id: c.gmail_message_id, gmail_thread_id: '1a13a7a7135d6642' });
      return json({ error: 'azione non prevista dalla spec' }, 500);
    }
    if (url.pathname.endsWith('/lead_touches')) {
      if (req.method() === 'POST') {
        const row = req.postDataJSON() as Record<string, unknown>;
        inserti.push(row);
        tocchi.unshift({ ...tocco({}), ...row, id: NUOVO, at: new Date().toISOString() });
        return json({ id: NUOVO }, 201);
      }
      return json(tocchi);
    }
    if (url.pathname.endsWith('/v_lead_lista') || url.pathname.endsWith('/v_lead_dossier')) return json(Number(url.searchParams.get('offset') ?? 0) > 0 ? [] : [sc.riga]);
    if (url.pathname.endsWith('/v_lead_outreach')) return json([sc.riga]);
    if (url.pathname.endsWith('/lead_sequences')) return json([seq(1), seq(2), seq(3), seq(4)]);
    if (url.pathname.endsWith('/v_lead_settings')) return json(SETTINGS);
    return json([]);
  });
  await page.goto(`#negozi/outreach/${ID}`);
  await expect(page.locator('.or-conv > *')).toHaveCount(sc.tocchi.length);
  await expect(page.locator('.or-comp .cs-seg .cs-seg-btn.on')).toHaveCount(1);
  return { edge, inserti };
}

test.describe('schermo largo 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Collega a Gmail: propone le email di Posta inviata e aggancia SOLO quella scelta con un click', async ({ page }) => {
    const { edge } = await apri(page, SCRITTO);
    // il bottone sta nella bolla della nostra email senza thread
    await page.locator('.cs-msg.out').getByRole('button', { name: 'Collega a Gmail' }).click();
    await expect(page.locator('.or-collega')).toContainText('Amimì Milano x Glitter Prova');
    expect(edge.map((c) => c.action)).toEqual(['cerca_inviate']);   // nessun aggancio senza scelta
    expect(edge[0].touch_id).toBe(T_OUT);
    await page.locator('.or-collega').getByRole('button', { name: 'Collega', exact: true }).click();
    await expect(page.getByText('Email collegata')).toBeVisible();
    expect(edge.map((c) => c.action)).toEqual(['cerca_inviate', 'aggancia']);
    expect(edge[1]).toMatchObject({ touch_id: T_OUT, gmail_message_id: CANDIDATO.gmail_message_id });
  });

  test('negozio che ci ha scritto: parte in Rispondi; forzando la sequenza, "Segna come inviata" non registra un follow-up a freddo e apre subito la scelta dell\'email', async ({ page }) => {
    const { edge, inserti } = await apri(page, SCRITTO);
    const comp = page.locator('.or-comp');
    await expect(comp.locator('.cs-seg-btn.on')).toHaveText('Rispondi');
    await comp.getByRole('button', { name: 'Sequenza a freddo' }).click();
    await expect(comp.locator('.cs-note', { hasText: 'Questo negozio ci ha già scritto' })).toBeVisible();
    await comp.getByRole('button', { name: 'Segna come inviata' }).click();
    await expect(comp.locator('.or-esito')).toContainText('niente sequenza a freddo');
    expect(inserti).toHaveLength(1);
    expect(inserti[0]).toMatchObject({ canale: 'email', direzione: 'out', sequenza_tocco: null, prossima_azione: 'attesa risposta del negozio' });
    // il tocco nuovo e' in conversazione (3 elementi) e sotto di lui la scelta dell'email
    await expect(page.locator('.or-conv > *')).toHaveCount(3);
    await expect(page.locator('.or-collega')).toContainText('Amimì Milano x Glitter Prova');
    expect(edge.map((c) => c.action)).toEqual(['cerca_inviate']);
    expect(edge[0].touch_id).toBe(NUOVO);
  });

  test('negozio a freddo: modo Sequenza con il template; "Segna come inviata" resta un tocco della sequenza, e un tocco gia\' collegato non mostra "Collega a Gmail"', async ({ page }) => {
    const { inserti } = await apri(page, FREDDO);
    const comp = page.locator('.or-comp');
    await expect(comp.locator('.cs-seg-btn.on')).toHaveText('Sequenza a freddo');
    await expect(comp.getByLabel('Tocco')).toHaveValue('2');
    await expect(comp.getByLabel('Testo')).toHaveValue(/Gentile team di Glitter Prova,\ntesto del tocco 2\./);
    await expect(page.getByRole('button', { name: 'Collega a Gmail' })).toHaveCount(0);
    await comp.getByRole('button', { name: 'Segna come inviata' }).click();
    await expect(comp.locator('.or-esito')).toContainText('Follow-up 3 fra 5 giorni');
    expect(inserti[0]).toMatchObject({ sequenza_tocco: 2, prossima_azione: 'follow-up 3 di 4' });
  });
});
