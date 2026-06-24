import { test, expect } from '@playwright/test';

// Unique marker so the spawned count row can be cleaned up afterwards.
const NOTA = 'E2E_TEST_' + Date.now();

test('dashboard renders the validated P&L', async ({ page }) => {
  await page.goto('');
  await expect(page.getByText('Conto Economico mensile')).toBeVisible();
  await expect(page.getByText('Fatturato Netto 2026')).toBeVisible();
  // at least one month row with a euro value
  await expect(page.locator('table tbody tr').first()).toBeVisible();
});

test('ingestion: pick a product, enter a count, submit, see success', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /Inserisci/ }).click();
  await page.getByPlaceholder('PIN').fill('amimi2026');
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

test('ingestion: wrong PIN is rejected by the server', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /Inserisci/ }).click();
  await page.getByPlaceholder('PIN').fill('wrong-pin');
  await page.getByRole('button', { name: /Conta fisica/ }).click();
  await page.getByPlaceholder('Cerca prodotto').fill('lea bag black');
  await page.locator('.pcard').first().click();
  await page.locator('input.num').fill('3');
  await page.getByRole('button', { name: /Salva conta/ }).click();
  await expect(page.locator('.msg.err')).toContainText(/PIN errato/);
});
