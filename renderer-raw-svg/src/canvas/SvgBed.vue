<template>
  <path
    :d="pathD"
    :fill="bed.fillColor"
    stroke="#2d5a1b"
    stroke-width="2"
    vector-effect="non-scaling-stroke"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Bed, DrawingPoint } from '@/stores/docStore';
import { PX_PER_INCH } from './constants';

const props = defineProps<{ bed: Bed }>();

const pathD = computed(() => {
  const anchors = props.bed.anchors;
  if (anchors.length < 2) return '';

  const toS = (p: DrawingPoint): string =>
    `${p.x * PX_PER_INCH},${p.y * PX_PER_INCH}`;

  let d = `M ${toS(anchors[0].position)}`;

  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const curr = anchors[i];
    d += ` C ${toS(prev.handleOut)} ${toS(curr.handleIn)} ${toS(curr.position)}`;
  }

  if (props.bed.closed) {
    const last = anchors[anchors.length - 1];
    const first = anchors[0];
    d += ` C ${toS(last.handleOut)} ${toS(first.handleIn)} ${toS(first.position)} Z`;
  }

  return d;
});
</script>
