/**
 * Plant symbol renderer — Bousseau-style watercolor pipeline.
 *
 * Replaces the earlier multiply+source-over approach with a unified
 * "modify_color" pass that composes three contributions in HSL density
 * space (paper texture × turbulent flow × edge darkening) before doing
 * a single HSL round-trip per pixel — 3× cheaper than separate passes.
 *
 * Reference: Bousseau et al. 2006, "Interactive Watercolor Rendering with
 * Temporal Coherence and Abstraction." See `thewatercolorist` GitHub repo
 * for a working C++ port we mirrored.
 *
 * Pipeline:
 *   1. drop shadow (blurred, offset)
 *   2. solid primary fill across silhouette
 *   3. bloom: SDF-shaped secondary fill at anchor (perturbed, soft edge)
 *   4. ONE combined pass: density = 1 + βpaper*(paper-0.5)
 *                                    + βflow*(flow-0.5)
 *                                    + βedge*(edge-0.5)
 *      Then HSL round-trip applying density to L (and S).
 *   5. jittered outline drawn on top
 *   6. canvas → Pixi Texture → Sprite
 */

import { Container, Sprite, Texture } from 'pixi.js'
import type { Silhouette, Vec2 } from './silhouette'
import { seededNoise2D, fbm2d } from './perlinNoise'
import { computeAlphaMaskedSobel } from './sobelGradient'

/* ─────────────────────────────  PUBLIC API  ─────────────────────────────── */

export interface BousseauParams {
  /** Paper-texture grain strength (0..1, default 0.45). */
  betaPaper: number
  /** Turbulent flow / pigment patch strength (0..1, default 0.55). */
  betaFlow: number
  /** Edge darkening at color gradients (0..1, default 0.7). */
  betaEdge: number
  /** Octaves of FBM for the flow pass. */
  flowOctaves: number
  /** Base frequency of the flow noise (smaller = bigger patches). */
  flowFrequency: number
  /** Bloom secondary color. */
  bloomColor: number
}

export interface PlantSymbolParams {
  displayRadius: number
  fillColor: number
  fillAlpha: number
  strokeColor: number
  strokeWidth: number
  outlineJitterPx: number
  shadowOffsetX: number
  shadowOffsetY: number
  shadowAlpha: number
  shadowColor: number
  watercolor: BousseauParams | null
  /** Stable per-plant seed (typically plantId) — drives bloom anchor + flow noise. */
  seed: number
  /** Bloom anchor in 0..1 normalized canvas coords. If absent, derived from seed. */
  bloomAnchor: { x: number; y: number } | null
  /** Bloom radius as fraction of displayRadius. */
  bloomRadius: number
  /** Bloom edge softness (smoothstep range). */
  bloomSoftness: number
  /** SDF perturbation amplitude — gives organic cauliflower edges. */
  bloomPerturbation: number
}

const WATERCOLOR_INKED: BousseauParams = {
  betaPaper: 0.4,
  betaFlow: 0.5,
  betaEdge: 0.55,
  flowOctaves: 5,
  flowFrequency: 0.018,
  bloomColor: 0xa07560,
}

const WATERCOLOR_FADED: BousseauParams = {
  betaPaper: 0.5,
  betaFlow: 0.7,
  betaEdge: 0.7,
  flowOctaves: 6,
  flowFrequency: 0.014,
  bloomColor: 0xc88a72,
}

export const DEFAULT_INKED_CLUSTER: Omit<PlantSymbolParams, 'seed'> = {
  displayRadius: 60,
  fillColor: 0x6b8e5a,
  fillAlpha: 1.0,
  strokeColor: 0x1a1f15,
  strokeWidth: 2,
  outlineJitterPx: 1.5,
  shadowOffsetX: 4,
  shadowOffsetY: 6,
  shadowAlpha: 0.25,
  shadowColor: 0x2a3340,
  watercolor: WATERCOLOR_INKED,
  bloomAnchor: null,
  bloomRadius: 0.55,
  bloomSoftness: 0.5,
  bloomPerturbation: 0.18,
}

