<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, ref } from 'vue';
import Konva from 'konva';
import { useDocStore } from '@/stores/docStore';
import { useViewportStore } from '@/stores/viewportStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { CanvasProjection, PX_PER_INCH } from '@/canvas/projection/CanvasProjection';
import { loadAllSprites } from '@/canvas/projection/spriteLoader';
import { LOT_WIDTH_INCHES, LOT_HEIGHT_INCHES } from '@/stores/docStore';
import SelfTestPanel from '@/components/SelfTestPanel.vue';

const APP_START = performance.now();

const containerRef = ref<HTMLDivElement | null>(null);

const docStore = useDocStore();
const viewportStore = useViewportStore();
const selectionStore = useSelectionStore();

let stage: Konva.Stage | null = null;
let backgroundLayer: Konva.Layer | null = null;
let bgWorld: Konva.Group | null = null;
let bedLayer: Konva.Layer | null = null;
let plantLayer: Konva.Layer | null = null;
let transformer: Konva.Transformer | null = null;
let projection: CanvasProjection | null = null;

// Pan state
let isPanning = false;
let lastPointerX = 0;
let lastPointerY = 0;

// Keyboard state
const spaceDown = ref(false);
const ttiMs = ref<number | null>(null);
const pinchSensitivity = ref(0.04);  // ctrlKey pinch zoom
const panSpeed = ref(1.0);           // two-finger scroll pan multiplier

// Mutation counter — exposed to Playwright via window.__flora__ for M3 verification
let mutationCount = 0;
docStore.$subscribe(() => { mutationCount++; });

// Background covers the lot in drawing-space pixels so it zooms/pans with plants.
const BG_W = LOT_WIDTH_INCHES * PX_PER_INCH;
const BG_H = LOT_HEIGHT_INCHES * PX_PER_INCH;

function loadBackground(worldGroup: Konva.Group, layer: Konva.Layer): void {
  const img = new Image();
  img.onload = () => {
    worldGroup.add(new Konva.Image({
      image: img,
      x: 0, y: 0,
      width: BG_W, height: BG_H,
      listening: false,
    }));
    layer.batchDraw();
  };
  img.onerror = () => {
    console.warn('[Exp1] site-plan.svg failed to load — falling back to solid fill');
    worldGroup.add(new Konva.Rect({ x: 0, y: 0, width: BG_W, height: BG_H, fill: '#2a3a2a' }));
    layer.batchDraw();
  };
  img.src = '/site-plan.svg';
}

onMounted(async () => {
  // Load all species sprites before first render so nodes show images immediately.
  await loadAllSprites();

  const container = containerRef.value!;
  const w = container.offsetWidth;
  const h = container.offsetHeight;

  stage = new Konva.Stage({ container, width: w, height: h });

  // Layer 1: background (non-interactive) — 500 Alligator Dr, Venice FL
  backgroundLayer = new Konva.Layer({ listening: false });
  stage.add(backgroundLayer);
  bgWorld = new Konva.Group();
  backgroundLayer.add(bgWorld);
  loadBackground(bgWorld, backgroundLayer);

  // Layer 2: beds
  bedLayer = new Konva.Layer();
  stage.add(bedLayer);

  // Layer 3: plants
  plantLayer = new Konva.Layer();
  stage.add(plantLayer);

  // Transformer for selected plant
  transformer = new Konva.Transformer({
    rotateEnabled: false,
    borderStroke: '#00aaff',
    anchorStroke: '#00aaff',
    anchorFill: '#ffffff',
  });
  plantLayer.add(transformer);

  projection = new CanvasProjection(
    plantLayer,
    bedLayer,
    handleDragEnd,
    handleSelect,
  );

  // Initial render — position nodes in drawing space, then apply viewport transform
  doReconcile();
  projection.updateViewport(viewportStore.zoom, viewportStore.panX, viewportStore.panY);
  bgWorld!.scale({ x: viewportStore.zoom, y: viewportStore.zoom });
  bgWorld!.position({ x: viewportStore.panX, y: viewportStore.panY });
  ttiMs.value = performance.now() - APP_START;

  // Dev/test hooks — Playwright reads these to verify measurements without human eyes.
  if (import.meta.env.DEV) {
    (window as any).__flora__ = {
      getPlantCount: () => docStore.plants.size,
      // Returns number of Konva nodes actually on the plant layer — confirms reconciliation done.
      getKonvaNodeCount: () => plantLayer?.getChildren().length ?? 0,
      getPlantIds: () => [...docStore.plants.keys()],
      getPlantPosition: (id: string) => docStore.plants.get(id)?.position ?? null,
      // Returns stage-relative pixel position of a plant — for Playwright click targeting.
      getPlantCanvasPos: (id: string) => {
        const plant = docStore.plants.get(id);
        if (!plant) return null;
        return viewportStore.drawingToCanvas(plant.position);
      },
      // Fire a programmatic drag on a node — bypasses browser synthetic-event limitations.
      programmaticDrag: (id: string, dxInches: number, dyInches: number): boolean => {
        const plant = docStore.plants.get(id);
        if (!plant) return false;
        docStore.updatePlantPosition(id, {
          x: plant.position.x + dxInches,
          y: plant.position.y + dyInches,
        });
        return true;
      },
      getMutationCount: () => mutationCount,
      resetMutationCount: () => { mutationCount = 0; },
      undo: () => docStore.undo(),
    };
  }

  // Pinch (ctrlKey) → zoom. Two-finger scroll → pan.
  stage.on('wheel', (e) => {
    e.evt.preventDefault();
    if (e.evt.ctrlKey) {
      viewportStore.applyZoom(e.evt.deltaY, e.evt.clientX, e.evt.clientY, pinchSensitivity.value);
    } else {
      viewportStore.applyPan(-e.evt.deltaX * panSpeed.value, -e.evt.deltaY * panSpeed.value);
    }
  });

  // Pan: space+drag or middle-mouse
  stage.on('mousedown', (e) => {
    if (spaceDown.value || e.evt.button === 1) {
      isPanning = true;
      lastPointerX = e.evt.clientX;
      lastPointerY = e.evt.clientY;
    }
  });
  stage.on('mousemove', (e) => {
    if (!isPanning) return;
    viewportStore.applyPan(
      e.evt.clientX - lastPointerX,
      e.evt.clientY - lastPointerY,
    );
    lastPointerX = e.evt.clientX;
    lastPointerY = e.evt.clientY;
  });
  stage.on('mouseup', () => { isPanning = false; });

  // Deselect on stage click
  stage.on('click', (e) => {
    if (e.target === stage) selectionStore.clearSelection();
  });

  // Keyboard: space key, undo
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  // Resize
  const resizeObserver = new ResizeObserver(() => {
    if (!stage || !container) return;
    stage.width(container.offsetWidth);
    stage.height(container.offsetHeight);
  });
  resizeObserver.observe(container);
});

