import { test, expect, type Page } from '@playwright/test';

// Chat del sito dentro Assistenza (Fase 1 pezzo 6, docs/PROPOSTA_chat_sito.md 7.6 e sez. 10). Come le spec di Negozi NON
// tocca Supabase: login finto in localStorage, richieste intercettate, dati finti (nessun nome o testo vero).
// Due cose: (1) il flusso email che il team usa ogni giorno resta com'era (bozze, Prendo io via cs-api); (2) la chat del
// sito si gestisce da qui (risposta via chat-staff con send_key, azioni via chat-staff, niente cs-assist ne' set_stato,
// chat di prova fuori dalla coda, scheda Chat che salva gli orari).
// Lanciare dopo `npm run build`:  npx playwright test e2e/assistenza-chat.spec.ts

const EMAIL = '00000000-0000-0000-0000-00000000e001';
const CHAT = '00000000-0000-0000-0000-00000000c001';
const PROVA = '00000000-0000-0000-0000-00000000c002';
const SESS = '11111111-1111-4111-8111-111111111111';
const SESS_PROVA = '22222222-2222-4222-8222-222222222222';
const MSG_STAFF = '33333333-3333-4333-8333-333333333333';
const ora = '2026-11-13T09:00:00Z';
const conv = (x: Record<string, unknown>) => ({
  customer_name: null, stato_by: null, last_direction: 'in', subject: null, order_number: null, lingua: 'it', categoria: null, categoria_source: null,
  categoria_confidence: null, urgente: false, urgenza_motivo: null, flags: [], summary: null, parse_failed: false, created_at: ora, last_msg_at: ora, ...x,
});
const CONVS = [
  conv({ id: EMAIL, gmail_thread_id: '18c0000000000001', canale: 'email_diretta', customer_email: 'cliente.email@esempio.test', customer_name: 'Cliente Email', stato: 'da_fare', snippet: 'Dov\'e\' il mio ordine?', subject: 'Ordine' }),
  conv({ id: CHAT, gmail_thread_id: 'chat:' + SESS, canale: 'chat_sito', customer_email: 'cliente.chat@esempio.test', customer_name: 'Cliente Chat', stato: 'da_fare', snippet: 'Vorrei parlare con qualcuno',
    subject: 'Chat del sito', urgente: true, urgenza_motivo: 'chat: serve una persona', flags: ['passaggio_agente'] }),
  conv({ id: PROVA, gmail_thread_id: 'chat:' + SESS_PROVA, canale: 'chat_sito', customer_email: 'prova@esempio.test', customer_name: 'PROVA', stato: 'da_fare', snippet: 'Chat di prova',
    subject: 'Chat del sito', urgente: true, flags: ['passaggio_agente', 'prova'] }),
];
const MSGS: Record<string, unknown[]> = {
  [EMAIL]: [{ id: 'm1', gmail_message_id: '18c00000000000aa', direction: 'in', sent_by: null, from_email: 'cliente.email@esempio.test', to_email: 'info@amimi.it', sent_at: ora, body_text: 'Dov\'e\' il mio ordine?', body_clean: 'Dov\'e\' il mio ordine?', is_via_tool: false, form_fields: null }],
  [CHAT]: [
    { id: 'm2', gmail_message_id: 'chat:44444444-4444-4444-8444-444444444444', direction: 'in', sent_by: null, from_email: null, to_email: null, sent_at: ora, body_text: 'Vorrei parlare con qualcuno', body_clean: 'Vorrei parlare con qualcuno', is_via_tool: false, form_fields: null },
    { id: 'm3', gmail_message_id: 'chat:' + MSG_STAFF, direction: 'out', sent_by: 'Ginevra', from_email: null, to_email: null, sent_at: '2026-11-13T09:05:00Z', body_text: 'Ciao, eccoci', body_clean: 'Ciao, eccoci', is_via_tool: true, form_fields: null },
  ],
};
const SESSIONE = { id: SESS, stato: 'attesa_persona', preso_da: null, customer_email: 'cliente.chat@esempio.test', shopify_customer_id: null, lingua: 'it', prova: false, passaggi: 1,
  passaggio_at: ora, ultima_risposta_staff_at: null, chiusa_at: null, gmail_thread_id: null };
