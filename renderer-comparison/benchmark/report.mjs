#!/usr/bin/env node
/**
 * Generates an HTML comparison report from benchmark/results.json.
 *
 * Usage:
 *   node benchmark/report.mjs [--in benchmark/results.json] [--out benchmark/report.html]
 */

import { readFileSync, writeFileSync } from 'fs';

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('='); return [k, v ?? true];
  })
);

const IN_PATH  = args.in  ?? new URL('results.json', import.meta.url).pathname;
const OUT_PATH = args.out ?? new URL('report.html',  import.meta.url).pathname;

const { meta, results } = JSON.parse(readFileSync(IN_PATH, 'utf8'));

// ---------- Lookup helpers ----------

function find(renderer, panMode, plantCount, zoomLevel, movementType) {
  return results.find(r =>
    r.renderer === renderer &&
    r.panMode === panMode &&
    r.plantCount === plantCount &&
    r.zoomLevel === zoomLevel &&
    r.movementType === movementType
  );
}

function fps(renderer, panMode, plantCount, zoomLevel, movementType) {
  return find(renderer, panMode, plantCount, zoomLevel, movementType)?.agg.fps ?? null;
}

// ---------- Key scenario values ----------

const KEY_PLANT_COUNT  = 300;
const KEY_ZOOM         = 0.08;
const KEY_MOVEMENT     = 'pan';
const TLDRAW_REFERENCE = 42;

const fpsRawContainer = fps('raw-svg', 'container', KEY_PLANT_COUNT, KEY_ZOOM, KEY_MOVEMENT);
const fpsRawPerShape  = fps('raw-svg', 'per-shape', KEY_PLANT_COUNT, KEY_ZOOM, KEY_MOVEMENT);
const fpsPixi         = fps('pixi', null, KEY_PLANT_COUNT, KEY_ZOOM, KEY_MOVEMENT);

function fmtFps(v) { return v !== null ? `${v} fps` : '—'; }

// ---------- Chart data builders ----------

const DARK = {
  bg:       '#111827',
  card:     '#1f2937',
  border:   '#374151',
  text:     '#e5e7eb',
  muted:    '#9ca3af',
  dimmed:   '#6b7280',
};

const COLORS = {
  rawContainer: '#f59e0b',
  rawPerShape:  '#22d3ee',
  pixi:         '#4ade80',
  tldraw:       '#f87171',
};

const ZOOM_LEVELS  = [0.08, 0.3, 1.0, 3.0];
const PLANT_COUNTS = [50, 100, 200, 300];

// Chart 1: Bar chart — key scenario comparison (4 bars)
function chart_key_comparison() {
  return {
    type: 'bar',
    data: {
      labels: ['tldraw (exp-2 ref)', 'raw-svg / container', 'raw-svg / per-shape', 'pixi'],
      datasets: [{
        label: 'FPS at z=0.08, pan, 300 plants',
        backgroundColor: [COLORS.tldraw, COLORS.rawContainer, COLORS.rawPerShape, COLORS.pixi],
        data: [TLDRAW_REFERENCE, fpsRawContainer, fpsRawPerShape, fpsPixi],
      }],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'The Key Question: FPS at z=0.08 pan, 300 plants', color: DARK.text, font: { size: 14 } },
        legend: { display: false },
      },
      scales: {
        x: { ticks: { color: DARK.muted }, grid: { color: DARK.border } },
        y: { ticks: { color: DARK.muted }, grid: { color: DARK.border }, title: { display: true, text: 'FPS', color: DARK.muted }, beginAtZero: true },
      },
    },
  };
}

