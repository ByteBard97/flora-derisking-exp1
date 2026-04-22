<script setup lang="ts">
/**
 * Snapping derisking fixture.
 * Tests: grid snap, vertex snap, edge snap with visual indicators.
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics, Container } from 'pixi.js';
import { useFps } from '../shared/useFps';
import { snapToGrid, snapToVertex, snapToEdge, type Pt } from '../lib/snapUtils';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();

const GRID = 40;
const snapModes = ref({ grid: true, vertex: true, edge: true });
const snapInfo = ref('');

// Static scene: vertices and edges
const VERTS: Pt[] = [
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

function screenToWorld(sx: number, sy: number): Pt {
  return { x: (sx - camX) / zoom, y: (sy - camY) / zoom };
}

function applySnap(wx: number, wy: number) {
  snapped = null;
  snapInfo.value = '';
  const thresh = 20 / zoom;

  if (snapModes.value.vertex) {
    const sv = snapToVertex(wx, wy, VERTS, thresh);
    if (sv) { snapped = sv; snapInfo.value = 'vertex'; return; }
  }
  if (snapModes.value.edge) {
    const se = snapToEdge(wx, wy, EDGES, thresh);
    if (se) { snapped = se; snapInfo.value = 'edge'; return; }
  }
  if (snapModes.value.grid) {
    const sg = snapToGrid(wx, wy, GRID);
    if (Math.hypot(wx - sg.x, wy - sg.y) < thresh) {
      snapped = sg; snapInfo.value = `grid (${sg.x}, ${sg.y})`;
    }
  }
}

function drawGrid() {
  gridGfx.clear();
  for (let x = -2000; x <= 2000; x += GRID) {
    (gridGfx as any).setStrokeStyle({ width: 1, color: 0x2a2a2a, pixelLine: true });
    gridGfx.moveTo(x, -2000).lineTo(x, 2000).stroke();
  }
  for (let y = -2000; y <= 2000; y += GRID) {
    (gridGfx as any).setStrokeStyle({ width: 1, color: 0x2a2a2a, pixelLine: true });
    gridGfx.moveTo(-2000, y).lineTo(2000, y).stroke();
  }
  // Dot at each grid intersection (subtle)
  for (let x = -800; x <= 800; x += GRID * 5) {
    for (let y = -600; y <= 600; y += GRID * 5) {
      staticGfx.setFillStyle({ color: 0x333333 });
      staticGfx.circle(x, y, 1.5).fill();
    }
  }
}

function drawStatic() {
  staticGfx.clear();
  // Edges
  staticGfx.setStrokeStyle({ width: 1.5, color: 0x3366cc });
  for (const [a, b] of EDGES) {
    staticGfx.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke();
  }
  // Vertices
  for (const v of VERTS) {
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
  shapeGfx.rect(pos.x - SIZE, pos.y - SIZE, SIZE * 2, SIZE * 2).fill();
  shapeGfx.rect(pos.x - SIZE, pos.y - SIZE, SIZE * 2, SIZE * 2).stroke();

  // Crosshair at center
  shapeGfx.setStrokeStyle({ width: 1, color: 0xffffff, alpha: 0.4, pixelLine: true } as any);
  shapeGfx.moveTo(pos.x - 6, pos.y).lineTo(pos.x + 6, pos.y).stroke();
  shapeGfx.moveTo(pos.x, pos.y - 6).lineTo(pos.x, pos.y + 6).stroke();

  // Snap indicator
  snapGfx.clear();
  if (snapped) {
    const sz = 14 / zoom;
    snapGfx.setStrokeStyle({ width: 1.5, color: 0xffdd00, pixelLine: true } as any);
    snapGfx.moveTo(snapped.x - sz, snapped.y).lineTo(snapped.x + sz, snapped.y).stroke();
    snapGfx.moveTo(snapped.x, snapped.y - sz).lineTo(snapped.x, snapped.y + sz).stroke();
    // Circle indicator
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
  const SIZE = 20;
  if (Math.abs(wp.x - shapePos.x) < SIZE && Math.abs(wp.y - shapePos.y) < SIZE) {
    isDragging = true;
    dragOffset = { x: wp.x - shapePos.x, y: wp.y - shapePos.y };
  }
}

function onStagePM(e: any) {
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
    snapped = null;
    drawShape();
  }
  isDragging = false;
  isPanning = false;
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

  gridGfx   = markRaw(new Graphics());
  staticGfx = markRaw(new Graphics());
  shapeGfx  = markRaw(new Graphics());
  snapGfx   = markRaw(new Graphics());

  const bg = markRaw(new Graphics());
  bg.setFillStyle({ color: 0x000000, alpha: 0 });
  bg.rect(-5000, -5000, 10000, 10000).fill();
  bg.eventMode = 'static';
  bg.on('pointerdown', onBgPD);

  app.stage.addChild(gridGfx, bg, staticGfx, shapeGfx, snapGfx);
  app.stage.on('pointermove', onStagePM);
  app.stage.on('pointerup', onStagePU);
  app.stage.on('pointerupoutside', onStagePU);

  drawGrid();
  drawStatic();
  drawShape();

  canvas.addEventListener('wheel', onWheel, { passive: false });
});

onUnmounted(() => {
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
      <div v-if="snapInfo" class="snap-info">⊕ {{ snapInfo }}</div>
    </div>
    <div class="controls">
      <label><input type="checkbox" v-model="snapModes.grid" /> Grid</label>
      <label><input type="checkbox" v-model="snapModes.vertex" /> Vertex</label>
      <label><input type="checkbox" v-model="snapModes.edge" /> Edge</label>
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
.controls {
  position: absolute; top: 10px; right: 10px;
  display: flex; gap: 12px; align-items: center;
  font-family: monospace; font-size: 13px; color: #bbb;
  background: rgba(0,0,0,0.6); padding: 8px 14px; border-radius: 4px;
}
label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #555;
  background: rgba(0,0,0,0.5); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
kbd { background: #333; border: 1px solid #555; border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: 10px; color: #bbb; }
</style>
