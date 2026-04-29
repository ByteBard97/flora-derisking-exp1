<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface TodoItem {
  id: number;
  title: string;
  body: string;
  done: boolean;
  tabId?: string;
}

const emit = defineEmits<{ navigate: [tabId: string] }>();

const STORAGE_KEY = 'pixi-features-todo-v4';

const DEFAULTS: Omit<TodoItem, 'id'>[] = [
  // ── Per-tab visual verification ───────────────────────────────────────
  // Rendering
  {
    title: 'Tab: Plant Renderer',
    tabId: 'renderer',
    body: 'Group: Rendering\n\nVerify:\n• 300+ plants render without missing sprites\n• Pan + wheel-zoom feels smooth (no stutter)\n• Click selects a plant; drag moves it\n• No flicker at zoom extremes (0.1× and 10×)',
    done: false,
  },
  {
    title: 'Tab: Leader Line',
    tabId: 'leader',
    body: 'Group: Rendering\n\nVerify:\n• Leader line stays anchored to its plant under pan + zoom\n• Label remains readable across zoom range\n• No tearing or kinks where line meets label',
    done: false,
  },
  {
    title: 'Tab: MSDF Text',
    tabId: 'msdf',
    body: 'Group: Rendering\n\nVerify:\n• Text stays crisp at 0.1× zoom (no blur)\n• Text stays crisp at 10× zoom (no pixel stair-stepping)\n• Compare against BitmapText tab for sharpness',
    done: false,
  },
  {
    title: 'Tab: BitmapText',
    tabId: 'bitmap',
    body: 'Group: Rendering\n\nVerify:\n• All glyphs render (no tofu / missing chars)\n• 100+ labels stay performant\n• Compare crispness vs MSDF Text',
    done: false,
  },
  {
    title: 'Tab: NPR Renderer',
    tabId: 'npr',
    body: 'Group: Rendering\n\nVerify:\n• Non-photoreal style is visibly applied\n• Any toggles produce distinctly different looks\n• No z-fighting or seams between layers',
    done: false,
  },
  {
    title: 'Tab: Tree Symbol',
    tabId: 'tree',
    body: 'Group: Rendering\n\nVerify:\n• Symbol renders with crown + shadow\n• Scales correctly under zoom (no clipping)\n• Anchors stay aligned to position',
    done: false,
  },
  {
    title: 'Tab: Wind Sway',
    tabId: 'wind',
    body: 'Group: Rendering\n\nVerify:\n• Animation loops smoothly\n• No jitter or popping at loop boundary\n• Pause/play (if exposed) works',
    done: false,
  },
  {
    title: 'Tab: Kuwahara Filter',
    tabId: 'kuwahara',
    body: 'Group: Rendering\n\nVerify:\n• Painterly effect visibly applied to site plan PNG\n• No hard artifacts at edges of the canvas\n• Effect intensity slider (if any) reacts correctly',
    done: false,
  },

  // Drawing Tools
  {
    title: 'Tab: Pen Tool',
    tabId: 'pen',
    body: 'Group: Drawing Tools\n\nVerify:\n• Click adds corner anchor\n• Alt-drag (or drag) creates smooth bezier handles\n• Clicking first anchor closes the path\n• Resulting path looks clean (no stray segments)',
    done: false,
  },
  {
    title: 'Tab: Freehand',
    tabId: 'freehand',
    body: 'Group: Drawing Tools\n\nVerify:\n• Sketch a curve — green fitted bezier overlay appears on pointer-up\n• Quality bar: an S-curve should look like Illustrator pencil output\n• If corners cut: try fitError=2; if jagged: try fitError=8 (default 4)',
    done: false,
  },
  {
    title: 'Tab: Knife Tool',
    tabId: 'knife',
    body: 'Group: Drawing Tools\n\nVerify:\n• Drawing a slice across a bed splits it into two closed shapes\n• Both halves remain selectable\n• No leftover open paths',
    done: false,
  },
  {
    title: 'Tab: Boolean Ops',
    tabId: 'bool',
    body: 'Group: Drawing Tools\n\nVerify:\n• Union, subtract, and intersect on two overlapping shapes each produce the right result\n• Result is a single closed path (not two coincident edges)\n• No self-intersections in the output',
    done: false,
  },
  {
    title: 'Tab: Dashed Lines',
    tabId: 'dash',
    body: 'Group: Drawing Tools\n\nVerify:\n• Dashes render evenly along the path\n• Dash length stays visually consistent across zoom levels\n• No gaps at corners',
    done: false,
  },

  // Interaction
  {
    title: 'Tab: Measure',
    tabId: 'measure',
    body: 'Group: Interaction\n\nVerify:\n• Distance and area readouts appear\n• Values update live while dragging endpoints\n• Units are correct (inches / feet, as configured)',
    done: false,
  },
  {
    title: 'Tab: Selection',
    tabId: 'sel',
    body: 'Group: Interaction\n\nVerify:\n• Click selects a single object\n• Shift-click multi-selects\n• Drag-marquee selects everything inside\n• Escape clears selection',
    done: false,
  },
  {
    title: 'Tab: Snapping',
    tabId: 'snap',
    body: 'Group: Interaction\n\nVerify:\n• Endpoints snap to other geometry within threshold\n• Visual indicator (dot/crosshair) appears at snap point\n• Snapping releases cleanly when you move away',
    done: false,
  },
  {
    title: 'Tab: Transform Gizmo',
    tabId: 'transform',
    body: 'Group: Interaction\n\nVerify:\n• Gizmo handles appear on selection\n• Translate, rotate, and scale all behave correctly\n• No drift after multiple operations\n• Gizmo follows selection through pan/zoom',
    done: false,
  },
  {
    title: 'Tab: Spatial Index',
    tabId: 'spatial',
    body: 'Group: Interaction\n\nVerify:\n• Hit-testing stays fast with many objects on screen\n• Selection picks the topmost item where things overlap\n• No false hits in empty space',
    done: false,
  },
  {
    title: 'Tab: Ants · Phase Math',
    tabId: 'ants',
    body: 'Group: Interaction\n\nVerify:\n• Marching ants animate around selection outline\n• Speed stays consistent across zoom levels\n• No flicker or direction reversals',
    done: false,
  },
  {
    title: 'Tab: Ants · TilingSprite',
    tabId: 'ants-tiling',
    body: 'Group: Interaction\n\nVerify:\n• Marching ants animate via TilingSprite path\n• Compare smoothness/quality against Phase Math implementation\n• Note which approach you prefer',
    done: false,
  },
  {
    title: 'Tab: Ants · Davidfig',
    tabId: 'ants-davidfig',
    body: 'Group: Interaction\n\nVerify:\n• Third marching-ants implementation animates correctly\n• Compare against the other two — pick the cleanest for production\n• Record decision in ARCHITECTURE.md',
    done: false,
  },

  // Text & UI
  {
    title: 'Tab: Text Annotation',
    tabId: 'textann',
    body: 'Group: Text & UI\n\nVerify:\n• Click on canvas adds a text annotation\n• Edit-in-place works (typing updates the rendered text)\n• Position persists across pan/zoom',
    done: false,
  },
  {
    title: 'Tab: @pixi/ui',
    tabId: 'pixiui',
    body: 'Group: Text & UI\n\nVerify:\n• Widgets (buttons, sliders, etc.) render\n• Buttons respond to click\n• Sliders update their value as expected',
    done: false,
  },

  // Viewport
  {
    title: 'Tab: Viewport',
    tabId: 'viewport',
    body: 'Group: Viewport\n\nVerify:\n• Space+drag pans the canvas\n• Mouse wheel zooms toward cursor\n• Fit-to-view (if exposed) frames all content\n• No coordinate drift after extended panning',
    done: false,
  },

  // ── Strategic / cross-tab work (carried over from v2) ─────────────────
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
  console.log('[TodoPanel] select() called with item id:', id);
  selectedId.value = selectedId.value === id ? null : id;
  const item = items.value.find(i => i.id === id);
  console.log('[TodoPanel] found item:', item?.title, '- tabId:', item?.tabId);
  if (item?.tabId) {
    console.log('[TodoPanel] emitting navigate event with tabId:', item.tabId);
    emit('navigate', item.tabId);
  }
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
        @click="() => { console.log('[TodoPanel] row clicked for item:', item.title); select(item.id); }"
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
        rows="14"
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
  display: flex;
  flex-direction: column;
  min-height: 320px;
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
  flex: 1;
  min-height: 280px;
  background: #0e0e0e;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  color: #ccc;
  font-family: monospace;
  font-size: 12px;
  padding: 10px 12px;
  resize: vertical;
  box-sizing: border-box;
  line-height: 1.6;
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
