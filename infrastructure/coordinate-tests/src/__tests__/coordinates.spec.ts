import { describe, it, expect } from 'vitest';
import { drawingToCanvas, canvasToDrawing, type Point, type ViewportState } from '../viewport';

const EPSILON = 0.0001; // inches — maximum allowed round-trip error

function approxEqual(a: Point, b: Point, eps = EPSILON): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

function expectPointsClose(actual: Point, expected: Point, eps = EPSILON): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(eps);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(eps);
}

const BASE_VIEWPORT: ViewportState = { pxPerInch: 96, zoom: 1, panX: 0, panY: 0 };

// Representative drawing points covering the required test cases.
const TEST_POINTS: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
  { x: 4, y: 6 }, // integer feet
  { x: 4.5, y: 3.75 }, // fractional — typical "4'6\"" spacing
  { x: 0.1, y: 0.2 }, // 0.1 + 0.2 floating-point hazard
  { x: 12, y: 18 }, // large lot dimension
  { x: 0.0833333, y: 0.0833333 }, // 1 inch in feet
  { x: -1, y: -2 }, // negative — parcel may not start at origin
  { x: -4.5, y: 0 }, // negative x only
  { x: 0, y: -3.25 }, // negative y only
  { x: 100, y: 80 }, // large values
  { x: 0.001, y: 0.001 }, // very small
];

