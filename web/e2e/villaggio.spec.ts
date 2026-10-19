import { test, expect, type Locator, type Page } from '@playwright/test';

// Villaggio (16-10): ordini e magazzino come isola 3D (three.js). Come negozi-*.spec.ts NON tocca Supabase: ogni richiesta
// a *.supabase.co e' intercettata e riceve dati finti (v_ordini_arrivo, v_inventory, products, l'interruttore
// v_villaggio_settings; tutto il resto []), e la POST alla write-api e' registrata e risposta qui, cosi' si controlla che
// dal Villaggio escano SOLO l'arrival_set di ArrivoRow e l'order_multi di SupplierOrderForm (il mock risponde 400 al resto).
// Tre ingressi: la scheda #villaggio dell'app intera, l'app a se' /amimi-app/villaggio/ (per il telefono di Ginni, con il
// suo manifest) e il bottone "Apri il Villaggio" nel Cruscotto. Tutti e tre (e la tile in Home) dietro app_flags.villaggio_enabled
// (migr 0162, vista v_villaggio_settings): acceso di default nei test, spento (o vista assente) nel describe "flag spento".
// Lanciare dopo la build verso il progetto finto (come la CI):
//   VITE_SUPABASE_URL=https://e2e-progetto-finto.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_e2e_finto npx vite build
//   E2E_PORT=<porta libera> npx playwright test e2e/villaggio.spec.ts
// Sempre col percorso del file: il worktree si chiama "villaggio", quindi il filtro nudo "villaggio" prende OGNI spec, anche e2e/ingest.spec.ts che scrive sul DB vero.
// Se altre sessioni rifanno web/dist nello stesso worktree: build con --outDir in una cartella propria, `npx vite preview
// --outDir <cartella> --port <porta> --strictPort` a parte e CI=1 davanti a playwright, che cosi' riusa quella preview.

// Fase 3 (18-10): anche lo storico della scheda della pila (qromo_sales, shopify_line_items, purchases, stock_adjustments
// per codice), v_reorder ("sta finendo"), v_tempi_laboratori (il tempo abituale nel modulo d'ordine), il meteo di Milano
// (api.open-meteo.com, finto anche lui: sereno, pioggia o errore) e la order_update della ArrivoRow ("Modifica").
// Senza GPU (headless, CI) il WebGL e' SwiftShader: la scena con le ombre gira a ~2 fotogrammi al secondo, e ogni azione
// di Playwright aspetta fotogrammi stabili. Tempi larghi per questo file, non per gli altri. 300 s e non 150: con un'altra
// suite WebGL in parallelo sulla stessa macchina (worktree o sessioni diverse) i test di arrivo arrivavano in fondo a ~150 s.
test.describe.configure({ timeout: 300000 });
const ATTESA = { timeout: 40000 };

const romaIso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const OGGI = romaIso(new Date());
const traGiorni = (n: number) => romaIso(new Date(Date.now() + n * 86400000));

type Riga = {
  id: string; gruppo: string; codice: string; item: string | null; variant: string | null; fornitore: string | null;
  qty_ordered: number | null; qty_arrived: number; mancano: number; completo: boolean; nuovo_riordino: string | null; costo_unitario: number | null;
  data_consegna: string | null; data_consegna_display: string | null; data_ordine: string | null; image_url: string | null; wip: boolean; note: string | null;
};
type Inv = { codice: string; item: string | null; variant: string | null; giacenza_attuale: number; [k: string]: unknown };

const riga = (id: string, gruppo: string, fornitore: string | null, codice: string, item: string, variant: string, ordinati: number | null, arrivati: number, consegna: string | null, extra: Partial<Riga> = {}): Riga => {
  const mancano = (ordinati ?? 0) - arrivati;
  return {
    id, gruppo, codice, item, variant, fornitore, qty_ordered: ordinati, qty_arrived: arrivati, mancano, completo: arrivati >= (ordinati ?? 0) && !extra.wip,
    nuovo_riordino: null, costo_unitario: 40, data_consegna: consegna, data_consegna_display: consegna, data_ordine: traGiorni(-30), image_url: null, wip: false, note: null, ...extra,
  };
};
const inv = (codice: string, item: string, variant: string, giacenza: number): Inv => ({
  codice, item, variant, categoria: 'Borse', giacenza_attuale: giacenza, in_conto_vendita: 0, disponibili_da_vendere: Math.max(0, giacenza), valore: 0,
  retail_price: 120, cogs: 40, last_sale: null, on_shopify: true, image_url: null, qty_purchased: 0, shopify_sold: 0, qromo_sold: 0, gift_sold: 0, b2b_venduto: 0,
});

const FRANCESCO = 'Francesco (pelle)';
const SARTE = 'Sarte Milano (tessuto)';
const ID = {
  lea: '00000000-0000-0000-0000-0000000000a1', sophie: '00000000-0000-0000-0000-0000000000a2', zebra: '00000000-0000-0000-0000-0000000000a3', nina: '00000000-0000-0000-0000-0000000000b1',
  wip: '00000000-0000-0000-0000-0000000000b2', anonimo: '00000000-0000-0000-0000-0000000000d1',
};
/** La conferma della pagina prima di perdere un ordine toccato al passo 4. */
const LASCI = "Lasci l'ordine a metà? Quello che hai scritto si perde.";

// Francesco: Lea cocco nero 4/10 IN RITARDO, Sophie camoscio 0/5, Lea zebrata 3/3 (completa: non e' "in preparazione").
// Sarte Milano: Nina righe rosse 0/8 senza data. Solo modelli che il villaggio sa disegnare e nessuna riga WIP: i casi
// limite (WIP, modelli sconosciuti) hanno il loro test in fondo.
function datiBase() {
  const ordini: Riga[] = [
    riga(ID.lea, 'G1', FRANCESCO, 'LEA_BAG_COCCO_BLACK', 'LEA BAG', 'COCCO BLACK', 10, 4, traGiorni(-10)),
    riga(ID.sophie, 'G1', FRANCESCO, 'SOPHIE_BAG_SUEDE_BROWN', 'SOPHIE BAG', 'SUEDE BROWN', 5, 0, traGiorni(20)),
    riga(ID.zebra, 'G1', FRANCESCO, 'LEA_BAG_PONY_ZEBRA', 'LEA BAG', 'PONY ZEBRA', 3, 3, traGiorni(-40)),
    riga(ID.nina, 'G2', SARTE, 'NINA_BAG_STRIPES_RED', 'NINA BAG', 'STRIPES RED', 8, 0, null),
  ];
  const magazzino: Inv[] = [
    inv('SOPHIE_BAG_SUEDE_BROWN', 'SOPHIE BAG', 'SUEDE BROWN', -1),   // negativa: non conta nei pezzi in magazzino
    inv('NINA_BAG_STRIPES_RED', 'NINA BAG', 'STRIPES RED', 0),        // finita, ma in arrivo
    inv('LEA_BAG_PONY_ZEBRA', 'LEA BAG', 'PONY ZEBRA', 3),
    inv('LEA_BAG_COCCO_BLACK', 'LEA BAG', 'COCCO BLACK', 7),
  ];
  return { ordini, magazzino };
}
type Dati = ReturnType<typeof datiBase>;

/** I numeri che l'HUD deve mostrare, ricalcolati dai dati finti con la definizione della pagina. */
function attesi(d: Dati) {
  const aperte = d.ordini.filter((r) => !r.completo);
  return {
    stock: d.magazzino.reduce((s, r) => s + Math.max(0, r.giacenza_attuale), 0),
    prep: aperte.filter((r) => !r.wip).reduce((s, r) => s + Math.max(0, r.mancano), 0),
    open: aperte.length,
  };
}

type Post = { url: string; body: { action: string; payload: Record<string, unknown>; pin: string; chi: string; force?: boolean } };
/** Interruttore app_flags.villaggio_enabled come lo vede l'app: 'true' / 'false' nella vista, o '404' = vista assente
 *  (migr 0162 non ancora applicata: PostgREST risponde 404 PGRST205). */
type Flag = 'true' | 'false' | '404';
/** Una vendita della scheda della pila: in negozio (qromo_sales) o online (shopify_line_items). */
type Vendita = { canale: 'negozio' | 'online'; data: string; qty: number };
type Acquisto = { id: string; data: string | null; quantita: number; costo_unitario: number | null; fornitore: string | null };
type Rettifica = { id: string; data: string | null; qty_delta: number; motivo: string | null };
/** Le righe di v_reorder che servono a "sta finendo": il resto delle colonne ha valori neutri. */
const rio = (codice: string, venduto_60d: number, giorni_stock: number | null, extra: Record<string, unknown> = {}) => ({
  codice, item: null, variant: null, image_url: null, giacenza: 0, disponibili: 0, on_shopify: true, venduto_60d, in_arrivo: 0, giorni_stock, riordino_archiviato: false, ...extra,
});
/** Il meteo finto di Open-Meteo (codici WMO): sereno 0, nuvole 3, pioggia 61, neve 73, nebbia 45, o una risposta 500. */
type MeteoFinto = 'sole' | 'nuvole' | 'pioggia' | 'neve' | 'nebbia' | 'errore';
const WMO: Record<Exclude<MeteoFinto, 'errore'>, number> = { sole: 0, nuvole: 3, pioggia: 61, neve: 73, nebbia: 45 };
type Opzioni = {
  chi?: string; intro?: boolean; flag?: Flag; rispostaScrittura?: (p: Post) => { status: number; body: unknown } | null;
  vendite?: Record<string, Vendita[]>; acquisti?: Record<string, Acquisto[]>; rettifiche?: Record<string, Rettifica[]>;
  /** Le tabelle dello storico che rispondono 500 (lettura fallita). */
  storicoKo?: ('qromo_sales' | 'shopify_line_items' | 'purchases' | 'stock_adjustments')[];
  /** v_reorder: le righe, o 'errore' = la lettura risponde 500. */
  reorder?: Record<string, unknown>[] | 'errore';
  /** v_tempi_laboratori: le righe, o '404' = vista non ancora applicata (migr 0167). */
  tempi?: { fornitore: string; giorni_mediani: number; righe: number }[] | '404';
  meteo?: MeteoFinto;
  /** L'ora del browser (page.clock, poi scorre normale): stagione e luce dell'isola dipendono da lei. */
  ora?: string;
};

// le scritture di ogni pagina, per il controllo dopo ogni test: dal Villaggio escono solo queste tre azioni (a Paillettes
// spente; le loro scritture le prova paillettes.spec.ts)
const AZIONI_CONSENTITE = new Set(['arrival_set', 'order_multi', 'order_update']);
const registro = new WeakMap<Page, Post[]>();
test.afterEach(async ({ page }) => {
  const fuori = (registro.get(page) ?? []).map((p) => p.body.action).filter((a) => !AZIONI_CONSENTITE.has(a));
  expect(fuori, 'azioni write-api diverse da arrival_set, order_multi e order_update').toEqual([]);
});
const URL_METEO = 'https://api.open-meteo.com/v1/forecast?latitude=45.4642&longitude=9.19&current=weather_code,is_day';

