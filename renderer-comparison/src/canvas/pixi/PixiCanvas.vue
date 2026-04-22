<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { Application, Graphics } from 'pixi.js';
import { PixiRenderer } from './PixiRenderer';
import type { Plant, Bed } from '@/stores/docStore';

const DRAG_THRESHOLD_PX = 4;

const props = defineProps<{
  plants: Plant[];
  beds: Bed[];
  selectedId: string | null;
  panSensitivity?: number;
  zoomSensitivity?: number;
}>();

const emit = defineEmits<{
  dragEnd: [plantId: string, pos: { x: number; y: number }];
  select: [plantId: string | null];
  ready: [ttiMs: number];
}>();

defineExpose({ setCamera, getShapeCount, setTickerMaxFPS, setBackgroundVisible });

const canvasEl = ref<HTMLCanvasElement | null>(null);
const containerEl = ref<HTMLDivElement | null>(null);

let app: Application | null = null;
let renderer: PixiRenderer | null = null;

// Pan state
let spaceHeld = false;
let m3Panning = false;
let m3PanStart = { x: 0, y: 0 };
let m3PanOrigin = { x: 0, y: 0 };

// Lasso state
let lassoGfx: Graphics | null = null;
let isLasso = false;
let lassoStartWorld = { x: 0, y: 0 };
let lassoCurrentWorld = { x: 0, y: 0 };

// Space+drag pan state
let spacePanning = false;
let spacePanStart = { x: 0, y: 0 };
let spacePanOrigin = { x: 0, y: 0 };

function screenToWorld(sx: number, sy: number) {
  if (!app) return { x: 0, y: 0 };
  const z = app.stage.scale.x;
  return {
    x: (sx - app.stage.position.x) / z,
    y: (sy - app.stage.position.y) / z,
  };
}

onMounted(async () => {
  if (!canvasEl.value || !containerEl.value) return;

  app = new Application();
  await app.init({
    canvas: canvasEl.value,
    width: containerEl.value.clientWidth,
    height: containerEl.value.clientHeight,
    antialias: true,
    backgroundAlpha: 0,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const pixiEmit = (event: string, ...args: unknown[]) => {
    if (event === 'dragEnd') {
      const [plantId, pos] = args as [string, { x: number; y: number }];
      emit('dragEnd', plantId, pos);
    } else if (event === 'select') {
      emit('select', args[0] as string);
    }
  };

  renderer = new PixiRenderer(app, pixiEmit);
  await renderer.init();
  renderer.syncPlants(props.plants);
  renderer.syncBeds(props.beds);
  await renderer.setBackground();

  app.ticker.maxFPS = 60;

  // Lasso graphics layer — drawn above everything else
  lassoGfx = new Graphics();
  app.stage.addChild(lassoGfx);

  // Transparent background quad for lasso/deselect clicks.
  // Must be in world space (child of stage) so it's below plants in z-order.
  // The stage hitArea approach breaks after stage.scale changes because hitArea
  // is tested in local (world) space, not screen space.
  const bgGfx = new Graphics();
  bgGfx.rect(-50000, -50000, 100000, 100000).fill({ color: 0x000000, alpha: 0 });
  bgGfx.eventMode = 'static';
  app.stage.addChildAt(bgGfx, 0); // index 0 = below renderer layers
  bgGfx.on('pointerdown', onStagePointerDown);

  // Stage receives pointermove/pointerup globally for lasso draw and space-pan.
  // No hitArea needed — children's events bubble up.
  app.stage.eventMode = 'static';
  app.stage.on('pointermove', onStagePointerMove);
  app.stage.on('pointerup', onStagePointerUp);
  app.stage.on('pointerupoutside', onStagePointerUp);

  app.stage.scale.set(0.3);
  app.stage.position.set(-20, -20);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvasEl.value?.addEventListener('pointerdown', onCanvasPointerDown);

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const appStart = (window as unknown as { __APP_START__?: number }).__APP_START__;
      emit('ready', performance.now() - (appStart ?? 0));
    }),
  );
});

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onM3PanMove);
  window.removeEventListener('pointerup', onM3PanEnd);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  canvasEl.value?.removeEventListener('pointerdown', onCanvasPointerDown);
  app?.destroy(true);
  app = null;
  renderer = null;
});

// ------- Exposed API -------
function setCamera({ x, y, z }: { x: number; y: number; z: number }): void {
  if (!app) return;
  app.stage.scale.set(z);
  app.stage.position.set(x, y);
}

function getShapeCount(): number {
  return renderer?.getShapeCount() ?? 0;
}

function setTickerMaxFPS(fps: number): void {
  if (app) app.ticker.maxFPS = fps;
}

function setBackgroundVisible(visible: boolean): void {
  renderer?.setBackgroundVisible(visible);
}

// ------- Space key -------
function onKeyDown(e: KeyboardEvent): void {
  if (e.code === 'Space' && !e.repeat) {
    spaceHeld = true;
    if (canvasEl.value) canvasEl.value.style.cursor = 'grab';
    e.preventDefault();
  }
  if (e.code === 'Escape') {
    emit('select', null);
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.code === 'Space') {
    spaceHeld = false;
    if (canvasEl.value) canvasEl.value.style.cursor = '';
  }
}

