import { test, expect, type Page } from '@playwright/test';

// Notifiche native (17-10, brief notifiche native, PR A): voce in Home, scheda #notifiche e PushKeeper, dietro
// app_flags.push_enabled (vista v_push_settings). Come negozi-badge.spec.ts NON tocca Supabase: ogni richiesta a
// *.supabase.co e' intercettata e riceve dati finti, la sessione del team e' un oggetto finto in localStorage, e la edge
// push-api e' un server finto qui sotto (righe in memoria, device_id mai restituito, "questo" calcolato dal device_id
// della richiesta come la edge vera). I test senza scritture controllano che le azioni siano solo config e dispositivi.
// Service worker: Playwright li blocca (playwright.config.ts, serviceWorkers 'block', register non registra niente).
// Dove serve l'iscrizione (Gate 3 del 17-10) un service worker FINTO sostituisce navigator.serviceWorker: register,
// ready e getRegistration danno una registrazione con un pushManager scriptabile (getSubscription, subscribe che come
// da specifica restituisce l'iscrizione esistente, unsubscribe), un EventTarget per i messaggi e Notification.permission
// forzato. La notifica vera che arriva si prova sui telefoni con "Invia una prova" (brief, sez. 6).
// Lanciare dopo la build verso il progetto finto (come la CI):
//   VITE_SUPABASE_URL=https://e2e-progetto-finto.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_e2e_finto npx vite build
//   E2E_PORT=<porta libera> npx playwright test notifiche

const SESSIONE = JSON.stringify({
  access_token: 'finto', refresh_token: 'finto', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'prova@amimi.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
});
// chiave pubblica VAPID finta ma ben formata (P-256 non compressa: 65 byte, il primo 0x04), base64url
const VAPID_BYTES = [4, ...Array.from({ length: 64 }, (_, i) => i + 1)];
const VAPID = Buffer.from(VAPID_BYTES).toString('base64url');
const TEMI = [
  { key: 'conti', etichetta: 'Controlli contabili', descrizione: 'Quando il controllo dei conti trova un errore nuovo' },
  { key: 'vendite', etichetta: 'Vendite ferme', descrizione: 'Quando non arrivano ordini da 24 ore' },
];
const E1 = 'https://fcm.googleapis.com/fcm/send/vecchia';
const E2 = 'https://fcm.googleapis.com/fcm/send/nuova';
const QUI = '00000000-0000-0000-0000-0000000000e9';

/** Riga di push_subscriptions come la tiene il server finto: device_id ed endpoint non escono mai da dispositivi. */
type Riga = {
  id: string; chi: string; etichetta: string | null; temi: string[]; created_at: string;
  last_ok_at: string | null; last_status: number | null; device_id: string; endpoint: string;
};
const ANDROID_ALE: Riga = {
  id: '00000000-0000-0000-0000-0000000000d1', chi: 'Ale', etichetta: 'Android · Chrome', temi: ['conti'], created_at: '2026-10-17T08:00:00Z',
  last_ok_at: '2026-10-17T09:30:00Z', last_status: 201, device_id: '00000000-0000-0000-0000-0000000000e1', endpoint: 'https://fcm.googleapis.com/fcm/send/ale',
};
/** La riga di QUESTO telefono (device_id QUI), iscritta con l'endpoint E1. */
const rigaQui = (temi: string[] = ['conti'], chi = 'Ale'): Riga => ({
  id: '00000000-0000-0000-0000-0000000000d9', chi, etichetta: 'Windows · Chrome', temi, created_at: '2026-10-17T07:00:00Z',
  last_ok_at: null, last_status: null, device_id: QUI, endpoint: E1,
});

/** Il service worker finto. sub = endpoint dell'iscrizione gia' nel browser; nuovo = quello che crea subscribe;
 *  readyManuale = serviceWorker.ready si risolve solo con window.__push.pronto() (niente timer: un timer corre col caricamento). */
type Finto = { sub?: string | null; nuovo?: string; readyManuale?: boolean };
type Opzioni = {
  flag: 'true' | 'false'; sessione?: boolean; chi?: string; device?: string; config?: unknown; righe?: Riga[];
  finto?: Finto; dispositiviKo?: boolean; dispositiviMs?: number;
};
type Corpo = Record<string, unknown> & { action: string };

