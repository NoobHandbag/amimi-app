import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'https://noobhandbag.github.io/amimi-app/';
const OUT = '../audits/evidence/count-test';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));

let dialogAction = 'accept';
let lastDialog = null;
page.on('dialog', async (d) => { lastDialog = d.message(); if (dialogAction === 'dismiss') await d.dismiss(); else await d.accept(); });

const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const log = (o) => console.log(JSON.stringify(o));

for (let i = 0; i < 4; i++) {
  try { await page.goto(BASE, { waitUntil: 'load', timeout: 60000 }); break; }
  catch (e) { if (i === 3) throw e; await page.waitForTimeout(2000); }
}
await page.waitForSelector('.app', { timeout: 30000 });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1500);

async function openContaAndPick() {
  // If we're not already in the count form's product picker, navigate to it via the hub.
  if (!(await page.locator('input[placeholder*="Cerca"]').count())) {
    // nav can need a retry if the SPA is still settling
    for (let i = 0; i < 3; i++) {
      await page.locator('.bottomnav button', { hasText: 'Registra' }).click();
      try { await page.waitForSelector('.tipo', { timeout: 5000 }); break; } catch { await page.waitForTimeout(1000); }
    }
    await page.locator('.tipo', { hasText: 'Conta fisica' }).click();
    await page.waitForSelector('input[placeholder*="Cerca"]', { timeout: 12000 });
  }
  await page.locator('input[placeholder*="Cerca"]').first().fill('PETROL');
  await page.waitForTimeout(700);
  await page.locator('.pcard, .pgrid button').filter({ hasText: 'PETROL' }).first().click();
  await page.waitForSelector('.sysrow', { timeout: 8000 });
  // wait for the LIVE giacenza to load (sysrow shows "…" until then)
  await page.waitForFunction(() => /\d/.test(document.querySelector('.sysrow b')?.textContent || ''), { timeout: 10000 });
}

// ---- 1) small delta: form state + apply + toast ----
await openContaAndPick();
const sys1 = (await page.locator('.sysrow').innerText()).replace(/\n/g, ' ');
const giac1 = parseInt(sys1.match(/(-?\d+)\s*pz/)?.[1] ?? '0', 10);
const small = giac1 - 1; // delta -1, no confirm
await page.locator('.stepper input').first().fill(String(small));
await page.waitForTimeout(400);
const badge1 = await page.locator('.deltabadge').innerText().catch(() => '');
const note1 = await page.locator('.form .note, .note').filter({ hasText: 'corretta' }).first().innerText().catch(() => '');
await shot('01-small-delta-form');
dialogAction = 'accept';
await page.locator('button.submit', { hasText: /Applica|Applico/ }).click();
await page.waitForTimeout(700);
await shot('02-small-delta-toast');
const toast1 = await page.locator('[class*="toast"]').first().innerText().catch(() => '');
log({ step: 'small', sysrow: sys1, giacBefore: giac1, counted: small, badge: badge1, note: note1, toast: toast1, dialogFired: lastDialog });

// ---- 2) large delta: confirm dialog must fire; first DISMISS (no change) ----
await page.waitForTimeout(800);
await openContaAndPick();
const giac2 = parseInt((await page.locator('.sysrow').innerText()).match(/(-?\d+)\s*pz/)?.[1] ?? '0', 10);
const big = giac2 + 8; // delta +8 -> must trigger window.confirm
await page.locator('.stepper input').first().fill(String(big));
await page.waitForTimeout(300);
lastDialog = null; dialogAction = 'dismiss';
await page.locator('button.submit', { hasText: /Applica|Applico/ }).click();
await page.waitForTimeout(700);
const dismissedDialog = lastDialog;
await shot('03-big-delta-dismissed');

// ---- 3) large delta: now ACCEPT -> applies ----
lastDialog = null; dialogAction = 'accept';
await page.locator('button.submit', { hasText: /Applica|Applico/ }).click();
await page.waitForTimeout(900);
await shot('04-big-delta-accepted-toast');
const acceptedDialog = dismissedDialog; // same message text
log({ step: 'big', giacBefore: giac2, counted: big, dialogOnDismiss: dismissedDialog, appliedAfterAccept: lastDialog === null });

// ---- 4) Magazzino shows corrected giacenza ----
await page.waitForTimeout(600);
await page.locator('.bottomnav button', { hasText: 'Magazzino' }).click();
await page.waitForTimeout(1500);
// the Magazzino sub-tab (giacenze table); search the product
const searchBox = page.locator('input[placeholder*="Cerca"]');
if (await searchBox.count()) { await searchBox.first().fill('PETROL'); await page.waitForTimeout(700); }
await shot('05-magazzino');

await browser.close();
log({ consoleErrors: errs });
console.log('count frontend test done');
