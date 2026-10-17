import { test, expect, type Page } from '@playwright/test';

// Paillettes (fase 2 del Villaggio, migr 0164): i punti di Ginni. Come villaggio.spec.ts NON tocca Supabase: ogni richiesta
// a *.supabase.co riceve dati finti (v_ordini_arrivo, v_inventory, products, v_villaggio_settings con le quattro chiavi,
// v_villaggio_eventi a pagine) e le POST alla write-api sono registrate e risposte qui come farebbe write-api v29:
// villaggio_presenza (idempotente per giorno, ignorata per chi non gioca), fornitore_verifica (date aggiornate, eventi
// verifica e data_aggiunta), count (giacenza corretta, evento conta). Gli eventi nuovi li aggiunge il finto server solo per
// la giocatrice, come la vista v_villaggio_eventi. I punti attesi sono contati a mano qui sotto, non con paillettes.ts.
// Lanciare dopo la build verso il progetto finto (come la CI), sempre col percorso del file:
//   VITE_SUPABASE_URL=https://e2e-progetto-finto.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_e2e_finto npx vite build --outDir <cartella>
//   npx vite preview --outDir <cartella> --port <porta libera> --strictPort
//   CI=1 E2E_PORT=<porta> npx playwright test e2e/paillettes.spec.ts

// WebGL senza GPU (SwiftShader): tempi larghi come villaggio.spec.ts
test.describe.configure({ timeout: 300000 });
const ATTESA = { timeout: 40000 };

