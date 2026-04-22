import { ref, onMounted, onUnmounted } from 'vue';

export function useFps() {
  const fps = ref(0);
  const frameMs = ref(0);
  const heapMB = ref<number | null>(null);

  let rafId = 0;
  let last = performance.now();
  let lastUpdate = performance.now();
  let count = 0;

  function loop() {
    const now = performance.now();
    frameMs.value = Math.round(now - last);
    last = now;
    count++;
    if (now - lastUpdate >= 500) {
      fps.value = Math.round(count * 1000 / (now - lastUpdate));
      count = 0;
      lastUpdate = now;
      const mem = (performance as any).memory;
      if (mem) heapMB.value = Math.round(mem.usedJSHeapSize / 1048576 * 10) / 10;
    }
    rafId = requestAnimationFrame(loop);
  }

  onMounted(() => { rafId = requestAnimationFrame(loop); });
  onUnmounted(() => cancelAnimationFrame(rafId));

  return { fps, frameMs, heapMB };
}