const IMPOSTAZIONI = {
  ok: true, scrivibili: ['chat_orari', 'chat_sollecito_ore', 'chat_testo_saluto', 'chat_testo_orari', 'chat_testo_attesa', 'chat_testo_fuori_orario'],
  valori: { chat_sito_enabled: 'false', chat_orari: '{"tz":"Europe/Rome","giorni":[1,2,3,4,5],"dalle":"09:00","alle":"18:00","chiusure":[]}', chat_sollecito_ore: '24,48',
    chat_limite_chat_giorno: '50', chat_conservazione_mesi: '12', chat_testo_saluto: '{"it":"Ciao","en":"Hi"}', chat_testo_orari: '{"it":"Orari","en":"Hours"}',
    chat_testo_attesa: '{"it":"Attesa {email}","en":"Wait {email}"}', chat_testo_fuori_orario: '{"it":"Fuori {email}","en":"Out {email}"}',
    chat_bottoni: '[{"id":"spedizioni","it":"Spedizioni","en":"Shipping","faq":null}]' },
  faq: [],
};

type Chiamata = { fn: string; body: Record<string, unknown> };

// concluse finte per la paginazione (Gate 2, B1): `n` righe di email gia' concluse, dalla piu' recente
const concluse = (n: number, da = 0) => Array.from({ length: n }, (_, i) => conv({
  id: `00000000-0000-0000-0000-${String(900000000000 + da + i)}`, gmail_thread_id: `18c1${String(da + i).padStart(12, '0')}`, canale: 'email_diretta',
  customer_email: `vecchia${da + i}@esempio.test`, stato: 'fatto', stato_by: 'Ginevra', snippet: 'Vecchia', last_msg_at: new Date(Date.parse('2026-11-01T00:00:00Z') - (da + i) * 3600000).toISOString(),
}));

async function apri(page: Page, o: { concluse?: number; rotti?: boolean; imp?: Record<string, unknown> } = {}): Promise<Chiamata[]> {
  const edge: Chiamata[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('amimi-cs-auth', JSON.stringify({
      access_token: 'finto', refresh_token: 'finto', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '00000000-0000-0000-0000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'prova@amimi.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    }));
    localStorage.setItem('amimi_cs_ident', 'G');
    window.confirm = () => true;
  });
  await page.route(/supabase\.co\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const fn = url.pathname.match(/\/functions\/v1\/([a-z-]+)$/)?.[1];
    if (fn) {
      const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      edge.push({ fn, body });
      if (fn === 'chat-staff') {
        if (body.action === 'rispondi') return json({ ok: true, messaggio: { id: MSG_STAFF, seq: 3 }, stato: 'aperta', email: 'inviata', email_errore: null, email_verificata: false, ripetuta: false, proiezione: true });
        if (body.action === 'impostazioni') return json(o.imp ?? IMPOSTAZIONI);
        if (body.action === 'imposta') return json({ ok: true, chiave: body.chiave, valore: 'x' });
        return json({ ok: true, stato: body.action === 'chiudi' ? 'chiusa' : 'aperta', proiezione: true });
      }
      if (fn === 'cs-assist') return json({ ok: true, fonti: [], gaps: [], dati: {}, order_admin_url: null, storia: null });
      return json({ ok: true });
    }
    const tab = url.pathname.split('/').pop();
    const q = url.searchParams;
    if (tab === 'cs_conversations') {
      if (q.get('canale') === 'eq.rumore') return json([]);
      if (q.get('gmail_thread_id')) return json([]);
      if (q.get('stato') === 'eq.fatto') {
        if (q.get('or')) { edge.push({ fn: 'rest', body: { or: q.get('or') } }); return json(concluse(5, o.concluse ?? 0)); }
        return json(concluse(o.concluse ?? 0));
      }
      return json(CONVS);
    }
    if (tab === 'cs_messages') {
      const id = (q.get('conversation_id') ?? '').replace('eq.', '');
      if (o.rotti && id === CHAT) return json({ message: 'rete giu' }, 500);
      return json(MSGS[id] ?? []);
    }
    if (tab === 'chat_sessioni') return json([SESSIONE]);
    if (tab === 'chat_messaggi') return json([{ id: MSG_STAFF, email_stato: 'inviata', email_errore: null, email_at: '2026-11-13T09:05:10Z', delivered_at: null }]);
    return json([]);
  });
  await page.goto('#assistenza');
  await expect(page.locator('.cs-filterbar')).toBeVisible();
  return edge;
}

test.use({ viewport: { width: 420, height: 900 } });

test('coda: la chat del sito accanto alle email, canali "Email" e "Chat sito", la chat di prova nascosta', async ({ page }) => {
  await apri(page);
  const carte = page.locator('.cs-card');
  await expect(carte).toHaveCount(2);
  await expect(carte.filter({ hasText: 'Cliente Chat' })).toContainText('Chat sito');
  await expect(carte.filter({ hasText: 'Cliente Chat' })).toContainText('Chiede una persona');
  await expect(carte.filter({ hasText: 'Cliente Email' })).toContainText('Email');
  await expect(page.getByText('PROVA')).toHaveCount(0);
});