const romaIso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const OGGI = romaIso(new Date());
const traGiorni = (n: number) => romaIso(new Date(Date.now() + n * 86400000));
/** 0 = lunedi' ... 6 = domenica */
const dow = (iso: string) => (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7;
const LAVORATIVO = dow(OGGI) < 5;

type Riga = {
  id: string; gruppo: string; codice: string; item: string | null; variant: string | null; fornitore: string | null;
  qty_ordered: number | null; qty_arrived: number; mancano: number; completo: boolean; nuovo_riordino: string | null; costo_unitario: number | null;
  data_consegna: string | null; data_consegna_display: string | null; data_ordine: string | null; image_url: string | null; wip: boolean; note: string | null;
};
type Inv = { codice: string; item: string | null; variant: string | null; giacenza_attuale: number; [k: string]: unknown };

const riga = (id: string, gruppo: string, fornitore: string | null, codice: string, item: string, variant: string, ordinati: number | null, arrivati: number, consegna: string | null): Riga => {
  const mancano = (ordinati ?? 0) - arrivati;
  return {
    id, gruppo, codice, item, variant, fornitore, qty_ordered: ordinati, qty_arrived: arrivati, mancano, completo: arrivati >= (ordinati ?? 0),
    nuovo_riordino: null, costo_unitario: 40, data_consegna: consegna, data_consegna_display: consegna, data_ordine: traGiorni(-30), image_url: null, wip: false, note: null,
  };
};
const inv = (codice: string, item: string, variant: string, giacenza: number): Inv => ({
  codice, item, variant, categoria: 'Borse', giacenza_attuale: giacenza, in_conto_vendita: 0, disponibili_da_vendere: Math.max(0, giacenza), valore: 0,
  retail_price: 120, cogs: 40, last_sale: null, on_shopify: true, image_url: null, qty_purchased: 0, shopify_sold: 0, qromo_sold: 0, gift_sold: 0, b2b_venduto: 0,
});

const FRANCESCO = 'Francesco (pelle)';
const SARTE = 'Sarte Milano (tessuto)';
const GIOCATRICE = 'Ginevra';
const ID = { lea: '00000000-0000-0000-0000-0000000000a1', sophie: '00000000-0000-0000-0000-0000000000a2', zebra: '00000000-0000-0000-0000-0000000000a3', nina: '00000000-0000-0000-0000-0000000000b1' };

// Gli stessi dati di villaggio.spec.ts. Francesco: Lea cocco nero 4/10 IN RITARDO di 10 giorni, Sophie camoscio 0/5 (consegna
// fra 20 giorni), Lea zebrata 3/3 completa. Sarte Milano: Nina righe rosse 0/8 senza data. Magazzino: Sophie -1 (negativa),
// Nina 0, zebrata 3, cocco nero 7: la base della conta completa sono i 3 codici con giacenza diversa da 0.
function datiBase() {
  const ordini: Riga[] = [
    riga(ID.lea, 'G1', FRANCESCO, 'LEA_BAG_COCCO_BLACK', 'LEA BAG', 'COCCO BLACK', 10, 4, traGiorni(-10)),
    riga(ID.sophie, 'G1', FRANCESCO, 'SOPHIE_BAG_SUEDE_BROWN', 'SOPHIE BAG', 'SUEDE BROWN', 5, 0, traGiorni(20)),
    riga(ID.zebra, 'G1', FRANCESCO, 'LEA_BAG_PONY_ZEBRA', 'LEA BAG', 'PONY ZEBRA', 3, 3, traGiorni(-40)),
    riga(ID.nina, 'G2', SARTE, 'NINA_BAG_STRIPES_RED', 'NINA BAG', 'STRIPES RED', 8, 0, null),
  ];
  const magazzino: Inv[] = [
    inv('SOPHIE_BAG_SUEDE_BROWN', 'SOPHIE BAG', 'SUEDE BROWN', -1),
    inv('NINA_BAG_STRIPES_RED', 'NINA BAG', 'STRIPES RED', 0),
    inv('LEA_BAG_PONY_ZEBRA', 'LEA BAG', 'PONY ZEBRA', 3),
    inv('LEA_BAG_COCCO_BLACK', 'LEA BAG', 'COCCO BLACK', 7),
  ];
  return { ordini, magazzino };
}
type Dati = ReturnType<typeof datiBase>;

type Evento = { tipo: 'presenza' | 'ordine' | 'arrivo' | 'conta' | 'verifica' | 'data_aggiunta'; giorno: string; ts: string; ref: string; n: number };
/** Un evento come lo restituisce PostgREST da v_villaggio_eventi (ts con i microsecondi e +00:00). */
const ev = (tipo: Evento['tipo'], giorno: string, ref: string, n = 1, ora = '09:30'): Evento => ({ tipo, giorno, ts: `${giorno}T${ora}:00.000000+00:00`, ref, n });
const adesso = () => new Date().toISOString().slice(11, 16);

/** Un mese di Ginni, contato a mano con le regole del contratto (sez. 3), 282 paillettes, Stagista:
 *  - presenze -12 e -11: 2 x 5 = 10 (due giorni non fanno una settimana piena, e sono di settimane passate)
 *  - ordini: G1 3 righe 35, G2 1 riga 25, G0 cancellato (n = 0) 0, quattro vecchi da 4, 6, 2, 5 righe 40 + 50 + 30 + 45: 225
 *  - arrivi: zebrata -15 10, cocco nero -14 10 (il secondo arrivo della stessa riga lo stesso giorno: 0), riga vecchia -21 10: 30
 *  - conte: zebrata -18 2 (la seconda conta dello stesso codice lo stesso giorno: 0): 2
 *  - date aggiunte: Sophie -16 15
 *  Nessuna verifica: la prima verifica fa scattare la sua medaglia. Medaglie gia' prese: solo "Prima presenza". */
const BASE = 282;
function eventiBase(): Evento[] {
  return [
    ev('presenza', traGiorni(-12), traGiorni(-12), 1, '07:10'), ev('presenza', traGiorni(-11), traGiorni(-11), 1, '07:05'),
    ev('ordine', traGiorni(-28), 'G-OLD1', 4), ev('ordine', traGiorni(-27), 'G-OLD2', 6), ev('ordine', traGiorni(-26), 'G-OLD3', 2),
    ev('ordine', traGiorni(-24), 'G-OLD4', 5), ev('ordine', traGiorni(-25), 'G1', 3), ev('ordine', traGiorni(-22), 'G0', 0), ev('ordine', traGiorni(-20), 'G2', 1),
    ev('arrivo', traGiorni(-21), '00000000-0000-0000-0000-0000000000e1', 2), ev('arrivo', traGiorni(-15), ID.zebra, 3),
    ev('arrivo', traGiorni(-14), ID.lea, 4, '10:00'), ev('arrivo', traGiorni(-14), ID.lea, 1, '15:20'),
    ev('conta', traGiorni(-18), 'LEA_BAG_PONY_ZEBRA', 1, '11:00'), ev('conta', traGiorni(-18), 'LEA_BAG_PONY_ZEBRA', 1, '11:40'),
    ev('data_aggiunta', traGiorni(-16), ID.sophie),
  ];
}
/** La presenza di stamattina, gia' segnata (con la guardia del telefono gia' scritta: opzione presenzaFatta). */
const presenzaDiOggi = () => ev('presenza', OGGI, OGGI, 1, '06:45');

type Post = { url: string; body: { action: string; payload: Record<string, unknown>; pin: string; chi: string; force?: boolean } };
/** villaggio_paillettes_enabled come lo vede l'app: 'true' / 'false', o 'assente' = vista ancora della 0162 (solo villaggio_enabled). */
type FlagPai = 'true' | 'false' | 'assente';
type Opzioni = { chi?: string; paillettes?: FlagPai; eventi?: Evento[]; presenzaFatta?: boolean; trattieniVerifica?: boolean };

const AZIONI_CONSENTITE = new Set(['arrival_set', 'order_multi', 'count', 'villaggio_presenza', 'fornitore_verifica']);
const registro = new WeakMap<Page, Post[]>();
test.afterEach(async ({ page }) => {
  const fuori = (registro.get(page) ?? []).map((p) => p.body.action).filter((a) => !AZIONI_CONSENTITE.has(a));
  expect(fuori, 'azioni write-api inattese dal Villaggio').toEqual([]);
});

async function apri(page: Page, path: string, dati: Dati, opts: Opzioni = {}) {
  const posts: Post[] = [];
  registro.set(page, posts);
  const errori: string[] = [];
  const dialoghi: string[] = [];
  const conferme = { accetta: true };
  const letture = { ordini: 0, eventi: 0, flag: 0 };
  const pai: FlagPai = opts.paillettes ?? 'true';
  const eventi = opts.eventi ?? eventiBase();
  let sblocca = () => {};
  const attesaVerifica = opts.trattieniVerifica ? new Promise<void>((ok) => { sblocca = ok; }) : Promise.resolve();
  page.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
  page.on('pageerror', (e) => errori.push('pageerror: ' + e.message));
  page.on('dialog', (d) => { dialoghi.push(d.message()); void (conferme.accetta ? d.accept() : d.dismiss()); });
  await page.addInitScript(({ chi, presenza }) => {
    if (chi) localStorage.setItem('amimi_chi', chi);
    localStorage.setItem('amimi_villaggio_intro', '1');
    if (presenza) localStorage.setItem('amimi_villaggio_presenza', presenza);
    // toast, "+n" e festa del Mondo (durano un secondo e mezzo) e i fumetti di Ginni: si registra tutto quello che compare
    const w = window as unknown as { __avvisi: string[]; __float: string[]; __fumetti: string[] };
    w.__avvisi = []; w.__float = []; w.__fumetti = [];
    const visti = new WeakSet<Element>();
    const scan = () => {
      document.querySelectorAll('.v-toast, #toast-host .toast').forEach((el) => {
        const t = (el.textContent ?? '').trim();
        if (t && !w.__avvisi.includes(t)) w.__avvisi.push(t);
      });
      document.querySelectorAll('.v-labels .v-float.v-gold, .v-dlg').forEach((el) => {
        if (visti.has(el)) return;
        visti.add(el);
        if (el.classList.contains('v-dlg')) w.__fumetti.push((el.getAttribute('aria-label') ?? '').replace(/^Ginni: /, ''));
        else w.__float.push((el.classList.contains('v-festa') ? 'festa:' : '') + (el.textContent ?? '').trim());
      });
    };
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true });
  }, { chi: opts.chi ?? null, presenza: opts.presenzaFatta ? `${GIOCATRICE}|${OGGI}` : null });
  if (opts.presenzaFatta && !eventi.some((e) => e.tipo === 'presenza' && e.giorno === OGGI)) eventi.push(presenzaDiOggi());
  await page.route(/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route(/supabase\.co\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/functions/v1/write-api') && req.method() === 'POST') {
      const p: Post = { url: req.url(), body: req.postDataJSON() };
      posts.push(p);
      const a = p.body.action, gioca = p.body.chi === GIOCATRICE;
      if ((a === 'villaggio_presenza' || a === 'fornitore_verifica') && pai !== 'true') return json({ error: 'paillettes spente' }, 409);
      if (a === 'villaggio_presenza') {
        if (!gioca) return json({ ok: true, nuova: false, ignorata: true });
        if (eventi.some((e) => e.tipo === 'presenza' && e.giorno === OGGI)) return json({ ok: true, nuova: false });
        eventi.push(ev('presenza', OGGI, OGGI, 1, adesso()));
        return json({ ok: true, nuova: true });
      }
      if (a === 'fornitore_verifica') {
        await attesaVerifica;
        const pl = p.body.payload as { fornitore: string; righe: { id: string; confermata: boolean; data_consegna: string | null }[]; nota?: string | null };
        if (!pl.fornitore || !Array.isArray(pl.righe) || !pl.righe.length) return json({ error: 'fornitore e righe obbligatori' }, 422);
        // come write-api: si leggono solo le righe di quel fornitore, le altre si ignorano
        const lette = pl.righe.flatMap((x) => { const r = dati.ordini.find((o) => o.id === x.id && o.fornitore === pl.fornitore); return r ? [{ x, r }] : []; });
        if (!lette.length) return json({ error: 'nessuna riga del fornitore' }, 422);
        let cambiate = 0;
        const fatte = lette.map(({ x, r }) => {
          const prima = r.data_consegna, dopo = x.data_consegna || null;
          if (prima !== dopo) { r.data_consegna = dopo; r.data_consegna_display = dopo; cambiate++; }
          return { id: r.id, confermata: x.confermata, prima, dopo };
        });
        if (gioca) {
          eventi.push(ev('verifica', OGGI, pl.fornitore, fatte.filter((c) => c.confermata).length, adesso()));
          for (const c of fatte) if (!c.prima && c.dopo) eventi.push(ev('data_aggiunta', OGGI, c.id, 1, adesso()));
        }
        return json({ ok: true, check_id: '00000000-0000-0000-0000-00000000c4ec', date_cambiate: cambiate });
      }
      if (a === 'count') {
        const pl = p.body.payload as { codice: string; contati: number; data_conta: string };
        const g = dati.magazzino.find((x) => x.codice === pl.codice);
        if (!g) return json({ error: 'codice sconosciuto' }, 404);
        const delta = Number(pl.contati) - g.giacenza_attuale;
        g.giacenza_attuale = Number(pl.contati);
        if (gioca) eventi.push(ev('conta', pl.data_conta, pl.codice, 1, adesso()));
        return json({ ok: true, id: 'conta-' + pl.codice, delta, giac_dopo: g.giacenza_attuale });
      }
      return json({ error: 'azione inattesa nel test: ' + a }, 400);
    }
    if (url.pathname.endsWith('/rest/v1/v_villaggio_settings')) {
      letture.flag++;
      const righe = [{ key: 'villaggio_enabled', value: 'true' }];
      if (pai !== 'assente') {
        righe.push({ key: 'villaggio_paillettes_enabled', value: pai }, { key: 'villaggio_paillettes_dal', value: traGiorni(-30) }, { key: 'villaggio_paillettes_chi', value: GIOCATRICE });
      }
      return json(righe);
    }
    if (url.pathname.endsWith('/rest/v1/v_villaggio_eventi')) {
      letture.eventi++;
      if (pai === 'assente') return json({ code: 'PGRST205', details: null, hint: null, message: 'Could not find the table \'public.v_villaggio_eventi\' in the schema cache' }, 404);
      // a pagine come PostgREST (range -> offset e limit): l'app legge finche' non arriva una pagina vuota
      const off = Number(url.searchParams.get('offset') ?? 0), lim = Number(url.searchParams.get('limit') ?? 1000);
      return json(eventi.slice(off, off + lim));
    }
    if (url.pathname.endsWith('/rest/v1/v_ordini_arrivo')) { letture.ordini++; return json(dati.ordini); }
    if (url.pathname.endsWith('/rest/v1/v_inventory')) {
      // la giacenza di un codice solo (fetchGiacenzaOne di CountForm: codice=eq.X)
      const c = url.searchParams.get('codice');
      return json(c?.startsWith('eq.') ? dati.magazzino.filter((g) => g.codice === c.slice(3)) : dati.magazzino);
    }
    if (url.pathname.endsWith('/rest/v1/products')) return json(dati.magazzino.map((g) => ({ codice: g.codice, item: g.item, variant: g.variant, categoria: 'Borse', image_url: null, retail_price: 120, cogs: 40 })));
    return json([]);
  });
  await page.goto(path);
  return { posts, errori, dialoghi, letture, conferme, eventi, sblocca: () => sblocca() };
}

