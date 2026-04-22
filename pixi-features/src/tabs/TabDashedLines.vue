<script setup lang="ts">
/**
 * Dashed Lines derisking fixture.
 * Tests: DashLine port, pixelLine:true vs world-space width, various patterns.
 * Zoom in/out to verify pixelLine stays crisp at any scale.
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics } from 'pixi.js';
import { DashLine } from '../lib/DashLine';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();

let app = markRaw({} as Application);
let camX = 0, camY = 0, zoom = 1;
let isPanning = false, panStart = { x: 0, y: 0 };

const LINES = [
  { label: 'solid 2px (world-space — thickens on zoom)',  color: 0xffffff, width: 2,   pixelLine: false, dash: [] },
  { label: 'solid 1px pixelLine (stays 1px at any zoom)', color: 0xffffff, width: 1,   pixelLine: true,  dash: [] },
  { label: 'dashed [10, 5]  2px world',                   color: 0x44aaff, width: 2,   pixelLine: false, dash: [10, 5] },
  { label: 'dashed [20, 5, 5, 5]  2px world',             color: 0xff8800, width: 2,   pixelLine: false, dash: [20, 5, 5, 5] },
  { label: 'dotted [2, 6]  2px world',                    color: 0xff4444, width: 2,   pixelLine: false, dash: [2, 6] },
  { label: 'dashed [10, 5]  1px pixelLine',               color: 0x44ff88, width: 1,   pixelLine: true,  dash: [10, 5] },
  { label: 'selection "marching ants" style [6, 4]',      color: 0xffffff, width: 1.5, pixelLine: false, dash: [6, 4] },
  { label: 'path preview rubber-band style [4, 4]',       color: 0x4466ff, width: 1,   pixelLine: true,  dash: [4, 4] },
];

function draw() {
  const g = markRaw(new Graphics());
  const W = 560;

  LINES.forEach((spec, i) => {
    const y = (i - (LINES.length - 1) / 2) * 70;

    if (spec.dash.length === 0) {
      if (spec.pixelLine) {
        (g as any).setStrokeStyle({ width: spec.width, color: spec.color, pixelLine: true });
      } else {
        g.setStrokeStyle({ width: spec.width, color: spec.color });
      }
      g.moveTo(-W / 2, y).lineTo(W / 2, y).stroke();
    } else {
      const dl = new DashLine(g, { dash: spec.dash, width: spec.width, color: spec.color });
      dl.moveTo(-W / 2, y).lineTo(W / 2, y);
    }
  });

  return g;
}

onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas, width: canvas.clientWidth, height: canvas.clientHeight,
    antialias: true, backgroundAlpha: 0, resolution: devicePixelRatio, autoDensity: true,
  });

  camX = canvas.clientWidth / 2;
  camY = canvas.clientHeight / 2;
  app.stage.position.set(camX, camY);
  app.stage.addChild(draw());

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPD);
  window.addEventListener('pointermove', onPM);
  window.addEventListener('pointerup', onPU);
});

onUnmounted(() => {
  canvasEl.value?.removeEventListener('wheel', onWheel);
  canvasEl.value?.removeEventListener('pointerdown', onPD);
  window.removeEventListener('pointermove', onPM);
  window.removeEventListener('pointerup', onPU);
  app?.destroy(true, { children: true, texture: true, context: true });
});

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const rect = canvasEl.value!.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const wx = (sx - camX) / zoom;
  const wy = (sy - camY) / zoom;
  zoom = Math.max(0.1, Math.min(30, zoom * factor));
  camX = sx - wx * zoom;
  camY = sy - wy * zoom;
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
  camX = e.clientX - panStart.x;
  camY = e.clientY - panStart.y;
  app.stage.position.set(camX, camY);
}
function onPU() { isPanning = false; }
</script>

<template>
  <div class="wrap">
    <canvas ref="canvasEl" />
    <div class="hud">
      <div class="fps">{{ fps }} <span>fps</span></div>
      <div>{{ frameMs }} ms</div>
      <div class="sep" />
      <div>zoom: {{ zoom.toFixed(2) }}×</div>
    </div>
    <div class="legend">
      <div v-for="(l, i) in LINES" :key="i" class="row">
        <span class="swatch" :style="{ background: '#' + l.color.toString(16).padStart(6, '0') }" />
        {{ l.label }}
      </div>
    </div>
    <div class="hint">
      <kbd>scroll</kbd> zoom — watch pixelLine lines stay 1px while world-space lines thicken
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #111; }
canvas { display: block; width: 100%; height: 100%; cursor: grab; }
canvas:active { cursor: grabbing; }
.hud { position: absolute; top: 10px; left: 10px; font-family: monospace; font-size: 12px; color: #0f0; line-height: 1.7; pointer-events: none; }
.fps { font-size: 18px; font-weight: bold; }
.fps span { font-size: 12px; color: #0a0; }
.sep { height: 6px; }
.legend {
  position: absolute; top: 10px; right: 10px;
  font-family: monospace; font-size: 11px; color: #888; line-height: 2;
  background: rgba(0,0,0,0.65); padding: 10px 14px; border-radius: 4px;
  max-width: 380px;
}
.row { display: flex; align-items: center; gap: 8px; }
.swatch { display: inline-block; width: 24px; height: 3px; border-radius: 2px; flex-shrink: 0; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #555;
  background: rgba(0,0,0,0.5); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
kbd { background: #333; border: 1px solid #555; border-radius: 3px; padding: 1px 5px; font-size: 10px; color: #bbb; }
</style>
