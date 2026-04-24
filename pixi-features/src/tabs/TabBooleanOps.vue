<script setup lang="ts">
/**
 * Boolean Ops derisking fixture.
 * Tests: polygon-clipping (martinez), bezier→polyline flattening via bezier-js getLUT().
 * Shows the actual Flora use case: bezier bed paths → union/intersect/difference.
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics } from 'pixi.js';
import { Bezier } from 'bezier-js';
import polygonClipping from 'polygon-clipping';
import { useFps } from '../shared/useFps';

type AnchorType = 'smooth' | 'corner';
interface BNode { x: number; y: number; hox: number; hoy: number; hix: number; hiy: number; type: AnchorType; }
type OpMode = 'none' | 'union' | 'intersection' | 'difference';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();
const op = ref<OpMode>('none');
const flattenSamples = ref(20);
const resultInfo = ref('');

// Two preset closed bezier beds (world coords centered around 0,0)
const BED_A: BNode[] = [
  { x: -150, y: -80,  hox: 0,   hoy: -90, hix: 0,   hiy: 90,  type: 'smooth' },
  { x: 20,   y: -160, hox: 90,  hoy: 0,   hix: -90, hiy: 0,   type: 'smooth' },
  { x: 60,   y: 60,   hox: 0,   hoy: 80,  hix: 0,   hiy: -80, type: 'smooth' },
  { x: -120, y: 100,  hox: -70, hoy: 0,   hix: 70,  hiy: 0,   type: 'smooth' },
];

const BED_B: BNode[] = [
  { x: 80,   y: -100, hox: 0,   hoy: -80, hix: 0,   hiy: 80,  type: 'smooth' },
  { x: 220,  y: -60,  hox: 80,  hoy: 0,   hix: -80, hiy: 0,   type: 'smooth' },
  { x: 200,  y: 120,  hox: 0,   hoy: 80,  hix: 0,   hiy: -80, type: 'smooth' },
  { x: 30,   y: 140,  hox: -80, hoy: 0,   hix: 80,  hiy: 0,   type: 'smooth' },
];

let app = markRaw({} as Application);
let baseGfx   = markRaw({} as Graphics);
let resultGfx = markRaw({} as Graphics);
let camX = 0, camY = 0, zoom = 1;
let isPanning = false, panStart = { x: 0, y: 0 };

// Flatten a closed bezier bed to a ring of [x,y] pairs (for polygon-clipping)
function flattenBed(nodes: BNode[], samples: number): [number, number][] {
  const pts: [number, number][] = [];
  const n = nodes.length;
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % n];
    const bez = new Bezier(
      a.x, a.y,
      a.x + a.hox, a.y + a.hoy,
      b.x + b.hix, b.y + b.hiy,
      b.x, b.y,
    );
    const lut = bez.getLUT(samples);
    // Skip last point (it's the next segment's first)
    for (let j = 0; j < lut.length - 1; j++) {
      pts.push([lut[j].x, lut[j].y]);
    }
  }
  pts.push(pts[0]); // close ring
  return pts;
}

function drawBed(g: Graphics, nodes: BNode[], fillColor: number, fillAlpha: number, strokeColor: number) {
  const n = nodes.length;
  if (n < 2) return;

  // Fill pass
  g.setFillStyle({ color: fillColor, alpha: fillAlpha });
  g.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i <= n; i++) {
    const a = nodes[(i - 1) % n];
    const b = nodes[i % n];
    g.bezierCurveTo(a.x + a.hox, a.y + a.hoy, b.x + b.hix, b.y + b.hiy, b.x, b.y);
  }
  g.closePath().fill();

  // Stroke pass (re-draw path)
  g.setStrokeStyle({ width: 2, color: strokeColor });
  g.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i <= n; i++) {
    const a = nodes[(i - 1) % n];
    const b = nodes[i % n];
    g.bezierCurveTo(a.x + a.hox, a.y + a.hoy, b.x + b.hix, b.y + b.hiy, b.x, b.y);
  }
  g.closePath().stroke();
}

function drawResult(g: Graphics, result: polygonClipping.MultiPolygon) {
  g.clear();
  if (result.length === 0) { resultInfo.value = '(empty result)'; return; }

  let totalPts = 0;
  g.setFillStyle({ color: 0xffee44, alpha: 0.75 });
  for (const polygon of result) {
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      totalPts += ring.length;
      g.moveTo(ring[0][0], ring[0][1]);
      for (let i = 1; i < ring.length; i++) g.lineTo(ring[i][0], ring[i][1]);
      g.closePath();
    }
  }
  g.fill();

  g.setStrokeStyle({ width: 2, color: 0xffcc00 });
  for (const polygon of result) {
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      g.moveTo(ring[0][0], ring[0][1]);
      for (let i = 1; i < ring.length; i++) g.lineTo(ring[i][0], ring[i][1]);
      g.closePath();
    }
  }
  g.stroke();

  resultInfo.value = `${result.length} polygon(s) · ${totalPts} pts (flattened from bezier at ${flattenSamples.value} samples/seg)`;
}

function runOp() {
  resultGfx.clear();
  baseGfx.clear();

  if (op.value === 'none') {
    drawBed(baseGfx, BED_A, 0x4488ff, 0.45, 0x4488ff);
    drawBed(baseGfx, BED_B, 0x44cc88, 0.45, 0x44cc88);
    resultInfo.value = '';
    return;
  }

  // Draw originals faded
  drawBed(baseGfx, BED_A, 0x4488ff, 0.15, 0x223355);
  drawBed(baseGfx, BED_B, 0x44cc88, 0.15, 0x225533);

  // Flatten bezier beds to polylines
  const t0 = performance.now();
  const ringA = flattenBed(BED_A, flattenSamples.value);
  const ringB = flattenBed(BED_B, flattenSamples.value);
  const polyA: polygonClipping.Polygon = [ringA];
  const polyB: polygonClipping.Polygon = [ringB];

  let result: polygonClipping.MultiPolygon;
  try {
    if (op.value === 'union')        result = polygonClipping.union([polyA], [polyB]);
    else if (op.value === 'intersection') result = polygonClipping.intersection([polyA], [polyB]);
    else                             result = polygonClipping.difference([polyA], [polyB]);
  } catch (err) {
    resultInfo.value = `Error: ${err}`;
    return;
  }
  const elapsed = (performance.now() - t0).toFixed(1);
  drawResult(resultGfx, result);
  resultInfo.value += ` · ${elapsed}ms`;
}

function onSamplesChange() {
  if (op.value !== 'none') runOp();
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const rect = canvasEl.value!.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const wx = (sx - camX) / zoom, wy = (sy - camY) / zoom;
  zoom = Math.max(0.1, Math.min(20, zoom * factor));
  camX = sx - wx * zoom; camY = sy - wy * zoom;
  app.stage.position.set(camX, camY);
  app.stage.scale.set(zoom);
}
function onPD(e: PointerEvent) {
  isPanning = true;
  panStart = { x: e.clientX - camX, y: e.clientY - camY };
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}
function onPM(e: PointerEvent) {
  if (!isPanning) return;
  camX = e.clientX - panStart.x; camY = e.clientY - panStart.y;
  app.stage.position.set(camX, camY);
}
function onPU() { isPanning = false; }

onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas, width: canvas.clientWidth, height: canvas.clientHeight,
    antialias: true, backgroundAlpha: 0, resolution: devicePixelRatio, autoDensity: true,
  });

  camX = canvas.clientWidth / 2 - 40;
  camY = canvas.clientHeight / 2;
  app.stage.position.set(camX, camY);

  baseGfx   = markRaw(new Graphics());
  resultGfx = markRaw(new Graphics());
  app.stage.addChild(baseGfx, resultGfx);

  runOp();

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'boolean-ops',
      getSnapshot: () => ({
        operation: op.value,
        samplesPerSegment: flattenSamples.value,
        hasResult: op.value !== 'none' && resultInfo.value.length > 0,
        resultInfo: resultInfo.value,
      }),
    })
  }

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPD);
  window.addEventListener('pointermove', onPM);
  window.addEventListener('pointerup', onPU);
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined
  window.__pixiTestBridgeReady = false
  canvasEl.value?.removeEventListener('wheel', onWheel);
  canvasEl.value?.removeEventListener('pointerdown', onPD);
  window.removeEventListener('pointermove', onPM);
  window.removeEventListener('pointerup', onPU);
  app?.destroy(true, { children: true, texture: true, context: true });
});
</script>

<template>
  <div class="wrap">
    <canvas ref="canvasEl" />
    <div class="hud">
      <div class="fps">{{ fps }} <span>fps</span></div>
      <div>{{ frameMs }} ms</div>
    </div>
    <div class="controls">
      <div class="op-row">
        <button :class="{ active: op === 'none' }"         @click="op = 'none'; runOp()">Show Both</button>
        <button :class="{ active: op === 'union' }"        @click="op = 'union'; runOp()">Union</button>
        <button :class="{ active: op === 'intersection' }" @click="op = 'intersection'; runOp()">Intersect</button>
        <button :class="{ active: op === 'difference' }"   @click="op = 'difference'; runOp()">Difference A−B</button>
      </div>
      <div class="samples-row">
        <label>Samples/seg: {{ flattenSamples }}</label>
        <input type="range" v-model.number="flattenSamples" min="5" max="100" step="5" @input="onSamplesChange" />
      </div>
    </div>
    <div v-if="resultInfo" class="result-info">{{ resultInfo }}</div>
    <div class="legend">
      <div><span class="sq" style="background:#4488ff" /> Bed A (bezier)</div>
      <div><span class="sq" style="background:#44cc88" /> Bed B (bezier)</div>
      <div><span class="sq" style="background:#ffee44" /> Result (polyline)</div>
    </div>
    <div class="hint"><kbd>drag</kbd> pan · <kbd>scroll</kbd> zoom</div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #0f0f12; }
canvas { display: block; width: 100%; height: 100%; cursor: grab; }
canvas:active { cursor: grabbing; }
.hud { position: absolute; top: 10px; left: 10px; font-family: monospace; font-size: 12px; color: #0f0; line-height: 1.7; pointer-events: none; }
.fps { font-size: 18px; font-weight: bold; }
.fps span { font-size: 12px; color: #0a0; }
.controls {
  position: absolute; top: 10px; right: 10px;
  display: flex; flex-direction: column; gap: 8px;
  font-family: monospace; font-size: 12px; color: #bbb;
  background: rgba(0,0,0,0.65); padding: 10px 14px; border-radius: 4px;
}
.op-row { display: flex; gap: 6px; flex-wrap: wrap; }
.samples-row { display: flex; align-items: center; gap: 8px; }
input[type=range] { width: 100px; }
button {
  background: #2a2a2a; color: #888; border: 1px solid #444;
  border-radius: 3px; padding: 4px 10px; cursor: pointer;
  font-family: monospace; font-size: 11px;
}
button.active { background: #0070e0; color: #fff; border-color: #0070e0; }
button:hover:not(.active) { background: #333; color: #bbb; }
.result-info {
  position: absolute; bottom: 40px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #ffdd88;
  background: rgba(0,0,0,0.6); padding: 4px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
.legend {
  position: absolute; bottom: 10px; left: 10px;
  font-family: monospace; font-size: 11px; color: #777; line-height: 1.8;
  pointer-events: none;
}
.legend .sq { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; }
.hint {
  position: absolute; bottom: 10px; right: 10px;
  font-family: monospace; font-size: 11px; color: #444;
  pointer-events: none;
}
kbd { background: #333; border: 1px solid #555; border-radius: 3px; padding: 1px 5px; font-size: 10px; color: #bbb; }
</style>