const pill = (page: Page, testo: string) => page.locator('.v-hud .v-pill', { hasText: testo }).locator('b');
/** L'HUD del villaggio e' arrivato (prima lettura fatta): i tre numeri dei dati base. */
async function hud(page: Page) {
  await expect(pill(page, 'in magazzino')).toHaveText('10', ATTESA);
  await expect(pill(page, 'in preparazione')).toHaveText('19', ATTESA);
  await expect(pill(page, 'righe aperte')).toHaveText('3', ATTESA);
}
const pai = (page: Page) => page.locator('.v-hud .v-pai');
async function pillola(page: Page, totale: string, sotto: string) {
  await expect(pai(page).locator('b')).toHaveText(totale, ATTESA);
  await expect(pai(page).locator('small')).toHaveText(sotto, ATTESA);
}
const presenze = (posts: Post[]) => posts.filter((p) => p.body.action === 'villaggio_presenza');
/** Il corpo della POST senza `ctx` (l'id del contesto che writeApi aggiunge a ogni scrittura); force deve mancare. */
const corpo = (p: Post) => ({ action: p.body.action, payload: p.body.payload, pin: p.body.pin, chi: p.body.chi, force: p.body.force });
const di = (posts: Post[], azione: string) => posts.filter((p) => p.body.action === azione);
const registrati = (page: Page, chiave: '__avvisi' | '__float' | '__fumetti') => page.evaluate((k) => (window as unknown as Record<string, string[]>)[k].slice(), chiave);
const compare = (page: Page, chiave: '__avvisi' | '__float' | '__fumetti', testo: string) =>
  expect.poll(async () => { const xs = await registrati(page, chiave); return xs.find((t) => t.includes(testo)) ?? xs.join(' | '); }, ATTESA).toContain(testo);
