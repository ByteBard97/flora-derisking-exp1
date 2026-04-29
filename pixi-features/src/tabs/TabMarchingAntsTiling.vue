<script setup lang="ts">
/**
 * Marching ants via TilingSprite — approach from pixijs-userland/marquee-selection.
 * Source: github.com/pixijs-userland/marquee-selection (MIT)
 * Creates a tiny dash texture once, then shifts tilePosition each frame.
 * No geometry rebuild. Rectangles only.
 */
import { ref, watch, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Container, Graphics, TilingSprite, Texture, Ticker, DOMAdapter } from 'pixi.js';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();

const speed     = ref(2);
const dashLen   = ref(8);
const gapLen    = ref(6);
const thickness = ref(2);

let app          = markRaw({} as Application);
let objectsLayer = markRaw({} as Container);
let marqueeLayer = markRaw({} as Container);
let currentTime  = 0;

const SELECTED_RECTS = [
  { x: 120, y: 80,  w: 200, h: 140 },
  { x: 420, y: 60,  w: 120, h: 220 },
  { x: 160, y: 320, w: 340, h: 100 },
] as const;

interface RectMarquee {
  whites: [TilingSprite, TilingSprite, TilingSprite, TilingSprite];
  blacks: [TilingSprite, TilingSprite, TilingSprite, TilingSprite];
  whiteTex: Texture;
  blackTex: Texture;
}
let marquees: RectMarquee[] = [];

function makeDashTexture(color: string): Texture {
  const d = dashLen.value;
  const g = gapLen.value;
  const canvas = DOMAdapter.get().createCanvas(d + g, d + g);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, d, d);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

function destroyMarquees() {
  for (const m of marquees) {
    for (const s of [...m.whites, ...m.blacks]) s.destroy();
    m.whiteTex.destroy(true);
    m.blackTex.destroy(true);
  }
  marquees = [];
  marqueeLayer.removeChildren();
}

function buildMarquees() {
  destroyMarquees();
  const t = thickness.value;
  const whiteTex = makeDashTexture('white');
  const blackTex = makeDashTexture('black');

  for (const r of SELECTED_RECTS) {
    const makeEdges = (tex: Texture): [TilingSprite, TilingSprite, TilingSprite, TilingSprite] => {
      const top    = new TilingSprite({ texture: tex, width: r.w + t * 2, height: t });
      const bottom = new TilingSprite({ texture: tex, width: r.w + t * 2, height: t });
      const left   = new TilingSprite({ texture: tex, width: t, height: r.h });
      const right  = new TilingSprite({ texture: tex, width: t, height: r.h });
      top.position.set(r.x - t, r.y - t);
      bottom.position.set(r.x - t, r.y + r.h);
      left.position.set(r.x - t, r.y);
      right.position.set(r.x + r.w, r.y);
      return [top, bottom, left, right];
    };

    const whites = makeEdges(whiteTex);
    const blacks = makeEdges(blackTex);

    // Offset blacks by dashLen so their dashes land in the whites' gaps
    for (const s of blacks) {
      s.tilePosition.x = dashLen.value;
      s.tilePosition.y = dashLen.value;
    }

    const m: RectMarquee = { whites, blacks, whiteTex, blackTex };
    marquees.push(m);
    for (const s of [...whites, ...blacks]) marqueeLayer.addChild(s);
  }
}

function onTick(ticker: Ticker) {
  currentTime += speed.value * ticker.deltaTime;
  const period = dashLen.value + gapLen.value;
  // Modulo prevents float precision drift over long sessions
  const t = currentTime % (period * 1000);
  const d = dashLen.value;

  for (const { whites, blacks } of marquees) {
    const [wTop, wBottom, wLeft, wRight] = whites;
    const [bTop, bBottom, bLeft, bRight] = blacks;

    wTop.tilePosition.x    =  t;
    wBottom.tilePosition.x = -t;
    wLeft.tilePosition.y   = -t;
    wRight.tilePosition.y  =  t;

    bTop.tilePosition.x    =  t + d;
    bBottom.tilePosition.x = -t + d;
    bLeft.tilePosition.y   = -t + d;
    bRight.tilePosition.y  =  t + d;
  }
}

watch([dashLen, gapLen, thickness], () => {
  if (marqueeLayer.children.length > 0) buildMarquees();
});

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
  marqueeLayer = markRaw(new Container());
  app.stage.addChild(objectsLayer, marqueeLayer);

  const gfx = markRaw(new Graphics());
  for (const r of SELECTED_RECTS) {
    gfx.setFillStyle({ color: 0x1a3a5c, alpha: 0.8 });
    gfx.setStrokeStyle({ width: 1, color: 0x2255aa });
    gfx.rect(r.x, r.y, r.w, r.h).fill().stroke();
  }
  objectsLayer.addChild(gfx);

  buildMarquees();
  app.ticker.add(onTick);
});

onUnmounted(() => {
  app?.ticker.remove(onTick);
  destroyMarquees();
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
      <label>Speed     <input type="range" v-model.number="speed"     min="0.2" max="6"  step="0.2" style="width:80px" /> {{ speed.toFixed(1) }}</label>
      <label>Dash      <input type="range" v-model.number="dashLen"   min="2"   max="24" step="1"   style="width:80px" /> {{ dashLen }}px</label>
      <label>Gap       <input type="range" v-model.number="gapLen"    min="2"   max="24" step="1"   style="width:80px" /> {{ gapLen }}px</label>
      <label>Thickness <input type="range" v-model.number="thickness" min="1"   max="6"  step="1"   style="width:80px" /> {{ thickness }}px</label>
      <div style="font-size:10px;color:#555;margin-top:4px;max-width:200px">
        TilingSprite — tiny texture, shift tilePosition each frame.<br>
        No GPU geometry rebuild. Rectangles only.
      </div>
    </div>
    <div class="hint">TilingSprite marching ants — shifts tilePosition.x/y, no redraw</div>
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