test('email (non regressione): bozze AI e "Prendo io" via cs-api come prima, niente chat-staff', async ({ page }) => {
  const edge = await apri(page);
  await page.locator('.cs-card').filter({ hasText: 'Cliente Email' }).click();
  await expect(page.getByRole('button', { name: /Genera le risposte con i dati reali/ })).toBeVisible();
  await expect(page.getByLabel('Categoria')).toBeVisible();
  await page.getByRole('button', { name: '✋ Prendo io' }).click();
  await expect.poll(() => edge.filter((c) => c.fn === 'cs-api').map((c) => c.body.action)).toContain('set_stato');
  expect(edge.some((c) => c.fn === 'chat-staff')).toBe(false);
  expect(edge.some((c) => c.fn === 'cs-assist' && c.body.action === 'context')).toBe(true);
});

test('chat del sito: risposta via chat-staff con send_key, esito email, avviso email non verificata, niente cs-assist', async ({ page }) => {
  const edge = await apri(page);
  await page.locator('.cs-card').filter({ hasText: 'Cliente Chat' }).click();
  await expect(page.locator('.cs-chatbanner')).toContainText('Chat del sito');
  await expect(page.locator('.cs-chatbanner')).toContainText('Email non verificata');
  await expect(page.getByRole('button', { name: /Genera le risposte/ })).toHaveCount(0);
  await expect(page.locator('.cs-mailstate')).toContainText('Inviata anche via email');
  await page.getByLabel('Risposta alla chat').fill('Buongiorno, le rispondiamo qui.');
  await page.getByRole('button', { name: /Invia in chat/ }).click();
  await expect(page.getByRole('dialog', { name: 'Conferma risposta in chat' })).toContainText('cliente.chat@esempio.test');
  await page.getByRole('button', { name: '✓ Invia adesso' }).click();
  await expect.poll(() => edge.filter((c) => c.fn === 'chat-staff' && c.body.action === 'rispondi').length).toBe(1);
  const r = edge.find((c) => c.fn === 'chat-staff' && c.body.action === 'rispondi')!.body;
  expect(r).toMatchObject({ sessione_id: SESS, chi: 'G', testo: 'Buongiorno, le rispondiamo qui.' });
  expect(String(r.send_key)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  await expect(page.locator('.cs-chatesito')).toContainText('Inviata anche via email');
  expect(edge.some((c) => c.fn === 'cs-assist')).toBe(false);
});

test('chat del sito: "Prendo io" e "Chiudi la chat" passano da chat-staff, mai da cs-api set_stato', async ({ page }) => {
  const edge = await apri(page);
  await page.locator('.cs-card').filter({ hasText: 'Cliente Chat' }).click();
  await page.getByRole('button', { name: '✋ Prendo io' }).click();
  await expect.poll(() => edge.filter((c) => c.fn === 'chat-staff').map((c) => c.body.action)).toContain('prendo_io');
  await page.getByRole('button', { name: '✓ Chiudi la chat' }).click();
  await expect.poll(() => edge.filter((c) => c.fn === 'chat-staff').map((c) => c.body.action)).toContain('chiudi');
  expect(edge.some((c) => c.fn === 'cs-api' && c.body.action === 'set_stato')).toBe(false);
});

test('scheda Chat: orari letti da chat-staff e salvati come oggetto; le chat di prova si mostrano a richiesta', async ({ page }) => {
  const edge = await apri(page);
  await page.getByRole('button', { name: /Chat del sito: orari, promemoria e testi/ }).click();
  await expect(page.getByText('Chat del sito spenta', { exact: false })).toBeVisible();
  await page.getByLabel('Alle', { exact: true }).fill('17:30');
  await page.getByRole('button', { name: 'Salva gli orari' }).click();
  await expect.poll(() => edge.filter((c) => c.fn === 'chat-staff' && c.body.action === 'imposta').length).toBe(1);
  expect(edge.find((c) => c.body.action === 'imposta')!.body).toMatchObject({ chiave: 'chat_orari', valore: { tz: 'Europe/Rome', giorni: [1, 2, 3, 4, 5], dalle: '09:00', alle: '17:30', chiusure: [] } });
  await page.getByLabel(/Mostra in coda le chat di prova/).check();
  await page.getByRole('button', { name: 'Coda' }).click();
  await expect(page.locator('.cs-card')).toHaveCount(3);
});

test('concluse oltre 300 (Gate 2, B1): il bottone resta dopo "Conclusa" su una email e la pagina dopo parte dal cursore, non da un offset', async ({ page }) => {
  const edge = await apri(page, { concluse: 300 });
  await page.locator('.cs-card').filter({ hasText: 'Cliente Email' }).click();
  await page.getByRole('button', { name: '✓ Conclusa' }).click();
  await expect.poll(() => edge.filter((c) => c.fn === 'cs-api' && c.body.action === 'set_stato').length).toBe(1);
  await page.getByRole('button', { name: 'Coda' }).click();
  await page.getByRole('button', { name: /^Concluse/ }).click();
  const carica = page.getByRole('button', { name: 'Carica le concluse più vecchie' });
  await expect(carica).toBeVisible();
  await carica.click();
  await expect.poll(() => edge.filter((c) => c.fn === 'rest').length).toBe(1);
  expect(String(edge.find((c) => c.fn === 'rest')!.body.or)).toMatch(/^\(last_msg_at\.lt\."[^"]+",and\(last_msg_at\.eq\."[^"]+",id\.gt\.[0-9a-f-]{36}\),last_msg_at\.is\.null\)$/);
  await expect(carica).toHaveCount(0);
});

