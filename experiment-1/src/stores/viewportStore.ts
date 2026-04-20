import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { DrawingPoint } from './docStore';

export interface CanvasPoint {
  x: number; // CSS pixels
  y: number; // CSS pixels
}

const PX_PER_INCH = 96;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;

export const useViewportStore = defineStore('viewport', () => {
  const zoom = ref(1);
  const panX = ref(0);
  const panY = ref(0);

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

  function applyZoom(delta: number, originX: number, originY: number): void {
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom.value * (1 - delta * 0.001)));
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
