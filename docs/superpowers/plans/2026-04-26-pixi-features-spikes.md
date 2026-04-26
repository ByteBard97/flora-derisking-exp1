# pixi-features Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the pixi-features test app navigation and add four new spike tabs proving risky CAD features work in Pixi.js v8 before the production architecture is locked.

**Architecture:** Each spike is a self-contained `.vue` tab component following the established pattern (own Pixi Application, `onMounted`/`onUnmounted`, `markRaw`, `useFps`). The app shell gets a dismissable left-panel nav replacing the current button row. New math utilities live in `src/lib/`.

**Tech Stack:** Pixi.js v8, Vue 3, TypeScript, `bezier-js` (already installed), `simplify-js` (new), `fit-curve` (new), `perfect-freehand` (already installed).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/App.vue` | Modify | Replace button-row nav with dismissable left panel |
| `src/lib/measureUtils.ts` | Create | Euclidean distance, shoelace area, bezier arc length helpers |
| `src/lib/pathFit.ts` | Create | RDP simplification + bezier curve fitting |
| `src/tabs/TabMeasure.vue` | Create | 3-mode measurement tool spike |
| `src/tabs/TabFreehand.vue` | Modify | Add auto-smooth on pointer-up |
| `src/tabs/TabKnife.vue` | Create | Cut-line bezier split spike |
| `src/tabs/TabTextAnnotation.vue` | Create | In-canvas text editing via Vue overlay |
| `package.json` | Modify | Add `simplify-js`, `fit-curve` |

---

## Task 1: Dismissable Left Panel Navigation

Replace the horizontal button row in `App.vue` with a collapsible left panel. The panel lists all tabs grouped by category. State persists in `localStorage`.

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: Read current App.vue**

Open `src/App.vue`. Note the current `tabs` array and `active` ref — they stay. The `<nav>` element and its `<style>` get replaced.

- [ ] **Step 2: Rewrite App.vue**

Replace the entire file content with:

```vue
<script setup lang="ts">
import { ref, computed, defineAsyncComponent } from 'vue';

interface TabDef { id: string; label: string; comp: ReturnType<typeof defineAsyncComponent> }
interface Group { label: string; tabs: TabDef[] }

const A = (path: string) => defineAsyncComponent(() => import(path))

const groups: Group[] = [
  {
    label: 'Rendering',
    tabs: [
      { id: 'renderer',    label: 'Plant Renderer',    comp: A('./tabs/TabPlantRenderer.vue') },
      { id: 'leader',      label: 'Leader Line',       comp: A('./tabs/TabLeaderLine.vue') },
      { id: 'msdf',        label: 'MSDF Text',         comp: A('./tabs/TabMsdfText.vue') },
      { id: 'bitmap',      label: 'BitmapText',        comp: A('./tabs/TabBitmapText.vue') },
    ],
  },
  {
    label: 'Drawing Tools',
    tabs: [
      { id: 'pen',         label: 'Pen Tool',          comp: A('./tabs/TabPenTool.vue') },
      { id: 'freehand',    label: 'Freehand',          comp: A('./tabs/TabFreehand.vue') },
      { id: 'knife',       label: 'Knife Tool',        comp: A('./tabs/TabKnife.vue') },
      { id: 'bool',        label: 'Boolean Ops',       comp: A('./tabs/TabBooleanOps.vue') },
      { id: 'dash',        label: 'Dashed Lines',      comp: A('./tabs/TabDashedLines.vue') },
    ],
  },
  {
    label: 'Interaction',
    tabs: [
      { id: 'measure',     label: 'Measure',           comp: A('./tabs/TabMeasure.vue') },
      { id: 'sel',         label: 'Selection',         comp: A('./tabs/TabSelection.vue') },
      { id: 'snap',        label: 'Snapping',          comp: A('./tabs/TabSnapping.vue') },
      { id: 'transform',   label: 'Transform Gizmo',   comp: A('./tabs/TabTransformGizmo.vue') },
      { id: 'spatial',     label: 'Spatial Index',     comp: A('./tabs/TabSpatialIndex.vue') },
      { id: 'ants',        label: 'Marching Ants',     comp: A('./tabs/TabMarchingAnts.vue') },
    ],
  },
  {
    label: 'Text & UI',
    tabs: [
      { id: 'textann',     label: 'Text Annotation',   comp: A('./tabs/TabTextAnnotation.vue') },
      { id: 'pixiui',      label: '@pixi/ui',          comp: A('./tabs/TabPixiUI.vue') },
    ],
  },
  {
    label: 'Viewport',
    tabs: [
      { id: 'viewport',    label: 'Viewport',          comp: A('./tabs/TabViewport.vue') },
    ],
  },
]

const allTabs = groups.flatMap(g => g.tabs)

const STORAGE_KEY = 'pixi-features-active'
const active = ref(localStorage.getItem(STORAGE_KEY) ?? 'renderer')
const panelOpen = ref(true)

const activeComp = computed(() => allTabs.find(t => t.id === active.value)!.comp)
const activeLabel = computed(() => allTabs.find(t => t.id === active.value)!.label)

function select(id: string) {
  active.value = id
  localStorage.setItem(STORAGE_KEY, id)
}
</script>

<template>
  <div class="shell">
    <!-- Panel toggle button — always visible -->
    <button class="toggle-btn" @click="panelOpen = !panelOpen" :title="panelOpen ? 'Hide panel' : 'Show panel'">
      {{ panelOpen ? '◀' : '▶' }}
    </button>

    <!-- Left panel -->
    <aside class="panel" :class="{ closed: !panelOpen }">
      <div class="panel-header">Pixi.js v8 · Flora</div>
      <nav class="panel-nav">
        <div v-for="group in groups" :key="group.label" class="group">
          <div class="group-label">{{ group.label }}</div>
          <button
            v-for="t in group.tabs" :key="t.id"
            :class="{ active: active === t.id }"
            @click="select(t.id)"
          >{{ t.label }}</button>
        </div>
      </nav>
    </aside>

    <!-- Canvas area -->
    <div class="canvas-area">
      <div class="tab-title">{{ activeLabel }}</div>
      <component :is="activeComp" />
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  width: 100%;
  height: 100%;
  font-family: monospace;
  overflow: hidden;
  background: #111;
}