async function apri(page: Page, path: string, dati: Dati, opts: Opzioni = {}) {
  const posts: Post[] = [];
  registro.set(page, posts);
  const errori: string[] = [];
  const dialoghi: string[] = [];
  // ogni window.confirm e' contato in `dialoghi` e risposto qui: OK di default, Annulla con conferme.accetta = false
  const conferme = { accetta: true };
  const letture = { ordini: 0, magazzino: 0, flag: 0, meteo: [] as string[], storico: [] as string[], tempi: 0 };
  const flag: Flag = opts.flag ?? 'true';
  // una risorsa che non si carica (le letture fallite volute dal test) la scrive Chromium da solo: col suo indirizzo, per filtrarla
  page.on('console', (m) => { if (m.type() === 'error') errori.push(m.text() + (/^Failed to load resource/.test(m.text()) ? ' @ ' + m.location().url : '')); });
  page.on('pageerror', (e) => errori.push('pageerror: ' + e.message));
  page.on('dialog', (d) => { dialoghi.push(d.message()); void (conferme.accetta ? d.accept() : d.dismiss()); });
  if (opts.ora) await page.clock.install({ time: new Date(opts.ora) });
  await page.addInitScript(({ chi, intro }) => {
    if (chi) localStorage.setItem('amimi_chi', chi);
    if (!intro) localStorage.setItem('amimi_villaggio_intro', '1');
    // i due avvisi (il toast di Ordini, 2,6 s, e il fumetto di Ginni, 3,2 s) durano meno di qualche fotogramma
    // SwiftShader: si registra ogni testo comparso invece di sperare di vederlo nel momento giusto
    const visti: string[] = [];
    (window as unknown as { __avvisi: string[] }).__avvisi = visti;
    const scan = () => document.querySelectorAll('.v-toast, #toast-host .toast').forEach((el) => {
      const t = (el.textContent ?? '').trim();
      if (t && !visti.includes(t)) visti.push(t);
    });
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true });
  }, { chi: opts.chi ?? null, intro: !!opts.intro });
  // i font del Villaggio sono nel bundle (@fontsource); se tornasse un link a Google Fonts, in test un foglio vuoto (niente rete)
  await page.route(/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  // il meteo vero di Milano non si chiede mai dai test: sereno di default
  const meteo: MeteoFinto = opts.meteo ?? 'sole';
  await page.route(/api\.open-meteo\.com\//, (route) => {
    letture.meteo.push(route.request().url());
    if (meteo === 'errore') return route.fulfill({ status: 500, contentType: 'text/plain', body: 'errore finto' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { time: OGGI + 'T10:00', interval: 900, weather_code: WMO[meteo], is_day: 1 } }) });
  });
  await page.route(/supabase\.co\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/functions/v1/write-api') && req.method() === 'POST') {
      const p: Post = { url: req.url(), body: req.postDataJSON() };
      posts.push(p);
      const custom = opts.rispostaScrittura?.(p);
      if (custom) return json(custom.body, custom.status);
      if (p.body.action === 'order_update') {
        // come write-api v30: solo righe senza arrivi e non WIP, solo i campi ammessi, si scrive cio' che cambia
        const pl = p.body.payload as { id?: string; qty_ordered?: number; costo_unitario?: number | null; note?: string | null; data_consegna?: string | null };
        const fuori = Object.keys(pl).filter((k) => !['id', 'qty_ordered', 'costo_unitario', 'note', 'data_consegna'].includes(k));
        if (fuori.length) return json({ error: 'campi non ammessi', campi_non_ammessi: fuori }, 422);
        const r = dati.ordini.find((x) => x.id === pl.id);
        if (!r) return json({ error: 'riga ordine non trovata' }, 404);
        if (r.qty_arrived > 0) return json({ error: 'la riga ha gia\' degli arrivi', has_arrivals: true }, 409);
        if (r.wip) return json({ error: 'riga WIP', wip: true }, 409);
        const cambiati: string[] = [];
        if ('qty_ordered' in pl && Number(pl.qty_ordered) !== r.qty_ordered) { r.qty_ordered = Number(pl.qty_ordered); r.mancano = r.qty_ordered - r.qty_arrived; cambiati.push('qty_ordered'); }
        if ('costo_unitario' in pl && (pl.costo_unitario ?? null) !== r.costo_unitario) { r.costo_unitario = pl.costo_unitario ?? null; cambiati.push('costo_unitario'); }
        if ('note' in pl && (pl.note || null) !== r.note) { r.note = pl.note || null; cambiati.push('note'); }
        if ('data_consegna' in pl && (pl.data_consegna || null) !== r.data_consegna) { r.data_consegna = pl.data_consegna || null; r.data_consegna_display = r.data_consegna; cambiati.push('data_consegna'); }
        return json({ ok: true, id: r.id, cambiati });
      }
      if (p.body.action === 'order_multi') {
        // come write-api: una riga supplier_orders per riga del carrello, nello stesso gruppo; la vista la mostra aperta
        const pl = p.body.payload as { fornitore: string; data_ordine: string; righe: { codice: string; item: string | null; variant: string | null; qty_ordered: number; wip: boolean; costo_unitario: number | null; data_consegna?: string }[] };
        if (!pl.fornitore || !Array.isArray(pl.righe) || !pl.righe.length) return json({ error: 'order_multi senza fornitore o righe' }, 400);
        const gruppo = 'G' + (new Set(dati.ordini.map((x) => x.gruppo)).size + 1);
        pl.righe.forEach((x, i) => dati.ordini.push(riga(`00000000-0000-0000-0000-0000000000c${i}`, gruppo, pl.fornitore, x.codice, x.item ?? x.codice, x.variant ?? '', x.qty_ordered, 0, x.data_consegna ?? null,
          { wip: x.wip, completo: false, costo_unitario: x.costo_unitario, data_ordine: pl.data_ordine })));
        return json({ ok: true, id: gruppo, lines: pl.righe.length, stubs: 0 });
      }
      if (p.body.action !== 'arrival_set') return json({ error: 'azione inattesa nel test: ' + p.body.action }, 400);
      // come write-api v27: al server va il TOTALE arrivato e il totale atteso; se a DB e' un altro, 409 e niente scrittura
      const r = dati.ordini.find((x) => x.id === p.body.payload.order_id);
      if (!r) return json({ error: 'riga inesistente' }, 404);
      if (Number(p.body.payload.attesi) !== r.qty_arrived) return json({ error: 'Il totale arrivato e\' cambiato nel frattempo' }, 409);
      const qty = Number(p.body.payload.qty), delta = qty - r.qty_arrived;
      r.qty_arrived = qty; r.mancano = (r.qty_ordered ?? 0) - qty; r.completo = qty >= (r.qty_ordered ?? 0);
      const g = dati.magazzino.find((x) => x.codice === r.codice);
      if (g) g.giacenza_attuale += delta;
      return json({ ok: true, id: r.id });
    }
    if (url.pathname.endsWith('/rest/v1/v_villaggio_settings')) {
      letture.flag++;
      if (flag === '404') return json({ code: 'PGRST205', details: null, hint: null, message: 'Could not find the table \'public.v_villaggio_settings\' in the schema cache' }, 404);
      // fetchVillaggioSettings chiede l'array; l'oggetto resta per una lettura con Accept vnd.pgrst.object+json
      const rigaFlag = { key: 'villaggio_enabled', value: flag };
      return json((req.headers()['accept'] ?? '').includes('application/vnd.pgrst.object+json') ? rigaFlag : [rigaFlag]);
    }
    if (url.pathname.endsWith('/rest/v1/v_ordini_arrivo')) {
      letture.ordini++;
      // come PostgREST: solo le colonne chieste, cosi' un campo che la pagina non legge non le arriva per sbaglio
      const cols = (url.searchParams.get('select') ?? '*').split(',');
      return json(cols.includes('*') ? dati.ordini : dati.ordini.map((o) => Object.fromEntries(cols.filter((c) => c in o).map((c) => [c, (o as Record<string, unknown>)[c]]))));
    }
    if (url.pathname.endsWith('/rest/v1/v_inventory')) {
      // la giacenza di un codice solo (fetchGiacenzaOne di CountForm: codice=eq.X) non conta come lettura del magazzino
      const c = url.searchParams.get('codice');
      if (c?.startsWith('eq.')) return json(dati.magazzino.filter((g) => g.codice === c.slice(3)));
      letture.magazzino++; return json(dati.magazzino);
    }
    // il catalogo che SupplierOrderForm usa per nome e variante della riga precompilata
    if (url.pathname.endsWith('/rest/v1/products')) return json(dati.magazzino.map((g) => ({ codice: g.codice, item: g.item, variant: g.variant, categoria: 'Borse', image_url: null, retail_price: 120, cogs: 40 })));
    if (url.pathname.endsWith('/rest/v1/v_reorder')) return opts.reorder === 'errore' ? json({ code: 'XX000', details: null, hint: null, message: 'lettura finta fallita' }, 500) : json(opts.reorder ?? []);
    if (url.pathname.endsWith('/rest/v1/v_tempi_laboratori')) {
      letture.tempi++;
      if (opts.tempi === '404') return json({ code: 'PGRST205', details: null, hint: null, message: 'Could not find the table \'public.v_tempi_laboratori\' in the schema cache' }, 404);
      return json(opts.tempi ?? []);
    }
    // lo storico della scheda della pila, un codice alla volta (codice=eq.X o codice_norm=eq.X)
    const tab = /\/rest\/v1\/(qromo_sales|shopify_line_items|purchases|stock_adjustments)$/.exec(url.pathname)?.[1] as NonNullable<Opzioni['storicoKo']>[number] | undefined;
    if (tab) {
      const cod = (url.searchParams.get('codice') ?? url.searchParams.get('codice_norm') ?? '').replace(/^eq\./, '');
      letture.storico.push(tab + ':' + cod);
      if (opts.storicoKo?.includes(tab)) return json({ code: 'XX000', details: null, hint: null, message: 'lettura finta fallita' }, 500);
      if (tab === 'qromo_sales') return json((opts.vendite?.[cod] ?? []).filter((v) => v.canale === 'negozio')
        .map((v, i) => ({ id: `q-${cod}-${i}`, data: v.data, quantita: v.qty, prezzo: 120, nome: 'Cliente', cognome: 'Negozio' })));
      if (tab === 'shopify_line_items') return json((opts.vendite?.[cod] ?? []).filter((v) => v.canale === 'online')
        .map((v, i) => ({ id: `s-${cod}-${i}`, created_at: v.data + 'T10:00:00+00:00', quantita: v.qty, price: 120, lineitem_name: cod, order_id: '#10' + i })));
      if (tab === 'purchases') return json(opts.acquisti?.[cod] ?? []);
      return json(opts.rettifiche?.[cod] ?? []);
    }
    return json([]);
  });
  await page.goto(path);
  return { posts, errori, dialoghi, letture, conferme };
}
/** Il contatore di partenze del furgoncino: la radice .vil lo espone, +1 a ogni onPartenza del Mondo. */
const furgoni = async (page: Page) => Number(await page.locator('.vil').getAttribute('data-furgoni'));
/** Tile del Villaggio in Home (azioni rapide, gestione o "Altro"). */
const tileVillaggio = (page: Page) => page.locator('.ds-qbtn, .ds-mcard', { hasText: 'Villaggio' });
/** Il 404 della vista assente lo scrive Chromium in console da solo: non e' un errore dell'app. */
const senza404 = (errori: string[]) => errori.filter((e) => !/status of 404/.test(e));

const pill = (page: Page, testo: string) => page.locator('.v-hud .v-pill', { hasText: testo }).locator('b');
async function hud(page: Page, a: { stock: number; prep: number; open: number }) {
  await expect(pill(page, 'in magazzino')).toHaveText(String(a.stock), ATTESA);
  await expect(pill(page, 'in preparazione')).toHaveText(String(a.prep), ATTESA);
  await expect(pill(page, 'righe aperte')).toHaveText(String(a.open), ATTESA);
}
/** Gli avvisi comparsi finora: toast di Ordini ("✓  Arrivo salvato ...") e fumetto di Ginni ("Ginni2 Lea ..."). */
const avvisi = (page: Page) => page.evaluate(() => (window as unknown as { __avvisi: string[] }).__avvisi.slice());
const avvisoCon = (page: Page, testo: string) => expect.poll(async () => (await avvisi(page)).find((t) => t.includes(testo)) ?? (await avvisi(page)).join(' | '), ATTESA).toContain(testo);
// etichetta HTML di un capannone: .v-lbl senza le varianti mini (pile, carrelli), zona e magazzino
const etichettaLab = (page: Page, nome: string) => page.locator('.v-labels > .v-lbl:not(.v-mini):not(.v-zone):not(.v-wh)', { hasText: nome });
const fienile = (page: Page) => page.locator('.v-labels > .v-lbl.v-wh');

/** Il canvas ha un contesto WebGL vero e il renderer l'ha portato alle misure della finestra. Pixel ratio come Mondo:
 *  il devicePixelRatio con un tetto di 1,5 in verticale (larghezza/altezza < 0,8) e di 2 altrimenti. */
async function canvasVivo(page: Page) {
  const c = page.locator('canvas.v-canvas');
  await expect(c).toHaveCount(1, ATTESA);   // dal Cruscotto c'e' anche il chunk del Villaggio da scaricare
  const m = await c.evaluate((el: HTMLCanvasElement) => {
    const vw = window.innerWidth, vh = window.innerHeight;
    return { w: el.width, h: el.height, vw, vh, dpr: Math.min(window.devicePixelRatio || 1, vw / vh < 0.8 ? 1.5 : 2), gl: !!(el.getContext('webgl2') || el.getContext('webgl')) };
  });
  expect(m.gl).toBe(true);
  expect(m.w).toBe(Math.floor(m.vw * m.dpr));
  expect(m.h).toBe(Math.floor(m.vh * m.dpr));
}

const passo = (page: Page) => page.locator('.v-sheet.open .v-shead p');
const tile = (page: Page, nome: string) => page.locator('.v-sheet.open .v-tile', { has: page.locator('b', { hasText: new RegExp(`^${nome}$`) }) });
/** Dal + della barra fino al passo 4 (Francesco, Lea, Cocco nero): il modulo vero di Ordini con la riga precompilata. */
async function alPasso4(page: Page) {
  await page.getByRole('button', { name: 'Ordina borse', exact: true }).click();
  await expect(passo(page)).toHaveText('A chi lo ordini?');
  await tile(page, 'Francesco').click();
  await tile(page, 'Lea').click();
  await page.locator('.v-sheet.open .v-vt', { hasText: 'Cocco nero' }).click();
  await expect(passo(page)).toHaveText('Quantità e prezzo');
  const qty = page.locator('.v-sheet.open .v-form .cartrow[data-cart-codice="LEA_BAG_COCCO_BLACK"] input.qbox');
  await expect(qty).toBeVisible(ATTESA);
  return qty;
}
const barra = (page: Page, testo: string) => page.locator('.v-bar .v-rb', { hasText: testo });
/** La X del pannello e subito Laboratori nella barra, nello stesso task: l'history.back() della X e' ancora in volo. */
const xESubitoLaboratori = (page: Page) => page.evaluate(() => {
  document.querySelector<HTMLButtonElement>('.v-sheet .v-x')!.click();
  [...document.querySelectorAll<HTMLButtonElement>('.v-bar .v-rb')].find((b) => (b.textContent ?? '').includes('Laboratori'))!.click();
});
/** Il passo 4 e' ancora li', con il numero scritto. */
async function ancoraAlPasso4(page: Page, qty: Locator, valore: string) {
  await expect(page.locator('.v-sheet.open h2')).toHaveText('Ordina borse');
  await expect(passo(page)).toHaveText('Quantità e prezzo');
  await expect(qty).toHaveValue(valore);
}

