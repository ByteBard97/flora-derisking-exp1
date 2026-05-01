<script setup lang="ts">
import { ref, onMounted, onUnmounted, markRaw, computed } from 'vue';
import {
  Application, Graphics, BitmapText, BitmapFont, Container,
} from 'pixi.js';
import { Bezier } from 'bezier-js';
import { useFps } from '../shared/useFps';
import {
  euclideanPx, pxToFeet, polygonAreaPx, pxSqToSqFt,
  pathLengthPx, midpoint, centroid, formatFeet, formatSqFt,
  type Point, type CubicSegment,
} from '../lib/measureUtils';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();

const drawingScale = ref(20);
const PX_PER_INCH = 96;

type Mode = 'line' | 'area' | 'path';
const mode = ref<Mode>('line');

const endCap = ref<'tick' | 'arrow'>('tick');
const persistMode = ref<'ephemeral' | 'sticky'>('ephemeral');
const angleMode = ref<'free' | 'h' | 'v' | '45'>('free');
const labelStyle = ref<'rotated' | 'horizontal'>('rotated');

let app = markRaw({} as Application);
let guideLayer  = markRaw({} as Container);
let labelLayer  = markRaw({} as Container);
let pathLayer   = markRaw({} as Container);
let guideGfx    = markRaw({} as Graphics);
let fillGfx     = markRaw({} as Graphics);
let pathGfx     = markRaw({} as Graphics);
let labelText   = markRaw({} as BitmapText);

let lineStart: Point | null = null;
const areaVerts = ref<Point[]>([]);
let cursor: Point = { x: 0, y: 0 };

const BED_SEGMENTS: CubicSegment[] = [
  { p0: {x:200,y:150}, cp1: {x:350,y:100}, cp2: {x:500,y:100}, p1: {x:550,y:200} },
  { p0: {x:550,y:200}, cp1: {x:600,y:300}, cp2: {x:600,y:350}, p1: {x:500,y:420} },
  { p0: {x:500,y:420}, cp1: {x:350,y:500}, cp2: {x:200,y:480}, p1: {x:150,y:380} },
  { p0: {x:150,y:380}, cp1: {x:100,y:280}, cp2: {x:100,y:200}, p1: {x:200,y:150} },
];
let pathHovered = false;

const stickyMeasurements: Container[] = [];
let stickyLayer = markRaw({} as Container);
let activeLabelContainer: Container | null = null;
let onKey: ((e: KeyboardEvent) => void) | null = null;

function resetState() {
  lineStart = null;
  areaVerts.value = [];
  guideGfx.clear();
  fillGfx.clear();
  labelText.text = '';
  pathHovered = false;
  redrawBed(false);
  if (activeLabelContainer) {
    labelLayer.removeChild(activeLabelContainer);
    activeLabelContainer = null;
  }
}

function redrawBed(hovered: boolean) {
  pathGfx.clear();
  pathGfx.setStrokeStyle({ width: hovered ? 3 : 1.5, color: hovered ? 0x00ff88 : 0x334466 });
  pathGfx.setFillStyle({ color: 0x1a2a3a, alpha: 0.6 });
  const [first, ...rest] = BED_SEGMENTS;
  pathGfx.moveTo(first.p0.x, first.p0.y);
  for (const s of [first, ...rest]) {
    pathGfx.bezierCurveTo(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.p1.x, s.p1.y);
  }
  pathGfx.closePath().fill().stroke();
}

function applyAngleConstraint(from: Point, raw: Point): Point {
  if (angleMode.value === 'free') return raw;
  if (angleMode.value === 'h') return { x: raw.x, y: from.y };
  if (angleMode.value === 'v') return { x: from.x, y: raw.y };
  const dx = raw.x - from.x, dy = raw.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return raw;
  const raw_angle = Math.atan2(dy, dx);
  const angle = Math.round(raw_angle / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + Math.cos(angle) * dist, y: from.y + Math.sin(angle) * dist };
}