const etichettaLab = (page: Page, nome: string) => page.locator('.v-labels > .v-lbl:not(.v-mini):not(.v-zone):not(.v-wh)', { hasText: nome });
const barra = (page: Page, testo: string) => page.locator('.v-bar .v-rb', { hasText: testo });
const sheet = (page: Page) => page.locator('.v-sheet.open');
const LIVELLI = ['Stagista', 'Junior', 'Production Assistant', 'Coordinator', 'Production Manager', 'Head of Production', 'Executive Queen of Fashion Production'];

for (const caso of [
  { nome: 'villaggio_paillettes_enabled = \'false\'', flag: 'false' as const },
  { nome: 'vista ancora della 0162 (niente chiavi delle Paillettes, v_villaggio_eventi assente)', flag: 'assente' as const },
]) {
  test.describe(`Paillettes spente: ${caso.nome}`, () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('Ginni sul suo telefono: niente pillola, missioni, presenza, verifica ne\' giro di conta; nessun evento letto', async ({ page }) => {
      const dati = datiBase();
      const r = await apri(page, 'villaggio/', dati, { paillettes: caso.flag });
      await hud(page);
      await expect(page.locator('.v-hud .v-chi select')).toHaveValue('Ginevra');
      await page.waitForTimeout(2500);   // il tempo per una presenza e una rilettura, se partissero
      await expect(pai(page)).toHaveCount(0);
      await expect(page.locator('.v-hud .v-mis')).toHaveCount(0);
      expect(r.letture.eventi, 'a flag spento gli eventi non si leggono').toBe(0);
      // il pannello del laboratorio ha i suoi bottoni di sempre, non la verifica
      await etichettaLab(page, 'Francesco').click();
      await expect(sheet(page).locator('h2')).toHaveText('Francesco sta preparando');
      await expect(sheet(page).getByRole('button', { name: '+ Ordina a Francesco' })).toBeVisible();
      await expect(sheet(page).getByRole('button', { name: /Verifica con/ })).toHaveCount(0);
      // sul telefono il pannello copre la barra in basso: si chiude prima
      await page.keyboard.press('Escape');
      await expect(sheet(page)).toHaveCount(0);
      await barra(page, 'Magazzino').click();
      await expect(sheet(page).locator('h2')).toHaveText('Magazzino');
      await expect(sheet(page).getByRole('button', { name: /Giro di conta/ })).toHaveCount(0);
      // la pagina che rientra in primo piano non segna presenze
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForTimeout(1500);
      expect(r.posts).toEqual([]);
      expect(r.letture.eventi).toBe(0);
      expect(r.errori).toEqual([]);
    });
  });
}

