<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, ref } from 'vue';
import Konva from 'konva';
import { useDocStore } from '@/stores/docStore';
import { useViewportStore } from '@/stores/viewportStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { CanvasProjection } from '@/canvas/projection/CanvasProjection';

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

onMounted(() => {
  const container = containerRef.value!;
  const w = container.offsetWidth;
  const h = container.offsetHeight;

  stage = new Konva.Stage({ container, width: w, height: h });

  // Layer 1: background (cached, non-interactive)
  backgroundLayer = new Konva.Layer({ listening: false });
  const bgRect = new Konva.Rect({
    x: 0,
    y: 0,
    width: w,
    height: h,
    fill: '#2a3a2a',
    listening: false,
  });
  backgroundLayer.add(bgRect);
  // TODO: replace bgRect with real backend-generated composite PNG (required before measurement)
  backgroundLayer.cache();
  stage.add(backgroundLayer);

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
      <div style="color: #ff9900; margin-top: 4px;">
        Background: PLACEHOLDER — replace with real lot PNG before measurement
      </div>
    </div>
  </div>
</template>
