<script setup lang="ts">
/**
 * Leader line + draggable label spike.
 *
 * Answers the question: can a label inside a plant container be independently
 * dragged without event conflicts with the plant container's own drag?
 *
 * Geometry ported from FloraLeaderLineDrawing.cpp:
 *   - RayRectExit: where the ray from labelCenter→circleCenter exits the label rect
 *   - CircleEdgePoint: point on circle edge nearest the label
 *   - Suppress when labelCenter is inside circle OR distance < NEARNESS_THRESHOLD
 *   - Arrowhead: filled triangle, length = ARROW_LENGTH_FACTOR * strokeWidth
 */
import { onMounted, onUnmounted, ref, markRaw } from 'vue';
import {
  Application,
  Container,
  Graphics,
  Sprite,
  Texture,
  BitmapFont,
  BitmapText,
  TextStyle,
  Cache,
} from 'pixi.js';
import { Viewport } from 'pixi-viewport';

const SPRITE_SIZE_PX = 512;

async function svgToTexture(url: string): Promise<Texture> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_SIZE_PX;
  canvas.height = SPRITE_SIZE_PX;
  canvas.getContext('2d')!.drawImage(img, 0, 0, SPRITE_SIZE_PX, SPRITE_SIZE_PX);
  return Texture.from(canvas);
}

// ─── Geometry constants (from FloraLeaderLineDrawing.cpp) ───────────────────
const NEARNESS_THRESHOLD = 2;   // px — suppress line if gap is this small
const STROKE_WIDTH = 1.5;
const ARROW_LENGTH_FACTOR = 10;  // arrowhead length = factor * strokeWidth
const ARROW_HALF_WIDTH_FACTOR = 3; // arrowhead half-width = factor * strokeWidth

// ─── Geometry helpers (direct TypeScript port of C++ functions) ─────────────

interface Pt { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }

/** Where a ray from `inside` toward `target` exits the bounding rect. */
function rayRectExit(rect: Rect, inside: Pt, target: Pt): Pt {
  const dx = target.x - inside.x;
  const dy = target.y - inside.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return inside;

  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;

  let tMin = 1e18;

  if (Math.abs(dx) > 1e-9) {
    let t = (left - inside.x) / dx;
    if (t > 0 && t < tMin) {
      const y = inside.y + t * dy;
      if (y >= top && y <= bottom) tMin = t;
    }
    t = (right - inside.x) / dx;
    if (t > 0 && t < tMin) {
      const y = inside.y + t * dy;
      if (y >= top && y <= bottom) tMin = t;
    }
  }
  if (Math.abs(dy) > 1e-9) {
    let t = (top - inside.y) / dy;
    if (t > 0 && t < tMin) {
      const x = inside.x + t * dx;
      if (x >= left && x <= right) tMin = t;
    }
    t = (bottom - inside.y) / dy;
    if (t > 0 && t < tMin) {
      const x = inside.x + t * dx;
      if (x >= left && x <= right) tMin = t;
    }
  }

  if (tMin >= 1e17) return inside;
  return { x: inside.x + tMin * dx, y: inside.y + tMin * dy };
}

/** Point on the circle edge nearest to `from`. */
function circleEdgePoint(center: Pt, radius: number, from: Pt): Pt {
  const dx = from.x - center.x;
  const dy = from.y - center.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return { x: center.x + radius, y: center.y };
  return { x: center.x + (dx / dist) * radius, y: center.y + (dy / dist) * radius };
}

// ─── Component ──────────────────────────────────────────────────────────────

const canvasEl = ref<HTMLCanvasElement>();
const statusMsg = ref('Drag the label. The leader line redraws live.');

let app = markRaw({} as Application);

// Plant properties (world space, center of canvas)
const PLANT_RADIUS = 60;
const PLANT_COLOR = 0x4a7c59;

// Label size — measured from BitmapText after creation
let labelW = 80;
let labelH = 20;