// Chart 2: Line chart — FPS vs plant count, pan at z=0.08 (3 series)
function chart_fps_vs_plants() {
  const labels = PLANT_COUNTS.map(String);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'raw-svg / container',
          borderColor: COLORS.rawContainer,
          backgroundColor: COLORS.rawContainer + '33',
          data: PLANT_COUNTS.map(n => fps('raw-svg', 'container', n, 0.08, 'pan')),
          tension: 0.2,
        },
        {
          label: 'raw-svg / per-shape',
          borderColor: COLORS.rawPerShape,
          backgroundColor: COLORS.rawPerShape + '33',
          data: PLANT_COUNTS.map(n => fps('raw-svg', 'per-shape', n, 0.08, 'pan')),
          tension: 0.2,
        },
        {
          label: 'pixi',
          borderColor: COLORS.pixi,
          backgroundColor: COLORS.pixi + '33',
          data: PLANT_COUNTS.map(n => fps('pixi', null, n, 0.08, 'pan')),
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'FPS vs Plant Count — pan at z=0.08', color: DARK.text, font: { size: 14 } },
        legend: { labels: { color: DARK.muted } },
      },
      scales: {
        x: { ticks: { color: DARK.muted }, grid: { color: DARK.border }, title: { display: true, text: 'Plant count', color: DARK.muted } },
        y: { ticks: { color: DARK.muted }, grid: { color: DARK.border }, title: { display: true, text: 'FPS', color: DARK.muted }, beginAtZero: true },
      },
    },
  };
}

// Chart 3: Line chart — FPS vs zoom, 300 plants, pan (+ tldraw reference lines)
function chart_fps_vs_zoom() {
  const labels = ZOOM_LEVELS.map(String);
  // tldraw reference: 42 fps at z=0.08, 120 fps at z≥0.3
  const tldrawRef = ZOOM_LEVELS.map(z => z >= 0.3 ? 120 : TLDRAW_REFERENCE);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'raw-svg / container',
          borderColor: COLORS.rawContainer,
          backgroundColor: COLORS.rawContainer + '33',
          data: ZOOM_LEVELS.map(z => fps('raw-svg', 'container', 300, z, 'pan')),
          tension: 0.2,
        },
        {
          label: 'pixi',
          borderColor: COLORS.pixi,
          backgroundColor: COLORS.pixi + '33',
          data: ZOOM_LEVELS.map(z => fps('pixi', null, 300, z, 'pan')),
          tension: 0.2,
        },
        {
          label: 'tldraw reference',
          borderColor: COLORS.tldraw,
          borderDash: [6, 4],
          backgroundColor: 'transparent',
          data: tldrawRef,
          pointRadius: 3,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'FPS vs Zoom Level — 300 plants, pan', color: DARK.text, font: { size: 14 } },
        legend: { labels: { color: DARK.muted } },
      },
      scales: {
        x: { ticks: { color: DARK.muted }, grid: { color: DARK.border }, title: { display: true, text: 'Zoom level', color: DARK.muted } },
        y: { ticks: { color: DARK.muted }, grid: { color: DARK.border }, title: { display: true, text: 'FPS', color: DARK.muted }, beginAtZero: true },
      },
    },
  };
}

// Chart 4: Line chart — p95 frame latency vs zoom, raw-svg/container vs pixi
function chart_p95_vs_zoom() {
  const labels = ZOOM_LEVELS.map(String);
  function p95(renderer, panMode, zoomLevel) {
    return find(renderer, panMode, 300, zoomLevel, 'pan')?.agg.p95 ?? null;
  }
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'raw-svg / container p95',
          borderColor: COLORS.rawContainer,
          backgroundColor: COLORS.rawContainer + '33',
          data: ZOOM_LEVELS.map(z => p95('raw-svg', 'container', z)),
          tension: 0.2,
        },
        {
          label: 'pixi p95',
          borderColor: COLORS.pixi,
          backgroundColor: COLORS.pixi + '33',
          data: ZOOM_LEVELS.map(z => p95('pixi', null, z)),
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'p95 Frame Latency vs Zoom — 300 plants, pan', color: DARK.text, font: { size: 14 } },
        legend: { labels: { color: DARK.muted } },
      },
      scales: {
        x: { ticks: { color: DARK.muted }, grid: { color: DARK.border }, title: { display: true, text: 'Zoom level', color: DARK.muted } },
        y: { ticks: { color: DARK.muted }, grid: { color: DARK.border }, title: { display: true, text: 'ms (lower = better)', color: DARK.muted }, beginAtZero: true },
      },
    },
  };
}

// ---------- Summary table ----------

