<script setup lang="ts">
/**
 * Snapping derisking fixture.
 * Tests: grid snap, vertex snap, edge snap with visual indicators.
 */
import { ref, onMounted, onUnmounted, markRaw, watch } from 'vue';
import { Application, Graphics, Container, Rectangle } from 'pixi.js';
import { useFps } from '../shared/useFps';
import { snapToGrid, snapToVertex, snapToEdge, type Pt } from '../lib/snapUtils';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();

const snapModes = ref({ grid: true, vertex: true, edge: true });
const snapStrength = ref<'off' | 'permissive' | 'strict'>('permissive');
const snapInfo = ref('');

const pixelsPerFoot = ref(50)      // world px per foot
const gridFeet      = ref(1)       // grid spacing in feet
const thresholdFeet = ref(0.3)     // snap threshold in feet (permissive mode only)

// Static scene: vertices and edges
let VERTS: Pt[] = [
  { x: 160, y: 120 }, { x: 360, y: 100 }, { x: 500, y: 260 },
  { x: 280, y: 340 }, { x: 100, y: 300 }, { x: 420, y: 400 },
];
const EDGES: [Pt, Pt][] = [
  [VERTS[0], VERTS[1]], [VERTS[1], VERTS[2]], [VERTS[2], VERTS[3]],
  [VERTS[3], VERTS[4]], [VERTS[4], VERTS[0]], [VERTS[2], VERTS[5]],
];

let app = markRaw({} as Application);
let gridGfx   = markRaw({} as Graphics);
let staticGfx = markRaw({} as Graphics);
let shapeGfx  = markRaw({} as Graphics);
let snapGfx   = markRaw({} as Graphics);

let camX = 0, camY = 0, zoom = 1;
let shapePos: Pt = { x: 200, y: 200 };
let snapped: Pt | null = null;
let isDragging = false;
let dragOffset: Pt = { x: 0, y: 0 };
let isPanning = false;
let panStart: Pt = { x: 0, y: 0 };
let draggingVertIdx: number = -1;

function screenToWorld(sx: number, sy: number): Pt {
  return { x: (sx - camX) / zoom, y: (sy - camY) / zoom };
}

function applySnap(wx: number, wy: number) {
  snapped = null;
  snapInfo.value = '';
  if (snapStrength.value === 'off') return;

  // Permissive: snap only within threshold (world units) of a target.
  // Strict: snap to nearest target regardless of distance (threshold = Infinity).
  const thresh = snapStrength.value === 'strict' ? Infinity : (thresholdFeet.value * pixelsPerFoot.value);

  if (snapModes.value.vertex) {
    const sv = snapToVertex(wx, wy, VERTS, thresh);
    if (sv) { snapped = sv; snapInfo.value = 'vertex'; return; }
  }
  if (snapModes.value.edge) {
    const se = snapToEdge(wx, wy, EDGES, thresh);
    if (se) { snapped = se; snapInfo.value = 'edge'; return; }
  }
  if (snapModes.value.grid) {
    const sg = snapToGrid(wx, wy, gridPx());
    if (Math.hypot(wx - sg.x, wy - sg.y) < thresh) {
      snapped = sg; snapInfo.value = `grid (${(sg.x / pixelsPerFoot.value).toFixed(2)}ft, ${(sg.y / pixelsPerFoot.value).toFixed(2)}ft)`;
    }
  }
}

function gridPx(): number {
  return pixelsPerFoot.value * gridFeet.value;
}