test.describe('Paillettes accese, gioca Ginni', () => {
  test('pillola col totale e il livello; il percorso ha i 7 livelli, le medaglie, la settimana e le ultime voci', async ({ page }) => {
    const dati = datiBase();
    // presenza di stamattina gia' segnata: BASE + 5 = 287, Stagista, 13 a Junior
    const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra', presenzaFatta: true });
    await hud(page);
    await pillola(page, '287', 'Stagista');
    await expect(pai(page)).toHaveAttribute('aria-label', 'Le tue paillettes: 287, livello Stagista');
    await expect(pai(page).locator('.v-prog i')).toHaveAttribute('style', /width: 96%/);   // 287 su 300
    await pai(page).click();
    const s = sheet(page);
    await expect(s.locator('h2')).toHaveText('Il tuo percorso');
    await expect(s.locator('.v-shead p')).toHaveText('287 paillettes · Stagista');
    // oggi la presenza (+5); la serie conta i giorni lavorativi: di sabato e domenica si guarda da venerdi'
    await expect(s.locator('.v-prow > span').first()).toHaveText('+5oggi');
    await expect(s.locator('.v-prow > span').nth(1)).toHaveText(LAVORATIVO ? '1giorno di fila' : '0giorni di fila');
    await expect(s.locator('.v-wk i')).toHaveText(['L', 'M', 'M', 'G', 'V']);
    await expect(s.locator('.v-wk i.on')).toHaveCount(LAVORATIVO ? 1 : 0);
    if (LAVORATIVO) await expect(s.locator('.v-wk i').nth(dow(OGGI))).toHaveClass(/(^|\s)on(\s|$)/);
    await expect(s.locator('.v-pcard')).toContainText('Ancora 13 paillettes per Junior');
    // la scala: dalla regina in cima a Stagista in fondo, quello attuale evidenziato e quanto manca al prossimo
    await expect(s.locator('.v-lad .v-lv b')).toHaveText([...LIVELLI].reverse());
    await expect(s.locator('.v-lad .v-lv.on b')).toHaveText('Stagista');
    await expect(s.locator('.v-lad .v-lv.on small')).toHaveText('adesso');
    await expect(s.locator('.v-lad .v-lv.preso')).toHaveCount(0);
    await expect(s.locator('.v-lad .v-lv', { hasText: 'Junior' }).locator('small')).toHaveText('mancano 13');
    await expect(s.locator('.v-lad .v-lv', { hasText: 'Production Assistant' }).locator('small')).toHaveText('da 1.000');
    await expect(s.locator('.v-lad .v-lv', { hasText: 'Executive Queen' }).locator('small')).toHaveText('da 15.000');
    // medaglie: tutte e 8, presa solo la prima presenza
    await expect(s.locator('.v-meds .v-med')).toHaveCount(8);
    await expect(s.locator('.v-meds .v-med.presa b')).toHaveText(['Prima presenza']);
    await expect(s.locator('h3.v-sec', { hasText: 'Medaglie' }).locator('small')).toHaveText('1 di 8');
    // le voci che hanno dato punti, la piu' recente prima: 3 presenze, 6 ordini (G0 cancellato no), 3 arrivi (il secondo
    // della stessa riga lo stesso giorno no), 1 conta, 1 data
    const voci = s.locator('.v-voce');
    await expect(voci).toHaveCount(14);
    await expect(voci.first().locator('.pt')).toHaveText('+5');
    await expect(voci.first().locator('b')).toHaveText('Presenza');
    await expect(voci.first().locator('small')).toHaveText('oggi');
    await expect(s.locator('.v-voce', { hasText: 'Ordine · 3 righe' })).toContainText('a Francesco');
    await expect(s.locator('.v-voce', { hasText: 'Ordine · 3 righe' }).locator('.pt')).toHaveText('+35');
    await expect(s.locator('.v-voce', { hasText: 'Arrivo registrato · 4 pz' })).toContainText('Lea cocco nero');
    await expect(s.locator('.v-voce', { hasText: 'Ordine · 0 righe' })).toHaveCount(0);
    await expect(s.locator('.v-voce', { hasText: 'Data di consegna aggiunta' })).toContainText('Sophie camoscio marrone');
    await expect(s.locator('.v-regole li')).toHaveCount(6);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    expect(r.letture.eventi).toBeGreaterThan(0);
    expect(r.posts).toEqual([]);   // la presenza di oggi era gia' segnata su questo telefono
    expect(r.errori).toEqual([]);
  });

  test('presenza: una sola villaggio_presenza al giorno con chi Ginevra, anche ricaricando o tornando in primo piano; il giorno dopo si riprova', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, 'villaggio/', dati);
    await hud(page);
    await expect.poll(() => presenze(r.posts).length, ATTESA).toBe(1);
    const p = presenze(r.posts)[0];
    expect(p.url).toBe('https://e2e-progetto-finto.supabase.co/functions/v1/write-api');
    expect(corpo(p)).toEqual({ action: 'villaggio_presenza', payload: {}, pin: 'x', chi: 'Ginevra' });
    // la presenza nuova rilegge: +5 dorato su Ginni, toast, e Ginni presenta le missioni del giorno
    await pillola(page, String(BASE + 5), 'Stagista');
    await compare(page, '__float', '+5');
    await compare(page, '__avvisi', '+5 paillettes');
    await compare(page, '__fumetti', 'Buongiorno! Oggi ho 3 missioni per te: le trovi sotto la stella.');
    expect(await page.evaluate(() => localStorage.getItem('amimi_villaggio_presenza'))).toBe(`Ginevra|${OGGI}`);
    // la PWA che torna in primo piano lo stesso giorno: niente seconda presenza
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(1500);
    expect(presenze(r.posts)).toHaveLength(1);
    // riaperta lo stesso giorno: la guardia del telefono basta
    await page.reload();
    await hud(page);
    await pillola(page, String(BASE + 5), 'Stagista');
    await page.waitForTimeout(2000);
    expect(presenze(r.posts)).toHaveLength(1);
    // il giorno dopo (la guardia dice ieri) la PWA rimasta aperta torna in primo piano: riprova; qui il server dice che
    // la presenza c'e' gia' e non cambia niente
    await page.evaluate((ieri) => { localStorage.setItem('amimi_villaggio_presenza', `Ginevra|${ieri}`); document.dispatchEvent(new Event('visibilitychange')); }, traGiorni(-1));
    await expect.poll(() => presenze(r.posts).length, ATTESA).toBe(2);
    expect(corpo(presenze(r.posts)[1])).toEqual({ action: 'villaggio_presenza', payload: {}, pin: 'x', chi: 'Ginevra' });
    await expect.poll(() => page.evaluate(() => localStorage.getItem('amimi_villaggio_presenza')), ATTESA).toBe(`Ginevra|${OGGI}`);
    await pillola(page, String(BASE + 5), 'Stagista');
    expect(r.eventi.filter((e) => e.tipo === 'presenza' && e.giorno === OGGI)).toHaveLength(1);
    expect(r.posts.map((x) => x.body.action)).toEqual(['villaggio_presenza', 'villaggio_presenza']);
    expect(r.errori).toEqual([]);
  });

  test('soglia: la presenza porta da 297 a 302, "+5" dorato, festa e "Sei diventata Junior!", la pillola sale di livello', async ({ page }) => {
    const dati = datiBase();
    // 15 in piu' sulla base (una data aggiunta vecchia): 297, a 3 da Junior
    const eventi = [...eventiBase(), ev('data_aggiunta', traGiorni(-21), '00000000-0000-0000-0000-0000000000e1')];
    const r = await apri(page, 'villaggio/', dati, { eventi });
    await hud(page);
    await expect.poll(() => presenze(r.posts).length, ATTESA).toBe(1);
    await pillola(page, '302', 'Junior');
    await expect(pai(page)).toHaveAttribute('aria-label', 'Le tue paillettes: 302, livello Junior');
    await compare(page, '__float', '+5');
    await compare(page, '__float', 'festa:Junior');
    await compare(page, '__avvisi', '+5 paillettes');
    // il fumetto: prima il livello nuovo e il suo premio, poi le missioni del giorno
    await compare(page, '__fumetti', 'Sei diventata Junior!');
    const f = await registrati(page, '__fumetti');
    expect(f[0]).toBe('Sei diventata Junior!');
    const dlg = page.locator('.v-dlg');
    for (let i = 0; i < 6 && (await dlg.getAttribute('aria-label')) === 'Ginni: Sei diventata Junior!'; i++) { await dlg.click(); await page.waitForTimeout(150); }
    await expect(dlg).toHaveAttribute('aria-label', 'Ginni: Lungo i sentieri sono spuntate le aiuole fiorite.', ATTESA);
    // la prima lettura non festeggia lo storico: un solo "+n" e una sola festa
    const fl = await registrati(page, '__float');
    expect(fl.filter((x) => x.startsWith('festa:'))).toEqual(['festa:Junior']);
    expect(fl.filter((x) => /^\+\d/.test(x))).toEqual(['+5']);
    await pai(page).click();
    await expect(sheet(page).locator('.v-lad .v-lv.on b')).toHaveText('Junior');
    await expect(sheet(page).locator('.v-lad .v-lv.preso b')).toHaveText(['Stagista']);
    await expect(sheet(page).locator('.v-lad .v-lv', { hasText: 'Production Assistant' }).locator('small')).toHaveText('mancano 698');
    expect(r.errori).toEqual([]);
  });

  test('verifica fornitore: solo le righe aperte del laboratorio, date e confermata; il bottone si spegne mentre salva; poi +50 e la medaglia', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra', presenzaFatta: true, trattieniVerifica: true });
    await hud(page);
    await pillola(page, '287', 'Stagista');
    await etichettaLab(page, 'Francesco').click();
    await expect(sheet(page).locator('h2')).toHaveText('Francesco sta preparando');
    await sheet(page).getByRole('button', { name: '✓ Verifica con Francesco' }).click();
    const s = sheet(page);
    await expect(s.locator('h2')).toHaveText('Verifica con Francesco');
    await expect(s.locator('.v-note').first()).toHaveText('2 righe. Spegni quelle che Francesco non sta lavorando.');
    // le due righe aperte di Francesco: non la zebrata (completa), non Nina (Sarte Milano)
    const righe = s.locator('.v-vrow');
    await expect(righe.locator('.v-rt > b')).toHaveText(['Lea · Cocco nero', 'Sophie · Camoscio marrone']);
    const lea = s.locator('.v-vrow', { hasText: 'Cocco nero' }), sophie = s.locator('.v-vrow', { hasText: 'Camoscio marrone' });
    await expect(lea).toContainText('10 giorni di ritardo');
    await expect(lea.locator('input[type="date"]')).toHaveValue(traGiorni(-10));
    await expect(sophie.locator('input[type="date"]')).toHaveValue(traGiorni(20));
    await expect(lea.locator('.v-sw input')).toBeChecked();
    await expect(sophie.locator('.v-sw input')).toBeChecked();
    // Sophie non e' in lavorazione; Lea arriva fra una settimana
    await sophie.locator('label.v-sw').click();
    await expect(sophie.locator('.v-sw input')).not.toBeChecked();
    await expect(sophie.locator('.v-sw')).toHaveText('non confermata');
    await expect(sophie).toHaveClass(/(^|\s)no(\s|$)/);
    await lea.locator('input[type="date"]').fill(traGiorni(7));
    await s.locator('textarea.v-nota').fill('Lea cocco nero spedita venerdì');
    // toccata, la verifica non si perde senza chiedere: la X chiede, Annulla la tiene com'e'
    r.conferme.accetta = false;
    await page.locator('.v-sheet .v-x').click();
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(1);
    expect(r.dialoghi[0]).toBe('Lasci la verifica a metà? Quello che hai scritto si perde.');
    await expect(s.locator('h2')).toHaveText('Verifica con Francesco');
    await expect(lea.locator('input[type="date"]')).toHaveValue(traGiorni(7));
    r.conferme.accetta = true;

    const salva = s.getByRole('button', { name: /la verifica/ });
    await expect(salva).toHaveText('Salva la verifica');
    await salva.click();
    // il server risponde solo quando lo dice il test: intanto il bottone e' spento e un secondo tocco non riscrive
    await expect.poll(() => di(r.posts, 'fornitore_verifica').length, ATTESA).toBe(1);
    await expect(salva).toBeDisabled();
    await expect(salva).toHaveText('Salvo la verifica…');
    await salva.evaluate((b: HTMLButtonElement) => b.click());
    await page.waitForTimeout(500);
    expect(di(r.posts, 'fornitore_verifica')).toHaveLength(1);
    const p = di(r.posts, 'fornitore_verifica')[0];
    expect(p.body.chi).toBe('Ginevra');
    expect(p.body.pin).toBe('x');
    expect(p.body.payload).toEqual({
      fornitore: FRANCESCO, nota: 'Lea cocco nero spedita venerdì',
      righe: [{ id: ID.lea, confermata: true, data_consegna: traGiorni(7) }, { id: ID.sophie, confermata: false, data_consegna: traGiorni(20) }],
    });
    r.sblocca();

    // salvata: toast con le date, la rilettura porta +50 e la prima medaglia nuova, e si torna al laboratorio
    await compare(page, '__avvisi', 'Verifica con Francesco salvata: 1 data aggiornata. +50 paillettes · Medaglia nuova: Prima verifica!');
    await compare(page, '__float', '+50');
    await pillola(page, '337', 'Junior');
    await expect(sheet(page).locator('h2')).toHaveText('Francesco sta preparando', ATTESA);
    await expect(sheet(page).locator('.v-row', { hasText: 'Cocco nero' })).not.toContainText('di ritardo');
    expect(dati.ordini.find((x) => x.id === ID.lea)?.data_consegna).toBe(traGiorni(7));
    expect(r.eventi.filter((e) => e.tipo === 'verifica')).toMatchObject([{ giorno: OGGI, ref: FRANCESCO, n: 1 }]);
    expect(r.dialoghi).toHaveLength(1);
    expect(r.posts.map((x) => x.body.action)).toEqual(['fornitore_verifica']);
    expect(r.errori).toEqual([]);
  });

  test('giro di conta dal Magazzino: prima il negativo, poi pila per pila; la conta va alla write-api col codice mostrato e si passa al prossimo', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra', presenzaFatta: true });
    await hud(page);
    await pillola(page, '287', 'Stagista');
    await barra(page, 'Magazzino').click();
    await expect(sheet(page).locator('h2')).toHaveText('Magazzino');
    // i codici con giacenza diversa da 0: Sophie -1, cocco nero 7, zebrata 3 (Nina a 0 no)
    await sheet(page).getByRole('button', { name: 'Giro di conta · 3 codici' }).click();
    const s = sheet(page);
    await expect(s.locator('h2')).toHaveText('Giro di conta');
    await expect(s.locator('.v-giro b')).toHaveText('1 / 3');
    await expect(s.locator('.v-qty b')).toHaveText('Sophie · Camoscio marrone');
    await expect(s.locator('.v-qty small')).toHaveText('SOPHIE_BAG_SUEDE_BROWN · in magazzino -1');
    // il CountForm di Magazzino, gia' sul prodotto e con la giacenza letta per quel codice
    const form = s.locator('.v-conta');
    await expect(form.locator('.ds-picked')).toBeVisible(ATTESA);
    await expect(form.locator('.sysrow b')).toHaveText('-1 pz', ATTESA);
    await form.locator('input.num').fill('0');
    await expect(form.locator('.deltabadge')).toHaveText('Delta +1 (in più)');
    await expect(s.getByRole('button', { name: 'Salta ›' })).toBeVisible();
    await form.getByRole('button', { name: 'Applica conta' }).click();
    await expect.poll(() => di(r.posts, 'count').length, ATTESA).toBe(1);
    const p = di(r.posts, 'count')[0];
    expect(p.body).toMatchObject({ action: 'count', pin: 'x', chi: 'Ginevra' });
    expect(p.body.payload).toEqual({ codice: 'SOPHIE_BAG_SUEDE_BROWN', modello: 'SOPHIE BAG', variante: 'SUEDE BROWN', contati: 0, data_conta: OGGI, nota: null });
    expect(r.dialoghi).toEqual([]);   // rettifica di 1 pezzo: nessuna conferma
    // contato: si passa da soli al codice dopo, la pila piu' alta di Lea prima
    await expect(s.locator('.v-giro b')).toHaveText('2 / 3', ATTESA);
    await expect(s.locator('.v-qty small')).toHaveText('LEA_BAG_COCCO_BLACK · in magazzino 7');
    await expect(s.locator('.v-conta .sysrow b')).toHaveText('7 pz', ATTESA);
    await compare(page, '__avvisi', 'Giacenza corretta · SOPHIE BAG SUEDE BROWN ora = 0 (+1)');
    await compare(page, '__float', '+2');
    await compare(page, '__avvisi', '+2 paillettes');
    await pillola(page, '289', 'Stagista');
    // Salta non scrive niente
    await s.getByRole('button', { name: 'Salta ›' }).click();
    await expect(s.locator('.v-giro b')).toHaveText('3 / 3');
    await expect(s.locator('.v-qty small')).toHaveText('LEA_BAG_PONY_ZEBRA · in magazzino 3');
    await s.getByRole('button', { name: 'Salta ›' }).click();
    await expect(s.locator('.v-fine')).toHaveText('Giro finito: 1 codice contato su 3.');
    await s.getByRole('button', { name: 'Chiudi il giro' }).click();
    await expect(sheet(page)).toHaveCount(0);
    // Sophie ora e' a 0: il giro dopo ha due codici
    await barra(page, 'Magazzino').click();
    await expect(sheet(page).getByRole('button', { name: 'Giro di conta · 2 codici' })).toBeVisible(ATTESA);
    expect(r.posts.map((x) => x.body.action)).toEqual(['count']);
    expect(r.errori).toEqual([]);
  });

  test('missioni: la stella col numero, l\'elenco dai dati (verifica, negativi, date), ogni missione apre la sua azione e diventa fatta', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra' });
    await hud(page);
    await expect.poll(() => presenze(r.posts).length, ATTESA).toBe(1);
    await pillola(page, String(BASE + 5), 'Stagista');
    const testi = ['Verifica con Francesco · 1 riga in ritardo', 'Conta il codice negativo', 'Chiedi a Sarte Milano la data di 1 riga'];
    // alla prima presenza del giorno Ginni le presenta nel fumetto, una per una
    await compare(page, '__fumetti', 'Buongiorno! Oggi ho 3 missioni per te: le trovi sotto la stella.');
    const dlg = page.locator('.v-dlg');
    for (const t of testi) {
      for (let i = 0; i < 6 && (await dlg.getAttribute('aria-label')) !== 'Ginni: ' + t + '.'; i++) { await dlg.click(); await page.waitForTimeout(150); }
      await expect(dlg).toHaveAttribute('aria-label', 'Ginni: ' + t + '.');
    }
    const stella = page.locator('.v-hud .v-mis');
    await expect(stella).toHaveAttribute('aria-label', 'Missioni di oggi: 3 da fare');
    await expect(stella.locator('.v-nb')).toHaveText('3');
    await stella.click();
    const s = sheet(page);
    await expect(s.locator('h2')).toHaveText('Missioni di oggi');
    await expect(s.locator('.v-shead p')).toHaveText(/^0 di 3 fatte/);
    await expect(s.locator('.v-mrow b')).toHaveText(testi);
    await expect(s.locator('.v-mrow small')).toHaveText(['Apri la verifica', 'Apri il giro di conta', 'Apri la verifica']);
    await expect(s.locator('.v-mrow .v-chip')).toHaveText(['da fare', 'da fare', 'da fare']);
    // la prima apre la verifica di Francesco; non toccata, la X chiude senza chiedere
    await s.locator('.v-mrow', { hasText: testi[0] }).click();
    await expect(s.locator('h2')).toHaveText('Verifica con Francesco');
    await page.locator('.v-sheet .v-x').click();
    await expect(sheet(page)).toHaveCount(0);
    // la seconda apre il giro sul solo codice negativo
    await stella.click();
    await sheet(page).locator('.v-mrow', { hasText: testi[1] }).click();
    await expect(s.locator('h2')).toHaveText('Giro di conta');
    await expect(s.locator('.v-giro b')).toHaveText('1 / 1');
    await expect(s.locator('.v-qty small')).toHaveText('SOPHIE_BAG_SUEDE_BROWN · in magazzino -1');
    await expect(s.locator('.v-conta .sysrow b')).toHaveText('-1 pz', ATTESA);
    await s.locator('.v-conta input.num').fill('0');
    await s.locator('.v-conta').getByRole('button', { name: 'Applica conta' }).click();
    await expect(s.locator('.v-fine')).toHaveText('Giro finito: 1 codice contato su 1.', ATTESA);
    expect(di(r.posts, 'count')[0].body.payload).toMatchObject({ codice: 'SOPHIE_BAG_SUEDE_BROWN', contati: 0 });
    await s.getByRole('button', { name: 'Chiudi il giro' }).click();
    // contato il negativo (ora a 0) la missione resta in elenco, fatta
    await expect(stella).toHaveAttribute('aria-label', 'Missioni di oggi: 2 da fare', ATTESA);
    await expect(stella.locator('.v-nb')).toHaveText('2');
    await stella.click();
    await expect(s.locator('.v-shead p')).toHaveText(/^1 di 3 fatte/);
    await expect(s.locator('.v-mrow b')).toHaveText(testi);
    await expect(s.locator('.v-mrow', { hasText: testi[1] })).toHaveClass(/(^|\s)fatta(\s|$)/);
    await expect(s.locator('.v-mrow .v-chip')).toHaveText(['da fare', 'fatta', 'da fare']);
    expect(r.posts.map((x) => x.body.action)).toEqual(['villaggio_presenza', 'count']);
    expect(r.errori).toEqual([]);
  });
});