test.describe('scheda #villaggio dell\'app intera', () => {
  test('canvas, HUD coerente coi dati, etichette di fienile e laboratori, nessun errore in console', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    const a = attesi(dati);
    expect(a).toEqual({ stock: 10, prep: 19, open: 3 });   // 7 + 3 (la -1 non conta); 6 + 5 + 8; la zebrata e' completa
    await canvasVivo(page);
    await hud(page, a);
    await expect(fienile(page)).toHaveText(`Magazzino${a.stock} pezzi`);
    await expect(fienile(page)).toBeVisible();
    // un capannone per fornitore con righe aperte, con i pezzi che mancano; il ritardo ha il punto esclamativo
    await expect(etichettaLab(page, 'Francesco')).toHaveText(/^Francesco11 pz in preparazione!$/);
    await expect(etichettaLab(page, 'Francesco').locator('.v-bang')).toHaveCount(1);
    await expect(etichettaLab(page, 'Sarte Milano')).toHaveText('Sarte Milano8 pz in preparazione');
    await expect(etichettaLab(page, 'Sarte Milano').locator('.v-bang')).toHaveCount(0);
    await expect(page.locator('.v-labels > .v-lbl:not(.v-mini):not(.v-zone):not(.v-wh)')).toHaveCount(2);
    // carrelli: uno per riga aperta che il villaggio sa disegnare, col numero di pezzi che mancano
    await expect(page.locator('.v-labels .v-yard')).toHaveCount(3);
    expect((await page.locator('.v-labels .v-yard b').allTextContents()).map(Number).sort((x, y) => x - y)).toEqual([5, 6, 8]);
    // pile del magazzino: zone per modello col totale dei pezzi positivi
    await expect(page.locator('.v-labels .v-zone', { hasText: /^Lea/ })).toHaveText(/^Lea10 pz$/);
    await expect(page.locator('.v-labels .v-zone', { hasText: /^Sophie/ })).toHaveText(/^Sophie0 pz$/);
    await expect(page.locator('.v-loading')).toHaveCount(0);
    await expect(page.locator('.v-err')).toHaveCount(0);
    // nell'app intera "scrive" e' solo da leggere (la persona si cambia dalla Home): niente menu; senza scelta e' Ale
    await expect(page.locator('.v-hud .v-chi')).toHaveCount(1);
    await expect(page.locator('.v-hud .v-chi select')).toHaveCount(0);
    await expect(page.locator('.v-hud .v-chi b')).toHaveText('Ale');
    await expect(page.locator('.v-hud .v-chi')).toHaveAttribute('aria-label', 'Scrive Ale');
    await page.waitForTimeout(800);   // qualche frame di rendering, e le miniature
    expect(r.errori).toEqual([]);
    expect(r.posts).toEqual([]);      // aprire il Villaggio non scrive niente
  });

  test('tocco sull\'etichetta di un laboratorio: pannello "<nome> sta preparando", una riga per variante, Arrivate apre la riga di Ordini', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    await etichettaLab(page, 'Francesco').click();
    const sheet = page.locator('.v-sheet.open');
    await expect(sheet.locator('h2')).toHaveText('Francesco sta preparando');
    await expect(sheet.locator('.v-shead p')).toHaveText('Laboratorio pelle · 2 righe, 11 pz da arrivare');
    await expect(sheet.locator('.v-row')).toHaveCount(2);   // Lea cocco nero e Sophie camoscio; la zebrata completa no
    await expect(sheet.locator('.v-row').first()).toContainText('Cocco nero');   // la riga in ritardo in cima
    await expect(sheet.locator('.v-row').first()).toContainText('10 giorni di ritardo');
    await expect(sheet.locator('.v-row', { hasText: 'Camoscio marrone' })).toContainText('0 di 5 arrivate');
    await expect(sheet.locator('.v-gh b')).toHaveText(['Lea', 'Sophie']);
    // giacenza negativa (Sophie camoscio -1) in rosso: classe neg sul chip; la giacenza positiva no
    const chipSophie = sheet.locator('.v-row', { hasText: 'Camoscio marrone' }).locator('.v-chip.stock');
    await expect(chipSophie).toHaveText('in magazzino -1');
    await expect(chipSophie).toHaveClass(/(^|\s)neg(\s|$)/);
    const chipLea = sheet.locator('.v-row', { hasText: 'Cocco nero' }).locator('.v-chip.stock');
    await expect(chipLea).toHaveText('in magazzino 7');
    await expect(chipLea).not.toHaveClass(/(^|\s)neg(\s|$)/);
    // l'etichetta del capannone si nasconde mentre il pannello del laboratorio e' aperto
    await expect(etichettaLab(page, 'Francesco')).toBeHidden();

    const lea = sheet.locator('.v-row', { hasText: 'Cocco nero' });
    await expect(lea.locator('.ds-lrow')).toHaveCount(0);
    await lea.getByRole('button', { name: 'Arrivate' }).click();
    await expect(lea.locator('.v-arrivo .ds-lrow')).toBeVisible();
    await expect(lea.locator('.v-arrivo .ds-recv')).toBeVisible();   // defaultOpen: il campo e' gia' aperto
    await expect(lea.locator('.ds-recv input.num')).toHaveValue('6');   // precompilato con i pezzi che mancano, come in Ordini
    await expect(lea.locator('.ds-segna')).toHaveText('Segna arrivati');
    await expect(lea.getByRole('button', { name: 'Chiudi' })).toBeVisible();

    // chiudere il pannello rimette l'etichetta
    await page.locator('.v-sheet .v-x').click();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0);
    await expect(etichettaLab(page, 'Francesco')).toBeVisible();
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('registrare un arrivo dal pannello: una sola POST arrival_set col totale atteso, poi l\'HUD si aggiorna', async ({ page }) => {
    const dati = datiBase();
    const prima = attesi(dati);
    const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra' });
    await hud(page, prima);
    // la pillola dell'app intera mostra la persona di amimi_chi (Ginevra -> Ginni), senza menu
    await expect(page.locator('.v-hud .v-chi b')).toHaveText('Ginni');
    await expect(page.locator('.v-hud .v-chi select')).toHaveCount(0);
    const lettureIniziali = r.letture.ordini;
    await etichettaLab(page, 'Francesco').click();
    const lea = page.locator('.v-sheet.open .v-row', { hasText: 'Cocco nero' });
    await lea.getByRole('button', { name: 'Arrivate' }).click();
    await lea.locator('.ds-recv input.num').fill('2');
    await expect(lea.locator('.ds-recv')).toContainText('Con questo arrivo il totale diventa 6');   // 4 gia' arrivati + 2 adesso
    expect(await furgoni(page)).toBe(0);   // aprire e ricaricare non fa partire niente
    await lea.locator('.ds-segna').click();

    await expect.poll(() => r.posts.length, ATTESA).toBe(1);
    const p = r.posts[0];
    expect(p.url).toBe('https://e2e-progetto-finto.supabase.co/functions/v1/write-api');
    expect(p.body.action).toBe('arrival_set');
    // al server va il TOTALE (4 gia' arrivati + 2 adesso) e il totale atteso che la schermata mostrava, come fa Ordini
    expect(p.body.payload).toEqual({ order_id: ID.lea, qty: 6, attesi: 4, data: OGGI, costo_unitario: 40 });
    expect(p.body.chi).toBe('Ginevra');
    expect(p.body.force).toBeUndefined();
    expect(r.dialoghi).toEqual([]);   // 6 su 10 ordinati: nessuna conferma

    // dopo il salvataggio ArrivoRow ricarica: l'HUD vede +2 in magazzino e 2 in meno in preparazione
    const dopo = attesi(dati);
    expect(dopo).toEqual({ stock: prima.stock + 2, prep: prima.prep - 2, open: prima.open });
    await hud(page, dopo);
    expect(r.letture.ordini).toBeGreaterThan(lettureIniziali);
    await expect(fienile(page)).toHaveText(`Magazzino${dopo.stock} pezzi`);
    // il toast di Ordini, e Ginni che annuncia l'arrivo
    await avvisoCon(page, 'Arrivo salvato · +2 (totale 6/10)');
    await avvisoCon(page, 'Ginni2 Lea cocco nero in magazzino.');
    // il furgoncino e' partito davvero dal capannone (onPartenza del Mondo), una volta sola
    await expect.poll(() => furgoni(page), ATTESA).toBe(1);
    // il pannello resta su Francesco con i numeri nuovi
    await expect(page.locator('.v-sheet.open .v-shead p')).toHaveText('Laboratorio pelle · 2 righe, 9 pz da arrivare');
    await expect(lea).toContainText('6 di 10 arrivate');
    await page.waitForTimeout(500);
    expect(r.posts).toHaveLength(1);   // nessun'altra scrittura
    expect(await furgoni(page)).toBe(1);
    expect(r.errori).toEqual([]);
  });

  test('arrivo oltre l\'ordinato: compare la conferma di Ordini e, accettata, va al server il totale', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    await etichettaLab(page, 'Sarte Milano').click();
    const nina = page.locator('.v-sheet.open .v-row', { hasText: 'Righe rosso' });
    await expect(nina).toContainText('senza data');
    await nina.getByRole('button', { name: 'Arrivate' }).click();
    await nina.locator('.ds-recv input.num').fill('9');
    await nina.locator('.ds-segna').click();
    await expect.poll(() => r.posts.length, ATTESA).toBe(1);
    expect(r.dialoghi).toHaveLength(1);
    expect(r.dialoghi[0]).toContain('più dei 8 ordinati');
    expect(r.posts[0].body.payload).toMatchObject({ order_id: ID.nina, qty: 9, attesi: 0 });
    expect(r.posts[0].body.chi).toBe('Ale');   // senza persona scelta l'app intera firma Ale
    // la riga e' completa: Sarte Milano non ha piu' righe aperte, il capannone sparisce
    await hud(page, attesi(dati));
    await expect(etichettaLab(page, 'Sarte Milano')).toHaveCount(0);
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Laboratorio');
    await expect(page.locator('.v-sheet.open')).toContainText('Questo laboratorio non ha più righe aperte.');
    // ...ma il furgoncino parte lo stesso: il molo e' letto prima che il capannone sparisca
    await expect.poll(() => furgoni(page), ATTESA).toBe(1);
    expect(r.errori).toEqual([]);
  });

  test('un arrivo che completa l\'UNICA riga di un laboratorio: il capannone sparisce, il furgoncino parte lo stesso e Ginni lo annuncia', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    // Sarte Milano ha una sola riga aperta (Nina righe rosse 0/8)
    expect(dati.ordini.filter((x) => x.fornitore === SARTE && !x.completo)).toHaveLength(1);
    await etichettaLab(page, 'Sarte Milano').click();
    const nina = page.locator('.v-sheet.open .v-row', { hasText: 'Righe rosso' });
    await nina.getByRole('button', { name: 'Arrivate' }).click();
    await expect(nina.locator('.ds-recv input.num')).toHaveValue('8');   // tutto quello che manca: l'arrivo piu' comune
    expect(await furgoni(page)).toBe(0);
    await nina.locator('.ds-segna').click();
    await expect.poll(() => r.posts.length, ATTESA).toBe(1);
    expect(r.posts[0].body.payload).toMatchObject({ order_id: ID.nina, qty: 8, attesi: 0 });
    await hud(page, attesi(dati));
    await avvisoCon(page, 'Arrivo salvato · +8 (totale 8/8)');
    // il laboratorio non ha piu' righe aperte: sparisce dal mondo
    await expect(etichettaLab(page, 'Sarte Milano')).toHaveCount(0, ATTESA);
    await expect(page.locator('.v-labels > .v-lbl:not(.v-mini):not(.v-zone):not(.v-wh)')).toHaveCount(1);
    // come per un arrivo parziale: il furgoncino parte dal molo del capannone appena sparito, e Ginni lo annuncia
    await expect.poll(() => furgoni(page), ATTESA).toBe(1);
    await avvisoCon(page, 'Ginni8 Nina righe rosso in magazzino.');
    expect(r.errori).toEqual([]);
  });

  test('Escape chiude il pannello aperto; il pannello e\' un dialog etichettato dal suo h2', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    // chiuso: aria-hidden, nessun dialog per le tecnologie assistive
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await etichettaLab(page, 'Francesco').click();
    const sheet = page.locator('.v-sheet.open');
    await expect(sheet).toHaveAttribute('role', 'dialog');
    const idTitolo = await sheet.getAttribute('aria-labelledby');
    expect(idTitolo, 'aria-labelledby del pannello').toBeTruthy();
    // l'id punta a UN solo elemento, ed e' l'h2 del pannello
    await expect(page.locator(`[id="${idTitolo}"]`)).toHaveCount(1);
    await expect(sheet.locator('h2')).toHaveAttribute('id', idTitolo!);
    await expect(page.getByRole('dialog', { name: 'Francesco sta preparando', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.v-sheet.open')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(etichettaLab(page, 'Francesco')).toBeVisible();
    // anche un altro pannello: il Magazzino dalla barra in basso
    await page.locator('.v-bar .v-rb', { hasText: 'Magazzino' }).click();
    await expect(page.getByRole('dialog', { name: 'Magazzino', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Escape senza pannelli aperti non fa niente: si resta nel Villaggio
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('.vil')).toHaveCount(1);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('ordine nuovo dal +: fornitore, modello e colore con le figure, poi il modulo di Ordini; esce UNA order_multi', async ({ page }) => {
    const dati = datiBase();
    const prima = attesi(dati);
    const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra' });
    await hud(page, prima);
    await page.getByRole('button', { name: 'Ordina borse' }).click();
    const sheet = page.locator('.v-sheet.open');
    const passo = sheet.locator('.v-shead p');
    await expect(sheet.locator('h2')).toHaveText('Ordina borse');
    await expect(passo).toHaveText('A chi lo ordini?');
    await sheet.locator('.v-tile', { has: page.locator('b', { hasText: /^Francesco$/ }) }).click();
    await expect(passo).toHaveText('Che modello?');
    await sheet.locator('.v-tile', { has: page.locator('b', { hasText: /^Lea$/ }) }).click();
    await expect(passo).toHaveText('Che materiale e colore?');
    await sheet.locator('.v-vt', { hasText: 'Cocco nero' }).click();
    await expect(passo).toHaveText('Quantità e prezzo');
    // il passo 4 dice sempre il codice scelto, e "da <laboratorio>" perche' Francesco e' un fornitore vero
    await expect(sheet.locator('.v-qty b')).toHaveText('Lea · Cocco nero');
    await expect(sheet.locator('.v-qty small')).toHaveText('LEA_BAG_COCCO_BLACK · da Francesco · in magazzino 7');
    // il modulo vero di Ordini, gia' sul fornitore e sulla variante scelti con le figure
    const form = sheet.locator('.v-form');
    await expect(form.locator('.ordtop .chip.on')).toHaveText(`${FRANCESCO} ✕`, ATTESA);
    const rigaCarrello = form.locator('.cartrow[data-cart-codice="LEA_BAG_COCCO_BLACK"]');
    await expect(rigaCarrello).toBeVisible(ATTESA);
    await rigaCarrello.locator('input.qbox').fill('5');
    await rigaCarrello.locator('input.cbox').fill('42');
    expect(r.posts).toEqual([]);
    await form.getByRole('button', { name: 'Salva ordine (1)' }).click();
    await expect.poll(() => r.posts.length, ATTESA).toBe(1);
    const p = r.posts[0];
    expect(p.url).toBe('https://e2e-progetto-finto.supabase.co/functions/v1/write-api');
    expect(p.body.action).toBe('order_multi');
    expect(p.body.chi).toBe('Ginevra');
    expect(p.body.payload).toEqual({
      fornitore: FRANCESCO, data_ordine: OGGI,
      righe: [{ codice: 'LEA_BAG_COCCO_BLACK', item: 'LEA BAG', variant: 'COCCO BLACK', qty_ordered: 5, wip: false, nuovo_riordino: 'Riordino', costo_unitario: 42 }],
    });
    // onDone del modulo (700 ms dopo): ricarica, Ginni conferma e il pannello passa ai Laboratori
    await expect(sheet.locator('h2')).toHaveText('Laboratori', ATTESA);
    await avvisoCon(page, 'Ordine salvato · 1 borse');
    await avvisoCon(page, 'GinniOrdine salvato: lo trovi anche in Ordini.');
    const dopo = attesi(dati);
    expect(dopo).toEqual({ stock: prima.stock, prep: prima.prep + 5, open: prima.open + 1 });
    await hud(page, dopo);
    await page.keyboard.press('Escape');
    await expect(etichettaLab(page, 'Francesco')).toHaveText(/^Francesco16 pz in preparazione!$/, ATTESA);   // 6 + 5 + i 5 nuovi
    await page.waitForTimeout(500);
    expect(r.posts).toHaveLength(1);
    expect(await furgoni(page)).toBe(0);   // un ordine non e' un arrivo: il furgoncino resta fermo
    expect(r.errori).toEqual([]);
  });

  test('Home dell\'HUD torna alla Home dell\'app', async ({ page }) => {
    const r = await apri(page, '#villaggio', datiBase());
    await hud(page, attesi(datiBase()));
    await page.locator('.v-hud .v-home').click();
    await expect(page.locator('.vil')).toHaveCount(0);
    await expect(page.locator('.hello h1')).toContainText('Ciao');
    expect(r.errori).toEqual([]);
  });

  test('Home dell\'HUD col passo 4 toccato chiede; Annulla tiene il modulo e il numero, OK va alla Home; non toccato esce senza chiedere', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    const qty = await alPasso4(page);
    await qty.fill('5');
    r.conferme.accetta = false;
    await page.locator('.v-hud .v-home').click();
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(1);
    expect(r.dialoghi[0]).toBe(LASCI);
    await page.waitForTimeout(400);
    await ancoraAlPasso4(page, qty, '5');
    await expect(page.locator('.vil')).toHaveCount(1);
    r.conferme.accetta = true;
    await page.locator('.v-hud .v-home').click();
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(2);
    expect(r.dialoghi[1]).toBe(LASCI);
    await expect(page.locator('.vil')).toHaveCount(0, ATTESA);
    await expect(page.locator('.hello h1')).toContainText('Ciao');
    // passo 4 non toccato: la Home esce subito, senza conferma (l'URL e' ancora #villaggio: si ricarica li')
    await page.reload();
    await hud(page, attesi(dati));
    await alPasso4(page);
    await page.locator('.v-hud .v-home').click();
    await expect(page.locator('.vil')).toHaveCount(0, ATTESA);
    await expect(page.locator('.hello h1')).toContainText('Ciao');
    expect(r.dialoghi).toHaveLength(2);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('X e Home nello stesso istante: si arriva alla Home e il Villaggio non torna', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    await barra(page, 'Magazzino').click();
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Magazzino');
    // i due tocchi nello stesso task: l'history.back() della X e' ancora in volo quando si chiede la Home
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('.v-sheet .v-x')!.click();
      document.querySelector<HTMLButtonElement>('.v-hud .v-home')!.click();
    });
    await expect(page.locator('.vil')).toHaveCount(0, ATTESA);
    await expect(page.locator('.hello h1')).toContainText('Ciao');
    // il popstate della X e' arrivato e non ha consumato la voce del cambio di scheda di App: niente rimbalzo nel Villaggio
    await page.waitForTimeout(2000);
    await expect(page.locator('.vil')).toHaveCount(0);
    await expect(page.locator('.hello h1')).toContainText('Ciao');
    // quella voce c'e' ancora: "indietro" dalla Home riporta al Villaggio (come da ogni scheda), senza pannelli aperti
    await page.goBack();
    await expect(page.locator('.vil')).toHaveCount(1, ATTESA);
    await hud(page, attesi(dati));
    await expect(page.locator('.v-sheet.open')).toHaveCount(0);
    expect(r.dialoghi).toEqual([]);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('ordine salvato, poi prima di onDone (700 ms) "Cambia colore" e un altro colore: il passo 4 nuovo resta, ricarica e avviso arrivano lo stesso', async ({ page }) => {
    const dati = datiBase();
    const prima = attesi(dati);
    const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra' });
    await hud(page, prima);
    const qty = await alPasso4(page);
    await qty.fill('5');
    await expect(qty).toHaveValue('5');
    await expect(page.locator('.v-sheet.open .v-form').getByRole('button', { name: 'Salva ordine (1)' })).toBeEnabled();
    // tutto dentro la pagina: Salva; appena compare il toast di Ordini (SupplierOrderForm ha appena messo il timer di
    // 700 ms per onDone) "Cambia colore" (la conferma la accetta il gestore dei dialoghi) e, al passo 3, l'altro colore
    const esito = await page.evaluate(async () => {
      const salvato = new Promise<number>((ok) => {
        const mo = new MutationObserver(() => {
          if ([...document.querySelectorAll('#toast-host .toast')].some((el) => (el.textContent ?? '').includes('Ordine salvato ·'))) { mo.disconnect(); ok(performance.now()); }
        });
        mo.observe(document.body, { subtree: true, childList: true });
      });
      [...document.querySelectorAll<HTMLButtonElement>('.v-sheet.open .v-form button')].find((b) => (b.textContent ?? '').includes('Salva ordine'))!.click();
      const t0 = await salvato;
      document.querySelector<HTMLButtonElement>('.v-sheet.open .v-back')!.click();   // ‹ Cambia colore
      let altro: HTMLButtonElement | undefined;
      for (let i = 0; i < 400 && !altro; i++) {
        if (document.querySelector('.v-sheet.open .v-shead p')?.textContent === 'Che materiale e colore?') {
          altro = [...document.querySelectorAll<HTMLButtonElement>('.v-sheet.open .v-vt')].find((b) => !(b.textContent ?? '').includes('Cocco nero'));
        }
        if (!altro) await new Promise((ok) => setTimeout(ok, 0));
      }
      altro?.click();
      return { altro: !!altro, ms: Math.round(performance.now() - t0) };
    });
    test.info().annotations.push({ type: 'tempi', description: `dal toast di Ordini al secondo colore: ${esito.ms} ms` });
    expect(esito.altro, JSON.stringify(esito)).toBe(true);
    // il timer di onDone parte nello stesso giro del toast: sotto i 700 ms il secondo colore e' arrivato prima (misurati ~100 ms)
    expect(esito.ms, 'il secondo colore deve arrivare prima di onDone').toBeLessThan(700);
    expect(r.dialoghi).toEqual([LASCI]);
    await expect(passo(page)).toHaveText('Quantità e prezzo');
    await expect(page.locator('.v-sheet.open .v-qty small')).toHaveText('LEA_BAG_PONY_ZEBRA · da Francesco · in magazzino 3');
    // onDone arriva lo stesso: ricarica (l'HUD vede l'ordine) e Ginni conferma
    await avvisoCon(page, 'Ordine salvato · 1 borse');
    await avvisoCon(page, 'GinniOrdine salvato: lo trovi anche in Ordini.');
    const dopo = attesi(dati);
    expect(dopo).toEqual({ stock: prima.stock, prep: prima.prep + 5, open: prima.open + 1 });
    await hud(page, dopo);
    await page.waitForTimeout(800);
    // ...ma il pannello resta sul passo 4 nuovo, non passa ai Laboratori
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Ordina borse');
    await expect(passo(page)).toHaveText('Quantità e prezzo');
    await expect(page.locator('.v-sheet.open .v-form .cartrow[data-cart-codice="LEA_BAG_PONY_ZEBRA"]')).toBeVisible(ATTESA);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0].body.action).toBe('order_multi');
    expect(r.posts[0].body.chi).toBe('Ginevra');
    expect(r.posts[0].body.payload).toMatchObject({ fornitore: FRANCESCO, righe: [{ codice: 'LEA_BAG_COCCO_BLACK', qty_ordered: 5 }] });
    // il passo 4 nuovo non e' toccato: la X chiude senza chiedere
    await page.locator('.v-sheet .v-x').click();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    expect(r.dialoghi).toEqual([LASCI]);
    expect(r.posts).toHaveLength(1);
    expect(r.errori).toEqual([]);
  });

  test('passo 4 toccato: Esc nel campo resta al campo; Esc fuori chiede, Annulla tiene il modulo e il numero, OK lo chiude', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    const qty = await alPasso4(page);
    await qty.fill('5');
    // Esc dentro il campo e' del campo: niente conferma, il pannello resta
    await qty.press('Escape');
    await page.waitForTimeout(400);
    expect(r.dialoghi).toEqual([]);
    await ancoraAlPasso4(page, qty, '5');
    // fuori dai campi Esc vuole chiudere: prima chiede
    await qty.blur();
    r.conferme.accetta = false;
    await page.keyboard.press('Escape');
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(1);
    expect(r.dialoghi[0]).toBe(LASCI);
    await ancoraAlPasso4(page, qty, '5');
    r.conferme.accetta = true;
    await page.keyboard.press('Escape');
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(2);
    expect(r.dialoghi[1]).toBe(LASCI);
    await expect(page.locator('.v-sheet.open')).toHaveCount(0);
    await expect(page.locator('.vil')).toHaveCount(1);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('passo 4 toccato: etichetta della mappa, barra in basso, X e "Cambia colore" chiedono; la mappa non chiude; OK porta ai Laboratori', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    const qty = await alPasso4(page);
    await qty.fill('5');
    r.conferme.accetta = false;
    // l'etichetta di un capannone: aprirebbe il suo pannello
    await etichettaLab(page, 'Francesco').click();
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(1);
    await ancoraAlPasso4(page, qty, '5');
    // la barra in basso: aprirebbe i Laboratori
    await page.locator('.v-bar .v-rb', { hasText: 'Laboratori' }).click();
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(2);
    await ancoraAlPasso4(page, qty, '5');
    // la X del pannello
    await page.locator('.v-sheet .v-x').click();
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(3);
    await ancoraAlPasso4(page, qty, '5');
    // "Cambia colore" torna al passo 3 e il modulo si perderebbe
    await page.locator('.v-sheet.open .v-back', { hasText: 'Cambia colore' }).click();
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(4);
    await ancoraAlPasso4(page, qty, '5');
    // un tocco sull'isola al passo 4 non chiude e non chiede
    await page.locator('canvas.v-canvas').click({ position: { x: 200, y: 360 } });
    await page.waitForTimeout(500);
    expect(r.dialoghi).toHaveLength(4);
    await ancoraAlPasso4(page, qty, '5');
    expect(r.dialoghi.every((m) => m === LASCI), r.dialoghi.join(' | ')).toBe(true);
    // con OK la barra in basso apre davvero i Laboratori
    r.conferme.accetta = true;
    await page.locator('.v-bar .v-rb', { hasText: 'Laboratori' }).click();
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(5);
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Laboratori');
    await expect(page.locator('.v-sheet.open .v-form')).toHaveCount(0);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('passo 4 toccato: "indietro" di Android chiede; Annulla tiene il modulo, OK lo chiude e si resta nel Villaggio', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    const qty = await alPasso4(page);
    await qty.fill('5');
    r.conferme.accetta = false;
    await page.goBack();
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(1);
    expect(r.dialoghi[0]).toBe(LASCI);
    await ancoraAlPasso4(page, qty, '5');
    // annullato, la voce di history e' stata rimessa: un altro "indietro" chiede di nuovo
    r.conferme.accetta = true;
    await page.goBack();
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(2);
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    await expect(page.locator('.vil')).toHaveCount(1);
    await expect(page).toHaveURL(/#villaggio$/);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('passo 4 non toccato: Esc, X e "indietro" chiudono senza chiedere', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    await alPasso4(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    await alPasso4(page);
    await page.locator('.v-sheet .v-x').click();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    await alPasso4(page);
    await page.goBack();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    await page.waitForTimeout(400);
    expect(r.dialoghi).toEqual([]);
    await expect(page.locator('.vil')).toHaveCount(1);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('X e subito Laboratori: il pannello riaperto resta aperto quando arriva il popstate della X', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    const titolo = page.locator('.v-sheet.open h2');
    // i due tocchi nello stesso task: l'history.back() della X e' ancora in volo quando i Laboratori si aprono
    await barra(page, 'Magazzino').click();
    await expect(titolo).toHaveText('Magazzino');
    await xESubitoLaboratori(page);
    await page.waitForTimeout(1500);
    await expect(titolo).toHaveText('Laboratori');
    await expect(page.locator('.vil')).toHaveCount(1);
    // lo stesso con i tocchi di Playwright, uno dopo l'altro: qui l'indietro della X arriva prima del secondo tocco, e
    // la voce di history rimasta chiude il pannello riaperto senza uscire dal Villaggio
    await page.reload();
    await hud(page, attesi(dati));
    await barra(page, 'Magazzino').click();
    await expect(titolo).toHaveText('Magazzino');
    await page.locator('.v-sheet .v-x').click();
    await barra(page, 'Laboratori').click();
    await page.waitForTimeout(1500);
    await expect(titolo).toHaveText('Laboratori');
    await page.goBack();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    await expect(page.locator('.vil')).toHaveCount(1);
    await expect(page).toHaveURL(/#villaggio$/);
    expect(r.dialoghi).toEqual([]);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  // Se la X e il nuovo pannello arrivano prima che l'history.back() della X sia eseguito, Chromium torna comunque alla voce
  // di PRIMA del primo pannello (il bersaglio e' fissato quando si chiama back()). Per questo apri() aspetta quel popstate
  // (quandoArrivaIlBack) e solo dopo spinge la voce del pannello riaperto: "indietro" e la sua X lo chiudono e si resta
  // nel Villaggio, invece di uscire (about:blank qui, la pagina precedente o la chiusura della PWA sul telefono).
  test('X e subito Laboratori nello stesso istante: "indietro" e la X chiudono il pannello riaperto e si resta nel Villaggio', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    const titolo = page.locator('.v-sheet.open h2');
    await barra(page, 'Magazzino').click();
    await expect(titolo).toHaveText('Magazzino');
    await xESubitoLaboratori(page);
    await page.waitForTimeout(1500);
    await expect(titolo).toHaveText('Laboratori');
    // "indietro" chiude il pannello riaperto, la pagina resta il Villaggio
    await page.goBack();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    await expect(page.locator('.vil')).toHaveCount(1);
    await expect(page).toHaveURL(/#villaggio$/);
    // di nuovo, e questa volta la X: chiude e basta
    await barra(page, 'Magazzino').click();
    await expect(titolo).toHaveText('Magazzino');
    await xESubitoLaboratori(page);
    await page.waitForTimeout(1500);
    await expect(titolo).toHaveText('Laboratori');
    await page.locator('.v-sheet .v-x').click();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/#villaggio$/);
    await expect(page.locator('.vil')).toHaveCount(1);
    await expect(page.locator('.v-sheet.open')).toHaveCount(0);
    expect(r.dialoghi).toEqual([]);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('passo 3: due codici con lo stesso nome (MILITARY_GREEN / GREEN_MILITARY) mostrano il codice, gli altri no; il passo 4 dice il codice scelto', async ({ page }) => {
    const dati = datiBase();
    // stessa figura e stesso nome italiano ("Verde militare"): una pila sola con due codici
    dati.magazzino.push(inv('LEA_BAG_MILITARY_GREEN', 'LEA BAG', 'MILITARY GREEN', 2), inv('LEA_BAG_GREEN_MILITARY', 'LEA BAG', 'GREEN MILITARY', 1));
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    await page.getByRole('button', { name: 'Ordina borse', exact: true }).click();
    await tile(page, 'Francesco').click();
    await tile(page, 'Lea').click();
    await expect(passo(page)).toHaveText('Che materiale e colore?');
    const voci = page.locator('.v-sheet.open .v-vt');
    await expect(voci).toHaveCount(4);   // cocco nero, pony zebra e i due verde militare
    await expect(page.locator('.v-sheet.open .v-vt', { hasText: 'Verde militare' })).toHaveCount(2);
    expect((await page.locator('.v-sheet.open .v-vt .cod').allTextContents()).sort()).toEqual(['LEA_BAG_GREEN_MILITARY', 'LEA_BAG_MILITARY_GREEN']);
    // le figure con un nome solo non mostrano il codice
    await expect(page.locator('.v-sheet.open .v-vt:not(:has(.cod))')).toHaveCount(2);
    await expect(page.locator('.v-sheet.open .v-vt', { hasText: 'Cocco nero' }).locator('.cod')).toHaveCount(0);
    const verde = page.locator('.v-sheet.open .v-vt', { hasText: 'LEA_BAG_GREEN_MILITARY' });
    await expect(verde).toContainText('in magazzino 1');
    await verde.click();
    await expect(passo(page)).toHaveText('Quantità e prezzo');
    await expect(page.locator('.v-sheet.open .v-qty b')).toHaveText('Lea · Verde militare');
    await expect(page.locator('.v-sheet.open .v-qty small')).toHaveText('LEA_BAG_GREEN_MILITARY · da Francesco · in magazzino 1');
    await expect(page.locator('.v-sheet.open .v-form .cartrow[data-cart-codice="LEA_BAG_GREEN_MILITARY"]')).toBeVisible(ATTESA);
    // non toccato: la X chiude senza chiedere
    await page.locator('.v-sheet .v-x').click();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    expect(r.dialoghi).toEqual([]);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('un laboratorio senza fornitore offre "+ Ordina borse" dal passo 1, e senza fornitore il passo 4 non dice "da ..."', async ({ page }) => {
    const dati = datiBase();
    dati.ordini.push(riga(ID.anonimo, 'G3', null, 'LEA_BAG_PONY_ZEBRA', 'LEA BAG', 'PONY ZEBRA', 2, 0, traGiorni(5)));
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    await expect(etichettaLab(page, 'Senza fornitore')).toHaveText('Senza fornitore2 pz in preparazione');
    await etichettaLab(page, 'Senza fornitore').click();
    const sheet = page.locator('.v-sheet.open');
    await expect(sheet.locator('h2')).toHaveText('Senza fornitore sta preparando');
    await expect(sheet.getByRole('button', { name: /^\+ Ordina a / })).toHaveCount(0);
    await sheet.getByRole('button', { name: '+ Ordina borse', exact: true }).click();
    await expect(sheet.locator('h2')).toHaveText('Ordina borse');
    await expect(passo(page)).toHaveText('A chi lo ordini?');
    // al passo 1 solo i fornitori veri, piu' "Un altro"
    await expect(sheet.locator('.v-tile b')).toHaveText(['Francesco', 'Sarte Milano', 'Un altro']);
    await tile(page, 'Un altro').click();
    await expect(sheet.locator('.v-back')).toHaveText('‹ Cambia fornitore');
    await tile(page, 'Lea').click();
    await sheet.locator('.v-vt', { hasText: 'Cocco nero' }).click();
    await expect(passo(page)).toHaveText('Quantità e prezzo');
    await expect(sheet.locator('.v-qty small')).toHaveText('LEA_BAG_COCCO_BLACK · scegli il fornitore qui sotto · in magazzino 7');
    await page.locator('.v-sheet .v-x').click();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    expect(r.dialoghi).toEqual([]);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  // Sarte Milano nei dati base ha una riga sola (Nina righe rosse): intestazione del pannello e riga dei Laboratori al
  // singolare (righe(n) di Villaggio.tsx); Francesco, con due righe, resta al plurale.
  test('un laboratorio con una sola riga aperta dice "1 riga", non "1 righe"', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    await etichettaLab(page, 'Sarte Milano').click();
    await expect(page.locator('.v-sheet.open .v-shead p')).toHaveText('Laboratorio tessuto · 1 riga, 8 pz da arrivare');
    await page.keyboard.press('Escape');
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    await barra(page, 'Laboratori').click();
    await expect(page.locator('.v-sheet.open .v-lrow', { hasText: 'Sarte Milano' }).locator('small')).toHaveText('tessuto · 1 riga · 8 pz');
    await expect(page.locator('.v-sheet.open .v-lrow', { hasText: 'Francesco' }).locator('small')).toHaveText('pelle · 2 righe · 11 pz');
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('dopo 20 s senza tocchi il mondo riposa: le etichette restano cliccabili e un arrivo fa partire il furgoncino', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    await page.waitForTimeout(22000);   // RIPOSO_MS = 20 s
    await expect(etichettaLab(page, 'Francesco')).toBeVisible();
    await etichettaLab(page, 'Francesco').click();
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Francesco sta preparando');
    const lea = page.locator('.v-sheet.open .v-row', { hasText: 'Cocco nero' });
    await lea.getByRole('button', { name: 'Arrivate' }).click();
    await lea.locator('.ds-recv input.num').fill('1');
    await lea.locator('.ds-segna').click();
    await expect.poll(() => r.posts.length, ATTESA).toBe(1);
    expect(r.posts[0].body).toMatchObject({ action: 'arrival_set', payload: { order_id: ID.lea, qty: 5, attesi: 4 } });
    await hud(page, attesi(dati));
    await expect.poll(() => furgoni(page), ATTESA).toBe(1);
    await canvasVivo(page);
    expect(r.errori).toEqual([]);
  });
});

test.describe('app a se\' /amimi-app/villaggio/ (telefono di Ginni)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('si carica col suo manifest; alla prima apertura chiede chi usa il telefono, scelta Ginni scrive come Ginevra; Home porta all\'app intera', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, 'villaggio/', dati);
    await expect(page).toHaveTitle('Villaggio Amimì');
    // fase 3: senza una persona salvata su questo telefono non si parte da nessuno (mai da Ale): si chiede, e intanto il
    // villaggio non e' montato (niente letture sue)
    await expect(page.getByText('Chi usa questo telefono?')).toBeVisible(ATTESA);
    const scelte = page.locator('.screen .card button');
    await expect(scelte).toHaveText(['Ale', 'Benny', 'Ginni']);
    await expect(page.locator('.vil')).toHaveCount(0);
    expect(r.letture.ordini).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('amimi_chi'))).toBeNull();
    await scelte.filter({ hasText: 'Ginni' }).click();
    expect(await page.evaluate(() => localStorage.getItem('amimi_chi'))).toBe('Ginevra');
    await expect(page.locator('.v-hud .v-chi select')).toHaveValue('Ginevra', ATTESA);
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('/amimi-app/villaggio/manifest.webmanifest');
    const man = await page.request.get(new URL(href!, page.url()).toString());
    expect(man.ok()).toBe(true);
    const mj = await man.json();
    // id proprio (si installa accanto all'app intera, che non ha id: vale il suo start_url /amimi-app/) e scope stretto
    // /amimi-app/villaggio/: le due app installate non si contendono i link (per esempio la push di ce-guard); installata,
    // la Home dell'HUD apre l'app intera in una finestra sua (test "installata" qui sotto)
    expect(mj).toMatchObject({ id: '/amimi-app/villaggio/', start_url: '/amimi-app/villaggio/', scope: '/amimi-app/villaggio/', display: 'standalone' });
    const principale = await (await page.request.get(new URL('/amimi-app/manifest.webmanifest', page.url()).toString())).json();
    expect(principale.id ?? principale.start_url).not.toBe(mj.id);
    for (const ic of mj.icons as { src: string }[]) expect((await page.request.get(new URL(ic.src, page.url()).toString())).ok()).toBe(true);
    // niente app intera intorno: nessuna barra in basso, nessun assistente
    await expect(page.locator('.bottomnav')).toHaveCount(0);
    await canvasVivo(page);
    await hud(page, attesi(dati));
    await expect(fienile(page)).toHaveText(`Magazzino${attesi(dati).stock} pezzi`);

    // scelta Ginni, le scritture sono firmate Ginevra
    await etichettaLab(page, 'Francesco').click();
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Francesco sta preparando');
    const sophie = page.locator('.v-sheet.open .v-row', { hasText: 'Camoscio marrone' });
    await sophie.getByRole('button', { name: 'Arrivate' }).click();
    await sophie.locator('.ds-recv input.num').fill('1');
    await sophie.locator('.ds-segna').click();
    await expect.poll(() => r.posts.length, ATTESA).toBe(1);
    expect(r.posts[0].body).toMatchObject({ action: 'arrival_set', chi: 'Ginevra', payload: { order_id: ID.sophie, qty: 1, attesi: 0 } });
    await hud(page, attesi(dati));
    await expect.poll(() => furgoni(page), ATTESA).toBe(1);
    await page.locator('.v-sheet .v-x').click();

    await page.locator('.v-hud .v-home').click();
    await expect(page).toHaveURL(/\/amimi-app\/$/);
    await expect(page.locator('.hello h1')).toContainText('Ciao');
    await expect(page.locator('.bottomnav')).toBeVisible();
    expect(r.errori).toEqual([]);
  });

  test('non installata, passo 4 toccato: Home chiede; Annulla tiene il modulo, OK porta a /amimi-app/; non toccato esce senza chiedere', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, 'villaggio/', dati, { chi: 'Ginevra' });
    await hud(page, attesi(dati));
    const qty = await alPasso4(page);
    await qty.fill('5');
    r.conferme.accetta = false;
    await page.locator('.v-hud .v-home').click();
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(1);
    expect(r.dialoghi[0]).toBe(LASCI);
    await page.waitForTimeout(400);
    await ancoraAlPasso4(page, qty, '5');
    await expect(page).toHaveURL(/\/amimi-app\/villaggio\/$/);
    r.conferme.accetta = true;
    await page.locator('.v-hud .v-home').click();
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(2);
    expect(r.dialoghi[1]).toBe(LASCI);
    await expect(page).toHaveURL(/\/amimi-app\/$/, ATTESA);
    await expect(page.locator('.hello h1')).toContainText('Ciao');
    // di nuovo nel Villaggio a se', passo 4 non toccato: la Home porta all'app intera senza conferma
    await page.goto('villaggio/');
    await hud(page, attesi(dati));
    await alPasso4(page);
    await page.locator('.v-hud .v-home').click();
    await expect(page).toHaveURL(/\/amimi-app\/$/, ATTESA);
    await expect(page.locator('.hello h1')).toContainText('Ciao');
    expect(r.dialoghi).toHaveLength(2);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('installata (display-mode standalone): Home apre l\'app intera in una finestra sua, con chi scrive, e il Villaggio resta', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = window.matchMedia.bind(window);
      window.matchMedia = ((q: string) => (/display-mode:\s*standalone/.test(q)
        ? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }
        : orig(q))) as typeof window.matchMedia;
      const aperte: unknown[][] = [];
      (window as unknown as { __aperte: unknown[][] }).__aperte = aperte;
      window.open = ((...a: unknown[]) => { aperte.push(a); return null; }) as typeof window.open;
    });
    const dati = datiBase();
    const r = await apri(page, 'villaggio/', dati, { chi: 'Ginevra' });
    await hud(page, attesi(dati));
    await page.locator('.v-hud .v-home').click();
    // fase 3: su iPhone la finestra nuova ha uno storage suo, dove si partirebbe da Ale: ?chi= le dice chi scrive
    await expect.poll(() => page.evaluate(() => (window as unknown as { __aperte: unknown[][] }).__aperte), ATTESA).toEqual([['/amimi-app/?chi=Ginevra', '_blank', 'noopener']]);
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/amimi-app\/villaggio\/$/);
    await expect(page.locator('.vil')).toHaveCount(1);
    expect(r.errori).toEqual([]);
  });

  test('il menu "scrive" sceglie chi firma (Ginni, Ale, Benny), resta sul telefono e l\'arrival_set porta la persona scelta', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, 'villaggio/', dati);
    // prima apertura: si sceglie Ginni nella schermata di benvenuto, poi si cambia dal menu
    await page.locator('.screen .card button', { hasText: 'Ginni' }).click();
    await hud(page, attesi(dati));
    const menu = page.locator('.v-hud .v-chi select');
    await expect(menu).toHaveCount(1);
    await expect(menu).toBeEnabled();
    await expect(page.getByRole('combobox', { name: 'Chi scrive' })).toHaveCount(1);
    // le persone dell'app (Ale, Bene, Ginevra) coi loro nomi; scelta Ginni, scrive Ginevra
    await expect(menu.locator('option')).toHaveText(['Ale', 'Benny', 'Ginni']);
    await expect(menu).toHaveValue('Ginevra');
    // un giro completo: ogni scelta vale subito per il dispositivo (amimi_chi, la stessa chiave dell'app intera)
    for (const [valore, nome] of [['Ale', 'Ale'], ['Bene', 'Benny'], ['Ginevra', 'Ginni'], ['Bene', 'Benny']] as const) {
      await menu.selectOption(valore);
      await expect(menu).toHaveValue(valore);
      await expect(menu.locator('option:checked')).toHaveText(nome);
      expect(await page.evaluate(() => localStorage.getItem('amimi_chi'))).toBe(valore);
    }
    expect(r.posts).toEqual([]);   // cambiare persona non scrive niente

    await etichettaLab(page, 'Francesco').click();
    const sophie = page.locator('.v-sheet.open .v-row', { hasText: 'Camoscio marrone' });
    await sophie.getByRole('button', { name: 'Arrivate' }).click();
    await sophie.locator('.ds-recv input.num').fill('2');
    await sophie.locator('.ds-segna').click();
    await expect.poll(() => r.posts.length, ATTESA).toBe(1);
    // chi firma viaggia nel corpo della POST (accanto al payload, non dentro): e' la persona scelta, non piu' Ginevra
    expect(r.posts[0].body).toMatchObject({ action: 'arrival_set', chi: 'Bene', payload: { order_id: ID.sophie, qty: 2, attesi: 0 } });
    await hud(page, attesi(dati));

    // riaperta, l'app a se' ricorda chi scrive
    await page.reload();
    await expect(page.locator('.v-hud .v-chi select')).toHaveValue('Bene', ATTESA);
    await expect(page.locator('.v-hud .v-chi select option:checked')).toHaveText('Benny');
    expect(r.posts).toHaveLength(1);
    expect(r.errori).toEqual([]);
  });
});

test.describe('telefono con schermo denso (deviceScaleFactor 3)', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

  test('in verticale il canvas ha il tetto 1,5x; girato in orizzontale torna al tetto 2x', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, 'villaggio/', dati, { chi: 'Ginevra' });
    await hud(page, attesi(dati));
    const c = page.locator('canvas.v-canvas');
    await canvasVivo(page);
    expect(await c.evaluate((el: HTMLCanvasElement) => [el.width, el.height, window.devicePixelRatio])).toEqual([585, 1266, 3]);   // 390 x 844 a 1,5
    // rotazione: resize() ricalcola il verticale e il tetto del pixel ratio
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => c.evaluate((el: HTMLCanvasElement) => [el.width, el.height]), ATTESA).toEqual([1688, 780]);   // 844 x 390 a 2
    await canvasVivo(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => c.evaluate((el: HTMLCanvasElement) => [el.width, el.height]), ATTESA).toEqual([585, 1266]);
    expect(r.errori).toEqual([]);
  });
});