function drawDimLine(gfx: Graphics, from: Point, to: Point) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const angle = Math.atan2(dy, dx);
  const len = Math.hypot(dx, dy);

  // Line
  gfx.setStrokeStyle({ width: 1.5, color: 0xd0dde8 });
  gfx.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke();
  gfx.beginPath();

  const TICK_LEN = 10;
  const ARROW_LEN = 12;
  const ARROW_WIDTH = 5;
  const perp = angle + Math.PI / 2;
  const px = Math.cos(perp), py = Math.sin(perp);

  if (endCap.value === 'tick') {
    // Perpendicular tick at from
    gfx.setStrokeStyle({ width: 1.5, color: 0xd0dde8 });
    gfx.moveTo(from.x - px * TICK_LEN/2, from.y - py * TICK_LEN/2)
       .lineTo(from.x + px * TICK_LEN/2, from.y + py * TICK_LEN/2).stroke();
    gfx.beginPath();
    // Perpendicular tick at to
    gfx.moveTo(to.x - px * TICK_LEN/2, to.y - py * TICK_LEN/2)
       .lineTo(to.x + px * TICK_LEN/2, to.y + py * TICK_LEN/2).stroke();
    gfx.beginPath();
  } else {
    // Filled arrowhead pointing inward at from
    const ax = Math.cos(angle), ay = Math.sin(angle);
    gfx.setFillStyle({ color: 0xd0dde8 });
    gfx.moveTo(from.x, from.y)
       .lineTo(from.x + ax * ARROW_LEN - px * ARROW_WIDTH, from.y + ay * ARROW_LEN - py * ARROW_WIDTH)
       .lineTo(from.x + ax * ARROW_LEN + px * ARROW_WIDTH, from.y + ay * ARROW_LEN + py * ARROW_WIDTH)
       .closePath().fill();
    gfx.beginPath();
    // Filled arrowhead pointing inward at to (reversed direction)
    const bx = -ax, by = -ay;
    gfx.moveTo(to.x, to.y)
       .lineTo(to.x + bx * ARROW_LEN - px * ARROW_WIDTH, to.y + by * ARROW_LEN - py * ARROW_WIDTH)
       .lineTo(to.x + bx * ARROW_LEN + px * ARROW_WIDTH, to.y + by * ARROW_LEN + py * ARROW_WIDTH)
       .closePath().fill();
    gfx.beginPath();
  }
}

function makeLabelContainer(text: string): Container {
  const c = new Container();
  const badge = new Graphics();
  const txt = new BitmapText({ text, style: { fontFamily: 'MeasureFont', fontSize: 13 } });
  // Measure text first by setting it, then read width/height
  // Badge: rounded rect, 6px padding horizontal, 3px vertical
  const PAD_X = 8, PAD_Y = 4;
  const w = txt.width + PAD_X * 2;
  const h = txt.height + PAD_Y * 2;
  badge.setFillStyle({ color: 0x0a0e14, alpha: 0.82 });
  badge.setStrokeStyle({ width: 1, color: 0x4a6a8a });
  badge.roundRect(-w/2, -h/2, w, h, 4).fill().stroke();
  txt.position.set(-txt.width/2, -txt.height/2);
  c.addChild(badge, txt);
  return c;
}

function normalizeAngle(a: number): number {
  if (a > Math.PI / 2) return a - Math.PI;
  if (a < -Math.PI / 2) return a + Math.PI;
  return a;
}

function positionLabel(container: Container, from: Point, to: Point) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const angle = normalizeAngle(Math.atan2(dy, dx));
  const mid = midpoint(from, to);
  container.position.set(mid.x, mid.y);
  if (labelStyle.value === 'rotated') {
    container.rotation = angle;
  } else {
    container.rotation = 0;
    const perp = angle + Math.PI / 2;
    container.position.set(mid.x + Math.cos(perp) * 14, mid.y + Math.sin(perp) * 14);
  }
}