onMounted(async () => {
  app = markRaw(new Application());
  await app.init({
    canvas: canvasEl.value!,
    width: canvasEl.value!.clientWidth,
    height: canvasEl.value!.clientHeight,
    antialias: true,
    background: '#1a1a1a',
    resolution: devicePixelRatio,
    autoDensity: true,
  });

  const W = app.screen.width;
  const H = app.screen.height;
  const CENTER: Pt = { x: W / 2, y: H / 2 };

  // pixi-viewport — standard 2D camera for pan + zoom + pinch
  const viewport = markRaw(new Viewport({
    screenWidth: W,
    screenHeight: H,
    worldWidth: W * 4,
    worldHeight: H * 4,
    events: app.renderer.events,
  }));

  viewport
    .drag()
    .wheel({ smooth: 8 })
    .decelerate({ friction: 0.93 })
    .clampZoom({ minScale: 0.1, maxScale: 20 })
    .pinch();

  app.stage.addChild(viewport);
  viewport.moveCenter(CENTER.x, CENTER.y);

  // ── BitmapFont ────────────────────────────────────────────────────────────
  if (!Cache.has('ll-label-v2-bitmap')) {
    BitmapFont.install({
      name: 'll-label-v2',
      style: new TextStyle({
        fontFamily: 'Times New Roman, serif',
        fontSize: 48,
        fill: '#ffffff',
        fontWeight: 'bold',
      }),
      chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-',
      resolution: 2,
    });
  }

  // ── Plant container ───────────────────────────────────────────────────────
  // The plant container is draggable. Label is a child with its own drag.
  // Key question: does label.pointerdown.stopPropagation() prevent the plant
  // container from starting its drag? That's what this spike tests.
  const plantContainer = markRaw(new Container());
  plantContainer.position.set(CENTER.x, CENTER.y);
  plantContainer.eventMode = 'static';
  plantContainer.cursor = 'move';
  viewport.addChild(plantContainer);

  // Circle
  const circle = markRaw(new Graphics());
  circle.circle(0, 0, PLANT_RADIUS).fill({ color: PLANT_COLOR, alpha: 0.75 });
  circle.circle(0, 0, PLANT_RADIUS).stroke({ color: 0x2d5a1b, width: 2 });
  circle.eventMode = 'none';
  plantContainer.addChild(circle);

  // Oak SVG sprite on top of the circle
  const oakTexture = await svgToTexture('/sprites/oak.svg');
  const sprite = markRaw(new Sprite(oakTexture));
  sprite.anchor.set(0.5);
  sprite.width = PLANT_RADIUS * 1.6;
  sprite.height = PLANT_RADIUS * 1.6;
  sprite.eventMode = 'none';
  plantContainer.addChild(sprite);

  // Leader line graphics (drawn on each label move, sitting behind label in stack)
  const leaderGfx = markRaw(new Graphics());
  leaderGfx.eventMode = 'none';
  plantContainer.addChild(leaderGfx);

  // Label — positioned to the right of the circle initially
  const labelText = markRaw(new BitmapText({
    text: 'OAK-01',
    style: { fontFamily: 'll-label-v2', fontSize: 18 },
  }));
  labelText.anchor.set(0.5, 0.5);
  labelText.position.set(PLANT_RADIUS + 50, 0);
  labelText.eventMode = 'static';
  labelText.cursor = 'grab';
  plantContainer.addChild(labelText);

  // Measure label bounds after adding to stage
  await new Promise(r => requestAnimationFrame(r));
  labelW = labelText.width + 8;
  labelH = labelText.height + 4;

  // ── Redraw leader line ────────────────────────────────────────────────────
  function redrawLeader(): void {
    leaderGfx.clear();

    const lx = labelText.x;
    const ly = labelText.y;

    const labelCenter: Pt = { x: lx, y: ly };
    const circleCenter: Pt = { x: 0, y: 0 };

    // Label bounding rect in plant-local space
    const labelRect: Rect = {
      x: lx - labelW / 2,
      y: ly - labelH / 2,
      w: labelW,
      h: labelH,
    };

    // (No background box — text sits directly on the dark canvas)

    const dxC = labelCenter.x - circleCenter.x;
    const dyC = labelCenter.y - circleCenter.y;
    const distToCenter = Math.sqrt(dxC * dxC + dyC * dyC);
    const labelInsideCircle = distToCenter <= PLANT_RADIUS;

    const labelEdgePt = rayRectExit(labelRect, labelCenter, circleCenter);
    const circleEdgePt = circleEdgePoint(circleCenter, PLANT_RADIUS, labelCenter);

    const dx = labelEdgePt.x - circleEdgePt.x;
    const dy = labelEdgePt.y - circleEdgePt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!labelInsideCircle && dist > NEARNESS_THRESHOLD) {
      const arrowLen = STROKE_WIDTH * ARROW_LENGTH_FACTOR;
      const drawArrow = dist > arrowLen * 2;

      if (drawArrow) {
        // Shorten line to arrowhead base
        const adx = circleEdgePt.x - labelEdgePt.x;
        const ady = circleEdgePt.y - labelEdgePt.y;
        const aDist = Math.sqrt(adx * adx + ady * ady);
        const ux = adx / aDist;
        const uy = ady / aDist;
        const arrowBase: Pt = {
          x: circleEdgePt.x - ux * arrowLen,
          y: circleEdgePt.y - uy * arrowLen,
        };

        // Line
        leaderGfx.moveTo(labelEdgePt.x, labelEdgePt.y)
          .lineTo(arrowBase.x, arrowBase.y)
          .stroke({ color: 0xe0e0e0, width: STROKE_WIDTH });

        // Arrowhead triangle
        const halfW = STROKE_WIDTH * ARROW_HALF_WIDTH_FACTOR;
        const px = -uy;
        const py = ux;
        leaderGfx
          .poly([
            circleEdgePt.x, circleEdgePt.y,
            arrowBase.x + px * halfW, arrowBase.y + py * halfW,
            arrowBase.x - px * halfW, arrowBase.y - py * halfW,
          ])
          .fill({ color: 0xe0e0e0 });
      } else {
        // No arrowhead — just a line
        leaderGfx.moveTo(labelEdgePt.x, labelEdgePt.y)
          .lineTo(circleEdgePt.x, circleEdgePt.y)
          .stroke({ color: 0xe0e0e0, width: STROKE_WIDTH });
      }
    }
  }

  redrawLeader();

  // ── Label drag ─────────────────────────────────────────────────────────────
  let labelDragging = false;
  let labelDragStart = { x: 0, y: 0 };
  let labelPosStart = { x: 0, y: 0 };

  labelText.on('pointerdown', (e) => {
    labelDragging = true;
    labelDragStart = { x: e.global.x, y: e.global.y };
    labelPosStart = { x: labelText.x, y: labelText.y };
    labelText.cursor = 'grabbing';
    e.stopPropagation(); // prevent viewport pan AND plant container drag
    viewport.plugins.pause('drag');  // stop viewport from panning while label drags
    statusMsg.value = 'Label dragging — does plant move? It should NOT.';
  });

  app.stage.eventMode = 'static';
  app.stage.on('pointermove', (e) => {
    if (!labelDragging) return;
    const z = viewport.scale.x;
    const dx = (e.global.x - labelDragStart.x) / z;
    const dy = (e.global.y - labelDragStart.y) / z;
    labelText.position.set(labelPosStart.x + dx, labelPosStart.y + dy);
    redrawLeader();
  });

  app.stage.on('pointerup', () => {
    if (!labelDragging) return;
    labelDragging = false;
    labelText.cursor = 'grab';
    viewport.plugins.resume('drag');
    statusMsg.value = 'Label dropped. Leader line updated. ✓';
  });

  // ── Plant container drag ───────────────────────────────────────────────────
  let plantDragging = false;
  let plantDragStart = { x: 0, y: 0 };
  let plantPosStart = { x: 0, y: 0 };

  plantContainer.on('pointerdown', (e) => {
    plantDragging = true;
    plantDragStart = { x: e.global.x, y: e.global.y };
    plantPosStart = { x: plantContainer.x, y: plantContainer.y };
    e.stopPropagation();
    viewport.plugins.pause('drag');
    statusMsg.value = 'Plant dragging — label should follow (it is a child).';
  });

  app.stage.on('pointermove', (e) => {
    if (!plantDragging) return;
    const z = viewport.scale.x;
    plantContainer.position.set(
      plantPosStart.x + (e.global.x - plantDragStart.x) / z,
      plantPosStart.y + (e.global.y - plantDragStart.y) / z,
    );
  });

  app.stage.on('pointerup', () => {
    if (!plantDragging) return;
    plantDragging = false;
    viewport.plugins.resume('drag');
    statusMsg.value = 'Plant dropped. ✓';
  });
  app.stage.on('pointerupoutside', () => {
    if (labelDragging || plantDragging) viewport.plugins.resume('drag');
    labelDragging = false;
    plantDragging = false;
  });
});