test.describe('Cruscotto', () => {
  test('con la persona Ale il Cruscotto mostra "Apri il Villaggio" e il click lo apre', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '', dati, { chi: 'Ale' });
    // a flag acceso la Home ha la tile (controllo positivo per i test a flag spento)
    await expect(tileVillaggio(page).first()).toBeVisible(ATTESA);
    await page.locator('.ds-qbtn', { hasText: 'Cruscotto finanze' }).click();
    const sez = page.locator('section.card', { has: page.locator('h2', { hasText: /^Villaggio$/ }) });
    await expect(sez).toBeVisible();
    await sez.getByRole('button', { name: 'Apri il Villaggio →' }).click();
    await canvasVivo(page);
    await hud(page, attesi(dati));
    // la Home dell'HUD torna alla Home dell'app
    await page.locator('.v-hud .v-home').click();
    await expect(page.locator('.vil')).toHaveCount(0);
    expect(r.errori).toEqual([]);
  });
});

// Regola Ferrea 19: a flag spento il Villaggio non esiste per nessun ingresso. Due modi di essere spento: la riga dice
// 'false', oppure la vista non c'e' ancora (migr 0162 non applicata in prod: 404 PGRST205), che deve valere "spento".
for (const caso of [
  { nome: 'villaggio_enabled = \'false\'', flag: 'false' as const },
  { nome: 'vista v_villaggio_settings assente (404 di PostgREST)', flag: '404' as const },
]) {
  test.describe(`flag spento: ${caso.nome}`, () => {
    test('#villaggio dice "Sezione non attiva", la Home non ha la tile, il Cruscotto non ha "Apri il Villaggio"', async ({ page }) => {
      const dati = datiBase();
      const r = await apri(page, '#villaggio', dati, { chi: 'Ale', flag: caso.flag });
      await expect.poll(() => r.letture.flag, ATTESA).toBeGreaterThan(0);
      await expect(page.locator('.card', { hasText: 'Sezione non attiva' })).toHaveText('Sezione non attiva (flag villaggio_enabled spento).', ATTESA);
      await expect(page.locator('.vil')).toHaveCount(0);
      await expect(page.locator('canvas')).toHaveCount(0);
      expect(r.letture.ordini).toBe(0);   // il Villaggio non e' montato: niente letture sue

      // Home: nessuna tile, ne' tra le azioni ne' cercandola
      await page.getByRole('button', { name: '‹ Home' }).click();
      await expect(page.locator('.hello h1')).toContainText('Ciao');
      await expect(page.locator('.ds-qbtn', { hasText: 'Cruscotto finanze' })).toBeVisible();   // le altre tile ci sono
      await expect(tileVillaggio(page)).toHaveCount(0);
      await page.getByRole('textbox', { name: 'Cerca azione' }).fill('villaggio');
      await expect(page.locator('.ds-manage')).toHaveText('Nessuna azione trovata.');
      await page.getByRole('textbox', { name: 'Cerca azione' }).fill('');

      // Cruscotto: la sezione Villaggio non c'e'
      await page.locator('.ds-qbtn', { hasText: 'Cruscotto finanze' }).click();
      await expect(page.locator('h2', { hasText: 'Top prodotti (più venduti)' })).toBeVisible(ATTESA);
      await expect(page.locator('h2', { hasText: /^Villaggio$/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Apri il Villaggio/ })).toHaveCount(0);
      expect(r.posts).toEqual([]);
      expect(senza404(r.errori)).toEqual([]);
    });

    test('app a se\' /amimi-app/villaggio/: "Il Villaggio non è attivo" e nessun villaggio montato', async ({ page }) => {
      const dati = datiBase();
      const r = await apri(page, 'villaggio/', dati, { flag: caso.flag });
      await expect(page.getByText('Il Villaggio non è attivo')).toBeVisible(ATTESA);
      expect(r.letture.flag).toBeGreaterThan(0);
      await page.waitForTimeout(500);
      await expect(page.locator('.vil')).toHaveCount(0);
      await expect(page.locator('canvas')).toHaveCount(0);
      await expect(page.locator('.v-hud')).toHaveCount(0);
      expect(r.letture.ordini).toBe(0);
      expect(r.letture.magazzino).toBe(0);
      // "Apri l'app" porta all'app intera
      await page.getByRole('button', { name: 'Apri l\'app' }).click();
      await expect(page).toHaveURL(/\/amimi-app\/$/);
      await expect(page.locator('.hello h1')).toContainText('Ciao');
      expect(r.posts).toEqual([]);
      expect(senza404(r.errori)).toEqual([]);
    });
  });
}

