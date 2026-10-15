import { defineConfig } from '@playwright/test';

// E2E against the real production build (vite preview), hitting the live Supabase replica.
// E2E_PORT: con piu' worktree aperti la 4173 puo' essere gia' occupata dalla preview di un'ALTRA sessione, e
// reuseExistingServer la riusa in silenzio: i test girano sulla build sbagliata (successo il 15-10). Porta propria
// per worktree, es. E2E_PORT=4199 npx playwright test.
const PORT = Number(process.env.E2E_PORT || 4173);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error(`E2E_PORT non valido: '${process.env.E2E_PORT}'`);

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  expect: { timeout: 15000 },
  retries: 1,
  // in CI un test.only dimenticato farebbe saltare tutti gli altri restando verde (CASI_APERTI n.37)
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}/amimi-app/`, headless: true },
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/amimi-app/`,
    // in locale la preview la avvia Playwright: con la porta gia' presa --strictPort fallisce rumorosamente, invece di
    // riusare in silenzio la build di un altro worktree (15-10). In CI non c'e' nessuna preview da riusare.
    reuseExistingServer: !!process.env.CI,
    timeout: 60000,
  },
});
