<script setup lang="ts">
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics, Container, Point } from 'pixi.js';
import { Bezier } from 'bezier-js';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();
const statusMsg = ref('Drag a cut line across the shape');

let app = markRaw({} as Application);
let shapeLayer = markRaw({} as Container);
let cutLayer   = markRaw({} as Container);
let cutGfx     = markRaw({} as Graphics);

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

interface ShapeObject {
  container: Container;
  segsLocal: CubicSeg[];
  bboxW: number;
  bboxH: number;
}

const toolMode = ref<'knife' | 'select'>('knife');
let shapes: ShapeObject[] = [];
let selectedShape: ShapeObject | null = null;
let selectedHandle: string | null = null;
let gizmoGfx = markRaw({} as Graphics);
const HANDLE_RADIUS = 6;
let dragStart = { mx: 0, my: 0 };
let snapPos = { x: 0, y: 0 }, snapSX = 1, snapSY = 1, snapRot = 0;
let anchorWorld = { x: 0, y: 0 };

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

function screenPt(e: PointerEvent) {
  const r = canvasEl.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function makeShapeObject(segs: CubicSeg[], fillColor: number, strokeColor: number): ShapeObject {
  // Sample to estimate centroid and bbox
  const pts: { x: number; y: number }[] = [];
  for (const s of segs) {
    const b = new Bezier(s.p0.x, s.p0.y, s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.p1.x, s.p1.y);
    for (let i = 0; i <= 12; i++) {
      const p = b.get(i / 12);
      pts.push({ x: p.x, y: p.y });
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let sumX = 0, sumY = 0;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / pts.length;
  const cy = sumY / pts.length;
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;

  const segsLocal: CubicSeg[] = segs.map(s => ({
    p0:  { x: s.p0.x  - cx, y: s.p0.y  - cy },
    cp1: { x: s.cp1.x - cx, y: s.cp1.y - cy },
    cp2: { x: s.cp2.x - cx, y: s.cp2.y - cy },
    p1:  { x: s.p1.x  - cx, y: s.p1.y  - cy },
  }));

  const container = markRaw(new Container());
  container.position.set(cx, cy);
  const gfx = markRaw(new Graphics());
  drawClosedPath(gfx, segsLocal, fillColor, strokeColor);
  container.addChild(gfx);

  return { container, segsLocal, bboxW, bboxH };
}

function resetShape() {
  for (const s of shapes) {
    s.container.destroy({ children: true });
  }
  shapes = [];
  selectedShape = null;
  selectedHandle = null;
  gizmoGfx.clear();
  cutGfx.clear();

  const shape = makeShapeObject(buildSegments(SOURCE_ANCHORS), 0x1a3a5a, 0x4488cc);
  shapeLayer.addChild(shape.container);
  shapes.push(shape);

  toolMode.value = 'knife';
  statusMsg.value = 'Drag a cut line across the shape';
}

let cutting = false;
let cutStart = { x: 0, y: 0 };
let cutEnd   = { x: 0, y: 0 };

function rotatePt(x: number, y: number, cx: number, cy: number, angle: number) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = x - cx, dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function getOBB(shape: ShapeObject) {
  const c = shape.container;
  const cx = c.x, cy = c.y;
  const hw = (shape.bboxW * c.scale.x) / 2;
  const hh = (shape.bboxH * c.scale.y) / 2;
  const rot = c.rotation;
  const tl = rotatePt(cx - hw, cy - hh, cx, cy, rot);
  const tr = rotatePt(cx + hw, cy - hh, cx, cy, rot);
  const br = rotatePt(cx + hw, cy + hh, cx, cy, rot);
  const bl = rotatePt(cx - hw, cy + hh, cx, cy, rot);
  return { tl, tr, br, bl, cx, cy, hw, hh };
}

function mid(a: {x:number;y:number}, b: {x:number;y:number}) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function getHandles(shape: ShapeObject) {
  const corners = getOBB(shape);
  const { tl, tr, br, bl } = corners;
  const tc = mid(tl, tr);
  const rot = (() => {
    const angle = shape.container.rotation;
    const ux = Math.sin(angle), uy = -Math.cos(angle);
    const dist = 40;
    return { x: tc.x + ux * dist, y: tc.y + uy * dist };
  })();
  return {
    tl, tc, tr,
    ml: mid(tl, bl), mr: mid(tr, br),
    bl, bc: mid(bl, br), br,
    rot,
  };
}

function drawGizmo() {
  gizmoGfx.clear();
  if (!selectedShape) return;
  const corners = getOBB(selectedShape);
  const { tl, tr, br, bl } = corners;
  const handles = getHandles(selectedShape);

  // OBB border
  gizmoGfx.setStrokeStyle({ width: 1.5, color: 0x0099ff });
  gizmoGfx.moveTo(tl.x, tl.y).lineTo(tr.x, tr.y).lineTo(br.x, br.y).lineTo(bl.x, bl.y).closePath().stroke();

  // Line to rotate handle
  gizmoGfx.setStrokeStyle({ width: 1, color: 0x0066cc });
  gizmoGfx.moveTo(handles.tc.x, handles.tc.y).lineTo(handles.rot.x, handles.rot.y).stroke();

  // Scale handles (squares)
  const scaleKeys = ['tl','tc','tr','ml','mr','bl','bc','br'] as const;
  for (const key of scaleKeys) {
    const h = handles[key];
    gizmoGfx.setFillStyle({ color: 0xffffff });
    gizmoGfx.setStrokeStyle({ width: 1.5, color: 0x0099ff });
    gizmoGfx.rect(h.x - HANDLE_RADIUS, h.y - HANDLE_RADIUS, HANDLE_RADIUS * 2, HANDLE_RADIUS * 2).fill().stroke();
  }

  // Rotate handle (circle)
  gizmoGfx.setFillStyle({ color: 0x00cc44 });
  gizmoGfx.setStrokeStyle({ width: 1.5, color: 0x00ff55 });
  gizmoGfx.circle(handles.rot.x, handles.rot.y, HANDLE_RADIUS).fill().stroke();
}

function hitBody(shape: ShapeObject, sx: number, sy: number): boolean {
  const local = shape.container.toLocal(new Point(sx, sy));
  const hw = shape.bboxW / 2;
  const hh = shape.bboxH / 2;
  return Math.abs(local.x) <= hw && Math.abs(local.y) <= hh;
}

function hitHandleOrBody(sx: number, sy: number): { shape: ShapeObject; handle: string | null } | null {
  // Check selected shape handles first
  if (selectedShape) {
    const handles = getHandles(selectedShape);
    const allKeys = ['tl','tc','tr','ml','mr','bl','bc','br','rot'] as const;
    for (const key of allKeys) {
      const h = handles[key];
      if (Math.hypot(sx - h.x, sy - h.y) <= HANDLE_RADIUS + 4) {
        return { shape: selectedShape, handle: key };
      }
    }
    // Check selected shape body
    if (hitBody(selectedShape, sx, sy)) {
      return { shape: selectedShape, handle: 'move' };
    }
  }
  // Check all shapes for body hit (selecting another shape)
  for (const shape of shapes) {
    if (shape === selectedShape) continue;
    if (hitBody(shape, sx, sy)) {
      return { shape, handle: 'move' };
    }
  }
  return null;
}

function onPD(e: PointerEvent) {
  if (e.button !== 0) return;
  const pt = screenPt(e);

  if (toolMode.value === 'knife') {
    cutting = true;
    cutStart = pt;
    cutEnd = { ...pt };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    return;
  }

  // select mode
  const hit = hitHandleOrBody(pt.x, pt.y);
  if (hit) {
    if (hit.shape !== selectedShape) {
      selectedShape = hit.shape;
      selectedHandle = null;
    }
    if (hit.handle && hit.handle !== 'move') {
      selectedHandle = hit.handle;
      dragStart = { mx: pt.x, my: pt.y };
      const c = selectedShape.container;
      snapPos = { x: c.x, y: c.y };
      snapSX = c.scale.x;
      snapSY = c.scale.y;
      snapRot = c.rotation;

      if (hit.handle === 'rot') {
        // nothing extra
      } else {
        const handles = getHandles(selectedShape);
        const opposites: Record<string, string> = {
          tl:'br', tr:'bl', bl:'tr', br:'tl',
          tc:'bc', bc:'tc', ml:'mr', mr:'ml',
        };
        const opp = opposites[hit.handle];
        const oppH = handles[opp as keyof typeof handles];
        anchorWorld = { x: oppH.x, y: oppH.y };
      }
    } else if (hit.handle === 'move') {
      selectedHandle = 'move';
      dragStart = { mx: pt.x, my: pt.y };
      const c = selectedShape!.container;
      snapPos = { x: c.x, y: c.y };
    }
    drawGizmo();
  } else {
    selectedShape = null;
    selectedHandle = null;
    gizmoGfx.clear();
  }
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onPM(e: PointerEvent) {
  const pt = screenPt(e);

  if (toolMode.value === 'knife') {
    if (!cutting) return;
    cutEnd = pt;
    cutGfx.clear();
    cutGfx.setStrokeStyle({ width: 1.5, color: 0xff2222 });
    cutGfx.moveTo(cutStart.x, cutStart.y).lineTo(cutEnd.x, cutEnd.y).stroke();
    cutGfx.beginPath();
    cutGfx.setFillStyle({ color: 0xff2222 });
    cutGfx.circle(cutStart.x, cutStart.y, 4).fill();
    cutGfx.beginPath();
    cutGfx.circle(cutEnd.x, cutEnd.y, 4).fill();
    return;
  }

  // select mode
  if (!selectedHandle || !selectedShape) return;
  const sx = pt.x, sy = pt.y;
  const c = selectedShape.container;

  if (selectedHandle === 'move') {
    c.position.set(snapPos.x + (sx - dragStart.mx), snapPos.y + (sy - dragStart.my));
  } else if (selectedHandle === 'rot') {
    const angle = Math.atan2(sy - c.y, sx - c.x) + Math.PI / 2;
    c.rotation = angle;
  } else {
    // Scale handles
    const dx = sx - anchorWorld.x, dy = sy - anchorWorld.y;
    const cos = Math.cos(-snapRot), sin = Math.sin(-snapRot);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    const isCorner = ['tl','tr','bl','br'].includes(selectedHandle);
    const isHoriz  = ['ml','mr'].includes(selectedHandle);
    const isVert   = ['tc','bc'].includes(selectedHandle);

    if (isCorner || isHoriz) {
      const newW = Math.abs(localX);
      c.scale.x = Math.max(0.1, newW / selectedShape.bboxW);
    }
    if (isCorner || isVert) {
      const newH = Math.abs(localY);
      c.scale.y = Math.max(0.1, newH / selectedShape.bboxH);
    }
    // Reposition center from anchor
    const hw = (selectedShape.bboxW * c.scale.x) / 2;
    const hh = (selectedShape.bboxH * c.scale.y) / 2;
    const cos2 = Math.cos(c.rotation), sin2 = Math.sin(c.rotation);
    const signX = (selectedHandle.includes('l') ? -1 : selectedHandle.includes('r') ? 1 : 0);
    const signY = (selectedHandle.includes('t') ? -1 : selectedHandle.includes('b') ? 1 : 0);
    const lhx = signX * hw, lhy = signY * hh;
    c.position.set(
      anchorWorld.x + lhx * cos2 - lhy * sin2,
      anchorWorld.y + lhx * sin2 + lhy * cos2,
    );
  }

  drawGizmo();
}

function onPU() {
  if (toolMode.value === 'knife') {
    if (!cutting) return;
    cutting = false;
    performCut(cutStart, cutEnd);
    return;
  }
  selectedHandle = null;
}

function performCut(from: { x:number;y:number }, to: { x:number;y:number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 5) { resetShape(); return; }

  // Find the shape being cut (the one that contains the midpoint of the cut line)
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  let targetShape: ShapeObject | null = null;
  for (const s of shapes) {
    if (hitBody(s, midX, midY)) {
      targetShape = s;
      break;
    }
  }
  if (!targetShape) {
    statusMsg.value = 'Cut line did not cross any shape. Try again.';
    cutGfx.clear();
    return;
  }

  // Convert cut line to world coords (same as screen here) then local to the shape
  const localFrom = targetShape.container.toLocal(new Point(from.x, from.y));
  const localTo = targetShape.container.toLocal(new Point(to.x, to.y));

  // Reconstruct world-space segments from local segments + container transform
  const segs: CubicSeg[] = targetShape.segsLocal.map(s => {
    const toWorld = (p: {x:number;y:number}) => {
      const lp = targetShape!.container.toGlobal(new Point(p.x, p.y));
      return { x: lp.x, y: lp.y };
    };
    return {
      p0: toWorld(s.p0), cp1: toWorld(s.cp1), cp2: toWorld(s.cp2), p1: toWorld(s.p1),
    };
  });

  type Hit = { segIndex: number; t: number };
  const hits: Hit[] = [];
  const line = { p1: from, p2: to };

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const b = new Bezier(s.p0.x, s.p0.y, s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.p1.x, s.p1.y);
    const xs = b.intersects(line) as (string | number)[];
    for (const raw of xs) {
      const t = typeof raw === 'string' ? parseFloat(raw.split('/')[0]) : raw;
      if (t > 0.001 && t < 0.999) hits.push({ segIndex: i, t });
    }
  }

  if (hits.length < 2) {
    statusMsg.value = `Need 2 intersections to split — got ${hits.length}. Try cutting fully across the shape.`;
    cutGfx.clear();
    return;
  }

  hits.sort((a, b) => a.segIndex !== b.segIndex ? a.segIndex - b.segIndex : a.t - b.t);
  const [hitA, hitB] = hits;

  const splitResult = splitPathAtHits(segs, hitA, hitB);

  // Remove original shape
  shapeLayer.removeChild(targetShape.container);
  targetShape.container.destroy({ children: true });
  shapes = shapes.filter(s => s !== targetShape);
  selectedShape = null;
  selectedHandle = null;
  gizmoGfx.clear();

  const shape1 = makeShapeObject(splitResult.path1, 0x2a5a1a, 0x44cc44);
  const shape2 = makeShapeObject(splitResult.path2, 0x5a1a2a, 0xcc4444);
  shapeLayer.addChild(shape1.container, shape2.container);
  shapes.push(shape1, shape2);

  cutGfx.clear();
  statusMsg.value = `Split! ${splitResult.path1.length} + ${splitResult.path2.length} segments`;

  toolMode.value = 'select';
}

function splitSeg(s: CubicSeg, t: number): [CubicSeg, CubicSeg] {
  const b = new Bezier(s.p0.x, s.p0.y, s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.p1.x, s.p1.y);
  const { left, right } = b.split(t);
  const toSeg = (bz: { points: { x:number;y:number }[] }): CubicSeg => ({
    p0:  { x: bz.points[0].x, y: bz.points[0].y },
    cp1: { x: bz.points[1].x, y: bz.points[1].y },
    cp2: { x: bz.points[2].x, y: bz.points[2].y },
    p1:  { x: bz.points[3].x, y: bz.points[3].y },
  });
  return [toSeg(left), toSeg(right)];
}

function splitPathAtHits(
  segs: CubicSeg[],
  hitA: { segIndex: number; t: number },
  hitB: { segIndex: number; t: number },
): { path1: CubicSeg[]; path2: CubicSeg[] } {
  let expanded = [...segs];

  // Split hitB first (higher index) so hitA indices remain stable
  const [leftB, rightB] = splitSeg(expanded[hitB.segIndex], hitB.t);
  expanded.splice(hitB.segIndex, 1, leftB, rightB);

  // Adjust hitA's t if it was on the same segment as hitB
  const hitASeg = hitA.segIndex;
  const hitATAdj = hitA.segIndex === hitB.segIndex
    ? hitA.t / hitB.t
    : hitA.t;

  const [leftA, rightA] = splitSeg(expanded[hitASeg], hitATAdj);
  expanded.splice(hitASeg, 1, leftA, rightA);

  // After two splits: cut points are at end of leftA (index hitASeg) and end of leftB
  const cutAIdx = hitASeg;
  const cutBIdx = hitB.segIndex + 1;

  const n = expanded.length;
  const path1: CubicSeg[] = [];
  const path2: CubicSeg[] = [];

  let i = (cutAIdx + 1) % n;
  while (true) {
    path1.push(expanded[i]);
    if (i === cutBIdx % n) break;
    i = (i + 1) % n;
    if (path1.length > n) break;
  }

  i = ((cutBIdx % n) + 1) % n;
  while (true) {
    path2.push(expanded[i]);
    if (i === cutAIdx % n) break;
    i = (i + 1) % n;
    if (path2.length > n) break;
  }

  return { path1, path2 };
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    selectedShape = null;
    selectedHandle = null;
    gizmoGfx.clear();
  }
}

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
  cutGfx     = markRaw(new Graphics());
  gizmoGfx   = markRaw(new Graphics());

  cutLayer.addChild(cutGfx);
  app.stage.addChild(shapeLayer, cutLayer, gizmoGfx);

  resetShape();

  canvas.addEventListener('pointerdown', onPD);
  canvas.addEventListener('pointermove', onPM);
  canvas.addEventListener('pointerup', onPU);
  window.addEventListener('keydown', onKeyDown);

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge');
    registerPixiBridge(app, { tabName: 'knife', getSnapshot: () => ({ status: statusMsg.value, mode: toolMode.value }) });
  }
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined;
  window.__pixiTestBridgeReady = false;
  canvasEl.value?.removeEventListener('pointerdown', onPD);
  canvasEl.value?.removeEventListener('pointermove', onPM);
  canvasEl.value?.removeEventListener('pointerup', onPU);
  window.removeEventListener('keydown', onKeyDown);
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
    <button @click="toolMode = toolMode === 'knife' ? 'select' : 'knife'; selectedShape = null; gizmoGfx.clear()" style="position:absolute;top:10px;right:120px;padding:4px 12px;background:#2a2a2a;border:1px solid #444;color:#888;border-radius:3px;cursor:pointer;font-family:monospace;font-size:11px">
      {{ toolMode === 'knife' ? '✂ Knife' : '↕ Select' }}
    </button>
    <button @click="resetShape" style="position:absolute;top:10px;right:10px;padding:4px 12px;background:#2a2a2a;border:1px solid #444;color:#888;border-radius:3px;cursor:pointer;font-family:monospace;font-size:11px">
      Reset
    </button>
    <div style="position:absolute;bottom:10px;left:10px;font-family:monospace;font-size:11px;color:#444">
      {{ toolMode === 'knife' ? 'Drag across the shape to cut it in two' : 'Click a piece to select · drag handles to transform · Esc to deselect' }}
    </div>
  </div>
</template>
