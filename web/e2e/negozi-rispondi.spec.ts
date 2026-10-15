import { test, expect, type Page } from '@playwright/test';

// Cruscotto B2B, la scheda del negozio "come Assistenza" (lead-outreach v15, 15-10): conversazione a bolle in ordine
// cronologico e UN compositore. Modo "Rispondi" per chi ci ha scritto: le proposte nascono dalla conversazione
// (proponi_risposta), la persona sceglie, ritocca o chiede una modifica (rifinisci), conferma nella finestra di invio
// (rispondi con il draft_id della proposta e una send_key). Origine: il caso Glitter, la bozza del compositore era il
// tocco 2 della sequenza a freddo e ignorava le date proposte da Agnese. Come le altre spec di Negozi NON tocca
// Supabase: richieste intercettate, dati finti.
// Lanciare dopo `npm run build`:  npx playwright test negozi-rispondi

const ID = '00000000-0000-0000-0000-000000000006';
const base = (o: Record<string, unknown>) => ({
  id: ID, nome: 'Glitter Prova', tipo: 'boutique', citta: 'Ceva', paese: 'IT', stato_ricerca: 'reviewed', totale: 66.7, tier: null, tier_proposto: 'B',
  verdetto: 'da_contattare', verdetto_motivo: null, gancio: null, n_evidenze: 3, n_contatti: 1, thumb: null, img: null, follower: null,
  prossima_azione_at: '2026-10-15', owner_outreach: 'Benny', owner_note: null, email_generica: 'negozio@negozio.test', email_sito: null, telefono: null, telefono_maps: null,
  website: null, ig_handle: null, n_opt_out: 0, scaduta: false, da_gestire: true, bozza_auto_tocco: null, ultimo_esito: null, ultimo_chi: 'auto', giorni_da_ultimo: 0,
  ultimo_tocco_at: '2026-10-14T16:33:59Z', ultimo_canale: 'email', ultima_direzione: 'in', prossima_azione: 'rispondere al negozio', lead_stage: 'risposto', n_tocchi: 3, n_email_out: 1, ...o,
});
const tocco = (o: Record<string, unknown>) => ({ account_id: ID, contact_id: null, subject: null, stage_prima: null, stage_dopo: null, esito: null, prossima_azione: null, prossima_azione_at: null, sequenza_tocco: null, chi: null, gmail_message_id: null, gmail_thread_id: null, created_at: '2026-10-14T12:00:00Z', ...o });
const MODULO = tocco({ id: '00000000-0000-0000-0000-0000000000c1', canale: 'altro', direzione: 'in', subject: 'Modulo contatti amimi.it: richiesta', body_clean: 'agnese@negozio.test\nSiamo interessati ai vostri prodotti', gmail_message_id: '1a13a5b6f23cb74a', at: '2026-10-14T12:20:32Z' });
const NOSTRA = tocco({ id: '00000000-0000-0000-0000-0000000000c2', canale: 'email', direzione: 'out', subject: 'Amimì Milano x Glitter Prova', body_clean: 'Buongiorno Agnese', sequenza_tocco: 1, chi: 'Benny', gmail_message_id: '1a13a7a717a150bc', gmail_thread_id: '1a13a7a7135d6642', at: '2026-10-14T12:54:37Z' });
const TELEFONATA = tocco({ id: '00000000-0000-0000-0000-0000000000c4', canale: 'telefono', direzione: 'out', subject: 'Telefonata con Agnese', body_clean: 'Sentita: aspetta la nostra proposta sulle date', esito: 'interessato', chi: 'Benny', at: '2026-10-14T14:10:00Z' });
const RISPOSTA_AT = '2026-10-14T16:33:59Z';
const RISPOSTA = tocco({ id: '00000000-0000-0000-0000-0000000000c3', canale: 'email', direzione: 'in', subject: 'Re: Amimì Milano x Glitter Prova', body_clean: 'agnese@negozio.test\nCiao! Io ci sarei domani', chi: 'auto', gmail_message_id: '1a13b43ad2833f23', gmail_thread_id: '1a13a7a7135d6642', at: RISPOSTA_AT });
const OPT = 'Se preferisce non ricevere altre email da parte mia, mi risponda "no grazie" e non la contatterò più.';
const seq = (n: number) => ({ id: `seq-${n}`, codice: 'boutique_it', tocco: n, canale: 'email', oggetto: `Oggetto ${n}`, corpo: `Gentile {{referente}},\ntesto del tocco ${n}.\n{{firma}}\n${OPT}`, giorni_attesa: n === 1 ? 0 : 5, attiva: true, chi_default: 'Benny' });
const FIRMA = 'Benedetta - Amimì Milano';
const SETTINGS = [{ key: 'lead_outreach_ai_enabled', value: 'true' }, { key: 'lead_risposta_ai_enabled', value: 'true' }, { key: 'lead_enabled', value: 'true' }, { key: 'lead_firma', value: FIRMA }, { key: 'lead_linesheet_url', value: 'https://amimi.it/pages/amimi-trade' }, { key: 'lead_tetto_giornaliero', value: '20' }];
// le due proposte della edge finta: la seconda porta un dato che NON sta nei fatti (il linter della edge lo segna)
const ALT1 = { titolo: 'Confermo domani', testo: `Ciao Agnese,\nperfetto, domani mattina ti chiamo io.\n\n${FIRMA}`, non_grounded: [], troncata: false, avvisi: [], segnaposto: [] };
const ALT2 = { titolo: 'Propongo un altro giorno', testo: `Ciao Agnese,\ndomani non riesco: ti andrebbe giovedì 23 alle 10?\n\n${FIRMA}`, non_grounded: ['giovedì 23'], troncata: false, avvisi: [], segnaposto: [] };
const DRAFT_ID = '00000000-0000-0000-0000-0000000000d1';
const PROPOSTA = { ok: true, draft_id: DRAFT_ID, alternative: [ALT1, ALT2], lingua: 'it', oggetto: 'Re: Amimì Milano x Glitter Prova', to: 'agnese@negozio.test', ultimo_at: RISPOSTA_AT };
const RIFINITA = `Ciao Agnese,\nti chiamo domani alle 10.\n\n${FIRMA}`;
// una proposta gia' salvata in lead_drafts (fatti_usati.tipo 'risposta'), scritta PRIMA dell'ultima email del negozio
const SALVATA = { id: '00000000-0000-0000-0000-0000000000d5', account_id: ID, lingua: 'it', oggetto: 'Re: Amimì Milano x Glitter Prova', testo: ALT1.testo, to_email: 'agnese@negozio.test', sequenza_tocco: null, stato: 'proposta', chi: 'Benny', sent_by: null, sent_at: null, errore: null, created_at: '2026-10-14T14:00:00Z', fatti_usati: { tipo: 'risposta', alternative: [ALT1, ALT2] }, origine: 'manuale' };

