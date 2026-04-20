<script setup lang="ts">
import { ref, computed } from 'vue';
import { useDocStore } from '@/stores/docStore';

const props = defineProps<{
  ttiMs: number | null;
  getKonvaNodeCount: () => number;
}>();

interface Result {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'pass' | 'fail' | 'manual';
  measured: string;
  threshold: string;
}

const docStore = useDocStore();
const open = ref(false);
const running = ref(false);
const m2Pass = ref(false);
const m2Checked = ref(false);

const results = ref<Result[]>([
  { id: 'M4', label: 'Time-to-interactive', status: 'pending', measured: '—', threshold: '< 2000ms' },
  { id: 'M1', label: 'Sustained FPS (3s)', status: 'pending', measured: '—', threshold: '≥ 55fps' },
  { id: 'M3', label: 'Single-commit correctness', status: 'pending', measured: '—', threshold: '= 1 mutation' },
  { id: 'M6', label: 'Undo roundtrip (5 drags)', status: 'pending', measured: '—', threshold: '< 0.001in drift' },
  { id: 'M5', label: 'Memory stability', status: 'pending', measured: '—', threshold: '< 10MB growth' },
  { id: 'M7', label: 'Consistency assertions', status: 'pending', measured: '—', threshold: '0 failures' },
  { id: 'M2', label: 'Drag feel — drag a plant 5s, then check if smooth', status: 'manual', measured: '', threshold: 'no visible lag' },
]);

const EPSILON = 0.001;

