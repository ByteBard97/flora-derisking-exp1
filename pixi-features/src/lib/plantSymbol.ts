/**
 * Plant symbol renderer — canvas pipeline (replaces shader-filter approach).
 *
 * Adapted from a sibling Claude Code prototype that solved several things
 * better than my GPU shader did:
 *
 *   1. Two pigment textures sampled at *independent* offsets, composited via
 *      canvas `multiply` blend → primary pigment pools in one region, bloom
 *      pigment pools in *different* regions, and where they overlap the
 *      colors mix properly. This is the Wild Ones effect that single-texture
 *      density couldn't produce.
 *
 *   2. Pigment-pass algorithm: convert grayscale density texture into colored
 *      pigment with density-weighted alpha, biased toward white at low
 *      density. Multiply-blending then darkens base toward the pigment color
 *      where the texture is dense and leaves base alone where it's white —
 *      saturated pooling instead of muddy averaging.
 *
 *   3. Edge darkening via blurred-alpha: blur the alpha channel, find pixels
 *      where blur > sharp (just inside the silhouette), darken those. Works
 *      on any irregular shape without per-axis tuning.
 *
 *   4. Render-once-to-canvas: each plant becomes a Sprite with a baked
 *      texture. Pan/zoom is free; only param changes trigger re-render.
 */

import { Container, Sprite, Texture } from 'pixi.js'
import type { Silhouette, Vec2 } from './silhouette'

/* ─────────────────────────────  PUBLIC API  ─────────────────────────────── */

export interface WatercolorParams {
  /** Multiply-blend strength of the primary pigment (typically darker base). */
  primaryStrength: number
  /** Multiply-blend strength of the bloom pigment. */
  bloomStrength: number
  /**
   * Explicit bloom pigment color (e.g. 0xa07560 for dusty rose). Hue-rotating
   * the base color isn't enough — going from green to pink needs ~120°, which
   * clobbers the relationship with the base. Wild Ones plants use a fixed
   * warm-rose secondary regardless of primary green.
   */
  bloomColor: number
  /** Edge-darken strength (0..1). 0 disables. */
  edgeDarkenStrength: number
  /** Edge-darken blur radius as fraction of displayRadius (e.g. 0.04). */
  edgeDarkenRadiusFactor: number
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
  watercolor: WatercolorParams | null
  /** Stable per-plant seed (typically plantId) for texture region selection. */
  seed: number
}

const WATERCOLOR_INKED: WatercolorParams = {
  primaryStrength: 0.7,
  bloomStrength: 0.85,
  bloomColor: 0xa07560,           // muted rose-brown — Preston Montague restraint
  edgeDarkenStrength: 0.55,
  edgeDarkenRadiusFactor: 0.04,
}

const WATERCOLOR_FADED: WatercolorParams = {
  primaryStrength: 0.85,
  bloomStrength: 1.0,
  bloomColor: 0xc88a72,           // warmer dusty rose — Wild Ones secondary
  edgeDarkenStrength: 0.7,
  edgeDarkenRadiusFactor: 0.05,
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
}

