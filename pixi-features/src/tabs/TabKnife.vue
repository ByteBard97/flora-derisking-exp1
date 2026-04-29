<script setup lang="ts">
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics, Container } from 'pixi.js';
import { Bezier } from 'bezier-js';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();
const statusMsg = ref('Drag a cut line across the shape');

let app = markRaw({} as Application);
let shapeLayer = markRaw({} as Container);
let cutLayer   = markRaw({} as Container);
let shapeGfx   = markRaw({} as Graphics);
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
  // Remove any extra result graphics added during a previous cut
  while (shapeLayer.children.length > 1) {
    const child = shapeLayer.children[1] as import('pixi.js').Graphics;
    shapeLayer.removeChildAt(1);
    child.destroy();
  }
  drawClosedPath(shapeGfx, buildSegments(SOURCE_ANCHORS), 0x1a3a5a, 0x4488cc);
  cutGfx.clear();
  statusMsg.value = 'Drag a cut line across the shape';
}

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
  cutGfx.setFillStyle({ color: 0xff2222 });
  cutGfx.circle(cutStart.x, cutStart.y, 4).fill();
  cutGfx.circle(cutEnd.x, cutEnd.y, 4).fill();
}

function onPU() {
  if (!cutting) return;
  cutting = false;
  performCut(cutStart, cutEnd);
}

function performCut(from: { x:number;y:number }, to: { x:number;y:number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 5) { resetShape(); return; }

  const segs = buildSegments(SOURCE_ANCHORS);

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

  shapeGfx.clear();
  drawClosedPath(shapeGfx, splitResult.path1, 0x2a5a1a, 0x44cc44);

  const gfx2 = markRaw(new Graphics());
  drawClosedPath(gfx2, splitResult.path2, 0x5a1a2a, 0xcc4444);
  shapeLayer.addChild(gfx2);

  cutGfx.clear();
  statusMsg.value = `Split! ${splitResult.path1.length} + ${splitResult.path2.length} segments`;
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
