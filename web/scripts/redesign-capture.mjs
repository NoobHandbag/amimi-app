import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'http://localhost:4173/amimi-app/';
const OUT = '../audits/evidence/redesign';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const settle = (p, ms) => p.waitForTimeout(ms);
async function shot(ctx, name, navFn, full = true) {
  const page = await ctx.newPage();
  for (let i = 0; i < 25; i++) { try { await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 2000 }); break; } catch { await settle(page, 1000); } }
  await page.waitForSelector('.app', { timeout: 15000 }); await settle(page, 900);
  if (navFn) await navFn(page); await settle(page, 1300);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  await page.close();
}
const navTab = (l) => async (p) => { await p.locator('.bottomnav button', { hasText: l }).click(); };
const navTile = (l) => async (p) => { await p.locator('.hometile', { hasText: l }).first().click(); };
const navInv = (s) => async (p) => { await p.locator('.bottomnav button', { hasText: 'Magazzino' }).click(); await p.locator('header .seg.wrap button', { hasText: s }).click(); };

const mob = await browser.newContext({ ...devices['iPhone 13'] });
await shot(mob, 'm-home', null);
await shot(mob, 'm-registra-hub', navTab('Registra'));
await shot(mob, 'm-cruscotto', navTile('Cruscotto finanze'));
await shot(mob, 'm-inv-disponibilita', navTab('Magazzino'));
await shot(mob, 'm-inv-magazzino', navInv('Magazzino'));
await mob.close();

const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await shot(desk, 'd-home', null, false);
await shot(desk, 'd-cruscotto', navTile('Cruscotto finanze'), false);
await desk.close();

await browser.close();
console.log('redesign screens captured');
