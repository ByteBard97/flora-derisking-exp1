<script setup lang="ts">
/**
 * Selection derisking fixture.
 * Tests: click-to-select, shift multi-select, lasso box, drag-to-move.
 * Hit detection via Pixi eventMode + custom hitArea on thin strokes.
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics, Container, Rectangle, Circle } from 'pixi.js';
import { useFps } from '../shared/useFps';

interface Shape {
  id: number;
  kind: 'circle' | 'rect';
  x: number; y: number;
  r: number;
  color: number;
  gfx: Graphics;
}

const { fps, frameMs, heapMB } = useFps();
const canvasEl = ref<HTMLCanvasElement>();
const selectedIds = ref(new Set<number>());
const shapeCount = ref(40);

let app = markRaw({} as Application);
let worldLayer = markRaw({} as Container);
let lassoGfx = markRaw({} as Graphics);
let shapes: Shape[] = [];

let camX = 0, camY = 0, zoom = 1;
let isLasso = false;
let lassoStart = { x: 0, y: 0 };
let lassoCurrent = { x: 0, y: 0 };
let isDraggingShapes = false;
let dragStartWorld = { x: 0, y: 0 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let lastPointerDownOnShape = false;

function screenToWorld(sx: number, sy: number) {
  return { x: (sx - camX) / zoom, y: (sy - camY) / zoom };
}

function spawnShapes(n: number) {
  worldLayer.removeChildren();
  worldLayer.addChild(lassoGfx);
  shapes = [];
  selectedIds.value = new Set();

  const W = 800, H = 600;
  for (let i = 0; i < n; i++) {
    const kind = Math.random() > 0.5 ? 'circle' : 'rect';
    const x = 60 + Math.random() * (W - 120);
    const y = 60 + Math.random() * (H - 120);
    const r = 20 + Math.random() * 30;
    const color = [0xff4444, 0x44aaff, 0x44ff88, 0xffaa00, 0xcc44cc, 0x00cccc][i % 6];

    const g = markRaw(new Graphics());
    drawShape(g, kind, 0, 0, r, color, false);

    g.position.set(x, y);
    g.eventMode = 'static';
    g.cursor = 'pointer';
    if (kind === 'circle') {
      g.hitArea = new Circle(0, 0, r);
    } else {
      g.hitArea = new Rectangle(-r, -r, r * 2, r * 2);
    }

    const id = i;
    g.on('pointerdown', (e: any) => {
      e.stopPropagation();
      lastPointerDownOnShape = true;
      if (e.shiftKey) {
        if (selectedIds.value.has(id)) selectedIds.value.delete(id);
        else selectedIds.value.add(id);
      } else {
        if (!selectedIds.value.has(id)) {
          selectedIds.value = new Set([id]);
        }
      }
      isDraggingShapes = true;
      const wp = screenToWorld(e.global.x, e.global.y);
      dragStartWorld = { x: wp.x, y: wp.y };
      refreshShapes();
    });

    shapes.push({ id, kind, x, y, r, color, gfx: g });
    worldLayer.addChild(g);
  }
}

function drawShape(g: Graphics, kind: string, x: number, y: number, r: number, color: number, selected: boolean) {
  g.clear();
  g.setFillStyle({ color, alpha: 0.7 });
  g.setStrokeStyle({ width: selected ? 2.5 : 1.5, color: selected ? 0xffffff : color });
  if (kind === 'circle') {
    g.circle(x, y, r).fill().stroke();
  } else {
    g.rect(x - r, y - r, r * 2, r * 2).fill().stroke();
    if (selected) {
      g.beginPath();
      g.setStrokeStyle({ width: 1, color: 0xffffff, alpha: 0.3 });
      g.rect(x - r - 3, y - r - 3, r * 2 + 6, r * 2 + 6).stroke();
    }
  }
}

function refreshShapes() {
  for (const s of shapes) {
    drawShape(s.gfx, s.kind, 0, 0, s.r, s.color, selectedIds.value.has(s.id));
  }
}

function drawLasso(x0: number, y0: number, x1: number, y1: number) {
  lassoGfx.clear();
  const lx = Math.min(x0, x1), ly = Math.min(y0, y1);
  const lw = Math.abs(x1 - x0), lh = Math.abs(y1 - y0);
  lassoGfx.setFillStyle({ color: 0x0070e0, alpha: 0.1 });
  lassoGfx.setStrokeStyle({ width: 1, color: 0x0070e0 });
  lassoGfx.rect(lx, ly, lw, lh).fill().stroke();
}

function selectByLasso(x0: number, y0: number, x1: number, y1: number) {
  const lx = Math.min(x0, x1), rx = Math.max(x0, x1);
  const ly = Math.min(y0, y1), ry = Math.max(y0, y1);
  const hits = new Set<number>();
  for (const s of shapes) {
    if (s.x >= lx && s.x <= rx && s.y >= ly && s.y <= ry) hits.add(s.id);
  }
  selectedIds.value = hits;
  refreshShapes();
}

function onBgPointerDown(e: any) {
  lastPointerDownOnShape = false;
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true;
    panStart = { x: e.global.x - camX, y: e.global.y - camY };
    return;
  }
  if (!e.shiftKey) selectedIds.value = new Set();
  refreshShapes();
  const wp = screenToWorld(e.global.x, e.global.y);
  isLasso = true;
  lassoStart = { x: wp.x, y: wp.y };
  lassoCurrent = { x: wp.x, y: wp.y };
}

function onStagePointerMove(e: any) {
  if (isPanning) {
    camX = e.global.x - panStart.x;
    camY = e.global.y - panStart.y;
    app.stage.position.set(camX, camY);
    return;
  }
  if (isLasso) {
    const wp = screenToWorld(e.global.x, e.global.y);
    lassoCurrent = wp;
    drawLasso(lassoStart.x, lassoStart.y, lassoCurrent.x, lassoCurrent.y);
    return;
  }
  if (isDraggingShapes) {
    const wp = screenToWorld(e.global.x, e.global.y);
    const dx = wp.x - dragStartWorld.x;
    const dy = wp.y - dragStartWorld.y;
    for (const s of shapes) {
      if (selectedIds.value.has(s.id)) {
        s.x += dx; s.y += dy;
        s.gfx.position.set(s.x, s.y);
      }
    }
    dragStartWorld = wp;
  }
}

function onStagePointerUp() {
  if (isLasso) {
    selectByLasso(lassoStart.x, lassoStart.y, lassoCurrent.x, lassoCurrent.y);
    lassoGfx.clear();
    isLasso = false;
  }
  isDraggingShapes = false;
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

function respawn() {
  spawnShapes(shapeCount.value);
}

onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas, width: canvas.clientWidth, height: canvas.clientHeight,
    antialias: true, backgroundAlpha: 0, resolution: devicePixelRatio, autoDensity: true,
  });

  camX = 20; camY = 20;
  app.stage.position.set(camX, camY);

  worldLayer = markRaw(new Container());
  app.stage.addChild(worldLayer);

  lassoGfx = markRaw(new Graphics());

  const bg = markRaw(new Graphics());
  bg.setFillStyle({ color: 0x000000, alpha: 0 });
  bg.rect(-5000, -5000, 10000, 10000).fill();
  bg.eventMode = 'static';
  bg.on('pointerdown', onBgPointerDown);
  worldLayer.addChildAt(bg, 0);

  app.stage.eventMode = 'static';
  app.stage.on('pointermove', onStagePointerMove);
  app.stage.on('pointerup', onStagePointerUp);
  app.stage.on('pointerupoutside', onStagePointerUp);

  spawnShapes(shapeCount.value);

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'selection',
      getSnapshot: () => ({
        selectedCount: selectedIds.value.size,
        shapeCount: shapes.length,
        selectedIdsList: [...selectedIds.value],
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
      <div v-if="heapMB !== null">{{ heapMB }} MB</div>
      <div class="sep" />
      <div>shapes: {{ shapes.length }}</div>
      <div>selected: {{ selectedIds.size }}</div>
    </div>
    <div class="controls">
      <label>Count: {{ shapeCount }}</label>
      <input type="range" v-model.number="shapeCount" min="10" max="500" step="10" />
      <button @click="respawn">Respawn</button>
    </div>
    <div class="hint">
      <kbd>click</kbd> select &nbsp; <kbd>shift+click</kbd> multi &nbsp;
      <kbd>drag empty</kbd> lasso &nbsp; <kbd>drag shape</kbd> move &nbsp;
      <kbd>alt+drag</kbd> pan &nbsp; <kbd>scroll</kbd> zoom
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #111; }
canvas { display: block; width: 100%; height: 100%; }
.hud { position: absolute; top: 10px; left: 10px; font-family: monospace; font-size: 12px; color: #0f0; line-height: 1.7; pointer-events: none; }
.fps { font-size: 18px; font-weight: bold; }
.fps span { font-size: 12px; color: #0a0; }
.sep { height: 6px; }
.controls {
  position: absolute; top: 10px; right: 10px;
  display: flex; align-items: center; gap: 8px;
  font-family: monospace; font-size: 12px; color: #bbb;
  background: rgba(0,0,0,0.6); padding: 8px 12px; border-radius: 4px;
}
button { background: #333; color: #bbb; border: 1px solid #555; border-radius: 3px; padding: 3px 10px; cursor: pointer; font-family: monospace; font-size: 12px; }
button:hover { background: #444; }
input[type=range] { width: 100px; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #555;
  background: rgba(0,0,0,0.5); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
kbd { background: #333; border: 1px solid #555; border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: 10px; color: #bbb; }
</style>