describe('drawingToCanvas', () => {
  it('known-value: at default viewport (zoom=1, pxPerInch=96, pan=0), 1 drawing-inch = 96 canvas pixels', () => {
    const result = drawingToCanvas({ x: 1, y: 1 }, BASE_VIEWPORT);
    expect(result.x).toBeCloseTo(96, 5);
    expect(result.y).toBeCloseTo(96, 5);
  });

  it('known-value: origin maps to origin at zero pan', () => {
    const result = drawingToCanvas({ x: 0, y: 0 }, BASE_VIEWPORT);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('known-value: 4.5 drawing-inches at default viewport = 432 canvas pixels', () => {
    const result = drawingToCanvas({ x: 4.5, y: 4.5 }, BASE_VIEWPORT);
    expect(result.x).toBeCloseTo(432, 5);
    expect(result.y).toBeCloseTo(432, 5);
  });

  it('applies zoom correctly: zoom=2 doubles pixel distances', () => {
    const zoomed: ViewportState = { ...BASE_VIEWPORT, zoom: 2 };
    const result = drawingToCanvas({ x: 1, y: 1 }, zoomed);
    expect(result.x).toBeCloseTo(192, 5);
    expect(result.y).toBeCloseTo(192, 5);
  });

  it('applies pan offset correctly', () => {
    const panned: ViewportState = { ...BASE_VIEWPORT, panX: 100, panY: -50 };
    const result = drawingToCanvas({ x: 1, y: 1 }, panned);
    expect(result.x).toBeCloseTo(196, 5);
    expect(result.y).toBeCloseTo(46, 5);
  });

  it('handles negative drawing coordinates', () => {
    const result = drawingToCanvas({ x: -1, y: -2 }, BASE_VIEWPORT);
    expect(result.x).toBeCloseTo(-96, 5);
    expect(result.y).toBeCloseTo(-192, 5);
  });
});

describe('canvasToDrawing', () => {
  it('known-value: 96 canvas pixels at default viewport = 1 drawing-inch', () => {
    const result = canvasToDrawing({ x: 96, y: 96 }, BASE_VIEWPORT);
    expect(result.x).toBeCloseTo(1, 5);
    expect(result.y).toBeCloseTo(1, 5);
  });

  it('known-value: canvas origin maps to drawing origin at zero pan', () => {
    const result = canvasToDrawing({ x: 0, y: 0 }, BASE_VIEWPORT);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('reverses zoom correctly', () => {
    const zoomed: ViewportState = { ...BASE_VIEWPORT, zoom: 2 };
    const result = canvasToDrawing({ x: 192, y: 192 }, zoomed);
    expect(result.x).toBeCloseTo(1, 5);
    expect(result.y).toBeCloseTo(1, 5);
  });

  it('reverses pan offset correctly', () => {
    const panned: ViewportState = { ...BASE_VIEWPORT, panX: 100, panY: -50 };
    const result = canvasToDrawing({ x: 196, y: 46 }, panned);
    expect(result.x).toBeCloseTo(1, 5);
    expect(result.y).toBeCloseTo(1, 5);
  });
});

describe('round-trip identity', () => {
  it('drawing→canvas→drawing preserves all test points within epsilon', () => {
    for (const pt of TEST_POINTS) {
      const canvas = drawingToCanvas(pt, BASE_VIEWPORT);
      const back = canvasToDrawing(canvas, BASE_VIEWPORT);
      expect(approxEqual(pt, back)).toBe(true);
    }
  });

  it('round-trip holds at zoom=0.25 (zoomed out)', () => {
    const viewport: ViewportState = { ...BASE_VIEWPORT, zoom: 0.25 };
    for (const pt of TEST_POINTS) {
      const canvas = drawingToCanvas(pt, viewport);
      const back = canvasToDrawing(canvas, viewport);
      expect(approxEqual(pt, back)).toBe(true);
    }
  });

  it('round-trip holds at zoom=4 (zoomed in)', () => {
    const viewport: ViewportState = { ...BASE_VIEWPORT, zoom: 4 };
    for (const pt of TEST_POINTS) {
      const canvas = drawingToCanvas(pt, viewport);
      const back = canvasToDrawing(canvas, viewport);
      expect(approxEqual(pt, back)).toBe(true);
    }
  });

  it('round-trip holds with large pan offsets', () => {
    const viewport: ViewportState = { ...BASE_VIEWPORT, panX: 1500, panY: -800 };
    for (const pt of TEST_POINTS) {
      const canvas = drawingToCanvas(pt, viewport);
      const back = canvasToDrawing(canvas, viewport);
      expect(approxEqual(pt, back)).toBe(true);
    }
  });
});

describe('scale invariance', () => {
  it('same drawing point at different zoom levels always round-trips to the same drawing point', () => {
    const pt = { x: 4.5, y: 3.75 };
    const zooms = [0.1, 0.25, 0.5, 1, 1.5, 2, 4, 8];
    for (const zoom of zooms) {
      const viewport: ViewportState = { ...BASE_VIEWPORT, zoom };
      const canvas = drawingToCanvas(pt, viewport);
      const back = canvasToDrawing(canvas, viewport);
      expectPointsClose(back, pt);
    }
  });
});

describe('pan invariance', () => {
  it('same drawing point at different pan offsets always round-trips to the same drawing point', () => {
    const pt = { x: 4.5, y: 3.75 };
    const pans: [number, number][] = [
      [0, 0],
      [500, 300],
      [-200, 100],
      [1000, -1000],
    ];
    for (const [panX, panY] of pans) {
      const viewport: ViewportState = { ...BASE_VIEWPORT, panX, panY };
      const canvas = drawingToCanvas(pt, viewport);
      const back = canvasToDrawing(canvas, viewport);
      expectPointsClose(back, pt);
    }
  });
});

describe('floating-point hazard cases', () => {
  it('0.1 + 0.2 round-trips cleanly within epsilon', () => {
    const pt = { x: 0.1 + 0.2, y: 0.1 + 0.2 }; // 0.30000000000000004 in JS
    const canvas = drawingToCanvas(pt, BASE_VIEWPORT);
    const back = canvasToDrawing(canvas, BASE_VIEWPORT);
    expectPointsClose(back, pt);
  });

  it('very small values round-trip without underflow', () => {
    const pt = { x: 0.001, y: 0.001 };
    const canvas = drawingToCanvas(pt, BASE_VIEWPORT);
    const back = canvasToDrawing(canvas, BASE_VIEWPORT);
    expectPointsClose(back, pt);
  });
});
