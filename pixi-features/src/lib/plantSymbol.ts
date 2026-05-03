/**
 * Plant symbol renderer — turns silhouette polygons into a styled Pixi container
 * matching landscape-architect plan-view conventions:
 *
 *   - Drop shadow (offset, blurred, tinted)
 *   - Filled blob (paletteColor, slightly desaturated)
 *   - Wobbly inked outline (jittered along normals)
 *
 * Pure scene-graph. Watercolor wash + paper grain happen in a later filter pass.
 */

import { Container, Graphics } from 'pixi.js'
import type { Silhouette, Vec2 } from './silhouette'
import { WatercolorFillFilter, type WatercolorFillParams } from './filters/WatercolorFillFilter'

export interface PlantSymbolParams {
  /** Display radius in scene-graph pixels — symbol is fit inside a circle of this radius. */
  displayRadius: number
  /** Hex like 0x4a7a3e. Falls back to a sage default if nullish. */
  fillColor: number
  /** Fill alpha in [0, 1]. */
  fillAlpha: number
  /** Stroke color. Near-black for inked-cluster style, darker green for watercolor-faded. */
  strokeColor: number
  /** Stroke width in pixels. */
  strokeWidth: number
  /** Outline jitter amplitude in pixels. 0 = perfectly clean, 4–8 = sketchy. */
  outlineJitterPx: number
  /** Drop shadow offset. Set both to 0 to disable. */
  shadowOffsetX: number
  shadowOffsetY: number
  shadowAlpha: number
  shadowColor: number
  /** Watercolor wash applied to fill only. Set to null to skip the filter. */
  watercolor: WatercolorFillParams | null
}

const WATERCOLOR_INKED: WatercolorFillParams = {
  pigmentStrength: 0.45,    // subtle — Preston Montague pages have flatter washes
  pigmentScale: 6.0,
  edgeDarkenStrength: 0.55, // visible pigment pooling at outline
  edgeDarkenRadius: 3.5,
  paperGrainStrength: 0.14,
  paperGrainScale: 70.0,
}

const WATERCOLOR_FADED: WatercolorFillParams = {
  pigmentStrength: 0.75,    // strong patchy wash — Wild Ones reference
  pigmentScale: 8.0,
  edgeDarkenStrength: 0.8,  // pronounced edge pooling
  edgeDarkenRadius: 5.0,
  paperGrainStrength: 0.22,
  paperGrainScale: 55.0,
}

export const DEFAULT_INKED_CLUSTER: PlantSymbolParams = {
  displayRadius: 60,
  fillColor: 0x6b8e5a,
  fillAlpha: 0.85,
  strokeColor: 0x1a1f15,
  strokeWidth: 2,
  outlineJitterPx: 1.5,
  shadowOffsetX: 4,
  shadowOffsetY: 6,
  shadowAlpha: 0.25,
  shadowColor: 0x2a3340,
  watercolor: WATERCOLOR_INKED,
}

export const DEFAULT_WATERCOLOR_FADED: PlantSymbolParams = {
  displayRadius: 60,
  fillColor: 0x8fa67a,
  fillAlpha: 0.7,
  strokeColor: 0x4a5a3e,
  strokeWidth: 1,
  outlineJitterPx: 2.5,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowAlpha: 0,
  shadowColor: 0x000000,
  watercolor: WATERCOLOR_FADED,
}

export function createPlantSymbol(silhouette: Silhouette, params: PlantSymbolParams): Container {
  const container = new Container()
  if (silhouette.polygons.length === 0) return container

  const normalized = silhouette.polygons.map(poly =>
    normalizeToRadius(poly, silhouette.rasterSize, params.displayRadius),
  )

  if (params.shadowAlpha > 0 && (params.shadowOffsetX !== 0 || params.shadowOffsetY !== 0)) {
    const shadow = new Graphics()
    for (const poly of normalized) {
      drawPolygonPath(shadow, poly)
      shadow.fill({ color: params.shadowColor, alpha: params.shadowAlpha })
    }
    shadow.position.set(params.shadowOffsetX, params.shadowOffsetY)
    container.addChild(shadow)
  }

  const fill = new Graphics()
  for (const poly of normalized) {
    drawPolygonPath(fill, poly)
    fill.fill({ color: params.fillColor, alpha: params.fillAlpha })
  }
  if (params.watercolor) {
    fill.filters = [new WatercolorFillFilter(params.watercolor)]
  }
  container.addChild(fill)

  const outline = new Graphics()
  for (const poly of normalized) {
    const jittered = params.outlineJitterPx > 0
      ? jitterAlongNormals(poly, params.outlineJitterPx)
      : poly
    drawPolygonPath(outline, jittered)
    outline.stroke({ color: params.strokeColor, width: params.strokeWidth, alpha: 1 })
  }
  container.addChild(outline)

  return container
}

/** Maps polygon from raster space (0..rasterSize) to centered scene-graph space. */
function normalizeToRadius(poly: Vec2[], rasterSize: number, displayRadius: number): Vec2[] {
  const half = rasterSize / 2
  const scale = displayRadius / half
  return poly.map(p => ({ x: (p.x - half) * scale, y: (p.y - half) * scale }))
}

function drawPolygonPath(g: Graphics, poly: Vec2[]) {
  if (poly.length < 3) return
  g.moveTo(poly[0].x, poly[0].y)
  for (let i = 1; i < poly.length; i++) {
    g.lineTo(poly[i].x, poly[i].y)
  }
  g.closePath()
}

/**
 * Perturbs each vertex along its outward normal by a smoothly-varying noise
 * function. Produces hand-drawn wobble without high-frequency jitter.
 */
function jitterAlongNormals(poly: Vec2[], amplitude: number): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i - 1 + poly.length) % poly.length]
    const next = poly[(i + 1) % poly.length]
    const tx = next.x - prev.x
    const ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    const nx = -ty / len
    const ny = tx / len
    const noise = smoothNoise(i * 0.31)
    out.push({
      x: poly[i].x + nx * noise * amplitude,
      y: poly[i].y + ny * noise * amplitude,
    })
  }
  return out
}

/** Stable pseudo-noise in [-1, 1]. Hash the index, smooth across neighbors. */
function smoothNoise(t: number): number {
  const a = hashFract(Math.floor(t))
  const b = hashFract(Math.floor(t) + 1)
  const f = t - Math.floor(t)
  const blend = f * f * (3 - 2 * f)
  return (a + (b - a) * blend) * 2 - 1
}

function hashFract(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