export const DEFAULT_WATERCOLOR_FADED: Omit<PlantSymbolParams, 'seed'> = {
  displayRadius: 60,
  fillColor: 0x8fa67a,
  fillAlpha: 1.0,
  strokeColor: 0x4a5a3e,
  strokeWidth: 1,
  outlineJitterPx: 2.5,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowAlpha: 0,
  shadowColor: 0x000000,
  watercolor: WATERCOLOR_FADED,
  bloomAnchor: null,
  bloomRadius: 0.55,
  bloomSoftness: 0.55,
  bloomPerturbation: 0.22,
}

export function defaultBloomAnchor(seed: number): { x: number; y: number } {
  // Polar offset, magnitude 0.15..0.32 from center; angle from seed hash.
  const a = hashFract(seed + 1) * Math.PI * 2
  const r = 0.15 + hashFract((seed + 1) * 7) * 0.17
  return { x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r }
}

export function createPlantSymbol(
  silhouette: Silhouette,
  params: PlantSymbolParams,
  paperTex: Texture,
): Container {
  const radius = params.displayRadius
  const pad = Math.max(
    PAD_MIN,
    Math.abs(params.shadowOffsetX) + Math.abs(params.shadowOffsetY) + PAD_SHADOW_EXTRA,
  )
  const canvasSize = Math.min(MAX_CANVAS_SIZE, Math.ceil((radius + pad) * 2))
  const cx = canvasSize / 2
  const cy = canvasSize / 2

  const canvas = document.createElement('canvas')
  canvas.width = canvasSize
  canvas.height = canvasSize
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not acquire 2D context for plant symbol canvas')

  const polygons: Vec2[][] = silhouette.polygons.map(poly =>
    centerOn(normalizeToRadius(poly, silhouette.rasterSize, radius), cx, cy),
  )

  // ── 1. Drop shadow ────────────────────────────────────────────────
  if (params.shadowAlpha > 0 && (params.shadowOffsetX !== 0 || params.shadowOffsetY !== 0)) {
    ctx.save()
    ctx.translate(params.shadowOffsetX, params.shadowOffsetY)
    ctx.filter = `blur(${radius * SHADOW_BLUR_FACTOR}px)`
    const sc = rgbFromInt(params.shadowColor)
    ctx.fillStyle = `rgba(${sc.r}, ${sc.g}, ${sc.b}, ${params.shadowAlpha})`
    fillPolygons(ctx, polygons)
    ctx.restore()
  }

  // ── 2. Primary fill across silhouette ─────────────────────────────
  ctx.globalAlpha = params.fillAlpha
  ctx.fillStyle = hexFromInt(params.fillColor)
  fillPolygons(ctx, polygons)
  ctx.globalAlpha = 1

  // ── 3. Bloom — SDF-shaped secondary fill at anchor ────────────────
  if (params.watercolor) {
    paintSdfBloom(
      ctx, canvas, polygons,
      params.bloomAnchor ?? defaultBloomAnchor(params.seed),
      params.bloomRadius * radius,
      params.bloomSoftness,
      params.bloomPerturbation,
      params.watercolor.bloomColor,
      params.seed,
    )
  }

  // ── 4. Combined Bousseau density pass (paper + flow + edge) ───────
  if (params.watercolor) {
    applyBousseauPass(ctx, canvas, paperTex, params.watercolor, params.seed)
  }

  // ── 5. Outline (drawn last, stays crisp) ──────────────────────────
  if (params.strokeWidth > 0) {
    const jittered = polygons.map(poly =>
      params.outlineJitterPx > 0 ? jitterAlongNormals(poly, params.outlineJitterPx) : poly,
    )
    ctx.lineWidth = params.strokeWidth
    ctx.strokeStyle = hexFromInt(params.strokeColor)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    pathPolygons(ctx, jittered)
    ctx.stroke()
  }

  const texture = Texture.from(canvas)
  const sprite = new Sprite(texture)
  sprite.anchor.set(0.5)

  const container = new Container()
  container.addChild(sprite)
  return container
}

/* ───────────────────────────  TUNING CONSTANTS  ─────────────────────────── */

const PAD_MIN = 30
const PAD_SHADOW_EXTRA = 14
const MAX_CANVAS_SIZE = 512
const SHADOW_BLUR_FACTOR = 0.06

/* ───────────────────────────  BLOOM SDF FILL  ───────────────────────────── */

