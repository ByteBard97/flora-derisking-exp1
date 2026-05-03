/**
 * Silhouette extractor: SVG → simplified polygon(s).
 *
 * Pipeline:
 *   1. Rasterize SVG onto a canvas at fixed resolution.
 *   2. Optionally dilate the alpha channel via a separable box blur + threshold,
 *      so scattered detail (multi-flower plants, sparse leaves) fuses into a
 *      single mass blob — matching Annie's reference style.
 *   3. Marching squares on the alpha channel produces one closed polygon per
 *      connected blob.
 *   4. Ramer–Douglas–Peucker simplify drops near-collinear vertices.
 */

import simplify from 'simplify-js'
import {
  readSilhouetteFromCache,
  writeSilhouetteToCache,
  silhouetteKey,
} from './plantCache'

export interface Vec2 {
  x: number
  y: number
}

export interface Silhouette {
  /** Polygons in pixel space (raster size). One per connected blob, largest first. */
  polygons: Vec2[][]
  /** The raster size used for extraction; callers should normalize to this. */
  rasterSize: number
}

export interface SilhouetteOptions {
  /** Side length of the square raster used for tracing. */
  rasterSize?: number
  /** Box-blur radius applied to alpha before thresholding. 0 = no dilation. */
  dilationPx?: number
  /** Alpha cutoff in [0, 255] for the binary mask. */
  alphaThreshold?: number
  /** RDP tolerance in pixels. Larger = fewer vertices. */
  simplifyTolerance?: number
  /** Discard blobs smaller than this many pixels. */
  minBlobAreaPx?: number
}

const DEFAULT_OPTIONS: Required<SilhouetteOptions> = {
  rasterSize: 512,
  dilationPx: 4,
  alphaThreshold: 32,
  simplifyTolerance: 1.5,
  minBlobAreaPx: 200,
}

export async function extractSilhouette(
  svgString: string,
  options: SilhouetteOptions = {},
  /** Optional plantId enables IDB caching (key includes dilation + tolerance). */
  cachePlantId?: number,
): Promise<Silhouette> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  const cacheKey = cachePlantId !== undefined
    ? silhouetteKey(cachePlantId, opts.dilationPx, opts.simplifyTolerance)
    : null

  if (cacheKey) {
    const cached = await readSilhouetteFromCache(cacheKey)
    if (cached) return cached
  }

  const alpha = await rasterizeSvgToAlpha(svgString, opts.rasterSize)
  const dilated = opts.dilationPx > 0 ? boxBlurAlpha(alpha, opts.rasterSize, opts.dilationPx) : alpha
  const binary = thresholdAlpha(dilated, opts.alphaThreshold)
  const rawPolygons = traceBlobs(binary, opts.rasterSize, opts.minBlobAreaPx)
  const simplified = rawPolygons.map(poly =>
    simplify(poly, opts.simplifyTolerance, true),
  )
  simplified.sort((a, b) => polygonArea(b) - polygonArea(a))
  const result = { polygons: simplified, rasterSize: opts.rasterSize }

  if (cacheKey) {
    await writeSilhouetteToCache(cacheKey, result.polygons, result.rasterSize)
  }
  return result
}

/* ------------------------------------------------------------------ */
/* Rasterize SVG → Uint8Array of alpha values, length = size * size   */
/* ------------------------------------------------------------------ */

async function rasterizeSvgToAlpha(svgString: string, size: number): Promise<Uint8Array> {
  const blob = new Blob([svgString], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load SVG'))
      img.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D context unavailable')

    // Fit aspect-correctly, centered. Plants in the Flora library are top-down
    // and roughly square but not always.
    const aspect = img.naturalWidth / img.naturalHeight
    const drawW = aspect >= 1 ? size : size * aspect
    const drawH = aspect >= 1 ? size / aspect : size
    const dx = (size - drawW) / 2
    const dy = (size - drawH) / 2
    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(img, dx, dy, drawW, drawH)

    const pixels = ctx.getImageData(0, 0, size, size).data
    const alpha = new Uint8Array(size * size)
    for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3]
    return alpha
  } finally {
    URL.revokeObjectURL(url)
  }
}