type Chiamata = { action?: string; account_id?: string; to?: string; oggetto?: string; testo?: string; send_key?: string; draft_id?: string | null; istruzione?: string; modo?: string };

async function apri(page: Page, riga: Record<string, unknown>, tocchi: Record<string, unknown>[], opts: { reteGiu?: boolean; bozze?: Record<string, unknown>[] } = {}): Promise<Chiamata[]> {
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
      if (c.action === 'proponi_risposta') return json(PROPOSTA);
      if (c.action === 'rifinisci') return json({ ok: true, titolo: 'Risposta', testo: RIFINITA, non_grounded: [], troncata: false, avvisi: [], segnaposto: [] });
      if (c.action === 'prova') return json({ ok: true, prova: true, to: 'prova@amimi.it', from: 'wholesale@amimi.it', oggetto: '[PROVA] ' + c.oggetto, segnaposto: 0 });
      return json({ error: 'azione non prevista dalla spec' }, 500);
    }
    if (url.pathname.endsWith('/lead_touches')) return json(tocchi);
    if (url.pathname.endsWith('/lead_drafts')) return json(opts.bozze ?? []);
    // la lista legge v_lead_lista (per id dopo una scrittura); il dossier completo si legge per id
    if (url.pathname.endsWith('/v_lead_lista') || url.pathname.endsWith('/v_lead_dossier')) return json(Number(url.searchParams.get('offset') ?? 0) > 0 ? [] : [riga]);
    if (url.pathname.endsWith('/v_lead_outreach')) return json([riga]);
    if (url.pathname.endsWith('/lead_sequences')) return json([seq(1), seq(2), seq(3), seq(4)]);
    if (url.pathname.endsWith('/v_lead_settings')) return json(SETTINGS);
    return json([]);
  });
  await page.goto(`#negozi/outreach/${ID}`);
  if (tocchi.length) await expect(page.locator('.or-conv > *')).toHaveCount(tocchi.length);
  else await expect(page.getByText('Nessun messaggio ancora')).toBeVisible();
  await expect(page.locator('.or-comp .seg button.on')).toHaveCount(1);   // il modo iniziale e' deciso
  return edge;
}