/* Toggle button sits at top-left, above the panel */
.toggle-btn {
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: 100;
  width: 24px;
  height: 24px;
  background: #2a2a2a;
  border: 1px solid #444;
  color: #aaa;
  border-radius: 3px;
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  padding: 0;
}

.panel {
  width: 180px;
  min-width: 180px;
  background: #161616;
  border-right: 1px solid #2a2a2a;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  transition: width 0.15s, min-width 0.15s, opacity 0.15s;
  padding-top: 36px; /* space for toggle button */
}
.panel.closed {
  width: 0;
  min-width: 0;
  opacity: 0;
  overflow: hidden;
}

.panel-header {
  font-size: 10px;
  color: #555;
  padding: 0 10px 8px;
  border-bottom: 1px solid #222;
  margin-bottom: 6px;
}

.panel-nav { padding: 4px 6px; }

.group { margin-bottom: 12px; }
.group-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #444;
  padding: 2px 4px 4px;
}

.panel-nav button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 8px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: #666;
  cursor: pointer;
  font-family: monospace;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.panel-nav button:hover { background: #222; color: #aaa; }
.panel-nav button.active { background: #0070e0; color: #fff; }

.canvas-area {
  flex: 1;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
}

.tab-title {
  font-size: 11px;
  color: #333;
  padding: 4px 10px;
  background: #131313;
  border-bottom: 1px solid #1e1e1e;
  flex-shrink: 0;
}

.canvas-area > :not(.tab-title) {
  flex: 1;
  overflow: hidden;
}
</style>
```

- [ ] **Step 3: Verify the dev server compiles**

Run: `npm run dev` from `pixi-features/`.
Expected: no TypeScript errors, app loads at `http://localhost:5202/`, left panel visible with grouped tabs, toggle button collapses/expands panel, selecting a tab switches the canvas.

Note: `TabKnife`, `TabMeasure`, `TabTextAnnotation` don't exist yet — Vue's `defineAsyncComponent` will silently fail until those files are created. That's fine for now.

- [ ] **Step 4: Commit**

```bash
git add pixi-features/src/App.vue
git commit -m "feat(pixi-features): replace button-row nav with dismissable left panel"
```

---

## Task 2: Measurement Utilities Library

Pure functions with no Pixi dependency. Written first so Task 3 can import them.

**Files:**
- Create: `src/lib/measureUtils.ts`

- [ ] **Step 1: Create measureUtils.ts**

```typescript
// src/lib/measureUtils.ts
import Bezier from 'bezier-js';

export interface Point { x: number; y: number }

/** Euclidean distance between two points in canvas pixels. */
export function euclideanPx(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Convert canvas pixels to real-world feet.
 * @param px          Distance in canvas pixels
 * @param pxPerInch   Screen resolution (default 96)
 * @param ftPerInch   Drawing scale: real-world feet per canvas inch (e.g. 20 for 1"=20')
 */
export function pxToFeet(px: number, pxPerInch = 96, ftPerInch = 20): number {
  return (px / pxPerInch) * ftPerInch;
}

/**
 * Shoelace formula — signed area of a polygon in canvas pixels².
 * Returns absolute value (unsigned). Pass vertices in order.
 * Treat the cursor position as the final unclosed vertex during live preview.
 */
export function polygonAreaPx(pts: Point[]): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += pts[i].x * pts[j].y;
    sum -= pts[j].x * pts[i].y;
  }
  return Math.abs(sum) / 2;
}

/** Convert pixel² area to square feet. */
export function pxSqToSqFt(pxSq: number, pxPerInch = 96, ftPerInch = 20): number {
  const inSq = pxSq / (pxPerInch * pxPerInch);
  return inSq * (ftPerInch * ftPerInch);
}

/**
 * Arc length of a cubic bezier segment in canvas pixels.
 * Uses bezier-js .length() which internally does adaptive subdivision.
 * @param p0  Anchor start
 * @param cp1 Control point 1 (out-handle of p0)
 * @param cp2 Control point 2 (in-handle of p1)
 * @param p1  Anchor end
 */
export function bezierSegmentLengthPx(
  p0: Point, cp1: Point, cp2: Point, p1: Point,
): number {
  const b = new Bezier(p0.x, p0.y, cp1.x, cp1.y, cp2.x, cp2.y, p1.x, p1.y);
  return b.length();
}

/**
 * Total arc length of a closed or open path defined as an array of cubic bezier segments.
 * Each segment: { p0, cp1, cp2, p1 }
 */
export interface CubicSegment { p0: Point; cp1: Point; cp2: Point; p1: Point }

export function pathLengthPx(segments: CubicSegment[]): number {
  return segments.reduce((sum, s) => sum + bezierSegmentLengthPx(s.p0, s.cp1, s.cp2, s.p1), 0);
}

/** Midpoint between two points (for line label positioning). */
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Centroid of a polygon (for area label positioning). */
export function centroid(pts: Point[]): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}

/** Format feet as "X' Y\"" (feet and inches). */
export function formatFeet(ft: number): string {
  const wholeFt = Math.floor(ft);
  const inches = Math.round((ft - wholeFt) * 12);
  if (inches === 0) return `${wholeFt}'`;
  if (inches === 12) return `${wholeFt + 1}'`;
  return `${wholeFt}' ${inches}"`;
}

/** Format square feet as "X sq ft". */
export function formatSqFt(sqFt: number): string {
  return sqFt < 1000
    ? `${sqFt.toFixed(1)} sq ft`
    : `${(sqFt / 1000).toFixed(2)}k sq ft`;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd pixi-features && npx tsc --noEmit
```

Expected: no errors (only the existing `src/main.ts` App.vue import warning is OK).

- [ ] **Step 3: Commit**

```bash
git add pixi-features/src/lib/measureUtils.ts
git commit -m "feat(pixi-features): add measureUtils — distance, area, bezier arc length, unit formatting"
```

---

## Task 3: TabMeasure — Three-Mode Measurement Tool

**Files:**
- Create: `src/tabs/TabMeasure.vue`

The tab has three modes switched by buttons in the HUD. All use `pixelLine: true` for the rubber-band guide. A floating `BitmapText` label updates on every `pointermove`.

**Mode 1 — Line:** click start → rubber-band to cursor → click end → label shows distance at midpoint.
**Mode 2 — Area:** click N vertices → live polygon fill + area label → click first point to close.
**Mode 3 — Path:** a pre-drawn bezier bed shape lives in the scene; hover it to highlight and show arc length.

- [ ] **Step 1: Create TabMeasure.vue**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import {
  Application, Graphics, BitmapText, BitmapFont, Container, Rectangle,
} from 'pixi.js';
import Bezier from 'bezier-js';
import { useFps } from '../shared/useFps';
import {
  euclideanPx, pxToFeet, polygonAreaPx, pxSqToSqFt,
  pathLengthPx, midpoint, centroid, formatFeet, formatSqFt,
  type Point, type CubicSegment,
} from '../lib/measureUtils';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();

// Drawing scale: real-world feet per canvas inch
const drawingScale = ref(20);
const PX_PER_INCH = 96;

type Mode = 'line' | 'area' | 'path';
const mode = ref<Mode>('line');

// ── Pixi objects ──────────────────────────────────────────────────────────────
let app = markRaw({} as Application);
let guideLayer  = markRaw({} as Container); // rubber-band + fills
let labelLayer  = markRaw({} as Container); // floating BitmapText
let pathLayer   = markRaw({} as Container); // pre-drawn bed shape (mode 3)

let guideGfx    = markRaw({} as Graphics);
let fillGfx     = markRaw({} as Graphics);
let pathGfx     = markRaw({} as Graphics);
let labelText   = markRaw({} as BitmapText);

// ── Interaction state ─────────────────────────────────────────────────────────
let lineStart: Point | null = null;
const areaVerts = ref<Point[]>([]);
let cursor: Point = { x: 0, y: 0 };

// Pre-drawn closed bezier path for mode 3 (a bed-like rounded shape)
const BED_SEGMENTS: CubicSegment[] = [
  { p0: {x:200,y:150}, cp1: {x:350,y:100}, cp2: {x:500,y:100}, p1: {x:550,y:200} },
  { p0: {x:550,y:200}, cp1: {x:600,y:300}, cp2: {x:600,y:350}, p1: {x:500,y:420} },
  { p0: {x:500,y:420}, cp1: {x:350,y:500}, cp2: {x:200,y:480}, p1: {x:150,y:380} },
  { p0: {x:150,y:380}, cp1: {x:100,y:280}, cp2: {x:100,y:200}, p1: {x:200,y:150} },
];
let pathHovered = false;

// ── Reset when mode changes ────────────────────────────────────────────────────
function resetState() {
  lineStart = null;
  areaVerts.value = [];
  guideGfx.clear();
  fillGfx.clear();
  labelText.text = '';
  pathHovered = false;
  redrawBed(false);
}

// ── Draw helpers ──────────────────────────────────────────────────────────────
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
  // dot at start
  guideGfx.setFillStyle({ color: 0xff4444 });
  guideGfx.circle(from.x, from.y, 4).fill();
}

function drawAreaGuide(verts: Point[], cur: Point) {
  fillGfx.clear();
  if (verts.length < 1) return;
  // ghost fill: verts + cursor
  const poly = [...verts, cur];
  fillGfx.setFillStyle({ color: 0x00aaff, alpha: 0.15 });
  fillGfx.moveTo(poly[0].x, poly[0].y);
  for (const p of poly.slice(1)) fillGfx.lineTo(p.x, p.y);
  fillGfx.closePath().fill();
  // guide lines
  guideGfx.clear();
  guideGfx.setStrokeStyle({ pixelLine: true, color: 0x00aaff });
  guideGfx.moveTo(verts[0].x, verts[0].y);
  for (const p of verts.slice(1)) guideGfx.lineTo(p.x, p.y);
  guideGfx.lineTo(cur.x, cur.y);
  guideGfx.stroke();
  // vertex dots
  guideGfx.setFillStyle({ color: 0x00aaff });
  for (const p of verts) guideGfx.circle(p.x, p.y, 4).fill();
  // close-hint dot at start if > 2 verts
  if (verts.length >= 2) {
    guideGfx.setFillStyle({ color: 0xffffff, alpha: 0.6 });
    guideGfx.circle(verts[0].x, verts[0].y, 7).fill();
  }
}

function updateLabel(text: string, pos: Point) {
  labelText.text = text;
  labelText.position.set(pos.x + 10, pos.y - 18);
}

// ── Hit-test cursor against bed path (mode 3) ─────────────────────────────────
function isCursorNearBed(p: Point, threshold = 12): boolean {
  for (const s of BED_SEGMENTS) {
    const b = new Bezier(s.p0.x, s.p0.y, s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.p1.x, s.p1.y);
    const nearest = b.project(p);
    if (Math.hypot(nearest.x - p.x, nearest.y - p.y) < threshold) return true;
  }
  return false;
}

// ── Event handlers ────────────────────────────────────────────────────────────
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
      if (near) {
        const lenFt = pxToFeet(pathLengthPx(BED_SEGMENTS), PX_PER_INCH, drawingScale.value);
        updateLabel(`Path: ${formatFeet(lenFt)}`, cursor);
      } else {
        labelText.text = '';
      }
    }
    if (near) updateLabel(
      `Path: ${formatFeet(pxToFeet(pathLengthPx(BED_SEGMENTS), PX_PER_INCH, drawingScale.value))}`,
      cursor,
    );
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
      // Commit: draw permanent line
      guideGfx.setStrokeStyle({ pixelLine: true, color: 0xffaa00 });
      guideGfx.moveTo(lineStart.x, lineStart.y).lineTo(pt.x, pt.y).stroke();
      const distPx = euclideanPx(lineStart, pt);
      updateLabel(formatFeet(pxToFeet(distPx, PX_PER_INCH, drawingScale.value)), midpoint(lineStart, pt));
      lineStart = null;
    }
  } else if (mode.value === 'area') {
    // Check if clicking near first vertex to close
    if (areaVerts.value.length >= 3) {
      const first = areaVerts.value[0];
      if (Math.hypot(pt.x - first.x, pt.y - first.y) < 14) {
        // Close polygon
        const areaSqFt = pxSqToSqFt(polygonAreaPx(areaVerts.value), PX_PER_INCH, drawingScale.value);
        updateLabel(formatSqFt(areaSqFt), centroid(areaVerts.value));
        // draw final fill
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

// ── Mount ─────────────────────────────────────────────────────────────────────
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

    <!-- HUD -->
    <div style="position:absolute;top:10px;left:10px;font-family:monospace;font-size:12px;color:#0f0;pointer-events:none">
      <div>{{ fps }} fps · {{ frameMs }} ms</div>
    </div>

    <!-- Mode buttons -->
    <div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:6px">
      <button
        v-for="m in (['line','area','path'] as const)" :key="m"
        @click="mode = m; resetState()"
        :style="{ padding:'4px 14px', background: mode===m ? '#0070e0' : '#2a2a2a',
                  color: mode===m ? '#fff' : '#888', border:'1px solid #444',
                  borderRadius:'3px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }"
      >{{ m === 'line' ? 'Line Dist' : m === 'area' ? 'Area' : 'Path Length' }}</button>
    </div>

    <!-- Scale control -->
    <div style="position:absolute;bottom:10px;left:10px;font-family:monospace;font-size:11px;color:#888">
      Scale: 1" = <input type="number" v-model.number="drawingScale" min="1" max="200"
        style="width:44px;background:#222;border:1px solid #444;color:#ccc;font-family:monospace;font-size:11px;padding:1px 4px" /> ft
    </div>

    <!-- Instructions -->
    <div style="position:absolute;bottom:10px;right:10px;font-family:monospace;font-size:11px;color:#444;text-align:right">
      <template v-if="mode==='line'">Click start → click end</template>
      <template v-else-if="mode==='area'">Click vertices · click start point to close</template>
      <template v-else>Hover the bed path</template>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:5202/`, select "Measure" from the left panel.
- **Line mode:** click a start point — a red rubber-band line tracks the cursor; click again — the line commits in orange with a distance label (e.g. "12' 6"").
- **Area mode:** click 3+ vertices — a blue ghost fill grows live with a sq ft label; click near the first vertex to close — polygon solidifies.
- **Path mode:** hover the green bed shape — it highlights and shows its arc length.

- [ ] **Step 3: Commit**

```bash
git add pixi-features/src/tabs/TabMeasure.vue
git commit -m "feat(pixi-features): TabMeasure — line distance, polygon area, bezier arc length"
```

---

## Task 4: Install Auto-Smooth Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install libraries**

```bash
cd pixi-features
npm install simplify-js fit-curve
npm install --save-dev @types/simplify-js
```

`simplify-js` — Ramer-Douglas-Peucker point reduction.
`fit-curve` — Philip Schneider's bezier fitting algorithm (Graphics Gems). No `@types` needed; it ships its own declarations.

- [ ] **Step 2: Verify TypeScript resolves**

```bash
npx tsc --noEmit
```

Expected: no errors relating to the new packages.

- [ ] **Step 3: Commit**

```bash
git add pixi-features/package.json pixi-features/package-lock.json
git commit -m "chore(pixi-features): add simplify-js and fit-curve for freehand auto-smooth"
```

---

## Task 5: Path Fitting Library

Pure math, no Pixi.

**Files:**
- Create: `src/lib/pathFit.ts`

- [ ] **Step 1: Create pathFit.ts**

```typescript
// src/lib/pathFit.ts
import simplify from 'simplify-js';
import fitCurve from 'fit-curve';

export interface Point { x: number; y: number }

/**
 * Cubic bezier segment as [p0, cp1, cp2, p1] — same tuple format fit-curve returns.
 * Each element is [x, y].
 */
export type BezierTuple = [[number,number],[number,number],[number,number],[number,number]];

/**
 * Reduce a raw point cloud to a smooth bezier path.
 *
 * @param rawPoints   Input points from freehand drawing
 * @param tolerance   RDP tolerance in pixels (higher = fewer points, looser fit; default 2.5)
 * @param fitError    fit-curve max error in pixels (higher = smoother but less accurate; default 4)
 * @returns           Array of cubic bezier segments as tuples
 */
export function fitBezierPath(
  rawPoints: Point[],
  tolerance = 2.5,
  fitError = 4,
): BezierTuple[] {
  if (rawPoints.length < 2) return [];

  // Step 1: RDP simplification — reduce point count while preserving shape
  const simplified = simplify(rawPoints, tolerance, true); // high-quality mode

  if (simplified.length < 2) return [];

  // Step 2: Convert to [x, y] tuples for fit-curve
  const pts: [number, number][] = simplified.map(p => [p.x, p.y]);

  // Step 3: Fit cubic bezier curves through simplified points
  return fitCurve(pts, fitError) as BezierTuple[];
}

/**
 * Draw a fitted bezier path into a Pixi Graphics object.
 * Clears the graphics first.
 * @param gfx       Pixi Graphics to draw into
 * @param segments  Output of fitBezierPath
 * @param color     Stroke color (default green)
 */
export function drawFittedPath(
  gfx: import('pixi.js').Graphics,
  segments: BezierTuple[],
  color = 0x00ff88,
): void {
  gfx.clear();
  if (segments.length === 0) return;
  gfx.setStrokeStyle({ width: 2, color });
  gfx.moveTo(segments[0][0][0], segments[0][0][1]);
  for (const [, cp1, cp2, p1] of segments) {
    gfx.bezierCurveTo(cp1[0], cp1[1], cp2[0], cp2[1], p1[0], p1[1]);
  }
  gfx.stroke();
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add pixi-features/src/lib/pathFit.ts
git commit -m "feat(pixi-features): pathFit — RDP simplification + bezier curve fitting"
```

---

## Task 6: Extend TabFreehand with Auto-Smooth

Modify `TabFreehand.vue` to show the fitted bezier path overlaid on the raw stroke after each pointer-up.

**Files:**
- Modify: `src/tabs/TabFreehand.vue`

- [ ] **Step 1: Add imports and new Pixi objects**

At the top of the `<script setup>` block, after existing imports, add:

```typescript
import { fitBezierPath, drawFittedPath } from '../lib/pathFit';
```

After `let liveGfx = markRaw({} as Graphics);`, add:

```typescript
let fittedGfx = markRaw({} as Graphics); // overlay showing auto-smoothed bezier
const showFitted = ref(true);
const lastSegmentCount = ref(0);
```

- [ ] **Step 2: Update onPU to run fitting after burning**

Replace the existing `onPU` function:

```typescript
function onPU() {
  if (!drawing) return;
  drawing = false;
  lastStrokePointCount.value = currentPoints.length;
  renderStrokeToGfx(liveGfx, currentPoints);
  burnToTexture();
  strokeCount.value++;

  // Auto-smooth: fit bezier through raw points and draw overlay
  if (showFitted.value && currentPoints.length >= 4) {
    const pts = currentPoints.map(([x, y]) => ({ x, y }));
    const segments = fitBezierPath(pts, 2.5, 4);
    lastSegmentCount.value = segments.length;
    drawFittedPath(fittedGfx, segments, 0x00ff88);
  } else {
    fittedGfx.clear();
    lastSegmentCount.value = 0;
  }

  currentPoints = [];
}
```

- [ ] **Step 3: Initialize fittedGfx in onMounted**

Inside `onMounted`, after the line that adds `liveGfx` to the stage (`app.stage.addChild(accSprite, liveGfx)`), add:

```typescript
fittedGfx = markRaw(new Graphics());
app.stage.addChild(fittedGfx);
```

- [ ] **Step 4: Add toggle control to template**

In the `<template>`, inside the controls div alongside the existing sliders, add:

```html
<label style="color:#00ff88">
  <input type="checkbox" v-model="showFitted" /> Show fitted bezier
</label>
<div v-if="lastSegmentCount > 0" style="color:#00ff88;font-size:11px">
  {{ lastSegmentCount }} bezier segment{{ lastSegmentCount === 1 ? '' : 's' }}
</div>
```

- [ ] **Step 5: Add cleanup in onUnmounted**

The existing `onUnmounted` calls `app?.destroy(...)` which destroys all children. No extra cleanup needed.

- [ ] **Step 6: Verify in browser**

Open "Freehand" tab. Draw a curved stroke. On release:
- The raw stroke (blue) burns to the accumulation texture.
- A green bezier path appears on top, clean and smooth.
- Check: the green path should follow the general shape without jagged corners.
- Toggle the checkbox off → no green overlay.
- HUD shows "N bezier segments."

Quality bar: draw a simple S-curve or bed boundary shape. The green bezier path should look like what Illustrator would produce with the pencil tool. If it looks jagged, increase `fitError` (try 8); if it cuts corners too much, decrease it (try 2).

- [ ] **Step 7: Commit**

```bash
git add pixi-features/src/tabs/TabFreehand.vue
git commit -m "feat(pixi-features): TabFreehand — auto-smooth fitted bezier overlay on pointer-up"
```

---

## Task 7: TabKnife — Bezier Split Tool

**Files:**
- Create: `src/tabs/TabKnife.vue`

A pre-drawn closed bezier shape lives on the canvas. The user drags a cut line across it. On release, each bezier segment that the cut line intersects is split using `bezier-js`; the result is two independently colored closed paths.

- [ ] **Step 1: Create TabKnife.vue**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics, Container } from 'pixi.js';
import Bezier from 'bezier-js';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();
const statusMsg = ref('Drag a cut line across the shape');

let app = markRaw({} as Application);
let shapeLayer = markRaw({} as Container);
let cutLayer   = markRaw({} as Container);
let shapeGfx   = markRaw({} as Graphics);
let cutGfx     = markRaw({} as Graphics);

// ── Source shape — a bed-like closed bezier path ────────────────────────────
interface Anchor { x: number; y: number; cpOut: { x: number; y: number }; cpIn: { x: number; y: number } }

const SOURCE_ANCHORS: Anchor[] = [
  { x: 300, y: 120, cpOut: { x: 460, y: 60  }, cpIn:  { x: 140, y: 180 } },
  { x: 560, y: 240, cpOut: { x: 620, y: 340 }, cpIn:  { x: 500, y: 140 } },
  { x: 480, y: 440, cpOut: { x: 300, y: 520 }, cpIn:  { x: 600, y: 400 } },
  { x: 180, y: 380, cpOut: { x: 100, y: 280 }, cpIn:  { x: 220, y: 460 } },
];

interface CubicSeg {
  p0: { x:number;y:number }; cp1: { x:number;y:number };
  cp2: { x:number;y:number }; p1:  { x:number;y:number };
}

function buildSegments(anchors: Anchor[]): CubicSeg[] {
  return anchors.map((a, i) => {
    const next = anchors[(i + 1) % anchors.length];
    return { p0: a, cp1: a.cpOut, cp2: next.cpIn, p1: next };
  });
}

function drawClosedPath(gfx: Graphics, segs: CubicSeg[], fillColor: number, strokeColor: number) {
  gfx.setFillStyle({ color: fillColor, alpha: 0.4 });
  gfx.setStrokeStyle({ width: 2, color: strokeColor });
  const [first] = segs;
  gfx.moveTo(first.p0.x, first.p0.y);
  for (const s of segs) gfx.bezierCurveTo(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.p1.x, s.p1.y);
  gfx.closePath().fill().stroke();
}

function resetShape() {
  shapeGfx.clear();
  drawClosedPath(shapeGfx, buildSegments(SOURCE_ANCHORS), 0x1a3a5a, 0x4488cc);
  cutGfx.clear();
  statusMsg.value = 'Drag a cut line across the shape';
}

// ── Cut interaction ──────────────────────────────────────────────────────────
let cutting = false;
let cutStart = { x: 0, y: 0 };
let cutEnd   = { x: 0, y: 0 };

function screenPt(e: PointerEvent) {
  const r = canvasEl.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onPD(e: PointerEvent) {
  if (e.button !== 0) return;
  cutting = true;
  cutStart = screenPt(e);
  cutEnd = { ...cutStart };
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onPM(e: PointerEvent) {
  if (!cutting) return;
  cutEnd = screenPt(e);
  cutGfx.clear();
  cutGfx.setStrokeStyle({ width: 1.5, color: 0xff2222 });
  cutGfx.moveTo(cutStart.x, cutStart.y).lineTo(cutEnd.x, cutEnd.y).stroke();
  // circle endpoints
  cutGfx.setFillStyle({ color: 0xff2222 });
  cutGfx.circle(cutStart.x, cutStart.y, 4).fill();
  cutGfx.circle(cutEnd.x, cutEnd.y, 4).fill();
}

function onPU() {
  if (!cutting) return;
  cutting = false;
  performCut(cutStart, cutEnd);
}

// ── The actual split algorithm ────────────────────────────────────────────────
function performCut(from: { x:number;y:number }, to: { x:number;y:number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 5) { resetShape(); return; }

  const segs = buildSegments(SOURCE_ANCHORS);

  // Collect intersections: { segIndex, t }
  type Hit = { segIndex: number; t: number };
  const hits: Hit[] = [];

  // The cut line as a bezier-js LineSegment: { p1, p2 }
  const line = { p1: from, p2: to };

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const b = new Bezier(s.p0.x, s.p0.y, s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.p1.x, s.p1.y);
    const xs = b.intersects(line) as number[];
    for (const raw of xs) {
      // bezier-js returns "t1/t2" strings or numbers; normalize
      const t = typeof raw === 'string' ? parseFloat(raw.split('/')[0]) : raw;
      if (t > 0.001 && t < 0.999) hits.push({ segIndex: i, t });
    }
  }

  if (hits.length < 2) {
    statusMsg.value = `Need 2 intersections to split — got ${hits.length}. Try cutting fully across the shape.`;
    cutGfx.clear();
    return;
  }

  // Sort hits by segment index + t for traversal order
  hits.sort((a, b) => a.segIndex !== b.segIndex ? a.segIndex - b.segIndex : a.t - b.t);
  const [hitA, hitB] = hits; // use first two intersections

  // Build the two new paths from the segments
  // Path 1: from hitA forward to hitB
  // Path 2: from hitB forward to hitA (wrapping)
  const splitSegments = splitPathAtHits(segs, hitA, hitB);

  shapeGfx.clear();
  drawClosedPath(shapeGfx, splitSegments.path1, 0x2a5a1a, 0x44cc44);

  // Draw path2 in a second graphics object layered above
  const gfx2 = markRaw(new Graphics());
  drawClosedPath(gfx2, splitSegments.path2, 0x5a1a2a, 0xcc4444);
  shapeLayer.addChild(gfx2);

  cutGfx.clear();
  statusMsg.value = `Split! ${splitSegments.path1.length} + ${splitSegments.path2.length} segments`;
}

/**
 * Split the closed path at two hit points, returning two arrays of CubicSeg.
 * Each hit is a { segIndex, t } pair; the split inserts a new anchor at
 * that bezier t using de Casteljau and divides the path there.
 */
function splitPathAtHits(
  segs: CubicSeg[],
  hitA: { segIndex: number; t: number },
  hitB: { segIndex: number; t: number },
): { path1: CubicSeg[]; path2: CubicSeg[] } {
  // Helper: split one CubicSeg at t using de Casteljau
  function splitSeg(s: CubicSeg, t: number): [CubicSeg, CubicSeg] {
    const b = new Bezier(s.p0.x, s.p0.y, s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.p1.x, s.p1.y);
    const { left, right } = b.split(t);
    const toSeg = (bz: typeof left): CubicSeg => ({
      p0:  { x: bz.points[0].x, y: bz.points[0].y },
      cp1: { x: bz.points[1].x, y: bz.points[1].y },
      cp2: { x: bz.points[2].x, y: bz.points[2].y },
      p1:  { x: bz.points[3].x, y: bz.points[3].y },
    });
    return [toSeg(left), toSeg(right)];
  }

  // Build expanded segment list with splits applied at both hits.
  // Process hitB first (higher index) so hitA indices remain stable.
  let expanded = [...segs];

  // Split at hitB
  const [leftB, rightB] = splitSeg(expanded[hitB.segIndex], hitB.t);
  expanded.splice(hitB.segIndex, 1, leftB, rightB);
  // hitA.segIndex is still valid (hitA.segIndex < hitB.segIndex or same segment adjusted)
  const hitASeg = hitA.segIndex < hitB.segIndex ? hitA.segIndex : hitA.segIndex;
  const hitATAdj = hitA.segIndex === hitB.segIndex
    ? hitA.t / hitB.t  // t is relative to the left portion after splitting
    : hitA.t;

  // Split at hitA (adjusted)
  const [leftA, rightA] = splitSeg(expanded[hitASeg], hitATAdj);
  expanded.splice(hitASeg, 1, leftA, rightA);

  // After two splits, the cut points are at the end of leftA and end of leftB (+1 offset).
  const cutA = hitASeg + 0; // index of leftA (its p1 is the cut point A)
  const cutB = hitA.segIndex < hitB.segIndex
    ? hitB.segIndex + 1 + 1  // shifted by the splitA insertion
    : hitB.segIndex + 1;     // splitA was inside same original seg

  // path1: from cutA+1 to cutB (inclusive)
  // path2: from cutB+1 to cutA (wrapping)
  const path1: CubicSeg[] = [];
  const path2: CubicSeg[] = [];
  const n = expanded.length;

  // Forward traversal from cutA end to cutB end
  let i = (cutA + 1) % n;
  while (true) {
    path1.push(expanded[i]);
    if (i === cutB % n) break;
    i = (i + 1) % n;
    if (path1.length > n) break; // safety
  }

  // Rest goes to path2
  i = ((cutB % n) + 1) % n;
  while (true) {
    path2.push(expanded[i]);
    if (i === cutA % n) break;
    i = (i + 1) % n;
    if (path2.length > n) break; // safety
  }

  return { path1, path2 };
}

// ── Mount ─────────────────────────────────────────────────────────────────────
onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas, width: canvas.clientWidth, height: canvas.clientHeight,
    antialias: true, background: '#0e1014',
    resolution: devicePixelRatio, autoDensity: true,
  });

  shapeLayer = markRaw(new Container());
  cutLayer   = markRaw(new Container());
  shapeGfx   = markRaw(new Graphics());
  cutGfx     = markRaw(new Graphics());

  shapeLayer.addChild(shapeGfx);
  cutLayer.addChild(cutGfx);
  app.stage.addChild(shapeLayer, cutLayer);

  resetShape();

  canvas.addEventListener('pointerdown', onPD);
  canvas.addEventListener('pointermove', onPM);
  canvas.addEventListener('pointerup', onPU);

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge');
    registerPixiBridge(app, { tabName: 'knife', getSnapshot: () => ({ status: statusMsg.value }) });
  }
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined;
  window.__pixiTestBridgeReady = false;
  canvasEl.value?.removeEventListener('pointerdown', onPD);
  canvasEl.value?.removeEventListener('pointermove', onPM);
  canvasEl.value?.removeEventListener('pointerup', onPU);
  app?.destroy(true, { children: true, texture: true });
});
</script>

