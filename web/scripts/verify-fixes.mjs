// Verify the audit fixes against a local preview build (mobile viewport).
import { chromium, devices } from '@playwright/test';
const BASE = 'http://localhost:4173/amimi-app/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
const settle = (ms) => page.waitForTimeout(ms);

// wait for preview server
for (let i = 0; i < 30; i++) { try { await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 2000 }); break; } catch { await settle(1000); } }

async function go(navFn) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app', { timeout: 15000 });
  await settle(800);
  if (navFn) await navFn();
  await settle(1200);
}
const navRegistra = (t) => async () => { await page.locator('.bottomnav button', { hasText: 'Registra' }).click(); await page.waitForSelector('.tipi'); await page.locator('.tipo', { hasText: t }).click(); };
const out = { pickerForms: {} };

for (const [name, t] of [['conta', 'Conta fisica'], ['reso', 'Reso / Cambio'], ['vendita', 'Regalo / Vendita'], ['b2b', 'Movimento B2B']]) {
  await go(navRegistra(t));
  out.pickerForms[name] = await page.evaluate(() => {
    const d = document.documentElement; const pg = document.querySelector('.pgrid');
    return { innerW: window.innerWidth, docOverflow: d.scrollWidth - window.innerWidth, pgridOverflow: pg ? pg.scrollWidth - pg.clientWidth : 'no-grid' };
  });
}
await page.screenshot({ path: '../audits/evidence/verify-registra-conta-fixed.png', fullPage: true });

// cruscotto: MC1% column present + Gen hidden in Amimì scope
await go(async () => { await page.locator('.hometile', { hasText: 'Cruscotto finanze' }).first().click(); });
out.cruscotto = await page.evaluate(() => {
  const heads = [...document.querySelectorAll('table.sortable th')].map((t) => t.textContent.trim());
  const chips = [...document.querySelectorAll('.chips .chip')].map((c) => c.textContent.trim());
  return { tableHeads: heads, hasMC1pct: heads.some((h) => /MC1%/.test(h)), genChipVisibleInAmimi: chips.includes('Gen'), monthChips: chips };
});
await page.screenshot({ path: '../audits/evidence/verify-cruscotto-fixed.png', fullPage: true });

// product-name cleanup: no raw underscores in inventory list names
await go(async () => { await page.locator('.bottomnav button', { hasText: 'Magazzino' }).click(); await page.locator('header .seg.wrap button', { hasText: 'Magazzino' }).click(); await page.waitForSelector('.invtable tbody tr'); });
out.inventoryNamesWithUnderscore = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.invtable td.prodcell')].map((c) => c.textContent.trim());
  return cells.filter((t) => /_/.test(t)).slice(0, 8);
});

out.consoleErrors = errs.slice(0, 10);
console.log(JSON.stringify(out, null, 2));
await browser.close();