test.describe('casi limite dei dati', () => {
  // riga WIP (quantita' da definire) e riga di un modello che il villaggio non sa disegnare, allo stesso laboratorio
  function datiLimite() {
    const d = datiBase();
    d.ordini.push(
      riga(ID.wip, 'G2', SARTE, 'NINA_BAG_CHECKS_BLUE', 'NINA BAG', 'CHECKS BLUE', 0, 0, traGiorni(15), { wip: true, completo: false, costo_unitario: null }),
      riga('00000000-0000-0000-0000-0000000000b3', 'G2', SARTE, 'PORTACHIAVI_ROSSO', 'PORTACHIAVI', 'ROSSO', 6, 2, traGiorni(15)),
    );
    d.magazzino.push(inv('PORTACHIAVI_ROSSO', 'PORTACHIAVI', 'ROSSO', 4));
    return d;
  }

  test('HUD con WIP e modelli sconosciuti: i pezzi fuori dal disegno contano, la WIP no', async ({ page }) => {
    const dati = datiLimite();
    const r = await apri(page, '#villaggio', dati);
    const a = attesi(dati);
    expect(a).toEqual({ stock: 14, prep: 23, open: 5 });
    await hud(page, a);
    await expect(fienile(page)).toHaveText(`Magazzino${a.stock} pezzi`);
    await etichettaLab(page, 'Sarte Milano').click();
    const sheet = page.locator('.v-sheet.open');
    await expect(sheet.locator('h2')).toHaveText('Sarte Milano sta preparando');
    await expect(sheet.locator('.v-row')).toHaveCount(2);   // Nina righe rosse e la WIP; il portachiavi va in "Altri prodotti"
    await expect(sheet.locator('.v-row', { hasText: '(WIP)' })).toContainText('quantità da definire');
    await expect(sheet.locator('.v-gh', { hasText: 'Altri prodotti' })).toHaveCount(1);
    await expect(sheet.locator('.ds-lrow', { hasText: /portachiavi/i })).toHaveCount(1);
    expect(r.errori).toEqual([]);
  });

  test('un laboratorio dice lo stesso numero di pezzi in arrivo sull\'etichetta, nell\'intestazione del pannello e nell\'HUD', async ({ page }) => {
    const dati = datiLimite();
    await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    // Sarte Milano: Nina righe rosse 8 mancano, WIP quantita' da definire, portachiavi 4 mancano
    const mancanoSarte = dati.ordini.filter((x) => x.fornitore === SARTE && !x.completo && !x.wip).reduce((s, x) => s + x.mancano, 0);
    const mancanoFrancesco = dati.ordini.filter((x) => x.fornitore === FRANCESCO && !x.completo && !x.wip).reduce((s, x) => s + x.mancano, 0);
    expect(mancanoSarte + mancanoFrancesco).toBe(attesi(dati).prep);   // l'HUD e' la somma dei laboratori
    const pzEtichetta = async (nome: string) => Number(/(\d+) pz in preparazione/.exec((await etichettaLab(page, nome).textContent()) ?? '')?.[1]);
    expect.soft(await pzEtichetta('Sarte Milano'), 'etichetta del capannone Sarte Milano').toBe(mancanoSarte);
    await etichettaLab(page, 'Sarte Milano').click();
    const head = page.locator('.v-sheet.open .v-shead p');
    await expect(head).toContainText('3 righe');
    expect.soft(Number(/(\d+) pz da arrivare/.exec((await head.textContent()) ?? '')?.[1]), 'intestazione del pannello di Sarte Milano').toBe(mancanoSarte);
  });

  test('arrivo su una riga WIP: la riga dice "(WIP)", il fumetto di Ginni no', async ({ page }) => {
    const dati = datiLimite();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    await etichettaLab(page, 'Sarte Milano').click();
    const wip = page.locator('.v-sheet.open .v-row', { hasText: '(WIP)' });
    await expect(wip.locator('.v-rt > b')).toHaveText('Quadretti blu (WIP)');
    await wip.getByRole('button', { name: 'Arrivate' }).click();
    await expect(wip.locator('.ds-recv input.num')).toHaveValue('');   // WIP: quantita' da definire, niente precompilato
    await wip.locator('.ds-recv input.num').fill('3');
    await wip.locator('.ds-segna').click();
    await expect.poll(() => r.posts.length, ATTESA).toBe(1);
    expect(r.posts[0].body).toMatchObject({ action: 'arrival_set', payload: { order_id: ID.wip, qty: 3, attesi: 0 } });
    expect(r.dialoghi).toEqual([]);   // nessun ordinato da superare: nessuna conferma
    await hud(page, attesi(dati));
    await avvisoCon(page, 'Arrivo salvato · +3 (totale 3)');
    await avvisoCon(page, 'Ginni3 Nina quadretti blu in magazzino.');
    expect((await avvisi(page)).filter((t) => /wip/i.test(t))).toEqual([]);
    await expect.poll(() => furgoni(page), ATTESA).toBe(1);
    expect(r.errori).toEqual([]);
  });
});

