<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useDocStore } from '@/stores/docStore';
import { useSelectionStore } from '@/stores/selectionStore';
// SvgCanvas is not yet built — typed as any to avoid TS errors
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import SvgCanvas from '@/canvas/SvgCanvas.vue';
import SelfTestPanel from '@/components/SelfTestPanel.vue';

const APP_START = performance.now();

const docStore = useDocStore();
const selectionStore = useSelectionStore();

const svgCanvas = ref<InstanceType<typeof SvgCanvas> | null>(null);
const ttiMs = ref<number | null>(null);
const panMode = ref<'container' | 'per-shape'>('container');
let mutationCount = 0;

// Live debug stats
const fps = ref(0);
const frameMs = ref(0);
const heapMB = ref<number | null>(null);
const domNodes = ref(0);
const pointerState = ref('idle');

let rafId = 0;
let lastFrameTime = performance.now();
let frameCount = 0;
let lastFpsUpdate = performance.now();

function debugLoop(): void {
  const now = performance.now();
  frameMs.value = Math.round(now - lastFrameTime);
  lastFrameTime = now;
  frameCount++;

  if (now - lastFpsUpdate >= 500) {
    fps.value = Math.round(frameCount * 1000 / (now - lastFpsUpdate));
    frameCount = 0;
    lastFpsUpdate = now;
    domNodes.value = document.querySelectorAll('*').length;
    const mem = (performance as any).memory;
    if (mem) heapMB.value = Math.round(mem.usedJSHeapSize / 1024 / 1024 * 10) / 10;
  }

  rafId = requestAnimationFrame(debugLoop);
}

function trackPointer(e: PointerEvent): void {
  if (e.type === 'pointerdown') pointerState.value = e.isPrimary ? 'down' : 'multi';
  else if (e.type === 'pointermove' && e.buttons > 0) pointerState.value = 'drag';
  else if (e.type === 'pointerup') pointerState.value = 'idle';
}

docStore.$subscribe(() => { mutationCount++; });

function handleDragEnd(plantId: string, pos: { x: number; y: number }): void {
  docStore.updatePlantPosition(plantId, pos);
}

function handleSelect(plantId: string): void {
  selectionStore.selectPlant(plantId);
}

function handleReady(canvasTtiMs: number): void {
  // Use the App-level start time for a more accurate TTI (includes Vue mount overhead)
  ttiMs.value = Math.round(performance.now() - APP_START);
  void canvasTtiMs; // canvas provides its own measure; we use the app-level one
}

function handleKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    docStore.undo();
  }
}