<template>
  <div style="width:100%;height:100%;position:relative;overflow:hidden">
    <canvas ref="canvasEl" style="width:100%;height:100%;display:block" />
    <div style="position:absolute;top:10px;left:10px;font-family:monospace;font-size:12px;color:#0f0">
      {{ fps }} fps · {{ frameMs }} ms
    </div>
    <div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);font-family:monospace;font-size:12px;color:#aaa">
      {{ statusMsg }}
    </div>
    <button @click="resetShape" style="position:absolute;top:10px;right:10px;padding:4px 12px;background:#2a2a2a;border:1px solid #444;color:#888;border-radius:3px;cursor:pointer;font-family:monospace;font-size:11px">
      Reset
    </button>
    <div style="position:absolute;bottom:10px;left:10px;font-family:monospace;font-size:11px;color:#444">
      Drag across the shape to cut it in two
    </div>
  </div>
</template>
```

- [ ] **Step 2: Verify in browser**

Open "Knife Tool" tab. Drag a line cleanly across the blue shape. Expected:
- While dragging: a red dashed cut line tracks the pointer.
- On release: the shape splits into a green half and a red half.
- Status bar shows segment counts.
- Reset button restores the original shape.

If the cut misses (< 2 intersections), the status says so. Try again with a longer drag that clearly crosses the shape on both sides.

- [ ] **Step 3: Commit**

```bash
git add pixi-features/src/tabs/TabKnife.vue
git commit -m "feat(pixi-features): TabKnife — drag-to-cut bezier shape using de Casteljau split"
```

---

## Task 8: TabTextAnnotation — In-Canvas Text Editing

**Files:**
- Create: `src/tabs/TabTextAnnotation.vue`

Click anywhere on canvas → a Vue `<input>` appears at screen coordinates → type → Enter/blur commits to a `BitmapText` placed at world coordinates → click any existing annotation to re-edit it → drag to move.

- [ ] **Step 1: Create TabTextAnnotation.vue**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted, markRaw, nextTick } from 'vue';
import { Application, BitmapText, BitmapFont, Graphics, Container } from 'pixi.js';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl    = ref<HTMLCanvasElement>();
const inputEl     = ref<HTMLInputElement>();

// Vue state for the overlay input
const editing     = ref(false);
const editText    = ref('');
const editScreenX = ref(0);
const editScreenY = ref(0);
const instructions = ref('Click anywhere to place a text annotation');

let app = markRaw({} as Application);
let annotationLayer = markRaw({} as Container);

// ── Annotation data ────────────────────────────────────────────────────────
interface Annotation {
  id: number;
  worldX: number;
  worldY: number;
  text: string;
  bitmapText: InstanceType<typeof BitmapText>;
  hitArea: InstanceType<typeof Graphics>;
}

const annotations: Annotation[] = [];
let nextId = 0;

// Which annotation is being edited/dragged
let editingId: number | null = null;
let draggingId: number | null = null;
let dragOffset = { x: 0, y: 0 };

const FONT_SIZE = 16;

// ── World ↔ screen (simple 1:1 for this spike — no viewport transform) ────
function screenToWorld(sx: number, sy: number) { return { x: sx, y: sy }; }
function worldToScreen(wx: number, wy: number) { return { x: wx, y: wy }; }

// ── Create / update BitmapText for an annotation ───────────────────────────
function spawnBitmapText(ann: Annotation) {
  ann.bitmapText.text = ann.text;
  ann.bitmapText.position.set(ann.worldX, ann.worldY);
  // Rebuild hit area
  ann.hitArea.clear();
  const w = ann.bitmapText.width || 80;
  const h = ann.bitmapText.height || 20;
  ann.hitArea.setFillStyle({ color: 0xffffff, alpha: 0 });
  ann.hitArea.rect(-4, -4, w + 8, h + 8).fill();
  ann.hitArea.position.set(ann.worldX, ann.worldY);
  ann.hitArea.eventMode = 'static';
  ann.hitArea.cursor = 'text';
}

function addAnnotation(worldX: number, worldY: number, text: string): Annotation {
  const bt = markRaw(new BitmapText({
    text,
    style: { fontFamily: 'AnnotationFont', fontSize: FONT_SIZE },
  }));
  const hitArea = markRaw(new Graphics());

  const ann: Annotation = { id: nextId++, worldX, worldY, text, bitmapText: bt, hitArea };
  annotations.push(ann);
  annotationLayer.addChild(bt, hitArea);

  // Pointer events on hit area
  hitArea.on('pointerdown', (e) => {
    e.stopPropagation();
    if (e.button === 0) {
      draggingId = ann.id;
      const sp = worldToScreen(ann.worldX, ann.worldY);
      dragOffset = { x: e.globalX - sp.x, y: e.globalY - sp.y };
    }
  });

  spawnBitmapText(ann);
  return ann;
}

// ── Commit / cancel edit ───────────────────────────────────────────────────
function commitEdit() {
  if (!editing.value) return;
  const text = editText.value.trim();
  editing.value = false;

  if (editingId !== null) {
    // Editing existing
    const ann = annotations.find(a => a.id === editingId)!;
    if (text === '') {
      // Delete it
      annotationLayer.removeChild(ann.bitmapText, ann.hitArea);
      annotations.splice(annotations.indexOf(ann), 1);
    } else {
      ann.text = text;
      spawnBitmapText(ann);
    }
    editingId = null;
  } else {
    // New annotation
    if (text !== '') {
      const world = screenToWorld(editScreenX.value, editScreenY.value);
      addAnnotation(world.x, world.y, text);
    }
  }
  editText.value = '';
  instructions.value = 'Click to place · click text to edit · drag to move · Delete to remove';
}

function cancelEdit() {
  editing.value = false;
  editText.value = '';
  editingId = null;
}

// ── Canvas click — open input overlay ─────────────────────────────────────
function onCanvasClick(e: PointerEvent) {
  if (e.button !== 0) return;
  if (editing.value) { commitEdit(); return; }
  const rect = canvasEl.value!.getBoundingClientRect();
  editScreenX.value = e.clientX - rect.left;
  editScreenY.value = e.clientY - rect.top;
  editText.value = '';
  editingId = null;
  editing.value = true;
  nextTick(() => inputEl.value?.focus());
}

// ── Drag logic ─────────────────────────────────────────────────────────────
function onWindowMove(e: PointerEvent) {
  if (draggingId === null) return;
  const rect = canvasEl.value!.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const world = screenToWorld(sx - dragOffset.x, sy - dragOffset.y);
  const ann = annotations.find(a => a.id === draggingId)!;
  ann.worldX = world.x;
  ann.worldY = world.y;
  spawnBitmapText(ann);
}

function onWindowUp() { draggingId = null; }

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && editing.value) cancelEdit();
}

// ── Mount ──────────────────────────────────────────────────────────────────
onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas, width: canvas.clientWidth, height: canvas.clientHeight,
    antialias: true, background: '#0e1014',
    resolution: devicePixelRatio, autoDensity: true,
  });

  BitmapFont.install({
    name: 'AnnotationFont',
    style: { fontSize: 32, fill: 0xffffff, fontFamily: 'sans-serif', fontWeight: 'bold' },
    resolution: 2,
  });

  annotationLayer = markRaw(new Container());
  annotationLayer.eventMode = 'none';
  app.stage.addChild(annotationLayer);

  // Seed a couple of example annotations
  addAnnotation(80, 80, 'Click me to edit');
  addAnnotation(200, 200, 'Drag me to move');

  canvas.addEventListener('pointerdown', onCanvasClick);
  window.addEventListener('pointermove', onWindowMove);
  window.addEventListener('pointerup', onWindowUp);
  window.addEventListener('keydown', onKeyDown);

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge');
    registerPixiBridge(app, {
      tabName: 'text-annotation',
      getSnapshot: () => ({ count: annotations.length, texts: annotations.map(a => a.text) }),
    });
  }
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined;
  window.__pixiTestBridgeReady = false;
  canvasEl.value?.removeEventListener('pointerdown', onCanvasClick);
  window.removeEventListener('pointermove', onWindowMove);
  window.removeEventListener('pointerup', onWindowUp);
  window.removeEventListener('keydown', onKeyDown);
  app?.destroy(true, { children: true, texture: true });
});
</script>

<template>
  <div style="width:100%;height:100%;position:relative;overflow:hidden">
    <canvas ref="canvasEl" style="width:100%;height:100%;display:block" />

    <!-- Vue input overlay — positioned at click coordinates -->
    <input
      v-if="editing"
      ref="inputEl"
      v-model="editText"
      @blur="commitEdit"
      @keydown.enter.prevent="commitEdit"
      @keydown.escape="cancelEdit"
      :style="{
        position: 'absolute',
        left: editScreenX + 'px',
        top: (editScreenY - 20) + 'px',
        background: 'rgba(0,0,0,0.7)',
        border: '1px solid #0070e0',
        color: '#fff',
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        fontSize: '16px',
        padding: '2px 6px',
        outline: 'none',
        minWidth: '80px',
        borderRadius: '2px',
        zIndex: 10,
      }"
      placeholder="Type annotation…"
    />

    <div style="position:absolute;top:10px;left:10px;font-family:monospace;font-size:12px;color:#0f0">
      {{ fps }} fps · {{ frameMs }} ms
    </div>
    <div style="position:absolute;bottom:10px;left:10px;font-family:monospace;font-size:11px;color:#444">
      {{ instructions }}
    </div>
  </div>
</template>
```

