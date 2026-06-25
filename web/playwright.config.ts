import { defineConfig } from '@playwright/test';

// E2E against the real production build (vite preview), hitting the live Supabase replica.
export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  expect: { timeout: 15000 },
  retries: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173/amimi-app/', headless: true },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/amimi-app/',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