async function apri(page: Page, hash: string, opts: Opzioni) {
  const azioni: string[] = [];
  const corpi: Corpo[] = [];
  const errori: string[] = [];
  const letture = { flag: 0 };
  const server = { righe: [...(opts.righe ?? [])], dispositiviKo: !!opts.dispositiviKo, dispositiviMs: opts.dispositiviMs ?? 0 };
  page.on('pageerror', (e) => errori.push(e.message));
  await page.addInitScript(({ sessione, chi, device }) => {
    if (sessione) localStorage.setItem('amimi-cs-auth', sessione);
    if (chi) localStorage.setItem('amimi_chi', chi);
    if (device) localStorage.setItem('amimi_push_device', device);
    // ogni volta che a schermo compare "si sono spente", anche per un attimo
    new MutationObserver(() => {
      if (document.body?.textContent?.includes('si sono spente')) (window as unknown as { __vistoSpente: boolean }).__vistoSpente = true;
    }).observe(document, { childList: true, subtree: true, characterData: true });
  }, { sessione: opts.sessione ? SESSIONE : null, chi: opts.chi ?? null, device: opts.device ?? null });
  if (opts.finto) {
    await page.addInitScript(({ finto, bytes }) => {
      const log: string[] = [];
      const key = new Uint8Array(bytes).buffer;
      type SubFinta = { endpoint: string; options: { applicationServerKey: ArrayBuffer; userVisibleOnly: boolean }; toJSON(): unknown; unsubscribe(): Promise<boolean> };
      const stato: { sub: SubFinta | null } = { sub: null };
      const crea = (endpoint: string): SubFinta => {
        const s: SubFinta = {
          endpoint,
          options: { applicationServerKey: key, userVisibleOnly: true },
          toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p256dh-finto', auth: 'auth-finto' } }),
          unsubscribe: async () => { log.push('unsubscribe ' + endpoint); if (stato.sub === s) stato.sub = null; return true; },
        };
        return s;
      };
      if (finto.sub) stato.sub = crea(finto.sub);
      const pushManager = {
        getSubscription: async () => { log.push('getSubscription'); return stato.sub; },
        subscribe: async () => { log.push('subscribe'); if (!stato.sub) stato.sub = crea(finto.nuovo ?? 'https://fcm.googleapis.com/fcm/send/creata'); return stato.sub; },
      };
      const reg = { scope: location.origin + '/amimi-app/', pushManager };
      let pronto = () => {};
      const ready = finto.readyManuale ? new Promise((ok) => { pronto = () => ok(reg); }) : Promise.resolve(reg);
      const sw = Object.assign(new EventTarget(), {
        controller: null,
        register: async () => { log.push('register'); return reg; },
        ready,
        getRegistration: async () => reg,
        startMessages: () => {},
      });
      Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => sw, configurable: true });
      Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
      (window as unknown as { __push: unknown }).__push = { log, stato, pronto: () => pronto() };
    }, { finto: opts.finto, bytes: VAPID_BYTES });
  }
  await page.route(/supabase\.co\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/functions/v1/push-api') && req.method() === 'POST') {
      const b = req.postDataJSON() as Corpo;
      azioni.push(b.action);
      corpi.push(b);
      const dev = typeof b.device_id === 'string' ? b.device_id.toLowerCase() : '';
      switch (b.action) {
        case 'config': return json(opts.config ?? { enabled: true, vapidPublicKey: VAPID, temi: TEMI });
        case 'dispositivi': {
          if (server.dispositiviMs) await new Promise((ok) => setTimeout(ok, server.dispositiviMs));
          if (server.dispositiviKo) return json({ error: 'dispositivi non leggibili, riprova' }, 503);
          return json({ dispositivi: server.righe.map(({ device_id, endpoint: _e, ...r }) => ({ ...r, questo: !!dev && device_id === dev })) });
        }
        case 'iscrivi': {
          const sub = b.subscription as { endpoint: string };
          server.righe = server.righe.filter((r) => r.device_id !== dev && r.endpoint !== sub.endpoint);
          const id = '00000000-0000-0000-0000-0000000000f' + server.righe.length;
          server.righe.push({ id, chi: String(b.chi), etichetta: (b.etichetta as string) ?? null, temi: b.temi as string[], created_at: '2026-10-17T10:00:00Z', last_ok_at: null, last_status: null, device_id: dev, endpoint: sub.endpoint });
          return json({ ok: true, id });
        }
        case 'rinnova': {
          const r = server.righe.find((x) => x.device_id === dev);
          if (r) r.endpoint = (b.subscription as { endpoint: string }).endpoint;
          return json({ ok: true, trovato: !!r });
        }
        case 'disiscrivi': {
          const prima = server.righe.length;
          server.righe = server.righe.filter((r) => r.device_id !== dev);
          return json({ ok: true, rimossi: prima - server.righe.length });
        }
        case 'rimuovi': {
          const prima = server.righe.length;
          server.righe = server.righe.filter((r) => r.id !== b.id);
          return json({ ok: true, rimossi: prima - server.righe.length });
        }
        default: return json({ error: 'azione inattesa nel test: ' + b.action }, 400);
      }
    }
    if (url.pathname.endsWith('/rest/v1/v_push_settings')) {
      letture.flag++;
      // fetchPushEnabled usa maybeSingle(): con Accept vnd.pgrst.object+json PostgREST risponde l'oggetto, altrimenti l'array
      const riga = { key: 'push_enabled', value: opts.flag };
      return json((req.headers()['accept'] ?? '').includes('application/vnd.pgrst.object+json') ? riga : [riga]);
    }
    return json([]);
  });
  await page.goto(hash);
  return { azioni, corpi, errori, letture, server };
}

