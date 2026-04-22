<template>
  <image
    href="/site-plan.svg"
    x="0"
    y="0"
    :width="WORLD_W"
    :height="WORLD_H"
    preserveAspectRatio="xMidYMid meet"
  />
</template>

<script setup lang="ts">
import { WORLD_W, WORLD_H } from './constants';
</script>