// bug visto il 15-10: una sequenza ’ scritta nel TESTO JSX si vede letteralmente a schermo
const nienteEscape = async (page: Page) => expect(await page.locator('body').innerText()).not.toMatch(/\\u20/);

test.describe('schermo largo 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('chi ci ha scritto: modo Rispondi, proposte dalla conversazione, modifica AI, finestra di conferma, rispondi con il draft_id e chiave nuova dopo', async ({ page }) => {
    const edge = await apri(page, base({}), [RISPOSTA, NOSTRA, MODULO]);
    const comp = page.locator('.or-comp');
    await expect(comp.locator('.seg button.on')).toHaveText('Rispondi');
    await expect(comp.getByLabel('Destinatario')).toHaveValue('agnese@negozio.test');
    await expect(comp.getByLabel('Oggetto')).toHaveValue('Re: Amimì Milano x Glitter Prova');
    const invia = comp.getByRole('button', { name: '✉️ Invia…' });
    await expect(invia).toBeDisabled();   // solo la firma: non e' ancora una risposta

    // le proposte dalla conversazione: due alternative con titolo, la prima nel box
    await comp.getByRole('button', { name: 'Proponi le risposte dalla conversazione' }).click();
    await expect(comp.locator('.cs-opts .cs-opt')).toHaveCount(2);
    await expect(comp.locator('.cs-opt-t').nth(0)).toHaveText('Confermo domani');
    await expect(comp.locator('.cs-opt-t').nth(1)).toHaveText('Propongo un altro giorno');
    const box = comp.getByLabel('Risposta');
    await expect(box).toHaveValue(ALT1.testo);
    await expect(comp.locator('.cs-badge.cs-urg')).toHaveCount(0);
    expect(edge.map((c) => c.action)).toEqual(['proponi_risposta']);
    expect(edge[0].account_id).toBe(ID);
    // la seconda si sceglie: il box cambia e il dato non nei fatti si vede nel badge e nel linter
    await comp.locator('.cs-opt').nth(1).click();
    await expect(box).toHaveValue(ALT2.testo);
    await expect(comp.locator('.cs-badge.cs-urg')).toHaveText('⚠ 1 non nei fatti');
    await expect(comp.locator('.cs-lint .cs-lint-t')).toHaveText('giovedì 23');

    // "chiedi una modifica": rifinisci riceve il testo del box e l'istruzione, il box si aggiorna, il badge sparisce
    await comp.getByPlaceholder(/Chiedi una modifica/).fill('più breve');
    await comp.getByRole('button', { name: '✨ Applica' }).click();
    await expect(box).toHaveValue(RIFINITA);
    await expect(comp.locator('.cs-badge.cs-urg')).toHaveCount(0);
    expect(edge[1]).toMatchObject({ action: 'rifinisci', account_id: ID, modo: 'risposta', istruzione: 'più breve', testo: ALT2.testo });

    // la finestra di conferma: A, Da, Oggetto, Come (nel thread) e l'anteprima del testo
    await expect(invia).toBeEnabled();
    await invia.click();
    const modal = page.locator('.cs-sendmodal');
    await expect(modal).toContainText('Inviare adesso da wholesale@amimi.it?');
    const righe = modal.locator('.cs-send-row');
    await expect(righe.nth(0)).toContainText('agnese@negozio.test');
    await expect(righe.nth(1)).toContainText('wholesale@amimi.it');
    await expect(righe.nth(2)).toContainText('Re: Amimì Milano x Glitter Prova');
    await expect(righe.nth(3)).toContainText('nel thread di “Amimì Milano x Glitter Prova”');
    await expect(modal.locator('.cs-send-preview')).toContainText('ti chiamo domani alle 10');
    await nienteEscape(page);
    await modal.getByRole('button', { name: '✓ Invia adesso' }).click();
    await expect(comp.locator('.or-esito')).toContainText('Risposta inviata a agnese@negozio.test');
    await expect(modal).toHaveCount(0);
    const risposte = edge.filter((c) => c.action === 'rispondi');
    expect(risposte).toHaveLength(1);
    expect(risposte[0]).toMatchObject({ account_id: ID, to: 'agnese@negozio.test', oggetto: 'Re: Amimì Milano x Glitter Prova', draft_id: DRAFT_ID, testo: RIFINITA });
    expect(risposte[0].send_key).toMatch(/^[0-9a-f-]{36}$/);
    // dopo l'invio il box ha la sola firma e le proposte non ci sono piu'
    await expect(box).toHaveValue(`\n\n${FIRMA}`);
    await expect(comp.locator('.cs-opts')).toHaveCount(0);

    // una seconda risposta scritta a mano: chiave nuova e nessun draft_id
    await box.fill(`Seconda risposta.\n\n${FIRMA}`);
    await invia.click();
    await page.locator('.cs-sendmodal').getByRole('button', { name: '✓ Invia adesso' }).click();
    await expect.poll(() => edge.filter((c) => c.action === 'rispondi').length).toBe(2);
    const [a1, a2] = edge.filter((c) => c.action === 'rispondi');
    expect(a2.send_key).not.toBe(a1.send_key);
    expect(a2.draft_id ?? null).toBeNull();
    expect(a2.testo).toContain('Seconda risposta.');
  });

  test("rete giu' durante la risposta (Gate Fable, A): esito incerto nella finestra, e il secondo click riusa la STESSA chiave", async ({ page }) => {
    const edge = await apri(page, base({}), [RISPOSTA, NOSTRA, MODULO], { reteGiu: true });
    const comp = page.locator('.or-comp');
    await comp.getByLabel('Risposta').fill(`Ciao Agnese, ti chiamo domani.\n\n${FIRMA}`);
    await comp.getByRole('button', { name: '✉️ Invia…' }).click();
    const modal = page.locator('.cs-sendmodal');
    const conferma = modal.getByRole('button', { name: '✓ Invia adesso' });
    await conferma.click();
    await expect(modal.locator('.err')).toContainText('Esito incerto');
    await conferma.click();
    await expect.poll(() => edge.filter((c) => c.action === 'rispondi').length).toBe(2);
    const [a1, a2] = edge.filter((c) => c.action === 'rispondi');
    expect(a2.send_key).toBe(a1.send_key);
    await expect(comp.locator('.or-esito')).toContainText('Risposta inviata');
    await expect(modal).toHaveCount(0);
  });

  test('proposta salvata in lead_drafts e il negozio ha scritto dopo: avviso "ha scritto di nuovo" e Riprendi (senza chiamare il modello)', async ({ page }) => {
    const edge = await apri(page, base({}), [RISPOSTA, NOSTRA, MODULO], { bozze: [SALVATA] });
    const comp = page.locator('.or-comp');
    await expect(comp.locator('.seg button.on')).toHaveText('Rispondi');
    const avviso = comp.locator('.cs-lint', { hasText: 'C’è già una proposta' });
    await expect(avviso).toContainText('il negozio ha scritto di nuovo');
    await expect(comp.getByRole('button', { name: 'Proponi le risposte dalla conversazione' })).toBeEnabled();
    await expect(comp.getByLabel('Risposta')).toHaveValue(`\n\n${FIRMA}`);   // dichiarata, non caricata d'ufficio
    await avviso.getByRole('button', { name: '↩ Riprendi' }).click();
    await expect(comp.locator('.cs-opts .cs-opt')).toHaveCount(2);
    await expect(comp.getByLabel('Risposta')).toHaveValue(ALT1.testo);
    await expect(avviso).toHaveCount(0);
    expect(edge).toHaveLength(0);
    // la proposta ripresa si ritrova anche fra le bozze del negozio
    await page.getByText('Bozze di questo negozio (1)').click();
    await expect(page.locator('details', { hasText: 'Bozze di questo negozio' })).toContainText('Proposta di risposta · proposta · Benny');
    // e l'invio porta il suo draft_id
    await comp.getByRole('button', { name: '✉️ Invia…' }).click();
    await page.locator('.cs-sendmodal').getByRole('button', { name: '✓ Invia adesso' }).click();
    await expect(comp.locator('.or-esito')).toContainText('Risposta inviata');
    expect(edge.map((c) => c.action)).toEqual(['rispondi']);
    expect(edge[0].draft_id).toBe(SALVATA.id);
  });

  test('ultimo messaggio = modulo del sito: la risposta e\' un\'email nuova; la prova manda solo oggetto e testo', async ({ page }) => {
    const edge = await apri(page, base({ n_email_out: 0, n_tocchi: 1 }), [MODULO]);
    const comp = page.locator('.or-comp');
    await expect(comp.locator('.seg button.on')).toHaveText('Rispondi');
    await expect(comp.getByLabel('Destinatario')).toHaveValue('agnese@negozio.test');
    await expect(comp.getByLabel('Oggetto')).toHaveValue('Amimì Milano per Glitter Prova');
    await comp.getByLabel('Risposta').fill(`Buongiorno, grazie del messaggio.\n\n${FIRMA}`);
    await comp.getByRole('button', { name: 'Prova a me' }).click();
    await expect(comp.locator('.or-esito')).toContainText('Prova inviata');
    expect(edge.map((c) => c.action)).toEqual(['prova']);
    expect(Object.keys(edge[0]).sort()).toEqual(['action', 'oggetto', 'testo']);
    await comp.getByRole('button', { name: '✉️ Invia…' }).click();
    await expect(page.locator('.cs-sendmodal .cs-send-row').nth(3)).toContainText('email nuova: l’ultimo messaggio è il modulo del sito');
    await nienteEscape(page);
  });

  test('negozio che non ci ha mai scritto: modo Sequenza con il template nel box; forzare Rispondi non propone e non invia', async ({ page }) => {
    await apri(page, base({ lead_stage: 'contattato', da_gestire: false, ultima_direzione: 'out', n_tocchi: 1 }), [NOSTRA]);
    const comp = page.locator('.or-comp');
    await expect(comp.locator('.seg button.on')).toHaveText('Sequenza a freddo');
    await expect(comp.getByLabel('Tocco')).toHaveValue('2');   // una email gia' partita
    await expect(comp.getByLabel('Testo')).toHaveValue(/testo del tocco 2/);
    await expect(comp.getByRole('button', { name: 'Segna come inviata' })).toBeEnabled();
    await comp.getByRole('button', { name: 'Rispondi', exact: true }).click();
    await expect(comp.locator('.cs-lint')).toContainText('non ci ha mai scritto');
    await expect(comp.getByRole('button', { name: 'Proponi le risposte dalla conversazione' })).toBeDisabled();
    await expect(comp.getByRole('button', { name: '✉️ Invia…' })).toBeDisabled();
  });

  test('conversazione in ordine cronologico: mittente nell\'intestazione e non nel corpo, la telefonata e\' una riga e non una bolla', async ({ page }) => {
    await apri(page, base({ n_tocchi: 4 }), [RISPOSTA, TELEFONATA, NOSTRA, MODULO]);   // la lettura arriva dal piu' recente
    const conv = page.locator('.or-conv');
    const el = conv.locator('> *');
    await expect(el).toHaveCount(4);
    await expect(el.nth(0)).toHaveClass(/cs-msg in/);
    await expect(el.nth(0).locator('.cs-mh')).toContainText('Glitter Prova · agnese@negozio.test');
    await expect(el.nth(0).locator('.cs-body')).toHaveText('Siamo interessati ai vostri prodotti');
    await expect(el.nth(0).locator('.cs-mb')).toContainText('Modulo contatti amimi.it: richiesta');
    await expect(el.nth(1)).toHaveClass(/cs-msg out/);
    await expect(el.nth(1).locator('.cs-mh')).toContainText('Benny · tocco 1');
    await expect(el.nth(2)).toHaveClass(/or-nota/);
    await expect(el.nth(2)).toContainText('Telefono');
    await expect(el.nth(2)).toContainText('Interessato');
    await expect(el.nth(2)).toContainText('aspetta la nostra proposta');
    await expect(el.nth(3)).toHaveClass(/cs-msg in/);
    await expect(el.nth(3).locator('.cs-mh')).toContainText('agnese@negozio.test');
    await expect(el.nth(3).locator('.cs-body')).toHaveText('Ciao! Io ci sarei domani');
    await expect(conv.locator('.cs-msg')).toHaveCount(3);
    await expect(conv.locator('.or-nota')).toHaveCount(1);
    await nienteEscape(page);
  });
});
