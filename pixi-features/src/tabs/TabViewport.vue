<script setup lang="ts">
/**
 * pixi-viewport derisking fixture.
 * Tests: drag/pan with decelerate, wheel zoom to cursor, pinch-to-zoom,
 * clamp zoom, and the "follow" plugin. Renders 500 circles to check
 * that viewport transform integrates cleanly with the scene graph.
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics, Text, TextStyle, Container } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();
const circleCount = ref(300);
const decelerate = ref(true);

let app = markRaw({} as Application);
let viewport: Viewport;
let contentLayer = markRaw({} as Container);

const WORLD_W = 3000;
const WORLD_H = 2000;

function buildScene(n: number) {
  contentLayer.removeChildren();

  // World boundary
  const border = markRaw(new Graphics());
  border.setStrokeStyle({ width: 2, color: 0x334455 });
  border.rect(0, 0, WORLD_W, WORLD_H).stroke();
  contentLayer.addChild(border);

  // Grid
  const grid = markRaw(new Graphics());
  grid.setStrokeStyle({ width: 1, color: 0x1a2a3a } as any);
  for (let x = 0; x <= WORLD_W; x += 100) grid.moveTo(x, 0).lineTo(x, WORLD_H).stroke();
  for (let y = 0; y <= WORLD_H; y += 100) grid.moveTo(0, y).lineTo(WORLD_W, y).stroke();
  contentLayer.addChild(grid);

  // Random plant circles
  for (let i = 0; i < n; i++) {
    const x = 20 + Math.random() * (WORLD_W - 40);
    const y = 20 + Math.random() * (WORLD_H - 40);
    const r = 8 + Math.random() * 24;
    const hue = Math.floor(Math.random() * 3);
    const colors = [0x2d6a4f, 0x1b4332, 0x40916c];
    const g = markRaw(new Graphics());
    g.setFillStyle({ color: colors[hue], alpha: 0.7 });
    g.setStrokeStyle({ width: 1, color: 0x52b788 });
    g.circle(x, y, r).fill().stroke();
    contentLayer.addChild(g);
  }

  // Labels at grid corners for orientation
  for (const [lx, ly, label] of [[10, 10, 'origin'], [WORLD_W - 60, 10, 'NE'], [10, WORLD_H - 20, 'SW'], [WORLD_W - 60, WORLD_H - 20, 'SE']]) {
    const t = markRaw(new Text({ text: label as string, style: new TextStyle({ fontSize: 11, fill: 0x446677 }) }));
    t.position.set(lx as number, ly as number);
    contentLayer.addChild(t);
  }
}

onMounted(async () => {
  const canvas = canvasEl.value!;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  app = markRaw(new Application());
  await app.init({
    canvas,
    width: W,
    height: H,
    antialias: true,
    background: '#0d141c',
    resolution: devicePixelRatio,
    autoDensity: true,
  });

  viewport = new Viewport({
    screenWidth: W,
    screenHeight: H,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
    events: app.renderer.events,
  });

  viewport
    .drag()
    .wheel({ smooth: 8 })
    .decelerate({ friction: 0.93 })
    .clampZoom({ minScale: 0.1, maxScale: 10 })
    .pinch();

  contentLayer = markRaw(new Container());
  viewport.addChild(contentLayer);
  app.stage.addChild(viewport);

  buildScene(circleCount.value);
  viewport.fit();
  viewport.moveCenter(WORLD_W / 2, WORLD_H / 2);
});

onUnmounted(() => {
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
      <label>Circles <input type="range" v-model.number="circleCount" min="50" max="2000" step="50" style="width:90px" /> {{ circleCount }}</label>
      <button @click="buildScene(circleCount)">Rebuild</button>
      <div class="sep" />
      <button @click="viewport.fit(); viewport.moveCenter(WORLD_W / 2, WORLD_H / 2)">Fit</button>
      <button @click="viewport.setZoom(1, true)">1:1</button>
      <div style="font-size:10px;color:#555;margin-top:4px;max-width:180px">
        pixi-viewport: drag, wheel zoom, decelerate, pinch.<br>
        World: {{ WORLD_W }}×{{ WORLD_H }}
      </div>
    </div>
    <div class="hint">Drag · scroll to zoom · pinch on touch · momentum deceleration</div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #0d141c; }
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
.sep { height: 1px; background: #333; }
button { padding: 4px 10px; background: #2a2a2a; color: #888; border: 1px solid #444; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 12px; }
button:hover { background: #333; color: #bbb; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #555;
  background: rgba(0,0,0,0.5); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
</style>
