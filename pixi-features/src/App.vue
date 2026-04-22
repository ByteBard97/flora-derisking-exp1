<script setup lang="ts">
import { ref, computed, defineAsyncComponent } from 'vue';

const tabs = [
  { id: 'renderer',   label: 'Plant Renderer', comp: defineAsyncComponent(() => import('./tabs/TabPlantRenderer.vue')) },
  { id: 'leader',     label: 'Leader Line',    comp: defineAsyncComponent(() => import('./tabs/TabLeaderLine.vue')) },
  { id: 'pen',       label: 'Pen Tool',       comp: defineAsyncComponent(() => import('./tabs/TabPenTool.vue')) },
  { id: 'sel',       label: 'Selection',      comp: defineAsyncComponent(() => import('./tabs/TabSelection.vue')) },
  { id: 'snap',      label: 'Snapping',       comp: defineAsyncComponent(() => import('./tabs/TabSnapping.vue')) },
  { id: 'dash',      label: 'Dashed Lines',   comp: defineAsyncComponent(() => import('./tabs/TabDashedLines.vue')) },
  { id: 'bool',      label: 'Boolean Ops',    comp: defineAsyncComponent(() => import('./tabs/TabBooleanOps.vue')) },
  { id: 'freehand',  label: 'Freehand',       comp: defineAsyncComponent(() => import('./tabs/TabFreehand.vue')) },
  { id: 'bitmap',    label: 'BitmapText',     comp: defineAsyncComponent(() => import('./tabs/TabBitmapText.vue')) },
  { id: 'ants',      label: 'Marching Ants',  comp: defineAsyncComponent(() => import('./tabs/TabMarchingAnts.vue')) },
  { id: 'viewport',  label: 'Viewport',       comp: defineAsyncComponent(() => import('./tabs/TabViewport.vue')) },
  { id: 'transform', label: 'Transform Gizmo',comp: defineAsyncComponent(() => import('./tabs/TabTransformGizmo.vue')) },
  { id: 'spatial',   label: 'Spatial Index',  comp: defineAsyncComponent(() => import('./tabs/TabSpatialIndex.vue')) },
  { id: 'pixiui',    label: '@pixi/ui',       comp: defineAsyncComponent(() => import('./tabs/TabPixiUI.vue')) },
];

const active = ref('pen');
const activeComp = computed(() => tabs.find(t => t.id === active.value)!.comp);
</script>

<template>
  <div class="shell">
    <nav>
      <button
        v-for="t in tabs" :key="t.id"
        :class="{ active: active === t.id }"
        @click="active = t.id"
      >{{ t.label }}</button>
      <span class="subtitle">Pixi.js v8 · Flora Studio derisking</span>
    </nav>
    <div class="canvas-area">
      <component :is="activeComp" />
    </div>
  </div>
</template>

<style scoped>
.shell { display: flex; flex-direction: column; width: 100%; height: 100%; font-family: monospace; }
nav {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 10px; background: #1a1a1a;
  border-bottom: 1px solid #333; flex-shrink: 0;
}
button {
  padding: 4px 14px; background: #2a2a2a; color: #888;
  border: 1px solid #444; border-radius: 3px; cursor: pointer;
  font-family: monospace; font-size: 12px; transition: background 0.1s;
}
button.active { background: #0070e0; color: #fff; border-color: #0070e0; }
button:hover:not(.active) { background: #333; color: #bbb; }
.subtitle { margin-left: auto; font-size: 11px; color: #444; }
.canvas-area { flex: 1; overflow: hidden; position: relative; }
</style>
