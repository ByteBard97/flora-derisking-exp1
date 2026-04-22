<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useDocStore } from '@/stores/docStore';
import { useSelectionStore } from '@/stores/selectionStore';
import SvgCanvas from '@/canvas/svg/SvgCanvas.vue';
import PixiCanvas from '@/canvas/pixi/PixiCanvas.vue';
import SelfTestPanel from '@/components/SelfTestPanel.vue';
import FrameGraph from '@/components/FrameGraph.vue';

(window as any).__APP_START__ = performance.now();

const docStore = useDocStore();
const selectionStore = useSelectionStore();

const currentRenderer = ref<'raw-svg' | 'pixi'>('pixi');
const panMode = ref<'container' | 'per-shape'>('container');
const panSensitivity = ref(1.0);
const zoomSensitivity = ref(1.0);
const showBackground = ref(true);

const svgCanvas = ref<InstanceType<typeof SvgCanvas> | null>(null);
const pixiCanvas = ref<InstanceType<typeof PixiCanvas> | null>(null);
const ttiMs = ref<number | null>(null);
let mutationCount = 0;

// ── Debug stats ───────────────────────────────────────────────────────────────
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

// ── Plant / bed arrays (stable references for v-if remount) ───────────────────
const plantsArray = computed(() => [...docStore.plants.values()]);
const bedsArray = computed(() => [...docStore.beds.values()]);

// ── Event handlers ────────────────────────────────────────────────────────────
function handleDragEnd(plantId: string, pos: { x: number; y: number }): void {
  docStore.updatePlantPosition(plantId, pos);
}

function handleSelect(plantId: string | null): void {
  if (plantId) selectionStore.selectPlant(plantId);
  else selectionStore.clearSelection();
}

function handleReady(ms: number): void {
  ttiMs.value = ms;
}

function handleKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    docStore.undo();
  }
}

// ── Shape count ───────────────────────────────────────────────────────────────
function getShapeCount(): number {
  if (currentRenderer.value === 'raw-svg') {
    return (svgCanvas.value as any)?.getShapeCount?.() ?? docStore.plants.size + docStore.beds.size + 1;
  }
  return pixiCanvas.value?.getShapeCount?.() ?? 0;
}

// ── Editor shim ───────────────────────────────────────────────────────────────
function updateEditorShim(): void {
  (window as any).__flora_editor__ = {
    __rendererName: currentRenderer.value,
    setCamera: (cam: { x: number; y: number; z: number }, _opts?: unknown) => {
      if (currentRenderer.value === 'raw-svg') svgCanvas.value?.setCamera(cam);
      else pixiCanvas.value?.setCamera(cam);
    },
  };
}

// ── Renderer switching ────────────────────────────────────────────────────────
function switchRenderer(name: 'raw-svg' | 'pixi'): void {
  ttiMs.value = null;
  currentRenderer.value = name;
}

// After renderer changes, wait for DOM to settle then refresh the shim
watch(currentRenderer, async () => {
  await nextTick();
  updateEditorShim();
});