onUnmounted(() => {
  app?.destroy(true, { children: true, texture: true, context: true });
});
</script>

<template>
  <div class="wrap">
    <canvas ref="canvasEl" />
    <div class="status">{{ statusMsg }}</div>
    <div class="legend">
      <div><span class="dot plant" />Plant circle (drag to move plant)</div>
      <div><span class="dot label" />Label (drag independently)</div>
      <div><span class="dot line" />Leader line (auto-redraws)</div>
    </div>
    <div class="notes">
      <strong>Pan:</strong> click &amp; drag empty canvas · <strong>Zoom:</strong> scroll wheel / pinch<br>
      <strong>Spike question:</strong> when you drag the label, does the plant move too?<br>
      If the plant stays still while only the label moves → event isolation works → labels can be children of plant containers.
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; }
canvas { display: block; width: 100%; height: 100%; }
.status {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 13px; color: #0f0;
  background: rgba(0,0,0,0.8); padding: 6px 16px; border-radius: 4px;
  pointer-events: none; white-space: nowrap;
}
.legend {
  position: absolute; top: 12px; left: 12px;
  font-family: monospace; font-size: 11px; color: #aaa;
  background: rgba(0,0,0,0.75); padding: 8px 12px; border-radius: 4px;
  pointer-events: none; line-height: 2;
}
.dot {
  display: inline-block; width: 10px; height: 10px;
  border-radius: 50%; margin-right: 6px; vertical-align: middle;
}
.dot.plant { background: #4a7c59; }
.dot.label { background: #ffffff; border-radius: 2px; }
.dot.line  { background: #e0e0e0; width: 20px; height: 2px; border-radius: 0; }
.notes {
  position: absolute; bottom: 12px; left: 12px; right: 12px;
  font-family: monospace; font-size: 11px; color: #999;
  background: rgba(0,0,0,0.75); padding: 10px 14px; border-radius: 4px;
  pointer-events: none; line-height: 1.6;
}
</style>
