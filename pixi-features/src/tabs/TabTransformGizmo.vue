<script setup lang="ts">
/**
 * OBB transform gizmo — hand-rolled for Pixi v8.
 * @pixi-essentials/transformer targets v7 (uses @pixi/display etc.) so we build
 * our own: scale handles on all 8 corners/edges + a rotation handle above top edge.
 *
 * Pattern:
 *  - Selected object lives in a Container with .position + .scale + .rotation
 *  - Gizmo layer sits above it; handles drawn in screen coords after inverting stage transform
 *  - On pointerdown over a handle: record anchor (opposite corner), pre-transform state
 *  - On pointermove: compute new scale or new rotation and apply
 *  - Dirty flag + ticker: rebuild gizmo only when state changed
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics, Container, Ticker } from 'pixi.js';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();

let app = markRaw({} as Application);
let objectLayer = markRaw({} as Container);
let gizmoLayer = markRaw({} as Graphics);
let shapeGfx = markRaw({} as Graphics);

// Object state in world coords
const obj = {
  x: 300, y: 200, w: 180, h: 120,
  scaleX: 1, scaleY: 1,
  rotation: 0,
};

let camX = 0, camY = 0, zoom = 1;
let dirty = true;
let selectedHandle: string | null = null;
const HANDLE_RADIUS = 6;

// Drag state
let dragStart = { mx: 0, my: 0 };
let objSnap = { ...obj };
let anchorWorld = { x: 0, y: 0 };

function screenToWorld(sx: number, sy: number) {
  return { x: (sx - camX) / zoom, y: (sy - camY) / zoom };
}

function worldToScreen(wx: number, wy: number) {
  return { x: wx * zoom + camX, y: wy * zoom + camY };
}

function rotate(x: number, y: number, cx: number, cy: number, angle: number) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = x - cx, dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function getOBBCorners(o: typeof obj) {
  const { x, y, w, h, scaleX, scaleY, rotation } = o;
  const hw = (w * scaleX) / 2, hh = (h * scaleY) / 2;
  const cx = x, cy = y;
  const tl = rotate(cx - hw, cy - hh, cx, cy, rotation);
  const tr = rotate(cx + hw, cy - hh, cx, cy, rotation);
  const br = rotate(cx + hw, cy + hh, cx, cy, rotation);
  const bl = rotate(cx - hw, cy + hh, cx, cy, rotation);
  return { tl, tr, br, bl, cx, cy, hw, hh };
}

function mid(a: {x:number,y:number}, b: {x:number,y:number}) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function getHandlePositions(corners: ReturnType<typeof getOBBCorners>) {
  const { tl, tr, br, bl } = corners;
  return {
    tl, tc: mid(tl, tr), tr,
    ml: mid(tl, bl),               mr: mid(tr, br),
    bl, bc: mid(bl, br), br,
    // Rotate handle: above top center
    rot: (() => {
      const tc = mid(tl, tr);
      const angle = obj.rotation;
      const ux = Math.sin(angle), uy = -Math.cos(angle);
      const dist = 40;
      return { x: tc.x + ux * dist, y: tc.y + uy * dist };
    })(),
  };
}

function drawGizmo() {
  gizmoLayer.clear();
  const corners = getOBBCorners(obj);
  const { tl, tr, br, bl } = corners;
  const handles = getHandlePositions(corners);
  const tls = worldToScreen(tl.x, tl.y);
  const trs = worldToScreen(tr.x, tr.y);
  const brs = worldToScreen(br.x, br.y);
  const bls = worldToScreen(bl.x, bl.y);

  // OBB border
  gizmoLayer.setStrokeStyle({ width: 1.5, color: 0x0099ff });
  gizmoLayer.moveTo(tls.x, tls.y).lineTo(trs.x, trs.y).lineTo(brs.x, brs.y).lineTo(bls.x, bls.y).closePath().stroke();

  // Line to rotate handle
  const tcs = worldToScreen(handles.tc.x, handles.tc.y);
  const rots = worldToScreen(handles.rot.x, handles.rot.y);
  gizmoLayer.setStrokeStyle({ width: 1, color: 0x0066cc });
  gizmoLayer.moveTo(tcs.x, tcs.y).lineTo(rots.x, rots.y).stroke();

  // Scale handles (squares)
  const scaleKeys = ['tl','tc','tr','ml','mr','bl','bc','br'] as const;
  for (const key of scaleKeys) {
    const h = handles[key];
    const hs = worldToScreen(h.x, h.y);
    gizmoLayer.setFillStyle({ color: 0xffffff });
    gizmoLayer.setStrokeStyle({ width: 1.5, color: 0x0099ff });
    gizmoLayer.rect(hs.x - HANDLE_RADIUS, hs.y - HANDLE_RADIUS, HANDLE_RADIUS * 2, HANDLE_RADIUS * 2).fill().stroke();
  }

  // Rotate handle (circle)
  gizmoLayer.setFillStyle({ color: 0x00cc44 });
  gizmoLayer.setStrokeStyle({ width: 1.5, color: 0x00ff55 });
  gizmoLayer.circle(rots.x, rots.y, HANDLE_RADIUS).fill().stroke();
}

function drawShape() {
  shapeGfx.clear();
  const corners = getOBBCorners(obj);
  const { tl, tr, br, bl } = corners;
  shapeGfx.setFillStyle({ color: 0x1a3a5c, alpha: 0.8 });
  shapeGfx.setStrokeStyle({ width: 1.5, color: 0x336699 });
  shapeGfx.moveTo(tl.x, tl.y).lineTo(tr.x, tr.y).lineTo(br.x, br.y).lineTo(bl.x, bl.y).closePath().fill().stroke();

  // Center dot
  shapeGfx.setFillStyle({ color: 0x6699ff });
  shapeGfx.circle(obj.x, obj.y, 3).fill();
}

function hitHandle(sx: number, sy: number): string | null {
  const corners = getOBBCorners(obj);
  const handles = getHandlePositions(corners);
  const allKeys = ['tl','tc','tr','ml','mr','bl','bc','br','rot'] as const;
  for (const key of allKeys) {
    const h = handles[key];
    const hs = worldToScreen(h.x, h.y);
    if (Math.hypot(sx - hs.x, sy - hs.y) <= HANDLE_RADIUS + 4) return key;
  }
  // Hit on shape body?
  const w = screenToWorld(sx, sy);
  const corners2 = getOBBCorners(obj);
  const lx = w.x - obj.x, ly = w.y - obj.y;
  const angle = -obj.rotation;
  const localX = lx * Math.cos(angle) - ly * Math.sin(angle);
  const localY = lx * Math.sin(angle) + ly * Math.cos(angle);
  const hw = (obj.w * obj.scaleX) / 2, hh = (obj.h * obj.scaleY) / 2;
  if (Math.abs(localX) <= hw && Math.abs(localY) <= hh) return 'move';
  return null;
}

let isPanning = false;
let panStart = { x: 0, y: 0 };

function onPD(e: PointerEvent) {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true;
    panStart = { x: e.offsetX - camX, y: e.offsetY - camY };
    return;
  }
  if (e.button !== 0) return;
  const sx = e.offsetX, sy = e.offsetY;
  const hit = hitHandle(sx, sy);
  if (!hit) return;
  selectedHandle = hit;
  dragStart = { mx: sx, my: sy };
  objSnap = { ...obj };

  if (hit === 'rot') {
    // nothing extra needed
  } else if (hit === 'move') {
    // nothing extra
  } else {
    // For scale: compute anchor (opposite handle) in world coords
    const corners = getOBBCorners(obj);
    const handles = getHandlePositions(corners);
    const opposites: Record<string, string> = {
      tl:'br', tr:'bl', bl:'tr', br:'tl',
      tc:'bc', bc:'tc', ml:'mr', mr:'ml',
    };
    const opp = opposites[hit];
    const oppH = handles[opp as keyof typeof handles];
    anchorWorld = { x: oppH.x, y: oppH.y };
  }

  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onPM(e: PointerEvent) {
  if (isPanning) {
    camX = e.offsetX - panStart.x;
    camY = e.offsetY - panStart.y;
    dirty = true;
    return;
  }
  if (!selectedHandle) return;
  const sx = e.offsetX, sy = e.offsetY;

  if (selectedHandle === 'move') {
    const dx = (sx - dragStart.mx) / zoom;
    const dy = (sy - dragStart.my) / zoom;
    obj.x = objSnap.x + dx;
    obj.y = objSnap.y + dy;
  } else if (selectedHandle === 'rot') {
    // Angle from center of object to mouse
    const os = worldToScreen(obj.x, obj.y);
    const angle = Math.atan2(sy - os.y, sx - os.x) + Math.PI / 2;
    obj.rotation = angle;
  } else {
    // Scale: project mouse world pos relative to anchor
    const mw = screenToWorld(sx, sy);
    const aw = anchorWorld;
    const dx = mw.x - aw.x, dy = mw.y - aw.y;
    // Local axis of the handle
    const cos = Math.cos(-obj.rotation), sin = Math.sin(-obj.rotation);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    const isCorner = ['tl','tr','bl','br'].includes(selectedHandle);
    const isHoriz  = ['ml','mr'].includes(selectedHandle);
    const isVert   = ['tc','bc'].includes(selectedHandle);

    if (isCorner || isHoriz) {
      const newW = Math.abs(localX);
      obj.scaleX = Math.max(0.1, newW / obj.w);
    }
    if (isCorner || isVert) {
      const newH = Math.abs(localY);
      obj.scaleY = Math.max(0.1, newH / obj.h);
    }
    // Reposition center from anchor
    const hw = (obj.w * obj.scaleX) / 2;
    const hh = (obj.h * obj.scaleY) / 2;
    const cos2 = Math.cos(obj.rotation), sin2 = Math.sin(obj.rotation);
    const signX = (selectedHandle.includes('l') ? -1 : selectedHandle.includes('r') ? 1 : 0);
    const signY = (selectedHandle.includes('t') ? -1 : selectedHandle.includes('b') ? 1 : 0);
    const lhx = signX * hw, lhy = signY * hh;
    obj.x = aw.x + lhx * cos2 - lhy * sin2;
    obj.y = aw.y + lhx * sin2 + lhy * cos2;
  }

  dirty = true;
}

function onPU() {
  selectedHandle = null;
  isPanning = false;
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const wx = (e.offsetX - camX) / zoom;
  const wy = (e.offsetY - camY) / zoom;
  zoom = Math.max(0.1, Math.min(20, zoom * factor));
  camX = e.offsetX - wx * zoom;
  camY = e.offsetY - wy * zoom;
  dirty = true;
}

function onTick() {
  if (!dirty) return;
  dirty = false;

  // Apply camera to object layer
  objectLayer.position.set(camX, camY);
  objectLayer.scale.set(zoom);

  drawShape();
  drawGizmo();
}

onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    antialias: true,
    background: '#111',
    resolution: devicePixelRatio,
    autoDensity: true,
  });

  camX = canvas.clientWidth / 2 - 300;
  camY = canvas.clientHeight / 2 - 200;

  objectLayer = markRaw(new Container());
  objectLayer.position.set(camX, camY);
  objectLayer.scale.set(zoom);

  shapeGfx = markRaw(new Graphics());
  gizmoLayer = markRaw(new Graphics());

  objectLayer.addChild(shapeGfx);
  app.stage.addChild(objectLayer, gizmoLayer);

  app.ticker.add(onTick);

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'transform-gizmo',
      getSnapshot: () => ({
        x: obj.x,
        y: obj.y,
        width: Math.round(obj.w * obj.scaleX),
        height: Math.round(obj.h * obj.scaleY),
        rotation: obj.rotation,
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
      }),
    })
  }

  canvas.addEventListener('pointerdown', onPD);
  canvas.addEventListener('pointermove', onPM);
  canvas.addEventListener('pointerup', onPU);
  canvas.addEventListener('pointercancel', onPU);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  dirty = true;
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined
  window.__pixiTestBridgeReady = false
  app.ticker?.remove(onTick);
  const canvas = canvasEl.value;
  canvas?.removeEventListener('pointerdown', onPD);
  canvas?.removeEventListener('pointermove', onPM);
  canvas?.removeEventListener('pointerup', onPU);
  canvas?.removeEventListener('pointercancel', onPU);
  canvas?.removeEventListener('wheel', onWheel);
  app?.destroy(true, { children: true, texture: true, context: true });
});
</script>

<template>
  <div class="wrap">
    <canvas ref="canvasEl" />
    <div class="hud">
      <div class="fps">{{ fps }} <span>fps</span></div>
      <div>{{ frameMs }} ms</div>
      <div class="sep" />
      <div>x {{ Math.round(obj.x) }} y {{ Math.round(obj.y) }}</div>
      <div>sx {{ obj.scaleX.toFixed(2) }} sy {{ obj.scaleY.toFixed(2) }}</div>
      <div>rot {{ (obj.rotation * 180 / Math.PI).toFixed(1) }}°</div>
    </div>
    <div class="hint">Drag corner/edge handles to scale · green handle to rotate · drag body to move · <kbd>alt+drag</kbd> pan · scroll zoom</div>
    <div class="legend">
      <span class="sq" /> Scale handle &nbsp;
      <span class="ci" /> Rotate handle
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #111; }
canvas { display: block; width: 100%; height: 100%; cursor: default; }
.hud { position: absolute; top: 10px; left: 10px; font-family: monospace; font-size: 12px; color: #0f0; line-height: 1.7; pointer-events: none; }
.fps { font-size: 18px; font-weight: bold; }
.fps span { font-size: 12px; color: #0a0; }
.sep { height: 6px; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #555;
  background: rgba(0,0,0,0.5); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
.legend {
  position: absolute; bottom: 40px; right: 10px;
  font-family: monospace; font-size: 11px; color: #666;
  background: rgba(0,0,0,0.5); padding: 5px 10px; border-radius: 4px;
  display: flex; align-items: center; gap: 4px;
}
.sq { display: inline-block; width: 10px; height: 10px; background: #fff; border: 1.5px solid #0099ff; }
.ci { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #00cc44; border: 1.5px solid #00ff55; }
kbd { background: #333; border: 1px solid #555; border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: 10px; color: #bbb; }
</style>
