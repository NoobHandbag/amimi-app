// End-to-end frontend driver for the Amimì app flows. Usage: node scripts/flow.mjs <flow>
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'https://noobhandbag.github.io/amimi-app/';
const OUT = '../audits/evidence/flows';
fs.mkdirSync(OUT, { recursive: true });
const FLOW = process.argv[2];

const browser = await chromium.launch();
const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
let lastDialog = null, dialogAction = 'accept';
page.on('dialog', async (d) => { lastDialog = d.message(); dialogAction === 'dismiss' ? await d.dismiss() : await d.accept(); });

const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const out = (o) => console.log('RESULT ' + JSON.stringify({ flow: FLOW, ...o, errs }));
const toastTxt = () => page.locator('[class*="toast"]').first().innerText().catch(() => '');
const bodyTxt = () => page.evaluate(() => document.body.innerText);

async function boot() {
  for (let i = 0; i < 4; i++) { try { await page.goto(BASE, { waitUntil: 'load', timeout: 60000 }); break; } catch (e) { if (i === 3) throw e; await page.waitForTimeout(2000); } }
  await page.waitForSelector('.app', { timeout: 30000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
}
async function goTab(label) { await page.locator('.bottomnav button', { hasText: label }).click(); await page.waitForTimeout(800); }
async function goRegistra() { for (let i = 0; i < 3; i++) { await page.locator('.bottomnav button', { hasText: 'Registra' }).click(); try { await page.waitForSelector('.tipo', { timeout: 5000 }); break; } catch { await page.waitForTimeout(1000); } } }
async function openTile(label) { await page.locator('.tipo', { hasText: label }).click(); await page.waitForTimeout(700); }
async function pick(search) {
  await page.locator('input[placeholder*="Cerca"]').first().fill(search);
  await page.waitForTimeout(800);
  await page.locator('.pgrid .pcard').first().click();
  await page.waitForTimeout(700);
}
const supcard = (t) => page.locator('.supcard', { hasText: t });
const submit = (re) => page.locator('button.submit', re ? { hasText: re } : undefined).last().click();

try {
  if (FLOW === 'gift-regalo') {
    await boot(); await goRegistra(); await openTile('Regalo / Vendita manuale');
    await pick('lea_bag_cocco_purple');
    await shot('A1-gift-regalo-form');
    await page.locator('button.submit', { hasText: /Registra regalo/ }).click();
    await page.waitForTimeout(1200); await shot('A1-gift-regalo-toast');
    out({ toast: await toastTxt() });
  }

  else if (FLOW === 'gift-vendita') {
    await boot(); await goRegistra(); await openTile('Regalo / Vendita manuale');
    await page.locator('.seg button', { hasText: 'Vendita manuale' }).click(); await page.waitForTimeout(300);
    await pick('lea_bag_cocco_purple');
    await page.locator('.stepper input').nth(1).fill('100'); // prezzo (2nd stepper)
    await page.waitForTimeout(300); await shot('A2-gift-vendita-form');
    await page.locator('button.submit', { hasText: /Registra vendita/ }).click();
    await page.waitForTimeout(1200); await shot('A2-gift-vendita-toast');
    out({ toast: await toastTxt() });
  }

  else if (FLOW === 'b2b-venduto') {
    await boot(); await goRegistra(); await openTile('Movimento B2B');
    await pick('lea_bag_cocco_purple');
    await supcard('Venduto').click(); await page.waitForTimeout(200);
    await supcard('Conto vendita').click(); await page.waitForTimeout(200);
    await supcard('Test_Scheda_QA').click(); await page.waitForTimeout(300);
    await shot('A3-b2b-venduto-form');
    await page.locator('button.submit', { hasText: /movimento B2B/ }).click();
    await page.waitForTimeout(1200); await shot('A3-b2b-venduto-toast');
    out({ toast: await toastTxt() });
  }

  else if (FLOW === 'arrivo') {
    await boot(); await goTab('Ordini'); await page.waitForTimeout(800);
    await page.locator('.navcard', { hasText: 'Sarte Milano' }).first().click();
    await page.waitForSelector('.linerow', { timeout: 10000 }); await page.waitForTimeout(800);
    // first open row is defaultOpen (expanded); capture its product + set arrived to 5
    const rowText = await page.locator('.linerow').first().innerText();
    await page.locator('.arrinline .qbox').first().fill('5');
    await shot('A4-arrivo-form');
    await page.locator('.arrinline button.submit', { hasText: /salva/ }).first().click();
    await page.waitForTimeout(1500); await shot('A4-arrivo-toast');
    out({ toast: await toastTxt(), row: rowText.replace(/\n/g, ' | ') });
  }

  else if (FLOW === 'ordine-nuovo') {
    await boot(); await goTab('Ordini'); await page.waitForTimeout(600);
    await page.locator('.bigadd', { hasText: /Nuovo ordine/ }).first().click();
    await page.waitForTimeout(700);
    await supcard('Sarte Milano').first().click(); // pick fornitore
    await page.waitForTimeout(1000);
    // add first history bag
    await page.locator('.pgrid .pcard').first().click(); await page.waitForTimeout(500);
    await shot('A5-ordine-form');
    await page.locator('button.submit', { hasText: /Salva ordine/ }).click();
    await page.waitForTimeout(1500); await shot('A5-ordine-toast');
    out({ toast: await toastTxt() });
  }

  else if (FLOW === 'expense-manual') {
    await boot(); await goRegistra(); await openTile('Spese');
    await page.locator('.bigadd', { hasText: /Aggiungi spesa/ }).click(); await page.waitForTimeout(500);
    await page.locator('.form input.txt').first().fill('TEST QA spesa marketing');
    await page.locator('.stepper input').first().fill('50');
    await supcard('MARKETING').click();
    await page.waitForTimeout(300); await shot('B1-expense-form');
    await page.locator('button.submit', { hasText: /Registra spesa/ }).click();
    await page.waitForTimeout(1200); await shot('B1-expense-toast');
    out({ toast: await toastTxt() });
  }

  else if (FLOW === 'expense-approve') {
    await boot(); await goRegistra(); await openTile('Spese');
    await page.waitForTimeout(800);
    const before = await page.locator('.exprow').count();
    await shot('B2-expense-pending');
    await page.locator('.exprow .expbtns .ok').first().click();
    await page.waitForTimeout(1500); await shot('B2-expense-after');
    out({ pendingBefore: before, pendingAfter: await page.locator('.exprow').count() });
  }

  else if (FLOW === 'nuovo-prodotto') {
    await boot(); await goRegistra(); await openTile('Nuovo prodotto');
    await page.locator('input[placeholder*="Cerca modello"]').fill('Lea'); await page.waitForTimeout(500);
    await page.locator('.supcard', { hasText: /^Lea Bag$/ }).first().click(); await page.waitForTimeout(300);
    await page.locator('input[placeholder*="COCCO ROSSO"]').fill('QATESTZZZ'); await page.waitForTimeout(300);
    await page.locator('.stepper input').first().fill('100');
    await shot('C1-nuovo-prodotto-form');
    await page.locator('button.submit', { hasText: /Crea prodotto/ }).click();
    await page.waitForTimeout(1200); await shot('C1-nuovo-prodotto-toast');
    out({ toast: await toastTxt() });
  }

  else if (FLOW === 'verifica') {
    await boot(); await goRegistra(); await openTile('Pulizia dati');
    await page.waitForTimeout(800);
    const clk = page.locator('.todoghead.clk'); // expand optional "Pulizia anagrafica" if actionable groups empty
    if (await clk.count()) { await clk.click(); await page.waitForTimeout(600); }
    await page.waitForSelector('.todocard', { timeout: 10000 }); await page.waitForTimeout(500);
    await page.locator('.todocard').first().click(); await page.waitForTimeout(700);
    const backTxt = await page.locator('.back').first().innerText().catch(() => '');
    // ensure required fields filled
    const item = page.locator('.grid2 input.txt').first();
    const variant = page.locator('.grid2 input.txt').nth(1);
    if (!(await item.inputValue())) await item.fill('QA Model');
    if (!(await variant.inputValue())) await variant.fill('QA VAR');
    await page.locator('input[placeholder*="Obbligatoria"], input[placeholder="—"]').first().fill('QA descrizione test').catch(() => {});
    await shot('C2-verifica-form');
    await page.locator('button.submit', { hasText: /Verifica e salva/ }).click();
    await page.waitForTimeout(1200); await shot('C2-verifica-toast');
    out({ toast: await toastTxt(), back: backTxt.replace(/\n/g, ' ') });
  }

  else if (FLOW === 'gated-pubblica') {
    await boot(); await goRegistra(); await openTile('Pubblica su Shopify');
    await page.waitForTimeout(1000); await shot('D-gated-pubblica');
    const warn = await page.locator('.card.warn').first().innerText().catch(() => '');
    const disabledPub = await page.locator('button.chip:has-text("pubblica")').first().isDisabled().catch(() => null);
    out({ warn: warn.replace(/\n/g, ' ').slice(0, 120), pubblicaDisabled: disabledPub });
  }

  else if (FLOW === 'reads') {
    const seen = {};
    await boot();
    await shot('D-home'); seen.home = (await bodyTxt()).slice(0, 40);
    // persona switch
    await page.locator('.persona button, .hello ~ * button', { hasText: 'Benedetta' }).first().click().catch(() => {});
    await page.waitForTimeout(700); await shot('D-home-benedetta');
    await page.locator('button', { hasText: /^Ale$/ }).first().click().catch(() => {});
    await page.waitForTimeout(500);
    // CRUSCOTTO via home summary card
    await page.locator('.homesum').first().click().catch(async () => { await page.locator('button', { hasText: 'Cruscotto' }).first().click().catch(() => {}); });
    await page.waitForTimeout(1800); await shot('D-cruscotto');
    seen.cruscotto = (await page.locator('.kpi .v').allInnerTexts().catch(() => [])).slice(0, 4);
    await page.locator('.askhead', { hasText: 'Chiedi ai dati' }).click().catch(() => {}); await page.waitForTimeout(500); await shot('D-cruscotto-chiedi');
    await page.locator('.askhead', { hasText: 'Calcolatore' }).click().catch(() => {}); await page.waitForTimeout(500); await shot('D-cruscotto-calc');
    // INVENTARIO sub-tabs
    await goTab('Magazzino');
    await page.waitForFunction(() => !document.body.innerText.includes('Carico'), { timeout: 20000 }).catch(() => {});
    for (const t of ['Riordino', 'Nei negozi', 'Shopify', 'Valore', 'Magazzino']) {
      await page.locator('.invhead .seg.wrap button', { hasText: t }).click().catch(() => {});
      await page.waitForTimeout(1300); await shot('D-inv-' + t.replace(/\W+/g, '_'));
    }
    // product drawer (from Magazzino table)
    await page.locator('.invtable tbody tr.clickrow, .clickrow').first().click().catch(() => {});
    await page.waitForTimeout(900); await shot('D-inv-drawer');
    await page.locator('.drawerx').first().click().catch(() => {});
    // TABELLE
    await goRegistra(); await openTile('Tabelle'); await page.waitForTimeout(1400); await shot('D-tabelle');
    out({ seen });
  }

  else { console.log('UNKNOWN FLOW ' + FLOW); }
} catch (e) {
  await shot(`FAIL-${FLOW}`);
  console.log('ERROR ' + e.message);
  out({ error: e.message, body: (await bodyTxt().catch(() => '')).slice(0, 200) });
}
await browser.close();