function drawGrid() {
  gridGfx.clear();
  const gp = gridPx();

  // Screen bounds in world coords (draw only visible area + 1 cell margin)
  const wLeft   = -camX / zoom - gp;
  const wRight  = (canvasEl.value!.clientWidth  - camX) / zoom + gp;
  const wTop    = -camY / zoom - gp;
  const wBottom = (canvasEl.value!.clientHeight - camY) / zoom + gp;

  // Minor lines (1 ft grid) — only when screen spacing > 8px to avoid moiré
  const screenSpacing = gp * zoom;
  if (screenSpacing >= 8) {
    // NO pixelLine — fractional world positions need AA, not integer snapping
    gridGfx.setStrokeStyle({ width: 1, color: 0x2a2a2a, alpha: Math.min(1, (screenSpacing - 8) / 16) });
    const startX = Math.floor(wLeft / gp) * gp;
    const startY = Math.floor(wTop  / gp) * gp;
    for (let x = startX; x <= wRight; x += gp) gridGfx.moveTo(x, wTop).lineTo(x, wBottom);
    for (let y = startY; y <= wBottom; y += gp) gridGfx.moveTo(wLeft, y).lineTo(wRight, y);
    gridGfx.stroke();
  }

  // Major lines (5 ft) — always drawn, slightly brighter
  const majorGp = gp * 5;
  const screenMajorSpacing = majorGp * zoom;
  gridGfx.setStrokeStyle({ width: 1, color: 0x3a3a3a, alpha: Math.min(1, screenMajorSpacing / 40) });
  const startMX = Math.floor(wLeft   / majorGp) * majorGp;
  const startMY = Math.floor(wTop    / majorGp) * majorGp;
  for (let x = startMX; x <= wRight;  x += majorGp) gridGfx.moveTo(x, wTop).lineTo(x, wBottom);
  for (let y = startMY; y <= wBottom; y += majorGp) gridGfx.moveTo(wLeft, y).lineTo(wRight, y);
  gridGfx.stroke();

  // Dots at major intersections (when zoomed in enough)
  if (screenMajorSpacing >= 20) {
    for (let x = startMX; x <= wRight; x += majorGp) {
      for (let y = startMY; y <= wBottom; y += majorGp) {
        gridGfx.beginPath();
        gridGfx.setFillStyle({ color: 0x444444 });
        gridGfx.circle(x, y, 1.5).fill();
      }
    }
  }
}

function drawStatic() {
  staticGfx.clear();
  // Edges
  staticGfx.setStrokeStyle({ width: 1.5, color: 0x3366cc });
  for (const [a, b] of EDGES) staticGfx.moveTo(a.x, a.y).lineTo(b.x, b.y);
  staticGfx.stroke();
  // Vertices — each needs its own path to avoid accumulation
  for (const v of VERTS) {
    staticGfx.beginPath();
    staticGfx.setFillStyle({ color: 0x6699ff });
    staticGfx.setStrokeStyle({ width: 1.5, color: 0xffffff });
    staticGfx.circle(v.x, v.y, 5).fill().stroke();
  }
}

function drawShape() {
  shapeGfx.clear();
  const pos = snapped ?? shapePos;
  const isSnapping = snapped !== null;

  const SIZE = 20;
  shapeGfx.setFillStyle({ color: isSnapping ? 0xffdd00 : 0xff6600, alpha: 0.85 });
  shapeGfx.setStrokeStyle({ width: 2, color: isSnapping ? 0xffff44 : 0xff9900 });
  shapeGfx.rect(pos.x - SIZE, pos.y - SIZE, SIZE * 2, SIZE * 2).fill().stroke();

  // Crosshair at center — batch both lines into one stroke
  shapeGfx.beginPath();
  shapeGfx.setStrokeStyle({ width: 1, color: 0xffffff, alpha: 0.4, pixelLine: true } as any);
  shapeGfx.moveTo(pos.x - 6, pos.y).lineTo(pos.x + 6, pos.y)
          .moveTo(pos.x, pos.y - 6).lineTo(pos.x, pos.y + 6).stroke();

  // Snap indicator
  snapGfx.clear();
  if (snapped) {
    const sz = 14 / zoom;
    snapGfx.setStrokeStyle({ width: 1.5, color: 0xffdd00, pixelLine: true } as any);
    snapGfx.moveTo(snapped.x - sz, snapped.y).lineTo(snapped.x + sz, snapped.y)
            .moveTo(snapped.x, snapped.y - sz).lineTo(snapped.x, snapped.y + sz).stroke();
    // Circle indicator
    snapGfx.beginPath();
    snapGfx.setStrokeStyle({ width: 1, color: 0xffdd00, alpha: 0.5 });
    snapGfx.circle(snapped.x, snapped.y, 18 / zoom).stroke();
  }
}

