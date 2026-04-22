export interface Pt { x: number; y: number; }

export function snapToGrid(x: number, y: number, gridSize: number): Pt {
  return { x: Math.round(x / gridSize) * gridSize, y: Math.round(y / gridSize) * gridSize };
}

export function snapToVertex(x: number, y: number, vertices: Pt[], thresholdWorld: number): Pt | null {
  let best: Pt | null = null;
  let bestDist = thresholdWorld;
  for (const v of vertices) {
    const d = Math.hypot(x - v.x, y - v.y);
    if (d < bestDist) { bestDist = d; best = v; }
  }
  return best;
}

export function snapToEdge(
  x: number, y: number,
  edges: [Pt, Pt][],
  thresholdWorld: number,
): Pt | null {
  let best: Pt | null = null;
  let bestDist = thresholdWorld;
  for (const [a, b] of edges) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.001) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lenSq));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < bestDist) { bestDist = d; best = { x: px, y: py }; }
  }
  return best;
}
