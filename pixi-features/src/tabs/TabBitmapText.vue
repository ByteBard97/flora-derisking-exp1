<script setup lang="ts">
/**
 * BitmapText vs Text comparison at various zoom levels.
 * BitmapText uses a GPU texture atlas — stays crisp at any zoom.
 * Text re-rasterises at each zoom — blurry when zoomed in, expensive at high DPI.
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, BitmapFont, BitmapText, Text, TextStyle, Container, Graphics } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();
const zoom = ref(1);

const WORLD_W = 1000;
const HALF_H = 600;
const DIVIDER_Y = HALF_H;
const WORLD_H = HALF_H * 2;

let app = markRaw({} as Application);
let viewport = markRaw({} as Viewport);
let bitmapLayer = markRaw({} as Container);
let textLayer = markRaw({} as Container);

const FONT_NAME = 'LabelFont';
const SAMPLE_TEXT = 'Quercus virginiana 24';
const SAMPLE_FONT_SIZE = 48;

function buildScene() {
  bitmapLayer.removeChildren();
  textLayer.removeChildren();

  const bt = markRaw(new BitmapText({
    text: SAMPLE_TEXT,
    style: { fontFamily: FONT_NAME, fontSize: SAMPLE_FONT_SIZE, fill: 0x6ec1ff },
  }));
  // Anchor each label to the boundary so they sit directly above/below the
  // divider line — easy to compare without panning between them.
  bt.anchor.set(0.5, 1);
  bt.position.set(WORLD_W / 2, DIVIDER_Y - 16);
  bitmapLayer.addChild(bt);

  const style = new TextStyle({ fontSize: SAMPLE_FONT_SIZE, fill: 0x00ff99, fontFamily: 'serif' });
  const t = markRaw(new Text({ text: SAMPLE_TEXT, style }));
  t.anchor.set(0.5, 0);
  t.position.set(WORLD_W / 2, DIVIDER_Y + 16);
  textLayer.addChild(t);
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

  // Atlas baked at 64px × 4 resolution → effective 256px glyphs.
  // Stays crisp up to ~5× zoom of a 48px label; beyond that, raster pixelation
  // becomes visible — the inherent BitmapText limitation that motivates MSDF.
  BitmapFont.install({
    name: FONT_NAME,
    style: new TextStyle({ fontSize: 64, fill: 0xffffff, fontFamily: 'serif' }),
    chars: [['a', 'z'], ['A', 'Z'], ['0', '9'], ' !@#$%&()_+-=.,:'],
    resolution: 4,
  });

  viewport = markRaw(new Viewport({
    screenWidth: canvas.clientWidth,
    screenHeight: canvas.clientHeight,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
    events: app.renderer.events,
  }));
  viewport.drag().wheel({ smooth: 8 }).decelerate({ friction: 0.93 }).clampZoom({ minScale: 0.2, maxScale: 16 }).pinch();
  viewport.on('zoomed', () => { zoom.value = viewport.scale.x; });
  app.stage.addChild(viewport);

  bitmapLayer = markRaw(new Container());
  textLayer = markRaw(new Container());

  // Tinted half-backgrounds so the boundary is unmissable even when panning.
  const topBg = markRaw(new Graphics());
  topBg.rect(0, 0, WORLD_W, HALF_H).fill({ color: 0x0a1428, alpha: 0.6 });
  const bottomBg = markRaw(new Graphics());
  bottomBg.rect(0, HALF_H, WORLD_W, HALF_H).fill({ color: 0x0a1f14, alpha: 0.6 });

  // Bold divider line.
  const divider = markRaw(new Graphics());
  divider.moveTo(-2000, DIVIDER_Y).lineTo(WORLD_W + 2000, DIVIDER_Y)
    .stroke({ width: 4, color: 0xff8800, alpha: 0.9 });

  const headerStyle = new TextStyle({ fontSize: 14, fill: 0xffaa44, fontFamily: 'monospace', fontWeight: 'bold' });
  const labelA = markRaw(new Text({ text: '▲ BitmapText (atlas)', style: headerStyle }));
  labelA.position.set(12, 12);
  const labelB = markRaw(new Text({ text: '▼ Text (CPU rasterised)', style: headerStyle }));
  labelB.position.set(12, WORLD_H - 28);

  viewport.addChild(topBg, bottomBg, divider, labelA, labelB, bitmapLayer, textLayer);

  buildScene();
  viewport.fit(true, WORLD_W, WORLD_H);
  viewport.moveCenter(WORLD_W / 2, WORLD_H / 2);

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'bitmap-text',
      getSnapshot: () => ({
        bitmapLabelCount: bitmapLayer.children.length,
        textLabelCount: textLayer.children.length,
        zoomLevel: zoom.value,
      }),
    })
  }
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined
  window.__pixiTestBridgeReady = false
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
      <div style="font-size:11px;color:#777">zoom: {{ zoom.toFixed(2) }}×</div>
      <div style="font-size:10px;color:#555;margin-top:2px">drag to pan · wheel to zoom<br>top stays crisp · bottom goes blurry</div>
    </div>
    <div class="hint">BitmapText (top, blue) baked atlas · Text (bottom, green) CPU rasterised · MSDF tab is the third tier</div>
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