const voceHome = (page: Page) => page.locator('.ds-qbtn, .ds-mcard', { hasText: 'Notifiche sul telefono' });
const attiva = (page: Page) => page.getByRole('button', { name: 'Attiva notifiche su questo telefono' });
const disattiva = (page: Page) => page.getByRole('button', { name: 'Disattiva su questo telefono' });
const avviso = (page: Page) => page.locator('.upd-banner', { hasText: 'Notifiche spente su questo telefono' });
// la card "Questo telefono" (hasText non basta: e' una sottostringa senza maiuscole, e "Chi usa questo telefono" la contiene)
const statoTelefono = (page: Page) => page.locator('.card', { has: page.locator('h2', { hasText: /^Questo telefono$/ }) });
const logSw = (page: Page) => page.evaluate(() => [...(window as unknown as { __push: { log: string[] } }).__push.log]);
// le scritture della scheda; rinnova e' di PushKeeper all'avvio (telefono con device e iscrizione) e non tocca chi ne' temi
const scritture = (azioni: string[]) => azioni.filter((a) => !['config', 'dispositivi', 'rinnova'].includes(a));
const iscriviDi = (corpi: Corpo[]) => corpi.filter((c) => c.action === 'iscrivi');
/** Alla scheda Notifiche dalla Home con "Cerca un'azione", non dall'avviso (la voce in "Altro" puo' finire sotto l'avviso fisso). */
async function vaiDallaHome(page: Page) {
  await page.getByLabel('Cerca azione').fill('notific');
  await voceHome(page).click();
}

test('flag spento: nessuna voce in Home, nemmeno cercando, e nessuna chiamata a push-api', async ({ page }) => {
  const r = await apri(page, '', { flag: 'false', sessione: true });
  await expect(page.locator('.hello h1')).toContainText('Ciao');
  await expect.poll(() => r.letture.flag).toBe(1);
  await page.waitForTimeout(300);
  await expect(voceHome(page)).toHaveCount(0);
  await page.getByLabel('Cerca azione').fill('notific');
  await expect(page.getByText('Nessuna azione trovata.')).toBeVisible();
  expect(r.azioni).toEqual([]);
  expect(r.errori).toEqual([]);
});

test('flag spento: #notifiche dice "Sezione non attiva"', async ({ page }) => {
  const r = await apri(page, '#notifiche', { flag: 'false', sessione: true });
  await expect(page.locator('.card', { hasText: 'Sezione non attiva (flag push_enabled spento).' })).toBeVisible();
  await expect(attiva(page)).toHaveCount(0);
  expect(r.azioni).toEqual([]);
  expect(r.errori).toEqual([]);
});

