<script setup lang="ts">
/**
 * Marching ants via davidfig's segIdx/segRem algorithm — ported to Pixi v8.
 * Original: github.com/davidfig/pixi-dashed-line (MIT)
 *
 * Instead of computing phase arithmetic (the approach in TabMarchingAnts.vue),
 * this walks the dash array by tracking the current segment index and remaining
 * distance in that segment. Avoids the gap-phase sign bug entirely.
 * Supports arbitrary polylines. Rebuilds geometry each frame (same as phase approach).
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics, Container, Ticker } from 'pixi.js';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();

const speed   = ref(2);
const dashLen = ref(8);
const gapLen  = ref(6);

let app          = markRaw({} as Application);
let selGfx       = markRaw({} as Graphics);
let objectsLayer = markRaw({} as Container);
let dashOffset   = 0;

const SELECTED_RECTS = [
  { x: 120, y: 80,  w: 200, h: 140 },
  { x: 420, y: 60,  w: 120, h: 220 },
  { x: 160, y: 320, w: 340, h: 100 },
] as const;

function getRectPoly(r: { x: number; y: number; w: number; h: number }): [number, number][] {
  return [
    [r.x,       r.y      ],
    [r.x + r.w, r.y      ],
    [r.x + r.w, r.y + r.h],
    [r.x,       r.y + r.h],
    [r.x,       r.y      ],
  ];
}

/**
 * Davidfig segIdx/segRem algorithm ported to Pixi v8.
 * Builds the full dashed path, then commits it with a single .stroke() call.
 * `offset` shifts where in the dash cycle we begin — used for animation.
 */
function drawDashedPolylineDavidfig(
  gfx: Graphics,
  pts: [number, number][],
  dashPattern: number[],
  offset: number,
  color: number,
  strokeWidth: number,
): void {
  const dashSize = dashPattern.reduce((a, b) => a + b, 0);
  let lineLength = ((offset % dashSize) + dashSize) % dashSize;

  // stroke() clones but does not clear the active path — beginPath() isolates each call.
  gfx.beginPath();
  gfx.setStrokeStyle({ width: strokeWidth, color });

  for (let pi = 1; pi < pts.length; pi++) {
    const ax = pts[pi - 1][0], ay = pts[pi - 1][1];
    const bx = pts[pi][0],     by = pts[pi][1];
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 0.5) continue;

    const cos = (bx - ax) / length;
    const sin = (by - ay) / length;

    // Find which dash segment and how far into it we start
    const place = lineLength % dashSize;
    let dashIndex = 0, dashStart = 0, acc = 0;
    for (let i = 0; i < dashPattern.length; i++) {
      if (place < acc + dashPattern[i]) {
        dashIndex = i;
        dashStart = place - acc;
        break;
      }
      acc += dashPattern[i];
    }

    let x0 = ax, y0 = ay;
    let remaining = length;

    // If we start in a dash, position the cursor here
    if (dashIndex % 2 === 0) gfx.moveTo(x0, y0);

    while (remaining > 0) {
      const segRemaining = dashPattern[dashIndex] - dashStart;
      const dist = Math.min(remaining, segRemaining);
      x0 += cos * dist;
      y0 += sin * dist;

      if (dashIndex % 2 === 0) {
        gfx.lineTo(x0, y0);  // dash — extend sub-path
      } else {
        gfx.moveTo(x0, y0);  // gap — reposition cursor for next dash
      }

      remaining  -= dist;
      dashIndex   = (dashIndex + 1) % dashPattern.length;
      dashStart   = 0;
    }

    lineLength += length;
  }

  gfx.stroke();
}

function onTick(ticker: Ticker) {
  dashOffset += speed.value * ticker.deltaTime;
  selGfx.clear();

  const dash = dashLen.value;
  const gap  = gapLen.value;

  for (const r of SELECTED_RECTS) {
    const poly = getRectPoly(r);
    drawDashedPolylineDavidfig(selGfx, poly, [dash, gap], dashOffset,            0xffffff, 1.5);
    drawDashedPolylineDavidfig(selGfx, poly, [dash, gap], dashOffset + dash + gap, 0x000000, 1.5);
  }
}

function drawObjects() {
  const gfx = markRaw(new Graphics());
  for (const r of SELECTED_RECTS) {
    gfx.setFillStyle({ color: 0x1a3a5c, alpha: 0.8 });
    gfx.setStrokeStyle({ width: 1, color: 0x2255aa });
    gfx.rect(r.x, r.y, r.w, r.h).fill().stroke();
  }
  objectsLayer.addChild(gfx);
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
  selGfx       = markRaw(new Graphics());
  app.stage.addChild(objectsLayer, selGfx);

  drawObjects();
  app.ticker.add(onTick);
});

onUnmounted(() => {
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
      <label>Speed <input type="range" v-model.number="speed"   min="0.2" max="6"  step="0.2" style="width:80px" /> {{ speed.toFixed(1) }}</label>
      <label>Dash  <input type="range" v-model.number="dashLen" min="2"   max="24" step="1"   style="width:80px" /> {{ dashLen }}px</label>
      <label>Gap   <input type="range" v-model.number="gapLen"  min="2"   max="24" step="1"   style="width:80px" /> {{ gapLen }}px</label>
      <div style="font-size:10px;color:#555;margin-top:4px;max-width:200px">
        Davidfig algorithm — segIdx+segRem walk, no phase arithmetic.<br>
        Rebuilds geometry each frame. Arbitrary polylines.
      </div>
    </div>
    <div class="hint">Davidfig marching ants — index+remainder walk, single .stroke() per pass</div>
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