function onBgPD(e: any) {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true;
    panStart = { x: e.global.x - camX, y: e.global.y - camY };
    return;
  }
  const wp = screenToWorld(e.global.x, e.global.y);
  for (let i = 0; i < VERTS.length; i++) {
    if (Math.hypot(wp.x - VERTS[i].x, wp.y - VERTS[i].y) < 12) {
      draggingVertIdx = i;
      isDragging = false;
      return;
    }
  }
  const SIZE = 20;
  if (Math.abs(wp.x - shapePos.x) < SIZE && Math.abs(wp.y - shapePos.y) < SIZE) {
    isDragging = true;
    dragOffset = { x: wp.x - shapePos.x, y: wp.y - shapePos.y };
  }
}

function onStagePM(e: any) {
  if (draggingVertIdx >= 0) {
    const wp = screenToWorld(e.global.x, e.global.y);
    // Vertex-to-vertex snap is excluded here: it would merge vertices in strict mode
    // and create confusing off-grid pull in permissive mode. Grid + edge only.
    snapped = null;
    snapInfo.value = '';
    if (snapStrength.value !== 'off') {
      const thresh = snapStrength.value === 'strict' ? Infinity : (thresholdFeet.value * pixelsPerFoot.value);
      if (snapModes.value.edge) {
        const se = snapToEdge(wp.x, wp.y, EDGES, thresh);
        if (se) { snapped = se; snapInfo.value = 'edge'; }
      }
      if (!snapped && snapModes.value.grid) {
        const sg = snapToGrid(wp.x, wp.y, gridPx());
        if (Math.hypot(wp.x - sg.x, wp.y - sg.y) < thresh) {
          snapped = sg; snapInfo.value = `grid (${(sg.x / pixelsPerFoot.value).toFixed(2)}ft, ${(sg.y / pixelsPerFoot.value).toFixed(2)}ft)`;
        }
      }
    }
    const pos = snapped ?? wp;
    VERTS[draggingVertIdx].x = pos.x;
    VERTS[draggingVertIdx].y = pos.y;
    snapped = null;
    drawStatic();
    drawShape();
    return;
  }
  if (isPanning) {
    camX = e.global.x - panStart.x;
    camY = e.global.y - panStart.y;
    app.stage.position.set(camX, camY);
    return;
  }
  if (!isDragging) return;
  const wp = screenToWorld(e.global.x, e.global.y);
  shapePos = { x: wp.x - dragOffset.x, y: wp.y - dragOffset.y };
  applySnap(shapePos.x, shapePos.y);
  drawShape();
}

function onStagePU() {
  if (isDragging && snapped) {
    shapePos = { ...snapped };
  }
  snapped = null;
  draggingVertIdx = -1;
  isDragging = false;
  isPanning = false;
  drawShape();
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const rect = canvasEl.value!.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const wx = (sx - camX) / zoom;
  const wy = (sy - camY) / zoom;
  zoom = Math.max(0.1, Math.min(20, zoom * factor));
  camX = sx - wx * zoom;
  camY = sy - wy * zoom;
  app.stage.position.set(camX, camY);
  app.stage.scale.set(zoom);
  drawGrid();
  drawShape(); // refresh snap indicator size (sz = 14/zoom)
}

onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas, width: canvas.clientWidth, height: canvas.clientHeight,
    antialias: true, backgroundAlpha: 0, resolution: devicePixelRatio, autoDensity: true,
  });

  camX = 40; camY = 40;
  app.stage.position.set(camX, camY);
  app.stage.eventMode = 'static';
  app.stage.hitArea = new Rectangle(-10000, -10000, 20000, 20000);

  gridGfx   = markRaw(new Graphics()); gridGfx.eventMode   = 'passive';
  staticGfx = markRaw(new Graphics()); staticGfx.eventMode = 'passive';
  shapeGfx  = markRaw(new Graphics()); shapeGfx.eventMode  = 'passive';
  snapGfx   = markRaw(new Graphics()); snapGfx.eventMode   = 'passive';

  app.stage.addChild(gridGfx, staticGfx, shapeGfx, snapGfx);
  app.stage.on('pointerdown', onBgPD);
  app.stage.on('pointermove', onStagePM);
  app.stage.on('pointerup', onStagePU);
  app.stage.on('pointerupoutside', onStagePU);

  drawGrid();
  drawStatic();
  drawShape();

  watch(snapModes, () => { drawShape() }, { deep: true });
  watch(snapStrength, () => { drawShape() });
  watch(pixelsPerFoot, () => { drawGrid(); drawShape(); });
  watch(gridFeet,      () => { drawGrid(); drawShape(); });
  watch(thresholdFeet, () => { drawShape(); });

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'snapping',
      getSnapshot: () => ({
        snapActive: snapped !== null,
        snapMode: snapInfo.value,
        shapePosX: shapePos.x,
        shapePosY: shapePos.y,
        gridEnabled: snapModes.value.grid,
        vertexEnabled: snapModes.value.vertex,
        edgeEnabled: snapModes.value.edge,
      }),
    })
  }

  canvas.addEventListener('wheel', onWheel, { passive: false });
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined
  window.__pixiTestBridgeReady = false
  canvasEl.value?.removeEventListener('wheel', onWheel);
  app?.destroy(true, { children: true, texture: true, context: true });
});
</script>