function drawAreaGuide(verts: Point[], cur: Point) {
  fillGfx.clear();
  if (verts.length < 1) return;
  const poly = [...verts, cur];
  fillGfx.setFillStyle({ color: 0x00aaff, alpha: 0.15 });
  fillGfx.moveTo(poly[0].x, poly[0].y);
  for (const p of poly.slice(1)) fillGfx.lineTo(p.x, p.y);
  fillGfx.closePath().fill();
  guideGfx.clear();
  guideGfx.setStrokeStyle({ pixelLine: true, color: 0x00aaff });
  guideGfx.moveTo(verts[0].x, verts[0].y);
  for (const p of verts.slice(1)) guideGfx.lineTo(p.x, p.y);
  guideGfx.lineTo(cur.x, cur.y);
  guideGfx.stroke();
  guideGfx.beginPath();
  guideGfx.setFillStyle({ color: 0x00aaff });
  for (const p of verts) { guideGfx.circle(p.x, p.y, 4).fill(); guideGfx.beginPath(); }
  if (verts.length >= 2) {
    guideGfx.setFillStyle({ color: 0xffffff, alpha: 0.6 });
    guideGfx.circle(verts[0].x, verts[0].y, 7).fill();
  }
}

function updateLabel(text: string, pos: Point) {
  labelText.text = text;
  labelText.position.set(pos.x + 10, pos.y - 18);
}

function isCursorNearBed(p: Point, threshold = 12): boolean {
  for (const s of BED_SEGMENTS) {
    const b = new Bezier(s.p0.x, s.p0.y, s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.p1.x, s.p1.y);
    const nearest = b.project(p);
    if (Math.hypot(nearest.x - p.x, nearest.y - p.y) < threshold) return true;
  }
  return false;
}

function onMove(e: PointerEvent) {
  const rect = canvasEl.value!.getBoundingClientRect();
  cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };

  if (mode.value === 'line') {
    if (lineStart) {
      const constrained = applyAngleConstraint(lineStart, cursor);
      guideGfx.clear();
      drawDimLine(guideGfx, lineStart, constrained);
      const distPx = euclideanPx(lineStart, constrained);
      const text = formatFeet(pxToFeet(distPx, PX_PER_INCH, drawingScale.value));
      if (activeLabelContainer) {
        labelLayer.removeChild(activeLabelContainer);
      }
      activeLabelContainer = makeLabelContainer(text);
      positionLabel(activeLabelContainer, lineStart, constrained);
      labelLayer.addChild(activeLabelContainer);
    }
  } else if (mode.value === 'area') {
    if (areaVerts.value.length > 0) {
      drawAreaGuide(areaVerts.value, cursor);
      const poly = [...areaVerts.value, cursor];
      const areaSqFt = pxSqToSqFt(polygonAreaPx(poly), PX_PER_INCH, drawingScale.value);
      updateLabel(formatSqFt(areaSqFt), centroid(poly));
    }
  } else if (mode.value === 'path') {
    const near = isCursorNearBed(cursor);
    if (near !== pathHovered) {
      pathHovered = near;
      redrawBed(near);
    }
    if (near) {
      const lenFt = pxToFeet(pathLengthPx(BED_SEGMENTS), PX_PER_INCH, drawingScale.value);
      updateLabel(`Path: ${formatFeet(lenFt)}`, cursor);
    } else {
      labelText.text = '';
    }
  }
}