test.describe('Paillettes accese, chi non gioca', () => {
  test('Ale nell\'app intera: pillola di Ginni in sola lettura, niente missioni ne\' presenza', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati, { chi: 'Ale' });
    await hud(page);
    await pillola(page, String(BASE), 'Ginni · Stagista');
    await expect(pai(page)).toHaveAttribute('aria-label', `Paillettes di Ginni: ${BASE}, livello Stagista`);
    await page.waitForTimeout(2500);
    await expect(page.locator('.v-hud .v-mis')).toHaveCount(0);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(1500);
    expect(r.posts).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('amimi_villaggio_presenza'))).toBeNull();
    await pai(page).click();
    await expect(sheet(page).locator('h2')).toHaveText('Il percorso di Ginni');
    await expect(sheet(page).locator('.v-shead p')).toHaveText(`${BASE} paillettes · Stagista`);
    await expect(sheet(page).locator('.v-lad .v-lv')).toHaveCount(7);
    await expect(sheet(page).locator('.v-meds .v-med')).toHaveCount(8);
    const fl = await registrati(page, '__float');
    expect(fl, 'chi non gioca non vede "+n" ne\' feste').toEqual([]);
    expect(r.letture.eventi).toBeGreaterThan(0);
    expect(r.errori).toEqual([]);
  });

  test('app a se\' con Benny: sola lettura; scelta Ginni dal menu "scrive", parte la sua presenza', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, 'villaggio/', dati, { chi: 'Bene' });
    await hud(page);
    await expect(page.locator('.v-hud .v-chi select')).toHaveValue('Bene');
    await pillola(page, String(BASE), 'Ginni · Stagista');
    await page.waitForTimeout(2000);
    await expect(page.locator('.v-hud .v-mis')).toHaveCount(0);
    expect(r.posts).toEqual([]);
    await page.locator('.v-hud .v-chi select').selectOption('Ginevra');
    await expect.poll(() => presenze(r.posts).length, ATTESA).toBe(1);
    expect(corpo(presenze(r.posts)[0])).toEqual({ action: 'villaggio_presenza', payload: {}, pin: 'x', chi: 'Ginevra' });
    await pillola(page, String(BASE + 5), 'Stagista');
    await expect(page.locator('.v-hud .v-mis')).toHaveAttribute('aria-label', 'Missioni di oggi: 3 da fare', ATTESA);
    expect(r.errori).toEqual([]);
  });
});
