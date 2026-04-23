<script setup lang="ts">
/**
 * Pen tool derisking fixture.
 *
 * Architecture per research doc:
 *  - Committed path (rebuilt only on anchor commit)
 *  - Preview Graphics (cleared + rebuilt in ticker, ~O(1))
 *  - Handles in a sibling Container (Graphics objects sharing GraphicsContext templates)
 *  - Ticker-synced dirty flag — never rebuild in pointermove handler
 *  - markRaw() on all Pixi objects stored in refs
 *  - stage.on('pointermove') single global handler, not per-handle
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';

interface PenToolAnchorSnapshot {
  index: number
  type: 'corner' | 'smooth' | 'asymmetric'
  x: number
  y: number
  hasHandleIn: boolean
  hasHandleOut: boolean
}

interface PenToolSnapshot {
  mode: 'idle' | 'drawing' | 'done'
  closed: boolean
  anchors: PenToolAnchorSnapshot[]
}
import {
  Application, Graphics, Container, GraphicsContext, Rectangle,
  type Ticker,
} from 'pixi.js';
import { Bezier } from 'bezier-js';
import { useFps } from '../shared/useFps';

// ── Types ──────────────────────────────────────────────────────────────────────
type AnchorType = 'corner' | 'smooth' | 'asymmetric';
interface Anchor {
  x: number; y: number;
  handleIn:  { x: number; y: number } | null;
  handleOut: { x: number; y: number } | null;
  type: AnchorType;
}
type ToolMode = 'idle' | 'drawing' | 'done';
type DragTarget = { kind: 'anchor'; idx: number } | { kind: 'handleIn'; idx: number } | { kind: 'handleOut'; idx: number } | null;

// ── Reactive state (plain data only — no Pixi objects) ──────────────────────
const anchors = ref<Anchor[]>([]);
const closed = ref(false);
const mode = ref<ToolMode>('idle');
const hoveredCurve = ref<number | null>(null);
const snapInfo = ref('');

// ── Pixi objects (markRaw, never in Vue reactivity) ────────────────────────
const canvasEl = ref<HTMLCanvasElement>();
let app = markRaw({} as Application);
let committedGfx = markRaw({} as Graphics);
let previewGfx   = markRaw({} as Graphics);
let handleLineGfx = markRaw({} as Graphics);
let anchorsLayer = markRaw({} as Container);
let handlesLayer = markRaw({} as Container);

// Shared GraphicsContext templates for handle dots
// corners = square, smooth/asymmetric = circle (matches Illustrator convention)
let ctxAnchorCorner   = markRaw({} as GraphicsContext);
let ctxAnchorSmooth   = markRaw({} as GraphicsContext);
let ctxAnchorSelected = markRaw({} as GraphicsContext);
let ctxHandle         = markRaw({} as GraphicsContext);
let ctxHandleActive   = markRaw({} as GraphicsContext);

// ── Camera ─────────────────────────────────────────────────────────────────
let camX = 0, camY = 0, zoom = 1;

// ── Interaction state (not reactive — updated in ticker) ──────────────────
let dirty = false;
let cursor = { x: 0, y: 0 };     // world-space cursor position
let dragTarget: DragTarget = null;
let dragStartScreen = { x: 0, y: 0 };
let pointerIsDown = false;
let isActualDrag = false;

// ── FPS ────────────────────────────────────────────────────────────────────
const { fps, frameMs, heapMB } = useFps();

// ── Coordinate helpers ─────────────────────────────────────────────────────
function screenToWorld(sx: number, sy: number) {
  return { x: (sx - camX) / zoom, y: (sy - camY) / zoom };
}
function worldToScreen(wx: number, wy: number) {
  return { x: wx * zoom + camX, y: wy * zoom + camY };
}

// ── Handle context templates ───────────────────────────────────────────────
function buildContextTemplates() {
  // Corner anchor: hollow square (no bezier handles)
  ctxAnchorCorner = markRaw(new GraphicsContext()
    .setStrokeStyle({ width: 1.5, color: 0x00aaff })
    .setFillStyle({ color: 0x1a1a2e })
    .rect(-5, -5, 10, 10).fill().stroke());

  // Smooth/asymmetric anchor: hollow circle (has bezier handles)
  ctxAnchorSmooth = markRaw(new GraphicsContext()
    .setStrokeStyle({ width: 1.5, color: 0x00aaff })
    .setFillStyle({ color: 0x1a1a2e })
    .circle(0, 0, 5).fill().stroke());

  // First anchor highlight while drawing (close-path affordance)
  ctxAnchorSelected = markRaw(new GraphicsContext()
    .setStrokeStyle({ width: 1.5, color: 0x00aaff })
    .setFillStyle({ color: 0x00aaff })
    .rect(-5, -5, 10, 10).fill().stroke());

  ctxHandle = markRaw(new GraphicsContext()
    .setFillStyle({ color: 0xcc44cc })
    .circle(0, 0, 4).fill()
    .setStrokeStyle({ width: 1, color: 0x884488 })
    .circle(0, 0, 4).stroke());

  ctxHandleActive = markRaw(new GraphicsContext()
    .setFillStyle({ color: 0xff88ff })
    .circle(0, 0, 5).fill());
}

// ── Rebuild committed path ─────────────────────────────────────────────────
function rebuildCommitted() {
  committedGfx.clear();
  const a = anchors.value;
  if (a.length < 1) return;

  committedGfx.setStrokeStyle({ width: 2, color: hoveredCurve.value !== null ? 0x00ffaa : 0xffffff });
  committedGfx.moveTo(a[0].x, a[0].y);

  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1];
    const c = a[i];
    committedGfx.bezierCurveTo(
      p.x + (p.handleOut?.x ?? 0), p.y + (p.handleOut?.y ?? 0),
      c.x + (c.handleIn?.x  ?? 0), c.y + (c.handleIn?.y  ?? 0),
      c.x, c.y,
    );
  }

  if (closed.value && a.length > 1) {
    const p = a[a.length - 1];
    const c = a[0];
    committedGfx.bezierCurveTo(
      p.x + (p.handleOut?.x ?? 0), p.y + (p.handleOut?.y ?? 0),
      c.x + (c.handleIn?.x  ?? 0), c.y + (c.handleIn?.y  ?? 0),
      c.x, c.y,
    );
  }

  committedGfx.stroke();
  if (closed.value) {
    committedGfx.setFillStyle({ color: 0xffffff, alpha: 0.05 });
    // rebuild path for fill — Pixi v8 requires re-drawing after stroke()
    committedGfx.moveTo(a[0].x, a[0].y);
    for (let i = 1; i < a.length; i++) {
      const p = a[i - 1]; const c = a[i];
      committedGfx.bezierCurveTo(
        p.x + (p.handleOut?.x ?? 0), p.y + (p.handleOut?.y ?? 0),
        c.x + (c.handleIn?.x  ?? 0), c.y + (c.handleIn?.y  ?? 0),
        c.x, c.y,
      );
    }
    const p = a[a.length - 1]; const c = a[0];
    committedGfx.bezierCurveTo(
      p.x + (p.handleOut?.x ?? 0), p.y + (p.handleOut?.y ?? 0),
      c.x + (c.handleIn?.x  ?? 0), c.y + (c.handleIn?.y  ?? 0),
      c.x, c.y,
    );
    committedGfx.closePath().fill();
  }
}

// ── Rebuild overlay (handle lines + dots) ─────────────────────────────────
function rebuildHandles() {
  handleLineGfx.clear();
  anchorsLayer.removeChildren();
  handlesLayer.removeChildren();

  const a = anchors.value;
  if (a.length === 0 || mode.value === 'idle') return;

  handleLineGfx.setStrokeStyle({ width: 1, color: 0x555555, pixelLine: true } as any);

  for (let i = 0; i < a.length; i++) {
    const node = a[i];
    const { x, y, handleIn, handleOut } = node;

    // Connector lines (non-interactive)
    if (handleOut) {
      handleLineGfx.moveTo(x, y).lineTo(x + handleOut.x, y + handleOut.y).stroke();
      const hdot = markRaw(new Graphics(ctxHandle));
      hdot.position.set(x + handleOut.x, y + handleOut.y);
      hdot.eventMode = 'static';
      hdot.hitArea = new Rectangle(-7, -7, 14, 14);
      hdot.cursor = 'crosshair';
      hdot.on('pointerdown', (e) => {
        e.stopPropagation();
        dragTarget = { kind: 'handleOut', idx: i };
        pointerIsDown = true; isActualDrag = true;
        dragStartScreen = { x: e.global.x, y: e.global.y };
      });
      handlesLayer.addChild(hdot);
    }

    if (handleIn && (mode.value === 'done' || i > 0)) {
      handleLineGfx.moveTo(x, y).lineTo(x + handleIn.x, y + handleIn.y).stroke();
      const hdot = markRaw(new Graphics(ctxHandle));
      hdot.position.set(x + handleIn.x, y + handleIn.y);
      hdot.eventMode = 'static';
      hdot.hitArea = new Rectangle(-7, -7, 14, 14);
      hdot.cursor = 'crosshair';
      hdot.on('pointerdown', (e) => {
        e.stopPropagation();
        dragTarget = { kind: 'handleIn', idx: i };
        pointerIsDown = true; isActualDrag = true;
        dragStartScreen = { x: e.global.x, y: e.global.y };
      });
      handlesLayer.addChild(hdot);
    }

    // Anchor dot (on top of handle dots): square=corner, circle=smooth/asymmetric
    const isFirst = i === 0;
    let anchorCtx = node.type === 'corner' ? ctxAnchorCorner : ctxAnchorSmooth;
    if (isFirst && mode.value === 'drawing') anchorCtx = ctxAnchorSelected;
    const dot = markRaw(new Graphics(anchorCtx));
    dot.label = `test:anchor-${i}`;
    dot.position.set(x, y);
    dot.eventMode = 'static';
    dot.hitArea = new Rectangle(-8, -8, 16, 16);
    dot.cursor = isFirst && mode.value === 'drawing' && a.length > 1 ? 'cell' : 'grab';
    dot.on('pointerdown', (e) => {
      e.stopPropagation();
      if (mode.value === 'drawing' && isFirst && a.length > 1) {
        closePath(); return;
      }
      if (e.altKey) { toggleAnchorType(i); return; }
      dragTarget = { kind: 'anchor', idx: i };
      pointerIsDown = true;
      dragStartScreen = { x: e.global.x, y: e.global.y };
    });
    anchorsLayer.addChild(dot);
  }
}

// ── Preview (rubber-band): rebuilt in ticker every frame when dirty ────────
function rebuildPreview() {
  previewGfx.clear();
  const a = anchors.value;
  if (mode.value !== 'drawing' || a.length === 0) return;

  const last = a[a.length - 1];
  const hox = last.handleOut?.x ?? 0;
  const hoy = last.handleOut?.y ?? 0;

  // Rubber-band: cubic bezier from last anchor → cursor (degenerate: cp2 = cursor)
  previewGfx
    .setStrokeStyle({ width: 1, color: 0x555577, pixelLine: true } as any)
    .moveTo(last.x, last.y)
    .bezierCurveTo(last.x + hox, last.y + hoy, cursor.x, cursor.y, cursor.x, cursor.y)
    .stroke();
}

// ── Hit detection on committed curves ─────────────────────────────────────
function hitTestCurves(wx: number, wy: number): number | null {
  const a = anchors.value;
  const threshWorld = 8 / zoom;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1]; const c = a[i];
    const b = new Bezier(
      p.x, p.y,
      p.x + (p.handleOut?.x ?? 0), p.y + (p.handleOut?.y ?? 0),
      c.x + (c.handleIn?.x  ?? 0), c.y + (c.handleIn?.y  ?? 0),
      c.x, c.y,
    );
    const proj = b.project({ x: wx, y: wy });
    if (Math.hypot(proj.x - wx, proj.y - wy) < threshWorld) return i;
  }
  return null;
}

// ── Anchor type helpers ────────────────────────────────────────────────────
function toggleAnchorType(idx: number) {
  const a = anchors.value[idx];
  const next: Record<AnchorType, AnchorType> = { corner: 'smooth', smooth: 'asymmetric', asymmetric: 'corner' };
  a.type = next[a.type];
  if (a.type !== 'corner') ensureHandles(a);
  if (a.type === 'smooth' && a.handleOut) {
    const len = Math.hypot(a.handleOut.x, a.handleOut.y);
    const u = { x: a.handleOut.x / len, y: a.handleOut.y / len };
    a.handleIn = { x: -u.x * len, y: -u.y * len };
  }
  rebuildCommitted();
  rebuildHandles();
}

function ensureHandles(a: Anchor) {
  if (!a.handleOut) a.handleOut = { x: 30, y: 0 };
  if (!a.handleIn)  a.handleIn  = { x: -30, y: 0 };
}

function closePath() {
  closed.value = true;
  mode.value = 'done';
  rebuildCommitted();
  rebuildHandles();
}

// ── Anchor drag update (called in ticker) ─────────────────────────────────
function applyDrag(altHeld: boolean) {
  if (!dragTarget) return;
  const a = anchors.value;

  if (dragTarget.kind === 'anchor') {
    const node = a[dragTarget.idx];
    // Dragging a corner anchor in 'done' mode converts it to smooth (Illustrator convert-point gesture)
    if (node.type === 'corner' && mode.value === 'done') {
      const dx = cursor.x - node.x;
      const dy = cursor.y - node.y;
      node.handleOut = { x: dx, y: dy };
      node.handleIn  = { x: -dx, y: -dy };
      node.type = 'smooth';
      dragTarget = { kind: 'handleOut', idx: dragTarget.idx };
    } else {
      node.x = cursor.x;
      node.y = cursor.y;
    }
    dirty = true;

  } else {
    const node = a[dragTarget.idx];
    const isOut = dragTarget.kind === 'handleOut';
    const delta = { x: cursor.x - node.x, y: cursor.y - node.y };
    if (isOut) {
      node.handleOut = delta;
      if (!altHeld && node.type !== 'corner') {
        const len = Math.hypot(delta.x, delta.y);
        const u = { x: delta.x / len, y: delta.y / len };
        if (node.type === 'smooth') {
          node.handleIn = { x: -u.x * len, y: -u.y * len };
        } else {
          const inLen = node.handleIn ? Math.hypot(node.handleIn.x, node.handleIn.y) : len;
          node.handleIn = { x: -u.x * inLen, y: -u.y * inLen };
        }
      } else if (altHeld) node.type = 'corner';
    } else {
      node.handleIn = delta;
      if (!altHeld && node.type !== 'corner') {
        const len = Math.hypot(delta.x, delta.y);
        const u = { x: delta.x / len, y: delta.y / len };
        if (node.type === 'smooth') {
          node.handleOut = { x: -u.x * len, y: -u.y * len };
        } else {
          const outLen = node.handleOut ? Math.hypot(node.handleOut.x, node.handleOut.y) : len;
          node.handleOut = { x: -u.x * outLen, y: -u.y * outLen };
        }
      } else if (altHeld) node.type = 'corner';
    }
    dirty = true;
  }
}

// ── Ticker (RAF-synced, coalesces all pointermove events) ──────────────────
let altHeld = false;
function onTick(_ticker: Ticker) {
  if (!dirty) return;
  dirty = false;

  if (isActualDrag && dragTarget) applyDrag(altHeld);

  const newHit = mode.value === 'done' ? hitTestCurves(cursor.x, cursor.y) : null;
  if (newHit !== hoveredCurve.value) {
    hoveredCurve.value = newHit;
    rebuildCommitted();
  }

  rebuildPreview();
  if (isActualDrag && dragTarget) {
    rebuildCommitted();
    rebuildHandles();
  }
}

// ── Pointer event handlers ─────────────────────────────────────────────────
function onStagePointerDown(e: any) {
  if (mode.value === 'done') return;

  const wp = screenToWorld(e.global.x, e.global.y);
  const newAnchor: Anchor = { x: wp.x, y: wp.y, handleIn: null, handleOut: null, type: 'corner' };
  anchors.value.push(newAnchor);

  if (mode.value === 'idle') mode.value = 'drawing';

  pointerIsDown = true;
  isActualDrag = false;
  dragStartScreen = { x: e.global.x, y: e.global.y };
  dragTarget = { kind: 'handleOut', idx: anchors.value.length - 1 };

  rebuildCommitted();
  rebuildHandles();
}

function onStagePointerMove(e: any) {
  const wp = screenToWorld(e.global.x, e.global.y);
  cursor.x = wp.x;
  cursor.y = wp.y;
  altHeld = e.altKey;

  if (pointerIsDown && !isActualDrag) {
    const dscreen = Math.hypot(e.global.x - dragStartScreen.x, e.global.y - dragStartScreen.y);
    if (dscreen > 4) isActualDrag = true;
  }

  dirty = true;
}

function onStagePointerUp() {
  if (isActualDrag && dragTarget?.kind === 'handleOut') {
    const idx = (dragTarget as any).idx;
    const node = anchors.value[idx];
    if (node.handleOut) node.type = 'smooth';
  }
  pointerIsDown = false;
  isActualDrag = false;
  dragTarget = null;
  rebuildHandles();
}

// ── Wheel zoom ─────────────────────────────────────────────────────────────
function onWheel(e: WheelEvent) {
  e.preventDefault();
  const rect = canvasEl.value!.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const wx = (sx - camX) / zoom;
  const wy = (sy - camY) / zoom;
  zoom = Math.max(0.05, Math.min(50, zoom * factor));
  camX = sx - wx * zoom;
  camY = sy - wy * zoom;
  app.stage.position.set(camX, camY);
  app.stage.scale.set(zoom);
  // Scale handle dots inversely so they stay at fixed screen size
  const s = 1 / zoom;
  anchorsLayer.children.forEach(c => (c as Graphics).scale.set(s));
  handlesLayer.children.forEach(c => (c as Graphics).scale.set(s));
}

// ── Keyboard ───────────────────────────────────────────────────────────────
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && mode.value === 'drawing') {
    mode.value = 'done';
    rebuildHandles();
    dirty = true;
  }
  if ((e.key === 'Backspace' || e.key === 'Delete') && mode.value === 'drawing' && anchors.value.length > 0) {
    anchors.value.pop();
    if (anchors.value.length === 0) mode.value = 'idle';
    rebuildCommitted();
    rebuildHandles();
    dirty = true;
  }
  if (e.key === 'r' || e.key === 'R') {
    anchors.value = [];
    closed.value = false;
    mode.value = 'idle';
    hoveredCurve.value = null;
    rebuildCommitted();
    rebuildHandles();
    dirty = true;
  }
}

// ── Panning (middle-click or alt+drag on stage) ────────────────────────────
let isPanning = false;
let panStart = { x: 0, y: 0 };

function onCanvasPointerDown(e: PointerEvent) {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true;
    panStart = { x: e.clientX - camX, y: e.clientY - camY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
}
function onWindowPointerMove(e: PointerEvent) {
  if (!isPanning) return;
  camX = e.clientX - panStart.x;
  camY = e.clientY - panStart.y;
  app.stage.position.set(camX, camY);
}
function onWindowPointerUp() { isPanning = false; }

// ── Mount / Unmount ────────────────────────────────────────────────────────
onMounted(async () => {
  const canvas = canvasEl.value!;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  camX = w / 2; camY = h / 2;

  app = markRaw(new Application());
  await app.init({
    canvas, width: w, height: h, antialias: true,
    backgroundAlpha: 0, resolution: devicePixelRatio, autoDensity: true,
  });

  buildContextTemplates();

  // Scene graph: worldLayer contains all world-space objects
  const worldLayer = markRaw(new Container());
  worldLayer.position.set(camX, camY);
  app.stage.addChild(worldLayer);

  // Draw background grid
  const gridGfx = markRaw(new Graphics());
  for (let x = -2000; x <= 2000; x += 40) {
    (gridGfx as any).setStrokeStyle({ width: 1, color: 0x333333, pixelLine: true });
    gridGfx.moveTo(x, -2000).lineTo(x, 2000).stroke();
  }
  for (let y = -2000; y <= 2000; y += 40) {
    (gridGfx as any).setStrokeStyle({ width: 1, color: 0x333333, pixelLine: true });
    gridGfx.moveTo(-2000, y).lineTo(2000, y).stroke();
  }
  // Origin cross
  (gridGfx as any).setStrokeStyle({ width: 1, color: 0x555555, pixelLine: true });
  gridGfx.moveTo(-20, 0).lineTo(20, 0).stroke();
  gridGfx.moveTo(0, -20).lineTo(0, 20).stroke();
  worldLayer.addChild(gridGfx);

  committedGfx  = markRaw(new Graphics());
  previewGfx    = markRaw(new Graphics());
  handleLineGfx = markRaw(new Graphics());
  anchorsLayer  = markRaw(new Container());
  handlesLayer  = markRaw(new Container());

  // eventMode: drawing layer passive so handle children capture events
  committedGfx.eventMode = 'none';
  handleLineGfx.eventMode = 'none';

  worldLayer.addChild(committedGfx, previewGfx, handleLineGfx, handlesLayer, anchorsLayer);

  // Stage background catches pointerdown for anchor placement
  const bg = markRaw(new Graphics());
  bg.setFillStyle({ color: 0x000000, alpha: 0 });
  bg.rect(-5000, -5000, 10000, 10000).fill();
  bg.eventMode = 'static';
  bg.on('pointerdown', onStagePointerDown);
  worldLayer.addChildAt(bg, 0);

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'pen-tool',
      getSnapshot: (): PenToolSnapshot => ({
        mode: mode.value,
        closed: closed.value,
        anchors: anchors.value.map((a, i) => ({
          index: i,
          type: a.type,
          x: a.x,
          y: a.y,
          hasHandleIn: !!a.handleIn,
          hasHandleOut: !!a.handleOut,
        })),
      }),
    })
  }

  app.stage.eventMode = 'static';
  app.stage.on('pointermove', onStagePointerMove);
  app.stage.on('pointerup', onStagePointerUp);
  app.stage.on('pointerupoutside', onStagePointerUp);

  app.ticker.add(onTick);

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onCanvasPointerDown);
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  canvasEl.value?.removeEventListener('wheel', onWheel);
  canvasEl.value?.removeEventListener('pointerdown', onCanvasPointerDown);
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
  window.removeEventListener('keydown', onKeyDown);
  app?.destroy(true, { children: true, texture: true, context: true });
});
</script>

<template>
  <div class="wrap">
    <canvas ref="canvasEl" />

    <div class="hud">
      <div class="hud-fps">{{ fps }} <span>fps</span></div>
      <div>{{ frameMs }} ms/frame</div>
      <div v-if="heapMB !== null">{{ heapMB }} MB heap</div>
      <div class="hud-sep" />
      <div>mode: <b>{{ mode }}</b></div>
      <div>anchors: {{ anchors.length }}</div>
      <div>zoom: {{ zoom.toFixed(2) }}×</div>
      <div v-if="hoveredCurve !== null">curve hover: seg {{ hoveredCurve }}</div>
    </div>

    <div class="instructions">
      <kbd>click</kbd> corner &nbsp;
      <kbd>drag</kbd> smooth &nbsp;
      <kbd>done→drag corner</kbd> convert &nbsp;
      <kbd>alt+click anchor</kbd> toggle type &nbsp;
      <kbd>alt+drag handle</kbd> break link &nbsp;
      <kbd>click start</kbd> close &nbsp;
      <kbd>Esc</kbd> finish &nbsp;
      <kbd>Del</kbd> undo last &nbsp;
      <kbd>R</kbd> reset
    </div>

    <div class="legend">
      <div><span class="sq corner" /> corner anchor</div>
      <div><span class="sq smooth" /> smooth anchor</div>
      <div><span class="sq" style="background:#cc44cc" /> handle</div>
      <div><span class="sq" style="background:#555577" /> preview</div>
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #111; }
canvas { display: block; width: 100%; height: 100%; cursor: crosshair; }
.hud {
  position: absolute; top: 10px; left: 10px;
  font-family: monospace; font-size: 12px; color: #0f0; line-height: 1.7;
  text-shadow: 0 0 6px #000; pointer-events: none;
}
.hud-fps { font-size: 18px; font-weight: bold; }
.hud-fps span { font-size: 12px; color: #0a0; }
.hud-sep { height: 8px; }
.hud b { color: #ff0; }
.instructions {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #666;
  background: rgba(0,0,0,0.5); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
kbd {
  background: #333; border: 1px solid #555; border-radius: 3px;
  padding: 1px 5px; font-family: monospace; font-size: 10px; color: #bbb;
}
.legend {
  position: absolute; top: 10px; right: 10px;
  font-family: monospace; font-size: 11px; color: #666;
  line-height: 1.8; pointer-events: none;
}
.legend .sq { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
.legend .sq.corner { background: transparent; border: 1.5px solid #00aaff; border-radius: 0; }
.legend .sq.smooth { background: transparent; border: 1.5px solid #00aaff; border-radius: 50%; }
</style>
