<script setup lang="ts">
/**
 * BitmapText vs Text comparison at various zoom levels.
 * BitmapText uses a GPU texture atlas — stays crisp at any zoom.
 * Text re-rasterises at each zoom — blurry when zoomed in, expensive at high DPI.
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, BitmapFont, BitmapText, Text, TextStyle, Container, Graphics } from 'pixi.js';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();
const count = ref(200);
const zoom = ref(1);

let app = markRaw({} as Application);
let bitmapLayer = markRaw({} as Container);
let textLayer = markRaw({} as Container);
let showBitmap = ref(true);

const FONT_NAME = 'LabelFont';

function buildScene(n: number) {
  bitmapLayer.removeChildren();
  textLayer.removeChildren();

  for (let i = 0; i < n; i++) {
    const x = 60 + Math.random() * 860;
    const y = 40 + Math.random() * 520;
    const label = `TR${i + 1}`;

    const bt = markRaw(new BitmapText({
      text: label,
      style: { fontFamily: FONT_NAME, fontSize: 14, fill: 0xffffff },
    }));
    bt.anchor.set(0.5);
    bt.position.set(x, y);
    bitmapLayer.addChild(bt);

    const style = new TextStyle({ fontSize: 14, fill: 0x00ff99, fontFamily: 'monospace' });
    const t = markRaw(new Text({ text: label, style }));
    t.anchor.set(0.5);
    t.position.set(x, y + 300);
    textLayer.addChild(t);
  }
}

function applyZoom(z: number) {
  zoom.value = z;
  bitmapLayer.scale.set(z);
  textLayer.scale.set(z);
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

  BitmapFont.install({
    name: FONT_NAME,
    style: new TextStyle({ fontSize: 32, fill: 0x00aaff, fontFamily: 'monospace', fontWeight: 'bold' }),
    chars: [['a', 'z'], ['A', 'Z'], ['0', '9'], '!@#$%&()_+-=.,:'],
    resolution: 2,
  });

  bitmapLayer = markRaw(new Container());
  textLayer = markRaw(new Container());

  const divider = markRaw(new Graphics());
  divider.setStrokeStyle({ width: 1, color: 0x444444 });
  divider.moveTo(0, 300).lineTo(1000, 300).stroke();

  const labelA = markRaw(new Text({ text: 'BitmapText (top) — GPU texture atlas, zoom-stable', style: new TextStyle({ fontSize: 11, fill: 0x888888 }) }));
  labelA.position.set(10, 8);
  const labelB = markRaw(new Text({ text: 'Text (bottom) — CPU rasterised, blurry when zoomed in', style: new TextStyle({ fontSize: 11, fill: 0x888888 }) }));
  labelB.position.set(10, 308);

  app.stage.addChild(divider, labelA, labelB, bitmapLayer, textLayer);

  buildScene(count.value);
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
      <label>Labels <input type="range" v-model.number="count" min="10" max="500" step="10" style="width:80px" /> {{ count }}</label>
      <button @click="buildScene(count)">Rebuild</button>
      <div class="sep" />
      <div style="font-size:11px;color:#777;margin-bottom:2px">Zoom</div>
      <div class="zoom-btns">
        <button v-for="z in [0.5, 1, 2, 4, 8]" :key="z" :class="{ active: zoom === z }" @click="applyZoom(z)">{{ z }}×</button>
      </div>
      <div style="font-size:10px;color:#555;margin-top:4px">Zoom in to see BitmapText stay crisp<br>while Text gets blurry</div>
    </div>
    <div class="hint">BitmapText = one texture atlas · Text = per-object canvas · zoom to compare</div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #0d0d0d; }
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
.zoom-btns { display: flex; gap: 4px; }
button { padding: 4px 10px; background: #2a2a2a; color: #888; border: 1px solid #444; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 12px; }
button.active { background: #0070e0; color: #fff; border-color: #0070e0; }
button:hover:not(.active) { background: #333; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #555;
  background: rgba(0,0,0,0.5); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
</style>