// ------- M3 pan -------
function onCanvasPointerDown(e: PointerEvent): void {
  if (e.button !== 1) return;
  e.preventDefault();
  m3Panning = true;
  m3PanStart = { x: e.clientX, y: e.clientY };
  m3PanOrigin = { x: app!.stage.position.x, y: app!.stage.position.y };
  if (canvasEl.value) canvasEl.value.style.cursor = 'grabbing';
  window.addEventListener('pointermove', onM3PanMove);
  window.addEventListener('pointerup', onM3PanEnd);
}

function onM3PanMove(e: PointerEvent): void {
  if (!m3Panning || !app) return;
  const s = props.panSensitivity ?? 1.0;
  app.stage.position.set(
    m3PanOrigin.x + (e.clientX - m3PanStart.x) * s,
    m3PanOrigin.y + (e.clientY - m3PanStart.y) * s,
  );
}

function onM3PanEnd(e: PointerEvent): void {
  if (e.button !== 1) return;
  m3Panning = false;
  if (canvasEl.value) canvasEl.value.style.cursor = spaceHeld ? 'grab' : '';
  window.removeEventListener('pointermove', onM3PanMove);
  window.removeEventListener('pointerup', onM3PanEnd);
}

// ------- Zoom -------
function onWheel(e: WheelEvent): void {
  e.preventDefault();
  if (!app) return;
  const z = props.zoomSensitivity ?? 1.0;
  const oldZ = app.stage.scale.x;
  const delta = e.ctrlKey
    ? e.deltaY * 0.01  // trackpad pinch — coarser
    : (e.deltaY !== 0 ? e.deltaY : -e.deltaX) * 0.001;
  const newZ = Math.max(0.05, Math.min(10, oldZ * (1 - delta * z)));
  app.stage.position.x = e.offsetX + (app.stage.position.x - e.offsetX) * (newZ / oldZ);
  app.stage.position.y = e.offsetY + (app.stage.position.y - e.offsetY) * (newZ / oldZ);
  app.stage.scale.set(newZ);
}

// ------- Stage pointer: lasso or space-pan -------
function onStagePointerDown(e: any): void {
  if (!app) return;
  if (e.button === 1) return; // M3 handled separately

  if (spaceHeld) {
    // Space + drag = pan
    spacePanning = true;
    spacePanStart = { x: e.global.x, y: e.global.y };
    spacePanOrigin = { x: app.stage.position.x, y: app.stage.position.y };
    if (canvasEl.value) canvasEl.value.style.cursor = 'grabbing';
    return;
  }

  // Deselect on background click (plant pointerdown stops propagation)
  emit('select', null);

  // Start lasso
  isLasso = true;
  lassoStartWorld = screenToWorld(e.global.x, e.global.y);
  lassoCurrentWorld = { ...lassoStartWorld };
}

function onStagePointerMove(e: any): void {
  if (!app) return;

  if (spacePanning) {
    const s = props.panSensitivity ?? 1.0;
    app.stage.position.set(
      spacePanOrigin.x + (e.global.x - spacePanStart.x) * s,
      spacePanOrigin.y + (e.global.y - spacePanStart.y) * s,
    );
    return;
  }

  if (isLasso && lassoGfx) {
    lassoCurrentWorld = screenToWorld(e.global.x, e.global.y);
    const lx = Math.min(lassoStartWorld.x, lassoCurrentWorld.x);
    const ly = Math.min(lassoStartWorld.y, lassoCurrentWorld.y);
    const lw = Math.abs(lassoCurrentWorld.x - lassoStartWorld.x);
    const lh = Math.abs(lassoCurrentWorld.y - lassoStartWorld.y);
    lassoGfx.clear();
    if (lw > DRAG_THRESHOLD_PX || lh > DRAG_THRESHOLD_PX) {
      lassoGfx.rect(lx, ly, lw, lh);
      lassoGfx.fill({ color: 0x0070e0, alpha: 0.1 });
      lassoGfx.rect(lx, ly, lw, lh);
      lassoGfx.stroke({ color: 0x0070e0, width: 1 / (app.stage.scale.x) });
    }
  }
}

function onStagePointerUp(): void {
  spacePanning = false;
  if (canvasEl.value && !spaceHeld) canvasEl.value.style.cursor = '';

  if (isLasso) {
    isLasso = false;
    lassoGfx?.clear();
    const lx = Math.min(lassoStartWorld.x, lassoCurrentWorld.x);
    const rx = Math.max(lassoStartWorld.x, lassoCurrentWorld.x);
    const ly = Math.min(lassoStartWorld.y, lassoCurrentWorld.y);
    const ry = Math.max(lassoStartWorld.y, lassoCurrentWorld.y);
    const moved = (rx - lx) > DRAG_THRESHOLD_PX || (ry - ly) > DRAG_THRESHOLD_PX;
    if (moved) {
      // Pass lasso bounds to renderer — it emits select for each plant inside
      renderer?.selectByLasso(lx, ly, rx, ry);
    }
  }
}

// ------- Reactive prop watches -------
watch(
  () => props.plants,
  (plants) => renderer?.syncPlants(plants),
  { deep: false },
);

watch(
  () => props.beds,
  (beds) => renderer?.syncBeds(beds),
  { deep: false },
);

watch(
  () => props.selectedId,
  (id) => renderer?.setSelected(id ?? null),
);
</script>

<template>
  <div ref="containerEl" style="width: 100%; height: 100%; position: relative">
    <canvas ref="canvasEl" style="width: 100%; height: 100%" @wheel.prevent="onWheel" />
  </div>
</template>
