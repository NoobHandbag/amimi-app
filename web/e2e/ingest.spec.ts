import { test, expect } from '@playwright/test';

// Unique marker so the spawned count row can be cleaned up afterwards.
const NOTA = 'E2E_TEST_' + Date.now();

// Guards the regression where the mount fetch resolving snapped the order form shut. The full
// create+arrival flow is covered exhaustively at the API level by tests/flows.mjs.
test('in arrivo: order form opens and stays open, new-supplier gated by Avanti', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /In arrivo/ }).click();
  await page.getByRole('button', { name: /Nuovo ordine fornitore/ }).click();
  await page.waitForLoadState('networkidle');                                  // form must survive this
  await expect(page.getByText('Fornitore', { exact: true })).toBeVisible();    // step 1 still open
  await page.locator('.supcard.alt').click();
  await expect(page.getByPlaceholder('Nome fornitore')).toBeVisible();
  await expect(page.getByRole('button', { name: /Avanti/ })).toBeVisible();    // new-supplier Avanti gate
});

test('dashboard renders the validated P&L with filter and scope toggle', async ({ page }) => {
  await page.goto('');
  await expect(page.getByText('Conto Economico mensile')).toBeVisible();
  await expect(page.getByText('Fatturato Netto', { exact: true })).toBeVisible();
  // period filter chips + Amimì/Totale scope toggle
  await expect(page.locator('.scopetoggle')).toBeVisible();
  await expect(page.locator('.chip').first()).toBeVisible();
  // at least one month row with a euro value
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  // toggling to Totale surfaces January (Gen) in the monthly table
  await page.getByRole('button', { name: 'Totale', exact: true }).click();
  await expect(page.locator('table tbody tr td.l').first()).toContainText('Gen');
});

test('ingestion: pick a product, enter a count, submit, see success', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /Inserisci/ }).click();
  await page.getByRole('button', { name: /Conta fisica/ }).click();

  await page.getByPlaceholder('Cerca prodotto').fill('lea bag black');
  await page.locator('.pcard').first().click();

  // system giacenza is shown
  await expect(page.locator('.sysrow')).toBeVisible();
  await page.locator('input.num').fill('7');
  await expect(page.locator('.deltabadge')).toBeVisible();

  await page.locator('.txt').fill(NOTA);
  await page.getByRole('button', { name: /Salva conta/ }).click();

  await expect(page.locator('.msg.ok')).toBeVisible();
  await expect(page.locator('.msg.ok')).toContainText('Conta salvata');
});

test('new product: live CODICE generation then create', async ({ page }) => {
  const VAR = 'V' + Date.now();   // unique so reruns never collide on the codice
  await page.goto('');
  await page.getByRole('button', { name: /Inserisci/ }).click();
  await page.getByRole('button', { name: /Nuovo prodotto/ }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ nuovo' }).click();
  await page.getByPlaceholder('es. Lea Bag').fill('E2E Test');
  await page.getByPlaceholder('es. COCCO ROSSO').fill(VAR);
  await expect(page.locator('.codicebox')).toContainText('E2E_Test_' + VAR);
  await page.getByRole('button', { name: /Crea prodotto/ }).click();
  await expect(page.locator('.msg.ok')).toContainText('Prodotto creato');
});

test('inventory tab lists products', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /Inventario/ }).click();
  await expect(page.getByText('Valore magazzino')).toBeVisible();
  await expect(page.locator('.row').first()).toBeVisible();
});

test('inventory: new intelligence subtabs render', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /Inventario/ }).click();
  await page.getByRole('button', { name: 'Disponibilità', exact: true }).click();
  await expect(page.getByText('Acquistabili ora')).toBeVisible();
  await expect(page.getByText(/In stock ma NON su Shopify/)).toBeVisible();
  await page.getByRole('button', { name: 'Riordino', exact: true }).click();
  await expect(page.getByText(/Solo venduti/)).toBeVisible();
  await page.getByRole('button', { name: 'Valore', exact: true }).click();
  await expect(page.getByText('Valore a costo (COGS)')).toBeVisible();
});

test('new product: pricing helper suggests and fills a price', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /Inserisci/ }).click();
  await page.getByRole('button', { name: /Nuovo prodotto/ }).click();
  await page.locator('input.num').nth(1).fill('40');     // COGS
  const chip = page.getByText(/Prezzo consigliato/);
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.locator('input.num').first()).not.toHaveValue('');   // price filled
});

test('cruscotto: ads card + deal calculator', async ({ page }) => {
  await page.goto('');
  await expect(page.getByText('Meta Ads 2026')).toBeVisible();
  await page.getByRole('button', { name: /Calcolatore offerte B2B/ }).click();
  await expect(page.getByRole('button', { name: /Aggiungi prodotto/ })).toBeVisible();
});

test('verifica: SEO generator builds a title', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /Verifica/ }).click();
  await page.locator('.todocard').first().click();
  await page.locator('input.txt').nth(0).fill('Lea Bag');
  await page.locator('input.txt').nth(1).fill('Cocco Nero');
  await page.getByRole('button', { name: 'genera', exact: true }).click();
  await expect(page.locator('input.txt').last()).toHaveValue(/AMIMI/);
});


