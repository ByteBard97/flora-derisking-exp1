#!/usr/bin/env node
/**
 * Renderer Comparison benchmark — tests raw-svg and pixi renderers in a single
 * browser session and writes combined results to benchmark/results.json.
 *
 * Usage:
 *   node benchmark/run.mjs [--url http://localhost:5210] [--reps 5] [--out benchmark/results.json]
 *
 * Requires the app to expose:
 *   window.__flora__.getRenderer()        → 'raw-svg' | 'pixi'
 *   window.__flora__.setRenderer(name)
 *   window.__flora__.setPanMode(mode)     (raw-svg only)
 *   window.__flora__.setPlantCount(n)
 *   window.__flora__.runBenchmarkScenario({ durationMs, movementType, zoomLevel })
 *   window.__flora_editor__.__rendererName  (set after renderer switch completes)
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------- CLI args ----------

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? true];
    })
);

const BASE_URL    = args.url  ?? 'http://localhost:5210';
const REPS        = parseInt(args.reps ?? '5', 10);
const OUT_PATH    = args.out  ?? new URL('results.json', import.meta.url).pathname;
const DURATION_MS = 5000;

// ---------- Scenario matrix ----------

const scenarios = [];

// Raw SVG — container mode: baseline (all plant counts × movement types) + zoom sweep
for (const plantCount of [50, 100, 200, 300]) {
  for (const movementType of ['still', 'pan', 'zoom']) {
    scenarios.push({ renderer: 'raw-svg', panMode: 'container', plantCount, zoomLevel: 0.08, movementType });
  }
}
for (const zoomLevel of [0.08, 0.3, 1.0, 3.0]) {
  for (const movementType of ['still', 'pan']) {
    scenarios.push({ renderer: 'raw-svg', panMode: 'container', plantCount: 300, zoomLevel, movementType });
  }
}

// Raw SVG — per-shape mode (key comparison scenarios only)
for (const zoomLevel of [0.08, 0.3]) {
  for (const movementType of ['still', 'pan']) {
    scenarios.push({ renderer: 'raw-svg', panMode: 'per-shape', plantCount: 300, zoomLevel, movementType });
  }
}

// Pixi — baseline (all plant counts × movement types) + zoom sweep
for (const plantCount of [50, 100, 200, 300]) {
  for (const movementType of ['still', 'pan', 'zoom']) {
    scenarios.push({ renderer: 'pixi', panMode: null, plantCount, zoomLevel: 0.08, movementType });
  }
}
for (const zoomLevel of [0.08, 0.3, 1.0, 3.0]) {
  for (const movementType of ['still', 'pan']) {
    scenarios.push({ renderer: 'pixi', panMode: null, plantCount: 300, zoomLevel, movementType });
  }
}

// ---------- Helpers ----------

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (s.length - 1));
  return s[idx];
}

function frameTimesToFPS(frameTimes) {
  const valid = frameTimes.filter(t => t > 0 && t < 500);
  if (!valid.length) return { fps: 0, p50: 0, p95: 0, p5: 0 };
  const medMs = median(valid);
  return {
    fps: Math.round(1000 / medMs * 10) / 10,
    p50: Math.round(medMs * 10) / 10,
    p95: Math.round(percentile(valid, 95) * 10) / 10,
    p5:  Math.round(percentile(valid, 5) * 10) / 10,
  };
}

// ---------- Wait helpers ----------

async function waitForReady(page, timeoutMs = 30000) {
  await page.waitForFunction(() => {
    const f = window.__flora__;
    const e = window.__flora_editor__;
    return f && e && typeof f.runBenchmarkScenario === 'function';
  }, { timeout: timeoutMs });
}

async function waitForRenderer(page, name, timeoutMs = 15000) {
  await page.waitForFunction((name) => {
    return window.__flora_editor__?.__rendererName === name;
  }, name, { timeout: timeoutMs });
  // Extra settle time for Pixi font loading
  await page.waitForTimeout(name === 'pixi' ? 1500 : 500);
}

// ---------- Run one rep ----------

let currentRenderer = null;

async function runRep(page, scenario) {
  const { renderer, panMode, plantCount, zoomLevel, movementType } = scenario;

  // Switch renderer if needed (avoid redundant switches)
  if (currentRenderer !== renderer) {
    await page.evaluate((r) => window.__flora__.setRenderer(r), renderer);
    await waitForRenderer(page, renderer);
    currentRenderer = renderer;
  }

  // Set pan mode (raw-svg only)
  if (renderer === 'raw-svg' && panMode) {
    await page.evaluate((m) => window.__flora__.setPanMode(m), panMode);
    await page.waitForTimeout(200);
  }

  // Configure plant count
  await page.evaluate((n) => window.__flora__.setPlantCount(n), plantCount);
  await page.waitForTimeout(800);

  // Run scenario
  const frameTimes = await page.evaluate(
    ({ durationMs, movementType, zoomLevel }) =>
      window.__flora__.runBenchmarkScenario({ durationMs, movementType, zoomLevel }),
    { durationMs: DURATION_MS, movementType, zoomLevel }
  );

  return frameTimesToFPS(frameTimes);
}

// ---------- Main ----------

async function main() {
  const estMinutes = Math.ceil(scenarios.length * REPS * (DURATION_MS + 1000) / 60000);

  console.log(`\nRenderer Comparison Benchmark`);
  console.log(`URL:       ${BASE_URL}`);
  console.log(`Reps:      ${REPS}`);
  console.log(`Scenarios: ${scenarios.length}`);
  console.log(`Est. time: ~${estMinutes} min\n`);

  // On-screen — no --window-position offset — for valid rAF timing with WebGL.
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') console.error('[page error]', msg.text());
  });

  await page.goto(BASE_URL);
  await waitForReady(page);
  console.log('App ready.\n');

  const results = [];
  let done = 0;

  for (const scenario of scenarios) {
    const reps = [];
    for (let r = 0; r < REPS; r++) {
      const stats = await runRep(page, scenario);
      reps.push(stats);
      process.stdout.write('.');
    }

    const agg = {
      fps: Math.round(median(reps.map(r => r.fps)) * 10) / 10,
      p50: Math.round(median(reps.map(r => r.p50)) * 10) / 10,
      p95: Math.round(median(reps.map(r => r.p95)) * 10) / 10,
      p5:  Math.round(median(reps.map(r => r.p5)) * 10) / 10,
    };

    results.push({ ...scenario, reps, agg });
    done++;
    console.log(
      ` [${done}/${scenarios.length}] renderer=${scenario.renderer}` +
      ` z=${scenario.zoomLevel} move=${scenario.movementType} n=${scenario.plantCount}` +
      ` → ${agg.fps} fps (p95: ${agg.p95}ms)`
    );
  }

  await browser.close();

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({
    meta: { date: new Date().toISOString(), reps: REPS, durationMs: DURATION_MS },
    results,
  }, null, 2));
  console.log(`\nResults written to ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
