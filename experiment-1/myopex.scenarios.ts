import type { Scenario } from 'myopex/src/scenarios';

const BASE = 'http://localhost:5173';

// Wait until 300 plants are seeded AND Konva has reconciled all nodes.
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
    settleMs: 2000,
  },
  {
    name: 'plant-selected',
    url: BASE,
    setup: async (page) => {
      await waitForCanvas(page);
      // Click on the first plant's canvas position.
      const pos = await page.evaluate(() => {
        const f = (window as any).__flora__;
        const ids: string[] = f.getPlantIds();
        return ids.length > 0 ? f.getPlantCanvasPos(ids[0]) : null;
      });
      if (pos) {
        const canvas = page.locator('canvas').first();
        const box = await canvas.boundingBox();
        if (box) await page.mouse.click(box.x + pos.x, box.y + pos.y);
      }
      await page.waitForTimeout(300);
    },
    settleMs: 1000,
  },
  {
    name: 'zoomed-in',
    url: BASE,
    setup: async (page) => {
      await waitForCanvas(page);
      // Zoom in 5× via wheel events centred on the canvas.
      const canvas = page.locator('canvas').first();
      const box = await canvas.boundingBox();
      if (box) {
        const cx = box.x + box.width * 0.5;
        const cy = box.y + box.height * 0.5;
        for (let i = 0; i < 5; i++) {
          await page.mouse.wheel(0, -200);
          await page.waitForTimeout(50);
        }
        // Move mouse to canvas centre so hover states are stable.
        await page.mouse.move(cx, cy);
      }
      await page.waitForTimeout(300);
    },
    settleMs: 1000,
  },
];

export default scenarios;
