<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { Application, Graphics } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { PixiRenderer } from './PixiRenderer';
import type { Plant, Bed } from '@/stores/docStore';

const DRAG_THRESHOLD_PX = 4;

const props = defineProps<{
  plants: Plant[];
  beds: Bed[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  dragEnd: [plantId: string, pos: { x: number; y: number }];
  select: [plantId: string | null];
  ready: [ttiMs: number];
  zoom: [scale: number];
}>();

defineExpose({ setCamera, getShapeCount, setTickerMaxFPS, setBackgroundVisible });

const canvasEl = ref<HTMLCanvasElement | null>(null);
const containerEl = ref<HTMLDivElement | null>(null);

let app: Application | null = null;
let viewport: Viewport | null = null;
let renderer: PixiRenderer | null = null;

// Lasso state
let lassoGfx: Graphics | null = null;
let isLasso = false;
let lassoStartWorld = { x: 0, y: 0 };
let lassoCurrentWorld = { x: 0, y: 0 };

function screenToWorld(sx: number, sy: number) {
  if (!viewport) return { x: 0, y: 0 };
  return viewport.toWorld(sx, sy);
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

  const W = containerEl.value.clientWidth;
  const H = containerEl.value.clientHeight;

  viewport = new Viewport({
    screenWidth: W,
    screenHeight: H,
    worldWidth: 120 * 96,
    worldHeight: 180 * 96,
    events: app.renderer.events,
  });

  viewport
    .drag()
    .wheel({ smooth: 8 })
    .decelerate({ friction: 0.93 })
    .clampZoom({ minScale: 0.05, maxScale: 10 })
    .pinch();

  app.stage.addChild(viewport);
  app.stage.eventMode = 'static';
  viewport.on('zoomed', () => {
    renderer?.updateLOD(viewport.scale.x);
    emit('zoom', viewport.scale.x);
  });

  // Transparent background quad — intercepts background clicks for lasso/deselect.
  // Pauses viewport drag so lasso and pan don't conflict.
  const bgGfx = new Graphics();
  bgGfx.rect(-50000, -50000, 100000, 100000).fill({ color: 0x000000, alpha: 0 });
  bgGfx.eventMode = 'static';
  viewport.addChildAt(bgGfx, 0);
  bgGfx.on('pointerdown', onBgPointerDown);

  lassoGfx = new Graphics();
  viewport.addChild(lassoGfx);

  app.stage.on('pointermove', onStagePointerMove);
  app.stage.on('pointerup', onStagePointerUp);
  app.stage.on('pointerupoutside', onStagePointerUp);

  const pixiEmit = (event: string, ...args: unknown[]) => {
    if (event === 'dragEnd') {
      const [plantId, pos] = args as [string, { x: number; y: number }];
      emit('dragEnd', plantId, pos);
    } else if (event === 'select') {
      emit('select', args[0] as string);
    }
  };

  renderer = new PixiRenderer(viewport, pixiEmit);
  await renderer.init();
  renderer.syncPlants(props.plants);
  renderer.syncBeds(props.beds);
  await renderer.setBackground();

  app.ticker.maxFPS = 60;

  // Initial camera: zoom to show full page
  viewport.setZoom(0.3, true);
  viewport.moveCorner(0, 0);

  window.addEventListener('keydown', onKeyDown);

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const appStart = (window as unknown as { __APP_START__?: number }).__APP_START__;
      emit('ready', performance.now() - (appStart ?? 0));
    }),
  );
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  app?.destroy(true);
  app = null;
  viewport = null;
  renderer = null;
});

// ------- Exposed API -------
function setCamera({ x, y, z }: { x: number; y: number; z: number }): void {
  if (!viewport) return;
  viewport.setZoom(z, true);
  viewport.moveCorner(-x / z, -y / z);
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

// ------- Keys -------
function onKeyDown(e: KeyboardEvent): void {
  if (e.code === 'Escape') emit('select', null);
  if (e.code === 'Space') e.preventDefault();
}

// ------- Background click / lasso -------
function onBgPointerDown(e: any): void {
  if (!viewport) return;
  viewport.plugins.pause('drag');
  emit('select', null);
  isLasso = true;
  lassoStartWorld = screenToWorld(e.global.x, e.global.y);
  lassoCurrentWorld = { ...lassoStartWorld };
}

function onStagePointerMove(e: any): void {
  if (!isLasso || !lassoGfx || !viewport) return;
  lassoCurrentWorld = screenToWorld(e.global.x, e.global.y);
  const lx = Math.min(lassoStartWorld.x, lassoCurrentWorld.x);
  const ly = Math.min(lassoStartWorld.y, lassoCurrentWorld.y);
  const lw = Math.abs(lassoCurrentWorld.x - lassoStartWorld.x);
  const lh = Math.abs(lassoCurrentWorld.y - lassoStartWorld.y);
  lassoGfx.clear();
  if (lw > DRAG_THRESHOLD_PX || lh > DRAG_THRESHOLD_PX) {
    lassoGfx.rect(lx, ly, lw, lh).fill({ color: 0x0070e0, alpha: 0.1 });
    lassoGfx.rect(lx, ly, lw, lh).stroke({ color: 0x0070e0, width: 1 / viewport.scale.x });
  }
}

function onStagePointerUp(): void {
  if (!isLasso) return;
  viewport?.plugins.resume('drag');
  isLasso = false;
  lassoGfx?.clear();
  const lx = Math.min(lassoStartWorld.x, lassoCurrentWorld.x);
  const rx = Math.max(lassoStartWorld.x, lassoCurrentWorld.x);
  const ly = Math.min(lassoStartWorld.y, lassoCurrentWorld.y);
  const ry = Math.max(lassoStartWorld.y, lassoCurrentWorld.y);
  if ((rx - lx) > DRAG_THRESHOLD_PX || (ry - ly) > DRAG_THRESHOLD_PX) {
    renderer?.selectByLasso(lx, ly, rx, ry);
  }
}

// ------- Reactive prop watches -------
watch(() => props.plants, (plants) => renderer?.syncPlants(plants), { deep: false });
watch(() => props.beds, (beds) => renderer?.syncBeds(beds), { deep: false });
watch(() => props.selectedId, (id) => renderer?.setSelected(id ?? null));
</script>

<template>
  <div ref="containerEl" style="width: 100%; height: 100%; position: relative">
    <canvas ref="canvasEl" style="width: 100%; height: 100%" />
  </div>
</template>