test.describe('robustezza: il Villaggio non porta giu\' l\'app', () => {
  test('dopo un deploy il chunk del Villaggio non c\'e\' piu\' (PWA aperta da ore): aprendolo dal Cruscotto l\'app resta in piedi', async ({ page }) => {
    const r = await apri(page, '', datiBase(), { chi: 'Ale' });
    await page.locator('.ds-qbtn', { hasText: 'Cruscotto finanze' }).click();
    const sez = page.locator('section.card', { has: page.locator('h2', { hasText: /^Villaggio$/ }) });
    await expect(sez).toBeVisible();
    // gh-pages sostituisce dist: il Villaggio-<hash>.js che questa scheda conosce non esiste piu'
    await page.route(/\/amimi-app\/assets\/Villaggio-[^/]+\.js$/, (route) => route.fulfill({ status: 404, contentType: 'text/html', body: 'Not Found' }));
    await sez.getByRole('button', { name: 'Apri il Villaggio →' }).click();
    await page.waitForTimeout(1500);
    // atteso: un messaggio e la barra per tornare indietro; non una pagina bianca da ricaricare a mano
    await expect(page.locator('.bottomnav'), `errori: ${r.errori.join(' | ')}`).toBeVisible();
  });

  test('telefono senza WebGL: il Villaggio a se\' mostra un messaggio e la Home invece di una pagina bianca', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null;
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof orig;
    });
    const r = await apri(page, 'villaggio/', datiBase(), { chi: 'Ginevra' });
    await page.waitForTimeout(1500);
    await expect(page.locator('.v-hud .v-home'), `errori: ${r.errori.join(' | ')}`).toBeVisible();
    await expect(page.locator('.v-err')).toContainText('manca il WebGL');
    await expect(page.locator('.v-err').getByRole('button', { name: 'Torna alla Home' })).toBeVisible();
    // senza mondo niente numeri a zero, menu "scrive", legenda ne' barra in basso: solo la Home e il messaggio
    await expect(page.locator('.v-hud .v-pill:not(.v-home)')).toHaveCount(0);
    await expect(page.locator('.v-hud .v-chi, .v-hud .v-qb')).toHaveCount(0);
    await expect(page.locator('.v-bar')).toHaveCount(0);
    await expect(page.locator('.v-loading')).toHaveCount(0);
    expect(r.posts).toEqual([]);
  });
});

// ---------- Fase 3 (18-10): scheda della pila, consegna nell'ordine, Modifica della riga, fumetti, meteo, telefono ----------