/**
 * Paints a soft, organically-edged blob of `bloomColor` centered at the
 * anchor. SDF: `d = length(p - anchor) / radius + (fbm - 0.5) * perturbation`.
 * Smoothstep on `d` gives the alpha envelope.
 *
 * Drawn `source-over` and clipped to the silhouette so the bloom never
 * spills outside the plant.
 */
function paintSdfBloom(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  polygons: Vec2[][],
  anchorNorm: { x: number; y: number },
  radiusPx: number,
  softness: number,
  perturbation: number,
  bloomColor: number,
  seed: number,
): void {
  if (radiusPx <= 0 || softness <= 0) return

  const w = canvas.width
  const h = canvas.height
  const ax = clamp01(anchorNorm.x) * w
  const ay = clamp01(anchorNorm.y) * h

  // Render bloom into a temp canvas so we can clip via context drawing
  // without disturbing the existing image data.
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const tctx = tmp.getContext('2d')
  if (!tctx) return

  const noise = seededNoise2D(seed + 1009)
  const id = tctx.createImageData(w, h)
  const d = id.data
  const pig = rgbFromInt(bloomColor)
  const fbmScale = 0.04
  const softHi = softness // outer fade boundary
  const softLo = Math.max(0, softness - 0.5) // inner full-alpha plateau

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dx = (px - ax) / radiusPx
      const dy = (py - ay) / radiusPx
      const baseDist = Math.sqrt(dx * dx + dy * dy)
      const noiseVal = fbm2d(noise, px * fbmScale, py * fbmScale, 3, 1, 0.5) - 0.5
      const distance = baseDist + noiseVal * perturbation
      // 1.0 inside, 0.0 outside, smoothstep transition between softLo and softHi
      const alpha = 1 - smoothstep(1 - softHi, 1 + softLo, distance)
      const ai = (py * w + px) * 4
      d[ai]     = pig.r
      d[ai + 1] = pig.g
      d[ai + 2] = pig.b
      d[ai + 3] = Math.round(alpha * 255)
    }
  }
  tctx.putImageData(id, 0, 0)

  // Composite bloom into main canvas, clipped to silhouette
  ctx.save()
  pathPolygons(ctx, polygons)
  ctx.clip()
  ctx.drawImage(tmp, 0, 0)
  ctx.restore()
}

/* ───────────────────────  COMBINED BOUSSEAU PASS  ───────────────────────── */

/**
 * Single pixel-loop pass composing paper + flow + edge contributions in
 * density space, then doing one HSL round-trip per pixel.
 *
 * density = 1 + βp*(paper - 0.5) + βf*(flow - 0.5) + βe*(edge - 0.5)
 * lp = l * (1 - (1 - l) * (density - 1))   // applied to L (and S)
 */
function applyBousseauPass(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  paperTex: Texture,
  params: BousseauParams,
  seed: number,
): void {
  const w = canvas.width
  const h = canvas.height
  const image = ctx.getImageData(0, 0, w, h)
  const data = image.data

  // Sample the paper texture into a grayscale luminance map at canvas size.
  const paperLuma = samplePaperLuma(paperTex, w, h, seed)

  // Compute Sobel gradient over the current image (alpha-masked).
  const sobelMag = computeAlphaMaskedSobel(image)

  // Per-plant flow noise.
  const flowNoise = seededNoise2D(seed + 4099)
  const flowOct = params.flowOctaves
  const flowFreq = params.flowFrequency

  const bP = clamp01(params.betaPaper)
  const bF = clamp01(params.betaFlow)
  const bE = clamp01(params.betaEdge)

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4
      if (data[i + 3] === 0) continue

      // Paper grain: 0..1 luminance of paper sample (0.5 = neutral).
      const paper = paperLuma[py * w + px] / 255

      // Turbulent flow: 0..1 multi-octave Perlin. 0.5 = neutral.
      const flow = fbm2d(flowNoise, px, py, flowOct, flowFreq, 0.5)

      // Edge darkening: high gradient → high tex value → DARKENS.
      // Remap so grad=0 → 0.5 (neutral), grad=1 → 1.0 (max darken).
      const edge = (sobelMag[py * w + px] / 255) * 0.5 + 0.5

      const density =
        1
        + bP * (paper - 0.5)
        + bF * (flow - 0.5)
        + bE * (edge - 0.5)

      // HSL round-trip: modulate L (and slightly S) by density.
      const r = data[i] / 255
      const g = data[i + 1] / 255
      const b = data[i + 2] / 255
      const [h0, s0, l0] = rgbToHsl(r, g, b)
      // Bousseau formula: Cp = C * (1 - (1 - C) * (density - 1))
      const lp = clamp01(l0 * (1 - (1 - l0) * (density - 1)))
      // Saturation gets a milder version of the same modulation.
      const sp = clamp01(s0 * (1 - (1 - s0) * (density - 1) * SAT_DAMPING))
      const [r2, g2, b2] = hslToRgb(h0, sp, lp)
      data[i]     = Math.round(r2 * 255)
      data[i + 1] = Math.round(g2 * 255)
      data[i + 2] = Math.round(b2 * 255)
    }
  }
  ctx.putImageData(image, 0, 0)
}

