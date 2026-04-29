<script setup lang="ts">
/**
 * Tree symbol spike — plan-view landscape symbols in three styles.
 * Implementation from flora-studio/docs/research/followup-A-tree-symbol-impl.md
 * Shows watercolor / sketch / technical side-by-side for 4 species.
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics, Text, TextStyle, Container } from 'pixi.js';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();

let app = markRaw({} as Application);

// ---------------------------------------------------------------------------
// Seeded random
// ---------------------------------------------------------------------------

function hash01(seed: number): number {
  const s = Math.sin(seed) * 43758.5453;
  return s - Math.floor(s);
}

function positionSeed(x: number, y: number): number {
  return x * 12.9898 + y * 78.233;
}

// ---------------------------------------------------------------------------
// Style functions — each calls beginPath() to isolate from prior shapes
// ---------------------------------------------------------------------------

function drawWatercolor(gfx: Graphics, x: number, y: number, r: number, color: number) {
  const seed = positionSeed(x, y);

  // Shadow
  gfx.beginPath();
  gfx.circle(x + r * 0.15, y + r * 0.15, r * 0.95).fill({ color: 0x000000, alpha: 0.22 });

  // Canopy fill
  gfx.beginPath();
  gfx.circle(x, y, r).fill({ color, alpha: 0.6 });

  // 8 spokes — one beginPath+stroke per spoke to isolate
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const len   = r * (1 + (hash01(seed + i) - 0.5) * 0.2);
    gfx.beginPath();
    gfx.moveTo(x, y).lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
       .stroke({ color, width: 1, alpha: 0.55 });
  }
}

function drawSketch(gfx: Graphics, x: number, y: number, r: number, color: number) {
  const seed = positionSeed(x, y);

  // Wobbly outline — 60-point polygon with ±3px noise
  const pts: number[] = [];
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * Math.PI * 2;
    const wobble = (hash01(seed + i * 17.31) - 0.5) * 6;
    pts.push(x + Math.cos(angle) * (r + wobble), y + Math.sin(angle) * (r + wobble));
  }
  gfx.beginPath();
  gfx.poly(pts).stroke({ color, width: 1.5, alpha: 1 });

  // 6 bold spokes to 80% of radius
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    gfx.beginPath();
    gfx.moveTo(x, y).lineTo(x + Math.cos(angle) * r * 0.8, y + Math.sin(angle) * r * 0.8)
       .stroke({ color, width: 2, alpha: 1 });
  }

  // Trunk dot
  gfx.beginPath();
  gfx.circle(x, y, 3).fill({ color, alpha: 1 });
}

function drawTechnical(gfx: Graphics, x: number, y: number, r: number, color: number) {
  // Clean circle outline
  gfx.beginPath();
  gfx.circle(x, y, r).stroke({ color, width: 1, alpha: 1 });

  // 8 uniform spokes
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    gfx.beginPath();
    gfx.moveTo(x, y).lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r)
       .stroke({ color, width: 1, alpha: 1 });
  }

  // Trunk dot
  gfx.beginPath();
  gfx.circle(x, y, 4).fill({ color, alpha: 1 });
}

function drawTreeSymbol(
  gfx: Graphics,
  x: number, y: number,
  radius: number,
  color: number,
  style: 'watercolor' | 'sketch' | 'technical',
) {
  if (style === 'watercolor') drawWatercolor(gfx, x, y, radius, color);
  else if (style === 'sketch') drawSketch(gfx, x, y, radius, color);
  else                         drawTechnical(gfx, x, y, radius, color);
}

// ---------------------------------------------------------------------------
// Scene layout
// ---------------------------------------------------------------------------

const SPECIES = [
  { name: 'Oak',      color: 0x4a7c59, radius: 52 },
  { name: 'Magnolia', color: 0xc8a2c8, radius: 42 },
  { name: 'Azalea',   color: 0xff6b9d, radius: 36 },
  { name: 'Fern',     color: 0x7ec8a0, radius: 30 },
] as const;

const STYLES: Array<'watercolor' | 'sketch' | 'technical'> = ['watercolor', 'sketch', 'technical'];
const COL_X   = [110, 230, 345, 455];
const ROW_Y   = [90, 220, 340];
const ROW_LABEL_X = 18;

function buildScene(root: Container) {
  const BG_COLOR = 0xf5f0e8;

  // Warm paper background
  const bg = markRaw(new Graphics());
  bg.rect(0, 0, 580, 440).fill({ color: BG_COLOR });
  root.addChild(bg);

  // Column headers (species names)
  for (let c = 0; c < SPECIES.length; c++) {
    const sp = SPECIES[c];
    const t = markRaw(new Text({
      text: sp.name,
      style: new TextStyle({ fontSize: 11, fill: 0x556655, fontFamily: 'monospace', fontWeight: 'bold' }),
    }));
    t.anchor.set(0.5, 1);
    t.position.set(COL_X[c], ROW_Y[0] - SPECIES[c].radius - 8);
    root.addChild(t);
  }

  // Row labels (style names) + one Graphics per row
  for (let r = 0; r < STYLES.length; r++) {
    const style = STYLES[r];

    const label = markRaw(new Text({
      text: style,
      style: new TextStyle({ fontSize: 10, fill: 0x888877, fontFamily: 'monospace' }),
    }));
    label.anchor.set(0, 0.5);
    label.position.set(ROW_LABEL_X, ROW_Y[r]);
    root.addChild(label);

    const gfx = markRaw(new Graphics());
    root.addChild(gfx);

    for (let c = 0; c < SPECIES.length; c++) {
      const { color, radius } = SPECIES[c];
      drawTreeSymbol(gfx, COL_X[c], ROW_Y[r], radius, color, style);
    }
  }

  // Divider lines between rows
  const divGfx = markRaw(new Graphics());
  for (let r = 0; r < STYLES.length - 1; r++) {
    const y = (ROW_Y[r] + ROW_Y[r + 1]) / 2;
    divGfx.beginPath();
    divGfx.moveTo(0, y).lineTo(580, y).stroke({ color: 0xccccbb, width: 1, alpha: 0.6 });
  }
  root.addChild(divGfx);
}

onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    antialias: true,
    background: '#e8e4da',
    resolution: devicePixelRatio,
    autoDensity: true,
  });

  const root = markRaw(new Container());
  root.position.set(
    (canvas.clientWidth  - 580) / 2,
    (canvas.clientHeight - 440) / 2,
  );
  app.stage.addChild(root);
  buildScene(root);

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge');
    registerPixiBridge(app, {
      tabName: 'tree-symbol',
      getSnapshot: () => ({ styles: STYLES.length, species: SPECIES.length }),
    });
  }
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined;
  window.__pixiTestBridgeReady = false;
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
    <div class="hint">Plan-view tree symbols · watercolor · sketch · technical · 4 species</div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #e8e4da; }
canvas { display: block; width: 100%; height: 100%; }
.hud { position: absolute; top: 10px; left: 10px; font-family: monospace; font-size: 12px; color: #666; line-height: 1.7; pointer-events: none; }
.fps { font-size: 18px; font-weight: bold; }
.fps span { font-size: 12px; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #999;
  background: rgba(255,255,255,0.6); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
</style>