/** Il giorno `giorno` del mese di `k` mesi fa (calendario di Roma, come oggi() della pagina). */
const mesiFa = (k: number, giorno: number) => {
  const n = Number(OGGI.slice(0, 4)) * 12 + Number(OGGI.slice(5, 7)) - 1 - k;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`;
};
/** "ott": il mese breve come lo scrive la barra delle vendite. */
const meseBreve = (iso: string) => new Date(iso.slice(0, 7) + '-15T12:00:00').toLocaleDateString('it-IT', { month: 'short' });
/** "7 ottobre": la data delle voci della scheda e della verifica. */
const dataLunga = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
/** L'elemento `n` dopo il titolo di sezione della scheda (h3.v-sec): le barre, l'elenco o il messaggio di quella sezione. */
const dopoSezione = (page: Page, titolo: RegExp, n = 1) => page.locator('.v-sheet.open h3.v-sec', { hasText: titolo }).locator(`xpath=following-sibling::*[${n}]`);
const tessera = (page: Page, nome: string) => page.locator('.v-sheet.open .v-vgrid .v-vt', { has: page.locator('small', { hasText: new RegExp(`^${nome}$`) }) });
/** Le etichette delle pile nel mondo (nascoste finche' non si tocca la pila, ma col testo sempre aggiornato). */
const etichettaPila = (page: Page, nome: string) => page.locator('.v-labels > .v-lbl.v-mini:not(.v-yard)', { hasText: nome });
const FOTO = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** Gli errori di console tranne le risorse che il test fa fallire apposta (il meteo, una lettura dello storico). */
const senzaVoluti = (errori: string[], re: RegExp) => errori.filter((e) => !(/^Failed to load resource/.test(e) && re.test(e)));

test.describe('fase 3: la scheda della pila', () => {
  // Lea cocco nero: 6 vendite (l'ultima fuori dai 6 mesi), 2 arrivi, 2 conte; la riga di Francesco ancora in arrivo
  const VENDITE: Vendita[] = [
    { canale: 'negozio', data: OGGI, qty: 2 }, { canale: 'online', data: mesiFa(1, 20), qty: 3 }, { canale: 'negozio', data: mesiFa(1, 8), qty: 1 },
    { canale: 'online', data: mesiFa(2, 15), qty: 1 }, { canale: 'online', data: mesiFa(3, 3), qty: 4 }, { canale: 'negozio', data: mesiFa(8, 10), qty: 5 },
  ];
  const ACQUISTI: Acquisto[] = [   // dal piu' recente, come la lettura ordinata per data
    { id: 'p2', data: traGiorni(-12), quantita: 4, costo_unitario: 40, fornitore: FRANCESCO },
    { id: 'p1', data: mesiFa(5, 3), quantita: 6, costo_unitario: 38.5, fornitore: null },
  ];
  const RETTIFICHE: Rettifica[] = [{ id: 'r2', data: traGiorni(-5), qty_delta: 1, motivo: 'conta' }, { id: 'r1', data: traGiorni(-60), qty_delta: -2, motivo: null }];

  test('dal Magazzino: foto vera, codice e giacenza, barre dei 6 mesi, ultime 5 vendite, in arrivo, arrivi, conte; "Ordina ancora" apre il passo 4 col codice', async ({ page }) => {
    const dati = datiBase();
    Object.assign(dati.magazzino.find((g) => g.codice === 'LEA_BAG_COCCO_BLACK')!, { image_url: FOTO });
    const r = await apri(page, '#villaggio', dati, {
      vendite: { LEA_BAG_COCCO_BLACK: VENDITE }, acquisti: { LEA_BAG_COCCO_BLACK: ACQUISTI }, rettifiche: { LEA_BAG_COCCO_BLACK: RETTIFICHE },
      reorder: [rio('LEA_BAG_COCCO_BLACK', 6, 10)],   // vende e ha pochi giorni di magazzino, ma la riga di Francesco e' viva
    });
    await hud(page, attesi(dati));
    await barra(page, 'Magazzino').click();
    await expect(tessera(page, 'Cocco nero').locator('.fin')).toHaveCount(0, ATTESA);
    await tessera(page, 'Cocco nero').click();
    const s = page.locator('.v-sheet.open');
    await expect(s.locator('h2')).toHaveText('Lea · Cocco nero');
    await expect(s.locator('.v-shead p')).toHaveText('7 pezzi in magazzino · 6 in arrivo');
    await expect(s.locator('img.v-foto')).toHaveAttribute('src', FOTO);
    await expect(s.locator('img.v-foto')).toHaveAttribute('alt', 'Foto di Lea cocco nero');
    await expect(s.locator('.v-pcod > div')).toHaveCount(1);
    await expect(s.locator('.v-pcod small')).toHaveText('LEA_BAG_COCCO_BLACK');
    await expect(s.locator('.v-pcod .v-chip.stock')).toHaveText('in magazzino 7');
    await expect(s.locator('.v-chip.fin')).toHaveCount(0);
    await expect(s.locator('.v-note', { hasText: 'Sta finendo' })).toHaveCount(0);
    // vendite: una barra per mese, dal piu' vecchio a questo; i mesi a zero ci sono (vuoti), la vendita di 8 mesi fa no
    const mesi = [5, 4, 3, 2, 1, 0].map((k) => meseBreve(mesiFa(k, 15)));
    const pezzi = [0, 0, 4, 1, 4, 2];
    const barre = dopoSezione(page, /^Vendite/, 1);
    await expect(barre).toHaveClass(/(^|\s)v-bars(\s|$)/, ATTESA);
    await expect(barre.locator('small')).toHaveText(mesi);
    await expect(barre.locator('b')).toHaveText(pezzi.map((n) => (n ? String(n) : '')));
    await expect(barre).toHaveAttribute('aria-label', 'Pezzi venduti: ' + mesi.map((m, i) => `${m} ${pezzi[i]}`).join(', '));
    // le ultime 5, la piu' recente prima, negozio (Qromo) e online (Shopify) insieme
    const ultime = dopoSezione(page, /^Vendite/, 2).locator('.v-voce');
    await expect(ultime.locator('.pt')).toHaveText(['2 pz', '3 pz', '1 pz', '1 pz', '4 pz']);
    await expect(ultime.locator('b')).toHaveText(['In negozio', 'Online', 'In negozio', 'Online', 'Online']);
    await expect(ultime.locator('small')).toHaveText(VENDITE.slice(0, 5).map((v) => dataLunga(v.data)));
    // la riga ancora in arrivo, dal modello del Villaggio
    const inArrivo = dopoSezione(page, /^In arrivo/).locator('.v-voce');
    await expect(inArrivo).toHaveCount(1);
    await expect(inArrivo.locator('.pt')).toHaveText('6 pz');
    await expect(inArrivo.locator('b')).toHaveText('Francesco');
    await expect(inArrivo.locator('small')).toHaveText('4 di 10 arrivate · 10 giorni di ritardo');
    // arrivi dai laboratori (purchases) e conte e rettifiche (stock_adjustments)
    const arrivi = dopoSezione(page, /^Arrivi/).locator('.v-voce');
    await expect(arrivi.locator('.pt')).toHaveText(['4 pz', '6 pz']);
    await expect(arrivi.locator('b')).toHaveText(['Francesco', 'Laboratorio non indicato']);
    await expect(arrivi.locator('small')).toHaveText([`${dataLunga(traGiorni(-12))} · 40,00 € al pezzo`, `${dataLunga(mesiFa(5, 3))} · 38,50 € al pezzo`]);
    const conte = dopoSezione(page, /^Conte e rettifiche/).locator('.v-voce');
    await expect(conte.locator('.pt')).toHaveText(['+1', '-2']);
    await expect(conte.locator('b')).toHaveText(['Conta', 'Rettifica']);
    // una lettura per tabella e per codice
    for (const t of ['qromo_sales', 'shopify_line_items', 'purchases', 'stock_adjustments']) expect(r.letture.storico, t).toContain(t + ':LEA_BAG_COCCO_BLACK');
    expect(r.posts).toEqual([]);

    // "Ordina ancora": il passo 4 dell'ordine con quel codice, dal laboratorio dell'ultimo arrivo
    await s.getByRole('button', { name: '+ Ordina ancora' }).click();
    await expect(s.locator('h2')).toHaveText('Ordina borse');
    await expect(passo(page)).toHaveText('Quantità e prezzo');
    await expect(s.locator('.v-qty small')).toHaveText('LEA_BAG_COCCO_BLACK · da Francesco · in magazzino 7');
    await expect(s.locator('.v-form .ordtop .chip.on')).toHaveText(`${FRANCESCO} ✕`, ATTESA);
    await expect(s.locator('.v-form .cartrow[data-cart-codice="LEA_BAG_COCCO_BLACK"]')).toBeVisible(ATTESA);
    // non toccato: la X chiude senza chiedere e non scrive niente
    await page.locator('.v-sheet .v-x').click();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    expect(r.dialoghi).toEqual([]);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('"sta finendo": bandierina nel mondo, chip e nota nella scheda solo sulle pile che vendono senza un ordine vivo; la pila finita che sta finendo si vede; "Conta" fa il giro sui codici della pila', async ({ page }) => {
    const dati = datiBase();
    // Cocco verde: finita e senza niente in arrivo (il villaggio non la disegnerebbe); Verde militare: una pila, due codici
    dati.magazzino.push(inv('LEA_BAG_COCCO_GREEN', 'LEA BAG', 'COCCO GREEN', 0), inv('LEA_BAG_MILITARY_GREEN', 'LEA BAG', 'MILITARY GREEN', 2), inv('LEA_BAG_GREEN_MILITARY', 'LEA BAG', 'GREEN MILITARY', 1));
    const r = await apri(page, '#villaggio', dati, {
      reorder: [
        rio('LEA_BAG_PONY_ZEBRA', 5, 12),                                    // vende, 12 giorni, nessuna riga aperta: sta finendo
        rio('LEA_BAG_COCCO_GREEN', 4, 0),                                    // finita: sta finendo
        rio('LEA_BAG_COCCO_BLACK', 6, 10),                                   // la riga di Francesco e' viva (ordinata 30 giorni fa)
        rio('SOPHIE_BAG_SUEDE_BROWN', 2, 1),                                 // 2 pezzi in 60 giorni: non vende abbastanza
        rio('LEA_BAG_MILITARY_GREEN', 3, 20, { riordino_archiviato: true }), // archiviato nel Riordino: scelta gia' fatta
      ],
    });
    await hud(page, attesi(dati));
    // nel mondo: "sta finendo" nell'etichetta della pila (con la bandierina), e la pila finita c'e'
    await expect(etichettaPila(page, 'Pony zebrato')).toContainText('sta finendo', ATTESA);
    await expect(etichettaPila(page, 'Cocco verde')).toHaveCount(1);
    await expect(etichettaPila(page, 'Cocco verde')).toContainText('0 pz · sta finendo');
    await expect(etichettaPila(page, 'Cocco nero')).not.toContainText('sta finendo');
    await expect(etichettaPila(page, 'Verde militare')).not.toContainText('sta finendo');
    await expect(etichettaPila(page, 'Camoscio marrone')).not.toContainText('sta finendo');
    // nel pannello Magazzino: la tessera dice "sta finendo", anche quella della pila finita
    await barra(page, 'Magazzino').click();
    await expect(tessera(page, 'Pony zebrato').locator('small.fin')).toHaveText('sta finendo', ATTESA);
    await expect(tessera(page, 'Cocco verde').locator('small.fin')).toHaveText('sta finendo');
    await expect(tessera(page, 'Cocco verde').locator('b')).toHaveText('0');
    for (const n of ['Cocco nero', 'Verde militare', 'Camoscio marrone']) await expect(tessera(page, n).locator('.fin'), n).toHaveCount(0);

    await tessera(page, 'Pony zebrato').click();
    const s = page.locator('.v-sheet.open');
    await expect(s.locator('h2')).toHaveText('Lea · Pony zebrato');
    await expect(s.locator('.v-shead p')).toHaveText('3 pezzi in magazzino');
    await expect(s.locator('.v-pcod .v-chip.fin')).toHaveText('sta finendo');
    await expect(s.locator('.v-note', { hasText: 'Sta finendo' })).toHaveText('Sta finendo: vende (3 pezzi o più in 60 giorni), ha meno di 30 giorni di magazzino e nessun ordine in corso.');
    // niente storico: lo dice, sezione per sezione (letture riuscite e vuote)
    await expect(dopoSezione(page, /^Vendite/)).toHaveText('Nessuna vendita registrata.', ATTESA);
    await expect(dopoSezione(page, /^In arrivo/)).toHaveText('Nessuna riga d\'ordine aperta.');
    await expect(dopoSezione(page, /^Arrivi/)).toHaveText('Nessun arrivo registrato.');
    await expect(dopoSezione(page, /^Conte e rettifiche/)).toHaveText('Nessuna conta né rettifica.');
    // "Conta": il giro di conta su quel codice, col CountForm di Magazzino gia' sul prodotto; Salta non scrive niente
    await s.getByRole('button', { name: 'Conta', exact: true }).click();
    await expect(s.locator('h2')).toHaveText('Giro di conta');
    await expect(s.locator('.v-giro b')).toHaveText('1 / 1');
    await expect(s.locator('.v-qty small')).toHaveText('LEA_BAG_PONY_ZEBRA · in magazzino 3');
    await expect(s.locator('.v-conta .sysrow b')).toHaveText('3 pz', ATTESA);
    await s.getByRole('button', { name: 'Salta ›' }).click();
    await expect(s.locator('.v-fine')).toHaveText('Giro finito: 0 codici contati su 1.');
    await s.getByRole('button', { name: 'Chiudi il giro' }).click();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);

    // la pila con due codici: ogni codice col suo numero, lo storico letto codice per codice, il giro su tutti e due
    await barra(page, 'Magazzino').click();
    await tessera(page, 'Verde militare').click();
    await expect(s.locator('h2')).toHaveText('Lea · Verde militare');
    await expect(s.locator('.v-shead p')).toHaveText('3 pezzi in magazzino');
    await expect(s.locator('.v-pcod > div')).toHaveCount(2);
    expect((await s.locator('.v-pcod small').allTextContents()).sort()).toEqual(['LEA_BAG_GREEN_MILITARY', 'LEA_BAG_MILITARY_GREEN']);
    await expect(s.locator('.v-pcod .v-chip.stock')).toHaveText(['in magazzino 2', 'in magazzino 1']);
    await expect(s.locator('.v-chip.fin')).toHaveCount(0);
    await expect(dopoSezione(page, /^Vendite/)).toHaveText('Nessuna vendita registrata.', ATTESA);
    for (const c of ['LEA_BAG_MILITARY_GREEN', 'LEA_BAG_GREEN_MILITARY']) for (const t of ['qromo_sales', 'shopify_line_items', 'purchases', 'stock_adjustments']) expect(r.letture.storico).toContain(t + ':' + c);
    await s.getByRole('button', { name: 'Conta', exact: true }).click();
    await expect(s.locator('.v-giro b')).toHaveText('1 / 2');
    await page.locator('.v-sheet .v-x').click();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    expect(r.dialoghi).toEqual([]);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  test('il tocco su una pila nel mondo, col Magazzino aperto, apre la scheda di quella pila', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    await barra(page, 'Magazzino').click();
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Magazzino');
    // la scheda di Sophie dalla tessera: la camera va vicino alla sua pila, dove si vedono le etichette delle zone. Nina
    // ha una pila sola, e l'etichetta della sua zona sta proprio sopra di lei: si aspetta che la camera si fermi (due
    // letture uguali) e si tocca il corpo della borsa, 55 px sotto la punta (piu' su si passa nel manico e si prende il muro)
    await tessera(page, 'Camoscio marrone').click();
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Sophie · Camoscio marrone');
    const zona = page.locator('.v-labels .v-zone', { hasText: /^Nina/ });
    await expect(zona).toBeVisible(ATTESA);
    await page.waitForTimeout(1000);   // il tween della camera dura 560 ms
    let prima = '', punto: { x: number; y: number } | null = null;
    for (let k = 0; k < 30 && !punto; k++) {
      const b = await zona.boundingBox();
      const ora = b ? `${Math.round(b.x)},${Math.round(b.y)}` : '';
      if (b && ora === prima) punto = { x: b.x + b.width / 2, y: b.y + b.height + 55 };
      prima = ora;
      await page.waitForTimeout(400);
    }
    expect(punto, 'posizione della pila di Nina sullo schermo').not.toBeNull();
    await page.mouse.click(punto!.x, punto!.y);
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Nina · Righe rosso', ATTESA);
    await expect(page.locator('.v-sheet.open .v-pcod small')).toHaveText('NINA_BAG_STRIPES_RED');
    await expect(page.locator('.v-sheet.open .v-shead p')).toHaveText('0 pezzi in magazzino · 8 in arrivo');
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });

  // staFinendo() guarda anche l'ultimo arrivo della riga (data_ultimo_arrivo di v_ordini_arrivo): una consegna promessa
  // passata con un arrivo di pochi giorni fa e' una riga viva. Fino al 18-10 fetchOrdiniGruppi non chiedeva la colonna e
  // la pila "stava finendo" anche col laboratorio che consegnava (CREDIT_CARD_CASE_COCCO_GREEN sui dati veri).
  test('una riga con la consegna promessa passata ma un arrivo di pochi giorni fa e\' viva: la sua pila non "sta finendo"', async ({ page }) => {
    const dati = datiBase();
    // la zebrata: ordinata 90 giorni fa, promessa 70 giorni fa, 3 di 10 arrivati 5 giorni fa
    Object.assign(dati.ordini.find((x) => x.id === ID.zebra)!, { qty_ordered: 10, qty_arrived: 3, mancano: 7, completo: false, data_ordine: traGiorni(-90),
      data_consegna: traGiorni(-70), data_consegna_display: traGiorni(-70), data_ultimo_arrivo: traGiorni(-5) });
    const r = await apri(page, '#villaggio', dati, { reorder: [rio('LEA_BAG_PONY_ZEBRA', 5, 12)] });
    await hud(page, attesi(dati));
    await barra(page, 'Magazzino').click();
    await expect(tessera(page, 'Pony zebrato')).toBeVisible(ATTESA);
    await page.waitForTimeout(1000);
    await expect(tessera(page, 'Pony zebrato').locator('.fin')).toHaveCount(0, { timeout: 3000 });
    await expect(etichettaPila(page, 'Pony zebrato')).not.toContainText('sta finendo', { timeout: 3000 });
    expect(r.errori).toEqual([]);
  });

  // il contratto: una lettura fallita si dice, mai come zero. Fino al 18-10 le tre letture di lib/api.ts restituivano
  // data ?? [] senza guardare error, e la scheda diceva "Nessuna vendita registrata."
  test('una lettura dello storico che fallisce si dice ("Non riesco a leggere ..."), non diventa "nessuna vendita"', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati, { storicoKo: ['qromo_sales', 'shopify_line_items', 'purchases', 'stock_adjustments'] });
    await hud(page, attesi(dati));
    await barra(page, 'Magazzino').click();
    await tessera(page, 'Cocco nero').click();
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Lea · Cocco nero');
    await expect.poll(() => r.letture.storico.length, ATTESA).toBeGreaterThanOrEqual(4);
    await expect(dopoSezione(page, /^Vendite/)).toContainText('Non riesco a leggere le vendite.', { timeout: 10000 });
    await expect(dopoSezione(page, /^Arrivi/)).toContainText('Non riesco a leggere gli arrivi.', { timeout: 5000 });
    await expect(dopoSezione(page, /^Conte e rettifiche/)).toContainText('Non riesco a leggere le conte.', { timeout: 5000 });
    // la riga in arrivo viene dal modello del Villaggio, non da queste letture: c'e' comunque
    await expect(dopoSezione(page, /^In arrivo/).locator('.v-voce')).toHaveCount(1);
    expect(senzaVoluti(r.errori, /status of 500/)).toEqual([]);
  });

  test('v_reorder che non si legge si dice nel Magazzino e nella scheda della pila, e il villaggio va avanti', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati, { reorder: 'errore' });
    await hud(page, attesi(dati));
    await barra(page, 'Magazzino').click();
    const s = page.locator('.v-sheet.open');
    await expect(s.locator('.v-errl')).toContainText('Non riesco a leggere i riordini', ATTESA);
    await tessera(page, 'Cocco nero').click();
    await expect(s.locator('h2')).toHaveText('Lea · Cocco nero');
    await expect(s.locator('.v-errl', { hasText: 'Non riesco a leggere i riordini' })).toHaveCount(1);
    await expect(s.locator('.v-chip.fin')).toHaveCount(0);
    expect(r.posts).toEqual([]);
    expect(senzaVoluti(r.errori, /status of 500/)).toEqual([]);
  });
});

test.describe('fase 3: consegna prevista nell\'ordine e tempo abituale del laboratorio', () => {
  test('passo 4: la consegna e\' facoltativa e mai precompilata, il tempo di Francesco e\' un suggerimento, una data prima dell\'ordine non parte; con due righe ognuna ha la sua', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati, { chi: 'Ginevra', tempi: [{ fornitore: FRANCESCO, giorni_mediani: 30, righe: 24 }, { fornitore: SARTE, giorni_mediani: 24, righe: 11 }] });
    await hud(page, attesi(dati));
    const qty = await alPasso4(page);
    const form = page.locator('.v-sheet.open .v-form');
    const consegna = form.locator('#sof-consegna');
    await expect(consegna).toHaveValue('');
    await expect(form).toContainText('Di solito Francesco consegna in circa 30 giorni. Metti comunque la data che ti dice il laboratorio.', ATTESA);
    expect(r.letture.tempi).toBeGreaterThan(0);
    // con una riga sola la data per riga non c'e': vale quella dell'ordine
    await expect(form.locator('.cartrow input[type="date"]')).toHaveCount(0);
    await qty.fill('5');
    // una data prima del giorno dell'ordine si ferma qui, senza scrivere
    await consegna.fill(traGiorni(-1));
    await form.getByRole('button', { name: 'Salva ordine (1)' }).click();
    await avvisoCon(page, 'Consegna prevista di LEA BAG: dev\'essere una data dal giorno dell\'ordine in poi');
    await page.waitForTimeout(500);
    expect(r.posts).toEqual([]);
    await consegna.fill(traGiorni(30));
    // seconda riga dalla ricerca: compaiono le date per riga, tutte e due su quella dell'ordine; la zebrata si sposta
    await form.locator('.ds-search input').fill('zebra');
    await form.locator('.ds-prow', { hasText: 'PONY ZEBRA' }).click();
    const zebra = form.locator('.cartrow[data-cart-codice="LEA_BAG_PONY_ZEBRA"]');
    await expect(zebra).toBeVisible(ATTESA);
    const dataCocco = form.locator('.cartrow[data-cart-codice="LEA_BAG_COCCO_BLACK"] input[type="date"]'), dataZebra = zebra.locator('input[type="date"]');
    await expect(dataCocco).toHaveValue(traGiorni(30));
    await expect(dataZebra).toHaveValue(traGiorni(30));
    await expect(form).toContainText('Vale per tutte le righe; ognuna si può cambiare nel carrello.');
    await dataZebra.fill(traGiorni(45));
    await zebra.locator('input.qbox').fill('2');
    await form.getByRole('button', { name: 'Salva ordine (2)' }).click();
    await expect.poll(() => r.posts.length, ATTESA).toBe(1);
    const p = r.posts[0];
    expect(p.body.action).toBe('order_multi');
    expect(p.body.chi).toBe('Ginevra');
    expect(p.body.payload).toMatchObject({ fornitore: FRANCESCO, data_ordine: OGGI, righe: [
      { codice: 'LEA_BAG_COCCO_BLACK', qty_ordered: 5, wip: false, data_consegna: traGiorni(30) },
      { codice: 'LEA_BAG_PONY_ZEBRA', qty_ordered: 2, wip: false, data_consegna: traGiorni(45) },
    ] });
    // la riga nuova arriva con la data: niente "senza data" nel pannello del laboratorio
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Laboratori', ATTESA);
    await page.locator('.v-sheet.open .v-lrow', { hasText: 'Francesco' }).click();
    await expect(page.locator('.v-sheet.open .v-row', { hasText: 'Pony zebrato' }).filter({ hasText: '0 di 2 arrivate' })).toContainText(`consegna ${dataLunga(traGiorni(45))}`, ATTESA);
    expect(r.errori).toEqual([]);
  });

  test('senza v_tempi_laboratori (0167 non ancora applicata) il suggerimento non c\'e\' e l\'ordine senza consegna parte come sempre', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '#villaggio', dati, { tempi: '404' });
    await hud(page, attesi(dati));
    const qty = await alPasso4(page);
    const form = page.locator('.v-sheet.open .v-form');
    await expect.poll(() => r.letture.tempi, ATTESA).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    await expect(form).not.toContainText('Di solito');
    await qty.fill('3');
    await form.getByRole('button', { name: 'Salva ordine (1)' }).click();
    await expect.poll(() => r.posts.length, ATTESA).toBe(1);
    // senza consegna la riga non porta data_consegna (order_multi non riceve mai '')
    expect(r.posts[0].body.payload).toEqual({
      fornitore: FRANCESCO, data_ordine: OGGI,
      righe: [{ codice: 'LEA_BAG_COCCO_BLACK', item: 'LEA BAG', variant: 'COCCO BLACK', qty_ordered: 3, wip: false, nuovo_riordino: 'Riordino', costo_unitario: null }],
    });
    expect(senza404(r.errori)).toEqual([]);
  });
});

test.describe('fase 3: Modifica di una riga d\'ordine (order_update)', () => {
  test('solo righe senza arrivi e non WIP; vanno al server solo i campi cambiati; toccata chiede prima di chiudere; salvata la riga si richiude', async ({ page }) => {
    const dati = datiBase();
    dati.ordini.push(riga(ID.wip, 'G2', SARTE, 'NINA_BAG_CHECKS_BLUE', 'NINA BAG', 'CHECKS BLUE', 0, 0, traGiorni(15), { wip: true, completo: false, costo_unitario: null }));
    const prima = attesi(dati);
    const r = await apri(page, '#villaggio', dati);
    await hud(page, prima);
    await etichettaLab(page, 'Francesco').click();
    const sheet = page.locator('.v-sheet.open');
    // Lea cocco nero ha gia' 4 arrivi: niente Modifica, resta "Elimina riga"
    const lea = sheet.locator('.v-row', { hasText: 'Cocco nero' });
    await lea.getByRole('button', { name: 'Arrivate' }).click();
    await expect(lea.locator('.v-arrivo .ds-del', { hasText: 'Elimina riga' })).toBeVisible();
    await expect(lea.getByRole('button', { name: 'Modifica', exact: true })).toHaveCount(0);
    // Sophie camoscio 0/5: Modifica, col modulo gia' compilato con i valori della riga
    const sophie = sheet.locator('.v-row', { hasText: 'Camoscio marrone' });
    await sophie.getByRole('button', { name: 'Arrivate' }).click();
    await expect(lea.locator('.v-arrivo')).toHaveCount(0);
    await sophie.getByRole('button', { name: 'Modifica', exact: true }).click();
    await expect(sophie.locator('.ds-recv .rl')).toHaveText('Modifica la riga (non è arrivato ancora niente)');
    await expect(sophie.getByLabel('Pezzi ordinati')).toHaveValue('5');
    await expect(sophie.getByLabel('€ al pezzo')).toHaveValue('40');
    await expect(sophie.getByLabel('Consegna prevista')).toHaveValue(traGiorni(20));
    await expect(sophie.getByLabel('Nota')).toHaveValue('');
    await sophie.getByLabel('Pezzi ordinati').fill('6');
    // toccata, la X chiede (lascia() della pagina); Annulla tiene il modulo
    r.conferme.accetta = false;
    await page.locator('.v-sheet .v-x').click();
    await expect.poll(() => r.dialoghi.length, ATTESA).toBe(1);
    expect(r.dialoghi[0]).toBe('Lasci la riga a metà? Quello che hai scritto si perde.');
    await expect(sheet.locator('h2')).toHaveText('Francesco sta preparando');
    await expect(sophie.getByLabel('Pezzi ordinati')).toHaveValue('6');
    r.conferme.accetta = true;
    await sophie.getByLabel('Consegna prevista').fill(traGiorni(25));
    await sophie.getByLabel('Nota').fill('  colore da confermare ');
    expect(r.posts).toEqual([]);
    await sophie.getByRole('button', { name: 'Salva modifiche' }).click();
    await expect.poll(() => r.posts.length, ATTESA).toBe(1);
    const p = r.posts[0];
    expect(p.body.action).toBe('order_update');
    expect(p.body.chi).toBe('Ale');
    // il costo non e' cambiato: non va; la nota va senza spazi intorno
    expect(p.body.payload).toEqual({ id: ID.sophie, qty_ordered: 6, data_consegna: traGiorni(25), note: 'colore da confermare' });
    await avvisoCon(page, 'Riga ordine aggiornata');
    // la rilettura: 6 + 6 da arrivare, la riga del Villaggio richiusa e il modulo non piu' "toccato"
    await expect(sheet.locator('.v-shead p')).toHaveText('Laboratorio pelle · 2 righe, 12 pz da arrivare', ATTESA);
    await expect(sophie).toContainText('0 di 6 arrivate');
    await expect(sophie.locator('.v-chip.ok')).toHaveText(`consegna ${dataLunga(traGiorni(25))}`);
    await expect(sophie.locator('.v-arrivo')).toHaveCount(0);
    await expect(sophie.getByRole('button', { name: 'Arrivate' })).toBeVisible();
    await hud(page, { ...prima, prep: prima.prep + 1 });
    await page.locator('.v-sheet .v-x').click();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    expect(r.dialoghi).toHaveLength(1);

    // Sarte Milano: la WIP non ha Modifica (quantita' e costo si decidono all'arrivo); Nina si', e senza cambiamenti non scrive
    await etichettaLab(page, 'Sarte Milano').click();
    const wip = sheet.locator('.v-row', { hasText: '(WIP)' });
    await wip.getByRole('button', { name: 'Arrivate' }).click();
    await expect(wip.locator('.v-arrivo .ds-del', { hasText: 'Elimina riga' })).toBeVisible();
    await expect(wip.getByRole('button', { name: 'Modifica', exact: true })).toHaveCount(0);
    const nina = sheet.locator('.v-row', { hasText: 'Righe rosso' });
    await nina.getByRole('button', { name: 'Arrivate' }).click();
    await nina.getByRole('button', { name: 'Modifica', exact: true }).click();
    await expect(nina.getByLabel('Consegna prevista')).toHaveValue('');
    await nina.getByRole('button', { name: 'Salva modifiche' }).click();
    await avvisoCon(page, 'Nessuna modifica da salvare');
    await page.waitForTimeout(500);
    expect(r.posts).toHaveLength(1);
    expect(r.errori).toEqual([]);
  });
});

test.describe('fase 3: i fumetti sui capannoni', () => {
  test('orologio = righe oltre la data, punto di domanda = righe senza data, niente se tutto a posto; il fumetto (44 px) col tocco o Invio apre il laboratorio a Paillettes spente', async ({ page }) => {
    const dati = datiBase();
    // Vincenzo: una sola riga, con la data fra due settimane: niente da dire. Senza fornitore: righe senza data, ma non
    // c'e' una persona con cui verificare, quindi niente fumetto
    dati.ordini.push(riga('00000000-0000-0000-0000-0000000000f1', 'G3', 'Vincenzo (pelle)', 'LEA_BAG_PONY_ZEBRA', 'LEA BAG', 'PONY ZEBRA', 2, 0, traGiorni(14)),
      riga(ID.anonimo, 'G4', null, 'SOPHIE_BAG_SUEDE_BROWN', 'SOPHIE BAG', 'SUEDE BROWN', 1, 0, null));
    const r = await apri(page, '#villaggio', dati);
    await hud(page, attesi(dati));
    const fFr = etichettaLab(page, 'Francesco').locator('.v-fum'), fSa = etichettaLab(page, 'Sarte Milano').locator('.v-fum');
    await expect(fFr).toHaveClass(/(^|\s)orologio(\s|$)/, ATTESA);
    await expect(fFr).toHaveAttribute('aria-label', 'Francesco: ci sono righe oltre la data di consegna. Tocca per la verifica');
    await expect(fSa).toHaveClass(/(^|\s)domanda(\s|$)/);
    await expect(fSa).toHaveAttribute('aria-label', 'Sarte Milano: ci sono righe senza data di consegna. Tocca per la verifica');
    await expect(etichettaLab(page, 'Vincenzo')).toBeVisible();
    await expect(etichettaLab(page, 'Vincenzo').locator('.v-fum')).toHaveCount(0);
    await expect(etichettaLab(page, 'Vincenzo')).not.toHaveClass(/con-fum/);
    await expect(etichettaLab(page, 'Senza fornitore')).toBeVisible();
    await expect(etichettaLab(page, 'Senza fornitore').locator('.v-fum')).toHaveCount(0);
    // il fumetto e' solo un'icona: il testo dell'etichetta resta nome, pezzi e "!"
    await expect(etichettaLab(page, 'Francesco')).toHaveText(/^Francesco11 pz in preparazione!$/);
    for (const f of [fFr, fSa]) {
      const b = await f.boundingBox();
      expect(b && Math.min(b.width, b.height), 'bersaglio del fumetto').toBeGreaterThanOrEqual(44);
    }
    // a Paillettes spente la verifica non c'e': il fumetto apre il laboratorio (non l'etichetta di sotto due volte)
    await fFr.click();
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Francesco sta preparando');
    await page.keyboard.press('Escape');
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    await expect(fSa).toBeVisible(ATTESA);
    await fSa.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Sarte Milano sta preparando');
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });
});

test.describe('fase 3: stagioni, luce e meteo di Milano', () => {
  for (const caso of [
    { meteo: 'sole' as const, salvato: 'sereno' },
    { meteo: 'pioggia' as const, salvato: 'pioggia' },
    { meteo: 'errore' as const, salvato: null },
  ]) {
    test(`Open-Meteo ${caso.meteo}: una sola lettura all'indirizzo del contratto, in cache 30 minuti${caso.salvato ? '' : ' (l\'errore no: sereno in silenzio e si riprova)'}; il villaggio funziona come sempre`, async ({ page }) => {
      const dati = datiBase();
      const r = await apri(page, '#villaggio', dati, { meteo: caso.meteo });
      await hud(page, attesi(dati));
      await canvasVivo(page);
      await expect.poll(() => r.letture.meteo.length, ATTESA).toBe(1);
      expect(r.letture.meteo[0]).toBe(URL_METEO);
      const cache = async () => { const v = await page.evaluate(() => localStorage.getItem('amimi_villaggio_meteo')); return v ? (JSON.parse(v) as { meteo: string }).meteo : null; };
      await expect.poll(cache, ATTESA).toBe(caso.salvato);
      // nessun avviso e nessun errore a video: il meteo e' decorazione
      await expect(page.locator('.v-err')).toHaveCount(0);
      expect(await avvisi(page)).toEqual([]);
      await etichettaLab(page, 'Francesco').click();
      await expect(page.locator('.v-sheet.open h2')).toHaveText('Francesco sta preparando');
      await page.keyboard.press('Escape');
      await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
      // riaperto: dalla cache non si richiede; dopo un errore si riprova
      await page.reload();
      await hud(page, attesi(dati));
      await page.waitForTimeout(1500);
      expect(r.letture.meteo).toHaveLength(caso.salvato ? 1 : 2);
      // il ritorno in primo piano non richiede il meteo in cache
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForTimeout(1000);
      expect(r.letture.meteo).toHaveLength(caso.salvato ? 1 : 3);
      expect(r.posts).toEqual([]);
      expect(senzaVoluti(r.errori, /api\.open-meteo\.com/)).toEqual([]);
    });
  }

  // l'orologio del browser e' finto (page.clock, poi scorre): stagione e momento del giorno vengono da li'
  for (const caso of [
    { nome: 'inverno, sera, neve', ora: '2027-01-14T18:30:00Z', meteo: 'neve' as const, salvato: 'neve' },
    { nome: 'primavera, mattina, nebbia', ora: '2026-04-15T06:30:00Z', meteo: 'nebbia' as const, salvato: 'nebbia' },
    { nome: 'estate, tramonto, nuvole', ora: '2026-07-10T18:30:00Z', meteo: 'nuvole' as const, salvato: 'nuvole' },
  ]) {
    test(`stagione e luce (${caso.nome}): l'isola si disegna, i pannelli si aprono, nessun errore`, async ({ page }) => {
      const dati = datiBase();
      const r = await apri(page, '#villaggio', dati, { ora: caso.ora, meteo: caso.meteo });
      await hud(page, attesi(dati));
      await canvasVivo(page);
      await expect.poll(async () => { const v = await page.evaluate(() => localStorage.getItem('amimi_villaggio_meteo')); return v ? (JSON.parse(v) as { meteo: string }).meteo : null; }, ATTESA).toBe(caso.salvato);
      await expect(fienile(page)).toHaveText(`Magazzino${attesi(dati).stock} pezzi`);
      await barra(page, 'Magazzino').click();
      await expect(page.locator('.v-sheet.open h2')).toHaveText('Magazzino');
      await page.keyboard.press('Escape');
      await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
      await page.waitForTimeout(1500);   // qualche fotogramma da sveglia, con le particelle che si muovono
      await canvasVivo(page);
      await expect(page.locator('.v-err')).toHaveCount(0);
      expect(r.letture.meteo).toHaveLength(1);
      expect(r.posts).toEqual([]);
      expect(r.errori).toEqual([]);
    });
  }
});