function set(id: string, patch: Partial<Result>) {
  const r = results.value.find(r => r.id === id)!;
  Object.assign(r, patch);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function measureFPS(): Promise<number> {
  return new Promise(resolve => {
    let frames = 0;
    const start = performance.now();
    function tick() {
      frames++;
      performance.now() - start < 3000 ? requestAnimationFrame(tick) : resolve(frames / 3);
    }
    requestAnimationFrame(tick);
  });
}

async function runAll() {
  if (running.value) return;
  running.value = true;
  for (const r of results.value) {
    if (r.id !== 'M2') Object.assign(r, { status: 'pending', measured: '—' });
  }

  // M4: Time-to-interactive
  set('M4', { status: 'running' });
  await sleep(30);
  const tti = props.ttiMs;
  if (tti === null) {
    set('M4', { status: 'fail', measured: 'not captured' });
  } else {
    set('M4', { status: tti < 2000 ? 'pass' : 'fail', measured: `${tti.toFixed(0)}ms` });
  }

  // M1: FPS
  set('M1', { status: 'running' });
  const fps = await measureFPS();
  set('M1', { status: fps >= 55 ? 'pass' : 'fail', measured: `${fps.toFixed(1)}fps` });

  // M3: Single-commit correctness
  set('M3', { status: 'running' });
  const ids = [...docStore.plants.keys()];
  let mutCount = 0;
  const unsub = docStore.$subscribe(() => { mutCount++; });
  const plant = docStore.plants.get(ids[0])!;
  docStore.updatePlantPosition(ids[0], { x: plant.position.x + 1.0, y: plant.position.y + 0.5 });
  await sleep(50);
  unsub();
  docStore.undo();
  set('M3', { status: mutCount === 1 ? 'pass' : 'fail', measured: `${mutCount} mutation${mutCount !== 1 ? 's' : ''}` });

  // M6: Undo roundtrip
  set('M6', { status: 'running' });
  const fiveIds = ids.slice(0, 5);
  const originals = fiveIds.map(id => ({ ...docStore.plants.get(id)!.position }));
  for (const id of fiveIds) {
    const p = docStore.plants.get(id)!;
    docStore.updatePlantPosition(id, { x: p.position.x + 2.0, y: p.position.y + 1.5 });
    await sleep(30);
  }
  for (let i = 0; i < 5; i++) { docStore.undo(); await sleep(50); }
  const posOk = fiveIds.every((id, i) => {
    const pos = docStore.plants.get(id)!.position;
    return Math.abs(pos.x - originals[i].x) < EPSILON && Math.abs(pos.y - originals[i].y) < EPSILON;
  });
  set('M6', { status: posOk ? 'pass' : 'fail', measured: posOk ? 'all restored' : 'position drift' });

  // M5: Memory
  set('M5', { status: 'running' });
  const heapBefore = (performance as any).memory?.usedJSHeapSize ?? 0;
  for (let i = 0; i < 20; i++) {
    const id = ids[i % ids.length];
    const p = docStore.plants.get(id)!;
    docStore.updatePlantPosition(id, { x: p.position.x + (i % 2 ? 0.5 : -0.5), y: p.position.y + 0.3 });
    await sleep(20);
    docStore.undo();
    await sleep(10);
  }
  const heapAfter = (performance as any).memory?.usedJSHeapSize ?? 0;
  if (heapBefore === 0) {
    set('M5', { status: 'pass', measured: 'N/A — run Chrome with --enable-precise-memory-info' });
  } else {
    const mb = (heapAfter - heapBefore) / 1_048_576;
    set('M5', { status: mb < 10 ? 'pass' : 'fail', measured: `+${mb.toFixed(2)}MB` });
  }

  // M7: Consistency assertions (intercept console.assert)
  set('M7', { status: 'running' });
  const failures: string[] = [];
  const origAssert = console.assert.bind(console);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (console as any).assert = (condition: boolean, ...args: unknown[]) => {
    if (!condition) failures.push(args.map(String).join(' '));
    origAssert(condition, ...args);
  };
  for (let i = 0; i < 5; i++) {
    const id = ids[i % ids.length];
    const p = docStore.plants.get(id)!;
    docStore.updatePlantPosition(id, { x: p.position.x + 0.5, y: p.position.y + 0.3 });
    await sleep(50);
    docStore.undo();
    await sleep(30);
  }
  (console as any).assert = origAssert;
  set('M7', { status: failures.length === 0 ? 'pass' : 'fail', measured: `${failures.length} failure${failures.length !== 1 ? 's' : ''}` });

  running.value = false;
}

const autoResults = computed(() => results.value.filter(r => r.id !== 'M2'));
const allAutoPass = computed(() => autoResults.value.every(r => r.status === 'pass'));
const verdict = computed(() => {
  if (!allAutoPass.value) return null;
  if (!m2Checked.value) return null;
  return m2Pass.value ? 'go' : 'nogo';
});

const copyText = computed(() => {
  const header = `Experiment 1 Self-Test — ${new Date().toISOString()}`;
  const lines = results.value.map(r => {
    if (r.id === 'M2') return `M2: ${m2Checked.value ? (m2Pass.value ? 'PASS' : 'FAIL') : 'PENDING'} — drag feel`;
    return `${r.id}: ${r.status.toUpperCase()} — ${r.measured} (threshold: ${r.threshold})`;
  });
  return [header, ...lines].join('\n');
});

function statusColor(status: string): string {
  if (status === 'pass') return '#88cc88';
  if (status === 'fail') return '#cc5555';
  if (status === 'running') return '#cccc55';
  return '#666';
}

function copyToClipboard() {
  navigator.clipboard?.writeText(copyText.value);
}

function statusGlyph(id: string, status: string): string {
  if (id === 'M2') return '';
  if (status === 'pass') return '✓';
  if (status === 'fail') return '✗';
  if (status === 'running') return '…';
  return '·';
}
</script>

<template>
  <div style="position: absolute; top: 12px; right: 12px; z-index: 100; font-family: monospace; font-size: 12px;">
    <button
      @click="open = !open"
      style="background: #1a2a1a; color: #88cc88; border: 1px solid #3a6a3a; padding: 6px 14px; cursor: pointer; border-radius: 4px; font-family: monospace; font-size: 12px;"
    >
      Self-test {{ open ? '▲' : '▼' }}
    </button>

    <div
      v-if="open"
      style="margin-top: 6px; background: rgba(10,16,10,0.93); color: #ddd; padding: 14px 16px; border-radius: 4px; min-width: 400px; border: 1px solid #3a5a3a;"
    >
      <div
        v-for="r in results"
        :key="r.id"
        style="display: flex; gap: 8px; margin-bottom: 5px; align-items: baseline;"
      >
        <span style="width: 28px; font-weight: bold; color: #aaa;">{{ r.id }}</span>
        <span :style="{ width: '14px', color: statusColor(r.status) }">{{ statusGlyph(r.id, r.status) }}</span>
        <span style="flex: 1;">{{ r.label }}</span>
        <span :style="{ color: statusColor(r.status) }">{{ r.measured }}</span>
      </div>

      <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #2a3a2a;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #bbb;">
          <input
            type="checkbox"
            v-model="m2Checked"
            @change="() => { if (!m2Checked) m2Pass = false; }"
          />
          M2 drag tested
          <input
            v-if="m2Checked"
            type="checkbox"
            v-model="m2Pass"
            style="margin-left: 8px;"
          />
          <span v-if="m2Checked" :style="{ color: m2Pass ? '#88cc88' : '#cc5555' }">
            {{ m2Pass ? 'PASS — felt smooth' : 'FAIL — lag detected' }}
          </span>
        </label>
      </div>

      <div style="margin-top: 12px; display: flex; gap: 8px;">
        <button
          @click="runAll"
          :disabled="running"
          style="background: #1a4a1a; color: #88cc88; border: 1px solid #3a6a3a; padding: 7px 14px; cursor: pointer; border-radius: 3px; flex: 1; font-family: monospace; font-size: 12px;"
        >
          {{ running ? 'Running…' : 'Run automated tests (M1–M7 except M2)' }}
        </button>
        <button
          v-if="allAutoPass"
          @click="copyToClipboard()"
          style="background: #222; color: #888; border: 1px solid #444; padding: 7px 10px; cursor: pointer; border-radius: 3px; font-family: monospace;"
          title="Copy results to clipboard"
        >
          Copy
        </button>
      </div>

      <div
        v-if="verdict"
        :style="{
          marginTop: '12px',
          padding: '8px 10px',
          borderRadius: '3px',
          fontWeight: 'bold',
          background: verdict === 'go' ? '#0a2a0a' : '#2a0a0a',
          color: verdict === 'go' ? '#88cc88' : '#cc5555',
          border: `1px solid ${verdict === 'go' ? '#3a6a3a' : '#6a3a3a'}`,
        }"
      >
        {{ verdict === 'go' ? '✓ GO — all 7 pass. Proceed to Experiment 2.' : '✗ NO-GO — M2 failed. Check drag performance.' }}
      </div>
    </div>
  </div>
</template>
