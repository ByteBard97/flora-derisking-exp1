<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface TodoItem {
  id: number;
  title: string;
  body: string;
  done: boolean;
}

const STORAGE_KEY = 'pixi-features-todo-v2';

const DEFAULTS: Omit<TodoItem, 'id'>[] = [
  {
    title: 'Verify 5 unconfirmed tabs',
    body: 'Browser crashed before we could screenshot these:\n• Marching Ants\n• Viewport\n• Transform Gizmo\n• Spatial Index\n• @pixi/ui\n\nOpen each one at localhost:5202 and make sure they load and interact correctly.',
    done: false,
  },
  {
    title: 'Rulers / measurement tool spike',
    body: 'Need a TabRulers spike proving tick marks stay legible across 3 orders of zoom magnitude (0.05× to 10×).\n\nResearch prompt already written — check annie-reviews/notebooklm-video-prompt.md for the measurement tool section.\n\nRapiD reference: modules/core/MapSystem.js has zoom-stable tick logic.',
    done: false,
  },
  {
    title: 'Freehand auto-smooth quality check',
    body: 'TabFreehand now shows the green fitted bezier overlay on pointer-up.\n\nQuality bar: draw a simple S-curve or bed boundary. The green path should look like what Illustrator produces with the pencil tool.\n\nTune fitError (currently 4) if curves cut corners too much (try 2) or are too jagged (try 8).',
    done: false,
  },
  {
    title: 'Layer lock/visibility spike',
    body: 'Scene graph layer structure is decided (see ARCHITECTURE.md).\n\nNeed to prove: container.visible = false works cleanly, and container.interactiveChildren = false actually prevents pointer events on locked layers.\n\nRapiD steal: AbstractLayer.js + PixiScene.js (~400 lines total).',
    done: false,
  },
  {
    title: 'Bed fill algorithm spike',
    body: 'Stack decided: fast-2d-poisson-disk-sampling + honeycomb-grid + bezier-js (flatten bed to polygon) + @turf/boolean-point-in-polygon + simplex-noise (species clustering).\n\nBuild a TabBedFill that: draws a closed bezier bed, fills it with Poisson disk scatter, then hex grid. Compare visually. Offload to Web Worker for beds with >500 plants.',
    done: false,
  },
  {
    title: 'planToSvg() — SVG export pure function',
    body: 'Architecture decided, closed. See flora-studio/docs/svg-pdf-export-architecture.md.\n\nBuild as packages/plan-svg/planToSvg(store, opts): string — zero Pixi imports, zero DOM.\n\nMap: plants → <circle>+<use>, beds → graphicsContextToSvg(), labels → outlined paths, aerial → base64 <image>.\n\nServer-side: pipe through Inkscape CLI for PDF.',
    done: false,
  },
  {
    title: 'Plant library UI',
    body: 'Pure Vue, no canvas risk. 300+ native Florida species, searchable by name, filterable by sun/water/soil/bloom/wildlife.\n\nfits flora-uxp already has Fuse.js for search — port it.\n\nDesign palette: named shortlists per project, stored per-user.',
    done: false,
  },
  {
    title: 'GIS site import integration',
    body: 'Backend already exists (flora-backend). Coordinate pipeline already decided (Rapid viewport math).\n\nStep 1: type address → parcel boundary + aerial + soil zones appear on canvas as locked reference layers.\n\nflora-uxp steal: SitePlanImportService.ts, CoordinateOrchestrator.ts.',
    done: false,
  },
  {
    title: 'Annie review session — show her the canvas',
    body: 'Show in this order:\n1. Plant Renderer — 300 plants, pan/zoom, click to select, drag to move\n2. Pen Tool — draw a bed shape, show corner/smooth anchors\n3. Freehand — sketch a bed, watch it auto-smooth\n4. Boolean Ops — merge two overlapping beds\n5. Measure tool — show distance and area readouts\n6. Knife Tool — split a bed into two zones\n\nKey message: everything Illustrator does for a landscape plan, Flora does faster and knows what the plants are.',
    done: false,
  },
  {
    title: 'Push NotebookLM assets to Geoff',
    body: 'Files ready in:\n• derisking-experiments/annie-reviews/flora-story-for-notebooklm.md\n• derisking-experiments/annie-reviews/notebooklm-video-prompt.md\n\nUpload to NotebookLM along with:\n• flora-v2-design-brief.md\n• pixi-feature-audit.md\n• RISK-REGISTER.md',
    done: false,
  },
];