function onClick(e: PointerEvent) {
  if (e.button !== 0) return;
  const rect = canvasEl.value!.getBoundingClientRect();
  const pt: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };

  if (mode.value === 'line') {
    if (!lineStart) {
      // Starting a new measurement — clear previous ephemeral guide/label
      guideGfx.clear();
      if (activeLabelContainer) {
        labelLayer.removeChild(activeLabelContainer);
        activeLabelContainer = null;
      }
      lineStart = pt;
    } else {
      const constrained = applyAngleConstraint(lineStart, pt);
      const distPx = euclideanPx(lineStart, constrained);
      const text = formatFeet(pxToFeet(distPx, PX_PER_INCH, drawingScale.value));

      if (persistMode.value === 'sticky') {
        const container = new Container();
        const gfx = new Graphics();
        drawDimLine(gfx, lineStart, constrained);
        const lbl = makeLabelContainer(text);
        positionLabel(lbl, lineStart, constrained);
        container.addChild(gfx, lbl);
        stickyLayer.addChild(container);
        stickyMeasurements.push(container);
      } else {
        // Ephemeral: draw onto guideGfx (already has rubber-band) and keep activeLabelContainer
        guideGfx.clear();
        drawDimLine(guideGfx, lineStart, constrained);
        if (activeLabelContainer) {
          labelLayer.removeChild(activeLabelContainer);
        }
        activeLabelContainer = makeLabelContainer(text);
        positionLabel(activeLabelContainer, lineStart, constrained);
        labelLayer.addChild(activeLabelContainer);
      }

      lineStart = null;
    }
  } else if (mode.value === 'area') {
    if (areaVerts.value.length >= 3) {
      const first = areaVerts.value[0];
      if (Math.hypot(pt.x - first.x, pt.y - first.y) < 14) {
        const areaSqFt = pxSqToSqFt(polygonAreaPx(areaVerts.value), PX_PER_INCH, drawingScale.value);
        updateLabel(formatSqFt(areaSqFt), centroid(areaVerts.value));
        fillGfx.clear();
        fillGfx.setFillStyle({ color: 0x00aaff, alpha: 0.2 });
        fillGfx.moveTo(areaVerts.value[0].x, areaVerts.value[0].y);
        for (const p of areaVerts.value.slice(1)) fillGfx.lineTo(p.x, p.y);
        fillGfx.closePath().fill();
        areaVerts.value = [];
        return;
      }
    }
    areaVerts.value.push(pt);
  }
}

function clearSticky() {
  for (const c of stickyMeasurements) stickyLayer.removeChild(c);
  stickyMeasurements.length = 0;
}

const btnStyle = computed(() => (active: boolean) => ({
  padding: '3px 10px',
  background: active ? '#0070e0' : '#2a2a2a',
  color: active ? '#fff' : '#888',
  border: '1px solid #444',
  borderRadius: '3px',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '11px',
}));

onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    antialias: true,
    background: '#0e1014',
    resolution: devicePixelRatio,
    autoDensity: true,
  });

  BitmapFont.install({
    name: 'MeasureFont',
    style: { fontSize: 24, fill: 0xffffff, fontFamily: 'monospace' },
    resolution: 2,
  });

  pathLayer   = markRaw(new Container());
  guideLayer  = markRaw(new Container());
  labelLayer  = markRaw(new Container());
  stickyLayer = markRaw(new Container());
  pathGfx     = markRaw(new Graphics());
  fillGfx     = markRaw(new Graphics());
  guideGfx    = markRaw(new Graphics());
  labelText   = markRaw(new BitmapText({ text: '', style: { fontFamily: 'MeasureFont', fontSize: 14 } }));

  pathLayer.addChild(pathGfx);
  guideLayer.addChild(fillGfx, guideGfx);
  labelLayer.addChild(labelText);
  app.stage.addChild(pathLayer, guideLayer, stickyLayer, labelLayer);

  redrawBed(false);

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onClick);

  onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    lineStart = null;
    guideGfx.clear();
    if (activeLabelContainer) {
      labelLayer.removeChild(activeLabelContainer);
      activeLabelContainer = null;
    }
  };
  window.addEventListener('keydown', onKey);

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge');
    registerPixiBridge(app, {
      tabName: 'measure',
      getSnapshot: () => ({ mode: mode.value, areaVertCount: areaVerts.value.length }),
    });
  }
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined;
  window.__pixiTestBridgeReady = false;
  canvasEl.value?.removeEventListener('pointermove', onMove);
  canvasEl.value?.removeEventListener('pointerdown', onClick);
  if (onKey) window.removeEventListener('keydown', onKey);
  app?.destroy(true, { children: true, texture: true });
});
</script>

