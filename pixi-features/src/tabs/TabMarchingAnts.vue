<script setup lang="ts">
/**
 * Marching ants selection border — hand-rolled via Graphics dash offset animation.
 * Pixi v8 doesn't expose lineDashOffset in StrokeStyle; we simulate it by
 * re-drawing the entire selection path each frame with a shifted pattern.
 * This is the pattern we'd use for any selection outline in Flora CAD.
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics, Container, Ticker } from 'pixi.js';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();

const speed = ref(2);
const dashLen = ref(8);
const gapLen = ref(6);

let app = markRaw({} as Application);
let selGfx = markRaw({} as Graphics);
let objectsLayer = markRaw({} as Container);
let dashOffset = 0;

// A few "selected" objects (rectangles, stored as world coords)
const selectedRects = [
  { x: 120, y: 80, w: 200, h: 140 },
  { x: 420, y: 60, w: 120, h: 220 },
  { x: 160, y: 320, w: 340, h: 100 },
];

function drawObjects() {
  const gfx = markRaw(new Graphics());
  for (const r of selectedRects) {
    gfx.setFillStyle({ color: 0x1a3a5c, alpha: 0.8 });
    gfx.setStrokeStyle({ width: 1, color: 0x2255aa });
    gfx.rect(r.x, r.y, r.w, r.h).fill().stroke();
  }
  objectsLayer.addChild(gfx);
}

function polylineLength(pts: [number,number][]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i-1][0];
    const dy = pts[i][1] - pts[i-1][1];
    len += Math.hypot(dx, dy);
  }
  return len;
}

function drawDashedPolyline(gfx: Graphics, pts: [number,number][], offset: number, dash: number, gap: number, color: number) {
  const period = dash + gap;
  let distAlongPath = -((offset % period) + period) % period;
  // stroke() clones but does not clear the active path — beginPath() isolates each call.
  gfx.beginPath();
  gfx.setStrokeStyle({ width: 1.5, color, pixelLine: false } as any);

  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i-1][0], ay = pts[i-1][1];
    const bx = pts[i][0],   by = pts[i][1];
    const segLen = Math.hypot(bx - ax, by - ay);
    const dx = (bx - ax) / segLen;
    const dy = (by - ay) / segLen;

    let t = 0;
    while (t < segLen) {
      const phase = ((distAlongPath + t) % period + period) % period;
      const inDash = phase < dash;
      const remaining = inDash ? dash - phase : period - phase;
      const step = Math.min(remaining, segLen - t);
      const nextT = t + step;
      // Float guard: if step is smaller than the ULP of t, t won't advance → infinite loop.
      if (nextT <= t) break;

      if (inDash) {
        const sx = ax + dx * t;
        const sy = ay + dy * t;
        const ex = ax + dx * nextT;
        const ey = ay + dy * nextT;
        gfx.moveTo(sx, sy).lineTo(ex, ey);
      }
      t = nextT;
    }
    distAlongPath += segLen;
  }
  // One tessellation + GPU instruction for the entire dashed path, not one per segment.
  gfx.stroke();
}

function getRectPoly(r: {x:number,y:number,w:number,h:number}): [number,number][] {
  return [
    [r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y],
  ];
}

function onTick(ticker: Ticker) {
  dashOffset += speed.value * ticker.deltaTime;
  selGfx.clear();

  // Outer white dashes
  for (const r of selectedRects) {
    const poly = getRectPoly(r);
    drawDashedPolyline(selGfx, poly, dashOffset, dashLen.value, gapLen.value, 0xffffff);
    drawDashedPolyline(selGfx, poly, dashOffset + dashLen.value + gapLen.value, dashLen.value, gapLen.value, 0x000000);
  }
}

onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    antialias: true,
    background: '#151515',
    resolution: devicePixelRatio,
    autoDensity: true,
  });

  objectsLayer = markRaw(new Container());
  selGfx = markRaw(new Graphics());

  app.stage.addChild(objectsLayer, selGfx);

  drawObjects();
  app.ticker.add(onTick);

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'marching-ants',
      getSnapshot: () => ({
        animating: true,
        dashOffset,
        rectCount: selectedRects.length,
        speed: speed.value,
      }),
    })
  }
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined
  window.__pixiTestBridgeReady = false
  app?.ticker.remove(onTick);
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
      <label>Speed <input type="range" v-model.number="speed" min="0.2" max="6" step="0.2" style="width:80px" /> {{ speed.toFixed(1) }}</label>
      <label>Dash <input type="range" v-model.number="dashLen" min="2" max="24" step="1" style="width:80px" /> {{ dashLen }}px</label>
      <label>Gap <input type="range" v-model.number="gapLen" min="2" max="24" step="1" style="width:80px" /> {{ gapLen }}px</label>
      <div style="font-size:10px;color:#555;margin-top:4px;max-width:180px">
        Re-draws entire selection path each tick.<br>
        Pixi v8 has no lineDashOffset; this is the workaround.
      </div>
    </div>
    <div class="hint">Marching ants — animated alternating black/white dashes offset each frame</div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #151515; }
canvas { display: block; width: 100%; height: 100%; }
.hud { position: absolute; top: 10px; left: 10px; font-family: monospace; font-size: 12px; color: #0f0; line-height: 1.7; pointer-events: none; }
.fps { font-size: 18px; font-weight: bold; }
.fps span { font-size: 12px; color: #0a0; }
.controls {
  position: absolute; top: 10px; right: 10px;
  display: flex; flex-direction: column; gap: 8px;
  font-family: monospace; font-size: 12px; color: #bbb;
  background: rgba(0,0,0,0.7); padding: 10px 14px; border-radius: 4px;
}
label { display: flex; align-items: center; gap: 6px; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #555;
  background: rgba(0,0,0,0.5); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
</style>