// ── window.__flora__ ─────────────────────────────────────────────────────────
onMounted(() => {
  rafId = requestAnimationFrame(debugLoop);
  window.addEventListener('pointerdown', trackPointer);
  window.addEventListener('pointermove', trackPointer);
  window.addEventListener('pointerup', trackPointer);
  window.addEventListener('keydown', handleKeydown);

  // Shim must be in place before __flora__ so benchmark waitForReady works
  updateEditorShim();

  (window as any).__flora__ = {
    // ── Renderer routing ──────────────────────────────────────────────────
    setRenderer: async (name: 'raw-svg' | 'pixi') => {
      currentRenderer.value = name;
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if ((window as any).__flora_editor__?.__rendererName === name) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
        setTimeout(() => { clearInterval(interval); resolve(); }, 10000);
      });
    },
    getRenderer: () => currentRenderer.value,

    // ── Pan mode (raw-svg only) ───────────────────────────────────────────
    setPanMode: (mode: 'container' | 'per-shape') => { panMode.value = mode; },
    getPanMode: () => panMode.value,

    // ── Plant state ───────────────────────────────────────────────────────
    getPlantCount: () => docStore.plants.size,
    getShapeCount,
    getPlantIds: () => [...docStore.plants.keys()],
    getPlantPosition: (id: string) => docStore.plants.get(id)?.position ?? null,
    setPlantCount: (n: number) => docStore.setPlantCount(n),

    // ── Interactions ──────────────────────────────────────────────────────
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

    // ── Stubs (benchmark calls these unconditionally) ─────────────────────
    setRenderMode: (_: string) => {},
    getRenderMode: () => currentRenderer.value,
    setBackground: (_: string) => {},
    setBgSize: (_: number) => {},

    // ── Benchmark scenario runner ─────────────────────────────────────────
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
        let scenarioRafId = 0;

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

          scenarioRafId = requestAnimationFrame(tick);
        }

        scenarioRafId = requestAnimationFrame(tick);
        // Suppress unused-var warning in closure
        void scenarioRafId;
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

    <!-- ── Renderer selector bar ────────────────────────────────────────────── -->
    <div style="
      position: absolute; top: 0; left: 50%; transform: translateX(-50%);
      z-index: 100; display: flex; align-items: center; gap: 4px;
      background: rgba(0,0,0,0.80); border: 1px solid #333;
      padding: 6px 12px; border-radius: 0 0 8px 8px;
      font-family: monospace; font-size: 12px;
    ">
      <button
        @click="switchRenderer('raw-svg')"
        :style="{
          background: currentRenderer === 'raw-svg' ? '#1a4a1a' : '#111',
          color: currentRenderer === 'raw-svg' ? '#6dbf6d' : '#666',
          border: `1px solid ${currentRenderer === 'raw-svg' ? '#3a6a3a' : '#333'}`,
          padding: '5px 12px', cursor: 'pointer', borderRadius: '4px',
          fontFamily: 'monospace', fontSize: '12px',
        }"
      >Raw SVG</button>

      <button
        @click="switchRenderer('pixi')"
        :style="{
          background: currentRenderer === 'pixi' ? '#1a3a5a' : '#111',
          color: currentRenderer === 'pixi' ? '#6aabcf' : '#666',
          border: `1px solid ${currentRenderer === 'pixi' ? '#2a5a8a' : '#333'}`,
          padding: '5px 12px', cursor: 'pointer', borderRadius: '4px',
          fontFamily: 'monospace', fontSize: '12px',
        }"
      >Pixi.js v8</button>

      <!-- Pan mode selector — raw-svg only -->
      <span v-if="currentRenderer === 'raw-svg'" style="margin-left: 16px; color: #555;">
        Pan:
      </span>
      <template v-if="currentRenderer === 'raw-svg'">
        <button
          @click="panMode = 'container'"
          :style="{
            background: panMode === 'container' ? '#2a2a0a' : '#111',
            color: panMode === 'container' ? '#cfcf6a' : '#555',
            border: `1px solid ${panMode === 'container' ? '#5a5a1a' : '#333'}`,
            padding: '4px 10px', cursor: 'pointer', borderRadius: '4px',
            fontFamily: 'monospace', fontSize: '11px',
          }"
        >container</button>
        <button
          @click="panMode = 'per-shape'"
          :style="{
            background: panMode === 'per-shape' ? '#2a2a0a' : '#111',
            color: panMode === 'per-shape' ? '#cfcf6a' : '#555',
            border: `1px solid ${panMode === 'per-shape' ? '#5a5a1a' : '#333'}`,
            padding: '4px 10px', cursor: 'pointer', borderRadius: '4px',
            fontFamily: 'monospace', fontSize: '11px',
          }"
        >per-shape</button>
      </template>

      <!-- Sensitivity sliders — Pixi only -->
      <template v-if="currentRenderer === 'pixi'">
        <span style="margin-left: 16px; color: #555;">Pan:</span>
        <input type="range" min="0.2" max="3" step="0.1" v-model.number="panSensitivity"
          style="width: 70px; accent-color: #6aabcf;" />
        <span style="color: #6aabcf; min-width: 24px;">{{ panSensitivity.toFixed(1) }}×</span>

        <span style="margin-left: 8px; color: #555;">Zoom:</span>
        <input type="range" min="0.2" max="3" step="0.1" v-model.number="zoomSensitivity"
          style="width: 70px; accent-color: #6aabcf;" />
        <span style="color: #6aabcf; min-width: 24px;">{{ zoomSensitivity.toFixed(1) }}×</span>

        <button
          style="margin-left: 16px; background: #1a2a3a; color: #6aabcf; border: 1px solid #2a5a8a; border-radius: 3px; padding: 3px 10px; cursor: pointer; font-size: 12px;"
          @click="showBackground = !showBackground; pixiCanvas?.setBackgroundVisible(showBackground)"
        >{{ showBackground ? 'Hide BG' : 'Show BG' }}</button>
      </template>
    </div>

    <!-- ── Raw SVG canvas ────────────────────────────────────────────────────── -->
    <SvgCanvas
      v-if="currentRenderer === 'raw-svg'"
      ref="svgCanvas"
      :plants="plantsArray"
      :beds="bedsArray"
      :selected-id="selectionStore.selectedPlantId"
      :pan-mode="panMode"
      @drag-end="handleDragEnd"
      @select="handleSelect"
      @ready="handleReady"
      style="position: absolute; inset: 0;"
    />

    <!-- ── Pixi canvas ────────────────────────────────────────────────────────── -->
    <PixiCanvas
      v-else-if="currentRenderer === 'pixi'"
      ref="pixiCanvas"
      :plants="plantsArray"
      :beds="bedsArray"
      :selected-id="selectionStore.selectedPlantId"
      :pan-sensitivity="panSensitivity"
      :zoom-sensitivity="zoomSensitivity"
      @drag-end="handleDragEnd"
      @select="handleSelect"
      @ready="handleReady"
      style="position: absolute; inset: 0;"
    />

    <!-- ── Self-test panel ────────────────────────────────────────────────────── -->
    <SelfTestPanel :tti-ms="ttiMs" :get-shape-count="getShapeCount" />

    <!-- ── Debug HUD ──────────────────────────────────────────────────────────── -->
    <aside
      aria-label="Debug stats"
      style="
        position: absolute; top: 48px; left: 12px;
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
      <div><span style="color:#888">renderer</span> <span style="color:#6aabcf">{{ currentRenderer }}</span></div>
      <FrameGraph :frame-ms="frameMs" style="margin-top: 6px; pointer-events: none;" />
    </aside>

    <!-- ── Stats HUD ──────────────────────────────────────────────────────────── -->
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
      <div style="margin-top: 6px; color: #aaa; font-size: 11px;">
        renderer: {{ currentRenderer }}{{ currentRenderer === 'raw-svg' ? ` / ${panMode}` : '' }}
      </div>
    </aside>

  </div>
</template>
