import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => {
  const f = window.__flora__;
  const e = window.__flora_editor__;
  return f && e && typeof f.runBenchmarkScenario === 'function';
}, { timeout: 30000 });
await page.screenshot({ path: '/tmp/renderer-comparison-raw-svg.png', fullPage: false });
const shapeCount = await page.evaluate(() => window.__flora__.getShapeCount());
console.log('SVG shape count:', shapeCount);
console.log('SVG errors:', errors);

await page.evaluate(() => window.__flora__.setRenderer('pixi'));
await page.waitForFunction(() => window.__flora_editor__?.__rendererName === 'pixi', { timeout: 10000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/renderer-comparison-pixi.png', fullPage: false });
const shapeCount2 = await page.evaluate(() => window.__flora__.getShapeCount());
console.log('Pixi shape count:', shapeCount2);
console.log('Pixi errors:', errors);
await browser.close();
