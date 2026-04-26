// src/lib/pathFit.ts
import simplify from 'simplify-js';
import fitCurve from 'fit-curve';

export interface Point { x: number; y: number }

/**
 * Cubic bezier segment as [p0, cp1, cp2, p1] — same tuple format fit-curve returns.
 * Each element is [x, y].
 */
export type BezierTuple = [[number,number],[number,number],[number,number],[number,number]];

/**
 * Reduce a raw point cloud to a smooth bezier path.
 *
 * @param rawPoints   Input points from freehand drawing
 * @param tolerance   RDP tolerance in pixels (higher = fewer points, looser fit; default 2.5)
 * @param fitError    fit-curve max error in pixels (higher = smoother but less accurate; default 4)
 * @returns           Array of cubic bezier segments as tuples
 */
export function fitBezierPath(
  rawPoints: Point[],
  tolerance = 2.5,
  fitError = 4,
): BezierTuple[] {
  if (rawPoints.length < 2) return [];

  // Step 1: RDP simplification — reduce point count while preserving shape
  const simplified = simplify(rawPoints, tolerance, true);

  if (simplified.length < 2) return [];

  // Step 2: Convert to [x, y] tuples for fit-curve
  const pts: [number, number][] = simplified.map(p => [p.x, p.y]);

  // Step 3: Fit cubic bezier curves through simplified points
  return fitCurve(pts, fitError) as BezierTuple[];
}

/**
 * Draw a fitted bezier path into a Pixi Graphics object.
 * Clears the graphics first.
 * @param gfx       Pixi Graphics to draw into
 * @param segments  Output of fitBezierPath
 * @param color     Stroke color (default green)
 */
export function drawFittedPath(
  gfx: import('pixi.js').Graphics,
  segments: BezierTuple[],
  color = 0x00ff88,
): void {
  gfx.clear();
  if (segments.length === 0) return;
  gfx.setStrokeStyle({ width: 2, color });
  gfx.moveTo(segments[0][0][0], segments[0][0][1]);
  for (const [, cp1, cp2, p1] of segments) {
    gfx.bezierCurveTo(cp1[0], cp1[1], cp2[0], cp2[1], p1[0], p1[1]);
  }
  gfx.stroke();
}