test('chat del sito con i messaggi illeggibili (Gate 2, B2): l\'errore si vede nel thread', async ({ page }) => {
  await apri(page, { rotti: true });
  await page.locator('.cs-card').filter({ hasText: 'Cliente Chat' }).click();
  await expect(page.locator('.err').first()).toBeVisible();
});

test('scheda Chat (Gate 2, B3 e C4): salvare gli orari non cancella un testo non ancora salvato; orari storti fermati prima della edge', async ({ page }) => {
  const edge = await apri(page);
  await page.getByRole('button', { name: /Chat del sito: orari, promemoria e testi/ }).click();
  await page.getByLabel('Saluto in italiano').fill('Ciao, testo nuovo non salvato');
  await page.getByLabel('Alle', { exact: true }).fill('17:00');
  await page.getByRole('button', { name: 'Salva gli orari' }).click();
  await expect.poll(() => edge.filter((c) => c.fn === 'chat-staff' && c.body.action === 'imposta').length).toBe(1);
  await expect(page.getByLabel('Saluto in italiano')).toHaveValue('Ciao, testo nuovo non salvato');
  await page.getByLabel('Dalle', { exact: true }).fill('18:00');
  await page.getByRole('button', { name: 'Salva gli orari' }).click();
  await expect(page.getByText('“dalle” deve venire prima di “alle”', { exact: false })).toBeVisible();
  expect(edge.filter((c) => c.fn === 'chat-staff' && c.body.action === 'imposta').length).toBe(1);
});

// pezzo 7 (migr 0195): i bottoni puntano a voci `risposta_chat`, che le bozze delle email non leggono; la scheda lo dice
// riga per riga, e una risposta standard puntata da un bottone resta "la stessa delle bozze"
test('scheda Chat (pezzo 7): risposta della sola chat o risposta standard, la nota lo dice; il salvataggio va a conoscenza_testo', async ({ page }) => {
  const imp = {
    ...IMPOSTAZIONI,
    valori: { ...IMPOSTAZIONI.valori, chat_bottoni: '[{"id":"spedizioni","it":"Spedizioni","en":"Shipping","faq":30},{"id":"resi","it":"Resi","en":"Returns","faq":7}]' },
    faq: [
      { id: 30, tipo: 'risposta_chat', titolo: 'faq-costi-e-tempi-spedizione: Quanto costa la spedizione?', testo_it: 'Italia 3,90 EUR', testo_en: 'Italy EUR 3.90', attiva: true },
      { id: 7, tipo: 'risposta_standard', titolo: 'A1 spedizione', testo_it: 'Ciao [nome]', testo_en: 'Hi [name]', attiva: true },
    ],
  };
  const edge = await apri(page, { imp });
  await page.getByRole('button', { name: /Chat del sito: orari, promemoria e testi/ }).click();
  await expect(page.getByText('Vale solo per la chat: le bozze delle email non la usano.')).toHaveCount(1);
  await expect(page.getByText('È la stessa risposta standard che usano le bozze delle email.')).toHaveCount(1);
  await page.getByLabel('Risposta Spedizioni in italiano').fill('Italia 3,90 EUR, gratis sopra i 100 EUR');
  await page.getByRole('button', { name: 'Salva la risposta' }).first().click();
  await expect.poll(() => edge.filter((c) => c.fn === 'chat-staff' && c.body.action === 'conoscenza_testo').length).toBe(1);
  expect(edge.find((c) => c.body.action === 'conoscenza_testo')!.body).toMatchObject({ faq_id: 30, testo_it: 'Italia 3,90 EUR, gratis sopra i 100 EUR', attiva: true });
});
