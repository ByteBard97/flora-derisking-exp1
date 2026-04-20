<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, ref } from 'vue';
import Konva from 'konva';
import { useDocStore } from '@/stores/docStore';
import { useViewportStore } from '@/stores/viewportStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { CanvasProjection } from '@/canvas/projection/CanvasProjection';
import { loadAllSprites } from '@/canvas/projection/spriteLoader';

const containerRef = ref<HTMLDivElement | null>(null);

const docStore = useDocStore();
const viewportStore = useViewportStore();
const selectionStore = useSelectionStore();

let stage: Konva.Stage | null = null;
let backgroundLayer: Konva.Layer | null = null;
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

// Mutation counter — exposed to Playwright via window.__flora__ for M3 verification
let mutationCount = 0;
docStore.$subscribe(() => { mutationCount++; });

// SVG viewBox is 0 0 792 612 (landscape letter, 72pt/in = 11"×8.5")
const SITE_PLAN_ASPECT = 792 / 612;

function loadBackground(layer: Konva.Layer, stageW: number, stageH: number): void {
  const img = new Image();
  img.onload = () => {
    // Fit to stage width, maintain aspect ratio
    const renderW = stageW;
    const renderH = stageW / SITE_PLAN_ASPECT;
    const offsetY = (stageH - renderH) / 2;
    const konvaImg = new Konva.Image({
      image: img,
      x: 0,
      y: offsetY,
      width: renderW,
      height: renderH,
      listening: false,
    });
    layer.add(konvaImg);
    layer.cache();
    layer.batchDraw();
  };
  img.onerror = () => {
    console.warn('[Exp1] site-plan.svg failed to load — falling back to solid fill');
    const fallback = new Konva.Rect({ x: 0, y: 0, width: stageW, height: stageH, fill: '#2a3a2a' });
    layer.add(fallback);
    layer.cache();
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

  // Layer 1: background (cached, non-interactive) — 500 Alligator Dr, Venice FL
  backgroundLayer = new Konva.Layer({ listening: false });
  stage.add(backgroundLayer);
  loadBackground(backgroundLayer, w, h);

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
    viewportStore.scale,
    handleDragEnd,
    handleSelect,
  );

  // Initial render
  doReconcile();

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

  // Wheel: zoom
  stage.on('wheel', (e) => {
    e.evt.preventDefault();
    viewportStore.applyZoom(e.evt.deltaY, e.evt.clientX, e.evt.clientY);
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
  // Immediately converted to drawing coords and dispatched to Pinia.
  const canvasPos = node.position();
  const drawingPos = viewportStore.canvasToDrawing(canvasPos);
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
  projection.reconcilePlants(
    docStore.plants,
    viewportStore.drawingToCanvas,
    viewportStore.drawingRadiusToCanvas,
  );
  projection.reconcileBeds(
    docStore.beds,
    viewportStore.drawingToCanvas,
    viewportStore.scale,
  );
}

// Re-reconcile when viewport changes (pan/zoom)
watch(
  () => [viewportStore.zoom, viewportStore.panX, viewportStore.panY],
  () => doReconcile(),
);

// Re-reconcile when doc changes (drag, undo)
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
  <div style="position: relative; width: 100vw; height: 100vh;">
    <div
      ref="containerRef"
      style="width: 100%; height: 100%;"
      :style="{ cursor: spaceDown ? 'grab' : 'default' }"
    />
    <div
      style="
        position: absolute; top: 12px; left: 12px;
        background: rgba(0,0,0,0.6); color: #fff;
        padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 12px;
      "
    >
      <div>Plants: {{ docStore.plants.size }}</div>
      <div>Zoom: {{ (viewportStore.zoom * 100).toFixed(0) }}%</div>
      <div>Selected: {{ selectionStore.selectedPlantId ?? 'none' }}</div>
      <div>Undo stack: {{ docStore.undoStack.length }}/10</div>
      <div style="margin-top: 4px; color: #aaa;">
        Scroll: zoom &nbsp; Space+drag: pan &nbsp; Cmd+Z: undo
      </div>
      <div style="color: #88cc88; margin-top: 4px;">
        Background: 500 Alligator Dr, Venice FL
      </div>
    </div>
  </div>
</template>