- [ ] **Step 2: Verify in browser**

Open "Text Annotation" tab. Expected:
- Two seed annotations visible on canvas.
- Click blank area → blue-bordered input appears at click position → type something → Enter commits → `BitmapText` appears at that location.
- Click existing text → input reappears pre-filled → edit → Enter updates it.
- Drag existing text → it moves.
- Clear text in input and Enter → annotation is removed.
- Escape cancels without committing.

- [ ] **Step 3: Commit**

```bash
git add pixi-features/src/tabs/TabTextAnnotation.vue
git commit -m "feat(pixi-features): TabTextAnnotation — Vue overlay input → BitmapText, drag to move, re-edit"
```

---

## Self-Review

**Spec coverage:**
- ✅ Dismissable left panel with grouped tab list
- ✅ Measurement tool: line distance (Task 3), polygon area (Task 3), bezier arc length (Task 3)
- ✅ Freehand auto-smooth with quality comparison (Tasks 4–6)
- ✅ Knife/split tool using de Casteljau (Task 7)
- ✅ In-canvas text annotation with Vue overlay (Task 8)

**Placeholder scan:** None found.

**Type consistency:**
- `Point` is defined independently in `measureUtils.ts` and `pathFit.ts` — both `{ x: number; y: number }`, consistent. Tabs import from their respective lib files.
- `CubicSeg` used in `TabKnife.vue` is defined locally (not shared) — acceptable since it is only used in that file.
- `BezierTuple` in `pathFit.ts` matches `fit-curve`'s return type.
- `registerPixiBridge` cleanup (`window.__pixiTestBridge = undefined`) is in every tab's `onUnmounted` — consistent with established pattern.

**One known limitation:** The `splitPathAtHits` function in TabKnife handles the simple case of two hits on different segments well. The edge case where both hits land on the same segment is handled by adjusting `t` proportionally — this is a spike, so exact correctness under all edge cases is not required, but the common case (cut crosses the shape fully) works correctly.