onMounted(() => {
  rafId = requestAnimationFrame(debugLoop);
  window.addEventListener('pointerdown', trackPointer);
  window.addEventListener('pointermove', trackPointer);
  window.addEventListener('pointerup', trackPointer);
  window.addEventListener('keydown', handleKeydown);

  // __flora_editor__ shim — must match two-arg signature used by runBenchmarkScenario
  (window as any).__flora_editor__ = {
    setCamera: (cam: { x: number; y: number; z: number }, _opts?: unknown) => {
      svgCanvas.value?.setCamera(cam);
    },
  };

  (window as any).__flora__ = {
    getPlantCount: () => docStore.plants.size,
    getShapeCount: () => docStore.plants.size + docStore.beds.size + 1,
    getPlantIds: () => [...docStore.plants.keys()],
    getPlantPosition: (id: string) => docStore.plants.get(id)?.position ?? null,
    programmaticDrag: (id: string, dxInches: number, dyInches: number): boolean => {
      const plant = docStore.plants.get(id);
      if (!plant) return false;
      docStore.updatePlantPosition(id, {
        x: plant.position.x + dxInches,
        y: plant.position.y + dyInches,
      });
      return true;
    },
    getMutationCount: () => mutationCount,
    resetMutationCount: () => { mutationCount = 0; },
    undo: () => docStore.undo(),
    setPlantCount: (n: number) => docStore.setPlantCount(n),
    setRenderMode: (_mode: unknown) => {},  // no-op stub
    getRenderMode: () => 'svg',
    setBackground: (_bgId: unknown) => {},  // no-op
    setBgSize: (_px: unknown) => {},         // no-op
    setPanMode: (mode: 'container' | 'per-shape') => { panMode.value = mode; },
    getPanMode: () => panMode.value,
    // Drives the canvas for `durationMs` ms with the given movement pattern.
    // Returns a Promise<number[]> of per-frame ms timings.
    runBenchmarkScenario: (config: {
      durationMs: number;
      movementType: 'pan' | 'zoom' | 'still';
      zoomLevel: number;
    }): Promise<number[]> => {
      return new Promise((resolve) => {
        const editor = (window as any).__flora_editor__;
        if (!editor) { resolve([]); return; }

        // World dimensions: 120 × 180 inches × 96 px/inch
        const WORLD_W = 120 * 96;
        const WORLD_H = 180 * 96;

        // Set initial camera for this scenario
        editor.setCamera({ x: -20, y: -20, z: config.zoomLevel });

        const frameTimes: number[] = [];
        const startMs = performance.now();
        let lastFrame = startMs;
        let rafId = 0;

        const panAmpX = WORLD_W * 0.6; // sweep 60% of drawing width
        const panAmpY = WORLD_H * 0.3;
        const panPeriod = 3000; // ms per full oscillation

        function tick() {
          const now = performance.now();
          const elapsed = now - startMs;
          frameTimes.push(now - lastFrame);
          lastFrame = now;

          if (elapsed >= config.durationMs) {
            resolve(frameTimes.slice(1)); // drop first (setup) frame
            return;
          }

          if (config.movementType === 'pan') {
            const t = elapsed / panPeriod;
            const cx = -20 - panAmpX * 0.5 * (1 - Math.cos(2 * Math.PI * t));
            const cy = -20 - panAmpY * 0.5 * (1 - Math.cos(2 * Math.PI * t * 0.7));
            editor.setCamera({ x: cx, y: cy, z: config.zoomLevel }, { immediate: true });
          } else if (config.movementType === 'zoom') {
            const t = elapsed / panPeriod;
            // Oscillate zoom between 0.05 and 2.0
            const z = 0.05 + 1.975 * 0.5 * (1 - Math.cos(2 * Math.PI * t));
            editor.setCamera({ x: -20, y: -20, z }, { immediate: true });
          }
          // 'still' does nothing, just measures idle FPS

          rafId = requestAnimationFrame(tick);
        }

        rafId = requestAnimationFrame(tick);
        // Suppress unused-var warning in closure
        void rafId;
      });
    },
  };
});

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  window.removeEventListener('pointerdown', trackPointer);
  window.removeEventListener('pointermove', trackPointer);
  window.removeEventListener('pointerup', trackPointer);
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div role="main" style="position: relative; width: 100vw; height: 100vh;">
    <SvgCanvas
      ref="svgCanvas"
      :plants="[...docStore.plants.values()]"
      :beds="[...docStore.beds.values()]"
      :selected-id="selectionStore.selectedPlantId"
      :pan-mode="panMode"
      @drag-end="handleDragEnd"
      @select="handleSelect"
      @ready="handleReady"
    />
    <SelfTestPanel :tti-ms="ttiMs" :get-shape-count="() => docStore.plants.size + docStore.beds.size + 1" />

    <!-- Live debug overlay -->
    <aside
      aria-label="Debug stats"
      style="
        position: absolute; top: 12px; left: 12px;
        background: rgba(0,0,0,0.75); color: #0f0; border: 1px solid #0f04;
        padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 11px;
        pointer-events: none; line-height: 1.7;
      "
    >
      <div><span style="color:#888">FPS</span>      {{ fps }} <span style="color:#555">fps</span></div>
      <div><span style="color:#888">frame</span>    {{ frameMs }} <span style="color:#555">ms</span></div>
      <div v-if="heapMB !== null"><span style="color:#888">heap</span>     {{ heapMB }} <span style="color:#555">MB</span></div>
      <div><span style="color:#888">DOM</span>      {{ domNodes }} <span style="color:#555">nodes</span></div>
      <div><span style="color:#888">pointer</span>  <span :style="{ color: pointerState === 'drag' ? '#ff0' : pointerState === 'down' ? '#fa0' : '#0f0' }">{{ pointerState }}</span></div>
    </aside>

    <!-- Stats HUD -->
    <aside
      role="complementary"
      aria-label="Canvas stats"
      style="
        position: absolute; bottom: 12px; left: 12px;
        background: rgba(0,0,0,0.6); color: #fff;
        padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 12px;
        pointer-events: none;
      "
    >
      <div data-testid="stat-plants">Plants: {{ docStore.plants.size }}</div>
      <div data-testid="stat-selected">Selected: {{ selectionStore.selectedPlantId ?? 'none' }}</div>
      <div data-testid="stat-undo-stack">Undo stack: {{ docStore.undoStack.length }}/10</div>
      <div style="margin-top: 6px; color: #aaa; font-size: 11px;">pan mode: {{ panMode }}</div>
    </aside>
  </div>
</template>