function handleDragEnd(plantId: string, node: Konva.Group): void {
  // Drag-harvest: the ONE permitted Konva state read.
  // node.position() is in world-group local coords (drawing-space pixels).
  // Divide by PX_PER_INCH to get drawing-space inches.
  const localPos = node.position();
  const drawingPos = { x: localPos.x / PX_PER_INCH, y: localPos.y / PX_PER_INCH };
  docStore.updatePlantPosition(plantId, drawingPos);

  if (import.meta.env.DEV) {
    projection?.assertConsistency(docStore.plants);
  }
}

function handleSelect(plantId: string): void {
  selectionStore.selectPlant(plantId);
  const node = projection?.getNodeForPlant(plantId);
  if (node && transformer) {
    transformer.nodes([node]);
    plantLayer?.batchDraw();
  }
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.code === 'Space') {
    e.preventDefault();
    spaceDown.value = true;
  }
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
    docStore.undo();
  }
}

function handleKeyUp(e: KeyboardEvent): void {
  if (e.code === 'Space') spaceDown.value = false;
}

function doReconcile(): void {
  if (!projection) return;
  projection.reconcilePlants(docStore.plants);
  projection.reconcileBeds(docStore.beds);
}

// Viewport changes: update world-group transform only — no node iteration.
watch(
  () => [viewportStore.zoom, viewportStore.panX, viewportStore.panY],
  () => {
    const { zoom, panX, panY } = viewportStore;
    projection?.updateViewport(zoom, panX, panY);
    if (bgWorld) {
      bgWorld.scale({ x: zoom, y: zoom });
      bgWorld.position({ x: panX, y: panY });
      backgroundLayer?.batchDraw();
    }
  },
);

// Doc changes (drag commit, undo): reconcile node positions.
watch(
  () => docStore.plants,
  () => {
    doReconcile();
    if (import.meta.env.DEV) projection?.assertConsistency(docStore.plants);
  },
  { deep: true },
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('keyup', handleKeyUp);
  stage?.destroy();
});
</script>

<template>
  <div role="main" style="position: relative; width: 100vw; height: 100vh;">
    <SelfTestPanel :tti-ms="ttiMs" :get-konva-node-count="() => plantLayer?.getChildren().length ?? 0" />
    <div
      ref="containerRef"
      data-testid="canvas-container"
      style="width: 100%; height: 100%;"
      :style="{ cursor: spaceDown ? 'grab' : 'default' }"
    />
    <aside
      role="complementary"
      aria-label="Canvas stats"
      style="
        position: absolute; top: 12px; left: 12px;
        background: rgba(0,0,0,0.6); color: #fff;
        padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 12px;
      "
    >
      <div data-testid="stat-plants">Plants: {{ docStore.plants.size }}</div>
      <div data-testid="stat-zoom">Zoom: {{ (viewportStore.zoom * 100).toFixed(0) }}%</div>
      <div data-testid="stat-selected">Selected: {{ selectionStore.selectedPlantId ?? 'none' }}</div>
      <div data-testid="stat-undo-stack">Undo stack: {{ docStore.undoStack.length }}/10</div>
      <div style="margin-top: 6px; color: #aaa; font-size: 11px;">
        Pinch: zoom &nbsp; 2-finger scroll: pan &nbsp; Cmd+Z: undo
      </div>
      <div style="margin-top: 8px; display: grid; grid-template-columns: auto 1fr auto; gap: 4px 6px; align-items: center; font-size: 11px; color: #ccc;">
        <label>Pinch</label>
        <input type="range" v-model.number="pinchSensitivity" min="0.005" max="0.12" step="0.005" style="width: 100%;" />
        <span>{{ pinchSensitivity.toFixed(3) }}</span>
        <label>Pan</label>
        <input type="range" v-model.number="panSpeed" min="0.3" max="3.0" step="0.1" style="width: 100%;" />
        <span>{{ panSpeed.toFixed(1) }}×</span>
      </div>
      <div data-testid="site-label" style="color: #88cc88; margin-top: 6px;">
        Background: 500 Alligator Dr, Venice FL
      </div>
    </aside>
  </div>
</template>
