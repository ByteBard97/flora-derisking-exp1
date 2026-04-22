<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { Application, Assets } from 'pixi.js';
import { PixiRenderer } from './PixiRenderer';
import type { Plant, Bed } from '@/stores/docStore';

const props = defineProps<{
  plants: Plant[];
  beds: Bed[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  dragEnd: [plantId: string, pos: { x: number; y: number }];
  select: [plantId: string];
  ready: [ttiMs: number];
}>();

defineExpose({ setCamera, getShapeCount });

// ------- DOM refs -------
const canvasEl = ref<HTMLCanvasElement | null>(null);
const containerEl = ref<HTMLDivElement | null>(null);

// ------- Pixi state (not reactive) -------
let app: Application | null = null;
let renderer: PixiRenderer | null = null;

// ------- Pan state -------
let panning = false;
let panStart = { x: 0, y: 0 };
let panOrigin = { x: 0, y: 0 };

// ------- Lifecycle -------
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

  // Load MSDF font atlas (registered under the face name in the .fnt descriptor)
  await Assets.load('/fonts/plant-label.fnt');

  // Pixi-level emitter shim — lets PixiRenderer fire Vue emits
  const pixiEmit = (event: string, ...args: unknown[]) => {
    if (event === 'dragEnd') {
      const [plantId, pos] = args as [string, { x: number; y: number }];
      emit('dragEnd', plantId, pos);
    } else if (event === 'select') {
      emit('select', args[0] as string);
    }
  };

  renderer = new PixiRenderer(app, pixiEmit);
  renderer.syncPlants(props.plants);
  renderer.syncBeds(props.beds);
  renderer.setBackground();

  // Enable stage-level pointer events for background pan.
  // Plant containers use e.stopPropagation() so their clicks don't bubble here.
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;

  app.stage.on('pointerdown', onStagePanStart);

  // Initial camera — matches experiment-2 default: x=-20, y=-20, z=0.3
  // tldraw convention: screenX = worldX * z + camX, so stage.position = (camX, camY)
  app.stage.scale.set(0.3);
  app.stage.position.set(-20, -20);

  // TTI — two rAF ticks to ensure first paint has completed
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const appStart = (window as unknown as { __APP_START__?: number }).__APP_START__;
      emit('ready', performance.now() - (appStart ?? 0));
    }),
  );
});

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onWindowPanMove);
  window.removeEventListener('pointerup', onWindowPanEnd);
  app?.destroy(true);
  app = null;
  renderer = null;
});

// ------- Exposed API -------
function setCamera({ x, y, z }: { x: number; y: number; z: number }): void {
  if (!app) return;
  app.stage.scale.set(z);
  // tldraw convention: screenX = worldX * z + camX — stage.position maps directly to camX/Y
  app.stage.position.set(x, y);
}

function getShapeCount(): number {
  return renderer?.getShapeCount() ?? 0;
}

// ------- Wheel zoom (pivot on cursor) -------
function onWheel(e: WheelEvent): void {
  e.preventDefault();
  if (!app) return;
  const oldZ = app.stage.scale.x;
  const newZ = Math.max(0.05, Math.min(5, oldZ * (1 - e.deltaY * 0.001)));
  app.stage.position.x = e.offsetX + (app.stage.position.x - e.offsetX) * (newZ / oldZ);
  app.stage.position.y = e.offsetY + (app.stage.position.y - e.offsetY) * (newZ / oldZ);
  app.stage.scale.set(newZ);
}

// ------- Background pan (stage-level, so plant stopPropagation works) -------
function onStagePanStart(e: { clientX: number; clientY: number }): void {
  if (!app) return;
  panning = true;
  panStart = { x: e.clientX, y: e.clientY };
  panOrigin = { x: app.stage.position.x, y: app.stage.position.y };
  window.addEventListener('pointermove', onWindowPanMove);
  window.addEventListener('pointerup', onWindowPanEnd);
}

function onWindowPanMove(e: PointerEvent): void {
  if (!panning || !app) return;
  const dx = e.clientX - panStart.x;
  const dy = e.clientY - panStart.y;
  app.stage.position.set(panOrigin.x + dx, panOrigin.y + dy);
}

function onWindowPanEnd(): void {
  panning = false;
  window.removeEventListener('pointermove', onWindowPanMove);
  window.removeEventListener('pointerup', onWindowPanEnd);
}

// ------- Reactive prop watches -------
// Uses shallow watch (deep: false) — caller must pass a new array reference
// when plants change (e.g. computed(() => Array.from(store.plants.values()))).
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