/* ------------------------------------------------------------------ */
/* Separable box blur on a single-channel buffer                       */
/* ------------------------------------------------------------------ */

function boxBlurAlpha(src: Uint8Array, size: number, radius: number): Uint8Array {
  const horizontal = new Uint8Array(src.length)
  const out = new Uint8Array(src.length)
  const window = radius * 2 + 1

  for (let y = 0; y < size; y++) {
    let sum = 0
    for (let x = -radius; x <= radius; x++) {
      sum += src[y * size + clamp(x, 0, size - 1)]
    }
    for (let x = 0; x < size; x++) {
      horizontal[y * size + x] = sum / window
      const xRemove = clamp(x - radius, 0, size - 1)
      const xAdd = clamp(x + radius + 1, 0, size - 1)
      sum += src[y * size + xAdd] - src[y * size + xRemove]
    }
  }

  for (let x = 0; x < size; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) {
      sum += horizontal[clamp(y, 0, size - 1) * size + x]
    }
    for (let y = 0; y < size; y++) {
      out[y * size + x] = sum / window
      const yRemove = clamp(y - radius, 0, size - 1)
      const yAdd = clamp(y + radius + 1, 0, size - 1)
      sum += horizontal[yAdd * size + x] - horizontal[yRemove * size + x]
    }
  }
  return out
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}

function thresholdAlpha(src: Uint8Array, cutoff: number): Uint8Array {
  const out = new Uint8Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i] >= cutoff ? 1 : 0
  return out
}

/* ------------------------------------------------------------------ */
/* Connected-component labeling + Moore-neighborhood contour tracing   */
/* ------------------------------------------------------------------ */

function traceBlobs(binary: Uint8Array, size: number, minArea: number): Vec2[][] {
  const labels = new Int32Array(binary.length)
  const polygons: Vec2[][] = []
  let nextLabel = 1

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x
      if (binary[idx] !== 1 || labels[idx] !== 0) continue

      const area = floodFill(binary, labels, size, x, y, nextLabel)
      if (area >= minArea) {
        const contour = traceContour(binary, size, x, y)
        if (contour.length >= 3) polygons.push(contour)
      }
      nextLabel++
    }
  }
  return polygons
}

function floodFill(
  binary: Uint8Array,
  labels: Int32Array,
  size: number,
  startX: number,
  startY: number,
  label: number,
): number {
  const stack: number[] = [startX, startY]
  let area = 0
  while (stack.length > 0) {
    const y = stack.pop()!
    const x = stack.pop()!
    if (x < 0 || x >= size || y < 0 || y >= size) continue
    const idx = y * size + x
    if (binary[idx] !== 1 || labels[idx] !== 0) continue
    labels[idx] = label
    area++
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
  }
  return area
}

/**
 * Moore-neighborhood contour tracing. Starts at the topmost-leftmost pixel
 * of the blob and walks the boundary clockwise.
 */
function traceContour(binary: Uint8Array, size: number, startX: number, startY: number): Vec2[] {
  const contour: Vec2[] = []
  const directions = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1],
  ]

  let x = startX
  let y = startY
  let dir = 0
  const startKey = y * size + x

  for (let step = 0; step < size * size * 4; step++) {
    contour.push({ x, y })
    let found = false
    for (let i = 0; i < 8; i++) {
      const ndir = (dir + 6 + i) % 8
      const [dx, dy] = directions[ndir]
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue
      if (binary[ny * size + nx] === 1) {
        x = nx
        y = ny
        dir = ndir
        found = true
        break
      }
    }
    if (!found) break
    if (x === startX && y === startY && contour.length > 1) {
      const nextKey = y * size + x
      if (nextKey === startKey) break
    }
  }
  return contour
}

function polygonArea(polygon: Vec2[]): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) * 0.5
}
