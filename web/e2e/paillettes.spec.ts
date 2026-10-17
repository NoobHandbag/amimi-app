import { test, expect, type Page } from '@playwright/test';

// Paillettes (fase 2 del Villaggio, migr 0164): i punti di Ginni. Come villaggio.spec.ts NON tocca Supabase: ogni richiesta
// a *.supabase.co riceve dati finti (v_ordini_arrivo, v_inventory, products, v_villaggio_settings con le quattro chiavi,
// v_villaggio_eventi a pagine, change_log per il feed di Salute) e le POST alla write-api sono registrate e risposte qui
// come farebbe write-api v29: villaggio_presenza (idempotente per giorno, ignorata per chi non gioca),
// villaggio_conta_completa (una al mese, idempotente sulla PK, ignorata per chi non gioca), fornitore_verifica (date
// aggiornate, eventi verifica e data_aggiunta), count (giacenza corretta, evento conta). Gli eventi nuovi li aggiunge il
// finto server solo per la giocatrice, come la vista v_villaggio_eventi. I punti attesi sono contati a mano qui sotto, non
// con paillettes.ts.
// Lanciare dopo la build verso il progetto finto (come la CI), sempre col percorso del file:
//   VITE_SUPABASE_URL=https://e2e-progetto-finto.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_e2e_finto npx vite build --outDir <cartella>
//   npx vite preview --outDir <cartella> --port <porta libera> --strictPort
//   CI=1 E2E_PORT=<porta> npx playwright test e2e/paillettes.spec.ts

// WebGL senza GPU (SwiftShader): tempi larghi come villaggio.spec.ts
test.describe.configure({ timeout: 300000 });
const ATTESA = { timeout: 40000 };

