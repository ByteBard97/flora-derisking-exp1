// src/lib/measureUtils.ts
import { Bezier } from 'bezier-js';

export interface Point { x: number; y: number }

/** Euclidean distance between two points in canvas pixels. */
export function euclideanPx(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Convert canvas pixels to real-world feet.
 * @param px          Distance in canvas pixels
 * @param pxPerInch   Screen resolution (default 96)
 * @param ftPerInch   Drawing scale: real-world feet per canvas inch (e.g. 20 for 1"=20')
 */
export function pxToFeet(px: number, pxPerInch = 96, ftPerInch = 20): number {
  return (px / pxPerInch) * ftPerInch;
}

/**
 * Shoelace formula — signed area of a polygon in canvas pixels².
 * Returns absolute value (unsigned). Pass vertices in order.
 * Treat the cursor position as the final unclosed vertex during live preview.
 */
export function polygonAreaPx(pts: Point[]): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += pts[i].x * pts[j].y;
    sum -= pts[j].x * pts[i].y;
  }
  return Math.abs(sum) / 2;
}

/** Convert pixel² area to square feet. */
export function pxSqToSqFt(pxSq: number, pxPerInch = 96, ftPerInch = 20): number {
  const inSq = pxSq / (pxPerInch * pxPerInch);
  return inSq * (ftPerInch * ftPerInch);
}

/**
 * Arc length of a cubic bezier segment in canvas pixels.
 * Uses bezier-js .length() which internally does adaptive subdivision.
 * @param p0  Anchor start
 * @param cp1 Control point 1 (out-handle of p0)
 * @param cp2 Control point 2 (in-handle of p1)
 * @param p1  Anchor end
 */
export function bezierSegmentLengthPx(
  p0: Point, cp1: Point, cp2: Point, p1: Point,
): number {
  const b = new Bezier(p0.x, p0.y, cp1.x, cp1.y, cp2.x, cp2.y, p1.x, p1.y);
  return b.length();
}

/**
 * Total arc length of a closed or open path defined as an array of cubic bezier segments.
 * Each segment: { p0, cp1, cp2, p1 }
 */
export interface CubicSegment { p0: Point; cp1: Point; cp2: Point; p1: Point }

export function pathLengthPx(segments: CubicSegment[]): number {
  return segments.reduce((sum, s) => sum + bezierSegmentLengthPx(s.p0, s.cp1, s.cp2, s.p1), 0);
}

/** Midpoint between two points (for line label positioning). */
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Centroid of a polygon (for area label positioning). */
export function centroid(pts: Point[]): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}

/** Format feet as "X' Y\"" (feet and inches). */
export function formatFeet(ft: number): string {
  const wholeFt = Math.floor(ft);
  const inches = Math.round((ft - wholeFt) * 12);
  if (inches === 0) return `${wholeFt}'`;
  if (inches === 12) return `${wholeFt + 1}'`;
  return `${wholeFt}' ${inches}"`;
}

/** Format square feet as "X sq ft". */
export function formatSqFt(sqFt: number): string {
  return sqFt < 1000
    ? `${sqFt.toFixed(1)} sq ft`
    : `${(sqFt / 1000).toFixed(2)}k sq ft`;
}
