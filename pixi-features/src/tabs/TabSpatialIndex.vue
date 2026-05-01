<script setup lang="ts">
/**
 * rbush spatial index derisking fixture.
 * Shows: marquee selection over 1000+ objects using R-tree vs brute-force,
 * with timing comparison to demonstrate the performance difference.
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics, GraphicsContext, Container, Ticker } from 'pixi.js';
import RBush from 'rbush';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();
const count = ref(1000);
const useIndex = ref(true);
const lastQueryMs = ref('—');
const lastHitCount = ref(0);
const lastClickWorld = ref('—');
const lastClickHits = ref<number | null>(null);

let app = markRaw({} as Application);
let objectLayer = markRaw({} as Container);
let marqueeGfx = markRaw({} as Graphics);
let clickFxLayer = markRaw({} as Container);

interface Rect { minX: number; minY: number; maxX: number; maxY: number; idx: number; }
let items: Rect[] = [];
let tree: RBush<Rect> = new RBush();
let gfxObjects: Graphics[] = [];

let ctxNormal: GraphicsContext;
let ctxSelected: GraphicsContext;

let camX = 0, camY = 0, zoom = 1;
let marqueeStart: {x:number,y:number} | null = null;
let marqueeEnd:   {x:number,y:number} | null = null;
let selectedSet = new Set<number>();
let dirty = true;
let isPanning = false;
let panStart = { x: 0, y: 0 };

function screenToWorld(sx: number, sy: number) {
  return { x: (sx - camX) / zoom, y: (sy - camY) / zoom };
}

function buildScene(n: number) {
  objectLayer.removeChildren();
  gfxObjects = [];
  items = [];
  selectedSet.clear();
  tree = new RBush();

  ctxNormal   = markRaw(new GraphicsContext()
    .setFillStyle({ color: 0x2d6a4f, alpha: 0.7 })
    .setStrokeStyle({ width: 1, color: 0x52b788 })
    .circle(0, 0, 10).fill().stroke());

  ctxSelected = markRaw(new GraphicsContext()
    .setFillStyle({ color: 0xffdd00, alpha: 0.9 })
    .setStrokeStyle({ width: 1.5, color: 0xffffff })
    .circle(0, 0, 10).fill().stroke());

  const WORLD_W = 1400, WORLD_H = 900;
  for (let i = 0; i < n; i++) {
    const x = 10 + Math.random() * (WORLD_W - 20);
    const y = 10 + Math.random() * (WORLD_H - 20);
    const r = 5 + Math.random() * 14;
    items.push({ minX: x - r, minY: y - r, maxX: x + r, maxY: y + r, idx: i });
    const g = markRaw(new Graphics(ctxNormal));
    g.position.set(x, y);
    g.scale.set(r / 10);
    gfxObjects.push(g);
    objectLayer.addChild(g);
  }
  tree.load(items);
  if (clickFxLayer) objectLayer.addChild(clickFxLayer);
  dirty = true;
}

function runQuery(queryRect: {minX:number,minY:number,maxX:number,maxY:number}) {
  selectedSet.clear();
  const t0 = performance.now();
  let hits: Rect[];
  if (useIndex.value) {
    hits = tree.search(queryRect);
  } else {
    hits = items.filter(it =>
      it.minX <= queryRect.maxX && it.maxX >= queryRect.minX &&
      it.minY <= queryRect.maxY && it.maxY >= queryRect.minY
    );
  }
  const t1 = performance.now();
  lastQueryMs.value = (t1 - t0).toFixed(3) + ' ms';
  lastHitCount.value = hits.length;
  for (const h of hits) selectedSet.add(h.idx);
  for (let i = 0; i < gfxObjects.length; i++) {
    gfxObjects[i].context = selectedSet.has(i) ? ctxSelected : ctxNormal;
  }
}

function drawMarquee() {
  marqueeGfx.clear();
  if (!marqueeStart || !marqueeEnd) return;
  const ss = { x: marqueeStart.x * zoom + camX, y: marqueeStart.y * zoom + camY };
  const se = { x: marqueeEnd.x * zoom + camX,   y: marqueeEnd.y * zoom + camY };
  const x = Math.min(ss.x, se.x), y = Math.min(ss.y, se.y);
  const w = Math.abs(se.x - ss.x), h = Math.abs(se.y - ss.y);
  marqueeGfx.setFillStyle({ color: 0x0099ff, alpha: 0.08 });
  marqueeGfx.setStrokeStyle({ width: 1.5, color: 0x0099ff });
  marqueeGfx.rect(x, y, w, h).fill().stroke();
}

function spawnClickFx(worldX: number, worldY: number) {
  const ring = new Graphics();
  ring.setStrokeStyle({ width: 2, color: 0xff3355 });
  ring.circle(0, 0, 4).stroke();
  ring.position.set(worldX, worldY);
  clickFxLayer.addChild(ring);
  const t0 = performance.now();
  const DURATION = 500;
  const tick = () => {
    const t = (performance.now() - t0) / DURATION;
    if (t >= 1) {
      ring.destroy();
      app.ticker.remove(tick);
      return;
    }
    ring.scale.set(1 + t * 4);
    ring.alpha = 1 - t;
  };
  app.ticker.add(tick);
}

function pointPick(worldX: number, worldY: number): number {
  const hits = useIndex.value
    ? tree.search({ minX: worldX, minY: worldY, maxX: worldX, maxY: worldY })
    : items.filter(it => it.minX <= worldX && it.maxX >= worldX && it.minY <= worldY && it.maxY >= worldY);
  return hits.length;
}

function onPD(e: PointerEvent) {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true;
    panStart = { x: e.offsetX - camX, y: e.offsetY - camY };
    return;
  }
  if (e.button !== 0) return;
  const w = screenToWorld(e.offsetX, e.offsetY);
  spawnClickFx(w.x, w.y);
  lastClickWorld.value = `(${w.x.toFixed(1)}, ${w.y.toFixed(1)})`;
  lastClickHits.value = pointPick(w.x, w.y);
  marqueeStart = w;
  marqueeEnd = { ...marqueeStart };
  runQuery({ minX: w.x, minY: w.y, maxX: w.x, maxY: w.y });
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onPM(e: PointerEvent) {
  if (isPanning) {
    camX = e.offsetX - panStart.x;
    camY = e.offsetY - panStart.y;
    objectLayer.position.set(camX, camY);
    objectLayer.scale.set(zoom);
    dirty = true;
    return;
  }
  if (!marqueeStart) return;
  marqueeEnd = screenToWorld(e.offsetX, e.offsetY);
  drawMarquee();

  const qr = {
    minX: Math.min(marqueeStart.x, marqueeEnd.x),
    minY: Math.min(marqueeStart.y, marqueeEnd.y),
    maxX: Math.max(marqueeStart.x, marqueeEnd.x),
    maxY: Math.max(marqueeStart.y, marqueeEnd.y),
  };
  runQuery(qr);
}

function onPU() {
  marqueeStart = null;
  marqueeEnd = null;
  marqueeGfx.clear();
  isPanning = false;
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const wx = (e.offsetX - camX) / zoom;
  const wy = (e.offsetY - camY) / zoom;
  zoom = Math.max(0.05, Math.min(20, zoom * factor));
  camX = e.offsetX - wx * zoom;
  camY = e.offsetY - wy * zoom;
  objectLayer.position.set(camX, camY);
  objectLayer.scale.set(zoom);
}

onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    antialias: true,
    background: '#0d0d0d',
    resolution: devicePixelRatio,
    autoDensity: true,
  });

  objectLayer = markRaw(new Container());
  marqueeGfx = markRaw(new Graphics());
  clickFxLayer = markRaw(new Container());
  app.stage.addChild(objectLayer, marqueeGfx);

  objectLayer.eventMode = 'none';
  clickFxLayer.eventMode = 'none';
  app.stage.eventMode = 'static';

  camX = 20; camY = 20;
  objectLayer.position.set(camX, camY);

  buildScene(count.value);

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'spatial-index',
      getSnapshot: () => ({
        itemCount: count.value,
        lastHitCount: lastHitCount.value,
        lastQueryMs: lastQueryMs.value,
        useIndex: useIndex.value,
      }),
    })
  }

  canvas.addEventListener('pointerdown', onPD);
  canvas.addEventListener('pointermove', onPM);
  canvas.addEventListener('pointerup', onPU);
  canvas.addEventListener('pointercancel', onPU);
  canvas.addEventListener('wheel', onWheel, { passive: false });
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined
  window.__pixiTestBridgeReady = false
  const canvas = canvasEl.value;
  canvas?.removeEventListener('pointerdown', onPD);
  canvas?.removeEventListener('pointermove', onPM);
  canvas?.removeEventListener('pointerup', onPU);
  canvas?.removeEventListener('pointercancel', onPU);
  canvas?.removeEventListener('wheel', onWheel);
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
      <div class="stat">Query: {{ lastQueryMs }}</div>
      <div class="stat">Hits: {{ lastHitCount }}</div>
      <div class="sep" />
      <div class="stat" :style="{ color: lastClickHits === 0 ? '#ff5566' : '#ffdd00' }">
        Click: {{ lastClickWorld }}<span v-if="lastClickHits !== null"> → {{ lastClickHits }} hit{{ lastClickHits === 1 ? '' : 's' }}</span>
      </div>
    </div>
    <div class="controls">
      <label>Count <input type="range" v-model.number="count" min="100" max="5000" step="100" style="width:90px" /> {{ count }}</label>
      <button @click="buildScene(count)">Rebuild</button>
      <div class="sep" />
      <label>
        <input type="checkbox" v-model="useIndex" />
        rbush R-tree
      </label>
      <div style="font-size:10px;color:#555;margin-top:2px;max-width:190px">
        Uncheck for brute-force O(n) scan.<br>
        Drag to compare query time.
      </div>
    </div>
    <div class="hint">Drag marquee to select · <kbd>alt+drag</kbd> pan · scroll zoom</div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #0d0d0d; }
canvas { display: block; width: 100%; height: 100%; cursor: crosshair; }
.hud { position: absolute; top: 10px; left: 10px; font-family: monospace; font-size: 12px; color: #0f0; line-height: 1.7; pointer-events: none; }
.fps { font-size: 18px; font-weight: bold; }
.fps span { font-size: 12px; color: #0a0; }
.sep { height: 6px; }
.stat { color: #ffdd00; }
.controls {
  position: absolute; top: 10px; right: 10px;
  display: flex; flex-direction: column; gap: 8px;
  font-family: monospace; font-size: 12px; color: #bbb;
  background: rgba(0,0,0,0.7); padding: 10px 14px; border-radius: 4px;
}
label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
button { padding: 4px 10px; background: #2a2a2a; color: #888; border: 1px solid #444; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 12px; }
button:hover { background: #333; color: #bbb; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #555;
  background: rgba(0,0,0,0.5); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
kbd { background: #333; border: 1px solid #555; border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: 10px; color: #bbb; }
</style>