function load(): TodoItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
    // First load — seed with defaults
    const seeded = DEFAULTS.map((d, i) => ({ ...d, id: i }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  } catch {
    return [];
  }
}

const items = ref<TodoItem[]>(load());
let nextId = items.value.reduce((m, i) => Math.max(m, i.id + 1), 0);

watch(items, val => localStorage.setItem(STORAGE_KEY, JSON.stringify(val)), { deep: true });

const activeTab = ref<'active' | 'done'>('active');
const selectedId = ref<number | null>(null);

// New item form
const addingNew = ref(false);
const newTitle = ref('');
const newBody = ref('');

const active = computed(() => items.value.filter(i => !i.done));
const done   = computed(() => items.value.filter(i => i.done));
const listed = computed(() => activeTab.value === 'active' ? active.value : done.value);

const selected = computed(() => items.value.find(i => i.id === selectedId.value) ?? null);

function select(id: number) {
  selectedId.value = selectedId.value === id ? null : id;
}

function toggle(item: TodoItem) {
  item.done = !item.done;
  // If completed item was selected, deselect
  if (item.done && selectedId.value === item.id) selectedId.value = null;
  // Switch to done tab briefly so user sees it land there? No — keep them on active.
}

function addItem() {
  const title = newTitle.value.trim();
  if (!title) return;
  items.value.push({ id: nextId++, title, body: newBody.value.trim(), done: false });
  newTitle.value = '';
  newBody.value = '';
  addingNew.value = false;
}

function cancelAdd() {
  newTitle.value = '';
  newBody.value = '';
  addingNew.value = false;
}

function deleteItem(id: number) {
  items.value = items.value.filter(i => i.id !== id);
  if (selectedId.value === id) selectedId.value = null;
}

function updateSelected(field: 'title' | 'body', val: string) {
  const item = items.value.find(i => i.id === selectedId.value);
  if (item) item[field] = val;
}
</script>

<template>
  <div class="todo-panel">
    <!-- Header -->
    <div class="todo-header">
      <span class="todo-title">Todo</span>
      <div class="todo-tabs">
        <button :class="{ active: activeTab === 'active' }" @click="activeTab = 'active'">
          Active <span class="badge" v-if="active.length">{{ active.length }}</span>
        </button>
        <button :class="{ active: activeTab === 'done' }" @click="activeTab = 'done'">
          Done <span class="badge done-badge" v-if="done.length">{{ done.length }}</span>
        </button>
      </div>
    </div>

    <!-- List -->
    <div class="todo-list">
      <div
        v-for="item in listed" :key="item.id"
        class="todo-item"
        :class="{ selected: selectedId === item.id, done: item.done }"
        @click="select(item.id)"
      >
        <input
          type="checkbox"
          :checked="item.done"
          @click.stop
          @change="toggle(item)"
          class="todo-checkbox"
        />
        <span class="todo-item-title">{{ item.title }}</span>
        <button class="todo-delete" @click.stop="deleteItem(item.id)" title="Delete">×</button>
      </div>

      <div v-if="listed.length === 0" class="todo-empty">
        {{ activeTab === 'active' ? 'Nothing here yet.' : 'Nothing completed yet.' }}
      </div>
    </div>

    <!-- Selected item body -->
    <div v-if="selected" class="todo-body-area">
      <div class="todo-body-label">{{ selected.title }}</div>
      <textarea
        class="todo-body-text"
        :value="selected.body"
        @input="updateSelected('body', ($event.target as HTMLTextAreaElement).value)"
        placeholder="Add notes…"
        rows="5"
      />
    </div>

    <!-- Add new item -->
    <div class="todo-add-area">
      <template v-if="!addingNew">
        <button class="todo-add-btn" @click="addingNew = true">+ Add item</button>
      </template>
      <template v-else>
        <input
          v-model="newTitle"
          class="todo-new-title"
          placeholder="Title…"
          @keydown.enter="addItem"
          @keydown.escape="cancelAdd"
          autofocus
        />
        <textarea
          v-model="newBody"
          class="todo-new-body"
          placeholder="Notes (optional)…"
          rows="3"
          @keydown.escape="cancelAdd"
        />
        <div class="todo-new-actions">
          <button class="todo-save-btn" @click="addItem">Add</button>
          <button class="todo-cancel-btn" @click="cancelAdd">Cancel</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.todo-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #141414;
  border-left: 1px solid #2a2a2a;
  font-family: monospace;
  font-size: 12px;
  color: #ccc;
  overflow: hidden;
}