<template>
  <div style="width:100%;height:100%;position:relative;overflow:hidden">
    <canvas ref="canvasEl" style="width:100%;height:100%;display:block" />

    <div style="position:absolute;top:10px;left:10px;font-family:monospace;font-size:12px;color:#0f0;pointer-events:none">
      <div>{{ fps }} fps · {{ frameMs }} ms</div>
    </div>

    <div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:6px">
      <button
        v-for="m in (['line','area','path'] as const)" :key="m"
        @click="mode = m; resetState()"
        :style="{ padding:'4px 14px', background: mode===m ? '#0070e0' : '#2a2a2a',
                  color: mode===m ? '#fff' : '#888', border:'1px solid #444',
                  borderRadius:'3px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }"
      >{{ m === 'line' ? 'Line Dist' : m === 'area' ? 'Area' : 'Path Length' }}</button>
    </div>

    <div v-if="mode === 'line'" style="position:absolute;top:46px;left:50%;transform:translateX(-50%);display:flex;gap:16px;align-items:center;font-family:monospace;font-size:11px;color:#888">
      <!-- End caps -->
      <div style="display:flex;gap:4px;align-items:center">
        <span style="color:#555;margin-right:2px">caps</span>
        <button v-for="opt in [['tick','Ticks'],['arrow','Arrows']]" :key="opt[0]"
          @click="endCap = opt[0] as any"
          :style="btnStyle(endCap === opt[0])">{{ opt[1] }}</button>
      </div>
      <!-- Mode -->
      <div style="display:flex;gap:4px;align-items:center">
        <span style="color:#555;margin-right:2px">mode</span>
        <button v-for="opt in [['ephemeral','Ephemeral'],['sticky','Sticky']]" :key="opt[0]"
          @click="persistMode = opt[0] as any"
          :style="btnStyle(persistMode === opt[0])">{{ opt[1] }}</button>
      </div>
      <!-- Angle -->
      <div style="display:flex;gap:4px;align-items:center">
        <span style="color:#555;margin-right:2px">angle</span>
        <button v-for="opt in [['free','Free'],['h','H'],['v','V'],['45','45°']]" :key="opt[0]"
          @click="angleMode = opt[0] as any"
          :style="btnStyle(angleMode === opt[0])">{{ opt[1] }}</button>
      </div>
      <!-- Label -->
      <div style="display:flex;gap:4px;align-items:center">
        <span style="color:#555;margin-right:2px">label</span>
        <button v-for="opt in [['rotated','Rotated'],['horizontal','Horizontal']]" :key="opt[0]"
          @click="labelStyle = opt[0] as any"
          :style="btnStyle(labelStyle === opt[0])">{{ opt[1] }}</button>
      </div>
      <!-- Clear All (sticky only) -->
      <button v-if="persistMode === 'sticky'" @click="clearSticky"
        style="padding:3px 10px;background:#3a1a1a;color:#ff6666;border:1px solid #662222;border-radius:3px;cursor:pointer">
        Clear All
      </button>
    </div>

    <div style="position:absolute;bottom:10px;left:10px;font-family:monospace;font-size:11px;color:#888">
      Scale: 1" = <input type="number" v-model.number="drawingScale" min="1" max="200"
        style="width:44px;background:#222;border:1px solid #444;color:#ccc;font-family:monospace;font-size:11px;padding:1px 4px" /> ft
    </div>

    <div style="position:absolute;bottom:10px;right:10px;font-family:monospace;font-size:11px;color:#444;text-align:right">
      <template v-if="mode==='line'">Click start → click end</template>
      <template v-else-if="mode==='area'">Click vertices · click start point to close</template>
      <template v-else>Hover the bed path</template>
    </div>
  </div>
</template>
