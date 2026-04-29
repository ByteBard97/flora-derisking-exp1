<script setup lang="ts">
/**
 * MSDF text spike.
 *
 * Tests whether Pixi v8's BitmapText renderer handles an MSDF font atlas
 * cleanly at 300 labels with varied font sizes in a single frame — the old
 * batcher glitch (jakerdy/pixi-msdf-examples) rendered corrupted glyphs when
 * many MSDF labels at different scales appeared together. If this tab looks
 * correct at all zoom levels, MSDF is proven safe for flora-studio.
 *
 * Font generated with msdf-bmfont-xml from Times New Roman at 48px / range 6.
 * Atlas: public/fonts/times-new-roman.png
 * Descriptor: public/fonts/Times New Roman.fnt
 */
import { onMounted, onUnmounted, ref } from 'vue';
import { Application, Assets, BitmapText, Container } from 'pixi.js';
import { Viewport } from 'pixi-viewport';

const FONT_PATH = '/fonts/Times New Roman.fnt';
const LABEL_COUNT = 300;
const WORLD_W = 2400;
const WORLD_H = 3600;

const canvasEl = ref<HTMLCanvasElement>();
const containerEl = ref<HTMLDivElement>();
const statusMsg = ref<string>('Loading MSDF font…');
const zoomLevel = ref(1);
const fontLoaded = ref(false);

let app: Application | null = null;

onMounted(async () => {
  app = new Application();
  await app.init({
    canvas: canvasEl.value!,
    width: containerEl.value!.clientWidth,
    height: containerEl.value!.clientHeight,
    antialias: true,
    background: '#1a1a2e',
    resolution: devicePixelRatio,
    autoDensity: true,
  });

  const W = containerEl.value!.clientWidth;
  const H = containerEl.value!.clientHeight;

  const viewport = new Viewport({
    screenWidth: W,
    screenHeight: H,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
    events: app.renderer.events,
  });
  viewport.drag().wheel({ smooth: 8 }).decelerate({ friction: 0.93 }).clampZoom({ minScale: 0.05, maxScale: 20 }).pinch();
  viewport.on('zoomed', () => { zoomLevel.value = viewport.scale.x; });
  app.stage.addChild(viewport);
  viewport.moveCenter(WORLD_W / 2, WORLD_H / 2);

  // Load MSDF font
  try {
    await Assets.load(FONT_PATH);
    fontLoaded.value = true;
    statusMsg.value = `MSDF font loaded — ${LABEL_COUNT} labels at mixed sizes`;
  } catch (e) {
    statusMsg.value = `ERROR loading font: ${e}`;
    return;
  }

  // Scatter labels across the world at three different font sizes.
  // The old batcher bug only manifests when multiple sizes appear in the same
  // draw call — so we intentionally mix sizes within the same frame.
  const sizes = [10, 16, 24];
  const labels = [
    'OAK-01', 'MAG-02', 'AZA-03', 'FER-04', 'OAK-05',
    'Quercus virginiana', 'Muhlenbergia capillaris', 'Salvia coccinea',
  ];

  const world = new Container();
  viewport.addChild(world);

  for (let i = 0; i < LABEL_COUNT; i++) {
    const fontSize = sizes[i % sizes.length];
    const text = labels[i % labels.length] + ` ${i + 1}`;

    const label = new BitmapText({
      text,
      style: { fontFamily: 'Times New Roman', fontSize },
    });
    label.anchor.set(0.5, 0.5);
    label.x = Math.random() * WORLD_W;
    label.y = Math.random() * WORLD_H;
    world.addChild(label);
  }

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'msdf-text',
      getSnapshot: () => ({
        fontLoaded: fontLoaded.value,
        labelCount: LABEL_COUNT,
        zoomLevel: zoomLevel.value,
        statusMsg: statusMsg.value,
      }),
    })
  }
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined
  window.__pixiTestBridgeReady = false
  Assets.unload(FONT_PATH)
  app?.destroy(true);
  app = null;
});
</script>

<template>
  <div ref="containerEl" class="wrap">
    <canvas ref="canvasEl" class="canvas" />

    <div class="hud">
      <div class="title">MSDF Text Spike</div>
      <div>{{ statusMsg }}</div>
      <div>zoom: {{ zoomLevel.toFixed(3) }}</div>
      <div class="instructions">
        Zoom in and out — labels should stay crisp at all zoom levels.<br>
        Any blurry or corrupt glyphs = batcher bug still present.
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; }
.canvas { width: 100%; height: 100%; display: block; }
.hud {
  position: absolute; top: 10px; left: 10px;
  font-family: monospace; font-size: 11px; color: #0f0;
  background: rgba(0,0,0,0.8); padding: 10px 14px; border-radius: 4px;
  pointer-events: none; line-height: 1.8; max-width: 320px;
}
.title { font-size: 13px; font-weight: bold; margin-bottom: 4px; }
.instructions { margin-top: 8px; color: #888; font-size: 10px; line-height: 1.5; }
</style>
