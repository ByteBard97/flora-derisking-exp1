<script setup lang="ts">
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
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

function resetState() {
  lineStart = null;
  areaVerts.value = [];
  guideGfx.clear();
  fillGfx.clear();
  labelText.text = '';
  pathHovered = false;
  redrawBed(false);
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

function drawRubberBand(from: Point, to: Point) {
  guideGfx.clear();
  guideGfx.setStrokeStyle({ pixelLine: true, color: 0xff4444 });
  guideGfx.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke();
  guideGfx.beginPath();
  guideGfx.setFillStyle({ color: 0xff4444 });
  guideGfx.circle(from.x, from.y, 4).fill();
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
      drawRubberBand(lineStart, cursor);
      const distPx = euclideanPx(lineStart, cursor);
      updateLabel(formatFeet(pxToFeet(distPx, PX_PER_INCH, drawingScale.value)), midpoint(lineStart, cursor));
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
      lineStart = pt;
    } else {
      guideGfx.setStrokeStyle({ pixelLine: true, color: 0xffaa00 });
      guideGfx.moveTo(lineStart.x, lineStart.y).lineTo(pt.x, pt.y).stroke();
      const distPx = euclideanPx(lineStart, pt);
      updateLabel(formatFeet(pxToFeet(distPx, PX_PER_INCH, drawingScale.value)), midpoint(lineStart, pt));
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

  pathLayer  = markRaw(new Container());
  guideLayer = markRaw(new Container());
  labelLayer = markRaw(new Container());
  pathGfx    = markRaw(new Graphics());
  fillGfx    = markRaw(new Graphics());
  guideGfx   = markRaw(new Graphics());
  labelText  = markRaw(new BitmapText({ text: '', style: { fontFamily: 'MeasureFont', fontSize: 14 } }));

  pathLayer.addChild(pathGfx);
  guideLayer.addChild(fillGfx, guideGfx);
  labelLayer.addChild(labelText);
  app.stage.addChild(pathLayer, guideLayer, labelLayer);

  redrawBed(false);

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onClick);

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