.todo-header {
  padding: 10px 10px 0;
  flex-shrink: 0;
}

.todo-title {
  display: block;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #555;
  margin-bottom: 8px;
}

.todo-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #222;
  padding-bottom: 0;
}

.todo-tabs button {
  padding: 4px 10px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: #555;
  cursor: pointer;
  font-family: monospace;
  font-size: 11px;
  margin-bottom: -1px;
}
.todo-tabs button.active {
  color: #ccc;
  border-bottom-color: #0070e0;
}
.todo-tabs button:hover:not(.active) { color: #888; }

.badge {
  display: inline-block;
  background: #0070e0;
  color: #fff;
  border-radius: 8px;
  padding: 0 5px;
  font-size: 9px;
  margin-left: 3px;
  line-height: 14px;
}
.done-badge { background: #333; color: #888; }

.todo-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
  min-height: 0;
}

.todo-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  cursor: pointer;
  border-left: 2px solid transparent;
}
.todo-item:hover { background: #1e1e1e; }
.todo-item.selected {
  background: #1a2a3a;
  border-left-color: #0070e0;
}
.todo-item.done .todo-item-title {
  text-decoration: line-through;
  color: #444;
}

.todo-checkbox {
  flex-shrink: 0;
  accent-color: #0070e0;
  cursor: pointer;
}

.todo-item-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #bbb;
}

.todo-delete {
  opacity: 0;
  background: transparent;
  border: none;
  color: #555;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}
.todo-item:hover .todo-delete { opacity: 1; }
.todo-delete:hover { color: #cc4444; }

.todo-empty {
  padding: 12px 10px;
  color: #444;
  font-style: italic;
}

.todo-body-area {
  border-top: 1px solid #222;
  padding: 10px;
  flex-shrink: 0;
}

.todo-body-label {
  font-size: 11px;
  color: #888;
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.todo-body-text {
  width: 100%;
  background: #0e0e0e;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  color: #ccc;
  font-family: monospace;
  font-size: 11px;
  padding: 6px 8px;
  resize: vertical;
  box-sizing: border-box;
  line-height: 1.5;
}
.todo-body-text:focus { outline: none; border-color: #0070e0; }

.todo-add-area {
  border-top: 1px solid #222;
  padding: 8px 10px;
  flex-shrink: 0;
}

.todo-add-btn {
  background: transparent;
  border: 1px dashed #333;
  color: #555;
  cursor: pointer;
  font-family: monospace;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 3px;
  width: 100%;
}
.todo-add-btn:hover { border-color: #555; color: #888; }

.todo-new-title {
  width: 100%;
  background: #0e0e0e;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  color: #ccc;
  font-family: monospace;
  font-size: 12px;
  padding: 5px 8px;
  box-sizing: border-box;
  margin-bottom: 5px;
}
.todo-new-title:focus { outline: none; border-color: #0070e0; }

.todo-new-body {
  width: 100%;
  background: #0e0e0e;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  color: #ccc;
  font-family: monospace;
  font-size: 11px;
  padding: 5px 8px;
  box-sizing: border-box;
  resize: none;
  margin-bottom: 6px;
  line-height: 1.5;
}
.todo-new-body:focus { outline: none; border-color: #0070e0; }

.todo-new-actions { display: flex; gap: 6px; }

.todo-save-btn {
  background: #0070e0;
  border: none;
  color: #fff;
  cursor: pointer;
  font-family: monospace;
  font-size: 11px;
  padding: 4px 14px;
  border-radius: 3px;
}
.todo-save-btn:hover { background: #0060c0; }

.todo-cancel-btn {
  background: #2a2a2a;
  border: 1px solid #444;
  color: #888;
  cursor: pointer;
  font-family: monospace;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 3px;
}
.todo-cancel-btn:hover { color: #ccc; }
</style>
