<script setup lang="ts">
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Container, Graphics, RenderTexture, Sprite } from 'pixi.js';
import { getStroke } from 'perfect-freehand';
import { useFps } from '../shared/useFps';
import { fitBezierPath, drawFittedPath } from '../lib/pathFit';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();

const pressure = ref(true);
const thinning = ref(0.5);
const smoothing = ref(0.5);
const streamline = ref(0.5);
const clearOnNext = ref(false);

let app = markRaw({} as Application);
let accTex: RenderTexture;
let accSprite: Sprite;
let liveGfx = markRaw({} as Graphics);
let fittedGfx = markRaw({} as Graphics);
const showFitted = ref(true);
const lastSegmentCount = ref(0);

let currentPoints: [number, number, number][] = [];
let drawing = false;
const strokeCount = ref(0);
const lastStrokePointCount = ref(0);

function getFreehandOpts() {
  return {
    size: 12,
    thinning: thinning.value,
    smoothing: smoothing.value,
    streamline: streamline.value,
    simulatePressure: !pressure.value,
  };
}

function renderStrokeToGfx(gfx: Graphics, pts: [number, number, number][]) {
  gfx.clear();
  if (pts.length < 2) return;
  const outline = getStroke(pts, getFreehandOpts());
  if (!outline || outline.length < 3) return;
  gfx.setFillStyle({ color: 0x00d4ff, alpha: 0.85 });
  gfx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    gfx.lineTo(outline[i][0], outline[i][1]);
  }
  gfx.closePath().fill();
}

function burnToTexture() {
  // Render current liveGfx on top of accSprite into accTex
  liveGfx.visible = true;
  app.renderer.render({ container: app.stage, target: accTex, clear: false });
  liveGfx.clear();
}

function clearCanvas() {
  const empty = new Container();
  app.renderer.render({ container: empty, target: accTex, clear: true });
  empty.destroy();
  liveGfx.clear();
  fittedGfx.clear();
}

function onPD(e: PointerEvent) {
  if (e.button !== 0) return;
  drawing = true;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  const r = canvasEl.value!.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  currentPoints = [[x, y, e.pressure || 0.5]];
}

function onPM(e: PointerEvent) {
  if (!drawing) return;
  const r = canvasEl.value!.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  currentPoints.push([x, y, e.pressure || 0.5]);
  renderStrokeToGfx(liveGfx, currentPoints);
}

function onPU() {
  if (!drawing) return;
  drawing = false;
  lastStrokePointCount.value = currentPoints.length;
  renderStrokeToGfx(liveGfx, currentPoints);
  burnToTexture();
  strokeCount.value++;

  if (showFitted.value && currentPoints.length >= 4) {
    const pts = currentPoints.map(([x, y]) => ({ x, y }));
    const segments = fitBezierPath(pts, 2.5, 4);
    lastSegmentCount.value = segments.length;
    drawFittedPath(fittedGfx, segments, 0x00ff88);
  } else {
    fittedGfx.clear();
    lastSegmentCount.value = 0;
  }

  currentPoints = [];
}

onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    antialias: true,
    background: '#111111',
    resolution: devicePixelRatio,
    autoDensity: true,
  });

  accTex = RenderTexture.create({
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    resolution: devicePixelRatio,
  });

  accSprite = markRaw(new Sprite(accTex));
  liveGfx = markRaw(new Graphics());
  fittedGfx = markRaw(new Graphics());

  app.stage.addChild(accSprite, liveGfx, fittedGfx);

  canvas.addEventListener('pointerdown', onPD);
  canvas.addEventListener('pointermove', onPM);
  canvas.addEventListener('pointerup', onPU);
  canvas.addEventListener('pointercancel', onPU);

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'freehand',
      getSnapshot: () => ({
        drawing,
        strokeCount: strokeCount.value,
        lastStrokePointCount: lastStrokePointCount.value,
      }),
    })
  }
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined
  window.__pixiTestBridgeReady = false
  canvasEl.value?.removeEventListener('pointerdown', onPD);
  canvasEl.value?.removeEventListener('pointermove', onPM);
  canvasEl.value?.removeEventListener('pointerup', onPU);
  canvasEl.value?.removeEventListener('pointercancel', onPU);
  accTex?.destroy(true);
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
      <label><input type="checkbox" v-model="pressure" /> Pressure</label>
      <label>Thinning <input type="range" v-model.number="thinning" min="-1" max="1" step="0.05" style="width:80px" /> {{ thinning.toFixed(2) }}</label>
      <label>Smooth <input type="range" v-model.number="smoothing" min="0" max="1" step="0.05" style="width:80px" /> {{ smoothing.toFixed(2) }}</label>
      <label>Stream <input type="range" v-model.number="streamline" min="0" max="1" step="0.05" style="width:80px" /> {{ streamline.toFixed(2) }}</label>
      <button @click="clearCanvas">Clear</button>
      <label>
        <input type="checkbox" v-model="showFitted" /> <span style="color:#00ff88">Show fitted bezier</span>
      </label>
      <div v-if="lastSegmentCount > 0" style="color:#00ff88;font-size:11px">
        {{ lastSegmentCount }} bezier segment{{ lastSegmentCount === 1 ? '' : 's' }}
      </div>
    </div>
    <div class="hint">Draw · strokes accumulate via RenderTexture · pen pressure supported</div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #111; }
canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.hud { position: absolute; top: 10px; left: 10px; font-family: monospace; font-size: 12px; color: #0f0; line-height: 1.7; pointer-events: none; }
.fps { font-size: 18px; font-weight: bold; }
.fps span { font-size: 12px; color: #0a0; }
.controls {
  position: absolute; top: 10px; right: 10px;
  display: flex; flex-direction: column; gap: 6px;
  font-family: monospace; font-size: 12px; color: #bbb;
  background: rgba(0,0,0,0.7); padding: 10px 14px; border-radius: 4px;
}
label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
button { margin-top: 4px; padding: 4px 10px; background: #333; color: #ccc; border: 1px solid #555; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 12px; }
button:hover { background: #444; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #555;
  background: rgba(0,0,0,0.5); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
</style>
