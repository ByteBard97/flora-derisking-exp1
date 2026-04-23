<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useDocStore } from '@/stores/docStore';
import { useSelectionStore } from '@/stores/selectionStore';
import PixiCanvas from '@/canvas/PixiCanvas.vue';

const docStore = useDocStore();
const selectionStore = useSelectionStore();

const pixiCanvas = ref<InstanceType<typeof PixiCanvas> | null>(null);
const showBackground = ref(true);
const plantCount = ref(300);

// FPS stats
const fps = ref(0);
const frameMs = ref(0);
const zoom = ref(0.3);
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
  }
  rafId = requestAnimationFrame(debugLoop);
}

function handleDragEnd(plantId: string, pos: { x: number; y: number }): void {
  docStore.updatePlantPosition(plantId, pos);
}

function handleSelect(plantId: string | null): void {
  if (plantId) selectionStore.selectPlant(plantId);
  else selectionStore.clearSelection();
}

function handleKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    docStore.undo();
  }
}

function applyPlantCount(): void {
  docStore.setPlantCount(plantCount.value);
}

function toggleBackground(): void {
  showBackground.value = !showBackground.value;
  pixiCanvas.value?.setBackgroundVisible(showBackground.value);
}

const plants = computed(() => [...docStore.plants.values()]);
const beds = computed(() => [...docStore.beds.values()]);

onMounted(() => {
  rafId = requestAnimationFrame(debugLoop);
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="wrap">
    <PixiCanvas
      ref="pixiCanvas"
      :plants="plants"
      :beds="beds"
      :selected-id="selectionStore.selectedPlantId"
      @drag-end="handleDragEnd"
      @select="handleSelect"
      @zoom="z => zoom = z"
    />

    <!-- FPS overlay -->
    <div class="hud">
      <div class="fps">{{ fps }} <span>fps</span></div>
      <div>{{ frameMs }} ms/frame</div>
      <div>plants: {{ docStore.plants.size }}</div>
      <div>selected: {{ selectionStore.selectedPlantId?.slice(0, 6) ?? 'none' }}</div>
      <div>undo: {{ docStore.undoStack.length }}/10</div>
      <div :style="{ color: zoom < 0.05 ? '#f66' : zoom < 0.15 ? '#fa0' : '#0f0' }">
        zoom: {{ zoom.toFixed(3) }} · lod{{ zoom < 0.05 ? 0 : zoom < 0.15 ? 1 : 2 }}
      </div>
    </div>

    <!-- Controls -->
    <div class="controls">
      <label>
        Plants
        <input type="range" v-model.number="plantCount" min="10" max="500" step="10" />
        {{ plantCount }}
      </label>
      <button @click="applyPlantCount">Rebuild</button>
      <button @click="toggleBackground">{{ showBackground ? 'Hide BG' : 'Show BG' }}</button>
      <div class="hint">Space+drag / M3 = pan · scroll = zoom · click = select · drag = move · lasso = multi-select · ⌘Z = undo</div>
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #1a1a1a; }
.hud {
  position: absolute; top: 10px; left: 10px;
  font-family: monospace; font-size: 11px; color: #0f0;
  background: rgba(0,0,0,0.75); padding: 8px 12px; border-radius: 4px;
  pointer-events: none; line-height: 1.8;
}
.fps { font-size: 16px; font-weight: bold; }
.fps span { font-size: 11px; color: #0a0; }
.controls {
  position: absolute; top: 10px; right: 10px;
  display: flex; flex-direction: column; gap: 8px;
  font-family: monospace; font-size: 12px; color: #bbb;
  background: rgba(0,0,0,0.75); padding: 10px 14px; border-radius: 4px;
}
label { display: flex; align-items: center; gap: 6px; }
button {
  padding: 4px 12px; background: #2a2a2a; color: #aaa;
  border: 1px solid #444; border-radius: 3px; cursor: pointer;
  font-family: monospace; font-size: 12px;
}
button:hover { background: #333; color: #fff; }
.hint { font-size: 10px; color: #555; max-width: 260px; line-height: 1.5; }
</style>
