import { test, expect } from '@playwright/test';

// Fase 1 del tool assistenza: la sezione e' READ-ONLY dietro login Supabase Auth.
// Smoke pre-auth: la pagina monta e mostra il cancello di login (nessuna chiamata dati finche'
// non si fa login, quindi nessuna scrittura ne' lettura cs_* qui).
test('assistenza: mostra il cancello di login (nessun dato senza auth)', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /Assistenza clienti/ }).click();
  await expect(page.getByRole('button', { name: /Accedi con Google/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Entra$/ })).toBeVisible();
  // nessuna coda visibile senza login
  await expect(page.getByText('Assistenza', { exact: true })).toHaveCount(0);
});