export function createPlantSymbol(
  silhouette: Silhouette,
  params: PlantSymbolParams,
  primaryTex: Texture,
  bloomTex: Texture,
): Container {
  const radius = params.displayRadius
  const pad = Math.max(
    PAD_MIN,
    Math.abs(params.shadowOffsetX) + Math.abs(params.shadowOffsetY) + PAD_SHADOW_EXTRA,
  )
  const canvasSize = Math.ceil((radius + pad) * 2)
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

  // ── 1. Drop shadow (blurred fill, offset)
  if (params.shadowAlpha > 0 && (params.shadowOffsetX !== 0 || params.shadowOffsetY !== 0)) {
    ctx.save()
    ctx.translate(params.shadowOffsetX, params.shadowOffsetY)
    ctx.filter = `blur(${radius * SHADOW_BLUR_FACTOR}px)`
    const sc = rgbFromInt(params.shadowColor)
    ctx.fillStyle = `rgba(${sc.r}, ${sc.g}, ${sc.b}, ${params.shadowAlpha})`
    fillPolygons(ctx, polygons)
    ctx.restore()
  }

  // ── 2. Solid base fill
  ctx.globalAlpha = params.fillAlpha
  ctx.fillStyle = hexFromInt(params.fillColor)
  fillPolygons(ctx, polygons)
  ctx.globalAlpha = 1

  // ── 3. Two-pigment watercolor wash + edge darken
  if (params.watercolor) {
    const wc = params.watercolor

    ctx.save()
    pathPolygons(ctx, polygons)
    ctx.clip()

    // Primary pigment: multiply blend deepens base where the wash texture
    // is dense — wet-on-wet pooling effect.
    ctx.globalCompositeOperation = 'multiply'
    const primarySrc = textureSourceImage(primaryTex)
    if (primarySrc) {
      paintPigmentPass(
        ctx,
        primarySrc,
        darken(params.fillColor, PRIMARY_PIGMENT_DARKEN),
        {
          ...sampleOffset(params.seed, primarySrc, canvasSize),
          scale: 1.0,
          strength: wc.primaryStrength,
          size: canvasSize,
        },
        'multiply',
      )
    }

    // Bloom pigment: source-over with overlay-mode pixels lays a distinct
    // SECOND color on top of the primary wash. Multiply alone would just
    // give olive-brown mud (rose × green); we want visible rose patches.
    ctx.globalCompositeOperation = 'source-over'
    const bloomSrc = textureSourceImage(bloomTex)
    if (bloomSrc) {
      paintPigmentPass(
        ctx,
        bloomSrc,
        wc.bloomColor,
        {
          ...sampleOffset(params.seed + BLOOM_SEED_OFFSET, bloomSrc, canvasSize),
          scale: 1.1,
          strength: wc.bloomStrength,
          size: canvasSize,
        },
        'overlay',
      )
    }

    ctx.restore()

    if (wc.edgeDarkenStrength > 0) {
      edgeDarkenInPlace(
        canvas, ctx,
        rgbFromInt(darken(params.fillColor, EDGE_DARKEN_TINT)),
        wc.edgeDarkenStrength,
        Math.max(EDGE_BLUR_MIN_PX, radius * wc.edgeDarkenRadiusFactor),
      )
    }
  }

  // ── 4. Outline (jittered, drawn over wash so it stays crisp)
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

/* ────────────────────────────  TUNING CONSTANTS  ────────────────────────── */

const PAD_MIN = 30
const PAD_SHADOW_EXTRA = 14
const SHADOW_BLUR_FACTOR = 0.06
const PRIMARY_PIGMENT_DARKEN = 0.18      // primary pigment is base × (1 − this)
const EDGE_DARKEN_TINT = 0.6             // dark color used at the silhouette edge
const EDGE_BLUR_MIN_PX = 2
const BLOOM_SEED_OFFSET = 31             // pigment passes sample different texture regions
const PIGMENT_ALPHA_GAIN = 1.4           // pushes thin-pigment pixels into visibility
const EDGE_DARKEN_GAIN = 1.6

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
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function rgbFromInt(c: number): { r: number; g: number; b: number } {
  return { r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff }
}

function hexFromInt(c: number): string {
  return '#' + c.toString(16).padStart(6, '0')
}

function darken(color: number, amount: number): number {
  const c = rgbFromInt(color)
  const r = Math.round(c.r * (1 - amount))
  const g = Math.round(c.g * (1 - amount))
  const b = Math.round(c.b * (1 - amount))
  return (r << 16) | (g << 8) | b
}

interface PigmentOpts {
  x: number
  y: number
  scale: number
  strength: number
  size: number
}

type PigmentMode = 'multiply' | 'overlay'

/**
 * Composite one pigment pass.
 *
 * `mode = 'multiply'`: pixels biased toward WHITE at low density so a multiply
 * blend over base = "no change" in light regions and "darken toward pigment"
 * in dense regions. Use for the primary pigment (a darker variant of base) —
 * gives wet-on-wet pooling that deepens the existing wash.
 *
 * `mode = 'overlay'`: pixels are pure pigment color, alpha = density. Use
 * with `globalCompositeOperation = 'source-over'` to lay a SECOND distinct
 * color on top. This is how Wild Ones gets visible rose blooms over green —
 * multiply alone gives mud (rose × green ≈ olive); source-over of rose-with-
 * alpha shows real rose.
 *
 * The caller is responsible for setting the canvas globalCompositeOperation
 * and applying a clip path BEFORE calling this.
 */
function paintPigmentPass(
  targetCtx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  pigmentColor: number,
  opts: PigmentOpts,
  mode: PigmentMode = 'multiply',
): void {
  const { x, y, scale, strength, size } = opts
  const sample = document.createElement('canvas')
  sample.width = size
  sample.height = size
  const sctx = sample.getContext('2d')
  if (!sctx) return
  sctx.drawImage(source, x, y, size / scale, size / scale, 0, 0, size, size)
  const id = sctx.getImageData(0, 0, size, size)
  const d = id.data
  const pig = rgbFromInt(pigmentColor)
  for (let i = 0; i < d.length; i += 4) {
    // Luminance, not red channel. The rose bloom texture has high R (rose
    // ink ~ R=180); using R alone caps bloom density at ~0.3 and the rose
    // never reads. Luminance treats both green wash and rose bloom textures
    // correctly: dark ink → low luma → high density regardless of hue.
    const luma = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
    const density = 1 - luma / 255
    const a = Math.min(255, density * 255 * strength * PIGMENT_ALPHA_GAIN)
    if (mode === 'multiply') {
      const blend = density
      d[i]     = pig.r * blend + 255 * (1 - blend)
      d[i + 1] = pig.g * blend + 255 * (1 - blend)
      d[i + 2] = pig.b * blend + 255 * (1 - blend)
    } else {
      d[i]     = pig.r
      d[i + 1] = pig.g
      d[i + 2] = pig.b
    }
    d[i + 3] = a
  }
  sctx.putImageData(id, 0, 0)
  targetCtx.drawImage(sample, 0, 0)
}

/**
 * Stamen / Bousseau edge-darken trick. Blur the canvas's alpha channel,
 * compare to the sharp alpha; pixels where blurred > sharp are inside the
 * edge band, darken proportionally toward the tint.
 */
function edgeDarkenInPlace(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  darkRgb: { r: number; g: number; b: number },
  strength: number,
  blurPx: number,
): void {
  const w = canvas.width
  const h = canvas.height
  const blurCanvas = document.createElement('canvas')
  blurCanvas.width = w
  blurCanvas.height = h
  const bc = blurCanvas.getContext('2d')
  if (!bc) return
  bc.filter = `blur(${blurPx}px)`
  bc.drawImage(canvas, 0, 0)
  const blurred = bc.getImageData(0, 0, w, h).data
  const fresh = ctx.getImageData(0, 0, w, h)
  const fd = fresh.data
  for (let i = 0; i < fd.length; i += 4) {
    if (fd[i + 3] === 0) continue
    const edge = Math.max(0, blurred[i + 3] - fd[i + 3]) / 255
    const k = Math.min(1, edge * strength * EDGE_DARKEN_GAIN)
    fd[i]     = fd[i]     * (1 - k) + darkRgb.r * k
    fd[i + 1] = fd[i + 1] * (1 - k) + darkRgb.g * k
    fd[i + 2] = fd[i + 2] * (1 - k) + darkRgb.b * k
  }
  ctx.putImageData(fresh, 0, 0)
}

function textureSourceImage(tex: Texture): CanvasImageSource | null {
  // Pixi v8: TextureSource.resource is the underlying image/canvas/bitmap.
  const r = (tex.source as unknown as { resource?: unknown }).resource
  if (!r) return null
  // CanvasImageSource accepts HTMLImageElement, HTMLCanvasElement, ImageBitmap,
  // HTMLVideoElement, OffscreenCanvas, SVGImageElement.
  return r as CanvasImageSource
}

function sampleOffset(
  seed: number,
  source: CanvasImageSource,
  size: number,
): { x: number; y: number } {
  const dim = source as unknown as { width?: number; height?: number }
  const sw = dim.width ?? 0
  const sh = dim.height ?? 0
  const maxX = Math.max(0, sw - size - 1)
  const maxY = Math.max(0, sh - size - 1)
  const hx = ((seed * 9301 + 49297) % 233280) / 233280
  const hy = ((seed * 49297 + 9301) % 233280) / 233280
  return { x: Math.floor(hx * maxX), y: Math.floor(hy * maxY) }
}
