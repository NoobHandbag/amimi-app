import { test, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Schermate di riferimento per il restyling (tema Amimi', 15-10): ogni schermata principale a 390 px, su dati FINTI.
// Non e' un test: non asserisce niente, salva un PNG per schermata, cosi' prima e dopo un cambio di stile si
// confrontano sugli stessi dati. Come negozi-layout, ogni richiesta a *.supabase.co e' intercettata e la sessione e'
// un oggetto finto in localStorage. Le righe sono inventate a partire dalle colonne del select= (un select=* riceve
// una lista vuota). Fuori dalla CI, che lancia solo `playwright test negozi`.
// Uso (da web/):
//   VITE_SUPABASE_URL=https://e2e-progetto-finto.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_e2e_finto npx vite build
//   SCHERMATE_DIR=<cartella> npx playwright test tema-schermate --retries=0

const DIR = process.env.SCHERMATE_DIR || join(tmpdir(), 'amimi-schermate');
mkdirSync(DIR, { recursive: true });

const MODELLI = ['Lea Bag', 'Sveva Bag', 'Agata Bag', 'Charm Tiger', 'Mimi Pochette', 'Lea Mini'];
const VARIANTI = ['Leopardo Savana', 'Nero', 'Verde Bosco', 'Rosso', 'Muccata', 'Cuoio'];
const PERSONE = ['Giulia Rossi', 'Marta Bianchi', 'Sara Conti', 'Elena Greco', 'Chiara Villa', 'Anna Ferri'];
const RIGHE = 6;

const BOOL = /^(is_|on_|has_)|^(verificato|edited|opt_out|pronto_stock|attivo|enabled|scaduta|da_gestire|letto|risolto)$/;
const DATA = /(^|_)(at|date|data|day|ts|giorno|captured|synced|scadenza)(_|$)/;
const NUM = /(qty|quant|giacenz|costo|cogs|price|prezzo|valore|value|lordo|netto|^mc\d|^n$|^n_|pezzi|disponibil|sold|vendut|mancano|diff|refund|commission|totale|importo|amount|spend|ricav|margin|count|tocch|score|rating|follower|pct|perc|tasso|rate|eur|ordini|vendite|sequenza|migr_n|last_price|in_conto|sessioni|click|impression|reach|roas|cpa|ctr|punti|saldo|giorni|delta|stock|sconto|media|mediana|min|max|peso|clienti|resi)/;
const ENUM: Record<string, string[]> = {
  severity: ['info', 'warn', 'error'], status: ['aperto', 'in_corso', 'chiuso'], stato: ['da_fare', 'in_corso', 'fatto'],
  canale: ['online', 'negozio', 'b2b'], direction: ['in', 'out'], kind: ['materiale', 'prodotto'], tipo: ['boutique', 'concept store'],
  categoria: ['Borse', 'Accessori', 'Pochette'], tier: ['A', 'B', 'C'], verdetto: ['da_contattare', 'buono', 'scartato'],
};

function valore(col: string, i: number): unknown {
  const c = col.toLowerCase();
  if (c === 'id' || c.endsWith('_id') || c === 'conv_id') return `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`;
  if (BOOL.test(c)) return i % 2 === 0;
  if (c === 'month' || c === 'mese') return `2026-${String(9 - (i % 9)).padStart(2, '0')}-01`;
  if (c === 'year' || c === 'anno') return 2026;
  if (DATA.test(c) || /^data/.test(c)) return new Date(Date.UTC(2026, 9, 14 - i * 3, 9 + i, 30)).toISOString();
  if (c.includes('codice')) return `${MODELLI[i % 6]}_${VARIANTI[i % 6]}`.toUpperCase().replace(/[^A-Z]+/g, '_');
  if (c === 'variant' || c === 'variante') return VARIANTI[i % 6];
  if (/^(item|model|modello|modello_censito|lineitem_name|title|seo_title|product_type)$/.test(c)) return MODELLI[i % 6];
  if (/^(name|nome|label|negozio|fornitore|supplier|gruppo|citta)$/.test(c)) return ['Bottega Tremezzo', 'Atelier Brera', 'Pelletteria Rossi', 'Concept Nove', 'Studio Isola', 'Casa Verde'][i % 6];
  if (/^(customer_name|cognome|chi|raccolto_da|proposed_by|sent_by|autore|utente)$/.test(c)) return PERSONE[i % 6];
  if (c.includes('email')) return `cliente${i + 1}@esempio.it`;
  if (/(url|path|image|thumb|shot|asset)/.test(c)) return null;
  if (/^(payload|after|before|dati_usati|fatti_usati|form_fields|meta|ig_metrics|maps|price_band|brands_carried|json)$/.test(c)) return null;
  if (ENUM[c]) return ENUM[c][i % ENUM[c].length];
  if (NUM.test(c)) return /qty|quant|pezzi|giacenz|disponibil|sold|vendut|mancano|^n$|^n_|count|stock|ordini|clienti|resi|giorni/.test(c) ? 2 + ((i * 7) % 23) : Math.round((180 + i * 137.5) * 100) / 100;
  if (/(note|nota|testo|body|oggetto|descr|motivo|errore|messaggio|summary|riepilogo)/.test(c)) return 'Testo di esempio per la schermata, una riga lunga quanto una nota vera.';
  return `${c.replace(/_/g, ' ')} ${i + 1}`;
}

// select=a,b:alias,c::text,rel(x,y) -> nomi delle colonne di primo livello (le relazioni restano null)
function colonne(select: string | null): string[] | null {
  if (!select || select.trim() === '*') return null;
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of select + ',') {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  return out.filter(Boolean).map((s) => {
    const base = s.replace(/\(.*$/, '').replace(/::.*$/, '');
    return base.includes(':') ? base.split(':')[0] : base;
  });
}

function righe(cols: string[], n = RIGHE) {
  return Array.from({ length: n }, (_, i) => Object.fromEntries(cols.map((c) => [c, valore(c, i)])));
}

const UTENTE = { id: '00000000-0000-0000-0000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'prova@amimi.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };

async function rispondi(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, headers: Record<string, string> = {}) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
  if (url.pathname.startsWith('/auth/v1/')) return json(url.pathname.endsWith('/user') ? UTENTE : {});
  if (url.pathname.startsWith('/functions/v1/')) return json({});
  if (!url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/rest/v1/rpc/') || req.method() !== 'GET' && req.method() !== 'HEAD') return json([]);
  const cols = colonne(url.searchParams.get('select'));
  const rows = cols ? righe(cols) : [];
  const range = { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' };
  if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: range, body: '' });
  if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) return json(rows[0] ?? null, range);
  return json(rows, range);
}

async function apri(page: Page, hash = '') {
  await page.clock.setFixedTime(new Date('2026-10-15T10:00:00Z'));
  await page.addInitScript((u) => {
    localStorage.setItem('amimi-cs-auth', JSON.stringify({ access_token: 'finto', refresh_token: 'finto', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: u }));
    localStorage.setItem('amimi_chi', 'Ale');
  }, UTENTE);
  await page.route(/supabase\.co\//, rispondi);
  await page.goto(hash);
  await page.waitForLoadState('networkidle');
}

async function scatta(page: Page, nome: string) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(DIR, `${nome}.png`), fullPage: true, animations: 'disabled' });
}

