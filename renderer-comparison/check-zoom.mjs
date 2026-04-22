import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 800 });

console.log('Navigating to http://localhost:5173/');
await page.goto('http://localhost:5173/');

// Poll for window.__flora__ and window.__flora_editor__ and runBenchmarkScenario
// Note: runBenchmarkScenario lives on window.__flora__, not window directly
console.log('Waiting for window.__flora__ and window.__flora__.runBenchmarkScenario...');
await page.waitForFunction(() => {
  return (
    window.__flora__ &&
    window.__flora_editor__ &&
    typeof window.__flora__.runBenchmarkScenario === 'function'
  );
}, { timeout: 30000 });
console.log('Ready!');

// Switch to pixi renderer
console.log('Switching to pixi renderer...');
await page.evaluate(() => window.__flora__.setRenderer('pixi'));

// Wait for renderer name to be pixi
await page.waitForFunction(() => {
  return window.__flora_editor__.__rendererName === 'pixi';
}, { timeout: 10000 });
console.log('Pixi renderer active!');

// Wait 3 seconds for plants to settle
await page.waitForTimeout(3000);

// Inspect actual plant positions to find where they are
const plantInfo = await page.evaluate(() => {
  const ids = window.__flora__.getPlantIds();
  const positions = ids.slice(0, 10).map(id => ({
    id,
    pos: window.__flora__.getPlantPosition(id),
  }));
  return { count: ids.length, sample: positions };
});
console.log('Plant info:', JSON.stringify(plantInfo, null, 2));

// Compute bounding box of all plants
const bbox = await page.evaluate(() => {
  const ids = window.__flora__.getPlantIds();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const id of ids) {
    const pos = window.__flora__.getPlantPosition(id);
    if (pos) {
      if (pos.x < minX) minX = pos.x;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.y > maxY) maxY = pos.y;
    }
  }
  return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
});
console.log('Plant bounding box:', JSON.stringify(bbox, null, 2));

// setCamera uses tldraw convention: stage.position = camX/Y offset, stage.scale = z
// To center worldX/worldY on screen: camX = screenCenterX - worldX * z
const screenCenterX = 640;
const screenCenterY = 400;

// First take a screenshot at default camera to see if plants render at all
await page.screenshot({ path: '/tmp/svg-ctx-default.png' });
console.log('Default camera screenshot saved to /tmp/svg-ctx-default.png');

// First take a screenshot at default camera to see if plants render at all
await page.screenshot({ path: '/tmp/svg-ctx-default.png' });
console.log('Default camera screenshot saved to /tmp/svg-ctx-default.png');

// Get the canvas bounding rect and current stage state
const stageState = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const rect = canvas ? canvas.getBoundingClientRect() : null;
  return { rect, canvasExists: !!canvas };
});
console.log('Canvas state:', JSON.stringify(stageState));

// Move mouse to center of visible plants area (upper-left in default view)
// then zoom in via wheel
const plantScreenX = stageState.rect.left + 300;
const plantScreenY = stageState.rect.top + 300;
console.log(`Moving mouse to (${plantScreenX}, ${plantScreenY}) and zooming...`);
await page.mouse.move(plantScreenX, plantScreenY);
await page.waitForTimeout(200);

// Simulate wheel zoom in — deltaY < 0 zooms in per the onWheel handler
// The handler uses: newZ = oldZ * (1 - deltaY * 0.001)
// deltaY=-200: newZ = oldZ * 1.2 each step
console.log('Zooming in via wheel events (zoom ~3x)...');
for (let i = 0; i < 20; i++) {
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(50);
}
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/svg-ctx-zoom3.png' });
console.log('Wheel-zoomed ~3x screenshot saved to /tmp/svg-ctx-zoom3.png');

// Zoom in more (~5x total)
for (let i = 0; i < 12; i++) {
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(50);
}
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/svg-ctx-zoom5.png' });
console.log('Further zoomed ~5x screenshot saved to /tmp/svg-ctx-zoom5.png');

await browser.close();
console.log('Done.');