const romaIso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const OGGI = romaIso(new Date());
/** Il giorno `n` giorni dopo `base` ('YYYY-MM-DD'): a mezzogiorno UTC, cosi' il cambio dell'ora legale non sposta la data. */
const sposta = (base: string, n: number) => new Date(Date.parse(base + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const traGiorni = (n: number) => sposta(OGGI, n);
/** 0 = lunedi' ... 6 = domenica */
const dow = (iso: string) => (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7;
const LAVORATIVO = dow(OGGI) < 5;
/** "ottobre": il mese come lo scrive la pagina (nome del mese di Roma). */
const nomeMese = (iso: string) => new Date(iso.slice(0, 7) + '-15T12:00:00').toLocaleDateString('it-IT', { month: 'long' });
const MESE = nomeMese(OGGI);
/** "7 ottobre" (la data breve della verifica) e "7 ott" (quella del feed attivita'). */
const dataLunga = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
const dataCorta = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

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
const RIGA_VECCHIA = '00000000-0000-0000-0000-0000000000e1';

// Gli stessi dati di villaggio.spec.ts. Francesco: Lea cocco nero 4/10 IN RITARDO di 10 giorni, Sophie camoscio 0/5 (consegna
// fra 20 giorni), Lea zebrata 3/3 completa. Sarte Milano: Nina righe rosse 0/8 senza data. Magazzino: Sophie -1 (negativa),
// Nina 0, zebrata 3, cocco nero 7: il giro di conta completo passa i 3 codici con giacenza diversa da 0. `base` e' il giorno
// di "oggi" (quello vero, o quello dell'orologio finto).
function datiBase(base = OGGI) {
  const g = (n: number) => sposta(base, n);
  const ordini: Riga[] = [
    riga(ID.lea, 'G1', FRANCESCO, 'LEA_BAG_COCCO_BLACK', 'LEA BAG', 'COCCO BLACK', 10, 4, g(-10)),
    riga(ID.sophie, 'G1', FRANCESCO, 'SOPHIE_BAG_SUEDE_BROWN', 'SOPHIE BAG', 'SUEDE BROWN', 5, 0, g(20)),
    riga(ID.zebra, 'G1', FRANCESCO, 'LEA_BAG_PONY_ZEBRA', 'LEA BAG', 'PONY ZEBRA', 3, 3, g(-40)),
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

type Evento = { tipo: 'presenza' | 'ordine' | 'arrivo' | 'conta' | 'conta_completa' | 'verifica' | 'data_aggiunta'; giorno: string; ts: string; ref: string; n: number };
/** Un evento come lo restituisce PostgREST da v_villaggio_eventi (ts con i microsecondi e +00:00). */
const ev = (tipo: Evento['tipo'], giorno: string, ref: string, n = 1, ora = '09:30'): Evento => ({ tipo, giorno, ts: `${giorno}T${ora}:00.000000+00:00`, ref, n });
const adesso = () => new Date().toISOString().slice(11, 16);

/** Un mese di Ginni, contato a mano con le regole del contratto (sez. 3), 282 paillettes, Stagista:
 *  - presenze -12 e -11: 2 x 5 = 10 (due giorni non fanno una settimana piena, e sono di settimane passate)
 *  - ordini: G1 3 righe 35, G2 1 riga 25, G0 cancellato (n = 0) 0, quattro vecchi da 4, 6, 2, 5 righe 40 + 50 + 30 + 45: 225
 *  - arrivi: zebrata -15 10, cocco nero -14 10 (il secondo arrivo della stessa riga lo stesso giorno: 0), riga vecchia -21 10: 30
 *  - conte: zebrata -18 2 (la seconda conta dello stesso codice lo stesso giorno: 0): 2
 *  - date aggiunte: Sophie -16 15
 *  Nessuna verifica e nessuna conta completa: la prima di ognuna fa scattare la sua medaglia. Medaglie gia' prese: solo
 *  "Prima presenza". */
const BASE = 282;
function eventiBase(base = OGGI): Evento[] {
  const g = (n: number) => sposta(base, n);
  return [
    ev('presenza', g(-12), g(-12), 1, '07:10'), ev('presenza', g(-11), g(-11), 1, '07:05'),
    ev('ordine', g(-28), 'G-OLD1', 4), ev('ordine', g(-27), 'G-OLD2', 6), ev('ordine', g(-26), 'G-OLD3', 2),
    ev('ordine', g(-24), 'G-OLD4', 5), ev('ordine', g(-25), 'G1', 3), ev('ordine', g(-22), 'G0', 0), ev('ordine', g(-20), 'G2', 1),
    ev('arrivo', g(-21), RIGA_VECCHIA, 2), ev('arrivo', g(-15), ID.zebra, 3),
    ev('arrivo', g(-14), ID.lea, 4, '10:00'), ev('arrivo', g(-14), ID.lea, 1, '15:20'),
    ev('conta', g(-18), 'LEA_BAG_PONY_ZEBRA', 1, '11:00'), ev('conta', g(-18), 'LEA_BAG_PONY_ZEBRA', 1, '11:40'),
    ev('data_aggiunta', g(-16), ID.sophie),
  ];
}
/** 15 in piu' sulla base (una data aggiunta vecchia): 297, e con la presenza di oggi 302, Junior. */
const eventiDa297 = () => [...eventiBase(), ev('data_aggiunta', traGiorni(-21), RIGA_VECCHIA)];

type Post = { url: string; body: { action: string; payload: Record<string, unknown>; pin: string; chi: string; force?: boolean } };
/** villaggio_paillettes_enabled come lo scrive app_flags ('true', 'false', ' true'...), o 'assente' = vista ancora della 0162
 *  (solo villaggio_enabled). Acceso solo 'true' esatto, come per la vista e la write-api. */
type FlagPai = string;
/** Le risposte che il finto server tiene ferme finche' il test non le sblocca. */
type Trattenuta = 'verifica' | 'presenza' | 'conta_completa' | 'eventi';
type Opzioni = {
  chi?: string; paillettes?: FlagPai; eventi?: Evento[]; presenzaFatta?: boolean; trattieni?: Trattenuta[];
  /** amimi_paillettes_livello gia' sul telefono (l'ultimo livello festeggiato): scritto una volta sola per scheda, un reload lo lascia. */
  livello?: string;
  /** Il giorno di Roma dell'orologio finto del browser (page.clock): l'app, il finto server e i dati lo prendono per oggi. */
  oggi?: string;
  /** La giocatrice per la write-api, se diversa da quella delle impostazioni lette all'avvio (flag cambiato intanto). */
  giocatriceServer?: string;
  changeLog?: unknown[];
};

const AZIONI_CONSENTITE = new Set(['arrival_set', 'order_multi', 'count', 'villaggio_presenza', 'villaggio_conta_completa', 'fornitore_verifica']);
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
  const oggiS = opts.oggi ?? OGGI;
  const eventi = opts.eventi ?? eventiBase(oggiS);
  const sblocchi: Partial<Record<Trattenuta, () => void>> = {};
  const attese: Partial<Record<Trattenuta, Promise<void>>> = {};
  for (const k of opts.trattieni ?? []) attese[k] = new Promise<void>((ok) => { sblocchi[k] = ok; });
  const aspetta = (k: Trattenuta) => attese[k] ?? Promise.resolve();
  page.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
  page.on('pageerror', (e) => errori.push('pageerror: ' + e.message));
  page.on('dialog', (d) => { dialoghi.push(d.message()); void (conferme.accetta ? d.accept() : d.dismiss()); });
  // l'orologio finto parte prima della pagina e poi scorre normale: animazioni, timer e WebGL vanno come sempre
  if (opts.oggi) await page.clock.install({ time: new Date(opts.oggi + 'T08:00:00Z') });
  await page.addInitScript(({ chi, presenza, livello }) => {
    if (chi) localStorage.setItem('amimi_chi', chi);
    localStorage.setItem('amimi_villaggio_intro', '1');
    if (presenza) localStorage.setItem('amimi_villaggio_presenza', presenza);
    if (livello != null && !sessionStorage.getItem('e2e_livello_scritto')) {
      localStorage.setItem('amimi_paillettes_livello', livello);
      sessionStorage.setItem('e2e_livello_scritto', '1');
    }
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
  }, { chi: opts.chi ?? null, presenza: opts.presenzaFatta ? `${GIOCATRICE}|${oggiS}` : null, livello: opts.livello ?? null });
  if (opts.presenzaFatta && !eventi.some((e) => e.tipo === 'presenza' && e.giorno === oggiS)) eventi.push(ev('presenza', oggiS, oggiS, 1, '06:45'));
  await page.route(/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route(/supabase\.co\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/functions/v1/write-api') && req.method() === 'POST') {
      const p: Post = { url: req.url(), body: req.postDataJSON() };
      posts.push(p);
      const a = p.body.action, gioca = p.body.chi === (opts.giocatriceServer ?? GIOCATRICE);
      if ((a === 'villaggio_presenza' || a === 'villaggio_conta_completa' || a === 'fornitore_verifica') && pai !== 'true') return json({ error: 'paillettes spente' }, 409);
      if (a === 'villaggio_presenza') {
        await aspetta('presenza');
        if (!gioca) return json({ ok: true, nuova: false, ignorata: true });
        if (eventi.some((e) => e.tipo === 'presenza' && e.giorno === oggiS)) return json({ ok: true, nuova: false });
        eventi.push(ev('presenza', oggiS, oggiS, 1, adesso()));
        return json({ ok: true, nuova: true });
      }
      if (a === 'villaggio_conta_completa') {
        await aspetta('conta_completa');
        const c = (p.body.payload as { codici?: unknown }).codici;
        if (typeof c !== 'number' || !Number.isInteger(c) || c < 0) return json({ error: 'codici contati non validi (intero >= 0)' }, 422);
        if (!gioca) return json({ ok: true, nuova: false, ignorata: true });
        // PK (chi, mese di Roma), on conflict do nothing: la seconda del mese non scrive e non cambia i codici
        const mese = oggiS.slice(0, 7);
        if (eventi.some((e) => e.tipo === 'conta_completa' && e.ref === mese)) return json({ ok: true, nuova: false });
        eventi.push(ev('conta_completa', oggiS, mese, c, adesso()));
        return json({ ok: true, nuova: true });
      }
      if (a === 'fornitore_verifica') {
        await aspetta('verifica');
        const pl = p.body.payload as { fornitore: string; righe: { id: string; confermata: boolean; data_consegna: string | null }[]; nota?: string | null };
        if (!pl.fornitore || !Array.isArray(pl.righe) || !pl.righe.length) return json({ error: 'fornitore e righe obbligatori' }, 422);
        // come write-api: si leggono solo le righe di quel fornitore, le altre si ignorano
        const lette = pl.righe.flatMap((x) => { const r = dati.ordini.find((o) => o.id === x.id && o.fornitore === pl.fornitore); return r ? [{ x, r }] : []; });
        if (!lette.length) return json({ error: 'nessuna riga del fornitore' }, 422);
        let cambiate = 0;
        const fatte = lette.map(({ x, r }) => {
          // come write-api: una data vuota su una riga che la data l'ha non la cancella
          const prima = r.data_consegna, dopo = x.data_consegna || prima;
          if (prima !== dopo) { r.data_consegna = dopo; r.data_consegna_display = dopo; cambiate++; }
          return { id: r.id, confermata: x.confermata, prima, dopo };
        });
        if (gioca) {
          eventi.push(ev('verifica', oggiS, pl.fornitore, fatte.filter((c) => c.confermata).length, adesso()));
          for (const c of fatte) if (!c.prima && c.dopo) eventi.push(ev('data_aggiunta', oggiS, c.id, 1, adesso()));
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
        righe.push({ key: 'villaggio_paillettes_enabled', value: pai }, { key: 'villaggio_paillettes_dal', value: sposta(oggiS, -30) }, { key: 'villaggio_paillettes_chi', value: GIOCATRICE });
      }
      return json(righe);
    }
    if (url.pathname.endsWith('/rest/v1/v_villaggio_eventi')) {
      letture.eventi++;
      await aspetta('eventi');
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
    if (url.pathname.endsWith('/rest/v1/change_log')) return json(opts.changeLog ?? []);
    return json([]);
  });
  await page.goto(path);
  return { posts, errori, dialoghi, letture, conferme, eventi, sblocca: (k: Trattenuta) => sblocchi[k]?.() };
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
const feste = async (page: Page) => (await registrati(page, '__float')).filter((x) => x.startsWith('festa:'));
const piu = async (page: Page) => (await registrati(page, '__float')).filter((x) => /^\+\d/.test(x));
const memoria = (page: Page, k: string) => page.evaluate((x) => localStorage.getItem(x), k);
const visibile = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const etichettaLab = (page: Page, nome: string) => page.locator('.v-labels > .v-lbl:not(.v-mini):not(.v-zone):not(.v-wh)', { hasText: nome });
const barra = (page: Page, testo: string) => page.locator('.v-bar .v-rb', { hasText: testo });
const sheet = (page: Page) => page.locator('.v-sheet.open');
const LIVELLI = ['Stagista', 'Junior', 'Production Assistant', 'Coordinator', 'Production Manager', 'Head of Production', 'Executive Queen of Fashion Production'];

for (const caso of [
  { nome: 'villaggio_paillettes_enabled = \'false\'', flag: 'false' },
  // il valore grezzo: la vista e la write-api confrontano 'true' esatto, quindi con uno spazio sono spente anche nell'app
  { nome: 'villaggio_paillettes_enabled = \' true\' (spazio davanti)', flag: ' true' },
  { nome: 'villaggio_paillettes_enabled = \'true \' (spazio dietro)', flag: 'true ' },
  { nome: 'vista ancora della 0162 (niente chiavi delle Paillettes, v_villaggio_eventi assente)', flag: 'assente' },
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
      await visibile(page);
      await page.waitForTimeout(1500);
      expect(r.posts).toEqual([]);
      expect(r.letture.eventi).toBe(0);
      expect(await memoria(page, 'amimi_paillettes_livello')).toBeNull();
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
    await expect(s.locator('.v-regole li').last()).toContainText('+500 per la conta completa, registrata in fondo al giro di conta completo del Magazzino, una al mese');
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
    expect(await memoria(page, 'amimi_villaggio_presenza')).toBe(`Ginevra|${OGGI}`);
    // la PWA che torna in primo piano lo stesso giorno: niente seconda presenza
    await visibile(page);
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
    await expect.poll(() => memoria(page, 'amimi_villaggio_presenza'), ATTESA).toBe(`Ginevra|${OGGI}`);
    await pillola(page, String(BASE + 5), 'Stagista');
    expect(r.eventi.filter((e) => e.tipo === 'presenza' && e.giorno === OGGI)).toHaveLength(1);
    expect(r.posts.map((x) => x.body.action)).toEqual(['villaggio_presenza', 'villaggio_presenza']);
    expect(r.errori).toEqual([]);
  });

  test('presenza in volo: tre ritorni in primo piano mentre la POST aspetta la risposta non ne mandano una seconda', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, 'villaggio/', dati, { trattieni: ['presenza'] });
    await hud(page);
    await pillola(page, String(BASE), 'Stagista');
    await expect.poll(() => presenze(r.posts).length, ATTESA).toBe(1);
    // la guardia del telefono si scrive solo con la risposta: fino ad allora tiene il ref "in corso"
    await page.evaluate(() => { for (let i = 0; i < 3; i++) document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(800);
    await visibile(page);
    await page.waitForTimeout(1500);
    expect(presenze(r.posts)).toHaveLength(1);
    expect(await memoria(page, 'amimi_villaggio_presenza')).toBeNull();
    r.sblocca('presenza');
    await expect.poll(() => memoria(page, 'amimi_villaggio_presenza'), ATTESA).toBe(`Ginevra|${OGGI}`);
    await pillola(page, String(BASE + 5), 'Stagista');
    await compare(page, '__float', '+5');
    // finita la POST, il ritorno in primo piano dopo trova la guardia del giorno
    await visibile(page);
    await page.waitForTimeout(1500);
    expect(presenze(r.posts)).toHaveLength(1);
    expect(r.eventi.filter((e) => e.tipo === 'presenza' && e.giorno === OGGI)).toHaveLength(1);
    expect(r.errori).toEqual([]);
  });

  test('eventi lenti: HUD, pannelli e giro di conta non aspettano le pagine degli eventi; la pillola arriva con loro', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra', presenzaFatta: true, trattieni: ['eventi'] });
    await hud(page);
    await expect.poll(() => r.letture.eventi, ATTESA).toBeGreaterThan(0);
    await barra(page, 'Magazzino').click();
    await expect(sheet(page).locator('h2')).toHaveText('Magazzino');
    await expect(sheet(page).getByRole('button', { name: 'Giro di conta completo · 3 codici' })).toBeVisible();
    // col Magazzino aperto la camera e' sul magazzino: si chiude prima di toccare il laboratorio
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    await etichettaLab(page, 'Francesco').click();
    await expect(sheet(page).locator('h2')).toHaveText('Francesco sta preparando');
    await expect(sheet(page).getByRole('button', { name: '✓ Verifica con Francesco' })).toBeVisible();
    // senza eventi niente pillola e niente missioni (mai "zero paillettes")
    await expect(pai(page)).toHaveCount(0);
    await expect(page.locator('.v-hud .v-mis')).toHaveCount(0);
    r.sblocca('eventi');
    await pillola(page, '287', 'Stagista');
    await expect(page.locator('.v-hud .v-mis')).toHaveAttribute('aria-label', 'Missioni di oggi: 3 da fare', ATTESA);
    expect(await piu(page), 'la prima lettura non fa "+n"').toEqual([]);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('soglia: la presenza porta da 297 a 302, "+5" dorato, festa e "Sei diventata Junior!", la pillola sale di livello', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, 'villaggio/', dati, { eventi: eventiDa297() });
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
    expect(await feste(page)).toEqual(['festa:Junior']);
    expect(await piu(page)).toEqual(['+5']);
    // il telefono ricorda il livello festeggiato (al primo avvio Stagista, ora Junior)
    expect(await memoria(page, 'amimi_paillettes_livello')).toBe('1');
    await pai(page).click();
    await expect(sheet(page).locator('.v-lad .v-lv.on b')).toHaveText('Junior');
    await expect(sheet(page).locator('.v-lad .v-lv.preso b')).toHaveText(['Stagista']);
    await expect(sheet(page).locator('.v-lad .v-lv', { hasText: 'Production Assistant' }).locator('small')).toHaveText('mancano 698');
    expect(r.errori).toEqual([]);
  });

  for (const caso of [
    { nome: 'primo avvio assoluto da Junior: nessuna festa, il livello si annota', livello: undefined, festa: false, dopo: '1' },
    { nome: 'ultimo festeggiato Stagista e Junior preso fuori dal Villaggio: festa gia\' alla prima lettura', livello: '0', festa: true, dopo: '1' },
    { nome: 'ultimo festeggiato piu\' alto del livello di oggi: niente festa e il valore non si abbassa', livello: '2', festa: false, dopo: '2' },
  ]) {
    test(`festa del livello, ${caso.nome}; riaperto, lo stesso livello non si festeggia due volte`, async ({ page }) => {
      const dati = datiBase();
      // 302 gia' alla prima lettura (presenza di stamattina gia' segnata): nessuna differenza fra due letture
      const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra', presenzaFatta: true, eventi: eventiDa297(), livello: caso.livello });
      await hud(page);
      await pillola(page, '302', 'Junior');
      await expect.poll(() => memoria(page, 'amimi_paillettes_livello'), ATTESA).toBe(caso.dopo);
      if (caso.festa) {
        await compare(page, '__float', 'festa:Junior');
        await compare(page, '__fumetti', 'Sei diventata Junior!');
        expect(await registrati(page, '__fumetti')).toEqual(['Sei diventata Junior!']);
        const dlg = page.locator('.v-dlg');
        for (let i = 0; i < 6 && (await dlg.getAttribute('aria-label')) === 'Ginni: Sei diventata Junior!'; i++) { await dlg.click(); await page.waitForTimeout(150); }
        await expect(dlg).toHaveAttribute('aria-label', 'Ginni: Lungo i sentieri sono spuntate le aiuole fiorite.', ATTESA);
      } else {
        await page.waitForTimeout(2500);
        expect(await registrati(page, '__fumetti')).toEqual([]);
      }
      expect(await feste(page)).toEqual(caso.festa ? ['festa:Junior'] : []);
      expect(await piu(page), 'la prima lettura non fa "+n"').toEqual([]);
      await page.reload();
      await hud(page);
      await pillola(page, '302', 'Junior');
      await page.waitForTimeout(2500);
      expect(await feste(page)).toEqual([]);
      expect(await registrati(page, '__fumetti')).toEqual([]);
      expect(await memoria(page, 'amimi_paillettes_livello')).toBe(caso.dopo);
      expect(r.posts).toEqual([]);
      expect(r.errori).toEqual([]);
    });
  }

  test('verifica fornitore: solo le righe aperte del laboratorio, date e confermata; il bottone si spegne mentre salva; poi +50 e la medaglia', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra', presenzaFatta: true, trattieni: ['verifica'] });
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
    r.sblocca('verifica');

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

  test('verifica: la data mancante si vede; una data svuotata resta quella di prima; il laboratorio che sparisce chiude la verifica toccata', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra', presenzaFatta: true });
    await hud(page);
    await pillola(page, '287', 'Stagista');
    // Sarte Milano: Nina non ha la data, la riga lo dice e la nota la conta
    await barra(page, 'Laboratori').click();
    await sheet(page).locator('.v-lrow', { hasText: 'Sarte Milano' }).click();
    await sheet(page).getByRole('button', { name: '✓ Verifica con Sarte Milano' }).click();
    const s = sheet(page);
    await expect(s.locator('h2')).toHaveText('Verifica con Sarte Milano');
    await expect(s.locator('.v-note').first()).toHaveText('1 riga · 1 senza data. Spegni quelle che Sarte Milano non sta lavorando.');
    const nina = s.locator('.v-vrow');   // l'unica riga aperta di Sarte Milano
    await expect(nina.locator('.v-dt small')).toHaveText('manca la data');
    await expect(nina.locator('.v-dt')).toHaveClass(/(^|\s)manca(\s|$)/);
    await nina.locator('input[type="date"]').fill(traGiorni(12));
    await expect(nina.locator('.v-dt small')).toHaveText('consegna');
    await expect(nina.locator('.v-dt')).not.toHaveClass(/(^|\s)manca(\s|$)/);
    await expect(s.locator('.v-note').first()).toHaveText('1 riga. Spegni quelle che Sarte Milano non sta lavorando.');
    // intanto Nina arriva tutta (registrata da un altro telefono): la rilettura toglie il laboratorio, la verifica toccata
    // si chiude con un avviso e senza chiedere niente
    const n = dati.ordini.find((x) => x.id === ID.nina)!;
    Object.assign(n, { qty_arrived: 8, mancano: 0, completo: true });
    await visibile(page);
    await compare(page, '__avvisi', 'Questo laboratorio non ha più righe aperte: la verifica si chiude senza salvare.');
    await expect(sheet(page)).toHaveCount(0, ATTESA);
    expect(r.dialoghi).toEqual([]);
    // chiusa senza lasciare il modulo "toccato": il prossimo pannello si apre senza conferme
    await barra(page, 'Magazzino').click();
    await expect(sheet(page).locator('h2')).toHaveText('Magazzino');
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    expect(r.dialoghi).toEqual([]);

    // Francesco: la data di Lea svuotata non la toglie, resta quella di prima e non conta come senza data
    await etichettaLab(page, 'Francesco').click();
    await sheet(page).getByRole('button', { name: '✓ Verifica con Francesco' }).click();
    await expect(s.locator('h2')).toHaveText('Verifica con Francesco');
    const lea = s.locator('.v-vrow', { hasText: 'Cocco nero' });
    await lea.locator('input[type="date"]').fill('');
    await expect(lea.locator('input[type="date"]')).toHaveValue('');
    await expect(lea.locator('.v-dt small')).toHaveText(`resta il ${dataLunga(traGiorni(-10))}`);
    await expect(lea.locator('.v-dt')).not.toHaveClass(/(^|\s)manca(\s|$)/);
    await expect(s.locator('.v-note').first()).toHaveText('2 righe. Spegni quelle che Francesco non sta lavorando.');
    await s.getByRole('button', { name: 'Salva la verifica' }).click();
    await expect.poll(() => di(r.posts, 'fornitore_verifica').length, ATTESA).toBe(1);
    expect(di(r.posts, 'fornitore_verifica')[0].body.payload).toEqual({
      fornitore: FRANCESCO, nota: null,
      righe: [{ id: ID.lea, confermata: true, data_consegna: traGiorni(-10) }, { id: ID.sophie, confermata: true, data_consegna: traGiorni(20) }],
    });
    // nessuna data cambiata: il toast non ne parla
    await compare(page, '__avvisi', 'Verifica con Francesco salvata. +50 paillettes · Medaglia nuova: Prima verifica!');
    await pillola(page, '337', 'Junior');
    expect(dati.ordini.find((x) => x.id === ID.lea)?.data_consegna).toBe(traGiorni(-10));
    expect(r.eventi.filter((e) => e.tipo === 'data_aggiunta' && e.giorno === OGGI)).toEqual([]);
    expect(r.dialoghi).toEqual([]);
    expect(r.posts.map((x) => x.body.action)).toEqual(['fornitore_verifica']);
    expect(r.errori).toEqual([]);
  });

  test('giro di conta completo dal Magazzino: prima il negativo, poi pila per pila; la conta va alla write-api col codice mostrato e si passa al prossimo', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra', presenzaFatta: true });
    await hud(page);
    await pillola(page, '287', 'Stagista');
    await barra(page, 'Magazzino').click();
    await expect(sheet(page).locator('h2')).toHaveText('Magazzino');
    // i codici con giacenza diversa da 0: Sophie -1, cocco nero 7, zebrata 3 (Nina a 0 no)
    await sheet(page).getByRole('button', { name: 'Giro di conta completo · 3 codici' }).click();
    const s = sheet(page);
    await expect(s.locator('h2')).toHaveText('Giro di conta completo');
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
    // in fondo la scheda della conta del mese; chiudere il giro senza registrarla non scrive niente
    await expect(s.locator('.v-ccard').getByRole('button')).toHaveText(`Registra la conta completa di ${MESE}`);
    await s.getByRole('button', { name: 'Chiudi il giro' }).click();
    await expect(sheet(page)).toHaveCount(0);
    // Sophie ora e' a 0: il giro dopo ha due codici
    await barra(page, 'Magazzino').click();
    await expect(sheet(page).getByRole('button', { name: 'Giro di conta completo · 2 codici' })).toBeVisible(ATTESA);
    expect(r.posts.map((x) => x.body.action)).toEqual(['count']);
    expect(r.errori).toEqual([]);
  });

  test('conta completa registrata: villaggio_conta_completa coi codici contati nel giro, il bottone si spegne mentre salva, poi +500, la medaglia e "già registrata"', async ({ page }) => {
    const dati = datiBase();
    // la zebrata e' gia' stata contata stamattina: nel giro ha "Avanti" e vale fra i contati. 282 + 5 + 2 = 289
    const eventi = [...eventiBase(), ev('conta', OGGI, 'LEA_BAG_PONY_ZEBRA', 1, '06:50')];
    const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra', presenzaFatta: true, eventi, trattieni: ['conta_completa'] });
    await hud(page);
    await pillola(page, '289', 'Stagista');
    await barra(page, 'Magazzino').click();
    await sheet(page).getByRole('button', { name: 'Giro di conta completo · 3 codici' }).click();
    const s = sheet(page);
    await expect(s.locator('h2')).toHaveText('Giro di conta completo');
    await expect(s.locator('.v-giro b')).toHaveText('1 / 3');
    await expect(s.locator('.v-qty small')).toHaveText('SOPHIE_BAG_SUEDE_BROWN · in magazzino -1');
    await expect(s.locator('.v-conta .sysrow b')).toHaveText('-1 pz', ATTESA);
    await s.locator('.v-conta input.num').fill('0');
    await s.locator('.v-conta').getByRole('button', { name: 'Applica conta' }).click();
    await expect(s.locator('.v-giro b')).toHaveText('2 / 3', ATTESA);
    await expect(s.locator('.v-qty small')).toHaveText('LEA_BAG_COCCO_BLACK · in magazzino 7');
    await s.getByRole('button', { name: 'Salta ›' }).click();
    await expect(s.locator('.v-qty small')).toHaveText('LEA_BAG_PONY_ZEBRA · in magazzino 3 · già contato oggi');
    await s.getByRole('button', { name: 'Avanti ›' }).click();
    // contati = Sophie (in questo giro) + zebrata (stamattina); il cocco nero saltato no
    await expect(s.locator('.v-fine')).toHaveText('Giro finito: 2 codici contati su 3.');
    const card = s.locator('.v-ccard');
    await expect(card.locator('.v-note')).toHaveText('La conta completa vale +500 paillettes, una volta al mese.');
    const registra = card.getByRole('button');
    await expect(registra).toHaveText(`Registra la conta completa di ${MESE}`);
    await registra.click();
    await expect.poll(() => di(r.posts, 'villaggio_conta_completa').length, ATTESA).toBe(1);
    await expect(registra).toBeDisabled();
    await expect(registra).toHaveText('Registro la conta completa…');
    await registra.evaluate((b: HTMLButtonElement) => b.click());
    await page.waitForTimeout(500);
    expect(di(r.posts, 'villaggio_conta_completa')).toHaveLength(1);
    expect(corpo(di(r.posts, 'villaggio_conta_completa')[0])).toEqual({ action: 'villaggio_conta_completa', payload: { codici: 2 }, pin: 'x', chi: 'Ginevra' });
    r.sblocca('conta_completa');
    await expect(card.locator('.v-ok')).toHaveText(`✓ Conta completa di ${MESE} già registrata.`, ATTESA);
    await expect(card.getByRole('button')).toHaveCount(0);
    await expect(card.locator('.v-errl')).toHaveCount(0);
    await compare(page, '__avvisi', `Conta completa di ${MESE} registrata.`);
    await compare(page, '__avvisi', '+500 paillettes · Medaglia nuova: Prima conta completa!');
    await compare(page, '__float', '+500');
    // 289 + 2 (Sophie) + 500 = 791: Junior, festeggiato (al primo avvio il telefono aveva annotato Stagista)
    await pillola(page, '791', 'Junior');
    await compare(page, '__float', 'festa:Junior');
    expect(r.eventi.filter((e) => e.tipo === 'conta_completa')).toMatchObject([{ giorno: OGGI, ref: OGGI.slice(0, 7), n: 2 }]);
    await s.getByRole('button', { name: 'Chiudi il giro' }).click();
    await expect(sheet(page)).toHaveCount(0);
    // nel percorso: la voce del mese e la medaglia
    await pai(page).click();
    await expect(s.locator('h2')).toHaveText('Il tuo percorso');
    await expect(s.locator('.v-voce', { hasText: `Conta completa di ${MESE}` }).locator('b')).toHaveText(`Conta completa di ${MESE} · 2 codici`);
    await expect(s.locator('.v-voce', { hasText: `Conta completa di ${MESE}` }).locator('.pt')).toHaveText('+500');
    await expect(s.locator('.v-meds .v-med.presa b')).toHaveText(['Prima presenza', 'Prima conta completa']);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    // un altro giro completo nello stesso mese: in fondo c'e' solo "già registrata", niente bottone
    await barra(page, 'Magazzino').click();
    await sheet(page).getByRole('button', { name: 'Giro di conta completo · 2 codici' }).click();
    await s.getByRole('button', { name: 'Salta ›' }).click();
    await s.getByRole('button', { name: 'Avanti ›' }).click();
    await expect(s.locator('.v-fine')).toHaveText('Giro finito: 1 codice contato su 2.');
    await expect(s.locator('.v-ccard .v-ok')).toHaveText(`✓ Conta completa di ${MESE} già registrata.`);
    await expect(s.locator('.v-ccard').getByRole('button')).toHaveCount(0);
    expect(r.posts.map((x) => x.body.action)).toEqual(['count', 'villaggio_conta_completa']);
    expect(r.errori).toEqual([]);
  });

  for (const caso of [
    { nome: 'gia\' negli eventi (registrata prima nel mese): in fondo al giro solo "già registrata"', prima: true },
    { nome: 'registrata da un altro telefono dopo l\'ultima lettura: il server risponde nuova = false e la scheda lo dice', prima: false },
    { nome: 'con la giocatrice cambiata sul server dopo l\'avvio: risposta ignorata, la scheda mostra l\'errore e non "registrata"', prima: false, ignorata: true },
  ]) {
    test(`conta completa ${caso.nome}`, async ({ page }) => {
      const dati = datiBase();
      const mese = OGGI.slice(0, 7);
      const contaDelMese = ev('conta_completa', mese + '-01', mese, 40, '07:00');
      const eventi = [...eventiBase(), ...(caso.prima ? [contaDelMese] : [])];
      const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra', presenzaFatta: true, eventi, giocatriceServer: caso.ignorata ? 'Bene' : undefined });
      await hud(page);
      await pillola(page, String(BASE + 5 + (caso.prima ? 500 : 0)), caso.prima ? 'Junior' : 'Stagista');
      await barra(page, 'Magazzino').click();
      await sheet(page).getByRole('button', { name: 'Giro di conta completo · 3 codici' }).click();
      const s = sheet(page);
      for (let i = 0; i < 3; i++) await s.getByRole('button', { name: 'Salta ›' }).click();
      await expect(s.locator('.v-fine')).toHaveText('Giro finito: 0 codici contati su 3.');
      const card = s.locator('.v-ccard');
      if (caso.prima) {
        await expect(card.locator('.v-ok')).toHaveText(`✓ Conta completa di ${MESE} già registrata.`);
        await expect(card.getByRole('button')).toHaveCount(0);
        expect(r.posts).toEqual([]);
      } else if (caso.ignorata) {
        const registra = card.getByRole('button', { name: `Registra la conta completa di ${MESE}` });
        await registra.click();
        await expect(card.locator('.v-errl')).toHaveText('La conta completa la registra solo Ginni.', ATTESA);
        await expect(registra).toBeEnabled();
        await expect(card.locator('.v-ok')).toHaveCount(0);
        expect(corpo(di(r.posts, 'villaggio_conta_completa')[0])).toEqual({ action: 'villaggio_conta_completa', payload: { codici: 0 }, pin: 'x', chi: 'Ginevra' });
        await page.waitForTimeout(1000);
        expect((await registrati(page, '__avvisi')).filter((t) => t.includes('onta completa di'))).toEqual([]);
        expect(r.eventi.filter((e) => e.tipo === 'conta_completa')).toEqual([]);
        expect(r.posts.map((x) => x.body.action)).toEqual(['villaggio_conta_completa']);
      } else {
        r.eventi.push(contaDelMese);
        await card.getByRole('button', { name: `Registra la conta completa di ${MESE}` }).click();
        await expect(card.locator('.v-ok')).toHaveText(`✓ Conta completa di ${MESE} già registrata.`, ATTESA);
        await compare(page, '__avvisi', `La conta completa di ${MESE} era già registrata.`);
        expect(corpo(di(r.posts, 'villaggio_conta_completa')[0])).toEqual({ action: 'villaggio_conta_completa', payload: { codici: 0 }, pin: 'x', chi: 'Ginevra' });
        // le paillettes sono quelle dell'altro telefono, una volta sola
        await pillola(page, String(BASE + 5 + 500), 'Junior');
        expect(r.eventi.filter((e) => e.tipo === 'conta_completa')).toHaveLength(1);
        expect(r.posts.map((x) => x.body.action)).toEqual(['villaggio_conta_completa']);
      }
      expect(r.errori).toEqual([]);
    });
  }

  test('missioni: la stella col numero, l\'elenco dai dati (verifica, negativi, date), ogni missione apre la sua azione e diventa fatta; i negativi restano quelli della prima lettura del giorno', async ({ page }) => {
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
    // i negativi della prima lettura del giorno, annotati sul telefono
    expect(JSON.parse((await memoria(page, 'amimi_paillettes_negativi')) ?? 'null')).toEqual({ giorno: OGGI, codici: ['SOPHIE_BAG_SUEDE_BROWN'] });
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
    // il giro di una missione non e' quello completo: niente scheda della conta del mese
    await expect(s.locator('.v-ccard')).toHaveCount(0);
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
    await page.keyboard.press('Escape');
    // riaperto lo stesso giorno, con un negativo nuovo arrivato intanto (la zebrata venduta senza carico): la missione resta
    // quella della prima lettura, col solo codice di stamattina, e resta fatta
    dati.magazzino.find((g) => g.codice === 'LEA_BAG_PONY_ZEBRA')!.giacenza_attuale = -2;
    await page.reload();
    await expect(stella).toHaveAttribute('aria-label', 'Missioni di oggi: 2 da fare', ATTESA);
    await stella.click();
    await expect(s.locator('.v-mrow b')).toHaveText(testi);
    await expect(s.locator('.v-mrow .v-chip')).toHaveText(['da fare', 'fatta', 'da fare']);
    expect(JSON.parse((await memoria(page, 'amimi_paillettes_negativi')) ?? 'null')).toEqual({ giorno: OGGI, codici: ['SOPHIE_BAG_SUEDE_BROWN'] });
    expect(r.posts.map((x) => x.body.action)).toEqual(['villaggio_presenza', 'count']);
    expect(r.errori).toEqual([]);
  });
});

// La missione della conta completa compare solo dal 20 del mese: l'orologio del browser e' finto (page.clock), e dati,
// eventi e finto server usano quel giorno. Senza negativi le missioni di base sono due, cosi' c'e' posto per la terza.
test.describe('Missione della conta completa (orologio finto)', () => {
  const MISSIONI = ['Verifica con Francesco · 1 riga in ritardo', 'Chiedi a Sarte Milano la data di 1 riga'];
  for (const caso of [
    { giorno: '2026-10-19', nome: 'il 19 non c\'e\' ancora', missione: false, gia: null },
    { giorno: '2026-10-20', nome: 'dal 20 c\'e\', per ultima; apre il giro completo e registrata diventa fatta', missione: true, gia: null },
    { giorno: '2026-10-26', nome: 'registrata il 21 non torna fino al mese dopo', missione: false, gia: '2026-10-21' },
  ]) {
    test(`${caso.giorno}: ${caso.nome}`, async ({ page }) => {
      const dati = datiBase(caso.giorno);
      dati.magazzino.find((g) => g.codice === 'SOPHIE_BAG_SUEDE_BROWN')!.giacenza_attuale = 0;
      const eventi = [...eventiBase(caso.giorno), ...(caso.gia ? [ev('conta_completa', caso.gia, caso.gia.slice(0, 7), 30, '16:00')] : [])];
      const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra', oggi: caso.giorno, eventi });
      await hud(page);
      await expect.poll(() => presenze(r.posts).length, ATTESA).toBe(1);
      expect(r.eventi.filter((e) => e.tipo === 'presenza').map((e) => e.giorno)).toContain(caso.giorno);
      const testi = caso.missione ? [...MISSIONI, 'Conta completa di ottobre'] : MISSIONI;
      await compare(page, '__fumetti', `Buongiorno! Oggi ho ${testi.length} missioni per te: le trovi sotto la stella.`);
      const stella = page.locator('.v-hud .v-mis');
      await expect(stella).toHaveAttribute('aria-label', `Missioni di oggi: ${testi.length} da fare`, ATTESA);
      await stella.click();
      const s = sheet(page);
      await expect(s.locator('.v-mrow b')).toHaveText(testi);
      if (!caso.missione) {
        await expect(s.locator('.v-mrow small')).toHaveText(['Apri la verifica', 'Apri la verifica']);
        expect(r.posts.map((x) => x.body.action)).toEqual(['villaggio_presenza']);
        expect(r.errori).toEqual([]);
        return;
      }
      await expect(s.locator('.v-mrow small')).toHaveText(['Apri la verifica', 'Apri la verifica', 'Apri il giro di conta completo']);
      await s.locator('.v-mrow', { hasText: 'Conta completa di ottobre' }).click();
      await expect(s.locator('h2')).toHaveText('Giro di conta completo');
      // Sophie a 0 non c'e': cocco nero 7 e zebrata 3
      await expect(s.locator('.v-giro b')).toHaveText('1 / 2');
      await expect(s.locator('.v-qty small')).toHaveText('LEA_BAG_COCCO_BLACK · in magazzino 7');
      await expect(s.locator('.v-conta .sysrow b')).toHaveText('7 pz', ATTESA);
      await s.locator('.v-conta input.num').fill('7');
      await expect(s.locator('.v-conta .deltabadge')).toHaveText('Combacia ✓');
      await s.locator('.v-conta').getByRole('button', { name: 'Applica conta' }).click();
      await expect(s.locator('.v-giro b')).toHaveText('2 / 2', ATTESA);
      expect(di(r.posts, 'count')[0].body.payload).toMatchObject({ codice: 'LEA_BAG_COCCO_BLACK', contati: 7, data_conta: caso.giorno });
      await s.getByRole('button', { name: 'Salta ›' }).click();
      await expect(s.locator('.v-fine')).toHaveText('Giro finito: 1 codice contato su 2.');
      await s.locator('.v-ccard').getByRole('button', { name: 'Registra la conta completa di ottobre' }).click();
      await expect(s.locator('.v-ccard .v-ok')).toHaveText('✓ Conta completa di ottobre già registrata.', ATTESA);
      expect(corpo(di(r.posts, 'villaggio_conta_completa')[0])).toEqual({ action: 'villaggio_conta_completa', payload: { codici: 1 }, pin: 'x', chi: 'Ginevra' });
      expect(r.eventi.filter((e) => e.tipo === 'conta_completa')).toMatchObject([{ giorno: caso.giorno, ref: '2026-10', n: 1 }]);
      await compare(page, '__float', '+500');
      await s.getByRole('button', { name: 'Chiudi il giro' }).click();
      // registrata oggi la missione resta, fatta
      await expect(stella).toHaveAttribute('aria-label', 'Missioni di oggi: 2 da fare', ATTESA);
      await stella.click();
      await expect(s.locator('.v-mrow b')).toHaveText(testi);
      await expect(s.locator('.v-mrow .v-chip')).toHaveText(['da fare', 'da fare', 'fatta']);
      expect(r.posts.map((x) => x.body.action)).toEqual(['villaggio_presenza', 'count', 'villaggio_conta_completa']);
      expect(r.errori).toEqual([]);
    });
  }
});

test.describe('Paillettes accese, chi non gioca', () => {
  test('Ale nell\'app intera: pillola di Ginni in sola lettura, niente missioni, presenza ne\' conta completa da registrare', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati, { chi: 'Ale' });
    await hud(page);
    await pillola(page, String(BASE), 'Ginni · Stagista');
    await expect(pai(page)).toHaveAttribute('aria-label', `Paillettes di Ginni: ${BASE}, livello Stagista`);
    await page.waitForTimeout(2500);
    await expect(page.locator('.v-hud .v-mis')).toHaveCount(0);
    await visibile(page);
    await page.waitForTimeout(1500);
    expect(r.posts).toEqual([]);
    expect(await memoria(page, 'amimi_villaggio_presenza')).toBeNull();
    // le feste e il loro ricordo sono della giocatrice
    expect(await memoria(page, 'amimi_paillettes_livello')).toBeNull();
    await pai(page).click();
    await expect(sheet(page).locator('h2')).toHaveText('Il percorso di Ginni');
    await expect(sheet(page).locator('.v-shead p')).toHaveText(`${BASE} paillettes · Stagista`);
    await expect(sheet(page).locator('.v-lad .v-lv')).toHaveCount(7);
    await expect(sheet(page).locator('.v-meds .v-med')).toHaveCount(8);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    // il giro completo si puo' fare, ma in fondo niente scheda: la conta del mese la registra solo Ginni
    await barra(page, 'Magazzino').click();
    await sheet(page).getByRole('button', { name: 'Giro di conta completo · 3 codici' }).click();
    const s = sheet(page);
    await expect(s.locator('h2')).toHaveText('Giro di conta completo');
    for (let i = 0; i < 3; i++) await s.getByRole('button', { name: 'Salta ›' }).click();
    await expect(s.locator('.v-fine')).toHaveText('Giro finito: 0 codici contati su 3.');
    await expect(s.locator('.v-ccard')).toHaveCount(0);
    await expect(s.getByRole('button', { name: /conta completa/ })).toHaveCount(0);
    await s.getByRole('button', { name: 'Chiudi il giro' }).click();
    const fl = await registrati(page, '__float');
    expect(fl, 'chi non gioca non vede "+n" ne\' feste').toEqual([]);
    expect(r.letture.eventi).toBeGreaterThan(0);
    expect(r.posts).toEqual([]);
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

// Il feed "Attività recente" di Salute & Movimenti: la data spostata da una verifica (op order_date, write-api v29) ha la
// sua etichetta e il riassunto "codice · data breve", non il nome della tabella
test.describe('Feed attività: la data di consegna della verifica', () => {
  test('Salute & Movimenti mostra "Data di consegna · Ginni" con codice e data nuova', async ({ page }) => {
    const dati = datiBase();
    const dopo = traGiorni(7);
    const r = await apri(page, '', dati, {
      chi: 'Ale',
      changeLog: [{ id: 901, tbl: 'supplier_orders', row_id: ID.lea, op: 'order_date', chi: 'Ginevra', ts: new Date().toISOString(),
        after: { codice: 'LEA_BAG_COCCO_BLACK', fornitore: FRANCESCO, data_consegna: dopo } }],
    });
    await page.getByRole('button', { name: /Salute & Movimenti/ }).first().click();
    const riga = page.locator('.ds-act', { hasText: 'Data di consegna' });
    await expect(riga.locator('.ds-actverb')).toHaveText('Data di consegna · Ginni', ATTESA);
    await expect(riga.locator('.ds-actsum')).toHaveText(`LEA_BAG_COCCO_BLACK · ${dataCorta(dopo)}`);
    expect(r.posts).toEqual([]);
  });
});