const DA_HOME: [string, string][] = [
  ['02-cruscotto', 'Cruscotto finanze'], ['03-ce-dettagliato', 'CE dettagliato'], ['04-margini', 'Margini'],
  ['05-clienti', 'Clienti'], ['06-salute', 'Salute & Movimenti'], ['07-premia', 'Premia'],
  ['08-registra-vendita', 'Registra vendita'], ['09-spese', 'Spese'], ['10-prodotti-prezzi', 'Prodotti & prezzi'],
  ['11-ordini-arrivi', 'Ordini in arrivo'], ['12-nuovo-ordine', 'Nuovo ordine fornitore'], ['13-pulizia-dati', 'Pulizia dati'],
];
const DA_NAV: [string, string][] = [['14-magazzino', 'Magazzino'], ['15-tabelle', 'Tabelle'], ['16-assistenza', 'Assistenza'], ['17-b2b', 'B2B']];

test.describe('schermate tema', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('01-home', async ({ page }) => {
    await apri(page);
    await scatta(page, '01-home');
  });

  for (const [nome, etichetta] of DA_HOME) {
    test(nome, async ({ page }) => {
      await apri(page);
      await page.getByLabel('Cerca azione').fill(etichetta);
      await page.locator('button.ds-mcard, button.ds-qbtn', { hasText: etichetta }).first().click();
      await scatta(page, nome);
    });
  }

  for (const [nome, etichetta] of DA_NAV) {
    test(nome, async ({ page }) => {
      await apri(page);
      await page.locator('.bottomnav button', { hasText: etichetta }).click();
      await scatta(page, nome);
    });
  }

  test('18-ads', async ({ page }) => {
    await apri(page, '#ads');
    await scatta(page, '18-ads');
  });
});
