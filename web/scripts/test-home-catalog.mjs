// Test frontend: Home "Tutte le azioni" + Catalogo prodotti con COGS (iPhone 13, build dist servita da vite preview)
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:4173/amimi-app/';
const out = [];
const ok = (name, cond, extra = '') => { out.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) process.exitCode = 1; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });

// --- 1. Home Ale: sezione "Tutte le azioni" ---
await page.getByRole('button', { name: 'Ale', exact: true }).click();
const allBtn = page.getByRole('button', { name: /Tutte le azioni/ });
ok('sezione "Tutte le azioni" presente', await allBtn.count() === 1);
// se collassata, apri
const tilesVisible = await page.getByRole('button', { name: 'Prodotti & prezzi' }).count();
if (!tilesVisible) await allBtn.click();
ok('tile "Prodotti & prezzi" visibile', await page.getByRole('button', { name: 'Prodotti & prezzi' }).count() >= 1);
ok('tile "Reso / Cambio" visibile', await page.getByRole('button', { name: 'Reso / Cambio' }).count() >= 1);
ok('tile "Spese" visibile', await page.getByRole('button', { name: 'Spese', exact: true }).count() >= 1);
// niente duplicati: "Registra vendita" è nei personali di Ale, non deve apparire 2 volte
ok('nessun duplicato "Registra vendita"', await page.getByRole('button', { name: 'Registra vendita' }).count() === 1);

// --- 2. toggle collassa e persiste ---
await allBtn.click(); // chiudi
ok('collassata: tile nascoste', await page.getByRole('button', { name: 'Reso / Cambio' }).count() === 0);
await page.reload({ waitUntil: 'networkidle' });
ok('stato collassato persiste dopo reload', await page.getByRole('button', { name: 'Reso / Cambio' }).count() === 0);
await page.getByRole('button', { name: /Tutte le azioni/ }).click(); // riapri per il resto del test

// --- 3. Benedetta: niente Cruscotto (no finance), sezione presente ---
await page.getByRole('button', { name: 'Benedetta' }).click();
ok('Bene: sezione presente', await page.getByRole('button', { name: /Tutte le azioni/ }).count() === 1);
ok('Bene: NO Cruscotto finanze', await page.getByRole('button', { name: 'Cruscotto finanze' }).count() === 0);
ok('Bene: "Movimento B2B" visibile', await page.getByRole('button', { name: 'Movimento B2B' }).count() >= 1);

// --- 4. Catalogo: cerca cocco black, apri, campo COGS valorizzato ---
await page.getByRole('button', { name: 'Prodotti & prezzi' }).click();
await page.waitForSelector('input[placeholder*="Cerca"]', { timeout: 10000 });
await page.fill('input[placeholder*="Cerca"]', 'cocco black');
await page.waitForTimeout(600);
const cards = page.locator('.todocard');
ok('catalogo: risultati per "cocco black"', await cards.count() >= 1, `trovati ${await cards.count()}`);
// chip COGS visibile in lista
ok('catalogo: chip COGS in lista', (await page.locator('.misschip', { hasText: 'COGS' }).count()) >= 1);
await cards.first().click();
await page.waitForSelector('label:has-text("COGS")', { timeout: 8000 });
const cogsVal = await page.locator('div:has(> label:has-text("COGS")) input').first().inputValue();
ok('form: campo COGS presente e valorizzato', cogsVal !== '', `valore="${cogsVal}"`);
const priceVal = await page.locator('div:has(> label:has-text("Prezzo")) input').first().inputValue();
ok('form: campo Prezzo valorizzato', priceVal !== '', `valore="${priceVal}"`);
ok('form: hint prezzo consigliato da COGS', (await page.locator('.hintchip').count()) >= 1);
// bottone salva presente (non clicco: niente scritture dal test)
ok('form: bottone salva presente', (await page.getByRole('button', { name: /Verifica e salva/ }).count()) === 1);

// --- 5. zero errori JS ---
ok('zero pageerror JS', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(out.join('\n'));
await browser.close();