function summaryRows() {
  return results.map(r => `
    <tr>
      <td>${r.renderer}</td>
      <td>${r.panMode ?? '—'}</td>
      <td>${r.plantCount}</td>
      <td>${r.zoomLevel}</td>
      <td>${r.movementType}</td>
      <td>${r.agg.fps}</td>
      <td>${r.agg.p50}</td>
      <td>${r.agg.p95}</td>
      <td>${r.agg.p5}</td>
    </tr>`).join('');
}

// ---------- Assemble HTML ----------

const charts    = [chart_key_comparison(), chart_fps_vs_plants(), chart_fps_vs_zoom(), chart_p95_vs_zoom()];
const chartIds  = charts.map((_, i) => `chart${i}`);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Renderer Comparison — Benchmark Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #111827; color: #e5e7eb; font-family: system-ui, sans-serif; padding: 24px; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .meta { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(560px, 1fr)); gap: 24px; margin-bottom: 32px; }
    .card { background: #1f2937; border-radius: 8px; padding: 20px; }
    .verdict { background: #1f2937; border-radius: 8px; padding: 20px; margin-bottom: 32px; border-left: 4px solid #4ade80; }
    .verdict h2 { font-size: 16px; color: #9ca3af; margin-bottom: 12px; }
    .verdict p { color: #9ca3af; font-size: 13px; margin-bottom: 10px; }
    .verdict table { border-collapse: collapse; min-width: 380px; font-size: 13px; }
    .verdict td { padding: 6px 16px 6px 0; color: #e5e7eb; }
    .verdict td:last-child { text-align: right; font-weight: bold; font-family: monospace; }
    .verdict tr.tldraw td:last-child { color: #f87171; }
    .verdict tr.raw-container td:last-child { color: #f59e0b; }
    .verdict tr.raw-pershape td:last-child { color: #22d3ee; }
    .verdict tr.pixi td:last-child { color: #4ade80; }
    table.results { width: 100%; border-collapse: collapse; font-size: 12px; }
    table.results th, table.results td { padding: 6px 10px; border-bottom: 1px solid #374151; text-align: right; }
    table.results th { color: #9ca3af; }
    table.results td:nth-child(3), table.results th:nth-child(3),
    table.results td:nth-child(5), table.results th:nth-child(5) { text-align: left; }
    table.results tr:hover td { background: #374151; }
    .note { color: #6b7280; font-size: 12px; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>Renderer Comparison — Benchmark Report</h1>
  <div class="meta">Run: ${meta.date} &nbsp;·&nbsp; ${meta.reps} reps × ${meta.durationMs / 1000}s &nbsp;·&nbsp; ${results.length} scenarios</div>

  <!-- Key callout box -->
  <div class="verdict">
    <h2>Bottom Line</h2>
    <p>At z=0.08 (all 300 plants visible), pan fps:</p>
    <table>
      <tr class="tldraw">
        <td>tldraw (exp-2, reference)</td>
        <td>42 fps</td>
      </tr>
      <tr class="raw-container">
        <td>raw-svg / container</td>
        <td id="fps-raw-container">${fmtFps(fpsRawContainer)}</td>
      </tr>
      <tr class="raw-pershape">
        <td>raw-svg / per-shape</td>
        <td id="fps-raw-pershape">${fmtFps(fpsRawPerShape)}</td>
      </tr>
      <tr class="pixi">
        <td>pixi</td>
        <td id="fps-pixi">${fmtFps(fpsPixi)}</td>
      </tr>
    </table>
  </div>

  <!-- Charts -->
  <div class="grid">
    ${charts.map((_, i) => `<div class="card"><canvas id="${chartIds[i]}"></canvas></div>`).join('\n    ')}
  </div>

  <!-- All results table -->
  <div class="card">
    <h2 style="font-size:14px;color:#9ca3af;margin-bottom:12px;">All Results</h2>
    <table class="results">
      <thead><tr>
        <th>Renderer</th><th>Pan mode</th><th>Plants</th><th>Zoom</th><th>Movement</th>
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
  <\/script>
</body>
</html>`;

writeFileSync(OUT_PATH, html);
console.log(`Report written to ${OUT_PATH}`);