<template>
  <div class="wrap">
    <canvas ref="canvasEl" />
    <div class="hud">
      <div class="fps">{{ fps }} <span>fps</span></div>
      <div>{{ frameMs }} ms</div>
      <div class="sep" />
      <div class="scale-info">{{ pixelsPerFoot }}px = 1ft · grid {{ gridFeet }}ft</div>
      <div v-if="snapInfo" class="snap-info">⊕ {{ snapInfo }}</div>
    </div>
    <div class="controls">
      <div class="ctrl-group">
        <span class="ctrl-label">Targets</span>
        <label><input type="checkbox" v-model="snapModes.grid" /> Grid</label>
        <label><input type="checkbox" v-model="snapModes.vertex" /> Vertex</label>
        <label><input type="checkbox" v-model="snapModes.edge" /> Edge</label>
      </div>
      <div class="ctrl-sep" />
      <div class="ctrl-group">
        <span class="ctrl-label">Strength</span>
        <label><input type="radio" v-model="snapStrength" value="off" /> Off</label>
        <label><input type="radio" v-model="snapStrength" value="permissive" /> Permissive</label>
        <label><input type="radio" v-model="snapStrength" value="strict" /> Strict</label>
      </div>
      <div class="ctrl-sep" />
      <div class="ctrl-group">
        <span class="ctrl-label">Scale</span>
        <label>px/ft <input type="number" v-model.number="pixelsPerFoot" min="5" max="200" step="0.5" class="num-input" /></label>
        <label>grid (ft) <input type="number" v-model.number="gridFeet" min="0.25" max="20" step="0.25" class="num-input" /></label>
        <label>thresh (ft) <input type="number" v-model.number="thresholdFeet" min="0.05" max="5" step="0.05" class="num-input" /></label>
      </div>
    </div>
    <div class="hint">Drag the orange square · <kbd>alt+drag</kbd> pan · <kbd>scroll</kbd> zoom</div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #0d0d0d; }
canvas { display: block; width: 100%; height: 100%; cursor: default; }
.hud { position: absolute; top: 10px; left: 10px; font-family: monospace; font-size: 12px; color: #0f0; line-height: 1.7; pointer-events: none; }
.fps { font-size: 18px; font-weight: bold; }
.fps span { font-size: 12px; color: #0a0; }
.sep { height: 6px; }
.snap-info { color: #ffdd00; font-weight: bold; }
.num-input { width: 52px; background: #222; color: #ccc; border: 1px solid #444; border-radius: 3px; padding: 2px 4px; font-family: monospace; font-size: 11px; }
.scale-info { color: #6af; font-size: 10px; }
.controls {
  position: absolute; top: 10px; right: 10px;
  display: flex; gap: 10px; align-items: center;
  font-family: monospace; font-size: 12px; color: #bbb;
  background: rgba(0,0,0,0.6); padding: 8px 14px; border-radius: 4px;
}
.ctrl-group { display: flex; align-items: center; gap: 8px; }
.ctrl-label { color: #666; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.ctrl-sep { width: 1px; height: 20px; background: #333; }
label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #555;
  background: rgba(0,0,0,0.5); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
kbd { background: #333; border: 1px solid #555; border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: 10px; color: #bbb; }
</style>
