<template>
  <!-- Container mode: position via parent <g> transform; render at world coords -->
  <g
    v-if="screenX === undefined || screenY === undefined"
    :transform="`translate(${plant.position.x * PX_PER_INCH}, ${plant.position.y * PX_PER_INCH})`"
    @pointerdown.stop="onPlantPointerDown"
  >
    <circle
      :r="radiusPx"
      :fill="SPECIES_COLORS[plant.speciesType]"
      fill-opacity="0.7"
      :stroke="selected ? '#fff' : 'none'"
      stroke-width="3"
    />
    <image
      :href="`/sprites/${plant.speciesType}.svg`"
      :x="-radiusPx * 0.8"
      :y="-radiusPx * 0.8"
      :width="radiusPx * 1.6"
      :height="radiusPx * 1.6"
    />
    <text
      text-anchor="middle"
      dominant-baseline="middle"
      fill="#000"
      stroke="#fff"
      stroke-width="3"
      paint-order="stroke"
      :font-size="Math.max(8, radiusPx * 0.5)"
    >{{ plant.label }}</text>
  </g>

  <!-- Per-shape mode: position via screenX/screenY, radius scaled by zoom -->
  <g
    v-else
    :transform="`translate(${screenX}, ${screenY})`"
    @pointerdown.stop="onPlantPointerDown"
  >
    <circle
      :r="radiusPx * (zoom ?? 1)"
      :fill="SPECIES_COLORS[plant.speciesType]"
      fill-opacity="0.7"
      :stroke="selected ? '#fff' : 'none'"
      stroke-width="3"
    />
    <image
      :href="`/sprites/${plant.speciesType}.svg`"
      :x="-radiusPx * (zoom ?? 1) * 0.8"
      :y="-radiusPx * (zoom ?? 1) * 0.8"
      :width="radiusPx * (zoom ?? 1) * 1.6"
      :height="radiusPx * (zoom ?? 1) * 1.6"
    />
    <text
      text-anchor="middle"
      dominant-baseline="middle"
      fill="#000"
      stroke="#fff"
      stroke-width="3"
      paint-order="stroke"
      :font-size="Math.max(8, radiusPx * (zoom ?? 1) * 0.5)"
    >{{ plant.label }}</text>
  </g>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Plant, SpeciesType } from '@/stores/docStore';
import { PX_PER_INCH } from './constants';

/** Minimum pointer movement in screen pixels to classify as a drag (not a click). */
const DRAG_THRESHOLD_PX = 4;

const SPECIES_COLORS: Record<SpeciesType, string> = {
  oak: '#4a7c59',
  magnolia: '#c8a2c8',
  azalea: '#ff6b9d',
  fern: '#7ec8a0',
};

const props = defineProps<{
  plant: Plant;
  selected: boolean;
  /** Per-shape mode: explicit screen x position (pixels). */
  screenX?: number;
  /** Per-shape mode: explicit screen y position (pixels). */
  screenY?: number;
  /** Current camera zoom. Required in both modes for drag delta conversion. */
  zoom?: number;
}>();

const emit = defineEmits<{
  dragEnd: [plantId: string, pos: { x: number; y: number }];
  select: [plantId: string];
}>();

/** World-space radius in pixels (unscaled — parent transform or per-shape zoom handles scale). */
const radiusPx = computed(() => props.plant.radius * PX_PER_INCH);

function onPlantPointerDown(e: PointerEvent): void {
  e.stopPropagation();
  const target = e.currentTarget as SVGGElement;
  target.setPointerCapture(e.pointerId);

  const startClientX = e.clientX;
  const startClientY = e.clientY;
  const startPos = { ...props.plant.position };
  let didDrag = false;

  function onMove(me: PointerEvent): void {
    const dx = me.clientX - startClientX;
    const dy = me.clientY - startClientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= DRAG_THRESHOLD_PX) {
      didDrag = true;
    }
  }

  function onUp(ue: PointerEvent): void {
    target.releasePointerCapture(ue.pointerId);
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);

    if (didDrag) {
      const currentZ = props.zoom ?? 0.3;
      const dx = ue.clientX - startClientX;
      const dy = ue.clientY - startClientY;
      // Screen delta → inch delta: screen px / (zoom * PX_PER_INCH)
      const newX = startPos.x + dx / (currentZ * PX_PER_INCH);
      const newY = startPos.y + dy / (currentZ * PX_PER_INCH);
      emit('dragEnd', props.plant.id, { x: newX, y: newY });
    } else {
      emit('select', props.plant.id);
    }
  }

  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
}
</script>
