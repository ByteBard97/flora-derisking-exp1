<template>
  <svg
    ref="svgEl"
    style="width: 100%; height: 100%"
    @wheel.prevent="onWheel"
    @pointerdown="onBgPointerDown"
  >
    <!-- ── Container mode: single <g> wraps background, beds, and all plants ── -->
    <template v-if="panMode === 'container'">
      <g :transform="worldTransform">
        <SvgBackground />
        <SvgBed v-for="bed in beds" :key="bed.id" :bed="bed" />
        <SvgPlant
          v-for="plant in plants"
          :key="plant.id"
          :plant="plant"
          :zoom="camera.z"
          :selected="plant.id === selectedId"
          @drag-end="onDragEnd"
          @select="$emit('select', plant.id)"
        />
      </g>
    </template>

    <!-- ── Per-shape mode: shared group for background + beds; plants are individual ── -->
    <template v-else>
      <g :transform="worldTransform">
        <SvgBackground />
        <SvgBed v-for="bed in beds" :key="bed.id" :bed="bed" />
      </g>
      <SvgPlant
        v-for="plant in plants"
        :key="plant.id"
        :plant="plant"
        :screen-x="plant.position.x * PX_PER_INCH * camera.z + (-camera.x * camera.z)"
        :screen-y="plant.position.y * PX_PER_INCH * camera.z + (-camera.y * camera.z)"
        :zoom="camera.z"
        :selected="plant.id === selectedId"
        @drag-end="onDragEnd"
        @select="$emit('select', plant.id)"
      />
    </template>
  </svg>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Plant, Bed } from '@/stores/docStore';
import { PX_PER_INCH } from './constants';
import SvgBackground from './SvgBackground.vue';
import SvgBed from './SvgBed.vue';
import SvgPlant from './SvgPlant.vue';

interface Camera {
  x: number; // world-space inches (negative → viewport shows positive world area)
  y: number;
  z: number; // zoom scale
}

const props = defineProps<{
  plants: Plant[];
  beds: Bed[];
  selectedId: string | null;
  panMode: 'container' | 'per-shape';
}>();

const emit = defineEmits<{
  dragEnd: [plantId: string, pos: { x: number; y: number }];
  select: [plantId: string];
  ready: [ttiMs: number];
}>();

// ── Camera ────────────────────────────────────────────────────────────────────

const camera = ref<Camera>({ x: -20, y: -20, z: 0.3 });

/** Called by the __flora_editor__ shim to jump the viewport. */
function setCamera(cam: { x: number; y: number; z: number }): void {
  camera.value = cam;
}

defineExpose({ setCamera });

/** Shared CSS transform for the world group (maps world inches → screen px). */
const worldTransform = computed(() =>
  `translate(${-camera.value.x * camera.value.z}, ${-camera.value.y * camera.value.z}) scale(${camera.value.z})`
);

// ── Zoom (wheel) ──────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;

function onWheel(e: WheelEvent): void {
  const oldZ = camera.value.z;
  const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZ * (1 - e.deltaY * 0.001)));

  // Keep the world point under the cursor fixed during zoom.
  const worldX =
    (e.offsetX - -camera.value.x * oldZ) / oldZ / PX_PER_INCH;
  const worldY =
    (e.offsetY - -camera.value.y * oldZ) / oldZ / PX_PER_INCH;

  camera.value = {
    x: -(e.offsetX - worldX * newZ * PX_PER_INCH) / newZ,
    y: -(e.offsetY - worldY * newZ * PX_PER_INCH) / newZ,
    z: newZ,
  };
}

// ── Pan (background drag) ─────────────────────────────────────────────────────

const svgEl = ref<SVGSVGElement | null>(null);

interface PanState {
  startClientX: number;
  startClientY: number;
  startCamX: number;
  startCamY: number;
}

let panState: PanState | null = null;

function onBgPointerDown(e: PointerEvent): void {
  // Only act on direct SVG background clicks (plants stop propagation).
  if (e.target !== svgEl.value) return;

  panState = {
    startClientX: e.clientX,
    startClientY: e.clientY,
    startCamX: camera.value.x,
    startCamY: camera.value.y,
  };

  window.addEventListener('pointermove', onPanMove);
  window.addEventListener('pointerup', onPanUp);
  window.addEventListener('pointercancel', onPanUp);
}

function onPanMove(e: PointerEvent): void {
  if (!panState) return;
  const dx = e.clientX - panState.startClientX;
  const dy = e.clientY - panState.startClientY;
  // Screen pixel delta → world inch delta: divide by (zoom * PX_PER_INCH)
  camera.value = {
    ...camera.value,
    x: panState.startCamX - dx / (camera.value.z * PX_PER_INCH),
    y: panState.startCamY - dy / (camera.value.z * PX_PER_INCH),
  };
}

function onPanUp(): void {
  panState = null;
  window.removeEventListener('pointermove', onPanMove);
  window.removeEventListener('pointerup', onPanUp);
  window.removeEventListener('pointercancel', onPanUp);
}

// ── Plant drag passthrough ────────────────────────────────────────────────────

function onDragEnd(plantId: string, pos: { x: number; y: number }): void {
  emit('dragEnd', plantId, pos);
}

// ── TTI ───────────────────────────────────────────────────────────────────────

const mountedAt = Date.now();

onMounted(() => {
  // Double rAF: first fires after layout, second after paint.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      emit('ready', Date.now() - mountedAt);
    });
  });
});
</script>
