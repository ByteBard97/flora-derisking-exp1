import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'src/__tests__/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    // Chrome only — we use performance.memory which is Chrome-specific
    channel: 'chrome',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  reporter: [
    ['list'],
    ['json', { outputFile: '../measurements/exp-1/playwright-results.json' }],
  ],
  projects: [{ name: 'chromium', use: { channel: 'chrome' } }],
});