test('flag acceso senza sessione: la voce in Home apre la scheda e la scheda chiede il login del team', async ({ page }) => {
  const r = await apri(page, '', { flag: 'true' });
  await expect(voceHome(page)).toBeVisible();
  await voceHome(page).click();
  await expect(page.locator('.cs-login')).toBeVisible();
  await expect(page.locator('.cs-logo')).toContainText('notifiche');
  await expect(page.getByRole('button', { name: 'Entra' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accedi con Google' })).toBeVisible();
  await expect(attiva(page)).toHaveCount(0);
  expect(r.azioni).toEqual([]);   // push-api vuole il JWT del team: senza login non si chiama
  expect(r.errori).toEqual([]);
});

test('flag acceso con sessione: persona dal selettore dell\'app, temi tutti spuntati, bottone Attiva, elenco dei dispositivi', async ({ page }) => {
  const r = await apri(page, '#notifiche', { flag: 'true', sessione: true, chi: 'Bene', righe: [ANDROID_ALE] });
  await expect(page.locator('h1')).toHaveText('Notifiche');
  // persona preselezionata dal selettore dell'app (amimi_chi = Bene -> Benny)
  const persona = page.locator('.card', { hasText: 'Chi usa questo telefono' });
  await expect(persona.locator('.seg button')).toHaveText(['Ale', 'Benny', 'Ginni']);
  await expect(persona.locator('.seg button.on')).toHaveText('Benny');
  // temi da config.temi, tutti spuntati prima dell'iscrizione
  const conti = page.getByRole('checkbox', { name: /Controlli contabili/ });
  const vendite = page.getByRole('checkbox', { name: /Vendite ferme/ });
  await expect(conti).toBeChecked();
  await expect(vendite).toBeChecked();
  await expect(page.getByText('Quando non arrivano ordini da 24 ore')).toBeVisible();
  // il bottone c'e'; resta spento perche' qui il service worker non si registra (serviceWorkers 'block'): senza
  // registrazione pronta prima del tocco non si prova nemmeno a iscriversi
  await expect(attiva(page)).toBeVisible();
  await expect(attiva(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Invia una prova' })).toHaveCount(0);
  // stato del telefono: non iscritto (nessuna riga sul server per questo telefono)
  await expect(statoTelefono(page)).toContainText('Spente su questo telefono.');
  // elenco: il telefono di Ale, con persona, etichetta, temi e Rimuovi (non e' questo telefono)
  const riga = page.locator('.ds-lrow', { hasText: 'Android · Chrome' });
  await expect(riga).toContainText('Ale');
  await expect(riga).toContainText('Controlli contabili');
  await expect(riga).toContainText('ultimo invio riuscito');
  await expect(riga.getByRole('button', { name: 'Rimuovi' })).toBeVisible();
  await expect(riga.getByText('questo telefono')).toHaveCount(0);
  // senza device in localStorage la richiesta dell'elenco non porta nessun device_id
  expect(r.corpi.find((c) => c.action === 'dispositivi')).toEqual({ action: 'dispositivi' });

  // un tema tolto prima dell'iscrizione resta solo qui: nessuna scrittura
  await page.getByText('Vendite ferme', { exact: true }).click();
  await expect(vendite).not.toBeChecked();
  await expect(conti).toBeChecked();
  await page.waitForTimeout(300);
  expect([...new Set(r.azioni)].sort()).toEqual(['config', 'dispositivi']);
  expect(r.errori).toEqual([]);
});

test('il telefono iscritto e\' segnato "questo telefono" dal campo questo della edge, senza Rimuovi', async ({ page }) => {
  const r = await apri(page, '#notifiche', { flag: 'true', sessione: true, device: ANDROID_ALE.device_id, righe: [ANDROID_ALE] });
  const riga = page.locator('.ds-lrow', { hasText: 'Android · Chrome' });
  await expect(riga.getByText('questo telefono')).toBeVisible();
  await expect(riga.getByRole('button', { name: 'Rimuovi' })).toHaveCount(0);
  // dispositivi porta il device_id di questo telefono (la risposta non ha piu' device_id: "questo" lo calcola la edge)
  expect(r.corpi.filter((c) => c.action === 'dispositivi').every((c) => c.device_id === ANDROID_ALE.device_id)).toBe(true);
  // iscritto sul server ma il servizio notifiche qui non si registra (serviceWorkers 'block'): non si sa se l'iscrizione
  // del browser c'e', quindi non si dice "spente" (C2 Gate 2)
  await expect(statoTelefono(page)).toContainText('Non riesco a controllare questo telefono');
  await expect(page.locator('.msg.err')).toContainText('Il browser non ha registrato il servizio notifiche.');
  expect(await page.evaluate(() => (window as unknown as { __vistoSpente?: boolean }).__vistoSpente ?? false)).toBe(false);
  await expect(disattiva(page)).toBeVisible();
  expect([...new Set(r.azioni)].sort()).toEqual(['config', 'dispositivi']);
  expect(r.errori).toEqual([]);
});

test('push-api risponde enabled:false: "Sezione non attiva" anche col flag letto acceso', async ({ page }) => {
  const r = await apri(page, '#notifiche', { flag: 'true', sessione: true, config: { enabled: false } });
  await expect(page.locator('.card', { hasText: 'Sezione non attiva' })).toBeVisible();
  await expect(attiva(page)).toHaveCount(0);
  expect(r.azioni).toEqual(['config']);
  expect(r.errori).toEqual([]);
});

test('PushKeeper: telefono iscritto ma senza iscrizione nel browser, avviso; il tocco apre Notifiche, senza rinnova', async ({ page }) => {
  const r = await apri(page, '', { flag: 'true', sessione: true, device: ANDROID_ALE.device_id, righe: [ANDROID_ALE] });
  await expect(avviso(page)).toBeVisible();
  await avviso(page).getByRole('button', { name: /tocca per riattivarle/ }).click();
  await expect(page.locator('h1')).toHaveText('Notifiche');
  await expect(avviso(page)).toHaveCount(0);
  expect(r.azioni).not.toContain('rinnova');   // senza subscription nel browser non c'e' niente da rinnovare
  expect(r.errori).toEqual([]);
});

test('PushKeeper a flag spento: nessun avviso anche col telefono segnato iscritto', async ({ page }) => {
  const r = await apri(page, '', { flag: 'false', sessione: true, device: ANDROID_ALE.device_id });
  await expect(page.locator('.hello h1')).toContainText('Ciao');
  await expect.poll(() => r.letture.flag).toBe(1);
  await page.waitForTimeout(500);
  await expect(page.locator('.upd-banner', { hasText: 'Notifiche spente' })).toHaveCount(0);
  expect(r.azioni).toEqual([]);
  expect(r.errori).toEqual([]);
});

test('Rimuovi: annullato non scrive; confermato manda rimuovi con l\'id della riga e rilegge l\'elenco', async ({ page }) => {
  const dialoghi: string[] = [];
  let accetta = false;
  page.on('dialog', (d) => { dialoghi.push(d.message()); void (accetta ? d.accept() : d.dismiss()); });
  const r = await apri(page, '#notifiche', { flag: 'true', sessione: true, righe: [ANDROID_ALE] });
  const riga = page.locator('.ds-lrow', { hasText: 'Android · Chrome' });
  await riga.getByRole('button', { name: 'Rimuovi' }).click();
  await expect.poll(() => dialoghi.length).toBe(1);
  expect(dialoghi[0]).toContain('Android · Chrome di Ale');
  await page.waitForTimeout(300);
  expect(r.azioni).not.toContain('rimuovi');

  accetta = true;
  const letturePrima = r.azioni.filter((a) => a === 'dispositivi').length;
  await riga.getByRole('button', { name: 'Rimuovi' }).click();
  await expect(page.getByText('Nessun telefono iscritto.')).toBeVisible();
  expect(r.corpi.filter((c) => c.action === 'rimuovi')).toEqual([{ action: 'rimuovi', id: ANDROID_ALE.id }]);
  expect(r.azioni.filter((a) => a === 'dispositivi').length).toBe(letturePrima + 1);
  expect(r.errori).toEqual([]);
});

test('Attiva: iscrivi con chi, device_id, endpoint, temi ed etichetta, poi lo stato da iscritto', async ({ page }) => {
  const r = await apri(page, '#notifiche', { flag: 'true', sessione: true, chi: 'Bene', righe: [ANDROID_ALE], finto: { sub: null, nuovo: E2 } });
  await expect(statoTelefono(page)).toContainText('Spente su questo telefono.');
  await page.getByText('Vendite ferme', { exact: true }).click();
  await expect(attiva(page)).toBeEnabled();
  const primaDelTocco = (await logSw(page)).length;
  await attiva(page).click();
  await expect(statoTelefono(page)).toContainText('Attive per Benny su ');
  // nel tocco il primo passo e' subscribe (su iPhone un await prima lo porterebbe fuori dal gesto)
  expect((await logSw(page)).slice(primaDelTocco)[0]).toBe('subscribe');
  const isc = iscriviDi(r.corpi);
  expect(isc).toHaveLength(1);
  const { device_id, etichetta, ...resto } = isc[0];
  expect(device_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // dallo user agent: Windows in locale, Linux in CI
  expect(etichetta).toMatch(/^(Windows|Linux|Mac) · Chrome$/);
  await expect(statoTelefono(page)).toContainText(`Attive per Benny su ${etichetta}.`);
  expect(resto).toEqual({
    action: 'iscrivi', chi: 'Bene', temi: ['conti'],
    subscription: { endpoint: E2, keys: { p256dh: 'p256dh-finto', auth: 'auth-finto' } },
  });
  expect(await page.evaluate(() => localStorage.getItem('amimi_push_device'))).toBe(device_id);
  // l'elenco riletto porta il device_id nuovo e la riga nuova e' "questo telefono"
  expect(r.corpi.filter((c) => c.action === 'dispositivi').at(-1)).toEqual({ action: 'dispositivi', device_id });
  await expect(page.locator('.ds-lrow', { hasText: 'Benny' }).getByText('questo telefono')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invia una prova' })).toBeVisible();
  await expect(attiva(page)).toHaveCount(0);
  expect(await logSw(page)).not.toContain('unsubscribe ' + E2);
  expect(r.errori).toEqual([]);
});

test('B1: elenco dei dispositivi non letto: Attiva, temi e Disattiva spenti, Riprova, nessuna scrittura', async ({ page }) => {
  const r = await apri(page, '#notifiche', { flag: 'true', sessione: true, device: QUI, righe: [rigaQui(['conti'])], finto: { sub: E1 }, dispositiviKo: true });
  await expect(statoTelefono(page)).toContainText('Non riesco a leggere l’elenco dei dispositivi');
  await expect(statoTelefono(page)).not.toContainText('Iscrizione da completare');
  await expect(page.getByText('Preparo il telefono…')).toHaveCount(0);   // registrazione pronta: e' l'elenco a fermare tutto
  await expect(attiva(page)).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: /Vendite ferme/ })).toBeDisabled();
  await expect(disattiva(page)).toBeDisabled();
  await attiva(page).click({ force: true });
  await page.waitForTimeout(300);
  expect(scritture(r.azioni)).toEqual([]);

  // l'elenco torna leggibile: Riprova mostra lo stato vero, coi temi salvati (non tutti)
  r.server.dispositiviKo = false;
  await statoTelefono(page).getByRole('button', { name: 'Riprova' }).click();
  await expect(statoTelefono(page)).toContainText('Attive per Ale');
  await expect(page.getByRole('checkbox', { name: /Controlli contabili/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Vendite ferme/ })).not.toBeChecked();
  await expect(attiva(page)).toHaveCount(0);
  expect(scritture(r.azioni)).toEqual([]);
  expect(await logSw(page)).not.toContain('unsubscribe ' + E1);
  expect(r.errori).toEqual([]);
});

test('B1: mentre l\'elenco si carica Attiva resta spento e un tocco non scrive', async ({ page }) => {
  const r = await apri(page, '#notifiche', { flag: 'true', sessione: true, device: QUI, righe: [rigaQui(['conti'])], finto: { sub: E1 }, dispositiviMs: 2500 });
  await expect(page.getByText('Preparo il telefono…')).toHaveCount(0);
  await expect(statoTelefono(page)).toContainText('Controllo l’iscrizione…');
  await expect(attiva(page)).toBeDisabled();
  await attiva(page).click({ force: true });
  await expect(statoTelefono(page)).toContainText('Attive per Ale');
  expect(scritture(r.azioni)).toEqual([]);
  expect(r.errori).toEqual([]);
});

test('B2: iscrizione nel browser senza riga sul server: tolta prima di ogni tocco, Attiva ne crea una nuova', async ({ page }) => {
  const r = await apri(page, '#notifiche', { flag: 'true', sessione: true, device: QUI, righe: [ANDROID_ALE], finto: { sub: E1, nuovo: E2 } });
  await expect(statoTelefono(page)).toContainText('Spente su questo telefono.');
  const prima = await logSw(page);
  expect(prima.filter((x) => x.startsWith('unsubscribe'))).toEqual(['unsubscribe ' + E1]);
  expect(prima).not.toContain('subscribe');
  await expect(attiva(page)).toBeEnabled();
  await attiva(page).click();
  await expect(statoTelefono(page)).toContainText('Attive per Ale');
  const isc = iscriviDi(r.corpi);
  expect(isc).toHaveLength(1);
  expect((isc[0].subscription as { endpoint: string }).endpoint).toBe(E2);
  expect(isc[0].device_id).toBe(QUI);   // il device_id resta: iscrivi sostituisce per telefono
  // l'iscrizione appena nata non viene tolta da nessuno
  await page.waitForTimeout(500);
  expect((await logSw(page)).filter((x) => x.startsWith('unsubscribe'))).toEqual(['unsubscribe ' + E1]);
  expect(r.errori).toEqual([]);
});

test('B2 controllo e C2: con la riga sul server l\'iscrizione resta; "spente" mai a schermo mentre il browser si legge', async ({ page }) => {
  const r = await apri(page, '#notifiche', { flag: 'true', sessione: true, device: QUI, righe: [rigaQui(['conti'])], finto: { sub: E1, readyManuale: true } });
  // elenco gia' letto (la riga e' a schermo), iscrizione del browser non ancora: si sta controllando, non "si sono spente"
  await expect(page.locator('.ds-lrow', { hasText: 'Windows · Chrome' }).getByText('questo telefono')).toBeVisible();
  await expect(statoTelefono(page)).toContainText('Controllo l’iscrizione…');
  await page.waitForTimeout(300);
  await expect(statoTelefono(page)).toContainText('Controllo l’iscrizione…');
  await page.evaluate(() => (window as unknown as { __push: { pronto: () => void } }).__push.pronto());
  await expect(statoTelefono(page)).toContainText('Attive per Ale');
  expect(await page.evaluate(() => (window as unknown as { __vistoSpente?: boolean }).__vistoSpente ?? false)).toBe(false);
  expect((await logSw(page)).filter((x) => x.startsWith('unsubscribe'))).toEqual([]);
  expect(scritture(r.azioni)).toEqual([]);
  expect(r.errori).toEqual([]);
});

test('Disattiva: prima disiscrivi sul server, poi unsubscribe del browser e il telefono dimenticato', async ({ page }) => {
  const r = await apri(page, '#notifiche', { flag: 'true', sessione: true, device: QUI, righe: [rigaQui(['conti'])], finto: { sub: E1 } });
  await expect(statoTelefono(page)).toContainText('Attive per Ale');
  await disattiva(page).click();
  await expect(statoTelefono(page)).toContainText('Spente su questo telefono.');
  expect(r.corpi.filter((c) => c.action === 'disiscrivi')).toEqual([{ action: 'disiscrivi', device_id: QUI }]);
  expect((await logSw(page)).filter((x) => x.startsWith('unsubscribe'))).toEqual(['unsubscribe ' + E1]);
  expect(await page.evaluate(() => localStorage.getItem('amimi_push_device'))).toBeNull();
  // l'elenco riletto non porta piu' nessun device_id
  expect(r.corpi.filter((c) => c.action === 'dispositivi').at(-1)).toEqual({ action: 'dispositivi' });
  expect(r.errori).toEqual([]);
});

test('messaggio amimi-apri dal service worker: cambia scheda con go(), un hash sconosciuto non cambia niente', async ({ page }) => {
  const r = await apri(page, '', { flag: 'true', sessione: true, finto: { sub: null } });
  await expect(page.locator('.hello h1')).toContainText('Ciao');
  const manda = (hash: string) => page.evaluate((h) => {
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { tipo: 'amimi-apri', hash: h } }));
  }, hash);
  await manda('#boh');
  await page.waitForTimeout(300);
  await expect(page.locator('.hello h1')).toContainText('Ciao');
  await manda('#notifiche');
  await expect(page.locator('h1')).toHaveText('Notifiche');
  // mai location.hash: il backnav leggerebbe il cambio come "indietro"
  expect(await page.evaluate(() => location.hash)).toBe('');
  expect(r.errori).toEqual([]);
});

test('PushKeeper: rinnova con trovato:false mostra l\'avviso, che sulla scheda Notifiche non compare', async ({ page }) => {
  const r = await apri(page, '', { flag: 'true', sessione: true, device: QUI, righe: [ANDROID_ALE], finto: { sub: E1 } });
  await expect(avviso(page)).toBeVisible();
  expect(r.corpi.filter((c) => c.action === 'rinnova').map((c) => [c.device_id, (c.subscription as { endpoint: string }).endpoint])).toEqual([[QUI, E1]]);
  // si arriva alla scheda dalla Home, non dall'avviso: sulla scheda l'avviso non c'e' (lo stato vero e' gia' li')
  await vaiDallaHome(page);
  await expect(page.locator('h1')).toHaveText('Notifiche');
  await expect(statoTelefono(page)).toContainText('Spente su questo telefono.');
  await expect(avviso(page)).toHaveCount(0);
  expect(r.errori).toEqual([]);
});

test('PushKeeper: dopo un "Attiva" riuscito l\'avviso non torna in Home', async ({ page }) => {
  const r = await apri(page, '', { flag: 'true', sessione: true, device: QUI, righe: [ANDROID_ALE], finto: { sub: E1, nuovo: E2 } });
  await expect(avviso(page)).toBeVisible();
  await vaiDallaHome(page);
  await expect(statoTelefono(page)).toContainText('Spente su questo telefono.');
  await attiva(page).click();
  await expect(statoTelefono(page)).toContainText('Attive per Ale');
  await page.getByRole('button', { name: '‹ Home' }).click();
  await expect(page.locator('.hello h1')).toContainText('Ciao');
  await page.waitForTimeout(300);
  await expect(avviso(page)).toHaveCount(0);
  expect(r.errori).toEqual([]);
});

test('PushKeeper: dopo un "Disattiva" riuscito l\'avviso non torna in Home', async ({ page }) => {
  // riga sul server ma nessuna iscrizione nel browser: avviso all'avvio, poi l'utente disattiva dalla scheda
  const r = await apri(page, '', { flag: 'true', sessione: true, device: QUI, righe: [rigaQui(['conti'])], finto: { sub: null } });
  await expect(avviso(page)).toBeVisible();
  await vaiDallaHome(page);
  await expect(statoTelefono(page)).toContainText('si sono spente');
  await disattiva(page).click();
  await expect(statoTelefono(page)).toContainText('Spente su questo telefono.');
  expect(r.corpi.filter((c) => c.action === 'disiscrivi')).toEqual([{ action: 'disiscrivi', device_id: QUI }]);
  await page.getByRole('button', { name: '‹ Home' }).click();
  await expect(page.locator('.hello h1')).toContainText('Ciao');
  await page.waitForTimeout(300);
  await expect(avviso(page)).toHaveCount(0);
  expect(r.errori).toEqual([]);
});

test('temi: riattivando, un tema spento rimasto nella riga non torna al server', async ({ page }) => {
  // riga con ['conti','vecchio'] ('vecchio' non e' piu' in config), iscrizione del browser sparita
  const r = await apri(page, '#notifiche', { flag: 'true', sessione: true, device: QUI, righe: [rigaQui(['conti', 'vecchio'])], finto: { sub: null, nuovo: E2 } });
  await expect(statoTelefono(page)).toContainText('si sono spente');
  await expect(page.getByRole('checkbox', { name: /Controlli contabili/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Vendite ferme/ })).not.toBeChecked();
  await attiva(page).click();
  await expect(statoTelefono(page)).toContainText('Attive per Ale');
  expect(iscriviDi(r.corpi).map((c) => c.temi)).toEqual([['conti']]);
  expect(r.errori).toEqual([]);
});

test('temi: cambiando persona un tema spento rimasto nella riga non torna al server', async ({ page }) => {
  const r = await apri(page, '#notifiche', { flag: 'true', sessione: true, chi: 'Bene', device: QUI, righe: [rigaQui(['conti', 'vecchio'], 'Ale')], finto: { sub: E1 } });
  await expect(statoTelefono(page)).toContainText('Attive per Ale');
  await page.getByRole('button', { name: 'Usa Benny' }).click();
  await expect(page.locator('.msg.ok')).toContainText('Ora questo telefono riceve come Benny.');
  expect(iscriviDi(r.corpi).map((c) => [c.chi, c.temi])).toEqual([['Bene', ['conti']]]);
  expect(r.errori).toEqual([]);
});
