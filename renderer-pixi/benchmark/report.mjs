#!/usr/bin/env node
/**
 * Generates an HTML report from benchmark/results.json.
 *
 * Usage:
 *   node benchmark/report.mjs [--in benchmark/results.json] [--out benchmark/report.html]
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('='); return [k, v ?? true];
  })
);

const IN_PATH  = args.in  ?? new URL('results.json', import.meta.url).pathname;
const OUT_PATH = args.out ?? new URL('report.html',  import.meta.url).pathname;

const { meta, results } = JSON.parse(readFileSync(IN_PATH, 'utf8'));

// ---------- Group helpers ----------

function group(results, key) {
  const map = new Map();
  for (const r of results) {
    const k = r[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

function filterBy(results, pred) { return results.filter(pred); }

// ---------- Chart data builders ----------

const COLORS = {
  50:   '#4ade80',
  100:  '#22d3ee',
  200:  '#f59e0b',
  300:  '#f87171',
  still:'#60a5fa',
  pan:  '#f472b6',
  zoom: '#a78bfa',
};

function barChartConfig(title, labels, datasets) {
  return {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: title, color: '#e5e7eb', font: { size: 14 } },
        legend: { labels: { color: '#9ca3af' } },
      },
      scales: {
        x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
        y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' }, title: { display: true, text: 'FPS', color: '#9ca3af' } },
      },
    },
  };
}

// Chart 1: FPS vs plant count, grouped by movement type (zoom=0.08)
function chart_plants_vs_fps() {
  const base = filterBy(results, r => r.zoomLevel === 0.08);
  const byMove = group(base, 'movementType');
  const labels = [50, 100, 200, 300].map(String);
  const datasets = [];
  for (const [move, rows] of byMove) {
    datasets.push({
      label: `movement: ${move}`,
      backgroundColor: COLORS[move] ?? '#fff',
      data: [50, 100, 200, 300].map(n => rows.find(r => r.plantCount === n)?.agg.fps ?? null),
    });
  }
  return barChartConfig('FPS vs Plant Count (zoom 0.08)', labels, datasets);
}

// Chart 2: FPS vs zoom level, pan vs still (300 plants)
function chart_zoom_vs_fps() {
  const base = filterBy(results, r => r.plantCount === 300);
  const byMove = group(base, 'movementType');
  const labels = [0.08, 0.3, 1.0, 3.0].map(String);
  const datasets = [];
  for (const [move, rows] of byMove) {
    datasets.push({
      label: `movement: ${move}`,
      backgroundColor: COLORS[move] ?? '#fff',
      data: [0.08, 0.3, 1.0, 3.0].map(z => rows.find(r => r.zoomLevel === z)?.agg.fps ?? null),
    });
  }
  return barChartConfig('FPS vs Zoom Level (300 plants)', labels, datasets);
}

// Chart 3: Movement type comparison (300 plants, zoom 0.08)
function chart_movement_vs_fps() {
  const base = filterBy(results, r => r.plantCount === 300 && r.zoomLevel === 0.08);
  const labels = ['still', 'pan', 'zoom'];
  return barChartConfig('Movement Type Comparison (300 plants, zoom 0.08)', labels, [{
    label: 'FPS',
    backgroundColor: labels.map(m => COLORS[m] ?? '#fff'),
    data: labels.map(m => base.find(r => r.movementType === m)?.agg.fps ?? null),
  }]);
}

// Chart 4: p95 frame time (worst-frame latency) vs plant count, pan only
function chart_p95_latency() {
  const base = filterBy(results, r => r.zoomLevel === 0.08 && r.movementType === 'pan');
  const labels = [50, 100, 200, 300].map(String);
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'p95 frame time (ms)',
        backgroundColor: '#f59e0b',
        data: [50, 100, 200, 300].map(n => base.find(r => r.plantCount === n)?.agg.p95 ?? null),
      }],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'p95 Frame Time vs Plant Count (pan, zoom 0.08)', color: '#e5e7eb', font: { size: 14 } },
        legend: { labels: { color: '#9ca3af' } },
      },
      scales: {
        x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
        y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' }, title: { display: true, text: 'ms', color: '#9ca3af' } },
      },
    },
  };
}

// ---------- Summary table ----------

function summaryRows() {
  return results.map(r => `
    <tr>
      <td>${r.plantCount}</td>
      <td>${r.zoomLevel}</td>
      <td>${r.movementType}</td>
      <td>${r.agg.fps}</td>
      <td>${r.agg.p50}</td>
      <td>${r.agg.p95}</td>
      <td>${r.agg.p5}</td>
    </tr>`).join('');
}

// ---------- HTML ----------

const charts = [chart_plants_vs_fps(), chart_zoom_vs_fps(), chart_movement_vs_fps(), chart_p95_latency()];
const chartIds = charts.map((_, i) => `chart${i}`);

// Key comparison scenario: 300 plants, z=0.08, pan
const keyScenario = results.find(r => r.plantCount === 300 && r.zoomLevel === 0.08 && r.movementType === 'pan');
const pixiFps = keyScenario ? `${keyScenario.agg.fps} fps` : 'fill in after running benchmark';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>renderer-pixi Benchmark Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #111827; color: #e5e7eb; font-family: system-ui, sans-serif; padding: 24px; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .meta { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(560px, 1fr)); gap: 24px; margin-bottom: 32px; }
    .card { background: #1f2937; border-radius: 8px; padding: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 6px 10px; border-bottom: 1px solid #374151; text-align: right; }
    th { color: #9ca3af; text-align: right; }
    td:nth-child(3), th:nth-child(3) { text-align: left; }
    tr:hover td { background: #374151; }
    .note { color: #6b7280; font-size: 12px; margin-top: 12px; }
    .comparison { background: #1f2937; border-radius: 8px; padding: 20px; margin-bottom: 32px; }
    .comparison h2 { font-size: 14px; color: #9ca3af; margin-bottom: 12px; }
    .comparison table { max-width: 480px; }
    .comparison td, .comparison th { text-align: left; }
    .comparison .pixi { color: #4ade80; font-weight: bold; }
    .comparison .note { margin-top: 10px; font-style: italic; }
  </style>
</head>
<body>
  <h1>renderer-pixi Benchmark Report</h1>
  <div class="meta">Run: ${meta.ts} · URL: ${meta.url} · ${meta.reps} reps × ${meta.durationMs / 1000}s · ${results.length} scenarios</div>

  <!-- Pixi vs tldraw comparison callout -->
  <div class="comparison">
    <h2>Pixi vs tldraw comparison — key scenario (300 plants, z=0.08, pan)</h2>
    <table>
      <thead><tr><th>Renderer</th><th>FPS (median)</th></tr></thead>
      <tbody>
        <tr><td>tldraw (experiment-2)</td><td>42 fps</td></tr>
        <tr><td class="pixi">Pixi.js v8 (this run)</td><td class="pixi">${pixiFps}</td></tr>
      </tbody>
    </table>
    <div class="note">Note: Fill in actual Pixi result after running benchmark. tldraw baseline is from experiment-2 measurements.</div>
  </div>

  <div class="grid">
    ${charts.map((cfg, i) => `<div class="card"><canvas id="${chartIds[i]}"></canvas></div>`).join('\n    ')}
  </div>

  <div class="card">
    <h2 style="font-size:14px;color:#9ca3af;margin-bottom:12px;">All Results</h2>
    <table>
      <thead><tr>
        <th>Plants</th><th>Zoom</th><th>Movement</th>
        <th>FPS (med)</th><th>p50 frame</th><th>p95 frame</th><th>p5 frame</th>
      </tr></thead>
      <tbody>${summaryRows()}</tbody>
    </table>
    <div class="note">FPS = median across reps. Frame times in ms. p95 = worst-case frame latency (jank). p5 = best-case.</div>
  </div>

  <script>
    const configs = ${JSON.stringify(charts)};
    configs.forEach((cfg, i) => {
      new Chart(document.getElementById('chart' + i), cfg);
    });
  </script>
</body>
</html>`;

writeFileSync(OUT_PATH, html);
console.log(`Report written to ${OUT_PATH}`);