const SAT_DAMPING = 0.4

/**
 * Sample the paper texture into a w×h luminance map. Per-plant offset so
 * different plants get different paper regions.
 */
function samplePaperLuma(paperTex: Texture, w: number, h: number, seed: number): Uint8Array {
  const out = new Uint8Array(w * h)
  const src = textureSourceImage(paperTex)
  if (!src) {
    // No paper bound — fill with neutral 0.5 so paper pass becomes a no-op.
    out.fill(128)
    return out
  }

  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const tctx = tmp.getContext('2d')
  if (!tctx) {
    out.fill(128)
    return out
  }

  const dim = src as unknown as { width?: number; height?: number }
  const sw = dim.width ?? w
  const sh = dim.height ?? h
  const ox = Math.floor(((seed * 9301 + 49297) % 233280) / 233280 * Math.max(0, sw - w))
  const oy = Math.floor(((seed * 49297 + 9301) % 233280) / 233280 * Math.max(0, sh - h))
  tctx.drawImage(src, ox, oy, w, h, 0, 0, w, h)

  const id = tctx.getImageData(0, 0, w, h)
  const d = id.data
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    out[j] = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
  }
  return out
}

/* ──────────────────────────────  HELPERS  ───────────────────────────────── */

function normalizeToRadius(poly: Vec2[], rasterSize: number, displayRadius: number): Vec2[] {
  const half = rasterSize / 2
  const scale = displayRadius / half
  return poly.map(p => ({ x: (p.x - half) * scale, y: (p.y - half) * scale }))
}

function centerOn(poly: Vec2[], cx: number, cy: number): Vec2[] {
  return poly.map(p => ({ x: p.x + cx, y: p.y + cy }))
}

function pathPolygons(ctx: CanvasRenderingContext2D, polys: Vec2[][]): void {
  ctx.beginPath()
  for (const poly of polys) {
    if (poly.length < 3) continue
    ctx.moveTo(poly[0].x, poly[0].y)
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y)
    ctx.closePath()
  }
}

function fillPolygons(ctx: CanvasRenderingContext2D, polys: Vec2[][]): void {
  pathPolygons(ctx, polys)
  ctx.fill()
}

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
    out.push({ x: poly[i].x + nx * noise * amplitude, y: poly[i].y + ny * noise * amplitude })
  }
  return out
}

function smoothNoise(t: number): number {
  const a = hashFract(Math.floor(t))
  const b = hashFract(Math.floor(t) + 1)
  const f = t - Math.floor(t)
  const blend = f * f * (3 - 2 * f)
  return (a + (b - a) * blend) * 2 - 1
}

function hashFract(n: number): number {
  const x = Math.sin(n * 12.9898 + 1.0) * 43758.5453
  return x - Math.floor(x)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function rgbFromInt(c: number): { r: number; g: number; b: number } {
  return { r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff }
}

function hexFromInt(c: number): string {
  return '#' + c.toString(16).padStart(6, '0')
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h / 6, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l]
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)]
}

function textureSourceImage(tex: Texture): CanvasImageSource | null {
  const r = (tex.source as unknown as { resource?: unknown }).resource
  return r ? (r as CanvasImageSource) : null
}