test.describe('fase 3: chi scrive non parte mai da Ale per sbaglio', () => {
  test('l\'app intera aperta dal Villaggio installato con ?chi=Ginevra firma Ginevra, lo ricorda e toglie ?chi dall\'indirizzo; un ?chi sconosciuto non conta', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, '?chi=Ginevra#villaggio', dati);
    await hud(page, attesi(dati));
    await expect(page.locator('.v-hud .v-chi b')).toHaveText('Ginni');
    await expect(page).toHaveURL(/\/amimi-app\/#villaggio$/);
    expect(await page.evaluate(() => localStorage.getItem('amimi_chi'))).toBe('Ginevra');
    await etichettaLab(page, 'Francesco').click();
    const sophie = page.locator('.v-sheet.open .v-row', { hasText: 'Camoscio marrone' });
    await sophie.getByRole('button', { name: 'Arrivate' }).click();
    await sophie.locator('.ds-recv input.num').fill('1');
    await sophie.locator('.ds-segna').click();
    await expect.poll(() => r.posts.length, ATTESA).toBe(1);
    expect(r.posts[0].body).toMatchObject({ action: 'arrival_set', chi: 'Ginevra' });
    // un nome che non e' una persona dell'app non cambia chi scrive
    await page.goto('?chi=Mario#villaggio');
    await hud(page, attesi(dati));
    await expect(page.locator('.v-hud .v-chi b')).toHaveText('Ginni');
    expect(await page.evaluate(() => localStorage.getItem('amimi_chi'))).toBe('Ginevra');
    expect(r.errori).toEqual([]);
  });
});

test.describe('fase 3: telefono da 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  /** I controlli visibili di `sel` piu' bassi (o stretti, con `largo`) di 44 px, con un nome per riconoscerli; vuoto se
   *  vanno tutti bene. Almeno uno deve esserci: un selettore che non trova niente non e' un controllo passato. */
  const piccoli = async (page: Page, sel: string, largo = false) => {
    const xs = await page.locator(sel).evaluateAll((els) => els
      .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
      .map((el) => { const b = el.getBoundingClientRect(); return { cosa: ((el.getAttribute('aria-label') || el.textContent || el.className) ?? '').trim().slice(0, 40), w: Math.round(b.width), h: Math.round(b.height) }; }));
    expect(xs.length, `nessun controllo visibile per ${sel}`).toBeGreaterThan(0);
    return xs.filter((x) => x.h < 44 || (largo && x.w < 44));
  };
  /** I testi visibili del Villaggio sotto i 12 px (fuori dai moduli di Ordini e Magazzino, che hanno i loro stili). */
  const testiPiccoli = async (page: Page) => {
    const { visti, out } = await page.evaluate(() => {
      const out: string[] = [];
      let visti = 0;
      const w = document.createTreeWalker(document.querySelector('.vil') ?? document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const t = w.currentNode as Text, el = t.parentElement;
        if (!el || !(t.textContent ?? '').trim() || el.closest('.v-form, .v-conta, [aria-hidden="true"]') || !el.getClientRects().length) continue;
        visti++;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 12) out.push(`${fs}px ${el.tagName.toLowerCase()}.${el.className}: ${(t.textContent ?? '').trim().slice(0, 30)}`);
      }
      return { visti, out };
    });
    expect(visti, 'nessun testo visibile da misurare').toBeGreaterThan(5);
    return out;
  };

  test('chi al primo avvio, HUD, barra, X, "Cambia ...", bottoni dei pannelli e della riga d\'arrivo almeno 44 px; testi del Villaggio almeno 12 px', async ({ page }) => {
    const dati = datiBase();
    const r = await apri(page, 'villaggio/', dati);
    await expect(page.getByText('Chi usa questo telefono?')).toBeVisible(ATTESA);
    expect(await piccoli(page, '.screen .card button', true)).toEqual([]);
    await page.locator('.screen .card button', { hasText: 'Ginni' }).click();
    await hud(page, attesi(dati));
    expect(await piccoli(page, '.v-hud button, .v-hud .v-chi', false), 'HUD').toEqual([]);
    expect(await piccoli(page, '.v-hud .v-home, .v-hud .v-qb', true), 'Home e ?').toEqual([]);
    expect(await piccoli(page, '.v-bar .v-rb', true), 'barra in basso').toEqual([]);
    expect(await testiPiccoli(page), 'testi dell\'isola').toEqual([]);
    // il laboratorio con la riga d'arrivo aperta
    await etichettaLab(page, 'Francesco').click();
    const sophie = page.locator('.v-sheet.open .v-row', { hasText: 'Camoscio marrone' });
    await sophie.getByRole('button', { name: 'Arrivate' }).click();
    await expect(sophie.locator('.ds-segna')).toBeVisible();
    expect(await piccoli(page, '.v-sheet.open .v-x', true), 'X').toEqual([]);
    expect(await piccoli(page, '.v-sheet.open .v-sbody .v-btn', false), 'bottoni del laboratorio').toEqual([]);
    expect(await piccoli(page, '.v-sheet.open .v-arrivo .ds-segna, .v-sheet.open .v-arrivo .ds-del, .v-sheet.open .v-arrivo .linkbtn', false), 'riga d\'arrivo').toEqual([]);
    expect(await testiPiccoli(page), 'testi del laboratorio').toEqual([]);
    await page.locator('.v-sheet .v-x').click();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    // i passi dell'ordine: "Cambia fornitore / modello / colore" sono bottoni veri
    await page.getByRole('button', { name: 'Ordina borse', exact: true }).click();
    await tile(page, 'Francesco').click();
    expect(await piccoli(page, '.v-sheet.open .v-back', false), 'Cambia fornitore').toEqual([]);
    await tile(page, 'Lea').click();
    expect(await piccoli(page, '.v-sheet.open .v-back', false), 'Cambia modello').toEqual([]);
    expect(await testiPiccoli(page), 'testi del passo 3').toEqual([]);
    await page.locator('.v-sheet.open .v-vt', { hasText: 'Cocco nero' }).click();
    await expect(passo(page)).toHaveText('Quantità e prezzo');
    expect(await piccoli(page, '.v-sheet.open .v-back', false), 'Cambia colore').toEqual([]);
    await page.locator('.v-sheet .v-x').click();
    await expect(page.locator('.v-sheet.open')).toHaveCount(0, ATTESA);
    // Magazzino e scheda della pila
    await barra(page, 'Magazzino').click();
    expect(await testiPiccoli(page), 'testi del Magazzino').toEqual([]);
    await tessera(page, 'Cocco nero').click();
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Lea · Cocco nero');
    await expect(dopoSezione(page, /^Vendite/)).toBeVisible(ATTESA);
    expect(await piccoli(page, '.v-sheet.open .v-sbody button', false), 'bottoni della scheda della pila').toEqual([]);
    expect(await testiPiccoli(page), 'testi della scheda della pila').toEqual([]);
    // la legenda
    await page.locator('.v-sheet .v-x').click();
    await page.locator('.v-hud .v-qb', { hasText: '?' }).click();
    await expect(page.locator('.v-sheet.open h2')).toHaveText('Come leggere il villaggio');
    // i segnali nuovi della fase 3 sono spiegati
    await expect(page.locator('.v-sheet.open .v-sig b')).toContainText(['Bandierina arancio sulla pila', 'Punto di domanda sul capannone', 'Orologio sul capannone', 'Cuore sul capannone']);
    expect(await testiPiccoli(page), 'testi della legenda').toEqual([]);
    expect(r.posts).toEqual([]);
    expect(r.errori).toEqual([]);
  });
});
