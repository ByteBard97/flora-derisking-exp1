/**
 * Viewport coordinate conversions for the Flora canvas.
 *
 * All design positions are stored in drawing-space inches.
 * Canvas (CSS pixel) positions are derived at render time and never persisted.
 *
 * Drawing space: origin at document top-left, +x right, +y down, units = inches.
 * Canvas space: origin at Stage top-left, +x right, +y down, units = CSS pixels.
 *
 * Formula:
 *   canvas.x = drawing.x * pxPerInch * zoom + panX
 *   canvas.y = drawing.y * pxPerInch * zoom + panY
 */

export interface Point {
  x: number;
  y: number;
}

export interface ViewportState {
  /** Base pixels per inch at zoom 1.0. Typically 96 (CSS standard). */
  pxPerInch: number;
  /** Current zoom level. 1.0 = 100%, 2.0 = 200%, etc. */
  zoom: number;
  /** Horizontal pan offset in CSS pixels. */
  panX: number;
  /** Vertical pan offset in CSS pixels. */
  panY: number;
}

const IDENTITY_VIEWPORT: ViewportState = {
  pxPerInch: 96,
  zoom: 1,
  panX: 0,
  panY: 0,
};

export function drawingToCanvas(point: Point, viewport: ViewportState = IDENTITY_VIEWPORT): Point {
  const scale = viewport.pxPerInch * viewport.zoom;
  return {
    x: point.x * scale + viewport.panX,
    y: point.y * scale + viewport.panY,
  };
}

export function canvasToDrawing(point: Point, viewport: ViewportState = IDENTITY_VIEWPORT): Point {
  const scale = viewport.pxPerInch * viewport.zoom;
  return {
    x: (point.x - viewport.panX) / scale,
    y: (point.y - viewport.panY) / scale,
  };
}
