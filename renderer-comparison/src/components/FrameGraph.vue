<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps<{ frameMs: number }>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const HISTORY = 200;
const samples = new Float32Array(HISTORY);
let head = 0;
let rafId = 0;
let dirty = false;

watch(() => props.frameMs, (ms) => {
  samples[head % HISTORY] = ms;
  head++;
  dirty = true;
});

function draw() {
  rafId = requestAnimationFrame(draw);
  if (!dirty || !canvasEl.value) return;
  dirty = false;

  const canvas = canvasEl.value;
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const MAX_MS = 40; // y-axis ceiling

  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, W, H);

  // Reference lines
  const refs = [
    { ms: 8.3,  label: '120', color: '#2a6a2a' },
    { ms: 16.7, label: '60',  color: '#2a4a6a' },
    { ms: 33.3, label: '30',  color: '#6a3a2a' },
  ];
  ctx.font = '9px monospace';
  for (const r of refs) {
    const y = H - (r.ms / MAX_MS) * H;
    ctx.strokeStyle = r.color;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = r.color;
    ctx.fillText(`${r.label}fps`, W - 28, y - 2);
  }

  // Frame time line
  const count = Math.min(head, HISTORY);
  const step = W / HISTORY;

  ctx.beginPath();
  ctx.strokeStyle = '#6aabcf';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < count; i++) {
    const idx = (head - count + i) % HISTORY;
    const ms = samples[idx];
    const x = i * step;
    const y = H - Math.min(ms / MAX_MS, 1) * H;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Current value
  const latest = samples[(head - 1 + HISTORY) % HISTORY];
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 10px monospace';
  ctx.fillText(`${latest.toFixed(1)}ms`, 4, 12);
}

onMounted(() => { rafId = requestAnimationFrame(draw); });
onBeforeUnmount(() => cancelAnimationFrame(rafId));
</script>

<template>
  <canvas ref="canvasEl" :width="200" :height="60"
    style="display:block; width:200px; height:60px; border-radius:4px;" />
</template>
