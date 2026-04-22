import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { DrawingPoint } from './docStore';

export interface CanvasPoint {
  x: number; // CSS pixels
  y: number; // CSS pixels
}

const PX_PER_INCH = 96;
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 10;

// Default zoom fits a 120"×180" lot into a ~1280×720 viewport.
// 120 * 96 * 0.08 = 921px — lot width fits in 1280px window.
// Plant radius 2" → 15px at this zoom: visible and draggable.
const DEFAULT_ZOOM = 0.08;

export const useViewportStore = defineStore('viewport', () => {
  const zoom = ref(DEFAULT_ZOOM);
  const panX = ref(20); // small padding from left edge
  const panY = ref(20);

  const scale = computed(() => PX_PER_INCH * zoom.value);

  /** Convert drawing-space inches to canvas CSS pixels. */
  function drawingToCanvas(pt: DrawingPoint): CanvasPoint {
    return {
      x: pt.x * scale.value + panX.value,
      y: pt.y * scale.value + panY.value,
    };
  }

  /** Convert canvas CSS pixels to drawing-space inches. */
  function canvasToDrawing(pt: CanvasPoint): DrawingPoint {
    return {
      x: (pt.x - panX.value) / scale.value,
      y: (pt.y - panY.value) / scale.value,
    };
  }

  /** Convert a drawing-space radius (inches) to canvas pixels. */
  function drawingRadiusToCanvas(r: number): number {
    return r * scale.value;
  }

  function applyZoom(delta: number, originX: number, originY: number, sensitivity = 0.001): void {
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom.value * (1 - delta * sensitivity)));
    const factor = newZoom / zoom.value;
    panX.value = originX - factor * (originX - panX.value);
    panY.value = originY - factor * (originY - panY.value);
    zoom.value = newZoom;
  }

  function applyPan(dx: number, dy: number): void {
    panX.value += dx;
    panY.value += dy;
  }

  return {
    zoom,
    panX,
    panY,
    scale,
    drawingToCanvas,
    canvasToDrawing,
    drawingRadiusToCanvas,
    applyZoom,
    applyPan,
  };
});
