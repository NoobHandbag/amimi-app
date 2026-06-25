import { test, expect } from '@playwright/test';

// Unique marker so the spawned count row can be cleaned up afterwards.
const NOTA = 'E2E_TEST_' + Date.now();

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
  await page.goto('');
  await page.getByRole('button', { name: /Inserisci/ }).click();
  await page.getByRole('button', { name: /Nuovo prodotto/ }).click();
  await page.getByRole('button', { name: '+ nuovo' }).click();
  await page.getByPlaceholder('es. Lea Bag').fill('E2E Test');
  await page.getByPlaceholder('es. COCCO ROSSO').fill('VARX');
  await expect(page.locator('.codicebox')).toContainText('E2E_Test_VARX');
  await page.getByRole('button', { name: /Crea prodotto/ }).click();
  await expect(page.locator('.msg.ok')).toContainText('Prodotto creato');
});

test('inventory tab lists products', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /Inventario/ }).click();
  await expect(page.getByText('Valore magazzino')).toBeVisible();
  await expect(page.locator('.row').first()).toBeVisible();
});

test('in arrivo: create a supplier order, then mark a partial arrival', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /In arrivo/ }).click();
  await page.getByRole('button', { name: /Nuovo ordine/ }).click();
  await page.getByPlaceholder('Cerca prodotto').fill('lea bag black');
  await page.locator('.pcard').first().click();
  await page.locator('input.num').fill('10');
  await page.getByRole('button', { name: '+ altro' }).click();
  await page.getByPlaceholder('Nome fornitore').fill('E2E_ORD');
  await page.getByRole('button', { name: /Salva ordine/ }).click();

  await expect(page.locator('.ordcard').first()).toBeVisible();
  await page.getByRole('button', { name: /Segna arrivo/ }).first().click();
  await page.locator('.arrrow input.num').fill('4');
  await page.getByRole('button', { name: /Conferma/ }).click();
  await expect(page.locator('.ordnums').first()).toContainText('4/10');
});

