import type { Scenario } from 'myopex/src/scenarios';

const BASE = 'http://localhost:5174';

async function waitForCanvas(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const f = (window as any).__flora__;
      return f && f.getPlantCount() === 300 && f.getKonvaNodeCount() >= 300;
    },
    { timeout: 15_000 },
  );
}

const scenarios: Scenario[] = [
  {
    name: 'initial-load',
    url: BASE,
    setup: waitForCanvas,
    settleMs: 1000,
  },
  {
    name: 'self-test-open',
    url: BASE,
    setup: async (page) => {
      await waitForCanvas(page);
      await page.click('button');
      await page.waitForTimeout(300);
    },
    settleMs: 500,
  },
  {
    name: 'self-test-after-run',
    url: BASE,
    setup: async (page) => {
      await waitForCanvas(page);
      await page.click('button'); // open panel
      await page.waitForTimeout(200);
      // Click the "Run automated tests" button (second button inside the panel)
      const buttons = page.locator('button');
      await buttons.nth(1).click();
      // Wait for all tests to complete — M1 takes 3s
      await page.waitForTimeout(12_000);
    },
    settleMs: 500,
  },
];

export default scenarios;
